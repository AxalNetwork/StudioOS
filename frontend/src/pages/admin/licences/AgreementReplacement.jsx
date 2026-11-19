/** D6562: L09 replacement readiness and L10 frozen preview, driven only by the recorded Worker contract. */
import React from 'react';
import { Link } from 'react-router-dom';
const FIELDS = ['legal_entity','territory','commercial_terms','governing_law','signatory_title'];
export function agreementCanSend(current, readiness) {
  return current?.status === 'draft' && !current.envelope_uid && current.snapshot_recorded === true &&
    !!current.body_md && !!current.body_sha256 && !current.unfilled_fields?.length &&
    [current.readiness, readiness].every(r => r?.ready === true && FIELDS.every(key => r.fields?.some(f => f.key === key && f.state === 'ready')));
}
export function AgreementTermsComparison({ comparison, reason, executedVersion, onPrepare, disabled }) {
  return <section data-testid="agreement-terms-comparison" className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
      {comparison?.differs === true ? `Current terms differ from Agreement ${executedVersion || ''}`.trim() : comparison?.differs === false ? 'Current terms match the executed agreement' : 'Terms comparison · Not recorded'}
    </h3>
    <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{comparison ? `${comparison.changed_terms} contractual ${comparison.changed_terms === 1 ? 'term changed' : 'terms changed'}.` : reason || 'No recorded terms snapshot is available for comparison.'}</p>
    {comparison?.differs === true && <button type="button" onClick={onPrepare} disabled={disabled}
      className="mt-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Prepare replacement agreement</button>}
  </section>;
}
export function AgreementReplacement({ licenceUid, current, readiness, agreementVersion, executedVersion }) {
  if (!current || current.status !== 'draft' || current.envelope_uid) return null;
  const fields = readiness?.fields || [];
  const labels = ['Legal entity','Territory','Commercial terms','Governing law','Signatory title'];
  return <div className="space-y-4" data-testid="agreement-replacement">
    <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Replacement agreement {agreementVersion} · readiness</h3>
      <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">{FIELDS.map((key,i) => {
        const ready=fields.find(f=>f.key===key)?.state==='ready';
        return <li key={key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><b className="text-gray-900 dark:text-gray-100">{labels[i]}</b>
          <span className={ready?'text-green-700 dark:text-green-300':'text-amber-800 dark:text-amber-300'}>{ready?'Ready':'Not recorded'}</span>
          {!ready && <Link to={`/admin/licences?licence=${encodeURIComponent(licenceUid)}&tab=terms`} className="text-xs text-indigo-700 underline dark:text-indigo-300">Fix in Terms</Link>}
        </li>;
      })}</ul>
      {!agreementCanSend(current,readiness) && <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">Send for signature becomes available when every field is ready in the ledger and the prepared agreement. Complete missing fields, then prepare the agreement again.</p>}
    </section>
    <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-800" data-testid="agreement-frozen-preview">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Exactly what will be sent</h3>
      {current.body_md && current.body_sha256 ? <>
        <p className="mt-1 break-all font-mono text-xs text-gray-600 dark:text-gray-400">Frozen · {agreementVersion} · hash {current.body_sha256}</p>
        <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-white p-4 font-serif text-sm leading-7 text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">{current.body_md}</pre>
      </> : <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Not recorded · frozen text and its hash are unavailable. Prepare a new agreement.</p>}
      {executedVersion && <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">Until {agreementVersion || 'the replacement'} is executed, {executedVersion} stays the executed agreement.</p>}
    </section>
  </div>;
}
