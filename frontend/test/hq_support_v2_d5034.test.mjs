/**
 * D5034 (#5034) — HQ › Support v2, part 1: the four workspaces, the header,
 * the all-clear state, the active queue, Branches, Delivery and Policy.
 *
 * The model is pure and the components render over props, so each canvas
 * state (`design/incoming/Support v2 Page.dc.html`, boards SU01a to SU11) is
 * drawn here. What is pinned about the page itself is read from its source,
 * because its reads run in an effect that `renderToStaticMarkup` never runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';

import {
  SUPPORT_WORKSPACES, workspaceFromSearch, workspaceHref, queueOverview, subsidiaryLine, sourcesText,
  escalationGroups, deadlineText, kindHoursOf, previewOf, queueKindChoices, hqTicketRows, hqTicketCount,
  tierOfPriority, branchCards, matrixCompares, mirrorLine, distributionState, workspaceMarks, figureText,
  notDelivered, deliveryRows,
} from '../src/pages/hq/support/supportWorkspaceModel.js';
import {
  SupportHeader, WorkspaceNav, ActionRequired, AllClear, QueueKindFilter, EscalationQueue, HqTicketsSection,
  SubsidiariesLine, BranchesWorkspace, DeliveryWorkspace, DistributionBanner, SupportBadge,
} from '../src/pages/hq/support/SupportWorkspaces.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PAGE = codeOnly(readFileSync(resolve(root, 'frontend/src/pages/hq/HqSupportPage.jsx'), 'utf8'));
const render = (C, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props)));
const text = renderedText;

const READ = '2026-11-08T14:30:00.000Z';
const at = (h) => new Date(Date.parse(READ) + h * 3600000).toISOString();
const zeroBucket = { count: 0, oldest_age_hours: null, bands: { ok: 0, due_soon: 0, past: 0, undated: 0 }, items: [] };
const KINDS = [{ kind: 'moderation', hours: 24 }, { kind: 'seat_increase', hours: 72 }, { kind: 'terms_change', hours: 120 }, { kind: 'renewal', hours: 72 }];

function empty(over = {}) {
  return {
    read_at: READ,
    escalations: { available: true, complete: true, count: 0, bands: { ok: 0, due_soon: 0, past: 0 }, oldest_age_hours: null, items: [], kinds: [] },
    tickets: { available: true, complete: true, open: 0, buckets: { hq_held: zeroBucket, admin_product: zeroBucket } },
    branch_tickets: { lines: [], coverage: { answered: 0, total: 0, unreadable: [] } },
    sla_policy: { escalation_kinds: KINDS, tiers: { available: true, items: [{ id: 'P1', hours: 24 }, { id: 'P2', hours: 48 }, { id: 'P3', hours: 96 }] } },
    ...over,
  };
}

const E = (uid, code, kind, subject, sla, age, dueIn, extra = {}) => ({
  uid, branch_code: code, kind, subject, sla, age_hours: age, due_at: at(dueIn), detail: `Request ${uid}.`, raised_by_name: 'M. Dupont', ...extra,
});
const ITEMS = [
  E('e1', 'fr', 'seat_increase', 'Seat increase', 'past', 38, -2),
  E('e2', 'es', 'moderation', 'Flagged post', 'past', 27, -3),
  E('e3', 'fr', 'terms_change', 'Quarterly invoicing', 'due_soon', 104, 16),
  E('e4', 'de', 'renewal', 'Two more years', 'ok', 9, 63, { detail: null, raised_by_name: null }),
];
function active(over = {}) {
  return empty({
    escalations: {
      available: true, complete: true, count: 4, bands: { ok: 1, due_soon: 1, past: 2 }, oldest_age_hours: 104, items: ITEMS,
      kinds: [
        { kind: 'seat_increase', count: 1, items: [ITEMS[0]] }, { kind: 'moderation', count: 1, items: [ITEMS[1]] },
        { kind: 'terms_change', count: 1, items: [ITEMS[2]] }, { kind: 'renewal', count: 1, items: [ITEMS[3]] },
        { kind: 'delegate', count: 0, items: [] },
      ],
    },
    tickets: {
      available: true, complete: true, open: 3,
      buckets: {
        hq_held: { count: 2, oldest_age_hours: 50, bands: { ok: 1, due_soon: 1, past: 0, undated: 0 }, items: [
          { id: 11, title: 'On time medium', requester: 'K. Osei', priority: 'medium', age_hours: 50, sla_band: 'ok' },
          { id: 12, title: 'Due soon urgent', requester: 'C. Laurent', priority: 'urgent', age_hours: 20, sla_band: 'due_soon' },
        ] },
        admin_product: { count: 1, oldest_age_hours: 50, bands: { ok: 0, due_soon: 0, past: 1, undated: 0 }, items: [
          { id: 13, title: 'Past high', requester: 'M. Dupont', priority: 'high', age_hours: 66, sla_band: 'past', licence: { licence_ref: 'AXL-FR-001' } },
        ] },
      },
    },
    ...over,
  });
}

// ─────────────────────────────────────────────────────────── workspaces ──

test('four workspaces at ?tab=, Queue by default and for anything unknown', () => {
  assert.deepEqual(SUPPORT_WORKSPACES.map((w) => w.label), ['Queue', 'Branches', 'Delivery', 'Policy']);
  assert.equal(workspaceFromSearch(null), 'queue');
  assert.equal(workspaceFromSearch('BRANCHES'), 'branches');
  assert.equal(workspaceFromSearch('settings'), 'queue');
  assert.equal(workspaceHref('policy'), '?tab=policy');
});

test('the workspaces are a nav of links with aria-current, never ARIA tabs, and marks are words', () => {
  const html = render(WorkspaceNav, { current: 'delivery', marks: { queue: { text: '2 past SLA', tone: 'negative' } } });
  assert.match(html, /<nav aria-label="Support workspaces"/);
  assert.doesNotMatch(html, /role="tab/);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  assert.match(html, /<a aria-current="page"[^>]*href="\/\?tab=delivery"/);
  assert.match(text(html), /Queue2 past SLA/);
  assert.match(html, /min-h-\[44px\]/, 'a workspace link is under the 44 px phone target');
});

test('the header leads with the task, then states the scope in words: no selector, a Refresh that keeps the read', () => {
  const html = render(SupportHeader, { readAt: '14:30', sources: 'No subsidiary support sources connected', onRefresh: () => {}, actions: null });
  const t = text(html);
  assert.ok(t.indexOf('Support') < t.indexOf('Platform-wide support'), 'scope chrome precedes the title');
  assert.match(t, /Manage support workload across Axal VC\./);
  assert.match(t, /Platform-wide supportHQ \+ all available subsidiaries/);
  assert.doesNotMatch(html, /All subsidiaries|▾|<select/);
  assert.match(t, /Updated 14:30 UTC/);
  const busy = render(SupportHeader, { readAt: '14:30', refreshing: true, sources: 'x', onRefresh: () => {} });
  assert.match(text(busy), /Refreshing… showing the 14:30 UTC read/);
  assert.match(busy, /aria-live="polite"/);
  assert.match(busy, /data-testid="hq-support-refresh"[^>]*disabled=""|disabled=""[^>]*data-testid="hq-support-refresh"/);
});

// ─────────────────────────────────────────────────────────────── queue ──

test('All clear only when every source answered with nothing open (SU01a)', () => {
  const o = queueOverview(empty(), { branchState: 'ready' });
  assert.equal(o.state, 'clear');
  const html = render(AllClear, { overview: o, readAt: '14:30' });
  const t = text(html);
  assert.match(t, /All clear/);
  assert.match(t, /No support items currently require HQ attention\./);
  assert.match(t, /Measured at 14:30 UTC · every source answered/);
  assert.match(t, /Escalations0 open/);
  assert.match(t, /HQ tickets0 open/);
  assert.match(t, /SubsidiariesNo subsidiary support sources connected/);
  assert.doesNotMatch(t, /on time ·|due soon ·|past SLA/, 'the all-clear state repeats zero SLA breakdowns');
});

test('HQ empty while a subsidiary is unread is "Nothing waiting at HQ", never All clear', () => {
  for (const branchState of ['loading', 'failed']) {
    const o = queueOverview(empty(), { branchState });
    assert.equal(o.state, 'hq_clear', branchState);
    const t = text(render(AllClear, { overview: o, readAt: '14:30' }));
    assert.match(t, /Nothing waiting at HQ/);
    assert.doesNotMatch(t, /All clear|every source answered/);
  }
  const withBranch = empty({ branch_tickets: { lines: [{ code: 'fr', label: 'Axal VC France', state: 'ok', count: 3, bands: { past: 1 } }] } });
  assert.equal(queueOverview(withBranch).state, 'hq_clear', 'a branch with open tickets was called all clear');
  const zeroBranch = empty({ branch_tickets: { lines: [{ code: 'fr', label: 'Axal VC France', state: 'ok', count: 0, bands: { past: 0 } }] } });
  assert.equal(queueOverview(zeroBranch).state, 'clear');
});

test('Action required counts escalations and HQ-hosted tickets, oldest of both', () => {
  const o = queueOverview(active());
  assert.equal(o.state, 'active');
  assert.deepEqual([figureText(o.pastSla), figureText(o.dueSoon), figureText(o.open)], ['3', '2', '7']);
  assert.equal(o.oldest.value, 104);
  const t = text(render(ActionRequired, { overview: o }));
  assert.match(t, /Past SLA3Due soon2Open · escalations \+ HQ tickets7Oldest104h/);
  assert.doesNotMatch(t, /Not counted/);
});

test('an incomplete total is a floor, "N+", with its reason — never a smaller exact number (SU11)', () => {
  const cut = active();
  cut.escalations = { ...cut.escalations, complete: false, count: null, bands: null };
  const o = queueOverview(cut);
  assert.equal(figureText(o.open), '7+', 'a cut count lost its plus');
  assert.equal(figureText(o.pastSla), '3+');
  assert.match(o.reasons.join(' '), /escalation figures are a floor/);
  const html = render(ActionRequired, { overview: o });
  assert.match(text(html), /Open · escalations \+ HQ tickets7\+/);
  assert.match(text(html), /Not counted/);

  const unread = active({ tickets: { available: false, reason: 'D1 timed out.' } });
  const u = queueOverview(unread);
  assert.equal(figureText(u.open), '4+', 'an unreadable ticket queue was counted as zero');
  assert.match(u.reasons.join(' '), /HQ tickets could not be read: D1 timed out\./);
  assert.notEqual(u.state, 'clear');
  // Nothing readable reads a floor of 0: that is "0+", never All clear.
  const blind = empty({ escalations: { available: false, reason: 'x' } });
  const b = queueOverview(blind);
  assert.equal(figureText(b.open), '0+');
  assert.equal(b.state, 'active', 'an unreadable board was called all clear');
  assert.equal(queueOverview(null, { failed: true }).state, 'failed');
  assert.equal(queueOverview(null).state, 'loading');
});

test('escalations come in Past SLA, Due soon and Open bands, each with its deadline from due_at at the read', () => {
  const groups = escalationGroups(active().escalations, { readAt: READ, kindHours: kindHoursOf(active().sla_policy) });
  assert.deepEqual(groups.map((g) => [g.title, g.rows.length]), [['Past SLA', 2], ['Due soon', 1], ['Open', 1]]);
  const [seat] = groups[0].rows;
  assert.equal(seat.sla.text, 'Past SLA · 38h');
  assert.equal(seat.deadline, '72h SLA · late by 2h');
  assert.equal(groups[1].rows[0].deadline, '120h SLA · 16h left');
  assert.equal(seat.showKind, false, 'the kind is repeated when the subject already names it');
  assert.equal(groups[1].rows[0].showKind, true);
  assert.equal(deadlineText({ kind: 'other', due_at: null }, { readAt: READ, kindHours: {} }), null);
  const filtered = escalationGroups(active().escalations, { kind: 'moderation', readAt: READ });
  assert.deepEqual(filtered.flatMap((g) => g.rows.map((r) => r.uid)), ['e2']);
});

test('a row says what it is, who raised it and its SLA in words; a missing detail or raiser is said', () => {
  const groups = escalationGroups(active().escalations, { readAt: READ, kindHours: kindHoursOf(active().sla_policy) });
  const html = render(EscalationQueue, {
    escalations: active().escalations, groups, count: 4,
    decide: { openUid: null, onOpen: () => {}, refFor: () => () => {} },
  });
  const t = text(html);
  assert.match(t, /HQ escalations4 open/);
  assert.match(t, /Past SLA · 2/);
  assert.match(t, /fr · Seat increaseRequest e1\.Raised by M\. Dupont/);
  assert.match(t, /Past SLA · 38h72h SLA · late by 2h/);
  assert.match(t, /de · Two more years · RenewalNo detail recordedRaised by Not recorded/);
  assert.match(html, /aria-label="Review fr · Seat increase"/);
  assert.match(html, /data-state="past"[^>]*><svg/, 'past SLA is colour without a shape');
  assert.doesNotMatch(t, /listed/, 'a whole board says it is cut');
  const cut = render(EscalationQueue, { escalations: active().escalations, groups, count: 30, decide: null });
  assert.match(text(cut), /The 4 oldest of 30 are listed\./);
  const unreadable = text(render(EscalationQueue, { escalations: { available: false, reason: 'The board timed out.' }, groups: [] }));
  assert.match(unreadable, /HQ escalations could not be read\. The board timed out\./);
  assert.doesNotMatch(unreadable, /\b0 open\b|Nothing is waiting/);
});

test('the Queue offers the kinds with something open; the rest wait behind More filters', () => {
  const choices = [{ kind: '', label: 'All', count: 4 }, { kind: 'moderation', label: 'Moderation', count: 1 }, { kind: 'delegate', label: 'Delegate', count: 0 }, { kind: 'renewal', label: 'Renewal', count: null }];
  const { all, active: shown, more } = queueKindChoices(choices, '');
  assert.equal(all.label, 'All');
  assert.deepEqual(shown.map((c) => c.kind), ['moderation', 'renewal'], 'an uncounted kind is hidden as if zero');
  assert.deepEqual(more.map((c) => c.kind), ['delegate']);
  assert.deepEqual(queueKindChoices(choices, 'delegate').active.map((c) => c.kind), ['moderation', 'delegate', 'renewal']);
  const html = render(QueueKindFilter, { choices, value: '', onChange: () => {} });
  assert.match(html, /<details[^>]*data-testid="hq-support-more-kinds"/);
  assert.match(text(html), /Renewal not counted/);
  assert.match(text(html), /Kind counts are the board’s own totals, not the rows shown\./);
});

test('HQ-hosted tickets are one table, oldest risk first, each row naming its queue and tier', () => {
  const rows = hqTicketRows(active(), { tiers: active().sla_policy.tiers.items });
  assert.deepEqual(rows.map((r) => r.id), [13, 12, 11]);
  assert.equal(rows[0].context, 'Subsidiary admin ticket');
  assert.equal(rows[2].context, 'Customer ticket on HQ');
  assert.equal(rows[1].priority, 'P1 · urgent');
  assert.deepEqual(rows[1].sla, { band: 'due_soon', text: 'Due soon', detail: '4h left' });
  assert.equal(rows[0].sla.detail, 'late by 18h', 'a P2 ticket 66h old is 18h past its 48h');
  assert.deepEqual(['urgent', 'high', 'medium', 'low', 'weird'].map(tierOfPriority), ['P1', 'P2', 'P3', 'P3', null]);
  assert.deepEqual(hqTicketCount(active()), { value: 3, partial: false });
  const html = render(HqTicketsSection, { tickets: active().tickets, rows, count: hqTicketCount(active()), footing: 'FOOT' });
  assert.match(html, /<caption class="sr-only">HQ-hosted tickets, oldest risk first<\/caption>/);
  assert.match(html, /<th scope="col"[^>]*>Ticket<\/th>/);
  assert.match(html, /href="\/help\/tickets\/13"/);
  assert.match(html, /<summary[^>]*>How this total is calculated<\/summary>FOOT/, 'the backlog arithmetic is not behind a disclosure');
  assert.match(html, /data-testid="hq-support-tickets-list"/, 'no stacked list for the phone');
  const unread = text(render(HqTicketsSection, { tickets: { available: false, reason: 'Server error at 14:30.' }, rows: [] }));
  assert.match(unread, /HQ tickets could not be read\. Server error at 14:30\./);
  assert.doesNotMatch(unread, /How this total/);
});

// ─────────────────────────────────────────────────────────── subsidiaries ──

const LINES = [
  { code: 'fr', label: 'Axal VC France', state: 'ok', count: 8, oldest_age_hours: 31, bands: { past: 1 } },
  { code: 'de', label: 'Axal VC Germany', state: 'ok', count: 7, oldest_age_hours: 60, bands: { past: 0 } },
  { code: 'es', label: 'Axal VC Spain', state: 'unreadable', reason: 'BRANCH_ES.openTickets timed out.' },
];

test('the subsidiaries fold to one line that never turns an unread branch into zero', () => {
  assert.equal(subsidiaryLine(empty()).text, 'No subsidiary support sources connected');
  assert.equal(subsidiaryLine(empty(), 'loading').state, 'loading');
  assert.match(subsidiaryLine(empty(), 'failed').text, /unknown, not none/);
  const s = subsidiaryLine(empty({ branch_tickets: { lines: LINES } }));
  assert.equal(s.state, 'partial');
  assert.equal(s.text, '2 of 3 subsidiary sources responding · 15+ open on branch hosts · 1 past SLA · not read: Axal VC Spain');
  assert.equal(sourcesText(empty({ branch_tickets: { lines: LINES } }), 'ready'), '2 of 3 subsidiary sources responding');
  const html = render(SubsidiariesLine, { line: s });
  assert.match(html, /href="\/\?tab=branches"/);
});

test('Branches: a card per subsidiary, Unavailable with its reason, and escalations said to be held at HQ (SU04a)', () => {
  const data = empty({
    branch_tickets: { lines: LINES },
    matrix: { available: true, rows: [{ kind: 'hq', key: 'hq' }, { kind: 'licence', key: 'fr', branch_code: 'fr', about_admin: { value: 9, on_branch: 8, on_hq: 1 }, escalations: { value: 2 } }] },
  });
  const cards = branchCards(data);
  assert.equal(cards[0].split, '8 on Axal VC France host · 1 on axal.vc');
  assert.equal(cards[2].state, 'unavailable');
  assert.equal(cards[2].open, undefined, 'an unavailable branch carries a count');
  const html = render(BranchesWorkspace, { data, cards, branchState: 'ready', onRetry: () => {}, matrix: 'MATRIX', branchTickets: 'TICKETS' });
  const t = text(html);
  assert.match(t, /Axal VC FranceConnectedOpen tickets8Past SLA1Oldest31h/);
  assert.match(t, /Axal VC SpainUnavailableBRANCH_ES\.openTickets timed out\./);
  assert.match(t, /its escalations are held at HQ and still shown/);
  assert.match(t, /Ticket totals: Not counted while a subsidiary is unavailable/);
  assert.match(t, /MATRIX/);
  assert.doesNotMatch(t.slice(t.indexOf('Axal VC Spain')), /Open tickets0/);
  // A matrix of HQ's row alone compares nothing, even beside branch cards.
  const hqOnly = { ...data, matrix: { available: true, rows: [{ kind: 'hq', key: 'hq' }] } };
  assert.doesNotMatch(text(render(BranchesWorkspace, { data: hqOnly, cards, branchState: 'ready', matrix: 'MATRIX', branchTickets: 'TICKETS' })), /MATRIX/);
});

test('Branches with no subsidiary draws the empty state, not a one-row matrix (SU04b)', () => {
  const data = empty();
  assert.equal(matrixCompares({ available: true, rows: [{ kind: 'hq' }] }), false);
  const t = text(render(BranchesWorkspace, { data, cards: [], branchState: 'ready', matrix: 'MATRIX', branchTickets: 'TICKETS' }));
  assert.match(t, /No subsidiary support sources connected/);
  assert.match(t, /Only HQ’s own queues exist today, so there is nothing to compare\./);
  assert.doesNotMatch(t, /MATRIX/);
  const failed = text(render(BranchesWorkspace, { data, cards: [], branchState: 'failed', onRetry: () => {} }));
  assert.match(failed, /could not be read.*unknown — not none/);
});

// ─────────────────────────────────────────────────────────── delivery ──

test('Delivery leads with what was not delivered and says plainly that it lists this session only (#5035)', () => {
  const recorded = [
    { uid: 'a', pushed: { ok: true } },
    { uid: 'b', pushed: { ok: false, reason: 'timed out' } },
    { uid: 'c', pushed: undefined },
  ];
  assert.deepEqual(deliveryRows(recorded).map((r) => r.uid), ['b', 'c', 'a']);
  assert.equal(notDelivered(recorded), 2);
  const t = text(render(DeliveryWorkspace, { recorded, renderRecorded: (rows) => rows.map((r) => r.uid).join(','), sync: null, mirror: 'STRIP' }));
  assert.match(t, /2 decisions not delivered/);
  assert.match(t, /b,c,a/);
  assert.match(t, /HQ does not yet keep a history of past deliveries to read back \(#5035\)/);
  const none = text(render(DeliveryWorkspace, { recorded: [], renderRecorded: () => '', sync: null, mirror: 'STRIP' }));
  assert.match(none, /No decision has been recorded in this session\./);
  assert.doesNotMatch(none, /All decisions recorded here were delivered/, 'an empty list claims delivery');
});

test('a healthy or quiet mirror is one line; failures, no token or an unread mirror expand to the strip', () => {
  const base = { available: true, window_hours: 24, synced: 0, failed: 0, not_configured: 0 };
  assert.equal(mirrorLine(base), 'No ticket activity in the last 24h');
  assert.equal(mirrorLine({ ...base, synced: 5 }), '5 tickets mirrored in the last 24h · none failed');
  assert.equal(mirrorLine({ ...base, synced: 5, failed: 1 }), null);
  assert.equal(mirrorLine({ ...base, not_configured: 1 }), null);
  assert.equal(mirrorLine({ available: false, reason: 'x' }), null);
  const quiet = text(render(DeliveryWorkspace, { recorded: [], renderRecorded: () => '', sync: base, mirror: 'STRIP' }));
  assert.match(quiet, /GitHub mirror — No ticket activity in the last 24h/);
  assert.doesNotMatch(quiet, /STRIP/);
  const loud = text(render(DeliveryWorkspace, { recorded: [], renderRecorded: () => '', sync: { ...base, failed: 3 }, mirror: 'STRIP' }));
  assert.match(loud, /STRIP/);
});

// ──────────────────────────────────────────────────────────── policy ──

test('Policy says whether the ticket SLA is on every subsidiary, and never calls an unknown complete', () => {
  assert.deepEqual(distributionState({ branch_copy: { propagation: { total: 3, current: 2 } } }), { state: 'incomplete', current: 2, total: 3 });
  assert.equal(distributionState({ branch_copy: { propagation: { total: 3, current: 3 } } }).state, 'complete');
  assert.equal(distributionState({ branch_copy: { propagation: { total: 0, current: 0 } } }).state, 'none');
  assert.equal(distributionState({ branch_copy: {} }, 'loading').state, 'unknown');
  assert.equal(distributionState({ branch_copy: {} }, 'failed').state, 'unknown');
  const warn = text(render(DistributionBanner, { distribution: { state: 'incomplete', current: 2, total: 3 } }));
  assert.match(warn, /SLA policy is not on every subsidiary — applied on 2 of 3/);
  const unknown = render(DistributionBanner, { distribution: { state: 'unknown', branchState: 'failed' } });
  assert.match(text(unknown), /not known yet.*could not be read/);
  assert.doesNotMatch(text(unknown), /applied on all/);
});

test('the nav marks the work: past SLA, undelivered decisions, an incomplete distribution', () => {
  const o = queueOverview(active());
  const marks = workspaceMarks(o, [{ uid: 'b', pushed: { ok: false } }], { state: 'incomplete' });
  assert.deepEqual(marks, {
    queue: { text: '3 past SLA', tone: 'negative' },
    delivery: { text: '1 not delivered', tone: 'negative' },
    policy: { text: 'Not on every branch', tone: 'attention' },
  });
  assert.deepEqual(workspaceMarks(queueOverview(empty()), [], { state: 'none' }), {});
});

test('a badge carries a word and a shape, never colour alone', () => {
  for (const tone of ['past', 'due_soon', 'ok', 'unavailable', 'not_counted', 'measured_zero']) {
    const html = render(SupportBadge, { tone, children: 'Word' });
    assert.match(html, /<svg[^>]*data-shape="/, `${tone} has no shape`);
    assert.match(text(html), /Word/);
  }
  assert.equal(previewOf('a '.repeat(200)).endsWith('…'), true);
  assert.equal(previewOf('   '), null);
});

// ─────────────────────────────────────────────────────────────── page ──

test('the page: the workspace is the address, and each workspace draws only its own parts', () => {
  assert.ok(PAGE.includes("const workspace = workspaceFromSearch(params.get('tab'));"));
  assert.doesNotMatch(PAGE, />All subsidiaries</);
  const queueAt = PAGE.indexOf("} else if (overview.state === 'loading') {");
  assert.ok(queueAt > 0);
  const queue = PAGE.slice(queueAt, PAGE.indexOf('return (', queueAt));
  for (const off of ['<SlaPolicyPanel', '<TenantMatrix', '<SyncStrip', '<BranchTicketsSection']) {
    assert.ok(!queue.includes(off), `the Queue draws ${off}`);
  }
  const policy = PAGE.slice(PAGE.indexOf("} else if (workspace === 'policy') {"), queueAt);
  assert.ok(policy.includes('<SlaPolicyPanel') && policy.includes('<DistributionBanner'));
  assert.ok(PAGE.includes('<Link to="/hq/review"'), 'the review queue link is gone from the header');
  // Refresh is quiet: the reads run with clear=false, and the page is told when they settle.
  const refreshAt = PAGE.indexOf('const refresh = useCallback(');
  const refresh = PAGE.slice(refreshAt, PAGE.indexOf('}, [fetchSupport]);', refreshAt));
  assert.ok(refresh.includes('fetchSupport(false).finally(() => setRefreshing(false))'), 'Refresh blanks the page or never ends');
});

test('Policy reads on a phone; editing stays on a wider screen', () => {
  assert.match(PAGE, /className="hidden text-\[10\.5px\][^"]*md:inline[^"]*"\s+onClick=\{\(\) => \{ setError\(null\); setProblems\(\[\]\); setSaved\(null\); setPhase\('idle'\); setDraft\(tierDraft\(tiers\)\); \}\}/);
  assert.ok(PAGE.includes('data-testid="hq-support-sla-phone-note"'));
});
