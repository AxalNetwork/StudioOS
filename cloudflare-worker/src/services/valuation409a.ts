/**
 * Build queue #120 — 409A valuation safe-harbour tracking.
 *
 * Pure functions. No D1, no env, no clock — every as-of date is passed
 * in, so the same inputs always produce the same output.
 *
 * Under IRC §409A, an independent appraisal carries a rebuttable
 * presumption of reasonableness ("safe harbour") for **12 months from
 * the valuation date, OR until a material event makes it unreliable —
 * whichever comes first**. Both halves matter: a valuation four months
 * old is worthless for safe-harbour purposes if the company has since
 * priced a round, and code that only counts days would say it is fine.
 *
 * Nothing here is tax advice, and the module deliberately does not
 * compute a fair market value — it tracks the status of an appraisal a
 * qualified provider produced.
 */

export type ValuationMethod = 'income' | 'market' | 'asset' | 'obm' | 'backsolve' | 'other';

export interface Valuation409A {
  /** ISO date the appraisal speaks as of (YYYY-MM-DD). */
  valuation_date: string;
  /** Common-stock fair market value per share. */
  fmv_per_share: number;
  provider?: string | null;
  method?: ValuationMethod | null;
}

export type TriggerKind =
  | 'priced_round'
  | 'material_change'
  | 'secondary_transaction'
  | 'acquisition_discussion'
  | 'financial_restatement';

export interface MaterialEvent {
  kind: TriggerKind;
  /** ISO date the event occurred. */
  occurred_on: string;
  note?: string | null;
}

export type SafeHarbourState = 'valid' | 'expiring' | 'expired' | 'invalidated' | 'none';

export interface SafeHarbourStatus {
  state: SafeHarbourState;
  /** Days remaining in the 12-month window; 0 once elapsed, null with no valuation. */
  days_remaining: number | null;
  /** The 12-month anniversary of the valuation date. */
  expires_on: string | null;
  /** The event that ended the safe harbour early, if any. */
  invalidated_by: MaterialEvent | null;
  /** Plain-language reason, safe to render directly. */
  reason: string;
}

const MS_PER_DAY = 86_400_000;
/** §409A presumption period. */
export const SAFE_HARBOUR_DAYS = 365;
/** Inside this many days, the UI should be pushing for a refresh. */
export const EXPIRING_SOON_DAYS = 60;

function toTime(d: string | null | undefined): number {
  if (!d) return NaN;
  const t = Date.parse(String(d).slice(0, 10));
  return Number.isNaN(t) ? NaN : t;
}

function addDays(iso: string, days: number): string {
  const t = toTime(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + days * MS_PER_DAY).toISOString().slice(0, 10);
}

const TRIGGER_LABEL: Record<TriggerKind, string> = {
  priced_round: 'a priced financing round',
  material_change: 'a material change in the business',
  secondary_transaction: 'a secondary sale of shares',
  acquisition_discussion: 'acquisition discussions',
  financial_restatement: 'a financial restatement',
};

/**
 * Safe-harbour status for the most recent valuation as of `today`.
 *
 * A material event dated AFTER the valuation ends the presumption
 * immediately — that outranks any remaining days, and the returned
 * state is 'invalidated' rather than 'valid'. Events dated before the
 * valuation are ignored: the appraiser is presumed to have priced them
 * in.
 */
