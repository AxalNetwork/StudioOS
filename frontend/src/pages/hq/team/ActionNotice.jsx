/**
 * D5044 (#5044) — what an HQ Team action's form says after Send: refused, in the server's words, or
 * unknown, which is never drawn as done or as refused (`governedAction.js`).
 */
import React from 'react';

export default function ActionNotice({ action, prefix }) {
  if (action.state === 'refused') {
    return (
      <p className="text-[11.5px] text-rose-700 dark:text-rose-300" role="alert" data-testid={`${prefix}-refused`} data-state="refused">
        {action.error}
      </p>
    );
  }
  if (action.state === 'unknown') {
    return (
      <p className="text-[11.5px] text-amber-800 dark:text-amber-300" role="status" data-testid={`${prefix}-unknown`} data-state="unknown">
        Outcome unknown. {action.error}
      </p>
    );
  }
  return null;
}
