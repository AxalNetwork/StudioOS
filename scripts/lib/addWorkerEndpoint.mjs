/**
 * #6326 — the add-worker-endpoint preflight: what a branch that adds a Worker
 * route and its client method breaks before CI says so.
 *
 * It decides, from the files a branch adds or changes (and, for a changed
 * file, only the lines it adds), which house rules the change trips:
 *
 *   - a generated module tracked by git (D5612);
 *   - a frozen hub that gained an entry (D5615; the problems come from
 *     `scripts/lib/hubFreeze.mjs`, read by the CLI);
 *   - a new route file with no header comment (#4104), no `mount` export
 *     (#4105: it would never be mounted), a mount outside `/api/`, or no
 *     identity gate the auth inventory can see (#4570);
 *   - an `app.route(` line added anywhere under `cloudflare-worker/src`;
 *   - an added `error:` whose value is a sentence, not a code (D278: `error`
 *     is a code, the sentence goes in `message`);
 *   - a new client module under `frontend/src/lib/api/` with no header
 *     comment, or an export `api.js` already declares (D527: `export *` lets
 *     `api.js`'s own name win and hides the module's silently);
 *   - the tests that name a changed file by path, which pin its contents
 *     (the hub freeze, a page's refusal-code table, the expiry-gate count),
 *     directly or through a shared `_*.mjs`/`_*.ts` helper they import
 *     (`frontend/test/_advisorRoutesSource.mjs` reads `routes/advisors.ts`).
 *
 * It also names the guards to run, in order. It never reads GitHub, never
 * writes a file, and never pushes. Pure: the CLI (`scripts/add-worker-endpoint.mjs`)
 * gathers the inputs.
 */
import { headerLine } from './folderFiles.mjs';
import { stripComments } from './authInventory.mjs';

export const GENERATED = Object.freeze([
  'cloudflare-worker/src/routes/_registry.ts',
  'frontend/src/lib/apiModules.generated.js',
  'cloudflare-worker/src/services/agents/skillLibrary.generated.ts',
]);

/** The five frozen hubs (D5615), as `scripts/hub-freeze.json` keys them. */
export const HUBS = Object.freeze([
  'cloudflare-worker/src/index.ts',
  'cloudflare-worker/src/routes/advisors.ts',
  'frontend/src/App.jsx',
  'frontend/src/lib/api.js',
  'frontend/src/pages/cycles/CycleRoute.jsx',
]);

/**
 * The identity gates `cloudflare-worker/src/auth.ts` exports, weakest first,
 * named as the auth inventory (`scripts/lib/authInventory.mjs` GATE_TOKENS)
 * ranks them. `requireRole(c, …'admin'…)` counts as admin too (ADMIN_ROLE).
 */
export const GATES = Object.freeze([
  ['optional_auth', ['getCurrentUser']],
  ['authenticated', ['requireAuth', 'requireApprovedKyc', 'requireStepUp', 'requireFactor']],
  ['admin', ['requireAdmin']],
  ['hq_admin', ['requireHqAdmin', 'requireHqAuthoring']],
  ['super_admin', ['requireSuperAdmin', 'requireSuperAdminWriteBar']],
]);

/**
 * The guards an endpoint change runs before a PR, in order: the generators
 * (`build-generated`, which the pretest hooks and CI steps run), then guards
 * that are each in `package.json`'s `test:guards`.
 */
export const GUARDS = Object.freeze([
  'node scripts/build-generated.mjs',
  'node scripts/build-generated.mjs --check',
  'node scripts/check-api-drift.mjs',
  'node scripts/check-refusal-bodies.mjs',
  'node scripts/check-sql-prepare.mjs',
  'node scripts/check-sql-unsafe.mjs',
  'node scripts/check-timestamp-comparisons.mjs',
  'node scripts/check-access-comments.mjs',
  'node scripts/build-auth-inventory.mjs --check',
  'node scripts/check-folder-docs.mjs',
  'node scripts/build-route-map.mjs --check',
  'node scripts/check-decision-ids.mjs',
  'node scripts/check-unused-imports.mjs',
]);

