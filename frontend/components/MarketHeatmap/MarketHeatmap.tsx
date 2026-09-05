'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Layers,
  LayoutGrid, List, Info, X,
} from 'lucide-react';
import type { HeatmapCell } from '@/lib/api';
import { fetchHeatmap } from '@/lib/api';

// ── Colour helpers ─────────────────────────────────────────────────────────────
const SECTOR_COLORS: Record<string, string> = {
  Technology:        '#6366f1',
  Financials:        '#0ea5e9',
  Communication:     '#8b5cf6',
  'Consumer Disc.':  '#f59e0b',
  'Health Care':     '#10b981',
  Energy:            '#ef4444',
  Industrials:       '#64748b',
  'Consumer Staples':'#84cc16',
  Materials:         '#f97316',
  Utilities:         '#06b6d4',
  'Real Estate':     '#ec4899',
};

function changePctToColor(pct: number | null): string {
  if (pct === null || isNaN(pct)) return 'rgba(30,42,58,0.8)';
  const abs = Math.abs(pct);
  if (pct > 0) {
    if (abs >= 3)  return 'rgba(4,120,87,0.92)';   // dark green
    if (abs >= 2)  return 'rgba(5,150,105,0.85)';
    if (abs >= 1)  return 'rgba(16,185,129,0.78)';
    if (abs >= 0.5)return 'rgba(52,211,153,0.7)';
    return                 'rgba(110,231,183,0.55)'; // light green
  } else {
    if (abs >= 3)  return 'rgba(153,27,27,0.92)';   // dark red
    if (abs >= 2)  return 'rgba(185,28,28,0.85)';
    if (abs >= 1)  return 'rgba(239,68,68,0.78)';
    if (abs >= 0.5)return 'rgba(248,113,113,0.7)';
    return                 'rgba(252,165,165,0.55)'; // light red
  }
}

function textColorForBg(pct: number | null): string {
  if (pct === null) return '#8b9cb8';
  const abs = Math.abs(pct);
  return abs >= 1 ? '#ffffff' : (pct >= 0 ? '#d1fae5' : '#fee2e2');
}

