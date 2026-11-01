import React from 'react';
import { Info } from 'lucide-react';
import { Pill, Skeleton, Unrecorded, Unreadable } from '../../ui';
import { PersonAvatar } from './AgentMark.jsx';
import { HeadRow, MONO, MUTED, TeamCard, useMenu } from './teamUi.jsx';
import { initials, readOnlyLine } from './teamModel.js';

/**
 * D1497 (#3727, TM1a/TM1b People, TM1f, TM9a3–TM9a5) — the People card.
 *
 * Company: `GET /api/company/:uid` members, with Change role and Remove for an
 * editor. Project: `GET /api/projects/:id/members`, with Remove for its Owner.
 * Another member's email is never drawn (the model drops it); your own row may
 * show yours. A Title or Authority the store does not hold is "Not recorded".
 *
 * "Company editors with access" (TM1f) is a separate muted group, never mixed
 * into the project's roles, and is drawn only when a read supplies it
 * (`companyEditors.available`): #3697 part 2's settings-scope answer. Until
 * then it is not drawn at all, rather than guessed from a company read a
 * co-founder may not have.
 *
 * The ⋯ menu offers only what the Worker allows: no Remove on a project's
 * Owner or on a company's only primary admin (`removable`), and no menu at
 * all when nothing is left in it. A person who joined through an invitation
 * accepted this week is highlighted with "Joined …" (TM2c, `highlightKey`).
 */

const GRID = 'md:grid-cols-[minmax(0,2.4fr)_104px_minmax(0,1.3fr)_112px_92px_40px]';

