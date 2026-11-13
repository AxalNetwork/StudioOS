import React from 'react';
import { day, met, profileName, requirementCounts, requirementLabel } from './memberTrustModel';

export const CARD = 'min-w-0 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900';
export const SUB = 'text-sm text-slate-600 dark:text-slate-400';
export const LINK = 'inline-flex min-h-11 items-center text-sm font-semibold text-violet-700 underline dark:text-violet-300';
export function MemberUnreadable({ what, claim, onRetry }) {
  return <p role="alert" className={SUB}>Unreadable. {what} could not be read. {claim} {onRetry && <button type="button" className={LINK} onClick={onRetry}>Try again</button>}</p>;
}
export function RequirementsSummary({ obligations }) {
  const { done, total } = requirementCounts(obligations);
  return <section className={CARD} data-testid="requirements-summary">
    <h2 className="font-bold text-violet-700 dark:text-violet-300">Requirements met: {done} of {total}</h2>
    {total > 0 && <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-label="Requirements met" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}><div className="h-full bg-violet-600" style={{ width: `${done / total * 100}%` }} /></div>}
    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Previous requirements count: Not recorded. The platform does not record a previous count.</p>
  </section>;
}
function Acceptance({ row }) {
  return <div className="mt-2 text-xs text-slate-600 dark:text-slate-400">
    <p>Accepted: {day(row?.accepted_at)} · Version: {row?.document_version || 'Not recorded'}</p>
    {row?.surface && <p>Accepted through {row.surface}</p>}
    {row?.newer_document === true && <p className="mt-1 font-semibold text-amber-800 dark:text-amber-300">A newer version was published: {row.current_version || 'Not recorded'}. <a className="underline" href={row.obligation_key === 'privacy_v1' ? '/privacy' : '/terms'}>Read the current document</a></p>}
    {row?.reason && <p>{row.reason}</p>}
  </div>;
}
export default function MemberOverview({ role, obligations, acceptances, renderRows, companies, onAgreements }) {
  const needed = obligations.filter((r) => Number(r.required) === 1 && !met(r) && r.status !== 'in_review');
  const terms = obligations.filter((r) => ['tos_v1', 'privacy_v1'].includes(r.obligation_key));
  const checks = obligations.filter((r) => !['tos_v1', 'privacy_v1'].includes(r.obligation_key));
  const acceptanceMap = new Map((Array.isArray(acceptances) ? acceptances : []).map((r) => [r.obligation_key, r]));
  return <div className="space-y-4" data-testid="member-trust-overview">
    <p className={SUB}>{profileName(role)}</p>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <RequirementsSummary obligations={obligations} />
      <section className={CARD} data-testid="trust-needs-you"><h2 className="mb-3 font-bold">Needs you</h2>{needed.length ? renderRows(needed) : <p className={SUB}>{obligations.some((r) => Number(r.required) === 1 && r.status === 'in_review') ? 'Your remaining requirements are under review.' : obligations.length ? 'No requirements need your action right now.' : 'Nothing is asked of you right now. New requirements appear here when the platform records them.'}</p>}</section>
      <section className={CARD}><h2 className="mb-3 font-bold">{role === 'investor' ? 'Before you can invest' : 'Requirements'}</h2>{checks.length ? renderRows(checks) : <p className={SUB}>No other requirements recorded for your profile.</p>}{role !== 'investor' && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">An investor identity check is not required for this profile today.</p>}</section>
      <section className={CARD}><h2 className="mb-3 font-bold">Agreements you accepted</h2>{terms.map((r) => <div key={r.obligation_key} className="border-b border-slate-100 py-3 last:border-0 dark:border-slate-800"><h3 className="text-sm font-semibold">{requirementLabel(r)}</h3>{acceptances === null ? <p className={SUB}>Unreadable. Acceptance records could not be read.</p> : <Acceptance row={acceptanceMap.get(r.obligation_key)} />}</div>)}{!terms.length && <p className={SUB}>No acceptance requirements recorded.</p>}</section>
    </div>
    {companies}
    <section className={CARD}><h2 className="font-bold">{role === 'founder' ? 'Investors who signed an NDA with you' : 'Agreements with other members'}</h2><p className={SUB}>Read the agreements you are party to and their signing history.</p><button type="button" className={LINK} onClick={onAgreements}>Open agreements</button></section>
  </div>;
}
