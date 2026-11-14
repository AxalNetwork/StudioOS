// D6064 (#6064) — Share & analytics, viewer feedback on the founder's read (`GET /api/decks/:id/share-feedback`).
//
//   1. The model: the block's states (loading, unreadable, refused, empty, ready), feedback by link,
//      reactions per card, the viewer label (never an identity), the cap line.
//   2. The mounted block: it reads with the board's version, says the note is also on Customer
//      Discovery, and draws each state, Try again included.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/share_feedback_6064.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import ShareFeedback from '../src/pages/raise/pitch/ShareFeedback.jsx';
import { deckShareFeedbackApi } from '../src/lib/api/deckShareFeedback.js';
import {
  DISCOVERY_NOTE, FEEDBACK_EMPTY, FEEDBACK_REFUSED, FEEDBACK_UNREADABLE, NO_LINK,
  byLink, capLine, cardTally, failedStatus, feedbackState, reactionLabel, viewerLabel,
} from '../src/pages/raise/pitch/shareFeedbackModel.js';

const h = React.createElement;
const ok = (data) => ({ status: 'ok', data });
const READ = {
  deck_id: 41, cap: 200, truncated: false, discovery_mirror: true,
  items: [
    { id: 3, created_at: '2026-10-04 08:00:00', deck_id: 41, version: 7, link: { id: 2, investor: { label: 'Fund C', fund: null } }, viewer: 'anonymous',
      reactions: [{ card_uid: 'traction', place: 1, title: 'Traction', reaction: 'confused' }], note: 'Unclear traction.', problem_fit: null, willingness_to_pay: null },
    { id: 2, created_at: '2026-10-03 12:05:00', deck_id: 41, version: 7, link: { id: 1, investor: { label: 'Pat Partner', fund: 'Fund A' } }, viewer: 'signed_in',
      reactions: [{ card_uid: 'cover', place: 0, title: 'Cover', reaction: 'like' }, { card_uid: 'traction', place: 1, title: 'Traction', reaction: 'want_more' }],
      note: 'Strong team.', problem_fit: 'strong', willingness_to_pay: '$200/seat' },
    { id: 1, created_at: '2026-10-01 08:00:00', deck_id: 41, version: 7, link: null, viewer: 'anonymous', reactions: [], note: 'Nice.', problem_fit: null, willingness_to_pay: null },
    { id: 0, created_at: '2026-09-30 08:00:00', deck_id: 41, version: 7, link: { id: 2, investor: { label: 'Fund C', fund: null } }, viewer: 'anonymous',
      reactions: [{ card_uid: 'traction', place: 1, title: 'Traction', reaction: 'confusing' }], note: null, problem_fit: null, willingness_to_pay: null },
  ],
};

test('#6064 the block\'s states: loading, unreadable, refused, empty, ready', () => {
  assert.equal(feedbackState({ status: 'loading' }), 'loading');
  assert.equal(feedbackState({ status: 'error' }), 'unreadable');
  assert.equal(feedbackState({ status: 'refused' }), 'refused');
  assert.equal(feedbackState(ok({ items: [] })), 'empty');
  assert.equal(feedbackState(ok(READ)), 'ready');
  // Mutation checked: treating every failure as Unreadable → a 403 reads "couldn't be read" and this fails.
  assert.deepEqual([failedStatus({ status: 403 }), failedStatus({ status: 404 }), failedStatus({ status: 500 }), failedStatus(new Error('x'))], ['refused', 'refused', 'error', 'error']);
});

test('#6064 feedback by link, newest link first, no link last; reactions per card in card order', () => {
  const g = byLink(READ.items);
  assert.deepEqual(g.map((x) => [x.label, x.fund, x.items.map((i) => i.id)]), [['Fund C', null, [3, 0]], ['Pat Partner', 'Fund A', [2]], [NO_LINK, null, [1]]]);
  // Mutation checked: keeping first-seen order → the no-link group, seen first here, is not last.
  assert.deepEqual(byLink([{ id: 9, link: null }, ...READ.items]).map((x) => x.label), ['Fund C', 'Pat Partner', NO_LINK]);
  const t = cardTally(READ.items);
  assert.deepEqual(t.map((c) => [c.title, c.counts]), [['Cover', { like: 1 }], ['Traction', { confused: 2, want_more: 1 }]], '"confusing" and "confused" are one reaction');
  assert.deepEqual([reactionLabel('like'), reactionLabel('want_more'), reactionLabel('odd')], ['Like', 'Want more', 'odd']);
});

test('#6064 a viewer is signed in or anonymous, never a name; the cap says so', () => {
  assert.equal(viewerLabel('signed_in'), 'Signed-in viewer');
  assert.equal(viewerLabel('anonymous'), 'Anonymous');
  assert.equal(viewerLabel(undefined), 'Anonymous', 'anything not signed in is anonymous');
  assert.equal(capLine(READ), null);
  assert.match(capLine({ ...READ, truncated: true }), /newest 200/);
});

async function mount(answer, props = { deckId: 41, version: '7' }) {
  const calls = [];
  const orig = deckShareFeedbackApi.read;
  deckShareFeedbackApi.read = (...a) => { calls.push(a); return answer(...a); };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); });
  await act(async () => { root.render(h(ShareFeedback, props)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, settle, pr, walk,
    text: () => text(container).replace(/\s+/g, ' '),
    async unmount() { await act(async () => root.unmount()); restore(); deckShareFeedbackApi.read = orig; },
  };
}

test('#6064 the mounted block reads with the board\'s version and draws feedback by link', async () => {
  const m = await mount(async () => READ);
  try {
    assert.deepEqual(m.calls[0], [41, { version: '7' }]);
    assert.ok(m.text().includes(DISCOVERY_NOTE), 'it says the note is also on the Customer Discovery panel');
    assert.ok(m.by('share-feedback-cards') && m.by('share-feedback-link-1') && m.by('share-feedback-link-2') && m.by('share-feedback-none'));
    assert.match(m.text(), /Traction Confused 2 · Want more 1/);
    assert.match(m.text(), /Pat Partner · Fund A/);
    assert.match(m.text(), /Signed-in viewer · v7/);
    assert.match(m.text(), /Strong team\./);
    assert.match(m.text(), /Problem fit: Strong/);
    assert.equal(m.by('share-feedback-cap'), undefined);
  } finally { await m.unmount(); }
});

test('#6064 the mounted block\'s states: unreadable with Try again, refused, empty, cap', async () => {
  let fail = true;
  const m = await mount(async () => { if (fail) throw Object.assign(new Error('x'), { status: 500 }); return READ; });
  try {
    assert.ok(m.text().includes(FEEDBACK_UNREADABLE));
    fail = false;
    const btn = m.walk(m.by('share-feedback-unreadable')).find((n) => n.tagName === 'BUTTON');
    await act(async () => { m.pr(btn).onClick(); });
    await m.settle();
    assert.ok(m.by('share-feedback-cards'), 'Try again reads again');
  } finally { await m.unmount(); }
  const r = await mount(async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); });
  try { assert.ok(r.text().includes(FEEDBACK_REFUSED)); assert.ok(!r.text().includes(FEEDBACK_UNREADABLE), 'a refusal is not a failed read'); } finally { await r.unmount(); }
  const e = await mount(async () => ({ ...READ, items: [] }));
  try { assert.ok(e.text().includes(FEEDBACK_EMPTY)); } finally { await e.unmount(); }
  const c = await mount(async () => ({ ...READ, truncated: true }));
  try { assert.ok(c.by('share-feedback-cap')); } finally { await c.unmount(); }
});
