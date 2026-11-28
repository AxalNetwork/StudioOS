/**
 * D9288 (#9288) — the transcript's honest pieces, in a file a Node test can
 * import (it reaches neither `PersonalAdvisor.jsx` nor `router.js`).
 *
 * `UnreadableNotice` is what a failed read draws in place of the thing it
 * failed to read: the history in the chat, the queue in the question widget.
 * It says it could not load, and offers Retry; it never draws an empty state.
 *
 * `ToolPreview` draws a tool turn's result from `toolPreviewModel`, the same
 * for a live turn and a reloaded one (`../../lib/advisor/transcript.js`).
 */
import React from 'react';
import { RefreshCw } from 'lucide-react';
import { RETRY_LABEL, TOOL_REFUSED, TOOL_UNREADABLE, toolPreviewModel } from '../../lib/advisor/transcript.js';

export function UnreadableNotice({ message, onRetry, testId = 'advisor-unreadable' }) {
  return (
    <div role="alert" data-testid={testId} className="text-xs text-red-700 bg-red-50 dark:bg-red-950/30 dark:text-red-300 border border-red-200 dark:border-red-900 rounded p-2 flex items-center gap-2">
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold text-violet-700 dark:text-violet-300 underline">
          <RefreshCw size={11} aria-hidden="true" /> {RETRY_LABEL}
        </button>
      )}
    </div>
  );
}

export function ToolPreview({ view }) {
  const p = toolPreviewModel(view);
  if (!p) return null;
  if (p.kind === 'unreadable') {
    return <div className="text-xs text-gray-500 dark:text-gray-400 italic">{TOOL_UNREADABLE}</div>;
  }
  if (p.kind === 'refused') {
    return <div className="text-xs text-gray-700 dark:text-gray-300">{TOOL_REFUSED}</div>;
  }
  if (p.kind === 'list') {
    if (p.total === 0) {
      return <div className="text-xs text-gray-500 dark:text-gray-400 italic">No matches yet.</div>;
    }
    return (
      <ul className="text-xs space-y-1">
        {p.rows.map((row) => (
          <li key={row.id} className="leading-snug">
            <span className="font-medium">{row.title}</span>
            {row.snippet && <span className="text-gray-600 dark:text-gray-400"> — {row.snippet}</span>}
          </li>
        ))}
      </ul>
    );
  }
  if (p.kind === 'page') {
    return <div className="text-xs text-gray-700 dark:text-gray-300">Opening {p.page}.</div>;
  }
  return <div className="text-xs text-gray-700 dark:text-gray-300">{p.feature} requires the {p.tier} tier.</div>;
}
