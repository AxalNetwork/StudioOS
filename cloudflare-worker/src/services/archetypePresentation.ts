/**
 * Archetype illustration sex — man / woman / both.
 *
 * The Profile & Fit card draws a male (`{slug}.png`) or female (`{slug}_f.png`)
 * pixel-art sprite. This module is the one place that maps a stored answer,
 * a Settings value, or (as a last resort) pronouns onto that choice.
 *
 * Stored on `user_settings.archetype_sex` (NOT `users` — that table is at the
 * D1 column ceiling). Never infers from a name. Pronouns only fill in when
 * the user has not picked an illustration: he/him → man, she/her → woman,
 * they/them or mixed → both (the card shows the pair until they choose).
 */
export const ARCHETYPE_SEXES = ['m', 'f', 'both'] as const;
export type ArchetypeSex = (typeof ARCHETYPE_SEXES)[number];

export const ARCHETYPE_PRESENTATION_OPTIONS = [
  'A man',
  'A woman',
  'Show both for now',
] as const;

const ALIASES: Record<string, ArchetypeSex> = {
  m: 'm',
  male: 'm',
  man: 'm',
  'a man': 'm',
  f: 'f',
  female: 'f',
  woman: 'f',
  'a woman': 'f',
  both: 'both',
  'show both': 'both',
  'show both for now': 'both',
};

function norm(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Parse a stored value, Settings payload, or advisor select answer. */
export function parseArchetypeSex(raw: unknown): ArchetypeSex | null {
  if (raw == null) return null;
  const key = norm(String(raw));
  if (!key) return null;
  return ALIASES[key] ?? null;
}

/**
 * Infer illustration sex from a pronouns string. Returns null when the
 * string is empty, they/them, mixed (he/she), or anything we cannot read
 * as a single binary set — so we never guess.
 */
export function sexFromPronouns(pronouns: string | null | undefined): ArchetypeSex | null {
  const p = norm(String(pronouns || '')).replace(/[./]/g, ' ');
  if (!p) return null;
  const hasHe = /\b(he|him|his|himself)\b/.test(p);
  const hasShe = /\b(she|her|hers|herself)\b/.test(p);
  const hasThey = /\b(they|them|theirs|themself|themselves)\b/.test(p);
  if (hasHe && !hasShe && !hasThey) return 'm';
  if (hasShe && !hasHe && !hasThey) return 'f';
  return null;
}

/**
 * Illustration to show: explicit Settings / advisor answer wins; otherwise
 * pronouns; otherwise the pair (`both`).
 */
export function resolveArchetypeSex(
  explicit: string | null | undefined,
  pronouns?: string | null,
): ArchetypeSex {
  return parseArchetypeSex(explicit) ?? sexFromPronouns(pronouns) ?? 'both';
}
