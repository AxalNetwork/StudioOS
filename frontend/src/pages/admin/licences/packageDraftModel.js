/**
 * D5897 (#5897, part 1 (b) of #5026) — the rules behind the Axal VC package catalogue's writes (board L29), pure
 * so the tests read them without a page.
 *
 *   - `rowActions(status)`: a Draft row offers Edit draft and Publish…; an Active row offers Retire…; a Retired row
 *     offers nothing. The store's own status decides, never a guess.
 *   - `formFrom(version, items)` and `bodyFrom(form)`: the draft editor's fields as typed text and back. Money is
 *     typed in major units of the version's currency and sent as integer minor units; the multipliers are typed as
 *     decimals (0.8) and sent as ppm. The browser checks only what it must to build a body; every other rule is the
 *     Worker's (`validatePackageInput`), and its refusal is shown in its own words (`refusalLines`).
 *   - `publishConsequence` and `retireConsequence`: what the write will do, said before the reason is asked for,
 *     in L29's words ("Published versions are immutable", "Retire stops new offers").
 *   - `writeFailure(e, verb)`: a refusal (4xx with a sentence) says the Worker refused and why; anything else says
 *     the outcome is not known and that the catalogue was read again. It never says nothing changed.
 */
import { parseMinor, toMajorString } from '../../../lib/money.js';

export const REASON_MIN = 3;
export const REASON_MAX_PACKAGES = 500;
export const NEW_PACKAGE = '__new__';

export function rowActions(status) {
  if (status === 'draft') return ['edit', 'publish'];
  if (status === 'active') return ['retire'];
  return [];
}

export const ACTION_LABELS = Object.freeze({ edit: 'Edit draft', publish: 'Publish…', retire: 'Retire…' });

/** Minor units → the exact major-unit text for an edit box ("10000.00"); null or unusable → "". */
export function majorText(cents, currency) {
  if (cents === null || cents === undefined) return '';
  return toMajorString(cents, currency) ?? '';
}

/** Typed major units → `{ value }` (integer minor units, or null when blank) or `{ error }` in `parseMinor`'s words. */
export function minorFrom(text, currency) {
  if (!String(text ?? '').trim()) return { value: null };
  const r = parseMinor(text, currency);
  return r.ok ? { value: r.minor } : { error: r.message };
}

const ppmText = (ppm) => (ppm === null || ppm === undefined ? '' : String(ppm / 1e6));
function ppmFrom(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return Number.NaN;
  return Math.round(Number(t) * 1e6);
}

/**
 * The editor's starting text. From a version (Edit draft, or Create draft version of an existing key, which starts
 * from that key's newest version) or from nothing (a new key).
 */
