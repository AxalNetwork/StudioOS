/**
 * D6151 part 3 (#6151) — the Investment committee page on a phone, board DE27 of the Deals v2 addendum (D6141):
 * the decision as one column, the tally with Recused beside it, vote cards, the conditions linking to Closing, and
 * a sticky Vote that opens a sheet asking for the reason. Every person and decision here is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deals_commit_phone_6151.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import InvestorCommitZone from '../src/pages/investor/deals/CommitZone.jsx';
import { CommitPhone, phoneVoteState, votedLine } from '../src/pages/investor/deals/CommitPhone.jsx';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

const ME = { id: 7, role: 'investor', name: 'Example Investor' };
const ROSTER = (ids) => ({ available: true, eligible: ids.length, members: ids.map((id) => ({ user_id: id, name: `Member ${id}` })) });
const OPEN = (over = {}) => ({
  uid: 'd-open', title: 'Example Copperline · Seed SAFE', status: 'voting', created_by: 1, deal_id: 42,
  tally: { yes: 1, no: 1, abstain: 0, recused: 1 },
  votes: [
    { user_id: 1, user_name: 'Partner One', vote: 'yes', rationale: 'Pilots convert', created_at: '2026-11-07 10:12:00' },
    { user_id: 2, user_name: 'Partner Two', vote: 'no', rationale: null, created_at: '2026-11-07 11:30:00' },
    { user_id: 3, user_name: 'Partner Three', vote: 'recused', rationale: 'Advisor to the company', created_at: '2026-11-06 18:00:00' },
  ],
  roster: ROSTER([1, 2, 3, 7]),
  ...over,
});
const CONDITIONS = [
  { uid: 'c1', decision_uid: 'd-open', body: 'Customer reference calls', status: 'open' },
  { uid: 'c2', decision_uid: 'd-open', body: 'Board observer seat', status: 'met', resolved_at: '2026-11-09 10:00:00' },
  { uid: 'c3', decision_uid: 'd-open', body: 'Pro-rata side letter', status: 'waived', resolved_at: '2026-11-08 10:00:00' },
];
const ROOM = (decision = OPEN()) => ({
  decisions: { available: true, total: 1, rows: [decision] },
  current: decision,
  rationale: { recorded: 1, total: 2, enforced: true },
  room: { available: false },
  conditions: { available: true, rows: CONDITIONS },
  minutes: { available: true, recorded: false, meeting_title: 'IC', may_record: false },
});

// Mutation checked: a role that may not vote offered Vote (fails); a decided decision offered Vote (fails); a standing
// recusal offered Vote (fails); a roster that leaves you off offered Vote (fails); a decision with no roster refused (fails).
test('DE27: Vote is offered on the Worker’s own rules — role, an open decision, no standing recusal, on the roster if one is set', () => {
  assert.equal(phoneVoteState(null, OPEN()).canVote, false);
  assert.match(phoneVoteState({ id: 9, role: 'founder' }, OPEN()).reason, /investors, partners and admins/);
  assert.match(phoneVoteState(ME, OPEN({ status: 'decided' })).reason, /Voting is closed/);
  assert.match(phoneVoteState({ id: 3, role: 'partner' }, OPEN()).reason, /recused yourself/);
  assert.match(phoneVoteState(ME, OPEN({ roster: ROSTER([1, 2, 3]) })).reason, /not on it/);
  assert.equal(phoneVoteState(ME, OPEN()).canVote, true);
  assert.equal(phoneVoteState(ME, OPEN({ roster: { available: false, members: [] } })).canVote, true, 'no roster: anyone who may see it votes');
});

// Mutation checked: the recusal counted in the voted line (fails as 2 of 4); no roster drawn as a count (fails).
test('DE27: who has voted is read against the roster, a recusal counted beside the votes, and whether you have', () => {
  assert.equal(votedLine(ME, OPEN()), '3 of 4 eligible have voted. You have not voted.');
  assert.equal(votedLine({ id: 1, role: 'partner' }, OPEN()), '3 of 4 eligible have voted. You voted Invest.');
  assert.equal(votedLine({ id: 3, role: 'partner' }, OPEN()), '3 of 4 eligible have voted. You recused.');
  assert.equal(votedLine(ME, OPEN({ roster: { available: false } })), 'No voting roster is set, so eligible voters are not recorded. You have not voted.');
});

// Mutation checked: Recused inside the tally's cells as a vote (fails); a missing count drawn as 0 (fails); a recusal's
// declaration drawn as a rationale (fails); an open condition without its Closing link (fails); the phone view shown from md (fails).
test('DE27 A and B: the tally keeps Recused beside it, each vote is a card, and an open condition links to Closing', () => {
  const out = html(h(CommitPhone, {
    decision: OPEN({ tally: { yes: 1, no: 1, recused: 1 } }), user: ME, conditions: CONDITIONS, closingTo: '/deals/closing?deal=42', onVoted() {},
  }));
  assert.match(out, /data-testid="commit-phone"[^>]*/);
  assert.match(out, /class="space-y-4 md:hidden" data-testid="commit-phone"/, 'the phone view is below md only');
  assert.match(out, /Decision · Voting[\s\S]*Example Copperline · Seed SAFE[\s\S]*◐ Voting[\s\S]*Outcome not decided yet/);
  assert.match(out, /data-testid="commit-phone-memo" href="\/deals\/commit\/d-open"/, 'the memo is on the decision record');
  assert.match(out, /commit-phone-tally-recused"[^>]*>.*?1<\/b><small[^>]*>Recused · not in the tally/s);
  assert.match(out, /commit-phone-tally-abstain"[^>]*><span[^>]*>Not recorded<\/span>/, 'a count the read did not carry is Not recorded');
  assert.match(out, /commit-phone-vote-recused[\s\S]*?Declared: Advisor to the company/);
  assert.match(out, /commit-phone-vote-no[\s\S]*?Rationale not recorded[\s\S]*?cast before a rationale was required/);
  assert.match(out, /data-testid="commit-phone-condition-closing" href="\/deals\/closing\?deal=42"[^>]*>! Open · blocks Closing ›/);
  assert.match(out, /✓ Met · 9 Nov/);
  assert.match(out, /— Waived · 8 Nov/);
  assert.match(out, /data-testid="commit-phone-vote"[^>]*>Vote<\/button>/);
  // A partner cannot open Closing: the open condition says so without a link.
  const partner = html(h(CommitPhone, { decision: OPEN(), user: { id: 1, role: 'partner' }, conditions: CONDITIONS, closingTo: null, onVoted() {} }));
  assert.doesNotMatch(partner, /commit-phone-condition-closing/);
  assert.match(partner, /! Open · blocks Closing</);
});

