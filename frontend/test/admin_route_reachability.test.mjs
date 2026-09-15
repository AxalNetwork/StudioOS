/**
 * Every `/admin/*` route either has a door, or is a recorded decision whose
 * reason this file re-checks.
 *
 * THE CONVERSE OF `super_admin_shell.test.mjs:41-47`, which asserts row → route
 * (`rows.filter(r => !APP.includes(\`path="${r.to}"\`))`) — every advertised door
 * opens onto something. Nothing asserted route → door, and the gap was not
 * theoretical: seven `/admin/*` routes had no way in from the UI, between them
 * ~2,250 lines of working, API-backed admin tooling. `/admin/trash` and
 * `/admin/refer-earn` each appeared EXACTLY ONCE in all of `frontend/src` — the
 * `<Route>` line that registers them.
 *
 * REACHABILITY IS BFS FROM ROOTS, NOT "HAS AN INBOUND LINK", and the publications
 * feature is why. `Publications.jsx` links to `new` and `:id`; both of those link
 * back to the list. All three have inbound links; all three were unreachable —
 * a closed cycle with no edge entering it from any navigation root. The cheap
 * check reports zero orphans on a three-page feature nobody can find.
 *
 * DOORS ARE MATCHED BY SYNTAX, NOT BY PATH SUBSTRING, and that is load-bearing
 * rather than tidy. `frontend/src/lib/api.js` carries ~90 `/admin/*` strings and
 * ZERO navigation — every one an argument to `request(...)`. A bare grep scores
 * `/admin/x` as linked 19 times and `/admin/team` 6 times, all falsely. Note
 * `codeOnly` does NOT save you here: the prose naming `/admin/partners` at
 * `App.jsx:2117` sits in an indented JSX block comment whose continuation lines
 * carry no leading asterisk, so it survives the strip. Only the syntax anchor
 * rejects it, which is what 'the door scanner reads navigation syntax…' pins.
 *
 * `SIDEBAR_GROUPS` IS IMPORTED, NOT PARSED. `super_admin_shell.test.mjs:25` does
 * the same and ships (the "cannot be imported, lucide-react" note on
 * `parseSidebar` in `scripts/build-profile-routing.mjs:97` is true of plain-node
 * scripts, not of tests, which run under `_deck-loader.mjs`). Importing makes the
 * ONE commented-out row — `// { to: '/admin/x', … }` at `sidebarConfig.js:148` —
 * structurally invisible instead of regex-filtered, so a deliberately-dark door
 * can never read as live. It also keeps `match:` a separate field the door
 * extractor never touches; `match` decides highlighting, not navigation
 * (`sidebarConfig.js:273-276`).
 *
 * Scope is `/admin/*` deliberately. 132 of 375 static routes carry no literal
 * link, but nearly all are legitimately unlinked — `/lp/*` campaign pages,
 * emailed `/account/email/confirm` links, wizard steps reached programmatically,
 * and every zone route the rail computes through `zonePath()` rather than a
 * literal. A guard at that scope needs a ~100-entry allowlist, which documents
 * nothing. The admin sidebar is meant to be complete, so here the assertion bites.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APP = read('frontend/src/App.jsx');

/* ------------------------------------------------------------------ *
 * The route table
 * ------------------------------------------------------------------ */

/**
 * Every `<Route>` as `{ path, body, component, redirect }`.
 *
 * Scans the WHOLE file. `/admin/advisor-cohorts` lives at App.jsx:2323, far
 * below the 1949-2009 block where the other 32 sit, so a block-bounded parser
 * silently loses it — which is why the completeness test below counts.
 * Segment-splitting shape lifted from `route_role_zone_contract.test.mjs:67`.
 */
function routes(src) {
  const out = [];
  for (const seg of src.split('<Route').slice(1)) {
    const p = /^\s*path="([^"]+)"/.exec(seg);
    if (!p) continue;
    const next = seg.indexOf('\n      <Route');
    const body = next >= 0 ? seg.slice(0, next) : seg;
    // The first PascalCase element is the page; `<Navigate>` means this route is
    // a redirect rather than a surface.
    const els = [...body.matchAll(/<([A-Z]\w+)/g)].map((m) => m[1]);
    out.push({
      path: p[1],
      body,
      redirect: els[0] === 'Navigate',
      component: els.find((e) => e !== 'Navigate') ?? null,
    });
  }
  return out;
}

