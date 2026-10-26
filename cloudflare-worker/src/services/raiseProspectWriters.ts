/** D1191: canonical legacy prospect writers, isolated from private bank modules.
 * raiseWriters.ts re-exports these. Contacts imports this leaf so an admin or
 * cron importing Contacts never gains a path through the full Raise graph.
 */
import type { Env } from '../types';
import { createProspect, RAISE_STAGES, COMMIT_STATUSES, INSTRUMENTS } from '../routes/contacts';
import { CapitalAccessError } from './capRelAccess';

class LegacyWriterError extends CapitalAccessError {
  constructor(status: number, sentence: string) { super(status, 'capital_write_failed', sentence); }
}
async function ownProspect(env: Env, projectId: number, id: number): Promise<number> {
  if (!Number.isSafeInteger(id) || id < 1 || !await env.DB.prepare('SELECT 1 FROM raise_prospects WHERE id = ? AND project_id = ?').bind(id, projectId).first()) throw new LegacyWriterError(404, 'Prospect not found');
  return id;
}
function prospectAudit(env: Env, a: { projectId: number; userId: number }, id: number, action: 'prospect_updated' | 'prospect_created', summary: string) {
  return env.DB.prepare("INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor) VALUES (?, ?, 'raise.capital-relationships', ?, ?, ?, ?)")
    .bind(a.projectId, a.userId, String(id), action, summary, `user:${a.userId}`);
}

/** D1191: legacy form/import entry, preserving its values with one actor audit. */
export async function addLegacyProspect(env: Env, a: { projectId: number; userId: number; body: Record<string, unknown> }) {
  return createProspect(env, a.projectId, a.body, a.userId);
}

/** The old Contacts edit, kept in the prospect writer rather than a second route writer. */
export async function updateLegacyProspect(env: Env, a: { projectId: number; userId: number; prospectId: number; body: Record<string, unknown> }) {
  const id = await ownProspect(env, a.projectId, a.prospectId);
  const row = await env.DB.prepare('SELECT * FROM raise_prospects WHERE id = ? AND project_id = ?').bind(id, a.projectId).first<any>();
  if (!row) throw new LegacyWriterError(404, 'Prospect not found');
  const b = a.body;
  const stage = typeof b.stage === 'string' && RAISE_STAGES.includes(b.stage) ? b.stage : row.stage;
  const notes = b.notes !== undefined ? (b.notes ? String(b.notes).slice(0, 4000) : null) : row.notes;
  const firm = b.firm !== undefined ? (b.firm ? String(b.firm).slice(0, 200) : null) : row.firm;
  const name = b.name !== undefined ? (b.name ? String(b.name).slice(0, 200) : null) : row.name;
  const number = Number(b.amount);
  const amount = b.amount === undefined ? (row.amount ?? null) : b.amount == null || b.amount === '' || !Number.isFinite(number) || number < 0 ? null : number;
  const commitStatus = stage !== 'committed' ? null : b.commit_status !== undefined ? COMMIT_STATUSES.includes(String(b.commit_status)) ? String(b.commit_status) : null : row.commit_status ?? null;
  const instrument = b.instrument !== undefined ? INSTRUMENTS.includes(String(b.instrument)) ? String(b.instrument) : null : row.instrument ?? null;
  const closeId = b.close_id !== undefined ? b.close_id == null ? null : Number(b.close_id) : row.close_id ?? null;
  if (closeId != null && !await env.DB.prepare('SELECT 1 FROM raise_closes WHERE id = ? AND project_id = ? LIMIT 1').bind(closeId, a.projectId).first()) throw new LegacyWriterError(400, 'close_id does not belong to this project');
  await env.DB.batch([
    env.DB.prepare('UPDATE raise_prospects SET stage=?, notes=?, firm=?, name=?, amount=?, commit_status=?, instrument=?, close_id=?, updated_at=? WHERE id=? AND project_id=?')
      .bind(stage, notes, firm, name, amount, commitStatus, instrument, closeId, new Date().toISOString(), id, a.projectId),
    prospectAudit(env, a, id, 'prospect_updated', 'Investor prospect updated'),
  ]);
  return env.DB.prepare('SELECT * FROM raise_prospects WHERE id = ? AND project_id = ?').bind(id, a.projectId).first();
}

/** Contacts promotion retains its compare-and-swap and loser cleanup. */
export async function promoteLegacyInvestor(env: Env, a: { projectId: number; userId: number; contactId: number }) {
  const row = await env.DB.prepare('SELECT * FROM contacts WHERE id = ? AND project_id = ?').bind(a.contactId, a.projectId).first<any>();
  if (!row || row.audience !== 'investor') throw new LegacyWriterError(404, 'Investor contact not found');
  if (row.promoted_to === 'raise' && row.promoted_ref_id) {
    const existing = await env.DB.prepare('SELECT * FROM raise_prospects WHERE id = ? AND project_id = ?').bind(row.promoted_ref_id, a.projectId).first();
    if (existing) return { ...row, record: existing, already_promoted: true };
  }
  const now = new Date().toISOString();
  const inserted = await env.DB.prepare(
    'INSERT INTO raise_prospects (uid, project_id, contact_id, name, email, firm, stage, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(crypto.randomUUID(), a.projectId, row.id, row.name || null, row.email, null, 'to_contact', row.message ? String(row.message).slice(0, 4000) : null, now, now).run();
  const id = Number(inserted.meta.last_row_id);
  const changed = await env.DB.prepare(
    "UPDATE contacts SET promoted_to='raise', promoted_ref_id=?, status='qualified', last_activity_at=?, updated_at=? WHERE id=? AND project_id=? AND (promoted_ref_id IS NULL OR promoted_ref_id = ?)",
  ).bind(id, now, now, row.id, a.projectId, row.promoted_ref_id).run();
  if (changed.meta.changes === 0) {
    await env.DB.prepare('DELETE FROM raise_prospects WHERE id = ? AND project_id = ?').bind(id, a.projectId).run();
    const winner = await env.DB.prepare('SELECT * FROM contacts WHERE id = ? AND project_id = ?').bind(row.id, a.projectId).first<any>();
    const record = winner?.promoted_ref_id ? await env.DB.prepare('SELECT * FROM raise_prospects WHERE id = ? AND project_id = ?').bind(winner.promoted_ref_id, a.projectId).first() : null;
    return { ...winner, record, already_promoted: true };
  }
  await prospectAudit(env, a, id, 'prospect_created', 'Investor promoted from Contacts').run();
  return { ...await env.DB.prepare('SELECT * FROM contacts WHERE id = ? AND project_id = ?').bind(row.id, a.projectId).first(),
    record: await env.DB.prepare('SELECT * FROM raise_prospects WHERE id = ? AND project_id = ?').bind(id, a.projectId).first() };
}

