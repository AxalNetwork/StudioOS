/**
 * D946 (#2751) — the Spin-Out Lab's participants: SL7's table and SL8's
 * drawer. Mounted by admin_cohort.ts at /api/admin/cohort, beside D944's reads.
 *
 *   GET /participants?cohort=YYYY-MM&status=&week=&this_week=&incorporated=&needs=1&q=&sort=&limit=&offset=
 *   GET /participants/:uid
 *
 * requireAdmin, read only. `services/labParticipants.ts` says who is a
 * participant, what each column means and how a failed read shows. A filter
 * this cannot read is a 400, never a quietly wider list.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import { LabReadError, parseParticipantQuery, participantDetail, participantsPage } from '../services/labParticipants';

const r = new Hono<{ Bindings: Env }>();

function answer(c: Context<{ Bindings: Env }>, e: unknown) {
  if (e instanceof LabReadError) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: { code: e.code } });
  return mapError(c, e);
}

r.get('/participants', async (c) => {
  try {
    await requireAdmin(c);
    const p = parseParticipantQuery((k) => c.req.query(k));
    if (!p.ok) return c.json({ code: p.code, error: p.code, detail: p.detail }, 400);
    return c.json(await participantsPage(c.env, p.query));
  } catch (e) {
    return answer(c, e);
  }
});

r.get('/participants/:uid', async (c) => {
  try {
    await requireAdmin(c);
    return c.json(await participantDetail(c.env, c.req.param('uid')));
  } catch (e) {
    return answer(c, e);
  }
});

export default r;
