/**
 * D6160 (#6160), canvas DCA16–DCA18, DCA20, DCA21 (D6159): the investor's
 * round calls list at `/round-calls`, inside the Deals shell, and its entry
 * in `/deals`' Other deal activity line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { RoundCallListBody } from '../src/pages/investor/RoundCallIndex.jsx';
import {
  closeWords, filterCounts, filterHref, filterOf, listState, responseLines, sortCalls,
} from '../src/pages/investor/roundCallsModel.js';
import { roundCallsItem, roundCallsLabel, roundCallsReadOf } from '../src/pages/investor/dealflow/otherActivityModel.js';
import { OtherDealActivityLine } from '../src/pages/investor/dealflow/OtherDealActivity.jsx';
import { dealsPageTitle } from '../src/pages/investor/dealflow/dealFlowModel.js';
import { moneyCents } from '../src/pages/founder/roundCallParts.jsx';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import WorkspaceShell from '../src/workspaces/WorkspaceShell.jsx';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const TODAY = '2026-11-14';
const call = (over) => ({
  uid: 'u', name: 'Seed', instrument: 'safe', amount_cents: 120000000, minimum_cheque_cents: 2500000,
  target_close: '2026-11-18', state: 'sent', effective_state: 'open', sent_at: '2026-11-13 10:00:00', closed_at: null,
  company: { name: 'Kestrel Grid' },
  mine: { opened_at: null, commitment_cents: null, data_room_requested_at: null, question_count: 0, answered_count: 0 },
  ...over,
});
const CALLS = [
  call({ uid: 'kestrel' }),
  call({ uid: 'ferro', company: { name: 'Ferro Analytics' }, target_close: '2026-12-04',
    mine: { opened_at: '2026-11-09 08:00:00', commitment_cents: 5000000, data_room_requested_at: '2026-11-12 09:00:00', question_count: 1, answered_count: 1 } }),
  call({ uid: 'halcyon', company: { name: 'Halcyon Bio' }, instrument: 'convertible_note', state: 'awaiting_counsel', effective_state: 'paused', target_close: '2026-11-27',
    mine: { opened_at: '2026-11-03 08:00:00', commitment_cents: null, data_room_requested_at: null, question_count: 2, answered_count: 0 } }),
  call({ uid: 'ostrava', company: { name: 'Ostrava Robotics' }, instrument: 'equity', effective_state: 'closed', target_close: '2026-11-02',
    mine: { opened_at: '2026-10-20 08:00:00', commitment_cents: 2500000, data_room_requested_at: null, question_count: 0, answered_count: 0 } }),
  call({ uid: 'quayside', company: { name: 'Quayside Pay' }, state: 'closed', effective_state: 'closed', target_close: '2026-12-20', closed_at: '2026-10-30 12:00:00', sent_at: '2026-10-26 10:00:00',
    mine: { opened_at: '2026-10-27 08:00:00', commitment_cents: null, data_room_requested_at: null, question_count: 0, answered_count: 0 } }),
];
const ok = (items) => ({ loading: false, error: null, data: { viewer: 'investor', items }, retry: () => {} });

test('each row names the company and shows the investor’s own response or No response recorded', () => {
  const out = html(h(RoundCallListBody, { read: ok(CALLS), today: TODAY }));
  const text = renderedText(out);
  // Mutation checked: rendering call.name in place of the company drops Kestrel Grid and this fails.
  for (const company of ['Kestrel Grid', 'Ferro Analytics', 'Halcyon Bio', 'Ostrava Robotics', 'Quayside Pay']) assert.ok(text.includes(company), company);
  assert.ok(text.includes('Indicated · $50,000'));
  assert.ok(text.includes('Question asked · answered'));
  assert.ok(text.includes('2 questions asked · 0 answered'));
  // Mutation checked: dropping the `none` branch shows "Not indicated" for Kestrel and this count falls.
  assert.equal((out.match(/No response recorded/g) || []).length, 2 * 2, 'Kestrel and Quayside, in the table and the cards');
  assert.ok(!/Commit/.test(text), 'the word Commit never appears');
  assert.match(out, /href="\/round-calls\/kestrel"/);
  // Phone: whole-card targets at least 44px, and filters at 44px.
  const tag = (testid) => (out.match(new RegExp(`<a[^>]*data-testid="${testid}"[^>]*>`)) || [''])[0];
  // Mutation checked: dropping min-h-[44px] from the card or the filter fails these.
  assert.match(tag('round-call-card'), /min-h-\[44px\]/);
  assert.match(tag('round-calls-filter-open'), /min-h-\[44px\]/);
  assert.match(tag('round-calls-filter-needs-answer'), /min-h-\[44px\]/);
  // New marks the open call not yet opened, and only it.
  assert.equal((out.match(/title="Not opened yet"/g) || []).length, 2);
});

test('responseLines and closeWords say what is recorded, in words', () => {
  assert.deepEqual(responseLines(CALLS[0], moneyCents), { none: true, lines: ['No response recorded'] });
  assert.deepEqual(responseLines(CALLS[1], moneyCents).lines, ['Indicated · $50,000', 'Question asked · answered', 'Data room · asked on 12 Nov']);
  assert.deepEqual(responseLines({ ...CALLS[0], mine: null }, moneyCents).lines, ['Not recorded · your response was not returned']);
  assert.deepEqual(closeWords(CALLS[0], TODAY), { text: 'Closes in 4 days · 18 Nov', note: null });
  assert.deepEqual(closeWords(CALLS[2], TODAY), { text: 'Closes in 13 days · 27 Nov', note: 'An extension is waiting on counsel' });
  assert.deepEqual(closeWords(CALLS[3], TODAY), { text: 'Closed on 2 Nov', note: null });
  // Mutation checked: comparing closed_at to sent_at instead of target_close drops the early note.
  assert.deepEqual(closeWords(CALLS[4], TODAY), { text: 'Closed on 30 Oct', note: 'Closed early by the founder' });
  assert.equal(closeWords(call({ target_close: TODAY }), TODAY).text, 'Closes today · 14 Nov');
  // A founder's close on the close date itself is not early.
  assert.deepEqual(closeWords(call({ state: 'closed', effective_state: 'closed', target_close: '2026-11-10', closed_at: '2026-11-10 18:00:00' }), TODAY), { text: 'Closed on 10 Nov', note: null });
});

test('filters live in the address, count by state, and Closed sorts last', () => {
  assert.equal(filterOf('?filter=needs-answer'), 'needs-answer');
  assert.equal(filterOf('?filter=bogus'), 'all');
  assert.equal(filterHref('?filter=open&x=1', 'all'), '/round-calls?x=1');
  assert.equal(filterHref('', 'paused'), '/round-calls?filter=paused');
  // Mutation checked: counting needs-answer as every unindicated call (paused too) reads 2 and fails.
  assert.deepEqual(filterCounts(CALLS), { open: 2, paused: 1, closed: 2, all: 5, 'needs-answer': 1 });
  // Mutation checked: sorting closed calls soonest first swaps ostrava and quayside.
  assert.deepEqual(sortCalls(CALLS).map((c) => c.uid), ['kestrel', 'halcyon', 'ferro', 'ostrava', 'quayside']);
  const paused = html(h(RoundCallListBody, { read: ok(CALLS), search: '?filter=paused', today: TODAY }));
  assert.ok(renderedText(paused).includes('Halcyon Bio'));
  assert.ok(!renderedText(paused).includes('Kestrel Grid'));
  assert.match(paused, /aria-current="page"[^>]*data-testid="round-calls-filter-paused"|data-testid="round-calls-filter-paused"[^>]*aria-current="page"/);
});

test('the read states: Coming soon, verification required, empty, Unreadable with Try again', () => {
  const state = (error) => html(h(RoundCallListBody, { read: { loading: false, data: null, error, retry: () => {} } }));
  const off = state({ status: 503, code: 'round_calls_disabled' });
  assert.match(off, /Coming soon\. Round calls are not enabled on Axal yet\./);
  assert.doesNotMatch(off, /Try again|Unreadable|could not be read/);
  const verify = state({ status: 403, code: 'verified_investor_required' });
  assert.match(verify, /Round calls are for verified investors\./);
  assert.match(verify, /href="\/kyc"/);
  for (const error of [{ status: 503, code: 'round_calls_unreadable' }, { status: 500 }, {}]) {
    const out = state(error);
    // Mutation checked: mapping every 503 to Coming soon makes round_calls_unreadable read Coming soon and fails.
    assert.match(out, /Your round calls could not be read\./);
    assert.match(out, />Try again</);
  }
  assert.match(state({ status: 403, code: 'something_else' }), /was refused/);
  const empty = html(h(RoundCallListBody, { read: ok([]) }));
  assert.match(empty, /No founder has sent you a round call yet\./);
  assert.match(empty, /Browse Deal flow/);
  assert.equal(listState({ loading: false, error: null, data: {} }), 'unreadable', 'a reply without items is not an empty list');
  assert.match(html(h(RoundCallListBody, { read: { loading: true } })), /aria-busy="true"/);
});

test('/deals: Round calls · N open only when the read succeeds, Unreadable alone, absent while off', () => {
  // Mutation checked: counting every call (not only Open) reads 5 and fails.
  const item = roundCallsItem({ kind: 'ok', data: { items: CALLS } });
  assert.deepEqual([item.state, item.count, item.href], ['count', 2, '/round-calls']);
  assert.equal(roundCallsLabel(item), 'Round calls: 2 open');
  // Mutation checked: treating round_calls_disabled as unreadable draws "Unreadable" while off and fails.
  assert.deepEqual(roundCallsReadOf({ status: 503, code: 'round_calls_disabled' }), { kind: 'off', data: null });
  assert.deepEqual(roundCallsReadOf({ status: 403, code: 'verified_investor_required' }), { kind: 'off', data: null });
  assert.deepEqual(roundCallsReadOf({ status: 503, code: 'round_calls_unreadable' }), { kind: 'unreadable', data: null });
  for (const silent of [undefined, { kind: 'loading' }, { kind: 'off' }]) assert.equal(roundCallsItem(silent), null);
  assert.equal(roundCallsItem({ kind: 'unreadable', data: null }).state, 'unreadable');

  const zones = { screening: { kind: 'ok', data: { desk: { available: true, rows: [] } } } };
  const on = html(h(OtherDealActivityLine, { reads: { ...zones, round_calls: { kind: 'ok', data: { items: CALLS } } } }));
  assert.match(on, /data-testid="other-activity-round_calls-count">2</);
  assert.match(on, /href="\/round-calls"/);
  const off = html(h(OtherDealActivityLine, { reads: { ...zones, round_calls: { kind: 'off', data: null } }, onRetry: () => {} }));
  assert.doesNotMatch(off, /round_calls|Round calls/);
  const failed = html(h(OtherDealActivityLine, { reads: { ...zones, round_calls: { kind: 'unreadable', data: null } }, onRetry: () => {} }));
  assert.match(failed, /data-testid="other-activity-round_calls-unreadable"/);
  assert.doesNotMatch(failed, /other-activity-round_calls-count/);
  // Mutation checked: leaving round calls out of anyUnreadable drops Try again here and fails.
  assert.match(failed, /data-testid="other-activity-retry"/);
  // Read only for an investor account (the Worker's investor branch).
  assert.match(codeOnly(read('src/pages/investor/dealflow/OtherDealActivity.jsx')), /useActivityReads\(user\?\.role === 'investor'\)/);
});

test('/round-calls is a page of the Deals shell for an investor; the founder list stays', () => {
  const routes = codeOnly(read('src/workspaces/investor/InvestorDealsRoutes.jsx'));
  assert.match(routes, /const isRoundCalls = location\.pathname === ROUND_CALLS;/);
  assert.match(routes, /bucketPath=\{isRoundCalls \? '\/deals' : undefined\}/);
  assert.match(routes, /: isRoundCalls\s*\? <RoundCallIndex \/>/);
  assert.equal(dealsPageTitle({ isRoundCalls: true }), 'Round calls · Axal VC');
  const founder = read('src/pages/founder/RoundCallPage.jsx');
  assert.match(founder, /export function RoundCallIndex\(\) \{[\s\S]*?roundCallsApi\.list\(projectId\)/);
  const shell = codeOnly(read('src/workspaces/WorkspaceShell.jsx'));
  assert.match(shell, /bucketForPath\(role, bucketPath \|\| location\.pathname\)/);
});

test('the Deals shell crumbs /round-calls as Deals ‹ Round calls, no pill lit', () => {
  const at = (props) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/round-calls'] },
    h(WorkspaceShell, { role: 'investor', title: 'Round calls', activeSlug: null, ask: null, ...props }, 'body')));
  const out = at({ bucketPath: '/deals' });
  const crumb = (out.match(/<div class="mb-2[^"]*">[\s\S]*?<\/div>/) || [''])[0];
  // Mutation checked: ignoring bucketPath (resolving from /round-calls) draws no crumb and fails.
  assert.match(crumb, /href="\/deals"[^>]*>Deals</);
  assert.match(crumb, /<b[^>]*>Round calls<\/b>/);
  assert.doesNotMatch(out, /aria-current="page"/, 'no zone pill is lit');
  // Without the prop the page is outside any bucket, as before.
  assert.doesNotMatch(at({}), /data-testid="link-workspace-crumb"/);
});
