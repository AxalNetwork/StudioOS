/**
 * D778 part 8 (#2103) — the session digest's three presses name their option
 * on the run: `summarise:session` (Summarise, on the interview's Transcript
 * tab and the session page), `structure:transcript` (Structure the
 * transcript) and `ask:transcript` (Ask). Each keeps the mounted rail's page.
 * A run answers only the session it was pressed on: opening another session
 * drops its result, its refusal and its re-reads.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_session_digest_d778.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { ReviewStep, makeReviewActions, REVIEW_INITIAL } from '../src/pages/founder/InterviewSessionPage.jsx';
import { clearRailPage, setRailPage } from '../src/lib/railPage.js';
import { mountContracts } from './_contracts_dom.mjs';
import * as F from './_interview_review_fixtures.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function holder() {
  let st = { ...REVIEW_INITIAL };
  return { set: (fn) => { st = fn(st); }, get: () => st };
}

function fakeApi() {
  const calls = [];
  return {
    calls,
    api: {
      placements: async (id) => { calls.push(['placements', id]); return F.PLACEMENTS_NONE; },
      structure: async (id, model, headers) => { calls.push(['structure', id, model, headers]); return F.STRUCTURED; },
      ask: async (id, q, headers) => { calls.push(['ask', id, q, headers]); return F.ASK_OK; },
    },
  };
}

test('Structure and Ask each send their own option with the run, keeping the mounted rail\'s page', async () => {
  // Mutation checked: drop either press's headers → its request carries no option.
  for (const mounted of [null, 'Validate']) {
    const token = mounted ? setRailPage(mounted, 'draft:old') : null;
    try {
      const { api, calls } = fakeApi();
      const a = makeReviewActions({ api, sessionId: 7, set: holder().set });
      await a.structure();
      await a.ask('How do they reconcile?');
      const s = calls.find((c) => c[0] === 'structure');
      const q = calls.find((c) => c[0] === 'ask');
      assert.equal(s[3]['X-Rail-Option'], encodeURIComponent('structure:transcript'));
      assert.equal(q[3]['X-Rail-Option'], encodeURIComponent('ask:transcript'));
      assert.equal(q[2], 'How do they reconcile?');
      // railPage.js lower-cases the page, as the switch's section is.
      for (const c of [s, q]) assert.equal(c[3]['X-Rail-Page'], mounted ? 'validate' : undefined, 'the mounted page holds the switch');
    } finally { if (token) clearRailPage(token); }
  }
});

test('a press whose session is no longer open drops its result, its refusal, its re-read and its receipt read', async () => {
  // Mutation checked: `put` writing whatever `isLive` says → the old session's state lands.
  let live = true; let spent = 0;
  const h = holder();
  const calls = [];
  let finish;
  const api = {
    placements: async (id) => { calls.push(['placements', id]); return F.PLACEMENTS_ONE_RUN; },
    structure: () => new Promise((ok) => { finish = ok; }),
    ask: async () => { live = false; throw F.BUDGET_ERROR; },
  };
  const a = makeReviewActions({ api, sessionId: 7, set: h.set, onSpent: () => { spent += 1; }, isLive: () => live });
  const running = a.structure();
  assert.equal(h.get().running, true, 'the press shows running');
  live = false;
  finish(F.STRUCTURED);
  await running;
  assert.equal(h.get().running, true, 'no write after the session changed (the new session starts clean on its own)');
  assert.deepEqual(calls, [], 'the old session\'s placements are not re-read');
  assert.equal(spent, 0, 'the old receipt is not read');
  live = true;
  await a.ask('?');
  assert.equal(h.get().ask.error, null, 'a refusal for a session no longer open is dropped');
  assert.equal(spent, 0);
});

/** ReviewStep under a host that switches session, as InterviewReviewPage's picker does. */
async function mountStep() {
  const calls = [];
  const pending = [];
  const spent = [];
  const api = {
    placements: async (id) => { calls.push(['placements', id]); return F.PLACEMENTS_NONE; },
    structure: (id, model, headers) => { calls.push(['structure', id, model, headers]); return new Promise((ok, no) => pending.push({ ok, no })); },
    ask: async () => F.ASK_OK,
  };
  let switchTo;
  function Host() {
    const [sid, setSid] = React.useState(7);
    switchTo = setSid;
    const onSpent = React.useCallback(() => { spent.push(sid); }, [sid]);
    return React.createElement(ReviewStep, { api, sessionId: sid, theme: 'light', receiptItems: [], onSpent });
  }
  const m = await mountContracts(React.createElement(Host), '/validate/customer-research/31');
  const settle = async () => { for (let i = 0; i < 4; i += 1) await m.flush(); };
  await settle();
  const byTestId = (id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
  return {
    ...m, calls, pending, spent, settle, byTestId,
    async open(sid) { await act(async () => { switchTo(sid); }); await settle(); },
  };
}

test('ReviewStep: a Structure still at the model when another session opens is dropped, and the new session is pressable', async () => {
  // Mutation checked: the effect's cleanup not ending `live` → session 7's run re-reads 7 and reads its receipt into 8.
  const m = await mountStep();
  try {
    const button = m.byTestId('button-structure');
    assert.ok(button, 'Structure the transcript is drawn');
    await act(async () => { m.props(button).onClick(); });
    await m.settle();
    assert.equal(m.calls.filter((c) => c[0] === 'structure')[0][1], 7);
    await m.open(8);
    assert.deepEqual(m.calls.filter((c) => c[0] === 'placements').map((c) => c[1]), [7, 8]);
    await act(async () => { m.pending[0].ok(F.STRUCTURED); });
    await m.settle();
    assert.deepEqual(m.calls.filter((c) => c[0] === 'placements').map((c) => c[1]), [7, 8], 'session 7 is not re-read into 8');
    assert.deepEqual(m.spent, [], 'session 7\'s receipt is not read');
    const again = m.byTestId('button-structure');
    assert.ok(again, 'session 8 is drawn');
    await act(async () => { m.props(again).onClick(); });
    await m.settle();
    assert.equal(m.calls.filter((c) => c[0] === 'structure')[1][1], 8, 'and pressable, not stuck running');
  } finally { await m.unmount(); }
});

test('both Summarise presses send their option and answer only the session they were pressed on', () => {
  // Mutations checked: either page without the headers, or without its pressed-for check.
  const page = read('src/pages/founder/InterviewSessionPage.jsx');
  assert.match(page, /api\.summarise\(session\.id, undefined, railPressHeaders\('summarise:session'\)\)/);
  assert.match(page, /const pressedFor = id;\s*const current = \(\) => openId\.current === pressedFor;/);
  assert.match(page, /if \(current\(\)\) await load\(\);/);
  assert.match(page, /if \(!current\(\)\) return;\s*setDigestBusy\(false\); setSummarising\(false\); loadReceipt\(\);/);
  const review = read('src/pages/founder/InterviewReviewPage.jsx');
  assert.match(review, /sessions\.summarise\(session\.id, undefined, railPressHeaders\('summarise:session'\)\)/);
  assert.equal((review.match(/if \(openSession\.current !== pressedFor\) return;/g) || []).length, 2, 'both the answer and the refusal are checked');
  assert.match(review, /openSession\.current = chosenId;/);
});

test('the three API methods carry the press\'s headers', () => {
  // Mutation checked: any of the three dropping `headers`.
  const client = read('src/lib/api/interviewSessions.js');
  for (const [name, args] of [['summarise', 'id, model, headers'], ['structure', 'id, model, headers'], ['ask', 'id, question, headers']]) {
    assert.match(client, new RegExp(`${name}: \\(${args}\\) => request\\(\`\\$\\{P\\}/sessions/\\$\\{enc\\(id\\)\\}/${name}\`, \\{\\s*\\.\\.\\.\\(headers \\? \\{ headers \\} : \\{\\}\\),`), name);
  }
});
