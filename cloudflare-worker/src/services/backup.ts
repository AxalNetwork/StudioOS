/**
 * Task #5 (IE) — Backup & DR.
 *
 * Daily KV snapshot job. The worker enumerates every non-ephemeral KV
 * namespace and dumps key/value pairs as JSONL to the `studioos-backups`
 * R2 bucket under `kv/<namespace>/<yyyy-mm-dd>.jsonl`.
 *
 * Why JSONL: line-delimited so streaming reads work; one row per key
 * means a single corrupt entry doesn't take down the whole snapshot.
 *
 * Ephemeral namespaces (RATE_LIMITS, TOKENS) are deliberately skipped:
 *   - RATE_LIMITS is throttling state (regenerates in ≤1h on restore).
 *   - TOKENS holds short-lived OAuth / refresh leases. Backing them up
 *     into a 365-day-retention bucket would persist live session
 *     material far past its natural TTL — a real security blast-radius
 *     hazard if the backup bucket is ever exfiltrated. They MUST stay
 *     out of long-retention storage.
 *
 * As of this task there are no truly non-ephemeral KV namespaces, so
 * `NON_EPHEMERAL_NAMESPACES` is intentionally empty — the runner is
 * still wired up so a future durable namespace (e.g. settings/state
 * cache) can be added by extending the array, with no code/cron change.
 *
 * D1 backups are NOT taken here. The Workers runtime has no native D1
 * export — the canonical path is the daily GitHub Actions job at
 * `.github/workflows/backup-d1.yml` which runs `wrangler d1 export`
 * and uploads to the same R2 bucket. See `documentation/operations/INCIDENT_RESPONSE.md` for
 * the full recovery flow.
 */
import type { Env } from '../types';

