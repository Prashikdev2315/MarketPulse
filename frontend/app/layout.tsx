import type { Metadata, Viewport } from 'next';
import './globals.css';
import ErrorBoundary from '@/components/ui/ErrorBoundary';

export const metadata: Metadata = {
  title: 'Market Intelligence — AI-Powered Financial Analytics',
  description:
    'Real-time global stock market data, AI-powered analysis, and strictly-filtered financial news. Track NIFTY, SENSEX, S&P 500, NASDAQ, FTSE, Nikkei and more.',
  keywords:
    'stock market, NIFTY, SENSEX, S&P 500, NASDAQ, AI analysis, financial news, market intelligence, trading',
  openGraph: {
    title: 'Market Intelligence — AI-Powered Financial Analytics',
    description: 'Bloomberg-grade market intelligence powered by AI.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0e1a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta name="color-scheme" content="dark" />
      </head>
      <body className="antialiased" style={{ background: '#0a0e1a', color: '#e8edf5' }}>
        <ErrorBoundary fallbackMessage="Market Intelligence failed to load. Please refresh the page.">
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}