function fmtPct(v: number | null) {
  if (v === null || isNaN(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function fmtPrice(v: number | null, currency: string) {
  if (v === null) return '—';
  const sym = currency === 'INR' ? '₹' : currency === 'GBP' ? '£' : currency === 'JPY' ? '¥' : '$';
  if (v >= 1000) return `${sym}${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  return `${sym}${v.toFixed(2)}`;
}

function fmtCap(v: number | null) {
  if (!v) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface Props {
  country: string;
  onStockSelect?: (symbol: string, name: string) => void;
}

// ── Tooltip ────────────────────────────────────────────────────────────────────
function Tooltip({
  cell,
  x, y,
  onClose,
}: {
  cell: HeatmapCell;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const pct = cell.change_pct;
  const isUp = (pct ?? 0) >= 0;
  const accentColor = isUp ? '#10b981' : '#ef4444';

  return (
    <div
      className="fixed z-[9999] pointer-events-none animate-fade-in"
      style={{
        left: Math.min(x + 12, window.innerWidth - 260),
        top:  Math.min(y - 10, window.innerHeight - 220),
        width: 240,
      }}
    >
      <div
        className="rounded-xl p-3 shadow-2xl"
        style={{
          background: 'rgba(8,12,24,0.97)',
          border: `1px solid ${accentColor}40`,
          backdropFilter: 'blur(16px)',
          boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px ${accentColor}20`,
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="text-white font-bold text-sm leading-tight">{cell.name}</p>
            <p className="text-[10px] mt-0.5 font-mono" style={{ color: '#8b9cb8' }}>{cell.symbol}</p>
          </div>
          <div
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
            style={{ background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}30` }}
          >
            {isUp ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
            {fmtPct(pct)}
          </div>
        </div>

        {/* Sector tag */}
        <div className="mb-2.5">
          <span
            className="text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider"
            style={{
              background: `${SECTOR_COLORS[cell.sector] ?? '#6366f1'}20`,
              color:       SECTOR_COLORS[cell.sector] ?? '#6366f1',
            }}
          >
            {cell.sector}
          </span>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {[
            ['Price',   fmtPrice(cell.price, cell.currency)],
            ['Change',  cell.change != null ? (cell.change >= 0 ? '+' : '') + cell.change.toFixed(2) : '—'],
            ['Open',    fmtPrice(cell.open,  cell.currency)],
            ['High',    fmtPrice(cell.high,  cell.currency)],
            ['Low',     fmtPrice(cell.low,   cell.currency)],
            ['Mkt Cap', fmtCap(cell.market_cap)],
          ].map(([label, val]) => (
            <div key={label}>
              <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: '#4a5568' }}>{label}</p>
              <p
                className="text-xs font-mono font-semibold"
                style={{ color: label === 'Change' ? accentColor : '#e8edf5' }}
              >
                {val}
              </p>
            </div>
          ))}
        </div>

        <p className="text-[9px] mt-2 pt-2 border-t" style={{ color: '#4a5568', borderColor: 'rgba(255,255,255,0.06)' }}>
          Click to open stock detail
        </p>
      </div>
    </div>
  );
}

// ── Single heatmap cell ────────────────────────────────────────────────────────
function HeatCell({
  cell,
  size,
  onHover,
  onLeave,
  onClick,
}: {
  cell: HeatmapCell;
  size: 'xs' | 'sm' | 'md' | 'lg';
  onHover: (cell: HeatmapCell, x: number, y: number) => void;
  onLeave: () => void;
  onClick: (cell: HeatmapCell) => void;
}) {
  const bg   = changePctToColor(cell.change_pct);
  const text = textColorForBg(cell.change_pct);
  const pct  = cell.change_pct;

  const sizeStyles: Record<string, React.CSSProperties> = {
    xs: { minHeight: 52, fontSize: 9  },
    sm: { minHeight: 64, fontSize: 10 },
    md: { minHeight: 76, fontSize: 11 },
    lg: { minHeight: 88, fontSize: 12 },
  };

  return (
    <div
      className="relative flex flex-col items-center justify-center rounded-lg cursor-pointer
                 transition-all duration-200 select-none group overflow-hidden"
      style={{
        background: bg,
        ...sizeStyles[size],
        border: '1px solid rgba(255,255,255,0.08)',
      }}
      onMouseEnter={e => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onHover(cell, rect.right, rect.top);
        (e.currentTarget as HTMLElement).style.transform = 'scale(1.04)';
        (e.currentTarget as HTMLElement).style.zIndex = '10';
        (e.currentTarget as HTMLElement).style.boxShadow = `0 0 18px ${changePctToColor(pct)}90, inset 0 0 0 1px rgba(255,255,255,0.18)`;
      }}
      onMouseLeave={e => {
        onLeave();
        (e.currentTarget as HTMLElement).style.transform = '';
        (e.currentTarget as HTMLElement).style.zIndex = '';
        (e.currentTarget as HTMLElement).style.boxShadow = '';
      }}
      onClick={() => onClick(cell)}
      aria-label={`${cell.name}: ${fmtPct(pct)}`}
    >
      {/* Subtle gradient overlay for depth */}
      <div
        className="absolute inset-0 rounded-lg pointer-events-none"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, transparent 60%)' }}
      />

      <p
        className="font-semibold text-center leading-tight px-1 relative z-10"
        style={{ color: text, fontSize: sizeStyles[size].fontSize }}
      >
        {cell.name}
      </p>
      <p
        className="font-mono font-bold relative z-10 mt-0.5"
        style={{ color: text, fontSize: (sizeStyles[size].fontSize as number) + 1 }}
      >
        {fmtPct(pct)}
      </p>
      {(size === 'md' || size === 'lg') && (
        <p
          className="font-mono relative z-10 opacity-70 mt-0.5"
          style={{ color: text, fontSize: (sizeStyles[size].fontSize as number) - 1 }}
        >
          {fmtPrice(cell.price, cell.currency)}
        </p>
      )}
    </div>
  );
}

// ── Legend ─────────────────────────────────────────────────────────────────────
function Legend() {
  const stops = [
    { label: '≥+3%', color: 'rgba(4,120,87,0.92)' },
    { label: '+1%',  color: 'rgba(16,185,129,0.78)' },
    { label: '0%',   color: 'rgba(30,42,58,0.8)' },
    { label: '-1%',  color: 'rgba(239,68,68,0.78)' },
    { label: '≤-3%', color: 'rgba(153,27,27,0.92)' },
  ];
  return (
    <div className="flex items-center gap-2">
      {stops.map(s => (
        <div key={s.label} className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm" style={{ background: s.color, border: '1px solid rgba(255,255,255,0.1)' }} />
          <span className="text-[9px]" style={{ color: '#4a5568' }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function MarketHeatmap({ country, onStockSelect }: Props) {
  const [cells,     setCells]     = useState<HeatmapCell[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<string>('');
  const [tooltip,   setTooltip]   = useState<{ cell: HeatmapCell; x: number; y: number } | null>(null);
  const [viewMode,  setViewMode]  = useState<'grid' | 'list'>('grid');
  const [filter,    setFilter]    = useState<string>('All');
  const tooltipTimeout            = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHeatmap(country);
      setCells(data.cells);
      setLastFetch(new Date().toLocaleTimeString('en-IN'));
    } catch (e) {
      console.error('[Heatmap] fetch failed:', e);
      setError('Failed to load heatmap data');
    } finally {
      setLoading(false);
    }
  }, [country]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(() => load(), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const handleHover = useCallback((cell: HeatmapCell, x: number, y: number) => {
    if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
    setTooltip({ cell, x, y });
  }, []);

  const handleLeave = useCallback(() => {
    tooltipTimeout.current = setTimeout(() => setTooltip(null), 120);
  }, []);

  const handleClick = useCallback((cell: HeatmapCell) => {
    onStockSelect?.(cell.symbol, cell.name);
  }, [onStockSelect]);

  // Unique sectors for filter bar
  const sectors = ['All', ...Array.from(new Set(cells.map(c => c.sector)))];
  const filtered = filter === 'All' ? cells : cells.filter(c => c.sector === filter);

  // Group filtered cells by sector for grid view
  const bySector = filtered.reduce<Record<string, HeatmapCell[]>>((acc, cell) => {
    (acc[cell.sector] ||= []).push(cell);
    return acc;
  }, {});

  // Dynamic cell size based on count
  const getCellSize = (count: number): 'xs' | 'sm' | 'md' | 'lg' => {
    if (count <= 6)  return 'lg';
    if (count <= 12) return 'md';
    if (count <= 18) return 'sm';
    return 'xs';
  };

  // ── Skeleton ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="glass rounded-xl flex flex-col"
        style={{ border: '1px solid rgba(255,255,255,0.06)', minHeight: 420 }}
      >
        <div
          className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <Layers size={14} style={{ color: '#4f9cf9' }} />
          <h2 className="text-white font-semibold text-sm">Market Heatmap</h2>
          <div className="ml-auto w-3 h-3 rounded-full border-2 border-t-transparent animate-spin"
               style={{ borderColor: '#4f9cf9', borderTopColor: 'transparent' }} />
        </div>
        <div className="flex-1 p-4 grid grid-cols-4 gap-2 auto-rows-fr">
          {[...Array(20)].map((_, i) => (
            <div key={i} className="skeleton rounded-lg" style={{ minHeight: 64 }} />
          ))}
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div
        className="glass rounded-xl flex flex-col items-center justify-center"
        style={{ border: '1px solid rgba(255,255,255,0.06)', minHeight: 220 }}
      >
        <Info size={24} style={{ color: '#ef4444', opacity: 0.6 }} className="mb-2" />
        <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>
        <button
          onClick={load}
          className="mt-3 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
          style={{ background: 'rgba(79,156,249,0.12)', color: '#4f9cf9', border: '1px solid rgba(79,156,249,0.25)' }}
        >
          <RefreshCw size={11} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div
      className="glass rounded-xl flex flex-col"
      style={{ border: '1px solid rgba(255,255,255,0.06)', minHeight: 420 }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0 flex-wrap gap-y-1.5"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <Layers size={14} style={{ color: '#4f9cf9' }} />
        <h2 className="text-white font-semibold text-sm">Market Heatmap</h2>
        <span
          className="text-[9px] px-2 py-0.5 rounded-full font-semibold"
          style={{ background: 'rgba(79,156,249,0.12)', color: '#4f9cf9', border: '1px solid rgba(79,156,249,0.25)' }}
        >
          {cells.length} stocks
        </span>

        <div className="ml-auto flex items-center gap-2">
          {lastFetch && (
            <span className="hidden sm:block text-[9px]" style={{ color: '#4a5568' }}>
              {lastFetch}
            </span>
          )}

          {/* Grid / List toggle */}
          <div
            className="flex gap-0.5 p-0.5 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            {([['grid', LayoutGrid], ['list', List]] as const).map(([mode, Icon]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className="p-1 rounded-md transition-all"
                style={{
                  background: viewMode === mode ? 'rgba(79,156,249,0.2)' : 'transparent',
                  color: viewMode === mode ? '#4f9cf9' : '#4a5568',
                }}
                aria-label={`${mode} view`}
              >
                <Icon size={12} />
              </button>
            ))}
          </div>

          <button
            onClick={load}
            className="p-1.5 rounded-lg transition-all hover:opacity-70"
            style={{ background: 'rgba(255,255,255,0.04)', color: '#4a5568' }}
            aria-label="Refresh heatmap"
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {/* ── Sector filter chips ── */}
      <div
        className="flex gap-1.5 px-4 py-2 overflow-x-auto flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', scrollbarWidth: 'none' }}
      >
        {sectors.map(s => {
          const active = filter === s;
          const color  = s === 'All' ? '#4f9cf9' : (SECTOR_COLORS[s] ?? '#6366f1');
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className="flex-shrink-0 text-[10px] font-medium px-2.5 py-1 rounded-full transition-all duration-150"
              style={{
                background: active ? `${color}22` : 'rgba(255,255,255,0.03)',
                color:       active ? color : '#4a5568',
                border:      active ? `1px solid ${color}50` : '1px solid rgba(255,255,255,0.05)',
              }}
            >
              {s}
            </button>
          );
        })}
      </div>

      {/* ── Legend ── */}
      <div className="px-4 py-1.5 flex-shrink-0 flex items-center justify-between">
        <Legend />
        <span className="text-[9px]" style={{ color: '#4a5568' }}>Click a cell to open stock</span>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ minHeight: 0 }}>
        {viewMode === 'grid' ? (
          /* GRID VIEW — grouped by sector */
          <div className="space-y-3">
            {Object.entries(bySector).map(([sector, sectorCells]) => {
              const sColor = SECTOR_COLORS[sector] ?? '#6366f1';
              const size   = getCellSize(sectorCells.length);
              const avgPct = sectorCells.reduce((s, c) => s + (c.change_pct ?? 0), 0) / sectorCells.length;
              return (
                <div key={sector}>
                  {/* Sector label */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sColor }} />
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: sColor }}>
                      {sector}
                    </span>
                    <span
                      className="text-[9px] font-mono"
                      style={{ color: avgPct >= 0 ? '#10b981' : '#ef4444' }}
                    >
                      avg {fmtPct(avgPct)}
                    </span>
                  </div>

                  <div
                    className="grid gap-1.5"
                    style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size === 'xs' ? 72 : size === 'sm' ? 80 : size === 'md' ? 90 : 108}px, 1fr))` }}
                  >
                    {sectorCells.map(cell => (
                      <HeatCell
                        key={cell.symbol}
                        cell={cell}
                        size={size}
                        onHover={handleHover}
                        onLeave={handleLeave}
                        onClick={handleClick}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* LIST VIEW */
          <div className="space-y-1">
            {filtered.map(cell => {
              const isUp = (cell.change_pct ?? 0) >= 0;
              const accentColor = isUp ? '#10b981' : '#ef4444';
              const sColor = SECTOR_COLORS[cell.sector] ?? '#6366f1';
              return (
                <div
                  key={cell.symbol}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer
                             transition-all duration-150 hover:bg-white/[0.04] group"
                  style={{ border: '1px solid rgba(255,255,255,0.04)' }}
                  onClick={() => handleClick(cell)}
                >
                  {/* Color indicator */}
                  <div
                    className="w-1 h-8 rounded-full flex-shrink-0"
                    style={{ background: changePctToColor(cell.change_pct) }}
                  />

                  {/* Name + sector */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{cell.name}</p>
                    <p className="text-[9px] truncate" style={{ color: sColor }}>{cell.sector}</p>
                  </div>

                  {/* Price */}
                  <div className="text-right">
                    <p className="text-xs font-mono text-white">{fmtPrice(cell.price, cell.currency)}</p>
                    <p className="text-[9px] font-mono" style={{ color: '#4a5568' }}>{cell.symbol}</p>
                  </div>

                  {/* Change */}
                  <div
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-mono font-bold w-20 justify-center flex-shrink-0"
                    style={{ background: `${accentColor}12`, color: accentColor, border: `1px solid ${accentColor}20` }}
                  >
                    {isUp ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                    {fmtPct(cell.change_pct)}
                  </div>

                  {/* Market cap */}
                  <div className="hidden sm:block text-right w-16 flex-shrink-0">
                    <p className="text-[9px]" style={{ color: '#4a5568' }}>Cap</p>
                    <p className="text-[10px] font-mono" style={{ color: '#8b9cb8' }}>{fmtCap(cell.market_cap)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating tooltip */}
      {tooltip && (
        <Tooltip
          cell={tooltip.cell}
          x={tooltip.x}
          y={tooltip.y}
          onClose={() => setTooltip(null)}
        />
      )}
    </div>
  );
}
