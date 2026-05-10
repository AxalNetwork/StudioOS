/**
 * Task #10 (AC-1) — Personal-advisor write-router.
 *
 * Maps `question_id` → the canonical place that answer should land in
 * D1. Every write goes through the *same* per-resource auth check the
 * normal route would enforce (founders can only write their own
 * project, investors their own profile, mentors their own mentor row,
 * etc.). The router never trusts the LLM — only the routes/advisor.ts
 * caller passes a verified `User` here.
 *
 * Tier-locked questions return `{ status: 'paywalled', upgrade_link }`
 * without writing, so the chat can render an explainer + upgrade CTA
 * instead of silently dropping the answer.
 *
 * Refuses destructive actions by design: there is no DELETE router. If
 * the user types "delete my project" the LLM is instructed (in the
 * advisor system prompt) to deep-link them to the page instead.
 */
import type { Env } from '../../types';
import type { User } from '../../types';
import { questionById, mapRoleAnswer } from './questionBank';

export type WriteStatus = 'saved' | 'skipped' | 'paywalled' | 'failed' | 'noop';

export interface WriteResult {
  status: WriteStatus;
  saved_to?: { table: string; column: string; id?: string | number; page_url?: string };
  hint?: string;
  upgrade_link?: string;
  error?: string;
}

// Subscription columns hang off the users row but are not part of the
// canonical User type (which only carries auth-related fields). Type
// the projection explicitly here so we don't reach for `any` casts.
interface UserSubscriptionFields {
  investor_subscription_status?: string | null;
  subscription_status?: string | null;
  mentor_id?: number | null;
}

async function loadSubscriptionFields(env: Env, userId: number): Promise<UserSubscriptionFields> {
  const row = await env.DB.prepare(
    `SELECT investor_subscription_status, subscription_status, mentor_id
       FROM users WHERE id = ?`,
  ).bind(userId).first<UserSubscriptionFields>().catch(() => null);
  return row || {};
}

/**
 * Resolve the founder's "active" project. The advisor profiles the
 * founder's most-recently-touched project; when none exists we create
 * a stub so the answers have somewhere to land. Mirrors the
 * resolveFounderId() pattern in routes/projects.ts.
 */
async function ensureFounderProject(env: Env, user: User): Promise<{ project_id: number; founder_id: number } | null> {
  if (user.role !== 'founder' && user.role !== 'admin') return null;
  let founderId = user.founder_id || null;
  if (!founderId) {
    try {
      const ins = await env.DB.prepare(
        `INSERT INTO founders (name, email) VALUES (?, ?) RETURNING id`,
      ).bind(user.name || 'Unknown', user.email).first<{ id: number }>();
      if (!ins) return null;
      founderId = Number(ins.id);
      await env.DB.prepare(`UPDATE users SET founder_id = ? WHERE id = ?`).bind(founderId, user.id).run();
    } catch {
      return null;
    }
  }
  const proj = await env.DB.prepare(
    `SELECT id FROM projects WHERE founder_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1`,
  ).bind(founderId).first<{ id: number }>().catch(() => null);
  if (proj?.id) return { project_id: Number(proj.id), founder_id: Number(founderId) };
  // No project yet — create a placeholder so subsequent answers can update it.
  try {
    const ins = await env.DB.prepare(
      `INSERT INTO projects (founder_id, name, status, created_at, updated_at)
         VALUES (?, ?, 'active', datetime('now'), datetime('now')) RETURNING id`,
    ).bind(founderId, '(unnamed project)').first<{ id: number }>();
    if (!ins) return null;
    return { project_id: Number(ins.id), founder_id: Number(founderId) };
  } catch {
    return null;
  }
}

/**
 * Lazy-create / update the investor_profiles row keyed by user_id.
 */
