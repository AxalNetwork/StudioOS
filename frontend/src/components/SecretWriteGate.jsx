/**
 * D223 — a control that writes a Worker secret, drawn only for the one person
 * the server will let use it.
 *
 * Integration keys, GitHub Sync and the Stripe webhook registration each write
 * a secret onto production's own Worker, and the Worker takes those writes only
 * from the Super Admin with a fresh TOTP step-up (`requireSuperAdminWriteBar`).
 * Drawing the button for anyone else would draw a control that can only
 * refuse — the `still_an_admin` mistake D134 named. So a non-holder sees who
 * CAN make the change instead, in the place the control would have been.
 *
 * The holder still meets the step-up when their session is stale; `api.js`
 * turns that 403 into the StepUp modal, so nothing here has to.
 *
 * Pure over its props, so a test renders both halves.
 */
import React from 'react';

export default function SecretWriteGate({ holds, what, testid, children }) {
  if (holds) return <>{children}</>;
  return (
    <p
      data-testid={testid}
      className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2"
    >
      {what} writes a secret onto the production Worker, so only the Super Admin can do it,
      after a fresh TOTP step-up. Ask them to make this change.
    </p>
  );
}
