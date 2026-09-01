import { Hono } from 'hono';
import type { Env, User } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireRole } from '../auth';
import { activeCompanyFor } from '../middleware/activeCompany';
import { isAdmin, mapError, nowIso } from './_t13t14t15_helpers';
import {
  ensureAdvisorProfilesSchema,
  shapeAdvisorProfile,
  type AdvisorProfileRow,
  type AdvisorAssignment,
} from '../services/advisorProfilesSchema';

const advisory = new Hono<{ Bindings: Env }>();

// --- Advisor directory (Task #75) helpers ------------------------------------

/**
 * Project ids owned by the founder (or 'all' for admin). Mirrors contacts.ts —
 * including, as of stage 9, its company narrowing. The two copies drifted:
 * contacts.ts was narrowed and this one was not, so a founder could assign an
 * advisor to a project the picker had already stopped showing them.
 *
 * `'all'` is the admin answer and is deliberately never narrowed.
 */
async function ownedProjectScope(
  env: Env, user: User, companyId: number | null = null,
): Promise<'all' | number[]> {
  if (isAdmin(user)) return 'all';
  if (!user.founder_id) return [];
  // Two full literals, never a clause dropped into the query text.
  const rows = await (companyId === null
    ? env.DB.prepare('SELECT id FROM projects WHERE founder_id = ? AND deleted_at IS NULL')
        .bind(user.founder_id)
    : env.DB.prepare(
        `SELECT id FROM projects
          WHERE founder_id = ? AND deleted_at IS NULL
            AND (company_id = ? OR company_id IS NULL)`,
      ).bind(user.founder_id, companyId)
  ).all<{ id: number }>();
  return (rows.results || []).map((x) => Number(x.id));
}

/** Load an advisor profile the caller owns; null → 404 (never 403, per IDOR rule). */
async function loadOwnedAdvisor(
  env: Env, id: number, user: User, companyId: number | null = null,
): Promise<AdvisorProfileRow | null> {
  const row = await env.DB.prepare('SELECT * FROM advisor_profiles WHERE id = ?').bind(id).first<AdvisorProfileRow>();
  if (!row) return null;
  if (isAdmin(user)) return row;
  if (!user.founder_id || Number(row.founder_id) !== Number(user.founder_id)) return null;
  // Ownership is settled above; the company only narrows what is already the
  // caller's. This decides a 404, so a company that could GRANT rather than
  // narrow would be a hole. A profile with no company stays reachable under
  // every one of the founder's.
  const owning = (row as AdvisorProfileRow & { company_id?: number | null }).company_id ?? null;
  if (companyId !== null && owning !== null && owning !== companyId) return null;
  return row;
}

async function loadAssignments(env: Env, profileId: number): Promise<AdvisorAssignment[]> {
  const ars = await env.DB.prepare(
    `SELECT a.project_id, p.name FROM advisor_startups a
       LEFT JOIN projects p ON p.id = a.project_id
      WHERE a.advisor_profile_id = ?`,
  ).bind(profileId).all<{ project_id: number; name: string | null }>();
  return (ars.results || []).map((a) => ({ project_id: Number(a.project_id), name: a.name }));
}

function normalizeStringList(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 40);
}

const TEMPLATES: Record<string, string> = {
  gtm: 'Based on the {sector} sector, consider: 1) Product-led growth targeting early adopters, 2) Partnership-driven distribution through complementary APIs, 3) Content marketing establishing thought leadership in {sector}.',
  fundraising: 'For a {stage} startup in {sector}: Target $500K-$2M at $5M-$15M pre-money. Lead with traction metrics. Use SAFE notes for speed.',
  product: 'Focus on: 1) Core value proposition validation (30 days), 2) Usage analytics implementation, 3) Feature prioritization via customer feedback loops.',
  team: 'Hiring priorities for {stage}: 1) Technical co-founder if missing, 2) First sales hire for B2B, 3) Product designer for B2C.',
  general: 'Key strategic considerations: 1) Validate product-market fit before scaling, 2) Build measurable growth loops, 3) Maintain 18-month runway minimum.',
};

