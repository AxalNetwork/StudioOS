/**
 * D7828 (#7828): the evidence vocabulary of sourced research facts — who is speaking (statement
 * type), what a source check found (state) and the three dates a fact carries. The company fact
 * store (researchCompanyFacts.ts) uses it, and #7839 and #7841 reuse it.
 *
 * This is NOT the observation vocabulary. A market observation's status (actual, estimate,
 * forecast) and its four observation states belong to #7716; neither list imports the other.
 * Statement type says who is speaking, which is separate from an observation's status. Fund
 * statements (#7743) keep their own columns and are not renamed to this vocabulary.
 *
 * `published_at` and `retrieved_at` are the names market observations already use (migration 767).
 * `reviewed_at` means an Axal admin checked the fact: a screen labels it "Checked by Axal on
 * [date]", never "Reviewed".
 */

/** Who is speaking. "Third-party observation" is never shortened to "Observation" on screen. */
export const STATEMENT_TYPES = Object.freeze([
  'company_statement',
  'registry_fact',
  'third_party_observation',
  'analyst_interpretation',
] as const);
export type StatementType = (typeof STATEMENT_TYPES)[number];

export const STATEMENT_TYPE_LABELS: Readonly<Record<StatementType, string>> = Object.freeze({
  company_statement: 'Company statement',
  registry_fact: 'Registry fact',
  third_party_observation: 'Third-party observation',
  analyst_interpretation: 'Analyst interpretation',
});

/** What a check of a source found. The three absences name the source checked and carry no value. */
export const EVIDENCE_STATES = Object.freeze([
  'found',
  'not_found',
  'not_offered',
  'source_unavailable',
  'outdated',
] as const);
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

/** The states that record a checked absence: a source and a date, never a value. */
export const ABSENCE_STATES: readonly EvidenceState[] = Object.freeze(['not_found', 'not_offered', 'source_unavailable']);

export const EVIDENCE_STATE_LABELS: Readonly<Record<EvidenceState, string>> = Object.freeze({
  found: 'Found',
  not_found: 'Not found at the source checked',
  not_offered: 'Not offered, per the source checked',
  source_unavailable: 'Source unavailable when checked',
  outdated: 'Outdated',
});

/** 'No row': nothing has been recorded, which is not one of the five states above. */
export const NOT_RECORDED = Object.freeze({ state: 'not_recorded', label: 'Not recorded', reason: 'Needs research' });

/** The three dates a fact carries. */
export const EVIDENCE_DATES = Object.freeze(['published_at', 'retrieved_at', 'reviewed_at'] as const);

/** The words for `reviewed_at` on screen. */
export const checkedByAxal = (date: string | null | undefined) =>
  date ? `Checked by Axal on ${String(date).slice(0, 10)}` : null;
