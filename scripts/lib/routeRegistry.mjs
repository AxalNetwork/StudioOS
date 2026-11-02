/**
 * #4105 — the Worker's self-mounting route modules, read as text.
 *
 * A module under `cloudflare-worker/src/routes/` may export
 *
 *   export const mount: RouteMount = { path: '/api/widgets', router: widgets };
 *   export const mount: RouteMount[] = [{ path: '…', router: a, before: [b] }, …];
 *
 * and `scripts/build-route-registry.mjs` writes `routes/_registry.ts`, the list
 * `index.ts` hands to `attachRouteRegistry` (`src/util/routeRegistry.ts`, which
 * decides the order at startup). This file is the static half, shared by the
 * generator, its staleness test and every reader that resolves the Worker's
 * route table from source (`check-api-drift.mjs`, the api_drift tests):
 *
 *   - `mountModules(root)` — every module with a `mount` export, parsed:
 *     `[{ file, entries: [{ path, router, before: [ident…] }] }]`. The
 *     descriptor must be literal enough to read without running it: `path` a
 *     string literal, `router` and each `before` an identifier.
 *   - `renderRegistry(files)` — the exact text of `_registry.ts`.
 *   - `registryProblems(root)` — everything wrong with the descriptors, their
 *     `before` targets, and the committed registry.
 *   - `registeredMounts(root)` — `[{ path, file, router }]`, the routes the
 *     registry adds, for the static route-table readers.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, posix } from 'node:path';

export const WORKER_SRC_REL = 'cloudflare-worker/src';
export const ROUTES_DIR_REL = 'cloudflare-worker/src/routes';
export const REGISTRY_REL = 'cloudflare-worker/src/routes/_registry.ts';
export const INDEX_REL = 'cloudflare-worker/src/index.ts';

const MOUNT_EXPORT = /^export\s+const\s+mount\b[^=]*=/m;

/** Route module stems under routes/ (no `_` prefix, no tests), sorted. */
export function routeFiles(root) {
  const dir = resolve(root, ROUTES_DIR_REL);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.startsWith('_') && !e.name.endsWith('.d.ts'))
    .map((e) => e.name.slice(0, -3))
    .sort();
}

/** The text from `start` up to the `;` that ends the statement at bracket depth 0. */
function statementFrom(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = src.indexOf(ch, i + 1);
      if (end < 0) return null;
      i = end;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return null; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; if (i <= 0) return null; continue; }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) return src.slice(start, i);
  }
  return null;
}

/** Top-level `{…}` groups of an array literal's body. */
function objectsOf(body) {
  const out = [];
  let depth = 0;
  let from = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '{') { if (depth === 0) from = i; depth++; }
    else if (body[i] === '}') { depth--; if (depth === 0) out.push(body.slice(from, i + 1)); }
  }
  return out;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * The `mount` export of one module's source: `{ entries }` or `{ error }`;
 * `null` when the module has none.
 */
