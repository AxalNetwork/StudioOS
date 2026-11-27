/**
 * D1363: a recording stopped for want of AI tokens offers Top up beside Retry,
 * and a Super Admin's AI has no limit, so no surface shows them a billion-dollar
 * allowance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mountContracts } from './_contracts_dom.mjs';
import { ProcessingStages, ResumeOnTokens } from '../src/pages/founder/RecordingView.jsx';
import RecordLightbox from '../src/pages/founder/RecordLightbox.jsx';
import { TOKENS_ADDED_START, startRefusal } from '../src/pages/founder/recordSetup.js';
import { ADD_TOKENS_EVENT, TOKENS_ADDED_EVENT, notifyTokensAdded, onTokensAdded, tokenRefusal } from '../src/lib/aiTokens.js';
import { AiBudgetUsage } from '../src/ui/AiBudgetUsage.jsx';
import { RailUsage } from '../src/ui/WorkerRail.jsx';
import { allowanceView } from '../src/pages/account/usageModel.js';
import { availableView, limitRows } from '../src/pages/account/aiTokensModel.js';
import { allowanceCard } from '../src/lib/licencePage.js';

const h = React.createElement;
const NOT_ENOUGH = 'The included AI allowance and top-up balance cannot cover this run. Add tokens to continue.';
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
/** Every element in a rendered tree, so a test can press a button without a DOM. */
function elements(node, out = []) {
  if (Array.isArray(node)) { node.forEach((n) => elements(n, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  elements(node.props?.children, out);
  return out;
}

/** A window whose events really fire, for the length of `fn`. */
async function withBus(fn) {
  const bus = new EventTarget();
  const keep = ['window', 'addEventListener', 'removeEventListener', 'dispatchEvent'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  globalThis.addEventListener = bus.addEventListener.bind(bus);
  globalThis.removeEventListener = bus.removeEventListener.bind(bus);
  globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
  if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
  try { return await fn(bus); } finally {
    for (const [k, d] of keep) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  }
}

test('a run refused for tokens shows Top up beside Retry, and Top up opens the Add tokens sheet', () => {
  // Mutation checked: draw Top up for any failure → the second render has it.
  const topUp = { stage: 'failed', error: NOT_ENOUGH, top_up: true };
  const html = renderToStaticMarkup(h(ProcessingStages, { processing: topUp, stageAt: 1 }));
  assert.match(html, /data-testid="button-top-up-processing"[^>]*>Top up and continue</);
  assert.match(html, /data-testid="button-retry-processing"/, 'Retry stays: after a top-up it continues');
  const other = renderToStaticMarkup(h(ProcessingStages, { processing: { stage: 'failed', error: 'The recording could not be read.' }, stageAt: 1 }));
  assert.doesNotMatch(other, /button-top-up-processing/, 'Top up is offered only when tokens are what stopped it');
  assert.match(other, /button-retry-processing/);

  const seen = [];
  const prior = globalThis.window;
  globalThis.window = { dispatchEvent: (e) => { seen.push(e); return true; } };
  try {
    const button = elements(ProcessingStages({ processing: topUp, stageAt: 1 })).find((e) => e.props?.['data-testid'] === 'button-top-up-processing');
    button.props.onClick();
  } finally { globalThis.window = prior; }
  assert.deepEqual(seen.map((e) => [e.type, e.detail.from]), [[ADD_TOKENS_EVENT, 'Record a session']]);
  const resume = elements(ProcessingStages({ processing: topUp, stageAt: 1 })).find((e) => e.type === ResumeOnTokens);
  assert.ok(resume, 'the screen waits for the tokens, so processing continues with no second press');
  assert.equal(elements(ProcessingStages({ processing: { stage: 'failed', error: 'x' }, stageAt: 1 })).some((e) => e.type === ResumeOnTokens), false);
});

test('tokens landing continue the refused run once; only a tokens refusal offers Top up', async () => {
  // Mutation checked: leave the listener on after it fires → the second notice retries again.
  await withBus(async () => {
    let runs = 0;
    const off = onTokensAdded(() => { runs += 1; });
    notifyTokensAdded(); notifyTokensAdded();
    assert.equal(runs, 1, 'one top-up, one retry');
    off();
    let late = 0;
    const off2 = onTokensAdded(() => { late += 1; });
    off2(); notifyTokensAdded();
    assert.equal(late, 0, 'a screen that has moved on is not retried');
  });
  assert.equal(TOKENS_ADDED_EVENT, 'studioos:tokens_added');
  for (const code of ['budget_user_day', 'budget_user_month', 'tokens']) assert.equal(tokenRefusal({ status: 402, code }), true, code);
  for (const code of ['ai_paused', 'budget_review', 'spend_limit', 'storage_full', undefined]) assert.equal(tokenRefusal({ status: 402, code }), false, String(code));
  assert.equal(tokenRefusal({ status: 402, data: { error: 'budget_user_month' } }), true, 'the code in the body counts');
  assert.deepEqual(startRefusal({ status: 402, code: 'budget_user_month', message: 'Not enough tokens.' }), { text: 'Not enough tokens.', liveHref: null, topUp: true });
  assert.equal(startRefusal({ status: 400, code: 'bad', message: 'No.' }).topUp, undefined);
});

test('Record a session: a send refused for tokens offers Top up there, and sends Eadwyn AI once the tokens land', async () => {
  // Mutation checked: drop the resume → nothing is sent after the top-up and the dialog stays refused.
  const link = ['https:/', 'meet.google.com', 'abc-defg-hij'].join('/');
  const sent = [], started = [];
  let refuse = true;
  const props = {
    projectId: 10, interview: { id: 1, interviewee_name: 'Fixture person' }, initialMode: 'video',
    initialBot: { available: true, platforms: { zoom: true, google_meet: true, teams: true }, limit_minutes: 30, price: { bot_microusd_per_minute: 2790, transcription_microusd_per_minute: 6500 } },
    initialModels: { live: [], final: [], defaults: { live: null, final: null } }, initialBoard: { hypotheses: [] },
    channels: { providers: [{ provider: 'zoom', available: false }, { provider: 'google_meet', available: true }], connections: {} },
    initialConsent: 'written', onClose() {}, onStarted: (...a) => started.push(a),
    sessions: {
      async create() { return { session: { id: 15, channel: 'video' } }; },
      async sendBot(id, body) {
        sent.push({ id, body });
        if (refuse) { refuse = false; throw Object.assign(new Error('x'), { status: 402, code: 'budget_user_month' }); }
        return { bot: { uid: 'synthetic', status: 'joining' } };
      },
    },
    recorder: { prepare() {}, release() {}, begin() {}, getSnapshot() { return {}; }, isCapturing() { return false; } },
  };
  const m = await mountContracts(h(RecordLightbox, props));
  const by = (id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
  const press = async (id) => { await act(async () => { await m.props(by(id)).onClick?.({ preventDefault() {} }); }); };
  try {
    await withBus(async () => {
      await press('record-provider-google_meet');
      await act(async () => { await m.props(by('record-link')).onChange({ target: { value: link } }); });
      await press('record-start');
      assert.equal(sent.length, 1);
      assert.ok(by('record-top-up'), m.text());
      assert.match(m.text(), /Top up and continue/);
      assert.doesNotMatch(m.text(), /Open the session to check/, 'no sending the member elsewhere');
      assert.equal(started.length, 0);
      await act(async () => { notifyTokensAdded(); await new Promise((r) => setTimeout(r, 0)); });
      assert.equal(sent.length, 2, 'sent again on the same session, with no second press');
      assert.deepEqual([sent[1].id, sent[1].body.meeting_url], [15, link]);
      assert.equal(started.length, 1);
      assert.equal(started[0][0].submitted_via, 'meeting_bot');
    });
  } finally { await m.unmount(); }
  assert.equal(TOKENS_ADDED_START, 'Tokens added. Press Start to continue.');
});

const SUPER = {
  licence: 'admin', source: 'super_admin', unlimited: true, daily_capped: false,
  daily_microusd: 1_000_000_000_000_000, monthly_microusd: 1_000_000_000_000_000,
  day_spend_microusd: 0, month_spend_microusd: 12_340_000, balance_microusd: 0,
  day_reserved_microusd: 0, month_reserved_microusd: 0, topup_reserved_microusd: 0, held_for_review: [], ai_paused: false,
};
const reading = (budget) => ({ budget, loading: false, budgetError: false, reload: () => {}, product: null, productError: false });

test('a Super Admin reads "No limit" everywhere, with the spend still shown, never $1,000,000,000', () => {
  // Mutation checked: drop the unlimited branch from the usage card → "of $1,000,000,000.00".
  const card = renderToStaticMarkup(h(AiBudgetUsage, { reading: reading(SUPER) }));
  assert.match(text(card), /This month · \$12\.34 · No limit \(Super Admin\)/);
  assert.doesNotMatch(card, /role="presentation"/, 'no meter for a limit that does not exist');
  const rail = text(renderToStaticMarkup(h(RailUsage, { reading: reading(SUPER) })));
  assert.match(rail, /This month \$12\.34 · No limit/);
  assert.match(rail, /No limit \(Super Admin\)/);
  const month = allowanceView(SUPER).month;
  assert.deepEqual([month.used, month.of, month.pct, month.unlimited], ['$12.34', 'No limit', 0, true]);
  const v = availableView(SUPER, new Date('2026-10-28T12:00:00Z'));
  assert.deepEqual([v.available, v.left, v.of, v.unlimited], ['No limit', 'No limit', 'No limit', true]);
  assert.ok(!v.segments.some((s) => s.id === 'allowance'), 'no allowance segment of a billion dollars');
  assert.match(v.srSummary, /^No limit:/);
  assert.deepEqual(limitRows(SUPER).plan, { state: 'ok', perMonth: 'No limit', from: 'Super Admin' });
  const lc = allowanceCard(SUPER);
  assert.deepEqual([lc.monthly, lc.daily, lc.pct], ['No limit', 'No limit', 0]);
  assert.match(lc.used, /^\$12\.34 used this month · No limit/);
  for (const html of [card, rail, JSON.stringify([month, v, lc])]) assert.doesNotMatch(html, /1,000,000,000/);
});
