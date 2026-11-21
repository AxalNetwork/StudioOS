/**
 * D6001 (#6001) — Customer research's recruiting controls on the page: the
 * address's `?filter=` opens the table filtered (the card's next link), Add a
 * lead and Move stage for a writer only, each sending what the Worker takes,
 * and the Waitlist leads panel, which says a failed read and never shows it
 * as empty.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_pipeline_6001.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import validate from '../src/pages/cycles/defs/validate.jsx';
import { queryFromSearch } from '../src/pages/cycles/cycleModel.js';
import { addLead, moveStageForm } from '../src/pages/cycles/forms.js';
import { formFields, formValues, formErrors } from '../src/pages/cycles/FormLightbox.jsx';
import { addLeadButton, moveStageAction, waitlistRow } from '../src/pages/cycles/ResearchPipeline.jsx';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';

const h = React.createElement;
const response = (body, status = 200) => ({
  ok: status < 400, status, headers: { get: (k) => (/content-type/i.test(k) ? 'application/json' : null) },
  json: async () => body, text: async () => JSON.stringify(body),
});
const COLS = ['Interviewee', 'Company', 'Date', 'ICP fit', 'Recording consent', 'Quotes OK', 'State'];
// Made-up interviews, shaped as `researchRecords` sends them.
const ROWS = [
  { id: 41, interviewee: 'Dana Ruiz', company: 'Acme', date: '2026-11-02', stage: 'invited', state: 'invited', recording_consent: { status: 'not_asked', method: null } },
  { id: 42, interviewee: 'Eli Park', company: null, date: '2026-11-03', stage: 'invited', state: 'invited', recording_consent: { status: 'not_asked', method: null } },
];
const moduleRead = (canWrite) => ({
  module: { slug: 'customer-research', name: 'Customer research' }, card: null,
  records: { cols: COLS, rows: ROWS, total: ROWS.length, page: 1, page_size: 25 },
  parts: { can_write: canWrite, stats: { logged: 2, with_pain: 0, consent_agreed: 0, consent_not_asked: 2 } },
});
const SIGNUPS = { signups: [
  { id: 5, name: 'Wren Hale', email: 'wren@example.test', crm_status: 'new', promoted_interview_id: null },
  { id: 6, name: null, email: 'ivy@example.test', crm_status: 'invited', promoted_interview_id: null },
  { id: 7, name: 'Pat Moss', email: 'pat@example.test', crm_status: 'promoted', promoted_interview_id: 41 },
] };

/** CycleRoute on a fake DOM, every request answered by `handler`. */
async function mounted(url, handler) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), options }); return handler(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.click = () => {}; node.remove = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1];
  const nodes = () => { const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (node) => (node?.nodeType === 3 ? node.textContent : node?.childNodes?.length ? node.childNodes.map(text).join('') : node?.textContent || '');
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/validate/:slug', element: h(CycleRoute, { cycle: 'validate' }) }),
  ))));
  const flush = () => act(async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); });
  await flush(); await flush();
  return {
    requests, nodes, props, flush, text: () => text(container),
    byTestid: (id) => nodes().filter((n) => props(n)?.['data-testid'] === id),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const handlerFor = ({ canWrite = true, waitlist = () => response(SIGNUPS) } = {}) => (url) => (
  url.includes('/cycles/validate/modules/customer-research?') ? response(moduleRead(canWrite))
    : url.includes('/progress/discovery/7/waitlist') ? waitlist()
      : response({}));
const moduleReads = (requests) => requests.filter((r) => r.url.includes('/cycles/validate/modules/customer-research?'));

test('D6001: an address\'s ?filter= is the query the table opens with, each part charset-checked', () => {
  assert.deepEqual(queryFromSearch('?project=1&filter=stage:invited_no_slot'), { q: '', filter: { stage: 'invited_no_slot' }, sort: '', page: 1 });
  assert.deepEqual(queryFromSearch('?filter=stage:lead,channel:call').filter, { stage: 'lead', channel: 'call' });
  assert.deepEqual(queryFromSearch('?filter=Stage:lead,stage:a:b,x:<b>').filter, {}, 'a part the Worker would drop is dropped');
  assert.deepEqual(queryFromSearch(''), { q: '', filter: {}, sort: '', page: 1 });
});

test('D6001: the card\'s next link opens Customer research filtered to its rows, with one module read', async () => {
  const m = await mounted('/validate/customer-research?project_id=7&filter=stage:invited_no_slot', handlerFor());
  try {
    const reads = moduleReads(m.requests);
    assert.equal(reads.length, 1, 'the filter is the opening query, not a second read');
    assert.match(reads[0].url, /filter=stage%3Ainvited_no_slot/);
    const select = m.nodes().find((n) => m.props(n)?.['aria-label'] === 'Stage');
    assert.ok(select, 'the Stage filter is drawn');
    assert.equal(m.props(select).value, 'invited_no_slot');
  } finally { await m.close(); }
  const plain = await mounted('/validate/customer-research?project_id=7', handlerFor());
  try {
    assert.doesNotMatch(moduleReads(plain.requests)[0].url, /filter=/);
  } finally { await plain.close(); }
});

test('D6001: a writer gets Add a lead beside Record a session and Move stage on each row; a reader gets neither', async () => {
  const m = await mounted('/validate/customer-research?project_id=7', handlerFor());
  try {
    assert.match(m.text(), /Add a lead/);
    assert.match(m.text(), /Record a session/);
    const moves = m.byTestid('records-row-action');
    assert.equal(moves.length, 2);
    assert.equal(m.props(moves[0])['aria-label'], 'Move stage for Dana Ruiz');
    await act(async () => { m.props(moves[0]).onClick(); });
    await m.flush();
    assert.match(m.text(), /Move Dana Ruiz/, 'the dialog opens over the table');
  } finally { await m.close(); }
  const reader = await mounted('/validate/customer-research?project_id=7', handlerFor({ canWrite: false }));
  try {
    assert.doesNotMatch(reader.text(), /Add a lead/);
    assert.equal(reader.byTestid('records-row-action').length, 0);
    assert.equal(reader.nodes().some((n) => reader.props(n)?.children === 'Invite'), false, 'no Invite for a reader');
  } finally { await reader.close(); }
  // Record a session stays the first Add: the zero state's one action (D6004).
  const adds = validate.add.get('customer-research')('?project_id=7', () => {}, { canWrite: true, projectId: 7, openDialog: () => {} });
  assert.deepEqual(adds.map((a) => a.text), ['Record a session', 'Add a lead']);
  assert.deepEqual(validate.add.get('customer-research')('?project_id=7', () => {}).map((a) => a.text), ['Record a session']);
});

test('D6001: Add a lead sends an interview at stage lead to the create route, its channel only when picked', async () => {
  const sent = [];
  const w = makeCycleWrites(async (path, init) => { sent.push([path, init.method, JSON.parse(init.body)]); return { id: 9 }; });
  const fields = formFields(addLead);
  const values = formValues(fields);
  assert.equal(values.channel, '', 'no channel is chosen until the founder picks one');
  assert.ok(formErrors(addLead, fields, values).interviewee_name, 'a lead needs a name');
  await addLead.submit(w, 7, { ...values, interviewee_name: '  Hana Sato ', interviewee_company: 'Kobe Freight' });
  await addLead.submit(w, 7, { interviewee_name: 'Ike', channel: 'video' });
  assert.deepEqual(sent, [
    ['/progress/discovery/7', 'POST', { interviewee_name: 'Hana Sato', interviewee_company: 'Kobe Freight', interviewee_role: null, channel: null, stage: 'lead' }],
    ['/progress/discovery/7', 'POST', { interviewee_name: 'Ike', interviewee_company: null, interviewee_role: null, channel: 'video', stage: 'lead' }],
  ]);
  // The button opens the dialog, and its save closes it and reads the page again.
  let dialog = null; let reloads = 0;
  const button = addLeadButton({ canWrite: true, projectId: 7, openDialog: (el) => { dialog = el; }, reload: () => { reloads += 1; } }, w);
  button.onClick();
  assert.equal(dialog.props.form, addLead);
  dialog.props.onSaved();
  assert.equal(dialog, null);
  assert.equal(reloads, 1);
  assert.equal(addLeadButton({ canWrite: false, projectId: 7, openDialog: () => {} }, w), null);
});

test('D6001: Move stage chooses no stage for the founder, marks the current one, and posts the record\'s set-stage', async () => {
  const form = moveStageForm({ name: 'Dana Ruiz', stage: 'invited' });
  const fields = formFields(form);
  assert.equal(formValues(fields).stage, '', 'nothing is preselected');
  assert.ok(formErrors(form, fields, formValues(fields)).stage, 'a stage must be picked');
  assert.deepEqual(fields[0].options.map((o) => [o.value, o.meta]), [['lead', ''], ['invited', 'current'], ['booked', ''], ['done', '']]);
  assert.deepEqual(form.toBody({ stage: 'booked', at: '' }), { stage: 'booked' });
  assert.deepEqual(form.toBody({ stage: 'done', at: '2026-11-14' }), { stage: 'done', at: '2026-11-14' });

  const acted = [];
  let dialog = null;
  const ctx = { canWrite: true, projectId: 7, openDialog: (el) => { dialog = el; }, reload: () => {} };
  const action = moveStageAction({ recordId: '41', name: 'Dana Ruiz', stage: 'invited' }, ctx, async (...args) => { acted.push(args); return { ok: true }; });
  action.onClick();
  await dialog.props.onSubmit({ stage: 'booked', at: '' });
  assert.deepEqual(acted, [[7, '41', { stage: 'booked' }]]);
  // The def's control posts the interview record's own action, so the move is in its activity.
  const calls = [];
  const restoreDom = installDocument();
  const restore = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push([String(url), init?.method, init?.body]); return response({ ok: true }); };
  try {
    const row = validate.rowActions.get('customer-research')({ recordId: '41', name: 'Dana Ruiz', stage: 'invited' }, ctx);
    row.onClick();
    await dialog.props.onSubmit({ stage: 'done', at: '' });
  } finally { globalThis.fetch = restore; restoreDom(); }
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /\/api\/cycles\/validate\/modules\/customer-research\/records\/41\/actions\/set-stage\?project=7$/);
  assert.equal(calls[0][1], 'POST');
  assert.deepEqual(JSON.parse(calls[0][2]), { stage: 'done' });
  assert.equal(moveStageAction({ recordId: null, name: 'X' }, ctx, () => {}), null, 'a row with no record has no Move stage');
  assert.equal(moveStageAction({ recordId: '41' }, { ...ctx, canWrite: false }, () => {}), null);
});

