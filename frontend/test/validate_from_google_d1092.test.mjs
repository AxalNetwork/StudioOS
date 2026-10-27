// D1092 (#2957), Google Workspace part 3 — From Google on Validate's three
// modules (`pages/cycles/ValidateFromGoogle.jsx`), mounted on a stubbed fetch:
// the shared section with what landed, Choose the interview for an unmapped
// Doc, GW5's Map a question with its preview, the evidence offers with the
// hypothesis picker, and the states a viewer who may not read it meets. No
// test reaches Google or the Worker.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_from_google_d1092.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ValidateFromGoogle, { COLUMNS, rowsOf, syncSentence } from '../src/pages/cycles/ValidateFromGoogle.jsx';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

async function mount(element, routes = {}) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const key = `${(init.method || 'GET').toUpperCase()} ${url.pathname}`;
    const body = init.body ? JSON.parse(init.body) : null;
    seen.push({ key, search: url.search, body });
    if (routes[key]) return routes[key]({ url, body });
    return response({});
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, element)));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const fire = async (id, name, arg) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { await props(n)[name](arg); }); await settle(); };
  return {
    seen, writes: () => seen.filter((s) => !s.key.startsWith('GET ')),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n).replace(/\s+/g, ' ').trim(); },
    has: (id) => Boolean(byId(id)), prop: (id, k) => props(byId(id))?.[k],
    click: (id) => fire(id, 'onClick'), change: (id, v) => fire(id, 'onChange', { target: { value: v, checked: v } }),
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

const DOC = { uid: 'd1', module: 'customer_research', kind: 'doc', name: 'Call notes — Ana', status: 'active', last_synced_at: '2026-10-21T07:55:00Z', mapped: true };
const FORM = { uid: 'f1', module: 'demand_signals', kind: 'form', name: 'Waitlist survey', status: 'active', last_synced_at: '2026-10-21T07:55:00Z', mapped: false };
const files = (items) => ({ 'GET /api/connectors/google-workspace/files': () => response({ items }) });
const ok = (over) => ({ state: 'ok', files: [], facts: [], proposals: [], deleted: 0, ...over });
const COUNTS = { files: 1, imported: 0, unchanged: 0, unmapped: 0, unreadable: 0, proposed_signals: 18, offered_evidence: 0, withdrawn_offers: 0, partly: false };

test('the words: rows from what landed, a status in words, a sync as counts only', () => {
  assert.deepEqual(rowsOf('demand_signals', [{ id: 4, label: 'Waitlist · 2026-10-20', status: 'to_confirm' }]),
    [{ id: 4, label: 'Waitlist · 2026-10-20', cells: { label: 'Waitlist · 2026-10-20', status: 'To confirm' } }]);
  assert.deepEqual(rowsOf('customer_research', [{ id: 9, label: 'Notes on Ana', as_of: '2026-10-21T08:00:00Z' }])[0].cells, { label: 'Notes on Ana', as_of: '2026-10-21' });
  assert.equal(rowsOf('customer_research', [{ id: 9, label: 'Notes on Ana', as_of: null }])[0].cells.as_of, null, 'a missing date is not drawn as a date');
  assert.deepEqual(COLUMNS.demand_signals.map((c) => c.label), ['Signal', 'Status']);
  assert.equal(syncSentence(COUNTS), '18 signals to confirm.');
  assert.equal(syncSentence({ ...COUNTS, proposed_signals: 0, imported: 1, unmapped: 2, unreadable: 1, partly: true }),
    '1 Doc read into interview notes. 2 files are not mapped yet. 1 could not be read. Google’s read limit was reached: Sync again to carry on.');
  assert.equal(syncSentence({ ...COUNTS, proposed_signals: 0 }), 'Nothing new in your Google files.');
});