export function safeHarbourStatus(
  valuation: Valuation409A | null,
  events: MaterialEvent[],
  today: string,
): SafeHarbourStatus {
  if (!valuation || Number.isNaN(toTime(valuation.valuation_date))) {
    return {
      state: 'none', days_remaining: null, expires_on: null, invalidated_by: null,
      reason: 'No 409A valuation on file. Option grants have no safe harbour behind them.',
    };
  }
  const vTime = toTime(valuation.valuation_date);
  const tTime = toTime(today);
  const expiresOn = addDays(valuation.valuation_date, SAFE_HARBOUR_DAYS);

  // A material event after the valuation date ends the presumption,
  // however many days are nominally left.
  const breaking = events
    .filter(e => {
      const t = toTime(e.occurred_on);
      return !Number.isNaN(t) && t > vTime && (Number.isNaN(tTime) || t <= tTime);
    })
    .sort((a, b) => toTime(a.occurred_on) - toTime(b.occurred_on))[0] || null;

  const daysElapsed = Number.isNaN(tTime) ? 0 : Math.floor((tTime - vTime) / MS_PER_DAY);
  const daysRemaining = Math.max(0, SAFE_HARBOUR_DAYS - daysElapsed);

  if (breaking) {
    return {
      state: 'invalidated',
      days_remaining: daysRemaining,
      expires_on: expiresOn,
      invalidated_by: breaking,
      reason: `Safe harbour ended early on ${breaking.occurred_on} — ${TRIGGER_LABEL[breaking.kind] || 'a material event'} occurred after the valuation date. Commission a refresh before the next grant.`,
    };
  }
  if (daysRemaining === 0) {
    return {
      state: 'expired',
      days_remaining: 0,
      expires_on: expiresOn,
      invalidated_by: null,
      reason: `The 12-month presumption lapsed on ${expiresOn}. Grants made now carry no safe harbour.`,
    };
  }
  if (daysRemaining <= EXPIRING_SOON_DAYS) {
    return {
      state: 'expiring',
      days_remaining: daysRemaining,
      expires_on: expiresOn,
      invalidated_by: null,
      reason: `${daysRemaining} days of safe harbour left (expires ${expiresOn}). A refresh takes weeks — start it now.`,
    };
  }
  return {
    state: 'valid',
    days_remaining: daysRemaining,
    expires_on: expiresOn,
    invalidated_by: null,
    reason: `Valid for another ${daysRemaining} days, until ${expiresOn}, unless a material event intervenes.`,
  };
}

/**
 * The standard trigger checklist, annotated with whether each has
 * fired since the current valuation. Drives the design's "Event
 * triggers" table without hard-coding its rows in the UI.
 */
export function triggerChecklist(
  valuation: Valuation409A | null,
  events: MaterialEvent[],
  today: string,
): Array<{ kind: TriggerKind; label: string; fired: boolean; occurred_on: string | null; note: string }> {
  const vTime = valuation ? toTime(valuation.valuation_date) : NaN;
  const tTime = toTime(today);
  const kinds: TriggerKind[] = [
    'priced_round', 'material_change', 'secondary_transaction',
    'acquisition_discussion', 'financial_restatement',
  ];
  return kinds.map(kind => {
    const hit = events
      .filter(e => e.kind === kind)
      .filter(e => {
        const t = toTime(e.occurred_on);
        if (Number.isNaN(t)) return false;
        if (!Number.isNaN(vTime) && t <= vTime) return false;
        return Number.isNaN(tTime) || t <= tTime;
      })
      .sort((a, b) => toTime(b.occurred_on) - toTime(a.occurred_on))[0] || null;
    return {
      kind,
      label: TRIGGER_LABEL[kind],
      fired: Boolean(hit),
      occurred_on: hit?.occurred_on ?? null,
      note: hit
        ? (hit.note || `Recorded ${hit.occurred_on}. The current valuation predates it.`)
        : 'Nothing recorded since the valuation date.',
    };
  });
}

/**
 * Common-stock FMV as a share of the last preferred price — the sanity
 * check an auditor applies first. A common:preferred ratio far above
 * the customary range (roughly 20-40% pre-exit) is not wrong per se,
 * but it is the number that draws questions.
 *
 * Returns null when either input is missing rather than a fake ratio.
 */
export function commonToPreferredRatio(
  fmvPerShare: number | null | undefined,
  lastPreferredPricePerShare: number | null | undefined,
): { ratio: number; flag: 'low' | 'customary' | 'high' } | null {
  // Reject absent inputs BEFORE coercion: Number(null) is 0, which
  // would otherwise report a missing FMV as a real zero valuation.
  if (fmvPerShare == null || lastPreferredPricePerShare == null) return null;
  const fmv = Number(fmvPerShare);
  const pref = Number(lastPreferredPricePerShare);
  if (!Number.isFinite(fmv) || !Number.isFinite(pref) || pref <= 0 || fmv < 0) return null;
  const ratio = Math.round((fmv / pref) * 1000) / 1000;
  const flag = ratio < 0.1 ? 'low' : ratio > 0.5 ? 'high' : 'customary';
  return { ratio, flag };
}
