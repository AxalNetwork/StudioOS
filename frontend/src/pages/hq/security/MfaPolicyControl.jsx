import React, { useState } from 'react';
import StatusBadge from './StatusBadge.jsx';
import ActionDialog, { ScopeBox, YouAffected, ReasonField, BTN_PLAIN, BTN_PRIMARY } from './ActionDialog.jsx';
import { MIN_REASON } from './accessModel.js';
import { mfaPolicyView, withoutMfaLine, mfaPolicyRefusal } from './mfaPolicyModel.js';

/**
 * D5249 (#5249) — "Require MFA for admins", the secondary control on the
 * Overview's administrator-MFA finding.
 *
 * Its state is the server's last answer (`mfaPolicyView`), never the switch's
 * own: there is no optimistic flip. A change goes through the Security
 * ActionDialog — Scope with its reason → Review → Result — and only a reply
 * the server sent moves the state. A refused or failed change says why and
 * leaves the badge where the last read put it.
 *
 * Only a Super Admin sees it at all: the read is Super Admin only, so a plain
 * admin has no figure to show and is not shown a switch they cannot use.
 */

const WRITE_BAR = 'Needs a session signed in with your authenticator (TOTP) and a recent step-up. If the step-up has lapsed you will be asked for a code, and the request continues after it.';

function stampOf(iso) {
  if (typeof iso !== 'string' || !iso) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]} UTC` : null;
}

export default function MfaPolicyControl({ policy, unavailable, isSuper, onSet, onRetry }) {
  const [dialog, setDialog] = useState(null); // { to, step, reason, error, busy, outcome }
  if (!isSuper) return null;
  const view = mfaPolicyView(policy, unavailable);
  const known = view.state === 'on' || view.state === 'off';
  const to = view.state === 'off';
  const changed = stampOf(policy?.updated_at);

  const open = () => setDialog({ to, step: 1, reason: '', error: null, busy: false, outcome: null });
  const close = () => setDialog(null);
  const next = () => {
    if (dialog.reason.trim().length < MIN_REASON) {
      setDialog({ ...dialog, error: `Give a reason of at least ${MIN_REASON} characters.` });
      return;
    }
    setDialog({ ...dialog, error: null, step: 2 });
  };
  const confirm = async () => {
    setDialog({ ...dialog, busy: true });
    try {
      const reply = await onSet(dialog.to, dialog.reason.trim());
      const ok = reply && typeof reply.enabled === 'boolean' && reply.enabled === dialog.to;
      setDialog((d) => ({ ...d, busy: false, step: 3, outcome: ok ? { ok: true } : { ok: false, text: mfaPolicyRefusal(null) } }));
    } catch (e) {
      setDialog((d) => ({ ...d, busy: false, step: 3, outcome: { ok: false, text: mfaPolicyRefusal(e) } }));
    }
  };

  const verb = dialog?.to ? 'Require MFA for admins' : 'Stop requiring MFA for admins';
  let footer;
  if (dialog?.step === 1) {
    footer = [
      <button key="c" type="button" className={BTN_PLAIN} onClick={close}>Cancel</button>,
      <button key="n" type="button" className={BTN_PRIMARY} onClick={next} data-testid="mfa-policy-next">Review</button>,
    ];
  } else if (dialog?.step === 2) {
    footer = [
      <button key="b" type="button" className={BTN_PLAIN} disabled={dialog.busy} onClick={() => setDialog({ ...dialog, step: 1 })}>Back</button>,
      <button key="y" type="button" className={BTN_PRIMARY} disabled={dialog.busy} onClick={confirm} data-testid="mfa-policy-confirm">
        {dialog.busy ? 'Saving…' : (dialog.to ? 'Turn on' : 'Turn off')}
      </button>,
    ];
  } else if (dialog?.step === 3) {
    footer = [<button key="d" type="button" className={BTN_PRIMARY} onClick={close}>Close</button>];
  }

  return (
    <div
      className="mt-2 flex flex-col gap-2 rounded-lg border border-axal-hairline bg-axal-ground p-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700 dark:bg-gray-950"
      data-testid="mfa-policy"
      data-state={view.state}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-[12.5px] text-axal-ink dark:text-white">Require MFA for admins</b>
          {view.badge ? <StatusBadge state={view.badge} label={view.word} /> : <span className="text-[11px] text-axal-faint dark:text-gray-400">{view.word}</span>}
        </div>
        <p className="mt-0.5 text-[12px] text-axal-muted dark:text-gray-300" data-testid="mfa-policy-text">{view.text}</p>
        {known && changed && (
          <p className="text-[11px] text-axal-faint dark:text-gray-400">Last changed {changed}{policy?.updated_by ? ` by ${policy.updated_by}` : ''}.</p>
        )}
      </div>
      <span className="shrink-0">
        {known && (
          <button type="button" className={BTN_PLAIN} onClick={open} data-testid="mfa-policy-change">
            {to ? 'Turn on…' : 'Turn off…'}
          </button>
        )}
        {view.state === 'unreadable' && onRetry && (
          <button type="button" className={BTN_PLAIN} onClick={onRetry} data-testid="mfa-policy-retry">Retry</button>
        )}
      </span>

      {dialog && (
        <ActionDialog id="mfa-policy-dialog" title={`${verb}?`} step={dialog.step} busy={dialog.busy} onClose={close} footer={footer} testid="mfa-policy-dialog">
          {dialog.step === 1 && (
            <>
              <ScopeBox
                title={dialog.to ? 'Every HQ administrator without MFA' : 'Every HQ administrator'}
                items={dialog.to ? [
                  'While on, an administrator without MFA is sent to enrol and reaches no admin page until they do.',
                  withoutMfaLine(policy),
                  'Enrolment and sign-in stay open to them.',
                ] : [
                  'Administrators without MFA can reach admin pages again with a password alone.',
                  withoutMfaLine(policy),
                ]}
                danger={!dialog.to}
                testid="mfa-policy-scope"
              />
              <YouAffected affected={false} text={dialog.to ? 'You are not locked out: the server refuses this change unless your own account has MFA.' : 'Your own access does not change.'} />
              <ReasonField
                id="mfa-policy-reason"
                value={dialog.reason}
                onChange={(v) => setDialog({ ...dialog, reason: v, error: null })}
                error={dialog.error}
              />
              <p className="text-[11.5px] text-axal-faint dark:text-gray-400">{WRITE_BAR}</p>
            </>
          )}
          {dialog.step === 2 && (
            <ScopeBox
              title="Review"
              items={[
                `Change: ${dialog.to ? 'Off → On' : 'On → Off'}`,
                `Reason: ${dialog.reason.trim()}`,
                'Saved with this reason to the admin audit log.',
              ]}
              testid="mfa-policy-review"
            />
          )}
          {dialog.step === 3 && (
            <p
              role={dialog.outcome?.ok ? 'status' : 'alert'}
              className="flex flex-wrap items-center gap-2 text-[12.5px] text-axal-muted dark:text-gray-300"
              data-testid="mfa-policy-result"
              data-ok={dialog.outcome?.ok ? 'true' : 'false'}
            >
              {dialog.outcome?.ok
                ? (<><StatusBadge state="verified" label="Done" /><span>Confirmed by the server: MFA is {dialog.to ? 'now required' : 'no longer required'} for administrators.</span></>)
                : (<><StatusBadge state="action_required" label="Not changed" /><span>{dialog.outcome?.text}</span></>)}
            </p>
          )}
        </ActionDialog>
      )}
    </div>
  );
}
