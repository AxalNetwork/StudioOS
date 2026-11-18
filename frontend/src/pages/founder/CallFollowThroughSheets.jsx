// D6863 (#6863, canvas D6053) — the four sheets of a call's follow-through,
// each a modal in the page (`Lightbox`: full screen on a phone, a bottom sheet
// for Record): Remind (RAC16B, RAC25b), Export (RAC18, RAC19, RAC25c), a new
// call from a closed one at step 1 (RAC20B, RAC26b) and Record a commitment
// (RAC22B, RAC23, RAC26c). Nothing is sent or written until the founder presses
// the primary; a refusal stays in the sheet in its own words.
import React, { useState } from 'react';
import Lightbox from '../../ui/Lightbox';
import {
  CARRIED_FIELDS, NOT_CARRIED_LINES, NO_EMAIL, RECORD_WARNING, copiedBanner, differs, exportIncluded, exportWithheld, hasResponses,
  indicatedLine, lineConflict, reachingLimit, remindWho, sentenceOf, successorBody, successorSeed, typedCents, usd, whoText,
} from './callFollowThroughModel';
import { longDay } from './raiseCallModel';

const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3.5 text-sm font-semibold text-axal-ink disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 md:min-h-[36px]';
const PRIMARY = 'inline-flex min-h-[48px] items-center justify-center rounded-lg bg-axal-violet px-3.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-violet-600 md:min-h-[36px]';
const MUTED = 'text-xs text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';
const BOX = 'rounded-lg border border-axal-hairline bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800';
const WARN = 'rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200';
const INPUT = 'w-full min-h-[44px] rounded-lg border border-axal-hairline bg-white px-3 py-2 text-sm text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const MARK = 'ml-1.5 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200';

function Refusal({ text, testId }) {
  return text ? <p role="alert" className="m-0 text-sm font-semibold text-red-700 dark:text-red-300" data-testid={testId}>{text}</p> : null;
}
function Foot({ children }) {
  return <div className="flex flex-wrap justify-end gap-2 border-t border-axal-hairline pt-3 dark:border-gray-800">{children}</div>;
}

/** RAC16B: what they receive, who, the limit; Remind N sends the in-app notice. */
export function RemindSheet({ d, venture, selected, onClose, onRemind }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const who = remindWho(d, selected);
  const reaching = reachingLimit(d, selected, d.remind.limit);
  const title = `Remind ${selected.length} recipient${selected.length === 1 ? '' : 's'}`;
  async function go() {
    setBusy(true); setError('');
    try { await onRemind(selected); } catch (e) { setError(sentenceOf(e)); setBusy(false); }
  }
  return (
    <Lightbox label={title} eyebrow={`${d.call.name} · Remind`} title={title} onClose={onClose} width={560} testId="ft-remind-sheet">
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <span className={EYEBROW}>What they receive</span>
          <div className={BOX} data-testid="ft-remind-preview">
            <p className="m-0 text-sm font-bold">A private round call</p>
            <p className="m-0 text-sm">{`${venture || 'Your venture'} invited you to a private round call. It closes on ${longDay(d.call.target_close) || 'Not recorded'}.`}</p>
          </div>
          <p className={`m-0 ${MUTED}`}>{NO_EMAIL}</p>
        </section>
        <section className="flex flex-col gap-1" data-testid="ft-remind-who">
          <span className={EYEBROW}>Who</span>
          {who.map((w) => <div key={w.label} className="flex justify-between gap-3 text-sm"><span>{w.label}</span><span className="font-mono">{whoText(w)}</span></div>)}
        </section>
        <section className={WARN} data-testid="ft-remind-limit">
          {`At most ${d.remind.limit} reminders per recipient per call, at least ${d.remind.spacing_days} days apart.`}
          {reaching.length ? ` After this one, ${reaching.join(', ')} ${reaching.length === 1 ? 'reaches' : 'reach'} the limit.` : ''}
        </section>
        <p className={`m-0 ${MUTED}`}>{`Nothing is sent until you press Remind ${selected.length}. Reminders are logged on the call.`}</p>
        <Refusal text={error} testId="ft-remind-error" />
        <Foot>
          <button type="button" className={BTN} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY} disabled={busy || !selected.length} onClick={go} data-testid="ft-remind-confirm">{busy ? 'Reminding…' : `Remind ${selected.length}`}</button>
        </Foot>
      </div>
    </Lightbox>
  );
}

