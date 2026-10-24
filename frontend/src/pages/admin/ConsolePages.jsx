import React from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../lib/shellRole';
import { PROFILE_OF_ROLE, crumbsOfKey, pageFor } from '../../lib/railPages';
import AdminPageHeader, { HeaderMenuItem, useMovedNotice } from '../../ui/AdminPageHeader';
import AdminBoardFrame from './AdminBoardFrame';
import { movedNoticesFor } from './LegacyContractsRedirect';
// D648 (#1448) — one component per console, each in its own file under
// ./consoles/ and each loading only its own data.
import UsersConsole from './consoles/UsersConsole';
import PartnerProfilesConsole from './consoles/PartnerProfilesConsole';
import KycConsole from './consoles/KycConsole';
import { PersonasPanel } from './consoles/PersonasConsole';
import { DirectoryPanel } from './consoles/DirectoryConsole';
import { WellbeingExpertsPanel } from './consoles/WellbeingConsole';
import { PaymentsPanel } from './consoles/PaymentsConsole';
import { BankAccountsPanel } from './consoles/BankAccountsConsole';
import { ProductTestingPanel } from './consoles/ProductTestingConsole';
import { PromoCodesPanel } from './consoles/PromoCodesConsole';
import { BillingPanel } from './consoles/BillingConsole';

/**
 * D938 (#2743, part 1 of #2375) — the Admin Console's tools, each a page at
 * its #2375 address under `AdminPageHeader`. There is no console shell, no
 * "Admin Console" title and no section dropdown: `/admin?tab=` forwards to
 * these addresses (`LegacyContractsRedirect`) before anything mounts.
 *
 * Each page is the header, then one console that reads only its own data. The
 * header renders at once, from the page, never from a read (D936).
 *
 * THE RAIL. A page sits in `AdminBoardFrame`, named for its board in the
 * viewer's own profile from D768's page map (`pageFor`), as the console's one
 * frame was named for its tab (D775). A page that is no board of the viewer's
 * profile (Identity checks for a Super Admin, Billing for anyone) draws the
 * page alone.
 *
 * THE CRUMB names the section whose row the page lights in the viewer's shell
 * (#2375's route map): All accounts and Persona segments are Accounts' on the
 * Admin shell, and Team's and Content's on HQ's. The scope chip is the Admin
 * shell's only.
 */

/** The board a viewer's rail is named for on `pathname`, or null for the page alone. */
export function consoleBoard(pathname, role) {
  const page = pageFor(pathname, role);
  if (!page || page.offCanvas) return null;
  const { profile, module } = crumbsOfKey(page.key);
  return profile === PROFILE_OF_ROLE[role] ? module : null;
}

