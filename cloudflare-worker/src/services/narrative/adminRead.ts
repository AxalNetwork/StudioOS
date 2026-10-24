/**
 * D914 (#2698), part 8 of #2454: what an admin is to a venture's Investor
 * narrative, and the two stores that follow from it (migration 545).
 *
 * The owner's answer to #2459 decision 3 for the narrative (2026-10-24):
 *   - an Admin on this deployment, or the Super Admin on HQ, reads the whole
 *     narrative read only and leaves notes for the founder;
 *   - every narrative write of theirs is refused (403 `admin_read_only`);
 *   - before the narrative opens they give a reason, which the founder sees.
 *     Their narrative reads for that venture are answered only while a reason
 *     of theirs is unexpired (`READ_REASON_HOURS`); otherwise they get 403
 *     `read_reason_required`, and a log that cannot be checked keeps the
 *     narrative closed (503), never open.
 *
 * The narrative's routes call `narrativeAdminGate` (`routes/cycle_raise.ts`,
 * and the investor-narrative records in `routes/cycle_records.ts`). It is
 * deliberately not in `_founder_validate_helpers.ts`'s `canWrite`, which the
 * rest of Raise shares. Founders and everyone else pass through unchanged:
 * the routes' own checks still decide them.
 *
 * Every reason given and every note posted writes one
 * `raise.investor-narrative` activity row in the same batch, naming neither
 * the reason's nor the note's words (D691 decision 12).
 */
import type { Env, User } from '../../types';
import { hydrateSuperAdmin, isSuperAdmin } from '../../auth';
import { logCycleWriteStatement } from '../cycleActivity';

export const READ_REASON_HOURS = 8;
export const REASON_MIN = 3;
export const REASON_MAX = 200;
export const NOTE_MAX = 2000;
export const LIST_MAX = 200;

export const ADMIN_READ_ONLY = 'An admin reads the narrative and leaves notes. Only the venture’s founders change it.';
export const REASON_REQUIRED = 'Give a reason for reading this narrative first. The founder sees it.';
export const REASON_UNREADABLE = 'The read log could not be checked, so the narrative stays closed. Try again in a moment.';

export type Mode = 'read' | 'write';
export type Kind = 'admin' | 'super_admin' | 'founder';

export const isAdmin = (user: Pick<User, 'role'>) => String(user?.role || '').toLowerCase() === 'admin';

/** What the caller is, for a note or a reason: the Super Admin on HQ, an admin, or (anyone else the route admitted) a founder. */
export async function kindOf(env: Env, user: User): Promise<Kind> {
  if (!isAdmin(user)) return 'founder';
  return isSuperAdmin(await hydrateSuperAdmin(env, user as any)) ? 'super_admin' : 'admin';
}

type Reason = { id: number; reason: string; created_at: string; expires_at: string };

/** The caller's own unexpired reason for this venture, or null. Throws when the log cannot be read. */
export async function activeReason(env: Env, projectId: number, userId: number): Promise<Reason | null> {
  return env.DB.prepare(
    `SELECT id, reason, created_at, expires_at FROM narrative_read_reasons
      WHERE project_id = ? AND reader_user_id = ? AND expires_at > datetime('now')
      ORDER BY id DESC LIMIT 1`,
  ).bind(projectId, userId).first<Reason>();
}

/**
 * The refusal for an admin's narrative request, or null to let it through.
 * A write is refused outright; a read needs an unexpired reason.
 */
export async function narrativeAdminGate(c: any, user: User, projectId: number, mode: Mode): Promise<Response | null> {
  if (!isAdmin(user)) return null;
  if (mode === 'write') return c.json({ detail: ADMIN_READ_ONLY, code: 'admin_read_only' }, 403);
  let reason: Reason | null;
  try {
    reason = await activeReason(c.env, projectId, Number(user.id));
  } catch (e) {
    console.error('[narrative] read log unreadable:', (e as Error)?.message);
    return c.json({ detail: REASON_UNREADABLE, code: 'read_log_unreadable' }, 503);
  }
  return reason ? null : c.json({ detail: REASON_REQUIRED, code: 'read_reason_required' }, 403);
}

type ReasonRow = Reason & { reader_kind: 'admin' | 'super_admin'; reader_name: string | null };

const reasonView = (r: ReasonRow) => ({
  id: r.id, reason: r.reason, by: { name: r.reader_name ?? null, kind: r.reader_kind }, created_at: r.created_at, expires_at: r.expires_at,
});

