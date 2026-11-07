/**
 * #4570 (S1 of #4554) — the authorization inventory of the production Worker.
 *
 * Every (METHOD, path) the Worker serves, read statically from the same mounts
 * the API drift guard resolves (index.ts's `app.route` lines and the
 * self-mounting routes in routes/_registry.ts), with:
 *
 *   gate      the strongest identity gate the handler reaches:
 *               super_admin  requireSuperAdmin / requireSuperAdminWriteBar
 *               hq_admin     requireHqAdmin / requireHqAuthoring
 *               admin        requireAdmin, requireRole(… 'admin' …)
 *               cf_access    requireCfAccess (Cloudflare Access on the path)
 *               authenticated  requireAuth, requireApprovedKyc, requireStepUp, requireFactor
 *               optional_auth  getCurrentUser only: a signed-in caller is read, none is required
 *               service      a signature, shared secret or token check (webhooks, cron, signed links)
 *               forwarded    hands the request to another router; the gate is the target's
 *               public       none of the above
 *   evidence  the record-ownership checks it reaches (canAccessProject,
 *             getProjectMembershipRole, canAccessFounderResource, …): what scopes
 *             a read or write to the caller's own tenant, company, project or fund.
 *   review    why the route needs a person to look, or null: no gate found, a
 *             forward to another router, an optional sign-in, or an authenticated
 *             route that names a record (`:id`, `:uid`, …) with no ownership evidence.
 *             Unknown authorization is review required, never assumed safe.
 *
 * "Reaches" is static and bounded: the handler's own text, the router and app
 * middleware whose path covers it, and the bodies of functions it calls that
 * are declared in its file or imported from a relative module (two levels).
 * A gate the reader cannot see is reported as weaker than it is — never
 * stronger — so the error is always towards review.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { registeredMounts } from './routeRegistry.mjs';

export const GATES = ['public', 'forwarded', 'optional_auth', 'service', 'authenticated', 'cf_access', 'admin', 'hq_admin', 'super_admin'];

const GATE_TOKENS = [
  // A gate is called (`requireAuth(c)`) or handed to a wrapper (`gate(c, requireSuperAdmin)`).
  ['super_admin', /\brequireSuperAdmin(?:WriteBar)?\b/],
  ['hq_admin', /\brequireHq(?:Admin|Authoring)\b/],
  ['admin', /\brequireAdmin\b|\brequireRole\s*\([^)]*['"]admin['"]/],
  ['cf_access', /\brequireCfAccess\b/],
  ['authenticated', /\brequire(?:Auth|ApprovedKyc|StepUp|Factor)\b|\bauthenticateForUpgrade\s*\(/],
  ['service', /\b(?:verify\w*Signature|verifyWebhook\w*|timingSafeEqual|constantTimeEqual|safeEqual|verifyHmac\w*|hmacVerify\w*|verifySigned\w*|verifyToken\w*|requireCronSecret|requireServiceToken)\s*\(/],
  ['optional_auth', /\bgetCurrentUser\s*\(/],
  // Hands the request to another router (`relay(c, …)`, `r.fetch(new Request(…))`): the gate is the target's, which this reader does not follow.
  ['forwarded', /\.fetch\(\s*(?:new\s+Request\b|\w+\s*,\s*c\.env\b)|\brelay\s*\(\s*c\b/],
];

/** Ownership checks: what scopes a record to the caller. */
export const EVIDENCE_TOKENS = [
  'canAccessProject', 'getProjectMembershipRole', 'getMemberProjectIds', 'isProjectManager', 'canAccessFounderResource',
  'entityListScope', 'canViewLpData', 'canViewPartnerDemand', 'canEdit', 'canView', 'canRead', 'canWrite', 'canManage',
  'requireProjectAccess', 'requireCompanyAccess', 'requireCompanyMember', 'requireCompanyEditor', 'requireFundAccess',
  'assertOwner', 'requireOwner', 'ownsProject', 'isCompanyMember', 'companyRoleOf', 'memberRole', 'scopeAccess',
];
const EVIDENCE_RE = new RegExp(`\\b(${EVIDENCE_TOKENS.join('|')})\\s*\\(`, 'g');
// A query that binds the caller's own id is evidence too: `founder_id = ?` … `.bind(user.id`.
const OWNER_SQL_RE = /\b(?:founder_id|user_id|owner_id|created_by|sponsor_user_id|investor_user_id)\s*=\s*\?/;

// ── Source reading ──────────────────────────────────────────────────────────

