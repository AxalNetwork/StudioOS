#!/usr/bin/env node
/**
 * Task #168 — does `/magic/start` still reach its INSERT, and does the mail
 * actually get sent?
 *
 * WHAT THIS COVERS, AND THE THIRD VERDICT IS THE ONE THAT WAS MISSING.
 * `check-magic-link-live.mjs` is still the only probe that reads a mailbox,
 * follows the link and asserts a sign-in; it needs a Gmail OAuth app and until
 * one exists it exits NOT CONFIGURED. This probe needs no mailbox at all, and
 * it turns out to see much more than "a row was written":
 *
 *   1. `start_latency`     — `/magic/start` answered under budget. The symptom.
 *   2. `token_row_written` — a `magic_link_tokens` row appeared. That is exactly
 *      where the outage died: D74's diagnosis found four rows, newest
 *      2026-08-03, and the failing attempt wrote NONE, proving the request never
 *      reached the INSERT that `/magic/start` performs before anything else.
 *   3. `mail_send_recorded` — **the mail was handed to Gmail and accepted.**
 *
 * WHY THE THIRD ONE EXISTS. The first version of this probe asserted 1 and 2 and
 * then printed "NOT CHECKED HERE: delivery", on the belief that the `waitUntil`
 * send leaves no trace in D1. It does. `routes/auth.ts` imports
 * `send as sendEmail` from `services/email/send.ts`, and that function inserts an
 * `email_send_log` row (`status='queued'`) BEFORE it enqueues; the queue consumer
 * (`queueWorker.ts`, case `email_send`) calls `deliverNow`, which marks the row
 * `sent` only when the Gmail API accepted the message, and `failed` with a
 * `last_error` otherwise. So the precise failure D74 introduced — token row
 * committed, 202 in 200ms, mail never sent — is visible here, and without it a
 * green run could mean a completely broken login.
 *
 * WHAT IT STILL CANNOT SEE, stated up front because the temptation is to
 * overclaim: ARRIVAL. Gmail accepting a message is not the message landing in an
 * inbox — a bounce, a spam file or a wrong address all follow acceptance — and
 * nothing here follows the link or asserts a session. Those two things are the
 * mailbox probe's own territory, and it remains what closes #168.
 *
 * WHY THE SEND BUDGET IS THREE MINUTES. Measured, not guessed. The four real
 * `auth_magic_link` rows in production went from `enqueued_at` to `sent_at` in
 * 10s, 29s, 82s and 26s — all `attempts=1`, no failures. A 60s budget would have
 * failed the 82s send, which succeeded. 180s clears the measured worst case by
 * more than double and still sits far inside both the 15-minute token TTL and the
 * workflow's 10-minute job timeout.
 *
 * WHY THE ROW ID AND NOT THE TIMESTAMP, for both tables. `created_at` /
 * `enqueued_at` are SQLite `CURRENT_TIMESTAMP`, i.e. `'YYYY-MM-DD HH:MM:SS'` in
 * UTC — and `new Date('2026-08-03 12:20:43')` parses as LOCAL time in Node, so
 * comparing one against a runner clock is two bugs waiting (a timezone and a
 * skew). The ids are `AUTOINCREMENT`, monotonic and never reused, so "the highest
 * id for this address went up" is the same question with no clock in it. Scoping
 * to the address also means a real person signing in mid-run cannot be mistaken
 * for the probe's own row.
 *
 * Config:
 *   MAGIC_PROBE_EMAIL       the address to request a link for. `/magic/start`
 *                           writes its row before it ever looks the account up,
 *                           so this need not be a registered user — but it IS
 *                           sent a real email, so it must be an inbox you own.
 *   CLOUDFLARE_API_TOKEN    already a repository secret (D1 scope)
 *   CLOUDFLARE_ACCOUNT_ID   already a repository secret
 *   MAGIC_PROBE_HOST        default https://axal.vc
 *   MAGIC_START_BUDGET_MS   default 5000
 *   MAGIC_ROW_BUDGET_MS     default 15000 — the row is committed before the
 *                           202, so this is slack for replication, not for mail
 *   MAGIC_SEND_BUDGET_MS    default 180000 — see the measurement above
 *   MAGIC_D1_NAME           default studioos-db
 *
 * EXIT CODES, and the third is the one that earns its keep:
 *   0  all three verdicts passed
 *   1  ran, and something is wrong with the flow
 *   2  COULD NOT RUN — config missing, or D1 refused the read. Never reported
 *      as "no row was written" or "no mail was sent", because those read as a
 *      broken sign-in when the truth is a missing permission. Same distinction
 *      as D78.
 */
import { pathToFileURL } from 'node:url';

