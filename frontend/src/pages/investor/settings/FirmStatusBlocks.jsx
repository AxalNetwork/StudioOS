/**
 * D6287 part 2 (#6287): Firm Settings' four read-only status blocks beside the
 * form (canvas CS-17, CS-20A/B, CS-21, CS-25A): identity and accreditation,
 * licences, funds, team seats. Each reads on its own and has its own loading
 * skeleton and Unavailable with Try again, so one failed read never blanks
 * another or the form, and the blocks still show when the profile read fails.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataState } from '../../../ui';
import { reportError } from '../../../lib/log';
import { accreditationWord, fundRelation, kycWord } from './firmSettingsModel.js';
import { seatDate, seatState } from '../../ColleagueSeatsPanel.jsx';

/** One read: `{ kind: 'loading' | 'ok' | 'failed', data, error }`, with retry. */
export function useRead(load, scope) {
  const [read, setRead] = useState({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setRead({ kind: 'loading' });
    Promise.resolve().then(load).then(
      (data) => { if (alive) setRead({ kind: 'ok', data }); },
      (error) => { reportError(scope, error); if (alive) setRead({ kind: 'failed', error }); },
    );
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return [read, retry];
}

const BLOCK = 'flex min-w-0 flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const OUT = 'inline-flex min-h-[44px] items-center text-sm font-semibold text-violet-700 underline dark:text-violet-300';
const HELP = 'text-xs text-gray-600 dark:text-gray-400';

function Skeleton({ rows = 2 }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <i key={i} className="block h-3 rounded bg-gray-200 dark:bg-gray-700" style={{ width: `${90 - i * 22}%` }} />
      ))}
    </div>
  );
}

function Block({ id, title, link, children }) {
  return (
    <section className={BLOCK} aria-labelledby={id} data-testid={id}>
      <h3 id={id} className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      {children}
      {link ? (link.to.startsWith('#')
        ? <a href={link.to} className={OUT}>{link.label} <span aria-hidden="true">›</span></a>
        : <Link to={link.to} className={OUT}>{link.label} <span aria-hidden="true">›</span></Link>) : null}
    </section>
  );
}

function Failed({ what, claim, onRetry }) {
  return <DataState state="unavailable" size="block" what={what} claim={claim} onRetry={onRetry} retryLabel="Try again" />;
}

const NR = <DataState state="not_recorded" />;

export function IdentityBlock({ client, profileRead }) {
  const [kyc, retry] = useRead(() => client.kycStatus(), 'FirmSettings:kyc');
  const accreditation = profileRead.status === 'ready' ? accreditationWord(profileRead.profile?.accreditation_status) : null;
  return (
    <Block id="firm-status-identity" title="Identity and accreditation" link={{ to: '/trust/me', label: 'Open Trust' }}>
      <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-gray-600 dark:text-gray-400">Identity check</dt>
        <dd className="min-w-0">
          {kyc.kind === 'loading' ? <Skeleton rows={1} />
            : kyc.kind === 'failed' ? <Failed what="The identity check" claim="That is not a claim it was never done." onRetry={retry} />
              : (kycWord(kyc.data?.kyc_status) || NR)}
        </dd>
        <dt className="text-gray-600 dark:text-gray-400">Accreditation</dt>
        <dd className="min-w-0">
          {profileRead.status === 'loading' ? <Skeleton rows={1} />
            : profileRead.status === 'error' ? <DataState state="unavailable" what="Accreditation" claim="It reads with the firm profile." />
              : accreditation ? <>{accreditation} <span className="text-xs italic text-gray-600 dark:text-gray-400">self-declared</span></> : NR}
        </dd>
      </dl>
      <p className={HELP}>Only the identity check comes from Trust. Accreditation is what you told us.</p>
    </Block>
  );
}

