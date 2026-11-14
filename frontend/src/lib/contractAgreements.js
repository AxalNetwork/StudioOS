// D5050 (#5050): the licence agreements in Contracts — the filter choices the Worker accepts on
// GET /api/admin/contracts (services/contractAgreementSources.ts) and the context line a row shows.
import { PROGRAMS } from './programGrants.js';

/** `agreement_type`, in the Worker's order. */
export const AGREEMENT_TYPE_OPTIONS = [
  ['', 'Any agreement type'],
  ['territory_licence', 'Territory licence'],
  // D5060 (#5060): the four user licence agreements, in the Worker's order.
  ['founder_licence', 'Founder Licence Agreement'],
  ['investor_licence', 'Investor Licence Agreement'],
  ['operating_partner_licence', 'Operating Partner Licence Agreement'],
  ['advisor_licence', 'Advisor Licence Agreement'],
  ['package', 'Package agreement'],
  ['program_licence', 'Program licence'],
  ['program_schedule_addendum', 'Program schedule / addendum'],
];

/** `agreement_status`: the legal document's own state, never the program grant's. */
export const LEGAL_STATUS_OPTIONS = [
  ['', 'Any legal state'],
  ['draft', 'Draft'],
  ['awaiting_signature', 'Awaiting signature'],
  ['executed', 'Executed'],
  ['superseded', 'Superseded'],
  ['voided', 'Voided'],
];

/** The Axal VC packages (#5021 builds their store; the keys are D5049's). */
export const PACKAGE_OPTIONS = [
  ['', 'Any package'],
  ['core_network', 'Core Network'],
  ['talent_learning', 'Talent & Learning'],
  ['venture_building', 'Venture Building'],
  ['full_axal_vc', 'Full Axal VC operating system'],
];

export const PROGRAM_OPTIONS = [['', 'Any program'], ...PROGRAMS.map((p) => [p.key, p.name])];

/**
 * D5050 part 2 (board CT-18): what a row says about the licence agreement it is, without opening it: territory,
 * licence, Axal VC package (with its version) and program, in the canvas's order. A user licence agreement with no
 * territory names its holder first. Null when the row is not a licence agreement.
 */
export function agreementContextLine(agreement) {
  if (!agreement) return null;
  const territory = (agreement.territory || []).join(', ');
  const pkg = agreement.package_name ? [agreement.package_name, agreement.package_version ? `v${agreement.package_version}` : null].filter(Boolean).join(' ') : null;
  return [
    territory || agreement.holder?.name || null,
    agreement.licence_ref || agreement.licence_uid,
    pkg,
    agreement.program_name || null,
  ].filter(Boolean).join(' · ') || null;
}

/** The template that produced it, as a row prints it: a source, never a state (CT-19: a template is not in this list). */
export function agreementTemplateLine(agreement) {
  if (!agreement) return null;
  return agreement.template_version ? `${agreement.template_slug} v${agreement.template_version}` : agreement.template_slug;
}

/* ── D5050 part 2 (board CT-17): the Agreements filter row and its chips ───────────────────────────────── */

/**
 * The CT-17 filters as the page keeps them in its address: each is a GET /api/admin/contracts parameter
 * (services/contractAgreementSources.ts `agreementFilters`, and the union's own `template`).
 */
export const AGREEMENT_FILTER_KEYS = Object.freeze(['agreement_type', 'agreement_status', 'licence', 'territory', 'program', 'package', 'template', 'signed_from', 'signed_to']);

/** `agreement_type` holds one type or several, comma separated (the Worker reads it the same way). */
export const typesOf = (value) => [...new Set(String(value || '').split(',').map((t) => t.trim()).filter(Boolean))];
const labelIn = (options, value) => options.find(([v]) => v === value)?.[1] || value;

/** The filter buttons in the row (CT-17), in the canvas's order: id, name on the desktop row, name on a phone. */
export const FILTER_BUTTONS = Object.freeze([
  ['type', 'Agreement type', 'Type'], ['state', 'Legal state', 'Legal state'], ['licence', 'Licence / territory', 'Licence'],
  ['program', 'Program', 'Program'], ['package', 'Axal VC package', 'Package'], ['template', 'Template', 'Template'],
  ['signed', 'Executed date', 'Executed'],
]);

/** What one filter button reads after its name: the value (one), the count (several), or null while unset. */
export function filterButtonValue(id, filters = {}) {
  const f = filters || {};
  if (id === 'type') { const t = typesOf(f.agreement_type); return t.length > 1 ? String(t.length) : t.length ? labelIn(AGREEMENT_TYPE_OPTIONS, t[0]) : null; }
  if (id === 'state') return f.agreement_status ? labelIn(LEGAL_STATUS_OPTIONS, f.agreement_status) : null;
  if (id === 'licence') return [f.territory ? String(f.territory).toUpperCase() : null, f.licence || null].filter(Boolean).join(' · ') || null;
  if (id === 'program') return f.program ? labelIn(PROGRAM_OPTIONS, f.program) : null;
  if (id === 'package') return f.package ? labelIn(PACKAGE_OPTIONS, f.package) : null;
  if (id === 'template') return f.template || null;
  if (id === 'signed') return f.signed_from || f.signed_to ? `${f.signed_from || '…'} – ${f.signed_to || '…'}` : null;
  return null;
}

