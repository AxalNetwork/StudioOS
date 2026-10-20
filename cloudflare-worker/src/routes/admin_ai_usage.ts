/**
 * D791 (#2216) — HQ › AI usage, mounted at `/api/admin/ai-usage`.
 *
 *   GET    /?range=7d|30d|mtd            the platform's AI use, the top members, the flags, who is paused or capped
 *   POST   /members/:id/pause   { reason }               pause the member's AI
 *   DELETE /members/:id/pause   { reason }               restore it
 *   PUT    /members/:id/cap     { monthly_usd, reason }  a lower monthly cap for the member; null clears it
 *
 * Every route is a Super Admin's, with a recent step-up (`requireStepUp`, then
 * `requireSuperAdmin`): the read names members and what they were charged, and
 * the writes stop or narrow a member's AI. Each write is audited in
 * `activity_logs` with its reason, in the same batch as the change
 * (`services/aiUsageAdmin.ts`). No answer carries an email, a prompt or an
 * output.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireStepUp, requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { AI_USAGE_RANGES, MEMBER_CAP_MAX_USD, platformAiUsage, pauseMemberAi, setMemberAiCap, unpauseMemberAi,
  type AiUsageRange } from '../services/aiUsageAdmin';

const r = new Hono<{ Bindings: Env }>();

/** The step-up, then the elevation: the order the other HQ money gates check them in. */
async function gate(c: any) {
  await requireStepUp(c);
  return requireSuperAdmin(c);
}

const REASON_MIN = 10;
const REASON_MAX = 500;
function reasonOf(body: any): string | null {
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  return reason.length >= REASON_MIN && reason.length <= REASON_MAX ? reason : null;
}
const refuseReason = (c: any) => refuse(c, 400, { code: 'reason_required', message: `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters. It is recorded with the change.` });

/** The member the path names, or null when no account has that id. */
async function memberOf(c: any): Promise<number | null> {
  const raw = c.req.param('id');
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) return null;
  const row = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  return row ? id : null;
}
const refuseMember = (c: any) => refuse(c, 404, { code: 'ai_member_not_found', message: 'No member has that ID.' });

r.get('/', async (c) => {
  await gate(c);
  const range = c.req.query('range') ?? '30d';
  if (!(AI_USAGE_RANGES as readonly string[]).includes(range)) {
    return refuse(c, 400, { code: 'invalid_range', message: 'The range is 7d, 30d or mtd.' });
  }
  try {
    return c.json({ ok: true, ...(await platformAiUsage(c.env, range as AiUsageRange)) });
  } catch (error) {
    return refuse(c, 503, { code: 'ai_usage_unreadable', message: 'Unreadable: AI usage could not be read.', raw: error });
  }
});

r.post('/members/:id/pause', async (c) => {
  const actor = await gate(c);
  const reason = reasonOf(await c.req.json().catch(() => null));
  if (!reason) return refuseReason(c);
  const id = await memberOf(c);
  if (id === null) return refuseMember(c);
  try {
    const out = await pauseMemberAi(c.env, { memberId: id, actorId: Number(actor.id), reason });
    if (!out.ok) return refuse(c, 409, { code: out.error, message: 'AI is already paused on this account.' });
    return c.json({ ok: true, member_id: id, paused: true });
  } catch (error) {
    return refuse(c, 503, { code: 'ai_pause_not_recorded', message: 'The pause was not recorded. Nothing changed.', raw: error });
  }
});

r.delete('/members/:id/pause', async (c) => {
  const actor = await gate(c);
  const reason = reasonOf(await c.req.json().catch(() => null));
  if (!reason) return refuseReason(c);
  const id = await memberOf(c);
  if (id === null) return refuseMember(c);
  try {
    const out = await unpauseMemberAi(c.env, { memberId: id, actorId: Number(actor.id), reason });
    if (!out.ok) return refuse(c, 404, { code: out.error, message: 'AI is not paused on this account.' });
    return c.json({ ok: true, member_id: id, paused: false });
  } catch (error) {
    return refuse(c, 503, { code: 'ai_unpause_not_recorded', message: 'The pause was not lifted. Nothing changed.', raw: error });
  }
});

r.put('/members/:id/cap', async (c) => {
  const actor = await gate(c);
  const body = await c.req.json().catch(() => null) as any;
  const reason = reasonOf(body);
  if (!reason) return refuseReason(c);
  const usd = body?.monthly_usd;
  if (usd !== null && !(typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 && usd <= MEMBER_CAP_MAX_USD)) {
    return refuse(c, 400, { code: 'invalid_cap', message: `The monthly cap is a dollar amount from 0 to ${MEMBER_CAP_MAX_USD.toLocaleString('en-US')}, or null to clear it.` });
  }
  const id = await memberOf(c);
  if (id === null) return refuseMember(c);
  const monthlyMicrousd = usd === null ? null : Math.round(usd * 1_000_000);
  try {
    await setMemberAiCap(c.env, { memberId: id, actorId: Number(actor.id), reason, monthlyMicrousd });
    return c.json({ ok: true, member_id: id, monthly_microusd: monthlyMicrousd });
  } catch (error) {
    return refuse(c, 503, { code: 'ai_cap_not_recorded', message: 'The cap was not recorded. Nothing changed.', raw: error });
  }
});

export default r;
