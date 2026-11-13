/**
 * D4158 (#4158, H1 of #4137) — HQ › AI agents › Roster: what a Super Admin
 * sets behind each of the 16 personas, and what teams see because of it.
 *
 * The personas are code (`personas.ts`, D4117). HQ may change only:
 *   - status: offered (in the Add-agent gallery), hidden (out of the gallery;
 *     teams that have the persona keep it), retired (out of the gallery, and
 *     its live agents are paused with `persona_retired` in the same batch, so
 *     it stops running at once; open proposals stay decidable, because pausing
 *     withdraws nothing);
 *   - identity: name, tagline, story, goal and avatar, laid over the
 *     catalogue's words (a rename needs `trademark_checked: true`);
 *   - team defaults: the model and monthly cap a team starts with, and the
 *     highest cap a team may set.
 * Values, risk and natural fit are never writable: a body naming one is
 * `values_fixed`. Every change takes a reason of at least 10 characters and
 * writes one `ai_admin_audit` row (H5, D4163) in the same batch.
 *
 * Stored in `ai_persona_settings` (migration 202611022304); a persona with no
 * row is offered, wears its catalogue identity and has no defaults. A usage
 * figure no store holds is `null` ("Not recorded"), never 0. No answer carries
 * an email.
 */
import type { Env } from '../../types';
import { PERSONAS, personaDto, personaOf, type Persona } from './personas';
import { aiAdminAuditStatement } from './adminAudit';

export const PERSONA_STATUSES = ['offered', 'hidden', 'retired'] as const;
export type PersonaStatus = typeof PERSONA_STATUSES[number];
/** The reason an agent is paused when its persona is retired (#3727's vocabulary, `engine.ts` PAUSE_REASONS). */
export const RETIRED_PAUSE = 'persona_retired';
export const REASON_MIN = 10;
export const REASON_MAX = 500;
/** The highest monthly cap anything may hold, the team routes' own ceiling. H4 (#4162) tightens it with the platform maximum. */
export const PLATFORM_CAP_MAX_MICROUSD = 1_000_000_000_000;
/** What a roster write may never name: who the persona is (D4137 §4, "values are fixed"). */
export const FIXED_FIELDS = ['values', 'top_values', 'risk', 'natural_fit'] as const;
/** The identity fields a Super Admin may change, with their longest length. */
export const IDENTITY_LIMITS = { name: 40, tagline: 160, story: 1200, goal: 160, avatar: 200 } as const;
export type IdentityKey = keyof typeof IDENTITY_LIMITS;
const IDENTITY_KEYS = Object.keys(IDENTITY_LIMITS) as IdentityKey[];
const USAGE_DAYS = 30;

/** A refusal in our own words: `sentence` is written for the admin reading it, never raw error text. */
export class RosterRefusal extends Error {
  status: 400 | 404 | 409 | 422;
  code: string;
  sentence: string;
  extra: Record<string, unknown>;
  constructor(status: 400 | 404 | 409 | 422, code: string, sentence: string, extra: Record<string, unknown> = {}) {
    super(sentence);
    this.status = status; this.code = code; this.sentence = sentence; this.extra = extra;
  }
}
const refuse = (status: 400 | 404 | 409 | 422, code: string, message: string, extra: Record<string, unknown> = {}): never => {
  throw new RosterRefusal(status, code, message, extra);
};

export type SettingsRow = {
  persona_key: string; status: PersonaStatus; name: string | null; tagline: string | null; story: string | null; goal: string | null;
  avatar: string | null; name_checked_by: number | null; name_checked_at: string | null; default_model_id: string | null;
  start_cap_microusd: number | null; max_cap_microusd: number | null; updated_by: number | null; updated_at: string;
};

/**
 * Every persona's stored settings. A database built before migration
 * 202611022304 has no table: that is "nothing set", the same as no row. Any
 * other failure is thrown, so a hidden persona never reappears because a read
 * failed.
 */
