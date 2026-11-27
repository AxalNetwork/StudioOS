// Reads the latest scheduled HQ check from `platform_settings` and verifies its
// exact token and send-log rows, mailbox, template and timing in D1. Exit 0
// requires four successful application checks.
//
// Read the scheduled Worker's magic-link result and its exact production D1 rows.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  databaseId, missingConfig, query, ROW_BUDGET_MS, SEND_BUDGET_MS, START_BUDGET_MS, TEMPLATE_KEY,
} from './check-magic-link-insert.mjs';

const PERIOD = 4 * 60 * 60_000;
const OFFSET = PERIOD - 15 * 60_000; // 03:45 UTC and every four hours thereafter.
const RECEIPT_SQL = "SELECT value FROM platform_settings WHERE key = 'magic_link_insert_canary_v1'";
// Always return one row. NULL ids show which exact record was absent or belonged to another address.
const EVIDENCE_SQL = `
  SELECT t.id AS token_id, unixepoch(t.created_at) * 1000 AS created_ms,
         s.id AS send_id, s.status, unixepoch(s.enqueued_at) * 1000 AS enqueued_ms,
         unixepoch(s.sent_at) * 1000 AS sent_ms
  FROM (SELECT 1) AS observation
  LEFT JOIN magic_link_tokens t ON t.id = ? AND t.email = ?
  LEFT JOIN email_send_log s ON s.id = ? AND s.to_addr = ? AND s.template_key = ?`;

export function latestCanarySlot(now) {
  return Math.floor((now - OFFSET) / PERIOD) * PERIOD + OFFSET;
}

const unobserved = (detail) => ({ code: 2, title: 'Incomplete observation', detail });
const failed = (detail) => ({ code: 1, title: 'Application check failed', detail });

