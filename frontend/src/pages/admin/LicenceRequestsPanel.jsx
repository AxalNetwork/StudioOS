/**
 * D801 (#2234) — "Requests from the Administrator" beside HQ's licence page
 * (canvas board L9, "Open requests [n]"): this licence's open escalations of
 * D799's kinds and `seat_increase`, each with its response-time band and
 * "Answer".
 *
 * ANSWER IS THE SUPPORT QUEUE'S OWN PANEL (`EscalationDecision`), so it calls
 * the existing `PATCH /api/admin/escalations/:uid` and nothing new. A
 * `terms_change` shows the term as it stands and "Open terms"; a `delegate`
 * links "Grant admin" to the Admins step, which appoints through the existing
 * `POST /api/admin/licences/:uid/admins`; a `non_renewal` shows its notice date
 * against the notice period the terms record.
 *
 * #4700 — SCOPED ON THE SERVER. The panel used to read HQ's whole board, one
 * capped list per kind, and keep this licence's rows in the browser: a request
 * past the cap vanished, and a branch's request never matched because this
 * page had no deployment code to match it by. It now reads
 * `GET /api/admin/licences/:uid/requests`, which matches HQ-origin and
 * branch-origin requests in SQL, counts them, then pages. The heading's count
 * is that total; a page short of it says how many are shown and offers more;
 * a branch the server could not look up is said, not read as none.
 *
 * D4819 part 12 (#5923) — board L12. On Operations › Requests and compliance
 * the same read is drawn as the canvas's "Studio requests" table (`layout`
 * "section"): each request with who raised it, its age and Decline… /
 * Approve…, which open the Support queue's panel on that outcome. A request
 * decided here shows who decided it and when, from the row the decision
 * returned; the read itself lists open requests only. A failed read says
 * Unavailable with Try again, never none. Every other tab keeps the side
 * panel (`layout` "aside").
 */
import React, { useCallback, useEffect, useState } from 'react';
import { licenceLedgerApi } from '../../lib/api/licenceLedger';
import { licenceTermsApi } from '../../lib/api/licenceTerms';
import { reportError } from '../../lib/log';
import { nonRenewalCheck, requestSummary, termAsItStands, termTarget } from '../../lib/escalationKinds';
import { LICENCE_TERM_FIELDS } from '../../lib/licenceTermsForm';
import { EscalationDecision, recordOf } from '../hq/HqSupportPage';
import { FactState, TryAgain } from './licences/LicenceOverview';
import { decidedLine, requestAge, requestsState } from './licenceOperationsModel';

const SCHEDULE_KEYS = LICENCE_TERM_FIELDS.map((f) => f.key);
/** The board's response-time band (`listEscalations`): within it, due soon, or past it. */
export const BAND = {
  ok: ['Within response time', 'text-gray-500'],
  due_soon: ['Response due soon', 'text-amber-700'],
  past: ['Past response time', 'text-red-700'],
};
const linkCls = 'rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300';

/**
 * One page of this licence's open requests, scoped by the server; null when
 * HQ's board cannot be read. `total` counts every match, not the page.
 */
export async function loadLicenceRequests(licenceUid, cursor = null) {
  const r = await licenceLedgerApi.requests(licenceUid, cursor ? { cursor } : {});
  if (!r || r.available === false || !Array.isArray(r.items)) return null;
  return {
    items: r.items,
    total: Number.isFinite(r.total) ? r.total : null,
    nextCursor: r.next_cursor || null,
    branchReadable: r.branch_readable !== false,
  };
}

function RequestDetail({ item, licence, noticeDays, onOpenTerm, onGrantAdmin }) {
  const r = item.request || {};
  if (item.kind === 'terms_change') {
    const target = termTarget(r.term, SCHEDULE_KEYS);
    return (
      <div className="mt-1 space-y-1 text-[11px] text-gray-600 dark:text-gray-400">
        <div>As it stands: {termAsItStands(r.term, licence) || r.current || 'Not recorded'}</div>
        {r.current && <div>The Administrator reads it as: {r.current}</div>}
        <div>Asks for: {r.asked || 'Not stated'}</div>
        <button type="button" className={linkCls} onClick={() => onOpenTerm(target)}>Open terms</button>
      </div>
    );
  }
  if (item.kind === 'delegate') {
    return (
      <div className="mt-1 space-y-1 text-[11px] text-gray-600 dark:text-gray-400">
        <div>{r.name ? `${r.name} · ` : ''}{r.email || 'No email given'}</div>
        {r.email && (
          <button type="button" className={linkCls} onClick={() => onGrantAdmin({ email: r.email, uid: item.uid })}>Grant admin</button>
        )}
      </div>
    );
  }
  if (item.kind === 'non_renewal') {
    const check = nonRenewalCheck(item.created_at, licence.renews_on, noticeDays);
    return (
      <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-400" data-testid="non-renewal-check">
        {check.given_on ? `Notice given ${check.given_on}. ` : ''}
        {check.in_time === null
          ? 'The notice period or the renewal date is not recorded, so it cannot be checked against the terms.'
          : check.in_time
            ? `Due by ${check.due_by} (${noticeDays} days before ${licence.renews_on}): in time.`
            : `Due by ${check.due_by} (${noticeDays} days before ${licence.renews_on}): ${check.days_late} days late.`}
      </div>
    );
  }
  if (item.kind === 'seat_increase' && r.seat_type) {
    const now = licence.seats?.[r.seat_type];
    return <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">Licensed now: {now ?? 0}. Asks for {r.seats} more.</div>;
  }
  return null;
}

