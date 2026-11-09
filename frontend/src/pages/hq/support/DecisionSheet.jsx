/**
 * D5034 (#5034) part 2 — the escalation decision sheet (canvas SU02, SU03,
 * SU09). Review opens it over the queue, which keeps its place; on a phone it
 * is a bottom sheet.
 *
 * It is the shared `Sheet` (D1317): `role="dialog"`, `aria-modal`, named by
 * its title, focus moved in on open and held inside, Escape and × close, and
 * focus returned to the row's Review on close (`HqSupportPage` moves it to the
 * next row after a decision).
 *
 * WHAT IT SAYS, BY PHASE. Pure over its props, so each renders in a test.
 *   decide     the request's facts, then Record answer or Decline (a radio
 *              group) and the required text. A submit with no text is
 *              refused here, in words tied to the field (`aria-invalid`,
 *              `aria-describedby`), never by a silent disabled button.
 *              A refusal from the server stays on the form as an alert.
 *   recording  the same form, read-only, its button "Recording at HQ…".
 *   recorded   two facts, never one: recorded at HQ (with its time), and
 *              delivered to the branch, not delivered (with Send again), or
 *              not reported. Send again re-sends the stored decision.
 *   unknown    no answer came back: the decision may or may not be recorded.
 *              It never says "nothing changed"; it offers a re-read.
 *   gone       the escalation is no longer on HQ's board (a 404, refused
 *              before any write), so nothing was recorded here.
 *
 * Escalations are answered or declined, never withdrawn: withdrawing is the
 * branch's act.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import { Sheet, Unrecorded } from '../../../ui';
import { SupportBadge } from './SupportWorkspaces.jsx';
import { BAND_WORD, clockOf, deadlineText, hoursText } from './supportWorkspaceModel.js';
import { escalationKindLabel } from '../../../lib/escalationKinds';

/** The two outcomes HQ records here, as the radio group names them. */
export const SHEET_OUTCOMES = Object.freeze([
  { value: 'answered', label: 'Record answer', hint: 'HQ agrees or replies' },
  { value: 'declined', label: 'Decline', hint: 'HQ refuses, with a reason' },
]);

const FIELD = { answered: 'Answer', declined: 'Reason for declining' };
const SUBMIT = { answered: 'Record answer', declined: 'Record the decline' };
/** What a submit with no text is told, tied to the field. */
export const EMPTY_TEXT = { answered: 'An answer needs its text.', declined: 'A decline needs its reason.' };

