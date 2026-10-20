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
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api, licenceTermsApi } from '../../lib/api';
import { reportError } from '../../lib/log';
import {
  LICENCE_PANEL_KINDS, licenceRequests, nonRenewalCheck, requestSummary, termAsItStands, termTarget,
} from '../../lib/escalationKinds';
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

/** Every open request of the panel's kinds on HQ's board, one read per kind; null when the board cannot be read. */
export async function loadOpenRequests() {
  const lists = await Promise.all(LICENCE_PANEL_KINDS.map((kind) => api.escalations({ status: 'open', kind })));
  if (lists.some((l) => l?.available === false)) return null;
  return lists.flatMap((l) => l?.items || []);
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

/** The panel, given the requests already read. Separate from the loader so a test can draw it. */
export function RequestsPanelView({ items, licence, noticeDays, openUid, onToggle, onRecorded, onReload, onOpenTerm, onGrantAdmin }) {
  if (items === undefined) return <p className="text-xs text-gray-500">Loading…</p>;
  if (items === null) return <p className="text-xs text-red-600">HQ&apos;s escalation board could not be read, so this licence&apos;s requests are unknown — not none.</p>;
  if (!items.length) return <p className="text-xs text-gray-500">No open requests from this licence&apos;s Administrator.</p>;
  return (
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
  );
}

export default function LicenceRequestsPanel({ licence, branchCode = null, onOpenTerm, onGrantAdmin }) {
  const [items, setItems] = useState(undefined);
  const [noticeDays, setNoticeDays] = useState(null);
  const [openUid, setOpenUid] = useState(null);
  const load = useCallback(() => {
    loadOpenRequests()
      .then((all) => setItems(all === null ? null : licenceRequests(all, licence.uid, branchCode)))
      .catch((e) => { reportError('licence_requests_load_failed', e); setItems(null); });
    // The notice period a non-renewal is checked against; unread, it is "not recorded".
    licenceTermsApi.get(licence.uid)
      .then((r) => setNoticeDays(r?.terms?.non_renewal_notice_days ?? null))
      .catch(() => setNoticeDays(null));
  }, [licence.uid, branchCode]);
  useEffect(load, [load]);

  return (
    <aside className="rounded-lg border border-gray-200 p-3 dark:border-gray-800" data-testid="licence-requests-panel">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Requests from the Administrator{Array.isArray(items) ? ` · Open ${items.length}` : ''}
      </h3>
      <RequestsPanelView
        items={items} licence={licence} noticeDays={noticeDays} openUid={openUid}
        onToggle={(uid) => setOpenUid((u) => (u === uid ? null : uid))}
        onRecorded={() => { setOpenUid(null); load(); }}
        onReload={load}
        onOpenTerm={onOpenTerm}
        onGrantAdmin={onGrantAdmin}
      />
    </aside>
  );
}
