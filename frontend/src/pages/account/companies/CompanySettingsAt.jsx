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
 * D4152 (#4152 §4–§6): with a company in the address, the page is
 * Settings › General: one header with the tabs Team · General · Legal ·
 * Projects (`SettingsHead`) and one form (`CompanyGeneralForm`), for any
 * company this member may see, not only the one active here. The old
 * `CompanySettingsPage` is no longer drawn under the tabs: no second header,
 * no scope banner, no "Coming later" rows, no internal path.
 *
 * Without a company: the active company's settings have their own address;
 * a partner's Firm Settings (D395) stay here, with a link to them; with no
 * company at all, `CompanySettingsPage` says how to create or join one.
 */
import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { useActiveCompany } from '../../../contexts/ActiveCompanyContext';
import { useCompanyReadState } from '../../../ui/CompanySwitcher';
import { teamsApi } from '../../../lib/api/teams';
import { scopeFor, usePublishScope } from '../../../lib/settingsScope.js';
import { useAuth } from '../../../hooks/useAuthSync';
import CompanySettingsPage, { FirmProfileMount } from '../../CompanySettingsPage';
import { companySettingsPathFor } from './companiesModel';
import { SettingsHead } from './CompanySettingsTabs.jsx';
import CompanyGeneralForm from './CompanyGeneralForm.jsx';

/** The company's name for the head, from its own read (any company the member belongs to). */
function useCompanyName(uid) {
  const [name, setName] = useState('');
  useEffect(() => {
    if (!uid) return undefined;
    let alive = true;
    teamsApi.getCompany(uid).then((d) => { if (alive) setName(String(d?.company_name || '').trim()); }, () => {});
    return () => { alive = false; };
  }, [uid]);
  return name;
}

export default function CompanySettingsAt() {
  const { uid } = useParams();
  const { search, hash } = useLocation();
  const { company } = useActiveCompany();
  const { loading } = useCompanyReadState();
  const { user } = useAuth();
  const read = useCompanyName(uid);
  const name = read || (company?.uid === uid ? String(company?.company_name || '').trim() : '');
  usePublishScope(uid && name ? scopeFor({ company: { uid, name } }) : null);
  if (loading) return null;
  if (!uid) {
    if (company?.uid && user?.role === 'partner') {
      // D395: a partner's Firm Settings live here; the company's settings are one link away.
      return (
        <>
          <FirmProfileMount role={user.role} />
          <p className="mx-auto max-w-3xl px-6 pt-4 text-[13px]">
            <Link to={companySettingsPathFor(company.uid)} className="font-semibold text-violet-700 underline dark:text-violet-300">Settings for {company.company_name || 'your company'}</Link>
          </p>
        </>
      );
    }
    if (company?.uid) return <Navigate replace to={`${companySettingsPathFor(company.uid)}${search}${hash}`} />;
    return <CompanySettingsPage />;
  }
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 md:px-7" data-testid="company-settings-general">
      <SettingsHead uid={uid} name={name} tab="general" />
      <CompanyGeneralForm uid={uid} />
    </div>
  );
}
