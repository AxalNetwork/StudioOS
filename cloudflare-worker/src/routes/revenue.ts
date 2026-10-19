/**
 * /api/revenue — the Spin-Out Lab revenue ledger (D363, migration 311).
 *
 *   GET    /projects/:projectId/entries          the project's entries, newest first
 *   POST   /projects/:projectId/entries          one manual entry
 *   POST   /projects/:projectId/entries/import   CSV rows, already mapped by the page
 *   POST   /projects/:projectId/entries/import-stripe   the founder's own Stripe
 *          charges, one verified entry each (D587, migration 400)
 *   GET    /projects/:projectId/mercury-credits?from&to   the founder's own Mercury
 *          credits, each importable or listed with its reason (D713); writes no row.
 *          A confirmed raise receipt's line is refused `raise_receipt`, and each other
 *          credit carries `fits_raise_target` (D752)
 *   POST   /projects/:projectId/entries/import-mercury   the credits the founder
 *          picked, re-read from Mercury, one `supported` entry each (D713, migration 477)
 *   GET    /projects/:projectId/mercury-spend?months=1..12   the founder's own months,
 *          net burn, cash and runway from their own Mercury, built per request (D752)
 *   POST   /projects/:projectId/mercury-spend/snapshot   { include_cash, confirm_visible: true }
 *          the last full month's burn (and cash, by choice) as one `mercury`
 *          `project_metrics` row (D752)
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
  chargeToEntry,
  STRIPE_LOCKED_FIELDS, MERCURY_LOCKED_FIELDS,
  mercuryCreditToEntry, namesStripe, normalizeRevenueType,
  type LedgerRow,
} from '../services/revenueLedger';
import {
  UUID_RE, lineFits, listOwnTransactions, logPersonalRead, openRaiseTargets, personalConnection, raiseReceiptIds, readFailure, readOwnTransaction, readWindow,
  type BankLine,
} from '../services/mercuryPersonal';
import { namesAxalEntity } from '../integrations/providers/mercury';
import { listLedgerChargesForUser } from '../integrations/providers/stripe';
import { recomputeRevenueMovements } from '../services/revenueMovements';
import { ensureProjectMetricsSchema } from './progress';
import {
  SPEND_VISIBILITY, bucketMonths, cashNow, lastFullMonthWindow, runwayFrom, snapshotFigures, spendMonths, spendWindow,
  type SpendLine,
} from '../services/mercurySpend';

type Project = { id: number; name: string | null; founder_id: number | null; company_id: number | null };
type Ctx = Context<{ Bindings: Env }>;

const revenue = new Hono<{ Bindings: Env }>();

// D664: after any write that changed the ledger (an entry, a CSV import, the
// Stripe import, an edit or a delete), rewrite the project's revenue movements
// (new, expansion, churned) from it. A failure here is logged and never fails
// the write; the next ledger write rewrites them again.
const afterLedgerWrite = async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
  await next();
  if (c.req.method === 'GET' || c.res.status >= 300) return;
  const pid = Number(c.req.param('projectId'));
  if (!Number.isInteger(pid)) return;
  try { await recomputeRevenueMovements(c.env, pid); }
  catch (e) { console.error('[revenue] movements not rewritten:', (e as Error).message); }
};
revenue.use('/projects/:projectId/entries', afterLedgerWrite);
revenue.use('/projects/:projectId/entries/*', afterLedgerWrite);

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

// D587 — the Stripe charge sync. The insert skips a charge already on this
// project's ledger (migration 400's partial unique index), so a second import,
// or two at once, writes each charge once.
const STRIPE_INSERT =
  'INSERT INTO revenue_entries (uid, project_id, customer, amount_cents, currency, revenue_type, received_on, '
  + 'source, source_ref, verification, import_batch, created_by) '
  + "VALUES (?, ?, ?, ?, ?, ?, ?, 'stripe', ?, ?, ?, ?) "
  + "ON CONFLICT (project_id, source_ref) WHERE source = 'stripe' DO NOTHING";

revenue.post('/projects/:projectId/entries/import-stripe', async (c) => {
  const g = await gate(c, true);
  if (g instanceof Response) return g;
  // The charges are read from the CALLER's own connected Stripe account, so
  // only the startup's own founder may import them: an admin's or a partner's
  // account is not this startup's revenue.
  if (g.project.founder_id == null || g.user.founder_id !== g.project.founder_id) {
    return c.json({ error: 'stripe_owner_only', message: 'Only the startup\'s founder can import its Stripe charges, from their own connected account.' }, 403);
  }
  const listed = await listLedgerChargesForUser(c.env, g.user.id);
  if (!listed.ok) {
    if (listed.reason === 'not_connected') {
      return c.json({ error: 'stripe_not_connected', message: 'Connect your Stripe account first. Nothing was imported.' }, 400);
    }
    return refuse(c, 502, {
      code: 'stripe_read_failed',
      message: 'Your Stripe charges could not be read. Nothing was imported; check the connection and try again.',
      raw: listed.detail, audience: 'owner',
    });
  }
  const verification = verificationFor({ source: 'stripe', proof_document_id: null });
  const batch = crypto.randomUUID();
  const toInsert: { charge_id: string; stmt: D1PreparedStatement }[] = [];
  const rejected: { charge_id: string; code: string; message: string }[] = [];
  let refunded = 0;
  for (const ch of listed.charges) {
    const out = chargeToEntry(ch);
    if (out.kind === 'skip') { refunded += 1; continue; }
    if (out.kind === 'refuse') { rejected.push({ charge_id: ch.id, code: out.code, message: out.message }); continue; }
    const e = out.entry;
    toInsert.push({
      charge_id: ch.id,
      stmt: c.env.DB.prepare(STRIPE_INSERT).bind(crypto.randomUUID(), g.project.id, e.customer, e.amount_cents,
        LEDGER_CURRENCY, e.revenue_type, e.received_on, e.source_ref, verification, batch, g.user.id),
    });
  }
  let inserted = 0;
  try {
    for (let i = 0; i < toInsert.length; i += 100) {
      const results = await c.env.DB.batch(toInsert.slice(i, i + 100).map((x) => x.stmt));
      for (const r of results as Array<{ meta?: { changes?: number } }>) inserted += Number(r?.meta?.changes ?? 0) > 0 ? 1 : 0;
    }
  } catch (err) {
    return refuse(c, 500, {
      code: 'ledger_import_failed',
      message: 'The Stripe charges were read but could not all be saved. Run the import again; nothing is recorded twice.',
      raw: err, audience: 'member',
    });
  }
  return c.json({
    ok: true,
    charges: listed.charges.length,
    inserted,
    already_imported: toInsert.length - inserted,
    refunded,
    rejected,
    capped: listed.capped,
    import_batch: inserted ? batch : null,
  });
});

// D713 — the founder's own Mercury credits. The candidates are read from the
// CALLER's own connection, so only the startup's own founder may list or
// import them (as the Stripe import above). Nothing is stored by the list; the
// import re-reads every line by id, so amount and date are Mercury's, never
// the request's, and the customer is the label the founder typed.
const MAX_MERCURY_IMPORT = 200;

function mercuryOwnerOnly(c: Ctx, g: { user: User; project: Project },
  sentence = 'Only the startup\'s founder can import its Mercury credits, from their own connected account.'): Response | null {
  if (g.project.founder_id == null || g.user.founder_id !== g.project.founder_id) {
    return c.json({ error: 'mercury_owner_only', message: sentence }, 403);
  }
  return null;
}

/** The project's Stripe row, or the founder's active Stripe connection: a Stripe payout is then a sale already counted. */
async function stripeActive(c: Ctx, projectId: number, userId: number): Promise<boolean> {
  const row = await c.env.DB.prepare(
    `SELECT 1 AS y FROM revenue_entries WHERE project_id = ? AND source = 'stripe'
     UNION ALL SELECT 1 FROM integrations WHERE user_id = ? AND provider_key = 'stripe' AND status = 'active' LIMIT 1`,
  ).bind(projectId, userId).first();
  return !!row;
}

