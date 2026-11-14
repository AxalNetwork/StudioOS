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
  // D200 — `BACKUPS` is a typed field on Env now (it always was a declared
  // binding in both wrangler.toml tables); the cast this used to reach it
  // through is gone.
  return env.BACKUPS || null;
}

/**
 * D4691 — EVIDENCE IS VALIDATED, VERSIONED AND DATED BEFORE IT IS BELIEVED.
 *
 * The two markers this file reads are written outside the Worker (the backup
 * workflow and the restore drill), so their content is evidence, not a
 * status. Before D4691 any JSON object read as a recorded export, and a passed
 * drill read as passed however long ago it ran. Now each marker is checked
 * against an explicit schema, by version, and then against a freshness
 * window, and the answer says which of those it failed:
 *
 *   unreadable  the bucket is unbound or the read threw: nothing was read.
 *   invalid     something was read and it is not the evidence it claims to
 *               be: not JSON, not an object, an unknown schema version, a
 *               required field missing or of the wrong type, fields that
 *               contradict each other, or a time in the future.
 *   stale       valid, and older than its window: it says what happened then
 *               and nothing about now.
 *
 * VERSIONS. Schema 1 is the shape each writer produced before versions were
 * stamped, so a marker with no `schema_version` is read as version 1 and says
 * `versioned: false`; the writers now stamp `schema_version: 1`. Any other
 * version is invalid until a reader for it exists here — a newer writer is not
 * trusted by an older reader.
 *
 * WINDOWS, derived from the schedules and the recovery-point target the
 * runbook states (documentation/operations/D1_RECOVERY.md: RPO 24 h; the
 * export runs daily, the drill monthly), not chosen here:
 *   BACKUP_STALE_AFTER_HOURS  the 24-hour RPO plus the two hours the daily
 *                             export is given to run.
 *   DRILL_STALE_AFTER_DAYS    the longest gap between two monthly runs, 31
 *                             days, plus one day for the run itself.
 */
export const EVIDENCE_SCHEMA_VERSION = 1;
export const BACKUP_STALE_AFTER_HOURS = 26;
export const DRILL_STALE_AFTER_DAYS = 32;
/** A marker stamped later than this past now is invalid: clocks drift, evidence does not come from the future. */
const FUTURE_SKEW_MS = 5 * 60_000;

/**
 * D263 — the restore drill's outcome, read from the marker it writes.
 *
 * `scripts/dr-drill.sh` writes `drill-d1.json` to the backups bucket from its
 * EXIT trap on every exit, pass or fail. States, each its own claim, and none
 * inferred from the backup half:
 *   unreadable       no binding, or the read threw;
 *   invalid          read, but not a drill marker of a known version (D4691);
 *   never_run        the bucket answered and holds no marker;
 *   last_run_failed  the marker says failed, with the step and exit code;
 *   last_run_passed  the marker says passed, with the backup it restored.
 * The last two carry `fresh`: a pass older than DRILL_STALE_AFTER_DAYS is
 * still a pass, but it does not vouch for recovery today, and the page says so.
 * No reason string carries a count: a count belongs in a D-entry, where it
 * does not go stale.
 */
export const RESTORE_DRILL_KEY = 'drill-d1.json';

export type RestoreDrill =
  | { available: false; state: 'unreadable' | 'invalid'; reason: string }
  | { available: true; state: 'never_run'; reason: string }
  | {
      available: true;
      state: 'last_run_failed' | 'last_run_passed';
      schema_version: number;
      versioned: boolean;
      at: string;
      age_days: number;
      stale_after_days: number;
      fresh: boolean;
      step: string | null;
      exit_code: number;
      backup_key: string | null;
      duration_s: number | null;
      source: string | null;
      run_id: string | null;
      rpo_met: boolean | null;
      rto_met: boolean | null;
      /** D4803 — what the drill wrote as its failure reason (FAIL_REASON), one line; null when it wrote none. */
      reason: string | null;
      /** The recovery point the drill restored, the migration it ended on and the tables it counted. */
      recovery_point: string | null;
      migration: string | null;
      tables: number | null;
    };

