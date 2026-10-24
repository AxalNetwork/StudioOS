import React, { useState } from 'react';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../../ui';
import {
  FEATURE_LINE, QUICK_REASONS, REASON_MAX, SEND_BACK_NOTE, approveLines, approveTitle, cancelCopy, capacityNow,
  capacityPreview, featureCopy, sendBackReady, sendBackTitle, unpublishCopy,
} from './eventsDeskModel';
import { EYE, INPUT, Refusal, SUB } from './parts';

/**
 * D915 (#2368) — the desk's dialogs (EV4, EV5, EV9–EV11), each a `Lightbox`
 * and never a browser pop-up. Their words are the model's, which say only what
 * the Worker does: no email on a capacity change, no "every calendar", no
 * "cannot be undone", and no note field until D915 part 2 stores one.
 *
 * Each takes `onConfirm(value)`, which resolves when the write answered; a
 * refusal comes back as `refusal`, drawn as one sentence under the buttons.
 */

const BODY = 'flex flex-col gap-3.5 px-5 py-4';
const FOOT = 'flex flex-wrap justify-end gap-2';
const LINES = 'm-0 flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-normal text-axal-ink marker:text-axal-violet dark:text-gray-100';

function Switch({ checked, onChange, label, sub, testId }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span className="relative mt-0.5 h-5 w-[34px] flex-none rounded-full bg-axal-hairline peer-checked:bg-axal-violet peer-focus-visible:ring-2 peer-focus-visible:ring-axal-violet dark:bg-gray-700">
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white dark:bg-gray-300 ${checked ? 'left-4' : 'left-0.5'}`} />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{label}</span>
        {sub ? <span className={SUB}>{sub}</span> : null}
      </span>
    </label>
  );
}

/** The dialog's buttons, and under them the refusal, if the write was refused. */
function Buttons({ back = 'Back', onClose, action, onAction, disabled, busy, tone = 'primary', refusal, testId }) {
  return (
    <div className="flex flex-col gap-2">
      <div className={FOOT}>
        <button type="button" className={actionGhost} onClick={onClose}>{back}</button>
        <button type="button" className={tone === 'danger' ? actionDanger : actionPrimary} onClick={onAction} disabled={disabled || busy} data-testid={testId}>
          {busy ? 'Saving…' : action}
        </button>
      </div>
      <Refusal text={refusal} />
    </div>
  );
}

/** EV4: what approving does, and "Also feature it", which is a second call after the approve. */
export function ApproveDialog({ ev, busy, refusal, onClose, onConfirm }) {
  const [feature, setFeature] = useState(false);
  return (
    <Lightbox label={approveTitle(ev)} title={approveTitle(ev)} onClose={onClose} testId="events-approve-dialog"
      footer={<Buttons onClose={onClose} action="Approve and publish" busy={busy} onAction={() => onConfirm({ feature })} refusal={refusal} testId="events-approve-go" />}>
      <div className={BODY}>
        <ul className={LINES}>{approveLines(ev).map((l) => <li key={l}>{l}</li>)}</ul>
        <Switch checked={feature} onChange={setFeature} label="Also feature it" sub={FEATURE_LINE} testId="events-approve-feature" />
      </div>
    </Lightbox>
  );
}

/** EV5: a reason is required (O-RSN); a quick reason fills it, and the Worker keeps 1000 characters. */
export function SendBackDialog({ ev, busy, refusal, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const ready = sendBackReady(reason);
  return (
    <Lightbox label={sendBackTitle(ev)} title={sendBackTitle(ev)} sub={SEND_BACK_NOTE} onClose={onClose} testId="events-sendback-dialog"
      footer={<Buttons onClose={onClose} action="Send back" busy={busy} disabled={!ready} onAction={() => onConfirm(reason.trim())} refusal={refusal} testId="events-sendback-go" />}>
      <div className={BODY}>
        <div className="flex flex-col gap-1.5">
          <span className={EYE}>Quick reasons</span>
          <div className="flex flex-wrap gap-[7px]">
            {QUICK_REASONS.map((r) => (
              <button key={r.label} type="button" aria-pressed={reason === r.text} onClick={() => setReason(r.text)}
                className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${reason === r.text
                  ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300'
                  : 'border-axal-hairline text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800'}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={EYE}>Reason for the host · required</span>
          <textarea value={reason} maxLength={REASON_MAX} rows={4} onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
            className={`${INPUT} py-2 leading-normal`} data-testid="events-sendback-reason" />
          <span className="self-end font-mono text-[11px] text-axal-muted dark:text-gray-400" data-testid="events-sendback-count">{`${reason.length} / ${REASON_MAX}`}</span>
        </label>
      </div>
    </Lightbox>
  );
}

/** EV9: the line says what the new capacity does before it is saved. */
export function CapacityDialog({ ev, counts, busy, refusal, onClose, onConfirm }) {
  const [raw, setRaw] = useState(ev?.capacity === null || ev?.capacity === undefined ? '' : String(ev.capacity));
  const [noCap, setNoCap] = useState(ev?.capacity === null || ev?.capacity === undefined);
  const preview = capacityPreview(ev, counts, raw, noCap);
  const title = `Change capacity · ${ev?.title || 'Untitled event'}`;
  return (
    <Lightbox label={title} title={title} sub={capacityNow(ev, counts)} onClose={onClose} testId="events-capacity-dialog"
      footer={<Buttons onClose={onClose} action="Save capacity" busy={busy} disabled={Boolean(preview.error)} onAction={() => onConfirm(preview.value)} refusal={refusal} testId="events-capacity-go" />}>
      <div className={BODY}>
        <label className="flex flex-col gap-1.5">
          <span className={EYE}>New capacity</span>
          <input type="text" inputMode="numeric" value={noCap ? '' : raw} disabled={noCap} onChange={(e) => setRaw(e.target.value)}
            aria-invalid={preview.error ? 'true' : undefined} className={`${INPUT} font-mono`} data-testid="events-capacity-input" />
        </label>
        <p className={`m-0 text-[12.5px] leading-normal ${preview.error ? 'font-semibold text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-gray-100'}`} data-testid="events-capacity-line">
          {preview.error || preview.line}
        </p>
        <Switch checked={noCap} onChange={setNoCap} label="No cap" sub="Anyone eligible can register." testId="events-capacity-nocap" />
      </div>
    </Lightbox>
  );
}

/** EV10: a paid event waits for the refund checkbox, because HQ refunds by hand (O-REF). */
export function CancelDialog({ ev, busy, refusal, onClose, onConfirm }) {
  const copy = cancelCopy(ev);
  const [understood, setUnderstood] = useState(false);
  return (
    <Lightbox label={copy.title} title={copy.title} onClose={onClose} testId="events-cancel-dialog"
      footer={<Buttons back="Keep event" onClose={onClose} action="Cancel event" tone="danger" busy={busy} disabled={Boolean(copy.paid) && !understood} onAction={() => onConfirm()} refusal={refusal} testId="events-cancel-go" />}>
      <div className={BODY}>
        <span className={EYE}>What happens</span>
        <ul className={LINES}>{copy.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        {copy.paid ? (
          <div className="flex flex-col gap-2 rounded-[10px] border border-amber-300 bg-amber-50 p-3 text-[13px] font-semibold leading-normal text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="events-cancel-paid">
            <span>{copy.paid}</span>
            <label className="flex items-start gap-2 font-medium">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5" data-testid="events-cancel-understood" />
              {copy.confirm}
            </label>
          </div>
        ) : null}
      </div>
    </Lightbox>
  );
}

/** EV11a: the host is not told, and there is no note until part 2. */
export function UnpublishDialog({ ev, busy, refusal, onClose, onConfirm }) {
  const copy = unpublishCopy(ev);
  return (
    <Lightbox label={copy.title} title={copy.title} onClose={onClose} testId="events-unpublish-dialog"
      footer={<Buttons onClose={onClose} action="Unpublish" busy={busy} onAction={() => onConfirm()} refusal={refusal} testId="events-unpublish-go" />}>
      <div className={BODY}>
        <p className="m-0 text-[13px] leading-normal text-axal-ink dark:text-gray-100">{copy.body}</p>
      </div>
    </Lightbox>
  );
}

/** EV11b: what featuring does, said plainly; Stop featuring is the same dialog. */
export function FeatureDialog({ ev, busy, refusal, onClose, onConfirm }) {
  const copy = featureCopy(ev);
  return (
    <Lightbox label={copy.title} title={copy.title} onClose={onClose} testId="events-feature-dialog"
      footer={<Buttons onClose={onClose} action={copy.action} busy={busy} onAction={() => onConfirm(copy.next)} refusal={refusal} testId="events-feature-go" />}>
      <div className={BODY}>
        <p className="m-0 text-[13px] leading-normal text-axal-ink dark:text-gray-100">{copy.body}</p>
      </div>
    </Lightbox>
  );
}
