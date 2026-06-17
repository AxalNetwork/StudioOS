import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireAdmin } from '../auth';
import { filterOptedInUserIds } from '../services/matchingConsent';
import { logMatchListGeneration } from '../services/matchAudit';
import {
  confidenceAdjustedAlignment,
  computeWatchOuts,
  type ValueEntry,
} from '../services/matchingVectors';

const matches = new Hono<{ Bindings: Env }>();

let migrated = false;
async function ensureSchema(env: Env) {
  if (migrated) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INTEGER PRIMARY KEY,
      investment_focus TEXT,
      preferred_stages TEXT,
      preferred_roles TEXT,
      min_check_cents INTEGER,
      max_check_cents INTEGER,
      risk_tolerance TEXT,
      bio TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS match_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER,
      user_id INTEGER NOT NULL,
      target_user_id INTEGER,
      score_type TEXT NOT NULL,
      score REAL NOT NULL,
      explanation TEXT,
      model TEXT,
      breakdown TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_match_scores_user ON match_scores(user_id, score_type)`,
    `CREATE INDEX IF NOT EXISTS idx_match_scores_deal ON match_scores(deal_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_match_scores_unique ON match_scores(user_id, score_type, COALESCE(deal_id, 0), COALESCE(target_user_id, 0))`,
  ];
  for (const s of stmts) { try { await env.DB.prepare(s).run(); } catch {} }
  migrated = true;
}

// --------- LLM helper (Cloudflare Workers AI; falls back to rule-based on failure) ---------

async function llmJson(env: Env, system: string, userPrompt: string): Promise<any | null> {
  if (!env.AI) return null;
  try {
    const out: any = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: system + '\n\nReply ONLY with valid JSON, no prose, no markdown fences.' },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 256,
    });
    const text = (out?.response || '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (e) { console.error('llmJson failed:', e); return null; }
}

// --------- Rule-based scorers (fallback + speed boost) ---------

function ruleScoreDealFlow(project: any, prefs: any): { score: number; reasons: string[] } {
  let score = 50;
  const reasons: string[] = [];
  const focus: string[] = (() => { try { return JSON.parse(prefs?.investment_focus || '[]'); } catch { return []; } })();
  const stages: string[] = (() => { try { return JSON.parse(prefs?.preferred_stages || '[]'); } catch { return []; } })();

  if (focus.length && project.sector) {
    const sectorLower = project.sector.toLowerCase();
    const hit = focus.some((f: string) => sectorLower.includes(f.toLowerCase()) || f.toLowerCase().includes(sectorLower));
    if (hit) { score += 25; reasons.push(`Sector match: ${project.sector}`); }
    else { score -= 10; reasons.push(`Sector mismatch: ${project.sector} not in focus`); }
  }
  if (stages.length && project.stage && stages.includes(project.stage)) {
    score += 15; reasons.push(`Stage match: ${project.stage}`);
  }
  if (project.status === 'tier_1') { score += 15; reasons.push('Tier-1 vetted'); }
  else if (project.status === 'tier_2') { score += 5; reasons.push('Tier-2 vetted'); }
  else if (project.status === 'rejected') { score -= 30; reasons.push('Rejected by scoring engine'); }

  const fundingMin = prefs?.min_check_cents ? prefs.min_check_cents / 100 : null;
  const fundingMax = prefs?.max_check_cents ? prefs.max_check_cents / 100 : null;
  if (project.funding_needed) {
    if (fundingMax && project.funding_needed > fundingMax) { score -= 8; reasons.push('Above max check size'); }
    else if (fundingMin && project.funding_needed < fundingMin) { score -= 5; reasons.push('Below min check size'); }
    else if (fundingMin || fundingMax) { score += 8; reasons.push('Within check size range'); }
  }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

// --------- Preferences ---------

matches.get('/preferences', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM user_preferences WHERE user_id = ${user.id}`;
  await sql.end();
  if (rows.length === 0) {
    return c.json({
      user_id: user.id,
      investment_focus: [], preferred_stages: [], preferred_roles: [],
      min_check_cents: null, max_check_cents: null, risk_tolerance: null, bio: null,
      updated_at: null,
    });
  }
  const p: any = rows[0];
  return c.json({
    ...p,
    investment_focus: safeJson(p.investment_focus, []),
    preferred_stages: safeJson(p.preferred_stages, []),
    preferred_roles: safeJson(p.preferred_roles, []),
  });
});

