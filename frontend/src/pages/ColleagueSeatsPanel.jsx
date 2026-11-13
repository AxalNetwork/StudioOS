import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Check, RefreshCw, Search } from 'lucide-react';
import { api } from '../lib/api';
import { toUtcInstant } from '../lib/notices';

/**
 * D632 — the inviter's side of a colleague seat (Ops canvas `st-invite`).
 *
 * The invite link is shown once, right after inviting, because the inviter
 * passes it on themselves. `GET /api/investor-seats` never carries it, and
 * this panel never asks for it again: reload the page and it is gone. The
 * list draws each seat's state, and Revoke for any seat not revoked.
 *
 * States: loading; empty ("No seat has been used yet."); "Not recorded" for a
 * seat not accepted yet; "Unreadable" with Try again — a failed read never
 * draws an empty list or a zero quota.
 */

export const SEAT_STATE_LABEL = { accepted: 'Accepted', invited: 'Invited', revoked: 'Revoked' };
const SEAT_STATE_STYLE = {
  accepted: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  invited: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  revoked: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
};

/** A seat's state, from the route's `state` or, for an older reply, its stamps. */
export function seatState(s) {
  if (s?.state && SEAT_STATE_LABEL[s.state]) return s.state;
  return s?.revoked_at ? 'revoked' : s?.accepted_at ? 'accepted' : 'invited';
}

