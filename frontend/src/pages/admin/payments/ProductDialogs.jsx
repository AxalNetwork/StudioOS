import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { adminPaymentsApi } from '../../../lib/api/adminPayments';
import { kindWord, priceText } from './payModel';
import {
  CHANGE_REASON_MIN, KINDS, PLAN_FAMILIES, RECORDED, REASON_MAX, STEP_UP_NEXT,
  centsOf, idempotencyKey, membersOn, monthlyOf, planClash, pricePreview, reasonProblem, refusalOf,
} from './dialogModel';
import { AMBER, CARD, EYE, FIELD, GHOST, MONO, PRIMARY, SUB, PayDialog, Technical } from './payUi';

/**
 * D1013 (#2832, part 5 of Payments) — the product and price dialogs, built to
 * the owner's canvas: New product (PAY3), Add a price, Change a price and
 * Archive (PAY4). Each one says what changes, where members will see it and
 * that it is recorded, asks why, and sends the reason D1009 requires. The
 * step-up (PAY6 D) is the platform's own: a write the Worker answers with
 * `step_up_required` opens the authenticator prompt (`StepUpModal`) and is
 * sent again once the code is entered; cancelling it changes nothing.
 *
 * Edit details and Archive a price keep what the retired editor could do.
 * Token packs are never offered here: they are managed on AI allowances, and
 * the Worker refuses a pack with 409 whatever is sent.
 */

const DANGER_BTN = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] border border-axal-destructive-edge bg-white px-3.5 text-[12.5px] font-bold text-axal-destructive disabled:opacity-50 dark:border-red-900 dark:bg-gray-900 dark:text-red-400';
const CHIP = (on) => `inline-flex min-h-[32px] items-center rounded-full border px-3 text-[12px] font-semibold ${on ? 'border-axal-lavender-edge bg-axal-lavender text-axal-ink dark:border-violet-700 dark:bg-violet-900/40 dark:text-gray-100' : 'border-axal-hairline text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-100'}`;

/** The reason every write asks for, with the Worker's rule said before sending. */
export function ReasonField({ value, onChange, min = 1, testId }) {
  const problem = reasonProblem(value, min);
  return (
    <label className="flex flex-col gap-1">
      <span className={EYE}>Why are you making this change?</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} maxLength={REASON_MAX + 50}
        className={`${FIELD} h-auto py-2`} data-testid={testId} />
      <span className={SUB}>{problem && value.trim() ? problem : `Recorded with the change, never sent to Stripe.${min > 1 ? ` At least ${min} characters.` : ''}`}</span>
    </label>
  );
}

/** A refusal in the dialog: the sentence, and its code only under Technical details. */
export function Refusal({ error, testId }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex flex-col gap-1 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid={testId}>
      <span>{error.message}</span>
      {(error.code || error.status) && <Technical>{[error.status, error.code].filter(Boolean).join(' · ')}</Technical>}
    </div>
  );
}

function Footer({ onClose, busy, disabled, label, danger = false, form, testId }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Back</button>
      <button type="submit" form={form} className={danger ? DANGER_BTN : PRIMARY} disabled={disabled || busy} data-testid={testId}>{busy ? 'Saving…' : label}</button>
    </div>
  );
}