/** RAC18, RAC19: CSV for the cap table or PDF for counsel; Included and Withheld side by side; terms only with no responses. */
export function ExportSheet({ d, onClose, onExport }) {
  const responses = hasResponses(d);
  const [format, setFormat] = useState(responses ? 'csv' : 'pdf');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scope = responses ? 'responses' : 'terms';
  async function go() {
    setBusy(true); setError('');
    try { await onExport(format, scope); } catch (e) { setError(sentenceOf(e, 'The file could not be made. Nothing was exported. Try again.')); setBusy(false); }
  }
  return (
    <Lightbox label="Export responses" eyebrow={`${d.call.name} · Export`} title="Export responses" onClose={onClose} width={680} testId="ft-export-sheet">
      <div className="flex flex-col gap-4">
        {!responses ? (
          <p role="status" className={`m-0 ${BOX} text-sm`} data-testid="ft-export-empty">{`Nothing to export yet. ${d.counts.responded} of ${d.counts.recipients} recipients have responded. The terms-only PDF has the call name, terms and counsel approval date.`}</p>
        ) : null}
        <fieldset className="grid gap-2 sm:grid-cols-2" data-testid="ft-export-format">
          <legend className={`${EYEBROW} mb-2`}>Format</legend>
          {[['csv', 'CSV', 'For the cap table. One row per named recipient.'], ['pdf', 'PDF', 'For counsel. Terms, responses and questions, dated.']].map(([k, label, line]) => (
            <label key={k} className={`flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${format === k ? 'border-violet-600 bg-violet-50 dark:border-violet-400 dark:bg-violet-950/40' : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'} ${!responses && k === 'csv' ? 'opacity-50' : ''}`}>
              <input type="radio" name="ft-format" value={k} checked={format === k} disabled={!responses && k === 'csv'} onChange={() => setFormat(k)} />
              <span><b>{label}</b><span className={`block ${MUTED}`}>{line}</span></span>
            </label>
          ))}
        </fieldset>
        {responses ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <section className="flex flex-col gap-1" data-testid="ft-export-included">
              <span className={EYEBROW}>Included</span>
              {exportIncluded(d).map((t) => <p key={t} className="m-0 text-sm"><span aria-hidden="true" className="text-emerald-700 dark:text-emerald-300">✓ </span>{t}</p>)}
            </section>
            <section className="flex flex-col gap-1" data-testid="ft-export-withheld">
              <span className={EYEBROW}>Withheld</span>
              {exportWithheld(d).map((t) => <p key={t} className="m-0 text-sm"><span aria-hidden="true" className="text-axal-muted dark:text-gray-400">– </span>{t}</p>)}
            </section>
          </div>
        ) : null}
        {responses ? <p className={`m-0 ${MUTED}`}>{'Amounts in the file are headed “Indicated (USD), not committed”. A questions read that fails marks the file “Questions could not be read”; it is never silently short.'}</p> : null}
        <p className={`m-0 ${MUTED}`}>Counsel is not notified. The export is logged on the call with its date and who made it.</p>
        <Refusal text={error} testId="ft-export-error" />
        <Foot>
          <button type="button" className={BTN} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY} disabled={busy} onClick={go} data-testid="ft-export-confirm">{busy ? 'Exporting…' : responses ? 'Export' : 'Export terms PDF'}</button>
        </Foot>
      </div>
    </Lightbox>
  );
}

