/**
 * D1259 (#3282, part 6 of #2428) — SC13, HQ › Scoring: model versions and
 * Publish, the country index sources and their import. Mounted on a stubbed
 * `fetch`, so every read and write goes through the real client to a URL.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_scoring_d1259.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import HqScoringPage from '../src/pages/scoring/HqScoringPage.jsx';
import { changeCell, editionLine, licenceLine, parseCodes, publishLines, versionRow } from '../src/pages/scoring/hqScoringModel.js';

const h = React.createElement;
const SUPER = { id: 901, role: 'admin', is_super_admin: 1, name: 'Synthetic holder' };
const ADMIN = { id: 902, role: 'admin', is_super_admin: 0, name: 'Synthetic admin' };

const MODELS = {
  live: '1.0',
  draft: { version: '1.1', ventures: 412, minutes: 17, changes: [
    { scope: 'geographic', scope_label: 'Geographic', input: 'Country environment', reads: 'The World Bank governance percentile ranks…',
      from: { weight: 60, source: null, freshness: 'quarter' }, to: { weight: 60, source: 'country_index_values (World Bank WGI)', freshness: 'records' } },
  ] },
  versions: [
    { version: '1.1', state: 'draft', default_live: false, published_at: null, published_by: null, ventures_scored: 0, recompute: null },
    { version: '1.0', state: 'live', default_live: true, published_at: null, published_by: null, ventures_scored: 380, recompute: null },
  ],
};
const INDICES = { sources: [
  { key: 'wgi', name: 'Worldwide Governance Indicators', publisher: 'World Bank', kind: 'values', licence: 'CC BY 4.0', licence_note: 'x', licence_decision: 'D1259',
    indicators: { 'GE.PER.RNK': 'Government effectiveness' },
    editions: [{ edition: '2024', published_on: '2025-09-30', value_count: 600, countries: 150, imported_at: '2026-10-26', read: true }] },
  { key: 'fatf', name: 'High-risk and other monitored jurisdictions', publisher: 'FATF', kind: 'list', licence: null, licence_note: 'Not recorded. The owner decides.', licence_decision: 'D1259',
    indicators: { call_for_action: 'Call for action' }, editions: [] },
  { key: 'eu_high_risk', name: 'High-risk third countries', publisher: 'European Commission', kind: 'list', licence: 'EU reuse', licence_note: 'y', licence_decision: 'D1259',
    indicators: { listed: 'Named on the EU list' }, editions: [] },
] };

async function mount({ user = SUPER, models = MODELS, indices = INDICES, publish, importIndex } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (u, init = {}) => {
    const path = new URL(String(u), 'http://x').pathname;
    calls.push({ method: init.method || 'GET', path, body: init.body ? JSON.parse(init.body) : null });
    if (path.endsWith('/auth/me')) return json(user);
    if (path === '/api/client-error') return json({});
    if (path === '/api/venture-scores/hq/models') return typeof models === 'function' ? models() : json(models);
    if (path === '/api/venture-scores/hq/indices') return typeof indices === 'function' ? indices() : json(indices);
    if (path === '/api/venture-scores/models/1.1/publish') return publish ? publish() : json({ ok: true, version: '1.1', ventures_total: 412 });
    if (path.startsWith('/api/venture-scores/hq/indices/') && path.endsWith('/import')) return importIndex ? importIndex() : json({ ok: true, edition: '2025-1', countries: 2, value_count: 2 });
    return json({ detail: 'Not found' }, 404);
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = () => {}; n.children = []; return n; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/admin/platform/scoring'] }, h(AuthProvider, null, h(HqScoringPage)))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    calls, by, props, has: (id) => Boolean(by(id)),
    of: (id) => { const n = by(id); assert.ok(n, `no ${id}`); return text(n).replace(/\s+/g, ' ').trim(); },
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); assert.ok(!props(n).disabled, `${id} is disabled`); await act(async () => { await props(n).onClick?.({ preventDefault() {} }); }); await flush(); },
    async type(id, value) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => props(n).onChange({ target: { value } })); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

// ── The words ────────────────────────────────────────────────────────────────

test('the words: a version with no publication says so; a source with no licence says it is not read', () => {
  assert.deepEqual(versionRow(MODELS.versions[1]), { version: 'v1.0', state: 'Live', date: 'Scoring since part 2', by: 'No publication recorded', ventures: '380', progress: null });
  assert.deepEqual(versionRow(MODELS.versions[0]).date, 'Not published');
  const running = versionRow({ version: '1.1', state: 'live', published_at: '2026-10-26T10:00:00Z', published_by: 'Synthetic holder', ventures_scored: 40,
    recompute: { total: 412, done: 50, failed: 2, finished_at: null } });
  assert.equal(running.date, '26 Oct 2026');
  assert.equal(running.progress, 'Recomputing: 50 of 412 ventures, 2 could not be scored.');
  assert.equal(changeCell(null), 'Not in this version');
  assert.equal(changeCell({ weight: 60, source: null, freshness: 'quarter' }), '60% · No source · fresh for 120 days');
  assert.match(publishLines(MODELS.draft)[0], /^412 ventures recompute, about 17 minutes at 25 a minute\.$/);
  assert.equal(licenceLine(INDICES.sources[1]), 'Licence not recorded: not imported or read (D1259)');
  assert.equal(licenceLine(INDICES.sources[0]), 'Licence: CC BY 4.0 (D1259)');
  assert.match(editionLine({ ...INDICES.sources[0].editions[0], read: false }), /not read: imported under a licence no longer recorded$/);
  assert.deepEqual(parseCodes('ir, kp;  IR mm  usa'), { good: ['IR', 'KP', 'MM'], bad: ['USA'] });
});

// ── The page ─────────────────────────────────────────────────────────────────

test('SC13 draws the versions, the draft\'s changes and each source; only the fairness check still waits', async () => {
  const m = await mount();
  try {
    assert.match(m.of('hq-scoring-version-1.0'), /v1\.0 Live Scoring since part 2 No publication recorded 380/);
    assert.match(m.of('hq-scoring-version-1.1'), /v1\.1 Draft Not published/);
    assert.match(m.of('hq-scoring-changes'), /What v ?1\.1 changes · 1 input.*Geographic.*Country environment.*60% · No source · fresh for 120 days.*60% · country_index_values \(World Bank WGI\) · fresh for a year/s);
    assert.match(m.of('hq-scoring-source-wgi'), /World Bank · Worldwide Governance Indicators.*Licence: CC BY 4\.0 \(D1259\).*2024 · published 30 Sep 2025 · 150 countries/s);
    assert.match(m.of('hq-scoring-source-fatf'), /Licence not recorded: not imported or read \(D1259\).*The owner decides\..*No edition is imported\./s);
    assert.match(m.of('hq-scoring-source-eu_high_risk'), /Not recorded: no edition is imported yet\./);
    assert.ok(!m.has('hq-scoring-import-fatf'), 'a source with no recorded licence offers no import');
    assert.ok(m.has('hq-scoring-import-wgi') && m.has('hq-scoring-import-eu_high_risk'));
    assert.ok(m.has('scorecard-wait-fairness'), 'the fairness check is part 3\'s');
    assert.ok(!m.has('scorecard-wait-models') && !m.has('scorecard-wait-indices'));
  } finally { await m.close(); }
});

test('an admin who is not a Super Admin reads both blocks but is offered neither Publish nor Import', async () => {
  const m = await mount({ user: ADMIN });
  try {
    assert.ok(m.has('hq-scoring-version-1.0'));
    assert.ok(!m.has('hq-scoring-publish'));
    assert.ok(!m.has('hq-scoring-import-wgi') && !m.has('hq-scoring-import-eu_high_risk'));
  } finally { await m.close(); }
});

test('each read fails alone, as Unreadable with Try again, never as none', async () => {
  const down = () => new Response(JSON.stringify({ error: 'models_unreadable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  const m = await mount({ models: down });
  try {
    assert.match(m.of('hq-scoring-models-unreadable'), /Unreadable\. The model versions could not be read\. That is not the same as none\. Try again/);
    assert.ok(!m.has('hq-scoring-publish'), 'no Publish without a read draft');
    assert.ok(m.has('hq-scoring-source-wgi'), 'the indices still draw');
  } finally { await m.close(); }
  const n = await mount({ indices: down });
  try {
    assert.ok(n.has('hq-scoring-indices-unreadable'));
    assert.ok(n.has('hq-scoring-version-1.0'), 'the versions still draw');
  } finally { await n.close(); }
});

test('Publish opens an in-page dialog that says what it changes, posts once, and rereads; a refusal stays in the dialog', async () => {
  const m = await mount();
  try {
    await m.click('hq-scoring-publish');
    const dialog = m.of('hq-scoring-publish-dialog');
    assert.match(dialog, /Publish Model v1\.1\?/);
    assert.match(dialog, /412 ventures recompute, about 17 minutes at 25 a minute\..*earlier values stay in its history.*authenticator code/s);
    assert.equal(m.calls.filter((c) => c.method === 'POST').length, 0, 'opening the dialog writes nothing');
    await m.click('hq-scoring-publish-go');
    assert.deepEqual(m.calls.filter((c) => c.method === 'POST').map((c) => c.path), ['/api/venture-scores/models/1.1/publish']);
    assert.match(m.of('hq-scoring-done'), /Model v1\.1 is published/);
    assert.ok(!m.has('hq-scoring-publish-dialog'));
    assert.equal(m.calls.filter((c) => c.path === '/api/venture-scores/hq/models').length, 2, 'the versions are read again');
  } finally { await m.close(); }
  const refused = await mount({ publish: () => new Response(JSON.stringify({ error: 'model_not_newer', message: 'Model v1.1 is already published.' }), { status: 409, headers: { 'Content-Type': 'application/json' } }) });
  try {
    await refused.click('hq-scoring-publish');
    await refused.click('hq-scoring-publish-go');
    assert.match(refused.of('hq-scoring-publish-refusal'), /already published/);
    assert.ok(refused.has('hq-scoring-publish-dialog'));
  } finally { await refused.close(); }
});

test('Import sends the edition and each list\'s codes; a code that is not two letters is refused before any request', async () => {
  const m = await mount();
  try {
    await m.click('hq-scoring-import-eu_high_risk');
    assert.equal(m.props(m.by('hq-scoring-import-go')).disabled, true, 'nothing filled, nothing sent');
    await m.type('hq-scoring-import-edition', '2025-1');
    await m.type('hq-scoring-import-published', '2025-06-10');
    await m.type('hq-scoring-import-list-listed', 'ir kp usa');
    assert.equal(m.props(m.by('hq-scoring-import-go')).disabled, true, 'USA is not a two-letter code');
    assert.match(m.of('hq-scoring-import-dialog'), /Not a two-letter code: USA ?\./);
    await m.type('hq-scoring-import-list-listed', 'ir, kp');
    await m.click('hq-scoring-import-go');
    const post = m.calls.find((c) => c.method === 'POST');
    assert.equal(post.path, '/api/venture-scores/hq/indices/eu_high_risk/import');
    assert.deepEqual(post.body, { edition: '2025-1', published_on: '2025-06-10', countries: { listed: ['IR', 'KP'] } });
    assert.match(m.of('hq-scoring-done'), /European Commission 2025-1 is imported: 2 countries\./);
  } finally { await m.close(); }
  const wgi = await mount();
  try {
    await wgi.click('hq-scoring-import-wgi');
    await wgi.type('hq-scoring-import-edition', '2024');
    await wgi.type('hq-scoring-import-published', '2025-09-30');
    await wgi.click('hq-scoring-import-go');
    assert.deepEqual(wgi.calls.find((c) => c.method === 'POST').body, { edition: '2024', published_on: '2025-09-30' }, 'a fetched source sends no list');
  } finally { await wgi.close(); }
});