export function LicencesBlock({ read, retry }) {
  const held = read.kind === 'ok' && Array.isArray(read.data?.held) ? read.data.held : [];
  return (
    <Block id="firm-status-licences" title="Licences" link={{ to: '/account/licences', label: 'Account › Licences' }}>
      {read.kind === 'loading' ? <Skeleton rows={2} />
        : read.kind === 'failed' ? <Failed what="Your licences" claim="That is not a claim you hold none." onRetry={retry} />
          : held.length === 0 ? <DataState state="none">No licence is recorded.</DataState>
            : (
              <ul className="space-y-1.5 text-sm">
                {held.map((row) => (
                  <li key={row.licence} className="flex flex-wrap items-baseline gap-x-2">
                    <b className="font-semibold text-gray-900 dark:text-gray-100">{row.label || row.licence}</b>
                    <span className="text-gray-700 dark:text-gray-300">Plan: {row.plan?.name || NR}</span>
                    {row.is_primary ? <small className="text-gray-500 dark:text-gray-400">primary</small> : null}
                  </li>
                ))}
              </ul>
            )}
    </Block>
  );
}

export function FundsBlock({ client }) {
  const [read, retry] = useRead(() => client.fundsList(), 'FirmSettings:funds');
  const items = read.kind === 'ok' && Array.isArray(read.data?.items) ? read.data.items : null;
  return (
    <Block id="firm-status-funds" title="Funds" link={{ to: '/funds', label: 'Open Funds' }}>
      {read.kind === 'loading' ? <Skeleton rows={3} />
        : read.kind === 'failed' || !items ? <Failed what="Funds" claim="The rest of this page still works." onRetry={retry} />
          : (
            <>
              <p className="flex items-baseline gap-2"><b className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{items.length}</b><span className={HELP}>funds you manage or sit in, now</span></p>
              {items.length === 0 ? <p className={HELP}>None yet.</p> : (
                <ul className="space-y-1 text-sm">
                  {items.slice(0, 5).map((fund) => (
                    <li key={fund.id} className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <b className="min-w-0 break-words font-semibold text-gray-900 dark:text-gray-100">{fund.name || 'Name not recorded'}</b>
                      <span className="text-xs text-gray-600 dark:text-gray-400">{fundRelation(fund) || 'Relationship not recorded'}</span>
                    </li>
                  ))}
                  {items.length > 5 ? <li className={HELP}>and {items.length - 5} more</li> : null}
                </ul>
              )}
            </>
          )}
    </Block>
  );
}

export function SeatsBlock({ read, retry, included }) {
  const seats = read.kind === 'ok' && Array.isArray(read.data?.seats) ? read.data.seats : null;
  const live = seats ? seats.filter((s) => seatState(s) !== 'revoked') : [];
  const cap = Number(read.data?.cap) || null;
  const offered = included === false && live.length === 0;
  return (
    <Block id="firm-status-seats" title="Team seats" link={offered ? { to: '/account/billing', label: 'See plans in Billing' } : { to: '#team-seats', label: 'Manage seats' }}>
      {read.kind === 'loading' ? <Skeleton rows={3} />
        : read.kind === 'failed' || !seats ? <Failed what="Team seats" claim="That is not a claim no seat is used." onRetry={retry} />
          : offered ? <p className={HELP}>Colleague seats come with the Institutional plan.</p>
            : (
              <>
                <p className="flex items-baseline gap-2">
                  <b className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{live.length}</b>
                  <span className={HELP}>{cap ? `of ${cap} on the Institutional plan` : 'seats used'}</span>
                </p>
                {live.length ? (
                  <ul className="space-y-1 text-sm">
                    {live.slice(0, 3).map((s) => (
                      <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <b className="min-w-0 break-all font-semibold text-gray-900 dark:text-gray-100">{s.seat_email || 'Address not recorded'}</b>
                        <span className="text-xs text-gray-600 dark:text-gray-400">
                          {seatState(s) === 'accepted' ? `Joined ${seatDate(s.accepted_at) || 'date not recorded'}` : `Invited ${seatDate(s.invited_at) || 'date not recorded'}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : <p className={HELP}>No seat has been used yet.</p>}
              </>
            )}
    </Block>
  );
}

/** The column of four. `licences` and `seats` are the page's reads, shared with Team seats below. */
export default function FirmStatusBlocks({ client, profileRead, licences, seats, included }) {
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="firm-status-blocks">
      <IdentityBlock client={client} profileRead={profileRead} />
      <LicencesBlock read={licences.read} retry={licences.retry} />
      <FundsBlock client={client} />
      <SeatsBlock read={seats.read} retry={seats.retry} included={included} />
    </div>
  );
}
