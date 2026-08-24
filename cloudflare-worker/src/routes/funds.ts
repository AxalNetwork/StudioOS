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
import { requireAdmin, requireAuth, requireApprovedKyc } from '../auth';
import { Funds, LPs } from '../models/funds';
import { Jobs } from '../models/jobs';
import { enqueueJob } from '../services/queue';
import { Distributions } from '../models/distributions';
import { logActivity } from './partnernet';
import { clampLimit } from '../util/pagination';
import { ensureFundGpColumns } from '../services/fundGpSchema';

const funds = new Hono<{ Bindings: Env }>();

/** GP narrative for a period. Prose is authored, never generated. */
interface PeriodNarrative {
  letter?: string[];
  developments?: Array<{ date: string; title: string; body: string }>;
  outlook?: string[];
  subsequent?: Array<{ d: string; e: string }>;
}

const parseJson = <T,>(raw: unknown, fallback: T): T => {
  if (typeof raw !== 'string' || !raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};


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
  // listByUser selects the fund's GP-of-record and service-provider columns so a
  // quarterly report can name the responsible fiduciary without an admin call.
  await ensureFundGpColumns(c.env);
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
      fund_slug: lp.fund_slug ?? null,
      commitment: invested + Math.max(0, Number(lp.commitment_amount || 0) - invested),
      invested_amount: invested,
      returns: returns,
      distributions_dollars: distSumDollars,
      tvpi: Number(tvpi.toFixed(3)),
      dpi: Number(dpi.toFixed(3)),
      lpa_signed: !!lp.lpa_signed,
      commitment_date: lp.commitment_date ?? null,
    };
  });

  return c.json({
    ok: true,
    lp_holdings: lpRows,
    capital_calls: calls.results || [],
    distributions: distRows,
    performance: perfByLp,
    // The signer and the firms an LP-facing document names, per fund the caller
    // actually holds. Absent values stay null — the document says "not
    // recorded" rather than naming a fiduciary the database has not been told
    // about. See migration 163.
    funds: fundFacts(lpRows),
    // Who the report is for. The caller's own account, echoed so the document
    // never has to guess a name from a session the renderer cannot see.
    recipient: { name: user.name ?? null, email: user.email ?? null },
    // ISSUED periods only, for the funds this caller actually holds. The report
    // archive lists these; a draft period is the GP's working copy and is not an
    // LP-facing document until it is issued.
    report_periods: await issuedPeriods(c.env, lpRows.map((r: any) => r.fund_id)),
  });
});

/** Issued reporting periods for the given funds, newest first. */
async function issuedPeriods(env: Env, fundIds: number[]) {
  const ids = [...new Set(fundIds.filter((n) => Number.isFinite(n)))];
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  // `notes` carries the GP's letter and commentary for the period. It travels
  // with an ISSUED period on purpose: that letter is the document. `snapshot_json`
  // is deliberately NOT selected — it is the GP's frozen working copy of
  // fund-level figures, and the LP's report is rendered from the same live model
  // the workspace shows them.
  const r = await env.DB.prepare(
    `SELECT id, fund_id, period, period_start, period_end, issued_at, status, notes
       FROM fund_report_periods
      WHERE fund_id IN (${marks}) AND status = 'issued'
      ORDER BY period_end DESC LIMIT 40`
  ).bind(...ids).all().catch(() => ({ results: [] }));
  return (r.results || []).map((row: any) => ({
    ...row,
    notes: undefined,
    narrative: parseJson<PeriodNarrative>(row?.notes, {}),
  }));
}

/**
 * Per-fund GP-of-record + provider facts, keyed by fund id, from rows that
 * already carry them (LPs.listByUser joins vc_funds). Shared by the LP self-view
 * and the GP's per-LP report endpoint so both documents state the same thing.
 */
