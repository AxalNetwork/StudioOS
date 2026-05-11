import { Hono } from 'hono';
import type { Env, User } from '../types';
import { schedulePush } from '../integrations/autopush';
import { getSQL } from '../db';
import { requireAuth, requireRole, canAccessFounderResource } from '../auth';

const deals = new Hono<{ Bindings: Env }>();

deals.get('/', async (c) => {
  const user = await requireAuth(c);
  const status = c.req.query('status');
  const sql = getSQL(c.env);
  const isPrivileged = user.role === 'admin' || user.role === 'partner' || user.role === 'investor';
  // IDOR guard: founders can only list deals on their own projects.
  let rows: any;
  // Task #16 — surface founder_user_id on the listing so investors/admins can
  // render the per-founder TrustScoreBadge inline next to FounderRiskBadge
  // without an extra round-trip per row.
  if (isPrivileged) {
    rows = status
      ? await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, f.user_id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN founders f ON f.id = p.founder_id WHERE d.status = ${status} ORDER BY d.created_at DESC`
      : await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, f.user_id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN founders f ON f.id = p.founder_id ORDER BY d.created_at DESC`;
  } else {
    if (!user.founder_id) { await sql.end(); return c.json([]); }
    rows = status
      ? await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, f.user_id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN founders f ON f.id = p.founder_id WHERE d.status = ${status} AND p.founder_id = ${user.founder_id} ORDER BY d.created_at DESC`
      : await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, f.user_id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN founders f ON f.id = p.founder_id WHERE p.founder_id = ${user.founder_id} ORDER BY d.created_at DESC`;
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

deals.post('/:id/dealroom/join', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  await ensureInvestorPaywallSchema(c.env);
  if (user.role !== 'investor') return c.json({ error: 'investor_only' }, 403);
  const dealId = Number(c.req.param('id'));
  if (!Number.isFinite(dealId)) return c.json({ error: 'bad_id' }, 400);

  // Idempotent join — if already a member, just return ok.
  const existing = await c.env.DB.prepare(
    `SELECT 1 AS x FROM investor_dealroom_members
     WHERE investor_user_id = ? AND deal_id = ?`
  ).bind(user.id, dealId).first<{ x: number }>();
  if (existing) return c.json({ ok: true, already_member: true });

  const tier = effectiveInvestorTier(user);
  const cap = INVESTOR_QUOTAS[tier].dealroom_max;
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
  if (user.role !== 'investor') return c.json({ error: 'investor_only' }, 403);
  const dealId = Number(c.req.param('id'));
  if (!Number.isFinite(dealId)) return c.json({ error: 'bad_id' }, 400);
  await c.env.DB.prepare(
    `DELETE FROM investor_dealroom_members WHERE investor_user_id = ? AND deal_id = ?`
  ).bind(user.id, dealId).run();
  return c.json({ ok: true });
});

export default deals;
