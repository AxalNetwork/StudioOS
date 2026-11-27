/**
 * D709 (#1774) — the 2% management fee, under /api/fund-fees/:fundId.
 *
 * Every route opens with `requireFundGp`, unchanged: the GP of record or an
 * admin; anyone else gets its 401, 402 or 404. Every write then asserts its
 * D714 act (`assertFundAct`): confirming terms (`fee_terms.confirm`) and
 * issuing a period (`fee_period.issue`) are Super Admin acts, refused to a
 * plain Admin with `super_admin_required` before any TOTP or step-up demand;
 * every other write is `fee.write`. A support session is refused every write,
 * and an admin's act leaves one `fund_admin.<act>` row. Nothing here moves
 * money: issuing records amounts and reference codes (services/fundFees.ts).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { requireFundGp } from '../services/fundGpAccess';
import { assertFundAct, auditFundAct, type FundActKey } from '../services/fundAdminAccess';
import { refuse } from '../util/refusal';
import {
  FeeRefusal, confirmTerms, feeState, issuePeriod, linkFundingCall, previewPeriod, readPeriod,
  recordAdmission, recordNetInvested, recordOffset, recordTerms, statementFor,
} from '../services/fundFees';

const app = new Hono<{ Bindings: Env }>();
const QUARTER = /^\d{4}Q[1-4]$/;
const today = () => new Date().toISOString().slice(0, 10);

type Gate = { user: any; viaAdmin: boolean; fundId: number };
/** The fund gate, with the Response it throws returned (as routes/capital.ts does). */
async function gate(c: Context<{ Bindings: Env }>): Promise<Gate | Response> {
  const fundId = Number(c.req.param('fundId'));
  try {
    const g = await requireFundGp(c, fundId);
    return { user: g.user, viaAdmin: g.viaAdmin, fundId: Number(g.fund.id) };
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
/**
 * A write's gate: the fund gate, then its D714 act on the context it
 * returned, with the Response either throws returned. The act is stashed for
 * the audit row below.
 */
async function writeGate(c: Context<{ Bindings: Env }>, act: FundActKey): Promise<Gate | Response> {
  const fundId = Number(c.req.param('fundId'));
  try {
    const g = await requireFundGp(c, fundId);
    await assertFundAct(c, g, act);
    (c as any).set('fundAdminAct', { user: g.user, act, fund_id: Number(g.fund.id) });
    return { user: g.user, viaAdmin: g.viaAdmin, fundId: Number(g.fund.id) };
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
/**
 * D714 decision 4: an admin's fee act leaves one `fund_admin.<act>` row, once
 * the handler has answered with success.
 */
app.use('*', async (c, next) => {
  await next();
  const done = (c as any).get('fundAdminAct') as { user: any; act: FundActKey; fund_id: number } | undefined;
  if (done && c.res.ok) await auditFundAct(c.env, done.user, done.act, { fund_id: done.fund_id, route: `${c.req.method} ${c.req.path}` });
});
function refused(c: Context<{ Bindings: Env }>, e: unknown): Response {
  if (e instanceof FeeRefusal) {
    return refuse(c, e.status, { code: 'fee_refused', message: e.sentences[0], audience: 'owner', extra: { refusals: e.sentences } });
  }
  throw e;
}
async function body(c: Context<{ Bindings: Env }>): Promise<Record<string, unknown>> {
  const raw = await c.req.json().catch(() => null);
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}
function quarterOf(c: Context<{ Bindings: Env }>): string | Response {
  const q = c.req.param('quarter') ?? '';
  return QUARTER.test(q) ? q : refuse(c, 404, { code: 'not_found', message: 'Fee period not found.', audience: 'owner' });
}
const actorOf = (g: Gate) => ({ id: Number(g.user.id) });

app.get('/:fundId', async (c) => {
  const g = await gate(c); if (g instanceof Response) return g;
  return c.json(await feeState(c.env, g.fundId));
});

app.post('/:fundId/terms', async (c) => {
  const g = await writeGate(c, 'fee.write'); if (g instanceof Response) return g;
  try { return c.json(await recordTerms(c.env, actorOf(g), g.fundId, await body(c)), 201); } catch (e) { return refused(c, e); }
});

app.post('/:fundId/terms/:termsUid/confirm', async (c) => {
  const g = await writeGate(c, 'fee_terms.confirm'); if (g instanceof Response) return g;
  try { return c.json(await confirmTerms(c.env, actorOf(g), g.fundId, String(c.req.param('termsUid')))); } catch (e) { return refused(c, e); }
});

app.put('/:fundId/lps/:lpId/admission', async (c) => {
  const g = await writeGate(c, 'fee.write'); if (g instanceof Response) return g;
  try { return c.json(await recordAdmission(c.env, actorOf(g), g.fundId, Number(c.req.param('lpId')), await body(c))); } catch (e) { return refused(c, e); }
});

app.post('/:fundId/net-invested', async (c) => {
  const g = await writeGate(c, 'fee.write'); if (g instanceof Response) return g;
  try { return c.json(await recordNetInvested(c.env, actorOf(g), g.fundId, await body(c)), 201); } catch (e) { return refused(c, e); }
});

app.post('/:fundId/offsets', async (c) => {
  const g = await writeGate(c, 'fee.write'); if (g instanceof Response) return g;
  try { return c.json(await recordOffset(c.env, actorOf(g), g.fundId, await body(c)), 201); } catch (e) { return refused(c, e); }
});

app.post('/:fundId/periods/:quarter/preview', async (c) => {
  const g = await writeGate(c, 'fee.write'); if (g instanceof Response) return g;
  const q = quarterOf(c); if (q instanceof Response) return q;
  try { return c.json(await previewPeriod(c.env, actorOf(g), g.fundId, q, today())); } catch (e) { return refused(c, e); }
});

app.post('/:fundId/periods/:quarter/issue', async (c) => {
  const g = await writeGate(c, 'fee_period.issue'); if (g instanceof Response) return g;
  const q = quarterOf(c); if (q instanceof Response) return q;
  const b = await body(c);
  try {
    const out = await issuePeriod(c.env, actorOf(g), g.fundId, q, b.digest, today());
    const funding = !out.already_issued && b.funding_call_uid != null ? await linkFundingCall(c.env, actorOf(g), g.fundId, q, b.funding_call_uid) : null;
    return c.json({ ...(await readPeriod(c.env, g.fundId, q)), already_issued: out.already_issued, ...(funding ? { funding } : {}) });
  } catch (e) { return refused(c, e); }
});

app.post('/:fundId/periods/:quarter/funding-call', async (c) => {
  const g = await writeGate(c, 'fee.write'); if (g instanceof Response) return g;
  const q = quarterOf(c); if (q instanceof Response) return q;
  try { return c.json(await linkFundingCall(c.env, actorOf(g), g.fundId, q, (await body(c)).call_uid)); } catch (e) { return refused(c, e); }
});

app.get('/:fundId/periods/:quarter', async (c) => {
  const g = await gate(c); if (g instanceof Response) return g;
  const q = quarterOf(c); if (q instanceof Response) return q;
  try { return c.json(await readPeriod(c.env, g.fundId, q)); } catch (e) { return refused(c, e); }
});

app.get('/:fundId/periods/:quarter/statements/:lpId', async (c) => {
  const g = await gate(c); if (g instanceof Response) return g;
  const q = quarterOf(c); if (q instanceof Response) return q;
  try { return c.json(await statementFor(c.env, g.fundId, q, Number(c.req.param('lpId')))); } catch (e) { return refused(c, e); }
});

export default app;
