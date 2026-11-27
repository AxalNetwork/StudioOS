/**
 * D7715 (#7715) — the Record observation sheet on one HQ market (`/admin/licences/pricing/country/:code`), drawn by
 * canvas LCD-02 A to C, its second mode LCD-03 A to C (owner Q9 A), LCD-05, phone LCD-06 D and E and dark LCD-07 C
 * and D (D7703). Super Admin at HQ.
 *
 * Record a value sends `POST …/countries/:code/observations` (field, value, status, source, reference, as-of date,
 * reason); Change a field's status sends `PUT …/countries/:code/fields/:field/status` (Provisional, or Not recorded
 * after a confirm step that lists what is cleared). Both name the revision read on screen (`revision`), never one
 * typed, and go through the write bar (the shared StepUpModal through `request()`).
 *
 * A REFUSAL KEEPS THE SHEET AND THE TYPED VALUES. The Worker's sentence sits on top, its problems on their fields
 * (aria-describedby), and focus moves to the first field in error. A stale revision (409) says the revision now and
 * offers to read the country again; the typed values stay. Nothing on the page changes unless the Worker wrote.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Sheet } from '../../../ui';
import {
  OBSERVED_FIELDS, fieldLabel, fieldUnit, fieldValueWords, formErrors, observationBody, profileField, refusalOf, statusBody,
  statusChoices, statusWord,
} from './pricingHqModel';
import { ReasonField, WriteBar, badBox, fieldInput, ghostBtn, infoBox, primaryBtn, warnBox } from './PricingImportSheet';

const ERROR_ORDER = ['field', 'value', 'status', 'source', 'source_ref', 'as_of', 'reason'];
const label = 'text-[12px] font-semibold text-gray-800 dark:text-gray-200';
const hint = 'font-normal text-gray-500 dark:text-gray-400';

function Err({ id, text }) {
  if (!text) return null;
  return <span id={id} className="mt-1 block text-[12px] font-semibold text-rose-700 dark:text-rose-300" data-testid={id}>✕ {text}</span>;
}

function Field({ id, title, note, error, children }) {
  return (
    <div className="flex flex-col">
      <label htmlFor={id} className={label}>{title}{note ? <span className={hint}> · {note}</span> : null}</label>
      <div className="mt-1">{children}</div>
      <Err id={`${id}-err`} text={error} />
    </div>
  );
}

function Radios({ name, options, value, onChange, testId }) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2" data-testid={testId}>
      {options.map((o) => (
        <button
          key={o} type="button" role="radio" aria-checked={o === value} onClick={() => onChange(o)} data-testid={`${testId}-${o}`}
          className={`min-h-[32px] rounded-full border px-3 text-[12.5px] font-semibold max-sm:min-h-[44px] ${o === value
            ? 'border-violet-600 bg-violet-50 text-violet-800 dark:border-violet-500 dark:bg-violet-950/40 dark:text-violet-200'
            : 'border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300'}`}
        >
          {o === value ? '● ' : '○ '}{statusWord(o)}
        </button>
      ))}
    </div>
  );
}

/**
 * `country` `{ code, name }`; `profile` the profile read on screen (its `revision` is the expected revision);
 * `readAt` when it was read; `api` `{ recordObservation, setFieldStatus }`; `onWritten({ live, revision, field })`
 * after the Worker wrote; `onReload()` reads the country again after a stale revision.
 */
