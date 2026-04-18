import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';

const partnernet = new Hono<{ Bindings: Env }>();

const REL_TYPES = new Set(['co_investor', 'advisor_founder', 'operator_partner', 'strategic_alliance', 'mentor_mentee']);
const ACTION_TYPES = new Set([
  'dashboard_view', 'deal_review', 'syndicate_join', 'syndicate_create', 'referral_convert',
  'studio_ops_task', 'ai_scoring', 'payout_request', 'pipeline_advance', 'metric_snapshot',
  'relationship_create', 'profile_update', 'login', 'logout',
]);
const REL_CREATE_RATE_LIMIT = 20;
const SCORE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — keep recompute off the hot read path
const scoreCache = new Map<number, number>(); // userId -> next-allowed-recompute-timestamp

let migrated = false;
async function ensureSchema(env: Env) {
  if (migrated) return;
  const alters = [
    `ALTER TABLE users ADD COLUMN partner_since TIMESTAMP`,
    `ALTER TABLE users ADD COLUMN total_earnings INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN network_score REAL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN verified_badges TEXT DEFAULT '[]'`,
    `ALTER TABLE users ADD COLUMN last_active TIMESTAMP`,
  ];
  for (const a of alters) {
    try { await env.DB.prepare(a).run(); }
    catch (e: any) {
      if (!/duplicate column/i.test(e?.message || '')) {
        console.error('partnernet ALTER failed (non-duplicate):', e?.message);
        // Don't set migrated=true if a real ALTER fails — re-attempt next request
        return;
      }
    }
  }

  // The legacy activity_logs table (pre-partnernet) only had
  // (action, details, actor, ...) columns. partnernet writes/reads a
  // different set; gracefully add them when the legacy table exists.
  // If activity_logs doesn't exist yet, these ALTERs will fail with
  // "no such table" — also benign because the CREATE IF NOT EXISTS below
  // covers the fresh-DB case.
  const activityAlters = [
    `ALTER TABLE activity_logs ADD COLUMN action_type TEXT`,
    `ALTER TABLE activity_logs ADD COLUMN entity_type TEXT`,
    `ALTER TABLE activity_logs ADD COLUMN entity_id TEXT`,
    `ALTER TABLE activity_logs ADD COLUMN ip_address TEXT`,
    `ALTER TABLE activity_logs ADD COLUMN user_agent TEXT`,
    `ALTER TABLE activity_logs ADD COLUMN metadata TEXT DEFAULT '{}'`,
  ];
  for (const a of activityAlters) {
    try { await env.DB.prepare(a).run(); } catch {}
  }

  const stmts = [
    `CREATE TABLE IF NOT EXISTS partner_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_a_id INTEGER NOT NULL,
      partner_b_id INTEGER NOT NULL,
      relationship_type TEXT NOT NULL,
      strength_score REAL DEFAULT 50,
      metadata TEXT DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CHECK (partner_a_id < partner_b_id),
      CHECK (strength_score >= 0 AND strength_score <= 100)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_pr_pair ON partner_relationships(partner_a_id, partner_b_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pr_a ON partner_relationships(partner_a_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pr_b ON partner_relationships(partner_b_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pr_type ON partner_relationships(relationship_type)`,

    `CREATE TABLE IF NOT EXISTS relationship_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      relationship_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      details TEXT DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (relationship_id) REFERENCES partner_relationships(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_re_rel ON relationship_events(relationship_id, created_at)`,

    // activity_logs may already exist from the legacy schema with columns
    // (action, details, actor, ...). The CREATE IF NOT EXISTS below covers
    // a fresh DB; the ALTERs below cover an existing legacy DB. Keep both.
    `CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action_type TEXT,
      entity_type TEXT,
      entity_id TEXT,
      ip_address TEXT,
      user_agent TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_al_user ON activity_logs(user_id, created_at DESC)`,

    `CREATE TABLE IF NOT EXISTS activity_stats (
      user_id INTEGER NOT NULL,
      stat_date TEXT NOT NULL,
      action_count INTEGER DEFAULT 0,
      earnings_cents INTEGER DEFAULT 0,
      relationships_added INTEGER DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, stat_date)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_as_date ON activity_stats(stat_date)`,

    // Defensive copies of tables referenced by the partner_summary view.
    // These are also created by network.ts / networkfx.ts ensureSchema, but
    // partner_summary's SELECT will explode with "no such table" if those
    // routes haven't been hit yet on a fresh DB.
    `CREATE TABLE IF NOT EXISTS commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0, source TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS partner_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT, partner_a_id INTEGER NOT NULL, partner_b_id INTEGER NOT NULL,
      relationship_type TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS referral_chains (
      id INTEGER PRIMARY KEY AUTOINCREMENT, root_referrer_id INTEGER NOT NULL,
      referred_user_id INTEGER NOT NULL, depth INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    `DROP VIEW IF EXISTS partner_summary`,
    `CREATE VIEW partner_summary AS
      SELECT u.id, u.email, u.name, u.role, u.kyc_status,
        u.partner_since, u.total_earnings, u.network_score, u.verified_badges, u.last_active,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM commissions WHERE user_id = u.id) AS lifetime_earnings_cents,
        (SELECT COUNT(*) FROM partner_relationships WHERE partner_a_id = u.id OR partner_b_id = u.id) AS active_relationships,
        (SELECT COUNT(*) FROM referral_chains WHERE root_referrer_id = u.id) AS network_reach
      FROM users u`,
  ];
  for (const s of stmts) { try { await env.DB.prepare(s).run(); } catch (e: any) { console.error('partnernet schema:', e?.message); } }
  migrated = true;
}

function safeJson<T>(s: any, def: T): T { try { return s ? JSON.parse(s) : def; } catch { return def; } }
function pair(a: number, b: number): [number, number] { return a < b ? [a, b] : [b, a]; }

export async function logActivity(env: Env, userId: number, actionType: string, opts: {
  entityType?: string; entityId?: string | number; metadata?: any; ip?: string; ua?: string;
} = {}) {
  try {
    await env.DB.prepare(`INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, ip_address, user_agent, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(userId, actionType, opts.entityType || null, opts.entityId != null ? String(opts.entityId) : null, opts.ip || null, opts.ua || null, JSON.stringify(opts.metadata || {})).run();
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(`INSERT INTO activity_stats (user_id, stat_date, action_count) VALUES (?, ?, 1) ON CONFLICT(user_id, stat_date) DO UPDATE SET action_count = action_count + 1, updated_at = CURRENT_TIMESTAMP`)
      .bind(userId, today).run();
    await env.DB.prepare(`UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = ?`).bind(userId).run();
  } catch (e: any) { console.error('logActivity:', e?.message); }
}