/** Which of these lines are already rows, and on which project. */
async function importedProjects(c: Ctx, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const rows = (await c.env.DB.prepare(
    "SELECT source_ref, project_id FROM revenue_entries WHERE source = 'mercury' AND source_ref IN (SELECT value FROM json_each(?))",
  ).bind(JSON.stringify(ids)).all<{ source_ref: string; project_id: number }>()).results || [];
  for (const r of rows) out.set(r.source_ref, Number(r.project_id));
  return out;
}

function creditFor(line: BankLine, projectId: number, imported: Map<string, number>, stripe: boolean, receipts: Set<string>) {
  const at = imported.get(line.transaction_id);
  return mercuryCreditToEntry({
    transaction_id: line.transaction_id, amount_cents: line.amount_cents, posted_on: line.posted_on,
    posted: line.posted, internal: line.internal, voided: line.voided,
    axal_counterparty: namesAxalEntity(line.counterparty_name), stripe_counterparty: namesStripe(line.counterparty_name),
  }, { stripeActive: stripe, importedHere: at === projectId, importedElsewhere: at != null && at !== projectId, raiseReceipt: receipts.has(line.transaction_id) });
}

revenue.get('/projects/:projectId/mercury-credits', async (c) => {
  const g = await gate(c, true);
  if (g instanceof Response) return g;
  const owner = mercuryOwnerOnly(c, g);
  if (owner) return owner;
  const window = readWindow(c.req.query('from') || undefined, c.req.query('to') || undefined);
  if ('error' in window) return c.json({ error: window.error, message: window.message }, 400);
  const conn = await personalConnection(c, g.user, 'venture_revenue');
  if (conn instanceof Response) return conn;
  let read: { lines: BankLine[]; capped: boolean };
  try { read = await listOwnTransactions(conn, window); }
  catch (e) { return readFailure(c, conn, e); }
  const ids = read.lines.map((l) => l.transaction_id);
  const imported = await importedProjects(c, ids);
  const stripe = await stripeActive(c, g.project.id, g.user.id);
  // D752: database reads only, no second bank read.
  const receipts = await raiseReceiptIds(c.env, g.user.id, ids);
  const raiseTargets = await openRaiseTargets(c.env, g.user);
  const credits = [];
  for (const l of read.lines) {
    const out = creditFor(l, g.project.id, imported, stripe, receipts);
    if (out.kind === 'skip') continue;
    const receipt = out.kind === 'refuse' && out.reason === 'raise_receipt';
    credits.push({
      transaction_id: l.transaction_id, posted_on: l.posted_on ?? l.created_on, amount_cents: l.amount_cents,
      last_four: l.last_four, counterparty_name: l.counterparty_name,
      importable: out.kind === 'entry', reason: out.kind === 'refuse' ? out.reason : null,
      // A hint, never a refusal: a customer can pay an amount equal to a commitment.
      fits_raise_target: !receipt && raiseTargets.some((t) => lineFits(t, l)),
    });
  }
  await logPersonalRead(c.env, conn, g.user, 'mercury_credits_read', { lines: read.lines.length, credits: credits.length });
  return c.json({ currency: LEDGER_CURRENCY, window, credits, lines_read: read.lines.length, capped: read.capped });
});

