/**
 * D1350 (#3565, part 1 of #3564) — LinkedIn's connector infrastructure:
 * the member's connection, their contact import jobs, where each contact came
 * from, and the audit log of their connector events (migration 651).
 *
 * EVERY READ IS THE MEMBER'S OWN: each statement here binds the member's id
 * (`user_id = ?` on the connection, `owner_user_id = ?` everywhere else), so a
 * row of another member's reads as one that does not exist.
 *
 * NOTHING HERE HOLDS OR RETURNS A TOKEN. The connection's `token_enc` is null
 * while LinkedIn is only OpenID Connect sign-in; it is never selected by a
 * read below. The audit log takes an event and a subject (a job's uid, a
 * count), never a token and never a contact's email.
 */
import type { Env } from '../types';

export const LINKEDIN_SOURCES = ['linkedin_csv', 'linkedin_api', 'linkedin_dma'] as const;
export const IMPORT_SOURCES = [...LINKEDIN_SOURCES, 'csv'] as const;
export type ImportSource = typeof IMPORT_SOURCES[number];
export type AuditEvent = 'connect' | 'disconnect' | 'import' | 'delete' | 'share' | 'access';
/** What OpenID Connect sign-in asks LinkedIn for. */
export const OIDC_SCOPES = 'openid profile email';

export type Connection = { linkedin_sub: string; scopes: string[]; status: 'active' | 'revoked' | 'expired'; connected_at: string; disconnected_at: string | null };
export type ImportJob = {
  uid: string; source: ImportSource; status: 'running' | 'done' | 'failed';
  rows_total: number; rows_created: number; rows_matched: number; rows_skipped: number; rows_errors: number;
  error: string | null; started_at: string; finished_at: string | null;
};

