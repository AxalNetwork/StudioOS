/**
 * D7173 (#7173) — the readings Research › Markets › Top-ranked signals draws,
 * pure so a plain `node --test` can hold them. Built to the D7038 canvas
 * (`design/incoming/Research Markets Ranked Signals and Evidence Page.dc.html`,
 * boards RMS-01 to RMS-08).
 *
 * Rank sets the order; confidence is a separate 0–100 score for how well the
 * recorded evidence backs a signal. The Worker sends it as an integer 0–100
 * (`services/signals/ranking.ts` `computeConfidence`), so it prints as itself
 * plus "%": 82 reads 82%, never 8200%.
 */
import { reportWarn } from '../../lib/log.js';

/** The five read states of the card (RMS-04). */
export function cardState(sigs) {
  if (!sigs || (sigs.status === 'loading' && !sigs.data)) return 'loading';
  if (sigs.status === 'unreadable' || sigs.status === 'not_found') return 'unreadable';
  const d = sigs.data || {};
  if (d.data_state === 'illustrative' && (d.signals || []).length) return 'illustrative';
  if (!(d.signals || []).length) return 'empty';
  return 'live';
}

/**
 * One signal's confidence, as a state (RMS-03):
 *   { state: 'unavailable' }         its evidence could not be read
 *   { state: 'not_recorded' }        null, absent, or outside 0–100 (logged, never clamped)
 *   { state: 'value', pct, zero }    a measured value; a 0 is a value too
 */
export function confidenceState(signal) {
  if (signal?.evidence_state === 'unavailable') return { state: 'unavailable' };
  const v = signal?.confidence_score;
  if (v === null || v === undefined || v === '') return { state: 'not_recorded' };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    reportWarn('Signals:confidence', `confidence outside 0–100 on ${signal?.id ?? 'a signal'}: ${v}`);
    return { state: 'not_recorded' };
  }
  const pct = Math.round(n);
  return { state: 'value', pct, zero: pct === 0 };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Nov 2026" from a stamp, or null when it does not parse (never today). */
export function dayLabel(stamp) {
  if (!stamp) return null;
  const s = String(stamp);
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(s) ? `${s.replace(' ', 'T')}Z` : s);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Evidence newest first by observation date; an undated item goes last. */
export function evidenceNewestFirst(items = []) {
  const at = (e) => { const t = Date.parse(e?.observed_at || ''); return Number.isFinite(t) ? t : -Infinity; };
  return [...items].sort((a, b) => at(b) - at(a));
}

/** The newest observation date, or null when there is no dated evidence. */
export function newestObserved(items = []) {
  const first = evidenceNewestFirst(items)[0];
  return first ? dayLabel(first.observed_at) : null;
}

/** How many kinds of source back the signal. */
export function kindCount(items = []) {
  return new Set(items.map((e) => e?.kind).filter(Boolean)).size;
}

/** A recorded URL that may be linked: http(s) only, else the citation is printed as text. */
export function sourceLink(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return { href: u.href, host: u.host.replace(/^www\./, '') };
  } catch {
    return null;
  }
}

/**
 * The tracked sector a signal's sector names, by EXACT name only (RMS-02).
 * `signal.sector` is free text; a near match is not a destination. A
 * `sector_slug` the Worker sends wins when it names a tracked sector.
 */
export function trackedSectorFor(signal, sectors) {
  const items = sectors || [];
  if (signal?.sector_slug) {
    const bySlug = items.find((s) => s?.slug === signal.sector_slug);
    if (bySlug) return bySlug;
  }
  const name = signal?.sector;
  if (!name) return null;
  return items.find((s) => s?.name === name && s?.slug) || null;
}

/** "Germany", else the region: where the signal is. */
export function geographyOf(signal) {
  return signal?.country || signal?.region || null;
}

/** What confidence measures, in plain words (RMS-03). Never "probability". */
export const CONFIDENCE_MEANS = 'Confidence describes how well the recorded evidence backs this signal: how many different kinds of source agree, how reliable they are and how recent they are. It is not a probability that the market grows or that anyone invests.';
export const ONE_KIND_CAP = 'A signal backed by only one kind of source cannot score above 55%.';