/**
 * D752 decision 10: a line confirmed as a raise receipt is never written as
 * revenue, checked inside the INSERT so a confirmation racing the import
 * cannot leave the line as both. The SELECT carries a WHERE, as SQLite's
 * upsert rule requires of INSERT … SELECT … ON CONFLICT.
 */
export const MERCURY_INSERT =
  'INSERT INTO revenue_entries (uid, project_id, customer, amount_cents, currency, revenue_type, received_on, '
  + 'source, source_ref, verification, import_batch, created_by) '
  + "SELECT ?, ?, ?, ?, ?, ?, ?, 'mercury', ?, ?, ?, ? "
  + 'WHERE NOT EXISTS (SELECT 1 FROM mercury_personal_matches m WHERE m.mercury_transaction_id = ? '
  + "AND m.state = 'confirmed' AND m.target_kind IN ('raise_prospect', 'deal_commitment')) "
  + "ON CONFLICT (source_ref) WHERE source = 'mercury' DO NOTHING";

const FED_UPSERT =
  `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
   VALUES (?, ?, 'revenue_and_traction', 'credit', ?, 'revenue_entries', ?)
   ON CONFLICT(integration_id, external_id) DO UPDATE SET project_id = excluded.project_id, local_table = excluded.local_table,
     local_id = excluded.local_id, last_seen_at = CURRENT_TIMESTAMP`;

