'use client';

import StockSearchBox from './StockSearchBox';
import TrendingStocks from './TrendingStocks';
import type { CountryConfig } from '@/lib/countryConfig';

interface Props {
  selectedCountry: CountryConfig | null;
  onSelect: (symbol: string, name: string, tradingViewSymbol: string) => void;
}

/**
 * Composed search block placed above the index cards in the left column.
 * Holds the search box + per-country trending chips.
 */
export default function StockSearchSection({ selectedCountry, onSelect }: Props) {
  return (
    <div className="space-y-3">
      <StockSearchBox
        country={selectedCountry?.code}
        onSelect={onSelect}
      />
      <TrendingStocks
        country={selectedCountry?.code}
        onSelect={onSelect}
      />
    </div>
  );
}
