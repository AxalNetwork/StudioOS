/**
 * D756 §1.11 (#1979) — Telegram Business on its own page,
 * `/account/connectors/telegram`, in every state: `telegramPageState` for a
 * member and for a Super Admin (the canary line, the missing secret names and
 * the bot's health with Register webhook are a Super Admin's only), and
 * `TelegramPageBody` in #1958's frame, drawn with the card's own parts.
 * `/account/connectors/telegram-business` lands on `telegram` with replace,
 * and the news-bot card stays on the hub. No test calls a provider.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/telegram_page_d756.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  SWITCHED_OFF_WHY, TELEGRAM_LIMITS, TELEGRAM_PAGE, UNAVAILABLE_WHY, readOverview, telegramPageState, telegramSteps,
} from '../src/pages/account/channelsModel.js';
import { accountPathFor, connectorKeyFor } from '../src/pages/account/accountPhone.js';
import { TelegramChannelCard, TelegramPageBody } from '../src/pages/account/ChannelsGroup.jsx';
import { ChannelPageView } from '../src/pages/account/ChannelPage.jsx';
import { CHANNEL_PAGE_TEXT } from '../src/pages/account/channelPageModel.js';

const h = React.createElement;
const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const flat = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const MEMBER = { id: 7, role: 'founder', is_super_admin: 0 };
const SUPER = { id: 1, role: 'admin', is_super_admin: 1 };
const MISSING = ['TELEGRAM_CHANNEL_BOT_TOKEN', 'TELEGRAM_CHANNEL_WEBHOOK_SECRET'];
const CONN = { status: 'active', external_account_name: '@dana_biz', business_connected: true, can_reply: true };
const CLAIM = { uid: 'claim-1', status: 'waiting_axal', display_name: 'Dana', username: '@dana', telegram_confirmed: true, axal_confirmed: false, expires_at: '2099-01-01T00:00:00Z' };

/** `GET /api/channels` as the Worker answers it (`rollout` to Super Admins, `missing` to admins). */
const overview = ({ available = true, missing = [], rollout, conn = null, link = null, pending = 0 } = {}) => readOverview({
  providers: [{ provider: 'telegram', available, missing, ...(rollout ? { rollout } : {}) }, { provider: 'whatsapp', available: false }],
  connections: conn ? { telegram: conn } : {},
  pending: { telegram: pending, whatsapp: 0 },
  ...(link ? { telegram_link: link } : {}),
});

// ================================================================ telegramPageState, one case per §1.11 row

test('unreadable: the read failed, for both', () => {
  for (const user of [MEMBER, SUPER]) {
    const v = telegramPageState(null, user);
    assert.equal(v.state, 'unreadable');
    assert.equal(v.pill.label, 'Status unreadable');
    assert.equal(v.why, 'Your connection could not be read. This is not a claim that you have none.');
  }
});

test('unavailable: Not available yet; the missing names and the health for a Super Admin only', () => {
  const o = overview({ available: false, missing: MISSING });
  const m = telegramPageState(o, MEMBER);
  assert.equal(m.state, 'unavailable');
  assert.equal(m.pill.label, 'Not available yet');
  assert.equal(m.why, UNAVAILABLE_WHY);
  assert.deepEqual(m.missing, []);
  assert.deepEqual(m.notices, []);
  assert.equal(m.health, false);
  const s = telegramPageState(o, SUPER);
  assert.equal(s.state, 'unavailable');
  assert.deepEqual(s.notices, [`${TELEGRAM_PAGE.missing} ${MISSING.join(', ')}`]);
  assert.equal(s.health, true);
  // An admin who is not a Super Admin is a member here.
  const admin = telegramPageState(o, { role: 'admin', is_super_admin: 0 });
  assert.deepEqual(admin.notices, []);
  assert.equal(admin.health, false);
});

test('canary: a member reads Not available yet with no Link; a Super Admin gets the canary line, then the states below', () => {
  const member = telegramPageState(overview({ available: false }), MEMBER);
  assert.equal(member.state, 'unavailable');
  const crafted = telegramPageState(overview({ rollout: 'canary' }), MEMBER);
  assert.equal(crafted.state, 'unavailable', 'a rollout a member somehow holds closes it');
  assert.deepEqual(crafted.notices, []);
  const s = telegramPageState(overview({ rollout: 'canary' }), SUPER);
  assert.deepEqual(s.notices, [TELEGRAM_PAGE.canary]);
  assert.equal(s.state, 'not_connected');
  assert.deepEqual(telegramPageState(overview({ rollout: 'on' }), SUPER).notices, []);
});

