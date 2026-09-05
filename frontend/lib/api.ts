const BASE = '/api';

// ── Typed error system ────────────────────────────────────────────────────────

/**
 * Discriminated-union error type surfaced from every fetch helper.
 *
 * - `network`   : fetch() threw (offline, DNS failure, server unreachable)
 * - `not_found` : backend returned 404 — ticker / resource does not exist
 * - `server`    : backend returned 5xx
 * - `timeout`   : AbortController fired before a response arrived
 * - `empty`     : fetch succeeded but the payload was empty / malformed
 * - `api`       : any other 4xx (bad request, unauthorised, etc.)
 */
export type ApiErrorKind =
  | 'network'
  | 'not_found'
  | 'server'
  | 'timeout'
  | 'empty'
  | 'api';

export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Returns true when the error is a transient network / server problem. */
export function isConnectionError(e: unknown): boolean {
  return e instanceof ApiError && (e.kind === 'network' || e.kind === 'timeout' || e.kind === 'server');
}

/** Returns true when the ticker / resource simply does not exist. */
export function isNotFoundError(e: unknown): boolean {
  return e instanceof ApiError && e.kind === 'not_found';
}

/** Human-readable message shown to the user for a given error kind. */
export function userMessage(e: unknown, fallback = 'Something went wrong.'): string {
  if (!(e instanceof ApiError)) return fallback;
  switch (e.kind) {
    case 'network':    return 'Connection issue — check your network or make sure the backend is running.';
    case 'timeout':    return 'The request timed out. Please try again.';
    case 'server':     return 'Server error — the backend returned an unexpected response.';
    case 'not_found':  return e.message;   // caller sets a descriptive message
    case 'empty':      return 'Received an empty or malformed response. Please try again.';
    case 'api':        return e.message;
    default:           return fallback;
  }
}

// ── Internal fetch helpers ────────────────────────────────────────────────────

/**
 * Retry decorator: up to `retries` additional attempts with exponential
 * back-off (base 1 s, doubles each round, jitter ±20 %).
 *
 * Only 5xx responses and network failures are retried. 4xx responses are
 * permanent — retrying just adds latency and pollutes logs.
 */
async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = 2,
  _attempt = 0,
): Promise<Response> {
  const isRetryable = (res: Response | null) =>
    res === null || (res.status >= 500 && res.status < 600);

  try {
    const res = await fetch(url, options);
    if (!res.ok && isRetryable(res) && retries > 0) {
      const delay = (1000 * Math.pow(2, _attempt)) * (0.8 + Math.random() * 0.4);
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(url, options, retries - 1, _attempt + 1);
    }
    return res;
  } catch (e) {
    if (retries > 0) {
      const delay = (1000 * Math.pow(2, _attempt)) * (0.8 + Math.random() * 0.4);
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(url, options, retries - 1, _attempt + 1);
    }
    // Network / DNS failure
    throw new ApiError('network', 'Network request failed — check your connection or the backend server.');
  }
}

/**
 * Like fetchWithRetry but with an explicit timeout (milliseconds).
 * Resolves to the Response or throws an ApiError with kind 'timeout'.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  retries = 0,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchWithRetry(url, { ...options, signal: controller.signal }, retries);
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError('timeout', 'Request timed out. Please try again.');
    }
    throw e;
  }
}

/**
 * Classify a non-ok HTTP response into the correct ApiError kind.
 */
function classifyHttpError(res: Response, context: string): ApiError {
  if (res.status === 404) {
    return new ApiError('not_found', `${context} not found (404).`, 404);
  }
  if (res.status >= 500) {
    return new ApiError('server', `Server error (${res.status}) while fetching ${context}.`, res.status);
  }
  return new ApiError('api', `Request failed (${res.status}) for ${context}.`, res.status);
}

/** Safe JSON parse — returns null instead of throwing on malformed input. */
function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface IndexQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_pct: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  currency: string;
  country: string;
  market_status: string;
  is_market_open: boolean;
  trend: 'bullish' | 'bearish' | 'neutral';
  timestamp: string;
  is_stale?: boolean;
}

export interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  published_at: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentiment_label: 'Bullish' | 'Bearish' | 'Neutral';
  category: string;
  affected_sectors: string[];
  market_impact: 'high' | 'medium' | 'low';
  relevance_score: number;
}

export interface AISection {
  id: string;
  title: string;
  content: string;
  icon: string;
}

export interface AIInsight {
  title: string;
  summary?: string;
  sections?: AISection[];
  key_factors: string[];
  bullish_signals?: string[];
  bearish_signals?: string[];
  sentiment: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  period?: string;
  generated_at: string;
  // Next-day prediction fields (only present when period === "nextday")
  next_day_direction?: 'up' | 'down' | 'sideways';
  expected_move_pct?: string;
  price_target_low?: number;
  price_target_high?: number;
  key_support?: number;
  key_resistance?: number;
}

// ── Public fetch functions ────────────────────────────────────────────────────

export async function fetchIndices(country?: string): Promise<IndexQuote[]> {
  const url = country
    ? `${BASE}/market/indices?country=${encodeURIComponent(country)}`
    : `${BASE}/market/indices`;
  try {
    const res = await fetchWithRetry(url);
    if (!res.ok) throw classifyHttpError(res, 'market indices');
    const text = await res.text();
    const data = safeParse(text) as Record<string, unknown> | null;
    const list: IndexQuote[] = Array.isArray(data?.data) ? (data!.data as IndexQuote[]) : [];
    // Cache to localStorage as ultimate fallback
    if (list.length > 0) {
      try {
        localStorage.setItem(
          `market_cache_${country ?? 'all'}`,
          JSON.stringify({ data: list, ts: Date.now() }),
        );
      } catch {}
    }
    return list;
  } catch (e) {
    // Try localStorage stale-cache fallback
    try {
      const cached = localStorage.getItem(`market_cache_${country ?? 'all'}`);
      if (cached) {
        const parsed = JSON.parse(cached) as { data: IndexQuote[] };
        return parsed.data.map((d: IndexQuote) => ({ ...d, is_stale: true }));
      }
    } catch {}
    throw e;
  }
}

export async function fetchHistory(symbol: string, period = '1Y'): Promise<CandleData[]> {
  const encoded = encodeURIComponent(symbol);
  let res: Response;
  try {
    res = await fetchWithRetry(`${BASE}/market/history/${encoded}?period=${period}`);
  } catch (e) {
    throw e instanceof ApiError ? e : new ApiError('network', 'Network error fetching history.');
  }
  if (!res.ok) throw classifyHttpError(res, `history for ${symbol}`);
  const text = await res.text();
  const data = safeParse(text) as Record<string, unknown> | null;
  if (!data) throw new ApiError('empty', 'Malformed history response.');
  return Array.isArray(data.candles) ? (data.candles as CandleData[]) : [];
}

export async function fetchNews(
  country = 'IN',
  limit = 30,
  category?: string,
): Promise<NewsArticle[]> {
  let url = `${BASE}/news/?country=${encodeURIComponent(country)}&limit=${limit}`;
  if (category) url += `&category=${encodeURIComponent(category)}`;
  let res: Response;
  try {
    res = await fetchWithRetry(url);
  } catch (e) {
    throw e instanceof ApiError ? e : new ApiError('network', 'Network error fetching news.');
  }
  if (!res.ok) throw classifyHttpError(res, 'news');
  const text = await res.text();
  const data = safeParse(text) as Record<string, unknown> | null;
  if (!data) throw new ApiError('empty', 'Malformed news response.');
  return Array.isArray(data.articles) ? (data.articles as NewsArticle[]) : [];
}