advisory.post('/ask', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);

  let project: any = null;
  if (data.project_id) {
    const rows = await sql`SELECT * FROM projects WHERE id = ${data.project_id}`;
    if (rows.length > 0) project = rows[0];
  }

  const sector = project?.sector || 'technology';
  const stage = project?.stage || 'early-stage';
  const template = TEMPLATES[data.category] || TEMPLATES.general;
  const advice = template.replace(/\{sector\}/g, sector).replace(/\{stage\}/g, stage);

  await sql`INSERT INTO activity_logs (project_id, action, details, actor) VALUES (${data.project_id || null}, 'ai_advisory_query', ${`Category: ${data.category} | Q: ${(data.question || '').slice(0, 100)}`}, 'ai_advisor')`;
  await sql.end();

  return c.json({ ai_generated: false, fallback_reason: 'Template-based advisory', category: data.category, advice, project_name: project?.name || null });
});

advisory.post('/financial-plan', async (c) => {
  await requireAuth(c);
  const req = await c.req.json();
  const sql = getSQL(c.env);

  let project: any = null;
  if (req.project_id) {
    const rows = await sql`SELECT * FROM projects WHERE id = ${req.project_id}`;
    if (rows.length > 0) project = rows[0];
  }

  const monthlyBurn = req.monthly_burn || ((req.team_size || 1) * (req.avg_salary || 80000) / 12) + 5000;
  const totalMonthlyCost = monthlyBurn + ((req.planned_hires || 0) * (req.avg_salary || 80000) / 12);
  const netBurn = totalMonthlyCost - (req.revenue_monthly || 0);
  const runway = netBurn > 0 ? (req.current_cash || 0) / netBurn : 999;

  const projections = [];
  let cash = req.current_cash || 0;
  let rev = req.revenue_monthly || 0;
  for (let m = 1; m <= 18; m++) {
    rev = rev > 0 ? rev * (1 + (req.revenue_growth_pct || 0) / 100) : 0;
    const hireCost = m > 3 && (req.planned_hires || 0) > 0 ? ((req.planned_hires || 0) * (req.avg_salary || 80000) / 12) * Math.min(m / 6, 1) : 0;
    const expenses = monthlyBurn + hireCost;
    cash = cash + rev - expenses;
    projections.push({ month: m, revenue: Math.round(rev * 100) / 100, expenses: Math.round(expenses * 100) / 100, net: Math.round((rev - expenses) * 100) / 100, cash_balance: Math.round(cash * 100) / 100 });
  }

  const breakeven = projections.find(p => p.net >= 0)?.month || null;
  const recommendations = [];
  if (runway < 6) recommendations.push('URGENT: Runway under 6 months. Begin fundraising immediately.');
  else if (runway < 12) recommendations.push('Start fundraising within 2-3 months.');
  if ((req.revenue_monthly || 0) === 0) recommendations.push('Prioritize first revenue within 90 days.');
  if ((req.team_size || 1) > 3 && (req.revenue_monthly || 0) < monthlyBurn * 0.2) recommendations.push('Team size may be ahead of revenue.');

  if (req.project_id) {
    await sql`INSERT INTO activity_logs (project_id, action, details, actor) VALUES (${req.project_id}, 'financial_plan_generated', ${`Runway: ${runway.toFixed(1)}mo, Burn: $${Math.round(netBurn)}/mo`}, 'financial_planner')`;
  }
  await sql.end();

  return c.json({
    summary: { monthly_burn: Math.round(monthlyBurn * 100) / 100, total_monthly_cost: Math.round(totalMonthlyCost * 100) / 100, net_monthly_burn: Math.round(netBurn * 100) / 100, runway_months: Math.round(runway * 10) / 10, runway_status: runway > 12 ? 'Healthy' : runway > 6 ? 'Warning' : 'Critical', breakeven_month: breakeven },
    projections, recommendations, project_name: project?.name || null,
  });
});

