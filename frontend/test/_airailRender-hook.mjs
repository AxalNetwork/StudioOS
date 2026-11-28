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
//
// From frontend/test/README.md (moved by #6472): D781 (#2106) renders the whole app.
// `_airailRender.mjs` mounts the real `App` in a `MemoryRouter` at every route in D768's page map,
// signed in as a member of the route's profile, on `_appDom.mjs` (a DOM that keeps elements,
// attributes and text, and answers the browser APIs App calls inertly), with
// `_airailRender-hook.mjs` loading JSON modules and an empty `import.meta.env`. The Worker is
// never called: a fixture table answers the session and the pages that need data before they draw,
// and every other request answers 503, then 200 `{}`. The six
// `airail_render_<profile>_d781.test.mjs` files each render one profile, and fail on a route that
// does not draw exactly one rail with its page key unless `RENDER_NOT_YET` lists it.
// `airail_every_page_d781.test.mjs` holds the rules to fixtures.
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
