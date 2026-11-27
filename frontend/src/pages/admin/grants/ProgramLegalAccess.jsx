/**
 * D5051 (#5051, part 1) — Program access per program as three things (L34 of the Licences and Contracts v2
 * addendum, #5303): the Commercial grant, the Agreement, and whether the program is legally In force. A
 * granted program that is not in force is highlighted with what it waits on, and is never drawn as working
 * access: Granted is a commercial decision; in force needs the licence active, the dates reached, the schedule
 * signed and every gating agreement executed (D5052 §3).
 *
 * Reads `GET /api/admin/licence-agreement-policies/licences/:uid` (D5052) for each program's legal status and
 * `GET /api/admin/licence-agreements/licences/:uid` (D5048) for the versions behind the links, each its own
 * block: a failed read is Unreadable, never "not in force".
 */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminLicenceAgreementsApi } from '../../../lib/api/adminLicenceAgreements.js';
import { adminLicenceAgreementPoliciesApi } from '../../../lib/api/adminLicenceAgreementPolicies.js';
import { packageName, programsReadiness } from '../../../lib/licenceLegalReadiness.js';
import { ReadFailed, StatePill, useBlockRead } from '../licences/LicenceAgreements';

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const LINK = 'text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300';

const GRANT_STATE = { Granted: 'executed', Paused: 'paused', Draft: 'prepared', Ended: 'ended', 'Not granted': 'not_recorded' };

function sourceOf(p) {
  if (p.basis === 'package' && p.packageKey) return packageName(p.packageKey);
  if (p.basis === 'program') return p.packageKey ? `${packageName(p.packageKey)} · own policy` : 'Standalone';
  return 'Policy not recorded';
}

export default function ProgramLegalAccess({ uid }) {
  const [legalRead, retryLegal] = useBlockRead(() => adminLicenceAgreementPoliciesApi.forLicence(uid), [uid], 'program_access_legal_failed');
  const [agreementsRead, retryAgreements] = useBlockRead(() => adminLicenceAgreementsApi.forLicence(uid), [uid], 'program_access_agreements_failed');
  const [only, setOnly] = useState(false);
  const programs = useMemo(
    () => programsReadiness(legalRead.data, { licenceUid: uid, agreements: agreementsRead.data }).filter((p) => p.status !== 'not_granted'),
    [legalRead.data, agreementsRead.data, uid],
  );
  const waiting = programs.filter((p) => p.grantedNotInForce);
  const shown = only ? waiting : programs;
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} data-testid="program-legal-access">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={H2}>Commercial grant · Agreement · In force</h2>
        {legalRead.data ? (
          <div role="radiogroup" aria-label="Show" className="flex gap-1 rounded-[9px] border border-axal-hairline p-0.5 text-[12px] dark:border-gray-700">
            {[[false, 'All programs'], [true, `Granted, not in force · ${waiting.length}`]].map(([v, label]) => (
              <button key={label} type="button" role="radio" aria-checked={only === v} onClick={() => setOnly(v)} data-testid={`program-legal-filter-${v ? 'waiting' : 'all'}`}
                className={`rounded-[7px] px-2.5 py-1 font-semibold ${only === v ? 'bg-axal-lavender text-axal-violet dark:bg-violet-950/50 dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}`}>{label}</button>
            ))}
          </div>
        ) : null}
      </div>
      {legalRead.status === 'error' ? <ReadFailed text="Whether each program is legally in force could not be read. That is not the same as not in force." onRetry={retryLegal} testId="program-legal-unreadable" /> : null}
      {agreementsRead.status === 'error' ? <ReadFailed text="The agreement versions could not be read, so their links fall back to the licence’s list in Contracts." onRetry={retryAgreements} testId="program-legal-versions-unreadable" /> : null}
      {legalRead.status === 'loading' && !legalRead.data ? <span className={SUB}>Reading…</span> : null}
      {legalRead.data && !programs.length ? <p className={`m-0 ${SUB}`} data-testid="program-legal-none">No programs are granted to this licence. That is not the same as Not recorded.</p> : null}
      {legalRead.data && shown.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-[12.5px]">
            <thead>
              <tr className={EYE}>{['Program', 'Source', 'Commercial grant', 'Agreement', 'In force'].map((h) => <th key={h} scope="col" className="py-1.5 pr-3 font-bold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const link = p.documents.find((d) => d.row || d.executed_agreement_uid || d.in_flight_agreement_uid)?.href || null;
                return (
                  <tr key={p.programKey} data-testid={`program-legal-row-${p.programKey}`} data-waiting={p.grantedNotInForce ? 'true' : 'false'}
                    className={`border-t border-axal-hairline align-top dark:border-gray-700 ${p.grantedNotInForce ? 'bg-amber-50/70 dark:bg-amber-950/20' : ''}`}>
                    <th scope="row" className="py-2 pr-3 font-bold text-axal-ink dark:text-gray-100">{p.name}</th>
                    <td className="py-2 pr-3 text-[12px]">{sourceOf(p)}</td>
                    <td className="py-2 pr-3"><StatePill state={GRANT_STATE[p.grantWord] || 'not_recorded'} label={p.grantWord} testId={`program-legal-grant-${p.programKey}`} /></td>
                    <td className="py-2 pr-3">
                      <StatePill state={p.agreementState} testId={`program-legal-agreement-${p.programKey}`} />
                      {p.documents.length > 1 ? <span className={`block ${SUB}`}>{p.documents.map((d) => `${d.kindWord}: ${d.word}`).join(' · ')}</span> : null}
                      {link ? <Link className={`block ${LINK}`} to={link} data-testid={`program-legal-link-${p.programKey}`}>Open in Contracts ›</Link> : null}
                    </td>
                    <td className="py-2 pr-3" data-testid={`program-legal-inforce-${p.programKey}`}>
                      {p.inForce === 'in_force' ? <StatePill state="executed" label="In force" />
                        : p.inForce === 'paused' ? <StatePill state="paused" label="Paused" />
                          : p.inForce === 'none' ? <span className="text-axal-muted">—</span>
                            : <><StatePill state="not_prepared" label="Not in force" /><small className="mt-0.5 block text-[11.5px] text-amber-800 dark:text-amber-300">Waiting on {p.waitingOn.join(' and ')}</small></>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {legalRead.data && only && !waiting.length ? <p className={`m-0 ${SUB}`}>Every granted program is in force.</p> : null}
      <p className={`m-0 ${SUB}`}>Granted is a commercial decision; in force needs the licence active, the schedule signed, the agreement executed and the start date reached. Highlighted rows are granted but not in force, and are never working access.</p>
    </section>
  );
}
