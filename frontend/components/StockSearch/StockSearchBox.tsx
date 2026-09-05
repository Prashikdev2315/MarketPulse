'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2, TrendingUp, Building2, WifiOff, AlertCircle } from 'lucide-react';
import type { StockSearchResult } from '@/lib/api';
import { searchStocks, isConnectionError, userMessage, ApiError } from '@/lib/api';
import { StockSearchResultsSkeleton } from '@/components/ui/LoadingSkeleton';

interface Props {
  country?: string;
  onSelect: (symbol: string, name: string, tradingViewSymbol: string) => void;
  autoFocus?: boolean;
}

type SearchErrorKind = 'network' | 'api' | null;

interface SearchState {
  results: StockSearchResult[];
  loading: boolean;
  errorKind: SearchErrorKind;
  errorMsg: string | null;
  lastQuery: string;
}

const INITIAL_STATE: SearchState = {
  results: [],
  loading: false,
  errorKind: null,
  errorMsg: null,
  lastQuery: '',
};

export default function StockSearchBox({ country, onSelect, autoFocus }: Props) {
  const [query, setQuery]                       = useState('');
  const [state, setState]                       = useState<SearchState>(INITIAL_STATE);
  const [isOpen, setIsOpen]                     = useState(false);
  const [activeIdx, setActiveIdx]               = useState(-1);
  const [retryCount, setRetryCount]             = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef     = useRef(0); // guards against out-of-order responses

  const MAX_RETRIES = 3;

  // ── Core search function ──────────────────────────────────────────────────
  const runSearch = useCallback(async (q: string, isRetry = false) => {
    const trimmed = q.trim();
    if (trimmed.length < 1) {
      setState(INITIAL_STATE);
      return;
    }

    setState(prev => ({
      ...prev,
      loading: true,
      errorKind: null,
      errorMsg: null,
      lastQuery: trimmed,
    }));

    const myId = ++reqIdRef.current;
    try {
      const data = await searchStocks(trimmed, country);
      if (myId !== reqIdRef.current) return; // stale response, discard
      setState(prev => ({
        ...prev,
        results: data,
        loading: false,
        errorKind: null,
        errorMsg: null,
      }));
      setActiveIdx(data.length > 0 ? 0 : -1);
      if (isRetry) setRetryCount(0);
    } catch (e) {
      if (myId !== reqIdRef.current) return;
      const kind: SearchErrorKind = isConnectionError(e) ? 'network' : 'api';
      const msg = kind === 'network'
        ? 'Connection issue — check your network or the backend server.'
        : (e instanceof ApiError ? userMessage(e) : 'Search failed. Please try again.');
      setState(prev => ({ ...prev, loading: false, errorKind: kind, errorMsg: msg, results: [] }));
    }
  }, [country]);

  // ── Retry handler ─────────────────────────────────────────────────────────
  const handleRetry = () => {
    if (retryCount >= MAX_RETRIES) return;
    setRetryCount(c => c + 1);
    runSearch(state.lastQuery || query, true);
  };

  // ── Input change / debounce ───────────────────────────────────────────────
  const handleChange = (val: string) => {
    setQuery(val);
    setIsOpen(true);
    setRetryCount(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val), 300);
  };

  // ── Keyboard navigation ───────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' && state.results.length > 0) setIsOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, state.results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = state.results[activeIdx];
      if (picked) pick(picked);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const pick = (r: StockSearchResult) => {
    onSelect(r.symbol, r.name, r.tradingViewSymbol);
    setQuery('');
    setState(INITIAL_STATE);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const clear = () => {
    setQuery('');
    setState(INITIAL_STATE);
    setIsOpen(false);
    setRetryCount(0);
    inputRef.current?.focus();
  };

  // ── Click-outside to close ────────────────────────────────────────────────
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const { results, loading, errorKind, errorMsg, lastQuery } = state;
  const showDropdown = isOpen && query.trim().length > 0;
  const canRetry = retryCount < MAX_RETRIES;

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Input */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all"
        style={{
          background: 'var(--bg-elevated)',
          border: isOpen
            ? '1px solid rgba(79,156,249,0.4)'
            : errorKind
            ? '1px solid rgba(239,68,68,0.35)'
            : '1px solid var(--border-subtle)',
        }}
      >
        <Search size={14} style={{ color: 'var(--text-muted)' }} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          autoFocus={autoFocus}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search any stock — e.g. Reliance, AAPL, Tesla…"
          className="flex-1 bg-transparent text-sm text-white placeholder:text-[var(--text-muted)] outline-none min-w-0"
          aria-label="Search stocks"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls="stock-search-listbox"
          aria-autocomplete="list"
        />
        {loading && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent-blue)' }} />}
        {query && !loading && (
          <button onClick={clear} aria-label="Clear search" className="hover:opacity-70">
            <X size={14} style={{ color: 'var(--text-muted)' }} />
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {showDropdown && (
        <div
          id="stock-search-listbox"
          role="listbox"
          className="absolute left-0 right-0 mt-1.5 glass rounded-xl overflow-hidden animate-scale-in z-[1000]"
          style={{
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            maxHeight: '380px',
            overflowY: 'auto',
          }}
        >
          {/* Loading skeleton */}
          {loading && <StockSearchResultsSkeleton />}

          {/* ── Network / Connection error ── */}
          {!loading && errorKind === 'network' && (
            <div className="px-4 py-6 text-center space-y-2">
              <WifiOff size={22} className="mx-auto opacity-60" style={{ color: '#ef4444' }} />
              <p className="text-sm font-medium" style={{ color: '#ef4444' }}>
                Connection issue
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {errorMsg}
              </p>
              {canRetry && (
                <button
                  onClick={handleRetry}
                  className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                  style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}
                >
                  Retry ({MAX_RETRIES - retryCount} left)
                </button>
              )}
              {!canRetry && (
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  Max retries reached — check your connection.
                </p>
              )}
            </div>
          )}

          {/* ── API / server error ── */}
          {!loading && errorKind === 'api' && (
            <div className="px-4 py-6 text-center space-y-2">
              <AlertCircle size={22} className="mx-auto opacity-60" style={{ color: '#f59e0b' }} />
              <p className="text-sm font-medium" style={{ color: '#f59e0b' }}>
                Search error
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {errorMsg ?? 'The search service returned an error.'}
              </p>
              {canRetry && (
                <button
                  onClick={handleRetry}
                  className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                  style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)' }}
                >
                  Retry ({MAX_RETRIES - retryCount} left)
                </button>
              )}
            </div>
          )}

          {/* ── No results found ── */}
          {!loading && !errorKind && results.length === 0 && lastQuery && (
            <div className="px-4 py-6 text-center space-y-1">
              <Building2 size={22} className="mx-auto mb-2 opacity-40" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm font-medium text-white/70">
                No results found for &ldquo;{lastQuery}&rdquo;
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Try the full company name, a different ticker, or include the exchange suffix (e.g.&nbsp;RELIANCE.NS)
              </p>
            </div>
          )}

          {/* ── Results list ── */}
          {!loading && !errorKind && results.length > 0 && (
            <>
              {results.map((r, i) => (
                <button
                  key={`${r.symbol}-${i}`}
                  role="option"
                  aria-selected={i === activeIdx}
                  onClick={() => pick(r)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                  style={{
                    background: i === activeIdx ? 'rgba(79,156,249,0.08)' : 'transparent',
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(79,156,249,0.12)' }}
                  >
                    <Building2 size={14} style={{ color: 'var(--accent-blue)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{r.name}</p>
                    <p className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                      {r.symbol} · {r.exchange || r.country}
                    </p>
                  </div>
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                    style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}
                  >
                    {r.country}
                  </span>
                </button>
              ))}
              <div
                className="px-3 py-1.5 text-[9px] flex items-center gap-1"
                style={{ background: 'rgba(255,255,255,0.02)', color: 'var(--text-muted)' }}
              >
                <TrendingUp size={9} /> Powered by Yahoo Search
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
