/**
 * #4686 — the licence page's branch sync and its unfinished-termination
 * notice. D5924 (#5924) redrew the sync half to Licences v2 boards L14
 * (synced) and L15 (update pending): the two Sources apart, then one card for
 * where the branch stands, from `GET /api/admin/licences/:uid`'s `sync`
 * (`licence_sync_state`, `licence_push_pending`). A figure nobody recorded
 * reads "Not recorded", never 0; a failure shows a sentence for its code and
 * the code itself, never the error's own text; and a sync record that could
 * not be read is never drawn as synced. D6733 (#6733) wires Retry sync to
 * `POST /api/admin/licences/:uid/sync/retry`: it sends the owed copy now and
 * shows the branch's answer, accepted or the failure code's sentence.
 */
import React, { useState } from 'react';
import {
  AlertTriangle, CheckCircle2, CircleAlert, CircleDashed, CircleHelp, CircleSlash, RefreshCw, RotateCw,
} from 'lucide-react';
import { Unreadable } from '../../../ui/Honesty';
import OutcomeNotice from '../../../components/OutcomeNotice';
import { licenceSyncApi } from '../../../lib/api/licenceSync';
import {
  BRANCH_LINE_NOTE, RETRY_SYNC_NOTE, RETRY_SYNC_NOTHING_OWED, noticeForSyncRetry, noticeForSyncRetryError, syncBoard, syncSources,
} from '../licenceDeploymentModel';
import { clockText } from '../licenceOverviewModel';

// D4819 part 3: the failure sentences moved to `licenceOverviewModel.js`, which the Overview's Branch fact reads too.

const TERMINATION_STEP_SENTENCE = {
  notices: 'compliance notices were not withdrawn',
  notify: 'the administrators were not told',
  admins: 'HQ administrators were not deprovisioned',
  push: 'the branch has not received the terminated licence',
  unbind: 'the branch administrators were not unbound',
};

/** One shape per state, so a state is never told by colour alone. */
const SHAPE = {
  synced: CheckCircle2,
  pending: AlertTriangle,
  out_of_sync: AlertTriangle,
  not_recorded: CircleDashed,
  unconfirmed: CircleHelp,
  unreadable: CircleAlert,
  none: CircleSlash,
};

const TONE = {
  synced: 'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200',
  pending: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  out_of_sync: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  not_recorded: 'border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300',
  unconfirmed: 'border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300',
  unreadable: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
  none: 'border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300',
};

const BUTTON = 'inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium sm:min-h-0 sm:w-auto sm:py-1.5';

