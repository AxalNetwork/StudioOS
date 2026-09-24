import React, { useCallback, useEffect, useState } from 'react';
import { Users, ShieldCheck, Search, Loader2, AlertTriangle, LogOut } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, Unrecorded, Unreadable } from '../../ui';
import { daysTo, rungRank } from '../../lib/notices';
import { useViewAsBranch } from '../../contexts/ViewAsBranchContext';

/**
 * HQ · Team — the first screen whose SUBJECT is the administrators (H9, D138).
 *
 * WHAT IT IS FOR. Until this shipped, supervising an admin meant opening one
 * licence at a time — /admin/licences → a licence → Administrators → Notices —
 * so "who is frozen right now" could not be asked, only assembled. Every power
 * the question implies already existed (D134 opens an account, D135 freezes it,
 * D136 works the notice, D137 pushes the decision to a branch); what was
 * missing was somewhere to see them all standing next to each other.
 *
 * THE GROUPS ARE H9'S OWN MODEL, and its copy states why: "There is no global
 * accounts table. HQ asks each branch over its private link and groups what
 * comes back … and when one branch does not answer, its group says so instead
 * of showing zero." So the HQ-held group is complete and always present, and
 * the search box is what HQ ASKS THE BRANCHES. With no branch provisioned there
 * is one group, every administrator is HQ-held, and that is a fact about where
 * the row lives rather than a placeholder.
 *
 * THE FILTER NARROWS A COMPLETE LIST, WHICH IS THE WHOLE POINT. The roster
 * comes from a query with a predicate and no LIMIT, so narrowing it in the
 * browser hides nothing. `SuperAdminHolders` used to filter a PAGE — the newest
 * hundred accounts — to `role === 'admin'`, and admins are among the oldest
 * accounts, so it silently dropped them. Filtering a complete list narrows it;
 * filtering a page hides rows.
 *
 * MOVE IS DRAWN ONLY WHERE BOTH ENDS EXIST. H9's "Move to another branch"
 * calls `POST /api/admin/branches/:code/accounts/:userId/move`, which needs a
 * source branch code and a different destination branch code, each a live
 * binding, plus TOTP and a recent step-up. The control sits on a branch search
 * hit, and only when another branch code is in the fan-out. HQ-held rows have
 * no source branch, so they carry no Move button — a control that can only
 * refuse is the lie D134 named. With no branch provisioned there is one group
 * and no Move anywhere, which the footnote states.
 */

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

/**
 * H9 — move is real only when two branch codes exist. HQ-held rows have no
 * source branch, so the control is on a branch hit, never on the HQ table.
 * The route needs TOTP and a recent step-up; a refusal is shown, not swallowed.
 */
