/**
 * D1140 (#3020, CMP19) — the full company settings at their address under
 * Companies and projects (the owner's choice, 2026-10-27):
 *
 *   /account/companies/<uid>/settings   the company active on this device;
 *                                       another company says so and links
 *                                       to its page, where it can be made active
 *   /account/companies/settings         whichever is active, or, with none, a
 *                                       partner's Firm Settings, an advisor's
 *                                       Practice Settings and the way to
 *                                       create or join a company
 *
 * The page itself is `CompanySettingsPage`, unchanged: it reads the active
 * company, so only that company's settings are drawn here.
 */
import React from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { useActiveCompany } from '../../../contexts/ActiveCompanyContext';
import { useCompanyReadState } from '../../../ui/CompanySwitcher';
import CompanySettingsPage from '../../CompanySettingsPage';
import { companyPathFor, companySettingsPathFor } from './companiesModel';

export default function CompanySettingsAt() {
  const { uid } = useParams();
  const { search, hash } = useLocation();
  const { company } = useActiveCompany();
  const { loading } = useCompanyReadState();
  if (loading) return null;
  if (!uid) {
    // The active company's settings have its own address; with none, the page says how to create or join one.
    if (company?.uid) return <Navigate replace to={`${companySettingsPathFor(company.uid)}${search}${hash}`} />;
    return <CompanySettingsPage />;
  }
  if (company?.uid === uid) return <CompanySettingsPage />;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2 p-6" data-testid="company-settings-not-active">
      <h1 className="m-0 text-[18px] font-bold">Company settings</h1>
      <p className="m-0 text-[13.5px] text-axal-muted dark:text-gray-400">
        Full company settings read the company active on this device, and this one is not active here. Make it active from its page, then come back.
      </p>
      <Link to={companyPathFor(uid)} className="w-fit text-[13px] font-semibold text-violet-700 underline dark:text-violet-300">Open its page</Link>
    </div>
  );
}
