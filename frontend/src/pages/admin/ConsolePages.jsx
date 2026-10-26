import React from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../lib/shellRole';
import { PROFILE_OF_ROLE, crumbsOfKey, pageFor } from '../../lib/railPages';
import { Link } from 'react-router-dom';
import AdminPageHeader, { HeaderMenuItem, HeaderTab, useMovedNotice } from '../../ui/AdminPageHeader';
import { adminMercuryApi } from '../../lib/api/adminMercury';
import { tabOf } from './consoles/bankAccountsTabs';
import BankCashTab from './consoles/BankCashTab';
import BankHistoryTab from './consoles/BankHistoryTab';
import { ADMIN_CARD } from './consoles/bankCashModel';
import { bankAccountsApi } from '../../lib/api/bankAccounts';
import AdminBoardFrame from './AdminBoardFrame';
import { movedNoticesFor } from './LegacyContractsRedirect';
// D648 (#1448) — one component per console, each in its own file under
// ./consoles/ and each loading only its own data.
import UsersConsole from './consoles/UsersConsole';
import KycConsole from './consoles/KycConsole';
import { DirectoryPanel } from './consoles/DirectoryConsole';
import { WellbeingExpertsPanel } from './consoles/WellbeingConsole';
import { BankAccountsPanel, BankAccountsRail } from './consoles/BankAccountsConsole';
import { ProductTestingPanel } from './consoles/ProductTestingConsole';
import { ProductTestingTabBody, useTestingReads } from './productTesting/ProductTestingTabs';
import { PAGE_LINE as TESTING_LINE, tabCounts as testingTabCounts, viewOf as testingViewOf } from './productTesting/productTestingModel';
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

function ConsolePage({ crumb, hqCrumb = crumb, title, line, hqOnly = false, more = null, tabs = null, actions = null, testId, children }) {
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
        actions={actions}
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
 * the registry; Cash and History (D1186, #3115) read Mercury's stored
 * balances and flows and the reveal-and-change history. Cash and History
 * are the Super Admin's here, as the registry is; an Admin gets BNK11a's
 * card and the page reads nothing for them.
 */
function AdminCard() {
  return (
    <section className="mx-auto mt-6 flex w-full max-w-[620px] flex-col gap-2.5 rounded-axal-lg border border-dashed border-axal-hairline bg-white px-6 py-6 dark:border-gray-700 dark:bg-gray-900" data-testid="bank-admin-line">
      <span className="text-[10px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400">{ADMIN_CARD.eye}</span>
      <h2 className="m-0 text-[20px] font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">{ADMIN_CARD.title}</h2>
      <p className="m-0 text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">{ADMIN_CARD.line}</p>
      <Link className="w-fit text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" to="/admin/fund-admin/banking">Open Fund admin › Banking</Link>
    </section>
  );
}
function BankTabBody({ tab }) {
  const holder = isSuperAdminUser(useAuth()?.user ?? null);
  if (tab === 'accounts') return <BankAccountsPanel />;
  if (!holder) return <AdminCard />;
  if (tab === 'cash') return <BankCashTab api={adminMercuryApi} />;
  return <BankHistoryTab api={bankAccountsApi} />;
}

const BANK_LINE = 'The registry of each entity’s bank accounts. Notices and invoices print their payment instructions from here.';

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
    <BankAccountsRail>
      <ConsolePage crumb={{ ...PLATFORM, current: 'Bank accounts' }} title="Bank accounts" line={BANK_LINE} hqOnly tabs={tabs} testId="admin-platform-bank-accounts">
        <BankTabBody tab={tab} />
      </ConsolePage>
    </BankAccountsRail>
  );
}

/**
 * D1195 (#2382) — Product testing's five tabs at their own addresses (TST1–TST9):
 * Overview, Review and Programs (D815's console, Review in its `review` view),
 * one program at `/programs/:uid`, Applicants and the Tester pool.
 */
export function ProductTestingHqPage() {
  const { pathname, search } = useLocation();
  const view = testingViewOf(pathname, search);
  // D1201: the tab counts and the Overview's tiles draw from the same two reads.
  const reads = useTestingReads();
  const counts = testingTabCounts(reads.programmes, reads.testers);
  const tabs = (
    <>
      <HeaderTab to="/admin/platform/product-testing" data-testid="testing-tab-overview">Overview</HeaderTab>
      <HeaderTab to="/admin/platform/product-testing/review" count={counts.review} data-testid="testing-tab-review">Review</HeaderTab>
      <HeaderTab to="/admin/platform/product-testing/programs" end={false} count={counts.programs} data-testid="testing-tab-programs">Programs</HeaderTab>
      <HeaderTab to="/admin/platform/product-testing/applicants" count={counts.applicants} data-testid="testing-tab-applicants">Applicants</HeaderTab>
      <HeaderTab to="/admin/platform/product-testing/testers" count={counts.testers} data-testid="testing-tab-testers">Tester pool</HeaderTab>
    </>
  );
  const more = (
    <>
      <HeaderMenuItem to="/admin/approvals/product-testers" data-testid="testing-more-approvals">Tester applications in Approvals</HeaderMenuItem>
      <HeaderMenuItem to="/admin/held/accounts" data-testid="testing-more-accounts">Testers in Accounts</HeaderMenuItem>
    </>
  );
  // D1202 (TST7): New program is the header's, a lightbox over Programs.
  const actions = (
    <Link to="/admin/platform/product-testing/programs?new=1"
      className="inline-flex min-h-[34px] items-center justify-center rounded-[9px] bg-axal-violet px-3.5 text-[13px] font-bold text-white no-underline hover:bg-axal-violet-deep max-sm:min-h-[44px] dark:bg-violet-500 dark:hover:bg-violet-400"
      data-testid="testing-new-programme">New program</Link>
  );
  return (
    <ConsolePage hqOnly crumb={{ ...PLATFORM, current: 'Product testing' }} title="Product testing" line={TESTING_LINE} tabs={tabs} more={more} actions={actions} testId="admin-platform-product-testing">
      <ProductTestingTabBody view={view} reads={reads} review={<ProductTestingPanel view="review" />} programs={<ProductTestingPanel />} />
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
