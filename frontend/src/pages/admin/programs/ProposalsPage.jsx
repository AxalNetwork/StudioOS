// D964 (#2797, Programs part 11) — `/admin/programs/proposals`, the routed
// page behind HQ's Proposals tab (PG2, dc:365-369), under `guard(['admin'])`
// and never `hqOnly` (S1-NOTICE).
//   · A Super Admin gets the catalogue's header and tab strip with Proposals
//     lit, and Proposals from studios.
//   · An Admin gets PG19b (dc:489) in the page: "Only HQ decides on
//     proposals." with "Back to Programs". It is not `hqOnly`'s
//     SuperAdminOnlyNotice, whose words and door are not the canvas's.
// `ProgramsTabs` is the strip "Catalogue · Proposals [n]" both pages draw for a
// Super Admin; its count is the proposals sent to HQ, amber, from the queue's
// own `counts`, and a failed read says so in place of a number.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { programProposalsApi } from '../../../lib/api/programProposals';
import AdminBoardFrame from '../AdminBoardFrame';
import { SUB } from './parts';
import { ProposalsFromStudios } from './ProposalTables';
import { ONLY_HQ, YOURS_UNDER_PROGRAMS, waitingCount } from './proposalsModel';
import { LINE_SUPER, TITLE } from './programsModel';

const TAB = 'inline-flex min-h-[36px] items-center gap-1.5 border-b-2 px-1 text-[13.5px] font-bold';
const tabClass = ({ isActive }) => `${TAB} ${isActive ? 'border-axal-violet text-axal-ink dark:border-violet-400 dark:text-gray-100' : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`;

/** The proposals sent to HQ, for the tab's count: `{ state, count, reload }`. */
export function useWaitingProposals(enabled) {
  const [read, setRead] = useState({ state: enabled ? 'loading' : 'off', count: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    programProposalsApi.queue({ status: 'sent' }).then(
      (d) => { if (live) setRead({ state: 'ready', count: waitingCount(d) }); },
      () => { if (live) setRead({ state: 'unreadable', count: null }); },
    );
    return () => { live = false; };
  }, [enabled, tick]);
  return { ...read, reload: useCallback(() => setTick((t) => t + 1), []) };
}

export function ProgramsTabs({ waiting }) {
  let badge = null;
  if (waiting.state === 'ready' && waiting.count > 0) {
    badge = <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 font-mono text-[11px] font-bold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="programs-tab-proposals-count">{waiting.count.toLocaleString('en-US')}</span>;
  } else if (waiting.state === 'unreadable') {
    badge = <span className="text-[11.5px] font-semibold text-red-700 dark:text-red-300" data-testid="programs-tab-proposals-count">count could not be read</span>;
  }
  return (
    <nav aria-label="Programs" className="flex gap-5 border-b border-axal-hairline dark:border-gray-700" data-testid="programs-tabs">
      <NavLink to="/admin/programs" end className={tabClass} data-testid="programs-tab-catalogue">Catalogue</NavLink>
      <NavLink to="/admin/programs/proposals" className={tabClass} data-testid="programs-tab-proposals">Proposals{badge}</NavLink>
    </nav>
  );
}

/** PG19b: an Admin at HQ's proposals address. */
function OnlyHq() {
  return (
    <div className="mx-auto mt-24 flex max-w-[520px] flex-col items-center gap-2 px-4 text-center" data-testid="programs-proposals-only-hq">
      <span aria-hidden="true" className="text-[28px] text-axal-muted dark:text-gray-400">⊘</span>
      <h1 className="m-0 text-[20px] font-extrabold text-axal-ink dark:text-gray-100">{ONLY_HQ}</h1>
      <p className={`m-0 ${SUB}`}>{YOURS_UNDER_PROGRAMS}</p>
      <Link to="/admin/programs" className="mt-2 inline-flex min-h-[36px] items-center rounded-[9px] bg-axal-violet px-3.5 text-[13px] font-bold text-white dark:bg-violet-600" data-testid="programs-proposals-back">Back to Programs</Link>
    </div>
  );
}

function ProposalsBody() {
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  const waiting = useWaitingProposals(superAdmin);
  if (!superAdmin) return <OnlyHq />;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-24 pt-6 sm:px-6 lg:pb-10" data-testid="programs-proposals">
      <header className="flex min-w-0 flex-col gap-[7px]">
        <h1 className="m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] text-axal-ink dark:text-gray-100">{TITLE}</h1>
        <p className="m-0 text-[13.5px] leading-normal text-axal-muted dark:text-gray-400">{LINE_SUPER}</p>
      </header>
      <ProgramsTabs waiting={waiting} />
      <ProposalsFromStudios onDecided={waiting.reload} />
    </div>
  );
}

export default function ProposalsPage() {
  return (
    <AdminBoardFrame workspace="Programs" note="Nothing on this page changes until you decide a proposal." data-testid="admin-board-proposals">
      <ProposalsBody />
    </AdminBoardFrame>
  );
}
