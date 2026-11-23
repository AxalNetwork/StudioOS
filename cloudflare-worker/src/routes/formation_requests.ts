/**
 * D6695 (#6695, plan key E10 of #6680): the founder's side of formation case
 * requests, mounted at /api/formation/case-requests.
 *
 *   GET  /                          signed in. The requests asked of the founder on
 *                                   their own cases, newest first; `?case=<uid>`
 *                                   narrows to one case.
 *   GET  /:uid                      signed in. One of those requests; another
 *                                   subject's reads as 404.
 *   POST /:uid/answer               signed in, the case's founder.
 *                                   `{ text?, document_id?, sha256? }`: a document or
 *                                   signature names a stored document of the case
 *                                   (uploaded through the classified file store,
 *                                   services/recordStore.ts; no bytes here); an
 *                                   identity request takes no file; an approval
 *                                   carries the hash it was bound to.
 *   GET  /cases/:caseUid/timeline   signed in, the case's founder. The timeline
 *                                   rows of visibility `all` only, filtered in SQL.
 *
 * HQ's and partners' write routes (open, accept, return, cancel, notes) are
 * #6698's and #6711's; they call services/formationRequests.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import {
  answerRequest, founderView, listFounderRequests, readFounderCase, readFounderRequest, readTimeline,
} from '../services/formationRequests';

const r = new Hono<{ Bindings: Env }>();

/** One sentence for each code a founder can be sent. */
export const REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  request_not_found: 'That request was not found.',
  case_not_found: 'That formation case was not found.',
  case_closed: 'This formation case is closed.',
  not_asked_of_you: 'This request was not asked of you.',
  request_not_open: 'This request has already been answered or closed.',
  request_moved: 'This request changed while you were answering it. Reload it and try again.',
  identity_takes_no_file: 'An identity check is done with the partner directly. Do not send a file or document here.',
  file_not_accepted: 'Files are not sent here. Upload the document to your company first, then choose it.',
  document_required: 'Choose the document that answers this request.',
  document_not_on_case: 'That document does not belong to this venture or company.',
  document_not_asked: 'This request does not ask for a document.',
  text_required: 'Write your answer.',
  approval_hash_mismatch: 'The version you approved is not the one this request asks about.',
  pack_changed: 'The filing pack has changed since this approval was requested. Ask for a new approval.',
  pack_missing: 'The filing has no pack to approve.',
  filing_not_prepared: 'The filing has moved past the point where it can be approved.',
  filing_moved: 'The filing changed while you were approving it. Reload it and try again.',
  founder_only: 'Only the founder of this case can approve its pack.',
  filing_not_found: 'The filing this approval names was not found.',
});
const refusal = (c: any, status: number, code: string) =>
  refuse(c, status as any, { code, message: REFUSALS[code] ?? 'This request could not be completed.' });

/** A request asked of the caller on their own case, or null: the SQL binds the caller's user_id to the case's owner. */
async function requireCaseFounder(env: Env, userId: number, uid: string) {
  return readFounderRequest(env, userId, uid);
}

// GET /api/formation/case-requests
r.get('/', async (c) => {
  const user = await requireAuth(c);
  const caseUid = c.req.query('case');
  return c.json({ requests: await listFounderRequests(c.env, Number(user.id), caseUid ? String(caseUid) : null) });
});

// GET /api/formation/case-requests/cases/:caseUid/timeline
r.get('/cases/:caseUid/timeline', async (c) => {
  const user = await requireAuth(c);
  const kase = await readFounderCase(c.env, Number(user.id), c.req.param('caseUid'));
  if (!kase) return refusal(c, 404, 'case_not_found');
  return c.json({ case_uid: kase.uid, events: await readTimeline(c.env, kase.id, 'founder') });
});

// GET /api/formation/case-requests/:uid
r.get('/:uid', async (c) => {
  const user = await requireAuth(c);
  const row = await requireCaseFounder(c.env, Number(user.id), c.req.param('uid'));
  if (!row) return refusal(c, 404, 'request_not_found');
  return c.json({ request: founderView(row) });
});

// POST /api/formation/case-requests/:uid/answer
r.post('/:uid/answer', async (c) => {
  const user = await requireAuth(c);
  const row = await requireCaseFounder(c.env, Number(user.id), c.req.param('uid'));
  if (!row) return refusal(c, 404, 'request_not_found');
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) ?? {}; } catch { body = {}; }
  const { document_id, ...rest } = body;
  const res = await answerRequest(c.env, Number(row.id), { ...rest, documentId: document_id ?? rest.documentId }, { party: 'founder', userId: Number(user.id), email: user.email ?? null });
  if (!res.ok) return refusal(c, res.status, res.error);
  return c.json({ request: founderView({ ...res.request, case_uid: row.case_uid }) });
});

export const mount: RouteMount = { path: '/api/formation/case-requests', router: r };
export default r;
