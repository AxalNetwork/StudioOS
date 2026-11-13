import React, { useState } from 'react';
import { api } from '../../../lib/api.js';
import { newOpKey } from '../../../lib/opKey.js';
import { DeploymentOutcomes } from './deploymentScope.jsx';
import { BTN_DANGER, BTN_PLAIN } from './ActionDialog.jsx';

/**
 * D4669 part 2 (#4669) — HQ signs accounts out ON BRANCH DEPLOYMENTS, on
 * request: the owner's option B (2026-11-10).
 *
 * A SEPARATE ACT, NOT A SWITCH ON THE OTHERS. Every other session act on this
 * page writes this deployment only, and still says so. Reaching branches is
 * something an operator asks for when an incident spans them.
 *
 * EACH BRANCH ANSWERS FOR ITSELF. The result lists one line per branch: done,
 * failed (nothing changed there) or unreachable (not known whether it acted).
 * The act reads as done only when every branch said done; partial is said as
 * partial. A branch that did not answer is never counted as done.
 *
 * ONE KEY PER ACT. It is made when the form opens and resent by Try again, so
 * a branch that timed out on the first attempt but had acted answers from its
 * record instead of signing anyone out twice. Editing the form makes a new act.
 */

export const BRANCH_REASON_MIN = 10;
export const BRANCH_ALL_PHRASE = 'SIGN OUT BRANCHES';

/** The result's headline. Pure, for the tests. */
export function branchResultTitle(res) {
  if (!res || !Array.isArray(res.outcomes)) return null;
  const done = res.outcomes.filter((o) => o.outcome === 'done').length;
  const asked = res.outcomes.length;
  if (res.outcome === 'done') return `Done on every branch asked (${done} of ${asked})`;
  if (res.outcome === 'partial') return `Partial — done on ${done} of ${asked} branches`;
  return `Not done — no branch answered that it acted (0 of ${asked})`;
}

/** Whether the form may be sent. Pure, for the tests. */
export function branchFormReady({ kind, email, reason, phrase }) {
  if (String(reason || '').trim().length < BRANCH_REASON_MIN) return false;
  if (kind === 'account') return /\S+@\S+/.test(String(email || '').trim());
  return kind === 'all' && String(phrase || '').trim() === BRANCH_ALL_PHRASE;
}

/** What the branches answered. Presentational, so the tests can draw every outcome. */
export function BranchResult({ res }) {
  const title = branchResultTitle(res);
  if (!title) return null;
  return (
    <div role="status" className="flex flex-col gap-1" data-testid="hq-branch-result">
      <p className={`text-[12.5px] font-bold ${res.outcome === 'done' ? 'text-emerald-800 dark:text-emerald-300' : 'text-amber-800 dark:text-amber-200'}`} data-testid="hq-branch-title">{title}</p>
      {res.message && <p className="text-[12px] text-axal-muted dark:text-gray-300">{res.message}</p>}
      <DeploymentOutcomes outcomes={res.outcomes} />
    </div>
  );
}

