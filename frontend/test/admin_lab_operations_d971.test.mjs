/** D971: mounted tabs against fetch, SQL contracts tested in the Worker suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import AdminLab from '../src/pages/admin/lab/AdminLab.jsx';
import LabHowItRuns from '../src/pages/admin/lab/LabHowItRuns.jsx';
import LabSettings from '../src/pages/admin/lab/LabSettings.jsx';
import LabActivity from '../src/pages/admin/lab/LabActivity.jsx';
import { stamp, sizeProblem, pageOf, supportRows, byWord } from '../src/pages/admin/lab/labOperationsModel.js';

const h = React.createElement;
const catalogue = [{ key: 'purpose', title: 'Purpose', position: 0 }, { key: 'calendar', title: 'The calendar', position: 1 }];
const book = { section_catalogue: catalogue, playbook: { published: true, version: 2, published_at: '2026-11-01 03:30:00', sections: [{ key: 'purpose', title: 'Purpose', body: 'Published purpose' }] }, draft: { sections: [{ key: 'purpose', title: 'Purpose', body: 'HQ draft' }], differs: true, edited_at: '2026-11-02 14:00:00' } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
async function mount(Component, o = {}, props = {}) {
  const original = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, prompt: globalThis.prompt, confirm: globalThis.confirm };
  const restore = installDocument();
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.prompt = globalThis.confirm = () => { throw new Error('Browser popup used'); };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const method = init.method || 'GET';
    calls.push({ method, path: u.pathname, query: u.searchParams, body: init.body ? JSON.parse(init.body) : null });
    const handler = o[`${method} ${u.pathname}`] ?? o[u.pathname];
    if (handler !== undefined) {
      const value = typeof handler === 'function' ? handler(u, init) : handler;
      return value instanceof Response ? value : json(value);
    }
    if (u.pathname === '/api/client-error') return json({});
    if (u.pathname === '/api/admin/programs/spinout-lab') return json(book);
    if (u.pathname === '/api/admin/cohort/settings') return json({ settings: { min: 1, max: 25 } });
    if (u.pathname === '/api/admin/cohort/activity') return json({ items: [], total: 0, coverage: 'History never names an admin.' });
    if (u.pathname === '/api/admin/cohort/impersonation-audit') return json({ sessions: [] });
    if (u.pathname === '/api/admin/program-grants') return json({ licences: [] });
    return json({});
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [props.url || '/admin/programs/spinout-lab'] }, h(Component, props))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
  const p = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => p(n)['data-testid'] === id);
  return { calls, text: () => text(container), has: (id) => !!by(id), props: (id) => p(by(id)),
    of: (id) => { assert.ok(by(id), id); return text(by(id)); },
    async click(id) { const props = p(by(id)); assert.ok(props.onClick, id); assert.ok(!props.disabled, `${id} disabled`); await act(async () => props.onClick({ preventDefault() {}, stopPropagation() {} })); await flush(); },
    async submit(id) { assert.ok(by(id), id); await act(async () => p(by(id)).onSubmit({ preventDefault() {} })); await flush(); },
    async type(id, value) { assert.ok(by(id), id); await act(async () => p(by(id)).onChange({ target: { value } })); await flush(); },
    async clickText(word) { const n = walk(container).find((n) => n.tagName === 'BUTTON' && text(n) === word); assert.ok(n, word); await act(async () => p(n).onClick()); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, original); restore(); },
  };
}

test('ET timestamps include the previous day and DST, sizes reject blank/fraction but preserve zero, pages have ranges', () => {
  assert.match(stamp('2026-11-01 03:30:00'), /31 Oct 2026, 23:30 ET/);
  assert.match(stamp('2026-11-02 04:30:00'), /1 Nov 2026, 23:30 ET/);
  assert.equal(stamp(null), 'Not recorded');
  assert.equal(byWord('unrecorded'), 'Not recorded');
  assert.equal(byWord(null), 'Not recorded');
  assert.equal(sizeProblem('0'), null); assert.equal(sizeProblem('1000'), null);
  for (const v of ['', ' ', '1.5', '-1', '1001', 'foo']) assert.ok(sizeProblem(v));
  assert.deepEqual([pageOf(Array.from({ length: 26 }), 2).from, pageOf(Array.from({ length: 26 }), 2).to], [26, 26]);
  assert.equal(supportRows([{ id: 1, admin_name: 'A', started_at: '2026-11-01 03:30:00' }, { id: 2, target_name: 'B', started_at: '2026-11-02 03:30:00' }], 'B', 'newest')[0].id, 2);
});
test('Admin reads the published playbook, missing sections with a reason, the checklist and tools; no edit controls', async () => {
  const m = await mount(LabHowItRuns);
  try {
    assert.match(m.text(), /Published purpose/); assert.match(m.text(), /HQ writes the playbook/);
    assert.match(m.text(), /Not recorded — HQ has not written this section/);
    assert.match(m.text(), /What you do each month/); assert.match(m.text(), /Admin tools/);
    assert.doesNotMatch(m.text(), /HQ draft/); assert.equal(m.has('lab-playbook-view'), false);
  } finally { await m.close(); }
});
test('Super Admin draft and publish are separate confirmed writes; refusal retains text and closing success rereads', async () => {
  let fail = true;
  const m = await mount(LabHowItRuns, {
    'PUT /api/admin/programs/spinout-lab/playbook/sections/purpose': () => fail ? json({ message: 'The change was refused.' }, 409) : { ok: true },
    'POST /api/admin/programs/spinout-lab/playbook/publish': { ok: true },
  }, { superAdmin: true });
  try {
    assert.doesNotMatch(m.text(), /HQ draft/); await m.click('lab-playbook-view');
    assert.match(m.text(), /HQ draft/); await m.click('lab-playbook-edit-purpose');
    await m.type('lab-playbook-body', 'My changed draft'); await m.click('lab-playbook-dialog-go');
    assert.match(m.of('lab-playbook-dialog-refusal'), /refused/);
    assert.equal(m.props('lab-playbook-body').value, 'My changed draft');
    fail = false; await m.click('lab-playbook-dialog-go');
    assert.equal(m.calls.filter((c) => c.method === 'PUT').at(-1).body.body, 'My changed draft');
    const before = m.calls.filter((c) => c.path.endsWith('/spinout-lab') && c.method === 'GET').length;
    await m.click('lab-playbook-dialog-done');
    assert.ok(m.calls.filter((c) => c.path.endsWith('/spinout-lab') && c.method === 'GET').length > before);
    await m.click('lab-playbook-publish');
    assert.equal(m.calls.filter((c) => c.method === 'POST').length, 0, 'opening dialog is not publishing');
    assert.match(m.of('lab-playbook-dialog'), /new published version/); await m.click('lab-playbook-dialog-go');
    assert.equal(m.calls.filter((c) => c.method === 'POST')[0].path, '/api/admin/programs/spinout-lab/playbook/publish');
  } finally { await m.close(); }
});
test('failed playbook retries without hiding the monthly checklist or granting write access', async () => {
  let fail = true;
  const m = await mount(LabHowItRuns, { '/api/admin/programs/spinout-lab': () => fail ? json({ error: 'failed' }, 503) : book });
  try { assert.match(m.of('lab-playbook-unreadable'), /Unreadable/); assert.match(m.text(), /What you do each month/); fail = false; await m.clickText('Try again'); assert.match(m.text(), /Published purpose/); } finally { await m.close(); }
});
test('Settings confirms only the edited size, blank is disabled, zero survives, refusal stays in dialog; Admin never reads HQ grants', async () => {
  const m = await mount(LabSettings, { 'POST /api/admin/cohort/applications/settings': json({ message: 'The change was refused.' }, 403) });
  try {
    assert.match(m.text(), /Not read here yet.*#2775/);
    assert.equal(m.calls.some((c) => c.path.startsWith('/api/admin/program-grants')), false);
    await m.click('lab-size-edit-min'); assert.match(m.of('lab-size-dialog'), /next capacity check/);
    await m.type('lab-size-value', ''); assert.equal(m.props('lab-size-dialog-go').disabled, true);
    await m.type('lab-size-value', '0'); await m.click('lab-size-dialog-go');
    assert.deepEqual(m.calls.find((c) => c.method === 'POST').body, { min_cohort_size: 0 });
    assert.match(m.of('lab-size-dialog-refusal'), /refused/); assert.equal(m.props('lab-size-value').value, '0');
  } finally { await m.close(); }
});
test('Settings failed size is independent of fixed rules; retry and SA grant selection preserve missing versus zero and off', async () => {
  let fail = true;
  const m = await mount(LabSettings, {
    '/api/admin/cohort/settings': () => fail ? json({ error: 'failed' }, 503) : { settings: { min: 0, max: 25 } },
    '/api/admin/program-grants': { licences: [{ uid: 'lic-one', brand_name: 'Synthetic studio', grants: { 'spinout-lab': { state: 'granted', terms: { cohorts_per_year: 0, hq_approves_each_cohort: 0, capacity_cap: null } } } }] },
  }, { superAdmin: true });
  try {
    assert.match(m.of('lab-size-unreadable'), /Unreadable/); assert.match(m.text(), /America\/New_York/);
    assert.match(m.text(), /HQ-held accounts have no subsidiary grant/);
    await m.type('lab-grant-studio', 'lic-one'); assert.match(m.of('lab-grant-terms'), /Cohorts a year0/); assert.match(m.of('lab-grant-terms'), /Off/); assert.match(m.of('lab-grant-terms'), /Not recorded — HQ has not set this term/);
    fail = false; await m.clickText('Try again'); assert.equal(m.of('lab-size-min'), '0');
  } finally { await m.close(); }
});
test('Activity sends type, cohort, actor, literal search and sort to the Worker; pages reset on filters; Admin makes no support read', async () => {
  const m = await mount(LabActivity, { '/api/admin/cohort/activity': (u) => ({ total: 26, items: [{ id: String(u.searchParams.get('offset')), at: '2026-11-01 03:30:00', event: 'applicant_approved', cohort: '2026-11', about: 'Synthetic founder', by: 'admin', detail: 'Recorded event' }], coverage: 'History never names an admin.' }) });
  try {
    assert.match(m.text(), /Application approved/); assert.match(m.text(), /31 Oct 2026, 23:30 ET/); assert.match(m.text(), /A Super Admin reads every admin/);
    assert.equal(m.calls.some((c) => c.path.includes('impersonation')), false);
    await m.clickText('Next'); assert.equal(m.calls.at(-1).query.get('offset'), '25');
    for (const [id, value] of [['type', 'decisions'], ['cohort', '2026-11'], ['by', 'admin'], ['sort', 'oldest']]) await m.type('lab-activity-' + id, value);
    const beforeSearch = m.calls.filter((c) => c.path.endsWith('/activity')).length;
    await m.type('lab-activity-search', 'Fay %');
    assert.equal(m.calls.filter((c) => c.path.endsWith('/activity')).length, beforeSearch, 'typing does not query D1');
    await m.submit('lab-activity-search-form');
    const q = m.calls.filter((c) => c.path.endsWith('/activity')).at(-1).query;
    assert.deepEqual([q.get('type'), q.get('cohort'), q.get('by'), q.get('q'), q.get('sort'), q.get('offset')], ['decisions', '2026-11', 'admin', 'Fay %', 'oldest', '0']);
  } finally { await m.close(); }
});
test('failed Activity and successful support sessions are independent; support search, sort and pages cover the stated 100-row read', async () => {
  let fail = true;
  const m = await mount(LabActivity, {
    '/api/admin/cohort/activity': () => fail ? json({ error: 'failed' }, 503) : { total: 0, items: [], coverage: 'History never names an admin.' },
    '/api/admin/cohort/impersonation-audit': { sessions: Array.from({ length: 26 }, (_, i) => ({ id: i, admin_name: 'Admin Z', target_name: `Person ${i}`, reason: 'Synthetic support reason', started_at: `2026-11-${String(i + 1).padStart(2, '0')} 14:00:00`, ended_at: null, target_email: 'must-not-render@example.test' })) },
  }, { superAdmin: true });
  try {
    assert.match(m.of('lab-activity-log-unreadable'), /Unreadable/); assert.match(m.of('lab-support-sessions'), /Admin Z/); assert.match(m.text(), /newest 100/); assert.doesNotMatch(m.text(), /must-not-render/);
    assert.match(m.of('lab-support-pages'), /1–25 of 26/); await m.clickText('Next'); assert.match(m.of('lab-support-pages'), /26–26 of 26/);
    await m.type('lab-support-search', 'Person 2'); assert.match(m.of('lab-support-pages'), /1–7 of 7/);
    fail = false; await m.clickText('Try again'); assert.match(m.text(), /No recorded events match/);
  } finally { await m.close(); }
});
test('support failure does not erase a successful log, and retries independently', async () => {
  const m = await mount(LabActivity, { '/api/admin/cohort/impersonation-audit': json({ error: 'failed' }, 503) }, { superAdmin: true });
  try { assert.match(m.of('lab-support-unreadable'), /Unreadable/); assert.match(m.text(), /No recorded events match/); assert.doesNotMatch(m.text(), /No recorded support sessions/); } finally { await m.close(); }
});
test('all three literal routes mount their tabs inside AdminLab, with their HeaderTab doors', async () => {
  for (const [path, id] of [['how-it-runs', 'lab-how-it-runs'], ['settings', 'lab-settings'], ['activity', 'lab-activity']]) {
    const m = await mount(AdminLab, {}, { url: '/admin/programs/spinout-lab/' + path });
    try { assert.ok(m.has(id)); assert.ok(m.has('lab-tab-' + path)); } finally { await m.close(); }
  }
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  for (const path of ['how-it-runs', 'settings', 'activity']) assert.ok(app.includes(`path="/admin/programs/spinout-lab/${path}"`));
});

test('Places confirms its effects, sends only max, and rereads after success; missing successful reads are unreadable', async () => {
  let max = 25;
  const m = await mount(LabSettings, {
    '/api/admin/cohort/settings': () => ({ settings: { min: 1, max } }),
    'POST /api/admin/cohort/applications/settings': (_u, init) => { max = JSON.parse(init.body).max_cohort_size; return { ok: true }; },
  });
  try {
    await m.click('lab-size-edit-max'); assert.match(m.of('lab-size-dialog'), /Existing approvals stay approved/);
    await m.type('lab-size-value', '30'); await m.click('lab-size-dialog-go');
    assert.deepEqual(m.calls.find((c) => c.method === 'POST').body, { max_cohort_size: 30 });
    await m.click('lab-size-dialog-done'); assert.equal(m.of('lab-size-max'), '30');
  } finally { await m.close(); }
  for (const [Component, endpoint, id] of [[LabHowItRuns, '/api/admin/programs/spinout-lab', 'lab-playbook'], [LabSettings, '/api/admin/cohort/settings', 'lab-size'], [LabActivity, '/api/admin/cohort/activity', 'lab-activity-log']]) {
    const n = await mount(Component, { [endpoint]: {} });
    try { assert.match(n.of(id + '-unreadable'), /Unreadable/); assert.match(n.text(), /Try again/); } finally { await n.close(); }
  }
});
test('Super Admin grant failure is independent of operative size and does not turn into an absent grant', async () => {
  const m = await mount(LabSettings, { '/api/admin/program-grants': json({ error: 'failed' }, 503) }, { superAdmin: true });
  try { assert.match(m.of('lab-grants-unreadable'), /Unreadable/); assert.equal(m.of('lab-size-max'), '25'); assert.doesNotMatch(m.text(), /this studio has no Spin-Out Lab grant/); } finally { await m.close(); }
});

test('an invalid negative size in a successful response is unreadable, never drawn as an operative value', async () => {
  const m = await mount(LabSettings, { '/api/admin/cohort/settings': { settings: { min: -1, max: 25 } } });
  try { assert.match(m.of('lab-size-unreadable'), /Unreadable/); assert.equal(m.has('lab-size-edit-min'), false); } finally { await m.close(); }
});
