/**
 * #6290 — a Due diligence checklist item expanded (DDL4): its note, severity,
 * owner, due date and evidence; Add evidence (a file or a link) and Edit item
 * for who works its section; one sentence for who may not; the Worker's
 * refusal kept in its dialog; and no Remove, since no Worker route removes
 * evidence (D1248 §8).
 *
 * Every name and id here is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/dd_item_evidence_6290.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import {
  EVIDENCE_MAX_BYTES, NO_REMOVE_LINE, NOT_RECORDED, WHO, evidenceBody, evidenceRows, itemEditPatch,
} from '../src/pages/duediligence/ddCaseModel.js';
import AdminDueDiligenceCasePage from '../src/pages/AdminDueDiligenceCasePage.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const UID = 'case7f3a00000021c9';

const WORKS = { scan: false, assign: false, verdict: { 11: false, 12: false }, requests: true, report: false, notify_founder: false, audit: true,
  decide: false, update: false, memo_read: true, widen: false, team: false, work: { 11: true, 12: true }, work_case_wide: true };
const READS = { ...WORKS, work: { 11: false, 12: false }, work_case_wide: false };

const CASE = (over = {}) => ({
  case: { uid: UID, subject_label: 'Company Alpha', subject_type: 'project', status: 'in_review', template_depth: 'standard', lead_user_id: 3,
    lead_name: 'Mira Lead', created_at: '2026-10-01 09:00:00', target_ic_date: null, risk_band: null, risk_score: null, decision: null, scoped: false,
    platform_checks: null, ic_record: null },
  allowed: over.allowed || WORKS,
  sections: [
    { id: 11, title: 'Financial Health & Runway', blocking: 1, weight: 0.3, status: 'in_review', verdict: null },
    { id: 12, title: 'Compliance / AML / Sanctions', blocking: 0, weight: 0.2, status: 'in_review', verdict: null },
  ],
  flags: [], findings: [],
  reviewers: [{ user_id: 5, user_name: 'Ravi Reviewer', section_id: 11, role: 'reviewer', invited_at: '2026-10-02 09:00:00', responded_at: '2026-10-02 10:00:00', nda_signed_at: '2026-10-03 09:00:00' }],
  checklist: [
    { id: 501, section_id: 12, title: 'Sanctions screen', status: 'flag', severity: 'high', note: 'Two near matches to clear.', owner_user_id: 5, due_date: '2099-01-15' },
    { id: 503, section_id: 11, title: 'Bank statements', status: 'pass', severity: null, note: null, owner_user_id: null, due_date: null },
  ],
  requests: [], attachments: [], sources: [], documents_unreadable: false,
  evidence: over.evidence ?? [
    { uid: 'ev-file', item_id: 501, section_id: 12, kind: 'file', attachment_id: 77, filename: 'screen-report.pdf', size_bytes: 40960, added_by_name: 'Ravi Reviewer', created_at: '2026-10-12 09:00:00' },
    { uid: 'ev-link', item_id: 501, section_id: 12, kind: 'link', url: 'https://register.example.test/a', label: 'Registry entry', added_by_name: 'Mira Lead', created_at: '2026-10-13 09:00:00' },
  ],
});

// ------------------------------------------------------------------ the rules

test('evidence rows: a file opens through its link, a link opens itself; an unread list is null', () => {
  const rows = evidenceRows(CASE().evidence);
  assert.deepEqual(rows.map((r) => [r.kind, r.name, r.attachmentId, r.url, r.by]), [
    ['file', 'screen-report.pdf', 77, null, 'Ravi Reviewer'],
    ['link', 'Registry entry', null, 'https://register.example.test/a', 'Mira Lead'],
  ]);
  assert.equal(evidenceRows(null), null);
  assert.equal(evidenceRows([{ uid: 'x', kind: 'link', url: null }])[0].name, NOT_RECORDED, 'a nameless row says so, never blank');
});

test('Add evidence: an http(s) link with an optional label, or a file up to 10 MB', () => {
  assert.deepEqual(evidenceBody({ mode: 'link', url: ' https://a.example.test/x ', label: ' Deck ' }), { kind: 'link', url: 'https://a.example.test/x', label: 'Deck' });
  assert.deepEqual(evidenceBody({ mode: 'link', url: 'https://a.example.test', label: '  ' }), { kind: 'link', url: 'https://a.example.test', label: undefined });
  assert.equal(evidenceBody({ mode: 'link', url: '' }).error, 'Paste the link.');
  assert.equal(evidenceBody({ mode: 'link', url: 'javascript:alert(1)' }).error, 'The link starts with http:// or https://.');
  assert.equal(evidenceBody({ mode: 'link', url: 'ftp://a.example.test' }).error, 'The link starts with http:// or https://.');
  assert.equal(evidenceBody({ mode: 'file', file: null }).error, 'Choose the file.');
  assert.match(evidenceBody({ mode: 'file', file: { name: 'big.pdf', size: EVIDENCE_MAX_BYTES + 1 } }).error, /over 10 MB/);
  const file = { name: 'ok.pdf', size: EVIDENCE_MAX_BYTES };
  assert.deepEqual(evidenceBody({ mode: 'file', file }), { kind: 'file', file });
  assert.equal(evidenceBody({}).error, 'Choose a file or a link.');
});

test('Edit item: only what changed is sent; cleared fields are null; a severity only on Flag or Fail; a new due date today or later', () => {
  const flagged = CASE().checklist[0];
  const form = (over = {}) => ({ note: flagged.note, severity: flagged.severity, ownerId: String(flagged.owner_user_id), due: flagged.due_date, ...over });
  assert.equal(itemEditPatch(flagged, form(), '2026-11-15').error, 'Nothing changed.');
  assert.deepEqual(itemEditPatch(flagged, form({ note: 'Cleared both.' }), '2026-11-15').patch, { note: 'Cleared both.' });
  assert.deepEqual(itemEditPatch(flagged, form({ note: '' }), '2026-11-15').patch, { note: null });
  assert.deepEqual(itemEditPatch(flagged, form({ severity: 'critical' }), '2026-11-15').patch, { severity: 'critical' });
  assert.deepEqual(itemEditPatch(flagged, form({ severity: '' }), '2026-11-15').patch, { severity: null });
  assert.deepEqual(itemEditPatch(flagged, form({ ownerId: '' }), '2026-11-15').patch, { owner_user_id: null });
  assert.deepEqual(itemEditPatch(flagged, form({ ownerId: '9' }), '2026-11-15').patch, { owner_user_id: 9 });
  assert.deepEqual(itemEditPatch(flagged, form({ due: '' }), '2026-11-15').patch, { due_date: null });
  assert.equal(itemEditPatch(flagged, form({ due: '2026-11-01' }), '2026-11-15').error, 'The due date is today or later.');
  assert.deepEqual(itemEditPatch(flagged, form({ due: '2026-11-15' }), '2026-11-15').patch, { due_date: '2026-11-15' });
  const passed = CASE().checklist[1];
  assert.deepEqual(itemEditPatch(passed, { note: 'ok', severity: 'high', ownerId: '', due: '' }, '2026-11-15').patch, { note: 'ok' }, 'no severity on a Pass item');
  const past = { ...flagged, due_date: '2026-01-01' };
  assert.deepEqual(itemEditPatch(past, form({ due: '2026-01-01', note: 'x' }), '2026-11-15').patch, { note: 'x' }, 'an unchanged past date is not refused');
  assert.match(itemEditPatch(flagged, form({ note: 'x'.repeat(4001) }), '2026-11-15').error, /4,000/);
});

// ------------------------------------------------------------------ mounted

async function mount(url, fetchFn) {
  const restore = installDocument('', { focus: true });
  const original = globalThis.fetch;
  globalThis.fetch = fetchFn;
  const opened = [];
  const originalOpen = globalThis.window?.open;
  if (globalThis.window) globalThis.window.open = (u) => { opened.push(u); };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); });
  const page = h(AdminDueDiligenceCasePage);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
      h(Route, { path: '/admin/due-diligence/:uid', element: page }), h(Route, { path: '/admin/due-diligence/:uid/:tab', element: page }),
      h(Route, { path: '/due-diligence/:uid', element: page }), h(Route, { path: '/due-diligence/:uid/:tab', element: page }))));
  });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join('') : n.textContent || '');
  const need = (id) => { const n = by(id); assert.ok(n, `no ${id}`); return n; };
  const ev = { preventDefault() {}, stopPropagation() {} };
  return {
    opened,
    has: (id) => Boolean(by(id)),
    text: (id) => txt(id ? need(id) : container).replace(/\s+/g, ' ').trim(),
    disabledButtons: () => walk(container).filter((n) => n.tagName === 'BUTTON' && pr(n).disabled),
    async click(id) { await act(async () => { await pr(need(id)).onClick?.(ev); }); await settle(); },
    async change(id, value, files = []) { await act(async () => { pr(need(id)).onChange({ target: { value, checked: true, files } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; if (globalThis.window) globalThis.window.open = originalOpen; restore(); },
  };
}

/** A stubbed Worker: the case read (re-read after each write), and every write recorded. */
function worker(data, extra = {}) {
  const writes = [];
  let reads = 0;
  const fetchFn = async (u, o = {}) => {
    const path = new URL(String(u), 'http://x').pathname.replace(/^\/api/, '');
    const method = String(o.method || 'GET');
    if (method !== 'GET') {
      const body = typeof o.body === 'string' ? JSON.parse(o.body) : o.body instanceof FormData ? { file: o.body.get('file')?.name } : null;
      writes.push({ method, path, body });
      if (extra[`${method} ${path}`]) return extra[`${method} ${path}`](body);
      return json({ ok: true });
    }
    if (path === `/dd/cases/${UID}`) { reads += 1; return json(data); }
    if (path.endsWith('/audit')) return json({ items: [] });
    return json({ error: 'Not found' }, 404);
  };
  return { writes, fetchFn, reads: () => reads };
}

