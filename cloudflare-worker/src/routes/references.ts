/**
 * T14 — Reference checks (port of backend/app/api/routes/references.py).
 * Mounted at /api/references. Admin / investor only.
 *
 * D6735 (#6735) — deal access is required, and investors read their own
 * checks and those recorded under their verified active firm. Checks with
 * no recorded firm are private to the author and admins. Admins retain
 * deal-wide access. PATCH/DELETE still require the author or an admin (#2437).
 * A missing or unreadable reference returns the same 404.
 *
 * D6183 (#6183): the owner chose B. A reference call keeps typed notes, and
 * Eadwyn summarises those notes on press (`POST /:id/summarize`). There is no
 * audio: no recording upload or URL and no transcription, so those routes do
 * not exist (the 501 stubs are gone).
 */
import { DEFAULT_REFERENCE_CONSENT } from '../../../frontend/src/lib/referenceConsent.js';
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { isAdmin, isInvestor, mapError, nowIso, newUid } from './_t13t14t15_helpers';
import { userMayReadDeal } from './deals';
import { investorActiveCompany } from './_investorProjectScope';
import { logDealRoomAction } from '../services/dealRoomAudit';
import { run as runAI } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { railFor, refuseRun } from '../util/railContext';

const r = new Hono<{ Bindings: Env }>();

type Row = {
  id: number; uid: string; deal_id: number;
  reference_name: string; reference_email: string | null;
  reference_role: string | null; relationship: string | null;
  scheduled_at: string | null;
  consent_given: number; consent_given_at: string | null; consent_text: string | null;
  consent_captured_by: number | null;
  recording_file_key: string | null; recording_size_bytes: number | null;
  recording_content_type: string | null; recording_uploaded_at: string | null;
  transcript: string | null; transcribed_at: string | null;
  summary_json: string | null; summarized_at: string | null;
  status: string; notes: string | null;
  created_by: number | null; company_id: number | null; created_at: string; updated_at: string;
};

function gate(u: User) {
  if (!(isAdmin(u) || isInvestor(u))) throw new Error('Forbidden');
}

/** A positive whole number, or null. */
function idOf(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Apply the same per-row scope as the list before applying deal access.
 */
async function loadReference(c: Context<{ Bindings: Env }>, user: User, rawId: string): Promise<Row | null> {
  const id = idOf(rawId);
  if (!id) return null;
  const row = isAdmin(user)
    ? await c.env.DB.prepare('SELECT * FROM reference_checks WHERE id = ?').bind(id).first<Row>()
    : await c.env.DB.prepare(
      'SELECT * FROM reference_checks WHERE id = ? AND (created_by = ? OR company_id = ?)',
    ).bind(id, user.id, await investorActiveCompany(c, user)).first<Row>();
  if (!row) return null;
  return (await userMayReadDeal(c.env, user, Number(row.deal_id))) ? row : null;
}
const NOT_FOUND = { detail: 'Reference not found' };

function dto(r: Row, includeTranscript = false): any {
  let summary: any = null;
  if (r.summary_json) { try { summary = JSON.parse(r.summary_json); } catch { /* ignore */ } }
  const out: any = {
    id: r.id, uid: r.uid, deal_id: r.deal_id,
    reference_name: r.reference_name, reference_email: r.reference_email,
    reference_role: r.reference_role, relationship: r.relationship,
    scheduled_at: r.scheduled_at,
    consent_given: !!r.consent_given, consent_given_at: r.consent_given_at,
    consent_text: r.consent_text,
    has_recording: !!r.recording_file_key,
    recording_size_bytes: r.recording_size_bytes,
    recording_content_type: r.recording_content_type,
    recording_uploaded_at: r.recording_uploaded_at,
    has_transcript: !!r.transcript, transcribed_at: r.transcribed_at,
    summary, summarized_at: r.summarized_at,
    // D6183: the notes changed after the summary was written, so it may no longer match them.
    summary_stale: !!summary && typeof summary.notes_digest === 'string' && summary.notes_digest !== notesDigest(r.notes),
    status: r.status, notes: r.notes,
    created_at: r.created_at, updated_at: r.updated_at,
  };
  if (includeTranscript) out.transcript = r.transcript;
  return out;
}

r.post('/', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const body = await c.req.json().catch(() => ({} as any));
    const dealId = idOf(body.deal_id);
    if (!dealId) return c.json({ detail: 'deal_id required' }, 400);
    // A missing deal and one the caller may not open answer alike.
    if (!(await userMayReadDeal(c.env, user, dealId))) return c.json({ detail: 'Deal not found' }, 404);
    const name = String(body.reference_name || '').trim();
    if (!name) return c.json({ detail: 'reference_name required' }, 400);
    const consent = !!body.consent_given;
    const uid = newUid();
    const companyId = isAdmin(user) ? null : await investorActiveCompany(c, user);
    const ins = await c.env.DB.prepare(
      `INSERT INTO reference_checks
        (uid, deal_id, reference_name, reference_email, reference_role, relationship,
         scheduled_at, consent_given, consent_given_at, consent_text, consent_captured_by,
         status, notes, created_by, created_at, updated_at, company_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?)`
    ).bind(uid, dealId, name.slice(0, 200),
           body.reference_email || null, body.reference_role || null, body.relationship || null,
           body.scheduled_at || null,
           consent ? 1 : 0, consent ? nowIso() : null,
           consent ? (body.consent_text || DEFAULT_REFERENCE_CONSENT) : null,
           consent ? user.id : null,
           body.notes || null, user.id, nowIso(), nowIso(), companyId).run();
    const row = await c.env.DB.prepare('SELECT * FROM reference_checks WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<Row>();
    await logDealRoomAction(c.env, user, 'reference_scheduled', dealId, { reference_id: row?.id });
    return c.json(dto(row!));
  } catch (e) { return mapError(c, e); }
});

