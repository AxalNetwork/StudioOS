/**
 * D5882 (#5882): every door Approvals opens, moved out of AdminApprovals.jsx unchanged: `LaneDoor`, `HqDoor`, the Best-Fit item door and the dressed door. Each is a literal link, because the reachability walk (admin_route_reachability) reads navigation syntax.
 */
import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { HQ_LANES } from './approvalsModel';
import { reviewDestination } from './inboxModel';
import { LINK, SUB } from './approvalsUi';

/** The page that decides a lane, as a literal link (see the header comment). */
export function LaneDoor({ k }) {
  switch (k) {
    case 'kyc': case 'kyb': return <Link to="/admin/kyc" className={LINK}>KYC & KYB</Link>;
    case 'partner_profiles': return <Link to="/admin/partner-profiles" className={LINK}>Partner profiles</Link>;
    case 'exploring': return <Link to="/admin/exploring" className={LINK}>Exploring board</Link>;
    case 'product_testers': return <Link to="/admin/approvals/product-testers" className={LINK}>Product testers</Link>;
    case 'lp': return <Link to="/admin/lp-applications" className={LINK}>LP applications</Link>;
    case 'cohort': return <Link to="/admin/programs/spinout-lab/applications" className={LINK}>Spin-Out Lab</Link>;
    case 'lab_hosts': return <Link to="/admin/programs/spinout-lab/hosts" className={LINK}>Spin-Out Lab › Hosts</Link>;
    case 'moderation': return <Link to="/admin/spinout-moderation" className={LINK}>Spin-Out moderation</Link>;
    case 'referrals': return <Link to="/admin/programs/refer-and-earn/queue" className={LINK}>Refer & Earn › Queue</Link>;
    case 'strategic_access': return <Link to="/admin/programs/refer-and-earn" className={LINK}>Refer & Earn</Link>;
    case 'perk_listings': return <Link to="/admin/programs/perks" className={LINK}>Perks</Link>;
    // D5885: Best-Fit is decided on its own board here.
    case 'best_fit': return <Link to="/admin/approvals/best-fit" className={LINK}>Best-Fit</Link>;
    case 'events': return <Link to="/admin/events/review" className={LINK}>Events › Review</Link>;
    case 'jobs': return <Link to="/admin/jobs" className={LINK}>Jobs</Link>;
    case 'wellbeing_experts': return <Link to="/admin/approvals/wellbeing-experts" className={LINK}>Wellbeing experts</Link>;
    case 'comarketing': return <Link to="/admin/approvals/co-marketing" className={LINK}>Co-marketing</Link>;
    case 'articles': return <Link to="/admin/articles" className={LINK}>Content queue</Link>;
    case 'due_diligence': return <Link to="/admin/due-diligence" className={LINK}>Due diligence</Link>;
    case 'score_flags': return <Link to="/monitoring" className={LINK}>Monitoring</Link>;
    default: return <span className={SUB}>Not recorded</span>;
  }
}

/** HQ's own queue pages (APR9), literal; a page not built yet says so. */
export function HqDoor({ lane }) {
  switch (lane.key) {
    case 'testing_programs': return <Link to="/admin/platform/product-testing" className={LINK}>Platform › Product testing</Link>;
    case 'learning': return <Link to="/learning/studio" className={LINK}>Learning studio</Link>;
    case 'tickets': return <Link to="/hq/review" className={LINK}>HQ review</Link>;
    case 'payouts': return <Link to="/admin/commissions" className={LINK}>Commissions</Link>;
    case 'ai_runs': return <Link to="/admin/platform/allowances" className={LINK}>Platform › AI allowances</Link>;
    case 'notices': return <Link to="/admin/licences" className={LINK}>Licences</Link>;
    case 'support': return <Link to="/admin/hq-support" className={LINK}>Support</Link>;
    case 'proposals': return <Link to="/admin/programs/proposals" className={LINK}>Programs › Proposals</Link>;
    case 'grants': return <Link to="/admin/licences/programs/requests" className={LINK}>Licences › Program access by licence › Requests</Link>;
    // D6698: no HQ case page yet. Cases are read and assigned in this lane; case actions are recorded in Formation.
    case 'formation_cases': return <span className={SUB}>Read and assign here</span>;
    default: return <span className={SUB}>{lane.waits}</span>;
  }
}

/** Either door for a lane key: the studio's lanes, or HQ's for a Super Admin. */
export function DoorFor({ lane }) {
  const hq = HQ_LANES.find((l) => l.key === lane);
  return hq ? <HqDoor lane={hq} /> : <LaneDoor k={lane} />;
}

/** D5885: a Best-Fit item opens on its board, at its own address (a literal template). */
export function BestFitItemDoor({ id }) {
  return <Link to={`/admin/approvals/best-fit/${id}`} className={LINK}>Best-Fit</Link>;
}

/**
 * D4814: a lane's door dressed as a button or a list action — "Continue
 * review in KYC & KYB →", "Open in Due diligence ↗". The door itself stays the
 * literal link above (the reachability walk and the lane tests read those
 * lines); the words go around it and the link is stretched over the whole
 * control, so all of it is the target. A lane with no page to open (Best-Fit,
 * an HQ page not built yet) is plain words, never a control that goes nowhere.
 */
export function DressedDoor({ lane, itemId = null, before, after, className, plain, testId }) {
  const dest = reviewDestination(lane);
  const box = useRef(null);
  // The link's own text is the lane alone; its name is the whole control ("Open in KYC & KYB").
  useEffect(() => {
    const a = box.current?.querySelector?.('a');
    if (a && before) a.setAttribute('aria-label', `${before}${a.textContent}`);
  }, [before, lane]);
  if (/no review page yet|not built yet|^its own page$/.test(dest)) return <span className={plain} data-testid={testId}>{dest}</span>;
  return (
    <span ref={box} data-testid={testId}
      className={`relative ${className} [&_a]:font-[inherit] [&_a]:text-inherit [&_a]:after:absolute [&_a]:after:inset-0 [&_a]:after:content-[''] [&_a]:focus-visible:outline-none focus-within:ring-2 focus-within:ring-axal-violet`}>
      <span>{before}{lane === 'best_fit' && itemId != null ? <BestFitItemDoor id={itemId} /> : <DoorFor lane={lane} />}{after}</span>
    </span>
  );
}
