/**
 * D3678 (#3678): the bot signs in to its own Google account before it opens
 * the meeting, so Meet sees a signed-in user ("Eadwyn AI (Axal VC)"), not an
 * anonymous guest a Workspace may refuse.
 *
 * THE FLOW, on accounts.google.com (the meeting link is never in it):
 *   email → Next → password → Next → [pick the authenticator] → code → Next → signed in.
 * Each step waits until the page shows one of the screens it knows, then acts.
 *
 * WHERE THE SECRETS COME FROM. `SignInSource` fetches them from the site
 * Worker over the run's signed callback (`meetCredentials` below). The email
 * and password come once; each code is asked for only when Google shows the
 * code field, and the TOTP key itself never reaches the container.
 *
 * EACH FAILURE HAS ITS OWN CODE, as `AdapterFailure('platform_blocked', <detail>)`,
 * so the run's `failure_detail` reads `platform_blocked@<detail>` (D1368):
 * - `signin_rejected`: Google refused the email or the password;
 * - `signin_challenged`: a captcha, "Verify it's you", or "this browser may not be secure";
 * - `signin_code_refused`: Google refused the two-step code (twice: a code at
 *   a step boundary gets one retry with the next one);
 * - `signin_no_code_method`: Google offered no authenticator code;
 * - `signin_unknown_page`: a sign-in screen none of the hooks match;
 * - `signin_unavailable`: the Worker did not answer with the account.
 *
 * PRIVACY (D886). Log lines are codes only (`logLine`). The email, password
 * and code are typed into the page and never logged, thrown or returned.
 *
 * UNVERIFIED: the hooks below follow Google's sign-in page as it is widely
 * documented (`identifier`, `Passwd`, `totpPin`, the `…Next` buttons), and
 * `test/fixtures/google_signin.html` is CONSTRUCTED to match them. The live
 * check (#3588's "Diagnose Eadwyn AI") confirms or corrects them; a hook that
 * stops matching reads `signin_unknown_page`, with a screenshot.
 */
import { AdapterFailure } from '../../types.ts';
import type { Clock, LogSink } from '../../types.ts';
import { logLine } from '../../log.ts';
import { signRequest } from '../../callback.ts';
import type { MeetPage } from './page.ts';

/** Google's sign-in page, with Meet as where it returns. No meeting link: the bot opens that after. */
export const SIGNIN_URL = 'https://accounts.google.com/ServiceLogin?hl=en&continue=https%3A%2F%2Fmeet.google.com%2F';

export const SIGNIN_HOOKS = {
  email_input: 'input[type="email"][name="identifier"], input#identifierId',
  email_next: '#identifierNext button',
  password_input: 'input[type="password"][name="Passwd"]',
  password_next: '#passwordNext button',
  code_input: 'input[name="totpPin"], input#totpPin',
  code_next: '#totpNext button',
  /** "Try another way" lists the methods; the authenticator app is challenge type 6. */
  code_method: '[data-challengetype="6"]',
  another_way: 'button:has-text("Try another way")',
  email_refused: 'text=/Couldn.t find your Google Account|Enter a valid email or phone number/i',
  password_refused: 'text=/Wrong password|Your password was changed/i',
  code_refused: 'text=/Wrong code|That code didn.t work|Wrong number of digits/i',
  // Two hooks: a Playwright selector list cannot mix CSS with the text engine.
  challenge: '#captchaimg, iframe[title*="reCAPTCHA"]',
  challenge_text: 'text=/Verify it.s you|This browser or app may not be secure|Couldn.t sign you in|unusual activity/i',
} as const;
export type SignInHook = keyof typeof SIGNIN_HOOKS;

/** The screens the flow knows, read in this order: a refusal or challenge wins over an input still drawn behind it. */
export type SignInScreen = 'email' | 'password' | 'code' | 'choose_method' | 'email_refused' | 'password_refused' | 'code_refused' | 'challenge' | 'signed_in' | 'unknown';

export interface SignInAccount { readonly email: string; readonly password: string }
/** Where the secrets come from. `account()` null: no account is set up, so the bot joins as a guest. */
export interface SignInSource {
  account(): Promise<SignInAccount | null>;
  code(): Promise<string>;
}

export const SIGNED_IN_HOSTS: ReadonlySet<string> = new Set(['meet.google.com', 'myaccount.google.com']);

export interface SignInOptions { readonly log: LogSink; readonly clock: Clock; readonly pollMs: number; readonly stepTimeoutMs: number; readonly signal?: AbortSignal }

const fail = (detail: string) => new AdapterFailure('platform_blocked', detail);

async function visible(page: MeetPage, hook: SignInHook): Promise<boolean> {
  try { return await page.locator(SIGNIN_HOOKS[hook]).first().isVisible(); } catch { return false; }
}

/** Which screen the page shows now: its host, then the hooks. Never its text beyond the hooks. */
export async function signInScreen(page: MeetPage): Promise<SignInScreen> {
  let host: string | null = null;
  try { host = page.url ? new URL(page.url()).hostname : null; } catch { host = null; }
  if (host && SIGNED_IN_HOSTS.has(host)) return 'signed_in';
  if (await visible(page, 'challenge') || await visible(page, 'challenge_text')) return 'challenge';
  if (await visible(page, 'email_refused')) return 'email_refused';
  if (await visible(page, 'password_refused')) return 'password_refused';
  if (await visible(page, 'code_refused')) return 'code_refused';
  if (await visible(page, 'code_input')) return 'code';
  if (await visible(page, 'code_method')) return 'choose_method';
  if (await visible(page, 'password_input')) return 'password';
  if (await visible(page, 'email_input')) return 'email';
  return 'unknown';
}

