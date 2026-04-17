/**
 * VC funds + Limited Partners — CRUD + capital-call enqueue.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireAuth } from '../auth';
import { Funds, LPs } from '../models/funds';
import { Jobs } from '../models/jobs';

const funds = new Hono<{ Bindings: Env }>();

// ---------- vc_funds ----------
funds.get('/', async (c) => {
  await requireAuth(c);
  const status = c.req.query('status') || undefined;
  const list = await Funds.list(c.env, status);
  return c.json({ ok: true, items: list.results || [] });
});

funds.get('/:id', async (c) => {
  await requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  const f = await Funds.getById(c.env, id);
  if (!f) return c.json({ error: 'not found' }, 404);
  // Compute LP count + invested totals at read time — denormalized lp_count
  // can drift under concurrent LP writes, so the read path is the source of truth.
  const agg = await c.env.DB.prepare(
    `SELECT COUNT(*) AS lp_count,
            COALESCE(SUM(commitment_amount),0) AS total_committed,
            COALESCE(SUM(invested_amount),0)   AS total_invested
       FROM limited_partners WHERE fund_id = ?`
  ).bind(id).first<{ lp_count: number; total_committed: number; total_invested: number }>();
  return c.json({
    ok: true,
    fund: { ...f, lp_count: agg?.lp_count ?? 0 },
    totals: { committed: agg?.total_committed ?? 0, invested: agg?.total_invested ?? 0 },
  });
});

funds.post('/', async (c) => {
  await requireAdmin(c);
  const body = await c.req.json();
  if (!body?.name) return c.json({ error: 'name required' }, 400);
  const f = await Funds.create(c.env, body);
  return c.json({ ok: true, fund: f }, 201);
});

funds.patch('/:id', async (c) => {
  await requireAdmin(c);
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json();
  const f = await Funds.update(c.env, id, body);
  return c.json({ ok: true, fund: f });
});

// ---------- LPs ----------
funds.get('/:id/lps', async (c) => {
  await requireAdmin(c);
  const id = parseInt(c.req.param('id'), 10);
  const r = await LPs.listByFund(c.env, id);
  return c.json({ ok: true, items: r.results || [] });
});

funds.post('/:id/lps', async (c) => {
  await requireAdmin(c);
  const fundId = parseInt(c.req.param('id'), 10);
  const body = await c.req.json();
  const lp = await LPs.create(c.env, { ...body, fund_id: fundId });
  return c.json({ ok: true, lp }, 201);
});

// ---------- Capital call (event-driven → enqueue) ----------
funds.post('/:id/capital-call', async (c) => {
  await requireAdmin(c);
  const fundId = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<{ amount: number; note?: string }>();
  if (!body?.amount || body.amount <= 0) return c.json({ error: 'amount must be > 0' }, 400);
  const job = await Jobs.enqueue(c.env, 'capital_call', { fund_id: fundId, amount: body.amount, note: body.note });
  return c.json({ ok: true, enqueued_job: job });
});

export default funds;
