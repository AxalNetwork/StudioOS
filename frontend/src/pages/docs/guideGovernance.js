// D4641 (#4641): source-truthful ownership and review status for priority Help guides.
// This is a review ledger keyed by the existing guide anchor, not a second route/permission catalogue.
// No guide may receive a last-verified date until its relevant product flow has actually been checked.
//
// D7515 (#7515): a record carries two dates, both `YYYY-MM-DD` or null.
//   firstVerifiedAt  the day the guide's first source and journey check passed; never moves.
//   lastVerifiedAt   the day of the latest check that passed.
// Null is "not recorded", never a guess. A guide is flagged stale only against
// REVIEW_WINDOW_DAYS, the review window #4641's owners agree; it is null because
// no window has been agreed, and while it is null no guide is called stale or current.
export const REVIEW_WINDOW_DAYS = null;
const PENDING = 'Verification pending';
export const PRIORITY_HELP_REVIEW = Object.freeze({
  'getting-started/help-and-shortcuts': { owner: 'Axal VC Product & Support', firstVerifiedAt: null, lastVerifiedAt: null, scope: 'Current Eadwyn and support permissions require source and browser review' },
  'account/tiers': { owner: 'Axal VC Product & Support', firstVerifiedAt: null, lastVerifiedAt: null, scope: 'Align with pricing/entitlement approval in #4652 and #4653' },
  'account/investor-billing': { owner: 'Axal VC Product & Support', firstVerifiedAt: null, lastVerifiedAt: null, scope: 'Align with pricing/entitlement approval in #4652 and #4653' },
  'account/paywalls': { owner: 'Axal VC Product & Support', firstVerifiedAt: null, lastVerifiedAt: null, scope: 'Check live billing and access outcomes' },
  'account/privacy': { owner: 'Axal VC Privacy & Support', firstVerifiedAt: null, lastVerifiedAt: null, scope: 'Check actual export payload, erasure policy and disclosure' },
  'account/auth-recovery': { owner: 'Axal VC Support', firstVerifiedAt: null, lastVerifiedAt: null, scope: 'Check signed-out recovery methods and account eligibility' },
  'troubleshooting/contact-support': { owner: 'Axal VC Support', firstVerifiedAt: null, lastVerifiedAt: null, scope: 'Check public/private ticket channels and support paths' },
  'integrations/overview': { owner: 'Axal VC Product & Support', firstVerifiedAt: null, lastVerifiedAt: null, scope: 'Check current provider configuration and revocation controls' },
  'changelog/release-notes': { owner: 'Axal VC Product & Support', firstVerifiedAt: null, lastVerifiedAt: null, scope: 'Check publication source and release discovery' },
});
const DEFAULT = Object.freeze({ owner: 'Unassigned', firstVerifiedAt: null, lastVerifiedAt: null, scope: 'Catalogue review not yet scheduled' });

export function guideReviewFor(anchor) {
  const key = typeof anchor === 'string' ? anchor : '';
  const record = PRIORITY_HELP_REVIEW[key] || DEFAULT;
  const verified = recordedDate(record.firstVerifiedAt) || recordedDate(record.lastVerifiedAt);
  return { ...record, status: verified ? 'Source and journey verified' : PENDING };
}

const DAY_MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A recorded `YYYY-MM-DD` that is a real calendar day, or null: a malformed date is not a verification. */
export function recordedDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? value : null;
}

/** "12 Nov 2026", read in UTC so the day never shifts with the reader's time zone. */
export function verifiedDay(value) {
  const d = recordedDate(value);
  if (!d) return null;
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

/**
 * What a guide's record says about verification, in words the page can show.
 *   state 'verified'  a first verified date is recorded ("First verified 12 Nov 2026",
 *                     with "last verified …" when a later check is recorded too)
 *   state 'last_only' only a last verified date is recorded; the line says the first is not
 *   state 'pending'   nothing recorded: "Verification pending", the word #4641 and D6861 use
 * `stale` is measured from the latest recorded check against `windowDays`:
 *   'stale' older than the window · 'current' within it ·
 *   'not_recorded' no window is agreed, or no check is recorded to age.
 */
export function guideVerification(record, { now = Date.now(), windowDays = REVIEW_WINDOW_DAYS } = {}) {
  const first = recordedDate(record?.firstVerifiedAt);
  const last = recordedDate(record?.lastVerifiedAt);
  let state = 'pending';
  let line = PENDING;
  if (first) {
    state = 'verified';
    line = last && last > first ? `First verified ${verifiedDay(first)} · last verified ${verifiedDay(last)}` : `First verified ${verifiedDay(first)}`;
  } else if (last) {
    state = 'last_only';
    line = `Last verified ${verifiedDay(last)} · first verified date not recorded`;
  }
  const latest = [first, last].filter(Boolean).sort().pop() || null;
  const reviewWindow = Number.isInteger(windowDays) && windowDays > 0 ? windowDays : null;
  let stale = { state: 'not_recorded', since: latest };
  if (latest && reviewWindow) {
    const nowMs = typeof now === 'number' ? now : Date.parse(now);
    const ageDays = Math.floor((nowMs - Date.parse(`${latest}T00:00:00Z`)) / DAY_MS);
    stale = { state: ageDays > reviewWindow ? 'stale' : 'current', since: latest, ageDays, windowDays: reviewWindow };
  }
  return { state, line, firstVerifiedAt: first, lastVerifiedAt: last, stale };
}

/** `guideVerification` for a guide's ledger record by its anchor. */
export function guideVerificationFor(anchor, opts) {
  return guideVerification(guideReviewFor(anchor), opts);
}

/** The admin column's word for staleness: never "current" or "stale" without an agreed window. */
export function staleWord(verification) {
  const s = verification?.stale;
  if (s?.state === 'stale') return `stale · ${s.ageDays} days since verified`;
  if (s?.state === 'current') return 'current';
  return 'stale not recorded';
}

/** Derived from the existing HQ feedback read. Does not falsely claim a durable queue or search-gap store. */
export function contentReviewItems(view) {
  if (!view || !Array.isArray(view.guides)) return null;
  const missing = Array.isArray(view.missing) ? view.missing : [];
  const items = view.guides.filter((g) => Number(g.no) > 0 || missing.some((m) => m.anchor === g.anchor)).map((g) => ({
    anchor: g.anchor,
    title: g.title,
    negativeAnswers: Number(g.no) || 0,
    missingNotes: missing.filter((m) => m.anchor === g.anchor).length,
    ...guideReviewFor(g.anchor),
  }));
  return items.sort((a, b) => b.negativeAnswers - a.negativeAnswers || b.missingNotes - a.missingNotes);
}
