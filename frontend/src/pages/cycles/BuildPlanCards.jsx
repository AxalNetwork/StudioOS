import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../ui';
import {
  DISCARD, EDIT_FIELDS, KEEP, KIND_WORD, STATUS_WORD, WORDING_TAG, becauseChips, decidedLine, editPayload, editStart, landsIn, moduleName, writeRefusal,
} from './buildPlanModel';

/**
 * D1069 (#2939) — a plan item as the canvas draws it: VB1's proposal card
 * (kind, title, "Because" chips with their source word, where it lands, and
 * Accept, Edit and Dismiss), VB3's states (Eadwyn's unsaved wording, a write
 * the module refused, withdrawn), the one line an accepted or dismissed item
 * collapses to, and VB4's Edit and accept in the module's own fields.
 * Nothing lands until Accept (D1066); every dialog is in the page.
 */

const CARD = 'flex min-w-0 flex-col gap-2.5 rounded-xl border px-[18px] py-4';
const PLAIN_CARD = 'border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const WORDED_CARD = 'border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-900/30';
const KIND = 'w-fit rounded-full border border-axal-hairline bg-white px-2 py-px text-[10.5px] font-bold text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400';
const STATUS = {
  proposed: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
  accepted: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  edited: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  withdrawn: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
  discarded: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};
const CHIP = 'inline-flex min-h-6 items-center rounded-full border border-axal-hairline bg-axal-ground px-2.5 py-0.5 font-mono text-[11px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const LAND = 'm-0 font-mono text-[11.5px] text-axal-muted dark:text-gray-400';
const H = 'm-0 text-[15px] font-extrabold leading-[1.35] tracking-[-.01em] text-axal-ink dark:text-gray-100';
const BTN = 'inline-flex items-center justify-center rounded-[9px] px-3.5 text-[13px] font-bold disabled:opacity-50';
const BTN_P = `${BTN} border border-axal-violet bg-axal-violet text-white hover:bg-axal-violet-deep dark:border-violet-500 dark:bg-violet-600 dark:hover:bg-violet-500`;
const BTN_S = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const BTN_G = `${BTN} border border-transparent bg-transparent text-axal-violet-deep hover:text-axal-violet dark:text-violet-300 dark:hover:text-violet-200`;
const ERR = 'flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300';
const FIELD = 'block w-full rounded-[7px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const EYE = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';

/** Buttons are 44px tall on a phone (VB21), 34px on a desk. */
const tall = (phone) => (phone ? 'min-h-[44px]' : 'min-h-[34px]');

/** The "Because" chips, each with its source word (Recorded, Typed, Document). */
export function Because({ item, testId }) {
  const chips = becauseChips(item);
  if (!chips.length) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Because" data-testid={testId}>
      {chips.map((c, n) => <li key={n} className={CHIP}>{c.source} · {c.text}</li>)}
    </ul>
  );
}

/** What a card says about the item beyond its title: a feature's description, a risk's severity, a test's target. */
function detailOf(item) {
  const p = item?.payload || {};
  if (item?.kind === 'feature') return p.description || null;
  if (item?.kind === 'risk') return [p.severity ? `${String(p.severity)[0].toUpperCase()}${String(p.severity).slice(1)} severity` : null, p.mitigation || null].filter(Boolean).join(' · ') || null;
  if (item?.kind === 'prototype-test') return [p.method, p.target].filter(Boolean).join(' · ') || null;
  if (item?.kind === 'roadmap' && p.from_commitment != null) return 'From your commitment.';
  return null;
}

/**
 * One proposal (VB1, VB3). `words` is Eadwyn's unsaved wording of it
 * (D1071): drawn in lavender, the rule's plain title kept beneath, with Keep
 * wording (the item's Save) and Discard wording.
 */
