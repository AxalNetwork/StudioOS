#!/usr/bin/env node
/**
 * The client error beacon reaches production, or it does not.
 *
 * `frontend/src/lib/log.js` is the SPA's only error reporter: it consoles,
 * keeps a capped `localStorage` ring support can read off an affected user's
 * browser, and in production beacons `POST /api/client-error` so the failure
 * lands in the Worker's deployment logs. Three ways of calling it wrongly have
 * all shipped, and each one is silent — the code runs, nothing throws, and the
 * report simply never arrives or arrives useless:
 *
 *   1. REVERSED ARGUMENTS. `reportError(err, { where })` instead of
 *      `reportError('Scope:op', err)`. 27 call sites had it. `toEntry` reads
 *      `.name`/`.message`/`.stack` off the context object, so the entry ships
 *      `message: "[object Object]"`, no stack and no name — and the error's own
 *      text lands in `scope`, the ONE field `redact` does not clean, which the
 *      Worker then writes verbatim into a log line.
 *
 *   2. NO IMPORT. `reportError` is a Web API global (`window.reportError`), so
 *      a file that calls it without importing it does NOT get a
 *      ReferenceError: it silently calls the BROWSER's one-argument "report an
 *      exception" function, which reports the scope string as an uncaught error
 *      and throws the real one away. `no-undef` — the repo's only ESLint rule —
 *      cannot ever flag this, because the name is a legitimate global.
 *      `SpinoutLabLpWorkspacePage.jsx` shipped that way.
 *
 *   3. A SCOPE `redact` EATS. Because the scope is now redacted (defence in
 *      depth against 1), a scope of `auth:refresh` would be rewritten to
 *      `auth:[redacted]` — `redact` strips `key:value` for a list of sensitive
 *      key names — and support would lose the one string they search by.
 *
 *   4. NO REPORT AT ALL. 36 catches logged to the console and nowhere else —
 *      33 of them across the eight Spin-Out Lab pages that never imported the
 *      helper. A console line reaches neither the ring buffer nor the beacon:
 *      it is visible only to someone who already had that browser's devtools
 *      open at the moment it happened, which is nobody. Every `console.*` left
 *      in `frontend/src` is allowlisted below with its reason, the console
 *      methods that reason covers, and — for the boundaries — a requirement
 *      that the file still reports.
 *
 * Note what 1 and 2 do to each other: a check for argument order PASSES the
 * unimported call, because its first argument really is a string literal. They
 * are separate assertions on purpose.
 *
 * Wired into `npm run test:guards`, so `npm run test:drift` runs it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { redact } from '../frontend/src/lib/log.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TREE = join(ROOT, 'frontend', 'src');

// The module that DEFINES the reporters. It neither imports nor calls them.
const DEFINER = join('frontend', 'src', 'lib', 'log.js');

/**
 * Every source file under `dir`.
 *
 * One `readdir(withFileTypes)` call and a try/catch around the read, rather
 * than `statSync` then `readFileSync` on the same path — that pair is the
 * TOCTOU shape CodeQL flags as `js/file-system-race`, which this repo has hit
 * before. A concurrent rename just skips the entry.
 */
