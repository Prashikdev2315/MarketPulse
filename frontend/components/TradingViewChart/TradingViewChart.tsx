'use client';

import { useEffect, useRef, useState, useCallback, useId } from 'react';
import { Maximize2, Minimize2, RefreshCw, AlertCircle } from 'lucide-react';
import { getTradingViewSymbol, getSymbolTimezone } from '@/lib/symbolMap';

interface Props {
  symbol: string;       // Yahoo Finance symbol e.g. ^NSEI  OR TradingView symbol e.g. NSE:NIFTY
  name: string;
  interval?: string;    // 1D, 1W, 1M, 6M, 1Y, MAX
  onIntervalChange?: (interval: string) => void;
  /** When true, delays widget init by 400 ms to let the modal open animation settle. */
  isModal?: boolean;
}

const TIMEFRAMES = [
  { label: '1D', value: '1D' },
  { label: '1W', value: '1W' },
  { label: '1M', value: '1M' },
  { label: '6M', value: '6M' },
  { label: '1Y', value: '1Y' },
  { label: 'MAX', value: 'MAX' },
];

/**
 * Maps UI timeframe to TradingView widget config:
 *   interval = candlestick period (e.g. 'D' for daily candles)
 *   range    = date window shown  (e.g. '6M' to show 6 months)
 *
 * These are SEPARATE keys in the TradingView widget config.
 */
const RANGE_CONFIG: Record<string, { interval: string; range: string }> = {
  '1D':  { interval: '5',  range: '1D'  },
  '1W':  { interval: '60', range: '5D'  },
  '1M':  { interval: 'D',  range: '1M'  },
  '6M':  { interval: 'D',  range: '6M'  },
  '1Y':  { interval: 'D',  range: '12M' },
  'MAX': { interval: 'W',  range: 'ALL' },
};

const CHART_HEIGHT        = 560; // px — explicit height in the main dashboard
const CHART_HEIGHT_MODAL  = 400; // px — shorter height inside the modal

declare global {
  interface Window {
    TradingView?: {
      widget: new (config: Record<string, unknown>) => unknown;
    };
  }
}

