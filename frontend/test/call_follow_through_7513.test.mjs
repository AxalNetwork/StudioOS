/**
 * D7513 (#7513, canvas D6053) — the non-AI pieces of a call's follow-through
 * that D6863 left: step 3 of a call started from a closed one, pre-ticked from
 * that call's chosen investors (RAC20C, an owner; RAC20D, a co-founder read
 * only), and Capital relationships › Commitments showing the moved line with
 * its call and uid (RAC22C).
 *
 * The sheet runs on stubbed `roundCallsApi` and `roundCallFollowThroughApi`;
 * the Commitments tab on a stubbed `fetch` answering the commitments read as
 * the Worker does. Every venture, call, person and figure is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/call_follow_through_7513.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { roundCallsApi } from '../src/lib/api/roundCalls.js';
import { roundCallFollowThroughApi } from '../src/lib/api/roundCallFollowThrough.js';
import { prospectInvitesApi } from '../src/lib/api/prospectInvites.js';
import RoundCallSheet from '../src/pages/founder/RoundCallSheet.jsx';
import CapRelCommitments from '../src/pages/raise/caprel/CapRelCommitments.jsx';
import CallFollowThrough from '../src/pages/founder/CallFollowThrough.jsx';
import { commitmentsHref, sourceChip, sourceFooter, sourceRows, sourceTicks } from '../src/pages/founder/callFollowThroughModel.js';
import { commitmentRows, isMovedRow, recordedNotice, recordedParam } from '../src/pages/raise/caprel/capRelTabsModel.js';

globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const h = React.createElement;
const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); });

/* ------------------------------------------------------------------ fixtures */

const CONTEXT = {
  project: { id: 7, name: 'Lumen' }, round: { name: 'Seed', target_amount: 1500000, close_date: '2099-01-15' }, scenario: null, term_seeds: {},
  decks: [], data_room: null,
  // The pipeline's verified investors: 1 and 2 were chosen on the closed call; 9 was not.
  chosen: [{ prospect_id: 1, name: 'Firm A', email: 'a@example.test' }, { prospect_id: 2, name: 'Firm B', email: 'b@example.test' }, { prospect_id: 9, name: 'Firm N', email: 'n@example.test' }],
};
const DRAFT = { uid: 'bridge', project_id: 7, name: 'Bridge', state: 'draft', instrument: 'safe', amount_cents: 40000000, minimum_cheque_cents: 2500000,
  terms: 'Plain words', target_close: '2099-03-01', deck_id: null, deck_version: null, data_room_project_uid: null, valuation_cap_cents: 800000000,
  discount_bps: null, pre_money_cents: null, revision: 1, terms_hash: 'h', source_call_id: 1 };
const SOURCE = {
  source: { uid: 'seed-ext', name: 'Seed extension', closed_at: '2099-10-12' }, can_set: true,
  counts: { chosen: 4, responded: 2, did_not_respond: 1, not_delivered: 1, ticked: 2 },
  rows: [
    { recipient_id: 11, prospect_id: 1, name: 'Firm A', on_source: 'responded', today: 'verified', ticked: true },
    { recipient_id: 12, prospect_id: 2, name: 'Firm B', on_source: 'did_not_respond', today: 'verified', ticked: true },
    { recipient_id: 13, prospect_id: 3, name: 'Firm U', on_source: 'responded', today: 'not_verified', ticked: false },
    { recipient_id: 14, prospect_id: null, name: 'Firm V', on_source: 'not_delivered', today: 'not_in_pipeline', ticked: false },
  ],
};
const page = (o = {}) => ({ viewer: 'founder', relation: 'owner', call: DRAFT, recipients: [], readiness: [], counsel_approved: false,
  can: { draft: true, answer: true, audience: true, send: true, extend: true, close: true }, ...o });

