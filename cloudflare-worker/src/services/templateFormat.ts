/**
 * D717 (#1782) — a legal template's document kind and Axal party, as stored on
 * its catalog row (migration 479) or derived from its slug.
 *
 * NULL on the row means "from the slug": `classifyDocument` and
 * `axalEntityKeyForDoc` (legalDocFormat.ts), today's behaviour. A stored value
 * overrides it. This module reads legalDocFormat.ts and never edits it.
 */
import type { Env } from '../types';
import { classifyDocument, axalEntityKeyForDoc, type AxalEntityKey, type DocumentKind } from './legalDocFormat';

/** Every kind the paper draws (legalDocFormat.ts's `DocumentKind`). */
export const TEMPLATE_KINDS: readonly DocumentKind[] = ['agreement', 'corporate', 'resolution', 'unilateral', 'policy', 'notice', 'booklet'];
export type TemplateParty = AxalEntityKey | 'none';
export const TEMPLATE_PARTIES: readonly TemplateParty[] = ['management', 'holdings', 'gp', 'fund', 'none'];
/** Kinds with no Axal party: their party is `none`, and every other kind names an entity. */
export const PARTYLESS_KINDS: ReadonlySet<DocumentKind> = new Set(['unilateral', 'corporate', 'policy']);
/**
 * Kinds fixed by the slug (D716): a notice's sender and the booklet come from
 * #1781's notice types, so neither is ever a stored override, nor can another
 * template be stored as one.
 */
const SLUG_FIXED_KINDS: ReadonlySet<DocumentKind> = new Set(['notice', 'booklet']);

/**
 * The catalog entries created with no body anywhere: D706's 28 (migration
 * 468), D707's two (471) and D716's securities legend (478). Counsel drafts
 * them; test/template_format_d717.test.ts reads them out of the migrations.
 */
export const COUNSEL_DRAFT_SLUGS: ReadonlySet<string> = new Set([
  'certificate_of_limited_partnership_de', 'lpa_amended_restated', 'lpa_initial', 'lp_side_letter', 'mfn_election_form',
  'lp_investor_questionnaire', 'lp_aml_kyc_certification', 'lp_tax_status_certification', 'lp_electronic_delivery_consent',
  'gp_closing_certificate', 'capital_call_notice', 'distribution_notice', 'default_notice', 'lp_interest_transfer', 'lpac_charter',
  'investment_management_agreement', 'gp_llc_agreement', 'gp_fund_formation_consent', 'clawback_guarantee',
  'carried_interest_award_letter', 'form_d_filing_kit', 'bad_actor_questionnaire_506d', 'compliance_manual_code_of_ethics',
  'investor_privacy_notice_reg_sp', 'valuation_policy', 'conflicts_allocation_policy', 'management_rights_letter',
  'pro_rata_information_rights_side_letter',
  'platform_ip_licence_management_admin', 'platform_ip_licence_fund_admin',
  'securities_legend',
]);
/** The documents that carry the Structure of the Fund page (decision 11; PR 1c places it). */
export const STRUCTURE_MAP_SLUGS: ReadonlySet<string> = new Set(['ppm', 'subscription_booklet', 'compliance_manual_code_of_ethics']);

/** The kinds a row may store: every drawn kind but the slug-fixed two. */
export const STORABLE_KINDS: readonly DocumentKind[] = TEMPLATE_KINDS.filter(k => !SLUG_FIXED_KINDS.has(k));

/** A row's format fields as the store routes answer them (decision 2). */
export function formatView(row: { slug: string; category?: string | null; doc_kind?: string | null; axal_party?: string | null }) {
  const eff = effectiveFormat(row);
  return { doc_kind: row.doc_kind ?? null, axal_party: row.axal_party ?? null, kind: eff.kind, party: eff.party,
    format_source: eff.source, format_fixed: formatFixed(row.slug) };
}

/**
 * The editor's choices: the storable kinds, the parties, which kinds are
 * partyless, the slug's own pair, and `entity`, the entity the slug names when
 * the chosen kind takes a party (D717 #1852: a partyless slug's `derived.party`
 * is `none`, which says nothing about the party an agreement kind would print).
 */
export function formatOptions(slug: string, category?: string | null) {
  return { kinds: [...STORABLE_KINDS], parties: [...TEMPLATE_PARTIES], partyless_kinds: [...PARTYLESS_KINDS],
    derived: derivedFormat(slug, category), entity: axalEntityKeyForDoc(slug, category) };
}

