import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../../ui';
import {
  REASON_MAX, counter, partialWrite, refusalText, resendCopy, revokeCopy, revokeVariant,
  revokedLine, stageOf, terminateCopy, terminateReady, terminatedLine,
} from './partnersDeskModel';
import { resendResult } from './invitationsModel';
import { useRead } from './usePartnerDesk';
import { terminatePreviewLines } from './dealsReferralsModel';
import { useTerminatePreview } from './useDealsReferrals';
import { CopyButton, Done, EYE, INPUT, Refusal } from './parts';

/**
 * D923 (#2370) — the confirm dialogs (PI8a Resend, PI8b Revoke, PI8c
 * Terminate). Each is a `Lightbox`, never a browser pop-up, and says only
 * what the Worker does (D924's resend, D925's revoke and terminate replies).
 * A refusal or a result sits inside the dialog, which stays open, so a typed
 * reason is not lost: there is no corner toast, and no timer closes it.
 * Closing after a write reads the desk again.
 */

const BODY = 'flex flex-col gap-3.5 px-5 py-4';
const LINES = 'm-0 flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-normal text-axal-ink marker:text-axal-violet dark:text-gray-100';

/**
 * The dialog's buttons; after the write, one Done. The refusal sits under
 * them. The write swaps the focused action button for Done, so focus moves to
 * Done rather than falling to <body> while the dialog stays open.
 */
function Buttons({ done, onClose, action, onAction, disabled, busy, tone = 'primary', refusal, testId }) {
  const doneButton = useRef(null);
  useEffect(() => { if (done) doneButton.current?.focus?.(); }, [done]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {done ? <button ref={doneButton} type="button" className={actionPrimary} onClick={onClose} data-testid={`${testId}-done`}>Done</button> : (
          <>
            <button type="button" className={actionGhost} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className={tone === 'danger' ? actionDanger : actionPrimary} onClick={onAction} disabled={disabled || busy} data-testid={testId}>
              {busy ? 'Saving…' : action}
            </button>
          </>
        )}
      </div>
      <Refusal text={refusal} testId={`${testId}-refusal`} />
    </div>
  );
}

function useWrite(reads, kind) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [reply, setReply] = useState(null);
  const run = async (write) => {
    setBusy(true); setRefusal(null);
    try { setReply((await write()) || {}); } catch (e) { setRefusal(refusalText(e, kind)); } finally { setBusy(false); }
  };
  const finish = (onClose) => () => { if (busy) return; if (reply) reads.reload(); onClose(); };
  return { busy, refusal, reply, run, finish };
}

/**
 * PI8a. The line by stage; at Agreement out it reads R7, because resend then
 * renews the agreement's signing link too when the invitee's signature is
 * pending (D924). That line says what the Worker does; the result says only
 * what its reply reports (`resendResult`, D950): renewed, not renewed, or the
 * onboarding email sent instead, from the reply's `signing_link` (D927 §5).
 */
