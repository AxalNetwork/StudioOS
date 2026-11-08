// D4808 (#4808) — the generic, registry-backed program page: `/admin/programs/:key` for any key the registry holds,
// with no route of its own for that key. One shell for every program that has no bespoke page: its registry row (metadata,
// availability), the exact proposal it was approved from, the capabilities that proposal declared, its playbook (How it
// runs) and its Activity. Create → open → edit → publish → revisit works on it: a Super Admin edits the draft and
// publishes it on How it runs, as on the nine.
//
// A program-specific operating screen is an optional module, not an assumption: where the frontend knows one for the key
// (`PAGES`), the page links to it; for any other key it says none exists yet.
import React from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { actionPrimary } from '../../../ui';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import AdminBoardFrame from '../AdminBoardFrame';
import ActivityTab from './ActivityTab';
import PlaybookEditor, { useProgramDetail } from './PlaybookEditor';
import ProgramFrame from './ProgramFrame';
import { BlockFailed, CARD, GrantBadge, H2, Pill, SUB, Skeleton } from './parts';
import { STATUS_WORD } from './catalogueModel';
import { NOT_RECORDED, PAGES, grantBadgeOf, isFailed, isLoading, isReady } from './programsModel';
import {
  NOT_OPERATIONAL_WORD, NOT_SET, NO_CAPABILITIES, NO_OPERATING_SCREEN, NO_PROPOSAL, approvedRows, capabilityRows,
  genericKeyFrom, genericTabFrom, metadataRows, notOperationalLine, programHref, readProblem,
} from './genericProgramModel';

const DT = 'text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';
const DD = 'm-0 text-[13.5px] text-axal-ink dark:text-gray-100';