const HOST = (process.env.MAGIC_PROBE_HOST || 'https://axal.vc').replace(/\/+$/, '');
const START_BUDGET_MS = Number(process.env.MAGIC_START_BUDGET_MS || 5000);
const ROW_BUDGET_MS = Number(process.env.MAGIC_ROW_BUDGET_MS || 15_000);
const SEND_BUDGET_MS = Number(process.env.MAGIC_SEND_BUDGET_MS || 180_000);
const POLL_MS = Number(process.env.MAGIC_POLL_MS || 2000);
const FETCH_TIMEOUT_MS = Number(process.env.MAGIC_FETCH_TIMEOUT_MS || 30_000);
const D1_NAME = process.env.MAGIC_D1_NAME || 'studioos-db';
const CF_API = 'https://api.cloudflare.com/client/v4';

/**
 * The template `/magic/start` sends under. NOT configurable on purpose: it is a
 * code constant (`templates/email/registry.ts`), and an env override would let
 * the probe look for the wrong row and report a healthy silence.
 */
export const TEMPLATE_KEY = 'auth_magic_link';

/** Config this cannot run without. Missing config is never a pass. */
export function missingConfig(env = process.env) {
  return ['MAGIC_PROBE_EMAIL', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']
    .filter((k) => !String(env[k] || '').trim());
}

/**
 * Strip anything credential-shaped out of an `email_send_log.last_error` before
 * it is printed.
 *
 * `deliverNow` stores `e?.message` from the Gmail call, and the payload that call
 * carries contains the rendered `magic_url` — so a library that echoes its
 * request into an error message would put a live sign-in link in a public CI log.
 * Unlikely, and one line of defence is cheaper than the incident. URLs go first
 * because they contain the token; then any long unbroken token-ish run. Ordinary
 * diagnostics survive intact: `gmail_creds_missing`, `gmail_send_failed` and
 * `deliver_now_threw` are all under the run-length threshold.
 */
export function redactError(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw)
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, '[url removed]')
    .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]');
  return cleaned.length > 200 ? `${cleaned.slice(0, 200)}…` : cleaned;
}

/**
 * The send half of the report, derived from the log row this run caused.
 *
 * Four outcomes, kept apart because each sends a reader to different code:
 *   no row      the `waitUntil` errand never reached `send()`'s own INSERT
 *   queued      enqueued and never delivered — the silent `waitUntil` failure
 *   failed/dlq  the Gmail call was attempted and refused; `last_error` names it
 *   sent        Gmail accepted the message
 */
export function sendVerdict({ row, sendMs, sendBudgetMs }) {
  if (row && row.status === 'sent') {
    return {
      ok: true,
      detail: `Gmail accepted the message${Number.isFinite(sendMs) ? ` after ${sendMs}ms` : ''}`,
    };
  }
  if (row === null || row === undefined) {
    return {
      ok: false,
      detail: `no email_send_log row for this address under ${TEMPLATE_KEY} — the send errand never reached its own INSERT, so no mail was ever queued`,
    };
  }
  if (row.status === 'queued') {
    return {
      ok: false,
      detail: `still queued after ${sendBudgetMs}ms — the row was written and never delivered. This is the silent waitUntil failure: the token row exists and /magic/start answered, but no mail was sent`,
    };
  }
  const why = redactError(row.lastError);
  return {
    ok: false,
    detail: `email_send_log says ${row.status}${why ? ` — ${why}` : ''}`,
  };
}

/**
 * The three verdicts, derived in one place so the report cannot contradict
 * itself.
 *
 * Deliberately the same shape as the mailbox probe's `verdicts`, so a reader who
 * knows one knows the other — but with its own keys, because claiming
 * `mail_delivered` here would be a lie: this sees acceptance, not arrival.
 */
export function verdicts({ startMs, rowFound, rowMs, sendRow, sendMs, startBudgetMs, sendBudgetMs }) {
  const send = sendVerdict({ row: sendRow, sendMs, sendBudgetMs });
  const rows = [
    {
      key: 'start_latency',
      ok: Number.isFinite(startMs) && startMs <= startBudgetMs,
      detail: Number.isFinite(startMs)
        ? `/magic/start answered in ${startMs}ms (budget ${startBudgetMs}ms)`
        : '/magic/start did not answer',
    },
    {
      key: 'token_row_written',
      ok: rowFound === true,
      detail: rowFound === true
        ? `a new magic_link_tokens row appeared${Number.isFinite(rowMs) ? ` after ${rowMs}ms` : ''}`
        : 'no new magic_link_tokens row — the request did not reach its INSERT, which is exactly how the outage presented',
    },
    { key: 'mail_send_recorded', ok: send.ok, detail: send.detail },
  ];
  return { rows, ok: rows.every((r) => r.ok) };
}

