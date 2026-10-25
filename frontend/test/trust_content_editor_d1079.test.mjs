/**
 * D1079 (#2971) — HQ › Security › Trust center content (TRU14) and its
 * Publish dialog (TRU14d), on D1075's routes.
 *
 *   - the pure model (`trustContentModel.js`) on reads shaped as the Worker
 *     sends them;
 *   - the page mounted on a stubbed `fetch`, through the real client: the
 *     blocks list, a draft saved, a gap refused before it is sent, the
 *     subprocessor table and its dialog, the Publish dialog shut until the
 *     note is long enough, the Worker's own refusal said in it, a failed read;
 *   - the source: the route is Super Admin only, and SECURITY.md and
 *     security.txt keep only what the platform does.
 *
 * What the Worker refuses (a short note, a non-Super Admin, a stale step-up)
 * is tested on the real routes in cloudflare-worker/test/trust_content_d1075.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/trust_content_editor_d1079.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import TrustContentPage from '../src/pages/hq/TrustContentPage.jsx';
import {
  REFUSALS, activeFrom, blockRows, certificationProblem, linesPayload, linesProblem, noteState, pendingChanges, publishLine,
  publishedLine, refusalText, startBody, subprocessorRow, subprocessorRows,
} from '../src/pages/hq/trustContentModel.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const TC = '/api/admin/security/trust-center';

const LINES = (o = {}) => ({ intro: 'Facts we can show.', groups: [{ title: 'Sign-in', lines: [{ text: 'Every admin signs in with TOTP.', recorded: true, why: null, checked_at: '2026-10-14' }, { text: 'Penetration test', recorded: false, why: 'None has been run yet.', checked_at: null }] }], ...o });
const BLOCK = (key, label, o = {}) => ({ key, label, published: null, draft: null, ...o });
const READ = (o = {}) => ({
  blocks: [
    BLOCK('glance', 'At a glance', { published: { body: LINES(), checked_at: '2026-10-14', published_at: '2026-10-14T09:00:00.000Z', updated_at: '2026-10-14 09:00:00' } }),
    BLOCK('security', 'Security', { published: { body: LINES(), checked_at: '2026-08-14', published_at: '2026-08-14T09:00:00.000Z' }, draft: { body: LINES({ intro: 'Draft words.' }), checked_at: '2026-10-20', updated_at: '2026-10-20 10:00:00' } }),
    BLOCK('data', 'Data and privacy'),
    BLOCK('subprocessors', 'Subprocessors'),
    BLOCK('certifications', 'Certifications', { published: { body: { items: [] }, checked_at: null, published_at: '2026-09-02T09:00:00.000Z' } }),
    BLOCK('documents', 'Documents'),
    BLOCK('disclosure', 'Disclosure'),
  ],
  subprocessors: [
    { uid: 'tsp_00000000000000000001', name: 'Fixture Hosting', purpose: 'Hosting', data: 'Everything stored', location: 'United States', state: 'published', starts_at: '2026-09-02', published_at: '2026-09-02T09:00:00.000Z', removed_at: null },
    { uid: 'tsp_00000000000000000002', name: 'Fixture Errors', purpose: 'Error monitoring', data: 'Error reports, with no names or emails', location: 'United States', state: 'draft', starts_at: null, published_at: null, removed_at: null },
    { uid: 'tsp_00000000000000000003', name: 'Fixture Old Mail', purpose: 'Email', data: 'Email addresses', location: 'Ireland', state: 'removed', starts_at: '2026-01-01', published_at: '2026-01-01T09:00:00.000Z', removed_at: '2026-09-02T09:00:00.000Z' },
  ],
  reports: [],
  changes: { items: [{ uid: 'tcc_00000000000000000001', published_at: '2026-10-14T09:00:00.000Z', note: 'At a glance: the sign-in line restated.', blocks: [{ key: 'glance', label: 'At a glance' }], subprocessors: [] }], complete: true },
  subscribers: { confirmed: 3, pending: 1, unsubscribed: 0 },
  ...o,
});

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the blocks list: last published day, never published, a draft, and Certifications with none held', () => {
  const rows = blockRows(READ().blocks);
  assert.deepEqual(rows.map((r) => [r.key, publishedLine(r), r.hasDraft]), [
    ['glance', 'Last published 2026-10-14', false],
    ['security', 'Last published 2026-08-14', true],
    ['data', 'Never published', false],
    ['subprocessors', 'Never published', false],
    ['certifications', 'Last published 2026-09-02 · none held', false],
    ['documents', 'Never published', false],
    ['disclosure', 'Never published', false],
  ]);
  assert.deepEqual(blockRows(null), []);
});

test('the editor opens on the draft, else the published copy, else an empty block', () => {
  const [glance, security, data] = READ().blocks;
  assert.equal(startBody(security).intro, 'Draft words.');
  assert.equal(startBody(glance).intro, 'Facts we can show.');
  assert.deepEqual(startBody(data), { intro: '', groups: [] });
  assert.deepEqual(startBody(BLOCK('certifications', 'Certifications')), { items: [] });
});

test('a line needs its words, and a gap needs its reason; the payload drops a gap\'s date and a fact\'s reason', () => {
  const body = { intro: ' ', groups: [{ title: '', lines: [{ text: ' A fact ', recorded: true, why: 'stale', checked_at: '2026-10-01' }, { text: 'A gap', recorded: false, why: ' Not run ', checked_at: '2026-10-01' }] }] };
  assert.equal(linesProblem(body), null);
  assert.deepEqual(linesPayload(body), { intro: null, groups: [{ title: null, lines: [
    { text: 'A fact', recorded: true, why: null, checked_at: '2026-10-01' },
    { text: 'A gap', recorded: false, why: 'Not run', checked_at: null },
  ] }] });
  assert.equal(linesProblem({ groups: [{ lines: [{ text: '  ', recorded: true }] }] }), REFUSALS.text_required);
  assert.equal(linesProblem({ groups: [{ lines: [{ text: 'A gap', recorded: false, why: ' ' }] }] }), REFUSALS.why_required);
  assert.equal(linesProblem({ groups: [{ lines: [{ text: 'x'.repeat(501), recorded: true }] }] }), REFUSALS.text_too_long);
});

test('a certification needs its name, auditor, issue day and its report on file', () => {
  const c = { name: 'Fixture standard', auditor: 'Fixture Audit LLP', issued_on: '2026-06-01', report_uid: 'tcr_00000000000000000001' };
  assert.equal(certificationProblem(c), null);
  assert.equal(certificationProblem({ ...c, report_uid: '' }), REFUSALS.report_required);
  assert.equal(certificationProblem({ ...c, auditor: ' ' }), REFUSALS.certification_fields);
  assert.equal(certificationProblem({ ...c, issued_on: '' }), REFUSALS.certification_fields);
});

test('subprocessors: each state\'s actions; a removed one is off the table', () => {
  const rows = subprocessorRows(READ().subprocessors);
  assert.deepEqual(rows.map((r) => [r.name, r.stateLabel, r.actions, r.since]), [
    ['Fixture Hosting', 'Listed', ['remove'], 'From 2026-09-02'],
    ['Fixture Errors', 'Draft', ['edit', 'delete'], '10 days after you publish'],
  ]);
  assert.deepEqual(subprocessorRow({ state: 'removing', starts_at: null }).actions, ['keep']);
  assert.equal(subprocessorRow({ state: 'published', starts_at: null }).since, 'Not recorded');
});

test('Publish: what changes, counting Subprocessors once; who is emailed; when a new one is active', () => {
  const p = pendingChanges(READ());
  assert.deepEqual(p.blocks.map((b) => b.key), ['security']);
  assert.deepEqual(p.added.map((s) => s.name), ['Fixture Errors']);
  assert.equal(p.count, 2);
  assert.equal(p.any, true);
  assert.equal(publishLine(p, 3), '2 blocks change. 3 confirmed subscribers are emailed about the new subprocessor.');
  assert.equal(publishLine(p, 0), '2 blocks change. No one has subscribed to subprocessor changes yet, so no one is emailed.');
  assert.equal(publishLine(p, null), '2 blocks change. Confirmed subprocessor subscribers are emailed.');
  const blocksOnly = pendingChanges(READ({ subprocessors: [] }));
  assert.equal(publishLine(blocksOnly, 3), '1 block changes.');
  assert.equal(pendingChanges(READ({ blocks: [], subprocessors: [] })).any, false);
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.equal(activeFrom(null, now), '2026-10-24');
  assert.equal(activeFrom('2026-10-20', now), '2026-10-24', 'an earlier day moves to ten days after Publish');
  assert.equal(activeFrom('2026-11-30', now), '2026-11-30');
});

test('the note: 10 to 1000 characters, trimmed; a refusal is words, never a code', () => {
  assert.equal(noteState('  short   ').ok, false);
  assert.equal(noteState('exactly10!').ok, true);
  assert.equal(noteState('x'.repeat(1001)).ok, false);
  assert.equal(noteState('x'.repeat(1000)).ok, true);
  assert.equal(refusalText({ message: 'note_required', code: 'note_required' }), REFUSALS.note_required);
  assert.equal(refusalText({ message: 'The Worker said this.' }), 'The Worker said this.');
  assert.match(refusalText({ message: 'step_up_cancelled' }), /Nothing changed/, 'a bare code is never shown');
  assert.match(refusalText({ message: 'HTTP 500' }), /Nothing changed/);
});

/* ------------------------------------------------------------------ *
 * Mounted on a stubbed Worker
 * ------------------------------------------------------------------ */

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function worker({ content = READ(), writes = {} } = {}) {
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const method = String(init.method || 'GET').toUpperCase();
    seen.push({ method, path: u.pathname, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body ? 'binary' : null });
    if (u.pathname === TC && method === 'GET') return typeof content === 'function' ? content() : json(content);
    if (u.pathname === `${TC}/publish`) return writes.publish ? writes.publish(JSON.parse(init.body)) : json({ ok: true });
    if (/\/blocks\/[a-z]+$/.test(u.pathname)) return writes.save ? writes.save() : json({ ok: true });
    if (u.pathname === `${TC}/subprocessors`) return json({ ok: true, uid: 'tsp_00000000000000000009', state: 'draft' }, 201);
    if (u.pathname === `${TC}/reports`) return json({ ok: true, uid: 'tcr_00000000000000000001', size_bytes: 6 }, 201);
    return json({ ok: true });
  };
  return seen;
}

