// D4808 (#4808) — the generic, registry-backed program page: `/admin/programs/:key` for any key the registry holds,
// with no route of its own for that key. One shell for every program that has no bespoke page: its registry row (metadata,
// availability), the exact proposal it was approved from, the capabilities that proposal declared, its playbook (How it
// runs) and its Activity. Create → open → edit → publish → revisit works on it: a Super Admin edits the draft and
// publishes it on How it runs, as on the nine.
//
// A program-specific operating screen is an optional module, not an assumption: where the frontend knows one for the key
// (`PAGES`), the page links to it; for any other key it says none exists yet.
import React, { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { actionPrimary } from '../../../ui';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import AdminBoardFrame from '../AdminBoardFrame';
import ActivityTab from './ActivityTab';
import PlaybookEditor, { useProgramDetail } from './PlaybookEditor';
import ProgramFrame from './ProgramFrame';
import { BlockFailed, CARD, Done, GrantBadge, H2, INPUT, Pill, Refusal, SUB, Skeleton, Unread } from './parts';
import { programsApi } from '../../../lib/api/programs';
import { STATUS_WORD } from './catalogueModel';
import { ACCESS_WORDS, NOT_RECORDED, PAGES, grantBadgeOf, isFailed, isLoading, isReady, memberAccessOf } from './programsModel';
import {
  ACCESS_CHOICES, MODULES_UNREAD, NOT_OPERATIONAL_WORD, NOT_SET, NO_CAPABILITIES, NO_MODULES, NO_OPERATING_SCREEN, NO_PROPOSAL,
  PARTICIPATION_UNRECORDED, approvedRows, capabilityRows, genericKeyFrom, genericTabFrom, metadataRows, moduleRows,
  notOperationalLine, programHref, readProblem,
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

/**
 * D4873 (#4873, part 4, PG03): the shell's tabs. The six core sections every program has, then its capability modules
 * (`programs.modules`), each a door onto the screen that already runs it. A module with no screen here is not a tab.
 */
function Tabs({ programKey, modules }) {
  const tab = ({ isActive }) => `-mb-px inline-flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-0.5 text-[13px] lg:min-h-[40px] ${isActive
    ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
    : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`;
  return (
    <nav aria-label="Program" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]" data-testid="programs-tabs">
      <div className="flex gap-[22px] border-b border-axal-hairline dark:border-gray-700">
        {/* Literal template heads, so the reachability walk reads each tab as a door onto this one registry-backed page. */}
        <NavLink to={`/admin/programs/${programKey}`} end className={tab} data-testid="programs-tab-overview">Overview</NavLink>
        <NavLink to={`/admin/programs/${programKey}/how-it-runs`} end className={tab} data-testid="programs-tab-how">Playbook</NavLink>
        <NavLink to={`/admin/programs/${programKey}/availability`} end className={tab} data-testid="programs-tab-availability">Availability &amp; grants</NavLink>
        <NavLink to={`/admin/programs/${programKey}/participation`} end className={tab} data-testid="programs-tab-participation">Participation</NavLink>
        {modules.rows.filter((m) => m.path).map((m) => (
          <NavLink key={m.key} to={m.path} end className={tab} data-testid={`programs-tab-module-${m.key}`}>{m.label}</NavLink>
        ))}
        <NavLink to={`/admin/programs/${programKey}/activity`} end className={tab} data-testid="programs-tab-activity">History</NavLink>
        <NavLink to={`/admin/programs/${programKey}/settings`} end className={tab} data-testid="programs-tab-settings">Settings</NavLink>
      </div>
    </nav>
  );
}

/** The capability modules, as the canvas draws them: each with its screen, or "None yet" for a program with none. */
function Modules({ modules }) {
  return (
    <section className={`${CARD} flex flex-col gap-2 px-[18px] py-4`} aria-labelledby="programs-generic-modules-h" data-testid="programs-generic-modules">
      <h2 id="programs-generic-modules-h" className={H2}>Capability modules</h2>
      {modules.state === 'loading' ? <Skeleton lines={1} /> : null}
      {modules.state === 'unreadable' ? <Unread word="Could not be read" reason={MODULES_UNREAD} /> : null}
      {modules.state === 'pending' ? <Unread word="Not read here yet" reason="This read does not carry the program's modules." /> : null}
      {modules.state === 'ready' && !modules.rows.length ? <p className={`m-0 ${SUB}`} data-testid="programs-generic-modules-none">{NO_MODULES}</p> : null}
      {modules.state === 'ready' && modules.rows.length ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {modules.rows.map((m) => (
            <li key={m.key} data-testid={`programs-generic-module-${m.key}`}>
              {m.path
                ? <Link to={m.path} className="inline-flex"><Pill tone="green"><span aria-hidden="true">✓</span>{m.label}</Pill></Link>
                : <Pill tone="muted">{`${m.label} · no screen here`}</Pill>}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Availability & grants: the offering policy, the grants HQ's read counts, and where grants are managed. */
function Availability({ data }) {
  const grant = grantBadgeOf(data.grant);
  return (
    <section className={`${CARD} flex flex-col gap-2 px-[18px] py-4`} data-testid="programs-generic-availability">
      <h2 className={H2}>Availability &amp; grants</h2>
      <div className="flex flex-wrap items-center gap-2"><GrantBadge grant={null} badge={grant} testId="programs-generic-grant" /></div>
      {data.grantable === true ? <p className={`m-0 ${SUB}`}>This program can be offered to studios.</p> : null}
      {data.grantable === false ? <p className={`m-0 ${SUB}`}>This program is not switched on to be offered to studios.</p> : null}
      {data.grantable === null || data.grantable === undefined ? <p className={`m-0 ${SUB}`}>Whether it can be offered to studios could not be read.</p> : null}
      <Link to="/admin/licences/programs" className="self-start text-[12.5px] font-bold text-axal-violet underline dark:text-violet-300" data-testid="programs-generic-manage-grants">Manage grants →</Link>
    </section>
  );
}

/** Participation: no store records who joined a program without its own screen, so it says so; never a 0. */
function Participation() {
  return (
    <section className={`${CARD} flex flex-col gap-2 px-[18px] py-4`} data-testid="programs-generic-participation">
      <h2 className={H2}>Participation</h2>
      <Unread word="Not recorded" reason={PARTICIPATION_UNRECORDED} testId="programs-generic-participation-unrecorded" />
    </section>
  );
}

/**
 * Settings: member access, the registry's own field (D4873 part 2), which a Super Admin sets here (PATCH, audited as
 * `program.registry.update`). An Admin reads it. Modules are read-only: a module arrives with its screen.
 */
function Settings({ programKey, program, superAdmin, onSaved }) {
  const current = memberAccessOf(program);
  const [value, setValue] = useState(current.state === 'ready' ? current.key : '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const changed = (value || null) !== (current.state === 'ready' ? current.key : null);
  async function save() {
    setBusy(true); setRefusal(null); setDone(null);
    try {
      const res = await programsApi.update(programKey, { member_access: value || null });
      setDone(`Member access is now “${memberAccessOf(res?.program).value}”.`);
      onSaved();
    } catch (e) {
      setRefusal(Number(e?.status) === 403 ? 'Only a Super Admin can change member access.' : (e?.data?.message || 'Member access was not saved. Try again.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} data-testid="programs-generic-settings">
      <h2 className={H2}>Settings</h2>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">Member access</span>
        {superAdmin && current.state !== 'unreadable' && current.state !== 'loading' ? (
          <>
            <select aria-label="Member access" value={value} onChange={(e) => { setValue(e.target.value); setDone(null); }} className={`${INPUT} max-w-[320px]`} data-testid="programs-generic-access">
              <option value="">Not recorded</option>
              {ACCESS_CHOICES.map((k) => <option key={k} value={k}>{ACCESS_WORDS[k]}</option>)}
            </select>
            <span className={SUB}>A record of who can join today. Each program’s own gate still decides what a member reaches.</span>
            <button type="button" className={`${actionPrimary} self-start`} disabled={!changed || busy} onClick={save} data-testid="programs-generic-access-save">{busy ? 'Saving…' : 'Save member access'}</button>
          </>
        ) : <span className="text-[13.5px] text-axal-ink dark:text-gray-100" data-testid="programs-generic-access-value">{current.value}</span>}
        {done ? <Done testId="programs-generic-access-done">{done}</Done> : null}
        <Refusal text={refusal} testId="programs-generic-access-refusal" />
      </div>
    </section>
  );
}

/** The shell's Overview: metadata, availability, the approved proposal, declared capabilities, operating screens. */
function Overview({ programKey, detail }) {
  const data = detail.read.data;
  const caps = capabilityRows(data.capabilities);
  const approved = data.approved_proposal;
  const known = PAGES[programKey];
  return (
    <div className="flex flex-col gap-4" data-testid="programs-generic-overview">
      <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} data-testid="programs-generic-metadata">
        <h2 className={H2}>About</h2>
        <Rows rows={metadataRows(data.program)} testId="programs-generic-meta" />
      </section>

      <Modules modules={moduleRows(programKey, data.program)} />

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
    <ProgramFrame program={programKey} meta={meta} superAdmin={superAdmin} status={STATUS_WORD[program?.status] || NOT_RECORDED} detail={detail}
      tabs={<Tabs programKey={programKey} modules={moduleRows(programKey, program)} />}>
      {tab === 'overview' && isReady(read) ? <Overview programKey={programKey} detail={detail} /> : null}
      {tab === 'how' ? <PlaybookEditor program={programKey} superAdmin={superAdmin} detail={detail} testId="programs-generic-how" /> : null}
      {tab === 'availability' && isReady(read) ? <Availability data={read.data} /> : null}
      {tab === 'participation' ? <Participation /> : null}
      {tab === 'activity' ? <ActivityTab program={programKey} testId="programs-generic-activity" /> : null}
      {tab === 'settings' && isReady(read) ? <Settings programKey={programKey} program={program} superAdmin={superAdmin} onSaved={detail.reload} /> : null}
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
