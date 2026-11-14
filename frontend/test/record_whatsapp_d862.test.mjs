/**
 * D862 (#2507) — Record a session › WhatsApp, the boards WA1–WA13 on the
 * reads the Worker already serves. Every API is stubbed; every value is
 * invented, and no phone number appears in full.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/record_whatsapp_d862.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import RecordChannelPage from '../src/pages/founder/RecordChannelPage.jsx';
import {
  ACCEPT_ALL_MAX, NOT_RECORDED, WA_TABS, acceptAllIds, analyticsTiles, consentPill, contactName, figure, inboxRows, maskNumber,
  pageState, pendingNotice, proposalGroups, setupSteps, transcriptTurns, trendBars, trendWeeks, waHref, waRoute,
} from '../src/pages/founder/channelSessionModel.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (n) => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byId = (root, id) => walk(root).find((n) => props(n)['data-testid'] === id);

/* ------------------------------------------------------------------ *
 * Fixtures (invented)
 * ------------------------------------------------------------------ */

const thread = (uid, o = {}) => ({
  uid, provider: 'whatsapp', contact_name: '[Contact]', status: 'pending', message_count: 3, last_message_at: '2026-10-21T14:06:00Z',
  last_inbound_at: null, interview_id: null, interviewee_name: null, session_id: null, can_reply: true, reply_window_open: true,
  consent_status: 'awaiting', digest_status: null, pending_suggestions: 0, ...o,
});
const THREADS = [
  thread('t1'),
  thread('t2', { contact_name: '+44 7700 900123', consent_status: 'given', status: 'assigned', session_id: 14, interview_id: 3, interviewee_name: '[Person A]', last_message_at: '2026-10-20T10:00:00Z', pending_suggestions: 2 }),
  thread('t3', { provider: 'telegram', consent_status: null }),
];
const OVERVIEW = { providers: [{ provider: 'whatsapp', available: true }], connections: { whatsapp: { status: 'active', external_account_name: '•••• 1234' } }, pending: { whatsapp: 1, telegram: 1 } };
const SEGMENTS = [
  { id: 1, source: 'final', speaker_label: '[Contact]', text: 'Olá! Recebi a sua mensagem.', translation: 'Hi! I got your message.', translation_status: 'done', source_lang: 'pt', model: null },
  { id: 2, source: 'final', speaker_label: 'Me', text: 'Thanks for replying.', translation: null, translation_status: 'same', source_lang: 'en', model: null },
  { id: 3, source: 'final', speaker_label: '[Contact]', text: 'Usamos listas em papel.', translation: null, translation_status: 'pending', source_lang: 'pt', model: '@cf/openai/whisper-large-v3-turbo' },
  { id: 4, source: 'live', speaker_label: '[Contact]', text: 'a live draft line', translation_status: null },
];
const fig = (value, sources = ['Typed'], reason = null) => ({ value, sources, reason });
const SESSION_ANALYTICS = {
  messages: fig({ founder: { typed: 9, recorded: 0 }, customer: { typed: 12, recorded: 3 }, unattributed: { typed: 0, recorded: 0 }, total: 24 }, ['Typed', 'Recorded']),
  voice_minutes: fig(null, [], 'Not recorded: WhatsApp and Telegram voice notes are stored without their length.'),
  languages: fig([{ language: 'pt', count: 3 }], ['Recorded']),
  median_reply_seconds: fig(null, [], "Not recorded: a chat message's send time is not kept once the chat moves into a session."),
  pain_themes: fig([{ group_id: 1, title: '[Inspections run late]', suggested: 2, accepted: 1 }]),
  objections: fig([]), wtp_mentions: fig({ suggested: 1, accepted: 0, by_kind: {} }), competitor_mentions: fig([{ name: '[Competitor A]', suggested: 1, accepted: 0 }]),
  quotes_by_theme: fig([{ group_id: 1, title: '[Inspections run late]', quotes: ['Inspections run late almost every week.'] }]),
};
const placement = (id, kind, payload, o = {}) => ({ id, kind, payload, edited_payload: null, status: 'pending', can_accept: true, source: 'studioos', cite: { quote: `quote ${id}` }, ...o });
const PLACEMENTS = { runs: [{ run_id: 'r1', source: 'studioos', placements: [
  placement(1, 'demand_signal', { signal: 'would_pay', detail: '[€1,200] a month per site', confidence: 0.9 }),
  placement(2, 'competitor_mention', { name: '[Competitor A]', confidence: 0.65 }),
  placement(3, 'pain_severity', { phrase: '[Inspections run late]', severity: 'severe' }),
  placement(4, 'prototype_ask', { feature: 'a booking link', build_candidate: true, confidence: 0.7 }),
  placement(5, 'follow_up', { kind: 'follow_up', detail: 'send the price sheet' }, { status: 'accepted' }),
] }] };
const SETUP = { signed_in: true, number_masked: '•••• 1234', steps: [
  { step: 1, key: 'prerequisites', state: 'done', code: 'ok', action: null, confirm: null },
  { step: 2, key: 'number', state: 'done', code: 'ok', action: null, confirm: null },
  { step: 3, key: 'register', state: 'done', code: 'ok', action: null, confirm: null },
  { step: 4, key: 'webhook', state: 'blocked', code: 'meta_unreachable', action: 'Meta could not be reached. Press again in a minute.', confirm: 'Axal subscribes its app to your account’s webhooks.' },
  { step: 5, key: 'template', state: 'todo', code: 'create_template', action: 'Create the consent template.', confirm: 'Axal sends its consent template to Meta.' },
  { step: 6, key: 'connect', state: 'todo', code: 'connect_number', action: 'Connect the number.', confirm: 'Axal saves the connection.' },
] };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('addresses: each tab is a path, a session id only where a tab reads one', () => {
  assert.deepEqual(WA_TABS.map((t) => t.to), ['/validate/record/whatsapp', '/validate/record/whatsapp/sessions', '/validate/record/whatsapp/analytics', '/validate/record/whatsapp/proposals', '/validate/record/whatsapp/connection']);
  assert.deepEqual(waRoute('/validate/record/whatsapp/'), { tab: 'inbox', id: null });
  assert.deepEqual(waRoute('/validate/record/whatsapp/sessions/14'), { tab: 'sessions', id: 14 });
  // Mutation checked: accept any id → a word or a second segment would read as a session.
  assert.equal(waRoute('/validate/record/whatsapp/sessions/abc'), null);
  assert.equal(waRoute('/validate/record/whatsapp/connection/3'), null);
  assert.equal(waRoute('/validate/record/whatsapp/inbox'), null, 'the inbox is the address itself, never ?tab= or /inbox');
  assert.equal(waRoute('/validate/record/telegram'), null);
  assert.equal(waHref('analytics', 14), '/validate/record/whatsapp/analytics/14');
  assert.equal(waHref('connection', 14), '/validate/record/whatsapp/connection');
  const app = read('frontend/src/App.jsx');
  assert.match(app, /path="\/validate\/record\/whatsapp\/:tab" element=\{guard\(labRoles\(\['admin', 'founder'\]\), <RecordChannelPage \/>\)\}/);
  assert.match(app, /path="\/validate\/record\/whatsapp\/:tab\/:id" element=/);
});