test('not connected, linking, linked', () => {
  const nc = telegramPageState(overview(), MEMBER);
  assert.equal(nc.state, 'not_connected');
  assert.equal(nc.pill.label, 'Not connected');
  const linking = telegramPageState(overview({ link: CLAIM }), MEMBER);
  assert.equal(linking.state, 'linking');
  assert.equal(linking.pill, null, '§1.11 draws no pill while linking');
  assert.equal(linking.flow, 'not_connected', 'the card\'s parts draw the claim');
  // An expired claim is not linking.
  assert.equal(telegramPageState(overview({ link: { ...CLAIM, status: 'expired' } }), MEMBER).state, 'not_connected');
  const linked = telegramPageState(overview({ conn: { ...CONN, business_connected: false } }), MEMBER);
  assert.equal(linked.state, 'linked');
  assert.equal(linked.pill.label, 'One step left');
  assert.equal(linked.why, TELEGRAM_PAGE.linked);
});

test('connected, with the reply-right note only when the bot cannot reply', () => {
  const c = telegramPageState(overview({ conn: CONN }), MEMBER);
  assert.equal(c.state, 'connected');
  assert.equal(c.pill.label, 'Connected');
  assert.equal(c.account, '@dana_biz');
  assert.equal(c.note, '');
  assert.equal(telegramPageState(overview({ conn: { ...CONN, can_reply: false } }), MEMBER).note, TELEGRAM_PAGE.cannotReply);
});

test('problem: a connection kept while Axal has it off, or one that needs the member', () => {
  const off = telegramPageState(overview({ available: false, conn: CONN }), MEMBER);
  assert.equal(off.state, 'problem');
  assert.equal(off.pill, null);
  assert.equal(off.why, SWITCHED_OFF_WHY);
  const revoked = telegramPageState(overview({ conn: { ...CONN, status: 'revoked' } }), MEMBER);
  assert.equal(revoked.state, 'problem');
  assert.match(revoked.why, /Telegram no longer accepts Axal’s access/);
});

// ================================================================ the body

const body = (o, user = MEMBER, extra = {}) => renderToStaticMarkup(h(MemoryRouter, null,
  h(TelegramPageBody, { view: telegramPageState(o, user), claim: o?.telegramLink ?? null, pending: o?.pending?.telegram ?? null, onChanged() {}, ...extra })));

test('each state draws its words with the card\'s own parts', () => {
  const nc = body(overview());
  assert.match(nc, /data-testid="telegram-page-body" data-state="not_connected"/);
  assert.ok(nc.includes('data-testid="button-link-telegram"'), 'Link Telegram');
  for (const st of telegramSteps(null)) assert.ok(flat(nc).includes(st), `the five steps: ${st}`);
  const linking = body(overview({ link: CLAIM }));
  assert.ok(linking.includes('data-testid="telegram-claim"'), 'the two-sided claim');
  assert.ok(linking.includes('data-testid="button-telegram-confirm"'));
  assert.equal(linking.includes('button-link-telegram'), false);
  const linked = body(overview({ conn: { ...CONN, business_connected: false } }));
  assert.ok(flat(linked).includes(TELEGRAM_PAGE.linked));
  for (const st of telegramSteps(null).slice(2)) assert.ok(flat(linked).includes(st), `steps 3 to 5: ${st}`);
  assert.ok(linked.includes('data-testid="button-telegram-check"'));
  const conn = body(overview({ conn: { ...CONN, can_reply: false }, pending: 2 }));
  assert.ok(flat(conn).includes('@dana_biz'));
  assert.ok(flat(conn).includes('2 conversations waiting'));
  assert.ok(conn.includes('data-testid="button-channel-test-telegram"'), 'Test');
  assert.ok(conn.includes('data-testid="button-channel-disconnect-telegram"'), 'Disconnect');
  assert.ok(flat(conn).includes(TELEGRAM_PAGE.cannotReply));
  const unavailable = body(overview({ available: false }));
  assert.ok(flat(unavailable).includes(UNAVAILABLE_WHY));
  assert.equal(unavailable.includes('button-link-telegram'), false);
  // An open claim is not drawn while Telegram is not switched on for this viewer.
  assert.equal(body(overview({ available: false, link: CLAIM })).includes('telegram-claim'), false);
  // The health is drawn only for a view that carries it: a member's body never draws it.
  const marker = h('p', { 'data-testid': 'health-marker' }, 'health');
  assert.equal(body(overview(), MEMBER, { health: marker }).includes('health-marker'), false);
  assert.ok(body(overview(), SUPER, { health: marker }).includes('health-marker'));
  const problem = body(overview({ available: false, conn: CONN }));
  assert.ok(flat(problem).includes(SWITCHED_OFF_WHY));
  assert.ok(problem.includes('data-testid="button-channel-disconnect-telegram"'));
  // The Premium line, in every state.
  for (const out of [nc, linking, linked, conn, unavailable, problem]) assert.ok(flat(out).includes(TELEGRAM_LIMITS[0]));
});

