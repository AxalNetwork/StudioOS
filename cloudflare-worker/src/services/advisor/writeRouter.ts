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
import { questionById, mapRoleAnswer } from './questionBank.ts';

export type WriteStatus = 'saved' | 'skipped' | 'paywalled' | 'failed' | 'noop' | 'needs_evidence' | 'invalid';

export interface WriteResult {
  status: WriteStatus;
  saved_to?: { table: string; column: string; id?: string | number; page_url?: string };
  hint?: string;
  upgrade_link?: string;
  error?: string;
  // Task #3 (AS) — surfaced for evidence-gate (`needs_evidence`) and
  // schema-validation (`invalid`) statuses so the UI can render a
  // targeted retry prompt instead of a generic error.
  evidence_kind?: 'citation' | 'numeric' | 'date' | 'url' | 'free_text';
  open_url?: string;
  field?: string;
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

/**
 * Task #3 (AS) — resolve (or lazy-create) the partner_profiles row
 * owned by `user`. Mirrors ensureMentorRow's defensive pattern:
 *   1. Look up by user_id (claimed-invitation case).
 *   2. Look up by email match against partner_invitations.recipient_email
 *      and bind the user_id (admin invited the partner directly).
 *   3. Otherwise synthesise an admin-side invitation stub +
 *      partner_profiles row so advisor answers have somewhere to land.
 * The advisor never creates real `partner_invitations.token` rows
 * that can be redeemed externally — synthesised stubs are flagged
 * `status='advisor_stub'` so admin lists can filter them out.
 */
async function ensurePartnerProfile(env: Env, user: User): Promise<{ id: number; invitation_id: number } | null> {
  try {
    // (1) Already-claimed profile.
    const claimed = await env.DB.prepare(
      `SELECT id, invitation_id FROM partner_profiles WHERE user_id = ? LIMIT 1`,
    ).bind(user.id).first<{ id: number; invitation_id: number }>();
    if (claimed?.id) return { id: Number(claimed.id), invitation_id: Number(claimed.invitation_id) };

    // (2) Bind by email.
    const inv = await env.DB.prepare(
      `SELECT id FROM partner_invitations WHERE LOWER(recipient_email) = LOWER(?) LIMIT 1`,
    ).bind(user.email).first<{ id: number }>().catch(() => null);
    if (inv?.id) {
      // Bind user to existing invitation; create profile if missing.
      const existing = await env.DB.prepare(
        `SELECT id, user_id FROM partner_profiles WHERE invitation_id = ?`,
      ).bind(inv.id).first<{ id: number; user_id: number | null }>().catch(() => null);
      if (existing?.id) {
        // Access-control guard: only bind user_id when it's NULL or
        // already this user. Refuse to silently rebind a profile
        // currently owned by someone else (e.g. duplicate emails or
        // a prior partner who claimed the invitation) — the advisor
        // should never reassign profile ownership.
        const currentOwner = existing.user_id == null ? null : Number(existing.user_id);
        if (currentOwner != null && currentOwner !== user.id) {
          return null;
        }
        if (currentOwner == null) {
          await env.DB.prepare(
            `UPDATE partner_profiles SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id IS NULL`,
          ).bind(user.id, existing.id).run();
        }
        return { id: Number(existing.id), invitation_id: Number(inv.id) };
      }
      const r = await env.DB.prepare(
        `INSERT INTO partner_profiles (invitation_id, user_id, full_name)
           VALUES (?, ?, ?)`,
      ).bind(inv.id, user.id, user.name || user.email).run();
      const newId = Number((r as { meta?: { last_row_id?: number } }).meta?.last_row_id || 0);
      if (newId) return { id: newId, invitation_id: Number(inv.id) };
    }

    // (3) Stub invitation + profile so advisor writes have a target.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const invIns = await env.DB.prepare(
      `INSERT INTO partner_invitations (recipient_email, token, status, invited_by_user_id)
         VALUES (?, ?, 'advisor_stub', ?)`,
    ).bind(user.email, token, user.id).run().catch(() => null);
    const invId = Number((invIns as { meta?: { last_row_id?: number } } | null)?.meta?.last_row_id || 0);
    if (!invId) return null;
    const profIns = await env.DB.prepare(
      `INSERT INTO partner_profiles (invitation_id, user_id, full_name)
         VALUES (?, ?, ?)`,
    ).bind(invId, user.id, user.name || user.email).run();
    const profId = Number((profIns as { meta?: { last_row_id?: number } }).meta?.last_row_id || 0);
    if (!profId) return null;
    return { id: profId, invitation_id: invId };
  } catch (e) {
    console.error('[advisor] ensurePartnerProfile:', (e as Error).message);
    return null;
  }
}

/**
 * Task #3 (AS) — merge a single value into projects.advisor_extras_json
 * keyed by question_id. This is the catch-all column for free-form
 * founder answers that don't have a canonical column yet (e.g.
 * compliance.status, captable.ownership). Returns true on success.
 */