test('a worker expands a row: note, severity, owner, due date and both kinds of evidence; a file opens through its two-minute link', async () => {
  const w = worker(CASE(), { [`POST /dd/cases/${UID}/documents/download`]: () => json({ url: 'https://example.test/api/dd/documents/dl/tok' }) });
  const m = await mount(`/admin/due-diligence/${UID}/checklist`, w.fetchFn);
  try {
    assert.ok(!m.has('dd-item-detail-501'), 'rows start collapsed');
    await m.click('dd-item-expand-501');
    assert.equal(m.text('dd-item-note-501'), 'Two near matches to clear.');
    assert.equal(m.text('dd-item-severity-501'), 'High');
    assert.match(m.text('dd-item-detail-501'), /Owner\s*Ravi Reviewer/);
    assert.match(m.text('dd-item-evidence-row-ev-file'), /screen-report\.pdf\s*File · Ravi Reviewer/);
    assert.match(m.text('dd-item-evidence-row-ev-link'), /Registry entry\s*Link · Mira Lead.*Visit link/);
    assert.equal(m.text('dd-item-no-remove-501'), NO_REMOVE_LINE);
    assert.ok(!/\bRemove\b/.test(m.text('dd-item-detail-501').replace(NO_REMOVE_LINE, '')), 'removing evidence is not offered');
    await m.click('dd-item-expand-503');
    assert.equal(m.text('dd-item-severity-503'), 'Set on an item marked Flag or Fail');
    assert.match(m.text('dd-item-evidence-503'), /No evidence on this item yet\./);
    assert.deepEqual(m.disabledButtons(), []);
  } finally { await m.unmount(); }
});

