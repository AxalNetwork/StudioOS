import React from 'react';
import { Link } from 'react-router-dom';
import { Users2 } from 'lucide-react';
import { Card } from '../../ui';
import BranchZone from './BranchZone';

/**
 * Branch · Community — canvas S4's second half, and the index its four consoles
 * never had.
 *
 * WHAT WAS ACTUALLY MISSING. All four consoles are real, working, and already
 * branch-reachable: `admin_events.ts`, `admin_jobs.ts`, `admin_circles.ts` and
 * `admin_network_profiles.ts` carry **zero** `requireHqAuthoring` calls between
 * them, so they answer on a branch exactly as they do at HQ — which is what
 * "entirely local" should mean and, measured, already does. Each has a live SPA
 * route. What did not exist is the page the sidebar's Community row points at,
 * so this is an index rather than four new screens.
 *
 * EACH CARD SAYS WHAT ITS CONSOLE ACTUALLY DOES, because three of the four are
 * narrower than their names suggest and a reader who assumes otherwise goes
 * looking for a control that is not there:
 *
 *   Events (9 routes)     moderation + analytics — approve, reject, unpublish,
 *                         feature, cancel, capacity. No admin authoring of the
 *                         event itself; members write them.
 *   Job board (5 routes)  moderation ONLY — list, detail, approve, reject,
 *                         unpublish. There is no admin create, edit or delete.
 *   Circles (8 routes)    full CRUD — the admin authors circles outright.
 *   Network profiles (6)  CRUD + photo + reorder.
 *
 * AND NETWORK PROFILES IS NOT A MEMBER DIRECTORY, which is the one a reader is
 * most likely to get wrong. Measured: the only public route over that table is
 * `network_public.ts`'s single photo-blob proxy, and the only other reader in
 * the whole worker is `services/decks/axalSpinoutDemoDay.ts`. There is no
 * member-facing list endpoint at all — what the table feeds is the Demo Day
 * deck's Team & Network slide ("Mentors & Network" until D214 — no deck has a
 * slide by that name), so the card says that rather than letting the
 * name imply a directory that does not exist.
 *
 * NO FETCH HERE, DELIBERATELY. Four counts would each be a second read of a
 * console's own list, and a count on this page disagreeing with the console one
 * click away is the tile-vs-table defect D128 was written to end. The cards
 * link; the consoles count.
 */

/**
 * The five consoles, with what each one can actually do.
 *
 * D303 — Wellbeing joined this index because the coordinator's decision was
 * *"Wellbeing goes to Admin · Community"*: `frontend/src/lib/adminPlacement.js`
 * already places its tab there (`admin('Community', 'card link')`), so the
 * gap was only this card and the worker-side gate below, not the placement.
 * Its `to` carries `?tab=wellbeing` rather than a path of its own, because
 * `AdminPage.jsx` renders it as one of that page's tabs
 * (`tab === 'wellbeing' && <WellbeingExpertsPanel />`), the same shape as
 * every other `admin(...)` tab in `adminPlacement.js` — there is no
 * `/admin/wellbeing` route to link to instead.
 *
 * EXPORTED so the test reads this list rather than restating it — and so a
 * sixth console added here without a route is caught by the same assertion
 * that checks these five.
 */
export const COMMUNITY_CONSOLES = [
  {
    key: 'events',
    label: 'Events',
    to: '/admin/events',
    scope: 'Moderation and analytics',
    what: 'Members write the events; this console approves, rejects, unpublishes, features, '
      + 'cancels and sets capacity, and reports on attendance. It does not author an event.',
  },
  {
    key: 'jobs',
    label: 'Job board',
    to: '/admin/jobs',
    scope: 'Moderation only',
    what: 'Approve, reject or unpublish a posting somebody else wrote. There is no admin '
      + 'create, edit or delete — a job nobody posted cannot be added here.',
  },
  {
    key: 'circles',
    label: 'Circles',
    to: '/admin/circles',
    scope: 'Yours to author',
    what: 'The one community surface this branch writes outright: create, edit, publish, '
      + 'unpublish, feature and delete a circle.',
  },
  {
    key: 'network-profiles',
    label: 'Network profiles',
    to: '/admin/network-profiles',
    scope: 'Yours to author',
    what: 'Create, edit, reorder and set a photo. It is not a member directory — nothing '
      + 'serves these to members except the photo itself, and what they feed is the Demo Day '
      + "deck's Team & Network slide.",
  },
  {
    key: 'wellbeing',
    label: 'Wellbeing',
    to: '/admin?tab=wellbeing',
    worker: 'wellbeing.ts',
    scope: 'Expert directory only',
    what: 'Verify or hide an expert on the founder-facing directory; a hidden or unverified '
      + 'expert stops appearing to founders, and a takedown always works. Curated resources '
      + 'have no console of their own here — POST and DELETE /resources exist on the worker '
      + 'but nothing in the admin product calls them yet.',
  },
];

export default function BranchCommunity({ user }) {
  return (
    <BranchZone
      workspace="Community"
      user={user}
      // D151 — THIS IS THE ONE ZONE WHERE THE RAIL'S "nothing to read back"
      // IS TRUE, AND IT SAYS WHY RATHER THAN BEING GIVEN COVERAGE TO FIX IT.
      // Three branch zones passed the rail nothing; two of them had loaded a
      // summary and were simply not telling it. This one genuinely has not,
      // deliberately — see the header above: four counts here would each be a
      // second read of a console's own list, and a count disagreeing with the
      // console one click away is the tile-vs-table defect D128 ended.
      // Fabricating coverage so the rail's button lights up would reintroduce
      // that defect one layer higher, which is why the absence is explained
      // instead of filled.
      coverageNote={'These four consoles read and write this deployment\'s own database. Nothing in them '
        + 'is shared with another territory and nothing in them is pushed from HQ. This page holds no '
        + 'figures of its own to read back — each console counts its own rows, so a count here could '
        + 'disagree with the one a click away.'}
    >
      <header data-testid="branch-community-header">
        <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
          <Users2 size={13} /> Branch · Community
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink">Community</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
          Events, the job board, circles and network profiles &mdash; entirely local. Each console
          below runs against this territory&rsquo;s own database, and each says what it can do,
          because three of the four are narrower than their names suggest.
        </p>
      </header>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {COMMUNITY_CONSOLES.map((con) => (
          <li key={con.key}>
            <Card className="h-full p-4" data-testid={`branch-community-${con.key}`}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">
                  {con.label}
                </h2>
                <span className="text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-muted">
                  {con.scope}
                </span>
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">{con.what}</p>
              <p className="mt-2 text-[11.5px]">
                <Link
                  to={con.to}
                  className="font-semibold text-axal-ink underline underline-offset-2"
                >
                  Open {con.label.toLowerCase()}
                </Link>
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </BranchZone>
  );
}
