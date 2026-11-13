/**
 * D754 way B (#1939, task fb) — "Send recordings from your WhatsApp" on
 * WhatsApp's page, and Record a Session's "From WhatsApp" entry. `wayBState`
 * in every §11 way-B state, from fixtures shaped like wb1's
 * `GET /channels/whatsapp/link`; the code flow (Link, the code, Open
 * WhatsApp, its expiry, a re-read on focus); Confirm and Unlink against a
 * stubbed API; the page and the sheet as they mount the section and the entry.
 * No test reaches the Worker.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/whatsapp_way_b_d754.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import {
  WAY_B, WHATSAPP_ENTRY_CONSENT, WHATSAPP_ENTRY_LIMIT, WHATSAPP_ENTRY_STEPS, WHATSAPP_PAGE_HREF,
  expiresIn, lastUsedLine, maskedNumber, safeWaLink, wayBRefusal, wayBState,
} from '../src/pages/account/whatsappWayB.js';
import { WhatsAppEntry, WhatsAppWayBSection } from '../src/pages/account/WhatsAppWayB.jsx';
import { channelsApi } from '../src/lib/api/channels.js';
import { readOverview } from '../src/pages/account/channelsModel.js';
import { ChannelPageView } from '../src/pages/account/ChannelPage.jsx';
import RecordLightbox from '../src/pages/founder/RecordLightbox.jsx';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';

const h = React.createElement;
const MEMBER = { id: 7, role: 'founder', is_super_admin: 0 };
const SUPER = { id: 1, role: 'admin', is_super_admin: 1 };
const NOW = Date.parse('2026-10-19T10:00:00Z');
const CODE_TEXT = 'Ab3dEf6hIj9kLm2nOp5qRs8t';
const CODE = { code: CODE_TEXT, wa_link: `https://wa.me/14155550100?text=LINK%20${CODE_TEXT}`, expires_at: '2026-10-19T10:10:00Z' };
// The refusal as `request` throws it: a Super Admin's body names the unset settings (#1939, 3A), a member's does not.
const off = (missing) => Object.assign(new Error('WhatsApp is not available on this deployment yet.'),
  { status: 503, code: 'not_available', data: { code: 'not_available', ...(missing ? { missing } : {}) } });
const ready = (view) => ({ status: 'ready', view });
const claim = (status, extra = {}) => ({ uid: 'cl_1', number_masked: '•••• 1234', expires_at: '2026-10-19T10:10:00Z', status, message: `The ${status} sentence.`, ...extra });
const LINK = { number_masked: '•••• 1234', linked_at: '2026-10-01T09:00:00Z', last_used_at: '2026-10-03T12:00:00Z' };

// ================================================================ wayBState, one case per §11 way-B row

test("Axal's number unset: hidden for a member; a Super Admin sees the four setting names and no value", () => {
  const m = wayBState({ status: 'error', error: off() }, { user: MEMBER });
  assert.deepEqual(m, { state: 'hidden', notice: '' });
  const s = wayBState({ status: 'error', error: off(['WHATSAPP_AXAL_WABA_ID', 'WHATSAPP_AXAL_DISPLAY_NUMBER']) }, { user: SUPER });
  assert.equal(s.state, 'hidden');
  assert.equal(s.notice, `${WAY_B.unsetNotice} WHATSAPP_AXAL_WABA_ID, WHATSAPP_AXAL_DISPLAY_NUMBER.`, 'only the unset names, in order');
  // A name the Worker never sends is not drawn, whatever the body says.
  assert.equal(wayBState({ status: 'error', error: off(['sk_live_SECRET', 'WHATSAPP_AXAL_WABA_ID']) }, { user: SUPER }).notice,
    `${WAY_B.unsetNotice} WHATSAPP_AXAL_WABA_ID.`);
  // All four set, but WhatsApp itself off: no list, and no claim that a setting is missing.
  assert.equal(wayBState({ status: 'error', error: off() }, { user: SUPER }).notice, WAY_B.offNotice);
  assert.equal(wayBState({ status: 'error', error: off(['WHATSAPP_AXAL_WABA_ID']) }, { user: MEMBER }).notice, '', 'a member read a setting name');
  // A bare 503 with no code is the same refusal; another code is not.
  assert.equal(wayBState({ status: 'error', error: { status: 503 } }, { user: MEMBER }).state, 'hidden');
  assert.equal(wayBState({ status: 'error', error: { status: 503, code: 'link_limit_unavailable' } }, { user: MEMBER }).state, 'unreadable');
});

test('a failed read is unreadable, never "not linked"; loading draws nothing yet', () => {
  const v = wayBState({ status: 'error', error: Object.assign(new Error('x'), { status: 500, code: 'internal' }) }, { user: MEMBER });
  assert.deepEqual(v, { state: 'unreadable', why: WAY_B.unreadable });
  assert.equal(wayBState({ status: 'loading' }).state, 'loading');
  assert.equal(wayBState(null).state, 'loading');
});

test('not linked: Link your WhatsApp; a lapsed claim says its own sentence, a waiting one does not', () => {
  assert.deepEqual(wayBState(ready({ claim: null, link: null }), { now: NOW }), { state: 'not_linked', why: '' });
  for (const st of ['expired', 'cancelled', 'unreadable']) {
    assert.equal(wayBState(ready({ claim: claim(st), link: null }), { now: NOW }).why, `The ${st} sentence.`, st);
  }
  // Waiting on WhatsApp, with no code in this tab: the code went with the other tab, so make a new one.
  assert.deepEqual(wayBState(ready({ claim: claim('waiting_whatsapp'), link: null }), { now: NOW }), { state: 'not_linked', why: '' });
});

test('linking: the code, the wa.me link, "Expires in 10 minutes"; a lapsed code asks for a new one', () => {
  const v = wayBState(ready({ claim: claim('waiting_whatsapp'), link: null }), { code: CODE, now: NOW });
  assert.deepEqual(v, { state: 'linking', code: CODE_TEXT, href: CODE.wa_link, expires: 'Expires in 10 minutes.' });
  const late = wayBState(ready({ claim: claim('waiting_whatsapp'), link: null }), { code: CODE, now: Date.parse(CODE.expires_at) });
  assert.deepEqual(late, { state: 'not_linked', why: 'That code has expired. Make a new one.' });
  // A link that is not the Worker's wa.me shape is never drawn.
  assert.equal(wayBState(ready({}), { code: { ...CODE, wa_link: 'https://evil.example/14155550100' }, now: NOW }).state, 'not_linked');
});

test('confirm: "Is •••• 1234 your number?" once WhatsApp sent the code; an unmasked number is never shown', () => {
  assert.deepEqual(wayBState(ready({ claim: claim('waiting_axal'), link: null }), { code: CODE, now: NOW }), { state: 'confirm', uid: 'cl_1', number: '•••• 1234' });
  assert.equal(wayBState(ready({ claim: claim('waiting_axal', { number_masked: '+14155551234' }), link: null }), { now: NOW }).state, 'not_linked');
});

test('linked: the masked number, when it was linked and last used; a link wins over an old claim', () => {
  assert.deepEqual(wayBState(ready({ claim: claim('linked'), link: LINK })), {
    state: 'linked', number: '•••• 1234', linkedAt: LINK.linked_at, lastUsedAt: LINK.last_used_at, venture: null,
  });
  assert.equal(wayBState(ready({ claim: claim('waiting_axal'), link: LINK })).state, 'linked');
});

test('the small rules: masks, the wa.me shape, minutes, refusals, the last-used line', () => {
  assert.equal(maskedNumber('•••• 1234'), '•••• 1234');
  for (const bad of ['1234', '•••• 12345', '+14155551234', null, 7]) assert.equal(maskedNumber(bad), '', String(bad));
  assert.equal(safeWaLink(CODE.wa_link), CODE.wa_link);
  for (const bad of ['http://wa.me/14155550100?text=LINK%20' + CODE_TEXT, 'https://wa.me/14155550100?text=HI', `https://wa.me/1415?text=LINK%20${CODE_TEXT}`, `javascript:alert(1)//https://wa.me/14155550100?text=LINK%20${CODE_TEXT}`]) {
    assert.equal(safeWaLink(bad), null, bad);
  }
  assert.equal(expiresIn(600000), 'Expires in 10 minutes.');
  assert.equal(expiresIn(59001), 'Expires in 1 minute.');
  assert.equal(expiresIn(60001), 'Expires in 2 minutes.');
  assert.equal(expiresIn(0), 'Expires in 1 minute.');
  assert.equal(wayBRefusal(new Error('This WhatsApp is already linked to another Axal account.'), 'fallback'), 'This WhatsApp is already linked to another Axal account.');
  assert.equal(wayBRefusal(Object.assign(new Error('number_taken'), { code: 'number_taken' }), 'fallback'), 'fallback');
  assert.equal(wayBRefusal(new Error('rate_limited'), 'fallback'), 'fallback');
  assert.equal(wayBRefusal(null, 'fallback'), 'fallback');
  assert.equal(lastUsedLine('2026-10-03T12:00:00Z', (d) => d.toISOString().slice(0, 10)), 'Last recording 2026-10-03.');
  assert.equal(lastUsedLine(null), 'No recording sent yet.');
});

// ================================================================ the section, drawn

const draw = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(WhatsAppWayBSection, { api: {}, now: NOW, ...props })));

test('the section draws nothing for a member while Axal\'s number is unset, the names (no value) for a Super Admin', () => {
  assert.equal(draw({ read: { status: 'error', error: off() }, user: MEMBER }), '');
  const s = draw({ read: { status: 'error', error: off(['WHATSAPP_AXAL_DISPLAY_NUMBER']) }, user: SUPER });
  assert.ok(s.includes('data-testid="way-b-unset"'));
  assert.ok(s.includes('WHATSAPP_AXAL_DISPLAY_NUMBER'));
  assert.ok(!s.includes('WHATSAPP_AXAL_ACCESS_TOKEN'), 'a set setting was named as missing');
  assert.ok(!s.includes(WAY_B.heading), 'no section, only the notice');
  assert.equal(draw({ read: { status: 'loading' }, user: MEMBER }), '');
});

test('each drawn state: its heading, its control, and the line on what Axal sends only once linked', () => {
  const not = draw({ read: ready({}) });
  assert.ok(not.includes(WAY_B.heading) && not.includes('data-testid="button-way-b-link"') && not.includes(WAY_B.link));
  assert.ok(!not.includes(WAY_B.sends));
  const linking = draw({ read: ready({ claim: claim('waiting_whatsapp') }), initialCode: CODE });
  assert.ok(linking.includes(`LINK ${CODE_TEXT}`));
  assert.ok(linking.includes(`href="${CODE.wa_link}"`) && linking.includes('target="_blank"') && linking.includes('rel="noopener noreferrer"'));
  assert.ok(linking.includes('Expires in 10 minutes.'));
  assert.ok(!linking.includes('data-testid="button-way-b-link"'));
  const confirm = draw({ read: ready({ claim: claim('waiting_axal') }) });
  assert.ok(confirm.includes('Is •••• 1234 your number?') && confirm.includes('data-testid="button-way-b-confirm"'));
  const linked = draw({ read: ready({ link: LINK }) });
  assert.ok(linked.includes('data-testid="way-b-number"') && linked.includes('•••• 1234'));
  assert.ok(linked.includes(WAY_B.sends) && linked.includes('data-testid="button-way-b-unlink"') && linked.includes('data-testid="way-b-last"'));
  const unreadable = draw({ read: { status: 'error', error: { status: 500 } }, onChanged() {} });
  assert.ok(unreadable.includes(WAY_B.unreadable) && unreadable.includes('Retry'));
});

// ================================================================ the code flow, Confirm and Unlink

let focusListeners = [];
async function mount(element) {
  const restoreDoc = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  focusListeners = [];
  globalThis.window.addEventListener = (type, fn) => { if (type === 'focus') focusListeners.push(fn); };
  globalThis.window.removeEventListener = (type, fn) => { if (type === 'focus') focusListeners = focusListeners.filter((f) => f !== fn); };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, h(Routes, null, h(Route, { path: '*', element })))); });
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    by, props,
    text: () => textOf(container).replace(/\s+/g, ' '),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async rerender(el) { await act(async () => { root.render(h(MemoryRouter, null, h(Routes, null, h(Route, { path: '*', element: el })))); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}

test('Link your WhatsApp: POSTs once, draws the code and Open WhatsApp, and re-reads the link on focus', async () => {
  let posts = 0; let reads = 0;
  const api = { whatsappLink: async () => { posts += 1; return CODE; } };
  const onChanged = () => { reads += 1; };
  const v = await mount(h(WhatsAppWayBSection, { read: ready({}), api, onChanged, now: NOW }));
  try {
    await v.click('button-way-b-link');
    assert.equal(posts, 1);
    assert.equal(reads, 1, 'the link is read again after a new code');
    assert.ok(v.text().includes(`LINK ${CODE_TEXT}`));
    assert.equal(v.props(v.by('link-way-b-open')).href, CODE.wa_link);
    assert.equal(focusListeners.length, 1, 'back from WhatsApp: a focus re-read');
    focusListeners[0]();
    assert.equal(reads, 2);
  } finally { await v.unmount(); }
});

test('a refused code shows the Worker\'s sentence, never a code', async () => {
  const api = { whatsappLink: async () => { throw Object.assign(new Error('rate_limited'), { status: 429, code: 'rate_limited' }); } };
  const v = await mount(h(WhatsAppWayBSection, { read: ready({}), api, onChanged() {}, now: NOW }));
  try {
    await v.click('button-way-b-link');
    assert.equal(v.text().includes('Axal could not make a code. Try again in a minute.'), true);
    assert.ok(!v.text().includes('rate_limited'));
  } finally { await v.unmount(); }
});

test('Confirm sends the claim\'s uid and says linked; number_taken is the Worker\'s sentence', async () => {
  const seen = [];
  let reads = 0;
  const api = { confirmWhatsAppLink: async (uid) => { seen.push(uid); return { ok: true, linked: true }; } };
  const v = await mount(h(WhatsAppWayBSection, { read: ready({ claim: claim('waiting_axal') }), api, onChanged: () => { reads += 1; }, now: NOW }));
  try {
    await v.click('button-way-b-confirm');
    assert.deepEqual(seen, ['cl_1']);
    assert.equal(reads, 1);
    assert.ok(v.text().includes('Your WhatsApp is linked.'));
  } finally { await v.unmount(); }
  const notYet = { confirmWhatsAppLink: async () => ({ ok: true, linked: false }) };
  const n = await mount(h(WhatsAppWayBSection, { read: ready({ claim: claim('waiting_axal') }), api: notYet, onChanged() {}, now: NOW }));
  try {
    await n.click('button-way-b-confirm');
    assert.ok(!n.text().includes('Your WhatsApp is linked.'), 'only `linked: true` says linked');
  } finally { await n.unmount(); }
  const taken = { confirmWhatsAppLink: async () => { throw Object.assign(new Error('This WhatsApp is already linked to another Axal account.'), { status: 409, code: 'number_taken' }); } };
  const w = await mount(h(WhatsAppWayBSection, { read: ready({ claim: claim('waiting_axal') }), api: taken, onChanged() {}, now: NOW }));
  try {
    await w.click('button-way-b-confirm');
    assert.ok(w.text().includes('This WhatsApp is already linked to another Axal account.'));
    assert.ok(!w.text().includes('Your WhatsApp is linked.'));
  } finally { await w.unmount(); }
});

test('Unlink calls DELETE and says so; a failure keeps the link drawn and says why', async () => {
  let calls = 0; let reads = 0;
  const api = { unlinkWhatsApp: async () => { calls += 1; return { ok: true, unlinked: true }; } };
  const v = await mount(h(WhatsAppWayBSection, { read: ready({ link: LINK }), api, onChanged: () => { reads += 1; }, now: NOW }));
  try {
    await v.click('button-way-b-unlink');
    assert.equal(calls, 1);
    assert.equal(reads, 1);
    assert.ok(v.text().includes('Your WhatsApp is unlinked.'));
  } finally { await v.unmount(); }
  const broken = { unlinkWhatsApp: async () => { throw new Error('boom_code'); } };
  const w = await mount(h(WhatsAppWayBSection, { read: ready({ link: LINK }), api: broken, onChanged() {}, now: NOW }));
  try {
    await w.click('button-way-b-unlink');
    assert.ok(w.text().includes('Axal could not unlink your WhatsApp. Try again in a minute.'));
    assert.ok(w.by('button-way-b-unlink'), 'still linked');
  } finally { await w.unmount(); }
});

// ================================================================ the API methods (D527)

test('channelsApi: the four way-B methods hit wb1\'s paths and methods', async () => {
  const seen = [];
  const restoreDoc = installDocument();
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => { seen.push([String(url).replace(/^.*\/api/, ''), opts.method || 'GET']); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    await channelsApi.whatsappLink();
    await channelsApi.whatsappLinkView();
    await channelsApi.confirmWhatsAppLink('cl/1');
    await channelsApi.unlinkWhatsApp();
  } finally { globalThis.fetch = prev; restoreDoc(); }
  assert.deepEqual(seen, [
    ['/channels/whatsapp/link', 'POST'],
    ['/channels/whatsapp/link', 'GET'],
    ['/channels/whatsapp/link/cl%2F1/confirm', 'POST'],
    ['/channels/whatsapp/link', 'DELETE'],
  ]);
});

// ================================================================ the page and Record a Session

test('WhatsApp\'s page mounts the section in way B\'s slot, below way A; Telegram\'s page does not', () => {
  const o = readOverview({ providers: [{ provider: 'whatsapp', available: true, missing: [] }, { provider: 'telegram', available: true }], connections: {}, pending: {} });
  const page = (key) => renderToStaticMarkup(h(MemoryRouter, null, h(ChannelPageView, { channels: { status: 'ready', overview: o, reload() {} }, channelKey: key, user: MEMBER, api: {} })));
  const s = page('whatsapp');
  assert.ok(s.indexOf('data-testid="whatsapp-way-b"') > s.indexOf('data-testid="whatsapp-way-a"'));
  assert.ok(!page('telegram').includes('data-testid="whatsapp-way-b"'));
});

test('"From WhatsApp": the three steps, 5 MB, the consent line and a link to WhatsApp\'s page; off says so', () => {
  const entry = (read) => renderToStaticMarkup(h(MemoryRouter, null, h(WhatsAppEntry, { read })));
  const s = entry(ready({}));
  for (const step of WHATSAPP_ENTRY_STEPS) assert.ok(s.includes(step), step);
  assert.equal(WHATSAPP_ENTRY_STEPS.length, 3);
  assert.ok(s.includes(WHATSAPP_ENTRY_LIMIT) && WHATSAPP_ENTRY_LIMIT.includes('5 MB'));
  assert.ok(s.includes(WHATSAPP_ENTRY_CONSENT) && WHATSAPP_ENTRY_CONSENT === 'Everyone you recorded must have agreed before you recorded.');
  assert.ok(s.includes(`href="${WHATSAPP_PAGE_HREF}"`));
  const linked = entry(ready({ link: LINK }));
  assert.ok(linked.includes('Linked: •••• 1234') && !linked.includes(`href="${WHATSAPP_PAGE_HREF}"`));
  const offline = entry({ status: 'error', error: off() });
  assert.ok(offline.includes('data-testid="whatsapp-entry-off"') && !offline.includes(WHATSAPP_ENTRY_STEPS[0]));
  assert.ok(entry({ status: 'loading' }).includes('Reading your WhatsApp link'));
});

test('Record a Session: "Send it from WhatsApp" opens the entry beside Start and reads the link only then', async () => {
  let reads = 0;
  const channelsSource = { overview: async () => null, whatsappLinkView: async () => { reads += 1; return { claim: null, link: null }; } };
  const models = { live: [], final: [], defaults: { live: null, final: null } };
  const el = h(ActiveCompanyContext.Provider, { value: { company: { company_name: 'Acme Robotics' } } },
    h(RecordLightbox, { projectId: 1, interview: { id: 1, interviewee_name: 'Ana' }, initialModels: models, initialBoard: { hypotheses: [] }, channels: null, channelsSource, onClose() {}, onStarted() {} }));
  const m = await mount(el);
  try {
    assert.equal(m.by('whatsapp-entry'), undefined, 'a secondary link: nothing is open until it is pressed');
    assert.equal(reads, 0, 'no read before it is opened');
    assert.equal(m.props(m.by('record-whatsapp-link'))['aria-controls'], 'record-whatsapp');
    await m.click('record-whatsapp-link');
    assert.equal(reads, 1);
    assert.ok(m.by('whatsapp-entry'));
    assert.ok(m.by('record-start'), 'beside Start, not instead of it');
    assert.ok(m.text().includes(WHATSAPP_ENTRY_CONSENT));
  } finally { await m.unmount(); }
});