test('a phone number is never shown in full', () => {
  assert.equal(maskNumber('+44 7700 900123'), '•••• 0123');
  assert.equal(maskNumber('12'), null);
  // Mutation checked: return the name as sent → the full number shows.
  assert.equal(contactName({ contact_name: '+44 7700 900123' }), '•••• 0123');
  assert.equal(contactName({ contact_name: '[Contact]' }), '[Contact]');
});

test('the page state: refused is no permission, failed is could-not-be-read, no connection is empty', () => {
  const ov = (o) => ({ status: 'ready', overview: { providers: { whatsapp: {} }, connections: { whatsapp: null }, ...o } });
  assert.equal(pageState({ overview: { status: 'loading' }, threads: { status: 'ready' } }), 'loading');
  assert.equal(pageState({ overview: ov(), threads: { status: 'forbidden' } }), 'nop');
  assert.equal(pageState({ overview: ov(), threads: { status: 'unreadable' } }), 'error');
  // Mutation checked: read no providers as empty → a member who cannot hold a venture is told to connect.
  assert.equal(pageState({ overview: ov({ providers: {} }), threads: { status: 'ready' } }), 'nop');
  assert.equal(pageState({ overview: ov(), threads: { status: 'ready' } }), 'empty');
  assert.equal(pageState({ overview: ov({ connections: { whatsapp: { status: 'active' } } }), threads: { status: 'ready' } }), 'ready');
});

test('the inbox: WhatsApp by default, newest first, consent in the canvas words, actions by state', () => {
  const rows = inboxRows(THREADS, 'whatsapp', Date.parse('2026-10-21T15:00:00Z'));
  assert.deepEqual(rows.map((r) => r.uid), ['t1', 't2']);
  assert.equal(rows[0].consent.t, 'Asked');
  assert.equal(rows[1].consent.t, 'Given');
  assert.equal(rows[1].name, '•••• 0123');
  assert.equal(inboxRows(THREADS, 'all').length, 3);
  assert.deepEqual([rows[0].canAssign, rows[0].canIgnore, rows[1].canAssign], [true, true, false]);
  assert.equal(consentPill(null).t, NOT_RECORDED);
  assert.equal(consentPill('declined').tone, 'neg');
});

