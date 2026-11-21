/**
 * D5833 (#5833): write and read accounting statement snapshots, guarded by the
 * venture and the member. A write needs project write access and the writer's
 * own active connection to that provider; a read needs project access.
 *
 * A write is atomic (one batch: the revision row and every line) and safe to
 * retry: the same content as the latest revision writes nothing and answers
 * `unchanged`; different content appends the next revision. Two concurrent
 * writers race on the revision's UNIQUE key; the loser re-reads and either
 * finds its own content already there (`unchanged`) or appends after it.
 */
import type { Env, User } from '../../types';
import { canAccessProject } from '../projectAccess';
import { StatementRefusal, canonicalize, fingerprint, type Line, type Report, type SnapshotInput } from './contract';

type Scope = { user: Pick<User, 'id' | 'role' | 'founder_id'> & Partial<User>; projectId: number };

async function project(env: Env, s: Scope, write: boolean) {
  const p = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(s.projectId).first<{ id: number; founder_id: number | null }>();
  if (!p || !(await canAccessProject(env, s.user, p, { write }))) throw new StatementRefusal('project_not_found', 404);
  return p;
}

export async function writeSnapshot(env: Env, s: Scope, integrationId: number, input: SnapshotInput) {
  const snap = canonicalize(input);
  await project(env, s, true);
  const conn = await env.DB.prepare("SELECT id FROM integrations WHERE id = ? AND user_id = ? AND provider_key = ? AND status = 'active'")
    .bind(integrationId, s.user.id, snap.provider).first<{ id: number }>();
  if (!conn) throw new StatementRefusal('connection_not_found', 404);
  const print = await fingerprint(snap);
  const key = [s.projectId, snap.provider, snap.entity_key, snap.report, snap.window_key, snap.basis, snap.currency];
  const p = (x: any, f: string) => (x && f in x ? x[f] : null);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const latest = await env.DB.prepare(`SELECT id, uid, revision, fingerprint FROM financial_statement_snapshots WHERE project_id = ? AND provider = ? AND entity_key = ? AND report = ? AND window_key = ? AND basis = ? AND currency = ? ORDER BY revision DESC LIMIT 1`)
      .bind(...key).first<{ id: number; uid: string; revision: number; fingerprint: string }>();
    if (latest?.fingerprint === print) return { state: 'unchanged' as const, uid: latest.uid, revision: latest.revision };
    const uid = crypto.randomUUID(), revision = (latest?.revision ?? 0) + 1;
    const insert = env.DB.prepare(`INSERT INTO financial_statement_snapshots (uid, project_id, integration_id, provider, entity_key, report, window_key,
        basis, currency, precision, requested_start, requested_end, requested_as_of, returned_start, returned_end, returned_as_of, period_mismatch,
        revision, fingerprint, supersedes_id, line_count, imported_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(uid, s.projectId, conn.id, snap.provider, snap.entity_key, snap.report, snap.window_key, snap.basis, snap.currency, snap.precision,
        p(snap.requested, 'start'), p(snap.requested, 'end'), p(snap.requested, 'as_of'), p(snap.returned, 'start'), p(snap.returned, 'end'), p(snap.returned, 'as_of'),
        snap.period_mismatch ? 1 : 0, revision, print, latest?.id ?? null, snap.lines.length, s.user.id);
    const lines = snap.lines.map(l => env.DB.prepare(`INSERT INTO financial_statement_lines (snapshot_id, position, source_key, label, section, kind, state, amount, amount_minor, reason)
        SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM financial_statement_snapshots WHERE uid = ?`)
      .bind(l.position, l.source_key, l.label, l.section, l.kind, l.state, l.amount, l.amount_minor, l.reason, uid));
    try {
      await env.DB.batch([insert, ...lines]);
      return { state: 'created' as const, uid, revision, supersedes: latest?.uid ?? null };
    } catch (e) {
      // Another writer took this revision number first; read again and decide.
      if (!/UNIQUE/i.test(String((e as Error)?.message ?? e))) throw e;
    }
  }
  throw new StatementRefusal('snapshot_busy', 409);
}

type Row = Record<string, any>;
function shape(r: Row, lines: Line[]) {
  const period = (k: 'requested' | 'returned') => r[`${k}_as_of`] ? { as_of: r[`${k}_as_of`] } : r[`${k}_start`] ? { start: r[`${k}_start`], end: r[`${k}_end`] } : null;
  return { uid: r.uid, provider: r.provider, entity_key: r.entity_key, report: r.report as Report, basis: r.basis, currency: r.currency,
    precision: r.precision, requested: period('requested')!, returned: period('returned'), period_mismatch: !!r.period_mismatch,
    revision: r.revision, fingerprint: r.fingerprint, imported_at: r.imported_at, superseded_by: r.superseded_by ?? null, lines };
}
async function linesOf(env: Env, ids: number[]) {
  const out = new Map<number, Line[]>();
  if (!ids.length) return out;
  const rows = (await env.DB.prepare(`SELECT snapshot_id, position, source_key, label, section, kind, state, amount, amount_minor, reason
      FROM financial_statement_lines WHERE snapshot_id IN (SELECT value FROM json_each(?)) ORDER BY snapshot_id, position`).bind(JSON.stringify(ids)).all<any>()).results ?? [];
  for (const { snapshot_id, ...l } of rows) { if (!out.has(snapshot_id)) out.set(snapshot_id, []); out.get(snapshot_id)!.push(l); }
  return out;
}

/** The latest revision of each statement this venture holds, with its revision count. */
export async function readLatest(env: Env, s: Scope, filter: { report?: Report } = {}) {
  await project(env, s, false);
  const rows = (await env.DB.prepare(`SELECT s.*, (SELECT n.uid FROM financial_statement_snapshots n WHERE n.supersedes_id = s.id) AS superseded_by,
      (SELECT COUNT(*) FROM financial_statement_snapshots o WHERE o.project_id = s.project_id AND o.provider = s.provider AND o.entity_key = s.entity_key
        AND o.report = s.report AND o.window_key = s.window_key AND o.basis = s.basis AND o.currency = s.currency) AS revisions
    FROM financial_statement_snapshots s
    WHERE s.project_id = ? AND (? IS NULL OR s.report = ?)
      AND NOT EXISTS (SELECT 1 FROM financial_statement_snapshots n WHERE n.supersedes_id = s.id)
    ORDER BY s.report, s.window_key DESC, s.id DESC`).bind(s.projectId, filter.report ?? null, filter.report ?? null).all<Row>()).results ?? [];
  const lines = await linesOf(env, rows.map(r => r.id));
  return rows.map(r => ({ ...shape(r, lines.get(r.id) ?? []), revisions: r.revisions }));
}

/** One exact revision, superseded or not, as pinned evidence points at it. */
export async function readRevision(env: Env, s: Scope, uid: string) {
  await project(env, s, false);
  const r = await env.DB.prepare(`SELECT s.*, (SELECT n.uid FROM financial_statement_snapshots n WHERE n.supersedes_id = s.id) AS superseded_by FROM financial_statement_snapshots s WHERE s.uid = ? AND s.project_id = ?`).bind(uid, s.projectId).first<Row>();
  if (!r) throw new StatementRefusal('snapshot_not_found', 404);
  return shape(r, (await linesOf(env, [r.id])).get(r.id) ?? []);
}

/** A founder pins one revision as evidence; a later correction never moves the pin. */
export async function pinRevision(env: Env, s: Scope, uid: string, purpose: string) {
  await project(env, s, true);
  const text = typeof purpose === 'string' ? purpose.trim() : '';
  if (!text || text.length > 200) throw new StatementRefusal('purpose_invalid');
  const r = await env.DB.prepare('SELECT id FROM financial_statement_snapshots WHERE uid = ? AND project_id = ?').bind(uid, s.projectId).first<{ id: number }>();
  if (!r) throw new StatementRefusal('snapshot_not_found', 404);
  const pin = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO financial_statement_pins (uid, project_id, snapshot_id, purpose, pinned_by) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (snapshot_id, purpose) DO NOTHING`).bind(pin, s.projectId, r.id, text, s.user.id).run();
  const row = await env.DB.prepare('SELECT uid FROM financial_statement_pins WHERE snapshot_id = ? AND purpose = ?').bind(r.id, text).first<{ uid: string }>();
  return { uid: row!.uid, snapshot_uid: uid, purpose: text };
}

/** Pins with the revision each points at, and whether a later revision has since superseded it. */
export async function readPins(env: Env, s: Scope) {
  await project(env, s, false);
  return (await env.DB.prepare(`SELECT p.uid, p.purpose, p.pinned_at, s.uid AS snapshot_uid, s.revision, s.report, s.window_key,
      (SELECT n.uid FROM financial_statement_snapshots n WHERE n.supersedes_id = s.id) AS superseded_by
    FROM financial_statement_pins p JOIN financial_statement_snapshots s ON s.id = p.snapshot_id
    WHERE p.project_id = ? ORDER BY p.pinned_at, p.id`).bind(s.projectId).all<Row>()).results ?? [];
}
