/** D627: narrow LP reads and GP/admin writes; writes and actor audit commit together. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { lpMembershipScope } from '../services/tenancyScope';
import { claimLpRowsByEmail } from '../services/lpClaim';
import { requireFundGp } from '../services/fundGpAccess';
import { readFundPerformance, validDate } from '../services/fundPerformance';
import { refuse } from '../util/refusal';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
const r = new Hono<{ Bindings: Env }>();
// GP gates throw Response objects; Hono only dispatches Error instances to onError.
r.use('*', async (_c, next) => {
  try { await next(); } catch (error) { if (error instanceof Response) return error; throw error; }
});
const today = () => new Date().toISOString().slice(0, 10);
const positiveId = (raw: string) => /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) > 0 ? Number(raw) : null;
const notFound = () => new Response(JSON.stringify({ error: 'fund_not_found', message: 'Fund not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
// Also maps thrown auth/GP responses when this router is exercised on its own.
r.onError((error, c) => {
  if (error instanceof Response) return error;
  const status = AUTH_ERROR_STATUSES[error.message];
  if (status) return refuse(c, status, { code: 'fund_access_refused', message: 'This account cannot access this fund.' });
  return refuse(c, 503, { code: 'fund_performance_unreadable', message: 'Fund performance is Unreadable. Please retry.', raw: error });
});
async function readableFunds(env: Env, user: any) {
  if (user.role === 'investor') await claimLpRowsByEmail(env, Number(user.id), user.email);
  const scope = lpMembershipScope(user);
  const result = user.role === 'admin'
    ? await env.DB.prepare(`SELECT id, name, vintage_year, status FROM vc_funds ORDER BY id`).all<any>()
    : user.role === 'investor'
      ? await env.DB.prepare(`SELECT f.id, f.name, f.vintage_year, f.status FROM vc_funds f
          WHERE EXISTS (SELECT 1 FROM limited_partners lp WHERE lp.fund_id = f.id
            AND ${scope.sql}) ORDER BY f.id`)
          .bind(...scope.binds).all<any>()
      : { success: true, results: [] };
  if (!result.success) throw new Error('Fund list read failed');
  return result.results;
}
r.get('/', async (c) => {
  const user = await requireAuth(c);
  if (user.role !== 'admin' && user.role !== 'investor') return notFound();
  const funds = await readableFunds(c.env, user);
  const asOf = today();
  const items = [];
  for (const fund of funds) items.push(await readFundPerformance(c.env, fund, asOf));
  return c.json({ items, as_of: asOf });
});
r.get('/:id', async (c) => {
  const user = await requireAuth(c), id = positiveId(c.req.param('id'));
  if (!id || (user.role !== 'admin' && user.role !== 'investor')) return notFound();
  const fund = (await readableFunds(c.env, user)).find((f: any) => f.id === id);
  if (!fund) return notFound();
  return c.json(await readFundPerformance(c.env, fund, today()));
});
r.put('/positions/:id/fund', async (c) => {
  const user = await requireAuth(c), id = positiveId(c.req.param('id'));
  const body = await c.req.json().catch(() => null);
  if (!id || !body || !(body.fund_id === null || (Number.isSafeInteger(body.fund_id) && body.fund_id > 0)))
    return refuse(c, 400, { code: 'invalid_fund_attribution', message: 'Choose a fund ID or null for a firm-level position.' });
  const position = await c.env.DB.prepare(`SELECT id, fund_id, created_by FROM portfolio_positions WHERE id = ?`).bind(id).first<any>();
  if (!position) return notFound();
  if (position.fund_id !== null) await requireFundGp(c, position.fund_id);
  else if (user.role !== 'admin' && position.created_by !== user.id) return notFound();
  if (body.fund_id !== null) await requireFundGp(c, body.fund_id);
  else if (position.fund_id === null && user.role !== 'admin') return notFound();
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE portfolio_positions SET fund_id = ?, updated_at = datetime('now') WHERE id = ? AND fund_id IS ?`)
      .bind(body.fund_id, id, position.fund_id),
    c.env.DB.prepare(`INSERT INTO activity_logs (action, details, actor, user_id)
      SELECT ?, ?, ?, ? WHERE changes() = 1`).bind('fund_position_attributed', JSON.stringify({ position_id: id, before_fund_id: position.fund_id, fund_id: body.fund_id }), String(user.id), user.id),
  ]);
  if (results.some(result => !result.success)) throw new Error('Attribution batch failed');
  if (results[0].meta.changes !== 1) return refuse(c, 409, { code: 'position_changed', message: 'The position changed. Reload before attributing it.' });
  return c.json({ position_id: id, fund_id: body.fund_id });
});
r.post('/positions/:id/valuations', async (c) => {
  await requireAuth(c);
  const id = positiveId(c.req.param('id')), body = await c.req.json().catch(() => null);
  if (!id || !body || !validDate(body.valuation_date) || body.valuation_date > today()
    || !Number.isSafeInteger(body.value_cents) || body.value_cents < 0
    || typeof body.source !== 'string' || !body.source.trim() || body.source.trim().length > 500)
    return refuse(c, 400, { code: 'invalid_position_valuation', message: 'Record a valid non-future date, a nonnegative integer value in cents, and a source of up to 500 characters.' });
  const position = await c.env.DB.prepare(`SELECT id, fund_id FROM portfolio_positions WHERE id = ?`).bind(id).first<any>();
  if (!position || position.fund_id === null) return notFound();
  const { user } = await requireFundGp(c, position.fund_id);
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO fund_position_valuations (position_id, valuation_date, value_cents, source, recorded_by)
      SELECT id, ?, ?, ?, ? FROM portfolio_positions WHERE id = ? AND fund_id = ?`)
      .bind(body.valuation_date, body.value_cents, body.source.trim(), user.id, id, position.fund_id),
    c.env.DB.prepare(`INSERT INTO activity_logs (action, details, actor, user_id)
      SELECT ?, ?, ?, ? WHERE changes() = 1`).bind('fund_position_valued', JSON.stringify({ position_id: id, fund_id: position.fund_id,
        valuation_date: body.valuation_date, value_cents: body.value_cents, source: body.source.trim() }), String(user.id), user.id),
  ]);
  if (results.some(result => !result.success)) throw new Error('Valuation batch failed');
  if (results[0].meta.changes !== 1) return refuse(c, 409, { code: 'position_changed', message: 'The position changed. Reload before recording its valuation.' });
  return c.json({ id: results[0].meta.last_row_id, position_id: id, recorded_by: user.id }, 201);
});
export default r;
