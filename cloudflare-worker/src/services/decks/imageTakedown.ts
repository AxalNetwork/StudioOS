/**
 * #4375 (D4375) — HQ takes down one deck image: a reported or unlawful picture.
 *
 *   takeDownImage(env, admin, uid, reason)
 *     1. the reason is required: trimmed, REASON_MIN to REASON_MAX characters (400);
 *     2. the row is marked once (`taken_down_at`, `taken_down_by`,
 *        `taken_down_reason`, migration 202611040745); a second takedown is
 *        409 `already_taken_down`, an unknown uid 404;
 *     3. the R2 object is deleted. The row stays, so the file route answers
 *        the neutral placeholder (`takedownPlaceholder.ts`) for every card,
 *        version, draft, proposal and export that still names the image, and
 *        the daily sweep never removes it. A delete that fails is reported
 *        (`r2_deleted: false`) and the file route still never serves the
 *        bytes: it reads the mark before R2;
 *     4. the venture's founders are told in their inbox, with the reason;
 *     5. the admin audit log keeps the image, the venture, the reason and the
 *        admin's name.
 *
 * WHAT IT DOES NOT DO. It rewrites no saved version, draft or proposal: every
 * one of them names the image by its file URL or its uid, and each draws the
 * placeholder from that URL. Copies a founder exported before the takedown
 * are their own files and are not reached.
 */
import type { Env, User } from '../../types';
import { logAdminAction } from '../adminAudit';
import { notify } from '../notify';

export const REASON_MIN = 10;
export const REASON_MAX = 1000;
const UID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export class TakedownRefusal extends Error {
  readonly status: number;
  readonly code: string;
  readonly sentence: string;
  constructor(status: number, code: string, sentence: string) { super(sentence); this.status = status; this.code = code; this.sentence = sentence; }
}

/** The reason as stored, or a refusal in words. */
export function takedownReason(v: unknown): string {
  if (v != null && typeof v !== 'string') throw new TakedownRefusal(400, 'invalid_reason', 'The reason must be text.');
  const reason = typeof v === 'string' ? v.trim() : '';
  if (reason.length < REASON_MIN) {
    throw new TakedownRefusal(400, 'reason_required', `Write why, in at least ${REASON_MIN} characters. The founder reads it.`);
  }
  if (reason.length > REASON_MAX) throw new TakedownRefusal(400, 'reason_too_long', `The reason is at most ${REASON_MAX.toLocaleString('en-US')} characters.`);
  return reason;
}

type Row = { id: number; uid: string; project_id: number; r2_key: string; taken_down_at: string | null; taken_down_reason: string | null };

export const takedownView = (r: Row & { r2_deleted?: boolean }) => ({
  uid: r.uid, project_id: Number(r.project_id), taken_down_at: r.taken_down_at, reason: r.taken_down_reason,
  ...(r.r2_deleted === undefined ? {} : { r2_deleted: r.r2_deleted }),
});

/** The venture's founder accounts, who are told. */
async function foundersOf(env: Env, projectId: number): Promise<number[]> {
  const rows = await env.DB.prepare(
    "SELECT u.id FROM users u JOIN projects p ON p.founder_id = u.founder_id WHERE p.id = ? AND u.role = 'founder' AND u.founder_id IS NOT NULL",
  ).bind(projectId).all<{ id: number }>().catch(() => ({ results: [] as { id: number }[] }));
  return [...new Set((rows.results ?? []).map((r) => Number(r.id)))];
}

export async function takeDownImage(env: Env, admin: User, uid: unknown, reasonIn: unknown) {
  const reason = takedownReason(reasonIn);
  const id = String(uid ?? '');
  if (!UID.test(id)) throw new TakedownRefusal(404, 'not_found', 'No deck image has that id.');
  const marked = await env.DB.prepare(
    `UPDATE deck_images SET taken_down_at = datetime('now'), taken_down_by = ?, taken_down_reason = ?
      WHERE uid = ? AND taken_down_at IS NULL
      RETURNING id, uid, project_id, r2_key, taken_down_at, taken_down_reason`,
  ).bind(Number(admin.id), reason, id).first<Row>();
  if (!marked) {
    const known = await env.DB.prepare('SELECT 1 FROM deck_images WHERE uid = ?').bind(id).first();
    throw known
      ? new TakedownRefusal(409, 'already_taken_down', 'This image is already taken down.')
      : new TakedownRefusal(404, 'not_found', 'No deck image has that id.');
  }
  let r2Deleted = false;
  if (env.FILES) {
    try { await env.FILES.delete(marked.r2_key); r2Deleted = true; } catch { r2Deleted = false; }
  }
  for (const userId of await foundersOf(env, Number(marked.project_id))) {
    await notify(env, {
      userId, type: 'deck_image_taken_down',
      title: 'Axal HQ removed an image from your deck',
      body: `Every card that used it now shows "Image removed by Axal HQ". Why: ${reason}`,
      link: `/raise/pitch?project_id=${Number(marked.project_id)}`,
      payload: { image_uid: marked.uid },
    }).catch(() => null);
  }
  await logAdminAction(env, Number(admin.id), (admin as any).email ?? '', 'deck_image_taken_down', {
    image_uid: marked.uid, project_id: Number(marked.project_id), reason, r2_deleted: r2Deleted,
    admin: { uid: (admin as any).uid ?? null, name: (admin as any).name ?? null },
  });
  return takedownView({ ...marked, r2_deleted: r2Deleted });
}
