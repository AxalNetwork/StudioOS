import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, Pill, SectionLabel, Skeleton, Unreadable, Unrecorded } from '../../ui';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuthSync';
import { initialsOf, profileSub, safeHref, sinceYear } from './practice/practiceTools';
import { PriceCell } from './practice/SessionTypesPanel';

/**
 * Ops A5 public advisor profile (D571/D573). Publishes active session types
 * and enabled public links. Private counts and response commitments remain
 * Not recorded. Ownership is checked through the caller's own profile.
 */

export default function AdvisorProfilePage() {
  const { uid } = useParams();
  const auth = useAuth();
  const [state, setState] = useState({ status: 'loading', advisor: null });

  const load = useCallback(async () => {
    setState({ status: 'loading', advisor: null });
    try {
      const advisor = await api.getAdvisor(encodeURIComponent(uid || ''));
      let isOwner = false;
      if (auth?.user?.role === 'advisor') {
        try { isOwner = (await api.getMyAdvisor())?.uid === advisor?.uid; } catch { /* ownership is unconfirmed */ }
      }
      // `/advisors/me` and `/advisors/match` are routes of their own on the
      // Worker; neither answers with a profile, and neither is drawn as one.
      setState(advisor?.uid ? { status: 'ready', advisor, isOwner } : { status: 'missing', advisor: null });
    } catch (e) {
      setState({ status: e?.status === 404 ? 'missing' : 'unreadable', advisor: null });
    }
  }, [uid, auth?.user?.id, auth?.user?.role]);
  useEffect(() => { load(); }, [load]);

  return <AdvisorProfileView state={state} onRetry={load} isOwner={state.isOwner === true} />;
}

function Frame({ children }) {
  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="advisor-profile">
      <Link to="/advisors" className="text-[12.5px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300">
        ‹ Advisor directory
      </Link>
      {children}
    </div>
  );
}

/** A list the advisor answered (an array), or did not (null). An empty answer is not an absent one. */
function listValue(value, empty) {
  if (!Array.isArray(value)) return null;
  return value.length ? value.join(', ') : empty;
}

