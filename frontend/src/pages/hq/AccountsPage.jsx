import React, { useState } from 'react';
import { Users } from 'lucide-react';
import AdminPage from '../AdminPage';
import SuperAdminHolders from './SuperAdminHolders';
import HqTeamTable from './HqTeamTable';
import { Unrecorded } from '../advisor/expertise/kit';

/**
 * HQ · Team — the cross-tenant accounts screen (canvas H4, and H9 since D138).
 *
 * THREE THINGS IN ONE ORDER, and the order is H9's: who holds the elevation,
 * then who the administrators are and what the compliance ladder says about
 * each, then the full directory. Nothing is duplicated — the directory is the
 * Admin Console's own Users panel, mounted locked to that section, with its
 * counts, filters, detail drawer and impersonation.
 *
 * WHAT CHANGED IN D138 AND WHAT DID NOT. Before it there was no screen anywhere
 * whose subject was the admin accounts: supervising one meant opening its
 * licence, its Administrators tab and its Notices tab, one licence at a time.
 * `HqTeamTable` is that screen. The canvas's TENANT COLUMN on the directory
 * below is still not drawn, and the reason is narrower than it was rather than
 * gone: `licence_admins` names the licence an ADMINISTRATOR holds, which is
 * what the Team table reads, but no ordinary account names a licence at all
 * (UNRESOLVED_ITEMS U1), so a tenant column on the directory would still be
 * invented rather than read.
 */
export default function HqAccountsPage({ onImpersonate }) {
  // Granting or revoking the elevation changes a badge in the Team table, so
  // the two are kept in step rather than left to disagree until a reload. The
  // `onSaved` idiom D134's `AdminsEditor` already uses, one level up.
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="space-y-5" data-testid="hq-accounts-page">
      <header>
        <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
          <Users size={13} /> HQ · Team
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink">Accounts</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
          Who holds the elevation, every administrator with their licence and compliance state,
          and below them every account on the platform in the same table the Admin Console keeps.
          Tenant per ordinary account: <Unrecorded /> — an administrator names the licence they
          hold, but no other account does yet, so the directory has no tenant column to read.
        </p>
      </header>

      <SuperAdminHolders onChanged={() => setReloadKey((n) => n + 1)} />

      <HqTeamTable reloadKey={reloadKey} />

      <AdminPage onImpersonate={onImpersonate} section="users" />
    </div>
  );
}
