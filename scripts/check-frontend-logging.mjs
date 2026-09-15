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
 * Note what 1 and 2 do to each other: a check for argument order PASSES the
 * unimported call, because its first argument really is a string literal. They
 * are separate assertions on purpose.
 *
 * Wired into `npm run test:guards`, so `npm run test:drift` runs it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
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

const problems = [];

for (const file of sourceFiles(TREE)) {
  const rel = relative(ROOT, file);
  if (rel === DEFINER) continue;

  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  if (!text.includes('reportError') && !text.includes('reportWarn')) continue;

  const lines = text.split('\n');
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
console.log('✓ check-frontend-logging: every reportError/reportWarn call names an authored scope, imports the real reporter, and survives redact().');