function stub(api, answers, calls) {
  const saved = { ...api };
  for (const key of Object.keys(saved)) {
    const answer = Object.hasOwn(answers, key) ? answers[key] : {};
    const queue = Array.isArray(answer) ? [...answer] : null;
    api[key] = async (...args) => {
      calls.push([key, ...args]);
      const next = queue ? (queue.length > 1 ? queue.shift() : queue[0]) : answer;
      const value = typeof next === 'function' ? next(...args) : next;
      if (value instanceof Error) throw value;
      return value;
    };
  }
  return () => Object.assign(api, saved);
}

async function render(element, url) {
  const restore = installDocument();
  const previous = { matchMedia: globalThis.matchMedia };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, element)));
  await settle();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const by = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const label = (l) => nodes().find((n) => props(n)['aria-label'] === l);
  return {
    text: () => text(container), textOf: (id) => text(by(id)), has: (id) => Boolean(by(id)), props: (id) => props(by(id)), all: (id) => nodes().filter((n) => props(n)['data-testid'] === id).map(text),
    box: (l) => props(label(l)),
    async click(l) {
      const n = nodes().find((x) => x.tagName === 'BUTTON' && (text(x).trim() === l || (props(x)['data-state-retry'] === '' && l === 'Retry'))) || by(l);
      assert.ok(n, `no ${l}`); assert.ok(!props(n).disabled, `${l} is disabled`);
      await act(async () => { props(n).onClick({ stopPropagation() {}, preventDefault() {} }); }); await settle();
    },
    async tick(l) { const n = label(l); assert.ok(n, `no ${l}`); await act(async () => { props(n).onChange({ target: {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

/** The sheet on a draft started from a closed call, moved on to its Audience step. */
async function audience(t, { pageRead = page(), source = SOURCE, go = 'Next' } = {}) {
  const calls = [];
  const restoreCalls = stub(roundCallsApi, { availability: { enabled: true }, context: CONTEXT, page: pageRead,
    previewAudience: { matched: 0, reason: null, not_on_axal: [] }, audience: { chosen: 2, matched: 0 } }, calls);
  const restoreFt = stub(roundCallFollowThroughApi, { sourceAudience: source }, calls);
  const restoreInvites = stub(prospectInvitesApi, { states: { can_invite: true, items: [] } }, calls);
  const v = await render(h(RoundCallSheet, { projectId: 7, onClose: () => {}, initialCall: { uid: 'bridge' } }), '/raise/call');
  t.after(async () => { await v.close(); restoreCalls(); restoreFt(); restoreInvites(); });
  // A draft with no audience resumes on Materials; one with an audience on Preview.
  await v.click(go);
  return { v, calls, saved: () => calls.filter((c) => c[0] === 'audience').map((c) => c[2].chosen_prospect_ids) };
}

/* ------------------------------------------------------------------ the model */

test('sourceTicks: only a chosen investor still verified and in the pipeline; the draft\'s own audience wins', () => {
  // Mutation checked: a not-verified row ticked; a row with no prospect ticked; the recorded audience overridden.
  assert.deepEqual(sourceTicks(SOURCE, page()), [1, 2]);
  assert.deepEqual(sourceTicks({ rows: [{ prospect_id: 3, ticked: false }, { prospect_id: null, ticked: true }] }, page()), []);
  assert.equal(sourceTicks(SOURCE, page({ recipients: [{ origin: 'chosen', email: 'a@example.test' }] })), null, 'a recorded chosen audience wins');
  assert.deepEqual(sourceTicks(SOURCE, page({ recipients: [{ origin: 'match' }] })), [1, 2], 'a match alone is no chosen audience');
  assert.equal(sourceTicks(null, page()), null, 'nothing read, nothing ticked');
  assert.deepEqual(sourceRows(SOURCE, 'responded').map((r) => r.recipient_id), [11, 13]);
  assert.equal(sourceChip(SOURCE, 'all'), 4);
  assert.equal(sourceChip({ counts: {} }, 'responded'), null, 'a missing count is not zero');
  assert.equal(sourceFooter(SOURCE, SOURCE.rows, [1]), 'Showing 4 of 4 · 1 ticked');
  assert.equal(commitmentsHref(7, 5), '/raise/capital-relationships/commitments?project_id=7&recorded=5');
  assert.equal(commitmentsHref(7, 'x'), '/raise/capital-relationships/commitments?project_id=7');
});

/* ------------------------------------------------------------------ step 3 */

test('RAC20C: the owner\'s step 3 ticks the closed call\'s chosen investors still verified, greys the rest with why, and Next saves the ticks', async (t) => {
  // Mutation checked: the ticks not applied; `touched` not set (Next saved nothing); a not-verified row enabled;
  // an investor listed twice (in the closed call and again in the pipeline).
  const { v, saved, calls } = await audience(t);
  assert.deepEqual(calls.filter((c) => c[0] === 'sourceAudience').map((c) => c[1]), ['bridge']);
  assert.match(v.text(), /From Seed extension, closed 12 Oct/);
  assert.equal(v.textOf('call-source-chip-all'), 'All chosen 4');
  assert.equal(v.textOf('call-source-chip-not_delivered'), 'Not delivered 1');
  assert.equal(v.box('Include Firm A').checked, true);
  assert.equal(v.box('Include Firm B').checked, true);
  assert.deepEqual([v.box('Include Firm U').checked, v.box('Include Firm U').disabled], [false, true]);
  assert.match(v.textOf('call-source-row-13'), /⦸ No longer verified on Axal.*On Seed extension: Responded.*Not verified/);
  assert.match(v.textOf('call-source-row-14'), /No longer in your pipeline/);
  assert.equal(v.box('Include Firm V').disabled, true);
  assert.equal(v.textOf('call-source-footer'), 'Showing 4 of 4 · 2 ticked');
  assert.match(v.text(), /Others in your pipeline/);
  assert.equal(v.box('Choose Firm A').checked, undefined, 'Firm A is listed once, under the closed call');
  assert.equal(v.box('Choose Firm N').checked, false);
  assert.equal(v.has('call-audience-owner-only'), false);
  await v.click('call-source-chip-responded');
  assert.equal(v.textOf('call-source-footer'), 'Showing 2 of 4 · 2 ticked');
  await v.tick('Include Firm A');
  await v.tick('Choose Firm N');
  await v.click('Next');
  assert.deepEqual(saved(), [[2, 9]]);
});

test('the ticks are an unsaved audience: the owner\'s Next saves them untouched', async (t) => {
  // Mutation checked: the ticks applied without marking the audience unsaved (Next wrote nothing).
  const { v, saved } = await audience(t);
  await v.click('Next');
  assert.deepEqual(saved(), [[1, 2]]);
});

test('RAC20D: a co-founder sees the ticks read only, and the step writes nothing for them', async (t) => {
  // Mutation checked: the owner-only note dropped; the closed call's boxes and the pipeline's left enabled; the ticks
  // never applied; the owner's preview read for a co-founder. (Dropping `canSet&&` from Next's write is equivalent here:
  // nothing a co-founder can press marks the audience unsaved.)
  const { v, saved, calls } = await audience(t, { pageRead: page({ relation: 'member', can: { draft: true, answer: true, audience: false, send: false, extend: false, close: false } }),
    source: { ...SOURCE, can_set: false } });
  assert.match(v.textOf('call-audience-owner-only'), /The audience is set by the venture’s owner\. You can see who is ticked\./);
  assert.deepEqual([v.box('Include Firm A').checked, v.box('Include Firm A').disabled], [true, true]);
  assert.equal(v.box('Choose Firm N').disabled, true);
  assert.match(v.textOf('call-matches-owner'), /re-matched when the venture’s owner previews the audience/);
  assert.equal(calls.filter((c) => c[0] === 'previewAudience').length, 0);
  await v.click('Next');
  assert.deepEqual(saved(), [], 'nothing written');
});

test('a failed read of the closed call says Unavailable, ticks nothing, and Retry reads it again', async (t) => {
  // Mutation checked: a failed read drawn as no chosen investors; Retry not re-reading.
  const quiet = console.error; console.error = () => {}; t.after(() => { console.error = quiet; });
  const { v, calls } = await audience(t, { source: [Object.assign(new Error('x'), { status: 503 }), SOURCE] });
  assert.match(v.text(), /Unavailable/);
  assert.equal(v.box('Choose Firm A').checked, false, 'nothing ticked from a read that failed');
  await v.click('Retry');
  assert.equal(calls.filter((c) => c[0] === 'sourceAudience').length, 2);
  assert.equal(v.box('Include Firm A').checked, true);
});

test('a draft whose audience is already recorded keeps it; the closed call does not tick over it', async (t) => {
  // Mutation checked: sourceTicks ignoring the recorded audience.
  const { v } = await audience(t, { pageRead: page({ recipients: [{ origin: 'chosen', email: 'b@example.test' }] }), go: 'Back' });
  assert.equal(v.box('Include Firm A').checked, false);
  assert.equal(v.box('Include Firm B').checked, true);
});

/* ------------------------------------------------------------------ RAC22C */

const WORDS = { status: { signed: 'Signed', soft: 'Soft', indicated: 'Indicated through a call' }, source: { typed: 'Typed', recorded: 'Recorded' } };
const typed = (key, status, cents, call) => ({ key, source: 'typed', source_label: 'Typed', status, status_label: WORDS.status[status], counted: status === 'signed', cents, currency: 'USD', on: '2099-11-14', via: null, why_not_counted: null, call });
const COMMITMENTS = {
  currency: 'USD', round: { name: 'Seed', target_cents: 150000000, currency: 'USD' }, totals: { counted_cents: 4500000, by_status: {} },
  investors: [
    { key: 'prospect:5', prospect_id: 5, name: 'Fund A', chosen: typed('typed:5', 'signed', 4500000, { uid: 'seed-ext', name: 'Seed extension' }),
      lines: [typed('typed:5', 'signed', 4500000, { uid: 'seed-ext', name: 'Seed extension' }),
        { key: 'call:seed-ext:61', source: 'recorded', source_label: 'Recorded', status: 'indicated', status_label: 'Indicated through a call', counted: false, cents: 5000000, currency: 'USD', on: '2099-10-03', via: 'Seed extension' }] },
    { key: 'prospect:6', prospect_id: 6, name: 'Fund B', chosen: typed('typed:6', 'soft', 10000000, null), lines: [typed('typed:6', 'soft', 10000000, null)] },
  ],
  sources: {}, words: WORDS, basis: '', call_links: 'ok',
};

test('the moved line in the model: the call and its uid ride on the typed line; the notice reads the read, never the address', () => {
  // Mutation checked: the call dropped from the row; the notice built for a line with no call; a bad id accepted.
  const rows = commitmentRows(COMMITMENTS);
  assert.deepEqual(rows.map((r) => r.call?.uid ?? null), ['seed-ext', null, null]);
  assert.equal(recordedParam('?project_id=7&recorded=5'), 5);
  assert.equal(recordedParam('?recorded=0'), null);
  assert.equal(recordedParam('?recorded=5;DROP'), null);
  assert.deepEqual(rows.map((r) => isMovedRow(r, 5)), [true, false, false], 'only the typed line that keeps a call');
  assert.deepEqual(recordedNotice(COMMITMENTS, 5), { text: 'Recorded as Signed · $45,000 · Fund A', call: { uid: 'seed-ext', name: 'Seed extension' } });
  assert.equal(recordedNotice(COMMITMENTS, 6), null, 'a line from no call says nothing was recorded from one');
  assert.equal(recordedNotice(COMMITMENTS, null), null);
});

async function commitments(t, url, body = COMMITMENTS) {
  const previous = globalThis.fetch;
  const response = (b) => ({ ok: true, status: 200, statusText: '', headers: { get: () => 'application/json' }, json: async () => b, text: async () => JSON.stringify(b) });
  globalThis.fetch = async (u) => {
    const s = String(u);
    if (/capital-relationships\/commitments/.test(s)) return response(body);
    if (/raise-closes/.test(s)) return response({ round: null, closes: [] });
    return response({ items: [] });
  };
  const v = await render(h(CapRelCommitments, { projectId: 7, search: '?project_id=7' }), url);
  t.after(async () => { await v.close(); globalThis.fetch = previous; });
  return v;
}

test('RAC22C: arriving from the call, Commitments marks the moved line and names its call and uid', async (t) => {
  // Mutation checked: the notice not drawn; the moved row not marked; the call uid not shown on the row.
  const v = await commitments(t, '/raise/capital-relationships/commitments?project_id=7&recorded=5');
  assert.match(v.textOf('caprel-commit-recorded'), /^✓ Recorded as Signed · \$45,000 · Fund A, from the call Seed extension · seed-extOpen line$/);
  assert.deepEqual(v.all('caprel-commit-call'), ['From the call Seed extension · seed-ext']);
  assert.equal(v.props('caprel-commit-row')['data-moved'], 'true');
  assert.equal(v.has('caprel-commit-calls-unread'), false);
});

test('without ?recorded= nothing is marked; a call link that could not be read says so', async (t) => {
  // Mutation checked: a row marked with no `recorded`; the unreadable links drawn as "from no call".
  const v = await commitments(t, '/raise/capital-relationships/commitments?project_id=7', { ...COMMITMENTS, call_links: 'unreadable' });
  assert.equal(v.has('caprel-commit-recorded'), false);
  assert.equal(v.props('caprel-commit-row')['data-moved'], undefined);
  assert.match(v.textOf('caprel-commit-calls-unread'), /could not be read\. That is not a claim that none did\./);
});

test('RAC22D to RAC22C: the call page\'s recorded line opens Commitments on the moved line', async (t) => {
  // Mutation checked: the link left on Capital relationships' Overview; the prospect not carried.
  const previous = globalThis.fetch;
  const json = (b) => ({ ok: true, status: 200, statusText: '', headers: { get: () => 'application/json' }, json: async () => b, text: async () => JSON.stringify(b) });
  const responded = { recipient_id: 6, named: true, origin: 'chosen', name: 'Fund A', investor_user_id: 61, reasons: [], group: 'responded', delivery_state: 'notified',
    opened_at: '2099-10-02', data_room_requested_at: null, responded_at: '2099-10-03', commitment_cents: 5000000, committed_at: '2099-10-03', last_reminded_at: null,
    reminder_count: 0, block: 'responded', next_reminder_from: null, in_pipeline: true, line: { status: 'soft', stage: 'committed', amount_cents: 5000000, currency: 'USD', from_this_call: false } };
  const read = { venture: { name: 'Lumen' }, call: { uid: 'seed-ext', name: 'Seed extension', state: 'sent', target_close: '2099-11-27', sent_at: '2099-10-01', closed_at: null, project_id: 7 },
    relation: 'owner', can: { remind: true, export: true, record: true, start_new: false }, remind: { on: true, reason: null, sentence: null, limit: 2, spacing_days: 3 }, start_new: null,
    counts: { recipients: 1, not_opened: 0, opened_unanswered: 0, not_delivered: 0, responded: 1 }, recipients: [responded], exports: [], source: null };
  globalThis.fetch = async (u, o = {}) => (String(o.method || 'GET').toUpperCase() === 'GET' ? json(read)
    : json({ recorded: { status: 'signed', amount_cents: 4500000, at: '2099-11-14', prospect_id: 5, round_call_uid: 'seed-ext' } }));
  const v = await render(h(CallFollowThrough, { uid: 'seed-ext', call: read.call }), '/raise/capital-relationships/calls/seed-ext');
  t.after(async () => { await v.close(); globalThis.fetch = previous; });
  await v.click('ft-record-6');
  await act(async () => { v.props('ft-record-amount').onChange({ target: { value: '45,000' } }); });
  await settle();
  await v.click('ft-record-confirm');
  assert.equal(v.props('ft-recorded-open').href, '/raise/capital-relationships/commitments?project_id=7&recorded=5');
});
