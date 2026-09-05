'use client';

import { useState, useEffect } from 'react';
import { ExternalLink, TrendingUp, TrendingDown, Minus, Flame, Newspaper } from 'lucide-react';
import type { NewsArticle } from '@/lib/api';
import { NewsSkeleton } from '@/components/ui/LoadingSkeleton';

interface Props {
  articles: NewsArticle[];
  isLoading: boolean;
}

const SOURCE_COLORS: Record<string, string> = {
  'Economic Times': '#f59e0b',
  'ET Economy':     '#f59e0b',
  'Mint Markets':   '#10b981',
  'Business Standard': '#4f9cf9',
  'Financial Express': '#8b5cf6',
  'Reuters':         '#ef4444',
  'Reuters UK':      '#ef4444',
  'Reuters Asia':    '#ef4444',
  'CNBC Markets':    '#10b981',
  'CNBC Economy':    '#10b981',
  'Yahoo Finance':   '#4f9cf9',
  'BBC Business':    '#ff2d55',
  'Nikkei Asia':     '#eab308',
};

const CATEGORIES = ['All', 'Markets', 'Economy', 'Earnings', 'IPO', 'Global', 'Crypto', 'Commodities'];

const CATEGORY_COLORS: Record<string, string> = {
  Markets:     '#4f9cf9',
  Economy:     '#f59e0b',
  Earnings:    '#10b981',
  IPO:         '#8b5cf6',
  Global:      '#6366f1',
  Crypto:      '#f97316',
  Commodities: '#84cc16',
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function SentimentBadge({ sentiment, label }: { sentiment: string; label?: string }) {
  if (sentiment === 'positive') {
    return (
      <span className="flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.25)' }}>
        <TrendingUp size={8} />{label || 'Bullish'}
      </span>
    );
  }
  if (sentiment === 'negative') {
    return (
      <span className="flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}>
        <TrendingDown size={8} />{label || 'Bearish'}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(156,163,175,0.1)', color: '#9ca3af', border: '1px solid rgba(156,163,175,0.2)' }}>
      <Minus size={8} />Neutral
    </span>
  );
}

export default function NewsPanel({ articles, isLoading }: Props) {
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeSentiment, setActiveSentiment] = useState<'all' | 'positive' | 'negative'>('all');

  // Reset filters when the article set changes (country switch)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setActiveCategory('All'); setActiveSentiment('all'); }, [articles.length]);

  // Only show categories that actually have articles — prevents "No articles found"
  // when a user selects a filter category. Always include "All" first.
  const availableCategories = ['All', ...CATEGORIES.filter(cat =>
    cat !== 'All' && articles.some(a => a.category === cat)
  )];

  const filtered = articles.filter((a) => {
    const catMatch = activeCategory === 'All' || a.category === activeCategory;
    const sentMatch = activeSentiment === 'all' || a.sentiment === activeSentiment;
    return catMatch && sentMatch;
  });

  return (
    <div className="glass rounded-xl flex flex-col" style={{ height: '100%', border: '1px solid rgba(255,255,255,0.06)' }}>
      {/* Header */}
      <div className="px-5 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Newspaper size={14} style={{ color: 'var(--accent-blue)' }} />
            <h2 className="text-white font-semibold text-sm">Market News</h2>
            {!isLoading && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(79,156,249,0.12)', color: '#4f9cf9' }}>
                {filtered.length}
              </span>
            )}
          </div>
          <div className="flex gap-1">
            {(['all', 'positive', 'negative'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setActiveSentiment(f)}
                className="px-2 py-0.5 rounded text-[10px] font-medium capitalize transition-all"
                style={{
                  background: activeSentiment === f ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: activeSentiment === f ? 'white' : 'var(--text-muted)',
                }}
              >
                {f === 'all' ? 'All' : f === 'positive' ? '▲ Bull' : '▼ Bear'}
              </button>
            ))}
          </div>
        </div>

        {/* Category tabs — only show categories with actual articles */}
        <div className="flex gap-1 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {availableCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className="flex-shrink-0 px-2.5 py-1 rounded text-[10px] font-medium transition-all"
              style={{
                background: activeCategory === cat
                  ? `${CATEGORY_COLORS[cat] || '#4f9cf9'}20`
                  : 'rgba(255,255,255,0.04)',
                color: activeCategory === cat
                  ? (CATEGORY_COLORS[cat] || '#4f9cf9')
                  : 'var(--text-muted)',
                border: `1px solid ${
                  activeCategory === cat
                    ? `${CATEGORY_COLORS[cat] || '#4f9cf9'}40`
                    : 'transparent'
                }`,
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Articles */}
      <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        {isLoading ? (
          <NewsSkeleton />
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Newspaper size={28} className="mx-auto mb-3 opacity-20" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No articles found</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>Try a different category or sentiment filter</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
            {filtered.map((article) => {
              const sourceColor = SOURCE_COLORS[article.source] || '#4f9cf9';
              return (
                <a
                  key={article.id}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-5 py-3.5 hover:bg-white/[0.03] transition-colors group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Meta row */}
                      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                        <span
                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                          style={{
                            background: `${sourceColor}15`,
                            color: sourceColor,
                            border: `1px solid ${sourceColor}30`,
                          }}
                        >
                          {article.source}
                        </span>
                        <SentimentBadge sentiment={article.sentiment} label={article.sentiment_label} />
                        {article.market_impact === 'high' && (
                          <span className="flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                            <Flame size={8} />High Impact
                          </span>
                        )}
                        <span className="text-[9px] ml-auto" style={{ color: 'var(--text-muted)' }}>
                          {timeAgo(article.published_at)}
                        </span>
                      </div>

                      {/* Title */}
                      <p className="text-xs text-white/90 leading-snug line-clamp-2 group-hover:text-white transition-colors">
                        {article.title}
                      </p>

                      {/* Sectors */}
                      {article.affected_sectors && article.affected_sectors.length > 0 && (
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          {article.affected_sectors.map((sector) => (
                            <span
                              key={sector}
                              className="text-[9px] px-1.5 py-0.5 rounded"
                              style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}
                            >
                              {sector}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <ExternalLink
                      size={11}
                      className="flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: 'var(--accent-blue)' }}
                    />
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
