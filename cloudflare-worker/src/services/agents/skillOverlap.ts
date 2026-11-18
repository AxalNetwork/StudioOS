/** D4536 part 3: bounded, HQ-only suggestions for possible published skill overlap (#4536). */
import type { Env } from '../../types';
import type { CoverageRow } from './skillCoverage';
import { terms } from './skillDiscovery';
import { OUTPUT_KINDS } from './skills';

const MAX_SKILLS = 250;
const MAX_SUGGESTIONS = 20;
const MIN_SHARED = 3;
const MIN_SCORE = 0.30;

type StoredVersion = {
  uid: string;
  version: number | null;
  purpose: string | null;
  output_kind: string | null;
  taxonomy_json: string | null;
  roles_json: string | null;
};

function readArray(raw: string | null): unknown[] {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function comparable(row: StoredVersion, expected: number | undefined) {
  if (row.version == null || row.version !== expected || !row.purpose ||
      !OUTPUT_KINDS.some((kind) => kind === row.output_kind)) return null;
  const [primary] = readArray(row.taxonomy_json);
  if (typeof primary !== 'object' || primary == null || !('slug' in primary) ||
      typeof primary.slug !== 'string' || !primary.slug.trim()) return null;
  const roles = readArray(row.roles_json);
  if (!roles.length || !roles.every((role): role is string => typeof role === 'string' && role.trim().length > 0)) return null;
  const purpose = new Set(terms(row.purpose));
  if (!purpose.size) return null;
  return {
    identity: { skill_uid: row.uid, version: row.version },
    primary_tag: primary.slug,
    output_kind: row.output_kind,
    roles: new Set(roles),
    purpose,
  };
}

/** The route supplies the same filtered population it uses for catalogue coverage. */
export async function readSkillOverlap(env: Env, rows: readonly CoverageRow[]) {
  const published = new Map<string, number>();
  for (const row of rows) {
    if (row.scope === 'hq' && row.status === 'published' && row.current_version >= 1 && row.uid) {
      published.set(row.uid, Number(row.current_version));
    }
  }
  if (published.size > MAX_SKILLS) {
    return { available: false as const, reason: 'Too many published HQ skills to compare. Narrow the catalogue filters.' };
  }
  try {
    const read = await env.DB.prepare(
      `SELECT s.uid, v.version, v.purpose, v.output_kind, v.taxonomy_json, v.roles_json
        FROM agent_skills s LEFT JOIN agent_skill_versions v ON v.skill_id = s.id AND v.version = s.current_version
        WHERE s.scope = 'hq' AND s.status = 'published' AND s.uid IN (SELECT value FROM json_each(?))
        ORDER BY s.uid LIMIT 251`,
    ).bind(JSON.stringify([...published.keys()])).all<StoredVersion>();
    if (!read.success) return { available: false as const, reason: 'The published skill metadata could not be read.' };
    const skills = (read.results ?? []).flatMap((row) => {
      const skill = comparable(row, published.get(row.uid));
      return skill ? [skill] : [];
    });
    const suggestions = [];
    let compared_pairs = 0;
    for (const [index, left] of skills.entries()) {
      for (let next = index + 1; next < skills.length; next++) {
        const right = skills[next];
        if (left.primary_tag !== right.primary_tag || left.output_kind !== right.output_kind) continue;
        const shared_roles = [...left.roles].filter((role) => right.roles.has(role)).sort();
        if (!shared_roles.length) continue;
        compared_pairs++;
        const shared = [...left.purpose].filter((term) => right.purpose.has(term)).length;
        const score = shared / (left.purpose.size + right.purpose.size - shared);
        if (shared >= MIN_SHARED && score >= MIN_SCORE) {
          suggestions.push({ label: 'Possible overlap', left: left.identity, right: right.identity,
            shared_roles, primary_tag: left.primary_tag, output_kind: left.output_kind, score });
        }
      }
    }
    suggestions.sort((a, b) => b.score - a.score
      || a.left.skill_uid.localeCompare(b.left.skill_uid)
      || a.right.skill_uid.localeCompare(b.right.skill_uid));
    return {
      available: true as const,
      source_rows: published.size,
      skipped_metadata: published.size - skills.length,
      compared_pairs,
      total_suggestions: suggestions.length,
      suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
    };
  } catch {
    return { available: false as const, reason: 'The published skill metadata could not be read.' };
  }
}
