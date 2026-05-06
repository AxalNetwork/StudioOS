/**
 * T14 — Reference checks (port of backend/app/api/routes/references.py).
 * Mounted at /api/references. Admin / investor only.
 *
 * SCOPE CUT (vs FastAPI): audio recording upload/download, transcription, and
 * AI summarization are STUBBED to 501 Not Implemented in this worker port.
 * The frontend will see the missing-recording state. Schedule + consent
 * capture + manual notes flow is fully functional.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { isAdmin, isInvestor, mapError, nowIso, newUid } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

const DEFAULT_CONSENT_TEXT =
  'I consent to this reference call being recorded, transcribed, and ' +
  'shared in summarised form with the Axal investment team for the ' +
  'purpose of evaluating this opportunity. I understand the recording ' +
  'will be retained securely and may be deleted on request.';

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
  created_by: number | null; created_at: string; updated_at: string;
};

function gate(u: User) {
  if (!(isAdmin(u) || isInvestor(u))) throw new Error('Forbidden');
}

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
    const dealId = Number(body.deal_id);
    if (!Number.isFinite(dealId)) return c.json({ detail: 'deal_id required' }, 400);
    const deal = await c.env.DB.prepare('SELECT id FROM deals WHERE id = ?').bind(dealId).first<{ id: number }>();
    if (!deal) return c.json({ detail: 'Deal not found' }, 404);
    const name = String(body.reference_name || '').trim();
    if (!name) return c.json({ detail: 'reference_name required' }, 400);
    const consent = !!body.consent_given;
    const uid = newUid();
    const ins = await c.env.DB.prepare(
      `INSERT INTO reference_checks
        (uid, deal_id, reference_name, reference_email, reference_role, relationship,
         scheduled_at, consent_given, consent_given_at, consent_text, consent_captured_by,
         status, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`
    ).bind(uid, dealId, name.slice(0, 200),
           body.reference_email || null, body.reference_role || null, body.relationship || null,
           body.scheduled_at || null,
           consent ? 1 : 0, consent ? nowIso() : null,
           consent ? (body.consent_text || DEFAULT_CONSENT_TEXT) : null,
           consent ? user.id : null,
           body.notes || null, user.id, nowIso(), nowIso()).run();
    const row = await c.env.DB.prepare('SELECT * FROM reference_checks WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<Row>();
    return c.json(dto(row!));
  } catch (e) { return mapError(c, e); }
});

r.get('/', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const dealId = c.req.query('deal_id');
    const sql = dealId
      ? 'SELECT * FROM reference_checks WHERE deal_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM reference_checks ORDER BY created_at DESC LIMIT 200';
    const rows = dealId
      ? await c.env.DB.prepare(sql).bind(Number(dealId)).all<Row>()
      : await c.env.DB.prepare(sql).all<Row>();
    return c.json((rows.results || []).map((r) => dto(r)));
  } catch (e) { return mapError(c, e); }
});

r.get('/:id', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare('SELECT * FROM reference_checks WHERE id = ?').bind(id).first<Row>();
    if (!row) return c.json({ detail: 'Reference not found' }, 404);
    return c.json(dto(row, true));
  } catch (e) { return mapError(c, e); }
});

r.patch('/:id', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare('SELECT * FROM reference_checks WHERE id = ?').bind(id).first<Row>();
    if (!row) return c.json({ detail: 'Reference not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const fields = ['reference_email', 'reference_role', 'relationship', 'scheduled_at', 'notes', 'status'] as const;
    const sets: string[] = []; const params: any[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) { sets.push(`${f} = ?`); params.push(body[f]); }
    }
    if (!sets.length) return c.json(dto(row, true));
    sets.push('updated_at = ?'); params.push(nowIso()); params.push(id);
    await c.env.DB.prepare(`UPDATE reference_checks SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM reference_checks WHERE id = ?').bind(id).first<Row>();
    return c.json(dto(fresh!, true));
  } catch (e) { return mapError(c, e); }
});

r.delete('/:id', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare('SELECT * FROM reference_checks WHERE id = ?').bind(id).first<Row>();
    if (!row) return c.json({ detail: 'Reference not found' }, 404);
    await c.env.DB.prepare('DELETE FROM reference_checks WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

r.post('/:id/consent', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare('SELECT * FROM reference_checks WHERE id = ?').bind(id).first<Row>();
    if (!row) return c.json({ detail: 'Reference not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const give = !!body.consent_given;
    if (give) {
      await c.env.DB.prepare(
        `UPDATE reference_checks SET consent_given=1, consent_given_at=?, consent_text=?, consent_captured_by=?, updated_at=? WHERE id = ?`
      ).bind(nowIso(), body.consent_text || DEFAULT_CONSENT_TEXT, user.id, nowIso(), id).run();
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
    const fresh = await c.env.DB.prepare('SELECT * FROM reference_checks WHERE id = ?').bind(id).first<Row>();
    return c.json(dto(fresh!));
  } catch (e) { return mapError(c, e); }
});

// Stubs (R2 + AI integration not in this worker port).
r.post('/:id/recording', (c) => c.json({ detail: 'Recording upload not yet supported in worker; use the FastAPI dev backend' }, 501));
r.get('/:id/recording-url', (c) => c.json({ detail: 'Recording URL not yet supported in worker' }, 501));
r.post('/:id/transcribe', (c) => c.json({ detail: 'Transcription not yet supported in worker' }, 501));
r.post('/:id/summarize', (c) => c.json({ detail: 'AI summarization not yet supported in worker' }, 501));

export default r;
