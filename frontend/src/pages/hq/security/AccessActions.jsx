import React, { useState } from 'react';
import StatusBadge, { ReadValue } from './StatusBadge.jsx';
import ActionDialog, {
  BTN_DANGER, BTN_PLAIN, BTN_PRIMARY, NotInstrumented as NI, ReasonField, ScopeBox, YouAffected,
} from './ActionDialog.jsx';
import { DeploymentOutcomes } from './deploymentScope.jsx';
import {
  EMERGENCY_PHRASE, MIN_REASON, RESULTS, ROW_OUTCOMES, bulkResult, bulkScope, formatUtc, resultOfError,
} from './accessModel.js';

/**
 * D4801 (#4801, canvas SE05a to SE05g, SE11c; D4803 A1, B1, C1) — the five
 * destructive acts of the Access workspace, each its own Scope → Review →
 * Result, in the one `ActionDialog` shell.
 *
 *   revoke           one session row
 *   revoke_selected  the selected rows, one reason for all of them (B1)
 *   sign_out         every session of one account
 *   end              one support session: its token is refused from its next request (D4669, replacing C1)
 *   emergency        every HQ-held account, you included (A1)
 *
 * NOTHING IS SHOWN AS DONE BEFORE THE SERVER SAYS SO. The Result step is
 * reached only from the request's own answer: a reply, or a thrown error read
 * by `resultOfError`. While the request is in flight the dialog says it is
 * waiting, cannot be closed with Esc, and draws no outcome.
 *
 * Each act's reason is typed inside its own dialog and checked against the
 * server's MIN_REASON before Review; the typed confirmation is the emergency
 * act's alone.
 */

const WRITE_BAR = 'Needs a session signed in with your authenticator (TOTP) and a recent step-up. If the step-up has lapsed you will be asked for a code, and the request continues after it.';

