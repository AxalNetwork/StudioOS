/**
 * D704 (#1666) — the three retired Validate pages.
 *   test 1, `validateZoneTarget` returns decision 1's table exactly;
 *   test 2's MemoryRouter case, `ValidateZoneRedirect` lands on the module (PR 2a);
 *   test 3, `/validate` no longer branches (PR 2a);
 *   test 4's empty-bucket case, `zoneForPath` answers null, not `undefined`;
 *   test 2's route case and test 5's items for `/validate/interviews` (PR 2b).
 * The closing PR adds the other two route cases and tests 4-8 when it mounts
 * their redirects and removes the zones.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_pages_removed_d704.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { ValidateZoneRedirect } from '../src/pages/cycles/ValidateZoneRedirect.jsx';
import { installDocument } from './_contracts_dom.mjs';
import { VALIDATE_ZONE_TARGETS, validateZoneTarget } from '../src/pages/cycles/validateRedirects.js';
import { zoneForPath, bucketsFor, bucketForPath, allZoneRoutes } from '../src/workspaces/shellConfig.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { FOUNDER_FULL_BLEED } from '../src/sidebarConfig.js';
import ZoneNav from '../src/workspaces/ZoneNav.jsx';
import BucketOverview from '../src/workspaces/BucketOverview.jsx';
import BucketBoard from '../src/workspaces/BucketBoard.jsx';
import { FOUNDER_ZONE_ACTIONS } from '../src/workspaces/founderZoneActions.js';
import { FOUNDER_ZONE_FILTERS } from '../src/workspaces/founderZoneFilters.js';
import { FOUNDER_TOOLS } from '../src/pages/cycles/founderToolNavigation.js';
import { routeBlock } from './_routes.mjs';

/** A target with its query as a set of `key=value` pairs, so order never matters. */
const asSet = (t) => (t == null ? t : {
  pathname: t.pathname,
  query: new Set([...new URLSearchParams(t.search.replace(/^\?/, ''))].map(([k, v]) => `${k}=${v}`)),
  hash: t.hash,
});
const lands = (zone, search, hash, pathname, query, frag = '') => {
  assert.deepEqual(asSet(validateZoneTarget(zone, search, hash)), { pathname, query: new Set(query), hash: frag },
    `${zone}${search}${hash}`);
};

test('D704 test 1: Interviews lands on Customer research, with the venture and the hash kept', () => {
  lands('interviews', '?project_id=3', '#top', '/validate/customer-research', ['project_id=3'], '#top');
  assert.deepEqual(validateZoneTarget('interviews', '?project_id=3', '#top'),
    { pathname: '/validate/customer-research', search: '?project_id=3', hash: '#top' });
  lands('interviews', '', '', '/validate/customer-research', []);
  assert.deepEqual(validateZoneTarget('interviews', '', ''), { pathname: '/validate/customer-research', search: '', hash: '' });
});

test('D704 test 1: ?new=record opens Record a session, with new dropped and the rest kept', () => {
  lands('interviews', '?new=record&project_id=3', '', '/validate/record', ['project_id=3']);
  lands('interviews', '?project_id=3&new=record', '#x', '/validate/record', ['project_id=3'], '#x');
});

test('D704 test 1: ?new=notes and ?new=upload become #1659\'s ?log= opener; any other new is dropped', () => {
  lands('interviews', '?new=notes', '', '/validate/customer-research', ['log=notes']);
  lands('interviews', '?new=upload&project_id=3', '', '/validate/customer-research', ['log=upload', 'project_id=3']);
  lands('interviews', '?new=zzz', '', '/validate/customer-research', []);
  lands('interviews', '?new=zzz&project_id=3', '#h', '/validate/customer-research', ['project_id=3'], '#h');
  lands('interviews', '?new=', '', '/validate/customer-research', []);
});

