/** D1231 / #3239. Staff KYB review; company and account entities stay separate. */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAdmin, requireSuperAdmin, requireBranchNotSuspended, requireStepUp, isSuperAdmin } from '../auth';
import { branchOf, BRANCH_SUSPENDED } from '../util/branch';
import { hashEmail } from '../util/hashEmail';
import { AUTH_ERROR_STATUSES, STEP_UP_REQUIRED, ADMIN_FROZEN, stepUpRefusalBody, branchSuspendedBody, adminFrozenBody } from '../util/authErrors';
import { maskFor } from '../services/sensitiveFields';
import { requireCfAccess } from '../middleware/cfAccess';

type Ctx = Context<{ Bindings: Env }>;
type Row = Record<string, any>;
const kyb = new Hono<{ Bindings: Env }>();
const scope = (env: Env) => branchOf(env) || 'hq';
const KINDS = ['founder_company', 'investing_entity', 'partner_firm', 'imported_partner', 'licensed_studio'];
const STATUSES = ['not_started', 'in_review', 'needs_info', 'approved', 'rejected', 'expired', 'dismissed'];
const DOC_KINDS = ['incorporation', 'shareholders', 'registered_address', 'other'];
const MIME: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const text = (v: unknown, max = 1000): string | null => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;
const positive = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const refOk = (v: string) => /^(company|account|import|studio)-[1-9][0-9]{0,9}$/.test(v);
const uid = () => crypto.randomUUID();
const missing = (reason: string) => ({ available: true, recorded: false, reason });
const ok = (value: unknown) => ({ available: true, recorded: true, value });
const unreadable = () => ({ available: false, reason: 'Unreadable. Try again.' });
const parse = (v: unknown): Row[] | null => {
  if (v == null) return null;
  try { const p = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(p) && p.every(x => x && typeof x === 'object') ? p : null; } catch { return null; }
};

// Member declarations do not create trusted identity links. Only the staff
// owners write records user_id links in case_owners_json.
function declaredOwners(row: Row): Row[] | null {
  if (row.case_owners_json != null) return parse(row.case_owners_json);
  return parse(row.owners_json)?.map(p => ({ ...p, user_id: null })) ?? null;
}

// No database/provider exception text, submitted values or keys leave in errors/logs.
kyb.onError((err, c) => {
  if (err.message === STEP_UP_REQUIRED) return c.json(stepUpRefusalBody(err), 403);
  if (err.message === BRANCH_SUSPENDED) return c.json(branchSuspendedBody(err), 423);
  if (err.message === ADMIN_FROZEN) return c.json(adminFrozenBody(err), 423);
  const status = AUTH_ERROR_STATUSES[err.message];
  if (status) return c.json({ error: 'kyb_access_refused', detail: status === 401 ? 'Sign in to continue.' : 'This action requires authorized studio staff.' }, status);
  return c.json({ error: 'kyb_unreadable', detail: 'Unreadable. Try again.' }, 503);
});
kyb.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
kyb.use('/:id/documents/:documentId', requireCfAccess());

