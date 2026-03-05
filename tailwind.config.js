/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        ocean: {
          5: '#FAFCFD',
          10: '#F5FAFC',
          20: '#ECF4F7',
          30: '#E7F2F5',
          40: '#C2DAE4',
          60: '#94BFCE',
          80: '#6B9FB3',
          100: '#528A9F',
          120: '#36677D',
          150: '#264759',
          180: '#13212C',
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
