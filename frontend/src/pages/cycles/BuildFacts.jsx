/** D6040 (#6040): the Build module read's recorded facts, shared by desktop and phone. */
import { buildDecisionModel, DECISION_OUTCOMES } from '../../lib/cofounderMatchViewModel.js';

const text = (v) => typeof v === 'string' && v.trim() ? v : null;
const count = (v) => typeof v === 'number' && Number.isFinite(v) ? String(v) : null;
const words = (v) => text(v)?.replace(/_/g, ' ') || null;
const entityName = (v) => ({ ccorp: 'Delaware C-Corp', pbc: 'Public Benefit Corp', llc: 'LLC' })[text(v)] || text(v);
const object = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const join = (xs) => xs.filter(Boolean).join(' · ') || null;

export function buildFacts(slug, input) {
  const f = object(input);
  if (slug === 'founding-team') {
    const decision = buildDecisionModel({ meta: f.cofounder_decision });
    return [
      { label: 'Option pool', value: count(f.option_pool_pct) == null ? null : `${f.option_pool_pct}%`, source: f.option_pool_source === 'record' ? 'Cap table record' : f.option_pool_source === 'model' ? 'Cap table model' : 'Option pool source not recorded' },
      { label: 'Co-founder decision', value: join([DECISION_OUTCOMES.find((o) => o.value === decision.outcome)?.label, text(decision.note), text(decision.decidedAt)]), source: 'Co-founder Match decision' },
      { label: 'Founder agreements', value: text(f.agreement_reason), source: 'Founder document status' },
    ];
  }
  if (slug === 'company-creation') {
    const ip = object(f.ip);
    const incorporation = object(f.incorporation);
    return [
      { label: 'IP', value: join([words(ip.origin), text(ip.institution), text(ip.research_group), words(ip.tto_status), Array.isArray(ip.ip) ? ip.ip.map(words).filter(Boolean).join(', ') : null]), source: 'Copied spinout IP record' },
      // This legacy snapshot is not the new formation case's live status (#6703/#6704).
      { label: 'Incorporation', value: join([entityName(incorporation.entity), text(incorporation.override_reason)]), source: 'Recorded incorporation workspace snapshot' },
      { label: 'Filings', value: count(f.filings), source: 'Company creation filing records' },
      { label: 'Next filing due', value: text(f.next_filing_due), source: 'Company creation filing due dates' },
    ];
  }
  if (slug === 'product-roadmap') return [
    { label: 'Items', value: count(f.items), source: 'Product roadmap items' },
    { label: 'Shipped this month', value: count(f.shipped_this_month), source: 'Recorded roadmap column moves' },
  ];
  return [];
}

export default function BuildFacts({ cycle, slug, data, status }) {
  if (cycle !== 'build') return null;
  const facts = buildFacts(slug, data?.facts);
  if (!facts.length) return null;
  const unavailable = status === 'unreadable' || status === 'refused';
  const loading = status === 'loading';
  return <dl className="my-3 grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Recorded Build facts" data-testid="build-facts">
    {facts.map((fact) => <div key={fact.label} className="min-w-0 break-words text-[13px]">
      <dt className="font-semibold text-axal-ink dark:text-gray-100">{fact.label}</dt>
      <dd className="m-0 text-axal-muted dark:text-gray-400">{loading ? 'Reading…' : unavailable ? 'Unreadable' : fact.value ?? 'Not recorded'}<small className="block">Source: {fact.source}</small></dd>
    </div>)}
  </dl>;
}
