import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, Pill, SectionLabel, Skeleton, Unreadable, Unrecorded } from '../../ui';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuthSync';
import { initialsOf, profileSub, safeHref, sinceYear } from './practice/practiceTools';

/**
 * `/advisors/:uid` — an advisor's profile as a client sees it. The Ops
 * canvas's A5 (`advpub-profile`, D571), drawn for desktop and phone.
 *
 * ONE READ, `getAdvisor` → `GET /api/advisors/:uid`, which any signed-in user
 * may make: the profile fields the advisor keeps on Expertise · Profile
 * (migration 202) and nothing private. The address is the advisor's `uid`: the
 * canvas says `[handle]`, and no advisor has a handle.
 *
 * WHAT THE CANVAS DRAWS AND NO ROUTE GIVES A CLIENT, each "Not recorded" with
 * its reason rather than a figure or a button that goes nowhere:
 *   · the session types and their Book buttons. Session types are stored, and
 *     only their advisor can read them (`GET /me/session-types`); a booking
 *     link has no page that opens it. So the Sessions card lists none, and
 *     sends the reader to the directory, where open hours are booked today;
 *   · the engagement count and the response time. Engagements are the
 *     advisor's private record, and nothing stores a response commitment.
 *
 * No Worker AI rail, as the canvas draws it (`rail: false`): a page about
 * another person, outside every workspace bucket.
 */

export default function AdvisorProfilePage() {
  const { uid } = useParams();
  const auth = useAuth();
  const [state, setState] = useState({ status: 'loading', advisor: null });

  const load = useCallback(async () => {
    setState({ status: 'loading', advisor: null });
    try {
      const advisor = await api.getAdvisor(encodeURIComponent(uid || ''));
      // `/advisors/me` and `/advisors/match` are routes of their own on the
      // Worker; neither answers with a profile, and neither is drawn as one.
      setState(advisor?.uid ? { status: 'ready', advisor } : { status: 'missing', advisor: null });
    } catch (e) {
      setState({ status: e?.status === 404 ? 'missing' : 'unreadable', advisor: null });
    }
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  const viewer = auth?.user?.id;
  const isOwner = Boolean(state.advisor && viewer != null && state.advisor.user_id === viewer);
  return <AdvisorProfileView state={state} onRetry={load} isOwner={isOwner} />;
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
export function AdvisorProfileView({ state, onRetry, isOwner = false }) {
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
            <p className="mt-1 text-[12px] leading-relaxed text-axal-muted">
              <Unrecorded>Not recorded</Unrecorded> on this page: an advisor&rsquo;s session types are stored, and
              only the advisor can read them yet. So there is no list to book from here, and no Book button that
              would open nothing.
            </p>
          </div>
          <div className="border-t border-axal-hairline px-4 py-3 text-[12px] leading-relaxed text-axal-muted dark:border-gray-800">
            Booking opens the advisor&rsquo;s link for a session type once a page opens those links. Until then,
            book this advisor&rsquo;s open hours from the{' '}
            <Link to="/advisors" className="font-semibold text-emerald-700 underline dark:text-emerald-300">advisor directory</Link>.
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
