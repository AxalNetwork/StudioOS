import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import {
  NOT_RECORDED, STEPS, WRITES, actLabel, baseOf, changedSince, draftOf, failureOf, fieldOfError, isDirty,
  payloadOf, receiptOf, reviewOf, stamp, validate,
} from './writeFlowModel.js';
import { day, money } from './portfolioModel.js';
import './writeFlow.css';

/**
 * D4817 part 7 (#5311, canvas PF-07): one money write — a valuation mark or
 * a distribution against one company's position — in four steps, with the
 * company named in every one.
 *
 *   Prepare  the fields, each with its label and its own error;
 *   Review   exactly what is written, to which company and store, and the
 *            effect before → after on what the company read supplies;
 *   Confirm  the explicit act, on a button that names it;
 *   Receipt  the stored record as the Worker returned it.
 *
 * The page supplies the write (`save`) and the read (`reread`), so the
 * routes stay where they were. Before saving, the company is read again: if
 * the history the write lands in moved, nothing is sent, the draft is kept
 * and the change is shown (Conflict). A refused save keeps every entry and
 * shows the Worker's own sentence; a 400 that names a field returns to that
 * field. Closing a draft that holds anything asks first.
 */
export default function WriteFlow({ kind, detail, today = '', save, reread, onSaved, onClose, closeAsked = false, onCloseAnswered }) {
  const def = WRITES[kind];
  const initial = useMemo(() => draftOf(kind, today), [kind, today]);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [step, setStep] = useState('prepare');
  const [base, setBase] = useState(() => baseOf(detail));
  const [now, setNow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [record, setRecord] = useState(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const formId = useId();
  const headingRef = useRef(null);

  const dirty = step !== 'receipt' && isDirty(kind, values, initial);
  // The sheet around the flow asked to close: a draft holding anything asks
  // first; otherwise the flow closes and tells the page it did.
  useEffect(() => {
    if (!closeAsked) return;
    if (dirty) { setAskDiscard(true); onCloseAnswered?.(false); return; }
    onClose?.();
    onCloseAnswered?.(true);
  }, [closeAsked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { headingRef.current?.focus?.(); }, [step]);

  const set = (key) => (e) => {
    const v = e.target.value;
    setValues((cur) => ({ ...cur, [key]: v }));
    if (errors[key]) setErrors((cur) => { const next = { ...cur }; delete next[key]; return next; });
  };

  const toReview = () => {
    const found = validate(kind, values);
    setErrors(found);
    if (Object.keys(found).length) return;
    setFailure(null);
    setStep('review');
  };

  const cancel = () => (dirty ? setAskDiscard(true) : onClose?.());

  const record_ = async () => {
    setBusy(true);
    setFailure(null);
    // The company again, before anything is sent: the routes carry no revision.
    let fresh;
    try {
      fresh = baseOf(await reread());
    } catch (e) {
      setFailure({ kind: 'reread', status: Number(e?.status) || null, message: String(e?.message || '').trim() || 'No reason was given.' });
      setBusy(false);
      return;
    }
    if (changedSince(kind, base, fresh)) {
      setNow(fresh);
      setStep('conflict');
      setBusy(false);
      return;
    }
    try {
      const stored = await save(payloadOf(kind, values));
      setRecord(stored || null);
      setStep('receipt');
      onSaved?.(stored || null);
    } catch (e) {
      const f = failureOf(e);
      if (f.kind === 'conflict') {
        try { setNow(baseOf(await reread())); setStep('conflict'); } catch { setFailure(f); }
      } else {
        const field = f.kind === 'refused' && f.status === 400 ? fieldOfError(kind, f.message) : null;
        if (field) { setErrors({ [field]: f.message }); setStep('prepare'); setFailure({ ...f, field }); }
        else setFailure(f);
      }
    } finally {
      setBusy(false);
    }
  };

  const index = step === 'conflict' ? 2 : step === 'receipt' ? 4 : step === 'confirm' ? 3 : step === 'review' ? 2 : 1;
  const title = step === 'receipt' ? def.done
    : step === 'conflict' ? 'This position changed while you were working'
      : step === 'review' ? `Review: ${actLabel(kind, values, base).replace(/^Record /, 'record ')}`
        : step === 'confirm' ? `Confirm: ${actLabel(kind, values, base).replace(/^Record /, 'record ')}` : def.title;

  return (
    <section className="pfw" aria-labelledby={`${formId}-h`} data-testid={`write-flow-${kind}`} data-step={step}>
      <header className="pfw-head">
        <h3 id={`${formId}-h`} ref={headingRef} tabIndex={-1}>{title}</h3>
        <p className="pfw-company" data-testid="write-flow-company">
          Company · <b>{base.name || NOT_RECORDED}</b>
          {' · '}{base.rounds ? `${base.rounds} round${base.rounds === 1 ? '' : 's'} · invested ${money(base.invested) ?? NOT_RECORDED}` : 'No round recorded'}
        </p>
        {step !== 'conflict' && (
          <ol className="pfw-steps" aria-label={`Step ${index} of 4`}>
            {STEPS.map((s, i) => (
              <li key={s} className={i + 1 < index ? 'is-done' : i + 1 === index ? 'is-on' : ''} aria-current={i + 1 === index ? 'step' : undefined}>
                {i + 1 < index && <Check size={12} aria-hidden="true" />}{s}
              </li>
            ))}
          </ol>
        )}
        {step !== 'receipt' && step !== 'conflict' && <span className="pfw-chip">Draft · not saved</span>}
      </header>

      {askDiscard && (
        <div className="pfw-ask" role="alertdialog" aria-labelledby={`${formId}-ask`} data-testid="write-flow-discard">
          <p id={`${formId}-ask`}><b>Discard this draft {def.noun}?</b> Nothing has been saved; what you typed will be lost.</p>
          <div className="pfw-actions">
            <button type="button" className="pfw-btn" onClick={() => setAskDiscard(false)} data-testid="write-flow-keep">Keep editing</button>
            <button type="button" className="pfw-btn is-danger" onClick={() => { setAskDiscard(false); onClose?.(); }} data-testid="write-flow-discard-yes">Discard draft</button>
          </div>
        </div>
      )}

      {step === 'prepare' && (
        <form className="pfw-body" noValidate onSubmit={(e) => { e.preventDefault(); toReview(); }} data-testid={`form-${kind}`}>
          {Object.keys(errors).length > 0 && (
            <p className="pfw-alert is-error" role="alert" data-testid="write-flow-errors">
              <AlertTriangle size={14} aria-hidden="true" />
              {failure?.field ? `The Worker refused the ${def.noun}. Nothing was recorded; your entries are kept.` : `Check ${Object.keys(errors).length === 1 ? 'the field' : `${Object.keys(errors).length} fields`} marked below.`}
            </p>
          )}
          <div className="pfw-grid">
            {def.fields.map((f) => {
              const id = `${formId}-${f.key}`;
              const err = errors[f.key];
              const describedBy = [err ? `${id}-err` : null, f.hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
              const common = {
                id, value: values[f.key], onChange: set(f.key), 'aria-invalid': err ? 'true' : undefined, 'aria-describedby': describedBy,
                'aria-required': f.required ? 'true' : undefined, 'data-testid': `input-${kind}-${f.key}`,
              };
              return (
                <div key={f.key} className={`pfw-field${f.type === 'textarea' ? ' is-wide' : ''}${err ? ' is-invalid' : ''}`}>
                  <label htmlFor={id}>{f.label}{f.required ? '' : ' (optional)'}</label>
                  {f.type === 'select' ? (
                    <select {...common}>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  ) : f.type === 'textarea' ? (
                    <textarea {...common} rows={3} />
                  ) : (
                    <input {...common} type={f.type === 'date' ? 'date' : 'text'} inputMode={f.type === 'money' ? 'decimal' : undefined} autoComplete="off" />
                  )}
                  {f.hint && !f.required && <small id={`${id}-hint`}>{f.hint}</small>}
                  {err && <span id={`${id}-err`} className="pfw-error" data-testid={`error-${kind}-${f.key}`}>{err}</span>}
                </div>
              );
            })}
          </div>
          <div className="pfw-actions">
            <button type="button" className="pfw-btn" onClick={cancel} data-testid="write-flow-cancel">Cancel</button>
            <button type="submit" className="pfw-btn is-primary" data-testid="write-flow-review">Review {def.noun}</button>
          </div>
        </form>
      )}

      {(step === 'review' || step === 'confirm') && (() => {
        const review = reviewOf(kind, values, base);
        return (
          <div className="pfw-body">
            <h4 className="pfw-eyebrow">What will be written</h4>
            <dl className="pfw-kv" data-testid="write-flow-written">
              <dt>Company</dt><dd>{base.name || NOT_RECORDED}</dd>
              <dt>Store</dt><dd><code>{review.store}</code> · {review.fund}</dd>
              {review.written.map((r) => (<React.Fragment key={r.key}><dt>{r.label}</dt><dd>{r.value}</dd></React.Fragment>))}
            </dl>
            <h4 className="pfw-eyebrow">Effect on {base.name || 'this company'}</h4>
            <table className="pfw-effect" data-testid="write-flow-effect">
              <thead><tr><th scope="col">Figure</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
              <tbody>
                {review.effect.map((r) => (
                  <tr key={r.key} data-testid={`effect-${r.key}`}>
                    <th scope="row">{r.label}</th>
                    <td data-label="Before">{r.before}</td>
                    <td data-label="After"><b>{r.after}</b>{r.note && <small>{r.note}</small>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {step === 'review' ? (
              <div className="pfw-actions">
                <button type="button" className="pfw-btn" onClick={() => setStep('prepare')} data-testid="write-flow-back">Back</button>
                <button type="button" className="pfw-btn is-primary" onClick={() => setStep('confirm')} data-testid="write-flow-continue">Continue to confirm</button>
              </div>
            ) : (
              <>
                <p className="pfw-note" data-testid="write-flow-confirm-note">
                  This is an admin act on {base.name || 'this company'}&apos;s position. It is recorded in the audit log under your name, and every
                  holder of the company sees the new figures on their next read. Before saving, the company is read again; if its {def.noun}s
                  changed, nothing is sent.
                </p>
                {failure && <FailureNote failure={failure} noun={def.noun} />}
                <div className="pfw-actions">
                  <button type="button" className="pfw-btn" onClick={() => setStep('review')} disabled={busy} data-testid="write-flow-back">Back</button>
                  <button type="button" className="pfw-btn is-primary" onClick={record_} disabled={busy} aria-busy={busy ? 'true' : undefined} data-testid="write-flow-confirm">
                    {busy ? 'Recording…' : failure ? `Try again: ${actLabel(kind, values, base)}` : actLabel(kind, values, base)}
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {step === 'conflict' && now && (
        <div className="pfw-body" data-testid="write-flow-conflict">
          <p className="pfw-alert is-warn" role="alert"><AlertTriangle size={14} aria-hidden="true" /> Not saved. Your draft is kept.</p>
          <table className="pfw-effect">
            <thead><tr><th scope="col"><span className="pfw-sr">Figure</span></th><th scope="col">When you started</th><th scope="col">Now</th><th scope="col">Your draft</th></tr></thead>
            <tbody>
              {kind === 'mark' ? (
                <tr data-testid="conflict-row">
                  <th scope="row">Latest mark</th>
                  <td data-label="When you started">{markWords(base.latestMark)}</td>
                  <td data-label="Now"><b>{markWords(now.latestMark)}</b></td>
                  <td data-label="Your draft">{`${day(values.as_of_date) || values.as_of_date} · ${money(payloadOf(kind, values).fmv) ?? NOT_RECORDED}`}</td>
                </tr>
              ) : (
                <tr data-testid="conflict-row">
                  <th scope="row">Distributions</th>
                  <td data-label="When you started">{distWords(base)}</td>
                  <td data-label="Now"><b>{distWords(now)}</b></td>
                  <td data-label="Your draft">{`${day(values.distribution_date) || values.distribution_date} · ${money(payloadOf(kind, values).amount) ?? NOT_RECORDED}`}</td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="pfw-foot">Read again just before saving. The Worker does not say who recorded the change or when it was saved.</p>
          <div className="pfw-actions">
            <button type="button" className="pfw-btn" onClick={() => onClose?.()} data-testid="write-flow-discard-draft">Discard my draft</button>
            <button type="button" className="pfw-btn is-primary" onClick={() => { setBase(now); setNow(null); setStep('review'); }} data-testid="write-flow-review-again">
              Review my draft against the new {kind === 'mark' ? 'mark' : 'distributions'}
            </button>
          </div>
        </div>
      )}

      {step === 'receipt' && (
        <div className="pfw-body" data-testid="write-flow-receipt">
          <p className="pfw-alert is-ok" role="status">
            <Check size={14} aria-hidden="true" />
            {record?.created_at ? `Saved by the Worker at ${stamp(record.created_at) || record.created_at}` : `Saved by the Worker; it returned no save time`}
          </p>
          <dl className="pfw-kv">
            <dt>Company</dt><dd>{base.name || NOT_RECORDED}</dd>
            {receiptOf(kind, record).map((r) => (<React.Fragment key={r.key}><dt>{r.label}</dt><dd data-testid={`receipt-${r.key}`}>{r.value}</dd></React.Fragment>))}
            <dt>Audit</dt><dd>Admin audit log · <code>{def.audit}</code></dd>
          </dl>
          <div className="pfw-actions">
            <button type="button" className="pfw-btn is-primary" onClick={() => onClose?.()} data-testid="write-flow-done">Back to {base.name || 'the company'}</button>
          </div>
        </div>
      )}
    </section>
  );
}

function markWords(mark) {
  return mark ? `${day(mark.as_of_date) || mark.as_of_date} · ${money(mark.fmv) ?? NOT_RECORDED}` : 'No mark recorded';
}

function distWords(base) {
  if (!base.distributionCount) return 'None recorded';
  const last = base.latestDistribution;
  return `${base.distributionCount} · ${money(base.distributed)} · latest ${day(last?.distribution_date) || NOT_RECORDED}`;
}

function FailureNote({ failure, noun }) {
  if (failure.kind === 'reread') {
    return (
      <div className="pfw-alert is-error" role="alert" data-testid="write-flow-failure">
        <X size={14} aria-hidden="true" />
        <div><b>Could not read the company again before saving.</b> {failure.message} Nothing was sent; your entries are kept.</div>
      </div>
    );
  }
  if (failure.kind === 'unknown') {
    return (
      <div className="pfw-alert is-error" role="alert" data-testid="write-flow-failure">
        <X size={14} aria-hidden="true" />
        <div><b>No answer from the Worker.</b> {failure.message} Whether the {noun} was recorded is not known; your entries are kept. Trying again reads the company first, so a {noun} that did land shows as a change.</div>
      </div>
    );
  }
  return (
    <div className="pfw-alert is-error" role="alert" data-testid="write-flow-failure">
      <X size={14} aria-hidden="true" />
      <div><b>Couldn&apos;t save.</b> {failure.message} Nothing was recorded; your entries are kept.</div>
    </div>
  );
}
