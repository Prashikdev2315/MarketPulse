'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { IndexQuote } from '@/lib/api';
import SparklineChart from './SparklineChart';

interface Props {
  quote: IndexQuote;
  onClick?: () => void;
  isSelected?: boolean;
}

function formatNumber(n: number): string {
  if (!n) return 'N/A';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatVolume(v: number): string {
  if (!v || v === 0) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toString();
}

function DayRangeBar({ low, high, current }: { low: number; high: number; current: number }) {
  const range = high - low || 1;
  const pos = Math.max(0, Math.min(100, ((current - low) / range) * 100));
  return (
    <div className="flex items-center gap-1.5 mt-2">
      <span className="text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>{formatNumber(low)}</span>
      <div className="flex-1 h-1 rounded-full relative" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div
          className="absolute top-0 h-full rounded-full"
          style={{ width: `${pos}%`, background: 'linear-gradient(90deg, var(--gain), var(--accent-blue))' }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border-2 border-white"
          style={{ left: `calc(${pos}% - 4px)`, background: 'var(--accent-blue)' }}
        />
      </div>
      <span className="text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>{formatNumber(high)}</span>
    </div>
  );
}

export default function IndexCard({ quote, onClick, isSelected }: Props) {
  const isPositive = quote.change_pct > 0;
  const isNegative = quote.change_pct < 0;
  const changeColor = isPositive ? 'var(--gain)' : isNegative ? 'var(--loss)' : 'var(--neutral-color)';
  const sparklineColor = isPositive ? '#3DBA7F' : isNegative ? '#E05C5C' : '#6B7688';
  const TrendIcon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;

  // Simple sparkline from OHLC (open -> high -> low -> close)
  const sparkData = [quote.open, quote.high * 0.998, quote.low * 1.002, quote.price];

  return (
    <div
      onClick={onClick}
      className="relative glass rounded-xl p-4 cursor-pointer transition-all duration-200 group animate-slide-in-up"
      style={{
        border: isSelected
          ? '1px solid rgba(59,158,255,0.45)'
          : '1px solid transparent',
        boxShadow: isSelected
          ? '0 0 20px rgba(59,158,255,0.12)'
          : 'none',
        transform: 'scale(1)',
      }}
      onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.02)')}
      onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
    >
      {/* Stale indicator */}
      {quote.is_stale && (
        <div
          className="absolute top-2 right-2 text-[9px] px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}
        >
          Cached
        </div>
      )}

      {/* Header row */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {/* Live pulse when market open */}
            {quote.is_market_open && (
              <span className="relative flex h-2 w-2">
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                  style={{ background: 'var(--gain)' }}
                />
                <span
                  className="relative inline-flex rounded-full h-2 w-2"
                  style={{ background: 'var(--gain)' }}
                />
              </span>
            )}
            <h3 className="text-white font-semibold text-sm truncate">{quote.name}</h3>
          </div>
          <p className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {quote.symbol}
          </p>
        </div>

        {/* Sparkline */}
        <div className="ml-2 opacity-80">
          <SparklineChart data={sparkData} color={sparklineColor} width={60} height={28} />
        </div>
      </div>

      {/* Price + Change */}
      <div className="flex items-end justify-between mb-1">
        <p
          className="font-mono font-bold text-xl leading-none"
          style={{ color: 'var(--text-primary)' }}
        >
          {formatNumber(quote.price)}
        </p>
        <div className="flex flex-col items-end gap-1">
          <span
            className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full font-mono"
            style={{
              background: isPositive ? 'rgba(61,186,127,0.1)' : isNegative ? 'rgba(224,92,92,0.1)' : 'rgba(107,118,136,0.1)',
              color: changeColor,
              border: `1px solid ${changeColor}28`,
            }}
          >
            <TrendIcon size={9} />
            {quote.change_pct > 0 ? '+' : ''}{quote.change_pct?.toFixed(2)}%
          </span>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded font-medium"
            style={{
              background: quote.is_market_open ? 'rgba(61,186,127,0.08)' : 'rgba(107,118,136,0.08)',
              color: quote.is_market_open ? 'var(--gain)' : 'var(--neutral-color)',
            }}
          >
            {quote.market_status}
          </span>
        </div>
      </div>

      {/* Change absolute */}
      <p className="font-mono text-xs mb-2" style={{ color: changeColor }}>
        {quote.change > 0 ? '+' : ''}{formatNumber(quote.change)}
      </p>

      {/* Day range bar */}
      <DayRangeBar low={quote.low} high={quote.high} current={quote.price} />

      {/* Stats row */}
      <div
        className="grid grid-cols-2 gap-x-3 mt-3 pt-2.5"
        style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
      >
        <div>
          <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>OPEN</p>
          <p className="font-mono text-[10px] text-white/70">{formatNumber(quote.open)}</p>
        </div>
        <div className="text-right">
          <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>VOLUME</p>
          <p className="font-mono text-[10px] text-white/70">{formatVolume(quote.volume)}</p>
        </div>
      </div>

      {/* Selected bar */}
      {isSelected && (
        <div
          className="absolute bottom-0 left-4 right-4 h-[2px] rounded-full"
          style={{ background: 'linear-gradient(90deg, transparent, var(--accent-blue), transparent)' }}
        />
      )}
    </div>
  );
}
