import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../ui';
import HeldZone from './HeldZone';
import { Unreadable, Unrecorded } from '../../ui';
import { GLANCE_UNREADABLE, laneOf, useHeldGlance } from './heldFigures';

/**
 * Admin · Approvals on HQ-held accounts — S22's sixteen lanes (D286).
 *
 * SIXTEEN LANES, FIFTEEN LITERAL ROWS WITH A DOOR, NOT A MAP.
 * `admin_route_reachability.test.mjs` walks navigation syntax — a literal
 * `to="/…"` in a routed page's own file — and a `.map` over a data array is
 * not a door it can see. Four of the routes below (LP applications, Best-Fit,
 * Due diligence, Spinout moderation on HQ) have this page as their only door
 * once the legacy admin rows are gone, so the rows are written out. Partner
 * invitations (lane 13) is a door to a page Community also opens (D923), and
 * Referrals (lane 2) and Advisor cohort access (lane 16) open their pages
 * under Programs, Refer & Earn › Queue and Mentor cohort access › People
 * (D953). The guard (`held_admin_shell_d286.test.mjs`) reads them back and
 * holds them to S22.
 *
 * THE STATE COLUMN IS READ (D555). Each lane's "State here" is its pending
 * count and oldest age from the Studio glance, counted with the console's own
 * predicate (`laneCounts`), or "Unreadable" when that lane's read failed, or
 * "No queue" with the reason for a lane with no pending notion. Each row still
 * links to the console that decides it. Content to HQ does not apply.
 *
 * SPINOUT MODERATION LINKS ITS CONSOLE (D506). S22 drew the lane with no
 * console because none existed in the SPA; D442 built the console at
 * `/admin/spinout-moderation` and linked it from the branch Approvals board,
 * which left HQ-held accounts reaching held cases only by typing the URL.
 * Lane 4 is now that door. The route is `guard(['admin'])` with no `hqOnly`,
 * so both HQ-held shells open it, as they do every other lane here.
 */
const KIND = 'text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-muted';
const LANE = 'text-[12.5px] font-semibold text-axal-ink';
const CONSOLE = 'font-semibold text-axal-ink underline underline-offset-2';
const STATE = 'text-[11.5px] text-axal-muted';

/** One lane's "State here": pending and oldest age, Unreadable, or No queue. */
export function LaneState({ glance, laneKey, noQueue }) {
  if (glance.status === 'loading') return <>Reading…</>;
  if (glance.status === 'unreadable') return <Unreadable what="This lane" claim={GLANCE_UNREADABLE} />;
  if (noQueue) {
    const reason = glance.hq?.approvals?.noQueue?.find((n) => n.label === noQueue)?.reason;
    return <Unrecorded reason={reason || 'This lane has no pending queue.'}>No queue</Unrecorded>;
  }
  const lane = laneOf(glance.hq, laneKey);
  if (!lane) return <Unrecorded reason="This lane was not on the Studio glance.">Not recorded</Unrecorded>;
  if (lane.count === null) return <Unreadable what={lane.label} claim={lane.reason || 'That is not the same as nothing pending.'} />;
  if (lane.count === 0) return <span data-testid={`lane-state-${laneKey}`}>0 pending</span>;
  return <span data-testid={`lane-state-${laneKey}`}><b className="tabular-nums text-axal-ink">{lane.count.toLocaleString('en-US')}</b> pending · oldest {lane.age || 'undated'}</span>;
}

