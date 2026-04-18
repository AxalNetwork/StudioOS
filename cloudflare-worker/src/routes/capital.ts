/**
 * Capital & Investment routes (worker).
 *
 * Backed by the canonical `vc_funds` + `limited_partners` tables. The legacy
 * `lp_investors` table is no longer written to; the `consolidate_capital.sql`
 * migration mirrors any historical rows into the new tables.
 *
 * Response shapes preserve legacy keys (`committed_capital`, `called_capital`,
 * `fund_name`, `lp_investor_id`) so the existing frontend continues to work.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';

const capital = new Hono<{ Bindings: Env }>();

function lpDto(row: any) {
  return {
    id: row.id,
    name: row.name || row.user_name || null,
    email: row.email || row.user_email || null,
    fund_id: row.fund_id,
    fund_name: row.fund_name || null,
    commitment_amount: Number(row.commitment_amount || 0),
    invested_amount: Number(row.invested_amount || 0),
    returns: Number(row.returns || 0),
    // Backward-compatible aliases:
    committed_capital: Number(row.commitment_amount || 0),
    called_capital: Number(row.invested_amount || 0),
    status: row.status,
    created_at: row.created_at,
  };
}

function callDto(row: any) {
  return {
    ...row,
    lp_investor_id: row.limited_partner_id ?? row.lp_investor_id,
  };
}

capital.get('/investors', async (c) => {
  await requireAuth(c);
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT lp.*, f.name AS fund_name, u.name AS user_name, u.email AS user_email
    FROM limited_partners lp
    JOIN vc_funds f ON f.id = lp.fund_id
    LEFT JOIN users u ON u.id = lp.user_id
    ORDER BY lp.created_at DESC
  `;
  await sql.end();
  return c.json(rows.map(lpDto));
});

capital.post('/investors', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const fundName = data.fund_name || 'Axal Fund I';

  // Get-or-create the fund.
  let funds = await sql`SELECT id, name FROM vc_funds WHERE name = ${fundName}`;
  if (funds.length === 0) {
    funds = await sql`
      INSERT INTO vc_funds (name, status, created_at, updated_at)
      VALUES (${fundName}, 'active', NOW(), NOW())
      RETURNING id, name
    `;
  }
  const fund = funds[0];

  // Reject duplicate (email, fund_id) pair.
  const dup = await sql`
    SELECT id FROM limited_partners WHERE email = ${data.email} AND fund_id = ${fund.id}
  `;
  if (dup.length > 0) {
    await sql.end();
    return c.json({ error: `Investor ${data.email} already exists for fund '${fund.name}'` }, 409);
  }

  const [lp] = await sql`
    INSERT INTO limited_partners (fund_id, name, email, commitment_amount, invested_amount, status, created_at, updated_at)
    VALUES (${fund.id}, ${data.name}, ${data.email}, ${data.committed_capital || 0}, 0, 'active', NOW(), NOW())
    RETURNING *
  `;
  await sql`
    UPDATE vc_funds
    SET lp_count = lp_count + 1,
        total_commitment = total_commitment + ${data.committed_capital || 0},
        updated_at = NOW()
    WHERE id = ${fund.id}
  `;
  await sql.end();
  return c.json(lpDto({ ...lp, fund_name: fund.name }), 201);
});

capital.get('/investors/:id', async (c) => {
  await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const lps = await sql`
    SELECT lp.*, f.name AS fund_name, u.name AS user_name, u.email AS user_email
    FROM limited_partners lp
    JOIN vc_funds f ON f.id = lp.fund_id
    LEFT JOIN users u ON u.id = lp.user_id
    WHERE lp.id = ${id}
  `;
  if (lps.length === 0) { await sql.end(); return c.json({ error: 'Investor not found' }, 404); }
  const calls = await sql`SELECT * FROM capital_calls WHERE limited_partner_id = ${id}`;
  await sql.end();
  return c.json({ ...lpDto(lps[0]), capital_calls: calls.map(callDto) });
});

capital.post('/calls', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();
  // Accept either canonical or legacy field name.
  const lpId = data.limited_partner_id ?? data.lp_investor_id;
  if (!lpId) return c.json({ error: 'limited_partner_id is required' }, 422);

  const sql = getSQL(c.env);
  let resolvedLpId: number | null = null;
  const inv = await sql`SELECT id FROM limited_partners WHERE id = ${lpId}`;
  if (inv.length > 0) {
    resolvedLpId = inv[0].id;
  } else if (data.lp_investor_id != null && data.limited_partner_id == null) {
    // Backward compat: caller may have sent a TRUE legacy `lp_investors.id`.
    // Map it to the canonical `limited_partners.id` via (email, fund_name).
    // ORDER BY lp.id makes the pick deterministic if any historical
    // duplicate (fund_id, email) row predates the unique index.
    const mapped = await sql`
      SELECT lp.id FROM limited_partners lp
      JOIN vc_funds f ON f.id = lp.fund_id
      JOIN lp_investors li ON li.email = lp.email
                          AND COALESCE(li.fund_name, 'Axal Fund I') = f.name
      WHERE li.id = ${data.lp_investor_id}
      ORDER BY lp.id
      LIMIT 1
    `;
    if (mapped.length > 0) resolvedLpId = mapped[0].id;
  }
  if (resolvedLpId == null) { await sql.end(); return c.json({ error: 'Investor not found' }, 404); }
  const [call] = await sql`
    INSERT INTO capital_calls (limited_partner_id, project_id, amount, due_date)
    VALUES (${resolvedLpId}, ${data.project_id || null}, ${data.amount}, ${data.due_date || null})
    RETURNING *
  `;
  await sql.end();
  return c.json(callDto(call), 201);
});

capital.get('/calls', async (c) => {
  await requireAuth(c);
  const status = c.req.query('status');
  const sql = getSQL(c.env);
  const rows = status
    ? await sql`SELECT * FROM capital_calls WHERE status = ${status} ORDER BY created_at DESC`
    : await sql`SELECT * FROM capital_calls ORDER BY created_at DESC`;
  await sql.end();
  return c.json(rows.map(callDto));
});

capital.post('/calls/:id/pay', async (c) => {
  await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const calls = await sql`SELECT * FROM capital_calls WHERE id = ${id}`;
  if (calls.length === 0) { await sql.end(); return c.json({ error: 'Capital call not found' }, 404); }
  const call = calls[0];
  if (call.status === 'paid') { await sql.end(); return c.json({ status: 'paid', call: callDto(call) }); }

  await sql`UPDATE capital_calls SET status = 'paid', paid_date = date('now') WHERE id = ${id}`;

  const lpId = call.limited_partner_id;
  if (lpId) {
    await sql`
      UPDATE limited_partners
      SET invested_amount = invested_amount + ${call.amount}, updated_at = NOW()
      WHERE id = ${lpId}
    `;
    await sql`
      UPDATE vc_funds
      SET deployed_capital = deployed_capital + ${call.amount}, updated_at = NOW()
      WHERE id = (SELECT fund_id FROM limited_partners WHERE id = ${lpId})
    `;
  }

  const [updated] = await sql`SELECT * FROM capital_calls WHERE id = ${id}`;
  await sql.end();
  return c.json({ status: 'paid', call: callDto(updated) });
});

capital.post('/capitalCall', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const projects = await sql`SELECT * FROM projects WHERE id = ${data.startup_id}`;
  if (projects.length === 0) { await sql.end(); return c.json({ error: 'Startup/project not found' }, 404); }

  const investors = await sql`SELECT * FROM limited_partners WHERE status = 'active'`;
  if (investors.length === 0) { await sql.end(); return c.json({ error: 'No active investors found' }, 404); }

  const perInvestor = Math.round((data.amount / investors.length) * 100) / 100;
  const callsCreated = [];
  for (const inv of investors) {
    await sql`
      INSERT INTO capital_calls (limited_partner_id, project_id, amount)
      VALUES (${inv.id}, ${data.startup_id}, ${perInvestor})
    `;
    callsCreated.push({ investor_id: inv.id, investor_name: inv.name, amount: perInvestor });
  }

  const allPartners = await sql`SELECT * FROM partners WHERE status = 'active'`;
  await sql.end();

  const participating = allPartners.filter((p: any) =>
    p.specialization && projects[0].sector &&
    projects[0].sector.toLowerCase().includes(p.specialization.toLowerCase().split(',')[0]?.trim())
  );

  return c.json({
    startup_id: data.startup_id,
    startup_name: projects[0].name,
    total_amount: data.amount,
    calls_created: callsCreated,
    participating_partners: participating.map((p: any) => ({
      partner_id: p.id, name: p.name, company: p.company, specialization: p.specialization,
    })),
  });
});

capital.get('/portfolio', async (c) => {
  await requireAuth(c);
  const sql = getSQL(c.env);
  const projects = await sql`SELECT * FROM projects WHERE status IN ('spinout', 'active', 'tier_1', 'tier_2')`;
  const portfolio = [];
  for (const p of projects) {
    const scores = await sql`SELECT total_score, tier FROM score_snapshots WHERE project_id = ${p.id} ORDER BY created_at DESC LIMIT 1`;
    portfolio.push({
      id: p.id, name: p.name, sector: p.sector, status: p.status, playbook_week: p.playbook_week,
      score: scores[0]?.total_score || null, tier: scores[0]?.tier || null,
      revenue: p.revenue, users: p.users_count,
    });
  }
  const committed = await sql`SELECT COALESCE(SUM(commitment_amount), 0) as total FROM limited_partners`;
  const called = await sql`SELECT COALESCE(SUM(invested_amount), 0) as total FROM limited_partners`;
  await sql.end();
  return c.json({
    projects: portfolio,
    total_projects: portfolio.length,
    fund_metrics: { total_committed: committed[0].total, total_called: called[0].total },
  });
});

export default capital;
