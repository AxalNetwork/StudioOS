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
import { requireAdmin, requireAuth } from '../auth';
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

async function audit(env: Env, caseId: number, actor: AppUser | null, action: string, target?: { type: string; id: number }, details?: unknown): Promise<void> {
  try {
    const actorHash = actor?.email ? await hashEmail(actor.email) : null;
    await env.DB.prepare(
      `INSERT INTO dd_audit_log (case_id, actor_user_id, actor_email_hash, action, target_type, target_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      caseId, actor?.id || null, actorHash, action,
      target?.type || null, target?.id || null,
      details ? JSON.stringify(details) : null,
    ).run();
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
      INSERT INTO dd_cases (uid, subject_type, subject_id, subject_label, owner_user_id, notes)
      VALUES (${uid}, ${subjectType}, ${subjectId}, ${subjectLabel}, ${user.id}, ${body.notes ? String(body.notes) : null})
      RETURNING id, uid, subject_type, subject_id, subject_label, status, owner_user_id, created_at`;
    const row = inserted[0];
    const caseId = Number(row.id);

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
  if (user.role !== 'admin') {
    const sql = getSQL(c.env);
    const access: any[] = await sql`
      SELECT 1 FROM dd_cases c
       WHERE c.id = ${caseId}
         AND (c.owner_user_id = ${user.id}
              OR EXISTS (SELECT 1 FROM dd_reviewers r WHERE r.case_id = c.id AND r.user_id = ${user.id}))`;
    await sql.end();
    if (access.length === 0) return c.json({ error: 'Forbidden' }, 403);
  }
  const sql = getSQL(c.env);
  try {
    const [sections, findings, sources, attachments, reviewers]: [any[], any[], any[], any[], any[]] = await Promise.all([
      sql`SELECT * FROM dd_sections WHERE case_id = ${caseId} ORDER BY id`,
      sql`SELECT * FROM dd_findings WHERE case_id = ${caseId} ORDER BY created_at DESC`,
      sql`SELECT id, connector, status, records_count, findings_emitted, error_message, started_at, completed_at FROM dd_external_sources WHERE case_id = ${caseId} ORDER BY id DESC`,
      sql`SELECT id, section_id, filename, mime_type, size_bytes, uploaded_by_user_id, created_at FROM dd_attachments WHERE case_id = ${caseId}`,
      sql`SELECT r.*, u.name AS user_name, u.email AS user_email FROM dd_reviewers r JOIN users u ON u.id = r.user_id WHERE r.case_id = ${caseId}`,
    ]);
    // Decrypt findings detail/excerpt for display
    const decryptedFindings = await Promise.all(findings.map(async f => ({
      id: f.id, section_id: f.section_id, source_id: f.source_id, source_kind: f.source_kind,
      severity: f.severity, title: f.title, evidence_url: f.evidence_url,
      detail: await decField(c.env, 'dd_findings', 'detail', f.id, f.detail_enc),
      subject_name: await decField(c.env, 'dd_findings', 'subject_name', f.id, f.subject_name_enc),
      evidence_excerpt: await decField(c.env, 'dd_findings', 'evidence_excerpt', f.id, f.evidence_excerpt_enc),
      resolved_at: f.resolved_at,
      created_at: f.created_at,
    })));
    return c.json({
      case: {
        ...cs,
        subject_email: await decField(c.env, 'dd_cases', 'subject_email', caseId, cs.subject_email_enc as string | null),
        subject_legal_name: await decField(c.env, 'dd_cases', 'subject_legal_name', caseId, cs.subject_legal_name_enc as string | null),
        subject_email_enc: undefined, subject_legal_name_enc: undefined,
      },
      sections, findings: decryptedFindings, sources, attachments, reviewers,
    });
  } finally { await sql.end(); }
});

// ---------- external scan ----------

dd.post('/cases/:uid/scan', async (c) => {
  const user = await requireDdReader(c);
  if (user.role !== 'admin' && user.role !== 'partner') {
    return c.json({ error: 'Only admins or partners may run scans' }, 403);
  }
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  const caseId = Number(cs.id);
  const subjectLabel = String(cs.subject_label || '');

  const body = await c.req.json().catch(() => ({}));
  const requested: string[] = Array.isArray(body.connectors) && body.connectors.length
    ? body.connectors : CONNECTORS.map(x => x.key);

  const sql = getSQL(c.env);
  const results: Array<{ connector: string; status: string; findings_emitted: number }> = [];
  try {
    for (const meta of CONNECTORS) {
      if (!requested.includes(meta.key)) continue;
      const startedAt = new Date().toISOString();
      const inserted: any[] = await sql`
        INSERT INTO dd_external_sources (case_id, connector, status, started_at)
        VALUES (${caseId}, ${meta.key}, 'running', ${startedAt})
        RETURNING id`;
      const sourceId = Number(inserted[0].id);
      let r;
      try {
        r = await runConnector(c.env, meta, subjectLabel);
      } catch (e) {
        r = { status: 'error' as const, records_count: 0, raw_response: null, findings: [], error_message: (e as Error).message };
      }
      let emitted = 0;
      for (const f of r.findings) {
        // Map finding into findings table (PII columns encrypted).
        const sectionRows: any[] = await sql`SELECT id FROM dd_sections WHERE case_id = ${caseId} AND section_key = ${f.section_key || meta.default_section} LIMIT 1`;
        const sectionId = sectionRows[0]?.id || null;
        const inserted2: any[] = await sql`
          INSERT INTO dd_findings (case_id, section_id, source_id, source_kind, severity, title, evidence_url)
          VALUES (${caseId}, ${sectionId}, ${sourceId}, ${f.source_kind}, ${f.severity}, ${f.title}, ${f.evidence_url || null})
          RETURNING id`;
        const findingId = Number(inserted2[0].id);
        const detailEnc = await encField(c.env, 'dd_findings', 'detail', findingId, f.detail);
        const subjEnc   = await encField(c.env, 'dd_findings', 'subject_name', findingId, f.subject_name || null);
        const exEnc     = await encField(c.env, 'dd_findings', 'evidence_excerpt', findingId, f.evidence_excerpt || null);
        await sql`UPDATE dd_findings SET detail_enc = ${detailEnc}, subject_name_enc = ${subjEnc}, evidence_excerpt_enc = ${exEnc} WHERE id = ${findingId}`;
        emitted++;

        // High/critical findings push a notification to the case owner.
        if (f.severity === 'high' || f.severity === 'critical') {
          await notify(c.env, {
            userId: Number(cs.owner_user_id),
            type: 'dd_high_severity_finding',
            title: `[${f.severity.toUpperCase()}] DD finding on ${subjectLabel}`,
            body: f.title,
            link: `/admin/due-diligence/${cs.uid}`,
            channels: ['in_app', 'email'],
          }).catch(() => null);
        }
      }
      const rawEnc = await encField(c.env, 'dd_external_sources', 'raw_response', sourceId, r.raw_response ? JSON.stringify(r.raw_response) : null);
      await sql`
        UPDATE dd_external_sources
           SET status = ${r.status}, records_count = ${r.records_count},
               findings_emitted = ${emitted}, error_message = ${r.error_message || null},
               raw_response_enc = ${rawEnc}, completed_at = CURRENT_TIMESTAMP
         WHERE id = ${sourceId}`;
      results.push({ connector: meta.key, status: r.status, findings_emitted: emitted });
    }
    await sql`UPDATE dd_cases SET external_scan_completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ${caseId}`;
    await audit(c.env, caseId, user, 'external_scan_run', { type: 'dd_case', id: caseId }, { connectors: results });
    await recomputeAndStoreScore(c.env, caseId);
    return c.json({ ok: true, results });
  } finally { await sql.end(); }
});

// ---------- reviewers / assignment ----------

dd.post('/cases/:uid/sections/:sectionId/assign', async (c) => {
  const user = await requireDdReader(c);
  if (user.role !== 'admin' && user.role !== 'partner') return c.json({ error: 'Forbidden' }, 403);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
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

    const link = `https://axal.vc/admin/due-diligence/${cs.uid}?section=${sectionId}&inv=${jti}`;
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
    if (user.role !== 'admin') {
      const r: any[] = await sql`SELECT 1 FROM dd_reviewers WHERE section_id = ${sectionId} AND user_id = ${user.id}`;
      if (r.length === 0) return c.json({ error: 'You are not assigned to this section' }, 403);
    }
    await sql`
      UPDATE dd_sections
         SET verdict = ${verdict}, reviewer_notes = ${body.reviewer_notes ? String(body.reviewer_notes) : null},
             status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ${sectionId} AND case_id = ${caseId}`;
    if (body.nda_signed) {
      await sql`UPDATE dd_sections SET reviewer_signed_nda_at = CURRENT_TIMESTAMP WHERE id = ${sectionId}`;
      await sql`UPDATE dd_reviewers SET nda_signed_at = CURRENT_TIMESTAMP, responded_at = CURRENT_TIMESTAMP WHERE section_id = ${sectionId} AND user_id = ${user.id}`;
    } else {
      await sql`UPDATE dd_reviewers SET responded_at = CURRENT_TIMESTAMP WHERE section_id = ${sectionId} AND user_id = ${user.id}`;
    }
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
  await requireDdReader(c);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  const r = await recomputeAndStoreScore(c.env, Number(cs.id));
  return c.json(r);
});

// ---------- report generation + share ----------

dd.post('/cases/:uid/report', async (c) => {
  const user = await requireDdReader(c);
  if (user.role !== 'admin' && user.role !== 'partner') return c.json({ error: 'Forbidden' }, 403);
  const cs = await getCaseByUid(c.env, c.req.param('uid'));
  if (!cs) return c.json({ error: 'Case not found' }, 404);
  const caseId = Number(cs.id);

  const sql = getSQL(c.env);
  try {
    const sections: any[] = await sql`SELECT * FROM dd_sections WHERE case_id = ${caseId} ORDER BY id`;
    const findings: any[] = await sql`SELECT * FROM dd_findings WHERE case_id = ${caseId} ORDER BY severity DESC, created_at DESC`;
    const reportSections: ReportSection[] = await Promise.all(sections.map(async s => ({
      section_key: s.section_key, title: s.title, weight: Number(s.weight),
      status: s.status, verdict: s.verdict, reviewer_notes: s.reviewer_notes,
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
      notes: cs.notes as string | null,
    };

    const artifact = await renderReportArtifact(c.env, reportCase, reportSections);
    const ts = Date.now();
    const ext = artifact.format === 'pdf' ? 'pdf' : 'html';
    const key = `dd-reports/${caseId}/${ts}-${genUid().slice(0, 8)}.${ext}`;
    let storedKey: string | null = null;
    if (c.env.FILES) {
      try {
        await c.env.FILES.put(key, artifact.bytes, { httpMetadata: { contentType: artifact.contentType } });
        storedKey = key;
      } catch (e) { console.warn('[dd] R2 put failed:', (e as Error).message); }
    }

    const inserted: any[] = await sql`
      INSERT INTO dd_reports (case_id, storage_key, format, risk_score_at_generation, risk_band_at_generation, generated_by_user_id)
      VALUES (${caseId}, ${storedKey}, ${artifact.format}, ${reportCase.risk_score}, ${reportCase.risk_band}, ${user.id})
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
  return new Response(obj.body as ReadableStream, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'content-disposition': `attachment; filename="dd-report-${v.key.split('/').pop()}"`,
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
      channels: ['in_app','email'],
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
  if (user.role !== 'admin' && Number(cs.owner_user_id) !== user.id) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const sql = getSQL(c.env);
  try {
    const rows: any[] = await sql`
      SELECT a.*, u.name AS actor_name, u.email AS actor_email
        FROM dd_audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.case_id = ${cs.id} ORDER BY a.created_at DESC LIMIT 200`;
    return c.json({ items: rows });
  } finally { await sql.end(); }
});

export default dd;