function fundFacts(rows: any[]) {
  const out: Record<string, any> = {};
  for (const r of rows) {
    if (out[r.fund_id]) continue;
    out[r.fund_id] = {
      fund_id: r.fund_id,
      name: r.fund_name ?? null,
      slug: r.fund_slug ?? null,
      vintage_year: r.fund_vintage ?? null,
      management_fee: r.management_fee ?? null,
      carried_interest: r.carried_interest ?? null,
      gp: {
        name: r.gp_name ?? null,
        title: r.gp_title ?? null,
        email: r.gp_email ?? null,
        entity: r.gp_entity ?? null,
      },
      providers: {
        fund_admin: r.fund_admin ?? null,
        auditor: r.auditor ?? null,
        legal_counsel: r.legal_counsel ?? null,
        custodian: r.custodian ?? null,
        valuation_policy: r.valuation_policy ?? null,
      },
    };
  }
  return out;
}

funds.get('/syndication', async (c) => {
  // Lightweight co-invest opportunities: open marketplace listings + pending capital calls.
  await requireAuth(c);
  // T17 — clamp ?limit=N (default 20, max 50) for both lists.
  const limit = clampLimit(c.req.query('limit'), 20, 50);
  const listings = await c.env.DB.prepare(
    `SELECT l.id AS listing_id, l.subsidiary_id, l.shares, l.asking_price_cents, l.ai_valuation_cents,
            s.subsidiary_name
       FROM secondary_listings l
       JOIN subsidiaries s ON s.id = l.subsidiary_id
      WHERE l.status = 'open' AND l.shares > 0
      ORDER BY l.created_at DESC LIMIT ?`
  ).bind(limit).all().catch(() => ({ results: [] }));
  const pendingCalls = await c.env.DB.prepare(
    `SELECT id, fund_id, payload, created_at FROM queue_jobs
      WHERE job_type IN ('capital_call', 'capital_call_notice') AND status IN ('pending','processing')
      ORDER BY created_at DESC LIMIT ?`
  ).bind(limit).all().catch(() => ({ results: [] }));
  return c.json({
    ok: true,
    co_invest_listings: listings.results || [],
    pending_capital_calls: pendingCalls.results || [],
    limit,
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
  // Security #8 — storage cleanup:
  // The LPA body is NEVER inlined in the JSON response, regardless of
  // viewer role. Admins/LPs of this fund get `file_key` so the body can
  // be fetched via a separate download path; non-LPs get metadata only
  // (no `file_key`) so they can't even attempt a download.
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  const f = await Funds.getById(c.env, id);
  if (!f?.lpa_doc_id) return c.json({ error: 'No LPA on file yet' }, 404);
  const doc: any = await c.env.DB.prepare(
    `SELECT * FROM legal_documents WHERE id = ?`
  ).bind(f.lpa_doc_id).first();
  if (!doc) return c.json({ error: 'doc not found' }, 404);

  // Strip the inline body for everyone. `file_sha256` is admin-only
  // legal-proof material; admins keep it.
  const { content: _content, file_sha256, ...rest } = doc;
  let safeDoc: any = { ...rest };
  if (user.role === 'admin') {
    safeDoc.file_sha256 = file_sha256;
  }

  if (user.role !== 'admin') {
    const isLP = await c.env.DB.prepare(
      `SELECT 1 AS yes FROM limited_partners WHERE fund_id = ? AND user_id = ? LIMIT 1`
    ).bind(id, user.id).first<{ yes: number }>();
    if (!isLP) {
      // Non-LP, non-admin: drop `file_key` so they cannot attempt a
      // download; return non-sensitive metadata only.
      const { file_key, file_size, file_content_type, ...meta } = safeDoc;
      return c.json({ ok: true, doc: meta, redacted: true });
    }
  }
  // Admin or LP: return metadata + file_key. Frontend should issue a
  // download via a short-lived signed URL endpoint (TODO: port the
  // FastAPI `/api/files/contracts/{token}` minting flow into the worker
  // so the LPADrawer's `Download LPA` button has a `content_url` to
  // hit). Until then, this response is correct-by-default — no body
  // leaks via JSON.
  return c.json({ ok: true, doc: safeDoc });
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

// ---------- quarterly reporting periods ----------
//
// A period row is what makes a quarterly report REPRODUCIBLE. The capital
// account can be reconstructed as-of any date from dated capital_calls and
// fund_distributions rows, but portfolio MARKS cannot — position values live in
// an operator-maintained model with no history — so a report re-rendered next
// year under an old heading would silently carry today's marks. Issuing a period
// freezes the fund-level figures into `snapshot_json`, and the GP's own
// commentary into `notes`, so every later download of that period is the
// document that was actually sent.
//
// Until a period is issued, every report generated for it is a DRAFT: the
// renderer marks it as such, because a report with no GP letter is not a report
// a fiduciary has stood behind.

const shapePeriod = (row: any) => ({
  ...row,
  narrative: parseJson<PeriodNarrative>(row?.notes, {}),
  snapshot: parseJson<Record<string, unknown> | null>(row?.snapshot_json, null),
});

funds.get('/:id/report-periods', async (c) => {
  await requireAdmin(c);
  await ensureFundGpColumns(c.env);
  const fundId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(fundId)) return c.json({ error: 'bad id' }, 400);
  const r = await c.env.DB.prepare(
    `SELECT * FROM fund_report_periods WHERE fund_id = ? ORDER BY period_end DESC LIMIT 40`
  ).bind(fundId).all().catch(() => ({ results: [] }));
  return c.json({ ok: true, items: (r.results || []).map(shapePeriod) });
});

/**
 * Create or update a reporting period, and optionally issue it.
 *
 * Issuing is one-way on purpose: once `status = 'issued'`, the snapshot and the
 * narrative are the record of what LPs received. A later edit would rewrite
 * history under a document already in an LP's inbox, so the route refuses it
 * and asks for a correcting period instead.
 */
funds.post('/:id/report-periods', async (c) => {
  const admin = await requireAdmin(c);
  await ensureFundGpColumns(c.env);
  const fundId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(fundId)) return c.json({ error: 'bad id' }, 400);

  const body = await c.req.json().catch(() => ({} as any));
  const period = String(body?.period || '').trim();
  const periodStart = String(body?.period_start || '').trim();
  const periodEnd = String(body?.period_end || '').trim();
  if (!period || !periodStart || !periodEnd) {
    return c.json({ error: 'period, period_start and period_end are required' }, 400);
  }
  if (periodEnd < periodStart) return c.json({ error: 'period_end precedes period_start' }, 400);

  const existing: any = await c.env.DB.prepare(
    `SELECT * FROM fund_report_periods WHERE fund_id = ? AND period = ?`
  ).bind(fundId, period).first();
  if (existing?.status === 'issued') {
    return c.json({ error: 'period already issued — issue a correcting period instead' }, 409);
  }

  const notes = body?.narrative === undefined
    ? (existing?.notes ?? null)
    : JSON.stringify(body.narrative ?? {});
  const issue = body?.issue === true;
  // The snapshot is only meaningful at issue: a draft is always re-rendered
  // from live figures, which is what makes it a draft.
  const snapshot = issue ? JSON.stringify(body?.snapshot ?? {}) : (existing?.snapshot_json ?? null);

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE fund_report_periods
          SET period_start = ?, period_end = ?, notes = ?, snapshot_json = ?,
              status = ?, issued_at = ?, issued_by = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).bind(
      periodStart, periodEnd, notes, snapshot,
      issue ? 'issued' : 'draft',
      issue ? new Date().toISOString() : null,
      issue ? admin.id : null,
      existing.id,
    ).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO fund_report_periods
         (fund_id, period, period_start, period_end, notes, snapshot_json, status, issued_at, issued_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      fundId, period, periodStart, periodEnd, notes, snapshot,
      issue ? 'issued' : 'draft',
      issue ? new Date().toISOString() : null,
      issue ? admin.id : null,
    ).run();
  }

  const row: any = await c.env.DB.prepare(
    `SELECT * FROM fund_report_periods WHERE fund_id = ? AND period = ?`
  ).bind(fundId, period).first();
  return c.json({ ok: true, period: row ? shapePeriod(row) : null }, existing ? 200 : 201);
});

