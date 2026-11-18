// D7180 (#7180, D7046) — what the company profile and the analysis candidate
// print about sourced metrics, evidence records, sector peers and signals,
// kept out of the JSX so it is tested without a browser. Every value is the
// Worker's (`GET /api/research/company-directory/:uid`, `GET /api/competitors/:id`);
// a blank field reads Not recorded and a recorded zero reads 0, never the
// other way round.

import { NOT_RECORDED } from '../../lib/absence.js';
import { money } from '../../lib/companyDirectoryView.js';

export { NOT_RECORDED };

/** Fields no source holds for any directory company (D534): grouped into one Not recorded line. */
export const UNSOURCED = [
  ['Description', 'no source holds one'],
  ['Logo', 'no source holds one'],
  ['Investors', 'no source lists them'],
];

/** The optional identity fields this company lacks, website first when it is blank. */
export function notRecordedFields(item) {
  return [...(item?.website ? [] : [['Website', 'no source lists one']]), ...UNSOURCED];
}

/** A blank cell: null, undefined or an empty string. A 0 is a value. */
export const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');

/**
 * The four evidence collections, in the canvas's order. `key` is the
 * response's own key and the Worker's `?part=` value. Each column is
 * [field, header, kind, currencyField|urlField]; `kind` is text, money,
 * count or link.
 */
export const EVIDENCE_COLLECTIONS = [
  {
    key: 'funding_rounds', title: 'Funding rounds', one: 'round', many: 'rounds',
    columns: [
      ['round_type', 'Round'], ['announcement_date', 'Announced'], ['closing_date', 'Closed'],
      ['amount', 'Amount', 'money', 'currency'], ['lead_investor', 'Lead'],
      ['source_name', 'Publisher', 'link', 'source_url'], ['verified_at', 'Verified'],
    ],
  },
  {
    key: 'employment', title: 'Employment observations', one: 'observation', many: 'observations',
    columns: [
      ['observed_date', 'Observed'], ['employee_count', 'Employees', 'count'],
      ['source', 'Publisher', 'link', 'source_url'], ['verified_at', 'Verified'], ['confidence', 'Confidence'],
    ],
  },
  {
    key: 'financials', title: 'Financial statements', one: 'statement', many: 'statements',
    columns: [
      ['period', 'Period'], ['revenue', 'Revenue', 'money', 'revenue_currency'], ['revenue_growth', 'Growth (as recorded)'],
      ['ebitda', 'EBITDA', 'money', 'revenue_currency'], ['cash', 'Cash', 'money', 'revenue_currency'],
      ['debt', 'Debt', 'money', 'revenue_currency'], ['source_name', 'Publisher', 'link', 'source_url'],
    ],
  },
  {
    key: 'sources', title: 'Field citations', one: 'citation', many: 'citations',
    columns: [
      ['field_name', 'Field'], ['source_name', 'Publisher', 'link', 'source_url'], ['source_type', 'Type'],
      ['publication_date', 'Published'], ['retrieved_at', 'Retrieved'], ['confidence', 'Confidence'],
    ],
  },
];

export const collectionByKey = (key) => EVIDENCE_COLLECTIONS.find((c) => c.key === key) || null;

/** "2 rounds", "1 citation", "0 records". */
export function countLabel(n, one = 'record', many = 'records') {
  const k = Number(n) || 0;
  return `${k} ${k === 1 ? one : many}`;
}

/** One collection's state: unreadable (the read failed), none (read, no row) or ok. */
export function collectionState(c) {
  if (!c || c.status === 'unreadable') return 'unreadable';
  return (c.rows || []).length ? 'ok' : 'none';
}

/** A cell as the record table prints it: Not recorded when blank; a recorded 0 is 0. */
export function cellText(row, [field, , kind, extra]) {
  const v = row?.[field];
  if (blank(v)) return NOT_RECORDED;
  if (kind === 'money') return money(v, row?.[extra] || null);
  if (kind === 'count') return Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US') : String(v);
  return String(v);
}

/** Labels for every column the Worker returns, for the record drawer. Unknown keys print as they are. */
const FIELD_LABELS = {
  round_type: 'Round', stage: 'Stage', announcement_date: 'Announced', closing_date: 'Closed', amount: 'Amount',
  currency: 'Currency', pre_money_valuation: 'Pre-money valuation', post_money_valuation: 'Post-money valuation',
  valuation_currency: 'Valuation currency', lead_investor: 'Lead investor', investors: 'Investors',
  source_name: 'Publisher', source: 'Publisher', source_url: 'Source URL', source_type: 'Source type',
  verified_at: 'Verified', confidence: 'Confidence', observed_date: 'Observed', employee_count: 'Employees',
  period: 'Period', period_type: 'Period type', metric_type: 'Statement type', revenue: 'Revenue',
  revenue_currency: 'Currency', revenue_growth: 'Revenue growth (as recorded)', arr: 'ARR', mrr: 'MRR',
  gross_profit: 'Gross profit', gross_margin: 'Gross margin (as recorded)', ebitda: 'EBITDA',
  ebitda_margin: 'EBITDA margin (as recorded)', net_income: 'Net income', cash: 'Cash', debt: 'Debt',
  burn_rate: 'Burn rate', runway: 'Runway (as recorded)', employees: 'Employees', field_name: 'Field',
  publication_date: 'Published', retrieved_at: 'Retrieved',
};

/**
 * Every column of one record, as the drawer lists it: blank → Not recorded,
 * 0 → 0, and a URL kept as a link. Nothing is dropped and nothing is summed.
 */