test('Customer research: the notes each mapped Doc became, Delete asked first, and Choose the interview for an unmapped Doc', async () => {
  const part = ok({ files: [DOC, { ...DOC, uid: 'd2', name: 'Call notes — Ben', mapped: false }], facts: [{ id: 31, source: 'Google Docs', as_of: '2026-10-21T08:00:00Z', label: 'Notes on Ana' }], deleted: 1 });
  let reloads = 0;
  const v = await mount(h(ValidateFromGoogle, { part, module: 'customer_research', projectId: 701, reload: () => { reloads += 1; } }), {
    ...files([DOC]),
    'GET /api/progress/discovery/701': () => response({ interviews: [{ id: 55, interviewee_name: 'Ben Ortiz', interview_date: '2026-10-19' }] }),
    'PUT /api/connectors/google-workspace/files/d2/mapping': () => response({ ok: true }),
    'DELETE /api/cycles/validate/google/facts/31': () => response({ ok: true }),
    'POST /api/cycles/validate/google/sync': () => response({ ...COUNTS, proposed_signals: 0, imported: 1, unmapped: 1 }),
  });
  assert.match(v.of('from-google'), /Notes on Ana/);
  // Sync from Google: the Validate route, and what it did as counts.
  await v.click('from-google-sync');
  assert.ok(v.writes().some((w) => w.key === 'POST /api/cycles/validate/google/sync' && /project=701/.test(w.search)));
  assert.equal(v.of('validate-from-google-note'), '1 Doc read into interview notes. 1 file is not mapped yet.');
  assert.match(v.of('from-google-notes'), /1 row you deleted stays deleted/);
  assert.match(v.of('validate-from-google-unmapped-d2'), /“Call notes — Ben” is not mapped yet, so nothing is read from it\./);
  assert.equal(v.has('validate-from-google-unmapped-d1'), false, 'a mapped Doc asks nothing');
  // Choose the interview: a dialog that says what changes; nothing is written before it is confirmed.
  await v.click('validate-from-google-map-d2');
  assert.match(v.of('validate-map-interview'), /Map “Call notes — Ben” to an interview/);
  assert.match(v.of('validate-map-interview'), /Its text becomes that interview’s notes when you sync\. Axal VC never changes the Doc\./);
  assert.ok(v.prop('validate-map-interview-go', 'disabled'));
  await v.change('validate-map-interview-select', '55');
  await v.click('validate-map-interview-go');
  const put = v.writes().find((w) => w.key === 'PUT /api/connectors/google-workspace/files/d2/mapping');
  assert.deepEqual(put.body, { mapping: { interview_id: 55 } });
  assert.equal(v.has('validate-map-interview'), false);
  assert.match(v.of('validate-from-google-note'), /“Call notes — Ben” is mapped\. Sync from Google to read it\./);
  assert.ok(reloads >= 1);
  // Delete: the shared dialog, then the Validate route.
  await v.click('from-google-delete-31');
  assert.equal(v.writes().some((w) => w.key.startsWith('DELETE')), false, 'nothing is deleted before the dialog is confirmed');
  await v.click('from-google-delete-confirm');
  assert.ok(v.writes().some((w) => w.key === 'DELETE /api/cycles/validate/google/facts/31' && /project=701/.test(w.search)));
  await v.close();
});

