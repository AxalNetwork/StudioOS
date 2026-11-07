/**
 * D4493 (#4493): Distribution outreach sequences, venture-scoped, and the public one-click opt-out. Nothing sends.
 *
 *   GET    /api/grow/sequences?project=                       the venture's sequences, with step and enrolment counts
 *   POST   /api/grow/sequences { project, name, campaign_uid?, steps? }   a draft sequence
 *   GET    /api/grow/sequences/due?project=                   dueSteps: per enrolment, the step it stands on and why
 *   POST   /api/grow/sequences/due/:enrolmentId/draft { project }   the composer draft for a due step; never the mail adapter
 *   GET    /api/grow/sequences/:uid?project=                  steps, enrolments with their state, consent by step
 *   PATCH  /api/grow/sequences/:uid { project, name?, state?, campaign_uid? }
 *   DELETE /api/grow/sequences/:uid { project }
 *   POST   /api/grow/sequences/:uid/steps { project, channel, wait_days, subject?, body? }   email or voice only
 *   PATCH  /api/grow/sequences/:uid/steps/:position { project, wait_days?, subject?, body? }
 *   DELETE /api/grow/sequences/:uid/steps/:position { project }
 *   PUT    /api/grow/sequences/:uid/steps/:position/recording   multipart: project, seconds, file (the founder's own recording)
 *   GET    /api/grow/sequences/:uid/steps/:position/recording?project=   the recording, for preview
 *   POST   /api/grow/sequences/:uid/enrol { project, contacts: [{ uid, time_zone? }] }
 *   GET    /api/grow/optout/:token                            public; records an `opted_out` suppression; reveals nothing
 *
 * Another venture's sequence, step or enrolment is 404. Reads follow Grow's
 * canAccessProject read gate; writes its write gate, as the campaign routes.
 * The send stays D1340's pressed `/api/mail/send`, one recipient per nonce.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { isSupportSession } from '../integrations/providers/mercury';
import { assertStorageRoom, noteStorageLanded } from '../services/storageRoom';
import {
  BLOCKED_REASONS, MAX_STEPS, OFFERED_CHANNELS, SEQUENCE_INTENT, SequenceRefused, VOICE_MAX_BYTES, VOICE_MIME,
  addDays, dueSteps, optoutLine, readOptoutToken, recordOptout, safeName, sequencePerson, stopStatement, validTimeZone, voicePrefix,
} from '../services/distribution/sequences';

const router = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;
type Body = Record<string, unknown>;
const UID = /^[0-9a-f]{32}$/;
const newUid = () => crypto.randomUUID().replace(/-/g, '');
const bad = (sentence: string, field?: string): never => { throw new SequenceRefused(400, sentence, field); };
const missing = (what = 'sequence'): never => { throw new SequenceRefused(404, `No such ${what}.`); };

async function access(c: C, user: User, raw: unknown, write: boolean) {
  if (!/^[1-9]\d{0,9}$/.test(String(raw ?? ''))) throw new SequenceRefused(400, 'Choose a venture.', 'project');
  const p = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(Number(raw)).first<{ id: number; founder_id: number | null }>();
  if (!p) throw new SequenceRefused(404, 'No such venture.');
  if (!(await canAccessProject(c.env, user, p, { write }))) throw new SequenceRefused(403, write ? 'You can read this venture but not change it.' : 'You cannot read this venture.');
  return p.id;
}
type Handler = (c: C, user: User, pid: number, b: Body) => Promise<unknown>;
const handle = (write: boolean, fn: Handler, created = false, form = false) => async (c: C) => {
  try {
    const user = await requireAuth(c);
    let b: Body | null = {};
    if (form) {
      const f = await c.req.formData().catch(() => null);
      b = f ? Object.fromEntries([...f.keys()].map((k) => [k, f.get(k)])) : null;
    } else if (write) b = await c.req.json().catch(() => null);
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new SequenceRefused(400, 'Send the form fields.');
    const pid = await access(c, user, write ? b.project ?? c.req.query('project') : c.req.query('project'), write);
    const out = await fn(c, user, pid, b);
    return out instanceof Response ? out : c.json(out as any, created ? 201 : 200);
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof SequenceRefused) return c.json({ detail: error.sentence, code: error.code, ...(error.field ? { field: error.field } : {}) }, error.status as any);
    if (error instanceof Error && error.message === 'Unauthorized') return c.json({ detail: 'Sign in to continue.' }, 401);
    return c.json({ detail: write ? 'The sequence could not be saved. Reload before trying again.' : 'Sequences could not be read. Try again.' }, 503);
  }
};
const audit = (env: Env, pid: number, user: User, action: string, details: object) =>
  env.DB.prepare('INSERT INTO activity_logs(user_id, project_id, action, details) VALUES (?, ?, ?, ?)').bind(user.id, pid, action, JSON.stringify(details));

type SeqRow = { id: number; uid: string; name: string; state: string; campaign_uid: string | null; created_at: string; updated_at: string };
async function sequenceOf(env: Env, pid: number, uid: string): Promise<SeqRow> {
  if (!UID.test(uid)) return missing();
  const row = await env.DB.prepare(`SELECT s.id, s.uid, s.name, s.state, g.uid AS campaign_uid, s.created_at, s.updated_at FROM outreach_sequences s
    LEFT JOIN grow_campaigns g ON g.id = s.campaign_id AND g.project_id = s.project_id WHERE s.uid = ? AND s.project_id = ?`).bind(uid, pid).first<SeqRow>();
  return row ?? missing();
}
async function campaignId(env: Env, pid: number, uid: unknown): Promise<number | null> {
  if (uid == null || uid === '') return null;
  if (typeof uid !== 'string' || uid.length > 80) return bad('Choose a campaign of this venture.', 'campaign_uid');
  const row = await env.DB.prepare('SELECT id FROM grow_campaigns WHERE uid = ? AND project_id = ? AND archived_at IS NULL').bind(uid, pid).first<{ id: number }>();
  return row?.id ?? missing('campaign');
}
const name = (v: unknown) => typeof v === 'string' && v.trim() && v.trim().length <= 120 ? v.trim() : bad('Name the sequence in up to 120 characters.', 'name');
const optional = (v: unknown, max: number, field: string) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length > max) return bad(`Keep this to ${max} characters.`, field);
  if (field === 'subject' && /[\r\n]/.test(v)) return bad('Write the subject on one line.', field);
  return v.trim() || null;
};
const waitDays = (v: unknown, first: boolean) => {
  const n = v == null || v === '' ? (first ? 0 : 3) : Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 60 ? n : bad('Wait between 0 and 60 days.', 'wait_days');
};
/** A step is buildable only on an offered channel; the others answer their fixed reason. */
function offered(channel: unknown): 'email' | 'voice' {
  if ((OFFERED_CHANNELS as readonly unknown[]).includes(channel)) return channel as 'email' | 'voice';
  if (Object.hasOwn(BLOCKED_REASONS, String(channel))) return bad(BLOCKED_REASONS[channel as keyof typeof BLOCKED_REASONS], 'channel');
  if (channel === 'sms') return bad('There is no SMS step.', 'channel');
  return bad('Choose email or a voice note.', 'channel');
}

