'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Brain, TrendingUp, TrendingDown, Minus, RefreshCw, ChevronDown, ChevronUp,
  Copy, Check, BarChart2, Calendar, HelpCircle, Sparkles, BarChart,
  Globe, AlertTriangle, Lightbulb, Activity, RotateCcw, Zap, ArrowUp,
  ArrowDown, ArrowRight, Target, Shield, Crosshair, WifiOff, Clock,
} from 'lucide-react';
import type { AIInsight, AISection, ApiErrorKind } from '@/lib/api';
import { analyzeMarket, analyzeStock, ApiError, isConnectionError } from '@/lib/api';
import { AIAnalysisSkeleton } from '@/components/ui/LoadingSkeleton';

interface Props {
  /** Country code for market-wide analysis. Ignored when `symbol` is set. */
  country?: string;
  /** Yahoo stock symbol. When present, the panel runs in "stock mode" and
   *  analyzes that single equity instead of the country's indices. */
  symbol?: string;
  /** Which period tab to activate initially. Defaults to "today". */
  initialPeriod?: string;
}

// ── Tab definitions — Lucide icons only, no emoji ─────────────────────────
const MARKET_TABS = [
  { label: 'Today',       period: 'today',    Icon: BarChart2  },
  { label: '5 Days',      period: '5days',    Icon: TrendingUp },
  { label: '1 Month',     period: '1month',   Icon: Calendar   },
  { label: 'Why Moved',   period: 'why',      Icon: HelpCircle },
  { label: 'AI Forecast', period: 'forecast', Icon: Sparkles   },
];

const STOCK_TABS = [
  { label: 'Today',       period: 'today',    Icon: BarChart2  },
  { label: '5 Days',      period: '5days',    Icon: TrendingUp },
  { label: '1 Month',     period: '1month',   Icon: Calendar   },
  { label: 'Why Moved',   period: 'why',      Icon: HelpCircle },
  { label: 'AI Forecast', period: 'forecast', Icon: Sparkles   },
  { label: 'Next Day',    period: 'nextday',  Icon: Target     },
];

// ── Section icon map — keyed by section.id from backend ───────────────────
const SECTION_ICON: Record<string, React.ReactNode> = {
  market_summary:     <BarChart   size={13} style={{ color: 'var(--accent-blue)' }} />,
  prediction_summary: <Target     size={13} style={{ color: 'var(--accent-blue)' }} />,
  sector_momentum:    <RotateCcw  size={13} style={{ color: 'var(--text-secondary)' }} />,
  macro_factors:      <Globe      size={13} style={{ color: 'var(--text-secondary)' }} />,
  risk_alerts:        <AlertTriangle size={13} style={{ color: 'var(--loss)' }} />,
  opportunities:      <Lightbulb  size={13} style={{ color: 'var(--gain)' }} />,
  technical:          <Activity   size={13} style={{ color: 'var(--accent-blue)' }} />,
  catalysts:          <Zap        size={13} style={{ color: 'var(--gold)' }} />,
  institutional:      <Zap        size={13} style={{ color: 'var(--text-secondary)' }} />,
  fundamentals:       <BarChart   size={13} style={{ color: 'var(--accent-blue)' }} />,
};
const DEFAULT_SECTION_ICON = <BarChart2 size={13} style={{ color: 'var(--accent-blue)' }} />;

// ── Helpers ───────────────────────────────────────────────────────────────
function SentimentBadge({ s }: { s: string }) {
  const config = {
    bullish: { icon: <TrendingUp size={11} />, label: 'Bullish', color: 'var(--gain)',   bg: 'rgba(61,186,127,0.1)' },
    bearish: { icon: <TrendingDown size={11} />, label: 'Bearish', color: 'var(--loss)', bg: 'rgba(224,92,92,0.1)' },
    neutral: { icon: <Minus size={11} />, label: 'Neutral', color: 'var(--neutral-color)', bg: 'rgba(107,118,136,0.1)' },
  }[s] ?? { icon: <Minus size={11} />, label: 'Neutral', color: 'var(--neutral-color)', bg: 'rgba(107,118,136,0.1)' };

  return (
    <span
      className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
      style={{ background: config.bg, color: config.color, border: `1px solid ${config.color}28` }}
    >
      {config.icon} {config.label}
    </span>
  );
}

