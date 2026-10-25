/**
 * D863 (#2509) — the Telegram setup read for Record a Session: six steps, each
 * from stored rows, for a member at every step; the canary gate the link route
 * has; no Telegram call; nothing beyond the member's own @username.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/telegram_setup_d863.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SETUP_ACTIONS, SETUP_STEPS, TELEGRAM_PREMIUM_LINE } from '../src/services/channels/telegramSetup.ts';
import {
  ADMIN, ME, OTHER, TG_ME, businessMessage, call, confirmUpdate, mockFetch, noSecretsSeen, seen, startUpdate, tgHook, world,
} from './_channels_fixture.ts';

test.afterEach(() => { noSecretsSeen(); seen.length = 0; });

/** The setup read, with Telegram's API mocked so any call is counted. */
async function setup(env: any, user = ME, role = 'founder') {
  const f = mockFetch(() => undefined);
  try {
    const r = await call(env, user, 'GET', '/telegram/setup', undefined, role);
    assert.equal(f.calls.length, 0, 'the setup read never calls Telegram');
    return r;
  } finally { f.restore(); }
}
const states = (body: any) => body.steps.map((s: any) => `${s.key}:${s.state}:${s.code}`);

test('step 1: a member with nothing linked is at step 1, and every step after it waits', async () => {
  const { env } = await world();
  const r = await setup(env);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.steps.map((s: any) => [s.step, s.key]), SETUP_STEPS.map((k, i) => [i + 1, k]));
  assert.deepEqual(states(r.body), [
    'linked:todo:not_linked', 'bot_added:blocked:needs_link', 'bot_enabled:blocked:needs_link',
    'replies_allowed:blocked:needs_link', 'first_chat:blocked:needs_link', 'consent_notice:done:notice_ready',
  ]);
  assert.deepEqual([r.body.next, r.body.ready, r.body.account], ['linked', false, null]);
  assert.equal(r.body.steps[0].action, SETUP_ACTIONS.not_linked);
  assert.equal(r.body.steps[5].action, null, 'a done step has nothing to do');
  assert.deepEqual(r.body.prerequisites, [{ key: 'telegram_premium', required: true, state: null, line: TELEGRAM_PREMIUM_LINE }]);
});

test('step 1 in progress: the claim waits for /confirm in Telegram, then for Axal\'s Confirm', async () => {
  const { env } = await world();
  const f = mockFetch(() => ({ json: { ok: true, result: { message_id: 1, date: 1 } } }));
  let code: string;
  try {
    code = (await call(env, ME, 'POST', '/telegram/link')).body.code;
    await tgHook(env, startUpdate(code));
  } finally { f.restore(); }
  let r = await setup(env);
  assert.deepEqual([r.body.steps[0].state, r.body.steps[0].code], ['todo', 'link_waiting_telegram']);
  const g = mockFetch(() => ({ json: { ok: true, result: { message_id: 2, date: 1 } } }));
  try { await tgHook(env, confirmUpdate()); } finally { g.restore(); }
  r = await setup(env);
  assert.deepEqual([r.body.steps[0].state, r.body.steps[0].code], ['todo', 'link_waiting_axal']);
  assert.equal(r.body.steps[0].action, SETUP_ACTIONS.link_waiting_axal);
});

/** A linked member (the fixture's own row) with the business connection as given, or none. */
async function linked(bc: { enabled: number; reply: number } | null) {
  const w = await world({ seed: true });
  if (!bc) w.db.exec(`DELETE FROM telegram_business_connections`);
  else w.db.exec(`UPDATE telegram_business_connections SET is_enabled = ${bc.enabled}, can_reply = ${bc.reply}`);
  return w;
}

