/**
 * D5867 (#5867, part 3 of #2401) — the daily TikTok sync: one pass a day over every linked TikTok connection, through
 * part 2a's own `syncTikTok` (`grow.ts`), so the cron lands exactly what the founder's Sync button lands.
 *
 * WHICH CONNECTIONS. Only an `active` one (a `revoked` or `error` connection is not read), only one already linked to
 * a venture by a founder's first sync (`tiktok_account_links`: the cron never picks a venture), only one
 * `scheduledConnectorEnabled` passes (its frequency, and at least one company switched on), and only while the
 * linked venture's company is still switched on (`projectEnabled`).
 *
 * ONCE A DAY. A connection already synced today (UTC), by the cron or by the founder, is skipped. The snapshot is
 * keyed by the day (`UNIQUE (project_id, snapshot_date)` and the ledger's per-day external id), so a second pass the
 * same day could only update that day's row, never add one. A fact the founder deleted keeps its ledger row with no
 * `local_id` and is never re-created (D655, D5863).
 *
 * WHAT IT WRITES. `tiktok_account_facts`, `tiktok_video_facts`, the ledger and the link's cursor, as `syncTikTok`
 * does, and the connection's `last_synced_at` or `last_error` (a code, never TikTok's body). Never `project_metrics`
 * or `custom_kpi_values`. It logs nothing itself: the caller logs the totals, counts only.
 */
import type { Env } from '../../types';
import type { IntegrationRow } from '../../integrations/registry';
import { projectEnabled, scheduledConnectorEnabled } from '../../integrations/companyScope';
import { TikTokReadError, grantedScopes, tiktokReadsFor, type TikTokReads } from './client';
import { syncTikTok } from './grow';

export interface TikTokDailyTotals {
  /** Connections read this pass. */
  scanned: number;
  ok: number;
  failed: number;
  /** Linked active connections not read: synced today already, or switched off. */
  skipped: number;
  snapshots: number;
  videos: number;
  kept_deleted: number;
}

/** The most connections one pass reads. */
export const DAILY_BATCH = 200;

type Linked = IntegrationRow & { link_project_id: number; link_cursor: string | null };

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * One pass. `readsFor` is the client's own `tiktokReadsFor` (the refresh lease, then the two reads); a test hands in
 * a stub. Each connection fails on its own: one failure never stops the pass.
 */
export async function syncAllTiktokIntegrations(env: Env, now: number,
  readsFor: (env: Env, row: IntegrationRow) => Promise<TikTokReads> = tiktokReadsFor): Promise<TikTokDailyTotals> {
  const t: TikTokDailyTotals = { scanned: 0, ok: 0, failed: 0, skipped: 0, snapshots: 0, videos: 0, kept_deleted: 0 };
  const today = day(now);
  // The pass's own instant, in CURRENT_TIMESTAMP's shape, so "synced today" is the day this pass ran.
  const stamp = new Date(now).toISOString().slice(0, 19).replace('T', ' ');
  let rows: Linked[];
  try {
    rows = (await env.DB.prepare(
      `SELECT i.*, l.project_id AS link_project_id, l.video_cursor AS link_cursor
         FROM integrations i JOIN tiktok_account_links l ON l.integration_id = i.id
        WHERE i.provider_key = 'tiktok' AND i.status = 'active' ORDER BY i.id LIMIT ?`,
    ).bind(DAILY_BATCH).all<Linked>()).results || [];
  } catch {
    return t; // the TikTok tables are not on this database yet
  }
  for (const row of rows) {
    const projectId = Number(row.link_project_id);
    if (String(row.last_synced_at ?? '').slice(0, 10) === today
      || !(await scheduledConnectorEnabled(env, row))
      || !(await projectEnabled(env, Number(row.id), projectId))) { t.skipped += 1; continue; }
    t.scanned += 1;
    try {
      const counts = await syncTikTok(env, await readsFor(env, row), {
        integrationId: Number(row.id), projectId, today, scopes: grantedScopes(row), cursor: row.link_cursor ?? null,
      });
      await env.DB.prepare('UPDATE integrations SET last_synced_at = ?, last_error = NULL, last_error_at = NULL WHERE id = ?')
        .bind(stamp, row.id).run();
      t.ok += 1; t.snapshots += counts.snapshots; t.videos += counts.videos; t.kept_deleted += counts.kept_deleted;
    } catch (e) {
      t.failed += 1;
      const code = e instanceof TikTokReadError ? e.message : 'tiktok_sync_failed';
      try {
        await env.DB.prepare('UPDATE integrations SET last_error = ?, last_error_at = CURRENT_TIMESTAMP WHERE id = ?').bind(code, row.id).run();
      } catch { /* the totals still count it */ }
    }
  }
  return t;
}
