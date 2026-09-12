#!/usr/bin/env node
/**
 * Task #168 — does the magic-link sign-in actually work in production?
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A TIMING CHECK. `/login`'s magic link
 * timed out at 30s. The fix (D74, `routes/auth.ts` `/magic/start`) commits
 * the token row first and hands the email send to `waitUntil`, so the
 * response no longer waits on Gmail. That removes the latency — and creates
 * a failure mode the old code could not have: **the endpoint can answer 202
 * in 200ms while the mail silently never arrives.** A fast `/magic/start` is
 * necessary and nowhere near sufficient. Only a round-trip tells "fixed"
 * apart from "fast and broken", which is why this probe reads a real inbox
 * and follows a real link.
 *
 * It also cannot be run from the agent sandbox: that proxy answers
 * `403 CONNECT` for axal.vc. A GitHub Actions runner is not behind it. So
 * this is written to run in CI and nowhere else.
 *
 * WHAT IT ASSERTS — three things, reported SEPARATELY, because they fail for
 * different reasons and one pass/fail would hide which:
 *
 *   1. `/api/auth/magic/start` answered under MAGIC_START_BUDGET_MS.
 *      The original symptom.
 *   2. The mail ARRIVED within MAGIC_MAIL_BUDGET_MS.
 *      The `waitUntil` regression — the one that would otherwise be silent.
 *   3. The link in it completed a sign-in.
 *      That the flow still works end to end.
 *
 * THE STALE-MESSAGE TRAP, guarded deliberately: a matching email from a
 * previous run would satisfy a naive inbox search forever, and the probe
 * would pass for months after delivery broke. Every candidate message must
 * have an `internalDate` AFTER the moment this run called `/magic/start`.
 *
 * Reading the inbox mirrors the send path exactly. The worker sends through
 * the Gmail API with an OAuth refresh token
 * (`cloudflare-worker/src/services/email/gmail.ts`); this reads with the same
 * dance and a read-only scope. The magic token is stored HASHED in
 * `magic_link_tokens`, so there is no back door — the raw token exists only
 * in the email, and a mailbox is unavoidable.
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
import { pathToFileURL } from 'node:url';

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

/**
 * Pull the magic token out of an email body.
 *
 * Tolerant of what mail does to URLs — an HTML-entity `=` in `token=`, a
 * trailing `>` or quote from an anchor, and soft line breaks inserted by
 * quoted-printable encoding at 76 columns, which is exactly the sort of
 * thing that splits a long token in half.
 *
 * There is deliberately NO `&amp;` → `&` step: `&` is not in the token
 * charset below, so the match already stops at the query separator whether
 * the template wrote `&` or `&amp;`. A replace for it would be dead code
 * that reads as protection — and its test would pass for a reason that has
 * nothing to do with the line.
 */
