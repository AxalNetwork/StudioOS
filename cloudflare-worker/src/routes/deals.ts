import { Hono } from 'hono';
import type { Env, User } from '../types';
import { schedulePush } from '../integrations/autopush';
import { getSQL } from '../db';
import { requireAuth, requireRole, canAccessFounderResource } from '../auth';

const deals = new Hono<{ Bindings: Env }>();

deals.get('/', async (c) => {
  const user = await requireAuth(c);
  const status = c.req.query('status');
  // Task #82 — investors can narrow the firm-wide funnel to "my deals":
  // deals they have an actual relationship with (dealroom member, introduced,
  // or a converted watchlist item). scope is ignored for operators and founders.
  const scope = c.req.query('scope');
  const sql = getSQL(c.env);
  const isPrivileged = user.role === 'admin' || user.role === 'partner' || user.role === 'investor';
  // IDOR guard: founders can only list deals on their own projects.
  let rows: any;
  // Task #16 — surface founder_user_id on the listing so investors/admins can
  // render the per-founder TrustScoreBadge inline next to FounderRiskBadge
  // without an extra round-trip per row.
  if (isPrivileged) {
    rows = status
      ? await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, f.user_id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN founders f ON f.id = p.founder_id WHERE d.status = ${status} AND (p.id IS NULL OR p.deleted_at IS NULL) ORDER BY d.created_at DESC`
      : await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, f.user_id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN founders f ON f.id = p.founder_id WHERE (p.id IS NULL OR p.deleted_at IS NULL) ORDER BY d.created_at DESC`;
    // Task #82 — annotate each deal with is_member (is this investor in the
    // dealroom?) so the SPA can render "View room" vs "Join room", and apply
    // the optional scope=mine relationship filter.
    if (user.role === 'investor') {
      await ensureInvestorPaywallSchema(c.env);
      const memberRows = await sql`SELECT deal_id FROM investor_dealroom_members WHERE investor_user_id = ${user.id}`;
      const memberSet = new Set<number>((memberRows as any[]).map((r) => Number(r.deal_id)));
      const introRows = await sql`SELECT project_id FROM investor_introductions WHERE investor_user_id = ${user.id} AND project_id IS NOT NULL`;
      const introSet = new Set<number>((introRows as any[]).map((r) => Number(r.project_id)));
      let convertedSet = new Set<number>();
      try {
        const convRows = await sql`SELECT converted_deal_id FROM watchlist_items WHERE owner_user_id = ${user.id} AND converted_deal_id IS NOT NULL`;
        convertedSet = new Set<number>((convRows as any[]).map((r) => Number(r.converted_deal_id)));
      } catch { /* watchlist_items absent on a fresh DB — no conversions to fold in */ }
      rows = (rows as any[]).map((d) => ({ ...d, is_member: memberSet.has(Number(d.id)) ? 1 : 0 }));
      if (scope === 'mine') {
        rows = (rows as any[]).filter((d) =>
          memberSet.has(Number(d.id))
          || (d.project_id != null && introSet.has(Number(d.project_id)))
          || convertedSet.has(Number(d.id)),
        );
      }
    }
  } else {
    if (!user.founder_id) { await sql.end(); return c.json([]); }
    rows = status
      ? await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, f.user_id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN founders f ON f.id = p.founder_id WHERE d.status = ${status} AND p.founder_id = ${user.founder_id} AND p.deleted_at IS NULL ORDER BY d.created_at DESC`
      : await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, f.user_id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN founders f ON f.id = p.founder_id WHERE p.founder_id = ${user.founder_id} AND p.deleted_at IS NULL ORDER BY d.created_at DESC`;
  }
  await sql.end();
  return c.json(rows);
});

