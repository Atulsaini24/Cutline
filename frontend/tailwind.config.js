/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#101217', 900: '#14171D', 850: '#191C23', 800: '#1E222A', 750: '#252A33', 700: '#2D323D', 600: '#3A404D', 500: '#4D5462' },
        fog: { 100: '#EEF0F5', 200: '#D5D9E2', 300: '#B3B9C6', 400: '#8E95A4', 500: '#6B7282' },
        amber: { 300: '#FFD27A', 400: '#F7BE4A', 500: '#E9A42B', 600: '#B97C14' },
        sky: { 300: '#A8D8FF', 400: '#7CC4FF', 500: '#4FA6EC' },
        jade: { 400: '#5FD3A1', 500: '#38B984' },
        coral: { 400: '#FF8A7A', 500: '#F0675A' },
        lilac: { 400: '#A99BEA', 500: '#8573D6' },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Manrope', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        lift: '0 1px 0 rgba(255,255,255,.04) inset, 0 20px 50px -20px rgba(0,0,0,.7)',
        glow: '0 0 0 1px rgba(247,190,74,.4), 0 0 30px -4px rgba(247,190,74,.45)',
      },
    },
  },
  plugins: [],
}
