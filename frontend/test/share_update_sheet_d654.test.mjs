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
import { ShareUpdateView, STEPS, metricText, networkLine, periodChoices, periodRange, periodTitle, periodError, audienceRefusal, sendShareUpdate, shiftEditing } from '../src/pages/founder/ShareUpdateSheet.jsx';
import { UpdatesPanel } from '../src/pages/RaisePipelinePage.jsx';
import { SentUpdateView } from '../src/pages/founder/SentUpdatePage.jsx';

const MRR = { key: 'mrr', label: 'MRR', unit: 'usd', value: 38400, source: 'stripe', as_of: '2026-10-12', reason: null };
const RUNWAY = { key: 'runway', label: 'Runway', unit: 'months', value: null, source: null, as_of: null, reason: 'Not recorded: runway needs cash and burn recorded in this period' };
const on = new Proxy({}, { get: () => () => {} });
const base = {
  step: 0, period: null, context: { metrics: [MRR, RUNWAY], no_metrics: false, open_roles: [{ id: 3, title: 'Engineer' }], audience: { investors: 2, team: 1, network: 4 },
    ask_kinds: [{ kind: 'hire', module: 'Talent', lands: true }, { kind: 'customer', module: 'Customers', lands: true }, { kind: 'partner', module: 'Partnerships', lands: true }, { kind: 'market', module: 'Market expansion', lands: false, reason: 'Not recorded: there is no Market expansion store yet, so the reply stays on the ask' }] },
  metrics: [MRR, RUNWAY], highlights: [], lowlights: [], asks: [], audience: { investors: true, team: true, network: false },
  includeMetrics: false, draftStatus: null, handWritten: false, busy: false, error: '', title: 'This month update', now: new Date('2026-10-09T00:00:00Z'),
};
const sheet = (s) => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(ShareUpdateView, { s: { ...base, ...s }, on })));
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
  const nothing = sheet({ step: 2, draftStatus: 'nothing', period: periodChoices(base.now)[0] });
  assert.match(nothing.text, /Nothing new this month/);
  assert.match(nothing.text, /Skip this month/);
  assert.match(nothing.text, /Write by hand/);
});

test('asks: a hire links to an open role; a market ask says its reply stays on the ask', () => {
  const { html, text } = sheet({ step: 3, asks: [{ kind: 'hire', text: 'A senior engineer', link_ref: '3' }, { kind: 'market', text: 'Spain', link_ref: null }] });
  assert.match(html, /<option value="3"[^>]*>Engineer<\/option>/);
  const withMarkets = sheet({ step: 3, context: { ...base.context, markets: [{ id: 9, name: 'Spain' }] }, asks: [{ kind: 'market', text: 'Spain', link_ref: '9' }] });
  assert.match(withMarkets.html, /<option value="9"[^>]*>Spain<\/option>/, 'D664: a market ask picks one of the markets');
  assert.match(text, /Replies land in Team expansion/);
  assert.match(text, /Engineer · links to the open role in Team expansion/);
  assert.match(text, /Replies land in Distribution/);
  assert.match(text, /Replies land in Partner network/);
  assert.doesNotMatch(text, /Talent|Partnerships|land in Customers/);
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
  // D686 §5.8: Grow's module names and routes.
  assert.match(html, /<a [^>]*href="\/grow\/team-expansion"[^>]*>Open in Team expansion<\/a>/);
  assert.match(text, /No replies after 14 days\.No repliesAsk again/);
  assert.match(text, /Opened 1 Nov/);
  assert.match(text, /Not delivered · No Axal account for this email/);
  assert.match(text, /Sent 1 Nov to 2 investors, 1 team member and the Axal network \(asks only\)/);
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
  // Grow's header is the Grow cycle overview's primary action since the A5
  // desk retired (D661, #1474); a sent update opens its own page.
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  // D686 §5.1: at /grow/update over the page; a sent update replaces it with its page.
  assert.match(route, /action: \(q, open\) => \(\{ label: 'Share an update', href: `\/grow\/update\$\{q\}`, onOpen: open \}\)/);
  assert.match(route, /<ShareUpdateLightbox projectId=\{projectId\} onClose=\{onClose\} onSent=\{onDone\} \/>/);
  assert.match(route, /\(uid\) => navigate\(`\/updates\/\$\{encodeURIComponent\(uid\)\}`, \{ replace: true \}\)/);
  // D686 §5.4: the mount also re-reads the cycle page after a change (Build's Connect a tool), on close.
  assert.match(route, /<Mount projectId=\{projectId\} q=\{q\} searchParams=\{searchParams\} onClose=\{closeAction\} onDone=\{onDone\}\s*onChanged=\{\(\) => \{ dirty\.current = true; \}\} \/>/);
  assert.match(route, /if \(dirty\.current\) \{ dirty\.current = false; setReload\(\(n\) => n \+ 1\); \}/);
  assert.match(readFileSync('frontend/src/App.jsx', 'utf8'), /path="\/updates\/:uid" element=\{guard\(\[[^\]]+\], <SentUpdatePage \/>\)\}/);
});

