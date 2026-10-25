// D923 (#2370) — Partner invitations, built to the owner's "Partner
// invitations" canvas (PI1–PI12) from the reads that exist. This file is the
// routed page at `/admin/partner-invitations` (Overview), `/invitations`,
// `/invitations/:id`, `/deals`, `/deals/:id` and `/referrals` (one
// `guard(['admin'])` route each in App.jsx; `/admin/partners` redirects here
// with `?moved=partners`; D952 moved `/firm-links` to Advisors & Partners ›
// Firms, which it now forwards to), and the desk's shell: the shared admin header
// (D936, D938) with its crumb, moved notice and tab strip, the tab the address names, the record
// drawn over its tab, and the dialogs. The tabs, their model and their reads
// live in `partners/` (see its README). Worker-only surface
// (`/api/admin/partners/*`): the dev FastAPI does not implement it, so expect
// failed reads in the dev preview, each saying so.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AdminPageHeader, HeaderTab, actionPrimary, usePhoneWidth } from '../../ui';
import { FOCUSABLE } from '../../ui/lightboxFocus.js';
import AdminBoardFrame from './AdminBoardFrame';
import DealRecord from './partners/DealRecord';
import InvitationRecord from './partners/InvitationRecord';
import NewInvitationDialog from './partners/NewInvitationDialog';
import { ResendDialog, RevokeDialog, TerminateDialog } from './partners/PartnerDialogs';
import PartnersDeals from './partners/PartnersDeals';
import PartnersInvitations from './partners/PartnersInvitations';
import PartnersOverview from './partners/PartnersOverview';
import PartnersReferrals from './partners/PartnersReferrals';
import { usePartnerDesk } from './partners/usePartnerDesk';
import {
  LINE, MOVED_LINE, TITLE, cameFromOldAddress, fanOut, needsYou, routeFor, tabCounts, tabPath, withoutMoved,
} from './partners/partnersDeskModel';

/**
 * A tab's count (D923 §1): exact, or saying what it covers in its tooltip and
 * to a screen reader. Drawn inside the shared header's `HeaderTab` (D938).
 */
function DeskCount({ count, testId }) {
  if (!count) return null;
  return (
    <span title={count.title} className={`rounded-full border px-[7px] font-mono text-[10.5px] font-bold ${count.amber
      ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
      : 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`} data-testid={testId}>
      {count.text}
      <span className="sr-only">{`, ${count.title}`}</span>
    </span>
  );
}

/**
 * The tab strip (PI1). THE FOUR PATHS ARE WRITTEN OUT, not mapped from
 * `TABS`, because the reachability walk (`admin_route_reachability.test.mjs`)
 * counts a literal `to="…"` as a door, as on Licences (D800) and Events
 * (D915); `admin_partner_invitations_d923.test.mjs` holds the two lists
 * equal. Each count is exact or says what it covers (D923 §1). Attaching an
 * account to a firm is on Advisors & Partners › Firms (D952); Overview's
 * Needs-you row links it. On a phone the strip scrolls sideways. `current`
 * holds the lit tab's link, focus's last fallback.
 * D938: they are the shared header's `HeaderTab`s (D936).
 */
function DeskTabs({ counts, tab, current }) {
  const at = (key) => (tab === key ? current : undefined);
  return (
    <>
      <HeaderTab to="/admin/partner-invitations" end data-testid="partners-tab-overview" linkRef={at('overview')}>Overview<DeskCount count={counts.overview} testId="partners-tab-overview-count" /></HeaderTab>
      <HeaderTab to="/admin/partner-invitations/invitations" end={false} data-testid="partners-tab-invitations" linkRef={at('invitations')}>Invitations<DeskCount count={counts.invitations} testId="partners-tab-invitations-count" /></HeaderTab>
      <HeaderTab to="/admin/partner-invitations/deals" end={false} data-testid="partners-tab-deals" linkRef={at('deals')}>Deals<DeskCount count={counts.deals} testId="partners-tab-deals-count" /></HeaderTab>
      <HeaderTab to="/admin/partner-invitations/referrals" end={false} data-testid="partners-tab-referrals" linkRef={at('referrals')}>Referrals<DeskCount count={counts.referrals} testId="partners-tab-referrals-count" /></HeaderTab>
    </>
  );
}

const activeEl = () => (typeof document === 'undefined' ? null : document.activeElement);
/** Focus is lost: on nothing, on <body>, or on a node no longer in the page. */
const lost = (el) => !el || (typeof document !== 'undefined' && el === document.body) || el.isConnected === false;
const usable = (el) => !lost(el) && !el.closest?.('[hidden],[inert]');

/**
 * FOCUS RETURN (D923 §1: "focus goes back to the row that opened it"). Each
 * open layer (the record, a dialog, New invitation) remembers what had focus
 * as it opened: the row, its "Actions for [name]" button (RowMenu puts focus
 * there before its list unmounts), a link. On a desktop the Lightbox gives
 * focus back itself; when focus is still lost after a layer closes, this does
 * it:
 *   · on a phone the record is a page, which manages no focus;
 *   · the opener can be gone: a deal opened from another tab's link draws the
 *     Deals tab, or the write removed the button that opened its dialog.
 * Focus then goes to the record still open, else to the lit tab, never to
 * <body>. And focus given back to a row that a write's reload then removes (a
 * terminated deal leaves Active) moves to that fallback too.
 */