/**
 * Signs in on `page`. Resolves `true` once signed in, `false` when no account
 * is set up (the caller keeps the guest join). Throws `AdapterFailure` with
 * one of the codes above otherwise.
 */
export async function signIn(page: MeetPage, source: SignInSource, opts: SignInOptions): Promise<boolean> {
  let account: SignInAccount | null;
  try { account = await source.account(); } catch { logLine(opts.log, 'meet_signin_unavailable'); throw fail('signin_unavailable'); }
  if (!account) { logLine(opts.log, 'meet_signin_skipped'); return false; }
  logLine(opts.log, 'meet_signin_started');
  await page.goto(SIGNIN_URL, { waitUntil: 'domcontentloaded' });

  const wait = async (wanted: (s: SignInScreen) => boolean): Promise<SignInScreen> => {
    const until = opts.clock.now() + opts.stepTimeoutMs;
    for (;;) {
      if (page.isClosed()) throw fail('signin_unknown_page');
      if (opts.signal?.aborted) throw new Error('aborted');
      const s = await signInScreen(page);
      if (wanted(s) || opts.clock.now() >= until) return s;
      await opts.clock.sleep(opts.pollMs);
    }
  };
  const settle = (s: SignInScreen, step: string): never => {
    logLine(opts.log, `meet_signin_${step}_stopped`);
    if (s === 'challenge') throw fail('signin_challenged');
    if (s === 'email_refused' || s === 'password_refused') throw fail('signin_rejected');
    if (s === 'code_refused') throw fail('signin_code_refused');
    throw fail('signin_unknown_page');
  };
  const press = async (hook: SignInHook) => { await page.locator(SIGNIN_HOOKS[hook]).first().click(); };
  const type = async (hook: SignInHook, value: string) => { await page.locator(SIGNIN_HOOKS[hook]).first().fill(value); };

  // 1. The email. Google may skip it when a session is still alive.
  let s = await wait((x) => x === 'email' || x === 'signed_in' || x === 'challenge');
  if (s === 'email') {
    await type('email_input', account.email);
    await press('email_next');
    logLine(opts.log, 'meet_signin_email_sent');
    s = await wait((x) => x !== 'email' && x !== 'unknown');
  }
  // 2. The password.
  if (s === 'password') {
    await type('password_input', account.password);
    await press('password_next');
    logLine(opts.log, 'meet_signin_password_sent');
    s = await wait((x) => x !== 'password' && x !== 'unknown');
  }
  // 3. The method. When Google offers another one first ("Tap Yes on your phone"), ask for the authenticator.
  if (s === 'unknown' && await visible(page, 'another_way')) {
    await press('another_way');
    s = await wait((x) => x === 'choose_method' || x === 'code' || x === 'challenge');
    if (s === 'unknown') { logLine(opts.log, 'meet_signin_method_stopped'); throw fail('signin_no_code_method'); }
  }
  if (s === 'choose_method') {
    await press('code_method');
    logLine(opts.log, 'meet_signin_method_chosen');
    s = await wait((x) => x !== 'choose_method' && x !== 'unknown');
  }
  // 4. The code, with one retry on the next code: a code typed at a step boundary can be refused.
  if (s === 'code') {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let code: string;
      try { code = await source.code(); } catch { logLine(opts.log, 'meet_signin_unavailable'); throw fail('signin_unavailable'); }
      await type('code_input', code);
      await press('code_next');
      logLine(opts.log, 'meet_signin_code_sent', { attempt });
      s = await wait((x) => x === 'signed_in' || x === 'code_refused' || x === 'challenge');
      // Google keeps the field under its "Wrong code": type the next one into it.
      if (s !== 'code_refused' || !(await visible(page, 'code_input'))) break;
    }
  }
  if (s === 'signed_in') { logLine(opts.log, 'meet_signin_done'); return true; }
  return settle(s, 'step');
}

/**
 * The real `SignInSource`: the site Worker's signed callback,
 * `/api/meeting-bots/<uid>/meet-credentials` for a run and
 * `/api/meeting-bots/diagnostics/<id>/meet-credentials` for the owner's diagnostic.
 * 404 `meet_signin_unconfigured` means no account: join as a guest.
 */
export function meetCredentials(opts: { origin: string; path: string; key: string; fetch?: typeof fetch; now?: () => number }): SignInSource {
  const doFetch = opts.fetch ?? fetch, now = opts.now ?? Date.now;
  const post = async (raw: string) => {
    const url = new URL(opts.path, opts.origin);
    return doFetch(url, { method: 'POST', body: raw, redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', ...await signRequest(opts.key, url.pathname, raw, now()) } });
  };
  return {
    async account() {
      const res = await post('{}');
      if (res.status === 404) {
        const body = await res.json().catch(() => null) as { code?: unknown } | null;
        if (body?.code === 'meet_signin_unconfigured') return null;
      }
      if (!res.ok) throw new Error('credentials_refused');
      const v = await res.json() as { email?: unknown; password?: unknown };
      if (typeof v?.email !== 'string' || !v.email.includes('@') || v.email.length > 320 || typeof v?.password !== 'string' || !v.password || v.password.length > 1024) throw new Error('credentials_invalid');
      return { email: v.email, password: v.password };
    },
    async code() {
      const res = await post('{"step":"code"}');
      if (!res.ok) throw new Error('credentials_refused');
      const v = await res.json() as { code?: unknown; valid_ms?: unknown };
      if (typeof v?.code !== 'string' || !/^\d{6,8}$/.test(v.code)) throw new Error('credentials_invalid');
      // A code with under two seconds left is likely refused by the time it is typed: wait for the next one.
      if (typeof v.valid_ms === 'number' && v.valid_ms < 2000) {
        await new Promise((r) => setTimeout(r, v.valid_ms as number + 250));
        return this.code();
      }
      return v.code;
    },
  };
}
