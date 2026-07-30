import { Hono } from 'hono';
import type { Env, User } from '../types';
import { schedulePush } from '../integrations/autopush';
import { getSQL } from '../db';
import { requireAuth, requireRole, requireAdmin, canAccessFounderResource } from '../auth';
import { buildZip } from '../util/zip';

const deals = new Hono<{ Bindings: Env }>();

// Task #4 — Deal Flow pipeline stages (excludes the terminal `rejected`).
const PIPELINE = ['applied', 'scored', 'active', 'funded'];

// SQLite datetime('now') yields 'YYYY-MM-DD HH:MM:SS' in UTC — normalise so
// `new Date` parses it as UTC rather than local.
function normTs(s: any): number | null {
  if (!s) return null;
  const raw = String(s);
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function daysInStage(row: any): number {
  const ref = normTs(row.stage_changed_at || row.updated_at || row.created_at);
  if (!ref) return 0;
  const d = Math.floor((Date.now() - ref) / 86_400_000);
  return d > 0 ? d : 0;
}

// Mirror FastAPI _serialize_deal: attach progress_pct + days_in_stage.
function enrichDeal(row: any): any {
  const target = row.target_raise || row.amount || 0;
  const committed = row.capital_committed || 0;
  const progress = target ? Math.round((committed / target) * 1000) / 10 : 0;
  return { ...row, progress_pct: progress, days_in_stage: daysInStage(row) };
}

const isPrivilegedRole = (role: string) =>
  role === 'admin' || role === 'partner' || role === 'investor';

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
      ? await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, lp.name as lead_partner_name, f.id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN users lp ON lp.id = d.lead_partner_id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE d.status = ${status} AND (p.id IS NULL OR p.deleted_at IS NULL) ORDER BY d.created_at DESC`
      : await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, lp.name as lead_partner_name, f.id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN users lp ON lp.id = d.lead_partner_id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE (p.id IS NULL OR p.deleted_at IS NULL) ORDER BY d.created_at DESC`;
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
      ? await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, f.id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE d.status = ${status} AND p.founder_id = ${user.founder_id} AND p.deleted_at IS NULL ORDER BY d.created_at DESC`
      : await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, f.id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE p.founder_id = ${user.founder_id} AND p.deleted_at IS NULL ORDER BY d.created_at DESC`;
  }
  await sql.end();
  return c.json((rows as any[]).map(enrichDeal));
});

