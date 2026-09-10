/**
 * Deal Flow — the operator's vocabulary, mirrored from the worker.
 *
 * `cloudflare-worker/src/services/dealPassTaxonomy.ts` is the source of truth:
 * its keys are what the CHECK constraint accepts and what the analytics group
 * by. This file exists because the operator needs the LABELS, and a test
 * asserts the two lists agree — a reason added on one side only would either
 * offer a radio D1 rejects at write time, or record a value the chart has no
 * row for.
 */

export const PASS_TAXONOMY = [
  {
    key: 'early',
    label: 'Too early',
    hint: 'Right company, wrong moment — revisit at a defined trigger.',
    revisit:
      'Too-early passes get a revisit trigger. This deal will resurface when the company reports its first paid pilot.',
  },
  {
    key: 'valuation',
    label: 'Valuation',
    hint: 'Thesis holds, entry price does not.',
    revisit:
      'Valuation passes are re-queried at the next round. If the price corrects, this comes back to the board.',
  },
  { key: 'thesis', label: 'Outside thesis', hint: 'Not a sector or stage this fund underwrites.' },
  { key: 'team', label: 'Team', hint: 'Founder-market fit, completeness, or reference concerns.' },
  { key: 'competitive', label: 'Competitive dynamics', hint: 'Crowded, or an incumbent owns the wedge.' },
];

export const PASS_REASON_UNRECORDED = 'unrecorded';

export function passReasonLabel(key) {
  return PASS_TAXONOMY.find((r) => r.key === key)?.label || 'Reason not recorded';
}

export function passReasonRevisit(key) {
  return PASS_TAXONOMY.find((r) => r.key === key)?.revisit || '';
}

/**
 * Stage SLA presets, from the canvas.
 *
 * A VIEWER preference, not fund data: it changes which cards look urgent, not
 * what is true about them. Persisted per browser, never sent to the server —
 * one partner running a tight board must not repaint everyone else's.
 */
export const SLA_PRESETS = [
  { key: 'tight', label: 'Tight', amber: 7, red: 14 },
  { key: 'standard', label: 'Standard', amber: 14, red: 30 },
  { key: 'relaxed', label: 'Relaxed', amber: 21, red: 45 },
];

export const DEFAULT_SLA = 'standard';

export function slaPreset(key) {
  return SLA_PRESETS.find((p) => p.key === key) || SLA_PRESETS[1];
}

/**
 * Band a deal by how long it has sat.
 *
 * Returns 'none' when days is not a number. An unknown age is not a healthy
 * one, but colouring it red would invent urgency the data does not support —
 * so it gets no band at all and reads as what it is.
 */
export function slaBand(days, presetKey = DEFAULT_SLA) {
  if (typeof days !== 'number' || !Number.isFinite(days)) return 'none';
  const p = slaPreset(presetKey);
  if (days >= p.red) return 'red';
  if (days >= p.amber) return 'amber';
  return 'ok';
}

export const SLA_BAND_CLASS = {
  red: 'text-red-700 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-900/20 dark:border-red-800',
  amber: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800',
  ok: 'text-gray-600 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-800/60 dark:border-gray-700',
  none: 'text-gray-500 bg-transparent border-transparent dark:text-gray-500',
};

/** What the platform shows where it has nothing recorded. Never a guess. */
export const NOT_RECORDED = 'Not recorded';

/**
 * Format a percentage that may legitimately have no answer.
 *
 * `null` means the denominator was zero — no deals entered that stage, no
 * passes recorded. Rendering that as "0%" states a fact nobody measured.
 */
export function fmtPct(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return NOT_RECORDED;
  return `${Number(v).toFixed(1).replace(/\.0$/, '')}%`;
}

export function fmtDays(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return NOT_RECORDED;
  return `${Number(v)}d`;
}

/**
 * The five stages the Deals bucket names, and the deal record they translate.
 *
 * LIFTED OUT OF `InvestorDealsWorkspace` SO THE ZONE PAGES CANNOT DISAGREE
 * WITH IT. Canvas ID1 draws a Stage column and ID2/ID3/ID4 each count deals at
 * a stage; four files deriving a stage from `deals.status` four times is four
 * chances for the Pipeline board and the Commit room to disagree about where
 * the same deal is.
 *
 * `deals.status` is a CHECKed set of five — applied | scored | active | funded
 * | rejected — and the bucket's five stages are not the same five. The mapping
 * below is the whole translation, and it is deliberately NOT a rename:
 *
 *   applied  → Sourced      nobody has looked at it yet
 *   scored   → Screening    it has been through the desk
 *   funded   → Closing      the money is agreed
 *   active   → Commit if capital is committed against it, else Diligence.
 *                           `active` covers both halves of the middle, and the
 *                           committed figure is the only thing in the record
 *                           that separates them.
 *   rejected → NO STAGE.    A passed deal is not at a stage, and giving it one
 *                           put it back in the funnel — counted as live, drawn
 *                           in a column it is not in. It is excluded from the
 *                           board and reachable through its own filter.
 */
export const DEAL_STAGES = [
  { id: 'sourcing', label: 'Sourced' },
  { id: 'screening', label: 'Screening' },
  { id: 'diligence', label: 'Diligence' },
  { id: 'commit', label: 'Commit' },
  { id: 'closing', label: 'Closing' },
];

export const DEAL_STAGE_LABEL = Object.fromEntries(DEAL_STAGES.map((s) => [s.id, s.label]));

/** `null` for a passed deal — see DEAL_STAGES. Never a fallback stage. */
export function dealStage(deal) {
  const status = String(deal?.status || '');
  if (status === 'rejected') return null;
  if (status === 'applied') return 'sourcing';
  if (status === 'scored') return 'screening';
  if (status === 'funded') return 'closing';
  return Number(deal?.capital_committed) > 0 ? 'commit' : 'diligence';
}

/**
 * Money, in the shorthand the artboards use, or null.
 *
 * Zero returns null rather than `$0`: a deal with no recorded ask has not
 * asked for nothing.
 */
export function dealMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

/** Whole dollars with separators — the artboard's `$2,985,000` form. */
export function dealMoneyExact(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
