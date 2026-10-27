/**
 * D1306 (#3403, part 7 of #2377) — the account drawer's words and rules,
 * pure, so the page draws them and a test reads them without a browser.
 *
 * Boards ACC4–ACC7 and ACC13 of the owner's "Accounts" canvas (D1299). Every
 * change opens an in-page dialog that says what it changes and who is told;
 * none is a browser pop-up. A refusal is said inside the dialog, which stays
 * open.
 */

/** #2377 G1: each profile's name. `partner` is an Operating Partner, `exploring` an Explorer. */
export const PROFILE_LABEL = Object.freeze({
  founder: 'Founder',
  investor: 'Investor',
  advisor: 'Advisor',
  partner: 'Operating Partner',
  exploring: 'Explorer',
  admin: 'Admin',
});

export const profileLabel = (role) => PROFILE_LABEL[String(role ?? '')] ?? (role ? String(role) : 'Not recorded');

/** The picker's choices, in the canvas's order (ACC7 A). An administrator is opened on a licence, never here. */
export const PROFILE_CHOICES = Object.freeze(['founder', 'investor', 'advisor', 'partner', 'exploring']);

/** A support session's first stretch and the most it can be extended to, as `auth.ts` enforces them. */
export const SUPPORT_SESSION_MINUTES = 30;
export const SUPPORT_SESSION_CEILING_MINUTES = 120;

/** The reason floor every audited change shares with the Worker's own (ten characters). */
export const REASON_MIN = 10;

/** The drawer's tabs, in ACC4's order. The keys are the drawer's own state; `kyc` is Identity. */
export const DRAWER_TABS = Object.freeze([
  { key: 'profile', label: 'Profile' },
  { key: 'sub', label: 'Sub-accounts' },
  { key: 'kyc', label: 'Identity' },
  { key: 'agreements', label: 'Agreements' },
  { key: 'registration', label: 'Registration' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'advisor', label: 'Conversations' },
  { key: 'activity', label: 'Activity' },
  { key: 'notes', label: 'Notes' },
]);

const nameOf = (u) => (u?.name || u?.email || 'This account');

