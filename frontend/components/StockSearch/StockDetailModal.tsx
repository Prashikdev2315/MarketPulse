'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  X, TrendingUp, TrendingDown, Building2, RefreshCw, AlertTriangle,
  ExternalLink, DollarSign, BarChart3, Percent, Activity, Layers, Target,
  WifiOff, SearchX,
} from 'lucide-react';
import type { IndexQuote, StockInfo, NewsArticle } from '@/lib/api';
import { fetchStockQuote, fetchStockNews, ApiError, isConnectionError, isNotFoundError } from '@/lib/api';
import { stockToTradingView } from '@/lib/symbolMap';
import AIInsightPanel from '@/components/AIInsightPanel/AIInsightPanel';
import NewsPanel from '@/components/NewsPanel/NewsPanel';
import {
  ChartSkeleton, StockModalSkeleton, NewsSkeleton,
} from '@/components/ui/LoadingSkeleton';

// Reuse the existing chart (no SSR — it loads TradingView tv.js at runtime).
const TradingViewChart = dynamic(
  () => import('@/components/TradingViewChart/TradingViewChart'),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

interface Props {
  symbol: string;
  name: string;
  /** Optional pre-resolved TradingView symbol from the search result. */
  tradingViewSymbol?: string;
  onClose: () => void;
}

// ── Number formatting helpers (mirrors IndexCard conventions) ──────────────
function formatPrice(n: number | null | undefined, currency?: string): string {
  if (n == null || isNaN(n)) return '—';
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  return currency ? `${formatted} ${currency}` : formatted;
}

function formatMarketCap(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
}

function formatVolume(n: number | null | undefined): string {
  if (!n) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toString();
}

// 52-week range bar (same visual recipe as IndexCard's DayRangeBar)
function Range52Bar({ low, high, current }: { low: number; high: number; current: number }) {
  const range = (high - low) || 1;
  const pos = Math.max(0, Math.min(100, ((current - low) / range) * 100));
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{low.toFixed(0)}</span>
      <div className="flex-1 h-1.5 rounded-full relative" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div
          className="absolute top-0 h-full rounded-full"
          style={{ width: `${pos}%`, background: 'linear-gradient(90deg, var(--loss), var(--accent-blue), var(--gain))' }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white"
          style={{ left: `calc(${pos}% - 5px)`, background: 'var(--accent-blue)' }}
        />
      </div>
      <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{high.toFixed(0)}</span>
    </div>
  );
}

function StatTile({
  icon, label, value,
}: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div
      className="rounded-lg p-2.5"
      style={{ background: 'var(--bg-overlay)' }}
    >
      <div className="flex items-center gap-1 mb-1" style={{ color: 'var(--text-muted)' }}>
        {icon}
        <span className="text-[9px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="font-mono text-sm text-white truncate">{value}</p>
    </div>
  );
}