export default function TradingViewChart({ symbol, name, interval = '1D', onIntervalChange, isModal = false }: Props) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen]   = useState(false);
  const [isLoading, setIsLoading]         = useState(true);
  const [hasError, setHasError]           = useState(false);
  const [currentInterval, setCurrentInterval] = useState(interval);
  const [scriptLoaded, setScriptLoaded]   = useState(false);

  // Each chart instance gets its own stable, unique DOM id so that multiple
  // TradingView widgets on the page (main dashboard + modal) never collide.
  const uid = useId();
  const containerId = `tv_chart_${uid.replace(/:/g, '_')}`;

  // Derive the TradingView symbol — accepts both Yahoo (^NSEI) and TV (NSE:NIFTY50) formats
  const tvSymbol = symbol.includes(':') ? symbol : getTradingViewSymbol(symbol);
  // Derive the correct timezone for this symbol (avoids hardcoded Asia/Kolkata for US/UK/JP)
  const tvTimezone = getSymbolTimezone(symbol);

  // Load the TradingView tv.js script once
  useEffect(() => {
    const scriptId = 'tradingview-tv-js';
    const existingScript = document.getElementById(scriptId);

    if (existingScript) {
      if (window.TradingView) {
        setScriptLoaded(true);
      } else {
        existingScript.addEventListener('load', () => setScriptLoaded(true));
      }
      return;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://s3.tradingview.com/tv.js';
    script.type = 'text/javascript';
    script.async = true;
    script.onload = () => setScriptLoaded(true);
    script.onerror = () => {
      console.error('[TradingView] Failed to load tv.js');
      setHasError(true);
      setIsLoading(false);
    };

    document.head.appendChild(script);
  }, []);


  const loadWidget = useCallback(() => {
    if (!scriptLoaded || !containerRef.current) return;

    setIsLoading(true);
    setHasError(false);

    // Clear container content
    containerRef.current.innerHTML = '';

    // Create unique container div for tv.js widget injection
    const widgetDiv = document.createElement('div');
    widgetDiv.id = containerId;
    widgetDiv.style.width = '100%';
    widgetDiv.style.height = '100%';
    containerRef.current.appendChild(widgetDiv);

    const { interval: tvInterval, range } = RANGE_CONFIG[currentInterval] ?? RANGE_CONFIG['1D'];

    try {
      new window.TradingView.widget({
        autosize:            true,
        symbol:              tvSymbol,
        interval:            tvInterval,
        range:               range,
        timezone:            tvTimezone,
        theme:               'dark',
        style:               '1',        // 1 = Candlestick
        locale:              'en',
        container_id:        containerId,
        hide_top_toolbar:    false,
        hide_legend:         false,
        allow_symbol_change: true,
        save_image:          true,
        calendar:            false,
        withdateranges:      true,
        hide_side_toolbar:   false,
        details:             true,
        hotlist:             false,
        studies:             ['MASimple@tv-basicstudies', 'RSI@tv-basicstudies'],
      });

      // Hide loading state after the iframe is generated
      setTimeout(() => setIsLoading(false), 1200);
    } catch (e) {
      console.error('[TradingView] Failed to initialize widget:', e);
      setIsLoading(false);
      setHasError(true);
    }
  }, [scriptLoaded, tvSymbol, currentInterval, tvTimezone, containerId]);

  // Reinitialize whenever symbol, script loaded state, or interval changes.
  // When inside a modal we wait an extra 600 ms so the scale-in CSS animation
  // finishes and the container has its real pixel dimensions before tv.js
  // queries them (otherwise the iframe renders with 0×0 and stays blank).
  useEffect(() => {
    if (!scriptLoaded) return;
    if (isModal) {
      const t = setTimeout(() => loadWidget(), 600);
      return () => clearTimeout(t);
    }
    loadWidget();
  }, [scriptLoaded, tvSymbol, currentInterval, loadWidget, isModal]);

  const handleIntervalChange = (tf: string) => {
    setCurrentInterval(tf);
    onIntervalChange?.(tf);
  };

  const toggleFullscreen = () => setIsFullscreen(f => !f);

  const chartH = isFullscreen
    ? 'calc(100vh - 110px)'
    : `${isModal ? CHART_HEIGHT_MODAL : CHART_HEIGHT}px`;

  return (
    <div
      className={`flex flex-col glass rounded-xl transition-all duration-300 ${
        isFullscreen ? 'fixed inset-4 z-[9999] rounded-xl' : 'relative'
      }`}
      style={{ overflow: 'hidden' }}
    >
      {/* ─── Chart Header ─── */}
      <div
        className="flex items-center justify-between px-5 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-white font-bold text-base">{name}</h2>
              <span
                className="text-[10px] px-2 py-0.5 rounded font-mono"
                style={{ background: 'rgba(79,156,249,0.15)', color: '#4f9cf9', border: '1px solid rgba(79,156,249,0.3)' }}
              >
                {tvSymbol}
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              TradingView Advanced Chart · Live Data
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Timeframe selector */}
          <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
            {TIMEFRAMES.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => handleIntervalChange(value)}
                className="px-3 py-1 rounded text-xs font-mono font-medium transition-all duration-150"
                style={{
                  background: currentInterval === value ? 'var(--accent-blue)' : 'transparent',
                  color: currentInterval === value ? 'white' : 'var(--text-muted)',
                }}
                aria-label={`Show ${label} chart`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button
            onClick={loadWidget}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-all hover:bg-white/10"
            style={{ background: 'rgba(255,255,255,0.06)' }}
            title="Refresh chart"
            aria-label="Refresh chart"
          >
            <RefreshCw size={13} style={{ color: 'var(--text-secondary)' }} />
          </button>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-all hover:bg-white/10"
            style={{ background: 'rgba(255,255,255,0.06)' }}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen
              ? <Minimize2 size={13} style={{ color: 'var(--text-secondary)' }} />
              : <Maximize2 size={13} style={{ color: 'var(--text-secondary)' }} />
            }
          </button>
        </div>
      </div>

      {/* ─── Chart Area — EXPLICIT pixel height to prevent flex-collapse ─── */}
      <div
        className="relative flex-shrink-0"
        style={{
          height: chartH,
          width: '100%',
          background: '#0a0e1a',  // visible background so failures are obvious
        }}
      >
        {/* Loading skeleton */}
        {isLoading && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4"
            style={{ background: 'rgba(10,14,26,0.95)' }}
          >
            <div className="w-full h-full p-6 flex flex-col gap-3 pointer-events-none">
              <div className="skeleton h-5 w-52 rounded mb-2" />
              <div className="flex gap-2 mb-4">
                {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-3 w-16 rounded" />)}
              </div>
              <div className="flex-1 skeleton rounded-lg" style={{ minHeight: 300 }} />
              <div className="skeleton h-3 w-full rounded" />
              <div className="skeleton h-3 w-3/4 rounded" />
            </div>
            <div className="absolute bottom-8 flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
                   style={{ borderColor: '#4f9cf9', borderTopColor: 'transparent' }} />
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading chart…</p>
            </div>
          </div>
        )}

        {/* Error state */}
        {hasError && !isLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3"
               style={{ background: 'rgba(10,14,26,0.95)' }}>
            <AlertCircle size={32} style={{ color: '#ef4444', opacity: 0.6 }} />
            <p className="text-sm font-medium text-white/70">Chart failed to load</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Check network or Content Security Policy
            </p>
            <button
              onClick={loadWidget}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
              style={{ background: 'rgba(79,156,249,0.15)', color: '#4f9cf9', border: '1px solid rgba(79,156,249,0.3)' }}
            >
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        )}

        {/*
          TradingView widget container.
          The script appended inside here creates the iframe as a sibling.
          CSS in globals.css ensures the iframe fills 100% height/width.
        */}
        <div
          ref={containerRef}
          className="tradingview-widget-container"
          style={{ height: '100%', width: '100%' }}
        />
      </div>

      {/* ─── Footer ─── */}
      <div
        className="px-5 py-2 flex items-center justify-between flex-shrink-0"
        style={{ borderTop: '1px solid var(--border-subtle)', background: 'rgba(10,14,26,0.5)' }}
      >
        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          Powered by TradingView · Data may be delayed 15 minutes
        </p>
        <a
          href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] hover:underline transition-all"
          style={{ color: 'var(--accent-blue)' }}
        >
          Open in TradingView ↗
        </a>
      </div>
    </div>
  );
}