export async function loadPersonaSettings(env: Env): Promise<Map<string, SettingsRow>> {
  try {
    const rs = await env.DB.prepare('SELECT * FROM ai_persona_settings').all<SettingsRow>();
    return new Map((rs.results ?? []).map((r) => [r.persona_key, r]));
  } catch (e) {
    if (/no such table/i.test(String((e as Error)?.message))) return new Map();
    throw e;
  }
}

export const statusOf = (s: SettingsRow | undefined): PersonaStatus => s?.status ?? 'offered';
const usd = (micro: number | null | undefined): number | null => (micro == null ? null : micro / 1_000_000);

/** The team defaults HQ set, in dollars; each null until set. */
export function defaultsOf(s: SettingsRow | undefined) {
  return { model: s?.default_model_id ?? null, start_cap_usd: usd(s?.start_cap_microusd), max_cap_usd: usd(s?.max_cap_microusd) };
}

/** A persona as teams see it: the catalogue with HQ's identity laid over it. Values, risk and natural fit are always the catalogue's. */
export function personaView(p: Persona, s: SettingsRow | undefined) {
  const base = personaDto(p);
  return {
    ...base,
    name: s?.name ?? base.name,
    tagline: s?.tagline ?? base.tagline,
    story: s?.story ?? base.story,
    goal: s?.goal ?? base.goal,
    avatar: s?.avatar ?? base.avatar,
  };
}

/** The personas the Add-agent gallery offers: offered ones only. A hidden or retired persona is not offered to a new team. */
export function galleryPersonas(settings: Map<string, SettingsRow>) {
  return PERSONAS.filter((p) => statusOf(settings.get(p.key)) === 'offered').map((p) => ({ ...personaView(p, settings.get(p.key)), defaults: defaultsOf(settings.get(p.key)) }));
}

// ─── Usage (last 30 days) ───────────────────────────────────────────────────

export type Usage = { teams: number | null; runs: number | null; spend_usd: number | null; accepted_pct: number | null; failed_pct: number | null };

const sinceDays = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/**
 * Each persona's 30-day usage, keyed by persona. A count that was read is a
 * count (0 included); a rate with nothing to rate, a spend with an unrecorded
 * charge, or a store that could not be read is null.
 */
