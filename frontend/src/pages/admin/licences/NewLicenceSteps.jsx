/**
 * D4819 part 5 (#5931) — New licence steps 1 and 3 to 6 (Licences v2 boards L41 to L47): Legal entity, Commercial
 * terms, Administrators, Agreement and Issue, each one step card with Back and its primary action at the bottom
 * right. Step 2, Territory, is L21's own (#5929) and is not drawn here.
 *
 * `NewLicenceStep` is what L21's frame puts in its card slot: `step` is the step's index (0 to 5), `licence` the
 * draft once step 1 has created it (null before), `onLicence` takes a fresh draft, `onStep` moves to another step.
 * It keeps every step's typed values while the person moves between steps, so Edit from the review, a refusal on
 * Issue or a failed save never clears what was entered. The rules are `newLicenceModel.js`. It reuses the licence
 * page's own pieces: `SeatFields` (`CommercialTerms.jsx`), `useLicenceAdmins` (`AdminsEditor.jsx`),
 * `useLicenceContract` (`ContractStep.jsx`) and the consequence sheet's four questions (L17).
 *
 * Saving the money terms, the brand kit and appointing an administrator take the Super Admin write bar; the code is
 * asked for by the shell's one step-up sheet (`components/StepUpModal.jsx`), and cancelling it keeps every value.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { TOKEN_SPLIT_HQ_LABEL } from '../../../lib/tokenSplit';
import { describeOutcome, outcomeFromError, outcomeOfError } from '../../../lib/mutationOutcome';
import { SEAT_TYPES } from './licenceShared';
import { SeatFields } from './CommercialTerms';
import { useLicenceAdmins } from './AdminsEditor';
import { useLicenceContract } from './ContractStep';
import { currentContract } from './agreementLifecycleModel';
import {
  KIND_CARDS, NEW_LICENCE_STEPS, REASON_MIN, REASON_SHORT, blankEntityForm, blockerStep, dayText, entityFormFrom,
  issueConsequence, issueOutcome, issueRefusal, placeRefusal, planBrand, planCreate, planEntity, planTerms,
  proposeRenewal, refusalSentence, reviewGroups, seatsTotalLine, shortHash, templateState, termsFormFrom, unfilledWhere,
} from './newLicenceModel';

/* ------------------------------------------------------------------ shared */

const INPUT = 'w-full rounded-md border bg-white px-2.5 py-1.5 text-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100 max-md:min-h-[44px]';
const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800 max-md:min-h-[44px]';
const PRIMARY = 'inline-flex min-h-[36px] items-center justify-center gap-1 rounded-md bg-violet-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50 max-md:min-h-[44px]';
const TAG = 'ml-1 text-[11px] font-medium text-gray-500 dark:text-gray-400';

/** Focus the first field in error (L46: "Focus moves to the first field in error"). */
function focusFirst(errors, idOf) {
  const first = Object.keys(errors || {})[0];
  if (!first) return;
  try { globalThis.document?.getElementById?.(idOf(first))?.focus?.(); } catch { /* no DOM */ }
}

/**
 * One labelled field. Its error sits on the field's own line and is tied to it with `aria-describedby`, as is its
 * help line; `aria-invalid` marks it. The typed value is never cleared by an error.
 */
function TextField({ id, label, value, onChange, error, help, tag, readOnly, mono, suffix, prefix, placeholder, area, inputMode, type = 'text', testId }) {
  const described = [error ? `${id}-e` : null, help ? `${id}-h` : null].filter(Boolean).join(' ') || undefined;
  const props = {
    id, value: value ?? '', readOnly, placeholder, inputMode,
    onChange: readOnly ? undefined : (e) => onChange?.(e.target.value),
    'aria-invalid': error ? 'true' : undefined, 'aria-describedby': described, 'aria-readonly': readOnly ? 'true' : undefined,
    'data-testid': testId || id,
    className: `${INPUT} ${mono ? 'font-mono' : ''} ${error ? 'border-red-600 dark:border-red-400' : 'border-gray-300 dark:border-gray-700'} ${readOnly ? 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300' : ''}`,
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">
        {label}{tag ? <span className={TAG}>{tag}</span> : null}
      </label>
      <div className="flex items-center gap-2">
        {prefix}
        {area ? <textarea rows={2} {...props} /> : <input type={type} {...props} />}
        {suffix ? <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{suffix}</span> : null}
      </div>
      {error ? <small id={`${id}-e`} className="text-xs text-red-700 dark:text-red-300" data-testid={`${id}-error`}><span aria-hidden="true">✕ </span>{error}</small> : null}
      {help ? <small id={`${id}-h`} className="text-xs text-gray-500 dark:text-gray-400">{help}</small> : null}
    </div>
  );
}

