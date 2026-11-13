// D290 / canvas H25 — the operator's view of a support session, as global chrome.
//
// WHY A BAR ABOVE `PortalSwitcher` AND NOT A STRIP INSIDE IT. Until D290 the
// impersonation strip was drawn by `PortalSwitcher`, so it existed only where
// that bar did, and it said who was being viewed and how long was left — never
// who was doing it or why. H25 draws the same five things S13 draws on the
// branch's side of the same session: Who · As · Why · Limit · what you can do.
// This mounts above `PortalSwitcher` for D142's reason: the ordinary admin
// chrome must never be the only thing framing a session the operator is not
// in by default. It draws nothing when nobody is being impersonated.
//
// THE REASON IS THE SERVER'S. `lib/impersonationBar.js` says how it is kept
// and what a null one reads as ("Not recorded"). This component never fills
// the gap.
//
// THE COUNTDOWN AND THE HAND-BACK ARE `App.jsx`'S. `leftMs` is the shell's
// clock (`impersonationLeftMs`), which hands the session back at zero so the
// token's death is never met as a 401 that ends the admin's own session. This
// draws the clock in the same `mm:ss left` the branch's bar uses.
//
// NOT SHARED WITH `HqSupportSessionBar`, by decision (D290): that bar is the
// TARGET side — a stored payload with its own expiry, no control the branch
// may use, and "Raise a concern" as its one action. This is the OPERATOR side:
// live shell state, Extend and End. Same fields, same clock format, different
// facts and different powers, so one component would have to draw both from
// two sources it cannot reconcile.
import React from 'react';
import { Eye } from 'lucide-react';
import { timeLeftLabel } from '../lib/supportSession';
import { impersonationFields, EXTEND_LABEL, END_LABEL } from '../lib/impersonationBar';

export default function ImpersonationBar({ operator, target, reason, holder = false, leftMs = null, onExtend, onExit }) {
  if (!operator || !target) return null;
  const fields = impersonationFields({ operator, target, reason, holder });
  const left = timeLeftLabel(leftMs);

  return (
    <div
      data-testid="impersonation-bar"
      role="status"
      className="z-50 shrink-0 border-b border-amber-300 bg-amber-50 px-4 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        <Eye size={15} className="shrink-0" aria-hidden="true" />
        {fields.map((f) => (
          <span key={f.k} data-field={f.k} className="whitespace-nowrap">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-800/80 dark:text-amber-300/80">
              {f.k}
            </span>
            {' '}
            <strong className="font-semibold">{f.v}</strong>
          </span>
        ))}
        {leftMs !== null && (
          <span
            data-testid="impersonation-left"
            className="tabular-nums font-semibold"
            title="A support session is thirty minutes. It hands itself back when the timer runs out."
          >
            {left || '00:00 left'}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {onExtend && (
            <button
              type="button"
              onClick={onExtend}
              className="rounded border border-amber-400 px-2 py-0.5 text-[12px] font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900"
            >
              {EXTEND_LABEL}
            </button>
          )}
          <button
            type="button"
            onClick={onExit}
            className="rounded border border-amber-400 px-2 py-0.5 text-[12px] font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900"
          >
            {END_LABEL}
          </button>
        </span>
      </div>
    </div>
  );
}