// ── D686 §5.8 (#1599): the parts that do not wait on S02-A or S19-B ──────────

test('period: three choices in UTC, Selected on the chosen row, Custom validated', () => {
  const now = new Date('2026-10-09T00:00:00Z');
  const [thisMonth] = periodChoices(now);
  const { html, text } = sheet({ step: 0, period: thisMonth });
  assert.match(text, /This month1 Oct – 31 OctSelected/);
  assert.match(text, /Last month1 Sept? – 30 Sept?/);
  assert.match(text, /CustomChoose dates/);
  assert.equal((text.match(/Selected/g) || []).length, 1);
  assert.match(html, /type="radio"[^>]*checked=""/);
  const reversed = sheet({ step: 0, period: { key: 'custom', label: 'Custom', start: '2026-10-15', end: '2026-10-01' } });
  assert.match(reversed.text, /The start date must be on or before the end date\./);
  assert.match(reversed.html, /<button type="button" class="[^"]*" disabled="">Next<\/button>/);
  assert.doesNotMatch(sheet({ step: 0, period: thisMonth }).html, /disabled="">Next/);
  assert.equal(periodError({ key: 'custom', start: '', end: '2026-10-01' }), 'Choose both dates.');
  assert.equal(periodError({ key: 'custom', start: '2026-10-01', end: '2026-10-01' }), null);
});

test('periodTitle names a whole month, else the range, in UTC even west of UTC', () => {
  assert.equal(periodTitle('2026-10-01', '2026-10-31'), 'October 2026');
  assert.equal(periodTitle('2026-10-01', '2026-10-15'), '1 Oct – 15 Oct');
  assert.equal(periodTitle('2026-02-01', '2026-02-28'), 'February 2026');
  assert.equal(periodRange('', '2026-10-01'), 'Choose dates');
  const tz = process.env.TZ; process.env.TZ = 'America/Los_Angeles';
  try { assert.equal(periodTitle('2026-10-01', '2026-10-31'), 'October 2026'); assert.equal(periodRange('2026-11-01', '2026-11-03'), '1 Nov – 3 Nov'); }
  finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
  const partial = sheet({ step: 2, draftStatus: 'nothing', period: { key: 'custom', start: '2026-10-01', end: '2026-10-15' } }).text;
  assert.match(partial, /Nothing new in this period/);
});

test('metrics: From Revenue and traction, month on month only when given, Remove then Restore', () => {
  const GROWTH = { key: 'growth', label: 'Growth', unit: 'pct', value: 12, source: 'stripe', as_of: '2026-10-12' };
  const { text } = sheet({ step: 1, metrics: [MRR, GROWTH, RUNWAY] });
  assert.match(text, /From Revenue and traction/);
  assert.match(text, /\+12% month on month · stripe/);
  assert.equal(metricText({ ...GROWTH, value: null }).value, 'Not recorded');
  assert.doesNotMatch(metricText({ ...GROWTH, key: 'churn' }).value, /month on month/);
  const removed = sheet({ step: 1, metrics: [MRR, RUNWAY], removedMetrics: ['mrr'] }).text;
  assert.match(removed, /Removed: MRR · Restore/);
  assert.doesNotMatch(removed, /\$38,400/);
  const none = sheet({ step: 1, context: { ...base.context, no_metrics: true }, metrics: [], projectId: 7 }).html;
  assert.match(none, /<a [^>]*href="\/build\/metrics\?project_id=7"[^>]*>Enter figures by hand<\/a>/);
});

