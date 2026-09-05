'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import {
  Globe2, RefreshCw, Wifi, WifiOff, TrendingUp, TrendingDown, Activity,
} from 'lucide-react';
import type { IndexQuote, NewsArticle } from '@/lib/api';
import { fetchIndices, fetchNews } from '@/lib/api';
import { CountryConfig, COUNTRIES } from '@/lib/countryConfig';
import IndexCard from '@/components/MarketDashboard/IndexCard';
import { IndexCardSkeleton, ChartSkeleton } from '@/components/ui/LoadingSkeleton';
import NewsPanel from '@/components/NewsPanel/NewsPanel';
import AIInsightPanel from '@/components/AIInsightPanel/AIInsightPanel';
import StockSearchSection from '@/components/StockSearch/StockSearchSection';
import StockDetailModal from '@/components/StockSearch/StockDetailModal';
import { getTradingViewSymbol, SYMBOL_MAP } from '@/lib/symbolMap';

const MarketHeatmap = dynamic(() => import('@/components/MarketHeatmap/MarketHeatmap'), {
  ssr: false,
  loading: () => (
    <div className="glass rounded-xl" style={{ minHeight: 220, border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="p-4 grid grid-cols-4 gap-2">
        {[...Array(16)].map((_, i) => <div key={i} className="skeleton rounded-lg" style={{ minHeight: 64 }} />)}
      </div>
    </div>
  ),
});

// Dynamic imports (no SSR) for browser-only libraries
const WorldMap = dynamic(() => import('@/components/WorldMap/WorldMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center" style={{ background: '#0a0e1a' }}>
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: '#4f9cf9', borderTopColor: 'transparent' }}
        />
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading map…</p>
      </div>
    </div>
  ),
});