/** The index just past the bracket that closes the one at `open`; strings, templates and comments skipped. */
export function closeOf(src, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [pairs[src[open]]];
  let i = open + 1;
  while (i < src.length && stack.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; continue; }
    if (ch === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
    if (ch === '"' || ch === "'") {
      i += 1;
      while (i < src.length && src[i] !== ch && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
      i += 1; continue;
    }
    if (ch === '`') {
      i += 1;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { i = closeOf(src, i + 1); continue; }
        i += 1;
      }
      i += 1; continue;
    }
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) stack.pop();
    i += 1;
  }
  return i;
}

const lineOf = (src, at) => src.slice(0, at).split('\n').length;

function importMap(src, fromDir) {
  const map = new Map();
  const re = /import\s+(?:type\s+)?(?:(\w+)\s*,\s*)?(?:\{([^}]*)\}\s*)?(?:(\w+)\s*)?from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const file = resolve(fromDir, m[4].replace(/\.(ts|js|mjs)$/, '')) + '.ts';
    if (m[1]) map.set(m[1], { file, name: 'default' });
    if (m[3]) map.set(m[3], { file, name: 'default' });
    if (m[2]) {
      for (const part of m[2].split(',')) {
        const bits = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
        const local = bits.pop()?.trim();
        if (local) map.set(local, { file, name: (bits[0] ?? local).trim() });
      }
    }
  }
  // `const { a, b: c } = await import('./x')`: the same names, loaded when used.
  for (const d of src.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    const file = resolve(fromDir, d[2].replace(/\.(ts|js|mjs)$/, '')) + '.ts';
    for (const part of d[1].split(',')) {
      const [name, local] = part.split(':').map((x) => x.trim());
      if (name) map.set(local || name, { file, name });
    }
  }
  return map;
}

const cache = new Map();
function readSrc(file) {
  if (!cache.has(file)) cache.set(file, existsSync(file) ? readFileSync(file, 'utf8') : null);
  return cache.get(file);
}

/** The body text of a function `name` declared at top level in `src`, or null. */
const declared = new Map();
/** Each top-level-looking declaration in `src`, by name: one pass over the file, not one per name asked. */
function declarationsOf(src) {
  if (declared.has(src)) return declared.get(src);
  const fns = new Map(), vars = new Map();
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]/g)) if (!fns.has(m[1])) fns.set(m[1], m);
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?/g)) if (!vars.has(m[1])) vars.set(m[1], m);
  const out = { fns, vars };
  declared.set(src, out);
  return out;
}

export function functionBody(src, name) {
  const { fns, vars } = declarationsOf(src);
  const decl = fns.get(name);
  if (decl) {
    // Past the parameter list, then past a return type (`: Promise<{ … } | Response>`): the first brace outside `<…>`.
    const open = src.indexOf('(', decl.index + decl[0].length - 1);
    let i = closeOf(src, open);
    let angle = 0;
    for (; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '<') angle += 1;
      else if (ch === '>' && src[i - 1] !== '=') angle -= 1;
      else if (ch === '{' && angle <= 0) break;
      else if (ch === ';' && angle <= 0) return null;
    }
    return i >= src.length ? null : src.slice(i, closeOf(src, i));
  }
  const arrow = vars.get(name);
  if (!arrow) return null;
  let i = arrow.index + arrow[0].length;
  if (src[i] !== '(') {
    // `const x = factory(…)` or a bare identifier: the call itself is the body worth reading.
    const end = src.indexOf('\n', i);
    return src[i] && /[\w$]/.test(src[i]) ? src.slice(i, end < 0 ? undefined : end) : null;
  }
  i = closeOf(src, i);
  const arrowAt = src.indexOf('=>', i);
  if (arrowAt < 0 || src.slice(i, arrowAt).includes(';')) return src.slice(arrow.index, i);
  let j = arrowAt + 2;
  while (/\s/.test(src[j] ?? '')) j += 1;
  // A block, or an expression (`async (c) => { … }`, `wrap(…)`): read it whole, stepping over each bracket, to its `;` or blank line.
  let k = j;
  while (k < src.length) {
    const ch = src[k];
    if (ch === '(' || ch === '[' || ch === '{') { k = closeOf(src, k); continue; }
    if (ch === ';' || (ch === '\n' && src[k + 1] === '\n')) break;
    k += 1;
  }
  return src.slice(j, k);
}

