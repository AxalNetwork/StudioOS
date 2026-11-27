/**
 * #5314 part 2 (D4822) — the status report's written Blocked section and the
 * client review history, as the Delivery pages draw them.
 *
 *   SAVE      `blocked` is sent only when the composer states it, and an
 *             empty section is sent as null ("nothing blocked"), so a save
 *             that never showed the section cannot write one.
 *   BLOCKED   a report saved before the section existed reads Not recorded,
 *             never "Nothing blocked".
 *   HISTORY   an unreadable history reads Unreadable, never an empty list; a
 *             score saved before history began says earlier reviews are Not
 *             recorded.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { blockedLine, saveRequest } from '../src/pages/partner/delivery/statusReportDraft.js';
import { reviewHistoryView } from '../src/pages/partner/delivery/HealthZone.jsx';

const draft = { engagement_id: 7, period: '2026-11' };

test('saveRequest sends blocked only when stated, and an empty section as null', () => {
  assert.equal('blocked' in saveRequest(draft, { shipped: 's', next_up: 'n' })[2], false,
    'a caller that never showed the section sends no key');
  // Mutation checked: send `fields.blocked` untrimmed -> the first value keeps its spaces and this fails.
  assert.equal(saveRequest(draft, { shipped: 's', next_up: 'n', blocked: '  Waiting on access ' })[2].blocked, 'Waiting on access');
  // Mutation checked: send '' instead of null -> this fails.
  assert.equal(saveRequest(draft, { shipped: 's', next_up: 'n', blocked: '   ' })[2].blocked, null);
});

test('blockedLine: Not recorded, Nothing blocked and written words are three different things', () => {
  // Mutation checked: test `report.blocked` before `blocked_recorded` -> the old report reads "Nothing blocked".
  const old = blockedLine({ blocked: null, blocked_recorded: false, blocked_state_note: 'Not recorded: saved without a Blocked section.' });
  assert.deepEqual([old.kind, old.text], ['not_recorded', 'Not recorded']);
  assert.match(old.note, /^Not recorded/);
  assert.equal(blockedLine({ blocked: null, blocked_recorded: true }).kind, 'none');
  assert.deepEqual(blockedLine({ blocked: 'CRM export', blocked_recorded: true }), { kind: 'written', text: 'CRM export', note: null });
  assert.equal(blockedLine(null).kind, 'not_recorded');
});

test('reviewHistoryView: an unreadable history is Unreadable, never an empty list', () => {
  // Mutation checked: drop the `available === false` test -> kind 'empty' and this fails.
  assert.equal(reviewHistoryView({ available: false, items: null, reason: 'Unreadable: x' }).kind, 'unreadable');
  assert.equal(reviewHistoryView({ error: true }).kind, 'unreadable');
  assert.equal(reviewHistoryView(null).kind, 'loading');
});

test('reviewHistoryView: each recorded review, a cleared score, and earlier reviews Not recorded', () => {
  const v = reviewHistoryView({
    available: true,
    items: [
      { id: 1, satisfaction: 4, cleared: false, source: 'QBR call', said_at: '2026-10-01', recorded_at: '2026-10-02T09:00:00Z', recorded_by_name: 'Ours' },
      { id: 2, satisfaction: null, cleared: true, source: null, said_at: null, recorded_at: '2026-11-02T09:00:00Z', recorded_by_name: null },
    ],
    earlier_not_recorded: false,
  });
  assert.equal(v.kind, 'list');
  assert.deepEqual(v.items.map((r) => r.score), ['4.0 / 5', 'Score cleared']);
  assert.equal(v.earlier, null);
  const before = reviewHistoryView({ available: true, items: [], earlier_not_recorded: true, earlier_note: 'Not recorded: before history.' });
  // Mutation checked: ignore `earlier_not_recorded` -> earlier is null and this fails.
  assert.deepEqual([before.kind, before.earlier], ['empty', 'Not recorded: before history.']);
});

test('the composer draws a Blocked field and saves it; the card draws the saved section', () => {
  const zone = readFileSync(new URL('../src/pages/partner/delivery/StatusReportsZone.jsx', import.meta.url), 'utf8');
  assert.match(zone, /<Field label="Blocked"/);
  assert.match(zone, /saveRequest\(draft, \{ shipped, next_up: nextUp, blocked: blockedText \}\)/);
  assert.match(zone, /setBlockedText\(r\?\.existing\?\.blocked \|\| ''\)/, 'an existing draft reopens with its section');
  assert.match(zone, /<ReportBlocked report=\{report\} \/>/);
  const health = readFileSync(new URL('../src/pages/partner/delivery/HealthZone.jsx', import.meta.url), 'utf8');
  assert.match(health, /Client review history/);
  assert.match(health, /partnerDeliveryReviewsApi\.partnerEngagementReviews\(engagementId\)/);
});
