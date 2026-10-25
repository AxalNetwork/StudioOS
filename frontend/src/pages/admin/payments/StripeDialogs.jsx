import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { RECORDED, STEP_UP_NEXT, keyCheck, reasonProblem, refusalOf, syncDiff } from './dialogModel';
import { ReasonField, Refusal } from './ProductDialogs';
import { EYE, FIELD, GHOST, MONO, PRIMARY, SUB, PayDialog } from './payUi';

/**
 * D1013 (#2832) — the Stripe dialogs (PAY6): replace the publishable key with
 * its live mode check, register an endpoint, add the missing events, and the
 * sync with its result or its failure.
 *
 * The page never shows or takes a secret key: Replace key refuses `sk_` and
 * `rk_` before anything is sent, and after a replace only the mode is said.
 * Replacing the key changes what checkout charges with, so it carries a
 * reason and the step-up (D1009). Registering writes the signing secret on the
 * platform, so it asks for the step-up too; adding events and syncing do not.
 */

const LINE = { good: 'text-emerald-700 dark:text-emerald-300', bad: 'text-axal-destructive dark:text-red-300', muted: 'text-axal-muted dark:text-gray-400' };

function Footer({ onClose, busy, disabled, label, form, testId, back = 'Back' }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className={GHOST} onClick={onClose} disabled={busy}>{back}</button>
      <button type="submit" form={form} className={PRIMARY} disabled={disabled || busy} data-testid={testId}>{busy ? 'Working…' : label}</button>
    </div>
  );
}

function useWrite(send, onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true);
    setError(null);
    try { onDone(await send()); } catch (err) { setError(refusalOf(err)); setBusy(false); }
  };
  return { busy, error, run };
}

/** PAY6a/b: the key, checked against the account's mode as it is typed. A mismatched key is not sent. */
export function ReplaceKeyDialog({ accountMode, onClose, onDone }) {
  const [key, setKey] = useState('');
  const [reason, setReason] = useState('');
  const check = keyCheck(key, accountMode);
  const blocked = !check.ok || check.mismatch || Boolean(reasonProblem(reason));
  const { busy, error, run } = useWrite(
    () => api.adminStripeSetConfig(key.trim(), reason.trim()),
    (out) => { setKey(''); onDone({ text: `The publishable key was replaced${out?.mode ? ` with a ${out.mode === 'live' ? 'Live' : 'Test'} key` : ''}. ${RECORDED}` }); },
  );
  return (
    <PayDialog title="Replace the publishable key" onClose={onClose} testId="pay-replace-key"
      footer={<Footer onClose={onClose} busy={busy} disabled={blocked} label="Replace key" form="pay-replace-key-form" testId="pay-replace-key-send" />}>
      <form id="pay-replace-key-form" onSubmit={run} className="flex flex-col gap-3" data-testid="pay-replace-key-form" autoComplete="off">
        <label className="flex flex-col gap-1">
          <span className={EYE}>Publishable key</span>
          <input value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false} autoComplete="off" placeholder="pk_live_…"
            className={`${FIELD} ${MONO} ${check.tone === 'bad' && key ? 'border-axal-destructive dark:border-red-500' : ''}`} data-testid="pay-replace-key-input" />
        </label>
        <span className={`text-[12.5px] ${LINE[check.tone]}`} data-testid="pay-replace-key-check">{check.text}</span>
        <ReasonField value={reason} onChange={setReason} testId="pay-replace-key-reason" />
        <span className={SUB}>Every checkout uses it at once. {RECORDED} {STEP_UP_NEXT}</span>
        <Refusal error={error} testId="pay-replace-key-error" />
      </form>
    </PayDialog>
  );
}

/** PAY6c: a new endpoint with every event the platform acts on, and its signing secret stored on the platform. */
export function RegisterEndpointDialog({ ourUrl, events = [], onClose, onDone }) {
  const { busy, error, run } = useWrite(() => api.adminStripeRegisterWebhook(), () => onDone({ text: `The endpoint was registered and its signing secret stored. ${RECORDED}` }));
  return (
    <PayDialog title="Register a new endpoint?" sub="This creates an endpoint in Stripe with every event the platform acts on, and stores its signing secret on the platform." onClose={onClose} testId="pay-register"
      footer={<Footer onClose={onClose} busy={busy} label="Register" form="pay-register-form" testId="pay-register-send" />}>
      <form id="pay-register-form" onSubmit={run} className="flex flex-col gap-2" data-testid="pay-register-form">
        <span className={`${MONO} break-all text-[13px] text-axal-ink dark:text-gray-100`}>{ourUrl || 'This platform’s webhook address'}</span>
        <span className={SUB}>{events.length ? `${events.length} events` : 'Every event the platform acts on'}</span>
        <span className={SUB}>Only the Super Admin can do this. It asks for your authenticator code and is recorded.</span>
        <Refusal error={error} testId="pay-register-error" />
      </form>
    </PayDialog>
  );
}

