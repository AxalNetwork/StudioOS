import React from 'react';
import { Link } from 'react-router-dom';
import { dealMoney } from './dealMoney';

/** D1149: approved DL22b, header/key strip only; no nested data reads. */
export default function DealFreePlan({ deal, onRetry = () => window.location.reload() }) {
  const money = (n) => dealMoney(n, deal.currency) ?? 'Not recorded';
  const keys = [
    ['Round', money(deal.target_raise), deal.instrument || 'Not recorded'],
    ['Committed', money(deal.capital_committed), deal.progress_pct == null ? 'Not recorded' : `${deal.progress_pct}% of the round`],
    ['Your commitment', deal.my_commitment_unreadable ? 'Unreadable' : deal.my_commitment ? money(deal.my_commitment.amount) : 'Not committed yet', deal.my_commitment_unreadable ? <button type="button" className="underline" onClick={onRetry}>Try again</button> : deal.my_commitment?.status || ''],
    ['Closes', deal.closing_deadline || 'Not recorded', ''],
  ];
  return <div data-testid="deal-free-plan" className="mx-auto max-w-6xl space-y-6">
    <Link to="/deals" className="text-sm text-violet-700 dark:text-violet-300">Back to Deal Flow</Link>
    <header><h1 className="text-2xl font-extrabold text-gray-900 dark:text-gray-100">{deal.project_name || 'Not recorded'}</h1>
      <p className="text-sm text-gray-600 dark:text-gray-400">{deal.project_sector || 'Not recorded'} · {deal.status || 'Not recorded'}</p></header>
    <dl className="grid grid-cols-2 gap-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900 md:grid-cols-4" data-testid="deal-key-strip">
      {keys.map(([label, value, sub]) => <div key={label}><dt className="text-xs uppercase text-gray-500 dark:text-gray-400">{label}</dt>
        <dd className="mt-1 font-mono font-semibold text-gray-900 dark:text-gray-100">{value}</dd>
        {sub && <dd className="mt-1 text-xs text-gray-500 dark:text-gray-400">{sub}</dd>}</div>)}
    </dl>
    <section className="mx-auto max-w-xl rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Deal pages are on the Professional plan.</h2>
      <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">The header and key figures show on every plan. Evidence, diligence, terms and commitments are on Professional.</p>
      <Link to="/pricing?for=investor" className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white dark:bg-violet-500">See plans</Link>
    </section>
  </div>;
}
