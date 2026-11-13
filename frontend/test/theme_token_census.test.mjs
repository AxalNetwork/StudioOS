/**
 * The @theme block cannot drift from the census that produced it.
 *
 * `design/tokens/tokens.json` is a frequency count over the 107 Claude Design
 * canvases; `frontend/src/index.css`'s `@theme` block is what shipped. The
 * resolution rule between them is DECISIONS D2 — the System Sheet spec wins
 * for BRAND colours, the corpus majority wins for NEUTRALS — and the point of
 * recording the losing value under `spec` was to keep that reversible.
 *
 * `ui_design_tokens.test.mjs` already checks the forward direction: every
 * `axal-` utility used in ui/ has a matching token. This checks the other one,
 * which is where the damage would be: a hex edited in index.css to "fix" it
 * back to the spec sheet, silently undoing D2. My own task note for this work
 * said "do NOT bulk-replace hexes"; this is that note made executable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const css = read('frontend/src/index.css');
const tokens = JSON.parse(read('design/tokens/tokens.json'));

const themeBlock = css.slice(css.indexOf('@theme {'), css.indexOf('\n}', css.indexOf('@theme {')));
const declared = Object.fromEntries(
  [...themeBlock.matchAll(/^\s*(--[a-z-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]),
);

/** Walk a census family to {name: value}. */
const values = (family) => Object.fromEntries(
  Object.entries(tokens[family] || {}).map(([k, v]) => [k, v.value]),
);

test('the theme block parses, and the census is loaded', () => {
  assert.ok(Object.keys(declared).length >= 25, `parsed only ${Object.keys(declared).length} tokens`);
  assert.ok(tokens.color && tokens.radius && tokens.spacing && tokens.fontSize);
});

test('every shipped radius is the census value, to the pixel', () => {
  const r = values('radius');
  const pairs = [
    ['--radius-axal-xs', r.input], ['--radius-axal-sm', r.button],
    ['--radius-axal-md', r.innerCard], ['--radius-axal-lg', r.block],
  ];
  for (const [cssVar, expected] of pairs) {
    assert.ok(expected, `census has no value for ${cssVar}`);
    assert.equal(declared[cssVar], expected, `${cssVar} drifted from the census`);
  }
});

test('the brand violets are the spec palette, per D2', () => {
  // These cost nothing under D2 — they were already the corpus majority.
  assert.equal(declared['--color-axal-violet'], '#7c3aed');
  assert.equal(declared['--color-axal-violet-deep'], '#6d28d9');
  assert.equal(declared['--color-axal-amber'], '#fcd34d');
});

test('the neutrals that FLIPPED still carry the corpus value, not the spec', () => {
  // This is the one a well-meaning edit would undo. Each shipped value beat a
  // different spec value; the comment in index.css records both.
  const flipped = [
    ['--color-axal-ink', '#18181b', '#241f38'],
    ['--color-axal-hairline', '#ececf1', '#e8e6ee'],
    ['--color-axal-faint', '#a1a1aa', '#8b8798'],
  ];
  for (const [cssVar, corpus, spec] of flipped) {
    assert.equal(declared[cssVar], corpus,
      `${cssVar} is not the corpus majority — if this was deliberate, re-read DECISIONS D2 first`);
    assert.notEqual(declared[cssVar], spec);
    assert.ok(css.includes(`spec was ${spec}`), `index.css no longer records what ${cssVar} beat`);
  }
});

test('the two tokens with no majority stayed on the spec, and say so', () => {
  assert.equal(declared['--color-axal-muted'], '#6b6577');
  assert.equal(declared['--color-axal-ground'], '#f4f3f7');
  assert.match(css, /no clear majority/);
});

test('the label tracking ships both values the census could not separate', () => {
  const ls = values('letterSpacing');
  assert.equal(declared['--tracking-axal-heading'], ls.heading);
  // .07em led on occurrences, .07 and .09 tied on canvases, the spec's .11 was
  // a distant third — so the default is the corpus and the spec is `-wide`.
  assert.equal(declared['--tracking-axal-label'], '0.07em');
  assert.equal(declared['--tracking-axal-label-wide'], '0.11em');
});

test('the census families NOT minted as tokens are deliberate, and stay unminted', () => {
  // The System Sheet declares a type scale (23 / 16 / 14.5 / 12.5px) and a
  // spacing scale (4 / 7 / 11 / 14 / 20 / 30px), and the census confirmed both.
  // Neither is in @theme, for a reason index.css states: Tailwind v4
  // TREE-SHAKES a token no utility references, dropping it from the built CSS
  // entirely. Minting a scale nothing uses yet produces tokens that silently
  // resolve to nothing — worse than absent, because they look present.
  //
  // Mint them in the same commit that adopts them, not before.
  assert.ok(tokens.fontSize && tokens.spacing, 'the census recorded both families');
  for (const k of Object.keys(declared)) {
    assert.ok(!k.startsWith('--text-axal'), `${k} was minted — is a component using it?`);
    assert.ok(!k.startsWith('--spacing-axal'), `${k} was minted — is a component using it?`);
  }
  assert.match(css, /tree-shakes @theme tokens/);
});