async function mergeProjectExtras(
  env: Env, projectId: number, key: string, value: string,
): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      `SELECT advisor_extras_json FROM projects WHERE id = ?`,
    ).bind(projectId).first<{ advisor_extras_json: string | null }>().catch(() => null);
    let extras: Record<string, string> = {};
    if (row?.advisor_extras_json) {
      try {
        const parsed = JSON.parse(row.advisor_extras_json);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          extras = parsed as Record<string, string>;
        }
      } catch { /* malformed — overwrite */ }
    }
    extras[key] = value;
    await env.DB.prepare(
      `UPDATE projects SET advisor_extras_json = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(JSON.stringify(extras), projectId).run();
    return true;
  } catch {
    return false;
  }
}

/** Same shape as mergeProjectExtras but for cross-project (users) extras. */
async function mergeUserExtras(env: Env, userId: number, key: string, value: string): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      `SELECT advisor_extras_json FROM users WHERE id = ?`,
    ).bind(userId).first<{ advisor_extras_json: string | null }>().catch(() => null);
    let extras: Record<string, string> = {};
    if (row?.advisor_extras_json) {
      try {
        const parsed = JSON.parse(row.advisor_extras_json);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          extras = parsed as Record<string, string>;
        }
      } catch { /* malformed — overwrite */ }
    }
    extras[key] = value;
    await env.DB.prepare(
      `UPDATE users SET advisor_extras_json = ? WHERE id = ?`,
    ).bind(JSON.stringify(extras), userId).run();
    return true;
  } catch {
    return false;
  }
}

/**
 * Task #3 (AS) — record a field_sources audit row whenever the
 * router successfully persists an advisor answer. Idempotent via
 * UNIQUE(user_id, question_id) — a re-answer overwrites the prior
 * row's `evidence_text` + `filled_at` so the page banner reflects
 * the most recent value.
 *
 * Best-effort: schema not migrated → silently ignore so the
 * /answer envelope still returns success to the caller.
 */
export async function recordFieldSource(
  env: Env, userId: number, questionId: string,
  pageTarget: string | null,
  saved: { table?: string; column?: string; id?: string | number } | null,
  source: 'advisor' | 'manual' | 'import',
  evidence: string | null,
): Promise<void> {
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS field_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, question_id TEXT NOT NULL, page_target TEXT, saved_to_table TEXT, saved_to_column TEXT, saved_to_id TEXT, source TEXT NOT NULL DEFAULT 'advisor', evidence_text TEXT, filled_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, question_id))",
    );
    await env.DB.prepare(
      `INSERT INTO field_sources
         (user_id, question_id, page_target, saved_to_table, saved_to_column, saved_to_id, source, evidence_text, filled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, question_id) DO UPDATE SET
         page_target = excluded.page_target,
         saved_to_table = excluded.saved_to_table,
         saved_to_column = excluded.saved_to_column,
         saved_to_id = excluded.saved_to_id,
         source = excluded.source,
         evidence_text = excluded.evidence_text,
         filled_at = excluded.filled_at`,
    ).bind(
      userId, questionId, pageTarget,
      saved?.table || null, saved?.column || null,
      saved?.id != null ? String(saved.id) : null,
      source, evidence,
    ).run();
  } catch (e) {
    console.error('[advisor] recordFieldSource:', (e as Error).message);
  }
}

// Lazy partial-unique indexes for the AC-2 founder bank "slot"
// upserts (discovery interviews + roadmap OKRs). Scoped via
// `WHERE col LIKE 'advisor:%'` so they never collide with
// user-typed values in the same column. Created once per isolate.
let _slotIndexesReady = false;
// ---------------------------------------------------------------------------
// Spin-Out milestone helper (Task #2 AR).
//
// Mirrors the auto-advance loop from `routes/spinout_lab.ts:recordMilestone`
// using env.DB directly so writeRouter (which has no postgres `Sql` tag)
// can keep `users.spinout_lab_week` in lockstep with milestone writes
// triggered by advisor answers. Without this, week-gated questions
// stayed locked forever because the column never advanced.
//
// Reuses the canonical `MILESTONES` catalog + `weekMet` predicate
// from routes/spinout_lab.ts so the gating logic stays in one place
// — divergence here would silently let the week advance on the
// wrong milestone set.
//
// Best-effort: lab inactive / table missing / etc. swallow silently
// — these writes are side-effects of normal answer plumbing and must
// never block the user-facing /answer response.
// ---------------------------------------------------------------------------
// Pull from the pure catalog module (NOT routes/spinout_lab) so this
// file doesn't drag Hono / auth / db into non-route consumers (e.g.
// the advisor scenario test under --experimental-strip-types).
import { MILESTONES, weekMet as canonicalWeekMet } from '../spinoutLabCatalog.ts';

function weekForMilestoneKey(key: string): number | null {
  for (const w of MILESTONES) {
    if (w.requiredAll.includes(key) || (w.requiredAny ?? []).includes(key)) return w.week;
  }
  return null;
}

async function recordSpinoutMilestoneAndAdvance(
  env: Env, userId: number, key: string, _hintWeek: number,
): Promise<void> {
  // Resolve the canonical week for this key. If the key isn't in
  // the MILESTONES catalog (e.g. typo in a future bank entry) we
  // bail out — never advance on an unknown milestone.
  const week = weekForMilestoneKey(key);
  if (!week) return;
  // Insert is idempotent via UNIQUE(user_id, milestone_key).
  await env.DB.prepare(
    `INSERT OR IGNORE INTO spinout_lab_milestones (user_id, week, milestone_key)
     VALUES (?, ?, ?)`,
  ).bind(userId, week, key).run();
  // Re-read user lab state. Bail if lab inactive — we never want to
  // advance a non-active lab from a side-effect path.
  const u = await env.DB.prepare(
    `SELECT spinout_lab_active, spinout_lab_week FROM users WHERE id = ?`,
  ).bind(userId).first<{ spinout_lab_active: number | null; spinout_lab_week: number | null }>();
  if (!u || Number(u.spinout_lab_active) !== 1) return;
  const rows = await env.DB.prepare(
    `SELECT milestone_key FROM spinout_lab_milestones WHERE user_id = ?`,
  ).bind(userId).all<{ milestone_key: string }>();
  const completed = new Set<string>((rows.results || []).map((r) => r.milestone_key));
  let newWeek = Math.max(1, Math.min(4, Number(u.spinout_lab_week ?? 1)));
  while (newWeek < 4 && canonicalWeekMet(newWeek, completed)) newWeek += 1;
  if (newWeek !== Number(u.spinout_lab_week)) {
    await env.DB.prepare(`UPDATE users SET spinout_lab_week = ? WHERE id = ?`).bind(newWeek, userId).run();
  }
  if (newWeek === 4 && canonicalWeekMet(4, completed)) {
    await env.DB.prepare(`UPDATE users SET spinout_lab_active = 0, is_incorporated = 1 WHERE id = ?`).bind(userId).run();
  }
}

async function ensureAdvisorSlotIndexes(env: Env): Promise<void> {
  if (_slotIndexesReady) return;
  try {
    await env.DB.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS uniq_discovery_advisor_slot ON discovery_interviews(project_id, interviewee_role) WHERE interviewee_role LIKE 'advisor:%'",
    );
    await env.DB.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS uniq_roadmap_okrs_advisor_slot ON roadmap_okrs(project_id, quarter) WHERE quarter LIKE 'advisor:%'",
    );
    _slotIndexesReady = true;
  } catch (e) {
    console.error('[advisor] slot indexes:', (e as Error).message);
  }
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
  evidence?: string | null,
): Promise<WriteResult> {
  const q = questionById(questionId);
  if (!q) return { status: 'failed', error: 'unknown question_id' };
  const value = String(rawValue ?? '').trim();
  if (!value) return { status: 'skipped' };

  // Task #3 (AS) — evidence gate. Bank questions flagged
  // `requires_evidence` (high-risk financial fields) refuse to
  // persist without a non-empty `evidence` string from the caller.
  // The advisor system prompt instructs the LLM to attach a one-line
  // citation when it auto-fills these from the chat transcript;
  // direct UI submissions can pass the user-typed answer itself.
  if (q.requires_evidence && !String(evidence ?? '').trim()) {
    return {
      status: 'needs_evidence',
      error: 'evidence_required',
      hint: 'This number changes scoring + cap-table — please paste a one-line source (bank balance date, MRR report row, term-sheet line, etc.) so we can cite it.',
      evidence_kind: 'citation',
      field: questionId,
      open_url: q.page_target || undefined,
    };
  }

  // Task #3 (AS) — lightweight schema-style validation for high-risk
  // numeric fields. Mirrors the page PUT validators (financials,
  // raise) so the advisor can't write nonsense like "soon" into a
  // dollar column. Done inline because adding `zod` to the worker
  // bundle is overkill for ~6 fields; the shape is small and the
  // page Zod schemas live in a separate package.
  const NUMERIC_FIELDS: Record<string, { min: number; max?: number; label: string }> = {
    // Note: keys must match the canonical bank IDs in
    // banks/existingFounder.ts (USD-suffixed columns; capital section).
    'founder.financials.runway_months':     { min: 0, max: 600,        label: 'months of runway' },
    'founder.financials.monthly_burn_usd':  { min: 0, max: 100_000_000, label: 'monthly burn (USD)' },
    'founder.financials.mrr_usd':           { min: 0, max: 1_000_000_000, label: 'MRR (USD)' },
    'founder.capital.raise_target_usd':     { min: 0, max: 1_000_000_000, label: 'raise target (USD)' },
  };
  const numSpec = NUMERIC_FIELDS[questionId];
  if (numSpec) {
    const cleaned = value.replace(/[$,\s]/g, '');
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < numSpec.min || (numSpec.max != null && n > numSpec.max)) {
      return {
        status: 'invalid',
        error: 'schema_validation_failed',
        hint: `Please enter a number for ${numSpec.label} between ${numSpec.min} and ${numSpec.max ?? '∞'}.`,
        evidence_kind: 'numeric',
        field: questionId,
        open_url: q.page_target || undefined,
      };
    }
  }

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

    // ---- AC-2: discovery interviews (≥3) -----------------------------
    // Each (interviewN.name, interviewN.pains) pair maps to one
    // discovery_interviews row tagged with `interviewee_role =
    // 'advisor:interviewN'`. We declare a partial UNIQUE index over
    // `(project_id, interviewee_role)` scoped to advisor slots, so
    // ON CONFLICT upserts are atomic — concurrent submissions can
    // never duplicate the same slot. The partial WHERE clause
    // protects pre-existing rows that may share interviewee_role
    // values like "Designer" across different projects.
    const discoveryMatch = /^founder\.discovery\.interview([1-3])\.(name|pains)$/.exec(questionId);
    if (discoveryMatch) {
      const slot = `advisor:interview${discoveryMatch[1]}`;
      const field = discoveryMatch[2]; // 'name' | 'pains'
      await ensureAdvisorSlotIndexes(env);
      const nowIso = new Date().toISOString();
      try {
        if (field === 'name') {
          await env.DB.prepare(
            `INSERT INTO discovery_interviews
               (project_id, interviewee_name, interviewee_role, interview_date,
                notes, hypotheses_json, pains_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, '', '[]', '[]', ?, ?)
             ON CONFLICT(project_id, interviewee_role)
               WHERE interviewee_role LIKE 'advisor:%'
             DO UPDATE SET interviewee_name = excluded.interviewee_name,
                           updated_at = excluded.updated_at`,
          ).bind(ctx.project_id, value, slot, nowIso.slice(0, 10), nowIso, nowIso).run();
        } else {
          // pains_json is an array; we store the free-text answer as
          // the single first element so existing /api/progress/discovery
          // readers (which expect a JSON array) don't choke.
          const painsJson = JSON.stringify([value]);
          await env.DB.prepare(
            `INSERT INTO discovery_interviews
               (project_id, interviewee_name, interviewee_role, interview_date,
                notes, hypotheses_json, pains_json, created_at, updated_at)
             VALUES (?, '(unnamed)', ?, ?, ?, '[]', ?, ?, ?)
             ON CONFLICT(project_id, interviewee_role)
               WHERE interviewee_role LIKE 'advisor:%'
             DO UPDATE SET pains_json = excluded.pains_json,
                           notes = excluded.notes,
                           updated_at = excluded.updated_at`,
          ).bind(ctx.project_id, slot, nowIso.slice(0, 10), value, painsJson, nowIso, nowIso).run();
        }
        const row = await env.DB.prepare(
          `SELECT id FROM discovery_interviews WHERE project_id = ? AND interviewee_role = ?`,
        ).bind(ctx.project_id, slot).first<{ id: number }>();
        // Side-effect: log the canonical Spin-Out Lab Week-1
        // milestone for this interview slot. The lab engine
        // (routes/spinout_lab.ts) only recognises the keys
        // `customer_interview_logged_{1,2,3}`, so writing
        // anything else would silently fail to advance the week.
        // INSERT OR IGNORE keeps it idempotent.
        try {
          await recordSpinoutMilestoneAndAdvance(
            env, user.id, `customer_interview_logged_${discoveryMatch[1]}`, 1,
          );
        } catch { /* milestones table may not exist on legacy dev DBs */ }
        return {
          status: 'saved',
          saved_to: {
            table: 'discovery_interviews',
            column: field === 'name' ? 'interviewee_name' : 'pains_json',
            id: row?.id,
            page_url: '/build/discovery',
          },
        };
      } catch (e) {
        return { status: 'failed', error: (e as Error).message };
      }
    }

    // ---- AC-2: roadmap OKRs (≥3) -------------------------------------
    // Each objective lands as one roadmap_okrs row tagged in
    // `quarter` with `advisor:q1_objN`. Same pattern as discovery —
    // a partial UNIQUE index scoped to advisor slots gives us
    // atomic upsert without colliding with existing user-created
    // rows whose `quarter` is set to a normal label like 'Q1 2026'.
    const okrMatch = /^founder\.okrs\.q1_objective([1-3])$/.exec(questionId);
    if (okrMatch) {
      const slot = `advisor:q1_obj${okrMatch[1]}`;
      await ensureAdvisorSlotIndexes(env);
      const nowIso = new Date().toISOString();
      try {
        await env.DB.prepare(
          `INSERT INTO roadmap_okrs
             (project_id, objective, key_results_json, kanban_status, quarter, sort_order, created_at, updated_at)
           VALUES (?, ?, '[]', 'now', ?, ?, ?, ?)
           ON CONFLICT(project_id, quarter)
             WHERE quarter LIKE 'advisor:%'
           DO UPDATE SET objective = excluded.objective,
                         updated_at = excluded.updated_at`,
        ).bind(ctx.project_id, value, slot, Number(okrMatch[1]), nowIso, nowIso).run();
        const row = await env.DB.prepare(
          `SELECT id FROM roadmap_okrs WHERE project_id = ? AND quarter = ?`,
        ).bind(ctx.project_id, slot).first<{ id: number }>();
        return {
          status: 'saved',
          saved_to: { table: 'roadmap_okrs', column: 'objective', id: row?.id, page_url: '/build/roadmap' },
        };
      } catch (e) {
        return { status: 'failed', error: (e as Error).message };
      }
    }

    // ---- AC-2: brand basics (landing_pages) --------------------------
    if (questionId === 'founder.brand.tagline' || questionId === 'founder.brand.theme_color') {
      const col = questionId === 'founder.brand.tagline' ? 'tagline' : 'theme_color';
      // theme_color must be a 6-digit hex; reject otherwise.
      if (col === 'theme_color' && !/^#[0-9a-fA-F]{6}$/.test(value)) {
        return { status: 'failed', error: 'theme_color must be a 6-digit hex like #7c3aed' };
      }
      try {
        // Lazy-create the landing_pages table (mirrors routes/brand.ts
        // ensureSchema) so this works on dev/SQLite without a prior
        // brand-page open.
        await env.DB.exec(
          "CREATE TABLE IF NOT EXISTS landing_pages (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, tagline TEXT, headline TEXT, subheadline TEXT, cta_text TEXT DEFAULT 'Join the waitlist', logo_url TEXT, logo_svg TEXT, theme_color TEXT DEFAULT '#7c3aed', published INTEGER DEFAULT 0, views_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))",
        );
        const proj = await env.DB.prepare(`SELECT name FROM projects WHERE id = ?`).bind(ctx.project_id).first<{ name: string }>();
        const baseName = (proj?.name || 'page').replace(/[^a-z0-9-]+/gi, '-').toLowerCase().slice(0, 40) || 'page';
        const tail = Math.random().toString(36).slice(2, 8);
        const slug = `${baseName}-${tail}`;
        const existing = await env.DB.prepare(`SELECT id FROM landing_pages WHERE project_id = ?`).bind(ctx.project_id).first<{ id: number }>();
        if (existing?.id) {
          await env.DB.prepare(
            `UPDATE landing_pages SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`,
          ).bind(value, existing.id).run();
          return { status: 'saved', saved_to: { table: 'landing_pages', column: col, id: existing.id, page_url: '/build/brand' } };
        }
        await env.DB.prepare(
          `INSERT INTO landing_pages (project_id, slug, name, ${col}) VALUES (?, ?, ?, ?)`,
        ).bind(ctx.project_id, slug, proj?.name || 'My Startup', value).run();
        return { status: 'saved', saved_to: { table: 'landing_pages', column: col, id: ctx.project_id, page_url: '/build/brand' } };
      } catch (e) {
        return { status: 'failed', error: (e as Error).message };
      }
    }

    // ---- AC-2: deck-draft seed (pitch_decks) -------------------------
    // Stored as the canonical array-of-slide-objects shape that
    // routes/decks.ts and the PitchDeckPage UI consume:
    //   [{ title, subtitle, body, bullets, image_url }, …]
    // We merge by title so subsequent answers update the same slide
    // rather than appending duplicates.
    if (questionId === 'founder.deck.problem' || questionId === 'founder.deck.market') {
      const slideTitle = questionId === 'founder.deck.problem' ? 'Problem' : 'Market';
      try {
        await env.DB.exec(
          "CREATE TABLE IF NOT EXISTS pitch_decks (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, slides TEXT NOT NULL, title TEXT, is_current INTEGER DEFAULT 1, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')))",
        );
        const cur = await env.DB.prepare(
          `SELECT id, slides FROM pitch_decks WHERE project_id = ? AND is_current = 1 ORDER BY version DESC LIMIT 1`,
        ).bind(ctx.project_id).first<{ id: number; slides: string }>();
        // Normalize whatever's there into an array of slide objects.
        let slides: Array<{ title: string; subtitle?: string | null; body?: string; bullets?: string[]; image_url?: string | null }> = [];
        if (cur?.slides) {
          try {
            const parsed = JSON.parse(cur.slides);
            if (Array.isArray(parsed)) {
              slides = parsed.filter((s) => s && typeof s === 'object');
            } else if (parsed && typeof parsed === 'object') {
              // Legacy keyed-map shape from an earlier draft — convert.
              for (const [t, v] of Object.entries(parsed)) {
                slides.push({ title: t, body: typeof v === 'string' ? v : '' });
              }
            }
          } catch { /* malformed slides — overwrite */ }
        }
        const idx = slides.findIndex((s) => String(s.title || '').trim().toLowerCase() === slideTitle.toLowerCase());
        const merged = { title: slideTitle, subtitle: null, body: value, bullets: [] as string[], image_url: null };
        if (idx >= 0) {
          slides[idx] = { ...slides[idx], ...merged };
        } else {
          slides.push(merged);
        }
        const slidesJson = JSON.stringify(slides);
        if (cur?.id) {
          await env.DB.prepare(`UPDATE pitch_decks SET slides = ? WHERE id = ?`).bind(slidesJson, cur.id).run();
          return { status: 'saved', saved_to: { table: 'pitch_decks', column: 'slides', id: cur.id, page_url: '/build/deck' } };
        }
        const ins = await env.DB.prepare(
          `INSERT INTO pitch_decks (project_id, version, slides, title, is_current, created_by) VALUES (?, 1, ?, ?, 1, ?)`,
        ).bind(ctx.project_id, slidesJson, 'Draft', user.id).run();
        const newId = Number((ins as { meta?: { last_row_id?: number } }).meta?.last_row_id || 0);
        return { status: 'saved', saved_to: { table: 'pitch_decks', column: 'slides', id: newId || undefined, page_url: '/build/deck' } };
      } catch (e) {
        return { status: 'failed', error: (e as Error).message };
      }
    }
    // Side-effect (best-effort): a freshly-created project counts as
    // the Spin-Out Lab "project_created" milestone. Fired once on
    // first project rename so the lab unlocks Week-2 features
    // without the founder having to re-trigger from the lab page.
    // INSERT OR IGNORE is idempotent — see routes/spinout_lab.ts.
    if (questionId === 'founder.project.name') {
      try {
        await recordSpinoutMilestoneAndAdvance(env, user.id, 'project_created', 1);
      } catch { /* milestones table may not exist on legacy dev DBs */ }
    }
    // Brand basics + incorporation milestones are also Spin-Out Lab
    // gating signals — feeding them through the auto-advance helper
    // keeps users.spinout_lab_week in lockstep with milestone writes.
    // Question IDs here MUST match the bank in
    // services/advisor/banks/newFounderSpinout.ts; mismatches would
    // silently fail to advance the week.
    if (questionId === 'founder.brand.tagline' || questionId === 'founder.brand.theme_color') {
      try { await recordSpinoutMilestoneAndAdvance(env, user.id, 'brand_basics_filled', 2); } catch { /* legacy dev */ }
    }
    // The new-founder bank's legal/incorporation question is
    // `founder.captable.entity` (page_target /legal/incorporation).
    if (questionId === 'founder.captable.entity') {
      try { await recordSpinoutMilestoneAndAdvance(env, user.id, 'incorporation_completed', 4); } catch { /* legacy dev */ }
    }
    // Roadmap OKR slot completion → 'okrs_created' milestone (Week 2).
    if (/^founder\.okrs\.q1_objective[1-3]$/.test(questionId)) {
      try { await recordSpinoutMilestoneAndAdvance(env, user.id, 'okrs_created', 2); } catch { /* legacy dev */ }
    }
    // Pitch deck draft seeds → 'pitch_deck_drafted' milestone (Week 2).
    if (questionId === 'founder.deck.problem' || questionId === 'founder.deck.market') {
      try { await recordSpinoutMilestoneAndAdvance(env, user.id, 'pitch_deck_drafted', 2); } catch { /* legacy dev */ }
    }
    // Side-effect (best-effort): bump projects.updated_at on every
    // founder write so the e-sign contract auto-fill (which keys its
    // merge-field cache on `updated_at`) reflects fresh values on
    // the next /api/esign/contracts/:id/send call.
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
      // Task #3 (AS) — financials + capital + cap-table columns
      // added by migration 042. The catch-block below silently
      // falls through to the advisor_extras_json fallback if the
      // column hasn't been migrated yet on this DB.
      'founder.financials.runway_months':    'runway_months',
      'founder.financials.monthly_burn_usd': 'monthly_burn_usd',
      'founder.financials.mrr_usd':          'mrr_usd',
      'founder.capital.raise_active':        'raise_active',
      'founder.capital.raise_target_usd':    'raise_target_usd',
      'founder.captable.entity':             'entity_label',
    };
    const column = colMap[questionId];
    // Task #3 (AS) — free-form founder fields that don't have a
    // canonical column land in projects.advisor_extras_json keyed by
    // question_id. Covers compliance.status, captable.ownership,
    // mentors.needs, team.cofounders, pipeline.top_deals.
    const FOUNDER_EXTRAS = new Set<string>([
      'founder.captable.ownership',
      'founder.compliance.status',
      'founder.mentors.needs',
      'founder.team.cofounders',
      'founder.pipeline.top_deals',
    ]);
    if (!column) {
      if (FOUNDER_EXTRAS.has(questionId)) {
        const ok = await mergeProjectExtras(env, ctx.project_id, questionId, value);
        if (!ok) return { status: 'failed', error: 'could not persist extras' };
        return {
          status: 'saved',
          saved_to: { table: 'projects', column: 'advisor_extras_json', id: ctx.project_id, page_url: q.page_target || `/projects/${ctx.project_id}` },
        };
      }
      return { status: 'noop' };
    }
    // Coerce numerics for the new financial columns so they store as
    // REAL/INTEGER instead of TEXT.
    let dbValue: string | number = value;
    if (column === 'runway_months') {
      const n = parseInt(value.replace(/[^0-9-]/g, ''), 10);
      dbValue = Number.isFinite(n) ? n : value;
    } else if (column === 'monthly_burn_usd' || column === 'mrr_usd' || column === 'raise_target_usd') {
      const n = parseFloat(value.replace(/[^0-9.\-]/g, ''));
      dbValue = Number.isFinite(n) ? n : value;
    }
    try {
      await env.DB.prepare(
        `UPDATE projects SET ${column} = ?, updated_at = datetime('now') WHERE id = ? AND founder_id = ?`,
      ).bind(dbValue, ctx.project_id, ctx.founder_id).run();
      return {
        status: 'saved',
        saved_to: { table: 'projects', column, id: ctx.project_id, page_url: q.page_target || `/projects/${ctx.project_id}` },
      };
    } catch (e) {
      // Column may not be migrated yet on this dev DB — fall back
      // to advisor_extras_json so the value isn't lost.
      const ok = await mergeProjectExtras(env, ctx.project_id, questionId, value);
      if (ok) {
        return {
          status: 'saved',
          saved_to: { table: 'projects', column: 'advisor_extras_json', id: ctx.project_id, page_url: q.page_target || `/projects/${ctx.project_id}` },
          hint: 'Saved as a chat note (column not yet migrated).',
        };
      }
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
      // Task #3 (AS) — pipeline / coinvest / seed-watchlist columns
      // added by migration 042. The columns may be missing on
      // legacy dev DBs — the catch below falls through to noop.
      'investor.pipeline.deal_volume':       { col: 'deal_volume_band' },
      'investor.coinvest.preferences':       { col: 'coinvest_pref_text' },
      'investor.watchlist.seed_companies':   { col: 'watchlist_seed_text' },
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
      // Column may not be migrated yet on legacy dev DBs — fall back
      // to users.advisor_extras_json so the value isn't lost.
      const ok = await mergeUserExtras(env, user.id, questionId, value);
      if (ok) {
        return {
          status: 'saved',
          saved_to: { table: 'users', column: 'advisor_extras_json', id: user.id, page_url: '/investor-profile' },
          hint: 'Saved as a chat note (column not yet migrated).',
        };
      }
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
      // Task #3 (AS) — topics + calendar columns added by migration 042.
      'mentor.topics.willing':          { col: 'topics_willing_json',   coerce: (v) => JSON.stringify(parseList(v)) },
      'mentor.topics.unwilling':        { col: 'topics_unwilling_json', coerce: (v) => JSON.stringify(parseList(v)) },
      'mentor.calendar.weekly_hours':   { col: 'weekly_hours_band' },
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
      // Column may not be migrated yet on legacy dev DBs — fall back
      // to users.advisor_extras_json sidecar.
      const ok = await mergeUserExtras(env, user.id, questionId, value);
      if (ok) {
        return {
          status: 'saved',
          saved_to: { table: 'users', column: 'advisor_extras_json', id: user.id, page_url: '/mentors/me' },
          hint: 'Saved as a chat note (column not yet migrated).',
        };
      }
      return { status: 'failed', error: (e as Error).message };
    }
  }

  // ---- Partner bank ---------------------------------------------------
  if (q.persona === 'partner') {
    const pole = String(user.role || '');
    if (pole !== 'partner' && pole !== 'admin') {
      return { status: 'failed', error: 'partner questions require partner role' };
    }
    // Special case: partner.profile.focus is cross-deal so it lives
    // on users.advisor_extras_json instead of a single partner_profile.
    if (questionId === 'partner.profile.focus') {
      const okFocus = await mergeUserExtras(env, user.id, questionId, value);
      if (okFocus) {
        return {
          status: 'saved',
          saved_to: { table: 'users', column: 'advisor_extras_json', id: user.id, page_url: '/partner-portal' },
        };
      }
      // Fallback: stash on partner_profiles.raw_chat_json so the
      // answer isn't lost on a dev DB without users.advisor_extras_json.
      const profile = await ensurePartnerProfile(env, user);
      if (profile) {
        try {
          await env.DB.prepare(
            `UPDATE partner_profiles SET raw_chat_json = json_set(COALESCE(raw_chat_json,'{}'), '$.' || ?, ?) WHERE id = ?`,
          ).bind('partner_profile_focus', value, profile.id).run();
          return {
            status: 'saved',
            saved_to: { table: 'partner_profiles', column: 'raw_chat_json', id: profile.id, page_url: '/partner-portal' },
            hint: 'Saved as a chat note (column not yet migrated).',
          };
        } catch { /* fall through */ }
      }
      return { status: 'failed', error: 'could not persist focus' };
    }
    const profile = await ensurePartnerProfile(env, user);
    if (!profile) {
      return { status: 'noop', hint: 'Partner profile not bound yet — accept your invitation from the Partner Portal first.' };
    }
    const partnerMap: Record<string, string> = {
      'partner.firm.name':         'organization',
      'partner.role.kind':         'role_title',
      'partner.services.offered':  'services_offered',
      'partner.deals.interest':    'motivation',
      'partner.dealflow.channels': 'dealflow_channels',
      'partner.conflicts.list':    'conflicts_text',
    };
    const pcol = partnerMap[questionId];
    if (!pcol) return { status: 'noop' };
    try {
      await env.DB.prepare(
        `UPDATE partner_profiles SET ${pcol} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(value, profile.id).run();
      return {
        status: 'saved',
        saved_to: { table: 'partner_profiles', column: pcol, id: profile.id, page_url: '/partner-portal' },
      };
    } catch (e) {
      // Column may not be migrated on legacy dev — fall back to
      // raw_chat_json so the value isn't lost.
      try {
        await env.DB.prepare(
          `UPDATE partner_profiles SET raw_chat_json = json_set(COALESCE(raw_chat_json,'{}'), '$.' || ?, ?) WHERE id = ?`,
        ).bind(questionId.replace(/[^a-zA-Z0-9_]/g, '_'), value, profile.id).run();
        return {
          status: 'saved',
          saved_to: { table: 'partner_profiles', column: 'raw_chat_json', id: profile.id, page_url: '/partner-portal' },
          hint: 'Saved as a chat note (column not yet migrated).',
        };
      } catch {
        return { status: 'failed', error: (e as Error).message };
      }
    }
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
        `SELECT id, name, description, sector, stage, growth_signals
           FROM projects WHERE founder_id = ?
           ORDER BY updated_at DESC, id DESC LIMIT 1`,
      ).bind(user.founder_id).first<{ id: number; name: string | null; description: string | null; sector: string | null; stage: string | null; growth_signals: string | null }>().catch(() => null);
      if (proj) {
        if (proj.name && proj.name !== '(unnamed project)') answered.add('founder.project.name');
        if (proj.description) answered.add('founder.project.pitch');
        if (proj.sector)      answered.add('founder.project.sector');
        if (proj.stage && proj.stage !== 'idea') answered.add('founder.project.stage');
        if (proj.growth_signals) answered.add('founder.project.traction');

        // ---- AC-2 hydration: advisor-slot domain reads -------------
        // Discovery interview slots (advisor:interview1..3) → mark
        // both name + pains questions answered when their row exists
        // and the corresponding column is populated.
        try {
          const rows = await env.DB.prepare(
            `SELECT interviewee_role, interviewee_name, pains_json
               FROM discovery_interviews
               WHERE project_id = ? AND interviewee_role LIKE 'advisor:interview%'`,
          ).bind(proj.id).all<{ interviewee_role: string; interviewee_name: string | null; pains_json: string | null }>().catch(() => ({ results: [] as Array<{ interviewee_role: string; interviewee_name: string | null; pains_json: string | null }> }));
          for (const r of rows.results || []) {
            const m = /^advisor:interview([1-3])$/.exec(r.interviewee_role);
            if (!m) continue;
            const n = m[1];
            if (r.interviewee_name && r.interviewee_name !== '(unnamed)') answered.add(`founder.discovery.interview${n}.name`);
            if (r.pains_json && r.pains_json !== '[]') answered.add(`founder.discovery.interview${n}.pains`);
          }
        } catch { /* discovery_interviews may not exist in legacy dev */ }

        // Roadmap OKR slots (advisor:q1_obj1..3).
        try {
          const rows = await env.DB.prepare(
            `SELECT quarter, objective FROM roadmap_okrs
               WHERE project_id = ? AND quarter LIKE 'advisor:q1_obj%'`,
          ).bind(proj.id).all<{ quarter: string; objective: string | null }>().catch(() => ({ results: [] as Array<{ quarter: string; objective: string | null }> }));
          for (const r of rows.results || []) {
            const m = /^advisor:q1_obj([1-3])$/.exec(r.quarter);
            if (m && r.objective) answered.add(`founder.okrs.q1_objective${m[1]}`);
          }
        } catch { /* roadmap_okrs may not exist */ }

        // Brand basics (landing_pages tagline + theme_color). Default
        // theme_color is '#7c3aed', so only count it as answered if
        // it was changed.
        try {
          const lp = await env.DB.prepare(
            `SELECT tagline, theme_color FROM landing_pages WHERE project_id = ?`,
          ).bind(proj.id).first<{ tagline: string | null; theme_color: string | null }>().catch(() => null);
          if (lp?.tagline) answered.add('founder.brand.tagline');
          // theme_color is non-null on every landing_pages row (the
          // table default is '#7c3aed'). We treat the question as
          // answered whenever a row exists with a non-empty value —
          // including the default — so a founder who intentionally
          // accepts the default purple isn't re-prompted on restart.
          if (lp?.theme_color) answered.add('founder.brand.theme_color');
        } catch { /* landing_pages may not exist */ }

        // Deck-draft seed: mark Problem / Market answered when the
        // current pitch_decks row has a slide with that title and a
        // non-empty body.
        try {
          const deck = await env.DB.prepare(
            `SELECT slides FROM pitch_decks
               WHERE project_id = ? AND is_current = 1
               ORDER BY version DESC LIMIT 1`,
          ).bind(proj.id).first<{ slides: string | null }>().catch(() => null);
          if (deck?.slides) {
            try {
              const parsed = JSON.parse(deck.slides);
              if (Array.isArray(parsed)) {
                for (const s of parsed) {
                  if (!s || typeof s !== 'object') continue;
                  const t = String(s.title || '').trim().toLowerCase();
                  const body = String(s.body || '').trim();
                  if (!body) continue;
                  if (t === 'problem') answered.add('founder.deck.problem');
                  if (t === 'market')  answered.add('founder.deck.market');
                }
              }
            } catch { /* malformed slides — skip */ }
          }
        } catch { /* pitch_decks may not exist */ }
      }
    }
  }

  if (role === 'investor' || role === 'admin') {
    // Task #3 (AS) — also read the new pipeline / coinvest / watchlist
    // columns. Use SELECT * + column-existence check so legacy dev
    // DBs without migration 042 still hydrate the base columns.
    const inv = await env.DB.prepare(
      `SELECT * FROM investor_profiles WHERE user_id = ?`,
    ).bind(user.id).first<Record<string, unknown>>().catch(() => null);
    if (inv) {
      if (inv.investor_type) answered.add('investor.profile.investor_type');
      if (inv.sectors_json && inv.sectors_json !== '[]') answered.add('investor.profile.sectors');
      if (inv.stages_json  && inv.stages_json  !== '[]') answered.add('investor.profile.stages');
      if (inv.ticket_band)   answered.add('investor.profile.ticket_band');
      if (inv.thesis_text)   answered.add('investor.profile.thesis');
      if (inv.deal_volume_band)    answered.add('investor.pipeline.deal_volume');
      if (inv.coinvest_pref_text)  answered.add('investor.coinvest.preferences');
      if (inv.watchlist_seed_text) answered.add('investor.watchlist.seed_companies');
    }
  }

  if (role === 'mentor' || role === 'admin') {
    const m = await env.DB.prepare(
      `SELECT * FROM mentors WHERE user_id = ?`,
    ).bind(user.id).first<Record<string, unknown>>().catch(() => null);
    if (m) {
      if (m.display_name && m.display_name !== (user.name || user.email)) answered.add('mentor.profile.display_name');
      if (m.bio) answered.add('mentor.profile.bio');
      if (m.sectors_json && m.sectors_json !== '[]')   answered.add('mentor.profile.sectors');
      if (m.expertise_json && m.expertise_json !== '[]') answered.add('mentor.profile.expertise');
      if (m.hourly_rate_usd != null) answered.add('mentor.profile.hourly_rate_usd');
      if (m.linkedin_url)  answered.add('mentor.profile.linkedin_url');
      // Task #3 (AS) — topics / calendar.
      if (m.topics_willing_json && m.topics_willing_json !== '[]')     answered.add('mentor.topics.willing');
      if (m.topics_unwilling_json && m.topics_unwilling_json !== '[]') answered.add('mentor.topics.unwilling');
      if (m.weekly_hours_band) answered.add('mentor.calendar.weekly_hours');
    }
  }

  // Task #3 (AS) — partner bank hydration via partner_profiles.
  if (role === 'partner' || role === 'admin') {
    try {
      const p = await env.DB.prepare(
        `SELECT * FROM partner_profiles WHERE user_id = ? LIMIT 1`,
      ).bind(user.id).first<Record<string, unknown>>().catch(() => null);
      if (p) {
        if (p.organization)      answered.add('partner.firm.name');
        if (p.role_title)        answered.add('partner.role.kind');
        if (p.services_offered)  answered.add('partner.services.offered');
        if (p.motivation)        answered.add('partner.deals.interest');
        if (p.dealflow_channels) answered.add('partner.dealflow.channels');
        if (p.conflicts_text)    answered.add('partner.conflicts.list');
      }
    } catch { /* partner_profiles missing on dev */ }
    try {
      const u = await env.DB.prepare(
        `SELECT advisor_extras_json FROM users WHERE id = ?`,
      ).bind(user.id).first<{ advisor_extras_json: string | null }>().catch(() => null);
      if (u?.advisor_extras_json) {
        try {
          const parsed = JSON.parse(u.advisor_extras_json) as Record<string, unknown>;
          if (parsed && typeof parsed === 'object') {
            for (const k of Object.keys(parsed)) {
              if (k.startsWith('partner.') && parsed[k]) answered.add(k);
            }
          }
        } catch { /* malformed — ignore */ }
      }
    } catch { /* users.advisor_extras_json not migrated */ }
  }

  return answered;
}