export function extractMagicToken(body) {
  if (!body) return null;
  const unwrapped = String(body)
    .replace(/=\r?\n/g, '')      // quoted-printable soft break
    .replace(/&#61;/g, '=');     // an entity-encoded `=` in `token=`
  const m = /\/api\/auth\/magic\/verify\?token=([A-Za-z0-9._\-~+/=%]+)/.exec(unwrapped);
  if (!m) return null;
  // Trim anything the surrounding markup glued on.
  const token = m[1].replace(/(&|"|'|<|>|\)|\]|\.)+$/, '');
  return token || null;
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

/** A successful verify redirects to `…?magic=ok`; every failure carries `magic_error`. */
export function verifyOutcome({ status, location }) {
  const loc = String(location || '');
  if (status !== 302) return { ok: false, why: `expected a 302 redirect, got ${status}` };
  if (/magic_error=/.test(loc)) {
    const code = (/magic_error=([a-z_]+)/.exec(loc) || [])[1] || 'unknown';
    return { ok: false, why: `verify refused the link: magic_error=${code}` };
  }
  if (!/[?&]magic=ok\b/.test(loc)) return { ok: false, why: `redirected somewhere unexpected: ${loc}` };
  return { ok: true, why: loc };
}

// ---------------------------------------------------------------------------
// I/O

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timeout = () => AbortSignal.timeout(FETCH_TIMEOUT_MS);

async function gmailAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    signal: timeout(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Gmail OAuth failed: ${data.error_description || data.error || res.statusText}`);
  }
  return data.access_token;
}

async function findMagicMail(accessToken, address, requestedAtMs) {
  const q = encodeURIComponent(`to:${address} newer_than:1d`);
  const list = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=${q}`,
    { signal: timeout(), headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!list.ok) throw new Error(`Gmail list failed: ${list.status} ${list.statusText}`);
  const { messages = [] } = await list.json();
  for (const { id } of messages) {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
      { signal: timeout(), headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) continue;
    const msg = await res.json();
    if (!isFreshMessage(msg, requestedAtMs)) continue;
    const token = extractMagicToken(decodeGmailBody(msg.payload));
    if (token) return { token, at: Number(msg.internalDate) };
  }
  return null;
}

async function main() {
  const missing = missingConfig();
  if (missing.length) {
    // NOT exit 0. A probe that passes when it never ran is precisely the
    // failure this task exists to correct — the post-deploy smoke only
    // watched /api/health and stayed green right through the outage.
    console.error(`check-magic-link-live: NOT CONFIGURED — missing ${missing.join(', ')}`);
    console.error('  Task #168 stays unverified until these are set. This is not a pass.');
    process.exit(2);
  }

  const address = process.env.MAGIC_PROBE_EMAIL.trim();
  console.log(`check-magic-link-live: ${HOST} → ${address}`);

  const requestedAtMs = Date.now();
  let startMs = NaN;
  try {
    const t0 = Date.now();
    const res = await fetch(`${HOST}/api/auth/magic/start`, {
      method: 'POST',
      signal: timeout(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: address }),
    });
    startMs = Date.now() - t0;
    // 202 is the documented answer whether or not the account exists — it is
    // deliberately not an enumeration oracle, so it proves nothing about
    // delivery. Only the arrival below does.
    if (res.status === 429) {
      console.error('check-magic-link-live: rate-limited (429). magic-start allows 3 per 900s per address.');
      console.error('  Widen the schedule rather than the limit; a probe that trips its own limiter proves nothing.');
      process.exit(1);
    }
    if (!res.ok && res.status !== 202) {
      console.error(`check-magic-link-live: /magic/start returned ${res.status}`);
    }
  } catch (e) {
    console.error(`check-magic-link-live: /magic/start threw — ${e.message}`);
  }

  let mailMs = NaN;
  let token = null;
  try {
    const accessToken = await gmailAccessToken();
    const deadline = Date.now() + MAIL_BUDGET_MS;
    while (Date.now() < deadline) {
      const found = await findMagicMail(accessToken, address, requestedAtMs);
      if (found) { token = found.token; mailMs = found.at - requestedAtMs; break; }
      await sleep(POLL_MS);
    }
  } catch (e) {
    console.error(`check-magic-link-live: inbox read failed — ${e.message}`);
  }

  let signedIn = false;
  if (token) {
    try {
      const res = await fetch(`${HOST}/api/auth/magic/verify?token=${encodeURIComponent(token)}`, {
        signal: timeout(), redirect: 'manual',
      });
      const outcome = verifyOutcome({ status: res.status, location: res.headers.get('location') });
      signedIn = outcome.ok;
      if (!outcome.ok) console.error(`check-magic-link-live: ${outcome.why}`);
    } catch (e) {
      console.error(`check-magic-link-live: verify threw — ${e.message}`);
    }
  }

  const { rows, ok } = verdicts({
    startMs, mailMs, signedIn,
    startBudgetMs: START_BUDGET_MS, mailBudgetMs: MAIL_BUDGET_MS,
  });
  for (const r of rows) console.log(`  ${r.ok ? '✓' : '✗'} ${r.key}: ${r.detail}`);

  if (!ok) {
    console.error('check-magic-link-live: FAILED — task #168 is not verified.');
    process.exit(1);
  }
  console.log('check-magic-link-live: OK — a real sign-in completed end to end.');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(`check-magic-link-live: ${e.stack || e.message}`); process.exit(1); });
}
