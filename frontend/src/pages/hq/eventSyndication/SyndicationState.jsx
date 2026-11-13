/** D1491 (#3725) — shared loading, unreadable and refusal lines for syndication boards. */
import React from 'react';

export const INPUT = 'rounded-lg border border-axal-hairline bg-white px-3 py-2 text-sm text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const BUTTON = 'min-h-11 rounded-lg border border-axal-hairline px-3 py-2 text-sm font-semibold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:text-gray-100';
export const refusalText = (e) => e?.message || 'The request was refused. Try again.';
export function Refusal({ text }) { return text ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{text}</p> : null; }
export default function SyndicationState({ read, children }) {
  if (read.status === 'loading') return <p role="status" className="text-sm text-axal-muted dark:text-gray-400">Reading channels…</p>;
  if (read.status === 'error') return <div role="alert" className="space-y-2 text-sm text-axal-ink dark:text-gray-100">Unreadable — event syndication could not be read. <button type="button" className={BUTTON} onClick={read.reload} data-testid="syndication-read-retry">Retry</button></div>;
  return children;
}
