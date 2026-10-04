#!/usr/bin/env node
/**
 * API ↔ Worker drift check.
 *
 * Statically analyses `frontend/src/lib/api.js` and every domain module under
 * `frontend/src/lib/api/` (D527) against the production worker
 * (`cloudflare-worker/src/index.ts` + everything it mounts) and fails on drift.
 * It also fails when api.js's re-export block does not name exactly the
 * modules on disk, in alphabetical order.
 *
 * Why static and not curl-based?
 * - The production worker runs on Cloudflare; we don't always have a deployed
 *   preview URL inside CI.
 * - The dev FastAPI is NOT canonical; matching against it would hide real prod
 *   drift (the whole point).
 * - Static analysis is deterministic and runs in <1s with no secrets.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED, AND WHY IT MATTERS
 *
 * This used to be a PREFIX-only checker: a SPA path passed if ANY mounted
 * prefix was a prefix of it. That check has been reporting "✅ no drift" for
 * every commit — not because there is none, but because
 * `app.route('/api', realtime)` mounts a router at the bare `/api`. Every path
 * the SPA can possibly call starts with `/api`, so every path matched, and the
 * gate could never fail. It was a green light wired to nothing.
 *
 * So the checker now resolves routes for real: it follows each `app.route()` to
 * the router module, crawls that module's `.get/.post/.put/.patch/.delete/.all`
 * declarations AND its nested `.route()` sub-mounts, and matches on
 * (METHOD, path) rather than prefix. Hono param syntax (`:id`, `:id{[0-9]+}`)
 * and template interpolation in api.js both normalise to `:p`.
 *
 * Turning it on found 80-odd SPA calls with no worker route at all — whole
 * subsystems (`/api/marketplace/*`, `/api/organizations`,
 * `/api/network-introductions/*`) plus one-offs like `/api/dashboard/stats`
 * (the worker mounts `/api/dashboard`, but has no `/stats`). Those are real and
 * pre-existing; they are recorded in `scripts/api-drift-baseline.json` so this
 * gate can start FAILING on new drift today instead of waiting for a large
 * port. The baseline is a debt ledger: it should only ever shrink, and the
 * script tells you when it can.
 *
 * ---------------------------------------------------------------------------
 * RESPONSE-SHAPE CHECK
 *
 * A route can exist and still be wired wrong. The SPA's `request()` helper
 * throws on any non-2xx and builds the thrown message from `error`, `detail` or
 * `message` — in that order. A route that answers 4xx/5xx with none of those
 * keys produces a bare "Request failed" in the UI no matter how good its own
 * error text is. So every `c.json({...}, >=400)` in the worker is checked for
 * one of those keys.
 *
 * ---------------------------------------------------------------------------
 * Usage:
 *   node scripts/check-api-drift.mjs                # check (exit 1 on new drift)
 *   node scripts/check-api-drift.mjs --update-baseline
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import {
  API_MODULES_DIR_REL,
  classifyCalls,
  clientSources,
  extractClientCalls,
  listModules,
  reexportProblems,
} from './lib/apiModules.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const WORKER_SRC = resolve(ROOT, 'cloudflare-worker/src');
const WORKER_FILE = resolve(WORKER_SRC, 'index.ts');
const ROUTES_DIR = resolve(WORKER_SRC, 'routes');
const BASELINE_FILE = resolve(__dirname, 'api-drift-baseline.json');

const UPDATE = process.argv.includes('--update-baseline');

// ---------------------------------------------------------------------------
// Known-broken endpoints the SPA calls but the worker does not (yet) mount.
// Each entry must reference a tracking task. Distinct from the baseline: this
// list is for whole subsystems with a known port plan; the baseline is the
// mechanical record of everything currently unmatched.
// ---------------------------------------------------------------------------
const KNOWN_DRIFT_ALLOWLIST = new Set([
  // T10 — calendar (incl. Google + Microsoft sync) shipped on worker.
  // T11 — financials port pending
  '/financials/model',
  '/financials/runway',
  '/financials/breakeven',
  // T12 — wellbeing / compliance port pending
  '/wellbeing/checkin',
  '/wellbeing/resources',
  '/wellbeing/aggregates',
  '/compliance/events',
  // T13 — captable port pending (advisors/partner-office-hours/cofounder shipped)
  '/captable/scenarios',
  '/captable/waterfall',
  // T14 — references audio recording / transcribe / summarize stubbed (501)
  '/references/transcripts',
  // Task #225 — Secure Introductions has a page but no backend. The SPA page
  // FounderNetworkIntroductions.jsx calls GET /network-introductions and the
  // worker has never mounted that path or anything under it, so the page's
  // fetch 404s in production today. This is DISTINCT from the credits-based
  // /introductions/* system, which is fully mounted — the two are different
  // features that share a word. Allowlisted rather than removed because the
  // page is live and the call is its only data source; removing it would hide
  // the gap instead of tracking it.
  '/network-introductions',
]);

function declaresIdent(src, ident) {
  for (const kind of ['const ', 'let ', 'var ']) {
    const needle = kind + ident;
    let from = 0;
    while (from < src.length) {
      const at = src.indexOf(needle, from);
      if (at < 0) break;
      const prev = at === 0 ? '' : src[at - 1];
      if (prev && /[A-Za-z0-9_]/.test(prev)) {
        from = at + 1;
        continue;
      }
      let i = at + needle.length;
      while (i < src.length && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n')) i += 1;
      if (src[i] === '=') return true;
      from = at + 1;
    }
  }
  return false;
}

// Path normalisation, client-call extraction and matching live in
// ./lib/apiModules.mjs (D527), so they can be tested on sources that are not
// the real api.js — and so the same code reads the lib/api/ modules.

// ---------------------------------------------------------------------------
// Worker side — resolve the full (METHOD, path) route table.
// ---------------------------------------------------------------------------
function importMap(src, fromDir) {
  const map = new Map();
  const re = /import\s+(?:(\w+)\s*,\s*)?(?:\{([^}]*)\}\s*)?(?:(\w+)\s*)?from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const file = resolve(fromDir, m[4]) + '.ts';
    if (m[1]) map.set(m[1], file);
    if (m[3]) map.set(m[3], file);
    if (m[2]) {
      for (const part of m[2].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) map.set(name, file);
      }
    }
  }
  return map;
}

const defaultExportIdent = (src) => (src.match(/export\s+default\s+(\w+)/) || [])[1] || null;

function buildRouteTable() {
  const routes = [];
  const visited = new Set();

  // Only attribute verbs declared on the identifier that is actually mounted.
  // A file may define several routers and export one; counting all of them
  // would over-approximate and hide exactly the drift we're looking for.
  //
  // `mountedIdent` is the local name used at the mount site. A file can
  // export several routers by name — routes/needs.ts exports `needs`
  // (default), `quotesRouter`, and `engagementsRouter`, each mounted at a
  // different prefix. Resolving only the DEFAULT export made every route
  // on a named-export router invisible to this guard, so drift on
  // /api/quotes and /api/engagements could never be detected. When the
  // mounted name is a router declared in the file, attribute to that.
  function crawl(file, prefix, depth, mountedIdent) {
    const key = `${file}|${prefix}`;
    if (depth > 8 || visited.has(key) || !existsSync(file)) return;
    visited.add(key);
    const src = readFileSync(file, 'utf8');
    const imports = importMap(src, dirname(file));
    const declaresMounted = mountedIdent && declaresIdent(src, mountedIdent);
    const ident = declaresMounted ? mountedIdent : defaultExportIdent(src);
    if (!ident) return;

    const verbRe = /(\w+)\s*\.\s*(get|post|put|patch|delete|all)\(\s*['"`]([^'"`]*)['"`]/g;
    let m;
    while ((m = verbRe.exec(src)) !== null) {
      if (m[1] !== ident) continue;
      const sub = m[3] === '/' ? '' : m[3];
      routes.push([m[2].toUpperCase(), (prefix + sub).replace(/\/+$/, '') || prefix]);
    }

    const mountRe = /(\w+)\s*\.\s*route\(\s*['"`]([^'"`]*)['"`]\s*,\s*(\w+)/g;
    while ((m = mountRe.exec(src)) !== null) {
      if (m[1] !== ident) continue;
      const target = imports.get(m[3]);
      if (target) crawl(target, prefix + (m[2] === '/' ? '' : m[2]), depth + 1, m[3]);
    }
  }

  const idx = readFileSync(WORKER_FILE, 'utf8');
  const imports = importMap(idx, WORKER_SRC);

  // Routes declared directly on the root app (health checks, webhooks, …).
  const rootVerbRe = /app\s*\.\s*(get|post|put|patch|delete|all)\(\s*['"`](\/api[^'"`]*)['"`]/g;
  let m;
  while ((m = rootVerbRe.exec(idx)) !== null) routes.push([m[1].toUpperCase(), m[2]]);

  const mounts = [];
  const unresolved = [];
  const mountRe = /app\s*\.\s*route\(\s*['"`](\/api[^'"`]*)['"`]\s*,\s*(\w+)/g;
  while ((m = mountRe.exec(idx)) !== null) {
    const file = imports.get(m[2]);
    mounts.push(m[1]);
    if (file) crawl(file, m[1], 0, m[2]);
    else unresolved.push(`${m[1]} -> ${m[2]}`);
  }

  return { routes, mounts, unresolved };
}

// ---------------------------------------------------------------------------
// SPA side — every (METHOD, path) the api.js `request()` helper issues.
// ---------------------------------------------------------------------------
/**
 * Read one string/template literal starting at `i` (which must be the quote).
 * Returns { value, end } or null. Hand-written rather than a regex because
 * api.js template paths NEST backticks inside their interpolations —
 * `` `/calendar/google/connect${x ? `?a=${b}` : ''}` `` — and a `[^`]*` regex
 * stops at the inner backtick, silently truncating the path AND losing the
 * `{ method: 'POST' }` argument after it. That is how four POST endpoints came
 * out looking like GETs.
 */