function useFocusReturn(layers, fallback) {
  const openers = useRef(new Map());
  const before = useRef([]);
  const held = useRef(null);
  const key = layers.join('|');
  useLayoutEffect(() => {
    // Runs before the Lightbox moves focus in, so what opened the layer still has it.
    const a = activeEl();
    for (const k of layers) if (!openers.current.has(k)) openers.current.set(k, lost(a) ? null : a);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const closed = before.current.filter((k) => !layers.includes(k)).reverse();
    before.current = layers;
    if (closed.length) {
      let a = activeEl();
      if (lost(a)) {
        const to = closed.map((k) => openers.current.get(k)).find(usable) || fallback();
        to?.focus?.();
        a = to || null;
      }
      held.current = a;
    }
    for (const k of closed) openers.current.delete(k);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = held.current;
    if (!h) return;
    const a = activeEl();
    if (h.isConnected === false && lost(a)) {
      const to = fallback();
      held.current = to || null;
      to?.focus?.();
    } else if (h !== a) held.current = null;
  });
}

function PartnerInvitationsBody() {
  const loc = useLocation();
  const navigate = useNavigate();
  const route = routeFor(loc.pathname);
  const reads = usePartnerDesk(route);
  const phone = usePhoneWidth();
  const now = Date.now();
  const [dialog, setDialog] = useState(null);
  const [creating, setCreating] = useState(false);

  const fan = fanOut(reads.set, reads.calls);
  const needs = needsYou({ invitations: reads.invitations, deals: reads.deals, links: reads.links, template: reads.template, fan, now });
  const counts = tabCounts({ invitations: reads.invitations, deals: reads.deals, contracts: reads.contracts, needs });
  const moved = cameFromOldAddress(loc.search);
  const actions = {
    newInvitation: () => setCreating(true),
    resend: (inv) => setDialog({ kind: 'resend', inv }),
    revoke: (inv) => setDialog({ kind: 'revoke', inv }),
    terminate: (deal) => setDialog({ kind: 'terminate', deal }),
  };
  const closeRecord = () => navigate(tabPath(route.tab));
  const closeDialog = () => setDialog(null);
  // On a phone a record is a full page with its own back link (PI11c). The tab
  // stays mounted under it, hidden, so its search, filters, page and the row
  // that opened the record are all still there on the way back.
  const recordPage = Boolean(phone && route.record);

  const desk = useRef(null);
  const currentTab = useRef(null);
  const layers = [
    route.record ? `record:${route.record.kind}:${route.record.id}` : null,
    dialog ? `dialog:${dialog.kind}` : null,
    creating ? 'new' : null,
  ].filter(Boolean);
  // The record still open (its first control that is neither hidden nor inert), else the lit tab.
  useFocusReturn(layers, () => (route.record
    ? Array.from(desk.current?.querySelectorAll?.(FOCUSABLE) || []).find(usable) || null
    : currentTab.current));

  return (
    <div ref={desk} className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-24 pt-6 sm:px-6 lg:pb-10" data-testid="partners-desk">
      <div hidden={recordPage} className="flex min-w-0 flex-col gap-4" data-testid="partners-tab-area">
        <AdminPageHeader
          crumb={{ to: '/admin/community', label: 'Community', current: 'Partner invitations' }}
          title={TITLE}
          line={LINE}
          actions={<button type="button" className={`${actionPrimary} w-full sm:w-auto`} onClick={actions.newInvitation} data-testid="partners-new-button">New invitation</button>}
          notice={{ text: moved ? MOVED_LINE : null, onDismiss: () => navigate({ pathname: loc.pathname, search: withoutMoved(loc.search) }, { replace: true }) }}
          tabs={<DeskTabs counts={counts} tab={route.tab} current={currentTab} />}
          data-testid="partners-header"
        />

        {route.tab === 'overview' ? <PartnersOverview reads={reads} needs={needs} fan={fan} now={now} actions={actions} /> : null}
        {route.tab === 'invitations' ? <PartnersInvitations reads={reads} now={now} actions={actions} /> : null}
        {route.tab === 'deals' ? <PartnersDeals reads={reads} now={now} actions={actions} /> : null}
        {route.tab === 'referrals' ? <PartnersReferrals reads={reads} fan={fan} now={now} /> : null}
      </div>

      {route.record?.kind === 'invitation' ? <InvitationRecord key={route.record.id} id={route.record.id} reads={reads} now={now} onClose={closeRecord} actions={actions} /> : null}
      {route.record?.kind === 'deal' ? <DealRecord key={route.record.id} id={route.record.id} reads={reads} now={now} onClose={closeRecord} actions={actions} /> : null}

      {creating ? <NewInvitationDialog reads={reads} onClose={() => setCreating(false)} /> : null}
      {dialog?.kind === 'resend' ? <ResendDialog inv={dialog.inv} reads={reads} now={now} onClose={closeDialog} /> : null}
      {dialog?.kind === 'revoke' ? <RevokeDialog inv={dialog.inv} reads={reads} onClose={closeDialog} /> : null}
      {dialog?.kind === 'terminate' ? <TerminateDialog deal={dialog.deal} reads={reads} onClose={closeDialog} /> : null}
    </div>
  );
}

// D774 (#2100): S31 drew no rail. The board's page, in the Admin boards' frame.
export default function PartnerInvitations() {
  return (
    <AdminBoardFrame workspace="Partner invitations" note="Eadwyn reads the invitations listed here. An invitation goes out only when you send it." data-testid="admin-board-partner-invitations">
      <PartnerInvitationsBody />
    </AdminBoardFrame>
  );
}