r.get('/', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const dealId = idOf(c.req.query('deal_id'));
    if (!dealId) return c.json({ error: 'deal_id_required', detail: 'List the reference checks of one deal: deal_id is required.' }, 400);
    if (!(await userMayReadDeal(c.env, user, dealId))) return c.json({ detail: 'Deal not found' }, 404);
    const admin = isAdmin(user);
    const result = admin
      ? await c.env.DB.prepare('SELECT * FROM reference_checks WHERE deal_id = ? ORDER BY created_at DESC').bind(dealId).all<Row>()
      : await c.env.DB.prepare(
        'SELECT * FROM reference_checks WHERE deal_id = ? AND (created_by = ? OR company_id = ?) ORDER BY created_at DESC',
      ).bind(dealId, user.id, await investorActiveCompany(c, user)).all<Row>();
    const rows = result.results || [];
    // A truly empty list and a list with only hidden rows must answer alike.
    if (!admin && rows.length === 0) return c.json({ ...NOT_FOUND, error: 'no_visible_references' }, 404);
    return c.json(rows.map((row) => dto(row)));
  } catch (e) { return mapError(c, e); }
});

r.get('/:id', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const row = await loadReference(c, user, c.req.param('id'));
    if (!row) return c.json(NOT_FOUND, 404);
    return c.json(dto(row, true));
  } catch (e) { return mapError(c, e); }
});

r.patch('/:id', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const row = await loadReference(c, user, c.req.param('id'));
    if (!row) return c.json(NOT_FOUND, 404);
    if (user.role !== 'admin' && Number(row.created_by) !== user.id) return c.json({ detail: 'Forbidden' }, 403);
    const id = row.id;
    const body = await c.req.json().catch(() => ({} as any));
    const fields = ['reference_email', 'reference_role', 'relationship', 'scheduled_at', 'notes', 'status'] as const;
    const sets: string[] = []; const params: any[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) { sets.push(`${f} = ?`); params.push(body[f]); }
    }
    if (!sets.length) return c.json(dto(row, true));
    sets.push('updated_at = ?'); params.push(nowIso()); params.push(id);
    await c.env.DB.prepare(`UPDATE reference_checks SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
    await logDealRoomAction(c.env, user, 'reference_updated', Number(row.deal_id), {
      reference_id: id, fields: fields.filter((f) => body[f] !== undefined),
    });
    const fresh = await c.env.DB.prepare('SELECT * FROM reference_checks WHERE id = ?').bind(id).first<Row>();
    return c.json(dto(fresh!, true));
  } catch (e) { return mapError(c, e); }
});

r.delete('/:id', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const row = await loadReference(c, user, c.req.param('id'));
    if (!row) return c.json(NOT_FOUND, 404);
    if (user.role !== 'admin' && Number(row.created_by) !== user.id) return c.json({ detail: 'Forbidden' }, 403);
    const id = row.id;
    await c.env.DB.prepare('DELETE FROM reference_checks WHERE id = ?').bind(id).run();
    await logDealRoomAction(c.env, user, 'reference_deleted', Number(row.deal_id), { reference_id: id });
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

r.post('/:id/consent', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const row = await loadReference(c, user, c.req.param('id'));
    if (!row) return c.json(NOT_FOUND, 404);
    const id = row.id;
    const body = await c.req.json().catch(() => ({} as any));
    const give = !!body.consent_given;
    if (give) {
      await c.env.DB.prepare(
        `UPDATE reference_checks SET consent_given=1, consent_given_at=?, consent_text=?, consent_captured_by=?, updated_at=? WHERE id = ?`
      ).bind(nowIso(), body.consent_text || DEFAULT_REFERENCE_CONSENT, user.id, nowIso(), id).run();
    } else {
      // Withdraw consent → wipe transcript/summary metadata. Worker has no R2
      // file deletion here (recording upload is unavailable in the worker
      // port), so we simply clear DB pointers.
      await c.env.DB.prepare(
        `UPDATE reference_checks SET consent_given=0, consent_given_at=NULL, consent_text=NULL,
           consent_captured_by=NULL, recording_file_key=NULL, recording_size_bytes=NULL,
           recording_content_type=NULL, recording_uploaded_at=NULL, transcript=NULL,
           transcribed_at=NULL, summary_json=NULL, summarized_at=NULL,
           status='scheduled', updated_at=? WHERE id = ?`
      ).bind(nowIso(), id).run();
    }
    await logDealRoomAction(c.env, user, give ? 'reference_consent_given' : 'reference_consent_withdrawn', Number(row.deal_id), { reference_id: id });
    const fresh = await c.env.DB.prepare('SELECT * FROM reference_checks WHERE id = ?').bind(id).first<Row>();
    return c.json(dto(fresh!));
  } catch (e) { return mapError(c, e); }
});

/** The model runner, replaced in tests so no test reaches a provider. */
export const summaryDeps = { run: runAI };

/** Notes shorter than this are not worth a charged run; the member is told why. */
export const MIN_NOTES_CHARS = 40;
const MAX_NOTES_CHARS = 12_000;

const SUMMARY_PROMPT = [
  'You summarise an investor\'s own notes from a reference call about a startup founder.',
  'Use only what the notes say. Never add facts, names or judgements the notes do not contain.',
  'Answer with JSON only: {"summary": string (2-4 sentences), "strengths": string[], "concerns": string[]}.',
  'Each list item is one short phrase taken from the notes. An empty list is fine.',
].join(' ');

/** A non-cryptographic fingerprint of the notes, to tell whether a summary still matches them. */
function notesDigest(notes: string | null): string {
  const s = String(notes ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${s.length}:${(h >>> 0).toString(16)}`;
}