export async function fetchMarketStatus(
  country: string,
): Promise<{ is_open: boolean; session: string; timezone: string }> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${BASE}/market/status/${encodeURIComponent(country)}`);
  } catch (e) {
    throw e instanceof ApiError ? e : new ApiError('network', 'Network error fetching market status.');
  }
  if (!res.ok) throw classifyHttpError(res, `market status for ${country}`);
  const text = await res.text();
  const data = safeParse(text) as Record<string, unknown> | null;
  if (!data || !data.status) throw new ApiError('empty', 'Malformed market status response.');
  return data.status as { is_open: boolean; session: string; timezone: string };
}

/**
 * AI market analysis with a 15-second timeout and no automatic retries
 * (AI calls are expensive; the caller controls retry via the UI retry button).
 */
export async function analyzeMarket(
  period: string,
  country = 'IN',
  question?: string,
): Promise<AIInsight> {
  const AI_TIMEOUT_MS = 15_000;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${BASE}/ai/analyze`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, country, question }),
      },
      AI_TIMEOUT_MS,
      0, // no automatic retries for AI
    );
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('network', 'Network error contacting the AI service.');
  }
  if (!res.ok) throw classifyHttpError(res, 'AI market analysis');
  const text = await res.text();
  const data = safeParse(text) as AIInsight | null;
  if (!data || !data.title) throw new ApiError('empty', 'AI returned an empty or malformed response.');
  return data;
}

// ── Stock (individual equity) types + fetchers ────────────────────────────────

export interface StockSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  country: string;
  tradingViewSymbol: string;
}

export interface StockInfo {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  sector: string;
  industry: string;
  market_cap: number | null;
  trailing_pe: number | null;
  forward_pe: number | null;
  beta: number | null;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
  average_volume: number | null;
  dividend_yield: number | null;
  market_state: string;
  quote_type: string;
  tradingViewSymbol: string;
  country: string;
}

export interface StockQuoteResponse {
  quote: IndexQuote;
  info: StockInfo | null;
  fetched_at: string;
}

export interface TrendingStock {
  symbol: string;
  name: string;
  price: number | null;
  change_pct: number | null;
  currency: string;
  is_market_open: boolean;
  tradingViewSymbol: string;
}

export async function searchStocks(query: string, country?: string): Promise<StockSearchResult[]> {
  let url = `${BASE}/stocks/search?q=${encodeURIComponent(query)}`;
  if (country) url += `&country=${encodeURIComponent(country)}`;
  let res: Response;
  try {
    res = await fetchWithRetry(url, undefined, 1);
  } catch (e) {
    // fetchWithRetry already wraps network failures into ApiError
    throw e instanceof ApiError ? e : new ApiError('network', 'Network error — could not reach the search service.');
  }
  if (res.status === 404) {
    // 404 on search = backend says query matched nothing at the API level;
    // treat as empty results rather than a hard error.
    return [];
  }
  if (!res.ok) throw classifyHttpError(res, `search for "${query}"`);
  const text = await res.text();
  const data = safeParse(text) as Record<string, unknown> | null;
  if (!data) throw new ApiError('empty', 'Search returned a malformed response.');
  return Array.isArray(data.results) ? (data.results as StockSearchResult[]) : [];
}

export async function fetchTrendingStocks(country?: string): Promise<TrendingStock[]> {
  let url = `${BASE}/stocks/trending`;
  if (country) url += `?country=${encodeURIComponent(country)}`;
  let res: Response;
  try {
    res = await fetchWithRetry(url);
  } catch (e) {
    throw e instanceof ApiError ? e : new ApiError('network', 'Network error fetching trending stocks.');
  }
  if (!res.ok) throw classifyHttpError(res, 'trending stocks');
  const text = await res.text();
  const data = safeParse(text) as Record<string, unknown> | null;
  if (!data) throw new ApiError('empty', 'Malformed trending stocks response.');
  return Array.isArray(data.stocks) ? (data.stocks as TrendingStock[]) : [];
}

