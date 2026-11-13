import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { programEntitlementsApi } from '../../../lib/api/programEntitlements.js';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, Pill, actionGhost, usePhoneWidth } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import { LEDGER_PATH } from '../../../lib/programGrants';
import {
  HOLDERS_PATH, LICENCE_TYPES, agreementsNote, blockerLines, filterQuery, grantWord, inForceWord, sourceWords, statusOf,
  typeLabel,
} from './entitlementsModel';

/**
 * D5059 (#5059) — program entitlements from held user licences, on two surfaces:
 *   · `HolderAccessView`: Program access › User licences, at /admin/licences/programs/holders. One row per account
 *     and program, filtered by licence type (chips) and holder (name, email or licence reference).
 *   · `UserLicenceEntitlements`: one user licence at /admin/licences/programs/licence/:uid, with the Licences v2 addendum's L37
 *     Programs card: Program, Eligible, Granted, In force and Source licence, and what blocks each program.
 * Both are reads. Granting a program to an account is the Worker's write (`changeGrant`); its screen is a follow-up.
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const TH = 'px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2.5 align-top text-[13px] text-axal-ink dark:text-gray-100';
const ALERT = 'flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint px-3.5 py-3 text-[13px] text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300';
const NOTE = 'rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-axal-amber-deep dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
const CHIP = 'inline-flex min-h-[36px] items-center rounded-full border px-3 text-[12.5px] font-bold';
const CHIP_ON = 'border-axal-violet bg-axal-lavender text-axal-violet-deep dark:border-violet-700 dark:bg-violet-900/40 dark:text-violet-200';
const CHIP_OFF = 'border-axal-hairline bg-white text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300';

function useRead(load, deps, tag) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead((r) => ({ status: 'loading', data: r.data }));
    load().then(
      (data) => { if (live) setRead({ status: 'ready', data }); },
      (e) => { reportError(`program-entitlements:${tag}`, e); if (live) setRead({ status: e?.status === 404 ? 'missing' : 'error', data: null }); },
    );
    return () => { live = false; };
  }, [...deps, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return [read, useCallback(() => setTick((t) => t + 1), [])];
}

function ReadFailed({ text, onRetry, testId }) {
  return (
    <div role="alert" className={ALERT} data-testid={testId}>
      <span>{text}</span>
      <button type="button" className={actionGhost} onClick={onRetry} data-testid={`${testId}-retry`}>Try again</button>
    </div>
  );
}

/** The In force cell: the status pill, then each blocker on its own line. */
function InForceCell({ p }) {
  const s = statusOf(p);
  const lines = blockerLines(p);
  return (
    <div className="flex flex-col items-start gap-1">
      {p.in_force || (p.grant && p.grant.state === 'granted')
        ? <Pill tone={s.tone}>{inForceWord(p)}</Pill>
        : <span className="text-axal-muted dark:text-gray-400">{inForceWord(p)}</span>}
      {lines.map((l) => <small key={l} className="block text-[11.5px] leading-[1.4] text-axal-muted dark:text-gray-400" data-testid="entitlement-blocker">{l}</small>)}
    </div>
  );
}

function SourceCell({ p, thisUid }) {
  return (
    <div className="flex flex-col gap-0.5">
      {sourceWords(p, thisUid).map((w, i) => {
        const s = (p.sources || [])[i];
        return s && s.licence_uid !== thisUid
          ? <Link key={w} to={`/admin/licences/programs/licence/${encodeURIComponent(s.licence_uid)}`} className="text-axal-violet hover:underline dark:text-violet-300">{w}</Link>
          : <span key={w}>{w}</span>;
      })}
    </div>
  );
}

