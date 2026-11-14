/**
 * HQ's answer to a request, in the raiser's bell (D799, #2232).
 *
 * The owner: an Administrator requests and HQ answers each within its
 * response time. The answer is a decision stored on the escalation
 * (`answerEscalation`); this is the person learning of it. One notice per
 * decision, `in_app` and `email`, category `compliance`, linking to the
 * Licences page's requests tab — the `notifications_inbox` row is what the
 * header bell lists.
 *
 * WHO IS TOLD, ON WHICH DATABASE. On HQ's tier the raiser is an HQ user and
 * HQ tells them (`routes/admin_escalations.ts`). A branch's raiser is a user
 * of the branch's database, which HQ cannot write, so the branch tells them
 * when HQ's decision arrives (`applyEscalationAnswer`). Either way the id is
 * the one stored on the row when it was raised, and nobody else is told.
 *
 * BEST EFFORT, AND SAID. `notify` never throws; a notice that did not land is
 * reported to the caller, which says so beside the decision rather than
 * pretending the person was told.
 */
import type { Env } from '../types';
import { notify } from './notify';

export const REQUEST_ANSWER_TYPE = 'licence_request_answered';
export const REQUEST_ANSWER_LINK = '/admin/my-licence/requests';

export type AnswerNotice = { ok: true; inbox_id: number } | { ok: false; reason: string };

export async function notifyRequestAnswer(
  env: Env,
  row: { uid: string; kind: string; subject: string; status: string; answer: string | null; raised_by_user_id: number | null },
): Promise<AnswerNotice> {
  const userId = Number(row.raised_by_user_id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { ok: false, reason: 'The request does not record who raised it, so nobody was told.' };
  }
  const subject = String(row.subject || '').slice(0, 200);
  const declined = row.status === 'declined';
  const id = await notify(env, {
    userId,
    type: REQUEST_ANSWER_TYPE,
    title: declined ? `HQ declined your request: ${subject}` : `HQ answered your request: ${subject}`,
    body: row.answer ? String(row.answer).slice(0, 500) : null,
    link: REQUEST_ANSWER_LINK,
    payload: { escalation_uid: row.uid, kind: row.kind, status: row.status },
    channels: ['in_app', 'email'],
    category: 'compliance',
  });
  return id ? { ok: true, inbox_id: id } : { ok: false, reason: 'The notice could not be written to the bell.' };
}