matches.put('/preferences', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  if (!data || typeof data !== 'object') return c.json({ error: 'Body must be an object' }, 400);
  const focus = JSON.stringify(Array.isArray(data.investment_focus) ? data.investment_focus.slice(0, 20) : []);
  const stagesArr = JSON.stringify(Array.isArray(data.preferred_stages) ? data.preferred_stages.slice(0, 10) : []);
  const rolesArr = JSON.stringify(Array.isArray(data.preferred_roles) ? data.preferred_roles.slice(0, 10) : []);
  const minC = data.min_check_cents ? parseInt(data.min_check_cents) : null;
  const maxC = data.max_check_cents ? parseInt(data.max_check_cents) : null;
  const risk = ['low', 'medium', 'high'].includes(data.risk_tolerance) ? data.risk_tolerance : null;
  const bio = (data.bio || '').toString().slice(0, 1000);

  await c.env.DB.prepare(`
    INSERT INTO user_preferences (user_id, investment_focus, preferred_stages, preferred_roles, min_check_cents, max_check_cents, risk_tolerance, bio, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      investment_focus = excluded.investment_focus,
      preferred_stages = excluded.preferred_stages,
      preferred_roles = excluded.preferred_roles,
      min_check_cents = excluded.min_check_cents,
      max_check_cents = excluded.max_check_cents,
      risk_tolerance = excluded.risk_tolerance,
      bio = excluded.bio,
      updated_at = CURRENT_TIMESTAMP
  `).bind(user.id, focus, stagesArr, rolesArr, minC, maxC, risk, bio).run();
  return c.json({ ok: true });
});

// --------- Rate limit (max 60 LLM scoring requests per user per hour) ---------
async function checkLlmQuota(env: Env, userId: number): Promise<boolean> {
  const sql = getSQL(env);
  const rows = await sql`SELECT COUNT(*) as n FROM match_scores WHERE user_id = ${userId} AND model LIKE '@cf/%' AND created_at > datetime('now', '-1 hour')`;
  await sql.end();
  return (parseInt(rows[0]?.n) || 0) < 60;
}

async function upsertScore(env: Env, row: { user_id: number; score_type: string; deal_id: number | null; target_user_id: number | null; score: number; explanation: string; model: string }) {
  await env.DB.prepare(`
    INSERT INTO match_scores (user_id, score_type, deal_id, target_user_id, score, explanation, model)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, score_type, COALESCE(deal_id, 0), COALESCE(target_user_id, 0)) DO UPDATE SET
      score = excluded.score, explanation = excluded.explanation, model = excluded.model, created_at = CURRENT_TIMESTAMP
  `).bind(row.user_id, row.score_type, row.deal_id, row.target_user_id, row.score, row.explanation, row.model).run();
}

// --------- Deal flow scoring ---------

async function scoreOneDeal(env: Env, user: any, prefs: any, project: any): Promise<{ score: number; explanation: string; model: string }> {
  const rule = ruleScoreDealFlow(project, prefs);
  const llm = await llmJson(env,
    'You are a venture-studio analyst scoring how well a deal matches an investor profile. Output JSON {"score": number 0-100, "explanation": "1-2 sentences"}.',
    `Investor profile: focus=${prefs?.investment_focus || '[]'}, stages=${prefs?.preferred_stages || '[]'}, check=${prefs?.min_check_cents ? '$' + (prefs.min_check_cents / 100) : 'n/a'}–${prefs?.max_check_cents ? '$' + (prefs.max_check_cents / 100) : 'n/a'}, risk=${prefs?.risk_tolerance || 'n/a'}.\n\nDeal: name="${project.name}", sector=${project.sector}, stage=${project.stage}, status=${project.status}, problem=${project.problem_statement || 'n/a'}, solution=${project.solution || 'n/a'}, funding_needed=${project.funding_needed || 'n/a'}, tam=${project.tam || 'n/a'}.\n\nInternal rule-based starting score: ${rule.score} (${rule.reasons.join('; ')}). Adjust if needed.`
  );
  const score = (llm && typeof llm.score === 'number') ? Math.max(0, Math.min(100, llm.score)) : rule.score;
  const explanation = (llm?.explanation && typeof llm.explanation === 'string') ? llm.explanation.slice(0, 500) : rule.reasons.join('; ');
  return { score, explanation, model: llm ? '@cf/meta/llama-3.1-8b-instruct' : 'rule-based' };
}

