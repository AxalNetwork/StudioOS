/**
 * D4533 step 5 (#4533) — recovering an Axal skill without rewriting its history: a prior immutable version's
 * definition restored as the DRAFT (`restoreDraft`), and the pins view (`pinsOf`): which live agents hold which
 * version, before anyone re-pins them.
 *
 * RESTORE IS A PROPOSAL, NOT A ROLLBACK. Nothing published moves: no version row is written or deleted, the
 * pointer (`current_version`) and the status stay, and no `agent_skill_links` row changes. The draft takes vK's
 * name, purpose, steps, tools, output kind, tags and roles, and the restorer becomes its author (`updated_by`), so
 * they cannot approve it. It reaches agents only as the NEXT integer version, through the same gate as any draft
 * (`publishDraft`): a new review on the current evidence (an approval releases one version, `approvalFor`), every
 * required cell evaluated, and 9 of 10. Agents move to it only when their team re-pins them
 * (`PUT /api/teams/agents/:uid/skills`, the team's managers, audited as `skills_changed` with the version before and
 * after, D4534).
 *
 * Refusals: 409 `retired`; 400 `version_unknown`; a definition today's rules no longer accept answers its
 * `checkDraft` code (400) and the draft is not touched; 409 `already_restored` when the draft already holds that
 * definition; 409 `draft_has_changes` when the draft holds unpublished edits and `discard_draft` is not true. A
 * discarded draft is written into the audit row in full, because the draft table is not a history.
 *
 * Who may call it is the route's check (Super Admin, HQ skills only). A company skill has no restore here.
 */
import type { Env, User } from '../../types';
import { ROLES } from './catalogue';
import { personaOf } from './personas';
import { checkDraft, type OutputKind } from './skills';
import { draftHash, releaseDecision, type DraftParts, type ReleaseDecision } from './skillLifecycle';
import { draftPartsOf, liveTaxonomy } from './skillPublish';
import { versionOf, type SkillRow, type VersionRow } from './skillLinks';
import { logAdminAction } from '../adminAudit';

const parse = <T>(json: string | null | undefined, fallback: T): T => { try { const v = JSON.parse(json ?? ''); return v ?? fallback; } catch { return fallback; } };
const ROLE_KEYS = new Set(ROLES.map((r) => r.key));

/** A published version's parts, in the draft's shape. */
export const versionParts = (v: VersionRow): DraftParts => ({
  name: v.name, purpose: v.purpose, steps: parse(v.steps_json, []), tools: parse(v.allowed_tools_json, []), output_kind: v.output_kind as OutputKind,
  tags: parse(v.taxonomy_json, []), roles: parse(v.roles_json, []),
});

export type RestoreOutcome =
  | { ok: true; from_version: number; current_version: number; next_version: number; definition_hash: string; discarded: boolean; freshness: ReleaseDecision }
  | { ok: false; status: number; code: string; message: string; extra?: Record<string, unknown> };

