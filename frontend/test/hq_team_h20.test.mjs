/**
 * D221 / H20 — HQ · Team: the people desk, and the line between what only HQ
 * may do and what every admin may.
 *
 * WHAT H20 DRAWS AND WHAT IS TRUE. The artboard names five HQ-only powers and
 * four admin powers, each with a one-line note. The NAMES are held to the
 * canvas here, verbatim and in order, read out of the artboard's own data
 * model so a renamed row fails. The NOTES are held to the opposite rule: six of
 * them describe a platform that does not exist (a banner the impersonated
 * person sees, a notification on transfer, Admit to Lab landing on Programs, a
 * seat check on a grant, a decision taken on Approvals, and "live on Admin ·
 * Accounts"), and the cards say instead what the route that performs each act
 * actually requires. So the test asserts the canvas still SAYS each false thing
 * — this is a guard against repeating the canvas, not a quote of it — and that
 * the rendered cards do not.
 *
 * RENDERED, NOT MATCHED. `HqTeamActions` is pure over one prop, so both of its
 * states are rendered with renderToStaticMarkup; the account drawer's footer is
 * rendered too, with and without each handler. The Users table itself loads in
 * an effect, which static rendering never runs, so its row rule is held two
 * ways: the rule's own function is exercised case by case, and the row is read
 * as source to prove both controls sit inside the one guard.
 *
 * Pinned elsewhere and not repeated here: the worker half — Extend re-running
 * D133, the transfer's reason and its two audit rows — in
 * cloudflare-worker/test/hq_team_actions_d221.test.ts; the page's older H9
 * facts in hq_team_h9.test.mjs; the rail's row and coverage shapes in
 * hq_home.test.mjs and branch_rail_mount.test.mjs.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_team_h20.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import HqTeamActions, { HQ_ONLY_ACTIONS, ADMIN_ACTIONS } from '../src/pages/hq/HqTeamActions.jsx';
import { drawsAccountControls } from '../src/lib/accountControls.js';
import { UserDetailModal } from '../src/pages/AdminPage.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const CANVAS = raw('design/canvases/integrated/Admin · Super.dc.html');
const PAGE = codeOnly(raw('frontend/src/pages/hq/AccountsPage.jsx'));
const TABLE = codeOnly(raw('frontend/src/pages/hq/HqTeamTable.jsx'));
const ACTIONS = codeOnly(raw('frontend/src/pages/hq/HqTeamActions.jsx'));
const CONTROLS = codeOnly(raw('frontend/src/lib/accountControls.js'));
const ADMIN = codeOnly(raw('frontend/src/pages/AdminPage.jsx'));
const HOLDERS = codeOnly(raw('frontend/src/pages/hq/SuperAdminHolders.jsx'));
const WORKER_HOLDERS = codeOnly(raw('cloudflare-worker/src/routes/admin_super_admins.ts'));
const API = codeOnly(raw('frontend/src/lib/api.js'));
const APP = codeOnly(raw('frontend/src/App.jsx'));

const render = (C, props) => renderToStaticMarkup(
  React.createElement(MemoryRouter, null, React.createElement(C, props)),
);
/** The five entities renderToStaticMarkup writes into text, each to its character. */
const ENTITY = { '&#x27;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>' };
/** Visible text, tags stripped, each entity decoded exactly once (one pass). */
const text = (html) => html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(?:#x27|quot|amp|lt|gt);/g, (entity) => ENTITY[entity])
  .replace(/\s+/g, ' ');
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&'));
const count = (hay, needle) => hay.split(needle).length - 1;

/** H20, bounded at both ends so the slice cannot run into H21. */
function h20() {
  const a = CANVAS.indexOf('<section class="ab" id="h20">');
  assert.ok(a >= 0, 'the H20 artboard could not be found in the canvas');
  const b = CANVAS.indexOf('<section class="ab" id="h21">', a);
  assert.ok(b > a, 'H21 no longer follows H20 — this slice would run past the artboard');
  return CANVAS.slice(a, b).replaceAll('&amp;', '&');
}

/**
 * One list out of the canvas's data model, as `{ name, note }` pairs in order.
 * The model is JavaScript inside the export, so a `’` there is six
 * characters of source; it is decoded here so a note reads as the canvas
 * renders it.
 */
function canvasList(key) {
  const opener = `${key}: [`;
  assert.equal(count(CANVAS, opener), 1, `the canvas must declare ${key} exactly once`);
  const at = CANVAS.indexOf(opener);
  const body = CANVAS.slice(at, CANVAS.indexOf('],', at));
  const unescape = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return [...body.matchAll(/\{\s*name:'((?:[^'\\]|\\.)*)',\s*note:'((?:[^'\\]|\\.)*)'\s*\}/g)]
    .map((m) => ({ name: unescape(m[1]), note: unescape(m[2]) }));
}

const HQ_CANVAS = canvasList('t1HqActions');
const ADMIN_CANVAS = canvasList('t1AdminActions');
const PLAIN = render(HqTeamActions, {});
const OVERLAY = render(HqTeamActions, { viewAs: 'fr' });

test('the two cards carry H20\'s names, verbatim and in its order', () => {
  const art = h20();
  // The lists read below are the ones this artboard draws, not a neighbour's.
  assert.ok(art.includes('{{ t1HqActions }}') && art.includes('{{ t1AdminActions }}'),
    'H20 no longer draws the two action lists this test reads');
  assert.ok(art.includes('HQ-only actions') && art.includes("Admin's actions"),
    'H20 no longer titles its two cards as the page does');
  assert.equal(HQ_CANVAS.length, 5, 'the canvas list could not be parsed — the names below would compare nothing');
  assert.equal(ADMIN_CANVAS.length, 4, 'the canvas list could not be parsed — the names below would compare nothing');

  assert.deepEqual(HQ_ONLY_ACTIONS.map((a) => a.name), HQ_CANVAS.map((a) => a.name),
    'an HQ-only row was renamed, dropped or reordered against H20');
  assert.deepEqual(ADMIN_ACTIONS.map((a) => a.name), ADMIN_CANVAS.map((a) => a.name),
    'an admin row was renamed, dropped or reordered against H20');

  // And the rendered card draws them in that order — the data could be right
  // and the render could drop one.
  const plain = text(PLAIN);
  const at = [...HQ_CANVAS, ...ADMIN_CANVAS].map(({ name }) => plain.indexOf(name));
  assert.ok(at.every((i) => i >= 0), 'a row the canvas names is not rendered');
  assert.deepEqual([...at].sort((x, y) => x - y), at, 'the rendered rows are out of the canvas\'s order');
});

test('the canvas notes that describe a platform that does not exist do not reach the page', () => {
  const notes = [...HQ_CANVAS, ...ADMIN_CANVAS].map((a) => a.note).join(' | ');
  const art = h20();
  // Each claim is asserted to be the CANVAS'S first — a phrase the canvas no
  // longer makes would pass the second half vacuously.
  const FALSE_CLAIMS = [
    ['banner both sides see', notes], // the target sees no banner and is not told
    ['both parties notified', notes], // the transfer notifies nobody
    ['Lands on Programs as well', notes], // spinout-admit writes user_spinout_flags only
    ['seats only', notes], // no grant is checked against a seat count
    ['The decision happens on Approvals', notes], // Approvals decides nothing
    ['live on Admin · Accounts', art], // they live on /admin's Users table and the directory
  ];
  for (const [claim, source] of FALSE_CLAIMS) {
    assert.ok(source.includes(claim), `the canvas no longer says "${claim}" — drop it from this list`);
    for (const [state, html] of [['HQ view', PLAIN], ['under the overlay', OVERLAY]]) {
      assert.ok(!text(html).includes(claim), `the cards repeat the canvas's false "${claim}" (${state})`);
    }
  }
  // What each row says instead is the route's own requirement, stated where the
  // canvas stated the fiction.
  const plain = text(PLAIN);
  assert.match(plain, /The person is not told: no banner on their side, no notification\./);
  assert.match(plain, /The successor is not notified\./);
  assert.match(plain, /It does not place them in a cohort on Programs\./);
  assert.match(plain, /Neither is checked against the licence’s seats — no grant on the platform is\./);
  assert.match(plain, /Approvals shows the outcome and offers no decision\./);
});

test('the HQ-only card: five rows, the role shell marked as every admin\'s, the count stated from the data', () => {
  assert.ok(PLAIN.includes('data-testid="hq-team-actions-hq"'), 'the HQ-only card is not drawn on HQ');
  const rowAt = (key) => PLAIN.indexOf(`data-testid="hq-team-action-${key}"`);
  const keys = HQ_ONLY_ACTIONS.map((a) => a.key);
  assert.deepEqual(keys, ['impersonate', 'role_shell', 'demote_deactivate', 'transfer', 'role_override']);
  const at = keys.map(rowAt);
  assert.ok(at.every((i) => i > 0), 'an HQ-only row is not rendered');

  // The one row that is not HQ's says so, and it is that row that says it.
  assert.equal(count(PLAIN, 'data-testid="hq-team-action-not-hq"'), 1,
    'exactly one row is every admin\'s — the chip is missing or repeated');
  const shell = PLAIN.slice(rowAt('role_shell'), rowAt('demote_deactivate'));
  assert.ok(shell.includes('data-testid="hq-team-action-not-hq"'), 'the "every admin\'s" chip is not on the role-shell row');
  assert.deepEqual(HQ_ONLY_ACTIONS.filter((a) => a.hq === false).map((a) => a.key), ['role_shell']);

  // The footnote's count is a claim about the list above it.
  const WORD = ['None', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
  const hq = HQ_ONLY_ACTIONS.filter((a) => a.hq).length;
  const total = HQ_ONLY_ACTIONS.length;
  assert.ok(text(PLAIN).includes(`${WORD[hq]} of these ${WORD[total].toLowerCase()} are the Super Admin’s alone`),
    'the footnote\'s count no longer matches the rows it counts');
});

test('under the overlay the HQ-only card is absent and the admin card says whose actions these are', () => {
  assert.ok(!OVERLAY.includes('data-testid="hq-team-actions-hq"'), 'the HQ-only card is drawn under a branch\'s name');
  for (const a of HQ_ONLY_ACTIONS) {
    assert.ok(!OVERLAY.includes(`data-testid="hq-team-action-${a.key}"`), `${a.key} is drawn under the overlay`);
  }
  assert.ok(!hrefs(OVERLAY).includes('/admin/security'), 'the Security link survives with the card it belongs to gone');
  assert.ok(OVERLAY.includes('data-testid="hq-team-actions-admin"'), 'the admin card must still be drawn');
  const note = text(OVERLAY);
  assert.match(note, /These are fr's own, on its Admin Console\./, 'the admin card does not name the branch it describes');
  assert.match(note, /not KYC, access or Lab state/, 'the admin card does not say why there are no row actions');
  // And on HQ it says they are every admin's, HQ's included.
  assert.match(text(PLAIN), /Every admin has these four, HQ included/);
});

test('the cards carry no control of their own, in either state', () => {
  for (const html of [PLAIN, OVERLAY]) {
    for (const tag of ['<button', '<input', '<select', '<textarea', '<form']) {
      assert.ok(!html.includes(tag), `the action cards render a ${tag} — they describe powers, they do not exercise them`);
    }
  }
  assert.ok(!/\bonClick=|\bonSubmit=/.test(ACTIONS), 'the action cards carry a handler');
});

test('every link is literal and lands on a registered route', () => {
  // Literal in the source: a `to={…}` is a route the reachability walk cannot read.
  assert.equal(count(ACTIONS, 'to={'), 0, 'a link in the action cards is built rather than written');
  assert.ok(count(ACTIONS, 'to="') >= 3, 'the action cards lost a link');

  const all = [...new Set([...hrefs(PLAIN), ...hrefs(OVERLAY)])].sort();
  assert.deepEqual(all, ['/admin/licences', '/admin/security', '/admin?tab=kyc']);
  for (const href of all) {
    const path = href.split('?')[0];
    assert.ok(APP.includes(`<Route path="${path}" element=`), `${path} is not a registered route`);
  }
  // `?tab=kyc` resolves to /admin and opens its KYC section only if the Admin
  // Console knows the section by that value.
  assert.match(ADMIN, /\{ value: 'kyc', label: 'KYC Queue'/, 'the Admin Console has no kyc section for the link to open');
  assert.match(ADMIN, /get\('tab'\);\s*return t && ADMIN_SECTION_VALUES\.has\(t\)/, 'the Admin Console no longer honours ?tab=');
});

test('drawsAccountControls: an admin row is the Super Admin\'s alone, and the viewer\'s own row draws neither', () => {
  const holder = { id: 1, is_super_admin: 1 };
  const plainAdmin = { id: 2, is_super_admin: 0 };
  const cases = [
    // [row, viewer, expected, why]
    [{ id: 9, role: 'founder' }, plainAdmin, true, 'a plain admin acts on a non-admin'],
    [{ id: 9, role: 'founder' }, holder, true, 'the holder acts on a non-admin'],
    [{ id: 9, role: 'admin' }, plainAdmin, false, 'a plain admin can only be refused on an admin (D132, D133)'],
    [{ id: 9, role: 'admin' }, holder, true, 'the holder acts on an admin'],
    [{ id: 9, role: 'ADMIN' }, plainAdmin, false, 'the role is compared without case'],
    [{ id: 2, role: 'admin' }, plainAdmin, false, 'the viewer\'s own row draws neither'],
    [{ id: 1, role: 'admin' }, holder, false, 'the holder\'s own row draws neither'],
    [{ id: '1', role: 'founder' }, holder, false, 'an id that arrives as a string is still the viewer'],
    [{ id: 9, role: 'admin' }, { id: 1, is_super_admin: true }, true, 'a boolean elevation reads as held'],
    [{ id: 9, role: 'admin' }, { id: 1 }, false, 'an absent elevation is not held'],
    [{ id: 9, role: 'admin' }, null, false, 'no viewer holds nothing'],
    [null, holder, false, 'no row draws nothing'],
  ];
  for (const [row, viewer, want, why] of cases) {
    assert.equal(drawsAccountControls(row, viewer), want, why);
  }
  // The elevation is read the way `canOverrideRole` reads it on the same page.
  assert.match(CONTROLS, /Number\(viewer\?\.is_super_admin \?\? 0\) === 1/);
  assert.match(ADMIN, /const canOverrideRole = Number\(viewer\?\.is_super_admin \?\? 0\) === 1;/);
});

test('the directory draws View As and Disable only inside the one guard, on the row and in the drawer', () => {
  assert.match(ADMIN, /import \{ drawsAccountControls \} from '\.\.\/lib\/accountControls';/);

  // The row: both controls between the guard and the fragment it opens.
  const guard = '{drawsAccountControls(u, viewer) && (';
  assert.equal(count(ADMIN, guard), 1, 'the row guard is missing or doubled');
  const g = ADMIN.indexOf(guard);
  const close = ADMIN.indexOf('</>', g);
  for (const call of ['handleImpersonate(u)', 'handleToggleActive(u.id)']) {
    assert.equal(count(ADMIN, call), 1, `${call} is called from more than one place in the directory`);
    const at = ADMIN.indexOf(call);
    assert.ok(at > g && at < close, `${call} is drawn outside the guard`);
  }

  // The drawer is handed no handler where the rule says no.
  assert.match(ADMIN, /onImpersonate=\{drawsAccountControls\(openUser, viewer\) \? \(\) => \{[^\n]*\} : null\}/,
    'the drawer is handed View As regardless of the rule');
  assert.match(ADMIN, /onToggleActive=\{drawsAccountControls\(openUser, viewer\) \? \(\) => \{[^\n]*\} : null\}/,
    'the drawer is handed Disable regardless of the rule');

  // And a missing handler is ABSENT in the drawer, not disabled — rendered.
  const row = { id: 7, name: 'A. Person', email: 'a@example.test', role: 'founder', is_active: 1 };
  const both = render(UserDetailModal, { userRow: row, onClose() {}, onImpersonate() {}, onToggleActive() {} });
  const neither = render(UserDetailModal, { userRow: row, onClose() {}, onImpersonate: null, onToggleActive: null });
  const onlyView = render(UserDetailModal, { userRow: row, onClose() {}, onImpersonate() {}, onToggleActive: null });
  assert.ok(text(both).includes('View As') && text(both).includes('Disable account'), 'the drawer lost a control it was handed');
  assert.ok(!text(neither).includes('View As') && !text(neither).includes('Disable account'),
    'the drawer draws a control it was not handed');
  assert.ok(text(onlyView).includes('View As') && !text(onlyView).includes('Disable account'),
    'the two controls are not decided independently');
});

test('the Admin role badge no longer says the role changes only through SQL', () => {
  assert.ok(!ADMIN.includes('direct database SQL'), 'the picker still claims SQL is the only way to change the admin role');
  assert.ok(ADMIN.includes('title="An administrator is opened and demoted on the licence they hold (Licences → Administrators), by the Super Admin — not from this picker"'),
    'the badge no longer names where an administrator is opened and demoted');
});

test('the transfer asks for the reason the worker requires, at the same floor, and sends it', () => {
  // Read as a literal scan, not a pattern built from the name: the name is data.
  const floorOf = (src, decl) => {
    const at = src.indexOf(`${decl} = `);
    assert.ok(at >= 0, `no ${decl} found`);
    const value = src.slice(at + decl.length + 3, src.indexOf(';', at));
    assert.ok(/^\d+$/.test(value), `${decl} is not a plain number: ${value}`);
    return Number(value);
  };
  assert.equal(floorOf(HOLDERS, 'const HOLDER_REASON_MIN'), floorOf(WORKER_HOLDERS, 'export const HOLDER_REASON_MIN'),
    'the form and the route disagree about how long a reason must be');
  assert.match(HOLDERS, /const reasonReady = reason\.trim\(\)\.length >= HOLDER_REASON_MIN;/);
  assert.match(HOLDERS, /disabled=\{busy \|\| !pick \|\| !reasonReady\}/, 'the form submits a reason the route will refuse');
  assert.match(HOLDERS, /api\.superAdminGrant\(Number\(pick\), \{ transfer: hasHolder, reason: reason\.trim\(\) \}\)/,
    'the form does not send the reason it asked for');
  assert.match(API, /superAdminGrant: \(userId, \{ transfer = false, reason = '' \} = \{\}\) =>/);
  assert.match(API, /body: JSON\.stringify\(\{ reason: String\(reason \|\| ''\)\.trim\(\) \}\)/,
    'the api method drops the reason on the way out');
});

test('the transfer offers only an active administrator, because the route refuses the rest', () => {
  // D221 — the route refuses a deactivated successor (`not_active`): an account
  // that cannot sign in would hold an elevation nobody could use. So the
  // picker must not draw one, and the card must not describe a gate the route
  // does not have. Both halves are read, because either alone can drift.
  assert.ok(WORKER_HOLDERS.includes("code: 'not_active'"), 'the route no longer refuses a deactivated successor');
  assert.match(HOLDERS, /const candidates = admins\.filter\(\(a\) => !holderIds\.has\(a\.id\) && Number\(a\.is_active\) === 1\);/,
    'the picker offers a deactivated admin the route will refuse');
  // The flag has to survive the normalisation, or the filter reads undefined
  // and offers nobody at all — which fails closed, but says the wrong thing.
  assert.ok(HOLDERS.includes('is_active: x.is_active'), 'the admin list drops the active flag before the picker reads it');
  const row = HQ_ONLY_ACTIONS.find((a) => a.key === 'transfer');
  assert.ok(row.gate.includes('an administrator whose account is active'),
    'the card does not say the successor must be active');
});

test('the page: H20\'s order, and under the overlay nothing that reads HQ\'s database is drawn', () => {
  assert.match(PAGE, />Team<\/h1>/, 'the page is not headed Team');
  const holders = PAGE.indexOf('<SuperAdminHolders');
  const table = PAGE.indexOf('<HqTeamTable');
  const actions = PAGE.indexOf('<HqTeamActions');
  const directory = PAGE.indexOf('<AdminPage');
  assert.ok(holders > 0 && table > holders && actions > table && directory > actions,
    'the order is not holders → Team table → action cards → directory');
  assert.ok(PAGE.includes('<HqTeamActions viewAs={viewAs} />'), 'the cards are not told whose view this is');
  assert.ok(PAGE.includes('const { branch: viewAs } = useViewAsBranch();'));

  // The holder console is the ELSE of the overlay; the directory sits behind
  // `!viewAs` with nothing between the guard and it but its caption.
  assert.match(PAGE, /\{viewAs \? \([\s\S]*?data-testid="hq-team-view-as-omitted"[\s\S]*?\) : \(\s*<SuperAdminHolders/,
    'the holder console is drawn under a branch\'s name');
  const guard = PAGE.lastIndexOf('{!viewAs && (', directory);
  assert.ok(guard > actions, 'the directory is drawn under the overlay');
  assert.ok(!PAGE.slice(guard, directory).includes(')}'), 'the overlay guard closes before the directory it guards');
});

test('the rail reads what the Team table read, on the super_admin tier', () => {
  const tag = PAGE.slice(PAGE.indexOf('<HqTeamTable'), PAGE.indexOf('/>', PAGE.indexOf('<HqTeamTable')) + 2);
  assert.ok(tag.includes('onLoaded={setTeam}'), 'the table does not hand the page what it read');
  assert.match(TABLE, /useEffect\(\(\) => \{\s*if \(data !== undefined && typeof onLoaded === 'function'\) onLoaded\(data\);\s*\}, \[data, onLoaded\]\);/,
    'the table does not report its read — the rail would need a second fetch of the roster');
  assert.match(PAGE, /<WorkerRail[\s\S]*?role="super_admin"[\s\S]*?coverage=\{coverage\}/);
  assert.match(PAGE, /const coverage = \[[\s\S]*?\]\.filter\(Boolean\);/);
  // Every coverage line about HQ's own roster is withheld under the overlay,
  // where the table read one branch instead.
  assert.equal(count(PAGE, 'team && !viewAs &&'), 3, 'a line about HQ\'s roster is stated under a branch\'s name');
});

test('the voice rule holds on everything this page says', () => {
  const BANNED = /advisor|advice|recommendation|fiduciar/i;
  for (const [what, s] of [['HQ view', text(PLAIN)], ['overlay', text(OVERLAY)], ['cards', ACTIONS], ['page', PAGE], ['rule', CONTROLS]]) {
    assert.ok(!BANNED.test(s), `the ${what} uses a banned word`);
  }
});
