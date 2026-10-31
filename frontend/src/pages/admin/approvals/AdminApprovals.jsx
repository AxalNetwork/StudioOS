import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { adminApprovalsApi } from '../../../lib/api/adminApprovals';
import { licenceRequestsApi } from '../../../lib/api/licenceRequests';
import {
  AdminPageHeader, Chart, ChartTable, HeaderTab, Legend, Lightbox, Skeleton, useMovedNotice,
} from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import { useHeldGlance } from '../heldFigures';
import {
  DECIDED_LINE, GROUPS, HQ_LANES, HQ_ONLY_LINE, HQ_ONLY_TITLE, LANES, LANES_LINE, LANE_FAILED, LINE, MOVED_KEY, MOVED_NOTICE,
  NOT_A_QUEUE, NOT_YET, RAIL_NOTE, TITLE,
  isHqLane, laneViews, oldestLine, tabOf,
} from './approvalsModel';
import {
  AGE_FILTERS, BAND_PARTS, OUTCOME_FILTERS, SEARCH_MIN, SORTS,
  assignChoices, assignItems, assignTitle, decidedNotes, decidedPageLine, decidedQueryOf, decidedRows, errorRef,
  hasNextPage, hqBandLine, hqLaneViews, inboxGroupCounts, inboxGroups, inboxQueryOf, inboxRows, inboxTiles, itemOfPath,
  itemView, laneAgeChart, notifiesOf, pageLine, refusalToast, waitingOnHq, weekChart, cardAge, filterCount, sortLabel,
} from './inboxModel';
import { FOOT, PhoneBack } from './boardParts';
import Sheet from '../../../ui/Sheet.jsx';

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
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const LINK = 'text-[12.5px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const TH = 'px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2.5 align-top text-[13px] text-axal-ink dark:text-gray-100';
const NEW_PILL = 'ml-1.5 rounded-full border border-axal-lavender-edge bg-axal-lavender px-2 py-0.5 text-[10.5px] font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300';
const CHIP = 'inline-flex min-h-[44px] items-center gap-1.5 sm:min-h-[36px] rounded-full border px-3 text-[12.5px] font-bold';
const CHIP_ON = 'border-axal-violet bg-axal-lavender text-axal-ink dark:bg-violet-950/40 dark:text-gray-100';
const CHIP_OFF = 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400';
const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-[8px] sm:min-h-[36px] border border-axal-hairline px-3 text-[12.5px] font-bold text-axal-ink hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
const BTN_PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-[8px] sm:min-h-[36px] bg-axal-violet px-3 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50';
const SELECT = 'min-h-[44px] rounded-[7px] sm:min-h-[36px] border border-axal-hairline bg-white px-2 text-[12.5px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

const PILL = {
  warn: 'border-amber-300 bg-amber-50 text-axal-amber-deep dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  bad: 'border-axal-destructive-edge bg-axal-destructive-tint text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  good: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  plain: 'border-axal-hairline bg-gray-50 text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100',
};

/** The age band's pill; under 24 hours has none (APR1). */
export function BandPill({ band }) {
  if (!band?.tone) return null;
  return <span className={`ml-1.5 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL[band.tone]}`}>{band.label}</span>;
}

/** The page that decides a lane, as a literal link (see the header comment). */
export function LaneDoor({ k }) {
  switch (k) {
    case 'kyc': case 'kyb': return <Link to="/admin/kyc" className={LINK}>KYC & KYB</Link>;
    case 'partner_profiles': return <Link to="/admin/partner-profiles" className={LINK}>Partner profiles</Link>;
    case 'exploring': return <Link to="/admin/exploring" className={LINK}>Exploring board</Link>;
    case 'product_testers': return <Link to="/admin/approvals/product-testers" className={LINK}>Here</Link>;
    case 'lp': return <Link to="/admin/lp-applications" className={LINK}>LP applications</Link>;
    case 'cohort': return <Link to="/admin/programs/spinout-lab/applications" className={LINK}>Spin-Out Lab</Link>;
    case 'lab_hosts': return <Link to="/admin/programs/spinout-lab/hosts" className={LINK}>Spin-Out Lab › Hosts</Link>;
    case 'moderation': return <Link to="/admin/spinout-moderation" className={LINK}>Spin-Out moderation</Link>;
    case 'referrals': return <Link to="/admin/programs/refer-and-earn/queue" className={LINK}>Refer & Earn › Queue</Link>;
    case 'strategic_access': return <Link to="/admin/programs/refer-and-earn" className={LINK}>Refer & Earn</Link>;
    case 'perk_listings': return <Link to="/admin/programs/perks" className={LINK}>Perks</Link>;
    case 'best_fit': return <span className={SUB}>Here</span>;
    case 'events': return <Link to="/admin/events/review" className={LINK}>Events › Review</Link>;
    case 'jobs': return <Link to="/admin/jobs" className={LINK}>Jobs</Link>;
    case 'wellbeing_experts': return <Link to="/admin/approvals/wellbeing-experts" className={LINK}>Here</Link>;
    case 'comarketing': return <Link to="/admin/approvals/co-marketing" className={LINK}>Here</Link>;
    case 'articles': return <Link to="/admin/articles" className={LINK}>Content queue</Link>;
    case 'due_diligence': return <Link to="/admin/due-diligence" className={LINK}>Due diligence</Link>;
    case 'score_flags': return <Link to="/monitoring" className={LINK}>Monitoring</Link>;
    default: return <span className={SUB}>Not recorded</span>;
  }
}

/** HQ's own queue pages (APR9), literal; a page not built yet says so. */
export function HqDoor({ lane }) {
  switch (lane.key) {
    case 'testing_programs': return <Link to="/admin/platform/product-testing" className={LINK}>Platform › Product testing</Link>;
    case 'learning': return <Link to="/learning/studio" className={LINK}>Learning studio</Link>;
    case 'tickets': return <Link to="/hq/review" className={LINK}>HQ review</Link>;
    case 'payouts': return <Link to="/admin/commissions" className={LINK}>Commissions</Link>;
    case 'ai_runs': return <Link to="/admin/platform/allowances" className={LINK}>Platform › AI allowances</Link>;
    case 'notices': return <Link to="/admin/licences" className={LINK}>Licences</Link>;
    case 'support': return <Link to="/admin/hq-support" className={LINK}>Support</Link>;
    case 'grants': return <Link to="/admin/licences/programs/requests" className={LINK}>Licences › Program grants › Requests</Link>;
    default: return <span className={SUB}>{lane.waits}</span>;
  }
}

