import React, { Suspense, lazy, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, Skeleton, WorkerRail } from '../../ui';
import WorkspaceShell, { SeamChip } from '../WorkspaceShell';
import { bucketForPath, zoneForPath } from '../shellConfig';
import AdvisorPreviewNotice from '../../pages/advisor/AdvisorPreviewNotice';

const AdvisorAdvisoryWorkspace = lazy(() => import('../../pages/advisor/advisory/AdvisorAdvisoryWorkspace'));
const CohortsFoundersZone = lazy(() => import('../../pages/advisor/cohorts/FoundersZone'));
const CohortsThisWeekZone = lazy(() => import('../../pages/advisor/cohorts/ThisWeekZone'));
const CohortsOutcomesZone = lazy(() => import('../../pages/advisor/cohorts/OutcomesZone'));
const PracticeSessionsZone = lazy(() => import('../../pages/advisor/practice/SessionsZone'));
const PracticeEarningsZone = lazy(() => import('../../pages/advisor/practice/EarningsZone'));
const ExpertiseProfileZone = lazy(() => import('../../pages/advisor/expertise/ProfileZone'));
const ExpertiseServicesZone = lazy(() => import('../../pages/advisor/expertise/ServicesZone'));
const ExpertiseProofZone = lazy(() => import('../../pages/advisor/expertise/ProofZone'));

/**
 * Practice, Cohorts and Expertise — one component, three buckets.
 *
 * WHY TOGETHER. All three are the same job: put a canvas bucket's zones on real
 * routes, mount the live surface where one exists, and say so honestly where
 * one does not. Splitting that into three near-identical files would be three
 * places to keep in step.
 *
 * PRACTICE PARTLY EXISTS, AND THE OVERLAP IS PARTIAL IN BOTH DIRECTIONS.
 * `/advisor/advisory/*` ships five tabs: Opportunities, Clients, Engagements,
 * Delivery, Contracts. The canvas asks for five zones: Opportunities,
 * Engagements, Delivery, Sessions, Earnings. Three overlap. **Clients and
 * Contracts have no zone in the canvas, and Sessions and Earnings have no code
 * anywhere.** The three that overlap mount the live workspace; the two that do
 * not say what they would hold. Clients and Contracts keep their routes and
 * are linked from Opportunities rather than being dropped — the canvas having
 * no seat for a working tab is a gap in the canvas, not permission to delete
 * the tab.
 *
 * COHORTS READS SPIN-OUT LAB DATA, read-only both ways: it owns no Lab route,
 * writes nothing back, and every founder-sourced object carries the seam mark.
 * Migration 206 added the advisor↔cohort assignment this bucket waited on, so
 * Founders, This week and Outcomes are real pages now. The assignment is the
 * authorisation — an admin grants it, the worker refuses without it, and a
 * refusal renders as a stated boundary rather than an empty cohort.
 *
 * EXPERTISE NOW HAS THREE REAL ZONES, and two that still say what is missing.
 * Migrations 202, 203 and 204 gave Profile, Services and Proof stores of their
 * own, so each mounts its own page instead of all five rendering one
 * undifferentiated component. Thinking and Visibility keep a NoStoreYet card
 * naming exactly which store is absent.
 *
 * /office-hours IS RETIRED. It coupled the storefront to booking and was
 * broken at both — it read five keys the DTOs never emitted, so an advisor
 * could not accept a booking there and every slot showed "Invalid Date".
 * Expertise owns the storefront now and Practice owns booking, which is the
 * split the canvas asked for; the old path redirects to Opportunities.
 */

function Loading() {
  return <div className="space-y-3"><Skeleton className="h-8" /><Skeleton className="h-56" /></div>;
}

function NoStoreYet({ heading, what, why, links = [], seam }) {
  return (
    <Card className="border-dashed bg-axal-surface-2 p-6">
      <div className="max-w-2xl">
        <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
          No store behind this yet
        </div>
        <h2 className="mt-2 text-lg font-extrabold tracking-tight">{heading}</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">{what}</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">{why}</p>
        {seam && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-axal-ink-3">
            <SeamChip>From the founder</SeamChip>
            read-only — cohort data belongs to the Lab and to the founder, never to the practice
          </p>
        )}
        {links.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-3 text-[12px]">
            {links.map((l) => (
              <Link key={l.to} to={l.to} className="text-emerald-700 underline">{l.label}</Link>
            ))}
          </p>
        )}
      </div>
    </Card>
  );
}

// Zones served by the legacy five-tab Advisory workspace, which carries its
// own shell and must therefore be mounted `embedded`.
const LIVE = {
  '/practice': new Set(['opportunities', 'engagements', 'delivery']),
};