export function recordFields(row) {
  return Object.keys(row || {}).map((k) => {
    const v = row[k];
    return { key: k, label: FIELD_LABELS[k] || k, value: blank(v) ? NOT_RECORDED : String(v), recorded: !blank(v), url: /_url$/.test(k) && !blank(v) ? String(v) : null };
  });
}

/** The record's own title in the drawer: its first column's value. */
export function recordTitle(collection, row) {
  const first = collection.columns[0];
  const v = row?.[first[0]];
  return blank(v) ? `${collection.title} · ${NOT_RECORDED}` : String(v);
}

/** The company with one evidence collection replaced: a collection's Retry touches nothing else. */
export function replaceCollection(data, key, collection) {
  return data ? { ...data, [key]: collection } : data;
}

/** The headline metrics, in the canvas's order, with where their supporting records live. */
export const METRICS = [
  { key: 'funding_total', title: 'Funding total', evidence: 'funding_rounds', fields: ['funding_total', 'total_funding', 'funding'], none: 'no source lists funding' },
  { key: 'last_funding', title: 'Last round', evidence: 'funding_rounds', fields: ['last_funding_amount', 'last_funding', 'last_round'], none: 'no source lists a round' },
  { key: 'revenue', title: 'Revenue', evidence: 'financials', fields: ['revenue'], none: 'no source lists revenue' },
  { key: 'headcount', title: 'Employees', evidence: 'employment', fields: ['employee_count', 'employees', 'headcount'], none: 'no source lists a headcount' },
  { key: 'valuation', title: 'Valuation', evidence: null, fields: ['valuation'], none: 'no source lists a valuation' },
  { key: 'market_share_pct', title: 'Market share', evidence: null, fields: ['market_share_pct', 'market_share'], none: 'no source lists a market share' },
];

/** The metric's publisher: the Worker's per-metric one (D7180), else the older `source_name`. */
export const publisherOf = (m) => m?.publisher ?? m?.source_name ?? null;
export const publisherUrlOf = (m) => m?.url ?? m?.source_url ?? null;

/**
 * When the figure was true. `observed_on` only: an unknown date is null and
 * reads Not recorded, never the update date (D7046).
 */
export function observedText(m) {
  if (!m || blank(m.observed_on)) return null;
  return m.observed_basis === 'announced' ? `${m.observed_on} · announced` : String(m.observed_on);
}

/** Where the publisher came from, in words. */
export function provenanceText(m) {
  if (m?.provenance === 'field_citation') return 'cited for this figure';
  if (m?.provenance === 'directory_record') return 'the directory record’s source, shared by its metrics';
  return null;
}

/** The confidence line: the rating and whose it is. */
export function confidenceText(m) {
  if (!m || blank(m.confidence)) return null;
  return m.confidence_basis === 'directory_record' ? `${m.confidence} · one rating for every metric on this record` : String(m.confidence);
}

/** A metric's value as its card prints it. */
export function metricValue(key, m) {
  if (!m || m.status !== 'recorded') return null;
  if (key === 'headcount') return Number(m.value).toLocaleString('en-US');
  if (key === 'market_share_pct') return `${m.value}%`;
  return money(m.value, m.currency);
}

/** A metric's supporting records: the collection rows behind it and the field citations that name it. */
export function metricEvidence(spec, d) {
  const coll = spec.evidence ? d?.[spec.evidence] : null;
  const rows = spec.key === 'last_funding' ? (coll?.rows || []).slice(0, 1) : (coll?.rows || []);
  const cites = (d?.sources?.rows || []).filter((c) => spec.fields.includes(String(c.field_name ?? '').trim().toLowerCase()));
  return {
    collection: spec.evidence ? collectionByKey(spec.evidence) : null,
    collectionState: spec.evidence ? collectionState(coll) : null,
    rows,
    citations: cites,
    citationsState: collectionState(d?.sources),
    count: rows.length + cites.length,
  };
}

/** "Inspect evidence · 2 rounds": what the card's button opens. */
export function evidenceButtonLabel(spec, ev) {
  if (ev.rows.length && ev.collection) return `Inspect evidence · ${countLabel(ev.rows.length, ev.collection.one, ev.collection.many)}`;
  if (ev.citations.length) return `Inspect evidence · ${countLabel(ev.citations.length, 'citation', 'citations')}`;
  return 'Inspect evidence';
}

/**
 * The Worker's peer rule (D7180 `peers.rule`), as one sentence. Without the
 * rule (an older Worker) the sentence is the rule the query has always run.
 */
export function peerRuleText(rule, item, shown, total) {
  const label = rule?.sector_label || item?.sector || '';
  const country = rule ? rule.country : item?.country || null;
  const parts = [`Same sector label “${label}” (case and spaces ignored)`];
  parts.push(country ? `same country (${country}) first, then by name` : 'by name; this company’s country is not recorded');
  if (total != null) parts.push(`${shown} of ${total} shown`);
  return parts.join(' · ');
}

/**
 * When a candidate's signal was true, or when it was recorded. A blank
 * `observed_on` falls back to `created_at` and says so; neither is Not recorded.
 */
export function signalDate(g) {
  if (!blank(g?.observed_on)) return { label: 'Observed', date: String(g.observed_on), note: null };
  if (!blank(g?.created_at)) return { label: 'Recorded', date: String(g.created_at).slice(0, 10), note: 'observed date: not recorded' };
  return { label: 'Date', date: NOT_RECORDED, note: null };
}
