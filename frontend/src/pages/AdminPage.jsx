import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Shield, Users, ChevronDown, Briefcase, Check, ShieldCheck, FileText, Sparkles, KeyRound, Heart, Ticket, CreditCard, Package, FlaskConical, Landmark } from 'lucide-react';
import BrandIcon from '../ui/BrandIcon';
// D648 (#1448) — one component per console, each in its own file under
// ./admin/consoles/ and each loading only its own data. This page is the
// shell: the header, the section dropdown, and the one console it mounts.
import UsersConsole from './admin/consoles/UsersConsole';
import PartnerProfilesConsole from './admin/consoles/PartnerProfilesConsole';
import KycConsole from './admin/consoles/KycConsole';
import { LegalPanel } from './admin/consoles/LegalConsole';
import { PersonasPanel } from './admin/consoles/PersonasConsole';
import { DirectoryPanel } from './admin/consoles/DirectoryConsole';
import { IntegrationKeysPanel } from './admin/consoles/IntegrationKeysConsole';
import { GithubSyncPanel } from './admin/consoles/GithubSyncConsole';
import { PromoCodesPanel } from './admin/consoles/PromoCodesConsole';
import { PaymentsPanel } from './admin/consoles/PaymentsConsole';
import { BankAccountsPanel } from './admin/consoles/BankAccountsConsole';
import { BillingPanel } from './admin/consoles/BillingConsole';
import { WellbeingExpertsPanel } from './admin/consoles/WellbeingConsole';
// Task #1 — embedded as a tab inside Admin Console so admins land on
// the network roster via /admin?tab=network-profiles. The standalone
// /admin/network-profiles route stays wired for direct deep-links.
import AdminNetworkProfiles from './admin/AdminNetworkProfiles';
import AdminSpinoutLab from './admin/AdminSpinoutLab';
import AdminBoardFrame from './admin/AdminBoardFrame';
import { useAuth } from '../hooks/useAuthSync';
import { isSuperAdminUser } from '../lib/shellRole';
import { crumbsOfKey, pageKeyFor } from '../lib/railPages';

// The Legal console's panel. Contracts (`pages/hq/ContractsPage.jsx`, D647)
// renders its own desk, `pages/admin/contracts/ContractsDesk.jsx`, not this,
// and `/admin?tab=legal` redirects there before this shell mounts
// (`LegacyContractsRedirect`).
export { LegalPanel };

/**
 * GitHub Sync's entry draws GitHub's own mark from `ui/BrandIcon.jsx` (D687,
 * #1742), not lucide's branch glyph. It takes the `size` and `className` the
 * other entries' icons take, so the menu tints it like them.
 */
function GithubMark({ size = 16, className = '' }) {
  return <BrandIcon provider="github" size={size} variant="bare" tone="current" className={className} />;
}

// Task #15 — single ordered source for the Admin Console section nav. The
// dropdown trigger and menu both render from this list instead of a hardcoded
// row of tab buttons — fifteen sections today, one per entry below (the
// comment said twelve until D285; the list had grown twice; D708 added Bank
// accounts). Pending counts
// are computed per-render in the page and passed in via `badges` keyed by
// section value.
const ADMIN_SECTIONS = [
  { value: 'users', label: 'Users', Icon: Users },
  { value: 'profiles', label: 'Partner Profiles', Icon: Briefcase },
  { value: 'kyc', label: 'KYC Queue', Icon: ShieldCheck },
  { value: 'lab-applications', label: 'Spin-Out Lab', Icon: FlaskConical },
  { value: 'legal', label: 'Legal', Icon: FileText },
  { value: 'personas', label: 'Personas', Icon: Sparkles },
  { value: 'directory', label: 'Directory', Icon: Sparkles },
  { value: 'integration-keys', label: 'Integration Keys', Icon: KeyRound },
  { value: 'github', label: 'GitHub Sync', Icon: GithubMark },
  { value: 'promos', label: 'Promo Codes', Icon: Ticket },
  { value: 'payments', label: 'Payments', Icon: Package },
  // D708 (#1773) — the Super Admin's registry of each entity's bank accounts.
  { value: 'bank-accounts', label: 'Bank accounts', Icon: Landmark },
  { value: 'billing', label: 'Billing', Icon: CreditCard },
  { value: 'wellbeing', label: 'Wellbeing', Icon: Heart },
  { value: 'network-profiles', label: 'Advisors & Partners', Icon: Users },
];