const ALL = routes(APP);
const ADMIN = ALL.filter((r) => r.path === '/admin' || r.path.startsWith('/admin/'));
const BY_PATH = new Map(ALL.map((r) => [r.path, r]));

/**
 * component name → source file, from App.jsx's lazy-import table.
 *
 * EXTENSIONS ARE RESOLVED HERE, not at read time. The import specifiers carry
 * none (`import('./pages/AdminPage')`), and leaving them bare made the
 * `SECOND_MOUNTS` key below — written with `.jsx`, as a person naturally would —
 * miss every lookup, silently emptying the second-mount edge set and reporting
 * `/admin/spinout-lab/preview` as an orphan when it is reachable. A path that is
 * a key in one place and a display string in another has to be one spelling.
 */
const resolveFile = (rel) => {
  for (const ext of ['', '.jsx', '.js']) {
    if (existsSync(resolve(root, `${rel}${ext}`))) return `${rel}${ext}`;
  }
  return null;
};

const FILE_OF = new Map();
for (const m of APP.matchAll(/const (\w+) = lazy\(\(\) => import\('\.\/([^']+)'\)\)/g)) {
  const f = resolveFile(`frontend/src/${m[2]}`);
  if (f) FILE_OF.set(m[1], f);
}
for (const m of APP.matchAll(/^import (\w+) from '\.\/([^']+)'/gm)) {
  if (FILE_OF.has(m[1])) continue;
  const f = resolveFile(`frontend/src/${m[2]}`);
  if (f) FILE_OF.set(m[1], f);
}

const srcOf = (file) => (existsSync(resolve(root, file)) ? readFileSync(resolve(root, file), 'utf8') : null);

/* ------------------------------------------------------------------ *
 * The door scanner
 * ------------------------------------------------------------------ */

/**
 * Navigation targets in one source file.
 *
 * Every pattern is a LITERAL regex — nothing is interpolated, so there is no
 * `detect-non-literal-regexp` surface here at all. A `<Navigate>`'s `to=` is
 * syntactically identical to a `<Link>`'s, so redirects are stripped first and
 * returned separately: a redirect is not a door a person can walk through.
 */
function doorsIn(src) {
  const code = codeOnly(src);
  const redirects = [];
  for (const m of code.matchAll(/<Navigate\b[^>]*?to="(\/[^"]*)"/g)) redirects.push(m[1]);
  const withoutNavigate = code.replace(/<Navigate\b[^>]*>/g, '');

  const doors = new Set();
  const LITERALS = [
    /\bto="(\/[^"]*)"/g,
    /\bhref="(\/[^"]*)"/g,
    /\bto=\{`(\/[^`${]*)/g,
    /\bhref=\{`(\/[^`${]*)/g,
    /\b(?:navigate|nav)\(\s*'(\/[^']*)'/g,
    /\b(?:navigate|nav)\(\s*"(\/[^"]*)"/g,
    /\b(?:navigate|nav)\(\s*`(\/[^`${]*)/g,
  ];
  for (const re of LITERALS) for (const m of withoutNavigate.matchAll(re)) doors.add(m[1]);

  // Computed-base links. `AdminDueDiligencePage.jsx:34` builds
  //   const base = pathname.startsWith('/admin') ? '/admin/due-diligence' : '/due-diligence';
  // and links `${base}/${c.uid}`, so the literal never appears anywhere. Resolve
  // by substitution rather than by pattern: plain indexOf and slicing, no regex
  // built from a read value.
  for (const m of withoutNavigate.matchAll(/\b(?:to|href)=\{`\$\{(\w+)\}([^`]*)/g)) {
    const [, ident, rest] = m;
    const tail = rest.split('${')[0];
    for (const bind of withoutNavigate.matchAll(/\bconst (\w+) = ([^;\n]*)/g)) {
      if (bind[1] !== ident) continue;
      // ONLY THE TERNARY'S RESULTS ARE CANDIDATE BASES. The condition holds a path
      // literal too — `pathname.startsWith('/admin') ? … : …` — and reading it as a
      // base produced a door at `/admin/`, which then failed the dangling-link test
      // as a link nobody wrote. A literal before the `?` is a test, not a value.
      const value = bind[2].includes('?') ? bind[2].slice(bind[2].indexOf('?')) : bind[2];
      for (const lit of value.matchAll(/'(\/[^']*)'/g)) doors.add(`${lit[1]}${tail}`);
    }
  }
  return { doors: [...doors], redirects };
}

