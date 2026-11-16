/**
 * D4708 part 3 (#4708) — the data-subject-request zone and its parts, moved out of
 * `../SecurityPage.jsx` unchanged. `PrivacyWorkspace.jsx` keeps this zone behind
 * "How this is measured"; the one write (Record outcome) stays there.
 */
import React from 'react';
import { Unrecorded, Unreadable } from '../../../ui';
import { NotRecordedList, Zone } from './SecurityParts.jsx';
import { num, titleCase, UNAVAILABLE } from './securityShared.js';

/**
 * D481 — one open request's subject line. The kind is the row's own field
 * (`kind`, set by the store that holds the row); the zone used to print the
 * word "erasure" as a literal, true today only because the ledger holds
 * nothing else.
 */
export function DsrSubject({ row }) {
  return (
    <span className="min-w-0 truncate">
      <b>{row.name || row.email}</b>{' '}
      <span className="text-axal-muted">
        · {titleCase(row.role)} · {row.kind || <Unrecorded>kind not recorded</Unrecorded>}
      </span>
    </span>
  );
}

/** D481 — the request kinds the ledger does not hold, each Not recorded with its reason. */
export function DsrKindsNotRecorded({ kinds }) {
  const missing = (kinds || []).filter((k) => !k.recorded).map((k) => ({ what: titleCase(k.kind), reason: k.reason }));
  return <NotRecordedList items={missing} testid="hq-dsr-kinds-not-recorded" />;
}

/**
 * D200 — why the DSR grouping has one group. The count of bound branches is
 * the server's; `null` means the env could not be scanned, which is not "no
 * branch is bound" and so gets a sentence of its own.
 */
export function dsrBranchesSentence(branches) {
  if (branches.bound === 0) return 'No branch is bound; every open request is HQ-held.';
  if (branches.bound === null) return `Whether a branch is bound could not be read. ${branches.reason}`;
  return `${num(branches.bound)} branch${branches.bound === 1 ? ' is' : 'es are'} bound. ${branches.reason}`;
}

/** The open requests by territory, with their clocks, history and the kinds not recorded. */
export function DsrZone({ ready, data, dsr, dsrGroups, dsrReadable, dsrBranches }) {
  return (
    <Zone title="Data subject requests" sub={`${(ready && data.dsr?.clock?.label) || 'Statutory clock from receipt'} · by territory`} tone="border-amber-200 bg-amber-50/30 dark:border-amber-900 dark:bg-amber-950/20">
      {/* D200 — H23 draws the DSR clocks "by territory · runs against the
          holding branch". Every request this database holds is HQ-held
          by construction, so the grouping has one group and the sentence
          below says why there is not a second, from the server. */}
      {ready && dsrGroups.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold text-axal-muted" data-testid="hq-dsr-groups">
          {dsrGroups.map((g) => (
            <span key={g.branch} className="font-mono">{g.branch} · {num(g.open)} open</span>
          ))}
        </div>
      )}
      {ready && !dsrReadable && (
        <div data-testid="hq-dsr-unreadable">
          <Unreadable what="The open deletion requests" claim="This is not a claim that none are open." />
        </div>
      )}
      {ready && dsrReadable && dsr.length === 0 && <p className="text-[12px] text-axal-muted">No deletion request is open.</p>}
      {ready && dsr.length > 0 && (
        <ul className="space-y-1.5" data-testid="hq-dsr">
          {dsr.map((d) => (
            <li key={d.id} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-[12px] dark:border-amber-900 dark:bg-gray-900">
              <div className="flex items-center justify-between gap-3">
                <DsrSubject row={d} />
                <span title={d.deadline_at ? `Due by the end of ${String(d.deadline_at).slice(0, 10)} UTC: ${(data.dsr?.clock?.label || 'the statutory clock').toLowerCase()}.` : undefined} className={`shrink-0 font-bold tabular-nums ${d.days_left === null ? 'text-axal-muted' : d.days_left < 0 ? 'text-red-700 dark:text-red-300' : d.days_left <= 14 ? 'text-amber-800 dark:text-amber-300' : 'text-axal-ink dark:text-white'}`}>
                  {d.days_left === null ? <Unrecorded>clock unknown</Unrecorded> : d.days_left < 0 ? `${num(-d.days_left)}d overdue` : d.days_left === 0 ? 'due today' : `${num(d.days_left)}d left`}
                </span>
              </div>
              {/* D168 — HAS THIS SUBJECT ASKED BEFORE? `prior_requests` is
                  null, never 0, when the ledger could not be read: "never
                  asked before" is a claim, and an unreadable store has not
                  made it. A third ask read as a first is the thing this
                  line exists to prevent. */}
              {d.prior_requests === null ? (
                <p className="mt-0.5 text-[11px] text-axal-muted" data-testid="hq-dsr-history-unreadable">
                  <Unrecorded>earlier requests unknown</Unrecorded>
                </p>
              ) : d.prior_requests > 0 ? (
                <p className="mt-0.5 text-[11px] text-axal-muted" data-testid="hq-dsr-history">
                  {num(d.prior_requests)} earlier request{d.prior_requests === 1 ? '' : 's'}
                  {d.last_outcome ? ` · last ${d.last_outcome}` : ''}
                  {d.last_outcome_at ? ` on ${String(d.last_outcome_at).slice(0, 10)}` : ''}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!ready && data !== UNAVAILABLE && <p className="text-[12px] text-axal-muted">Loading…</p>}
      {/* D481 — the zone printed "erasure" as a literal on every row.
          The kinds the ledger does NOT hold are named here, from the
          payload, each Not recorded with its reason. */}
      {ready && <DsrKindsNotRecorded kinds={data.dsr?.kinds} />}
      {ready && dsrBranches && (
        <p className="mt-2 text-[11px] leading-relaxed text-axal-muted" data-testid="hq-dsr-branches">
          {dsrBranchesSentence(dsrBranches)}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-axal-muted">
        The clock is statutory — one month from receipt, not from triage. Requests come from each account&apos;s own
        Settings; <b>erasure itself is still a manual act</b>, and closing a request here records that act rather
        than performing one. A withdrawal is the subject&apos;s own and is recorded when they cancel.
      </p>
    </Zone>
  );
}
