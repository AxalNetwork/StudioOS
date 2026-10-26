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
  STEPS, WHY, trackOf, keyStrip, termsAtGlance, whatsNewOf, readFailure, blockedRole, noteError, NO_PERMISSION, DEAL_UNREADABLE, EMPTY,
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

test('the key strip: a missing figure is Not recorded with its reason, never 0; your commitment, or the investors for staff', () => {
  const bare = keyStrip({ currency: 'USD' }, { status: 'ready', items: [] }, 'investor');
  assert.deepEqual(bare.map((t) => [t.key, t.value]), [['round', 'Not recorded'], ['committed', 'Not recorded'], ['mine', '—'], ['closes', 'Not recorded']]);
  assert.ok(bare.every((t) => t.value !== '0' && t.value !== '$0'));
  assert.equal(bare[1].bar, null, 'no bar when the share is not known');
  const full = keyStrip(DEAL, { status: 'ready', items: [{ amount: 50000, status: 'pending', investor_user_id: 21 }] }, 'investor');
  assert.deepEqual(full.map((t) => t.value), ['$1,000,000', '$250,000', '$50,000', '2026-12-01']);
  assert.deepEqual([full[1].sub, full[1].bar, full[2].sub], ['25% of the round', 25, 'Pending']);
  assert.equal(keyStrip(DEAL, { status: 'unreadable' }, 'investor')[2].value, 'Unreadable');
  assert.deepEqual(keyStrip(DEAL, { status: 'ready', items: [{ amount: 9000, status: 'withdrawn' }] }, 'investor')[2].value, '—', 'a withdrawn commitment is not yours any more');
  assert.ok(keyStrip(DEAL, { status: 'loading' }, 'investor')[2].loading);
  const staff = keyStrip(DEAL, { status: 'ready', items: [{ investor_user_id: 1, status: 'pending' }, { investor_user_id: 1, status: 'confirmed' }, { investor_user_id: 2, status: 'withdrawn' }, { investor_user_id: 3, status: 'confirmed' }] }, 'admin');
  assert.deepEqual([staff[2].label, staff[2].value], ['Investors', '2'], 'distinct investors with a live commitment');
  assert.deepEqual([keyStrip(DEAL, { status: 'ready', items: null }, 'partner')[2].value], ['Not recorded'], 'a total-only read has no investor count');
});

test('terms at a glance, what is new, a failed deal read, and who never reads a deal', () => {
  assert.deepEqual(termsAtGlance({ currency: 'USD', minimum_check: 25000 }).map((t) => t.value), ['Not recorded', 'Not recorded', '$25,000', 'Not recorded', 'Not recorded']);
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
    tag: (t) => nodes().filter((n) => n.tagName === t),
    async click(id) { const n = byId(id)[0]; assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(id, value) { const n = byId(id)[0]; await act(async () => { props(n).onChange?.({ target: { value } }); }); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

test('an investor\'s Overview: one h1, the key strip, the track at Diligence with one next action, and the Overview cards', async () => {
  const v = await mounted('/deals/4', INVESTOR);
  try {
    assert.equal(v.tag('H1').length, 1);
    assert.match(v.textOf('deal-keys'), /Round\s*\$1,000,000[\s\S]*Committed\s*\$250,000[\s\S]*Your commitment\s*—[\s\S]*Closes\s*2026-12-01/);
    assert.equal(v.byId('deal-step-now').length, 1);
    assert.equal(v.byId('deal-step-done').length, 2);
    assert.equal(v.byId('deal-next-action').length, 1, 'one next action');
    assert.equal(v.textOf('deal-next-action'), 'Open the diligence case');
    assert.match(v.textOf('deal-track-why'), /Step 3 of 8 · Diligence/);
    for (const id of ['deal-score-slot', 'deal-whats-new', 'deal-terms', 'deal-round', 'deal-next-step', 'deal-deck-slot']) assert.ok(v.has(id), id);
    assert.match(v.textOf('deal-score-slot'), /not a score of zero/);
    assert.equal(v.requests.filter((r) => /whats-new/.test(r)).length, 1);
  } finally { await v.close(); }
});

test('a founder sees the key strip with the investors and no track, and reads no stage', async () => {
  const v = await mounted('/deals/4', { id: 30, role: 'founder', founder_id: 9, name: 'Bram', email: 'bram@example.com' });
  try {
    assert.match(v.textOf('deal-keys'), /Investors\s*0/);
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
    for (const id of ['deal-keys', 'deal-tabs', 'deal-overview', 'deal-score-slot']) assert.ok(v.has(id), id);
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
    assert.match(v.textOf('deal-eadwyn-draft'), /AUTOFILL \(#2431\)[\s\S]*nothing lands until you save it/);
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
