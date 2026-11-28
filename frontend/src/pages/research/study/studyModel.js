/**
 * D7729 (#7729, canvas D7703-p2 RST-01 to RST-03) — what the market study's
 * frame and its Scope section say, read from the study store (D7719,
 * `routes/research_studies.ts`). Pure, so the pages and the tests read the
 * same words.
 *
 * THE SECTIONS. Seven, in the audit's order, each named by the file that
 * builds it under `sections/`. A section whose file exists is built; one whose
 * file is absent is drawn as not built (`studySections`). A later section adds
 * its file and edits nothing here.
 *
 * HONEST STATES. A study read is loading, unreadable or ok; `study: null` is a
 * project with no study (None), never an empty study. A field nobody wrote is
 * Not recorded. The Markets filters a study started from say where listed
 * companies are based, never where its customers are.
 */
import { FRESH_OPTIONS, SRC_OPTIONS, countryName } from '../marketDirectoryQuery.js';

/** The seven sections, in order: address slug, label, and the file under `sections/` that builds it. */
export const STUDY_SECTIONS = Object.freeze([
  { slug: 'scope', label: 'Scope and questions', file: 'ScopeAndQuestions' },
  { slug: 'customers', label: 'Customers and demand', file: 'CustomersAndDemand' },
  { slug: 'size', label: 'Size and scenarios', file: 'SizeAndScenarios' },
  { slug: 'competition', label: 'Competition and pricing', file: 'CompetitionAndPricing' },
  { slug: 'entry', label: 'Entry strategy and risks', file: 'EntryAndRisks' },
  { slug: 'evidence', label: 'Evidence and findings', file: 'EvidenceAndFindings' },
  { slug: 'report', label: 'Report and monitoring', file: 'ReportAndMonitoring' },
]);

/**
 * The sections against the modules the frame's glob found
 * (`{ './sections/<File>.jsx': module }`): each with its number, whether it
 * is built, and its component (the module's default export).
 */
export function studySections(modules = {}) {
  return STUDY_SECTIONS.map((s, i) => {
    const mod = modules[`./sections/${s.file}.jsx`];
    const Component = typeof mod?.default === 'function' ? mod.default : null;
    return { ...s, n: i + 1, built: Boolean(Component), Component };
  });
}

/** `/research/projects/:uid/study` and `/research/projects/:uid/study/:section`. */
export function studyHref(uid, slug = '') {
  return `/research/projects/${encodeURIComponent(uid)}/study${slug ? `/${slug}` : ''}`;
}

/** A study read (`useStudyRead`) as a state: loading, unreadable, not_found, none or ok. */
export function studyState(read) {
  if (!read || read.status === 'loading') return 'loading';
  if (read.status === 'not_found') return 'not_found';
  if (read.status !== 'ok') return 'unreadable';
  return read.value?.study ? 'ok' : 'none';
}

// ---- Limits (the Worker's, mirrored for the forms' own messages) ------------------------

export const STUDY_LIMITS = Object.freeze({ product: 200, product_boundary: 1000, business_model: 500, decision: 1000 });
export const HORIZON_MONTHS_MAX = 120;
export const SEGMENT_LIMITS = Object.freeze({
  name: 120, buyer: 200, end_user: 200, budget_holder: 200, purchasing_unit: 200,
  size_band: 120, exclusions: 1000, sample_note: 1000, sample_limits: 1000,
});
export const SEGMENT_MAX = 12;
export const INDUSTRY_CODES_MAX = 20;
export const CUSTOMER_COUNTRIES_MAX = 60;

/** What a segment counts (the Worker's STATISTICAL_UNITS), in words. */
export const STATISTICAL_UNITS = Object.freeze([
  { value: 'enterprise', label: 'Enterprise' },
  { value: 'establishment', label: 'Establishment' },
  { value: 'legal_unit', label: 'Legal unit' },
  { value: 'household', label: 'Household' },
  { value: 'consumer_unit', label: 'Consumer unit' },
  { value: 'person', label: 'Person' },
]);
/** The industry schemes (the Worker's INDUSTRY_SCHEMES), in words. */
export const INDUSTRY_SCHEMES = Object.freeze([
  { value: 'isic_rev4', label: 'ISIC Rev. 4' },
  { value: 'nace_rev2', label: 'NACE Rev. 2' },
  { value: 'naics_2017', label: 'NAICS 2017' },
  { value: 'naics_2022', label: 'NAICS 2022' },
]);
const labelOf = (list, v) => list.find((o) => o.value === v)?.label || null;
export const unitLabel = (v) => labelOf(STATISTICAL_UNITS, v);
export const schemeLabel = (v) => labelOf(INDUSTRY_SCHEMES, v);

const text = (v) => String(v ?? '').trim();
const orNull = (v) => text(v) || null;

