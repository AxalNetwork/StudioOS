import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import fs from 'fs';
import { cspLine, policyForShell, policyInHeaders, withPolicy } from '../scripts/lib/spaCsp.mjs';

const disableRocketLoader = {
  name: 'disable-cloudflare-rocket-loader',
  enforce: 'post',
  transformIndexHtml: {
    order: 'post',
    handler(html) {
      return html.replace(
        /<script type="module"/g,
        '<script data-cfasync="false" type="module"',
      );
    },
  },
};

// D9166 (#9166): the shell's Content-Security-Policy, computed from the built
// shell. Once Vite has written docs/ (public/ copied in), this hashes every
// executable inline <script> and inline event handler in docs/index.html and
// writes the policy into docs/_headers (scripts/lib/spaCsp.mjs builds it). The
// same line is committed in frontend/public/_headers, because the PR preview
// copies that file as-is and the Worker's record cards mirror it
// (socialCards.ts SHELL_HEADERS); a build whose shell no longer matches the
// committed line fails here and names the line to commit. SPA_CSP_WRITE=1
// writes it into frontend/public/_headers instead of failing.
const spaCsp = {
  name: 'spa-csp',
  apply: 'build',
  closeBundle: {
    order: 'post',
    sequential: true,
    handler() {
      const outDir = path.resolve(__dirname, '../docs');
      const sourcePath = path.resolve(__dirname, 'public/_headers');
      const policy = policyForShell(fs.readFileSync(path.join(outDir, 'index.html'), 'utf8'));
      const source = fs.readFileSync(sourcePath, 'utf8');
      if (policyInHeaders(source) !== policy) {
        if (process.env.SPA_CSP_WRITE !== '1') {
          throw new Error(
            '[spa-csp] frontend/public/_headers carries a stale shell CSP: the inline scripts in index.html changed (D9166).\n'
            + `Commit this line under its /* rule, and the same value as SHELL_HEADERS in cloudflare-worker/src/services/socialCards.ts:\n${cspLine(policy)}\n`
            + 'Or run the build with SPA_CSP_WRITE=1 to write it into frontend/public/_headers.',
          );
        }
        fs.writeFileSync(sourcePath, withPolicy(source, policy));
      }
      const built = path.join(outDir, '_headers');
      fs.writeFileSync(built, withPolicy(fs.readFileSync(built, 'utf8'), policy));
    },
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), disableRocketLoader, spaCsp],
  // Oxc's es2020 target applies to transformed dev sources, not plain .js.
  // Production uses Vite 8's baseline-widely-available default (Safari 16.4).
  // A lower target cannot make unsupported RegExp features work at runtime;
  // source regexes must remain compatible with older Safari (#3592).
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
    // Keep pre-bundled deps at es2020 so Safari doesn't hit a parse error
    // on newer syntax in third-party packages (Vite 8 uses Rolldown for
    // optimizeDeps; esbuildOptions is deprecated, use rolldownOptions).
    rolldownOptions: { output: { format: 'es' } },
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