/** `text` plus the bodies of the functions it calls, from its file or a relative import, `depth` levels down. */
function reach(text, src, file, depth) {
  if (depth <= 0) return text;
  if (!importsOf.has(file)) importsOf.set(file, importMap(src, dirname(file)));
  const imports = importsOf.get(file);
  // Functions called, and functions handed on by name (`r.post('/x', handler)`, `gate(c, requireAdmin)`).
  const called = [...text.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\(/g)].map((m) => m[1]);
  const handed = [...text.matchAll(/[(,]\s*([A-Za-z_$][\w$]*)\s*(?=[,)])/g)].map((m) => m[1]);
  const parts = [text];
  for (const name of new Set([...called, ...handed])) {
    if (/^(if|for|while|switch|return|await|function|catch|typeof|new|c|env|user|e)$/.test(name)) continue;
    if (bodyIn(file, src, name) != null) { parts.push(expand(file, name, depth - 1)); continue; }
    const imp = imports.get(name);
    if (imp) parts.push(expand(imp.file, imp.name === 'default' ? name : imp.name, depth - 1));
  }
  return parts.join('\n');
}

const bodies = new Map();
function bodyIn(file, src, name) {
  const key = `${file}|${name}`;
  if (!bodies.has(key)) bodies.set(key, functionBody(src, name));
  return bodies.get(key);
}
const importsOf = new Map();

// One expansion per function and depth: route files call the same helpers hundreds of times.
const expanded = new Map();
function expand(file, name, depth) {
  const key = `${file}|${name}|${depth}`;
  if (expanded.has(key)) return expanded.get(key);
  expanded.set(key, ''); // a cycle reads as nothing more
  const src = readSrc(file);
  const body = src && bodyIn(file, src, name);
  const out = body ? reach(body, src, file, depth) : '';
  expanded.set(key, out);
  return out;
}

export const REACH_DEPTH = 3;

// ── The route table ─────────────────────────────────────────────────────────

const defaultExportIdent = (src) => (src.match(/export\s+default\s+(\w+)/) || [])[1] || null;
function declaresIdent(src, ident) {
  return new RegExp(`(?:^|[^\\w$])(?:function\\s+${ident}\\s*\\(|(?:const|let|var)\\s+${ident}\\s*(?::[^=\\n]+)?=)`).test(src);
}