async function detail(env: Env, pid: number, uid: string, now = new Date()) {
  const s = await sequenceOf(env, pid, uid);
  const [steps, due, settings, suppressions] = await Promise.all([
    env.DB.prepare('SELECT position, channel, wait_days, subject, body, recording_asset, recording_seconds, updated_at FROM outreach_steps WHERE sequence_id = ? ORDER BY position').bind(s.id).all<any>(),
    dueSteps(env, pid, { sequenceUid: s.uid, now }),
    env.DB.prepare('SELECT quiet_from, quiet_to FROM venture_outreach_settings WHERE project_id = ?').bind(pid).first<{ quiet_from: string; quiet_to: string }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM venture_suppressions WHERE project_id = ?').bind(pid).first<{ n: number }>(),
  ]);
  const list = steps.results ?? [];
  const ids = JSON.stringify(due.enrolments.map((e) => e.contact_id));
  const consents = await env.DB.prepare('SELECT contact_id, channel, basis FROM contact_marketing_consents WHERE contact_id IN (SELECT value FROM json_each(?))').bind(ids).all<{ contact_id: number; channel: string; basis: string }>();
  const basis = new Map((consents.results ?? []).map((r) => [`${r.contact_id}:${r.channel}`, r.basis]));
  const pill = (contact: number, channel: string) => {
    if (Object.hasOwn(BLOCKED_REASONS, channel)) return 'blocked';
    const email = basis.get(`${contact}:email`);
    if (email !== 'opted_in' && email !== 'wrote_first') return 'none';
    if (channel === 'voice') { const v = basis.get(`${contact}:voice`); return v === 'opted_in' || v === 'wrote_first' ? v : 'none'; }
    return email;
  };
  const enrolments = due.enrolments.map((e, i) => ({ ...due.rows[i], consent: list.map((st) => ({ position: st.position, channel: st.channel, basis: pill(e.contact_id, st.channel) })) }));
  return {
    sequence: { uid: s.uid, name: s.name, state: s.state, campaign_uid: s.campaign_uid, created_at: s.created_at, updated_at: s.updated_at },
    steps: list.map((st) => ({
      position: st.position, channel: st.channel, wait_days: st.wait_days, subject: st.subject, body: st.body, updated_at: st.updated_at,
      recording: st.recording_asset ? { seconds: st.recording_seconds ?? null } : null,
      blocked_reason: Object.hasOwn(BLOCKED_REASONS, st.channel) ? BLOCKED_REASONS[st.channel as keyof typeof BLOCKED_REASONS] : null,
    })),
    enrolments,
    counts: { enrolled: enrolments.length, due: due.due, stopped: enrolments.filter((e) => e.state.startsWith('stopped_')).length },
    quiet_hours: settings ?? null, quiet_reason: settings ? null : 'Not recorded: quiet hours have not been saved.',
    suppressions: Number.isSafeInteger(suppressions?.n) ? suppressions!.n : null,
  };
}