async function recomputeNetworkScore(env: Env, userId: number, force = false): Promise<number | null> {
  // Cache: skip recompute if done within last 5 min (keeps /summary cheap on poll)
  const next = scoreCache.get(userId) || 0;
  if (!force && Date.now() < next) return null;
  scoreCache.set(userId, Date.now() + SCORE_CACHE_TTL_MS);

  try {
    const stats: any = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM partner_relationships WHERE partner_a_id = ? OR partner_b_id = ?) as rel_count,
        (SELECT COALESCE(AVG(strength_score), 0) FROM partner_relationships WHERE partner_a_id = ? OR partner_b_id = ?) as rel_avg,
        (SELECT COUNT(*) FROM referral_chains WHERE root_referrer_id = ?) as reach,
        (SELECT COUNT(*) FROM activity_logs WHERE user_id = ? AND created_at > datetime('now', '-30 days')) as activity_30d,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM commissions WHERE user_id = ?) as earnings_cents
    `).bind(userId, userId, userId, userId, userId, userId, userId).first();
    const relScore = Math.min(30, (stats.rel_count || 0) * 3) + Math.min(20, (stats.rel_avg || 0) * 0.2);
    const reachScore = Math.min(20, Math.log10((stats.reach || 0) + 1) * 10);
    const activityScore = Math.min(15, Math.log10((stats.activity_30d || 0) + 1) * 8);
    const earningsScore = Math.min(15, Math.log10(((stats.earnings_cents || 0) / 100) + 1) * 5);
    const score = Math.round((relScore + reachScore + activityScore + earningsScore) * 10) / 10;

    const badges: string[] = [];
    if ((stats.reach || 0) >= 10) badges.push('top_referrer');
    if ((stats.rel_count || 0) >= 5) badges.push('connector');
    if (((stats.earnings_cents || 0) / 100) >= 1000) badges.push('high_earner');
    try {
      const synLeads: any = await env.DB.prepare(`SELECT COUNT(*) as n FROM syndicates WHERE created_by = ?`).bind(userId).first();
      if ((synLeads?.n || 0) >= 1) badges.push('syndicate_lead');
    } catch {}

    // Note: total_earnings here is a denormalized cache of SUM(commissions) — payout flow
    // should NOT use this column for authoritative balances; query commissions/payouts directly.
    await env.DB.prepare(`UPDATE users SET network_score = ?, verified_badges = ?, total_earnings = ? WHERE id = ?`)
      .bind(score, JSON.stringify(badges), stats.earnings_cents || 0, userId).run();
    return score;
  } catch (e: any) { console.error('recomputeNetworkScore:', e?.message); return null; }
}

async function checkRelRateLimit(env: Env, userId: number): Promise<boolean> {
  const r: any = await env.DB.prepare(`SELECT COUNT(*) as n FROM partner_relationships WHERE (partner_a_id = ? OR partner_b_id = ?) AND created_at > datetime('now', '-1 hour')`).bind(userId, userId).first();
  return (r?.n || 0) < REL_CREATE_RATE_LIMIT;
}

partnernet.get('/relationships', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT pr.*, ua.email as a_email, ua.name as a_name, ub.email as b_email, ub.name as b_name
    FROM partner_relationships pr
    LEFT JOIN users ua ON ua.id = pr.partner_a_id
    LEFT JOIN users ub ON ub.id = pr.partner_b_id
    WHERE pr.partner_a_id = ${user.id} OR pr.partner_b_id = ${user.id}
    ORDER BY pr.strength_score DESC, pr.updated_at DESC
  `;
  await sql.end();
  const enriched = (rows as any[]).map(r => {
    const other = r.partner_a_id === user.id
      ? { id: r.partner_b_id, email: r.b_email, name: r.b_name }
      : { id: r.partner_a_id, email: r.a_email, name: r.a_name };
    return { ...r, metadata: safeJson(r.metadata, {}), other };
  });
  return c.json(enriched);
});

