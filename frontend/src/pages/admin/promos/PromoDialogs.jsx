/**
 * D1275 (#3301) — every change to a code, each in a dialog in the page that
 * says what it changes in Stripe, for members and in the record; never a
 * browser pop-up (PRM3–PRM6).
 *
 *   New code, Copy as a new code and Replace walk the five steps (PRM3, PRM4,
 *   PRM5); Replace adds its reason and ends the old code once the new one is
 *   made (`POST /:id/replace`, D1272). Pause and Resume are `PATCH /:id`;
 *   End now is `DELETE /:id`, which deletes the coupon, so an ended code never
 *   resumes. Edit changes the name and note alone (Stripe keeps the terms).
 *
 * Every write needs TOTP and a recent step-up; `request()` asks for the code
 * and sends the write again once (StepUpModal).
 */
import React, { useMemo, useRef, useState } from 'react';
import { adminPromosApi } from '../../../lib/api/adminPromos.js';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../../ui';
import { CURRENCIES, refusalWord } from './promoModel';
import {
  MONTHS_MAX, NAME_MAX, NOTE_MAX, STEPS, asksDuration, createBody, draftFrom, draftProblem, emptyDraft,
  generateCode, memberPays, reviewLines, stepProblem, stepsFor,
} from './promoWizard';

export const REASON_MAX = 280;
const MUTED = 'text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL = 'flex flex-col gap-1 text-[13px] font-semibold';
const CODE_LINE = 'It asks for your authenticator code when your last check has lapsed.';

/** Stripe, Members, Record: what a change does, the canvas's three lines. */
function Effects({ rows }) {
  return (
    <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg bg-gray-50 p-3 text-[12.5px] dark:bg-gray-800/60">
      {rows.map(([k, v]) => (<React.Fragment key={k}><dt className="font-semibold">{k}</dt><dd className={`m-0 ${MUTED}`}>{v}</dd></React.Fragment>))}
    </dl>
  );
}

