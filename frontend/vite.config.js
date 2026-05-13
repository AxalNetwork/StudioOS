import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    force: true,
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
    },
  },
});