partnernet.post('/relationships', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const otherId = parseInt(data?.partner_id);
  const relType = String(data?.relationship_type || '');
  if (!otherId || !REL_TYPES.has(relType)) return c.json({ error: `partner_id and valid relationship_type required (${[...REL_TYPES].join('|')})` }, 400);
  if (otherId === user.id) return c.json({ error: 'Cannot create a relationship with yourself' }, 400);

  const other: any = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(otherId).first();
  if (!other) return c.json({ error: 'Other partner not found' }, 404);

  if (!(await checkRelRateLimit(c.env, user.id))) return c.json({ error: 'Rate limit (20 relationships/hour)' }, 429);

  const [a, b] = pair(user.id, otherId);
  const initialStrength = Number(data?.strength_score);
  const strength = Number.isFinite(initialStrength) && initialStrength >= 0 && initialStrength <= 100 ? initialStrength : 50;
  const metaIn = data?.metadata && typeof data.metadata === 'object' ? data.metadata : {};
  metaIn.created_by = user.id;
  const metaStr = JSON.stringify(metaIn).slice(0, 4000);

  let rel: any;
  try {
    rel = await c.env.DB.prepare(`INSERT INTO partner_relationships (partner_a_id, partner_b_id, relationship_type, strength_score, metadata) VALUES (?, ?, ?, ?, ?) RETURNING *`)
      .bind(a, b, relType, strength, metaStr).first();
  } catch (e: any) {
    if (/UNIQUE/i.test(e?.message || '')) return c.json({ error: 'Relationship already exists between these partners' }, 409);
    return c.json({ error: 'Could not create relationship' }, 500);
  }

  await c.env.DB.prepare(`INSERT INTO relationship_events (relationship_id, event_type, details) VALUES (?, 'created', ?)`)
    .bind(rel.id, JSON.stringify({ created_by: user.id, type: relType })).run();

  await logActivity(c.env, user.id, 'relationship_create', { entityType: 'relationship', entityId: rel.id, metadata: { other_id: otherId, type: relType } });
  // Force recompute for both sides when relationships change
  await Promise.all([recomputeNetworkScore(c.env, user.id, true), recomputeNetworkScore(c.env, otherId, true)]);

  return c.json({ ...rel, metadata: safeJson(rel.metadata, {}) }, 201);
});

partnernet.patch('/relationships/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'));
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const rel: any = await c.env.DB.prepare(`SELECT * FROM partner_relationships WHERE id = ?`).bind(id).first();
  if (!rel) return c.json({ error: 'Not found' }, 404);
  if (user.role !== 'admin' && rel.partner_a_id !== user.id && rel.partner_b_id !== user.id) return c.json({ error: 'Forbidden' }, 403);

  const updates: string[] = [];
  const values: any[] = [];
  if (Number.isFinite(Number(data?.strength_score))) {
    const s = Math.max(0, Math.min(100, Number(data.strength_score)));
    updates.push('strength_score = ?'); values.push(s);
  }
  if (data?.relationship_type && REL_TYPES.has(data.relationship_type)) {
    updates.push('relationship_type = ?'); values.push(data.relationship_type);
  }
  if (data?.metadata && typeof data.metadata === 'object') {
    updates.push('metadata = ?'); values.push(JSON.stringify(data.metadata).slice(0, 4000));
  }
  if (!updates.length) return c.json({ error: 'No valid fields' }, 400);
  updates.push('updated_at = CURRENT_TIMESTAMP');
  await c.env.DB.prepare(`UPDATE partner_relationships SET ${updates.join(', ')} WHERE id = ?`).bind(...values, id).run();

  await c.env.DB.prepare(`INSERT INTO relationship_events (relationship_id, event_type, details) VALUES (?, 'updated', ?)`)
    .bind(id, JSON.stringify({ by: user.id, fields: Object.keys(data) })).run();
  return c.json({ ok: true });
});

