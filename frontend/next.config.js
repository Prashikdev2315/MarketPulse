/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.FASTAPI_URL || 'http://127.0.0.1:8000'}/:path*`,
      },
    ];
  },

  async headers() {
    return [
      {
        // Apply security headers to all pages
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // REMOVED X-Frame-Options: SAMEORIGIN — this was not blocking TradingView iframes
          // (that header controls whether OUR page can be iframed, not the reverse)
          // but keeping it absent avoids any edge-case interference with embed widgets.
        ],
      },
    ];
  },

  images: {
    domains: ['s3.tradingview.com'],
  },

  // Allow TradingView scripts to be loaded
  // (no custom webpack config needed — standard Next.js handles external scripts fine)
};

module.exports = nextConfig;
