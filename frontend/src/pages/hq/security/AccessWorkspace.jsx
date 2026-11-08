import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Unreadable } from '../../../ui';
import StatusBadge, { ReadValue } from './StatusBadge.jsx';
import AccessActionDialog from './AccessActions.jsx';
import { BTN_DANGER, NotInstrumented as NI } from './ActionDialog.jsx';
import {
  MIN_REASON, SESSION_BULK_LIMIT, SESSION_STATUS, accountName, describeSession, formatInZone, formatUtc, isoOf,
  isWriteBarRefusal, relativeTo, viewerZone, writeAccess,
} from './accessModel.js';

/**
 * D4801 (#4801, canvas SE04a, SE04b and SE11c; D4803) — the Access
 * workspace: the active sessions, the live support sessions, what each act
 * reaches, and emergency re-authentication. Each act opens its own Scope →
 * Review → Result dialog (`AccessActions.jsx`); there is no page-level reason
 * field any more, because a reason typed above four buttons belonged to none
 * of them.
 *
 * FOUR STATES BEFORE A ROW IS DRAWN:
 *   - loading (`list` null): nothing is claimed;
 *   - unreadable (`list` is the page's UNAVAILABLE): no table, no count, no
 *     session act, and Retry — "nobody is signed in" is the one answer a
 *     security desk must never give by accident, so it is never a 0;
 *   - read with no row, or only your own: said as what was read;
 *   - read-only until step-up: your own session was not minted with the
 *     authenticator, so every act would be refused (`writeAccess`).
 *
 * WHAT CHANGED SINCE THE READ. The list is re-read only when the operator
 * asks (Re-read), so a row this page revoked stays on screen as Revoked —
 * the same word the dialog used — instead of vanishing. A new read clears it.
 *
 * TIMES are UTC to the second ("Sat 7 Nov 2026, 09:47:12 UTC"), with the
 * viewer's own zone under View details. Expires is derived (created +
 * `token_hours`); nothing stores it.
 */

const SMALL = 'inline-flex min-h-[44px] items-center justify-center rounded-md border px-2.5 text-[12px] font-bold md:min-h-[30px] disabled:cursor-not-allowed disabled:opacity-50';
const SMALL_PLAIN = `${SMALL} border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const SMALL_DANGER = `${SMALL} border-red-200 bg-white text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/30`;
const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const CELL = 'block py-0.5 md:table-cell md:px-3 md:py-2 md:align-top';

function Time({ value, empty = 'Not stamped' }) {
  const text = formatUtc(value);
  if (!text) return <span className="text-axal-faint dark:text-gray-400">{empty}</span>;
  return <time dateTime={isoOf(value)} className="font-mono text-[11.5px]">{text}</time>;
}

function SessionDetails({ row, s, tokenHours, zone }) {
  const local = (v) => (zone && zone !== 'UTC' ? formatInZone(v, zone) : null);
  const items = [
    ['Session ID', <span key="i" className="font-mono">{row.id}</span>],
    ['IP address', row.ip ? <span key="ip" className="font-mono">{row.ip}</span> : 'None stored on this session'],
    ['Started', <span key="st"><Time value={row.created_at} />{local(row.created_at) && <small className="block text-axal-faint dark:text-gray-400">Your time: {local(row.created_at)}</small>}</span>],
    ['Last active', <span key="la"><Time value={row.last_seen_at} />{local(row.last_seen_at) && <small className="block text-axal-faint dark:text-gray-400">Your time: {local(row.last_seen_at)}</small>}</span>],
    ['Expires', s.expires
      ? <span key="ex"><Time value={s.expires} /><small className="block text-axal-faint dark:text-gray-400">Started + {tokenHours} h, the token&apos;s lifetime. Derived; nothing stores it.</small></span>
      : 'Unknown — no start time is stamped'],
    ['Sign-in factor', row.factor || 'Not stamped'],
    ['User agent', row.user_agent ? <span key="ua" className="break-all font-mono text-[11px]">{row.user_agent}</span> : 'None stored on this session'],
    ['Location', <NI key="l">only the IP address is stored.</NI>],
    ['Device name', <NI key="d">only the raw user agent is stored.</NI>],
    ['Revoked by', <NI key="r">a session does not record who revoked it; the admin audit log does, in Events.</NI>],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-[130px_minmax(0,1fr)]" data-testid={`hq-session-details-${row.id}`}>
      {items.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="font-semibold text-axal-muted dark:text-gray-400">{k}</dt>
          <dd className="min-w-0 text-axal-ink dark:text-gray-100">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function ReachCard({ expiryMinutes }) {
  const rows = [
    ['Revoke this session', 'One session row. Its token is refused from its next request; the account\'s other sessions stay signed in. Your own current session is not revoked from here: use Sign out account.'],
    ['Sign out account', 'Every session that account holds, on every device: its sign-in floor is raised. Which devices that reached is not listed.'],
    ['End support session', `Closes the support-session record so it can't be extended. Its token carries no session id and stays valid until it expires, at most ${expiryMinutes} minutes after it was minted. To cut it now, sign that account out.`],
    ['Emergency re-authentication', 'Every HQ-held account; branch databases are not touched; you will be signed out too.'],
  ];
  return (
    <section aria-labelledby="access-reach-h" className={`${CARD} p-4`} data-testid="access-reach">
      <h2 id="access-reach-h" className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-white">What each action reaches</h2>
      <dl className="mt-2 grid gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-[190px_minmax(0,1fr)]">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="font-bold text-axal-ink dark:text-white">{k}</dt>
            <dd className="text-axal-muted dark:text-gray-300">{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      <p className="mt-3 text-[11.5px] text-axal-faint dark:text-gray-400">
        Every act needs a session signed in with your authenticator (TOTP) and a recent step-up, takes its own reason of
        at least {MIN_REASON} characters, and is recorded in the admin audit log.
      </p>
    </section>
  );
}

