/**
 * D3678 (#3678): the bot signs in to its own Google account, then joins Meet
 * signed in. On the constructed fixtures (UNVERIFIED, see signin.ts):
 * - the sign-in, then the signed-in pre-join (no guest name typed), then Ask to join;
 * - the authenticator chosen through "Try another way";
 * - a refused code retried once with the next one;
 * - each failure code, as `platform_blocked@<code>` on the run;
 * - a session Google did not keep (`signin_not_kept`);
 * - no account set up: today's guest join;
 * - no log line carries the email, the password or a code;
 * - the Worker callback source: signed, 404 unconfigured → guest, a code near its end waits for the next.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MeetAdapter } from '../src/adapters/meet.ts';
import { meetCredentials, signInScreen, SIGNIN_HOOKS, type SignInHook, type SignInSource } from '../src/adapters/meet/signin.ts';
import { AdapterFailure } from '../src/types.ts';
import { runBot } from '../src/lifecycle.ts';
import { BOT_NAME, FREE_LIMIT_MS } from '../src/constants.ts';
import { joinStop } from '../src/diagnose.ts';
import { StubCallback } from './_harness.ts';
import { NO_BROWSER, withSignInPages } from './_meet_browser.ts';

const skip = NO_BROWSER || false;
const SIGNED = 'https://meet.google.com/prejoin_signed_in-abcd-efg';
const GUEST = 'https://meet.google.com/prejoin-abcd-efg';
const fast = { pollMs: 25, stepTimeoutMs: 3000 };
const never = new AbortController().signal;
// Synthetic: no real account.
const EMAIL = 'bot@example.test', PASSWORD = 'synthetic-password-not-real';

function source(codes = ['123456', '654321'], account: { email: string; password: string } | null = { email: EMAIL, password: PASSWORD }) {
  const asked = { account: 0, code: 0 };
  const src: SignInSource = {
    account: async () => { asked.account += 1; return account; },
    code: async () => { asked.code += 1; return codes[Math.min(asked.code - 1, codes.length - 1)]; },
  };
  return { src, asked };
}
function logged() {
  const lines: string[] = [];
  return { lines, log: (event: string, fields: Record<string, unknown>) => { lines.push(JSON.stringify({ event, ...fields })); } };
}
const typed = (raw: any) => raw.evaluate(() => (globalThis as any).__signin?.log ?? null);

test('the bot signs in, then joins signed in: no guest name, microphone and camera off, Ask to join', { skip }, async () => {
  await withSignInPages('ok', async (page, raw) => {
    const { src, asked } = source();
    const { lines, log } = logged();
    let signinLog: any = null;
    raw.on('framenavigated', async () => { /* the sign-in page is gone once Meet opens */ });
    const bot = new MeetAdapter(page, { ...fast, signIn: src, log });
    // Read what was typed before Google's continue leaves the page.
    raw.on('request', (r: any) => { if (r.url().startsWith('https://meet.google.com/landing')) signinLog = 'left'; });
    await bot.join({ url: SIGNED, botName: BOT_NAME, signal: never });
    assert.equal(bot.signedIn, true);
    assert.deepEqual(asked, { account: 1, code: 1 });
    assert.equal(signinLog, 'left', 'Google sent the bot on to Meet');
    const meet = await raw.evaluate(() => (globalThis as any).__meet.log);
    assert.deepEqual([meet.name, meet.mic, meet.camera, meet.asked], [null, 'off', 'off', 'ask'], 'no guest name is typed when signed in');
    assert.equal(await bot.state(), 'lobby');
    const all = lines.join('\n');
    for (const secret of [EMAIL, PASSWORD, '123456']) assert.ok(!all.includes(secret), 'no secret in any log line');
    assert.ok(lines.some((l) => l.includes('meet_signin_done')));
  });
});

test('what the bot types: the email, the password, the code, each in its own field', { skip }, async () => {
  await withSignInPages('code_refused', async (page, raw) => {
    const { src } = source(['111111', '222222']);
    const bot = new MeetAdapter(page, { ...fast, signIn: src });
    await assert.rejects(bot.join({ url: SIGNED, botName: BOT_NAME, signal: never }), (e: any) => e instanceof AdapterFailure && e.detail === 'signin_code_refused');
    assert.deepEqual(await typed(raw), { email: EMAIL, password: PASSWORD, codes: ['111111', '222222'] }, 'a refused code is retried once with the next one, then the run stops');
  });
});

