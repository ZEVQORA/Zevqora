/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand board palette — four brand colours, plus derived neutrals.
        ink: { DEFAULT: '#0F1115', 700: '#2A2F39', 500: '#565E6D', 400: '#6A7280' },
        cloud: '#F7F8FA',
        blue: { DEFAULT: '#468BFF', 700: '#2F6FDC', 800: '#2A61C4', 100: '#DCE8FF', 50: '#EEF4FF' },
        stone: { DEFAULT: '#E6E9EE', 300: '#D5DAE2' },
        muted: '#565E6D',
        subtle: '#6A7280',
        line: { DEFAULT: '#E6E9EE', strong: '#D5DAE2', control: '#848D9B' },
        sunken: '#F2F4F7',
        verified: { DEFAULT: '#0E7355', bg: '#E9F4F0' },
        rejected: { DEFAULT: '#A83228', bg: '#FBEEEC' },
        warning: { DEFAULT: '#8A6100', bg: '#FBF3E2' },
      },
      fontFamily: {
        sans: ['Satoshi', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        eyebrow: ['11px', { lineHeight: '1.2', letterSpacing: '0.14em', fontWeight: '600' }],
        technical: ['12px', { lineHeight: '1.45', letterSpacing: '0.005em' }],
        caption: ['13px', { lineHeight: '1.5' }],
        body: ['14px', { lineHeight: '1.6', letterSpacing: '-0.006em' }],
        h4: ['17px', { lineHeight: '1.35', letterSpacing: '-0.012em', fontWeight: '600' }],
        h3: ['20px', { lineHeight: '1.3', letterSpacing: '-0.018em', fontWeight: '600' }],
        h2: ['26px', { lineHeight: '1.12', letterSpacing: '-0.028em', fontWeight: '700' }],
        h1: ['32px', { lineHeight: '1.06', letterSpacing: '-0.035em', fontWeight: '700' }],
        metric: ['28px', { lineHeight: '1', letterSpacing: '-0.03em', fontWeight: '650' }],
      },
      borderRadius: { xs: '4px', sm: '6px', md: '10px', lg: '16px', xl: '22px' },
      boxShadow: {
        lift: '0 1px 2px rgb(15 17 21 / 0.04), 0 8px 24px -14px rgb(15 17 21 / 0.14)',
        panel: '0 2px 4px rgb(15 17 21 / 0.04), 0 24px 60px -28px rgb(15 17 21 / 0.24)',
        glass: '0 1px 0 rgb(255 255 255 / 0.9) inset, 0 0 0 1px rgb(15 17 21 / 0.05), 0 18px 50px -24px rgb(15 17 21 / 0.28)',
        pop: '0 0 0 1px rgb(15 17 21 / 0.06), 0 30px 80px -30px rgb(15 17 21 / 0.35)',
        cta: '0 1px 2px rgb(15 17 21 / 0.10), 0 6px 16px -8px rgb(47 111 220 / 0.55), inset 0 1px 0 rgb(255 255 255 / 0.16)',
      },
      transitionTimingFunction: { standard: 'cubic-bezier(0.2, 0, 0, 1)' },
    },
  },
  plugins: [],
}
