import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(process.cwd(), 'frontend/src');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const css = read('index.css');
const uiFiles = readdirSync(resolve(root, 'ui')).filter((f) => f.endsWith('.jsx'));

/** Every `.jsx` under a directory, recursively, relative to `frontend/src`. */
function jsxUnder(dir, out = []) {
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) jsxUnder(rel, out);
    else if (entry.name.endsWith('.jsx')) out.push(rel);
  }
  return out;
}

/**
 * The eight tokens the workspace layer names and `@theme` has never minted.
 *
 * THIS LIST MAY ONLY SHRINK. It is not permission — every entry is a class that
 * emits no CSS at all, so text meant to be muted inherits its parent's colour
 * and borders meant to be hairlines are simply absent. It reads as "slightly
 * wrong" rather than broken, which is why 397 of them survived.
 *
 * WHY THE SWEEP IS NOT DONE HERE. Either the eight get declared — which means
 * choosing eight colours in BOTH themes, and not one of the 397 call sites has
 * a `dark:` counterpart, so minting eight light values would flip the whole
 * workspace surface to light-only in dark mode — or the call sites move to
 * Tailwind's own greys, which is a restyle across four licences needing its own
 * render pass. Doing either inside this commit would be a large uninspected
 * visual change. `workspaces/bucketOverview.css` is the only place in the tree
 * that assigns concrete values to three of them (#4b5563 / #6b7280 / #e5e7eb),
 * and is the anchor for whoever takes the sweep.
 *
 * U11 asked for exactly this guard, and said why: "a guard that fails a NEW
 * undeclared `axal-*` class, so the number can only go down."
 */
const UNDECLARED_TODAY = new Set([
  'axal-ink-1', 'axal-ink-2', 'axal-ink-3',
  'axal-surface-2', 'axal-border', 'axal-border-soft',
  'axal-line', 'axal-blue',
]);

// Every `axal-` token a ui/ primitive references must actually be minted in the
// @theme block. Tailwind v4 tree-shakes theme tokens nothing references, and it
// does NOT warn when a utility names a token that was never declared — the
// class just silently produces no style. That failure is invisible in review
// and invisible at build time, so it gets a test.
test('every axal- utility used in ui/ has a matching @theme token', () => {
  const declared = new Set(
    [...css.matchAll(/--(?:color|radius|tracking|font)-(axal-[a-z0-9-]+)\s*:/g)].map((m) => m[1])
  );
  assert.ok(declared.size > 0, 'no axal tokens found in @theme — did the block move?');

  const missing = [];
  for (const file of uiFiles) {
    const src = read(`ui/${file}`);
    // bg-axal-violet, text-axal-muted/40, rounded-axal-lg, tracking-axal-label…
    for (const [, token] of src.matchAll(/\b(?:bg|text|border|ring|rounded|tracking|font)-(axal-[a-z0-9-]+)/g)) {
      // Strip a trailing opacity modifier's slash form already excluded by \b,
      // then check both the literal token and its radius/tracking spelling.
      if (!declared.has(token)) missing.push(`${file}: ${token}`);
    }
  }
  assert.deepEqual(missing, [], `ui/ references tokens that @theme never declares:\n  ${missing.join('\n  ')}`);
});

/**
 * The same rule over `pages/` and `workspaces/`, where the 397 live.
 *
 * `ui/` was clean when this file was written, so the rule guarded the one
 * directory that did not need it. U11 counted 390 undeclared references outside
 * it; the census for this commit found 397 across 8 tokens in 50 files — U11's
 * table lists six and double-counts `border-axal-border` as 16, which silently
 * includes the 11 `-soft` hits on the row below it. `axal-line` (8, the whole
 * HQ shell) and `axal-blue` (2, AdminPage) were missed entirely.
 */
