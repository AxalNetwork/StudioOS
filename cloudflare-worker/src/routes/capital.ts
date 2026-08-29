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
import { lpMembershipScope } from '../services/tenancyScope';
import { claimLpRowsByEmail } from '../services/lpClaim';
import { requireAuth, canViewLpData } from '../auth';

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
  const __u = await requireAuth(c);
  if (!canViewLpData(__u)) return c.json({ error: "Forbidden: investor access required" }, 403);
  const sql = getSQL(c.env);
  // Admins see every LP across all funds; everyone else sees only their own
  // rows. Both cases come from `lpMembershipScope`, which returns ALL_ROWS for
  // an unscoped role — so the admin and non-admin branches are one query, and
  // the ownership rule cannot drift between them.
  //
  // The scope matches on verified account email as well as user_id, so a
  // legacy LP whose user_id was never backfilled reaches their own record.
  // Claiming that row converts the email match into a permanent account link.
  await claimLpRowsByEmail(c.env, Number(__u.id), (__u as any).email);
  const scope = lpMembershipScope(__u as any);
  const rows = await sql.unsafe(
    `SELECT lp.*, f.name AS fund_name, u.name AS user_name, u.email AS user_email
       FROM limited_partners lp
       JOIN vc_funds f ON f.id = lp.fund_id
       LEFT JOIN users u ON u.id = lp.user_id
      WHERE ${scope.sql}
      ORDER BY lp.created_at DESC`,
    [...scope.binds],
  );
  await sql.end();
  return c.json(rows.map(lpDto));
});

