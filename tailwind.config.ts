import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#0F2742', deep: '#081727', soft: '#1B3C60', line: '#274B71' },
        brass: { DEFAULT: '#C9A227', light: '#E6C75B', dim: '#8A6F16' },
        jade: { DEFAULT: '#157F6B', light: '#3FA890' },
        mist: { DEFAULT: '#EEF2F6', deep: '#D9E2EC' },
        clay: '#B8432C',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['"Public Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(8,23,39,.06), 0 12px 32px -18px rgba(8,23,39,.45)',
        lift: '0 18px 40px -22px rgba(8,23,39,.65)',
      },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
};
export default config;
