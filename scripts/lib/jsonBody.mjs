/**
 * #9184: the inventory of raw `c.req.json(...)` reads in the Worker's routes
 * and the no-growth ratchet over it. Owned by `../check-json-body.mjs` and
 * `jsonBody.test.mjs`.
 *
 * A raw read is any call of `c.req.json` in `cloudflare-worker/src/routes/`:
 * a bare `await c.req.json()` 500s on a malformed body, and the usual guard,
 * `.catch(() => ({}))`, passes a body of `null`, an array or a scalar on to a
 * line that reads its fields. `readJsonObject` (`cloudflare-worker/src/util/jsonBody.ts`)
 * answers both with a 400, so a new route reads its body through it and
 * never through `c.req.json`. Comment lines are not counted.
 *
 * Pure apart from reading files.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const ROUTES_DIR = 'cloudflare-worker/src/routes';
const READ = /\bc\.req\.json\s*[<(]/g;

/** Raw `c.req.json` reads in one source text, comment lines and block comments left out. */
export function countRawReads(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  let n = 0;
  for (const line of code.split('\n')) {
    if (/^\s*\/\//.test(line)) continue;
    n += (line.match(READ) || []).length;
  }
  return n;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/** `{ file: count }` for every routes file with at least one raw read, sorted by path. */
export function inventory({ root, dir = ROUTES_DIR }) {
  const files = {};
  for (const p of walk(join(root, dir)).sort()) {
    const n = countRawReads(readFileSync(p, 'utf8'));
    if (n) files[relative(root, p).split('\\').join('/')] = n;
  }
  return files;
}

/** Which files read more raw bodies than the baseline allows, and which now read fewer. */
export function ratchet(now, baseline) {
  const grown = [];
  const shrunk = [];
  for (const [file, n] of Object.entries(now)) {
    const was = baseline[file] ?? 0;
    if (n > was) grown.push({ file, now: n, baseline: was });
  }
  for (const [file, was] of Object.entries(baseline)) {
    const n = now[file] ?? 0;
    if (n < was) shrunk.push({ file, now: n, baseline: was });
  }
  return { grown, shrunk };
}