async function ensureInvestorProfile(env: Env, user: User): Promise<boolean> {
  try {
    await env.DB.prepare(
      `INSERT INTO investor_profiles (user_id) VALUES (?)
       ON CONFLICT(user_id) DO NOTHING`,
    ).bind(user.id).run();
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve (or lazy-create) the mentor row owned by `user`. Uses the
 * same lookup order as routes/mentors.ts:myMentor — users.mentor_id
 * first, then fall back to mentors.user_id. Column names match the
 * live D1 schema (display_name, email, is_active).
 */
async function ensureMentorRow(env: Env, user: User): Promise<{ id: number } | null> {
  try {
    const subs = await loadSubscriptionFields(env, user.id);
    if (subs.mentor_id) {
      const byId = await env.DB.prepare(`SELECT id FROM mentors WHERE id = ?`)
        .bind(subs.mentor_id).first<{ id: number }>().catch(() => null);
      if (byId?.id) return { id: Number(byId.id) };
    }
    const byUser = await env.DB.prepare(`SELECT id FROM mentors WHERE user_id = ?`)
      .bind(user.id).first<{ id: number }>().catch(() => null);
    if (byUser?.id) return { id: Number(byUser.id) };

    // Generate a 16-hex uid — matches the rest of the codebase.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const uid = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const now = new Date().toISOString();
    const r = await env.DB.prepare(
      `INSERT INTO mentors (uid, user_id, display_name, email, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).bind(uid, user.id, user.name || 'Mentor', user.email, now, now).run();
    const newId = Number((r as { meta?: { last_row_id?: number } }).meta?.last_row_id || 0);
    if (!newId) return null;
    try {
      await env.DB.prepare(`UPDATE users SET mentor_id = ? WHERE id = ?`)
        .bind(newId, user.id).run();
    } catch { /* mentor_id column may not be migrated yet */ }
    return { id: newId };
  } catch {
    return null;
  }
}

function parseList(s: string): string[] {
  return s.split(',').map(t => t.trim()).filter(Boolean);
}

async function tierForInvestorThesis(env: Env, user: User): Promise<{ ok: boolean; upgrade_link?: string }> {
  // The free tier writes the basic profile but the long-form `thesis`
  // text is part of the Investor Pro paywall (W-1, see billing.ts).
  // Anything tied to investor_subscription_status='active' or the
  // generic subscription_status='active' is treated as paid here.
  const subs = await loadSubscriptionFields(env, user.id);
  const active = subs.investor_subscription_status === 'active' || subs.subscription_status === 'active';
  if (active) return { ok: true };
  return { ok: false, upgrade_link: '/billing/investor-upgrade' };
}

/**
 * Route a single answer to its persistence target.
 *
 * The router is intentionally *exhaustive*: any question that exists
 * in the bank but has no router branch returns `{ status: 'noop' }` so
 * the conversation history still records the answer even though
 * nothing was persisted — surfaces gaps loudly instead of silently
 * dropping data.
 */
export async function routeAnswer(
  env: Env,
  user: User,
  questionId: string,
  rawValue: string,
): Promise<WriteResult> {
  const q = questionById(questionId);
  if (!q) return { status: 'failed', error: 'unknown question_id' };
  const value = String(rawValue ?? '').trim();
  if (!value) return { status: 'skipped' };

  // ---- Role detector --------------------------------------------------
  if (questionId === 'role_detect.primary') {
    const role = mapRoleAnswer(value);
    if (!role) return { status: 'failed', error: 'unable to map answer to a role' };
    try {
      await env.DB.prepare(`UPDATE users SET role = ? WHERE id = ?`).bind(role, user.id).run();
    } catch (e) {
      return { status: 'failed', error: (e as Error).message };
    }
    return {
      status: 'saved',
      saved_to: { table: 'users', column: 'role', id: user.id },
      hint: `Role set to ${role}.`,
    };
  }
  if (questionId === 'role_detect.organization') {
    try {
      await env.DB.prepare(
        `UPDATE users SET organization = ? WHERE id = ?`,
      ).bind(value, user.id).run();
      return { status: 'saved', saved_to: { table: 'users', column: 'organization', id: user.id, page_url: '/settings' } };
    } catch {
      // Older users tables may lack the column; record as noop instead
      // of failing the conversation.
      return { status: 'noop', hint: 'organization column not available; remembered for later.' };
    }
  }
  if (questionId === 'role_detect.headline') {
    try {
      await env.DB.prepare(`UPDATE users SET headline = ? WHERE id = ?`).bind(value, user.id).run();
      return { status: 'saved', saved_to: { table: 'users', column: 'headline', id: user.id, page_url: '/settings' } };
    } catch {
      return { status: 'noop' };
    }
  }

  // ---- Founder bank ---------------------------------------------------
  if (q.persona === 'founder') {
    if (user.role !== 'founder' && user.role !== 'admin') {
      return { status: 'failed', error: 'founder questions require founder role' };
    }
    const ctx = await ensureFounderProject(env, user);
    if (!ctx) return { status: 'failed', error: 'could not resolve founder project' };
    // Column targets reflect the projects schema actually shipped in
    // D1 (see migrations 001-022). There is no `short_pitch` /
    // `traction_summary` — the closest fits are `description` and
    // `growth_signals` respectively.
    const colMap: Record<string, string> = {
      'founder.project.name':     'name',
      'founder.project.pitch':    'description',
      'founder.project.sector':   'sector',
      'founder.project.stage':    'stage',
      'founder.project.traction': 'growth_signals',
    };
    const column = colMap[questionId];
    if (!column) return { status: 'noop' };
    try {
      await env.DB.prepare(
        `UPDATE projects SET ${column} = ?, updated_at = datetime('now') WHERE id = ? AND founder_id = ?`,
      ).bind(value, ctx.project_id, ctx.founder_id).run();
      return {
        status: 'saved',
        saved_to: { table: 'projects', column, id: ctx.project_id, page_url: `/projects/${ctx.project_id}` },
      };
    } catch (e) {
      return { status: 'failed', error: (e as Error).message };
    }
  }

  // ---- Investor bank --------------------------------------------------
  if (q.persona === 'investor') {
    if (user.role !== 'investor' && user.role !== 'admin') {
      return { status: 'failed', error: 'investor questions require investor role' };
    }
    if (questionId === 'investor.profile.thesis') {
      const gate = await tierForInvestorThesis(env, user);
      if (!gate.ok) {
        return {
          status: 'paywalled',
          upgrade_link: gate.upgrade_link,
          hint: 'A long-form investment thesis is part of the Investor Pro plan. Upgrade to unlock it.',
        };
      }
    }
    if (!(await ensureInvestorProfile(env, user))) {
      return { status: 'failed', error: 'could not initialise investor_profiles row' };
    }
    const map: Record<string, { col: string; serialise?: (v: string) => string | number }> = {
      'investor.profile.investor_type': { col: 'investor_type' },
      'investor.profile.sectors':       { col: 'sectors_json', serialise: (v) => JSON.stringify(parseList(v)) },
      'investor.profile.stages':        { col: 'stages_json',  serialise: (v) => JSON.stringify(parseList(v)) },
      'investor.profile.ticket_band':   { col: 'ticket_band' },
      'investor.profile.thesis':        { col: 'thesis_text' },
    };
    const m = map[questionId];
    if (!m) return { status: 'noop' };
    const dbValue = m.serialise ? m.serialise(value) : value;
    try {
      await env.DB.prepare(
        `UPDATE investor_profiles SET ${m.col} = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
      ).bind(dbValue, user.id).run();
      return {
        status: 'saved',
        saved_to: { table: 'investor_profiles', column: m.col, id: user.id, page_url: '/investor-profile' },
      };
    } catch (e) {
      return { status: 'failed', error: (e as Error).message };
    }
  }

  // ---- Mentor bank ----------------------------------------------------
  if (q.persona === 'mentor') {
    // The User.role enum in types.ts only lists the four core roles
    // (admin/founder/partner/investor) — `mentor` is a runtime-only
    // value populated by the mentor-onboarding flow and the role
    // detector. Compare via string cast so TS doesn't complain about
    // the unreachable-looking branch.
    const role = String(user.role || '');
    if (role !== 'mentor' && role !== 'admin') {
      return { status: 'failed', error: 'mentor questions require mentor role' };
    }
    const mentor = await ensureMentorRow(env, user);
    if (!mentor) return { status: 'failed', error: 'could not initialise mentor row' };
    const map: Record<string, { col: string; coerce?: (v: string) => number | string }> = {
      'mentor.profile.display_name':    { col: 'display_name' },
      'mentor.profile.bio':             { col: 'bio' },
      'mentor.profile.sectors':         { col: 'sectors_json',   coerce: (v) => JSON.stringify(parseList(v)) },
      'mentor.profile.expertise':       { col: 'expertise_json', coerce: (v) => JSON.stringify(parseList(v)) },
      'mentor.profile.hourly_rate_usd': { col: 'hourly_rate_usd', coerce: (v) => Math.max(0, parseFloat(v) || 0) },
      'mentor.profile.linkedin_url':    { col: 'linkedin_url' },
    };
    const m = map[questionId];
    if (!m) return { status: 'noop' };
    const dbValue = m.coerce ? m.coerce(value) : value;
    try {
      await env.DB.prepare(
        `UPDATE mentors SET ${m.col} = ?, updated_at = ? WHERE id = ?`,
      ).bind(dbValue, new Date().toISOString(), mentor.id).run();
      return {
        status: 'saved',
        saved_to: { table: 'mentors', column: m.col, id: mentor.id, page_url: '/mentors/me' },
      };
    } catch (e) {
      return { status: 'failed', error: (e as Error).message };
    }
  }

  // ---- Partner bank ---------------------------------------------------
  if (q.persona === 'partner') {
    // Partner profile is owned by the partner-onboarding wizard
    // (Task #9). Within the advisor we just record the ambient note
    // without touching the binding partner_profiles row.
    return { status: 'noop', hint: 'Partner profile fields live in the Partner Portal — opening it for you.' };
  }

  // ---- Admin bank -----------------------------------------------------
  if (q.persona === 'admin') {
    if (questionId === 'admin.preferences.digest_freq') {
      try {
        await env.DB.prepare(
          `INSERT INTO user_settings (user_id, digest_frequency)
             VALUES (?, ?)
           ON CONFLICT(user_id) DO UPDATE SET digest_frequency = excluded.digest_frequency`,
        ).bind(user.id, value).run();
        return { status: 'saved', saved_to: { table: 'user_settings', column: 'digest_frequency', id: user.id } };
      } catch {
        return { status: 'noop' };
      }
    }
  }

  return { status: 'noop' };
}

// ---------------------------------------------------------------------------
// Hydration — pre-mark questions whose answers are already present in
// the underlying domain table, so /start doesn't re-ask the user for
// data they entered through normal pages.
//
// Returns the set of question_ids the route layer should treat as
// "already answered" for the purpose of nextUnansweredQuestion().
// Per-persona reads only — no writes — so it's safe to call on every
// /start invocation.
// ---------------------------------------------------------------------------
export async function hydrateAlreadyAnswered(env: Env, user: User): Promise<Set<string>> {
  const answered = new Set<string>();
  const role = String(user.role || '');

  // Role detector — `users.role` already set means primary is answered.
  if (role && role !== 'unknown') answered.add('role_detect.primary');
  try {
    const u = await env.DB.prepare(
      `SELECT organization, headline FROM users WHERE id = ?`,
    ).bind(user.id).first<{ organization: string | null; headline: string | null }>().catch(() => null);
    if (u?.organization) answered.add('role_detect.organization');
    if (u?.headline)     answered.add('role_detect.headline');
  } catch { /* organization/headline not migrated everywhere */ }

  if (role === 'founder' || role === 'admin') {
    if (user.founder_id) {
      const proj = await env.DB.prepare(
        `SELECT name, description, sector, stage, growth_signals
           FROM projects WHERE founder_id = ?
           ORDER BY updated_at DESC, id DESC LIMIT 1`,
      ).bind(user.founder_id).first<{ name: string | null; description: string | null; sector: string | null; stage: string | null; growth_signals: string | null }>().catch(() => null);
      if (proj) {
        if (proj.name && proj.name !== '(unnamed project)') answered.add('founder.project.name');
        if (proj.description) answered.add('founder.project.pitch');
        if (proj.sector)      answered.add('founder.project.sector');
        if (proj.stage && proj.stage !== 'idea') answered.add('founder.project.stage');
        if (proj.growth_signals) answered.add('founder.project.traction');
      }
    }
  }

  if (role === 'investor' || role === 'admin') {
    const inv = await env.DB.prepare(
      `SELECT investor_type, sectors_json, stages_json, ticket_band, thesis_text
         FROM investor_profiles WHERE user_id = ?`,
    ).bind(user.id).first<{ investor_type: string | null; sectors_json: string | null; stages_json: string | null; ticket_band: string | null; thesis_text: string | null }>().catch(() => null);
    if (inv) {
      if (inv.investor_type) answered.add('investor.profile.investor_type');
      if (inv.sectors_json && inv.sectors_json !== '[]') answered.add('investor.profile.sectors');
      if (inv.stages_json  && inv.stages_json  !== '[]') answered.add('investor.profile.stages');
      if (inv.ticket_band)   answered.add('investor.profile.ticket_band');
      if (inv.thesis_text)   answered.add('investor.profile.thesis');
    }
  }

  if (role === 'mentor' || role === 'admin') {
    const m = await env.DB.prepare(
      `SELECT display_name, bio, sectors_json, expertise_json, hourly_rate_usd, linkedin_url
         FROM mentors WHERE user_id = ?`,
    ).bind(user.id).first<{ display_name: string | null; bio: string | null; sectors_json: string | null; expertise_json: string | null; hourly_rate_usd: number | null; linkedin_url: string | null }>().catch(() => null);
    if (m) {
      if (m.display_name && m.display_name !== (user.name || user.email)) answered.add('mentor.profile.display_name');
      if (m.bio) answered.add('mentor.profile.bio');
      if (m.sectors_json && m.sectors_json !== '[]')   answered.add('mentor.profile.sectors');
      if (m.expertise_json && m.expertise_json !== '[]') answered.add('mentor.profile.expertise');
      if (m.hourly_rate_usd != null) answered.add('mentor.profile.hourly_rate_usd');
      if (m.linkedin_url)  answered.add('mentor.profile.linkedin_url');
    }
  }

  return answered;
}
