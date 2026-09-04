/**
 * T15 — Founder Needs / RFPs / Quotes / Engagements (port of needs.py).
 * Exports three Hono routers that index.ts mounts at /api/needs, /api/quotes,
 * /api/engagements respectively.
 *
 * Engagement transitions: accepted → in_progress → delivered → reviewed → invoiced
 * (cancelled is terminal from any non-terminal state).
 */
import { Hono } from 'hono';
import { activeCompanyFor } from '../middleware/activeCompany';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { isAdmin, isPartner, isFounder, mapError, nowIso, newUid } from './_t13t14t15_helpers';
import { issueInvoice, invoiceDto } from '../services/engagementInvoices';
import {
  analysePipeline, weightedPipeline, analyseDelivery, analyseByShape, analyseByQuarter,
  type QuoteRow as QuoteAnalyticsRow, type EngagementRow as EngagementAnalyticsRow,
} from '../services/bdAnalytics';

// Mirror FastAPI VALID_CATEGORIES (kept loose for forward-compat).
const VALID_CATEGORIES = new Set([
  'design', 'engineering', 'legal', 'finance', 'marketing', 'sales',
  'recruiting', 'ops', 'pr', 'data', 'ai_ml', 'product', 'research', 'other',
]);
const VALID_NEED_STATUSES = new Set(['open', 'in_review', 'closed', 'filled']);

type Need = {
  id: number; uid: string; project_id: number; founder_id: number;
  category: string; title: string; description: string;
  budget_min: number | null; budget_max: number | null;
  timeline: string | null; status: string;
  created_at: string; updated_at: string;
};
type RFP = {
  id: number; uid: string; need_id: number;
  scope_md: string; deliverables_md: string | null;
  deadline_at: string | null; status: string;
  created_at: string; updated_at: string;
};
type Quote = {
  id: number; uid: string; need_id: number; rfp_id: number | null;
  partner_id: number; price: number; timeline_weeks: number | null;
  deliverables: string; notes: string | null;
  status: string; decided_at: string | null;
  created_at: string; updated_at: string;
};
type Engagement = {
  id: number; uid: string; need_id: number; quote_id: number;
  partner_id: number; founder_id: number; project_id: number;
  price: number; status: string;
  delivered_at: string | null; delivery_notes: string | null;
  cancelled_at: string | null; cancel_reason: string | null;
  invoice_id: string | null; invoiced_at: string | null;
  created_at: string; updated_at: string;
};

async function needDto(env: Env, n: Need): Promise<any> {
  const proj = await env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(n.project_id).first<{ name: string }>();
  const rfp = await env.DB.prepare('SELECT * FROM rfps WHERE need_id = ?').bind(n.id).first<RFP>();
  const cnt = await env.DB.prepare('SELECT COUNT(*) c FROM quotes WHERE need_id = ?').bind(n.id).first<{ c: number }>();
  return {
    id: n.id, uid: n.uid, project_id: n.project_id,
    project_name: proj?.name || null,
    founder_id: n.founder_id, category: n.category,
    title: n.title, description: n.description,
    budget_min: n.budget_min, budget_max: n.budget_max,
    timeline: n.timeline, status: n.status,
    created_at: n.created_at, updated_at: n.updated_at,
    quote_count: Number(cnt?.c || 0),
    rfp: rfp ? {
      id: rfp.id, uid: rfp.uid, need_id: rfp.need_id,
      scope_md: rfp.scope_md, deliverables_md: rfp.deliverables_md,
      deadline_at: rfp.deadline_at, status: rfp.status, created_at: rfp.created_at,
    } : null,
  };
}

async function quoteDto(env: Env, q: Quote): Promise<any> {
  // No `kyb_status` column exists on `partners` — nor on any table in this
  // schema; the KYB flow lives behind /trust/kyb/* and does not write one.
  // Naming it here threw, and this `.first()` is unguarded, so building a
  // quote DTO failed outright. `kyb_verified` is now null rather than false:
  // "we have no record" is not the same claim as "this partner is not
  // verified", and a trust signal is exactly where that distinction matters.
  const partner = await env.DB.prepare('SELECT name, company FROM partners WHERE id = ?').bind(q.partner_id).first<any>();
  return {
    id: q.id, uid: q.uid, need_id: q.need_id, rfp_id: q.rfp_id,
    partner_id: q.partner_id,
    partner_name: partner?.name || null,
    partner_company: partner?.company || null,
    kyb_verified: null,
    price: q.price, timeline_weeks: q.timeline_weeks,
    deliverables: q.deliverables, notes: q.notes,
    status: q.status, decided_at: q.decided_at,
    created_at: q.created_at, updated_at: q.updated_at,
  };
}

function engagementDto(e: Engagement): any { return { ...e }; }

// ---------------------------------------------------------------------------
// /api/needs
// ---------------------------------------------------------------------------
const needs = new Hono<{ Bindings: Env }>();

function isNeedOwner(n: Need, u: User): boolean {
  return isFounder(u) && !!u.founder_id && u.founder_id === n.founder_id;
}

