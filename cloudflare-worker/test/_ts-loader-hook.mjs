import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// `cloudflare:workers` exists only inside workerd. Libraries that import it
// for a base class (D666: @cloudflare/workers-oauth-provider checks whether a
// handler `extends WorkerEntrypoint`) get empty classes here, which is all
// such a check needs. Nothing in a test runs a real entrypoint.
const CLOUDFLARE_WORKERS = 'data:text/javascript,' + encodeURIComponent(
  'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }\n'
  + 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }\n'
  + 'export class RpcTarget {}\nexport class WorkflowEntrypoint {}\nexport const env = {};\n',
);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return { url: CLOUDFLARE_WORKERS, shortCircuit: true };
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
  }
  return nextLoad(url, context);
}