/** The page under the auth provider, which reads the signed-in user `mountContracts` stores. */
const page = () => h(AuthProvider, null, h(InvestorCommitZone));

function stub({ room = async () => ROOM(), vote = async () => ({ ok: true }) } = {}) {
  const saved = { room: api.icCommitRoom, conditions: api.icConditions, vote: api.icVote };
  const calls = [];
  api.icCommitRoom = async () => { calls.push(['room']); return room(); };
  api.icConditions = async () => ({ items: [] });
  api.icVote = async (uid, body) => { calls.push(['vote', uid, body]); return vote(uid, body); };
  return { calls, restore: () => { api.icCommitRoom = saved.room; api.icConditions = saved.conditions; api.icVote = saved.vote; } };
}
const all = (v, id) => v.nodes().filter((n) => v.props(n)?.['data-testid'] === id);
const by = (v, id) => all(v, id)[0];
const settle = async (v) => { for (let i = 0; i < 6; i += 1) await v.flush(); };
const press = async (v, id) => { const n = by(v, id); assert.ok(n, `missing ${id}`); await act(async () => { await v.props(n).onClick({ stopPropagation() {}, preventDefault() {} }); }); };
const change = async (v, id, value) => { const n = by(v, id); assert.ok(n, `missing ${id}`); await act(async () => { v.props(n).onChange({ target: { value } }); }); };

