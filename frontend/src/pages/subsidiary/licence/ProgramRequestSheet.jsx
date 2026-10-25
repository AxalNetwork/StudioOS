/**
 * D988 (#2779) — "Request a program" (canvas GR9): a panel on the right on a
 * wide screen, the whole screen on a phone, as D804's change sheet.
 *
 * It sends one of D983's three program requests through D799's module:
 * a grant of a program HQ offers, a change to one term of a program the
 * studio holds, or its end. Only programs HQ offers are listed; the asks a
 * program allows follow what the studio holds. "As it stands" is read from
 * the grant and never sent: HQ fills it from its own store. The reason is
 * required, as the Worker requires it.
 *
 * AT THE LIMIT (GR9b): with `open_max` requests already open, the sheet says
 * so and Send is disabled. The Worker refuses the twenty-first anyway, and any
 * refusal is shown in its own words.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { licenceRequestsApi } from '../../../lib/api/licenceRequests';
import { reportError } from '../../../lib/log';
import {
  ASKED_MAX, ASKS, NOTE_MAX, TERM_LABEL, answerSentence, askableTerms, asksFor, buildProgramRequest,
  openCount, requestablePrograms, termValue,
} from '../../../lib/studioPrograms';
import { SHEET_CLASS } from './RequestChangeSheet';

const INPUT = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900';
const EYE = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400';

export default function ProgramRequestSheet({
  open, programs, requests, initialProgram = null, initialAsk = null, onClose, onSent, api = licenceRequestsApi,
}) {
  const offered = useMemo(() => requestablePrograms(programs), [programs]);
  const [key, setKey] = useState('');
  const [ask, setAsk] = useState('');
  const [term, setTerm] = useState('');
  const [asked, setAsked] = useState('');
  const [why, setWhy] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const first = offered.find((p) => p.program_key === initialProgram)
      || offered.find((p) => asksFor(p).includes(initialAsk)) || offered[0] || null;
    setKey(first?.program_key || '');
    const asks = asksFor(first);
    setAsk(initialAsk && asks.includes(initialAsk) ? initialAsk : asks[0] || '');
    setTerm(''); setAsked(''); setWhy(''); setErr('');
  }, [open, initialProgram, initialAsk, offered]);

  if (!open) return null;

  const program = offered.find((p) => p.program_key === key) || null;
  const asks = asksFor(program);
  const terms = program ? askableTerms(program.program_key) : [];
  const kind = ASKS.find((a) => a.id === ask)?.kind || 'program_grant';
  const max = Number(requests?.open_max);
  const atLimit = Number.isFinite(max) && max > 0 && openCount(requests?.items) >= max;
  const standsAt = term ? (termValue(term, program?.grant?.terms || {}) ?? 'Not recorded') : 'Pick a term';

  function pick(nextKey) {
    setKey(nextKey);
    const next = offered.find((p) => p.program_key === nextKey);
    const a = asksFor(next);
    setAsk(a.includes(ask) ? ask : a[0] || '');
    setTerm(''); setErr('');
  }

  async function send(e) {
    e.preventDefault();
    if (atLimit) return;
    const built = buildProgramRequest({ program, ask, term, asked, why });
    if (!built.ok) { setErr(built.message); return; }
    setBusy(true); setErr('');
    try {
      onSent?.(await api.raise(built.body));
    } catch (e2) {
      reportError('licence_program_request_failed', e2);
      setErr(e2?.message || 'The request could not be sent. Nothing was sent.');
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 hidden bg-black/20 sm:block" aria-hidden="true" onClick={onClose} />
      <aside className={SHEET_CLASS} role="dialog" aria-modal="true" aria-label="Request a program" data-testid="program-request-sheet">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Request a program</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100"><X size={16} /></button>
        </div>
        <form onSubmit={send} className="flex-1 space-y-4 px-4 py-4">
          {!offered.length ? (
            <p className="text-sm text-gray-600 dark:text-gray-400" data-testid="program-request-none">
              {programs === undefined ? 'Reading your programs…'
                : programs === null ? 'Your programs could not be read, so there is nothing to pick from. Close this and try again.'
                  : 'HQ offers no program your studio can ask for.'}
            </p>
          ) : (
            <>
              <label className="block">
                <span className={EYE}>Program · only programs HQ offers</span>
                <select className={INPUT} value={key} onChange={(e) => pick(e.target.value)} data-testid="program-request-program">
                  {offered.map((p) => <option key={p.program_key} value={p.program_key}>{p.name}</option>)}
                </select>
              </label>
              <div>
                <span className={EYE}>What you ask for</span>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="What you ask for">
                  {ASKS.map((a) => (
                    <button key={a.id} type="button" aria-pressed={ask === a.id} disabled={!asks.includes(a.id)} data-ask={a.id}
                      onClick={() => { setAsk(a.id); setErr(''); }}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-40 ${ask === a.id
                        ? 'border-slate-400 bg-slate-100 text-slate-800 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100'
                        : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}>
                      {a.t}
                    </button>
                  ))}
                </div>
              </div>
              {ask === 'change' && (
                <>
                  <label className="block">
                    <span className={EYE}>Which term</span>
                    <select className={INPUT} value={term} onChange={(e) => setTerm(e.target.value)} data-testid="program-request-term">
                      <option value="">Pick a term</option>
                      {terms.map((t) => <option key={t} value={t}>{TERM_LABEL[t]}</option>)}
                    </select>
                  </label>
                  <div>
                    <span className={EYE}>As it stands · read only</span>
                    <div className="rounded-md bg-gray-50 px-3 py-2 font-mono text-sm text-gray-700 dark:bg-gray-950 dark:text-gray-300" data-testid="program-request-current">{standsAt}</div>
                  </div>
                  <label className="block">
                    <span className={EYE}>What you ask instead</span>
                    <input className={`${INPUT} font-mono`} maxLength={ASKED_MAX} value={asked} onChange={(e) => setAsked(e.target.value)} data-testid="program-request-asked" />
                  </label>
                </>
              )}
              <label className="block">
                <span className={EYE}>Why your studio needs it · required</span>
                <textarea className={INPUT} rows={4} maxLength={NOTE_MAX} value={why} onChange={(e) => setWhy(e.target.value)} data-testid="program-request-why" />
                <span className="mt-0.5 block text-right font-mono text-[11px] text-gray-500">{why.length} / {NOTE_MAX}</span>
              </label>
              {atLimit
                ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="status" data-testid="program-request-limit">
                    You have {max} open requests with HQ, the most allowed. Wait for an answer before you send another.
                  </p>
                )
                : <p className="text-xs text-gray-600 dark:text-gray-400" data-testid="program-request-answer">{answerSentence(kind, requests?.response_hours)}</p>}
            </>
          )}
          {err && <p className="text-[11px] text-red-600" role="alert">{err}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">Back</button>
            <button type="submit" disabled={busy || atLimit || !offered.length} className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50" data-testid="program-request-send">Send to HQ</button>
          </div>
        </form>
      </aside>
    </>
  );
}
