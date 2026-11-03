/**
 * D1434 (#3703 part 3) — what HQ's Move to live block says, from
 * `GET /api/admin/stripe/cutover`. Pure: the block draws `cutoverView`'s
 * answer and the dialog sends only when `canMove` is true.
 *
 * The keys go first (D1434): with test keys the block says to set the live
 * keys and the button stays off. A count that cannot be read is never 0.
 */
const count = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : null);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The lines the move would change, from `would_clear`; `null` for an unreadable answer. */
export function clearLines(w) {
  if (!w || typeof w !== 'object') return null;
  const c = { customers: count(w.customers), subscriptions: count(w.subscriptions), plans: count(w.plans), mirror: count(w.mirror_rows), packs: count(w.packs) };
  if (Object.values(c).some((v) => v === null)) return null;
  return [
    `${plural(c.plans, 'paid plan goes', 'paid plans go')} back to free, and each member is told`,
    `${plural(c.subscriptions, 'sandbox subscription is', 'sandbox subscriptions are')} cleared`,
    `${plural(c.customers, 'sandbox customer id is', 'sandbox customer ids are')} cleared`,
    `${plural(c.packs, 'sandbox token pack is', 'sandbox token packs are')} archived`,
    `${plural(c.mirror, 'price-list row is', 'price-list rows are')} replaced by the live account's prices`,
  ];
}

/**
 * `{ state, title, line }`:
 *   unconfigured  no secret key at all
 *   keys_test     the keys are sandbox ones: set the live keys first
 *   ready         live keys, records still in the sandbox: the move can run
 *   done          live keys and live records
 */
export function cutoverView(data) {
  if (!data || typeof data !== 'object') return { state: 'unreadable', title: 'Could not be read', line: 'The move was not checked. Nothing was changed.' };
  if (data.mode === 'unconfigured') return { state: 'unconfigured', title: 'Stripe is not connected', line: 'Set the live secret key on the platform first.' };
  if (data.mode !== 'live') {
    return { state: 'keys_test', title: 'Production uses the sandbox', line: 'Set the live secret key and the live webhook signing secret on the platform, then come back here. The pricing page shows the sandbox prices until then.' };
  }
  if (data.stored_mode === 'live') return { state: 'done', title: 'Production is live', line: 'The keys and the stored records are both on the live account.' };
  return { state: 'ready', title: 'Ready to move to live', line: 'The keys are live. The stored records still point at the sandbox.' };
}

export const CONFIRM_WORD = 'live';
/** The dialog sends only with a reason and the word typed exactly. */
export function canMove(view, reason, typed) {
  return view?.state === 'ready' && String(reason ?? '').trim().length > 0 && String(typed ?? '').trim() === CONFIRM_WORD;
}

/** The sentence after a move, from the POST's answer. */
export function movedText(out) {
  const n = (v) => (Number.isSafeInteger(v) ? v : 0);
  const synced = out?.catalog_synced == null ? ' The price list refreshes on the next read.' : ` ${plural(n(out.catalog_synced), 'live product', 'live products')} read into the price list.`;
  return `Moved to live. ${plural(n(out?.plans_reset), 'plan', 'plans')} reset, ${plural(n(out?.members_notified), 'member', 'members')} told.${synced}`;
}