test('step 2: linked, the bot not yet added in Telegram Business', async () => {
  const { env } = await linked(null);
  const r = await setup(env);
  assert.deepEqual(states(r.body).slice(0, 5), [
    'linked:done:linked', 'bot_added:todo:bot_not_added', 'bot_enabled:blocked:needs_bot',
    'replies_allowed:blocked:needs_bot', 'first_chat:blocked:needs_bot',
  ]);
  assert.equal(r.body.next, 'bot_added');
  assert.equal(r.body.account, '@dana_biz', 'the member\'s own @username');
  assert.match(r.body.steps[1].action, /Telegram › Settings › Telegram Business › Chatbots/);
});

test('step 3: a bot switched off in Telegram', async () => {
  const { env } = await linked({ enabled: 0, reply: 1 });
  const r = await setup(env);
  assert.deepEqual(states(r.body).slice(1, 5), [
    'bot_added:done:bot_added', 'bot_enabled:todo:bot_switched_off', 'replies_allowed:blocked:needs_bot_on', 'first_chat:blocked:needs_bot_on',
  ]);
  assert.equal(r.body.next, 'bot_enabled');
});

test('step 4: switched on without the right to reply', async () => {
  const { env } = await linked({ enabled: 1, reply: 0 });
  const r = await setup(env);
  assert.deepEqual(states(r.body).slice(2, 5), ['bot_enabled:done:bot_enabled', 'replies_allowed:todo:no_reply_right', 'first_chat:todo:no_chat_yet']);
  assert.equal(r.body.next, 'replies_allowed');
});

test('step 5: everything allowed, no chat in yet; then a customer writes and every step is done', async () => {
  const { env } = await linked({ enabled: 1, reply: 1 });
  let r = await setup(env);
  assert.deepEqual([r.body.steps[4].state, r.body.steps[4].code, r.body.next], ['todo', 'no_chat_yet', 'first_chat']);
  const f = mockFetch(() => ({ json: { ok: true, result: { message_id: 3, date: 1 } } }));
  try { assert.equal((await tgHook(env, businessMessage('BC-ME'))).status, 200); } finally { f.restore(); }
  r = await setup(env);
  assert.deepEqual(states(r.body), [
    'linked:done:linked', 'bot_added:done:bot_added', 'bot_enabled:done:bot_enabled',
    'replies_allowed:done:replies_allowed', 'first_chat:done:chat_received', 'consent_notice:done:notice_ready',
  ]);
  assert.deepEqual([r.body.next, r.body.ready], [null, true]);
  for (const s of r.body.steps) assert.equal(s.action, null);
  // Nothing about the contact or the connection leaves: no name, chat id, connection id or Telegram id.
  const whole = JSON.stringify(r.body);
  for (const leak of ['Sam', 'Okafor', '8001', 'BC-ME', TG_ME, 'reconcile']) assert.ok(!whole.includes(leak), leak);
});

test('a chat that already arrived still counts once the bot is switched off; an ignored one does not', async () => {
  const { env, db } = await linked({ enabled: 1, reply: 1 });
  const f = mockFetch(() => ({ json: { ok: true, result: { message_id: 4, date: 1 } } }));
  try { await tgHook(env, businessMessage('BC-ME')); } finally { f.restore(); }
  db.exec(`UPDATE telegram_business_connections SET is_enabled = 0`);
  let r = await setup(env);
  assert.deepEqual([r.body.steps[4].state, r.body.next], ['done', 'bot_enabled']);
  db.exec(`UPDATE channel_threads SET status = 'ignored'`);
  r = await setup(env);
  assert.deepEqual([r.body.steps[4].state, r.body.steps[4].code], ['blocked', 'needs_bot_on']);
});

test('step 6: with no https base URL there is no notice link, so the notice step is blocked, even with steps 1 to 5 done', async () => {
  const { env } = await linked({ enabled: 1, reply: 1 });
  const f = mockFetch(() => ({ json: { ok: true, result: { message_id: 5, date: 1 } } }));
  try { await tgHook(env, businessMessage('BC-ME')); } finally { f.restore(); }
  const r = await setup({ ...env, PUBLIC_BASE_URL: '', APP_URL: 'http://axal.vc' });
  assert.deepEqual(r.body.steps.slice(0, 5).map((s: any) => s.state), ['done', 'done', 'done', 'done', 'done']);
  assert.deepEqual([r.body.steps[5].state, r.body.steps[5].code, r.body.steps[5].action], ['blocked', 'notice_link_missing', SETUP_ACTIONS.notice_link_missing]);
  assert.deepEqual([r.body.next, r.body.ready], ['consent_notice', false]);
});

