import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { partnerDealReadsApi } from '../../../lib/api/partnerDealReads';
import { reportError } from '../../../lib/log';
import { overviewReply } from './partnersDeskModel';

/**
 * D923 (#2370) — the desk's reads, each made alone so one that fails leaves
 * the others answering (D923 §2). Every tab reads what the tab strip's counts
 * and Needs you need, so a count reads the same on every tab:
 *   invitations  R1, the newest 200 by first send;
 *   deals        R2, once for each of the six states;
 *   contracts    R5, every deal, paged at 500 until its `total`;
 *   links        R6, the partner accounts and firms;
 *   agreement    D928's `GET /agreement-ready`, the Worker's agreement-ready rule
 *                (D1117: it replaced R8's template, read for the browser's rule);
 *   (D951: Guard F's fan-out is gone; Referrals reads D928's cross-deal read.)
 *   overview     part 4's `GET /api/admin/partners/overview` (D927): every
 *                Overview tile, Needs-you row and chart, and the Overview
 *                tab's count (D929).
 * Deals also reads R3 (top deals). D1117: the Deals list's due-diligence
 * column comes with each row (D926's list), so R9 is no longer read here.
 * A record's own reads (R7, R10, R4 for its last redeemers, R12 on request)
 * are made by the record with `useRead`.
 *
 * `reload()` reads everything again after a write. A read that already
 * answered keeps its rows on screen while it is read again, marked
 * `refreshing` until it answers; one that then fails keeps them as stale, and
 * the page draws them under a "Could not refresh" line. Rows adopted for one
 * address are read again by that address too, and keep their row the same
 * way when that read fails.
 */

const idle = (what) => ({ status: 'loading', data: null, error: null, at: null, what });

/**
 * One read. `what` names what it reads (a new `what` starts from loading);
 * `tick` reads it again. `load` is rebuilt on every render and is NOT a
 * dependency: an inline function in an effect's dependencies re-runs the
 * effect on every render, which is how today's redeemer modal looped.
 */
export function useRead(scope, what, tick, enabled, load) {
  const [read, setRead] = useState(() => idle(what));
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    // A read again keeps its rows and says it is `refreshing`; the reply's state drops the mark.
    // A stale read goes to `loading`, not `ready`, so the page still knows its rows are from before a failure (`isRetrying`).
    setRead((r) => (r.what === what && r.data !== null ? { ...r, status: r.status === 'error' ? 'loading' : r.status, refreshing: true } : idle(what)));
    Promise.resolve().then(load).then(
      (data) => { if (live) setRead({ status: 'ready', data, error: null, at: Date.now(), what }); },
      (error) => {
        reportError(`admin-partners:${scope}`, error);
        if (live) setRead((r) => ({ status: 'error', data: r.what === what ? r.data : null, error, at: r.what === what ? r.at : null, what }));
      },
    );
    return () => { live = false; };
    // `load` is rebuilt on every render; `what`, `tick` and `enabled` say when to call it.
  }, [what, tick, enabled]);
  return read;
}

/** A list reply's rows. A reply with no list is a failed read, never an empty one. */
export function itemsOf(reply, what) {
  if (!Array.isArray(reply?.items)) throw new Error(`${what} did not come back as a list.`);
  return reply.items;
}

/** A list's rows carrying the reply's `total` when it is a number (D926), and none otherwise. */
export function withTotal(items, reply) {
  const total = Number(reply?.total);
  if (Number.isFinite(total) && reply?.total !== null && reply?.total !== undefined) Object.defineProperty(items, 'total', { value: total, enumerable: false });
  return items;
}

const R5_PAGE = 500;

/** R5, every page: `{ items, total, complete }`. */
async function readContracts() {
  const items = [];
  let total = null;
  for (let page = 0; page < 40; page += 1) {
    const reply = await api.adminListPartnerDeals({ limit: R5_PAGE, offset: page * R5_PAGE });
    if (!Array.isArray(reply?.items) || !Number.isFinite(Number(reply?.total))) throw new Error('The partner deals did not come back as a list.');
    total = Number(reply.total);
    items.push(...reply.items);
    if (reply.items.length < R5_PAGE || items.length >= total) break;
  }
  return { items, total, complete: items.length >= total };
}