test('D704 test 1: Pain map and Hypotheses land on their modules, query and hash kept, and keep a new they do not read', () => {
  lands('pain-map', '?project=3', '#x', '/validate/problem-discovery', ['project=3'], '#x');
  lands('hypotheses', '?project=3', '#y', '/validate/experiments', ['project=3'], '#y');
  lands('pain-map', 'project_id=3', 'x', '/validate/problem-discovery', ['project_id=3'], '#x');
  // Only the Interviews page ever read `?new=`; the other two pass it on untouched.
  lands('hypotheses', '?new=record', '', '/validate/experiments', ['new=record']);
});

test('D704 test 1: exactly the three retired pages, and nothing else redirects', () => {
  assert.ok(Object.isFrozen(VALIDATE_ZONE_TARGETS));
  assert.deepEqual(Object.keys(VALIDATE_ZONE_TARGETS), ['interviews', 'pain-map', 'hypotheses']);
  for (const zone of ['verdict', 'customer-research', 'record', 'constructor', '', undefined]) {
    assert.equal(validateZoneTarget(zone, '?project_id=3', ''), null, String(zone));
  }
});

test('D704 test 4 (empty bucket): zoneForPath answers a bucket with no zones with null, not undefined', () => {
  const empty = { prefix: '/validate', zones: [] };
  assert.equal(zoneForPath(empty, '/validate'), null);
  assert.equal(zoneForPath(empty, '/validate/'), null);
  assert.equal(zoneForPath(empty, '/validate/interviews'), null, 'an unknown slug is null too');
  // A bucket with zones still answers its root with the first one.
  const build = bucketsFor('founder').find((b) => b.prefix === '/build');
  assert.equal(zoneForPath(build, '/build'), build.zones[0]);
});

test('D704 test 4 (no zone): Validate keeps its row and prefix with no zones, and nothing draws a zone for it', async () => {
  const validate = bucketsFor('founder').find((b) => b.label === 'Validate');
  assert.equal(validate.prefix, '/validate');
  assert.deepEqual(validate.zones, []);
  assert.equal(allZoneRoutes('founder').some((r) => r.startsWith('/validate/')), false, 'no zone route under /validate/');
  assert.ok(FOUNDER_FULL_BLEED.includes('/validate'), 'the prefix still drives full bleed');
  assert.equal(zoneForPath(validate, '/validate'), null);
  assert.equal(bucketForPath('founder', '/validate/customer-research')?.label, 'Validate', 'the bucket still answers its module pages');
  const html = (el) => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/validate'] }, el));
  assert.equal(html(React.createElement(ZoneNav, { bucket: validate })), '');
  assert.equal(html(React.createElement(BucketOverview, { bucket: validate })), '');
  assert.equal(html(React.createElement(BucketBoard, { bucket: validate, board: { sections: [{ key: 'x' }] } })), '');
  for (const table of [FOUNDER_ZONE_ACTIONS, FOUNDER_ZONE_FILTERS]) {
    assert.equal(Object.keys(table).some((k) => k.startsWith('validate/')), false, 'no zone table has a validate/ key');
  }
});

// ── PR 2a ─────────────────────────────────────────────────────────────────

/** Where `ValidateZoneRedirect` at `entry` lands, read from the router after it navigates. */
async function landing(zone, entry) {
  const restore = installDocument();
  const at = {};
  function Address() { const l = useLocation(); const type = useNavigationType(); Object.assign(at, { pathname: l.pathname, search: l.search, hash: l.hash, type }); return null; }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [entry] },
      React.createElement(Address),
      React.createElement(Routes, null, React.createElement(Route, { path: `/validate/${zone}`, element: React.createElement(ValidateZoneRedirect, { zone }) })))));
    return { ...at };
  } finally { await act(async () => root.unmount()); restore(); }
}

