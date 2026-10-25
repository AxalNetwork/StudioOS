/**
 * D983 (#2774, part 2 of #2376) — HQ's answer to a studio's program requests.
 *
 *   GET  /api/admin/program-grants/requests[?status=open|answered|declined]
 *        every program request, from HQ's lane and every branch's
 *        (requireSuperAdmin)
 *   POST /api/admin/program-grants/requests/:uid/approve  { reason, terms? }
 *   POST /api/admin/program-grants/requests/:uid/decline  { reason }
 *        (requireSuperAdminWriteBar, a reason of at least 10 characters)
 *
 * AN APPROVAL IS A DECISION, NOT A GRANT. "Grant" stays part 1's write
 * (`routes/admin_program_grants.ts`). Approving records the request's answer
 * and appends the draft to the licence's history as a `program_changed`
 * event (`request_approved`): for a grant, the program's defaults with HQ's
 * terms over them; for a terms change, the term and what was asked; for an
 * end, the program. Part 6's "Finish grant" opens part 1's write with it.
 * Declining records the reason the studio reads (`request_declined`).
 *
 * THE ANSWER IS THE REQUEST'S ONE ANSWER (migration 259), written only while
 * the request is open (`WHERE … AND status = 'open'`), so two answers cannot
 * race. The studio is told as the escalation queue tells it: in the bell on
 * HQ's tier, by the branch's own Worker on a branch.
 *
 * The generic `PATCH /api/admin/escalations/:uid` refuses these kinds, so
 * neither the write bar nor the history can be skipped.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { escalationSlaBand, HQ_TIER_CODE } from '../rpc/hqOps';
import { PROGRAM_REQUEST_KINDS, decodeRequestDetail, isProgramRequestKind } from '../services/escalationRequests';
import {
  ANSWER_REFUSALS, approvalTerms, checkProgramRequest, draftOf, licenceOfRequest, programName,
} from '../services/programRequests';
import { deliverAnswer, noticeHqTier } from './admin_escalations';

const r = new Hono<{ Bindings: Env }>();

export const REASON_MIN = 10;
const STATUSES = ['open', 'answered', 'declined', 'withdrawn'] as const;
/** The most rows one read returns; `complete` says whether it was cut. */
export const REQUESTS_READ_MAX = 500;

const nowIso = () => new Date().toISOString();

/** What a request asks for, in GR5's "Asks for" words. */
export const ASKS_FOR: Record<string, string> = {
  program_grant: 'Grant',
  program_terms_change: 'Change terms',
  program_end: 'End',
};

type Row = {
  uid: string; branch_code: string; kind: string; subject: string; subject_ref: string | null; detail: string | null;
  raised_by_name: string | null; status: string; due_at: string | null; created_at: string;
  answer: string | null; answered_by_name: string | null; answered_at: string | null;
};

async function rowOf(env: Env, uid: string) {
  return env.DB.prepare(
    `SELECT uid, branch_code, kind, subject, subject_ref, detail, raised_by_name, status, due_at, created_at,
            answer, answered_by_name, answered_at
       FROM hq_escalations WHERE uid = ?`,
  ).bind(uid).first<Row>();
}

/** The drafts HQ's approvals left, by request uid, from the licences' history. */
async function draftsByRequest(env: Env) {
  const rows = ((await env.DB.prepare(
    `SELECT detail_json FROM licence_events WHERE event = 'program_changed'
        AND json_extract(detail_json, '$.action') = 'request_approved'`,
  ).all<{ detail_json: string }>()).results || []);
  const out = new Map<string, unknown>();
  for (const x of rows) {
    try { const d = JSON.parse(x.detail_json); if (d?.request_uid) out.set(String(d.request_uid), d.draft ?? null); } catch { /* not ours */ }
  }
  return out;
}