/** The shell every dialog shares: one press at a time, its refusal said in the dialog, closing locked while it runs. */
function Dialog({ title, sub, testId, children, button, danger = false, ready = true, run, onClose, onDone, width = 560, extra = null }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const close = () => { if (!lock.current) onClose(); };
  const go = async () => {
    if (lock.current || !ready) return;
    lock.current = true; setBusy(true); setRefusal('');
    try { onDone(await run()); } catch (e) {
      reportError('PromoDialogs:write', e);
      setRefusal(refusalWord(e));
    } finally { lock.current = false; setBusy(false); }
  };
  return (
    <Lightbox label={title} title={title} sub={sub} onClose={close} width={width} testId={testId}
      footer={(
        <div className="flex flex-col gap-2">
          {refusal && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid={`${testId}-refused`}>{refusal}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {extra}
            <button type="button" className={actionGhost} onClick={close} disabled={busy}>Cancel</button>
            {button && <button type="button" className={danger ? actionDanger : actionPrimary} onClick={go} disabled={!ready || busy} data-testid={`${testId}-go`}>{busy ? 'Saving…' : button}</button>}
          </div>
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px]">{children}</div>
    </Lightbox>
  );
}

function Reason({ value, onChange, testId, required = true }) {
  return (
    <label className={LABEL}>
      <span>Reason {required ? <span className={`font-normal ${MUTED}`}>(required)</span> : <span className={`font-normal ${MUTED}`}>(optional)</span>}</span>
      <textarea className={`${FIELD} min-h-[60px]`} maxLength={REASON_MAX} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
    </label>
  );
}

/* ------------------------------------------------------------------ PRM6 */

export function PauseDialog({ promo, onClose, onDone }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog title={`Pause ${promo.code}?`} testId="promo-pause" button="Pause" ready={reason.trim().length > 0}
      run={() => adminPromosApi.change(promo.id, { action: 'pause', reason: reason.trim() })} onClose={onClose} onDone={onDone}>
      <p className="m-0">Members can no longer apply {promo.code}. Subscriptions that already use it keep their discount. You can resume it.</p>
      <Reason value={reason} onChange={setReason} testId="promo-pause-reason" />
      <Effects rows={[['Stripe', 'Marks the promotion code inactive. The coupon stays.'], ['Members', `New checkouts refuse ${promo.code}. Those who used it keep their discount.`], ['Record', 'Recorded under your name, with your reason.']]} />
      <p className={`m-0 text-[12px] ${MUTED}`}>{CODE_LINE}</p>
    </Dialog>
  );
}

export function ResumeDialog({ promo, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const left = promo.max_redemptions != null && promo.times_redeemed != null ? Math.max(0, promo.max_redemptions - promo.times_redeemed) : null;
  return (
    <Dialog title={`Resume ${promo.code}?`} testId="promo-resume" button="Resume"
      run={() => adminPromosApi.change(promo.id, { action: 'resume', ...(reason.trim() ? { reason: reason.trim() } : {}) })} onClose={onClose} onDone={onDone}>
      <p className="m-0">Members can apply {promo.code} again{promo.expires_at ? ' until it ends' : ''}, up to its limit.</p>
      <Reason value={reason} onChange={setReason} testId="promo-resume-reason" required={false} />
      <Effects rows={[['Stripe', 'Marks the promotion code active again.'], ['Members', left == null ? 'It has no cap.' : `${left} of its ${promo.max_redemptions} redemptions are left, by StudioOS’s count.`], ['Record', 'Recorded under your name.']]} />
      <p className={`m-0 text-[12px] ${MUTED}`}>{CODE_LINE}</p>
    </Dialog>
  );
}

export function EndDialog({ promo, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  if (promo.state === 'ended') {
    return (
      <Dialog title={`End ${promo.code} for good?`} testId="promo-end-refused" onClose={onClose} onDone={onClose}>
        <p className="m-0" data-testid="promo-end-already">This code has already ended.</p>
      </Dialog>
    );
  }
  return (
    <Dialog title={`End ${promo.code} for good?`} testId="promo-end" button="End code" danger
      ready={reason.trim().length > 0 && typed.trim().toUpperCase() === promo.code}
      run={() => adminPromosApi.end(promo.id, reason.trim())} onClose={onClose} onDone={onDone}>
      <p className="m-0">Stripe deletes its coupon, so it can never be resumed or reused. Subscriptions that already use it keep their discount.</p>
      <Reason value={reason} onChange={setReason} testId="promo-end-reason" />
      <label className={LABEL}>
        <span>Type the code to confirm</span>
        <input className={`${FIELD} font-mono`} value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="promo-end-typed" aria-label={`Type ${promo.code} to confirm`} />
      </label>
      <Effects rows={[['Stripe', 'Deletes the coupon. The promotion code stops working at once.'], ['Members', 'Those who used it keep the discount they already have.'], ['Record', 'Recorded under your name, with your reason.']]} />
      <p className={`m-0 text-[12px] ${MUTED}`}>{CODE_LINE}</p>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ PRM5: edit */

export function EditDialog({ promo, onClose, onDone }) {
  const [name, setName] = useState(promo.name || '');
  const [note, setNote] = useState(promo.note || '');
  const changed = name !== (promo.name || '') || note !== (promo.note || '');
  const body = {};
  if (name !== (promo.name || '')) body.name = name.trim();
  if (note !== (promo.note || '')) body.note = note.trim();
  return (
    <Dialog title={`Edit ${promo.code}`} sub="Only the name and note can change." testId="promo-edit" button="Save" ready={changed && name.length <= NAME_MAX && note.length <= NOTE_MAX}
      run={() => adminPromosApi.change(promo.id, body)} onClose={onClose} onDone={onDone}>
      <label className={LABEL}><span>Name</span><input className={FIELD} maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} data-testid="promo-edit-name" /></label>
      <label className={LABEL}><span>Note</span><textarea className={`${FIELD} min-h-[60px]`} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} data-testid="promo-edit-note" /></label>
      <p className={`m-0 text-[12px] ${MUTED}`}>Only HQ sees the name and note. Stripe keeps the discount, scope, limit and expiry fixed; to change them, replace the code.</p>
      <Effects rows={[['Stripe', 'The name and note are copied to the promotion code’s metadata.'], ['Members', 'Members see no change.'], ['Record', 'Recorded under your name.']]} />
      <p className={`m-0 text-[12px] ${MUTED}`}>{CODE_LINE}</p>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ PRM3, PRM4, PRM5: the five steps */

function Check({ checked, onChange, children, testId }) {
  return (
    <label className="flex items-start gap-2 text-[13px]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} className="mt-0.5" />
      <span>{children}</span>
    </label>
  );
}
function Radio({ name, checked, onChange, children, testId }) {
  return (
    <label className="flex items-start gap-2 text-[13px]">
      <input type="radio" name={name} checked={checked} onChange={onChange} data-testid={testId} className="mt-0.5" />
      <span>{children}</span>
    </label>
  );
}

function Pays({ draft, choices }) {
  const rows = memberPays(draft, choices);
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-axal-hairline p-3 dark:border-gray-800" data-testid="promo-wizard-pays">
      <span className="text-[12px] font-bold">What a member pays</span>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-2 text-[12.5px]">
          <span>{r.label}</span>
          <span className="font-mono">{r.from ?? 'Not recorded'} → {r.applies ? (r.to ?? 'Not recorded') : 'not discounted (another currency)'}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * New code (mode `new`), Copy as a new code (`copy`, from `promo`'s terms) and
 * Replace (`replace`, which also ends `promo`). `catalogue` is the admin
 * catalogue's choices (`promoWizard.catalogueChoices`), or null when it could
 * not be read, which leaves only "Every plan and product".
 */
export function CodeWizard({ mode = 'new', promo = null, choices, choicesFailed = false, onClose, onDone, now = Date.now() }) {
  const [d, setD] = useState(() => (promo ? draftFrom(promo) : emptyDraft()));
  const [at, setAt] = useState(0);
  const [reason, setReason] = useState('');
  const [partial, setPartial] = useState(null);
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const steps = stepsFor(d);
  const step = steps[Math.min(at, steps.length - 1)];
  const last = at >= steps.length - 1;
  const taken = useMemo(() => (promo ? [String(promo.code).toUpperCase()] : []), [promo]);
  const problem = stepProblem(step, d, { now, taken });
  const whole = draftProblem(d, { now, taken });
  const title = mode === 'replace' ? `Replace ${promo.code}` : 'New code';
  const testId = `promo-wizard-${mode}`;

  const run = async () => {
    const body = createBody(d);
    if (mode === 'replace') {
      try { return await adminPromosApi.replace(promo.id, { ...body, reason: reason.trim() }); } catch (e) {
        // D1272: the new code was made and the old one could not be ended. Say so; never a clean replace.
        if (e?.status === 502 && e?.data?.old_ended === false) { setPartial(e.data); return null; }
        throw e;
      }
    }
    return api.adminCreatePromo(body);
  };
  const done = (r) => { if (r) onDone(r); };

  if (partial) {
    return (
      <Dialog title={title} testId={`${testId}-partial`} onClose={() => onDone(partial)} onDone={() => onDone(partial)}>
        <p className="m-0 font-semibold" role="alert" data-testid="promo-replace-partial">{partial.code} was created, but {promo.code} could not be ended. Both work at checkout now.</p>
        <p className={`m-0 ${MUTED}`}>End {promo.code} from its menu to finish the replacement.</p>
      </Dialog>
    );
  }

  const nav = (
    <>
      {at > 0 && <button type="button" className={actionGhost} onClick={() => setAt(at - 1)} data-testid={`${testId}-back`}>Back</button>}
      {!last && <button type="button" className={actionPrimary} disabled={Boolean(problem)} onClick={() => setAt(at + 1)} data-testid={`${testId}-next`}>Next</button>}
    </>
  );
  return (
    <Dialog title={title} sub={`Step ${at + 1} of ${steps.length} · ${STEPS[step]}`} testId={testId} width={640}
      button={last ? (mode === 'replace' ? 'Create and end' : 'Create code') : null}
      ready={last && !whole && (mode !== 'replace' || reason.trim().length > 0)} run={run} onClose={onClose} onDone={done} extra={nav}>
      {step === 0 && (
        <div className="flex flex-col gap-2" data-testid="promo-step-applies">
          <Radio name="scope" checked={d.scope === 'plans'} onChange={() => set('scope', 'plans')} testId="promo-scope-plans"><b>Plans</b> <span className={MUTED}>Subscription plans, by interval.</span></Radio>
          <Radio name="scope" checked={d.scope === 'products'} onChange={() => set('scope', 'products')} testId="promo-scope-products"><b>One-time products</b> <span className={MUTED}>Incorporation, sessions and à la carte.</span></Radio>
          <Radio name="scope" checked={d.scope === 'every'} onChange={() => set('scope', 'every')} testId="promo-scope-every"><b>Every plan and product</b> <span className={MUTED}>Anything sold at checkout.</span></Radio>
          {choicesFailed && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="promo-catalogue-failed">The catalogue could not be read, so plans and products cannot be chosen. This is not a sign that there are none.</p>}
          {d.scope === 'plans' && choices && (
            <div className="flex flex-col gap-1.5 border-t border-gray-100 pt-2 dark:border-gray-800">
              {choices.plans.length === 0 && <p className={`m-0 ${MUTED}`}>No live product sells a plan.</p>}
              {choices.plans.map((p) => (
                <Check key={p.key} checked={d.plans.includes(p.key)} testId={`promo-plan-${p.key}`}
                  onChange={(on) => set('plans', on ? [...d.plans, p.key] : d.plans.filter((k) => k !== p.key))}>{p.label}</Check>
              ))}
              <div className="flex flex-wrap gap-3 pt-1">
                <span className="text-[12.5px] font-semibold">Billing</span>
                {[['month', 'Monthly'], ['year', 'Yearly']].map(([k, w]) => (
                  <Check key={k} checked={d.intervals.includes(k)} testId={`promo-interval-${k}`}
                    onChange={(on) => set('intervals', on ? [...new Set([...d.intervals, k])] : d.intervals.filter((x) => x !== k))}>{w}</Check>
                ))}
              </div>
              <p className={`m-0 text-[12px] ${MUTED}`}>The interval applies to every plan the code names.</p>
            </div>
          )}
          {d.scope === 'products' && choices && (
            <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto border-t border-gray-100 pt-2 dark:border-gray-800">
              {choices.products.length === 0 && <p className={`m-0 ${MUTED}`}>No live one-time product.</p>}
              {choices.products.map((p) => (
                <Check key={p.id} checked={d.products.includes(p.id)} testId={`promo-product-${p.id}`}
                  onChange={(on) => set('products', on ? [...d.products, p.id] : d.products.filter((k) => k !== p.id))}>{p.name}</Check>
              ))}
            </div>
          )}
          <p className={`m-0 text-[12px] ${MUTED}`}>Token packs are never discounted.</p>
        </div>
      )}
      {step === 1 && (
        <div className="flex flex-col gap-2" data-testid="promo-step-discount">
          <div className="flex gap-4">
            <Radio name="type" checked={d.type === 'percent'} onChange={() => set('type', 'percent')} testId="promo-type-percent">Percent off</Radio>
            <Radio name="type" checked={d.type === 'fixed'} onChange={() => set('type', 'fixed')} testId="promo-type-fixed">Amount off</Radio>
          </div>
          {d.type === 'percent' ? (
            <label className={LABEL}><span>Percent off</span>
              <span className="flex items-center gap-2"><input inputMode="decimal" className={`${FIELD} w-24 font-mono`} value={d.percent} onChange={(e) => set('percent', e.target.value)} data-testid="promo-percent" /><span>%</span></span>
              <span className={`text-[12px] font-normal ${MUTED}`}>1 to 100.{Number(d.percent) === 100 ? ' 100% off makes these purchases free; a one-time product unlocks at once, with no payment.' : ''}</span>
            </label>
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
              <label className={LABEL}><span>Amount off</span><input inputMode="decimal" className={`${FIELD} font-mono`} value={d.amount} onChange={(e) => set('amount', e.target.value)} data-testid="promo-amount" placeholder="10.00" /></label>
              <label className={LABEL}><span>Currency</span>
                <select className={FIELD} value={d.currency} onChange={(e) => set('currency', e.target.value)} data-testid="promo-currency">
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select></label>
              <p className={`col-span-2 m-0 text-[12px] ${MUTED}`}>An amount works only on prices in this currency.</p>
            </div>
          )}
          <Pays draft={d} choices={choices} />
        </div>
      )}
      {step === 2 && (
        <div className="flex flex-col gap-2" data-testid="promo-step-duration">
          <p className="m-0">Plans are in scope, so choose how long the discount lasts.</p>
          <Radio name="duration" checked={d.duration === 'once'} onChange={() => set('duration', 'once')} testId="promo-duration-once"><b>First payment only</b> <span className={MUTED}>The next payment is at the full price.</span></Radio>
          <Radio name="duration" checked={d.duration === 'repeating'} onChange={() => set('duration', 'repeating')} testId="promo-duration-repeating">
            <b>For</b> <input inputMode="numeric" className={`${FIELD} mx-1 inline-block w-16 font-mono`} value={d.months} onChange={(e) => set('months', e.target.value)} data-testid="promo-months" aria-label="Months" /> <b>months</b>
            <span className={`block ${MUTED}`}>1 to {MONTHS_MAX}. On a yearly price, the first payment is the whole first year.</span>
          </Radio>
          <Radio name="duration" checked={d.duration === 'forever'} onChange={() => set('duration', 'forever')} testId="promo-duration-forever"><b>Every payment</b> <span className={MUTED}>For as long as they subscribe.</span></Radio>
        </div>
      )}
      {step === 3 && (
        <div className="flex flex-col gap-2.5" data-testid="promo-step-limits">
          <label className={LABEL}><span>Total redemptions</span><input inputMode="numeric" className={`${FIELD} w-32 font-mono`} value={d.cap} onChange={(e) => set('cap', e.target.value)} data-testid="promo-cap" /><span className={`text-[12px] font-normal ${MUTED}`}>Leave blank for no limit.</span></label>
          <Check checked={d.once_per_member} onChange={(v) => set('once_per_member', v)} testId="promo-once">Once per member</Check>
          <Check checked={d.first_purchase_only} onChange={(v) => set('first_purchase_only', v)} testId="promo-first">First purchase only <span className={MUTED}>Only members who have never paid before.</span></Check>
          <label className={LABEL}><span>Ends on <span className={`font-normal ${MUTED}`}>(23:59 UTC; blank for no expiry)</span></span><input type="date" className={`${FIELD} w-44`} value={d.ends_on} onChange={(e) => set('ends_on', e.target.value)} data-testid="promo-ends" /><span className={`text-[12px] font-normal ${MUTED}`}>You cannot change this later. To extend a code, replace it.</span></label>
          <label className={LABEL}><span>Code</span>
            <span className="flex gap-2"><input className={`${FIELD} font-mono uppercase`} value={d.code} onChange={(e) => set('code', e.target.value.toUpperCase())} data-testid="promo-code" />
              <button type="button" className={actionGhost} onClick={() => set('code', generateCode(d.name))} data-testid="promo-code-generate">Generate</button></span>
            <span className={`text-[12px] font-normal ${MUTED}`}>3 to 64 characters: letters, digits, _ or -. A code can never be reused.</span></label>
          <label className={LABEL}><span>Name</span><input className={FIELD} maxLength={NAME_MAX} value={d.name} onChange={(e) => set('name', e.target.value)} data-testid="promo-name" /></label>
          <label className={LABEL}><span>Note</span><textarea className={`${FIELD} min-h-[52px]`} maxLength={NOTE_MAX} value={d.note} onChange={(e) => set('note', e.target.value)} data-testid="promo-note" /></label>
          <p className={`m-0 text-[12px] ${MUTED}`}>Only HQ sees the name and note.</p>
        </div>
      )}
      {step === 4 && (
        <div className="flex flex-col gap-2" data-testid="promo-step-review">
          <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
            {reviewLines(d, choices).map(([k, v]) => (<React.Fragment key={k}><dt className="font-semibold">{k}</dt><dd className="m-0" data-testid={`promo-review-${k.toLowerCase().replace(/\s+/g, '-')}`}>{v}</dd></React.Fragment>))}
          </dl>
          <Pays draft={d} choices={choices} />
          {mode === 'replace' && <Reason value={reason} onChange={setReason} testId="promo-replace-reason" />}
          <Effects rows={mode === 'replace'
            ? [['Stripe', `Creates a new coupon and promotion code, then marks ${promo.code} inactive.`], ['Members', `Members who already redeemed ${promo.code} keep their discount.`], ['Record', 'Both changes are recorded under your name.']]
            : [['Stripe', 'Creates a coupon and a promotion code in Stripe.'], ['Members', 'Members can apply it at checkout at once.'], ['Record', 'Recorded under your name.']]} />
          {whole && <p className={`m-0 text-[12px] ${MUTED}`} data-testid="promo-wizard-whole">{STEPS[whole.step]}: {whole.problem}</p>}
          <p className={`m-0 text-[12px] ${MUTED}`}>{CODE_LINE}</p>
        </div>
      )}
      {problem && !last && <p className={`m-0 text-[12px] ${MUTED}`} data-testid={`${testId}-problem`}>{problem}</p>}
      {!asksDuration(d) && step === 1 && <p className={`m-0 text-[12px] ${MUTED}`}>With only one-time products in scope, there is no duration step: a one-time purchase is discounted once.</p>}
    </Dialog>
  );
}
