/**
 * D6222 (#6222) — `/api/portfolio-notes`: an investor's private notes on a
 * portfolio company, over `investor_company_notes`
 * (migration 202611171211_6222_investor_company_notes.sql).
 *
 *   GET    /companies/:projectUid   the caller's own notes on one company, newest first
 *   POST   /companies/:projectUid   a new note ({ body, source?: 'what_changed',
 *                                    from_report_uid?, to_report_uid? })
 *   PUT    /:uid                    edit the body of the caller's own note ({ body })
 *   DELETE /:uid                    delete the caller's own note
 *
 * WHO. A note is the author's alone. Every statement is scoped by
 * `author_user_id = caller`, so another investor's note, and any note to the
 * company's founders, admins or advisors, is the same 404 as one that does
 * not exist. No response names a user.
 *
 * WHICH COMPANY. The caller reads or writes notes on a company only while it
 * is theirs on the company page: they are owed reports by it (a
 * `reporting_duties` row whose holder is the caller — the admission of
 * `GET /api/reporting/companies/:projectUid`, routes/reporting.ts), or they
 * hold it (`investorHeldProjectIds`, the holder scope of
 * `GET /api/positions`, in the caller's active company). Anyone else — a
 * founder, an admin who holds nothing, an investor with no holding there —
 * gets 404 `not_found`, the reporting read's answer.
 *
 * A SUPPORT SESSION reads what the investor would read (as the reporting
 * reads do) and writes nothing: each write is 403 `support_session_refused`,
 * and the list says so (`can_write`, `write_refusal`).
 *
 * The source of a note saved from Eadwyn's "What changed" names the two
 * reports it compared; each must be a report this company sent the caller
 * (`update_recipients`, audience investor), or the save is refused 409
 * `source_not_received`. Every statement is bound.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import { refuse } from '../util/refusal';
import { SUPPORT_SESSION_REFUSED_CODE, isSupportSession } from '../services/fundAdminAccess';
import { investorActiveCompany, investorHeldProjectIds } from './_investorProjectScope';
import type { RouteMount } from '../util/routeRegistry';

const r = new Hono<{ Bindings: Env }>();

class Refusal extends Error {
  status: number; code: string; sentence: string;
  constructor(status: number, code: string, sentence: string) { super(code); this.status = status; this.code = code; this.sentence = sentence; }
}

/** The sentence for each refusal this router gives, keyed by its code (the page keeps the same table). */
export const NOTE_REFUSALS = {
  not_found: 'No such company.',
  note_not_found: 'No such note.',
  invalid_note: 'Write a note of 1 to 10,000 characters.',
  invalid_source: 'A note saved from What changed names the two reports it compared.',
  source_not_received: 'Those reports are not ones this company sent you, so the note was not saved.',
  too_many_notes: 'You keep 500 notes on this company. Delete one to add another.',
  support_session_refused: 'A support session cannot write an investor’s notes.',
  notes_refused: 'This account cannot keep notes here.',
  notes_unreadable: 'Unreadable: your notes could not be read. Try again.',
  note_write_failed: 'The note could not be saved. Nothing was changed. Try again.',
} as const;
type Code = keyof typeof NOTE_REFUSALS;
const no = (status: number, code: Code) => new Refusal(status, code, NOTE_REFUSALS[code]);

const MAX_BODY = 10000;
const MAX_NOTES = 500;
const UID = /^[A-Za-z0-9_-]{1,64}$/;

r.onError((error: any, c: any) => {
  if (error instanceof Response) return error;
  if (error instanceof Refusal) return refuse(c, error.status, { code: error.code, message: error.sentence });
  const status = AUTH_ERROR_STATUSES[error?.message];
  if (status) return refuse(c, status, { code: 'notes_refused', message: NOTE_REFUSALS.notes_refused });
  const write = c.req.method !== 'GET';
  return refuse(c, 503, write
    ? { code: 'note_write_failed', message: NOTE_REFUSALS.note_write_failed, raw: error }
    : { code: 'notes_unreadable', message: NOTE_REFUSALS.notes_unreadable, raw: error });
});