test('no NEW undeclared axal- token appears in pages/ or workspaces/', () => {
  const declared = new Set(
    [...css.matchAll(/--(?:color|radius|tracking|font)-(axal-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
  );
  assert.ok(declared.size > 0, 'no axal tokens found in @theme — did the block move?');

  const offenders = [];
  const seen = new Set();
  for (const file of [...jsxUnder('pages'), ...jsxUnder('workspaces')]) {
    // COMMENTS STRIPPED. Six files carry a "NO UNDECLARED TOKENS" rule in their
    // docblock and NAME the tokens it forbids — counting those would make the
    // rule fail on its own explanation, which is the trap `bannedIn` and
    // `advisor_client_grants` both document.
    const src = codeOnly(read(file));
    for (const [, token] of src.matchAll(/\b(?:bg|text|border|ring|divide|rounded|tracking|font)-(axal-[a-z0-9-]+)/g)) {
      if (declared.has(token)) continue;
      seen.add(token);
      if (!UNDECLARED_TODAY.has(token)) offenders.push(`${file}: ${token}`);
    }
  }

  assert.deepEqual(offenders, [],
    'a NEW undeclared axal- token appeared. Tailwind v4 mints utilities from the\n'
    + '@theme block in frontend/src/index.css and emits NOTHING for a token that is\n'
    + 'not there — no warning, no build error, just a class with no style. Either\n'
    + `declare it in @theme (in both themes) or use one that exists:\n  ${offenders.join('\n  ')}`);

  // THE LIST MAY ONLY SHRINK. Without this, a token fixed everywhere would sit
  // in the allowlist forever and the next one could be waved through by adding
  // a line — which is how an allowlist becomes permission.
  const stale = [...UNDECLARED_TODAY].filter((t) => !seen.has(t));
  assert.deepEqual(stale, [],
    `these are no longer referenced anywhere — delete them from UNDECLARED_TODAY:\n  ${stale.join('\n  ')}`);
});

test('the barrel exports every primitive and re-export it claims', async () => {
  // Asserts on the EXPORT LIST, not on the file text.
  //
  // This test used to match `new RegExp(`\\b${name}\\b`)` against the raw
  // file, and it did not work: ui/index.js's own header explains the four
  // re-exports BY NAME ("EmptyState, ErrorState, Skeleton and InfoStrip"), so
  // the identifiers were present in prose whether or not they were exported.
  // Deleting all four `export { default as … }` lines left this passing.
  //
  // A guard that reads the comment describing the code instead of the code is
  // worse than no guard, because the green tick is mistaken for coverage.
  const barrel = read('ui/index.js');
  const exported = new Set([
    // export { default as X } from '…'   and   export { X, Y } from '…'
    ...[...barrel.matchAll(/^export\s*\{\s*default\s+as\s+(\w+)/gm)].map((m) => m[1]),
    ...[...barrel.matchAll(/^export\s*\{([^}]+)\}/gm)]
      .flatMap((m) => m[1].split(','))
      .map((part) => part.trim().split(/\s+as\s+/).pop().trim())
      .filter(Boolean),
  ]);
  for (const name of ['SectionLabel', 'Card', 'Pill', 'Stat', 'StatGrid', 'PILL_TONES',
                      'EmptyState', 'ErrorState', 'Skeleton', 'InfoStrip']) {
    assert.ok(exported.has(name),
      `ui/index.js does not EXPORT ${name} (mentioning it in a comment is not exporting it)`);
  }
});

// The reason Pill exists at all: 40 canvases define a local pill() factory and
// three of them order the same tone's colours differently. If a positional
// tuple form ever reappears here, that drift is back.
test('Pill exposes one named tone map and no positional tuple form', () => {
  // Strip comments first: Pill.jsx's own header quotes the three conflicting
  // tuple orderings as the evidence for why the component exists, and that
  // documentation must not trip the check it documents.
  const pill = read('ui/Pill.jsx')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
  assert.match(pill, /export const PILL_TONES = \{/);
  for (const tone of ['neutral', 'ok', 'warn', 'danger', 'info']) {
    assert.match(pill, new RegExp(`\\b${tone}:`), `PILL_TONES is missing the ${tone} tone`);
  }
  assert.doesNotMatch(pill, /\[\s*'#[0-9a-fA-F]{3,8}'\s*,/, 'positional colour tuple found — use named tones');
});

// D5: Inter was declared on body but never loaded, so the whole app rendered in
// system-ui. Guard both halves — the declaration and the actual font request.
test('Inter and Roboto Mono are both declared and actually loaded', () => {
  const html = readFileSync(resolve(process.cwd(), 'frontend/index.html'), 'utf8');
  assert.match(css, /--font-sans:\s*'Inter'/, 'Inter is not the sans token');
  assert.match(css, /--font-mono:\s*'Roboto Mono'/, 'Roboto Mono is not the mono token');
  assert.match(html, /family=Inter:wght@[\d;]*400[\d;]*/, 'Inter is never requested');
  assert.match(html, /family=Roboto\+Mono:wght@[\d;]*400/, 'Roboto Mono 400 is never requested');
  // The whole point of the index.html block: none of it may render-block.
  assert.match(html, /media="print" onload="this\.media='all'"/);
  assert.doesNotMatch(css, /@import url\("https:\/\/fonts\.googleapis/, 'render-blocking font @import is back');
});