export default function PricingObservationSheet({ country, profile, readAt, api, onClose, onWritten, onReload, initialField = 'population', announce = () => {} }) {
  const revision = profile?.revision ?? null;
  const [mode, setMode] = useState('record');
  const [form, setForm] = useState({ field: initialField, value: '', status: 'recorded', source: '', source_ref: '', as_of: '', reason: '' });
  const [newStatus, setNewStatus] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState(null);
  const [unknown, setUnknown] = useState(false);
  const top = useRef(null);

  const now = profileField(profile, form.field);
  const choices = statusChoices(form.field, now);
  const errors = formErrors(refused);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const name = country?.name || country?.code;

  // A rank is recorded or not: switching to one drops a Provisional choice (LCD-02, LCD-03 C).
  useEffect(() => {
    if (!choices.record.includes(form.status)) setForm((f) => ({ ...f, status: 'recorded' }));
    setNewStatus((s) => (choices.status.includes(s) ? s : null));
    setConfirming(false);
  }, [form.field]); // eslint-disable-line react-hooks/exhaustive-deps

  // A stale-revision notice is answered by the read: once the page holds a newer revision, it is gone.
  useEffect(() => { setRefused((r) => (r?.code === 'profile_conflict' && r.currentRevision !== null && r.currentRevision <= revision ? null : r)); }, [revision]);

  // A Worker problem moves focus to the first field in error (LCD-08).
  useEffect(() => {
    if (!refused || typeof document === 'undefined') return;
    const first = ERROR_ORDER.find((k) => errors[k]);
    const el = first && document.getElementById?.(`pricing-obs-${first}`);
    (el || top.current)?.focus?.();
  }, [refused]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (call, live) => {
    if (sending || revision === null) return;
    setSending(true);
    setRefused(null);
    setUnknown(false);
    try {
      const res = await call();
      const rev = res?.profile?.revision ?? null;
      const said = `${live}${rev !== null ? ` Revision ${rev}.` : ''}`;
      announce(said);
      onWritten({ live: said, revision: rev, field: form.field });
    } catch (e) {
      const r = refusalOf(e);
      if (r.answered) { setRefused(r); announce(r.sentence, 'assertive'); } else { setUnknown(true); announce('No answer came back from the Worker. Your typed values are kept.', 'assertive'); }
    } finally {
      setSending(false);
    }
  };

  const record = () => run(
    () => api.recordObservation(country.code, observationBody(form, revision)),
    `${fieldLabel(form.field)} recorded for ${name}.`,
  );
  const mark = () => {
    if (!newStatus) return;
    if (newStatus === 'not_recorded' && !confirming) { setConfirming(true); return; }
    run(
      () => api.setFieldStatus(country.code, form.field, statusBody(newStatus, form.reason, revision)),
      `${fieldLabel(form.field)} marked ${statusWord(newStatus)} for ${name}.`,
    );
  };
  const close = () => { if (!sending) onClose(); };

  const banner = (
    <>
      {refused?.code === 'profile_conflict' ? (
        <div className={warnBox} role="alert" tabIndex={-1} ref={top} data-testid="pricing-obs-conflict">
          <p>! {refused.sentence}{refused.currentRevision !== null ? ` It is at revision ${refused.currentRevision} now.` : ''} Your typed values are kept below.</p>
          <button type="button" className={`${ghostBtn} mt-2`} onClick={onReload} data-testid="pricing-obs-reload">Reload {name}</button>
        </div>
      ) : refused ? (
        <p className={badBox} role="alert" tabIndex={-1} ref={top} data-testid="pricing-obs-refused">
          ✕ {refused.sentence} Nothing was saved.{Object.keys(refused.fields).length ? ' Each problem is shown on its field in the Worker’s words.' : ''}
        </p>
      ) : null}
      {unknown && (
        <p className={badBox} role="alert" data-testid="pricing-obs-unknown">
          ✕ No answer came back from the Worker. Your typed values are kept. {mode === 'record' ? 'Record observation' : 'The status change'} sends the same revision, so a second try either saves once or says the country changed.
        </p>
      )}
    </>
  );

  const fieldSelect = (
    <Field id="pricing-obs-field" title="Field" error={errors.field}>
      <select
        id="pricing-obs-field" value={form.field} onChange={(e) => set('field')(e.target.value)} disabled={sending} className={fieldInput}
        aria-invalid={errors.field ? 'true' : undefined} aria-describedby={errors.field ? 'pricing-obs-field-err' : undefined} data-testid="pricing-obs-field-input"
      >
        {OBSERVED_FIELDS.map((f) => <option key={f} value={f}>{fieldLabel(f)}</option>)}
      </select>
    </Field>
  );

  const input = (k, props = {}) => (
    <input
      id={`pricing-obs-${k}`} value={form[k]} onChange={(e) => set(k)(e.target.value)} disabled={sending} className={`${fieldInput} ${props.mono ? 'font-mono' : ''}`}
      aria-invalid={errors[k] ? 'true' : undefined} aria-describedby={errors[k] ? `pricing-obs-${k}-err` : undefined}
      placeholder={props.placeholder} inputMode={props.inputMode} data-testid={`pricing-obs-${k}-input`}
    />
  );

  let body;
  let footer;
  if (mode === 'record') {
    body = (
      <>
        {fieldSelect}
        <Field id="pricing-obs-value" title="Value" note={`a whole number · ${fieldUnit(form.field)}`} error={errors.value}>
          {input('value', { mono: true, inputMode: 'numeric', placeholder: 'a whole number' })}
        </Field>
        <Field id="pricing-obs-status" title="Status" error={errors.status}>
          <Radios name="Status" options={choices.record} value={form.status} onChange={set('status')} testId="pricing-obs-status" />
          {form.field === 'startup_ecosystem_rank' && <p className="mt-1 text-[12px] text-gray-600 dark:text-gray-400">A rank is recorded or not; there is no provisional rank.</p>}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pricing-obs-source" title="Source" error={errors.source}>{input('source', { placeholder: 'Name the source' })}</Field>
          <Field id="pricing-obs-source_ref" title="Reference" note="optional" error={errors.source_ref}>{input('source_ref', { mono: true })}</Field>
        </div>
        <Field id="pricing-obs-as_of" title="As of" note="the date the value is true as of, YYYY-MM-DD" error={errors.as_of}>
          {input('as_of', { mono: true, placeholder: 'YYYY-MM-DD' })}
        </Field>
        <WriteBar what={`record an observation for ${name}`} />
        <ReasonField id="pricing-obs-reason" value={form.reason} onChange={set('reason')} disabled={sending} error={errors.reason} />
      </>
    );
    footer = (
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={ghostBtn} onClick={close} disabled={sending} data-testid="pricing-obs-cancel">Cancel</button>
        <button type="button" className={primaryBtn} onClick={record} disabled={sending || revision === null} data-testid="pricing-obs-send">
          {sending ? 'Recording…' : 'Record observation'}
        </button>
      </div>
    );
  } else {
    const has = now.value !== null && now.value !== undefined;
    body = (
      <>
        {fieldSelect}
        <p className={`${infoBox} flex flex-wrap gap-x-3 gap-y-1`} data-testid="pricing-obs-now">
          <span className="font-semibold">Now</span>
          <span className="font-mono">{fieldValueWords(form.field, now.value)}</span>
          <span>{statusWord(now.status)}</span>
          {now.source && <span>{now.source}{now.source_ref ? ` · ${now.source_ref}` : ''}</span>}
          {now.as_of && <span className="font-mono">{now.as_of}</span>}
        </p>
        {choices.status.length === 0 ? (
          <p className="text-[12.5px] text-gray-700 dark:text-gray-300" data-testid="pricing-obs-status-none">
            {fieldLabel(form.field)} is Not recorded, so there is no status to change: it offers only Record a value.
          </p>
        ) : (
          <Field id="pricing-obs-new-status" title="New status" error={errors.status}>
            <Radios name="New status" options={choices.status} value={newStatus} onChange={(s) => { setNewStatus(s); setConfirming(false); }} testId="pricing-obs-new-status" />
            <p className="mt-1 text-[12px] text-gray-600 dark:text-gray-400">
              {form.field === 'startup_ecosystem_rank'
                ? 'A rank is Recorded or Not recorded; Provisional is not offered. To change the rank itself, use Record a value.'
                : 'Provisional keeps the value, source and date; pricing uses it only when HQ allows provisional inputs. Offered only when a value exists.'}
            </p>
          </Field>
        )}
        {confirming && newStatus === 'not_recorded' && has && (
          <div className={warnBox} data-testid="pricing-obs-confirm">
            <p className="font-semibold">Confirm: mark {fieldLabel(form.field)} Not recorded</p>
            <p className="mt-1">This clears, on the current profile:</p>
            <ul className="mt-1 list-disc pl-5">
              <li>Value {fieldValueWords(form.field, now.value)}</li>
              {now.source && <li>Source {now.source}</li>}
              {now.source_ref && <li>Reference {now.source_ref}</li>}
              {now.as_of && <li>As-of date {now.as_of}</li>}
            </ul>
            <p className="mt-1">The history is kept: every earlier row stays, and a new row records this change with your reason.</p>
            <p className="mt-1 font-semibold">! {name} cannot be priced until this field is recorded again. The model needs every input; it never prices from a guessed or zero value. Snapshots already frozen do not change.</p>
          </div>
        )}
        {choices.status.length > 0 && (
          <>
            <WriteBar what={`${newStatus === 'provisional' ? 'mark' : 'clear'} ${fieldLabel(form.field).toLowerCase()}`} />
            <ReasonField id="pricing-obs-reason" value={form.reason} onChange={set('reason')} disabled={sending} error={errors.reason} />
          </>
        )}
      </>
    );
    footer = (
      <div className="flex flex-wrap justify-end gap-2">
        {confirming
          ? <button type="button" className={ghostBtn} onClick={() => setConfirming(false)} disabled={sending} data-testid="pricing-obs-back">Back</button>
          : <button type="button" className={ghostBtn} onClick={close} disabled={sending} data-testid="pricing-obs-cancel">Cancel</button>}
        <button type="button" className={primaryBtn} onClick={mark} disabled={sending || !newStatus || revision === null} data-testid="pricing-obs-mark">
          {sending ? 'Saving…' : newStatus === 'provisional' ? 'Mark Provisional' : 'Mark Not recorded'}
        </button>
      </div>
    );
  }

  return (
    <Sheet
      eyebrow={`Super Admin · ${name}`} title={mode === 'record' ? 'Record observation' : 'Change a field’s status'}
      onClose={close} onEscape={close} footer={footer} width={640} phone="sheet" testId="pricing-obs-sheet" focusKey={`${mode}-${confirming}`}
    >
      <div className="flex flex-col gap-3.5 px-5 py-4">
        <div role="radiogroup" aria-label="What to change" className="flex gap-1 rounded-lg border border-gray-200 p-1 dark:border-gray-800" data-testid="pricing-obs-mode">
          {[['record', 'Record a value'], ['status', 'Change a field’s status']].map(([k, t]) => (
            <button
              key={k} type="button" role="radio" aria-checked={mode === k} disabled={sending} data-testid={`pricing-obs-mode-${k}`}
              onClick={() => { setMode(k); setRefused(null); setUnknown(false); setConfirming(false); }}
              className={`min-h-[32px] flex-1 rounded-md px-2 text-[12.5px] font-bold max-sm:min-h-[44px] ${mode === k ? 'bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200' : 'text-gray-600 dark:text-gray-400'}`}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="text-[12.5px] text-gray-700 dark:text-gray-300" data-testid="pricing-obs-revision">
          You are changing revision <span className="font-mono font-semibold">{revision ?? 'Not recorded'}</span> of {name}{readAt ? `, read at ${readAt} UTC` : ''}.
        </p>
        {banner}
        {body}
      </div>
    </Sheet>
  );
}
