/**
 * VC Funds + Limited Partners + LPAs + Distributions.
 *
 * Roles: admin manages funds & runs distributions; partner/LP gets read-only
 * portal of their own positions; founders are excluded.
 *
 * Money convention: legacy commitment_amount/invested_amount/returns are dollars
 * (legacy floats). New v2 columns (fund_size_cents, fund_distributions.amount_cents)
 * are integer cents. Conversions happen at the boundary.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireAuth } from '../auth';
import { Funds, LPs } from '../models/funds';
import { Jobs } from '../models/jobs';
import { enqueueJob } from '../services/queue';
import { Distributions } from '../models/distributions';
import { logActivity } from './partnernet';

const funds = new Hono<{ Bindings: Env }>();

// ---------- vc_funds CRUD ----------
funds.get('/', async (c) => {
  await requireAuth(c);
  const status = c.req.query('status') || undefined;
  const list = await Funds.list(c.env, status);
  return c.json({ ok: true, items: list.results || [] });
});

funds.get('/lp-portal', async (c) => {
  // LP-only self-view: own commitments, capital calls, distributions, performance.
  const user = await requireAuth(c);
  const my = await LPs.listByUser(c.env, user.id);
  const lpRows: any[] = my.results || [];

  // Aggregate cash flows per-fund for TVPI / DPI
  const distRows = await Distributions.listByUser(c.env, user.id, 200);

  // Joins through canonical limited_partners (matches by user_id when set,
  // falls back to denormalized email for legacy LPs migrated from lp_investors).
  const calls = await c.env.DB.prepare(
    `SELECT cc.* FROM capital_calls cc
       JOIN limited_partners lp ON lp.id = cc.limited_partner_id
      WHERE lp.user_id = ? OR LOWER(lp.email) = LOWER(?)
      ORDER BY cc.created_at DESC LIMIT 50`
  ).bind(user.id, user.email).all().catch(() => ({ results: [] }));

  // Performance per-LP-row: TVPI = (returns + distributions) / invested ; DPI = distributions / invested
  const perfByLp = lpRows.map((lp: any) => {
    const lpDists = distRows.filter((d: any) => d.fund_id === lp.fund_id);
    const distSumDollars = lpDists.reduce((s: number, d: any) => s + Number(d.amount_cents || 0) / 100, 0);
    const invested = Number(lp.invested_amount || 0);
    const returns = Number(lp.returns || 0);
    const tvpi = invested > 0 ? (invested + returns + distSumDollars) / invested : 0;
    const dpi = invested > 0 ? (returns + distSumDollars) / invested : 0;
    return {
      lp_id: lp.id,
      fund_id: lp.fund_id,
      fund_name: lp.fund_name,
      commitment: invested + Math.max(0, Number(lp.commitment_amount || 0) - invested),
      invested_amount: invested,
      returns: returns,
      distributions_dollars: distSumDollars,
      tvpi: Number(tvpi.toFixed(3)),
      dpi: Number(dpi.toFixed(3)),
      lpa_signed: !!lp.lpa_signed,
    };
  });

  return c.json({
    ok: true,
    lp_holdings: lpRows,
    capital_calls: calls.results || [],
    distributions: distRows,
    performance: perfByLp,
  });
});

funds.get('/syndication', async (c) => {
  // Lightweight co-invest opportunities: open marketplace listings + pending capital calls.
  await requireAuth(c);
  const listings = await c.env.DB.prepare(
    `SELECT l.id AS listing_id, l.subsidiary_id, l.shares, l.asking_price_cents, l.ai_valuation_cents,
            s.subsidiary_name
       FROM secondary_listings l
       JOIN subsidiaries s ON s.id = l.subsidiary_id
      WHERE l.status = 'open' AND l.shares > 0
      ORDER BY l.created_at DESC LIMIT 50`
  ).all().catch(() => ({ results: [] }));
  const pendingCalls = await c.env.DB.prepare(
    `SELECT id, fund_id, payload, created_at FROM queue_jobs
      WHERE job_type IN ('capital_call', 'capital_call_notice') AND status IN ('pending','processing')
      ORDER BY created_at DESC LIMIT 20`
  ).all().catch(() => ({ results: [] }));
  return c.json({
    ok: true,
    co_invest_listings: listings.results || [],
    pending_capital_calls: pendingCalls.results || [],
  });
});

funds.get('/distributions', async (c) => {
  // Admin: all distributions for a given fund.
  await requireAdmin(c);
  const fundId = parseInt(c.req.query('fund_id') || '0', 10);
  if (!fundId) return c.json({ error: 'fund_id required' }, 400);
  const items = await Distributions.listByFund(c.env, fundId, 200);
  return c.json({ ok: true, items });
});

// /funds/:id MUST come AFTER all /funds/<word> handlers above.
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
  // LPA doc preview if any
  let lpa: any = null;
  if (f.lpa_doc_id) {
    lpa = await c.env.DB.prepare(
      `SELECT id, type, status, version, created_at, updated_at FROM legal_documents WHERE id = ?`
    ).bind(f.lpa_doc_id).first();
  }
  return c.json({
    ok: true,
    fund: { ...f, lp_count: agg?.lp_count ?? 0 },
    totals: { committed: agg?.total_committed ?? 0, invested: agg?.total_invested ?? 0 },
    lpa,
  });
});

funds.get('/:id/lpa', async (c) => {
  // Anyone authenticated can preview the LPA. Admin/LPs of the fund see content.
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  const f = await Funds.getById(c.env, id);
  if (!f?.lpa_doc_id) return c.json({ error: 'No LPA on file yet' }, 404);
  const doc: any = await c.env.DB.prepare(
    `SELECT * FROM legal_documents WHERE id = ?`
  ).bind(f.lpa_doc_id).first();
  if (!doc) return c.json({ error: 'doc not found' }, 404);
  // Admins always; LPs of this fund always; otherwise return metadata only.
  if (user.role !== 'admin') {
    const isLP = await c.env.DB.prepare(
      `SELECT 1 AS yes FROM limited_partners WHERE fund_id = ? AND user_id = ? LIMIT 1`
    ).bind(id, user.id).first<{ yes: number }>();
    if (!isLP) {
      const { content, ...meta } = doc;
      return c.json({ ok: true, doc: meta, redacted: true });
    }
  }
  return c.json({ ok: true, doc });
});

funds.post('/', async (c) => {
  await requireAdmin(c);
  const body = await c.req.json<Partial<{
    name: string; vintage_year: number; total_commitment: number;
    fund_size_cents: number; carried_interest: number; management_fee: number;
    status: 'fundraising' | 'active' | 'closed' | 'wound_down';
  }>>();
  if (!body?.name) return c.json({ error: 'name required' }, 400);
  const f = await Funds.create(c.env, body);
  if (!f) return c.json({ error: 'create failed' }, 500);
  // Auto-generate LPA via job queue (non-blocking).
  await enqueueJob(c.env, 'lpa_generation', { fund_id: f.id });
  return c.json({ ok: true, fund: f, lpa_status: 'enqueued' }, 201);
});

funds.patch('/:id', async (c) => {
  await requireAdmin(c);
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json();
  const f = await Funds.update(c.env, id, body);
  return c.json({ ok: true, fund: f });
});

funds.post('/:id/regenerate-lpa', async (c) => {
  await requireAdmin(c);
  const id = parseInt(c.req.param('id'), 10);
  // Clear any prior LPA doc reference so the worker re-generates.
  await c.env.DB.prepare(`UPDATE vc_funds SET lpa_doc_id = NULL WHERE id = ?`).bind(id).run();
  const job = await Jobs.enqueue(c.env, 'lpa_generation', { fund_id: id });
  return c.json({ ok: true, enqueued_job: job });
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
  if (!lp) return c.json({ error: 'create failed' }, 500);
  // First-call automation: enqueue a notice immediately if amount provided.
  if (body?.first_call_cents && body.first_call_cents > 0) {
    await Jobs.enqueue(c.env, 'capital_call_notice', { fund_id: fundId, amount_cents: body.first_call_cents });
  }
  return c.json({ ok: true, lp }, 201);
});

funds.post('/lps/:lpId/sign-lpa', async (c) => {
  // LP signs their LPA. The LP must be the current user (or admin acting).
  const user = await requireAuth(c);
  const lpId = parseInt(c.req.param('lpId'), 10);
  const lp = await LPs.getById(c.env, lpId);
  if (!lp) return c.json({ error: 'LP not found' }, 404);
  if (user.role !== 'admin' && lp.user_id !== user.id) {
    return c.json({ error: 'Not your LP record' }, 403);
  }
  const updated = await LPs.signLPA(c.env, lpId);
  if (!updated) return c.json({ error: 'Already signed or could not sign' }, 409);
  await logActivity(c.env, user.id, 'lpa_signed', {
    entityType: 'limited_partner', entityId: lpId, metadata: { fund_id: lp.fund_id },
  }).catch(() => {});
  return c.json({ ok: true, lp: updated });
});

// ---------- Capital call (event-driven → enqueue notices) ----------
funds.post('/:id/capital-call', async (c) => {
  await requireAdmin(c);
  const fundId = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<{ amount_cents?: number; amount?: number; note?: string }>();
  const amountCents = Math.round(body.amount_cents ?? Number(body.amount ?? 0) * 100);
  if (!amountCents || amountCents <= 0) return c.json({ error: 'amount/amount_cents must be > 0' }, 400);
  const job = await Jobs.enqueue(c.env, 'capital_call_notice', {
    fund_id: fundId, amount_cents: amountCents, note: body.note,
  });
  return c.json({ ok: true, enqueued_job: job });
});

// ---------- Distributions ----------
funds.post('/distributions/execute', async (c) => {
  // Admin manually triggers distribution from a liquidity event (or arbitrary cents).
  // fund_id is REQUIRED: the worker refuses to fan out across funds.
  const user = await requireAdmin(c);
  const body = await c.req.json<{
    fund_id: number;
    liquidity_event_id?: number;
    proceeds_cents: number;
    subsidiary_id?: number;
  }>();
  if (!body?.proceeds_cents || body.proceeds_cents <= 0) {
    return c.json({ error: 'proceeds_cents must be > 0' }, 400);
  }
  if (!body?.fund_id) {
    return c.json({ error: 'fund_id required (target a specific fund)' }, 400);
  }
  // For manual runs without a real liquidity event, create a placeholder one
  // so source_liquidity_event_id is always non-null and distributions are auditable.
  let evtId = body.liquidity_event_id;
  if (!evtId) {
    const evt: any = await c.env.DB.prepare(
      `INSERT INTO liquidity_events (subsidiary_id, event_type, status, valuation_cents, shares_offered, executed_price_cents, executed_at)
       VALUES (?, 'distribution', 'executed', ?, 0, ?, datetime('now')) RETURNING id`
    ).bind(body.subsidiary_id ?? null, body.proceeds_cents, body.proceeds_cents).first();
    evtId = evt?.id;
  }
  const job = await Jobs.enqueue(c.env, 'returns_distribution', {
    liquidity_event_id: evtId,
    fund_id: body.fund_id,
    proceeds_cents: body.proceeds_cents,
    subsidiary_id: body.subsidiary_id,
  });
  await logActivity(c.env, user.id, 'distribution_triggered', {
    entityType: 'fund', entityId: body.fund_id ?? 0,
    metadata: { proceeds_cents: body.proceeds_cents, liquidity_event_id: evtId },
  }).catch(() => {});
  return c.json({ ok: true, enqueued_job: job, liquidity_event_id: evtId });
});

funds.post('/distributions/:id/mark-paid', async (c) => {
  await requireAdmin(c);
  const id = parseInt(c.req.param('id'), 10);
  // Atomic: only credit the LP if we successfully transitioned pending → paid.
  // We fetch the row first to know the LP/amount, then run both writes in a batch
  // gated on a conditional UPDATE so a concurrent caller can't double-credit.
  const row = await c.env.DB.prepare(
    `SELECT id, lp_id, amount_cents, status FROM fund_distributions WHERE id = ?`
  ).bind(id).first<{ id: number; lp_id: number; amount_cents: number; status: string }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.status !== 'pending') return c.json({ error: 'already settled' }, 409);

  const dollars = row.amount_cents / 100;
  const [updRes, _lpRes] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE fund_distributions
          SET status = 'paid', distributed_at = datetime('now')
        WHERE id = ? AND status = 'pending'`
    ).bind(id),
    c.env.DB.prepare(
      `UPDATE limited_partners
          SET returns = returns + ?, updated_at = datetime('now')
        WHERE id = ?
          AND EXISTS (SELECT 1 FROM fund_distributions WHERE id = ? AND status = 'pending')`
    ).bind(dollars, row.lp_id, id),
  ]);
  // If the conditional UPDATE didn't fire, no LP credit happened either.
  // @ts-ignore — D1 result shape: meta.changes
  const changed = (updRes as any)?.meta?.changes ?? 0;
  if (!changed) return c.json({ error: 'lost race; already settled' }, 409);
  return c.json({
    ok: true,
    distribution: { ...row, status: 'paid' },
  });
});

export default funds;
