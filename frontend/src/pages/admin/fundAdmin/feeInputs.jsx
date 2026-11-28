import { useState } from 'react';
import { Lightbox } from '../../../ui';
import { BTN, INPUT, LoadingRows } from '../../account/AccountCenter';
import { NUM } from './parts';
import { useRead } from './useRead';
import {
  AXAL_ENTITIES, BASIS_AFTER, DRAFT_NOTE, EFFECTIVE_HINT, FIRST_VERSION_NOTE, SOURCE_MAX,
  admissionBody, companyOptions, confirmedTerms, netInvestedBody, offsetBody, refusalLines, termsBody, termsForm,
} from './feeInputsModel';

/**
 * D9107 (#9107): the Fees tab's four recording dialogs (`fee.write`, any HQ
 * Admin): Record fee terms, Record an admission date, Record net invested
 * capital and Record an offset. No FND board draws them; each follows FND12's
 * Record a mark (labelled fields, a required source of up to 500 characters,
 * an info line, Cancel and a primary button) and is a bottom sheet on a phone.
 * A refusal is shown inside the dialog as the Worker's sentences, and the
 * dialog keeps what was typed. Nothing here moves money.
 */
const LABEL = 'flex flex-col gap-1 text-[13px] font-semibold text-zinc-700 dark:text-gray-200';
const HINT = 'm-0 text-[12px] font-normal text-axal-muted dark:text-gray-400';
const INFO = 'm-0 rounded-axal-sm border border-axal-hairline bg-gray-50 px-3 py-2 text-[12px] text-axal-ink dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-100';

function useRecord(onDone) {
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState([]);
  const run = async (out, fn, fallback) => {
    if (out.error) { setLines([out.error]); return; }
    setBusy(true); setLines([]);
    try { await fn(out.body); } catch (e) { setLines(refusalLines(e, fallback)); setBusy(false); return; }
    setBusy(false);
    await onDone();
  };
  return { busy, lines, run };
}