/** Every reason given for this venture's narrative, newest first, and the caller's own unexpired one. */
export async function listReasons(env: Env, projectId: number, user: User) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.reason, r.reader_kind, r.created_at, r.expires_at, u.name AS reader_name
       FROM narrative_read_reasons r LEFT JOIN users u ON u.id = r.reader_user_id
      WHERE r.project_id = ? ORDER BY r.id DESC LIMIT ?`,
  ).bind(projectId, LIST_MAX).all<ReasonRow>();
  const mine = isAdmin(user) ? await activeReason(env, projectId, Number(user.id)) : null;
  return { reads: (results || []).map(reasonView), mine };
}

export class InputError extends Error {
  readonly code: string;
  readonly sentence: string;
  constructor(code: string, sentence: string) { super(sentence); this.code = code; this.sentence = sentence; }
}

const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** An admin's reason for opening the narrative: one row and one activity row, together. */
export async function giveReason(env: Env, projectId: number, user: User, raw: unknown) {
  const reason = text(raw);
  if (reason.length < REASON_MIN) throw new InputError('reason_required', `Write a reason of at least ${REASON_MIN} characters.`);
  if (reason.length > REASON_MAX) throw new InputError('reason_too_long', `A reason is at most ${REASON_MAX} characters.`);
  const kind = await kindOf(env, user);
  const [insert] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO narrative_read_reasons (project_id, reader_user_id, reader_kind, reason, expires_at)
       VALUES (?, ?, ?, ?, datetime('now', ?))`,
    ).bind(projectId, user.id, kind, reason, `+${READ_REASON_HOURS} hours`),
    logCycleWriteStatement(env, {
      projectId, userId: Number(user.id), cycle: 'raise', module: 'investor-narrative', entityId: null,
      action: 'narrative_read_opened', summary: kind === 'super_admin' ? 'HQ opened the narrative to read it' : 'An admin opened the narrative to read it',
    }),
  ]);
  const row = await env.DB.prepare(
    `SELECT r.id, r.reason, r.reader_kind, r.created_at, r.expires_at, u.name AS reader_name
       FROM narrative_read_reasons r LEFT JOIN users u ON u.id = r.reader_user_id WHERE r.id = ? AND r.project_id = ?`,
  ).bind(Number(insert?.meta?.last_row_id), projectId).first<ReasonRow>();
  if (!row) throw new Error('reason saved but unreadable');
  return reasonView(row);
}

type NoteRow = { id: number; version: number | null; body: string; author_kind: Kind; author_name: string | null; created_at: string };

const noteView = (r: NoteRow) => ({
  id: r.id, version: r.version ?? null, body: r.body, author: { name: r.author_name ?? null, kind: r.author_kind }, created_at: r.created_at,
});

const NOTE_SELECT = `SELECT n.id, n.version, n.body, n.author_kind, n.created_at, u.name AS author_name
  FROM narrative_notes n LEFT JOIN users u ON u.id = n.author_user_id`;

/** The venture's notes thread, every version, oldest first. */
export async function listNotes(env: Env, projectId: number) {
  const { results } = await env.DB.prepare(`${NOTE_SELECT} WHERE n.project_id = ? ORDER BY n.created_at, n.id LIMIT ?`)
    .bind(projectId, LIST_MAX).all<NoteRow>();
  return (results || []).map(noteView);
}

/** One note, on a saved version (`version`, already checked as this venture's) or on the narrative (null). */
export async function postNote(env: Env, projectId: number, user: User, raw: unknown, version: number | null) {
  const body = typeof raw === 'string' ? raw.trim() : '';
  if (!body) throw new InputError('note_required', 'Write the note first.');
  if (body.length > NOTE_MAX) throw new InputError('note_too_long', `A note is at most ${NOTE_MAX.toLocaleString('en-US')} characters.`);
  const kind = await kindOf(env, user);
  const [insert] = await env.DB.batch([
    env.DB.prepare('INSERT INTO narrative_notes (project_id, version, author_user_id, author_kind, body) VALUES (?, ?, ?, ?, ?)')
      .bind(projectId, version, user.id, kind, body),
    logCycleWriteStatement(env, {
      projectId, userId: Number(user.id), cycle: 'raise', module: 'investor-narrative', entityId: version,
      action: 'narrative_note_posted', summary: version == null ? 'Note posted on the narrative' : `Note posted on v${version}`,
    }),
  ]);
  const row = await env.DB.prepare(`${NOTE_SELECT} WHERE n.id = ? AND n.project_id = ?`)
    .bind(Number(insert?.meta?.last_row_id), projectId).first<NoteRow>();
  if (!row) throw new Error('note saved but unreadable');
  return noteView(row);
}