function StateWord({ state, word }) {
  const Shape = SHAPE[state] || CircleHelp;
  return (
    <span
      data-testid="licence-sync-state"
      data-state={state}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE[state] || TONE.unconfirmed}`}
    >
      <Shape size={13} aria-hidden="true" /> {word}
    </span>
  );
}

function Row({ label, children, testId }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</dt>
      <dd data-testid={testId} className="min-w-0 break-words text-sm text-gray-900 dark:text-gray-100">{children}</dd>
    </div>
  );
}

/** L14 / L15's Sources: what HQ holds and what the branch last accepted, side by side and never merged. */
function Sources({ sync, host }) {
  return (
    <div data-testid="licence-sync-sources">
      <dl className="grid gap-3 sm:grid-cols-2">
        {syncSources(sync, host).map((s) => (
          <div key={s.key} data-testid={`licence-sync-source-${s.key}`} data-state={s.state}
            className="min-w-0 rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{s.label}</dt>
            <dd className={`mt-0.5 break-words text-sm font-semibold ${s.state === 'value' ? 'text-gray-900 dark:text-gray-100' : s.state === 'unreadable' ? 'text-red-700 dark:text-red-300' : 'text-gray-500 dark:text-gray-400'}`}>
              {s.text}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">{BRANCH_LINE_NOTE}</p>
    </div>
  );
}

/**
 * Retry sync, where L15 puts it. D6733: it sends the owed copy now
 * (`onRetrySync`). With no copy queued it is drawn disabled, because the route
 * would send nothing, and says so beside it rather than only on hover.
 */
function RetrySync({ nextTry, owed, onRetrySync, retrying, busy = false }) {
  const usable = owed && Boolean(onRetrySync);
  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <button
        type="button" disabled={!usable || retrying || busy} data-testid="licence-sync-retry" aria-describedby="licence-sync-retry-reason"
        onClick={usable ? onRetrySync : undefined}
        className={`${BUTTON} bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400`}
      >
        <RotateCw size={13} aria-hidden="true" className={retrying ? 'animate-spin' : undefined} /> {retrying ? 'Sending…' : 'Retry sync'}
      </button>
      <p id="licence-sync-retry-reason" data-testid="licence-sync-retry-reason" className="text-[11px] text-gray-600 sm:max-w-xs sm:text-right dark:text-gray-400">
        {owed ? `${RETRY_SYNC_NOTE}${nextTry ? ` ${nextTry}` : ''}` : RETRY_SYNC_NOTHING_OWED}
      </p>
    </div>
  );
}

function ReadAgain({ onReread, busy }) {
  if (!onReread) return null;
  return (
    <button
      type="button" data-testid="licence-sync-reread" disabled={busy} onClick={onReread}
      className={`${BUTTON} border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800`}
    >
      <RefreshCw size={13} aria-hidden="true" /> Read again
    </button>
  );
}

/** The card for where the branch stands: L14 when synced, L15 when a copy is owed. */
function SyncCard({ board, busy, onReread, onRetrySync, retrying }) {
  const { state } = board;
  if (state === 'unreadable') {
    return (
      <div data-testid="licence-sync-card" data-state={state} className="rounded-lg border border-red-200 bg-white p-4 dark:border-red-900 dark:bg-gray-900">
        <StateWord state={state} word={board.word} />
        <div className="mt-2">
          <Unreadable what="The branch sync record" claim="This is not a sign that the branch is synced." onRetry={onReread} />
        </div>
      </div>
    );
  }
  const revisions = `HQ revision ${board.hq ?? 'not recorded'} · branch revision ${board.branch ?? 'not recorded'}`;
  if (state === 'pending' || state === 'out_of_sync') {
    const a = board.attempt;
    const lead = state === 'pending'
      ? (a ? `${revisions} · last attempt failed ${a.ago || clockText(a.at)}` : `${revisions} · not attempted yet`)
      : `${revisions} · no copy is queued`;
    return (
      <section data-testid="licence-sync-card" data-state={state} aria-labelledby="licence-sync-heading"
        className="overflow-hidden rounded-lg border border-amber-300 bg-white dark:border-amber-800 dark:bg-gray-900">
        <div className="flex flex-col gap-3 border-b border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-start dark:border-amber-900 dark:bg-amber-950">
          <div className="min-w-0 flex-1">
            <h3 id="licence-sync-heading" className="text-base font-extrabold text-gray-900 dark:text-gray-100">
              <StateWord state={state} word={board.word} />
            </h3>
            <p data-testid="licence-sync-lead" className="mt-1 break-words text-[13px] text-amber-900 dark:text-amber-200">{lead}</p>
          </div>
          <RetrySync nextTry={state === 'pending' ? board.nextTry : null} owed={state === 'pending'}
            onRetrySync={onRetrySync} retrying={retrying} busy={busy} />
        </div>
        <dl className="space-y-2 p-4">
          {state === 'pending' && (
            <Row label={a ? 'What failed' : 'Why it is waiting'} testId="licence-sync-failed">
              {a ? `${a.sentence} (attempt ${a.attempts})` : 'Nothing yet: this copy is queued with the change and has not been tried.'}
            </Row>
          )}
          {state === 'pending' && a && (
            <Row label="Failed attempt" testId="licence-sync-attempt">
              {a.when} · code <span className="font-mono">{a.code || 'not recorded'}</span>
            </Row>
          )}
          <Row label="Effect" testId="licence-sync-effect">{board.effect}</Row>
          {state === 'out_of_sync' && board.queueUnread && (
            <Row label="Queue">
              <Unreadable what="The queue of copies waiting to be sent" claim="Whether a retry is queued is not known." onRetry={onReread} />
            </Row>
          )}
          {board.accepted && <Row label="Last accepted" testId="licence-sync-accepted">{board.accepted}</Row>}
        </dl>
        {onReread && (
          <div className="flex flex-col gap-2 border-t border-gray-100 p-4 sm:flex-row sm:items-center dark:border-gray-800">
            <ReadAgain onReread={onReread} busy={busy} />
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Reads the licence again, to see whether a retry has landed.</span>
          </div>
        )}
      </section>
    );
  }
  if (state === 'synced') {
    return (
      <section data-testid="licence-sync-card" data-state={state}
        className="rounded-lg border border-green-300 bg-white p-4 dark:border-green-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center gap-2">
          <StateWord state={state} word={board.word} />
          <span data-testid="licence-sync-lead" className="font-mono text-[13px] text-gray-800 dark:text-gray-200">
            Revision {board.hq}{board.accepted ? ` · ${board.accepted}` : ' · accepted at a time not recorded'}
          </span>
        </div>
      </section>
    );
  }
  // not_recorded, unconfirmed, none
  return (
    <section data-testid="licence-sync-card" data-state={state}
      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <StateWord state={state} word={board.word} />
      <p data-testid="licence-sync-lead" className="mt-2 text-sm text-gray-700 dark:text-gray-300">
        {state === 'none' && 'No branch is deployed for this licence, so no copy is sent until one is.'}
        {state === 'not_recorded' && 'HQ has not numbered a revision for this licence yet, so there is nothing to compare.'}
        {state === 'unconfirmed' && `${revisions}.`}
      </p>
      {state === 'unconfirmed' && (
        <div className="mt-2">
          <Unreadable what="The queue of copies waiting to be sent" claim="So this is not drawn as synced." onRetry={onReread} />
        </div>
      )}
    </section>
  );
}

/**
 * D4819 part 3: `part` draws one half where the detail puts it: 'strip' on
 * Operations › Branch and domain, 'termination' above the sections (it carries
 * an action that cannot wait for a tab). Without it, both, as before.
 *
 * D5924: `deployment` is the licence read's `deployment` (null when no branch
 * is deployed; left out, the strip does not judge), `deploymentAvailable` its
 * `deployment_available`, `onReread` re-reads the licence, and `now` is the
 * clock the ages are read against.
 *
 * D6733: `licenceUid` lets Retry sync post the re-send; without it the button
 * stays disabled. Its notice sits under the card, so an accepted copy still
 * says so once the re-read draws the branch as synced.
 */
export function LicenceSyncStrip({ sync, busy, onResume, part, deployment, deploymentAvailable, onReread, now, licenceUid, onRetry = null }) {
  const [retrying, setRetrying] = useState(false);
  const [retryNotice, setRetryNotice] = useState(null);
  const retrySync = licenceUid ? async () => {
    setRetrying(true);
    setRetryNotice(null);
    try {
      setRetryNotice(noticeForSyncRetry(await licenceSyncApi.retry(licenceUid)));
    } catch (e) {
      setRetryNotice(noticeForSyncRetryError(e));
    } finally {
      setRetrying(false);
    }
    if (onReread) await onReread();
  } : onRetry;
  const t = sync?.termination;
  const strip = part !== 'termination';
  const termination = part !== 'strip';
  if (!sync && !strip) return null;
  const host = deployment?.hostname || null;
  const noBranch = deployment === null && deploymentAvailable !== false;
  const board = noBranch && sync?.available !== false
    ? { state: 'none', word: 'No branch deployed' }
    : syncBoard(deploymentAvailable === false ? null : sync, now);
  return (
    <>
      {strip && (
        <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:p-4 dark:border-gray-800 dark:bg-gray-950" data-testid="licence-sync-strip" data-state={board.state}>
          <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-gray-500 dark:text-gray-400">Branch sync</div>
          {!noBranch && <Sources sync={deploymentAvailable === false ? null : sync} host={host} />}
          <SyncCard board={board} busy={busy || retrying} onReread={onReread} onRetrySync={retrySync} retrying={retrying} />
          <OutcomeNotice notice={retryNotice} testId="licence-sync-retry-outcome" onDismiss={() => setRetryNotice(null)} />
        </div>
      )}
      {termination && t && t.status !== 'complete' && (
        <div
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          data-testid="licence-termination-incomplete"
        >
          <div>
            The termination is recorded, but its follow-up is not finished
            {t.failure_step ? `: ${TERMINATION_STEP_SENTENCE[t.failure_step] || 'a step did not complete'}` : ''}.
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onResume}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-400 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900"
          >
            <RotateCw size={12} /> Resume the follow-up
          </button>
        </div>
      )}
    </>
  );
}