/**
 * The active-filter chips (CT-17 "Active filters"): one per value, each removable on its own. Several agreement
 * types are several chips; removing one keeps the others.
 */
export function activeAgreementChips(filters = {}) {
  const f = filters || {};
  const chips = typesOf(f.agreement_type).map((t) => ({ key: 'agreement_type', value: t, label: `Type: ${labelIn(AGREEMENT_TYPE_OPTIONS, t)}` }));
  if (f.agreement_status) chips.push({ key: 'agreement_status', label: `Legal state: ${labelIn(LEGAL_STATUS_OPTIONS, f.agreement_status)}` });
  if (f.licence) chips.push({ key: 'licence', label: `Licence: ${f.licence}` });
  if (f.territory) chips.push({ key: 'territory', label: `Territory: ${String(f.territory).toUpperCase()}` });
  if (f.program) chips.push({ key: 'program', label: `Program: ${labelIn(PROGRAM_OPTIONS, f.program)}` });
  if (f.package) chips.push({ key: 'package', label: `Package: ${labelIn(PACKAGE_OPTIONS, f.package)}` });
  if (f.template) chips.push({ key: 'template', label: `Template: ${f.template}` });
  if (f.signed_from) chips.push({ key: 'signed_from', label: `Executed from ${f.signed_from}` });
  if (f.signed_to) chips.push({ key: 'signed_to', label: `Executed to ${f.signed_to}` });
  return chips;
}

/** The filters with one chip removed, back on the first page. */
export function withoutChip(filters = {}, chip) {
  const next = { ...filters, offset: 0 };
  if (chip.key === 'agreement_type' && chip.value) next.agreement_type = typesOf(filters.agreement_type).filter((t) => t !== chip.value).join(',');
  else next[chip.key] = '';
  return next;
}

/** The filters with every CT-17 filter cleared; search, status, sort and the rest stay. */
export function withoutAgreementFilters(filters = {}) {
  return { ...filters, ...Object.fromEntries(AGREEMENT_FILTER_KEYS.map((k) => [k, ''])), offset: 0 };
}

/** One agreement type switched on or off in the multi-select, in the Worker's order. */
export function toggleType(value, type) {
  const now = typesOf(value);
  const next = now.includes(type) ? now.filter((t) => t !== type) : [...now, type];
  const order = AGREEMENT_TYPE_OPTIONS.map(([v]) => v);
  return next.sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(',');
}

/**
 * A typed value for a text filter, or why it cannot be sent (the Worker refuses it with 400 otherwise): a
 * licence reference or uid, an ISO-2 territory, a template slug, a YYYY-MM-DD date.
 */
export function checkFilterText(key, raw) {
  const v = String(raw ?? '').trim();
  if (!v) return { ok: true, value: '' };
  if (key === 'licence') return /^[A-Za-z0-9_-]{1,64}$/.test(v) ? { ok: true, value: v } : { ok: false, reason: 'A licence is its reference or uid: letters, digits, - and _.' };
  if (key === 'territory') return /^[A-Za-z]{2}$/.test(v) ? { ok: true, value: v.toUpperCase() } : { ok: false, reason: 'A territory is a two-letter country code, such as FR.' };
  if (key === 'template') return /^[a-z0-9][a-z0-9_-]{0,99}$/.test(v) ? { ok: true, value: v } : { ok: false, reason: 'A template is its slug, such as program_schedule.' };
  if (key === 'signed_from' || key === 'signed_to') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? { ok: true, value: v } : { ok: false, reason: 'A date is YYYY-MM-DD.' };
  return { ok: true, value: v };
}

/* ── D5050 part 2 (boards CT-18, CT-19): the legal state beside the lifecycle, and the never-sent version ── */

/** The legal-state word beside the lifecycle pill ("legal state · awaiting signature"). */
export const legalStateWord = (agreement) => (agreement?.legal_status_label ? String(agreement.legal_status_label).toLowerCase() : null);

/** Whether a row is a licence agreement version with no envelope: it opens on its licence, never as a document. */
export const hasNoEnvelope = (row) => !!row?.agreement && !row.agreement.envelope_uuid;

/**
 * CT-19: a version prepared and never sent has no envelope. It is neither signed nor a template, and reads
 * "Prepared · not sent · no envelope".
 */
export const isNeverSent = (row) => hasNoEnvelope(row) && !row.agreement.sent_at && row.status === 'draft';
export const NEVER_SENT_LABEL = 'Prepared · not sent · no envelope';

/** Where a row's document opens: the agreement workspace for an envelope's row; null for a version with none. */
export function documentLink(row) {
  if (!row?.agreement || hasNoEnvelope(row) || row.source !== 'esign') return null;
  return {
    to: `/admin/contracts/agreements/doc/${encodeURIComponent(row.uid)}`,
    label: row.agreement.document_available ? 'View / download agreement' : 'View agreement',
  };
}
