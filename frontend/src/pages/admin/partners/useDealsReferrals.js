import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { partnerDealReadsApi } from '../../../lib/api/partnerDealReads';
import { C5_PARAMS, REDEMPTION_PAGE, REDEMPTION_PAGES_MAX, pagedReply } from './dealsReferralsModel';
import { useRead } from './usePartnerDesk';

/**
 * D951 (#2727) — the server reads behind Deals, one deal and Referrals, each
 * made alone through the desk's `useRead`, so one that fails leaves the
 * others answering and draws its own Try again (the desk's `reload()` bumps
 * `tick`, which reads each again).
 *
 *   deals list   D926's `GET /api/admin/partners/deals`, one page per filter set
 *   C5           the same list, Active, soonest end first, one page of 100
 *   one deal     D928's `GET …/deals/:id`
 *   preview      D928's `GET …/deals/:id/terminate-preview`
 *   redemptions  D928's `GET …/redemptions`: one page for Every redemption,
 *                a count (`limit=1`) for each count tile, and a whole set,
 *                page after page, for the windows (C6, two tiles) and C4.
 *
 * A key is the parameters as JSON, so a new filter is a new read and a
 * re-render is not.
 */

/** `value`, once it has stopped changing for `ms` (a search box's keystrokes are one read). */
export function useDebounced(value, ms = 250) {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setHeld(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return held;
}

const key = (o) => JSON.stringify(o);

/** One page of D926's deal list, checked: rows and an exact total. */
export function useDealPage(params, tick, enabled = true) {
  return useRead('deals:page', `deals:${key(params)}`, tick, enabled,
    () => api.adminPartners.listDeals(params).then((r) => pagedReply(r, 'The deals')));
}

/** C5's read: the active deals, soonest end first. */
export function useActiveByEnd(tick, enabled = true) {
  return useRead('deals:c5', 'deals:c5', tick, enabled,
    () => api.adminPartners.listDeals({ ...C5_PARAMS }).then((r) => pagedReply(r, 'The active deals')));
}

/** One deal from D928's read. A 404 stays a failed read, with its status, so the record can say there is no such deal. */
export function useDealRead(id, tick, enabled = true) {
  return useRead('deal', `deal:${id}`, tick, enabled, () => partnerDealReadsApi.deal(id).then((r) => {
    if (!r?.deal) throw new Error('The deal did not come back.');
    return r;
  }));
}

/** D928's terminate preview for one deal. */
export function useTerminatePreview(id, tick, enabled = true) {
  return useRead('terminate-preview', `preview:${id}`, tick, enabled, () => partnerDealReadsApi.terminatePreview(id).then((r) => {
    if (!r || !Number.isFinite(Number(r.members_losing))) throw new Error('The terminate preview did not come back.');
    return r;
  }));
}

/** One page of redemptions across deals. */
export function useRedemptionPage(params, tick, enabled = true) {
  return useRead('redemptions:page', `redemptions:${key(params)}`, tick, enabled,
    () => partnerDealReadsApi.redemptions(params).then((r) => pagedReply(r, 'The redemptions')));
}

/** One filter set's exact count: a page of one, whose `total` is the figure. */
export function useRedemptionCount(scope, params, tick, enabled = true) {
  return useRead(`redemptions:${scope}`, `count:${scope}:${key(params)}`, tick, enabled,
    () => partnerDealReadsApi.redemptions({ ...params, limit: 1 }).then((r) => pagedReply(r, 'The redemptions')));
}

/**
 * Every redemption a filter set holds, page after page, up to
 * REDEMPTION_PAGES_MAX pages: `{ items, total, complete }`. Past the cap,
 * `complete` is false and each figure drawn from it says what it covers.
 */
export async function readAllRedemptions(params) {
  const items = [];
  let total = 0;
  for (let page = 1; page <= REDEMPTION_PAGES_MAX; page += 1) {
    const reply = pagedReply(await partnerDealReadsApi.redemptions({ ...params, page, limit: REDEMPTION_PAGE }), 'The redemptions');
    total = reply.total;
    items.push(...reply.items);
    if (reply.items.length < REDEMPTION_PAGE || items.length >= total) break;
  }
  return { items, total, complete: items.length >= total };
}

/** A whole set, read through `readAllRedemptions`. */
export function useAllRedemptions(scope, params, tick, enabled = true) {
  return useRead(`redemptions:${scope}`, `all:${scope}:${key(params)}`, tick, enabled, () => readAllRedemptions(params));
}
