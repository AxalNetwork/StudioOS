import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@assets': path.resolve(__dirname, '../attached_assets'),
      // Task #28 — Force every `import 'react'` / `import 'react-dom'`
      // (including from transitive deps like @react-pdf/renderer,
      // recharts, react-router-dom) to resolve to the SAME physical
      // module on disk. Without these explicit aliases Vite's
      // optimizeDeps can split React across two pre-bundled chunks
      // (different `?v=` hashes), giving each chunk its own
      // ReactSharedInternals — `resolveDispatcher()` then returns null
      // and every hook call inside SpinoutLabListener / useToast
      // throws "Invalid hook call". Aliasing pins resolution before
      // optimizeDeps runs.
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
    // Task #28 — Belt-and-braces dedupe so any deeply-nested transitive
    // dep that resolves `react` / `react-dom` via `node_modules`
    // hoisting still lands on the single top-level copy.
    dedupe: ['react', 'react-dom'],
  },
  // Task #28 — Pin React + ReactDOM into the optimizeDeps include list
  // so they're always pre-bundled in the same batch (single `?v=` hash)
  // instead of being inferred lazily on first import (which can produce
  // two competing pre-bundles when a heavy dep like @react-pdf/renderer
  // pulls react-dom in on a separate optimization pass).
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  build: {
    outDir: path.resolve(__dirname, '../docs'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: ['localhost', '127.0.0.1', '.replit.dev', '.repl.co'],
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // FastAPI emits 307 redirects with an ABSOLUTE Location header
        // (e.g. `Location: https://localhost:8000/api/projects/`) when a
        // request hits a route declared as `@router.get("/")` without the
        // trailing slash. Following that absolute URL takes the user's
        // browser to `localhost:8000` (unreachable from the browser),
        // which surfaces as a "500 / Internal server error" in the UI.
        // Strip scheme+host from any Location pointing back at the
        // upstream so the browser follows the redirect through the
        // Replit proxy on the same origin.
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
    },
  },
});
