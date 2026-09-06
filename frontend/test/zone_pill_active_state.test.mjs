/**
 * A zone pill may be accent-filled only when the reader is on that pill's route.
 *
 * WHAT SHIPPED. Four founder landing desks marked their current zone from CSS
 * position alone — `.validate-anchors a:first-child`, `.raise-anchors
 * a:first-child`, `.a5-grow-hero nav a:first-child`, `.a6-hero a:first-child`.
 * There was no route logic anywhere in the strip, so `/validate` lit
 * "Interviews", `/raise` lit "Status", `/grow` lit "Focus" and `/network` lit
 * "Relationships" while the reader sat on the overview, which is above the
 * zones and is not one of them. Measured in Chromium before the fix: one accent
 * pill on each of those four roots.
 *
 * AND IT LEAKED. All seven `/grow/*` zone pages import `founderGrowDesk.css`
 * beside their own and reuse its `.a5-grow-hero` header, so `/grow/talent`
 * rendered TWO accent pills at once — "Focus" from the desk's `:first-child`
 * and "Talent" from its own `is-active`.
 *
 * The mirror defect counted too: `founderResearchDesk.css` styled `.a7-anchors
 * a.active`, a class its page never set, and `.build-anchors` had no active
 * rule at all — so those two desks could never mark a zone even when they were
 * on one.
 *
 * WHY THE BAN IS ON THE SELECTOR SHAPE rather than on the four rules that
 * existed. Positional active-marking is a habit, not an incident: the same
 * thing sat in three investor stylesheets and in `AdvisorWorkspaceShell`'s
 * `index === 0`, and all four were written independently. A test naming the
 * four founder rules would pass the day someone adds a fifth.
 *
 * THIS IS SOURCE TEXT, NOT A DOM. What a browser computes is checked by
 * rendering the built bundle; see the PR. Here we hold the shape of the source
 * so the browser check cannot regress silently between runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

/** Every .css under a directory, recursively. */
function cssUnder(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(resolve(ROOT, rel), { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(rel, e.name));
      else if (e.name.endsWith('.css')) out.push(join(rel, e.name));
    }
  };
  walk(dir);
  return out;
}

/**
 * Split a stylesheet into `{ selector, body }`. These files are minified onto
 * one line, so a line-based scan sees a single 8KB "rule" and asserts nothing.
 * Brace depth is tracked because `@media` wraps rules in a block of its own.
 */
function rules(css) {
  const out = [];
  let buf = '';
  let depth = 0;
  let sel = '';
  for (const ch of css) {
    if (ch === '{') {
      depth += 1;
      if (depth === 1) { sel = buf.trim(); buf = ''; } else buf += ch;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { out.push({ selector: sel, body: buf }); buf = ''; }
      else if (depth > 0) buf += ch;
      else depth = 0;
    } else if (depth === 1 && buf.includes('{')) {
      buf += ch;
    } else {
      buf += ch;
    }
  }
  // An @media block's inner rules land in one body; re-split them so a
  // positional rule cannot hide inside a breakpoint.
  const flat = [];
  for (const r of out) {
    if (/^@/.test(r.selector) && r.body.includes('{')) flat.push(...rules(r.body));
    else flat.push(r);
  }
  return flat;
}

const POSITIONAL = /:(?:first-child|last-child|first-of-type|last-of-type|nth-child|nth-of-type)\b/;
const PAINTS = /(?:^|;)\s*(?:color|background|background-color|border-color|border)\s*:/;