const ADMIN_SECTION_VALUES = new Set(ADMIN_SECTIONS.map(s => s.value));

// Task #102 — the old inline LabApplicationsPanel was replaced by the full
// Spin-Out Lab admin dashboard (applications inbox + cohort participants +
// workspace access) in ./admin/AdminSpinoutLab, rendered as the
// 'lab-applications' tab below and standalone at /admin/spinout-lab.

// Dropdown replacing the old horizontal tab row. Closes on selection, outside
// click, and Escape; full light/dark support. Preserves the `admin-page` and
// `admin-tab-*` data-testid hooks so existing selectors keep working.
function AdminSectionNav({ value, onChange, badges }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = ADMIN_SECTIONS.find(s => s.value === value) || ADMIN_SECTIONS[0];
  const ActiveIcon = active.Icon;
  const activeBadge = badges?.[active.value] || 0;

  return (
    <div ref={ref} className="relative inline-block mb-6" data-testid="admin-page">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select admin section"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-2 min-w-[240px] px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 hover:border-violet-400 dark:hover:border-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40 transition-colors"
      >
        <ActiveIcon size={16} className="text-violet-600 dark:text-violet-300 shrink-0" />
        <span className="flex-1 text-left truncate">{active.label}</span>
        {activeBadge > 0 && (
          <span className="bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0">{activeBadge} pending</span>
        )}
        <ChevronDown size={14} className={`shrink-0 text-gray-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Admin sections"
          className="absolute left-0 top-full mt-1.5 z-50 w-[260px] max-h-[70vh] overflow-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1"
        >
          {ADMIN_SECTIONS.map(s => {
            const Icon = s.Icon;
            const isActive = s.value === value;
            const badge = badges?.[s.value] || 0;
            return (
              <li key={s.value} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  data-testid={`admin-tab-${s.value}`}
                  onClick={() => { onChange(s.value); setOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                    isActive
                      ? 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-200 font-semibold'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium'
                  }`}
                >
                  <Icon size={14} className={`shrink-0 ${isActive ? 'text-violet-600 dark:text-violet-300' : 'text-gray-400 dark:text-gray-500'}`} />
                  <span className="flex-1 truncate">{s.label}</span>
                  {badge > 0 && (
                    <span className="bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0">{badge} pending</span>
                  )}
                  {isActive && <Check size={14} className="shrink-0 text-violet-600 dark:text-violet-300" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * D774 (#2100) — the one rail on `/admin`. Every tab of this shell is a board
 * of the Admin profile (Users, Identity checks, Entity profiles, Wellbeing
 * experts, Advisors and partners, Directory) or of the Super Admin's (Users,
 * Personas, Advisors and partners, Directory, Integration keys, GitHub sync,
 * Payments catalogue, Promo codes), so the frame is drawn here, once, around
 * the whole page, and the tab names the board. The name is the page key
 * D768's map (`lib/railPages.js`) gives `/admin?tab=<tab>` for the viewer's
 * profile, its module or its section; a tab no canvas board names (Billing,
 * Bank accounts) takes the map's `Admin console`.
 *
 * The Spin-Out Lab tab draws no rail: D317 keeps Eadwyn out of the Lab
 * (`workspace_frame_contract.test.mjs`), so the frame is drawn there with
 * `rail={false}`, which keeps the page's tree, and the open dropdown, as it is.
 */
export function adminTabBoard(tab, role) {
  const { section, module } = crumbsOfKey(pageKeyFor('/admin', role, { search: `?tab=${tab}` }));
  return module || section;
}

function AdminConsoleFrame({ tab, children }) {
  const user = useAuth()?.user ?? null;
  const workspace = adminTabBoard(tab, isSuperAdminUser(user) ? 'super_admin' : 'admin');
  return (
    <AdminBoardFrame workspace={workspace} rail={tab !== 'lab-applications'} data-testid="admin-console-frame">
      {children}
    </AdminBoardFrame>
  );
}

// `section` locks the console to one tab and drops its own header and section
// nav, so a hosting page can compose one console under a header of its own.
// Since D648 each console is its own component and reads only its own data;
// HQ · Accounts mounts `UsersConsole` directly.
export default function AdminPage({ onImpersonate, section = null }) {
  // Initial section honors a `?tab=` deep-link (e.g. /admin?tab=network-profiles)
  // when it names a known section; otherwise defaults to Users.
  const [tab, setTab] = useState(() => {
    if (section && ADMIN_SECTION_VALUES.has(section)) return section;
    if (typeof window === 'undefined') return 'users';
    const t = new URLSearchParams(window.location.search).get('tab');
    return t && ADMIN_SECTION_VALUES.has(t) ? t : 'users';
  });
  const location = useLocation();
  const navigate = useNavigate();
  // D285 — the tab FOLLOWS the URL while the page is mounted, not only on the
  // first render: the H36 strips link one `?tab=` after another without
  // remounting this page. `section` still wins — a host that locked the
  // console to one panel is not steered by the address bar.
  useEffect(() => {
    if (section) return;
    const t = new URLSearchParams(location.search).get('tab');
    if (t && ADMIN_SECTION_VALUES.has(t)) setTab(t);
  }, [location.search, section]);
  // …and a pick writes back to the URL with `replace`, so the address bar
  // says which panel is open and Back does not step through every tab.
  const pickTab = useCallback((value) => {
    setTab(value);
    if (!section) navigate({ search: `?tab=${value}` }, { replace: true });
  }, [navigate, section]);

  // D648 — the dropdown's "N pending" badges. Each comes from its console's
  // own read, so a count is known once that console has been opened; the shell
  // no longer reads every console's data to draw two badges.
  const [pendingProfiles, setPendingProfiles] = useState(0);
  const [pendingKyc, setPendingKyc] = useState(0);

  const panel = (
    <div>
      {!section && (
        <>
          <div className="flex items-center gap-3 mb-1">
            <Shield size={24} className="text-violet-600" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Admin Console</h1>
          </div>
          <p className="text-gray-600 mb-6">
            Manage users, roles, and partner profiles.{' '}
            <Link to="/admin/trash" data-testid="admin-trash-door" className="text-violet-600 dark:text-violet-300 hover:underline">Trash</Link>
            {' '}holds soft-deleted projects.
          </p>

          <AdminSectionNav
            value={tab}
            onChange={pickTab}
            badges={{
              profiles: pendingProfiles,
              kyc: pendingKyc,
            }}
          />
        </>
      )}

      {tab === 'network-profiles' && (
        <div data-testid="admin-network-profiles-panel"><AdminNetworkProfiles /></div>
      )}

      {tab === 'lab-applications' && <AdminSpinoutLab onImpersonate={onImpersonate} />}
      {tab === 'legal' && <div data-testid="admin-legal-panel"><LegalPanel /></div>}
      {tab === 'personas' && <PersonasPanel />}
      {tab === 'directory' && <div data-testid="admin-directory-panel"><DirectoryPanel /></div>}
      {tab === 'integration-keys' && <div data-testid="admin-integration-keys-panel"><IntegrationKeysPanel /></div>}
      {tab === 'github' && <div data-testid="admin-github-panel"><GithubSyncPanel /></div>}
      {tab === 'promos' && <div data-testid="admin-promos-panel"><PromoCodesPanel /></div>}
      {tab === 'payments' && <div data-testid="admin-payments-panel"><PaymentsPanel /></div>}
      {tab === 'bank-accounts' && <div data-testid="admin-bank-accounts-panel"><BankAccountsPanel /></div>}
      {tab === 'billing' && <div data-testid="admin-billing-panel"><BillingPanel /></div>}
      {tab === 'wellbeing' && <div data-testid="admin-wellbeing-panel"><WellbeingExpertsPanel /></div>}
      {tab === 'users' && <UsersConsole onImpersonate={onImpersonate} />}
      {tab === 'profiles' && <PartnerProfilesConsole onPendingCount={setPendingProfiles} />}
      {tab === 'kyc' && <KycConsole onPendingCount={setPendingKyc} />}
    </div>
  );
  // A host that locks the console to one section composes it under a page,
  // and a rail, of its own.
  if (section) return panel;
  return <AdminConsoleFrame tab={tab}>{panel}</AdminConsoleFrame>;
}
