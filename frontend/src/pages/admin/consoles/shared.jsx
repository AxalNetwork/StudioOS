import React from 'react';

/**
 * D648 (#1448) — the pieces more than one Admin Console tool draws.
 * Moved out of `pages/AdminPage.jsx` unchanged.
 */

export const ROLE_BADGES = {
  admin: 'bg-violet-100 text-violet-700',
  founder: 'bg-blue-100 text-blue-700',
  partner: 'bg-emerald-100 text-emerald-700',
  investor: 'bg-amber-100 text-amber-700',
  advisor: 'bg-sky-100 text-sky-700',
  // Task #9 follow-up — new signups hold here pending admin review.
  exploring: 'bg-sky-100 text-sky-700',
};

export function Field({ label, value, mono }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">{label}</div>
      <div className={`text-gray-900 ${mono ? 'font-mono text-xs' : ''} mt-0.5 break-all`}>{value || '—'}</div>
    </div>
  );
}

export function KV({ label, value }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-sm text-gray-900 break-words dark:text-gray-100">{value || '—'}</div>
    </div>
  );
}

export function fmtDate(iso) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

/**
 * D648 — a console whose read failed. It says the list could not be read and
 * offers Try again; it never draws the empty list a failed read used to look
 * like.
 */
export function ConsoleUnreadable({ what, onRetry }) {
  return (
    <div className="p-8 text-center text-sm text-red-700 dark:text-red-300" role="alert" data-testid="admin-console-unreadable">
      {what} could not be read. This is not a sign that there are none.
      {onRetry && (
        <>
          {' '}
          <button type="button" onClick={onRetry} className="font-semibold underline" data-testid="admin-console-retry">
            Try again
          </button>
        </>
      )}
    </div>
  );
}

/** What every console draws while its own first read is in flight. */
export const CONSOLE_LOADING = 'Loading admin console...';
