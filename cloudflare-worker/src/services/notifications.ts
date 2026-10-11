// Epic 5 — Admin alerts for tampered/anomalous scores.
//
// One surface: a real-time notification + email when admin_review_status
// flips to 'flagged' (anomaly detection or HMAC mismatch). The daily digest
// of flagged snapshots unreviewed for >24h was retired by D671 (#1540).
//
// Idempotency model: every notification carries a `dedupe_key`, and the
// (user_id, kind, dedupe_key) tuple is UNIQUE. We use `INSERT OR IGNORE`
// and gate email on whether the row was actually inserted (`meta.changes
// === 1`). This makes the whole notify call atomic and safe under
// concurrent submit + nightly audit + retried jobs.
import type { Env } from '../types';
import { sendFlaggedScoreEmail } from './email';
import { bindingKey } from '../util/schemaBootstrap';

const NOTIFY_KIND_FLAGGED = 'flagged_score_alert';

const NOTIF_MIGRATED = new WeakMap<object, boolean>();
async function ensureNotificationsSchema(env: Env): Promise<boolean> {
  if (NOTIF_MIGRATED.get(bindingKey(env))) return true;
  // Each step must succeed; if any throws, leave the flag false so the
  // next call retries. Notify callers fail closed (return false from
  // insert helper) when the schema isn't ready.
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS notifications (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         user_id INTEGER NOT NULL,
         kind TEXT NOT NULL,
         title TEXT NOT NULL,
         body TEXT,
         link TEXT,
         meta TEXT,
         dedupe_key TEXT,
         read_at TIMESTAMP,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
       )`,
    ).run();
    // Older deployments may have the table without dedupe_key; add it.
    try { await env.DB.prepare(`ALTER TABLE notifications ADD COLUMN dedupe_key TEXT`).run(); } catch {}
    await env.DB.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe
         ON notifications(user_id, kind, dedupe_key)`,
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
         ON notifications(user_id, read_at, created_at)`,
    ).run();
    NOTIF_MIGRATED.set(bindingKey(env), true);
    return true;
  } catch (e) {
    console.error('[notifications] schema migration failed', e);
    return false;
  }
}

async function getAdmins(env: Env): Promise<Array<{ id: number; email: string; name: string | null }>> {
  try {
    const r: any = await env.DB.prepare(
      `SELECT id, email, name FROM users WHERE role = 'admin' AND is_active = 1`,
    ).all();
    return (r?.results || []) as any[];
  } catch {
    return [];
  }
}

interface FlaggedAlert {
  snapshotId: number;
  projectId: number;
  projectName: string | null;
  totalScore: number | null;
  flags: Array<{ type?: string; severity?: string; detail?: string } | string>;
  source: 'submit' | 'hash_audit';
}

function summarizeFlags(flags: FlaggedAlert['flags']): string[] {
  return flags.map(f => {
    if (typeof f === 'string') return f;
    if (f?.type) return f.severity ? `${f.type} (${f.severity})` : f.type;
    return JSON.stringify(f);
  });
}

/**
 * Atomic insert; returns true iff a NEW row was inserted (i.e. this
 * caller "won" the dedupe race and is responsible for sending email).
 */
async function insertNotificationOnce(
  env: Env,
  userId: number,
  kind: string,
  dedupeKey: string,
  title: string,
  body: string,
  link: string,
  metaJson: string,
): Promise<boolean> {
  try {
    const r: any = await env.DB.prepare(
      `INSERT OR IGNORE INTO notifications (user_id, kind, dedupe_key, title, body, link, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(userId, kind, dedupeKey, title, body, link, metaJson).run();
    // D1 surfaces affected rows on `meta.changes` (or `meta.rows_written`).
    const changes = r?.meta?.changes ?? r?.meta?.rows_written ?? 0;
    return Number(changes) === 1;
  } catch (e) {
    console.error('[notifications] insert failed', e);
    return false;
  }
}

/**
 * Fire an admin alert whenever a score row transitions to `flagged`.
 * Idempotent per (admin, snapshot, source): re-runs (e.g. retried hash
 * audit batches) won't double-page.
 */
export async function notifyAdminsOfFlaggedScore(env: Env, alert: FlaggedAlert): Promise<void> {
  const ready = await ensureNotificationsSchema(env);
  if (!ready) return;
  const admins = await getAdmins(env);
  if (admins.length === 0) return;

  const summary = summarizeFlags(alert.flags);
  const title = `Score flagged for review: ${alert.projectName || `project #${alert.projectId}`}`;
  const body = `Snapshot #${alert.snapshotId} (score ${alert.totalScore ?? '?'}) — ${summary.join(', ') || 'integrity issue'}`;
  const link = `/monitoring?tab=integrity&snapshot=${alert.snapshotId}`;
  const metaJson = JSON.stringify({
    snapshot_id: alert.snapshotId,
    project_id: alert.projectId,
    project_name: alert.projectName,
    total_score: alert.totalScore,
    flags: summary,
    source: alert.source,
  });
  // Per-admin dedupe key. Includes source so a snapshot legitimately
  // re-flagged by a different surface (e.g. submit then later hash audit)
  // still pages — but identical retries within the same surface don't.
  const dedupeKey = `snap:${alert.snapshotId}:${alert.source}`;

  const appUrl = env.APP_URL || 'https://axal.vc';
  const reviewUrl = `${appUrl.replace(/\/$/, '')}${link}`;

  for (const admin of admins) {
    const inserted = await insertNotificationOnce(
      env, admin.id, NOTIFY_KIND_FLAGGED, dedupeKey, title, body, link, metaJson,
    );
    if (!inserted) continue; // dedupe — another worker already paged this admin
    try {
      await sendFlaggedScoreEmail(env, admin.email, admin.name || admin.email, {
        projectName: alert.projectName || `project #${alert.projectId}`,
        snapshotId: alert.snapshotId,
        totalScore: alert.totalScore,
        flagSummary: summary,
        reviewUrl,
        source: alert.source,
      });
    } catch (e) {
      console.error('[notifications] admin alert email failed', e);
    }
  }
}