test('highlights: Edit and Done, Add a lowlight, and the hand route on the unavailable path', () => {
  const line = { text: 'MRR reached $38,400', source: { label: 'Stripe · MRR' } };
  const shown = sheet({ step: 2, draftStatus: 'drafted', highlights: [line] });
  assert.match(shown.text, /MRR reached \$38,400Source: Stripe · MRREditRemove/);
  assert.doesNotMatch(shown.html, /aria-label="Line"/);
  const editing = sheet({ step: 2, draftStatus: 'drafted', highlights: [line], editing: { field: 'highlights', i: 0 } });
  assert.match(editing.html, /aria-label="Line"/);
  assert.match(editing.text, /DoneRemove/);
  assert.match(sheet({ step: 2, draftStatus: 'drafted', lowlights: [{ text: '', source: { label: 'Written by the founder' } }] }).html, /aria-label="Line"/, 'an empty line opens in edit mode');
  const unavailable = sheet({ step: 2, draftStatus: 'unavailable' }).text;
  assert.match(unavailable, /Add a highlight/);
  assert.match(unavailable, /Add a lowlight/);
  assert.match(sheet({ step: 2, draftStatus: 'drafted' }).text, /Add a lowlight/, 'a draft with no lines still offers both');
  assert.deepEqual([shiftEditing({ field: 'highlights', i: 2 }, 'highlights', 0), shiftEditing({ field: 'highlights', i: 0 }, 'highlights', 0), shiftEditing({ field: 'lowlights', i: 1 }, 'highlights', 0), shiftEditing({ field: 'highlights', i: 0 }, 'highlights', 3)],
    [{ field: 'highlights', i: 1 }, null, { field: 'lowlights', i: 1 }, { field: 'highlights', i: 0 }]);
});

test('capital asks: an open call, its reason, or the module line', () => {
  const asks = [{ kind: 'capital', text: 'Seed', link_ref: null }];
  const call = sheet({ step: 3, asks, context: { ...base.context, open_call: { name: 'Seed round', target_close: '2027-01-15' } } }).text;
  assert.match(call, /Links to the open Call for Capital · Seed round \(closes 15 Jan\)\. Replies from investors it was sent to land on the call; others become investor contacts\./);
  const reason = sheet({ step: 3, asks, context: { ...base.context, open_call_reason: 'No Call for Capital is open' } }).text;
  assert.match(reason, /No Call for Capital is open\. Replies become investor contacts in Capital relationships\./);
  assert.doesNotMatch(sheet({ step: 3, asks }).text, /Call for Capital/);
});

test('audience pills, and Send off with its reason when no one would receive it', () => {
  const pills = sheet({ step: 4, audience: { investors: true, team: false, network: true } }).text;
  assert.match(pills, /full updateOn/);
  assert.match(pills, /people · full updateOff/);
  assert.match(pills, /Include metricsAsks only/);
  assert.match(sheet({ step: 4, audience: { investors: false, team: false, network: true }, includeMetrics: true }).text, /Keep metrics privateAsks and metrics/);
  assert.equal(audienceRefusal({ investors: false, team: false, network: false }), 'Switch on at least one audience to send.');
  assert.equal(audienceRefusal({ investors: true, team: true, network: false }, { investors: 0, team: 0 }), 'The audiences switched on have no one in them yet.');
  assert.equal(audienceRefusal({ investors: true, team: false, network: false }, { investors: null }), null, 'an unreadable count is never zero');
  assert.equal(audienceRefusal({ investors: true, team: false, network: false }, { investors: 2 }), null);
  const off = sheet({ step: 5, audience: { investors: false, team: false, network: false } }).html;
  assert.match(renderedText(off), /Switch on at least one audience to send\./);
  assert.match(off, /disabled="">Send the update<\/button>/);
  assert.doesNotMatch(sheet({ step: 5 }).html, /disabled="">Send the update/);
});