needs.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    const status = c.req.query('status');
    const category = c.req.query('category');
    const projectId = c.req.query('project_id');
    let where = '1=1';
    const params: any[] = [];
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (category) { where += ' AND category = ?'; params.push(category); }
    if (projectId) { where += ' AND project_id = ?'; params.push(Number(projectId)); }
    // Founders see only their own needs by default; partners/admin/investor see all open ones.
    if (isFounder(user)) {
      where += ' AND founder_id = ?'; params.push(user.founder_id ?? -1);
    } else if (isPartner(user)) {
      // Partners only see open/in_review needs (browsing demand).
      where += " AND status IN ('open','in_review')";
    }
    const rows = await c.env.DB.prepare(
      `SELECT * FROM founder_needs WHERE ${where} ORDER BY created_at DESC LIMIT 200`
    ).bind(...params).all<Need>();
    const items: any[] = [];
    for (const n of rows.results || []) items.push(await needDto(c.env, n));
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

needs.post('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isFounder(user) && !isAdmin(user)) return c.json({ detail: 'Founder role required' }, 403);
    if (!user.founder_id && !isAdmin(user)) return c.json({ detail: 'No founder profile' }, 400);
    const body = await c.req.json().catch(() => ({} as any));
    const cat = String(body.category || '').toLowerCase();
    if (!VALID_CATEGORIES.has(cat)) return c.json({ detail: `category must be one of ${[...VALID_CATEGORIES]}` }, 400);
    const title = String(body.title || '').trim();
    const description = String(body.description || '').trim();
    if (!title || !description) return c.json({ detail: 'title and description required' }, 400);
    const projectId = Number(body.project_id);
    const project = await c.env.DB.prepare('SELECT founder_id FROM projects WHERE id = ?').bind(projectId).first<{ founder_id: number }>();
    if (!project) return c.json({ detail: 'Project not found' }, 404);
    if (!isAdmin(user) && project.founder_id !== user.founder_id) return c.json({ detail: 'Not your project' }, 403);
    const uid = newUid();
    const ins = await c.env.DB.prepare(
      `INSERT INTO founder_needs
         (uid, project_id, founder_id, category, title, description,
          budget_min, budget_max, timeline, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    ).bind(uid, projectId, project.founder_id, cat, title.slice(0, 300), description.slice(0, 8000),
           body.budget_min != null ? Number(body.budget_min) : null,
           body.budget_max != null ? Number(body.budget_max) : null,
           body.timeline || null, nowIso(), nowIso()).run();
    const n = await c.env.DB.prepare('SELECT * FROM founder_needs WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<Need>();
    return c.json(await needDto(c.env, n!));
  } catch (e) { return mapError(c, e); }
});

needs.get('/:id', async (c) => {
  try {
    await requireAuth(c);
    const id = Number(c.req.param('id'));
    const n = await c.env.DB.prepare('SELECT * FROM founder_needs WHERE id = ?').bind(id).first<Need>();
    if (!n) return c.json({ detail: 'Need not found' }, 404);
    return c.json(await needDto(c.env, n));
  } catch (e) { return mapError(c, e); }
});

needs.patch('/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const id = Number(c.req.param('id'));
    const n = await c.env.DB.prepare('SELECT * FROM founder_needs WHERE id = ?').bind(id).first<Need>();
    if (!n) return c.json({ detail: 'Need not found' }, 404);
    if (!isAdmin(user) && !isNeedOwner(n, user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    if (body.category && !VALID_CATEGORIES.has(String(body.category).toLowerCase())) {
      return c.json({ detail: 'invalid category' }, 400);
    }
    if (body.status && !VALID_NEED_STATUSES.has(String(body.status))) {
      return c.json({ detail: 'invalid status' }, 400);
    }
    const fields = ['title', 'description', 'category', 'budget_min', 'budget_max', 'timeline', 'status'] as const;
    const sets: string[] = []; const params: any[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) { sets.push(`${f} = ?`); params.push(body[f]); }
    }
    if (sets.length) {
      sets.push('updated_at = ?'); params.push(nowIso()); params.push(id);
      await c.env.DB.prepare(`UPDATE founder_needs SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
    }
    const fresh = await c.env.DB.prepare('SELECT * FROM founder_needs WHERE id = ?').bind(id).first<Need>();
    return c.json(await needDto(c.env, fresh!));
  } catch (e) { return mapError(c, e); }
});

