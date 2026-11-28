/**
 * D6287 part 2 (#6287): Team seats on Firm Settings (canvas CS-24, CS-24B),
 * over `routes/investor_seats.ts`: the seat list, Send invite (not part of
 * Save), the invite link shown once (D632: the list never carries it again),
 * and Revoke as Scope → Review → Result. On a plan without seats it says
 * seats come with the Institutional plan and links to Billing.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataState } from '../../../ui';
import { reportError } from '../../../lib/log';
import { SEAT_STATE_LABEL, seatDate, seatInviteOnce, seatState } from '../../ColleagueSeatsPanel.jsx';
import { inviteRefusal } from './firmSettingsModel.js';

const FIELD = 'block w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-800 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200';
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-violet-700 px-4 text-sm font-semibold text-white disabled:opacity-50';
const HELP = 'text-xs text-gray-600 dark:text-gray-400';
const TONE = {
  accepted: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  invited: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  revoked: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
};
const WORD = { ...SEAT_STATE_LABEL, accepted: 'Joined' };

function seatWhen(seat) {
  const state = seatState(seat);
  const at = state === 'revoked' ? seat.revoked_at : state === 'accepted' ? seat.accepted_at : seat.invited_at;
  return seatDate(at) || 'Date not recorded';
}

/** Review step of a revoke: what the seat is, what stops, what stays (CS-24B). */
function RevokeReview({ seat, busy, error, onKeep, onRevoke }) {
  const joined = seatState(seat) === 'accepted';
  return (
    <div role="dialog" aria-modal="false" aria-labelledby="revoke-seat-title" data-testid="revoke-review"
      className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-800 dark:bg-rose-950/30">
      <b id="revoke-seat-title" className="block break-all text-sm text-gray-900 dark:text-gray-100">Revoke {seat.seat_email || 'this seat'}?</b>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="font-semibold text-gray-800 dark:text-gray-200">Seat</dt>
        <dd className="text-gray-700 dark:text-gray-300">{joined ? `Joined ${seatDate(seat.accepted_at) || 'date not recorded'}` : `Invited ${seatDate(seat.invited_at) || 'date not recorded'}, not joined`}</dd>
        <dt className="font-semibold text-gray-800 dark:text-gray-200">What stops</dt>
        <dd className="text-gray-700 dark:text-gray-300">{joined ? 'Their access through your plan ends at once' : 'The invite link stops working'}</dd>
        <dt className="font-semibold text-gray-800 dark:text-gray-200">What stays</dt>
        <dd className="text-gray-700 dark:text-gray-300">Your firm settings and thesis</dd>
      </dl>
      {error ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={BTN} onClick={onKeep} disabled={busy}>Keep seat</button>
        <button type="button" className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-rose-700 px-3 text-sm font-semibold text-white disabled:opacity-50" onClick={onRevoke} disabled={busy}>
          {busy ? 'Revoking…' : 'Revoke seat'}
        </button>
      </div>
    </div>
  );
}

export default function FirmTeamSeats({ client, read, retry, included }) {
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [once, setOnce] = useState(null);
  const [copied, setCopied] = useState(false);
  const [review, setReview] = useState(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState('');
  const [result, setResult] = useState('');

  const seats = read.kind === 'ok' && Array.isArray(read.data?.seats) ? read.data.seats : null;
  const cap = Number(read.data?.cap) || null;
  const used = seats ? seats.filter((s) => seatState(s) !== 'revoked').length : 0;
  const left = cap ? Math.max(cap - used, 0) : null;
  const offered = included === false && used === 0;

  async function invite(event) {
    event.preventDefault();
    const value = email.trim();
    if (!value || inviting) return;
    setInviting(true); setInviteError(''); setCopied(false); setResult('');
    try {
      const res = await client.inviteSeat(value);
      setOnce(seatInviteOnce(res, value));
      setEmail('');
      retry();
    } catch (error) {
      reportError('FirmSettings:seat-invite', error);
      setInviteError(inviteRefusal(error));
    } finally { setInviting(false); }
  }

  async function revoke() {
    if (!review || revoking) return;
    setRevoking(true); setRevokeError('');
    try {
      await client.revokeSeat(review.id);
      setResult(cap ? `Seat revoked · ${Math.max(used - 1, 0)} of ${cap} used` : 'Seat revoked');
      setReview(null);
      retry();
    } catch (error) {
      reportError('FirmSettings:seat-revoke', error);
      setRevokeError('The seat could not be revoked. It is unchanged. Try again.');
    } finally { setRevoking(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(once.link); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <section id="team-seats" className="min-w-0 scroll-mt-6 space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" aria-labelledby="team-seats-title" data-testid="team-seats">
      <div>
        <h2 id="team-seats-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">Team seats</h2>
        <p className={HELP}>Colleagues on your Institutional plan. Invites go out when you press Send invite; they are not part of Save.</p>
      </div>

      {read.kind === 'loading' ? (
        <div aria-busy="true" aria-label="Loading" className="space-y-2">{[0, 1, 2].map((i) => <i key={i} className="block h-4 rounded bg-gray-200 dark:bg-gray-700" />)}</div>
      ) : read.kind === 'failed' || !seats ? (
        <DataState state="unavailable" size="block" what="Team seats" claim="That is not a claim no seat is used." onRetry={retry} retryLabel="Try again" />
      ) : offered ? (
        <div className="space-y-1 text-sm">
          <p className="text-gray-800 dark:text-gray-200">Colleague seats come with the Institutional plan.</p>
          <Link to="/account/billing" className="inline-flex min-h-[44px] items-center font-semibold text-violet-700 underline dark:text-violet-300">See plans in Billing <span aria-hidden="true">›</span></Link>
        </div>
      ) : (
        <>
          <p className="flex items-baseline gap-2">
            <b className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{used}</b>
            <span className={HELP}>{cap ? `of ${cap} on the Institutional plan` : 'seats used'}</span>
          </p>
          {result ? <p role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{result}</p> : null}
          {seats.length === 0 ? <DataState state="none" size="block">No seat has been used yet.</DataState> : (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {seats.map((seat) => {
                const state = seatState(seat);
                return (
                  <li key={seat.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid={`firm-seat-${seat.id}`}>
                    <div className="min-w-0">
                      <span className="block break-all font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">{seat.seat_email || 'Address not recorded'}</span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                        <span className={`rounded-full px-2 py-0.5 font-medium ${TONE[state]}`}>{WORD[state]}</span>
                        <span>{seatWhen(seat)}</span>
                      </span>
                    </div>
                    {state !== 'revoked' ? (
                      <button type="button" className={BTN} onClick={() => { setReview(seat); setRevokeError(''); setResult(''); }}>Revoke…</button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {review ? <RevokeReview seat={review} busy={revoking} error={revokeError} onKeep={() => setReview(null)} onRevoke={revoke} /> : null}

          <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 text-sm font-medium text-gray-800 dark:text-gray-200">Invite a colleague
              <input type="email" className={FIELD} placeholder="name@firm.example" value={email}
                disabled={inviting || left === 0} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button type="submit" className={PRIMARY} disabled={inviting || left === 0 || !email.trim()}>{inviting ? 'Sending…' : 'Send invite'}</button>
          </form>
          {left !== null ? <p className={HELP}>{left === 0 ? `All ${cap} seats are in use. Revoke one to invite someone new.` : `${left} ${left === 1 ? 'seat' : 'seats'} left`}</p> : null}
          {inviteError ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300" data-testid="firm-seat-invite-error">{inviteError}</p> : null}
          {once?.link ? (
            <div role="status" className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30" data-testid="firm-seat-invite-once">
              <b className="block break-all text-sm text-gray-900 dark:text-gray-100">Invite created for {once.email}</b>
              <p className="text-xs text-gray-700 dark:text-gray-300">{once.note}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200">{once.link}</code>
                <button type="button" className={BTN} onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
              </div>
              <p className={HELP}>Shown once. The seat list never shows the link again.</p>
            </div>
          ) : null}
          <p className={HELP}>A seat colleague sees and edits their own profile today, not this firm.</p>
        </>
      )}
    </section>
  );
}
