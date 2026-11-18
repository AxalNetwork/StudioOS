/**
 * D4706 (#4706) — what the Deploy step offers next, from the deployment read
 * (`GET /api/admin/licences/:uid/deployment`), and what a status check means.
 *
 * The rule the page lives by: an attempt whose outcome is open is CHECKED,
 * never sent again. Retry appears only for a failed attempt; Check status
 * appears while a run is pending or its dispatch's answer never came; and the
 * page re-checks on its own while that lasts.
 *
 * D5924 (#5924) adds the branch-sync card and the provisioning line of boards
 * L14 and L15 (below), and Reconcile on a failed deployment.
 */
import { describeOutcome, outcomeFromError } from '../../lib/mutationOutcome.js';
import { toUtcInstant } from '../../lib/notices';
import { NOT_RECORDED } from '../../lib/absence';
import { clockText, syncFailureSentence } from './licenceOverviewModel';

/** How often an open attempt is re-checked while the page is open. */
export const DEPLOY_POLL_MS = 30_000;

export function deployActions(view) {
  if (!view) return { canRetry: false, canCheck: false, poll: false, needsDoJurisdiction: false };
  const canRetry = view.retryable === true;
  const canCheck = view.reconcilable === true;
  return {
    canRetry,
    canCheck,
    poll: canCheck,
    // A deployment written before D4706 never stored this write-once value,
    // so the retry asks for it rather than guessing.
    needsDoJurisdiction: canRetry && !view.do_jurisdiction,
  };
}

/** The notice for a status check's answer (`checked`), or null when there is nothing new to say. */
export function noticeForCheck(checked, view) {
  switch (checked) {
    case 'succeeded':
      return describeOutcome('partial', { message: view?.status_note });
    case 'failed':
    case 'no_run':
      return describeOutcome('refused', { message: view?.last_failure?.failure_note || view?.status_note });
    case 'running':
      return describeOutcome('pending', { message: `Attempt ${view?.current_attempt} is running on GitHub.` });
    case 'no_run_yet':
      return describeOutcome('pending', { message: `GitHub has not started a run for attempt ${view?.current_attempt} yet.` });
    default:
      return null;
  }
}

/** The notice for a retry's answer. */
export function noticeForRetry(body) {
  if (body?.replayed) {
    return describeOutcome('committed', { message: `Attempt ${body.attempt} was already asked for, so nothing was sent again. Its state is below.` });
  }
  return describeOutcome('pending', { message: body?.note || `Attempt ${body?.attempt} was asked for.` });
}

/** "Attempt 2 · failed" — one attempt in a line. */
export function attemptLine(a) {
  if (!a) return null;
  return `Attempt ${a.attempt_no} · ${String(a.status).replace(/_/g, ' ')}`;
}

/* ------------------------------------------------------------------ *
 * D5924 (#5924): Licences v2 boards L14 and L15, branch sync and      *
 * provisioning on Operations › Branch and domain.                     *
 * ------------------------------------------------------------------ */

/**
 * D272: HQ re-sends a copy that has not landed at most once per this window
 * (`LICENCE_PUSH_RETRY_WINDOW_MINUTES` in `cloudflare-worker/src/services/licencePush.ts`).
 * The page only says when the next try can come; the Worker's cron decides.
 */
export const SYNC_RETRY_WINDOW_MINUTES = 60;

/**
 * D6733 (#6733): what Retry sync does, beside it. It posts to
 * `POST /api/admin/licences/:uid/sync/retry`, which sends the owed copy now
 * through the cron's own push and records the attempt as the cron does.
 */
export const RETRY_SYNC_NOTE = 'Sends the owed copy now. HQ also re-sends it by itself, at most once an hour after the last attempt.';

/** Compatibility name used by the ledger action surfaces (D4819 part 21). */
export const RETRY_SYNC_REASON = RETRY_SYNC_NOTE;

/** D6733: why Retry sync cannot be pressed when no copy is queued (the route would answer `nothing_pending`). */
export const RETRY_SYNC_NOTHING_OWED = 'No copy is queued, so there is nothing to re-send.';

/**
 * D6733: the notice for Retry sync's answer, `{ ok, pushed, sync }`. Accepted,
 * or the failure code's sentence and the code, never the error's own text.
 */
