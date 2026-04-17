import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireApprovedKyc } from '../auth';

const networkfx = new Hono<{ Bindings: Env }>();

// Compounding multipliers in basis points: L1=10000 (100%), L2=5000 (50%), L3=2500 (25%)
const COMPOUNDING_BPS = [10000, 5000, 2500];
const MAX_LEVEL = 3;

let migrated = false;
async function ensureSchema(env: Env) {
  if (migrated) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS referral_chains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      root_referrer_id INTEGER NOT NULL,
      level INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      multiplier_bps INTEGER NOT NULL DEFAULT 10000,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_chain_unique ON referral_chains(root_referrer_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chain_user ON referral_chains(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chain_root ON referral_chains(root_referrer_id)`,
    `CREATE TABLE IF NOT EXISTS syndicates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_by INTEGER NOT NULL,
      deal_id INTEGER,
      target_cents INTEGER,
      min_commitment_cents INTEGER NOT NULL DEFAULT 100000,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      closed_at TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_syndicates_status ON syndicates(status)`,
    `CREATE INDEX IF NOT EXISTS idx_syndicates_deal ON syndicates(deal_id)`,
    `CREATE TABLE IF NOT EXISTS syndicate_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      syndicate_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      commitment_cents INTEGER NOT NULL,
      status TEXT DEFAULT 'committed',
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_syndmember_unique ON syndicate_members(syndicate_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_syndmember_user ON syndicate_members(user_id)`,
    `CREATE TABLE IF NOT EXISTS marketplace_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      title TEXT,
      bio TEXT,
      skills TEXT,
      hourly_rate_cents INTEGER,
      availability TEXT DEFAULT 'available',
      rating REAL DEFAULT 0,
      review_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mp_avail ON marketplace_profiles(availability)`,
    `CREATE INDEX IF NOT EXISTS idx_mp_rating ON marketplace_profiles(rating)`,
  ];
  for (const s of stmts) { try { await env.DB.prepare(s).run(); } catch {} }
  migrated = true;
}

function safeJson<T>(s: any, def: T): T { try { return s ? JSON.parse(s) : def; } catch { return def; } }
async function logAction(env: Env, actionType: string, performedBy: number | null, details: any = {}) {
  try { await env.DB.prepare(`INSERT INTO shared_services_log (workflow_id, action_type, details, performed_by) VALUES (NULL, ?, ?, ?)`).bind(actionType, JSON.stringify(details), performedBy).run(); } catch {}
}
async function checkAiQuota(env: Env, userId: number): Promise<boolean> {
  const sql = getSQL(env);
  const rows = await sql`SELECT COUNT(*) as n FROM shared_services_log WHERE performed_by = ${userId} AND action_type = 'ai_call' AND created_at > datetime('now', '-1 hour')`;
  await sql.end();
  return (parseInt(rows[0]?.n) || 0) < 60;
}
async function llmText(env: Env, system: string, prompt: string): Promise<string | null> {
  if (!env.AI) return null;
  try {
    const out: any = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], max_tokens: 350,
    });
    return (out?.response || '').trim() || null;
  } catch { return null; }
}

// ============================================================
// COMPOUNDING REFERRALS
// ============================================================

/**
 * Build the referral chain for a newly-referred user. Walks up to MAX_LEVEL ancestors.
 * Called from network.ts when a referral is registered.
 */
export async function buildReferralChain(env: Env, newUserId: number, directReferrerId: number) {
  await ensureSchema(env);
  let currentReferrerId: number | null = directReferrerId;
  for (let level = 1; level <= MAX_LEVEL && currentReferrerId; level++) {
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO referral_chains (root_referrer_id, level, user_id, multiplier_bps) VALUES (?, ?, ?, ?)`
      ).bind(currentReferrerId, level, newUserId, COMPOUNDING_BPS[level - 1]).run();
    } catch {}
    // Walk up: who referred currentReferrerId?
    const r: any = await env.DB.prepare(`SELECT referrer_id FROM referrals WHERE referred_id = ?`).bind(currentReferrerId).first();
    currentReferrerId = r?.referrer_id || null;
  }
}

