/**
 * Symbol mapping: Yahoo Finance <-> TradingView <-> Display names
 *
 * TradingView symbol prefixes used:
 *   TVC:   — TradingView's own continuous index feeds (most reliable for indices)
 *   NSE:   — National Stock Exchange (India)
 *   BSE:   — Bombay Stock Exchange (India)
 *   SP:    — S&P indices
 *   NASDAQ — NASDAQ exchange
 *   DJ:    — Dow Jones indices
 *   LSE:   — London Stock Exchange (FTSE)
 *   TSE:   — Tokyo Stock Exchange
 *   SSE:   — Shanghai Stock Exchange
 */

export interface SymbolInfo {
  yahoo: string;
  tradingView: string;
  name: string;
  country: string;
  currency: string;
  exchange: string;
  timezone: string;
}

export const SYMBOL_MAP: Record<string, SymbolInfo> = {
  // ── India ──────────────────────────────────────────────────────────────────
  '^NSEI': {
    yahoo: '^NSEI',
    tradingView: 'NSE:NIFTY50',
    name: 'NIFTY 50',
    country: 'IN',
    currency: 'INR',
    exchange: 'NSE',
    timezone: 'Asia/Kolkata',
  },
  '^BSESN': {
    yahoo: '^BSESN',
    tradingView: 'BSE:SENSEX',
    name: 'SENSEX',
    country: 'IN',
    currency: 'INR',
    exchange: 'BSE',
    timezone: 'Asia/Kolkata',
  },
  '^NSEBANK': {
    yahoo: '^NSEBANK',
    tradingView: 'NSE:BANKNIFTY',
    name: 'BANK NIFTY',
    country: 'IN',
    currency: 'INR',
    exchange: 'NSE',
    timezone: 'Asia/Kolkata',
  },
  '^CNXIT': {
    yahoo: '^CNXIT',
    tradingView: 'NSE:CNXIT',
    name: 'NIFTY IT',
    country: 'IN',
    currency: 'INR',
    exchange: 'NSE',
    timezone: 'Asia/Kolkata',
  },

  // ── United States ──────────────────────────────────────────────────────────
  '^GSPC': {
    yahoo: '^GSPC',
    tradingView: 'FOREXCOM:SPXUSD',
    name: 'S&P 500',
    country: 'US',
    currency: 'USD',
    exchange: 'NYSE',
    timezone: 'America/New_York',
  },
  '^IXIC': {
    yahoo: '^IXIC',
    tradingView: 'FOREXCOM:NSQUSD',
    name: 'NASDAQ',
    country: 'US',
    currency: 'USD',
    exchange: 'NASDAQ',
    timezone: 'America/New_York',
  },
  '^DJI': {
    yahoo: '^DJI',
    tradingView: 'FOREXCOM:DJI',
    name: 'Dow Jones',
    country: 'US',
    currency: 'USD',
    exchange: 'NYSE',
    timezone: 'America/New_York',
  },

  // ── United Kingdom ─────────────────────────────────────────────────────────
  '^FTSE': {
    yahoo: '^FTSE',
    tradingView: 'SPREADEX:UK100',
    name: 'FTSE 100',
    country: 'GB',
    currency: 'GBP',
    exchange: 'LSE',
    timezone: 'Europe/London',
  },
  '^FTMC': {
    yahoo: '^FTMC',
    tradingView: 'SPREADEX:UK250',
    name: 'FTSE 250',
    country: 'GB',
    currency: 'GBP',
    exchange: 'LSE',
    timezone: 'Europe/London',
  },

  // ── Japan ──────────────────────────────────────────────────────────────────
  '^N225': {
    yahoo: '^N225',
    tradingView: 'TVC:NI225',
    name: 'Nikkei 225',
    country: 'JP',
    currency: 'JPY',
    exchange: 'TSE',
    timezone: 'Asia/Tokyo',
  },
  '^TOPX': {
    yahoo: '^TOPX',
    tradingView: 'TVC:TOPIX',
    name: 'TOPIX',
    country: 'JP',
    currency: 'JPY',
    exchange: 'TSE',
    timezone: 'Asia/Tokyo',
  },

  // ── China ──────────────────────────────────────────────────────────────────
  '000001.SS': {
    yahoo: '000001.SS',
    tradingView: 'SSECI:000001',
    name: 'Shanghai Composite',
    country: 'CN',
    currency: 'CNY',
    exchange: 'SSE',
    timezone: 'Asia/Shanghai',
  },
  '000300.SS': {
    yahoo: '000300.SS',
    tradingView: 'SSECI:000300',
    name: 'CSI 300',
    country: 'CN',
    currency: 'CNY',
    exchange: 'SSE',
    timezone: 'Asia/Shanghai',
  },
};

export function getTradingViewSymbol(yahooSymbol: string): string {
  return SYMBOL_MAP[yahooSymbol]?.tradingView ?? yahooSymbol;
}

/**
 * Map a Yahoo *stock* symbol (not an index) to a TradingView symbol.
 * The backend's /stocks endpoints already return a pre-computed
 * `tradingViewSymbol`, so callers should prefer that. This client-side
 * resolver is a fallback for symbols obtained elsewhere.
 *
 * Suffix rules: .NS/.BO→NSE/BSE, .L→LSE, .T→TSE, .HK→HKEX, .SH/.SZ→SSE.
 * Bare US tickers resolve to NASDAQ (via allowlist) or NYSE.
 */
const NASDAQ_TICKERS = new Set([
  'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'GOOG', 'META', 'NFLX',
  'AMD', 'INTC', 'CSCO', 'ADBE', 'PEP', 'COST', 'AVGO', 'TXN', 'QCOM',
  'TMUS', 'BIIB', 'GILD', 'ISRG', 'VRTX', 'REGN', 'PYPL', 'SBUX',
]);

export function stockToTradingView(yahooSymbol: string): string {
  const up = yahooSymbol.toUpperCase();

  // Indian stocks: TradingView free widget resolves NSE stocks WITHOUT
  // exchange prefix. Using NSE:/BSE: requires a TradingView Pro subscription.
  // Bare tickers like 'INFY', 'TCS', 'RELIANCE' work on the free tier.
  if (up.endsWith('.NS') || up.endsWith('.BO')) {
    const bare = up.split('.')[0];
    return bare; // No prefix — free-tier compatible
  }

  // UK stocks — LSE: prefix works on the free widget
  if (up.endsWith('.L')) return `LSE:${up.split('.')[0]}`;

  // Japanese stocks
  if (up.endsWith('.T')) return `TSE:${up.split('.')[0]}`;

  // Hong Kong / China
  if (up.endsWith('.HK')) return `HKEX:${up.split('.')[0]}`;
  if (up.endsWith('.SH') || up.endsWith('.SZ')) return `SSE:${up.split('.')[0]}`;

  // Bare US ticker — NASDAQ allowlist, else NYSE
  return NASDAQ_TICKERS.has(up) ? `NASDAQ:${up}` : `NYSE:${up}`;
}

/** Returns the IANA timezone for the given Yahoo Finance symbol (for chart display). */
export function getSymbolTimezone(yahooSymbol: string): string {
  return SYMBOL_MAP[yahooSymbol]?.timezone ?? 'UTC';
}

export function getSymbolInfo(yahooSymbol: string): SymbolInfo | null {
  return SYMBOL_MAP[yahooSymbol] ?? null;
}

export const DEFAULT_COUNTRY_SYMBOL: Record<string, string> = {
  IN: '^NSEI',
  US: '^GSPC',
  GB: '^FTSE',
  JP: '^N225',
  CN: '000001.SS',
};
