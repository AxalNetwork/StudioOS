/**
 * D4822 (#4822, part 1) — Delivery v2: `/delivery` lands on Board, Board is action-first, the empty workspace is
 * one upstream-aware state, and a row opens the cross-zone engagement Sheet. Rendered and executed, not matched as
 * source text, except where the property IS the source (the route).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';

import {
  attentionReasons, needsAttention, nextAction, progressText, modeValue, boardCounts, matchesView, primaryAction, defaultView,
} from '../src/pages/partner/delivery/boardAttention.js';
import HealthPill from '../src/pages/partner/delivery/HealthPill.jsx';
import EngagementSheet, { sheetSections } from '../src/pages/partner/delivery/EngagementSheet.jsx';
import { DeliveryEmpty } from '../src/pages/partner/delivery/BoardZone.jsx';

const render = (C, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props)));
const text = renderedText;
const routes = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/workspaces/partner/PartnerBucketRoutes.jsx'), 'utf8'));

/** A row as `GET /partner/delivery/board` answers it. */
const row = (o = {}) => ({
  engagement_id: 1, engagement_uid: 'eng_verwood', client: 'Verwood', mode: 'project', price: 48000, seat_state: 'none',
  milestone_count: 5, milestones_done: 3, milestones_overdue: 0, open_blockers: 0, open_blockers_client_side: 0,
  scope_state: 'within', owner_user_id: 7, owner_name: 'Aoife Brennan', health: 'on_track', health_reasons: [],
  deliverables_sent: 4, deliverables_signed_off: 1, report_period: '2026-11', report_state: 'sent',
  hours_this_period: null, hours_cap: null, hours_period: null, recurring_monthly_cents: null, cancelled_at: null,
  grant_holder: null, ...o,
});

test('/delivery renders Board itself, without a redirect, and lights the Board tab', () => {
  assert.match(routes, /const landsOnBoard = bucket\?\.prefix === '\/delivery' && location\.pathname === bucket\.prefix;/);
  assert.match(routes, /const zone = landsOnBoard \? \(bucket\.zones \|\| \[\]\)\.find\(\(z\) => z\.slug === 'board'\)/);
  assert.match(routes, /activeSlug=\{landsOnBoard \? 'board' : isRoot \? null : undefined\}/);
  assert.doesNotMatch(routes, /Navigate to="\/delivery\/board"/, 'a redirect would drop `?engagement=`');
});

test('attention is facts from the record: overdue, blockers, drift, no owner, a bad rating — never an unrated row', () => {
  assert.deepEqual(attentionReasons(row()), []);
  assert.equal(needsAttention(row({ health: null })), false, 'an unrated row was called attention-worthy for that alone');
  assert.deepEqual(attentionReasons(row({ milestones_overdue: 2, health: 'at_risk' })).map((r) => r.text), ['2 milestones overdue']);
  assert.deepEqual(attentionReasons(row({ open_blockers: 1, open_blockers_client_side: 1 })).map((r) => r.key), ['blocker']);
  assert.deepEqual(attentionReasons(row({ scope_state: 'drift' })).map((r) => r.text), ['Scope drift recorded']);
  assert.deepEqual(attentionReasons(row({ owner_user_id: null, owner_name: null })).map((r) => r.text), ['Owner unassigned']);
  assert.deepEqual(attentionReasons(row({ health: 'at_risk', health_reasons: ['130% of retained hours used — over scope'] })).map((r) => r.text),
    ['At risk · 130% of retained hours used — over scope']);
  assert.deepEqual(attentionReasons(row({ cancelled_at: '2026-10-01', milestones_overdue: 3 })), [], 'a cancelled engagement asks for action');
  assert.deepEqual(attentionReasons(row({ seat_state: 'revoked', mode: 'embedded', owner_user_id: null })), []);
});

test('the next action follows the most urgent fact; a report not sent is an action, never an alarm', () => {
  assert.equal(nextAction(row({ open_blockers: 1, open_blockers_client_side: 1 })).text, 'Follow up with the client on the open blocker');
  assert.equal(nextAction(row({ milestones_overdue: 2 })).text, 'Re-plan the 2 overdue milestones');
  assert.equal(nextAction(row({ owner_user_id: null })).text, 'Assign an owner');
  const draft = nextAction(row({ report_state: 'draft' }));
  assert.equal(draft.text, 'Review the November report and mark it sent');
  const none = nextAction(row({ report_state: null }));
  assert.equal(none.text, 'Draft the November report');
  assert.equal(none.quiet, true);
  assert.equal(needsAttention(row({ report_state: null })), false, 'a report not sent made the row attention-worthy');
  assert.deepEqual(nextAction(row()), { text: 'Nothing needs action', quiet: true });
});

test('progress is the mode’s own measure, never averaged, and nothing recorded is null', () => {
  assert.equal(progressText(row()), '3 / 5 milestones');
  assert.equal(progressText(row({ milestone_count: 0, milestones_done: 0 })), null, 'a ratio over zero');
  const seat = { mode: 'embedded', seat_state: 'active', hours_this_period: 31, hours_period: '2026-11' };
  assert.equal(progressText(row({ ...seat, hours_cap: 40 })), '31h / 40h this month');
  assert.equal(progressText(row({ ...seat, hours_cap: 120, hours_period: '2026-Q4' })), '31h / 120h this quarter');
  assert.equal(progressText(row({ ...seat, hours_cap: null })), '31h this month · no retained-hours cap');
  assert.equal(progressText(row({ ...seat, seat_state: 'revoked' })), 'Seat revoked');
  assert.equal(modeValue(row()), 'Project · $48k');
  assert.equal(modeValue(row({ mode: 'embedded', recurring_monthly_cents: 900000 })), 'Embedded seat · $9k / mo');
  assert.equal(modeValue(row({ mode: 'embedded', recurring_monthly_cents: null })), 'Embedded seat', 'an unrecorded amount printed as $0');
  assert.equal(modeValue(row({ price: null })), 'Project');
});

