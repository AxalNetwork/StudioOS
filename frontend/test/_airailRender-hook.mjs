// D781 (#2106) — what App needs from the loader that one page does not.
//
//   1. A JSON import becomes a module, as Vite bundles it. `_deck-loader-hook.mjs`
//      does this for the rail's matrix only; App reaches others (the advisor
//      banks manifest, the financial snapshots).
//   2. `import.meta.env` exists. Vite replaces it at build time; under node it
//      is undefined, and a module that reads `import.meta.env.VITE_…` at its
//      top level throws before App can render. Every value is absent, as in a
//      build with no `.env`.
//
// Registered by `_airailRender.mjs` before it imports App, after the deck
// loader, so a frontend source arrives here already transformed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function load(url, context, nextLoad) {
  if (url.startsWith('file://') && new URL(url).pathname.endsWith('.json')) {
    return { format: 'module', source: `export default ${readFileSync(fileURLToPath(url), 'utf8')};`, shortCircuit: true };
  }
  const loaded = await nextLoad(url, context);
  if (url.startsWith('file://') && url.includes('/frontend/src/') && loaded.format === 'module' && loaded.source != null) {
    return { ...loaded, source: `import.meta.env = import.meta.env || { MODE: 'test', DEV: false, PROD: true };\n${String(loaded.source)}` };
  }
  return loaded;
}
