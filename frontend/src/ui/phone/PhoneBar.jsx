import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuthSync.jsx';
import { useViewMode } from '../../contexts/ViewModeContext.js';
import { useActiveCompany } from '../../contexts/ActiveCompanyContext.js';
import { EadwynButton } from '../EadwynPanel.jsx';

export function backFallback({ shellRole, role, labActive, pathname = '', lastCycle }) {
  if (shellRole === 'founder') {
    const pathCycle = pathname.split('/')[1];
    return ['validate', 'build', 'raise', 'grow'].includes(pathCycle) ? `/${pathCycle}`
      : `/${['validate', 'build', 'raise', 'grow'].includes(lastCycle) ? lastCycle : 'validate'}`;
  }
  if (role === 'exploring' && pathname === '/account' && !labActive) return '/exploring';
  if (['admin', 'founder', 'partner', 'investor', 'advisor'].includes(role) || labActive) return '/studio';
  return '/account';
}

/**
 * The pushed page's bar (CO:24): "‹ Back", the title and an optional sub.
 *
 * With `eadwynLabel`, the right side is D698's `EadwynButton` with that label:
 * the 40px "Open Eadwyn for this page" button, which registers its trigger so
 * the rail hides its floating button. It draws nothing while the panel serves
 * no one (any viewer but a founder on a page with a founder rail), so the bar
 * then has no button and no stand-in. `action` replaces it (#1664's menu).
 *
 * `back.onClick` (D703, #1665) makes Back a button that calls it, for a page
 * whose Back closes something (an Add form, a cycle action) rather than
 * pushing an address; it never reaches the no-history fallback.
 */
export function PhoneBar({ back = { label: 'Studio' }, title, sub, eadwynLabel, action }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth() || {};
  const view = useViewMode();
  const { company } = useActiveCompany();
  const fallback = backFallback({ shellRole: view?.shellRole, role: user?.role,
    labActive: user?.spinout_lab_active, pathname: location.pathname, lastCycle: company?.last_opened?.cycle });
  const target = back.to || fallback;
  const backClass = 'flex min-h-11 items-center text-[13px] font-bold text-violet-700 dark:text-violet-300';
  return <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-[22px] pb-3 pt-1">
    {back.onClick
      ? <button type="button" className={backClass} onClick={back.onClick}>‹ {back.label}</button>
      : back.to || location.key === 'default'
      ? <Link to={target} className={backClass}>‹ {back.label}</Link>
      : <button type="button" className={backClass} onClick={() => navigate(-1)}>‹ {back.label}</button>}
    <div className="flex items-center justify-between gap-2">
      <div><h1 className="text-[19px] font-extrabold text-gray-900 dark:text-gray-100">{title}</h1>
        {sub && <p className="text-[11.5px] text-gray-600 dark:text-gray-400">{sub}</p>}</div>
      {action ?? (eadwynLabel ? <EadwynButton label={eadwynLabel} /> : null)}
    </div>
  </div>;
}
