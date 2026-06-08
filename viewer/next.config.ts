import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Repo has two lockfiles (root apm-core + viewer); pin tracing root to viewer
// so Next infers the correct workspace root for build traces.
// Proxy /api/* through Next so the browser fetches same-origin; the request reaches
// the no-CORS daemon server-side. Override target with APM_API_TARGET.
const API_TARGET = process.env.APM_API_TARGET ?? 'http://127.0.0.1:7842';

const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_TARGET}/api/:path*` }];
  },
};

export default config;
