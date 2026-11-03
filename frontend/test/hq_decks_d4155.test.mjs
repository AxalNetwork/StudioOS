// D4155 (#4155) — HQ › Decks: the model's words and rules, the routes and the
// Platform strip, and that nothing on the page writes without a route that
// records the reason.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_decks_d4155.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUILD, NOT_RECORDED, OUTCOMES, PROPOSAL_LINE, SECTORS, STAGES, TABS,
  defaultOnKeys, filterReports, flagLabel, flagRows, notYet, offGridOverrides, reasonOk, reportRow, resolveArmed, scopeLabel, templateChangeArmed, templateGrid,
  templatePreview, templateResetArmed, usdMicro, viewFor,
} from '../src/pages/hq/decks/hqDecksModel.js';
import { HQ_STRIPS, stripFor } from '../src/lib/hqStrips.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const PAGE = read('pages/hq/decks/HqDecksPage.jsx');
const ROUTES = read('routes/hqDecks.jsx');

test('six tabs at their own addresses, each an HQ-only route', () => {
  assert.deepEqual(TABS.map((t) => [t.label, t.to]), [
    ['Reports', '/admin/platform/decks'], ['Feature flags', '/admin/platform/decks/flags'], ['Beta cohort', '/admin/platform/decks/beta'],
    ['Default templates', '/admin/platform/decks/templates'], ['Stage norms', '/admin/platform/decks/norms'],
    // D4251 (#4251): the elements × models grid and the kill switch.
    ['AI models', '/admin/platform/decks/models'],
    // D1537 (#3786): the Grid's health and the adoption funnel.
    ['Grid health', '/admin/platform/decks/grid'], ['Funnel', '/admin/platform/decks/funnel'],
  ]);
  for (const { to } of TABS) assert.ok(ROUTES.includes(`<Route path="${to}" element={guard(['admin'], hqOnly(<HqDecksPage />))} />`), to);
  assert.equal(viewFor('/admin/platform/decks'), 'reports');
  assert.equal(viewFor('/admin/platform/decks/templates/'), 'templates');
  assert.equal(viewFor('/admin/platform/decks/nope'), 'reports');
});

test('Decks joins the Platform strip after Promo codes, in the list and in the chrome', () => {
  const labels = HQ_STRIPS.Platform.map((i) => i.label);
  assert.equal(labels[labels.indexOf('Promo codes') + 1], 'Decks');
  assert.equal(stripFor('/admin/platform/decks/flags'), 'Platform');
  assert.match(read('App.jsx'), /<StripLink to="\/admin\/platform\/promo-codes">Promo codes<\/StripLink>\n\s+<StripLink to="\/admin\/platform\/decks">Decks<\/StripLink>/);
});

test('each build task names its issue, and only a landed one is live', () => {
  assert.deepEqual(Object.entries(BUILD).map(([k, b]) => [k, b.issue]), [['K1', 4188], ['K2', 4189], ['K3', 4190], ['K4', 4191], ['K5', 4192]]);
  assert.deepEqual(Object.entries(BUILD).filter(([, b]) => b.live).map(([k]) => k), ['K1', 'K3', 'K4', 'K5'], 'K1 (#4188), K3 (#4190), K4 (#4191) and K5 (#4192) landed');
  assert.equal(notYet('K3'), 'Not switched on yet. The beta cohort arrives with #4190.');
});

test('HD1: a report row from the route, with K1\'s columns "Not recorded" and the charge never $0', () => {
  const r = reportRow({
    uid: 'r1', created_at: '2026-10-24T10:12:00Z', rail_option: 'shorten', model: 'Model A', reason: 'wrong_figure', reason_label: 'States something my records do not',
    note: 'Dropped a figure', status: 'open', charged_microusd: 4000, proposal: { status: 'discarded', payload: { text: 'Revenue is growing fast.' } },
  });
  assert.equal(r.founder, NOT_RECORDED);
  assert.equal(r.deck, NOT_RECORDED);
  assert.equal(r.before, NOT_RECORDED);
  assert.equal(r.after, 'Revenue is growing fast.');
  assert.equal(r.asked, 'shorten');
  assert.equal(r.charged, '$0.004');
  assert.equal(r.open, true);
  assert.equal(reportRow({ uid: 'x', status: 'resolved', charged_microusd: null }).charged, NOT_RECORDED);
  assert.equal(usdMicro(0), '$0.000', 'a recorded zero is a zero');
  const named = reportRow({ uid: 'y', founder: { name: 'Ada Example' }, deck: { title: 'Seed deck', version: 3 }, card: { label: 'Card 4 · Traction' } });
  assert.deepEqual([named.founder, named.deck, named.card], ['Ada Example', 'Seed deck · v3', 'Card 4 · Traction']);
  const rows = [r, reportRow({ uid: 'r2', model: 'Model B', reason: 'other', status: 'open' })];
  assert.deepEqual(filterReports(rows, { model: 'Model B' }).map((x) => x.uid), ['r2']);
  assert.deepEqual(filterReports(rows, { q: 'dropped' }).map((x) => x.uid), ['r1']);
});