revenue.post('/projects/:projectId/entries/import-mercury', async (c) => {
  const g = await gate(c, true);
  if (g instanceof Response) return g;
  const owner = mercuryOwnerOnly(c, g);
  if (owner) return owner;
  const body = (await c.req.json().catch(() => ({}))) as { items?: unknown };
  const raw = Array.isArray(body.items) ? body.items : null;
  if (!raw || !raw.length) return c.json({ error: 'items_required', message: 'Pick at least one Mercury credit to import.' }, 400);
  if (raw.length > MAX_MERCURY_IMPORT) {
    return c.json({ error: 'too_many_items', message: `Import at most ${MAX_MERCURY_IMPORT} credits at a time.` }, 400);
  }
  // Every value is checked before anything reaches Mercury.
  const items: { transaction_id: string; customer: string; revenue_type: string }[] = [];
  const seen = new Set<string>();
  for (const [i, it] of raw.entries()) {
    const r = (it ?? {}) as Record<string, unknown>;
    const id = typeof r.transaction_id === 'string' ? r.transaction_id.toLowerCase() : '';
    if (!UUID_RE.test(id)) return c.json({ error: 'invalid_transaction_id', message: 'Each credit is named by its Mercury transaction id.', index: i }, 400);
    if (seen.has(id)) return c.json({ error: 'duplicate_transaction_id', message: 'Each credit can be picked once.', index: i }, 400);
    seen.add(id);
    const customer = String(r.customer ?? '').trim();
    if (!customer || customer.length > 200) return c.json({ error: 'invalid_customer', message: 'Enter the customer or company, up to 200 characters.', index: i }, 400);
    const type = normalizeRevenueType(r.revenue_type);
    if (!type) return c.json({ error: 'invalid_revenue_type', message: 'Choose recurring, pilot, one-time or deposit.', index: i }, 400);
    items.push({ transaction_id: id, customer, revenue_type: type });
  }
  const conn = await personalConnection(c, g.user, 'venture_revenue');
  if (conn instanceof Response) return conn;
  const lines = new Map<string, BankLine | null>();
  try {
    for (const it of items) lines.set(it.transaction_id, await readOwnTransaction(conn, it.transaction_id));
  } catch (e) { return readFailure(c, conn, e); }
  const imported = await importedProjects(c, items.map((it) => it.transaction_id));
  const stripe = await stripeActive(c, g.project.id, g.user.id);
  const receipts = await raiseReceiptIds(c.env, g.user.id, items.map((it) => it.transaction_id));
  const verification = verificationFor({ source: 'mercury', proof_document_id: null });
  const batch = crypto.randomUUID();
  const refused: { transaction_id: string; reason: string }[] = [];
  let inserted = 0, already = 0;
  try {
    for (const it of items) {
      const line = lines.get(it.transaction_id);
      if (!line) { refused.push({ transaction_id: it.transaction_id, reason: 'transaction_not_found' }); continue; }
      const out = creditFor(line, g.project.id, imported, stripe, receipts);
      if (out.kind === 'skip') { refused.push({ transaction_id: it.transaction_id, reason: 'not_a_credit' }); continue; }
      if (out.kind === 'refuse') {
        if (out.reason === 'already_imported') already += 1;
        else refused.push({ transaction_id: it.transaction_id, reason: out.reason });
        continue;
      }
      const e = out.entry;
      const uid = crypto.randomUUID();
      const r = await c.env.DB.prepare(MERCURY_INSERT).bind(uid, g.project.id, it.customer, e.amount_cents, LEDGER_CURRENCY,
        it.revenue_type, e.received_on, e.source_ref, verification, batch, g.user.id, e.source_ref).run();
      if (!Number(r.meta?.changes ?? 0)) {
        // Another import wrote this line between the read and the insert, or a
        // raise receipt was confirmed on it (D752): then it is on no ledger.
        const at = (await importedProjects(c, [e.source_ref])).get(e.source_ref);
        if (at === g.project.id) already += 1;
        else refused.push({ transaction_id: it.transaction_id, reason: at == null ? 'raise_receipt' : 'imported_elsewhere' });
        continue;
      }
      const row = await c.env.DB.prepare('SELECT id FROM revenue_entries WHERE uid = ?').bind(uid).first<{ id: number }>();
      await c.env.DB.prepare(FED_UPSERT).bind(conn.row.id, g.project.id, e.source_ref, row?.id ?? null).run();
      inserted += 1;
    }
  } catch (err) {
    return refuse(c, 500, {
      code: 'ledger_import_failed',
      message: 'The Mercury credits were read but could not all be saved. Run the import again; nothing is recorded twice.',
      raw: err, audience: 'member',
    });
  } finally {
    await logPersonalRead(c.env, conn, g.user, 'mercury_credits_import', { lines: items.length, inserted }).catch(() => {});
  }
  return c.json({ ok: true, inserted, already_imported: already, refused, import_batch: inserted ? batch : null });
});

// ─────────────────────────────────────────────────────────── D752: the founder's spending

