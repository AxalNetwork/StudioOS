import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../ui';
import HeldZone from './HeldZone';

/**
 * Admin · Approvals on HQ-held accounts — S22's sixteen lanes (D286).
 *
 * SIXTEEN LITERAL ROWS, NOT A MAP. `admin_route_reachability.test.mjs` walks
 * navigation syntax — a literal `to="/…"` in a routed page's own file — and
 * a `.map` over a data array is not a door it can see. Five of the routes
 * below (LP applications, Referrals, Best-Fit, Due diligence, Partner
 * invitations) have this page as their only door once the legacy admin rows
 * are gone, so the rows are written out. The guard
 * (`held_admin_shell_d286.test.mjs`) reads them back and holds them to S22.
 *
 * THIS PAGE READS NOTHING. The branch board (`BranchApprovals`, D130) unions
 * eleven queues from one branch database; HQ's own queues are decided in
 * their consoles, and each row here links to that console. S22's "State
 * here" column is drawn verbatim: two lanes have no link, and each says why.
 *
 * SPINOUT MODERATION LINKS NOWHERE, and that is S22's finding, not a gap
 * this page leaves: the worker mounts the route and `approvalSources.ts`
 * carries the lane, but no page in the SPA calls `adminSpinoutModeration`.
 * "No console exists anywhere yet" is true of the SPA. Giving the lane a
 * link here would be a door onto nothing.
 */
const KIND = 'text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-muted';
const LANE = 'text-[12.5px] font-semibold text-axal-ink';
const CONSOLE = 'font-semibold text-axal-ink underline underline-offset-2';
const STATE = 'text-[11.5px] text-axal-muted';