test('HD1 (#4188): K1 is live, so the "not switched on" line goes, and the proposal line reads the table\'s own statuses', () => {
  assert.equal(BUILD.K1.live, true);
  assert.match(PAGE, /\{!BUILD\.K1\.live && \(isNR\(row\.founder\) \|\| isNR\(row\.before\)\) && <p[^>]*data-testid="deck-report-k1"/);
  assert.deepEqual(Object.keys(PROPOSAL_LINE).sort(), ['accepted', 'discarded', 'edited', 'proposed']);
  assert.equal(PROPOSAL_LINE.edited, PROPOSAL_LINE.accepted, 'an edited proposal was written to the deck too');
  assert.equal(PROPOSAL_LINE.pending, undefined, 'migration 506 has no pending status');
});

test('HD1: Resolve arms on an outcome and a note of at least 10 characters, and calls the mounted route', () => {
  assert.deepEqual(OUTCOMES.map((o) => o.id), ['addressed', 'no_fault']);
  assert.equal(resolveArmed({ outcome: 'addressed', note: 'Model dropped figures; prompt fixed.' }), true);
  assert.equal(resolveArmed({ outcome: 'addressed', note: 'short' }), false);
  assert.equal(resolveArmed({ outcome: 'other', note: 'A long enough note here' }), false);
  assert.equal(resolveArmed({ outcome: '', note: 'A long enough note here' }), false);
  assert.match(PAGE, /deckReportsApi\.resolve\(row\.uid, \{ outcome, note: note\.trim\(\) \}\)/);
  assert.match(PAGE, /disabled=\{!armed \|\| busy\}/);
});

test('HD2: flags in plain words and scopes; every toggle stays off until K2 records a reason', () => {
  assert.equal(flagLabel('grid_generate').name, 'Generate with The Grid');
  assert.equal(flagLabel('element:chart').name, 'Element · chart');
  assert.equal(flagLabel('model:m1').name, 'Model · m1');
  assert.equal(scopeLabel({ scope: 'global' }), 'Everyone');
  assert.equal(scopeLabel({ scope: 'role', scope_id: 'founder' }), 'Role · Founder');
  assert.equal(scopeLabel({ scope: 'user', scope_id: '42' }), 'One named person', 'never an id or an email');
  const reply = { flags: [{ key: 'grid_generate', scope: 'global', scope_id: '', enabled: 0, updated_by: 7, updated_at: '2026-10-12T00:00:00Z' }], keys: ['grid_generate', 'element:chart'] };
  const [row] = flagRows(reply);
  assert.equal(row.on, false);
  assert.equal(row.by, NOT_RECORDED, 'a bare user id is not a name');
  assert.deepEqual(defaultOnKeys(reply), ['element:chart']);
  const toggles = [...PAGE.matchAll(/<button type="button" className=\{BTN\} disabled title=\{notYet\('K2'\)\}/g)];
  assert.equal(toggles.length, 2);
  assert.equal((read('lib/api/adminFeatureFlags.js').match(/: \(\) => request\(/g) || []).length, 1, 'read-only: no write method before K2');
  assert.doesNotMatch(read('lib/api/adminFeatureFlags.js'), /method: 'PUT'/);
});

test('HD4: the sector × stage grid from the overrides; a default is never a guessed template', () => {
  assert.equal(SECTORS.length, 6);
  assert.deepEqual(STAGES.map((s) => s.label), ['Pre-seed', 'Seed', 'Series A', 'Series B+']);
  const methods = [{ id: 'yc_seed', label: 'Problem-first' }, { id: 'series_a_growth', label: 'Metrics grid' }];
  const reply = { overrides: [{ sector: 'Fintech', stage: 'seed', method_id: 'series_a_growth', updated_at: '2026-10-14' }, { sector: 'Gaming', stage: 'seed', method_id: 'yc_seed' }] };
  const grid = templateGrid(reply, methods);
  const fintech = grid.find((r) => r.sector === 'Fintech').cells.find((c) => c.stage === 'seed');
  assert.deepEqual([fintech.template, fintech.changed, fintech.by], ['Metrics grid', true, NOT_RECORDED]);
  const b2b = grid.find((r) => r.sector === 'B2B software').cells.find((c) => c.stage === 'pre_seed');
  assert.deepEqual([b2b.template, b2b.changed], ['The engine’s own pick', false]);
  const withDefaults = templateGrid({ overrides: [], defaults: [{ sector: 'B2B software', stage: 'pre_seed', method_id: 'yc_seed' }] }, methods);
  assert.equal(withDefaults[0].cells[0].template, 'Problem-first', 'K4\'s defaults are named once the reply carries them');
  assert.deepEqual(offGridOverrides(reply).map((o) => o.sector), ['Gaming'], 'an override outside the grid is listed, never hidden');
  assert.match(PAGE, />Only the Super Admin changes a default template\.</);
  assert.deepEqual([fintech.methodId, b2b.methodId, withDefaults[0].cells[0].methodId], ['series_a_growth', null, 'yc_seed'], 'a cell carries the template it starts on, for its sheet');
});

test('HD4: the grid draws the same six sectors and four stages the Worker\'s defaults cover', () => {
  const engine = readFileSync(new URL('../../cloudflare-worker/src/services/decks/recommend.ts', import.meta.url), 'utf8');
  const list = (m) => JSON.parse(m[1].replace(/'/g, '"'));
  assert.deepEqual(list(engine.match(/export const GRID_SECTORS = (\[[^\]]*\])/)), SECTORS);
  assert.deepEqual(list(engine.match(/export const GRID_STAGES = (\[[^\]]*\])/)), STAGES.map((s) => s.id));
});

test('HD4b: Save needs a different template and a reason; Reset needs a reason; the preview names the slides', () => {
  const ok = 'Synthetic: lead with traction.';
  assert.equal(templateChangeArmed({ methodId: 'yc_seed', current: 'sequoia_classic', reason: ok }), true);
  assert.equal(templateChangeArmed({ methodId: 'yc_seed', current: 'yc_seed', reason: ok }), false, 'the cell\'s own template is no change');
  assert.equal(templateChangeArmed({ methodId: '', current: 'yc_seed', reason: ok }), false);
  assert.equal(templateChangeArmed({ methodId: 'yc_seed', current: null, reason: 'too short' }), false);
  assert.equal(templateResetArmed({ reason: ok }), true);
  assert.equal(templateResetArmed({ reason: '  nine ch  ' }), false);
  const methods = [{ id: 'yc_seed', label: 'Problem-first', best_for: 'Pre-seed', slides: [{ title: 'Problem' }, { title: ' ' }, { title: 'Solution' }] }];
  assert.deepEqual(templatePreview(methods, 'yc_seed'), { id: 'yc_seed', name: 'Problem-first', bestFor: 'Pre-seed', slides: ['Problem', 'Solution'] });
  assert.deepEqual(templatePreview(methods, 'gone'), { id: 'gone', name: 'gone', bestFor: null, slides: [] });
});

test('HD4b/HD6c: only the Super Admin is offered Change and the sheet; anyone else reads the grid', () => {
  const templates = PAGE.slice(PAGE.indexOf('function Templates('), PAGE.indexOf('// ── HD5'));
  assert.match(templates, /\{superAdmin && \(\s*<div className="mt-1 flex gap-1\.5">/, 'Change is drawn for the Super Admin only');
  assert.match(templates, /\{superAdmin && openCell && \(/, 'the sheet opens for the Super Admin only');
  assert.match(templates, /\{!superAdmin && <p[^>]*data-testid="deck-templates-why">Only the Super Admin changes a default template\.<\/p>\}/);
  const sheet = PAGE.slice(PAGE.indexOf('function TemplateSheet('), PAGE.indexOf('function Templates('));
  assert.match(sheet, /api\.deckSetRecommendOverride\(\{ sector, stage: cell\.stage, method_id: methodId, reason: reason\.trim\(\) \}\)/);
  assert.match(sheet, /api\.deckResetRecommendOverride\(\{ sector, stage: cell\.stage, reason: reason\.trim\(\) \}\)/);
  assert.match(sheet, /disabled=\{busy \|\| !templateChangeArmed\(\{ methodId, current: cell\.methodId, reason \}\)\}/);
  assert.match(sheet, /disabled=\{busy \|\| !templateResetArmed\(\{ reason \}\)\}/);
});

test('the reset client sends its reason in the body, never the URL', async () => {
  const API = read('lib/api.js');
  const reset = API.slice(API.indexOf('deckResetRecommendOverride:'), API.indexOf('deckRevokeShare:'));
  assert.match(reset, /method: 'DELETE', body: JSON\.stringify\(\{ reason \}\)/);
  const url = reset.match(/`([^`]*)`/)[1];
  assert.match(url, /^\/decks\/admin\/recommend-overrides\?sector=/);
  assert.doesNotMatch(url, /reason/, 'the URL carries sector and stage only');
});

test('the page writes only Resolve, the default templates and the stage norms, reads only mounted routes, and never shows an email', () => {
  const calls = [...PAGE.matchAll(/\b(deckReportsApi|adminFeatureFlagsApi|hqDeckStageNormsApi|api)\.(\w+)\(/g)].map((m) => `${m[1]}.${m[2]}`);
  assert.deepEqual([...new Set(calls)].sort(), ['adminFeatureFlagsApi.list', 'api.deckMethods', 'api.deckRecommendOverrides', 'api.deckResetRecommendOverride', 'api.deckSetRecommendOverride',
    'deckReportsApi.queue', 'deckReportsApi.resolve',
    'hqDeckStageNormsApi.add', 'hqDeckStageNormsApi.edit', 'hqDeckStageNormsApi.list', 'hqDeckStageNormsApi.projectNorms', 'hqDeckStageNormsApi.retire']);
  assert.doesNotMatch(PAGE, /\.email\b/);
  assert.doesNotMatch(PAGE.replace(/NORM_RULE/g, ''), /\badvis(or|e)\b/i);
  assert.equal(reasonOk('ten chars!'), true);
  assert.equal(reasonOk('   short  '), false);
});
