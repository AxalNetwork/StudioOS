/**
 * D4819 (#4819), Build part 2 — a licence's Terms section (Licences v2 boards
 * L05 read, L06 amendment, L07 conflict), at `/admin/licences/:uid/terms`.
 *
 * READ-ONLY BY DEFAULT. The terms are a contractual schedule: the core terms
 * (fee, term, shares, dates), D797's schedule and the licence facts the
 * agreement names, grouped as the schedule groups them, each with its
 * contract section. Amend terms starts an intentional session; nothing is
 * written until Apply. Review N changes shows the diff, what else it affects
 * (only what the reads can know) and a required reason. A write refused
 * because another admin got there first shows start, now and yours, and keeps
 * every value typed; Reapply moves them onto the current terms for review.
 *
 * The rules are `../licenceTermsAmendModel.js`; the writes are the existing
 * `PATCH /terms` (core) and `PUT /terms` (schedule), each naming the revision
 * it read (D4694). No browser dialog is used anywhere here.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { licenceTermsApi } from '../../../lib/api/licenceTerms';
import { reportError } from '../../../lib/log';
import { Unreadable } from '../../../ui';
import OutcomeNotice from '../../../components/OutcomeNotice';
import { describeOutcome, outcomeFromError, outcomeOfError } from '../../../lib/mutationOutcome';
import { TermInput, saveError } from '../LicenceTermsSchedule';
import {
  CORE_BY_KEY, SCHEDULE_BY_KEY, UNREADABLE, amendmentEffects, applyOutcome, changesWord, conflictRows, conflictWho, coreApplied,
  planApply, readValue, rebaseSession, sectionOf, sessionChanges, startSession, termsGroups,
} from '../licenceTermsAmendModel';

const inputCls = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900';
const btn = 'rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800';
const primary = 'rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50';
const errId = (rowId) => `terms-err-${rowId.replace(/\./g, '-')}`;
const inputId = (rowId) => `terms-input-${rowId.replace(/\./g, '-')}`;
const clock = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Before → after, said in words as well as drawn: struck is before, marked is after. */
function Diff({ before, after }) {
  return (
    <span className="text-[12px]">
      <span className="sr-only">Changed from </span>
      <del className="text-gray-500 dark:text-gray-400">{before}</del>
      <span aria-hidden="true"> → </span><span className="sr-only"> to </span>
      <ins className="rounded bg-amber-100 px-1 font-semibold no-underline text-gray-900 dark:bg-amber-900/40 dark:text-gray-100">{after}</ins>
    </span>
  );
}