export default function StockDetailModal({ symbol, name, tradingViewSymbol, onClose }: Props) {
  const [quote, setQuote]         = useState<IndexQuote | null>(null);
  const [info, setInfo]           = useState<StockInfo | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'not_found' | 'network' | 'generic' | null>(null);

  const [news, setNews]           = useState<NewsArticle[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [chartInterval, setChartInterval] = useState('1D');

  const [activeTab, setActiveTab] = useState<'chart' | 'analysis' | 'news' | 'predict'>('chart');

  // Resolve the TradingView symbol: prefer the search result's mapping, else
  // fall back to the client-side resolver (handles symbols from trending, etc.)
  const tvSymbol = tradingViewSymbol || stockToTradingView(symbol);

  // ── Load quote + info + news ──────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorKind(null);
    try {
      const data = await fetchStockQuote(symbol);
      // Guard against malformed responses: quote is required to render
      if (!data?.quote) {
        setError(`Received an incomplete response for ${symbol}. Please try again.`);
        setErrorKind('generic');
        return;
      }
      setQuote(data.quote);
      setInfo(data.info);
    } catch (e) {
      console.error('[StockModal] quote fetch failed:', e);
      if (isNotFoundError(e)) {
        setError(`"${symbol}" was not found. It may be delisted or the ticker may be wrong.`);
        setErrorKind('not_found');
      } else if (isConnectionError(e)) {
        setError('Connection issue — check your network or make sure the backend is running.');
        setErrorKind('network');
      } else if (e instanceof ApiError && e.kind === 'empty') {
        setError(`Received an empty response for ${symbol}. Please try again.`);
        setErrorKind('generic');
      } else {
        setError(`Couldn't load data for ${symbol}. Check the ticker and backend connection.`);
        setErrorKind('generic');
      }
    } finally {
      setLoading(false);
    }

    // News loads in parallel (best-effort; doesn't block the modal)
    setNewsLoading(true);
    try {
      const articles = await fetchStockNews(symbol, 15);
      setNews(articles);
    } catch (e) {
      console.error('[StockModal] news fetch failed:', e);
      setNews([]);
    } finally {
      setNewsLoading(false);
    }
  }, [symbol]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Close on ESC + lock body scroll while mounted ─────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Derived display values
  const changePct  = quote?.change_pct ?? 0;
  const isUp       = changePct >= 0;
  const changeColor = isUp ? '#10b981' : '#ef4444';
  const displayName = quote?.name || info?.name || name;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-2 sm:p-4 z-[9999] animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={handleBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={`${displayName} stock details`}
    >
      <div
        className="glass-elevated rounded-2xl w-full max-w-6xl flex flex-col overflow-hidden animate-scale-in"
        style={{
          maxHeight: '95vh',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
      >
        {/* ── Header ── */}
        <div
          className="flex items-start justify-between gap-3 px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, rgba(79,156,249,0.2), rgba(139,92,246,0.2))', border: '1px solid rgba(79,156,249,0.3)' }}
            >
              <Building2 size={18} style={{ color: 'var(--accent-blue)' }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-white font-bold text-base sm:text-lg truncate">{displayName}</h2>
                <span
                  className="text-[10px] px-2 py-0.5 rounded font-mono flex-shrink-0"
                  style={{ background: 'rgba(79,156,249,0.15)', color: '#4f9cf9', border: '1px solid rgba(79,156,249,0.3)' }}
                >
                  {symbol}
                </span>
                {info?.sector && (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded font-medium flex-shrink-0"
                    style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.25)' }}
                  >
                    {info.sector}
                  </span>
                )}
                {quote && (
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                    style={{
                      background: quote.is_market_open ? 'rgba(16,185,129,0.1)' : 'rgba(156,163,175,0.1)',
                      color: quote.is_market_open ? '#10b981' : '#6b7280',
                    }}
                  >
                    {quote.is_market_open ? '● Market Open' : '○ Market Closed'}
                  </span>
                )}
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {info ? `${info.exchange || ''} · ${info.industry || info.sector || 'Equity'}` : tvSymbol}
              </p>
            </div>
          </div>

          {/* Price block */}
          {quote && !loading && !error && (
            <div className="text-right flex-shrink-0">
              <p className="font-mono font-bold text-lg sm:text-xl" style={{ color: changeColor }}>
                {formatPrice(quote.price, quote.currency)}
              </p>
              <p className="font-mono text-xs flex items-center justify-end gap-1" style={{ color: changeColor }}>
                {isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                {quote.change >= 0 ? '+' : ''}{formatPrice(quote.change)} ({isUp ? '+' : ''}{changePct.toFixed(2)}%)
              </p>
            </div>
          )}

          <button
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-white/10"
            style={{ background: 'rgba(255,255,255,0.06)' }}
            aria-label="Close"
          >
            <X size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>

        {/* ── Body (scrollable) ── */}
        <div className="flex-1 overflow-y-auto">
          {/* Loading */}
          {loading && <StockModalSkeleton />}

          {/* Error */}
          {error && !loading && (() => {
            const isNotFound = errorKind === 'not_found';
            const isNetwork  = errorKind === 'network';
            const Icon = isNotFound ? SearchX : isNetwork ? WifiOff : AlertTriangle;
            const iconColor = isNotFound ? '#f59e0b' : isNetwork ? '#ef4444' : '#ef4444';
            const title = isNotFound
              ? 'Ticker Not Found'
              : isNetwork
              ? 'Connection Issue'
              : 'Failed to Load';
            return (
              <div className="p-10 text-center space-y-3">
                <Icon size={32} className="mx-auto" style={{ color: iconColor, opacity: 0.6 }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: iconColor }}>{title}</p>
                  <p className="text-sm mt-1 font-medium text-white/60">{error}</p>
                </div>
                {!isNotFound && (
                  <button
                    onClick={loadAll}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                    style={{ background: 'rgba(79,156,249,0.12)', color: 'var(--accent-blue)', border: '1px solid rgba(79,156,249,0.25)' }}
                  >
                    <RefreshCw size={11} /> Retry
                  </button>
                )}
              </div>
            );
          })()}

          {/* Content */}
          {!loading && !error && quote && (
            <>
              {/* 52W range bar */}
              {info?.fifty_two_week_low != null && info?.fifty_two_week_high != null && (
                <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                      52-Week Range
                    </span>
                    <span className="text-[10px] font-mono" style={{ color: 'var(--accent-blue)' }}>
                      Current: {formatPrice(quote.price)}
                    </span>
                  </div>
                  <Range52Bar
                    low={info.fifty_two_week_low}
                    high={info.fifty_two_week_high}
                    current={quote.price}
                  />
                </div>
              )}

              {/* Fundamentals grid */}
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2 px-5 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <StatTile icon={<DollarSign size={10} />}  label="Mkt Cap"   value={formatMarketCap(info?.market_cap)} />
                <StatTile icon={<Percent size={10} />}     label="P/E"       value={info?.trailing_pe != null ? info.trailing_pe.toFixed(1) : '—'} />
                <StatTile icon={<Activity size={10} />}    label="Volume"    value={formatVolume(quote.volume)} />
                <StatTile icon={<BarChart3 size={10} />}   label="Beta"      value={info?.beta != null ? info.beta.toFixed(2) : '—'} />
                <StatTile icon={<TrendingUp size={10} />}  label="Day High"  value={formatPrice(quote.high)} />
                <StatTile icon={<TrendingDown size={10} />} label="Day Low"   value={formatPrice(quote.low)} />
              </div>

              {/* Tab bar */}
              <div
                className="flex gap-1 px-5 pt-3"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                {([
                  { id: 'chart',    label: 'Chart',          Icon: BarChart3, color: 'var(--accent-blue)',  activeBg: 'rgba(79,156,249,0.06)'   },
                  { id: 'analysis', label: 'AI Analysis',     Icon: Activity,  color: 'var(--accent-blue)',  activeBg: 'rgba(79,156,249,0.06)'   },
                  { id: 'news',     label: 'News',            Icon: Layers,    color: 'var(--accent-blue)',  activeBg: 'rgba(79,156,249,0.06)'   },
                  { id: 'predict',  label: 'Next Day Predict', Icon: Target,   color: '#f59e0b',             activeBg: 'rgba(245,158,11,0.08)'   },
                ] as const).map(({ id, label, Icon, color, activeBg }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-all"
                    style={{
                      color: activeTab === id ? color : 'var(--text-muted)',
                      borderBottomColor: activeTab === id ? color : 'transparent',
                      background: activeTab === id ? activeBg : 'transparent',
                    }}
                  >
                    <Icon size={12} /> {label}
                    {id === 'predict' && (
                      <span
                        className="text-[8px] font-bold px-1 py-0.5 rounded ml-0.5"
                        style={{ background: 'rgba(245,158,11,0.2)', color: '#f59e0b' }}
                      >
                        AI
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="p-5">
                {activeTab === 'chart' && (
                  <TradingViewChart
                    symbol={tvSymbol}
                    name={displayName}
                    interval={chartInterval}
                    onIntervalChange={setChartInterval}
                    isModal={true}
                  />
                )}

                {activeTab === 'analysis' && (
                  // Reuse the existing AIInsightPanel in stock mode — same tab UI,
                  // sections, bullish/bearish signals, copy/regenerate actions.
                  <div style={{ minHeight: 400 }}>
                    <AIInsightPanel symbol={symbol} />
                  </div>
                )}

                {activeTab === 'predict' && (
                  // Next-day AI prediction — pre-loads the "nextday" period
                  <div style={{ minHeight: 400 }}>
                    <AIInsightPanel symbol={symbol} initialPeriod="nextday" />
                  </div>
                )}

                {activeTab === 'news' && (
                  <div className="glass rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                    {newsLoading ? (
                      <NewsSkeleton />
                    ) : news.length > 0 ? (
                      <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                        <NewsPanel articles={news} isLoading={false} />
                      </div>
                    ) : (
                      <div className="p-8 text-center">
                        <Layers size={24} className="mx-auto mb-2 opacity-40" style={{ color: 'var(--text-muted)' }} />
                        <p className="text-sm font-medium text-white/70">No recent news for {displayName}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div
                className="px-5 py-2.5 flex items-center justify-between flex-shrink-0"
                style={{ borderTop: '1px solid var(--border-subtle)', background: 'rgba(10,14,26,0.5)' }}
              >
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Data via yfinance · News via Google News RSS
                </span>
                <a
                  href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] hover:underline flex items-center gap-1"
                  style={{ color: 'var(--accent-blue)' }}
                >
                  Open in TradingView <ExternalLink size={9} />
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