function CollapsibleSection({ section, defaultOpen = true }: { section: AISection; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const icon = SECTION_ICON[section.id] ?? DEFAULT_SECTION_ICON;

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--bg-overlay)' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:opacity-90 transition-opacity"
        style={{ background: 'rgba(255,255,255,0.02)' }}
      >
        <div className="flex items-center gap-2">
          <span className="flex-shrink-0">{icon}</span>
          <span className="text-sm font-semibold text-white">{section.title}</span>
        </div>
        {isOpen
          ? <ChevronUp  size={14} style={{ color: 'var(--text-muted)' }} />
          : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
        }
      </button>
      {isOpen && (
        <div className="px-4 py-3">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-line' }}>
            {section.content}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Next-Day Prediction Card ───────────────────────────────────────────────
function NextDayPredictionCard({ insight }: { insight: AIInsight }) {
  const dir = insight.next_day_direction ?? 'sideways';
  const low  = insight.price_target_low;
  const high = insight.price_target_high;
  const sup  = insight.key_support;
  const res  = insight.key_resistance;

  const dirConfig = {
    up:       { icon: <ArrowUp  size={22} />, label: 'UP',       color: '#10b981', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.3)'  },
    down:     { icon: <ArrowDown size={22} />, label: 'DOWN',     color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.3)'   },
    sideways: { icon: <ArrowRight size={22} />, label: 'SIDEWAYS', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)'  },
  }[dir] ?? { icon: <ArrowRight size={22} />, label: 'SIDEWAYS', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' };

  // Price range bar: position of low/high within support–resistance range
  const rangeMin  = sup  ?? low  ?? 0;
  const rangeMax  = res  ?? high ?? 0;
  const totalSpan = (rangeMax - rangeMin) || 1;
  const lowPct    = low  != null ? Math.max(0, Math.min(100, ((low  - rangeMin) / totalSpan) * 100)) : 20;
  const highPct   = high != null ? Math.max(0, Math.min(100, ((high - rangeMin) / totalSpan) * 100)) : 80;

  const fmt = (n?: number) => n != null ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';

  return (
    <div
      className="rounded-xl p-4 mb-3"
      style={{
        background: 'linear-gradient(135deg, rgba(15,20,40,0.9) 0%, rgba(20,15,40,0.9) 100%)',
        border: `1px solid ${dirConfig.border}`,
        boxShadow: `0 0 24px ${dirConfig.color}18`,
      }}
    >
      {/* Direction hero */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: dirConfig.bg, border: `1px solid ${dirConfig.border}` }}
        >
          <span style={{ color: dirConfig.color }}>{dirConfig.icon}</span>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-0.5" style={{ color: 'var(--text-muted)' }}>
            Next Session Direction
          </p>
          <p className="text-2xl font-bold" style={{ color: dirConfig.color }}>
            {dirConfig.label}
          </p>
          {insight.expected_move_pct && (
            <p className="text-sm font-mono mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Expected: <span style={{ color: dirConfig.color }}>{insight.expected_move_pct}</span>
            </p>
          )}
        </div>
      </div>

      {/* Price target range bar */}
      {(low != null || high != null) && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Target Price Range
            </span>
            <span className="text-[10px] font-mono" style={{ color: dirConfig.color }}>
              {fmt(low)} – {fmt(high)}
            </span>
          </div>
          <div className="relative h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            {/* highlighted zone between low and high */}
            <div
              className="absolute top-0 h-full rounded-full"
              style={{
                left: `${lowPct}%`,
                width: `${Math.max(highPct - lowPct, 4)}%`,
                background: `linear-gradient(90deg, ${dirConfig.color}80, ${dirConfig.color})`,
              }}
            />
            {/* low marker */}
            {low != null && (
              <div
                className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-white"
                style={{ left: `calc(${lowPct}% - 4px)`, background: dirConfig.color }}
              />
            )}
            {/* high marker */}
            {high != null && (
              <div
                className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-white"
                style={{ left: `calc(${highPct}% - 4px)`, background: '#fff' }}
              />
            )}
          </div>
          {/* Support / Resistance labels under bar */}
          {(sup != null || res != null) && (
            <div className="flex items-center justify-between mt-1">
              <span className="text-[9px] font-mono" style={{ color: '#ef4444' }}>
                {sup != null ? `S: ${fmt(sup)}` : ''}
              </span>
              <span className="text-[9px] font-mono" style={{ color: '#10b981' }}>
                {res != null ? `R: ${fmt(res)}` : ''}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Support / Resistance tiles */}
      {(sup != null || res != null) && (
        <div className="grid grid-cols-2 gap-2">
          {sup != null && (
            <div
              className="rounded-lg p-2.5 flex items-center gap-2"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <Shield size={13} style={{ color: '#ef4444' }} />
              <div>
                <p className="text-[9px] uppercase tracking-wide font-semibold" style={{ color: '#ef4444' }}>Support</p>
                <p className="font-mono text-xs text-white">{fmt(sup)}</p>
              </div>
            </div>
          )}
          {res != null && (
            <div
              className="rounded-lg p-2.5 flex items-center gap-2"
              style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}
            >
              <Crosshair size={13} style={{ color: '#10b981' }} />
              <div>
                <p className="text-[9px] uppercase tracking-wide font-semibold" style={{ color: '#10b981' }}>Resistance</p>
                <p className="font-mono text-xs text-white">{fmt(res)}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

/** Maximum user-initiated retry attempts before the button is disabled. */
const MAX_ANALYSIS_ATTEMPTS = 3;

export default function AIInsightPanel({ country = 'IN', symbol, initialPeriod }: Props) {
  // Stock mode: analyze a single equity. Country mode: analyze market indices.
  const isStockMode = !!symbol;
  const TABS = isStockMode ? STOCK_TABS : MARKET_TABS;

  const defaultPeriod = initialPeriod ?? 'today';

  const [insight, setInsight]         = useState<AIInsight | null>(null);
  const [loading, setLoading]         = useState(false);
  const [activeTab, setActiveTab]     = useState<string>(defaultPeriod);
  const [error, setError]             = useState<string | null>(null);
  const [errorKind, setErrorKind]     = useState<ApiErrorKind | null>(null);
  const [attempts, setAttempts]       = useState(0);
  const [copied, setCopied]           = useState(false);
  const contentRef                    = useRef<HTMLDivElement>(null);
  // Track whichever dependency drives re-analysis in the active mode.
  const prevModeKey                   = useRef(isStockMode ? symbol : country);

  const handleAnalyze = useCallback(async (period: string) => {
    setLoading(true);
    setActiveTab(period);
    setError(null);
    setErrorKind(null);
    setInsight(null);
    const modeLabel = isStockMode ? `stock ${symbol}` : `country ${country}`;
    console.log('[AIInsightPanel] Fetching analysis — period:', period, modeLabel);
    try {
      // Stock mode → analyzeStock; country mode → analyzeMarket.
      // Both functions have a built-in 15 s AbortController timeout.
      const result = isStockMode
        ? await analyzeStock(symbol!, period)
        : await analyzeMarket(period, country);
      console.log('[AIInsightPanel] Analysis received:', result?.title);
      setInsight(result);
      setAttempts(0); // reset counter on success
    } catch (e) {
      console.error('[AIInsightPanel] Analysis failed:', e);
      if (e instanceof ApiError) {
        setErrorKind(e.kind);
        if (e.kind === 'timeout') {
          setError('AI analysis timed out (15 s). The model may be busy — please try again.');
        } else if (isConnectionError(e)) {
          setError('Connection issue — check that the backend server is running.');
        } else if (e.kind === 'empty') {
          setError('AI returned an empty response. Please try again.');
        } else {
          setError('AI analysis unavailable. Please try again.');
        }
      } else {
        setErrorKind('api');
        setError('AI analysis unavailable. Ensure the FastAPI backend is running and try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [country, symbol, isStockMode]);

  /** User-initiated retry — increments the attempt counter. */
  const handleRetry = useCallback(() => {
    setAttempts(c => c + 1);
    handleAnalyze(activeTab);
  }, [handleAnalyze, activeTab]);

  // Auto-load on mount.
  useEffect(() => {
    const timer = setTimeout(() => handleAnalyze(defaultPeriod), 600);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload when the analysis target (country in market mode, symbol in stock mode) changes.
  useEffect(() => {
    const modeKey = isStockMode ? symbol : country;
    if (prevModeKey.current !== modeKey) {
      prevModeKey.current = modeKey;
      handleAnalyze(activeTab);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, symbol, isStockMode]);

  const handleCopy = async () => {
    if (!insight) return;
    const text = [
      insight.title,
      '',
      ...(insight.sections?.map(s => `## ${s.title}\n${s.content}`) ?? [insight.summary ?? '']),
      '',
      'Key Factors:',
      ...(insight.key_factors?.map(f => `• ${f}`) ?? []),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('[AIInsightPanel] Clipboard write failed:', e);
    }
  };

  const isNextDay = insight?.period === 'nextday';

  return (
    <div
      className="glass rounded-xl flex flex-col"
      style={{
        border: '1px solid rgba(255,255,255,0.06)',
        height: isStockMode ? undefined : 'calc(50vh - 30px)',
        minHeight: isStockMode ? 500 : 340,
        maxHeight: isStockMode ? 'none' : 520,
      }}
    >
      {/* ── Sticky Header ── */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <Brain size={14} style={{ color: 'var(--accent-blue)' }} />
        <h2 className="text-white font-semibold text-sm">
          {isStockMode ? 'AI Stock Analysis' : 'AI Market Analysis'}
        </h2>
        <span
          className="ml-auto text-[9px] px-2 py-0.5 rounded-full font-medium"
          style={{ background: 'rgba(59,158,255,0.12)', color: 'var(--accent-blue)', border: '1px solid rgba(59,158,255,0.25)' }}
        >
          Gemini AI
        </span>
      </div>

      {/* ── Tab Bar ── */}
      <div
        className="flex overflow-x-auto flex-shrink-0 px-2 pt-2 pb-0 gap-1"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', scrollbarWidth: 'none' }}
      >
        {TABS.map(({ label, period, Icon }) => {
          const isNextDayTab = period === 'nextday';
          const isActive = activeTab === period;
          return (
            <button
              key={period}
              onClick={() => handleAnalyze(period)}
              disabled={loading}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium
                         transition-all duration-200 rounded-t border-b-2 disabled:opacity-50"
              style={{
                color: isActive
                  ? 'var(--accent-blue)'
                  : 'var(--text-muted)',
                borderBottomColor: isActive
                  ? 'var(--accent-blue)'
                  : 'transparent',
                background: isActive
                  ? 'rgba(59,158,255,0.06)'
                  : 'transparent',
              }}
              aria-label={`Analyze: ${label}`}
            >
              <Icon size={12} />
              <span>{label}</span>
              {isNextDayTab && (
                <span
                  className="text-[8px] font-bold px-1 py-0.5 rounded"
                  style={{ background: 'rgba(245,158,11,0.2)', color: '#f59e0b' }}
                >
                  AI
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Scrollable Content ── */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto"
        style={{ minHeight: 0 }}
      >
        {loading && <AIAnalysisSkeleton />}

        {/* ── Error state ── */}
        {error && !loading && (() => {
          const isTimeout  = errorKind === 'timeout';
          const isNetwork  = errorKind === 'network';
          const iconColor  = isNetwork ? '#ef4444' : isTimeout ? '#f59e0b' : '#ef4444';
          const Icon       = isNetwork ? WifiOff : isTimeout ? Clock : AlertTriangle;
          const retryColor = isNetwork ? '#ef4444' : 'var(--accent-blue)';
          const retryBg    = isNetwork ? 'rgba(239,68,68,0.12)' : 'rgba(79,156,249,0.12)';
          const retryBorder= isNetwork ? 'rgba(239,68,68,0.25)' : 'rgba(79,156,249,0.25)';
          const canRetry   = attempts < MAX_ANALYSIS_ATTEMPTS;
          return (
            <div className="p-5 text-center space-y-3">
              <Icon size={28} className="mx-auto" style={{ color: iconColor, opacity: 0.7 }} />
              <div>
                <p className="text-sm font-medium" style={{ color: iconColor }}>
                  {isNetwork ? 'Connection Issue' : isTimeout ? 'AI Analysis Timed Out' : 'AI Analysis Unavailable'}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{error}</p>
              </div>
              {canRetry ? (
                <button
                  onClick={handleRetry}
                  className="flex items-center gap-1.5 text-xs mx-auto px-3 py-1.5 rounded-lg transition-all hover:opacity-80"
                  style={{ background: retryBg, color: retryColor, border: `1px solid ${retryBorder}` }}
                >
                  <RefreshCw size={11} /> Retry Analysis ({MAX_ANALYSIS_ATTEMPTS - attempts} left)
                </button>
              ) : (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Max retries reached — check the backend server and refresh the page.
                </p>
              )}
            </div>
          );
        })()}

        {/* Empty / prompt state */}
        {!loading && !error && !insight && (
          <div className="p-6 text-center">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3"
              style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)' }}
            >
              <Brain size={22} style={{ color: '#8b5cf6' }} />
            </div>
            <p className="text-sm font-medium text-white/70">AI Market Intelligence</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Select a time period above to generate analysis
            </p>
            <div className="grid grid-cols-3 gap-2 mt-4">
              {TABS.slice(0, 3).map(({ period, label, Icon }) => (
                <button
                  key={period}
                  onClick={() => handleAnalyze(period)}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-lg hover:bg-white/5
                             transition-all group"
                  style={{ border: '1px solid rgba(255,255,255,0.06)' }}
                  aria-label={`Analyze ${label}`}
                >
                  <Icon size={16} style={{ color: 'var(--accent-blue)' }} />
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Insight content ── */}
        {!loading && insight && (
          <div className="p-4 space-y-3 animate-fade-in">
            {/* Title + Sentiment */}
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-white font-semibold text-sm leading-snug flex-1">{insight.title}</h3>
              <SentimentBadge s={insight.sentiment} />
            </div>

            {/* Confidence bar */}
            <div className="flex items-center gap-2">
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Confidence</span>
              <div className="flex-1 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.round((insight.confidence || 0) * 100)}%`,
                    background: isNextDay
                      ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                      : 'linear-gradient(90deg, #4f9cf9, #8b5cf6)',
                  }}
                />
              </div>
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                {Math.round((insight.confidence || 0) * 100)}%
              </span>
            </div>

            {/* ── Next-Day Prediction Card ── */}
            {isNextDay && <NextDayPredictionCard insight={insight} />}

            {/* Sections */}
            {insight.sections && insight.sections.length > 0 ? (
              <div className="space-y-2">
                {insight.sections.map((section, i) => (
                  <CollapsibleSection key={section.id} section={section} defaultOpen={i === 0} />
                ))}
              </div>
            ) : insight.summary ? (
              <div
                className="rounded-lg p-3"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {insight.summary}
                </p>
              </div>
            ) : null}

            {/* Bullish / Bearish signals */}
            {((insight.bullish_signals?.length ?? 0) > 0 || (insight.bearish_signals?.length ?? 0) > 0) && (
              <div className="grid grid-cols-2 gap-2">
                {(insight.bullish_signals?.length ?? 0) > 0 && (
                  <div
                    className="rounded-lg p-3"
                    style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}
                  >
                    <div className="flex items-center gap-1 mb-1.5">
                      <TrendingUp size={10} style={{ color: '#10b981' }} />
                      <p className="text-[10px] font-semibold" style={{ color: '#10b981' }}>Bullish</p>
                    </div>
                    {insight.bullish_signals!.map((s, i) => (
                      <p key={i} className="text-[10px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
                        • {s}
                      </p>
                    ))}
                  </div>
                )}
                {(insight.bearish_signals?.length ?? 0) > 0 && (
                  <div
                    className="rounded-lg p-3"
                    style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}
                  >
                    <div className="flex items-center gap-1 mb-1.5">
                      <TrendingDown size={10} style={{ color: '#ef4444' }} />
                      <p className="text-[10px] font-semibold" style={{ color: '#ef4444' }}>Bearish</p>
                    </div>
                    {insight.bearish_signals!.map((s, i) => (
                      <p key={i} className="text-[10px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
                        • {s}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Key Factors */}
            {insight.key_factors && insight.key_factors.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
                  KEY FACTORS
                </p>
                <div className="space-y-1.5">
                  {insight.key_factors.map((factor, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <span
                        className="mt-0.5 w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold"
                        style={{ background: 'rgba(79,156,249,0.15)', color: 'var(--accent-blue)' }}
                      >
                        {i + 1}
                      </span>
                      {factor}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions row */}
            <div
              className="flex items-center justify-between pt-2 gap-2"
              style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
            >
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg
                           hover:bg-white/5 transition-colors"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Copy analysis"
              >
                {copied
                  ? <><Check size={10} style={{ color: '#10b981' }} /><span style={{ color: '#10b981' }}>Copied!</span></>
                  : <><Copy size={10} />Copy analysis</>
                }
              </button>

              <button
                onClick={handleRetry}
                className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg
                           hover:bg-white/5 transition-colors"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Regenerate analysis"
              >
                <RefreshCw size={10} /> Regenerate
              </button>

              {insight.generated_at && (
                <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                  {new Date(insight.generated_at).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
