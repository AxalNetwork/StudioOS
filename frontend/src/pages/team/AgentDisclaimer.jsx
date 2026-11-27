import React from 'react';
import { agentDisclaimerText } from '../../../../cloudflare-worker/src/services/agents/disclaimers.ts';
import { PendingOwner } from './teamUi.jsx';

/** D4421: the same exact copy on rule books, queue entries and Ask proposals. */
export default function AgentDisclaimer({ disclaimerKey, wordingPending = false, testId = 'agent-disclaimer' }) {
  const text = agentDisclaimerText(disclaimerKey);
  if (!text) return null;
  return (
    <p role="note" className="m-0 flex flex-wrap items-center gap-2 rounded-axal-md bg-axal-lavender px-3 py-2.5 text-[13px] text-axal-ink dark:bg-violet-900/20 dark:text-gray-100" data-testid={testId}>
      <b>{text}</b>{wordingPending ? <PendingOwner label="counsel wording pending" /> : null}
    </p>
  );
}
