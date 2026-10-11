import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
const config = [
 {ignores:['.next/**','dist/**','.cloudflare/**','.migration/**','weixin/**','acceptance-weixin/**','next-env.d.ts','.venv/**']},
 ...nextVitals,...nextTypescript,
 // Migration baseline: retain visible debt warnings, not silent exclusions.
 {files:['**/*.{js,jsx,ts,tsx,mjs}'],plugins:{'react-hooks':nextVitals.find(c=>c.plugins?.['react-hooks']).plugins['react-hooks']},rules:{'@typescript-eslint/no-explicit-any':'warn',
  'react-hooks/set-state-in-effect':'warn','react-hooks/purity':'warn',
  'react-hooks/preserve-manual-memoization':'warn'}},
];
export default config;