test('the transcript: a translation only when the Worker sent one; the original never hidden without it', () => {
  const both = transcriptTurns(SEGMENTS, 'both');
  assert.deepEqual(both.map((t) => t.id), [1, 2, 3], 'only final segments');
  assert.equal(both[0].showOriginal && both[0].showTranslation, true);
  assert.equal(both[0].from, 'Translated from Portuguese');
  const tr = transcriptTurns(SEGMENTS, 'tr');
  assert.equal(tr[0].showOriginal, false);
  // Mutation checked: hide the original in Translation even without one → segment 2 vanishes.
  assert.equal(tr[1].showOriginal, true);
  assert.equal(tr[2].showTranslation, false);
  assert.equal(transcriptTurns(SEGMENTS, 'orig')[0].showTranslation, false);
  assert.equal(both[2].pending, true);
  assert.equal(both[2].voice, true);
  assert.equal(both[1].who, 'You');
  assert.match(pendingNotice(8).t, /^8 messages wait for translation/);
  assert.match(pendingNotice(8).p, /originals are kept/);
  assert.equal(pendingNotice(0), null);
});

test('analytics: a missing figure is Not recorded with the Worker’s reason, never 0', () => {
  const f = figure({ value: null, sources: [], reason: 'Not recorded: no store.' });
  assert.deepEqual([f.text, f.reason, f.missing], [NOT_RECORDED, 'Not recorded: no store.', true]);
  // Mutation checked: `value ?? 0` → a zero.
  assert.equal(figure({ value: 0, sources: ['Typed'] }).text, '0', 'a measured zero stays zero');
  const tiles = analyticsTiles(SESSION_ANALYTICS);
  assert.deepEqual(tiles.map((t) => t.e), ['Messages', 'Voice minutes', 'Languages', 'Median reply time']);
  assert.equal(tiles[0].text, '24');
  assert.equal(tiles[0].sub, 'You 9 · contacts 15');
  assert.deepEqual(tiles[0].sources, ['Typed', 'Recorded']);
  assert.equal(tiles[3].text, NOT_RECORDED);
  assert.deepEqual(analyticsTiles({ ...SESSION_ANALYTICS, sessions: 5 }, true).map((t) => t.e), ['Chats', 'Messages', 'Voice minutes', 'Median reply time']);
});

test('the trend: eight weeks to this one, and an unread week is a dashed Not recorded', () => {
  const weeks = trendWeeks(new Date('2026-10-21T12:00:00Z'));
  assert.equal(weeks.length, 8);
  assert.deepEqual(weeks[7], { from: '2026-10-19', to: '2026-10-25', last: true });
  assert.equal(weeks[0].from, '2026-08-31');
  const bars = trendBars(weeks, [4, 6, null, 8, 10, 8, 12, 3]);
  // Mutation checked: `v ?? 0` → the unread week draws as a zero bar.
  assert.deepEqual([bars[2].missing, bars[2].v, bars[2].h], [true, '—', 0]);
  assert.equal(bars[6].h, 100);
  assert.equal(bars[7].l, 'to date');
});

test('proposals: pending only, grouped as the canvas groups them, prototype asks For Build, Accept all at most 50', () => {
  const groups = proposalGroups(PLACEMENTS);
  assert.deepEqual(groups.map((g) => g.g), ['Pricing', 'Market intelligence', 'Problem', 'Follow-ups']);
  // Mutation checked: keep accepted items → the accepted follow-up is offered again.
  assert.deepEqual(groups[3].items.map((i) => i.id), [4]);
  assert.equal(groups[3].items[0].build, true);
  assert.equal(groups[3].items[0].t, 'Prototype ask: a booking link');
  assert.equal(groups[0].items[0].conf.t, 'High');
  assert.equal(groups[1].items[0].conf.t, 'Medium');
  assert.equal(groups[2].items[0].conf.t, NOT_RECORDED, 'no score is Not recorded, never Low');
  const many = [{ items: Array.from({ length: 60 }, (_, i) => ({ id: i + 1, canAccept: i !== 0 })) }];
  const ids = acceptAllIds(many);
  assert.equal(ids.length, ACCEPT_ALL_MAX);
  assert.equal(ids[0], 2, 'a proposed-only item is not sent');
});

