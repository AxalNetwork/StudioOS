/**
 * D5044 (#5044) — Support on a branch account (D259, D530), one HQ Team action on the shared state model.
 *
 * Opens a support session on an account that lives on a branch. The route answers `open_url`, a
 * one-time code on the BRANCH's host, and that URL is opened exactly as given: this file never
 * builds one, because the hostname convention and the code are the server's. The branch tells the
 * person (D441, said here since D507): it writes its own record and sends them a security notice,
 * in the app and by email, naming who authorised it, the reason, and that the session lasts 30
 * minutes once it is opened; the form says so before anyone presses Begin. The notice is
 * best-effort: whether it was stored is a fact the branch reports (`target_notified`, false when
 * the inbox refused it). Before D530 HQ's own route dropped it, so the form described the notice
 * and never said the person was told. HQ's
 * route passes it on now, and once the session is authorised the form says what the branch
 * reported: Told, Not told, or Not recorded when the branch did not report it (a branch built
 * before D441). `supportNoticeOutcome` holds the three sentences, and
 * it never reads a missing value as told.
 */
import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { useGovernedAction } from './governedAction';
import ActionNotice from './ActionNotice';
import { escapeCloses, useFocusOnMount } from './actionFocus';

/** The minimum reason, as the route and the branch both check it (D120). */
export const SUPPORT_REASON_MIN = 10;

/**
 * D530 — what the branch reported about its security notice, as one line.
 *
 * `told` is HQ's route's `target_notified`, passed through as the branch sent
 * it. Only `true` is "Told" and only `false` is "Not told"; anything else,
 * including a missing field, is "Not recorded" with its reason, because a
 * branch built before D441 does not report it. `true` means the notice was
 * stored in their inbox on the branch, so the line says that and claims
 * nothing about the email copy, which the branch does not report.
 */
export function supportNoticeOutcome(told) {
  if (told === true) {
    return { state: 'told', text: 'Told: the branch reports that its security notice was stored in their inbox there. Whether the email copy arrived is not reported.' };
  }
  if (told === false) {
    return { state: 'not_told', text: 'Not told: the branch reports that its security notice could not be stored, so it sent them nothing. The session is authorised all the same.' };
  }
  return { state: 'not_recorded', text: 'Not recorded: the branch did not report whether its security notice was stored. A branch built before D441 does not report it.' };
}

/** D530 — the outcome line the Support form draws once a session is authorised. */
export function SupportNoticeOutcome({ told }) {
  const outcome = supportNoticeOutcome(told);
  return (
    <p
      className={`text-[11.5px] ${outcome.state === 'not_told' ? 'text-rose-700 dark:text-rose-300' : 'text-axal-muted'}`}
      data-testid="hq-team-support-told"
      data-state={outcome.state}
    >
      {outcome.text}
    </p>
  );
}

export default function SupportSessionAction({ hit, from, onCancel }) {
  const [supportReason, setSupportReason] = useState('');
  const [supportUrl, setSupportUrl] = useState(null);
  // D530 — the branch's `target_notified`, as HQ's route passed it on.
  const [supportTold, setSupportTold] = useState(undefined);
  const support = useGovernedAction(async (reason) => {
    const res = await api.hqSupportSession(from, hit.id, reason);
    // The URL the ROUTE built, opened as given. `noopener` makes
    // window.open return null whether or not a tab opened, so the
    // same URL is also shown as a link below.
    window.open(res.open_url, '_blank', 'noopener');
    setSupportUrl(res.open_url);
    setSupportTold(res?.target_notified);
    return res;
  }, { fallback: 'The support session could not be opened.', tag: 'hq-team-support', initial: 'open' });
  const supportBusy = support.busy;
  const firstField = useFocusOnMount();

  return (
    <form
      className="mt-2 grid gap-2 rounded-lg border border-axal-hairline bg-axal-ground p-2"
      data-testid="hq-team-support"
      data-state={support.state}
      onKeyDown={escapeCloses(supportBusy, onCancel)}
      onSubmit={(e) => {
        e.preventDefault();
        support.submit(supportReason.trim());
      }}
    >
      <p className="text-[11px] leading-relaxed text-axal-muted">
        Opens a support session on {hit.name || hit.email}&rsquo;s account on {from}, in a new tab on that
        branch&rsquo;s own site. It needs your authenticator and a fresh step-up. The branch records
        the authorisation and sends the person a security notice, in the app and by email, with your
        name, your reason and that the session lasts 30 minutes once it is opened. The branch reports
        whether that notice was stored, and this form shows what it reported once the session is
        authorised.
      </p>
      <label className="text-[11px] text-axal-muted">
        Reason (at least 10 characters). It is recorded here and on the branch.
        <textarea className="mt-1 block w-full rounded-md border border-axal-hairline bg-white px-2 py-1 text-[12px] dark:bg-gray-900" rows={2} ref={firstField} value={supportReason} disabled={supportBusy} onChange={(e) => setSupportReason(e.target.value)} />
      </label>
      <ActionNotice action={support} prefix="hq-team-support" />
      {supportUrl && (
        <p className="text-[11.5px] text-axal-muted" data-testid="hq-team-support-opened">
          Opened in a new tab. The link works once, within five minutes. If no tab opened,{' '}
          <a className="font-bold text-axal-violet underline dark:text-violet-300" href={supportUrl} target="_blank" rel="noopener noreferrer">open the session</a>.
        </p>
      )}
      {supportUrl && <SupportNoticeOutcome told={supportTold} />}
      {support.state !== 'confirmed' && (
        <button type="submit" disabled={supportBusy || supportReason.trim().length < SUPPORT_REASON_MIN} className="justify-self-start rounded-md bg-axal-violet px-3 py-1 text-[11.5px] font-bold text-white disabled:opacity-50">
          {supportBusy ? 'Opening…' : 'Begin'}
        </button>
      )}
    </form>
  );
}