test('D704 test 2: ValidateZoneRedirect in a MemoryRouter lands on the module, the venture and the hash kept, replacing the old address', async () => {
  assert.deepEqual(await landing('pain-map', '/validate/pain-map?project_id=3#x'), { pathname: '/validate/problem-discovery', search: '?project_id=3', hash: '#x', type: 'REPLACE' });
  assert.deepEqual(await landing('hypotheses', '/validate/hypotheses?project_id=3'), { pathname: '/validate/experiments', search: '?project_id=3', hash: '', type: 'REPLACE' });
  assert.deepEqual(await landing('interviews', '/validate/interviews?project_id=3&new=record'), { pathname: '/validate/record', search: '?project_id=3', hash: '', type: 'REPLACE' });
  // App.jsx re-exports it beside HistoryRedirect; PR 2b and the closing PR mount it.
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  assert.ok(app.includes("import { ValidateZoneRedirect } from './pages/cycles/ValidateZoneRedirect.jsx';"));
  assert.ok(app.includes('export { ValidateZoneRedirect };'));
  assert.ok(app.indexOf('export { ValidateZoneRedirect };') > app.indexOf('export function HistoryRedirect('), 'beside HistoryRedirect');
});

test('D704 test 3: /validate renders CycleRoute for every admitted role, with no ternary and no Navigate; founderValidateLanding is gone', () => {
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  const at = app.indexOf('<Route path="/validate" element=');
  assert.ok(at > 0);
  const line = app.slice(at, app.indexOf('\n', at));
  assert.equal(line, `<Route path="/validate" element={guard(labRoles(['admin', 'founder']), <CycleRoute cycle="validate" />)} />`);
  assert.doesNotMatch(app, /founderValidateLanding/);
  assert.doesNotMatch(app, /<Navigate to="\/validate\/interviews"/, 'no role is sent to the Interviews page from the root');
  assert.ok(existsSync('frontend/src/pages/cycles/ValidateZoneRedirect.jsx'));
});

// ── PR 2b: /validate/interviews is Customer research ────────────────────────

test('D704 test 2 (route): the three old paths render ValidateZoneRedirect under their guard, and no old page', () => {
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  for (const zone of ['interviews', 'pain-map', 'hypotheses']) {
    const block = routeBlock(app, `/validate/${zone}`);
    assert.ok(block, `/validate/${zone} is still declared, so a bookmark lands`);
    assert.ok(block.includes(`element={guard(labRoles(['admin', 'founder']), <ValidateZoneRedirect zone="${zone}" />)}`), `/validate/${zone} redirects with its own zone`);
    assert.doesNotMatch(block, /FounderValidateWorkspace|founderEditor/, 'no editor chrome and no old page');
  }
  assert.doesNotMatch(app, /FounderValidateWorkspace/, 'App.jsx no longer imports the old workspace');
  // #1704's /validate/verdict is the Verdict module.
  assert.ok(routeBlock(app, '/validate/verdict').includes('<CycleRoute cycle="validate" slug="verdict" />'));
  // #1658's one-interview redirect is untouched.
  assert.match(routeBlock(app, '/validate/interviews/:id'), /<ParamRedirect to="\/validate\/customer-research\/:id" \/>/);
});

test('D704 test 5 (interviews): no tool, door or Lab link leads to the Interviews page', () => {
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  const at = route.indexOf('tools: toFnMap({');
  const tools = route.slice(at, route.indexOf('\n    }),', at)); // Validate's block, to its closing line
  assert.doesNotMatch(tools, /'customer-research':/, 'Customer research has no tool link: its module is the tool');
  assert.doesNotMatch(tools, /\/validate\/interviews/);
  assert.match(tools, /'market-intelligence': \(\) => \(\{ label: 'Open the competitor tracker', href: '\/build\/competitors' \}\)/, 'Market intelligence keeps its tool');
  assert.equal(FOUNDER_TOOLS.some((t) => t.path === '/validate/interviews' || t.aliases?.includes('/validate/interviews')), false, 'FOUNDER_TOOLS has no /validate/interviews');
  assert.ok(FOUNDER_TOOLS.some((t) => t.path === '/build/discovery'), 'the other Customer research tools stay');
  const lab = readFileSync('frontend/src/pages/SpinoutLabDiscoveryPage.jsx', 'utf8');
  assert.ok(lab.includes("<Link to={`/validate/customer-research/${interview.id}${interview.project_id ? `?project_id=${interview.project_id}` : ''}`}"), "the Lab's cell opens the interview's record, its venture kept");
  assert.match(lab, />Transcribe on Customer research →<\/Link>/);
  assert.doesNotMatch(lab, /to="\/validate\/interviews"/);
});