router.get('/', handle(false, async (c, _u, pid) => {
  const rows = await c.env.DB.prepare(`SELECT s.uid, s.name, s.state, s.updated_at,
      (SELECT COUNT(*) FROM outreach_steps t WHERE t.sequence_id = s.id) AS steps,
      (SELECT COUNT(*) FROM outreach_enrolments e WHERE e.sequence_id = s.id) AS enrolled
    FROM outreach_sequences s WHERE s.project_id = ? ORDER BY s.updated_at DESC, s.id DESC LIMIT 100`).bind(pid).all();
  return { sequences: rows.results ?? [] };
}));

router.post('/', handle(true, async (c, user, pid, b) => {
  const uid = newUid();
  const campaign = await campaignId(c.env, pid, b.campaign_uid);
  const steps = b.steps == null ? [] : Array.isArray(b.steps) && b.steps.length <= MAX_STEPS ? b.steps : bad(`A sequence has at most ${MAX_STEPS} steps.`, 'steps');
  const statements = [c.env.DB.prepare('INSERT INTO outreach_sequences(uid, project_id, campaign_id, name, state, created_by) VALUES (?, ?, ?, ?, ?, ?)').bind(uid, pid, campaign, name(b.name), 'draft', user.id)];
  steps.forEach((raw: any, i: number) => {
    if (!raw || typeof raw !== 'object') bad('Describe each step.', 'steps');
    statements.push(c.env.DB.prepare('INSERT INTO outreach_steps(sequence_id, position, channel, wait_days, subject, body) SELECT id, ?, ?, ?, ?, ? FROM outreach_sequences WHERE uid = ? AND project_id = ?')
      .bind(i + 1, offered(raw.channel), waitDays(raw.wait_days, i === 0), optional(raw.subject, 200, 'subject'), optional(raw.body, 4000, 'body'), uid, pid));
  });
  statements.push(audit(c.env, pid, user, 'grow.sequence.create', { uid }));
  await c.env.DB.batch(statements);
  return detail(c.env, pid, uid);
}, true));