/** D4803 — the longest failure reason the page shows; the drill writes one short line. */
export const DRILL_REASON_MAX = 300;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ISO_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** An ISO-8601 stamp with a zone, as epoch ms; NaN for anything else. */
function isoMs(v: unknown): number {
  return typeof v === 'string' && ISO_STAMP.test(v) ? Date.parse(v) : NaN;
}

type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };
const bad = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** The schema version a marker declares, or the reason it cannot be read as one this reader knows. */
function versionOf(body: Record<string, unknown>): Checked<{ version: number; versioned: boolean }> {
  if (body.schema_version === undefined || body.schema_version === null) {
    return { ok: true, value: { version: EVIDENCE_SCHEMA_VERSION, versioned: false } };
  }
  if (body.schema_version !== EVIDENCE_SCHEMA_VERSION) {
    return bad(`it declares schema version ${JSON.stringify(body.schema_version)}, which this reader does not know`);
  }
  return { ok: true, value: { version: EVIDENCE_SCHEMA_VERSION, versioned: true } };
}

/** A stamp that must be present, zoned, and not in the future. */
function stampOf(v: unknown, field: string, now: number): Checked<number> {
  const ms = isoMs(v);
  if (Number.isNaN(ms)) return bad(`\`${field}\` is not an ISO-8601 time with a zone`);
  if (ms > now + FUTURE_SKEW_MS) return bad(`\`${field}\` is in the future`);
  return { ok: true, value: ms };
}

export type DrillMarkerV1 = {
  schema_version: number; versioned: boolean; at: string; atMs: number; outcome: 'passed' | 'failed';
  exit_code: number; step: string | null; backup_key: string | null; duration_s: number | null;
  source: string | null; run_id: string | null; rpo_met: boolean | null; rto_met: boolean | null;
  reason: string | null; recovery_point: string | null; migration: string | null; tables: number | null;
};

/** D4691 — schema 1 of the restore drill's marker. Pure, so a test can hand it any object. */
export function validateDrillMarker(raw: unknown, now: number = Date.now()): Checked<DrillMarkerV1> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('the marker is not a JSON object');
  const body = raw as Record<string, unknown>;
  const v = versionOf(body);
  if (!v.ok) return v;
  if (body.outcome !== 'passed' && body.outcome !== 'failed') {
    return bad(`it names an outcome the drill never writes (${JSON.stringify(body.outcome ?? null)})`);
  }
  const at = stampOf(body.at, 'at', now);
  if (!at.ok) return at;
  const exit = body.exit_code;
  if (typeof exit !== 'number' || !Number.isInteger(exit)) return bad('`exit_code` is not a whole number');
  if ((body.outcome === 'passed') !== (exit === 0)) {
    return bad('its outcome and its exit code disagree');
  }
  if (body.outcome === 'passed' && !str(body.backup_key)) return bad('a passed run names no backup it restored');
  for (const f of ['rpo_met', 'rto_met'] as const) {
    if (body[f] !== undefined && body[f] !== null && typeof body[f] !== 'boolean') return bad(`\`${f}\` is not true, false or null`);
  }
  for (const f of ['step', 'backup_key', 'source'] as const) {
    if (body[f] !== undefined && body[f] !== null && typeof body[f] !== 'string') return bad(`\`${f}\` is not text`);
  }
  if (body.duration_s !== undefined && body.duration_s !== null && (int(body.duration_s) === null || (body.duration_s as number) < 0)) {
    return bad('`duration_s` is not a non-negative number');
  }
  // D4803 — the fields SE09 draws beside the step. Each is optional (older
  // markers carry none), and each is checked for its kind, never trusted.
  for (const f of ['reason', 'migration'] as const) {
    if (body[f] !== undefined && body[f] !== null && typeof body[f] !== 'string') return bad(`\`${f}\` is not text`);
  }
  if (body.recovery_point !== undefined && body.recovery_point !== null && Number.isNaN(isoMs(body.recovery_point))) {
    return bad('`recovery_point` is not an ISO-8601 time with a zone');
  }
  if (body.tables !== undefined && body.tables !== null && (int(body.tables) === null || (body.tables as number) < 0)) {
    return bad('`tables` is not a non-negative number');
  }
  // One line, at most DRILL_REASON_MAX characters: a reason is a sentence the
  // drill wrote, never a log; anything longer is cut and says so.
  const rawReason = str(body.reason);
  const oneLine = rawReason ? rawReason.replace(/\s+/g, ' ').trim() : null;
  const reason = oneLine && oneLine.length > DRILL_REASON_MAX ? `${oneLine.slice(0, DRILL_REASON_MAX - 1)}…` : oneLine || null;
  return {
    ok: true,
    value: {
      schema_version: v.value.version,
      versioned: v.value.versioned,
      at: body.at as string,
      atMs: at.value,
      outcome: body.outcome,
      exit_code: exit,
      step: str(body.step),
      backup_key: str(body.backup_key),
      duration_s: int(body.duration_s),
      source: str(body.source),
      run_id: body.run_id === null || body.run_id === undefined ? null : String(body.run_id),
      rpo_met: typeof body.rpo_met === 'boolean' ? body.rpo_met : null,
      rto_met: typeof body.rto_met === 'boolean' ? body.rto_met : null,
      reason,
      recovery_point: str(body.recovery_point),
      migration: str(body.migration),
      tables: int(body.tables),
    },
  };
}