export default function HeldApprovals() {
  const glance = useHeldGlance();
  const ap = glance.hq?.approvals;
  const total = ap?.kind === 'ready' ? ap.total : undefined;
  return (
    <HeldZone
      workspace="Approvals"
      stance="Sixteen lanes, each with its pending count and console"
      coverage={[total === undefined ? 'Sixteen lanes on this page' : total === null ? 'A lane could not be read, so there is no total' : `${total.toLocaleString('en-US')} pending across the laned queues`]}
      coverageNote="Each count uses the predicate its console lists pending items with (D555). The lanes with no pending notion say so."
      unavailable={[
        ['Content to HQ', 'Not applicable to HQ-held accounts: there is no branch to raise content from.'],
      ]}
    >
      <h1 className="text-[18px] font-extrabold tracking-tight text-axal-ink">Approvals</h1>
      <p className="mt-1 text-[12.5px] text-axal-muted">
        Sixteen lanes, each with what is pending and how long the oldest has waited, linking to its console. The lanes and their routes are S22’s.
      </p>
      <Card className="mt-3 overflow-x-auto p-0">
        <table className="w-full text-left" data-testid="held-approvals-lanes">
          <thead>
            <tr className="border-b border-axal-hairline">
              <th className={`px-3 py-2 ${KIND}`}>#</th>
              <th className={`px-3 py-2 ${KIND}`}>Kind</th>
              <th className={`px-3 py-2 ${KIND}`}>Lane</th>
              <th className={`px-3 py-2 ${KIND}`}>Console</th>
              <th className={`px-3 py-2 ${KIND}`}>State here</th>
            </tr>
          </thead>
          <tbody>
            <tr data-lane="1"><td className={`px-3 py-2 ${STATE}`}>1</td><td className={`px-3 py-2 ${KIND}`}>Core</td><td className={`px-3 py-2 ${LANE}`}>LP applications</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/lp-applications" className={CONSOLE}>/admin/lp-applications</Link></td><td className={`px-3 py-2 ${STATE}`}><LaneState glance={glance} laneKey="lp" /></td></tr>
            <tr data-lane="2"><td className={`px-3 py-2 ${STATE}`}>2</td><td className={`px-3 py-2 ${KIND}`}>Core</td><td className={`px-3 py-2 ${LANE}`}>Referrals</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/programs/refer-and-earn/queue" className={CONSOLE}>/admin/programs/refer-and-earn/queue</Link></td><td className={`px-3 py-2 ${STATE}`}><LaneState glance={glance} laneKey="referrals" /></td></tr>
            <tr data-lane="3"><td className={`px-3 py-2 ${STATE}`}>3</td><td className={`px-3 py-2 ${KIND}`}>Core</td><td className={`px-3 py-2 ${LANE}`}>Cohort applications</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/spinout-lab" className={CONSOLE}>/admin/spinout-lab</Link></td><td className={`px-3 py-2 ${STATE}`}><LaneState glance={glance} laneKey="cohort" /></td></tr>
            <tr data-lane="4"><td className={`px-3 py-2 ${STATE}`}>4</td><td className={`px-3 py-2 ${KIND}`}>Core</td><td className={`px-3 py-2 ${LANE}`}>Spinout moderation</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/spinout-moderation" className={CONSOLE}>/admin/spinout-moderation</Link></td><td className={`px-3 py-2 ${STATE}`}><LaneState glance={glance} laneKey="moderation" /></td></tr>
            <tr data-lane="5"><td className={`px-3 py-2 ${STATE}`}>5</td><td className={`px-3 py-2 ${KIND}`}>Core</td><td className={`px-3 py-2 ${LANE}`}>Content to HQ</td><td className={`px-3 py-2 ${STATE}`}>None</td><td className={`px-3 py-2 ${STATE}`}>Not applicable to HQ-held accounts</td></tr>
            <tr data-lane="6"><td className={`px-3 py-2 ${STATE}`}>6</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>KYC</td><td className="px-3 py-2 text-[12px]"><Link to="/admin?tab=kyc" className={CONSOLE}>/admin?tab=kyc</Link></td><td className={`px-3 py-2 ${STATE}`}><LaneState glance={glance} laneKey="kyc" /></td></tr>
            <tr data-lane="7"><td className={`px-3 py-2 ${STATE}`}>7</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Partner profiles</td><td className="px-3 py-2 text-[12px]"><Link to="/admin?tab=profiles" className={CONSOLE}>/admin?tab=profiles</Link></td><td className={`px-3 py-2 ${STATE}`}><LaneState glance={glance} laneKey="partner_profiles" /></td></tr>
            <tr data-lane="8"><td className={`px-3 py-2 ${STATE}`}>8</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Directory</td><td className="px-3 py-2 text-[12px]"><Link to="/admin?tab=directory" className={CONSOLE}>/admin?tab=directory</Link></td><td className={`px-3 py-2 ${STATE}`}><LaneState glance={glance} noQueue="Directory" /></td></tr>
            <tr data-lane="9"><td className={`px-3 py-2 ${STATE}`}>9</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Exploring</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/exploring" className={CONSOLE}>/admin/exploring</Link></td><td className={`px-3 py-2 ${STATE}`}><LaneState glance={glance} laneKey="exploring" /></td></tr>
            <tr data-lane="10"><td className={`px-3 py-2 ${STATE}`}>10</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Jobs</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/jobs" className={CONSOLE}>/admin/jobs</Link></td><td className={`px-3 py-2 ${STATE}`}><LaneState glance={glance} laneKey="jobs" /></td></tr>
            <tr data-lane="11"><td className={`px-3 py-2 ${STATE}`}>11</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Events</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/events" className={CONSOLE}>/admin/events</Link></td><td className={`px-3 py-2 ${STATE}`}><LaneState glance={glance} laneKey="events" /></td></tr>
            <tr data-lane="12"><td className={`px-3 py-2 ${STATE}`}>12</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Circles</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/circles" className={CONSOLE}>/admin/circles</Link></td><td className={`px-3 py-2 ${STATE}`}><LaneState glance={glance} noQueue="Circles" /></td></tr>
            <tr data-lane="13"><td className={`px-3 py-2 ${STATE}`}>13</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Partner invitations</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/partner-invitations" className={CONSOLE}>/admin/partner-invitations</Link></td><td className={`px-3 py-2 ${STATE}`}><LaneState glance={glance} noQueue="Partner invitations" /></td></tr>
            <tr data-lane="14"><td className={`px-3 py-2 ${STATE}`}>14</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Best-Fit</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/best-fit" className={CONSOLE}>/admin/best-fit</Link></td><td className={`px-3 py-2 ${STATE}`}><LaneState glance={glance} laneKey="best_fit" /></td></tr>
            <tr data-lane="15"><td className={`px-3 py-2 ${STATE}`}>15</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Due diligence</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/due-diligence" className={CONSOLE}>/admin/due-diligence</Link></td><td className={`px-3 py-2 ${STATE}`}><LaneState glance={glance} laneKey="due_diligence" /></td></tr>
            <tr data-lane="16"><td className={`px-3 py-2 ${STATE}`}>16</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Advisor cohort access</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/programs/mentor-cohorts/people" className={CONSOLE}>/admin/programs/mentor-cohorts/people</Link></td><td className={`px-3 py-2 ${STATE}`}><LaneState glance={glance} noQueue="Advisor cohort access" /></td></tr>
          </tbody>
        </table>
      </Card>
    </HeldZone>
  );
}
