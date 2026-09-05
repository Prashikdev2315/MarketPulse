export interface CountryConfig {
  code: string;
  name: string;
  flag: string;
  timezone: string;
  currency: string;
  indices: string[];
  primaryIndex: string;
  secondaryIndex: string;
  tradingViewSymbol?: string; // TradingView format for primary index
  center: [number, number];
  zoom: number;
  color: string;
  available: boolean;
}

export const COUNTRIES: Record<string, CountryConfig> = {
  India: {
    code: 'IN',
    name: 'India',
    flag: '🇮🇳',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    indices: ['^NSEI', '^BSESN', '^NSEBANK', '^CNXIT'],
    primaryIndex: '^NSEI',
    secondaryIndex: '^BSESN',
    tradingViewSymbol: 'NSE:NIFTY50',
    center: [20.5937, 78.9629],
    zoom: 4,
    color: '#E8A92A',   /* warm amber — distinct from loss-red */
    available: true,
  },
  'United States of America': {
    code: 'US',
    name: 'United States',
    flag: '🇺🇸',
    timezone: 'America/New_York',
    currency: 'USD',
    indices: ['^GSPC', '^IXIC', '^DJI'],
    primaryIndex: '^GSPC',
    secondaryIndex: '^IXIC',
    tradingViewSymbol: 'FOREXCOM:SPXUSD',
    center: [37.09, -95.71],
    zoom: 3,
    color: '#3B9EFF',   /* accent-blue — primary market */
    available: true,
  },
  'United Kingdom': {
    code: 'GB',
    name: 'United Kingdom',
    flag: '🇬🇧',
    timezone: 'Europe/London',
    currency: 'GBP',
    indices: ['^FTSE', '^FTMC'],
    primaryIndex: '^FTSE',
    secondaryIndex: '^FTMC',
    tradingViewSymbol: 'SPREADEX:UK100',
    center: [55.37, -3.43],
    zoom: 5,
    color: '#7C6DF0',   /* softer violet, not vivid purple */
    available: true,
  },
  Japan: {
    code: 'JP',
    name: 'Japan',
    flag: '🇯🇵',
    timezone: 'Asia/Tokyo',
    currency: 'JPY',
    indices: ['^N225', '^TOPX'],
    primaryIndex: '^N225',
    secondaryIndex: '^TOPX',
    tradingViewSymbol: 'TVC:NI225',
    center: [36.2, 138.25],
    zoom: 5,
    color: '#E88C52',   /* muted orange — no longer collides with loss-red */
    available: true,
  },
  China: {
    code: 'CN',
    name: 'China',
    flag: '🇨🇳',
    timezone: 'Asia/Shanghai',
    currency: 'CNY',
    indices: ['000001.SS', '000300.SS'],
    primaryIndex: '000001.SS',
    secondaryIndex: '000300.SS',
    tradingViewSymbol: 'SSECI:000001',
    center: [35.86, 104.19],
    zoom: 4,
    color: '#D97B7B',   /* desaturated rose — visually distinct from loss-red */
    available: true,
  },
};

export const INDEX_NAMES: Record<string, string> = {
  '^NSEI':     'NIFTY 50',
  '^BSESN':    'SENSEX',
  '^NSEBANK':  'BANK NIFTY',
  '^CNXIT':    'NIFTY IT',
  '^GSPC':     'S&P 500',
  '^IXIC':     'Nasdaq Composite',
  '^DJI':      'Dow Jones',
  '^FTSE':     'FTSE 100',
  '^FTMC':     'FTSE 250',
  '^N225':     'Nikkei 225',
  '^TOPX':     'TOPIX',
  '000001.SS': 'Shanghai Composite',
  '000300.SS': 'CSI 300',
};
