// D1087 (#2952, #2405 part 3) — From Notion on Validate: Customer research's
// interview pages imported only through "Import this interview", which asks
// for the interviewee's consent first; Market intelligence's research pages
// as sources. Mounted against a fake `notionApi`; no test reaches Notion.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/notion_validate_d1087.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import FromNotion from '../src/pages/cycles/FromNotion.jsx';
import NotionInterviewImport, { CONSENT_METHODS, NO_CONSENT_NOTE, importBody } from '../src/pages/cycles/NotionInterviewImport.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');

async function mount(el) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => root.render(h(MemoryRouter, null, el)));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join('') : n.textContent || '');
  return {
    by, pr, text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' '),
    disabled: (id) => !!pr(by(id)).disabled,
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async change(id, value, type = 'text') { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { pr(n).onChange({ target: { value, checked: value, type } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const PROPOSAL = { id: 9, mine: true, kind: 'interview', title: 'Interview notes — Customer 4', extract: 'Q: How do you plan routes today?', url: 'https://www.notion.so/x', status: 'pending', changed: false };
const READ = {
  module: 'customer_research', label: 'Customer research', lands: 'proposal', connected: true, can_sync: true, writer_ready: false, fields: [],
  sources: [{ uid: 's1', module: 'customer_research', title: 'Interviews', status: 'active', last_synced_at: '2026-10-21T09:00:00Z' }],
  facts: [], kept_deleted: 0, proposals: [PROPOSAL],
};

function fakeApi(over = {}) {
  const calls = [];
  return {
    calls,
    async fromNotion(...a) { calls.push(['read', ...a]); return over.read || READ; },
    async sync() { return { sources: [] }; },
    async accept(...a) { calls.push(['accept', ...a]); if (over.refuse) { const e = new Error('refused'); e.status = 409; e.code = over.refuse; e.data = { error: over.refuse }; throw e; } return { ok: true }; },
    async dismiss(...a) { calls.push(['dismiss', ...a]); return { ok: true }; },
    async deleteFact() { return { ok: true }; },
  };
}

test('the Accept body: nothing until consent is given with how and when, a label and a date; the interviewee is a label, role and company only', () => {
  const base = { label: 'Ops lead', role: '', company: '', date: '2026-10-20', channel: 'manual', consented: true, method: 'verbal', consentOn: '2026-10-19' };
  assert.deepEqual(importBody(base), {
    interviewee: { label: 'Ops lead' }, occurred_at: '2026-10-20', channel: 'manual',
    consent: { status: 'given', method: 'verbal', recorded_at: '2026-10-19T12:00:00.000Z' },
  });
  for (const k of ['consented', 'method', 'consentOn', 'date']) assert.equal(importBody({ ...base, [k]: k === 'consented' ? false : '' }), null, k);
  assert.equal(importBody({ ...base, label: '  ' }), null, 'a label is needed');
  assert.deepEqual(importBody({ ...base, role: ' Ops ', company: 'Acme' }).interviewee, { label: 'Ops lead', role: 'Ops', company: 'Acme' });
  assert.equal(importBody({ ...base, channel: '' }).channel, 'manual', 'manual by default');
  assert.deepEqual(CONSENT_METHODS.map(([v]) => v), ['verbal', 'written', 'in_app', 'pre_agreed'], 'the Worker\'s CONSENT_METHODS');
  assert.match(read('cloudflare-worker/src/services/interviewSessions.ts'), /CONSENT_METHODS = \['verbal', 'written', 'in_app', 'pre_agreed'\]/);
});

test('Customer research: Accept opens Import this interview; Import stays off until consent is ticked and answered; then the Worker gets the consent', async () => {
  const api = fakeApi();
  const v = await mount(h(FromNotion, { section: 'validate', projectId: 701, module: 'customer_research', api, acceptDialog: NotionInterviewImport }));
  try {
    await v.click('notion-accept-9');
    assert.ok(v.by('notion-interview-import'), 'a dialog, never an immediate accept');
    assert.ok(!api.calls.some((c) => c[0] === 'accept'));
    assert.match(v.text('notion-interview-no-consent'), new RegExp(NO_CONSENT_NOTE.replace(/[’]/g, '.')));
    assert.ok(v.disabled('notion-interview-confirm'), 'off without consent');
    assert.equal(v.pr(v.by('notion-interview-label')).value, PROPOSAL.title, 'the page title is the label to start from');
    await v.change('notion-interview-label', 'Ops lead, logistics firm');
    await v.change('notion-interview-date', '2026-10-20');
    assert.ok(v.disabled('notion-interview-confirm'), 'still off: no consent');
    await v.change('notion-interview-consented', true, 'checkbox');
    assert.ok(v.disabled('notion-interview-confirm'), 'still off: how they agreed');
    await v.change('notion-interview-method', 'written');
    assert.ok(!v.disabled('notion-interview-confirm'));
    await v.click('notion-interview-confirm');
    const accepted = api.calls.find((c) => c[0] === 'accept');
    assert.deepEqual(accepted.slice(1, 4), ['validate', 701, 9]);
    assert.equal(accepted[4].consent.status, 'given'); assert.equal(accepted[4].consent.method, 'written');
    assert.equal(accepted[4].interviewee.label, 'Ops lead, logistics firm'); assert.equal(accepted[4].channel, 'manual');
    assert.ok(!v.by('notion-interview-import'), 'closed once imported');
  } finally { await v.unmount(); }
});

test('a refusal is drawn in the dialog as its own sentence, and nothing closes', async () => {
  const api = fakeApi({ refuse: 'changed_in_notion' });
  const v = await mount(h(FromNotion, { section: 'validate', projectId: 701, module: 'customer_research', api, acceptDialog: NotionInterviewImport }));
  try {
    await v.click('notion-accept-9');
    await v.change('notion-interview-date', '2026-10-20');
    await v.change('notion-interview-consented', true, 'checkbox');
    await v.change('notion-interview-method', 'verbal');
    await v.click('notion-interview-confirm');
    assert.ok(v.by('notion-interview-error'));
    assert.ok(v.by('notion-interview-import'), 'the dialog stays open');
  } finally { await v.unmount(); }
});

test('without an accept dialog, Accept is immediate, as D1086 built it', async () => {
  const api = fakeApi();
  const v = await mount(h(FromNotion, { section: 'raise', projectId: 701, module: 'capital_relationships', api }));
  try {
    await v.click('notion-accept-9');
    assert.deepEqual(api.calls.find((c) => c[0] === 'accept').slice(1, 4), ['raise', 701, 9]);
  } finally { await v.unmount(); }
});

test('the wiring: From Notion on Customer research with the consent dialog, and on Market intelligence', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /<FromNotion section="validate" projectId=\{ctx\.projectId\} module="customer_research" acceptDialog=\{NotionInterviewImport\} \/>/);
  assert.match(route, /'market-intelligence': \(_data, ctx\) => <FromNotion section="validate" projectId=\{ctx\.projectId\} module="market_intelligence" \/>/);
  const dialog = read('frontend/src/pages/cycles/NotionInterviewImport.jsx');
  assert.doesNotMatch(dialog, /window\.(alert|confirm|prompt)/, 'an in-page dialog, never a browser pop-up');
  for (const m of dialog.matchAll(/className=\{?[`"]([^`"]*)[`"]/g)) {
    if (/\bbg-white\b/.test(m[1])) assert.match(m[1], /dark:bg-/, m[1]);
  }
});
