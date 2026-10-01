// D142 / S7 — what a frozen branch meets at the moment of the refusal.
//
// The twin of `AdminFrozenBar`, one tier down, and it could not have existed
// before this change: the branch 423 carried no `code`, so `lib/api.js` — which
// keys strictly on one — had nothing to fan out. Three places in the repo cited
// "the frozen banner (D107)" as though one had shipped. This is it.
//
// WHAT IT IS AND IS NOT. It announces a write that was just refused. The STATE
// — which rows still read, which are locked, and how to appeal — is on
// `/admin/my-licence`, beside the licence that was suspended, which is also
// where the escalation is raised from. Two surfaces, one fact, and the bar
// links to the other rather than restating it.
//
// IT PERSISTS NOTHING, on the rule `AdminFrozenBar` states: every subsequent
// refusal raises it again because the refusal is real again, and a suspension
// one click could silence for good is not a suspension.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, X } from 'lucide-react';

export default function BranchSuspendedBar() {
  const [state, setState] = useState(null);

  useEffect(() => {
    // Dispatched by `lib/api.js` on any 423 carrying `code: 'branch_suspended'`.
    // `since` and `reason` ride in the refusal body — HQ's own words, pushed
    // with the licence — so there is nothing to fetch, and fetching would mean
    // a frozen branch making another request to learn why the last one failed.
    const onSuspended = (e) => setState({
      since: e?.detail?.since || '',
      reason: e?.detail?.reason || '',
    });
    window.addEventListener('studioos:branch_suspended', onSuspended);
    return () => window.removeEventListener('studioos:branch_suspended', onSuspended);
  }, []);

  if (!state) return null;

  return (
    <div
      data-testid="branch-suspended-bar"
      role="alert"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-rose-300 bg-rose-50 px-4 py-3 shadow-lg dark:border-rose-800 dark:bg-rose-950"
    >
      <div className="mx-auto flex max-w-4xl items-start gap-3">
        <Lock size={16} className="mt-0.5 shrink-0 text-rose-700 dark:text-rose-300" />
        <div className="min-w-0 flex-1 text-sm text-rose-900 dark:text-rose-200">
          <p className="font-semibold">That did not go through — this licence is suspended by HQ.</p>
          <p className="mt-0.5">
            Your database is intact and nothing here is deleted. Reading is not paused; publishing
            and queue decisions are.
            {/* HQ's reason, when HQ typed one. A copy pushed before they did
                carries none, and saying nothing is the honest version of that —
                inventing "for compliance reasons" would be this bar asserting
                something nobody wrote. */}
            {state.reason ? ` Reason as stated by HQ: ${state.reason}.` : ''}
            {state.since ? ` Since ${state.since}.` : ''}
          </p>
          <Link
            to="/admin/my-licence"
            className="mt-1 inline-block font-medium underline underline-offset-2"
          >
            See what is locked, and appeal
          </Link>
        </div>
        <button
          type="button"
          onClick={() => setState(null)}
          aria-label="Close"
          className="shrink-0 rounded p-1 text-rose-700 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-900"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
