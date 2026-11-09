/**
 * D5044 (#5044) — HQ Team's HQ-held administrator roster: the table, its rows, and Sign out.
 *
 * THE FILTER NARROWS A COMPLETE LIST, WHICH IS THE WHOLE POINT. The roster comes from a query with
 * a predicate and no LIMIT (`GET /api/admin/hq/admins`, read once by `useHqTeamRoster`), so
 * `rosterRows` narrows it in the browser and hides nothing. Rows sort worst first, then by name,
 * through the shared ordering in `lib/notices.js`. The compliance chip is drawn only when the
 * ladder was read; an unreadable ladder is never every administrator being clear.
 *
 * The table holds which row's Sign out form is open (one at a time) and what each confirmed
 * sign-out answered, so the cell reports the act rather than silently returning to a button.
 * Neither is persisted: a revoke is an act, not a preference.
 */
import React, { useState } from 'react';
import { ShieldCheck, LogOut } from 'lucide-react';
import { Unrecorded } from '../../../ui';
import { daysTo, rungRank } from '../../../lib/notices';
import SignOutAccountAction from './SignOutAccountAction';

const RUNG = {
  frozen: {
    label: 'Frozen',
    tone: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900',
  },
  awaiting_review: {
    label: 'Answered — HQ to review',
    tone: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  },
  notified: {
    label: 'Under notice',
    tone: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900',
  },
  clear: {
    label: 'Clear',
    tone: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  },
};

const LICENCE_TONE = {
  active: 'text-green-700 dark:text-green-400',
  suspended: 'text-rose-700 dark:text-rose-400',
  terminated: 'text-gray-500 dark:text-gray-400',
};


