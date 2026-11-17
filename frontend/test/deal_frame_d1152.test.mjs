// D1152 (#3057) — the deal page's frame: the stage track and its one next
// action (DL2), the key strip (DL1), Overview, Notes and Activity (DL14), and
// the states (DL18–DL22), on stubbed reads.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_frame_d1152.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import DealRoomPage from '../src/pages/DealRoomPage.jsx';
import {
  STEPS, WHY, trackOf, financialStrip, termsAtGlance, whatsNewOf, readFailure, blockedRole, noteError, NO_PERMISSION, DEAL_UNREADABLE, EMPTY,
} from '../src/pages/deal/dealFrameModel.js';
import { whatsNewOnce, forgetVisits } from '../src/pages/deal/dealVisit.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const DEAL = { id: 4, project_id: 7, project_name: 'Harbor Ledger', project_sector: 'Fintech', status: 'active', currency: 'USD', target_raise: 1000000, capital_committed: 250000, minimum_check: 25000, progress_pct: 25, instrument: 'Post-money SAFE', closing_deadline: '2026-12-01' };
const INVESTOR = { id: 21, role: 'investor', name: 'Ada', email: 'ada@example.com', subscription_tier: 'professional' };
const stageOf = (my_stage, next = { label: 'Open the diligence case', href: '/due-diligence/dd1', kind: 'navigate' }, ic = { state: 'used' }) => ({ my_stage, reason: null, next_action: next, ic });

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the track: each of the eight steps has exactly one current step and exactly one next action, the Worker\'s', () => {
  STEPS.forEach((word, i) => {
    const next = { label: `Action for ${word}`, href: `/x/${i}`, kind: i === 0 ? 'respond_interest' : 'navigate' };
    const t = trackOf({ status: 'ready', data: stageOf(word, next) });
    assert.equal(t.state, 'ready');
    assert.equal(t.steps.filter((s) => s.kind === 'now').length, 1, word);
    assert.equal(t.steps.findIndex((s) => s.kind === 'now'), i, word);
    assert.deepEqual(t.steps.slice(0, i).map((s) => s.kind), Array(i).fill('done'), `${word}: every earlier step is done`);
    assert.ok(t.steps.slice(i + 1).every((s) => s.kind === 'ahead'), `${word}: every later step is ahead`);
    assert.deepEqual(t.next, next, `${word}: the one next action is the Worker's`);
    assert.equal(t.why, WHY[word]);
  });
});

test('the track: a firm with no IC reads its IC step Not recorded once past it; a pass has no current step; no stage says why', () => {
  const noIc = trackOf({ status: 'ready', data: stageOf('Terms', undefined, { state: 'not_used', reason: 'No IC record is recorded for this firm.' }) });
  assert.deepEqual(noIc.steps.map((s) => s.kind), ['done', 'done', 'done', 'nr', 'now', 'ahead', 'ahead', 'ahead']);
  assert.equal(noIc.steps[3].line, 'Not recorded');
  assert.equal(noIc.icNote, 'No IC record is recorded for this firm.');
  const before = trackOf({ status: 'ready', data: stageOf('Reviewing', undefined, { state: 'not_used' }) });
  assert.equal(before.steps[3].kind, 'ahead', 'an IC step still ahead is not yet "not recorded"');
  assert.equal(trackOf({ status: 'ready', data: stageOf('IC', undefined, { state: 'not_used' }) }).steps[3].kind, 'now', 'the step you are on is never "not recorded"');
  for (const p of ['You passed', 'Passed by the studio']) {
    const t = trackOf({ status: 'ready', data: stageOf(p, { label: 'View deal', href: '/deals/4/overview', kind: 'navigate' }) });
    assert.equal(t.steps.filter((s) => s.kind === 'now').length, 0, p);
    assert.ok(t.steps.every((s) => s.kind === 'ahead'), `${p}: the Worker does not say how far you got, so no step is drawn done`);
    assert.equal(t.passed, p);
  }
  const none = trackOf({ status: 'ready', data: { my_stage: null, reason: 'No current invitation or progress fact is recorded.', next_action: { label: 'View deal', href: '/deals/4/overview', kind: 'navigate' } } });
  assert.deepEqual([none.state, none.reason], ['none', 'No current invitation or progress fact is recorded.']);
  assert.equal(trackOf({ status: 'unreadable' }).state, 'unreadable');
  assert.equal(trackOf({ status: 'loading' }).state, 'loading');
  // No dates come from the Worker, so none is drawn.
  assert.deepEqual(trackOf({ status: 'ready', data: stageOf('IC') }).steps.map((s) => s.line), ['Done', 'Done', 'Done', 'Now', '—', '—', '—', '—']);
});