export async function readRestoreDrill(env: Env, now: number = Date.now()): Promise<RestoreDrill> {
  const bucket = env.BACKUPS;
  if (!bucket) {
    return {
      available: false,
      state: 'unreadable',
      reason: 'The BACKUPS R2 binding is not bound on this deployment, so the restore drill\'s marker cannot be read here.',
    };
  }
  let obj: { json<T>(): Promise<T> } | null;
  try {
    obj = await bucket.get(RESTORE_DRILL_KEY);
  } catch (e) {
    return {
      available: false,
      state: 'unreadable',
      reason: `The restore drill's marker could not be read (${e instanceof Error ? e.message : String(e)}).`,
    };
  }
  if (!obj) {
    return {
      available: true,
      state: 'never_run',
      reason: `No ${RESTORE_DRILL_KEY} has been written to the backups bucket, so no restore drill has recorded a run.`,
    };
  }
  let parsed: unknown;
  try {
    parsed = await obj.json<unknown>();
  } catch {
    return { available: false, state: 'invalid', reason: 'The restore drill\'s marker is not valid JSON, so it records nothing.' };
  }
  const checked = validateDrillMarker(parsed, now);
  if (!checked.ok) {
    return { available: false, state: 'invalid', reason: `The restore drill's marker is not valid evidence: ${checked.reason}.` };
  }
  const m = checked.value;
  const ageDays = Math.max(0, (now - m.atMs) / 86_400_000);
  return {
    available: true,
    state: m.outcome === 'passed' ? 'last_run_passed' : 'last_run_failed',
    schema_version: m.schema_version,
    versioned: m.versioned,
    at: m.at,
    age_days: Math.floor(ageDays),
    stale_after_days: DRILL_STALE_AFTER_DAYS,
    fresh: ageDays <= DRILL_STALE_AFTER_DAYS,
    step: m.step,
    exit_code: m.exit_code,
    backup_key: m.backup_key,
    duration_s: m.duration_s,
    source: m.source,
    run_id: m.run_id,
    rpo_met: m.rpo_met,
    rto_met: m.rto_met,
    reason: m.reason,
    recovery_point: m.recovery_point,
    migration: m.migration,
    tables: m.tables,
  };
}

export const DRILL_HISTORY_PREFIX = 'drill-d1-history/';
export const DRILL_HISTORY_LIMIT = 12;

