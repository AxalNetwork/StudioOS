/**
 * D654 (#1466) — Grow › Share an update: the sheet's six steps and two
 * states, and the sent update's page, rendered with react-dom/server.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/share_update_sheet_d654.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { ShareUpdateView, STEPS, metricText, networkLine, periodChoices } from '../src/pages/founder/ShareUpdateSheet.jsx';
import { SentUpdateView } from '../src/pages/founder/SentUpdatePage.jsx';

const MRR = { key: 'mrr', label: 'MRR', unit: 'usd', value: 38400, source: 'stripe', as_of: '2026-10-12', reason: null };
const RUNWAY = { key: 'runway', label: 'Runway', unit: 'months', value: null, source: null, as_of: null, reason: 'Not recorded: runway needs cash and burn recorded in this period' };
const on = new Proxy({}, { get: () => () => {} });
const base = {
  step: 0, period: null, context: { metrics: [MRR, RUNWAY], no_metrics: false, open_roles: [{ id: 3, title: 'Engineer' }], audience: { investors: 2, team: 1, network: 4 },
    ask_kinds: [{ kind: 'hire', module: 'Talent', lands: true }, { kind: 'market', module: 'Market expansion', lands: false, reason: 'Not recorded: there is no Market expansion store yet, so the reply stays on the ask' }] },
  metrics: [MRR, RUNWAY], highlights: [], lowlights: [], asks: [], audience: { investors: true, team: true, network: false },
  includeMetrics: false, draftStatus: null, handWritten: false, busy: false, error: '', title: 'This month update', now: new Date('2026-10-09T00:00:00Z'),
};
const sheet = (s) => {
  const html = renderToStaticMarkup(React.createElement(ShareUpdateView, { s: { ...base, ...s }, on }));
  return { html, text: renderedText(html) };
};

test('the six steps, in the canvas order, and the period choices', () => {
  assert.deepEqual(STEPS, ['Period', 'Metrics', 'Highlights', 'Asks', 'Audience', 'Preview']);
  assert.deepEqual(periodChoices(new Date('2026-10-09T00:00:00Z')).map((p) => [p.label, p.start, p.end]),
    [['This month', '2026-10-01', '2026-10-31'], ['Last month', '2026-09-01', '2026-09-30']]);
  const { text } = sheet({ step: 0 });
  assert.match(text, /1 · Period/);
  assert.match(text, /6 · Preview/);
  assert.match(text, /Step 1 of 6/);
});

test('a missing metric reads "Not recorded" with its reason, never 0', () => {
  assert.deepEqual(metricText(RUNWAY), { value: 'Not recorded', detail: RUNWAY.reason });
  assert.deepEqual(metricText(MRR), { value: '$38,400', detail: 'stripe · 2026-10-12' });
  assert.equal(metricText({ ...MRR, unit: 'count', value: 0 }).value, '0', 'a recorded zero prints');
  const { text } = sheet({ step: 1 });
  assert.match(text, /MRR\$38,400 · stripe · 2026-10-12/);
  assert.match(text, /RunwayNot recorded: runway needs cash and burn/);
  assert.doesNotMatch(text, /Runway\$?0/);
});

test('nometrics: the update still sends, with the metrics left out', () => {
  const { text } = sheet({ step: 1, context: { ...base.context, no_metrics: true }, metrics: [RUNWAY] });
  assert.match(text, /No metrics are connected yet\. The update still sends, with the metrics left out\./);
  const preview = sheet({ step: 5, metrics: [RUNWAY] }).text;
  assert.match(preview, /Metrics left out: none is recorded/);
});

test('highlights name their source; "nothing" offers Skip this month or Write by hand', () => {
  const lines = sheet({ step: 2, draftStatus: 'drafted', highlights: [{ text: 'MRR reached $38,400', source: { label: 'Stripe · MRR', as_of: '2026-10-12' } }] });
  assert.match(lines.text, /Highlights · draft by Eadwyn/);
  assert.match(lines.text, /Source: Stripe · MRR · 2026-10-12/);
  const nothing = sheet({ step: 2, draftStatus: 'nothing' });
  assert.match(nothing.text, /Nothing new this month/);
  assert.match(nothing.text, /Skip this month/);
  assert.match(nothing.text, /Write by hand/);
});

test('asks: a hire links to an open role; a market ask says its reply stays on the ask', () => {
  const { html, text } = sheet({ step: 3, asks: [{ kind: 'hire', text: 'A senior engineer', link_ref: '3' }, { kind: 'market', text: 'Spain', link_ref: null }] });
  assert.match(html, /<option value="3"[^>]*>Engineer<\/option>/);
  const withMarkets = sheet({ step: 3, context: { ...base.context, markets: [{ id: 9, name: 'Spain' }] }, asks: [{ kind: 'market', text: 'Spain', link_ref: '9' }] });
  assert.match(withMarkets.html, /<option value="9"[^>]*>Spain<\/option>/, 'D664: a market ask picks one of the markets');
  assert.match(text, /Replies land in Talent/);
  assert.match(text, /no Market expansion store yet/);
  for (const k of ['A hire', 'A customer introduction', 'A partner', 'A market contact', 'Capital']) assert.ok(text.includes(k), k);
});

test('audience: the network gets the asks only unless the founder includes the metrics', () => {
  assert.match(networkLine(false), /^Asks only/);
  assert.match(networkLine(true), /^Asks and metrics/);
  const off = sheet({ step: 4, audience: { investors: true, team: true, network: true } }).text;
  assert.match(off, /2 from Capital relationships · full update/);
  assert.match(off, /Asks only\. Metrics stay private/);
  assert.match(off, /Include metrics/);
  assert.match(sheet({ step: 4, audience: { investors: true, team: true, network: true }, includeMetrics: true }).text, /Keep metrics private/);
});

test('preview says it also appears in Raise', () => {
  const { text } = sheet({ step: 5 });
  assert.match(text, /Send the update/);
  assert.match(text, /Raise › Capital relationships as an investor update sent/);
});

const PAGE = {
  uid: 'u1', title: 'October update', sent_at: '2026-11-01T09:00:00Z', network_includes_metrics: false,
  metrics: [MRR], highlights: [{ text: 'MRR up', source: { label: 'Stripe · MRR' } }], lowlights: [],
  sent_to: { investors: 2, team: 1, network: 4 },
  recipients: [{ audience: 'investor', label: 'Ivy', opened_at: '2026-11-01T10:00:00Z' }, { audience: 'investor', label: 'No Account', not_delivered_reason: 'No Axal account for this email, so it was not sent' }],
  asks: [
    { uid: 'a1', kind: 'hire', text: 'Engineer', replies: [{ uid: 'r1', name: 'Nia', message: 'Try Lee', landed_module: 'talent' }], can_ask_again: false },
    { uid: 'a2', kind: 'market', text: 'Spain', replies: [], can_ask_again: true },
  ],
};
const page = (data, extra = {}) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(SentUpdateView, { data, onAskAgain: () => {}, onReply: async () => ({}), ...extra })));

test('the sent page: replies open in their module; noreply offers Ask again; opens and non-delivery shown', () => {
  const html = page(PAGE);
  const text = renderedText(html);
  assert.match(html, /<a [^>]*href="\/grow\/talent"[^>]*>Open in Talent<\/a>/);
  assert.match(text, /No replies after 14 days\.Ask again/);
  assert.match(text, /Opened 2026-11-01/);
  assert.match(text, /No Axal account for this email/);
  assert.match(text, /to 2 investors, 1 team members and 4 in the Axal network \(asks only\)/);
  const fresh = renderedText(page({ ...PAGE, asks: [{ ...PAGE.asks[1], can_ask_again: false }] }));
  assert.doesNotMatch(fresh, /Ask again/);
});

test('a network recipient\'s page shows what the Worker sent: the asks, no metrics, a reply form', () => {
  const network = { uid: 'u1', title: 'October update', sent_at: PAGE.sent_at, audience: 'network', asks: [{ uid: 'a1', kind: 'hire', text: 'Engineer' }] };
  const html = page(network);
  const text = renderedText(html);
  assert.match(html, /data-testid="sent-update-recipient"/);
  assert.doesNotMatch(text, /Metrics|Highlights|38,400/);
  assert.match(html, /aria-label="Reply to A hire"/);
});

test('Grow\'s header opens the sheet, and /updates/:uid is routed', () => {
  const desk = readFileSync('frontend/src/pages/founder/FounderGrowDesk.jsx', 'utf8');
  assert.match(desk, /data-testid="button-share-update"[^>]*onClick=\{\(\) => setSharing\(true\)\}>Share an update</);
  assert.match(desk, /<ShareUpdateSheet projectId=\{projectId\}/);
  assert.match(readFileSync('frontend/src/App.jsx', 'utf8'), /path="\/updates\/:uid" element=\{guard\(\[[^\]]+\], <SentUpdatePage \/>\)\}/);
});
