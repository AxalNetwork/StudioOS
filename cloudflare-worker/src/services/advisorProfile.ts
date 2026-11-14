/** Shared advisor profile serialization and field validation. */
import type { Env } from '../types';
import { jload } from '../routes/_t13t14t15_helpers';
import { AdvisorValidationError, PROFILE_LIMITS, boundedList, boundedText, hourlyRate } from './advisorLimits';
import type { AdvisorRow } from './advisorPractice';

/**
 * The 202 profile fields, kept separate from `advisorDto` on purpose.
 *
 * `stages` and `languages` return NULL — not `[]` — when the advisor has never
 * answered. The two are different facts and the product renders them
 * differently: an unanswered question shows "Not recorded", an answered one
 * that happens to be empty shows an empty list. `expertise` and `sectors`
 * above collapse both to `[]` because their columns default to '[]' and
 * predate that distinction; the new fields do not repeat it.
 */
function advisorProfileDto(m: AdvisorRow): any {
  return {
    headline: m.headline ?? null,
    stages: m.stages_json == null ? null : jload(m.stages_json, [] as string[]),
    languages: m.languages_json == null ? null : jload(m.languages_json, [] as string[]),
    country: m.country ?? null,
    timezone: m.timezone ?? null,
    availability_note: m.availability_note ?? null,
    headshot_url: m.headshot_url ?? null,
  };
}

export function advisorDto(m: AdvisorRow): any {
  return {
    id: m.id, uid: m.uid, user_id: m.user_id,
    display_name: m.display_name, email: m.email, bio: m.bio,
    expertise: jload(m.expertise_json, [] as string[]),
    sectors: jload(m.sectors_json, [] as string[]),
    linkedin_url: m.linkedin_url, hourly_rate_usd: m.hourly_rate_usd,
    is_active: !!m.is_active,
    created_at: m.created_at, updated_at: m.updated_at,
    ...advisorProfileDto(m),
  };
}

export async function loadAdvisorById(env: Env, id: number): Promise<AdvisorRow | null> {
  return env.DB.prepare('SELECT * FROM advisors WHERE id = ?').bind(id).first<AdvisorRow>();
}

/**
 * Resolve the 202 profile fields for a write, MERGING rather than replacing.
 *
 * This is the one thing that must not be got wrong. Core profile fields and the expanded fields both preserve omissions.
 * Explicit null still clears nullable text and rates. The seven below are written by different surfaces at
 * different times — `/office-hours`'s ProfileCard sends `headline` and
 * `timezone` and knows nothing about stages or languages — so replacing the
 * whole set on every POST would mean each surface silently blanked the fields
 * the other owns. A key that is absent from the body keeps whatever is stored.
 *
 * An EXPLICIT null still clears: `{"headshot_url": null}` removes the photo.
 * That is the difference between "I did not mention this" and "I am removing
 * this", and only checking key presence can tell them apart.
 */
function mergeProfileFields(existing: AdvisorRow | null, body: any) {
  const text = (key: string, max: number): string | null => {
    if (!(key in body)) return (existing?.[key as keyof AdvisorRow] as string | null) ?? null;
    const v = body[key];
    if (v == null) return null;
    return boundedText(key, v, max);
  };
  const list = (key: string, col: keyof AdvisorRow): string | null => {
    if (!(key in body)) return (existing?.[col] as string | null) ?? null;
    const v = body[key];
    // Null clears the answer entirely; an empty array is a recorded empty
    // answer. Storing '[]' for both would lose which one the advisor meant.
    if (v == null) return null;
    return JSON.stringify(boundedList(key, v));
  };
  return {
    headline: text('headline', PROFILE_LIMITS.headline),
    stages_json: list('stages', 'stages_json'),
    languages_json: list('languages', 'languages_json'),
    country: text('country', PROFILE_LIMITS.country),
    timezone: text('timezone', PROFILE_LIMITS.timezone),
    availability_note: text('availability_note', PROFILE_LIMITS.availability_note),
    headshot_url: text('headshot_url', PROFILE_LIMITS.headshot_url),
  };
}

export function profileWriteFields(existing: AdvisorRow | null, body: Record<string, any>, fallbackName: string) {
  const has = (key: string) => Object.hasOwn(body, key);
  const display_name = has('display_name') || !existing
    ? boundedText('display_name', body.display_name || fallbackName, PROFILE_LIMITS.display_name)
    : existing.display_name;
  if (!display_name) throw new AdvisorValidationError('display_name_required', 'A profile needs a display name.');
  const bio = has('bio') ? boundedText('bio', body.bio, PROFILE_LIMITS.bio) : (existing?.bio ?? null);
  const linkedin_url = has('linkedin_url') ? boundedText('linkedin_url', body.linkedin_url, PROFILE_LIMITS.linkedin_url) : (existing?.linkedin_url ?? null);
  const hourly_rate_usd = has('hourly_rate_usd') ? hourlyRate(body.hourly_rate_usd) : (existing?.hourly_rate_usd ?? null);
  const expertise_json = has('expertise') ? JSON.stringify(boundedList('expertise', body.expertise)) : (existing?.expertise_json ?? '[]');
  const sectors_json = has('sectors') ? JSON.stringify(boundedList('sectors', body.sectors)) : (existing?.sectors_json ?? '[]');
  return { display_name, bio, linkedin_url, hourly_rate_usd, expertise_json, sectors_json, ...mergeProfileFields(existing, body) };
}