/** A notice: a refusal or an unknown interrupts (`alert`), the rest is polite (`status`). */
function Notice({ tone = 'red', children, action, testId }) {
  const tones = {
    red: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100',
    amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
    green: 'border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-100',
  };
  return (
    <div role={tone === 'green' ? 'status' : 'alert'} data-testid={testId} className={`flex flex-wrap items-start gap-2 rounded-md border p-3 text-[13px] ${tones[tone]}`}>
      <span aria-hidden="true">{tone === 'green' ? '✓' : '!'}</span>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

const outcomeTone = (o) => (o === 'committed' ? 'green' : o === 'refused' ? 'red' : 'amber');

function Section({ title, right }) {
  return (
    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 border-t border-gray-200 pt-3 dark:border-gray-800">
      <span className="text-[11px] font-bold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400">{title}</span>
      {right ? <span className="text-xs text-gray-500 dark:text-gray-400">{right}</span> : null}
    </div>
  );
}

/** "Asks for your authenticator code", said before the person presses the button. */
function TotpNote({ what }) {
  return (
    <p className="flex gap-2 rounded-md border border-gray-200 bg-gray-50 p-2.5 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300" data-testid="nl-totp-note">
      <span aria-hidden="true">⛨</span><span><b>Asks for your authenticator code</b> · {what}</span>
    </p>
  );
}

function Consequence({ children }) {
  return <p className="flex gap-2 text-[13px] text-gray-800 dark:text-gray-200" data-testid="nl-consequence"><span aria-hidden="true">→</span><span>{children}</span></p>;
}

/** The step card (L21's frame draws the header and step list around it). */
function StepCard({ step, title, right, children, footer }) {
  const h = useId();
  return (
    <section aria-labelledby={h} data-testid={`nl-step-${step + 1}`} data-step={NEW_LICENCE_STEPS[step]}
      className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={h} className="m-0 text-lg font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{title}</h2>
        {right}
      </div>
      {children}
      {footer}
    </section>
  );
}

function StepFooter({ note, onBack, secondary, label, onPrimary, disabled, busy, testId = 'nl-primary' }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4 dark:border-gray-800 max-md:sticky max-md:bottom-0 max-md:bg-white max-md:dark:bg-gray-950">
      <p className="m-0 max-w-xl text-xs text-gray-600 dark:text-gray-400" data-testid="nl-footer-note">{note || ''}</p>
      <div className="flex flex-wrap gap-2">
        {onBack ? <button type="button" className={BTN} onClick={onBack} data-testid="nl-back">Back</button> : null}
        {secondary}
        <button type="button" className={PRIMARY} onClick={onPrimary} disabled={disabled || busy} aria-busy={busy ? 'true' : undefined} data-testid={testId}>
          {label}
        </button>
      </div>
    </div>
  );
}

function Value({ row }) {
  if (row.state === 'not_recorded') return <span className="italic text-gray-500 dark:text-gray-400" data-state="not_recorded">— Not recorded</span>;
  if (row.state === 'none') return <span className="text-gray-600 dark:text-gray-400" data-state="none">○ {row.text}</span>;
  if (row.state === 'unreadable') return <span className="font-semibold text-red-700 dark:text-red-300" data-state="unreadable">! Unreadable</span>;
  if (row.state === 'pending') return <span className="text-gray-500" data-state="pending">{row.text}</span>;
  return <span className={row.mono ? 'font-mono' : ''}>{row.text}</span>;
}

/* ------------------------------------------------------------------ step 1 */

function KindCards({ value, onChange, fixed }) {
  const name = useId();
  return (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" data-testid="nl-kind">
      <legend className="mb-1 text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">Kind{fixed ? <span className={TAG}>Fixed after create</span> : null}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {KIND_CARDS.map((c) => (
          <label key={c.k} className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-sm ${value === c.k ? 'border-violet-600 bg-violet-50 dark:bg-violet-950/30' : 'border-gray-200 dark:border-gray-800'} ${fixed && value !== c.k ? 'opacity-50' : ''}`}>
            <input type="radio" name={name} value={c.k} checked={value === c.k} disabled={fixed} onChange={() => onChange?.(c.k)} data-testid={`nl-kind-${c.k}`} />
            <span><b className="block text-gray-900 dark:text-gray-100">{c.label}</b><small className="text-gray-600 dark:text-gray-400">{c.line}</small></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Swatch({ hex }) {
  return /^#[0-9a-fA-F]{3,6}$/.test(String(hex || '')) ? <span aria-hidden="true" className="h-6 w-6 shrink-0 rounded border border-gray-300 dark:border-gray-700" style={{ background: hex }} /> : null;
}

export function LegalEntityStep({ licence, form, setForm, onLicence, onContinue }) {
  const isNew = !licence;
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const fail = (errs) => { setErrors(errs); focusFirst(errs, (k) => `nl-${k}`); };

  async function create() {
    setNotice(null);
    const plan = planCreate(form);
    if (!plan.ok) { fail(plan.errors); return; }
    setErrors({}); setBusy(true);
    try {
      const r = await api.licenceCreate(plan.body);
      let next;
      try { next = await api.licence(r.uid); } catch (e) { reportError('new_licence_reread_failed', e); next = { ...plan.body, ...r }; }
      setForm(entityFormFrom(next));
      onLicence(next);
      onContinue();
    } catch (e) {
      reportError('licence_create_failed', e);
      const placed = placeRefusal('create', e);
      if (placed.field) fail({ [placed.field]: placed.message });
      else setNotice(outcomeFromError(e, placed.message));
    } finally { setBusy(false); }
  }

  async function save() {
    setNotice(null);
    const ent = planEntity(form, licence);
    const brand = planBrand(form, licence);
    const errs = { ...ent.errors, ...(brand.errors || {}) };
    if (Object.keys(errs).length) { fail(errs); return; }
    setErrors({}); setBusy(true);
    let entityDone = false;
    try {
      if (Object.keys(ent.body).length) {
        try { await api.licenceEntityComplete(licence.uid, ent.body); entityDone = true; } catch (e) {
          reportError('new_licence_entity_failed', e);
          const placed = placeRefusal('entity', e);
          if (placed.field) fail({ [placed.field]: placed.message }); else setNotice(outcomeFromError(e, placed.message));
          return;
        }
      }
      if (brand.send) {
        try { await api.licenceBrandSet(licence.uid, brand.body); } catch (e) {
          reportError('new_licence_brand_failed', e);
          const placed = placeRefusal('brand', e);
          if (placed.field) fail({ [placed.field]: placed.message });
          const told = refusalSentence(e, 'The brand kit was not saved.');
          setNotice(entityDone
            ? describeOutcome('partial', { message: `The entity details were saved. The brand kit was not: ${told}` })
            : outcomeFromError(e, told));
          if (entityDone) onLicence(await api.licence(licence.uid).catch(() => licence));
          return;
        }
      }
      onLicence(await api.licence(licence.uid).catch(() => licence));
      onContinue();
    } finally { setBusy(false); }
  }

  const wl = (isNew ? form.kind : licence.kind) === 'white_label';
  return (
    <StepCard step={0} title="Who receives this licence?"
      right={isNew ? null : <span className="rounded border border-gray-300 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-300" data-testid="nl-draft-chip">◷ {licence.licence_ref} · Draft</span>}
      footer={<StepFooter
        note={isNew ? null : `Saves the entity details to the draft${wl ? ', then the brand kit' : ''}.`}
        label={busy ? (isNew ? 'Creating draft…' : 'Saving…') : (isNew ? 'Create draft and continue' : 'Save and continue')}
        onPrimary={isNew ? create : save} busy={busy} />}>
      <div className="grid gap-3 md:grid-cols-3">
        <TextField id="nl-licence_ref" label="Licence reference" mono value={form.licence_ref} onChange={set('licence_ref')}
          readOnly={!isNew} tag={isNew ? null : 'Fixed after create'} placeholder="e.g. WL-CH-001" error={errors.licence_ref}
          help={isNew ? 'Unique across every licence family · up to 40 characters, saved in capitals' : null} />
        <TextField id="nl-legal_entity_name" label="Legal entity name" value={form.legal_entity_name} onChange={set('legal_entity_name')} placeholder="As registered" error={errors.legal_entity_name} />
        <TextField id="nl-brand_name" label="Brand name in product" value={form.brand_name} onChange={set('brand_name')} placeholder="Same as the legal name" error={errors.brand_name} help="Shown in the product; defaults to the legal name" />
      </div>
      <KindCards value={isNew ? form.kind : licence.kind} onChange={set('kind')} fixed={!isNew} />
      <Section title="For the agreement" right="The agreement needs these three" />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <TextField id="nl-registered_address" label="Registered address" tag="Optional" value={form.registered_address} onChange={set('registered_address')} placeholder="Street, postcode, city" error={errors.registered_address} />
        </div>
        <TextField id="nl-signatory_name" label="Signatory name" tag="Optional" value={form.signatory_name} onChange={set('signatory_name')} placeholder="Who signs for the entity" error={errors.signatory_name} />
        <TextField id="nl-signatory_title" label="Signatory title" tag="Optional" value={form.signatory_title} onChange={set('signatory_title')} placeholder="e.g. Managing director" error={errors.signatory_title}
          help={isNew ? null : 'A recorded value can be changed but not cleared'} />
      </div>
      {isNew ? (
        <Consequence>Creates <b className="font-mono">{String(form.licence_ref || '').trim().toUpperCase() || 'the licence'}</b> as a draft in the ledger. It grants nothing until it is issued. Reference and kind cannot be changed afterwards.</Consequence>
      ) : null}
      {!isNew && wl ? <BrandKitBlock licence={licence} form={form} set={set} errors={errors} onRetry={() => api.licence(licence.uid).then(onLicence).catch(() => {})} /> : null}
      {notice ? <Notice tone={outcomeTone(notice.outcome)} testId="nl-step1-notice">{notice.message} Every value you typed is still on this step.</Notice> : null}
    </StepCard>
  );
}

function BrandKitBlock({ licence, form, set, errors, onRetry }) {
  const unreadable = licence.brand_kit_available === false;
  const saved = licence.brand_kit?.primary_hex && licence.brand_kit?.accent_hex;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800" data-testid="nl-brand-kit">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="text-sm text-gray-900 dark:text-gray-100">Brand kit <span className="font-normal text-gray-500">· white-label only</span></b>
        <span className="text-xs text-gray-600 dark:text-gray-400" data-testid="nl-brand-kit-state">{unreadable ? '! Brand kit unreadable' : saved ? '✓ Colours saved' : '○ No colours saved yet'}</span>
      </div>
      {unreadable ? (
        <Notice testId="nl-brand-kit-unreadable" action={<button type="button" className={BTN} onClick={onRetry}>Try again</button>}>
          <b>The brand kit could not be read.</b> {licence.brand_kit_reason || 'The brand-kit store could not be read on this database.'} The other fields on this step still save.
        </Notice>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <TextField id="nl-primary_hex" label="Primary colour" mono value={form.primary_hex} onChange={set('primary_hex')} placeholder="#rrggbb" error={errors.primary_hex} prefix={<Swatch hex={form.primary_hex} />} />
            <TextField id="nl-accent_hex" label="Accent colour" mono value={form.accent_hex} onChange={set('accent_hex')} placeholder="#rrggbb" error={errors.accent_hex} prefix={<Swatch hex={form.accent_hex} />} />
          </div>
          <p className="m-0 text-xs text-gray-600 dark:text-gray-400">Both are needed before a white-label can be issued. Each swatch shows its hex value.</p>
          <TotpNote what="saving the brand kit" />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ step 3 */

export function CommercialTermsStep({ licence, form, setForm, onLicence, onBack, onContinue }) {
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [busy, setBusy] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const idOf = (k) => (k.startsWith('seat_') ? `nl-seat-${k.slice(5)}` : `nl-${k}`);
  const fail = (errs) => { setErrors(errs); focusFirst(errs, idOf); };
  const proposal = !discarded && !String(form.renews_on || '').trim() ? proposeRenewal(form.starts_on, form.term_years) : null;
  const reread = async () => { const next = await api.licence(licence.uid).catch(() => null); if (next) onLicence(next); return next; };

  async function save() {
    setNotice(null); setConflict(null);
    const plan = planTerms(form, licence, SEAT_TYPES);
    if (!plan.ok) { fail(plan.errors); return; }
    setErrors({}); setBusy(true);
    try {
      try { await api.licenceSetSeats(licence.uid, plan.seats); } catch (e) {
        reportError('new_licence_seats_failed', e);
        const placed = placeRefusal('seats', e);
        if (placed.field) fail({ [placed.field]: placed.message }); else setNotice(outcomeFromError(e, `Nothing was saved. ${placed.message}`));
        return;
      }
      if (plan.terms) {
        try { await api.licenceSetTerms(licence.uid, plan.terms); } catch (e) {
          reportError('new_licence_terms_failed', e);
          await reread();
          if (e?.code === 'terms_conflict') { setConflict(e.data || {}); return; }
          const placed = placeRefusal('terms', e);
          if (placed.fields) fail(placed.fields);
          const told = placed.fields ? placed.message : refusalSentence(e, 'The request did not complete.');
          setNotice(outcomeOfError(e) === 'unknown'
            ? describeOutcome('unknown', { message: 'Seats were saved. Whether the money terms were is not known.' })
            : describeOutcome('partial', { message: `Seats were saved. The money terms were not. ${told}` }));
          return;
        }
      }
      await reread();
      onContinue();
    } finally { setBusy(false); }
  }

  return (
    <StepCard step={2} title="What are the commercial terms?"
      footer={<StepFooter onBack={onBack} label={busy ? 'Saving…' : 'Save terms and continue'} onPrimary={save} busy={busy} />}>
      <Section title="Seats" right="Whole numbers, 0 or more" />
      <SeatFields seats={form.seats} onChange={(k, v) => setForm((f) => ({ ...f, seats: { ...f.seats, [k]: v } }))} errors={errors} idPrefix="nl-seat" />
      <p className="m-0 flex justify-between text-sm text-gray-700 dark:text-gray-300" data-testid="nl-seats-total"><span>Total</span><b className="font-mono">{seatsTotalLine(form.seats, SEAT_TYPES)}</b></p>
      <Section title="Terms" right="Per licence year unless stated" />
      <div className="grid gap-3 md:grid-cols-3">
        <TextField id="nl-annual_fee" label="Annual fee" mono value={form.annual_fee} onChange={set('annual_fee')} suffix="per licence year" placeholder="Amount" error={errors.annual_fee} inputMode="decimal" />
        <TextField id="nl-currency" label="Currency" mono value={form.currency} onChange={set('currency')} help="Three-letter code" error={errors.currency} />
        <TextField id="nl-revenue_share_bps" label="Revenue share" mono value={form.revenue_share_pct} onChange={set('revenue_share_pct')} suffix="%" inputMode="decimal" error={errors.revenue_share_bps} help={errors.revenue_share_bps ? null : '0 to 100% · stored as basis points'} />
        <TextField id="nl-token_split_bps" label={TOKEN_SPLIT_HQ_LABEL} tag="Optional" mono value={form.token_split_pct} onChange={set('token_split_pct')} suffix="%" inputMode="decimal" error={errors.token_split_bps} help={errors.token_split_bps ? null : '0 to 100% · stored as basis points'} />
        <TextField id="nl-term_years" label="Term" mono value={form.term_years} onChange={set('term_years')} suffix="years" inputMode="numeric" help="Whole years" error={errors.term_years} />
        <TextField id="nl-starts_on" label="Start date" mono value={form.starts_on} onChange={set('starts_on')} placeholder="YYYY-MM-DD" error={errors.starts_on} help={form.starts_on && !errors.starts_on ? dayText(form.starts_on) : null} />
        <TextField id="nl-renews_on" label="Renewal date" mono value={form.renews_on} onChange={set('renews_on')} placeholder="YYYY-MM-DD" error={errors.renews_on} help={errors.renews_on ? null : 'Needed to issue'} />
      </div>
      {proposal ? (
        <div className="flex flex-col gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-[13px] dark:border-violet-900 dark:bg-violet-950/30" data-testid="nl-renewal-proposal">
          <span className="text-[11px] font-bold uppercase tracking-[.07em] text-violet-800 dark:text-violet-200">Eadwyn · proposal · renewal date</span>
          <p className="m-0">Start <b className="font-mono">{dayText(form.starts_on)}</b> + <b className="font-mono">{form.term_years}</b> years → renew on <b className="font-mono">{dayText(proposal)}</b>.</p>
          <p className="m-0 text-xs text-gray-600 dark:text-gray-400">From the start date and term on this step. Accept fills the field, Edit opens it, Discard leaves it blank. Nothing saves until you press Save terms and continue.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN} data-testid="nl-proposal-accept" onClick={() => set('renews_on')(proposal)}>Accept</button>
            <button type="button" className={BTN} data-testid="nl-proposal-edit" onClick={() => { set('renews_on')(proposal); focusFirst({ renews_on: 1 }, idOf); }}>Edit</button>
            <button type="button" className={BTN} data-testid="nl-proposal-discard" onClick={() => setDiscarded(true)}>Discard</button>
          </div>
        </div>
      ) : null}
      <Section title="Recorded with the money terms" />
      <TextField id="nl-reason" label="Reason" tag="Required" area value={form.reason} onChange={set('reason')} error={errors.reason} help={errors.reason ? null : 'Recorded in History with your name and the time'} />
      <TotpNote what="saving the fee, shares, term and dates. Seats save without one." />
      {conflict ? (
        <Notice tone="amber" testId="nl-terms-conflict" action={<button type="button" className={BTN} onClick={() => { setConflict(null); reread(); }}>Reload terms</button>}>
          <b>These terms changed since you opened them, so nothing was saved. Reload them and apply your change again.</b>
          <div>{conflict.changed_by ? `Changed by ${conflict.changed_by}` : 'Who changed them is not recorded'}{conflict.changed_at ? ` at ${String(conflict.changed_at).slice(11, 16)} UTC` : ''}{Number.isFinite(conflict.current_revision) ? ` (terms revision ${conflict.current_revision})` : ''}. Your entries stay in the fields.</div>
        </Notice>
      ) : null}
      {notice ? <Notice tone={outcomeTone(notice.outcome)} testId="nl-step3-notice">{notice.message} Every value you typed is still on this step.</Notice> : null}
    </StepCard>
  );
}

/* ------------------------------------------------------------------ step 4 */

export function AdministratorsStep({ licence, form, setForm, onBack, onContinue }) {
  const { items, loadErr, load } = useLicenceAdmins(licence.uid);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const role = useId();

  async function appoint() {
    setNotice(null);
    const errs = {};
    if (!String(form.email || '').trim()) errs.email = 'Enter the email of an existing account';
    if (String(form.reason || '').trim().length < REASON_MIN) errs.reason = REASON_SHORT;
    if (Object.keys(errs).length) { setErrors(errs); focusFirst(errs, (k) => `nl-admin-${k}`); return; }
    setErrors({}); setBusy(true);
    try {
      await api.licenceAdminAdd(licence.uid, { email: form.email.trim(), admin_role: form.admin_role, reason: form.reason.trim() });
      setNotice(describeOutcome('committed', { message: `${form.email.trim()} is now an admin of this licence’s studio.` }));
      setForm({ email: '', admin_role: 'principal', reason: '' });
      load();
    } catch (e) {
      reportError('new_licence_appoint_failed', e);
      const placed = placeRefusal('admin', e);
      if (placed.field) { setErrors({ [placed.field]: placed.message }); focusFirst({ [placed.field]: 1 }, (k) => `nl-admin-${k}`); } else setNotice(outcomeFromError(e, placed.message));
    } finally { setBusy(false); }
  }

  return (
    <StepCard step={3} title="Who runs this licence?"
      footer={<StepFooter onBack={onBack} label="Continue to agreement" onPrimary={onContinue}
        note="Optional for issuing. Administrators can be appointed later on the licence’s Access page."
        secondary={<button type="button" className={BTN} onClick={onContinue} data-testid="nl-skip">Skip for now</button>} />}>
      <Section title="Appointed administrators" right={Array.isArray(items) && items.length ? `${items.length} appointed` : null} />
      {items === undefined ? <p className="m-0 text-sm text-gray-500" aria-busy="true">Reading the administrators…</p> : null}
      {items === null ? (
        <Notice testId="nl-admins-unreadable" action={<button type="button" className={BTN} onClick={load}>Try again</button>}>
          <b>The administrators could not be read.</b> {loadErr} This is not a claim that none are appointed. You can still appoint one below.
        </Notice>
      ) : null}
      {Array.isArray(items) && !items.length ? <p className="m-0 text-sm text-gray-600 dark:text-gray-400" data-testid="nl-admins-none">○ None · No administrator appointed yet</p> : null}
      {Array.isArray(items) && items.length ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" data-testid="nl-admins">
            <thead><tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-[.07em] text-gray-500 dark:border-gray-800">
              {['Name', 'Email', 'Licence role', 'Account role', 'Account'].map((x) => <th key={x} className="px-2 py-1.5">{x}</th>)}
            </tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.user_id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="px-2 py-1.5 font-semibold">{a.name || a.email}</td>
                  <td className="px-2 py-1.5 font-mono">{a.email}</td>
                  <td className="px-2 py-1.5">{a.admin_role === 'delegate' ? 'Delegate' : 'Principal'}</td>
                  <td className="px-2 py-1.5">{a.role ? String(a.role).charAt(0).toUpperCase() + String(a.role).slice(1) : '— Not recorded'}</td>
                  <td className="px-2 py-1.5">{Number(a.is_active ?? 0) === 1 ? '✓ Active' : '⊘ Deactivated'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800" data-testid="nl-appoint">
        <b className="text-sm text-gray-900 dark:text-gray-100">Appoint an administrator</b>
        <div className="grid gap-3 md:grid-cols-2">
          <TextField id="nl-admin-email" label="Email of an existing account" mono type="email" value={form.email} onChange={set('email')} placeholder="name@company" error={errors.email} />
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1 text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">Role</legend>
            <div className="flex gap-2">
              {[['principal', 'Principal'], ['delegate', 'Delegate']].map(([k, label]) => (
                <label key={k} className="inline-flex min-h-[36px] items-center gap-2 rounded-md border border-gray-300 px-3 text-sm dark:border-gray-700 max-md:min-h-[44px]">
                  <input type="radio" name={role} value={k} checked={form.admin_role === k} onChange={() => set('admin_role')(k)} data-testid={`nl-admin-role-${k}`} />{label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="md:col-span-2">
            <TextField id="nl-admin-reason" label="Reason" tag="Required" area value={form.reason} onChange={set('reason')} placeholder="At least 10 characters" error={errors.reason} help={errors.reason ? null : 'It is recorded'} />
          </div>
        </div>
        <Consequence>This account becomes an admin of this licence’s studio.</Consequence>
        <TotpNote what="appointing an administrator" />
        <div className="flex justify-end"><button type="button" className={BTN} onClick={appoint} disabled={busy} data-testid="nl-appoint-submit">{busy ? 'Appointing…' : 'Appoint'}</button></div>
      </div>
      {notice ? <Notice tone={outcomeTone(notice.outcome)} testId="nl-step4-notice">{notice.message}</Notice> : null}
    </StepCard>
  );
}

/* ------------------------------------------------------------------ step 5 */

const SIGNATURE_LINE = 'Issuing does not wait for a signature. Send the agreement from Agreement after issuing.';

export function AgreementStep({ licence, form, setForm, onBack, onContinue, onStep }) {
  const firstUsable = (d) => (d?.templates || []).find((t) => templateState(t).usable)?.slug || '';
  const { data, setData, load } = useLicenceContract(licence.uid, (d) => setForm((f) => ({ ...f, slug: f.slug || firstUsable(d) })));
  // The generated text is only in Generate's answer (GET returns no body), so it lives for this visit only (L44B).
  const [generated, setGenerated] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [busy, setBusy] = useState(false);
  const name = useId();

  async function generate() {
    setRefusal(null); setBusy(true);
    try {
      const r = await api.licenceContractCreate(licence.uid, form.slug);
      setGenerated(r);
      load();
    } catch (e) {
      reportError('new_licence_generate_failed', e);
      setRefusal({ code: e?.code || null, message: refusalSentence(e, 'Nothing was generated.'), outcome: outcomeFromError(e).outcome });
    } finally { setBusy(false); }
  }

  const footer = <StepFooter onBack={onBack} label="Continue to review" onPrimary={onContinue} />;
  const sig = <p className="m-0 flex gap-2 text-[13px] text-gray-700 dark:text-gray-300" data-testid="nl-signature-line"><span aria-hidden="true">✎</span>{SIGNATURE_LINE}</p>;
  if (data === null) return <StepCard step={4} title="Which agreement does this licence use?" footer={footer}><p className="m-0 text-sm text-gray-500" aria-busy="true">Reading the master templates…</p>{sig}</StepCard>;
  if (data === false) {
    return (
      <StepCard step={4} title="Which agreement does this licence use?" footer={footer}>
        <Notice testId="nl-templates-unreadable" action={<button type="button" className={BTN} onClick={() => { setData(null); load(); }}>Try again</button>}>
          <b>The master templates could not be read.</b> Nothing can be generated until they can. The other steps are unaffected.
        </Notice>
        {sig}
      </StepCard>
    );
  }
  const templates = data.templates || [];
  const current = data.contracts_available ? currentContract(data.contracts || []) : null;
  const shown = generated && current && generated.uid === current.uid ? { ...current, body_md: generated.body_md } : current;
  return (
    <StepCard step={4} title="Which agreement does this licence use?" footer={footer}>
      <Section title="Master templates" right="Current version of each" />
      {data.templates_reason || !templates.length ? (
        <p className="m-0 text-sm text-gray-700 dark:text-gray-300" data-testid="nl-templates-none">○ None · {data.templates_reason || 'HQ has authored no master templates yet.'} <a href="/admin/contracts?tab=templates" className="font-semibold text-violet-700 underline dark:text-violet-300">Open Contracts › Templates</a></p>
      ) : (
        <>
          <fieldset className="m-0 grid gap-2 border-0 p-0" data-testid="nl-templates">
            <legend className="sr-only">Master template</legend>
            {templates.map((t) => {
              const s = templateState(t);
              return (
                <label key={t.slug} className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${form.slug === t.slug ? 'border-violet-600 bg-violet-50 dark:bg-violet-950/30' : 'border-gray-200 dark:border-gray-800'} ${s.usable ? 'cursor-pointer' : 'opacity-60'}`}>
                  <input type="radio" name={name} value={t.slug} checked={form.slug === t.slug} disabled={!s.usable} onChange={() => setForm((f) => ({ ...f, slug: t.slug }))} data-testid={`nl-template-${t.slug}`} />
                  <span className="min-w-0 flex-1"><b className="text-gray-900 dark:text-gray-100">{t.title}</b> <small className="font-mono text-gray-500">v{t.version}</small></span>
                  {s.tag ? <span className={`text-xs font-semibold ${s.usable ? 'text-amber-800 dark:text-amber-200' : 'text-gray-600 dark:text-gray-400'}`}>{s.usable ? '◔' : '⊘'} {s.tag}</span> : null}
                </label>
              );
            })}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={BTN} onClick={generate} disabled={busy || !form.slug || !data.contracts_available} data-testid="nl-generate">
              {busy ? 'Generating…' : current ? `Generate again from v${templates.find((t) => t.slug === form.slug)?.version ?? ''}` : 'Generate draft'}
            </button>
            <span className="text-xs text-gray-600 dark:text-gray-400">{current ? 'A new draft supersedes this one; nothing is deleted or sent.' : 'Creates the draft contract from the chosen template at its current version. Nothing is sent.'}</span>
          </div>
        </>
      )}
      {refusal ? (
        <Notice tone={refusal.code === 'contract_conflict' || refusal.outcome === 'unknown' ? 'amber' : 'red'} testId="nl-generate-refused"
          action={refusal.code === 'contract_conflict' ? <button type="button" className={BTN} onClick={() => { setRefusal(null); load(); }}>Reload</button> : null}>
          {refusal.message}
        </Notice>
      ) : null}
      {!data.contracts_available ? (
        <Notice testId="nl-contracts-unreadable" action={<button type="button" className={BTN} onClick={() => { setData(null); load(); }}>Try again</button>}>
          <b>Contracts could not be read.</b> {data.contracts_reason || ''} A contract may exist; this is not a claim that none does.
        </Notice>
      ) : null}
      {shown ? <><Section title="Draft contract" /><DocCard contract={shown} onStep={onStep} /></> : null}
      {sig}
    </StepCard>
  );
}