/** Does a Hono path pattern (`*`, `/x/*`, `/x/:id`) cover the sub-path `sub`? */
export function covers(pattern, sub) {
  if (pattern == null || pattern === '*' || pattern === '/*') return true;
  const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\/\*$/, '(?:/.*)?').replace(/\*/g, '.*').replace(/:[A-Za-z_]\w*/g, '[^/]+')}$`);
  return re.test(sub || '/') || re.test(sub);
}

/** Every route: `{ method, path, file, line, text }`, `text` being what its gate is read from. */
export function routeTable(root) {
  const workerSrc = resolve(root, 'cloudflare-worker/src');
  const indexFile = resolve(workerSrc, 'index.ts');
  const routes = [];
  const visited = new Set();

  function crawl(file, prefix, depth, mountedIdent, inherited) {
    const key = `${file}|${prefix}`;
    const src = readSrc(file);
    if (depth > 8 || visited.has(key) || src == null) return;
    visited.add(key);
    const imports = importMap(src, dirname(file));
    const ident = mountedIdent && declaresIdent(src, mountedIdent) ? mountedIdent : defaultExportIdent(src);
    if (!ident) return;
    const uses = [];
    for (const m of src.matchAll(new RegExp(`\\b${ident}\\s*\\.\\s*use\\(`, 'g'))) {
      const open = m.index + m[0].length - 1;
      const call = src.slice(open, closeOf(src, open));
      const pat = /^\(\s*['"`]([^'"`]*)['"`]/.exec(call)?.[1] ?? null;
      uses.push({ pattern: pat, text: reach(call, src, file, REACH_DEPTH) });
    }
    for (const m of src.matchAll(new RegExp(`\\b${ident}\\s*\\.\\s*(get|post|put|patch|delete|all)\\(\\s*(['"\`])([^'"\`]*)\\2`, 'g'))) {
      const open = m.index + m[0].indexOf('(');
      const call = src.slice(open, closeOf(src, open));
      const sub = m[3] === '/' ? '' : m[3];
      const mw = uses.filter((u) => covers(u.pattern, sub)).map((u) => u.text);
      routes.push({
        method: m[1].toUpperCase(), path: (prefix + sub).replace(/\/+$/, '') || prefix,
        file: relative(root, file), line: lineOf(src, m.index),
        text: [...inherited, ...mw, reach(call, src, file, REACH_DEPTH)].join('\n'),
      });
    }
    for (const m of src.matchAll(new RegExp(`\\b${ident}\\s*\\.\\s*route\\(\\s*['"\`]([^'"\`]*)['"\`]\\s*,\\s*(\\w+)`, 'g'))) {
      const target = imports.get(m[2]);
      const sub = m[1] === '/' ? '' : m[1];
      const mw = uses.filter((u) => covers(u.pattern, sub) || covers(u.pattern, `${sub}/x`)).map((u) => u.text);
      if (target) crawl(target.file, prefix + sub, depth + 1, m[2], [...inherited, ...mw]);
    }
  }

  const idx = readSrc(indexFile);
  const imports = importMap(idx, workerSrc);
  const appUses = [];
  for (const m of idx.matchAll(/\bapp\s*\.\s*use\(\s*['"`](\/api[^'"`]*)['"`]/g)) {
    // Middleware on every /api/* request (rate limits, observability, last-active, CSRF) gates no route: it
    // reads a signed-in caller when there is one. Only a narrower path's middleware is a route's gate.
    if (m[1] === '/api/*' || m[1] === '/api') continue;
    const open = m.index + m[0].indexOf('(');
    appUses.push({ pattern: m[1], text: reach(idx.slice(open, closeOf(idx, open)), idx, indexFile, 2) });
  }
  const appMw = (path) => appUses.filter((u) => covers(u.pattern, path)).map((u) => u.text);
  for (const m of idx.matchAll(/\bapp\s*\.\s*(get|post|put|patch|delete|all)\(\s*['"`](\/api[^'"`]*)['"`]/g)) {
    const open = m.index + m[0].indexOf('(');
    routes.push({ method: m[1].toUpperCase(), path: m[2], file: 'cloudflare-worker/src/index.ts', line: lineOf(idx, m.index), text: reach(idx.slice(open, closeOf(idx, open)), idx, indexFile, REACH_DEPTH) });
  }
  const mounts = [];
  for (const m of idx.matchAll(/\bapp\s*\.\s*route\(\s*['"`](\/api[^'"`]*)['"`]\s*,\s*(\w+)/g)) {
    const t = imports.get(m[2]);
    if (t) mounts.push({ path: m[1], file: t.file, router: m[2] });
  }
  for (const r of registeredMounts(root)) mounts.push({ path: r.path, file: resolve(root, r.file), router: r.router });
  for (const mt of mounts) crawl(mt.file, mt.path, 0, mt.router, []);
  // App middleware applies by full path, once the table is known.
  for (const r of routes) r.text = [...appMw(r.path), r.text].join('\n');
  return routes;
}

// ── Classification ──────────────────────────────────────────────────────────

/** The gate and evidence of one route's reachable text. */
/** `src` without its comments, so a gate named only in a comment is not read as one. Strings are kept whole. */
export function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; continue; }
    if (ch === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== ch && !(ch !== '`' && src[j] === '\n')) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function classify(route) {
  const text = stripComments(route.text);
  let gate = 'public';
  for (const [g, re] of GATE_TOKENS) {
    if (re.test(text) && GATES.indexOf(g) > GATES.indexOf(gate)) gate = g;
  }
  const evidence = [...new Set([...text.matchAll(EVIDENCE_RE)].map((m) => m[1]))].sort();
  if (OWNER_SQL_RE.test(text)) evidence.push('owner_bound_sql');
  const params = [...route.path.matchAll(/:([A-Za-z_]\w*)/g)].map((m) => m[1]);
  return { gate, evidence, params };
}

/**
 * The inventory: each route with its family (the path's first two segments),
 * method, path, file, line, gate, evidence, whether it writes, and why it needs
 * review (null when it does not). scripts/auth-inventory-ledger.json records
 * what a person found for each route that needs review.
 */
export function inventory(root) {
  const rows = [];
  const seen = new Set();
  for (const r of routeTable(root)) {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { gate, evidence, params } = classify(r);
    const signedIn = GATES.indexOf(gate) >= GATES.indexOf('authenticated');
    const names = params.length > 0;
    let review = null;
    if (gate === 'public') review = 'no_gate_found';
    else if (gate === 'forwarded') review = 'forwarded';
    else if (gate === 'optional_auth') review = 'optional_auth';
    else if (signedIn && !['admin', 'hq_admin', 'super_admin', 'cf_access'].includes(gate) && names && !evidence.length) review = 'record_without_ownership_check';
    rows.push({
      method: r.method, path: r.path, family: familyOf(r.path), file: r.file, line: r.line,
      gate, evidence, writes: r.method !== 'GET', review,
    });
  }
  rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return rows;
}

export const familyOf = (path) => path.split('/').slice(0, 3).join('/') || path;