// GET /api/admin/program-grants/requests
r.get('/', async (c) => {
  try {
    await requireSuperAdmin(c);
    const status = String(c.req.query('status') ?? '').trim().toLowerCase();
    if (status && !(STATUSES as readonly string[]).includes(status)) {
      return c.json({ error: 'bad_status', message: `status must be one of ${STATUSES.join(', ')}` }, 400);
    }
    const rows = ((status
      ? await c.env.DB.prepare(
        `SELECT uid, branch_code, kind, subject, subject_ref, detail, raised_by_name, status, due_at, created_at,
                answer, answered_by_name, answered_at
           FROM hq_escalations WHERE kind IN (?, ?, ?) AND status = ?
          ORDER BY created_at ASC, id ASC LIMIT ?`,
      ).bind(...PROGRAM_REQUEST_KINDS, status, REQUESTS_READ_MAX + 1).all<Row>()
      : await c.env.DB.prepare(
        `SELECT uid, branch_code, kind, subject, subject_ref, detail, raised_by_name, status, due_at, created_at,
                answer, answered_by_name, answered_at
           FROM hq_escalations WHERE kind IN (?, ?, ?)
          ORDER BY created_at ASC, id ASC LIMIT ?`,
      ).bind(...PROGRAM_REQUEST_KINDS, REQUESTS_READ_MAX + 1).all<Row>()).results || []);
    const complete = rows.length <= REQUESTS_READ_MAX;
    const drafts = await draftsByRequest(c.env);
    const now = Date.now();
    const items = [];
    for (const row of rows.slice(0, REQUESTS_READ_MAX)) {
      const { request, note } = decodeRequestDetail(row.detail);
      const licence = await licenceOfRequest(c.env, row);
      const program = request && typeof request.program === 'string' ? request.program : null;
      items.push({
        uid: row.uid,
        kind: row.kind,
        asks_for: ASKS_FOR[row.kind] ?? null,
        program_key: program,
        program_name: program ? programName(program) : null,
        request,
        note,
        lane: row.branch_code === HQ_TIER_CODE ? 'hq' : 'branch',
        branch_code: row.branch_code === HQ_TIER_CODE ? null : row.branch_code,
        // A row whose licence the ledger does not hold says so; it is never given another licence.
        licence: licence ? { uid: licence.uid, licence_ref: licence.licence_ref, brand_name: licence.brand_name, status: licence.status } : null,
        raised_by_name: row.raised_by_name,
        status: row.status,
        created_at: row.created_at,
        due_at: row.due_at,
        sla: row.status === 'open' ? escalationSlaBand(row, now) : null,
        answer: row.answer,
        answered_by_name: row.answered_by_name,
        answered_at: row.answered_at,
        draft: drafts.has(row.uid) ? drafts.get(row.uid) : null,
      });
    }
    return c.json({ items, complete, kinds: PROGRAM_REQUEST_KINDS, asks_for: ASKS_FOR });
  } catch (e) { return mapError(c, e); }
});

/** The request, its reason and its licence, or the refusal. Shared by both answers. */
async function answerable(c: any) {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await c.req.json().catch(() => ({} as any));
  const reason = typeof b?.reason === 'string' ? b.reason.trim().slice(0, 2000) : '';
  if (reason.length < REASON_MIN) {
    return { refused: c.json({ error: 'reason_required', message: `Say why, in at least ${REASON_MIN} characters. The studio reads it, and HQ's record keeps it.` }, 400) };
  }
  const uid = String(c.req.param('uid') ?? '').trim().slice(0, 80);
  const row = await rowOf(c.env, uid);
  if (!row) return { refused: c.json({ error: 'not_found' }, 404) };
  if (!isProgramRequestKind(row.kind)) return { refused: c.json({ error: 'not_a_program_request', message: ANSWER_REFUSALS.not_a_program_request }, 409) };
  if (row.status !== 'open') return { refused: c.json({ error: 'not_open', message: ANSWER_REFUSALS.not_open }, 409) };
  const licence = await licenceOfRequest(c.env, row);
  if (!licence) return { refused: c.json({ error: 'no_licence', message: ANSWER_REFUSALS.no_licence }, 409) };
  const { request } = decodeRequestDetail(row.detail);
  if (!request || typeof request.program !== 'string') {
    return { refused: c.json({ error: 'not_a_program_request', message: ANSWER_REFUSALS.not_a_program_request }, 409) };
  }
  return { admin, b, reason, row, licence, request };
}

