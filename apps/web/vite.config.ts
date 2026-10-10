import { Readable } from 'node:stream';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Development-only relay so the browser build can import playlists and play
 * streams despite CORS. Production builds never include it: Tauri uses the
 * Rust proxy and static deployments rely on the sources' own CORS headers.
 */
function orivueDevRelay(): Plugin {
  return {
    name: 'orivue-dev-relay',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (!url.pathname.startsWith('/__orivue/')) return next();
        const target = url.searchParams.get('url') ?? '';
        if (!/^https?:\/\//i.test(target)) {
          response.writeHead(400).end('Invalid url');
          return;
        }
        const headers: Record<string, string> = { accept: '*/*' };
        if (request.headers.range) headers.range = String(request.headers.range);
        void fetch(target, { headers, redirect: 'follow' })
          .then((upstream) => {
            const forwarded: Record<string, string> = { 'cache-control': 'no-store' };
            for (const name of [
              'content-type',
              'content-length',
              'accept-ranges',
              'content-range',
            ]) {
              const value = upstream.headers.get(name);
              if (value) forwarded[name] = value;
            }
            response.writeHead(upstream.status, forwarded);
            if (!upstream.body) return response.end();
            Readable.fromWeb(upstream.body as never).pipe(response);
            response.on('close', () => void upstream.body?.cancel().catch(() => undefined));
          })
          .catch(() => {
            if (!response.headersSent) response.writeHead(502);
            response.end('Upstream failure');
          });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), orivueDevRelay()],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version) },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { chunkSizeWarningLimit: 700 },
  test: {
    environment: 'jsdom',
    setupFiles: ['fake-indexeddb/auto', './src/test/setup.ts'],
    css: true,
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