function Chip({ children, tone }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone || RUNG.clear.tone}`}>
      {children}
    </span>
  );
}

/**
 * "frozen 6 days" / "answer due in 3 days" / "3 days overdue".
 *
 * `daysTo` is the shared normaliser (`lib/notices.js`): `admin_notices` stamps
 * are SQL `YYYY-MM-DD HH:MM:SS`, which V8 parses as the READER'S LOCAL time and
 * other engines reject, so a raw `new Date()` here would be wrong by the
 * reader's UTC offset or blank.
 */
function rungDetail(row) {
  if (row.rung === 'frozen' && row.froze_at) {
    const d = daysTo(row.froze_at);
    return d === null ? null : `frozen ${Math.abs(d)} ${Math.abs(d) === 1 ? 'day' : 'days'}`;
  }
  if (row.rung === 'notified' && row.respond_by) {
    const d = daysTo(row.respond_by);
    if (d === null) return null;
    if (d < 0) return `${Math.abs(d)} ${Math.abs(d) === 1 ? 'day' : 'days'} overdue`;
    return `answer due in ${d} ${d === 1 ? 'day' : 'days'}`;
  }
  return null;
}


function AdminRow({ row, ladderReadable, licencesReadable, open, onOpen, onCancel, onDone, done }) {
  const rung = RUNG[row.rung] || RUNG.clear;
  const detail = rungDetail(row);
  return (
    <>
    <tr className="border-t border-axal-hairline align-top" data-testid="hq-team-row">
      <td className="py-2 pr-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-axal-ink">{row.name || row.email}</span>
          {/* U11 — `axal-oxblood` is NOT a declared token, and Tailwind v4 emits
              nothing for one it does not know, without warning. HQ's accent is
              written as the arbitrary value its sibling pages use (`HqHomePage`,
              `SecurityPage`), which is the spelling that actually paints. */}
          {Number(row.super_admin) === 1 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[.06em] text-[#881337] dark:bg-rose-950/40 dark:text-rose-200"
              data-testid="hq-team-super-admin"
              title="Holds the Super Admin elevation"
            >
              <ShieldCheck size={10} /> Super admin
            </span>
          )}
        </div>
        <div className="truncate text-[11.5px] text-axal-faint">{row.email}</div>
      </td>
      <td className="py-2 pr-3 text-[12px] text-axal-muted" data-testid="hq-team-branch">
        {row.branch || 'HQ-held'}
      </td>
      <td className="py-2 pr-3 text-[12px]">
        {!licencesReadable ? (
          <Unrecorded reason="The licence ledger could not be read, so which licence this administrator holds is unknown rather than none.">
            Unknown
          </Unrecorded>
        ) : row.licence ? (
          <>
            <div className={LICENCE_TONE[row.licence.status] || 'text-axal-ink'}>
              {row.licence.licence_ref || row.licence.uid}
              {row.licence.status ? ` · ${row.licence.status}` : ''}
            </div>
            <div className="text-[11.5px] text-axal-faint">
              {row.licence.brand_name || '—'} · {row.licence.admin_role}
            </div>
          </>
        ) : (
          <Unrecorded reason="This account holds no licence binding. Every admin minted through POST /api/admin/licences/:uid/admins is licence-bound; one without a binding predates that door.">
            No licence
          </Unrecorded>
        )}
      </td>
      <td className="py-2 pr-3 text-[12px]" data-testid="hq-team-rung">
        {ladderReadable ? (
          <>
            <Chip tone={rung.tone}>{rung.label}</Chip>
            {detail && <div className="mt-0.5 text-[11.5px] text-axal-faint">{detail}</div>}
            {Number(row.open_notices) > 0 && (
              <div className="text-[11.5px] text-axal-faint">
                {row.open_notices} open {Number(row.open_notices) === 1 ? 'notice' : 'notices'}
              </div>
            )}
          </>
        ) : (
          <Unrecorded>—</Unrecorded>
        )}
      </td>
      <td className="py-2 pr-3 text-[12px] text-axal-muted">
        {Number(row.is_active) === 1 ? 'Active' : 'Deactivated'}
      </td>
      <td className="py-2 pr-3 text-[12px] text-axal-muted" data-testid="hq-team-last-active">
        {row.last_active_at ? String(row.last_active_at).slice(0, 10) : (
          <Unrecorded reason="This account has not made an authenticated request since the last-active stamp was added.">
            Never
          </Unrecorded>
        )}
      </td>
      <td className="py-2 text-[12px]" data-testid="hq-team-sessions">
        {done ? (
          // NO CLOCK HERE, and the guard that caught the first draft was right for
          // a reason it does not actually name. `hq_team_h9`'s ban on `new Date(`
          // is written for SQL-format stamps, which V8 reads as the reader's LOCAL
          // time; `revoked_at` is epoch SECONDS, which is unambiguous, so this was
          // not that defect. It was still the wrong thing to draw: the operator
          // just pressed the button, so the second adds nothing, and a clock
          // rendered client-side beside an act whose authoritative stamp is the
          // audit row invites being read AS that stamp. The fact is the whole
          // message.
          <span role="status" className="text-[11.5px] text-amber-800 dark:text-amber-300">
            Signed out
          </span>
        ) : open ? (
          <span className="text-[11.5px] text-axal-faint">Below &darr;</span>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            data-testid="hq-team-revoke"
            className="inline-flex items-center gap-1 rounded-md border border-axal-hairline px-2 py-1 text-[11.5px] font-semibold text-axal-muted hover:border-red-700 hover:text-red-700 dark:hover:border-red-500 dark:hover:text-red-300"
          >
            <LogOut size={11} /> Sign out
          </button>
        )}
      </td>
    </tr>
    {open && (
      <tr className="bg-axal-hairline/20" data-testid="hq-team-revoke-row">
        <td colSpan={7} className="px-1">
          <SignOutAccountAction row={row} onDone={onDone} onCancel={onCancel} />
        </td>
      </tr>
    )}
    </>
  );
}


/** The rows the HQ-held table shows: the complete roster, narrowed by `needle`, worst first. */
export function rosterRows(items, needle) {
  return (Array.isArray(items) ? items : [])
    .filter((row) => !needle
      || String(row.name || '').toLowerCase().includes(needle)
      || String(row.email || '').toLowerCase().includes(needle))
    // Worst first, then by name — the ordering `lib/notices.js` holds once for
    // this screen and the licence detail's notice list both.
    .sort((a, b) => rungRank(a.rung) - rungRank(b.rung)
      || String(a.name || a.email).localeCompare(String(b.name || b.email)));
}

export default function HqAdminRoster({ rows, ladderReadable, licencesReadable, onSignedOut }) {
  // D165 — ONE row's form is open at a time, and what came back per row is kept
  // so the cell can report the act rather than silently returning to a button.
  const [revokeFor, setRevokeFor] = useState(null);
  const [revoked, setRevoked] = useState({});
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
            <th className="pb-1 pr-3">Name</th>
            <th className="pb-1 pr-3">Branch</th>
            <th className="pb-1 pr-3">Licence</th>
            <th className="pb-1 pr-3">Compliance</th>
            <th className="pb-1 pr-3">State</th>
            <th className="pb-1 pr-3">Last active</th>
            <th className="pb-1">Sessions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <AdminRow
              key={row.user_id}
              row={row}
              ladderReadable={ladderReadable}
              licencesReadable={licencesReadable}
              open={revokeFor === row.user_id}
              done={revoked[row.user_id]}
              onOpen={() => setRevokeFor(row.user_id)}
              onCancel={() => setRevokeFor(null)}
              onDone={(res) => {
                setRevoked((prev) => ({ ...prev, [row.user_id]: res }));
                setRevokeFor(null);
                onSignedOut?.(row, res);
              }}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