export function noticeForSyncRetry(body) {
  const p = body?.pushed;
  if (!p) return describeOutcome('unknown');
  if (p.ok) {
    const rev = p.revision ?? p.branch_revision ?? null;
    return describeOutcome('committed', { message: `Sent. The branch accepted ${rev != null ? `revision ${rev}` : 'the copy'}.` });
  }
  if (p.no_deployment) {
    return describeOutcome('committed', { message: 'Nothing was sent: this licence has no branch deployment. A branch reads its copy from HQ the first time it asks.' });
  }
  const code = p.failure_code || null;
  const at = body?.sync?.pending?.last_attempt_at;
  const t = instant(at);
  const next = t != null && t > 0 ? ` HQ tries again by itself not before ${clockText(new Date(t + SYNC_RETRY_WINDOW_MINUTES * 60000).toISOString())}.` : '';
  return describeOutcome('refused', {
    message: `Sent, and not accepted: ${syncFailureSentence(code) || 'It has not landed yet.'}${code ? ` (code ${code})` : ''} The attempt is recorded.${next}`,
  });
}

/** D6733: the notice for a refused Retry sync. The Worker's sentence, or one for its code. */
export function noticeForSyncRetryError(e) {
  if (e?.code === 'nothing_pending') return describeOutcome('refused', { message: 'No copy is owed to the branch, so nothing was sent.' });
  if (e?.code === 'retry_in_flight') return describeOutcome('pending', { message: e.message || 'A sync attempt started moments ago. Read again to see how it ended.' });
  return outcomeFromError(e, 'Retry sync did not run, and nothing was sent. Try again.');
}

/** Where the branch line comes from. HQ never reads the branch itself, so the line never says the branch "responded". */
export const BRANCH_LINE_NOTE = 'This is the branch’s answer to HQ’s last push. HQ does not read what a branch holds on its own yet.';

const instant = (v) => {
  const t = Date.parse(toUtcInstant(v) || '');
  return Number.isNaN(t) ? null : t;
};

