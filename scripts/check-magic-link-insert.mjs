#!/usr/bin/env node
/**
 * Task #168 — does `/magic/start` still reach the INSERT that is its first act?
 *
 * THE CHEAP HALF OF THE QUESTION, AND WHY IT IS WORTH ASKING SEPARATELY.
 * `check-magic-link-live.mjs` is the real answer: it reads a mailbox, follows
 * the link and asserts a sign-in. It needs a Gmail OAuth app to do that, and
 * until one exists it fails NOT CONFIGURED and the `/login` outage stays
 * unverified.
 *
 * This probe needs no mailbox. It asks for a link and then looks in production
 * D1 for the token row. That is exactly where the outage died: D74's diagnosis
 * found `magic_link_tokens` holding four rows, newest 2026-08-03, and the
 * failing attempt wrote NONE — proving the request never reached the INSERT
 * that `/magic/start` performs before anything else. A row appearing is direct
 * evidence the 30-second hang is gone.
 *
 * WHAT IT CANNOT SEE, stated up front because the temptation is to overclaim:
 * DELIVERY. D74 moved the send to `waitUntil`, so the row is committed and the
 * mail is a separate errand that can fail silently. A green run here means
 * "the endpoint answers and commits", never "the magic link works". Only the
 * mailbox probe can say the second thing, and it remains the one that closes
 * #168.
 *
 * WHY THE ROW ID AND NOT THE TIMESTAMP. `created_at` is a SQLite
 * `CURRENT_TIMESTAMP`, i.e. `'YYYY-MM-DD HH:MM:SS'` in UTC — and
 * `new Date('2026-08-03 12:20:43')` parses as LOCAL time in Node, so comparing
 * it against a runner clock is two bugs waiting (a timezone and a skew). The
 * ids are `AUTOINCREMENT`, monotonic and never reused, so "the highest id for
 * this address went up" is the same question with no clock in it. Scoping to
 * the address also means a real person signing in mid-run cannot be mistaken
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
 *   MAGIC_D1_NAME           default studioos-db
 *
 * EXIT CODES, and the third is the one that earns its keep:
 *   0  both verdicts passed
 *   1  ran, and something is wrong with the flow
 *   2  COULD NOT RUN — config missing, or D1 refused the read. Never reported
 *      as "no row was written", because that reads as a broken sign-in when the
 *      truth is a missing permission. Same distinction as D78.
 */
import { pathToFileURL } from 'node:url';

const HOST = (process.env.MAGIC_PROBE_HOST || 'https://axal.vc').replace(/\/+$/, '');
const START_BUDGET_MS = Number(process.env.MAGIC_START_BUDGET_MS || 5000);
const ROW_BUDGET_MS = Number(process.env.MAGIC_ROW_BUDGET_MS || 15_000);
const POLL_MS = Number(process.env.MAGIC_POLL_MS || 2000);
const FETCH_TIMEOUT_MS = Number(process.env.MAGIC_FETCH_TIMEOUT_MS || 30_000);
const D1_NAME = process.env.MAGIC_D1_NAME || 'studioos-db';
const CF_API = 'https://api.cloudflare.com/client/v4';

/** Config this cannot run without. Missing config is never a pass. */
export function missingConfig(env = process.env) {
  return ['MAGIC_PROBE_EMAIL', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']
    .filter((k) => !String(env[k] || '').trim());
}

/**
 * The two verdicts, derived in one place so the report cannot contradict itself.
 *
 * Deliberately the same shape as the mailbox probe's `verdicts`, so a reader who
 * knows one knows the other — but with its own keys, because claiming
 * `mail_delivered` here would be a lie.
 */
export function verdicts({ startMs, rowFound, rowMs, startBudgetMs }) {
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
  ];
  return { rows, ok: rows.every((r) => r.ok) };
}

/**
 * Read a Cloudflare API envelope, distinguishing "cannot" from "did not".
 *
 * A 401/403 means the token lacks D1 access — the probe never ran its second
 * verdict, so the caller must exit 2. Anything else that fails is still a
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

async function maxTokenId(accountId, uuid, address) {
  const res = await fetch(`${CF_API}/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(uuid)}/query`, {
    method: 'POST',
    signal: timeout(),
    headers: cfHeaders(),
    // No token material is read — only the row id for this one address.
    body: JSON.stringify({ sql: 'SELECT MAX(id) AS id FROM magic_link_tokens WHERE email = ?', params: [address] }),
  });
  const body = await res.json().catch(() => null);
  const env = readEnvelope({ status: res.status, body });
  if (!env.ok) return env;
  const id = maxIdOf(env.result);
  if (id === null) return { ok: false, cannotRun: true, why: 'could not read a row id out of the D1 answer' };
  return { ok: true, id };
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

  // THE BASELINE COMES FIRST. Taken after the request, a row already present
  // would count as this run's own.
  const db = await databaseId(accountId);
  if (!db.ok) {
    console.error(`check-magic-link-insert: ${db.why}`);
    process.exit(2);
  }
  const before = await maxTokenId(accountId, db.uuid, address);
  if (!before.ok) {
    console.error(`check-magic-link-insert: ${before.why}`);
    process.exit(2);
  }
  console.log(`  baseline: highest row id for this address is ${before.id}`);

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
  const deadline = t1 + ROW_BUDGET_MS;
  for (;;) {
    const after = await maxTokenId(accountId, db.uuid, address);
    if (!after.ok) {
      // A read that fails mid-poll is still "could not run", not "no row".
      console.error(`check-magic-link-insert: ${after.why}`);
      process.exit(2);
    }
    if (after.id > before.id) { rowFound = true; rowMs = Date.now() - t1; break; }
    if (Date.now() >= deadline) break;
    await sleep(POLL_MS);
  }

  const { rows, ok } = verdicts({ startMs, rowFound, rowMs, startBudgetMs: START_BUDGET_MS });
  for (const r of rows) console.log(`  ${r.ok ? '✓' : '✗'} ${r.key}: ${r.detail}`);
  console.log('  NOT CHECKED HERE: delivery. Only check-magic-link-live.mjs can see that.');

  if (!ok) {
    console.error('check-magic-link-insert: FAILED.');
    process.exit(1);
  }
  console.log('check-magic-link-insert: OK — the endpoint answers and commits its token row.');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(`check-magic-link-insert: ${e.stack || e.message}`); process.exit(1); });
}