partnernet.get('/relationships/:id/events', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'));
  const rel: any = await c.env.DB.prepare(`SELECT partner_a_id, partner_b_id FROM partner_relationships WHERE id = ?`).bind(id).first();
  if (!rel) return c.json({ error: 'Not found' }, 404);
  if (user.role !== 'admin' && rel.partner_a_id !== user.id && rel.partner_b_id !== user.id) return c.json({ error: 'Forbidden' }, 403);
  const sql = getSQL(c.env);
  const events = await sql`SELECT * FROM relationship_events WHERE relationship_id = ${id} ORDER BY created_at DESC LIMIT 100`;
  await sql.end();
  return c.json((events as any[]).map(e => ({ ...e, details: safeJson(e.details, {}) })));
});

partnernet.post('/activity/log', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const action = String(data?.action_type || '');
  if (!ACTION_TYPES.has(action)) return c.json({ error: `Unknown action_type. Allowed: ${[...ACTION_TYPES].join(', ')}` }, 400);
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
  const ua = c.req.header('user-agent') || null;
  await logActivity(c.env, user.id, action, {
    entityType: data?.entity_type, entityId: data?.entity_id, metadata: data?.metadata, ip: ip || undefined, ua: ua || undefined,
  });
  return c.json({ ok: true });
});

partnernet.get('/activity/logs', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const limit = Math.min(100, parseInt(c.req.query('limit') || '50'));
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0'));
  const action = c.req.query('action_type');
  const isAdmin = user.role === 'admin';
  const targetUser = isAdmin && c.req.query('user_id') ? parseInt(c.req.query('user_id')!) : user.id;

  const sql = getSQL(c.env);
  const rows = action
    ? await sql`SELECT * FROM activity_logs WHERE user_id = ${targetUser} AND action_type = ${action} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
    : await sql`SELECT * FROM activity_logs WHERE user_id = ${targetUser} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  const [{ n: total }] = await sql`SELECT COUNT(*) as n FROM activity_logs WHERE user_id = ${targetUser}`;
  await sql.end();
  return c.json({
    items: (rows as any[]).map(r => ({ ...r, metadata: safeJson(r.metadata, {}) })),
    total: parseInt(total) || 0, limit, offset,
  });
});

partnernet.get('/summary', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const [summary] = await sql`SELECT * FROM partner_summary WHERE id = ${user.id}`;
  if (!summary) { await sql.end(); return c.json({ error: 'Not found' }, 404); }
  // Cached recompute (5-min TTL) — keeps hot read path cheap
  const newScore = await recomputeNetworkScore(c.env, user.id);
  if (newScore != null) summary.network_score = newScore;

  const recentActivity = await sql`SELECT id, action_type, entity_type, entity_id, created_at FROM activity_logs WHERE user_id = ${user.id} ORDER BY created_at DESC LIMIT 10`;
  const stats = await sql`SELECT stat_date, action_count, earnings_cents FROM activity_stats WHERE user_id = ${user.id} AND stat_date >= date('now', '-7 days') ORDER BY stat_date`;
  await sql.end();
  return c.json({
    ...summary,
    verified_badges: safeJson(summary.verified_badges, [] as string[]),
    recent_activity: recentActivity,
    daily_stats_7d: stats,
  });
});

// Leaderboard exposes emails + earnings → admin-only
partnernet.get('/leaderboard', async (c) => {
  const user = await requireAuth(c);
  if (user.role !== 'admin') return c.json({ error: 'Admin only' }, 403);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, name, email, role, network_score, total_earnings, active_relationships, network_reach, verified_badges FROM partner_summary WHERE network_score > 0 ORDER BY network_score DESC LIMIT 25`;
  await sql.end();
  return c.json((rows as any[]).map(r => ({ ...r, verified_badges: safeJson(r.verified_badges, [] as string[]) })));
});

// Public, redacted leaderboard — name + score + badges only (no email/earnings)
partnernet.get('/leaderboard/public', async (c) => {
  await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, name, role, network_score, active_relationships, network_reach, verified_badges FROM partner_summary WHERE network_score > 0 ORDER BY network_score DESC LIMIT 25`;
  await sql.end();
  return c.json((rows as any[]).map(r => ({
    ...r,
    name: r.name ? r.name.split(' ').map((p: string) => p[0]).join('').toUpperCase().slice(0, 3) : `User #${r.id}`,
    verified_badges: safeJson(r.verified_badges, [] as string[]),
  })));
});

export default partnernet;