/**
 * Pay compounding bonuses (L2, L3) when a base commission fires for the L1 referrer.
 * baseAmountCents is the L1 amount; L2 gets 50%, L3 gets 25%.
 * Idempotent via the existing UNIQUE INDEX on commissions(user_id, source_type, source_id).
 */
export async function fireCompoundingBonuses(env: Env, referredUserId: number, baseAmountCents: number, sourceType: string, sourceId: string) {
  await ensureSchema(env);
  // Find chain entries for this user where level >= 2
  const chain = await env.DB.prepare(
    `SELECT root_referrer_id, level, multiplier_bps FROM referral_chains WHERE user_id = ? AND level >= 2 ORDER BY level`
  ).bind(referredUserId).all();
  for (const row of (chain.results || []) as any[]) {
    const bonusCents = Math.floor((baseAmountCents * row.multiplier_bps) / 10000);
    if (bonusCents <= 0) continue;
    const bonusSourceId = `${sourceId}:L${row.level}`;
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO commissions (user_id, referral_id, amount_cents, source_type, source_id, status, description) VALUES (?, NULL, ?, ?, ?, 'accrued', ?)`
      ).bind(row.root_referrer_id, bonusCents, sourceType + '_compound', bonusSourceId, `Compounding L${row.level} bonus from ${sourceType}`).run();
    } catch {}
  }
}

networkfx.get('/referrals/compounding', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const chain = await sql`
    SELECT rc.*, u.name, u.email, u.kyc_status
    FROM referral_chains rc JOIN users u ON u.id = rc.user_id
    WHERE rc.root_referrer_id = ${user.id} ORDER BY rc.level, rc.created_at
  `;
  const bonuses = await sql`
    SELECT * FROM commissions WHERE user_id = ${user.id} AND source_type LIKE '%_compound' ORDER BY created_at DESC
  `;
  const summary = await sql`
    SELECT
      SUM(CASE WHEN source_type LIKE '%_compound' THEN amount_cents ELSE 0 END) as compound_cents,
      SUM(CASE WHEN source_type NOT LIKE '%_compound' THEN amount_cents ELSE 0 END) as direct_cents
    FROM commissions WHERE user_id = ${user.id}
  `;
  const byLevel: Record<number, any[]> = { 1: [], 2: [], 3: [] };
  for (const r of chain as any[]) { if (byLevel[r.level]) byLevel[r.level].push(r); }
  await sql.end();
  return c.json({
    levels: byLevel,
    counts: { L1: byLevel[1].length, L2: byLevel[2].length, L3: byLevel[3].length },
    bonuses_cents: parseInt(summary[0]?.compound_cents) || 0,
    direct_cents: parseInt(summary[0]?.direct_cents) || 0,
    bonuses,
    multipliers_bps: { L1: COMPOUNDING_BPS[0], L2: COMPOUNDING_BPS[1], L3: COMPOUNDING_BPS[2] },
  });
});

// ============================================================
// SYNDICATES
// ============================================================

networkfx.get('/syndicates', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const status = c.req.query('status');
  const sql = getSQL(c.env);
  const rows = status
    ? await sql`SELECT s.*, u.name as creator_name FROM syndicates s LEFT JOIN users u ON u.id = s.created_by WHERE s.status = ${status} ORDER BY s.created_at DESC LIMIT 100`
    : await sql`SELECT s.*, u.name as creator_name FROM syndicates s LEFT JOIN users u ON u.id = s.created_by ORDER BY s.created_at DESC LIMIT 100`;
  const ids = (rows as any[]).map(r => r.id);
  let memberMap: Record<number, any> = {};
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const memRows = await c.env.DB.prepare(
      `SELECT syndicate_id, COUNT(*) as members, COALESCE(SUM(commitment_cents), 0) as committed FROM syndicate_members WHERE syndicate_id IN (${placeholders}) GROUP BY syndicate_id`
    ).bind(...ids).all();
    for (const r of (memRows.results || []) as any[]) memberMap[r.syndicate_id] = { members: r.members, committed_cents: r.committed };
  }
  const enriched = (rows as any[]).map(r => ({ ...r, ...(memberMap[r.id] || { members: 0, committed_cents: 0 }) }));
  await sql.end();
  return c.json(enriched);
});

networkfx.get('/syndicates/:id', async (c) => {
  await requireAuth(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT s.*, u.name as creator_name FROM syndicates s LEFT JOIN users u ON u.id = s.created_by WHERE s.id = ${id}`;
  if (!rows.length) { await sql.end(); return c.json({ error: 'Not found' }, 404); }
  const members = await sql`SELECT m.*, u.name, u.email FROM syndicate_members m JOIN users u ON u.id = m.user_id WHERE syndicate_id = ${id} ORDER BY joined_at`;
  let project = null;
  if ((rows[0] as any).deal_id) {
    const p = await sql`SELECT id, name, sector, stage, status FROM projects WHERE id = ${(rows[0] as any).deal_id}`;
    if (p.length) project = p[0];
  }
  const totals = await sql`SELECT COUNT(*) as n, COALESCE(SUM(commitment_cents), 0) as committed FROM syndicate_members WHERE syndicate_id = ${id}`;
  await sql.end();
  return c.json({ ...rows[0], project, members, member_count: parseInt(totals[0]?.n) || 0, committed_cents: parseInt(totals[0]?.committed) || 0 });
});

