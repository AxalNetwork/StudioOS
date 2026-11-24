/**
 * D7828 (#7828): a company's sourced business facts and what is supported for each research job.
 *
 * Reads research_company_facts (migration 202611232026_7828) for one company the caller's route
 * has already found served through researchCompanyRead (D7819). The publisher a fact names is
 * joined to the publisher reference of D7810 for its licence. Nothing here writes: the store is
 * filled only by migrations compiled from a reviewed manifest (scripts/import-company-facts.mjs).
 *
 * A member read returns the review date, never who reviewed. Completeness gives each job's fields
 * as supported with their evidence or "Not recorded" with "Needs research": no number, no score.
 * A failed read throws; the route answers 503, never an empty list.
 */
import type { Env } from '../types';
import {
  ABSENCE_STATES,
  EVIDENCE_STATE_LABELS,
  NOT_RECORDED,
  STATEMENT_TYPE_LABELS,
  checkedByAxal,
  type EvidenceState,
  type StatementType,
} from './researchEvidenceVocabulary';

/** The closed attribute list; the migration's CHECK holds the same twelve. */
export const COMPANY_FACT_ATTRIBUTES = Object.freeze([
  'product',
  'capability',
  'use_case',
  'buyer',
  'customer_segment',
  'markets_served',
  'business_model',
  'delivery_model',
  'pricing_model',
  'partner_programme',
  'integration_listing',
  'contact_path',
] as const);
export type CompanyFactAttribute = (typeof COMPANY_FACT_ATTRIBUTES)[number];

export const COMPANY_FACT_LABELS: Readonly<Record<CompanyFactAttribute, string>> = Object.freeze({
  product: 'Product',
  capability: 'Capability',
  use_case: 'Use case',
  buyer: 'Buyer',
  customer_segment: 'Customer segment',
  markets_served: 'Markets served',
  business_model: 'Business model',
  delivery_model: 'Delivery model',
  pricing_model: 'Pricing model',
  partner_programme: 'Partner programme',
  integration_listing: 'Integration listing',
  contact_path: 'Contact or application path',
});

/** Caps the migration's CHECKs hold: a passage is a short quotation, never a page. */
export const FACT_VALUE_MAX = 300;
export const FACT_PASSAGE_MAX = 400;

// Explicit member projection: reviewed_by and manifest_name are never selected.
const FACTS_SQL = `SELECT f.id,f.fact_key,f.attribute,f.value,f.statement_type,f.source_url,f.publisher,
 f.passage,f.source_field,f.market_country,f.published_at,f.retrieved_at,f.reviewed_at,f.state,
 f.conflicts_with_key,f.replaces_key,f.replaced_by_key,
 p.licence_id,p.licence_name,p.licence_link,p.required_attribution
 FROM research_company_facts f LEFT JOIN research_company_publishers p ON p.source_name=f.publisher
 WHERE f.company_uid=? ORDER BY f.attribute,f.id`;

type Row = {
  fact_key: string;
  attribute: CompanyFactAttribute;
  value: string | null;
  statement_type: StatementType;
  source_url: string;
  publisher: string;
  passage: string | null;
  source_field: string | null;
  market_country: string | null;
  published_at: string | null;
  retrieved_at: string;
  reviewed_at: string;
  state: EvidenceState;
  conflicts_with_key: string | null;
  replaces_key: string | null;
  replaced_by_key: string | null;
  licence_id: string | null;
  licence_name: string | null;
  licence_link: string | null;
  required_attribution: string | null;
};

export type CompanyFact = ReturnType<typeof project>;

