/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './sidepanel.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        ocean: {
          180: '#13212C',
          150: '#264759',
          120: '#36677D',
          60: '#94BFCE',
          30: '#E7F2F5',
          10: '#F5FAFC',
        },
        pine: '#86B596',
        rose: '#FF8675',
        golden: '#E2C06B',
        neutral: '#F1EFED',
      },
    },
  },
  plugins: [],
};