test('D6001: Waitlist leads lists each sign-up with its next step, and a failed read says so', async () => {
  assert.deepEqual(SIGNUPS.signups.map(waitlistRow).map((r) => [r.who, r.status, r.next]), [
    ['Wren Hale', 'New', 'invite'], ['ivy@example.test', 'Invited', 'follow_up'], ['Pat Moss', 'Promoted', 'open'],
  ]);
  assert.equal(waitlistRow({ id: 1, email: 'a@example.test', crm_status: 'promoted', promoted_interview_id: null }).next, null);
  const m = await mounted('/validate/customer-research?project_id=7', handlerFor());
  try {
    const panel = m.byTestid('waitlist-leads')[0];
    assert.ok(panel);
    assert.equal(m.props(panel).id, 'waitlist-leads', 'the card\'s #waitlist-leads lands here');
    assert.match(m.text(), /Waitlist leads · 3/);
    assert.match(m.text(), /Wren Hale.*New.*Invite/);
    assert.match(m.text(), /ivy@example\.test.*Invited.*Follow up/);
    assert.match(m.text(), /Pat Moss.*Promoted.*Open interview/);
    assert.doesNotMatch(m.text(), /Promote\b(?!d)/, 'Promote waits on the owner (D5995): not offered here');
  } finally { await m.close(); }
  const failed = await mounted('/validate/customer-research?project_id=7', handlerFor({ waitlist: () => response({ detail: 'down' }, 500) }));
  try {
    assert.equal(failed.byTestid('waitlist-leads-unreadable').length, 1);
    assert.match(failed.text(), /The waitlist couldn’t be read\./);
    assert.doesNotMatch(failed.text(), /Waitlist leads · 0|No one has signed up/);
  } finally { await failed.close(); }
});
