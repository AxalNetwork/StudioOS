import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'frontend/src');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const css = read('index.css');
const uiFiles = readdirSync(resolve(root, 'ui')).filter((f) => f.endsWith('.jsx'));

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

test('the barrel exports every primitive and re-export it claims', async () => {
  const barrel = read('ui/index.js');
  for (const name of ['SectionLabel', 'Card', 'Pill', 'Stat', 'StatGrid', 'PILL_TONES',
                      'EmptyState', 'ErrorState', 'Skeleton', 'InfoStrip']) {
    assert.match(barrel, new RegExp(`\\b${name}\\b`), `ui/index.js does not export ${name}`);
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