/** One write: sends it, keeps the dialog open on a refusal, and hands the answer back on success. */
function useWrite(send, onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await send();
      onDone(out);
    } catch (err) {
      setError(refusalOf(err));
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** Part 2's members read, for the sentences that count who keeps a price. Null while reading or when it failed. */
function useMembers() {
  const [state, setState] = useState({ status: 'loading', data: null });
  useEffect(() => {
    let live = true;
    adminPaymentsApi.members().then((data) => live && setState({ status: 'ready', data }), () => live && setState({ status: 'error', data: null }));
    return () => { live = false; };
  }, []);
  return state;
}
const membersLine = (m, ids, keep) => {
  if (m.status === 'loading') return 'Counting the members on it…';
  const n = m.status === 'ready' ? membersOn(m.data, ids) : null;
  if (n == null) return `The members on it could not be counted; they ${keep}.`;
  return `${n.toLocaleString('en-US')} member${n === 1 ? '' : 's'} on it ${keep}.`;
};

function AudienceChips({ audiences, value, onChange }) {
  if (!audiences.length) return null;
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="flex flex-col gap-1">
      <span className={EYE}>Audience</span>
      <div className="flex flex-wrap gap-1.5" data-testid="pay-audience">
        {audiences.map((a) => <button key={a.value} type="button" aria-pressed={value.includes(a.value)} className={CHIP(value.includes(a.value))} onClick={() => toggle(a.value)}>{a.label}</button>)}
      </div>
      <span className={SUB}>Leave empty to set it from the product&apos;s kind.</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────── New product (PAY3)

/** PAY3b/c's preview: the /pricing card as a member will see it, updating as the name is typed. */
function PlanPreview({ family, level, name, description }) {
  if (!family.tab) {
    return <div className={`${CARD} flex flex-col gap-1 px-4 py-3`} data-testid="pay-new-preview"><span className={EYE}>Preview</span><span className={SUB}>{level.note}</span></div>;
  }
  const card = level.card;
  return (
    <div className={`${CARD} flex flex-col gap-1.5 border-axal-lavender-edge px-4 py-3 dark:border-violet-700`} data-testid="pay-new-preview">
      <span className={EYE}>Preview · /pricing · {family.tab} tab</span>
      <span className="text-[16px] font-extrabold text-axal-ink dark:text-gray-100">{name.trim() || level.name}</span>
      <span className={SUB}>{description.trim() || card?.tag || ''}</span>
      <span className="text-[18px] font-bold text-axal-muted dark:text-gray-400">{card?.custom ? 'Custom' : 'No price yet'}</span>
      <span className={`${GHOST} pointer-events-none self-start opacity-60`} aria-hidden="true">{card?.cta || 'Get started'}</span>
      <span className={SUB}>As a member will see it. It updates as you type.</span>
    </div>
  );
}

export function NewProductDialog({ products = [], audiences = [], onClose, onDone }) {
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState('subscription');
  const [familyKey, setFamilyKey] = useState(PLAN_FAMILIES[0].key);
  const family = PLAN_FAMILIES.find((f) => f.key === familyKey) || PLAN_FAMILIES[0];
  const [levelId, setLevelId] = useState(PLAN_FAMILIES[0].levels[0]?.id);
  const level = family.levels.find((l) => l.id === levelId) || family.levels[0];
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [audience, setAudience] = useState([]);
  const [feature, setFeature] = useState('');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const pickFamily = (f) => { setFamilyKey(f.key); setLevelId(f.levels[0]?.id); };
  const clash = kind === 'subscription' ? planClash(products, level) : null;

  const metadata = useMemo(() => {
    const m = {};
    if (kind === 'subscription') Object.assign(m, level?.metadata || {});
    if (kind === 'incorporation' || kind === 'session') m.kind = kind;
    if (kind === 'alacarte') Object.assign(m, { kind: 'alacarte', feature_key: feature.trim(), unlock_days: String(days).trim() });
    if (audience.length) m.audience = audience.join(',');
    return m;
  }, [kind, level, feature, days, audience]);
  const finalName = (name.trim() || (kind === 'subscription' ? level?.name || '' : '')).trim();
  const problems = [
    !finalName && 'Give the product a name.',
    kind === 'subscription' && !level?.metadata && 'No checkout sells this level yet, so it cannot be created here.',
    kind === 'alacarte' && !feature.trim() && 'Name the feature it unlocks.',
    kind === 'alacarte' && !(Number.isInteger(Number(days)) && Number(days) > 0) && 'Say for how many days it unlocks, as a whole number.',
    reasonProblem(reason),
  ].filter(Boolean);

  const { busy, error, run } = useWrite(
    () => api.adminCatalogCreateProduct({ name: finalName, kind, metadata, ...(description.trim() ? { description: description.trim() } : {}), reason: reason.trim() }),
    (out) => onDone({ text: `${finalName} was created. ${RECORDED} It shows to members once it has a price.`, product: out?.product }),
  );

  if (step === 1) {
    return (
      <PayDialog title="New product" sub="Step 1 of 2 · What are you selling?" onClose={onClose} testId="pay-new"
        footer={<div className="flex justify-end gap-2"><button type="button" className={GHOST} onClick={onClose}>Back</button><button type="button" className={PRIMARY} onClick={() => setStep(2)} data-testid="pay-new-continue">Continue</button></div>}>
        <div role="radiogroup" aria-label="What are you selling?" className="flex flex-col gap-2" data-testid="pay-new-kinds">
          {KINDS.map((k) => (
            <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} onClick={() => setKind(k.kind)} data-testid={`pay-new-kind-${k.kind}`}
              className={`flex flex-col items-start rounded-[10px] border px-3.5 py-2.5 text-left ${kind === k.kind ? 'border-axal-violet bg-axal-lavender dark:border-violet-500 dark:bg-violet-900/30' : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'}`}>
              <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{k.label}</span>
              <span className={SUB}>{k.sub}</span>
            </button>
          ))}
        </div>
        <span className={SUB}>Token packs are made on AI allowances.</span>
      </PayDialog>
    );
  }

  const where = kind === 'subscription'
    ? (family.tab ? 'It shows on /pricing once it has a price.' : 'It is sold once it has a price.')
    : 'It shows at checkout once it has a price.';
  return (
    <PayDialog title={`New product · ${KINDS.find((k) => k.kind === kind)?.label}`} sub="Step 2 of 2 · Details" onClose={onClose} testId="pay-new"
      footer={<Footer onClose={() => setStep(1)} busy={busy} disabled={problems.length > 0} label="Create product" form="pay-new-form" testId="pay-new-create" />}>
      <form id="pay-new-form" onSubmit={run} className="flex flex-col gap-3" data-testid="pay-new-form">
        {kind === 'subscription' && (
          <>
            <div className="flex flex-col gap-1">
              <span className={EYE}>Plan family</span>
              <div className="flex flex-wrap gap-1.5" data-testid="pay-new-families">
                {PLAN_FAMILIES.map((f) => <button key={f.key} type="button" aria-pressed={f.key === familyKey} className={CHIP(f.key === familyKey)} onClick={() => pickFamily(f)} data-testid={`pay-new-family-${f.key}`}>{f.label}</button>)}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className={EYE}>Level</span>
              <div className="flex flex-wrap gap-1.5" data-testid="pay-new-levels">
                {family.levels.map((l) => <button key={l.id} type="button" aria-pressed={l.id === level?.id} className={CHIP(l.id === level?.id)} onClick={() => setLevelId(l.id)} data-testid={`pay-new-level-${l.id}`}>{l.name}</button>)}
              </div>
            </div>
            {level?.note && <span className={AMBER} data-testid="pay-new-level-note">{level.note}</span>}
          </>
        )}
        <label className="flex flex-col gap-1">
          <span className={EYE}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'subscription' ? level?.name : ''} className={FIELD} data-testid="pay-new-name" />
        </label>
        {kind === 'alacarte' ? (
          <>
            <label className="flex flex-col gap-1">
              <span className={EYE}>Feature it unlocks</span>
              <input value={feature} onChange={(e) => setFeature(e.target.value)} className={FIELD} data-testid="pay-new-feature" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={EYE}>Unlock days</span>
              <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className={`${FIELD} ${MONO}`} data-testid="pay-new-days" />
            </label>
          </>
        ) : (
          <label className="flex flex-col gap-1">
            <span className={EYE}>Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={kind === 'subscription' ? level?.card?.tag || '' : ''} className={`${FIELD} h-auto py-2`} data-testid="pay-new-description" />
          </label>
        )}
        <AudienceChips audiences={audiences} value={audience} onChange={setAudience} />
        {clash && <span className={AMBER} data-testid="pay-new-clash">An active product already makes the {level.name} card: {clash.name}. Archive it first, or the page will show two cards.</span>}
        {kind === 'subscription' && level && <PlanPreview family={family} level={level} name={name} description={description} />}
        <ReasonField value={reason} onChange={setReason} testId="pay-new-reason" />
        <span className={SUB}>This creates the product in Stripe. {where} {RECORDED} {STEP_UP_NEXT}</span>
        {problems.length > 0 && (name || reason) && <span className={SUB} data-testid="pay-new-problems">{problems[0]}</span>}
        <Refusal error={error} testId="pay-new-error" />
        <Technical testId="pay-new-tech">{Object.entries(metadata).map(([k, v]) => `${k}=${v}`).join(' · ') || 'no metadata'}</Technical>
      </form>
    </PayDialog>
  );
}