export async function restoreDraft(env: Env, s: SkillRow, admin: User, fromVersion: unknown, reason: string, discardDraft: boolean): Promise<RestoreOutcome> {
  if (s.status === 'retired') return { ok: false, status: 409, code: 'retired', message: 'A retired skill is not restored. Its replacement carries on.' };
  const k = typeof fromVersion === 'number' ? fromVersion : /^v?([1-9][0-9]{0,5})$/.exec(String(fromVersion ?? ''))?.[1];
  const v = k != null && Number.isSafeInteger(Number(k)) ? await versionOf(env, s.id, Number(k)) : null;
  if (!v) return { ok: false, status: 400, code: 'version_unknown', message: 'Restore a version this skill published (v1, v2, …).' };
  // Today's rules: a tag, role or tool no longer accepted refuses the restore, and the draft is not touched.
  const checked = checkDraft({ ...versionParts(v), slug: s.slug }, { taxonomy: await liveTaxonomy(env), roleKeys: ROLE_KEYS });
  if (!checked.ok) return { ok: false, status: 400, code: checked.code, message: `v${v.version} cannot be the draft as it was: ${checked.message}`, ...(checked.tool ? { extra: { tool: checked.tool } } : {}) };
  const d = checked.draft;
  const target: DraftParts = { name: d.name, purpose: d.purpose, steps: d.steps, tools: d.tools, output_kind: d.output_kind, tags: d.tags, roles: d.roles };
  const targetHash = await draftHash(target);
  const now = await draftPartsOf(env, s);
  const nowHash = await draftHash(now);
  if (nowHash === targetHash) return { ok: false, status: 409, code: 'already_restored', message: `The draft already holds v${v.version}'s definition.` };
  // Unpublished edits are not a history: they are discarded only when asked, and then kept in the audit row.
  const current = s.current_version > 0 ? await versionOf(env, s.id, s.current_version) : null;
  const unpublished = !current || nowHash !== await draftHash(versionParts(current));
  if (unpublished && !discardDraft) {
    return { ok: false, status: 409, code: 'draft_has_changes', message: 'The draft has changes that were never published. Restoring replaces them; send discard_draft: true to do so.', extra: { draft_hash: nowHash } };
  }
  const open = await env.DB.prepare("SELECT id FROM agent_skill_reviews WHERE skill_id = ? AND status = 'requested'").bind(s.id).first<{ id: number }>();
  await env.DB.batch([
    env.DB.prepare(`UPDATE agent_skills SET name = ?, purpose = ?, steps_json = ?, allowed_tools_json = ?, output_kind = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(d.name, d.purpose, JSON.stringify(d.steps), JSON.stringify(d.tools), d.output_kind, admin.id, s.id),
    env.DB.prepare('DELETE FROM agent_skill_tags WHERE skill_id = ?').bind(s.id),
    ...d.tags.map((t) => env.DB.prepare('INSERT INTO agent_skill_tags (skill_id, taxonomy_skill_slug, level) VALUES (?, ?, ?)').bind(s.id, t.slug, t.level)),
    env.DB.prepare('DELETE FROM agent_skill_roles WHERE skill_id = ?').bind(s.id),
    ...d.roles.map((r) => env.DB.prepare('INSERT INTO agent_skill_roles (skill_id, role_key) VALUES (?, ?)').bind(s.id, r)),
    // A review asked on the draft being replaced was asked about another definition.
    ...(open ? [env.DB.prepare("UPDATE agent_skill_reviews SET status = 'withdrawn', decided_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'requested'").bind(open.id)] : []),
  ]);
  await logAdminAction(env, admin.id, admin.email, 'agent_skill_restore_proposed', {
    skill_uid: s.uid, skill_name: s.name, reason, from_version: v.version, current_version: s.current_version, next_version: s.current_version + 1,
    before: { definition_hash: nowHash, ...(unpublished ? { discarded_draft: now } : {}) },
    after: { definition_hash: targetHash, restored_from: v.version },
    ...(open ? { withdrawn_review: true } : {}),
  });
  const fresh = (await env.DB.prepare('SELECT * FROM agent_skills WHERE id = ?').bind(s.id).first<SkillRow>())!;
  return {
    ok: true, from_version: v.version, current_version: s.current_version, next_version: s.current_version + 1, definition_hash: targetHash,
    discarded: unpublished, freshness: await releaseDecision(env, fresh, await draftPartsOf(env, fresh)),
  };
}

type PinRow = {
  uid: string; role_key: string; first_name: string | null; last_name: string | null; persona_key?: string | null; status: string;
  scope_kind: 'company' | 'project'; pinned: number; company_name: string | null; project_name: string | null;
};

/** The most agents the pins view lists; `agents_total` is always the whole count. */
export const PINS_MAX = 500;

/**
 * Who holds which version: each published version with its live agents, and the agents (name, role, team, pinned
 * version, whether a newer version is available). Read-only. A removed agent is not counted, as in `pinnedAgents`.
 */
export async function pinsOf(env: Env, s: SkillRow) {
  const versions = (await env.DB.prepare(`SELECT v.version, v.published_at,
      (SELECT COUNT(*) FROM agent_skill_links l JOIN team_agents a ON a.id = l.agent_id WHERE l.skill_id = v.skill_id AND l.version = v.version AND a.status <> 'removed') AS agents
    FROM agent_skill_versions v WHERE v.skill_id = ? ORDER BY v.version DESC`).bind(s.id).all<{ version: number; published_at: string; agents: number }>()).results ?? [];
  const rows = (await env.DB.prepare(`SELECT a.*, l.version AS pinned,
      COALESCE(c.company_name, pc.company_name) AS company_name, p.name AS project_name
    FROM agent_skill_links l JOIN team_agents a ON a.id = l.agent_id
      LEFT JOIN company_profiles c ON a.scope_kind = 'company' AND c.id = a.company_id
      LEFT JOIN projects p ON a.scope_kind = 'project' AND p.id = a.project_id
      LEFT JOIN company_profiles pc ON pc.id = p.company_id
    WHERE l.skill_id = ? AND a.status <> 'removed' ORDER BY l.version DESC, a.id LIMIT ?`).bind(s.id, PINS_MAX).all<PinRow>()).results ?? [];
  const total = versions.reduce((n, v) => n + Number(v.agents), 0);
  return {
    current_version: s.current_version || null,
    versions: versions.map((v) => ({ version: v.version, published_at: v.published_at, agents: Number(v.agents), current: v.version === s.current_version })),
    agents_total: total,
    agents: rows.map((a) => ({
      uid: a.uid, name: personaOf(a.persona_key)?.name || [a.first_name, a.last_name].filter(Boolean).join(' ') || null, role_key: a.role_key, status: a.status,
      team: { kind: a.scope_kind, company_name: a.company_name, project_name: a.project_name },
      pinned_version: a.pinned,
      // A retired skill offers no update: its agents keep their pin until their team moves them to the replacement.
      update_available: s.status !== 'retired' && a.pinned < s.current_version,
    })),
  };
}