test('a refused code at a step boundary: the next code signs in', { skip }, async () => {
  await withSignInPages('code_once', async (page) => {
    const { src, asked } = source();
    const bot = new MeetAdapter(page, { ...fast, signIn: src });
    await bot.join({ url: SIGNED, botName: BOT_NAME, signal: never });
    assert.equal(bot.signedIn, true);
    assert.equal(asked.code, 2);
  });
});

test('"Try another way": the bot picks the authenticator app, then types the code', { skip }, async () => {
  await withSignInPages('ok_method', async (page) => {
    const { src } = source();
    const bot = new MeetAdapter(page, { ...fast, signIn: src });
    await bot.join({ url: SIGNED, botName: BOT_NAME, signal: never });
    assert.equal(bot.signedIn, true);
  });
});

test('a session Google kept: no email asked, straight to Meet', { skip }, async () => {
  await withSignInPages('session_alive', async (page) => {
    const { src, asked } = source();
    const bot = new MeetAdapter(page, { ...fast, signIn: src });
    await bot.join({ url: SIGNED, botName: BOT_NAME, signal: never });
    assert.equal(bot.signedIn, true);
    assert.equal(asked.code, 0);
  });
});

test('each failure has its own code, on the run as platform_blocked@<code>', { skip }, async () => {
  // Mutation checked: the `challenge_text` hook not read → Google's "Verify it's you" reads signin_unknown_page.
  // Mutation checked: lifecycle's join failure without the adapter's detail → the run reads its last step, not the code.
  const cases: Array<[string, string]> = [
    ['bad_email', 'signin_rejected'],
    ['bad_password', 'signin_rejected'],
    ['challenge', 'signin_challenged'],
    ['code_refused', 'signin_code_refused'],
    ['no_method', 'signin_no_code_method'],
    ['unknown_after_password', 'signin_unknown_page'],
  ];
  for (const [scenario, detail] of cases) {
    await withSignInPages(scenario, async (page) => {
      const { src } = source();
      const cb = new StubCallback();
      const bot = new MeetAdapter(page, { ...fast, stepTimeoutMs: 1500, signIn: src });
      const result = await runBot({ runId: '00000000-0000-4000-8000-000000000001', platform: 'google_meet', meetingUrl: SIGNED, notice: 'n', limitMs: FREE_LIMIT_MS,
        deadlineAt: Date.now() + 600_000, budgetDeadlineAt: Date.now() + 600_000 }, { adapter: bot, transport: cb } as any).catch((e) => e);
      const failed = cb.statuses?.find((s: any) => s.state === 'failed') ?? result;
      assert.equal(failed.code, 'platform_blocked', scenario);
      assert.equal(failed.detail, detail, scenario);
      // The owner diagnostic's join row reads the same code.
      assert.equal(joinStop(new AdapterFailure('platform_blocked', detail), bot.diagnostic()), detail);
    });
  }
});

test('signed in, but Meet shows the guest name field: the session was not kept (signin_not_kept)', { skip }, async () => {
  await withSignInPages('ok', async (page, raw) => {
    const { src } = source();
    const bot = new MeetAdapter(page, { ...fast, signIn: src });
    await assert.rejects(bot.join({ url: GUEST, botName: BOT_NAME, signal: never }), (e: any) => e instanceof AdapterFailure && e.code === 'platform_blocked' && e.detail === 'signin_not_kept');
    assert.equal((await raw.evaluate(() => (globalThis as any).__meet.log)).name, null, 'it never typed a guest name over a lost session');
  });
});

test('no account set up: the bot joins as a guest, as before', { skip }, async () => {
  await withSignInPages('ok', async (page, raw) => {
    const { src, asked } = source(undefined, null);
    const bot = new MeetAdapter(page, { ...fast, signIn: src });
    await bot.join({ url: GUEST, botName: BOT_NAME, signal: never });
    assert.equal(bot.signedIn, false);
    assert.equal(asked.code, 0);
    assert.equal((await raw.evaluate(() => (globalThis as any).__meet.log)).name, BOT_NAME);
  });
});