// ---------------------------------------------------------------------------
// Task #4 — Funnel aggregates for the Deal Flow cards (privileged roles only).
// ---------------------------------------------------------------------------
deals.get('/funnel', async (c) => {
  const user = await requireAuth(c);
  if (!isPrivilegedRole(user.role as string)) return c.json({ stages: [], total: 0 });
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT d.status AS stage,
           COUNT(*) AS count,
           COALESCE(SUM(COALESCE(d.target_raise, d.amount, 0)), 0) AS total_target,
           COALESCE(SUM(COALESCE(d.capital_committed, 0)), 0) AS total_committed,
           SUM(CASE WHEN d.created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS added_7d
    FROM deals d
    LEFT JOIN projects p ON p.id = d.project_id
    WHERE (p.id IS NULL OR p.deleted_at IS NULL)
    GROUP BY d.status`;
  await sql.end();
  const byStage: Record<string, any> = {};
  for (const r of rows as any[]) byStage[r.stage] = r;
  const stages = [...PIPELINE, 'rejected'].map((stage) => {
    const r = byStage[stage] || {};
    return {
      stage,
      count: Number(r.count || 0),
      total_target: Number(r.total_target || 0),
      total_committed: Number(r.total_committed || 0),
      added_7d: Number(r.added_7d || 0),
    };
  });
  return c.json({ stages, total: stages.reduce((n, s) => n + s.count, 0) });
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
  const [deal] = await sql`INSERT INTO deals (project_id, partner_id, status, notes, amount, stage_changed_at) VALUES (${data.project_id}, ${data.partner_id || null}, ${data.status || 'applied'}, ${data.notes || null}, ${data.amount || null}, datetime('now')) RETURNING *`;
  await sql.end();
  return c.json(deal, 201);
});

// ---------------------------------------------------------------------------
// Task #4 — Admin-only "Draft Deal": create a fully-specified deal.
// ---------------------------------------------------------------------------
deals.post('/draft', async (c) => {
  await requireAdmin(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const p = await sql`SELECT id FROM projects WHERE id = ${data.project_id}`;
  if (p.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const status = [...PIPELINE, 'rejected'].includes(data.status) ? data.status : 'applied';
  const [deal] = await sql`
    INSERT INTO deals (
      project_id, partner_id, lead_partner_id, status, notes, description, website,
      amount, target_raise, minimum_check, valuation_cap, carry_pct, management_fee_pct,
      instrument, spv_jurisdiction, closing_deadline, capital_committed, stage_changed_at
    ) VALUES (
      ${data.project_id}, ${data.partner_id || null}, ${data.lead_partner_id || null}, ${status},
      ${data.notes || null}, ${data.description || null}, ${data.website || null},
      ${data.amount ?? null}, ${data.target_raise ?? null}, ${data.minimum_check ?? null},
      ${data.valuation_cap ?? null}, ${data.carry_pct ?? null}, ${data.management_fee_pct ?? null},
      ${data.instrument || null}, ${data.spv_jurisdiction || null}, ${data.closing_deadline || null},
      0, datetime('now')
    ) RETURNING *`;
  await sql.end();
  return c.json(enrichDeal(deal), 201);
});

// ---------------------------------------------------------------------------
// Task #4 — Pickers for the admin forms.
// ---------------------------------------------------------------------------
deals.get('/lead-partners', async (c) => {
  await requireRole(c, 'partner');
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, name, email, role FROM users WHERE role IN ('admin', 'partner') AND is_active = 1 ORDER BY name`;
  await sql.end();
  return c.json(rows);
});

deals.get('/investors', async (c) => {
  await requireAdmin(c);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, name, email FROM users WHERE role = 'investor' AND is_active = 1 ORDER BY name`;
  await sql.end();
  return c.json(rows);
});

// ---------------------------------------------------------------------------
// Task #4 — Investor's own invitation inbox. MUST precede /:id.
// ---------------------------------------------------------------------------
deals.get('/invitations/mine', async (c) => {
  await requireRole(c, 'investor');
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT di.id, di.uid, di.deal_id, di.status, di.message, di.created_at, di.responded_at,
           p.name AS project_name, d.status AS deal_status
    FROM deal_invitations di
    LEFT JOIN deals d ON d.id = di.deal_id
    LEFT JOIN projects p ON p.id = d.project_id
    WHERE di.investor_user_id = ${user.id}
    ORDER BY di.created_at DESC`;
  await sql.end();
  return c.json(rows);
});

deals.get('/:id', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, p.founder_id as project_founder_id, pr.name as partner_name, lp.name as lead_partner_name, f.id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN users lp ON lp.id = d.lead_partner_id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE d.id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }
  if (!(await canReadDeal(sql, user, id, (rows[0] as any).project_founder_id))) {
    await sql.end();
    return c.json({ detail: 'Forbidden: you do not own this deal' }, 403);
  }
  await sql.end();
  return c.json(enrichDeal(rows[0]));
});

deals.put('/:id', async (c) => {
  // Task #4 — deal mutation is an operator (partner/admin) action; investors
  // are limited to commitments + invitation responses.
  await requireRole(c, 'partner');
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id FROM deals WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }

  // Task #4 — maintain stage_changed_at whenever the pipeline stage moves.
  if (data.status) await sql`UPDATE deals SET status = ${data.status}, stage_changed_at = datetime('now'), updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.partner_id !== undefined) await sql`UPDATE deals SET partner_id = ${data.partner_id}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.notes !== undefined) await sql`UPDATE deals SET notes = ${data.notes}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.amount !== undefined) await sql`UPDATE deals SET amount = ${data.amount}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;

  const [updated] = await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, lp.name as lead_partner_name FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN users lp ON lp.id = d.lead_partner_id WHERE d.id = ${id}`;

  // Phase 0.2 notify — surface stage changes to the founder behind the project.
  try {
    if (data.status) {
      const own = await sql`
        SELECT f.id AS founder_user_id, p.name AS project_name
        FROM deals d
        LEFT JOIN projects p ON p.id = d.project_id
        LEFT JOIN users f ON f.founder_id = p.founder_id
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
        SELECT f.id AS founder_user_id
        FROM deals d
        LEFT JOIN projects p ON p.id = d.project_id
        LEFT JOIN users f ON f.founder_id = p.founder_id
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
  return c.json(enrichDeal(updated));
});