advisory.post('/diligence', async (c) => {
  const user = await requireAuth(c);
  const { project_id } = await c.req.json();
  const sql = getSQL(c.env);

  const projects = await sql`SELECT * FROM projects WHERE id = ${project_id}`;
  if (projects.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const project = projects[0];

  // Epic 5: route every score read through the verified-snapshot helper.
  // Sandbox/flagged/tampered rows must never feed a partner-facing diligence
  // verdict; the helper also writes the score_read audit entry.
  const { getVerifiedLatestSnapshot } = await import('../services/scoreIntegrity');
  const verified = await getVerifiedLatestSnapshot(c.env, project_id, {
    role: user.role || 'partner',
    founderId: user.id,
    ownerFounderId: project.founder_id,
    userId: user.id,
  });

  const docs = await sql`SELECT * FROM documents WHERE project_id = ${project_id}`;
  let founder: any = null;
  if (project.founder_id) {
    const f = await sql`SELECT * FROM founders WHERE id = ${project.founder_id}`;
    if (f.length > 0) founder = f[0];
  }

  const checks: any[] = [];
  let overallStatus = 'pass';

  if (verified) {
    const row = verified.row;
    checks.push({
      category: 'Scoring',
      item: 'Startup Score',
      status: Number(row.total_score) >= 70 ? 'pass' : 'fail',
      detail: `Score: ${row.total_score}/100 (${row.tier || 'untiered'})`,
    });
  } else {
    checks.push({
      category: 'Scoring',
      item: 'Startup Score',
      status: 'missing',
      detail: 'No verified, approved official score on file.',
    });
    overallStatus = 'incomplete';
  }

  const docTypes = docs.map((d: any) => d.doc_type);
  checks.push({ category: 'Legal', item: 'Corporate Bylaws', status: docTypes.includes('bylaws') ? 'pass' : 'missing', detail: docTypes.includes('bylaws') ? 'On file' : 'Missing' });
  checks.push({ category: 'Legal', item: 'Equity Split', status: docTypes.includes('equity_split') ? 'pass' : 'missing', detail: docTypes.includes('equity_split') ? 'On file' : 'Missing' });
  checks.push({ category: 'Legal', item: 'Incorporation', status: project.entity_id ? 'pass' : 'missing', detail: project.entity_id ? 'Incorporated' : 'Not yet incorporated' });
  if (!project.entity_id) overallStatus = 'incomplete';

  if (founder) {
    checks.push({ category: 'Team', item: 'Founder Profile', status: 'pass', detail: `${founder.name} — ${founder.domain_expertise || 'N/A'}, ${founder.experience_years}yr exp.` });
    if (founder.experience_years < 2) checks.push({ category: 'Team', item: 'Founder Experience', status: 'warning', detail: 'Low experience.' });
  } else {
    checks.push({ category: 'Team', item: 'Founder Profile', status: 'missing', detail: 'No founder on record.' });
    overallStatus = 'incomplete';
  }

  if (project.tam && project.tam > 100_000_000) checks.push({ category: 'Financial', item: 'Market Size', status: 'pass', detail: `TAM: $${project.tam.toLocaleString()}` });
  else checks.push({ category: 'Financial', item: 'Market Size', status: project.tam ? 'warning' : 'missing', detail: project.tam ? `TAM: $${project.tam.toLocaleString()} — may be small` : 'TAM not specified' });

  const missing = checks.filter((c: any) => c.status === 'missing').length;
  const warnings = checks.filter((c: any) => c.status === 'warning').length;
  const pass = checks.filter((c: any) => c.status === 'pass').length;
  if (missing > 2) overallStatus = 'incomplete';
  else if (warnings > 2) overallStatus = 'conditional';

  await sql`INSERT INTO activity_logs (project_id, action, details, actor) VALUES (${project_id}, 'diligence_check', ${`Result: ${overallStatus} | Pass: ${pass}, Warning: ${warnings}, Missing: ${missing}`}, 'diligence_engine')`;
  await sql.end();

  return c.json({
    project_id, project_name: project.name, overall_status: overallStatus,
    summary: { pass, warning: warnings, missing, total: checks.length }, checks,
    recommendation: overallStatus === 'pass' ? 'Ready for spinout' : overallStatus === 'incomplete' ? 'Address missing items' : 'Conditional — review warnings',
    generated_at: new Date().toISOString(),
  });
});

// --- Advisor directory (Task #75) endpoints ----------------------------------
// Founder-scoped advisor CRUD under the existing /api/advisory prefix. Admins see
// every profile; founders see only their own. Non-owned ids return 404.

// GET /api/advisory/advisors — the founder's advisor directory.
advisory.get('/advisors', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureAdvisorProfilesSchema(c.env);
    let where = '1=1';
    const params: any[] = [];
    if (!isAdmin(user)) {
      if (!user.founder_id) return c.json({ items: [] });
      where += ' AND founder_id = ?';
      params.push(user.founder_id);
      // Company scoping, stage 9. Without this the roster disagrees with the
      // project picker: a founder switches company and still sees advisors
      // they added under the other one.
      const companyId = await activeCompanyFor(c, user);
      if (companyId !== null) {
        where += ' AND (company_id = ? OR company_id IS NULL)';
        params.push(companyId);
      }
    }
    const rows = await c.env.DB.prepare(
      `SELECT * FROM advisor_profiles WHERE ${where} ORDER BY status ASC, updated_at DESC LIMIT 500`,
    ).bind(...params).all<AdvisorProfileRow>();
    const profiles = (rows.results || []) as AdvisorProfileRow[];

    const byProfile = new Map<number, AdvisorAssignment[]>();
    if (profiles.length) {
      const ids = profiles.map((p) => p.id);
      const ph = ids.map(() => '?').join(',');
      const ars = await c.env.DB.prepare(
        `SELECT a.advisor_profile_id AS pid, a.project_id, p.name
           FROM advisor_startups a LEFT JOIN projects p ON p.id = a.project_id
          WHERE a.advisor_profile_id IN (${ph})`,
      ).bind(...ids).all<{ pid: number; project_id: number; name: string | null }>();
      for (const a of (ars.results || [])) {
        const list = byProfile.get(Number(a.pid)) || [];
        list.push({ project_id: Number(a.project_id), name: a.name });
        byProfile.set(Number(a.pid), list);
      }
    }
    const items = profiles.map((p) => shapeAdvisorProfile(p, byProfile.get(p.id) || []));
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

// PUT /api/advisory/advisors/:id — edit profile details.
advisory.put('/advisors/:id', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureAdvisorProfilesSchema(c.env);
    const id = Number(c.req.param('id'));
    const row = await loadOwnedAdvisor(c.env, id, user, await activeCompanyFor(c, user));
    if (!row) return c.json({ detail: 'Not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));

    const name = body.name !== undefined ? String(body.name || '').slice(0, 200) : row.name;
    if (!name.trim()) return c.json({ detail: 'name is required' }, 400);
    const bio = body.bio !== undefined ? (body.bio ? String(body.bio).slice(0, 4000) : null) : row.bio;
    const linkedin = body.linkedin_url !== undefined ? (body.linkedin_url ? String(body.linkedin_url).slice(0, 500) : null) : row.linkedin_url;
    const sectors = body.sectors !== undefined ? JSON.stringify(normalizeStringList(body.sectors)) : row.sectors_json;
    const expertise = body.expertise !== undefined ? JSON.stringify(normalizeStringList(body.expertise)) : row.expertise_json;
    let hourly = row.hourly_rate;
    if (body.hourly_rate !== undefined) {
      if (body.hourly_rate === null || body.hourly_rate === '') hourly = null;
      else { const n = Number(body.hourly_rate); hourly = Number.isFinite(n) && n >= 0 ? n : row.hourly_rate; }
    }

    // Relationship fields (migration 143). Dates must be ISO-8601 parseable;
    // reject bad input loudly rather than silently storing garbage.
    const parseDateField = (key: 'last_session_at' | 'follow_up_at'): string | null | undefined => {
      if (body[key] === undefined) return undefined; // not in payload → keep current
      if (body[key] === null || body[key] === '') return null;
      const raw = String(body[key]).slice(0, 40);
      if (Number.isNaN(Date.parse(raw))) {
        const e: any = new Error(`${key} must be an ISO-8601 date`);
        e.status = 400;
        throw e;
      }
      return raw;
    };
    const lastSession = parseDateField('last_session_at');
    const followUpAt = parseDateField('follow_up_at');
    const notes = body.notes !== undefined ? (body.notes ? String(body.notes).slice(0, 4000) : null) : row.notes;
    const followUpNote = body.follow_up_note !== undefined
      ? (body.follow_up_note ? String(body.follow_up_note).slice(0, 500) : null)
      : row.follow_up_note;

    await c.env.DB.prepare(
      `UPDATE advisor_profiles SET name=?, bio=?, linkedin_url=?, sectors_json=?, expertise_json=?, hourly_rate=?,
        last_session_at=?, notes=?, follow_up_at=?, follow_up_note=?, updated_at=? WHERE id=?`,
    ).bind(
      name.trim(), bio, linkedin, sectors, expertise, hourly,
      lastSession === undefined ? row.last_session_at : lastSession,
      notes,
      followUpAt === undefined ? row.follow_up_at : followUpAt,
      followUpNote,
      nowIso(), id,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_profiles WHERE id = ?').bind(id).first<AdvisorProfileRow>();
    return c.json(shapeAdvisorProfile(fresh as AdvisorProfileRow, await loadAssignments(c.env, id)));
  } catch (e) { return mapError(c, e); }
});

// PUT /api/advisory/advisors/:id/assignments — replace the advisor↔startup set.
advisory.put('/advisors/:id/assignments', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureAdvisorProfilesSchema(c.env);
    const id = Number(c.req.param('id'));
    const row = await loadOwnedAdvisor(c.env, id, user, await activeCompanyFor(c, user));
    if (!row) return c.json({ detail: 'Not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const requested = Array.isArray(body.project_ids)
      ? body.project_ids.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n))
      : [];

    // Every target startup must be owned by the caller.
    const scope = await ownedProjectScope(c.env, user, await activeCompanyFor(c, user));
    if (scope !== 'all') {
      const owned = new Set(scope);
      for (const pid of requested) {
        if (!owned.has(pid)) return c.json({ detail: 'One or more startups are not yours to assign.' }, 403);
      }
    }

    const want = Array.from(new Set<number>(requested));
    const existing = await c.env.DB.prepare('SELECT project_id FROM advisor_startups WHERE advisor_profile_id = ?')
      .bind(id).all<{ project_id: number }>();
    const have = new Set((existing.results || []).map((x) => Number(x.project_id)));
    const toAdd = want.filter((p) => !have.has(p));
    const toRemove = [...have].filter((p) => !want.includes(p));

    for (const pid of toAdd) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO advisor_startups (advisor_profile_id, project_id, created_at) VALUES (?, ?, ?)')
        .bind(id, pid, nowIso()).run();
    }
    if (toRemove.length) {
      const ph = toRemove.map(() => '?').join(',');
      await c.env.DB.prepare(`DELETE FROM advisor_startups WHERE advisor_profile_id = ? AND project_id IN (${ph})`)
        .bind(id, ...toRemove).run();
    }
    await c.env.DB.prepare('UPDATE advisor_profiles SET updated_at=? WHERE id=?').bind(nowIso(), id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_profiles WHERE id = ?').bind(id).first<AdvisorProfileRow>();
    return c.json(shapeAdvisorProfile(fresh as AdvisorProfileRow, await loadAssignments(c.env, id)));
  } catch (e) { return mapError(c, e); }
});

// POST /api/advisory/advisors/:id/archive — soft-remove from the active directory.
advisory.post('/advisors/:id/archive', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureAdvisorProfilesSchema(c.env);
    const id = Number(c.req.param('id'));
    const row = await loadOwnedAdvisor(c.env, id, user, await activeCompanyFor(c, user));
    if (!row) return c.json({ detail: 'Not found' }, 404);
    await c.env.DB.prepare('UPDATE advisor_profiles SET status=?, updated_at=? WHERE id=?')
      .bind('archived', nowIso(), id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_profiles WHERE id = ?').bind(id).first<AdvisorProfileRow>();
    return c.json(shapeAdvisorProfile(fresh as AdvisorProfileRow, await loadAssignments(c.env, id)));
  } catch (e) { return mapError(c, e); }
});

// POST /api/advisory/advisors/:id/restore — return an archived advisor to active.
advisory.post('/advisors/:id/restore', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureAdvisorProfilesSchema(c.env);
    const id = Number(c.req.param('id'));
    const row = await loadOwnedAdvisor(c.env, id, user, await activeCompanyFor(c, user));
    if (!row) return c.json({ detail: 'Not found' }, 404);
    await c.env.DB.prepare('UPDATE advisor_profiles SET status=?, updated_at=? WHERE id=?')
      .bind('active', nowIso(), id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_profiles WHERE id = ?').bind(id).first<AdvisorProfileRow>();
    return c.json(shapeAdvisorProfile(fresh as AdvisorProfileRow, await loadAssignments(c.env, id)));
  } catch (e) { return mapError(c, e); }
});

export default advisory;
