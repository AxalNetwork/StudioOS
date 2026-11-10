/**
 * D4160 (#4160) — publishing a skill's draft as a new immutable version, in
 * one place: `POST /api/teams/skills/:uid/publish` (D1612) and HQ's bulk
 * publish (`routes/admin_hq_skills.ts`) both call `publishDraft`.
 *
 * In order: a retired skill is refused (409 `retired`); the draft is checked
 * as every save is (`checkDraft`, 400 with its code); an HQ skill must pass
 * the release decision (409 `needs_approval`, `evaluation_incomplete`,
 * `golden_cases_failing`, each with `freshness`, D4533); then the version row,
 * with an HQ version's release-evidence manifest in its `evidence_json`, and
 * the pointer land together, guarded on `current_version` (409
 * `publish_conflict`). A company publish also clears HQ's open flag or
 * suspension in that same batch (D4161, `clearOnRepublish`). An HQ publish
 * writes the admin audit row.
 *
 * D4533 (B1): a version may carry the publisher's release note, written in the
 * same INSERT as the row (`agent_skill_versions.release_note`, migration
 * 202611092030) and so as immutable as the row. `releaseNoteOf` checks it;
 * none is NULL, never an empty string.
 *
 * Who may publish is the caller's check (`mayWrite` in team_skills, Super
 * Admin in HQ's routes); this file does not decide it.
 */
import type { Env, User } from '../../types';
import { ROLES } from './catalogue';
import { checkDraft, toSkillMd, type OutputKind, type Tag } from './skills';
import { manifestOf, publishRefusalOf, releaseEvidence, type DraftParts, type ReleaseDecision } from './skillLifecycle';
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

/** D4533 (B1): the longest release note a version keeps, once trimmed (the column's CHECK says the same). */
export const RELEASE_NOTE_MAX = 2000;

/** A publish body's `release_note`: absent, null or blank is no note; otherwise text of up to `RELEASE_NOTE_MAX` characters. */
export function releaseNoteOf(raw: unknown): { ok: true; note: string | null } | { ok: false; status: 400; code: string; message: string } {
  if (raw == null) return { ok: true, note: null };
  if (typeof raw !== 'string') return { ok: false, status: 400, code: 'release_note_invalid', message: 'A release note is text.' };
  const note = raw.replace(/\r\n?/g, '\n').trim();
  if (note.length > RELEASE_NOTE_MAX) return { ok: false, status: 400, code: 'release_note_too_long', message: `Keep the release note to ${RELEASE_NOTE_MAX} characters.` };
  return { ok: true, note: note || null };
}

export type PublishResult =
  | { ok: true; version: number; skill_md: string; manifest: ReturnType<typeof manifestOf> | null; freshness: ReleaseDecision | null }
  | { ok: false; status: number; code: string; message: string; extra?: Record<string, unknown> };

export async function publishDraft(env: Env, s: SkillRow, user: User, reason: string | null = null, releaseNote: string | null = null): Promise<PublishResult> {
  if (s.status === 'retired') return { ok: false, status: 409, code: 'retired', message: 'A retired skill cannot be published again.' };
  const d = await draftPartsOf(env, s);
  const checked = checkDraft({ ...d, slug: s.slug }, { taxonomy: await liveTaxonomy(env), roleKeys: ROLE_KEYS });
  if (!checked.ok) return { ok: false, status: 400, code: checked.code, message: checked.message, ...(checked.tool ? { extra: { tool: checked.tool } } : {}) };
  const version = s.current_version + 1;
  // D4533: an HQ draft is published on its release evidence, and the version keeps it. A company skill has no HQ gate and no manifest.
  let manifest: ReturnType<typeof manifestOf> | null = null;
  let freshness: ReleaseDecision | null = null;
  if (s.scope === 'hq') {
    const evidence = await releaseEvidence(env, s, d);
    freshness = evidence.decision;
    const no = publishRefusalOf(evidence.decision);
    if (no) return { ok: false, status: no.status, code: no.code, message: no.message, extra: no.extra };
    manifest = manifestOf(evidence, version);
  }
  const md = toSkillMd(checked.draft, version);
  // The version row and the pointer land together, or neither does; the
  // `current_version = ?` guard refuses a concurrent publish of the same number.
  const res = await env.DB.batch([
    env.DB.prepare(`UPDATE agent_skills SET status = 'published', current_version = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND current_version = ?`).bind(version, user.id, s.id, s.current_version),
    env.DB.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by, evidence_json, release_note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(s.id, version, md, d.name, d.purpose, JSON.stringify(d.steps), JSON.stringify(d.tools), d.output_kind,
      JSON.stringify(checked.draft.tags), JSON.stringify(checked.draft.roles), user.id, manifest ? JSON.stringify(manifest) : null, releaseNote),
    // D4121: what the version adds to a run that uses it: its prompt, as the run path joins it.
    env.DB.prepare('INSERT OR REPLACE INTO agent_skill_version_costs (skill_id, version, context_tokens) VALUES (?, ?, ?)').bind(s.id, version, contextTokensOf({
      version, name: d.name, purpose: d.purpose, steps_json: JSON.stringify(d.steps), allowed_tools_json: JSON.stringify(d.tools),
      output_kind: d.output_kind, roles_json: JSON.stringify(checked.draft.roles),
    })),
    // D4161: a company's new version starts clean of HQ's flag or suspension.
    ...(s.scope === 'company' ? [clearOnRepublish(env, s.id, version, user.id)] : []),
  ]).catch(() => null);
  if (!res || Number(res[0]?.meta?.changes ?? 0) !== 1) return { ok: false, status: 409, code: 'publish_conflict', message: 'This skill was published by someone else just now. Reload it and try again.' };
  // D4534: a company skill's publish is audited too, under its own action name.
  await logAdminAction(env, user.id, user.email, s.scope === 'hq' ? 'agent_skill_published' : 'company_skill_published', {
    skill_uid: s.uid, skill_name: d.name, reason, ...(s.scope === 'company' ? { company_id: s.company_id } : {}),
    before: { status: s.status, version: s.current_version || null }, after: { status: 'published', version },
    ...(manifest ? { evidence_hash: manifest.evidence_hash } : {}), release_note: releaseNote,
  });
  return { ok: true, version, skill_md: md, manifest, freshness };
}