deals.post('/', async (c) => {
  const user = await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const p = await sql`SELECT id, founder_id FROM projects WHERE id = ${data.project_id}`;
  if (p.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  // IDOR guard: founders may only create deals against their own project.
  if (!canAccessFounderResource(user, (p[0] as any).founder_id)) {
    await sql.end();
    return c.json({ error: 'Forbidden' }, 403);
  }
  const [deal] = await sql`INSERT INTO deals (project_id, partner_id, status, notes, amount) VALUES (${data.project_id}, ${data.partner_id || null}, ${data.status || 'applied'}, ${data.notes || null}, ${data.amount || null}) RETURNING *`;
  await sql.end();
  return c.json(deal, 201);
});

deals.get('/:id', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT d.*, p.name as project_name, p.founder_id as project_founder_id, pr.name as partner_name FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id WHERE d.id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }
  // IDOR guard: founders can only view deals on their own project.
  if (!canAccessFounderResource(user as any, (rows[0] as any).project_founder_id)) {
    await sql.end();
    return c.json({ detail: 'Forbidden: you do not own this deal' }, 403);
  }
  await sql.end();
  return c.json(rows[0]);
});

deals.put('/:id', async (c) => {
  // Deal mutation is a partner/investor/admin operation (Phase 0.1 split).
  await requireRole(c, 'partner', 'investor');
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id FROM deals WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }

  if (data.status) await sql`UPDATE deals SET status = ${data.status}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.partner_id !== undefined) await sql`UPDATE deals SET partner_id = ${data.partner_id}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.notes !== undefined) await sql`UPDATE deals SET notes = ${data.notes}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.amount !== undefined) await sql`UPDATE deals SET amount = ${data.amount}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;

  const [updated] = await sql`SELECT * FROM deals WHERE id = ${id}`;

  // Phase 0.2 notify — surface stage changes to the founder behind the project.
  try {
    if (data.status) {
      const own = await sql`
        SELECT f.user_id AS founder_user_id, p.name AS project_name
        FROM deals d
        LEFT JOIN projects p ON p.id = d.project_id
        LEFT JOIN founders f ON f.id = p.founder_id
        WHERE d.id = ${id}
      `;
      const founderUserId = own[0]?.founder_user_id;
      const projectName = own[0]?.project_name || 'your project';
      if (founderUserId) {
        const { notify } = await import('../services/notify');
        await notify(c.env, {
          userId: founderUserId,
          type: 'deal_stage_change',
          title: `${projectName}: deal stage → ${data.status}`,
          body: 'A partner updated the deal stage on your project.',
          link: '/deals',
          payload: { deal_id: updated.id, status: updated.status },
          channels: ['in_app', 'email', 'slack'],
          category: 'deal_stage_change',
        });
      }
    }
  } catch (e) { console.warn('[deals] notify deal_stage_change failed', e); }

  // Task #2 — best-effort HubSpot sync on stage change. Resolve the
  // founder's user_id from the deal, then hand off to `schedulePush` which
  // fires the push on executionCtx.waitUntil AND writes an
  // integration_logs row so "View logs" reflects every background push.
  if (data.status) {
    try {
      const own2 = (await sql`
        SELECT f.user_id AS founder_user_id
        FROM deals d
        LEFT JOIN projects p ON p.id = d.project_id
        LEFT JOIN founders f ON f.id = p.founder_id
        WHERE d.id = ${id}
      `) as Array<{ founder_user_id: number | null }>;
      const founderUserId = own2[0]?.founder_user_id ?? null;
      if (founderUserId) {
        const founderUser: User = { id: founderUserId } as User;
        schedulePush({
          c, user: founderUser, providerKey: 'hubspot',
          payload: { deal_id: id },
          eventType: 'auto_push:deal_stage_change',
        });
        // Task #4 — mirror to Salesforce when active. Same payload shape.
        schedulePush({
          c, user: founderUser, providerKey: 'salesforce',
          payload: { deal_id: id },
          eventType: 'auto_push:deal_stage_change',
        });
      }
    } catch (e) { console.warn('[deals] crm stage-change hook failed', e); }
  }

  await sql.end();
  return c.json(updated);
});

// ---------------------------------------------------------------------------
// Task #6 (W-1) — Investor dealroom membership with per-tier cap.
// Free      — 1 dealroom
// Professional — 5 dealrooms
// Institutional — unlimited (1_000_000 sentinel)
// On overflow returns 402 with code:'quota_dealrooms_exhausted' so the
// frontend can show the upgrade modal.
// ---------------------------------------------------------------------------
import {
  ensureInvestorPaywallSchema,
  effectiveInvestorTier,
  INVESTOR_QUOTAS,
  type InvestorUser,
} from '../middleware/requireInvestorTier';