export async function observeCanary(select, address, now = Date.now()) {
  const receipts = await select(RECEIPT_SQL, []);
  if (!receipts || receipts.length !== 1) return unobserved('The scheduled receipt is missing or D1 could not read it.');
  let receipt;
  try {
    receipt = JSON.parse(receipts[0].value);
  } catch {
    return unobserved('D1 returned an unreadable scheduled receipt.');
  }
  const slot = latestCanarySlot(now);
  const slotTime = new Date(slot).toISOString();
  if (receipt?.slot !== slot) return unobserved(`No receipt matches the expected UTC slot ${slotTime}.`);
  if (receipt.state === 'running') return unobserved(`The application check for ${slotTime} is still running.`);
  if (receipt.state === 'error') {
    if (receipt.startedAt === null) return unobserved(`The Worker missed the dispatch window for ${slotTime}.`);
    if (!Number.isSafeInteger(receipt.startedAt) || receipt.startedAt < slot || receipt.startedAt > now ||
        receipt.startStatus !== null || !Number.isSafeInteger(receipt.startMs) || receipt.startMs < 0) {
      return unobserved('The error receipt has invalid application dispatch evidence.');
    }
    return failed(`The Worker recorded an execution error for ${slotTime}. See its scheduled-event log.`);
  }
  if (receipt.state !== 'complete') return unobserved('The scheduled receipt has an unknown state.');
  const { startedAt, startMs, startStatus, tokenId, sendId } = receipt;
  if (!Number.isSafeInteger(startedAt) || startedAt < slot || startedAt > now ||
      !Number.isSafeInteger(startMs) || startMs < 0 || startedAt + startMs > now ||
      !Number.isInteger(startStatus) || startStatus < 100 || startStatus > 599) {
    return unobserved('The completed receipt contains an invalid start time, duration, or HTTP status.');
  }
  if (startStatus !== 202) return failed(`The application returned HTTP ${startStatus} after ${startMs} ms. Token and send checks were skipped.`);
  if ([tokenId, sendId].some((id) => id !== null && !(Number.isSafeInteger(id) && id > 0))) {
    return unobserved('The receipt contains an invalid token or send-log row ID.');
  }

  // D1's REST API takes string parameters. Zero cannot match a valid insert ID.
  const evidence = await select(EVIDENCE_SQL, [String(tokenId ?? 0), address, String(sendId ?? 0), address, TEMPLATE_KEY]);
  if (!evidence || evidence.length !== 1) return unobserved('D1 could not read the token and send-log evidence.');
  const row = evidence[0];
  // SQLite CURRENT_TIMESTAMP has one-second precision. Compare against the same second as dispatch.
  const startSecond = Math.floor(startedAt / 1000) * 1000;
  const tokenFound = tokenId !== null && row.token_id === tokenId;
  const sendFound = sendId !== null && row.send_id === sendId;
  const validTime = (value) => Number.isSafeInteger(value) && value >= startSecond && value <= now;
  if ((tokenFound && !validTime(row.created_ms)) || (sendFound && !validTime(row.enqueued_ms)) ||
      (sendFound && row.status === 'sent' && (!validTime(row.sent_ms) || row.sent_ms < row.enqueued_ms)) ||
      (sendFound && tokenFound && row.enqueued_ms < row.created_ms)) {
    return unobserved('D1 row timestamps are missing, out of order, or outside this application check.');
  }

  const failures = [];
  if (startMs > START_BUDGET_MS) failures.push(`start_latency took ${startMs} ms (budget ${START_BUDGET_MS} ms)`);
  if (!tokenFound) failures.push('token_row_written has no matching row for this receipt and address');
  else if (row.created_ms - startedAt > ROW_BUDGET_MS) failures.push(`token_row_written exceeded ${ROW_BUDGET_MS} ms`);
  if (!sendFound) failures.push('mail_send_recorded has no matching row for this receipt, address, and template');
  else if (row.status === 'queued' && now - startedAt <= SEND_BUDGET_MS && !failures.length) {
    return unobserved('The send is still queued within its observation budget.');
  } else if (row.status !== 'sent') {
    const state = ['queued', 'failed', 'dlq'].includes(row.status) ? row.status : 'unrecognized';
    failures.push(`mail_send_recorded has send-log state ${state}`);
  } else if (row.sent_ms - startedAt > SEND_BUDGET_MS) {
    failures.push(`mail_send_recorded exceeded ${SEND_BUDGET_MS} ms from application dispatch`);
  }
  if (failures.length) return failed(`HTTP 202. ${failures.join('. ')}.`);
  return {
    code: 0, title: 'Application checks passed',
    detail: `Slot ${slotTime}. HTTP 202 in ${startMs} ms. The token row matched and the send log reached sent ${(row.sent_ms - row.enqueued_ms) / 1000} s after enqueue.`,
  };
}

async function main() {
  const missing = missingConfig();
  if (missing.length) return unobserved(`Missing observer configuration: ${missing.join(', ')}.`);
  const account = process.env.CLOUDFLARE_ACCOUNT_ID.trim();
  const db = await databaseId(account);
  if (!db.ok) return unobserved('D1 database lookup failed. Check reader access, database configuration, and API availability.');
  const select = async (sql, params) => {
    const answer = await query(account, db.uuid, sql, params);
    const statement = answer.ok && Array.isArray(answer.result) && answer.result[0];
    return statement && statement.success !== false && Array.isArray(statement.results) ? statement.results : null;
  };
  return observeCanary(select, process.env.MAGIC_PROBE_EMAIL.trim().toLowerCase());
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const result = await main().catch(() => unobserved('The D1 observer failed before it could finish.'));
  const scope = 'Coverage is limited to the Worker application, token insertion, and provider handoff. Public-edge access, inbox delivery, and sign-in remain unverified.';
  console.log(`${result.title}. ${result.detail}\n${scope}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Scheduled magic-link application check\n\n**${result.title}**\n\n${result.detail}\n\n${scope}\n`);
  }
  process.exitCode = result.code;
}