// The project's own founder only, from their own connection: built per
// request, nothing stored unless they save a snapshot. No account id, last
// four, memo or transaction id is ever in a response; counterparty names and
// categories go only to the founder and are never stored or logged.
const SPEND_OWNER_ONLY = 'Only the startup\'s founder can read its spending, from their own connected Mercury.';

/** The ids of lines the founder confirmed as raise receipts: financing, never income. */
async function confirmedRaiseReceiptIds(_c: Ctx, _userId: number): Promise<Set<string>> {
  // #1887 fills this from `mercury_personal_matches` when it merges second.
  return new Set();
}

function toSpendLine(line: BankLine, receiptIds: Set<string>): SpendLine {
  return {
    transaction_id: line.transaction_id, amount_cents: line.amount_cents, posted_on: line.posted_on, created_on: line.created_on,
    posted: line.posted, internal: line.internal, voided: line.voided, counterparty_name: line.counterparty_name,
    category: line.category, financing: namesAxalEntity(line.counterparty_name) || receiptIds.has(line.transaction_id),
  };
}

revenue.get('/projects/:projectId/mercury-spend', async (c) => {
  const g = await gate(c, true);
  if (g instanceof Response) return g;
  const owner = mercuryOwnerOnly(c, g, SPEND_OWNER_ONLY);
  if (owner) return owner;
  const months = spendMonths(c.req.query('months'));
  if (typeof months !== 'number') return c.json({ error: months.error, message: months.message }, 400);
  const today = todayIso();
  const span = spendWindow(months, today);
  const window = readWindow(span.from, span.to, today);
  if ('error' in window) return c.json({ error: window.error, message: window.message }, 400);
  const conn = await personalConnection(c, g.user, 'venture_spend');
  if (conn instanceof Response) return conn;
  let read: { lines: BankLine[]; capped: boolean; refused: number };
  try { read = await listOwnTransactions(conn, window); }
  catch (e) { return readFailure(c, conn, e); }
  const receipts = await confirmedRaiseReceiptIds(c, g.user.id);
  const lines = read.lines.map((l) => toSpendLine(l, receipts));
  const listed = bucketMonths(lines, span.listed, span.current);
  const runwayRows = bucketMonths(lines, span.runwayMonths, span.current);
  const cash = cashNow(conn.accounts);
  const runway = runwayFrom(cash.cents, runwayRows, read.capped);
  await logPersonalRead(c.env, conn, g.user, 'mercury_spend_read', {
    lines: read.lines.length, months, capped: read.capped ? 1 : 0, unreadable: read.refused,
  });
  return c.json({
    currency: 'USD',
    window,
    months: listed,
    last_full_month: span.lastFullMonth,
    cash: { cents: cash.cents, as_of: today, accounts_counted: cash.accounts_counted, accounts_unreadable: cash.accounts_unreadable },
    runway,
    partial: read.capped,
    lines_read: read.lines.length,
    unreadable_lines: read.refused,
    save: { month: span.lastFullMonth, visibility: SPEND_VISIBILITY },
  });
});

const SPEND_SNAPSHOT_UPSERT =
  `INSERT INTO project_metrics (project_id, snapshot_date, net_burn, cash_balance, notes, source, created_by)
   VALUES (?, ?, ?, ?, ?, 'mercury', ?)
   ON CONFLICT(project_id, snapshot_date, source) DO UPDATE SET
     net_burn = excluded.net_burn, cash_balance = excluded.cash_balance,
     notes = excluded.notes, created_by = excluded.created_by`;

const FED_SNAPSHOT_UPSERT =
  `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
   VALUES (?, ?, 'revenue_and_traction', 'metric_snapshot', ?, 'project_metrics', ?)
   ON CONFLICT(integration_id, external_id) DO UPDATE SET project_id = excluded.project_id, local_table = excluded.local_table,
     local_id = excluded.local_id, last_seen_at = CURRENT_TIMESTAMP`;