function ConsolePage({ crumb, hqCrumb = crumb, title, line, more = null, testId, children }) {
  const user = useAuth()?.user ?? null;
  const { pathname } = useLocation();
  const hq = isSuperAdminUser(user);
  const board = consoleBoard(pathname, hq ? 'super_admin' : user?.role);
  const notice = useMovedNotice(movedNoticesFor(pathname));
  const page = (
    <div className="flex min-w-0 flex-col gap-5" data-testid={testId}>
      <AdminPageHeader
        crumb={hq ? hqCrumb : crumb}
        title={title}
        line={line}
        scope={!hq}
        more={more}
        notice={{ text: notice.text, onDismiss: notice.dismiss }}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
  if (!board) return page;
  return (
    <AdminBoardFrame workspace={board} note={`Eadwyn reads the ${board} panel on this page. Nothing here changes until you act on it.`} data-testid="admin-console-frame">
      {page}
    </AdminBoardFrame>
  );
}

const ACCOUNTS = { label: 'Accounts', to: '/admin/held/accounts' };
const APPROVALS = { label: 'Approvals', to: '/admin/held/approvals' };
const COMMUNITY = { label: 'Community', to: '/admin/community' };
const PLATFORM = { label: 'Platform', to: '/admin/platform' };

/**
 * All accounts, at `/admin/accounts/all`. #2375's question 1 (does Accounts
 * take `/admin/accounts`, or `/admin/members`?) is the owner's, so the list
 * sits here until part 4 (#2746); `/admin/accounts` itself stays HQ › Team.
 * The More menu carries the Trash door the console's header held.
 */
export function AllAccountsPage({ onImpersonate }) {
  const copyLink = () => { navigator.clipboard?.writeText?.(window.location.href)?.catch?.(() => {}); };
  return (
    <ConsolePage
      crumb={{ ...ACCOUNTS, current: 'All accounts' }}
      hqCrumb={{ label: 'Team', to: '/admin/accounts', current: 'All accounts' }}
      title="All accounts"
      line="Every account HQ holds: find one, change its role, open its record."
      more={(
        <>
          <HeaderMenuItem onSelect={copyLink}>Copy page link</HeaderMenuItem>
          <HeaderMenuItem to="/admin/trash" data-testid="admin-trash-door">Trash (soft-deleted projects)</HeaderMenuItem>
        </>
      )}
      testId="admin-all-accounts"
    >
      <UsersConsole onImpersonate={onImpersonate} />
    </ConsolePage>
  );
}

export function PartnerProfilesPage() {
  return (
    <ConsolePage crumb={{ ...APPROVALS, current: 'Partner profiles' }} title="Partner profiles" line="Partner firms' profiles waiting for review, and every profile on record." testId="admin-partner-profiles">
      <PartnerProfilesConsole />
    </ConsolePage>
  );
}

export function KycPage() {
  return (
    <ConsolePage crumb={{ ...APPROVALS, current: 'KYC & KYB' }} title="KYC & KYB" line="Identity checks waiting for review, and each one's record." testId="admin-kyc">
      <KycConsole />
    </ConsolePage>
  );
}

export function PersonaSegmentsPage() {
  return (
    <ConsolePage
      crumb={{ ...ACCOUNTS, current: 'Persona segments' }}
      hqCrumb={{ label: 'Content', to: '/admin/content', current: 'Persona segments' }}
      title="Persona segments"
      line="The personas members are sorted into, and who sits in each."
      testId="admin-persona-segments"
    >
      <PersonasPanel />
    </ConsolePage>
  );
}

export function DirectoryPage() {
  return (
    <ConsolePage crumb={{ ...COMMUNITY, current: 'Directory' }} title="Directory" line="The service providers members can find and contact." testId="admin-directory">
      <DirectoryPanel />
    </ConsolePage>
  );
}

export function AdminWellbeingPage() {
  return (
    <ConsolePage crumb={{ ...COMMUNITY, current: 'Wellbeing' }} title="Wellbeing" line="The wellbeing experts members can book." testId="admin-wellbeing">
      <WellbeingExpertsPanel />
    </ConsolePage>
  );
}

export function PaymentsPage() {
  return (
    <ConsolePage crumb={{ ...PLATFORM, current: 'Payments' }} title="Payments" line="The product catalogue, its prices and the Stripe settings checkout uses." testId="admin-platform-payments">
      <PaymentsPanel />
    </ConsolePage>
  );
}

export function BankAccountsPage() {
  return (
    <ConsolePage crumb={{ ...PLATFORM, current: 'Bank accounts' }} title="Bank accounts" line="Each entity's bank accounts, their Mercury state and the receipts not yet matched." testId="admin-platform-bank-accounts">
      <BankAccountsPanel />
    </ConsolePage>
  );
}

export function ProductTestingHqPage() {
  return (
    <ConsolePage crumb={{ ...PLATFORM, current: 'Product testing' }} title="Product testing" line="Partners' testing programmes waiting for approval, and HQ's own." testId="admin-platform-product-testing">
      <ProductTestingPanel />
    </ConsolePage>
  );
}

export function PromoCodesPage() {
  return (
    <ConsolePage crumb={{ ...PLATFORM, current: 'Promo codes' }} title="Promo codes" line="The codes members can use at checkout, and what each one takes off." testId="admin-platform-promo-codes">
      <PromoCodesPanel />
    </ConsolePage>
  );
}

export function BillingPage() {
  return (
    <ConsolePage crumb={{ label: 'Revenue', to: '/admin/revenue', current: 'Billing' }} title="Billing" line="Refunds, disputes and their evidence, and each customer's lifetime value." testId="admin-revenue-billing">
      <BillingPanel />
    </ConsolePage>
  );
}