test('the guided connect: the first step not done is the one to press, a failed one resumes', () => {
  const steps = setupSteps(SETUP);
  assert.deepEqual(steps.map((s) => s.state), ['done', 'done', 'done', 'failed', 'todo', 'todo']);
  assert.equal(steps[3].press, 'Resume from this step');
  // Mutation checked: offer every step not done → the template could run before the webhook.
  assert.equal(steps[4].press, null);
  assert.equal(steps[1].line, '•••• 1234.');
  assert.equal(steps[0].action, null);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

function stubApi(o = {}) {
  const calls = [];
  const rec = (name, value) => (...a) => { calls.push([name, ...a]); return typeof value === 'function' ? value(...a) : Promise.resolve(value); };
  return {
    calls,
    api: {
      channels: {
        overview: rec('overview', o.overview ?? OVERVIEW),
        threads: rec('threads', o.threads ?? { items: THREADS }),
        whatsappSetup: rec('whatsappSetup', o.setup ?? SETUP),
        whatsappSetupStep: rec('whatsappSetupStep', { ok: true }),
        assign: rec('assign', { ok: true }), requestConsent: rec('requestConsent', { ok: true }), ignore: rec('ignore', { ok: true }),
      },
      sessions: {
        get: rec('get', { segments: SEGMENTS, channel_consent: { status: 'given' } }),
        placements: rec('placements', PLACEMENTS),
        accept: rec('accept', { ok: true }), discard: rec('discard', { ok: true }),
        acceptAll: rec('acceptAll', { accepted: 4, remaining: 0 }),
      },
      analytics: { session: rec('session', SESSION_ANALYTICS), venture: rec('venture', { ...SESSION_ANALYTICS, sessions: 2 }) },
      app: { listProjects: rec('listProjects', [{ id: 7, name: '[Acme Robotics]' }]), listInterviews: rec('listInterviews', [{ id: 3, interviewee_name: '[Person A]' }]) },
    },
  };
}

async function mount(path, api) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; return n; };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(RecordChannelPage, { whatsappApi: api }))));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, async done() { await act(async () => root.unmount()); restore(); } };
}
const click = async (n) => act(async () => { await props(n).onClick?.({ preventDefault() {} }); await new Promise((r) => setTimeout(r, 0)); });

test('WA2 mounted: the inbox under the channel tabs, the masked number, and Ignore asks first', async () => {
  const { api, calls } = stubApi();
  const w = await mount('/validate/record/whatsapp', api);
  try {
    assert.ok(byId(w.container, 'record-channel-whatsapp'));
    assert.ok(byId(w.container, 'wa-tabs'));
    assert.equal(byId(w.container, 'record-channel-wait'), undefined, 'the built boards replace D1309’s placeholder');
    const page = text(w.container);
    assert.ok(!page.includes('7700 900123'), 'no full number on the page');
    assert.ok(byId(w.container, 'inbox-row-t2'));
    assert.equal(byId(w.container, 'inbox-row-t3'), undefined, 'WhatsApp by default');
    assert.match(text(byId(w.container, 'inbox-consent-t1')), /Asked/);
    await click(byId(w.container, 'inbox-ignore-t1'));
    // Mutation checked: ignore on the first click → no dialog, a write without asking.
    assert.ok(!calls.some((c) => c[0] === 'ignore'));
    assert.ok(byId(w.container, 'wa-ignore-dialog'));
    await click(byId(w.container, 'wa-ignore-dialog-confirm'));
    assert.deepEqual(calls.find((c) => c[0] === 'ignore'), ['ignore', 't1', true]);
  } finally { await w.done(); }
});

test('WA8–WA11 mounted: empty, error with Try again, and no permission', async () => {
  const empty = await mount('/validate/record/whatsapp', stubApi({ overview: { ...OVERVIEW, connections: {} } }).api);
  try { assert.ok(byId(empty.container, 'wa-empty')); } finally { await empty.done(); }
  const failing = stubApi({ threads: () => Promise.reject(Object.assign(new Error('x'), { status: 503 })) });
  const err = await mount('/validate/record/whatsapp', failing.api);
  try {
    assert.match(text(byId(err.container, 'wa-error')), /could not be read\. That is not the same as having none/);
    assert.ok(byId(err.container, 'wa-error-retry'));
  } finally { await err.done(); }
  const refused = await mount('/validate/record/whatsapp', stubApi({ threads: () => Promise.reject(Object.assign(new Error('x'), { status: 403 })) }).api);
  try { assert.ok(byId(refused.container, 'wa-nop')); assert.equal(byId(refused.container, 'wa-error'), undefined); } finally { await refused.done(); }
});

