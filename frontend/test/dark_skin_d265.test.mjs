/**
 * D265 — the dark-mode skin, read from the COMPILED stylesheet.
 *
 * `index.css`'s skin (Task #17) is unlayered and every Tailwind 4 utility sits
 * in `@layer utilities`. For normal declarations an unlayered rule beats every
 * layer whatever its specificity, so two things must both be true, and neither
 * is visible in the source text alone:
 *
 *   1. THE SKIN STAYS OUTSIDE EVERY LAYER. Inside `@layer base` (or any layer
 *      below utilities) the bare `.bg-white` utility would win, and every token
 *      the skin exists for would paint its light value in dark mode. Reading
 *      the source with a regex passes with the block wrapped in a layer, which
 *      is why this test compiles it.
 *   2. EACH BACKGROUND AND HOVER RULE STEPS ASIDE for an element that declares
 *      its own dark value. Without the opt-out an unlayered skin paints over
 *      `dark:bg-gray-800` and `dark:hover:bg-violet-900` alike.
 *
 * `@tailwindcss/node` is the compiler `@tailwindcss/vite` uses, installed in CI
 * by `npm ci`, so this runs where CI runs — no browser. The Chromium probe that
 * checks what an element actually paints is a recorded verification in D265.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const require = createRequire(resolve(root, 'frontend/package.json'));
const { compile } = require('@tailwindcss/node');

const CANDIDATES = [
  'bg-white', 'bg-gray-50', 'bg-gray-100', 'bg-axal-ground', 'hover:bg-gray-50', 'hover:bg-gray-100',
  'dark:bg-gray-800', 'dark:hover:bg-violet-900', 'divide-y', 'divide-gray-200',
];

async function compiled() {
  const css = readFileSync(resolve(root, 'frontend/src/index.css'), 'utf8');
  const c = await compile(css, { base: resolve(root, 'frontend/src'), onDependency() {} });
  return c.build(CANDIDATES);
}

/** Every style rule in `css`, with the at-rule headers that enclose it. */
function rules(css) {
  const out = [];
  const stack = [];
  let buf = '';
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') { i = css.indexOf('*/', i + 2) + 1; continue; }
    if (ch === '{') {
      const head = buf.trim();
      stack.push(head);
      if (!head.startsWith('@')) out.push({ selector: head, parents: stack.slice(0, -1) });
      buf = '';
    } else if (ch === '}') { stack.pop(); buf = ''; }
    else if (ch === ';') buf = '';
    else buf += ch;
  }
  return out;
}

const SKIN = '.dark [data-app-main]';
const inLayer = (r) => r.parents.some((p) => p.startsWith('@layer'));

test('D265: the skin compiles outside every @layer, and the utilities it covers compile inside one', async () => {
  const all = rules(await compiled());
  const skin = all.filter((r) => r.selector.includes(SKIN));
  assert.ok(skin.length >= 13, `only ${skin.length} skin rules found; the parser has stopped seeing them`);
  for (const r of skin) assert.ok(!inLayer(r), `a skin rule sits inside ${r.parents.join(' > ')}: ${r.selector.slice(0, 80)}`);
  // The one opt-out every rule shares: a [data-keep-light] subtree is left alone.
  for (const r of skin.filter((x) => !x.selector.includes('divide-gray'))) {
    assert.ok(r.selector.includes(':not([data-keep-light] *):not([data-keep-light])'),
      `a skin rule reaches inside [data-keep-light]: ${r.selector.slice(0, 80)}`);
  }
  // The premise the whole block rests on: the utility is layered.
  const util = all.find((r) => r.selector === '.bg-white');
  assert.ok(util, 'the bg-white utility was not emitted');
  assert.ok(util.parents.includes('@layer utilities'), 'bg-white is no longer in @layer utilities; D265\'s reasoning needs re-measuring');
});

test('D265: every background rule steps aside for an element with its own dark background or dark hover', async () => {
  const skin = rules(await compiled()).filter((r) => r.selector.includes(SKIN));
  const bg = ['.bg-white', '.bg-gray-50', '.bg-gray-100', '.bg-axal-ground'];
  for (const cls of bg) {
    const r = skin.find((x) => x.selector.includes(`${SKIN} ${cls}:`));
    assert.ok(r, `no skin rule for ${cls}`);
    assert.ok(r.selector.includes(':not([class*="dark:bg-"])'), `${cls}'s skin paints over an explicit dark:bg-`);
    assert.ok(r.selector.includes(':not([class*="dark:hover:bg-"]:hover)'), `${cls}'s skin paints over an explicit dark:hover:bg- while hovered`);
  }
});

test('D265: every hover rule steps aside for an element with its own dark hover', async () => {
  const skin = rules(await compiled()).filter((r) => r.selector.includes(SKIN));
  const hovers = skin.filter((r) => /\.hover\\:bg-/.test(r.selector));
  assert.equal(hovers.length, 2, 'the skin carries two hover rules (gray-50, gray-100)');
  for (const r of hovers) {
    assert.ok(r.selector.includes(':not([class*="dark:hover:bg-"])'), `a skin hover paints over an explicit dark:hover:bg-: ${r.selector.slice(0, 80)}`);
  }
});

test('D265: the divider rule uses Tailwind 4\'s shape, so the first divider is skinned too', async () => {
  const skin = rules(await compiled()).filter((r) => r.selector.includes(SKIN) && r.selector.includes('divide-gray'));
  assert.ok(skin.length > 0, 'no divider rule');
  for (const r of skin) {
    assert.ok(r.selector.includes('> :not(:last-child)'), 'the divider rule no longer matches v4\'s :not(:last-child) shape');
    assert.ok(!r.selector.includes('~ :not([hidden])'), 'the divider rule uses the v3 sibling shape v4 no longer emits');
  }
  // And the utility still draws the way the rule assumes.
  const util = rules(await compiled()).find((r) => r.selector.startsWith(':where(.divide-y > :not(:last-child))'));
  assert.ok(util, 'Tailwind no longer emits divide-y as :where(.divide-y > :not(:last-child))');
});
