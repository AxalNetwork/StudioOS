/**
 * Every `<WorkerRail>` mount in the product, and the branch tier's single one
 * (D126).
 *
 * THE BUG THIS EXISTS FOR, and it was live in production. `WorkerRail`
 * destructures twelve props and declares neither `surface` nor `title`. Three
 * shipped HQ pages — Content, Platform and Revenue — passed exactly those two,
 * where React discards them, and omitted `workspace`, `role` and `coverage`.
 * Five things followed, none of which raised anything anywhere:
 *
 *   · `ACCENT[role] || ACCENT.founder` painted founder violet on the oxblood
 *     tier;
 *   · `aria-label={`Worker AI controls · ${workspace}`}` announced "undefined"
 *     to a screen reader (the VISIBLE title merely lost its name — JSX drops an
 *     undefined child);
 *   · `modelKeyFor(workspace)` collapsed to the bare prefix, so one
 *     localStorage model preference was shared across all three pages;
 *   · `canRun = coverage.length > 0` was false, so all three printed "Not
 *     recorded" and disabled their only button — on pages that each load live
 *     figures;
 *   · and `surface="hq_content"` named nothing: `ASSIST_SURFACES` has five keys
 *     and that is not one of them.
 *
 * WHY NOTHING CAUGHT IT. `ui_assist_rail_and_sidebar.test.mjs` walks `pages/`
 * and `workspaces/` for `<AssistLayout surface="…">` and validates the name —
 * it never scans `<WorkerRail`. Its own header records the same miss one step
 * earlier, when the walk covered `pages/` only and every offender was in
 * `workspaces/`: the widening fixed the DIRECTORY, not the component. The
 * per-tier guards (`investor_shell`, `founder_shell`, `investor_fund_i6`,
 * `investor_portfolio_i4`, `founder_validate_a2`) each pin their own pages, so
 * a tier that never got one simply drifted. This file is tier-independent.
 *
 * WHY THE RULE IS NOT "EVERY MOUNT PASSES workspace AND role". Measured: 50
 * mounts, and 31 rely on `role = 'founder'`. Twenty-eight of those are founder
 * pages under `pages/founder/` and `workspaces/founder/`, where the default is
 * correct. That rule would have demanded 28 edits to correct code to catch 3
 * defects. The three below catch more and touch none of it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { codeOnlyJsx } from './_codeOnly.mjs';

const ROOT = resolve(process.cwd());
const SRC = resolve(ROOT, 'frontend/src');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Source with every comment blanked to spaces, NEWLINES KEPT.
 *
 * `_codeOnly.mjs` deletes its matches, which shifts every line number after
 * them — and this guard reports `file:line`, so a report that pointed at the
 * wrong line would be worse than no report. Blanking in place keeps each index
 * where it was.
 *
 * It also has to track strings, or the `/*` inside a className or a URL opens a
 * comment that eats the next few hundred lines — the mistake
 * `ui_assist_rail_and_sidebar.test.mjs` documents having made. And it is not
 * optional: this file's OWN docblock names `<WorkerRail>` four times, so a
 * scanner that reads comments accuses the guard of being its own first
 * offender. It did, before this existed.
 */
