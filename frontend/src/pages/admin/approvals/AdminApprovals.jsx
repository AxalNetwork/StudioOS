import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuthSync';
import { branchLabel, branchOfUser, isSuperAdminUser } from '../../../lib/shellRole';
import { adminApprovalsApi } from '../../../lib/api/adminApprovals';
import { licenceRequestsApi } from '../../../lib/api/licenceRequests';
import { AdminPageHeader, HeaderTab, useMovedNotice } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import { fromStudio, keepStudio } from '../studioOverdue';
import { useHeldGlance } from '../heldFigures';
import { HQ_LANES, LINE, MOVED_KEY, MOVED_NOTICE, RAIL_NOTE, TITLE, laneViews, tabOf } from './approvalsModel';
import { assignItems, queueStep, decidedQueryOf, inboxQueryOf, itemOfPath, refusalToast, waitingFigure } from './inboxModel';
import { decidedHq } from './lanesDecidedModel';
import { useRead } from './approvalsUi';
import { AssignDialog, ItemDrawer } from './ApprovalsAssign';
import { Inbox } from './ApprovalsInbox';
import { Lanes } from './ApprovalsLanes';
import { Decided } from './ApprovalsDecided';

/**
 * D1038 (#2390) — Admin › Approvals at /admin/approvals, built to the owner's
 * "Approvals" canvas (APR1–APR16) under the shared admin header (D936).
 * /admin/held/approvals forwards here with the moved notice.
 *
 * D1045 (#2893) — part 7, the canvas on the reads parts 2 to 6 built: the
 * Inbox lists every waiting item on HQ's inbox read (D1040, D1132) with its
 * age band, who holds it, the ⋯ menu and the bulk bar; the four tiles, the
 * two charts with "View as table", Waiting on HQ; the item at its own
 * address (`/admin/approvals/items/<lane>-<id>`) with Assign and History;
 * each lane's Notifies and HQ's counts on Lanes; and the Decided log
 * (D1044). Nothing here decides: each item opens the page that decides it.
 *
 * EVERY DOOR IS A LITERAL LINK (`LaneDoor`, `HqDoor`, the item link, the
 * Not-a-queue card), because the reachability walk (admin_route_reachability)
 * reads navigation syntax, and for LP applications, Best-Fit, Due diligence
 * and Spin-Out moderation this page is the HQ-held shell's only way in.
 *
 * D8728 (#8728) — opened from Studio (router state `{ from: '/studio' }`, the
 * overdue card's "Review overdue in Approvals"), the header carries the crumb
 * "Studio › Approvals" ("‹ Studio" on a phone); a direct visit or a shared
 * link has none, so it never claims a route the reader did not take (SAD13
 * L6). On a branch the scope chip names the territory the read ran for
 * (`branchLabel`) instead of HQ's fixed "HQ-held accounts" label.
 *
 * D8728 part 3: opening an item, stepping to the next or previous one and
 * closing it pass Studio's marker on (`keepStudio`), so the crumb stays for
 * the whole visit instead of going with the first item opened.
 */


// Moved by D5882 (#5882); the four boards import these from here.
export { BandPill, UrgencyPill } from './approvalsUi';
export { LaneDoor, HqDoor } from './approvalDoors';
export { AssignDialog, OwnerCell } from './ApprovalsAssign';

const STUDIO_CRUMB = { to: '/studio', label: 'Studio', current: TITLE };

/** D8728: the scope chip on a branch — the territory this inbox was read for. */
export function TerritoryChip({ user }) {
  return (
    <span className="inline-flex rounded-full border border-axal-hairline bg-white px-3 py-1 font-mono text-[11.5px] font-medium text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="admin-page-scope">
      {`${branchLabel(user) || 'This territory'} · this territory`}
    </span>
  );
}