function project(row: Row, conflicts: string[]) {
  return {
    key: row.fact_key,
    attribute: row.attribute,
    attribute_label: COMPANY_FACT_LABELS[row.attribute] ?? row.attribute,
    state: row.state,
    state_label: EVIDENCE_STATE_LABELS[row.state] ?? row.state,
    current: row.state !== 'outdated',
    value: row.value,
    market_country: row.market_country,
    statement_type: row.statement_type,
    statement_type_label: STATEMENT_TYPE_LABELS[row.statement_type] ?? row.statement_type,
    source: {
      url: row.source_url,
      publisher: row.publisher,
      passage: row.passage,
      field: row.source_field,
      licence: row.licence_id
        ? {
            id: row.licence_id,
            name: row.licence_name,
            link: row.licence_link,
            required_attribution: row.required_attribution,
          }
        : null,
      licence_state: row.licence_id ? 'reviewed' : 'licence terms not reviewed',
    },
    published_at: row.published_at,
    retrieved_at: row.retrieved_at,
    reviewed_at: row.reviewed_at,
    checked_label: checkedByAxal(row.reviewed_at),
    conflicts_with: conflicts,
    replaces: row.replaces_key,
    replaced_by: row.replaced_by_key,
  };
}

/** Every fact recorded for one company uid, projected for a member. Errors propagate. */
export async function readCompanyFactRows(env: Pick<Env, 'DB'>, uid: string): Promise<CompanyFact[]> {
  const result = await env.DB.prepare(FACTS_SQL).bind(uid).all<Row>();
  const rows = result.results || [];
  const keys = new Set(rows.map((r) => r.fact_key));
  // A conflict is marked on both sides, whichever side the manifest named it on.
  const conflicts = new Map<string, Set<string>>();
  const mark = (a: string, b: string) => {
    if (!conflicts.has(a)) conflicts.set(a, new Set());
    conflicts.get(a)!.add(b);
  };
  for (const r of rows)
    if (r.conflicts_with_key && keys.has(r.conflicts_with_key)) {
      mark(r.fact_key, r.conflicts_with_key);
      mark(r.conflicts_with_key, r.fact_key);
    }
  return rows.map((r) => project(r, [...(conflicts.get(r.fact_key) ?? [])].sort()));
}

/** A company's facts: current and superseded apart, and each attribute's answer, 'no row' included. */
export function companyFacts(uid: string, facts: CompanyFact[]) {
  const current = facts.filter((f) => f.current);
  const superseded = facts.filter((f) => !f.current);
  const attributes = COMPANY_FACT_ATTRIBUTES.map((attribute) => {
    const own = current.filter((f) => f.attribute === attribute);
    if (!own.length) {
      const old = superseded.some((f) => f.attribute === attribute);
      return {
        attribute,
        label: COMPANY_FACT_LABELS[attribute],
        state: old ? 'outdated' : NOT_RECORDED.state,
        reason: old ? 'Only outdated facts are recorded. Needs research' : NOT_RECORDED.reason,
        facts: [] as string[],
      };
    }
    // Found wins; otherwise the absence most recently checked answers for the attribute.
    const latest = [...own].sort((a, b) => String(b.retrieved_at).localeCompare(String(a.retrieved_at)))[0];
    return {
      attribute,
      label: COMPANY_FACT_LABELS[attribute],
      state: own.some((f) => f.state === 'found') ? 'found' : latest.state,
      reason: null,
      facts: own.map((f) => f.key),
    };
  });
  return {
    uid,
    facts: { current, superseded },
    attributes,
    not_recorded: NOT_RECORDED,
    boundary:
      'Each fact is shown with its source, its passage or field and its dates. An absence names the source checked and when; an attribute with no row reads Not recorded.',
  };
}

type FieldSpec = { field: string; label: string; attributes: CompanyFactAttribute[] };
const one = (attribute: CompanyFactAttribute): FieldSpec => ({
  field: attribute,
  label: COMPANY_FACT_LABELS[attribute],
  attributes: [attribute],
});

/** The audit's two fact-backed jobs and the fields each needs. */
export const FACT_JOBS: Readonly<Record<'competitor_research' | 'partner_discovery', { label: string; fields: FieldSpec[] }>> =
  Object.freeze({
    competitor_research: {
      label: 'Competitor research',
      fields: [
        one('product'),
        { field: 'buyer_or_customer_segment', label: 'Buyer or customer segment', attributes: ['buyer', 'customer_segment'] },
        one('use_case'),
        one('markets_served'),
      ],
    },
    partner_discovery: {
      label: 'Partner discovery',
      fields: [
        one('capability'),
        one('customer_segment'),
        one('markets_served'),
        {
          field: 'partner_path',
          label: 'Partner programme, integration listing or contact path',
          attributes: ['partner_programme', 'integration_listing', 'contact_path'],
        },
      ],
    },
  });

