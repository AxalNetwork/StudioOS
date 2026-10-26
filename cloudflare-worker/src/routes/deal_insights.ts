/** D1151: deal-scoped, NDA-gated published team and shared venture records. */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { getCurrentUser } from '../auth';
import { userMayReadDeal } from './deals';
import { effectiveFlags } from './public';
import { effectiveVisibility } from '../services/userSettings';
import { ARCHETYPES } from '../services/archetypeScoring';
import { RADAR_AXES } from '../services/skillsTaxonomySchema';
import { updateFigures } from './portfolio_updates';

const r = new Hono<{ Bindings: Env }>();
const notRecorded = (reason: string) => ({ state: 'not_recorded', reason });
// Section failures never turn into empty data or include a database error.
async function block(read: () => Promise<unknown>) {
  try { return { state: 'recorded', data: await read() }; }
  catch { return { state: 'unreadable', reason: 'Unreadable. Try again.' }; }
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function priorRoles(raw: string | null) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.slice(0, 30).filter(x => x && typeof x === 'object').map(x => ({
      title: text(x.title), company: text(x.company ?? x.org), start: text(x.start), end: text(x.end),
    }));
  } catch { return null; }
}

async function team(env: Env, project: any) {
  let unreadableProfiles = false;
  const people = await block(async () => {
    const { results } = await env.DB.prepare(`SELECT u.id, u.uid, u.name, u.role, u.privacy_prefs,
      s.visibility, s.visibility_chosen_at, e.experience,
      CASE WHEN u.founder_id = ? THEN 'founder' ELSE m.role END AS team_role,
      CASE WHEN pub.published = 1 THEN snap.displayed_slug END AS archetype_slug
      FROM users u
      LEFT JOIN project_members m ON m.user_id = u.id AND m.project_id = ? AND m.status = 'accepted' AND m.removed_at IS NULL
      LEFT JOIN user_settings s ON s.user_id = u.id
      LEFT JOIN user_profile_ext e ON e.user_id = u.id
      LEFT JOIN profile_archetype_publish pub ON pub.user_id = u.id
      LEFT JOIN profile_snapshots snap ON snap.id = (SELECT MAX(ps.id) FROM profile_snapshots ps WHERE ps.user_id = u.id AND ps.persona = u.role)
      WHERE COALESCE(u.is_active, 1) = 1 AND (u.founder_id = ? OR m.id IS NOT NULL)
      ORDER BY u.id LIMIT 201`).bind(project.founder_id, project.id, project.founder_id).all<any>();
    if (results.length > 200) throw new Error('Team limit');
    return results.flatMap(p => {
      if (effectiveVisibility(p.visibility, p.visibility_chosen_at) === 'private') return [];
      // Corrupt preferences withhold only this person, never default them public.
      try { if (p.privacy_prefs) JSON.parse(p.privacy_prefs); }
      catch { unreadableProfiles = true; return []; }
      const flags = effectiveFlags(p.privacy_prefs, p.role);
      if (!flags.name) return [];
      const archetype = Object.values(ARCHETYPES).flat().find(a => a.slug === p.archetype_slug);
      const roles = flags.background ? priorRoles(p.experience) : [];
      return [{ user_id: p.id, coverage_shared: !!flags.background, uid: p.uid, name: p.name, role: p.team_role,
        prior_roles: roles, ...(roles == null ? { prior_roles_state: 'unreadable', prior_roles_reason: 'Unreadable. Try again.' } : {}),
        archetype: archetype ? { slug: archetype.slug, label: archetype.label } : null,
        full_time_since: null, full_time_reason: 'Not recorded',
        founder_market_fit: null, founder_market_fit_reason: 'No published evidence recorded' }];
    });
  });
  const rows = people.state === 'recorded' ? people.data as any[] : null;
  const coverage = rows == null ? { state: 'unreadable', reason: 'Team publication is unreadable. Try again.' } : await block(async () => {
    // Blend as the radar does, but disclose only coarse bands of the TEAM MEAN.
    // An exact maximum is an individual's score even with multiple contributors.
    // A public name alone is insufficient: honor background publication as well.
    const ids = JSON.stringify(rows.filter(p => p.coverage_shared).map(p => p.user_id));
    const { results } = await env.DB.prepare(`WITH self AS (
      SELECT user_id, skill_id, self_level FROM user_skills WHERE user_id IN (SELECT value FROM json_each(?))
    ), peers AS (
      SELECT endorsee_id AS user_id, skill_id, AVG(level) AS level FROM skill_endorsements
      WHERE endorsee_id IN (SELECT value FROM json_each(?)) GROUP BY endorsee_id, skill_id
    ), pairs AS (SELECT user_id, skill_id FROM self UNION SELECT user_id, skill_id FROM peers),
    member_axes AS (
      SELECT p.user_id, s.category_slug, AVG(CASE WHEN peers.level IS NULL THEN self.self_level
        ELSE ROUND(0.4 * COALESCE(self.self_level, 0) + 0.6 * peers.level, 2) END) AS score
      FROM pairs p JOIN skills s ON s.id = p.skill_id AND s.is_active = 1
      LEFT JOIN self ON self.user_id = p.user_id AND self.skill_id = p.skill_id
      LEFT JOIN peers ON peers.user_id = p.user_id AND peers.skill_id = p.skill_id
      GROUP BY p.user_id, s.category_slug
    ) SELECT category_slug, COUNT(*) AS contributors, AVG(score) AS coverage FROM member_axes GROUP BY category_slug`)
      .bind(ids, ids).all<any>();
    return RADAR_AXES.map(axis => {
      const row = results.find(x => x.category_slug === axis.slug && x.contributors >= 2);
      return { slug: axis.slug, label: axis.label,
        coverage_band: row ? (row.coverage >= 3 ? 'covered' : row.coverage >= 1.5 ? 'partial' : 'gap') : null,
        reason: row ? null : 'Not recorded for at least two published team members' };
    });
  });
  // Internal IDs are used only for aggregate scoping, never in a person's public projection.
  const published = rows?.map(({ user_id: _id, coverage_shared: _shared, ...person }) => person);
  return { people: published ? { state: 'recorded', data: published,
      ...(unreadableProfiles ? { publication_state: 'unreadable', publication_reason: 'Some profile publication preferences are unreadable. Try again.' } : {}) } : people, coverage,
    values_band: { value: null, ...notRecorded('No recorded consent to share a team values band') } };
}