/**
 * Read a Cloudflare API envelope, distinguishing "cannot" from "did not".
 *
 * A 401/403 means the token lacks D1 access — the probe never ran its later
 * verdicts, so the caller must exit 2. Anything else that fails is still a
 * failure to READ, not a finding about the flow, so it is also a 2.
 */
export function readEnvelope({ status, body }) {
  if (status === 401 || status === 403) {
    return { ok: false, cannotRun: true, why: `Cloudflare refused the read (${status}) — the API token needs D1 read on this account` };
  }
  if (status !== 200) {
    return { ok: false, cannotRun: true, why: `Cloudflare returned ${status}` };
  }
  if (!body || body.success !== true) {
    const first = body?.errors?.[0];
    const detail = first ? `${first.code}: ${first.message}` : 'no detail';
    return { ok: false, cannotRun: true, why: `Cloudflare reported failure — ${detail}` };
  }
  return { ok: true, result: body.result };
}

/**
 * The highest row id in a `SELECT MAX(id) AS id …` answer, or null.
 *
 * Null and 0 are different from "no rows": an address with no tokens yet gives
 * `{ id: null }`, and the baseline for it is 0 so that any row at all counts as
 * new. Returning null on a malformed answer keeps a parse failure from reading
 * as "nothing was written".
 */
