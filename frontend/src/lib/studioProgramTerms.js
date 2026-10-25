/**
 * D988 (#2779) — what the studio's Programs tab repeats from the Worker, with
 * no import, so the Worker's own test (`studio_programs_d988.test.ts`) holds
 * each copy equal to its source: which terms each program carries
 * (`TERM_FIELDS`), their names in the program schedule, D983's three program
 * request kinds and limits, and HQ's response time.
 */

/**
 * The terms a program carries, in the order the terms card reads them. The
 * Worker's `TERM_FIELDS` (services/programGrants.ts) decides which apply;
 * `studio_programs_d988.test.ts` holds this list equal to it.
 */
const ALL = [
  'spinout-lab', 'ai-native-venture', 'mentor-cohorts', 'investor-cohorts', 'referral-partners',
  'refer-and-earn', 'perks', 'learning', 'product-testing',
];
const CAPACITY = ['spinout-lab', 'mentor-cohorts', 'learning'];
export const TERM_APPLIES = {
  starts_on: ALL,
  ends_on: ALL,
  ends_with_licence: ALL,
  capacity_cap: CAPACITY,
  capacity_uncapped: CAPACITY,
  cohorts_per_year: ['spinout-lab', 'mentor-cohorts'],
  credits_per_quarter: ['refer-and-earn', 'perks'],
  fee_cents: ALL,
  currency: ALL,
  hq_share_bps: ['spinout-lab', 'referral-partners', 'refer-and-earn', 'perks', 'learning'],
  hq_approves_each_cohort: ['spinout-lab', 'mentor-cohorts'],
  hq_approval_above_cents: ['referral-partners'],
  playbook: ALL,
  brand: ALL,
  reporting: ALL,
  requires_signed_schedule: ALL,
};
export const termsFor = (key) => Object.keys(TERM_APPLIES).filter((k) => TERM_APPLIES[k].includes(key));

/** The schedule's own label for each term (services/programSchedule.ts), which the request names. */
export const TERM_LABEL = {
  starts_on: 'Starts on',
  ends_on: 'Ends on',
  ends_with_licence: 'Ends with the licence',
  capacity_cap: 'Capacity',
  capacity_uncapped: 'No capacity cap',
  cohorts_per_year: 'Cohorts a year',
  credits_per_quarter: 'Credits a quarter',
  fee_cents: 'Fee',
  currency: 'Currency',
  hq_share_bps: 'HQ’s share',
  hq_approves_each_cohort: 'HQ approves each cohort',
  hq_approval_above_cents: 'HQ approves each payout above',
  playbook: 'Playbook',
  brand: 'Brand',
  reporting: 'Reporting',
  requires_signed_schedule: 'In force only once the schedule is signed',
};

/** The terms a studio may ask HQ to change: every term but the currency, which rides the fee. */
export const askableTerms = (key) => termsFor(key).filter((k) => k !== 'currency');

/** D983's three program requests (`PROGRAM_REQUEST_KINDS`). */
export const PROGRAM_KINDS = ['program_grant', 'program_terms_change', 'program_end'];

/** D983's limits: the reason (`REQUEST_NOTE_MAX`) and what is asked instead (`TERM_VALUE_MAX`). */
export const NOTE_MAX = 2000;
export const ASKED_MAX = 300;

/** "HQ answers within 3 days." from the Worker's response hours. */
export function answerSentence(kind, responseHours = {}) {
  const h = Number(responseHours?.[kind]);
  if (!Number.isFinite(h) || h <= 0) return 'HQ’s response time for this request is not recorded. You will see the answer here and under Requests.';
  const when = h % 24 === 0 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hours`;
  return `HQ answers within ${when}. You will see the answer here and under Requests.`;
}