// ---------------------------------------------------------------------------
// Response-shape — error envelopes the SPA can actually read.
// ---------------------------------------------------------------------------
const ENVELOPE_KEYS = /(^|[{,\s])(error|detail|message|errors)\s*:/;

/**
 * Every `.ts` under routes/, at any depth.
 *
 * This used to be a bare `readdirSync(ROUTES_DIR)`, which was correct while
 * the directory was flat and would have FAILED SILENTLY the moment it was
 * not: a route moved into `routes/admin/` would simply stop being checked,
 * and the guard would keep printing a pass. That is the worst failure mode a
 * guard has — CLAUDE.md points at this script as the thing enforcing the
 * api.js ↔ worker rule on every PR, so a hole in it is a hole in the rule.
 *
 * Nothing is nested today. The walk is here so that organising the directory
 * later is a safe move rather than one that quietly removes coverage.
 */
function routeFiles(dir = ROUTES_DIR) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) out.push(...routeFiles(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function findEnvelopeViolations() {
  const out = [];
  let checked = 0;
  for (const file of routeFiles()) {
    const src = readFileSync(file, 'utf8');
    const re = /c\.json\(\s*\{/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const open = m.index + m[0].length - 1;
      let depth = 0;
      let end = open;
      for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}') { depth--; if (depth === 0) break; }
      }
      const literal = src.slice(open, end + 1);
      const status = (src.slice(end + 1, end + 40).match(/^\s*,\s*(\d{3})/) || [])[1];
      if (!status || Number(status) < 400) continue;
      checked++;
      if (ENVELOPE_KEYS.test(literal)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      out.push(`${relative(ROOT, file)}:${line} (${status})`);
    }
  }
  return { violations: out.sort(), checked };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
// D527 — api.js and every domain module under lib/api/. A call cannot hide
// from this check by living in a module instead of api.js.
const sources = clientSources(ROOT);
const reexport = reexportProblems(sources[0].src, listModules(resolve(ROOT, API_MODULES_DIR_REL)));
const { routes, mounts, unresolved } = buildRouteTable();
const calls = sources.flatMap(({ src }) => extractClientCalls(src));
const { missingRoute, missingMethod, allowlisted } = classifyCalls(calls, routes, KNOWN_DRIFT_ALLOWLIST);

const { violations: envelopeViolations, checked: errorResponses } = findEnvelopeViolations();

const current = {
  missing_route: [...missingRoute].sort(),
  missing_method: [...missingMethod].sort(),
  error_envelope: envelopeViolations,
};

if (UPDATE) {
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify(
      {
        _readme:
          'Pre-existing API drift, recorded so the gate can fail on NEW drift. ' +
          'This is a debt ledger: it must only ever shrink. Regenerate with ' +
          '`node scripts/check-api-drift.mjs --update-baseline` — and only to REMOVE ' +
          'entries you have fixed, never to bless new ones.',
        _fields: {
          missing_route: 'METHOD /api/path the SPA calls with no worker route at all.',
          missing_method: 'Path exists on the worker but not for that HTTP method.',
          error_envelope:
            'file:line (status) — a >=400 c.json() with no error/detail/message key, so ' +
            "the SPA's request() helper can only surface \"Request failed\".",
        },
        ...current,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`[drift] baseline written: ${BASELINE_FILE}`);
  console.log(
    `[drift]   missing_route=${current.missing_route.length} ` +
      `missing_method=${current.missing_method.length} ` +
      `error_envelope=${current.error_envelope.length}`,
  );
  process.exit(0);
}

const baseline = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  : { missing_route: [], missing_method: [], error_envelope: [] };

console.log(`[drift] SPA calls examined:      ${calls.length} (api.js + ${sources.length - 1} lib/api/ module${sources.length === 2 ? '' : 's'})`);
console.log(`[drift] Worker routes resolved:  ${routes.length} (from ${mounts.length} mounts)`);
console.log(`[drift] Error responses checked: ${errorResponses}`);
console.log(`[drift] Known-pending (allowlisted): ${allowlisted.size}`);

if (unresolved.length) {
  // Not fatal, but it means part of the worker is invisible to this check —
  // say so rather than reporting a clean run over a partial route table.
  console.warn(`\n⚠️  ${unresolved.length} mount(s) could not be resolved to a module; their routes are NOT checked:`);
  for (const u of unresolved) console.warn(`   - ${u}`);
}

let failed = false;
if (reexport.length) {
  failed = true;
  console.error(`\n❌ api.js re-export block disagrees with frontend/src/lib/api/ (${reexport.length}):\n`);
  for (const x of reexport) console.error(`   - ${x}`);
}
const SECTIONS = [
  ['missing_route', 'SPA calls with NO worker route'],
  ['missing_method', 'Worker has the path but not this HTTP method'],
  ['error_envelope', 'Error responses the SPA cannot read (no error/detail/message key)'],
];

for (const [key, label] of SECTIONS) {
  const known = new Set(baseline[key] || []);
  const fresh = current[key].filter((x) => !known.has(x));
  const fixed = [...known].filter((x) => !current[key].includes(x));

  if (fresh.length) {
    failed = true;
    console.error(`\n❌ NEW — ${label} (${fresh.length}):\n`);
    for (const x of fresh) console.error(`   - ${x}`);
  }
  if (fixed.length) {
    console.log(`\n✅ ${fixed.length} baseline entr${fixed.length === 1 ? 'y' : 'ies'} under "${key}" no longer drift.`);
    console.log('   Run `node scripts/check-api-drift.mjs --update-baseline` to bank the fix.');
  }
}

if (failed) {
  console.error(
    '\nFix one of:\n' +
      '  1. Add the route to the worker under cloudflare-worker/src/routes/ (preferred — production parity).\n' +
      '  2. Remove the call from frontend/src/lib/api.js or its lib/api/ module (if dead code).\n' +
      '  3. For an error response: include an `error` (or `detail`/`message`) key so the\n' +
      "     user sees the real reason instead of \"Request failed\".\n" +
      '  4. Only as a last resort, add a KNOWN_DRIFT_ALLOWLIST entry in this script with a\n' +
      '     tracking task id. Do NOT regenerate the baseline to bless new drift.\n',
  );
  process.exit(1);
}

const debt =
  (baseline.missing_route?.length || 0) +
  (baseline.missing_method?.length || 0) +
  (baseline.error_envelope?.length || 0);
console.log(`\n✅ No NEW API ↔ Worker drift. (${debt} pre-existing item${debt === 1 ? '' : 's'} in the baseline ledger.)`);
process.exit(0);