function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (!ent.isFile()) continue;
      if (p.endsWith('.js') || p.endsWith('.jsx') || p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** A line that is only prose. Keeps this guard's own docblock from tripping it. */
const isComment = (line) => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

// `reportError(` / `reportWarn(` followed by whatever the first argument is.
// Deliberately a literal regex, not `new RegExp` — Semgrep flags constructed
// regexes, and this repo has taken that finding before.
const CALL = /\breport(Error|Warn)\s*\(\s*(.{0,120})/s;
const CALL_G = /\breport(?:Error|Warn)\s*\(/g;

// An import of either reporter from the log module, in any of the relative
// spellings the tree uses (`./log`, `../lib/log`, `../../lib/log`, `…/log.js`).
const IMPORTS_REPORTER = /import\s*\{[^}]*\breport(?:Error|Warn)\b[^}]*\}\s*from\s*['"][^'"]*\blog(?:\.js)?['"]/;

const CONSOLE = /\bconsole\.(log|warn|error|debug|info)\s*\(/;

/**
 * Where a bare `console.*` is still right, and why.
 *
 * Every other catch in `frontend/src` reports through `lib/log`, so its failure
 * reaches the ring buffer support reads off the user's browser and — for errors
 * — the production beacon. A console line alone reaches neither: it is visible
 * only to someone who already had the affected browser's devtools open at the
 * moment it happened, which is nobody.
 *
 * TWO THINGS KEEP AN ENTRY HONEST, because an allowlist keyed on the file alone
 * would bless whatever that file later grows.
 *
 * `methods` names which console methods the reason actually covers. It is what
 * `cloudflare-worker/scripts/check-console.mjs` already does on the worker side
 * — ban `console.log`, keep `.warn`/`.error` — and the same split applies here:
 * `.log` and `.debug` are debugging residue, and an entry admitting `.error`
 * because it is an error boundary should not also admit a stray `.log`. A
 * mutation caught this: a `console.log` dropped into `log.js` passed a
 * file-keyed allowlist, which made this docblock's own claim untrue.
 *
 * `pairsWithReport` makes the allowlist do its own checking rather than take
 * the entry's word for it. For the five error boundaries the console line is
 * kept for ONE reason — it carries `info.componentStack`, which `toEntry` has
 * no field for — and that reason only holds while the boundary also reports.
 * So those entries require a `reportError` call in the same file, and a
 * boundary that quietly loses its report fails this guard rather than sitting
 * in an allowlist that stopped being true.
 */
const CONSOLE_ALLOWED = new Map([
  ['frontend/src/lib/log.js', {
    why: 'the reporter itself — this is the console line every other call gets',
    methods: ['error', 'warn'],
    pairsWithReport: false,
  }],
  ['frontend/src/lib/funnel.js', {
    why: "two lines behind the file's own `isDev`, which never run in production",
    methods: ['debug', 'warn'],
    pairsWithReport: false,
  }],
  ['frontend/src/decks/templates/index.ts', {
    why: 'a registry-integrity check at module evaluation — it runs before any '
       + 'boundary exists to catch it, and a deck registry that imported empty '
       + 'is a build fault, not a user-session error',
    methods: ['error'],
    pairsWithReport: false,
  }],
  ['frontend/src/App.jsx', {
    why: 'AppErrorBoundary — adds info.componentStack', methods: ['error'], pairsWithReport: true,
  }],
  ['frontend/src/components/TopLevelErrorBoundary.jsx', {
    why: 'adds info.componentStack', methods: ['error'], pairsWithReport: true,
  }],
  ['frontend/src/components/RouteErrorBoundary.jsx', {
    why: 'adds info.componentStack', methods: ['error'], pairsWithReport: true,
  }],
  ['frontend/src/components/SafeMount.jsx', {
    why: 'adds info.componentStack', methods: ['error'], pairsWithReport: true,
  }],
  ['frontend/src/decks/Thumbnail.tsx', {
    why: 'ThumbnailBoundary — adds the template key', methods: ['error'], pairsWithReport: true,
  }],
]);

const problems = [];

for (const file of sourceFiles(TREE)) {
  const rel = relative(ROOT, file);

  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }

  const lines = text.split('\n');

  // 4 — a failure logged only to the console reaches nobody.
  const allowed = CONSOLE_ALLOWED.get(rel.split(sep).join('/'));
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    const hit = line.match(CONSOLE);
    if (!hit) return;
    const method = hit[1];
    if (allowed && !allowed.methods.includes(method)) {
      problems.push(
        `${rel}:${i + 1}: console.${method} is not what this file is allowlisted for `
        + `(${allowed.methods.map((m) => `console.${m}`).join(' and ')} only — ${allowed.why}). `
        + `\`.log\` and \`.debug\` are debugging residue; nothing reads them in production.`,
      );
      return;
    }
    if (!allowed) {
      problems.push(
        `${rel}:${i + 1}: a bare console.* call. Use reportError('Scope:op', err) — or reportWarn `
        + `where warn is right — so the failure reaches the ring buffer and, for errors, the `
        + `production beacon. A console line is visible only to someone who already had this `
        + `browser's devtools open when it happened.`,
      );
      return;
    }
    if (allowed.pairsWithReport && !text.includes('reportError(')) {
      problems.push(
        `${rel}:${i + 1}: console.* is allowed here only because the boundary ALSO calls `
        + `reportError (${allowed.why}), and this file no longer does. Restore the report or `
        + `drop the allowlist entry in scripts/check-frontend-logging.mjs.`,
      );
    }
  });

  // Below here is about CALLING the reporters, which the module that defines
  // them does not do. Its console lines are still scanned above, so a stray
  // `console.log` in the logger itself is still caught.
  if (rel === DEFINER) continue;
  if (!text.includes('reportError') && !text.includes('reportWarn')) continue;

  let calls = 0;

  lines.forEach((line, i) => {
    if (isComment(line)) return;
    const found = line.match(CALL_G);
    if (!found) return;
    calls += found.length;

    const m = line.match(CALL);
    const rest = (m && m[2]) || '';
    const first = rest.trimStart();
    const quote = first[0];

    // 1 — the scope must be authored, not thrown.
    if (quote !== "'" && quote !== '"' && quote !== '`') {
      problems.push(
        `${rel}:${i + 1}: report${m[1]}()'s first argument must be the scope, a string or template `
        + `literal — got \`${first.slice(0, 40)}\`. Reversed arguments ship no stack, a message of `
        + `"[object Object]", and the error's own text in the unredacted \`scope\` field.`,
      );
      return;
    }

    // 3 — and that scope must survive redact() intact, or support cannot find it.
    const end = first.indexOf(quote, 1);
    if (end > 1) {
      const literal = first.slice(1, end);
      // Template holes are runtime values; only the static text is checkable.
      const stat = literal.split('${')[0];
      if (stat && redact(stat) !== stat) {
        problems.push(
          `${rel}:${i + 1}: the scope \`${literal}\` is rewritten by redact() to `
          + `\`${redact(stat)}\` — rename it. A scope is what support greps for, and redact() `
          + `strips \`key:value\` for sensitive key names (auth, token, code, state, secret, …).`,
        );
      }
    }
  });

  // 2 — a call with no import is not an error, it is the WRONG FUNCTION.
  if (calls > 0 && !IMPORTS_REPORTER.test(text)) {
    problems.push(
      `${rel}: calls report${text.includes('reportWarn(') ? 'Warn' : 'Error'}() but never imports it. `
      + `That is not a ReferenceError — \`reportError\` is a Web API global, so the call silently `
      + `reaches window.reportError(), which reports the scope string as an uncaught exception and `
      + `discards the real error. Add \`import { reportError } from '<…>/lib/log';\`.`,
    );
  }
}

if (problems.length) {
  console.error('✖ check-frontend-logging:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(
  `✓ check-frontend-logging: every reportError/reportWarn call names an authored scope, `
  + `imports the real reporter and survives redact(); the only console.* left in frontend/src `
  + `are the ${CONSOLE_ALLOWED.size} allowlisted files, each with its reason.`,
);