export async function usageByPersona(env: Env, now = new Date()): Promise<Map<string, Usage>> {
  const since = sinceDays(now, USAGE_DAYS);
  const out = new Map<string, Usage>(PERSONAS.map((p) => [p.key, { teams: null, runs: null, spend_usd: null, accepted_pct: null, failed_pct: null }]));
  const each = async (sql: string, binds: unknown[], put: (u: Usage, r: any) => void, zero: (u: Usage) => void) => {
    try {
      const rs = await env.DB.prepare(sql).bind(...binds).all<any>();
      for (const u of out.values()) zero(u);
      for (const r of rs.results ?? []) { const u = out.get(r.persona_key); if (u) put(u, r); }
    } catch { /* stays null: Not recorded */ }
  };
  await each(
    `SELECT persona_key, COUNT(DISTINCT scope_kind || ':' || IFNULL(company_id, project_id)) AS n
       FROM team_agents WHERE status <> 'removed' AND persona_key IS NOT NULL GROUP BY persona_key`,
    [], (u, r) => { u.teams = Number(r.n); }, (u) => { u.teams = 0; },
  );
  await each(
    `SELECT a.persona_key, COUNT(*) AS n,
            SUM(CASE WHEN r.status IN ('done', 'refused', 'failed', 'step_lost', 'halted') THEN 1 ELSE 0 END) AS ended,
            SUM(CASE WHEN r.status IN ('failed', 'step_lost', 'halted') THEN 1 ELSE 0 END) AS failed
       FROM agent_task_runs r JOIN team_agents a ON a.id = r.agent_id
      WHERE r.created_at >= ? AND a.persona_key IS NOT NULL GROUP BY a.persona_key`,
    [since], (u, r) => { u.runs = Number(r.n); u.failed_pct = pct(Number(r.failed), Number(r.ended)); }, (u) => { u.runs = 0; },
  );
  // Spend is known only when every charge is: one unrecorded charge makes it null, never a smaller sum.
  await each(
    `SELECT a.persona_key, COUNT(*) AS n, COUNT(l.charged_microusd) AS known, SUM(l.charged_microusd) AS s
       FROM ai_usage_logs l JOIN team_agents a ON a.id = l.agent_id
      WHERE l.created_at >= ? AND a.persona_key IS NOT NULL GROUP BY a.persona_key`,
    [since], (u, r) => { u.spend_usd = Number(r.known) === Number(r.n) ? Number(r.s ?? 0) / 1_000_000 : null; }, () => { /* no charge: null */ },
  );
  await each(
    `SELECT a.persona_key,
            SUM(CASE WHEN p.status IN ('accepted', 'edited', 'discarded') THEN 1 ELSE 0 END) AS decided,
            SUM(CASE WHEN p.status IN ('accepted', 'edited') THEN 1 ELSE 0 END) AS accepted
       FROM ai_rail_proposals p JOIN team_agents a ON a.id = p.agent_id
      WHERE p.decided_at >= ? AND a.persona_key IS NOT NULL GROUP BY a.persona_key`,
    [since], (u, r) => { u.accepted_pct = pct(Number(r.accepted), Number(r.decided)); }, () => { /* nothing decided: null */ },
  );
  return out;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

function rosterRow(p: Persona, s: SettingsRow | undefined, usage: Usage | undefined) {
  return { ...personaView(p, s), status: statusOf(s), defaults: defaultsOf(s), usage: usage ?? { teams: null, runs: null, spend_usd: null, accepted_pct: null, failed_pct: null } };
}

/** SA1: the 16 personas, each with its status, defaults and 30-day usage, and the counts by status. */
export async function rosterList(env: Env, now = new Date()) {
  const settings = await loadPersonaSettings(env);
  const usage = await usageByPersona(env, now);
  const personas = PERSONAS.map((p) => rosterRow(p, settings.get(p.key), usage.get(p.key)));
  const counts = { total: personas.length, offered: 0, hidden: 0, retired: 0 };
  for (const r of personas) counts[r.status] += 1;
  return { personas, counts };
}

export type HistoryRow = { at: string; admin: { id: number; name: string | null }; action: string; before: unknown; after: unknown; reason: string };
const parse = (s: string | null): unknown => { if (s == null) return null; try { return JSON.parse(s); } catch { return null; } };

/** SA2: one persona, with the teams using it (company › project, by name), its most-used skills and its history. */
export async function rosterOne(env: Env, key: string, now = new Date()) {
  const p = personaOf(key);
  if (!p) refuse(404, 'not_found', 'There is no such agent in the roster.');
  const persona = p!;
  const settings = await loadPersonaSettings(env);
  const usage = await usageByPersona(env, now);
  const since = sinceDays(now, USAGE_DAYS);

  let teams: Array<{ kind: 'company' | 'project'; company: string | null; project: string | null; status: string }> | null = null;
  try {
    const rs = await env.DB.prepare(
      `SELECT a.scope_kind, a.status, cp.company_name, p.name AS project_name, pc.company_name AS project_company_name
         FROM team_agents a LEFT JOIN company_profiles cp ON cp.id = a.company_id
         LEFT JOIN projects p ON p.id = a.project_id LEFT JOIN company_profiles pc ON pc.id = p.company_id
        WHERE a.persona_key = ? AND a.status <> 'removed'
        ORDER BY COALESCE(cp.company_name, pc.company_name), p.name LIMIT 200`,
    ).bind(persona.key).all<any>();
    teams = (rs.results ?? []).map((r) => (r.scope_kind === 'company'
      ? { kind: 'company' as const, company: r.company_name ?? null, project: null, status: String(r.status) }
      : { kind: 'project' as const, company: r.project_company_name ?? null, project: r.project_name ?? null, status: String(r.status) }));
  } catch { teams = null; }

  let skills: Array<{ uid: string; name: string; runs: number }> | null = null;
  try {
    const rs = await env.DB.prepare(
      `SELECT s.uid, s.name, COUNT(r.id) AS runs
         FROM agent_task_runs r JOIN team_agents a ON a.id = r.agent_id
         JOIN agent_skill_links l ON l.agent_id = a.id JOIN agent_skills s ON s.id = l.skill_id
        WHERE a.persona_key = ? AND r.created_at >= ?
        GROUP BY s.id ORDER BY runs DESC, s.name LIMIT 5`,
    ).bind(persona.key, since).all<any>();
    skills = (rs.results ?? []).map((r) => ({ uid: String(r.uid), name: String(r.name), runs: Number(r.runs) }));
  } catch { skills = null; }

  let history: HistoryRow[] | null = null;
  try {
    const rs = await env.DB.prepare(
      `SELECT a.at, a.admin_user_id, u.name AS admin_name, a.action, a.before_json, a.after_json, a.reason
         FROM ai_admin_audit a LEFT JOIN users u ON u.id = a.admin_user_id
        WHERE a.area = 'roster' AND a.subject = ? ORDER BY a.id DESC LIMIT 50`,
    ).bind(`persona:${persona.key}`).all<any>();
    history = (rs.results ?? []).map((r) => ({
      at: String(r.at), admin: { id: Number(r.admin_user_id), name: r.admin_name ?? null }, action: String(r.action),
      before: parse(r.before_json), after: parse(r.after_json), reason: String(r.reason),
    }));
  } catch { history = null; }

  return { persona: { ...rosterRow(persona, settings.get(persona.key), usage.get(persona.key)), personality: persona.personality, teams, skills, history } };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/** The reason every write needs, trimmed, or a refusal. */
export function reasonOf(v: unknown): string {
  const r = typeof v === 'string' ? v.trim() : '';
  if (r.length < REASON_MIN) refuse(400, 'reason_required', `Say why, in at least ${REASON_MIN} characters.`, { min: REASON_MIN });
  if (r.length > REASON_MAX) refuse(400, 'reason_too_long', `A reason is at most ${REASON_MAX} characters.`, { max: REASON_MAX });
  return r;
}

/** A body naming a value, risk or natural fit is refused before anything else is read from it. */
function refuseFixed(b: Record<string, unknown>) {
  const named = FIXED_FIELDS.filter((k) => k in b);
  if (named.length) refuse(400, 'values_fixed', 'Values, risk and natural fit are part of who the agent is. They cannot be changed.', { fields: named });
}

const AVATAR = /^\/agents\/[a-z0-9-]{1,60}\.(webp|png)$/;

function identityValue(k: IdentityKey, v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) refuse(400, 'invalid_field', `The ${k} cannot be empty.`, { field: k });
  const s = (v as string).trim();
  if (s.length > IDENTITY_LIMITS[k]) refuse(400, 'invalid_field', `The ${k} is at most ${IDENTITY_LIMITS[k]} characters.`, { field: k });
  if (k === 'avatar' && !AVATAR.test(s)) refuse(400, 'invalid_field', 'The avatar is an image under /agents/, as a .webp or .png.', { field: k });
  if (k === 'name' && !/^\p{L}[\p{L}' -]*$/u.test(s)) refuse(400, 'invalid_field', 'A name is letters, with spaces, hyphens or apostrophes.', { field: k });
  return s;
}

const PATCH_KEYS = new Set<string>(['status', ...IDENTITY_KEYS, 'reason', 'trademark_checked']);

type Admin = { id: number };

/**
 * PATCH /roster/:key — status and identity. Returns the persona as SA2 reads
 * it. A value that matches what is already shown is no change; a body that
 * changes nothing is `no_change`.
 */
export async function patchPersona(env: Env, admin: Admin, key: string, b: Record<string, unknown>) {
  const p = personaOf(key);
  if (!p) refuse(404, 'not_found', 'There is no such agent in the roster.');
  const persona = p!;
  refuseFixed(b);
  const unknown = Object.keys(b).filter((k) => !PATCH_KEYS.has(k));
  if (unknown.length) refuse(400, 'invalid_field', `${unknown[0]} is not something the roster changes.`, { fields: unknown });
  const reason = reasonOf(b.reason);

  const settings = await loadPersonaSettings(env);
  const row = settings.get(persona.key);
  const shownNow = personaView(persona, row);
  const statusBefore = statusOf(row);

  let status: PersonaStatus = statusBefore;
  if ('status' in b) {
    if (!(PERSONA_STATUSES as readonly string[]).includes(b.status as string)) refuse(400, 'invalid_status', 'An agent is offered, hidden or retired.');
    status = b.status as PersonaStatus;
  }
  const identity: Partial<Record<IdentityKey, string>> = {};
  for (const k of IDENTITY_KEYS) {
    if (!(k in b)) continue;
    const v = identityValue(k, b[k]);
    if (v !== shownNow[k]) identity[k] = v;
  }
  if (identity.name !== undefined) {
    if (b.trademark_checked !== true) refuse(400, 'trademark_unchecked', 'A new name needs the trademark check first.');
    const clash = PERSONAS.find((o) => o.key !== persona.key && personaView(o, settings.get(o.key)).name.toLowerCase() === identity.name!.toLowerCase());
    if (clash) refuse(409, 'name_taken', 'Another agent already has that name.');
  }
  const changedStatus = status !== statusBefore;
  if (!changedStatus && !Object.keys(identity).length) refuse(400, 'no_change', 'Nothing here differs from what teams see now.');

  // The stored override: a field set back to the catalogue's own words clears its override.
  const next = (k: IdentityKey): string | null => {
    const v = identity[k] ?? row?.[k] ?? null;
    return v === (personaDto(persona) as Record<string, unknown>)[k] ? null : v;
  };
  const renamed = identity.name !== undefined;
  const stmts = [
    env.DB.prepare(
      `INSERT INTO ai_persona_settings (persona_key, status, name, tagline, story, goal, avatar, name_checked_by, name_checked_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(persona_key) DO UPDATE SET
         status = excluded.status, name = excluded.name, tagline = excluded.tagline, story = excluded.story, goal = excluded.goal,
         avatar = excluded.avatar,
         name_checked_by = CASE WHEN ? = 1 THEN excluded.name_checked_by ELSE ai_persona_settings.name_checked_by END,
         name_checked_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE ai_persona_settings.name_checked_at END,
         updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      persona.key, status, next('name'), next('tagline'), next('story'), next('goal'), next('avatar'),
      renamed ? admin.id : null, renamed ? 1 : 0, admin.id, renamed ? 1 : 0, renamed ? 1 : 0,
    ),
  ];
  if (changedStatus) {
    stmts.push(aiAdminAuditStatement(env, {
      adminUserId: admin.id, action: `persona.${status === 'offered' ? 'offer' : status === 'hidden' ? 'hide' : 'retire'}`, area: 'roster',
      subject: `persona:${persona.key}`, before: { status: statusBefore }, after: { status }, reason,
    }));
  }
  if (Object.keys(identity).length) {
    const before = Object.fromEntries(Object.keys(identity).map((k) => [k, shownNow[k as IdentityKey]]));
    stmts.push(aiAdminAuditStatement(env, {
      adminUserId: admin.id, action: renamed ? 'persona.rename' : 'persona.identity', area: 'roster',
      subject: `persona:${persona.key}`, before, after: { ...identity, ...(renamed ? { trademark_checked: true } : {}) }, reason,
    }));
  }
  if (changedStatus && status === 'retired') {
    // It stops running at once: every live agent wearing it is paused, with an event, in this batch.
    stmts.push(env.DB.prepare(
      `INSERT INTO team_agent_events (agent_id, actor_user_id, kind, detail_json)
       SELECT id, ?, 'paused', ? FROM team_agents WHERE persona_key = ? AND status = 'active'`,
    ).bind(admin.id, JSON.stringify({ reason: RETIRED_PAUSE }), persona.key));
    stmts.push(env.DB.prepare(
      `UPDATE team_agents SET status = 'paused', paused_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE persona_key = ? AND status = 'active'`,
    ).bind(RETIRED_PAUSE, persona.key));
  }
  await env.DB.batch(stmts);
  return rosterOne(env, persona.key);
}

/** A dollar figure with at most two decimals, above zero and within the platform ceiling, as micro-dollars. */
function capOf(field: string, v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) refuse(400, 'invalid_cap', `The ${field} is a dollar amount above zero.`, { field });
  const micro = Math.round((v as number) * 1_000_000);
  if (Math.abs(micro - Math.round((v as number) * 100) * 10_000) > 0) refuse(400, 'invalid_cap', `The ${field} is in dollars and cents.`, { field });
  if (micro > PLATFORM_CAP_MAX_MICROUSD) refuse(422, 'cap_above_platform', `The ${field} is above the platform maximum.`, { field, max_usd: PLATFORM_CAP_MAX_MICROUSD / 1_000_000 });
  return micro;
}

const DEFAULT_KEYS = new Set(['model', 'start_cap_usd', 'max_cap_usd', 'reason']);

/**
 * PUT /roster/:key/defaults — the model and monthly cap a team starts with,
 * and the highest cap a team may set. All three are sent; the starting cap is
 * never above the maximum. `modelOffered` is the router's offered-model check.
 */
export async function putDefaults(env: Env, admin: Admin, key: string, b: Record<string, unknown>, modelOffered: (id: string) => boolean) {
  const p = personaOf(key);
  if (!p) refuse(404, 'not_found', 'There is no such agent in the roster.');
  const persona = p!;
  refuseFixed(b);
  const unknown = Object.keys(b).filter((k) => !DEFAULT_KEYS.has(k));
  if (unknown.length) refuse(400, 'invalid_field', `${unknown[0]} is not a team default.`, { fields: unknown });
  const reason = reasonOf(b.reason);
  if (typeof b.model !== 'string' || !b.model.trim() || !modelOffered(b.model)) refuse(422, 'model_not_offered', 'That model is not offered. Choose one from the list.');
  const start = capOf('starting cap', b.start_cap_usd);
  const max = capOf('maximum cap', b.max_cap_usd);
  if (start > max) refuse(400, 'start_above_max', 'Teams cannot start above the maximum cap.');

  const settings = await loadPersonaSettings(env);
  const before = defaultsOf(settings.get(persona.key));
  const after = { model: b.model as string, start_cap_usd: start / 1_000_000, max_cap_usd: max / 1_000_000 };
  if (before.model === after.model && before.start_cap_usd === after.start_cap_usd && before.max_cap_usd === after.max_cap_usd) {
    refuse(400, 'no_change', 'These are already the defaults.');
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ai_persona_settings (persona_key, default_model_id, start_cap_microusd, max_cap_microusd, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(persona_key) DO UPDATE SET default_model_id = excluded.default_model_id, start_cap_microusd = excluded.start_cap_microusd,
         max_cap_microusd = excluded.max_cap_microusd, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
    ).bind(persona.key, after.model, start, max, admin.id),
    aiAdminAuditStatement(env, { adminUserId: admin.id, action: 'persona.defaults', area: 'roster', subject: `persona:${persona.key}`, before, after, reason }),
  ]);
  return rosterOne(env, persona.key);
}

/** Why a team may not take or keep this persona now, or null: the Add-agent gate. */
export function unavailable(s: SettingsRow | undefined): 'hidden' | 'retired' | null {
  const st = statusOf(s);
  return st === 'offered' ? null : st;
}

/** The highest monthly cap a team may set for this persona, in micro-dollars, or null when HQ set none. */
export const maxCapOf = (s: SettingsRow | undefined): number | null => s?.max_cap_microusd ?? null;