const TradingViewChart = dynamic(
  () => import('@/components/TradingViewChart/TradingViewChart'),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

export default function HomePage() {
  const [selectedCountry, setSelectedCountry] = useState<CountryConfig | null>(COUNTRIES['India']);
  const [quotes,          setQuotes]          = useState<IndexQuote[]>([]);
  const [quotesLoading,   setQuotesLoading]   = useState(true);

  // selectedSymbol stores the YAHOO FINANCE symbol internally (e.g. ^NSEI)
  const [selectedSymbol,  setSelectedSymbol]  = useState<string>('^NSEI');
  const [selectedName,    setSelectedName]    = useState<string>('NIFTY 50');

  // Mirror of selectedSymbol that callbacks can read without re-creating
  // themselves. This fixes a stale-closure bug: ``loadQuotes`` previously
  // captured the *initial* value of selectedSymbol and so could never detect
  // that the user had switched indices within a country.
  const selectedSymbolRef = useRef(selectedSymbol);
  useEffect(() => { selectedSymbolRef.current = selectedSymbol; }, [selectedSymbol]);

  // Derive selectedIndex ('primary' | 'secondary' | null) from selectedSymbol and selectedCountry
  const selectedIndex = selectedCountry
    ? selectedSymbol === selectedCountry.primaryIndex
      ? 'primary'
      : selectedSymbol === selectedCountry.secondaryIndex
      ? 'secondary'
      : null
    : null;

  const [chartInterval,   setChartInterval]   = useState('1D');
  const [news,            setNews]            = useState<NewsArticle[]>([]);
  const [newsLoading,     setNewsLoading]     = useState(true);
  const [backendOnline,   setBackendOnline]   = useState<boolean | null>(null);
  const [lastUpdated,     setLastUpdated]     = useState<string>('');

  // Stock search modal state. When stockModalSymbol is set, the detail modal renders.
  const [stockModalSymbol, setStockModalSymbol] = useState<string | null>(null);
  const [stockModalName,   setStockModalName]   = useState<string>('');
  const [stockModalTvSym,  setStockModalTvSym]  = useState<string | undefined>(undefined);

  // Ref for auto-scrolling to the chart section when a card is clicked
  const chartSectionRef = useRef<HTMLDivElement>(null);

  // ── Backend health check ─────────────────────────────────────────────
  const checkBackend = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      setBackendOnline(res.ok);
    } catch {
      setBackendOnline(false);
    }
  }, []);

  // ── Fetch market indices ─────────────────────────────────────────────
  const loadQuotes = useCallback(async (country: CountryConfig) => {
    setQuotesLoading(true);
    try {
      const data = await fetchIndices(country.code);
      setQuotes(data);
      setLastUpdated(new Date().toLocaleTimeString('en-IN'));
      // Keep current symbol if it belongs to the new country, else reset to primary.
      // Reads from a ref so this callback doesn't depend on selectedSymbol.
      const current = selectedSymbolRef.current;
      if (data.length > 0 && !data.find(q => q.symbol === current)) {
        const primary = country.primaryIndex || data[0].symbol;
        setSelectedSymbol(primary);
        const found = data.find(q => q.symbol === primary);
        if (found) setSelectedName(found.name);
      }
    } catch (e) {
      console.error('Failed to fetch quotes:', e);
      setQuotes([]);
    } finally {
      setQuotesLoading(false);
    }
  }, []);

  // ── Fetch news ───────────────────────────────────────────────────────
  const loadNews = useCallback(async (country: CountryConfig) => {
    setNewsLoading(true);
    try {
      const data = await fetchNews(country.code, 40);
      setNews(data);
    } catch (e) {
      console.error('Failed to fetch news:', e);
      setNews([]);
    } finally {
      setNewsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    checkBackend();
    if (selectedCountry) {
      loadQuotes(selectedCountry);
      loadNews(selectedCountry);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh quotes every 60 s
  useEffect(() => {
    const id = setInterval(() => {
      if (selectedCountry) loadQuotes(selectedCountry);
    }, 60_000);
    return () => clearInterval(id);
  }, [selectedCountry, loadQuotes]);

  // ── Handlers ─────────────────────────────────────────────────────────
  const handleCountrySelect = (country: CountryConfig) => {
    setSelectedCountry(country);
    setQuotes([]);
    // Always reset to primary index when switching countries
    setSelectedSymbol(country.primaryIndex);
    const info = SYMBOL_MAP[country.primaryIndex];
    setSelectedName(info?.name ?? country.primaryIndex);
    loadQuotes(country);
    loadNews(country);
  };

  const handleSymbolSelect = (symbol: string, name: string) => {
    setSelectedSymbol(symbol);
    setSelectedName(name);
    setChartInterval('1D');
    // Auto-scroll to chart
    setTimeout(() => {
      chartSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  // Switch between primary and secondary index for the active country
  const handleIndexToggle = (which: 'primary' | 'secondary') => {
    if (!selectedCountry) return;
    const symbol = which === 'primary'
      ? selectedCountry.primaryIndex
      : selectedCountry.secondaryIndex;
    const info = SYMBOL_MAP[symbol];
    setSelectedSymbol(symbol);
    setSelectedName(info?.name ?? symbol);
    setChartInterval('1D');
    setTimeout(() => {
      chartSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  // Open the stock detail modal from search box / trending chips.
  const handleStockSelect = (symbol: string, name: string, tradingViewSymbol?: string) => {
    setStockModalSymbol(symbol);
    setStockModalName(name);
    setStockModalTvSym(tradingViewSymbol);
  };

  const handleStockModalClose = () => {
    setStockModalSymbol(null);
    setStockModalName('');
    setStockModalTvSym(undefined);
  };

  // Derive TradingView symbol from the selected Yahoo Finance symbol
  const tvSymbol = getTradingViewSymbol(selectedSymbol) || selectedSymbol;

  // Names for the primary/secondary toggle pills
  const primaryName   = selectedCountry ? (SYMBOL_MAP[selectedCountry.primaryIndex]?.name   ?? selectedCountry.primaryIndex)   : '';
  const secondaryName = selectedCountry ? (SYMBOL_MAP[selectedCountry.secondaryIndex]?.name ?? selectedCountry.secondaryIndex) : '';

  // Compute market summary stats
  const positiveCount    = quotes.filter(q => q.change_pct > 0).length;
  const negativeCount    = quotes.filter(q => q.change_pct < 0).length;
  const overallSentiment = positiveCount > negativeCount
    ? 'bullish'
    : negativeCount > positiveCount
    ? 'bearish'
    : 'neutral';

  return (
    <main className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* ─── Top Bar ─── */}
      <header
        className="flex items-center justify-between px-6 py-3 sticky top-0 z-[100]"
        style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #4f9cf9, #8b5cf6)' }}
          >
            <Globe2 size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-sm leading-tight">Market Intelligence</h1>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              AI-Powered Financial Analytics
            </p>
          </div>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-3">
          {/* Sentiment badge */}
          {quotes.length > 0 && (
            <div
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
              style={{
                background: overallSentiment === 'bullish'
                  ? 'rgba(61,186,127,0.1)' : overallSentiment === 'bearish'
                  ? 'rgba(224,92,92,0.1)'  : 'rgba(107,118,136,0.08)',
                color: overallSentiment === 'bullish'
                  ? 'var(--gain)' : overallSentiment === 'bearish'
                  ? 'var(--loss)' : 'var(--neutral-color)',
              }}
            >
              {overallSentiment === 'bullish'
                ? <TrendingUp  size={11} />
                : overallSentiment === 'bearish'
                ? <TrendingDown size={11} />
                : <Activity size={11} />}
              {positiveCount}↑&nbsp;{negativeCount}↓
            </div>
          )}

          {lastUpdated && (
            <span className="hidden md:block text-xs" style={{ color: 'var(--text-muted)' }}>
              Updated: {lastUpdated}
            </span>
          )}

          {/* Backend status */}
          <div className="flex items-center gap-1.5">
            {backendOnline === null ? null : backendOnline ? (
              <>
                <Wifi size={12} style={{ color: 'var(--gain)' }} />
                <span className="text-xs" style={{ color: 'var(--gain)' }}>Live</span>
              </>
            ) : (
              <>
                <WifiOff size={12} style={{ color: 'var(--loss)' }} />
                <span className="text-xs hidden sm:block" style={{ color: 'var(--loss)' }}>Offline</span>
              </>
            )}
          </div>

          {/* Refresh button */}
          <button
            onClick={() => selectedCountry && loadQuotes(selectedCountry)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all hover:opacity-80"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            aria-label="Refresh market data"
          >
            <RefreshCw size={11} /> Refresh
          </button>

          {/* Country switcher */}
          <div className="flex gap-1">
            {Object.values(COUNTRIES).map(c => (
              <button
                key={c.code}
                onClick={() => handleCountrySelect(c)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                style={{
                  background: selectedCountry?.code === c.code ? 'rgba(59,158,255,0.12)' : 'var(--bg-elevated)',
                  color:      selectedCountry?.code === c.code ? 'var(--accent-blue)' : 'var(--text-muted)',
                  border:     `1px solid ${selectedCountry?.code === c.code ? 'rgba(59,158,255,0.35)' : 'transparent'}`,
                }}
                aria-label={`Switch to ${c.name}`}
              >
                {c.flag} <span className="hidden sm:inline">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ─── Main Content ─── */}
      <div className="flex flex-col lg:flex-row" style={{ minHeight: 'calc(100vh - 57px)' }}>

        {/* ── Left column: Map + Cards + Chart ── */}
        <div className="flex-1 flex flex-col overflow-y-auto min-w-0">

          {/* World Map */}
          <div style={{ height: '320px', position: 'relative', flexShrink: 0 }}>
            <WorldMap onCountrySelect={handleCountrySelect} selectedCountry={selectedCountry} />
            {/* Country overlay label */}
            {selectedCountry && (
              <div
                className="absolute bottom-4 left-4 glass rounded-xl px-4 py-3 animate-fade-in"
                style={{ zIndex: 1000 }}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-base">{selectedCountry.flag}</span>
                  <span className="text-white font-semibold text-sm">{selectedCountry.name}</span>
                </div>
                <p className="text-xs font-medium" style={{ color: selectedCountry.color }}>
                  Active: {selectedName}
                </p>
              </div>
            )}
          </div>

          {/* Stock Search + Trending */}
          <div className="px-4 pt-4">
            <StockSearchSection
              selectedCountry={selectedCountry}
              onSelect={handleStockSelect}
            />
          </div>

          {/* Index Cards */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-semibold text-sm">
                {selectedCountry?.flag} {selectedCountry?.name} Markets
              </h2>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Click a card to view chart
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {quotesLoading
                ? [...Array(4)].map((_, i) => <IndexCardSkeleton key={i} />)
                : quotes.map(q => (
                    <IndexCard
                      key={q.symbol}
                      quote={q}
                      isSelected={selectedSymbol === q.symbol}
                      onClick={() => handleSymbolSelect(q.symbol, q.name)}
                    />
                  ))}
            </div>

            {/* Backend offline + no data */}
            {!quotesLoading && quotes.length === 0 && (
              <div
                className="text-center py-10 glass rounded-xl mt-2"
                style={{ color: 'var(--text-muted)' }}
              >
                <WifiOff size={28} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">Fetching latest market activity…</p>
                <p className="text-xs mt-1">
                  {backendOnline === false
                    ? 'Backend is offline — start the FastAPI server and refresh'
                    : 'Retrying… this may take a moment'}
                </p>
                <button
                  onClick={() => selectedCountry && loadQuotes(selectedCountry)}
                  className="mt-4 flex items-center gap-1.5 mx-auto px-4 py-2 rounded-lg text-xs font-medium
                             transition-all hover:opacity-80"
                  style={{ background: 'rgba(79,156,249,0.12)', color: '#4f9cf9', border: '1px solid rgba(79,156,249,0.25)' }}
                >
                  <RefreshCw size={11} /> Try again
                </button>
              </div>
            )}
          </div>

          {/* Market Heatmap */}
          <div className="px-4 pb-2">
            <MarketHeatmap
              country={selectedCountry?.code || 'IN'}
              onStockSelect={handleStockSelect}
            />
          </div>

          {/* TradingView Chart */}
          <div className="px-4 pb-6" ref={chartSectionRef}>
            {/* Primary / Secondary index toggle */}
            {selectedCountry && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Index:</span>
                <div
                  className="flex gap-1 p-1 rounded-lg"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-subtle)' }}
                >
                  {(['primary', 'secondary'] as const).map((which) => {
                    const label = which === 'primary' ? primaryName : secondaryName;
                    const active = selectedIndex === which;
                    return (
                      <button
                        key={which}
                        id={`index-toggle-${which}`}
                        onClick={() => handleIndexToggle(which)}
                        className="px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150"
                        style={{
                          background: active ? 'rgba(59,158,255,0.1)'   : 'transparent',
                          color:      active ? 'var(--accent-blue)' : 'var(--text-muted)',
                          border:     active ? '1px solid rgba(59,158,255,0.3)' : '1px solid transparent',
                        }}
                        aria-label={`Show ${label}`}
                        aria-pressed={active}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <TradingViewChart
              symbol={tvSymbol}
              name={selectedName}
              interval={chartInterval}
              onIntervalChange={setChartInterval}
            />
          </div>
        </div>

        {/* ── Right column: AI Panel + News ── */}
        <div
          className="right-panel flex flex-col gap-4 p-4 overflow-y-auto"
          style={{
            width: '100%',
            flexShrink: 0,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <AIInsightPanel country={selectedCountry?.code || 'IN'} />
          <div className="flex-1" style={{ minHeight: '400px' }}>
            <NewsPanel articles={news} isLoading={newsLoading} />
          </div>
        </div>
      </div>

      {/* ── Stock Detail Modal ── */}
      {stockModalSymbol && (
        <StockDetailModal
          symbol={stockModalSymbol}
          name={stockModalName}
          tradingViewSymbol={stockModalTvSym}
          onClose={handleStockModalClose}
        />
      )}
    </main>
  );
}
