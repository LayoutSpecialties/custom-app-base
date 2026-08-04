// Flat ESLint config. Next 16 removed `next lint`, and ESLint 9 no longer reads
// `.eslintrc.json`, so we consume eslint-config-next's flat config directly.
import next from 'eslint-config-next/core-web-vitals';

export default [...next];
