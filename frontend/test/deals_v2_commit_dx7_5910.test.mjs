/**
 * Deals v2 · DX7 (#5910, D4815): `/deals/commit` as the Investment committee
 * page, boards DE07 (a decision open) and DE07b (none open).
 *
 * Rendered from the zone's own components with fixed fixtures: no clock, no
 * network. The layout's columns and strip labels are read off the canvas in
 * `investor_deals_id3.test.mjs`; this file pins what each part says.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import {
  CommitStrip, ConditionsCard, DecisionCard, HowThisWorks, MinutesCard, NoOpenDecision, UNAVAILABLE,
  VoteMark, ballotOf, conditionOwner, openDecisionOf, stamp,
} from '../src/pages/investor/deals/CommitZone.jsx';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter,null,el));
const ZONE = readFileSync(resolve(process.cwd(), 'frontend/src/pages/investor/deals/CommitZone.jsx'), 'utf8');

const OPEN = {
  uid: 'd-open', title: 'Fixture decision', status: 'voting', created_by: 1,
  tally: { yes: 1, no: 0, abstain: 1, recused: 1 }, votes_cast: 3, rationales: 2,
  votes: [
    { user_id: 1, user_name: 'Partner One', vote: 'yes', rationale: 'Within thesis', created_at: '2026-11-07 10:12:00' },
    { user_id: 2, user_name: 'Partner Two', vote: 'abstain', rationale: null, created_at: '2026-11-07 11:30:00' },
    { user_id: 3, user_name: 'Partner Three', vote: 'recused', rationale: 'Board seat at a competitor', created_at: '2026-11-06 18:00:00' },
  ],
};
const DECIDED = { uid: 'd-old', title: 'Older decision', status: 'decided', decision: 'pass', votes: [], tally: {} };

const room = (over = {}) => ({
  decisions: { available: true, total: 2, rows: [DECIDED, OPEN] },
  current: DECIDED,
  rationale: { recorded: 2, total: 3, enforced: true },
  room: { available: true, invited: 4, by_rsvp: { yes: 4 }, meeting_title: 'IC', starts_at: '2026-11-10 09:00:00' },
  conditions: { available: true, rows: [] },
  minutes: { available: false, reason: 'No IC meeting is linked to this decision’s deal, so there are no minutes to read.' },
  ...over,
});

test('the current decision is the newest one not yet decided; with none, there is none', () => {
  assert.equal(openDecisionOf(room()).uid, 'd-open', 'a decided decision was put on the card');
  assert.equal(openDecisionOf(room({ decisions: { available: true, total: 1, rows: [DECIDED] } })), null);
  assert.equal(openDecisionOf(room({ decisions: { available: false } })), null);
});

test('DE07 strip: votes cast leave the recusal out, and the meeting is drawn only for its own decision', () => {
  const r = room({ current: OPEN });
  const out = html(h(CommitStrip, { room: r, decision: OPEN }));
  assert.match(out, /Current decision.*Fixture decision/s);
  // Three vote rows, one of them a recusal: two votes cast.
  assert.deepEqual(ballotOf(OPEN), { eligible: null, voted: 2, recused: 1, rationales: 1 });
  assert.match(out, /data-testid="commit-tile-votes".*?>2<\/span>/s);
  assert.match(out, /1 recused, beside the tally · eligible voters not recorded/);
  assert.match(out, /data-testid="commit-tile-rationales".*?>1 of 2<\/span>/s);
  assert.match(out, /data-testid="commit-tile-meeting".*?>10 Nov 2026<\/span>/s);
  assert.match(out, /4 invited, not entitled to vote/);
  // The route's meeting belongs to another decision: not drawn as this one's.
  const other = html(h(CommitStrip, { room: room(), decision: OPEN }));
  assert.match(other, /data-testid="commit-tile-meeting".*?Not recorded.*?the meeting read follows another decision/s);
  assert.doesNotMatch(other, /10 Nov 2026/);
});

test('the decision card shows eligible voters (Not recorded), voted and recused, and one row per vote', () => {
  const out = html(h(DecisionCard, { decision: OPEN }));
  assert.match(out, /<dt>Eligible voters<\/dt><dd><span[^>]*>Not recorded<\/span><\/dd>/);
  assert.match(out, /<dt>Voted<\/dt><dd[^>]*>2<\/dd>/);
  assert.match(out, /<dt>Recused<\/dt><dd[^>]*>1<\/dd>/);
  assert.match(out, /Partner.*Vote.*Rationale.*Recorded/s);
  assert.match(out, /7 Nov 2026, 10:12/);
  // An abstention with no reason reads Not recorded, not blank.
  const abstain = /data-testid="commit-vote-abstain"[\s\S]*?(?=data-testid="commit-vote-)/.exec(out)[0];
  assert.match(abstain, /Not recorded/);
});

test('a recusal looks and reads differently from an abstention', () => {
  const recused = html(h(VoteMark, { vote: 'recused' }));
  const abstain = html(h(VoteMark, { vote: 'abstain' }));
  // Words.
  assert.match(recused, /Recused/);
  assert.doesNotMatch(recused, /Abstain/);
  assert.match(abstain, /Abstain/);
  // Shape, not colour alone: a dashed mark with ⊘ for the recusal only.
  assert.match(recused, /border-dashed/);
  assert.match(recused, /⊘/);
  assert.doesNotMatch(abstain, /border-dashed|⊘/);
  // And the row says what each does to the tally.
  const card = html(h(DecisionCard, { decision: OPEN }));
  // Plain string slicing, not a RegExp built from the vote name.
  const rowStart = (vote) => {
    const at = card.indexOf(`data-testid="commit-vote-${vote}"`);
    assert.ok(at >= 0, `no ${vote} row`);
    return at;
  };
  const row = (vote) => {
    const at = rowStart(vote);
    const next = card.indexOf('data-testid="commit-vote-', at + 1);
    return card.slice(at, next < 0 ? card.length : next);
  };
  const rowClass = (vote) => {
    const prefix = `data-testid="commit-vote-${vote}" class="`;
    const at = card.indexOf(prefix);
    assert.ok(at >= 0, `no ${vote} row class`);
    const from = at + prefix.length;
    return card.slice(from, card.indexOf('"', from));
  };
  assert.match(row('recused'), /Board seat at a competitor/);
  assert.match(row('recused'), /Conflict declared · not counted in the tally/);
  assert.match(rowClass('recused'), /bg-gray-50 dark:bg-gray-800\/40/, 'the recused row is not muted');
  assert.match(row('abstain'), /A vote cast · counted in the tally/);
  assert.doesNotMatch(row('abstain'), /not counted in the tally/);
  assert.doesNotMatch(rowClass('abstain'), /bg-gray-50/, 'the abstain row is muted like a recusal');
});

test('conditions: open ones are blocking Closing, and an owner is drawn only from what is recorded', () => {
  const rows = [
    { uid: 'c1', body: 'Reference calls', status: 'open', decision_uid: 'd-open', decision_title: 'Fixture decision', created_at: '2026-11-07 09:00:00', owner_user_id: null, owner_label: 'Founder' },
    { uid: 'c2', body: 'Cap table', status: 'open', decision_uid: 'd-open', decision_title: 'Fixture decision', created_at: '2026-11-07 09:00:00', owner_user_id: 7, owner_label: null },
    { uid: 'c3', body: 'Board consent', status: 'met', decision_uid: 'd-old', decision_title: 'Older decision', created_at: '2026-11-01 09:00:00', resolved_at: '2026-11-02 09:00:00', owner_user_id: null, owner_label: null },
  ];
  const more = { c2: { uid: 'c2', owner_name: 'Partner Seven', created_by_name: 'Partner One' } };
  const out = html(h(ConditionsCard, { conditions: rows, more }));
  assert.match(out, /2 open · blocking Closing/);
  assert.match(out, /Condition.*Status.*Owner.*Decision.*Recorded/s);
  assert.equal((out.match(/Blocks Closing/g) || []).length, 2, 'each open condition says it blocks Closing');
  const row = (uid) => new RegExp(`${rows.find((r) => r.uid === uid).body}[\\s\\S]*?(?=data-testid="commit-condition-|$)`).exec(out)[0];
  assert.match(row('c1'), /Founder/);
  assert.match(row('c2'), /Partner Seven/);
  assert.match(row('c2'), /by Partner One/);
  assert.match(row('c3'), /Not recorded/);
  assert.doesNotMatch(row('c3'), /Blocks Closing/);
  assert.match(row('c3'), /Older decision/);
  // The owner functions directly: label, name, both, neither, and a failed name read.
  assert.deepEqual(conditionOwner({ owner_label: 'Founder' }), { text: 'Founder', sub: null });
  assert.deepEqual(conditionOwner({ owner_user_id: 7 }, { owner_name: 'P' }), { text: 'P', sub: null });
  assert.deepEqual(conditionOwner({ owner_user_id: 7, owner_label: 'Counsel' }, { owner_name: 'P' }), { text: 'P', sub: 'Counsel' });
  assert.deepEqual(conditionOwner({ owner_user_id: null, owner_label: null }), { notRecorded: true });
  assert.deepEqual(conditionOwner({ owner_user_id: 7 }, UNAVAILABLE), { unreadable: true });
  assert.match(html(h(ConditionsCard, { conditions: [rows[1]], more: UNAVAILABLE })), /Unreadable/);
  // Nothing open: nothing blocks.
  assert.match(html(h(ConditionsCard, { conditions: [rows[2]] })), /None open · nothing here blocks Closing/);
});

test('minutes are shown, or their absence is stated', () => {
  const recorded = html(h(MinutesCard, { minutes: { available: true, recorded: true, meeting_title: 'IC', minutes: 'The room concluded.', recorded_at: '2026-11-10 12:00:00', recorded_by: 'Partner One' } }));
  assert.match(recorded, /The room concluded\./);
  assert.match(recorded, /Recorded 10 Nov 2026, 12:00 by Partner One\./);
  const none = html(h(MinutesCard, { minutes: { available: true, recorded: false, meeting_title: 'IC on 10 Nov' } }));
  assert.match(none, /Not recorded.*Minutes for IC on 10 Nov haven’t been recorded yet\./s);
  const unlinked = html(h(MinutesCard, { minutes: room().minutes }));
  assert.match(unlinked, /Not recorded.*No IC meeting is linked/s);
  const other = html(h(MinutesCard, { minutes: { available: true, recorded: true, minutes: 'Another room.' }, forDecision: false }));
  assert.match(other, /not this one/);
  assert.doesNotMatch(other, /Another room\./, 'another decision’s minutes were drawn as this one’s');
});

test('DE07b: with no open decision the page says so, with How voting works', () => {
  const out = html(h(NoOpenDecision, {}));
  assert.match(out, /No investment decision is open\./);
  assert.match(out, /Decisions appear here when a deal reaches IC\./);
  assert.match(out, /<details[^>]*>.*<summary[^>]*>How voting works/s);
  assert.doesNotMatch(out, /decided decision/);
  const some = html(h(NoOpenDecision, { decided: 2, onShowAll: () => {} }));
  assert.match(some, /2 decided decisions are under/);
  // The zone draws DE07b on the This deal view when nothing is open, and as
  // the empty store.
  const z = codeOnly(ZONE);
  assert.match(z, /current \? \([\s\S]*?\) : \(\s*<NoOpenDecision decided=\{decided\}/);
  assert.match(z, /empty=\{<NoOpenDecision \/>\}/);
});

test('long method text sits under How this works, not on the record', () => {
  const how = html(h(HowThisWorks, {}));
  assert.match(how, /<details[^>]*><summary[^>]*>How this works/);
  assert.match(how, /An abstention is a vote cast/);
  const record = html(h(DecisionCard, { decision: OPEN })) + html(h(ConditionsCard, { conditions: [] }));
  assert.doesNotMatch(record, /An abstention is a vote cast|No voting roster/);
  assert.match(codeOnly(ZONE), /<MinutesCard minutes=\{minutesBlock\} forDecision=\{sameMeeting\} decisionLabel=\{minutesDecision\}>[\s\S]*?<HowThisWorks \/>/);
});

test('dates print in UTC, as D1 stores them, and an absent one is null', () => {
  assert.equal(stamp('2026-11-07 23:30:00'), '7 Nov 2026');
  assert.equal(stamp('2026-11-07 23:30:00', { time: true }), '7 Nov 2026, 23:30');
  assert.equal(stamp(null), null);
});

test('none of DE07’s sample names reaches the page', () => {
  for (const sample of ['Acme Robotics', 'Name A', 'Customer reference calls', 'Updated cap table', 'Strong team; pilots convert']) {
    assert.ok(!ZONE.includes(sample), `the zone ships DE07's sample "${sample}"`);
  }
});

// Review on #6876 (2026-11-16): the three things it asked for.
test('review #6876 (1): every place that prints a decision\'s rationales counts them as the card does', () => {
  // The fixture's Worker summary says 2 of 3 (the recusal and its declaration counted); the card says 1 of 2.
  assert.equal(`${OPEN.rationales} of ${OPEN.votes_cast}`, '2 of 3');
  assert.equal(`${ballotOf(OPEN).rationales} of ${ballotOf(OPEN).voted}`, '1 of 2');
  const code = codeOnly(ZONE);
  const list=readFileSync(resolve(process.cwd(),'frontend/src/pages/ICDecisionsPage.jsx'),'utf8');
  assert.match(list,/ballotOf\(d\)\.rationales/);
  assert.match(list,/ballotOf\(d\)\.voted/);
  assert.doesNotMatch(code, /\$\{r\.rationales\} of \$\{r\.votes_cast\}/, 'a table or export still prints the Worker\'s count');
  assert.equal((code.match(/`\$\{ballotOf\(r\)\.rationales\} of \$\{ballotOf\(r\)\.voted\}`/g) || []).length, 1, 'the existing export; D6154’s list uses the same ballot model');
});

test('review #6876 (2): the current decision\'s strip and card count its own open conditions, and the cross-decision list says so', () => {
  const conds = [
    { uid: 'c1', decision_uid: 'd-open', status: 'open', text: 'Reference calls' },
    { uid: 'c2', decision_uid: 'd-other', status: 'open', text: 'Another deal' },
    { uid: 'c3', decision_uid: 'd-other', status: 'open', text: 'Another deal again' },
  ];
  const strip = html(h(CommitStrip, { room: room({ current: OPEN, conditions: { available: true, rows: conds } }), decision: OPEN }));
  assert.match(strip, /data-testid="commit-tile-conditions".*?>1<\/span>/s, 'another decision\'s conditions counted under Current decision');
  const none = html(h(CommitStrip, { room: room({ current: OPEN, conditions: { available: true, rows: conds.slice(1) } }), decision: OPEN }));
  assert.match(none, /data-testid="commit-tile-conditions".*?>0<\/span>.*?nothing blocks Closing/s);
  const across = html(h(ConditionsCard, { conditions: conds, across: true }));
  assert.match(across, /3 open across your decisions · each blocks its own deal’s Closing/);
  assert.doesNotMatch(across, />3 open · blocking Closing</);
  // The current view hands the card only this decision's conditions.
  assert.match(codeOnly(ZONE), /<ConditionsCard conditions=\{conditions\.filter\(\(cond\) => cond\.decision_uid === current\.uid\)\}/);
  assert.match(codeOnly(ZONE), /<ConditionsCard conditions=\{conditions\} more=\{more\} control=\{resolveControl\} error=\{condActionError\} across \/>/);
});

test('review #6876 (3): the minutes say whose meeting they are, and the export is off when they are another decision\'s', () => {
  const minutes = { available: true, recorded: true, meeting_title: 'IC', minutes: 'The room concluded.', recorded_at: '2026-11-10 12:00:00' };
  assert.match(html(h(MinutesCard, { minutes, decisionLabel: 'Older decision' })), /For the decision Older decision/);
  assert.doesNotMatch(html(h(MinutesCard, { minutes, forDecision: false, decisionLabel: 'Older decision' })), /For the decision/);
  const code = codeOnly(ZONE);
  assert.match(code, /if \(view === 'current' && current && !sameMeeting\) \{\s*return \{ onClick: \(\) => \{\}, disabled: true,/);
  assert.match(code, /header: \['Decision', 'Meeting', 'Recorded', 'Recorded by', 'Minutes'\]/);
  assert.match(code, /<MinutesCard minutes=\{minutesBlock\} decisionLabel=\{minutesDecision\}>/, 'the Minutes view names the decision');
});
