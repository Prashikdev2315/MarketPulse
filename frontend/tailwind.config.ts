import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Elevation layers (darkest → lightest) ──────────────────────────
        'bg-base':       '#0B0F17',   // page canvas
        'bg-surface':    '#141920',   // header, right panel
        'bg-card':       '#1A2030',   // glass cards, modals
        'bg-elevated':   '#222C3C',   // hover states, inputs
        'bg-overlay':    '#2A3547',   // tooltips, active tiles

        // ── Legacy aliases (backward compat) ───────────────────────────────
        'bg-primary':    '#0B0F17',
        'bg-secondary':  '#141920',

        // ── Single interactive accent ───────────────────────────────────────
        'accent':        '#3B9EFF',   // selected states, focus rings, action buttons
        'accent-blue':   '#3B9EFF',   // alias kept for existing usage

        // ── Desaturated status ─────────────────────────────────────────────
        'gain':          '#3DBA7F',   // positive / bullish
        'loss':          '#E05C5C',   // negative / bearish
        'neutral':       '#6B7688',   // flat / unchanged

        // ── Legacy market aliases (kept to avoid build errors) ─────────────
        'market-green':  '#3DBA7F',
        'market-red':    '#E05C5C',
        'market-gold':   '#D4A840',
        'market-purple': '#7C6DF0',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'slide-in-right': 'slide-in-right 0.35s cubic-bezier(0.16,1,0.3,1) forwards',
        'slide-in-up':    'slide-in-up    0.4s  cubic-bezier(0.16,1,0.3,1) forwards',
        'fade-in':        'fade-in        0.3s  ease forwards',
        'scale-in':       'scale-in       0.3s  cubic-bezier(0.16,1,0.3,1) forwards',
        'ticker':         'ticker-scroll  30s   linear infinite',
        'pulse-glow':     'pulse-glow     2s    ease-in-out infinite',
        'spin-slow':      'spin-slow      3s    linear infinite',
      },
      screens: {
        'xs': '480px',
      },
    },
  },
  plugins: [],
}

export default config