test('WA3 mounted: Original · Translation · Both, and the pending row', async () => {
  const w = await mount('/validate/record/whatsapp/sessions/14', stubApi().api);
  try {
    assert.ok(byId(w.container, 'turn-translation-1'));
    assert.ok(byId(w.container, 'turn-original-1'));
    assert.ok(byId(w.container, 'turn-pending-3'));
    assert.match(text(byId(w.container, 'transcript-pending')), /1 message waits for translation/);
    assert.match(text(byId(w.container, 'transcript-consent')), /Consent is given/);
    await click(byId(w.container, 'transcript-view-tr'));
    assert.equal(byId(w.container, 'turn-original-1'), undefined);
    assert.ok(byId(w.container, 'turn-original-2'), 'an untranslated message still shows');
    await click(byId(w.container, 'transcript-view-orig'));
    assert.equal(byId(w.container, 'turn-translation-1'), undefined);
  } finally { await w.done(); }
});

test('WA4 and WA5 mounted: Not recorded tiles with reasons; the venture reads WhatsApp only', async () => {
  const s = stubApi();
  const one = await mount('/validate/record/whatsapp/analytics/14', s.api);
  try {
    assert.match(text(byId(one.container, 'tile-median-reply-time')), /Not recorded.*send time is not kept/);
    assert.match(text(byId(one.container, 'analytics-quotes')), /Inspections run late almost every week/);
  } finally { await one.done(); }
  const v = stubApi();
  const all = await mount('/validate/record/whatsapp/analytics', v.api);
  try {
    assert.ok(byId(all.container, 'channel-analytics-venture'));
    assert.ok(byId(all.container, 'analytics-trend'));
    const reads = v.calls.filter((c) => c[0] === 'venture');
    assert.ok(reads.length >= 9, 'the range and eight weeks');
    assert.ok(reads.every((c) => c[1].channel === 'whatsapp' && c[1].projectId === 7));
  } finally { await all.done(); }
});

test('WA6 mounted: For Build, and Accept all sends the pending ids after its dialog', async () => {
  const s = stubApi();
  const w = await mount('/validate/record/whatsapp/proposals/14', s.api);
  try {
    assert.ok(byId(w.container, 'proposal-build-4'));
    assert.equal(byId(w.container, 'proposal-5'), undefined, 'an accepted item is not offered');
    await click(byId(w.container, 'proposals-accept-all'));
    assert.ok(!s.calls.some((c) => c[0] === 'acceptAll'));
    await click(byId(w.container, 'proposal-all-dialog-confirm'));
    assert.deepEqual(s.calls.find((c) => c[0] === 'acceptAll'), ['acceptAll', 14, [1, 2, 3, 4]]);
  } finally { await w.done(); }
});

test('WA1 mounted: the failed step resumes after its confirm; the setup off is Embedded Signup', async () => {
  const s = stubApi();
  const w = await mount('/validate/record/whatsapp/connection', s.api);
  try {
    assert.match(text(byId(w.container, 'step-pill-webhook')), /Failed/);
    assert.equal(byId(w.container, 'step-press-template'), undefined);
    await click(byId(w.container, 'step-press-webhook'));
    assert.match(text(byId(w.container, 'step-dialog')), /subscribes its app/);
    await click(byId(w.container, 'step-dialog-confirm'));
    assert.deepEqual(s.calls.find((c) => c[0] === 'whatsappSetupStep'), ['whatsappSetupStep', 'webhook']);
  } finally { await w.done(); }
  const off = await mount('/validate/record/whatsapp/connection', stubApi({ setup: () => Promise.reject(Object.assign(new Error('x'), { status: 404 })) }).api);
  try { assert.equal(props(byId(off.container, 'connect-off-signup')).href, '/account/connectors/whatsapp'); } finally { await off.done(); }
});

test('the boards keep their rules: no browser pop-up, no Eadwyn advice words, every colour with its dark pair', () => {
  const src = ['ChannelSessionParts.jsx', 'RecordWhatsAppTool.jsx', 'channelSessionModel.js'].map((f) => read(`frontend/src/pages/founder/${f}`)).join('\n');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /window\.(alert|confirm|prompt)\(/);
  assert.doesNotMatch(code, /\b(advisor|advice|recommendation)s?\b/i);
  assert.match(read('frontend/src/lib/api/channels.js'), /whatsappSetup: \(\) => request\('\/channels\/whatsapp\/setup'\)/);
});
