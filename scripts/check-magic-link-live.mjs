#!/usr/bin/env node
/**
 * Task #168 — does the magic-link sign-in actually work in production?
 *
 * A successful /magic/start accepts the email for queued delivery. It can
 * answer quickly while the mail never arrives. Check its latency, read the
 * dedicated mailbox, then use the session issued by the email link to check
 * the signed-in identity. Only a fresh message can satisfy the probe.
 *
 * NOT WIRED INTO `test:drift`. It needs production and secrets; a check that
 * cannot run must never report success. Its pure helpers ARE unit-tested, in
 * `frontend/test/magic_link_probe.test.mjs`.
 *
 *   node scripts/check-magic-link-live.mjs
 *
 * Config (all via env; the three GMAIL_* are the same names the worker uses):
 *   MAGIC_PROBE_EMAIL        the dedicated test account's address
 *   GMAIL_CLIENT_ID          OAuth client for the mailbox that RECEIVES it
 *   GMAIL_CLIENT_SECRET
 *   GMAIL_REFRESH_TOKEN      needs gmail.readonly; a `+alias` of the sending
 *                            account delivers to that same mailbox, which is
 *                            the cheapest way to satisfy this
 *   MAGIC_PROBE_HOST         default https://axal.vc
 *   MAGIC_START_BUDGET_MS    default 5000
 *   MAGIC_MAIL_BUDGET_MS     default 120000 (well inside the 15-min TTL)
 */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { probeOutcome } from './lib/probeOutcome.mjs';
import { describeRefusal } from './check-magic-link-insert.mjs';

const HOST = (process.env.MAGIC_PROBE_HOST || 'https://axal.vc').replace(/\/+$/, '');
const START_BUDGET_MS = Number(process.env.MAGIC_START_BUDGET_MS || 5000);
const MAIL_BUDGET_MS = Number(process.env.MAGIC_MAIL_BUDGET_MS || 120_000);
const POLL_MS = Number(process.env.MAGIC_POLL_MS || 5000);
const FETCH_TIMEOUT_MS = Number(process.env.MAGIC_FETCH_TIMEOUT_MS || 30_000);