/** The page from its state, so a guard can render each one. */
export function AdvisorProfileView({ state, onRetry, isOwner = false, onBook }) {
  if (state?.status === 'loading') {
    return <Frame><div className="space-y-3" aria-busy="true"><Skeleton className="h-8" /><Skeleton className="h-40" /></div></Frame>;
  }
  if (state?.status === 'unreadable') {
    return (
      <Frame>
        <Card padding="lg" data-testid="advisor-profile-unreadable">
          <Unreadable what="The profile" claim="This is not a claim that the advisor is not here." onRetry={onRetry} />
        </Card>
      </Frame>
    );
  }
  if (state?.status !== 'ready' || !state.advisor) {
    return (
      <Frame>
        <Card padding="lg" data-testid="advisor-profile-missing">
          <h1 className="text-lg font-extrabold tracking-tight">No advisor profile at this address</h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-axal-muted">
            The link may be mistyped, or the profile may have been removed. The directory lists every advisor
            who is taking bookings.
          </p>
        </Card>
      </Frame>
    );
  }

  const a = state.advisor;
  const expertise = Array.isArray(a.expertise) ? a.expertise.filter(Boolean) : [];
  const sub = profileSub(a);
  const photo = safeHref(a.headshot_url);
  const linkedin = safeHref(a.linkedin_url);
  const since = sinceYear(a);
  const rate = a.hourly_rate_usd == null || a.hourly_rate_usd === '' ? null : Number(a.hourly_rate_usd);

  const details = [
    ['Stages', listValue(a.stages, 'None listed')],
    ['Languages', listValue(a.languages, 'None listed')],
    ['Timezone', a.timezone || null],
    ['Availability', a.availability_note || null],
  ];

  return (
    <Frame>
      {isOwner && (
        <p className="rounded-[10px] border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[12px] text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200"
          data-testid="advisor-profile-owner">
          This is your profile as a client sees it. Change it on{' '}
          <Link to="/expertise/profile" className="font-semibold underline">Expertise · Profile</Link>.
        </p>
      )}
      {a.is_active === false && (
        <p className="text-[12px] text-amber-800 dark:text-amber-300" data-testid="advisor-profile-unlisted">
          This profile is not listed in the directory.
        </p>
      )}

      <header>
        <h1 className="m-0 text-xl font-extrabold tracking-tight sm:text-2xl">
          {a.display_name || <Unrecorded>Name not recorded</Unrecorded>}
        </h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-axal-muted">
          {sub || <Unrecorded reason="The advisor has not written a positioning line, sectors or a country.">No positioning recorded</Unrecorded>}
        </p>
      </header>

      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <div className="space-y-3">
          <Card padding="md" className="flex items-start gap-3.5">
            {photo ? (
              <img src={photo} alt="" referrerPolicy="no-referrer"
                className="h-14 w-14 flex-none rounded-full border border-axal-hairline object-cover dark:border-gray-700" />
            ) : (
              <span aria-hidden="true"
                className="grid h-14 w-14 flex-none place-items-center rounded-full border border-emerald-200 bg-emerald-50 text-[13px] font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                {initialsOf(a.display_name)}
              </span>
            )}
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap gap-1.5" data-testid="advisor-profile-expertise">
                {expertise.length
                  ? expertise.map((e) => <Pill key={e} tone="neutral">{e}</Pill>)
                  : <Unrecorded reason="The advisor has not listed any expertise.">No expertise listed</Unrecorded>}
              </div>
              <p className="m-0 whitespace-pre-line text-[13px] leading-relaxed text-axal-muted">
                {a.bio || <Unrecorded>No introduction written yet</Unrecorded>}
              </p>
            </div>
          </Card>

          <div className="grid gap-2 sm:grid-cols-3" data-testid="advisor-profile-proof">
            <ProofTile label="Engagements"
              value={<Unrecorded reason="An advisor's engagements are their own record; no page counts them for a client.">Not recorded</Unrecorded>} />
            <ProofTile label="On Axal since" value={since ?? <Unrecorded>Not recorded</Unrecorded>} />
            <ProofTile label="Response"
              value={<Unrecorded reason="Nothing stores how quickly an advisor replies.">Not recorded</Unrecorded>} />
          </div>

          <Card padding="md">
            <SectionLabel>Details</SectionLabel>
            <dl className="mt-2 grid gap-1.5">
              {details.map(([k, v]) => (
                <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <dt className="text-[11.5px] text-axal-faint">{k}</dt>
                  <dd className="m-0 text-[12px] font-semibold">{v ?? <Unrecorded>Not recorded</Unrecorded>}</dd>
                </div>
              ))}
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <dt className="text-[11.5px] text-axal-faint">LinkedIn</dt>
                <dd className="m-0 text-[12px] font-semibold">
                  {linkedin
                    ? <a href={linkedin} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline dark:text-emerald-300">Profile ↗</a>
                    : <Unrecorded>Not recorded</Unrecorded>}
                </dd>
              </div>
            </dl>
          </Card>
        </div>

        <Card padding="none" className="overflow-hidden" data-testid="advisor-profile-sessions">
          <div className="border-b border-axal-hairline px-4 py-3 text-[14px] font-bold dark:border-gray-700">Sessions</div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
            <span className="text-[12.5px] font-semibold">Hourly rate</span>
            <span className="text-[12.5px] tabular-nums">
              {rate != null && Number.isFinite(rate)
                ? `$${rate.toLocaleString(undefined, { maximumFractionDigits: 2 })} an hour`
                : <Unrecorded reason="This advisor has not published a price.">Not recorded</Unrecorded>}
            </span>
          </div>
          <div className="px-4 py-3" data-testid="advisor-profile-session-types">
            <div className="text-[12.5px] font-semibold">Session types</div>
            {!Array.isArray(a.session_types) ? <Unrecorded>Session types not recorded</Unrecorded>
              : a.session_types.length === 0 ? <p className="mt-2 text-[12px] text-axal-muted">No session types published yet.</p>
              : a.session_types.map(type => {
                const link = a.booking_links?.find(l => l.session_type_id === type.id && l.is_active !== false);
                return <div key={type.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-3 dark:border-gray-800">
                  <div><strong className="text-[12.5px]">{type.name}</strong>
                    <p className="text-[12px] text-axal-muted">{type.duration_minutes == null ? 'Length not recorded' : `${type.duration_minutes} min`}</p>
                    <PriceCell type={type} />
                  </div>
                  {link ? onBook
                    ? <button type="button" className="text-[12px] font-semibold text-emerald-700 underline dark:text-emerald-300" onClick={() => onBook(type, link)}>Book</button>
                    : <Link className="text-[12px] font-semibold text-emerald-700 underline dark:text-emerald-300" to={`/b/${link.slug}`}>Book</Link>
                    : <Unrecorded reason="No public booking link is enabled for this session type.">Booking link not recorded</Unrecorded>}
                </div>;
              })}
          </div>
          <div className="border-t border-axal-hairline px-4 py-3 text-[12px] text-axal-muted dark:border-gray-800">
            Booking opens a session type's link. Sign in to choose a time and request the session.
          </div>
        </Card>
      </div>
    </Frame>
  );
}

function ProofTile({ label, value }) {
  return (
    <Card padding="sm">
      <div className="text-[15px] font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11.5px] text-axal-faint">{label}</div>
    </Card>
  );
}