test('views count and filter the whole board; Attention opens first only when something needs it', () => {
  const items = [row({ milestones_overdue: 1 }), row({ engagement_id: 2, client: 'Halden Labs', mode: 'embedded', seat_state: 'active' }), row({ engagement_id: 3, client: 'Lumen', health: null })];
  assert.deepEqual(boardCounts(items), { attention: 1, all: 3, project: 2, embedded: 1 });
  assert.equal(defaultView(items), 'attention');
  assert.equal(defaultView([items[1]]), 'all');
  assert.deepEqual(items.filter((r) => matchesView(r, 'attention')).map((r) => r.client), ['Verwood']);
  assert.deepEqual(items.filter((r) => matchesView(r, 'all', 'hald')).map((r) => r.client), ['Halden Labs']);
  const revoked = row({ engagement_id: 4, mode: 'embedded', seat_state: 'revoked' });
  assert.ok(matchesView(revoked, 'all') && matchesView(revoked, 'embedded'), 'a revoked seat left the board');
});

test('the primary action follows state: Open Pipeline, Review attention, Draft status report, or none', () => {
  assert.deepEqual(primaryAction([]), { key: 'pipeline', label: 'Open Pipeline', to: '/pipeline/proposals' });
  assert.equal(primaryAction([row({ milestones_overdue: 1 })]).label, 'Review attention');
  assert.equal(primaryAction([row({ report_state: 'draft' })]).label, 'Draft status report');
  assert.equal(primaryAction([row()]), null);
});

test('Not rated is worded and dashed, never green; every rating carries a word and a mark', () => {
  const nr = render(HealthPill, { health: null });
  assert.match(nr, /data-health="not_rated"/);
  assert.match(nr, /border-dashed/);
  assert.doesNotMatch(nr, /047857|emerald/, 'Not rated is drawn green');
  assert.equal(text(nr).trim(), 'Not rated');
  for (const [h, word] of [['on_track', 'On track'], ['at_risk', 'At risk'], ['blocked', 'Blocked']]) {
    const out = render(HealthPill, { health: h });
    assert.match(text(out), new RegExp(word));
    assert.match(out, /aria-hidden="true">[✓!✕]</, `${h} relies on colour alone`);
  }
});

test('the empty workspace is one upstream-aware state with Open Pipeline, and no zero', () => {
  const out = render(DeliveryEmpty, {});
  const t = text(out);
  assert.match(t, /No active client work yet/);
  assert.match(t, /Delivery begins when a proposal is accepted and becomes an engagement\./);
  assert.match(t, /Pipeline\s*→\s*Proposal\s*→\s*Engagement\s*→\s*Delivery/);
  assert.match(out, /href="\/pipeline\/proposals"[^>]*>Open Pipeline →/);
  assert.doesNotMatch(t, /\b0\b/, 'the empty state prints a zero');
});

test('the Sheet is built from the board row: header, next action, five zone summaries, links that carry the engagement', () => {
  const r = row({ milestones_overdue: 2, health: 'at_risk', health_reasons: ['2 milestones past due'], report_state: null });
  const out = render(EngagementSheet, { row: r, onClose: () => {} });
  assert.match(out, /role="dialog"/);
  assert.match(out, /aria-modal="true"/);
  assert.match(out, /aria-labelledby="engagement-sheet-1"/);
  const t = text(out);
  assert.match(t, /Verwood/);
  assert.match(t, /Project · \$48k/);
  assert.match(t, /owner Aoife Brennan/);
  assert.match(t, /Next action\s*Re-plan the 2 overdue milestones/);
  for (const z of ['health', 'deliverables', 'status-reports', 'capacity']) {
    assert.match(out, new RegExp(`href="/delivery/${z}\\?engagement=eng_verwood"`), `${z} does not carry the engagement`);
  }
  const s = Object.fromEntries(sheetSections(r).map((x) => [x.key, x.text]));
  assert.equal(s.progress, '3 / 5 milestones · 2 overdue');
  assert.equal(s.deliverables, '4 sent · 1 signed off · read status unavailable', 'a client read was claimed');
  assert.equal(s.report, 'November · not started');
  assert.equal(s.health, 'At risk · in scope · 2 milestones past due');
  assert.equal(s.capacity, 'No embedded seat on this engagement');
  const unrated = Object.fromEntries(sheetSections(row({ health: null, scope_state: null, milestone_count: 0, deliverables_sent: 0 })).map((x) => [x.key, x.text]));
  assert.equal(unrated.health, 'Not rated · scope not assessed');
  assert.equal(unrated.progress, 'Not recorded · no milestones yet');
  assert.equal(unrated.deliverables, 'None sent yet');
  assert.match(text(render(EngagementSheet, { row: row({ owner_user_id: null, owner_name: null }), onClose: () => {} })), /no owner assigned/);
});