export function parseMount(src) {
  const m = MOUNT_EXPORT.exec(src);
  if (!m) return null;
  const text = statementFrom(src, m.index + m[0].length);
  if (text == null) return { error: 'the `mount` export does not end with `;`' };
  const init = stripComments(text).trim().replace(/\s+as\s+const$/, '').trim();
  const objects = init.startsWith('[') ? objectsOf(init.slice(1, -1)) : init.startsWith('{') ? [init] : null;
  if (!objects || !objects.length) return { error: 'the `mount` export must be an object literal or an array of them' };
  const entries = [];
  for (const obj of objects) {
    const body = obj.slice(1, -1);
    const keys = [...body.matchAll(/(?:^|,)\s*(\w+)\s*:/g)].map((k) => k[1]);
    const unknown = keys.filter((k) => !['path', 'router', 'before'].includes(k));
    if (unknown.length) return { error: `unknown key(s) in a mount descriptor: ${unknown.join(', ')}` };
    const path = /(?:^|,)\s*path\s*:\s*(['"])(\/[^'"]*)\1/.exec(body)?.[2];
    if (!path) return { error: 'a mount descriptor needs `path` as a string literal starting with `/`' };
    const router = /(?:^|,)\s*router\s*:\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(body)?.[1];
    if (!router) return { error: `the descriptor for ${path} needs \`router\` as an identifier` };
    let before = [];
    const b = /(?:^|,)\s*before\s*:\s*\[([^\]]*)\]/.exec(body);
    if (/(?:^|,)\s*before\s*:/.test(body) && !b) return { error: `the descriptor for ${path} needs \`before\` as an array of identifiers` };
    if (b) {
      before = b[1].split(',').map((x) => x.trim()).filter(Boolean);
      const bad = before.filter((x) => !/^[A-Za-z_$][\w$]*$/.test(x));
      if (bad.length) return { error: `\`before\` for ${path} must name routers by identifier, not ${bad.join(', ')}` };
    }
    entries.push({ path, router, before });
  }
  return { entries };
}

/** Every module under routes/ that exports `mount`: `[{ file, src, entries?, error? }]`. */
export function mountModules(root) {
  const out = [];
  for (const file of routeFiles(root)) {
    const src = readFileSync(resolve(root, ROUTES_DIR_REL, `${file}.ts`), 'utf8');
    const parsed = parseMount(src);
    if (parsed) out.push({ file, src, ...parsed });
  }
  return out;
}

/** `local → { file (repo-relative, no extension), name ('default' or the export) }` for a source's relative imports. */
export function importBindings(src, fromDirRel) {
  const map = new Map();
  const re = /import\s+(?!type\b)(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}\s*)?from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const norm = posix.join(fromDirRel, m[3]).replace(/\.ts$/, '');
    if (m[1]) map.set(m[1], { file: norm, name: 'default' });
    if (m[2]) {
      for (const part of m[2].split(',')) {
        const p = part.trim().replace(/^type\s+/, '');
        if (!p) continue;
        const [name, local] = p.split(/\s+as\s+/).map((x) => x.trim());
        map.set(local || name, { file: norm, name });
      }
    }
  }
  return map;
}

/** The name `ident` is exported under in `src`, or null when it is not exported. */
function exportNameOf(src, ident) {
  // Fixed patterns, compared by name: no regex is built from `ident`.
  for (const m of src.matchAll(/^export\s+default\s+([\w$]+)\s*;/gm)) if (m[1] === ident) return 'default';
  for (const m of src.matchAll(/^export\s+(?:const|let|function)\s+([\w$]+)(?![\w$])/gm)) if (m[1] === ident) return ident;
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}\s*;/gm)) {
    for (const part of m[1].split(',')) {
      const [name, alias] = part.trim().split(/\s+as\s+/).map((x) => x.trim());
      if (name === ident) return alias || name;
    }
  }
  return null;
}

const declares = (src, ident) => [...src.matchAll(/(?:^|[^\w$.])(?:const|let|var)\s+([\w$]+)\s*[=:]/g)].some((m) => m[1] === ident);

/**
 * The routers `index.ts` still mounts by hand, as `file#exportName` keys, with
 * the local identifier each is mounted under.
 */