function audit(env: Env, user: User, actor: string, action: string, ref: string | null, field: string | null = null) {
  return env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)')
    .bind(action, JSON.stringify({ case: ref, outcome: 'completed', ...(field ? { field } : {}) }), actor, user.id);
}
async function find(c: Ctx, user: User): Promise<Row | null> {
  const ref = c.req.param('id') || '';
  if (!refOk(ref)) return null;
  const row = await c.env.DB.prepare('SELECT * FROM kyb_businesses WHERE uid = ? AND (studio_code IS NULL OR studio_code = ?)')
    .bind(ref, scope(c.env)).first<Row>();
  if (row?.kind === 'licensed_studio') await requireSuperAdmin(c);
  // Another administrator's legal entity is Super Admin data.
  if (row?.linked_user_id && row.linked_user_id !== user.id && !isSuperAdmin(user)) {
    const target = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(row.linked_user_id).first<{ role: string }>();
    if (target?.role === 'admin') await requireSuperAdmin(c);
  }
  return row;
}
async function writeUser(c: Ctx): Promise<User> {
  const user = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  await requireStepUp(c);
  return user;
}
async function materialize(c: Ctx, row: Row) {
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO kyb_cases (uid, studio_code, status, source_revision)
     SELECT uid, ?, status, source_revision FROM kyb_businesses WHERE uid = ? AND (studio_code IS NULL OR studio_code = ?)`,
  ).bind(scope(c.env), row.uid, scope(c.env)).run();
}
async function commit(c: Ctx, user: User, row: Row, statement: D1PreparedStatement, action: string, after: D1PreparedStatement[] = []) {
  const actor = await hashEmail(user.email), changeUid = uid();
  // A unique event claims this conditional write inside D1's batch transaction.
  // Later statements key off that event, even when an optional statement affects zero rows.
  const out = await c.env.DB.batch([
    statement,
    c.env.DB.prepare(`INSERT INTO kyb_case_events (uid, case_uid, action, actor_id)
      SELECT ?, ?, ?, ? WHERE changes() = 1`).bind(changeUid, row.uid, action, user.id),
    c.env.DB.prepare(`INSERT INTO activity_logs (action, details, actor, user_id)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM kyb_case_events WHERE uid = ?)`)
      .bind(action, JSON.stringify({ case: row.uid, outcome: 'completed' }), actor, user.id, changeUid),
    ...after,
    // Existing company members still read migration 220. Keep that projection in
    // the very same transaction, including an admin-started case with no submission.
    c.env.DB.prepare(`INSERT INTO company_kyb_records
      (uid, company_id, started_by_user_id, status, entity_name, reviewed_at, reviewed_by, rejection_reason)
      SELECT ?, s.company_id, ?, k.status, s.entity_name, k.reviewed_at, k.reviewed_by, k.decision_reason
      FROM kyb_business_sources s JOIN kyb_cases k ON k.uid = s.uid
      WHERE s.uid = ? AND s.kind = 'founder_company' AND k.studio_code = ?
        AND EXISTS (SELECT 1 FROM kyb_case_events WHERE uid = ?)
      ON CONFLICT(company_id) DO UPDATE SET status = excluded.status,
        reviewed_at = excluded.reviewed_at, reviewed_by = excluded.reviewed_by,
        rejection_reason = excluded.rejection_reason, updated_at = CURRENT_TIMESTAMP`)
      .bind(uid(), user.id, row.uid, scope(c.env), changeUid),
    c.env.DB.prepare(`UPDATE kyb_cases SET source_revision =
      (SELECT source_revision FROM kyb_business_sources WHERE uid = ?)
      WHERE uid = ? AND studio_code = ?
        AND EXISTS (SELECT 1 FROM kyb_business_sources WHERE uid = ? AND kind = 'founder_company')
        AND EXISTS (SELECT 1 FROM kyb_case_events WHERE uid = ?)`)
      .bind(row.uid, row.uid, scope(c.env), row.uid, changeUid),
  ]);
  return Number(out[0]?.meta?.changes || 0) === 1;
}
const absent = (c: Ctx) => c.json({ error: 'kyb_not_found', detail: 'This business is not available in this studio.' }, 404);
const conflict = (c: Ctx) => c.json({ error: 'kyb_changed', detail: 'The case changed. Read it again before deciding.' }, 409);

async function owners(env: Env, row: Row) {
  const raw = row.case_owners_json ?? row.owners_json;
  const people = declaredOwners(row);
  if (raw != null && !people) return unreadable();
  if (!people) return missing('Owners have not been recorded.');
  const ids = people.map(p => p.user_id).filter(positive);
  const result = await env.DB.prepare('SELECT id, name, kyc_status FROM users WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(ids)).all<Row>();
  const byId = new Map((result.results || []).map(p => [p.id, p]));
  return ok(people.map((p, index) => {
    const account = byId.get(p.user_id);
    return { index, name: p.name ?? null, ownership_pct: p.ownership_pct ?? null, nationality: p.nationality ?? null,
      date_of_birth: maskFor('date_of_birth', p.dob || null), user_id: account?.id ?? null,
      account_name: account?.name ?? null, kyc_status: account?.kyc_status ?? null,
      kyc_reason: account ? null : 'No account linked. Not recorded.',
      sanctions: missing('Screening is read from the person’s identity case.'),
    };
  }));
}
function summary(row: Row) {
  return { id: row.id, uid: row.uid, kind: row.kind, entity_name: row.entity_name, entity_type: row.entity_type,
    jurisdiction: row.jurisdiction, status: row.status, registration_number: maskFor('id_number', row.registration_number),
    submitted_at: row.submitted_at, reviewed_at: row.reviewed_at, expires_at: row.expires_at,
    company_id: row.company_id, linked_user_id: row.linked_user_id, licence_ref: row.licence_ref,
    owners_disclosed: !!(row.case_owners_disclosed ?? row.owners_disclosed), high_risk_country: row.high_risk_country,
    version: row.version };
}

kyb.get('/', async c => {
  const user = await requireAdmin(c);
  const q = c.req.query('q') || '', status = c.req.query('status') || '', kind = c.req.query('kind') || '';
  const jurisdiction = c.req.query('jurisdiction') || '';
  const page = Number(c.req.query('page') || 1), limit = Number(c.req.query('limit') || 25);
  if (q.length > 120 || jurisdiction.length > 64 || (status && !STATUSES.includes(status)) || (kind && !KINDS.includes(kind))
    || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return c.json({ error: 'invalid_kyb_filter', detail: 'Choose a valid filter and page.' }, 400);
  }
  const sup = isSuperAdmin(user) ? 1 : 0;
  const result = await c.env.DB.prepare(
    `SELECT b.* FROM kyb_businesses b
     WHERE (b.studio_code IS NULL OR b.studio_code = ?) AND (b.kind != 'licensed_studio' OR ? = 1)
       AND (? = 1 OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = b.linked_user_id AND u.role = 'admin' AND u.id != ?))
       AND (? = '' OR b.status = ?) AND (? = '' OR b.kind = ?) AND (? = '' OR b.jurisdiction = ?)
       AND (? = '' OR instr(lower(b.entity_name), lower(?)) > 0 OR instr(lower(COALESCE(b.registration_number,'')), lower(?)) > 0)
     ORDER BY julianday(COALESCE(b.submitted_at,b.created_at)), b.id LIMIT ? OFFSET ?`,
  ).bind(scope(c.env), sup, sup, user.id, status, status, kind, kind, jurisdiction, jurisdiction, q, q, q, limit, (page - 1) * limit).all<Row>();
  const counts = await c.env.DB.prepare(
    `SELECT b.status, COUNT(*) AS n, MIN(COALESCE(b.submitted_at,b.created_at)) AS oldest_at FROM kyb_businesses b
     WHERE (b.studio_code IS NULL OR b.studio_code = ?) AND (b.kind != 'licensed_studio' OR ? = 1)
       AND (? = 1 OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = b.linked_user_id AND u.role = 'admin' AND u.id != ?))
       AND (? = '' OR b.status = ?) AND (? = '' OR b.kind = ?) AND (? = '' OR b.jurisdiction = ?)
       AND (? = '' OR instr(lower(b.entity_name), lower(?)) > 0 OR instr(lower(COALESCE(b.registration_number,'')), lower(?)) > 0)
     GROUP BY b.status`,
  ).bind(scope(c.env), sup, sup, user.id, status, status, kind, kind, jurisdiction, jurisdiction, q, q, q).all<Row>();
  await audit(c.env, user, await hashEmail(user.email), 'kyb_queue_access', null).run();
  return c.json({ items: (result.results || []).map(summary), page, limit,
    total: (counts.results || []).reduce((n, r) => n + Number(r.n), 0), counts: counts.results || [] });
});

kyb.post('/licensed-studios', async c => {
  const user = await requireSuperAdmin(c);
  await requireBranchNotSuspended(c);
  await requireStepUp(c);
  const b = await c.req.json<Row>().catch(() => ({} as Row));
  if (!text(b.licence_uid, 100) || !text(b.jurisdiction, 64)) return c.json({ error: 'invalid_studio', detail: 'Choose a licence and its registered jurisdiction.' }, 400);
  const licence = await c.env.DB.prepare('SELECT id, legal_entity_name FROM territory_licences WHERE uid = ?').bind(b.licence_uid).first<Row>();
  if (!licence) return absent(c);
  const exists = await c.env.DB.prepare('SELECT id FROM kyb_licensed_studios WHERE licence_id = ?').bind(licence.id).first<Row>();
  if (exists) return c.json({ error: 'studio_already_recorded', detail: 'This licence already has a business case.' }, 409);
  const out = await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO kyb_licensed_studios (uid, licence_id, entity_name, entity_type, jurisdiction, registration_number, registered_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(uid(), licence.id, licence.legal_entity_name, text(b.entity_type, 64), text(b.jurisdiction, 64), text(b.registration_number, 120), text(b.registered_address, 1000)),
    audit(c.env, user, await hashEmail(user.email), 'kyb_studio_recorded', null),
  ]);
  return c.json({ uid: `studio-${out[0].meta.last_row_id}`, status: 'in_review' }, 201);
});

kyb.get('/:id', async c => {
  const user = await requireAdmin(c), row = await find(c, user);
  if (!row) return absent(c);
  const block = async (fn: () => Promise<unknown>) => { try { return await fn(); } catch { return unreadable(); } };
  const ownerBlock = await block(() => owners(c.env, row));
  const documents = await block(async () => ok((await c.env.DB.prepare('SELECT uid, kind, content_type, size_bytes, created_at FROM kyb_documents WHERE case_uid = ? AND deleted_at IS NULL ORDER BY id')
    .bind(row.uid).all<Row>()).results || []));
  const history = await block(async () => ok((await c.env.DB.prepare(`SELECT e.action, e.created_at, u.name AS actor_name FROM kyb_case_events e
    LEFT JOIN users u ON u.id = e.actor_id WHERE e.case_uid = ? ORDER BY e.id DESC LIMIT 100`).bind(row.uid).all<Row>()).results || []));
  const diligence = await block(async () => {
    if (!row.linked_user_id) return missing('No account entity is linked to a due-diligence subject.');
    const cases = await c.env.DB.prepare(`SELECT d.uid, d.status, s.status AS kyb_section_status,
      (SELECT COUNT(*) FROM dd_checklist_items i WHERE i.section_id = s.id) AS items,
      (SELECT COUNT(*) FROM dd_checklist_items i WHERE i.section_id = s.id AND i.status = 'pending') AS waiting
      FROM dd_cases d LEFT JOIN dd_sections s ON s.case_id = d.id AND s.section_key = 'kyb_entity'
      WHERE d.subject_id = ? AND d.subject_type IN ('partner','investor') ORDER BY d.id DESC LIMIT 20`)
      .bind(row.linked_user_id).all<Row>();
    return cases.results?.length ? ok(cases.results.map(item => ({ ...item, read_only: true }))) : missing('No due-diligence case is recorded for this account entity.');
  });
  await audit(c.env, user, await hashEmail(user.email), 'kyb_record_access', row.uid).run();
  return c.json({ ...summary(row), entity: {
    registered_address: maskFor('address', row.registered_address), tax_id: row.tax_id_last4 ? `••••${row.tax_id_last4}` : null,
    signing_authority_name: row.signing_authority_name, signing_authority_title: row.signing_authority_title,
  }, owners: ownerBlock, directors: parse(row.case_directors_json ?? row.directors_json)?.map(p => ({ name: p.name ?? null, title: p.title ?? null })) ?? missing('Directors have not been recorded.'),
  documents, history, registry: row.registry_matches == null ? missing('No registry check has been recorded.') : ok({ matches: !!row.registry_matches, good_standing: row.good_standing == null ? null : !!row.good_standing }),
  due_diligence: diligence,
  sanctions_last_checked_at: row.sanctions_last_checked_at,
  requested_documents: parse(row.requested_documents_json), decision_reason: row.decision_reason,
  unchecked_owner_reason: row.unchecked_owner_reason });
});

kyb.get('/:id/sensitive/:field', async c => {
  const user = await requireAdmin(c), row = await find(c, user);
  if (!row) return absent(c);
  const field = c.req.param('field');
  let value: string | null = null;
  if (field === 'address') value = row.registered_address;
  else if (field === 'registration_number') value = row.registration_number;
  else if (field === 'owner_dob') {
    const index = Number(c.req.query('index'));
    if (!Number.isSafeInteger(index) || index < 0) return c.json({ error: 'invalid_owner', detail: 'Choose a recorded owner.' }, 400);
    value = parse(row.case_owners_json ?? row.owners_json)?.[index]?.dob ?? null;
  } else return c.json({ error: 'unknown_field', detail: 'Choose address, registration_number or owner_dob.' }, 400);
  if (!value) return c.json({ error: 'field_not_recorded', detail: 'Not recorded. Nothing was shown.' }, 404);
  await audit(c.env, user, await hashEmail(user.email), 'kyc_field_shown', row.uid, field).run();
  return c.json({ field, value, shown_at: new Date().toISOString() });
});

kyb.put('/:id/owners', async c => {
  const user = await writeUser(c), row = await find(c, user);
  if (!row) return absent(c);
  const b = await c.req.json<Row>().catch(() => ({} as Row)), people = parse(b.owners), directors = parse(b.directors ?? []);
  if (typeof b.disclosed !== 'boolean' || !people || people.length > 50 || !directors || directors.length > 50
    || people.some(p => !text(p.name, 255) || typeof p.ownership_pct !== 'number' || p.ownership_pct < 0 || p.ownership_pct > 100
      || (p.user_id != null && !positive(p.user_id)) || (p.dob != null && (typeof p.dob !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.dob)))
      || (p.nationality != null && !text(p.nationality, 64)))
    || people.reduce((n, p) => n + p.ownership_pct, 0) > 100.00001
    || directors.some(p => !text(p.name, 255) || (p.title != null && !text(p.title, 255)))) {
    return c.json({ error: 'invalid_owners', detail: 'Record valid owners, percentages, account links and directors.' }, 400);
  }
  const ids = [...new Set(people.map(p => p.user_id).filter(positive))];
  const accounts = await c.env.DB.prepare('SELECT id, role FROM users WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<Row>();
  if ((accounts.results || []).length !== ids.length) return absent(c);
  if ((accounts.results || []).some(a => a.role === 'admin' && a.id !== user.id)) await requireSuperAdmin(c);
  await materialize(c, row);
  const changed = await commit(c, user, row, c.env.DB.prepare(
    `UPDATE kyb_cases SET owners_json = ?, directors_json = ?, owners_disclosed = ?, source_revision = ?,
      status = CASE WHEN status = 'approved' THEN 'needs_info' ELSE status END,
      registry_matches = NULL, good_standing = NULL, expires_at = NULL,
      version = version + 1, updated_at = CURRENT_TIMESTAMP
     WHERE uid = ? AND studio_code = ? AND version = ?`,
  ).bind(JSON.stringify(people.map(p => ({ name: p.name.trim(), ownership_pct: p.ownership_pct, user_id: p.user_id ?? null, dob: p.dob ?? null, nationality: p.nationality ?? null }))),
    JSON.stringify(directors.map(p => ({ name: p.name.trim(), title: p.title ?? null }))), b.disclosed ? 1 : 0, row.source_revision, row.uid, scope(c.env), row.version), 'kyb_owners_updated');
  return changed ? c.json({ ok: true }) : conflict(c);
});

kyb.patch('/:id/approve', async c => {
  const user = await writeUser(c), row = await find(c, user);
  if (!row) return absent(c);
  if (['approved', 'dismissed'].includes(row.status)) return conflict(c);
  const b = await c.req.json<Row>().catch(() => ({} as Row));
  const reason = text(b.unchecked_owner_reason, 2000);
  const people = declaredOwners(row);
  if (b.registry_matches !== true || b.owners_identified !== true || b.owners_checked_or_explained !== true
    || !(row.case_owners_disclosed ?? row.owners_disclosed) || !people) {
    return c.json({ error: 'kyb_checks_required', detail: 'Confirm the registry and identify and disclose the owners before approval.' }, 400);
  }
  const relevant = people.filter(p => p.ownership_pct == null || p.ownership_pct >= 25);
  const ids = relevant.map(p => p.user_id).filter(positive);
  const checked = await c.env.DB.prepare("SELECT id FROM users WHERE kyc_status = 'approved' AND id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)).all<Row>();
  const checkedIds = new Set((checked.results || []).map(p => p.id));
  if (relevant.some(p => !checkedIds.has(p.user_id)) && (!reason || reason.length < 5)) {
    return c.json({ error: 'unchecked_owner_reason_required', detail: 'Explain each owner whose identity check is not approved.' }, 400);
  }
  await materialize(c, row);
  const expires = new Date(Date.now() + 2 * 365 * 86400000).toISOString();
  const changed = await commit(c, user, row, c.env.DB.prepare(
    `UPDATE kyb_cases SET status = 'approved', registry_matches = 1, good_standing = ?, unchecked_owner_reason = ?,
      decision_reason = ?, source_revision = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, expires_at = ?,
      version = version + 1, updated_at = CURRENT_TIMESTAMP
     WHERE uid = ? AND studio_code = ? AND version = ?
       AND EXISTS (SELECT 1 FROM kyb_business_sources s WHERE s.uid = kyb_cases.uid AND s.source_revision = ?)
       AND (? IS NOT NULL OR NOT EXISTS (
         SELECT 1 FROM json_each(?) o LEFT JOIN users u ON u.id = json_extract(o.value,'$.user_id')
         WHERE (json_extract(o.value,'$.ownership_pct') IS NULL OR json_extract(o.value,'$.ownership_pct') >= 25)
           AND COALESCE(u.kyc_status,'not_started') != 'approved'))`,
  ).bind(typeof b.good_standing === 'boolean' ? Number(b.good_standing) : null, reason, text(b.note, 2000), row.source_revision, user.id, expires,
    row.uid, scope(c.env), row.version, row.source_revision, reason, JSON.stringify(relevant)), 'kyb_approved');
  return changed ? c.json({ uid: row.uid, status: 'approved', expires_at: expires }) : conflict(c);
});

kyb.patch('/:id/reject', async c => {
  const user = await writeUser(c), row = await find(c, user);
  if (!row) return absent(c);
  const b = await c.req.json<Row>().catch(() => ({} as Row)), reason = text(b.reason, 2000);
  if (!reason || reason.length < 5) return c.json({ error: 'reason_required', detail: 'Give a reason of at least five characters.' }, 400);
  await materialize(c, row);
  const docs = await c.env.DB.prepare('SELECT file_key FROM kyb_documents WHERE case_uid = ?').bind(row.uid).all<Row>();
  const changed = await commit(c, user, row, c.env.DB.prepare(
    `UPDATE kyb_cases SET status = 'rejected', decision_reason = ?, source_revision = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
      expires_at = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE uid = ? AND studio_code = ? AND version = ?`,
  ).bind(reason, row.source_revision, user.id, row.uid, scope(c.env), row.version), 'kyb_rejected', [
    c.env.DB.prepare('UPDATE kyb_documents SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE case_uid = ? AND changes() = 1').bind(row.uid),
  ]);
  if (!changed) return conflict(c);
  if ((docs.results || []).length && !c.env.FILES) return c.json({ error: 'kyb_cleanup_pending', detail: 'Rejected. Document deletion is incomplete. Try again.' }, 503);
  for (const doc of docs.results || []) await c.env.FILES!.delete(doc.file_key);
  return c.json({ uid: row.uid, status: 'rejected' });
});

kyb.patch('/:id/request-documents', async c => {
  const user = await writeUser(c), row = await find(c, user);
  if (!row) return absent(c);
  const b = await c.req.json<Row>().catch(() => ({} as Row));
  if (!Array.isArray(b.kinds) || !b.kinds.length || b.kinds.some((k: unknown) => !DOC_KINDS.includes(String(k))) || !text(b.message, 2000)) {
    return c.json({ error: 'documents_required', detail: 'Choose the documents and write the request.' }, 400);
  }
  await materialize(c, row);
  const changed = await commit(c, user, row, c.env.DB.prepare(
    `UPDATE kyb_cases SET status = 'needs_info', requested_documents_json = ?, decision_reason = ?, source_revision = ?,
      expires_at = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE uid = ? AND studio_code = ? AND version = ?`,
  ).bind(JSON.stringify([...new Set(b.kinds)].map(kind => ({ kind }))), text(b.message, 2000), row.source_revision, row.uid, scope(c.env), row.version), 'kyb_documents_requested');
  return changed ? c.json({ uid: row.uid, status: 'needs_info' }) : conflict(c);
});

kyb.patch('/:id/dismiss', async c => {
  const user = await writeUser(c), row = await find(c, user);
  if (!row) return absent(c);
  if (row.kind !== 'imported_partner' || row.linked_user_id || row.status === 'dismissed') return c.json({ error: 'not_unlinked_import', detail: 'Only an unlinked import can be dismissed.' }, 409);
  const b = await c.req.json<Row>().catch(() => ({} as Row)), reason = text(b.reason, 2000);
  if (!reason || reason.length < 5) return c.json({ error: 'reason_required', detail: 'Give a reason of at least five characters.' }, 400);
  await materialize(c, row);
  const changed = await commit(c, user, row, c.env.DB.prepare(
    `UPDATE kyb_cases SET status = 'dismissed', decision_reason = ?, source_revision = ?, expires_at = NULL,
      reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, version = version + 1, updated_at = CURRENT_TIMESTAMP
     WHERE uid = ? AND studio_code = ? AND version = ? AND linked_user_id IS NULL`,
  ).bind(reason, row.source_revision, user.id, row.uid, scope(c.env), row.version), 'kyb_import_dismissed');
  return changed ? c.json({ uid: row.uid, status: 'dismissed' }) : conflict(c);
});

kyb.patch('/:id/link-account', async c => {
  const user = await writeUser(c), row = await find(c, user);
  if (!row) return absent(c);
  const b = await c.req.json<Row>().catch(() => ({} as Row));
  if (row.kind !== 'imported_partner' || row.status === 'dismissed' || row.linked_user_id || !positive(b.user_id)) return c.json({ error: 'invalid_import_link', detail: 'Choose an unlinked import and an account in this studio.' }, 400);
  const account = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(b.user_id).first<Row>();
  if (!account) return absent(c);
  if (account.role === 'admin' && account.id !== user.id) await requireSuperAdmin(c);
  await materialize(c, row);
  const changed = await commit(c, user, row, c.env.DB.prepare(
    `UPDATE kyb_cases SET linked_user_id = ?, status = 'in_review', source_revision = ?, expires_at = NULL,
      reviewed_at = NULL, reviewed_by = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP
     WHERE uid = ? AND studio_code = ? AND version = ? AND linked_user_id IS NULL`,
  ).bind(account.id, row.source_revision, row.uid, scope(c.env), row.version), 'kyb_import_linked');
  return changed ? c.json({ uid: row.uid, linked_user_id: account.id, status: 'in_review' }) : conflict(c);
});

kyb.post('/:id/documents', async c => {
  const user = await writeUser(c), row = await find(c, user);
  if (!row) return absent(c);
  const b = await c.req.json<Row>().catch(() => ({} as Row));
  if (!DOC_KINDS.includes(b.kind) || typeof b.data_uri !== 'string') return c.json({ error: 'invalid_document', detail: 'Choose a document kind and a PDF or image.' }, 400);
  const match = /^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(b.data_uri);
  if (!match) return c.json({ error: 'invalid_document', detail: 'Choose a PDF, JPEG, PNG or WebP document.' }, 400);
  if (match[2].length > 8 * 1024 * 1024) return c.json({ error: 'document_too_large', detail: 'The document must be at most 6 MB.' }, 413);
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(match[2]), ch => ch.charCodeAt(0)); } catch { return c.json({ error: 'invalid_document', detail: 'The document could not be decoded.' }, 400); }
  if (!bytes.length || bytes.length > 6 * 1024 * 1024) return c.json({ error: 'invalid_document_size', detail: 'Choose a nonempty document of at most 6 MB.' }, 400);
  if (!c.env.FILES) return c.json({ error: 'document_storage_unavailable', detail: 'Unreadable. Document storage is unavailable. Try again.' }, 503);
  await materialize(c, row);
  const documentUid = uid(), key = `kyb/${scope(c.env)}/${row.uid}/${documentUid}.${MIME[match[1]]}`;
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: match[1] } });
  try {
    const changed = await commit(c, user, row, c.env.DB.prepare(
      `UPDATE kyb_cases SET status = 'in_review', source_revision = ?, expires_at = NULL,
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE uid = ? AND studio_code = ? AND version = ?`,
    ).bind(row.source_revision, row.uid, scope(c.env), row.version), 'kyb_document_uploaded', [
      c.env.DB.prepare(`INSERT INTO kyb_documents (uid, case_uid, kind, file_key, content_type, size_bytes, uploaded_by)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
        .bind(documentUid, row.uid, b.kind, key, match[1], bytes.length, user.id),
    ]);
    if (!changed) { await c.env.FILES.delete(key); return conflict(c); }
  } catch {
    await c.env.FILES.delete(key);
    return c.json({ error: 'document_not_saved', detail: 'The document was not saved. Try again.' }, 503);
  }
  return c.json({ uid: documentUid, kind: b.kind, size_bytes: bytes.length }, 201);
});

kyb.get('/:id/documents/:documentId', async c => {
  const user = await requireAdmin(c), row = await find(c, user);
  if (!row) return absent(c);
  const doc = await c.env.DB.prepare('SELECT file_key, content_type, size_bytes FROM kyb_documents WHERE uid = ? AND case_uid = ? AND deleted_at IS NULL')
    .bind(c.req.param('documentId'), row.uid).first<Row>();
  if (!doc || !doc.file_key.startsWith(`kyb/${scope(c.env)}/${row.uid}/`)) return absent(c);
  if (!MIME[doc.content_type] || !c.env.FILES) return c.json({ error: 'document_unreadable', detail: 'Unreadable. Try again.' }, 503);
  const obj = await c.env.FILES.get(doc.file_key);
  if (!obj) return c.json({ error: 'document_missing', detail: 'The recorded document is missing from storage.' }, 404);
  await audit(c.env, user, await hashEmail(user.email), 'kyb_document_access', row.uid).run();
  return new Response(obj.body, { headers: { 'Content-Type': doc.content_type, 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline' } });
});

export default kyb;