needs.delete('/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const id = Number(c.req.param('id'));
    const n = await c.env.DB.prepare('SELECT * FROM founder_needs WHERE id = ?').bind(id).first<Need>();
    if (!n) return c.json({ detail: 'Need not found' }, 404);
    if (!isAdmin(user) && !isNeedOwner(n, user)) return c.json({ detail: 'Forbidden' }, 403);
    await c.env.DB.prepare('DELETE FROM founder_needs WHERE id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM rfps WHERE need_id = ?').bind(id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

needs.post('/:id/rfp', async (c) => {
  try {
    const user = await requireAuth(c);
    const id = Number(c.req.param('id'));
    const n = await c.env.DB.prepare('SELECT * FROM founder_needs WHERE id = ?').bind(id).first<Need>();
    if (!n) return c.json({ detail: 'Need not found' }, 404);
    if (!isAdmin(user) && !isNeedOwner(n, user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const scope = String(body.scope_md || '').trim();
    if (!scope) return c.json({ detail: 'scope_md required' }, 400);
    const existing = await c.env.DB.prepare('SELECT * FROM rfps WHERE need_id = ?').bind(id).first<RFP>();
    if (existing) {
      await c.env.DB.prepare(
        `UPDATE rfps SET scope_md=?, deliverables_md=?, deadline_at=?, updated_at=? WHERE id = ?`
      ).bind(scope, body.deliverables_md || null, body.deadline_at || null, nowIso(), existing.id).run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO rfps (uid, need_id, scope_md, deliverables_md, deadline_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`
      ).bind(newUid(), id, scope, body.deliverables_md || null, body.deadline_at || null, nowIso(), nowIso()).run();
    }
    const fresh = await c.env.DB.prepare('SELECT * FROM founder_needs WHERE id = ?').bind(id).first<Need>();
    return c.json(await needDto(c.env, fresh!));
  } catch (e) { return mapError(c, e); }
});

needs.post('/:id/quotes', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isPartner(user) && !isAdmin(user)) return c.json({ detail: 'Partner role required' }, 403);
    if (!user.partner_id && !isAdmin(user)) return c.json({ detail: 'No partner profile' }, 400);
    const id = Number(c.req.param('id'));
    const n = await c.env.DB.prepare('SELECT * FROM founder_needs WHERE id = ?').bind(id).first<Need>();
    if (!n) return c.json({ detail: 'Need not found' }, 404);
    if (!['open', 'in_review'].includes(n.status)) return c.json({ detail: 'Need is not accepting quotes' }, 409);
    const body = await c.req.json().catch(() => ({} as any));
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) return c.json({ detail: 'price must be > 0' }, 400);
    const deliverables = String(body.deliverables || '').trim();
    if (!deliverables) return c.json({ detail: 'deliverables required' }, 400);
    const rfp = await c.env.DB.prepare('SELECT id FROM rfps WHERE need_id = ?').bind(id).first<{ id: number }>();
    const uid = newUid();
    try {
      const ins = await c.env.DB.prepare(
        `INSERT INTO quotes
          (uid, need_id, rfp_id, partner_id, price, timeline_weeks, deliverables, notes, status, created_at, updated_at, company_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)`
      // Company scoping, stage 8: the bid records the agency that made it, and
      // the engagement created when a founder accepts inherits it from here.
      ).bind(uid, id, rfp?.id ?? null, user.partner_id || (isAdmin(user) ? Number(body.partner_id || 0) : 0),
             price, body.timeline_weeks != null ? Number(body.timeline_weeks) : null,
             deliverables.slice(0, 4000), body.notes ? String(body.notes).slice(0, 2000) : null,
             nowIso(), nowIso(), await activeCompanyFor(c, user)).run();
      const q = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?')
        .bind((ins as any).meta?.last_row_id).first<Quote>();
      return c.json(await quoteDto(c.env, q!));
    } catch (e: any) {
      if (String(e?.message || e).includes('UNIQUE')) {
        return c.json({ detail: 'You already submitted a quote for this need' }, 409);
      }
      throw e;
    }
  } catch (e) { return mapError(c, e); }
});

needs.get('/:id/quotes', async (c) => {
  try {
    const user = await requireAuth(c);
    const id = Number(c.req.param('id'));
    const n = await c.env.DB.prepare('SELECT * FROM founder_needs WHERE id = ?').bind(id).first<Need>();
    if (!n) return c.json({ detail: 'Need not found' }, 404);
    const rows = await c.env.DB.prepare('SELECT * FROM quotes WHERE need_id = ? ORDER BY created_at ASC').bind(id).all<Quote>();
    const visible: any[] = [];
    for (const q of rows.results || []) {
      const canSee = isAdmin(user) ||
        isNeedOwner(n, user) ||
        (isPartner(user) && user.partner_id === q.partner_id);
      if (canSee) visible.push(await quoteDto(c.env, q));
    }
    return c.json({ items: visible });
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// /api/quotes
// ---------------------------------------------------------------------------
const quotesRouter = new Hono<{ Bindings: Env }>();

quotesRouter.get('/me', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isPartner(user) && !isAdmin(user)) return c.json({ items: [] });
    // Company scoping, stage 8. "My quotes" is a claim about THIS agency.
    // The admin arm is an oversight view and is deliberately left wide — the
    // same exemption every stage of this rollout has honoured, and the reason
    // each file's exemption set has to be read rather than copied.
    const companyId = isAdmin(user) ? null : await activeCompanyFor(c, user);
    const rows = await (
      isAdmin(user)
        ? c.env.DB.prepare('SELECT * FROM quotes ORDER BY created_at DESC LIMIT 200')
        : companyId !== null
          ? c.env.DB.prepare(
              `SELECT * FROM quotes
                WHERE partner_id = ? AND (company_id = ? OR company_id IS NULL)
                ORDER BY created_at DESC LIMIT 200`,
            ).bind(user.partner_id ?? -1, companyId)
          : c.env.DB.prepare(
              'SELECT * FROM quotes WHERE partner_id = ? ORDER BY created_at DESC LIMIT 200',
            ).bind(user.partner_id ?? -1)
    ).all<Quote>();
    const items: any[] = [];
    for (const q of rows.results || []) items.push(await quoteDto(c.env, q));
    // Wave 1a — attach the need's title/status so the Operations "Proposals"
    // list can say what each quote was FOR. Additive keys; batch lookup
    // (placeholders only — no values are interpolated into the SQL text).
    const needIds = [...new Set(items.map((i) => i.need_id).filter((n) => Number.isFinite(n)))];
    if (needIds.length) {
      const ph = needIds.map(() => '?').join(',');
      const needRows = await c.env.DB.prepare(
        `SELECT id, title, status, category FROM founder_needs WHERE id IN (${ph})`,
      ).bind(...needIds).all<any>();
      const byId = new Map((needRows.results || []).map((n: any) => [n.id, n]));
      for (const it of items) {
        const n = byId.get(it.need_id);
        it.need_title = n?.title ?? null;
        it.need_status = n?.status ?? null;
        it.need_category = n?.category ?? null;
      }
    }
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

/**
 * Build queue #122 — GET /api/quotes/analytics
 *
 * BD pipeline analytics for a service partner: win rate, weighted
 * forecast, cycle time, and delivery health, computed in
 * services/bdAnalytics.ts. Scoped exactly like /quotes/me — a partner
 * sees only their own quotes; admin sees all.
 *
 * The win rate's denominator is decided quotes only. Open and withdrawn
 * are returned separately so the UI can show what was excluded rather
 * than presenting a bare percentage.
 *
 * `by_shape` and `by_quarter` were added for the Pipeline canvas's Analytics
 * zone, which asks for the same rate decomposed two ways. Both are derived
 * from columns the store already holds — a quote's status, its two timestamps
 * and, through the need it answers, that need's `category`. `loss_reasons` is
 * returned as null with its reason attached: nothing records why a quote was
 * rejected, and a taxonomy inferred from a bare status would be a guess.
 */
quotesRouter.get('/analytics', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isPartner(user) && !isAdmin(user)) {
      return c.json({ pipeline: null, forecast: null, delivery: null });
    }
    const admin = isAdmin(user);
    // The analytics must answer for the SAME set of rows the lists show, or a
    // partner reads a win rate for one agency beside a pipeline for another.
    const analyticsCompany = admin ? null : await activeCompanyFor(c, user);
    // `n.category AS shape` is a LEFT join on purpose: a quote whose need row
    // is missing must still count toward the headline win rate. An INNER join
    // would silently drop it and quietly change the denominator of the one
    // figure this endpoint exists to compute. Unmatched rows land in the
    // by-shape breakdown as an unrecorded shape, which is what they are.
    const quotes = await (
      admin
        ? c.env.DB.prepare(
            `SELECT q.status, q.price AS amount, q.created_at, q.decided_at, n.category AS shape
               FROM quotes q LEFT JOIN founder_needs n ON n.id = q.need_id
              ORDER BY q.created_at DESC LIMIT 1000`,
          )
        : analyticsCompany !== null
          ? c.env.DB.prepare(
              `SELECT q.status, q.price AS amount, q.created_at, q.decided_at, n.category AS shape
                 FROM quotes q LEFT JOIN founder_needs n ON n.id = q.need_id
                WHERE q.partner_id = ? AND (q.company_id = ? OR q.company_id IS NULL)
                ORDER BY q.created_at DESC LIMIT 1000`,
            ).bind(user.partner_id ?? -1, analyticsCompany)
          : c.env.DB.prepare(
              `SELECT q.status, q.price AS amount, q.created_at, q.decided_at, n.category AS shape
                 FROM quotes q LEFT JOIN founder_needs n ON n.id = q.need_id
                WHERE q.partner_id = ? ORDER BY q.created_at DESC LIMIT 1000`,
            ).bind(user.partner_id ?? -1)
    ).all<QuoteAnalyticsRow>();
    const engagements = await (
      admin
        ? c.env.DB.prepare(
            'SELECT status, price AS amount FROM engagements ORDER BY created_at DESC LIMIT 1000',
          )
        : analyticsCompany !== null
          ? c.env.DB.prepare(
              `SELECT status, price AS amount FROM engagements
                WHERE partner_id = ? AND (company_id = ? OR company_id IS NULL)
                ORDER BY created_at DESC LIMIT 1000`,
            ).bind(user.partner_id ?? -1, analyticsCompany)
          : c.env.DB.prepare(
              'SELECT status, price AS amount FROM engagements WHERE partner_id = ? ORDER BY created_at DESC LIMIT 1000',
            ).bind(user.partner_id ?? -1)
    ).all<EngagementAnalyticsRow>().catch(() => ({ results: [] as EngagementAnalyticsRow[] }));

    const q = quotes.results || [];
    return c.json({
      pipeline: analysePipeline(q),
      forecast: weightedPipeline(q),
      delivery: analyseDelivery(engagements.results || []),
      by_shape: analyseByShape(q),
      by_quarter: analyseByQuarter(q),
      // The canvas's third analytic block. Said here rather than only in the
      // page, so any future consumer of this endpoint reads the same reason.
      loss_reasons: null,
      loss_reasons_note:
        'Quotes record a status and the date it was decided. There is no loss reason, '
        + 'competitor or losing-price column anywhere, so a loss taxonomy would be inferred rather than read.',
    });
  } catch (e) { return mapError(c, e); }
});

async function quoteTransition(c: Context<{ Bindings: Env }>, target: 'accept' | 'reject' | 'withdraw') {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  const q = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first<Quote>();
  if (!q) return c.json({ detail: 'Quote not found' }, 404);
  const need = await c.env.DB.prepare('SELECT * FROM founder_needs WHERE id = ?').bind(q.need_id).first<Need>();
  if (!need) return c.json({ detail: 'Need missing' }, 404);
  if (target === 'withdraw') {
    if (!isAdmin(user) && !(isPartner(user) && user.partner_id === q.partner_id)) {
      return c.json({ detail: 'Forbidden' }, 403);
    }
    if (q.status !== 'submitted') return c.json({ detail: 'Only submitted quotes may be withdrawn' }, 409);
    await c.env.DB.prepare("UPDATE quotes SET status='withdrawn', decided_at=?, updated_at=? WHERE id=?")
      .bind(nowIso(), nowIso(), id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first<Quote>();
    return c.json(await quoteDto(c.env, fresh!));
  }
  // accept / reject — founder-owner only
  if (!isAdmin(user) && !isNeedOwner(need, user)) return c.json({ detail: 'Forbidden' }, 403);
  if (q.status !== 'submitted') return c.json({ detail: `Quote already ${q.status}` }, 409);
  if (target === 'reject') {
    await c.env.DB.prepare("UPDATE quotes SET status='rejected', decided_at=?, updated_at=? WHERE id=?")
      .bind(nowIso(), nowIso(), id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first<Quote>();
    return c.json(await quoteDto(c.env, fresh!));
  }
  // accept: only one accepted quote per need; close the need; create engagement.
  await c.env.DB.prepare(
    `UPDATE quotes SET status='rejected', decided_at=?, updated_at=?
     WHERE need_id = ? AND id != ? AND status = 'submitted'`
  ).bind(nowIso(), nowIso(), q.need_id, id).run();
  await c.env.DB.prepare("UPDATE quotes SET status='accepted', decided_at=?, updated_at=? WHERE id=?")
    .bind(nowIso(), nowIso(), id).run();
  await c.env.DB.prepare("UPDATE founder_needs SET status='filled', updated_at=? WHERE id=?")
    .bind(nowIso(), q.need_id).run();
  const eUid = newUid();
  try {
    await c.env.DB.prepare(
      `INSERT INTO engagements
         (uid, need_id, quote_id, partner_id, founder_id, project_id, price, status, created_at, updated_at, company_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?)`
    // The agency comes from the QUOTE, not from whoever accepted it. A founder
    // accepts under their own company; copying that here would file the
    // partner's engagement under the founder's firm. `company_id` on both
    // tables means the partner's agency and only that — the founder's side of
    // the same row is answered through project_id and migration 189.
    ).bind(eUid, q.need_id, q.id, q.partner_id, need.founder_id, need.project_id, q.price,
           nowIso(), nowIso(), (q as Quote & { company_id?: number | null }).company_id ?? null).run();
  } catch { /* idempotent — UNIQUE(quote_id) protects re-acceptance */ }
  const fresh = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first<Quote>();
  return c.json(await quoteDto(c.env, fresh!));
}

quotesRouter.post('/:id/accept', (c) => quoteTransition(c, 'accept'));
quotesRouter.post('/:id/reject', (c) => quoteTransition(c, 'reject'));
quotesRouter.post('/:id/withdraw', (c) => quoteTransition(c, 'withdraw'));

// ---------------------------------------------------------------------------
// /api/engagements
// ---------------------------------------------------------------------------
const engagementsRouter = new Hono<{ Bindings: Env }>();

/**
 * May this caller see this engagement, under the company they are acting for?
 *
 * Company scoping, stage 8. Only the PARTNER arm consults `companyId`, and the
 * asymmetry is the point: `engagements.company_id` records the partner's
 * AGENCY. A founder's side of the same row is answered through `project_id`
 * and migration 189, so testing the founder against a partner's agency column
 * would refuse them their own engagement.
 *
 * Ordered so ownership is proved first and the company only narrows what is
 * already the caller's — this decides a 403, so a company that could grant
 * rather than narrow would be a hole rather than a filter.
 *
 * A NULL company on the row means the partner had no primary company when it
 * was created; it stays visible under every one of theirs.
 */
function canSeeEngagement(e: Engagement, u: User, companyId: number | null = null): boolean {
  if (isAdmin(u)) return true;
  if (isPartner(u) && u.partner_id === e.partner_id) {
    const owning = (e as Engagement & { company_id?: number | null }).company_id ?? null;
    return companyId === null || owning === null || owning === companyId;
  }
  if (isFounder(u) && u.founder_id === e.founder_id) return true;
  return false;
}

engagementsRouter.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    let where = '1=1';
    const params: any[] = [];
    // Company scoping, stage 8, and the two branches ask DIFFERENT questions.
    // A partner's engagements narrow on `e.company_id` — their agency. A
    // founder's narrow on the PROJECT's company, because that is where a
    // founder's company lives (migration 189) and `e.company_id` is not
    // theirs to be tested against. Admin stays wide.
    const companyId = isAdmin(user) ? null : await activeCompanyFor(c, user);
    if (isPartner(user)) {
      where = 'e.partner_id = ?'; params.push(user.partner_id ?? -1);
      if (companyId !== null) {
        where += ' AND (e.company_id = ? OR e.company_id IS NULL)'; params.push(companyId);
      }
    }
    else if (isFounder(user)) {
      where = 'e.founder_id = ?'; params.push(user.founder_id ?? -1);
      if (companyId !== null) {
        where += ' AND (p.company_id = ? OR p.company_id IS NULL)'; params.push(companyId);
      }
    }
    else if (!isAdmin(user)) { return c.json({ items: [] }); }
    // Wave 1a — the list now carries display names so the Operations tabs can
    // render "who is this engagement with" without an N+1 fetch per row. All
    // additive keys; the bare-id shape every existing consumer reads is
    // unchanged. LEFT JOINs on purpose: a deleted project or need must not
    // hide the engagement row itself.
    const rows = await c.env.DB.prepare(
      `SELECT e.*, p.name AS project_name, fn.title AS need_title,
              fn.category AS need_category,
              pt.name AS partner_name, pt.company AS partner_company,
              f.name AS founder_name
         FROM engagements e
         LEFT JOIN projects p ON p.id = e.project_id
         LEFT JOIN founder_needs fn ON fn.id = e.need_id
         LEFT JOIN partners pt ON pt.id = e.partner_id
         LEFT JOIN founders f ON f.id = e.founder_id
        WHERE ${where} ORDER BY e.created_at DESC LIMIT 200`
    ).bind(...params).all<Engagement>();
    return c.json({ items: (rows.results || []).map(engagementDto) });
  } catch (e) { return mapError(c, e); }
});

engagementsRouter.get('/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const id = Number(c.req.param('id'));
    const e = await c.env.DB.prepare('SELECT * FROM engagements WHERE id = ?').bind(id).first<Engagement>();
    if (!e) return c.json({ detail: 'Engagement not found' }, 404);
    if (!canSeeEngagement(e, user, await activeCompanyFor(c, user))) return c.json({ detail: 'Forbidden' }, 403);
    return c.json(engagementDto(e));
  } catch (e) { return mapError(c, e); }
});

async function engTransition(c: Context<{ Bindings: Env }>, target: 'start' | 'deliver' | 'cancel' | 'invoice') {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  const e = await c.env.DB.prepare('SELECT * FROM engagements WHERE id = ?').bind(id).first<Engagement>();
  if (!e) return c.json({ detail: 'Engagement not found' }, 404);
  if (!canSeeEngagement(e, user, await activeCompanyFor(c, user))) return c.json({ detail: 'Forbidden' }, 403);
  const body = await c.req.json().catch(() => ({} as any));
  const isPartnerSide = isAdmin(user) || (isPartner(user) && user.partner_id === e.partner_id);
  const isFounderSide = isAdmin(user) || (isFounder(user) && user.founder_id === e.founder_id);
  let nextStatus = e.status; const sets: string[] = []; const params: any[] = [];
  if (target === 'start') {
    if (e.status !== 'accepted') return c.json({ detail: `Cannot start from ${e.status}` }, 409);
    if (!isPartnerSide) return c.json({ detail: 'Partner-side action' }, 403);
    nextStatus = 'in_progress';
  } else if (target === 'deliver') {
    if (!['accepted', 'in_progress'].includes(e.status)) return c.json({ detail: `Cannot deliver from ${e.status}` }, 409);
    if (!isPartnerSide) return c.json({ detail: 'Partner-side action' }, 403);
    nextStatus = 'delivered';
    sets.push('delivered_at = ?'); params.push(nowIso());
    if (body.delivery_notes) { sets.push('delivery_notes = ?'); params.push(String(body.delivery_notes).slice(0, 4000)); }
  } else if (target === 'cancel') {
    if (['reviewed', 'invoiced', 'cancelled'].includes(e.status)) return c.json({ detail: `Cannot cancel from ${e.status}` }, 409);
    if (!isPartnerSide && !isFounderSide) return c.json({ detail: 'Forbidden' }, 403);
    nextStatus = 'cancelled';
    sets.push('cancelled_at = ?'); params.push(nowIso());
    if (body.reason) { sets.push('cancel_reason = ?'); params.push(String(body.reason).slice(0, 2000)); }
  } else if (target === 'invoice') {
    if (!['delivered', 'reviewed'].includes(e.status)) return c.json({ detail: `Cannot invoice from ${e.status}` }, 409);
    if (!isPartnerSide) return c.json({ detail: 'Partner-side action' }, 403);
    // This used to write `invoice_id = 'stub-<uid>'` and nothing else, with a
    // comment noting Stripe Connect was not ported. The effect in production
    // was a state that lied: the engagement went to `invoiced` permanently,
    // no invoice existed, and the UI's `{e.stripe_invoice_url && …}` link was
    // unconditionally falsy — so neither party had anything to send or pay.
    // It now issues a real in-platform invoice document (migration 188). No
    // payment rail is implied: see services/engagementInvoices.ts.
    const invUid = newUid();
    const now = nowIso();
    const quote = await c.env.DB.prepare(
      'SELECT price, deliverables FROM quotes WHERE id = ?',
    ).bind(e.quote_id).first<{ price: number; deliverables: string | null }>();
    const parties = await c.env.DB.prepare(
      `SELECT (SELECT u.id FROM users u WHERE u.partner_id = ? LIMIT 1) AS partner_user_id,
              (SELECT u.id FROM users u WHERE u.founder_id = ? LIMIT 1) AS founder_user_id,
              (SELECT pt.company FROM partners pt WHERE pt.id = ?) AS bill_from_name,
              (SELECT p.name FROM projects p WHERE p.id = ?) AS bill_to_name`,
    ).bind(e.partner_id, e.founder_id, e.partner_id, e.project_id)
      .first<{ partner_user_id: number | null; founder_user_id: number | null; bill_from_name: string | null; bill_to_name: string | null }>();
    const { invoice } = await issueInvoice(c.env, {
      engagementId: id,
      partnerUserId: parties?.partner_user_id ?? null,
      founderUserId: parties?.founder_user_id ?? null,
      billFromName: parties?.bill_from_name ?? null,
      billToName: parties?.bill_to_name ?? null,
      // The engagement price is the accepted quote's; prefer the quote row and
      // fall back to the engagement's own copy.
      priceDollars: quote?.price ?? e.price,
      deliverables: quote?.deliverables ?? null,
    }, invUid, now);
    nextStatus = 'invoiced';
    sets.push('invoiced_at = ?'); params.push(now);
    // The real invoice number, not a stub.
    sets.push('invoice_id = ?'); params.push(invoice?.invoice_number ?? invUid);
  }
  sets.unshift('status = ?'); params.unshift(nextStatus);
  sets.push('updated_at = ?'); params.push(nowIso()); params.push(id);
  await c.env.DB.prepare(`UPDATE engagements SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
  const fresh = await c.env.DB.prepare('SELECT * FROM engagements WHERE id = ?').bind(id).first<Engagement>();
  return c.json(engagementDto(fresh!));
}

engagementsRouter.post('/:id/start', (c) => engTransition(c, 'start'));
engagementsRouter.post('/:id/deliver', (c) => engTransition(c, 'deliver'));
engagementsRouter.post('/:id/cancel', (c) => engTransition(c, 'cancel'));
engagementsRouter.post('/:id/invoice', (c) => engTransition(c, 'invoice'));

// The invoice document itself. Either party to the engagement may read it —
// an invoice with only one readable side is not an invoice — and nobody else
// can, including admin: a 404 rather than a 403 so a non-party cannot confirm
// the engagement exists.
engagementsRouter.get('/:id/invoice', async (c) => {
  try {
    const user = await requireAuth(c);
    const id = Number(c.req.param('id'));
    const e = await c.env.DB.prepare('SELECT * FROM engagements WHERE id = ?')
      .bind(id).first<Engagement>();
    if (!e) return c.json({ detail: 'Not found' }, 404);
    const mine = (isPartner(user) && user.partner_id === e.partner_id)
      || (isFounder(user) && user.founder_id === e.founder_id);
    if (!mine) return c.json({ detail: 'Not found' }, 404);
    const row = await c.env.DB.prepare(
      'SELECT * FROM engagement_invoices WHERE engagement_id = ?',
    ).bind(id).first<any>();
    if (!row) return c.json({ detail: 'Not found' }, 404);
    return c.json(invoiceDto(row));
  } catch (err) { return mapError(c, err); }
});

// Record that payment arrived. The platform does NOT process it — there is
// no payment rail here. This is the partner asserting they were paid OUT OF
// BAND, and the copy on both sides says exactly that.
engagementsRouter.post('/:id/invoice/paid', async (c) => {
  try {
    const user = await requireAuth(c);
    const id = Number(c.req.param('id'));
    const e = await c.env.DB.prepare('SELECT * FROM engagements WHERE id = ?')
      .bind(id).first<Engagement>();
    if (!e) return c.json({ detail: 'Not found' }, 404);
    if (!(isPartner(user) && user.partner_id === e.partner_id)) {
      return c.json({ detail: 'Partner-side action' }, 403);
    }
    const row = await c.env.DB.prepare(
      'SELECT * FROM engagement_invoices WHERE engagement_id = ?',
    ).bind(id).first<any>();
    if (!row) return c.json({ detail: 'Not found' }, 404);
    if (row.status === 'void') return c.json({ detail: 'That invoice is void' }, 409);
    await c.env.DB.prepare(
      "UPDATE engagement_invoices SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ?",
    ).bind(nowIso(), nowIso(), row.id).run();
    const fresh = await c.env.DB.prepare(
      'SELECT * FROM engagement_invoices WHERE id = ?',
    ).bind(row.id).first<any>();
    return c.json(invoiceDto(fresh));
  } catch (err) { return mapError(c, err); }
});

engagementsRouter.get('/:id/reviews', async (c) => {
  try {
    const user = await requireAuth(c);
    const id = Number(c.req.param('id'));
    const e = await c.env.DB.prepare('SELECT * FROM engagements WHERE id = ?').bind(id).first<Engagement>();
    if (!e) return c.json({ detail: 'Engagement not found' }, 404);
    if (!canSeeEngagement(e, user, await activeCompanyFor(c, user))) return c.json({ detail: 'Forbidden' }, 403);
    const rows = await c.env.DB.prepare(
      'SELECT * FROM engagement_reviews WHERE engagement_id = ? ORDER BY created_at ASC'
    ).bind(id).all<any>();
    return c.json({ items: rows.results || [] });
  } catch (e) { return mapError(c, e); }
});

engagementsRouter.post('/:id/reviews', async (c) => {
  try {
    const user = await requireAuth(c);
    const id = Number(c.req.param('id'));
    const e = await c.env.DB.prepare('SELECT * FROM engagements WHERE id = ?').bind(id).first<Engagement>();
    if (!e) return c.json({ detail: 'Engagement not found' }, 404);
    if (!canSeeEngagement(e, user, await activeCompanyFor(c, user))) return c.json({ detail: 'Forbidden' }, 403);
    if (!['delivered', 'reviewed', 'invoiced'].includes(e.status)) {
      return c.json({ detail: 'Engagement must be delivered before reviewing' }, 409);
    }
    const body = await c.req.json().catch(() => ({} as any));
    const rating = Math.max(1, Math.min(5, Number(body.rating || 0)));
    if (!rating) return c.json({ detail: 'rating must be 1..5' }, 400);
    const reviewer_role = (isPartner(user) && user.partner_id === e.partner_id) ? 'partner' : 'founder';
    try {
      await c.env.DB.prepare(
        `INSERT INTO engagement_reviews
           (uid, engagement_id, reviewer_user_id, reviewer_role, rating, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(newUid(), id, user.id, reviewer_role, rating,
             body.comment ? String(body.comment).slice(0, 2000) : null, nowIso()).run();
    } catch (e: any) {
      if (String(e?.message || e).includes('UNIQUE')) return c.json({ detail: 'Already reviewed' }, 409);
      throw e;
    }
    // Promote status to 'reviewed' once at least one side has rated.
    if (e.status === 'delivered') {
      await c.env.DB.prepare("UPDATE engagements SET status='reviewed', updated_at=? WHERE id=?")
        .bind(nowIso(), id).run();
    }
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

// Task #1 (AG) — Marketplace facade endpoints called from the founder UI.
// These are typed lookups that augment (not replace) the core needs CRUD.
needs.get('/categories', async (c) => {
  await requireAuth(c);
  return c.json({ items: [...VALID_CATEGORIES].map((slug) => ({ slug, label: slug })) });
});

needs.get('/inquiries', (c) => {
  // url already carries the original querystring on `url.search`; only swap
  // the pathname. Never concatenate `url.search` again — that would double
  // the query string (e.g. `?status=open?status=open`).
  const url = new URL(c.req.url);
  url.pathname = '/api/needs/';
  return needs.fetch(
    new Request(url, { method: 'GET', headers: c.req.raw.headers }),
    c.env, c.executionCtx,
  );
});

needs.post('/inquiries', async (c) => {
  const body = await c.req.text();
  const url = new URL(c.req.url);
  url.pathname = '/api/needs/';
  url.search = '';
  return needs.fetch(new Request(url, { method: 'POST', headers: c.req.raw.headers, body }), c.env, c.executionCtx);
});

needs.get('/providers', async (c) => {
  await requireAuth(c);
  // Providers are partners with status='active' — return the public-safe shape.
  const rows = await c.env.DB.prepare(
    `SELECT uid, name, company, specialization FROM partners WHERE status = 'active' ORDER BY name LIMIT 200`,
  ).all();
  return c.json({ items: rows.results || [] });
});

needs.get('/providers/me/stripe', async (c) => {
  const user = await requireAuth(c);
  // Stripe Connect onboarding is owned by AO; return a typed empty status so
  // the SPA's check renders without crashing.
  return c.json({
    user_id: user.id,
    connected: false,
    account_id: null,
    onboarding_url: null,
    detail: 'stripe_connect_not_configured',
  });
});

needs.post('/providers/me/stripe/onboard', async (c) => {
  await requireAuth(c);
  return c.json({ ok: false, detail: 'stripe_connect_not_configured' }, 503);
});

export { needs, quotesRouter, engagementsRouter };
export default needs;
