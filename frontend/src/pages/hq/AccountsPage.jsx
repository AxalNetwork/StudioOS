import React from 'react';
import { Users } from 'lucide-react';
import AdminPage from '../AdminPage';
import SuperAdminHolders from './SuperAdminHolders';
import { Unrecorded } from '../advisor/expertise/kit';

/**
 * HQ · Team — the cross-tenant accounts table (canvas H4).
 *
 * The table is the Admin Console's own Users panel, mounted locked to that
 * section, with the holder console above it. Nothing is duplicated: the
 * counts, filters, detail drawer and impersonation are the console's.
 *
 * WHAT THE CANVAS ADDS AND THIS DOES NOT. A tenant column — which subsidiary
 * each account belongs to — and reassignment between tenants. No account
 * carries a licence (UNRESOLVED_ITEMS U1), so the column has nothing to read
 * and reassignment has nothing to write. Both are named as not recorded
 * rather than drawn from the canvas's sample.
 */
export default function HqAccountsPage({ onImpersonate }) {
  return (
    <div className="space-y-5" data-testid="hq-accounts-page">
      <header>
        <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
          <Users size={13} /> HQ · Team
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink">Accounts</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-ink-2">
          Every account on the platform, in the same table the Admin Console keeps.
          Tenant per account: <Unrecorded /> — no account names the licence it belongs to
          yet, so a tenant column would be invented rather than read.
        </p>
      </header>

      <SuperAdminHolders />

      <AdminPage onImpersonate={onImpersonate} section="users" />
    </div>
  );
}