test('Demand signals (GW5): Map a question previews the count and stores nothing, then Propose saves the mapping and syncs; a signal waits To confirm', async () => {
  const QUESTIONS = [{ question_id: 'q1', title: 'Would you join the waitlist?', choices: ['Yes', 'Maybe', 'No'] }, { question_id: 'q2', title: 'Anything else?', choices: [] }];
  const previews = [];
  const part = ok({ files: [FORM], facts: [{ id: 41, source: 'Google Forms', label: 'Waitlist · 2026-10-20', status: 'to_confirm' }] });
  const v = await mount(h(ValidateFromGoogle, { part, module: 'demand_signals', projectId: 701, reload: () => {} }), {
    ...files([{ ...FORM, mapped: true }]),
    'POST /api/cycles/validate/google/forms/f1/preview': ({ body }) => {
      previews.push(body.mapping);
      if (!body.mapping) return response({ questions: QUESTIONS, responses: null, qualifying: null, capped: false, stored: false });
      return response({ questions: QUESTIONS, responses: 42, qualifying: body.mapping.answers.length === 2 ? 18 : 11, capped: false, stored: false });
    },
    'PUT /api/connectors/google-workspace/files/f1/mapping': () => response({ ok: true }),
    'POST /api/cycles/validate/google/sync': () => response(COUNTS),
  });
  assert.match(v.of('from-google'), /Waitlist · 2026-10-20.*To confirm/);
  assert.match(v.of('validate-from-google-confirm'), /counts only once you confirm it on this page/);
  await v.click('validate-from-google-map-f1');
  assert.match(v.of('validate-map-question'), /Map “Waitlist survey” to Demand and urgency signals/);
  assert.match(v.of('validate-map-question'), /No names or emails are kept\./);
  assert.equal(v.has('validate-map-question-answers'), false);
  await v.change('validate-map-question-select', 'q1');
  assert.ok(v.prop('validate-map-question-go', 'disabled'), 'no answer chosen yet');
  await v.change('validate-map-answer-0', true);
  await v.change('validate-map-answer-1', true);
  assert.match(v.of('validate-map-question'), /From Google Forms · 42 responses/);
  assert.equal(v.of('validate-map-question-count'), '18 responses would be proposed as demand signals to confirm.');
  assert.deepEqual(previews.at(-1), { question_id: 'q1', answers: ['Yes', 'Maybe'], kind: 'waitlist' });
  assert.equal(v.writes().filter((w) => w.key.startsWith('PUT')).length, 0, 'a preview stores nothing');
  assert.equal(v.of('validate-map-question-go'), 'Propose 18 signals');
  await v.change('validate-map-question-kind', 'would_pay');
  assert.equal(previews.at(-1).kind, 'would_pay');
  await v.click('validate-map-question-go');
  const keys = v.writes().map((w) => w.key);
  assert.ok(keys.indexOf('PUT /api/connectors/google-workspace/files/f1/mapping') < keys.indexOf('POST /api/cycles/validate/google/sync'), 'mapped, then synced');
  assert.deepEqual(v.writes().find((w) => w.key.startsWith('PUT')).body, { mapping: { question_id: 'q1', answers: ['Yes', 'Maybe'], kind: 'would_pay' } });
  assert.equal(v.has('validate-map-question'), false);
  assert.equal(v.of('validate-from-google-note'), '18 signals to confirm.');
  await v.close();
});

test('GW5: a Form with no answer matching yet holds Propose; a question with no choices is not offered; a refused preview says the sentence', async () => {
  const v = await mount(h(ValidateFromGoogle, { part: ok({ files: [FORM] }), module: 'demand_signals', projectId: 701, reload: () => {} }), {
    ...files([FORM]),
    'POST /api/cycles/validate/google/forms/f1/preview': ({ body }) => response(body.mapping
      ? { questions: [], responses: 42, qualifying: 0, capped: false }
      : { questions: [{ question_id: 'q1', title: 'Join?', choices: ['Yes'] }, { question_id: 'q2', title: 'Free text', choices: [] }] }),
  });
  await v.click('validate-from-google-map-f1');
  await v.change('validate-map-question-select', 'q1');
  await v.change('validate-map-answer-0', true);
  assert.equal(v.of('validate-map-question-count'), 'No response gives these answers yet.');
  assert.ok(v.prop('validate-map-question-go', 'disabled'));
  assert.doesNotMatch(v.of('validate-map-question-select'), /Free text/);
  await v.close();

  const refused = await mount(h(ValidateFromGoogle, { part: ok({ files: [FORM] }), module: 'demand_signals', projectId: 701, reload: () => {} }), {
    ...files([FORM]),
    'POST /api/cycles/validate/google/forms/f1/preview': () => response({ error: 'google_unreadable', detail: 'raw provider text' }, 502),
  });
  await refused.click('validate-from-google-map-f1');
  assert.ok(refused.has('validate-map-question-error'));
  assert.doesNotMatch(refused.of('validate-map-question-error'), /raw provider text/, 'a refusal is our sentence, never the provider’s text');
  await refused.close();
});