export function legacyMounts(root) {
  const src = readFileSync(resolve(root, INDEX_REL), 'utf8');
  const imports = importBindings(src, WORKER_SRC_REL);
  const keys = new Map();
  for (const m of src.matchAll(/\bapp\s*\.\s*route\(\s*['"`]([^'"`]*)['"`]\s*,\s*([\w$]+)/g)) {
    const b = imports.get(m[2]);
    if (b) keys.set(`${b.file}#${b.name}`, m[2]);
  }
  return keys;
}

/** The exact text of the generated `_registry.ts` for these module stems. */
export function renderRegistry(files) {
  const sorted = [...files].sort();
  const ident = (f) => `${f.replace(/[^\w$]/g, '_')}Mount`;
  return [
    '// GENERATED by scripts/build-route-registry.mjs (#4105) — do not edit.',
    '// One import per route module that exports `mount`, in file-name order.',
    '// The mount ORDER is not this list: src/util/routeRegistry.ts plans it',
    '// at startup from each descriptor\'s `before`. Add a module by adding its',
    '// file and running `node scripts/build-route-registry.mjs`;',
    '// cloudflare-worker/test/route_registry_4105.test.ts fails while stale.',
    "import type { RegisteredModule } from '../util/routeRegistry';",
    ...sorted.map((f) => `import { mount as ${ident(f)} } from './${f}';`),
    '',
    'export const ROUTE_MODULES: readonly RegisteredModule[] = [',
    ...sorted.map((f) => `  { file: '${f}', mount: ${ident(f)} },`),
    '];',
    '',
  ].join('\n');
}

/**
 * `[{ path, file, router }]` for every registered mount — `file` the
 * repo-relative module path, `router` its local identifier — for readers that
 * resolve the route table from source. Unparseable modules are skipped here;
 * `registryProblems` reports them.
 */
export function registeredMounts(root) {
  const out = [];
  for (const mod of mountModules(root)) {
    for (const e of mod.entries || []) {
      out.push({ path: e.path, file: `${ROUTES_DIR_REL}/${mod.file}.ts`, router: e.router });
    }
  }
  return out;
}

/** Everything wrong with the registered modules and the committed registry. Empty when sound. */
export function registryProblems(root) {
  const problems = [];
  const mods = mountModules(root);
  const legacy = existsSync(resolve(root, INDEX_REL)) ? legacyMounts(root) : new Map();
  // Every registered router, as a `file#exportName` key.
  const registered = new Map();
  for (const mod of mods) {
    if (mod.error) { problems.push(`routes/${mod.file}.ts: ${mod.error}`); continue; }
    mod.entries.forEach((e, i) => {
      if (!declares(mod.src, e.router)) problems.push(`routes/${mod.file}.ts: \`${e.router}\` (mount ${e.path}) is not a router declared in the file`);
      const name = exportNameOf(mod.src, e.router) ?? `local:${e.router}`;
      const key = `${ROUTES_DIR_REL}/${mod.file}#${name}`;
      registered.set(key, `${mod.file}[${i}]`);
      if (legacy.has(key)) problems.push(`routes/${mod.file}.ts: \`${e.router}\` is registered by its \`mount\` export AND mounted by hand in index.ts — remove the index.ts line`);
    });
  }
  // Each `before` names a router that is registered or mounted by index.ts.
  const edges = new Map();
  for (const mod of mods) {
    if (mod.error) continue;
    const imports = importBindings(mod.src, ROUTES_DIR_REL);
    mod.entries.forEach((e, i) => {
      const from = `${mod.file}[${i}]`;
      for (const id of e.before) {
        let key;
        const imp = imports.get(id);
        if (imp) key = `${imp.file}#${imp.name}`;
        else if (declares(mod.src, id)) key = `${ROUTES_DIR_REL}/${mod.file}#${exportNameOf(mod.src, id) ?? `local:${id}`}`;
        if (!key) { problems.push(`routes/${mod.file}.ts: \`before: [${id}]\` (mount ${e.path}) is neither imported nor declared in the file`); continue; }
        if (registered.has(key)) {
          if (!edges.has(from)) edges.set(from, new Set());
          edges.get(from).add(registered.get(key));
        } else if (!legacy.has(key)) {
          problems.push(`routes/${mod.file}.ts: \`before: [${id}]\` (mount ${e.path}) names a router that is neither registered nor mounted by index.ts`);
        }
      }
    });
  }
  // A module's own array is an order too (src/util/routeRegistry.ts).
  for (const mod of mods) {
    if (mod.error) continue;
    for (let i = 1; i < mod.entries.length; i++) {
      const from = `${mod.file}[${i - 1}]`;
      if (!edges.has(from)) edges.set(from, new Set());
      edges.get(from).add(`${mod.file}[${i}]`);
    }
  }
  // No cycle among registered routers.
  const state = new Map();
  const visit = (n, trail) => {
    if (state.get(n) === 'done') return;
    if (state.get(n) === 'busy') { problems.push(`\`before\` forms a cycle: ${[...trail, n].join(' → ')}`); return; }
    state.set(n, 'busy');
    for (const m of edges.get(n) || []) visit(m, [...trail, n]);
    state.set(n, 'done');
  };
  for (const n of edges.keys()) visit(n, []);
  // The committed registry is exactly what the generator writes.
  const want = renderRegistry(mods.map((m) => m.file));
  const file = resolve(root, REGISTRY_REL);
  const have = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (have !== want) problems.push(`${REGISTRY_REL} is ${have == null ? 'missing' : 'stale'} — run: node scripts/build-route-registry.mjs`);
  return problems;
}