test('the hub card is the same parts, with no page-only steps', () => {
  const card = renderToStaticMarkup(h(MemoryRouter, null, h(TelegramChannelCard, { card: { provider: 'telegram', state: 'not_connected', label: 'Not connected', tone: 'neutral' } })));
  assert.ok(card.includes('data-testid="button-link-telegram"'));
  assert.equal(card.includes('data-testid="telegram-steps"'), false);
  assert.ok(card.includes('data-testid="telegram-limits"'));
});

// ================================================================ the page

const health = { telegramHealth: async () => ({ configured: true, ready: true, issues: [] }), registerTelegramWebhook: async () => ({ url: 'https://axal.vc/x' }) };
const page = (o, user) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/connectors/telegram'] },
  h(ChannelPageView, { channels: { status: 'ready', overview: o, reload() {} }, channelKey: 'telegram', user, adminApi: health })));

test('/account/connectors/telegram: the body in the frame; notices, health and Register webhook for a Super Admin only', () => {
  const o = overview({ rollout: 'canary', missing: MISSING });
  const s = page(o, SUPER);
  const connect = s.indexOf('data-testid="connector-page-connect"');
  assert.ok(connect > 0 && s.indexOf('data-testid="telegram-page-body"') > connect, 'the body is in Connect and manage');
  const notices = s.slice(s.indexOf('data-testid="connector-page-notices"'), connect);
  assert.ok(notices.includes(TELEGRAM_PAGE.canary));
  assert.ok(notices.includes(MISSING[0]));
  assert.ok(notices.indexOf(TELEGRAM_PAGE.canary) < notices.indexOf(TELEGRAM_PAGE.missing), '§1.11\'s order');
  assert.ok(s.includes('data-testid="telegram-bot-health"'), 'the bot\'s health');
  assert.ok(flat(s).includes('Register webhook'));
  for (const para of CHANNEL_PAGE_TEXT.telegram.about) assert.ok(flat(s).includes(para), `About: ${para.slice(0, 30)}`);
  const m = page(overview({ available: false, missing: MISSING }), MEMBER);
  assert.equal(m.includes('telegram-bot-health'), false);
  assert.equal(flat(m).includes('Register webhook'), false);
  assert.equal(m.includes('connector-page-notices'), false);
  for (const name of MISSING) assert.equal(m.includes(name), false, name);
  assert.equal(m.includes(TELEGRAM_PAGE.canary), false);
  assert.equal(m.includes('button-link-telegram'), false);
});

test('/account/connectors/telegram-business lands on telegram, with replace', () => {
  for (const p of ['/account/connectors/telegram-business', '/account/connectors/Telegram-Business', '/account/connectors/telegram-business/']) {
    assert.equal(connectorKeyFor(p), 'telegram', p);
  }
  for (const phone of [true, false]) assert.equal(accountPathFor({ section: 'connectors', phone, key: 'telegram' }), '/account/connectors/telegram');
  // The canonicalising effect rewrites the address with replace.
  assert.match(read('frontend/src/pages/SettingsPage.jsx'),
    /const want = accountPathFor\(\{ section: active, phone, key: connectorKey, usagePage \}\);\s*if \(location\.pathname !== want[^\n]*\n\s*navigate\(\{ pathname: want, search: location\.search, hash: location\.hash \}, \{ replace: true \}\);/);
  for (const p of ['/account/connectors/a-b', '/account/connectors/telegram-businesses']) assert.equal(connectorKeyFor(p), null, p);
});

test('the news-bot Community card is gone from Connectors (#2559)', () => {
  const src = read('frontend/src/pages/account/AccountConnectors.jsx');
  assert.equal(src.includes('function TelegramCard()'), false, 'the Community card component is removed');
  assert.equal(src.includes('Telegram · Axal VC channels'), false, 'its title is gone');
  assert.equal(src.includes('connector-community-telegram'), false, 'its test id is gone');
});