// ---------------------------------------------------------------------------
// Task #4 — Advance a deal to the next pipeline stage (operator action).
// ---------------------------------------------------------------------------
deals.post('/:id/advance', async (c) => {
  await requireRole(c, 'partner');
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT status FROM deals WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }
  const cur = String((rows[0] as any).status);
  const idx = PIPELINE.indexOf(cur);
  if (idx < 0 || idx >= PIPELINE.length - 1) {
    await sql.end();
    return c.json({ detail: 'Deal cannot advance further' }, 400);
  }
  const next = PIPELINE[idx + 1];
  await sql`UPDATE deals SET status = ${next}, stage_changed_at = datetime('now'), updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  const [updated] = await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, lp.name as lead_partner_name FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN users lp ON lp.id = d.lead_partner_id WHERE d.id = ${id}`;

  // Notify the owning founder about the stage change.
  try {
    const own = await sql`SELECT f.id AS founder_user_id, p.name AS project_name FROM deals d LEFT JOIN projects p ON p.id = d.project_id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE d.id = ${id}`;
    const founderUserId = (own[0] as any)?.founder_user_id;
    if (founderUserId) {
      const { notify } = await import('../services/notify');
      await notify(c.env, {
        userId: founderUserId,
        type: 'deal_stage_change',
        title: `${(own[0] as any)?.project_name || 'Your project'}: deal stage → ${next}`,
        body: 'A partner advanced the deal stage on your project.',
        link: `/deals/${id}`,
        payload: { deal_id: id, status: next },
        channels: ['in_app', 'email', 'slack'],
        category: 'deal_stage_change',
      });
    }
  } catch (e) { console.warn('[deals] advance notify failed', e); }

  await sql.end();
  return c.json(enrichDeal(updated));
});

// ---------------------------------------------------------------------------
// Task #4 — Deal Room: documents, data-room zip, commitments, activity.
// ---------------------------------------------------------------------------
type ReadCtx =
  | { error: Response; user?: undefined; sql?: undefined; deal?: undefined }
  | { error?: undefined; user: User; sql: ReturnType<typeof getSQL>; deal: any };

// Deal-room read authorization, kept in lockstep with the FastAPI
// `_ensure_deal_read_access` helper:
// - admin/partner: full access (studio-wide staff)
// - founder: only their own project (canAccessFounderResource)
// - investor: relationship-gated — invited to this deal OR holds a commitment.
//   Deal rooms carry UNMASKED founder data, so investors get NO blanket access
//   (2026-06-25 audit). NOTE: the predicate is intentionally invited-OR-committed
//   and does NOT include investor_dealroom_members, because Postgres (the dev
//   backend) has no such table — the two backends must decide identically.
async function investorHasDealRelationship(sql: any, userId: number, dealId: number): Promise<boolean> {
  const inv = await sql`SELECT 1 AS x FROM deal_invitations WHERE deal_id = ${dealId} AND investor_user_id = ${userId} LIMIT 1`;
  if (inv.length) return true;
  const com = await sql`SELECT 1 AS x FROM commitments WHERE deal_id = ${dealId} AND investor_user_id = ${userId} LIMIT 1`;
  return com.length > 0;
}

async function canReadDeal(sql: any, user: User, dealId: number, projectFounderId: any): Promise<boolean> {
  if (canAccessFounderResource(user as any, projectFounderId)) return true;
  const role = String((user as any).role || '').toLowerCase();
  if (role === 'investor') return investorHasDealRelationship(sql, (user as any).id, dealId);
  return false;
}

async function loadDealForRead(c: any, id: number): Promise<ReadCtx> {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT d.*, p.name AS project_name, p.founder_id AS project_founder_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id WHERE d.id = ${id}`;
  if (rows.length === 0) { await sql.end(); return { error: c.json({ error: 'Deal not found' }, 404) }; }
  if (!(await canReadDeal(sql, user, id, (rows[0] as any).project_founder_id))) {
    await sql.end();
    return { error: c.json({ detail: 'Forbidden: you do not own this deal' }, 403) };
  }
  return { user, sql, deal: rows[0] as any };
}

deals.get('/:id/documents', async (c) => {
  const id = parseInt(c.req.param('id'));
  const ctx = await loadDealForRead(c, id);
  if (ctx.error) return ctx.error;
  const { sql, deal } = ctx;
  if (!deal.project_id) { await sql.end(); return c.json([]); }
  const docs = await sql`SELECT id, uid, title, doc_type, status, created_at FROM documents WHERE project_id = ${deal.project_id} ORDER BY created_at DESC`;
  await sql.end();
  return c.json(docs);
});

deals.get('/:id/data-room', async (c) => {
  const id = parseInt(c.req.param('id'));
  const ctx = await loadDealForRead(c, id);
  if (ctx.error) return ctx.error;
  const { sql, deal } = ctx;
  const docs = deal.project_id
    ? await sql`SELECT id, title, content FROM documents WHERE project_id = ${deal.project_id} ORDER BY created_at DESC`
    : [];
  await sql.end();
  const entries = [{
    name: 'README.txt',
    content: [
      `Data Room — ${deal.project_name || 'Deal #' + id}`,
      `Stage: ${deal.status}`,
      `Documents: ${docs.length}`,
      `Exported: ${new Date().toISOString()}`,
    ].join('\n'),
  }];
  const seen = new Set<string>();
  for (const d of docs as any[]) {
    const base = String(d.title || `document_${d.id}`).replace(/[^a-zA-Z0-9 \-_.]/g, '_');
    let name = `${base}.txt`;
    let i = 1;
    while (seen.has(name)) { name = `${base}_${i++}.txt`; }
    seen.add(name);
    entries.push({ name, content: d.content || '(document stored externally — no inline content)' });
  }
  const zip = buildZip(entries);
  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="data-room-deal-${id}.zip"`,
    },
  });
});

