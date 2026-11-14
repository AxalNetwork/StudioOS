/**
 * D4616 (#4616) — the name other members see: the profile's display name when
 * one is set, else the account name. The same rule as the Worker's
 * `effectiveDisplayName` (services/profileExpansion.ts), which the public
 * profile and article bylines serve, so the Settings preview shows what they
 * will.
 */
export function effectiveDisplayName(displayName, accountName) {
  const own = typeof displayName === 'string' ? displayName.trim() : '';
  if (own) return own;
  const account = typeof accountName === 'string' ? accountName.trim() : '';
  return account || null;
}