// Bypass roles can join any number of dealrooms — they're acting in an
// admin/partner/advisor capacity and never count against an investor cap.
const DEALROOM_BYPASS_ROLES = new Set<string>(['admin', 'partner', 'advisor']);

deals.post('/:id/dealroom/join', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  await ensureInvestorPaywallSchema(c.env);
  const isBypass = DEALROOM_BYPASS_ROLES.has(String(user.role));
  if (user.role !== 'investor' && !isBypass) {
    return c.json({ error: 'investor_only' }, 403);
  }
  const dealId = Number(c.req.param('id'));
  if (!Number.isFinite(dealId)) return c.json({ error: 'bad_id' }, 400);

  // Idempotent join — if already a member, just return ok.
  const existing = await c.env.DB.prepare(
    `SELECT 1 AS x FROM investor_dealroom_members
     WHERE investor_user_id = ? AND deal_id = ?`
  ).bind(user.id, dealId).first<{ x: number }>();
  if (existing) return c.json({ ok: true, already_member: true });

  const tier = effectiveInvestorTier(user);
  // Task #24 — cap is sourced from `users.investor_dealroom_max` (the
  // canonical column written by the Stripe webhook + dev-upgrade
  // helpers + admin-grant codepaths). The billing webhook bumps that
  // column to 1_000_000 when a user becomes Institutional, so reading
  // the column directly guarantees Institutional users are never
  // gated even if the tier-derived default in INVESTOR_QUOTAS drifts
  // out of sync. Falls back to the tier default when the column is
  // null (e.g. legacy rows that pre-date 027_investor_paywall.sql and
  // somehow escaped the schema-bootstrap default of 5).
  const colCap = (user as { investor_dealroom_max?: number | null }).investor_dealroom_max;
  const tierCap = INVESTOR_QUOTAS[tier].dealroom_max;
  const cap = isBypass
    ? Number.POSITIVE_INFINITY
    : (Number.isFinite(colCap as number) && (colCap as number) > 0 ? Number(colCap) : tierCap);
  const cnt = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM investor_dealroom_members WHERE investor_user_id = ?`
  ).bind(user.id).first<{ n: number }>();
  const used = Number(cnt?.n ?? 0);
  if (used >= cap) {
    return c.json(
      {
        error: 'quota_exceeded',
        code: 'quota_dealrooms_exhausted',
        message: `You have joined the maximum of ${cap} dealroom${cap === 1 ? '' : 's'} on the ${tier} plan.`,
        used,
        cap,
        tier,
        upgrade_to: tier === 'free' ? 'professional' : 'institutional',
        checkout_path: '/api/billing/investor/checkout',
      },
      402,
    );
  }
  try {
    await c.env.DB.prepare(
      `INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (?, ?)`
    ).bind(user.id, dealId).run();
  } catch (e) {
    if (/UNIQUE/i.test((e as Error).message || '')) {
      return c.json({ ok: true, already_member: true });
    }
    throw e;
  }
  return c.json({ ok: true, used: used + 1, cap, tier });
});

deals.delete('/:id/dealroom/leave', async (c) => {
  const user = await requireAuth(c);
  // Mirror the bypass list from the join endpoint — admin/partner/advisor
  // who joined a dealroom must also be able to leave it.
  if (user.role !== 'investor' && !DEALROOM_BYPASS_ROLES.has(String(user.role))) {
    return c.json({ error: 'investor_only' }, 403);
  }
  const dealId = Number(c.req.param('id'));
  if (!Number.isFinite(dealId)) return c.json({ error: 'bad_id' }, 400);
  await c.env.DB.prepare(
    `DELETE FROM investor_dealroom_members WHERE investor_user_id = ? AND deal_id = ?`
  ).bind(user.id, dealId).run();
  return c.json({ ok: true });
});

export default deals;
