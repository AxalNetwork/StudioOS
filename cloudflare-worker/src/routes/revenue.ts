/**
 * /api/revenue — the Spin-Out Lab revenue ledger (D363, migration 311).
 *
 *   GET    /projects/:projectId/entries          the project's entries, newest first
 *   POST   /projects/:projectId/entries          one manual entry
 *   POST   /projects/:projectId/entries/import   CSV rows, already mapped by the page
 *   PATCH  /projects/:projectId/entries/:uid     edit an entry or attach its proof
 *   DELETE /projects/:projectId/entries/:uid     remove an entry
 *
 * ACCESS mirrors /api/progress/metrics, the store this ledger sits beside:
 * the project is loaded narrowed to the caller's active company (admins and
 * partners exempt), read by its founder, an admin or a partner, and written by
 * its founder, an admin, or an active Lab member who owns it. A project out of
 * scope is a 404, the same as one that does not exist.
 *
 * MONEY is integer cents in and out. VERIFICATION is set by the Worker from
 * the row (services/revenueLedger.ts `verificationFor`), never from a request.
 * A proof document must belong to the same project. A failed read is a 500
 * with our sentence — never an empty list, which the page would draw as "no
 * revenue recorded".
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, canAccessFounderResource } from '../auth';
import { projectInActiveCompany } from '../services/tenancyScope';
import { resolveActiveCompany, ACTIVE_COMPANY_HEADER } from '../middleware/activeCompany';
import { refuse } from '../util/refusal';
import {
  ensureRevenueEntriesSchema,
  validateEntry,
  verificationFor,
  entryDto,
  LEDGER_CURRENCY,
  MAX_IMPORT_ROWS,
  type LedgerRow,
} from '../services/revenueLedger';

type Project = { id: number; name: string | null; founder_id: number | null; company_id: number | null };
type Ctx = Context<{ Bindings: Env }>;

const revenue = new Hono<{ Bindings: Env }>();

const isPrivileged = (role: User['role']) => role === 'admin' || role === 'partner';

async function loadProject(c: Ctx, projectId: number, user: User): Promise<Project | null> {
  const row = await c.env.DB.prepare(
    'SELECT id, name, founder_id, company_id FROM projects WHERE id = ?',
  ).bind(projectId).first<Project>();
  if (!row) return null;
  if (isPrivileged(user.role)) return row;
  const company = await resolveActiveCompany(c.env, user, c.req.header(ACTIVE_COMPANY_HEADER));
  return projectInActiveCompany(company, row) ? row : null;
}

function canView(project: Project, user: User): boolean {
  if (isPrivileged(user.role)) return true;
  return canAccessFounderResource(user, project.founder_id);
}

function canEdit(project: Project, user: User): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'founder') return canAccessFounderResource(user, project.founder_id);
  // Active Lab members write their own startup's deliverables whatever their
  // account role — an explicit ownership comparison, never a partner widening.
  return Number(user.spinout_lab_active ?? 0) === 1
    && project.founder_id != null
    && user.founder_id === project.founder_id;
}

/** Resolve the project and the caller's right to it; a Response when refused. */
async function gate(c: Ctx, write: boolean): Promise<{ user: User; project: Project } | Response> {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return c.json({ error: 'invalid_project', message: 'That is not a project id.' }, 400);
  }
  const project = await loadProject(c, projectId, user);
  if (!project) return c.json({ error: 'project_not_found', message: 'Project not found.' }, 404);
  if (!(write ? canEdit(project, user) : canView(project, user))) {
    return c.json({ error: 'forbidden', message: 'You cannot change this startup\'s revenue.' }, 403);
  }
  await ensureRevenueEntriesSchema(c.env);
  return { user, project };
}