export function ResendDialog({ inv, reads, now, onClose }) {
  const stage = stageOf(inv, { proposed: reads.deals.proposed, now });
  const envelopeId = inv?.envelope_id ?? null;
  const envelope = useRead('envelope', `envelope:${envelopeId}`, reads.tick, stage.step === 6 && envelopeId !== null, () => api.esignDetail(envelopeId));
  const w = useWrite(reads, 'invitation');
  const copy = resendCopy(inv, stage, envelope, now);
  const result = w.reply ? resendResult(w.reply) : null;
  const close = w.finish(onClose);
  return (
    <Lightbox label={copy.title} title={copy.title} onClose={close} testId="partners-resend-dialog"
      footer={<Buttons done={Boolean(w.reply)} onClose={close} action="Resend" busy={w.busy} refusal={w.refusal} onAction={() => w.run(() => api.adminPartners.resendInvitation(inv.id))} testId="partners-resend-go" />}>
      <div className={BODY}>
        <ul className={LINES} data-testid="partners-resend-lines">{copy.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        {result ? (
          <Done testId="partners-resend-result" tone={result.sent ? 'violet' : 'amber'}>
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span>{result.text}</span>
              {result.copy && w.reply.link ? <CopyButton text={w.reply.link} label="Copy link" testId="partners-resend-copy" showField /> : null}
            </span>
          </Done>
        ) : null}
      </div>
    </Lightbox>
  );
}

/** PI8b. The long or the short variant by the `envelope_id` or a deal row; the long one when unsure, as while a list that could not refresh is read again. */
export function RevokeDialog({ inv, reads, onClose }) {
  const [reason, setReason] = useState('');
  const copy = revokeCopy(inv, revokeVariant(inv, reads.deals));
  const w = useWrite(reads, 'invitation');
  const close = w.finish(onClose);
  return (
    <Lightbox label={copy.title} title={copy.title} onClose={close} testId="partners-revoke-dialog"
      footer={<Buttons done={Boolean(w.reply)} onClose={close} action="Revoke" tone="danger" busy={w.busy} refusal={w.refusal}
        onAction={() => w.run(() => api.adminPartners.revokeInvitation(inv.id, reason.trim()))} testId="partners-revoke-go" />}>
      <div className={BODY}>
        <p className="m-0 text-[13px] leading-normal text-axal-ink dark:text-gray-100" data-testid="partners-revoke-body">{copy.body}</p>
        <label className="flex flex-col gap-1.5">
          <span className={EYE}>Reason · optional · kept in the audit log</span>
          <textarea value={reason} maxLength={REASON_MAX} rows={3} disabled={Boolean(w.reply)} onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
            className={`${INPUT} py-2 leading-normal`} data-testid="partners-revoke-reason" />
          <span className="self-end font-mono text-[11px] text-axal-muted dark:text-gray-400" data-testid="partners-revoke-count">{counter(reason.length, REASON_MAX)}</span>
        </label>
        {w.reply ? <Done testId="partners-revoke-result" tone={partialWrite(w.reply) ? 'amber' : 'violet'}><span>{revokedLine(w.reply)}</span></Done> : null}
      </div>
    </Lightbox>
  );
}

/**
 * PI8c. D951: the lines are D928's preview, read as the dialog opens — whether
 * the partner's own grant ends, and "[n] members lose the grant this deal
 * gave them" — with the same guards terminate writes with. A preview that
 * could not be read says so, never a count. The reason is required; the
 * button turns on once one is typed, and stays off for a deal the preview
 * says is no longer active.
 */
export function TerminateDialog({ deal, reads, onClose }) {
  const [reason, setReason] = useState('');
  const copy = terminateCopy(deal);
  const preview = useTerminatePreview(deal.id, reads.tick);
  const lines = terminatePreviewLines(deal, preview);
  const w = useWrite(reads, 'deal');
  const close = w.finish(onClose);
  return (
    <Lightbox label={copy.title} title={copy.title} onClose={close} testId="partners-terminate-dialog"
      footer={<Buttons done={Boolean(w.reply)} onClose={close} action="Terminate deal" tone="danger" busy={w.busy} refusal={w.refusal} disabled={!terminateReady(reason) || lines.state === 'closed'}
        onAction={() => w.run(() => api.adminPartners.terminateDeal(deal.id, reason.trim()))} testId="partners-terminate-go" />}>
      <div className={BODY}>
        <ul className={LINES} data-testid="partners-terminate-lines">{lines.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        {lines.state === 'unreadable' && !w.reply ? <button type="button" className="self-start text-[12px] font-semibold text-red-700 underline dark:text-red-300" onClick={reads.reload} data-testid="partners-terminate-preview-retry">Try again</button> : null}
        <label className="flex flex-col gap-1.5">
          <span className={EYE}>Reason · required · kept in the audit log</span>
          <textarea value={reason} maxLength={REASON_MAX} rows={3} disabled={Boolean(w.reply)} onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
            className={`${INPUT} py-2 leading-normal`} data-testid="partners-terminate-reason" />
          <span className="self-end font-mono text-[11px] text-axal-muted dark:text-gray-400" data-testid="partners-terminate-count">{counter(reason.length, REASON_MAX)}</span>
        </label>
        {w.reply ? <Done testId="partners-terminate-result" tone={partialWrite(w.reply) ? 'amber' : 'violet'}><span>{terminatedLine(w.reply)}</span></Done> : null}
      </div>
    </Lightbox>
  );
}
