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
 */
import React, { useCallback, useEffect, useState } from 'react';
import { licenceLedgerApi } from '../../lib/api/licenceLedger';
import { licenceTermsApi } from '../../lib/api/licenceTerms';
import { reportError } from '../../lib/log';
import { nonRenewalCheck, requestSummary, termAsItStands, termTarget } from '../../lib/escalationKinds';
import { LICENCE_TERM_FIELDS } from '../../lib/licenceTermsForm';
import { EscalationDecision } from '../hq/HqSupportPage';

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
  if (items === null) return <p className="text-xs text-red-600">HQ&apos;s escalation board could not be read, so this licence&apos;s requests are unknown — not none.</p>;
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

export default function LicenceRequestsPanel({ licence, onOpenTerm, onGrantAdmin }) {
  const [read, setRead] = useState(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [noticeDays, setNoticeDays] = useState(null);
  const [openUid, setOpenUid] = useState(null);
  const load = useCallback(() => {
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