/** A proof document must be one of this project's own documents. */
async function proofBelongs(c: Ctx, projectId: number, docId: number | null): Promise<boolean> {
  if (docId == null) return true;
  const d = await c.env.DB.prepare('SELECT project_id FROM documents WHERE id = ?')
    .bind(docId).first<{ project_id: number | null }>();
  return !!d && Number(d.project_id) === projectId;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

revenue.get('/projects/:projectId/entries', async (c) => {
  const g = await gate(c, false);
  if (g instanceof Response) return g;
  try {
    const rows = await c.env.DB.prepare(
      `SELECT * FROM revenue_entries WHERE project_id = ? ORDER BY received_on DESC, id DESC LIMIT 1000`,
    ).bind(g.project.id).all<LedgerRow>();
    return c.json({ currency: LEDGER_CURRENCY, entries: (rows.results || []).map(entryDto) });
  } catch (e) {
    return refuse(c, 500, { code: 'ledger_read_failed', message: 'The revenue ledger could not be read. Try again.', raw: e, audience: 'member' });
  }
});

revenue.post('/projects/:projectId/entries', async (c) => {
  const g = await gate(c, true);
  if (g instanceof Response) return g;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const checked = validateEntry(body, todayIso());
  if (!checked.ok) return c.json({ error: checked.code, message: checked.message }, 400);
  const e = checked.entry;
  if (!(await proofBelongs(c, g.project.id, e.proof_document_id))) {
    return c.json({ error: 'invalid_proof_document', message: 'That proof document is not one of this startup\'s documents.' }, 400);
  }
  const uid = crypto.randomUUID();
  const verification = verificationFor({ source: 'manual', proof_document_id: e.proof_document_id });
  try {
    await c.env.DB.prepare(
      `INSERT INTO revenue_entries
         (uid, project_id, customer, amount_cents, currency, revenue_type, received_on,
          source, verification, proof_document_id, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)`,
    ).bind(uid, g.project.id, e.customer, e.amount_cents, LEDGER_CURRENCY, e.revenue_type, e.received_on,
      verification, e.proof_document_id, e.notes, g.user.id).run();
    const row = await c.env.DB.prepare('SELECT * FROM revenue_entries WHERE uid = ?').bind(uid).first<LedgerRow>();
    return c.json({ ok: true, entry: row ? entryDto(row) : null });
  } catch (err) {
    return refuse(c, 500, { code: 'ledger_write_failed', message: 'The entry could not be saved. Nothing was recorded; try again.', raw: err, audience: 'member' });
  }
});

revenue.post('/projects/:projectId/entries/import', async (c) => {
  const g = await gate(c, true);
  if (g instanceof Response) return g;
  const body = (await c.req.json().catch(() => ({}))) as { rows?: unknown };
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows || rows.length === 0) {
    return c.json({ error: 'no_rows', message: 'The import has no rows.' }, 400);
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return c.json({ error: 'too_many_rows', message: `Import at most ${MAX_IMPORT_ROWS} rows at a time.` }, 400);
  }
  // Every row is checked before anything is written: an import either records
  // all its valid rows in one batch or reports why each other row was refused.
  const today = todayIso();
  const accepted: { index: number; entry: ReturnType<typeof validateEntry> & { ok: true } }[] = [];
  const rejected: { index: number; code: string; message: string }[] = [];
  rows.forEach((raw, index) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    // A CSV row's proof is attached afterwards, per entry; an imported row
    // never carries a document id it could not have been shown.
    const checked = validateEntry({ ...r, proof_document_id: null }, today);
    if (checked.ok) accepted.push({ index, entry: checked });
    else rejected.push({ index, code: checked.code, message: checked.message });
  });
  if (accepted.length === 0) {
    return c.json({ error: 'no_valid_rows', message: 'No row in the import could be recorded; each row\'s reason is listed.', ok: false, inserted: 0, rejected }, 400);
  }
  const batch = crypto.randomUUID();
  try {
    await c.env.DB.batch(accepted.map(({ entry: { entry: e } }) => c.env.DB.prepare(
      `INSERT INTO revenue_entries
         (uid, project_id, customer, amount_cents, currency, revenue_type, received_on,
          source, verification, notes, import_batch, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'csv', 'manual', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), g.project.id, e.customer, e.amount_cents, LEDGER_CURRENCY, e.revenue_type,
      e.received_on, e.notes, batch, g.user.id)));
  } catch (err) {
    return refuse(c, 500, { code: 'ledger_import_failed', message: 'The import could not be saved. Nothing was recorded; try again.', raw: err, audience: 'member' });
  }
  return c.json({ ok: true, inserted: accepted.length, rejected, import_batch: batch });
});

revenue.patch('/projects/:projectId/entries/:uid', async (c) => {
  const g = await gate(c, true);
  if (g instanceof Response) return g;
  const uid = c.req.param('uid');
  const row = await c.env.DB.prepare('SELECT * FROM revenue_entries WHERE uid = ? AND project_id = ?')
    .bind(uid, g.project.id).first<LedgerRow>();
  if (!row) return c.json({ error: 'entry_not_found', message: 'That entry is not on this startup\'s ledger.' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  // The stored row, overlaid with what the request sent, validated as a whole.
  const merged = {
    customer: body.customer ?? row.customer,
    amount_cents: body.amount_cents ?? row.amount_cents,
    revenue_type: body.revenue_type ?? row.revenue_type,
    received_on: body.received_on ?? row.received_on,
    proof_document_id: 'proof_document_id' in body ? body.proof_document_id : row.proof_document_id,
    notes: 'notes' in body ? body.notes : row.notes,
  };
  const checked = validateEntry(merged, todayIso());
  if (!checked.ok) return c.json({ error: checked.code, message: checked.message }, 400);
  const e = checked.entry;
  if (!(await proofBelongs(c, g.project.id, e.proof_document_id))) {
    return c.json({ error: 'invalid_proof_document', message: 'That proof document is not one of this startup\'s documents.' }, 400);
  }
  const verification = verificationFor({ source: row.source, proof_document_id: e.proof_document_id });
  try {
    await c.env.DB.prepare(
      `UPDATE revenue_entries
          SET customer = ?, amount_cents = ?, revenue_type = ?, received_on = ?,
              proof_document_id = ?, notes = ?, verification = ?, updated_at = datetime('now')
        WHERE uid = ? AND project_id = ?`,
    ).bind(e.customer, e.amount_cents, e.revenue_type, e.received_on, e.proof_document_id, e.notes,
      verification, uid, g.project.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM revenue_entries WHERE uid = ?').bind(uid).first<LedgerRow>();
    return c.json({ ok: true, entry: fresh ? entryDto(fresh) : null });
  } catch (err) {
    return refuse(c, 500, { code: 'ledger_write_failed', message: 'The entry could not be saved. Nothing changed; try again.', raw: err, audience: 'member' });
  }
});

revenue.delete('/projects/:projectId/entries/:uid', async (c) => {
  const g = await gate(c, true);
  if (g instanceof Response) return g;
  const uid = c.req.param('uid');
  try {
    const r = await c.env.DB.prepare('DELETE FROM revenue_entries WHERE uid = ? AND project_id = ?')
      .bind(uid, g.project.id).run();
    if (!r.meta?.changes) return c.json({ error: 'entry_not_found', message: 'That entry is not on this startup\'s ledger.' }, 404);
    return c.json({ ok: true });
  } catch (err) {
    return refuse(c, 500, { code: 'ledger_write_failed', message: 'The entry could not be removed. It is still on the ledger; try again.', raw: err, audience: 'member' });
  }
});

export default revenue;
