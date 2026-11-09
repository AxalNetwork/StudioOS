/**
 * D4811 (#4811) part 3 — the Agreements metric strip's pure rules (board
 * CT-01): six cells from `GET /api/admin/contracts/stats` (`attention`), each
 * with the link that opens the records behind it. Nothing fetches here. A
 * count the Worker did not return is Unreadable; a count that does not apply
 * here (governance on a branch) is Not recorded; neither is ever 0.
 */

const sum = (a, b) => (a == null && b == null ? null : Number(a ?? 0) + Number(b ?? 0));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The governance part of a library cell: its count and how it reads, or why it is absent. */
function governancePart(part) {
  if (!part) return { value: null, line: null };
  if (part.governance_scope === 'branch') return { value: null, line: 'governance is kept at HQ' };
  if (part.governance_scope === 'unreadable' || part.governance == null) return { value: null, line: 'governance unreadable' };
  return { value: Number(part.governance), line: plural(Number(part.governance), 'governance record') };
}

/**
 * The six cells, in the canvas's order. Each is
 * `{ key, label, value, unknown, lines: [string], drill: { kind: 'filter', filters } | { kind: 'tab', tab } , also? }`.
 * `value` null with `unknown` 'unreadable' | 'not_recorded' when the count is not known.
 */
export function metricCells(stats) {
  const a = stats?.attention;
  if (!a) return null;
  const tpl = (part) => (part?.templates == null ? null : Number(part.templates));
  const library = (key, label, part, unit) => {
    const g = governancePart(part);
    const t = tpl(part);
    const value = t == null && g.value == null ? null : sum(t, g.value);
    return {
      key, label, value, unknown: value == null ? 'unreadable' : null,
      lines: [t == null ? 'templates unreadable' : plural(t, 'template'), g.line].filter(Boolean).concat(unit ? [unit] : []),
      drill: { kind: 'tab', tab: 'templates' },
      also: g.value != null ? { label: 'Open governance', to: `/admin/contracts/governance${key === 'legal_review' ? '?records=review_required' : '?records=restricted'}` } : null,
    };
  };
  const stalledLines = [`sent over ${a.stalled?.days ?? 30} days ago`];
  if (Number(a.stalled?.unknown) > 0) stalledLines.push(`${plural(Number(a.stalled.unknown), 'send')} not recorded, so not judged`);
  const executedLines = [`${a.executed?.this_year ?? 0} this year · ${a.executed?.this_month ?? 0} this month`];
  if (Number(a.executed?.undated) > 0) executedLines.push(`${a.executed.undated} with no signature date`);
  return [
    { key: 'awaiting', label: 'Awaiting signature', value: a.awaiting ?? null, unknown: a.awaiting == null ? 'unreadable' : null,
      lines: ['sent, not yet executed'], drill: { kind: 'filter', filters: { status: 'awaiting_signature' } } },
    { key: 'executed', label: 'Executed', value: a.executed?.total ?? null, unknown: a.executed == null ? 'unreadable' : null,
      lines: executedLines, drill: { kind: 'filter', filters: { status: 'signed' } } },
    { key: 'stalled', label: 'Stalled / overdue', value: a.stalled?.count ?? null, unknown: a.stalled == null ? 'unreadable' : null,
      lines: stalledLines, drill: { kind: 'filter', filters: { attention: 'stalled' } } },
    library('legal_review', 'Legal review required', a.legal_review, null),
    library('restricted', 'Restricted', a.restricted, 'confidential or blocked'),
    { key: 'repair', label: 'Data repair required', value: a.repair?.count ?? null, unknown: a.repair == null ? 'unreadable' : null,
      lines: a.repair ? [`${plural(Number(a.repair.evidence), 'signed row')} with no evidence · ${plural(Number(a.repair.unlinked), 'unlinked recipient')}`] : [],
      drill: { kind: 'filter', filters: { attention: 'repair' } } },
  ];
}

/** What an active `?attention=` filter is called above the list, or null. */
export const ATTENTION_LABELS = Object.freeze({
  awaiting: 'Awaiting signature', executed: 'Executed', stalled: 'Stalled: sent over 30 days ago',
  repair: 'Data repair required', repair_evidence: 'Marked signed with no execution evidence', repair_unlinked: 'Unlinked recipients',
});
export const attentionLabel = (key) => ATTENTION_LABELS[key] || null;
