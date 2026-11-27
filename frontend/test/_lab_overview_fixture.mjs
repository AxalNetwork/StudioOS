// D947: a synthetic D944 `GET /api/admin/cohort/overview` answer, shared by the
// Overview and Cohorts tests. The calendar on 2026-10-24 12:00Z: August and
// September finished, October running (Week 4 open), November and December
// scheduled. Stamps are D1's zone-less UTC.
const v = (value) => ({ available: true, value });
export const NOT_INTERVIEWED = 'No admin path records that an interview happened.';
const UNREACHED = { recorded: false, reason: 'Week unlock does not persist a per-founder reached-week ledger.' };

const pad = (n) => String(n).padStart(2, '0');
function weeks(id, y, m, outcomes) {
  return { available: true, items: [1, 2, 3, 4].map((w) => ({
    cohort_cycle_id: id, week_number: w,
    unlock_at: `${y}-${pad(m)}-${pad(1 + (w - 1) * 7)} 04:00:00`,
    deadline_at: `${y}-${pad(m)}-${pad(1 + w * 7)} 04:00:00`,
    state: 'opened', ...(outcomes[w - 1] || { passed: 0, failed: 0, in_grace: 0, pending: 0 }),
    reached: UNREACHED,
  })) };
}
const o = (passed, failed = 0, in_grace = 0, pending = 0) => ({ passed, failed, in_grace, pending });

// Midnight ET is 04:00Z in EDT and 05:00Z in EST (from 1 Nov 2026).
const mid = (y, m, d) => `${y}-${pad(m)}-${pad(d)} ${m === 12 || (m === 11 && d > 1) ? '05' : '04'}:00:00`;
function cohort(id, y, m, status, app_status, nums, wk) {
  const prev = m === 1 ? [y - 1, 12] : [y, m - 1];
  return {
    id, year: y, month: m, status, app_status, cohort: `${y}-${pad(m)}`,
    start_at: mid(y, m, 1), end_at: mid(y, m, 29),
    applications_open_at: mid(prev[0], prev[1], 1),
    applications_close_at: mid(prev[0], prev[1], 25).replace(/(\d\d):00:00$/, (_, h) => `${pad(Number(h) - 1)}:59:59`),
    applied: v(nums.applied), undecided: v(nums.undecided || 0), approved: v(nums.approved || 0),
    waitlisted: v(nums.waitlisted || 0), declined: v(nums.declined || 0), withdrawn: v(nums.withdrawn || 0),
    carried_forward: v(nums.carried_forward || 0), carried_in: v(nums.carried_in || 0),
    started: v(nums.started || 0), interview_set: v(nums.interview_set || 0),
    interviewed: { recorded: false, reason: NOT_INTERVIEWED },
    waiting: v(nums.waiting || 0), in_grace: v(nums.in_grace || 0),
    weeks: wk, incorporated: v(nums.incorporated || 0), certificates_issued: v(nums.certificates_issued || 0),
  };
}

export const overviewFixture = () => {
  const items = [
    cohort(1, 2026, 8, 'completed', 'active', { applied: 20, approved: 15, declined: 4, withdrawn: 1, started: 15, incorporated: 9, certificates_issued: 8 },
      weeks(1, 2026, 8, [o(14, 1), o(13, 1), o(12, 1), o(11, 1)])),
    cohort(2, 2026, 9, 'completed', 'active', { applied: 24, approved: 18, waitlisted: 2, declined: 3, withdrawn: 1, started: 18, incorporated: 5, certificates_issued: 3, carried_in: 2 },
      weeks(2, 2026, 9, [o(17, 1), o(16, 1), o(15, 1), o(14, 1)])),
    cohort(5, 2026, 10, 'active', 'active', { applied: 30, approved: 22, waitlisted: 3, declined: 4, withdrawn: 1, started: 22 },
      weeks(5, 2026, 10, [o(20, 2), o(18, 1, 1), o(17, 0, 1), o(0, 0, 0, 17)])),
    cohort(127923, 2026, 11, 'scheduled', 'open', { applied: 24, approved: 9, waitlisted: 3, undecided: 7, declined: 5, withdrawn: 0, interview_set: 2, waiting: 5 },
      { available: true, items: [] }),
    cohort(263768, 2026, 12, 'scheduled', 'open', { applied: 0 }, { available: true, items: [] }),
  ];
  return {
    as_of: '2026-10-24T12:00:00.000Z', timezone: 'America/New_York',
    blocks: {
      cohorts: { available: true, items },
      applications_per_week: { available: true, items: [
        { start: '2026-10-05 04:00:00', end: '2026-10-12 04:00:00', partial: false, applied: 4 },
        { start: '2026-10-12 04:00:00', end: '2026-10-19 04:00:00', partial: false, applied: 0 },
        { start: '2026-10-19 04:00:00', end: '2026-10-26 04:00:00', partial: true, applied: 6 },
      ] },
      funnel: { available: true, cohort: '2026-10', interview_is_optional: true },
    },
    definitions: {},
  };
};