test('sendShareUpdate creates once and retries on the same uid; a 409 on save reads as sent', async () => {
  const calls = []; let failSave = 1; let failSend = 1;
  const api = {
    create: async () => { calls.push('create'); return { uid: 'u9' }; },
    save: async (uid) => { calls.push(`save:${uid}`); if (failSave-- > 0) throw Object.assign(new Error('down'), { status: 503 }); },
    send: async (uid) => { calls.push(`send:${uid}`); if (failSend-- > 0) throw Object.assign(new Error('down'), { status: 503 }); return { ok: true }; },
  };
  const s = { ...base, period: periodChoices(base.now)[0], uid: null, removedMetrics: ['mrr'] };
  const seen = [];
  await assert.rejects(sendShareUpdate(api, 1, s, (uid) => seen.push(uid)));
  await assert.rejects(sendShareUpdate(api, 1, { ...s, uid: seen[0] }, (uid) => seen.push(uid)));
  const done = await sendShareUpdate(api, 1, { ...s, uid: seen[0] }, (uid) => seen.push(uid));
  assert.deepEqual(calls, ['create', 'save:u9', 'save:u9', 'send:u9', 'save:u9', 'send:u9']);
  assert.deepEqual([seen, done], [['u9'], { uid: 'u9', sent: { ok: true }, alreadySent: false }]);
  let body = null;
  await sendShareUpdate({ ...api, save: async (_u, b) => { body = b; }, send: async () => ({}) }, 1, { ...s, uid: 'u9', metrics: [MRR, RUNWAY] });
  assert.deepEqual(body.metrics, [], 'a removed metric is not sent');
  const sent = await sendShareUpdate({ ...api, save: async () => { throw Object.assign(new Error('sent'), { status: 409 }); }, send: async () => { throw new Error('never'); } }, 1, { ...s, uid: 'u9' });
  assert.deepEqual(sent, { uid: 'u9', sent: null, alreadySent: true });
});

test('Raise lists updates shared from Grow beside the ones posted there', () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(UpdatesPanel, {
    projectId: 1, updates: [], onPosted: () => {},
    shared: [{ uid: 'u1', title: 'October 2026 update', period: '2026-10', sent_at: '2026-11-01T09:00:00Z', investors: 3, delivered: 2, link: '/updates/u1' }],
  })));
  const text = renderedText(html);
  assert.match(html, /<a [^>]*href="\/updates\/u1"[^>]*>October 2026 update<\/a>/);
  assert.match(text, /Sent to 3 investors · 2 delivered · Shared from Grow/);
  assert.doesNotMatch(text, /No updates yet/);
  assert.doesNotMatch(text, /Updates are recorded here and on each investor's contact timeline — they are not emailed/);
  assert.match(renderedText(renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(UpdatesPanel, { projectId: 1, updates: [], shared: [], onPosted: () => {} })))), /No updates yet/);
});

// ── D686 §5.8 (#1599): the sent page's author view ───────────────────────────
import { sentTitle, sentSub, sentRows, recipientState, moduleHref, REPLY_PILL, PAGE_SIZE } from '../src/pages/founder/SentUpdatePage.jsx';

test('D686: the sent page is titled by its period, with no duplicate eyebrow', () => {
  const html = page({ ...PAGE, period_start: '2026-10-01', period_end: '2026-10-31' });
  assert.match(html, /<h1[^>]*>Update · October 2026<\/h1>/);
  assert.doesNotMatch(html, /tracking-\[\.1em\][^>]*>Update</, 'the "Update" eyebrow is gone');
  assert.equal(sentTitle({ title: 'Stored title' }), 'Stored title');
  assert.equal(sentTitle({ period_start: '2026-10-01', period_end: '2026-10-15', title: 'x' }), 'Update · 1 Oct – 15 Oct');
});

