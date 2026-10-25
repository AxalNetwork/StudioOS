import React, { useMemo, useRef, useState } from 'react';
import { programGrantsApi } from '../../../lib/api/programGrants.js';
import { reportError } from '../../../lib/log';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../../ui';
import {
  FROZEN_LINE, NOT_RECORDED, REASON_MIN, TERMS, TERM_ORDER, changedKeys, dayWord, liveSentence, requestRefusal,
  termField, termKeysFor, termWord, termsPayload,
} from './grantsModel';

/**
 * D987 (#2778) — the page's dialogs (GR4, GR5d, GR10a–d). Every change is
 * asked in the page, says what it changes, and carries the reason HQ's record
 * keeps (10 characters or more, D982). The authenticator code is the app's
 * step-up (`StepUpModal`, BLOCK-AUTH-03): a write the Worker refuses with
 * `step_up_required` asks for the code and is sent again once.
 */

const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const ERR = 'text-[12.5px] text-axal-destructive dark:text-red-400';
const FIELD = 'rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const CHIP = 'inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold';
const STEP_UP = 'Saving asks for your authenticator code.';

function Reason({ value, onChange, label, testId }) {
  const short = value.trim().length > 0 && value.trim().length < REASON_MIN;
  return (
    <label className="flex flex-col gap-1">
      <span className={EYE}>{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={500} placeholder="Write a reason…" className={FIELD} data-testid={testId} />
      <span className={short ? ERR : SUB}>{short ? `At least ${REASON_MIN} characters: it is the line HQ’s record keeps.` : `At least ${REASON_MIN} characters.`}</span>
    </label>
  );
}

/**
 * One act with a reason: pause, resume, end, send schedule, decline, a
 * defaults switch, a deal-type switch. `run(reason)` makes the write; its
 * refusal is said in the dialog in words.
 */
export function ReasonDialog({ title, body, button, danger = false, reasonLabel = 'Reason · required', frozen = null, run, onClose, onDone, testId }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const ready = !frozen && reason.trim().length >= REASON_MIN;
  const close = () => { if (!lock.current) onClose(); };
  const go = async () => {
    if (lock.current || !ready) return;
    lock.current = true; setBusy(true); setRefusal('');
    try { const out = await run(reason.trim()); onDone(out); } catch (e) {
      reportError('program-grants:write', e);
      setRefusal(requestRefusal(e));
    } finally { lock.current = false; setBusy(false); }
  };
  return (
    <Lightbox label={title} title={title} onClose={close} width={580} testId={testId}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={actionGhost} onClick={close} disabled={busy}>Back</button>
          <button type="button" className={danger ? actionDanger : actionPrimary} onClick={go} disabled={busy || !ready} data-testid={`${testId}-confirm`}>{busy ? 'Saving…' : button}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        {body ? <p className="m-0 text-[13px] leading-[1.5] text-axal-ink dark:text-gray-100">{body}</p> : null}
        <Reason value={reason} onChange={setReason} label={reasonLabel} testId={`${testId}-reason`} />
        <span className={SUB}>{STEP_UP}</span>
        {frozen ? <p role="alert" className={`m-0 font-semibold ${ERR}`} data-testid={`${testId}-frozen`}>{frozen}</p> : null}
        {refusal ? <p role="alert" className={`m-0 ${ERR}`} data-testid={`${testId}-refusal`}>{refusal}</p> : null}
      </div>
    </Lightbox>
  );
}

/** A term's input, by its kind. Money and shares are typed in whole units; the Worker stores cents and basis points. */
function TermInput({ k, value, onChange, testId }) {
  const t = TERMS[k];
  if (t.kind === 'flag') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={FIELD} data-testid={testId}>
        <option value="">{NOT_RECORDED}</option><option value="1">On</option><option value="0">Off</option>
      </select>
    );
  }
  if (t.kind === 'enum') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={FIELD} data-testid={testId}>
        <option value="">{NOT_RECORDED}</option>
        {Object.entries(t.values).map(([v, w]) => <option key={v} value={v}>{w}</option>)}
      </select>
    );
  }
  const type = t.kind === 'date' ? 'date' : t.kind === 'currency' ? 'text' : 'number';
  return <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className={FIELD} data-testid={testId}
    {...(type === 'number' ? { min: 0, step: t.kind === 'cents' || t.kind === 'bps' ? '0.01' : '1' } : {})}
    {...(t.kind === 'currency' ? { maxLength: 3, placeholder: 'EUR' } : {})} />;
}

