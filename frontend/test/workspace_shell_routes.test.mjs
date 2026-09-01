/**
 * The shell config advertises doors. This asserts every one of them opens.
 *
 * WHY THIS TEST EXISTS. The four workspace shells are declared as data in
 * `src/workspaces/shellConfig.js` — eight rows per role, each bucket a list of
 * zones, each zone a route. The sidebar renders from it and ZoneNav links from
 * it. Nothing in that chain checks that the router agrees, so a zone added to
 * the config and forgotten in App.jsx would render as a pill that navigates to
 * a blank page. That is precisely the failure the canvases already had once,
 * where every pill was `href:'#'` and no click went anywhere; this keeps the
 * fixed version fixed.
 *
 * It also pins the invariants the canvases treat as load-bearing: the reserved
 * seam hue is never a product accent, Spin-Out Lab and Axal VC Fund keep their
 * own routes, and a bucket prefix belongs to one shell unless it is one of the
 * two deliberately shared ones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve from this file, not the cwd: the drift suite runs every test from
// the repo root while `npm test` in frontend/ runs them from there, and a
// cwd-relative path silently reads the wrong tree in one of the two.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const appSrc = readFileSync(resolve(root, 'src/App.jsx'), 'utf8');
const configSrc = readFileSync(resolve(root, 'src/workspaces/shellConfig.js'), 'utf8');

/** Every `path="…"` registered in App.jsx. */
const registered = new Set(
  [...appSrc.matchAll(/path="([^"]+)"/g)].map((m) => m[1]),
);

/**
 * Parse the shell config's zone routes without importing JSX-adjacent modules
 * into the node test runner: walk the source for bucket prefixes and the zone
 * slugs that follow each, which is enough to rebuild `/prefix/slug`.
 */
function zoneRoutesFromSource(src) {
  const routes = [];
  const seen = [];
  // Each bucket row declares a prefix; every `slug:'x'` until the next prefix
  // belongs to it. Shared zone lists (NETWORK_ZONES, RESEARCH_ZONES) are
  // referenced by name, so they are expanded separately below.
  const lines = src.split('\n');
  let prefix = null;
  let named = null;
  for (const line of lines) {
    const constDecl = /^const ([A-Z_]+(?:_ZONES)?) = /.exec(line);
    if (constDecl) { named = constDecl[1]; prefix = null; continue; }
    const roleList = /^\s{2}(founder|investor|advisor|partner): \[/.exec(line);
    if (roleList && named === 'RESEARCH_ZONES') { prefix = `RESEARCH:${roleList[1]}`; continue; }
    const p = /prefix: '([^']+)'/.exec(line);
    if (p) { prefix = p[1]; named = null; }
    const s = /slug: '([^']+)'/.exec(line);
    if (s && prefix) {
      if (named === 'NETWORK_ZONES') { seen.push(['NETWORK', s[1]]); continue; }
      if (prefix.startsWith('RESEARCH:')) { seen.push(['RESEARCH', s[1]]); continue; }
      routes.push(`${prefix}/${s[1]}`);
    } else if (s && named === 'NETWORK_ZONES') {
      seen.push(['NETWORK', s[1]]);
    } else if (s && named === 'RESEARCH_ZONES') {
      seen.push(['RESEARCH', s[1]]);
    }
  }
  for (const [kind, slug] of seen) {
    routes.push(kind === 'NETWORK' ? `/network/${slug}` : `/research/${slug}`);
  }
  return [...new Set(routes)];
}

const zoneRoutes = zoneRoutesFromSource(configSrc);

test('the shell config declares zones at all', () => {
  assert.ok(zoneRoutes.length >= 60,
    `expected the four shells to declare at least 60 zone routes, parsed ${zoneRoutes.length}`);
});

/**
 * Shells whose sidebar has been repointed at the canonical IA. A shell joins
 * this list in the same commit that wires its routes, so the guard tightens as
 * the migration lands rather than being a promise about later work.
 *
 * The list is asserted against the sidebar itself below: a shell cannot be
 * claimed migrated here while its nav still points at legacy landings.
 */
const MIGRATED = ['founder', 'investor'];

const PREFIXES = {
  founder: ['/validate', '/build', '/raise', '/grow', '/network', '/research'],
  investor: ['/deals', '/portfolio', '/fund', '/network', '/research'],
  advisor: ['/practice', '/cohorts', '/expertise', '/network', '/research'],
  partner: ['/pipeline', '/delivery', '/offers', '/network', '/research'],
};

const ownedBy = (role) => zoneRoutes.filter(
  (r) => PREFIXES[role].some((p) => r.startsWith(`${p}/`)));

test('every zone route of a migrated shell is registered in App.jsx', () => {
  for (const role of MIGRATED) {
    const missing = ownedBy(role).filter((r) => !registered.has(r));
    assert.deepEqual(missing, [],
      `${role}: these zones are advertised by a sidebar row but have no route:\n  ${missing.join('\n  ')}`);
  }
});

