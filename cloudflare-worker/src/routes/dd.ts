import { investorHasProjectDeal } from '../services/dealAccess';
/**
 * Task #3 — Due Diligence routes mounted at /api/dd.
 *
 * Access:
 *   - Founders are NEVER allowed: any DD endpoint that doesn't require
 *     `admin` requires `partner|investor|advisor` AND a matching reviewer
 *     row on the section being acted on.
 *   - Admins have full read+write across every case.
 *   - Founders ARE notified once when the final report is shared (via
 *     POST /:id/report/share — separate route so we can audit it), but
 *     never read DD data.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireFactor, requireStepUp, requireSuperAdmin, isSuperAdmin } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { mintDownloadToken, verifyAndConsumeToken } from '../services/signedDownload';
import { notify } from '../services/notify';
import {
  SECTION_CATALOG, CONNECTORS, sectionsFor, runConnector,
  checklistFor,
  computeScore, worstSeverity,
  encField, decField,
  DD_DECISIONS, BLOCKING_FLAG_REFUSAL, blockingSectionsWithOpenSevereFlags, stampNewCase,
  TEMPLATE_DEPTHS, DEPTH_RANK, builtInTemplate, checkTemplateBody, latestTemplate, seedFromTemplate, CHECKLIST_CATALOG,
  renderReportArtifact,
  type DDSubjectType, type ReportCase, type ReportSection, type ChecklistDepth, type TemplateBody,
} from '../services/dueDiligence';
import { encryptBytes, decryptBytes } from '../services/cryptoBox';
import { createIcRecordForCase, icRecordForCase, caseSentToIc } from './ic';

const dd = new Hono<{ Bindings: Env }>();
type AppContext = Context<{ Bindings: Env }>;

// ---------- helpers ----------

function genUid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getCaseByUid(env: Env, uid: string): Promise<Record<string, unknown> | null> {
  const sql = getSQL(env);
  try {
    const rows: any[] = await sql`SELECT * FROM dd_cases WHERE uid = ${uid} LIMIT 1`;
    return rows[0] || null;
  } finally { await sql.end(); }
}

interface AppUser { id: number; role: string; email: string; }

/**
 * D1246 — the case lead (migration 620). A case opened before the column, or
 * by a path that has not stamped it yet, is led by its opener.
 */
function leadOf(cs: Record<string, unknown>): number {
  return Number(cs.lead_user_id ?? cs.owner_user_id);
}
const isLead = (user: AppUser, cs: Record<string, unknown>) => leadOf(cs) === user.id;
/** The opener keeps the access they had; the lead has the same. */
const leadsOrOpened = (user: AppUser, cs: Record<string, unknown>) => isLead(user, cs) || Number(cs.owner_user_id) === user.id;

async function requireDdReader(c: AppContext): Promise<AppUser> {
  const user = await requireAuth(c);
  // Founders are explicitly blocked from every DD endpoint. They are
  // notified once when the report is shared (via /report/share) but
  // never read DD data themselves. The User.role union doesn't currently
  // include 'advisor' (see types.ts) so we widen here — advisors are stored
  // in the DB with role='advisor' even though the type literal doesn't
  // list it (legacy from before the advisor role split).
  const role = String(user.role);
  if (role !== 'admin' && role !== 'partner' && role !== 'investor' && role !== 'advisor') {
    throw new Error('Forbidden');
  }
  return user as unknown as AppUser;
}

/**
 * Scoped-write guard: admin can mutate any case; everyone else must own
 * the case OR have a `dd_reviewers` row on it. Knowing the case UID is
 * not enough — partners cannot scan/assign/report on cases they do not
 * own or review.
 */
async function requireCaseWriter(c: AppContext, cs: Record<string, unknown>): Promise<AppUser> {
  const user = await requireDdReader(c);
  if (user.role === 'admin') return user;
  if (leadsOrOpened(user, cs)) return user;
  const sql = getSQL(c.env);
  try {
    const r: any[] = await sql`SELECT 1 FROM dd_reviewers WHERE case_id = ${cs.id} AND user_id = ${user.id} LIMIT 1`;
    if (r.length === 0) throw new Error('Forbidden: not a case owner or reviewer');
  } finally { await sql.end(); }
  return user;
}

