/**
 * Task #11 (AC-2) — Persona picker.
 *
 * Picks the right question bank for the chat client (AC-3) given
 * the current `user.role` and a `spinout_lab_active` flag derived
 * from `user.spinout_lab_week` (or the explicit boolean if AC-3
 * passes one). Returns `null` if no bank matches the role yet —
 * AC-3 then falls back to the role detector served by the
 * advisor `/start` endpoint.
 *
 * Decision rule:
 *   - role 'founder' + spinout_lab_active        → NEW_FOUNDER_BANK
 *   - role 'founder' + !spinout_lab_active       → EXISTING_FOUNDER_BANK
 *   - role 'investor'                            → INVESTOR_BANK
 *   - role 'mentor'                              → MENTOR_BANK
 *   - role 'partner'                             → PARTNER_BANK
 *   - role 'admin' / null / 'unknown' / other    → null (let backend handle)
 */
import NEW_FOUNDER_BANK from './banks/newFounder';
import EXISTING_FOUNDER_BANK from './banks/existingFounder';
import INVESTOR_BANK from './banks/investor';
import MENTOR_BANK from './banks/mentor';
import PARTNER_BANK from './banks/partner';

/**
 * Derive the spinout-lab-active flag from a user object. Treat
 * `spinout_lab_week` ∈ {1,2,3,4} as "active" when not graduated.
 * Callers may pass the boolean directly via the second arg.
 */
export function isSpinoutLabActive(user, explicit) {
  if (typeof explicit === 'boolean') return explicit;
  if (!user) return false;
  if (user.spinout_lab_active === true) return true;
  if (user.spinout_lab_active === false) return false;
  const week = Number(user.spinout_lab_week ?? 0);
  // `is_incorporated` flips on Week-4 graduation (see
  // routes/spinout_lab.ts) — graduates are treated as Existing.
  if (week >= 1 && week <= 4 && !user.is_incorporated) return true;
  return false;
}

export function pickPersonaBank(user, spinoutLabActiveOverride) {
  const role = String(user?.role || '').toLowerCase();
  switch (role) {
    case 'founder': {
      const active = isSpinoutLabActive(user, spinoutLabActiveOverride);
      return active ? NEW_FOUNDER_BANK : EXISTING_FOUNDER_BANK;
    }
    case 'investor': return INVESTOR_BANK;
    case 'mentor':   return MENTOR_BANK;
    case 'partner':  return PARTNER_BANK;
    default:         return null;
  }
}

export const BANKS = {
  newFounder: NEW_FOUNDER_BANK,
  existingFounder: EXISTING_FOUNDER_BANK,
  investor: INVESTOR_BANK,
  mentor: MENTOR_BANK,
  partner: PARTNER_BANK,
};

export default pickPersonaBank;