deals.get('/:id/commitments', async (c) => {
  const id = parseInt(c.req.param('id'));
  const ctx = await loadDealForRead(c, id);
  if (ctx.error) return ctx.error;
  const { sql } = ctx;
  const rows = await sql`SELECT c.id, c.uid, c.deal_id, c.investor_user_id, c.amount, c.status, c.notes, c.created_at, u.name AS investor_name FROM commitments c LEFT JOIN users u ON u.id = c.investor_user_id WHERE c.deal_id = ${id} ORDER BY c.created_at DESC`;
  await sql.end();
  return c.json(rows);
});

deals.post('/:id/commitments', async (c) => {
  const user = await requireRole(c, 'investor');
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json();
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) return c.json({ detail: 'Commitment amount must be positive' }, 400);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id FROM deals WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }
  // An investor must be invited to a deal before committing capital. This also
  // prevents self-granting deal-room read access by committing to any deal id.
  const invited = await sql`SELECT 1 AS x FROM deal_invitations WHERE deal_id = ${id} AND investor_user_id = ${user.id} LIMIT 1`;
  if (!invited.length) { await sql.end(); return c.json({ detail: 'You must be invited to this deal before committing capital' }, 403); }
  const [inserted] = await sql`INSERT INTO commitments (deal_id, investor_user_id, amount, status, notes) VALUES (${id}, ${user.id}, ${amount}, 'pending', ${data.notes || null}) RETURNING uid`;
  await sql`UPDATE deals SET capital_committed = COALESCE(capital_committed, 0) + ${amount}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  const [after] = await sql`SELECT capital_committed FROM deals WHERE id = ${id}`;

  // Notify the founder that capital was committed.
  try {
    const own = await sql`SELECT f.id AS founder_user_id FROM deals d LEFT JOIN projects p ON p.id = d.project_id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE d.id = ${id}`;
    const founderUserId = (own[0] as any)?.founder_user_id;
    if (founderUserId) {
      const { notify } = await import('../services/notify');
      await notify(c.env, {
        userId: founderUserId,
        type: 'deal_commitment',
        title: 'New capital commitment',
        body: `${user.name} committed ${Math.round(amount).toLocaleString()} to your deal`,
        link: `/deals/${id}`,
        payload: { deal_id: id, amount },
        channels: ['in_app', 'email'],
        category: 'deals',
      });
    }
  } catch (e) { console.warn('[deals] commitment notify failed', e); }

  await sql.end();
  return c.json({ ok: true, uid: (inserted as any)?.uid, capital_committed: (after as any)?.capital_committed });
});

deals.get('/:id/activity', async (c) => {
  const id = parseInt(c.req.param('id'));
  const ctx = await loadDealForRead(c, id);
  if (ctx.error) return ctx.error;
  const { sql, deal } = ctx;
  const events: any[] = [];
  events.push({ type: 'created', label: 'Deal created', at: deal.created_at });
  if (deal.stage_changed_at) events.push({ type: 'stage', label: `Moved to ${deal.status}`, at: deal.stage_changed_at });
  const commits = await sql`SELECT c.amount, c.created_at, u.name AS investor_name FROM commitments c LEFT JOIN users u ON u.id = c.investor_user_id WHERE c.deal_id = ${id} ORDER BY c.created_at DESC`;
  for (const r of commits as any[]) {
    events.push({ type: 'commitment', label: `${r.investor_name || 'An investor'} committed ${Math.round(r.amount || 0).toLocaleString()}`, at: r.created_at });
  }
  const invites = await sql`SELECT di.status, di.created_at, di.responded_at, u.name AS investor_name FROM deal_invitations di LEFT JOIN users u ON u.id = di.investor_user_id WHERE di.deal_id = ${id} ORDER BY di.created_at DESC`;
  for (const r of invites as any[]) {
    events.push({
      type: 'invitation',
      label: `${r.investor_name || 'An investor'} invited${r.status !== 'invited' ? ` — ${r.status}` : ''}`,
      at: r.responded_at || r.created_at,
    });
  }
  await sql.end();
  events.sort((a, b) => (normTs(b.at) || 0) - (normTs(a.at) || 0));
  return c.json(events);
});

// ---------------------------------------------------------------------------
// Task #4 — Invitations (admin issue/list, investor respond).
// ---------------------------------------------------------------------------
deals.get('/:id/invitations', async (c) => {
  await requireAdmin(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT di.id, di.uid, di.deal_id, di.investor_user_id, di.status, di.message, di.email_opt_in, di.created_at, di.responded_at, u.name AS investor_name, u.email AS investor_email FROM deal_invitations di LEFT JOIN users u ON u.id = di.investor_user_id WHERE di.deal_id = ${id} ORDER BY di.created_at DESC`;
  await sql.end();
  return c.json(rows);
});

