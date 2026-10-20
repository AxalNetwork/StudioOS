/**
 * D814 (#2260) — "Apply for Product Testing": the words and rules the Studio
 * card and `/product-testing` share. Pure, so the tests read them directly.
 *
 * The Worker is D812's (`routes/testing.ts`, `services/testing.ts`). It lists
 * only what the caller may apply to now, and `apply` checks every condition
 * again, so this file decides what the page SHOWS: a programme that filled or
 * closed while the page was open, or one not for the caller's role, has its
 * Apply held with the reason beside it. It never decides what is allowed.
 */

export const TABS = [
  { id: 'open', label: 'Open programmes' },
  { id: 'applications', label: 'My applications' },
];

/** `?tab=` picks the tab; anything else is Open programmes. The bell's links name `applications`. */
export const tabOf = (search) => {
  const t = new URLSearchParams(search || '').get('tab');
  return TABS.some((x) => x.id === t) ? t : 'open';
};

export const PRODUCT_TESTING_PATH = '/product-testing';
export const MY_APPLICATIONS_PATH = `${PRODUCT_TESTING_PATH}?tab=applications`;

/** An application's status, as its pill reads (D3). */
export const STATUS_PILL = {
  applied: { label: 'Applied', tone: 'info' },
  picked: { label: 'Picked', tone: 'ok' },
  declined: { label: 'Not this time', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};
export const statusPill = (status) => STATUS_PILL[status] || { label: 'Status not recorded', tone: 'neutral' };

/** The Worker's `withdraw` takes an applied or a picked application, nothing else. */
export const withdrawable = (application) => application?.status === 'applied' || application?.status === 'picked';

const ROLE_WORDS = {
  founder: 'Founders',
  investor: 'Investors',
  advisor: 'Advisors',
  partner: 'Operating partners',
  exploring: 'Exploring members',
};
/** "Founders, Investors": who can apply, in the programme's order. */
export const rolesLine = (roles) => (Array.isArray(roles) && roles.length
  ? roles.map((r) => ROLE_WORDS[r] || r).join(', ')
  : 'Not recorded');

/**
 * Why Apply is held, or null when it is open. In the order `apply` refuses:
 * an application already made, closed, not for the role, full.
 */
export function applyBlock(programme, role, now = Date.now()) {
  if (!programme) return 'Not recorded.';
  if (programme.my_status) return `You have applied: ${statusPill(programme.my_status).label}.`;
  const closes = programme.closes_at ? Date.parse(programme.closes_at) : NaN;
  if (programme.status !== 'open' || (Number.isFinite(closes) && closes <= now)) return 'Applications are closed.';
  if (!Array.isArray(programme.eligible_roles) || !programme.eligible_roles.includes(role)) return 'This programme is not open to your role.';
  if (!(Number(programme.places_left) > 0)) return 'Every place is taken.';
  return null;
}

/** "8 of 20 places left". */
export const placesLine = (p) => {
  const places = Number(p?.places);
  const left = Number(p?.places_left);
  if (!Number.isFinite(places) || !Number.isFinite(left)) return 'Places not recorded';
  return `${left} of ${places} ${places === 1 ? 'place' : 'places'} left`;
};

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const day = (iso) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? DAY.format(new Date(t)) : null;
};

/** "Testing 3 Nov 2026 – 17 Nov 2026", or what is recorded of it. */
export function testingLine(starts, ends) {
  const a = day(starts);
  const b = day(ends);
  if (a && b) return `Testing ${a} – ${b}`;
  if (a) return `Testing from ${a}`;
  if (b) return `Testing until ${b}`;
  return 'Testing dates not recorded';
}

/** The card's count: "1 programme open", "3 programmes open". */
export const openLine = (n) => `${n} ${n === 1 ? 'programme' : 'programmes'} open`;

/** Every question answered, within the Worker's 2000 characters, and the consent given. */
export function canSubmit(questions, answers, consent) {
  const qs = Array.isArray(questions) ? questions : [];
  return consent === true && qs.every((_, i) => {
    const a = String(answers?.[i] ?? '').trim();
    return a.length > 0 && a.length <= ANSWER_MAX;
  });
}
export const ANSWER_MAX = 2000;
export const AVAILABILITY_MAX = 1000;