capital.post('/investors', async (c) => {
  const __u = await requireAuth(c);
  // Task #9 — adding an LP/investor record is a fund/GP operation, not
  // something an LP does for themselves. Admin-only (investors keep read +
  // pay-own-call access). Inlined to match the role checks in the scoped reads.
  if (__u.role !== 'admin') return c.json({ error: "Forbidden: admin access required" }, 403);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const fundName = data.fund_name || 'Axal Fund I';

  // Get-or-create the fund.
  let funds = await sql`SELECT id, name FROM vc_funds WHERE name = ${fundName}`;
  if (funds.length === 0) {
    funds = await sql`
      INSERT INTO vc_funds (name, status, created_at, updated_at)
      VALUES (${fundName}, 'active', datetime('now'), datetime('now'))
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
    VALUES (${fund.id}, ${data.name}, ${data.email}, ${data.committed_capital || 0}, 0, 'active', datetime('now'), datetime('now'))
    RETURNING *
  `;
  await sql`
    UPDATE vc_funds
    SET lp_count = lp_count + 1,
        total_commitment = total_commitment + ${data.committed_capital || 0},
        updated_at = datetime('now')
    WHERE id = ${fund.id}
  `;
  await sql.end();
  return c.json(lpDto({ ...lp, fund_name: fund.name }), 201);
});

capital.get('/investors/:id', async (c) => {
  const __u = await requireAuth(c);
  if (!canViewLpData(__u)) return c.json({ error: "Forbidden: investor access required" }, 403);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  // IDOR guard: a non-admin investor may only read an LP record (and its
  // capital calls) that belongs to them. The scope is ANDed onto the id
  // lookup, so a non-owner gets 404 and the capital_calls query below never
  // runs — without this any investor could read every LP's record and capital
  // calls by guessing ids. Admin gets ALL_ROWS from the same call, so the two
  // branches are one query and cannot drift.
  await claimLpRowsByEmail(c.env, Number(__u.id), (__u as any).email);
  const scope = lpMembershipScope(__u as any);
  const lps = await sql.unsafe(
    `SELECT lp.*, f.name AS fund_name, u.name AS user_name, u.email AS user_email
       FROM limited_partners lp
       JOIN vc_funds f ON f.id = lp.fund_id
       LEFT JOIN users u ON u.id = lp.user_id
      WHERE lp.id = ? AND ${scope.sql}`,
    [id, ...scope.binds],
  );
  if (lps.length === 0) { await sql.end(); return c.json({ error: 'Investor not found' }, 404); }
  const calls = await sql`SELECT * FROM capital_calls WHERE limited_partner_id = ${id}`;
  await sql.end();
  return c.json({ ...lpDto(lps[0]), capital_calls: calls.map(callDto) });
});

capital.post('/calls', async (c) => {
  const __u = await requireAuth(c);
  // Task #9 — capital calls are issued by the fund/GP, never by an individual
  // LP. Admin-only; investors keep read + pay-own-call access.
  if (__u.role !== 'admin') return c.json({ error: "Forbidden: admin access required" }, 403);
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

  // Phase 0.2 notify — fire after commit, never block the 201.
  try {
    const lpRow = await sql`SELECT user_id FROM limited_partners WHERE id = ${resolvedLpId}`;
    const lpUserId = lpRow[0]?.user_id;
    if (lpUserId) {
      const { notify } = await import('../services/notify');
      await notify(c.env, {
        userId: lpUserId,
        type: 'capital_call_issued',
        title: `Capital call: $${call.amount}`,
        body: `A capital call has been issued${call.due_date ? ` (due ${call.due_date})` : ''}.`,
        link: '/capital',
        payload: { call_id: call.id, amount: call.amount, due_date: call.due_date },
        channels: ['in_app', 'email', 'slack'],
      });
    }
  } catch (e) { console.warn('[capital] notify capital_call_issued failed', e); }

  await sql.end();
  return c.json(callDto(call), 201);
});

capital.get('/calls', async (c) => {
  const __u = await requireAuth(c);
  if (!canViewLpData(__u)) return c.json({ error: "Forbidden: investor access required" }, 403);
  const status = c.req.query('status');
  const sql = getSQL(c.env);
  // Admins see every capital call; everyone else sees only calls tied to an LP
  // row they own. Four query variants (admin/non-admin × status/no-status)
  // collapse to one: the scope supplies ALL_ROWS for an unscoped role, and the
  // optional status filter is a separate clause. Fewer variants is the point —
  // the old shape had the ownership predicate written twice, so a fix to one
  // could miss the other.
  await claimLpRowsByEmail(c.env, Number(__u.id), (__u as any).email);
  const scope = lpMembershipScope(__u as any);
  const where: string[] = [scope.sql];
  const binds: Array<string | number> = [...scope.binds];
  if (status) { where.push('cc.status = ?'); binds.push(status); }
  const rows = await sql.unsafe(
    `SELECT cc.* FROM capital_calls cc
       JOIN limited_partners lp ON lp.id = cc.limited_partner_id
      WHERE ${where.join(' AND ')}
      ORDER BY cc.created_at DESC`,
    binds,
  );
  await sql.end();
  return c.json(rows.map(callDto));
});

capital.post('/calls/:id/pay', async (c) => {
  const __u = await requireAuth(c);
  if (!canViewLpData(__u)) return c.json({ error: "Forbidden: investor access required" }, 403);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const calls = await sql`SELECT * FROM capital_calls WHERE id = ${id}`;
  if (calls.length === 0) { await sql.end(); return c.json({ error: 'Capital call not found' }, 404); }
  const call = calls[0];
  // IDOR guard: a non-admin investor may only act on a capital call that belongs
  // to one of their own LP records. Respond 404 (not 403) so a non-owner cannot
  // probe which call ids exist.
  if (__u.role !== 'admin') {
    // Same membership predicate as the reads above. Paying a call is the one
    // LP action with money attached, so a legacy LP being told their own call
    // does not exist is the sharpest form of the split this consolidates.
    await claimLpRowsByEmail(c.env, Number(__u.id), (__u as any).email);
    const scope = lpMembershipScope(__u as any);
    const owned = await sql.unsafe(
      `SELECT 1 FROM limited_partners lp WHERE lp.id = ? AND ${scope.sql} LIMIT 1`,
      [call.limited_partner_id, ...scope.binds],
    );
    if (owned.length === 0) { await sql.end(); return c.json({ error: 'Capital call not found' }, 404); }
  }
  if (call.status === 'paid') { await sql.end(); return c.json({ status: 'paid', call: callDto(call) }); }

  await sql`UPDATE capital_calls SET status = 'paid', paid_date = date('now') WHERE id = ${id}`;

  const lpId = call.limited_partner_id;
  if (lpId) {
    await sql`
      UPDATE limited_partners
      SET invested_amount = invested_amount + ${call.amount}, updated_at = datetime('now')
      WHERE id = ${lpId}
    `;
    await sql`
      UPDATE vc_funds
      SET deployed_capital = deployed_capital + ${call.amount}, updated_at = datetime('now')
      WHERE id = (SELECT fund_id FROM limited_partners WHERE id = ${lpId})
    `;
  }

  const [updated] = await sql`SELECT * FROM capital_calls WHERE id = ${id}`;

  try {
    if (lpId) {
      const lpRow = await sql`SELECT user_id FROM limited_partners WHERE id = ${lpId}`;
      const lpUserId = lpRow[0]?.user_id;
      if (lpUserId) {
        const { notify } = await import('../services/notify');
        await notify(c.env, {
          userId: lpUserId,
          type: 'capital_call_paid',
          title: `Capital call marked paid: $${updated.amount}`,
          body: 'Thanks — your capital call has been recorded as paid.',
          link: '/capital',
          payload: { call_id: updated.id, amount: updated.amount },
          channels: ['in_app', 'email'],
        });
      }
    }
  } catch (e) { console.warn('[capital] notify capital_call_paid failed', e); }

  await sql.end();
  return c.json({ status: 'paid', call: callDto(updated) });
});

capital.post('/capitalCall', async (c) => {
  const __u = await requireAuth(c);
  // Task #9 — issuing a capital call to all active investors at once is a
  // fund/GP operation. Admin-only; investors keep read + pay-own-call access.
  if (__u.role !== 'admin') return c.json({ error: "Forbidden: admin access required" }, 403);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const projects = await sql`SELECT * FROM projects WHERE id = ${data.startup_id}`;
  if (projects.length === 0) { await sql.end(); return c.json({ error: 'Startup/project not found' }, 404); }

  const investors = await sql`SELECT * FROM limited_partners WHERE status = 'active'`;
  if (investors.length === 0) { await sql.end(); return c.json({ error: 'No active investors found' }, 404); }

  const perInvestor = Math.round((data.amount / investors.length) * 100) / 100;
  // Batch all inserts into a single D1 round-trip instead of one INSERT per
  // active investor (was N+1). Mirrors the env.DB.batch pattern used elsewhere
  // (e.g. models/distributions.ts).
  const stmts = investors.map((inv: any) =>
    c.env.DB.prepare(
      `INSERT INTO capital_calls (limited_partner_id, project_id, amount) VALUES (?, ?, ?)`,
    ).bind(inv.id, data.startup_id, perInvestor),
  );
  await c.env.DB.batch(stmts);
  const callsCreated = investors.map((inv: any) => ({
    investor_id: inv.id, investor_name: inv.name, amount: perInvestor,
  }));

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
  const user = await requireAuth(c);
  if (!canViewLpData(user)) return c.json({ error: "Forbidden: investor access required" }, 403);
  const sql = getSQL(c.env);
  const projects = await sql`SELECT * FROM projects WHERE status IN ('spinout', 'active', 'tier_1', 'tier_2')`;
  // LP-facing portfolio: every score goes through the verified-read helper so
  // the HMAC is re-checked and the read is audited. Tampered or flagged rows
  // surface as score=null until admin signs off.
  const { getVerifiedLatestSnapshot } = await import('../services/scoreIntegrity');
  const portfolio = await Promise.all(
    projects.map(async (p: any) => {
      const verified = await getVerifiedLatestSnapshot(c.env, p.id, {
        role: user.role,
        founderId: user.founder_id ?? null,
        ownerFounderId: p.founder_id ?? null,
        userId: user.id ?? null,
      });
      return {
        id: p.id, name: p.name, sector: p.sector, status: p.status, playbook_week: p.playbook_week,
        score: verified?.row.total_score ?? null,
        tier: verified?.row.tier ?? null,
        revenue: p.revenue, users: p.users_count,
      };
    }),
  );
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
