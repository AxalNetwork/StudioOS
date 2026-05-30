// ESM loader hook that lets `node --test` import the React/TSX deck
// templates directly. Two responsibilities:
//
//   1. resolve() — append the right extension to extensionless relative
//      imports (the source uses moduleResolution=bundler, so `../DeckBase`
//      and `../../lib/pitchCopyLength` have no suffix on disk).
//   2. load() — transform `.ts`/`.tsx`/`.jsx` source to plain JS via Vite's
//      Oxc transform (Vite 8 dropped the bundled esbuild), emitting the
//      automatic React JSX runtime so `react/jsx-runtime` is used.
//
// Used by frontend/test/spinout_demoday_deck.test.mjs via:
//   node --import ./frontend/test/_deck-loader.mjs --test …
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TRY_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'];
const TRANSFORM_EXTS = /\.(tsx|ts|jsx)$/;

let _transform = null;
async function getTransform() {
  if (!_transform) {
    const vite = await import('vite');
    _transform = vite.transformWithOxc;
  }
  return _transform;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    try {
      const parentURL = context.parentURL ? new URL(specifier, context.parentURL) : null;
      if (parentURL) {
        const p = fileURLToPath(parentURL);
        if (!/\.(tsx|ts|jsx|js|mjs|cjs|json)$/.test(p)) {
          for (const ext of TRY_EXTS) {
            if (existsSync(p + ext)) {
              return { url: pathToFileURL(p + ext).href, shortCircuit: true };
            }
          }
          if (existsSync(p) && statSync(p).isDirectory()) {
            for (const ext of TRY_EXTS) {
              if (existsSync(p + '/index' + ext)) {
                return { url: pathToFileURL(p + '/index' + ext).href, shortCircuit: true };
              }
            }
          }
        }
      }
    } catch { /* fall through to default resolver */ }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file://') && TRANSFORM_EXTS.test(new URL(url).pathname)) {
    const filename = fileURLToPath(url);
    const source = readFileSync(filename, 'utf8');
    const transform = await getTransform();
    const { code } = await transform(source, filename, {
      jsx: { runtime: 'automatic' },
    });
    return { format: 'module', source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