export function formFrom(version, items) {
  const v = version || {};
  const currency = v.currency || 'EUR';
  const list = [...(items || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return {
    package_key: v.package_key || '',
    name: v.name || '',
    description: v.description || '',
    currency,
    base: majorText(v.base_annual_fee_cents, currency),
    guidance_min: majorText(v.guidance_min_cents, currency),
    guidance_max: majorText(v.guidance_max_cents, currency),
    floor: ppmText(v.floor_multiplier_ppm),
    ceiling: ppmText(v.ceiling_multiplier_ppm),
    effective_from: v.effective_from || '',
    effective_to: v.effective_to || '',
    programs: list.map((i) => i.program_key).join('\n'),
    // Each kept program keeps its own default flag and metadata; the editor does not draw them.
    kept: Object.fromEntries(list.map((i) => [i.program_key, {
      included_by_default: i.included_by_default !== false && i.included_by_default !== 0,
      metadata: i.metadata ?? null,
    }])),
  };
}

/** The program keys typed, one per line (commas also split), in order, blanks dropped. */
export function programKeys(text) {
  return String(text ?? '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * `{ ok: true, body }` or `{ ok: false, errors }`. Only what a body cannot be built without is checked here: a
 * money or multiplier field that is not a number. Required fields, ranges, dates and program keys are the Worker's.
 */
export function bodyFrom(form, { withKey = false } = {}) {
  const errors = {};
  const currency = String(form.currency || '').trim().toUpperCase();
  const money = (field, label) => {
    const r = minorFrom(form[field], currency);
    if (r.error) errors[field] = `${label}: ${r.error}`;
    return r.error ? null : r.value;
  };
  const mult = (field, label) => {
    const n = ppmFrom(form[field]);
    if (Number.isNaN(n)) errors[field] = `${label}: write a decimal with up to 6 places, such as 0.8.`;
    return Number.isNaN(n) ? null : n;
  };
  const body = {
    name: String(form.name || '').trim(),
    description: String(form.description || '').trim() || null,
    currency,
    base_annual_fee_cents: money('base', 'Global base annual fee'),
    guidance_min_cents: money('guidance_min', 'Guidance from'),
    guidance_max_cents: money('guidance_max', 'Guidance to'),
    floor_multiplier_ppm: mult('floor', 'Floor multiplier'),
    ceiling_multiplier_ppm: mult('ceiling', 'Ceiling multiplier'),
    effective_from: String(form.effective_from || '').trim(),
    effective_to: String(form.effective_to || '').trim() || null,
    items: programKeys(form.programs).map((program_key) => ({
      program_key,
      included_by_default: form.kept?.[program_key]?.included_by_default ?? true,
      metadata: form.kept?.[program_key]?.metadata ?? null,
    })),
  };
  if (withKey) body.package_key = String(form.package_key || '').trim();
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, body };
}

/** The Worker's own field names, in the editor's words, for its field errors. */
const FIELD_WORDS = Object.freeze({
  package_key: 'Package key', name: 'Name', description: 'Description', currency: 'Currency',
  base_annual_fee_cents: 'Global base annual fee', guidance_min_cents: 'Guidance from', guidance_max_cents: 'Guidance to',
  floor_multiplier_ppm: 'Floor multiplier', ceiling_multiplier_ppm: 'Ceiling multiplier',
  effective_from: 'Effective from', effective_to: 'Effective to', items: 'Programs',
});

/**
 * A refusal as lines to show: the Worker's sentence first, then each field error it sent (`fields`), each named in
 * the editor's words and followed by the Worker's own text. Nothing is rewritten.
 */
export function refusalLines(e) {
  const lines = [e?.message || 'The write failed and the Worker sent no reason.'];
  const fields = e?.data?.fields;
  if (fields && typeof fields === 'object') {
    for (const [k, text] of Object.entries(fields)) lines.push(`${FIELD_WORDS[k] || k}: ${text}`);
  }
  return lines;
}

/** A refusal is a 4xx the Worker answered; anything else (5xx, timeout, network) leaves the outcome unknown. */
export function writeFailure(e, verb) {
  const refused = Number.isInteger(e?.status) && e.status >= 400 && e.status < 500;
  return refused
    ? { refused: true, title: `${verb} refused.`, lines: refusalLines(e) }
    : {
      refused: false,
      title: `${verb} may or may not have been saved.`,
      lines: [e?.message || 'No answer from the Worker.', 'The catalogue was read again: what it shows now is what is recorded.'],
    };
}

/** What Publish does, said first. `active` is the key's version in force, if any. */
export function publishConsequence(v, active) {
  const frozen = `${v.name} v${v.version} becomes the version in force, and its programs and prices are frozen from then on.`;
  return active && active.version !== v.version
    ? `${frozen} v${active.version}, active now, is retired: it stops being offered, and licences on it keep it until their review.`
    : `${frozen} No version of this package is active now, so none is retired.`;
}

/** What Retire does, said first. */
export function retireConsequence(v) {
  return `${v.name} v${v.version} stops being offered to licensees. Licences on it keep it until their review. No version of this package is active until another is published.`;
}

/** Where Create draft version starts: the chosen key's newest version, or a new key. */
export function newestOf(versions, packageKey) {
  return [...(versions || [])].filter((v) => v.package_key === packageKey).sort((a, b) => b.version - a.version)[0] || null;
}

/** One option per package key, by name, for the Create draft version chooser. */
export function keyOptions(versions) {
  const seen = new Map();
  for (const v of versions || []) {
    const n = newestOf(versions, v.package_key);
    if (!seen.has(v.package_key)) seen.set(v.package_key, { key: v.package_key, label: `${n.name} (next is v${n.version + 1})` });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}