/**
 * GR4 — grant a program, finish a draft, or change a grant's terms, then
 * GR10a's review. `mode` is 'grant' | 'change'. Terms start from the grant
 * (a change), a draft or request's terms, or the program's defaults; each is
 * marked Default or Changed against the defaults, with Reset to default.
 */
export function GrantLightbox({ mode, licence, defaults, grant, startTerms, request, onClose, onDone }) {
  const keys = useMemo(() => termKeysFor(defaults), [defaults]);
  const base = useMemo(() => {
    const d = defaults?.terms || {};
    const from = mode === 'change' ? grant?.terms || {} : { ...Object.fromEntries(keys.map((k) => [k, d[k] ?? null])), ...(startTerms || {}) };
    return Object.fromEntries(keys.map((k) => [k, from[k] ?? null]));
  }, [mode, grant, startTerms, defaults, keys]);
  const [form, setForm] = useState(() => Object.fromEntries(keys.map((k) => [k, termField(k, base[k])])));
  const [note, setNote] = useState(mode === 'change' ? grant?.note || '' : '');
  const [reason, setReason] = useState('');
  const [step, setStep] = useState('edit');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const frozen = licence?.status === 'suspended' ? FROZEN_LINE : null;
  const studio = licence?.brand_name || licence?.licence_ref || 'This studio';
  const name = defaults?.name || grant?.program_key || 'this program';
  // What a grant from defaults would send is the defaults' own values, so the payload is measured from the form's start.
  const start = mode === 'change' ? base : Object.fromEntries(keys.map((k) => [k, Symbol('send')]));
  const payload = useMemo(() => termsPayload(keys, form, start), [keys, form, start]);
  const current = useMemo(() => ({ ...base, ...Object.fromEntries(keys.map((k) => [k, k in payload ? payload[k] : base[k]])) }), [base, keys, payload]);
  const differ = changedKeys(current, defaults?.terms || {});
  const ready = !frozen && reason.trim().length >= REASON_MIN && (mode !== 'change' || Object.keys(payload).length > 0 || note !== (grant?.note || ''));
  const title = mode === 'change' ? `Change ${name} for ${studio}` : `Grant ${name} to ${studio}`;
  const close = () => { if (!lock.current) onClose(); };
  const save = async () => {
    if (lock.current || !ready) return;
    lock.current = true; setBusy(true); setRefusal('');
    try {
      const body = { terms: mode === 'change' ? payload : Object.fromEntries(keys.map((k) => [k, current[k]])), note: note.trim() || null, reason: reason.trim() };
      const out = mode === 'change'
        ? await programGrantsApi.changeTerms(licence.uid, defaults.program_key, body)
        : await programGrantsApi.grant(licence.uid, defaults.program_key, body);
      onDone(out);
    } catch (e) {
      reportError('program-grants:grant', e);
      setRefusal(requestRefusal(e));
      setStep('edit');
    } finally { lock.current = false; setBusy(false); }
  };

  const footer = step === 'edit' ? (
    <div className="flex justify-end gap-2">
      <button type="button" className={actionGhost} onClick={close}>Back</button>
      <button type="button" className={actionPrimary} onClick={() => setStep('review')} disabled={!ready} data-testid="grant-review">Review</button>
    </div>
  ) : (
    <div className="flex justify-end gap-2">
      <button type="button" className={actionGhost} onClick={() => setStep('edit')} disabled={busy}>Back</button>
      <button type="button" className={actionPrimary} onClick={save} disabled={busy} data-testid="grant-confirm">{busy ? 'Saving…' : mode === 'change' ? 'Save terms' : 'Grant'}</button>
    </div>
  );

  return (
    <Lightbox label={title} title={step === 'review' ? `${title}?` : title} onClose={close} width={600} size="tall" pageBelow="lg" testId="grant-lightbox" footer={footer}>
      {step === 'edit' ? (
        <div className="flex flex-col gap-3.5">
          {request ? (
            <div className="rounded-[10px] bg-axal-lavender px-3 py-2.5 dark:bg-violet-950/40" data-testid="grant-request">
              <span className={EYE}>From a request · requested {dayWord(request.created_at) || NOT_RECORDED}</span>
              {request.note ? <p className="m-0 mt-1 text-[13px] text-axal-ink dark:text-gray-100">‘{request.note}’</p> : null}
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="m-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100">Grant terms</h3>
            <span className={SUB}>{mode === 'change' ? 'From this grant' : `Filled from ${name}’s defaults`}</span>
          </div>
          <div className="flex flex-col gap-2.5" data-testid="grant-terms">
            {keys.map((k) => {
              const value = k in payload ? payload[k] : base[k];
              const dflt = defaults?.terms?.[k] ?? null;
              const defaultable = k in (defaults?.terms || {});
              const changed = defaultable && (value ?? null) !== dflt;
              return (
                <div key={k} className="grid grid-cols-[170px_minmax(0,1fr)] items-start gap-2 max-sm:grid-cols-1" data-testid={`grant-term-${k}`}>
                  <span className={`${EYE} pt-2`}>{TERMS[k].label}</span>
                  <div className="flex flex-col gap-1">
                    <TermInput k={k} value={form[k]} onChange={(v) => setForm((f) => ({ ...f, [k]: v }))} testId={`grant-input-${k}`} />
                    {defaultable ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`${CHIP} ${changed ? 'bg-axal-lavender text-axal-violet dark:bg-violet-950/50 dark:text-violet-300' : 'bg-axal-ground text-axal-muted dark:bg-gray-800 dark:text-gray-400'}`} data-testid={`grant-chip-${k}`}>{changed ? 'Changed' : 'Default'}</span>
                        {changed ? (
                          <>
                            <span className={SUB}>Default: {termWord(k, dflt, defaults.terms)}.</span>
                            <button type="button" className="text-[12px] font-semibold text-axal-violet underline dark:text-violet-300" onClick={() => setForm((f) => ({ ...f, [k]: termField(k, dflt) }))} data-testid={`grant-reset-${k}`}>Reset to default</button>
                          </>
                        ) : null}
                      </span>
                    ) : <span className={SUB}>Set for each grant.</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="m-0 rounded-[10px] border border-axal-hairline px-3 py-2.5 text-[13px] leading-[1.5] text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid="grant-sentence">
            {liveSentence({ studio, program: name, terms: current, licence })}
          </p>
          <Reason value={reason} onChange={setReason} label="Reason for HQ’s record · required · at least 10 characters" testId="grant-reason" />
          <label className="flex flex-col gap-1">
            <span className={EYE}>Note to the studio · optional · the studio reads it</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className={FIELD} data-testid="grant-note" />
          </label>
          {frozen ? <p role="alert" className={`m-0 font-semibold ${ERR}`} data-testid="grant-frozen">{frozen}</p> : null}
          {refusal ? <p role="alert" className={`m-0 ${ERR}`} data-testid="grant-refusal">{refusal}</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-testid="grant-review-body">
          <p className="m-0 text-[13px] leading-[1.5] text-axal-ink dark:text-gray-100">The studio sees these terms on its Licences page. Members can join once the grant is in force.</p>
          <span className={EYE}>Terms that differ from the default</span>
          {differ.length ? (
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] text-axal-ink dark:text-gray-100" data-testid="grant-differ">
              {differ.map((k) => <li key={k}>{TERMS[k]?.label || k}: {termWord(k, current[k], current)}. Default: {termWord(k, defaults?.terms?.[k], defaults?.terms)}.</li>)}
            </ul>
          ) : <span className={SUB} data-testid="grant-differ-none">None: every term is the default.</span>}
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{liveSentence({ studio, program: name, terms: current, licence })}</p>
          <span className={SUB}>{STEP_UP}</span>
        </div>
      )}
    </Lightbox>
  );
}

/**
 * GR5d — answer a request: approve (a draft; Grant stays D982's write) or
 * decline with the note the studio reads. "Ask for more" is not drawn: no
 * Worker route records it.
 */
export function AnswerDialog({ row, onClose, onDone }) {
  const [choice, setChoice] = useState('approve');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const ready = reason.trim().length >= REASON_MIN;
  const close = () => { if (!lock.current) onClose(); };
  const go = async () => {
    if (lock.current || !ready) return;
    lock.current = true; setBusy(true); setRefusal('');
    try {
      const out = choice === 'approve'
        ? await programGrantsApi.approveRequest(row.uid, { reason: reason.trim() })
        : await programGrantsApi.declineRequest(row.uid, { reason: reason.trim() });
      onDone(choice, out);
    } catch (e) {
      reportError('program-grants:answer', e);
      setRefusal(requestRefusal(e));
    } finally { lock.current = false; setBusy(false); }
  };
  const title = `Answer ${row.studio} · ${row.program}`;
  return (
    <Lightbox label={title} title={title} onClose={close} width={600} testId="answer-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={actionGhost} onClick={close} disabled={busy}>Back</button>
          <button type="button" className={choice === 'decline' ? actionDanger : actionPrimary} onClick={go} disabled={busy || !ready} data-testid="answer-confirm">{busy ? 'Saving…' : choice === 'decline' ? 'Decline' : 'Approve'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <p className={`m-0 ${SUB}`}>Asks for: {row.asksFor} · sent {row.sentFull}{row.open ? ` · waiting ${row.waiting}${row.slaWord ? `, ${row.slaWord.toLowerCase()}` : ''}` : ''}.</p>
        <section className="flex flex-col gap-1">
          <span className={EYE}>The request</span>
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{row.note === '—' ? 'The studio wrote no note.' : `‘${row.note}’`}</p>
        </section>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" data-testid="answer-choices">
          <legend className={EYE}>Your answer</legend>
          {[
            ['approve', row.kind === 'program_grant' ? 'Approve, then finish the grant' : row.kind === 'program_end' ? 'Approve the end' : 'Approve the change', row.kind === 'program_grant' ? 'Records HQ’s yes as a draft. The program is granted when you finish it with its terms.' : 'Records HQ’s yes. Make the change from the studio’s page.'],
            ['decline', 'Decline', 'The studio reads your note.'],
          ].map(([v, label, sub]) => (
            <label key={v} className="flex items-start gap-2 text-[13px] text-axal-ink dark:text-gray-100">
              <input type="radio" name="answer" value={v} checked={choice === v} onChange={() => setChoice(v)} data-testid={`answer-${v}`} className="mt-1" />
              <span><b>{label}</b><span className={`block ${SUB}`}>{sub}</span></span>
            </label>
          ))}
        </fieldset>
        <Reason value={reason} onChange={setReason} label={choice === 'decline' ? 'Note to the studio · required' : 'Reason for HQ’s record · required'} testId="answer-reason" />
        <span className={SUB}>The studio reads your answer on its Licences page, under Requests. {STEP_UP}</span>
        {refusal ? <p role="alert" className={`m-0 ${ERR}`} data-testid="answer-refusal">{refusal}</p> : null}
      </div>
    </Lightbox>
  );
}

/**
 * GR6's Edit defaults: the terms new grants of one program start from. Only
 * the terms that change are sent; grants in force keep their own terms.
 */
export function DefaultsDialog({ card, onClose, onDone }) {
  const keys = useMemo(() => TERM_ORDER.filter((k) => k in (card.terms || {})), [card]);
  const [form, setForm] = useState(() => Object.fromEntries(keys.map((k) => [k, termField(k, card.terms[k])])));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const payload = useMemo(() => termsPayload(keys, form, card.terms || {}), [keys, form, card]);
  const ready = Object.keys(payload).length > 0 && reason.trim().length >= REASON_MIN;
  const title = `Edit ${card.name}’s default terms`;
  const close = () => { if (!lock.current) onClose(); };
  const go = async () => {
    if (lock.current || !ready) return;
    lock.current = true; setBusy(true); setRefusal('');
    try { const out = await programGrantsApi.saveDefaults(card.key, { terms: payload, reason: reason.trim() }); onDone(out); } catch (e) {
      reportError('program-grants:defaults', e);
      setRefusal(requestRefusal(e));
    } finally { lock.current = false; setBusy(false); }
  };
  return (
    <Lightbox label={title} title={title} onClose={close} width={580} size="tall" pageBelow="lg" testId="defaults-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={actionGhost} onClick={close} disabled={busy}>Back</button>
          <button type="button" className={actionPrimary} onClick={go} disabled={busy || !ready} data-testid="defaults-dialog-confirm">{busy ? 'Saving…' : 'Save defaults'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] leading-[1.5] text-axal-ink dark:text-gray-100">New grants of {card.name} start from these terms. Grants in force keep their own terms until HQ changes them.</p>
        {keys.map((k) => (
          <div key={k} className="grid grid-cols-[170px_minmax(0,1fr)] items-start gap-2 max-sm:grid-cols-1">
            <span className={`${EYE} pt-2`}>{TERMS[k].label}</span>
            <TermInput k={k} value={form[k]} onChange={(v) => setForm((f) => ({ ...f, [k]: v }))} testId={`defaults-input-${k}`} />
          </div>
        ))}
        <Reason value={reason} onChange={setReason} label="Reason for HQ’s record · required" testId="defaults-dialog-reason" />
        <span className={SUB}>{STEP_UP}</span>
        {refusal ? <p role="alert" className={`m-0 ${ERR}`} data-testid="defaults-dialog-refusal">{refusal}</p> : null}
      </div>
    </Lightbox>
  );
}