/** RAC20B, RAC26b: step 1 of a new call, copied from the closed one. Saving makes a draft; the next steps are the new-call sheet's. */
export function NewCallSheet({ source, today, onClose, onStart }) {
  const [form, setForm] = useState(() => successorSeed(source));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function go() {
    const out = successorBody(form, source, today);
    if (out.error) { setError(out.error); return; }
    setBusy(true); setError('');
    try { await onStart(out.body); } catch (e) { setError(sentenceOf(e)); setBusy(false); }
  }
  const carried = () => <span className={MARK}>↺ Carried</span>;
  return (
    <Lightbox label="New call · terms" eyebrow="New call · draft" title="New call · terms" onClose={onClose} width={720} size="tall" testId="ft-new-call-sheet">
      <div className="flex flex-col gap-4">
        <ol className="m-0 flex list-none gap-3 p-0 text-xs font-semibold" aria-label="Steps">
          {['Terms', 'Materials', 'Audience', 'Counsel'].map((t, i) => <li key={t} aria-current={i === 0 ? 'step' : undefined} className={i === 0 ? 'text-violet-800 dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}>{`${i + 1} ${t}`}</li>)}
        </ol>
        <p role="status" className="m-0 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100" data-testid="ft-copied-banner">{copiedBanner(source)}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-semibold">Call name<input className={INPUT} value={form.name} onChange={set('name')} data-testid="ft-new-name" /><span className={MUTED}>A new name is required.</span></label>
          <label className="flex flex-col gap-1 text-sm font-semibold"><span>Close date <span className={MARK}>Re-enter</span></span><input type="date" min={today} className={INPUT} value={form.target_close} onChange={set('target_close')} data-testid="ft-new-close" /><span className={MUTED}>Not carried. Today or later.</span></label>
          <label className="flex flex-col gap-1 text-sm font-semibold"><span>Amount (USD){carried()}</span><input inputMode="decimal" className={INPUT} value={form.amount} onChange={set('amount')} data-testid="ft-new-amount" /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold"><span>Minimum cheque (USD){carried()}</span><input inputMode="decimal" className={INPUT} value={form.minimum} onChange={set('minimum')} data-testid="ft-new-minimum" /></label>
        </div>
        <label className="flex flex-col gap-1 text-sm font-semibold"><span>Plain terms{carried()}</span><textarea rows={4} className={INPUT} value={form.terms} onChange={set('terms')} data-testid="ft-new-terms" /></label>
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1" data-testid="ft-carried">
            <span className={EYEBROW}>Carried, and still editable</span>
            {CARRIED_FIELDS.map(([, label]) => <p key={label} className="m-0 text-sm"><span aria-hidden="true">↺ </span>{label}</p>)}
          </div>
          <div className="flex flex-col gap-1" data-testid="ft-not-carried">
            <span className={EYEBROW}>Not carried</span>
            {NOT_CARRIED_LINES.map((t) => <p key={t} className="m-0 text-sm"><span aria-hidden="true">– </span>{t}</p>)}
          </div>
        </section>
        <Refusal text={error} testId="ft-new-error" />
        <Foot>
          <button type="button" className={BTN} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY} disabled={busy} onClick={go} data-testid="ft-new-save">{busy ? 'Saving…' : 'Save draft and continue'}</button>
        </Foot>
      </div>
    </Lightbox>
  );
}

/** RAC22B, RAC23, RAC26c: Signed or Wired with a typed amount over the pipeline line. Only the typed amount counts. */
export function RecordSheet({ r, callName, label, onClose, onRecord }) {
  const conflict = lineConflict(r);
  const [status, setStatus] = useState(conflict.onlyWired ? 'wired' : 'signed');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cents = typedCents(amount);
  const ind = indicatedLine(r, callName);
  async function go() {
    if (cents == null) { setError('Type the amount the investor signed or wired.'); return; }
    setBusy(true); setError('');
    try { await onRecord({ recipient_id: r.recipient_id, status, amount_cents: cents }); } catch (e) { setError(sentenceOf(e)); setBusy(false); }
  }
  const verb = status === 'wired' ? 'Wired' : 'Signed';
  return (
    <Lightbox label="Record a commitment" eyebrow={`${label} · Capital relationships`} title="Record a commitment" onClose={onClose} width={520} phone="sheet" testId="ft-record-sheet">
      <div className="flex flex-col gap-4">
        <div className={BOX} data-testid="ft-record-indicated">
          <p className="m-0 text-sm font-bold">{ind.text}</p>
          <p className={`m-0 ${MUTED}`}>This is an intention, not a commitment. Indicated and Soft lines never count toward the target.</p>
        </div>
        {conflict.off ? <p role="status" className={`m-0 ${WARN}`} data-testid="ft-record-conflict">{conflict.text}</p> : (
          <>
            {conflict.onlyWired ? <p className={`m-0 ${MUTED}`} data-testid="ft-record-signed">{conflict.text}</p> : null}
            <fieldset className="grid grid-cols-2 gap-2" data-testid="ft-record-status">
              <legend className={`${EYEBROW} mb-2`}>Status</legend>
              {[['signed', 'Signed'], ['wired', 'Wired']].map(([k, l]) => (
                <label key={k} className={`flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${status === k ? 'border-violet-600 bg-violet-50 dark:border-violet-400 dark:bg-violet-950/40' : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'}`}>
                  <input type="radio" name="ft-status" value={k} checked={status === k} disabled={conflict.onlyWired && k === 'signed'} onChange={() => setStatus(k)} />
                  <span><b>{l}</b><span className={`block ${MUTED}`}>Counts toward the target</span></span>
                </label>
              ))}
            </fieldset>
            <p className={`m-0 ${MUTED}`}>Soft stays as it is and is not counted.</p>
            <label className="flex flex-col gap-1 text-sm font-semibold">Amount <span className={MUTED}>USD · typed by you</span>
              <input inputMode="decimal" className={INPUT} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="ft-record-amount" />
            </label>
            {differs(cents, ind.amount) ? <p className={`m-0 ${MUTED}`} data-testid="ft-record-differs"><span aria-hidden="true">≠ </span>{`Differs from the indicated ${usd(ind.amount)}`}</p> : null}
            <p role="note" className={`m-0 ${WARN}`}>{RECORD_WARNING}</p>
            <p className={`m-0 ${MUTED}`}>{`Writes the investor’s line in Capital relationships to ${verb}, linked to ${callName}.`}</p>
          </>
        )}
        <Refusal text={error} testId="ft-record-error" />
        <Foot>
          <button type="button" className={BTN} onClick={onClose}>Cancel</button>
          {conflict.off ? null : <button type="button" className={PRIMARY} disabled={busy || cents == null} onClick={go} data-testid="ft-record-confirm">{busy ? 'Saving…' : `Record as ${verb}`}</button>}
        </Foot>
      </div>
    </Lightbox>
  );
}