test('Experiments: confirmed signals offered as evidence; Add as evidence picks a hypothesis in a dialog; Dismiss; nothing waits', async () => {
  const part = ok({ proposals: [{ id: 7, title: 'Waitlist · 2026-10-20', source: 'Google Forms', record: 'signal-41' }] });
  const v = await mount(h(ValidateFromGoogle, { part, module: 'experiments', projectId: 701, reload: () => {} }), {
    'GET /api/founder/validate/board/701': () => response({ hypotheses: [{ id: 3, code: 'H1', claim: 'Crews pay for booking', retired_at: null }, { id: 4, code: 'H2', claim: 'Retired one', retired_at: '2026-09-01' }] }),
    'POST /api/cycles/validate/google/proposals/7/accept': () => response({ ok: true, state: 'accepted' }),
    'POST /api/cycles/validate/google/proposals/7/dismiss': () => response({ ok: true, state: 'dismissed' }),
  });
  assert.match(v.of('validate-from-google-offer-7'), /Waitlist · 2026-10-20 · Google Forms/);
  await v.click('validate-from-google-accept-7');
  assert.match(v.of('validate-accept-evidence'), /“Waitlist · 2026-10-20” links to the hypothesis you pick\. Nothing in Google is changed\./);
  assert.doesNotMatch(v.of('validate-accept-evidence-select'), /Retired one/, 'a retired hypothesis is not offered');
  assert.ok(v.prop('validate-accept-evidence-go', 'disabled'));
  await v.change('validate-accept-evidence-select', '3');
  await v.change('validate-accept-evidence-direction', 'contradicts');
  await v.change('validate-accept-evidence-strength', 'pattern');
  await v.click('validate-accept-evidence-go');
  const accept = v.writes().find((w) => w.key === 'POST /api/cycles/validate/google/proposals/7/accept');
  assert.deepEqual(accept.body, { hypothesis_id: 3, direction: 'contradicts', strength: 'pattern' });
  assert.ok(/project=701/.test(accept.search));
  assert.equal(v.of('validate-from-google-note'), 'Added as evidence.');
  await v.click('validate-from-google-dismiss-7');
  assert.ok(v.writes().some((w) => w.key === 'POST /api/cycles/validate/google/proposals/7/dismiss'));
  assert.equal(v.of('validate-from-google-note'), 'Dismissed. It is not offered again.');
  await v.close();

  const none = await mount(h(ValidateFromGoogle, { part: ok({}), module: 'experiments', projectId: 701, reload: () => {} }), {});
  assert.match(none.of('validate-from-google-no-offers'), /No confirmed signal from Google Forms waits/);
  await none.close();
});

test('the states: a teammate or a support session reads why, a company not allowed links to the page, a failed read is this part only with Try again', async () => {
  const team = await mount(h(ValidateFromGoogle, { part: { state: 'team_only', reason: 'Only the venture’s founders choose and sync Google files.' }, module: 'demand_signals', projectId: 701 }));
  assert.equal(team.of('validate-from-google-reason'), 'Only the venture’s founders choose and sync Google files.');
  assert.equal(team.has('from-google'), false, 'no file read, no Sync');
  await team.close();
  const off = await mount(h(ValidateFromGoogle, { part: { state: 'not_connected', reason: 'Google files are not allowed for this venture yet.', href: '/account/connectors/google_workspace' }, module: 'customer_research', projectId: 701 }));
  assert.match(off.of('validate-from-google'), /not allowed for this venture yet\.Open the Google Workspace page ›/);
  await off.close();
  let tried = 0;
  const bad = await mount(h(ValidateFromGoogle, { part: { state: 'unreadable', reason: 'Unreadable: the Google files could not be read. The rest of this page is current.' }, module: 'experiments', projectId: 701, reload: () => { tried += 1; } }));
  assert.match(bad.of('validate-from-google-reason'), /The rest of this page is current\. Try again/);
  await bad.click('validate-from-google-retry');
  assert.equal(tried, 1);
  await bad.close();
  const nothing = await mount(h(ValidateFromGoogle, { part: undefined, module: 'experiments', projectId: 701 }));
  assert.equal(nothing.has('validate-from-google'), false, 'a module read with no part draws nothing');
  await nothing.close();
});

test('the source: mounted on the three modules, no pop-up, no respondent field read, every light hover paired', () => {
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  for (const m of ['customer_research', 'demand_signals', 'experiments']) {
    assert.match(route, new RegExp(`<ValidateFromGoogle part=\\{data\\?\\.parts\\?\\.from_google\\} module="${m}" projectId=\\{ctx\\.projectId\\} reload=\\{ctx\\.reload\\} />`), m);
  }
  const src = readFileSync('frontend/src/pages/cycles/ValidateFromGoogle.jsx', 'utf8');
  assert.doesNotMatch(src, /\b(alert|confirm|prompt)\(/);
  assert.doesNotMatch(src, /respondentEmail|\.email\b|respondent_\w+/, 'no respondent field is read');
  assert.doesNotMatch(src, /dangerouslySetInnerHTML/);
  for (const m of src.matchAll(/(?:^|\s)hover:([a-z-]+)/g)) assert.ok(src.includes(`dark:hover:${m[1]}`), `hover:${m[1]} has its dark pair`);
});