test('Add evidence: a link is posted with its label, the dialog closes, the case is read again and the row and Documents show it', async () => {
  const data = CASE({ evidence: [] });
  const w = worker(data, {
    [`POST /dd/cases/${UID}/items/503/evidence`]: (body) => {
      data.evidence.push({ uid: 'ev-new', item_id: 503, section_id: 11, kind: 'link', url: body.url, label: body.label, added_by_name: 'Mira Lead', created_at: '2026-11-15 09:00:00' });
      return json({ ok: true }, 201);
    },
  });
  const m = await mount(`/admin/due-diligence/${UID}/checklist`, w.fetchFn);
  try {
    await m.click('dd-item-expand-503');
    await m.click('dd-evidence-open-503');
    assert.ok(m.has('dd-evidence'));
    await m.click('dd-evidence-submit');
    assert.equal(m.text('dd-evidence-error'), 'Paste the link.');
    assert.equal(w.writes.length, 0, 'nothing is sent until the dialog is complete');
    await m.change('dd-evidence-url', 'https://bank.example.test/statement');
    await m.change('dd-evidence-label', 'October statement');
    const before = w.reads();
    await m.click('dd-evidence-submit');
    assert.deepEqual(w.writes, [{ method: 'POST', path: `/dd/cases/${UID}/items/503/evidence`, body: { url: 'https://bank.example.test/statement', label: 'October statement' } }]);
    assert.ok(!m.has('dd-evidence'), 'the dialog closes');
    assert.ok(w.reads() > before, 'the case is read again');
    assert.match(m.text('dd-case-notice'), /Evidence is added to “Bank statements”\./);
    assert.match(m.text('dd-item-503'), /Evidence: 1/);
  } finally { await m.unmount(); }
  const d = await mount(`/admin/due-diligence/${UID}/documents`, worker(data).fetchFn);
  try { assert.match(d.text('dd-docs-evidence'), /October statement\s*Bank statements/); } finally { await d.unmount(); }
});

