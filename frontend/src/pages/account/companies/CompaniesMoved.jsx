/**
 * D1140 (#3020, CMP19) — one place for companies.
 *
 *   CompanySettingsRedirect  `/company-settings` forwards to the company page of
 *                            the company active on this device (owner question
 *                            2, A), or to the Companies tab when there is none,
 *                            with the query and hash kept and the moved notice.
 *                            The router's beacon counts it (#2319): it is a
 *                            path-only entry of `redirectRoutes.ts`.
 *   (`CompanySettingsAt.jsx`, lazily loaded, holds the full settings at their
 *   new address, so the Account pane never carries that page.)
 *   CompaniesMovedNotice     Companies and projects' line after the forward.
 *   ProfileMovedNotice       Profile and identity's line where "Your
 *                            companies" was, until dismissed on this device.
 */
import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Info } from 'lucide-react';
import { api, initActiveCompanyId } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { useMovedNotice } from '../../../ui';
import { MOVED_NOTICES, PROFILE_MOVED_STORE, PROFILE_MOVED_TEXT, TAB_PATHS, activeUidFrom, forwardTarget } from './companiesModel';

const NOTE = 'flex items-center gap-2.5 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3 py-1.5 text-[13px] text-axal-ink dark:border-[#4c3a8a] dark:bg-[#211f3d] dark:text-gray-200';
const DISMISS = 'inline-flex min-h-[44px] shrink-0 items-center rounded-[9px] px-2.5 text-[13px] font-bold text-axal-violet-deep sm:min-h-[40px] dark:text-violet-400';

/**
 * `/company-settings`. It reads the caller's memberships itself, because the
 * switcher may not have restored the active company yet; a failed read still
 * forwards, to the Companies tab, so an old link never strands anyone.
 */
export function CompanySettingsRedirect({ list = () => api.listMyCompanies(), savedId = () => initActiveCompanyId() }) {
  const { search, hash } = useLocation();
  const [to, setTo] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(list)
      .then((rows) => { if (live) setTo(forwardTarget(activeUidFrom(rows, savedId()), search, hash)); })
      .catch((e) => {
        reportError('CompanySettingsRedirect', e);
        if (live) setTo(forwardTarget(null, search, hash));
      });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return to ? <Navigate replace to={to} /> : null;
}

/** Companies and projects' notice after `/company-settings` forwarded here. */
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
