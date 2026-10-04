/**
 * The SPA's API client, read as text: `frontend/src/lib/api.js` and every
 * domain module under `frontend/src/lib/api/` (D527).
 *
 * WHY THE MODULES EXIST. On `main` from 2 August to 3 October 2026, `api.js`
 * changed in 113 of 624 commits, because every new client method landed in
 * that one file and unrelated features collided there. A new API domain now
 * goes in its own file, `lib/api/<domain>.js`, and `api.js` re-exports it with
 * one line in a single block made for the purpose. Existing methods stay where
 * they are: 147 tests and scripts read `api.js` by path.
 *
 * WHAT THIS DECIDES.
 *   - `clientSources` — which files hold client calls: `api.js` and every
 *     `.js` directly under `lib/api/`. Anything that compares client calls with
 *     Worker routes reads all of them, so a call cannot hide from the drift
 *     check by living in a module.
 *   - `reexportProblems` — whether `api.js`'s re-export block names exactly the
 *     modules on disk, one well-formed line each, in alphabetical order. A
 *     module missing from the block is code nobody can reach through `api`.
 *   - `extractClientCalls`, `normalizePath`, `classifyCalls` — the
 *     (METHOD, path) of each `request()` call and whether the Worker's resolved
 *     route table answers it. Lifted out of `../check-api-drift.mjs` unchanged
 *     so they can be tested on a source that is not the real one.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const API_FILE_REL = 'frontend/src/lib/api.js';
export const API_MODULES_DIR_REL = 'frontend/src/lib/api';

export const REEXPORT_BEGIN = '// api-modules:begin';
export const REEXPORT_END = '// api-modules:end';

/** The line `api.js` must carry for module `name` (the file `lib/api/<name>.js`). */
export const reexportLine = (name) => `export * from './api/${name}.js';`;

const MODULE_NAME = /^[a-z][A-Za-z0-9]*$/;
const REEXPORT_LINE = /^export \* from '\.\/api\/([^'/]+)\.js';$/;

/** Module names (file stems) directly under `dir`, sorted. Missing dir → []. */
export function listModules(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => e.name.slice(0, -3))
    .sort();
}

/** `[{ file, src }]` — `api.js` first, then each module, relative to `root`. */
export function clientSources(root) {
  const out = [{ file: API_FILE_REL, src: readFileSync(resolve(root, API_FILE_REL), 'utf8') }];
  for (const name of listModules(resolve(root, API_MODULES_DIR_REL))) {
    const file = `${API_MODULES_DIR_REL}/${name}.js`;
    out.push({ file, src: readFileSync(resolve(root, file), 'utf8') });
  }
  return out;
}

/**
 * Every way `api.js`'s re-export block disagrees with the modules on disk.
 * An empty array means the block is exactly right.
 */
export function reexportProblems(apiSrc, moduleNames) {
  const problems = [];
  const lines = apiSrc.split('\n');
  const begin = lines.findIndex((l) => l.trim() === REEXPORT_BEGIN);
  const end = lines.findIndex((l) => l.trim() === REEXPORT_END);
  if (begin < 0 || end < 0 || end < begin) {
    return [`api.js has no re-export block (\`${REEXPORT_BEGIN}\` … \`${REEXPORT_END}\`)`];
  }
  if (lines.filter((l) => l.trim() === REEXPORT_BEGIN).length > 1
    || lines.filter((l) => l.trim() === REEXPORT_END).length > 1) {
    problems.push('api.js has more than one re-export block');
  }
  const listed = [];
  for (const raw of lines.slice(begin + 1, end)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const m = line.match(REEXPORT_LINE);
    if (!m) { problems.push(`malformed line in the re-export block: ${line}`); continue; }
    listed.push(m[1]);
  }
  const onDisk = new Set(moduleNames);
  const inBlock = new Set(listed);
  for (const name of moduleNames) {
    if (!MODULE_NAME.test(name)) problems.push(`module name is not camelCase: lib/api/${name}.js`);
    if (!inBlock.has(name)) problems.push(`lib/api/${name}.js is missing from the re-export block — add: ${reexportLine(name)}`);
  }
  for (const name of listed) {
    if (!onDisk.has(name)) problems.push(`re-export block names lib/api/${name}.js, which does not exist`);
  }
  if (inBlock.size !== listed.length) problems.push('re-export block lists a module twice');
  const sorted = [...listed].sort();
  if (listed.join('\n') !== sorted.join('\n')) problems.push('re-export block is not in alphabetical order');
  return problems;
}