router.get('/due', handle(false, async (c, _u, pid) => {
  const due = await dueSteps(c.env, pid);
  return { rows: due.rows, due: due.due, quiet_hours: due.quiet_hours };
}));

/** The composer's draft for one due step. It writes a `mail_drafts` row and nothing else; the founder presses Send. */
router.post('/due/:enrolmentId/draft', handle(true, async (c, user, pid) => {
  if (await isSupportSession(c)) throw new SequenceRefused(403, 'A support session cannot draft email in the member’s name.');
  const enrolment = c.req.param('enrolmentId') || '';
  if (!UID.test(enrolment)) return missing('enrolment');
  const due = await dueSteps(c.env, pid, { enrolmentUid: enrolment });
  const row = due.rows[0];
  if (!row) return missing('enrolment');
  if (row.state === 'stopped_replied' || row.state === 'stopped_optout') await stopStatement(c.env, enrolment, row.state).run();
  if (row.state !== 'due' || row.position == null) throw new SequenceRefused(409, row.reason ? `Not drafted: ${row.reason}` : 'This step is not due.', undefined, 'not_due');
  const e = due.enrolments[0];
  const step = await c.env.DB.prepare('SELECT channel, subject, body, recording_asset, recording_seconds FROM outreach_steps WHERE sequence_id = ? AND position = ?')
    .bind(e.sequence_id, row.position).first<{ channel: string; subject: string; body: string | null; recording_asset: string | null; recording_seconds: number | null }>();
  if (!step) return missing('step');
  const person = sequencePerson(enrolment, row.position);
  const existing = await c.env.DB.prepare('SELECT uid, subject, body, attachment_key, required_line FROM mail_drafts WHERE user_id = ? AND person_ref = ? AND intent = ? ORDER BY id DESC LIMIT 1')
    .bind(user.id, person, SEQUENCE_INTENT).first<{ uid: string; subject: string; body: string; attachment_key: string | null; required_line: string }>();
  const view = (d: { uid: string; subject: string; body: string; attachment_key: string | null; required_line: string }) => ({
    draft: { uid: d.uid, to: String(e.email).trim().toLowerCase(), name: safeName(e.contact_name), subject: d.subject, body: d.body, required_line: d.required_line,
      channel: step.channel, attachment: d.attachment_key ? { kind: 'voice_note', seconds: step.recording_seconds ?? null } : null, position: row.position },
  });
  if (existing) return view(existing);
  const line = await optoutLine(c.env, e.contact_uid);
  const text = [step.body?.trim(), step.channel === 'voice' ? 'My voice note is attached.' : null, line].filter(Boolean).join('\n\n');
  const uid = newUid();
  const made = { uid, subject: step.subject, body: text, attachment_key: step.channel === 'voice' ? step.recording_asset : null, required_line: line };
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO mail_drafts (uid, user_id, person_ref, intent, tone, length, refs_json, blocks_json, subject, body, attachment_key, required_line)
      VALUES (?, ?, ?, ?, 'direct', 'short', '[]', '[]', ?, ?, ?, ?)`).bind(uid, user.id, person, SEQUENCE_INTENT, made.subject, made.body, made.attachment_key, made.required_line),
    audit(c.env, pid, user, 'grow.sequence.draft', { enrolment, position: row.position }),
  ]);
  return view(made);
}, true));

router.get('/:uid', handle(false, (c, _u, pid) => detail(c.env, pid, c.req.param('uid') || '')));

router.patch('/:uid', handle(true, async (c, user, pid, b) => {
  const s = await sequenceOf(c.env, pid, c.req.param('uid') || '');
  const state = b.state == null ? s.state : ['draft', 'active', 'paused'].includes(String(b.state)) ? String(b.state) : bad('Choose draft, active or paused.', 'state');
  if (state === 'active') {
    const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM outreach_steps WHERE sequence_id = ? AND channel IN ('email','voice')").bind(s.id).first<{ n: number }>();
    if (!Number(n?.n)) throw new SequenceRefused(409, 'Add an email or voice-note step before activating the sequence.', 'state');
  }
  const campaign = b.campaign_uid === undefined ? undefined : await campaignId(c.env, pid, b.campaign_uid);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE outreach_sequences SET name = ?, state = ?, campaign_id = CASE WHEN ? THEN ? ELSE campaign_id END, updated_at = datetime('now') WHERE id = ? AND project_id = ?")
      .bind(b.name === undefined ? s.name : name(b.name), state, campaign === undefined ? 0 : 1, campaign ?? null, s.id, pid),
    audit(c.env, pid, user, 'grow.sequence.update', { uid: s.uid, state }),
  ]);
  return detail(c.env, pid, s.uid);
}));

router.delete('/:uid', handle(true, async (c, user, pid) => {
  const s = await sequenceOf(c.env, pid, c.req.param('uid') || '');
  const keys = await c.env.DB.prepare('SELECT recording_asset FROM outreach_steps WHERE sequence_id = ? AND recording_asset IS NOT NULL').bind(s.id).all<{ recording_asset: string }>();
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM outreach_sequences WHERE id = ? AND project_id = ?').bind(s.id, pid), audit(c.env, pid, user, 'grow.sequence.delete', { uid: s.uid })]);
  for (const k of keys.results ?? []) { try { await c.env.FILES?.delete(k.recording_asset); } catch { /* an orphaned object is never served */ } }
  return { ok: true };
}));

async function stepOf(env: Env, sequenceId: number, raw: string) {
  if (!/^[1-9]\d?$/.test(raw)) return missing('step');
  const row = await env.DB.prepare('SELECT position, channel, recording_asset, recording_mime FROM outreach_steps WHERE sequence_id = ? AND position = ?').bind(sequenceId, Number(raw))
    .first<{ position: number; channel: string; recording_asset: string | null; recording_mime: string | null }>();
  return row ?? missing('step');
}

router.post('/:uid/steps', handle(true, async (c, user, pid, b) => {
  const s = await sequenceOf(c.env, pid, c.req.param('uid') || '');
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM outreach_steps WHERE sequence_id = ?').bind(s.id).first<{ n: number }>();
  const n = Number(count?.n ?? 0);
  if (n >= MAX_STEPS) bad(`A sequence has at most ${MAX_STEPS} steps.`, 'steps');
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO outreach_steps(sequence_id, position, channel, wait_days, subject, body) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(s.id, n + 1, offered(b.channel), waitDays(b.wait_days, n === 0), optional(b.subject, 200, 'subject'), optional(b.body, 4000, 'body')),
    c.env.DB.prepare("UPDATE outreach_sequences SET updated_at = datetime('now') WHERE id = ?").bind(s.id),
    audit(c.env, pid, user, 'grow.sequence.step.add', { uid: s.uid, position: n + 1 }),
  ]);
  return detail(c.env, pid, s.uid);
}, true));

router.patch('/:uid/steps/:position', handle(true, async (c, user, pid, b) => {
  const s = await sequenceOf(c.env, pid, c.req.param('uid') || '');
  const st = await stepOf(c.env, s.id, c.req.param('position') || '');
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE outreach_steps SET wait_days = CASE WHEN ? THEN ? ELSE wait_days END, subject = CASE WHEN ? THEN ? ELSE subject END,
      body = CASE WHEN ? THEN ? ELSE body END, updated_at = datetime('now') WHERE sequence_id = ? AND position = ?`)
      .bind(b.wait_days === undefined ? 0 : 1, b.wait_days === undefined ? 0 : waitDays(b.wait_days, st.position === 1),
        b.subject === undefined ? 0 : 1, b.subject === undefined ? null : optional(b.subject, 200, 'subject'),
        b.body === undefined ? 0 : 1, b.body === undefined ? null : optional(b.body, 4000, 'body'), s.id, st.position),
    audit(c.env, pid, user, 'grow.sequence.step.update', { uid: s.uid, position: st.position }),
  ]);
  return detail(c.env, pid, s.uid);
}));

