import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { disablePush, enablePush, getPushState } from '../../lib/pwa';
import { EmptyState, Pill, Unrecorded, Unreadable } from '../../ui';
import { BTN, LoadingRows, Outcome, PanelCard, useAccountRead } from './AccountCenter';
import { dayLabel, deviceLabel } from './accountCenterModel';

/**
 * D568 — the two device lists the canvas draws: browsers registered for push
 * (Notifications) and signed-in sessions (Sign-in and security).
 *
 * PUSH. `GET /notifications/push/subscriptions` lists each subscription by id,
 * user agent and dates, and NOT by endpoint; the route's remove,
 * `POST /notifications/push/unsubscribe`, takes the endpoint. Only the browser
 * that holds a subscription knows its endpoint, so this browser can remove its
 * own (`disablePush()`, the bell's own path), and no row can remove another
 * device. The card says so rather than drawing a Remove beside every row that
 * would have nothing to send.
 */

function DeviceRow({ row }) {
  const label = deviceLabel(row.user_agent);
  const delivered = dayLabel(row.last_sent_at);
  const registered = dayLabel(row.created_at);
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5 text-[13px]" data-testid={`push-device-${row.id}`}>
      <div className="min-w-0">
        <div className="font-semibold text-axal-ink dark:text-gray-100">
          {label ? label.name : <Unrecorded reason="the browser sent no user agent when it subscribed">Unnamed browser</Unrecorded>}
          {label?.os && <span className="font-normal text-axal-muted dark:text-gray-400"> · {label.os}</span>}
        </div>
        <div className="mt-0.5 font-mono text-[11.5px] text-axal-muted dark:text-gray-400">
          {delivered
            ? <>last push delivered {delivered}</>
            : <><Unrecorded reason="no push has reached this browser since it registered">Not recorded</Unrecorded> · no push delivered yet</>}
          {registered && <> · registered {registered}</>}
        </div>
        {row.last_error && (
          <div className="mt-0.5 text-[11.5px] text-red-700 dark:text-red-300">The last push failed: {String(row.last_error).slice(0, 140)}</div>
        )}
      </div>
    </li>
  );
}

/**
 * The card. `subs` is the read of the subscription list; `push` is this
 * browser's own state from `getPushState()` (supported, subscribed,
 * permission), null until it is known.
 */
export function PushDevicesCard({ subs, push, busy, outcome, confirming, onEnable, onAskRemove, onCancelRemove, onRemove }) {
  const rows = subs.status === 'ready' && Array.isArray(subs.data?.subscriptions) ? subs.data.subscriptions : [];
  return (
    <PanelCard
      title="Devices registered for push"
      aside={subs.status === 'ready' ? `${rows.length} registered` : null}
      data-testid="card-push-devices"
      footer="A push mirrors your in-app notifications. A device other than this one is removed from that device: turn push off there, or sign out there."
    >
      {subs.status === 'loading' ? <LoadingRows lines={2} />
        : subs.status === 'unreadable' ? (
          <Unreadable what="Your push devices" claim={subs.message || 'This is not a claim that none is registered.'} onRetry={subs.reload} />
        ) : rows.length === 0 ? (
          <EmptyState size="sm" data-testid="push-devices-empty" title="No device is registered for push." body="Open the app on a phone or computer and turn push on there, or on this browser below." />
        ) : (
          <ul className="divide-y divide-axal-hairline dark:divide-gray-800">{rows.map((row) => <DeviceRow key={row.id} row={row} />)}</ul>
        )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-3 text-[12.5px] dark:border-gray-800" data-testid="push-this-browser">
        {!push ? (
          <span className="text-axal-muted dark:text-gray-400">Checking this browser…</span>
        ) : push.unknown ? (
          <span className="text-axal-muted dark:text-gray-400">Whether this browser receives push could not be read.</span>
        ) : !push.supported ? (
          <span className="text-axal-muted dark:text-gray-400">This browser cannot receive push.</span>
        ) : push.subscribed ? (
          confirming ? (
            <>
              <span className="text-axal-ink dark:text-gray-100">Stop push on this browser? Notifications still reach your inbox.</span>
              <span className="flex gap-2">
                <button type="button" className={BTN.ghost} onClick={onCancelRemove} disabled={busy}>Cancel</button>
                <button type="button" className={BTN.dangerSolid} onClick={onRemove} disabled={busy} data-testid="button-push-remove-confirm">{busy ? 'Removing…' : 'Remove this browser'}</button>
              </span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-2 text-axal-ink dark:text-gray-100"><Pill tone="ok">This browser</Pill> receives push.</span>
              <button type="button" className={BTN.danger} onClick={onAskRemove} disabled={busy} data-testid="button-push-remove">Remove</button>
            </>
          )
        ) : push.permission === 'denied' ? (
          <span className="text-axal-muted dark:text-gray-400">Push is blocked in this browser’s settings, so it cannot be turned on from here.</span>
        ) : (
          <>
            <span className="text-axal-muted dark:text-gray-400">This browser is not registered.</span>
            <button type="button" className={BTN.ghost} onClick={onEnable} disabled={busy} data-testid="button-push-enable">{busy ? 'Turning on…' : 'Turn on push here'}</button>
          </>
        )}
      </div>
      <div className="mt-2"><Outcome outcome={outcome} /></div>
    </PanelCard>
  );
}

/** The container: the list read, this browser's state, and the two writes this browser can make. */
export function PushDevices() {
  const subs = useAccountRead(() => api.pushSubscriptions());
  const [push, setPush] = useState(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const { reload } = subs;

  // `getPushState()` waits on `navigator.serviceWorker.ready`, which never
  // settles where no service worker is registered (the Vite dev server
  // unregisters it). Bounded, so the card says it does not know rather than
  // "Checking…" for ever.
  const readPush = useCallback(() => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) setPush({ unknown: true }); }, 4000);
    getPushState().then(
      (state) => { settled = true; clearTimeout(timer); setPush(state); },
      () => { settled = true; clearTimeout(timer); setPush({ unknown: true }); },
    );
  }, []);
  useEffect(() => { readPush(); }, [readPush]);

  const run = async (write, ok) => {
    setBusy(true);
    setOutcome(null);
    try {
      await write();
      setOutcome({ tone: 'ok', text: ok });
    } catch (e) {
      setOutcome({ tone: 'error', text: e?.message || 'That did not go through. Try again in a moment.' });
    } finally {
      setBusy(false);
      setConfirming(false);
      readPush();
      reload();
    }
  };

  return (
    <PushDevicesCard
      subs={subs}
      push={push}
      busy={busy}
      outcome={outcome}
      confirming={confirming}
      onEnable={() => run(enablePush, 'Push is on for this browser.')}
      onAskRemove={() => setConfirming(true)}
      onCancelRemove={() => setConfirming(false)}
      onRemove={() => run(() => disablePush(), 'This browser no longer receives push.')}
    />
  );
}

