/**
 * D5044 (#5044) — the one state model every destructive HQ Team action shares.
 *
 *   idle        nothing open; the action's button is drawn
 *   open        the review: what the act reaches, the reason, the acknowledgement
 *   submitting  the request is in flight; the form is locked, nothing can be sent twice
 *   confirmed   the server answered success; only then is the result drawn as done
 *   refused     the server answered and refused: nothing was done, the reason is its sentence
 *   unknown     no answer (a dropped connection, a server error, or no reply within the
 *               timeout): the act may or may not have happened, so it is never drawn as done
 *               or as refused, and the operator is told to check before trying again
 *
 * How a thrown request becomes refused or unknown is Security v2's rule (`resultOfError` in
 * `../security/accessModel.js`, D4801), reused rather than restated: no HTTP status, or a 5xx,
 * does not prove nothing happened.
 */
import { useCallback, useRef, useState } from 'react';
import { resultOfError } from '../security/accessModel.js';
import { reportError } from '../../../lib/log';

export const ACTION_STATES = Object.freeze(['idle', 'open', 'submitting', 'confirmed', 'refused', 'unknown']);

/**
 * Long enough for the step-up prompt `request()` raises mid-call (a person typing a code), short
 * enough that a hung request is not drawn as "submitting" for ever.
 */
export const ACTION_TIMEOUT_MS = 120000;

export const UNKNOWN_TEXT = 'No answer arrived, so whether this happened is not known. '
  + 'Check the account before trying again.';

/** A refusal in words: the route's sentence first, the request's message after, then the fallback. */
export function actionRefusal(ex, fallback) {
  const d = ex?.data;
  if (d && typeof d.message === 'string' && d.message) return d.message;
  return ex?.message || fallback;
}

/** Refused or unknown, from a thrown request (Security v2's classification). */
export function failureState(ex) {
  const r = resultOfError(ex);
  return r.result === 'unknown' || r.result === 'failed' ? 'unknown' : 'refused';
}

/** Rejects with a `timeout` code when `promise` has not settled in `ms`. */
export function withTimeout(promise, ms = ACTION_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(UNKNOWN_TEXT);
      e.code = 'timeout';
      reject(e);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The hook. `perform(...args)` makes the request; `submit` runs it once at a time and lands in
 * confirmed, refused or unknown. `translate(ex)` may reword a refusal (the TOTP sentence); `tag`
 * names the failure for `reportError`; `initial: 'open'` mounts an action already in review.
 */
export function useGovernedAction(perform, {
  fallback = 'The action was refused.', translate, tag = 'hq-team-action', initial = 'idle', timeoutMs = ACTION_TIMEOUT_MS,
} = {}) {
  const [state, setState] = useState(initial);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  const open = useCallback(() => { setError(''); setState('open'); }, []);
  const cancel = useCallback(() => { if (!inFlight.current) { setError(''); setState('idle'); } }, []);

  const submit = useCallback(async (...args) => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setError('');
    setState('submitting');
    try {
      const res = await withTimeout(Promise.resolve().then(() => perform(...args)), timeoutMs);
      setResult(res ?? null);
      setState('confirmed');
      return { ok: true, res };
    } catch (ex) {
      reportError(`${tag}`, ex);
      const kind = failureState(ex);
      setState(kind);
      // An unknown outcome still carries what the server said, when it said anything (a 502's
      // sentence), after the rule: the sentence alone cannot prove nothing happened.
      const said = ex?.status ? actionRefusal(ex, '') : '';
      setError(kind === 'unknown'
        ? `${UNKNOWN_TEXT}${said ? ` The server said: ${said}` : ''}`
        : ((translate && translate(ex)) || actionRefusal(ex, fallback)));
      return { ok: false, kind, ex };
    } finally {
      inFlight.current = false;
    }
  }, [perform, fallback, translate, tag, timeoutMs]);

  return {
    state,
    result,
    error,
    open,
    cancel,
    submit,
    busy: state === 'submitting',
    /** The form stays open while it is being reviewed, sent, or answered with a refusal or no answer. */
    isOpen: state === 'open' || state === 'submitting' || state === 'refused' || state === 'unknown',
  };
}