/** "4 min ago", "3 h ago", "2 days ago", or null when either time is not one. */
export function agoText(iso, now = new Date().toISOString()) {
  const a = instant(iso);
  const b = instant(now);
  if (a == null || b == null) return null;
  const min = Math.floor((b - a) / 60000);
  if (min < 0) return null;
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** "4 min ago · 9 Nov 2026, 11:56 UTC": how long ago, then the time itself. */
export function whenText(iso, now) {
  if (!iso) return null;
  const ago = agoText(iso, now);
  const at = clockText(iso);
  return ago ? `${ago} · ${at}` : at;
}

/**
 * The failed attempt a `licence_push_pending` row records. A row queued with
 * the change (D4805) is dated 1970 so the next retry picks it up, and has no
 * attempt yet: it is never drawn as a failure.
 */
function attemptOf(p, now) {
  const at = instant(p?.last_attempt_at);
  if (!p || !(Number(p.attempts) > 0) || at == null || at <= 0) return null;
  return {
    at: p.last_attempt_at,
    ago: agoText(p.last_attempt_at, now),
    when: whenText(p.last_attempt_at, now),
    attempts: Number(p.attempts),
    code: p.failure_code || null,
    sentence: syncFailureSentence(p.failure_code) || 'It has not landed yet.',
    next: new Date(at + SYNC_RETRY_WINDOW_MINUTES * 60000).toISOString(),
  };
}

/**
 * The branch-sync card (L14 healthy, L15 update pending), from `sync` on
 * `GET /api/admin/licences/:uid` (#4686: `licence_sync_state` and
 * `licence_push_pending`). `state` is one of
 *   synced        the branch accepted HQ's revision, and the queue was read;
 *   pending       a copy is owed (`licence_push_pending` holds a row);
 *   out_of_sync   HQ numbered a revision the branch has not accepted, and nothing is queued;
 *   not_recorded  HQ has not numbered a revision yet;
 *   unconfirmed   the revisions read, but the queue could not be, so "synced" is not claimed;
 *   unreadable    the sync record could not be read.
 * Only `synced` is ever drawn as synced.
 */
export function syncBoard(sync, now = new Date().toISOString()) {
  if (!sync || sync.available === false) {
    return { state: 'unreadable', word: 'Sync unreadable', hq: null, branch: null, accepted: null, retryRead: true };
  }
  const hq = sync.hq_revision ?? null;
  const branch = sync.branch_revision ?? null;
  const accepted = sync.last_success_at ? whenText(sync.last_success_at, now) : null;
  const base = { hq, branch, accepted };
  const p = sync.pending;
  if (p) {
    const target = p.revision ?? hq;
    const attempt = attemptOf(p, now);
    const kept = branch != null ? `the copy it last accepted (revision ${branch})` : 'the copy it last accepted, if any';
    return {
      ...base,
      state: 'pending',
      word: 'Update pending',
      target,
      attempt,
      effect: `The branch keeps ${kept} until it accepts ${target != null ? `revision ${target}` : 'the new copy'}.`,
      nextTry: attempt
        ? `The next try is not before ${clockText(attempt.next)}.`
        : 'It is queued with the change and goes out on the next retry run.',
    };
  }
  if (hq != null && branch != null && branch < hq) {
    return {
      ...base,
      state: 'out_of_sync',
      word: 'Out of sync',
      queueUnread: sync.pending_available === false,
      effect: `The branch keeps revision ${branch} until HQ’s next push lands.`,
    };
  }
  if (sync.pending_available === false) {
    return { ...base, state: 'unconfirmed', word: 'Not confirmed', retryRead: true };
  }
  if (hq == null) return { ...base, state: 'not_recorded', word: NOT_RECORDED };
  if (branch != null) return { ...base, state: 'synced', word: 'Synced with HQ' };
  return { ...base, state: 'out_of_sync', word: 'Out of sync', effect: 'The branch has not accepted any copy HQ sent.' };
}

/**
 * The two Sources (L14, L15): what HQ holds and what the branch last
 * accepted, apart. The branch line keeps D4819 part 3's wording.
 */
export function syncSources(sync, host = null) {
  const label = host ? `Branch at ${host}` : 'Branch';
  if (!sync || sync.available === false) {
    return [
      { key: 'hq', label: 'HQ ledger', text: 'Unreadable', state: 'unreadable' },
      { key: 'branch', label, text: 'Unreadable', state: 'unreadable' },
    ];
  }
  const hq = sync.hq_revision ?? null;
  const branch = sync.branch_revision ?? null;
  return [
    hq != null
      ? { key: 'hq', label: 'HQ ledger', text: `Current · revision ${hq}`, state: 'value' }
      : { key: 'hq', label: 'HQ ledger', text: 'No revision numbered yet', state: 'not_recorded' },
    sync.last_success_at
      ? { key: 'branch', label, text: `Last accepted a copy ${clockText(sync.last_success_at)}${branch != null ? ` · revision ${branch}` : ''}`, state: 'value' }
      : { key: 'branch', label, text: `Last accepted copy ${NOT_RECORDED.toLowerCase()}`, state: 'not_recorded' },
  ];
}

const PHASE_WORD = Object.freeze({
  committed: 'Linked', partial: 'Partly provisioned', unknown: 'Outcome unknown', pending: 'Provisioning',
});

/**
 * The provisioning record (L15's Provisioning row), from
 * `GET /api/admin/licences/:uid/deployment`. A failed one carries the failed
 * attempt's time and code.
 */
export function provisioningLine(view) {
  if (!view) return null;
  if (view.status === 'failed') {
    const f = view.last_failure;
    return {
      state: 'failed', word: 'Failed',
      at: f?.settled_at || null, code: f?.failure_code || null, note: f?.failure_note || view.status_note || null,
    };
  }
  return { state: view.phase || 'pending', word: PHASE_WORD[view.phase] || PHASE_WORD.pending, at: null, code: null, note: null };
}

/**
 * Reconcile: `POST /deploy/reconcile` reads what GitHub did, and on a settled
 * failure answers `checked: 'settled'` with the record, dispatching nothing.
 * Offered while an attempt is open (as Check status) and on every failed
 * deployment, so a failure is never a dead-end record.
 */
export function canReconcile(view) {
  return Boolean(view) && (view.reconcilable === true || view.status === 'failed');
}

/** The notice for Reconcile's answer on a settled deployment. */
export function noticeForSettled(view) {
  const line = provisioningLine(view);
  if (line?.state === 'failed') {
    const code = line.code ? ` (${line.code})` : '';
    return describeOutcome('committed', {
      message: `Reconciled. Attempt ${view.current_attempt} is recorded as failed${code}, and nothing was sent. Retry starts attempt ${view.current_attempt + 1}.`,
    });
  }
  return describeOutcome('committed', { message: 'Reconciled. The deployment is as recorded below, and nothing was sent.' });
}
