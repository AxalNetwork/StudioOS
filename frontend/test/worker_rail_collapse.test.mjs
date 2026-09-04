/**
 * THE COLLAPSE TOGGLE IS REAL, AND THE TRACK MOVES WITH IT.
 *
 * The canvases all draw a rail that collapses to a 44px spine, and the icon
 * has been in the corner of every rail since the component was written — as a
 * bare `lucide-react` SVG with `aria-hidden="true"`. Not a button, no click,
 * no state. Its docblock explained why: every host is a grid item in a track
 * fixed at 268-288px, so narrowing the aside could not narrow the column, and
 * a collapse would have left a 240px blank space beside a spine.
 *
 * That was a true constraint and a bad outcome — a control that looks like a
 * control and does nothing is worse than no control. The fix moves the track:
 * eighteen host declarations now read `var(--fwr-track, <their own width>)`,
 * and `workerRail.css` defines `--fwr-track: 44px` once, globally, when the
 * preference is set.
 *
 * The guards below exist because that mechanism has three ways to rot quietly:
 * a new workspace page copying the old literal `286px` into its stylesheet, so
 * one page stops collapsing while the rest do; the toggle regressing to a
 * decorative icon; and the collapsed rules escaping their desktop media query,
 * where a 44px spine becomes a bar across a phone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const ROOT = resolve(process.cwd());
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const RAIL = read('frontend/src/ui/WorkerRail.jsx');
const CSS = read('frontend/src/ui/workerRail.css');
const SHELL = read('frontend/src/workspaces/WorkspaceShell.jsx');

/**
 * Where the `@media` block that opens at `from` closes — brace-counted, because
 * slicing to end-of-file swept the dark-mode block in with it and made the
 * "no raw hex" assertion fail against correct code.
 */
function mediaBlockEnd(from) {
  let depth = 0;
  for (let i = CSS.indexOf('{', from); i < CSS.length; i++) {
    if (CSS[i] === '{') depth += 1;
    else if (CSS[i] === '}' && --depth === 0) return i + 1;
  }
  return CSS.length;
}

/** Every stylesheet under frontend/src, walked rather than globbed. */
function stylesheets(dir = join(ROOT, 'frontend', 'src')) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...stylesheets(full));
    else if (name.endsWith('.css')) out.push(full);
  }
  return out;
}

/**
 * The one two-column grid in this width band that is NOT a rail.
 * `.fs-advisor-unavailable` is a notice panel on the Studio home, and that page
 * mounts no rail at all — asserted below rather than asserted by this comment,
 * because a carve-out nobody re-checks is how an exception becomes a hole.
 */
const NOT_A_RAIL = ['frontend/src/pages/founder/founderStudioHome.css'];

test('no rail host still fixes its track to a literal width', () => {
  // Derived, not listed: a new workspace page that copies `286px` from a
  // sibling would be invisible to a hand-written file list, and the symptom —
  // one page whose rail refuses to collapse while every other page's does — is
  // exactly the kind of drift nobody reports.
  const literal = /grid-template-columns:\s*minmax\(\s*0\s*,\s*1fr\s*\)\s+(2[2-9]\d|30\d)px/g;
  const offenders = [];
  for (const file of stylesheets()) {
    const rel = relative(ROOT, file);
    if (NOT_A_RAIL.includes(rel)) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(literal)) offenders.push(`${rel}: ${m[0]}`);
  }
  assert.deepEqual(offenders, [],
    'a rail track must read var(--fwr-track, <width>) so the collapse reaches it');
});

test('the one carve-out is still not a rail', () => {
  // If that page ever grows a rail, the exemption above stops being true and
  // this fails — which is the only thing that keeps the list honest.
  for (const rel of NOT_A_RAIL) {
    const jsx = rel.replace(/\.css$/, '.jsx').replace('founderStudioHome', 'FounderStudioHome');
    assert.doesNotMatch(read(jsx), /WorkerRail/,
      `${rel} is exempt only because its page mounts no rail`);
  }
});

test('every rail track keeps its own width as the fallback', () => {
  // The property collapses the rail; the FALLBACK is what guarantees nothing
  // moves while it is open. A `var(--fwr-track)` with no fallback, or with one
  // shared width, would silently re-lay-out seventeen pages.
  const tracks = [];
  for (const file of stylesheets()) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/grid-template-columns:\s*minmax\(\s*0\s*,\s*1fr\s*\)\s+var\(([^)]*)\)/g)) {
      tracks.push({ file: relative(ROOT, file), inner: m[1] });
    }
  }
  assert.ok(tracks.length >= 19, `expected the known host grids, found ${tracks.length}`);
  for (const t of tracks) {
    assert.match(t.inner, /^--fwr-track,\s*\d{3}px$/,
      `${t.file} must fall back to its own pixel width`);
  }
  // Not all the same number: several hosts differ by design (268, 270, 276,
  // 278, 285, 286, 288) and collapsing them to one value here would be a
  // layout change smuggled in as a refactor.
  const widths = new Set(tracks.map((t) => t.inner.split(',')[1].trim()));
  assert.ok(widths.size >= 5, `hosts must keep their distinct widths, saw ${[...widths].join(' ')}`);
});