test('Add evidence: a file is posted as the item\'s multipart upload', async () => {
  const w = worker(CASE(), { [`POST /dd/cases/${UID}/items/503/evidence`]: () => json({ ok: true }, 201) });
  const m = await mount(`/admin/due-diligence/${UID}/checklist`, w.fetchFn);
  try {
    await m.click('dd-item-expand-503');
    await m.click('dd-evidence-open-503');
    await m.change('dd-evidence-mode-file', 'on');
    await m.click('dd-evidence-submit');
    assert.equal(m.text('dd-evidence-error'), 'Choose the file.');
    const file = new File([new TextEncoder().encode('PDF')], 'statement.pdf', { type: 'application/pdf' });
    await m.change('dd-evidence-file', '', [file]);
    await m.click('dd-evidence-submit');
    assert.deepEqual(w.writes, [{ method: 'POST', path: `/dd/cases/${UID}/items/503/evidence`, body: { file: 'statement.pdf' } }]);
    assert.ok(!m.has('dd-evidence'));
  } finally { await m.unmount(); }
});

test('Edit item: only the changed fields go to the item PATCH; the severity field appears only on a Flag or Fail item', async () => {
  const w = worker(CASE());
  const m = await mount(`/admin/due-diligence/${UID}/checklist`, w.fetchFn);
  try {
    await m.click('dd-item-expand-501');
    await m.click('dd-item-edit-open-501');
    await m.click('dd-item-edit-submit');
    assert.equal(m.text('dd-item-edit-error'), 'Nothing changed.');
    await m.change('dd-item-edit-note', 'Both matches cleared.');
    await m.change('dd-item-edit-severity', 'low');
    await m.click('dd-item-edit-submit');
    assert.deepEqual(w.writes, [{ method: 'PATCH', path: `/dd/cases/${UID}/items/501`, body: { note: 'Both matches cleared.', severity: 'low' } }]);
    assert.match(m.text('dd-case-notice'), /“Sanctions screen” is updated\./);
  } finally { await m.unmount(); }
  const p = await mount(`/admin/due-diligence/${UID}/checklist`, worker(CASE()).fetchFn);
  try {
    await p.click('dd-item-expand-503');
    await p.click('dd-item-edit-open-503');
    assert.ok(!p.has('dd-item-edit-severity'));
    assert.ok(p.has('dd-item-edit-no-severity'));
  } finally { await p.unmount(); }
});

test('a member who may not work the section reads one sentence, never a disabled button', async () => {
  const m = await mount(`/due-diligence/${UID}/checklist`, worker(CASE({ allowed: READS })).fetchFn);
  try {
    await m.click('dd-item-expand-501');
    assert.equal(m.text('dd-who-item-501'), WHO.work);
    assert.ok(!m.has('dd-evidence-open-501') && !m.has('dd-item-edit-open-501'));
    assert.match(m.text('dd-item-evidence-501'), /screen-report\.pdf/, 'they still read the evidence');
    assert.deepEqual(m.disabledButtons(), []);
  } finally { await m.unmount(); }
});

test('an observer who reaches the write is refused in the Worker\'s own sentence, and the dialog stays open', async () => {
  const sentence = 'An observer reads this section and does not work its checklist.';
  const w = worker(CASE(), { [`POST /dd/cases/${UID}/items/501/evidence`]: () => json({ error: sentence, code: 'observer_reads_only' }, 403) });
  const m = await mount(`/admin/due-diligence/${UID}/checklist`, w.fetchFn);
  try {
    await m.click('dd-item-expand-501');
    await m.click('dd-evidence-open-501');
    await m.change('dd-evidence-url', 'https://x.example.test');
    await m.click('dd-evidence-submit');
    assert.equal(m.text('dd-evidence-error'), sentence);
    assert.ok(m.has('dd-evidence'));
  } finally { await m.unmount(); }
});

test('an evidence list the case read could not carry says Not recorded on the row, never none', async () => {
  const data = CASE();
  data.evidence = null;
  const m = await mount(`/admin/due-diligence/${UID}/checklist`, worker(data).fetchFn);
  try {
    await m.click('dd-item-expand-501');
    assert.match(m.text('dd-item-evidence-501'), /Not recorded: the case read could not carry this item’s evidence\./);
    assert.ok(m.has('dd-evidence-open-501'), 'a worker can still add evidence');
  } finally { await m.unmount(); }
});

test('the source: no browser pop-up, no disabled control, no remove call; the README names the row', () => {
  for (const f of ['frontend/src/pages/duediligence/DdCaseWork.jsx', 'frontend/src/pages/duediligence/DdCaseDialogs.jsx']) {
    const s = read(f);
    assert.ok(!/window\.(confirm|alert|prompt)\(/.test(s), f);
    assert.ok(!/\bdisabled=\{/.test(s), f);
    assert.ok(!/removeEvidence|deleteEvidence|method: 'DELETE'/.test(s), `${f}: no evidence removal`);
  }
  assert.match(read('frontend/src/pages/duediligence/README.md'), /#6290/);
});
