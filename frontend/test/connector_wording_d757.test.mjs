/**
 * D757 §2.12 (#1929) — Zoom's page, the Customer conversations cards and
 * Record a session say what feeds Validate, in D757's words: Used by, How it
 * works, What you need, Consent, Cost, Your data, who can connect (from
 * `distribution`) and the not-set-up sentence (D751's `configured`).
 *
 * Every string is pinned here, verbatim from D757 §2.12. Each case names the
 * mutations it was checked against.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/connector_wording_d757.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';

import {
  CHANNEL_WORDING, CHAT_ENGINE, DEFAULT_SUGGESTS, RECORD_ENGINE, VALIDATE_MODULE_LABELS, ZOOM_DISCONNECT_NOTE, ZOOM_DISTRIBUTION,
  ZOOM_HOW_STEPS, ZOOM_SECTIONS, ZOOM_UNCONFIGURED, engineSentence, listSentence, recordSourceLine, usedByLinks,
  zoomDistributionNotice, zoomHowItWorks, zoomNotices,
} from '../src/lib/validateSourceWording.js';
import { ZoomValidate, ConnectorPageView } from '../src/pages/account/ConnectorPage.jsx';
import { ChannelsGroup, ValidateLines } from '../src/pages/account/ChannelsGroup.jsx';
import { readOverview, shownChannels } from '../src/pages/account/channelsModel.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => renderedText(html(el));

// D757 §2.12, as written.
const D757 = {
  how1: 'Schedule a call from an interview in Record a session. Axal creates the meeting on your Zoom account.',
  how2: 'When the call ends and Zoom finishes its cloud transcript, Axal imports it into that interview.',
  how3: 'Eadwyn writes a draft summary and suggests findings for Problem discovery, Customer research, Ideal customer profile, Market intelligence, Demand and urgency signals, and Experiments and evidence. You accept each one. Accepted evidence is there for your Verdict.',
  need: 'A Zoom Pro plan or higher, cloud recording on, and Create audio transcript turned on before the call.',
  consent: 'Before Axal schedules a recorded call, you confirm the interviewee agreed. Zoom also shows its own recording notice.',
  cost: 'Summaries and suggestions use your AI allowance, then your token packs.',
  data: "Transcripts are kept in your interview. Deleting the interview deletes them. Disconnecting revokes Axal's access at Zoom; transcripts already imported stay in your interviews.",
  unset: "Zoom isn't set up on Axal yet, so it can't be connected. Nothing was sent to Zoom.",
  own: "Zoom hasn't approved Axal for other Zoom accounts yet. Until it does, only accounts in Axal's own Zoom organisation can connect.",
  beta: 'Zoom beta: open to invited founders.',
  chats: 'Chats you assign to an interview become its notes. Eadwyn writes a draft summary and suggests findings for your Validate modules; you accept each one.',
  record: "Axal records this device's microphone, turns speech into text, then writes a draft summary and suggests findings for your Validate modules.",
};
const USED_BY = [{ label: 'Validate › Record a session', href: '/validate/record' }];
const zoomRow = (extra = {}) => ({
  key: 'zoom', display_name: 'Zoom', status: 'beta', tier: 'free', auth_type: 'oauth2', category: 'Messaging', available: true,
  used_by: USED_BY, suggests: [...DEFAULT_SUGGESTS], feeds: ['customer_research'], distribution: 'own_account', configured: true,
  connection: null, ...extra,
});

// 1 ───────────────────────────────────────────────────────────────────────────
test('every string is D757 §2.12, word for word', () => {
  // Mutations checked: one word changed in each constant (each assertion fails);
  // "and" dropped before the last module.
  assert.deepEqual(ZOOM_HOW_STEPS, [D757.how1, D757.how2]);
  assert.deepEqual(zoomHowItWorks(DEFAULT_SUGGESTS), [D757.how1, D757.how2, D757.how3]);
  assert.deepEqual(ZOOM_SECTIONS.map((x) => [x.title, x.text]),
    [['What you need', D757.need], ['Consent', D757.consent], ['Cost', D757.cost], ['Your data', D757.data]]);
  assert.equal(ZOOM_UNCONFIGURED, D757.unset);
  assert.deepEqual(ZOOM_DISTRIBUTION, { own_account: D757.own, beta: D757.beta, public: null });
  assert.equal(CHAT_ENGINE, D757.chats);
  assert.equal(RECORD_ENGINE, D757.record);
  assert.ok(D757.data.endsWith(ZOOM_DISCONNECT_NOTE), 'the disconnect note is Your data\'s own sentence');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('How it works names the modules from suggests, and always ends on the Verdict line', () => {
  // Mutations checked: Verdict listed among the modules; unknown keys kept; the
  // empty-list fallback removed (the sentence names nothing).
  assert.equal(engineSentence(['customer_research', 'market_intelligence']),
    'Eadwyn writes a draft summary and suggests findings for Customer research and Market intelligence. You accept each one. Accepted evidence is there for your Verdict.');
  assert.equal(engineSentence(['customer_research', 'verdict', 'nonsense']),
    'Eadwyn writes a draft summary and suggests findings for Customer research. You accept each one. Accepted evidence is there for your Verdict.');
  assert.equal(engineSentence(undefined), D757.how3, 'a row without suggests reads the six');
  assert.equal(engineSentence([]), D757.how3);
  assert.equal(listSentence(['A']), 'A');
  assert.equal(listSentence(['A', 'B', 'C']), 'A, B, and C');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('the three distribution states, and anything else reads as own_account', () => {
  // Mutations checked: an unknown value reading as `public` (no notice); no
  // trim or lower-case; `public` drawing a notice.
  assert.equal(zoomDistributionNotice('own_account'), D757.own);
  assert.equal(zoomDistributionNotice('beta'), D757.beta);
  assert.equal(zoomDistributionNotice('public'), null);
  for (const v of [undefined, null, '', 'everyone', 7, ' Beta ']) {
    assert.equal(zoomDistributionNotice(v), v === ' Beta ' ? D757.beta : D757.own, String(v));
  }
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('the configured: false sentence comes first; configured true or absent draws none', () => {
  // Mutations checked: `!p.configured` (an absent field claims "not set up"); the order swapped.
  assert.deepEqual(zoomNotices(zoomRow({ configured: false })).map((n) => n.text), [D757.unset, D757.own]);
  assert.deepEqual(zoomNotices(zoomRow({ configured: true, distribution: 'public' })), []);
  assert.deepEqual(zoomNotices(zoomRow({ configured: undefined, distribution: 'beta' })).map((n) => n.text), [D757.beta]);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('Zoom\'s page draws Used by, How it works, the four sections and its notices', () => {
  // Mutations checked: the page not mounting ZoomValidate (no section); Used by
  // dropped; the disconnect note shown while not connected.
  const t = text(h(ZoomValidate, { p: zoomRow({ configured: false }) }));
  for (const s of [D757.unset, D757.own, 'Used by', 'Validate › Record a session', 'How it works', D757.how1, D757.how2, D757.how3,
    'What you need', D757.need, 'Consent', D757.consent, 'Cost', D757.cost, 'Your data', D757.data]) assert.ok(t.includes(s), s);
  assert.ok(html(h(ZoomValidate, { p: zoomRow() })).includes('href="/validate/record"'));
  assert.ok(!html(h(ZoomValidate, { p: zoomRow() })).includes('zoom-disconnect-note'), 'not connected: no disconnect note');
  assert.ok(html(h(ZoomValidate, { p: zoomRow({ connection: { uid: 'z1' } }) })).includes('zoom-disconnect-note'));
  assert.ok(!text(h(ZoomValidate, { p: zoomRow({ distribution: 'public' }) })).includes('Zoom beta'));

  const data = { status: 'ready', catalogue: [zoomRow()], reload() {} };
  assert.ok(html(h(ConnectorPageView, { data, connectorKey: 'zoom' })).includes('connector-page-validate'), 'mounted on Zoom\'s page');
  const stripe = { key: 'stripe', display_name: 'Stripe', status: 'live', tier: 'free', auth_type: 'oauth2', available: true, connection: null };
  assert.ok(!html(h(ConnectorPageView, { data: { status: 'ready', catalogue: [stripe], reload() {} }, connectorKey: 'stripe' })).includes('connector-page-validate'), 'only Zoom\'s');
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('Used by keeps only app paths with a label', () => {
  // Mutation checked: no href filter (a `//evil` or `https:` link is drawn).
  assert.deepEqual(usedByLinks([...USED_BY, { label: 'x', href: '//evil.test' }, { label: 'y', href: 'https://evil.test' }, { href: '/a' }, null]), USED_BY);
  assert.deepEqual(usedByLinks(undefined), []);
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('each conversation card says what uses it and the engine sentence', () => {
  // Mutations checked: Inbox dropped from the chats; the Zoom sentence on the
  // chats; CardFrame not drawing ValidateLines.
  assert.deepEqual(CHANNEL_WORDING.telegram.usedBy.map((u) => u.label), ['Validate › Record a session', 'Validate › Inbox']);
  assert.deepEqual(CHANNEL_WORDING.whatsapp.usedBy.map((u) => u.label), ['Validate › Record a session', 'Validate › Inbox']);
  assert.deepEqual(CHANNEL_WORDING.google_meet.usedBy.map((u) => u.label), ['Validate › Record a session']);
  assert.equal(CHANNEL_WORDING.telegram.engine, D757.chats);
  assert.equal(CHANNEL_WORDING.whatsapp.engine, D757.chats);
  assert.equal(CHANNEL_WORDING.google_meet.engine, D757.how3);
  assert.equal(CHANNEL_WORDING.zoom.engine, D757.how3);
  const lines = text(h(ValidateLines, { provider: 'telegram' }));
  assert.ok(lines.startsWith('Used by: Validate › Record a session and Validate › Inbox'), lines);
  assert.ok(lines.endsWith(D757.chats), lines);
  assert.equal(html(h(ValidateLines, { provider: 'slack' })), '');

  const overview = readOverview({ providers: ['telegram', 'whatsapp', 'zoom', 'google_meet'].map((provider) => ({ provider, available: true })), connections: {}, pending: {} });
  const group = html(h(ChannelsGroup, { status: 'ready', overview, catalogue: [zoomRow(), { key: 'google', available: true }] }));
  for (const k of ['telegram', 'whatsapp', 'zoom', 'google_meet']) {
    assert.ok(group.includes(`data-testid="channel-used-by-${k}"`), `${k}: Used by`);
    assert.ok(group.includes(`data-testid="channel-engine-${k}"`), `${k}: engine sentence`);
  }
  assert.ok(group.includes('href="/validate/inbox"'));
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('a member offered no channel sees no card, except one they are connected on', () => {
  // Mutations checked: `offered` read from an absent list (an old answer hides
  // every card); the group drawn with no card; a connected card hidden.
  const none = readOverview({ providers: [], connections: {}, pending: {} });
  assert.equal(none.offered, false);
  assert.deepEqual(shownChannels(none), []);
  assert.equal(html(h(ChannelsGroup, { status: 'ready', overview: none })), '');
  const absent = readOverview({ connections: {} });
  assert.equal(absent.offered, true, 'an absent list is unknown, not "none offered"');
  assert.deepEqual(shownChannels(absent), ['telegram', 'whatsapp', 'zoom', 'google_meet']);
  const kept = readOverview({ providers: [], connections: { telegram: { status: 'active', external_account_name: '@inv' } }, pending: {} });
  assert.deepEqual(shownChannels(kept), ['telegram']);
  const g = html(h(ChannelsGroup, { status: 'ready', overview: kept }));
  assert.ok(g.includes('channel-card-telegram') && !g.includes('channel-card-whatsapp') && !g.includes('channel-card-zoom'));
  assert.ok(g.includes('button-channel-disconnect-telegram'), 'it keeps Disconnect');
});

// 9 ───────────────────────────────────────────────────────────────────────────
test('Record a session: the recorder line for In person, Video and Phone; the chat line for an imported chat; none for a paste', () => {
  // Mutations checked: Video left out; the chat line on a paste; the lightbox not drawing it.
  for (const m of ['in_person', 'video', 'phone']) assert.equal(recordSourceLine(m, 'zoom'), D757.record, m);
  assert.equal(recordSourceLine('text', 'whatsapp'), D757.chats);
  assert.equal(recordSourceLine('text', 'telegram'), D757.chats);
  assert.equal(recordSourceLine('text', 'paste'), null);
  const src = readFileSync(new URL('../src/pages/founder/RecordLightbox.jsx', import.meta.url), 'utf8');
  assert.match(src, /data-testid="record-source-note">\{recordSourceLine\(mode, provider\)\}/);
});

// 10 ──────────────────────────────────────────────────────────────────────────
test('the module labels are Validate\'s module names', () => {
  // Mutation checked: a label differing from cycleValidate's MODULES name.
  const cv = readFileSync(new URL('../../cloudflare-worker/src/services/cycleValidate.ts', import.meta.url), 'utf8');
  for (const [key, label] of Object.entries(VALIDATE_MODULE_LABELS)) {
    assert.ok(cv.includes(`slug: '${key.replace(/_/g, '-')}', name: '${label}'`), `${key}: ${label}`);
  }
});
