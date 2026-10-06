/**
 * D455 — HQ · Support SLA policy panel and ticket bands (Session 16 item 6).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { SlaPolicyPanel, ticketCardProps, QueueCard, SyncStrip, syncLagText, supportCoverage } from '../src/pages/hq/HqSupportPage.jsx';
const render = (C, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props)));
const text = renderedText;

test('SlaPolicyPanel draws the three inherited bands', () => {
  const html = render(SlaPolicyPanel, {
    slaPolicy: {
      tiers: [
        { id: 'P1', hours: 24, description: 'Money, access, or data at risk' },
        { id: 'P2', hours: 48, description: 'A workflow is blocked, a workaround exists' },
        { id: 'P3', hours: 96, description: 'Wrong, but nobody is stopped' },
      ],
      note: 'Bands are set here and inherited whole',
      ticket_mapping: 'urgent → P1',
    },
    taxonomy: { available: true, items: [{ type: 'bug', open: 2 }] },
    failed: false,
  });
  const t = text(html);
  assert.match(t, /SLA policy and taxonomy/);
  assert.match(t, /P1/);
  assert.match(t, /24h/);
  assert.match(t, /bug/);
});

test('ticket queue cards pass SLA bands from the payload', () => {
  const data = {
    tickets: {
      available: true,
      complete: true,
      open: 1,
      buckets: {
        hq_held: {
          count: 1,
          oldest_age_hours: 30,
          bands: { ok: 0, due_soon: 0, past: 1 },
          items: [{
            id: 9,
            title: 'Export stuck',
            status: 'open',
            priority: 'urgent',
            age_hours: 30,
            sla_band: 'past',
            requester: 'LP',
            licence: null,
          }],
        },
        admin_product: { count: 0, oldest_age_hours: null, bands: { ok: 0, due_soon: 0, past: 0 }, items: [] },
        hq_staff: { count: 0, oldest_age_hours: null, bands: null, items: [] },
        account_closed: { count: 0, oldest_age_hours: null, bands: null, items: [] },
        not_on_record: { count: 0, oldest_age_hours: null, bands: null, items: [] },
      },
    },
  };
  const props = ticketCardProps(data, false, 'hq_held');
  assert.equal(props.bands.past, 1);
  assert.equal(props.items[0].band, 'past');
});

// ── D459 (#1017) ──────────────────────────────────────────────────────────

const POLICY = {
  tiers: [
    { id: 'P1', hours: 24, due_soon_hours: 12, description: 'Money, access, or data at risk' },
    { id: 'P2', hours: 48, due_soon_hours: 24, description: 'A workflow is blocked, a workaround exists' },
    { id: 'P3', hours: 96, due_soon_hours: 24, description: 'Wrong, but nobody is stopped' },
  ],
  escalation_kinds: [
    { kind: 'moderation', hours: 24, due_soon_hours: 12 },
    { kind: 'seat_increase', hours: 72, due_soon_hours: 24 },
  ],
  note: 'Fixed in code and the same on every subsidiary.',
  ticket_mapping: 'urgent → P1 · high → P2 · medium and low → P3',
};

test('D459: the panel names both SLA tables, each limit with its due-soon window', () => {
  const t = text(render(SlaPolicyPanel, { slaPolicy: POLICY, taxonomy: { available: true, items: [] }, failed: false }));
  assert.match(t, /Tickets · response bands/);
  assert.match(t, /24h· due soon last 12h/);
  assert.match(t, /Escalations from branches · a second table/);
  assert.match(t, /moderation24h · due soon last 12h/);
  assert.match(t, /seat increase72h · due soon last 24h/);
  assert.doesNotMatch(t, /Set here · inherited by every subsidiary/);
});

test('D459: while the read is loading, the taxonomy says so and never Unreadable', () => {
  const loading = text(render(SlaPolicyPanel, { slaPolicy: undefined, taxonomy: undefined, failed: false }));
  assert.match(loading, /Reading the ticket types/);
  assert.doesNotMatch(loading, /Unreadable/);
  const failed = text(render(SlaPolicyPanel, { slaPolicy: POLICY, taxonomy: { available: false, reason: 'no table' }, failed: false }));
  assert.match(failed, /Unreadable/);
});

test('D459: a queue card counts undated tickets, and says due soon rather than a fixed 24h', () => {
  const t = text(render(QueueCard, {
    queue: 'hq_held', who: 'x', state: 'ready', count: 3, items: [], testId: 'q',
    bands: { ok: 1, due_soon: 1, past: 0, undated: 1 },
  }));
  assert.match(t, /1 on time · 1 due soon · 0 past SLA · 1 undated/);
  const none = text(render(QueueCard, {
    queue: 'hq_held', who: 'x', state: 'ready', count: 1, items: [], testId: 'q',
    bands: { ok: 1, due_soon: 0, past: 0, undated: 0 },
  }));
  assert.doesNotMatch(none, /undated/);
});

test('D459: the mirror strip shows a measured lag with what it leaves out, and Not recorded without one', () => {
  const sync = (lag) => ({ available: true, window_hours: 24, synced: 3, failed: 1, not_configured: 0, lag });
  const measured = text(render(SyncStrip, { sync: sync({ value: 30, unit: 'seconds', measured: 2, unmeasured: 1, max: 41 }), failed: false }));
  assert.match(measured, /Average lag30s/);
  assert.match(measured, /over 2 tickets filed in the last 24h, to the second; the longest took 41s\. 1 ticket filed with no mirror event is not in the average\./);
  const none = text(render(SyncStrip, { sync: sync({ value: null, reason: 'Not recorded: no ticket filed in this window reached GitHub.' }), failed: false }));
  assert.match(none, /Not recorded: no ticket filed in this window reached GitHub/);
  assert.doesNotMatch(none, /Average lag0/);
  assert.equal(syncLagText({ value: 0 }), '0s', 'a measured zero is a figure');
  assert.equal(syncLagText({ value: 300 }), '5 min');
  assert.equal(syncLagText({ value: null }), null);
});

test('D459: the taxonomy read has a coverage line', () => {
  const lines = supportCoverage({ taxonomy: { available: true, items: [{ type: 'bug', open: 2 }, { type: 'task', open: 3 }] } });
  assert.ok(lines.includes('5 open tickets counted by type'), lines.join(' | '));
});
