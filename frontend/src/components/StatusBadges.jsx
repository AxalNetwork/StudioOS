/**
 * The project status and Spin-Out Lab week badges used by the startup list
 * and a project's page. They lived in pages/Dashboard.jsx beside the old
 * "Welcome back" page, and moved here when that page retired (D323).
 */
import React from 'react';

export function StatusBadge({ status }) {
  const styles = {
    intake: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
    scoring: 'bg-amber-100 text-amber-700',
    tier_1: 'bg-emerald-100 text-emerald-700',
    tier_2: 'bg-blue-100 text-blue-700',
    rejected: 'bg-red-100 text-red-700',
    spinout: 'bg-violet-100 text-violet-700',
    active: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase font-medium ${styles[status] || styles.intake}`}>
      {status?.replace('_', ' ')}
    </span>
  );
}

export function WeekBadge({ week }) {
  if (!week || week === 'complete') return week === 'complete' ? <span className="text-[10px] text-emerald-400">Complete</span> : null;
  const num = week.replace('week_', 'W');
  return <span className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{num}</span>;
}