function KV({ rows }) {
  return (
    <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]" data-testid="action-review">
      {rows.filter(Boolean).map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="font-semibold text-axal-muted dark:text-gray-400">{k}</dt>
          <dd className="min-w-0 break-words text-axal-ink dark:text-gray-100">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** The scope, the "you" line, the primary button's words, per act. */
export function actionCopy(action, { expiryMinutes = 30, now = Date.now() } = {}) {
  const { kind } = action;
  if (kind === 'revoke') {
    const s = action.session;
    return {
      title: 'Revoke this session?',
      scope: {
        title: 'Affects exactly one session',
        items: [
          `${s.name} · ${s.device} · session ${s.id}`,
          `Its token is refused from its next request`,
          action.self ? 'Your other sessions stay signed in' : `${s.name}'s other sessions stay signed in`,
        ],
      },
      you: action.self
        ? { affected: false, text: 'This is another of your own sessions. The session you are using now is not this one and stays signed in.' }
        : { affected: false, text: 'You are not affected.' },
      reach: 'One session',
      confirm: 'Revoke session',
      placeholder: 'e.g. unrecognised device reported by the account holder',
    };
  }
  if (kind === 'revoke_selected') {
    const own = action.sessions.filter((s) => s.self).length;
    return {
      title: `Revoke ${action.sessions.length} session${action.sessions.length === 1 ? '' : 's'}?`,
      scope: {
        title: bulkScope(action.sessions),
        items: [
          ...action.sessions.map((s) => `${s.name} · ${s.device} · session ${s.id}`),
          'Each revoke is recorded separately, with the one reason below',
          'The accounts\' other sessions stay signed in',
        ],
      },
      you: { affected: false, text: own
        ? `You are not affected: ${own} of these ${own === 1 ? 'is another of your sessions' : 'are other sessions of yours'}, and the session you are using can't be selected.`
        : 'You are not affected — your current session can\'t be selected.' },
      reach: bulkScope(action.sessions),
      confirm: `Revoke ${action.sessions.length} session${action.sessions.length === 1 ? '' : 's'}`,
      placeholder: 'e.g. lost laptop reported in #ops',
    };
  }
  if (kind === 'sign_out') {
    return {
      title: `Sign out ${action.name} everywhere?`,
      scope: {
        title: `Every session ${action.name} holds, on every device`,
        items: [
          'Raises the account\'s sign-in floor: every token issued before now is refused at its next request',
          action.listed === null
            ? null
            : `${action.listed} of their sessions ${action.listed === 1 ? 'is' : 'are'} in the list read on this page; any it does not show are reached too`,
          'No other account is touched',
        ],
      },
      you: action.self
        ? { affected: true, text: 'You will be signed out too: this is your own account, this session included. You\'ll need your password and authenticator to come back.' }
        : { affected: false, text: 'You are not affected.' },
      reach: `Every session of ${action.name}`,
      confirm: `Sign out ${action.name}`,
      placeholder: 'e.g. credentials reported compromised, ticket SEC-212',
    };
  }
  if (kind === 'end') {
    return {
      title: 'End support session?',
      scope: {
        title: 'Ends one support session',
        items: [
          `${action.admin} acting as ${action.target} · started ${action.started || 'at a time not stamped'}`,
          'Its token is refused from its next request (D4669)',
          'Its record is closed, so it can no longer be extended',
          `${action.target} is not signed out of their own sessions`,
        ],
      },
      you: { affected: false, text: action.self ? 'This is your own support session. Closing it does not end your admin session.' : 'Your own admin session continues.' },
      reach: 'One support session',
      confirm: 'End support session',
      placeholder: 'e.g. support ticket resolved',
    };
  }
  return {
    title: 'Emergency re-authentication',
    scope: {
      title: 'Signs out every HQ-held account',
      danger: true,
      items: [
        'Every active account held in the HQ database must sign in again',
        'Branch databases are not touched — accounts a branch holds stay signed in',
        'Sessions issued before now stop working at their next request',
      ],
    },
    you: { affected: true, text: 'You will be signed out too. You\'ll need your password and a fresh step-up to come back.' },
    reach: 'Every HQ-held account; branch databases are not touched; you will be signed out too',
    confirm: 'Sign out every HQ-held account',
    placeholder: 'e.g. credential leak suspected, incident INC-112',
  };
}

/** The Result step's heading, per act and result. */
export function resultTitle(action, outcome) {
  const { kind } = action;
  const { result } = outcome;
  if (kind === 'revoke_selected' && (result === 'done' || result === 'partial')) {
    return `Revoked ${outcome.revoked} of ${outcome.total} session${outcome.total === 1 ? '' : 's'}`;
  }
  if (result === 'done') {
    return {
      revoke: 'Session revoked',
      sign_out: `${action.name} signed out everywhere`,
      end: 'Support session ended',
      emergency: 'HQ-held accounts signed out',
    }[kind];
  }
  if (result === 'already_revoked') {
    if (kind === 'end') return 'Already ended — nothing changed';
    return kind === 'revoke_selected' ? 'Every selected session was already revoked' : 'Already revoked — nothing changed';
  }
  if (result === 'not_found') return kind === 'revoke_selected' ? 'None of the selected sessions was found' : 'Not found — nothing changed';
  if (result === 'expired') {
    return outcome.code === 'past_ceiling' ? 'Past its ceiling — nothing changed' : 'Your session has expired — nothing was done';
  }
  if (result === 'refused') {
    if (outcome.code === 'own_current_session') return 'Refused — that is the session you are using';
    if (outcome.code === 'step_up_required' || /TOTP required/i.test(outcome.message)) return 'Refused — needs your authenticator and a fresh step-up';
    return 'Refused — nothing was changed';
  }
  if (result === 'failed') return 'Couldn\'t complete it — the server reported an error';
  return 'Outcome unknown — re-read before retrying';
}

function ResultBody({ action, outcome, rowsById }) {
  const r = RESULTS[outcome.result];
  const at = formatUtc(outcome.receivedAt);
  const lines = [];
  if (outcome.result === 'done' || outcome.result === 'partial') {
    if (action.kind === 'revoke') lines.push(`Revoked at ${formatUtc(outcome.res?.revoked_at) || 'a time the server did not return'}. The account's other sessions are untouched.`);
    if (action.kind === 'sign_out') {
      lines.push(`Every session ${action.name} held before ${formatUtc(outcome.res?.revoked_at) || 'now'} is refused from its next request. They will need to sign in again.`);
    }
    if (action.kind === 'end') {
      lines.push('Its token is refused from its next request, and the record is closed so it can\'t be extended.');
    }
  }
  return (
    <div className="flex flex-col gap-3" data-testid="action-result" data-result={outcome.result} data-code={outcome.code || ''}>
      <p role={outcome.result === 'failed' || outcome.result === 'unknown' ? 'alert' : 'status'} className="flex flex-wrap items-center gap-2 text-[12.5px] text-axal-muted dark:text-gray-300">
        <StatusBadge state={r.state} label={r.word} />
        {outcome.result === 'done' || outcome.result === 'partial'
          ? <span>Confirmed by the server; reply received {at}.</span>
          : outcome.result === 'unknown'
            ? <span>The server didn&apos;t confirm the change. Nothing is shown as done.</span>
            : <span>Nothing is shown as changed.</span>}
      </p>
      {lines.map((l) => <p key={l} className="text-[12.5px] text-axal-ink dark:text-gray-100">{l}</p>)}
      {action.kind === 'emergency' && outcome.result === 'done' && (
        <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="action-affected">
          <span>Accounts signed out:</span>
          <ReadValue value={outcome.res?.affected} what="The count" className="font-bold" />
          <span>— every active HQ-held account, including yours. Branch databases were not touched.</span>
        </p>
      )}
      {action.kind === 'sign_out' && outcome.result === 'done' && (
        <p className="text-[12.5px]">Which devices this reached: <NI>the sign-out raises the account&apos;s floor; it does not list sessions.</NI></p>
      )}
      {action.kind === 'revoke_selected' && outcome.rows && (
        <ul className="divide-y divide-axal-hairline rounded-lg border border-axal-hairline dark:divide-gray-800 dark:border-gray-700" data-testid="action-rows">
          {outcome.rows.map((row) => {
            const s = rowsById.get(row.id);
            const o = ROW_OUTCOMES[row.outcome];
            return (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12.5px]" data-testid={`action-row-${row.id}`} data-outcome={row.outcome}>
                <span className="min-w-0">
                  <b className="text-axal-ink dark:text-white">{s ? `${s.name} · ${s.device}` : `Session ${row.id}`}</b>
                  <small className="block text-axal-muted dark:text-gray-400">
                    session {row.id}
                    {row.outcome === 'already_revoked' ? ' · had already been revoked — nothing changed' : ''}
                    {row.outcome === 'not_found' ? ' · no session holds this id — nothing changed' : ''}
                  </small>
                </span>
                <StatusBadge state={o.state} label={o.word} />
              </li>
            );
          })}
        </ul>
      )}
      {outcome.result !== 'done' && outcome.message && (
        <KV rows={[['Server said', outcome.message]]} />
      )}
      {outcome.result === 'unknown' && (
        <KV rows={[['State now', <StatusBadge key="u" state="unknown" label="Unknown — re-read before retrying" />]]} />
      )}
      {(action.kind === 'sign_out' || action.kind === 'emergency') && outcome.result === 'done' && (
        <DeploymentOutcomes outcomes={outcome.res?.outcomes} />
      )}
    </div>
  );
}

export default function AccessActionDialog({
  action, onAct, onConfirmed, onClose, onReread, expiryMinutes = 30, now = () => Date.now(),
  returnFocus, fallbackFocus, rowsById = new Map(),
}) {
  const [step, setStep] = useState(1);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(null);
  const [phrase, setPhrase] = useState('');
  const [phraseError, setPhraseError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const copy = actionCopy(action, { expiryMinutes, now: now() });
  const id = `act-${action.kind}`;

  const toReview = () => {
    if (reason.trim().length < MIN_REASON) {
      setReasonError(`Add a reason of at least ${MIN_REASON} characters.`);
      return;
    }
    setReasonError(null);
    setStep(2);
  };

  const arg = action.kind === 'revoke' ? action.session.id
    : action.kind === 'revoke_selected' ? action.sessions.map((s) => s.id)
      : action.kind === 'sign_out' ? action.userId
        : action.kind === 'end' ? action.impId : undefined;

  const send = async () => {
    if (action.kind === 'emergency' && phrase.trim() !== EMERGENCY_PHRASE) {
      setPhraseError(`Type ${EMERGENCY_PHRASE} exactly to confirm.`);
      return;
    }
    setPhraseError(null);
    setBusy(true);
    let out;
    try {
      const res = await onAct(action.kind, arg, reason.trim());
      out = action.kind === 'revoke_selected'
        ? { ...bulkResult(res, arg), res }
        : { result: 'done', res };
    } catch (err) {
      out = resultOfError(err);
    }
    out.receivedAt = now();
    setOutcome(out);
    setBusy(false);
    setStep(3);
    onConfirmed?.(action, arg, out);
  };

  let footer;
  if (step === 1) {
    footer = [
      <button key="c" type="button" onClick={onClose} className={BTN_PLAIN}>Cancel</button>,
      <button key="n" type="button" onClick={toReview} className={action.kind === 'emergency' ? BTN_DANGER : BTN_PRIMARY} data-testid="action-continue">Continue to review</button>,
    ];
  } else if (step === 2) {
    footer = [
      <button key="b" type="button" onClick={() => setStep(1)} disabled={busy} className={BTN_PLAIN}>Back</button>,
      <button key="s" type="button" onClick={send} disabled={busy} className={BTN_DANGER} data-testid="action-confirm">
        {busy ? 'Waiting for the server…' : copy.confirm}
      </button>,
    ];
  } else {
    const retry = outcome.result === 'unknown' || outcome.result === 'failed';
    const selfOut = outcome.result === 'done' && (action.kind === 'emergency' || (action.kind === 'sign_out' && action.self));
    footer = [
      retry && onReread && <button key="r" type="button" onClick={() => { onReread(); onClose(); }} className={BTN_PLAIN} data-testid="action-reread">Re-read sessions</button>,
      retry && <button key="t" type="button" onClick={() => { setOutcome(null); setStep(2); }} className={BTN_PLAIN} data-testid="action-retry">Try again</button>,
      selfOut
        ? <a key="l" href="/login" className={BTN_PRIMARY} data-testid="action-sign-in">Sign in again</a>
        : <button key="d" type="button" onClick={onClose} className={BTN_PRIMARY} data-testid="action-done">Done</button>,
    ].filter(Boolean);
  }

  return (
    <ActionDialog
      id={id}
      title={step === 3 ? resultTitle(action, outcome) : step === 2 ? `Review: ${copy.title.replace(/\?$/, '')}` : copy.title}
      step={step}
      busy={busy}
      onClose={onClose}
      returnFocus={returnFocus}
      fallbackFocus={fallbackFocus}
      footer={footer}
      testid={`action-dialog-${action.kind}`}
    >
      {step === 1 && (
        <>
          <ScopeBox title={copy.scope.title} items={copy.scope.items} danger={copy.scope.danger} testid="action-scope" />
          <YouAffected affected={copy.you.affected} text={copy.you.text} />
          <ReasonField id={`${id}-reason`} value={reason} onChange={setReason} error={reasonError} placeholder={copy.placeholder} />
          <p className="text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="action-write-bar">{WRITE_BAR}</p>
        </>
      )}
      {step === 2 && (
        <>
          <KV rows={[
            ['Scope', copy.reach],
            action.kind === 'emergency' ? ['Not affected', 'Accounts held in branch databases'] : null,
            action.kind === 'emergency' ? ['How many', <NI key="n">the server counts the accounts as it signs them out; the number is shown after it runs.</NI>] : null,
            ['You', copy.you.affected ? <span key="y" className="font-semibold text-amber-800 dark:text-amber-200">{action.kind === 'emergency' ? 'Signed out after this completes' : 'Signed out — this is your own account'}</span> : 'Not affected'],
            ['Reason', reason.trim()],
            action.kind === 'revoke_selected' ? ['Limit', 'Up to 100 sessions per request'] : null,
            ['Authority', 'Super admin · TOTP session · step-up checked by the server when you confirm'],
          ]} />
          {action.kind === 'revoke_selected' && (
            <ul className="space-y-1 text-[12.5px] text-axal-muted dark:text-gray-300" data-testid="action-review-rows">
              {action.sessions.map((s) => <li key={s.id}>• {s.name} · {s.device} · session {s.id}</li>)}
            </ul>
          )}
          {action.kind === 'emergency' && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-phrase`} className="text-[12px] font-bold text-axal-ink dark:text-white">
                Type <b className="font-mono">{EMERGENCY_PHRASE}</b> to confirm
              </label>
              <input
                id={`${id}-phrase`}
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                autoComplete="off"
                aria-invalid={phraseError ? 'true' : undefined}
                aria-describedby={phraseError ? `${id}-phrase-error` : undefined}
                className="min-h-[44px] w-full rounded-md border border-axal-hairline bg-white px-2.5 font-mono text-[13px] text-axal-ink sm:min-h-[36px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                data-testid="action-phrase"
              />
              {phraseError && <span id={`${id}-phrase-error`} role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-300">✕ {phraseError}</span>}
            </div>
          )}
          {busy && (
            <p role="status" className="text-[12.5px] text-axal-muted dark:text-gray-300" data-testid="action-waiting">
              Waiting for the server. Nothing is shown as done until it answers.
            </p>
          )}
        </>
      )}
      {step === 3 && (
        <ResultBody
          action={action}
          outcome={outcome}
          rowsById={rowsById}
        />
      )}
    </ActionDialog>
  );
}
