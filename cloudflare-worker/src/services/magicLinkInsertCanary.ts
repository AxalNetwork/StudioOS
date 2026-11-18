/** Scheduled origin measurement for the magic-link insert probe (#1008). */
import type { Env } from '../types';

const RECEIPT_KEY = 'magic_link_insert_canary_v1';
const MAX_START_DELAY_MS = 5 * 60_000;

interface InsertCanaryRows {
  tokenId: number | null;
  sendId: number | null;
}

interface InsertCanaryReceipt extends InsertCanaryRows {
  slot: number;
  state: 'running' | 'complete' | 'error';
  startedAt: number | null;
  startMs: number | null;
  startStatus: number | null;
}

// Only this module can register a Request. The auth handler can attach the
// exact row identities without putting either ID in the public response.
const requests = new WeakMap<Request, InsertCanaryRows>();
export function insertCanaryRows(request: Request): InsertCanaryRows | undefined {
  return requests.get(request);
}

export async function runMagicLinkInsertCanary(
  env: Env,
  scheduledTime: number,
  dispatch: (request: Request) => Promise<Response>,
  now = Date.now,
): Promise<void> {
  const address = env.MAGIC_INSERT_CANARY_EMAIL?.trim().toLowerCase();
  if (env.ENVIRONMENT !== 'production' || env.BRANCH_CODE || !address || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) return;
  const slot = Math.floor(scheduledTime / 60_000) * 60_000;
  const minute = new Date(slot);
  if (minute.getUTCMinutes() !== 45 || minute.getUTCHours() % 4 !== 3) return;
  const lag = now() - slot;
  if (lag < 0 || lag >= MAX_START_DELAY_MS) return;

  const receipt: InsertCanaryReceipt = {
    slot, state: 'running', startedAt: null, startMs: null, startStatus: null, tokenId: null, sendId: null,
  };
  const claim = JSON.stringify(receipt);
  // A retry of an ambiguous write cannot send a second link. Later slots
  // supersede even an unfinished run, so a crashed isolate cannot block them.
  const claimed = await env.DB.prepare(
    `INSERT INTO platform_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
     WHERE json_extract(platform_settings.value, '$.slot') < ?`,
  ).bind(RECEIPT_KEY, claim, slot).run();
  if (claimed.meta.changes !== 1) return;

  const request = new Request('https://axal.vc/api/auth/magic/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: address }),
  });
  const startedAt = now();
  receipt.state = 'error';
  if (startedAt >= slot && startedAt - slot < MAX_START_DELAY_MS) {
    receipt.startedAt = startedAt;
    requests.set(request, receipt);
    try {
      const response = await dispatch(request);
      receipt.startStatus = response.status;
      receipt.state = 'complete';
    } catch {
      // The public response and thrown exceptions can contain sensitive details.
      // The monitor stores only the observed status, duration and row identities.
    } finally {
      receipt.startMs = now() - startedAt;
      requests.delete(request);
    }
  }
  // A late completion must never overwrite a newer claim.
  await env.DB.prepare(
    'UPDATE platform_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ? AND value = ?',
  ).bind(JSON.stringify(receipt), RECEIPT_KEY, claim).run();
}