revenue.post('/projects/:projectId/mercury-spend/snapshot', async (c) => {
  const g = await gate(c, true);
  if (g instanceof Response) return g;
  const owner = mercuryOwnerOnly(c, g, SPEND_OWNER_ONLY);
  if (owner) return owner;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  // Checked before anything reaches Mercury.
  if (body?.confirm_visible !== true) {
    return c.json({
      error: 'visibility_confirm_required',
      message: 'Confirm who will see the saved figures before saving them.',
      visibility: SPEND_VISIBILITY,
    }, 400);
  }
  if ('include_cash' in body && typeof body.include_cash !== 'boolean') {
    return c.json({ error: 'invalid_include_cash', message: 'Say whether to save your cash on hand as true or false.' }, 400);
  }
  const includeCash = body.include_cash === true;
  const conn = await personalConnection(c, g.user, 'venture_spend');
  if (conn instanceof Response) return conn;
  const today = todayIso();
  const last = lastFullMonthWindow(today);
  const window = readWindow(last.from, last.to, today);
  if ('error' in window) return c.json({ error: window.error, message: window.message }, 400);
  let lines = 0, saved = 0;
  try {
    let read: { lines: BankLine[]; capped: boolean; refused: number };
    try { read = await listOwnTransactions(conn, window); }
    catch (e) { return readFailure(c, conn, e); }
    lines = read.lines.length;
    if (read.capped) {
      return c.json({ error: 'spend_partial', message: 'Your Mercury holds more lines for that month than one read covers, so its burn cannot be saved. Nothing was saved.' }, 409);
    }
    const receipts = await confirmedRaiseReceiptIds(c, g.user.id);
    const [row] = bucketMonths(read.lines.map((l) => toSpendLine(l, receipts)), [last.month]);
    const figures = snapshotFigures(row, cashNow(conn.accounts).cents, includeCash, today);
    if (!figures.ok) return c.json({ error: figures.code, message: figures.message }, 409);
    let id: number | null = null;
    try {
      await ensureProjectMetricsSchema(c.env);
      await c.env.DB.prepare(SPEND_SNAPSHOT_UPSERT)
        .bind(g.project.id, today, figures.net_burn, figures.cash_balance, figures.notes, g.user.id).run();
      const stored = await c.env.DB.prepare(
        "SELECT id FROM project_metrics WHERE project_id = ? AND snapshot_date = ? AND source = 'mercury'",
      ).bind(g.project.id, today).first<{ id: number }>();
      id = stored ? Number(stored.id) : null;
      await c.env.DB.prepare(FED_SNAPSHOT_UPSERT).bind(conn.row.id, g.project.id, `spend-${g.project.id}-${today}`, id).run();
    } catch (err) {
      return refuse(c, 500, {
        code: 'snapshot_save_failed',
        message: 'The figures were read but could not be saved. Save again; nothing is recorded twice.',
        raw: err, audience: 'member',
      });
    }
    saved = 1;
    return c.json({
      ok: true, id, snapshot_date: today, month: last.month,
      net_burn: figures.net_burn, cash_balance: figures.cash_balance, source: 'mercury',
    });
  } finally {
    await logPersonalRead(c.env, conn, g.user, 'mercury_spend_snapshot', { lines, saved, cash: includeCash ? 1 : 0 }).catch(() => {});
  }
});

revenue.patch('/projects/:projectId/entries/:uid', async (c) => {
  const g = await gate(c, true);
  if (g instanceof Response) return g;
  const uid = c.req.param('uid');
  const row = await c.env.DB.prepare('SELECT * FROM revenue_entries WHERE uid = ? AND project_id = ?')
    .bind(uid, g.project.id).first<LedgerRow>();
  if (!row) return c.json({ error: 'entry_not_found', message: 'That entry is not on this startup\'s ledger.' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  // D587: a synced entry's amount, date and customer are what Stripe reported,
  // which is what `verified` means; only its type, notes and proof may change.
  if (row.source === 'stripe') {
    const stored: Record<string, unknown> = { customer: row.customer, amount_cents: Number(row.amount_cents), received_on: String(row.received_on).slice(0, 10) };
    // `amount` (a CSV-style cell) is never stored, so sending one always counts as a change.
    const changed = STRIPE_LOCKED_FIELDS.filter((k) => k in body && body[k] !== stored[k]);
    if (changed.length) {
      return c.json({
        error: 'synced_entry_locked',
        message: 'This entry came from a Stripe charge, so its amount, date and customer stay as Stripe reported them.',
        fields: changed,
      }, 409);
    }
  }
  // D713: the bank establishes the amount and date, never the customer label.
  if (row.source === 'mercury') {
    const stored: Record<string, unknown> = { amount_cents: Number(row.amount_cents), received_on: String(row.received_on).slice(0, 10) };
    const changed = MERCURY_LOCKED_FIELDS.filter((k) => k in body && body[k] !== stored[k]);
    if (changed.length) return c.json({ error: 'synced_entry_locked', message: 'This entry came from Mercury, so its amount and date stay as Mercury reported them.', fields: changed }, 409);
  }
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