router.delete('/:uid/steps/:position', handle(true, async (c, user, pid) => {
  const s = await sequenceOf(c.env, pid, c.req.param('uid') || '');
  const st = await stepOf(c.env, s.id, c.req.param('position') || '');
  // Later steps move down one at a time, in order, so UNIQUE(sequence_id, position) holds at every statement.
  const moves = [];
  for (let p = st.position + 1; p <= MAX_STEPS; p++) moves.push(c.env.DB.prepare('UPDATE outreach_steps SET position = ? WHERE sequence_id = ? AND position = ?').bind(p - 1, s.id, p));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM outreach_steps WHERE sequence_id = ? AND position = ?').bind(s.id, st.position),
    ...moves,
    audit(c.env, pid, user, 'grow.sequence.step.remove', { uid: s.uid, position: st.position }),
  ]);
  if (st.recording_asset) { try { await c.env.FILES?.delete(st.recording_asset); } catch { /* never served once unlinked */ } }
  return detail(c.env, pid, s.uid);
}));

/** The founder's own recording only (owner answer F). There is no text-to-speech path. */
router.put('/:uid/steps/:position/recording', handle(true, async (c, user, pid, b) => {
  const s = await sequenceOf(c.env, pid, c.req.param('uid') || '');
  const st = await stepOf(c.env, s.id, c.req.param('position') || '');
  if (st.channel !== 'voice') bad('Only a voice-note step takes a recording.', 'file');
  const file = b.file && typeof b.file === 'object' && 'arrayBuffer' in (b.file as object) ? b.file as File : null;
  if (!file) bad('Record your voice note first.', 'file');
  const mime = String(file!.type || '').toLowerCase().split(';')[0].trim();
  const ext = VOICE_MIME[mime];
  if (!ext) throw new SequenceRefused(415, 'A voice note is a WebM, Ogg, MP4 or MP3 recording.', 'file');
  if (!file!.size || file!.size > VOICE_MAX_BYTES) throw new SequenceRefused(413, 'A voice note is 2 MB at most. Record a shorter one.', 'file');
  const seconds = Number(b.seconds);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) bad('A voice note is 1 to 300 seconds long.', 'seconds');
  if (!c.env.FILES) throw new SequenceRefused(503, 'File storage is not configured.', 'file');
  const key = `${voicePrefix(pid)}${newUid()}.${ext}`;
  const ticket = await assertStorageRoom(c.env, { projectId: pid }, file!.size, user);
  await c.env.FILES.put(key, await file!.arrayBuffer(), { httpMetadata: { contentType: mime }, customMetadata: { project_id: String(pid) } });
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE outreach_steps SET recording_asset = ?, recording_mime = ?, recording_bytes = ?, recording_seconds = ?, updated_at = datetime('now') WHERE sequence_id = ? AND position = ? AND channel = 'voice'")
        .bind(key, mime, file!.size, seconds, s.id, st.position),
      audit(c.env, pid, user, 'grow.sequence.recording', { uid: s.uid, position: st.position, seconds }),
    ]);
  } catch (error) { try { await c.env.FILES.delete(key); } catch { /* orphaned, never served */ } throw error; }
  if (st.recording_asset) { try { await c.env.FILES.delete(st.recording_asset); } catch { /* the old take is unlinked */ } }
  await noteStorageLanded(c.env, ticket);
  return detail(c.env, pid, s.uid);
}, false, true));