// Mutation checked: the desktop card not hidden below md (fails); the strip shown on the phone's Current view (fails);
// a blank reason sent (fails); the vote sent without its rationale (fails); no re-read after the vote (fails); the
// Worker's refusal swallowed (fails).
test('DE27 C: on the page, the phone and desktop halves split at md, and Vote asks for the reason before it sends', async () => {
  const s = stub();
  const v = await mountContracts(page(), '/deals/commit', ME);
  try {
    await settle(v);
    assert.match(v.props(by(v, 'commit-desktop')).className, /\bhidden\b[^"]*\bmd:block\b/);
    assert.match(v.props(by(v, 'commit-strip-wrap')).className, /\bhidden md:block\b/);
    assert.ok(by(v, 'commit-phone'));
    await press(v, 'commit-phone-vote');
    assert.ok(by(v, 'commit-vote-sheet') || v.text().includes('Your vote · Example Copperline'), 'the Vote sheet opens');
    await press(v, 'commit-vote-submit');
    assert.match(v.text(), /Choose Invest, Pass, Abstain or Recuse/);
    await change(v, 'commit-vote-choice-yes');
    await change(v, 'commit-vote-rationale', '   ');
    await press(v, 'commit-vote-submit');
    assert.match(v.text(), /Every vote records its reason/);
    assert.equal(s.calls.filter((c) => c[0] === 'vote').length, 0, 'a blank reason is never sent');
    await change(v, 'commit-vote-rationale', 'The cap is inside our range');
    await press(v, 'commit-vote-submit');
    await settle(v);
    assert.deepEqual(s.calls.filter((c) => c[0] === 'vote'), [['vote', 'd-open', { vote: 'yes', rationale: 'The cap is inside our range' }]]);
    assert.equal(s.calls.filter((c) => c[0] === 'room').length, 2, 'the page re-reads after the vote');
    assert.equal(Boolean(by(v, 'commit-vote-submit')), false, 'the sheet closes');
  } finally { await v.unmount(); s.restore(); }

  const refuse = stub({ vote: async () => { const e = new Error('This decision has a voting roster and you are not on it.'); e.status = 403; throw e; } });
  const v2 = await mountContracts(page(), '/deals/commit', ME);
  try {
    await settle(v2);
    await press(v2, 'commit-phone-vote');
    await change(v2, 'commit-vote-choice-recused');
    assert.match(v2.text(), /Declare the conflict/, 'a recusal asks for its declaration');
    await change(v2, 'commit-vote-rationale', 'Advisor to the company');
    await press(v2, 'commit-vote-submit');
    await settle(v2);
    assert.match(v2.props(by(v2, 'commit-vote-error')).children, /not on it/, 'the Worker’s refusal is shown in its words');
  } finally { await v2.unmount(); refuse.restore(); }
});

// Mutation checked: a partner given the Closing link Closing refuses them (fails); the deal dropped from the link (fails).
test('DE27: on the page an open condition links to its deal’s Closing; a partner, whom Closing refuses, gets no link', async () => {
  const s = stub();
  const v = await mountContracts(page(), '/deals/commit', ME);
  try {
    await settle(v);
    assert.equal(v.props(by(v, 'commit-phone-condition-closing')).href, '/deals/closing?deal=42');
  } finally { await v.unmount(); s.restore(); }
  const s2 = stub();
  const v2 = await mountContracts(page(), '/deals/commit', { id: 1, role: 'partner', name: 'Partner One' });
  try {
    await settle(v2);
    assert.ok(by(v2, 'commit-phone-condition-open'));
    assert.equal(Boolean(by(v2, 'commit-phone-condition-closing')), false);
  } finally { await v2.unmount(); s2.restore(); }
});

// Mutation checked: a 403 drawn as a failure with Try again (fails); a 503 drawn as a refusal (fails).
test('DE27 E: a refused committee read says who the committee is for and offers no Try again; a failed one still does', async () => {
  const s = stub({ room: async () => { const e = new Error('Forbidden'); e.status = 403; throw e; } });
  const v = await mountContracts(page(), '/deals/commit', ME);
  try {
    await settle(v);
    assert.ok(by(v, 'commit-refused'));
    assert.match(v.text(), /Investment committee is for investors, partners and admins\.An admin can grant the licence\./);
    assert.doesNotMatch(v.text(), /Try again/);
  } finally { await v.unmount(); s.restore(); }
  const s2 = stub({ room: async () => { const e = new Error('down'); e.status = 503; throw e; } });
  const v2 = await mountContracts(page(), '/deals/commit', ME);
  try {
    await settle(v2);
    assert.equal(Boolean(by(v2, 'commit-refused')), false);
    assert.match(v2.text(), /The committee record could not be read/);
  } finally { await v2.unmount(); s2.restore(); }
});