function MoveHit({ hit, from, destinations, onMoved }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(destinations[0] || '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  if (done) {
    return (
      <li className="py-1.5 text-[12px] text-axal-muted">
        {hit.name || hit.email} closed on {from}
        {done.invited?.ok ? ` and invited on ${to}.` : `. The invitation did not land — retry from the destination, do not move again.`}
      </li>
    );
  }
  return (
    <li className="py-1.5 text-[12px]">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-axal-ink dark:text-white">{hit.name || hit.email}</span>
        <span className="flex shrink-0 items-center gap-2 text-[11.5px] text-axal-faint">
          <span>{hit.role} · {Number(hit.is_active) === 1 ? 'active' : 'deactivated'}</span>
          {destinations.length > 0 && Number(hit.is_active) === 1 && (
            <button type="button" className="font-bold text-axal-violet dark:text-violet-300" onClick={() => setOpen((v) => !v)}>
              Move
            </button>
          )}
        </span>
      </div>
      {open && (
        <form
          className="mt-2 grid gap-2 rounded-lg border border-axal-hairline bg-axal-ground p-2"
          data-testid="hq-team-move"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr('');
            setBusy(true);
            try {
              const res = await api.hqMoveAccount(from, hit.id, { destination_code: to, reason });
              setDone(res);
              onMoved?.();
            } catch (ex) {
              reportError('hq-team-move', ex);
              setErr(ex?.message || 'The move was refused.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="text-[11px] text-axal-muted">
            Destination
            <select className="mt-1 block w-full rounded-md border border-axal-hairline bg-white px-2 py-1 text-[12px] dark:bg-gray-900" value={to} onChange={(e) => setTo(e.target.value)}>
              {destinations.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-axal-muted">
            Reason (at least 10 characters). This changes which subsidiary earns revenue share.
            <textarea className="mt-1 block w-full rounded-md border border-axal-hairline bg-white px-2 py-1 text-[12px] dark:bg-gray-900" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {err && <p className="text-[11.5px] text-rose-700 dark:text-rose-300">{err}</p>}
          <button type="submit" disabled={busy || reason.trim().length < 10} className="justify-self-start rounded-md bg-axal-violet px-3 py-1 text-[11.5px] font-bold text-white disabled:opacity-50">
            {busy ? 'Moving…' : `Move to ${to || '…'}`}
          </button>
        </form>
      )}
    </li>
  );
}

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

/**
 * D165 — the per-account revoke, on the reason + acknowledge shape
 * `SecurityPage.jsx`'s bulk force-reauth already uses. Two things about WHERE it
 * is drawn are load-bearing rather than incidental:
 *
 * ONLY ON THE HQ-HELD GROUP, and that is structural rather than a condition.
 * `AdminRow` is rendered only when there is no view-as overlay, and a branch's
 * hits render as a plain list, not as rows of this table. That matters because
 * the route behind this button writes HQ's `users` table: a branch admin's
 * account lives in the BRANCH's database, so a Sign-out control on a branch hit
 * could only ever refuse — the `still_an_admin` mistake D134 named. It is absent
 * there rather than disabled, which is also what the overlay's own copy promises.
 *
 * ONE FORM, NOT ONE PER ROW. The reason and the acknowledgement belong to the act,
 * not to the table, so the selected row expands and everything else stays a
 * button. A form per row would mean fifty reason fields, forty-nine of them
 * holding nothing.
 */
function RevokeForm({ row, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const who = row.name || row.email;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.hqForceReauthUser(row.user_id, reason.trim());
      onDone(res);
    } catch (err) {
      reportError('hq-team:revoke', err);
      const msg = String(err?.message || err || 'Request failed');
      // The same translation the bulk control makes: a bare "TOTP required" is
      // the server's word for a session minted the wrong way, and it reads as a
      // fault rather than as the one thing the operator has to do about it.
      setError(msg === 'TOTP required'
        ? 'This needs a session signed in with your authenticator app. Sign out and back in with a code, then try again.'
        : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2 py-2" data-testid="hq-team-revoke-form">
      <label className="block text-[11px] font-semibold text-axal-muted">
        Reason · required, stored with the action
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={`e.g. ${who} reported a lost laptop`}
          className="mt-1 w-full max-w-xl rounded-md border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] font-normal text-axal-ink dark:bg-gray-900"
        />
      </label>
      <label className="flex items-start gap-2 text-[11.5px] text-axal-muted">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
        <span>
          I understand this signs {who} out of every session on every device. It does not deactivate
          the account, change their role, or touch anyone else.
        </span>
      </label>
      {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !ack || reason.trim().length < 8}
          className="inline-flex items-center gap-1.5 rounded-md border-[1.5px] border-red-700 bg-white px-3 py-1.5 text-[12px] font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/30"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <AlertTriangle size={13} />} Sign {who} out
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1.5 text-[12px] font-semibold text-axal-muted hover:text-axal-ink dark:hover:text-gray-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
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
          <RevokeForm row={row} onDone={onDone} onCancel={onCancel} />
        </td>
      </tr>
    )}
    </>
  );
}

export default function HqTeamTable({ reloadKey = 0 }) {
  const [data, setData] = useState(undefined); // undefined = loading, null = unreadable
  const [error, setError] = useState(null);
  const [typed, setTyped] = useState('');
  // D165 — ONE row's form is open at a time, and what came back per row is kept
  // so the cell can report the act rather than silently returning to a button.
  // Neither is persisted: a revoke is an act, not a preference, and a stale
  // "Signed out" chip surviving a reload would be a claim about a session state
  // this page never re-read.
  const [revokeFor, setRevokeFor] = useState(null);
  const [revoked, setRevoked] = useState({});
  const [asked, setAsked] = useState('');
  // D153 / H12 frame 2 — the same scope the shell bar names. Under it the
  // route reads ONE branch and does not read HQ's roster at all, so the
  // HQ-held half below is absent rather than filtered away: a narrowed HQ
  // table is exactly what H12 says the overlay is not.
  const { branch: viewAs } = useViewAsBranch();

  // The 250ms / two-character debounce `AdminPage` already uses, for the same
  // reason: each keystroke would otherwise ask every branch over its own link.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = typed.trim();
      setAsked(next.length >= 2 ? next : '');
    }, 250);
    return () => clearTimeout(t);
  }, [typed]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.hqAdmins(asked, viewAs || undefined);
      setData(res && typeof res === 'object' ? res : null);
    } catch (e) {
      reportError('HqTeamTable:load', e);
      setData(null);
      setError(String(e?.message || e || 'Request failed'));
    }
  }, [asked, viewAs]);

  useEffect(() => { load(); }, [load, reloadKey]);

  if (data === undefined) {
    return (
      <Card className="p-5" data-testid="hq-team">
        <p className="text-[12px] text-axal-faint"><Loader2 size={13} className="inline animate-spin" /> Loading the team…</p>
      </Card>
    );
  }

  if (data === null) {
    return (
      <Card className="p-5" data-testid="hq-team">
        <Unreadable
          what="The administrator roster"
          claim={`This is not a claim that there are none — it is a read that failed. ${error || ''}`.trim()}
          onRetry={load}
        />
      </Card>
    );
  }

  const ladderReadable = data.ladder_readable !== false;
  const licencesReadable = data.licences_available !== false;
  const needle = typed.trim().toLowerCase();
  const rows = (Array.isArray(data.items) ? data.items : [])
    .filter((row) => !needle
      || String(row.name || '').toLowerCase().includes(needle)
      || String(row.email || '').toLowerCase().includes(needle))
    // Worst first, then by name — the ordering `lib/notices.js` holds once for
    // this screen and the licence detail's notice list both.
    .sort((a, b) => rungRank(a.rung) - rungRank(b.rung)
      || String(a.name || a.email).localeCompare(String(b.name || b.email)));

  const branches = Array.isArray(data.branches) ? data.branches : [];

  return (
    <Card className="p-5" data-testid="hq-team">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <Users size={13} /> Team
          </div>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            Every administrator, the licence each holds, and where each stands on the compliance
            ladder. Grouped by branch: there is no global accounts table, so HQ holds its own and
            asks each branch over its private link.
          </p>
        </div>
        <label className="flex items-center gap-1.5 rounded-md border border-axal-hairline px-2 py-1.5">
          <Search size={13} className="text-axal-faint" />
          <input
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Filter admins · ask branches"
            aria-label="Filter administrators and search branches"
            data-testid="hq-team-search"
            className="w-56 bg-transparent text-[12.5px] text-axal-ink outline-none"
          />
        </label>
      </div>

      {viewAs && (
        <p className="mt-3 text-[12px] leading-relaxed text-axal-muted" data-testid="hq-team-scoped-note">
          Reading {viewAs} alone. HQ&rsquo;s own administrator roster is not narrowed here — it is not
          read: this is one branch&rsquo;s answer to one question, not an HQ table with a filter over it.
          Nothing here can be acted on, which is why no move, reassign or suspend control is drawn —
          an action that cannot run from this view is not drawn in it.
        </p>
      )}

      {!ladderReadable && !viewAs && (
        <p className="mt-3" data-testid="hq-team-ladder-unreadable">
          <Unreadable what="The compliance ladder" claim={data.ladder_reason || 'No rung is shown for any administrator.'} onRetry={load} />
        </p>
      )}

      {!viewAs && (
      <div className="mt-4 flex items-baseline gap-2" data-testid="hq-team-group-hq">
        <span className="text-[11px] font-extrabold uppercase tracking-[.08em] text-axal-ink">Axal VC HQ</span>
        <span className="text-[11.5px] text-axal-faint">
          HQ-held · {data.total} {Number(data.total) === 1 ? 'administrator' : 'administrators'}
          {typeof data.active === 'number' ? `, ${data.active} active` : ''}
          {needle ? ` · showing ${rows.length}` : ''}
        </span>
      </div>
      )}

      {viewAs ? null : rows.length === 0 ? (
        <p className="mt-2 text-[12px] text-axal-faint">
          {needle
            ? 'No administrator here matches that.'
            : 'No account on this database holds the admin role.'}
        </p>
      ) : (
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
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {branches.map((b) => (
        <div key={b.code} className="mt-4 border-t border-axal-hairline pt-3" data-testid="hq-team-group-branch">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-[.08em] text-axal-ink">{b.code}</span>
            <span className="text-[11.5px] text-axal-faint">
              {b.status === 'ok' && `${(b.data?.results || []).length} matched${b.data?.truncated ? ' (more exist)' : ''}${b.as_of ? ` · as of ${String(b.as_of).slice(0, 19).replace('T', ' ')}` : ''}`}
              {b.status === 'not_deployed' && 'Not deployed'}
              {b.status === 'unreadable' && 'Could not be read'}
            </span>
          </div>
          {b.status === 'unreadable' && (
            <Unreadable what={`Branch ${b.code}`} claim={b.reason || 'It did not answer, which is not the same as it being down.'} onRetry={load} />
          )}
          {b.status === 'not_deployed' && (
            <p className="mt-1 text-[12px] text-axal-faint">{b.reason}</p>
          )}
          {b.status === 'ok' && !data.searched && (
            <p className="mt-1 text-[12px] text-axal-faint">
              Type at least two characters to ask this branch. Its accounts live on its own
              database, so HQ cannot list them from here.
            </p>
          )}
          {b.status === 'ok' && data.searched && (b.data?.results || []).length === 0 && (
            <p className="mt-1 text-[12px] text-axal-faint">Nothing on this branch matched.</p>
          )}
          {b.status === 'ok' && (b.data?.results || []).length > 0 && (
            <ul className="mt-1 divide-y divide-axal-hairline">
              {(b.data.results || []).map((hit) => (
                <MoveHit
                  key={hit.id}
                  hit={hit}
                  from={b.code}
                  destinations={branches.map((x) => x.code).filter((code) => code && code !== b.code)}
                  onMoved={load}
                />
              ))}
            </ul>
          )}
        </div>
      ))}

      <p className="mt-4 text-[11px] leading-relaxed text-axal-faint">
        {viewAs && (
          <>
            {/* The column H9 draws that has no source, stated rather than
                drawn empty: trust is HQ's own service over HQ's own accounts
                and is not computed per branch, so a branch hit carries no
                trust field to put in one. D129's precedent on S2 governs the
                other one — a hit carries `role`, not a licence type, so the
                heading beside it says Role. */}
            A branch hit carries a role and an active state; it carries no trust score, because trust
            is computed over HQ&rsquo;s own accounts and is not a per-branch figure.
            {' '}
          </>
        )}
        {branches.length === 0
          ? 'No branch is provisioned, so every account on the platform is HQ-held and this is the whole team.'
          : `Of ${data.branches_coverage?.total ?? branches.length} branches, ${data.branches_coverage?.answered ?? 0} answered.`}
        {' '}
        Moving an account between branches closes it where it lives and re-invites it where it is
        going — records stay put. Move appears on a branch hit only when another branch code exists.
        It needs a step-up and TOTP; a refusal names the reason. HQ-held rows have no source branch,
        so they are not movable from this table.
      </p>
    </Card>
  );
}
