import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Transpile dev-served source AND pre-bundled deps down to es2020 so older
  // Safari doesn't hit a silent parse error (blank white page). Dev-only
  // concern: prod builds already target lower via build defaults.
  // Vite 8 (rolldown) uses oxc — the legacy `esbuild` key is silently
  // IGNORED ("oxc options will be used and esbuild options will be ignored"),
  // which re-broke the Safari blank page. Set the target on `oxc` instead.
  oxc: { target: 'es2020' },
  resolve: {
    alias: {
      '@assets': path.resolve(__dirname, '../attached_assets'),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      '@react-pdf/renderer',
      'recharts',
      'react-router-dom',
      'react-markdown',
      'react-window',
      'lucide-react',
    ],
  },
  build: {
    outDir: path.resolve(__dirname, '../docs'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Keep the React runtime (react, react-dom, router, scheduler) in one
        // stable, long-cached chunk so it survives app-code redeploys and is
        // shared across every route. Everything else keeps Rollup's automatic
        // per-import code-splitting so route/feature chunks stay independent.
        manualChunks(id) {
          if (id.includes('node_modules') &&
              /[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'react-vendor';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    headers: {
      'Cache-Control': 'no-store',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const loc = proxyRes.headers && proxyRes.headers.location;
            if (typeof loc === 'string') {
              try {
                const u = new URL(loc);
                if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
                  proxyRes.headers.location = u.pathname + u.search + u.hash;
                }
              } catch { /* not an absolute URL — leave it alone */ }
            }
          });
        },
      },
      // Backend-rendered public landing surfaces (Brand & Landing Pages).
      // The dev FastAPI serves /landing/preview/:token, /landing/:slug and
      // the branded multi-page sites at /p/:site/:page — without these the
      // "View Live" preview URLs 404 on the Vite origin in dev.
      '/landing': { target: 'http://localhost:8000', changeOrigin: true },
      '/p/': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
});