/** Lookup is read from the served record's identity, not from the fact store. */
const LOOKUP_FIELDS = [
  { field: 'name', label: 'Name' },
  { field: 'website', label: 'Website' },
  { field: 'country', label: 'Country' },
] as const;

const needsResearch = (field: string, label: string, checked: CompanyFact[] = []) => ({
  field,
  label,
  status: NOT_RECORDED.state,
  status_label: NOT_RECORDED.label,
  reason: NOT_RECORDED.reason,
  evidence: [] as unknown[],
  checked: checked.map((f) => ({
    key: f.key,
    state: f.state,
    state_label: f.state_label,
    source: f.source,
    retrieved_at: f.retrieved_at,
  })),
});

/** Per-job completeness for one served company record. Every answer is a word, never a number. */
export function companyCompleteness(record: Record<string, any>, facts: CompanyFact[]) {
  const nonBlank = (v: unknown) => typeof v === 'string' && v.trim() !== '';
  const lookupFields = LOOKUP_FIELDS.map(({ field, label }) =>
    nonBlank(record[field])
      ? {
          field,
          label,
          status: 'supported',
          status_label: 'Supported',
          reason: null,
          evidence: [
            {
              value: String(record[field]),
              source: { url: record.source_url ?? null, publisher: record.source_name ?? null },
              as_of: record.as_of ?? null,
            },
          ],
          checked: [],
        }
      : needsResearch(field, label),
  );
  const current = facts.filter((f) => f.current);
  const jobFields = (spec: FieldSpec[]) =>
    spec.map(({ field, label, attributes }) => {
      const found = current.filter((f) => attributes.includes(f.attribute) && f.state === 'found');
      if (!found.length)
        return needsResearch(
          field,
          label,
          current.filter((f) => attributes.includes(f.attribute) && (ABSENCE_STATES as string[]).includes(f.state)),
        );
      return {
        field,
        label,
        status: 'supported',
        status_label: 'Supported',
        reason: null,
        evidence: found.map((f) => ({
          key: f.key,
          attribute: f.attribute,
          value: f.value,
          statement_type: f.statement_type,
          statement_type_label: f.statement_type_label,
          source: f.source,
          published_at: f.published_at,
          retrieved_at: f.retrieved_at,
          reviewed_at: f.reviewed_at,
          checked_label: f.checked_label,
          conflicts_with: f.conflicts_with,
        })),
        checked: [],
      };
    });
  const job = <T extends { status: string }>(label: string, fields: T[]) => ({
    label,
    status: fields.every((f) => f.status === 'supported') ? 'supported' : 'needs_research',
    status_label: fields.every((f) => f.status === 'supported') ? 'Supported' : 'Needs research',
    fields,
  });
  return {
    uid: record.uid,
    jobs: {
      lookup: job('Lookup', lookupFields),
      competitor_research: job(FACT_JOBS.competitor_research.label, jobFields(FACT_JOBS.competitor_research.fields)),
      partner_discovery: job(FACT_JOBS.partner_discovery.label, jobFields(FACT_JOBS.partner_discovery.fields)),
      investment_firm_discovery: {
        label: 'Investment-firm discovery',
        status: 'not_assessed',
        status_label: 'Not assessed in this read',
        reason:
          'Roles are recorded on organisations and mandate statements in the fund statement store (#7743), read through #7748 and #7749.',
        fields: [
          { field: 'organisation_role', label: 'Organisation role', status: 'not_assessed', status_label: 'Not assessed in this read' },
          { field: 'mandate_statements', label: 'Mandate statements', status: 'not_assessed', status_label: 'Not assessed in this read' },
        ],
      },
    },
    boundary: 'Each field is supported with its evidence or reads Not recorded with Needs research. No number and no score.',
  };
}