test('no stylesheet marks a nav link current by its position', () => {
  const offenders = [];
  let scanned = 0;
  for (const file of [...cssUnder('frontend/src/pages'), ...cssUnder('frontend/src/workspaces')]) {
    for (const { selector, body } of rules(read(file))) {
      // Only selectors that END on an anchor: `td:first-child` sets a column
      // width and has no opinion about which tab you are on.
      if (!/\ba(?::[a-z-]|\s*$|\.|\[)/.test(selector) && !/\ba$/.test(selector.trim())) continue;
      if (!/\ba[^,]*$/.test(selector)) continue;
      scanned += 1;
      if (POSITIONAL.test(selector) && PAINTS.test(body)) offenders.push(`${file}  ${selector}`);
    }
  }
  assert.ok(scanned > 40, `only ${scanned} anchor rules were examined — the matcher is not matching`);
  assert.deepEqual(offenders, [],
    'a nav pill must take its accent from the URL, never from being first in the DOM:\n' +
    offenders.join('\n'));
});

const DESKS = [
  ['frontend/src/pages/founder/FounderValidatePage.jsx', 'validate-anchors'],
  ['frontend/src/pages/founder/FounderRaiseDesk.jsx', 'raise-anchors'],
  ['frontend/src/pages/founder/FounderGrowDesk.jsx', 'a5-grow-hero'],
  ['frontend/src/pages/founder/FounderNetworkDesk.jsx', 'a6-hero'],
  ['frontend/src/pages/founder/FounderResearchDesk.jsx', 'a7-anchors'],
  ['frontend/src/pages/founder/FounderBuildDesk.jsx', 'build-anchors'],
];

test('every founder desk strip derives its current pill from the URL', () => {
  for (const [file] of DESKS) {
    const src = codeOnly(read(file));
    assert.match(src, /import \{ zonePillClass \} from '\.\/deskZoneNav'/,
      `${file} must take its active rule from the one shared helper`);
    assert.match(src, /<NavLink[^>]*className=\{zonePillClass\}/,
      `${file} must render its zone pills as NavLink with the shared class rule`);
  }
});

test('zonePillClass names a pill current only when the router says it is', async () => {
  const { zonePillClass } = await import('../src/pages/founder/deskZoneNav.js');
  assert.equal(zonePillClass({ isActive: true }), 'is-active');
  // `undefined`, not `''`: an idle pill carries no class attribute at all.
  assert.equal(zonePillClass({ isActive: false }), undefined);
  assert.equal(zonePillClass({}), undefined);
});

test('the six desk stylesheets style .is-active, and none styles .active', () => {
  const SHEETS = [
    ['frontend/src/pages/founder/founderValidate.css', '.validate-anchors'],
    ['frontend/src/pages/founder/founderRaiseDesk.css', '.raise-anchors'],
    ['frontend/src/pages/founder/founderGrowDesk.css', '.a5-grow-hero nav'],
    ['frontend/src/pages/founder/founderNetworkDesk.css', '.a6-hero'],
    ['frontend/src/pages/founder/founderResearchDesk.css', '.a7-anchors'],
    ['frontend/src/pages/founder/founderBuildDesk.css', '.build-anchors'],
  ];
  for (const [file, scope] of SHEETS) {
    const css = read(file);
    assert.ok(css.includes(`${scope} a.is-active{`),
      `${file} must give ${scope} an .is-active rule — without one the desk can never mark a zone`);
    // `.active` is react-router's default class name. Six zone-page stylesheets
    // already settled on `.is-active`; two vocabularies for one state is how
    // founderResearchDesk.css ended up with a rule nothing ever matched.
    assert.ok(!new RegExp(`\\${scope.split(' ')[0]}[^{]*a\\.active\\{`).test(css),
      `${file} still styles a.active — the repo's class is .is-active`);
  }
});

/**
 * WCAG relative luminance, so "it has a dark rule" cannot pass for a rule
 * nobody can read. This matters more than usual here: each desk stylesheet
 * ends with a `.dark … a{…}` idle rule at EQUAL specificity but LATER in the
 * file, which is why the old `:first-child` accent was invisible in dark mode
 * — the fix is only real if the dark active rule out-specifies that.
 */
function contrast(fg, bg) {
  const chan = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (h) => {
    const [r, g, b] = chan(h).map(lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

test('a desk with a dark idle pill has a legible dark active pill', () => {
  const AA = 4.5;
  let checked = 0;
  for (const [file, scope] of [
    ['frontend/src/pages/founder/founderValidate.css', '.validate-anchors'],
    ['frontend/src/pages/founder/founderRaiseDesk.css', '.raise-anchors'],
    ['frontend/src/pages/founder/founderGrowDesk.css', '.a5-grow-hero nav'],
    ['frontend/src/pages/founder/founderNetworkDesk.css', '.a6-hero'],
    ['frontend/src/pages/founder/founderBuildDesk.css', '.build-anchors'],
  ]) {
    const css = read(file);
    const m = css.match(new RegExp(`\\.dark ${scope.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')} a\\.is-active\\{([^}]*)\\}`));
    assert.ok(m, `${file}: no .dark ${scope} a.is-active rule — the dark idle rule would swallow the active one`);
    const fg = m[1].match(/(?:^|;)color:(#[0-9a-f]{6})/i)?.[1];
    const bg = m[1].match(/(?:^|;)background:(#[0-9a-f]{6})/i)?.[1];
    assert.ok(fg && bg, `${file}: dark active rule must set both colour and background, got "${m[1]}"`);
    const ratio = contrast(fg, bg);
    assert.ok(ratio >= AA,
      `${file}: dark active pill ${fg} on ${bg} is ${ratio.toFixed(2)}:1, under AA ${AA}:1`);
    checked += 1;
  }
  assert.equal(checked, 5, 'every desk that has a dark idle pill rule must have been checked');
});

test('AdvisorWorkspaceShell no longer marks a nav item current by index', () => {
  const src = codeOnly(read('frontend/src/pages/advisor/AdvisorWorkspaceShell.jsx'));
  assert.ok(!/index === 0/.test(src),
    'the anchors strip marked item 0 active whatever the reader was looking at; it was unreachable and is removed');
  assert.ok(!/anchors/.test(src),
    'the `anchors` prop went with it — no caller ever passed one');
  // The tab strip beside it is the correct pattern and must survive.
  assert.match(src, /pathname === tab\.to \|\| pathname\.startsWith\(`\$\{tab\.to\}\/`\)/,
    'the advisory tab strip still derives active from the pathname');
});

test('the two route modules that resolve a zone carry the root opt-out', () => {
  // `zoneForPath` answers a bucket ROOT with its first zone — right on a zone
  // route, wrong on a root. Four route modules opt out with `isRoot`; these two
  // did not, and were safe only because nothing mounts them on a root today.
  for (const file of [
    'frontend/src/workspaces/founder/FounderValidateWorkspace.jsx',
    'frontend/src/workspaces/investor/InvestorDealsRoutes.jsx',
  ]) {
    const src = codeOnly(read(file));
    assert.match(src, /location\.pathname === bucket\.prefix/, `${file} must compute isRoot`);
    assert.match(src, /activeSlug=\{isRoot \? null : undefined\}/,
      `${file} must light no pill on a bucket root`);
    assert.match(src, /title=\{isRoot \? bucket\?\.label : undefined\}/,
      `${file} must title itself after the bucket on a root, not after a zone it is not on`);
  }
});