/** `12 Oct` from a D1 timestamp, or '' when there is none. */
export function seatDate(v) {
  const iso = toUtcInstant(v);
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** What the panel shows right after an invite, from what the route did. */
export function seatInviteOnce(res, fallbackEmail) {
  const email = res?.email || fallbackEmail;
  return {
    link: res?.invite_link || '',
    email,
    note: res?.email_sent
      ? `An invite was also emailed to ${email}. This link is not shown again.`
      : 'Copy this link now. It is shown once, because no email is sent.',
  };
}

function seatsOf(res) {
  if (Array.isArray(res?.seats)) return res.seats;
  if (Array.isArray(res)) return res;
  return null;
}

export default function ColleagueSeatsPanel({
  client = api,
  cap: capProp = 4,
  onChange,
  initialRead = null,
  initialOnce = null,
  confirmRevoke = (msg) => (typeof window === 'undefined' ? true : window.confirm(msg)),
}) {
  const [read, setRead] = useState(initialRead || { kind: 'loading' });
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [once, setOnce] = useState(initialOnce);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [revokeError, setRevokeError] = useState('');

  const load = useCallback(() => {
    setRead((r) => (r.kind === 'ready' ? r : { kind: 'loading' }));
    return client.listInvestorSeats()
      .then((res) => {
        const seats = seatsOf(res);
        if (!seats) throw new Error('The seat list came back in a shape this page cannot read.');
        setRead({ kind: 'ready', seats, cap: Number(res?.cap) || capProp });
      })
      .catch((e) => setRead({ kind: 'unreadable', message: e?.message || '' }));
  }, [client, capProp]);

  useEffect(() => { if (!initialRead) load(); }, [load, initialRead]);

  const invite = async (e) => {
    e?.preventDefault();
    const v = email.trim();
    if (!v) return;
    setBusy(true); setInviteError(''); setCopied(false);
    try {
      const res = await client.inviteInvestorSeat(v);
      setOnce(seatInviteOnce(res, v));
      setEmail('');
      await load();
      onChange?.();
    } catch (err) {
      setInviteError(err?.message || 'The invite could not be created.');
    } finally { setBusy(false); }
  };

  const revoke = async (seat) => {
    if (!confirmRevoke(`Revoke the seat for ${seat.seat_email}? They lose access at once.`)) return;
    setRevokeError('');
    try {
      await client.revokeInvestorSeat(seat.id);
      await load();
      onChange?.();
    } catch (err) {
      setRevokeError(err?.message || 'The seat could not be revoked.');
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(once.link); setCopied(true); } catch { setCopied(false); }
  };

  const seats = read.kind === 'ready' ? read.seats : [];
  const cap = read.kind === 'ready' ? read.cap : capProp;
  const used = seats.filter((s) => seatState(s) !== 'revoked').length;
  const full = read.kind === 'ready' && cap > 0 && used >= cap;
  const q = query.trim().toLowerCase();
  const shown = seats.filter((s) => (stateFilter === 'all' || seatState(s) === stateFilter)
    && (!q || String(s.seat_email || '').toLowerCase().includes(q)));

  return (
    <div data-testid="colleague-seats" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-gray-600 dark:text-gray-400">
          Institutional plans include seats for colleagues. Copy the link and pass it on yourself.
        </p>
        <div className="text-right" data-testid="seat-quota">
          {read.kind === 'ready' ? (
            <>
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{used}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">of {cap} seats</div>
            </>
          ) : read.kind === 'unreadable' ? (
            <div className="text-xs text-gray-500 dark:text-gray-400">Seats used: unreadable</div>
          ) : null}
        </div>
      </div>

      <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="seat-invite-email">Colleague email</label>
        <input
          id="seat-invite-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="colleague@firm.com"
          disabled={busy || full || read.kind !== 'ready'}
          className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
        />
        <button type="submit" disabled={busy || full || read.kind !== 'ready' || !email.trim()}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:hover:bg-violet-500">
          {busy ? 'Inviting…' : 'Invite a colleague'}
        </button>
      </form>
      {inviteError ? <p className="text-xs text-rose-700 dark:text-rose-300" data-testid="seat-invite-error">{inviteError}</p> : null}
      {full ? <p className="text-xs text-amber-700 dark:text-amber-300">All {cap} seats are in use. Revoke one to invite someone new.</p> : null}

      {once?.link ? (
        <div data-testid="seat-invite-once" className="rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-950/30">
          <p className="text-xs font-semibold text-violet-900 dark:text-violet-100">{once.note}</p>
          <p className="mt-1 text-xs text-violet-800 dark:text-violet-200">For {once.email}</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200" data-testid="seat-invite-link">{once.link}</code>
            <button type="button" onClick={copy}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-violet-300 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:text-violet-200 dark:hover:bg-violet-900/40">
              {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button type="button" onClick={() => setOnce(null)}
            className="mt-2 text-xs text-violet-700 underline hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-100">
            Done — hide the link
          </button>
        </div>
      ) : null}

      {read.kind === 'loading' ? (
        <p className="text-sm text-gray-500 dark:text-gray-400" data-testid="seats-loading">Loading seats…</p>
      ) : read.kind === 'unreadable' ? (
        <div data-testid="seats-unreadable" className="rounded-lg border border-dashed border-rose-300 p-3 dark:border-rose-800">
          <p className="text-sm text-rose-700 dark:text-rose-300">Seats could not be read just now.</p>
          {read.message ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{read.message}</p> : null}
          <button type="button" onClick={load}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800">
            <RefreshCw size={12} aria-hidden="true" /> Try again
          </button>
        </div>
      ) : seats.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400" data-testid="seats-empty">
          No seat has been used yet.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">Search seats</span>
              <Search size={13} className="absolute left-2 top-2.5 text-gray-400" aria-hidden="true" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search seats…"
                className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-7 pr-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" />
            </label>
            <label className="text-xs text-gray-600 dark:text-gray-300">
              <span className="sr-only">State</span>
              <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100">
                <option value="all">Any state</option>
                <option value="accepted">Accepted</option>
                <option value="invited">Invited</option>
                <option value="revoked">Revoked</option>
              </select>
            </label>
          </div>
          {revokeError ? <p className="text-xs text-rose-700 dark:text-rose-300" data-testid="seat-revoke-error">{revokeError}</p> : null}
          <p className="text-xs text-gray-500 dark:text-gray-400">{shown.length} of {seats.length} seats</p>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
            {shown.map((s) => {
              const st = seatState(s);
              return (
                <li key={s.id} data-testid={`seat-row-${s.id}`} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-gray-900 dark:text-gray-100">{s.seat_email || 'Address not recorded'}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                      <span className={`rounded-full px-2 py-0.5 font-medium ${SEAT_STATE_STYLE[st]}`}>{SEAT_STATE_LABEL[st]}</span>
                      <span>Invited {seatDate(s.invited_at) || 'date not recorded'}</span>
                      {s.accepted_at
                        ? <span>Accepted {seatDate(s.accepted_at)}</span>
                        : <span title="Not recorded">Accepted: this seat has not been accepted yet.</span>}
                    </div>
                  </div>
                  {st !== 'revoked' ? (
                    <button type="button" onClick={() => revoke(s)}
                      className="shrink-0 text-xs text-rose-600 hover:underline dark:text-rose-400 dark:hover:underline">Revoke</button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