/** Either door for a lane key: the studio's lanes, or HQ's for a Super Admin. */
function DoorFor({ lane }) {
  const hq = HQ_LANES.find((l) => l.key === lane);
  return hq ? <HqDoor lane={hq} /> : <LaneDoor k={lane} />;
}

/**
 * One read, answered alone: `{ status: 'loading' | 'ready' | 'error', reply,
 * error, reload }`. `key` says when to read again; `enabled` false reads nothing.
 */
function useRead(fn, key, enabled = true) {
  const [state, setState] = useState({ status: 'loading', reply: null, error: null });
  const [tick, setTick] = useState(0);
  const call = useRef(fn);
  call.current = fn;
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    call.current().then(
      (reply) => { if (!cancelled) setState({ status: 'ready', reply, error: null }); },
      (error) => { if (!cancelled) setState({ status: 'error', reply: null, error }); },
    );
    return () => { cancelled = true; };
  }, [key, tick, enabled]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** A lane's Waiting cell: a number, "Could not be read" with Try again, or not counted yet with why. */
function WaitingCell({ v, onRetry }) {
  if (v.state === 'loading') return <span aria-label="Reading" className="inline-block h-2 w-8 rounded bg-axal-hairline dark:bg-gray-700" />;
  if (v.state === 'unreadable') {
    return (
      <span className="text-axal-destructive dark:text-red-300" data-testid={`approvals-lane-failed-${v.key}`}>
        {LANE_FAILED} <button type="button" className="underline" onClick={onRetry}>Try again</button>
      </span>
    );
  }
  if (v.state === 'unrecorded') return <span title={v.reason} className={`cursor-help ${SUB}`} data-testid={`approvals-lane-unrecorded-${v.key}`}>{NOT_YET}</span>;
  return <span className={MONO} data-testid={`approvals-lane-count-${v.key}`}>{v.count.toLocaleString('en-US')}</span>;
}

/** A tile: its number, "Could not be read" with why, or a skeleton while it reads (APR12). */
function Tile({ label, testId, t, sub }) {
  return (
    <div className={`${CARD} flex min-w-0 flex-col gap-1 px-4 py-3`} data-testid={testId}>
      <span className={EYE}>{label}</span>
      <div className="text-[22px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">
        {t.state === 'loading' ? <Skeleton h={22} w="40%" />
          : t.state === 'unreadable' ? <span title={t.reason} className="cursor-help text-[13px] text-axal-destructive dark:text-red-300">{LANE_FAILED}</span>
            : <span className={MONO}>{t.value}</span>}
      </div>
      {t.state === 'unreadable' ? <span className={SUB}>{t.reason}</span> : (sub ?? t.sub) ? <span className={SUB}>{sub ?? t.sub}</span> : null}
    </div>
  );
}

