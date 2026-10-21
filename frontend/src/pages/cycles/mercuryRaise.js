/**
 * D840 part 2 (#2347) — the words for a Raise module's "From Mercury" part,
 * from the module read's `parts.mercury` (`services/mercury/raiseFeeds.ts`).
 *
 * Only the founder's own read carries the part, so nothing here decides who
 * sees it. A figure is shown with where it came from ("From Mercury, as of
 * <date>"); a figure Mercury did not give is "Not recorded", never zero.
 */
export const usd = (cents) => (cents == null || !Number.isFinite(Number(cents)) ? 'Not recorded'
  : `$${Math.round(Number(cents) / 100).toLocaleString('en-US')}`);

export const SECTION_LABELS = {
  product: 'Product & engineering',
  'go-to-market': 'GTM: sales and marketing',
  infrastructure: 'Infrastructure & data',
  operations: 'Operations, legal & compliance',
  reserve: 'Hiring / runway reserve',
};

/** One citable figure's value in words. */
export function figureText(f) {
  if (!f || f.value == null) return 'Not recorded';
  if (f.unit === 'cents') return usd(f.value);
  if (f.unit === 'percent') return `${f.value > 0 ? '+' : ''}${f.value}%`;
  if (f.unit === 'months') return `${f.value} months`;
  return String(f.value);
}

/** The view a module's part draws: what to list, and whether anything arrived. */
export function mercuryView(slug, part) {
  if (!part) return { empty: true };
  if (part.state === 'unreadable') return { empty: false, state: 'unreadable', reason: part.reason || 'Unreadable' };
  const base = { empty: false, state: 'ok', facts: [], proposals: [], figures: [] };
  switch (slug) {
    case 'fundraising-readiness':
      return { ...base, facts: part.runway ? [{ id: part.runway.fact_id, text: part.runway.label, source: part.runway.source, evidence: 'Measured', replaces: part.runway.replaces || null }] : [] };
    case 'use-of-funds':
      return {
        ...base,
        source: part.source || null,
        facts: (part.categories || []).map((c) => ({ id: c.fact_id, text: `${c.category}: ${usd(c.spent_cents)} over the last ${c.months} months`, source: part.source, section: c.section ? SECTION_LABELS[c.section] ?? c.section : null })),
        sections: part.sections || null,
        proposals: (part.proposals || []).map((p) => ({ id: p.id, kind: 'fund_mapping', text: `Count ${p.category} under ${p.section_label || 'a section you choose'}`, section: p.section })),
      };
    case 'data-room':
      return {
        ...base,
        title: part.title,
        proposals: (part.proposals || []).map((p) => ({ id: p.id, kind: 'statement', text: `Statement ${p.month}${p.last_four ? ` · account ending ${p.last_four}` : ''}` })),
        note: 'Each statement you add is NDA and seen by no investor until you open its access.',
      };
    case 'cap-table':
      return {
        ...base,
        proposals: (part.proposals || []).map((p) => ({ id: p.id, kind: 'safe', text: `SAFE · ${p.investor_name || 'Investor not named'} · ${usd(p.amount_cents)}${p.cap_cents ? ` at a ${usd(p.cap_cents)} post-money cap` : ''}` })),
      };
    case 'capital-relationships':
      return {
        ...base,
        proposals: (part.proposals || []).map((p) => ({
          id: p.id, kind: 'investor_credit',
          text: `${usd(p.amount_cents)} from ${p.counterparty || 'a counterparty Mercury did not name'} on ${p.posted_on}${p.last_four ? ` · account ending ${p.last_four}` : ''}`,
          action: p.match ? `Match to ${p.match.name}` : 'Add as a new investor, at Committed',
        })),
      };
    case 'investor-narrative':
    case 'pitch-deck':
      return { ...base, figures: (part.figures || []).map((f) => ({ key: f.key, label: f.label, value: figureText(f), source: f.source, id: f.fact_id })) };
    default:
      return { empty: true };
  }
}

export function isEmptyView(v) {
  return v.empty || (v.state === 'ok' && !v.facts.length && !v.proposals.length && !v.figures.length);
}