// ---- The venture link -----------------------------------------------------------------

/**
 * The venture as the read gives it: `none`, `readable` (with id and name),
 * `no_access` (linked, but no name and no id may be shown) or `unreadable`.
 */
export function ventureCase(venture) {
  if (!venture) return { state: 'none', id: null };
  if (venture.state === 'readable' && venture.id != null) return { state: 'readable', id: venture.id, name: venture.name || null };
  if (venture.state === 'no_access') return { state: 'no_access', id: undefined };
  return { state: 'unreadable', id: undefined };
}

// ---- Scope: product and decision ----------------------------------------------------

/** The Scope form's draft from a read: every field as text, the venture as the read gives it. */
export function scopeDraft(study, venture) {
  return {
    product: study?.product || '',
    product_boundary: study?.product_boundary || '',
    business_model: study?.business_model || '',
    decision: study?.decision || '',
    horizon_months: study?.horizon_months != null ? String(study.horizon_months) : '',
    venture: ventureCase(venture),
  };
}

/**
 * The form's checks; the Worker checks again. `hasOrigin`: a study made from
 * Markets has its origin, so it is never empty.
 */
export function scopeErrors(draft, { hasOrigin = false } = {}) {
  const errors = {};
  for (const name of Object.keys(STUDY_LIMITS)) {
    if (text(draft[name]).length > STUDY_LIMITS[name]) errors[name] = `Keep this under ${STUDY_LIMITS[name]} characters.`;
  }
  const h = text(draft.horizon_months);
  if (h && !(/^\d+$/.test(h) && Number(h) >= 1 && Number(h) <= HORIZON_MONTHS_MAX)) {
    errors.horizon_months = `The horizon is a whole number of months from 1 to ${HORIZON_MONTHS_MAX}.`;
  }
  if (draft.venture?.id === undefined) {
    errors.venture = draft.venture?.state === 'no_access'
      ? 'A venture you can no longer read is linked. Unlink it to save; its name and id cannot be sent back.'
      : 'The linked venture could not be read. Try again before saving, so the link is kept.';
  }
  const empty = Object.keys(STUDY_LIMITS).every((n) => !text(draft[n])) && !h && draft.venture?.id == null;
  if (empty && !hasOrigin) errors.empty = 'Write at least one field of the study.';
  return errors;
}

/** The PUT body: every field (a field not sent is written as not recorded), with the version read. */
export function scopeBody(draft, version) {
  const h = text(draft.horizon_months);
  return {
    version,
    product: orNull(draft.product),
    product_boundary: orNull(draft.product_boundary),
    business_model: orNull(draft.business_model),
    decision: orNull(draft.decision),
    horizon_months: h ? Number(h) : null,
    venture_id: draft.venture?.id ?? null,
  };
}

// ---- Segments -------------------------------------------------------------------------

