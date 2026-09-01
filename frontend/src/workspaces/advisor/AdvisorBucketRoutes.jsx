import React, { Suspense, lazy, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, Skeleton } from '../../ui';
import WorkspaceShell, { SeamChip } from '../WorkspaceShell';
import { bucketForPath, zoneForPath } from '../shellConfig';

const AdvisorAdvisoryWorkspace = lazy(() => import('../../pages/advisor/advisory/AdvisorAdvisoryWorkspace'));
const AdvisorExpertiseWorkspace = lazy(() => import('../../pages/advisor/AdvisorExpertiseWorkspace'));

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
 * COHORTS IS ENTIRELY NEW, and it is the one bucket that reads Spin-Out Lab
 * data. Read-only, both ways: it owns no Lab route, writes nothing back, and
 * every founder-sourced object on it carries the seam mark. There is no
 * advisor↔cohort assignment table in the product today, so it ships as an
 * honest empty rather than a board of plausible-looking founders.
 *
 * EXPERTISE ALREADY HAS A HOME at /office-hours, which renders
 * AdvisorExpertiseWorkspace for advisors. That component couples the profile
 * fields to a slot picker; the canvas splits them, putting booked sessions
 * under Practice·Sessions and reserving Expertise for profile, services,
 * proof, thinking and visibility. Which of those two readings wins is a
 * product decision that is still open, so every Expertise zone mounts the live
 * workspace and nothing here assumes either answer.
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

// Zones whose content is already live, and the component that serves them.
const LIVE = {
  '/practice': new Set(['opportunities', 'engagements', 'delivery']),
  '/expertise': new Set(['profile', 'services', 'proof', 'thinking', 'visibility']),
};

const COPY = {
  '/practice': {
    sessions: {
      heading: 'Booked sessions are not a surface yet',
      what: 'Every session on the calendar, who it is with, what was agreed, and what is owed for it.',
      why: 'Booking lives inside the Expertise workspace at /office-hours today, coupled to the profile rather than to the practice. Whether sessions belong here or there is the open question, and building a second booking surface before it is answered would guarantee two.',
      links: [{ to: '/office-hours', label: 'Where booking lives today →' }],
    },
    earnings: {
      heading: 'Earnings is not built yet',
      what: 'What the practice billed, what has been collected, and what is outstanding — per engagement and per session.',
      why: 'This is the zone that turns an advisory shell into a business, and it has no store at all: no session pricing, no paid booking, no payout record. It is the same gap tracked as the Advisory Practice integration.',
      links: [{ to: '/practice/engagements', label: 'Engagements →' }],
    },
  },
  '/cohorts': {
    founders: {
      heading: 'Cohort assignment does not exist yet',
      what: 'The founders in the batch you are assigned to — company, stage, one live signal each, and your own next action beside it.',
      why: 'Nothing in the product links an advisor to a cohort. The Lab knows its founders and the practice knows its clients; no table joins them. A board of founders drawn without that join would be a guess about who you advise.',
      seam: true,
      links: [{ to: '/practice/opportunities', label: 'Your actual client list →' }],
    },
    guidance: {
      heading: 'Cohort guidance has no store',
      what: 'The same guidance delivered to a whole batch, and which founders have acted on it.',
      why: 'It reads from the cohort assignment above, which does not exist. One gap, not two.',
      seam: true,
    },
    'this-week': {
      heading: 'The weekly view has nothing to aggregate',
      what: 'What is due from you across the whole batch this week, rather than per client.',
      why: 'Same dependency: without a cohort assignment there is no batch to aggregate over.',
      seam: true,
    },
    calendar: {
      heading: 'The cohort calendar is not built yet',
      what: 'The batch’s shared schedule — sessions, milestones and Lab dates in one place.',
      why: 'Lab milestone dates exist and are read-only to the practice; the advisor’s own slots exist under Expertise. Nothing joins them into one calendar.',
      seam: true,
    },
    outcomes: {
      heading: 'Outcomes are the Lab’s to record, and it does not expose them',
      what: 'How the batch ended — graduated, active, withdrawn — with the advisor’s own read alongside.',
      why: 'Outcome status is written by the Lab, never by the practice, which is exactly why this page can only ever read it. There is no read path today.',
      seam: true,
    },
  },
};

export default function AdvisorBucketRoutes() {
  const location = useLocation();
  const bucket = bucketForPath('advisor', location.pathname);
  const zone = zoneForPath(bucket, location.pathname);
  const prefix = bucket?.prefix;
  const slug = zone?.slug;

  const body = useMemo(() => {
    if (LIVE[prefix]?.has(slug)) {
      const Live = prefix === '/practice' ? AdvisorAdvisoryWorkspace : AdvisorExpertiseWorkspace;
      return <Suspense fallback={<Loading />}><Live /></Suspense>;
    }
    const copy = COPY[prefix]?.[slug];
    if (copy) return <NoStoreYet {...copy} />;
    return <NoStoreYet
      heading="Nothing here yet"
      what="This zone is named by the canvas and has no surface behind it."
      why="It ships empty rather than as a placeholder that could be mistaken for real data."
    />;
  }, [prefix, slug]);

  const INTRO = {
    '/practice': 'One practice. What is coming in, what is committed, and what has been delivered.',
    '/cohorts': 'One cohort at a time. Founder data comes from the Lab and is read-only to you.',
    '/expertise': 'How the market finds you, and what it finds when it does.',
  };

  return (
    <WorkspaceShell
      role="advisor"
      surface={bucket?.label?.toLowerCase()}
      scope={prefix === '/cohorts' ? 'One cohort' : 'One practice'}
      intro={INTRO[prefix]}
    >
      {body}
      {prefix === '/practice' && slug === 'opportunities' && (
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
