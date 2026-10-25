import React from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../lib/shellRole';
import { PROFILE_OF_ROLE, crumbsOfKey, pageFor } from '../../lib/railPages';
import { Link } from 'react-router-dom';
import AdminPageHeader, { HeaderMenuItem, HeaderTab, useMovedNotice } from '../../ui/AdminPageHeader';
import { adminMercuryApi } from '../../lib/api/adminMercury';
import { Accounts as EntityAccounts } from './fundAdmin/BankingTabs';
import { ADMIN_CASH_LINE, NOT_YET, WAITS, tabOf } from './consoles/bankAccountsTabs';
import AdminBoardFrame from './AdminBoardFrame';
import { movedNoticesFor } from './LegacyContractsRedirect';
// D648 (#1448) — one component per console, each in its own file under
// ./consoles/ and each loading only its own data.
import UsersConsole from './consoles/UsersConsole';
import KycConsole from './consoles/KycConsole';
import { DirectoryPanel } from './consoles/DirectoryConsole';
import { WellbeingExpertsPanel } from './consoles/WellbeingConsole';
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
 * (#2375's route map): All accounts is under Accounts on the Admin shell
 * and Team on HQ. The scope chip is the Admin shell's only. Partner profiles,
 * Persona segments and Payments retain their dedicated pages from main.
 */

/** The board a viewer's rail is named for on `pathname`, or null for the page alone. */
export function consoleBoard(pathname, role) {
  const page = pageFor(pathname, role);
  if (!page || page.offCanvas) return null;
  const { profile, module } = crumbsOfKey(page.key);
  return profile === PROFILE_OF_ROLE[role] ? module : null;
}

function ConsolePage({ crumb, hqCrumb = crumb, title, line, hqOnly = false, more = null, tabs = null, testId, children }) {
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
        pills={hqOnly ? [{ label: 'HQ only', tone: 'hq' }] : []}
        line={line}
        scope={!hq}
        more={more}
        tabs={tabs}
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
const APPROVALS = { label: 'Approvals', to: '/admin/approvals' };
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

export function KycPage() {
  return (
    <ConsolePage crumb={{ ...APPROVALS, current: 'KYC & KYB' }} title="KYC & KYB" line="Identity checks waiting for review, and each one's record." testId="admin-kyc">
      <KycConsole />
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

/**
 * D1181 (#2389) — Bank accounts' three tabs (BNK1, BNK3, BNK5). Accounts is
 * today's registry; Cash draws the entity accounts' balances from the read
 * Fund admin › Banking makes, and says what waits; History waits for its read.
 * Cash and History are the Super Admin's here, as the registry is.
 */
const MERCURY_APIS = { mercury: adminMercuryApi };
function Wait({ id, title }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900" data-testid={`bank-wait-${id}`}>
      <h3 className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">{title}</h3>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{WAITS[id]}</p>
    </section>
  );
}
function BankTabBody({ tab }) {
  const holder = isSuperAdminUser(useAuth()?.user ?? null);
  if (tab === 'accounts') return <BankAccountsPanel />;
  if (!holder) {
    return <p className="p-6 text-sm text-gray-700 dark:text-gray-300" data-testid="bank-admin-line">{ADMIN_CASH_LINE} <Link className="font-semibold text-axal-violet dark:text-violet-300" to="/admin/fund-admin/banking">Open Fund admin › Banking</Link></p>;
  }
  if (tab === 'cash') {
    return (
      <div className="flex flex-col gap-4" data-testid="bank-cash">
        <EntityAccounts apis={MERCURY_APIS} />
        <Wait id="series" title="Balance over time" />
        <Wait id="monthly" title="Money in and out" />
      </div>
    );
  }
  return <Wait id="history" title="History" />;
}

export function BankAccountsPage() {
  const { pathname } = useLocation();
  const tab = tabOf(pathname);
  const tabs = (
    <>
      <HeaderTab to="/admin/platform/bank-accounts" data-testid="bank-tab-accounts">Accounts</HeaderTab>
      <HeaderTab to="/admin/platform/bank-accounts/cash" data-testid="bank-tab-cash">Cash</HeaderTab>
      <HeaderTab to="/admin/platform/bank-accounts/history" data-testid="bank-tab-history">History</HeaderTab>
    </>
  );
  return (
    <ConsolePage crumb={{ ...PLATFORM, current: 'Bank accounts' }} title="Bank accounts" line="Each entity's bank accounts, their Mercury state and the receipts not yet matched." tabs={tabs} testId="admin-platform-bank-accounts">
      <BankTabBody tab={tab} />
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
    <ConsolePage hqOnly crumb={{ label: 'Revenue', to: '/admin/revenue', current: 'Billing' }} title="Billing" line="Refunds, disputes and their evidence, and each customer's lifetime value." testId="admin-revenue-billing">
      <BillingPanel />
    </ConsolePage>
  );
}
