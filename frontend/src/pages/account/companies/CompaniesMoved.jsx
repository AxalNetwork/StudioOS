/**
 * D1140 (#3020, CMP19) — the arrival notices of the move to Portfolio.
 *
 *   CompaniesMovedNotice     Companies and projects' line when it is opened with `?moved=`.
 *   ProfileMovedNotice       Profile and identity's line where "Your
 *                            companies" was, until dismissed on this device.
 *
 * The forwards that used to land here are gone: D2319 retired `/company-settings` and every
 * `/account/companies…` address, #4453 and #4462 removed their mounts, and #4736 removed
 * `CompanySettingsRedirect`, `CompaniesMovedRedirect` and their helpers. The full settings are at
 * `CompanySettingsAt.jsx` (`/account/portfolio/<uid>/settings`).
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { useMovedNotice } from '../../../ui';
import { MOVED_NOTICES, PROFILE_MOVED_STORE, PROFILE_MOVED_TEXT, TAB_PATHS } from './companiesModel';

const NOTE = 'flex items-center gap-2.5 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3 py-1.5 text-[13px] text-axal-ink dark:border-[#4c3a8a] dark:bg-[#211f3d] dark:text-gray-200';
const DISMISS = 'inline-flex min-h-[44px] shrink-0 items-center rounded-[9px] px-2.5 text-[13px] font-bold text-axal-violet-deep sm:min-h-[40px] dark:text-violet-400';

/** Companies and projects' notice after an old address forwarded here. */
export function CompaniesMovedNotice() {
  const notice = useMovedNotice(MOVED_NOTICES);
  if (!notice.text) return null;
  return (
    <div role="status" aria-live="polite" className={NOTE} data-testid="companies-moved">
      <Info size={15} aria-hidden="true" className="shrink-0 text-axal-violet-deep dark:text-violet-400" />
      <span className="min-w-0 flex-1 leading-[1.45]">{notice.text}</span>
      <button type="button" onClick={notice.dismiss} className={DISMISS} data-testid="companies-moved-dismiss">Dismiss</button>
    </div>
  );
}

const seen = () => { try { return localStorage.getItem(PROFILE_MOVED_STORE) === '1'; } catch { return false; } };
const remember = () => { try { localStorage.setItem(PROFILE_MOVED_STORE, '1'); } catch { /* the line returns next visit */ } };

/** Profile and identity's line where "Your companies" was. Dismissed once, it does not come back on this device. */
export function ProfileMovedNotice() {
  const [gone, setGone] = useState(seen);
  if (gone) return null;
  return (
    <div role="status" className={NOTE} data-testid="profile-companies-moved">
      <Info size={15} aria-hidden="true" className="shrink-0 text-axal-violet-deep dark:text-violet-400" />
      <span className="min-w-0 flex-1 leading-[1.45]">
        {PROFILE_MOVED_TEXT} <Link to={TAB_PATHS.companies} className="font-semibold underline">Open it</Link>
      </span>
      <button type="button" onClick={() => { remember(); setGone(true); }} className={DISMISS} data-testid="profile-companies-moved-dismiss">Dismiss</button>
    </div>
  );
}