function CoreInput({ term, value, onChange, rowId, invalid }) {
  return (
    <input
      id={inputId(rowId)} type={term.type === 'date' ? 'date' : term.type === 'number' ? 'number' : 'text'}
      min={term.min} max={term.max} step={term.step} maxLength={term.type === 'text' ? term.max : undefined}
      className={`${inputCls} ${term.key === 'currency' ? 'uppercase' : ''}`} value={value} aria-label={term.input}
      aria-invalid={invalid ? true : undefined} aria-describedby={invalid ? errId(rowId) : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export default function TermsWorkspace({ licence, onSaved, onOpenTab }) {
  // The schedule read: undefined while it is on its way, null when it failed.
  const [stored, setStored] = useState(undefined);
  // The contract read, for "what else this affects": undefined, false (failed) or the response.
  const [agreement, setAgreement] = useState(undefined);
  // 'read' | 'edit' | 'review' | 'conflict'
  const [mode, setMode] = useState('read');
  const [session, setSession] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const focusRef = useRef(null);

  const loadSchedule = useCallback(() => {
    setStored(undefined);
    licenceTermsApi.get(licence.uid)
      .then((r) => setStored({ terms: r?.terms || null, sections: r?.sections || {}, revision: Number(r?.revision ?? 0) }))
      .catch((e) => { reportError('licence_terms_read_failed', e); setStored(null); });
  }, [licence.uid]);
  useEffect(loadSchedule, [loadSchedule]);

  const loadAgreement = useCallback(() => {
    setAgreement(undefined);
    api.licenceContract(licence.uid)
      .then((d) => setAgreement(d || false))
      .catch((e) => { reportError('licence_terms_agreement_read_failed', e); setAgreement(false); });
  }, [licence.uid]);

  // Each step moves focus to its own heading, so a keyboard or screen-reader user lands where the page changed.
  useEffect(() => { focusRef.current?.focus?.(); }, [mode]);

  const changes = sessionChanges(session);
  const n = changes.length;
  const changedIds = new Set(changes.map((c) => c.id));
  const byId = new Map(changes.map((c) => [c.id, c]));

  function amend() {
    setSession(startSession(licence, stored));
    setErrors({}); setReason(''); setNotice(null); setConflict(null); setAskDiscard(false);
    setMode('edit');
    loadAgreement();
  }
  function discard() {
    setSession(null); setConflict(null); setErrors({}); setReason(''); setAskDiscard(false);
    setMode('read');
  }
  const setCore = (key) => (v) => setSession((s) => ({ ...s, core: { ...s.core, form: { ...s.core.form, [key]: v } } }));
  const setSched = (key) => (v) => setSession((s) => ({ ...s, schedule: { ...s.schedule, form: { ...s.schedule.form, values: { ...s.schedule.form.values, [key]: v } } } }));

  function review() {
    const plan = planApply(session, reason, { requireReason: false });
    const fieldErrors = Object.fromEntries(Object.entries(plan.errors).filter(([k]) => k !== 'form' && k !== 'reason'));
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) {
      const first = Object.keys(fieldErrors)[0];
      document.getElementById?.(inputId(first))?.focus?.();
      return;
    }
    setMode('review');
  }

  async function apply() {
    const plan = planApply(session, reason);
    if (!plan.ok) { setErrors(plan.errors); if (plan.errors.reason) document.getElementById?.('terms-amend-reason')?.focus?.(); return; }
    setErrors({}); setBusy(true); setNotice(null);
    const results = [];
    let current = session;
    try {
      if (plan.core) {
        try {
          const r = await api.licenceSetTerms(licence.uid, plan.core);
          results.push(r);
          current = coreApplied(current, r);
        } catch (e) {
          reportError('licence_terms_amend_failed', e);
          if (e?.code === 'terms_conflict') {
            setConflict({ core: e.data || {} }); setMode('conflict'); onSaved?.();
          } else {
            setNotice(outcomeFromError(e, saveError(e)));
            if (outcomeOfError(e) === 'unknown') { onSaved?.(); loadSchedule(); }
          }
          return;
        }
      }
      if (plan.schedule) {
        try {
          results.push(await licenceTermsApi.save(licence.uid, plan.schedule));
        } catch (e) {
          reportError('licence_terms_amend_failed', e);
          const coreDone = results.length > 0;
          // The core write committed; the session keeps only what is still unsaved.
          setSession(current);
          if (coreDone) onSaved?.();
          if (e?.code === 'terms_conflict') {
            setConflict({ schedule: e.data || {}, coreDone }); setMode('conflict');
            if (coreDone) setNotice(describeOutcome('partial', { message: 'The core terms were applied. The schedule’s changes were not saved, because the schedule changed while you were editing.' }));
          } else {
            const told = outcomeFromError(e, saveError(e));
            setNotice(coreDone ? describeOutcome('partial', { message: `The core terms were applied. The schedule’s changes were not saved: ${told.message}` }) : told);
            if (outcomeOfError(e) === 'unknown') loadSchedule();
          }
          return;
        }
      }
      setNotice(applyOutcome(results, n));
      setSession(null); setReason(''); setConflict(null); setMode('read');
      loadSchedule();
      onSaved?.();
    } finally { setBusy(false); }
  }

  function reapply() {
    const next = rebaseSession(session, conflict);
    setSession(next); setConflict(null); setErrors({});
    if (!sessionChanges(next).length) {
      setNotice(describeOutcome('committed', { message: 'Your changes already match the current terms, so there is nothing to apply.' }));
      setSession(null); setMode('read'); loadSchedule();
      return;
    }
    setMode('review');
  }

  const groups = termsGroups();
  const editing = mode === 'edit';
  const scheduleOff = stored === null;

  /* ---------------- the schedule (L05; L06's fields) ---------------- */
  const schedule = (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="licence-terms-groups">
      {groups.map((g) => (
        <section key={g.group} aria-labelledby={`terms-group-${g.group}`} data-testid={`terms-group-${g.group}`}
          className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <h3 id={`terms-group-${g.group}`} className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{g.title}</h3>
          <dl className="divide-y divide-gray-100 dark:divide-gray-800">
            {g.rows.map((row) => {
              const change = byId.get(row.id);
              const err = errors[row.id];
              const section = row.source === 'schedule' && stored ? sectionOf(stored, row.key) : null;
              const value = readValue(row, { licence, stored });
              const amendable = editing && session && (row.source === 'core' || (row.source === 'schedule' && session.schedule));
              return (
                <div key={row.id} data-testid={`terms-row-${row.id}`} data-changed={changedIds.has(row.id) ? 'yes' : undefined}
                  className={`grid gap-1 py-1.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_3.5rem] sm:items-start ${change ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}`}>
                  <dt className="text-[12px] text-gray-600 dark:text-gray-400">
                    {amendable ? <label htmlFor={inputId(row.id)}>{row.label}</label> : row.label}
                  </dt>
                  <dd className="min-w-0 text-sm text-gray-900 dark:text-gray-100">
                    {amendable ? (
                      <>
                        {row.source === 'core'
                          ? <CoreInput term={CORE_BY_KEY.get(row.key)} value={session.core.form[row.key]} onChange={setCore(row.key)} rowId={row.id} invalid={Boolean(err)} />
                          : <TermInput field={SCHEDULE_BY_KEY.get(row.key)} value={session.schedule.form.values[row.key]} onChange={setSched(row.key)}
                            currency={licence.currency} id={inputId(row.id)} describedBy={err ? errId(row.id) : undefined} invalid={Boolean(err)} />}
                        {change && <div className="mt-0.5" data-testid={`terms-diff-${row.id}`}><Diff before={change.before} after={change.after} /></div>}
                        {err && <p id={errId(row.id)} className="mt-0.5 text-[11px] text-red-700 dark:text-red-300">{row.label}: {err}</p>}
                      </>
                    ) : change ? (
                      <Diff before={change.before} after={change.after} />
                    ) : (
                      <span className={value === UNREADABLE ? 'text-red-700 dark:text-red-300' : /^Not recorded/.test(value) ? 'italic text-gray-500 dark:text-gray-400' : ''}>{value}</span>
                    )}
                    {editing && row.source === 'fixed' && (
                      <button type="button" className="ml-2 text-[11px] text-indigo-700 underline dark:text-indigo-300" onClick={() => onOpenTab?.(row.tab)}
                        data-testid={`terms-open-${row.id}`}>
                        Changed on its own tab
                      </button>
                    )}
                    {editing && row.source === 'schedule' && !session?.schedule && (
                      <span className="ml-2 text-[11px] text-gray-500">Unreadable, so it cannot be amended.</span>
                    )}
                  </dd>
                  <dd className="text-right font-mono text-[11px] text-gray-500 dark:text-gray-400">
                    {section || <><span aria-hidden="true">—</span><span className="sr-only">No contract section recorded</span></>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );

  return (
    <div className="space-y-4" data-testid="licence-terms-workspace" data-mode={mode}>
      <OutcomeNotice notice={notice} testId="licence-terms-outcome" onDismiss={() => setNotice(null)} />

      {mode === 'read' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Read-only · current ledger terms</p>
          <button type="button" className={primary} onClick={amend} data-testid="licence-terms-amend">Amend terms</button>
        </div>
      )}
      {mode === 'read' && scheduleOff && (
        <Unreadable what="The terms schedule" claim="This is not a sign that no terms are recorded." onRetry={loadSchedule} />
      )}

      {editing && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950"
          data-testid="licence-terms-session">
          <h3 ref={focusRef} tabIndex={-1} className="text-sm text-violet-950 outline-none dark:text-violet-100">
            <span aria-hidden="true">✎ </span><b>Amendment in progress</b> · started {clock(session.startedAt)} by you · nothing changes until you review and apply
          </h3>
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={() => (n ? setAskDiscard(true) : discard())} data-testid="licence-terms-discard">Discard</button>
            <button type="button" className={primary} disabled={!n} onClick={review} data-testid="licence-terms-review">
              {n ? `Review ${changesWord(n)}` : 'No changes to review'}
            </button>
          </div>
          {askDiscard && (
            <div role="group" aria-label="Discard this amendment" className="flex w-full flex-wrap items-center gap-2 text-sm" data-testid="licence-terms-discard-ask">
              <span>Discard {changesWord(n)}? Nothing has been saved.</span>
              <button type="button" className={btn} onClick={discard} data-testid="licence-terms-discard-yes">Discard {changesWord(n)}</button>
              <button type="button" className={btn} onClick={() => setAskDiscard(false)}>Keep editing</button>
            </div>
          )}
        </div>
      )}

      {mode === 'review' && (
        <section aria-labelledby="terms-review-title" className="max-w-3xl space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800" data-testid="licence-terms-review-panel">
          <h3 id="terms-review-title" ref={focusRef} tabIndex={-1} className="text-base font-semibold text-gray-900 outline-none dark:text-gray-100">Review {changesWord(n)}</h3>
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 font-mono text-[12px] dark:divide-gray-800 dark:border-gray-800" data-testid="licence-terms-diff">
            {changes.map((c) => (
              <li key={c.id} className="px-3 py-1.5">
                <div className="text-red-800 dark:text-red-300"><span aria-hidden="true">− </span><span className="sr-only">Before: </span>{c.label}: {c.before}</div>
                <div className="text-green-800 dark:text-green-300"><span aria-hidden="true">+ </span><span className="sr-only">After: </span>{c.label}: {c.after}</div>
              </li>
            ))}
          </ul>
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950" data-testid="licence-terms-effects">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">What else this affects</h4>
            <ul className="mt-1 space-y-1 text-[13px] text-gray-700 dark:text-gray-300">
              {amendmentEffects({ licence, agreement }).map((e) => (
                <li key={e.id} data-testid={`terms-effect-${e.id}`} data-known={e.known ? 'yes' : 'no'}>
                  <span aria-hidden="true">• </span>{!e.known && <b>Not known: </b>}{e.text}
                  {e.id === 'agreement' && !e.known && agreement === false && (
                    <button type="button" className="ml-1 underline" onClick={loadAgreement}>Try again</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <label htmlFor="terms-amend-reason" className="block text-sm font-medium text-gray-900 dark:text-gray-100">
              Reason <span className="font-normal text-gray-500">· required, recorded in History</span>
            </label>
            <textarea id="terms-amend-reason" rows={2} maxLength={500} value={reason} className={`${inputCls} mt-1`}
              aria-required="true" aria-invalid={errors.reason ? true : undefined} aria-describedby={errors.reason ? 'terms-amend-reason-err' : undefined}
              onChange={(e) => setReason(e.target.value)} data-testid="licence-terms-reason" />
            {errors.reason && <p id="terms-amend-reason-err" className="mt-1 text-[12px] text-red-700 dark:text-red-300">{errors.reason}</p>}
            {Object.entries(errors).filter(([k]) => k !== 'reason').map(([k, m]) => (
              <p key={k} className="mt-1 text-[12px] text-red-700 dark:text-red-300">{byId.get(k)?.label || 'This amendment'}: {m}</p>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={btn} onClick={() => setMode('edit')} disabled={busy} data-testid="licence-terms-back">Back to editing</button>
            <button type="button" className={primary} onClick={apply} disabled={busy} data-testid="licence-terms-apply">
              {busy ? <Loader2 size={14} className="animate-spin" aria-label="Applying" /> : `Apply ${changesWord(n)}`}
            </button>
          </div>
        </section>
      )}

      {mode === 'conflict' && (
        <section aria-labelledby="terms-conflict-title" className="max-w-4xl space-y-3" data-testid="licence-terms-conflict-panel">
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <h3 id="terms-conflict-title" ref={focusRef} tabIndex={-1} className="font-semibold outline-none">
              <span aria-hidden="true">! </span>These terms changed while you were editing.
            </h3>
            <p data-testid="licence-terms-conflict-who">
              {conflictWho(conflict?.core || conflict?.schedule)}{' '}
              {conflict?.coreDone ? 'Your core terms were applied; your schedule changes were not saved.' : 'Nothing of yours was saved.'}
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-left text-sm" data-testid="licence-terms-conflict-table">
              <caption className="sr-only">Each term as it was when you started, as it is now, and your change</caption>
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                <tr><th scope="col" className="px-3 py-2">Term</th><th scope="col" className="px-3 py-2">When you started</th><th scope="col" className="px-3 py-2">Now</th><th scope="col" className="px-3 py-2">Your change</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {conflictRows(session, conflict).map((r) => (
                  <tr key={r.id} data-testid={`terms-conflict-${r.id}`}>
                    <th scope="row" className="px-3 py-2 font-normal text-gray-700 dark:text-gray-300">{r.label}</th>
                    <td className="px-3 py-2">{r.start}</td>
                    <td className="px-3 py-2">{r.theirs ? <><b>{r.now}</b> <span className="text-[11px] text-amber-800 dark:text-amber-300">· changed since you started</span></> : r.now}</td>
                    <td className="px-3 py-2">{r.mine === null ? <><span aria-hidden="true">—</span><span className="sr-only">No change of yours</span></> : <b>{r.mine}</b>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={btn} onClick={() => { discard(); loadSchedule(); }} data-testid="licence-terms-conflict-discard">Discard my changes</button>
            <button type="button" className={primary} onClick={reapply} disabled={!(conflict?.core?.current || conflict?.schedule?.current)} data-testid="licence-terms-reapply">
              Reapply my {changesWord(n)} on the current terms
            </button>
          </div>
        </section>
      )}

      {mode !== 'conflict' && schedule}
    </div>
  );
}