export default function HeldApprovals() {
  return (
    <HeldZone
      workspace="Approvals"
      stance="Sixteen lanes, each linking to its own console"
      coverage={['Sixteen lanes on this page, read from S22, none counted here']}
      coverageNote="Counts live in each lane's console; this page draws the lanes and links to them."
      unavailable={[
        ['A unioned board', 'The branch board (D130) reads one branch database; HQ-held queues are decided in their own consoles.'],
        ['Spinout moderation', 'No console exists anywhere yet: the worker route is mounted and nothing in the SPA calls it.'],
        ['Content to HQ', 'Not applicable to HQ-held accounts: there is no branch to raise content from.'],
      ]}
    >
      <h1 className="text-[18px] font-extrabold tracking-tight text-axal-ink">Approvals</h1>
      <p className="mt-1 text-[12.5px] text-axal-muted">
        Sixteen lanes, each linking to its own console. The lanes and their routes are S22’s.
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
            <tr data-lane="1"><td className={`px-3 py-2 ${STATE}`}>1</td><td className={`px-3 py-2 ${KIND}`}>Core</td><td className={`px-3 py-2 ${LANE}`}>LP applications</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/lp-applications" className={CONSOLE}>/admin/lp-applications</Link></td><td className={`px-3 py-2 ${STATE}`}>Links to its console</td></tr>
            <tr data-lane="2"><td className={`px-3 py-2 ${STATE}`}>2</td><td className={`px-3 py-2 ${KIND}`}>Core</td><td className={`px-3 py-2 ${LANE}`}>Referrals</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/refer-earn" className={CONSOLE}>/admin/refer-earn</Link></td><td className={`px-3 py-2 ${STATE}`}>Links to its console</td></tr>
            <tr data-lane="3"><td className={`px-3 py-2 ${STATE}`}>3</td><td className={`px-3 py-2 ${KIND}`}>Core</td><td className={`px-3 py-2 ${LANE}`}>Cohort applications</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/spinout-lab" className={CONSOLE}>/admin/spinout-lab</Link></td><td className={`px-3 py-2 ${STATE}`}>Links to its console</td></tr>
            <tr data-lane="4"><td className={`px-3 py-2 ${STATE}`}>4</td><td className={`px-3 py-2 ${KIND}`}>Core</td><td className={`px-3 py-2 ${LANE}`}>Spinout moderation</td><td className={`px-3 py-2 ${STATE}`}>No console</td><td className={`px-3 py-2 ${STATE}`}>No console exists anywhere yet</td></tr>
            <tr data-lane="5"><td className={`px-3 py-2 ${STATE}`}>5</td><td className={`px-3 py-2 ${KIND}`}>Core</td><td className={`px-3 py-2 ${LANE}`}>Content to HQ</td><td className={`px-3 py-2 ${STATE}`}>None</td><td className={`px-3 py-2 ${STATE}`}>Not applicable to HQ-held accounts</td></tr>
            <tr data-lane="6"><td className={`px-3 py-2 ${STATE}`}>6</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>KYC</td><td className="px-3 py-2 text-[12px]"><Link to="/admin?tab=kyc" className={CONSOLE}>/admin?tab=kyc</Link></td><td className={`px-3 py-2 ${STATE}`}>Links to its console</td></tr>
            <tr data-lane="7"><td className={`px-3 py-2 ${STATE}`}>7</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Partner profiles</td><td className="px-3 py-2 text-[12px]"><Link to="/admin?tab=profiles" className={CONSOLE}>/admin?tab=profiles</Link></td><td className={`px-3 py-2 ${STATE}`}>Links to its console</td></tr>
            <tr data-lane="8"><td className={`px-3 py-2 ${STATE}`}>8</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Directory</td><td className="px-3 py-2 text-[12px]"><Link to="/admin?tab=directory" className={CONSOLE}>/admin?tab=directory</Link></td><td className={`px-3 py-2 ${STATE}`}>Links to its console</td></tr>
            <tr data-lane="9"><td className={`px-3 py-2 ${STATE}`}>9</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Exploring</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/exploring" className={CONSOLE}>/admin/exploring</Link></td><td className={`px-3 py-2 ${STATE}`}>Links to its console</td></tr>
            <tr data-lane="10"><td className={`px-3 py-2 ${STATE}`}>10</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Jobs</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/jobs" className={CONSOLE}>/admin/jobs</Link></td><td className={`px-3 py-2 ${STATE}`}>Links to its console</td></tr>
            <tr data-lane="11"><td className={`px-3 py-2 ${STATE}`}>11</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Events</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/events" className={CONSOLE}>/admin/events</Link></td><td className={`px-3 py-2 ${STATE}`}>Links to its console</td></tr>
            <tr data-lane="12"><td className={`px-3 py-2 ${STATE}`}>12</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Circles</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/circles" className={CONSOLE}>/admin/circles</Link></td><td className={`px-3 py-2 ${STATE}`}>Links to its console</td></tr>
            <tr data-lane="13"><td className={`px-3 py-2 ${STATE}`}>13</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Partner invitations</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/partners" className={CONSOLE}>/admin/partners</Link></td><td className={`px-3 py-2 ${STATE}`}>Links to its console</td></tr>
            <tr data-lane="14"><td className={`px-3 py-2 ${STATE}`}>14</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Best-Fit</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/best-fit" className={CONSOLE}>/admin/best-fit</Link></td><td className={`px-3 py-2 ${STATE}`}>Links to its console</td></tr>
            <tr data-lane="15"><td className={`px-3 py-2 ${STATE}`}>15</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Due diligence</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/due-diligence" className={CONSOLE}>/admin/due-diligence</Link></td><td className={`px-3 py-2 ${STATE}`}>Links to its console</td></tr>
            <tr data-lane="16"><td className={`px-3 py-2 ${STATE}`}>16</td><td className={`px-3 py-2 ${KIND}`}>Absorbed</td><td className={`px-3 py-2 ${LANE}`}>Advisor cohort access</td><td className="px-3 py-2 text-[12px]"><Link to="/admin/advisor-cohorts" className={CONSOLE}>/admin/advisor-cohorts</Link></td><td className={`px-3 py-2 ${STATE}`}>Links to its console</td></tr>
          </tbody>
        </table>
      </Card>
    </HeldZone>
  );
}