/**
 * Write the answer while the request is still open, append the history row,
 * and tell the studio. A request answered meanwhile changes nothing.
 */
async function decide(
  c: any,
  t: { admin: { id: number; name?: string }; reason: string; row: Row; licence: { id: number }; request: Record<string, unknown> },
  status: 'answered' | 'declined',
  history: Record<string, unknown>,
) {
  const now = nowIso();
  const name = String(t.admin.name ?? '').trim().slice(0, 200) || 'Axal VC HQ';
  const done = await c.env.DB.prepare(
    `UPDATE hq_escalations
        SET answer = ?, answered_by_user_id = ?, answered_by_name = ?, answered_at = ?, status = ?, updated_at = ?
      WHERE uid = ? AND status = 'open'`,
  ).bind(t.reason, t.admin.id, name, now, status, now, t.row.uid).run();
  if (Number(done?.meta?.changes ?? 0) === 0) return c.json({ error: 'not_open', message: ANSWER_REFUSALS.not_open }, 409);
  await c.env.DB.prepare(
    `INSERT INTO licence_events (licence_id, event, detail_json, note, actor_user_id, created_at)
     VALUES (?, 'program_changed', ?, ?, ?, ?)`,
  ).bind(t.licence.id, JSON.stringify({ ...history, program_key: t.request.program, request_uid: t.row.uid, request_kind: t.row.kind, reason: t.reason }), t.reason, t.admin.id, now).run();
  const after = (await rowOf(c.env, t.row.uid))!;
  const told = t.row.branch_code === HQ_TIER_CODE
    ? { notified: await noticeHqTier(c.env, t.row.uid) }
    : { pushed: await deliverAnswer(c.env, t.row.branch_code, { hq_uid: t.row.uid, answer: t.reason, answered_by_name: name, answered_at: now, status }) };
  return c.json({ uid: after.uid, kind: after.kind, status: after.status, answer: after.answer, answered_at: after.answered_at, ...history, ...told });
}

// POST /api/admin/program-grants/requests/:uid/approve  { reason, terms? }
r.post('/:uid/approve', async (c) => {
  try {
    const t = await answerable(c);
    if ('refused' in t) return t.refused;
    const key = String(t.request.program);
    const terms = approvalTerms(t.row.kind, key, t.b?.terms);
    if (!terms.ok) return c.json({ error: terms.error, message: terms.message, ...('errors' in terms ? { errors: terms.errors } : {}) }, 400);
    // What held when the studio asked may not hold now: a grant made, ended or switched off since.
    const still = await checkProgramRequest(c.env, t.licence.id, t.row.kind, t.request, 0);
    if (!still.ok) return c.json({ error: still.error, message: still.message }, 409);
    const draft = await draftOf(c.env, t.row.kind, { ...t.request, ...still.request }, terms.terms);
    return decide(c, t, 'answered', { action: 'request_approved', draft });
  } catch (e) { return mapError(c, e); }
});

// POST /api/admin/program-grants/requests/:uid/decline  { reason }
r.post('/:uid/decline', async (c) => {
  try {
    const t = await answerable(c);
    if ('refused' in t) return t.refused;
    if (t.b?.terms !== undefined) return c.json({ error: 'terms_not_for_kind', message: ANSWER_REFUSALS.terms_not_for_kind }, 400);
    return decide(c, t, 'declined', { action: 'request_declined' });
  } catch (e) { return mapError(c, e); }
});

export default r;
