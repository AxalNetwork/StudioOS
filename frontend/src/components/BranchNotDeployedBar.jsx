import React from 'react';
import { Link } from 'react-router-dom';
import { Globe } from 'lucide-react';
import {
  NOT_DEPLOYED_RULES, NOT_DEPLOYED_SUBLINE, NO_STEP_TIME_REASON, UNREADABLE,
} from '../lib/branchNotDeployed';

/**
 * S21 — a licence administrator whose branch is not deployed yet (D287).
 *
 * A STRIP THAT CANNOT BE DISMISSED. It is the fact of the account, not a
 * notice: no close button, no `setState(null)`, and — on `AdminFrozenBar`'s
 * stated rule — nothing in `localStorage`, `sessionStorage` or a cookie. It
 * reads the deployment record on the licence through `useBranchDeployment`
 * and draws what that read said; it disappears the moment the worker says
 * the branch is live (`deployment.live`), because the shell then reads the
 * branch database and this strip has nothing left to say.
 *
 * THE CAPTION CARRIES NO TIME. S21 draws "last step schema applied at
 * deployment.last_step_at"; nothing records a step time (see
 * `lib/branchNotDeployed.js`), so the caption says why instead of labelling
 * `requested_at` or `updated_at` as one.
 */
const CHIP = {
  ok: 'border-slate-700 bg-slate-700 text-white dark:border-slate-300 dark:bg-slate-300 dark:text-slate-900',
  wait: 'border-slate-300 bg-white text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400',
  unknown: 'border-dashed border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-300',
};

export default function BranchNotDeployedBar({ strip }) {
  if (!strip) return null;
  const brand = strip.brand || 'This licence';
  return (
    <div
      data-testid="branch-not-deployed-bar"
      role="status"
      className="border-b border-slate-300 bg-slate-100 px-4 py-2.5 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
          <Globe size={14} aria-hidden="true" className="shrink-0" />
          <p className="min-w-0">
            <span className="font-extrabold">{brand}</span>
            {' · its branch has not been deployed. You are working on axal.vc until it is.'}
          </p>
          <Link
            to="/admin/my-licence"
            data-testid="branch-not-deployed-licence-link"
            className="font-semibold underline underline-offset-2"
          >
            Licence summary in Settings →
          </Link>
        </div>
        <ol className="flex flex-wrap gap-1.5" aria-label="Provisioning steps" data-testid="branch-not-deployed-steps">
          {strip.chips.map((c) => (
            <li
              key={c.key}
              data-step={c.key}
              data-state={c.state}
              className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${CHIP[c.state]}`}
            >
              {c.label}
            </li>
          ))}
        </ol>
        <p className="text-[11px] text-slate-600 dark:text-slate-400" data-testid="branch-not-deployed-caption">
          {strip.unreadable
            ? `${UNREADABLE} — ${strip.note || 'the deployment record on this licence could not be read.'}`
            : strip.failed
              ? `Failed. Which step it failed at is not recorded${strip.note ? `; the record says: ${strip.note}` : '.'}`
              : NO_STEP_TIME_REASON}
        </p>
        <p className="text-[11px] text-slate-600 dark:text-slate-400">{NOT_DEPLOYED_SUBLINE}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10.5px] text-slate-500 dark:text-slate-500" data-testid="branch-not-deployed-rules">
          {NOT_DEPLOYED_RULES.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>
    </div>
  );
}