test('the shell rail slot reads the same property', () => {
  assert.match(SHELL, /var\(--fwr-track,\s*280px\)/,
    'WorkspaceShell must collapse with the host grids, not stay 280px around a spine');
  // Read the className itself, not the file: the comment beside it NAMES the
  // literal it replaced, and that explanation is the part worth keeping.
  const slot = SHELL.slice(SHELL.indexOf('fwr-shell-slot'), SHELL.indexOf('sticky top-20'));
  assert.doesNotMatch(slot, /w-\[280px\]/,
    'the literal width would win over the property and pin the slot open');
});

test('the toggle is a button, not a decorative icon', () => {
  const code = codeOnly(RAIL);
  assert.match(code, /<button\s+[\s\S]*?className="fwr-toggle"/,
    'a control has to be a button — the icon was aria-hidden and unfocusable');
  // Leading whitespace, not a bare substring: `data-was-aria-expanded=` also
  // CONTAINS `aria-expanded=`, so an unanchored match passed a mutation that
  // renamed the attribute off the button entirely. That mutation is why this
  // line reads the way it does.
  assert.match(code, /\saria-expanded=\{!collapsed\}/);
  assert.match(code, /\saria-controls=\{bodyId\}/, 'name the region it hides');
  assert.match(code, /onClick=\{toggle\}/);
  // The icon alone announces nothing, so the button carries a real label.
  assert.match(code, /className="fwr-sr"/);
  assert.match(CSS, /\.fwr-toggle:focus-visible\s*\{[^}]*outline:/,
    'a keyboard user must be able to see where they are');
});

test('the icon says which way the click goes', () => {
  // One glyph for both states is the tell of a toggle nobody wired: the rail
  // showed PanelRight whether it was open or shut.
  const code = codeOnly(RAIL);
  assert.match(code, /PanelRightOpen/);
  assert.match(code, /PanelRightClose/);
  assert.doesNotMatch(code, /\bPanelRight\b(?!Open|Close)/,
    'the ambiguous glyph is the one that was inert');
});

test('the choice is remembered, through the helpers that cannot throw', () => {
  // localStorage throws outright in some embedded contexts. `sidebar_collapsed`
  // is the existing precedent and it goes through these same two helpers.
  assert.match(RAIL, /const RAIL_COLLAPSED_KEY = 'worker_rail_collapsed';/);
  assert.match(RAIL, /safeReadJSON\(RAIL_COLLAPSED_KEY, false\)/);
  assert.match(RAIL, /safeWriteJSON\(RAIL_COLLAPSED_KEY, next\)/);
  assert.doesNotMatch(codeOnly(RAIL), /localStorage\./,
    'go through lib/storage, which is the reason those helpers exist');
});

test('the hosts are told, and untold when the rail unmounts', () => {
  // The width that changes is a grid track on an ancestor this component does
  // not own, so the state has to reach the document. Leaving the attribute set
  // after the last rail unmounts would shrink a track on a page with no rail
  // to put in it.
  assert.match(RAIL, /root\.setAttribute\(RAIL_COLLAPSED_ATTR, 'collapsed'\)/);
  assert.match(RAIL, /root\.removeAttribute\(RAIL_COLLAPSED_ATTR\)/);
  const effect = RAIL.slice(RAIL.indexOf('useEffect(() => {'), RAIL.indexOf('const toggle'));
  assert.match(effect, /return \(\) => root\.removeAttribute\(RAIL_COLLAPSED_ATTR\);/,
    'the cleanup is what stops a stale attribute outliving the rail');
});

test('collapsing is desktop-only, and the whole mechanism sits behind one query', () => {
  // Below 1024px the hosts already stack the rail under the body. A 44px spine
  // there is a bar across the page, so the preference is stored on a phone and
  // not applied on one — and both halves must be behind the SAME query or the
  // track shrinks while the rail stays open.
  const q = CSS.indexOf('@media (min-width: 1024px)');
  assert.ok(q > 0, 'the collapsed rules need a desktop media query');
  const block = CSS.slice(q, mediaBlockEnd(q));
  assert.match(block, /:root\[data-worker-rail="collapsed"\]\s*\{\s*--fwr-track:\s*44px;\s*\}/);
  assert.match(block, /aside\.fwr\[data-collapsed="true"\]\s*>\s*\.fwr-body\s*\{\s*display:\s*none;\s*\}/);
  // …and nothing that hides the rail may sit outside it.
  const before = CSS.slice(0, q);
  assert.doesNotMatch(before, /data-collapsed|--fwr-track:/,
    'a collapsed rule outside the query would apply on a phone');
});

test('the collapsed rules paint with the rail tokens, so dark mode follows', () => {
  // `.dark .fwr` redefines the --fwr-* tokens and nothing else. A raw hex in
  // the collapsed block would render a light-mode colour on the dark ground —
  // and check-dark-mode.mjs does not scan frontend/src/ui, so nothing else
  // would catch it.
  const q = CSS.indexOf('@media (min-width: 1024px)');
  const block = CSS.slice(q, mediaBlockEnd(q));
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/,
    'use the --fwr-* tokens; the dark block only redefines those');
  assert.match(CSS, /\.fwr-toggle:hover\s*\{[^}]*var\(--fwr-accent\)/);
});
