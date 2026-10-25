/**
 * D1141 (#2433) — Product-market fit on Fundraising readiness: model v1 as
 * #2433 defines it once (§ The Product-market fit score), and the words the
 * readiness page draws until the engine computes a score. Pure, so the tests
 * read it without a browser.
 *
 * NOTHING HERE IS A SCORE. No store, service or route computes Product-market
 * fit on `main`: the engine is part 2 (#3029) and the store part 3 (#3030).
 * Until then the part says the score is not computed, never 0, and shows the
 * model it will use (RD4), so a founder can see what will count.
 */

export const TITLE = 'Product-market fit';
export const NOT_YET = 'Not scored yet. No score is computed from Validate yet, so none is shown. This is not a claim that the venture has no fit.';
export const READS = 'It will read only what Validate records: interviews, pains, segments, claims, demand, experiments, the Verdict, and product use once a product is live.';
export const MODEL_VERSION = 'Model v1.0, proposed';

/** The ten inputs of model v1, each with its rule and weight. Weights sum to 100. */
export const INPUTS = [
  { key: 'icp_interviews', name: 'ICP interviews held', rule: '5 points each, full at 20', weight: 10, module: 'customer-research' },
  { key: 'icp_coverage', name: 'ICP coverage', rule: 'share of held interviews with a fit and a segment', weight: 5, module: 'customer-research' },
  { key: 'pain_frequency', name: 'Pain frequency', rule: 'share of ICP interviews naming the top pain, full at 60%', weight: 10, module: 'problem-discovery' },
  { key: 'pain_severity', name: 'Pain severity', rule: 'share judged Severe or Real, full at 70%', weight: 10, module: 'problem-discovery' },
  { key: 'claims_supported', name: 'Claims supported', rule: 'open claims Supported, each by its strongest evidence', weight: 20, module: 'experiments' },
  { key: 'paying_demand', name: 'Paying demand', rule: 'paid deposits, pilots, pre-sales and letters of intent: 1 → 40, 2–4 → 70, 5+ → 100', weight: 15, module: 'demand-signals' },
  { key: 'would_pay', name: 'Would pay', rule: 'confirmed would-pay signals ÷ ICP interviews, full at 40%', weight: 10, module: 'demand-signals' },
  { key: 'waitlist', name: 'Waitlist against the bar', rule: 'sign-ups ÷ the bar you set, capped at 100', weight: 5, module: 'demand-signals' },
  { key: 'experiments', name: 'Experiment outcomes', rule: 'share of done experiments that support', weight: 5, module: 'experiments' },
  { key: 'product_pull', name: 'Product pull', rule: 'activation, week-4 retention and the "very disappointed" share, once a product is live', weight: 10, module: null },
];

export const GRADES = [
  ['Measured', '1.0', 'a recorded session, a connector, the platform\'s waitlist or a verified payment'],
  ['Reviewed', '0.9', 'set by someone other than the founder'],
  ['Sourced', '0.7', 'typed with a file, a link, or a dated record'],
  ['Stated', '0.4', 'typed with no source'],
  ['Not recorded', '0', 'nothing in Validate'],
];

export const BANDS = 'Strong 70 or more · Fair 40–69 · Weak under 40. Below 0.25 confidence it shows "Not enough recorded" and no number.';

/** A Validate module's address, keeping the venture. */
export function validateHref(module, search = '') {
  const m = /[?&](?:project_id|project)=([1-9]\d*)/.exec(String(search || ''));
  return `/validate${module ? `/${module}` : ''}${m ? `?project_id=${m[1]}` : ''}`;
}

/** The readiness page's address, keeping the venture (RD12's door from Validate). */
export function readinessHref(search = '') {
  const m = /[?&](?:project_id|project)=([1-9]\d*)/.exec(String(search || ''));
  return `/raise/fundraising-readiness${m ? `?project_id=${m[1]}` : ''}`;
}

export const totalWeight = () => INPUTS.reduce((s, i) => s + i.weight, 0);
