/** D1128: store-backed segment identities and question completion. Questions
 * remain code-owned (D997); a new stored segment has no invented question bank. */
import type { Env } from '../types';
import { PERSONAS, PERSONA_BY_ID } from '../personas';
import { getProfile } from './segmentProfiles';
import { suppressGroup, SMALL_CELL_MIN } from './profileEvolution';

export const SEGMENT_KEY = /^[a-z0-9_]{1,64}$/;
export const questionsOf = (key: string) => (PERSONA_BY_ID as Record<string, (typeof PERSONAS)[number]>)[key]?.follow_up_questions ?? [];

export async function segmentExists(env: Env, key: unknown): Promise<boolean> {
  return typeof key === 'string' && SEGMENT_KEY.test(key)
    && !!await env.DB.prepare(`SELECT key FROM segment_profiles WHERE key = ?`).bind(key).first();
}

export async function signUpCatalog(env: Env) {
  const r = await env.DB.prepare(`SELECT key, name, profile, who FROM segment_profiles WHERE status = 'active' ORDER BY name, key`).all<{ key: string; name: string; profile: string; who: string | null }>();
  if (!Array.isArray(r?.results)) throw new Error('segment catalog unreadable');
  return r.results.map(row => {
    const code = (PERSONA_BY_ID as Record<string, (typeof PERSONAS)[number]>)[row.key];
    return { ...(code ?? {}), id: row.key, label: row.name, profile: row.profile,
      short_description: row.who ?? '', follow_up_questions: code?.follow_up_questions ?? [], nav_extras: code?.nav_extras ?? [] };
  });
}

/** Only the signed-in member receives their own missing questions, never answers. */
export async function followUpFor(env: Env, userId: number) {
  const primary = await env.DB.prepare(`SELECT persona_id, source FROM user_personas WHERE user_id = ? AND is_primary = 1`).bind(userId).first<{ persona_id: string; source: string }>();
  if (!primary || primary.source !== 'admin_retag') return { pending: false, questions: [] };
  const profile = await getProfile(env, primary.persona_id);
  if (!profile) return { pending: false, questions: [], recorded: false, reason: 'The segment profile is not recorded.' };
  const bank = questionsOf(primary.persona_id);
  if (!bank.length) return { pending: false, questions: [], recorded: false, reason: 'No questions are set in code for this segment.' };
  const r = await env.DB.prepare(`SELECT key FROM user_profile_extras WHERE user_id = ? AND persona_id = ? AND value IS NOT NULL AND trim(value) != ''`).bind(userId, primary.persona_id).all<{ key: string }>();
  if (!Array.isArray(r?.results)) throw new Error('segment questions unreadable');
  const answered = new Set(r.results.map(row => row.key));
  const missing = bank.filter(q => !answered.has(q.key));
  return { pending: missing.length > 0, persona_id: primary.persona_id, name: profile.name, questions: missing, recorded: true };
}

/** SEG2's tile: only counts of active non-admin primary members. Paired
 * suppression prevents the total revealing either a small complete or incomplete cell. */
export async function questionCompletion(env: Env, key: string) {
  const profile = await getProfile(env, key);
  if (!profile) return null;
  const bank = questionsOf(key);
  if (!bank.length) return { recorded: false, reason: 'No questions are set in code for this segment.' };
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS members,
           COALESCE(SUM(CASE WHEN NOT EXISTS (
             SELECT 1 FROM json_each(?) q WHERE NOT EXISTS (
               SELECT 1 FROM user_profile_extras e
                WHERE e.user_id = u.id AND e.persona_id = ? AND e.key = q.value
                  AND e.value IS NOT NULL AND trim(e.value) != ''
             )
           ) THEN 1 ELSE 0 END), 0) AS answered
      FROM users u JOIN user_personas p ON p.user_id = u.id AND p.is_primary = 1
     WHERE p.persona_id = ? AND u.role != 'admin' AND u.is_active = 1
  `).bind(JSON.stringify(bank.map(q => q.key)), key, key).first<{ members: number; answered: number }>();
  if (!row) throw new Error('segment completion unreadable');
  const n = Number(row.members), complete = Number(row.answered);
  const cells = suppressGroup([complete, n - complete]).cells;
  return { recorded: true, answered: cells[0], incomplete: cells[1], members: suppressGroup([n]).cells[0], small_cell_min: SMALL_CELL_MIN };
}