/** Config this cannot run without. Missing config is never a pass. */
export function missingConfig(env = process.env) {
  return ['MAGIC_PROBE_EMAIL', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']
    .filter((k) => !String(env[k] || '').trim());
}

/** Read only an absolute verification link to the configured production origin. */
export function extractMagicToken(body) {
  const expectedOrigin = new URL(HOST).origin;
  const unwrapped = String(body || '').replace(/=\r?\n/g, '').replace(/&#61;|=3D/gi, '=');
  for (const [candidate] of unwrapped.matchAll(/https?:\/\/[^\s<>"'()\]]+/gi)) {
    let url;
    try { url = new URL(candidate.replace(/\.+$/, '')); } catch { continue; }
    if (url.origin !== expectedOrigin || url.username || url.password ||
        url.pathname !== '/api/auth/magic/verify') continue;
    const tokens = url.searchParams.getAll('token');
    if (tokens.length === 1 && tokens[0]) return tokens[0];
  }
  return null;
}

/**
 * Gmail returns a message as a tree of base64url parts. Flatten it and hand
 * back every text part concatenated — the link may live in text/plain or
 * text/html depending on how the template rendered.
 */
export function decodeGmailBody(payload) {
  const out = [];
  const walk = (part) => {
    if (!part || typeof part !== 'object') return;
    const data = part.body?.data;
    if (data) {
      try {
        out.push(Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      } catch { /* a part that will not decode is not the whole message */ }
    }
    for (const p of part.parts || []) walk(p);
  };
  walk(payload);
  return out.join('\n');
}

/**
 * Is this message this run's, or a leftover from the last one?
 *
 * `internalDate` is Gmail's own receive time in ms. Anything at or before
 * the instant we asked for the link belongs to an earlier run, and counting
 * it would let the probe pass indefinitely after delivery broke.
 */
export function isFreshMessage(message, requestedAtMs) {
  const at = Number(message?.internalDate);
  if (!Number.isFinite(at)) return false;
  return at > requestedAtMs;
}

/** The three verdicts, derived in one place so the report cannot contradict itself. */
export function verdicts({ startMs, mailMs, signedIn, startBudgetMs, mailBudgetMs }) {
  const rows = [
    {
      key: 'start_latency',
      ok: Number.isFinite(startMs) && startMs <= startBudgetMs,
      detail: Number.isFinite(startMs)
        ? `/magic/start answered in ${startMs}ms (budget ${startBudgetMs}ms)`
        : '/magic/start did not answer',
    },
    {
      key: 'mail_delivered',
      ok: Number.isFinite(mailMs) && mailMs <= mailBudgetMs,
      detail: Number.isFinite(mailMs)
        ? `the link arrived after ${Math.round(mailMs / 1000)}s (budget ${Math.round(mailBudgetMs / 1000)}s)`
        : `no link arrived within ${Math.round(mailBudgetMs / 1000)}s — /magic/start can answer fast and still never deliver`,
    },
    {
      key: 'sign_in_completed',
      ok: signedIn === true,
      detail: signedIn === true
        ? 'the link completed a sign-in'
        : 'the link did not complete a sign-in',
    },
  ];
  return { rows, ok: rows.every((r) => r.ok) };
}

/** #4571 R2-09: this run's outcome. The one probe that can say VERIFIED_END_TO_END. */
export function liveOutcome({ startStatus, refusal, rows }) {
  return probeOutcome({ startStatus, refusal, rows, endToEnd: true });
}

/** A successful verify redirects to `…?magic=ok`; every failure carries `magic_error`. */
export function verifyOutcome({ status, location }) {
  if (status !== 302) return { ok: false, why: `expected a 302 redirect, got ${status}` };
  const url = URL.parse(location || '', HOST);
  if (url && url.origin === new URL(HOST).origin && !url.username && !url.password) {
    if (url.searchParams.has('magic_error')) {
      const error = url.searchParams.get('magic_error');
      const known = ['invalid', 'expired', 'rate', 'limiter', 'inactive', 'error'];
      return { ok: false, why: `verify refused the link: magic_error=${known.includes(error) ? error : 'unknown'}` };
    }
    const values = url.searchParams.getAll('magic');
    if (values.length === 1 && values[0] === 'ok') return { ok: true, why: 'success redirect' };
  }
  return { ok: false, why: 'unexpected verify redirect' };
}

// ---------------------------------------------------------------------------
// I/O

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timeout = () => AbortSignal.timeout(FETCH_TIMEOUT_MS);

class MailboxError extends Error {
  constructor(classification, message) {
    super(message);
    this.classification = classification;
  }
}

// Never replay a login request or one-time link. Only Google reads and the
// access-token exchange are retried, all against the same delivery deadline.
async function googleJson(url, options, deadline, stage) {
  let detail = 'delivery deadline elapsed';
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    let retryMs = Math.min(POLL_MS, 1000) * 2 ** attempt;
    try {
      const res = await fetch(url, {
        ...options, redirect: 'error', signal: AbortSignal.timeout(Math.min(FETCH_TIMEOUT_MS, remaining)),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && typeof data === 'object') return data;
      detail = `HTTP ${res.status}`;
      const quota = data?.error?.errors?.some?.(({ reason }) =>
        reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded');
      if (!res.ok && res.status !== 408 && res.status !== 429 && res.status < 500 && !quota) {
        // Only print known provider codes. Descriptions, bodies and URLs may contain credentials.
        const code = ['invalid_grant', 'invalid_client', 'invalid_scope'].includes(data?.error) ? data.error : '';
        throw new MailboxError(stage, `${stage} failed (${detail}${code ? `, ${code}` : ''})`);
      }
      const retryAfter = res.headers.get('retry-after');
      if (retryAfter) {
        const wait = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(wait)) retryMs = Math.max(retryMs, wait);
      }
    } catch (e) {
      if (e instanceof MailboxError) throw e;
      detail = 'network failure';
    }
    if (attempt === 2 || Date.now() + retryMs >= deadline) break;
    await sleep(retryMs);
  }
  throw new MailboxError('DEPENDENCY_FAILURE', `${stage} unavailable (${detail})`);
}

async function findMagicMail(address, requestedAtMs) {
  const deadline = requestedAtMs + MAIL_BUDGET_MS;
  const oauth = await googleJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  }, deadline, 'GMAIL_AUTH');
  if (typeof oauth.access_token !== 'string' || !oauth.access_token) {
    throw new MailboxError('GMAIL_AUTH', 'Google returned no mailbox access token');
  }
  const options = { headers: { Authorization: `Bearer ${oauth.access_token}` } };
  const messagesUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
  // Gmail's query uses whole seconds. Keep the millisecond check after the fetch.
  const q = `to:${address} after:${Math.floor(requestedAtMs / 1000) - 1}`;
  const inspected = new Set();
  let polls = 0;
  try {
    while (Date.now() < deadline) {
      polls++;
      const params = new URLSearchParams({ q, maxResults: '100' });
      do {
        const list = await googleJson(`${messagesUrl}?${params}`, options, deadline, 'GMAIL_READ');
        for (const { id } of list.messages || []) {
          if (inspected.has(id)) continue;
          const msg = await googleJson(`${messagesUrl}/${encodeURIComponent(id)}?format=full`, options, deadline, 'GMAIL_READ');
          inspected.add(id);
          if (!isFreshMessage(msg, requestedAtMs)) continue;
          const token = extractMagicToken(decodeGmailBody(msg.payload));
          if (token) return { token, at: Number(msg.internalDate) };
        }
        if (!list.nextPageToken) break;
        params.set('pageToken', list.nextPageToken);
      } while (Date.now() < deadline);
      await sleep(Math.max(0, Math.min(POLL_MS, deadline - Date.now())));
    }
    return null;
  } finally {
    console.log(`  Gmail polls: ${polls}, distinct messages inspected: ${inspected.size}`);
  }
}

async function verifySession(token, address) {
  const res = await fetch(`${HOST}/api/auth/magic/verify?token=${encodeURIComponent(token)}`, {
    signal: timeout(), redirect: 'manual',
  });
  const redirect = verifyOutcome({ status: res.status, location: res.headers.get('location') });
  if (!redirect.ok) return redirect;
  // The HQ Worker's authCookieName is studioos_auth. Send only that cookie to
  // the fixed same-origin identity endpoint. Never follow a redirect with it.
  const cookie = res.headers.getSetCookie()
    .map((value) => value.split(';', 1)[0])
    .find((pair) => /^studioos_auth=\S+$/.test(pair));
  if (!cookie) return { ok: false, why: 'verify did not issue a session cookie' };
  const me = await fetch(`${HOST}/api/auth/me`, {
    headers: { Cookie: cookie }, redirect: 'manual', signal: timeout(),
  });
  if (me.status !== 200) return { ok: false, why: `session identity check returned HTTP ${me.status}` };
  const identity = await me.json().catch(() => null);
  if (typeof identity?.email !== 'string' || identity.email.toLowerCase() !== address.toLowerCase()) {
    return { ok: false, why: 'session identity did not match the dedicated account' };
  }
  return { ok: true, why: 'the session belongs to the dedicated account' };
}

function classify(classification) {
  console.log(`  classification: ${classification}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `classification=${classification}\n`);
  process.exitCode = classification === 'PASS' ? 0 : 1;
}

async function main() {
  const missing = missingConfig();
  if (missing.length) {
    console.error(`check-magic-link-live: NOT CONFIGURED — missing ${missing.join(', ')}`);
    classify('CONFIG_ERROR');
    process.exit(2);
  }

  if (![START_BUDGET_MS, MAIL_BUDGET_MS, POLL_MS, FETCH_TIMEOUT_MS].every(
    (ms) => Number.isSafeInteger(ms) && ms > 0 && ms <= 2_147_483_647,
  )) {
    console.error('check-magic-link-live: probe timers must be positive integer milliseconds within the Node timer range');
    classify('CONFIG_ERROR');
    process.exit(2);
  }
  const address = process.env.MAGIC_PROBE_EMAIL.trim();
  const requestedAtMs = Date.now();
  let startMs = NaN;
  let startStatus = null;
  let refusal = null;
  let startClassification = 'START_FAILURE';
  try {
    const res = await fetch(`${HOST}/api/auth/magic/start`, {
      method: 'POST', redirect: 'manual', signal: timeout(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: address }),
    });
    startMs = Date.now() - requestedAtMs;
    startStatus = res.status;
    console.log(`  /magic/start: HTTP ${startStatus} in ${startMs}ms (budget ${START_BUDGET_MS}ms)`);
    if (res.status !== 202) {
      const body = await res.text().catch(() => '');
      refusal = describeRefusal({ status: res.status, headers: res.headers, body });
      const challenge = res.headers.get('cf-mitigated') === 'challenge' ||
        (res.status === 403 && refusal.origin === 'edge' &&
          /<title>\s*Just a moment|\/cdn-cgi\/challenge-platform\//i.test(body));
      console.error(`  request refused: HTTP ${startStatus}, origin ${challenge ? 'edge' : refusal.origin}`);
      if (res.status === 429) console.error('  magic-start allows 3 per 900s per address');
      if (res.status === 403 && (challenge || refusal.origin === 'edge') && process.env.GITHUB_ACTIONS === 'true') {
        console.log('::notice title=StudioOS auth probe::edge-refused');
      }
      // probeOutcome calls every 'edge' a challenge. A generic CF error page
      // (including an upstream 502) has no evidence of a challenge.
      if (challenge) {
        refusal = { origin: 'edge' };
        startClassification = 'EDGE_CHALLENGED';
      } else if (refusal.origin === 'edge') {
        if (res.status === 403) startClassification = 'EDGE_REFUSED';
        refusal = { origin: 'unknown' };
      }
    }
  } catch {
    console.error('  /magic/start request failed or timed out');
  }

  if (startStatus !== 202) {
    console.log('  – mail_delivered: NOT CHECKED — /magic/start did not accept the request');
    console.log('  – sign_in_completed: NOT CHECKED — no link was asked for');
    console.log(`  outcome: ${liveOutcome({ startStatus, refusal, rows: [] })}`);
    return classify(startClassification);
  }

  let mail;
  try {
    mail = await findMagicMail(address, requestedAtMs);
  } catch (e) {
    if (!(e instanceof MailboxError)) throw e;
    console.error(`  ${e.message}`);
    console.log('  – mail_delivered: NOT CHECKED — inbox observation unavailable');
    console.log('  – sign_in_completed: NOT CHECKED — no link available to verify');
    console.log(`  outcome: ${startMs <= START_BUDGET_MS ? 'ACCEPTED_NOT_VERIFIED' : 'APPLICATION_FAILED'}`);
    return classify(e.classification);
  }

  let signedIn = false;
  if (mail) {
    try {
      const result = await verifySession(mail.token, address);
      signedIn = result.ok;
      if (!signedIn) console.error(`  ${result.why}`);
    } catch {
      console.error('  verification request failed or timed out');
    }
  }
  const { rows, ok } = verdicts({
    startMs, mailMs: mail ? mail.at - requestedAtMs : NaN, signedIn,
    startBudgetMs: START_BUDGET_MS, mailBudgetMs: MAIL_BUDGET_MS,
  });
  for (const row of rows) {
    if (row.key === 'sign_in_completed' && !mail) console.log('  – sign_in_completed: NOT CHECKED — no fresh link');
    else console.log(`  ${row.ok ? '✓' : '✗'} ${row.key}: ${row.detail}`);
  }
  console.log(`  outcome: ${liveOutcome({ startStatus, refusal, rows })}`);
  if (ok) return classify('PASS');
  if (!mail || mail.at - requestedAtMs > MAIL_BUDGET_MS) return classify('DELIVERY_FAILURE');
  if (!signedIn) return classify('VERIFY_FAILURE');
  return classify('START_FAILURE');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(() => {
    console.error('check-magic-link-live: unexpected probe error');
    process.exitCode = 1;
    classify('INFRA_FAILURE');
  });
}
