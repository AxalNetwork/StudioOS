import { Hono } from 'hono';
import type { Env } from '../types';
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
  if (isPrivileged) {
    rows = status
      ? await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id WHERE d.status = ${status} ORDER BY d.created_at DESC`
      : await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id ORDER BY d.created_at DESC`;
  } else {
    if (!user.founder_id) { await sql.end(); return c.json([]); }
    rows = status
      ? await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id WHERE d.status = ${status} AND p.founder_id = ${user.founder_id} ORDER BY d.created_at DESC`
      : await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id WHERE p.founder_id = ${user.founder_id} ORDER BY d.created_at DESC`;
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
          channels: ['in_app', 'email'],
        });
      }
    }
  } catch (e) { console.warn('[deals] notify deal_stage_change failed', e); }

  // Task #2 — best-effort HubSpot sync on stage change. Look up the founder's
  // hubspot integration (if any) and push the deal. Fire-and-forget via
  // executionCtx.waitUntil so the API response stays snappy; failures land in
  // integration_logs via the provider's own logging path. We deliberately
  // skip when `data.status` was not part of the patch.
  if (data.status) {
    try {
      const own2 = await sql`
        SELECT f.user_id AS founder_user_id
        FROM deals d
        LEFT JOIN projects p ON p.id = d.project_id
        LEFT JOIN founders f ON f.id = p.founder_id
        WHERE d.id = ${id}
      `;
      const founderUserId = (own2[0] as any)?.founder_user_id as number | undefined;
      if (founderUserId) {
        const integ = await c.env.DB.prepare(
          "SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'hubspot' AND status = 'active' LIMIT 1",
        ).bind(founderUserId).first<any>();
        if (integ) {
          const work = (async () => {
            try {
              const { default: hsImpl } = await import('../integrations/providers/hubspot') as any;
              // The module side-effect-registers; we need the impl from the registry.
              const { getProviderImpl } = await import('../integrations/registry');
              const impl = getProviderImpl('hubspot');
              if (impl?.push) {
                await impl.push(c, { id: founderUserId } as any, integ, { deal_id: id });
              }
              void hsImpl; // silence unused-default lint
            } catch (e) {
              console.warn('[deals] hubspot push on stage change failed', (e as Error).message);
            }
          })();
          c.executionCtx?.waitUntil?.(work);
        }
      }
    } catch (e) { console.warn('[deals] hubspot stage-change hook failed', e); }
  }

  await sql.end();
  return c.json(updated);
});

export default deals;