matches.get('/deal-flow', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const prefsRow = await sql`SELECT * FROM user_preferences WHERE user_id = ${user.id}`;
  const prefs = prefsRow[0] || null;

  // Show vetted (not rejected) projects
  const projects = await sql`
    SELECT * FROM projects
    WHERE status NOT IN ('rejected') AND status IS NOT NULL
    ORDER BY created_at DESC LIMIT 50
  `;

  // Pull existing cached scores
  const cached = await sql`SELECT * FROM match_scores WHERE user_id = ${user.id} AND score_type = 'deal_flow'`;
  const cacheMap: Record<number, any> = {};
  for (const c2 of cached as any[]) { if (c2.deal_id) cacheMap[c2.deal_id] = c2; }
  await sql.end();

  // Score uncached projects (up to 5 fresh LLM calls per request to keep latency reasonable)
  const enriched: any[] = [];
  let llmBudget = 5;
  const ok = await checkLlmQuota(c.env, user.id);
  for (const p of projects as any[]) {
    if (cacheMap[p.id]) {
      enriched.push({ project: p, score: cacheMap[p.id].score, explanation: cacheMap[p.id].explanation, model: cacheMap[p.id].model, cached: true });
    } else if (llmBudget > 0 && ok) {
      const s = await scoreOneDeal(c.env, user, prefs, p);
      await upsertScore(c.env, { user_id: user.id, score_type: 'deal_flow', deal_id: p.id, target_user_id: null, ...s });
      enriched.push({ project: p, ...s, cached: false });
      llmBudget--;
    } else {
      const s = ruleScoreDealFlow(p, prefs);
      enriched.push({ project: p, score: s.score, explanation: s.reasons.join('; '), model: 'rule-based', cached: false });
    }
  }

  enriched.sort((a, b) => b.score - a.score);
  return c.json({ user_id: user.id, items: enriched, llm_budget_remaining: llmBudget });
});

// --------- Co-invest ---------

matches.get('/co-invest', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const prefsRow = await sql`SELECT * FROM user_preferences WHERE user_id = ${user.id}`;
  const prefs = prefsRow[0] || null;

  // Co-invest = active deals (status=active) where capital is being raised
  const projects = await sql`
    SELECT p.*, d.status as deal_status FROM projects p
    JOIN deals d ON d.project_id = p.id
    WHERE p.status IN ('tier_1', 'tier_2') AND d.status IN ('active', 'scored')
    ORDER BY p.created_at DESC LIMIT 30
  `;

  const cached = await sql`SELECT * FROM match_scores WHERE user_id = ${user.id} AND score_type = 'co_invest'`;
  const cacheMap: Record<number, any> = {};
  for (const c2 of cached as any[]) { if (c2.deal_id) cacheMap[c2.deal_id] = c2; }
  await sql.end();

  const enriched: any[] = [];
  let llmBudget = 5;
  const ok = await checkLlmQuota(c.env, user.id);
  for (const p of projects as any[]) {
    if (cacheMap[p.id]) {
      enriched.push({ project: p, score: cacheMap[p.id].score, explanation: cacheMap[p.id].explanation, cached: true });
    } else if (llmBudget > 0 && ok) {
      // Reuse deal-flow scorer but tag as co_invest
      const s = await scoreOneDeal(c.env, user, prefs, p);
      await upsertScore(c.env, { user_id: user.id, score_type: 'co_invest', deal_id: p.id, target_user_id: null, ...s });
      enriched.push({ project: p, ...s, cached: false });
      llmBudget--;
    } else {
      const s = ruleScoreDealFlow(p, prefs);
      enriched.push({ project: p, score: s.score, explanation: s.reasons.join('; '), cached: false });
    }
  }
  enriched.sort((a, b) => b.score - a.score);
  return c.json({ items: enriched.slice(0, 10), total: enriched.length });
});

// --------- Referral scoring ---------

