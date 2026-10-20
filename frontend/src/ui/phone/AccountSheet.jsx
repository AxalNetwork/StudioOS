import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useActiveCompany } from '../../contexts/ActiveCompanyContext.js';
import { CheckInStatus } from '../../components/FounderWellbeingMenu.jsx';
import { PhoneSheet, SheetRow } from './PhoneSheet.jsx';

const ACCOUNT_ROWS = [
  ['Your profile', '/profile'], ['Account', '/account'], ['Usage', '/account/usage'],
  ['Connectors', '/account/connectors'], ['Trust Center', '/trust'], ['Perks', '/perks'],
  ['Calendar', '/calendar'], ['Events', '/my/events'], ['Learning', '/learning'],
  ['Help Center', '/help'], ['Pricing', '/plans-and-pricing'],
];

/** The first letters of the first two words of the name, or the email's first letter. */
export function initialsOf(user) {
  const words = (user?.name || '').trim().split(/\s+/).filter(Boolean);
  return (words.length ? words.slice(0, 2).map(word => word[0]).join('') : (user?.email || '?')[0]).toUpperCase();
}

export function AccountSheet({ user, branchFact, onLogout, onClose, opener }) {
  const { company } = useActiveCompany();
  const [check, setCheck] = useState({ status: 'loading', submittedToday: false });
  useEffect(() => {
    let alive = true;
    api.wellbeingDaily(1).then(data => { if (alive) setCheck({ status: 'ready', submittedToday: !!data?.submitted_today }); })
      .catch(() => { if (alive) setCheck({ status: 'unreadable', submittedToday: false }); });
    return () => { alive = false; };
  }, []);
  const initials = initialsOf(user);
  return <PhoneSheet label="Account" onClose={onClose} opener={opener}>
    <div className="flex min-h-[72px] items-center gap-3 border-b border-gray-200 dark:border-gray-800 pb-3">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40 font-bold text-violet-700 dark:text-violet-300">{initials}</span>
      <div><p className="font-bold text-gray-900 dark:text-gray-100">{user?.name || user?.email}</p>
        <p className="text-xs text-gray-600 dark:text-gray-400">Founder · {company?.company_name || 'No company'}</p>
        {branchFact && <p className="text-xs text-gray-600 dark:text-gray-400">{branchFact.name || branchFact.code}
          {(branchFact.territories || []).length > 0 && ` · ${branchFact.territories.join(' · ')}`} · BRANCH
          {branchFact.status && branchFact.status !== 'active' && ` · ${String(branchFact.status).toUpperCase()}`}</p>}
      </div>
    </div>
    {ACCOUNT_ROWS.map(([title, to]) => <SheetRow key={to} title={title} to={to} onClose={onClose} />)}
    <SheetRow title="Founder Wellbeing" to="/wellbeing" onClose={onClose}
      description={check.status === 'unreadable' ? 'Unreadable' : <CheckInStatus {...check} />} />
    <SheetRow title="Refer & Earn" to="/referrals" onClose={onClose} />
    <div className="mt-2 border-t border-gray-200 dark:border-gray-800">
      <SheetRow title="Log Out" danger onClick={() => { onClose(); onLogout?.(); }} />
    </div>
  </PhoneSheet>;
}
