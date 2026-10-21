/**
 * D840 part 3 (#2348) — the words for a Grow module's "From Mercury" part,
 * from the module read's `parts.from_mercury`. Pure, so
 * `frontend/test/grow_from_mercury_d840.test.mjs` holds each rule.
 *
 * The Worker sends the figures only to the founder's company's members;
 * anyone else's part is `team_only`, and this draws its sentence, never a
 * figure. A figure Mercury did not give is "Not recorded" with its reason,
 * never $0.
 */

const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const cents = (v) => (Number.isSafeInteger(v) ? v : null);

/** "$12,500" from integer cents; "Not recorded" when there is no figure. */
export function money(v) {
  const c = cents(v);
  if (c == null) return 'Not recorded';
  const sign = c < 0 ? '-' : '';
  return `${sign}$${(Math.abs(c) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** "Sep 2026" from "2026-09". */
export function monthLabel(m) {
  const x = /^(\d{4})-(\d{2})$/.exec(String(m || ''));
  if (!x) return String(m || '');
  return new Date(Date.UTC(Number(x[1]), Number(x[2]) - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "14.5 months"; one month reads "1 month". */
export function runwayText(r) {
  if (!r) return 'Not recorded';
  if (typeof r.months !== 'number') return r.reason || 'Not recorded';
  return `${r.months} ${r.months === 1 ? 'month' : 'months'}`;
}

/** The part, cleaned to what the page draws. `empty` is true when there is nothing to draw at all. */
export function mercuryView(part) {
  if (!part || typeof part !== 'object') return { state: 'none', empty: true };
  if (part.state === 'unreadable') return { state: 'unreadable', empty: false, reason: part.reason || 'The Mercury figures could not be read.' };
  if (part.state === 'team_only') return { state: 'team_only', empty: false, reason: part.reason || 'Only the venture’s team sees these figures.' };
  if (part.state === 'not_recorded') return { state: 'not_recorded', empty: false, reason: part.reason || 'Not recorded', canSync: part.can_sync === true };
  if (part.state !== 'ok') return { state: 'none', empty: true };
  return {
    state: 'ok', empty: false, source: part.source || null, canSync: part.can_sync === true,
    months: list(part.months).map((m) => ({ id: m.id, month: m.month, cash_in: money(m.cash_in_cents), net_burn: money(m.net_burn_cents) })),
    invoices: list(part.invoices).map((i) => ({ id: i.id, state: i.state, count: Number.isSafeInteger(i.count) ? i.count : 0, amount: money(i.amount_cents) })),
    invoicesReason: part.invoices_reason || null,
    creditsLanded: Number.isSafeInteger(part.credits_from_mercury) ? part.credits_from_mercury : null,
    cash: part.cash ? { id: part.cash.id, text: money(part.cash.cents), source: part.cash.source } : null,
    treasury: part.treasury ? { id: part.treasury.id, text: money(part.treasury.cents), source: part.treasury.source } : null,
    runway: part.runway ? { id: part.runway.id, text: runwayText(part.runway), source: part.runway.source } : null,
    payroll: list(part.payroll).map((p) => ({ id: p.id, month: p.month, amount: money(p.cents) })),
    hires: part.hires_affordable ? {
      text: typeof part.hires_affordable.value === 'number' ? String(part.hires_affordable.value) : (part.hires_affordable.reason || 'Not recorded'),
      words: part.hires_affordable.words || 'A computed figure, not a plan.',
      perHead: money(part.hires_affordable.cost_per_head_cents),
    } : null,
    spend: list(part.spend).map((p) => ({ id: p.id, month: p.month, amount: money(p.cents) })),
    spendMonth: part.month || null,
    channels: list(part.channels).map((c) => ({ id: c.id, name: String(c.name || ''), spend: money(c.spend_cents), customers: Number(c.customers) || 0,
      cac: cents(c.cac_cents) == null ? (c.cac_reason || 'Not recorded') : money(c.cac_cents) })),
    canDecide: part.can_decide === true,
    proposals: list(part.proposals).filter((p) => Number.isSafeInteger(p.id)).map((p) => ({
      id: p.id, state: p.state, company: String(p.partner_company || ''), sentence: p.sentence || null, source: p.source || null,
      linked: p.state === 'accepted' ? (p.growth_partner_name ? `Linked to ${p.growth_partner_name}` : 'Linked; that partner was since deleted') : null,
    })),
  };
}