/** The model's JSON, held to its shape; anything else is null and nothing is stored. */
export function parseSummary(raw: string): { summary: string; strengths: string[]; concerns: string[] } | null {
  const m = String(raw ?? '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let v: any;
  try { v = JSON.parse(m[0]); } catch { return null; }
  if (!v || typeof v.summary !== 'string' || !v.summary.trim()) return null;
  const list = (x: unknown) => (Array.isArray(x) ? x : []).filter((s): s is string => typeof s === 'string' && !!s.trim())
    .map((s) => s.trim().slice(0, 200)).slice(0, 6);
  return { summary: v.summary.trim().slice(0, 1200), strengths: list(v.strengths), concerns: list(v.concerns) };
}

// D6183: Eadwyn summarises the typed notes, on press, for the reference's author or an admin.
r.post('/:id/summarize', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const row = await loadReference(c, user, c.req.param('id'));
    if (!row) return c.json(NOT_FOUND, 404);
    if (user.role !== 'admin' && Number(row.created_by) !== user.id) return c.json({ detail: 'Forbidden' }, 403);
    const notes = String(row.notes ?? '').trim();
    if (notes.length < MIN_NOTES_CHARS) {
      return c.json({ code: 'notes_required', detail: `Write at least ${MIN_NOTES_CHARS} characters of notes from the call first. Eadwyn summarises your notes only.` }, 409);
    }
    const out = await summaryDeps.run(c.env, {
      task: 'workspace_explain', userId: user.id, systemPrompt: SUMMARY_PROMPT,
      messages: [{ role: 'user', content: `Notes from the reference call:\n${notes.slice(0, MAX_NOTES_CHARS)}` }],
      maxTokens: 600, temperature: 0.1,
      surface: AI_SURFACE.dealReferences, rail: railFor(c, { page: 'Deal · References', option: 'summarise:reference-notes' }),
    });
    const refused = refuseRun(c, { refusal: out.refusal });
    if (refused) return refused;
    if (!out.ok) return c.json({ code: 'summary_unreadable', detail: 'Eadwyn could not summarise these notes. Try again.' }, 503);
    const parsed = parseSummary(String(out.output ?? ''));
    if (!parsed) return c.json({ code: 'summary_unreadable', detail: 'The summary could not be read, so it was not saved. The run may still be charged.' }, 503);
    const at = nowIso();
    const summary = { ...parsed, from: 'notes', model: out.usage?.model ?? null, notes_digest: notesDigest(row.notes) };
    await c.env.DB.prepare(
      "UPDATE reference_checks SET summary_json = ?, summarized_at = ?, status = CASE WHEN status = 'cancelled' THEN status ELSE 'summarized' END, updated_at = ? WHERE id = ?",
    ).bind(JSON.stringify(summary), at, at, row.id).run();
    await logDealRoomAction(c.env, user, 'reference_summarized', Number(row.deal_id), { reference_id: row.id });
    const fresh = await c.env.DB.prepare('SELECT * FROM reference_checks WHERE id = ?').bind(row.id).first<Row>();
    return c.json(dto(fresh!, true));
  } catch (e) { return mapError(c, e); }
});

export default r;
