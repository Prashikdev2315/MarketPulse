'use client';

import { useState, useEffect } from 'react';
import { Flame, TrendingUp, TrendingDown } from 'lucide-react';
import type { TrendingStock } from '@/lib/api';
import { fetchTrendingStocks } from '@/lib/api';
import { TrendingSkeleton } from '@/components/ui/LoadingSkeleton';

interface Props {
  country?: string;
  onSelect: (symbol: string, name: string, tradingViewSymbol: string) => void;
}

export default function TrendingStocks({ country, onSelect }: Props) {
  const [stocks, setStocks]   = useState<TrendingStock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTrendingStocks(country)
      .then(data => { if (!cancelled) setStocks(data); })
      .catch(() => { if (!cancelled) setStocks([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [country]);

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--gold)' }}>
          <Flame size={11} /> TRENDING
        </span>
        <div className="flex-1"><TrendingSkeleton /></div>
      </div>
    );
  }

  if (stocks.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
      <span
        className="text-[10px] font-semibold flex items-center gap-1 flex-shrink-0"
        style={{ color: 'var(--gold)' }}
      >
        <Flame size={11} /> TRENDING
      </span>
      {stocks.map(s => {
        const isUp = (s.change_pct ?? 0) >= 0;
        return (
          <button
            key={s.symbol}
            onClick={() => onSelect(s.symbol, s.name, s.tradingViewSymbol)}
            className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full transition-all hover:scale-105"
            style={{
              background: 'var(--bg-elevated)',
            }}
            title={`${s.name} — ${s.change_pct != null ? s.change_pct.toFixed(2) + '%' : ''}`}
            aria-label={`View ${s.name}`}
          >
            <span className="text-[11px] font-medium text-white whitespace-nowrap">{s.name}</span>
            {s.change_pct != null && (
              <span
                className="flex items-center gap-0.5 text-[10px] font-mono font-semibold"
                style={{ color: isUp ? 'var(--gain)' : 'var(--loss)' }}
              >
                {isUp ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                {isUp ? '+' : ''}{s.change_pct.toFixed(1)}%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