/** Guards that apply only when the change touches what they read. */
export const GUARDS_IF = Object.freeze([
  { when: (p) => p.startsWith('cloudflare-worker/sql/'), cmds: ['node scripts/check-sql-migrations.mjs', 'node scripts/check-sqlite-tables.mjs', 'node scripts/check-sqlite-columns.mjs', 'node --no-warnings scripts/check-schema-pair-drift.mjs'] },
  { when: (p) => p.startsWith('cloudflare-worker/src/services/advisor/'), cmds: ['node scripts/check-advisor-bank-drift.mjs', 'node scripts/check-write-router-columns.mjs'] },
]);

export const FRONTEND_TEST = 'node --import ./frontend/test/_deck-loader.mjs --test';
export const WORKER_TEST = 'node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test';

/** Tests every endpoint change runs: the hub freeze and the route registry. */
export const ALWAYS_TESTS = Object.freeze([
  'frontend/test/hub_freeze_5615.test.mjs',
  'cloudflare-worker/test/route_registry_4105.test.ts',
]);

export const isRoute = (p) => /^cloudflare-worker\/src\/routes\/[^/]+\.ts$/.test(p) && !GENERATED.includes(p);
export const isApiModule = (p) => /^frontend\/src\/lib\/api\/[^/]+\.js$/.test(p);
export const isWorkerSrc = (p) => p.startsWith('cloudflare-worker/src/') && /\.(?:ts|mjs|js)$/.test(p);