// ---------------------------------------------------------------------------
// Client calls and their match against the Worker's route table. Moved here
// from check-api-drift.mjs without behaviour change.
// ---------------------------------------------------------------------------

/**
 * Path normalisation. Both sides collapse to the same shape so they compare:
 *   worker  /projects/:id{[0-9]+}/spinout-deck  ->  /projects/:p/spinout-deck
 *   spa     /projects/${id}/spinout-deck        ->  /projects/:p/spinout-deck
 *
 * A `${...}` NOT preceded by '/' is a query/suffix interpolation
 * (`/organizations${qs}`), not a path segment, so it is dropped rather than
 * turned into a segment that would never match.
 */
function stripInterpolation(s) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (depth === 0 && s[i] === '$' && s[i + 1] === '{') { depth = 1; i++; out += out.endsWith('/') ? ':p' : ''; continue; }
    if (depth > 0) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') depth--;
      continue;
    }
    out += s[i];
  }
  return out;
}

export function normalizePath(p) {
  return stripInterpolation(p)
    .split('?')[0]
    .replace(/:[A-Za-z_]\w*\{[^}]*\}/g, ':p') // Hono regex-constrained params
    .replace(/:[A-Za-z_]\w*/g, ':p')
    .replace(/\/+$/, '');
}

function readLiteral(src, i) {
  const quote = src[i];
  if (quote !== '`' && quote !== "'" && quote !== '"') return null;
  let value = '';
  let depth = 0; // template-interpolation nesting
  for (let j = i + 1; j < src.length; j++) {
    const ch = src[j];
    if (ch === '\\') { value += ch + src[j + 1]; j++; continue; }
    if (quote === '`') {
      if (depth === 0 && ch === '$' && src[j + 1] === '{') { depth = 1; value += '${'; j++; continue; }
      if (depth > 0) {
        // Skip the interpolation wholesale, including any nested literal.
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; value += depth === 0 ? '}' : ''; continue; }
        else if (ch === '`' || ch === "'" || ch === '"') {
          const inner = readLiteral(src, j);
          if (inner) { j = inner.end; continue; }
        }
        continue;
      }
    }
    if (ch === quote) return { value, end: j };
    if (quote !== '`' && ch === '\n') return null; // unterminated
    value += ch;
  }
  return null;
}

/** `[{ method, path }]` for every `request('/…', { method })` in `src`. */
export function extractClientCalls(src) {
  const calls = [];
  const re = /\brequest\s*\(\s*/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const lit = readLiteral(src, m.index + m[0].length);
    if (!lit || !lit.value.startsWith('/')) continue;
    // Options object, if any: everything up to the matching close brace.
    let method = 'GET';
    const after = src.slice(lit.end + 1);
    const opts = after.match(/^\s*,\s*\{/);
    if (opts) {
      let depth = 0;
      let k = opts[0].length - 1;
      for (; k < after.length; k++) {
        if (after[k] === '{') depth++;
        else if (after[k] === '}') { depth--; if (depth === 0) break; }
      }
      const found = after.slice(0, k + 1).match(/method:\s*['"](\w+)['"]/);
      if (found) method = found[1].toUpperCase();
    }
    calls.push({ method, path: lit.value });
  }
  return calls;
}

/**
 * Sort client calls against a resolved route table (`[[VERB, '/api/…'], …]`).
 * `allowlist` holds SPA path prefixes (without `/api`) known to be pending.
 */
export function classifyCalls(calls, routes, allowlist = []) {
  const exact = new Set(routes.map(([v, p]) => `${v} ${normalizePath(p)}`));
  const anyVerb = new Set(routes.filter((r) => r[0] === 'ALL').map((r) => normalizePath(r[1])));
  const pathOnly = new Set(routes.map((r) => normalizePath(r[1])));
  const missingRoute = new Set();
  const missingMethod = new Set();
  const allowlisted = new Set();
  for (const { method, path } of calls) {
    const full = normalizePath('/api' + path);
    if (exact.has(`${method} ${full}`) || anyVerb.has(full)) continue;
    if ([...allowlist].some((a) => path === a || path.startsWith(a + '/'))) {
      allowlisted.add(`${method} ${full}`);
      continue;
    }
    (pathOnly.has(full) ? missingMethod : missingRoute).add(`${method} ${full}`);
  }
  return { missingRoute, missingMethod, allowlisted };
}
