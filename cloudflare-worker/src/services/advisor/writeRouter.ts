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

/**
 * Resolve the founder's "active" project. The advisor profiles the
 * founder's most-recently-touched project; when none exists we create
 * a stub so the answers have somewhere to land. Mirrors the
 * resolveFounderId() pattern in routes/projects.ts.
 */
async function ensureFounderProject(env: Env, user: User): Promise<{ project_id: number; founder_id: number } | null> {
  if (user.role !== 'founder') return null;
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

async function ensureMentorRow(env: Env, user: User): Promise<{ id: number } | null> {
  try {
    const existing = await env.DB.prepare(
      `SELECT id FROM mentors WHERE LOWER(email) = LOWER(?) LIMIT 1`,
    ).bind(user.email).first<{ id: number }>().catch(() => null);
    if (existing?.id) return { id: Number(existing.id) };
    // Generate a 16-hex uid — same convention as the rest of the codebase.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const uid = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const ins = await env.DB.prepare(
      `INSERT INTO mentors (uid, name, email, status) VALUES (?, ?, ?, 'pending') RETURNING id`,
    ).bind(uid, user.name || 'Mentor', user.email).first<{ id: number }>();
    return ins ? { id: Number(ins.id) } : null;
  } catch {
    return null;
  }
}

function parseList(s: string): string[] {
  return s.split(',').map(t => t.trim()).filter(Boolean);
}

function tierForInvestorThesis(user: User): { ok: boolean; upgrade_link?: string } {
  // The free tier writes the basic profile but the long-form `thesis`
  // text is part of the Investor Pro paywall (W-1, see billing.ts).
  // Anything tied to investor_subscription_status='active' is treated
  // as paid here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = user as any;
  const active = u.investor_subscription_status === 'active' || u.subscription_status === 'active';
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
      const gate = tierForInvestorThesis(user);
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
      'mentor.profile.headline':    { col: 'headline' },
      'mentor.profile.bio':         { col: 'bio' },
      'mentor.profile.sectors':     { col: 'sectors_json', coerce: (v) => JSON.stringify(parseList(v)) },
      'mentor.profile.capacity':    { col: 'capacity_per_week', coerce: (v) => Math.max(0, Math.min(40, parseInt(v, 10) || 0)) },
      'mentor.profile.hourly_rate': { col: 'hourly_rate', coerce: (v) => Math.max(0, parseFloat(v) || 0) },
    };
    const m = map[questionId];
    if (!m) return { status: 'noop' };
    const dbValue = m.coerce ? m.coerce(value) : value;
    try {
      await env.DB.prepare(`UPDATE mentors SET ${m.col} = ? WHERE id = ?`).bind(dbValue, mentor.id).run();
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