export default function BranchSignOut({ scope, readOnly, send = api.hqBranchSignOut }) {
  const bound = typeof scope?.branches_bound === 'number' ? scope.branches_bound : null;
  const [kind, setKind] = useState('account');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [phrase, setPhrase] = useState('');
  const [key, setKey] = useState(() => newOpKey());
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');

  // Changing what is asked makes it a different act, with its own key.
  const change = (fn) => (e) => { fn(e.target.value); setKey(newOpKey()); setRes(null); setErr(''); };

  const submit = async () => {
    if (busy || !branchFormReady({ kind, email, reason, phrase })) return;
    setBusy(true);
    setErr('');
    try {
      const target = kind === 'all' ? { kind: 'all' } : { kind: 'account', email: email.trim() };
      setRes(await send({ branches: 'all', target, reason: reason.trim(), op_key: key }));
    } catch (e) {
      // A refusal from HQ itself (the bar, the reason, no secret, no branch):
      // no branch was asked. Said as that, never as a branch outcome.
      setErr(`${e?.message || 'The request was refused.'} No branch was asked.`);
    } finally { setBusy(false); }
  };

  if (bound === 0) {
    return (
      <section className="rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="hq-branch-sign-out">
        <h2 className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-white">Sign out on branch deployments</h2>
        <p className="mt-1 text-[12.5px] text-axal-muted dark:text-gray-300" data-testid="hq-branch-none">No branch is bound to this deployment, so there is no branch to reach.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="hq-branch-h" className="flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="hq-branch-sign-out">
      <h2 id="hq-branch-h" className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-white">Sign out on branch deployments</h2>
      <p className="text-[12.5px] text-axal-ink dark:text-gray-100">
        Asks {bound === null ? 'every bound branch' : `each of the ${bound} bound branch${bound === 1 ? '' : 'es'}`} to sign accounts out on its own deployment. The acts above do not reach branches; this one does, and only when you send it.
      </p>
      <p className="text-[11.5px] text-axal-muted dark:text-gray-400">
        Each branch answers for itself: done, failed (nothing changed there), or unreachable (not known whether it acted). A branch that does not answer is never counted as done, and trying again is safe: each branch recognises the same request.
      </p>
      <fieldset className="flex flex-wrap gap-3 text-[12.5px]" disabled={readOnly || busy}>
        <legend className="sr-only">Who to sign out</legend>
        <label className="inline-flex items-center gap-1.5"><input type="radio" name="branch-kind" value="account" checked={kind === 'account'} onChange={change(setKind)} data-testid="hq-branch-kind-account" /> One person, by email</label>
        <label className="inline-flex items-center gap-1.5"><input type="radio" name="branch-kind" value="all" checked={kind === 'all'} onChange={change(setKind)} data-testid="hq-branch-kind-all" /> Every account on every branch</label>
      </fieldset>
      {kind === 'account' ? (
        <label className="text-[12px] font-bold text-axal-ink dark:text-white">Email
          <input type="email" value={email} onChange={change(setEmail)} disabled={readOnly || busy} className="mt-1 block w-full rounded-lg border border-axal-hairline px-2 py-1.5 text-[12.5px] font-normal dark:border-gray-700 dark:bg-gray-950" data-testid="hq-branch-email" />
          <span className="block text-[11px] font-normal text-axal-muted dark:text-gray-400">An account on a branch is a different record from one here, so the person is named by email. A branch where nobody holds it says so.</span>
        </label>
      ) : (
        <label className="text-[12px] font-bold text-axal-ink dark:text-white">Type {BRANCH_ALL_PHRASE} to confirm
          <input value={phrase} onChange={(e) => setPhrase(e.target.value)} disabled={readOnly || busy} className="mt-1 block w-full rounded-lg border border-axal-hairline px-2 py-1.5 font-mono text-[12.5px] font-normal dark:border-gray-700 dark:bg-gray-950" data-testid="hq-branch-phrase" />
        </label>
      )}
      <label className="text-[12px] font-bold text-axal-ink dark:text-white">Reason <span className="font-normal text-axal-muted">(at least {BRANCH_REASON_MIN} characters; recorded here and on every branch)</span>
        <textarea value={reason} onChange={change(setReason)} disabled={readOnly || busy} rows={2} className="mt-1 block w-full rounded-lg border border-axal-hairline px-2 py-1.5 text-[12.5px] font-normal dark:border-gray-700 dark:bg-gray-950" data-testid="hq-branch-reason" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${BTN_DANGER} self-stretch sm:self-start`} disabled={readOnly || busy || !branchFormReady({ kind, email, reason, phrase })} onClick={submit} data-testid="hq-branch-send">
          {busy ? 'Asking each branch…' : 'Sign out on branches'}
        </button>
        {res && res.outcome !== 'done' && (
          <button type="button" className={BTN_PLAIN} disabled={busy} onClick={submit} data-testid="hq-branch-retry">Try again</button>
        )}
      </div>
      {err && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid="hq-branch-error">{err}</p>}
      {res && <BranchResult res={res} />}
    </section>
  );
}
