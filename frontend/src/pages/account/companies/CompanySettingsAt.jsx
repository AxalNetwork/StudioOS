/**
 * D1140 (#3020, CMP19) — the full company settings at their address under
 * Portfolio (the owner's choice, 2026-10-27):
 *
 *   /account/portfolio/<uid>/settings   the company active on this device;
 *                                       another company says so and links
 *                                       to its page, where it can be made active
 *   /account/portfolio/settings         whichever is active, or, with none, a
 *                                       partner's Firm Settings, an advisor's
 *                                       Practice Settings and the way to
 *                                       create or join a company
 *
 * The page itself is `CompanySettingsPage`, unchanged: it reads the active
 * company, so only that company's settings are drawn here.
 *
 * D1413 (#3696, PF6a): with a company in the address, the page opens on
 * Company settings › General: the head with the General and Legal tabs
 * (`CompanySettingsTabs.jsx`), the General card (display name, address,
 * website, logo, and "Default currency", which reads "Coming later" until
 * #3932), then the full editor for the active company.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { useActiveCompany } from '../../../contexts/ActiveCompanyContext';
import { useCompanyReadState } from '../../../ui/CompanySwitcher';
import { teamsApi } from '../../../lib/api/teams';
import { scopeFor, usePublishScope } from '../../../lib/settingsScope.js';
import CompanySettingsPage from '../../CompanySettingsPage';
import { companyPathFor, companySettingsPathFor } from './companiesModel';
import * as portfolio from './portfolioAdapter.js';
import { GeneralCard, SettingsHead } from './CompanySettingsTabs.jsx';

// Each read keeps its own outcome: a failed one is said with Try again, never
// left on "Reading…" and never drawn as "Not recorded".
function useCompanyHead(uid) {
  const [state, set] = useState({ status: 'loading', detail: null, path: null, pathRead: false });
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!uid) return undefined;
    let alive = true;
    set((x) => ({ ...x, status: 'loading' }));
    Promise.all([portfolio.through(() => teamsApi.getCompany(uid)), portfolio.legal(uid)]).then(([detail, legal]) => {
      if (!alive) return;
      set({
        status: detail.available ? 'ready' : detail.notFound ? 'notFound' : 'error',
        detail: detail.available ? detail.value : null,
        path: legal.available ? legal.value?.path || null : null,
        pathRead: !!legal.available,
      });
    });
    return () => { alive = false; };
  }, [uid, tick]);
  return { ...state, retry };
}

export default function CompanySettingsAt() {
  const { uid } = useParams();
  const { search, hash } = useLocation();
  const { company } = useActiveCompany();
  const { loading } = useCompanyReadState();
  const head = useCompanyHead(uid);
  const name = String(head.detail?.company_name || (company?.uid === uid ? company?.company_name : '') || '').trim();
  usePublishScope(uid && name ? scopeFor({ company: { uid, name } }) : null);
  if (loading) return null;
  if (!uid) {
    // The active company's settings have its own address; with none, the page says how to create or join one.
    if (company?.uid) return <Navigate replace to={`${companySettingsPathFor(company.uid)}${search}${hash}`} />;
    return <CompanySettingsPage />;
  }
  return (
    <div className="flex flex-col" data-testid="company-settings-general">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pt-6 md:px-7">
        <SettingsHead uid={uid} name={name} path={head.path} tab="general" />
        <GeneralCard uid={uid} detail={head.detail} path={head.path} pathRead={head.pathRead} status={head.status} onRetry={head.retry} />
      </div>
      {company?.uid === uid ? <CompanySettingsPage /> : (
        <div className="mx-auto flex max-w-3xl flex-col gap-2 p-6" data-testid="company-settings-not-active">
          <h2 className="m-0 text-[16px] font-bold">Full company settings</h2>
          <p className="m-0 text-[13.5px] text-axal-muted dark:text-gray-400">
            Full company settings read the company active on this device, and this one is not active here. Make it active from its page, then come back.
          </p>
          <Link to={companyPathFor(uid)} className="w-fit text-[13px] font-semibold text-violet-700 underline dark:text-violet-300">Open its page</Link>
        </div>
      )}
    </div>
  );
}