/** Our endpoint's missing events, added. The endpoint's address and its secret are not touched. */
export function AddEventsDialog({ endpoint, onClose, onDone }) {
  const missing = endpoint.missing_events || [];
  const { busy, error, run } = useWrite(() => api.adminStripeUpdateWebhookEvents(endpoint.id), () => onDone({ text: `The missing events were added to the endpoint. ${RECORDED}` }));
  return (
    <PayDialog title="Add the missing events?" sub="Stripe then sends this platform every event it acts on. The endpoint's address and signing secret stay as they are." onClose={onClose} testId="pay-add-events"
      footer={<Footer onClose={onClose} busy={busy} label="Add the events" form="pay-add-events-form" testId="pay-add-events-send" />}>
      <form id="pay-add-events-form" onSubmit={run} className="flex flex-col gap-2" data-testid="pay-add-events-form">
        <span className={EYE}>{missing.length} missing</span>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">{missing.map((ev) => <li key={ev} className={`${MONO} break-all text-[12px] text-axal-ink dark:text-gray-100`}>{ev}</li>)}</ul>
        <span className={SUB}>{RECORDED}</span>
        <Refusal error={error} testId="pay-add-events-error" />
      </form>
    </PayDialog>
  );
}

/**
 * PAY6d/e: the sync. What changed is the catalogue read before and after,
 * compared; when the read before did not answer, the dialog says it cannot
 * list what changed rather than calling everything new. A failure is
 * recorded by the Worker (D1011) and nothing in the mirror changes.
 */
export function SyncDialog({ onClose, onDone }) {
  const [state, setState] = useState({ status: 'idle' });
  const sync = async () => {
    setState({ status: 'busy' });
    let before = null;
    try { before = (await api.adminCatalogList())?.products ?? null; } catch { before = null; }
    try {
      const out = await api.adminCatalogSync();
      let after = null;
      try { after = (await api.adminCatalogList())?.products ?? null; } catch { after = null; }
      setState({ status: 'done', synced: out?.synced ?? null, diff: before && after ? syncDiff(before, after) : null });
    } catch (e) {
      setState({ status: 'failed', error: refusalOf(e) });
    }
  };
  const done = () => onDone({ text: state.status === 'done' ? `Synced from Stripe. ${RECORDED}` : null });
  return (
    <PayDialog title="Sync from Stripe" sub="Reads every product and price in Stripe and updates the catalogue." onClose={state.status === 'done' ? done : onClose} testId="pay-sync"
      footer={(
        <div className="flex justify-end gap-2">
          {state.status === 'done' && <button type="button" className={PRIMARY} onClick={done} data-testid="pay-sync-done">Done</button>}
          {state.status === 'failed' && <button type="button" className={GHOST} onClick={sync} data-testid="pay-sync-retry">Try again</button>}
          {(state.status === 'idle' || state.status === 'busy') && (
            <>
              <button type="button" className={GHOST} onClick={onClose} disabled={state.status === 'busy'}>Back</button>
              <button type="button" className={PRIMARY} onClick={sync} disabled={state.status === 'busy'} data-testid="pay-sync-send">{state.status === 'busy' ? 'Syncing…' : 'Sync now'}</button>
            </>
          )}
        </div>
      )}>
      {state.status === 'idle' && <span className={SUB}>Nothing syncs on a schedule. A product made in the Stripe dashboard appears after a sync. {RECORDED}</span>}
      {state.status === 'busy' && <span className={SUB}>Reading Stripe…</span>}
      {state.status === 'done' && (
        <div className="flex flex-col gap-1.5" data-testid="pay-sync-result">
          <span className={`text-[12.5px] ${LINE.good}`}>{state.synced == null ? 'Synced.' : `Synced ${state.synced} product${state.synced === 1 ? '' : 's'}.`}</span>
          {state.diff ? (
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[12.5px] text-axal-ink dark:text-gray-100">
              <li>{state.diff.added.length ? `${state.diff.added.length} new: ${state.diff.added.join(', ')}.` : 'Nothing new.'}</li>
              <li>{state.diff.gone.length ? `${state.diff.gone.length} gone from Stripe: ${state.diff.gone.join(', ')}.` : 'Nothing gone from Stripe.'}</li>
            </ul>
          ) : <span className={SUB}>What changed could not be listed: the catalogue could not be read before and after.</span>}
        </div>
      )}
      {state.status === 'failed' && (
        <div className="flex flex-col gap-1" data-testid="pay-sync-failed">
          <span className={`text-[12.5px] ${LINE.bad}`}>{state.error.status >= 500 || !state.error.status ? 'Stripe did not answer. Nothing changed. This failure is recorded.' : state.error.message}</span>
          <Refusal error={{ ...state.error, message: '' }} />
        </div>
      )}
    </PayDialog>
  );
}