export function maxIdOf(result) {
  const rows = Array.isArray(result) ? result[0]?.results : null;
  if (!Array.isArray(rows)) return null;
  if (!rows.length) return 0;
  const raw = rows[0]?.id;
  if (raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * The `email_send_log` row out of a `SELECT id, status, last_error …` answer.
 *
 * Three returns, and the difference between the first two is the whole point:
 *   undefined  the answer could not be parsed — the caller must exit 2
 *   null       parsed fine, and there is no such row yet — a real finding
 *   { status, lastError }
 */
export function sendRowOf(result) {
  const rows = Array.isArray(result) ? result[0]?.results : null;
  if (!Array.isArray(rows)) return undefined;
  if (!rows.length) return null;
  const r = rows[0] || {};
  if (r.status === null || r.status === undefined) return undefined;
  return { status: String(r.status), lastError: r.last_error ?? null };
}

/** Stop polling the send log? `sent`, `failed` and `dlq` are all terminal. */
export function sendPollDone(row) {
  if (!row) return false;
  return row.status === 'sent' || row.status === 'failed' || row.status === 'dlq';
}

// ---------------------------------------------------------------------------
// I/O

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timeout = () => AbortSignal.timeout(FETCH_TIMEOUT_MS);
const cfHeaders = () => ({
  Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
  'Content-Type': 'application/json',
});

/** Resolve the database by NAME. A uuid pasted into a repo rots. */
async function databaseId(accountId) {
  const url = `${CF_API}/accounts/${encodeURIComponent(accountId)}/d1/database?name=${encodeURIComponent(D1_NAME)}`;
  const res = await fetch(url, { signal: timeout(), headers: cfHeaders() });
  const body = await res.json().catch(() => null);
  const env = readEnvelope({ status: res.status, body });
  if (!env.ok) return env;
  const match = (env.result || []).find((d) => d?.name === D1_NAME);
  if (!match?.uuid) {
    return { ok: false, cannotRun: true, why: `no D1 database named ${D1_NAME} on this account` };
  }
  return { ok: true, uuid: match.uuid };
}

async function query(accountId, uuid, sql, params) {
  const res = await fetch(`${CF_API}/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(uuid)}/query`, {
    method: 'POST',
    signal: timeout(),
    headers: cfHeaders(),
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json().catch(() => null);
  return readEnvelope({ status: res.status, body });
}

async function maxTokenId(accountId, uuid, address) {
  // No token material is read — only the row id for this one address.
  const env = await query(accountId, uuid, 'SELECT MAX(id) AS id FROM magic_link_tokens WHERE email = ?', [address]);
  if (!env.ok) return env;
  const id = maxIdOf(env.result);
  if (id === null) return { ok: false, cannotRun: true, why: 'could not read a row id out of the D1 answer' };
  return { ok: true, id };
}

async function maxSendLogId(accountId, uuid, address) {
  const env = await query(
    accountId, uuid,
    'SELECT MAX(id) AS id FROM email_send_log WHERE to_addr = ? AND template_key = ?',
    [address, TEMPLATE_KEY],
  );
  if (!env.ok) return env;
  const id = maxIdOf(env.result);
  if (id === null) return { ok: false, cannotRun: true, why: 'could not read a send-log id out of the D1 answer' };
  return { ok: true, id };
}

/** This run's own send-log row: the first one past the baseline. */
async function sendLogRow(accountId, uuid, address, sinceId) {
  const env = await query(
    accountId, uuid,
    'SELECT id, status, last_error FROM email_send_log WHERE to_addr = ? AND template_key = ? AND id > ? ORDER BY id ASC LIMIT 1',
    [address, TEMPLATE_KEY, String(sinceId)],
  );
  if (!env.ok) return env;
  const row = sendRowOf(env.result);
  if (row === undefined) return { ok: false, cannotRun: true, why: 'could not read a send-log row out of the D1 answer' };
  return { ok: true, row };
}

async function main() {
  const missing = missingConfig();
  if (missing.length) {
    console.error(`check-magic-link-insert: NOT CONFIGURED — missing ${missing.join(', ')}`);
    console.error('  CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are already repository secrets;');
    console.error('  MAGIC_PROBE_EMAIL is the one to add. This is not a pass.');
    process.exit(2);
  }

  const address = process.env.MAGIC_PROBE_EMAIL.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID.trim();
  console.log(`check-magic-link-insert: ${HOST} → ${address}`);

  const db = await databaseId(accountId);
  if (!db.ok) {
    console.error(`check-magic-link-insert: ${db.why}`);
    process.exit(2);
  }

  // BOTH BASELINES COME FIRST. Taken after the request, a row already present
  // would count as this run's own.
  const before = await maxTokenId(accountId, db.uuid, address);
  if (!before.ok) {
    console.error(`check-magic-link-insert: ${before.why}`);
    process.exit(2);
  }
  const beforeSend = await maxSendLogId(accountId, db.uuid, address);
  if (!beforeSend.ok) {
    console.error(`check-magic-link-insert: ${beforeSend.why}`);
    process.exit(2);
  }
  console.log(`  baseline: highest token row id ${before.id}, highest ${TEMPLATE_KEY} send-log id ${beforeSend.id}`);

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
    if (res.status === 429) {
      console.error('check-magic-link-insert: rate-limited (429). magic-start allows 3 per 900s per address.');
      console.error('  This probe and the mailbox probe share that address — widen the schedules, never the limit.');
      process.exit(1);
    }
    if (!res.ok && res.status !== 202) {
      console.error(`check-magic-link-insert: /magic/start returned ${res.status}`);
    }
  } catch (e) {
    console.error(`check-magic-link-insert: /magic/start threw — ${e.message}`);
  }

  let rowFound = false;
  let rowMs = NaN;
  const t1 = Date.now();
  const rowDeadline = t1 + ROW_BUDGET_MS;
  for (;;) {
    const after = await maxTokenId(accountId, db.uuid, address);
    if (!after.ok) {
      // A read that fails mid-poll is still "could not run", not "no row".
      console.error(`check-magic-link-insert: ${after.why}`);
      process.exit(2);
    }
    if (after.id > before.id) { rowFound = true; rowMs = Date.now() - t1; break; }
    if (Date.now() >= rowDeadline) break;
    await sleep(POLL_MS);
  }

  // The send is a separate errand kept alive by `waitUntil`, so it lands after
  // the token row and has its own, much longer, budget.
  let sendRow = null;
  let sendMs = NaN;
  const t2 = Date.now();
  const sendDeadline = t2 + SEND_BUDGET_MS;
  for (;;) {
    const got = await sendLogRow(accountId, db.uuid, address, beforeSend.id);
    if (!got.ok) {
      console.error(`check-magic-link-insert: ${got.why}`);
      process.exit(2);
    }
    sendRow = got.row;
    if (sendPollDone(sendRow)) { sendMs = Date.now() - t2; break; }
    if (Date.now() >= sendDeadline) break;
    await sleep(POLL_MS);
  }

  const { rows, ok } = verdicts({
    startMs, rowFound, rowMs, sendRow, sendMs,
    startBudgetMs: START_BUDGET_MS, sendBudgetMs: SEND_BUDGET_MS,
  });
  for (const r of rows) console.log(`  ${r.ok ? '✓' : '✗'} ${r.key}: ${r.detail}`);
  console.log('  NOT CHECKED HERE: that the mail ARRIVED. Gmail accepting a message is not an');
  console.log('  inbox — a bounce, a spam file or a wrong address all follow acceptance — and');
  console.log('  nothing here follows the link or asserts a session. check-magic-link-live.mjs');
  console.log('  does both, and stays the probe that can close #168.');

  if (!ok) {
    console.error('check-magic-link-insert: FAILED.');
    process.exit(1);
  }
  console.log('check-magic-link-insert: OK — the endpoint answers, commits its token row, and Gmail accepted the mail.');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(`check-magic-link-insert: ${e.stack || e.message}`); process.exit(1); });
}