matches.get('/referral-scores', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);

  // Pull this user's referrals + their commission history
  const refs = await sql`
    SELECT r.id, r.status, r.created_at, r.converted_at,
           u.id as referred_user_id, u.name, u.email, u.kyc_status,
           COALESCE((SELECT SUM(amount_cents) FROM commissions WHERE source_id = 'kyc:' || u.id AND user_id = r.referrer_id), 0) as earned_cents
    FROM referrals r
    JOIN users u ON u.id = r.referred_id
    WHERE r.referrer_id = ${user.id}
    ORDER BY r.created_at DESC
  `;
  const cached = await sql`SELECT * FROM match_scores WHERE user_id = ${user.id} AND score_type = 'referral'`;
  const cacheMap: Record<number, any> = {};
  for (const c2 of cached as any[]) { if (c2.target_user_id) cacheMap[c2.target_user_id] = c2; }
  await sql.end();

  const enriched: any[] = [];
  let llmBudget = 5;
  const ok = await checkLlmQuota(c.env, user.id);
  for (const r of refs as any[]) {
    if (cacheMap[r.referred_user_id]) {
      enriched.push({ referral: r, score: cacheMap[r.referred_user_id].score, explanation: cacheMap[r.referred_user_id].explanation, cached: true });
      continue;
    }
    // Rule-based base: 30 pts for KYC approved, +20 for converted, scaled commission
    let base = 20;
    if (r.kyc_status === 'approved') base += 30;
    if (r.status === 'converted') base += 20;
    const earned = parseInt(r.earned_cents) || 0;
    if (earned > 0) base += Math.min(30, Math.floor(earned / 5000));
    const ruleScore = Math.min(100, base);
    const ruleExpl = `KYC=${r.kyc_status}, status=${r.status}, earned=$${(earned / 100).toFixed(2)}`;

    if (llmBudget > 0 && ok) {
      const llm = await llmJson(c.env,
        'Score the QUALITY of a referral on 0-100 based on conversion data. Output JSON {"score":number,"explanation":"1 sentence"}.',
        `Referral: name=${r.name}, days_since_join=${Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)}, kyc_status=${r.kyc_status}, status=${r.status}, commissions_earned_usd=${(earned / 100).toFixed(2)}.\nRule-based starting score: ${ruleScore}.`
      );
      const score = (llm && typeof llm.score === 'number') ? Math.max(0, Math.min(100, llm.score)) : ruleScore;
      const explanation = (llm?.explanation && typeof llm.explanation === 'string') ? llm.explanation.slice(0, 300) : ruleExpl;
      const model = llm ? '@cf/meta/llama-3.1-8b-instruct' : 'rule-based';
      await upsertScore(c.env, { user_id: user.id, score_type: 'referral', deal_id: null, target_user_id: r.referred_user_id, score, explanation, model });
      enriched.push({ referral: r, score, explanation, cached: false });
      llmBudget--;
    } else {
      enriched.push({ referral: r, score: ruleScore, explanation: ruleExpl, cached: false });
    }
  }
  enriched.sort((a, b) => b.score - a.score);
  return c.json({ items: enriched, count: enriched.length });
});

// --------- On-demand single-target scoring ---------

matches.post('/score', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const ok = await checkLlmQuota(c.env, user.id);
  if (!ok) return c.json({ error: 'Rate limit exceeded (60/hour). Please retry later.' }, 429);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  if (!body || typeof body !== 'object') return c.json({ error: 'Body must be an object' }, 400);
  const { score_type, project_id, target_user_id } = body;
  if (!['deal_flow', 'co_invest', 'referral'].includes(score_type)) return c.json({ error: 'Invalid score_type' }, 400);

  const sql = getSQL(c.env);
  try {
    const prefsRow = await sql`SELECT * FROM user_preferences WHERE user_id = ${user.id}`;
    const prefs = prefsRow[0] || null;

    if (score_type === 'deal_flow' || score_type === 'co_invest') {
      if (!project_id) return c.json({ error: 'project_id required' }, 400);
      const projects = await sql`SELECT * FROM projects WHERE id = ${project_id}`;
      if (!projects.length) return c.json({ error: 'Project not found' }, 404);
      const s = await scoreOneDeal(c.env, user, prefs, projects[0]);
      await upsertScore(c.env, { user_id: user.id, score_type, deal_id: project_id, target_user_id: null, ...s });
      return c.json({ score_type, project_id, ...s });
    }
    return c.json({ error: 'For referral scoring, use GET /referral-scores' }, 400);
  } finally { await sql.end(); }
});