/** A chart with its one-sentence summary for a screen reader and "View as table" (D915 §6). */
function ChartCard({ title, testId, chart, alt, legend, foot, children }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-2 px-4 py-3`} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={H2}>{title}</h2>
        {chart ? (
          <button type="button" aria-pressed={asTable} onClick={() => setAsTable((t) => !t)} className="min-h-[44px] text-[12px] font-bold text-axal-violet sm:min-h-0 dark:text-violet-300" data-testid={`${testId}-toggle`}>
            {asTable ? 'View as chart' : 'View as table'}
          </button>
        ) : null}
      </div>
      {legend}
      {chart && asTable ? <ChartTable chart={chart} caption={title} />
        : <div role="img" aria-label={alt} className="min-w-0" data-testid={`${testId}-img`}>{children}</div>}
      {foot ? <p className={`m-0 ${SUB}`}>{foot}</p> : null}
    </section>
  );
}

/** "We could not load …" with the reference a person can pass on (APR13b). */
function FailedCard({ title, line, error, onRetry, testId }) {
  const ref = errorRef(error);
  return (
    <div className={`${CARD} flex flex-col items-start gap-2 px-5 py-5`} role="alert" data-testid={testId}>
      <h2 className={H2}>{title}</h2>
      <p className={`m-0 ${SUB}`}>{line}</p>
      <button type="button" className={LINK} onClick={onRetry}>Try again</button>
      {ref ? (
        <details className={SUB} data-testid={`${testId}-details`}>
          <summary className="cursor-pointer">Details</summary>
          <span className={MONO}>{ref}</span>
        </details>
      ) : null}
    </div>
  );
}

/** The ⋯ menu on a row: Open, Assign…, Copy link (APR1). */
function RowMenu({ row, search, onAssign, onCopy }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`More for ${row.who}`} onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-axal-muted hover:bg-gray-100 dark:hover:bg-gray-800" data-testid={`approvals-menu-${row.key}`}>⋯</button>
      {open ? (
        <div role="menu" className={`${CARD} absolute right-0 z-10 mt-1 flex min-w-[150px] flex-col py-1 shadow-lg`}>
          <Link role="menuitem" to={`/admin/approvals/items/${row.lane}-${row.id}${search}`} data-testid={`approvals-menu-${row.key}-open`} className="px-3 py-1.5 text-[12.5px] hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => setOpen(false)}>Open</Link>
          <button role="menuitem" type="button" data-testid={`approvals-menu-${row.key}-assign`} className="px-3 py-1.5 text-left text-[12.5px] hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => { setOpen(false); onAssign([row]); }}>Assign…</button>
          <button role="menuitem" type="button" data-testid={`approvals-menu-${row.key}-copy`} className="px-3 py-1.5 text-left text-[12.5px] hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => { setOpen(false); onCopy(row); }}>Copy link</button>
        </div>
      ) : null}
    </div>
  );
}

/** The Assign dialog (APR3a): one admin, and it decides nothing. */
function AssignDialog({ items, inbox, callerId, onClose, onDone }) {
  const choices = assignChoices(inbox?.reply, callerId);
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!pick || busy) return;
    setBusy(true);
    try {
      await adminApprovalsApi.assign(pick, assignItems(items));
      const who = inbox?.reply?.reviewers?.find((r) => r.id === pick)?.name;
      onDone(`Assigned to ${who || 'that admin'}.`);
    } catch (e) {
      onDone(refusalToast(e));
    }
  };
  return (
    <Lightbox label={assignTitle(items)} title={assignTitle(items)} sub="They see it under Assigned to me. Assigning decides nothing." onClose={onClose} testId="approvals-assign" width={460}
      footer={(
        <div className={FOOT}>
          <button type="button" className={BTN} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} disabled={!pick || busy} onClick={send} data-testid="approvals-assign-send">{busy ? 'Assigning…' : 'Assign'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-1.5 px-5 py-4">
        {choices.state !== 'ready' ? <p className={`m-0 ${SUB}`} data-testid="approvals-assign-unread">{choices.text}</p> : (
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="sr-only">Assign to</legend>
            {choices.choices.map((c) => (
              <label key={c.id} className="flex min-h-[40px] items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100" data-testid={`approvals-assign-${c.id}`}>
                <input type="radio" name="assignee" checked={pick === c.id} onChange={() => setPick(c.id)} data-testid={`approvals-assign-pick-${c.id}`} />
                {c.label}
              </label>
            ))}
          </fieldset>
        )}
      </div>
    </Lightbox>
  );
}

/** The item at its own address (APR3): the facts, who holds it, its history, and the page that decides it. */
function ItemDrawer({ at, onClose, onAssign }) {
  const read = useRead(() => adminApprovalsApi.item(at.lane, at.id), `${at.lane}-${at.id}`);
  const v = itemView(read);
  const ready = v.state === 'ready';
  return (
    <Sheet label={ready ? `${v.who}, ${v.laneLabel}` : 'Item'} eyebrow="Item" title={ready ? v.who : 'Item'} onClose={onClose} testId="approvals-item" width={600}
      sub={ready ? 'Esc to close' : null}
      footer={ready ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-end gap-3 max-sm:flex-col-reverse max-sm:items-stretch">
            <button type="button" className={BTN} onClick={onClose}>Close</button>
            <span className="text-[12.5px]">Open in <DoorFor lane={v.lane} /></span>
          </div>
          <p className={`m-0 ${SUB}`}>This lane is decided on its own page, where its rules and messages live.</p>
        </div>
      ) : null}>
      <div className="flex flex-col gap-4 px-5 py-4" data-testid="approvals-item-body">
        <PhoneBack label="Approvals" onClose={onClose} testId="approvals-item-back" />
        {v.state === 'loading' ? <Skeleton.Text lines={4} /> : null}
        {v.state === 'gone' || v.state === 'missing' ? (
          <div className="flex flex-col items-start gap-2" data-testid={`approvals-item-${v.state}`}>
            <p className="m-0 text-[14px] font-bold text-axal-ink dark:text-gray-100">{v.text}</p>
            <button type="button" className={LINK} onClick={onClose}>Back to the inbox</button>
          </div>
        ) : null}
        {v.state === 'unread' ? (
          <FailedCard title="This item could not be read." line={v.text} error={read.error} onRetry={read.reload} testId="approvals-item-failed" />
        ) : null}
        {ready ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL.plain}`}>{v.laneLabel}</span>
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL[v.band.tone] || PILL.plain}`}>Waiting {v.age}</span>
            </div>
            <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[13px]" data-testid="approvals-item-facts">
              <dt className={EYE}>Submitted</dt><dd className="m-0">{v.submitted}</dd>
              <dt className={EYE}>Profile</dt><dd className="m-0">{v.what}</dd>
              <dt className={EYE}>Item ID</dt><dd className={`m-0 ${MONO}`}>{v.id}</dd>
              <dt className={EYE}>Lane</dt><dd className="m-0">{v.laneLabel}{v.group ? ` · ${v.group}` : ''}</dd>
            </dl>
            <section className="flex flex-wrap items-center justify-between gap-2" data-testid="approvals-item-assigned">
              <div>
                <div className={EYE}>Assigned</div>
                <div className="text-[13px]">{v.assignee.text}{v.assigneeReason ? <span className={SUB}> · {v.assigneeReason}</span> : null}</div>
              </div>
              <button type="button" className={BTN} onClick={() => onAssign([{ lane: v.lane, id: v.id, who: v.who, laneLabel: v.laneLabel }], read.reload)} data-testid="approvals-item-assign">Assign…</button>
            </section>
            <section className="flex flex-col gap-1" data-testid="approvals-item-history">
              <div className={EYE}>History</div>
              {v.history.state !== 'ready' ? <p className={`m-0 ${SUB}`}>{v.history.text}</p>
                : v.history.lines.length ? (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {v.history.lines.map((l, i) => <li key={i} className="text-[13px]">{l.text} <span className={SUB}>· {l.day}</span></li>)}
                  </ul>
                ) : <p className={`m-0 ${SUB}`}>Nobody has assigned it yet.</p>}
              {v.history.capped ? <p className={`m-0 ${SUB}`}>The oldest entries are not shown.</p> : null}
            </section>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Waiting on HQ (APR1): what this studio asked HQ and still waits on. */
function WaitingOnHq({ read }) {
  const v = waitingOnHq(read);
  return (
    <aside className={`${CARD} flex flex-col gap-1.5 self-start px-4 py-3`} data-testid="approvals-waiting-on-hq">
      <h2 className={H2}>Waiting on HQ</h2>
      <p className={`m-0 ${SUB}`}>What this studio asked HQ.</p>
      {v.state === 'loading' ? <Skeleton.Text lines={2} /> : null}
      {v.state === 'none' || v.state === 'unread' ? <p className={`m-0 ${SUB}`}>{v.text}</p> : null}
      {v.state === 'ready' ? (v.rows.length ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {v.rows.map((r) => <li key={r.key} className="text-[13px]">{r.text}<div className={SUB}>{r.sub}</div></li>)}
        </ul>
      ) : <p className={`m-0 ${SUB}`}>Nothing you asked HQ is open.</p>) : null}
      <Link to="/admin/my-licence/requests" className={LINK}>Licences › Requests</Link>
    </aside>
  );
}

/** D1047 (APR15): one item as a phone card — lane, who, what, its age and where it is decided, and ⋯. */
function RowCard({ row, search, onMore }) {
  const age = cardAge(row);
  return (
    <li className="flex items-start gap-2 border-b border-axal-hairline px-3 py-3 last:border-0 dark:border-gray-700" data-testid={`approvals-card-${row.key}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={EYE}>{row.laneLabel}</span>
        <Link to={`/admin/approvals/items/${row.lane}-${row.id}${search}`} className="inline-flex min-h-[28px] items-center text-[13.5px] font-bold text-axal-ink dark:text-gray-100" data-testid={`approvals-card-open-${row.key}`}>{row.who}</Link>
        <span className="text-[12.5px] text-axal-ink dark:text-gray-100">{row.what}</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL[age.tone] || PILL.plain}`} data-testid={`approvals-card-age-${row.key}`}>{age.text}</span>
          <span className="text-[12px] text-axal-ink dark:text-gray-100">Decided on <DoorFor lane={row.lane} /> ›</span>
        </div>
      </div>
      <button type="button" aria-label={`More for ${row.who}`} onClick={() => onMore(row)}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid={`approvals-card-more-${row.key}`}>⋯</button>
    </li>
  );
}

const SHEET_ITEM = 'flex min-h-[44px] items-center rounded-[8px] px-3 text-left text-[14px] font-semibold text-axal-ink hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800';

/** D1047 (APR15): a card's ⋯ as a bottom sheet: Open, Assign…, Copy link. */
function RowSheet({ row, search, onAssign, onCopy, onClose }) {
  return (
    <Lightbox label={`More for ${row.who}`} title={row.who} sub={row.laneLabel} phone="sheet" onClose={onClose} testId="approvals-row-sheet" width={420}>
      <div className="flex flex-col gap-1 px-3 py-3" role="menu">
        <Link role="menuitem" to={`/admin/approvals/items/${row.lane}-${row.id}${search}`} className={SHEET_ITEM} onClick={onClose} data-testid="approvals-row-sheet-open">Open</Link>
        <button role="menuitem" type="button" className={SHEET_ITEM} onClick={() => { onClose(); onAssign([row]); }} data-testid="approvals-row-sheet-assign">Assign…</button>
        <button role="menuitem" type="button" className={SHEET_ITEM} onClick={() => { onClose(); onCopy(row); }} data-testid="approvals-row-sheet-copy">Copy link</button>
      </div>
    </Lightbox>
  );
}

/** D1047 (APR15): the phone's filters and order as one bottom sheet, each choice applied as it is made. */
function FiltersSheet({ q, superAdmin, reviewers, n, typed, onType, setParams, total, onClose, onClear }) {
  const lanes = superAdmin ? [...LANES, ...HQ_LANES] : LANES;
  return (
    <Lightbox label="Filters and sort" title="Filters and sort" phone="sheet" onClose={onClose} testId="approvals-filters-sheet" width={460}
      footer={(
        <div className={FOOT}>
          <button type="button" className={BTN} onClick={onClear} data-testid="approvals-filters-clear">Clear</button>
          <button type="button" className={`${BTN_PRIMARY} flex-[1.4]`} onClick={onClose} data-testid="approvals-filters-done">{total == null ? 'Done' : `Show ${Number(total).toLocaleString('en-US')}`}</button>
        </div>
      )}>
      <div className="flex flex-col gap-4 px-5 py-4">
        <label className="flex flex-col gap-1">
          <span className={EYE}>Search</span>
          <input type="search" value={typed} placeholder="Search who and what" onChange={(e) => onType(e.target.value)}
            className="min-h-[44px] rounded-[7px] border border-axal-hairline bg-white px-3 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="approvals-sheet-search" />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={EYE}>Group</span>
          <div className="flex flex-wrap gap-[7px]" role="group" aria-label="Group">
            <button type="button" aria-pressed={!q.filters.group} className={`${CHIP} ${!q.filters.group ? CHIP_ON : CHIP_OFF}`} onClick={() => setParams({ group: null })}>All <span className={MONO}>{n('all')}</span></button>
            {inboxGroups(superAdmin).map((g) => (
              <button key={g.key} type="button" aria-pressed={q.filters.group === g.key} className={`${CHIP} ${q.filters.group === g.key ? CHIP_ON : CHIP_OFF}`}
                onClick={() => setParams({ group: g.key })} data-testid={`approvals-sheet-group-${g.key}`}>{g.label} <span className={MONO}>{n(g.key)}</span></button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className={EYE}>Lane</span>
          <select className={SELECT} value={q.filters.lane || ''} onChange={(e) => setParams({ lane: e.target.value || null })} data-testid="approvals-sheet-lane">
            <option value="">{`All ${lanes.length} lanes`}</option>
            {lanes.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={EYE}>Age</span>
          <div className="flex flex-wrap gap-[7px]" role="group" aria-label="Age">
            {AGE_FILTERS.map((a) => (
              <button key={a.label} type="button" aria-pressed={(q.filters.age || null) === a.key} className={`${CHIP} ${(q.filters.age || null) === a.key ? CHIP_ON : CHIP_OFF}`}
                onClick={() => setParams({ age: a.key })} data-testid={`approvals-sheet-age-${a.key || 'any'}`}>{a.label}</button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className={EYE}>Assigned</span>
          <select className={SELECT} value={q.filters.assigned || ''} onChange={(e) => setParams({ assigned: e.target.value || null })} data-testid="approvals-sheet-assigned">
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="none">Unassigned</option>
            {reviewers.map((r) => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={EYE}>Sort</span>
          <select className={SELECT} value={q.filters.sort || 'oldest'} onChange={(e) => setParams({ sort: e.target.value === 'oldest' ? null : e.target.value })} data-testid="approvals-sheet-sort">
            {SORTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
      </div>
    </Lightbox>
  );
}

/** The Inbox (APR1, APR11–APR14). */
function Inbox({ inbox, weekly, requests, views, glance, superAdmin, onAssign, toast }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const q = inboxQueryOf(loc.search, superAdmin);
  const [selected, setSelected] = useState(() => new Set());
  const [typed, setTyped] = useState(q.typed);
  // D1047 (APR15): the phone's bottom sheets — the filters, or one card's ⋯.
  const [sheet, setSheet] = useState(null);
  const setParams = (patch) => {
    const p = new URLSearchParams(loc.search);
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    if (!('page' in patch)) p.delete('page');
    const s = p.toString();
    navigate({ pathname: '/admin/approvals', search: s ? `?${s}` : '' }, { replace: true });
  };
  useEffect(() => { setSelected(new Set()); }, [loc.search]);

  if (q.filters.lane && isHqLane(q.filters.lane) && !superAdmin) {
    return (
      <div className={`${CARD} flex flex-col items-start gap-2 px-5 py-5`} data-testid="approvals-hq-only">
        <h2 className={H2}>{HQ_ONLY_TITLE}</h2>
        <p className={`m-0 ${SUB}`}>{HQ_ONLY_LINE}</p>
        <button type="button" className={LINK} onClick={() => setParams({ lane: null })}>Show my inbox</button>
      </div>
    );
  }

  const ready = inbox.status === 'ready';
  const reply = ready ? inbox.reply : null;
  const tiles = inboxTiles(inbox, weekly);
  const rows = inboxRows(reply);
  const counts = inboxGroupCounts(reply, superAdmin);
  const n = (k) => (counts[k] === null || counts[k] === undefined ? '—' : counts[k].toLocaleString('en-US'));
  const lanesChart = ready ? laneAgeChart(reply) : null;
  const weeks = weekly.status === 'ready' ? weekChart(weekly.reply) : null;
  const unread = reply?.unreadable || [];
  const lanesRead = (reply?.lanes || []).length - unread.length;
  const filtered = Object.keys(q.filters).some((k) => k !== 'sort');
  const picked = rows.filter((r) => selected.has(r.key));
  const toggle = (key) => setSelected((s) => { const next = new Set(s); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const copy = (row) => {
    const url = `${globalThis.location?.origin || ''}${row.href}`;
    Promise.resolve(globalThis.navigator?.clipboard?.writeText(url)).then(() => toast('Link copied.'), () => toast('The link could not be copied.'));
  };
  const hqDecides = glance.hq?.approvals?.hqDecides ?? null;
  const reviewers = Array.isArray(reply?.reviewers) ? reply.reviewers : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4" data-testid="approvals-tiles">
        <Tile label="Waiting" testId="approvals-tile-waiting" t={tiles.waiting} />
        <Tile label="Over 72 hours" testId="approvals-tile-over72" t={tiles.over72} sub={tiles.over72.state === 'ready' ? (oldestLine(views) || tiles.over72.sub) : undefined} />
        <Tile label="Assigned to you" testId="approvals-tile-assigned" t={tiles.mine} />
        <Tile label="Decided this week" testId="approvals-tile-decided" t={tiles.decided} />
      </div>

      {superAdmin && hqDecides ? (
        <p className={`m-0 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[12.5px] font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300`} data-testid="approvals-hq-band">
          {hqBandLine(hqDecides)}
        </p>
      ) : null}

      {inbox.status === 'error' ? (
        <FailedCard title="We could not load Approvals." line="The rest of the admin still works. Try again in a moment." error={inbox.error} onRetry={inbox.reload} testId="approvals-failed" />
      ) : (
        <>
          <div className="grid gap-3.5 lg:grid-cols-2">
            {lanesChart ? (
              <ChartCard title="Waiting by lane" testId="approvals-chart-lanes" chart={lanesChart.rows.length ? lanesChart : null} alt={lanesChart.sum}
                legend={<Legend items={BAND_PARTS.map((p) => (p.key === 'unknown' ? { label: p.label, tone: 'dash' } : { label: p.label, tone: p.tone }))} />}>
                {lanesChart.rows.length ? <Chart chart={{ ...lanesChart, testIdPrefix: 'approvals-bar' }} /> : <p className={`m-0 ${SUB}`}>{lanesChart.sum}</p>}
              </ChartCard>
            ) : (
              <section className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="approvals-chart-lanes"><h2 className={H2}>Waiting by lane</h2><Skeleton h={140} /></section>
            )}
            {weeks?.drawable ? (
              <ChartCard title="Arrived and decided, last 8 weeks" testId="approvals-chart-weeks" chart={weeks.chart} alt={weeks.sum} foot={weeks.foot}
                legend={<Legend items={[{ label: 'Arrived', tone: 'violet', mark: 'line' }, { label: 'Decided', tone: 'sky', mark: 'line' }, { label: 'This week, to date', tone: 'hollow' }]} />}>
                <Chart chart={weeks.chart} />
              </ChartCard>
            ) : (
              <section className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="approvals-chart-weeks">
                <h2 className={H2}>Arrived and decided, last 8 weeks</h2>
                {weekly.status === 'loading' ? <Skeleton h={140} />
                  : weekly.status === 'error' ? <p className={`m-0 text-[13px] text-axal-destructive dark:text-red-300`}>{LANE_FAILED}: the weekly series did not answer. <button type="button" className="underline" onClick={weekly.reload}>Try again</button></p>
                    : <p className={`m-0 ${SUB}`}>{weeks?.reason}</p>}
              </section>
            )}
          </div>

          {/* D1047 (APR15): on a phone, Filters with its count and Sort open one bottom sheet. */}
          <div className="flex gap-2 sm:hidden" data-testid="approvals-phone-filters">
            <button type="button" className={`${BTN} flex-1`} onClick={() => setSheet({ kind: 'filters' })} data-testid="approvals-filters-open">
              Filters · <span className={`ml-1 ${MONO}`} data-testid="approvals-filters-count">{filterCount(q.filters)}</span>
            </button>
            <button type="button" className={`${BTN} flex-[1.2]`} onClick={() => setSheet({ kind: 'filters' })} data-testid="approvals-sort-open">{`Sort: ${sortLabel(q.filters.sort)} ▾`}</button>
          </div>

          <div className="hidden flex-col gap-2.5 sm:flex" data-testid="approvals-filters">
            <div className="flex flex-wrap gap-[7px]" role="group" aria-label="Group">
              <button type="button" aria-pressed={!q.filters.group} className={`${CHIP} ${!q.filters.group ? CHIP_ON : CHIP_OFF}`} onClick={() => setParams({ group: null })}>All <span className={MONO}>{n('all')}</span></button>
              {inboxGroups(superAdmin).map((g) => (
                <button key={g.key} type="button" aria-pressed={q.filters.group === g.key} data-testid={`approvals-group-${g.key}`}
                  className={`${CHIP} ${q.filters.group === g.key ? CHIP_ON : CHIP_OFF}`}
                  onClick={() => setParams({ group: g.key })}>{g.label} <span className={MONO}>{n(g.key)}</span></button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-[220px] flex-1 flex-col gap-1 sm:max-w-[320px]">
                <span className="sr-only">Search who and what</span>
                <input type="search" value={typed} placeholder="Search who and what"
                  onChange={(e) => { setTyped(e.target.value); const t = e.target.value.trim(); if (t.length >= SEARCH_MIN || !t) setParams({ q: t || null }); }}
                  className="min-h-[40px] rounded-[7px] border border-axal-hairline bg-white px-3 text-[13px] dark:border-gray-700 dark:bg-gray-900" data-testid="approvals-search" />
              </label>
              <div className="flex flex-wrap gap-[7px]" role="group" aria-label="Age" data-testid="approvals-age">
                {AGE_FILTERS.map((a) => (
                  <button key={a.label} type="button" aria-pressed={(q.filters.age || null) === a.key} className={`${CHIP} ${(q.filters.age || null) === a.key ? CHIP_ON : CHIP_OFF}`}
                    onClick={() => setParams({ age: a.key })}>{a.label}</button>
                ))}
              </div>
              <label className="flex flex-col gap-1">
                <span className={EYE}>Assigned</span>
                <select className={SELECT} value={q.filters.assigned || ''} onChange={(e) => setParams({ assigned: e.target.value || null })} data-testid="approvals-assigned">
                  <option value="">Anyone</option>
                  <option value="me">Me</option>
                  <option value="none">Unassigned</option>
                  {reviewers.map((r) => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={EYE}>Sort</span>
                <select className={SELECT} value={q.filters.sort || 'oldest'} onChange={(e) => setParams({ sort: e.target.value === 'oldest' ? null : e.target.value })} data-testid="approvals-sort">
                  {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="grid gap-3.5 lg:grid-cols-[1fr_280px]">
            <section className={`${CARD} min-w-0 overflow-x-auto`} data-testid="approvals-inbox">
              {unread.length ? (
                <p className="m-0 border-b border-axal-hairline px-3 py-2 text-[12.5px] text-axal-destructive dark:border-gray-700 dark:text-red-300" data-testid="approvals-partial">
                  {unread.join(', ')} could not be read, so {unread.length === 1 ? 'its items are' : 'their items are'} missing below.
                  {' '}The other {lanesRead.toLocaleString('en-US')} lanes are complete.
                  {' '}<button type="button" className="underline" onClick={inbox.reload}>Try again</button>
                </p>
              ) : null}
              {reply?.capped ? <p className={`m-0 border-b border-axal-hairline px-3 py-2 dark:border-gray-700 ${SUB}`}>A lane holds more than the inbox reads at once; its oldest items are listed.</p> : null}
              {picked.length ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-axal-hairline bg-axal-lavender px-3 py-2 dark:border-gray-700 dark:bg-violet-950/40" data-testid="approvals-bulk">
                  <span className="text-[12.5px] font-bold">{picked.length.toLocaleString('en-US')} selected</span>
                  <button type="button" className={BTN} onClick={() => onAssign(picked)} data-testid="approvals-bulk-assign">Assign…</button>
                  <button type="button" className={BTN} onClick={() => setSelected(new Set())} data-testid="approvals-bulk-clear">Clear</button>
                </div>
              ) : null}
              {inbox.status === 'loading' ? <div className="px-3 py-3" data-testid="approvals-skeleton"><Skeleton.Table rows={6} cols={6} /></div>
                : rows.length ? (
                  <>
                  <ul className="m-0 list-none p-0 md:hidden" data-testid="approvals-cards">
                    {rows.map((r) => <RowCard key={r.key} row={r} search={loc.search} onMore={(row) => setSheet({ kind: 'row', row })} />)}
                  </ul>
                  <table className="hidden w-full min-w-[820px] md:table">
                    <thead>
                      <tr className="border-b border-axal-hairline dark:border-gray-700">
                        <th className={TH}><span className="sr-only">Select</span></th>
                        <th className={TH}>Waiting</th><th className={TH}>Lane</th><th className={TH}>Who</th><th className={TH}>What</th><th className={TH}>Assigned</th><th className={TH}>Decided on</th>
                        <th className={TH}><span className="sr-only">More</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`approvals-row-${r.key}`}>
                          <td className={TD}><input type="checkbox" aria-label={`Select ${r.who}`} checked={selected.has(r.key)} onChange={() => toggle(r.key)} data-testid={`approvals-pick-${r.key}`} /></td>
                          <td className={TD}><span className={MONO}>{r.age}</span><BandPill band={r.band} /></td>
                          <td className={TD}>{r.laneLabel}{r.group ? <div className={SUB}>{r.group}</div> : null}</td>
                          <td className={TD}><Link to={`/admin/approvals/items/${r.lane}-${r.id}${loc.search}`} className="font-bold text-axal-ink hover:underline dark:text-gray-100" data-testid={`approvals-open-${r.key}`}>{r.who}</Link></td>
                          <td className={TD}>{r.what}</td>
                          <td className={TD}><span className={r.assignee.kind === 'person' ? '' : SUB}>{r.assignee.text}</span></td>
                          <td className={TD}><DoorFor lane={r.lane} /></td>
                          <td className={TD}><RowMenu row={r} search={loc.search} onAssign={onAssign} onCopy={copy} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </>
                ) : (
                  <div className="flex flex-col items-start gap-1.5 px-4 py-5" data-testid="approvals-empty">
                    {filtered ? (
                      <>
                        <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">Nothing matches these filters.</span>
                        <button type="button" className={LINK} onClick={() => { setTyped(''); navigate('/admin/approvals', { replace: true }); }}>Clear filters</button>
                      </>
                    ) : unread.length ? (
                      <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">Nothing else is waiting in the lanes that answered.</span>
                    ) : (
                      <>
                        <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">Nothing is waiting on you.</span>
                        <span className={SUB}>New items arrive here as members apply, submit and ask.</span>
                        <Link to="/admin/approvals/decided" className={LINK}>See what was decided</Link>
                      </>
                    )}
                  </div>
                )}
              {rows.length ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline px-3 py-2 dark:border-gray-700">
                  <span className={`${SUB} ${MONO}`} data-testid="approvals-count">{pageLine(reply)}</span>
                  <div className="flex gap-2 max-sm:w-full max-sm:*:flex-1">
                    <button type="button" className={BTN} disabled={q.page <= 1} onClick={() => setParams({ page: q.page > 2 ? String(q.page - 1) : null })}>Previous</button>
                    <button type="button" className={BTN} disabled={!hasNextPage(reply)} onClick={() => setParams({ page: String(q.page + 1) })} data-testid="approvals-next">Next</button>
                  </div>
                </div>
              ) : null}
            </section>
            <WaitingOnHq read={requests} />
          </div>
        </>
      )}
      {sheet?.kind === 'filters' ? (
        <FiltersSheet q={q} superAdmin={superAdmin} reviewers={reviewers} n={n} typed={typed}
          onType={(v) => { setTyped(v); const t = v.trim(); if (t.length >= SEARCH_MIN || !t) setParams({ q: t || null }); }}
          setParams={setParams} total={reply?.total ?? null} onClose={() => setSheet(null)}
          onClear={() => { setTyped(''); navigate('/admin/approvals', { replace: true }); }} />
      ) : null}
      {sheet?.kind === 'row' ? <RowSheet row={sheet.row} search={loc.search} onAssign={onAssign} onCopy={copy} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

function LaneTable({ group, views, glanceLanes, onRetry }) {
  const rows = views.filter((v) => v.group === group.key);
  return (
    <section className={`${CARD} overflow-x-auto`} data-testid={`approvals-lanes-${group.key}`}>
      <h2 className={`${H2} px-3 pt-3`}>{group.label}</h2>
      <table className="w-full min-w-[760px]">
        <thead><tr className="border-b border-axal-hairline dark:border-gray-700"><th className={TH}>Lane</th><th className={TH}>Waiting</th><th className={TH}>Oldest</th><th className={TH}>Decided on</th><th className={TH}>Who decides</th><th className={TH}>Notifies</th></tr></thead>
        <tbody>
          {rows.map((v) => {
            const notifies = notifiesOf(glanceLanes.find((l) => l.key === v.glance));
            return (
              <tr key={v.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`approvals-lane-${v.key}`}>
                <td className={TD}>{v.label}{v.isNew ? <span className={NEW_PILL}>New</span> : null}{v.note ? <div className={SUB}>{v.note}</div> : null}</td>
                <td className={TD}><WaitingCell v={v} onRetry={onRetry} /></td>
                <td className={TD}>{v.state === 'ready' && v.count > 0 ? <><span className={MONO}>{v.age || 'Age not recorded'}</span><BandPill band={v.band} /></> : <span className={SUB}>—</span>}</td>
                <td className={TD}><LaneDoor k={v.key} /></td>
                <td className={TD}>Admin and Super Admin</td>
                <td className={TD} data-testid={`approvals-notifies-${v.key}`}>
                  {notifies.warn ? <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL.warn}`}>{notifies.text}</span>
                    : <span className={notifies.state === 'ready' ? '' : SUB}>{notifies.text}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Lanes (APR2), plus HQ decides with its counts for a Super Admin (APR9) and the Not-a-queue card. */