test('the Worker source: signed requests, 404 unconfigured means a guest, a failure is signin_unavailable', async () => {
  const calls: Array<{ path: string; body: string; sig: string | null }> = [];
  let mode: 'ok' | 'unconfigured' | 'down' = 'ok';
  const fake = (async (input: any, init: any) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, body: init.body, sig: new Headers(init.headers).get('x-meeting-bot-signature') });
    if (mode === 'unconfigured') return Response.json({ code: 'meet_signin_unconfigured' }, { status: 404 });
    if (mode === 'down') return Response.json({ code: 'bot_meet_unavailable' }, { status: 503 });
    return init.body === '{}' ? Response.json({ email: EMAIL, password: PASSWORD }) : Response.json({ code: '123456', valid_ms: 20_000 });
  }) as typeof fetch;
  const src = meetCredentials({ origin: 'https://app.example.test', path: '/api/meeting-bots/00000000-0000-4000-8000-000000000001/meet-credentials', key: 'k'.repeat(64), fetch: fake });
  assert.deepEqual(await src.account(), { email: EMAIL, password: PASSWORD });
  assert.equal(await src.code(), '123456');
  assert.deepEqual(calls.map((c) => c.body), ['{}', '{"step":"code"}']);
  assert.ok(calls.every((c) => /^[a-f0-9]{64}$/.test(c.sig ?? '')), 'every request is signed');
  mode = 'unconfigured';
  assert.equal(await src.account(), null, 'no secrets: join as a guest');
  mode = 'down';
  await assert.rejects(src.account());
});

test('a code with under two seconds left is not typed: the source waits for the next one', async () => {
  let n = 0;
  const fake = (async () => { n += 1; return Response.json(n === 1 ? { code: '111111', valid_ms: 10 } : { code: '222222', valid_ms: 29_000 }); }) as typeof fetch;
  const src = meetCredentials({ origin: 'https://app.example.test', path: '/x', key: 'k'.repeat(64), fetch: fake });
  assert.equal(await src.code(), '222222');
  assert.equal(n, 2);
});

test('the Worker\'s answers never reach a log line, an error message or a failure detail', async () => {
  const { src } = source();
  const { lines, log } = logged();
  // A page that is already gone: the sign-in fails at once, with its code only.
  const page: any = { goto: async () => {}, locator: () => ({ first: () => ({ isVisible: async () => false, click: async () => {}, fill: async () => {} }) }), isClosed: () => true, url: () => 'https://accounts.google.com/' };
  const bot = new MeetAdapter(page, { ...fast, signIn: src, log });
  page.exposeFunction = async () => {}; page.addInitScript = async () => {};
  const err = await bot.join({ url: SIGNED, botName: BOT_NAME, signal: never }).catch((e) => e);
  assert.ok(err instanceof AdapterFailure);
  assert.equal(err.detail, 'signin_unknown_page');
  const text = [lines.join('\n'), String(err.message), String(err.detail)].join('\n');
  for (const secret of [EMAIL, PASSWORD]) assert.ok(!text.includes(secret));
});

test('every sign-in hook matches its fixture screen, and each screen reads as itself', { skip }, async () => {
  // One row per screen of fixtures/google_signin.html: the hooks it must show, and what signInScreen calls it.
  const screens: Array<[string, SignInHook[], string]> = [
    ['email', ['email_input', 'email_next'], 'email'],
    ['email_refused', ['email_refused'], 'email_refused'],
    ['password', ['password_input', 'password_next'], 'password'],
    ['password_refused', ['password_refused'], 'password_refused'],
    ['phone_prompt', ['another_way'], 'unknown'],
    ['methods', ['code_method'], 'choose_method'],
    ['code', ['code_input', 'code_next'], 'code'],
    ['code_refused', ['code_refused'], 'code_refused'],
    ['challenge', ['challenge_text'], 'challenge'],
  ];
  await withSignInPages('ok', async (page, raw) => {
    await raw.goto('https://accounts.google.com/ServiceLogin');
    for (const [state, hooks, read] of screens) {
      await raw.evaluate((s) => (globalThis as any).__signin.render(s), state);
      for (const hook of hooks) assert.equal(await raw.locator(SIGNIN_HOOKS[hook]).first().isVisible(), true, `${hook} on ${state}`);
      assert.equal(await signInScreen(page), read, state);
    }
  });
});