/** A day as the canvas writes it ("3 Oct 2026"), or null when none is stored or it cannot be read. */
export function day(value) {
  if (!value) return null;
  const d = new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Every dialog ACC7 draws that this drawer owns, as words. `confirm.tone` is
 * `pri` or `neg`; `reason` is null when the dialog asks for none.
 *   role             A · change an account's profile
 *   full_access      D · grant full access without an identity check (a reason, D1303)
 *   limited_grant    E · grant limited access
 *   limited_revoke   E · revoke it
 *   deactivate       I · deactivate (a reason for an administrator, optional otherwise)
 *   reactivate       I · reactivate
 *   resend           the verification email again, one account
 */
export function accountDialog(kind, user, extra = {}) {
  const who = nameOf(user);
  const isAdmin = String(user?.role ?? '').toLowerCase() === 'admin';
  switch (kind) {
    case 'role': {
      const to = profileLabel(extra.nextRole);
      return {
        title: `Change ${who}’s profile from ${profileLabel(user?.role)} to ${to}?`,
        paras: ['It takes effect at once. Their menus change on their next page. It is recorded in their activity.'],
        note: 'HQ opens administrator accounts on a licence.',
        told: `${who} is told their profile changed.`,
        reason: null,
        confirm: { label: 'Change profile', tone: 'pri' },
      };
    }
    case 'full_access':
      return {
        title: `Grant ${who} full access without an identity check?`,
        paras: [`This marks ${who}’s identity check approved. Use it only when you have checked their identity another way.`],
        note: 'It asks for a fresh sign-in check and is recorded in their activity.',
        told: `${who} is told their access changed.`,
        reason: { label: 'Reason', required: true, min: REASON_MIN, placeholder: 'How did you check their identity?' },
        confirm: { label: 'Grant full access', tone: 'pri' },
      };
    case 'limited_grant':
      return {
        title: `Grant ${who} limited access?`,
        paras: ['They can sign in and browse, but cannot sign any agreement until the identity check is approved.'],
        told: `Recorded in their activity. ${who} is told.`,
        reason: null,
        confirm: { label: 'Grant limited access', tone: 'pri' },
      };
    case 'limited_revoke':
      return {
        title: `Revoke ${who}’s limited access?`,
        paras: ['They go back to the identity check on their next page.'],
        told: `Recorded in their activity. ${who} is told.`,
        reason: null,
        confirm: { label: 'Revoke limited access', tone: 'neg' },
      };
    case 'deactivate':
      return {
        title: `Deactivate ${who}?`,
        paras: ['They cannot sign in. Nothing is deleted. You can reactivate the account later.'],
        told: `${who} is told by email. Recorded in their activity.`,
        reason: isAdmin
          ? { label: 'Reason', required: true, min: REASON_MIN, placeholder: 'Required for an administrator account' }
          : { label: 'Reason', required: false, min: 0, placeholder: 'Optional' },
        reasonNote: 'Required for an administrator account, optional otherwise.',
        confirm: { label: 'Deactivate', tone: 'neg' },
      };
    case 'reactivate':
      return {
        title: `Reactivate ${who}?`,
        paras: ['They can sign in again, with the profile and data they had.'],
        told: `${who} is told by email. Recorded in their activity.`,
        reason: isAdmin
          ? { label: 'Reason', required: true, min: REASON_MIN, placeholder: 'Required for an administrator account' }
          : null,
        confirm: { label: 'Reactivate', tone: 'pri' },
      };
    case 'resend':
      return {
        title: `Send the verification email again to ${who}?`,
        paras: ['A new link replaces the old one. It lasts 24 hours.'],
        told: 'The send is recorded in their activity.',
        reason: null,
        confirm: { label: 'Send the email', tone: 'pri' },
      };
    default:
      return null;
  }
}

/** Whether a dialog's reason, as typed, lets its confirm be pressed. */
export function reasonReady(spec, reason) {
  if (!spec?.reason) return true;
  const n = String(reason ?? '').trim().length;
  return spec.reason.required ? n >= spec.reason.min : true;
}

/**
 * A failed change in one sentence, for the dialog it was asked from. The
 * Worker's own words where it gave some; never a raw status.
 */
export function refusalSentence(err) {
  const code = err?.data?.code || err?.code;
  if (code === 'super_admin_required') return 'Only a Super Admin can change another administrator’s account.';
  if (code === 'reason_required') return 'A reason of at least ten characters is required.';
  const msg = String(err?.message || '').trim();
  return msg || 'That could not be done. Nothing changed. Try again.';
}

/**
 * ACC13a — the drawer for an account this viewer may not open. A 403
 * `super_admin_required` from the profile read is another administrator's
 * record, which is the Super Admin's (D133); anything else is a read that
 * failed, said as one with Try again.
 */
export function drawerRefusal(err) {
  const code = err?.data?.code || err?.code;
  if (code === 'super_admin_required' || err?.status === 403) {
    return {
      kind: 'hq_only',
      eyebrow: 'HQ only',
      title: 'Only a Super Admin can open another administrator’s record.',
      line: 'You can see that this account is an administrator. Its activity and controls are HQ’s.',
    };
  }
  return { kind: 'unreadable', title: 'This account could not be read.', line: 'That is not the same as an empty account. Try again.' };
}

/** D991's verdicts in the canvas's words (ACC4: "Onboarding profile: Verified on 3 Oct 2026"). */
const PROFILE_STATUS = Object.freeze({ pending: 'Waiting for review', verified: 'Verified', rejected: 'Rejected', draft: 'Draft' });

/**
 * ACC4's onboarding-profile line from the profile read's `onboarding_profile`
 * (D1306). `null` is no profile; `available: false` a store that failed.
 */
export function onboardingProfileLine(op) {
  if (op === undefined) return { kind: 'unread', text: 'Onboarding profile: not read here. The profile read did not say.' };
  if (op === null) return { kind: 'none', text: 'No onboarding profile on file.' };
  if (op.available === false) return { kind: 'unreadable', text: 'The onboarding profile could not be read. That is not the same as none.' };
  const status = Object.hasOwn(PROFILE_STATUS, String(op.status)) ? PROFILE_STATUS[op.status] : (op.status ? String(op.status) : 'Not recorded');
  const on = day(op.reviewed_at);
  const decided = op.status === 'verified' || op.status === 'rejected';
  return {
    kind: 'profile',
    status,
    when: decided ? (on ? `on ${on}` : 'on a date not recorded') : null,
    href: op.ref ? `/admin/partner-profiles/${encodeURIComponent(op.ref)}` : '/admin/partner-profiles',
  };
}

/**
 * ACC6's "Last saved on … by …", from D1303's `notes_saved` on the profile
 * read. Until D1303 (migration 639) is on this database the read carries none,
 * and the line says so; it never guesses a saver.
 */
export function notesSavedLine(saved) {
  if (saved === undefined) return 'Not recorded: who saved these notes and when is kept once D1303 (migration 639) is on this database.';
  if (!saved || saved.available === false) return 'Who saved these notes could not be read. Try again.';
  if (saved.recorded === false) return saved.reason || 'Not recorded: these notes were saved before who saved them was kept.';
  if (!saved.saved_at && !saved.at) return 'No notes saved yet.';
  const on = day(saved.saved_at || saved.at);
  const by = saved.saved_by?.name || saved.by?.name || null;
  return `Last saved on ${on || 'a date not recorded'}${by ? ` by ${by}` : ''}`;
}

/** The Identity tab's words for a check's state (#2384), matching D1300's filter. */
const IDENTITY = Object.freeze({
  not_started: 'Not started', pending: 'Waiting', needs_info: 'Needs information',
  approved: 'Approved', rejected: 'Rejected', expired: 'Expired',
});
export const identityWord = (s) => IDENTITY[String(s || 'not_started')] ?? String(s);

/** D1302's tester statuses as one line each (ACC5). */
export function testerLine(tester) {
  if (!tester || tester.available === false) {
    return { kind: 'unreadable', text: tester?.reason === 'not_set_up'
      ? 'Product testers are not set up on this database.'
      : 'The product tester record could not be read. That is not the same as none.' };
  }
  const r = tester.record;
  if (!r) return { kind: 'none', text: 'Not a product tester. Testers are decided in Approvals › Product testers.' };
  const by = r.decided_by?.name ? ` by ${r.decided_by.name}` : '';
  const when = day(r.decided_at);
  switch (r.status) {
    case 'applied': return { kind: 'applied', text: `Applied on ${day(r.applied_at) || 'a date not recorded'}. Waiting in Approvals.` };
    case 'active': return { kind: 'active', text: `Active since ${when || 'a date not recorded'}${by}.` };
    case 'paused': return { kind: 'paused', text: `Paused on ${when || 'a date not recorded'}${by}.` };
    case 'declined': return { kind: 'declined', text: `Application declined on ${when || 'a date not recorded'}${by}.`, reason: r.reason || null };
    case 'removed': return { kind: 'removed', text: `Removed on ${when || 'a date not recorded'}${by}.`, reason: r.reason || null };
    default: return { kind: 'other', text: `Status: ${String(r.status)}.` };
  }
}

/** D1302's LP block as one line (ACC5). */
export function lpLine(lp) {
  if (!lp || lp.available === false) {
    return lp?.reason === 'not_set_up' ? 'LP applications are not set up on this database.' : 'The LP applications could not be read. That is not the same as none.';
  }
  if (lp.is_lp) {
    const funds = (lp.funds || []).map(String);
    return funds.length ? `An LP of ${funds.join(', ')}.` : 'An LP: an application is approved.';
  }
  const waiting = (lp.applications || []).filter((a) => ['pending', 'in_review', 'needs_follow_up'].includes(a.status)).length;
  return waiting
    ? `Not an LP yet. ${waiting === 1 ? 'One application is' : `${waiting} applications are`} waiting.`
    : 'Not an LP. LP status comes from an approved LP application.';
}