type R2BackupBucket = {
  put(key: string, value: string | ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
};

type AnyKV = {
  list(opts?: { cursor?: string; limit?: number }): Promise<{ keys: { name: string; expiration?: number; metadata?: unknown }[]; list_complete: boolean; cursor?: string }>;
  get(key: string): Promise<string | null>;
};

// Operator-configurable list of durable KV namespaces to snapshot.
// Read at call time from `env.BACKUP_KV_NAMESPACES` (comma-separated)
// so a new durable namespace can be opted in via `wrangler secret put`
// without a code change. Default is empty: as of Task #5 (IE) the only
// KV namespaces in this worker are TOKENS and RATE_LIMITS — both
// ephemeral and explicitly refused below.
function resolveBackupNamespaces(env: Env): string[] {
  const raw = (env as unknown as { BACKUP_KV_NAMESPACES?: string }).BACKUP_KV_NAMESPACES;
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
const EPHEMERAL_EXCLUDE = new Set(['TOKENS', 'RATE_LIMITS']);

function resolveBucket(env: Env): R2BackupBucket | null {
  const cast = env as unknown as Record<string, R2BackupBucket | undefined>;
  return cast.BACKUPS || null;
}

function isoDateUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Snapshot a single KV namespace to R2 as JSONL.
 * Returns the number of keys written and the R2 object key.
 */
export async function snapshotKvNamespace(env: Env, name: string): Promise<{ keys: number; objectKey: string } | null> {
  // Defence-in-depth: refuse to snapshot any namespace explicitly
  // marked ephemeral, even if a caller passes it directly. Prevents an
  // operator from accidentally backing up TOKENS/RATE_LIMITS via an
  // ad-hoc cron entry.
  if (EPHEMERAL_EXCLUDE.has(name)) {
    console.warn(`[backup] refusing to snapshot ephemeral namespace: ${name}`);
    return null;
  }
  const bucket = resolveBucket(env);
  if (!bucket) {
    console.warn('[backup] BACKUPS R2 binding missing — skipping KV snapshot');
    return null;
  }
  const kv = (env as unknown as Record<string, AnyKV | undefined>)[name];
  if (!kv) {
    console.warn('[backup] KV namespace not bound:', name);
    return null;
  }
  const chunks: string[] = [];
  let cursor: string | undefined;
  let count = 0;
  // Hard cap of 50k keys per namespace per snapshot. A healthy KV
  // namespace shouldn't approach this; if it does, alert and skip the
  // tail so the snapshot still lands rather than failing wholesale.
  const HARD_CAP = 50_000;
  for (;;) {
    const page = await kv.list({ cursor, limit: 1000 });
    for (const k of page.keys) {
      if (count >= HARD_CAP) break;
      try {
        const v = await kv.get(k.name);
        chunks.push(JSON.stringify({ k: k.name, v, exp: k.expiration ?? null }));
        count += 1;
      } catch (e) {
        // Skip un-readable keys but keep snapshotting the rest.
        chunks.push(JSON.stringify({ k: k.name, error: String(e) }));
      }
    }
    if (page.list_complete || !page.cursor || count >= HARD_CAP) break;
    cursor = page.cursor;
  }
  const body = chunks.join('\n');
  const objectKey = `kv/${name}/${isoDateUTC()}.jsonl`;
  await bucket.put(objectKey, body, { httpMetadata: { contentType: 'application/x-ndjson' } });
  return { keys: count, objectKey };
}

/**
 * Run the daily KV snapshot across every non-ephemeral namespace.
 * Called from the scheduled() cron at 02:00 UTC.
 */
export async function runDailyKvSnapshot(env: Env): Promise<{ ok: number; failed: number; objects: string[]; configured: number }> {
  const targets = resolveBackupNamespaces(env);
  const results: string[] = [];
  let ok = 0;
  let failed = 0;
  if (targets.length === 0) {
    // Reviewer requirement: when no durable namespaces are configured,
    // emit a loud warning so /api/admin/backup-status (and the pager)
    // can flag that the KV-backup half of the daily job did nothing.
    // This intentionally does NOT throw — D1 backups still proceed —
    // but it does NOT write a "fresh" heartbeat either (see caller in
    // index.ts which only beats heartbeat-kv.json on `ok > 0`).
    console.warn('[backup] no durable KV namespaces configured (BACKUP_KV_NAMESPACES empty) — KV snapshot is a no-op');
    return { ok: 0, failed: 0, objects: [], configured: 0 };
  }
  for (const name of targets) {
    try {
      const r = await snapshotKvNamespace(env, name);
      if (r) {
        results.push(`${r.objectKey} (${r.keys} keys)`);
        ok += 1;
      } else {
        // null = refused (ephemeral) or missing binding — count as failed
        // so the heartbeat doesn't advance.
        failed += 1;
      }
    } catch (e) {
      console.error(`[backup] KV snapshot failed for ${name}:`, e);
      failed += 1;
    }
  }
  return { ok, failed, objects: results, configured: targets.length };
}

/**
 * Best-effort D1 schema snapshot fallback. The canonical D1 backup path
 * is the GitHub Actions job (wrangler d1 export → R2 put). This function
 * writes a small marker file to R2 noting the last time a backup was
 * attempted from the worker side — useful so /api/admin/backup-status
 * can report when GH Actions last ran (the file is overwritten by the
 * GH Actions job too, with the canonical timestamp).
 */
export async function writeBackupHeartbeat(
  env: Env,
  source: 'worker_cron' | 'gha',
  kind: 'kv' | 'd1' = 'kv',
  extra: Record<string, unknown> = {},
): Promise<void> {
  // Reviewer requirement: kv and d1 heartbeats are written to SEPARATE
  // keys so a stale D1 backup can't be masked by a healthy KV beat.
  // - `heartbeat-kv.json` — written by worker cron at 02:00 UTC, only
  //   on `ok > 0` (i.e. an actual snapshot landed).
  // - `heartbeat-d1.json` — written by .github/workflows/backup-d1.yml
  //   only after the R2 put succeeds.
  // The legacy `heartbeat.json` key is no longer written by either
  // path; admin UI consumers must read both kv + d1 keys independently.
  const bucket = resolveBucket(env);
  if (!bucket) return;
  const payload = JSON.stringify({
    at: new Date().toISOString(),
    source,
    kind,
    env: (env as unknown as { ENVIRONMENT?: string }).ENVIRONMENT || 'unknown',
    ...extra,
  });
  const key = kind === 'd1' ? 'heartbeat-d1.json' : 'heartbeat-kv.json';
  try {
    await bucket.put(key, payload, { httpMetadata: { contentType: 'application/json' } });
  } catch (e) {
    console.warn(`[backup] heartbeat write failed (${key})`, e);
  }
}
