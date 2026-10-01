/**
 * The dossier's readings that its tests run in Node: the "What's missing"
 * checklist (canvas c0834993, FS4d) and the Last-updated tile.
 *
 * THE CHECKLIST HAS TWO KINDS OF ROW, and they are never counted together.
 * A row derived from a column on the fund is done or a gap. A row the canvas
 * draws that no store holds — a sourced investment, a public size, the partner
 * who will be in the room — is "Not recorded", with its reason, and is not a
 * gap the founder can close from this page. Counting it as one would tell the
 * founder they have work to do that the product gives them nowhere to do.
 */

export const NO_STORE = {
  investments: 'No store holds what a fund has funded yet, so this cannot be checked.',
  size: 'No store holds a fund’s public size yet, so this cannot be checked.',
  partner: 'No store holds the partner who will be in the room yet, so this cannot be checked.',
};

/** The checklist rows for one fund, in the canvas's order. */
export function missingChecklist(fund) {
  if (!fund) return [];
  const bothEnds = fund.cheque_min_cents != null && fund.cheque_max_cents != null;
  const oneEnd = fund.cheque_min_cents != null || fund.cheque_max_cents != null;
  const rows = [
    { key: 'thesis', label: 'Thesis quoted', done: Boolean(fund.thesis),
      sub: fund.thesis ? 'their words, not a paraphrase' : 'record their words on this page' },
    { key: 'cheque', label: 'Cheque range complete', done: bothEnds,
      sub: bothEnds ? 'both ends recorded' : oneEnd ? 'only one end is recorded' : 'neither end is recorded' },
    { key: 'stage', label: 'Stage assessed', done: Boolean(fund.stage_fit),
      sub: fund.stage_fit ? fund.stage_fit : 'not assessed yet' },
    { key: 'path', label: 'Path assessed', done: Boolean(fund.path),
      sub: fund.path === 'warm' ? 'warm' : fund.path === 'cold' ? 'no route in' : 'not recorded yet' },
    { key: 'source', label: 'Source recorded', done: Boolean(fund.source_url),
      sub: fund.source_url ? 'where the research came from' : 'no source URL on this row' },
  ];
  // Only a passed fund is asked for a reason, as the canvas notes.
  if (fund.status === 'passed') {
    rows.push({ key: 'pass', label: 'Pass reason recorded', done: Boolean(fund.pass_reason),
      sub: fund.pass_reason ? 'why it is off the list' : 'a pass with no reason is a fund you will rediscover' });
  }
  rows.push(
    { key: 'investments', label: 'At least one sourced investment', done: null, sub: NO_STORE.investments },
    { key: 'size', label: 'Public size', done: null, sub: NO_STORE.size },
    { key: 'partner', label: 'Partner who will be in the room', done: null, sub: NO_STORE.partner },
  );
  return rows;
}

/** Gaps the founder can close here: derived rows that are not done. */
export function gapCount(rows) {
  return rows.filter((r) => r.done === false).length;
}

/**
 * "3 days ago" from an ISO or SQL timestamp, against `now`; null when the
 * row carries no stamp, which the tile renders as Not recorded.
 */
export function updatedAgo(value, now = new Date()) {
  if (!value) return null;
  const s = String(value);
  const t = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(t.getTime())) return null;
  const days = Math.floor((now.getTime() - t.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