// One page per zone, each over the store its migration created. These render a
// BODY only — the shell below draws the crumb, h1, pills and rail — so unlike
// the Advisory workspace they need no `embedded` prop.
const ZONE = {
  '/cohorts': {
    founders: CohortsFoundersZone,
    'this-week': CohortsThisWeekZone,
    outcomes: CohortsOutcomesZone,
  },
  '/practice': {
    sessions: PracticeSessionsZone,
    earnings: PracticeEarningsZone,
  },
  '/expertise': {
    profile: ExpertiseProfileZone,
    services: ExpertiseServicesZone,
    proof: ExpertiseProofZone,
  },
};

const COPY = {
  // Practice has no unbacked zone left. Sessions and Earnings had cards here
  // saying they had "no store at all" — true when they were written, false the
  // moment migration 205 and its two routes shipped. A card that describes a
  // closed gap is worse than no card: it tells an advisor a working feature is
  // missing.
  '/expertise': {
    thinking: {
      heading: 'Published thinking is not advisor-scoped yet',
      what: 'What you have written, where it ran, and what it brought back — so a founder can read you before they book you.',
      why: 'The `articles` table exists and records a date and a publication state, but it has no advisor owner, no reach figure and no record of where a piece ran. Listing articles against your name would require a join that does not exist, and reporting reach would require a number nobody stores.',
      links: [{ to: '/articles', label: 'The articles hub as it stands →' }],
    },
    visibility: {
      heading: 'Nothing counts profile views',
      what: 'How often your profile was shown, how often it was opened, and which searches you appeared in.',
      why: 'There is no impression or profile-view counter anywhere in the product — not for advisors, not for anyone. This needs an analytics pipeline rather than a table, and a page of plausible-looking numbers would be worse than an empty one.',
      links: [{ to: '/expertise/profile', label: 'What a founder would see →' }],
    },
  },
  // Founders, This week and Outcomes are pages now — migration 206 and the
  // public Lab reads closed those gaps. The two that remain are corrected
  // rather than carried forward: each said its gap was the missing cohort
  // assignment, and that is no longer what is absent.
  '/cohorts': {
    guidance: {
      heading: 'Cohort guidance has no store',
      what: 'The same guidance delivered to a whole batch, and which founders have acted on it.',
      why: 'The cohort assignment this used to blame now exists — Founders reads it. What is genuinely missing is a store of its own: nothing records a piece of guidance addressed to a batch, and nothing records a founder acting on one. Migrations 201-206 gave the practice a profile, services, proof, consents, session amounts and a cohort link; none of them is this.',
      seam: true,
      links: [{ to: '/cohorts/founders', label: 'The batch itself →' }],
    },
    calendar: {
      heading: 'The cohort calendar is not built yet',
      what: 'The batch’s shared schedule — sessions, milestones and Lab dates in one place.',
      why: 'Both halves exist and nothing joins them. The Lab’s week windows are readable per batch under This week; your own bookable slots are published from Practice · Opportunities. No surface puts them on one calendar, and the batch read is deliberately kept Lab-only so this stays true rather than half-true.',
      seam: true,
      links: [{ to: '/practice/opportunities', label: 'Where your slots are published →' }],
    },
  },
};

