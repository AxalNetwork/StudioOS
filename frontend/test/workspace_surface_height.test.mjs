/**
 * Workspace surfaces size to their CONTAINER, never to the viewport.
 *
 * Every workspace page renders inside `main` (App.jsx), which is a flex child
 * of an `h-screen` column sitting BELOW a 56px header and ABOVE the footer. A
 * surface that asks for `min-height: 100dvh` therefore demands the whole
 * viewport inside a box that is already shorter than the viewport by the
 * header plus the footer — so it overshoots, the page gains a scrollbar it
 * did not need, and the surface's own background paints a dead band between
 * where the content stops and where the footer begins.
 *
 * Measured on founder /network at 1440x900 before the fix: the surface ran
 * 56 → 956 in a 900px viewport while its content ended at 739. 217px of
 * ground, and the footer pushed off-screen.
 *
 * There were 27 such rules across 22 stylesheets — 18 `100dvh`, 8 `100vh`,
 * and one `calc(100vh - 64px)` that had noticed the problem and subtracted a
 * header height (guessing 64px when the header is 56px) while still ignoring
 * the footer. All are now `min-height: 100%`, which resolves against the
 * container the surface actually lives in.
 *
 * `100%` is not a smaller `100vh`: it is the correct answer in both
 * directions. A SHORT page fills its container so the footer lands at the
 * bottom instead of floating mid-screen; a LONG page still grows past it,
 * because min-height never clamps. Both were measured.
 *
 * This is the same lesson as the Worker AI rail fix (GOTCHAS, "items-stretch
 * needs a row with a height"): height in this app comes from the flex chain,
 * not from the window.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'frontend/src');

function cssFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) cssFiles(p, out);
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

// A surface that genuinely owns the whole window — a full-bleed splash with no
// header or footer above it — would belong here, with the route named. It is
// empty on purpose: every page that asked for viewport height so far was
// inside `main` and wrong to.
const ALLOWED = new Set([]);

/**
 * Every rule body written for `selector`, found without building a RegExp from
 * a variable (Semgrep's detect-non-literal-regexp, and it reads clearer).
 *
 * Scanning for ALL of them matters: these stylesheets declare a selector more
 * than once — a base rule plus media-query and dark-theme overrides — and the
 * base rule is rarely the first. Matching only the first found
 * `.a6-network{padding:0}` and reported the fix missing.
 */
function rulesFor(css, selector) {
  const out = [];
  const needle = selector + '{';
  let i = css.indexOf(needle);
  while (i !== -1) {
    // Reject a partial class match: `.a6-net` must not match `.a6-network{`.
    const before = css[i - 1];
    if (before === undefined || /[\s,}{]/.test(before)) {
      const end = css.indexOf('}', i);
      if (end !== -1) out.push(css.slice(i, end + 1));
    }
    i = css.indexOf(needle, i + 1);
  }
  return out;
}

const withMinHeight = (css, sel) => rulesFor(css, sel).find((r) => r.includes('min-height'));


test('no workspace stylesheet sizes itself to the viewport', () => {
  const offenders = [];
  for (const file of cssFiles(SRC)) {
    const rel = relative(process.cwd(), file);
    if (ALLOWED.has(rel)) continue;
    const css = readFileSync(file, 'utf8');
    // min-height: 100vh / 100dvh / 100svh / 100lvh, and any calc() built on them.
    for (const m of css.matchAll(/min-height:\s*(?:calc\([^)]*\b100[dsl]?vh\b[^)]*\)|100[dsl]?vh)/g)) {
      offenders.push(`${rel} — ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [],
    `these size to the window rather than to the container they render in:\n  ${offenders.join('\n  ')}`);
});

test('the surfaces that had the bug now size to their container', () => {
  // Named so a revert is loud rather than silent. These four are the routes
  // the defect was reported on.
  const want = [
    ['frontend/src/pages/founder/founderNetworkDesk.css', '.a6-network'],
    ['frontend/src/pages/founder/founderRaiseDesk.css', '.raise-desk'],
    ['frontend/src/pages/founder/founderBuildDesk.css', '.build-desk'],
    ['frontend/src/pages/founder/founderValidate.css', '.validate-desk'],
  ];
  for (const [file, sel] of want) {
    const css = readFileSync(resolve(process.cwd(), file), 'utf8');
    const rule = withMinHeight(css, sel);
    assert.ok(rule, `${sel} has no rule carrying min-height in ${file}`);
    assert.match(rule, /min-height:\s*100%/, `${sel} no longer sizes to its container`);
  }
});

test('the two card-on-ground surfaces let the card fill the ground', () => {
  // /network and /research draw a bordered card floating on a grey ground,
  // unlike the edge-to-edge desks. Fixing the surface alone left the CARD at
  // content height, so the ground still showed as a band beneath it — 112px at
  // 1440x900. The surface is a column and the card grows into it.
  for (const [file, surface, card] of [
    ['frontend/src/pages/founder/founderNetworkDesk.css', '.a6-network', '.a6-canvas'],
    ['frontend/src/pages/founder/founderResearchDesk.css', '.a7-research', '.a7-canvas'],
  ]) {
    const css = readFileSync(resolve(process.cwd(), file), 'utf8');
    const s = withMinHeight(css, surface);
    assert.ok(s, `${surface} rule not found`);
    assert.match(s, /display:flex/, `${surface} must be a column for the card to grow`);
    assert.match(s, /flex-direction:column/);
    const c = rulesFor(css, card).find((r) => r.includes('grid-template-columns'));
    assert.ok(c, `${card} grid rule not found`);
    assert.match(c, /flex:1/, `${card} must grow, or the ground bands beneath it`);
  }
});