/** A refusal code: lower-case words joined by underscores (`util/refusal.ts`). */
export const CODE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** `requireRole(c, …'admin'…)`, which the auth inventory reads as an admin gate. */
export const ADMIN_ROLE = /\brequireRole\s*\([^)]*['"]admin['"]/;

/**
 * The gates a source reaches, strongest last, by name. Comments and import
 * statements are dropped first, so a gate only named in a comment or imported
 * and never called or handed on does not count (the auth inventory would not
 * see it either).
 */
export function gatesIn(src) {
  const code = stripComments(src)
    .replace(/^\s*import\b[^;]*?\bfrom\s*(['"])[^'"]+\1\s*;?/gm, '')
    .replace(/^\s*export\s*(?:type\s*)?\{[^}]*\}\s*from\s*(['"])[^'"]+\1\s*;?/gm, '');
  const found = [];
  for (const [gate, names] of GATES) {
    const hit = names.some((n) => new RegExp(`\\b${n}\\b`).test(code)) || (gate === 'admin' && ADMIN_ROLE.test(code));
    if (hit) found.push(gate);
  }
  return found;
}

/** The names a module exports: `export const|let|function|class X` and `export { a, b as c }`. */
export function exportNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** `{ error: '<value>' }` literals on a line whose value is not a code. */
export function sentenceErrors(line) {
  if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return [];
  const out = [];
  for (const m of line.matchAll(/\berror\s*:\s*(['"`])([^'"`$]*)\1/g)) if (!CODE.test(m[2])) out.push(m[2]);
  return out;
}

/** The mount paths a route file declares (`path: '/api/…'` inside its `mount`). */
export function mountPaths(src) {
  const at = src.search(/^export\s+const\s+mount\b/m);
  if (at < 0) return [];
  return [...src.slice(at).matchAll(/\bpath\s*:\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2]);
}

/** The keys a test would use to name `path`: the part after `src/`, with and without its extension. */
export function pathKeys(path) {
  const m = /^(?:cloudflare-worker|frontend)\/src\/(.+)$/.exec(path);
  if (!m) return [];
  return [m[1], m[1].replace(/\.(?:ts|js|jsx|mjs)$/, '')];
}

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Whether `src` names `path` by its path under `src/`, with or without its extension. */
function names(src, path) {
  const [full, bare] = pathKeys(path);
  if (!full) return false;
  return src.includes(full) || new RegExp(`${esc(bare)}['"\`]`).test(src);
}

/**
 * Whether a shared test helper names `path`: by its path under `src/`, or by
 * its quoted file name next to its folder (`resolve(ROUTES, 'advisors.ts')`
 * with `ROUTES` ending in `src/routes`). A split module `X_y.ts` counts when
 * the helper names `X.ts` and collects `X_\w+` from it, as
 * `_advisorRoutesSource.mjs` does with advisors.ts's imports.
 */
function helperNames(src, path) {
  if (names(src, path)) return true;
  const m = /^(?:cloudflare-worker|frontend)\/src\/(.+)\/([^/]+)$/.exec(path);
  if (!m || !src.includes(`src/${m[1]}`)) return false;
  const quoted = (file) => new RegExp(`['"\`]${esc(file)}['"\`]`).test(src);
  if (quoted(m[2])) return true;
  const split = /^([A-Za-z]\w*?)_\w+(\.\w+)$/.exec(m[2]);
  return Boolean(split && quoted(`${split[1]}${split[2]}`) && src.includes(`${split[1]}_\\w+`));
}

/** The helper's import name, as a test imports it: `./_advisorRoutesSource.mjs` → `_advisorRoutesSource`. */
const helperStem = (file) => file.split('/').pop().replace(/\.(?:mjs|ts|js)$/, '');
const imports = (src, helper) => new RegExp(`['"]\\./${esc(helperStem(helper))}(?:\\.(?:mjs|ts|js))?['"]`).test(src);

/**
 * The test files that name `path`: directly, or by importing a shared helper
 * (`frontend/test/_*.mjs`, `cloudflare-worker/test/_*.ts`) that names it,
 * itself or through another helper it imports.
 *
 * @param {string} path
 * @param {Map<string,string>} testSources   `*.test.*` file → source
 * @param {Map<string,string>} [helperSources] `_*` helper file → source
 * @returns {{ file: string, via?: string }[]} each test, with the helper it reaches `path` through
 */
export function testsReaching(path, testSources, helperSources = new Map()) {
  const via = new Set([...helperSources].filter(([, src]) => helperNames(src, path)).map(([f]) => f));
  for (let grew = true; grew;) {
    grew = false;
    for (const [f, src] of helperSources) {
      if (!via.has(f) && [...via].some((h) => h.split('/').slice(0, 2).join('/') === f.split('/').slice(0, 2).join('/') && imports(src, h))) { via.add(f); grew = true; }
    }
  }
  const hits = [];
  for (const [file, src] of testSources) {
    if (names(src, path)) { hits.push({ file }); continue; }
    const dir = file.split('/').slice(0, 2).join('/');
    const h = [...via].find((v) => v.startsWith(`${dir}/`) && imports(src, v));
    if (h) hits.push({ file, via: h });
  }
  return hits.sort((a, b) => a.file.localeCompare(b.file));
}

/** The test files whose source names `path` by its path under `src/`, directly or through a helper. */
export function testsNaming(path, testSources, helperSources) {
  return testsReaching(path, testSources, helperSources).map((t) => t.file);
}

/**
 * The findings for one change.
 *
 * @param {object} input
 * @param {{ path: string, status: 'A'|'M'|'D', text?: string, added?: string[] }[]} input.files
 *        each changed file; `added` is the lines the change adds (every line for a new file)
 * @param {string[]} [input.tracked]      files git tracks, to catch a generated module committed again
 * @param {Set<string>} [input.apiExports] the names `frontend/src/lib/api.js` exports
 * @param {string[]} [input.hubProblems]  `freezeProblems(...)` from `scripts/lib/hubFreeze.mjs`
 * @returns {{ level: 'fail'|'warn'|'info', file: string, rule: string, message: string }[]}
 */
export function endpointFindings({ files, tracked = [], apiExports = new Set(), hubProblems = [] }) {
  const out = [];
  const add = (level, file, rule, message) => out.push({ level, file, rule, message });

  for (const g of GENERATED) {
    if (tracked.includes(g)) add('fail', g, 'D5612', 'a generated module is tracked again: `git rm --cached` it; `node scripts/build-generated.mjs` writes it before every build and test.');
  }
  for (const p of hubProblems) add('fail', p.split(':')[0], 'D5615', p);

  for (const f of files) {
    if (f.status === 'D') continue;
    const text = f.text ?? '';
    const added = f.added ?? (f.status === 'A' ? text.split('\n') : []);

    if (HUBS.includes(f.path) && added.length && !hubProblems.some((p) => p.startsWith(`${f.path}:`))) {
      add('warn', f.path, 'D5615', 'a frozen hub changed. A change to an existing entry is fine; a new one goes where documentation/architecture/HUBS.md says. Run the hub freeze test.');
    }

    if (isWorkerSrc(f.path)) {
      for (const line of added) {
        if (/\bapp\.route\s*\(/.test(line) && !/^\s*(?:\/\/|\*)/.test(line)) {
          add('fail', f.path, '#4105', `an \`app.route(\` was added (\`${line.trim().slice(0, 80)}\`): a new router exports \`mount\` from its own file instead.`);
        }
        for (const s of sentenceErrors(line)) {
          add('warn', f.path, 'D278', `\`error: '${s.slice(0, 60)}'\` is a sentence: \`error\` carries a code (lower_snake_case) and the sentence goes in \`message\`; use \`refuse(c, status, { code, message })\` from util/refusal.ts.`);
        }
      }
    }

    if (isRoute(f.path) && f.status === 'A') {
      if (!headerLine(text)) add('fail', f.path, '#4104', 'no header comment: open the file with a /** */ block whose first sentence says what it serves and which issue it belongs to.');
      if (!/^export\s+const\s+mount\b/m.test(text)) {
        add('fail', f.path, '#4105', 'no `export const mount: RouteMount = { path, router, before? }`: the router is never mounted (cloudflare-worker/src/util/routeRegistry.ts).');
      } else {
        for (const p of mountPaths(text)) if (!p.startsWith('/api/')) add('warn', f.path, '#4105', `mounts at \`${p}\`, outside /api/.`);
      }
      const gates = gatesIn(text);
      if (!gates.length) {
        add('warn', f.path, '#4570', 'no identity gate the auth inventory can see: `node scripts/build-auth-inventory.mjs --check` will ask for a ledger entry under scripts/baselines/auth-inventory/. Gate it, or say why it is public.');
      } else {
        add('info', f.path, '#4570', `gates seen: ${gates.join(', ')}. Use the narrowest that needs the data (AGENTS.md § House rules, Security).`);
      }
    }

    if (isApiModule(f.path) && f.status === 'A') {
      if (!headerLine(text)) add('fail', f.path, '#4104', 'no header comment: its first sentence describes the module in frontend/src/lib/api/README.md\'s generated list.');
      for (const n of exportNames(text)) {
        if (apiExports.has(n)) add('fail', f.path, 'D527', `exports \`${n}\`, which frontend/src/lib/api.js already declares: with \`export *\` api.js wins and this export is hidden. Rename it.`);
      }
    }
  }
  return out;
}

/** The commands to run for these changed paths: guards, then tests (always-run plus those naming a changed file). */
export function planChecks(paths, testSources = new Map(), helperSources = new Map()) {
  const guards = [...GUARDS];
  for (const g of GUARDS_IF) if (paths.some(g.when)) for (const c of g.cmds) if (!guards.includes(c)) guards.push(c);
  const tests = new Set(ALWAYS_TESTS);
  const naming = {};
  for (const p of paths) {
    for (const t of testsReaching(p, testSources, helperSources)) {
      tests.add(t.file);
      (naming[t.file] ??= []).push(t.via ? `${p} (via ${t.via.split('/').pop()})` : p);
    }
  }
  const sorted = [...tests].sort();
  const front = sorted.filter((t) => t.startsWith('frontend/test/'));
  const worker = sorted.filter((t) => t.startsWith('cloudflare-worker/test/'));
  const commands = [...guards];
  if (front.length) commands.push(`${FRONTEND_TEST} ${front.map((t) => `'${t}'`).join(' ')}`);
  if (worker.length) commands.push(`${WORKER_TEST} ${worker.map((t) => `'${t}'`).join(' ')}`);
  return { guards, tests: sorted, naming, commands };
}

/** The report, as text. */
export function render(findings, plan) {
  const lines = [];
  const order = { fail: 0, warn: 1, info: 2 };
  const sorted = [...findings].sort((a, b) => order[a.level] - order[b.level] || a.file.localeCompare(b.file));
  lines.push(sorted.length ? 'Findings:' : 'Findings: none.');
  for (const f of sorted) lines.push(`  ${f.level.toUpperCase().padEnd(4)} ${f.file} [${f.rule}] ${f.message}`);
  lines.push('', 'Tests that name a changed file, directly or through a test helper (they pin its contents; read each before you push):');
  const named = Object.entries(plan.naming);
  if (!named.length) lines.push('  none');
  for (const [t, ps] of named) lines.push(`  ${t}  <- ${ps.join(', ')}`);
  lines.push('', 'Run, in order:');
  for (const c of plan.commands) lines.push(`  ${c}`);
  return lines.join('\n');
}