// ─────────────────────────────────────────────────────────── the price dialogs (PAY4)

const BILLINGS = [['month', 'Monthly'], ['year', 'Yearly'], ['once', 'One-time']];

export function AddPriceDialog({ product, onClose, onDone }) {
  const isPlan = product.kind === 'subscription';
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('usd');
  const [billing, setBilling] = useState(isPlan ? 'month' : 'once');
  const [reason, setReason] = useState('');
  const cents = centsOf(amount);
  const preview = pricePreview({ cents, currency, billing, isPlan, monthly: monthlyOf(product) });
  const problems = [cents == null && 'Enter an amount, such as 204.00.', reasonProblem(reason)].filter(Boolean);
  const body = { currency, unit_amount: cents, type: billing === 'once' ? 'one_time' : 'recurring', ...(billing === 'once' ? {} : { interval: billing }), reason: reason.trim() };
  const { busy, error, run } = useWrite(() => api.adminCatalogAddPrice(product.id, body), () => onDone({ text: `The price was added to ${product.name}. ${RECORDED}` }));
  return (
    <PayDialog title={`Add a price · ${product.name}`} onClose={onClose} testId="pay-add-price"
      footer={<Footer onClose={onClose} busy={busy} disabled={problems.length > 0} label="Add price" form="pay-add-price-form" testId="pay-add-price-send" />}>
      <form id="pay-add-price-form" onSubmit={run} className="flex flex-col gap-3" data-testid="pay-add-price-form">
        <label className="flex flex-col gap-1">
          <span className={EYE}>Amount</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={`${FIELD} ${MONO}`} data-testid="pay-add-price-amount" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={EYE}>Currency</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={FIELD} data-testid="pay-add-price-currency">
            {['usd', 'eur', 'gbp', 'cad'].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
          </select>
          {isPlan && <span className={SUB}>Only USD prices give an AI allowance.</span>}
        </label>
        <div className="flex flex-col gap-1">
          <span className={EYE}>Billing</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Billing" data-testid="pay-add-price-billing">
            {BILLINGS.map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={billing === k} className={CHIP(billing === k)} onClick={() => setBilling(k)} data-testid={`pay-add-price-${k}`}>{label}</button>)}
          </div>
          {isPlan && billing === 'once' && <span className={AMBER}>A plan sold once gives no allowance and makes no /pricing card.</span>}
        </div>
        <div className="flex flex-col gap-1" data-testid="pay-add-price-preview">
          <span className={EYE}>Preview</span>
          <span className={`${MONO} text-[12.5px] text-axal-ink dark:text-gray-100`}>{preview || 'Enter an amount to see it as members will.'}</span>
        </div>
        <ReasonField value={reason} onChange={setReason} testId="pay-add-price-reason" />
        <span className={SUB}>{isPlan ? 'It shows on /pricing once the catalogue is re-read. ' : ''}{RECORDED} {STEP_UP_NEXT}</span>
        <Refusal error={error} testId="pay-add-price-error" />
      </form>
    </PayDialog>
  );
}