async function audit(env: Env, caseId: number, actor: AppUser | null, action: string, target?: { type: string; id: number }, details?: unknown): Promise<void> {
  try {
    const actorHash = actor?.email ? await hashEmail(actor.email) : null;
    // Insert without details first so we have a row id to encrypt against
    // (column cipher uses rowId as AAD).
    const ins = await env.DB.prepare(
      `INSERT INTO dd_audit_log (case_id, actor_user_id, actor_email_hash, action, target_type, target_id)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    ).bind(
      caseId, actor?.id || null, actorHash, action,
      target?.type || null, target?.id || null,
    ).first<{ id: number }>();
    if (details && ins?.id) {
      const detailsEnc = await encField(env, 'dd_audit_log', 'details', Number(ins.id), JSON.stringify(details));
      await env.DB.prepare(`UPDATE dd_audit_log SET details_enc = ? WHERE id = ?`).bind(detailsEnc, ins.id).run();
    }
  } catch (e) {
    console.warn('[dd] audit insert failed:', (e as Error).message);
  }
}

// ---------- catalog endpoints ----------

dd.get('/catalog', async (c) => {
  await requireDdReader(c);
  return c.json({
    sections: SECTION_CATALOG,
    connectors: CONNECTORS.map(({ key, label, default_section }) => ({ key, label, default_section })),
    risk_bands: [
      { key: 'green',  label: 'Green',  min_score: 0.8 },
      { key: 'yellow', label: 'Yellow', min_score: 0.6 },
      { key: 'amber',  label: 'Amber',  min_score: 0.4 },
      { key: 'red',    label: 'Red',    min_score: 0.0 },
    ],
  });
});

// ---------- list / open / get ----------

// D1249 (#3264, DDL1): the list is the server's, searched, filtered, sorted
// and paged, with each row's counts. Called with none of the new parameters
// it answers as before (the newest 200), with `total` beside `items`.
//
// ONE FIXED STATEMENT. Every filter is an optional bound value (`? IS NULL OR
// …`), so the SQL text never changes with the request and nothing is
// interpolated; the list, its count and the overview read the same predicate.
const READY_EXPR = "(c.status IN ('open', 'in_review')"
  + ' AND EXISTS (SELECT 1 FROM dd_sections s WHERE s.case_id = c.id)'
  + ' AND NOT EXISTS (SELECT 1 FROM dd_sections s WHERE s.case_id = c.id AND s.verdict IS NULL))';
const CASE_FILTER_SQL = ' WHERE (? IS NULL OR c.subject_type = ?)'
  + ' AND (? IS NULL OR c.status = ?)'
  + " AND (? IS NULL OR (? = 'none' AND c.risk_band IS NULL) OR c.risk_band = ?)"
  + " AND (? IS NULL OR (? = 'ready' AND " + READY_EXPR + ')'
  + "      OR (? = 'not_started' AND c.status = 'open' AND NOT " + READY_EXPR + ')'
  + "      OR (? = 'in_review' AND c.status = 'in_review' AND NOT " + READY_EXPR + ')'
  + "      OR (? = 'decided' AND c.status = 'completed')"
  + "      OR (? = 'archived' AND c.status = 'archived'))"
  + ' AND (? IS NULL OR COALESCE(c.lead_user_id, c.owner_user_id) = ?)'
  + ' AND (? IS NULL OR c.template_depth = ?)'
  + " AND (? IS NULL OR (? = 'none' AND c.decision IS NULL) OR c.decision = ?)"
  + " AND (? = 0 OR (c.status IN ('open', 'in_review') AND c.target_ic_date IS NOT NULL AND c.target_ic_date < date('now')))"
  + " AND (? IS NULL OR c.subject_label LIKE ? ESCAPE '\\' OR c.uid LIKE ? ESCAPE '\\')"
  + ' AND (? = 1 OR c.owner_user_id = ? OR c.lead_user_id = ? OR c.id IN (SELECT case_id FROM dd_reviewers WHERE user_id = ?))';
const SEVERITY_RANK_F = "CASE f.severity WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END";
const SEVERITY_RANK_I = "CASE WHEN i.severity = 'critical' THEN 5 WHEN i.severity = 'high' THEN 4 WHEN i.severity = 'medium' THEN 3"
  + " WHEN i.severity = 'low' THEN 2 WHEN i.severity IS NOT NULL THEN 1 WHEN i.status = 'fail' THEN 3 ELSE 2 END";
const LIST_COUNT_SQL = 'SELECT COUNT(*) AS n FROM dd_cases c' + CASE_FILTER_SQL;
const LIST_ROWS_SQL = 'SELECT c.id, c.uid, c.subject_type, c.subject_id, c.subject_label, c.status, c.risk_score, c.risk_band,'
  + ' c.owner_user_id, COALESCE(c.lead_user_id, c.owner_user_id) AS lead_user_id, lu.name AS lead_name,'
  + ' c.template_depth, c.target_ic_date, c.decision, c.decided_at, c.archived_at,'
  + ' c.created_at, c.updated_at, c.report_generated_at,'
  + " CASE WHEN c.status = 'completed' THEN 'decided' WHEN c.status = 'archived' THEN 'archived'"
  + ' WHEN ' + READY_EXPR + " THEN 'ready' WHEN c.status = 'in_review' THEN 'in_review' ELSE 'not_started' END AS stage,"
  + ' (SELECT COUNT(*) FROM dd_checklist_items i WHERE i.case_id = c.id) AS checklist_total,'
  + " (SELECT COUNT(*) FROM dd_checklist_items i WHERE i.case_id = c.id AND i.status != 'pending') AS checklist_worked,"
  + ' ((SELECT COUNT(*) FROM dd_findings f WHERE f.case_id = c.id AND f.resolved_at IS NULL)'
  + "  + (SELECT COUNT(*) FROM dd_checklist_items i WHERE i.case_id = c.id AND i.status IN ('flag', 'fail'))) AS open_flags,"
  + ' (SELECT MAX(r) FROM (SELECT ' + SEVERITY_RANK_F + ' AS r FROM dd_findings f WHERE f.case_id = c.id AND f.resolved_at IS NULL'
  + '   UNION ALL SELECT ' + SEVERITY_RANK_I + " FROM dd_checklist_items i WHERE i.case_id = c.id AND i.status IN ('flag', 'fail'))) AS worst_rank,"
  + " (SELECT COUNT(*) FROM dd_requests r WHERE r.case_id = c.id AND r.state = 'requested') AS requests_waiting"
  + ' FROM dd_cases c LEFT JOIN users lu ON lu.id = COALESCE(c.lead_user_id, c.owner_user_id)'
  + CASE_FILTER_SQL
  + " ORDER BY CASE WHEN ? = 'name' THEN c.subject_label END COLLATE NOCASE ASC,"
  + "  CASE WHEN ? = 'target' THEN (c.target_ic_date IS NULL) END ASC,"
  + "  CASE WHEN ? = 'target' THEN c.target_ic_date END ASC,"
  + "  CASE WHEN ? = 'activity' THEN c.updated_at END DESC,"
  + "  CASE WHEN ? = 'flags' THEN open_flags END DESC,"
  + '  c.created_at DESC, c.id DESC'
  + ' LIMIT ? OFFSET ?';
const LIST_SORTS = new Set(['opened', 'target', 'activity', 'flags', 'name']);
const LIST_STAGES = new Set(['not_started', 'in_review', 'ready', 'decided', 'archived']);
const SEVERITY_WORD = ['', 'info', 'low', 'medium', 'high', 'critical'];

/** The binds for CASE_FILTER_SQL, in its order: the query's filters, then who may see which cases. */
function caseFilterBinds(user: AppUser, q: (k: string) => string | undefined): unknown[] {
  const opt = (v: string | undefined) => (v == null || v === '' ? null : v);
  const subjectType = opt(q('subject_type'));
  const status = opt(q('status'));
  const band = opt(q('risk_band'));
  const stage = LIST_STAGES.has(String(q('stage'))) ? String(q('stage')) : null;
  const leadN = Number(q('lead'));
  const lead = Number.isInteger(leadN) && leadN > 0 ? leadN : null;
  const template = opt(q('template'));
  const decision = opt(q('decision'));
  const search = String(q('q') ?? '').trim().slice(0, 100);
  const like = search ? search.replace(/[\\%_]/g, (m) => `\\${m}`) : null;
  const everyone = user.role === 'admin' && q('owner_only') !== '1' ? 1 : 0;
  return [
    subjectType, subjectType,
    status, status,
    band, band, band,
    stage, stage, stage, stage, stage, stage,
    lead, lead,
    template, template,
    decision, decision, decision,
    q('past_target') === '1' ? 1 : 0,
    like, like == null ? null : `%${like}%`, like == null ? null : `${like}%`,
    everyone, user.id, user.id, user.id,
  ];
}

dd.get('/cases', async (c) => {
  const user = await requireDdReader(c);
  const q = (k: string) => c.req.query(k);
  const sort = LIST_SORTS.has(String(q('sort'))) ? String(q('sort')) : 'opened';
  const pageSize = Math.min(Math.max(Number.parseInt(String(q('page_size') ?? '200'), 10) || 200, 1), 200);
  const page = Math.max(Number.parseInt(String(q('page') ?? '1'), 10) || 1, 1);
  const binds = caseFilterBinds(user, q);
  const counted = await c.env.DB.prepare(LIST_COUNT_SQL).bind(...binds).first<{ n: number }>();
  const rows = await c.env.DB.prepare(LIST_ROWS_SQL)
    .bind(...binds, sort, sort, sort, sort, sort, pageSize, (page - 1) * pageSize).all<any>();
  const items = (rows.results || []).map(({ worst_rank, ...r }: any) => ({ ...r, worst_severity: worst_rank ? SEVERITY_WORD[Number(worst_rank)] : null }));
  return c.json({ items, total: Number(counted?.n ?? 0), page, page_size: pageSize, sort });
});

dd.post('/cases', async (c) => {
  const user = await requireDdReader(c);
  // Task #83 — de-admin Due Diligence. Admins/partners may open a case on any
  // subject. Investors get a scoped path: they may open diligence ONLY on a
  // startup (subject_type='project') whose deal invited them or records their
  // commitment (the same predicate as the deal reader) — this is a role gate
  // AND an ownership gate, so an investor can't open cases on arbitrary
  // founders/partners/other investors. Advisors remain read/review-only.
  const isPrivileged = user.role === 'admin' || user.role === 'partner';
  if (!isPrivileged && user.role !== 'investor') {
    return c.json({ error: 'You do not have permission to open cases' }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  const subjectType = String(body.subject_type || '') as DDSubjectType;
  const subjectId = Number(body.subject_id);
  const subjectLabel = String(body.subject_label || '').trim();
  if (!['project','founder','advisor','investor','partner'].includes(subjectType)) {
    return c.json({ error: 'Invalid subject_type' }, 400);
  }
  if (!subjectId || !subjectLabel) {
    return c.json({ error: 'subject_id and subject_label are required' }, 400);
  }
  // Build queue #128 — stage templates. The depth picks how many
  // checklist items are seeded per section (lite ⊂ standard ⊂ deep).
  const templateDepth: ChecklistDepth = (['lite', 'standard', 'deep'] as const)
    .includes(body.template_depth) ? body.template_depth : 'standard';
  const sql = getSQL(c.env);
  try {
    if (!isPrivileged) {
      if (subjectType !== 'project') {
        return c.json({ error: 'You can only open diligence on a startup you are in a deal with' }, 403);
      }
      if (!(await investorHasProjectDeal(c.env, user.id, subjectId))) {
        return c.json({ error: 'An invitation or commitment is required to open diligence on this startup.' }, 403);
      }
    }
    const uid = genUid();
    const inserted: any[] = await sql`
      INSERT INTO dd_cases (uid, subject_type, subject_id, subject_label, owner_user_id, template_depth)
      VALUES (${uid}, ${subjectType}, ${subjectId}, ${subjectLabel}, ${user.id}, ${templateDepth})
      RETURNING id, uid, subject_type, subject_id, subject_label, status, owner_user_id, template_depth, created_at`;
    const row = inserted[0];
    const caseId = Number(row.id);

    if (body.notes) {
      const notesEnc = await encField(c.env, 'dd_cases', 'notes', caseId, String(body.notes));
      await sql`UPDATE dd_cases SET notes_enc = ${notesEnc} WHERE id = ${caseId}`;
    }
    if (body.subject_email) {
      const enc = await encField(c.env, 'dd_cases', 'subject_email', caseId, String(body.subject_email));
      await sql`UPDATE dd_cases SET subject_email_enc = ${enc} WHERE id = ${caseId}`;
    }
    if (body.subject_legal_name) {
      const enc = await encField(c.env, 'dd_cases', 'subject_legal_name', caseId, String(body.subject_legal_name));
      await sql`UPDATE dd_cases SET subject_legal_name_enc = ${enc} WHERE id = ${caseId}`;
    }

    // D1249: the depth's latest template version, or the built-in catalog
    // (version 0) when HQ has saved none. The case keeps the version.
    const template = await latestTemplate(c.env, templateDepth);
    const seed = template ? seedFromTemplate(subjectType, template.body) : null;
    const sections = seed ? seed.sections : sectionsFor(subjectType).map((s) => ({ ...s, blocking: false }));
    const sectionIdByKey = new Map<string, number>();
    for (const s of sections) {
      const secIns: any[] = await sql`
        INSERT INTO dd_sections (case_id, section_key, title, weight, blocking)
        VALUES (${caseId}, ${s.key}, ${s.title}, ${s.weight}, ${s.blocking ? 1 : 0})
        RETURNING id`;
      sectionIdByKey.set(s.key, Number(secIns[0].id));
    }
    if (template) await sql`UPDATE dd_cases SET template_id = ${template.id} WHERE id = ${caseId}`;
    // Seed the working checklist at the chosen depth. Items land
    // 'pending'; reviewers work them to pass/flag/fail and the
    // flagged/failed severities feed the composite score alongside
    // connector findings (see recomputeAndStoreScore).
    const checklist = seed ? seed.checklist : checklistFor(subjectType, templateDepth);
    let itemsSeeded = 0;
    for (const it of checklist) {
      const sid = sectionIdByKey.get(it.section_key);
      if (!sid) continue;
      await sql`
        INSERT INTO dd_checklist_items (case_id, section_id, item_key, title, depth)
        VALUES (${caseId}, ${sid}, ${it.key}, ${it.title}, ${it.depth})`;
      itemsSeeded++;
    }
    // D1246: the opener leads it, and its blocking sections are stamped.
    await stampNewCase(c.env, caseId, { blocking: !template });
    await audit(c.env, caseId, user, 'case_opened', { type: 'dd_case', id: caseId }, { subject_type: subjectType, subject_id: subjectId, template_depth: templateDepth });
    return c.json({ ...row, template_version: template ? template.version : 0, sections_seeded: sections.length, checklist_seeded: itemsSeeded }, 201);
  } finally { await sql.end(); }
});

dd.get('/cases/:uid', async (c) => {
  const user = await requireDdReader(c);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  const caseId = Number(cs.id);
  // Three response shapes by role:
  //   - admin                 → full case (all sections, all findings, all PII)
  //   - owner (case creator)  → full case
  //   - assigned reviewer     → SCOPED case: only the sections they own,
  //                             only the findings on those sections, only
  //                             the reviewers/attachments for those
  //                             sections, and case PII fields redacted.
  // Anyone else (admin/partner/investor/advisor without an assignment on
  // this case) is rejected with 403.
  let scopedSectionIds: Set<number> | null = null; // null = unrestricted
  if (user.role !== 'admin' && !leadsOrOpened(user, cs)) {
    const sql = getSQL(c.env);
    try {
      const reviewerRows: any[] = await sql`
        SELECT DISTINCT section_id FROM dd_reviewers
         WHERE case_id = ${caseId} AND user_id = ${user.id}`;
      if (reviewerRows.length === 0) return c.json({ error: 'Forbidden' }, 403);
      scopedSectionIds = new Set(reviewerRows.map(r => Number(r.section_id)).filter(Boolean));
    } finally { await sql.end(); }
  }
  const sql = getSQL(c.env);
  try {
    const [sectionsAll, findingsAll, sources, attachmentsAll, reviewersAll, checklistAll, requestsAll]: [any[], any[], any[], any[], any[], any[], any[]] = await Promise.all([
      sql`SELECT * FROM dd_sections WHERE case_id = ${caseId} ORDER BY id`,
      sql`SELECT * FROM dd_findings WHERE case_id = ${caseId} ORDER BY created_at DESC`,
      sql`SELECT id, connector, status, records_count, findings_emitted, error_message, started_at, completed_at FROM dd_external_sources WHERE case_id = ${caseId} ORDER BY id DESC`,
      sql`SELECT id, section_id, filename, mime_type, size_bytes, uploaded_by_user_id, created_at FROM dd_attachments WHERE case_id = ${caseId}`,
      sql`SELECT r.*, u.name AS user_name, u.email AS user_email FROM dd_reviewers r JOIN users u ON u.id = r.user_id WHERE r.case_id = ${caseId}`,
      sql`SELECT * FROM dd_checklist_items WHERE case_id = ${caseId} ORDER BY id`,
      sql`SELECT r.*, u.name AS created_by_name FROM dd_requests r LEFT JOIN users u ON u.id = r.created_by_user_id WHERE r.case_id = ${caseId} ORDER BY r.created_at DESC`,
    ]);
    const allowSection = (sid: number | null | undefined) =>
      scopedSectionIds == null ? true : (sid != null && scopedSectionIds.has(Number(sid)));
    const sections = sectionsAll.filter(s => allowSection(s.id));
    const findings = findingsAll.filter(f => allowSection(f.section_id));
    const attachments = attachmentsAll.filter(a => allowSection(a.section_id));
    const reviewers = await Promise.all(reviewersAll.filter(r => allowSection(r.section_id)).map(async (r) => ({
      ...r,
      // D1249: what a reviewer declared is the deal team's to read, and the reviewer's own.
      conflicts_note: scopedSectionIds == null || Number(r.user_id) === user.id
        ? await decField(c.env, 'dd_reviewers', 'conflicts_note', Number(r.id), r.conflicts_note_enc) : null,
      conflicts_note_enc: undefined,
      expired: r.expires_at ? Date.parse(String(r.expires_at).replace(' ', 'T') + 'Z') < Date.now() : false,
    })));
    // Checklist items follow the same section scoping as findings; the
    // encrypted note is decrypted for anyone allowed to see the item.
    const checklist = await Promise.all(checklistAll.filter(i => allowSection(i.section_id)).map(async i => ({
      ...i,
      note: await decField(c.env, 'dd_checklist_items', 'note', i.id, i.note_enc),
      note_enc: undefined,
    })));

    const decryptedFindings = await Promise.all(findings.map(async f => ({
      id: f.id, section_id: f.section_id, source_id: f.source_id, source_kind: f.source_kind,
      severity: f.severity, title: f.title, evidence_url: f.evidence_url,
      detail: await decField(c.env, 'dd_findings', 'detail', f.id, f.detail_enc),
      subject_name: await decField(c.env, 'dd_findings', 'subject_name', f.id, f.subject_name_enc),
      evidence_excerpt: await decField(c.env, 'dd_findings', 'evidence_excerpt', f.id, f.evidence_excerpt_enc),
      resolved_at: f.resolved_at,
      created_at: f.created_at,
    })));
    // D466 — the signer's name travels with the section: the Sign-off column
    // reads it, and a section completed before the column existed renders
    // unrecorded rather than a guessed signer.
    const signerIds = [...new Set(sections.map((s) => Number(s.signed_off_by)).filter(Number.isFinite))];
    const signerNames = new Map<number, string>();
    for (const sid of signerIds) {
      const u = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(sid).first<{ name: string }>().catch(() => null);
      if (u?.name) signerNames.set(sid, u.name);
    }
    const decryptedSections = await Promise.all(sections.map(async s => ({
      ...s,
      signed_off_by_name: Number.isFinite(Number(s.signed_off_by)) ? (signerNames.get(Number(s.signed_off_by)) ?? null) : null,
      reviewer_notes: await decField(c.env, 'dd_sections', 'reviewer_notes', s.id, s.reviewer_notes_enc),
      reviewer_notes_enc: undefined,
    })));

    // Reviewer-scoped responses redact case-wide PII (subject_email,
    // subject_legal_name, notes) — reviewers should only see what they
    // need to evaluate their assigned section, not the full subject
    // dossier. Owners + admins see everything.
    const isScoped = scopedSectionIds != null;
    const caseOut: Record<string, unknown> = {
      ...cs,
      subject_email: isScoped ? null : await decField(c.env, 'dd_cases', 'subject_email', caseId, cs.subject_email_enc as string | null),
      subject_legal_name: isScoped ? null : await decField(c.env, 'dd_cases', 'subject_legal_name', caseId, cs.subject_legal_name_enc as string | null),
      notes: isScoped ? null : await decField(c.env, 'dd_cases', 'notes', caseId, cs.notes_enc as string | null),
      subject_email_enc: undefined, subject_legal_name_enc: undefined, notes_enc: undefined,
      // D1246: the lead, the decision and the archive. A section reviewer is
      // told the decision, never its reason, the cheque or the linked deal.
      lead_user_id: leadOf(cs),
      decision_reason: isScoped ? null : await decField(c.env, 'dd_cases', 'decision_reason', caseId, cs.decision_reason_enc as string | null),
      archived_reason: isScoped ? null : await decField(c.env, 'dd_cases', 'archived_reason', caseId, cs.archived_reason_enc as string | null),
      decision_reason_enc: undefined, archived_reason_enc: undefined,
      cheque_cents: isScoped ? null : (cs.cheque_cents ?? null),
      cheque_currency: isScoped ? null : (cs.cheque_currency ?? null),
      deal_id: isScoped ? null : (cs.deal_id ?? null),
      ic_record: isScoped ? null : await icRecordFor(c.env, user, caseId),
      platform_checks: isScoped ? null : await platformChecks(c.env, user, cs),
      scoped: isScoped,
    };
    return c.json({
      case: caseOut,
      sections: decryptedSections,
      findings: decryptedFindings,
      sources: isScoped ? [] : sources, // scan results are case-wide; hide from scoped reviewers
      attachments,
      reviewers,
      checklist,
      // Requests are case-wide correspondence with the subject's founder
      // — owner/admin material, hidden from scoped reviewers like sources.
      requests: isScoped ? [] : requestsAll,
    });
  } finally { await sql.end(); }
});

// ---------- external scan ----------

// Async scan: enqueue rows immediately as 'queued', return 202, then run
// each connector in the background via waitUntil so the request returns
// fast and the frontend can poll case GET to see status transitions
// (queued → running → ok/error). This is the queue-backed ingestion
// pattern without requiring a Cloudflare Queue binding.
async function processConnector(env: Env, sourceId: number, caseId: number, meta: typeof CONNECTORS[number], subjectLabel: string, ownerUserId: number, caseUid: string, progress: { findingsEmitted: number }): Promise<void> {
  const sql = getSQL(env);
  try {
    await sql`UPDATE dd_external_sources SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ${sourceId}`;
    let r;
    try { r = await runConnector(env, meta, subjectLabel); }
    catch (e) { r = { status: 'error' as const, records_count: 0, raw_response: null, findings: [], error_message: (e as Error).message }; }
    let emitted = 0;
    for (const f of r.status === 'ok' ? r.findings : []) {
      const sectionRows: any[] = await sql`SELECT id FROM dd_sections WHERE case_id = ${caseId} AND section_key = ${f.section_key || meta.default_section} LIMIT 1`;
      const sectionId = sectionRows[0]?.id || null;
      const inserted2: any[] = await sql`
        INSERT INTO dd_findings (case_id, section_id, source_id, source_kind, severity, title, evidence_url)
        VALUES (${caseId}, ${sectionId}, ${sourceId}, ${f.source_kind}, ${f.severity}, ${f.title}, ${f.evidence_url || null})
        RETURNING id`;
      const findingId = Number(inserted2[0].id);
      progress.findingsEmitted++;
      const detailEnc = await encField(env, 'dd_findings', 'detail', findingId, f.detail);
      const subjEnc   = await encField(env, 'dd_findings', 'subject_name', findingId, f.subject_name || null);
      const exEnc     = await encField(env, 'dd_findings', 'evidence_excerpt', findingId, f.evidence_excerpt || null);
      await sql`UPDATE dd_findings SET detail_enc = ${detailEnc}, subject_name_enc = ${subjEnc}, evidence_excerpt_enc = ${exEnc} WHERE id = ${findingId}`;
      emitted++;
      if (f.severity === 'high' || f.severity === 'critical') {
        await notify(env, {
          userId: ownerUserId,
          type: 'dd_high_severity_finding',
          title: `[${f.severity.toUpperCase()}] DD finding on ${subjectLabel}`,
          body: f.title,
          link: `/admin/due-diligence/${caseUid}`,
          channels: ['in_app', 'email'],
        }).catch(() => null);
      }
    }
    const rawEnc = await encField(env, 'dd_external_sources', 'raw_response', sourceId, r.raw_response ? JSON.stringify(r.raw_response) : null);
    await sql`
      UPDATE dd_external_sources
         SET status = ${r.status}, records_count = ${r.records_count},
             findings_emitted = ${emitted}, error_message = ${r.error_message || null},
             raw_response_enc = ${rawEnc}, completed_at = CURRENT_TIMESTAMP
       WHERE id = ${sourceId}`;
  } finally { await sql.end(); }
}

dd.post('/cases/:uid/scan', async (c) => {
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  let user: AppUser;
  try { user = await requireCaseWriter(c, cs); }
  catch { return c.json({ error: 'Forbidden: not a case owner or reviewer' }, 403); }
  if (user.role !== 'admin' && user.role !== 'partner') {
    return c.json({ error: 'Only admins or partners may run scans' }, 403);
  }
  const caseId = Number(cs.id);
  const subjectLabel = String(cs.subject_label || '');
  const ownerUserId = Number(cs.owner_user_id);
  const caseUid = String(cs.uid);

  const body = await c.req.json().catch(() => ({}));
  const requested: string[] = Array.isArray(body.connectors) && body.connectors.length
    ? body.connectors : CONNECTORS.map(x => x.key);

  const sql = getSQL(c.env);
  const queued: Array<{ id: number; connector: string }> = [];
  try {
    for (const meta of CONNECTORS) {
      if (!requested.includes(meta.key)) continue;
      const inserted: any[] = await sql`
        INSERT INTO dd_external_sources (case_id, connector, status)
        VALUES (${caseId}, ${meta.key}, 'queued')
        RETURNING id`;
      queued.push({ id: Number(inserted[0].id), connector: meta.key });
    }
    // D1246: a scan moves an open case into review; it never reopens a
    // decided or archived one (that would put it back on the Approvals lane).
    await sql`UPDATE dd_cases SET status = 'in_review', updated_at = CURRENT_TIMESTAMP WHERE id = ${caseId} AND status IN ('open', 'in_review')`;
    await audit(c.env, caseId, user, 'external_scan_started', { type: 'dd_case', id: caseId }, { connectors: queued.map(q => q.connector) });
  } finally { await sql.end(); }

  // Background processing — frontend polls /cases/:uid for status updates.
  c.executionCtx.waitUntil((async () => {
    const progress = { findingsEmitted: 0 };
    for (const q of queued) {
      const meta = CONNECTORS.find(m => m.key === q.connector);
      if (!meta) continue;
      try { await processConnector(c.env, q.id, caseId, meta, subjectLabel, ownerUserId, caseUid, progress); }
      catch (e) { console.warn('[dd] connector failed', q.connector, (e as Error).message); }
    }
    try {
      const sql2 = getSQL(c.env);
      try {
        await sql2`UPDATE dd_cases SET external_scan_completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ${caseId}`;
      } finally { await sql2.end(); }
      // A disabled/error-only scan must not replace the stored score.
      if (progress.findingsEmitted > 0) await recomputeAndStoreScore(c.env, caseId);
      await audit(c.env, caseId, null, 'external_scan_completed', { type: 'dd_case', id: caseId }, { connectors_run: queued.length });
    } catch (e) { console.warn('[dd] scan finalisation failed:', (e as Error).message); }
  })());

  return c.json({ ok: true, queued, message: 'Scan queued; poll /cases/:uid for status.' }, 202);
});

// ---------- reviewers / assignment ----------

dd.post('/cases/:uid/sections/:sectionId/assign', async (c) => {
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  let user: AppUser;
  try { user = await requireCaseWriter(c, cs); }
  catch { return c.json({ error: 'Forbidden: not a case owner or reviewer' }, 403); }
  if (user.role !== 'admin' && user.role !== 'partner') return c.json({ error: 'Forbidden' }, 403);
  const caseId = Number(cs.id);
  const sectionId = parseInt(c.req.param('sectionId'), 10);
  const body = await c.req.json().catch(() => ({}));
  const assigneeId = Number(body.user_id);
  if (!assigneeId) return c.json({ error: 'user_id is required' }, 400);
  // D1249: a reviewer works the section; an observer reads it and never works it.
  const reviewerRole = body.role == null || body.role === '' ? 'reviewer' : String(body.role);
  if (reviewerRole !== 'reviewer' && reviewerRole !== 'observer') return c.json({ error: 'A reviewer or an observer.' }, 400);

  const sql = getSQL(c.env);
  try {
    const sec: any[] = await sql`SELECT * FROM dd_sections WHERE id = ${sectionId} AND case_id = ${caseId}`;
    if (sec.length === 0) return c.json({ error: 'Section not found' }, 404);
    const u: any[] = await sql`SELECT id, name, email, role FROM users WHERE id = ${assigneeId}`;
    if (u.length === 0) return c.json({ error: 'Assignee user not found' }, 404);
    // Only roles permitted to read DD data may be assigned a section.
    // Anything outside admin/partner/investor/advisor (notably founder)
    // would be unable to open the case anyway and would just create a
    // dangling reviewer row.
    const allowed = new Set(['admin', 'partner', 'investor', 'advisor']);
    if (!allowed.has(String(u[0].role))) {
      return c.json({ error: 'Assignee role cannot review DD sections (must be admin/partner/investor/advisor)' }, 403);
    }

    // An observer is not the section's assignee: the section waits for a reviewer.
    if (reviewerRole === 'reviewer') {
      await sql`UPDATE dd_sections SET assignee_user_id = ${assigneeId}, status = CASE WHEN status = 'completed' THEN status ELSE 'assigned' END, updated_at = CURRENT_TIMESTAMP WHERE id = ${sectionId}`;
    }
    const jti = genUid();
    // D1249: the link expires 14 days after it is sent; a resend starts the 14 days again.
    await sql`
      INSERT INTO dd_reviewers (case_id, section_id, user_id, role, magic_link_jti, expires_at)
      VALUES (${caseId}, ${sectionId}, ${assigneeId}, ${reviewerRole}, ${jti}, datetime('now', '+14 days'))
      ON CONFLICT(section_id, user_id) DO UPDATE SET invited_at = CURRENT_TIMESTAMP, magic_link_jti = excluded.magic_link_jti,
        role = excluded.role, expires_at = excluded.expires_at`;

    const baseUrl = c.env.APP_URL || 'https://axal.vc';
    const link = `${baseUrl.replace(/\/+$/, '')}/admin/due-diligence/${cs.uid}?section=${sectionId}&inv=${jti}`;
    await notify(c.env, {
      userId: assigneeId,
      type: 'dd_section_assigned',
      title: `DD review requested: ${sec[0].title}`,
      body: `You've been assigned the "${sec[0].title}" section on case ${cs.uid} (${cs.subject_label}).`,
      link,
      channels: ['in_app', 'email'],
    }).catch(() => null);
    await audit(c.env, caseId, user, 'section_assigned', { type: 'dd_section', id: sectionId }, { assignee_id: assigneeId, role: reviewerRole });
    return c.json({ ok: true, magic_link: link, role: reviewerRole, expires_in_days: 14 });
  } finally { await sql.end(); }
});

dd.post('/cases/:uid/sections/:sectionId/verdict', async (c) => {
  const user = await requireDdReader(c);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  const caseId = Number(cs.id);
  const sectionId = parseInt(c.req.param('sectionId'), 10);
  const body = await c.req.json().catch(() => ({}));
  const verdict = String(body.verdict || '');
  if (!['pass','warn','fail','n_a'].includes(verdict)) return c.json({ error: 'Invalid verdict' }, 400);

  const sql = getSQL(c.env);
  try {
    // Integrity: the URL section MUST belong to the URL case before we
    // emit any side effects (audit row, owner notification, score
    // recompute). Without this, a mismatched (uid, sectionId) pair
    // would silently no-op the UPDATE while still polluting the audit
    // log of `:uid` with a verdict on a section from a different case.
    const secOwn: any[] = await sql`SELECT 1 FROM dd_sections WHERE id = ${sectionId} AND case_id = ${caseId} LIMIT 1`;
    if (secOwn.length === 0) return c.json({ error: 'Section does not belong to this case' }, 404);
    // D1246 (#2385 item 19): the case lead records a verdict on any section,
    // as an Admin does; they run the case and already read all of it.
    const lead = isLead(user, cs);
    if (user.role !== 'admin' && !lead) {
      const r: any[] = await sql`SELECT role FROM dd_reviewers WHERE section_id = ${sectionId} AND user_id = ${user.id}`;
      if (r.length === 0) return c.json({ error: 'You are not assigned to this section' }, 403);
      if (r[0].role === 'observer') return c.json({ error: 'An observer reads this section and does not record its verdict.' }, 403);
    }
    // Server-side NDA enforcement: any verdict other than 'n_a' requires
    // a real signed-NDA artifact on file. The client-side gate in
    // VerdictModal is just UX — a malicious client could call the API
    // directly. The legacy `body.nda_signed` boolean is intentionally
    // ignored: only an actual `dd_attachments` row (uploaded via /nda)
    // OR an admin override counts as evidence.
    if (verdict !== 'n_a' && user.role !== 'admin' && !lead) {
      const ndaRows: any[] = await sql`
        SELECT 1 FROM dd_attachments
         WHERE section_id = ${sectionId} AND uploaded_by_user_id = ${user.id}
         LIMIT 1`;
      if (ndaRows.length === 0) {
        return c.json({ error: 'Signed NDA must be uploaded before submitting a verdict' }, 412);
      }
    }
    const notesEnc = body.reviewer_notes
      ? await encField(c.env, 'dd_sections', 'reviewer_notes', sectionId, String(body.reviewer_notes))
      : null;
    await sql`
      UPDATE dd_sections
         SET verdict = ${verdict}, reviewer_notes_enc = ${notesEnc},
             status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
             signed_off_by = ${user.id}
       WHERE id = ${sectionId} AND case_id = ${caseId}`;
    // D466 — the signer is who returned the verdict, recorded at write. The
    // reviewer path also stamps `responded_at`; an admin override has no
    // reviewer row, and before the column it recorded no signer at all.
    await sql`UPDATE dd_reviewers SET responded_at = CURRENT_TIMESTAMP WHERE section_id = ${sectionId} AND user_id = ${user.id}`;
    await audit(c.env, caseId, user, 'section_completed', { type: 'dd_section', id: sectionId }, { verdict });
    await notify(c.env, {
      userId: Number(cs.owner_user_id),
      type: 'dd_section_completed',
      title: `Section completed on ${cs.subject_label}`,
      body: `${user.email} returned verdict "${verdict}".`,
      link: `/admin/due-diligence/${cs.uid}`,
      channels: ['in_app','email'],
    }).catch(() => null);
    const score = await recomputeAndStoreScore(c.env, caseId);
    return c.json({ ok: true, ...score });
  } finally { await sql.end(); }
});

// ---------- score recompute ----------

async function recomputeAndStoreScore(env: Env, caseId: number): Promise<{ score: number | null; band: string | null; reason: string | null }> {
  const sql = getSQL(env);
  try {
    const sections: any[] = await sql`SELECT * FROM dd_sections WHERE case_id = ${caseId}`;
    const findings: any[] = await sql`SELECT section_id, severity, resolved_at FROM dd_findings WHERE case_id = ${caseId}`;
    const items: any[] = await sql`SELECT section_id, status, severity FROM dd_checklist_items WHERE case_id = ${caseId}`;
    const bySection = new Map<number, string[]>();
    for (const f of findings) {
      if (f.resolved_at) continue;
      const arr = bySection.get(f.section_id) || [];
      arr.push(f.severity);
      bySection.set(f.section_id, arr);
    }
    // Build queue #128 — flagged/failed checklist items join connector
    // findings in the per-section severity floor. An explicit severity
    // wins; without one a plain 'fail' counts as medium and a 'flag' as
    // low, so working the checklist always moves the score.
    for (const it of items) {
      if (it.status !== 'flag' && it.status !== 'fail') continue;
      const sev = it.severity || (it.status === 'fail' ? 'medium' : 'low');
      const arr = bySection.get(it.section_id) || [];
      arr.push(sev);
      bySection.set(it.section_id, arr);
    }
    const inputs = sections.map(s => ({
      weight: Number(s.weight) || 1,
      verdict: s.verdict || null,
      worst_severity: worstSeverity(bySection.get(s.id) || []),
    }));
    const { score, band, reason } = computeScore(inputs);
    await sql`UPDATE dd_cases SET risk_score = ${score}, risk_band = ${band}, updated_at = CURRENT_TIMESTAMP WHERE id = ${caseId}`;
    return { score, band, reason };
  } finally { await sql.end(); }
}

dd.post('/cases/:uid/recompute', async (c) => {
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  try { await requireCaseWriter(c, cs); }
  catch { return c.json({ error: 'Forbidden: not a case owner or reviewer' }, 403); }
  const r = await recomputeAndStoreScore(c.env, Number(cs.id));
  return c.json(r);
});

// ---------- checklist items (build queue #128) ----------

const CHECKLIST_STATUSES = new Set(['pending', 'pass', 'flag', 'fail', 'n_a']);
const CHECKLIST_SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'critical']);

dd.patch('/cases/:uid/items/:itemId', async (c) => {
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  let user: AppUser;
  try { user = await requireCaseWriter(c, cs); }
  catch { return c.json({ error: 'Forbidden: not a case owner or reviewer' }, 403); }
  const caseId = Number(cs.id);
  const itemId = parseInt(c.req.param('itemId'), 10);
  const body = await c.req.json().catch(() => ({}));

  const sql = getSQL(c.env);
  try {
    // Integrity: the item must belong to the URL case (same rule as
    // verdicts/NDAs — no cross-case writes by URL tampering).
    const rows: any[] = await sql`SELECT * FROM dd_checklist_items WHERE id = ${itemId} AND case_id = ${caseId} LIMIT 1`;
    if (rows.length === 0) return c.json({ error: 'Checklist item not found on this case' }, 404);
    const it = rows[0];
    // Assigned reviewers (writers who are neither admin nor the owner)
    // may only work items on sections they are assigned to — mirrors
    // the verdict scoping rule.
    if (user.role !== 'admin' && !leadsOrOpened(user, cs)) {
      const r: any[] = await sql`SELECT role FROM dd_reviewers WHERE section_id = ${it.section_id} AND user_id = ${user.id} LIMIT 1`;
      if (r.length === 0) return c.json({ error: 'You are not assigned to this section' }, 403);
      if (r[0].role === 'observer') return c.json({ error: 'An observer reads this section and does not work its checklist.' }, 403);
    }

    const nextStatus = body.status !== undefined ? String(body.status) : String(it.status);
    if (!CHECKLIST_STATUSES.has(nextStatus)) return c.json({ error: 'Invalid status' }, 400);
    let nextSeverity: string | null = body.severity !== undefined
      ? (body.severity == null ? null : String(body.severity))
      : (it.severity ?? null);
    if (nextSeverity != null && !CHECKLIST_SEVERITIES.has(nextSeverity)) return c.json({ error: 'Invalid severity' }, 400);
    // Severity only means something on a flagged/failed item.
    if (nextStatus !== 'flag' && nextStatus !== 'fail') nextSeverity = null;
    const nextOwner: number | null = body.owner_user_id !== undefined
      ? (body.owner_user_id == null ? null : Number(body.owner_user_id))
      : (it.owner_user_id ?? null);
    if (nextOwner != null) {
      if (!Number.isFinite(nextOwner)) return c.json({ error: 'Invalid owner_user_id' }, 400);
      const u: any[] = await sql`SELECT 1 FROM users WHERE id = ${nextOwner} LIMIT 1`;
      if (u.length === 0) return c.json({ error: 'Owner user not found' }, 404);
    }
    const nextDue: string | null = body.due_date !== undefined
      ? (body.due_date == null || body.due_date === '' ? null : String(body.due_date))
      : (it.due_date ?? null);
    if (nextDue != null && !/^\d{4}-\d{2}-\d{2}$/.test(nextDue)) return c.json({ error: 'due_date must be YYYY-MM-DD' }, 400);
    let noteEnc: string | null = it.note_enc ?? null;
    if (body.note !== undefined) {
      noteEnc = body.note == null || body.note === ''
        ? null
        : await encField(c.env, 'dd_checklist_items', 'note', itemId, String(body.note).slice(0, 4000));
    }

    await sql`
      UPDATE dd_checklist_items
         SET status = ${nextStatus}, severity = ${nextSeverity}, owner_user_id = ${nextOwner},
             due_date = ${nextDue}, note_enc = ${noteEnc}, updated_by_user_id = ${user.id},
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ${itemId} AND case_id = ${caseId}`;
    await audit(c.env, caseId, user, 'checklist_item_updated', { type: 'dd_checklist_item', id: itemId },
      { item_key: it.item_key, status: nextStatus, severity: nextSeverity });
    const score = await recomputeAndStoreScore(c.env, caseId);
    return c.json({
      ok: true,
      item: { id: itemId, item_key: it.item_key, status: nextStatus, severity: nextSeverity, owner_user_id: nextOwner, due_date: nextDue },
      ...score,
    });
  } finally { await sql.end(); }
});

// ---------- information requests (build queue #128) ----------
//
// INVARIANT: dd_requests rows are founder-visible by design and carry
// NO diligence content — no verdicts, findings, severities, or case
// notes ever land in this table. Conclusions live in dd_findings /
// dd_sections; a request only says "please provide X". This is what
// keeps the "founders NEVER read DD" rule (file header) intact while
// still letting the diligence team collect documents from the subject.

/** The user the case is ABOUT: project → owning founder user; every
 *  other subject_type stores a users.id directly in subject_id (see
 *  partnerDeals.activatePartnerDealOnSignature + /report/share). */
async function resolveSubjectUserId(env: Env, cs: Record<string, unknown>): Promise<number | null> {
  if (cs.subject_type === 'project') {
    const sql = getSQL(env);
    try {
      const rows: any[] = await sql`
        SELECT u.id FROM projects p
        LEFT JOIN founders f ON f.id = p.founder_id
        LEFT JOIN users u ON LOWER(u.email) = LOWER(f.email)
        WHERE p.id = ${cs.subject_id} LIMIT 1`;
      return rows[0]?.id ? Number(rows[0].id) : null;
    } finally { await sql.end(); }
  }
  const id = Number(cs.subject_id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

dd.post('/cases/:uid/requests', async (c) => {
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  let user: AppUser;
  try { user = await requireCaseWriter(c, cs); }
  catch { return c.json({ error: 'Forbidden: not a case owner or reviewer' }, 403); }
  // Requests go OUT to the subject — only the case owner or an admin may
  // originate them; section reviewers cannot message the subject.
  if (user.role !== 'admin' && !leadsOrOpened(user, cs)) {
    return c.json({ error: 'Only the case owner or an admin may send requests' }, 403);
  }
  const caseId = Number(cs.id);
  const body = await c.req.json().catch(() => ({}));
  const title = String(body.title || '').trim().slice(0, 200);
  if (!title) return c.json({ error: 'title is required' }, 400);
  const details = body.details ? String(body.details).trim().slice(0, 4000) : null;
  const sectionId = body.section_id == null ? null : parseInt(String(body.section_id), 10);

  const sql = getSQL(c.env);
  try {
    if (sectionId != null) {
      const secOwn: any[] = await sql`SELECT 1 FROM dd_sections WHERE id = ${sectionId} AND case_id = ${caseId} LIMIT 1`;
      if (secOwn.length === 0) return c.json({ error: 'Section does not belong to this case' }, 404);
    }
    const inserted: any[] = await sql`
      INSERT INTO dd_requests (case_id, section_id, title, details, created_by_user_id)
      VALUES (${caseId}, ${sectionId}, ${title}, ${details}, ${user.id})
      RETURNING id, case_id, section_id, title, details, state, created_at`;
    const row = inserted[0];
    await audit(c.env, caseId, user, 'request_created', { type: 'dd_request', id: Number(row.id) }, { title });

    const subjectUserId = await resolveSubjectUserId(c.env, cs);
    if (subjectUserId) {
      await notify(c.env, {
        userId: subjectUserId,
        type: 'dd_request_created',
        title: `Information requested: ${title}`,
        body: details || 'A reviewer has requested information from you. Open your requests to respond.',
        link: `/due-diligence/requests`,
        channels: ['in_app', 'email'],
      }).catch(() => null);
    }
    return c.json({ ok: true, request: row }, 201);
  } finally { await sql.end(); }
});

dd.patch('/cases/:uid/requests/:id', async (c) => {
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  let user: AppUser;
  try { user = await requireCaseWriter(c, cs); }
  catch { return c.json({ error: 'Forbidden: not a case owner or reviewer' }, 403); }
  if (user.role !== 'admin' && !leadsOrOpened(user, cs)) {
    return c.json({ error: 'Only the case owner or an admin may update requests' }, 403);
  }
  const caseId = Number(cs.id);
  const requestId = parseInt(c.req.param('id'), 10);
  const body = await c.req.json().catch(() => ({}));
  if (body.state !== 'reviewed') return c.json({ error: "state must be 'reviewed'" }, 400);

  const sql = getSQL(c.env);
  try {
    const rows: any[] = await sql`SELECT id, state FROM dd_requests WHERE id = ${requestId} AND case_id = ${caseId} LIMIT 1`;
    if (rows.length === 0) return c.json({ error: 'Request not found on this case' }, 404);
    await sql`
      UPDATE dd_requests
         SET state = 'reviewed', reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ${requestId} AND case_id = ${caseId}`;
    await audit(c.env, caseId, user, 'request_reviewed', { type: 'dd_request', id: requestId });
    return c.json({ ok: true, id: requestId, state: 'reviewed' });
  } finally { await sql.end(); }
});

// ---------- subject-facing request surface ----------
//
// The ONLY DD endpoints a founder may touch. They expose a request's
// own fields (title/details/state) plus the case's subject_label — and
// deliberately nothing else: no case uid, no score/band, no sections,
// no findings. Auth is subject-resolution, not role: any authenticated
// user sees exactly the requests addressed to them.

dd.get('/requests/mine', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  try {
    const rows: any[] = await sql`
      SELECT r.id, r.title, r.details, r.state, r.responded_at, r.response_note, r.response_url, r.created_at,
             c.subject_type, c.subject_label
        FROM dd_requests r
        JOIN dd_cases c ON c.id = r.case_id
       WHERE (c.subject_type != 'project' AND c.subject_id = ${user.id})
          OR (c.subject_type = 'project' AND c.subject_id IN (
                SELECT p.id FROM projects p
                JOIN founders f ON f.id = p.founder_id
                JOIN users u ON LOWER(u.email) = LOWER(f.email)
               WHERE u.id = ${user.id}))
       ORDER BY r.created_at DESC LIMIT 100`;
    return c.json({ items: rows });
  } finally { await sql.end(); }
});

dd.patch('/requests/:id/respond', async (c) => {
  const user = await requireAuth(c);
  const requestId = parseInt(c.req.param('id'), 10);
  const body = await c.req.json().catch(() => ({}));
  const responseNote = body.response_note ? String(body.response_note).trim().slice(0, 4000) : null;
  const responseUrl = body.response_url ? String(body.response_url).trim().slice(0, 2048) : null;
  if (!responseNote && !responseUrl) return c.json({ error: 'response_note or response_url is required' }, 400);
  if (responseUrl && !/^https?:\/\//i.test(responseUrl)) return c.json({ error: 'response_url must be an http(s) URL' }, 400);

  const sql = getSQL(c.env);
  try {
    const rows: any[] = await sql`
      SELECT r.id, r.state, r.title, r.case_id, c.uid AS case_uid, c.subject_type, c.subject_id,
             c.subject_label, c.owner_user_id
        FROM dd_requests r JOIN dd_cases c ON c.id = r.case_id
       WHERE r.id = ${requestId} LIMIT 1`;
    if (rows.length === 0) return c.json({ error: 'Request not found' }, 404);
    const req = rows[0];
    // Ownership: the caller must BE the subject this request is
    // addressed to. Same resolution as /requests/mine.
    const subjectUserId = await resolveSubjectUserId(c.env, { subject_type: req.subject_type, subject_id: req.subject_id });
    if (subjectUserId !== user.id) return c.json({ error: 'This request is not addressed to you' }, 403);
    // Founders may amend a response until the team marks it reviewed.
    if (req.state === 'reviewed') return c.json({ error: 'This request has already been reviewed' }, 409);

    await sql`
      UPDATE dd_requests
         SET state = 'received', responded_at = CURRENT_TIMESTAMP,
             response_note = ${responseNote}, response_url = ${responseUrl},
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ${requestId}`;
    await audit(c.env, Number(req.case_id), user as unknown as AppUser, 'request_responded', { type: 'dd_request', id: requestId });
    await notify(c.env, {
      userId: Number(req.owner_user_id),
      type: 'dd_request_responded',
      title: `Response received: ${req.title}`,
      body: `${req.subject_label} responded to your information request.`,
      link: `/admin/due-diligence/${req.case_uid}`,
      channels: ['in_app', 'email'],
    }).catch(() => null);
    return c.json({ ok: true, id: requestId, state: 'received' });
  } finally { await sql.end(); }
});

// ---------- report generation + share ----------

dd.post('/cases/:uid/report', async (c) => {
  // Task #6 — DD reports embed sensitive verdicts and signed download
  // tokens are 5-minute single-use; gate the MINT on TOTP step-up so a
  // SMS-only session can never produce or distribute a report URL. The
  // /reports/download/:token GET stays unauth-by-token; this is the
  // chokepoint that controls who can hand out tokens in the first place.
  await requireFactor(c, 'totp');
  await requireStepUp(c); // BLOCK-AUTH-03 — require a RECENT TOTP, not just a TOTP-minted session
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  let user: AppUser;
  try { user = await requireCaseWriter(c, cs); }
  catch { return c.json({ error: 'Forbidden: not a case owner or reviewer' }, 403); }
  if (user.role !== 'admin' && user.role !== 'partner') return c.json({ error: 'Forbidden' }, 403);
  const caseId = Number(cs.id);

  const sql = getSQL(c.env);
  try {
    const sections: any[] = await sql`SELECT * FROM dd_sections WHERE case_id = ${caseId} ORDER BY id`;
    const findings: any[] = await sql`SELECT * FROM dd_findings WHERE case_id = ${caseId} ORDER BY severity DESC, created_at DESC`;
    // D466 — the sign-off travels into the report: the canvas's own sentence
    // is that every figure traces to a checklist item, a flag, or a sign-off.
    const signerIds = [...new Set(sections.map((s) => Number(s.signed_off_by)).filter(Number.isFinite))];
    const signerNames = new Map<number, string>();
    for (const sid of signerIds) {
      const u = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(sid).first<{ name: string }>().catch(() => null);
      if (u?.name) signerNames.set(sid, u.name);
    }
    const reportSections: ReportSection[] = await Promise.all(sections.map(async s => ({
      section_key: s.section_key, title: s.title, weight: Number(s.weight),
      status: s.status, verdict: s.verdict,
      signed_off_by_name: Number.isFinite(Number(s.signed_off_by)) ? (signerNames.get(Number(s.signed_off_by)) ?? null) : null,
      completed_at: s.completed_at ?? null,
      reviewer_notes: await decField(c.env, 'dd_sections', 'reviewer_notes', s.id, s.reviewer_notes_enc),
      findings: await Promise.all(findings.filter(f => f.section_id === s.id).map(async f => ({
        severity: f.severity, title: f.title,
        detail: await decField(c.env, 'dd_findings', 'detail', f.id, f.detail_enc),
        evidence_url: f.evidence_url,
      }))),
    })));
    const reportCase: ReportCase = {
      uid: String(cs.uid), subject_label: String(cs.subject_label),
      subject_type: String(cs.subject_type),
      risk_score: cs.risk_score == null ? null : Number(cs.risk_score),
      risk_band: cs.risk_band as string | null,
      status: String(cs.status), created_at: String(cs.created_at),
      notes: await decField(c.env, 'dd_cases', 'notes', caseId, cs.notes_enc as string | null),
    };

    const artifact = await renderReportArtifact(c.env, reportCase, reportSections);
    const ts = Date.now();
    const ext = artifact.format === 'pdf' ? 'pdf' : 'html';
    // Encryption-at-rest: DD reports may contain PII (subject email,
    // legal name) and confidential reviewer notes. We encrypt the bytes
    // with cryptoBox AES-GCM before R2 put, store under .enc suffix
    // with `application/octet-stream`, and persist the *real* MIME in
    // `inner_content_type` so the download route can restore it.
    const encryptedBytes = await encryptBytes(c.env, artifact.bytes);
    const key = `dd-reports/${caseId}/${ts}-${genUid().slice(0, 8)}.${ext}.enc`;
    let storedKey: string | null = null;
    if (c.env.FILES) {
      try {
        await c.env.FILES.put(key, encryptedBytes, { httpMetadata: { contentType: 'application/octet-stream' } });
        storedKey = key;
      } catch (e) { console.warn('[dd] R2 put failed:', (e as Error).message); }
    }

    const inserted: any[] = await sql`
      INSERT INTO dd_reports (case_id, storage_key, format, encrypted, inner_content_type,
                              risk_score_at_generation, risk_band_at_generation, generated_by_user_id)
      VALUES (${caseId}, ${storedKey}, ${artifact.format}, 1, ${artifact.contentType},
              ${reportCase.risk_score}, ${reportCase.risk_band}, ${user.id})
      RETURNING id, format, created_at`;
    await sql`UPDATE dd_cases SET report_generated_at = CURRENT_TIMESTAMP WHERE id = ${caseId}`;
    await audit(c.env, caseId, user, 'report_generated', { type: 'dd_report', id: Number(inserted[0].id) }, { format: artifact.format });

    let downloadUrl: string;
    if (storedKey) {
      const tok = await mintDownloadToken(c.env, { key: storedKey, ttlSec: 300, audience: 'dd_report', userId: user.id });
      downloadUrl = `/api/dd/reports/download/${tok.token}`;
    } else {
      // No R2 binding — inline as data URL (not persisted; one-shot).
      const b64 = btoa(String.fromCharCode(...new Uint8Array(artifact.bytes)));
      downloadUrl = `data:${artifact.contentType};base64,${b64}`;
    }
    return c.json({ ok: true, report: inserted[0], format: artifact.format, download_url: downloadUrl });
  } finally { await sql.end(); }
});

dd.get('/reports/download/:token', async (c) => {
  const tok = c.req.param('token');
  const v = await verifyAndConsumeToken(c.env, tok);
  if ('error' in v) return c.json({ error: 'Invalid or expired token' }, 403);
  if (v.audience !== 'dd_report') return c.json({ error: 'Wrong audience' }, 403);
  if (!c.env.FILES) return c.json({ error: 'Storage not configured' }, 503);
  const obj = await c.env.FILES.get(v.key);
  if (!obj) return c.json({ error: 'Report not found' }, 404);
  // Look up the report metadata to know whether the stored bytes are
  // encrypted and what the real content-type/extension should be.
  const meta = await c.env.DB.prepare(
    `SELECT encrypted, inner_content_type, format FROM dd_reports WHERE storage_key = ? LIMIT 1`,
  ).bind(v.key).first<{ encrypted: number; inner_content_type: string | null; format: string }>();
  const isEnc = meta?.encrypted === 1 || v.key.endsWith('.enc');
  const realCT = meta?.inner_content_type
    || (meta?.format === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8');
  const ext = meta?.format === 'pdf' ? 'pdf' : 'html';
  let body: BodyInit;
  if (isEnc) {
    const ciphertext = await obj.arrayBuffer();
    const plaintext = await decryptBytes(c.env, ciphertext);
    body = plaintext;
  } else {
    body = obj.body as ReadableStream;
  }
  const baseName = v.key.split('/').pop()?.replace(/\.enc$/, '') || `dd-report.${ext}`;
  return new Response(body, {
    headers: {
      'content-type': realCT,
      'content-disposition': `attachment; filename="${baseName}"`,
      'cache-control': 'private, no-store',
    },
  });
});

dd.post('/cases/:uid/report/share', async (c) => {
  const user = await requireDdReader(c);
  if (user.role !== 'admin') return c.json({ error: 'Only admins may share the report with the founder' }, 403);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  if (cs.subject_type !== 'project' && cs.subject_type !== 'founder') {
    return c.json({ error: 'Sharing is only supported for project/founder cases' }, 400);
  }
  const sql = getSQL(c.env);
  try {
    let founderUserId: number | null = null;
    if (cs.subject_type === 'project') {
      const rows: any[] = await sql`
        SELECT u.id FROM projects p
        LEFT JOIN founders f ON f.id = p.founder_id
        LEFT JOIN users u ON LOWER(u.email) = LOWER(f.email)
        WHERE p.id = ${cs.subject_id} LIMIT 1`;
      founderUserId = rows[0]?.id || null;
    } else {
      founderUserId = Number(cs.subject_id);
    }
    if (!founderUserId) return c.json({ error: 'Could not resolve founder user' }, 404);
    await notify(c.env, {
      userId: founderUserId,
      type: 'dd_report_ready',
      title: `Your due diligence report is available`,
      body: `Axal has completed a DD review for ${cs.subject_label}. Reach out to your partner to discuss the findings.`,
      channels: ['in_app','email','slack'],
      category: 'dd_report_ready',
    }).catch(() => null);
    await audit(c.env, Number(cs.id), user, 'report_shared_with_founder', { type: 'user', id: founderUserId });
    return c.json({ ok: true });
  } finally { await sql.end(); }
});

// ---------- audit log read ----------

dd.get('/cases/:uid/audit', async (c) => {
  const user = await requireDdReader(c);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  const sql = getSQL(c.env);
  try {
    if (user.role !== 'admin' && !leadsOrOpened(user, cs)) {
      // Assigned reviewers may also view the audit trail for cases they
      // are reviewing — they need to see what's been done before/after
      // their verdict. Anyone else is rejected.
      const r: any[] = await sql`SELECT 1 FROM dd_reviewers WHERE case_id = ${cs.id} AND user_id = ${user.id} LIMIT 1`;
      if (r.length === 0) return c.json({ error: 'Forbidden' }, 403);
    }
    const rows: any[] = await sql`
      SELECT a.*, u.name AS actor_name, u.email AS actor_email
        FROM dd_audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.case_id = ${cs.id} ORDER BY a.created_at DESC LIMIT 200`;
    // Decrypt details_enc back to JSON for the audit drawer. Failures
    // surface as null details (the row is still shown so reviewers see
    // *that* something happened even if the payload is unreadable).
    const items = await Promise.all(rows.map(async r => {
      let details: unknown = null;
      if (r.details_enc) {
        const raw = await decField(c.env, 'dd_audit_log', 'details', r.id, r.details_enc);
        try { details = raw ? JSON.parse(raw) : null; } catch { details = raw; }
      }
      return { ...r, details, details_enc: undefined };
    }));
    return c.json({ items });
  } finally { await sql.end(); }
});

// ---------- expertise-based reviewer suggestions ----------
//
// Routes assign-modal lookups for "who has reviewed this section_key
// before?". Suggested experts = users whose role is admin/partner/
// advisor/investor and who either (a) have completed prior verdicts on
// the same section_key (ranked by count desc, most-recent tiebreaker)
// or (b) match the section's domain via a hand-curated mapping in
// `users.expertise_tags`-style columns. Falls back to all eligible
// users when no prior history exists. Admins-only call.

dd.get('/experts', async (c) => {
  const user = await requireDdReader(c);
  if (user.role !== 'admin' && user.role !== 'partner') {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const sectionKey = c.req.query('section_key') || '';
  const sql = getSQL(c.env);
  try {
    let suggestions: any[] = [];
    if (sectionKey) {
      suggestions = await sql`
        SELECT u.id, u.name, u.email, u.role,
               COUNT(s.id) AS prior_reviews,
               MAX(s.completed_at) AS last_reviewed_at
          FROM dd_sections s
          JOIN users u ON u.id = s.assignee_user_id
         WHERE s.section_key = ${sectionKey}
           AND s.verdict IS NOT NULL
           AND u.role IN ('admin','partner','advisor','investor')
         GROUP BY u.id, u.name, u.email, u.role
         ORDER BY prior_reviews DESC, last_reviewed_at DESC
         LIMIT 10`;
    }
    const eligible: any[] = await sql`
      SELECT id, name, email, role FROM users
       WHERE role IN ('admin','partner','advisor','investor')
       ORDER BY name LIMIT 100`;
    // D1249 (#2385 item 17): an email address is an Admin's to read; the rest
    // pick by name.
    const noEmail = (rows: any[]) => user.role === 'admin' ? rows : rows.map(({ email: _e, ...r }) => r);
    return c.json({ suggestions: noEmail(suggestions), eligible: noEmail(eligible) });
  } finally { await sql.end(); }
});

// ---------- reviewer magic-link acceptance ----------
//
// The /assign endpoint mints a `magic_link_jti` and emails the reviewer
// a link `/admin/due-diligence/<uid>?section=<id>&inv=<jti>`. The
// frontend posts the jti here on first load to (a) validate the
// invitation hasn't been revoked, (b) record acceptance for audit, and
// (c) confirm the reviewer's scoped access. We deliberately do NOT
// auto-create a reviewer row from a stale jti — the row already exists
// from the assign step; we only validate the jti matches.

dd.post('/cases/:uid/reviewer-invite/:jti', async (c) => {
  const user = await requireDdReader(c);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  const jti = c.req.param('jti');
  const sql = getSQL(c.env);
  try {
    const r: any[] = await sql`
      SELECT id, section_id, user_id, expires_at, (expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')) AS expired
        FROM dd_reviewers
       WHERE case_id = ${cs.id} AND magic_link_jti = ${jti} LIMIT 1`;
    if (r.length === 0) return c.json({ error: 'Invitation invalid or expired' }, 403);
    // D1249: an invitation link lasts 14 days. Rows invited before migration
    // 623 carry no expiry and stay as they were sent.
    if (Number(r[0].expired) === 1) return c.json({ error: 'This invitation has expired. Ask the case lead to send it again.', code: 'invite_expired' }, 410);
    if (Number(r[0].user_id) !== user.id) {
      return c.json({ error: 'This invitation belongs to a different user' }, 403);
    }
    await sql`UPDATE dd_reviewers SET responded_at = COALESCE(responded_at, CURRENT_TIMESTAMP) WHERE id = ${r[0].id}`;
    await audit(c.env, Number(cs.id), user, 'reviewer_invite_accepted', { type: 'dd_section', id: Number(r[0].section_id) });
    return c.json({ ok: true, section_id: Number(r[0].section_id) });
  } finally { await sql.end(); }
});

// ---------- reviewer NDA attachment ----------
//
// Reviewers upload a signed NDA (PDF) which is persisted in R2 + a
// `dd_attachments` row + flips `nda_signed_at` on both the section and
// the reviewer row. This replaces the previous "tick a box" NDA flow
// with real evidence on file. Falls back gracefully when R2 isn't bound
// (the attachment row records the missing file_key as `inline:`).

dd.post('/cases/:uid/sections/:sectionId/nda', async (c) => {
  const user = await requireDdReader(c);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  const caseId = Number(cs.id);
  const sectionId = parseInt(c.req.param('sectionId'), 10);
  const sql = getSQL(c.env);
  try {
    // Integrity: the sectionId in the URL MUST belong to the case in
    // the URL. Without this check a reviewer assigned to case A could
    // upload an NDA "for" a section of case B by URL-tampering.
    const secOwn: any[] = await sql`SELECT 1 FROM dd_sections WHERE id = ${sectionId} AND case_id = ${caseId} LIMIT 1`;
    if (secOwn.length === 0) return c.json({ error: 'Section does not belong to this case' }, 404);
    if (user.role !== 'admin') {
      const r: any[] = await sql`SELECT 1 FROM dd_reviewers WHERE section_id = ${sectionId} AND user_id = ${user.id}`;
      if (r.length === 0) return c.json({ error: 'You are not assigned to this section' }, 403);
    }

    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') return c.json({ error: 'NDA file required (multipart field "file")' }, 400);
    const filename = (file as File).name || 'nda.pdf';
    const mime = (file as File).type || 'application/pdf';
    const buf = await (file as File).arrayBuffer();
    const size = buf.byteLength;
    if (size > 10 * 1024 * 1024) return c.json({ error: 'NDA file too large (max 10MB)' }, 413);

    let storageKey = `inline:${genUid()}`;
    if (c.env.FILES) {
      storageKey = `dd-ndas/${caseId}/${sectionId}/${Date.now()}-${genUid().slice(0, 8)}-${filename}`;
      try { await c.env.FILES.put(storageKey, buf, { httpMetadata: { contentType: mime } }); }
      catch (e) {
        console.warn('[dd] NDA R2 put failed:', (e as Error).message);
        storageKey = `inline:failed:${genUid()}`;
      }
    }

    await sql`
      INSERT INTO dd_attachments (case_id, section_id, file_key, filename, mime_type, size_bytes, uploaded_by_user_id)
      VALUES (${caseId}, ${sectionId}, ${storageKey}, ${filename}, ${mime}, ${size}, ${user.id})`;
    await sql`UPDATE dd_sections SET reviewer_signed_nda_at = CURRENT_TIMESTAMP WHERE id = ${sectionId}`;
    await sql`UPDATE dd_reviewers SET nda_signed_at = CURRENT_TIMESTAMP WHERE section_id = ${sectionId} AND user_id = ${user.id}`;
    await audit(c.env, caseId, user, 'nda_uploaded', { type: 'dd_section', id: sectionId }, { filename, size_bytes: size });
    return c.json({ ok: true, filename, size_bytes: size });
  } finally { await sql.end(); }
});

// ---------- D1246 (#3261): lifecycle, decision, archive, memo, reports, IC ----------
//
// Part 2 of #2385. A case can now be led, given its deal context, decided,
// archived and handed to IC; the deal team keeps an encrypted memo; every
// report generated is listed and re-downloads behind a fresh step-up.
//
//   PATCH /cases/:uid             lead, target IC date, round, cheque, deal; archive with a reason
//   POST  /cases/:uid/decision    proceed | proceed_with_conditions | do_not_proceed | withdrawn, reason required
//   GET   /cases/:uid/memo        the deal team's memo
//   PUT   /cases/:uid/memo
//   GET   /cases/:uid/reports     every report generated on the case
//   POST  /cases/:uid/reports/:reportId/download   a fresh five-minute link, behind step-up
//   POST  /cases/:uid/ic          "Send to IC": an IC record with this case attached
//
// THE GATE for every write here is an Admin or the case lead (#2385). A
// section reviewer is never one; the opener who handed the lead on is not.
// An archived case takes no further change. Every write records a
// `dd_audit_log` row; the figures (cheque, dates) never go into its details,
// only which fields changed.

const LEAD_ROLES = new Set(['admin', 'partner', 'investor']);
const MEMO_FIELDS = ['summary', 'verified', 'on_trust', 'conditions'] as const;
const MEMO_MAX = 8000;
const REASON_MAX = 2000;

function isDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** The lead or an Admin, on a case that is not archived; else the refusal to send. */
function deciderRefusal(user: AppUser, cs: Record<string, unknown>): { status: 403 | 409; error: string } | null {
  if (user.role !== 'admin' && !isLead(user, cs)) return { status: 403, error: 'Only the case lead or an Admin can change this case.' };
  if (cs.status === 'archived') return { status: 409, error: 'This case is archived. It takes no further change.' };
  return null;
}

/** The IC record this case was sent to, as the caller may see it (`ic.ts` applies IC's scope). */
async function icRecordFor(env: Env, user: AppUser, caseId: number): Promise<{ uid: string; status: string } | null> {
  try { return await icRecordForCase(env, user as any, caseId); } catch { return null; }
}

dd.patch('/cases/:uid', async (c) => {
  const user = await requireDdReader(c);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  const refusal = deciderRefusal(user, cs);
  if (refusal) return c.json({ error: refusal.error }, refusal.status);
  const caseId = Number(cs.id);
  const body = await c.req.json().catch(() => ({} as any));
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  if (body.archive === true) {
    const reason = String(body.archived_reason ?? '').trim();
    if (!reason) return c.json({ error: 'Say why the case is archived.' }, 400);
    if (reason.length > REASON_MAX) return c.json({ error: `The reason is at most ${REASON_MAX} characters.` }, 400);
    const enc = await encField(c.env, 'dd_cases', 'archived_reason', caseId, reason);
    await c.env.DB.prepare(
      `UPDATE dd_cases SET status = 'archived', archived_reason_enc = ?, archived_by = ?, archived_at = datetime('now'), updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status != 'archived'`,
    ).bind(enc, user.id, caseId).run();
    await audit(c.env, caseId, user, 'case_archived', { type: 'dd_case', id: caseId }, { previous_status: cs.status });
    return c.json({ ok: true, status: 'archived' });
  }

  // The context: each field the body names is checked; the rest keep their value.
  const next = {
    lead_user_id: leadOf(cs),
    target_ic_date: (cs.target_ic_date ?? null) as string | null,
    round_label: (cs.round_label ?? null) as string | null,
    cheque_cents: cs.cheque_cents == null ? null : Number(cs.cheque_cents),
    cheque_currency: (cs.cheque_currency ?? null) as string | null,
    deal_id: cs.deal_id == null ? null : Number(cs.deal_id),
  };
  const changed: string[] = [];
  if (has('lead_user_id')) {
    const id = Number(body.lead_user_id);
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Choose who leads the case.' }, 400);
    const u = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ? AND COALESCE(is_active, 1) = 1').bind(id).first<{ id: number; role: string }>();
    if (!u) return c.json({ error: 'That person could not be found.' }, 404);
    if (!LEAD_ROLES.has(String(u.role))) return c.json({ error: 'A case is led by an Admin, a partner or an investor.' }, 400);
    next.lead_user_id = id; changed.push('lead');
  }
  if (has('target_ic_date')) {
    const v = body.target_ic_date == null || body.target_ic_date === '' ? null : String(body.target_ic_date);
    if (v != null && !isDay(v)) return c.json({ error: 'The target IC date is a day, YYYY-MM-DD.' }, 400);
    next.target_ic_date = v; changed.push('target_ic_date');
  }
  if (has('round_label')) {
    const v = body.round_label == null ? '' : String(body.round_label).trim();
    if (v.length > 80) return c.json({ error: 'The round is at most 80 characters.' }, 400);
    next.round_label = v || null; changed.push('round');
  }
  if (has('cheque_cents') || has('cheque_currency')) {
    const cents = has('cheque_cents') ? body.cheque_cents : next.cheque_cents;
    const cur = has('cheque_currency') ? body.cheque_currency : next.cheque_currency;
    if (cents == null || cents === '') {
      next.cheque_cents = null; next.cheque_currency = null;
    } else {
      const n = Number(cents);
      if (!Number.isSafeInteger(n) || n < 0) return c.json({ error: 'The cheque is a whole number of cents, zero or more.' }, 400);
      const code = String(cur ?? '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) return c.json({ error: 'Give the cheque its currency, a three-letter code such as EUR.' }, 400);
      next.cheque_cents = n; next.cheque_currency = code;
    }
    changed.push('cheque');
  }
  if (has('deal_id')) {
    if (body.deal_id == null || body.deal_id === '') next.deal_id = null;
    else {
      const id = Number(body.deal_id);
      const deal = Number.isInteger(id) ? await c.env.DB.prepare('SELECT id FROM deals WHERE id = ?').bind(id).first() : null;
      if (!deal) return c.json({ error: 'That deal could not be found.' }, 404);
      next.deal_id = id;
    }
    changed.push('deal');
  }
  if (!changed.length) return c.json({ error: 'Nothing to change.' }, 400);
  await c.env.DB.prepare(
    `UPDATE dd_cases SET lead_user_id = ?, target_ic_date = ?, round_label = ?, cheque_cents = ?, cheque_currency = ?, deal_id = ?,
            updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).bind(next.lead_user_id, next.target_ic_date, next.round_label, next.cheque_cents, next.cheque_currency, next.deal_id, caseId).run();
  await audit(c.env, caseId, user, 'case_updated', { type: 'dd_case', id: caseId }, { fields: changed });
  if (changed.includes('lead') && next.lead_user_id !== leadOf(cs) && next.lead_user_id !== user.id) {
    await notify(c.env, {
      userId: next.lead_user_id,
      type: 'dd_case_lead',
      title: `You lead the due diligence on ${cs.subject_label}`,
      body: 'You can now record the decision and send the case to IC.',
      link: `/due-diligence/${cs.uid}`,
      channels: ['in_app'],
    }).catch(() => null);
  }
  return c.json({ ok: true, case: { uid: cs.uid, ...next } });
});

dd.post('/cases/:uid/decision', async (c) => {
  const user = await requireDdReader(c);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  const refusal = deciderRefusal(user, cs);
  if (refusal) return c.json({ error: refusal.error }, refusal.status);
  const caseId = Number(cs.id);
  const body = await c.req.json().catch(() => ({} as any));
  const decision = String(body.decision || '');
  if (!(DD_DECISIONS as readonly string[]).includes(decision)) return c.json({ error: 'Choose Proceed, Proceed with conditions, Do not proceed or Withdrawn.' }, 400);
  const reason = String(body.reason ?? '').trim();
  if (!reason) return c.json({ error: 'Say why. The reason is recorded with the decision.' }, 400);
  if (reason.length > REASON_MAX) return c.json({ error: `The reason is at most ${REASON_MAX} characters.` }, 400);

  // #2385 owner question 4: "Proceed" never carries an open High or Critical
  // flag in a blocking section. "Proceed with conditions" is the way through.
  if (decision === 'proceed') {
    const [sections, findings, items] = await Promise.all([
      c.env.DB.prepare('SELECT id, blocking FROM dd_sections WHERE case_id = ?').bind(caseId).all<any>(),
      c.env.DB.prepare('SELECT section_id, severity, resolved_at FROM dd_findings WHERE case_id = ?').bind(caseId).all<any>(),
      c.env.DB.prepare('SELECT section_id, status, severity FROM dd_checklist_items WHERE case_id = ?').bind(caseId).all<any>(),
    ]);
    const blocked = blockingSectionsWithOpenSevereFlags(sections.results || [], findings.results || [], items.results || []);
    if (blocked.length) return c.json({ error: BLOCKING_FLAG_REFUSAL, code: 'blocking_flag_open', section_ids: blocked }, 409);
  }

  const enc = await encField(c.env, 'dd_cases', 'decision_reason', caseId, reason);
  await c.env.DB.prepare(
    `UPDATE dd_cases SET decision = ?, decision_reason_enc = ?, decided_by = ?, decided_at = datetime('now'),
            status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'archived'`,
  ).bind(decision, enc, user.id, caseId).run();
  await audit(c.env, caseId, user, 'case_decided', { type: 'dd_case', id: caseId }, { decision, previous_decision: cs.decision ?? null });

  // "The case moves to Decided. Reviewers are told." (DDL14 D) — in the bell,
  // the decision only; its reason stays with the deal team.
  const reviewers = await c.env.DB.prepare('SELECT DISTINCT user_id FROM dd_reviewers WHERE case_id = ?').bind(caseId).all<{ user_id: number }>();
  const words: Record<string, string> = { proceed: 'Proceed', proceed_with_conditions: 'Proceed with conditions', do_not_proceed: 'Do not proceed', withdrawn: 'Withdrawn' };
  let told = 0;
  for (const r of reviewers.results || []) {
    if (Number(r.user_id) === user.id) continue;
    await notify(c.env, {
      userId: Number(r.user_id),
      type: 'dd_case_decided',
      title: `Decision recorded on ${cs.subject_label}: ${words[decision]}`,
      body: 'The case is decided. Thank you for your review.',
      link: `/due-diligence/${cs.uid}`,
      channels: ['in_app'],
    }).then(() => { told += 1; }).catch(() => null);
  }
  return c.json({ ok: true, decision, status: 'completed', reviewers_told: told });
});

dd.get('/cases/:uid/memo', async (c) => {
  const user = await requireDdReader(c);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  // The memo is the deal team's: the readers of the whole case, never a
  // section reviewer.
  if (user.role !== 'admin' && !leadsOrOpened(user, cs)) return c.json({ error: 'Forbidden' }, 403);
  const row = await c.env.DB.prepare(
    `SELECT m.*, u.name AS updated_by_name FROM dd_case_memos m LEFT JOIN users u ON u.id = m.updated_by WHERE m.case_id = ? LIMIT 1`,
  ).bind(Number(cs.id)).first<any>();
  if (!row) return c.json({ memo: null });
  const memo: Record<string, unknown> = { updated_at: row.updated_at, updated_by_name: row.updated_by_name ?? null };
  for (const f of MEMO_FIELDS) memo[f] = await decField(c.env, 'dd_case_memos', f, Number(row.id), row[`${f}_enc`]);
  return c.json({ memo });
});

dd.put('/cases/:uid/memo', async (c) => {
  const user = await requireDdReader(c);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  const refusal = deciderRefusal(user, cs);
  if (refusal) return c.json({ error: refusal.error }, refusal.status);
  const caseId = Number(cs.id);
  const body = await c.req.json().catch(() => ({} as any));
  const values: Record<string, string | null> = {};
  for (const f of MEMO_FIELDS) {
    const v = body[f] == null ? '' : String(body[f]).trim();
    if (v.length > MEMO_MAX) return c.json({ error: `Each part of the memo is at most ${MEMO_MAX} characters.` }, 400);
    values[f] = v || null;
  }
  await c.env.DB.prepare(`INSERT OR IGNORE INTO dd_case_memos (uid, case_id) VALUES (?, ?)`).bind(genUid(), caseId).run();
  const row = await c.env.DB.prepare('SELECT id FROM dd_case_memos WHERE case_id = ?').bind(caseId).first<{ id: number }>();
  if (!row) return c.json({ error: 'The memo could not be saved. Try again.' }, 503);
  const memoId = Number(row.id);
  const enc = {
    summary: await encField(c.env, 'dd_case_memos', 'summary', memoId, values.summary),
    verified: await encField(c.env, 'dd_case_memos', 'verified', memoId, values.verified),
    on_trust: await encField(c.env, 'dd_case_memos', 'on_trust', memoId, values.on_trust),
    conditions: await encField(c.env, 'dd_case_memos', 'conditions', memoId, values.conditions),
  };
  await c.env.DB.prepare(
    `UPDATE dd_case_memos SET summary_enc = ?, verified_enc = ?, on_trust_enc = ?, conditions_enc = ?, updated_by = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(enc.summary, enc.verified, enc.on_trust, enc.conditions, user.id, memoId).run();
  await audit(c.env, caseId, user, 'memo_saved', { type: 'dd_case_memo', id: memoId }, { parts: MEMO_FIELDS.filter((f) => values[f] != null) });
  return c.json({ ok: true, memo: { ...values, updated_by_name: null } });
});

/** Who may list and re-download reports: who may generate one (`POST /cases/:uid/report`). */
async function reportReaderRefusal(c: AppContext, cs: Record<string, unknown>): Promise<{ status: 403; error: string } | AppUser> {
  let user: AppUser;
  try { user = await requireCaseWriter(c, cs); }
  catch { return { status: 403, error: 'Forbidden: not a case owner or reviewer' }; }
  if (user.role !== 'admin' && user.role !== 'partner') return { status: 403, error: 'Forbidden' };
  return user;
}

dd.get('/cases/:uid/reports', async (c) => {
  await requireDdReader(c);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  const who = await reportReaderRefusal(c, cs);
  if ('error' in who) return c.json({ error: who.error }, who.status);
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.format, r.created_at, r.risk_score_at_generation, r.risk_band_at_generation,
            r.generated_by_user_id, u.name AS generated_by_name,
            CASE WHEN r.storage_key IS NULL THEN 0 ELSE 1 END AS stored
       FROM dd_reports r LEFT JOIN users u ON u.id = r.generated_by_user_id
      WHERE r.case_id = ? ORDER BY r.created_at DESC, r.id DESC`,
  ).bind(Number(cs.id)).all<any>();
  return c.json({ items: (rows.results || []).map((r: any) => ({ ...r, stored: Number(r.stored) === 1 })) });
});

dd.post('/cases/:uid/reports/:reportId/download', async (c) => {
  // The same bar as generating one: a TOTP session and a recent step-up.
  await requireFactor(c, 'totp');
  await requireStepUp(c);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  const who = await reportReaderRefusal(c, cs);
  if ('error' in who) return c.json({ error: who.error }, who.status);
  const reportId = parseInt(c.req.param('reportId'), 10);
  const r = await c.env.DB.prepare('SELECT id, storage_key, format FROM dd_reports WHERE id = ? AND case_id = ?')
    .bind(reportId, Number(cs.id)).first<{ id: number; storage_key: string | null; format: string }>();
  if (!r) return c.json({ error: 'Report not found on this case' }, 404);
  if (!r.storage_key || !c.env.FILES) return c.json({ error: 'This report was not stored, so it cannot be downloaded again. Generate a new one.' }, 410);
  const tok = await mintDownloadToken(c.env, { key: r.storage_key, ttlSec: 300, audience: 'dd_report', userId: who.id });
  await audit(c.env, Number(cs.id), who, 'report_downloaded', { type: 'dd_report', id: Number(r.id) }, { format: r.format });
  return c.json({ ok: true, download_url: `/api/dd/reports/download/${tok.token}`, expires_in: 300 });
});

dd.post('/cases/:uid/ic', async (c) => {
  const user = await requireDdReader(c);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  const refusal = deciderRefusal(user, cs);
  if (refusal) return c.json({ error: refusal.error }, refusal.status);
  // #2385 owner question 5: the hand-off follows a decision to go ahead.
  if (cs.decision !== 'proceed' && cs.decision !== 'proceed_with_conditions') {
    return c.json({ error: 'Record Proceed or Proceed with conditions before sending the case to IC.' }, 409);
  }
  const caseId = Number(cs.id);
  if (await caseSentToIc(c.env, caseId)) return c.json({ error: 'This case is already with IC.', code: 'already_sent' }, 409);
  const out = await createIcRecordForCase(c, user as any, {
    title: `Investment decision: ${String(cs.subject_label)}`,
    projectId: cs.subject_type === 'project' ? Number(cs.subject_id) : null,
    dealId: cs.deal_id == null ? null : Number(cs.deal_id),
    ddCaseId: caseId,
  });
  if (!out.ok) return c.json({ error: out.error }, out.status);
  await audit(c.env, caseId, user, 'sent_to_ic', { type: 'dd_case', id: caseId });
  return c.json({ ok: true, ic_record: { uid: out.uid, status: out.status } }, 201);
});

// ---------- D1249 (#3264): the overview, My reviews, search, the team, templates ----------
//
// Part 5 of #2385.
//
//   GET    /overview                           DDL1's figures, each block { available, … } or { available: false, reason }
//   GET    /my-reviews                         DDL12: the sections the caller was invited to
//   GET    /subjects?type=&q=                  DDL2's picker by name; an investor sees only startups they share a deal with
//   GET    /people?q=&page=                    DDL9's reviewer search by name; an email for an Admin only
//   POST   /cases/:uid/sections/:sectionId/conflicts   the reviewer's own declaration
//   DELETE /cases/:uid/sections/:sectionId/reviewers/:userId   remove someone from a section
//   POST   /cases/:uid/widen                   Lite → Standard → Deep, never narrower
//   GET    /templates                          DDL13: each depth's current version and its history
//   POST   /templates                          a new version; Super Admin only (owner question 3)
//
// The overview and My reviews read only what the caller may list (the same
// fixed predicate as `GET /cases`, CASE_FILTER_SQL). Every case write records a `dd_audit_log` row; a
// template version is its own record, never overwritten.

const PAST_TARGET_NOTE = 'A case is past its target IC date when that day has gone and it is still open.';
const AGE_BUCKETS: ReadonlyArray<[string, number, number]> = [['0-7', 0, 7], ['8-14', 8, 14], ['15-30', 15, 30], ['31-60', 31, 60], ['60+', 61, Infinity]];
const unreadable = (what: string) => ({ available: false as const, reason: `${what} could not be read. Try again in a moment.` });

function daysSince(ts: string, now: number): number | null {
  const t = Date.parse(String(ts).replace(' ', 'T') + (String(ts).includes('Z') || /[+-]\d\d:?\d\d$/.test(String(ts)) ? '' : 'Z'));
  return Number.isFinite(t) ? Math.floor((now - t) / 86_400_000) : null;
}

const OVERVIEW_SQL = 'SELECT c.id, c.status, c.created_at, c.target_ic_date, c.decision, c.decided_at, c.archived_at,'
  + ' CASE WHEN ' + READY_EXPR + ' THEN 1 ELSE 0 END AS ready,'
  + " (SELECT COUNT(*) FROM dd_findings f WHERE f.case_id = c.id AND f.resolved_at IS NULL AND f.severity IN ('high', 'critical'))"
  + "  + (SELECT COUNT(*) FROM dd_checklist_items i WHERE i.case_id = c.id AND i.status IN ('flag', 'fail') AND i.severity IN ('high', 'critical')) AS severe_flags,"
  + " (SELECT COUNT(*) FROM dd_requests r WHERE r.case_id = c.id AND r.state = 'requested') AS requests_waiting"
  + ' FROM dd_cases c' + CASE_FILTER_SQL;

dd.get('/overview', async (c) => {
  const user = await requireDdReader(c);
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  let cases: any[];
  try {
    const r = await c.env.DB.prepare(OVERVIEW_SQL).bind(...caseFilterBinds(user, () => undefined)).all<any>();
    cases = r.results || [];
  } catch {
    // A D1 error is the read failing, never an empty desk.
    return c.json({ error: 'The cases could not be read. Try again in a moment.', code: 'dd_overview_unreadable' }, 503);
  }
  const open = cases.filter((x) => x.status === 'open' || x.status === 'in_review');
  const stages = {
    available: true,
    not_started: open.filter((x) => x.status === 'open' && !Number(x.ready)).length,
    in_review: open.filter((x) => x.status === 'in_review' && !Number(x.ready)).length,
    ready: open.filter((x) => Number(x.ready)).length,
    decided_90_days: cases.filter((x) => x.status === 'completed' && x.decided_at && (daysSince(x.decided_at, now) ?? 999) <= 90).length,
    decided: cases.filter((x) => x.status === 'completed').length,
    archived: cases.filter((x) => x.status === 'archived').length,
    open: open.length,
  };
  const buckets = AGE_BUCKETS.map(([label]) => ({ label, before_target: 0, past_target: 0, no_target: 0 }));
  for (const x of open) {
    const d = daysSince(x.created_at, now);
    if (d == null) continue;
    const i = AGE_BUCKETS.findIndex(([, lo, hi]) => d >= lo && d <= hi);
    if (i < 0) continue;
    if (!x.target_ic_date) buckets[i].no_target += 1;
    else if (String(x.target_ic_date) < today) buckets[i].past_target += 1;
    else buckets[i].before_target += 1;
  }
  // Decisions by month, the last 12. Decisions are recorded from migration
  // 620 on: `recorded_from` is the month of the first one, and a month before
  // it is "Not recorded", never zero.
  const months: string[] = [];
  const d0 = new Date(now);
  for (let k = 11; k >= 0; k -= 1) months.push(new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - k, 1)).toISOString().slice(0, 7));
  const blank = () => ({ proceed: 0, proceed_with_conditions: 0, do_not_proceed: 0, withdrawn: 0, archived_without_decision: 0 });
  const byMonth = new Map(months.map((m) => [m, blank()]));
  const stamps: string[] = [];
  for (const x of cases) {
    if (x.decision && x.decided_at) {
      stamps.push(String(x.decided_at));
      const b = byMonth.get(String(x.decided_at).slice(0, 7)); if (b) (b as any)[x.decision] += 1;
    } else if (x.status === 'archived' && x.archived_at) {
      stamps.push(String(x.archived_at));
      const b = byMonth.get(String(x.archived_at).slice(0, 7)); if (b) b.archived_without_decision += 1;
    }
  }
  const recordedFrom = stamps.length ? stamps.sort()[0].slice(0, 7) : null;
  const withFlags = open.filter((x) => Number(x.severe_flags) > 0);
  return c.json({
    stages,
    severe_flags: { available: true, open: withFlags.reduce((a, x) => a + Number(x.severe_flags), 0), cases: withFlags.length },
    // Requests carry no due date before part 4 (#3263), so "past due" is not counted here.
    requests: { available: true, waiting: open.reduce((a, x) => a + Number(x.requests_waiting), 0), past_due: null, past_due_reason: 'Requests have no due date yet.' },
    ages: { available: true, buckets, note: PAST_TARGET_NOTE },
    decisions: {
      available: true,
      recorded_from: recordedFrom,
      months: months.map((m) => (recordedFrom != null && m >= recordedFrom ? { month: m, recorded: true, ...byMonth.get(m) } : { month: m, recorded: false })),
    },
  });
});

dd.get('/my-reviews', async (c) => {
  const user = await requireDdReader(c);
  const sql = getSQL(c.env);
  try {
    const rows: any[] = await sql`
      SELECT c.uid AS case_uid, c.subject_label, c.subject_type, c.status AS case_status,
             s.id AS section_id, s.title AS section_title, s.verdict, s.status AS section_status,
             r.role, r.invited_at, r.responded_at, r.nda_signed_at, r.conflicts, r.expires_at,
             (r.expires_at IS NOT NULL AND datetime(r.expires_at) < datetime('now') AND r.responded_at IS NULL) AS invite_expired,
             (SELECT COUNT(*) FROM dd_checklist_items i WHERE i.section_id = s.id AND i.status = 'pending') AS items_pending
        FROM dd_reviewers r
        JOIN dd_sections s ON s.id = r.section_id
        JOIN dd_cases c ON c.id = r.case_id
       WHERE r.user_id = ${user.id}
       ORDER BY (c.status IN ('completed', 'archived')) ASC, r.invited_at DESC, r.id DESC
       LIMIT 200`;
    return c.json({ items: rows.map((r) => ({ ...r, invite_expired: Number(r.invite_expired) === 1 })) });
  } finally { await sql.end(); }
});

const SUBJECT_ROLE: Record<string, string> = { founder: 'founder', advisor: 'advisor', investor: 'investor', partner: 'partner' };
const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

dd.get('/subjects', async (c) => {
  const user = await requireDdReader(c);
  const type = String(c.req.query('type') || '');
  const q = String(c.req.query('q') || '').trim().slice(0, 100);
  if (user.role === 'advisor') return c.json({ error: 'An advisor reviews cases and does not open them.' }, 403);
  if (type !== 'project' && !SUBJECT_ROLE[type]) return c.json({ error: 'Choose a startup, founder, advisor, investor or partner.' }, 400);
  if (user.role === 'investor') {
    // DDL2's inset: an investor opens diligence only on a startup they share a
    // deal with — the same relationship `POST /cases` checks (D1149).
    if (type !== 'project') return c.json({ error: 'You can only open diligence on a startup you are in a deal with.' }, 403);
    const rows = await c.env.DB.prepare(
      `SELECT p.id, p.name FROM projects p
        WHERE p.deleted_at IS NULL AND p.name LIKE ? ESCAPE '\\'
          AND EXISTS (SELECT 1 FROM deals d WHERE d.project_id = p.id AND (
                EXISTS (SELECT 1 FROM deal_invitations i WHERE i.deal_id = d.id AND i.investor_user_id = ?)
                OR EXISTS (SELECT 1 FROM commitments k WHERE k.deal_id = d.id AND k.investor_user_id = ?)))
        ORDER BY p.name COLLATE NOCASE LIMIT 20`,
    ).bind(likeOf(q), user.id, user.id).all<any>();
    return c.json({ items: (rows.results || []).map((r: any) => ({ id: r.id, name: r.name, type })) });
  }
  if (type === 'project') {
    const rows = await c.env.DB.prepare(
      `SELECT id, name FROM projects WHERE deleted_at IS NULL AND name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT 20`,
    ).bind(likeOf(q)).all<any>();
    return c.json({ items: (rows.results || []).map((r: any) => ({ id: r.id, name: r.name, type })) });
  }
  const rows = await c.env.DB.prepare(
    `SELECT id, name FROM users WHERE role = ? AND COALESCE(is_active, 1) = 1 AND COALESCE(name, '') != '' AND name LIKE ? ESCAPE '\\'
      ORDER BY name COLLATE NOCASE LIMIT 20`,
  ).bind(SUBJECT_ROLE[type], likeOf(q)).all<any>();
  return c.json({ items: (rows.results || []).map((r: any) => ({ id: r.id, name: r.name, type })) });
});

dd.get('/people', async (c) => {
  const user = await requireDdReader(c);
  // Who may assign may search (the assign route's own gate).
  if (user.role !== 'admin' && user.role !== 'partner') return c.json({ error: 'Forbidden' }, 403);
  const q = String(c.req.query('q') || '').trim().slice(0, 100);
  const pageSize = 20;
  const page = Math.max(Number.parseInt(String(c.req.query('page') ?? '1'), 10) || 1, 1);
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE role IN ('admin', 'partner', 'investor', 'advisor') AND COALESCE(is_active, 1) = 1
       AND COALESCE(name, '') != '' AND name LIKE ? ESCAPE '\\'`,
  ).bind(likeOf(q)).first<{ n: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT id, name, role, email FROM users WHERE role IN ('admin', 'partner', 'investor', 'advisor') AND COALESCE(is_active, 1) = 1
       AND COALESCE(name, '') != '' AND name LIKE ? ESCAPE '\\'
      ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?`,
  ).bind(likeOf(q), pageSize, (page - 1) * pageSize).all<any>();
  const items = (rows.results || []).map((r: any) => (user.role === 'admin' ? r : { id: r.id, name: r.name, role: r.role }));
  return c.json({ items, total: Number(total?.n ?? 0), page, page_size: pageSize });
});

dd.post('/cases/:uid/sections/:sectionId/conflicts', async (c) => {
  const user = await requireDdReader(c);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  const sectionId = parseInt(c.req.param('sectionId'), 10);
  const row = await c.env.DB.prepare('SELECT id FROM dd_reviewers WHERE case_id = ? AND section_id = ? AND user_id = ?')
    .bind(Number(cs.id), sectionId, user.id).first<{ id: number }>();
  // Only the invited person answers for themself.
  if (!row) return c.json({ error: 'You are not invited to this section.' }, 403);
  const body = await c.req.json().catch(() => ({} as any));
  if (typeof body.declared !== 'boolean') return c.json({ error: 'Say whether you have a conflict to declare.' }, 400);
  const note = String(body.note ?? '').trim();
  if (body.declared && !note) return c.json({ error: 'Say what the conflict is. The case lead reads it.' }, 400);
  if (note.length > 2000) return c.json({ error: 'At most 2000 characters.' }, 400);
  const enc = body.declared ? await encField(c.env, 'dd_reviewers', 'conflicts_note', Number(row.id), note) : null;
  await c.env.DB.prepare(`UPDATE dd_reviewers SET conflicts = ?, conflicts_note_enc = ?, conflicts_at = datetime('now') WHERE id = ?`)
    .bind(body.declared ? 'declared' : 'none', enc, Number(row.id)).run();
  await audit(c.env, Number(cs.id), user, 'conflicts_answered', { type: 'dd_section', id: sectionId }, { declared: body.declared });
  if (body.declared) {
    await notify(c.env, {
      userId: leadOf(cs),
      type: 'dd_conflict_declared',
      title: `A reviewer declared a conflict on ${cs.subject_label}`,
      body: 'Open the case team to read it.',
      link: `/due-diligence/${cs.uid}/team`,
      channels: ['in_app'],
    }).catch(() => null);
  }
  return c.json({ ok: true, conflicts: body.declared ? 'declared' : 'none' });
});

dd.delete('/cases/:uid/sections/:sectionId/reviewers/:userId', async (c) => {
  const user = await requireDdReader(c);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  if (user.role !== 'admin' && !leadsOrOpened(user, cs)) return c.json({ error: 'Only the case lead or an Admin can change the team.' }, 403);
  if (cs.status === 'archived') return c.json({ error: 'This case is archived. It takes no further change.' }, 409);
  const caseId = Number(cs.id);
  const sectionId = parseInt(c.req.param('sectionId'), 10);
  const removed = parseInt(c.req.param('userId'), 10);
  const r = await c.env.DB.prepare('SELECT id, role FROM dd_reviewers WHERE case_id = ? AND section_id = ? AND user_id = ?')
    .bind(caseId, sectionId, removed).first<{ id: number; role: string }>();
  if (!r) return c.json({ error: 'That person is not on this section.' }, 404);
  // Removed from the section: their invitation link stops working with the
  // row. A verdict they recorded stays signed in their name (D466).
  await c.env.DB.prepare('DELETE FROM dd_reviewers WHERE id = ?').bind(Number(r.id)).run();
  await c.env.DB.prepare(
    `UPDATE dd_sections SET assignee_user_id = NULL, status = CASE WHEN status = 'completed' THEN status ELSE 'pending' END, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND case_id = ? AND assignee_user_id = ?`,
  ).bind(sectionId, caseId, removed).run();
  await audit(c.env, caseId, user, 'reviewer_removed', { type: 'dd_section', id: sectionId }, { user_id: removed, role: r.role });
  return c.json({ ok: true });
});

dd.post('/cases/:uid/widen', async (c) => {
  const user = await requireDdReader(c);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  if (user.role !== 'admin' && !isLead(user, cs)) return c.json({ error: 'Only the case lead or an Admin can widen the scope.' }, 403);
  if (cs.status !== 'open' && cs.status !== 'in_review') return c.json({ error: 'A decided or archived case keeps its scope.' }, 409);
  const body = await c.req.json().catch(() => ({} as any));
  const to = String(body.depth || '') as ChecklistDepth;
  const from = String(cs.template_depth || 'standard') as ChecklistDepth;
  if (!(TEMPLATE_DEPTHS as readonly string[]).includes(to)) return c.json({ error: 'Choose Standard or Deep.' }, 400);
  // "You can widen scope later, never narrow it." (DDL2)
  if (DEPTH_RANK[to] <= DEPTH_RANK[from]) return c.json({ error: 'Scope only widens: choose a deeper template than the case has.' }, 400);
  const caseId = Number(cs.id);
  const template = await latestTemplate(c.env, to);
  const seed = seedFromTemplate(String(cs.subject_type) as DDSubjectType, template ? template.body : builtInTemplate(to));
  const sections = await c.env.DB.prepare('SELECT id, section_key FROM dd_sections WHERE case_id = ?').bind(caseId).all<{ id: number; section_key: string }>();
  const sectionId = new Map((sections.results || []).map((s) => [s.section_key, Number(s.id)]));
  let added = 0;
  for (const it of seed.checklist) {
    const sid = sectionId.get(it.section_key);
    if (!sid) continue;
    const r = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO dd_checklist_items (case_id, section_id, item_key, title, depth) VALUES (?, ?, ?, ?, ?)`,
    ).bind(caseId, sid, it.key, it.title, it.depth).run();
    added += Number((r as any)?.meta?.changes ?? 0);
  }
  await c.env.DB.prepare('UPDATE dd_cases SET template_depth = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(to, caseId).run();
  await audit(c.env, caseId, user, 'scope_widened', { type: 'dd_case', id: caseId }, { from, to, items_added: added });
  return c.json({ ok: true, template_depth: to, items_added: added });
});

/** A template as DDL13 draws it: each section with its title, weight, blocking and items per depth. */
function templateView(depth: ChecklistDepth, version: number, body: TemplateBody, meta: { uid?: string; created_at?: string; created_by_name?: string | null } = {}) {
  const titles = new Map(SECTION_CATALOG.map((s) => [s.key, s.title]));
  const items = new Map(CHECKLIST_CATALOG.map((i) => [i.key, i]));
  const sections = body.sections.map((s) => ({
    key: s.key, title: titles.get(s.key) ?? s.key, weight: s.weight, blocking: s.blocking,
    items: s.items.length,
    by_depth: { lite: s.items.filter((k) => items.get(k)?.depth === 'lite').length, standard: s.items.filter((k) => items.get(k)?.depth === 'standard').length, deep: s.items.filter((k) => items.get(k)?.depth === 'deep').length },
  }));
  return { depth, version, built_in: version === 0, ...meta, sections, item_count: sections.reduce((a, s) => a + s.items, 0), body };
}

dd.get('/templates', async (c) => {
  const user = await requireDdReader(c);
  const rows = await c.env.DB.prepare(
    `SELECT t.uid, t.depth, t.version, t.body_json, t.created_at, u.name AS created_by_name
       FROM dd_templates t LEFT JOIN users u ON u.id = t.created_by ORDER BY t.depth, t.version DESC`,
  ).all<any>();
  const all = rows.results || [];
  const out = TEMPLATE_DEPTHS.map((depth) => {
    const mine = all.filter((r: any) => r.depth === depth);
    const latest = mine[0];
    let current;
    try { current = latest ? templateView(depth, Number(latest.version), JSON.parse(latest.body_json), { uid: latest.uid, created_at: latest.created_at, created_by_name: latest.created_by_name ?? null }) : null; } catch { current = null; }
    return {
      depth,
      current: current ?? templateView(depth, 0, builtInTemplate(depth)),
      versions: [...mine.map((r: any) => ({ version: Number(r.version), created_at: r.created_at, created_by_name: r.created_by_name ?? null })), { version: 0, built_in: true }],
    };
  });
  // HQ edits templates; everyone else chooses one when they open a case.
  return c.json({ templates: out, can_edit: isSuperAdmin(user as any) });
});

dd.post('/templates', async (c) => {
  const user = await requireSuperAdmin(c);
  const body = await c.req.json().catch(() => ({} as any));
  const depth = String(body.depth || '') as ChecklistDepth;
  if (!(TEMPLATE_DEPTHS as readonly string[]).includes(depth)) return c.json({ error: 'Choose Lite, Standard or Deep.' }, 400);
  const checked = checkTemplateBody(body);
  if (!checked.ok) return c.json({ error: checked.error }, 400);
  const last = await c.env.DB.prepare('SELECT MAX(version) AS v FROM dd_templates WHERE depth = ?').bind(depth).first<{ v: number | null }>();
  const version = Number(last?.v ?? 0) + 1;
  const uid = genUid();
  try {
    await c.env.DB.prepare('INSERT INTO dd_templates (uid, depth, version, body_json, created_by) VALUES (?, ?, ?, ?, ?)')
      .bind(uid, depth, version, JSON.stringify(checked.body), user.id).run();
  } catch {
    return c.json({ error: 'Someone saved this template at the same moment. Read it again and save once more.', code: 'version_taken' }, 409);
  }
  return c.json({ ok: true, template: templateView(depth, version, checked.body, { uid }) }, 201);
});

/**
 * DDL8's platform checks, read only: the subject's identity check
 * (`users.kyc_status`), the business check for a partner or investor
 * (`company_kyb_records`, through the account's company) and a partner's
 * profile (`partner_profiles.admin_status`). Each is decided on its own page;
 * the case shows its state. A link is drawn for an Admin only, whose pages
 * they are.
 */
async function platformChecks(env: Env, user: AppUser, cs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const admin = user.role === 'admin';
  let subjectUserId: number | null = null;
  try { subjectUserId = await resolveSubjectUserId(env, cs); } catch { subjectUserId = null; }
  if (!subjectUserId) return { available: false, reason: 'The account this case is about could not be found, so its checks are not shown.' };
  const out: Record<string, unknown> = { available: true };
  try {
    const u = await env.DB.prepare('SELECT kyc_status, kyc_reviewed_at FROM users WHERE id = ?').bind(subjectUserId)
      .first<{ kyc_status: string | null; kyc_reviewed_at: string | null }>();
    out.identity = { available: true, status: u?.kyc_status ?? 'not_started', decided_at: u?.kyc_reviewed_at ?? null, link: admin ? '/admin/kyc' : null };
  } catch { out.identity = unreadable('The identity check'); }
  if (cs.subject_type === 'partner' || cs.subject_type === 'investor') {
    try {
      const k = await env.DB.prepare(
        `SELECT k.status, k.updated_at FROM user_company_links l JOIN company_kyb_records k ON k.company_id = l.company_id
          WHERE l.user_id = ? ORDER BY l.is_primary_admin DESC, l.id LIMIT 1`,
      ).bind(subjectUserId).first<{ status: string; updated_at: string | null }>();
      out.business = k ? { available: true, status: k.status, updated_at: k.updated_at ?? null, link: admin ? '/admin/kyc' : null }
        : { available: true, status: null, reason: 'No business check is on record for this account.' };
    } catch { out.business = unreadable('The business check'); }
  }
  if (cs.subject_type === 'partner') {
    try {
      const p = await env.DB.prepare('SELECT admin_status, ref, reviewed_at FROM partner_profiles WHERE user_id = ? LIMIT 1').bind(subjectUserId)
        .first<{ admin_status: string | null; ref: string | null; reviewed_at: string | null }>();
      out.partner_profile = p ? { available: true, status: p.admin_status ?? 'pending', reviewed_at: p.reviewed_at ?? null, link: admin && p.ref ? `/admin/partner-profiles/${encodeURIComponent(p.ref)}` : null }
        : { available: true, status: null, reason: 'No partner profile is on record for this account.' };
    } catch { out.partner_profile = unreadable('The partner profile'); }
  }
  return out;
}

export default dd;