// --------- Admin ---------

// --------- Investor matching (Task #16) ---------

function safeJsonArray(s: any): string[] {
  try { const j = JSON.parse(s); return Array.isArray(j) ? j.map((x: any) => String(x)) : []; } catch { return []; }
}

function safeJsonObject(s: any): Record<string, unknown> {
  try { const j = JSON.parse(s); return (j && typeof j === 'object' && !Array.isArray(j)) ? j : {}; } catch { return {}; }
}

function safeJsonNumber(s: any, def: number): number {
  const n = typeof s === 'number' ? s : parseFloat(String(s));
  return Number.isNaN(n) ? def : n;
}

// Cosine similarity of two dimension-score maps.
function cosineSimilarityVectors(a: Record<number, number>, b: Record<number, number>): number {
  let dot = 0, na = 0, nb = 0;
  const ids = new Set<number>([...Object.keys(a).map(Number), ...Object.keys(b).map(Number)]);
  for (const id of ids) {
    const av = a[id] || 0;
    const bv = b[id] || 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

// Normalize a ticket band to a midpoint dollar value.
function ticketMidpoint(band: string | null): number | null {
  const map: Record<string, number> = {
    '<$10k': 5_000,
    '$10k-$50k': 30_000,
    '$50k-$250k': 150_000,
    '$250k-$1M': 625_000,
    '$1M+': 2_500_000,
  };
  return band && map[band] ? map[band] : null;
}

// Check if a company raise size is within the investor's check range.
function checkSizeFits(projectFunding: number | null, investorMin: number | null, investorMax: number | null): { fits: boolean; reason?: string } {
  if (projectFunding == null) return { fits: true };
  if (investorMin != null && projectFunding < investorMin) return { fits: false, reason: 'Below minimum check size' };
  if (investorMax != null && projectFunding > investorMax) return { fits: false, reason: 'Above maximum check size' };
  return { fits: true };
}

matches.post('/investor-match', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  if (!body || typeof body !== 'object') return c.json({ error: 'Body must be an object' }, 400);
  const projectId = body.project_id != null ? Number(body.project_id) : null;
  if (!projectId || !Number.isFinite(projectId)) return c.json({ error: 'project_id required' }, 400);
  const userRole = (user.role || '').toLowerCase();
  if (!['founder', 'admin'].includes(userRole)) return c.json({ error: 'founder_required' }, 403);

  // Fetch project details with ownership check
  const projects = await sql`
    SELECT * FROM projects
    WHERE id = ${projectId}
      AND (user_id = ${user.id} OR founder_id = ${user.founder_id || 0} OR ${user.role === 'admin' ? 1 : 0} = 1)
  `;
  if (!projects.length) return c.json({ error: 'Project not found' }, 404);
  const project: any = projects[0];

  // Fetch all investor profiles with linked users
  const investorRows = await sql`
    SELECT
      ip.user_id,
      ip.investor_type,
      ip.sectors_json,
      ip.stages_json,
      ip.geos_json,
      ip.ticket_band,
      ip.ticket_min_usd,
      ip.ticket_max_usd,
      ip.thesis_text,
      ip.thesis_keywords_json,
      ip.anti_thesis_sectors_json,
      ip.anti_thesis_stages_json,
      ip.value_weights_json,
      u.id as user_id,
      u.name as user_name,
      u.email as user_email,
      i.id as investor_table_id,
      i.investor_type as legacy_investor_type,
      i.check_size_min,
      i.check_size_max,
      i.sector_focus,
      i.stage_focus
    FROM investor_profiles ip
    JOIN users u ON u.id = ip.user_id
    LEFT JOIN investors i ON i.user_id = u.id
    WHERE u.role = 'investor'
    ORDER BY ip.user_id
  `;

  // Task #19 — hard consent filter: only investors who explicitly opted into
  // matching may appear as candidates. Opted-out (the default) are dropped
  // before any scoring so they never surface in the ranked OR excluded lists.
  const optedInInvestors = await filterOptedInUserIds(c.env, (investorRows as any[]).map((r) => Number(r.user_id)));
  const visibleInvestorRows = (investorRows as any[]).filter((r) => optedInInvestors.has(Number(r.user_id)));

  // Fetch founder's values vector (slug-keyed so watch-outs + alignment work)
  const founderValuesRows = await sql`
    SELECT vd.slug, v.score, v.confidence
    FROM user_values v
    JOIN value_dimensions vd ON vd.id = v.dimension_id
    WHERE v.user_id = ${user.id}
  `;
  const founderValues: Record<string, ValueEntry> = {};
  for (const r of founderValuesRows as any[]) {
    founderValues[String(r.slug)] = {
      score: Number(r.score),
      confidence: Number(r.confidence),
    };
  }

  // Fetch investor values vectors (slug-keyed, all investors in one query)
  const investorUserIds = visibleInvestorRows.map((r) => Number(r.user_id)).filter(Boolean);
  const investorValuesMap = new Map<number, Record<string, ValueEntry>>();
  if (investorUserIds.length > 0) {
    const ph = investorUserIds.map(() => '?').join(',');
    const valuesRows = await sql.unsafe(
      `SELECT uv.user_id, vd.slug, uv.score, uv.confidence
         FROM user_values uv
         JOIN value_dimensions vd ON vd.id = uv.dimension_id
        WHERE uv.user_id IN (${ph})`,
      investorUserIds,
    );
    for (const r of valuesRows as any[]) {
      const uid = Number(r.user_id);
      if (!investorValuesMap.has(uid)) investorValuesMap.set(uid, {});
      investorValuesMap.get(uid)![String(r.slug)] = {
        score: Number(r.score),
        confidence: Number(r.confidence),
      };
    }
  }

  // Fetch founder skills for watch-out detection
  const founderSkillsRows = await sql`
    SELECT sc.slug, MAX(us.self_level) AS level
    FROM user_skills us
    JOIN skills s ON s.id = us.skill_id
    JOIN skill_categories sc ON sc.slug = s.category_slug
    WHERE us.user_id = ${user.id}
    GROUP BY sc.slug
  `;
  const founderSkills: Record<string, number> = {};
  for (const r of founderSkillsRows as any[]) founderSkills[String(r.slug)] = Number(r.level) || 0;

  // Fetch investor skills for watch-outs
  const investorSkillsMap = new Map<number, Record<string, number>>();
  if (investorUserIds.length > 0) {
    const ph = investorUserIds.map(() => '?').join(',');
    const skillRows = await sql.unsafe(
      `SELECT us.user_id, sc.slug, MAX(us.self_level) AS level
         FROM user_skills us
         JOIN skills s ON s.id = us.skill_id
         JOIN skill_categories sc ON sc.slug = s.category_slug
        WHERE us.user_id IN (${ph})
        GROUP BY us.user_id, sc.slug`,
      investorUserIds,
    );
    for (const r of skillRows as any[]) {
      const uid = Number(r.user_id);
      if (!investorSkillsMap.has(uid)) investorSkillsMap.set(uid, {});
      investorSkillsMap.get(uid)![String(r.slug)] = Number(r.level) || 0;
    }
  }

  // Fetch introduction history for network warmth (warmth = any past interaction)
  const introRows = await sql`
    SELECT investor_user_id, COUNT(*) as n
    FROM investor_introductions
    WHERE (founder_user_id = ${user.id} OR founder_id = ${user.founder_id || 0})
      AND status IN ('pending', 'accepted', 'completed')
    GROUP BY investor_user_id
  `;
  const introMap = new Map<number, number>();
  for (const r of introRows as any[]) introMap.set(Number(r.investor_user_id), Number(r.n));

  await sql.end();

  // Scoring weights
  const W = {
    thesis_fit: 0.45,
    traction_fit: 0.20,
    values_alignment: 0.20,
    network_warmth: 0.15,
  };

  const projectSector = String(project.sector || '').trim().toLowerCase();
  const projectStage = String(project.stage || '').trim().toLowerCase();
  const projectFunding = project.funding_needed != null ? Number(project.funding_needed) : null;

  const scored = visibleInvestorRows.map((inv) => {
    const invUid = Number(inv.user_id);
    const invName = inv.user_name || inv.email || 'Investor';
    const sectors = safeJsonArray(inv.sectors_json);
    const stages = safeJsonArray(inv.stages_json);
    const antiSectors = safeJsonArray(inv.anti_thesis_sectors_json);
    const antiStages = safeJsonArray(inv.anti_thesis_stages_json);
    const valueWeights = safeJsonObject(inv.value_weights_json);
    const thesisKeywords = safeJsonArray(inv.thesis_keywords_json);
    const invMin = safeJsonNumber(inv.ticket_min_usd, safeJsonNumber(inv.check_size_min, 0));
    const invMax = safeJsonNumber(inv.ticket_max_usd, safeJsonNumber(inv.check_size_max, 5_000_000));
    const invMid = ticketMidpoint(inv.ticket_band);
    const effectiveMin = invMin || invMid || 0;
    const effectiveMax = invMax || invMid || 5_000_000;

    // ---- 1. Anti-thesis hard exclusion ----
    let antiHit = false;
    let antiReason = '';
    if (antiSectors.length && projectSector) {
      const hit = antiSectors.some((s) => projectSector.includes(s.toLowerCase()) || s.toLowerCase().includes(projectSector));
      if (hit) { antiHit = true; antiReason = `Anti-thesis sector: ${project.sector}`; }
    }
    if (antiStages.length && projectStage) {
      const hit = antiStages.some((s) => projectStage.includes(s.toLowerCase()) || s.toLowerCase().includes(projectStage));
      if (hit) { antiHit = true; antiReason = antiReason || `Anti-thesis stage: ${project.stage}`; }
    }
    if (antiHit) {
      return {
        investor_id: inv.investor_table_id,
        user_id: invUid,
        name: invName,
        excluded: true,
        reason: antiReason,
        match_score: 0,
        breakdown: { thesis_fit: 0, traction_fit: 0, values_alignment: 0, network_warmth: 0 },
      };
    }

    // ---- 2. Check-size band gate (hard exclude) ----
    const cs = checkSizeFits(projectFunding, effectiveMin, effectiveMax);
    if (!cs.fits) {
      return {
        investor_id: inv.investor_table_id,
        user_id: invUid,
        name: invName,
        excluded: true,
        reason: cs.reason,
        match_score: 0,
        breakdown: { thesis_fit: 0, traction_fit: 0, values_alignment: 0, network_warmth: 0 },
      };
    }

    // ---- 3. Thesis fit (0-100) ----
    let thesisScore = 0;
    const reasons: string[] = [];
    if (sectors.length && projectSector) {
      const sectorHit = sectors.some((s) => projectSector.includes(s.toLowerCase()) || s.toLowerCase().includes(projectSector));
      if (sectorHit) { thesisScore += 40; reasons.push(`Sector match: ${project.sector}`); }
      else { thesisScore -= 10; reasons.push(`Sector mismatch: ${project.sector}`); }
    }
    if (stages.length && projectStage) {
      const stageHit = stages.some((s) => projectStage.includes(s.toLowerCase()) || s.toLowerCase().includes(projectStage));
      if (stageHit) { thesisScore += 30; reasons.push(`Stage match: ${project.stage}`); }
      else { thesisScore -= 5; reasons.push(`Stage mismatch: ${project.stage}`); }
    }
    if (thesisKeywords.length && (project.problem_statement || project.solution)) {
      const text = `${project.problem_statement || ''} ${project.solution || ''}`.toLowerCase();
      const kwHits = thesisKeywords.filter((k) => text.includes(k.toLowerCase()));
      if (kwHits.length) { thesisScore += 20; reasons.push(`Thesis keyword hits: ${kwHits.length}`); }
      else { thesisScore -= 5; }
    }
    // Bonus for investor explicitly caring about mission-driven founders
    const missionWeight = safeJsonNumber(valueWeights['mission_driven'], 0);
    if (missionWeight > 0.5 && project.why_now) {
      const missionText = String(project.why_now).toLowerCase();
      const missionWords = ['mission', 'impact', 'sustainable', 'climate', 'health', 'education', 'social'];
      if (missionWords.some((w) => missionText.includes(w))) {
        thesisScore += 15;
        reasons.push('Mission-driven founder bonus');
      }
    }
    thesisScore = Math.max(0, Math.min(100, thesisScore));

    // ---- 4. Traction fit (0-100) ----
    let tractionScore = 0;
    const rev = safeJsonNumber(project.revenue, 0);
    const users = safeJsonNumber(project.users_count, 0);
    const totalFunding = safeJsonNumber(project.total_funding, 0);
    if (project.status === 'tier_1') { tractionScore += 40; reasons.push('Tier-1 vetted'); }
    else if (project.status === 'tier_2') { tractionScore += 25; reasons.push('Tier-2 vetted'); }
    else if (project.status === 'active') { tractionScore += 15; }
    if (rev > 0) { tractionScore += 20; reasons.push('Revenue traction'); }
    if (users > 0) { tractionScore += 10; reasons.push('User traction'); }
    if (totalFunding > 0) { tractionScore += 10; reasons.push('Prior funding'); }
    tractionScore = Math.max(0, Math.min(100, tractionScore));

    // ---- 5. Values alignment (0-100) with confidence down-weighting ----
    let valuesScore = 0;
    let watchOuts: string[] = [];
    if (investorValuesMap.has(invUid) && Object.keys(founderValues).length > 0) {
      const invVec = investorValuesMap.get(invUid)!;
      const aligned = confidenceAdjustedAlignment(founderValues, invVec);
      // Scale −1..1 adjusted cosine to 0..100
      valuesScore = Math.round(((aligned.score + 1) / 2) * 100);
      if (valuesScore > 0) {
        reasons.push(`Values alignment: ${valuesScore} (confidence ${(aligned.meanConfidence * 100).toFixed(0)}%)`);
      }
      // Watch-outs: low-confidence founder signals, strong value opposition
      const invSkills = investorSkillsMap.get(invUid) || {};
      watchOuts = computeWatchOuts(founderValues, invVec, founderSkills, invSkills);
    }

    // ---- 6. Network warmth (0-100) ----
    let networkScore = 0;
    const introCount = introMap.get(invUid) || 0;
    if (introCount > 0) {
      networkScore = Math.min(100, introCount * 20 + 20);
      reasons.push(`Network warmth: ${introCount} past intro(s)`);
    }

    // ---- Overall ----
    const overall = Math.round(
      thesisScore * W.thesis_fit +
      tractionScore * W.traction_fit +
      valuesScore * W.values_alignment +
      networkScore * W.network_warmth,
    );

    return {
      investor_id: inv.investor_table_id,
      user_id: invUid,
      name: invName,
      excluded: false,
      match_score: overall,
      breakdown: {
        thesis_fit: thesisScore,
        traction_fit: tractionScore,
        values_alignment: valuesScore,
        network_warmth: networkScore,
      },
      reasons: reasons.slice(0, 6),
      watch_outs: watchOuts.slice(0, 4),
      thesis: {
        sectors,
        stages,
        ticket_band: inv.ticket_band,
        check_size_min: effectiveMin,
        check_size_max: effectiveMax,
      },
    };
  });

  // Separate ranked and excluded
  const ranked = scored.filter((s) => !s.excluded).sort((a, b) => b.match_score - a.match_score);
  const excluded = scored.filter((s) => s.excluded);

  // Task #19 — audit when an admin generates an investor match list (no-op otherwise).
  await logMatchListGeneration(c.env, user as any, 'investor_match', {
    project_id: projectId,
    result_count: ranked.length,
  });

  return c.json({
    project_id: projectId,
    project_name: project.name,
    ranked,
    excluded: excluded.slice(0, 10),
    total_investors: scored.length,
  });
});

// --------- Admin ---------

matches.get('/admin/all', async (c) => {
  const admin = await requireAdmin(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT m.*, u.name as user_name, u.email as user_email, p.name as project_name
    FROM match_scores m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN projects p ON p.id = m.deal_id
    ORDER BY m.created_at DESC LIMIT 500
  `;
  await sql.end();
  // Task #19 — audit that an admin pulled the full cross-user match list.
  await logMatchListGeneration(c.env, admin as any, 'admin_all_matches', {
    result_count: (rows as any[]).length,
  });
  return c.json(rows);
});

function safeJson(s: any, def: any) { try { return s ? JSON.parse(s) : def; } catch { return def; } }

export default matches;