const BRANCH_UNREAD = 'Its branch could not be looked up, so requests raised on the branch were not looked for — they are unknown, not none.';

/**
 * The panel, given the requests already read. Separate from the loader so a
 * test can draw it. `total` is every open request the server matched;
 * `branchReadable` false means branch-origin requests were not looked for.
 */
export function RequestsPanelView({
  items, total = null, branchReadable = true, hasMore = false, loadingMore = false, onMore,
  licence, noticeDays, openUid, onToggle, onRecorded, onReload, onOpenTerm, onGrantAdmin,
}) {
  if (items === undefined) return <p className="text-xs text-gray-500">Loading…</p>;
  if (items === null) {
    return (
      <p className="text-xs text-red-600" role="alert" data-testid="licence-requests-unreadable">
        HQ&apos;s escalation board could not be read, so this licence&apos;s requests are unknown — not none.{' '}
        {onReload && <TryAgain what="the requests" onClick={onReload} />}
      </p>
    );
  }
  const branchNote = branchReadable ? null : <p className="text-xs text-amber-700" data-testid="licence-requests-branch-unread">{BRANCH_UNREAD}</p>;
  if (!items.length) {
    // Empty is only "none" when the server counted none and looked everywhere.
    if (total === 0 && branchReadable) return <p className="text-xs text-gray-500">No open requests from this licence&apos;s Administrator.</p>;
    if (total === 0) return <div className="space-y-1"><p className="text-xs text-gray-500">No open requests filed against this licence at HQ.</p>{branchNote}</div>;
    return <p className="text-xs text-red-600" data-testid="licence-requests-partial">This licence&apos;s requests could not all be read, so they are unknown — not none.</p>;
  }
  const shortOf = total !== null && items.length < total;
  return (
    <div className="space-y-2">
    {branchNote}
    <ul className="space-y-3" data-testid="licence-requests">
      {items.map((it) => (
        <li key={it.uid} className="rounded-md border border-gray-200 p-2 dark:border-gray-800" data-testid={`licence-request-${it.uid}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{requestSummary(it)}</div>
            <span className={`shrink-0 text-[11px] ${(BAND[it.sla] || BAND.ok)[1]}`} data-testid="request-band">
              {(BAND[it.sla] || BAND.ok)[0]}{it.due_at ? ` · due ${String(it.due_at).slice(0, 10)}` : ''}
            </span>
          </div>
          <div className="text-[11px] text-gray-500">
            {String(it.created_at || '').slice(0, 10)}{it.raised_by_name ? ` · from ${it.raised_by_name}` : ''}
          </div>
          {it.note && <p className="mt-1 text-[11px] text-gray-700 dark:text-gray-300">{it.note}</p>}
          <RequestDetail item={it} licence={licence} noticeDays={noticeDays} onOpenTerm={onOpenTerm} onGrantAdmin={onGrantAdmin} />
          <button type="button" className={`${linkCls} mt-2`} onClick={() => onToggle(it.uid)} aria-expanded={openUid === it.uid}>
            Answer
          </button>
          {openUid === it.uid && (
            <div className="mt-2">
              <EscalationDecision item={it} onRecorded={onRecorded} onReload={onReload} />
            </div>
          )}
        </li>
      ))}
    </ul>
    {(shortOf || hasMore) && (
      <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500" data-testid="licence-requests-partial">
        <span>{total !== null ? `Showing ${items.length} of ${total} open requests.` : `Showing ${items.length}; more are open.`}</span>
        {hasMore && onMore && (
          <button type="button" className={linkCls} onClick={onMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Show more'}</button>
        )}
      </div>
    )}
    </div>
  );
}

/** The requests read, its next page and the notice period, shared by both layouts. */
function useLicenceRequests(licence) {
  const [read, setRead] = useState(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [noticeDays, setNoticeDays] = useState(null);
  const load = useCallback(() => {
    setRead((cur) => (cur === null ? undefined : cur));
    loadLicenceRequests(licence.uid)
      .then(setRead)
      .catch((e) => { reportError('licence_requests_load_failed', e); setRead(null); });
    // The notice period a non-renewal is checked against; unread, it is "not recorded".
    licenceTermsApi.get(licence.uid)
      .then((r) => setNoticeDays(r?.terms?.non_renewal_notice_days ?? null))
      .catch(() => setNoticeDays(null));
  }, [licence.uid]);
  useEffect(load, [load]);
  const more = useCallback(() => {
    if (!read?.nextCursor) return;
    setLoadingMore(true);
    loadLicenceRequests(licence.uid, read.nextCursor)
      .then((next) => setRead((cur) => (next && cur ? {
        ...next, items: [...cur.items, ...next.items.filter((n) => !cur.items.some((c) => c.uid === n.uid))],
      } : cur)))
      .catch((e) => reportError('licence_requests_more_failed', e))
      .finally(() => setLoadingMore(false));
  }, [licence.uid, read]);
  return { read, load, more, loadingMore, noticeDays };
}

const actBtn = 'rounded-md border px-2 py-1 text-[11px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600';

/**
 * Board L12's "Studio requests", given the read. `read` is undefined while it
 * is on its way, null when it failed, else `{ items, total, nextCursor,
 * branchReadable }`. `open` is `{ uid, outcome }` for the request whose
 * decision panel is open; `decided` the requests decided on this page, as
 * `recordOf` returned them. Separate from the loader so a test can draw it.
 */
export function StudioRequestsView({
  read, decided = [], open = null, onOpen, onRecorded, onReload, onMore, loadingMore = false,
  licence, noticeDays, onOpenTerm, onGrantAdmin, now = new Date().toISOString(),
}) {
  const head = requestsState(read);
  const items = read && Array.isArray(read.items) ? read.items : [];
  const shortOf = read && Number.isFinite(read.total) && items.length < read.total;
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-testid="studio-requests" aria-labelledby="studio-requests-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="studio-requests-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">Studio requests</h3>
        <span className="text-sm"><FactState state={head.state} testId="studio-requests-state">{head.word}</FactState></span>
      </div>
      {read === undefined && <p className="mt-2 text-xs text-gray-500">Reading this licence&apos;s requests…</p>}
      {read === null && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300" role="alert" data-testid="studio-requests-unreadable">
          HQ&apos;s request board could not be read, so this licence&apos;s requests are unknown — not none.{' '}
          <TryAgain what="the studio requests" onClick={onReload} />
        </p>
      )}
      {read && read.branchReadable === false && (
        <p className="mt-2 text-xs text-amber-800 dark:text-amber-300" data-testid="studio-requests-branch-unread">{BRANCH_UNREAD}</p>
      )}
      {read && !items.length && read.total === 0 && read.branchReadable !== false && (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400" data-testid="studio-requests-none">No open requests from this licence&apos;s administrator.</p>
      )}
      {read && !items.length && read.total !== 0 && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300" data-testid="studio-requests-partial">
          This licence&apos;s requests could not all be read, so they are unknown — not none. <TryAgain what="the studio requests" onClick={onReload} />
        </p>
      )}
      {items.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-[12.5px]" data-testid="studio-requests-table">
            <thead>
              <tr className="text-[11px] uppercase text-gray-500 dark:text-gray-400">
                <th className="py-1 pr-3 font-medium">Request</th>
                <th className="py-1 pr-3 font-medium">From</th>
                <th className="py-1 pr-3 font-medium">Age</th>
                <th className="py-1 font-medium"><span className="sr-only">Decision</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const band = BAND[it.sla] || BAND.ok;
                const isOpen = open?.uid === it.uid;
                return (
                  <React.Fragment key={it.uid}>
                    <tr className="border-t border-gray-100 align-top dark:border-gray-800" data-testid={`studio-request-${it.uid}`}>
                      <td className="py-1.5 pr-3">
                        <b className="font-semibold text-gray-900 dark:text-gray-100">{requestSummary(it)}</b>
                        {it.note && <p className="mt-0.5 text-[11px] text-gray-700 dark:text-gray-300">{it.note}</p>}
                        <RequestDetail item={it} licence={licence} noticeDays={noticeDays} onOpenTerm={onOpenTerm} onGrantAdmin={onGrantAdmin} />
                      </td>
                      <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-300">{it.raised_by_name || 'Not recorded'}</td>
                      <td className="py-1.5 pr-3">
                        <span className="font-mono text-gray-900 dark:text-gray-100" data-testid="studio-request-age">{requestAge(it.created_at, now)}</span>
                        <span className={`block text-[11px] ${band[1]}`}>{band[0]}</span>
                      </td>
                      <td className="whitespace-nowrap py-1.5 text-right">
                        <button type="button" aria-expanded={isOpen && open.outcome === 'declined'} data-testid="studio-request-decline"
                          onClick={() => onOpen?.(isOpen && open.outcome === 'declined' ? null : { uid: it.uid, outcome: 'declined' })}
                          className={`${actBtn} border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800`}>
                          Decline…
                        </button>{' '}
                        <button type="button" aria-expanded={isOpen && open.outcome === 'answered'} data-testid="studio-request-approve"
                          onClick={() => onOpen?.(isOpen && open.outcome === 'answered' ? null : { uid: it.uid, outcome: 'answered' })}
                          className={`${actBtn} border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 dark:border-indigo-500 dark:bg-indigo-600`}>
                          Approve…
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr><td colSpan={4} className="pb-2">
                        <EscalationDecision key={`${it.uid}:${open.outcome}`} item={it} initialOutcome={open.outcome} onRecorded={onRecorded} onReload={onReload} />
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(shortOf || read?.nextCursor) && (
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-gray-500" data-testid="studio-requests-more">
          <span>{Number.isFinite(read.total) ? `Showing ${items.length} of ${read.total} open requests.` : `Showing ${items.length}; more are open.`}</span>
          {read.nextCursor && onMore && (
            <button type="button" className={linkCls} onClick={onMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Show more'}</button>
          )}
        </div>
      )}
      {decided.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-2 dark:border-gray-800" data-testid="studio-requests-decided">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Decided here</h4>
          <ul className="mt-1 space-y-1 text-[12px] text-gray-700 dark:text-gray-300">
            {decided.map((d) => (
              <li key={d.uid} data-testid={`studio-request-decided-${d.uid}`}>
                <b className="font-semibold">{d.subject || 'Request'}</b> · {decidedLine(d).text}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
        Approve and Decline each need a reason, which is stored with the decision and sent to whoever raised it.
        This list holds open requests only: one decided before this page was opened is on Support, with who decided it and when.
      </p>
    </section>
  );
}

/**
 * The requests beside the licence (`layout` "aside", every tab but one) or
 * board L12's Studio requests (`layout` "section", on Operations › Requests
 * and compliance).
 */
export default function LicenceRequestsPanel({ licence, onOpenTerm, onGrantAdmin, layout = 'aside' }) {
  const { read, load, more, loadingMore, noticeDays } = useLicenceRequests(licence);
  const [openUid, setOpenUid] = useState(null);
  const [open, setOpen] = useState(null);
  const [decided, setDecided] = useState([]);
  if (layout === 'section') {
    return (
      <StudioRequestsView
        read={read} decided={decided} open={open} onOpen={setOpen}
        onRecorded={(item, outcome, res) => {
          const rec = { ...recordOf(item, outcome, res), subject: requestSummary(item) };
          setDecided((cur) => [rec, ...cur.filter((x) => x.uid !== rec.uid)]);
          setOpen(null);
          load();
        }}
        onReload={load} onMore={more} loadingMore={loadingMore}
        licence={licence} noticeDays={noticeDays} onOpenTerm={onOpenTerm} onGrantAdmin={onGrantAdmin}
      />
    );
  }
  const items = read === undefined ? undefined : read === null ? null : read.items;

  return (
    <aside className="rounded-lg border border-gray-200 p-3 dark:border-gray-800" data-testid="licence-requests-panel">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Requests from the Administrator{read && read.total !== null ? ` · Open ${read.total}` : ''}
      </h3>
      <RequestsPanelView
        items={items} total={read?.total ?? null} branchReadable={read?.branchReadable !== false}
        hasMore={Boolean(read?.nextCursor)} loadingMore={loadingMore} onMore={more}
        licence={licence} noticeDays={noticeDays} openUid={openUid}
        onToggle={(uid) => setOpenUid((u) => (u === uid ? null : uid))}
        onRecorded={() => { setOpenUid(null); load(); }}
        onReload={load}
        onOpenTerm={onOpenTerm}
        onGrantAdmin={onGrantAdmin}
      />
    </aside>
  );
}
