// D4360 (#4360, INC5g) — HQ reading a member's formation order on Incorporate,
// read only: D1463's access pill ("Read only · HQ access" or "· Studio admin
// access"), the order's status timeline, and no write. "Pay and submit" is
// not drawn, the EIN cannot be added and the bank step is not offered.
// Incorporate is not one of D1463's gated records, so there is no reason gate.
//
// The read is HQ's own list of paid orders (`GET /api/admin/incorporations`,
// D601), the one place an admin reads an order that is not theirs; the
// member's `/api/legal/incorporate/*` routes stay owner-scoped.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminIncorporationsApi } from '../../lib/api/adminIncorporations.js';
import { reportError } from '../../lib/log';
import { AccessPill } from '../../ui/ReasonGate';
import { ADMIN_LINE } from '../account/companies/companiesModel';
import IncorporationTimeline from './IncorporationTimeline.jsx';
import { TITLE } from './incorporateModel.js';

export const HQ_READ_LINE = 'Read only. “Pay and submit” is hidden while HQ reads this order.';
export const ORDER_NOT_FOUND = 'This order is not among the paid formation orders HQ can read.';
export const ORDER_UNREAD = 'This order could not be read.';
export const BACK_TO = { to: '/admin/programs/spinout-lab/formation', label: '‹ Formation orders' };

const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';

/** The order HQ asked for, from its list: `{ status: 'loading' | 'ready' | 'missing' | 'error', order }`. */
export function useHqOrder(orderId) {
  const [read, setRead] = useState({ status: 'loading', order: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead({ status: 'loading', order: null });
    adminIncorporationsApi.list('all').then((r) => {
      if (!live) return;
      const order = (Array.isArray(r?.orders) ? r.orders : []).find((o) => String(o.id) === String(orderId)) || null;
      setRead(order ? { status: 'ready', order } : { status: 'missing', order: null });
    }, (e) => { reportError('IncorporateHqRead', e); if (live) setRead({ status: 'error', order: null }); });
    return () => { live = false; };
  }, [orderId, tick]);
  return [read, () => setTick((n) => n + 1)];
}

export default function IncorporateHqRead({ orderId, viewer }) {
  const [read, retry] = useHqOrder(orderId);
  const o = read.order;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6" data-testid="incorporate-hq-read">
      <Link to={BACK_TO.to} className="w-fit text-[13px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">{BACK_TO.label}</Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={`m-0 text-[22px] font-extrabold tracking-[-.02em] ${INK}`}>{o?.company_name || o?.project_name ? `${TITLE} · ${o.company_name || o.project_name}` : TITLE}</h1>
        <AccessPill viewer={viewer} testId="incorporate-access-pill" />
      </header>
      {read.status === 'loading' ? <p className={MUTED} data-testid="incorporate-hq-loading">Reading…</p> : null}
      {read.status === 'error' ? (
        <p role="alert" className={`m-0 flex flex-wrap items-center gap-2 ${MUTED}`} data-testid="incorporate-hq-unread">
          {ORDER_UNREAD}
          <button type="button" className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" onClick={retry}>Try again</button>
        </p>
      ) : null}
      {read.status === 'missing' ? <p className={`m-0 ${MUTED}`} data-testid="incorporate-hq-missing">{ORDER_NOT_FOUND}</p> : null}
      {read.status === 'ready' ? (
        <>
          <IncorporationTimeline order={o} projectId={o.project_id} projectName={o.project_name || null} readOnly />
          <p className={`m-0 rounded-axal-md bg-axal-ground px-3 py-2.5 ${MUTED} dark:bg-gray-800`} data-testid="incorporate-hq-line">{`${HQ_READ_LINE} ${ADMIN_LINE}`}</p>
        </>
      ) : null}
    </div>
  );
}