const scopesOf = (raw: unknown) => String(raw ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
/** LinkedIn's granted scopes, space-separated (its token answer's `scope`), as the stored string; the asked-for set when it says none. */
export const grantedScopes = (raw: unknown) => (scopesOf(raw).length ? scopesOf(raw).join(' ') : OIDC_SCOPES);

/** One connector event. `subject` is a job uid or a count: never a token, never an email. */
export async function audit(env: Env, a: { actor: number | null; owner: number; event: AuditEvent; subject?: string | null; provider?: string }) {
  await env.DB.prepare('INSERT INTO integration_audit_log (actor_user_id, owner_user_id, provider, event, subject) VALUES (?, ?, ?, ?, ?)')
    .bind(a.actor, a.owner, a.provider ?? 'linkedin', a.event, a.subject ?? null).run();
}

/** Signed in: the member's connection, active, with the scopes LinkedIn granted. One row per member. */
export async function connect(env: Env, userId: number, sub: string, scopes: string) {
  await env.DB.prepare(`INSERT INTO linkedin_connections (user_id, linkedin_sub, scopes, status, connected_at, disconnected_at, updated_at)
      VALUES (?, ?, ?, 'active', datetime('now'), NULL, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET linkedin_sub = excluded.linkedin_sub, scopes = excluded.scopes, status = 'active',
        connected_at = excluded.connected_at, disconnected_at = NULL, updated_at = datetime('now')`)
    .bind(userId, sub, scopes).run();
  await audit(env, { actor: userId, owner: userId, event: 'connect', subject: scopes });
}

/** The member's connection, without any token column; null when they never connected. */
export async function connectionOf(env: Env, userId: number): Promise<Connection | null> {
  const r = await env.DB.prepare('SELECT linkedin_sub, scopes, status, connected_at, disconnected_at FROM linkedin_connections WHERE user_id = ?')
    .bind(userId).first<any>();
  return r ? { linkedin_sub: r.linkedin_sub, scopes: scopesOf(r.scopes), status: r.status, connected_at: r.connected_at, disconnected_at: r.disconnected_at ?? null } : null;
}

const jobOfRow = (r: any): ImportJob => ({
  uid: r.uid, source: r.source, status: r.status, rows_total: r.rows_total, rows_created: r.rows_created, rows_matched: r.rows_matched,
  rows_skipped: r.rows_skipped, rows_errors: r.rows_errors, error: r.error ?? null, started_at: r.started_at, finished_at: r.finished_at ?? null,
});

export async function lastImportJob(env: Env, owner: number): Promise<ImportJob | null> {
  const r = await env.DB.prepare(`SELECT uid, source, status, rows_total, rows_created, rows_matched, rows_skipped, rows_errors, error, started_at, finished_at FROM contact_import_jobs WHERE owner_user_id = ? ORDER BY started_at DESC, id DESC LIMIT 1`).bind(owner).first<any>();
  return r ? jobOfRow(r) : null;
}
export async function importJobOf(env: Env, owner: number, uid: string): Promise<ImportJob | null> {
  const r = await env.DB.prepare(`SELECT uid, source, status, rows_total, rows_created, rows_matched, rows_skipped, rows_errors, error, started_at, finished_at FROM contact_import_jobs WHERE owner_user_id = ? AND uid = ?`).bind(owner, uid).first<any>();
  return r ? jobOfRow(r) : null;
}
export async function importJobs(env: Env, owner: number, limit = 20): Promise<ImportJob[]> {
  const rows = await env.DB.prepare(`SELECT uid, source, status, rows_total, rows_created, rows_matched, rows_skipped, rows_errors, error, started_at, finished_at FROM contact_import_jobs WHERE owner_user_id = ? ORDER BY started_at DESC, id DESC LIMIT ?`).bind(owner, limit).all<any>();
  return (rows.results ?? []).map(jobOfRow);
}

/** A new running job; returns its id (for `recordSource`) and uid (for the member). */
export async function startImportJob(env: Env, owner: number, source: ImportSource, rowsTotal = 0): Promise<{ id: number; uid: string }> {
  const uid = crypto.randomUUID();
  const r = await env.DB.prepare('INSERT INTO contact_import_jobs (uid, owner_user_id, source, rows_total) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(uid, owner, source, Math.max(0, Math.floor(rowsTotal))).first<{ id: number }>();
  return { id: Number(r!.id), uid };
}

/** A job's end: its counts, or its one error sentence. Written once; audited as an import, by count. */
export async function finishImportJob(env: Env, owner: number, job: { id: number; uid: string },
  out: { created: number; matched: number; skipped: number; errors: number; error?: string | null }) {
  const failed = Boolean(out.error);
  await env.DB.prepare(`UPDATE contact_import_jobs SET status = ?, rows_created = ?, rows_matched = ?, rows_skipped = ?, rows_errors = ?, error = ?,
      finished_at = datetime('now') WHERE id = ? AND owner_user_id = ? AND status = 'running'`)
    .bind(failed ? 'failed' : 'done', out.created, out.matched, out.skipped, out.errors, out.error ?? null, job.id, owner).run();
  await audit(env, { actor: owner, owner, event: 'import', subject: `${job.uid}: ${out.created} created, ${out.matched} matched, ${out.skipped} skipped` });
}

/** Where one row of the member's book came from. `created` when this source made the row. */
export async function recordSource(env: Env, owner: number, s: { contactId: number; source: ImportSource | 'typed'; jobId?: number | null; ref?: string | null; created: boolean }) {
  await env.DB.prepare(`INSERT OR IGNORE INTO contact_sources (owner_user_id, contact_table, contact_id, source, job_id, source_ref, created_row)
      SELECT ?, 'network_connections', n.id, ?, ?, ?, ? FROM network_connections n WHERE n.id = ? AND n.user_id = ?`)
    .bind(owner, s.source, s.jobId ?? null, s.ref ? String(s.ref).slice(0, 200) : null, s.created ? 1 : 0, s.contactId, owner).run();
}

/**
 * D1352 (#3567): what disconnect's `delete_imported` would do, said before it
 * is pressed. `linkedin_only` is what it deletes (a LinkedIn source made the
 * row and no other source touched it); `kept` is every other row a LinkedIn
 * source touched, which stays with its provenance.
 */
export async function importedCounts(env: Env, owner: number): Promise<{ linkedin_only: number; kept: number }> {
  const r = await env.DB.prepare(`SELECT
      SUM(CASE WHEN EXISTS (SELECT 1 FROM contact_sources s WHERE s.owner_user_id = ? AND s.contact_table = 'network_connections' AND s.contact_id = n.id
                 AND s.source IN ('linkedin_csv', 'linkedin_api', 'linkedin_dma') AND s.created_row = 1)
               AND NOT EXISTS (SELECT 1 FROM contact_sources s WHERE s.owner_user_id = ? AND s.contact_table = 'network_connections' AND s.contact_id = n.id
                 AND s.source NOT IN ('linkedin_csv', 'linkedin_api', 'linkedin_dma')) THEN 1 ELSE 0 END) AS linkedin_only,
      COUNT(*) AS touched
    FROM network_connections n WHERE n.user_id = ?
      AND EXISTS (SELECT 1 FROM contact_sources s WHERE s.owner_user_id = ? AND s.contact_table = 'network_connections' AND s.contact_id = n.id
        AND s.source IN ('linkedin_csv', 'linkedin_api', 'linkedin_dma'))`).bind(owner, owner, owner, owner).first<{ linkedin_only: number | null; touched: number }>();
  const only = Number(r?.linkedin_only ?? 0);
  return { linkedin_only: only, kept: Number(r?.touched ?? 0) - only };
}

/**
 * Disconnect's `delete_imported`: the member's rows that a LinkedIn source
 * made and no other source has touched. A row they typed, or that came from
 * elsewhere, stays, with all its provenance. Returns how many were deleted.
 */
export async function deleteLinkedinOnly(env: Env, owner: number): Promise<number> {
  const ids = ((await env.DB.prepare(`SELECT n.id FROM network_connections n WHERE n.user_id = ?
      AND EXISTS (SELECT 1 FROM contact_sources s WHERE s.owner_user_id = ? AND s.contact_table = 'network_connections' AND s.contact_id = n.id
        AND s.source IN ('linkedin_csv', 'linkedin_api', 'linkedin_dma') AND s.created_row = 1)
      AND NOT EXISTS (SELECT 1 FROM contact_sources s WHERE s.owner_user_id = ? AND s.contact_table = 'network_connections' AND s.contact_id = n.id
        AND s.source NOT IN ('linkedin_csv', 'linkedin_api', 'linkedin_dma'))`).bind(owner, owner, owner).all<{ id: number }>()).results ?? []).map((r) => Number(r.id));
  if (ids.length) {
    const list = JSON.stringify(ids);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM contact_sources WHERE owner_user_id = ? AND contact_table = 'network_connections' AND contact_id IN (SELECT value FROM json_each(?))`).bind(owner, list),
      env.DB.prepare('DELETE FROM network_connections WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))').bind(owner, list),
    ]);
  }
  await audit(env, { actor: owner, owner, event: 'delete', subject: `${ids.length} imported ${ids.length === 1 ? 'contact' : 'contacts'}` });
  return ids.length;
}

/** Signed out: the connection revoked (its token, were there one, cleared), and the event audited. */
export async function revoke(env: Env, userId: number) {
  await env.DB.prepare(`UPDATE linkedin_connections SET status = 'revoked', token_enc = NULL, disconnected_at = datetime('now'), updated_at = datetime('now')
      WHERE user_id = ?`).bind(userId).run();
  await audit(env, { actor: userId, owner: userId, event: 'disconnect' });
}