/**
 * A door's target → the route it opens. Query and hash are dropped: `?tab=` picks
 * a panel inside a page, it does not address a different route.
 */
function toRoute(target) {
  const clean = target.split('?')[0].split('#')[0];
  if (BY_PATH.has(clean)) return clean;                        // static wins
  const want = clean.replace(/\/$/, '').split('/');
  // A trailing slash is a template head — `/articles/edit/${id}` scanned up to the
  // first `${` — so exactly ONE more segment follows, and the arity is strict.
  // Allowing `want.length` as well made a 4-segment link also match the 3-segment
  // `/articles/:slug`, whose `:slug` then absorbed the literal `edit`, and the two
  // together read as an ambiguity that is not one.
  const expected = clean.endsWith('/') ? want.length + 1 : want.length;
  const candidates = [];
  for (const r of ALL) {
    const have = r.path.split('/');
    if (have.length !== expected) continue;
    let ok = true; let params = 0;
    for (let i = 0; i < have.length; i += 1) {
      if (have[i].startsWith(':')) { params += 1; continue; }
      if (have[i] !== want[i]) { ok = false; break; }
    }
    if (ok && params > 0) candidates.push(r.path);
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return { ambiguous: clean, candidates };
  return null;
}

/* ------------------------------------------------------------------ *
 * Roots, second mounts, and the closure
 * ------------------------------------------------------------------ */

/** Every live sidebar row across every shell. Commented rows cannot appear. */
const SIDEBAR_ROWS = Object.entries(SIDEBAR_GROUPS).flatMap(([role, groups]) =>
  groups.flatMap((g) => (g.items || []).map((it) => ({ role, group: g.label, to: it.to }))));

/**
 * App.jsx outside `<Routes>` — the user dropdown, the portal switcher, anything
 * mounted on every page. These are doors no route owns.
 */
const CHROME = (() => {
  const open = APP.indexOf('<Routes>');
  const close = APP.indexOf('</Routes>');
  return open >= 0 && close > open ? APP.slice(0, open) + APP.slice(close) : APP;
})();

/**
 * A component rendered by ANOTHER routed component, which is itself a route
 * element elsewhere. Three files do it, and it is how
 * `/admin/spinout-lab/preview` is genuinely reachable: the preview button lives
 * inside `AdminSpinoutLab.jsx`'s `body`, and `:825` is `if (!standalone) return
 * body;`, so it renders in the `/admin?tab=lab-applications` framing too — and
 * `/admin` has a real row. Attributing doors to FILES and files to ALL their
 * mount points is what gets that right; a path-only model calls it an orphan.
 *
 * The table is hand-written and machine-checked against the tree below, which is
 * the only reason to trust it: the first draft declared two of these four, and the
 * parity test named the two it had missed rather than letting the closure quietly
 * run short.
 */
const SECOND_MOUNTS = new Map([
  // The Admin Console's own tabs. These two are also the `same-component-elsewhere`
  // exemptions, so one table feeds both and they cannot disagree.
  ['frontend/src/pages/AdminPage.jsx', ['AdminNetworkProfiles', 'AdminSpinoutLab']],
  // HQ's Accounts page frames the whole Admin Console with a `section=` prop, so
  // /admin/accounts is a second mount of every door AdminPage carries.
  ['frontend/src/pages/hq/AccountsPage.jsx', ['AdminPage']],
  // The founder-journey walkthrough renders the real apply page on simulated data
  // (its own comment at AdminSpinoutLab.jsx:743-745 describes the read-only tour).
  ['frontend/src/pages/admin/AdminSpinoutJourneyPreview.jsx', ['SpinoutLabApplyPage']],
]);

/** path → the files whose doors that path can reach. */
function filesFor(path) {
  const r = BY_PATH.get(path);
  if (!r?.component) return [];
  const own = FILE_OF.get(r.component);
  if (!own) return [];
  const extra = (SECOND_MOUNTS.get(own) || []).map((c) => FILE_OF.get(c)).filter(Boolean);
  return [own, ...extra];
}

const AMBIGUOUS = [];
const DANGLING = [];

/** BFS. A link only counts once the page holding it is itself reachable. */
function reachable() {
  const seen = new Set();
  const queue = [];
  const admit = (target, from) => {
    const hit = toRoute(target);
    // Both registers are scoped to /admin: this file's remit is the admin console,
    // and failing it over an ambiguity in the articles routes would make it red for
    // a reason it has no opinion about.
    if (hit && typeof hit === 'object') {
      if (target.startsWith('/admin')) AMBIGUOUS.push({ ...hit, from });
      return;
    }
    if (!hit) {
      if (target.startsWith('/admin')) DANGLING.push({ target, from });
      return;
    }
    if (!seen.has(hit)) { seen.add(hit); queue.push(hit); }
  };

  for (const row of SIDEBAR_ROWS) admit(row.to, `sidebar:${row.role}`);
  for (const d of doorsIn(CHROME).doors) admit(d, 'App.jsx chrome');

  while (queue.length) {
    const path = queue.shift();
    for (const file of filesFor(path)) {
      const src = srcOf(file);
      if (!src) continue;
      for (const d of doorsIn(src).doors) admit(d, file);
    }
  }
  return seen;
}

const REACHED = reachable();

/* ------------------------------------------------------------------ *
 * EXEMPT — "no door, and that is correct". Every entry is proved below.
 * ------------------------------------------------------------------ */

const EXEMPT = [
  {
    path: '/admin/x',
    kind: 'parked-row',
    why: 'the row exists but is commented out — the X broadcaster is parked until '
       + 'X_CLIENT_ID/SECRET are bound on the prod worker (sidebarConfig.js:146-148).',
  },
  {
    path: '/admin/network-profiles',
    kind: 'same-component-elsewhere',
    host: '/admin',
    tab: 'network-profiles',
    why: 'AdminPage.jsx:14 records that this standalone route stays wired for direct '
       + 'deep links; the roster itself is reached at /admin?tab=network-profiles.',
  },
  {
    path: '/admin/spinout-lab',
    kind: 'same-component-elsewhere',
    host: '/admin',
    tab: 'lab-applications',
    why: 'the Lab console is a tab of the Admin Console; the standalone mount exists '
       + 'for deep links (AdminSpinoutLab.jsx:5).',
  },
];

/**
 * NO DEBT LIST. An earlier draft carried a shrink-only `KNOWN_ORPHANS` ratchet,
 * and it is deliberately not here: every orphan this guard found turned out to be
 * a functional, API-backed page, so each got a door instead of an entry. An entry
 * would have recorded a bug as a decision. If this ever needs one, the honest
 * shape is a second list with its own anti-rot test — not a string in EXEMPT,
 * whose whole point is "this is correct".
 */
const EXEMPT_PATHS = new Set(EXEMPT.map((e) => e.path));
const REDIRECTS = ADMIN.filter((r) => r.redirect).map((r) => r.path);

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

test('the route parser finds every /admin route in App.jsx', () => {
  // A route this parser misses is a route the guard silently has no opinion
  // about — the exact failure mode of a block-bounded scan, which would lose
  // /admin/advisor-cohorts at App.jsx:2323.
  const paths = ADMIN.map((r) => r.path);
  assert.ok(paths.includes('/admin/advisor-cohorts'),
    'the scan no longer reaches App.jsx:2323 — it has been narrowed to a block');
  assert.ok(ADMIN.length >= 33, `expected at least 33 /admin routes, parsed ${ADMIN.length}`);
  const nameless = ADMIN.filter((r) => !r.component && !r.redirect).map((r) => r.path);
  assert.deepEqual(nameless, [], 'these routes yielded no component, so their doors cannot be read');
  const unmapped = ADMIN.filter((r) => r.component && !FILE_OF.get(r.component))
    .map((r) => `${r.path} → ${r.component}`);
  assert.deepEqual(unmapped, [], 'these components are not in App.jsx\'s import table');
});

test('every /admin route is reachable from navigation', () => {
  const orphans = ADMIN
    .filter((r) => !r.redirect)
    .filter((r) => !EXEMPT_PATHS.has(r.path))
    .filter((r) => !REACHED.has(r.path))
    .map((r) => r.path);
  assert.deepEqual(orphans, [],
    'these /admin routes render a real page that nothing in the UI links to, so the only\n'
    + 'way in is to type the URL. Give each a sidebar row in frontend/src/sidebarConfig.js,\n'
    + 'or — if having no door is correct — add an EXEMPT entry whose kind has a prover:\n  '
    + orphans.join('\n  '));
});

test('every in-page /admin link points at a registered route', () => {
  // The row → route rule from super_admin_shell.test.mjs, extended from sidebar
  // rows to every link inside a page. A typo'd target is a door onto a 404.
  assert.deepEqual(DANGLING, [], 'these links name an /admin route that does not exist');
  assert.deepEqual(AMBIGUOUS, [], 'these links match two dynamic routes; the guard will not guess');
});

test('a redirect-only /admin route is excluded, and its target is reachable', () => {
  // Derived, not hardcoded: a route whose element is <Navigate> is not a surface.
  // But a redirect INTO an orphan is still a dead end, so the target is checked.
  assert.deepEqual(REDIRECTS, ['/admin/news'],
    'the set of /admin redirect routes changed; confirm each is still a redirect and not a page');
  for (const path of REDIRECTS) {
    const { redirects } = doorsIn(BY_PATH.get(path).body);
    assert.equal(redirects.length, 1, `${path} should name exactly one redirect target`);
    const target = toRoute(redirects[0]);
    assert.ok(typeof target === 'string', `${path} redirects to ${redirects[0]}, which is not a route`);
    // A redirect may land on a reachable route, or on one exempt because the same
    // component is live elsewhere — both put a working page in front of the user.
    // It may NOT land on a `parked-row` exemption: that page is parked behind a
    // notice, so redirecting into it is the dead end this test exists to catch. An
    // earlier draft allowed any exempt target and a mutation pointing /admin/news
    // at the parked /admin/x escaped.
    const viaLiveTwin = EXEMPT.some((e) => e.path === target && e.kind === 'same-component-elsewhere');
    assert.ok(REACHED.has(target) || viaLiveTwin,
      `${path} redirects to ${target}, which is itself unreachable — a redirect into a dead end`);
  }
});

test('no exemption covers a route that already has a door', () => {
  // The anti-rot half. Fixing an exemption's cause without removing the entry
  // leaves a claim that is no longer true, and nothing else would notice.
  const stale = EXEMPT.filter((e) => REACHED.has(e.path)).map((e) => e.path);
  assert.deepEqual(stale, [],
    'these routes are now reachable, so their EXEMPT entry is stale — delete it');
  for (const e of EXEMPT) {
    assert.ok(BY_PATH.has(e.path), `${e.path} is exempted but is not a registered route`);
    assert.ok(e.why && e.why.length > 40, `${e.path}'s exemption does not state a reason`);
  }
});

test('a parked sidebar row still names a row that is present but commented out', () => {
  const raw = read('frontend/src/sidebarConfig.js');
  for (const e of EXEMPT.filter((x) => x.kind === 'parked-row')) {
    // Present-but-commented is the whole substance of the claim, and it needs the
    // RAW text: the import cannot see a commented row, which is exactly why the
    // import is what the live-row set comes from.
    const commented = raw.split('\n').filter((l) => /^\s*\/\/\s*\{\s*to: '/.test(l)
      && l.includes(`'${e.path}'`));
    assert.equal(commented.length, 1,
      `${e.path} is exempted as a parked row, but no commented-out row for it remains in `
      + 'sidebarConfig.js — either restore the row, or retire the route');
    assert.ok(!SIDEBAR_ROWS.some((r) => r.to === e.path),
      `${e.path} now has a LIVE row, so it is not parked — remove the EXEMPT entry`);
  }
});

test('a route exempted as a tab still mounts the same component behind that tab', () => {
  const adminPage = read('frontend/src/pages/AdminPage.jsx');
  for (const e of EXEMPT.filter((x) => x.kind === 'same-component-elsewhere')) {
    const component = BY_PATH.get(e.path)?.component;
    assert.ok(component, `${e.path} has no component to compare`);
    // 1. the tab is offered in the section list a person picks from
    assert.ok(adminPage.includes(`value: '${e.tab}'`),
      `${e.path} is exempted because /admin?tab=${e.tab} reaches it, but ADMIN_SECTIONS no `
      + 'longer offers that section');
    // 2. and the tab mounts THAT component, not merely something
    assert.ok(adminPage.includes(component),
      `/admin?tab=${e.tab} no longer mounts ${component}, so ${e.path} is the only way in`);
    // 3. the chain has to end on a real door
    assert.ok(REACHED.has(e.host),
      `${e.path} is exempted via ${e.host}, which is itself unreachable`);
  }
});

test('the ?tab= deep link is honoured and validated', () => {
  // Without this the exemptions above rest on a URL nothing reads.
  const adminPage = read('frontend/src/pages/AdminPage.jsx');
  // NOT AN ALTERNATION. The first draft read
  //   /get\('tab'\)|searchParams|URLSearchParams/
  // and a mutation that broke the actual `tab` read escaped, because the two
  // generic alternatives still matched. An OR across a specific claim and its
  // vaguer neighbours is satisfied by the neighbours, so it pins neither.
  assert.match(adminPage, /get\('tab'\)/,
    'AdminPage no longer reads the `tab` search param, so the deep links the exemptions cite are dead');
  assert.match(adminPage, /ADMIN_SECTION/,
    'AdminPage no longer validates the tab against its section list');
});

test('the door scanner reads navigation syntax, not paths in prose or api calls', () => {
  // THE MODEL'S LOAD-BEARING ASSUMPTION. api.js holds ~90 /admin/* strings and no
  // navigation; a substring grep would score /admin/x as linked 19 times.
  const api = doorsIn(read('frontend/src/lib/api.js')).doors.filter((d) => d.startsWith('/admin'));
  assert.deepEqual(api, [], 'api.js yielded navigation targets; the scanner is matching request() arguments');

  // And prose. codeOnly does NOT strip App.jsx:2117 — it is an indented {/* … */}
  // whose continuation lines carry no leading `*` — so this proves the SYNTAX
  // anchor rejects it, not the comment stripper.
  assert.ok(codeOnly(APP).includes('/admin/partners'),
    'App.jsx:2117 prose no longer survives codeOnly; this assertion now proves nothing — '
    + 'find another comment that mentions a route and pin that instead');
  assert.ok(!doorsIn(CHROME).doors.includes('/admin/partners'),
    'the scanner read a path out of prose');

  // The commented row is invisible to the live set but present in the text.
  const raw = read('frontend/src/sidebarConfig.js');
  assert.ok(raw.includes("/admin/x"), 'the parked row vanished from sidebarConfig.js');
  assert.ok(!SIDEBAR_ROWS.some((r) => r.to === '/admin/x'),
    'the imported rows include /admin/x, so a commented row is being read as live');
});

test('the computed-base resolver still sees the due-diligence case links', () => {
  // `const base = … ? '/admin/due-diligence' : '/due-diligence'` then `${base}/${c.uid}`.
  // If this regresses, /admin/due-diligence/:uid stops looking reachable from that
  // page — it stays reachable via AdminPage's raw anchor, so only this test would
  // notice, which is the point of pinning the mechanism separately.
  const dd = doorsIn(read('frontend/src/pages/AdminDueDiligencePage.jsx')).doors;
  assert.ok(dd.includes('/admin/due-diligence/'),
    'the computed base no longer resolves; template links through a const are unread');
});

test('a component mounted at a second path is declared once', () => {
  // SECOND_MOUNTS feeds both the reachability closure and the tab exemptions, so
  // the two can never disagree. A third such mount must be declared, not guessed.
  const routed = new Set(ALL.map((r) => r.component).filter(Boolean));
  const found = [];
  for (const r of ADMIN) {
    const file = r.component && FILE_OF.get(r.component);
    const src = file && srcOf(file);
    if (!src) continue;
    for (const m of src.matchAll(/^import (\w+) from /gm)) {
      if (routed.has(m[1]) && m[1] !== r.component) found.push(`${file} → ${m[1]}`);
    }
  }
  const declared = [...SECOND_MOUNTS].flatMap(([f, cs]) => cs.map((c) => `${f} → ${c}`));
  assert.deepEqual(found.sort(), declared.sort(),
    'a routed /admin component is imported by another routed component and not declared in '
    + 'SECOND_MOUNTS (or vice versa); the closure and the tab exemptions read this table');
});

test('the Spin-Out Lab preview button renders in both framings', () => {
  // The one place file-level attribution over-approximates: the scanner sees the
  // door in the file and cannot see a conditional around it. If the button moved
  // inside `{standalone && …}` it would only exist on a route that has no row,
  // and nothing else here would notice.
  const src = read('frontend/src/pages/admin/AdminSpinoutLab.jsx');
  assert.match(src, /if \(!standalone\) return body;/,
    'AdminSpinoutLab no longer returns `body` in the embedded framing');
  const bodyAt = src.indexOf('const body = (');
  const buttonAt = src.indexOf("navigate('/admin/spinout-lab/preview')");
  const returnAt = src.indexOf('if (!standalone) return body;');
  assert.ok(bodyAt >= 0 && buttonAt > bodyAt && buttonAt < returnAt,
    'the preview button is no longer inside `body`, so it does not render in the '
    + '/admin?tab=lab-applications framing and /admin/spinout-lab/preview loses its door');
});
