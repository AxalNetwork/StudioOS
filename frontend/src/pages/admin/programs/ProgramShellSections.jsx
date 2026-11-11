// D5313 (#5313) — the generic program shell's sections (PG03), shared by the registry-backed page
// (`GenericProgramPage.jsx`, any program with no page of its own) and every built-in program moved into the shell
// (Perks first, in `ProgramPage.jsx`). D4873 part 4 drew them inside `GenericProgramPage.jsx`; they moved here
// unchanged so a built-in program draws the same Capability modules, Availability & grants, Participation and
// Settings, with no copy of its own.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { actionPrimary } from '../../../ui';
import { programsApi } from '../../../lib/api/programs';
import { BlockFailed, CARD, Done, GrantBadge, H2, INPUT, Pill, Refusal, SUB, Skeleton, Unread } from './parts';
import { ACCESS_WORDS, grantBadgeOf, isFailed, isLoading, memberAccessOf } from './programsModel';
import { ACCESS_CHOICES, MODULES_UNREAD, NO_MODULES, PARTICIPATION_UNRECORDED } from './genericProgramModel';

/** The capability modules, as the canvas draws them: each with its screen, or "None yet" for a program with none. */
export function Modules({ modules }) {
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
export function Availability({ data }) {
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
export function Participation() {
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
export function Settings({ programKey, program, superAdmin, onSaved }) {
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

/**
 * D5313: a section that needs the program's registry read, on a built-in program's page. That page never blanks on a
 * failed registry read (its own screens read alone), so the section says it is reading, or that the program could not
 * be read with Try again, and draws only once the read answered.
 */
export function OnRegistry({ detail, children }) {
  const read = detail.read;
  if (isLoading(read)) return <Skeleton lines={3} testId="programs-shell-registry-loading" />;
  if (isFailed(read)) return <BlockFailed what="This program" onRetry={detail.reload} testId="programs-shell-registry-failed" />;
  return children(read.data);
}