export function ProposalCard({ item, phone = false, readOnly = false, paused = false, busy = false, error = '', words = null, onAccept, onEdit, onDismiss, onKeep, onDiscard, onRetry }) {
  const withdrawn = item.status === 'withdrawn';
  const lands = landsIn(item);
  const detail = detailOf(item);
  const door = item.kind === 'connect-door';
  const title = words?.title || String(item.payload?.title ?? '');
  const act = !readOnly && !paused && item.status === 'proposed';
  return (
    <article className={`${CARD} ${words ? WORDED_CARD : PLAIN_CARD} ${error ? 'border-red-200 dark:border-red-900' : ''}`} data-testid={`plan-item-${item.uid}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={KIND}>{KIND_WORD[item.kind] || 'Proposal'}</span>
        <span className={`rounded-full border px-2 py-px text-[10.5px] font-bold ${STATUS[item.status] || STATUS.proposed}`} data-testid={`plan-item-status-${item.uid}`}>{STATUS_WORD[item.status] || item.status}</span>
      </div>
      <h3 className={`${H} ${withdrawn ? 'text-axal-muted line-through dark:text-gray-500' : ''}`}>{title}</h3>
      {words ? (
        <div className="flex flex-col gap-0.5" data-testid={`plan-item-wording-${item.uid}`}>
          <span className="text-[12px] font-bold text-axal-violet-deep dark:text-violet-300">{WORDING_TAG}</span>
          <span className={MUTED}>Rule’s title: {String(item.payload?.title ?? '')}</span>
          {words.description ? <p className="m-0 text-[13px] leading-[1.55] text-axal-ink dark:text-gray-100">{words.description}</p> : null}
        </div>
      ) : null}
      {withdrawn ? <p className={MUTED}>A newer decision replaced this plan.</p> : detail ? <p className="m-0 text-[13px] leading-[1.55] text-axal-ink dark:text-gray-100">{detail}</p> : null}
      <Because item={item} testId={`plan-item-because-${item.uid}`} />
      {lands && !withdrawn ? <p className={LAND}>Lands in {lands}</p> : null}
      {error ? (
        <div role="alert" className={ERR} data-testid={`plan-item-error-${item.uid}`}>
          <span>{error}</span>
          {onRetry ? <button type="button" className={`${BTN_S} ${tall(phone)}`} onClick={onRetry} disabled={busy}>Try again</button> : null}
        </div>
      ) : null}
      {words && !readOnly ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${BTN_S} ${tall(phone)}`} disabled={busy} onClick={onKeep} data-testid={`plan-item-keep-${item.uid}`}>{KEEP}</button>
          <button type="button" className={`${BTN_G} ${tall(phone)}`} disabled={busy} onClick={onDiscard} data-testid={`plan-item-discard-wording-${item.uid}`}>{DISCARD}</button>
        </div>
      ) : null}
      {act ? (
        <div className={`flex flex-wrap gap-2 ${phone ? '[&>*]:flex-1' : ''}`}>
          {door && item.payload?.href ? <Link to={item.payload.href} className={`${BTN_S} ${tall(phone)}`} data-testid={`plan-item-connect-${item.uid}`}>Connect</Link> : null}
          <button type="button" className={`${BTN_P} ${tall(phone)}`} disabled={busy} onClick={onAccept} data-testid={`plan-item-accept-${item.uid}`}>{busy ? 'Accepting…' : 'Accept'}</button>
          {EDIT_FIELDS[item.kind] ? <button type="button" className={`${BTN_S} ${tall(phone)}`} disabled={busy} onClick={onEdit} data-testid={`plan-item-edit-${item.uid}`}>Edit</button> : null}
          <button type="button" className={`${BTN_G} ${tall(phone)}`} disabled={busy} onClick={onDismiss} data-testid={`plan-item-dismiss-${item.uid}`}>Dismiss</button>
        </div>
      ) : null}
    </article>
  );
}

/** An accepted or dismissed item, collapsed to one line (VB1, VB3). Open goes to the module it landed in. */
export function DoneRow({ item, module, search = '', readOnly = false }) {
  const dismissed = item.status === 'discarded';
  return (
    <div className={`${CARD} ${PLAIN_CARD} !flex-row flex-wrap items-center !gap-3 !py-2.5`} data-testid={`plan-done-${item.uid}`}>
      <span aria-hidden="true" className={`text-[15px] ${dismissed ? 'text-axal-muted' : 'text-emerald-700 dark:text-emerald-300'}`}>{dismissed ? '–' : '✓'}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={`text-[13.5px] font-bold ${dismissed ? 'text-axal-muted line-through dark:text-gray-500' : 'text-axal-ink dark:text-gray-100'}`}>{String(item.payload?.title ?? '')}</span>
        <span className={LAND}>{item.status === 'edited' ? `${decidedLine(item)} · edited` : decidedLine(item)}</span>
      </div>
      {!dismissed && !readOnly && item.kind !== 'connect-door'
        ? <Link to={`/build/${module}${search}`} className={`${BTN_G} min-h-[30px]`} data-testid={`plan-done-open-${item.uid}`}>Open</Link>
        : null}
    </div>
  );
}