export default function AccessWorkspace({ list, unavailable, onAct, onRetry, onRefresh, now: nowProp }) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (nowProp !== undefined) return undefined;
    const t = setInterval(() => setTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, [nowProp]);
  const now = nowProp ?? tick;

  const [changed, setChanged] = useState({ sessions: {}, accounts: {}, ended: {}, all: false, count: 0 });
  const [blocked, setBlocked] = useState(false);
  const [selected, setSelected] = useState([]);
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState(null);
  const caption = useRef(null);
  const zone = useMemo(() => viewerZone(), []);

  // A new read is the new truth: what this page changed is in it now.
  useEffect(() => {
    setChanged({ sessions: {}, accounts: {}, ended: {}, all: false, count: 0 });
    setSelected([]);
  }, [list]);

  const loaded = list && list !== unavailable;
  const tokenHours = loaded ? list.token_hours : null;
  const expiryMinutes = loaded && Number.isFinite(Number(list.expiry_minutes)) ? Number(list.expiry_minutes) : 30;
  const rows = loaded ? list.rows || [] : [];
  const described = rows.map((r) => ({ row: r, s: describeSession(r, { now, tokenHours, changed }) }));
  const me = rows.find((r) => r.is_current)?.user_id ?? null;
  const access = blocked ? 'needs_totp' : (loaded ? writeAccess(list) : 'unknown');
  const readOnly = access === 'needs_totp';
  const rowsById = new Map(described.map(({ s }) => [s.id, s]));

  const q = filter.trim().toLowerCase();
  const shown = q
    ? described.filter(({ row, s }) => [s.name, row.email, s.role, s.device, row.ip].some((v) => String(v || '').toLowerCase().includes(q)))
    : described;
  const selectable = ({ s }) => s.status === 'active';
  const full = selected.length >= SESSION_BULK_LIMIT;

  const start = (action, e) => setDialog({ action, opener: e?.currentTarget || null, key: `${action.kind}-${Date.now()}` });
  const signOutAction = (userId, name) => ({
    kind: 'sign_out', userId, name, self: me !== null && userId === me, listed: rows.filter((r) => r.user_id === userId).length,
  });

  const onConfirmed = (action, arg, out) => {
    if (isWriteBarRefusal(out)) setBlocked(true);
    const ok = out.result === 'done' || out.result === 'partial' || out.result === 'already_revoked';
    if (!ok) return;
    setChanged((cur) => {
      const next = { ...cur, sessions: { ...cur.sessions }, accounts: { ...cur.accounts }, ended: { ...cur.ended }, count: cur.count + 1 };
      if (action.kind === 'revoke') next.sessions[arg] = true;
      if (action.kind === 'revoke_selected') {
        for (const r of out.rows || []) if (r.outcome === 'revoked' || r.outcome === 'already_revoked') next.sessions[r.id] = true;
      }
      if (action.kind === 'sign_out' && out.result === 'done') next.accounts[arg] = true;
      if (action.kind === 'end') next.ended[arg] = out.result === 'done' ? out.receivedAt + expiryMinutes * 60000 : null;
      if (action.kind === 'emergency' && out.result === 'done') next.all = true;
      return next;
    });
    if (action.kind === 'revoke_selected') setSelected([]);
  };

  const toggle = (id) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : (cur.length >= SESSION_BULK_LIMIT ? cur : [...cur, id])));
  const visibleSelectable = shown.filter(selectable).map(({ s }) => s.id);
  const allOn = visibleSelectable.length > 0 && visibleSelectable.every((id) => selected.includes(id));
  const toggleAll = () => setSelected((cur) => (allOn
    ? cur.filter((id) => !visibleSelectable.includes(id))
    : [...new Set([...cur, ...visibleSelectable])].slice(0, SESSION_BULK_LIMIT)));

  const imp = loaded ? list.impersonations : null;
  const emergencyCard = (
    <section aria-labelledby="access-emergency-h" id="emergency" className={`${CARD} flex flex-col gap-2 p-4`} data-testid="hq-force-reauth">
      <h2 id="access-emergency-h" className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-white">Emergency re-authentication</h2>
      <p className="text-[12.5px] text-axal-ink dark:text-gray-100">
        Signs out every HQ-held account, you included. Branch databases are not touched.
      </p>
      <p className="text-[11.5px] text-axal-faint dark:text-gray-400">
        How many accounts it reaches is known only after it runs: the server counts them as it signs them out.
      </p>
      <button
        type="button"
        disabled={readOnly}
        onClick={(e) => start({ kind: 'emergency' }, e)}
        className={`${BTN_DANGER} self-stretch sm:self-start`}
        data-testid="access-emergency-open"
      >
        Emergency re-authentication…
      </button>
    </section>
  );

  let sessionsBody;
  if (list === unavailable) {
    sessionsBody = (
      <div className="p-4" data-testid="hq-sessions-unreadable">
        <Unreadable what="The session list" claim="This is not a claim that nobody is signed in." onRetry={onRetry} />
      </div>
    );
  } else if (!list) {
    sessionsBody = <p role="status" className="p-4 text-[12.5px] text-axal-faint dark:text-gray-400" data-testid="access-loading">Loading sessions — nothing is claimed yet.</p>;
  } else {
    sessionsBody = (
      <>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 text-[12px] text-axal-muted dark:text-gray-300">
          <span data-testid="hq-sessions-count">
            <ReadValue value={list.total} what="The count" onRetry={onRetry} /> active · token under {list.token_hours}h old, not revoked, account not signed out
            {Number.isFinite(Number(list.total)) && rows.length < list.total ? ` · newest ${rows.length.toLocaleString()} shown` : ''}
          </span>
          {changed.count > 0 && (
            <span className="flex flex-wrap items-center gap-2" role="status" data-testid="access-changed">
              {changed.count} change{changed.count === 1 ? '' : 's'} confirmed since this list was read.
              <button type="button" onClick={onRefresh || onRetry} className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Re-read</button>
            </span>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="px-4 pb-4 text-[12.5px] text-axal-faint dark:text-gray-400" data-testid="hq-sessions-empty">
            No session was seen in this window. The table was read; it held no active row.
          </p>
        ) : (
          <>
            {rows.length === 1 && rows[0].is_current && (
              <p className="px-4 pb-2 text-[12.5px] text-axal-faint dark:text-gray-400" data-testid="hq-sessions-only-you">
                Only your own session is active. The table was read; no other account holds an active session.
              </p>
            )}
            <table className="w-full text-left text-[12.5px]" data-testid="hq-sessions-table">
              <caption ref={caption} tabIndex={-1} className="sr-only">
                Active sessions on HQ-held accounts, newest seen first. Times are UTC.
              </caption>
              <thead className="hidden border-y border-axal-hairline bg-axal-ground text-[11px] uppercase tracking-[.06em] text-axal-faint md:table-header-group dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    <input type="checkbox" aria-label="Select every session shown that can be revoked" checked={allOn} disabled={readOnly || !visibleSelectable.length} onChange={toggleAll} data-testid="hq-sessions-select-all" />
                  </th>
                  <th scope="col" className="px-3 py-2">Account / role</th>
                  <th scope="col" className="px-3 py-2">Browser and OS</th>
                  <th scope="col" className="px-3 py-2">Started</th>
                  <th scope="col" className="px-3 py-2">Last active</th>
                  <th scope="col" className="px-3 py-2">Status</th>
                  <th scope="col" className="px-3 py-2">Expires</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ row, s }) => {
                  const st = SESSION_STATUS[s.status];
                  const isOpen = open === row.id;
                  const canPick = selectable({ s });
                  return (
                    <React.Fragment key={row.id}>
                      <tr className="block border-b border-axal-hairline px-4 py-3 md:table-row md:p-0 dark:border-gray-800" data-testid={`hq-session-${row.id}`} data-status={s.status}>
                        <td className={CELL}>
                          {s.isCurrent ? (
                            <span className="sr-only">Your current session can&apos;t be selected; use Sign out account.</span>
                          ) : (
                            <input
                              type="checkbox"
                              aria-label={`Select ${s.name}'s session on ${s.device}`}
                              checked={selected.includes(row.id)}
                              disabled={readOnly || !canPick || (full && !selected.includes(row.id))}
                              onChange={() => toggle(row.id)}
                              className="h-5 w-5 md:h-auto md:w-auto"
                            />
                          )}
                        </td>
                        <td className={CELL}>
                          <b className="text-axal-ink dark:text-white">{s.name}{s.isCurrent ? ' (you)' : ''}</b>
                          {s.role && <small className="block text-axal-faint dark:text-gray-400">{s.role}</small>}
                        </td>
                        <td className={CELL}>
                          <span className={s.uaMissing || (!s.browser && !s.os) ? 'text-axal-faint dark:text-gray-400' : ''}>{s.device}</span>
                        </td>
                        <td className={CELL}><span className="mr-1 text-axal-faint md:hidden dark:text-gray-400">Started</span><Time value={row.created_at} /></td>
                        <td className={CELL}>
                          <span className="mr-1 text-axal-faint md:hidden dark:text-gray-400">Last active</span>
                          <Time value={row.last_seen_at} />
                          {relativeTo(row.last_seen_at, now) && <small className="block text-axal-faint dark:text-gray-400">{relativeTo(row.last_seen_at, now)}</small>}
                        </td>
                        <td className={CELL}><StatusBadge state={st.state} label={st.word} data-testid={`hq-session-status-${row.id}`} /></td>
                        <td className={CELL}>
                          <span className="mr-1 text-axal-faint md:hidden dark:text-gray-400">Expires</span>
                          {s.expires ? <Time value={s.expires} /> : <span className="text-axal-faint dark:text-gray-400">Unknown</span>}
                        </td>
                        <td className={CELL}>
                          <div className="flex flex-wrap gap-1.5 pt-1 md:justify-end md:pt-0">
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-controls={`hq-session-details-row-${row.id}`}
                              onClick={() => setOpen(isOpen ? null : row.id)}
                              className={SMALL_PLAIN}
                            >
                              View details<span className="sr-only"> for {s.name}&apos;s session</span>
                            </button>
                            {!s.isCurrent && s.status === 'active' && (
                              <button type="button" disabled={readOnly} onClick={(e) => start({ kind: 'revoke', session: s, self: me !== null && s.userId === me }, e)} className={SMALL_DANGER}>
                                Revoke this session…<span className="sr-only"> ({s.name}, {s.device})</span>
                              </button>
                            )}
                            {s.status !== 'revoked' && (
                              <button type="button" disabled={readOnly} onClick={(e) => start(signOutAction(s.userId, s.name), e)} className={SMALL_DANGER}>
                                Sign out account…<span className="sr-only"> ({s.name})</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr id={`hq-session-details-row-${row.id}`} className="block bg-axal-ground px-4 py-3 md:table-row dark:bg-gray-950">
                          <td colSpan={8} className="block md:table-cell md:px-6 md:py-3">
                            <SessionDetails row={row} s={s} tokenHours={tokenHours} zone={zone} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {q && shown.length === 0 && (
              <p className="px-4 py-3 text-[12.5px] text-axal-faint dark:text-gray-400">No session shown matches “{filter}”.</p>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <div className="space-y-4" data-testid="access-workspace">
      <section aria-labelledby="access-sessions-h" className={`${CARD} overflow-hidden`} data-testid="hq-sessions">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h2 id="access-sessions-h" className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-white">Active sessions</h2>
          {loaded && rows.length > 0 && (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <label className="sr-only" htmlFor="access-filter">Filter sessions by account, browser or IP address</label>
              <input
                id="access-filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by account"
                className="min-h-[44px] rounded-md border border-axal-hairline bg-white px-2.5 text-[12.5px] text-axal-ink sm:min-h-[32px] sm:min-w-[220px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
              <button
                type="button"
                disabled={readOnly || selected.length === 0}
                onClick={(e) => start({ kind: 'revoke_selected', sessions: selected.map((id) => ({ ...rowsById.get(id), self: me !== null && rowsById.get(id)?.userId === me })).filter((s) => s.id !== undefined) }, e)}
                className={SMALL_DANGER}
                data-testid="hq-sessions-revoke-selected"
              >
                Revoke selected ({selected.length})…
              </button>
            </div>
          )}
        </div>
        {loaded && readOnly && (
          <p className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" role="status" data-testid="access-read-only">
            <StatusBadge state="action_required" label="Read-only until step-up" />
            Your session was not signed in with your authenticator, so every act here would be refused. Sign out and back in
            with a code; the server then asks for a fresh step-up when you act.
          </p>
        )}
        {loaded && access === 'unknown' && rows.length > 0 && (
          <p className="mx-4 mb-3 text-[11.5px] text-axal-faint dark:text-gray-400" data-testid="access-bar-unknown">
            Your own session is not in the rows read, so this page can&apos;t tell whether it was signed in with your
            authenticator. The server checks when you act.
          </p>
        )}
        {full && (
          <p className="mx-4 mb-3 text-[12px] text-amber-800 dark:text-amber-200" role="status" data-testid="access-limit">
            {SESSION_BULK_LIMIT} selected — the most one request can revoke. Revoke these, then select more.
          </p>
        )}
        {sessionsBody}
      </section>

      <section aria-labelledby="access-support-h" className={`${CARD} overflow-hidden`} data-testid="hq-support-sessions">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h2 id="access-support-h" className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-white">Support sessions</h2>
          {imp?.available && imp.rows.length === 0 && <StatusBadge state="measured_zero" label="0 live" />}
        </div>
        {!loaded ? (
          <p className="px-4 pb-4 text-[12.5px] text-axal-faint dark:text-gray-400">
            {list === unavailable ? 'Not read: the session list could not be read, and support sessions come with it.' : 'Loading — nothing is claimed yet.'}
          </p>
        ) : imp?.available === false ? (
          <div className="px-4 pb-4" data-testid="hq-live-impersonations-unreadable">
            <Unreadable what="The support-session list" claim="This is not a claim that no support session is live." onRetry={onRetry} />
          </div>
        ) : !imp?.rows?.length ? (
          <p className="px-4 pb-4 text-[12.5px] text-axal-faint dark:text-gray-400" data-testid="hq-live-impersonations-empty">
            No one is acting as another user right now. Ended support sessions are in Events → Impersonations.
          </p>
        ) : (
          <table className="w-full text-left text-[12.5px]" data-testid="hq-live-impersonations">
            <caption className="sr-only">Live support sessions. Times are UTC.</caption>
            <thead className="hidden border-y border-axal-hairline bg-axal-ground text-[11px] uppercase tracking-[.06em] text-axal-faint md:table-header-group dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
              <tr>
                <th scope="col" className="px-3 py-2">Support admin</th>
                <th scope="col" className="px-3 py-2">Acting as</th>
                <th scope="col" className="px-3 py-2">Started</th>
                <th scope="col" className="px-3 py-2">Context</th>
                <th scope="col" className="px-3 py-2">Status</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {imp.rows.map((i) => {
                const admin = accountName(i.admin_name, i.admin_email, i.admin_user_id);
                const target = accountName(i.target_name, i.target_email, i.target_user_id);
                const ended = Object.prototype.hasOwnProperty.call(changed.ended, i.id);
                const until = changed.ended[i.id];
                return (
                  <tr key={i.id} className="block border-b border-axal-hairline px-4 py-3 md:table-row md:p-0 dark:border-gray-800" data-testid={`hq-live-impersonation-${i.id}`}>
                    <td className={CELL}><b className="text-axal-ink dark:text-white">{admin}</b></td>
                    <td className={CELL}><span className="mr-1 text-axal-faint md:hidden dark:text-gray-400">acting as</span><b className="text-axal-ink dark:text-white">{target}</b></td>
                    <td className={CELL}><span className="mr-1 text-axal-faint md:hidden dark:text-gray-400">Started</span><Time value={i.started_at} /></td>
                    <td className={CELL}>{i.context || <span className="text-axal-faint dark:text-gray-400">None given</span>}</td>
                    <td className={CELL}>
                      {ended
                        ? <span className="flex flex-col gap-0.5"><StatusBadge state="verified" label="Record closed" />{until && <small className="text-axal-muted dark:text-gray-400">Token still valid until no later than {formatUtc(until, { seconds: false })}</small>}</span>
                        : <StatusBadge state="pending" label="Open" />}
                    </td>
                    <td className={CELL}>
                      <div className="flex flex-wrap gap-1.5 pt-1 md:justify-end md:pt-0">
                        {!ended && (
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={(e) => start({
                              kind: 'end', impId: i.id, admin, target, targetUserId: i.target_user_id,
                              started: formatUtc(i.started_at), self: me !== null && i.admin_user_id === me,
                            }, e)}
                            className={SMALL_DANGER}
                          >
                            End support session…<span className="sr-only"> ({admin} acting as {target})</span>
                          </button>
                        )}
                        <button type="button" disabled={readOnly} onClick={(e) => start(signOutAction(i.target_user_id, target), e)} className={SMALL_DANGER}>
                          Sign out {target}…
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <ReachCard expiryMinutes={expiryMinutes} />
        {emergencyCard}
      </div>

      {dialog && (
        <AccessActionDialog
          key={dialog.key}
          action={dialog.action}
          onAct={onAct}
          onConfirmed={onConfirmed}
          onClose={() => setDialog(null)}
          onReread={onRefresh || onRetry}
          onSignOutAccount={(a) => setDialog((cur) => ({ ...cur, action: signOutAction(a.targetUserId, a.target), key: `sign_out-${Date.now()}` }))}
          expiryMinutes={expiryMinutes}
          now={() => (nowProp ?? Date.now())}
          returnFocus={dialog.opener}
          fallbackFocus={caption}
          rowsById={rowsById}
        />
      )}
    </div>
  );
}