test('D686: the sub names only the audiences the update went to', () => {
  const at = '2026-11-01T09:00:00Z';
  assert.equal(sentSub({ sent_at: at, sent_to: { investors: 3, team: 0, network: 0 } }), 'Sent 1 Nov to 3 investors');
  assert.equal(sentSub({ sent_at: at, sent_to: { investors: 1, team: 2, network: 0 } }), 'Sent 1 Nov to 1 investor and 2 team members');
  assert.equal(sentSub({ sent_at: at, network_includes_metrics: true, sent_to: { investors: 2, team: 1, network: 9 } }),
    'Sent 1 Nov to 2 investors, 1 team member and the Axal network (asks only, with metrics)');
});

test('D686: search, the three filters, latest first and 1–25 of N paging', () => {
  const html = page(PAGE);
  assert.match(html, /placeholder="Search replies…"/);
  assert.match(renderedText(html), /AllRepliesOpened/);
  assert.match(html, /<option value="latest"[^>]*>Latest<\/option>/);
  const many = { ...PAGE, recipients: Array.from({ length: 30 }, (_, i) => ({ audience: 'investor', label: `R${i}`, opened_at: `2026-11-${String(i + 1).padStart(2, '0')}T10:00:00Z` })) };
  const p1 = sentRows(many);
  assert.equal(p1.total, 31);
  assert.equal(`${p1.from}–${p1.to} of ${p1.total}`, '1–25 of 31');
  assert.equal(PAGE_SIZE, 25);
  assert.equal(p1.recipients[0].label, 'R29', 'the latest open first');
  const p2 = sentRows(many, { page: 2 });
  assert.equal(`${p2.from}–${p2.to}`, '26–31');
  assert.match(renderedText(page(many)), /1–25 of 31/);
  assert.deepEqual(sentRows(PAGE, { filter: 'replies' }).recipients, []);
  assert.deepEqual(sentRows(PAGE, { filter: 'opened' }).replies, []);
  assert.equal(sentRows(PAGE, { q: 'lee' }).replies.length, 1, 'a reply message is searched');
  assert.equal(sentRows(PAGE, { q: 'ivy' }).recipients.length, 1, 'a recipient label is searched');
  assert.equal(sentRows(PAGE, { q: 'nobody' }).total, 0);
  const two = { ...PAGE, asks: [{ uid: 'a1', kind: 'customer', text: 'Intro', replies: [
    { uid: 'o', name: 'Old', message: 'm', created_at: '2026-11-02 10:00:00' }, { uid: 'n', name: 'New', message: 'm', created_at: '2026-11-05 10:00:00' }] }] };
  assert.deepEqual(sentRows(two).replies.map((x) => x.reply.uid), ['n', 'o']);
});

test('D686: reply rows carry their pill; a hire reply proposes a candidate', () => {
  assert.deepEqual(REPLY_PILL, { hire: 'Candidate', customer: 'Lead', market: 'Contact', partner: 'Partner', capital: 'Investor' });
  const data = { ...PAGE, asks: [{ uid: 'a1', kind: 'hire', text: 'Engineer', replies: [{ uid: 'r1', name: 'Nia', message: 'Try Lee', created_at: '2026-11-03 09:00:00', landed_module: 'talent' }] }] };
  const text = renderedText(page(data));
  assert.match(text, /Nia proposed a candidate · 3 Nov/);
  assert.match(text, /Candidate/);
});

test('D686: a capital ask linked to a call has no noreply row, and links to the call in Raise', () => {
  const data = { ...PAGE, asks: [{ uid: 'c1', kind: 'capital', text: 'Seed', link_ref: 'call-1', replies: [], can_ask_again: true }] };
  const html = page(data);
  assert.doesNotMatch(renderedText(html), /No replies after 14 days/);
  assert.match(html, /href="\/raise\/calls\/call-1"/);
});

