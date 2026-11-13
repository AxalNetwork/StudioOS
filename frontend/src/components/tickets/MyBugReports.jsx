import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import BountyBadge from './BountyBadge';

/**
 * D542 (#1105, the owner's C) — the member's own bug reports and where each
 * bounty stands, under the chat's ticket form. It reads the same list as
 * Help → Tickets (`GET /api/tickets`) and shows the reports that have a
 * bounty state, newest first; the full list, and each ticket's comments, are
 * one link away. A failed read is said as one, never as "no reports".
 */
export function MyBugReportsList({ status, rows = [] }) {
  const reports = rows.filter((t) => t && t.bounty).slice(0, 5);
  return (
    <div className="mt-3 border-t border-violet-100 pt-2 dark:border-violet-900/40" data-testid="advisor-bug-reports">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-violet-800 dark:text-violet-200">My bug reports</span>
        <Link to="/help/tickets" className="text-[11px] text-violet-700 hover:underline dark:text-violet-300">All tickets</Link>
      </div>
      {status === 'loading' ? (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">Reading your tickets…</p>
      ) : status === 'unreadable' ? (
        <p className="text-[11px] text-red-700 dark:text-red-300" role="alert">Your tickets could not be read. This is not a sign that you have none.</p>
      ) : !reports.length ? (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">No bug reports yet. A bug you report here is graded, and a fixed one earns credits.</p>
      ) : (
        <ul className="space-y-1">
          {reports.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <Link to={`/help/tickets/${t.id}`} className="min-w-0 truncate text-gray-800 hover:text-violet-700 dark:text-gray-200">{t.title}</Link>
              <BountyBadge bounty={t.bounty} withHint />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MyBugReports() {
  const [list, setList] = useState({ status: 'loading', rows: [] });
  useEffect(() => {
    let alive = true;
    api.listTickets()
      .then((rows) => { if (alive) setList({ status: 'ready', rows: Array.isArray(rows) ? rows : [] }); })
      .catch(() => { if (alive) setList({ status: 'unreadable', rows: [] }); });
    return () => { alive = false; };
  }, []);
  return <MyBugReportsList status={list.status} rows={list.rows} />;
}
