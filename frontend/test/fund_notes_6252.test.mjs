// #6252 (D6252, owner's Q1 answer A): the brief's Accept keeps it as the fund's note; the fund page shows the newest.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import FundPage from '../src/pages/FundPage.jsx';
import { fundDraftsApi } from '../src/lib/api/fundDrafts.js';
import { mountForm } from './_form_d695.mjs';

const page = { currency: 'USD', can_manage: true, periods: [], fund: { id: 10, name: 'Recorded Fund', status: 'investing', vintage_year: 2026, size_cents: 1000000, lp_count: 2,
  gp: { name: 'Recorded GP', title: null, entity: 'GP entity', email: 'gp@example.test' }, providers: { fund_admin: 'Recorded administrator', auditor: null, legal_counsel: null, custodian: null, valuation_policy: null } },
  totals: { committed_cents: 200000, invested_cents: 22222, invested_reason: null }, lpa: { status: 'signed', version: 3, updated_at: '2026-07-01' } };
const sources = [{ n: 1, kind: 'fund', ref: 'fund:10:status', label: 'Status: investing', date: null }];
const draft = { draft: { kind: 'fund_brief', body: 'Recorded Fund is investing [1].', stored: false, sources } };
const ready = (data) => ({ loading: false, error: null, data, reload() {} });
const mount = (data = page) => mountForm(React.createElement(FundPage, { reading: ready(data) }));

function stub(over = {}) {
  const originals = { brief: fundDraftsApi.brief, keepBrief: fundDraftsApi.keepBrief, briefNote: fundDraftsApi.briefNote };
  const calls = { keep: [], note: 0 };
  fundDraftsApi.brief = async () => draft;
  fundDraftsApi.briefNote = over.briefNote || (async () => { calls.note++; return { note: null }; });
  fundDraftsApi.keepBrief = over.keepBrief || (async (fundId, d) => { calls.keep.push([fundId, d]); return { note: { id: 1, kind: 'brief', body: d.body, sources: d.sources, author: { id: 2, name: 'Recorded GP' }, created_at: '2026-11-15 23:40:00' } }; });
  return { calls, restore: () => Object.assign(fundDraftsApi, originals) };
}

test('D6252 Accept writes the drafted brief and its sources, and the page then shows it as the kept note', async () => {
  const s = stub();
  const view = await mount();
  try {
    assert.doesNotMatch(view.text(), /Fund brief · kept/, 'nothing kept yet, nothing shown');
    assert.doesNotMatch(view.text(), /waiting on a decision/, 'the placeholder sentence is gone');
    await view.click('Draft the brief');
    await view.click('Accept');
    assert.deepEqual(s.calls.keep, [[10, draft.draft]]);
    const text = view.text();
    assert.match(text, /Fund brief · kept/);
    assert.match(text, /Recorded Fund is investing \[1\]\./);
    assert.match(text, /Kept by Recorded GP · 2026-11-15 23:40:00/);
    assert.match(text, /Status: investing/);
    assert.equal(view.nodes().some((n) => n.tagName === 'BUTTON' && /^Accept$/.test(view.text(n))), false, 'the draft is cleared once kept');
  } finally { await view.unmount(); s.restore(); }
});

test('D6252 the page shows the newest kept brief on load, to whoever can manage the fund only', async () => {
  const s = stub({ briefNote: async () => ({ note: { id: 4, kind: 'brief', body: 'Kept earlier [1].', sources, author: { id: 1, name: null }, created_at: '2026-11-10 08:00:00' } }) });
  const view = await mount();
  try {
    assert.match(view.text(), /Kept earlier \[1\]\./);
    assert.match(view.text(), /Not recorded/, "an author with no recorded name says so");
  } finally { await view.unmount(); }
  let reads = 0;
  fundDraftsApi.briefNote = async () => { reads++; return { note: null }; };
  const lp = await mount({ ...page, can_manage: false });
  try { assert.equal(reads, 0, 'a reader who cannot manage the fund asks for no note'); assert.doesNotMatch(lp.text(), /Fund brief/); }
  finally { await lp.unmount(); s.restore(); }
});

test('D6252 a refused Accept keeps the draft and shows the Worker\'s sentence; an unexpected failure says nothing was written', async () => {
  const sentence = 'The brief cites a record this fund does not hold, so it was not kept. Draft the brief again.';
  for (const [failure, expected] of [[Object.assign(new Error(sentence), { status: 422 }), sentence], [new Error('SQLITE internals'), 'The brief could not be kept. Nothing was written. Try again.']]) {
    const s = stub({ keepBrief: async () => { throw failure; } });
    const view = await mount();
    try {
      await view.click('Draft the brief');
      await view.click('Accept');
      const text = view.text();
      assert.ok(text.includes(expected), expected);
      assert.doesNotMatch(text, /SQLITE/);
      assert.match(text, /Recorded Fund is investing \[1\]\./, 'the draft stays');
      assert.doesNotMatch(text, /Fund brief · kept/);
    } finally { await view.unmount(); s.restore(); }
  }
});

test('D6252 an unreadable note is said, never shown as none', async () => {
  const s = stub({ briefNote: async () => { throw Object.assign(new Error('x'), { status: 503 }); } });
  const view = await mount();
  try { assert.match(view.text(), /Unreadable: the fund note could not be read\./); } finally { await view.unmount(); s.restore(); }
});