test('D686: the Opened states, and module links keep the venture once the Worker sends it', () => {
  assert.equal(recipientState({ not_delivered_reason: 'Bounced' }), 'Not delivered · Bounced');
  assert.equal(recipientState({ replied: true, opened_at: '2026-11-01T00:00:00Z' }), 'Replied');
  assert.equal(recipientState({ opened_at: '2026-11-04T08:00:00Z' }), 'Opened 4 Nov');
  assert.equal(recipientState({}), 'Not opened');
  assert.equal(moduleHref('customers', null), '/grow/distribution');
  assert.equal(moduleHref('partnerships', 7), '/grow/partner-network?project_id=7');
  assert.equal(moduleHref('capital', null), '/raise/capital-relationships');
  assert.equal(moduleHref('nowhere', 7), null);
});

// ── D686 §5.8 (#1599): the frame, the flags, the preview heading, market replies ──
import { SHARE_FIELDS, previewHeading } from '../src/pages/founder/ShareUpdateSheet.jsx';
import ShareUpdateLightbox from '../src/pages/founder/ShareUpdateLightbox.jsx';
import { RECORDS as GROW_RECORDS, marketWithReplies } from '../src/pages/cycles/adapters/grow.js';

test('D686: the sheet is an ActionSheet in the tall cycle lightbox, never a fixed side panel', () => {
  const { html } = sheet({ step: 0 });
  assert.doesNotMatch(html, /fixed inset-y-0|border-l /);
  assert.match(html, /data-testid="share-update-sheet"/);
  assert.match(html, /<h2 id="share-update-title"[^>]*>Share an update<\/h2>/);
  assert.match(html, /data-testid="share-update-sheet-steps"/);
  assert.match(html, /aria-current="step"[^>]*>1 · Period</);
  assert.match(html, /data-testid="share-update-sheet-close"/);
  const box = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(ShareUpdateLightbox, { projectId: 1, onClose: () => {} })));
  assert.match(box, /data-testid="share-update-lightbox-layer" data-size="tall"/);
  assert.match(box, /role="dialog" aria-modal="true" aria-label="Share an update"/);
  assert.match(box, /data-testid="share-update-sheet"/);
});

test('D686: the banner and an error go to the sheet banner; the error wins', () => {
  const nometrics = sheet({ step: 1, metrics: [], context: { ...base.context, metrics: [], no_metrics: true } });
  assert.match(nometrics.html, /data-testid="share-update-sheet-banner"/);
  const failed = sheet({ step: 0, error: 'That did not work. Nothing was sent.' });
  assert.match(failed.html, /role="alert" data-tone="error"[^>]*>That did not work\. Nothing was sent\.</);
});

test('D686: the preview group is headed by its period', () => {
  assert.equal(previewHeading('2026-10-01', '2026-10-31'), 'Preview · October update');
  assert.equal(previewHeading('2026-10-01', '2026-10-15'), 'Preview · 1 Oct – 15 Oct update');
  const { text } = sheet({ step: 5, period: { key: 'this', start: '2026-10-01', end: '2026-10-31' } });
  assert.match(text, /Preview · October update/);
});

test('D686: SHARE_FIELDS exists, frozen, with the network default off until S19-B', () => {
  assert.ok(Object.isFrozen(SHARE_FIELDS));
  assert.deepEqual(SHARE_FIELDS, { network_default_on: false });
  const src = readFileSync('frontend/src/pages/founder/ShareUpdateSheet.jsx', 'utf8');
  assert.match(src, /network: SHARE_FIELDS\.network_default_on/);
});

test('D686: Market expansion rows draw the replies their update asks brought in', () => {
  assert.equal(marketWithReplies('Spain', []), 'Spain');
  assert.equal(marketWithReplies('Spain', [{ name: 'Ana', created_at: '2026-11-02' }]), 'Spain · 1 reply from updates · latest Ana');
  assert.equal(marketWithReplies('Spain', [{ name: 'Old', created_at: '2026-11-01' }, { name: 'New', created_at: '2026-11-05' }]), 'Spain · 2 replies from updates · latest New');
  const row = GROW_RECORDS['market-expansion'].row({ uid: 'm1', name: 'Spain', replies: [{ name: 'Ana', created_at: '2026-11-02' }] }, 0);
  assert.equal(row.cells.market, 'Spain · 1 reply from updates · latest Ana');
  assert.equal(GROW_RECORDS['market-expansion'].row({ uid: 'm2', name: null }, 1).cells.market, null);
});