type DrillHistoryEntry = Pick<DrillMarkerV1,
  'at' | 'outcome' | 'step' | 'exit_code' | 'reason' | 'duration_s' | 'recovery_point' | 'run_id'
> & { id: string; fresh: boolean };

/** D5317 — the newest bounded set of per-run objects, independent of the latest marker. */
export async function readRestoreDrillHistory(env: Env, now: number = Date.now()): Promise<
  { available: true; rows: DrillHistoryEntry[]; partial?: true } | { available: false; reason: string }
> {
  const bucket = env.BACKUPS;
  const unavailable = { available: false as const, reason: 'The restore drill history could not be read.' };
  if (!bucket) return unavailable;
  try {
    const objects: R2Object[] = [];
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: DRILL_HISTORY_PREFIX, limit: DRILL_HISTORY_LIMIT - objects.length, cursor });
      objects.push(...page.objects);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor && objects.length < DRILL_HISTORY_LIMIT);
    const reads = await Promise.allSettled(objects.map(async ({ key, size }) => {
      if (size > 16_384) throw new Error('Oversized drill record');
      const obj = await bucket.get(key);
      const checked = validateDrillMarker(await obj?.json(), now);
      if (!checked.ok) throw new Error('Invalid drill record');
      const { at, atMs, outcome, step, exit_code, reason, duration_s, recovery_point, run_id } = checked.value;
      return { id: key.slice(DRILL_HISTORY_PREFIX.length), at, outcome, step, exit_code, reason, duration_s,
        recovery_point, run_id, fresh: now - atMs <= DRILL_STALE_AFTER_DAYS * 86_400_000 };
    }));
    const rows = reads.flatMap((read) => read.status === 'fulfilled' ? [read.value] : []);
    // A concurrent prune or bad object should not hide verified rows. Only a
    // successful empty listing can say there are no recorded runs.
    if (objects.length > 0 && rows.length === 0) return unavailable;
    rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return rows.length < objects.length ? { available: true, rows, partial: true } : { available: true, rows };
  } catch {
    return unavailable;
  }
}

export type BackupHeartbeat =
  | {
      available: true;
      state: 'fresh' | 'stale';
      fresh: boolean;
      schema_version: number;
      versioned: boolean;
      kind: 'd1' | 'kv';
      at: string;
      /** The recovery point the export captured, when the heartbeat names one; else the heartbeat's own stamp. */
      recovery_point: string;
      age_hours: number;
      stale_after_hours: number;
      source: string;
      key: string | null;
      size_bytes: number | null;
      sha256: string | null;
    }
  | { available: false; state: 'unreadable' | 'never_written' | 'invalid'; reason: string };

export type HeartbeatV1 = {
  schema_version: number; versioned: boolean; kind: 'd1' | 'kv'; at: string; recovery_point: string;
  recoveryMs: number; source: string; key: string | null; size_bytes: number | null; sha256: string | null;
};

/**
 * D4691 — schema 1 of a backup heartbeat. A D1 heartbeat must name the object
 * it vouches for and a non-zero size, because an export of nothing is not a
 * backup; a KV heartbeat (the worker's own cron) names its time and source.
 */