test('a business connection still carrying the member after the link ended is not read: back at step 1', async () => {
  const { env, db } = await linked({ enabled: 1, reply: 1 });
  db.exec(`UPDATE integrations SET status = 'disconnected' WHERE provider_key = 'telegram'`);
  const r = await setup(env);
  assert.deepEqual(states(r.body).slice(0, 4), [
    'linked:todo:not_linked', 'bot_added:blocked:needs_link', 'bot_enabled:blocked:needs_link', 'replies_allowed:blocked:needs_link',
  ]);
});

test('disconnecting the account puts the member back at step 1', async () => {
  const { env } = await linked({ enabled: 1, reply: 1 });
  assert.equal((await setup(env)).body.next, 'first_chat');
  const f = mockFetch(() => ({ json: { ok: true, result: true } }));
  try { assert.equal((await call(env, ME, 'DELETE', '/telegram')).status, 200); } finally { f.restore(); }
  const r = await setup(env);
  assert.deepEqual(states(r.body).slice(0, 5), [
    'linked:todo:not_linked', 'bot_added:blocked:needs_link', 'bot_enabled:blocked:needs_link',
    'replies_allowed:blocked:needs_link', 'first_chat:blocked:needs_link',
  ]);
  assert.equal(r.body.account, null);
});

test('only a @username is repeated; a display name is not', async () => {
  const { env, db } = await linked({ enabled: 1, reply: 1 });
  db.exec(`UPDATE integrations SET external_account_name = 'Dana Ruiz' WHERE provider_key = 'telegram'`);
  assert.equal((await setup(env)).body.account, null);
});

test('the canary: a member outside it gets the same refusal as POST /telegram/link; a Super Admin reads it', async () => {
  const { env, db } = await world({ seed: true });
  const canary = { ...env, TELEGRAM_CHANNEL: 'canary' };
  const f = mockFetch(() => undefined);
  try {
    const link = await call(canary, ME, 'POST', '/telegram/link');
    const r = await call(canary, ME, 'GET', '/telegram/setup');
    assert.equal(link.status, 503);
    assert.deepEqual([r.status, r.body], [link.status, link.body]);
    const off = await call({ ...env, TELEGRAM_CHANNEL: 'off' }, ME, 'GET', '/telegram/setup');
    assert.deepEqual([off.status, off.body.code], [503, 'not_available']);
    // Secrets unset: not available either, as for the link.
    const unset = await call({ ...env, TELEGRAM_CHANNEL_BOT_TOKEN: '' }, ME, 'GET', '/telegram/setup');
    assert.deepEqual([unset.status, unset.body.code], [503, 'not_available']);
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
  db.exec(`UPDATE users SET role = 'admin', is_super_admin = 1 WHERE id = ${ADMIN}`);
  assert.equal((await setup(canary, ADMIN, 'admin')).status, 200, 'a Super Admin is inside the canary');
  // A member who cannot hold a venture is answered as if the channel did not exist, as the link route does.
  db.exec(`UPDATE users SET role = 'investor' WHERE id = ${OTHER}`);
  const investor = await call(env, OTHER, 'GET', '/telegram/setup', undefined, 'investor');
  const investorLink = await call(env, OTHER, 'POST', '/telegram/link', undefined, 'investor');
  assert.deepEqual([investor.status, investor.body], [investorLink.status, investorLink.body]);
  assert.equal(investor.status, 404);
});

test('signed out is refused', async () => {
  const { env } = await world();
  const { send } = await import('./_channels_fixture.ts');
  assert.equal((await send(env, '/api/channels/telegram/setup', { method: 'GET' })).status, 401);
});
