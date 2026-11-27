/**
 * #3657 — each role sees only the Pitch controls the Worker lets it use.
 *
 *   · Check (PD13): the panel reads first and runs only on the read's own
 *     `can_check: true`. HQ may edit a deck (#3637), but editing never makes a
 *     reader the founder: no POST on open, no Run the check, no record swap;
 *     a `founder_only` refusal turns to the read view, never a retry loop.
 *   · Review (PD14): Run is offered only after the reviews read answers
 *     `viewer: 'founder'`; never while it loads, after it fails, or for
 *     admin, Super Admin or an unknown viewer. A `read_only` refusal removes
 *     the button.
 *
 * The Worker keeps both policies (deck_check.ts `founderOnly`, deck_review.ts
 * `read_only`); nothing here widens them. Every name and figure is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_capabilities_3657.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { deckCheckApi } from '../src/lib/api/deckCheck.js';
import CheckPanel from '../src/pages/raise/pitch/CheckPanel.jsx';
import PitchReview from '../src/pages/raise/pitch/PitchReview.jsx';
import { isFounderOnly, mayRunCheck } from '../src/pages/raise/pitch/checkModel.js';
import { isReviewReadOnly, mayRunReview } from '../src/pages/raise/pitch/reviewModel.js';

const h = React.createElement;
const refusal = (code, message) => Object.assign(new Error(message), { code, status: 403, data: { error: code, message } });
const MISMATCH = { uid: 'c1', slide: 2, figure: 'paying_customers', label: 'Paying customers', state: 'mismatch', display_state: 'mismatch', stated_shown: '42', record: { value: 38, shown: '38', provider: 'stripe', observed_on: '2026-10-20' }, note: null };
const READ = (over = {}) => ({ deck_id: 21, version: 'v2', checked: true, checked_at: '2026-10-27 14:05:00', can_check: false, counts: { mismatch: 1 }, figures: 1, claims: [MISMATCH], ...over });

test('the capability helpers: only the Worker\'s own yes is a yes', () => {
  // Mutation checked: `can_check !== false` (the old rule) → an unread panel may run; viewer read as "not admin" → an unknown viewer may run.
  assert.equal(mayRunCheck(READ({ can_check: true }), false), true);
  for (const [data, ro] of [[READ({ can_check: true }), true], [READ({ can_check: false }), false], [READ({ can_check: undefined }), false], [null, false], [undefined, false]]) {
    assert.equal(mayRunCheck(data, ro), false, JSON.stringify({ can: data?.can_check, ro }));
  }
  assert.equal(mayRunReview({ status: 'ok', data: { viewer: 'founder' } }, false), true);
  for (const hist of [{ status: 'loading', data: null }, { status: 'error', data: null }, { status: 'ok', data: { viewer: 'admin' } }, { status: 'ok', data: { viewer: 'super_admin' } }, { status: 'ok', data: { viewer: 'support' } }, { status: 'ok', data: {} }]) {
    assert.equal(mayRunReview(hist, false), false, JSON.stringify(hist));
  }
  assert.equal(mayRunReview({ status: 'ok', data: { viewer: 'founder' } }, true), false, 'a read-only page never runs');
  assert.equal(isFounderOnly(refusal('founder_only', 'x')), true);
  assert.equal(isFounderOnly({ data: { error: 'founder_only' } }), true);
  assert.equal(isFounderOnly(refusal('down', 'x')), false);
  assert.equal(isReviewReadOnly(refusal('read_only', 'x')), true);
  assert.equal(isReviewReadOnly(refusal('ai_disabled', 'x')), false);
});

function stubCheck(answers) {
  const calls = [];
  Object.assign(deckCheckApi, {
    read: async (...a) => { calls.push('read'); return answers.read(...a); },
    run: async (...a) => { calls.push('run'); return answers.run(...a); },
    useRecord: async () => { calls.push('useRecord'); return {}; },
  });
  return calls;
}

async function mount(el) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, null, el)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, text: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(), all: () => txt(container).replace(/\s+/g, ' '),
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}
const panel = (props = {}) => h(CheckPanel, { deck: { id: 21 }, projectId: 7, readOnly: false, dirty: false, ...props });

test('HQ editing a deck: the read says no, so nothing is posted and no check control is offered', async () => {
  // Mutation checked: the panel runs on `!readOnly` (the #3654 bug) → a run is posted; Run shown on `!readOnly` → the button appears.
  const calls = stubCheck({ read: async () => READ({ can_check: false }), run: async () => { throw refusal('founder_only', 'Only the venture’s founder checks the deck against the records.'); } });
  const v = await mount(panel({ readOnly: false }));
  try {
    assert.deepEqual(calls, ['read'], 'no POST on open for a reader who is not the founder');
    assert.ok(!v.by('pitch-check-run'), 'no Run the check');
    assert.ok(!v.by('pitch-check-use-c1') && !v.by('pitch-check-keep-c1'), 'no record swap or note');
    assert.ok(!v.by('pitch-check-error'), 'no refusal, because nothing was attempted');
    assert.match(v.text('pitch-check-summary'), /1 figure/, 'the last check\'s states still read');
  } finally { await v.close(); }

  const never = stubCheck({ read: async () => READ({ can_check: false, checked: false, checked_at: null, counts: null, claims: [] }), run: async () => assert.fail('never') });
  const w = await mount(panel({ readOnly: false }));
  try {
    assert.deepEqual(never, ['read']);
    assert.match(w.text('pitch-check-never'), /The venture’s founder runs the check\./);
  } finally { await w.close(); }
});

test('a founder_only refusal turns the panel to the read view: no error, no Try again, no second POST', async () => {
  // Mutation checked: the refusal shown as an error → Try again appears; can_check kept → Run the check stays.
  const calls = stubCheck({ read: async () => READ({ can_check: true }), run: async () => { throw refusal('founder_only', 'Only the venture’s founder checks the deck against the records.'); } });
  const v = await mount(panel());
  try {
    assert.deepEqual(calls, ['read', 'run']);
    assert.ok(!v.by('pitch-check-error') && !v.by('pitch-check-retry'), 'no retry loop on a policy refusal');
    assert.ok(!v.by('pitch-check-run'));
    assert.ok(!v.by('pitch-check-use-c1'));
    assert.match(v.text('pitch-check-summary'), /1 figure/);
  } finally { await v.close(); }
});

test('the founder: read, then the check runs; a failed read retries the read, never a blind POST', async () => {
  // Mutation checked: Try again posts while nothing was read → the first retry is a run.
  let fail = true;
  const calls = stubCheck({ read: async () => { if (fail) { fail = false; throw refusal('down', 'The check could not be read.'); } return READ({ can_check: true }); }, run: async () => READ({ can_check: true }) });
  const v = await mount(panel());
  try {
    assert.deepEqual(calls, ['read']);
    assert.ok(v.by('pitch-check-error'));
    assert.ok(!v.by('pitch-check-run'), 'unknown is no');
    await v.click('pitch-check-retry');
    assert.deepEqual(calls, ['read', 'read', 'run']);
    assert.ok(v.by('pitch-check-run'), 'the founder gets Run the check');
    assert.ok(v.by('pitch-check-use-c1'));
  } finally { await v.close(); }
});

const versions = { versions: [{ id: 41, version: 4, title: 'Synthetic seed', is_current: 1, created_at: '2026-10-21 09:00:00' }] };
const reads = { versions: { status: 'ok', data: versions }, deck: { status: 'ok', data: { id: 41, slides: [{ title: 'One' }] } }, projects: { status: 'ok', data: [{ id: 7 }] }, project: { id: 7 }, reload() {} };
const ORIGINAL = { deckReviews: api.deckReviews, deckReviewVersion: api.deckReviewVersion, deckReviewer: api.deckReviewer };

async function review(deckReviews, deckReviewVersion = async () => ({})) {
  const calls = [];
  api.deckReviews = async (...a) => { calls.push('read'); return deckReviews(...a); };
  api.deckReviewVersion = async (...a) => { calls.push('run'); return deckReviewVersion(...a); };
  api.deckReviewer = { ...(ORIGINAL.deckReviewer || {}), list: async () => ({ reviews: [] }) };
  const v = await mount(h(PitchReview, { reads, readOnly: false }));
  return { v, calls, async close() { await v.close(); Object.assign(api, ORIGINAL); } };
}

test('Review: Run only after the read answers founder; never while loading, after a failure, or for HQ', async () => {
  // Mutation checked: canRun as "not admin" (the old rule) → Run shows while loading and for an unknown viewer.
  let release;
  const pending = await review(() => new Promise((r) => { release = r; }));
  try {
    assert.ok(!pending.v.by('pitch-review-run'), 'no Run, not even a disabled one, before the Worker answers');
    await act(async () => { release({ viewer: 'founder', reviews: [] }); });
    await act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
    assert.ok(pending.v.by('pitch-review-run'), 'the founder is offered Run');
  } finally { await pending.close(); }

  for (const viewer of ['super_admin', 'admin', 'support']) {
    const r = await review(async () => ({ viewer, reviews: [] }));
    try {
      assert.ok(!r.v.by('pitch-review-run'), viewer);
      assert.match(r.v.text('pitch-review-readonly'), /Only the venture's founders run a review/);
    } finally { await r.close(); }
  }
  const failed = await review(async () => { throw new Error('read failed'); });
  try { assert.ok(!failed.v.by('pitch-review-run')); } finally { await failed.close(); }
});

test('Review: a read_only refusal removes Run instead of offering it again', async () => {
  // Mutation checked: the refusal treated as a failed run → Run stays and the error invites another press.
  const r = await review(async () => ({ viewer: 'founder', reviews: [] }), async () => { throw refusal('read_only', 'Only the venture\'s founders run a review. You can read the reviews.'); });
  try {
    await r.v.click('pitch-review-run');
    assert.ok(r.v.by('pitch-review-confirm'), 'the dialog asks first');
    await r.v.click('pitch-review-confirm');
    assert.deepEqual(r.calls, ['read', 'run']);
    assert.ok(!r.v.by('pitch-review-run'), 'no second offer');
    assert.match(r.v.text('pitch-review-readonly'), /Only the venture's founders run a review/);
  } finally { await r.close(); }
});
