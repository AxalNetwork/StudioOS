// D136 — what a frozen admin account meets on the OTHER pages.
//
// The compliance ladder's freeze lives in `requireAdmin` (D135), so it refuses
// every non-GET from every admin surface — 271 call sites across 51 route
// files. `/admin/my-licence` carries the banner that explains the state and the
// form that lifts it, but an administrator who is frozen is not standing there
// when they find out: they are approving an LP application, or saving a seat
// count, and the click simply fails.
//
// Before this, it failed with whatever generic error that page happened to
// print. `423` appeared nowhere in `frontend/src` — measured, not assumed — and
// `routes/branch_escalations.ts` had been citing "the frozen banner (D107)" for
// weeks as though one shipped. This is it, for the HQ half.
//
// WHAT IT IS AND IS NOT. It announces a refusal that just happened; it is not
// the state. The state is on `/admin/my-licence`, which is where the notice,
// its deadline and the response form live, and which is the destination
// `services/complianceLadder.ts` already names in the freeze notification's
// `link` — so the two agree by construction rather than by a comment.
//
// CLOSING IT IS NOT DISMISSING THE FREEZE, and it deliberately persists
// nothing. Every subsequent refusal raises it again, because the refusal is
// real again; a bar remembered in `localStorage` would let one click silence a
// compliance freeze for good, which is the trap the two existing `*Banner*`
// components fall into for content that can afford it and this cannot.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, X } from 'lucide-react';

export default function AdminFrozenBar() {
  const [state, setState] = useState(null);

  useEffect(() => {
    // Dispatched by `lib/api.js` on any 423 carrying `code: 'admin_frozen'`.
    // The notice rides in the refusal body, so there is nothing to fetch — and
    // fetching would mean a frozen account making another request to find out
    // why its last one was refused.
    const onFrozen = (e) => setState({
      subject: e?.detail?.notice?.subject || '',
      respondBy: e?.detail?.notice?.respond_by || '',
      message: e?.detail?.message || '',
    });
    window.addEventListener('studioos:admin_frozen', onFrozen);
    return () => window.removeEventListener('studioos:admin_frozen', onFrozen);
  }, []);

  if (!state) return null;

  return (
    <div
      data-testid="admin-frozen-bar"
      role="alert"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-rose-300 bg-rose-50 px-4 py-3 shadow-lg dark:border-rose-800 dark:bg-rose-950"
    >
      <div className="mx-auto flex max-w-4xl items-start gap-3">
        <Lock size={16} className="mt-0.5 shrink-0 text-rose-700 dark:text-rose-300" />
        <div className="min-w-0 flex-1 text-sm text-rose-900 dark:text-rose-200">
          <p className="font-semibold">That did not go through — your account is frozen.</p>
          {/* The same sentence `complianceLadder.ts` sends and
              `/admin/my-licence` renders, rather than a third wording of one
              fact. It is also the only one that tells the reader what to do. */}
          <p className="mt-0.5">
            Writes are paused; reading is not. Answering the notice is what lifts it.
            {state.subject ? ` The notice is “${state.subject}”.` : ''}
          </p>
          <Link
            to="/admin/my-licence"
            className="mt-1 inline-block font-medium underline underline-offset-2"
          >
            Answer it on My licence
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