async function readLinks() {
  const reply = await api.adminPartners.listFirmLinks();
  if (!Array.isArray(reply?.accounts) || !Array.isArray(reply?.firms)) throw new Error('The partner accounts did not come back as a list.');
  return reply;
}

const dealList = (status) => () => api.adminPartners.listDeals(status).then((r) => itemsOf(r, `The ${status} deals`));

export function usePartnerDesk(route) {
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  // Rows this page read for one address (Open invitation, Open it), so a
  // record outside the newest 200 still opens. Each is held as a read, in
  // `useRead`'s shape, so a failed refresh of it is said like a list's.
  const [extra, setExtra] = useState(() => new Map());
  const adopt = useCallback((row) => {
    if (row && row.id !== null && row.id !== undefined) setExtra((m) => new Map(m).set(String(row.id), { status: 'ready', data: row, error: null }));
  }, []);
  // A reload reads each adopted row again by its address, as it was read, so a
  // record outside the newest 200 shows the Worker's state after a write. A row
  // is dropped only when that read answered without it: the record then says
  // it is not in this read. When the read fails the row stays, stale, and the
  // record draws it under "Could not refresh" with Try again (D923 §2).
  const extraNow = useRef(extra);
  extraNow.current = extra;
  useEffect(() => {
    if (!tick) return undefined;
    let live = true;
    const put = (key, f) => (m) => (m.has(key) ? new Map(m).set(key, f(m.get(key))) : m);
    const drop = (key) => (m) => { if (!m.has(key)) return m; const n = new Map(m); n.delete(key); return n; };
    for (const [key, held] of extraNow.current) {
      api.adminPartners.listInvitations({ email: held.data.recipient_email })
        .then((r) => itemsOf(r, 'The invitations for this address').find((i) => String(i?.id) === key) || null)
        .then(
          (fresh) => { if (live) setExtra(fresh ? put(key, () => ({ status: 'ready', data: fresh, error: null })) : drop(key)); },
          (error) => { reportError('admin-partners:adopted', error); if (live) setExtra(put(key, (r) => ({ ...r, status: 'error', error }))); },
        );
    }
    return () => { live = false; };
  }, [tick]);

  // D950: the rows keep the Worker's exact `total` (D926), so the tab's count is exact past the newest 200.
  const invitations = useRead('invitations', 'invitations', tick, true,
    () => api.adminPartners.listInvitations({}).then((r) => withTotal(itemsOf(r, 'The invitations'), r)));
  const proposed = useRead('deals:proposed', 'proposed', tick, true, dealList('proposed'));
  const awaiting = useRead('deals:awaiting_signature', 'awaiting_signature', tick, true, dealList('awaiting_signature'));
  const active = useRead('deals:active', 'active', tick, true, dealList('active'));
  const expired = useRead('deals:expired', 'expired', tick, true, dealList('expired'));
  const terminated = useRead('deals:terminated', 'terminated', tick, true, dealList('terminated'));
  const voided = useRead('deals:voided', 'voided', tick, true, dealList('voided'));
  const deals = useMemo(() => ({ proposed, awaiting_signature: awaiting, active, expired, terminated, voided }),
    [proposed, awaiting, active, expired, terminated, voided]);
  const contracts = useRead('contracts', 'contracts', tick, true, readContracts);
  const links = useRead('links', 'links', tick, true, readLinks);
  const agreement = useRead('agreement', 'agreement', tick, true, () => partnerDealReadsApi.agreementReady());
  const overview = useRead('overview', 'overview', tick, true, () => api.adminPartners.overview().then(overviewReply));
  const onDeals = route.tab === 'deals';
  const top = useRead('top', 'top', tick, onDeals, () => api.adminPartners.listTopDeals({ limit: 5, status: 'all' }).then((r) => itemsOf(r, 'The top deals')));

  return { invitations, deals, contracts, links, agreement, overview, top, tick, reload, extra, adopt };
}
