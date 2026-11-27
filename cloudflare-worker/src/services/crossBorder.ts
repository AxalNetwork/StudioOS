/**
 * D4811 (#4811) part 17 — cross-border fields (board CT-15) and the entities'
 * formation jurisdiction (question A, answered by the owner on 2026-11-09:
 * all three Axal VC entities are Delaware LLCs). Pure: the routes read and
 * write `agreement_cross_border` (migration 202611092305) and this file says
 * what a record must carry and which checks are still open.
 *
 *   - Governing law is what was entered; nothing here defaults it.
 *   - The three facts are resolved when entered; the four reviews are open,
 *     resolved (with a note) or not applicable (with a note saying why).
 *   - While any check is open, the agreement is not sent for signature, and
 *     the refusal names the open checks.
 */

/** The owner's answer to question A (2026-11-09). */
export const ENTITY_JURISDICTIONS = Object.freeze({ holdings: 'Delaware, United States', management: 'Delaware, United States', gp: 'Delaware, United States' } as const);
export const entityJurisdiction = (key: string): string | null => (ENTITY_JURISDICTIONS as Record<string, string>)[key] ?? null;

export const FACTS = Object.freeze([
  ['counterparty_jurisdiction', 'Counterparty jurisdiction', 120],
  ['governing_law', 'Governing law', 200],
  ['performance_countries', 'Countries of performance', 300],
] as const);
export const REVIEWS = Object.freeze([
  ['tax', 'Tax review'],
  ['data_transfer', 'Data-transfer mechanism'],
  ['local_counsel', 'Local-counsel review'],
  ['sanctions', 'Sanctions / trade review'],
] as const);
export const REVIEW_STATUSES = Object.freeze(['open', 'resolved', 'not_applicable'] as const);

type Refusal = { status: 422; code: string; message: string };
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

/** The row a PUT writes, or the refusal. A resolved or not-applicable review carries a note. */
export function recordOf(body: any): { ok: true; value: Record<string, string | null> } | { ok: false; refusal: Refusal } {
  const value: Record<string, string | null> = {};
  for (const [key, , max] of FACTS) value[key] = text(body?.[key], max) || null;
  for (const [key, label] of REVIEWS) {
    const status = body?.[`${key}_status`] ?? 'open';
    if (!(REVIEW_STATUSES as readonly string[]).includes(status)) return { ok: false, refusal: { status: 422, code: 'status_invalid', message: `${label}: choose open, resolved or not applicable. Nothing was saved.` } };
    const note = text(body?.[`${key}_note`], 500) || null;
    if (status !== 'open' && !note) return { ok: false, refusal: { status: 422, code: 'note_required', message: `${label}: say how it was resolved, or why it does not apply. Nothing was saved.` } };
    value[`${key}_status`] = status;
    value[`${key}_note`] = note;
  }
  return { ok: true, value };
}

/** The seven checks in the canvas's order: `{ key, label, value, state: 'resolved' | 'open' | 'not_applicable' }`. */
export function checksOf(row: Record<string, any> | null) {
  if (!row) return null;
  const facts = FACTS.map(([key, label]) => ({ key, label, value: row[key] ?? null, state: row[key] ? 'resolved' : 'open' }));
  const reviews = REVIEWS.map(([key, label]) => ({ key, label, value: row[`${key}_note`] ?? null, state: row[`${key}_status`] ?? 'open' }));
  return [...facts, ...reviews];
}

/** The refusal to send while checks are open, or null. */
export function sendRefusal(row: Record<string, any> | null): { code: string; message: string; open: string[] } | null {
  const checks = checksOf(row);
  if (!checks) return null;
  const open = checks.filter((c) => c.state === 'open').map((c) => c.label);
  if (!open.length) return null;
  return { code: 'cross_border_open', open, message: `Not sent: ${open.length} cross-border ${open.length === 1 ? 'check is' : 'checks are'} open (${open.join(', ')}). Resolve ${open.length === 1 ? 'it' : 'them'} on the agreement first.` };
}
