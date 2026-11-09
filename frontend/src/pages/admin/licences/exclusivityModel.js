/**
 * D5019 (#5019) — the Exclusivity panel's rules, pure so the tests read them
 * without a page: the words for a scope, a state and an action; each target
 * year's line (target, measured progress or Not recorded, status); and the
 * body a save sends.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';

export { NOT_RECORDED };

export const SCOPE_LABELS = Object.freeze({
  non_exclusive: 'Non-exclusive',
  country_exclusive: 'National (whole countries)',
  regional_exclusive: 'Regional',
  master_franchise: 'Master franchise',
});

export const STATE_LABELS = Object.freeze({
  draft: 'Draft', in_force: 'In force', at_risk: 'At risk — HQ review', released: 'Released (non-exclusive)', ended: 'Ended',
});

export const ACTION_LABELS = Object.freeze({
  continue: 'Continue as it stands',
  cure_period: 'Give a cure period',
  reduce_territory: 'Reduce the territory',
  convert_non_exclusive: 'Convert to non-exclusive',
  end_exclusivity: 'End exclusivity',
});

export const PROGRESS_LABELS = Object.freeze({
  no_target: 'No target', not_recorded: NOT_RECORDED, in_progress: 'In progress', met: 'Met', missed: 'Missed — HQ review',
});

const METRIC_LABELS = { qualifying_revenue_cents: 'Revenue', cohorts: 'Cohorts', active_members: 'Active members', network: 'Network' };

const money = (cents, currency) => `${currency || ''} ${(Number(cents) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`.trim();
const figure = (metric, v, currency) => (v === null || v === undefined ? NOT_RECORDED : metric === 'qualifying_revenue_cents' ? money(v, currency) : Number(v).toLocaleString());

/** One target year as the panel lists it. An unmeasured target reads Not recorded, never 0. */
export function yearLine(p, currency) {
  return {
    year: p.year,
    label: `Year ${p.year} target`,
    period: `${p.period_start} → ${p.period_end}`,
    status: PROGRESS_LABELS[p.status] || p.status,
    missed: p.status === 'missed',
    metrics: (p.metrics || []).map((m) => ({
      key: m.metric,
      text: `${METRIC_LABELS[m.metric] || m.metric}: ${figure(m.metric, m.measured, currency)} of ${figure(m.metric, m.target, currency)}`,
    })),
  };
}

const codes = (text, re) => [...new Set(String(text || '').split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))].filter((x) => re.test(x));

/** A target year typed in the form: money in currency units, counts as whole numbers, blank for no target. */
function targetOf(t) {
  const n = (v) => (String(v ?? '').trim() === '' ? null : Number(v));
  const revenue = n(t.min_revenue);
  return {
    year: Number(t.year), period_start: t.period_start, period_end: t.period_end,
    min_revenue_cents: revenue === null ? null : Math.round(revenue * 100),
    min_cohorts: n(t.min_cohorts), min_active_members: n(t.min_active_members), min_network: null,
  };
}

/**
 * The save body: the next version over the revision read. Returns `{ ok, body }`
 * or `{ ok: false, errors }`. A reason is required; a scope that needs a
 * territory names one.
 */
export function buildSave({ form, revision }) {
  const errors = {};
  const countries = codes(form.countries, /^[A-Z]{2}$/);
  const regions = codes(form.regions, /^[A-Z0-9-]{2,40}$/);
  if (form.scope_type === 'regional_exclusive' && !regions.length) errors.regions = 'Name at least one region.';
  if ((form.scope_type === 'country_exclusive' || form.scope_type === 'master_franchise') && !countries.length && !regions.length) errors.countries = 'Name the countries this covers.';
  const targets = (form.targets || []).filter((t) => t.period_start || t.period_end || t.min_revenue || t.min_cohorts || t.min_active_members).map(targetOf);
  if (targets.some((t) => !t.period_start || !t.period_end)) errors.targets = 'Each target year needs its start and end dates.';
  if (targets.some((t) => [t.min_revenue_cents, t.min_cohorts, t.min_active_members].some((v) => v !== null && (!Number.isFinite(v) || v < 0)))) errors.targets = 'Targets are amounts and whole numbers, or blank for none.';
  const reason = String(form.reason || '').trim();
  if (reason.length < 3) errors.reason = 'Say why the exclusivity changes. It is kept in the licence\'s history.';
  if (Object.keys(errors).length) return { ok: false, errors };
  const cure = String(form.cure_period_days ?? '').trim();
  return {
    ok: true,
    body: {
      scope_type: form.scope_type,
      territory: { countries, regions },
      ...(form.parent_licence_uid ? { parent_licence_uid: form.parent_licence_uid } : {}),
      ...(form.scope_type === 'master_franchise' ? { child_licence_uids: [...new Set(String(form.children || '').split(/[\s,]+/).map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{1,64}$/.test(x)))] } : {}),
      starts_on: form.starts_on || null, ends_on: form.ends_on || null, review_on: form.review_on || null,
      cure_period_days: cure === '' ? null : Number(cure),
      targets, contractual: form.contractual !== false, reason, expected_revision: revision,
      ...(form.acknowledge ? { acknowledge_agreement_mismatch: true } : {}),
    },
  };
}