export function ChangePriceDialog({ product, price, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [key] = useState(idempotencyKey);
  const members = useMembers();
  const cents = centsOf(amount);
  const per = price.interval ? ((price.interval_count ?? 1) === 1 ? ` / ${price.interval}` : ` every ${price.interval_count} ${price.interval}s`) : '';
  const newText = cents == null ? null : `${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${String(price.currency).toUpperCase()}${per}`;
  const problems = [
    (cents == null || cents <= 0) && 'Enter the new amount, above zero.',
    cents === price.unit_amount && 'That is the price it has now.',
    reasonProblem(reason, CHANGE_REASON_MIN),
  ].filter(Boolean);
  const { busy, error, run } = useWrite(
    () => adminPaymentsApi.changePrice(price.id, { unitAmount: cents, reason: reason.trim(), idempotencyKey: key }),
    () => onDone({ text: `${product.name} now costs ${newText} for new members. ${RECORDED}` }),
  );
  return (
    <PayDialog title={`Change a price · ${product.name}`} sub="Stripe never edits a price. This adds the new price and archives the old one." onClose={onClose} testId="pay-change-price"
      footer={<Footer onClose={onClose} busy={busy} disabled={problems.length > 0} label="Change price" form="pay-change-price-form" testId="pay-change-price-send" />}>
      <form id="pay-change-price-form" onSubmit={run} className="flex flex-col gap-3" data-testid="pay-change-price-form">
        <div className="flex items-baseline justify-between gap-2"><span className={EYE}>Old price</span><span className={`${MONO} text-[13px] text-axal-ink dark:text-gray-100`}>{priceText(price)}</span></div>
        <label className="flex flex-col gap-1">
          <span className={EYE}>New amount · {String(price.currency).toUpperCase()}{per}</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={`${FIELD} ${MONO}`} data-testid="pay-change-price-amount" />
        </label>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="pay-change-price-effects">
          <li>{membersLine(members, [price.id], 'keep the old price')}</li>
          <li>{newText ? `New members pay ${newText} from now.` : 'New members pay the new amount from now.'}</li>
          <li>The old price is archived. If that fails, the new one is archived again and the old one stays the price.</li>
          <li>{RECORDED} {STEP_UP_NEXT}</li>
        </ul>
        <ReasonField value={reason} onChange={setReason} min={CHANGE_REASON_MIN} testId="pay-change-price-reason" />
        <Refusal error={error} testId="pay-change-price-error" />
        <Technical>{`price ${price.id} · idempotency ${key}`}</Technical>
      </form>
    </PayDialog>
  );
}

export function ArchiveProductDialog({ product, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const members = useMembers();
  const isPlan = product.kind === 'subscription';
  const { busy, error, run } = useWrite(() => api.adminCatalogArchiveProduct(product.id, reason.trim()), () => onDone({ text: `${product.name} was archived. ${RECORDED}` }));
  return (
    <PayDialog title={`Archive ${product.name}?`} sub={isPlan ? 'It leaves /pricing and checkout.' : 'It leaves checkout.'} onClose={onClose} testId="pay-archive-product"
      footer={<Footer onClose={onClose} busy={busy} disabled={Boolean(reasonProblem(reason))} label="Archive product" danger form="pay-archive-product-form" testId="pay-archive-product-send" />}>
      <form id="pay-archive-product-form" onSubmit={run} className="flex flex-col gap-3" data-testid="pay-archive-product-form">
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="pay-archive-product-effects">
          {isPlan && <li>{membersLine(members, (product.prices || []).map((p) => p.id), 'keep their plan until they cancel')}</li>}
          <li>You can&apos;t un-archive it here; make a new product instead.</li>
          <li>{RECORDED} {STEP_UP_NEXT}</li>
        </ul>
        <ReasonField value={reason} onChange={setReason} testId="pay-archive-product-reason" />
        <Refusal error={error} testId="pay-archive-product-error" />
      </form>
    </PayDialog>
  );
}

export function ArchivePriceDialog({ product, price, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const members = useMembers();
  const { busy, error, run } = useWrite(() => api.adminCatalogArchivePrice(price.id, reason.trim()), () => onDone({ text: `${priceText(price)} was archived on ${product.name}. ${RECORDED}` }));
  return (
    <PayDialog title={`Archive ${priceText(price)}?`} sub={`On ${product.name}. New members can no longer choose it.`} onClose={onClose} testId="pay-archive-price"
      footer={<Footer onClose={onClose} busy={busy} disabled={Boolean(reasonProblem(reason))} label="Archive price" danger form="pay-archive-price-form" testId="pay-archive-price-send" />}>
      <form id="pay-archive-price-form" onSubmit={run} className="flex flex-col gap-3" data-testid="pay-archive-price-form">
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[12.5px] text-axal-ink dark:text-gray-100">
          <li>{membersLine(members, [price.id], 'keep it until they cancel')}</li>
          <li>{RECORDED} {STEP_UP_NEXT}</li>
        </ul>
        <ReasonField value={reason} onChange={setReason} testId="pay-archive-price-reason" />
        <Refusal error={error} testId="pay-archive-price-error" />
      </form>
    </PayDialog>
  );
}

/** The retired editor's rename and audience, as a dialog: the name, the description and the audience. */
export function EditProductDialog({ product, audiences = [], onClose, onDone }) {
  const current = String(product.metadata?.audience || '').split(',').map((s) => s.trim()).filter(Boolean);
  const [name, setName] = useState(product.name || '');
  // The catalogue mirror holds no description, so the field starts empty and an empty one is never sent.
  const [description, setDescription] = useState('');
  const [audience, setAudience] = useState(current);
  const [reason, setReason] = useState('');
  const metadata = { ...(product.metadata || {}), audience: audience.join(',') };
  const changed = name.trim() !== (product.name || '') || Boolean(description.trim()) || audience.join(',') !== current.join(',');
  const problems = [!name.trim() && 'Give the product a name.', !changed && 'Nothing has changed yet.', reasonProblem(reason)].filter(Boolean);
  const { busy, error, run } = useWrite(
    () => api.adminCatalogUpdateProduct(product.id, { name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), metadata, reason: reason.trim() }),
    () => onDone({ text: `${name.trim()} was updated. ${RECORDED}` }),
  );
  return (
    <PayDialog title={`Edit ${product.name}`} sub={`${kindWord(product.kind)} · the name, description and audience members see.`} onClose={onClose} testId="pay-edit-product"
      footer={<Footer onClose={onClose} busy={busy} disabled={problems.length > 0} label="Save" form="pay-edit-product-form" testId="pay-edit-product-send" />}>
      <form id="pay-edit-product-form" onSubmit={run} className="flex flex-col gap-3" data-testid="pay-edit-product-form">
        <label className="flex flex-col gap-1"><span className={EYE}>Name</span><input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} data-testid="pay-edit-product-name" /></label>
        <label className="flex flex-col gap-1"><span className={EYE}>New description</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${FIELD} h-auto py-2`} data-testid="pay-edit-product-description" /><span className={SUB}>Leave it empty to keep the one Stripe holds; this page does not read it.</span></label>
        <AudienceChips audiences={audiences} value={audience} onChange={setAudience} />
        <ReasonField value={reason} onChange={setReason} testId="pay-edit-product-reason" />
        <span className={SUB}>Members see it where the product shows. {RECORDED} {STEP_UP_NEXT}</span>
        <Refusal error={error} testId="pay-edit-product-error" />
      </form>
    </PayDialog>
  );
}
