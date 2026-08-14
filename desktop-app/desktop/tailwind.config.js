/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0F1115',
        cloud: '#F7F8FA',
        softblue: '#6B8FFF',
        stone: '#EDE9E3',
      },
      boxShadow: {
        soft: '0 18px 48px rgba(15,17,21,0.07)',
      },
      borderRadius: {
        zev: '22px',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Segoe UI', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        editorial: ['Iowan Old Style', 'Baskerville', 'Georgia', 'Times New Roman', 'serif'],
      },
    },
  },
  plugins: [],
}