function RowMenu({ row, kind, onChangeRole, onRemove }) {
  const { open, setOpen, trigger, menu } = useMenu();
  return (
    <span className="relative">
      <button ref={trigger} type="button" aria-label={`Actions for ${row.name}`} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-axal-muted hover:bg-axal-ground dark:text-gray-400 dark:hover:bg-gray-800"
        data-testid={`person-actions-${row.userId}`}>⋯</button>
      {open ? (
        <span ref={menu} role="menu" aria-label={`Actions for ${row.name}`} className="absolute right-0 z-20 mt-1 flex w-44 flex-col rounded-axal-md border border-axal-hairline bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {kind === 'company' ? (
            <button type="button" role="menuitem" className="rounded-md px-3 py-2 text-left text-[13px] text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800"
              onClick={() => { setOpen(false); onChangeRole(row); }} data-testid={`person-change-role-${row.userId}`}>Change role</button>
          ) : null}
          {row.removable !== false ? (
            <button type="button" role="menuitem" className="rounded-md px-3 py-2 text-left text-[13px] text-axal-destructive hover:bg-axal-destructive-tint dark:text-red-300 dark:hover:bg-red-950/40"
              onClick={() => { setOpen(false); onRemove(row); }} data-testid={`person-remove-${row.userId}`}>Remove</button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

function PersonRow({ row, kind, canEdit, onChangeRole, onRemove, highlight }) {
  return (
    <div role="row" className={`grid grid-cols-[minmax(0,1fr)_auto] ${GRID} items-center gap-3 border-b border-axal-hairline py-2.5 last:border-b-0 dark:border-gray-800 ${highlight ? 'bg-axal-lavender/60 dark:bg-violet-900/20' : ''}`}
      data-testid={`person-${row.userId}`}>
      <span role="cell" className="flex min-w-0 items-center gap-2.5">
        <PersonAvatar initials={row.initials} />
        <span className="min-w-0">
          <b className="block truncate text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{row.unnamed ? <Unrecorded /> : row.name}{row.you ? ' · you' : ''}</b>
          {row.email ? <span className={`block truncate ${MONO}`} data-testid="person-own-email">{row.email}</span> : null}
          {highlight && row.joined ? <span className={`block ${MONO}`} data-testid="person-joined">Joined {row.joined}</span> : null}
          <span className={`block md:hidden ${MUTED}`}>{row.role || <Unrecorded />}{row.authority ? ` · ${row.authority}` : ''}</span>
        </span>
      </span>
      <span role="cell" className="hidden text-[13px] text-axal-ink md:block dark:text-gray-200">{row.role || <Unrecorded />}</span>
      <span role="cell" className="hidden truncate text-[13px] text-axal-ink md:block dark:text-gray-200">{row.title || <Unrecorded />}</span>
      <span role="cell" className="hidden md:block">
        {row.authority ? <span title={row.authorityTip}><Pill tone="info">{row.authority}</Pill></span> : <Unrecorded />}
      </span>
      <span role="cell" className="hidden md:block"><Pill tone="ok">{row.status}</Pill></span>
      <span role="cell" className="flex justify-end">
        {canEdit && !row.you && (kind === 'company' || row.removable !== false) ? <RowMenu row={row} kind={kind} onChangeRole={onChangeRole} onRemove={onRemove} /> : null}
      </span>
    </div>
  );
}

/** TM1f / TM9a4: company editors who reach the project through the company. */
function CompanyEditors({ block, company }) {
  if (!block || block.available !== true || !Array.isArray(block.value) || !block.value.length) return null;
  return (
    <div className="mt-3 rounded-axal-md border border-dashed border-axal-hairline bg-axal-ground/60 px-3.5 py-3 dark:border-gray-700 dark:bg-gray-950/40" data-testid="company-editors">
      <p className="m-0 font-mono text-[11px] font-medium uppercase tracking-[.11em] text-axal-muted dark:text-gray-400">Company editors with access</p>
      <p className={`m-0 mt-1 ${MUTED}`}>They manage this project through {company}. They are not project members, and their company roles are not project roles.</p>
      <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
        {block.value.map((e) => (
          <li key={e.uid || e.name} className="flex items-center gap-2.5">
            <PersonAvatar initials={initials(e.name)} size={30} muted />
            <span className="text-[13px] text-axal-muted dark:text-gray-300">{e.name}{e.you ? ' · you' : ''}</span>
            <span className={`ml-auto ${MUTED}`}>Company role</span>
            {e.role ? <Pill>{e.role}</Pill> : <Unrecorded />}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PeopleCard({
  kind, people, loading, error, onRetry, canEdit, onChangeRole, onRemove, companyEditors, company, managesThrough,
  lock, highlightKey, children,
}) {
  const count = !loading && !error && Array.isArray(people) ? people.length : null;
  return (
    <TeamCard title="People" count={count} testId="team-people">
      {managesThrough ? (
        <p className={`m-0 mb-2 flex items-center gap-1.5 ${MUTED}`} data-testid="team-manages-through"><Info size={13} aria-hidden="true" />You manage this project through {managesThrough}.</p>
      ) : null}
      {loading ? (
        <div aria-busy="true" className="flex flex-col gap-2" data-testid="team-people-loading">
          <span className={`self-end ${MUTED}`}>Reading…</span>
          {[0, 1, 2].map((i) => <Skeleton key={i} h={44} />)}
        </div>
      ) : error ? (
        <Unreadable what="The people on this team" claim="That is not the same as having no one." onRetry={onRetry} />
      ) : (
        <div role="table" aria-label="People">
          <HeadRow grid={GRID} cols={['Name', 'Role', 'Title', 'Authority', 'Status']} />
          {(people || []).map((row) => (
            <PersonRow key={row.key} row={row} kind={kind} canEdit={canEdit} onChangeRole={onChangeRole} onRemove={onRemove} highlight={highlightKey === row.key} />
          ))}
        </div>
      )}
      {!loading && !error && !canEdit ? <p className={`m-0 mt-3 ${MUTED}`} data-testid="team-read-only">{readOnlyLine(kind)}</p> : null}
      {lock ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-axal-md bg-axal-lavender px-3.5 py-2.5 dark:bg-violet-900/20" data-testid="team-lab-gate">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[.11em] text-axal-violet-deep dark:text-violet-300">Spin-Out Lab</span>
          <span className="text-[13px] text-axal-ink dark:text-gray-100">{lock}</span>
          <Pill tone="warn">Locked</Pill>
        </div>
      ) : null}
      <CompanyEditors block={companyEditors} company={company} />
      {children}
    </TeamCard>
  );
}