async function mount(w) {
  const restore = installDocument();
  const seen = worker(w);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/admin/security/trust-center'] }, h(TrustContentPage))); });
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  return {
    seen, flush,
    has: (id) => Boolean(byId(id)),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    props: (id) => props(byId(id)) || {},
    async click(id) { const p = props(byId(id)); assert.ok(p?.onClick, `no ${id} to click`); await act(async () => { await p.onClick({ preventDefault() {} }); }); await flush(); },
    async type(id, value) { const p = props(byId(id)); assert.ok(p?.onChange, `no ${id} to type in`); await act(async () => { p.onChange({ target: { value, checked: value } }); }); await flush(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
const writes = (seen) => seen.filter((s) => s.method !== 'GET');

test('mounted TRU14: the header, the seven blocks with their drafts, the table and the change log; nothing is written by reading', async () => {
  const m = await mount();
  try {
    assert.match(m.of('trust-content-header'), /Trust center content/);
    assert.match(m.of('trust-content-header'), /Visitors see a change only after you publish it\./);
    assert.match(m.of('trust-content-block-security'), /Last published 2026-08-14.*Draft/);
    assert.match(m.of('trust-content-block-data'), /Never published/);
    assert.match(m.of('trust-content-block-certifications'), /none held/);
    assert.ok(m.has('trust-content-sub-tsp_00000000000000000001'));
    assert.match(m.of('trust-content-sub-tsp_00000000000000000002'), /Fixture Errors.*Draft/);
    assert.equal(m.has('trust-content-sub-tsp_00000000000000000003'), false, 'a removed subprocessor is history');
    assert.match(m.of('trust-content-changes'), /At a glance: the sign-in line restated\./);
    assert.deepEqual(writes(m.seen), []);
  } finally { await m.unmount(); }
});

test('editing a block: the draft is saved as the Worker takes it; a gap without its reason is refused before it is sent', async () => {
  const m = await mount();
  try {
    await m.click('trust-content-block-security');
    assert.match(m.of('trust-content-editor-security'), /You are editing the draft/);
    await m.type('trust-content-gap-0-0', true);
    await m.click('trust-content-save');
    assert.equal(m.of('trust-content-save-error'), REFUSALS.why_required);
    assert.deepEqual(writes(m.seen), [], 'nothing is sent while the reason is missing');
    await m.type('trust-content-why-0-0', 'Not checked since the move.');
    await m.click('trust-content-save');
    const put = writes(m.seen).at(-1);
    assert.equal(put.method, 'PUT');
    assert.equal(put.path, `${TC}/blocks/security`);
    assert.deepEqual(put.body.body.groups[0].lines[0], { text: 'Every admin signs in with TOTP.', recorded: false, why: 'Not checked since the move.', checked_at: null });
    assert.equal(put.body.checked_at, '2026-10-20');
    assert.match(m.of('trust-content-notice'), /Security: the draft is saved\. Visitors see it after you publish\./);
  } finally { await m.unmount(); }
});

test('the Worker\'s refusal of a draft is said in its words, and nothing is claimed saved', async () => {
  const m = await mount({ writes: { save: () => json({ error: 'bad_checked_at', code: 'bad_checked_at', message: 'A checked date is a real day, written YYYY-MM-DD, and not in the future.' }, 400) } });
  try {
    await m.click('trust-content-block-glance');
    await m.click('trust-content-save');
    assert.equal(m.of('trust-content-save-error'), 'A checked date is a real day, written YYYY-MM-DD, and not in the future.');
    assert.equal(m.has('trust-content-notice'), false);
  } finally { await m.unmount(); }
});

test('Certifications: Add stays shut until the report is on file; the draft carries the report\'s uid', async () => {
  const m = await mount();
  try {
    await m.click('trust-content-block-certifications');
    assert.match(m.of('trust-content-none-held'), /None held/);
    await m.type('trust-content-cert-name', 'Fixture standard');
    await m.type('trust-content-cert-auditor', 'Fixture Audit LLP');
    await m.type('trust-content-cert-issued', '2026-06-01');
    assert.equal(m.props('trust-content-cert-add').disabled, true, 'no report, no Add');
    const pdf = new Uint8Array([37, 80, 68, 70, 45, 49]);
    await act(async () => { await m.props('trust-content-cert-report').onChange({ target: { files: [{ arrayBuffer: async () => pdf.buffer }] } }); });
    await m.flush();
    assert.equal(m.seen.filter((s) => s.path === `${TC}/reports`).length, 1);
    assert.match(m.of('trust-content-cert-report-state'), /The report is on file\./);
    assert.equal(m.props('trust-content-cert-add').disabled, false);
    await m.click('trust-content-cert-add');
    assert.match(m.of('trust-content-cert-0'), /Fixture standard · Fixture Audit LLP · issued 2026-06-01 · report on file/);
    await m.click('trust-content-save');
    const put = writes(m.seen).at(-1);
    assert.equal(put.path, `${TC}/blocks/certifications`);
    assert.deepEqual(put.body.body, { items: [{ name: 'Fixture standard', auditor: 'Fixture Audit LLP', issued_on: '2026-06-01', expires_on: null, report_uid: 'tcr_00000000000000000001' }] });
  } finally { await m.unmount(); }
});

test('a subprocessor: added through its dialog as a draft; removing a listed one asks first and says it stays listed until Publish', async () => {
  const m = await mount();
  try {
    await m.click('trust-content-sub-add');
    assert.match(m.of('trust-content-sub-dialog'), /a draft until you publish/);
    assert.equal(m.props('trust-content-sub-save').disabled, true);
    for (const [k, v] of [['name', 'Fixture Search'], ['purpose', 'Search'], ['data', 'Search terms'], ['location', 'Germany']]) await m.type(`trust-content-sub-${k}`, v);
    await m.click('trust-content-sub-save');
    assert.deepEqual(writes(m.seen).at(-1), { method: 'POST', path: `${TC}/subprocessors`, body: { name: 'Fixture Search', purpose: 'Search', data: 'Search terms', location: 'Germany', starts_at: null } });
    await m.click('trust-content-sub-remove-tsp_00000000000000000001');
    assert.match(m.of('trust-content-confirm'), /stays listed until you publish/);
    assert.equal(writes(m.seen).length, 1, 'nothing is removed before the confirm');
    await m.click('trust-content-confirm-go');
    assert.deepEqual(writes(m.seen).at(-1), { method: 'DELETE', path: `${TC}/subprocessors/tsp_00000000000000000001`, body: null });
  } finally { await m.unmount(); }
});

test('TRU14d: it names what changes; Publish is shut until the note is long enough; the note is sent trimmed', async () => {
  const m = await mount();
  try {
    await m.click('trust-content-publish');
    assert.match(m.of('trust-content-publish-dialog'), /2 blocks change\. 3 confirmed subscribers are emailed/);
    assert.match(m.of('trust-content-publish-list'), /Security · the draft goes live/);
    assert.match(m.of('trust-content-publish-list'), /Fixture Errors added, active from \d{4}-\d{2}-\d{2}/);
    assert.equal(m.props('trust-content-publish-go').disabled, true, 'no note, no Publish');
    await m.type('trust-content-note', 'too short');
    assert.equal(m.props('trust-content-publish-go').disabled, true);
    assert.match(m.of('trust-content-note-hint'), /At least 10 characters\. 9 so far\./);
    assert.equal(writes(m.seen).length, 0);
    await m.type('trust-content-note', '  Security: the sign-in line restated.  ');
    await m.click('trust-content-publish-go');
    assert.deepEqual(writes(m.seen), [{ method: 'POST', path: `${TC}/publish`, body: { note: 'Security: the sign-in line restated.' } }]);
    assert.equal(m.has('trust-content-publish-dialog'), false);
    assert.match(m.of('trust-content-notice'), /Published\./);
  } finally { await m.unmount(); }
});

test('TRU14d: the Worker refusing the note is said in the dialog, which stays open', async () => {
  const m = await mount({ writes: { publish: () => json({ error: 'note_required', code: 'note_required', message: REFUSALS.note_required }, 400) } });
  try {
    await m.click('trust-content-publish');
    await m.type('trust-content-note', 'A note the Worker refuses.');
    await m.click('trust-content-publish-go');
    assert.equal(m.of('trust-content-publish-error'), REFUSALS.note_required);
    assert.ok(m.has('trust-content-publish-dialog'));
    assert.equal(m.has('trust-content-notice'), false);
  } finally { await m.unmount(); }
});

test('nothing drafted: Publish changes is shut', async () => {
  const m = await mount({ content: READ({ blocks: READ().blocks.map((b) => ({ ...b, draft: null })), subprocessors: [] }) });
  try {
    assert.equal(m.props('trust-content-publish').disabled, true);
    assert.match(m.of('trust-content-sub-empty'), /No subprocessor/);
  } finally { await m.unmount(); }
});

test('a read that fails is Unreadable with Try again, never an empty editor', async () => {
  let calls = 0;
  const m = await mount({ content: () => { calls += 1; return calls === 1 ? json({ error: 'boom' }, 503) : json(READ()); } });
  try {
    assert.match(m.of('trust-content-unreadable'), /could not be read just now\. That is not the same as having none\./);
    assert.equal(m.has('trust-content-blocks'), false);
  } finally { await m.unmount(); }
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

test('only a Super Admin reaches the editor: the route sits behind hqOnly, and HQ Security links to it', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/admin\/security\/trust-center" element=\{guard\(\['admin'\], hqOnly\(<TrustContentPage \/>\)\)\} \/>/);
  assert.match(app, /const hqOnly = \(component\) => \(\s*isSuperAdminUser\(user\) \? component : <SuperAdminOnlyNotice \/>/);
  assert.match(read('frontend/src/pages/hq/SecurityPage.jsx'), /to="\/admin\/security\/trust-center"/);
  assert.doesNotMatch(read('frontend/src/pages/hq/TrustContentPage.jsx'), /window\.(confirm|prompt|alert)\(/);
});

test('SECURITY.md and security.txt keep only what the platform does', () => {
  const md = read('SECURITY.md');
  for (const gone of ['security/hall', 'pgp.txt', 'keys.openpgp.org', 'PGP key request', 'Hall of Recognition', 'link in the footer', 'announced via the GitHub']) {
    assert.ok(!md.includes(gone), `SECURITY.md still says ${gone}`);
  }
  assert.match(md, /No PGP key is published/);
  assert.match(md, /POST \/api\/help\/security-reports/);
  // D1077 (#2969): the in-app form is built on the trust center's Disclosure tab.
  assert.match(md, /Disclosure tab \(`\/trust\/disclosure`\)/);
  const txt = read('frontend/public/.well-known/security.txt');
  assert.match(txt, /^Policy: https:\/\/axal\.vc\/trust\/disclosure$/m);
  assert.match(txt, /^Contact: mailto:security@axal\.vc$/m);
  assert.match(read('frontend/src/pages/site/trustCenterModel.js'), /missing\('PGP key', 'None is published\./);
});