function Lanes({ views, glance, superAdmin }) {
  const ap = glance.hq?.approvals;
  const glanceLanes = ap?.kind === 'ready' ? ap.lanes : [];
  const hq = hqLaneViews(ap?.hqDecides ?? null);
  return (
    <div className="flex flex-col gap-3.5">
      <p className={`m-0 ${SUB}`}>{LANES_LINE}</p>
      {GROUPS.map((g) => <LaneTable key={g.key} group={g} views={views} glanceLanes={glanceLanes} onRetry={glance.reload} />)}
      {superAdmin ? (
        <section className={`${CARD} overflow-x-auto`} data-testid="approvals-hq-lanes">
          <h2 className={`${H2} px-3 pt-3`}>HQ decides</h2>
          <p className={`m-0 px-3 ${SUB}`}>{hqBandLine(ap?.hqDecides ?? null) || 'Only Super Admins see this group.'}</p>
          <table className="w-full min-w-[640px]">
            <thead><tr className="border-b border-axal-hairline dark:border-gray-700"><th className={TH}>Lane</th><th className={TH}>Waiting</th><th className={TH}>Oldest</th><th className={TH}>Decided on</th><th className={TH}>Who decides</th></tr></thead>
            <tbody>
              {hq.map((l) => (
                <tr key={l.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`approvals-hq-${l.key}`}>
                  <td className={TD}>{l.label}</td>
                  <td className={TD} data-testid={`approvals-hq-count-${l.key}`}>
                    {l.state === 'ready' ? <span className={MONO}>{l.count.toLocaleString('en-US')}</span>
                      : l.state === 'unreadable' ? <span title={l.reason} className="cursor-help text-axal-destructive dark:text-red-300">{LANE_FAILED}</span>
                        : <span title={l.reason} className={`cursor-help ${SUB}`}>{NOT_YET}</span>}
                  </td>
                  <td className={TD}>{l.state === 'ready' && l.count > 0 ? <span className={MONO}>{l.age || 'Age not recorded'}</span> : <span className={SUB}>—</span>}</td>
                  <td className={TD}><HqDoor lane={l} /></td>
                  <td className={TD}>Super Admin</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      <section className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="approvals-not-a-queue">
        <h2 className={H2}>Not a queue</h2>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          <li className={SUB}><Link to="/admin/directory" className={LINK}>Directory</Link>: {NOT_A_QUEUE[0].reason}</li>
          <li className={SUB}><Link to="/admin/circles" className={LINK}>Circles</Link>: {NOT_A_QUEUE[1].reason}</li>
          <li className={SUB}><Link to="/admin/partner-invitations" className={LINK}>Partner invitations</Link>: {NOT_A_QUEUE[2].reason}</li>
          <li className={SUB}><Link to="/admin/programs/mentor-cohorts/people" className={LINK}>Mentor cohort access</Link>: {NOT_A_QUEUE[3].reason}</li>
          <li className={SUB}><Link to="/admin/programs/spinout-lab/formation" className={LINK}>83(b) follow-ups and formation packets</Link>: {NOT_A_QUEUE[4].reason}</li>
        </ul>
      </section>
    </div>
  );
}

/** Decided (APR10): the log, newest first, with what it cannot say. */
function Decided({ decided }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const f = decidedQueryOf(loc.search);
  const setParams = (patch) => {
    const p = new URLSearchParams(loc.search);
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    if (!('page' in patch)) p.delete('page');
    const s = p.toString();
    navigate({ pathname: '/admin/approvals/decided', search: s ? `?${s}` : '' }, { replace: true });
  };
  if (decided.status === 'error') {
    return <FailedCard title="We could not load what was decided." line="The Inbox and each lane’s own page still work." error={decided.error} onRetry={decided.reload} testId="approvals-decided-failed" />;
  }
  const reply = decided.status === 'ready' ? decided.reply : null;
  const rows = decidedRows(reply);
  const notes = decidedNotes(reply);
  const size = Number(reply?.page_size) || 25;
  const more = reply && (reply.total === null || reply.total === undefined ? rows.length === size : f.page * size < reply.total) && f.page < 40;
  return (
    <div className="flex flex-col gap-3.5" data-testid="approvals-decided">
      <p className={`m-0 ${SUB}`}>{DECIDED_LINE}</p>
      {notes.since.length || notes.notRecorded.length || notes.caveats.length || notes.unreadable.length ? (
        <div className={`${CARD} flex flex-col gap-1 px-4 py-3`} data-testid="approvals-decided-notes">
          {notes.since.map((t) => <p key={t} className={`m-0 ${SUB}`}>{t}</p>)}
          {notes.notRecorded.map((n) => <p key={n.label} className={`m-0 ${SUB}`}>{n.label}: {n.reason}</p>)}
          {notes.caveats.map((c) => <p key={c.label} className={`m-0 ${SUB}`}>{c.label}: {c.text}</p>)}
          {notes.unreadable.length ? <p className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300">{notes.unreadable.join(', ')} could not be read, so {notes.unreadable.length === 1 ? 'its decisions are' : 'their decisions are'} missing below.</p> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-3" data-testid="approvals-decided-filters">
        <label className="flex flex-col gap-1">
          <span className={EYE}>Lane</span>
          <select className={SELECT} value={f.lane || ''} onChange={(e) => setParams({ lane: e.target.value || null })}>
            <option value="">Every lane</option>
            {LANES.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-[7px]" role="group" aria-label="Outcome">
          {OUTCOME_FILTERS.map((o) => (
            <button key={o.label} type="button" aria-pressed={(f.outcome || null) === o.key} className={`${CHIP} ${(f.outcome || null) === o.key ? CHIP_ON : CHIP_OFF}`} onClick={() => setParams({ outcome: o.key })}>{o.label}</button>
          ))}
        </div>
        <label className="flex flex-col gap-1"><span className={EYE}>From</span><input type="date" className={SELECT} value={f.from || ''} onChange={(e) => setParams({ from: e.target.value || null })} /></label>
        <label className="flex flex-col gap-1"><span className={EYE}>To</span><input type="date" className={SELECT} value={f.to || ''} onChange={(e) => setParams({ to: e.target.value || null })} /></label>
      </div>
      <section className={`${CARD} overflow-x-auto`}>
        {!reply ? <div className="px-3 py-3"><Skeleton.Table rows={6} cols={6} /></div>
          : rows.length ? (
            <table className="w-full min-w-[820px]">
              <thead><tr className="border-b border-axal-hairline dark:border-gray-700"><th className={TH}>Decided</th><th className={TH}>Lane</th><th className={TH}>Who</th><th className={TH}>Outcome</th><th className={TH}>Decided by</th><th className={TH}>Wait</th><th className={TH}>Note</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`approvals-decided-${r.key}`}>
                    <td className={TD}><span className={MONO}>{r.when}</span></td>
                    <td className={TD}>{r.lane}</td>
                    <td className={TD}>{r.who}</td>
                    <td className={TD}><span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL[r.outcome.tone] || PILL.plain}`}>{r.outcome.word}</span></td>
                    <td className={TD}>{r.by}</td>
                    <td className={TD}><span className={MONO}>{r.wait}</span></td>
                    <td className={TD}>{r.note ? <>{r.note}{r.shown ? <div className={SUB}>◉ They see this</div> : null}</> : <span className={SUB}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className={`m-0 px-4 py-5 ${SUB}`} data-testid="approvals-decided-empty">Nothing recorded as decided matches.</p>}
        {rows.length ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline px-3 py-2 dark:border-gray-700">
            <span className={`${SUB} ${MONO}`} data-testid="approvals-decided-count">{decidedPageLine(reply)}</span>
            <div className="flex gap-2">
              <button type="button" className={BTN} disabled={f.page <= 1} onClick={() => setParams({ page: f.page > 2 ? String(f.page - 1) : null })}>Previous</button>
              <button type="button" className={BTN} disabled={!more} onClick={() => setParams({ page: String(f.page + 1) })}>Next</button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
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
  const inbox = useRead(() => adminApprovalsApi.inbox(iq.page, iq.filters), JSON.stringify(iq.filters) + iq.page, onInbox);
  const weekly = useRead(() => adminApprovalsApi.weekly(), 'weekly', onInbox);
  const requests = useRead(() => licenceRequestsApi.list(), 'requests', onInbox);
  const dq = decidedQueryOf(loc.search);
  const { page: dPage, ...dFilters } = dq;
  const decided = useRead(() => adminApprovalsApi.decided(dPage, dFilters), JSON.stringify(dq), tab === 'decided');

  const [assignFor, setAssignFor] = useState(null);
  const [toastText, setToastText] = useState(null);
  useEffect(() => {
    if (!toastText) return undefined;
    const t = setTimeout(() => setToastText(null), 8000);
    return () => clearTimeout(t);
  }, [toastText]);
  const openAssign = (rows, after) => setAssignFor({ rows, after });
  const doneAssign = (text) => {
    const after = assignFor?.after;
    setAssignFor(null);
    setToastText(text);
    inbox.reload();
    after?.();
  };
  const closeItem = () => navigate({ pathname: '/admin/approvals', search: loc.search });

  const counted = views.filter((v) => v.glance);
  const inboxCount = onInbox && inbox.status === 'ready' && inbox.reply.unfiltered_total != null
    ? { kind: 'num', value: `${Number(inbox.reply.unfiltered_total).toLocaleString('en-US')}${inbox.reply.unreadable?.length ? ' +' : ''}` }
    : counted.some((v) => v.state === 'loading') ? { kind: 'load' }
      : counted.every((v) => v.state === 'ready') ? { kind: 'num', value: counted.reduce((t, v) => t + v.count, 0).toLocaleString('en-US') }
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
      <AdminPageHeader title={TITLE} line={LINE} scope notice={{ text: notice.text, onDismiss: notice.dismiss }} tabs={tabs} data-testid="approvals-header" />
      {onInbox ? <Inbox inbox={inbox} weekly={weekly} requests={requests} views={views} glance={glance} superAdmin={superAdmin} onAssign={openAssign} toast={setToastText} /> : null}
      {tab === 'lanes' ? <Lanes views={views} glance={glance} superAdmin={superAdmin} /> : null}
      {tab === 'decided' ? <Decided decided={decided} /> : null}
      {item ? <ItemDrawer key={`${item.lane}-${item.id}`} at={item} onClose={closeItem} onAssign={openAssign} /> : null}
      {assignFor ? <AssignDialog items={assignFor.rows} inbox={inbox} callerId={user?.id} onClose={() => setAssignFor(null)} onDone={doneAssign} /> : null}
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
    <AdminBoardFrame workspace="Approvals" note={RAIL_NOTE} data-testid="admin-board-approvals">
      <ApprovalsPage />
    </AdminBoardFrame>
  );
}
