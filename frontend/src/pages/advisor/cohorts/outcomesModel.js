/**
 * D4813 (#4813, package 4) — pure decisions for Outcomes (board C10): the
 * cohort's figures from `GET /me/cohort/:id/outcomes`, and the programme's
 * public figures kept as their own scope.
 *
 * UNKNOWN IS NOT ZERO. A figure whose read failed reads "Not recorded"; a
 * figure whose read stopped at its cap reads "n+"; only a read that worked and
 * found none reads 0.
 *
 * A SHOWCASE IS NOT A TOTAL. The public graduate list and the live tracker are
 * capped selections the marketing page shows. They are labelled as a
 * selection, and the programme's total is `/spinout-lab/stats`'s figure or
 * Not recorded — never the length of a list.
 */
import { dayTime } from './cohortModel.js';

export const SCOPES = Object.freeze([['cohort', 'This cohort'], ['programme', 'Programme outcomes']]);
export const SCOPE_PARAM = 'scope';
export const parseScope = (raw) => (raw === 'programme' ? 'programme' : 'cohort');

/** A counted metric (`{ value, available, truncated }`) as the page prints it. */
export function formatCount(metric) {
  if (!metric || metric.available === false || metric.value == null || !Number.isFinite(Number(metric.value))) return 'Not recorded';
  return metric.truncated ? `${metric.value}+` : String(metric.value);
}

export const reportedLine = (iso) => (dayTime(iso) ? `Reported ${dayTime(iso)} (America/New_York)` : 'Reporting time not recorded');

/** The week the completion figure is about: the current one, else the last with a row, else week 1. */
function headlineWeek(weeks, currentWeek) {
  if (!weeks?.length) return null;
  return weeks.find((w) => w.week_number === currentWeek)
    || [...weeks].reverse().find((w) => w.founders - w.not_assessed > 0)
    || weeks[0];
}

/**
 * The four cohort figures, each with what it counts, its definition, its
 * source and when it was reported.
 */
export function cohortFigures(data, { currentWeek = null, cohortEnded = false } = {}) {
  const m = data?.metrics || {};
  const reported = reportedLine(data?.reported_at);
  const p = m.participants || {};
  const wc = m.week_completion || {};
  const g = m.graduates || {};
  const s = m.sessions || {};
  const hw = wc.available ? headlineWeek(wc.weeks, currentWeek) : null;
  const passed = hw ? { value: hw.passed, available: true, truncated: wc.truncated } : null;
  const ofFounders = hw ? { value: hw.founders, available: true, truncated: wc.truncated } : null;
  return [
    {
      key: 'participants',
      label: 'Participants',
      value: formatCount(p),
      sub: p.visible ? `${formatCount(p.visible)} visible to you` : null,
      definition: p.definition || null, source: p.source || null, reported,
    },
    {
      key: 'week_completion',
      label: hw ? `Week ${hw.week_number} completion` : 'Week completion',
      value: hw ? `${formatCount(passed)} of ${formatCount(ofFounders)}` : 'Not recorded',
      sub: hw ? `${hw.grace} grace · ${hw.failed} failed · ${hw.pending} in progress · ${hw.not_assessed} not assessed` : null,
      definition: wc.definition || null, source: wc.source || null, reported,
    },
    {
      key: 'graduates',
      label: 'Graduates',
      value: formatCount(g),
      sub: g.available && Number(g.value) === 0 && !cohortEnded ? 'None yet · graduation follows week 4' : null,
      definition: g.definition || null, source: g.source || null, reported,
    },
    {
      key: 'sessions',
      label: 'Mentoring sessions held',
      value: formatCount(s),
      sub: s.booked ? `${formatCount(s.booked)} booked` : null,
      definition: s.definition || null, source: s.source || null, reported,
    },
  ];
}

/** The by-week table. `null` when the read failed: Not recorded, never a table of zeros. */
export function completionTable(data) {
  const wc = data?.metrics?.week_completion;
  if (!wc || wc.available === false) return null;
  return (wc.weeks || []).map((w) => ({
    week: w.week_number,
    passed: w.passed, grace: w.grace, failed: w.failed, pending: w.pending, not_assessed: w.not_assessed,
    founders: w.founders,
  }));
}

export const SHOWCASE_LABEL = 'A selection, not a total';

/**
 * The programme scope, from the public endpoints. `stats.companies` is the
 * programme's graduate total (D4659's rule, counted in SQL); the two lists
 * are the public page's selections and are labelled as such.
 */
export function programmeView({ stats, cohort, graduates }) {
  const companies = stats && Number.isFinite(Number(stats.companies)) ? Number(stats.companies) : null;
  return {
    totals: [
      { key: 'companies', label: 'Graduate companies, all cohorts', value: companies == null ? 'Not recorded' : String(companies) },
      { key: 'raised', label: 'Raised by graduates', value: money(stats?.total_raised) ?? 'Not recorded' },
    ],
    active: Array.isArray(cohort) ? cohort : [],
    graduates: Array.isArray(graduates) ? graduates : [],
    graduatesHeading: `Graduate showcase · ${SHOWCASE_LABEL.toLowerCase()}`,
    graduatesNote: (n) => `Showing ${n} graduate ${n === 1 ? 'company' : 'companies'} the public page features. ${companies == null ? 'The programme total is not recorded here.' : `The programme total is ${companies}.`}`,
    activeHeading: `On the public tracker · ${SHOWCASE_LABEL.toLowerCase()}`,
  };
}

export function money(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}
