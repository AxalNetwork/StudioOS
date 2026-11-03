import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// `cloudflare:workers` exists only inside workerd. Libraries that import it
// for a base class (D666: @cloudflare/workers-oauth-provider checks whether a
// handler `extends WorkerEntrypoint`) get empty classes here, which is all
// such a check needs. Nothing in a test runs a real entrypoint.
const CLOUDFLARE_WORKERS = 'data:text/javascript,' + encodeURIComponent(
  'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }\n'
  + 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }\n'
  + 'export class RpcTarget {}\nexport class WorkflowEntrypoint {}\nexport const env = {};\n'
  // #3852: the Agents SDK also names `exports` (ctx.exports) and `WorkflowEvent`.
  + 'export const exports = {};\nexport class WorkflowEvent {}\n',
);

// #3852: the Agents SDK (`agents`, imported only by src/agents/sdkRuntime.ts,
// which src/index.ts exports) also imports `cloudflare:email` for its email
// helpers. No test sends mail through it; an empty class lets the module load.
const CLOUDFLARE_EMAIL = 'data:text/javascript,' + encodeURIComponent(
  'export class EmailMessage { constructor(from, to, raw) { this.from = from; this.to = to; this.raw = raw; } }\n',
);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return { url: CLOUDFLARE_WORKERS, shortCircuit: true };
  if (specifier === 'cloudflare:email') return { url: CLOUDFLARE_EMAIL, shortCircuit: true };
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    try {
      const parentURL = context.parentURL ? new URL(specifier, context.parentURL) : null;
      if (parentURL) {
        const p = fileURLToPath(parentURL);
        // Already has an extension we recognise? defer.
        if (!/\.(ts|js|mjs|cjs|json)$/.test(p)) {
          if (existsSync(p + '.ts')) {
            return nextResolve(specifier + '.ts', context);
          }
          if (existsSync(p) && statSync(p).isDirectory() && existsSync(p + '/index.ts')) {
            return nextResolve(specifier + '/index.ts', context);
          }
        }
      }
    } catch { /* fall through */ }
  }
  return nextResolve(specifier, context);
}

// Markdown as text, the way wrangler.toml's `[[rules]] type = "Text"` bundles
// it. services/legalTemplates.ts imports every legal template as
// `…/x.md?raw`, so without this no test could load a route that reaches
// `createAndSendEnvelope` (esign_send_hardening_d410.test.ts is the first).
// Only `.md` under file: URLs; everything else goes to the next loader.
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:')) {
    const u = new URL(url);
    if (u.pathname.endsWith('.md')) {
      const text = readFileSync(fileURLToPath(new URL(u.pathname, 'file://')), 'utf8');
      return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
    }
    // D764 — the rail's model matrix as a JSON module, the way wrangler
    // bundles an imported `.json`. Only that file, so no other JSON changes.
    // D1541 — the deck icon set (`services/decks/iconSet.json`), the same way.
    // D1612 part D (#3954) — the starter skills' golden cases (`services/agents/skills/cases/*.json`).
    if (u.pathname.endsWith('/services/ai/railMatrix.json') || u.pathname.endsWith('/services/decks/iconSet.json')
      || /\/services\/agents\/skills\/cases\/[a-z0-9-]+\.json$/.test(u.pathname)) {
      const text = readFileSync(fileURLToPath(new URL(u.pathname, 'file://')), 'utf8');
      return { format: 'module', source: `export default ${text};`, shortCircuit: true };
    }
    // D711 — the legal paper's faces and mark as ArrayBuffers, the way
    // wrangler.toml's `[[rules]] type = "Data"` bundles them.
    if (u.pathname.endsWith('.woff2') || u.pathname.endsWith('.png')) {
      const b64 = readFileSync(fileURLToPath(new URL(u.pathname, 'file://'))).toString('base64');
      return {
        format: 'module',
        source: `const b = Buffer.from(${JSON.stringify(b64)}, 'base64'); export default b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);`,
        shortCircuit: true,
      };
    }
  }
  return nextLoad(url, context);
}
