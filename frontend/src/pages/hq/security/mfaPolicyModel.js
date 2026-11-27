/**
 * D5249 (#5249) — the "Require MFA for admins" control's words, from the
 * server's answer only (`GET/PUT /api/admin/security/mfa-policy`).
 *
 * THE ONE THING THIS MUST NEVER DO is say enforcement is on while it is off.
 * So the state comes from the last reply the server sent: a reply that could
 * not be read, or carries no boolean, is Unavailable — never Off and never
 * On — and a failed change leaves the state where the last read put it.
 */

/** What the control draws for one read. `unavailable` is the page's sentinel. */
export function mfaPolicyView(policy, unavailable) {
  if (policy == null) return { state: 'loading', badge: null, word: 'Reading…', text: 'Reading the setting…' };
  if (policy === unavailable || policy.readable === false || typeof policy.enabled !== 'boolean') {
    return {
      state: 'unreadable',
      badge: 'unavailable',
      word: 'Unavailable',
      text: 'The setting could not be read, so it is not shown as on or off.',
    };
  }
  if (policy.enabled) {
    return {
      state: 'on',
      badge: 'verified',
      word: 'On',
      text: 'An administrator without MFA is sent to enrol and reaches no admin page until they do.',
    };
  }
  return {
    state: 'off',
    badge: 'not_applicable',
    word: 'Off',
    text: 'Not enforced: an administrator without MFA can still reach admin pages with a password alone.',
  };
}

/** Who enforcement would send to enrol, from the read's own count; null is never 0. */
export function withoutMfaLine(policy) {
  const n = policy?.admins_without_mfa;
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'How many administrators have no MFA could not be read.';
  if (n === 0) return 'Every active administrator has MFA, so turning this on sends no one to enrol.';
  return `${n} active administrator${n === 1 ? '' : 's'} without MFA would be sent to enrol.`;
}

/** The sentence for a refused or failed change. Nothing is shown as changed. */
export function mfaPolicyRefusal(err) {
  const code = err?.code || '';
  const status = Number(err?.status) || 0;
  if (code === 'actor_without_mfa') return 'Refused — enrol MFA on your own account first, then turn this on.';
  if (code === 'reason_required') return 'Refused — give a reason for this change.';
  if (code === 'step_up_required' || /TOTP required/i.test(err?.message || '')) return 'Refused — needs your authenticator and a fresh step-up.';
  if (code === 'store_unavailable' || status === 503) return 'Not saved — the setting or its audit record could not be written. Nothing was changed.';
  if (status === 403) return 'Refused — only a Super Admin can change this setting.';
  return 'Outcome unknown — the server did not confirm the change. Re-read before trying again.';
}

/**
 * The page's change, shared with its test: send it, and move the state only
 * to what the server replied. No optimistic flip; a reply without a boolean
 * re-reads instead of guessing; a refusal throws and leaves the state alone.
 */
export async function changeMfaPolicy({ put, setPolicy, reload }, enabled, reason) {
  const reply = await put(enabled, reason);
  if (reply && typeof reply.enabled === 'boolean') setPolicy(reply);
  else reload();
  return reply;
}