export default function AdvisorBucketRoutes({ preview = false }) {
  const location = useLocation();
  const bucket = bucketForPath('advisor', location.pathname);
  const zone = zoneForPath(bucket, location.pathname);
  const prefix = bucket?.prefix;
  const slug = zone?.slug;

  const body = useMemo(() => {
    // An admin previewing the Advisor ROLE has selected no person, so Practice
    // and Expertise have no practice to render. The notice replaces the BODY
    // and keeps the shell — the crumb, zone row and rail still say where you
    // are, which a redirect to /studio did not.
    if (preview) return <AdvisorPreviewNotice />;
    const Zone = ZONE[prefix]?.[slug];
    if (Zone) return <Suspense fallback={<Loading />}><Zone /></Suspense>;

    if (LIVE[prefix]?.has(slug)) {
      // `embedded`: the WorkspaceShell below already draws the crumb, the h1,
      // the zone pills and the rail. AdvisorAdvisoryWorkspace carries its own
      // AdvisorWorkspaceShell, which would draw a second of each inside it.
      return <Suspense fallback={<Loading />}><AdvisorAdvisoryWorkspace embedded /></Suspense>;
    }
    const copy = COPY[prefix]?.[slug];
    if (copy) return <NoStoreYet {...copy} />;
    return <NoStoreYet
      heading="Nothing here yet"
      what="This zone is named by the canvas and has no surface behind it."
      why="It ships empty rather than as a placeholder that could be mistaken for real data."
    />;
  }, [prefix, slug, preview]);

  const INTRO = {
    '/practice': 'One practice. What is coming in, what is committed, and what has been delivered.',
    '/cohorts': 'One cohort at a time. Founder data comes from the Lab and is read-only to you.',
    '/expertise': 'How the market finds you, and what it finds when it does.',
  };

  // The Worker AI rail, absent from all fifteen of these routes until now: the
  // shell has taken a `rail` slot since the founder pass and this caller never
  // filled it, so every Practice, Cohorts and Expertise zone rendered with an
  // empty right-hand column. That is the report, for the third licence running:
  // "some pages doesn't have it, it does show anything, it looks blank".
  //
  // What it says here is what is true here. A zone with no store behind it
  // reports exactly that, rather than a coverage count it cannot produce — the
  // rail is the one component on the page that must never be more confident
  // than the body beside it.
  // LIVE ∪ ZONE, and the union is the fix. `live` drives the rail's coverage
  // line, and it used to read `LIVE` alone — which holds only the three legacy
  // Advisory tabs. Every zone served through `ZONE` therefore rendered
  // "<Zone> has no store behind it" while reading a real store: five shipped
  // pages saying the opposite of the truth, on the rail, which is the one
  // component on the page that must never be more confident than the body
  // beside it. It was the opposite failure and just as wrong.
  const live = Boolean(LIVE[prefix]?.has(slug) || ZONE[prefix]?.[slug]);
  const RAIL = {
    '/practice': {
      workspace: 'Practice',
      stance: 'Manual practice record',
      note: 'Opportunities, engagements, delivery, sessions and earnings read and write the stored advisory record. Nothing here writes a proposal, sends a message, or decides what a session was worth.',
      unavailable: [
        ['Money movement', 'A session amount is your own bookkeeping note. Axal issues no invoice, runs no checkout, holds nothing on your behalf and takes no cut. Nothing on this bucket settles anything.'],
        ['Pricing suggestions', 'No rate is proposed, benchmarked or inferred from your other sessions. Every amount here is one you typed.'],
      ],
    },
    '/cohorts': {
      workspace: 'Cohorts',
      stance: 'Read-only, both ways',
      note: 'Cohort data belongs to the Lab and to the founder. This bucket owns no Lab route and writes nothing back.',
      unavailable: [
        ['Assigning yourself a batch', 'An admin decides which cohort you advise. Nothing on this bucket can grant, extend or end your own access, and a refusal is shown as a boundary rather than as an empty cohort.'],
        ['Writing to the Lab', 'Every founder row here is the Lab’s record read as-is. Nothing edits a week result, a deadline, an admission or a graduation.'],
      ],
    },
    '/expertise': {
      workspace: 'Expertise',
      stance: 'Manual profile record',
      note: 'Profile, services and proof read and write the stored practice record. No positioning line, price, claim or attestation is drafted here — every word on your storefront is one you typed.',
      unavailable: [
        ['Attestation', 'Confirmation is asked of a named person and recorded from their own answer, never assumed. An unconfirmed claim stays visibly weaker than a confirmed one, and nothing here can move a claim between those two states on your behalf.'],
        ['Money movement', 'A service price is your record of what you charge. Axal issues no invoice, runs no checkout, and settles nothing.'],
      ],
    },
  }[prefix];

  return (
    <WorkspaceShell
      role="advisor"
      scope={prefix === '/cohorts' ? 'One cohort' : 'One practice'}
      intro={INTRO[prefix]}
      rail={RAIL && (
        <WorkerRail
          workspace={RAIL.workspace}
          role="advisor"
          stance={RAIL.stance}
          note={RAIL.note}
          coverage={[live
            ? `${zone?.label || 'This zone'} reads the stored record`
            : `${zone?.label || 'This zone'} has no store behind it`]}
          unavailable={RAIL.unavailable}
        />
      )}
    >
      {body}
      {!preview && prefix === '/practice' && slug === 'opportunities' && (
        <Card className="mt-4 p-4">
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
            Still here, still working
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-axal-ink-2">
            <Link to="/advisor/advisory/clients" className="text-emerald-700 underline">Clients</Link> and{' '}
            <Link to="/advisor/advisory/contracts" className="text-emerald-700 underline">Contracts</Link> are
            live tabs the canvas has no zone for. They keep their routes rather than being dropped — a working
            tab with no seat in a taxonomy is a gap in the taxonomy, not permission to delete the tab.
          </p>
        </Card>
      )}
    </WorkspaceShell>
  );
}