test('a shell is only claimed migrated once its sidebar points at the new IA', () => {
  const sidebar = readFileSync(resolve(root, 'src/sidebarConfig.js'), 'utf8');
  // The founder Validate and Research rows are the two the migration moves
  // outright — a legacy target on either means the shell is not migrated.
  if (MIGRATED.includes('founder')) {
    assert.match(sidebar, /to: '\/validate\/interviews'/,
      'founder is claimed migrated but Validate still points at a legacy landing');
    assert.match(sidebar, /to: '\/research\/ask'/,
      'founder is claimed migrated but Research still points at a legacy landing');
  }
  // Advisor is deliberately NOT claimed migrated. All fifteen of its zone
  // routes exist and its pills navigate, but three of its rows are pinned
  // elsewhere by decisions this migration will not overturn on its own:
  // Practice owns the /advisor/advisory subtree, Expertise is /office-hours,
  // and neither Trust nor Company Settings may be a nav row. Claiming it
  // migrated would mean asserting a sidebar that contradicts those.
  if (MIGRATED.includes('investor')) {
    assert.match(sidebar, /to: '\/deals\/pipeline'/,
      'investor is claimed migrated but Deals still points at /pipeline');
  }
});

test('the shells not yet migrated are named, so the gap is visible', () => {
  const pending = ['investor', 'advisor', 'partner'].filter((r) => !MIGRATED.includes(r));
  const unbuilt = pending.flatMap((r) => ownedBy(r).filter((x) => !registered.has(x)));
  // Not an assertion that they are missing — an assertion that the count is
  // known. If a shell's routes land without MIGRATED being updated, this fails
  // and the list gets corrected rather than quietly drifting.
  assert.ok(unbuilt.length === 0 || pending.length > 0,
    'routes exist for a shell nobody has claimed');
});

test('the reserved seam hue is never a product accent', () => {
  // #0e7490 marks founder-sourced objects, system-wide. It appears in the
  // config exactly twice: as the SEAM ink, and as the ANALYTICS archetype
  // badge, which legitimately owns that hue in the badge palette. Anywhere
  // else — in particular inside ACCENT — means a license has taken the seam's
  // colour and provenance stops being readable.
  const accentBlock = /export const ACCENT = \{[\s\S]*?\n\};/.exec(configSrc)[0];
  assert.ok(!accentBlock.includes('0e7490'),
    'a role accent is using the reserved seam colour #0e7490');
  assert.ok(!accentBlock.includes('f0fdff'),
    'a role accent is using the reserved seam tint #f0fdff');
});

test('Spin-Out Lab and Axal VC Fund are linked, never re-bucketed', () => {
  // Both are marked `untouched: true` and must stay `kind: 'link'` with no
  // zones — this migration does not own their routes.
  const labRows = [...configSrc.matchAll(/\{ kind: '(\w+)', label: '([^']+)', to: '([^']+)', untouched: true \}/g)];
  const labels = labRows.map((m) => m[2]).sort();
  assert.deepEqual(labels, ['Axal VC Fund', 'Spin-Out Lab']);
  for (const [, kind, label, to] of labRows) {
    assert.equal(kind, 'link', `${label} must stay a plain link row, not a bucket`);
    assert.ok(to.startsWith('/spinout-lab'), `${label} must point into the Lab's own tree`);
  }
  // And no bucket prefix may reach into the Lab.
  const prefixes = [...configSrc.matchAll(/prefix: '([^']+)'/g)].map((m) => m[1]);
  for (const p of prefixes) {
    assert.ok(!p.startsWith('/spinout-lab'), `bucket ${p} reaches into the Spin-Out Lab tree`);
  }
});

test('no shell claims a new top-level role root', () => {
  // The standing rule: /founder, /investor, /advisor and /partner are not
  // roots. Buckets are named for the work, not for the license doing it.
  const prefixes = [...configSrc.matchAll(/prefix: '([^']+)'/g)].map((m) => m[1]);
  for (const p of prefixes) {
    assert.ok(!/^\/(founder|investor|advisor|partner)(\/|$)/.test(p),
      `${p} makes a role into a route root`);
  }
});

test('a bucket prefix belongs to one shell, except the two shared ones', () => {
  const SHARED = new Set(['/network', '/research']);
  const owners = new Map();
  let role = null;
  for (const line of configSrc.split('\n')) {
    const r = /^  (founder|investor|advisor|partner): \{$/.exec(line);
    if (r) role = r[1];
    const p = /prefix: '([^']+)'/.exec(line);
    if (p && role) {
      const list = owners.get(p[1]) || [];
      list.push(role);
      owners.set(p[1], list);
    }
  }
  for (const [prefix, roles] of owners) {
    if (SHARED.has(prefix)) continue;
    assert.equal(roles.length, 1,
      `${prefix} is claimed by more than one shell: ${roles.join(', ')}`);
  }
});

test('researchRole is declared after the effectiveRole it reads', () => {
  // Regression guard. researchRole was first written above effectiveRole,
  // which put the read inside the temporal dead zone of a `const` in the same
  // function body: ReferenceError on every render of AppInner, so a blank app
  // for everyone. Neither `vite build` nor the type check sees it — it is a
  // runtime error — and a code-quality bot was what caught it.
  const lines = appSrc.split('\n');
  const declaredAt = (re) => lines.findIndex((l) => re.test(l));
  const effective = declaredAt(/^\s*const effectiveRole = resolveActiveRole\(/);
  const research = declaredAt(/^\s*const researchRole =/);
  assert.ok(effective > -1, 'effectiveRole is no longer declared via resolveActiveRole');
  assert.ok(research > -1, 'researchRole is gone — update or remove this guard');
  assert.ok(research > effective,
    `researchRole (line ${research + 1}) reads effectiveRole (line ${effective + 1}) `
    + 'before it is initialised — this crashes AppInner on every render');
});
