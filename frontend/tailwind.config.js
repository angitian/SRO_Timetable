/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        subject: {
          core: '#3b82f6',
          pe: '#22c55e',
          art: '#eab308',
          music: '#a855f7',
          lab: '#8b5cf6',
          admin: '#6b7280',
        },
      },
    },
  },
  plugins: [],
}