networkfx.post('/syndicates', async (c) => {
  const user = await requireApprovedKyc(c);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  if (!data?.name) return c.json({ error: 'Name required' }, 400);
  const targetCents = data.target_cents ? Math.max(0, parseInt(data.target_cents)) : null;
  const minCents = data.min_commitment_cents ? Math.max(1, parseInt(data.min_commitment_cents)) : 100000;
  const dealId = data.deal_id ? parseInt(data.deal_id) : null;
  const sql = getSQL(c.env);
  const [s] = await sql`INSERT INTO syndicates (name, description, created_by, deal_id, target_cents, min_commitment_cents, status) VALUES (${data.name}, ${data.description || null}, ${user.id}, ${dealId}, ${targetCents}, ${minCents}, 'open') RETURNING *`;
  await sql.end();
  await logAction(c.env, 'syndicate_created', user.id, { syndicate_id: s.id, name: s.name });
  return c.json(s, 201);
});

networkfx.post('/syndicates/:id/join', async (c) => {
  const user = await requireApprovedKyc(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'));
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const commitmentCents = parseInt(data?.commitment_cents);
  if (!commitmentCents || commitmentCents <= 0) return c.json({ error: 'commitment_cents required' }, 400);

  const sRow: any = await c.env.DB.prepare(`SELECT * FROM syndicates WHERE id = ?`).bind(id).first();
  if (!sRow) return c.json({ error: 'Syndicate not found' }, 404);
  if (sRow.status !== 'open') return c.json({ error: 'Syndicate is not open' }, 400);
  if (commitmentCents < sRow.min_commitment_cents) return c.json({ error: `Minimum commitment is $${(sRow.min_commitment_cents / 100).toFixed(2)}` }, 400);
  if (sRow.created_by === user.id) return c.json({ error: 'Cannot join your own syndicate' }, 400);

  // Atomic insert via UNIQUE index — duplicate join returns 409
  try {
    await c.env.DB.prepare(`INSERT INTO syndicate_members (syndicate_id, user_id, commitment_cents) VALUES (?, ?, ?)`).bind(id, user.id, commitmentCents).run();
  } catch (e: any) {
    if (String(e?.message || '').toLowerCase().includes('unique')) return c.json({ error: 'Already joined this syndicate' }, 409);
    throw e;
  }
  await logAction(c.env, 'syndicate_joined', user.id, { syndicate_id: id, commitment_cents: commitmentCents });

  // Auto-close if target reached
  if (sRow.target_cents) {
    const totals: any = await c.env.DB.prepare(`SELECT COALESCE(SUM(commitment_cents), 0) as c FROM syndicate_members WHERE syndicate_id = ?`).bind(id).first();
    if ((totals?.c || 0) >= sRow.target_cents) {
      await c.env.DB.prepare(`UPDATE syndicates SET status = 'funded', closed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'`).bind(id).run();
      await logAction(c.env, 'syndicate_funded', user.id, { syndicate_id: id, total_cents: totals.c });
    }
  }

  return c.json({ ok: true });
});

networkfx.post('/syndicates/:id/close', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'));
  const s: any = await c.env.DB.prepare(`SELECT created_by FROM syndicates WHERE id = ?`).bind(id).first();
  if (!s) return c.json({ error: 'Not found' }, 404);
  if (s.created_by !== user.id && user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  await c.env.DB.prepare(`UPDATE syndicates SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run();
  await logAction(c.env, 'syndicate_closed', user.id, { syndicate_id: id });
  return c.json({ ok: true });
});

networkfx.get('/syndicates/:id/recommendations', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  if (!(await checkAiQuota(c.env, user.id))) return c.json({ error: 'Rate limit (60/hour)' }, 429);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const sRows = await sql`SELECT * FROM syndicates WHERE id = ${id}`;
  if (!sRows.length) { await sql.end(); return c.json({ error: 'Syndicate not found' }, 404);  }
  const synd: any = sRows[0];
  // RBAC: only creator, syndicate members, or admin can pull AI candidate lists (avoids investor-list scraping)
  if (synd.created_by !== user.id && user.role !== 'admin') {
    const m = await sql`SELECT 1 FROM syndicate_members WHERE syndicate_id = ${id} AND user_id = ${user.id} LIMIT 1`;
    if (!m.length) { await sql.end(); return c.json({ error: 'Forbidden — only the syndicate creator, members, or admins can request recommendations' }, 403); }
  }
  // Pull top investors by deal_flow score for this syndicate's deal (if any), excluding already-joined members and the creator
  let recs: any[] = [];
  if (synd.deal_id) {
    recs = await sql`
      SELECT u.id, u.name, u.email, u.role, ms.score, ms.explanation
      FROM match_scores ms JOIN users u ON u.id = ms.user_id
      WHERE ms.deal_id = ${synd.deal_id} AND ms.score_type = 'deal_flow'
        AND u.kyc_status = 'approved'
        AND u.id != ${synd.created_by}
        AND u.id NOT IN (SELECT user_id FROM syndicate_members WHERE syndicate_id = ${id})
      ORDER BY ms.score DESC LIMIT 10
    `;
  } else {
    recs = await sql`
      SELECT u.id, u.name, u.email, u.role, NULL as score, NULL as explanation
      FROM users u
      WHERE u.kyc_status = 'approved' AND u.role IN ('partner', 'admin')
        AND u.id != ${synd.created_by}
        AND u.id NOT IN (SELECT user_id FROM syndicate_members WHERE syndicate_id = ${id})
      ORDER BY u.id DESC LIMIT 10
    `;
  }
  await sql.end();
  const ai = await llmText(c.env,
    'You are a venture-studio analyst. Suggest a brief 2-sentence rationale for forming this syndicate and what kind of investor would be ideal.',
    `Syndicate: name="${synd.name}", description="${synd.description || ''}", target=$${synd.target_cents ? synd.target_cents/100 : 'open'}, min=$${synd.min_commitment_cents/100}, deal_id=${synd.deal_id || 'none'}.`);
  await logAction(c.env, 'ai_call', user.id, { kind: 'syndicate_recs', syndicate_id: id });
  return c.json({ rationale: ai || 'AI analysis unavailable.', candidates: recs, model: ai ? '@cf/meta/llama-3.1-8b-instruct' : 'unavailable' });
});

// ============================================================
// MARKETPLACE
// ============================================================

networkfx.get('/marketplace/me', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM marketplace_profiles WHERE user_id = ${user.id}`;
  await sql.end();
  if (!rows.length) return c.json({ user_id: user.id, title: '', bio: '', skills: [], hourly_rate_cents: null, availability: 'available', rating: 0, review_count: 0, exists: false });
  const p: any = rows[0];
  return c.json({ ...p, skills: safeJson(p.skills, []), exists: true });
});

networkfx.put('/marketplace/me', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const skills = JSON.stringify(Array.isArray(data.skills) ? data.skills.slice(0, 30).map((s: any) => String(s).slice(0, 50)) : []);
  const title = (data.title || '').toString().slice(0, 200);
  const bio = (data.bio || '').toString().slice(0, 2000);
  const rate = data.hourly_rate_cents ? Math.max(0, parseInt(data.hourly_rate_cents)) : null;
  const avail = ['available', 'booked'].includes(data.availability) ? data.availability : 'available';
  await c.env.DB.prepare(`
    INSERT INTO marketplace_profiles (user_id, title, bio, skills, hourly_rate_cents, availability, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET title=excluded.title, bio=excluded.bio, skills=excluded.skills, hourly_rate_cents=excluded.hourly_rate_cents, availability=excluded.availability, updated_at=CURRENT_TIMESTAMP
  `).bind(user.id, title, bio, skills, rate, avail).run();
  await logAction(c.env, 'marketplace_profile_updated', user.id);
  return c.json({ ok: true });
});

networkfx.get('/marketplace/search', async (c) => {
  await requireAuth(c);
  await ensureSchema(c.env);
  const skill = c.req.query('skill');
  const role = c.req.query('role');
  const availability = c.req.query('availability');
  const minRating = c.req.query('min_rating');
  const sql = getSQL(c.env);
  let rows: any[];
  // Build query with prepared params for safety
  let whereClauses = ['1=1'];
  const params: any[] = [];
  if (role) { whereClauses.push('u.role = ?'); params.push(role); }
  if (availability) { whereClauses.push('mp.availability = ?'); params.push(availability); }
  if (minRating) { whereClauses.push('mp.rating >= ?'); params.push(parseFloat(minRating)); }
  if (skill) { whereClauses.push("mp.skills LIKE ?"); params.push(`%${skill.replace(/[%_\\]/g, '')}%`); }
  const queryStr = `SELECT mp.*, u.name, u.email, u.role FROM marketplace_profiles mp JOIN users u ON u.id = mp.user_id WHERE ${whereClauses.join(' AND ')} ORDER BY mp.rating DESC, mp.review_count DESC LIMIT 50`;
  const result = await c.env.DB.prepare(queryStr).bind(...params).all();
  rows = (result.results || []).map((r: any) => ({ ...r, skills: safeJson(r.skills, []) }));
  await sql.end();
  return c.json(rows);
});

networkfx.post('/marketplace/request-intro', async (c) => {
  const user = await requireApprovedKyc(c);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const targetUserId = parseInt(data?.target_user_id);
  if (!targetUserId) return c.json({ error: 'target_user_id required' }, 400);
  if (targetUserId === user.id) return c.json({ error: 'Cannot request intro to yourself' }, 400);
  const message = (data?.message || '').toString().slice(0, 1000);
  const projectId = data?.project_id ? parseInt(data.project_id) : null;

  // Verify target has a marketplace profile
  const target: any = await c.env.DB.prepare(`SELECT u.name, u.email FROM marketplace_profiles mp JOIN users u ON u.id = mp.user_id WHERE u.id = ?`).bind(targetUserId).first();
  if (!target) return c.json({ error: 'Target is not on the marketplace' }, 404);

  // Auto-create a Studio Ops workflow_task for an admin to handle the intro
  // Find or create a strategic workflow for "Marketplace Intros"
  let wf: any = await c.env.DB.prepare(`SELECT id FROM workflows WHERE template_key = 'marketplace.intros' AND project_id IS NULL LIMIT 1`).first();
  if (!wf) {
    const r: any = await c.env.DB.prepare(`INSERT INTO workflows (type, title, description, status, template_key, owner_user_id) VALUES ('strategic', 'Marketplace Intro Requests', 'Pending intro/booking requests from the operator/advisor marketplace.', 'active', 'marketplace.intros', ?) RETURNING id`).bind(user.id).first();
    wf = r;
  }
  await c.env.DB.prepare(`INSERT INTO workflow_tasks (workflow_id, title, description, status, ai_assisted, metadata) VALUES (?, ?, ?, 'todo', 0, ?)`)
    .bind(wf.id, `Intro: ${user.email} → ${target.name || target.email}`, message || `Requested intro to operator/advisor (user #${targetUserId})${projectId ? ` for project #${projectId}` : ''}.`, JSON.stringify({ kind: 'intro', requester_id: user.id, target_id: targetUserId, project_id: projectId })).run();
  await logAction(c.env, 'marketplace_intro_request', user.id, { target_user_id: targetUserId, project_id: projectId });
  return c.json({ ok: true, workflow_id: wf.id });
});

networkfx.post('/marketplace/match', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  if (!(await checkAiQuota(c.env, user.id))) return c.json({ error: 'Rate limit (60/hour)' }, 429);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const need = (data?.need || '').toString().slice(0, 1000);
  if (!need) return c.json({ error: '"need" required (free-text description)' }, 400);
  // Pull all available marketplace profiles
  const result = await c.env.DB.prepare(`SELECT mp.*, u.name, u.email, u.role FROM marketplace_profiles mp JOIN users u ON u.id = mp.user_id WHERE mp.availability = 'available' ORDER BY mp.rating DESC LIMIT 30`).all();
  const profiles = (result.results || []).map((r: any) => ({ ...r, skills: safeJson(r.skills, []) }));
  const compact = profiles.map((p: any) => ({ id: p.user_id, name: p.name, role: p.role, title: p.title, skills: p.skills, rating: p.rating }));
  const ai = await llmText(c.env,
    'Recommend the top 3 operators/advisors for a stated need. Output JSON {"recommendations":[{"user_id":number,"reason":"1 sentence"}]}.',
    `Need: ${need}\n\nAvailable profiles: ${JSON.stringify(compact)}`
  );
  await logAction(c.env, 'ai_call', user.id, { kind: 'marketplace_match' });
  let recs: any[] = [];
  if (ai) {
    const m = ai.match(/\{[\s\S]*\}/);
    if (m) { try { recs = JSON.parse(m[0]).recommendations || []; } catch {} }
  }
  // Fallback: top 3 by rating
  if (!recs.length) recs = profiles.slice(0, 3).map((p: any) => ({ user_id: p.user_id, reason: `Top-rated ${p.role}: ${p.title || ''}` }));
  // Hydrate
  const byId = new Map(profiles.map((p: any) => [p.user_id, p]));
  const hydrated = recs.map((r: any) => ({ ...r, profile: byId.get(r.user_id) || null })).filter((r: any) => r.profile);
  return c.json({ need, recommendations: hydrated, model: ai ? '@cf/meta/llama-3.1-8b-instruct' : 'rule-based' });
});

// ============================================================
// EFFECTS DASHBOARD SUMMARY
// ============================================================

networkfx.get('/effects', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const compoundEarnings = await sql`SELECT COALESCE(SUM(amount_cents), 0) as c FROM commissions WHERE user_id = ${user.id} AND source_type LIKE '%_compound'`;
  const directEarnings = await sql`SELECT COALESCE(SUM(amount_cents), 0) as c FROM commissions WHERE user_id = ${user.id} AND source_type NOT LIKE '%_compound'`;
  const chainCounts = await sql`SELECT level, COUNT(*) as n FROM referral_chains WHERE root_referrer_id = ${user.id} GROUP BY level`;
  const activeSyndicates = await sql`SELECT COUNT(*) as n FROM syndicates WHERE status = 'open'`;
  const mySyndicates = await sql`SELECT COUNT(*) as n FROM syndicate_members WHERE user_id = ${user.id}`;
  const marketplaceCount = await sql`SELECT COUNT(*) as n FROM marketplace_profiles WHERE availability = 'available'`;
  await sql.end();
  const chains: Record<string, number> = { L1: 0, L2: 0, L3: 0 };
  for (const r of chainCounts as any[]) { chains[`L${r.level}`] = r.n; }
  return c.json({
    compound_earnings_cents: parseInt(compoundEarnings[0]?.c) || 0,
    direct_earnings_cents: parseInt(directEarnings[0]?.c) || 0,
    chain_counts: chains,
    active_syndicates: parseInt(activeSyndicates[0]?.n) || 0,
    my_syndicates: parseInt(mySyndicates[0]?.n) || 0,
    marketplace_available: parseInt(marketplaceCount[0]?.n) || 0,
  });
});

export default networkfx;
