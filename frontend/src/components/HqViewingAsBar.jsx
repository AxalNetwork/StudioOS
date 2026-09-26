// D153 / canvas H12 — what HQ sees while it is reading one branch.
//
// WHY A BAR AND NOT A CHIP. The overlay changes what every figure on the page
// MEANS: under it, "Accounts" is one territory's headcount rather than the
// platform's, and the two are drawn the same way. A chip inside the page could
// scroll away from the figures it qualifies; chrome above every other bar
// cannot. It mounts above `PortalSwitcher` for the reason D142's support bar
// does: the ordinary admin chrome must never be the only thing framing a view
// the operator is not in by default.
//
// IT IS READ-ONLY AND SAYS SO, because the read behind it is. HQ reaches a
// branch over a private service binding whose HQ-side methods are reads
// (`overview`, `searchAccounts`); every write HQ can perform on a branch —
// applying a licence, answering an escalation, moving an account out — is its
// own audited route on its own screen, not something this view can reach. So
// the pages under it draw their actions ABSENT rather than disabled, in the
// canvas's own words: "'Move…' is gone rather than greyed: an action that
// cannot run from this view is not drawn in it." A greyed control would claim
// the action exists here and is merely unavailable; it does not exist here.
//
// D289 — THE SENTENCE IS THE ROUTE'S, NOT THE BAR'S. "Every figure below was
// read from this branch alone" was drawn on every HQ page and true on two.
// `lib/viewAsScope.js` says which routes narrow, which decline in their own
// words, and — for everything else — that the page does not read the scope
// and its figures are HQ's own. The scope itself is untouched by navigation
// (D153); only the claim follows the page.
//
// IT PERSISTS NOTHING (`ViewAsBranchContext`), on `AdminFrozenBar`'s rule.
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Eye } from 'lucide-react';
import { useViewAsBranch } from '../contexts/ViewAsBranchContext';
import { viewAsScopeFor, viewAsSentence } from '../lib/viewAsScope';

export default function HqViewingAsBar() {
  const { branch, setBranch } = useViewAsBranch();
  const { pathname } = useLocation();
  if (!branch) return null;
  const scope = viewAsScopeFor(pathname);

  return (
    <div
      data-testid="hq-viewing-as-bar"
      data-scope={scope}
      role="status"
      className="z-50 shrink-0 border-b border-rose-300 bg-rose-50 px-4 py-2 dark:border-rose-800 dark:bg-rose-950"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-rose-900 dark:text-rose-200">
        <Eye size={15} className="shrink-0" aria-hidden="true" />
        <span className="font-semibold">
          Viewing as
          {' '}
          {branch}
        </span>
        <span
          data-testid="hq-viewing-as-readonly"
          className="rounded border border-rose-400 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide dark:border-rose-700"
        >
          Read-only
        </span>
        {/* The one thing a reader has to be able to take from this bar without
            reading the rest of it: whether the figures below are this branch's
            (H12's claim, on the routes that narrow), HQ's own by the page's own
            account, or HQ's own because the page never reads the scope. */}
        <span
          data-testid="hq-viewing-as-sentence"
          className="text-[13px] text-rose-800 dark:text-rose-300"
        >
          {viewAsSentence(pathname, branch)}
        </span>
        <button
          type="button"
          onClick={() => setBranch(null)}
          className="ml-auto rounded border border-rose-400 px-2 py-0.5 text-[13px] font-medium hover:bg-rose-100 dark:border-rose-700 dark:hover:bg-rose-900"
        >
          Return to HQ view
        </button>
      </div>
    </div>
  );
}
