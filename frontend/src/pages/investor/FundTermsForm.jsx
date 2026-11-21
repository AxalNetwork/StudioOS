/**
 * #6235 — Create a fund record (FV1b, on the Fund overview's no-fund state) and
 * Edit terms (on the fund page), for the general partner of record. The rules
 * and sentences are in `fundTermsModel.js`; this file only draws them.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import {
  CREATING_DOES, EDIT_TERMS_LINE, FUND_STATUSES, MY_COMMITMENT_LINE, NO_FUND_KICKER, NO_FUND_LINE, NO_FUND_TITLE, RATES_LINE,
  blankFund, createFund, saveTerms, termsForm,
} from './fundTermsModel';
import './fundTerms.css';

const defaultClient = {
  create: (body) => api.fundsCreateV2(body),
  update: (id, body) => api.fundUpdate(id, body),
  read: (id) => api.fundGet(id),
};

function Field({ id, label, hint, children }) {
  return <div className="ft-field"><label htmlFor={id}>{label}{hint && <span> {hint}</span>}</label>{children}</div>;
}

function TermsFields({ prefix, form, set, withReason = false }) {
  const input = (key, extra = {}) => ({
    id: `${prefix}-${key}`, value: form[key], 'data-testid': `input-${prefix}-${key}`,
    onChange: (event) => set(key, event.target.value), ...extra,
  });
  return (
    <div className="ft-grid">
      <Field id={`${prefix}-name`} label="Fund name"><input {...input('name', { required: true, maxLength: 200 })} /></Field>
      <Field id={`${prefix}-vintage`} label="Vintage year"><input {...input('vintage', { inputMode: 'numeric', placeholder: '2026' })} /></Field>
      <Field id={`${prefix}-size`} label="Fund size" hint="(USD)"><input {...input('size', { inputMode: 'decimal', placeholder: '40,000,000.00' })} /></Field>
      <Field id={`${prefix}-status`} label="Status">
        <select {...input('status')}>{FUND_STATUSES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      </Field>
      <Field id={`${prefix}-fee`} label="Management fee" hint="(%)"><input {...input('fee', { inputMode: 'decimal', placeholder: '2.0' })} /></Field>
      <Field id={`${prefix}-carry`} label="Carry" hint="(%)"><input {...input('carry', { inputMode: 'decimal', placeholder: '20.0' })} /></Field>
      {withReason && (
        <div className="ft-field ft-wide">
          <label htmlFor={`${prefix}-reason`}>Reason <span>(needed when the fee or the carry changes)</span></label>
          <textarea {...input('reason', { rows: 2, maxLength: 500 })} />
        </div>
      )}
    </div>
  );
}

/** FV1b: the no-fund state's create form. `onCreated(fund)` runs once the Worker returns the new fund. */
export function CreateFundCard({ client = defaultClient, onCreated }) {
  const [form, setForm] = useState(blankFund);
  const [state, setState] = useState({ busy: false, error: null });
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const submit = async (event) => {
    event?.preventDefault?.();
    setState({ busy: true, error: null });
    const out = await createFund(client, form);
    if (out.error) { setState({ busy: false, error: out.error }); return; }
    setState({ busy: false, error: null });
    onCreated?.(out.fund);
  };
  return (
    <section className="ft-card" data-testid="fund-create-card" aria-labelledby="fund-create-title">
      <span className="ft-kicker">{NO_FUND_KICKER}</span>
      <h2 id="fund-create-title">{NO_FUND_TITLE}</h2>
      <p className="ft-cap">{NO_FUND_LINE}</p>
      <form onSubmit={submit} noValidate data-testid="form-fund-create">
        <TermsFields prefix="fund-create" form={form} set={set} />
        <p className="ft-cap">{RATES_LINE}</p>
        <div className="ft-note"><strong>What creating does</strong><p>{CREATING_DOES}</p></div>
        {state.error && <p className="ft-error" role="alert" data-testid="text-fund-create-error">{state.error}</p>}
        <div className="ft-actions">
          <button type="submit" className="ft-primary" disabled={state.busy} data-testid="button-fund-create">{state.busy ? 'Creating…' : 'Create a fund'}</button>
        </div>
      </form>
      <p className="ft-cap">{MY_COMMITMENT_LINE} <Link to="/spinout-lab/investor-workspace#my-commitment" data-testid="link-fund-create-my-commitment">My commitment</Link></p>
    </section>
  );
}

/** Edit terms on `/funds/:id`, for a manager of the fund. Reads the stored row first so only what changed is sent. */
export function EditTermsCard({ fundId, client = defaultClient, onSaved, onClose }) {
  const [read, setRead] = useState({ loading: true, fund: null, error: null });
  const [form, setForm] = useState(null);
  const [state, setState] = useState({ busy: false, error: null });
  const load = useCallback(() => {
    let live = true;
    setRead({ loading: true, fund: null, error: null });
    Promise.resolve().then(() => client.read(fundId)).then(
      (r) => {
        if (!live) return;
        if (!r?.fund || Number(r.fund.id) !== Number(fundId)) { setRead({ loading: false, fund: null, error: 'Unreadable' }); return; }
        setRead({ loading: false, fund: r.fund, error: null });
        setForm(termsForm(r.fund));
      },
      () => { if (live) setRead({ loading: false, fund: null, error: 'Unreadable' }); },
    );
    return () => { live = false; };
  }, [client, fundId]);
  useEffect(() => load(), [load]);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const submit = async (event) => {
    event?.preventDefault?.();
    setState({ busy: true, error: null });
    const out = await saveTerms(client, fundId, form, read.fund);
    if (out.error) { setState({ busy: false, error: out.error }); return; }
    setState({ busy: false, error: null });
    onSaved?.(out.fund);
  };
  return (
    <section className="ft-card" data-testid="fund-edit-terms" aria-labelledby="fund-edit-title">
      <h2 id="fund-edit-title">Edit terms</h2>
      <p className="ft-cap">{EDIT_TERMS_LINE}</p>
      {read.loading ? <p aria-busy="true">Reading the fund’s recorded terms…</p>
        : read.error ? (
          <div role="alert" data-testid="text-fund-terms-unreadable"><strong>Unreadable</strong><p>The fund’s recorded terms could not be read, so nothing can be edited yet.</p>
            <button type="button" onClick={load}>Try again</button> <button type="button" onClick={onClose}>Close</button></div>
        ) : (
          <form onSubmit={submit} noValidate data-testid="form-fund-edit-terms">
            <TermsFields prefix="fund-terms" form={form} set={set} withReason />
            {state.error && <p className="ft-error" role="alert" data-testid="text-fund-terms-error">{state.error}</p>}
            <div className="ft-actions">
              <button type="submit" className="ft-primary" disabled={state.busy} data-testid="button-fund-terms-save">{state.busy ? 'Saving…' : 'Save terms'}</button>
              <button type="button" onClick={onClose} disabled={state.busy} data-testid="button-fund-terms-cancel">Cancel</button>
            </div>
          </form>
        )}
    </section>
  );
}
