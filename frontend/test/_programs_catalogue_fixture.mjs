/**
 * D961 (#2794) — part 1's catalogue answer (`GET /api/admin/programs`, D954 §3)
 * in the shapes `services/programCatalogue.ts` returns, for the catalogue's
 * mounted tests. `catalogueBody(o)` builds one; each block can be replaced
 * through `o`. The registry rows are the seed's words (migration 560).
 */

export const AXIS_12 = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14',
  '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];

export const unreadable = (what = 'It') => ({ available: false, unreadable: true, reason: `${what} could not be read on this database. That is not the same as none.` });
export const pendingBlock = (reason) => ({ available: false, pending: true, reason });
export const PART4_CLAIMS = 'Perk claims are read through part 4’s claims service, which is not on this Worker yet.';
export const PART4_STRATEGIC = 'Strategic referral access is read through part 4’s queue service, which is not on this Worker yet.';
export const HQ_READS = 'HQ reads these figures.';
export const LAB_PEOPLE = 'Who a cohort’s founders are waits on O-FND and #2374.';
export const DEACTIVATED = 'Deactivated accounts are not left out yet.';

const queue = (count, bands = [count, 0, 0], oldest = 10, aged = 'since applied', extra = {}) => ({
  available: true, count, oldest_hours: count ? oldest : null,
  bands: { under_24: bands[0], from_24_to_72: bands[1], over_72: bands[2] }, age_not_recorded: 0, aged, ...extra,
});
const weekly = (values, previous = 0, axis = AXIS_12) => ({
  available: true,
  weeks: axis.map((w, i) => ({ week: w, count: values[i] ?? 0, to_date: i === axis.length - 1 })),
  total: values.reduce((t, v) => t + v, 0), previous_total: previous,
});

const ROWS = [
  ['spinout-lab', 'Ventures', 'Spin-Out Lab', 'Idea to incorporated company in 28 days, one cohort a month.', 'Founders', 'By application', 'live', 1],
  ['ai-native-venture', 'Ventures', 'AI-native Venture', null, null, null, 'proposed', 2],
  ['mentor-cohorts', 'Access', 'Mentor cohort access', 'Advisors who mentor a Lab cohort read that cohort’s founders.', 'Advisors', 'Assigned by an admin', 'live', 3],
  ['investor-cohorts', 'Access', 'Investor cohort access', 'Verified investors follow one Lab cohort to Demo Day.', 'Investors', 'Assigned by an admin', 'not_built', 4],
  ['referral-partners', 'Network and referrals', 'Referral partners', 'People who bring events, startups, deals and LPs.', null, null, 'partly_built', 5],
  ['refer-and-earn', 'Network and referrals', 'Refer & Earn', 'Members refer founders and platform users.', 'Founders, investors, advisors and partners', 'Open', 'live', 6],
  ['perks', 'Rewards', 'Perks', 'Partners list perks; founders claim them with credits, a plan or payment.', 'Founders claim; other members browse.', 'Open', 'live', 7],
  ['learning', 'Learning', 'Learning', 'Courses, videos, exercises and exams for a region or a group.', 'Every member', 'Open or by invitation', 'live', 8],
  ['product-testing', 'Product', 'Product testing', 'HQ and partners test their products with members.', 'The roles each program names', 'By application', 'live', 9],
];