/** The page itself; `viewer` stands in for the signed-in account where a caller has one (tests). */
export function ApprovalsPage({ viewer = null }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const user = viewer ?? auth?.user;
  const superAdmin = isSuperAdminUser(user);
  const glance = useHeldGlance();
  const views = laneViews(glance);
  const tab = tabOf(loc.pathname);
  const item = itemOfPath(loc.pathname);
  const notice = useMovedNotice({ [MOVED_KEY]: MOVED_NOTICE });
  const onInbox = tab === 'inbox';
  const iq = inboxQueryOf(loc.search, superAdmin);
  // D4814 (AP-06): Lanes reads the inbox too, unfiltered, for each lane's overdue count.
  const inboxKey = tab === 'lanes' ? 'lanes' : JSON.stringify(iq.filters) + iq.page;
  const inbox = useRead((signal) => (tab === 'lanes' ? adminApprovalsApi.inbox(1, {}, signal) : adminApprovalsApi.inbox(iq.page, iq.filters, signal)), inboxKey, onInbox || tab === 'lanes');
  const weekly = useRead(() => adminApprovalsApi.weekly(), 'weekly', onInbox);
  // D4814: Waiting on HQ is a studio's outbound list; the HQ-held shell neither draws nor reads it.
  const studio = Boolean(branchOfUser(user));
  const requests = useRead(() => licenceRequestsApi.list(), 'requests', onInbox && studio);
  const dq = decidedQueryOf(loc.search);
  // D4814: "Include HQ lanes" off is a Super Admin's; a plain Admin never sends hq.
  if (!decidedHq(loc.search, superAdmin)) delete dq.hq;
  const { page: dPage, ...dFilters } = dq;
  const decided = useRead((signal) => adminApprovalsApi.decided(dPage, dFilters, signal), JSON.stringify(dq), tab === 'decided');

  const [assignFor, setAssignFor] = useState(null);
  const [toastText, setToastText] = useState(null);
  useEffect(() => {
    if (!toastText) return undefined;
    const t = setTimeout(() => setToastText(null), 8000);
    return () => clearTimeout(t);
  }, [toastText]);
  const openAssign = (rows, after, opts = {}) => setAssignFor({ rows, after, ...opts });
  // D4814 (AP-04): Assign to me takes the item at once — it changes the owner
  // only, as Assign does — and is offered only to an admin the Worker lists as
  // a reviewer (a Super Admin who is not one cannot be assigned).
  const reviewers = inbox.status === 'ready' && Array.isArray(inbox.reply?.reviewers) ? inbox.reply.reviewers : [];
  const canTake = user?.id != null && reviewers.some((r) => Number(r.id) === Number(user.id)) ? user.id : null;
  const take = async (rows, after) => {
    try {
      await adminApprovalsApi.assign(canTake, assignItems(rows));
      setToastText(`${rows[0].who} is now assigned to you.`);
    } catch (e) {
      setToastText(refusalToast(e));
    }
    inbox.reload();
    after?.();
  };
  const doneAssign = (text) => {
    const after = assignFor?.after;
    setAssignFor(null);
    setToastText(text);
    inbox.reload();
    after?.();
  };
  // D8728 part 3: closing an item keeps the visit Studio opened, crumb and all.
  const closeItem = () => navigate({ pathname: '/admin/approvals', search: loc.search }, { state: keepStudio(loc.state) });

  // D4814 (P0): on the Inbox the tab reads `waitingFigure`, the same number as
  // Waiting and All. It used to read `unfiltered_total`, which the Worker sends
  // only for a filtered read, so an unfiltered Inbox fell back to the glance's
  // studio lanes and left HQ's own lanes out (Inbox 31 beside Waiting 32,
  // "1 for HQ"). Off the Inbox the glance stands in, HQ's lanes included for a
  // Super Admin.
  const waiting = waitingFigure(inbox);
  const counted = views.filter((v) => v.glance);
  const hqPending = glance.hq?.approvals?.hqDecides?.pending_total;
  const hqShare = superAdmin ? hqPending : 0;
  const inboxCount = onInbox
    ? (waiting.state === 'ready' ? { kind: 'num', value: waiting.value }
      : waiting.state === 'loading' ? { kind: 'load' }
        : { kind: 'dash', tip: waiting.reason })
    : counted.some((v) => v.state === 'loading') ? { kind: 'load' }
      : counted.every((v) => v.state === 'ready') && hqShare != null ? { kind: 'num', value: (counted.reduce((t, v) => t + v.count, 0) + hqShare).toLocaleString('en-US') }
        : { kind: 'dash', tip: 'A lane could not be read, so there is no total.' };
  const decidedCount = tab === 'decided' && decided.status === 'ready' && decided.reply.total != null
    ? { kind: 'num', value: Number(decided.reply.total).toLocaleString('en-US') }
    : { kind: 'dash', tip: tab === 'decided' && decided.status === 'error' ? 'What was decided could not be read.' : 'Counted on Decided.' };
  const tabs = (
    <>
      <HeaderTab to="/admin/approvals" count={inboxCount} data-testid="approvals-tab-inbox">Inbox</HeaderTab>
      <HeaderTab to="/admin/approvals/lanes" count={{ kind: 'num', value: String(views.length + (superAdmin ? HQ_LANES.length : 0)) }} data-testid="approvals-tab-lanes">Lanes</HeaderTab>
      <HeaderTab to="/admin/approvals/decided" count={decidedCount} data-testid="approvals-tab-decided">Decided</HeaderTab>
    </>
  );
  return (
    <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="admin-approvals">
      <AdminPageHeader crumb={fromStudio(loc.state) ? STUDIO_CRUMB : null} title={TITLE} line={LINE} scope={!studio} chip={studio ? <TerritoryChip user={user} /> : null} notice={{ text: notice.text, onDismiss: notice.dismiss }} tabs={tabs} data-testid="approvals-header" />
      {onInbox ? <Inbox inbox={inbox} weekly={weekly} requests={requests} superAdmin={superAdmin} studio={studio} callerId={user?.id ?? null} onAssign={openAssign} toast={setToastText} /> : null}
      {tab === 'lanes' ? <Lanes views={views} glance={glance} inbox={inbox} superAdmin={superAdmin} /> : null}
      {tab === 'decided' ? <Decided decided={decided} superAdmin={superAdmin} /> : null}
      {item ? (
        <ItemDrawer key={`${item.lane}-${item.id}`} at={item} step={onInbox && inbox.status === 'ready' ? queueStep(inbox.reply, item) : null} search={loc.search} state={keepStudio(loc.state)}
          canTake={canTake} onClose={closeItem} onAssign={openAssign} onTake={take} />
      ) : null}
      {assignFor ? <AssignDialog items={assignFor.rows} title={assignFor.title} line={assignFor.line} inbox={inbox} callerId={user?.id} onClose={() => setAssignFor(null)} onDone={doneAssign} /> : null}
      {toastText ? (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-[10px] bg-axal-ink px-4 py-2.5 text-[13px] text-white shadow-lg dark:bg-gray-100 dark:text-gray-900" data-testid="approvals-toast">
          {toastText}
          <button type="button" aria-label="Dismiss" className="font-bold" onClick={() => setToastText(null)}>×</button>
        </div>
      ) : null}
    </div>
  );
}

/** The page inside its rail frame (D774), the frame the page's outermost element. */
export default function AdminApprovals() {
  return (
    <AdminBoardFrame workspace="Approvals" note={RAIL_NOTE} operations data-testid="admin-board-approvals">
      <ApprovalsPage />
    </AdminBoardFrame>
  );
}
