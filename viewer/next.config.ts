import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Repo has two lockfiles (root apm-core + viewer); pin tracing root to viewer
// so Next infers the correct workspace root for build traces.
const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
};

export default config;