// D4815 part 4 (#5903): the four-tile key strip became DE04's five-field financial strip, and the
// viewer's own commitment moved to Your position (deals_v2_deal_frame_4815_p4.test.mjs holds both).
test('the financial strip: a missing figure is Not recorded with its reason, never 0', () => {
  const bare = financialStrip({ currency: 'USD' });
  assert.deepEqual(bare.map((t) => [t.key, t.value]), [['round', 'Not recorded'], ['instrument', 'Not recorded'], ['committed', 'Not recorded'], ['minimum', 'Not recorded'], ['closes', 'Not recorded']]);
  assert.ok(bare.every((t) => t.value !== '0' && t.value !== '$0' && t.reason));
  const full = financialStrip(DEAL);
  assert.deepEqual(full.map((t) => t.value), ['$1,000,000', 'Post-money SAFE', '$250,000', '$25,000', '1 Dec 2026']);
});

test('terms at a glance, what is new, a failed deal read, and who never reads a deal', () => {
  // D4815 part 4: Instrument and Minimum are the strip's, so the card no longer repeats them.
  assert.deepEqual(termsAtGlance({ currency: 'USD', minimum_check: 25000, valuation_cap: 8000000 }).map((t) => [t.label, t.value]), [['Valuation cap', '$8,000,000'], ['Carry', 'Not recorded'], ['Management fee', 'Not recorded']]);
  assert.equal(whatsNewOf({ status: 'ready', data: { first_visit: true, changes: [] } }).state, 'first');
  const w = whatsNewOf({ status: 'ready', data: { since: '2026-10-17T00:00:00Z', changes: [{ type: 'document', at: '2026-10-20T10:00:00Z' }, { type: 'investor_commitment', at: null }], unavailable: [{ type: 'deck', reason: 'Deck versions use share-token access.' }] } });
  assert.deepEqual(w.rows, [{ text: 'A document was added', at: '2026-10-20' }, { text: 'An investor committed', at: 'Date not recorded' }]);
  assert.deepEqual([w.since, w.unavailable], ['2026-10-17', ['Deck versions use share-token access.']]);
  assert.equal(whatsNewOf({ status: 'unreadable' }).state, 'unreadable');
  assert.deepEqual([403, 404, 500, undefined].map((s) => readFailure(s == null ? null : { status: s })), ['not_on_deal', 'not_found', 'unreadable', 'unreadable']);
  assert.deepEqual(['advisor', 'exploring', 'investor', 'founder', 'admin'].map(blockedRole), ['advisor', 'exploring', null, null, null]);
  assert.deepEqual([noteError('  '), noteError('ok'), noteError('x'.repeat(10001))], ['Write the note first.', null, 'Keep a note to 10,000 characters.']);
});

