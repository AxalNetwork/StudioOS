/**
 * /pricing's phone rules live only inside their container queries.
 *
 * #2284 shipped pricing.css with the two `@container` lines and their closing
 * braces missing, so the phone rules applied at every width: the plan cards
 * stacked, the profile tabs sat at the left, and the comparison table was the
 * one-plan switcher on a desktop (the owner's report, 2026-10-21). The canvas
 * draws three cards side by side, centred tabs and every plan in one table
 * above 640px.
 *
 *   node --test frontend/test/pricing_breakpoints.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync('frontend/src/pages/pricing.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the `@container (max-width: Npx)` block, matched brace for brace. */
function block(px) {
  const at = CSS.indexOf(`@container (max-width: ${px}px) {`);
  assert.notEqual(at, -1, `no @container (max-width: ${px}px) block`);
  let depth = 0;
  for (let i = CSS.indexOf('{', at); i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}' && --depth === 0) return { start: at, end: i, body: CSS.slice(CSS.indexOf('{', at) + 1, i) };
  }
  assert.fail(`@container (max-width: ${px}px) is never closed`);
}

/** The stylesheet with both container blocks cut out: what applies at every width. */
function everyWidth() {
  const blocks = [block(980), block(640)].sort((a, b) => b.start - a.start);
  let css = CSS;
  for (const b of blocks) css = css.slice(0, b.start) + css.slice(b.end + 1);
  return css;
}

test('the phone layout is inside @container (max-width: 640px)', () => {
  // Mutations checked: the 640 wrapper dropped again (the block is not found);
  // its closing brace dropped (never closed); `.axp-desk` hidden outside it.
  const phone = block(640).body;
  assert.match(phone, /\.axp-desk \{ display: none; \}/);
  assert.match(phone, /\.axp-phone \{ display: block; \}/);
  assert.match(phone, /\.axp-tabwrap \{ justify-content: flex-start; \}/);
  assert.match(phone, /\.axp-grid-3,[^{]*\{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test('the four-wide grids go two-wide inside @container (max-width: 980px)', () => {
  assert.match(block(980).body, /\.axp-grid-4 \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
});

test('at every width: three cards across, tabs centred, the whole comparison table shown', () => {
  const css = everyWidth();
  assert.match(css, /\.axp-grid-3 \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /\.axp-tabwrap \{ display: flex; justify-content: center;/);
  assert.match(css, /\.axp-phone \{ display: none; \}/);
  assert.doesNotMatch(css, /\.axp-desk \{ display: none; \}/, 'the comparison table is hidden on a desktop');
  assert.doesNotMatch(css, /justify-content: flex-start; \}\s*$/m, 'a phone rule escaped its container block');
  assert.doesNotMatch(css, /^\s*\.axp-grid-2, \.axp-grid-3/m, 'the cards stack on a desktop');
  // `.axp` is the container the queries measure.
  assert.match(css, /\.axp \{[^}]*container-type: inline-size;/);
});