router.get('/:uid/steps/:position/recording', handle(false, async (c, _u, pid) => {
  const s = await sequenceOf(c.env, pid, c.req.param('uid') || '');
  const st = await stepOf(c.env, s.id, c.req.param('position') || '');
  if (!st.recording_asset || !st.recording_asset.startsWith(voicePrefix(pid))) return missing('recording');
  const obj = await c.env.FILES?.get(st.recording_asset);
  if (!obj) return missing('recording');
  return new Response(obj.body, { headers: { 'content-type': st.recording_mime || 'application/octet-stream', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}));

router.post('/:uid/enrol', handle(true, async (c, user, pid, b) => {
  const s = await sequenceOf(c.env, pid, c.req.param('uid') || '');
  if (!Array.isArray(b.contacts) || !b.contacts.length || b.contacts.length > 200) bad('Choose between 1 and 200 prospects.', 'contacts');
  const first = await c.env.DB.prepare('SELECT wait_days FROM outreach_steps WHERE sequence_id = ? ORDER BY position LIMIT 1').bind(s.id).first<{ wait_days: number }>();
  const due = addDays(new Date(), first?.wait_days ?? 0);
  const asked = (b.contacts as unknown[]).map((raw: any) => {
    const uid = typeof raw === 'string' ? raw : raw?.uid;
    if (typeof uid !== 'string' || !UID.test(uid)) return bad('Choose prospects of this venture.', 'contacts');
    const tz = raw?.time_zone == null || raw.time_zone === '' ? null : validTimeZone(raw.time_zone) ?? bad('Choose a real time zone, such as Europe/Paris.', 'time_zone');
    return { uid, tz };
  });
  // Only this venture's customer contacts resolve; another venture's uid enrols nothing.
  const own = await c.env.DB.prepare("SELECT id, uid FROM contacts WHERE project_id = ? AND audience = 'customer' AND uid IN (SELECT value FROM json_each(?))")
    .bind(pid, JSON.stringify(asked.map((a) => a.uid))).all<{ id: number; uid: string }>();
  const idOf = new Map((own.results ?? []).map((r) => [r.uid, r.id]));
  const statements = asked.filter((a) => idOf.has(a.uid)).map((a) => c.env.DB.prepare(`INSERT INTO outreach_enrolments(uid, sequence_id, contact_id, current_step, state, next_due_at, recipient_tz, enrolled_by)
      VALUES (?, ?, ?, 1, 'active', ?, ?, ?)
      ON CONFLICT(sequence_id, contact_id) DO UPDATE SET recipient_tz = COALESCE(excluded.recipient_tz, outreach_enrolments.recipient_tz), updated_at = datetime('now')`)
    .bind(newUid(), s.id, idOf.get(a.uid)!, due, a.tz, user.id));
  const results = await c.env.DB.batch([...statements, audit(c.env, pid, user, 'grow.sequence.enrol', { uid: s.uid, count: statements.length })]);
  const enrolled = results.slice(0, statements.length).filter((r) => Number(r.meta?.changes ?? 0) > 0).length;
  return { enrolled, ...(await detail(c.env, pid, s.uid)) };
}));

// ── Public opt-out ─────────────────────────────────────────────────────────
// Mounted at its own path, so no sign-in route above can take it. The answer
// is the same fixed sentence for every valid token and names nobody; a forged
// or unknown token is 404. Like the newsletter's unsubscribe it has no bucket
// of its own (a capped opt-out is an opt-out lost); the general per-IP cap applies.
const optout = new Hono<{ Bindings: Env }>();
const OPTED_OUT = 'You are unsubscribed. You will not receive further messages from this sender’s sequences.';
optout.get('/:token', async (c) => {
  try {
    const contact = await readOptoutToken(c.env, c.req.param('token'));
    if (!contact || !(await recordOptout(c.env, contact))) return c.json({ detail: 'Not found.' }, 404);
    const html = (c.req.header('accept') || '').includes('text/html');
    const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' };
    if (!html) return c.json({ ok: true, message: OPTED_OUT }, 200, headers);
    return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 16px"><p>${OPTED_OUT}</p></body></html>`, 200, headers);
  } catch {
    return c.json({ detail: 'The opt-out could not be recorded. Open the link again.' }, 503);
  }
});

export const mount = [
  { path: '/api/grow/sequences', router: router },
  { path: '/api/grow/optout', router: optout },
];
export { optout as optoutRouter };
export default router;
