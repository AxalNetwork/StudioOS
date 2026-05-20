// Epic 5 — Admin alerts for tampered/anomalous scores.
//
// Two surfaces:
//   1. Real-time notification + email when admin_review_status flips to
//      'flagged' (anomaly detection or HMAC mismatch).
//   2. Daily digest summarising any flagged snapshots that have sat
//      unreviewed for >24h, so they don't quietly age out.
//
// Idempotency model: every notification carries a `dedupe_key`, and the
// (user_id, kind, dedupe_key) tuple is UNIQUE. We use `INSERT OR IGNORE`
// and gate email on whether the row was actually inserted (`meta.changes
// === 1`). This makes the whole notify call atomic and safe under
// concurrent submit + nightly audit + retried jobs.
import type { Env } from '../types';
import { sendFlaggedScoreEmail, sendFlaggedScoreDigestEmail } from './email';

const NOTIFY_KIND_FLAGGED = 'flagged_score_alert';
const NOTIFY_KIND_DIGEST = 'flagged_score_digest';

let notifMigrated = false;
async function ensureNotificationsSchema(env: Env): Promise<boolean> {
  if (notifMigrated) return true;
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
    notifMigrated = true;
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

  const appUrl = env.APP_URL || 'https://app.axal.vc';
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

/**
 * Daily digest: every flagged snapshot still sitting at admin_review_status='flagged'
 * older than 24h gets summarised once per admin per UTC day. Dedupe ledger
 * lives in the same notifications table (kind=flagged_score_digest) keyed
 * on the UTC date so concurrent cron drains can't double-send.
 */
export async function digestUnreviewedFlaggedScores(env: Env): Promise<{ admins: number; items: number }> {
  const ready = await ensureNotificationsSchema(env);
  if (!ready) return { admins: 0, items: 0 };
  const admins = await getAdmins(env);
  if (admins.length === 0) return { admins: 0, items: 0 };

  let items: any[] = [];
  try {
    const r: any = await env.DB.prepare(
      `SELECT s.id AS snapshot_id, s.project_id, s.total_score, s.created_at,
              s.anomaly_flags, p.name AS project_name
         FROM score_snapshots s
         LEFT JOIN projects p ON p.id = s.project_id
        WHERE s.admin_review_status = 'flagged'
          AND s.is_sandbox = 0
          AND s.created_at < datetime('now', '-1 day')
        ORDER BY s.created_at ASC
        LIMIT 200`,
    ).all();
    items = r?.results || [];
  } catch (e) {
    console.error('[notifications] digest query failed', e);
    return { admins: admins.length, items: 0 };
  }
  if (items.length === 0) return { admins: admins.length, items: 0 };

  const summarised = items.map((row: any) => {
    let flags: any[] = [];
    try { flags = row.anomaly_flags ? JSON.parse(row.anomaly_flags) : []; } catch {}
    return {
      snapshot_id: row.snapshot_id,
      project_id: row.project_id,
      project_name: row.project_name || `project #${row.project_id}`,
      total_score: row.total_score,
      created_at: row.created_at,
      flag_summary: summarizeFlags(flags),
    };
  });

  const appUrl = env.APP_URL || 'https://app.axal.vc';
  const queueUrl = `${appUrl.replace(/\/$/, '')}/monitoring?tab=integrity`;
  const dedupeKey = `digest:${new Date().toISOString().slice(0, 10)}`; // YYYY-MM-DD UTC

  const title = `${summarised.length} flagged score${summarised.length === 1 ? '' : 's'} awaiting review`;
  const body = summarised.slice(0, 5)
    .map(it => `• ${it.project_name} — snapshot #${it.snapshot_id} (${it.flag_summary.join(', ') || 'integrity issue'})`)
    .join('\n');
  const metaJson = JSON.stringify({
    count: summarised.length,
    snapshot_ids: summarised.map(s => s.snapshot_id),
    digest_date: dedupeKey.slice('digest:'.length),
  });

  for (const admin of admins) {
    const inserted = await insertNotificationOnce(
      env, admin.id, NOTIFY_KIND_DIGEST, dedupeKey, title, body, queueUrl, metaJson,
    );
    if (!inserted) continue; // already digested this admin today
    try {
      await sendFlaggedScoreDigestEmail(env, admin.email, admin.name || admin.email, summarised, queueUrl);
    } catch (e) {
      console.error('[notifications] digest send failed', e);
    }
  }
  return { admins: admins.length, items: items.length };
}