function blankComments(src) {
  const keep = (s) => s.replace(/[^\n]/g, ' ');
  let out = '';
  for (let i = 0; i < src.length;) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      out += keep(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += keep(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c;
      for (i++; i < src.length;) {
        if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        const done = src[i] === c;
        i++;
        if (done) break;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Every `<WorkerRail …>` OPENING TAG in the tree, whole.
 *
 * It has to be a scanner rather than a regex. A mount's props routinely hold
 * `{[['a', 'b > c']]}` and `{x > 0 ? … : …}`, so "up to the next `>`" cuts the
 * tag in half and a half-tag is missing props it plainly passes — which is the
 * false accusation this guard must never make. Depth over `{}` plus quote
 * tracking is what makes the span correspond to the element.
 */
function railMounts() {
  const found = [];
  for (const file of walk(SRC)) {
    const src = blankComments(readFileSync(file, 'utf8'));
    const rel = relative(ROOT, file);
    for (let i = src.indexOf('<WorkerRail'); i >= 0; i = src.indexOf('<WorkerRail', i + 1)) {
      // `<WorkerRailSomething` is a different component; require a boundary.
      if (/[A-Za-z0-9_]/.test(src[i + 11] ?? '')) continue;
      let depth = 0;
      let quote = null;
      let end = -1;
      for (let j = i + 11; j < src.length; j++) {
        const c = src[j];
        if (quote) { if (c === quote && src[j - 1] !== '\\') quote = null; continue; }
        if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '>' && depth === 0) { end = j; break; }
      }
      assert.ok(end > 0, `${rel}: a <WorkerRail> tag is not closed`);
      found.push({ rel, line: src.slice(0, i).split('\n').length, tag: src.slice(i, end + 1) });
    }
  }
  return found;
}

/**
 * The attribute names a tag passes, at the TOP LEVEL of the element only.
 *
 * NOT A REGEX ASSEMBLED FROM THE PROP NAME. This was a RegExp constructed from
 * `prop`, and Semgrep's `detect-non-literal-regexp` refused it — the third time
 * that query has landed on this repo, and the third time the right answer has
 * been to delete the constructed pattern rather than escape it better (#576
 * replaced one assembled from a route with a bounded substring scan).
 *
 * It is also more precise, which is the part worth having. A `\s<prop>=`
 * pattern matches inside a prop VALUE — `unavailable={[['Seat', 'a role= is
 * not a seat']]}` would have read as passing `role`. Walking the tag and taking
 * names only at brace depth 0 cannot.
 */
function attrNames(tag) {
  const names = [];
  let depth = 0;
  let quote = null;
  for (let j = 0; j < tag.length; j++) {
    const c = tag[j];
    if (quote) { if (c === quote && tag[j - 1] !== '\\') quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; continue; }
    if (depth !== 0) continue;
    const hit = /^\s([A-Za-z_$][\w$-]*)=/.exec(tag.slice(j));
    if (!hit) continue;
    names.push(hit[1]);
    j += hit[0].length - 1;
  }
  return names;
}

const MOUNTS = railMounts().map((m) => ({ ...m, attrs: attrNames(m.tag) }));
const at = (m) => `${m.rel}:${m.line}`;
const passes = (m, prop) => m.attrs.includes(prop);

test('the scanner finds the mounts it is a rule about', () => {
  // An empty list would make every assertion below vacuously true, which is
  // the failure mode this whole file exists to stop one layer up.
  assert.ok(MOUNTS.length >= 40, `only ${MOUNTS.length} <WorkerRail> mounts found — the scanner is broken`);
  assert.ok(MOUNTS.some((m) => m.rel.includes('pages/hq/')), 'no HQ mount found');
  assert.ok(MOUNTS.some((m) => m.rel.includes('pages/branch/')), 'no branch mount found');
});

test('every WorkerRail mount names its workspace', () => {
  // `workspace` is the title, the aria-label and the localStorage model key.
  // Omitting it is silent three ways over, which is why it is checked rather
  // than assumed.
  const bad = MOUNTS.filter((m) => !passes(m, 'workspace')).map(at);
  assert.deepEqual(bad, [], 'these mounts pass no `workspace`, so the rail has no name, no aria-label and shares one model preference');
});

test('no mount passes a prop WorkerRail does not declare', () => {
  // THE ROOT-CAUSE RULE, and the allowed set is PARSED FROM THE COMPONENT so
  // this file needs no list to curate. React silently discards an unknown prop,
  // so `surface` and `title` cost three pages their accent and their run button
  // without anything failing anywhere.
  const component = read('frontend/src/ui/WorkerRail.jsx');
  const open = component.indexOf('export default function WorkerRail({');
  assert.ok(open > 0, 'WorkerRail is no longer a default-exported function with a destructured parameter list');
  const params = component.slice(open, component.indexOf('}) {', open));
  const declared = new Set(
    [...params.matchAll(/^\s*(?:'([\w-]+)'\s*:\s*\w+|([A-Za-z_$][\w$]*))\s*(?:=|,|$)/gm)]
      .map((m) => m[1] || m[2])
      .filter(Boolean),
  );
  assert.ok(declared.has('workspace') && declared.has('coverage') && declared.has('data-testid'),
    `the parameter list did not parse — got ${[...declared].join(', ')}`);

  const ALWAYS_OK = new Set(['key', 'ref']);
  const bad = [];
  for (const m of MOUNTS) {
    for (const name of m.attrs) {
      if (!declared.has(name) && !ALWAYS_OK.has(name)) bad.push(`${at(m)}  ${name}=`);
    }
  }
  assert.deepEqual(bad, [], 'these props are discarded by React — WorkerRail does not declare them');
});

test('a mount outside the founder tree names its role, and every literal role is a real accent', () => {
  // `role = 'founder'` is the default and it is RIGHT in the founder tree, so
  // demanding the prop there would be 28 edits to correct code. Outside it the
  // default is wrong and silent: `ACCENT[role] || ACCENT.founder` means a
  // missing role and a misspelt one fail identically.
  //
  // This is a PATH rule, not a file allowlist — it cannot go stale, and moving
  // a founder page out of that tree correctly starts demanding the prop.
  const FOUNDER_TREE = ['frontend/src/pages/founder/', 'frontend/src/workspaces/founder/'];
  const missing = MOUNTS
    .filter((m) => !FOUNDER_TREE.some((p) => m.rel.startsWith(p)) && !passes(m, 'role'))
    .map(at);
  assert.deepEqual(missing, [], 'these mounts are outside the founder tree and inherit the founder accent by default');

  const accents = read('frontend/src/workspaces/shellConfig.js');
  const block = accents.slice(accents.indexOf('export const ACCENT = {'));
  const keys = new Set([...block.slice(0, block.indexOf('\n};')).matchAll(/^\s*(\w+):\s*\{/gm)].map((m) => m[1]));
  assert.ok(keys.has('founder') && keys.has('branch_admin'), `ACCENT did not parse — got ${[...keys].join(', ')}`);

  const wrong = [];
  for (const m of MOUNTS) {
    const lit = /\srole="([^"]*)"/.exec(m.tag);
    if (lit && !keys.has(lit[1])) wrong.push(`${at(m)}  role="${lit[1]}"`);
  }
  assert.deepEqual(wrong, [], 'these mounts name a role ACCENT does not define, so they render the founder accent');

  // WHAT THIS RULE CANNOT SEE, said plainly so a green run is not over-read.
  // A computed `role={role}` is beyond a lexical check. Banning it would break
  // the mounts that serve several licences, and naming the files would be an
  // allowlist, so the guard is a ceiling — the shape
  // `check-timestamp-comparisons.mjs` already uses. The ceiling is the two
  // shared shells (Research, Network) plus the three research detail pages
  // that take the route's role (company, fund, market reading). A sixth mount
  // should pass a literal role instead.
  const computed = MOUNTS.filter((m) => /\srole=\{/.test(m.tag)).map(at);
  assert.ok(computed.length <= 5,
    `${computed.length} mounts compute their role; a lexical guard cannot check those, so keep them few: ${computed.join(', ')}`);
});

// --- The branch tier -----------------------------------------------------

test('the branch tier mounts exactly one rail, and BranchZone is where it is', () => {
  // ONE MOUNT IS THE DELIVERABLE. Eight routes each building their own layout
  // is how HQ ended up with five copies of one grid, three of which drifted.
  const branch = MOUNTS.filter((m) => m.rel.startsWith('frontend/src/pages/branch/'));
  assert.deepEqual(branch.map((m) => m.rel), ['frontend/src/pages/branch/BranchZone.jsx'],
    'the branch tier must mount WorkerRail exactly once, in BranchZone');
  assert.match(branch[0].tag, /role="branch_admin"/, 'the branch rail must wear the steel accent, not the founder default');
  assert.match(branch[0].tag, /workspace=\{workspace\}/, 'the branch rail takes its name from the zone that hosts it');
});

test('the branch rail column collapses with the rail', () => {
  // `workerRail.css` sets `--fwr-track: 44px` on
  // `:root[data-worker-rail="collapsed"]`, so a host declaring its column as
  // `var(--fwr-track, <own width>)` narrows when the reader collapses.
  // `WorkspaceShell.jsx` is the precedent; the five HQ pages hardcode `280px`
  // in a Tailwind literal and do NOT collapse, which is a separate defect this
  // guard deliberately does not pretend to cover.
  const zone = codeOnlyJsx(read('frontend/src/pages/branch/BranchZone.jsx'));
  assert.match(zone, /var\(--fwr-track, 280px\)/, 'the branch rail column must read --fwr-track, or collapsing the rail leaves a hole');
  assert.doesNotMatch(zone, /grid-cols-\[minmax\(0,1fr\)_280px\]/, 'do not copy the HQ literal — it cannot collapse');
});

test('the deployment sentence belongs to the frame, not to a page', () => {
  // S12 draws a card that DECLINES a cross-branch question. It cannot be
  // honestly built — the rail has no free-text input, `aiRouter.ts` carries no
  // branch awareness, and a branch Worker has one D1 binding, so the question
  // cannot be asked. One always-visible sentence says the true thing, and it
  // lives in the frame so no zone can ship without it.
  const zone = read('frontend/src/pages/branch/BranchZone.jsx');
  // D151 RE-AIMED THIS FROM THE SPELLING TO THE PROPERTY. It matched the
  // sentence as a LITERAL `note="…"`, so the moment the sentence started
  // naming the branch — S12 rule 1, which needs it derived rather than typed —
  // a correct change failed a guard about a fact that had not changed. What is
  // pinned now is what the frame must still do: pass the rail a note, state
  // that it reads one database and no other, and say the cross-branch question
  // is one it CANNOT ASK rather than one it declines.
  assert.match(zone, /note=\{note\}/, 'the frame must still supply the rail its note');
  assert.match(zone, /reads \$\{label\}'s database and no other/,
    'the sentence must name the branch when one is known (S12 rule 1)');
  // The apostrophe is BACKSLASH-ESCAPED in the source (it sits in a
  // single-quoted string), so the optional `\\?` is what makes this read the
  // file rather than the sentence as a human types it.
  assert.match(zone, /reads this deployment\\?'s database and no other/,
    'and must stay true off a branch, where there is no name to use');
  assert.match(zone, /one it cannot ask rather than one it declines/,
    'the branch rail must state the wall, not perform a refusal');
});

test('all eight branch routes render through the frame', () => {
  // A route that skipped it would have no rail at all, which is the state this
  // PR is ending — and it would be invisible, because a missing rail looks like
  // a page that simply has none.
  const app = codeOnlyJsx(read('frontend/src/App.jsx'));
  // ANY DEPTH, AND THE COUNT IS DERIVED (D210). The pattern read one segment
  // below `/branch` and the count was typed as eight, so `/branch/insights/
  // analytics` — S15, two segments deep — matched nothing and the frame check
  // below never saw it: a nested page could have shipped with no rail and this
  // test would still have counted eight and passed. Every `path="/branch…"` the
  // router declares must now be one this pattern reads, or the count differs.
  const routes = [...app.matchAll(/<Route path="(\/branch(?:\/[a-z-]+)*)" element=\{([\s\S]*?)\)\} \/>/g)];
  const declared = app.split('path="/branch').length - 1;
  assert.ok(declared >= 9, `expected at least nine /branch routes, found ${declared}`);
  assert.equal(routes.length, declared,
    `${declared} /branch routes are declared and ${routes.length} were read, so one is outside the frame check`);
  const bare = routes
    .filter(([, , el]) => !el.includes('<BranchZone '))
    .map(([, path, el]) => ({ path, el }));

  // EXACTLY ONE FRAME PER ROUTE, DERIVED RATHER THAN LISTED. A route either
  // takes the frame from `App.jsx` or its page wraps itself — never neither
  // (no rail at all, invisible, because a missing rail looks like a page that
  // has none) and never both (two rails, which is the doubled-chrome failure
  // this repo has fixed three times).
  //
  // THE LIST OF SELF-WRAPPERS IS NOT TYPED IN. It was, and it went stale on the
  // very next PR: D129 gave `/branch/accounts` a page that loads live figures,
  // so it wraps itself exactly as approvals does, and a hardcoded
  // `['/branch/approvals']` failed a correct change. Every zone PR 12–14 builds
  // will do the same. So the route's own element names the component, and the
  // component is read — which also catches the case a list never could: a page
  // that stops wrapping itself while the route still expects it to.
  for (const { path, el } of bare) {
    const named = /<([A-Z][A-Za-z0-9]*)\b/.exec(el);
    assert.ok(named, `${path} renders no component, so it cannot have a rail`);
    const file = `frontend/src/pages/branch/${named[1]}.jsx`;
    let page;
    try {
      page = codeOnlyJsx(read(file));
    } catch {
      assert.fail(
        `${path} takes no frame from App.jsx and ${named[1]} is not a page under pages/branch/, `
        + 'so nothing mounts its rail',
      );
    }
    assert.match(page, /<BranchZone\s/,
      `${path} has no frame: the route does not wrap it and ${named[1]} does not wrap itself, so it has no rail at all`);
    assert.match(page, /workspace="[^"]+"/,
      `${named[1]}'s rail does not name its zone, so its aria-label and its model key are both wrong`);
  }

  // And the two that are self-wrapping today still are, named so that DELETING
  // a page's frame fails here rather than passing the generic loop above by
  // dropping out of `bare` entirely.
  for (const [file, workspace] of [
    ['frontend/src/pages/branch/BranchApprovals.jsx', 'Approvals'],
    ['frontend/src/pages/branch/BranchAccounts.jsx', 'Accounts'],
  ]) {
    const page = codeOnlyJsx(read(file));
    assert.match(page, /<BranchZone\s/, `${file} lost its own frame, so it now has no rail at all`);
    // A literal `includes`, not a constructed RegExp: Semgrep's
    // `detect-non-literal-regexp` flagged exactly that shape on #595, and a
    // substring is what this actually needs.
    assert.ok(page.includes(`workspace="${workspace}"`), `${file}'s rail must name its zone`);
  }
});

test('the three HQ pages that were mis-mounted are fixed, each with real coverage', () => {
  // Named rather than left to the generic rules above, because the generic
  // rules would also pass on a mount that had been DELETED. These three must
  // still have a rail, and it must be able to run.
  for (const [file, workspace] of [
    ['frontend/src/pages/hq/ContentPage.jsx', 'Content'],
    ['frontend/src/pages/hq/PlatformPage.jsx', 'Platform'],
    ['frontend/src/pages/hq/RevenuePage.jsx', 'Revenue'],
  ]) {
    const mount = MOUNTS.find((m) => m.rel === file);
    assert.ok(mount, `${file} no longer mounts a WorkerRail`);
    assert.ok(mount.tag.includes(`workspace="${workspace}"`), `${file}: wrong or missing workspace`);
    assert.match(mount.tag, /role="super_admin"/, `${file}: the HQ tier is oxblood, not founder violet`);
    assert.match(mount.tag, /coverage=\{coverage\}/, `${file}: without coverage the rail's only button stays disabled`);
    // And the coverage is assembled from the page's OWN reads rather than a
    // constant, which is what makes a failed source drop its line instead of
    // printing a zero.
    const src = codeOnlyJsx(read(file));
    assert.match(src, /const coverage = \[[\s\S]*?\]\.filter\(Boolean\)/,
      `${file}: coverage must be built per source and filtered, so a failed read contributes no line`);
  }
});

test('the real-coverage rule reaches the BRANCH tier, not only HQ (D151)', () => {
  // THE RULE WAS ALREADY IN THIS FILE, WATCHING ONE TIER. The test above pins
  // three HQ pages with the message "without coverage the rail's only button
  // stays disabled" — and D126 is the PR that both fixed those three and
  // mounted the branch rail. It fixed the tier it was auditing and left the
  // tier it was building: `/branch/insights`, `/branch/contracts` and
  // `/branch/community` all passed `<BranchZone>` no `coverage`, so
  // `WorkerRail` rendered "Not recorded" and disabled its only button under
  // "Nothing to read back yet — this page has not loaded a summary".
  //
  // That sentence was FALSE on two of the three: Insights had loaded its
  // stats, a benchmark and a server-written `unavailable` list; Contracts had
  // loaded HQ's library and its push stamp.
  for (const [file, workspace] of [
    ['frontend/src/pages/branch/BranchHome.jsx', 'Home'],
    ['frontend/src/pages/branch/BranchAccounts.jsx', 'Accounts'],
    ['frontend/src/pages/branch/BranchApprovals.jsx', 'Approvals'],
    ['frontend/src/pages/branch/BranchPrograms.jsx', 'Programs'],
    ['frontend/src/pages/branch/BranchContracts.jsx', 'Contracts'],
    ['frontend/src/pages/branch/BranchInsights.jsx', 'Insights'],
    ['frontend/src/pages/branch/BranchAnalytics.jsx', 'Analytics'],
  ]) {
    const src = codeOnlyJsx(read(file));
    assert.ok(src.includes(`workspace="${workspace}"`), `${file}: the frame must name its zone`);
    assert.match(src, /coverage=\{coverage\}/,
      `${file}: without coverage the rail's only button stays disabled`);
    // DERIVED, NOT CONSTANT — and the property is asserted rather than the HQ
    // pages' spelling. The first draft of this required
    // `[…].filter(Boolean)`, which is one zone's idiom: the branch tier builds
    // coverage four legitimate ways (a filtered array, a `ready ? […] : []`
    // ternary, a spread inside one, conditional `push`). Demanding the shape
    // failed three pages whose coverage was already correct — the same
    // spelling-over-property mistake this PR re-aimed five guards for, made by
    // its own new guard, and caught because it was run.
    //
    // What every honest version has in common is that a read which failed
    // contributes NO line, so the construction is gated on something.
    const declared = src.indexOf('const coverage');
    assert.ok(declared > src.indexOf('export default function'),
      `${file}: coverage must be built in the component from its own reads, not a module constant`);
    const region = src.slice(declared, src.indexOf('<BranchZone', declared));
    assert.ok(
      /\.filter\(Boolean\)/.test(region) || /\?\s*\[/.test(region) || /\bif\s*\(/.test(region),
      `${file}: coverage must be gated on the page's reads, so a failed one drops its line`,
    );
    // THE LIMIT OF THIS, STATED RATHER THAN LEFT TO BE DISCOVERED. It reads
    // SOURCE, so it sees text and not evaluation: replacing the whole
    // construction with a constant array is caught, but `['x'] || […]` —
    // which short-circuits past the gating while leaving it in the file —
    // is not. The same class D141 recorded as "a guard that reads the source
    // cannot see a component that stopped drawing". Closing it would need a
    // render, which is a different kind of test from this file's.
  }

  // COMMUNITY IS THE ONE DELIBERATE EXCEPTION, AND IT IS NAMED RATHER THAN
  // QUIETLY OMITTED. It fetches nothing on purpose (D140: four counts here
  // would each be a second read of a console's own list, and a count
  // disagreeing with the console one click away is the tile-vs-table defect
  // D128 ended). So on that page the rail's sentence is TRUE, and giving it
  // fabricated coverage to light the button would reintroduce D128 one layer
  // up. What it owes instead is an explanation, which is asserted here so the
  // exception cannot decay into an oversight.
  const community = codeOnlyJsx(read('frontend/src/pages/branch/BranchCommunity.jsx'));
  assert.ok(!community.includes('coverage={'), 'Community must not fabricate coverage');
  assert.ok(!community.includes('api.'), 'Community fetches nothing, which is why it has no coverage');
  // A FRAGMENT INSIDE ONE STRING LITERAL, not a phrase spanning the
  // concatenation. The first draft matched "holds no figures", which the
  // source splits across a `+` at the line wrap — so it failed on correct copy
  // and would fail again on any reflow. An assertion about prose has to be
  // written against how the source stores it.
  assert.match(community, /figures of its own to read back/,
    'the one zone with no coverage must say why it has none');
});

test('every branch zone can NAME its branch, which is S12 rule 1 (D151)', () => {
  // The scope sentence is derived from `/me.branch`, so the frame needs the
  // user — and a route that forgot to pass one would silently fall back to the
  // unnamed sentence rather than failing. Both ends are asserted, because
  // either alone is a name that never arrives.
  const app = codeOnlyJsx(read('frontend/src/App.jsx'));
  for (const path of [
    '/branch', '/branch/accounts', '/branch/approvals', '/branch/programs',
    '/branch/community', '/branch/contracts', '/branch/insights', '/branch/insights/analytics',
  ]) {
    const at = app.indexOf(`path="${path}"`);
    assert.ok(at > 0, `${path} is no longer a registered route`);
    const next = app.indexOf('<Route', at);
    const element = app.slice(at, next > at ? next : at + 240);
    assert.ok(element.includes('user={user}'), `${path} must pass the user, or the rail cannot name the branch`);
  }
  for (const file of [
    'BranchHome', 'BranchAccounts', 'BranchApprovals', 'BranchPrograms',
    'BranchCommunity', 'BranchContracts', 'BranchInsights', 'BranchAnalytics',
  ]) {
    const src = codeOnlyJsx(read(`frontend/src/pages/branch/${file}.jsx`));
    assert.match(src, /user=\{user\}/, `${file} must forward the user to its frame`);
  }
  // ONE DEFINITION OF THE NAME, not one per page. `BranchAccounts` derived it
  // for the S0 search sentence and the frame would have been the second copy.
  const shell = read('frontend/src/lib/shellRole.js');
  assert.match(shell, /export function branchLabel\(user\)/);
  const offenders = [];
  for (const file of ['BranchAccounts', 'BranchZone']) {
    const src = codeOnlyJsx(read(`frontend/src/pages/branch/${file}.jsx`));
    if (/user\?\.branch\?\.name/.test(src)) offenders.push(file);
  }
  assert.deepEqual(offenders, [],
    'the branch name is derived in lib/shellRole.js once, never re-derived in a page');
});

test('the benchmark the rail cites carries WHEN HQ computed it (D151)', () => {
  // S12 rule 3, verbatim: "It points at the copy it does have — HQ pushes one
  // anonymised median with a timestamp. The rail may cite that, AND SAYS WHEN
  // HQ COMPUTED IT." `branch_benchmarks.pushed_at` shipped with D148 and the
  // worker selects it; the SPA read it zero times. Seventh producer with no
  // reader (#252, D142, D149, D150).
  const page = codeOnlyJsx(read('frontend/src/pages/branch/BranchInsights.jsx'));
  assert.match(page, /b\.pushed_at/, 'the row must draw the stamp it carries');
  assert.match(page, /benchmarks\[0\]\.pushed_at/, 'and the rail line must cite it');
  assert.match(page, /benchmarks\[0\]\.n_branches/,
    'a median with no denominator is not one a branch can read — migration 256\'s k-threshold is why');
  // The worker must still be sending it, or the page reads nothing.
  assert.match(
    read('cloudflare-worker/src/routes/branch_insights.ts'),
    /n_branches, period, pushed_at/,
    'the route must project the stamp the page renders',
  );
  // AND THE SERVER'S OWN ABSENCE LIST REACHES THE RAIL, not just its card.
  assert.match(page, /unavailable=\{\(data\?\.unavailable \|\| \[\]\)\.map/,
    'the rail\'s Unavailable block must read the same list the card does');
  assert.match(
    codeOnlyJsx(read('frontend/src/pages/branch/BranchContracts.jsx')),
    /unavailable=\{\(data\?\.not_carried \|\| \[\]\)\.map/,
    'and Contracts must forward the server\'s not_carried rather than typing a second copy',
  );
});