export type TemplateFormat = { kind: DocumentKind; party: TemplateParty };
export type FormatSource = 'row' | 'slug';

/** The pair the slug gives: `none` for a partyless kind. */
export function derivedFormat(slug: string, category?: string | null): TemplateFormat {
  const kind = classifyDocument(slug);
  return { kind, party: PARTYLESS_KINDS.has(kind) ? 'none' : axalEntityKeyForDoc(slug, category) };
}

/** Whether a slug's kind is fixed by #1781's notice types (a notice or the booklet). */
export function formatFixed(slug: string): boolean {
  return SLUG_FIXED_KINDS.has(classifyDocument(slug));
}

/** The pair a row prints: each stored column, or the slug's where it is NULL. */
export function effectiveFormat(row: { slug: string; category?: string | null; doc_kind?: string | null; axal_party?: string | null }):
  TemplateFormat & { source: FormatSource } {
  const derived = derivedFormat(row.slug, row.category);
  const kind = (row.doc_kind ?? derived.kind) as DocumentKind;
  const party = (row.axal_party ?? (row.doc_kind ? (PARTYLESS_KINDS.has(kind) ? 'none' : axalEntityKeyForDoc(row.slug, row.category)) : derived.party)) as TemplateParty;
  return { kind, party, source: row.doc_kind != null || row.axal_party != null ? 'row' : 'slug' };
}

export class FormatError extends Error {
  code: 'kind_invalid' | 'kind_not_drawn' | 'party_invalid' | 'kind_party_mismatch';
  constructor(code: FormatError['code'], message: string) { super(message); this.code = code; }
}

const SQL_KINDS = new Set(['agreement', 'corporate', 'resolution', 'unilateral', 'policy', 'notice', 'booklet']);

/**
 * Check a stored pair (either may be null, "from the slug") against the
 * effective values. Throws FormatError with its code.
 */
export function validateFormat(kind: unknown, party: unknown, slug: string, category?: string | null): void {
  if (kind != null && (typeof kind !== 'string' || !SQL_KINDS.has(kind))) throw new FormatError('kind_invalid', 'Kind is agreement, corporate, resolution, unilateral or policy.');
  if (kind != null && (!(TEMPLATE_KINDS as readonly string[]).includes(kind as string) || SLUG_FIXED_KINDS.has(kind as DocumentKind))) {
    throw new FormatError('kind_not_drawn', 'That kind is set by the notice type, not stored on a template.');
  }
  if (party != null && (typeof party !== 'string' || !(TEMPLATE_PARTIES as readonly string[]).includes(party))) {
    throw new FormatError('party_invalid', 'Axal party is management, holdings, gp, fund or none.');
  }
  const eff = effectiveFormat({ slug, category, doc_kind: kind as string | null, axal_party: party as string | null });
  if (PARTYLESS_KINDS.has(eff.kind) !== (eff.party === 'none')) {
    throw new FormatError('kind_party_mismatch', 'A unilateral, corporate or policy document has no Axal party; every other kind names one.');
  }
}

/** The active row's stored pair for a slug, as the paper reads it. Falls back to the slug on any read failure. */
export async function templateFormatFor(env: Env, slug: string): Promise<TemplateFormat & { source: FormatSource }> {
  try {
    const row = await env.DB.prepare('SELECT slug, category, doc_kind, axal_party FROM legal_templates WHERE slug = ? AND is_active = 1')
      .bind(slug).first<{ slug: string; category: string | null; doc_kind: string | null; axal_party: string | null }>();
    if (row && row.slug === slug) return effectiveFormat(row);
  } catch { /* a D1 without migration 479: today's behaviour */ }
  return { ...derivedFormat(slug), source: 'slug' };
}

/** The renderer's two options: an entity key only for a party that names one. */
export function renderFormat(f: { kind: DocumentKind; party: TemplateParty } | { doc_kind?: string | null; axal_party?: string | null } | null | undefined) {
  if (!f) return {};
  const kind = 'kind' in f ? f.kind : f.doc_kind ?? undefined;
  const party = 'party' in f ? f.party : f.axal_party ?? undefined;
  return {
    ...(kind ? { documentKind: kind as DocumentKind } : {}),
    ...(party && party !== 'none' ? { axalEntityKey: party as AxalEntityKey } : {}),
  };
}