test('what is new is read once per deal per visit; a failed read is read again', async () => {
  forgetVisits();
  const prev = globalThis.fetch;
  const prevStore = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  let calls = 0; let fail = true;
  globalThis.fetch = async () => { calls += 1; if (fail) return response({ error: 'changes_unreadable' }, 503); return response({ changes: [] }); };
  try {
    await assert.rejects(whatsNewOnce(4));
    fail = false;
    await whatsNewOnce(4); await whatsNewOnce(4); await whatsNewOnce('4');
    assert.equal(calls, 2, 'one failed read, then one read kept for the visit');
    await whatsNewOnce(5);
    assert.equal(calls, 3, 'another deal is its own visit');
  } finally { globalThis.fetch = prev; globalThis.localStorage = prevStore; forgetVisits(); }
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

function handlerWith(over = {}) {
  return (url, init = {}) => {
    const m = (init.method || 'GET').toUpperCase();
    for (const [re, fn] of Object.entries(over)) if (new RegExp(re).test(url)) { const r = fn(url, m, init); if (r) return r; }
    if (/\/api\/deals\/4\/stage/.test(url)) return response(stageOf('Diligence'));
    if (/\/api\/deals\/4\/whats-new/.test(url)) return response({ first_visit: true, changes: [] });
    if (/\/api\/deals\/4\/notes/.test(url)) return response({ items: [], total: 0 });
    if (/\/api\/deals\/4\/activity/.test(url)) return response([]);
    if (/\/api\/deals\/4\/commitments/.test(url)) return response([]);
    if (/\/api\/deals\/4(\?|$)/.test(url)) return response(DEAL);
    return response({});
  };
}

async function mounted(url, user, handler = handlerWith()) {
  forgetVisits();
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, init) => { requests.push(`${(init?.method || 'GET').toUpperCase()} ${String(u)}`); return handler(String(u), init); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null,
    h(Routes, null,
      h(Route, { path: '/deals/:dealId', element: h(DealRoomPage) }),
      h(Route, { path: '/deals/:dealId/:tab', element: h(DealRoomPage) }))))));
  const settle = async () => { await act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(document.body);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  return {
    requests, text: () => text(document.body), byId,
    has: (id) => byId(id).length > 0,
    textOf: (id) => text(byId(id)[0]),
    hrefOf: (id) => props(byId(id)[0]).href,
    tag: (t) => nodes().filter((n) => n.tagName === t),
    async click(id) { const n = byId(id)[0]; assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async clickText(t) { const n = nodes().find((x) => x.tagName === 'BUTTON' && text(x).trim() === t); assert.ok(n, `no button ${t}`); await act(async () => { props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(id, value) { const n = byId(id)[0]; await act(async () => { props(n).onChange?.({ target: { value } }); }); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

test('an investor\'s Overview: one h1, the financial strip, the track at Diligence with one next action, and the Overview cards', async () => {
  const v = await mounted('/deals/4', INVESTOR);
  try {
    assert.equal(v.tag('H1').length, 1);
    // D4815 part 4: DE04's five fields; the viewer's commitment is Your position, below.
    assert.match(v.textOf('deal-strip'), /Round\s*\$1,000,000[\s\S]*Instrument\s*Post-money SAFE[\s\S]*Committed\s*\$250,000[\s\S]*Minimum\s*\$25,000[\s\S]*Closes\s*1 Dec 2026/);
    assert.match(v.textOf('deal-position'), /You have not committed to this deal/);
    assert.equal(v.byId('deal-step-now').length, 1);
    assert.equal(v.byId('deal-step-done').length, 2);
    assert.equal(v.byId('deal-next-action').length, 1, 'one next action');
    assert.equal(v.textOf('deal-next-action'), 'Open the diligence case');
    // D4815 part 4: the step's position is the header's own chip; the sequence carries the reason.
    assert.equal(v.textOf('deal-progress-chip'), 'Diligence · Step 3 of 8');
    assert.equal(v.textOf('deal-track-why'), WHY.Diligence);
    assert.ok(!v.has('deal-next-step'), 'the one next action is not drawn a second time on Overview');
    for (const id of ['deal-score-slot', 'deal-whats-new', 'deal-terms', 'deal-round', 'deal-deck']) assert.ok(v.has(id), id);
    // D1257: the slot is the strip, read through the batch; a deal the batch does not return is closed, never a zero.
    assert.match(v.textOf('deal-score-slot'), /opens once you are invited to this deal/);
    assert.equal(v.requests.filter((r) => /whats-new/.test(r)).length, 1);
  } finally { await v.close(); }
});

test('a founder sees the financial strip and no track, and reads no stage', async () => {
  const v = await mounted('/deals/4', { id: 30, role: 'founder', founder_id: 9, name: 'Bram', email: 'bram@example.com' });
  try {
    // D4815 part 4: the staff and founder investor count left the strip; it is the Investment tab's table.
    assert.match(v.textOf('deal-strip'), /Round\s*\$1,000,000/);
    assert.ok(!v.has('deal-progress-chip') && !v.has('deal-position'), 'progress and position are an investor\'s');
    assert.ok(!v.has('deal-track') && !v.has('deal-track-loading'));
    assert.ok(!v.requests.some((r) => /\/stage|whats-new|\/notes/.test(r)), 'part 2\'s reads are an investor\'s');
  } finally { await v.close(); }
});

test('a failed stage read leaves the page: the header, key strip, tabs and Overview render, and the track says Unreadable', async () => {
  const v = await mounted('/deals/4', INVESTOR, handlerWith({ '/api/deals/4/stage': () => response({ error: 'stage_unreadable' }, 503) }));
  try {
    assert.ok(v.has('deal-track-unreadable'));
    assert.match(v.textOf('deal-track-unreadable'), /could not be read/);
    assert.equal(v.byId('deal-next-action').length, 0, 'no next action is made up');
    assert.equal(v.tag('H1').length, 1);
    assert.equal(v.textOf('deal-progress-chip'), 'Your step: Unreadable');
    for (const id of ['deal-strip', 'deal-tabs', 'deal-overview', 'deal-score-slot']) assert.ok(v.has(id), id);
  } finally { await v.close(); }
});

test('an Advisor and an Explorer get DL22\'s words, and nothing is read', async () => {
  for (const [role, kind] of [['advisor', 'advisor'], ['exploring', 'exploring']]) {
    const v = await mounted('/deals/4', { id: 40, role, name: 'X', email: 'x@example.com' });
    try {
      assert.match(v.textOf(`deal-no-permission-${kind}`), new RegExp(NO_PERMISSION[kind].title.replace(/[.’]/g, '.')));
      assert.match(v.text(), new RegExp(NO_PERMISSION[kind].line.replace(/[.’]/g, '.')));
      assert.equal(v.requests.filter((r) => /\/api\/deals/.test(r)).length, 0, `${role}: no deal read`);
    } finally { await v.close(); }
  }
});

test('not on the deal is DL22a; a deal read that failed is DL20b, never "not found"', async () => {
  let v = await mounted('/deals/4', INVESTOR, handlerWith({ '/api/deals/4(\\?|$)': () => response({ detail: 'Forbidden' }, 403) }));
  try {
    assert.ok(!v.has('deal-more'));
    assert.match(v.textOf('deal-no-permission-not_on_deal'), /You’re not on this deal\./);
    assert.ok(!v.requests.some((r) => /stage|notes|whats-new|commitments/.test(r)), 'nothing private is read');
  } finally { await v.close(); }
  v = await mounted('/deals/4', INVESTOR, handlerWith({ '/api/deals/4(\\?|$)': () => response({ error: 'boom' }, 500) }));
  try {
    assert.match(v.textOf('deal-unreadable'), /This deal could not be read\. That is not the same as it not existing\./);
    assert.ok(DEAL_UNREADABLE.endsWith('That is not the same as it not existing.'));
    assert.ok(!v.has('deal-not-found'));
  } finally { await v.close(); }
});

test('Deal More copies the current tab, reports failure, and uses the supplied company profile', async () => {
  const tab = '/deals/4/terms?from=flow#valuation';
  const url = 'https://axal.example' + tab;
  const v = await mounted(tab, INVESTOR, handlerWith({
    '/api/deals/4$': () => response({ ...DEAL, company_profile_url: '/startups/harbor-ledger' }),
  }));
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const written = [];
  let refused = false;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { async writeText(value) { if (refused) throw new Error('Denied'); written.push(value); } },
  });
  window.location.href = url;
  try {
    await v.click('deal-more');
    assert.equal(v.hrefOf('deal-open-company-profile'), '/startups/harbor-ledger');
    await v.click('deal-copy-link');
    assert.deepEqual(written, [url]);
    assert.match(v.text(), /Link copied\./);
    refused = true;
    await v.click('deal-more');
    await v.click('deal-copy-link');
    assert.match(v.text(), /Could not copy the link/);
  } finally {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else delete navigator.clipboard;
    await v.close();
  }
});

test('Deal More offers only Copy link without a public profile and is hidden on Free', async () => {
  let v = await mounted('/deals/4', INVESTOR);
  try {
    await v.click('deal-more');
    assert.ok(v.has('deal-copy-link'));
    assert.ok(!v.has('deal-open-company-profile'));
  } finally { await v.close(); }
  v = await mounted('/deals/4', INVESTOR, handlerWith({
    '/api/deals/4$': () => response({ ...DEAL, plan_limited: true }),
  }));
  try {
    assert.ok(!v.has('deal-more'));
  } finally { await v.close(); }
});

test('Invited: the next action asks first, in a dialog, then answers; Pass asks too', async () => {
  const invited = stageOf('Invited', { label: 'I’m interested', href: '/deals/4/overview', kind: 'respond_interest', invitation_uid: 'i1' });
  const v = await mounted('/deals/4', INVESTOR, handlerWith({ '/api/deals/4/stage': () => response(invited), '/api/deals/4/invitations/respond': () => response({ ok: true }) }));
  try {
    await v.click('deal-next-action');
    assert.ok(v.has('deal-respond-dialog'));
    assert.match(v.textOf('deal-respond-dialog'), /Tell the founder you’re interested\?/);
    assert.ok(!v.requests.some((r) => /respond/.test(r)), 'nothing is sent before the confirm');
    await v.click('deal-respond-confirm');
    assert.ok(v.requests.some((r) => r.startsWith('POST') && /\/api\/deals\/4\/invitations\/respond/.test(r)));
    await v.click('deal-pass');
    assert.match(v.textOf('deal-respond-dialog'), /Pass on this deal\?/);
  } finally { await v.close(); }
});

test('Notes: empty says so; your own note has Edit and Delete, a colleague\'s does not; Delete asks in a dialog first', async () => {
  let v = await mounted('/deals/4/notes', INVESTOR);
  try {
    assert.match(v.textOf('deal-notes-empty'), new RegExp(EMPTY.notes.title));
    assert.match(v.textOf('deal-eadwyn-draft'), /Ask on New note drafts a note[\s\S]*Nothing lands until you save it as your note/); // #4046: Ask is on the form now
  } finally { await v.close(); }
  const notes = { items: [{ uid: 'n1', author_user_id: 21, tag: 'Thesis', body: 'Mine', created_at: '2026-10-18T09:00:00Z' }, { uid: 'n2', author_user_id: 99, tag: null, body: 'Theirs', created_at: '2026-10-14T09:00:00Z' }], total: 2 };
  v = await mounted('/deals/4/notes', INVESTOR, handlerWith({
    '/api/deals/4/notes': (u, m) => (m === 'GET' ? response(notes) : response({ ok: true })),
  }));
  try {
    assert.match(v.textOf('deal-note-n1'), /2026-10-18 · You · Thesis/);
    assert.match(v.textOf('deal-note-n2'), /2026-10-14 · Your firm/);
    assert.ok(v.has('deal-note-edit-n1') && v.has('deal-note-delete-n1'));
    assert.ok(!v.has('deal-note-edit-n2') && !v.has('deal-note-delete-n2'), 'only the author edits');
    await v.click('deal-note-delete-n1');
    assert.ok(v.has('deal-note-delete-dialog'));
    assert.ok(!v.requests.some((r) => r.startsWith('DELETE')), 'nothing is deleted before the confirm');
    await v.click('deal-note-delete-confirm');
    assert.ok(v.requests.some((r) => r.startsWith('DELETE') && /\/api\/deals\/4\/notes\/n1/.test(r)));
  } finally { await v.close(); }
});

test('a new note is checked before it is sent, then saved with its tag', async () => {
  const v = await mounted('/deals/4/notes', INVESTOR, handlerWith({ '/api/deals/4/notes': (u, m) => (m === 'POST' ? response({ uid: 'n9' }, 201) : null) }));
  try {
    await v.click('deal-note-save');
    assert.match(v.textOf('deal-note-error'), /Write the note first\./);
    assert.ok(!v.requests.some((r) => r.startsWith('POST')));
    await v.type('deal-note-body', '  Ask about pilots.  ');
    await v.click('deal-note-save');
    assert.ok(v.requests.some((r) => r.startsWith('POST') && /\/api\/deals\/4\/notes/.test(r)));
  } finally { await v.close(); }
});

// #6193 (D6193): the Deal, Documents and Diligence chips narrow on the row's kind; an empty one says what this reader can see.
// Mutation checked: Documents narrowing on `type` instead of `kind` (fails); the empty Diligence line claiming nothing happened (fails).
test('#6193 the activity\'s Deal, Documents and Diligence chips narrow on each row\'s kind', async () => {
  const rows = [
    { type: 'document', kind: 'documents', label: 'Document added: Cap table', at: '2026-10-20', mine: false },
    { type: 'commitment', kind: 'deal', label: 'An investor committed', at: '2026-10-18', mine: false },
    { type: 'created', label: 'Deal created', at: '2026-09-01', mine: false },
  ];
  const v = await mounted('/deals/4/notes', INVESTOR, handlerWith({ '/api/deals/4/activity': () => response(rows) }));
  try {
    await v.click('deal-activity-documents');
    assert.match(v.textOf('deal-activity'), /Document added: Cap table/);
    assert.doesNotMatch(v.textOf('deal-activity'), /An investor committed|Deal created/);
    await v.click('deal-activity-deal');
    assert.match(v.textOf('deal-activity'), /An investor committed[\s\S]*Deal created/, 'a row with no kind is Deal');
    assert.doesNotMatch(v.textOf('deal-activity'), /Cap table/);
    await v.click('deal-activity-diligence');
    assert.match(v.textOf('deal-activity'), /No diligence activity you can read is recorded\. A case shows to its own owner and reviewers\./);
  } finally { await v.close(); }
});

test('the activity\'s Mine filter shows your own rows only', async () => {
  const rows = [{ type: 'commitment', label: 'An investor committed', at: '2026-10-18', mine: false }, { type: 'invitation', label: 'You were invited', at: '2026-09-22', mine: true }];
  const v = await mounted('/deals/4/notes', INVESTOR, handlerWith({ '/api/deals/4/activity': () => response(rows) }));
  try {
    assert.match(v.textOf('deal-activity'), /An investor committed[\s\S]*You were invited/);
    await v.click('deal-activity-mine');
    assert.match(v.textOf('deal-activity'), /You were invited/);
    assert.doesNotMatch(v.textOf('deal-activity'), /An investor committed/);
    await v.click('deal-activity-all');
    assert.match(v.textOf('deal-activity'), /An investor committed/);
    assert.match(v.textOf('deal-activity'), /never name them or their amounts/);
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

test('no browser pop-up and no raw colour anywhere in the frame', () => {
  const files = ['frontend/src/pages/DealRoomPage.jsx', ...readdirSync('frontend/src/pages/deal').filter((f) => /\.(jsx?|md)$/.test(f) && f !== 'README.md').map((f) => `frontend/src/pages/deal/${f}`)];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /\b(window\.)?(alert|confirm|prompt)\(/, `${f} opens a browser pop-up`);
    if (f.includes('/deal/')) {
      // An issue number such as "(#3057)" or "of #2421" is not a colour.
      const code = src.replace(/(^|[\s(,])#\d{4}\b/g, '$1');
      assert.deepEqual(code.match(/#[0-9a-fA-F]{3,8}\b/g) || [], [], `${f} carries a raw colour`);
      assert.doesNotMatch(src, /\b(bg|text|border)-\[#/, `${f} carries an arbitrary colour class`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * #6192: every note is reachable, each names its author, tags filter
 * ------------------------------------------------------------------ */

const note = (i, over = {}) => ({ uid: `p${i}`, author_user_id: 99, author_name: 'Grace Example', tag: i % 2 ? 'Risk' : 'Thesis', body: `Note ${i}`, created_at: '2026-10-01T09:00:00.000Z', updated_at: '2026-10-01T09:00:00.000Z', ...over });

// Mutation checked: noteAuthor ignoring author_name (fails); noteEdited true when equal (fails); notesHaveMore ignoring total (fails).
test('#6192 byline: the colleague\'s name or You, and edited only when it was changed', async () => {
  const { noteAuthor, noteEdited, noteByline, notesHaveMore } = await import('../src/pages/deal/dealNotesModel.js');
  assert.equal(noteAuthor(note(1), 21), 'Grace Example');
  assert.equal(noteAuthor(note(1, { author_user_id: 21 }), 21), 'You');
  assert.equal(noteAuthor(note(1, { author_name: null }), 21), 'Your firm', 'an account with no name');
  assert.equal(noteEdited(note(1)), null);
  assert.equal(noteEdited(note(1, { updated_at: '2026-10-03T10:00:00.000Z' })), 'edited 2026-10-03');
  assert.equal(noteByline(note(1, { updated_at: '2026-10-03T10:00:00.000Z' }), 21), '2026-10-01 · Grace Example · Risk · edited 2026-10-03');
  assert.equal(noteByline(note(2, { tag: '' }), 21), '2026-10-01 · Grace Example');
  assert.deepEqual([notesHaveMore([1, 2], 3), notesHaveMore([1, 2, 3], 3), notesHaveMore([1], undefined)], [true, false, false]);
});

// Mutation checked: Show more reading offset 0 again (fails); a failed page dropping the loaded rows (fails);
// the chip not sending ?tag= (fails); the count not following the filter (fails).
test('#6192 Notes: Show more reaches every note; a failed page says so and keeps what was loaded; a tag chip filters with its count', async () => {
  const all = Array.from({ length: 60 }, (_, i) => note(i + 1));
  let failNext = false;
  const v = await mounted('/deals/4/notes', INVESTOR, handlerWith({
    '/api/deals/4/notes': (u, m) => {
      if (m !== 'GET') return null;
      const q = new URL(u, 'https://x.test').searchParams;
      if (failNext && Number(q.get('offset')) > 0) return response({ error: 'notes_unreadable' }, 503);
      const tag = q.get('tag');
      const rows = tag ? all.filter((n) => n.tag === tag) : all;
      const off = Number(q.get('offset')); const lim = Number(q.get('limit'));
      return response({ items: rows.slice(off, off + lim), total: rows.length, tag: tag || null });
    },
  }));
  try {
    assert.equal(v.byId('deal-note-byline-p1').length, 1);
    assert.match(v.textOf('deal-note-byline-p1'), /Grace Example · Risk/);
    assert.ok(!v.has('deal-note-p26'), 'the first page is 25');
    assert.match(v.textOf('deal-notes-more'), /Show more \(25 of 60\)/);
    failNext = true;
    await v.click('deal-notes-more');
    assert.match(v.text(), /The older notes could not be read/);
    assert.ok(v.has('deal-note-p25'), 'the loaded notes stay');
    failNext = false;
    await v.clickText('Retry');
    assert.ok(v.has('deal-note-p50') && !v.has('deal-note-p51'));
    assert.match(v.textOf('deal-notes-more'), /Show more \(50 of 60\)/);
    await v.click('deal-notes-more');
    assert.ok(v.has('deal-note-p60'), 'the last note is reached');
    assert.ok(!v.has('deal-notes-more'), 'nothing left to show');
    assert.ok(v.requests.some((r) => /notes\?limit=25&offset=25/.test(r)), 'the next page starts after the loaded rows');
    await v.click('deal-notes-filter-Risk');
    assert.ok(v.requests.some((r) => /notes\?limit=25&offset=0&tag=Risk/.test(r)), 'the filter is the Worker\'s');
    assert.equal(v.textOf('deal-notes-count'), '30 tagged Risk', 'the count follows the filter');
    assert.ok(v.has('deal-note-p1') && !v.has('deal-note-p2'), 'only Risk notes');
    assert.match(v.textOf('deal-notes-more'), /Show more \(25 of 30\)/);
    await v.click('deal-notes-filter-Decision');
    assert.match(v.textOf('deal-notes-empty'), /No note is tagged Decision/);
    await v.click('deal-notes-filter-all');
    assert.equal(v.textOf('deal-notes-count'), '60');
  } finally { await v.close(); }
});