// ── The closing PR: no zone, no link, no old page in the code ──────────────

test('D704 test 5 (the door): the Validate chapter lists the modules, and its live items are module pages', async () => {
  const { DOORS } = await import('../src/lib/siteDoors.js');
  const { MODULES } = await import('../src/pages/cycles/modules.js');
  const chapter = DOORS.founders.chapters.find((c) => c.k === 'Validate');
  assert.deepEqual(chapter.list, MODULES.validate.map((m) => m.name), "the chapter lists MODULES.validate's names, in order");
  assert.match(chapter.d, /the pain themes/);
  assert.doesNotMatch(chapter.d, /a pain map/, 'the pain map is no longer a page');
  const routes = DOORS.founders.live.map((i) => i.route);
  for (const r of ['/validate/customer-research', '/validate/experiments', '/validate/verdict']) assert.ok(routes.includes(r), `${r} is live`);
  assert.ok(DOORS.founders.live.some((i) => i.t === 'Hypotheses and evidence' && i.route === '/validate/experiments'));
  assert.ok(DOORS.founders.live.some((i) => i.t === 'Verdict' && i.route === '/validate/verdict'));
  for (const door of Object.values(DOORS)) {
    for (const i of door.live) assert.doesNotMatch(i.route, /^\/validate\/(interviews|pain-map|hypotheses)$/, `${i.t} links an old page`);
  }
  // Validate's tools give no old path: only Market intelligence keeps a tool.
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  const at = route.indexOf('tools: toFnMap({');
  const tools = route.slice(at, route.indexOf('\n    }),', at));
  assert.deepEqual([...tools.matchAll(/^ {6}'?([a-z-]+)'?: /gm)].map((m) => m[1]), ['market-intelligence']);
});

/** Test 6's pattern: an old page path, not part of a longer path or name. */
const OLD_PAGE = /(?<![\w/-])\/validate\/(interviews|pain-map|hypotheses)(?![\w-])/g;

test('D704 test 6 (frontend guard): no source names an old page path but the redirect routes', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { codeOnly } = await import('./_codeOnly.mjs');
  const root = resolve(process.cwd(), 'frontend/src');
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = resolve(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|jsx)$/.test(p)) files.push(p); } };
  walk(root);
  assert.ok(files.length > 300, 'the walk found the frontend');
  // The only exceptions: the redirect table, and App.jsx's routes for the three
  // paths and #1658's /validate/interviews/:id.
  const ROUTES = [
    `<Route path="/validate/interviews" element={guard(labRoles(['admin', 'founder']), <ValidateZoneRedirect zone="interviews" />)} />`,
    `<Route path="/validate/pain-map" element={guard(labRoles(['admin', 'founder']), <ValidateZoneRedirect zone="pain-map" />)} />`,
    `<Route path="/validate/hypotheses" element={guard(labRoles(['admin', 'founder']), <ValidateZoneRedirect zone="hypotheses" />)} />`,
    `<Route path="/validate/interviews/:id" element={guard(labRoles(['admin', 'founder']), <ParamRedirect to="/validate/customer-research/:id" />)} />`,
  ];
  const hits = [];
  for (const f of files) {
    const rel = f.slice(root.length + 1);
    if (rel === 'pages/cycles/validateRedirects.js') continue;
    for (const line of codeOnly(readFileSync(f, 'utf8')).split('\n')) {
      if (rel === 'App.jsx' && ROUTES.includes(line.trim())) continue;
      for (const m of line.matchAll(OLD_PAGE)) hits.push(`${rel}: ${m[0]} in ${line.trim().slice(0, 120)}`);
    }
  }
  assert.deepEqual(hits, []);
  // API paths and longer names do not match; the page paths do.
  assert.equal('/founder/validate/interviews/7/evidence'.match(OLD_PAGE), null);
  assert.equal('/founder/validate/pain-map/7/export.csv'.match(OLD_PAGE), null, 'the pain-map export route passes the guard');
  assert.equal("'/validate/interviews-old'".match(OLD_PAGE), null);
  assert.equal("to=\"/validate/hypotheses\"".match(OLD_PAGE)?.length, 1);
});