function signOutToLogin() {
  window.setTimeout(() => {
    try { localStorage.clear(); } catch { /* storage may be blocked */ }
    window.location.href = '/login';
  }, 1500);
}

/**
 * Sessions and alerts: the canvas's settings block and its "Sign out
 * everywhere". `security` is the read of `GET /settings/security`; the active
 * session count is its `active_sessions`.
 *
 * Neither setting the canvas draws has a store. No route holds a session
 * length per account (every session has the platform's one length), and no
 * route holds a new-device alert choice — the `auth_signin_new_device` email
 * template exists and nothing sends it. Both read "Not recorded" with that
 * reason, not a value or a switch that would change nothing.
 */
export function SessionsCard({ security, signOut = () => api.signOutEverywhere(), afterSignOut = signOutToLogin }) {
  const [stage, setStage] = useState('idle');
  const [outcome, setOutcome] = useState(null);
  const active = security?.status === 'ready' ? Number(security.data?.active_sessions) : null;

  const confirm = async () => {
    setStage('busy');
    setOutcome(null);
    try {
      await signOut();
      setStage('done');
      setOutcome({ tone: 'ok', text: 'Signed out everywhere. Taking you to sign in…' });
      afterSignOut();
    } catch (e) {
      setStage('idle');
      setOutcome({ tone: 'error', text: e?.message || 'Could not sign out other sessions.' });
    }
  };

  return (
    <PanelCard title="Sessions and alerts" data-testid="card-sessions">
      <dl className="divide-y divide-axal-hairline text-[13px] dark:divide-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-2 py-2">
          <dt className="font-semibold text-axal-ink dark:text-gray-100">Session length</dt>
          <dd className="text-axal-muted dark:text-gray-400" data-testid="value-session-length">
            <Unrecorded reason="no session length is stored per account; every session has the platform's one length">Not recorded</Unrecorded>
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 py-2">
          <dt className="font-semibold text-axal-ink dark:text-gray-100">New-device alerts</dt>
          <dd className="text-axal-muted dark:text-gray-400" data-testid="value-new-device-alerts">
            <Unrecorded reason="no alert setting is stored, and no new-device alert is sent yet">Not recorded</Unrecorded>
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 py-2">
          <dt className="font-semibold text-axal-ink dark:text-gray-100">Active sessions</dt>
          <dd data-testid="value-active-sessions">
            {security?.status === 'loading' ? <span className="text-axal-muted dark:text-gray-400">Reading…</span>
              : security?.status === 'unreadable' ? <span className="text-red-700 dark:text-red-300">Unreadable</span>
                : Number.isFinite(active) ? <Pill tone="neutral">{active} active</Pill>
                  : <Unrecorded reason="the security summary carried no session count">Not recorded</Unrecorded>}
          </dd>
        </div>
      </dl>
      {security?.status === 'unreadable' && (
        <Unreadable what="Your security summary" claim={security.message || 'This is not a claim that you have no sessions.'} onRetry={security.reload} />
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-3 dark:border-gray-800">
        <span className="text-xs text-axal-muted dark:text-gray-400">Signs you out on every device, including this one.</span>
        {stage === 'confirm' || stage === 'busy' ? (
          <span className="flex gap-2">
            <button type="button" className={BTN.ghost} onClick={() => setStage('idle')} disabled={stage === 'busy'}>Cancel</button>
            <button type="button" className={BTN.dangerSolid} onClick={confirm} disabled={stage === 'busy'} data-testid="button-sign-out-everywhere-confirm">
              {stage === 'busy' ? 'Signing out…' : 'Yes, sign out everywhere'}
            </button>
          </span>
        ) : (
          <button type="button" className={BTN.danger} onClick={() => setStage('confirm')} disabled={stage === 'done'} data-testid="button-sign-out-everywhere">
            Sign out everywhere
          </button>
        )}
      </div>
      <div className="mt-2"><Outcome outcome={outcome} /></div>
    </PanelCard>
  );
}