function DocCard({ contract: c, onStep }) {
  const unf = Array.isArray(c.unfilled_fields) ? c.unfilled_fields : [];
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800" data-testid="nl-doc">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <b className="text-sm text-gray-900 dark:text-gray-100">{c.template_title} · v{c.template_version}</b>
          <div className="font-mono text-xs text-gray-500">Template {c.template_slug} v{c.template_version} · hash {shortHash(c.body_sha256) || 'Not recorded'}{c.created_at ? ` · generated ${String(c.created_at).slice(11, 16)} UTC` : ''}</div>
        </div>
        <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">◷ {c.status === 'draft' ? 'Draft' : c.status}</span>
      </div>
      {c.body_md ? (
        <pre tabIndex={0} aria-label="Generated text" className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200" data-testid="nl-doc-text">{c.body_md}</pre>
      ) : (
        <div data-testid="nl-doc-no-text"><span className="text-xs text-gray-500">Text shown when generated</span><p className="m-0 text-xs text-gray-600 dark:text-gray-400">The saved contract keeps its hash and fields; its text is returned only when it is generated. Generate again to read it here, or open it on the licence’s Agreement page after issuing.</p></div>
      )}
      <div data-testid="nl-unfilled">
        <b className="text-sm">Unfilled fields · {unf.length}</b>
        {unf.length ? (
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
            {unf.map((f) => {
              const w = unfilledWhere(f);
              return (
                <li key={f} className="flex flex-wrap items-center gap-2 text-xs">
                  <code>{f}</code><span className="text-gray-600 dark:text-gray-400">{w.text}</span>
                  {w.step !== null && onStep ? <button type="button" className="font-semibold text-violet-700 underline dark:text-violet-300" onClick={() => onStep(w.step)}>Go to step {w.step + 1}</button> : null}
                </li>
              );
            })}
          </ul>
        ) : <p className="m-0 text-xs text-gray-600">○ None</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ step 6 */

export function IssueStep({ licence, onLicence, onBack, onStep }) {
  const { items: admins } = useLicenceAdmins(licence.uid);
  const { data: contract } = useLicenceContract(licence.uid);
  const [activation, setActivation] = useState(undefined);
  const [refused, setRefused] = useState(null);
  const [unknown, setUnknown] = useState(false);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);

  const readActivation = () => {
    setActivation(undefined);
    api.licenceActivation(licence.uid)
      .then((d) => setActivation(Array.isArray(d?.blockers) ? d : false))
      .catch((e) => { reportError('new_licence_activation_failed', e); setActivation(false); });
  };
  useEffect(readActivation, [licence.uid]);

  const reread = async () => { const next = await api.licence(licence.uid).catch(() => null); if (next) onLicence(next); readActivation(); return next; };

  async function issue() {
    setRefused(null); setUnknown(false); setBusy(true);
    try {
      const r = await api.licenceActivate(licence.uid);
      setDone(issueOutcome(r));
      reread();
    } catch (e) {
      reportError('new_licence_issue_failed', e);
      if (outcomeOfError(e) === 'unknown') { setUnknown(true); return; }
      const r = issueRefusal(e);
      setRefused(r);
      if (r.kind === 'blocked') setActivation({ blockers: r.blockers, can_activate: false });
    } finally { setBusy(false); }
  }

  async function checkStatus() {
    const next = await reread();
    if (next?.status === 'active') { setUnknown(false); setDone({ outcome: 'committed', title: 'Issued', line: `${next.licence_ref} is Active. Its branch copy is shown on the licence’s Operations page.` }); }
    else if (next) setUnknown(false);
  }

  const groups = reviewGroups(licence, {
    admins: admins === null ? false : admins,
    contract: contract === null ? undefined : contract === false ? false : { available: contract.contracts_available, current: contract.contracts_available ? currentContract(contract.contracts || []) : null },
    seatTypes: SEAT_TYPES,
  });
  const questions = issueConsequence(licence);
  const blockers = activation && Array.isArray(activation.blockers) ? activation.blockers : null;
  const off = activation === undefined || activation === false || (blockers && blockers.length > 0) || Boolean(done);
  const note = done ? 'Issued.'
    : activation === false ? 'Issue licence is off: we could not check what blocks issuing.'
      : blockers && blockers.length ? `Issue licence is off: ${blockers.length} ${blockers.length === 1 ? 'thing blocks' : 'things block'} issuing.`
        : 'One press. The Worker checks the blockers again before it changes anything.';
  const href = (section) => `/admin/licences/${encodeURIComponent(licence.uid)}/${section}`;

  return (
    <StepCard step={5} title="Review and issue"
      footer={<StepFooter onBack={onBack} label={busy ? 'Issuing…' : 'Issue licence'} onPrimary={issue} disabled={off} busy={busy} note={note} testId="nl-issue" />}>
      <p className="m-0 text-xs text-gray-600 dark:text-gray-400">Every value saved in steps 1 to 5. Edit returns to its step; what you typed there is kept.</p>
      <div className="grid gap-3 lg:grid-cols-2" data-testid="nl-review">
        {groups.map((g) => (
          <section key={g.title} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800" data-testid={`nl-review-${g.step + 1}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="m-0 text-sm font-bold text-gray-900 dark:text-gray-100"><span className="font-mono">{g.step + 1}</span> {g.title}</h3>
              <button type="button" className="min-h-[36px] text-xs font-semibold text-violet-700 underline dark:text-violet-300 max-md:min-h-[44px]" onClick={() => onStep(g.step)} data-testid={`nl-edit-${g.step + 1}`}>
                Edit<span className="sr-only"> {g.title}</span>
              </button>
            </div>
            <dl className="m-0 grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
              {g.rows.map((r, i) => (
                <React.Fragment key={`${r.label}-${i}`}>
                  <dt className="text-gray-600 dark:text-gray-400">{r.label}</dt>
                  <dd className="m-0 min-w-0 break-words text-gray-900 dark:text-gray-100"><Value row={r} /></dd>
                </React.Fragment>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <Section title="If you issue this licence" />
      <div className="grid gap-3 md:grid-cols-2" data-testid="nl-questions">
        {questions.map((q, i) => (
          <section key={q.title} data-testid={`nl-question-${i + 1}`}>
            <h3 className="m-0 mb-1 text-[12px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-400">{i + 1} · {q.title}</h3>
            {q.lines.length === 1 ? <p className="m-0 text-[13px] text-gray-800 dark:text-gray-200">{q.lines[0]}</p>
              : <ul className="m-0 list-disc pl-5 text-[13px] text-gray-800 dark:text-gray-200">{q.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
          </section>
        ))}
      </div>
      <Blockers activation={activation} refused={refused?.kind === 'blocked'} onRetry={readActivation} onStep={onStep} />
      {refused?.kind === 'refused' ? (
        <Notice testId="nl-issue-refused" action={<button type="button" className={BTN} onClick={() => { setRefused(null); reread(); }}>Reload review</button>}>
          <b>{refused.message}</b> Nothing was changed. Every value is kept.
        </Notice>
      ) : null}
      {unknown ? (
        <Notice tone="amber" testId="nl-issue-unknown" action={<button type="button" className={PRIMARY} onClick={checkStatus}>Check status</button>}>
          <b>Outcome unknown.</b> No answer came back, so the licence may or may not have been issued. Check before trying again.
        </Notice>
      ) : null}
      {done ? (
        <Notice tone={outcomeTone(done.outcome)} testId="nl-issue-outcome"
          action={<span className="flex flex-wrap gap-2"><a className={BTN} href={href('overview')}>Open the licence</a>{done.outcome !== 'committed' || /no branch/.test(done.title) ? <a className={BTN} href={href('operations')}>Operations · deployment</a> : null}</span>}>
          <b>{done.title}.</b> {done.line}
        </Notice>
      ) : null}
    </StepCard>
  );
}

function Blockers({ activation, refused, onRetry, onStep }) {
  if (activation === undefined) return <p className="m-0 text-sm text-gray-500" aria-busy="true" data-testid="nl-blockers">Checking what blocks issuing…</p>;
  if (activation === false) {
    return (
      <Notice testId="nl-blockers" action={<button type="button" className={BTN} onClick={onRetry}>Try again</button>}>
        <b>What still blocks issuing · ! Unreadable.</b> We could not check what blocks issuing. Issue stays off until the check can be read; it is never treated as clear.
      </Notice>
    );
  }
  const list = activation.blockers || [];
  if (!list.length) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-[13px] text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-100" data-testid="nl-blockers">
        <b>✓ Nothing blocks issuing.</b> Territory, seats, fee and revenue share, renewal date and, for a white-label, the brand kit colours are in place. {(activation.notes || ['A pending signature does not block activation.']).join(' ')}
      </div>
    );
  }
  return (
    <div role={refused ? 'alert' : undefined} className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="nl-blockers">
      <b>{refused ? `Not issued · ${list.length} ${list.length === 1 ? 'thing blocks' : 'things block'} issuing` : 'What still blocks issuing'}</b>
      {refused ? <p className="m-0">The platform checked again when you pressed Issue licence. Every value is kept.</p> : null}
      <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
        {list.map((b) => {
          const s = blockerStep(b);
          return (
            <li key={b} className="flex flex-wrap items-center gap-2" data-testid="nl-blocker">
              <span aria-hidden="true">▲</span><span>{b}</span>
              {s !== null ? <button type="button" className="font-semibold text-violet-800 underline dark:text-violet-200" onClick={() => onStep(s)}>Step {s + 1} · {NEW_LICENCE_STEPS[s]}</button> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ host */

/**
 * The step in L21's card slot. It owns every step's typed values, so moving between steps (Back, Continue, Edit
 * from the review, a blocker's link) keeps them, and so does a refusal anywhere. Step 2 is L21's; null here.
 */
export function NewLicenceStep({ step, licence, onLicence, onStep }) {
  const [entity, setEntity] = useState(() => (licence ? entityFormFrom(licence) : blankEntityForm()));
  const [terms, setTerms] = useState(() => termsFormFrom(licence, SEAT_TYPES));
  const [appoint, setAppoint] = useState({ email: '', admin_role: 'principal', reason: '' });
  const [agreement, setAgreement] = useState({ slug: '' });
  // A draft that arrives after mount (step 1 created it) seeds step 3 once, from what the draft holds.
  const seeded = useRef(licence?.uid || null);
  if (licence?.uid && seeded.current !== licence.uid) {
    seeded.current = licence.uid;
    setTerms(termsFormFrom(licence, SEAT_TYPES));
  }
  const go = (i) => onStep?.(i);
  if (step === 0) return <LegalEntityStep licence={licence} form={entity} setForm={setEntity} onLicence={onLicence} onContinue={() => go(1)} />;
  if (!licence || step === 1) return null;
  if (step === 2) return <CommercialTermsStep licence={licence} form={terms} setForm={setTerms} onLicence={onLicence} onBack={() => go(1)} onContinue={() => go(3)} />;
  if (step === 3) return <AdministratorsStep licence={licence} form={appoint} setForm={setAppoint} onBack={() => go(2)} onContinue={() => go(4)} />;
  if (step === 4) return <AgreementStep licence={licence} form={agreement} setForm={setAgreement} onBack={() => go(3)} onContinue={() => go(5)} onStep={go} />;
  if (step === 5) return <IssueStep licence={licence} onLicence={onLicence} onBack={() => go(4)} onStep={go} />;
  return null;
}
