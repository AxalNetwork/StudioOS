// D953 (#2371) — Programs › Refer & Earn (PG9, PG9q, PG9s), from the reads
// that exist. This file is the routed page at `/admin/programs/refer-and-earn`
// (Overview), `/how-it-runs`, `/queue` and `/settings` (`guard(['admin'])` in
// App.jsx; `/admin/refer-earn` redirects to Queue with `?moved=refer-earn`)
// and board S9's file: its default export is one `AdminBoardFrame` named
// "Referrals", board S9's name, and the page sits in `ReferBody` inside it.
// Queue mounts the review console's body, never its default export, so the
// page has one rail. The three open statuses are read once, here, and are
// both Overview's total, the Queue tab's count and the Queue's default rows.
import React from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import AdminBoardFrame from '../AdminBoardFrame';
import { ReferralReviewBody } from '../ReferralReview';
import ProgramFrame from './ProgramFrame';
import { ReferTabs } from './ProgramTabs';
import { BlockFailed, Card, EYE, HowItRuns, Pill, Skeleton, SUB, Unread } from './parts';
import { useReferReads } from './useProgramReads';
import {
  BANDS, COULD_NOT_READ, HOW_IT_RUNS, NOT_READ_YET, OPEN_STATUSES, OPEN_WORDS, READING, STRATEGIC_INVITE_ONLY,
  STRATEGIC_NOT_READ, WHO_CAN_REFER, openReferrals, referralOverview, routeFor,
} from './programsModel';

const STATUS_WHAT = { submitted: 'The submitted referrals', under_review: 'The referrals under review', more_info_needed: 'The referrals waiting on the member' };

function WaitingForReview({ reads }) {
  const o = referralOverview(reads.sets, reads.glance, Date.now());
  return (
    <Card title="Waiting for review" meta={o.state === 'ready' ? o.totalText : o.state === 'unreadable' ? COULD_NOT_READ : READING} testId="programs-refer-waiting">
      <ul className="m-0 flex list-none flex-col p-0">
        {OPEN_STATUSES.map((s) => {
          const c = o.calls[s];
          return (
            <li key={s} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-700" data-testid={`programs-refer-status-${s}`}>
              <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{OPEN_WORDS[s]}</span>
              {c.state === 'ready' ? <span className="font-mono text-[13px] font-semibold text-axal-ink dark:text-gray-100">{c.text}</span> : null}
              {c.state === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{READING}</span> : null}
              {c.state === 'unreadable' ? <BlockFailed what={STATUS_WHAT[s]} onRetry={reads.reload} testId={`programs-refer-status-${s}-unreadable`} /> : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-1 border-t border-axal-hairline pt-2 dark:border-gray-700" data-testid="programs-refer-total">
        <span className={EYE}>Total</span>
        {o.state === 'ready' ? <span className="font-mono text-[20px] font-medium text-axal-ink dark:text-gray-100">{o.totalText}</span> : null}
        {o.state === 'loading' ? <Skeleton lines={1} /> : null}
        {o.state === 'unreadable' ? <span className={SUB}>No total is drawn while a status could not be read.</span> : null}
        {o.state === 'ready' ? (
          <span className={SUB} data-testid="programs-refer-bands">
            {`${BANDS.map((b) => `${b.label}: ${o.bands[b.key].toLocaleString('en-US')}`).join(' · ')}${o.bandsCover ? `, ${o.bandsCover}` : ''}`}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-axal-hairline pt-2 dark:border-gray-700" data-testid="programs-refer-oldest">
        {o.lane.state === 'ready' ? (
          <>
            <span className="text-[12.5px] text-axal-ink dark:text-gray-100">{o.oldest ? `Oldest: ${o.oldest} since submitted` : 'Oldest: none waiting'}</span>
            {o.overdue ? <Pill tone="amber" testId="programs-refer-overdue"><span aria-hidden="true">!</span>Overdue</Pill> : null}
          </>
        ) : null}
        {o.lane.state === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{READING}</span> : null}
        {o.lane.state === 'unreadable' ? (
          <span className="flex flex-col gap-0.5">
            <span role="alert" className="text-[12.5px] font-bold text-red-700 dark:text-red-300">{`Oldest and Overdue: ${COULD_NOT_READ}`}</span>
            <span className={SUB}>The Referrals lane on the Studio glance could not be read. The counts above still stand.</span>
            <button type="button" onClick={reads.reload} className="self-start text-[12px] font-semibold text-red-700 underline dark:text-red-300">Try again</button>
          </span>
        ) : null}
      </div>
    </Card>
  );
}

function ReferOverview({ reads }) {
  return (
    <div className="grid gap-3.5 lg:grid-cols-2" data-testid="programs-refer-overview">
      <WaitingForReview reads={reads} />
      <Card title="Strategic referral access" testId="programs-refer-strategic">
        <Unread word={NOT_READ_YET} reason={STRATEGIC_NOT_READ} />
        <p className={`m-0 ${SUB}`}>{STRATEGIC_INVITE_ONLY}</p>
      </Card>
    </div>
  );
}

function ReferSettings() {
  return (
    <Card title="Who can refer" meta="Read only" testId="programs-refer-settings">
      <p className="m-0 text-[13.5px] leading-relaxed text-axal-ink dark:text-gray-100">{WHO_CAN_REFER}</p>
    </Card>
  );
}

function ReferBody() {
  const { pathname } = useLocation();
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  const { tab } = routeFor(pathname);
  const reads = useReferReads(tab);
  const open = openReferrals(reads.sets);
  const queue = open.state === 'ready'
    ? { text: open.text, amber: open.rows.length > 0, title: open.capped ? 'The newest 200 in each open status' : 'Every open referral' }
    : null;
  return (
    <ProgramFrame program="refer-and-earn" superAdmin={superAdmin} tabs={<ReferTabs queue={queue} />}>
      {tab === 'overview' ? <ReferOverview reads={reads} /> : null}
      {tab === 'how' ? <HowItRuns sections={HOW_IT_RUNS['refer-and-earn']} superAdmin={superAdmin} testId="programs-refer-how" /> : null}
      {tab === 'queue' ? <ReferralReviewBody embedded open={{ sets: reads.sets, reload: reads.reload }} /> : null}
      {tab === 'settings' ? <ReferSettings /> : null}
    </ProgramFrame>
  );
}

// D774 (#2100): S9 drew no rail. The board's page, in the Admin boards' frame.
export default function ReferAndEarn() {
  return (
    <AdminBoardFrame workspace="Referrals" note="Eadwyn reads the program figures on this page. Nothing changes until you act." data-testid="admin-board-referrals">
      <ReferBody />
    </AdminBoardFrame>
  );
}