export function validateHeartbeat(raw: unknown, kind: 'd1' | 'kv', now: number = Date.now()): Checked<HeartbeatV1> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('the heartbeat is not a JSON object');
  const body = raw as Record<string, unknown>;
  const v = versionOf(body);
  if (!v.ok) return v;
  if (body.kind !== kind) return bad(`it is not a ${kind} heartbeat (kind ${JSON.stringify(body.kind ?? null)})`);
  const at = stampOf(body.at, 'at', now);
  if (!at.ok) return at;
  if (!str(body.source)) return bad('it names no source');
  let key: string | null = null;
  let size: number | null = null;
  if (kind === 'd1') {
    key = str(body.key);
    if (!key || !key.startsWith('d1/')) return bad('it names no D1 backup object');
    size = int(body.size_bytes);
    if (size === null || size <= 0) return bad('`size_bytes` is not a positive number');
  }
  let sha: string | null = null;
  if (body.sha256 !== undefined && body.sha256 !== null) {
    if (typeof body.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(body.sha256)) return bad('`sha256` is not a SHA-256 digest');
    sha = body.sha256;
  }
  let recoveryPoint = body.at as string;
  let recoveryMs = at.value;
  if (body.exported_at !== undefined && body.exported_at !== null) {
    const ex = stampOf(body.exported_at, 'exported_at', now);
    if (!ex.ok) return ex;
    if (ex.value > at.value + FUTURE_SKEW_MS) return bad('its export started after the heartbeat was written');
    recoveryPoint = body.exported_at as string;
    recoveryMs = ex.value;
  }
  return {
    ok: true,
    value: {
      schema_version: v.value.version, versioned: v.value.versioned, kind, at: body.at as string,
      recovery_point: recoveryPoint, recoveryMs, source: body.source as string, key, size_bytes: size, sha256: sha,
    },
  };
}

/**
 * D200 — the READ half of the heartbeat `writeBackupHeartbeat` documents.
 * `heartbeat-d1.json` is written by .github/workflows/backup-d1.yml after a
 * successful R2 put; `heartbeat-kv.json` by the 02:00 worker cron. The binding
 * absent, the read failed, nothing ever written, and (D4691) a heartbeat that
 * is not valid evidence are each `available: false` with their own `state`; a
 * valid one is `fresh` or `stale` against BACKUP_STALE_AFTER_HOURS, measured
 * from the recovery point it names. Never a zero, never a green light inferred
 * from nothing.
 */
export async function readBackupHeartbeat(env: Env, kind: 'd1' | 'kv' = 'd1', now: number = Date.now()): Promise<BackupHeartbeat> {
  const bucket = env.BACKUPS;
  if (!bucket) {
    return {
      available: false,
      state: 'unreadable',
      reason: 'The BACKUPS R2 binding is not bound on this deployment, so the backup heartbeat cannot be read here.',
    };
  }
  const key = kind === 'd1' ? 'heartbeat-d1.json' : 'heartbeat-kv.json';
  let obj: { json<T>(): Promise<T> } | null;
  try {
    obj = await bucket.get(key);
  } catch (e) {
    return {
      available: false,
      state: 'unreadable',
      reason: `The backup heartbeat could not be read (${e instanceof Error ? e.message : String(e)}).`,
    };
  }
  if (!obj) {
    return {
      available: false,
      state: 'never_written',
      reason: `No ${key} has ever been written to the backups bucket, so no export has recorded a run.`,
    };
  }
  let parsed: unknown;
  try {
    parsed = await obj.json<unknown>();
  } catch {
    return { available: false, state: 'invalid', reason: `${key} is not valid JSON, so it records no export.` };
  }
  const checked = validateHeartbeat(parsed, kind, now);
  if (!checked.ok) return { available: false, state: 'invalid', reason: `${key} is not valid evidence: ${checked.reason}.` };
  const h = checked.value;
  const ageHours = Math.max(0, (now - h.recoveryMs) / 3_600_000);
  const fresh = ageHours <= BACKUP_STALE_AFTER_HOURS;
  return {
    available: true,
    state: fresh ? 'fresh' : 'stale',
    fresh,
    schema_version: h.schema_version,
    versioned: h.versioned,
    kind,
    at: h.at,
    recovery_point: h.recovery_point,
    age_hours: Math.floor(ageHours),
    stale_after_hours: BACKUP_STALE_AFTER_HOURS,
    source: h.source,
    key: h.key,
    size_bytes: h.size_bytes,
    sha256: h.sha256,
  };
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
      console.error('[backup] KV snapshot failed', name, e);
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
    // D4691 — the schema `validateHeartbeat` reads it by.
    schema_version: EVIDENCE_SCHEMA_VERSION,
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
    console.warn('[backup] heartbeat write failed', key, e);
  }
}