async function market(env: Env, project: any) {
  return {
    sizing: await block(async () => {
      const row = await env.DB.prepare('SELECT tam, sam, som FROM projects WHERE id = ?').bind(project.id).first<any>();
      return Object.fromEntries(['tam', 'sam', 'som'].map(key => {
        const value = row?.[key];
        return [key, { value: typeof value === 'number' && Number.isFinite(value) ? value : null,
          source: null, reason: value == null ? 'Not recorded' : 'No source recorded for this figure' }];
      }));
    }),
    sources: await block(async () => (await env.DB.prepare('SELECT title, url, kind FROM market_sources WHERE project_id = ? ORDER BY id').bind(project.id).all()).results),
    who_pays: await block(async () => (await env.DB.prepare(`SELECT name, description, source FROM customer_segments
      WHERE project_id = ? AND archived_at IS NULL ORDER BY id`).bind(project.id).all()).results),
    company_markets: await block(async () => (await env.DB.prepare(`SELECT name, state, decision, decided_on,
      demand_score, demand_source, regulation_score, regulation_source, partners_score, partners_source, cost_score, cost_source
      FROM markets WHERE project_id = ? ORDER BY id`).bind(project.id).all()).results),
    competitors: await block(async () => (await env.DB.prepare(`SELECT t.name_norm AS name, t.why_it_matters,
      t.price_position, t.depth_position FROM competitor_tracking t WHERE t.project_id = ? AND t.stopped_at IS NULL ORDER BY t.id`)
      .bind(project.id).all()).results),
    geography: notRecorded('Company markets are recorded; customer geographic distribution and geographic risk are not recorded here'),
    evidence: notRecorded('Investor evidence items await the PIPE-RAISE read'),
  };
}

