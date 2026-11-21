/**
 * D7516 (#7516): the Profile fields a match surface reads, and whether one is answered.
 * Kept apart from `ProfileZone.jsx` so the Expertise Overview can count completeness
 * without importing the Profile page (and, through it, the shell's UI barrel).
 */

/**
 * The fields a match surface reads — the meter's list, and the `Match-critical`
 * chip's (D392). One list, so the chip cannot select fields the meter does not
 * count or miss one it does.
 */
export const MATCH_FIELDS = [
  ['Positioning statement', 'headline'],
  ['Sectors', 'sectors'],
  ['Stages', 'stages'],
  ['Languages', 'languages'],
  ['Geography', 'country'],
  ['Availability window', 'availability_note'],
  ['Headshot', 'headshot_url'],
];

/** Is this field answered in the SAVED record? An empty list is not an answer here. */
export function filled(profile, key) {
  const v = profile?.[key];
  if (Array.isArray(v)) return v.length > 0;
  return v !== null && v !== undefined && String(v).trim() !== '';
}