const META = 'text-[12px] leading-relaxed text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border px-4 text-[13.5px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-60 md:min-h-[38px]';
const PRIMARY = `${BTN} border-axal-ink bg-axal-ink text-white hover:opacity-90 dark:border-white dark:bg-white dark:text-gray-900`;
const SECONDARY = `${BTN} border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;

const capital = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());

/** "Thu 5 Nov 00:30 UTC" from an ISO stamp the server sent, or null. */
export function raisedText(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
  return `${day} ${d.toISOString().slice(11, 16)} UTC`;
}

function Fact({ term, children }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[8rem_1fr] sm:gap-3">
      <dt className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">{term}</dt>
      <dd className="text-[13.5px] text-axal-ink dark:text-gray-100">{children}</dd>
    </div>
  );
}

/** The request as the branch raised it; a missing fact is said, never blank. */
function Facts({ item, branchLabel }) {
  return (
    <dl className="grid gap-2.5" data-testid="hq-support-sheet-facts">
      <Fact term="Subsidiary">{branchLabel || item.branch_code}</Fact>
      <Fact term="Raised by">{item.raised_by_name || <Unrecorded reason="The branch did not record who raised it.">Not recorded</Unrecorded>}</Fact>
      {item.subject && <Fact term="Subject">{item.subject}</Fact>}
      <Fact term="About">
        {item.subject_ref ? <span className="font-mono text-[12.5px]">{item.subject_ref}</span> : <Unrecorded reason="The branch named no record this is about.">Not recorded</Unrecorded>}
        {item.subject_ref && (item.relation
          ? <span className="text-axal-muted dark:text-gray-400"> · {item.relation === 'localises' ? 'localises' : 'changes'} it</span>
          : <span> · <Unrecorded reason="The branch did not record whether this localises or changes the subject." /></span>)}
      </Fact>
      <Fact term="Request">
        {item.detail
          ? <span className="whitespace-pre-wrap">{item.detail}</span>
          : <Unrecorded reason="The branch raised it with a subject and no detail.">No detail recorded</Unrecorded>}
      </Fact>
    </dl>
  );
}

/** Recorded at HQ, and delivered or not: two lines, each with its own state. */
export function SheetResult({ record, branchLabel, onResend }) {
  const code = record.branch_code;
  const where = branchLabel || code;
  const at = clockOf(record.answered_at);
  const p = record.pushed;
  const sending = record.resend?.state === 'sending';
  let delivery;
  if (sending) {
    delivery = <SupportBadge tone="pending" data-testid="hq-support-sheet-delivery">Sending to {where}…</SupportBadge>;
  } else if (!p || typeof p !== 'object' || typeof p.ok !== 'boolean') {
    delivery = <SupportBadge tone="not_counted" data-testid="hq-support-sheet-delivery">Whether it reached {where} was not reported</SupportBadge>;
  } else if (p.ok) {
    const again = record.resend?.state === 'delivered' ? clockOf(record.resend.at) : null;
    delivery = <SupportBadge tone="delivered" data-testid="hq-support-sheet-delivery">{where} received it{again ? ` · sent again ${again} UTC` : ''}</SupportBadge>;
  } else {
    delivery = <SupportBadge tone="failed" data-testid="hq-support-sheet-delivery">Not delivered to {where}{p.reason ? ` · ${p.reason}` : ''}</SupportBadge>;
  }
  const canResend = Boolean(onResend) && p && p.ok === false;
  const failed = record.resend?.state === 'failed' || record.resend?.state === 'unknown';
  return (
    <div className="grid gap-3" role="status" data-testid="hq-support-sheet-result" data-delivered={p?.ok === true ? 'yes' : (p?.ok === false ? 'no' : 'unreported')}>
      <p className="text-[12.5px] font-semibold text-axal-muted dark:text-gray-400">Recorded at HQ and delivered to a subsidiary are two separate facts.</p>
      <div>
        <SupportBadge tone="ok" data-testid="hq-support-sheet-recorded">
          {record.status === 'declined' ? 'Declined' : 'Answered'} · Recorded at HQ{at ? ` · ${at} UTC` : ''}
        </SupportBadge>
      </div>
      <div>{delivery}</div>
      {p && p.ok === false && !sending && (
        <p className={META}>Nothing sends it again on its own. Send again re-sends the decision HQ holds, not a new one.</p>
      )}
      {failed && (
        <p role="alert" className="text-[13px] font-semibold text-red-700 dark:text-red-300" data-testid="hq-support-sheet-resend-error" data-state={record.resend.state}>
          {record.resend.state === 'unknown' ? 'Unknown: ' : 'Failed: '}{record.resend.text}
        </p>
      )}
      {(canResend || failed) && (
        <div>
          <button
            type="button"
            onClick={() => onResend(record.uid)}
            disabled={sending}
            aria-busy={sending || undefined}
            className={SECONDARY}
            data-testid="hq-support-sheet-resend"
          >
            {sending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
            {sending ? 'Sending…' : 'Send again'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The sheet. `phase` is decide | recording | recorded | unknown | gone; see
 * the header for what each says. `copy` is what the chosen outcome tells the
 * branch (the page's own sentences, so the panel and the sheet never drift).
 */
export function DecisionSheetView({
  item, branchLabel, readAt, kindHours, phase = 'decide', outcome = 'answered', reason = '', invalid = null, refusal = null,
  record = null, copy = null, onChoose, onReason, onSubmit, onClose, onResend, onReread, initialFocus, returnFocusTo, offline = false,
}) {
  const where = branchLabel || item.branch_code;
  const kind = capital(escalationKindLabel(item.kind));
  const band = item.sla || 'ok';
  const age = hoursText(item.age_hours);
  const deadline = deadlineText(item, { readAt, kindHours });
  const raised = raisedText(item.created_at);
  const busy = phase === 'recording';
  const fieldId = `hq-support-sheet-text-${item.uid}`;
  const errId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  let body;
  let footer;
  if (phase === 'recorded' && record) {
    body = (
      <>
        <Facts item={item} branchLabel={branchLabel} />
        <div className="mt-5 border-t border-axal-hairline pt-4 dark:border-gray-800">
          <SheetResult record={record} branchLabel={branchLabel} onResend={onResend} />
        </div>
      </>
    );
    footer = <div className="flex justify-end"><button type="button" onClick={onClose} className={PRIMARY} data-testid="hq-support-sheet-done">Back to the queue</button></div>;
  } else if (phase === 'unknown') {
    body = (
      <div className="grid gap-3" role="alert" data-testid="hq-support-sheet-unknown">
        <div><SupportBadge tone="not_counted">Outcome unknown · No response came back</SupportBadge></div>
        <p className="text-[13.5px] text-axal-ink dark:text-gray-100">
          The decision may or may not be recorded at HQ. Re-read the queue before trying again: a second answer replaces the first.
        </p>
      </div>
    );
    footer = (
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={SECONDARY}>Close</button>
        <button type="button" onClick={onReread} className={PRIMARY} data-testid="hq-support-sheet-reread">Re-read the queue</button>
      </div>
    );
  } else if (phase === 'gone') {
    body = (
      <div className="grid gap-3" role="alert" data-testid="hq-support-sheet-gone">
        <div><SupportBadge tone="unavailable">This escalation is no longer on the board</SupportBadge></div>
        <p className="text-[13.5px] text-axal-ink dark:text-gray-100">Nothing was recorded here. It was answered elsewhere or removed.</p>
      </div>
    );
    footer = <div className="flex justify-end"><button type="button" onClick={onReread} className={PRIMARY} data-testid="hq-support-sheet-back">Back to the queue</button></div>;
  } else {
    body = (
      <form id={`hq-support-sheet-form-${item.uid}`} onSubmit={onSubmit} noValidate data-testid="hq-support-sheet-form" data-outcome={outcome}>
        <Facts item={item} branchLabel={branchLabel} />
        <fieldset className="mt-5 border-t border-axal-hairline pt-4 dark:border-gray-800" disabled={busy}>
          <legend className="sr-only">Outcome</legend>
          <p aria-hidden="true" className="text-[13px] font-extrabold text-axal-ink dark:text-white">Outcome</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Outcome">
            {SHEET_OUTCOMES.map((o, i) => (
              <label
                key={o.value}
                className={`flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${outcome === o.value
                  ? 'border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-950/30'
                  : 'border-axal-hairline dark:border-gray-700'}`}
              >
                <input
                  ref={i === 0 ? initialFocus : undefined}
                  type="radio"
                  name={`hq-support-outcome-${item.uid}`}
                  value={o.value}
                  checked={outcome === o.value}
                  onChange={() => onChoose(o.value)}
                  className="mt-1"
                  data-testid={`hq-support-sheet-outcome-${o.value}`}
                />
                <span>
                  <span className="block text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">{o.label}</span>
                  <span className="block text-[12px] text-axal-muted dark:text-gray-400">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {copy && <p className={`mt-3 ${META}`} data-testid="hq-support-sheet-copy">{copy}</p>}
          <label htmlFor={fieldId} className="mt-3 block text-[13px] font-semibold text-axal-ink dark:text-gray-100">
            {FIELD[outcome]} <span className="font-normal text-axal-muted dark:text-gray-400">· required · stored at HQ and sent to {where}</span>
          </label>
          <textarea
            id={fieldId}
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            maxLength={4000}
            rows={4}
            aria-invalid={invalid ? 'true' : undefined}
            aria-describedby={invalid ? `${errId} ${hintId}` : hintId}
            className={`mt-1 w-full rounded-md border bg-white px-3 py-2 text-[14px] text-axal-ink dark:bg-gray-900 dark:text-gray-100 ${invalid ? 'border-red-600 dark:border-red-400' : 'border-axal-hairline dark:border-gray-700'}`}
            data-testid="hq-support-sheet-text"
          />
          <p id={hintId} className={META}>Up to 4,000 characters. The branch reads these words as HQ’s decision.</p>
          {invalid && (
            <p id={errId} role="alert" className="mt-1 text-[13px] font-semibold text-red-700 dark:text-red-300" data-testid="hq-support-sheet-invalid">✕ {invalid}</p>
          )}
          {offline && (
            <p role="status" className="mt-2 text-[13px] font-semibold text-amber-900 dark:text-amber-200" data-testid="hq-support-sheet-offline">
              You're offline: this decision can't be recorded until you reconnect. What you typed stays here.
            </p>
          )}
          {refusal && (
            <p role="alert" className="mt-2 text-[13px] font-semibold text-red-700 dark:text-red-300" data-testid="hq-support-sheet-refused">Refused: {refusal}</p>
          )}
        </fieldset>
      </form>
    );
    footer = (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className={META}>Escalations are answered or declined, never withdrawn.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <button type="button" onClick={onClose} disabled={busy} className={SECONDARY}>Cancel</button>
          <button
            type="submit"
            form={`hq-support-sheet-form-${item.uid}`}
            disabled={busy || offline}
            aria-busy={busy || undefined}
            className={PRIMARY}
            data-testid="hq-support-sheet-submit"
          >
            {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
            {busy ? 'Recording at HQ…' : SUBMIT[outcome]}
          </button>
        </div>
      </div>
    );
  }

  return (
    <Sheet
      label={`Escalation from ${where}`}
      eyebrow={`Escalation · ${where}`}
      title={item.subject && item.subject.toLowerCase() !== kind.toLowerCase() ? `${kind} · ${item.subject}` : kind}
      sub={(
        <span className="flex flex-wrap items-center gap-2" data-testid="hq-support-sheet-sla">
          <SupportBadge tone={band}>{BAND_WORD[band]}{age ? ` · ${age}` : ''}</SupportBadge>
          <span className={META}>{[deadline, raised ? `raised ${raised}` : null].filter(Boolean).join(' · ')}</span>
        </span>
      )}
      onClose={busy ? () => {} : onClose}
      footer={footer}
      width={560}
      phone="sheet"
      initialFocus={phase === 'decide' ? initialFocus : undefined}
      returnFocusTo={returnFocusTo}
      focusKey={phase}
      testId="hq-support-sheet"
    >
      <div className="px-5 py-4">{body}</div>
    </Sheet>
  );
}
