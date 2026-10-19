/**
 * D768 (#2092) — every `<Route path>` in `App.jsx` and `frontend/src/routes/`
 * (the same source `_routesSource.mjs` reads), with the roles its guard
 * admits and whether its element can draw the rail.
 *
 * "Can draw the rail" is read from imports, not from a render: a route's
 * element names components; a component whose file reaches
 * `frontend/src/ui/WorkerRail.jsx` through its imports can draw it. App.jsx's
 * wrappers that add a shell (`founderWorkspace(…)`, `investorWorkspace(…)`)
 * count as the shell they add. Reading imports over-counts a page that only
 * imports the rail, which is the safe side: such a page needs a key or a line
 * in `NO_RAIL_ROUTES` saying why it has none.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const SRC = resolve('frontend/src');
const RAIL = resolve(SRC, 'ui/WorkerRail.jsx');
const EXTS = ['', '.jsx', '.js', '/index.jsx', '/index.js'];
const HELPERS = { founderWorkspace: 'FounderWorkspacePage', investorWorkspace: 'InvestorWorkspacePage', investorFundWorkspace: 'InvestorWorkspacePage' };
const NOT_COMPONENTS = new Set(['Route', 'Navigate', 'Suspense', 'Fragment']);

function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const e of EXTS) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

const importsOf = new Map();
function imports(file) {
  if (!importsOf.has(file)) {
    const src = readFileSync(file, 'utf8');
    const out = [];
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const r = resolveImport(file, m[1] || m[2]);
      if (r) out.push(r);
    }
    importsOf.set(file, out);
  }
  return importsOf.get(file);
}

const reaches = new Map();
function reachesRail(file) {
  if (reaches.has(file)) return reaches.get(file);
  const seen = new Set([file]);
  const queue = [file];
  let hit = false;
  while (queue.length && !hit) {
    for (const f of imports(queue.shift())) {
      if (f === RAIL) { hit = true; break; }
      if (!seen.has(f)) { seen.add(f); queue.push(f); }
    }
  }
  reaches.set(file, hit);
  return hit;
}

function components(src, file) {
  const comp = new Map();
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/g)) comp.set(m[1], resolveImport(file, m[2]));
  for (const m of src.matchAll(/import\s+(\w+)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s+['"]([^'"]+)['"]/g)) {
    const f = resolveImport(file, m[3]);
    if (!f) continue;
    if (m[1]) comp.set(m[1], f);
    for (const n of (m[2] || '').split(',')) {
      const k = n.trim().split(/\s+as\s+/).pop();
      if (k) comp.set(k, f);
    }
  }
  return comp;
}

/** `[{ path, roles, rail }]`: `rail` is true when the element can draw the rail. */
export function railRoutes() {
  const files = [resolve(SRC, 'App.jsx'), ...readdirSync(resolve(SRC, 'routes')).filter((f) => f.endsWith('.jsx')).map((f) => resolve(SRC, 'routes', f))];
  const rows = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const comp = components(src, file);
    for (const b of src.split('<Route ').slice(1)) {
      const pm = /path="([^"]+)"/.exec(b.slice(0, 200));
      if (!pm) continue;
      const body = b.split(/\n\s*<\/?Routes?\b/)[0];
      const names = [...new Set([...body.matchAll(/<([A-Z]\w*)/g)].map((m) => m[1]))].filter((n) => !NOT_COMPONENTS.has(n));
      for (const [h, c] of Object.entries(HELPERS)) if (new RegExp(`\\b${h}\\(`).test(body)) names.push(c);
      const roles = [...new Set([...body.matchAll(/(?:guard|labRoles)\(\s*\[([^\]]*)\]/g)]
        .flatMap((m) => m[1].split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean)))];
      rows.push({ path: pm[1], roles, rail: names.some((n) => comp.get(n) && reachesRail(comp.get(n))) });
    }
  }
  return rows;
}
