/**
 * D1538 (#3787) — a table block's cells as text, with no import at all.
 *
 * A leaf on purpose: the evidence check (`services/raiseClaims.ts`) reads
 * table rows through it, and must not import `slideModel.ts`, whose
 * `sources.ts` reaches the Mercury modules (the D752 member-privacy import
 * graph, `test/mercury_member_privacy_d752.test.mjs`).
 */

/** D1538: one cell as text: its words, its binding's source key, or ✓ / ✗; an empty cell is ''. */
export function cellText(cell: any): string {
  if (cell?.binding?.source_key) return String(cell.binding.source_key);
  if (typeof cell?.check === 'boolean') return cell.check ? '✓' : '✗';
  return typeof cell?.text === 'string' ? cell.text : '';
}

/**
 * D1538: a table block as lines, one per row, cells joined by " · ". The
 * exports write these, and the evidence check reads them, so a typed figure
 * stays beside its row label ("Customers · 42").
 */
export function tableLines(b: any): string[] {
  return (Array.isArray(b?.rows) ? b.rows : []).map((row: any[]) => (Array.isArray(row) ? row : []).map(cellText).join(' · ').trim())
    .filter((l: string) => l.replace(/[\s·]/g, '') !== '');
}