function RecordDialog({ title, sub, testId, submit, busy, lines, onSubmit, onClose, disabled = false, children }) {
  return (
    <Lightbox label={title} title={title} sub={sub} testId={testId} onClose={onClose} width={520} phone="sheet">
      <form className="flex flex-col gap-3 px-5 py-4" noValidate data-testid={`${testId}-form`}
        onSubmit={(e) => { e.preventDefault(); if (!busy && !disabled) onSubmit(); }}>
        {children}
        {lines.length > 0 && <div role="alert" className="flex flex-col gap-1 text-[12px] text-red-700 dark:text-red-300" data-testid={`${testId}-error`}>
          {lines.map((l) => <p key={l} className="m-0">{l}</p>)}
        </div>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={BTN.primary} disabled={busy || disabled} data-testid={`${testId}-submit`}>{submit}</button>
        </div>
      </form>
    </Lightbox>
  );
}

const Source = ({ value, onChange, busy, testId }) => (
  <label className={LABEL}>Source · required · up to {SOURCE_MAX} characters
    <textarea rows={2} maxLength={SOURCE_MAX + 50} className={INPUT} value={value} onChange={onChange} disabled={busy} data-testid={testId} />
  </label>
);

/** Record fee terms: a new draft version. The first takes effect on its fee start date; a later one on the date given. */
export function TermsDialog({ apis, fund, state, onClose, onDone }) {
  const hasConfirmed = confirmedTerms(state?.terms).length > 0;
  const [form, setForm] = useState(() => termsForm(state));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { busy, lines, run } = useRecord(onDone);
  return (
    <RecordDialog title="Record fee terms" sub={`${fund.name}. A new version of the management fee terms.`} testId="fee-terms-dialog" submit="Record terms"
      busy={busy} lines={lines} onClose={onClose}
      onSubmit={() => run(termsBody(form, { hasConfirmed }), (b) => apis.fees.recordTerms(fund.id, b), 'The fee terms could not be recorded.')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>Annual rate (%)<input className={`${INPUT} ${NUM}`} inputMode="decimal" value={form.rate} onChange={set('rate')} disabled={busy} data-testid="fee-terms-rate" /></label>
        <label className={LABEL}>Offset share (%)<input className={`${INPUT} ${NUM}`} inputMode="decimal" value={form.offset} onChange={set('offset')} disabled={busy} data-testid="fee-terms-offset" /></label>
      </div>
      <label className={LABEL}>Basis after the investment period
        <select className={INPUT} value={form.basis} onChange={set('basis')} disabled={busy} data-testid="fee-terms-basis">
          {BASIS_AFTER.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>Fee start date
          <input type="date" className={`${INPUT} ${NUM}`} value={form.start} onChange={set('start')} disabled={busy} readOnly={hasConfirmed} data-testid="fee-terms-start" />
          {hasConfirmed && <span className={HINT}>Every version keeps the first confirmed fee start date.</span>}
        </label>
        <label className={LABEL}>Investment period ends<input type="date" className={`${INPUT} ${NUM}`} value={form.periodEnd} onChange={set('periodEnd')} disabled={busy} data-testid="fee-terms-period-end" /></label>
      </div>
      {hasConfirmed
        ? <label className={LABEL}>Takes effect
          <input type="date" className={`${INPUT} ${NUM}`} value={form.effective} onChange={set('effective')} disabled={busy} data-testid="fee-terms-effective" />
          <span className={HINT}>{EFFECTIVE_HINT}</span>
        </label>
        : <p className={HINT} data-testid="fee-terms-first">{FIRST_VERSION_NOTE}</p>}
      <label className={LABEL}>LPA reference · up to {SOURCE_MAX} characters
        <input className={INPUT} maxLength={SOURCE_MAX + 50} value={form.lpa} onChange={set('lpa')} disabled={busy} data-testid="fee-terms-lpa" />
      </label>
      <p className={INFO}>{DRAFT_NOTE}</p>
    </RecordDialog>
  );
}

/** Record (or change) one LP's admission date. */
export function AdmissionDialog({ apis, fund, lp, onClose, onDone }) {
  const [form, setForm] = useState({ date: lp.admitted_on || '', label: lp.closing_label || '', source: lp.source || '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { busy, lines, run } = useRecord(onDone);
  return (
    <RecordDialog title="Record an admission date" sub={`LP #${lp.id} · ${fund.name}. The date this LP was admitted, which the fee counts from.`} testId="fee-admission-dialog"
      submit="Record date" busy={busy} lines={lines} onClose={onClose}
      onSubmit={() => run(admissionBody(form), (b) => apis.fees.recordAdmission(fund.id, lp.id, b), 'The admission date could not be recorded.')}>
      <label className={LABEL}>Admitted on<input type="date" className={`${INPUT} ${NUM}`} value={form.date} onChange={set('date')} disabled={busy} data-testid="fee-admission-date" /></label>
      <label className={LABEL}>Closing · optional<input className={INPUT} maxLength={200} placeholder="Second close" value={form.label} onChange={set('label')} disabled={busy} data-testid="fee-admission-label" /></label>
      <Source value={form.source} onChange={set('source')} busy={busy} testId="fee-admission-source" />
      <p className={INFO}>Once this LP has an issued fee line, its admission date is fixed.</p>
    </RecordDialog>
  );
}

/** Record the fund's net invested capital as of a date. Every record is kept. */
export function NetInvestedDialog({ apis, fund, onClose, onDone }) {
  const [form, setForm] = useState({ asOf: '', amount: '', source: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { busy, lines, run } = useRecord(onDone);
  return (
    <RecordDialog title="Record net invested capital" sub={`${fund.name}. The fund's net invested capital on a date.`} testId="fee-net-dialog"
      submit="Record net invested" busy={busy} lines={lines} onClose={onClose}
      onSubmit={() => run(netInvestedBody(form), (b) => apis.fees.recordNetInvested(fund.id, b), 'Net invested capital could not be recorded.')}>
      <label className={LABEL}>As of<input type="date" className={`${INPUT} ${NUM}`} value={form.asOf} onChange={set('asOf')} disabled={busy} data-testid="fee-net-as-of" /></label>
      <label className={LABEL}>Net invested capital ($)<input className={`${INPUT} ${NUM}`} inputMode="decimal" placeholder="1,200.50" value={form.amount} onChange={set('amount')} disabled={busy} data-testid="fee-net-amount" /></label>
      <Source value={form.source} onChange={set('source')} busy={busy} testId="fee-net-source" />
      <p className={INFO}>Records are dated and kept. A period uses the latest one on or before each day it counts.</p>
    </RecordDialog>
  );
}

/** Record an offset against a portfolio company of this fund, picked from its positions (read when the dialog opens). */
export function OffsetDialog({ apis, fund, onClose, onDone }) {
  const positions = useRead(() => apis.performance.positions(fund.id), [apis, fund.id]);
  const options = companyOptions(positions.data);
  const [form, setForm] = useState({ project: '', entity: 'management', amount: '', receivedOn: '', description: '', source: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { busy, lines, run } = useRecord(onDone);
  const ready = positions.status === 'ready' && options.length > 0;
  let picker;
  if (positions.status === 'loading' || positions.status === 'idle') picker = <div aria-busy="true" data-testid="fee-offset-companies-loading"><LoadingRows lines={1} /></div>;
  else if (positions.status === 'unreadable') {
    picker = <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="fee-offset-companies-unreadable">
      This fund's companies could not be read. This is not a claim that there are none. <button type="button" className="min-h-11 underline" onClick={positions.reload}>Try again</button></p>;
  } else if (!options.length) picker = <p className={HINT} data-testid="fee-offset-companies-empty">No position is attributed to this fund yet.</p>;
  else {
    picker = <select className={INPUT} value={form.project} onChange={set('project')} disabled={busy} data-testid="fee-offset-company">
      <option value="">Choose a company</option>
      {options.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
    </select>;
  }
  return (
    <RecordDialog title="Record an offset" sub={`${fund.name}. A fee an Axal entity received from a portfolio company, which reduces the management fee.`} testId="fee-offset-dialog"
      submit="Record offset" busy={busy} lines={lines} onClose={onClose} disabled={!ready}
      onSubmit={() => run(offsetBody(form), (b) => apis.fees.recordOffset(fund.id, b), 'The offset could not be recorded.')}>
      <div className={LABEL}><span>Portfolio company of this fund</span>{picker}</div>
      <label className={LABEL}>Axal entity
        <select className={INPUT} value={form.entity} onChange={set('entity')} disabled={busy} data-testid="fee-offset-entity">
          {AXAL_ENTITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>Amount ($)<input className={`${INPUT} ${NUM}`} inputMode="decimal" placeholder="1,200.00" value={form.amount} onChange={set('amount')} disabled={busy} data-testid="fee-offset-amount" /></label>
        <label className={LABEL}>Received on<input type="date" className={`${INPUT} ${NUM}`} value={form.receivedOn} onChange={set('receivedOn')} disabled={busy} data-testid="fee-offset-received" /></label>
      </div>
      <label className={LABEL}>Description<input className={INPUT} maxLength={SOURCE_MAX + 50} placeholder="Transaction fee" value={form.description} onChange={set('description')} disabled={busy} data-testid="fee-offset-description" /></label>
      <Source value={form.source} onChange={set('source')} busy={busy} testId="fee-offset-source" />
      <p className={INFO}>An offset is marked counted in the fee period that applies it, when that period is issued.</p>
    </RecordDialog>
  );
}