export async function fetchStockQuote(symbol: string): Promise<StockQuoteResponse> {
  const encoded = encodeURIComponent(symbol);
  let res: Response;
  try {
    res = await fetchWithRetry(`${BASE}/stocks/quote/${encoded}`, undefined, 1);
  } catch (e) {
    throw e instanceof ApiError ? e : new ApiError('network', 'Network error fetching stock quote.');
  }
  if (res.status === 404) {
    throw new ApiError('not_found', `"${symbol}" was not found. Check the ticker and try again.`, 404);
  }
  if (!res.ok) throw classifyHttpError(res, `quote for ${symbol}`);
  const text = await res.text();
  const data = safeParse(text) as StockQuoteResponse | null;
  if (!data || !data.quote) throw new ApiError('empty', `Received an empty response for "${symbol}".`);
  return data;
}

export async function fetchStockInfo(symbol: string): Promise<StockInfo> {
  const encoded = encodeURIComponent(symbol);
  let res: Response;
  try {
    res = await fetchWithRetry(`${BASE}/stocks/info/${encoded}`, undefined, 1);
  } catch (e) {
    throw e instanceof ApiError ? e : new ApiError('network', 'Network error fetching stock info.');
  }
  if (res.status === 404) {
    throw new ApiError('not_found', `"${symbol}" was not found. Check the ticker and try again.`, 404);
  }
  if (!res.ok) throw classifyHttpError(res, `info for ${symbol}`);
  const text = await res.text();
  const data = safeParse(text) as StockInfo | null;
  if (!data) throw new ApiError('empty', `Received an empty response for "${symbol}".`);
  return data;
}

export async function fetchStockNews(symbol: string, limit = 15): Promise<NewsArticle[]> {
  const encoded = encodeURIComponent(symbol);
  let res: Response;
  try {
    res = await fetchWithRetry(`${BASE}/stocks/news/${encoded}?limit=${limit}`, undefined, 1);
  } catch (e) {
    throw e instanceof ApiError ? e : new ApiError('network', 'Network error fetching stock news.');
  }
  if (!res.ok) throw classifyHttpError(res, `news for ${symbol}`);
  const text = await res.text();
  const data = safeParse(text) as Record<string, unknown> | null;
  if (!data) return [];
  return Array.isArray(data.articles) ? (data.articles as NewsArticle[]) : [];
}

/**
 * AI stock analysis with a 15-second hard timeout.
 * No automatic retries — the UI exposes an explicit retry button (max 3 attempts).
 */
export async function analyzeStock(symbol: string, period: string): Promise<AIInsight> {
  const AI_TIMEOUT_MS = 15_000;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${BASE}/stocks/analyze`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, period }),
      },
      AI_TIMEOUT_MS,
      0, // no automatic retries for AI
    );
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('network', 'Network error contacting the AI service.');
  }
  if (res.status === 404) {
    throw new ApiError('not_found', `No data found for "${symbol}". Verify the ticker.`, 404);
  }
  if (!res.ok) throw classifyHttpError(res, `AI analysis for ${symbol}`);
  const text = await res.text();
  const data = safeParse(text) as AIInsight | null;
  if (!data || !data.title) throw new ApiError('empty', 'AI returned an empty or malformed response.');
  return data;
}

// ── Heatmap ───────────────────────────────────────────────────────────────────

export interface HeatmapCell {
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  change_pct: number | null;
  change: number | null;
  volume: number | null;
  currency: string;
  market_cap: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
}

export interface HeatmapResponse {
  country: string;
  count: number;
  cells: HeatmapCell[];
  fetched_at: string;
}

export async function fetchHeatmap(country = 'IN'): Promise<HeatmapResponse> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${BASE}/market/heatmap?country=${encodeURIComponent(country)}`);
  } catch (e) {
    throw e instanceof ApiError ? e : new ApiError('network', 'Network error fetching heatmap.');
  }
  if (!res.ok) throw classifyHttpError(res, `heatmap for ${country}`);
  const text = await res.text();
  const data = safeParse(text) as HeatmapResponse | null;
  if (!data) throw new ApiError('empty', 'Malformed heatmap response.');
  return data;
}
