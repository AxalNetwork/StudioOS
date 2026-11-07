/**
 * D4160 (#4160) — publishing a skill's draft as a new immutable version, in
 * one place: `POST /api/teams/skills/:uid/publish` (D1612) and HQ's bulk
 * publish (`routes/admin_hq_skills.ts`) both call `publishDraft`.
 *
 * In order: a retired skill is refused (409 `retired`); the draft is checked
 * as every save is (`checkDraft`, 400 with its code); an HQ skill must pass
 * `publishRefusal` (409 `needs_approval`, `golden_cases_failing`); then the
 * version row and the pointer land together, guarded on `current_version`
 * (409 `publish_conflict`). A company publish also clears HQ's open flag or
 * suspension in that same batch (D4161, `clearOnRepublish`). An HQ publish
 * writes the admin audit row.
 *
 * Who may publish is the caller's check (`mayWrite` in team_skills, Super
 * Admin in HQ's routes); this file does not decide it.
 */
import type { Env, User } from '../../types';
import { ROLES } from './catalogue';
import { checkDraft, toSkillMd, type OutputKind, type Tag } from './skills';
import { publishRefusal, type DraftParts } from './skillLifecycle';
import { clearOnRepublish } from './skillModeration';
import type { SkillRow } from './skillLinks';
import { contextTokensOf } from './runCost';
import { logAdminAction } from '../adminAudit';

const parse = <T>(json: string | null | undefined, fallback: T): T => { try { const v = JSON.parse(json ?? ''); return v ?? fallback; } catch { return fallback; } };
const ROLE_KEYS = new Set(ROLES.map((r) => r.key));

/** The draft's parts, from `agent_skills` and its tag and role rows. */
export async function draftPartsOf(env: Env, s: SkillRow): Promise<DraftParts> {
  const tags = (await env.DB.prepare('SELECT taxonomy_skill_slug AS slug, level FROM agent_skill_tags WHERE skill_id = ? ORDER BY rowid').bind(s.id).all<Tag>()).results ?? [];
  const roles = ((await env.DB.prepare('SELECT role_key FROM agent_skill_roles WHERE skill_id = ? ORDER BY rowid').bind(s.id).all<{ role_key: string }>()).results ?? []).map((r) => r.role_key);
  return draftParts(s, tags, roles);
}

export function draftParts(s: SkillRow, tags: Tag[], roles: string[]): DraftParts {
  return { name: s.name, purpose: s.purpose, steps: parse(s.steps_json, []), tools: parse(s.allowed_tools_json, []), output_kind: s.output_kind as OutputKind, tags, roles };
}

export async function liveTaxonomy(env: Env): Promise<Set<string>> {
  const rows = (await env.DB.prepare('SELECT slug FROM skills WHERE is_active = 1').all<{ slug: string }>()).results ?? [];
  return new Set(rows.map((r) => r.slug));
}

export type PublishResult =
  | { ok: true; version: number; skill_md: string }
  | { ok: false; status: number; code: string; message: string; extra?: Record<string, unknown> };

export async function publishDraft(env: Env, s: SkillRow, user: User, reason: string | null = null): Promise<PublishResult> {
  if (s.status === 'retired') return { ok: false, status: 409, code: 'retired', message: 'A retired skill cannot be published again.' };
  const d = await draftPartsOf(env, s);
  const checked = checkDraft({ ...d, slug: s.slug }, { taxonomy: await liveTaxonomy(env), roleKeys: ROLE_KEYS });
  if (!checked.ok) return { ok: false, status: 400, code: checked.code, message: checked.message, ...(checked.tool ? { extra: { tool: checked.tool } } : {}) };
  if (s.scope === 'hq') {
    const no = await publishRefusal(env, s.id, d);
    if (no) return { ok: false, status: no.status, code: no.code, message: no.message, extra: no.extra };
  }
  const version = s.current_version + 1;
  const md = toSkillMd(checked.draft, version);
  // The version row and the pointer land together, or neither does; the
  // `current_version = ?` guard refuses a concurrent publish of the same number.
  const res = await env.DB.batch([
    env.DB.prepare(`UPDATE agent_skills SET status = 'published', current_version = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND current_version = ?`).bind(version, user.id, s.id, s.current_version),
    env.DB.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(s.id, version, md, d.name, d.purpose, JSON.stringify(d.steps), JSON.stringify(d.tools), d.output_kind,
      JSON.stringify(checked.draft.tags), JSON.stringify(checked.draft.roles), user.id),
    // D4121: what the version adds to a run that uses it: its prompt, as the run path joins it.
    env.DB.prepare('INSERT OR REPLACE INTO agent_skill_version_costs (skill_id, version, context_tokens) VALUES (?, ?, ?)').bind(s.id, version, contextTokensOf({
      version, name: d.name, purpose: d.purpose, steps_json: JSON.stringify(d.steps), allowed_tools_json: JSON.stringify(d.tools),
      output_kind: d.output_kind, roles_json: JSON.stringify(checked.draft.roles),
    })),
    // D4161: a company's new version starts clean of HQ's flag or suspension.
    ...(s.scope === 'company' ? [clearOnRepublish(env, s.id, version, user.id)] : []),
  ]).catch(() => null);
  if (!res || Number(res[0]?.meta?.changes ?? 0) !== 1) return { ok: false, status: 409, code: 'publish_conflict', message: 'This skill was published by someone else just now. Reload it and try again.' };
  if (s.scope === 'hq') {
    await logAdminAction(env, user.id, user.email, 'agent_skill_published', {
      skill_uid: s.uid, skill_name: d.name, reason,
      before: { status: s.status, version: s.current_version || null }, after: { status: 'published', version },
    });
  }
  return { ok: true, version, skill_md: md };
}