/** The brief (VB1): who it is for, the problem, the promise and what it replaces, each read from accepted evidence. */
export function BriefCard({ brief, words = null, kept = null, readOnly = false, busy = false, phone = false, onKeep, onDiscard }) {
  const list = (xs) => (Array.isArray(xs) ? xs.map((x) => x?.label).filter(Boolean).join(', ') : '');
  const facts = [
    ['For', list(brief?.audience)],
    ['Problem', list(brief?.problems)],
    ['Promise', brief?.positioning?.valueProp || ''],
    ['Replaces', list(brief?.replaces)],
  ].filter(([, v]) => v);
  if (!facts.length) return null;
  return (
    <article className={`${CARD} ${words ? WORDED_CARD : PLAIN_CARD} lg:col-span-2`} data-testid="plan-brief">
      <span className={KIND}>Brief</span>
      {words?.summary ? (
        <div className="flex flex-col gap-0.5" data-testid="plan-brief-wording">
          <h3 className={H}>{words.summary}</h3>
          <span className="text-[12px] font-bold text-axal-violet-deep dark:text-violet-300">{WORDING_TAG}</span>
        </div>
      ) : kept ? <h3 className={H} data-testid="plan-brief-summary">{kept}</h3> : <h3 className={H}>The brief</h3>}
      <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
        {facts.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5">
            <dt className={EYE}>{k}</dt>
            <dd className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{v}</dd>
          </div>
        ))}
      </dl>
      <p className={MUTED}>Read from what you accepted in Validate. It is the plan’s own snapshot, not a Build record.</p>
      {words?.summary && !readOnly ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${BTN_S} ${tall(phone)}`} disabled={busy} onClick={onKeep} data-testid="plan-brief-keep">{KEEP}</button>
          <button type="button" className={`${BTN_G} ${tall(phone)}`} disabled={busy} onClick={onDiscard} data-testid="plan-brief-discard">{DISCARD}</button>
        </div>
      ) : null}
    </article>
  );
}

/** One act, said before it is done; a refusal stays inside the dialog. */
export function PlanConfirm({ title, body, button, danger = false, run, onClose, onDone, slug, testId }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const close = () => { if (!lock.current) onClose(); };
  const go = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setRefusal('');
    try { const out = await run(); lock.current = false; onDone(out); } catch (e) {
      lock.current = false; setBusy(false); setRefusal(writeRefusal(e, slug));
    }
  };
  return (
    <Lightbox label={title} title={title} onClose={close} width={540} testId={testId}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={actionGhost} onClick={close} disabled={busy}>Cancel</button>
          <button type="button" className={danger ? actionDanger : actionPrimary} onClick={go} disabled={busy} data-testid={`${testId}-confirm`}>{busy ? 'Saving…' : button}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] leading-[1.5] text-axal-ink dark:text-gray-100">{body}</p>
        {refusal ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid={`${testId}-refused`}>{refusal}</p> : null}
      </div>
    </Lightbox>
  );
}

/**
 * VB4: Edit and accept. The item opens in its module's own fields (D1066 §2's
 * list); its evidence stays with it and cannot be removed here. Only the
 * fields changed are sent, so the item reads edited only when it was.
 */
export function EditDialog({ item, module, onClose, onDone, accept }) {
  const [form, setForm] = useState(() => editStart(item));
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const name = moduleName(module);
  const close = () => { if (!lock.current) onClose(); };
  const go = async () => {
    if (lock.current) return;
    const { edit, error } = editPayload(item, form);
    if (error) { setRefusal(error); return; }
    lock.current = true; setBusy(true); setRefusal('');
    try { const out = await accept(item.uid, edit); lock.current = false; onDone(out); } catch (e) {
      lock.current = false; setBusy(false); setRefusal(writeRefusal(e, module));
    }
  };
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Lightbox label="Edit and accept" title="Edit and accept" onClose={close} width={620} testId="plan-edit"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={actionGhost} onClick={close} disabled={busy}>Cancel</button>
          <button type="button" className={actionPrimary} onClick={go} disabled={busy} data-testid="plan-edit-accept">{busy ? 'Saving…' : `Accept into ${name}`}</button>
        </div>
      )}>
      <div className="flex flex-col gap-4">
        <p className={MUTED}>{KIND_WORD[item.kind]} · {String(item.payload?.title ?? '')}</p>
        <section className="flex flex-col gap-2 border-t border-axal-hairline pt-3 dark:border-gray-700">
          <span className={EYE}>Evidence</span>
          <p className={MUTED}>The evidence stays with the item. It cannot be removed here.</p>
          <Because item={item} testId="plan-edit-because" />
        </section>
        <section className="flex flex-col gap-3 border-t border-axal-hairline pt-3 dark:border-gray-700">
          {(EDIT_FIELDS[item.kind] || []).map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <span className={EYE} id={`plan-edit-label-${f.key}`}>{f.label}</span>
              {f.kind === 'choice' ? (
                <span className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby={`plan-edit-label-${f.key}`}>
                  {f.options.map((o) => (
                    <button key={o} type="button" role="radio" aria-checked={form[f.key] === o} onClick={() => set(f.key, o)}
                      className={`min-h-[34px] rounded-full border px-3 text-[12px] ${form[f.key] === o ? 'border-axal-violet bg-axal-lavender font-bold text-axal-violet-deep dark:border-violet-500 dark:bg-violet-900/30 dark:text-violet-300' : 'border-axal-hairline bg-white font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}
                      data-testid={`plan-edit-${f.key}-${o}`}>{f.words?.[o] || o}</button>
                  ))}
                </span>
              ) : f.kind === 'area' ? (
                <textarea className={`${FIELD} min-h-[64px]`} aria-labelledby={`plan-edit-label-${f.key}`} maxLength={f.max} value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} data-testid={`plan-edit-${f.key}`} />
              ) : (
                <input className={FIELD} aria-labelledby={`plan-edit-label-${f.key}`} maxLength={f.max} value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} data-testid={`plan-edit-${f.key}`} />
              )}
            </div>
          ))}
        </section>
        <p className={MUTED}>This adds one {String(KIND_WORD[item.kind] || 'item').toLowerCase()} to {name} and links it to its evidence.</p>
        {refusal ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="plan-edit-refused">{refusal}</p> : null}
      </div>
    </Lightbox>
  );
}