/**
 * GP view of ONE limited partner's reporting data, in the same shape
 * `/lp-portal` returns for the caller's own position — so the quarterly-report
 * renderer is one code path whether an LP downloads their own statement or the
 * GP produces it on their behalf.
 *
 * Admin-only, and deliberately narrow: it answers for a single named LP of a
 * single named fund, so it cannot be used to enumerate the LP register (that is
 * already what GET /:id/lps is for, under the same gate).
 */
funds.get('/:id/lp-report/:lpId', async (c) => {
  await requireAdmin(c);
  await ensureFundGpColumns(c.env);
  const fundId = parseInt(c.req.param('id'), 10);
  const lpId = parseInt(c.req.param('lpId'), 10);
  if (!Number.isFinite(fundId) || !Number.isFinite(lpId)) {
    return c.json({ error: 'bad id' }, 400);
  }

  // One row, and it must belong to the named fund: an LP id from another fund
  // would otherwise render under this fund's letterhead.
  const lp: any = await c.env.DB.prepare(
    `SELECT lp.*,
            COALESCE(u.name,  lp.name)  AS lp_display_name,
            COALESCE(u.email, lp.email) AS lp_display_email,
            f.name AS fund_name, f.status AS fund_status, f.carried_interest, f.management_fee,
            f.slug AS fund_slug, f.vintage_year AS fund_vintage,
            f.gp_name, f.gp_title, f.gp_email, f.gp_entity,
            f.fund_admin, f.auditor, f.legal_counsel, f.custodian, f.valuation_policy
       FROM limited_partners lp
       JOIN vc_funds f ON f.id = lp.fund_id
       LEFT JOIN users u ON u.id = lp.user_id
      WHERE lp.id = ? AND lp.fund_id = ?`
  ).bind(lpId, fundId).first();
  if (!lp) return c.json({ error: 'not found' }, 404);

  const calls = await c.env.DB.prepare(
    `SELECT * FROM capital_calls WHERE limited_partner_id = ? ORDER BY created_at DESC LIMIT 50`
  ).bind(lpId).all().catch(() => ({ results: [] }));

  const dists: any[] = (await c.env.DB.prepare(
    `SELECT d.*, f.name AS fund_name
       FROM fund_distributions d JOIN vc_funds f ON f.id = d.fund_id
      WHERE d.lp_id = ? ORDER BY d.created_at DESC LIMIT 200`
  ).bind(lpId).all().catch(() => ({ results: [] }))).results || [];

  // Same arithmetic as /lp-portal — kept identical on purpose so the GP's copy
  // of a statement and the LP's own copy can never disagree.
  const distSumDollars = dists.reduce((s: number, d: any) => s + Number(d.amount_cents || 0) / 100, 0);
  const invested = Number(lp.invested_amount || 0);
  const returns = Number(lp.returns || 0);
  const tvpi = invested > 0 ? (invested + returns + distSumDollars) / invested : 0;
  const dpi = invested > 0 ? (returns + distSumDollars) / invested : 0;

  return c.json({
    ok: true,
    lp_holdings: [lp],
    capital_calls: calls.results || [],
    distributions: dists,
    performance: [{
      lp_id: lp.id,
      fund_id: lp.fund_id,
      fund_name: lp.fund_name,
      fund_slug: lp.fund_slug ?? null,
      commitment: invested + Math.max(0, Number(lp.commitment_amount || 0) - invested),
      invested_amount: invested,
      returns,
      distributions_dollars: distSumDollars,
      tvpi: Number(tvpi.toFixed(3)),
      dpi: Number(dpi.toFixed(3)),
      lpa_signed: !!lp.lpa_signed,
      commitment_date: lp.commitment_date ?? null,
    }],
    funds: fundFacts([lp]),
    recipient: { name: lp.lp_display_name ?? null, email: lp.lp_display_email ?? null },
  });
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
  // LP signs their LPA. Binding signature → enforce KYC. Limited-access
  // users (kyc !== 'approved') are blocked; admins still pass through.
  const user = await requireApprovedKyc(c);
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