const json = async (c: any) => {
  const parsed = await c.req.json().catch(() => null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};
const bodyOf = (b: any): string | null => {
  if (typeof b?.body !== 'string') return null;
  const text = b.body.trim();
  return text.length >= 1 && text.length <= MAX_BODY ? text : null;
};

/**
 * The company's id when the caller is owed reports by it or holds it; 404 otherwise.
 * Owed: the reporting read's own rule (`holder_user_id = caller`). Held: the positions holder scope.
 */
async function requireCompanyNoteAccess(c: any, user: User, projectUid: string): Promise<number> {
  if (!UID.test(projectUid)) throw no(404, 'not_found');
  const p = await c.env.DB.prepare('SELECT id FROM projects WHERE uid = ? AND deleted_at IS NULL').bind(projectUid).first() as { id: number } | null;
  if (!p) throw no(404, 'not_found');
  const pid = Number(p.id);
  const owed = await c.env.DB.prepare('SELECT 1 AS owed FROM reporting_duties WHERE project_id = ? AND holder_user_id = ? LIMIT 1')
    .bind(pid, Number(user.id)).first();
  if (owed) return pid;
  const held = await investorHeldProjectIds(c.env, user, await investorActiveCompany(c, user));
  // null is an operator's "every company": a holding is never inferred from a role.
  if (held && held.includes(pid)) return pid;
  throw no(404, 'not_found');
}

async function writable(c: any) {
  if (await isSupportSession(c)) throw no(403, SUPPORT_SESSION_REFUSED_CODE);
}

type NoteRow = {
  uid: string; body: string; source: string | null; from_report_uid: string | null; to_report_uid: string | null;
  created_at: string; updated_at: string;
};
const dto = (n: NoteRow) => ({
  uid: n.uid, body: n.body,
  source: n.source ? { kind: n.source, from_report_uid: n.from_report_uid, to_report_uid: n.to_report_uid } : null,
  created_at: n.created_at, updated_at: n.updated_at, edited: n.updated_at !== n.created_at,
});

r.get('/companies/:projectUid', async (c) => {
  const user = await requireAuth(c);
  c.header('Cache-Control', 'no-store');
  const pid = await requireCompanyNoteAccess(c, user, c.req.param('projectUid'));
  const rows = (await c.env.DB.prepare(
    `SELECT uid, body, source, from_report_uid, to_report_uid, created_at, updated_at FROM investor_company_notes WHERE author_user_id = ? AND project_id = ? ORDER BY id DESC LIMIT ?`,
  ).bind(Number(user.id), pid, MAX_NOTES).all<NoteRow>()).results || [];
  const support = await isSupportSession(c);
  return c.json({
    ok: true, items: rows.map(dto),
    can_write: !support, write_refusal: support ? NOTE_REFUSALS.support_session_refused : null,
  });
});

/** Both reports must be ones this company sent the caller, as an investor. */
async function sourceOf(c: any, user: User, pid: number, b: any) {
  if (b.source == null && b.from_report_uid == null && b.to_report_uid == null) return { source: null, from: null, to: null };
  const from = b.from_report_uid; const to = b.to_report_uid;
  if (b.source !== 'what_changed' || typeof from !== 'string' || typeof to !== 'string' || !UID.test(from) || !UID.test(to) || from === to) {
    throw no(400, 'invalid_source');
  }
  const got = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT u.uid) AS n FROM portfolio_updates u
      WHERE u.uid IN (?, ?) AND u.project_id = ? AND u.kind = 'report' AND u.sent_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM update_recipients x WHERE x.update_id = u.id AND x.user_id = ? AND x.audience = 'investor')`,
  ).bind(from, to, pid, Number(user.id)).first() as { n: number } | null;
  if (Number(got?.n ?? 0) !== 2) throw no(409, 'source_not_received');
  return { source: 'what_changed', from, to };
}

r.post('/companies/:projectUid', async (c) => {
  const user = await requireAuth(c);
  c.header('Cache-Control', 'no-store');
  await writable(c);
  const pid = await requireCompanyNoteAccess(c, user, c.req.param('projectUid'));
  const b = await json(c);
  const text = bodyOf(b);
  if (!text) throw no(400, 'invalid_note');
  const src = await sourceOf(c, user, pid, b);
  const uid = crypto.randomUUID().replace(/-/g, '');
  // The cap is held in the statement: the row is written only while the author keeps fewer than MAX_NOTES here.
  const done = await c.env.DB.prepare(
    `INSERT INTO investor_company_notes (uid, author_user_id, project_id, body, source, from_report_uid, to_report_uid)
     SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM investor_company_notes WHERE author_user_id = ? AND project_id = ?) < ?`,
  ).bind(uid, Number(user.id), pid, text, src.source, src.from, src.to, Number(user.id), pid, MAX_NOTES).run();
  if (!Number(done?.meta?.changes ?? 0)) throw no(409, 'too_many_notes');
  // The answer is the row as stored, read back.
  const row = await c.env.DB.prepare(`SELECT uid, body, source, from_report_uid, to_report_uid, created_at, updated_at FROM investor_company_notes WHERE uid = ? AND author_user_id = ?`)
    .bind(uid, Number(user.id)).first() as NoteRow | null;
  if (!row) throw no(503, 'note_write_failed');
  return c.json({ ok: true, note: dto(row) }, 201);
});

/** The caller's own note, or 404: another author's is the same answer as none. */
async function requireNoteOwner(c: any, user: User, uid: string) {
  if (!UID.test(uid)) throw no(404, 'note_not_found');
  const row = await c.env.DB.prepare('SELECT id, project_id FROM investor_company_notes WHERE uid = ? AND author_user_id = ?')
    .bind(uid, Number(user.id)).first() as { id: number; project_id: number } | null;
  if (!row) throw no(404, 'note_not_found');
  return row;
}

r.put('/:uid', async (c) => {
  const user = await requireAuth(c);
  c.header('Cache-Control', 'no-store');
  await writable(c);
  const note = await requireNoteOwner(c, user, c.req.param('uid'));
  const text = bodyOf(await json(c));
  if (!text) throw no(400, 'invalid_note');
  const done = await c.env.DB.prepare(
    `UPDATE investor_company_notes SET body = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND author_user_id = ?`,
  ).bind(text, note.id, Number(user.id)).run();
  if (!Number(done?.meta?.changes ?? 0)) throw no(404, 'note_not_found');
  const row = await c.env.DB.prepare(`SELECT uid, body, source, from_report_uid, to_report_uid, created_at, updated_at FROM investor_company_notes WHERE id = ? AND author_user_id = ?`)
    .bind(note.id, Number(user.id)).first() as NoteRow | null;
  if (!row) throw no(404, 'note_not_found');
  return c.json({ ok: true, note: dto(row) });
});

r.delete('/:uid', async (c) => {
  const user = await requireAuth(c);
  c.header('Cache-Control', 'no-store');
  await writable(c);
  const note = await requireNoteOwner(c, user, c.req.param('uid'));
  const done = await c.env.DB.prepare('DELETE FROM investor_company_notes WHERE id = ? AND author_user_id = ?')
    .bind(note.id, Number(user.id)).run();
  if (!Number(done?.meta?.changes ?? 0)) throw no(404, 'note_not_found');
  return c.json({ ok: true, deleted: true });
});

export default r;
export const mount: RouteMount = { path: '/api/portfolio-notes', router: r };
