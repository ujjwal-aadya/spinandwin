import next from 'eslint-config-next';
import coreWebVitals from 'eslint-config-next/core-web-vitals';

// eslint-config-next 16 exports flat-config arrays, not factory functions.
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...next,
  ...coreWebVitals,
];

export default config;