export function catalogueBody(o = {}) {
  const superAdmin = Boolean(o.superAdmin);
  const waiting = {
    cohort: queue(2, [1, 1, 0], 30),
    referrals: queue(3, [1, 1, 1], 80, 'since submitted', { waiting_on_member: 1 }),
    strategic: pendingBlock(PART4_STRATEGIC),
    perks: queue(1, [1, 0, 0], 5, 'since last edit'),
    hosts: queue(1, [1, 0, 0], 2),
    ...(o.waiting || {}),
  };
  const fig = {
    'spinout-lab': () => ({
      figures: { cohort_applications: waiting.cohort.available ? { available: true, count: waiting.cohort.count } : waiting.cohort },
      needs_you: waiting.cohort.available && waiting.hosts.available ? { available: true, count: waiting.cohort.count + waiting.hosts.count } : unreadable('Cohort applications or office-hours hosts'),
    }),
    'mentor-cohorts': () => ({
      figures: { mentors: o.mentors ?? { available: true, count: 1, reason: DEACTIVATED }, coverage: o.coverage ?? { available: true, cohorts: 4, covered: 2, uncovered: 2 } },
      needs_you: { available: true, count: 4 },
    }),
    'refer-and-earn': () => ({
      figures: { open_referrals: waiting.referrals.available ? { available: true, count: 3, waiting_on_member: 1 } : waiting.referrals },
      needs_you: { ...(waiting.referrals.available ? { available: true, count: 3 } : unreadable('Refer & Earn reviews')), strategic_requests: pendingBlock(PART4_STRATEGIC) },
    }),
    perks: () => ({ figures: { live: o.live ?? { available: true, count: 5 }, claims: pendingBlock(PART4_CLAIMS) }, needs_you: waiting.perks.available ? { available: true, count: 1 } : unreadable('Perk listings in review') }),
    learning: () => ({ figures: { programs: o.learning ?? { available: true, published_programs: 2, active_enrolments: 7, join_methods: ['open', 'invite'], scope: superAdmin ? 'every' : 'assigned' } }, needs_you: null }),
    'product-testing': () => (superAdmin ? { figures: { programs: { available: true, open: 2, applications: 9 } }, needs_you: null } : { figures: null, needs_you: null }),
  };
  const programs = o.programs ?? {
    available: true,
    rows: ROWS.map(([key, group, name, purpose, who, join_method, status, position]) => ({
      key, group, name, purpose, who, join_method, status, position, ...(fig[key] ? fig[key]() : { figures: null, needs_you: null }),
    })),
  };
  const credits = superAdmin
    ? (o.credits_monthly ?? {
      available: true,
      months: [
        { month: '2026-08', partial: true, granted: { lab: 600, bounty: 250, manual: 200, referral: null, other_rule: 0, no_rule: 0 }, granted_total: 1050, spent: 800, deducted: 10, refunded: 5 },
        { month: '2026-09', partial: false, granted: { lab: 550, bounty: 300, manual: 150, referral: null, other_rule: 20, no_rule: 0 }, granted_total: 1020, spent: 850, deducted: 0, refunded: 0 },
        { month: '2026-10', partial: true, granted: { lab: 500, bounty: 350, manual: 100, referral: null, other_rule: 0, no_rule: 30 }, granted_total: 980, spent: 950, deducted: 0, refunded: 15 },
      ],
      referral: { recorded: false, reason: 'Referral rewards are not paid in perk credits yet.' },
    })
    : pendingBlock(HQ_READS);
  return {
    weeks: o.weeks ?? 12,
    week_axis: AXIS_12,
    current_week: AXIS_12[AXIS_12.length - 1],
    as_of: '2026-10-24T12:00:00.000Z',
    scope: o.scope ?? { key: 'hq', label: 'HQ-held accounts · axal.vc' },
    programs,
    tiles: {
      running: o.running ?? { available: true, running: 6, by_status: { live: 6, partly_built: 1, not_built: 1, proposed: 1, paused: 0 }, total: 9 },
      people: o.people ?? { available: true, count: 312, previous: 289, covers: ['mentor-cohorts', 'learning', 'refer-and-earn', 'perks'], left_out: [{ program: 'spinout-lab', reason: LAB_PEOPLE }] },
      waiting: o.waitingTile ?? (Object.entries(waiting).filter(([k]) => k !== 'strategic').some(([, v]) => !v.available)
        ? { ...unreadable('The cohort queue'), covers: ['cohort', 'referrals', 'perks', 'hosts'], left_out: [{ queue: 'strategic', reason: PART4_STRATEGIC }] }
        : { available: true, count: 7, oldest_hours: 80, covers: ['cohort', 'referrals', 'perks', 'hosts'], left_out: [{ queue: 'strategic', reason: PART4_STRATEGIC }] }),
      credits: superAdmin ? (o.creditsTile ?? { available: true, granted: 3050, spent: 2600, deducted: 10, refunded: 20, referral: { recorded: false, reason: 'Referral rewards are not paid in perk credits yet.' } }) : pendingBlock(HQ_READS),
    },
    waiting,
    joins_weekly: {
      referrals: o.referralsWeekly ?? weekly([6, 7, 9, 8, 10, 11, 9, 12, 13, 14, 15, 7], 100),
      learning: o.learningWeekly ?? { ...weekly([4, 5, 3, 6, 5, 4, 7, 6, 5, 8, 7, 3], 50), scope: superAdmin ? 'every' : 'assigned' },
      perks: pendingBlock(PART4_CLAIMS),
      lab: o.labWeekly ?? weekly([9, 11, 8, 12, 10, 14, 13, 15, 12, 16, 14, 6], 120),
    },
    credits_monthly: credits,
    definitions: {},
  };
}

/** D960's Lab applications answer: the list and `counts` by status, uncapped. */
export const labAppsBody = (pending = 4) => ({ applications: [], counts: { pending, accepted: 2 } });