async function traction(env: Env, project: any, userId: number) {
  return { history: await block(async () => {
    // NDA is necessary, not a sharing grant. Drafts, private snapshots, legacy KPIs
    // and grants to a different investor are deliberately excluded for every role.
    const { results } = await env.DB.prepare(`SELECT id, period, metrics_json FROM portfolio_updates
      WHERE project_id = ? AND status = 'submitted' AND (
        EXISTS (SELECT 1 FROM update_recipients ur WHERE ur.update_id = portfolio_updates.id AND ur.user_id = ? AND ur.audience = 'investor')
        OR (CASE WHEN json_valid(audience_json) THEN json_type(audience_json, '$.investors') END) = 'true')
      ORDER BY submitted_at DESC, id DESC`).bind(project.id, userId).all<any>();
    const months = new Map<string, unknown[]>();
    for (const update of results) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(update.period) || months.has(update.period)) continue;
      // First/newest submitted revision is authoritative, including an empty revision.
      const figures = updateFigures(update).figures.filter(f => f.value != null && f.source);
      months.set(update.period, figures);
    }
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1)).toISOString().slice(0, 7);
      const figures = months.get(month) ?? [];
      return { month, state: figures.length ? 'reported' : 'not_reported', figures,
        reason: figures.length ? null : 'Not reported' };
    });
  }), arr: { value: null, ...notRecorded('No founder-shared ARR recorded; MRR is not annualised') },
  nrr: { value: null, ...notRecorded('No founder-shared NRR recorded') },
  evidence: notRecorded('Investor evidence items await the PIPE-RAISE read') };
}

function handler(section: 'team' | 'market' | 'traction') {
  return async (c: Context<{ Bindings: Env }>) => {
    c.header('Cache-Control', 'private, no-store');
    const user = await getCurrentUser(c);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    const raw = c.req.param('id') ?? '';
    if (!/^[1-9][0-9]{0,14}$/.test(raw)) return c.json({ error: 'invalid_deal' }, 400);
    try {
      const id = Number(raw);
      if (!await userMayReadDeal(c.env, user, id)) return c.json({ error: 'deal_not_found' }, 404);
      const project = await c.env.DB.prepare(`SELECT p.id, p.founder_id, p.name, p.sector, p.stage, p.tagline AS headline
        FROM deals d JOIN projects p ON p.id = d.project_id WHERE d.id = ? AND p.deleted_at IS NULL`).bind(id).first<any>();
      if (!project) return c.json({ error: 'deal_not_found' }, 404);
      // D1149 deliberately retains partners' separate deal policy pending #2450;
      // trust.ts masks investors. Do not silently redefine that shared role rule.
      const ndaExempt = ['admin', 'partner', 'founder'].includes(user.role);
      // Founders reach here only for their own venture, through userMayReadDeal.
      if (!ndaExempt) {
        const founder = await c.env.DB.prepare(`SELECT id FROM users WHERE founder_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY id LIMIT 1`)
          .bind(project.founder_id).first<any>();
        // Same directional pair as trust.ts, without a read-side schema bootstrap.
        const nda = founder ? await c.env.DB.prepare(`SELECT status, valid_until FROM pairwise_ndas
          WHERE party_a_user_id = ? AND party_b_user_id = ? LIMIT 1`).bind(founder.id, user.id).first<any>() : null;
        if (!nda || nda.status !== 'active' || (nda.valid_until && !(Date.parse(nda.valid_until) > Date.now()))) {
          return c.json({ masked: true, reason: 'no_pairwise_nda',
            project: { name: project.name, sector: project.sector, stage: project.stage, headline: project.headline } });
        }
      }
      const data = section === 'team' ? await team(c.env, project) : section === 'market' ? await market(c.env, project) : await traction(c.env, project, user.id);
      return c.json({ masked: false, ...data });
    } catch { return c.json({ error: 'unreadable', reason: 'Unreadable. Try again.' }, 503); }
  };
}
r.get('/:id/team', handler('team'));
r.get('/:id/market', handler('market'));
r.get('/:id/traction', handler('traction'));
export default r;