test('D704 test 7 (deleted and kept): the old workspace and its pieces are gone; what #1659 uses stays', async () => {
  const { existsSync } = await import('node:fs');
  const read = (p) => readFileSync(p, 'utf8');
  assert.equal(existsSync('frontend/src/workspaces/founder/FounderValidateWorkspace.jsx'), false);
  const pieces = read('frontend/src/pages/founder/validatePieces.jsx');
  for (const gone of ['VerdictPanel', 'earlierDecisions', 'ClaimLinkList']) assert.doesNotMatch(pieces, new RegExp(`export function ${gone}\\b`), `${gone} is removed`);
  const api = read('frontend/src/lib/api.js');
  for (const gone of ['getValidationDecision', 'recordValidationDecision', 'updateHypothesis', 'linkHypothesisPain', 'unlinkHypothesisPain']) {
    assert.doesNotMatch(api, new RegExp(`^\\s*${gone}:`, 'm'), `api.${gone} has no caller and is removed`);
  }
  // Kept, each with an importer or caller.
  for (const kept of ['getValidationBoard', 'createHypothesis', 'exportValidateSummary']) assert.match(api, new RegExp(`^\\s*${kept}:`, 'm'), `api.${kept} stays`);
  const sections = read('frontend/src/pages/cycles/ValidateSections.jsx');
  assert.match(sections, /from '\.\.\/\.\.\/lib\/verdictHistory'/, 'lib/verdictHistory.js keeps its importer');
  assert.match(sections, /from '\.\.\/\.\.\/workspaces\/founder\/ValidateDialogs'/, 'ValidateDialogs.jsx keeps its importer');
  assert.match(sections, /import LogInterviewModal from/, 'LogInterviewModal keeps its importer');
  const record = read('frontend/src/pages/founder/InterviewReviewPage.jsx');
  for (const used of ['InterviewRecording', 'InterviewEvidenceFields', 'PainSeverity']) assert.ok(record.includes(used), `${used} keeps its importer`);
  assert.ok(existsSync('frontend/src/workspaces/founder/InterviewRecording.jsx') && existsSync('frontend/src/workspaces/founder/ValidateDialogs.jsx'));
  assert.ok(existsSync('frontend/src/pages/founder/FounderRaiseDataRoom.jsx'), 'FounderRaiseDataRoom stays');
});

test('D704 test 8 (census): each verdict-zone feature is drawn at its home', () => {
  const read = (p) => readFileSync(p, 'utf8');
  const sections = read('frontend/src/pages/cycles/ValidateSections.jsx');
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  const adapter = read('frontend/src/pages/cycles/adapters/validate.js');
  const forms = read('frontend/src/pages/cycles/forms.js');
  const homes = [
    ['the decision: Verdict module, Decisions table', adapter, /\{ slug: 'verdict', name: 'Verdict' \}/],
    ['Record a decision', forms, /FORMS\.validate = \{ \.\.\.VALIDATE_FORMS, verdict: \[verdictForm\] \}/],
    ['Export summary', route, /api\.exportValidateSummary\(projectId\)/],
    ['Open the Problem slide', sections, />Open the Problem slide</],
    ['Quotable', sections, /label: 'Consent to quote'/],
    ['FitGap', sections, /<FitGap gap=\{parts\?\.fit_gap\} \/>/],
    ['Retired claims', adapter, /\{ value: 'retired', label: 'Retired' \}/],
    ['As of last week and Changed this month', adapter, /\{ value: 'last_week', label: 'As of last week' \}, \{ value: 'this_month', label: 'Changed this month' \}/],
  ];
  for (const [feature, src, at] of homes) assert.match(src, at, `${feature} lost its home`);
  // The pain map's per-theme counts (PR 2c) are the theme record's Segments lines.
  assert.match(read('cloudflare-worker/src/services/records/validate.ts'), /a: 'Your ICP', b: `strong or partial fit · \$\{g\.icp_count\} of /);
});
