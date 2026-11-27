/**
 * D756 (#1895) — "Telegram Business bot (interviews)" on /admin/telegram.
 *
 *   · the client: the health read and the register POST hit the Worker's admin path;
 *   · the words: every issue code has its sentence, an unknown code gets the
 *     generic one (never the code), "not configured" names the secrets;
 *   · who sees it: a Super Admin gets the section and its one read; a plain
 *     admin gets the page as before, with no request made;
 *   · Register webhook posts, then reads again; a refusal shows the Worker's sentence;
 *   · no HTML is built from Telegram's text.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/telegram_bot_health_d756.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { adminTelegram, channelsAdminApi } from '../src/lib/api.js';
import AdminTelegram from '../src/pages/admin/AdminTelegram.jsx';
import {
  ISSUE_TEXT, READY_TEXT, UNKNOWN_ISSUE_TEXT, healthLines, notConfiguredText,
} from '../src/pages/admin/telegramBotHealth.js';

const SUPER = { id: 1, role: 'admin', is_super_admin: 1 };
const PLAIN = { id: 2, role: 'admin', is_super_admin: 0 };
const READY = {
  configured: true, ready: true, issues: [],
  bot: { reachable: true, business_mode: true, username_matches: true, separate_from_news_bot: true },
  webhook: { reachable: true, registered: true, url_matches: true, pending_update_count: 0, last_error_at: null, last_error: null, allowed_updates_match: true },
  checked_at: '2026-10-18T14:05:00.000Z',
};

// ------------------------------------------------------------------ the client

test('the client: GET and POST /admin/channels/telegram/webhook, the POST with {}', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ method: init.method || 'GET', path: String(url).replace(/^.*\/api/, ''), body: init.body ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await channelsAdminApi.telegramHealth();
    await channelsAdminApi.registerTelegramWebhook();
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['GET /admin/channels/telegram/webhook', 'POST /admin/channels/telegram/webhook']);
  assert.deepEqual(calls[1].body, {});
});

// ------------------------------------------------------------------ the words

test('the words: ready, each issue, an unknown code, not configured, and the backlog', () => {
  assert.deepEqual(healthLines(READY), [{ tone: 'ok', text: READY_TEXT }]);
  assert.equal(READY_TEXT, 'Ready. Business Mode is on, the username matches, and Telegram sends this bot’s updates to axal.vc.');
  for (const [code, text] of Object.entries(ISSUE_TEXT)) {
    const lines = healthLines({ ...READY, ready: false, issues: [code] });
    assert.deepEqual(lines, [{ tone: 'bad', text }], code);
  }
  assert.equal(ISSUE_TEXT.business_mode_off, 'Business Mode is off for this bot. Turn it on in @BotFather › Bot Settings › Business Mode. Until then, members cannot add the bot in Telegram Business.');
  assert.equal(ISSUE_TEXT.webhook_unregistered, 'No webhook is registered, so Telegram sends Axal nothing. Press Register webhook.');

  const unknown = healthLines({ ...READY, ready: false, issues: ['brand_new_code'] });
  assert.deepEqual(unknown, [{ tone: 'bad', text: UNKNOWN_ISSUE_TEXT }]);
  assert.ok(!JSON.stringify(unknown).includes('brand_new_code'), 'never the raw code');

  const off = healthLines({ configured: false, missing: ['TELEGRAM_CHANNEL_BOT_TOKEN', 'TELEGRAM_CHANNEL_WEBHOOK_SECRET'] });
  assert.equal(off[0].text, 'Not switched on. The Worker is missing: TELEGRAM_CHANNEL_BOT_TOKEN, TELEGRAM_CHANNEL_WEBHOOK_SECRET. The owner sets them with wrangler secret put (PRODUCTION.md §4).');
  assert.equal(notConfiguredText(['TELEGRAM_CHANNEL_BOT_USERNAME']), 'Not switched on. The Worker is missing: TELEGRAM_CHANNEL_BOT_USERNAME. The owner sets them with wrangler secret put (PRODUCTION.md §4).');

  const delivery = healthLines({ ...READY, ready: false, issues: ['delivery_error'], webhook: { ...READY.webhook, last_error_at: '2026-10-18T14:00:00.000Z', last_error: 'Wrong response from the webhook: 401 Unauthorized' } });
  assert.equal(delivery.length, 1);
  assert.match(delivery[0].text, /^Telegram last failed to deliver an update to Axal at .+: “Wrong response from the webhook: 401 Unauthorized”\.$/);
  assert.equal(delivery[0].tone, 'bad');

  assert.deepEqual(healthLines({ ...READY, webhook: { ...READY.webhook, pending_update_count: 0 } }), [{ tone: 'ok', text: READY_TEXT }], 'a backlog of 0 says nothing');
  const backlog = healthLines({ ...READY, webhook: { ...READY.webhook, pending_update_count: 3 } });
  assert.deepEqual(backlog[1], { tone: 'warn', text: '3 updates are waiting at Telegram.' });
});

// ------------------------------------------------------------------ the page

const ORIGINAL = { health: channelsAdminApi.telegramHealth, register: channelsAdminApi.registerTelegramWebhook, list: adminTelegram.listChannels };
function stub({ health = async () => READY, register = async () => ({ ok: true, url: 'https://axal.vc/api/channels/telegram/webhook' }) } = {}) {
  const calls = [];
  channelsAdminApi.telegramHealth = (...a) => { calls.push('health'); return health(...a); };
  channelsAdminApi.registerTelegramWebhook = (...a) => { calls.push('register'); return register(...a); };
  adminTelegram.listChannels = async () => ({ channels: [] });
  return calls;
}
const restore = () => {
  channelsAdminApi.telegramHealth = ORIGINAL.health;
  channelsAdminApi.registerTelegramWebhook = ORIGINAL.register;
  adminTelegram.listChannels = ORIGINAL.list;
};
async function page(user, answers) {
  const calls = stub(answers);
  const v = await mountContracts(React.createElement(AuthProvider, null, React.createElement(AdminTelegram)), '/admin/telegram', user);
  await v.flush();
  await v.flush();
  return { v, calls };
}
const testIds = (v) => v.nodes().map((n) => v.props(n)?.['data-testid']).filter(Boolean);

test('who sees it: a Super Admin gets the section and one read; a plain admin gets the page as before, with no request', async () => {
  const sup = await page(SUPER);
  try {
    assert.ok(testIds(sup.v).includes('telegram-bot-health'));
    assert.match(sup.v.text(), /Telegram Business bot \(interviews\)/);
    assert.match(sup.v.text(), /It is a different bot from the news bot this page manages below\./);
    assert.ok(sup.v.text().includes(READY_TEXT));
    assert.deepEqual(sup.calls, ['health']);
    assert.match(sup.v.text(), /Manage the public @axalvc channel/);
  } finally { await sup.v.unmount(); restore(); }

  const plain = await page(PLAIN);
  try {
    assert.ok(!testIds(plain.v).includes('telegram-bot-health'));
    assert.doesNotMatch(plain.v.text(), /Telegram Business bot/);
    assert.deepEqual(plain.calls, [], 'no request for a plain admin');
    assert.match(plain.v.text(), /Manage the public @axalvc channel/);
    const tabs = plain.v.nodes().filter((n) => n.tagName === 'BUTTON').map((n) => plain.v.props(n).children);
    for (const t of ['Channels', 'Drafts', 'Compose', 'History']) assert.ok(tabs.includes(t), `the news tab ${t} is unchanged`);
  } finally { await plain.v.unmount(); restore(); }
});

test('not configured: the 503\'s secret names are drawn as "Not switched on"', async () => {
  const err = Object.assign(new Error('This channel is not set up on Axal yet.'), {
    code: 'not_configured', data: { code: 'not_configured', configured: false, missing: ['TELEGRAM_CHANNEL_BOT_TOKEN'] },
  });
  const { v } = await page(SUPER, { health: async () => { throw err; } });
  try {
    assert.ok(v.text().includes(notConfiguredText(['TELEGRAM_CHANNEL_BOT_TOKEN'])));
  } finally { await v.unmount(); restore(); }
});

test('Register webhook posts, says the address, then reads again; a refusal shows the Worker\'s sentence', async () => {
  const { v, calls } = await page(SUPER, { health: async () => ({ ...READY, ready: false, issues: ['webhook_unregistered'] }) });
  try {
    assert.ok(v.text().includes(ISSUE_TEXT.webhook_unregistered));
    await v.click('Register webhook');
    await v.flush();
    assert.deepEqual(calls, ['health', 'register', 'health']);
    assert.match(v.text(), /Webhook registered at https:\/\/axal\.vc\/api\/channels\/telegram\/webhook\./);
  } finally { await v.unmount(); restore(); }

  const refused = await page(SUPER, { register: async () => { throw Object.assign(new Error('SENTINEL-WORKER-SENTENCE'), { code: 'secret_format' }); } });
  try {
    await refused.v.click('Register webhook');
    await refused.v.flush();
    assert.ok(refused.v.nodes().some((n) => refused.v.props(n)?.role === 'alert' && refused.v.props(n)?.children === 'SENTINEL-WORKER-SENTENCE'));
  } finally { await refused.v.unmount(); restore(); }
});

test('Telegram\'s error text is drawn as text: no HTML in either new file', () => {
  for (const f of ['frontend/src/pages/admin/TelegramBotHealth.jsx', 'frontend/src/pages/admin/telegramBotHealth.js']) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /dangerouslySetInnerHTML|innerHTML/, f);
  }
});