function Rows({ rows, testId, mark = false }) {
  return (
    <dl className="m-0 grid gap-x-6 gap-y-3 sm:grid-cols-2" data-testid={testId}>
      {rows.map((r) => (
        <div key={r.key} className="flex min-w-0 flex-col gap-0.5" data-testid={`${testId}-${r.key}`}>
          <dt className={DT}>{r.label}</dt>
          <dd className={DD}>
            {r.value === null || r.value === undefined ? <span className="text-axal-muted dark:text-gray-400">{NOT_SET}</span> : <span className="whitespace-pre-line">{r.value}</span>}
            {mark && r.operational === false && r.value !== null && r.value !== undefined
              ? <span className="ml-2"><Pill tone="muted" testId={`${testId}-${r.key}-marker`}>{NOT_OPERATIONAL_WORD}</Pill></span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Tabs({ programKey }) {
  const tab = ({ isActive }) => `-mb-px inline-flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-0.5 text-[13px] lg:min-h-[40px] ${isActive
    ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
    : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`;
  return (
    <nav aria-label="Program" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]" data-testid="programs-tabs">
      <div className="flex gap-[22px] border-b border-axal-hairline dark:border-gray-700">
        {/* Literal template heads, so the reachability walk reads each tab as a door onto this one registry-backed page. */}
        <NavLink to={`/admin/programs/${programKey}`} end className={tab} data-testid="programs-tab-overview">Overview</NavLink>
        <NavLink to={`/admin/programs/${programKey}/how-it-runs`} end className={tab} data-testid="programs-tab-how">How it runs</NavLink>
        <NavLink to={`/admin/programs/${programKey}/activity`} end className={tab} data-testid="programs-tab-activity">Activity</NavLink>
      </div>
    </nav>
  );
}

/** The shell's Overview: metadata, availability, the approved proposal, declared capabilities, operating screens. */
function Overview({ programKey, detail }) {
  const data = detail.read.data;
  const grant = grantBadgeOf(data.grant);
  const caps = capabilityRows(data.capabilities);
  const approved = data.approved_proposal;
  const known = PAGES[programKey];
  return (
    <div className="flex flex-col gap-4" data-testid="programs-generic-overview">
      <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} data-testid="programs-generic-metadata">
        <h2 className={H2}>About</h2>
        <Rows rows={metadataRows(data.program)} testId="programs-generic-meta" />
      </section>

      <section className={`${CARD} flex flex-col gap-2 px-[18px] py-4`} data-testid="programs-generic-availability">
        <h2 className={H2}>Availability</h2>
        <div className="flex flex-wrap items-center gap-2"><GrantBadge grant={null} badge={grant} testId="programs-generic-grant" /></div>
        {data.grantable === true ? <p className={`m-0 ${SUB}`}>This program can be offered to studios.</p> : null}
        {data.grantable === false ? <p className={`m-0 ${SUB}`}>This program is not switched on to be offered to studios.</p> : null}
        {data.grantable === null || data.grantable === undefined ? <p className={`m-0 ${SUB}`}>Whether it can be offered to studios could not be read.</p> : null}
      </section>

      <section className={`${CARD} flex flex-col gap-2 px-[18px] py-4`} data-testid="programs-generic-capabilities">
        <h2 className={H2}>Declared capabilities</h2>
        {caps.length ? (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {caps.map((c) => (
              <li key={c.key} data-testid={`programs-generic-cap-${c.key}`}>
                <Pill tone={c.operational ? 'green' : 'muted'}>{c.label}{c.operational ? '' : ` · ${NOT_OPERATIONAL_WORD}`}</Pill>
              </li>
            ))}
          </ul>
        ) : <p className={`m-0 ${SUB}`}>{NO_CAPABILITIES}</p>}
        <p className={`m-0 ${SUB}`} data-testid="programs-generic-screens">
          {known ? <>Operating screen: <Link to={`/admin/programs/${programKey}`} className="font-bold text-axal-violet underline dark:text-violet-300">{known.title}</Link></> : NO_OPERATING_SCREEN}
        </p>
      </section>

      <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} data-testid="programs-generic-approved">
        <h2 className={H2}>Approved proposal</h2>
        {approved ? (
          <>
            <p className={`m-0 ${SUB}`}>
              {`Approved ${approved.decision === 'studio' ? 'for one studio' : 'for the catalogue'} on ${String(approved.decided_at || '').slice(0, 10) || NOT_RECORDED}. This is the proposal exactly as it was approved.`}
              {' '}<Link to={`/admin/programs/proposals/${approved.proposal_uid}`} className="font-bold text-axal-violet underline dark:text-violet-300" data-testid="programs-generic-approved-link">Open the proposal</Link>
            </p>
            <Rows rows={approvedRows(approved)} testId="programs-generic-spec" mark />
            <p className={`m-0 ${SUB}`} data-testid="programs-generic-spec-foot">{notOperationalLine(approved.spec)}</p>
          </>
        ) : <p className={`m-0 ${SUB}`}>{NO_PROPOSAL}</p>}
      </section>
    </div>
  );
}

function Body() {
  const { pathname } = useLocation();
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  const programKey = genericKeyFrom(pathname);
  const tab = genericTabFrom(pathname);
  const detail = useProgramDetail(programKey || '__none__', Boolean(programKey));
  const read = detail.read;

  if (!programKey) return null;
  if (isLoading(read)) {
    return <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6"><Skeleton lines={5} testId="programs-generic-loading" /></div>;
  }
  if (isFailed(read)) {
    const problem = readProblem(read.error);
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 pt-6 sm:px-6" data-testid="programs-generic-problem">
        <h1 className="m-0 text-[20px] font-extrabold text-axal-ink dark:text-gray-100">{problem.kind === 'unknown' ? 'No such program' : 'This program could not be read'}</h1>
        {problem.kind === 'unknown'
          ? <p className={`m-0 ${SUB}`}>{problem.sentence}</p>
          : <BlockFailed what="This program" onRetry={detail.reload} testId="programs-generic-failed" />}
        <Link to="/admin/programs" className={`${actionPrimary} self-start`} data-testid="programs-generic-back">Back to Programs</Link>
      </div>
    );
  }
  const program = read.data?.program;
  const meta = {
    title: program?.name || programKey,
    line: program?.purpose || null,
    lineReason: 'No purpose is recorded for this program yet.',
    facts: [program?.who ? `Who: ${program.who}` : null, program?.join_method ? `Join: ${program.join_method}` : null].filter(Boolean),
  };
  return (
    <ProgramFrame program={programKey} meta={meta} superAdmin={superAdmin} status={STATUS_WORD[program?.status] || NOT_RECORDED} tabs={<Tabs programKey={programKey} />}>
      {tab === 'overview' && isReady(read) ? <Overview programKey={programKey} detail={detail} /> : null}
      {tab === 'how' ? <PlaybookEditor program={programKey} superAdmin={superAdmin} detail={detail} testId="programs-generic-how" /> : null}
      {tab === 'activity' ? <ActivityTab program={programKey} testId="programs-generic-activity" /> : null}
    </ProgramFrame>
  );
}

export default function GenericProgramPage() {
  return (
    <AdminBoardFrame workspace="Programs" note="Nothing changes until you act." data-testid="admin-board-program-generic">
      <Body />
    </AdminBoardFrame>
  );
}

export { programHref };
