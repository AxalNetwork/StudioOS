/**
 * Task #3 — Due Diligence routes mounted at /api/dd.
 *
 * Access:
 *   - Founders are NEVER allowed: any DD endpoint that doesn't require
 *     `admin` requires `partner|investor|mentor` AND a matching reviewer
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
import { requireAdmin, requireAuth, requireFactor } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { mintDownloadToken, verifyAndConsumeToken } from '../services/signedDownload';
import { notify } from '../services/notify';
import {
  SECTION_CATALOG, CONNECTORS, sectionsFor, runConnector,
  computeScore, worstSeverity,
  encField, decField,
  renderReportArtifact,
  type DDSubjectType, type ReportCase, type ReportSection,
} from '../services/dueDiligence';
import { encryptBytes, decryptBytes } from '../services/cryptoBox';

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

async function requireDdReader(c: AppContext): Promise<AppUser> {
  const user = await requireAuth(c);
  // Founders are explicitly blocked from every DD endpoint. They are
  // notified once when the report is shared (via /report/share) but
  // never read DD data themselves. The User.role union doesn't currently
  // include 'mentor' (see types.ts) so we widen here — mentors are stored
  // in the DB with role='mentor' even though the type literal doesn't
  // list it (legacy from before the mentor role split).
  const role = String(user.role);
  if (role !== 'admin' && role !== 'partner' && role !== 'investor' && role !== 'mentor') {
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
  if (Number(cs.owner_user_id) === user.id) return user;
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

dd.get('/cases', async (c) => {
  const user = await requireDdReader(c);
  const sql = getSQL(c.env);
  const subjectType = c.req.query('subject_type');
  const status = c.req.query('status');
  const band = c.req.query('risk_band');
  const ownerOnly = c.req.query('owner_only') === '1';
  try {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (subjectType) { conds.push('subject_type = ?'); params.push(subjectType); }
    if (status) { conds.push('status = ?'); params.push(status); }
    if (band) { conds.push('risk_band = ?'); params.push(band); }
    if (ownerOnly || user.role !== 'admin') {
      // Partners/investors/mentors only see cases they own OR are a reviewer on.
      conds.push(`(owner_user_id = ? OR id IN (SELECT case_id FROM dd_reviewers WHERE user_id = ?))`);
      params.push(user.id, user.id);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows: any[] = await sql.unsafe(
      `SELECT id, uid, subject_type, subject_id, subject_label, status, risk_score, risk_band,
              owner_user_id, created_at, updated_at, report_generated_at
         FROM dd_cases ${where}
         ORDER BY created_at DESC LIMIT 200`,
      params,
    );
    return c.json({ items: rows });
  } finally { await sql.end(); }
});

dd.post('/cases', async (c) => {
  const user = await requireDdReader(c);
  if (user.role !== 'admin' && user.role !== 'partner') {
    return c.json({ error: 'Only admins or partners may open cases' }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  const subjectType = String(body.subject_type || '') as DDSubjectType;
  const subjectId = Number(body.subject_id);
  const subjectLabel = String(body.subject_label || '').trim();
  if (!['project','founder','mentor','investor','partner'].includes(subjectType)) {
    return c.json({ error: 'Invalid subject_type' }, 400);
  }
  if (!subjectId || !subjectLabel) {
    return c.json({ error: 'subject_id and subject_label are required' }, 400);
  }
  const sql = getSQL(c.env);
  try {
    const uid = genUid();
    const inserted: any[] = await sql`
      INSERT INTO dd_cases (uid, subject_type, subject_id, subject_label, owner_user_id)
      VALUES (${uid}, ${subjectType}, ${subjectId}, ${subjectLabel}, ${user.id})
      RETURNING id, uid, subject_type, subject_id, subject_label, status, owner_user_id, created_at`;
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

    const sections = sectionsFor(subjectType);
    for (const s of sections) {
      await sql`
        INSERT INTO dd_sections (case_id, section_key, title, weight)
        VALUES (${caseId}, ${s.key}, ${s.title}, ${s.weight})`;
    }
    await audit(c.env, caseId, user, 'case_opened', { type: 'dd_case', id: caseId }, { subject_type: subjectType, subject_id: subjectId });
    return c.json({ ...row, sections_seeded: sections.length }, 201);
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
  // Anyone else (admin/partner/investor/mentor without an assignment on
  // this case) is rejected with 403.
  let scopedSectionIds: Set<number> | null = null; // null = unrestricted
  if (user.role !== 'admin' && Number(cs.owner_user_id) !== user.id) {
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
    const [sectionsAll, findingsAll, sources, attachmentsAll, reviewersAll]: [any[], any[], any[], any[], any[]] = await Promise.all([
      sql`SELECT * FROM dd_sections WHERE case_id = ${caseId} ORDER BY id`,
      sql`SELECT * FROM dd_findings WHERE case_id = ${caseId} ORDER BY created_at DESC`,
      sql`SELECT id, connector, status, records_count, findings_emitted, error_message, started_at, completed_at FROM dd_external_sources WHERE case_id = ${caseId} ORDER BY id DESC`,
      sql`SELECT id, section_id, filename, mime_type, size_bytes, uploaded_by_user_id, created_at FROM dd_attachments WHERE case_id = ${caseId}`,
      sql`SELECT r.*, u.name AS user_name, u.email AS user_email FROM dd_reviewers r JOIN users u ON u.id = r.user_id WHERE r.case_id = ${caseId}`,
    ]);
    const allowSection = (sid: number | null | undefined) =>
      scopedSectionIds == null ? true : (sid != null && scopedSectionIds.has(Number(sid)));
    const sections = sectionsAll.filter(s => allowSection(s.id));
    const findings = findingsAll.filter(f => allowSection(f.section_id));
    const attachments = attachmentsAll.filter(a => allowSection(a.section_id));
    const reviewers = reviewersAll.filter(r => allowSection(r.section_id));

    const decryptedFindings = await Promise.all(findings.map(async f => ({
      id: f.id, section_id: f.section_id, source_id: f.source_id, source_kind: f.source_kind,
      severity: f.severity, title: f.title, evidence_url: f.evidence_url,
      detail: await decField(c.env, 'dd_findings', 'detail', f.id, f.detail_enc),
      subject_name: await decField(c.env, 'dd_findings', 'subject_name', f.id, f.subject_name_enc),
      evidence_excerpt: await decField(c.env, 'dd_findings', 'evidence_excerpt', f.id, f.evidence_excerpt_enc),
      resolved_at: f.resolved_at,
      created_at: f.created_at,
    })));
    const decryptedSections = await Promise.all(sections.map(async s => ({
      ...s,
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
      scoped: isScoped,
    };
    return c.json({
      case: caseOut,
      sections: decryptedSections,
      findings: decryptedFindings,
      sources: isScoped ? [] : sources, // scan results are case-wide; hide from scoped reviewers
      attachments,
      reviewers,
    });
  } finally { await sql.end(); }
});

// ---------- external scan ----------

// Async scan: enqueue rows immediately as 'queued', return 202, then run
// each connector in the background via waitUntil so the request returns
// fast and the frontend can poll case GET to see status transitions
// (queued → running → ok/error). This is the queue-backed ingestion
// pattern without requiring a Cloudflare Queue binding.
async function processConnector(env: Env, sourceId: number, caseId: number, meta: typeof CONNECTORS[number], subjectLabel: string, ownerUserId: number, caseUid: string): Promise<void> {
  const sql = getSQL(env);
  try {
    await sql`UPDATE dd_external_sources SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ${sourceId}`;
    let r;
    try { r = await runConnector(env, meta, subjectLabel); }
    catch (e) { r = { status: 'error' as const, records_count: 0, raw_response: null, findings: [], error_message: (e as Error).message }; }
    let emitted = 0;
    for (const f of r.findings) {
      const sectionRows: any[] = await sql`SELECT id FROM dd_sections WHERE case_id = ${caseId} AND section_key = ${f.section_key || meta.default_section} LIMIT 1`;
      const sectionId = sectionRows[0]?.id || null;
      const inserted2: any[] = await sql`
        INSERT INTO dd_findings (case_id, section_id, source_id, source_kind, severity, title, evidence_url)
        VALUES (${caseId}, ${sectionId}, ${sourceId}, ${f.source_kind}, ${f.severity}, ${f.title}, ${f.evidence_url || null})
        RETURNING id`;
      const findingId = Number(inserted2[0].id);
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
    await sql`UPDATE dd_cases SET status = 'in_review', updated_at = CURRENT_TIMESTAMP WHERE id = ${caseId}`;
    await audit(c.env, caseId, user, 'external_scan_started', { type: 'dd_case', id: caseId }, { connectors: queued.map(q => q.connector) });
  } finally { await sql.end(); }

  // Background processing — frontend polls /cases/:uid for status updates.
  c.executionCtx.waitUntil((async () => {
    for (const q of queued) {
      const meta = CONNECTORS.find(m => m.key === q.connector);
      if (!meta) continue;
      try { await processConnector(c.env, q.id, caseId, meta, subjectLabel, ownerUserId, caseUid); }
      catch (e) { console.warn(`[dd] connector ${q.connector} failed:`, (e as Error).message); }
    }
    try {
      const sql2 = getSQL(c.env);
      try {
        await sql2`UPDATE dd_cases SET external_scan_completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ${caseId}`;
      } finally { await sql2.end(); }
      await recomputeAndStoreScore(c.env, caseId);
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

  const sql = getSQL(c.env);
  try {
    const sec: any[] = await sql`SELECT * FROM dd_sections WHERE id = ${sectionId} AND case_id = ${caseId}`;
    if (sec.length === 0) return c.json({ error: 'Section not found' }, 404);
    const u: any[] = await sql`SELECT id, name, email, role FROM users WHERE id = ${assigneeId}`;
    if (u.length === 0) return c.json({ error: 'Assignee user not found' }, 404);
    // Only roles permitted to read DD data may be assigned a section.
    // Anything outside admin/partner/investor/mentor (notably founder)
    // would be unable to open the case anyway and would just create a
    // dangling reviewer row.
    const allowed = new Set(['admin', 'partner', 'investor', 'mentor']);
    if (!allowed.has(String(u[0].role))) {
      return c.json({ error: 'Assignee role cannot review DD sections (must be admin/partner/investor/mentor)' }, 403);
    }

    await sql`UPDATE dd_sections SET assignee_user_id = ${assigneeId}, status = 'assigned', updated_at = CURRENT_TIMESTAMP WHERE id = ${sectionId}`;
    const jti = genUid();
    await sql`
      INSERT INTO dd_reviewers (case_id, section_id, user_id, magic_link_jti)
      VALUES (${caseId}, ${sectionId}, ${assigneeId}, ${jti})
      ON CONFLICT(section_id, user_id) DO UPDATE SET invited_at = CURRENT_TIMESTAMP, magic_link_jti = excluded.magic_link_jti`;

    const baseUrl = c.env.APP_URL || 'https://app.axal.vc';
    const link = `${baseUrl.replace(/\/+$/, '')}/admin/due-diligence/${cs.uid}?section=${sectionId}&inv=${jti}`;
    await notify(c.env, {
      userId: assigneeId,
      type: 'dd_section_assigned',
      title: `DD review requested: ${sec[0].title}`,
      body: `You've been assigned the "${sec[0].title}" section on case ${cs.uid} (${cs.subject_label}).`,
      link,
      channels: ['in_app', 'email'],
    }).catch(() => null);
    await audit(c.env, caseId, user, 'section_assigned', { type: 'dd_section', id: sectionId }, { assignee_id: assigneeId });
    return c.json({ ok: true, magic_link: link });
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
    if (user.role !== 'admin') {
      const r: any[] = await sql`SELECT 1 FROM dd_reviewers WHERE section_id = ${sectionId} AND user_id = ${user.id}`;
      if (r.length === 0) return c.json({ error: 'You are not assigned to this section' }, 403);
    }
    // Server-side NDA enforcement: any verdict other than 'n_a' requires
    // a real signed-NDA artifact on file. The client-side gate in
    // VerdictModal is just UX — a malicious client could call the API
    // directly. The legacy `body.nda_signed` boolean is intentionally
    // ignored: only an actual `dd_attachments` row (uploaded via /nda)
    // OR an admin override counts as evidence.
    if (verdict !== 'n_a' && user.role !== 'admin') {
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
             status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ${sectionId} AND case_id = ${caseId}`;
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

async function recomputeAndStoreScore(env: Env, caseId: number): Promise<{ score: number; band: string }> {
  const sql = getSQL(env);
  try {
    const sections: any[] = await sql`SELECT * FROM dd_sections WHERE case_id = ${caseId}`;
    const findings: any[] = await sql`SELECT section_id, severity, resolved_at FROM dd_findings WHERE case_id = ${caseId}`;
    const bySection = new Map<number, string[]>();
    for (const f of findings) {
      if (f.resolved_at) continue;
      const arr = bySection.get(f.section_id) || [];
      arr.push(f.severity);
      bySection.set(f.section_id, arr);
    }
    const inputs = sections.map(s => ({
      weight: Number(s.weight) || 1,
      verdict: s.verdict || null,
      worst_severity: worstSeverity(bySection.get(s.id) || []),
    }));
    const { score, band } = computeScore(inputs);
    await sql`UPDATE dd_cases SET risk_score = ${score}, risk_band = ${band}, updated_at = CURRENT_TIMESTAMP WHERE id = ${caseId}`;
    return { score, band };
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

// ---------- report generation + share ----------

dd.post('/cases/:uid/report', async (c) => {
  // Task #6 — DD reports embed sensitive verdicts and signed download
  // tokens are 5-minute single-use; gate the MINT on TOTP step-up so a
  // SMS-only session can never produce or distribute a report URL. The
  // /reports/download/:token GET stays unauth-by-token; this is the
  // chokepoint that controls who can hand out tokens in the first place.
  await requireFactor(c, 'totp');
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
    const reportSections: ReportSection[] = await Promise.all(sections.map(async s => ({
      section_key: s.section_key, title: s.title, weight: Number(s.weight),
      status: s.status, verdict: s.verdict,
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
    if (user.role !== 'admin' && Number(cs.owner_user_id) !== user.id) {
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
// mentor/investor and who either (a) have completed prior verdicts on
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
           AND u.role IN ('admin','partner','mentor','investor')
         GROUP BY u.id, u.name, u.email, u.role
         ORDER BY prior_reviews DESC, last_reviewed_at DESC
         LIMIT 10`;
    }
    const eligible: any[] = await sql`
      SELECT id, name, email, role FROM users
       WHERE role IN ('admin','partner','mentor','investor')
       ORDER BY name LIMIT 100`;
    return c.json({ suggestions, eligible });
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
      SELECT id, section_id, user_id FROM dd_reviewers
       WHERE case_id = ${cs.id} AND magic_link_jti = ${jti} LIMIT 1`;
    if (r.length === 0) return c.json({ error: 'Invitation invalid or expired' }, 403);
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

export default dd;