deals.post('/:id/invitations', async (c) => {
  const admin = await requireAdmin(c);
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const rows = await sql`SELECT d.status, p.name AS project_name FROM deals d LEFT JOIN projects p ON p.id = d.project_id WHERE d.id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }
  const status = String((rows[0] as any).status);
  if (status !== 'active' && status !== 'scored') {
    await sql.end();
    return c.json({ detail: 'Investors can only be invited to Active or Scored deals' }, 400);
  }
  const company = (rows[0] as any).project_name || `Deal #${id}`;
  const ids: number[] = Array.isArray(data.investor_user_ids) ? data.investor_user_ids : [];
  const sendEmail = !!data.send_email;
  let created = 0;
  for (const iid of ids) {
    const u = await sql`SELECT id, role FROM users WHERE id = ${iid}`;
    if (u.length === 0 || String((u[0] as any).role) !== 'investor') continue;
    let inserted: any[] = [];
    try {
      inserted = await sql`INSERT INTO deal_invitations (deal_id, investor_user_id, invited_by_user_id, message, email_opt_in, status) VALUES (${id}, ${iid}, ${admin.id}, ${data.message || null}, ${sendEmail ? 1 : 0}, 'invited') ON CONFLICT (deal_id, investor_user_id) DO NOTHING RETURNING id`;
    } catch { continue; }
    // Duplicate invite (ON CONFLICT no-op) — don't double-count or re-notify.
    if (!inserted.length) continue;
    created++;
    try {
      const { notify } = await import('../services/notify');
      await notify(c.env, {
        userId: iid,
        type: 'deal_invitation',
        title: `You're invited to review ${company}`,
        body: data.message || `${admin.name} invited you to review a deal.`,
        link: `/deals/${id}`,
        payload: { deal_id: id },
        channels: sendEmail ? ['in_app', 'email'] : ['in_app'],
        category: 'deals',
      });
    } catch (e) { console.warn('[deals] invitation notify failed', e); }
  }
  await sql.end();
  return c.json({ ok: true, invited: created });
});

deals.post('/:id/invitations/respond', async (c) => {
  const user = await requireRole(c, 'investor');
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json();
  const resp = data.response;
  if (resp !== 'interested' && resp !== 'passed') return c.json({ detail: "response must be 'interested' or 'passed'" }, 400);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, invited_by_user_id FROM deal_invitations WHERE deal_id = ${id} AND investor_user_id = ${user.id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'No invitation found for this deal' }, 404); }
  await sql`UPDATE deal_invitations SET status = ${resp}, responded_at = datetime('now') WHERE deal_id = ${id} AND investor_user_id = ${user.id}`;

  try {
    const inviter = (rows[0] as any).invited_by_user_id;
    if (inviter) {
      const { notify } = await import('../services/notify');
      await notify(c.env, {
        userId: inviter,
        type: 'deal_invitation_response',
        title: `${user.name} is ${resp} in a deal`,
        body: `${user.name} responded '${resp}' to your invitation.`,
        link: `/deals/${id}`,
        payload: { deal_id: id, response: resp },
        channels: ['in_app'],
        category: 'deals',
      });
    }
  } catch (e) { console.warn('[deals] invitation response notify failed', e); }

  await sql.end();
  return c.json({ ok: true, status: resp });
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