const listText = (list) => (Array.isArray(list) ? list.join(', ') : '');
/** A comma- or space-separated list, trimmed and deduplicated. */
export function splitList(value, { upper = false } = {}) {
  const out = [];
  for (const part of String(value ?? '').split(/[,\s]+/)) {
    const v = upper ? part.trim().toUpperCase() : part.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** A segment's form draft; a new segment starts empty, its customer countries included. */
export function segmentDraft(seg) {
  return {
    name: seg?.name || '',
    buyer: seg?.buyer || '',
    end_user: seg?.end_user || '',
    budget_holder: seg?.budget_holder || '',
    purchasing_unit: seg?.purchasing_unit || '',
    statistical_unit: seg?.statistical_unit || '',
    industry_scheme: seg?.industry_scheme || '',
    industry_codes: listText(seg?.industry_codes),
    size_band: seg?.size_band || '',
    customer_countries: listText(seg?.customer_countries),
    exclusions: seg?.exclusions || '',
    beachhead: Boolean(seg?.beachhead),
    sample_note: seg?.sample_note || '',
    sample_limits: seg?.sample_limits || '',
    validate_segment_id: seg?.validate_segment?.state === 'readable' ? seg.validate_segment.id : null,
  };
}

/** Whether a segment can be saved from here: a Validate link that cannot be read would be lost. */
export function segmentEditable(seg) {
  const v = seg?.validate_segment;
  if (!v || v.state === 'readable') return { ok: true };
  return {
    ok: false,
    reason: v.state === 'no_access'
      ? 'Its Validate link belongs to a venture you can no longer read. Unlink the venture on Scope to edit it.'
      : 'Its Validate link could not be read just now. Try again before editing, so the link is kept.',
  };
}

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,15}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

export function segmentErrors(draft) {
  const errors = {};
  if (!text(draft.name)) errors.name = 'A segment needs a name.';
  for (const name of Object.keys(SEGMENT_LIMITS)) {
    if (text(draft[name]).length > SEGMENT_LIMITS[name]) errors[name] = `Keep this under ${SEGMENT_LIMITS[name]} characters.`;
  }
  const codes = splitList(draft.industry_codes);
  if (codes.some((c) => !CODE_RE.test(c))) errors.industry_codes = 'Each industry code is up to 16 letters, digits, dots or hyphens.';
  else if (codes.length > INDUSTRY_CODES_MAX) errors.industry_codes = `Name at most ${INDUSTRY_CODES_MAX} industry codes.`;
  else if (codes.length && !draft.industry_scheme) errors.industry_scheme = 'Name the industry scheme the codes belong to.';
  const countries = splitList(draft.customer_countries, { upper: true });
  if (countries.some((c) => !COUNTRY_RE.test(c))) errors.customer_countries = 'Each customer country is a two-letter code, such as DE.';
  else if (countries.length > CUSTOMER_COUNTRIES_MAX) errors.customer_countries = `Name at most ${CUSTOMER_COUNTRIES_MAX} customer countries.`;
  return errors;
}

/** A segment's PUT or POST body: every field, empty text as not recorded. */
export function segmentBody(draft, version) {
  const body = {
    name: text(draft.name),
    buyer: orNull(draft.buyer),
    end_user: orNull(draft.end_user),
    budget_holder: orNull(draft.budget_holder),
    purchasing_unit: orNull(draft.purchasing_unit),
    statistical_unit: draft.statistical_unit || null,
    industry_scheme: draft.industry_scheme || null,
    industry_codes: splitList(draft.industry_codes),
    size_band: orNull(draft.size_band),
    customer_countries: splitList(draft.customer_countries, { upper: true }),
    exclusions: orNull(draft.exclusions),
    beachhead: Boolean(draft.beachhead),
    validate_segment_id: draft.validate_segment_id ?? null,
    sample_note: orNull(draft.sample_note),
    sample_limits: orNull(draft.sample_limits),
  };
  if (version !== undefined) body.version = version;
  return body;
}

/** A segment's rows as the card shows them; null is Not recorded. */
export function segmentRows(seg) {
  const industry = seg?.industry_codes?.length
    ? `${schemeLabel(seg.industry_scheme) || 'Scheme not recorded'} · ${seg.industry_codes.join(', ')}`
    : (seg?.industry_scheme ? schemeLabel(seg.industry_scheme) : null);
  return [
    ['Buyer', seg?.buyer || null],
    ['User', seg?.end_user || null],
    ['Budget holder', seg?.budget_holder || null],
    ['Purchasing unit', seg?.purchasing_unit || null],
    ['What is counted', unitLabel(seg?.statistical_unit)],
    ['Size band', seg?.size_band || null],
    ['Industry', industry],
    ['Exclusions', seg?.exclusions || null],
    ['Sample note', seg?.sample_note || null],
    ['Sample limits', seg?.sample_limits || null],
  ];
}

/** Customer countries in words: none chosen is its own answer, never filled from Markets. */
export function countriesWords(codes) {
  return Array.isArray(codes) && codes.length ? codes.map(countryName).join(', ') : null;
}

/** Owner answer Q5 A: the segment the "Use … as customer geography?" offer is for, or null. */
export function geographyOffer(study, segments) {
  const countries = study?.origin?.markets_company_location_filters?.country || [];
  if (!countries.length) return null;
  const open = (segments || []).filter((s) => !s.archived && !(s.customer_countries || []).length && segmentEditable(s).ok);
  const target = open.find((s) => s.beachhead) || open[0];
  return target ? { segment: target, countries } : null;
}

// ---- The origin -----------------------------------------------------------------------

/** The Markets filters in words, labelled as company location. */
export function originFilterWords(filters) {
  const parts = [];
  const countries = Array.isArray(filters?.country) ? filters.country : [];
  if (countries.length) parts.push(['companies based in', countries.map(countryName).join(', ')]);
  const fresh = FRESH_OPTIONS.find((o) => o.value === filters?.fresh);
  if (fresh) parts.push(['freshness', fresh.label.toLowerCase()]);
  const src = SRC_OPTIONS.find((o) => o.value === filters?.src);
  if (src) parts.push(['source', src.label.toLowerCase()]);
  return parts;
}

/** The read's origin, or null for a study not started from Markets. */
export function originOf(study) {
  const o = study?.origin;
  if (!o?.market?.slug) return null;
  return {
    market: o.market.name || o.market.slug,
    sector: o.tracked_sector || { state: 'none' },
    filters: o.markets_company_location_filters || {},
  };
}

/** One request id per New research form (`/with-study`): 8 to 64 letters, digits or hyphens. */
export function newRequestId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch { /* fall through */ }
  return `nr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; // clock-ok: a request id, not a time
}