/** The L37 Programs table, or one card per program on a phone. `holder` adds the Holder column (Program access). */
export function ProgramsTable({ rows, thisUid = null, holder = false, testId }) {
  const phone = usePhoneWidth();
  if (!rows.length) return <p className={SUB} data-testid={`${testId}-none`}>No program is eligible or granted for {holder ? 'these filters' : 'this licence'}.</p>;
  if (phone) {
    return (
      <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid={testId}>
        {rows.map((p) => (
          <li key={`${p.holder?.id ?? ''}:${p.program_key}`} className={`${CARD} flex flex-col gap-1.5 px-3.5 py-3`} data-testid="entitlement-row">
            <div className="flex items-start justify-between gap-2">
              <b className="text-[14px]">{p.program_name}</b>
              <Pill tone={statusOf(p).tone}>{statusOf(p).word}</Pill>
            </div>
            {holder ? <span className={SUB}>{p.holder.name || p.holder.email || `Account ${p.holder.id}`}</span> : null}
            <span className="text-[12.5px]">Eligible: {p.eligible ? 'Yes' : 'No'} · {grantWord(p)}</span>
            <span className="text-[12.5px]">Source: {sourceWords(p, thisUid).join('; ')}</span>
            {blockerLines(p).map((l) => <small key={l} className={SUB} data-testid="entitlement-blocker">{l}</small>)}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" data-testid={testId}>
        <thead>
          <tr className="border-b border-axal-hairline dark:border-gray-700">
            {holder ? <th className={TH}>Holder</th> : null}
            <th className={TH}>Program</th><th className={TH}>Eligible</th><th className={TH}>Granted</th>
            <th className={TH}>In force</th><th className={TH}>Source licence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={`${p.holder?.id ?? ''}:${p.program_key}`} className="border-b border-axal-hairline last:border-0 dark:border-gray-800" data-testid="entitlement-row">
              {holder ? <td className={TD}>{p.holder.name || p.holder.email || `Account ${p.holder.id}`}</td> : null}
              <td className={`${TD} font-bold`}>{p.program_name}</td>
              <td className={TD}>{p.eligible ? 'Yes' : 'No'}</td>
              <td className={TD}>{p.grant ? <Pill tone={p.grant.state === 'granted' ? 'info' : 'neutral'}>{grantWord(p)}</Pill> : <span className="text-axal-muted dark:text-gray-400">{grantWord(p)}</span>}</td>
              <td className={TD}><InForceCell p={p} /></td>
              <td className={TD}><SourceCell p={p} thisUid={thisUid} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Program access › User licences: the filters and one row per account and program. */
export function HolderAccessView() {
  const [type, setType] = useState('all');
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [read, reload] = useRead(() => programEntitlementsApi.list(filterQuery({ type, q })), [type, q], 'holders');
  const d = read.data;
  const note = agreementsNote(d?.agreements);
  return (
    <section className="flex flex-col gap-3" data-testid="holder-access">
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Licence type" data-testid="holder-type-filter">
        {LICENCE_TYPES.map((t) => (
          <button key={t.key} type="button" role="radio" aria-checked={type === t.key} className={`${CHIP} ${type === t.key ? CHIP_ON : CHIP_OFF}`} onClick={() => setType(t.key)} data-testid={`holder-type-${t.key}`}>{t.label}</button>
        ))}
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e?.preventDefault?.(); setQ(draft); }} data-testid="holder-search">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] font-bold text-axal-muted dark:text-gray-400">Holder
          <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Name, email or licence reference" data-testid="holder-search-input" className="min-h-[40px] w-full min-w-0 rounded-[9px] border border-axal-hairline bg-white px-3 text-[13.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
        </label>
        <button type="submit" className={actionGhost}>Search</button>
        {q ? <button type="button" className={actionGhost} onClick={() => { setDraft(''); setQ(''); }} data-testid="holder-search-clear">Clear</button> : null}
      </form>
      {note ? <p className={NOTE} data-testid="holder-agreements-note">{note}</p> : null}
      {read.status === 'error'
        ? <ReadFailed text="Program access by user licence could not be read." onRetry={reload} testId="holder-access-error" />
        : read.status === 'loading' && !d
          ? <p className={SUB}>Reading…</p>
          : (
            <div className={`${CARD} flex flex-col gap-2 px-[18px] py-4`}>
              <h2 className={H2}>{type === 'all' ? 'Every user licence' : `${typeLabel(type)} licences`}{q ? ` · “${q}”` : ''}</h2>
              <p className={SUB} data-testid="holder-count">{d.items.length} {d.items.length === 1 ? 'program' : 'programs'} across {d.holders} {d.holders === 1 ? 'holder' : 'holders'}{d.truncated ? ' · more holders match; narrow the filter' : ''}</p>
              <ProgramsTable rows={d.items} holder testId="holder-programs" />
            </div>
          )}
    </section>
  );
}

function Fact({ k, children }) {
  return (<><dt className="text-[12px] font-bold text-axal-muted dark:text-gray-400">{k}</dt><dd className="m-0 text-[13.5px] text-axal-ink dark:text-gray-100">{children}</dd></>);
}

/** One user licence: its overview and its Programs card (L37). */
function UserLicencePage({ uid }) {
  const [read, reload] = useRead(() => programEntitlementsApi.licence(uid), [uid], 'licence');
  const d = read.data;
  const header = (title) => (
    <AdminPageHeader
      crumb={{ label: 'Licences', to: LEDGER_PATH, via: { label: 'Program access', to: HOLDERS_PATH }, current: d?.licence?.licence_ref || uid }}
      title={title}
      pills={[{ label: 'HQ only', tone: 'hq' }]}
      line="What this licence makes its holder eligible for, what HQ granted, and what is in force."
      data-testid="user-licence-header"
    />
  );
  if (read.status === 'missing') return <div className="flex flex-col gap-4">{header('User licence')}<p className={SUB} data-testid="user-licence-missing">There is no user licence with that id.</p></div>;
  if (read.status === 'error') return <div className="flex flex-col gap-4">{header('User licence')}<ReadFailed text="This licence’s programs could not be read." onRetry={reload} testId="user-licence-error" /></div>;
  if (!d) return <div className="flex flex-col gap-4">{header('User licence')}<p className={SUB}>Reading…</p></div>;
  const l = d.licence;
  const holder = d.account?.name || d.account?.email || `Account ${d.account?.id ?? ''}`;
  const note = agreementsNote(d.agreements);
  return (
    <div className="flex flex-col gap-4 pb-24 lg:pb-10" data-testid="user-licence">
      {header(`${holder} · ${l.licence_type_label} licence`)}
      <section className={`${CARD} px-[18px] py-4`} data-testid="user-licence-overview">
        <h2 className={H2}>Overview</h2>
        <dl className="mt-2 grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          <Fact k="Holder">{holder}</Fact>
          <Fact k="Type">{l.licence_type_label}</Fact>
          <Fact k="Status"><span data-testid="user-licence-status">{l.status.replace('_', ' ')}{l.valid_source ? '' : ' · no program source while so'}</span></Fact>
          <Fact k="Reference"><span className="font-mono">{l.licence_ref}</span></Fact>
          <Fact k="Other licences">{d.other_licences.length ? d.other_licences.map((o, i) => (
            <span key={o.uid}>{i ? ', ' : ''}<Link to={`/admin/licences/programs/licence/${encodeURIComponent(o.uid)}`} className="text-axal-violet hover:underline dark:text-violet-300">{o.licence_ref} · {o.licence_type_label}</Link> ({o.status.replace('_', ' ')})</span>
          )) : 'None'}</Fact>
        </dl>
      </section>
      {note ? <p className={NOTE} data-testid="user-licence-agreements-note">{note}</p> : null}
      <section className={`${CARD} flex flex-col gap-2 px-[18px] py-4`}>
        <h2 className={H2}>Programs</h2>
        <p className={SUB}>Eligible is this licence type’s rule; granted is HQ’s; in force also needs a valid licence and any agreement the program requires.</p>
        <ProgramsTable rows={d.programs} thisUid={l.uid} testId="user-licence-programs" />
      </section>
    </div>
  );
}

export function UserLicenceEntitlements() {
  const { uid } = useParams();
  return (
    <AdminBoardFrame workspace="Licences" note="Eadwyn reads this licence’s programs. It changes nothing." data-testid="admin-board-user-licence">
      <UserLicencePage uid={uid} />
    </AdminBoardFrame>
  );
}

export default UserLicenceEntitlements;
