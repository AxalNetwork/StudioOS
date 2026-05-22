import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { safeReadJSON } from './lib/storage';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuthSync';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import PersonalAssistant from './components/PersonalAssistant';
import SpinoutLabListener from './components/SpinoutLabListener';
import SafeMount from './components/SafeMount';
import {
  LayoutDashboard, Target, FileText, Users, DollarSign,
  Ticket, Menu, X, Zap, Handshake, Rocket, UserCircle,
  Globe, Brain, Activity, LogOut, Shield,
  ChevronDown, ChevronLeft, ChevronRight, Eye, ArrowLeft, Code, ShieldCheck, Share2, Wallet, Network, Sparkles, Briefcase, TrendingUp, Layers, Scale, Plug, MessageSquare, Package, Lock, Calendar,
  Settings as SettingsIcon, PieChart as PieIcon, Heart, Bookmark, Megaphone, BookOpen, Search
} from 'lucide-react';
import { SIDEBAR_GROUPS, defaultOpenGroups, filterItemsByTier, hasTier, hasInvestorTier } from './sidebarConfig';
import PaywallModal, { openPaywall } from './components/PaywallModal';
import { Lock as LockIcon } from 'lucide-react';
import { api } from './lib/api';
import SpinoutLabSidebar from './components/SpinoutLabSidebar';
import Dashboard from './pages/Dashboard';
import ScoringPage from './pages/ScoringPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetail from './pages/ProjectDetail';
import LegalPage from './pages/LegalPage';
import IncorporatePage from './pages/IncorporatePage';
import CofounderAgreementPage from './pages/CofounderAgreementPage';
import Section83bPage from './pages/Section83bPage';
import CompliancePage from './pages/CompliancePage';
import WellbeingPage from './pages/WellbeingPage';
import PartnersPage from './pages/PartnersPage';
import CapitalPage from './pages/CapitalPage';
import TicketsPage from './pages/TicketsPage';
import DealsPage from './pages/DealsPage';
import FounderPortal from './pages/FounderPortal';
import PartnerPortal from './pages/PartnerPortal';
import PartnerDealPortal from './pages/PartnerDealPortal';
import PartnerOnboardPage from './pages/PartnerOnboardPage';
import AdminPartnerInvitations from './pages/admin/PartnerInvitations';
import AdminPublications from './pages/admin/Publications';
import AdminTeam from './pages/admin/AdminTeam';
import AdminTelegram from './pages/admin/AdminTelegram';
import AdminX from './pages/admin/AdminX';
import AdminNewsQueue from './pages/admin/AdminNewsQueue';
import NewsAuthorPage from './pages/NewsAuthorPage';
// Task #1 — Articles surfaces (public + author + admin queue).
import ArticlesPage from './pages/ArticlesPage';
import ArticleReaderPage from './pages/ArticleReaderPage';
import ArticleAuthorPage from './pages/ArticleAuthorPage';
import ArticlesQueuePage from './pages/admin/ArticlesQueuePage';
import AdminPublicationNew from './pages/admin/PublicationNew';
import AdminPublicationDetail from './pages/admin/PublicationDetail';
import PublicInsight from './pages/insights/PublicInsight';
import MarketIntelPage from './pages/MarketIntelPage';
import AdvisoryPage from './pages/AdvisoryPage';
import ActivityPage from './pages/ActivityPage';
import AdminPage from './pages/AdminPage';
import AdminTrashPage from './pages/AdminTrashPage';
import AdminReferEarnPayouts from './pages/admin/ReferEarnPayouts';
import AdminDueDiligencePage from './pages/AdminDueDiligencePage';
import AdminDueDiligenceCasePage from './pages/AdminDueDiligenceCasePage';
import ApiBridgePage from './pages/ApiBridgePage';
import LandingPage from './pages/LandingPage';
import SpinoutLabPage from './pages/SpinoutLabPage';
import RegisterPage from './pages/RegisterPage';
import LoginPage from './pages/LoginPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import RecoverPage from './pages/RecoverPage';
import ESignPage from './pages/ESignPage';
import KYCPage from './pages/KYCPage';
import TrustCenterPage from './pages/TrustCenterPage';
import MentorsPage from './pages/MentorsPage';
import OfficeHoursPage from './pages/OfficeHoursPage';
import PartnerOfficeHoursPage from './pages/PartnerOfficeHoursPage';
import CoMarketingPage from './pages/CoMarketingPage';
import CalendarPage from './pages/CalendarPage';
import CofounderPage from './pages/CofounderPage';
import PortfolioHealthPage from './pages/PortfolioHealthPage';
import WatchlistJournalPage from './pages/WatchlistJournalPage';
import ReferEarnPage from './pages/ReferEarnPage';
import IntegrationsPage from './pages/IntegrationsPage';
import PayoutsPage from './pages/PayoutsPage';
import NetworkPage from './pages/NetworkPage';
import MatchesPage from './pages/MatchesPage';
import StudioOpsPage from './pages/StudioOpsPage';
import NetworkEffectsPage from './pages/NetworkEffectsPage';
import PipelinePage from './pages/PipelinePage';
import RelationshipsPage from './pages/RelationshipsPage';
import LegalCapitalPage from './pages/LegalCapitalPage';
import SpinOutsPage from './pages/SpinOutsPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import RiskDisclosuresPage from './pages/RiskDisclosuresPage';
// Task #4 (ID) — Public marketing surfaces.
import PricingPage from './pages/PricingPage';
import DemoPage from './pages/DemoPage';
import StatusPage from './pages/StatusPage';
import ChangelogPage from './pages/ChangelogPage';
import PublicRoadmapPage from './pages/PublicRoadmapPage';
import MonitoringPage from './pages/MonitoringPage';
import LiquidityPage from './pages/LiquidityPage';
import FundsPage from './pages/FundsPage';
import InvestorPricingPage from './pages/InvestorPricingPage';
import ReservesPage from './pages/ReservesPage';
import WaterfallPage from './pages/WaterfallPage';
import SettingsPage from './pages/SettingsPage';
import DocsPage from './pages/DocsPage';
import OnboardingPersonaPage from './pages/OnboardingPersonaPage';
import AcademyLessonPage from './pages/AcademyLessonPage';
import OnboardingFounderPage from './pages/OnboardingFounderPage';
import OnboardingInvestorPage from './pages/OnboardingInvestorPage';
import OnboardingPartnerPage from './pages/OnboardingPartnerPage';
import OnboardingChatPage from './pages/OnboardingChatPage';
import BrandBuilderPage from './pages/BrandBuilderPage';
import PitchDeckPage from './pages/PitchDeckPage';
import FinancialsPage from './pages/FinancialsPage';
import DiscoveryPage from './pages/DiscoveryPage';
import CustomerDiscoveryPage from './pages/CustomerDiscoveryPage';
import RoadmapPage from './pages/RoadmapPage';
import MetricsPage from './pages/MetricsPage';
import CapTablePage from './pages/CapTablePage';
import MarketplacePage from './pages/MarketplacePage';
import NeedsBoardPage from './pages/NeedsBoardPage';
import ServiceCatalogPage from './pages/ServiceCatalogPage';
import PartnerInsightsPage from './pages/PartnerInsightsPage';
import PublicDirectoryPage from './pages/PublicDirectoryPage';
import PublicPartnerProfilePage from './pages/PublicPartnerProfilePage';
import PublicProfilePage from './pages/PublicProfilePage';
import PitchDeckPrintPage from './pages/PitchDeckPrintPage';
import { PERSONA_BY_ID as PERSONA_LOOKUP } from './lib/personas';
import EmailChangeConfirmPage from './pages/EmailChangeConfirmPage';
import EmailChangeRevokePage from './pages/EmailChangeRevokePage';
import InactivityWarningModal from './components/InactivityWarningModal';
import NotificationBell from './components/NotificationBell';
import CommandPalette from './components/CommandPalette';
// Task #7 (IG) — Contextual help (+ paid-tier customer chat) on every signed-in page.
import HelpWidget from './components/HelpWidget';
import InstallPrompt from './components/InstallPrompt';
import KeyboardShortcutsOverlay from './components/KeyboardShortcutsOverlay';
import useInactivityTimeout from './hooks/useInactivityTimeout';

// Phase B · Prompt 5 — sidebar groups now live in `frontend/src/sidebarConfig.js`.

const ROLE_LABELS = {
  admin: 'Admin',
  founder: 'Founder',
  partner: 'Partner',
  investor: 'Investor',
  mentor: 'Mentor',
};

const ROLE_COLORS = {
  admin: 'bg-violet-100 text-violet-700',
  founder: 'bg-blue-100 text-blue-700',
  partner: 'bg-emerald-100 text-emerald-700',
  investor: 'bg-purple-100 text-purple-700',
  mentor: 'bg-amber-100 text-amber-700',
};

const ROLE_DEFAULT_PATH = {
  admin: '/dashboard',
  founder: '/founder',
  partner: '/partner-portal',
  investor: '/dashboard',
  mentor: '/office-hours',
  // Task #51 follow-up — fresh Google signups land with role='pending' until
  // the onboarding chatbot classifies them. The pending-gate in RequireAuth
  // pins them to /onboarding/chat, but this default keeps any stray
  // role-lookup (e.g. landing-page fallback) from 404-ing them out.
  pending: '/onboarding/chat',
};

const ViewModeContext = createContext(null);
export const useViewMode = () => useContext(ViewModeContext);

function getSidebarGroups(role, primaryPersonaId, user) {
  const base = SIDEBAR_GROUPS[role] || SIDEBAR_GROUPS.founder;
  // Apply tier gating per group (stub passes everything through today;
  // Phase C will swap `hasTier` for the real subscription check).
  const groups = base
    .map((g) => ({ ...g, items: filterItemsByTier(g.items, user) }))
    .filter((g) => (g.items || []).length > 0);

  // Persona-specific deep-links surface as their own collapsible group
  // inserted right after Home, skipping anything the role already shows
  // so we never duplicate a row.
  const persona = primaryPersonaId ? PERSONA_LOOKUP[primaryPersonaId] : null;
  if (!persona || !Array.isArray(persona.nav_extras) || persona.nav_extras.length === 0) {
    return groups;
  }
  const existingPaths = new Set();
  groups.forEach((g) => g.items.forEach((it) => existingPaths.add(it.to)));
  const extras = persona.nav_extras.filter((e) => !existingPaths.has(e.to));
  if (extras.length === 0) return groups;
  const personaGroup = {
    key: `persona-${persona.id || primaryPersonaId}`,
    label: `For ${persona.label}`,
    items: extras.map((e) => ({ to: e.to, icon: Sparkles, label: e.label })),
  };
  // Insert after the Home group (index 0) so personas always sit near the top.
  return [groups[0], personaGroup, ...groups.slice(1)].filter(Boolean);
}

// Highlight matching substring inside a label. Returns a JSX-friendly
// fragment when there's a match, otherwise the plain label.
function highlightMatch(label, query) {
  if (!query) return label;
  const lower = label.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return label;
  return (
    <>
      {label.slice(0, idx)}
      <mark className="bg-yellow-200 text-gray-900 rounded px-0.5">
        {label.slice(idx, idx + query.length)}
      </mark>
      {label.slice(idx + query.length)}
    </>
  );
}

// Sidebar abbreviations for the collapsed rail. First letter of each word
// (split on whitespace and hyphens), filtering out filler words, capped at
// 3 chars. Examples: Dashboard→D, Admin Console→AC, Pipeline Board→PB,
// Spin-Outs→SO, Refer & Earn→RE.
function abbreviateLabel(label) {
  if (!label) return '';
  const parts = String(label).split(/[\s\-/&]+/).filter((w) => {
    if (!w) return false;
    return !/^(and|the|of|a|to|for|on|in|my)$/i.test(w);
  });
  return parts.map((w) => w[0].toUpperCase()).join('').slice(0, 3) || label[0].toUpperCase();
}

function SidebarNav({ groups, role, onNavigate, user, collapsed }) {
  const [query, setQuery] = useState('');
  // Persisted open-state per group key. We seed once from
  // localStorage merged with `defaultOpenGroups()` so first-time users
  // land with Home + the first content group expanded.
  const [openKeys, setOpenKeys] = useState(() => {
    const stored = safeReadJSON('sidebar_open_groups');
    if (stored && typeof stored === 'object') {
      return new Set(Object.keys(stored).filter((k) => stored[k]));
    }
    // Seed defaults from the first role we render — refined per render below.
    return new Set();
  });
  const [seeded, setSeeded] = useState(false);

  // Lazy-seed defaults once we know the role's group keys (groups change
  // when the admin toggles "View as"). We only seed when localStorage
  // had nothing for us (first visit).
  useEffect(() => {
    if (seeded) return;
    const stored = safeReadJSON('sidebar_open_groups');
    if (stored && typeof stored === 'object' && Object.keys(stored).length > 0) {
      setSeeded(true);
      return;
    }
    const defaults = role ? defaultOpenGroups(role) : new Set(groups.slice(0, 2).map((g) => g.key));
    setOpenKeys(defaults);
    setSeeded(true);
  }, [groups, role, seeded]);

  const persistOpen = useCallback((next) => {
    const obj = {};
    next.forEach((k) => { obj[k] = true; });
    try { localStorage.setItem('sidebar_open_groups', JSON.stringify(obj)); } catch { /* ignore */ }
  }, []);

  const toggleGroup = useCallback((key) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      persistOpen(next);
      return next;
    });
  }, [persistOpen]);

  const q = query.trim().toLowerCase();
  // When the user types, force-expand any group with a match so the
  // matching items are visible without manual clicking.
  const effectiveOpen = q
    ? new Set(groups.filter((g) => g.items.some((it) => it.label.toLowerCase().includes(q))).map((g) => g.key))
    : openKeys;

  return (
    <nav className="flex-1 py-3 overflow-y-auto" aria-label="Primary navigation" data-tour="sidebar-nav">
      {!collapsed && (
        <div className="px-3 pb-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              aria-label="Search sidebar"
              className="w-full pl-8 pr-2 py-1.5 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 focus:bg-white dark:focus:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 placeholder:text-gray-400 dark:placeholder:text-gray-500"
            />
          </div>
        </div>
      )}
      {groups.map((group) => {
        const visibleItems = q
          ? group.items.filter((it) => it.label.toLowerCase().includes(q))
          : group.items;
        if (q && visibleItems.length === 0) return null;
        const isOpen = collapsed ? true : effectiveOpen.has(group.key);
        return (
          <div key={group.key} className="mb-0.5">
            {collapsed ? (
              <div
                className="px-2 pt-3 pb-1 text-[9px] font-semibold uppercase tracking-wider text-gray-400 text-center"
                title={group.label}
              >
                {group.label}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                aria-expanded={isOpen}
                className="w-full flex items-center gap-1 px-5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                <span>{group.label}</span>
              </button>
            )}
            {isOpen && visibleItems.map((item) => {
              const { to, icon: Icon, label, highlight, requiredTier, requiredInvestorTier } = item;
              const abbr = abbreviateLabel(label);
              // Task #6 / #7 — items the user can't afford render as a
              // "locked" button that opens PaywallModal. Bypass roles + users
              // on the right tier render as normal NavLinks. Investor tier
              // gates take precedence when present (investor-only nav).
              const founderLocked = !!requiredTier && !hasTier(user, requiredTier);
              const investorLocked = !!requiredInvestorTier && !hasInvestorTier(user, requiredInvestorTier);
              const locked = founderLocked || investorLocked;
              if (locked) {
                const lockTier = investorLocked ? requiredInvestorTier : requiredTier;
                const lockLabel = lockTier === 'institutional' ? 'Institutional'
                  : lockTier === 'professional' ? 'Professional'
                  : lockTier === 'studio' ? 'Studio'
                  : 'Growth';
                return (
                  <button
                    key={to}
                    type="button"
                    onClick={() => openPaywall(lockTier)}
                    className={collapsed
                      ? 'w-full flex flex-col items-center gap-0.5 px-1 py-2 text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors'
                      : 'w-full flex items-center gap-3 px-5 py-2 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors'}
                    title={`${label} — requires ${lockLabel} plan`}
                  >
                    {Icon && <Icon size={collapsed ? 18 : 16} />}
                    {collapsed ? (
                      <span className="truncate w-full text-center">{abbr}</span>
                    ) : (
                      <>
                        <span className="truncate flex-1 text-left">{highlightMatch(label, q)}</span>
                        <LockIcon size={11} className="flex-shrink-0" />
                      </>
                    )}
                  </button>
                );
              }
              return (
                <NavLink
                  key={to}
                  to={to}
                  end
                  onClick={onNavigate}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    collapsed
                      ? `flex flex-col items-center gap-0.5 px-1 py-2 text-[10px] transition-colors ${
                          isActive
                            ? 'text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 border-r-2 border-violet-600'
                            : highlight
                              ? 'text-violet-700 dark:text-violet-300 font-medium bg-violet-50/60 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/40'
                              : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`
                      : `flex items-center gap-3 px-5 py-2 text-sm transition-colors ${
                          isActive
                            ? 'text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 border-r-2 border-violet-600'
                            : highlight
                              ? 'text-violet-700 dark:text-violet-300 font-medium bg-violet-50/60 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/40'
                              : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`
                  }
                >
                  {Icon && <Icon size={collapsed ? 18 : 16} />}
                  {collapsed ? (
                    <span className="truncate w-full text-center">{abbr}</span>
                  ) : (
                    <span className="truncate">{highlightMatch(label, q)}</span>
                  )}
                </NavLink>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function PortalSwitcher({ viewMode, onViewModeChange, isImpersonating, onExitImpersonation, realUser, impersonatedUser }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-gradient-to-r from-violet-700 to-indigo-700 text-white px-4 py-2 flex items-center gap-3 text-sm relative z-[60]">
      <Shield size={14} className="opacity-80" />
      <span className="font-medium opacity-90">Admin Mode</span>

      {isImpersonating ? (
        <div className="ml-2 flex items-center gap-2 bg-amber-500/20 px-3 py-1.5 rounded-lg">
          <Eye size={13} />
          <span>Impersonating: {impersonatedUser?.name} ({ROLE_LABELS[impersonatedUser?.role]})</span>
        </div>
      ) : (
        <div className="ml-2 relative">
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Eye size={13} />
            <span>View as: {ROLE_LABELS[viewMode]}</span>
            <ChevronDown size={13} />
          </button>
          {open && (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-50 cursor-default bg-transparent"
                onClick={() => setOpen(false)}
              />
              <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[160px] z-50">
                {Object.entries(ROLE_LABELS).map(([role, label]) => (
                  <button
                    key={role}
                    onClick={() => { onViewModeChange(role); setOpen(false); }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
                      viewMode === role ? 'text-violet-700 font-medium bg-violet-50' : 'text-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {isImpersonating && (
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs opacity-75">
            Logged in as {realUser?.name}
          </span>
          <button
            onClick={onExitImpersonation}
            className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium"
          >
            <ArrowLeft size={12} />
            Exit Impersonation
          </button>
        </div>
      )}
    </div>
  );
}

function ProtectedLayout({ children, user, onLogout, viewMode, onViewModeChange, isImpersonating, onExitImpersonation, realUser, onImpersonate, primaryPersonaId }) {
  // Task #31 — Honor the user's "Sidebar default" appearance preference on
  // first paint AND when the async appearance load completes (so the
  // server-side preference wins over the cached default on a fresh device).
  // Applied on desktop too: when 'collapsed' the sidebar slides off-screen
  // and a hamburger reveals it.
  const { appearance, loading: settingsLoading } = useSettings();
  // Mobile defaults to closed regardless of preference (the drawer covers the
  // whole viewport so opening it on every load would block the page). On
  // desktop we honor the user's saved sidebar_default.
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) return false;
    return appearance?.sidebar_default !== 'collapsed';
  });
  // Desktop-only collapsed rail state. When true, the sidebar stays
  // visible at a narrow width showing only icons + 1-3 letter
  // abbreviations. Persisted across sessions in localStorage. Mobile
  // ignores this and uses the full drawer via `sidebarOpen`.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return safeReadJSON('sidebar_collapsed', false) === true;
  });
  // Track desktop breakpoint so the collapsed rail never leaks onto the
  // mobile drawer (which always renders full-width). Persistence stays
  // intact so the user's preference returns on a desktop viewport.
  const [isDesktop, setIsDesktop] = useState(() => {
    return typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e) => setIsDesktop(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else mq.removeListener(handler);
    };
  }, []);
  const effectiveCollapsed = isDesktop && sidebarCollapsed;
  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem('sidebar_collapsed', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const initialSyncRef = React.useRef(false);
  useEffect(() => {
    // One-shot sync the moment the SettingsProvider's first /appearance
    // round-trip resolves; subsequent toggles by the user are NOT
    // overridden because we flip the ref on the first run.
    if (initialSyncRef.current) return;
    if (settingsLoading) return;
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;
    setSidebarOpen(!isMobile && appearance?.sidebar_default !== 'collapsed');
    initialSyncRef.current = true;
  }, [settingsLoading, appearance?.sidebar_default]);
  // On desktop the sidebar should stay open during normal navigation —
  // only the user's explicit close button (or selecting "collapsed" in
  // Settings → Appearance) should hide it. On mobile, tapping any nav link
  // collapses the drawer so the page is visible.
  const closeOnMobileNav = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      setSidebarOpen(false);
    }
  }, []);
  const isAdmin = (realUser || user)?.role === 'admin';
  const activeRole = isImpersonating ? user?.role : (isAdmin ? viewMode : user?.role);
  const sidebarGroups = getSidebarGroups(activeRole || 'founder', primaryPersonaId, user);
  // While the founder is in the Spin-Out Lab the sidebar collapses to the
  // week-gated feature list. The standard nav returns the moment
  // `spinout_lab_active` flips back to 0 (Week 4 auto-exit).
  const inSpinoutLab = user?.spinout_lab_active === 1;

  // Auto-logout after 20 minutes of inactivity, with a 60-second warning modal.
  // Tracks mouse/keyboard/scroll/touch on `window`. Disabled when no user is
  // present (covers the brief render between logout and redirect).
  const { warningOpen, secondsLeft, stayLoggedIn, logoutNow } = useInactivityTimeout({
    timeoutMs: 20 * 60 * 1000,
    warningMs: 60 * 1000,
    enabled: !!user,
    onTimeout: onLogout,
  });

  return (
    <ViewModeContext.Provider value={{ viewMode: activeRole, isAdmin, isImpersonating }}>
      <div className="flex flex-col h-screen overflow-hidden bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
        {isAdmin && (
          <PortalSwitcher
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            isImpersonating={isImpersonating}
            onExitImpersonation={onExitImpersonation}
            realUser={realUser}
            impersonatedUser={isImpersonating ? user : null}
          />
        )}

        <div className="flex flex-1 overflow-hidden">
          <aside className={`
            fixed ${sidebarOpen ? 'lg:relative' : ''}
            inset-y-0 left-0 z-50 ${effectiveCollapsed ? 'w-20' : 'w-64'} bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800
            flex flex-col
            transform transition-transform duration-200
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:hidden'}
          `}>
            <div className={`flex items-center gap-2 ${effectiveCollapsed ? 'px-2 justify-center' : 'px-5'} py-4 border-b border-gray-200 dark:border-gray-800`}>
              <img src="/axal-mark.png" alt="Axal VC" className="h-8 w-8 rounded-lg object-cover flex-shrink-0" />
              {!effectiveCollapsed && (
                <div>
                  <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">Axal VC</div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400">StudioOS v1.0</div>
                </div>
              )}
              {!effectiveCollapsed && isAdmin && activeRole !== 'admin' && (
                <span className={`ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[activeRole]}`}>
                  {ROLE_LABELS[activeRole]} View
                </span>
              )}
              <button
                className={`${effectiveCollapsed ? '' : 'ml-auto'} hidden lg:inline-flex text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800`}
                onClick={toggleSidebarCollapsed}
                aria-label={effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!effectiveCollapsed}
                title={effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {effectiveCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
              </button>
              <button
                className="lg:hidden ml-auto text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close menu"
                title="Close menu"
              >
                <X size={18} />
              </button>
            </div>
            {inSpinoutLab ? (
              <SpinoutLabSidebar onNavigate={closeOnMobileNav} />
            ) : (
              <SidebarNav groups={sidebarGroups} role={activeRole || 'founder'} onNavigate={closeOnMobileNav} user={user} collapsed={effectiveCollapsed} />
            )}
            <div className={`${effectiveCollapsed ? 'px-2' : 'px-5'} py-3 border-t border-gray-200 dark:border-gray-800`}>
              {user && (
                effectiveCollapsed ? (
                  <div className="flex flex-col items-center gap-2">
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-600'}`}
                      title={`${user.name} — ${user.email}`}
                    >
                      {(user.name || user.email || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <button onClick={onLogout} className="text-gray-500 dark:text-gray-400 hover:text-red-500 transition-colors" title="Sign out" aria-label="Sign out">
                      <LogOut size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-gray-900 dark:text-gray-100 font-medium truncate">{user.name}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{user.email}</div>
                      <span className={`inline-block mt-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full ${ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-600'}`}>
                        {ROLE_LABELS[user.role] || user.role}
                      </span>
                    </div>
                    <button onClick={onLogout} className="text-gray-500 dark:text-gray-400 hover:text-red-500 transition-colors" title="Sign out">
                      <LogOut size={14} />
                    </button>
                  </div>
                )
              )}
            </div>
          </aside>

          {sidebarOpen && (
            <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
          )}

          <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
            <header className={`sticky top-0 z-30 bg-white/80 dark:bg-gray-900/80 backdrop-blur border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between gap-3 ${sidebarOpen ? 'lg:hidden' : ''}`}>
              <div className="flex items-center gap-2.5 lg:hidden">
                <img src="/axal-mark.png" alt="Axal VC" className="h-8 w-8 rounded-lg object-contain flex-shrink-0" />
                <div>
                  <div className="text-sm font-bold text-gray-900 dark:text-gray-100 leading-tight">Axal VC</div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">StudioOS v1.0</div>
                </div>
              </div>
              <div className="hidden lg:block flex-1">
                {isImpersonating && (
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                    Impersonating {user.name}
                  </span>
                )}
              </div>
              {isImpersonating && (
                <span className="lg:hidden text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                  Impersonating {user.name}
                </span>
              )}
              <div className="flex items-center gap-1 ml-auto">
                <NotificationBell userId={user?.id} />
                <button className="text-gray-600 dark:text-gray-300 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
                  <Menu size={20} />
                </button>
              </div>
            </header>
            <div data-app-main data-density-target className="p-4 md:p-6 max-w-7xl mx-auto">
              {children}
            </div>
          </main>
        </div>
      </div>
      <InactivityWarningModal
        open={warningOpen}
        secondsLeft={secondsLeft}
        onStay={stayLoggedIn}
        onLogout={logoutNow}
      />
      <CommandPalette />
      <HelpWidget />
      <KeyboardShortcutsOverlay />
      <InstallPrompt />
    </ViewModeContext.Provider>
  );
}

function RequireAuth({ user, children, onLogout, viewMode, onViewModeChange, isImpersonating, onExitImpersonation, realUser, onImpersonate }) {
  const location = useLocation();
  const [kycStatus, setKycStatus] = useState(user?.kyc_status || null);
  const [accessLevel, setAccessLevel] = useState(user?.access_level || null);
  const [primaryPersonaId, setPrimaryPersonaId] = useState(null);
  const [onboardingFlow, setOnboardingFlow] = useState(null);
  const [onboardingComplete, setOnboardingComplete] = useState(true);
  const [onboardingLoaded, setOnboardingLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await api.getMe();
        if (cancelled) return;
        setKycStatus(me.kyc_status || 'not_started');
        setAccessLevel(me.access_level || null);
        const stored = safeReadJSON('user', {});
        if (stored.kyc_status !== me.kyc_status || stored.access_level !== me.access_level) {
          localStorage.setItem('user', JSON.stringify({
            ...stored,
            kyc_status: me.kyc_status,
            access_level: me.access_level || null,
          }));
        }
      } catch {}
      try {
        const r = await api.getMyPersonas();
        if (cancelled) return;
        const primary = r?.personas?.find((p) => p.is_primary) || r?.personas?.[0];
        setPrimaryPersonaId(primary?.persona_id || null);
      } catch {}
      // Phase 0.2 / Task #23 — onboarding resume.
      // Fetch the per-user wizard progress so RequireAuth can redirect
      // unfinished users back to the right /onboarding/<role> step.
      try {
        const p = await api.onboardingGetProgress();
        if (cancelled) return;
        setOnboardingFlow(p?.flow || null);
        setOnboardingComplete(!!p?.completed_at);
        setOnboardingLoaded(true);
      } catch {
        // Endpoint missing or transient error — don't block login.
        if (!cancelled) {
          setOnboardingComplete(true);
          setOnboardingLoaded(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Task #66 — onboarding-chatbot gate.
  // Every new account (email + Google signup) gets an `onboarding_progress`
  // row written with `flow='chat'` and `completed_at=NULL` at signup time.
  // The profiling /save endpoint flips `completed_at` once the chatbot is
  // finished. While that row exists and is unfinished, this gate pins the
  // user to /onboarding/chat — accidentally clicking any sidebar link or
  // typing a URL directly bounces them back. This makes the chatbot the
  // single arbiter of role assignment.
  //
  // Bypassed for admins, impersonation sessions, and admin-granted
  // `access_level='limited'` accounts. Existing pre-Task-#66 users have no
  // chat row, so `onboardingFlow !== 'chat'` and this gate does nothing
  // for them.
  const onChatPath = location.pathname === '/onboarding/chat';
  if (
    onboardingLoaded &&
    onboardingFlow === 'chat' &&
    !onboardingComplete &&
    !onChatPath &&
    user.role !== 'admin' &&
    !isImpersonating &&
    accessLevel !== 'limited'
  ) {
    return <Navigate to="/onboarding/chat" replace />;
  }

  // Task #51 follow-up — fresh Google signups land on /onboarding/chat
  // via the auth_google callback redirect (newSignup branch). The users
  // row is created with role='partner' (CHECK-compliant default); admin
  // assigns the final role from partner_profiles review.

  // Phase 0.2 / Task #23 — wizard resume gate.
  // Roles that have a dedicated wizard land back on it until completion.
  // Admins are exempt; persona-only flows (/onboarding/persona) and the
  // wizard pages themselves are always reachable so the user can finish.
  // Two redirect cases:
  //   • brand-new user (no progress row → flow=null, completed=false)
  //   • returning user with a saved-but-incomplete row for their role
  // Cross-role rows (e.g. role-changed mid-flow) are ignored — those
  // users keep their default landing path until they re-enter onboarding.
  // Partners (including Mentor / Operator / Counsel / Technical / Liquidity
  // sub-personas that fold into role='partner' for the CHECK constraint)
  // onboard via the AI chatbot at /onboarding/chat — not the legacy
  // /onboarding/partner "Your firm" form. The chatbot saves the persona
  // into partner_profiles for admin review, which is everything the form
  // used to collect plus more. Founders and investors keep their existing
  // wizards (founders' 30-day Spin-Out Lab is gated separately via
  // users.spinout_lab_active and is unaffected by this map).
  const wizardForRole = { founder: '/onboarding/founder', investor: '/onboarding/investor' };
  const myWizard = wizardForRole[user.role];
  const onWizardPath = location.pathname.startsWith('/onboarding/');
  const needsWizard = !onboardingComplete && (onboardingFlow === null || onboardingFlow === user.role);
  if (
    myWizard &&
    !isImpersonating &&
    onboardingLoaded &&
    needsWizard &&
    !onWizardPath
  ) {
    return <Navigate to={myWizard} replace />;
  }

  // Onboarding gate: only investors must complete KYC before accessing other
  // pages. Founders, partners, and mentors do not require KYC at all — and
  // admins (or impersonation sessions) always bypass for support purposes.
  // Investor signing endpoints (capital actions, deal-flow gating) still
  // enforce KYC server-side regardless of this client-side gate.
  // The /kyc, /activity, /tickets routes remain reachable for everyone.
  const effectiveRole = (realUser || user)?.role;
  const ALLOWED_BEFORE_KYC = ['/kyc', '/activity', '/tickets'];
  // Onboarding wizards (/onboarding/*) are always reachable so the
  // wizard-resume gate above can land users without bouncing them to
  // /kyc — otherwise the two gates form a `/kyc` ↔ `/onboarding/<role>`
  // redirect loop for incomplete, not-yet-approved users.
  const onOnboardingPath = location.pathname.startsWith('/onboarding/');
  if (
    effectiveRole === 'investor' &&
    !isImpersonating &&
    accessLevel !== 'limited' &&
    kycStatus &&
    kycStatus !== 'approved' &&
    !ALLOWED_BEFORE_KYC.includes(location.pathname) &&
    !onOnboardingPath
  ) {
    return <Navigate to="/kyc" replace />;
  }

  // Task #66 — render the onboarding chatbot full-screen, without the
  // app sidebar / topbar. The chatbot must be the single visible surface
  // until the user finishes it; rendering it inside ProtectedLayout used
  // to expose sidebar nav links (notably "Identity Verification" → /kyc)
  // that an accidental click would follow, tripping the KYC gate before
  // the chat row's completed_at flipped.
  if (onChatPath) {
    return children;
  }

  return (
    <ProtectedLayout
      user={user}
      onLogout={onLogout}
      viewMode={viewMode}
      onViewModeChange={onViewModeChange}
      isImpersonating={isImpersonating}
      onExitImpersonation={onExitImpersonation}
      realUser={realUser}
      onImpersonate={onImpersonate}
      primaryPersonaId={primaryPersonaId}
    >
      {children}
    </ProtectedLayout>
  );
}

function RoleGuard({ user, allowedRoles, children, viewMode, realUser, isImpersonating }) {
  const effectiveRole = isImpersonating ? user?.role : ((realUser || user)?.role === 'admin' ? viewMode : user?.role);
  if (!allowedRoles.includes(effectiveRole)) {
    const defaultPath = ROLE_DEFAULT_PATH[effectiveRole] || '/dashboard';
    return <Navigate to={defaultPath} replace />;
  }
  return children;
}

function AppInner() {
  // T20 — `user` is now sourced from AuthContext (re-synced on every route
  // change, throttled to once per 5 min). The legacy component-level
  // useState was removed: anything that mutates the session (login,
  // impersonate, exit-impersonate, KYC submit) writes through
  // `setUser`/`refresh()` so context, localStorage, and the cross-tab
  // `storage` listener all stay in lock-step.
  const { user, setUser, refresh } = useAuth();

  const [realUser, setRealUser] = useState(() => safeReadJSON('realUser'));

  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('viewMode') || 'admin';
  });

  const isImpersonating = !!realUser;
  const navigate = useNavigate();

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem('viewMode', mode);
    const defaultPath = ROLE_DEFAULT_PATH[mode] || '/dashboard';
    navigate(defaultPath);
  };

  const handleImpersonate = (token, impersonatedUser) => {
    const currentUser = safeReadJSON('user');
    const currentToken = localStorage.getItem('token');
    localStorage.setItem('realUser', JSON.stringify(currentUser));
    localStorage.setItem('realToken', currentToken);
    setRealUser(currentUser);

    localStorage.setItem('token', token);
    setUser(impersonatedUser);
    setViewMode(impersonatedUser.role);
    localStorage.setItem('viewMode', impersonatedUser.role);
    navigate(ROLE_DEFAULT_PATH[impersonatedUser.role] || '/dashboard');
    // T20 — bypass the 5-min /me throttle so the impersonated session is
    // immediately reconciled against the server (KYC, access_level, etc.).
    refresh({ force: true });
  };

  const exitImpersonation = () => {
    const origToken = localStorage.getItem('realToken');
    const origUser = safeReadJSON('realUser');
    localStorage.setItem('token', origToken);
    localStorage.removeItem('realUser');
    localStorage.removeItem('realToken');
    setUser(origUser);
    setRealUser(null);
    setViewMode('admin');
    localStorage.setItem('viewMode', 'admin');
    navigate('/admin');
    // T20 — restore the real admin's freshest profile immediately rather
    // than wait for the next throttled re-sync.
    refresh({ force: true });
  };

  const logout = async () => {
    // T6 — call the server first so the httpOnly auth cookie is cleared and
    // the user_sessions row is revoked. Failures are non-fatal: the local
    // cleanup below still runs, so the user is always signed out client-side
    // even if the network call dies. Awaiting up to ~5s avoids the race
    // where the redirect below cancels an in-flight POST and leaves the
    // cookie set on the browser.
    try {
      await Promise.race([
        api.logout(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch (e) { /* logout must never block the UI sign-out */ }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('realUser');
    localStorage.removeItem('realToken');
    localStorage.removeItem('viewMode');
    // Sweep any per-tab sensitive state (drafts, in-flight wizards, etc.).
    try { sessionStorage.clear(); } catch (e) { /* ignore */ }
    setUser(null);
    setRealUser(null);
    window.location.href = '/';
  };

  // T20 — cross-tab `user` sync now lives inside AuthProvider; the
  // realUser mirror still lives here because it's only relevant to the
  // admin impersonation flow handled in this component.
  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === 'realUser') setRealUser(safeReadJSON('realUser'));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const authProps = {
    user, onLogout: logout, viewMode, onViewModeChange: handleViewModeChange,
    isImpersonating, onExitImpersonation: exitImpersonation, realUser, onImpersonate: handleImpersonate,
  };

  const guard = (roles, component) => (
    <RequireAuth {...authProps}>
      <RoleGuard user={user} allowedRoles={roles} viewMode={viewMode} realUser={realUser} isImpersonating={isImpersonating}>
        {component}
      </RoleGuard>
    </RequireAuth>
  );

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to={ROLE_DEFAULT_PATH[user.role] || '/dashboard'} replace /> : <LandingPage />} />
      <Route path="/spinout-lab" element={<SpinoutLabPage />} />
      <Route path="/pricing/investor" element={<InvestorPricingPage />} />
      <Route path="/register" element={user ? <Navigate to="/dashboard" replace /> : <RegisterPage />} />
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      {/* Task #50 — Lost-TOTP recovery. Catch-all subroute so /auth/recover,
          /auth/recover/email and /auth/recover/attest all land here. */}
      <Route path="/auth/recover" element={<RecoverPage />} />
      <Route path="/auth/recover/*" element={<RecoverPage />} />
      <Route path="/esign/:token" element={<ESignPage />} />
      {/* Task #9 (X-2) — Public token-gated partner onboarding wizard.
          Mounted at the path embedded in admin-emailed magic links AND a
          query-string variant for fallback share-by-link channels. */}
      <Route path="/partner-onboarding/:token" element={<PartnerOnboardPage />} />
      <Route path="/partners/onboard" element={<PartnerOnboardPage />} />
      <Route path="/settings/email/confirm" element={<EmailChangeConfirmPage />} />
      <Route path="/settings/email/revoke" element={<EmailChangeRevokePage />} />
      <Route path="/settings/:section" element={guard(['admin', 'founder', 'partner', 'investor', 'mentor'], <SettingsPage />)} />

      {/* Phase 0.1 — investor role added to every guard a partner currently
          passes. Investor-only nav is curated above (NAV_BY_ROLE.investor)
          so we get a tighter capital-allocator surface; per-route guards
          stay permissive so deep links keep working during the split. */}
      <Route path="/dashboard" element={guard(['admin', 'founder', 'partner', 'investor', 'mentor'], <Dashboard />)} />
      <Route path="/onboarding/chat" element={guard(['admin', 'founder', 'partner', 'investor', 'mentor', 'pending'], <OnboardingChatPage />)} />
      <Route path="/onboarding/persona" element={guard(['admin', 'founder', 'partner', 'investor'], <OnboardingPersonaPage />)} />
      <Route path="/onboarding/founder" element={guard(['admin', 'founder'], <OnboardingFounderPage />)} />
      <Route path="/onboarding/investor" element={guard(['admin', 'investor'], <OnboardingInvestorPage />)} />
      <Route path="/onboarding/partner" element={guard(['admin', 'partner'], <OnboardingPartnerPage />)} />
      <Route path="/build/brand" element={guard(['admin', 'founder'], <BrandBuilderPage />)} />
      <Route path="/build/deck" element={guard(['admin', 'founder'], <PitchDeckPage />)} />
      <Route path="/build/financials" element={guard(['admin', 'founder', 'partner', 'investor'], <FinancialsPage />)} />
      <Route path="/build/discovery" element={guard(['admin', 'founder', 'partner', 'investor'], <DiscoveryPage />)} />
      <Route path="/customer-discovery" element={guard(['admin', 'founder'], <CustomerDiscoveryPage />)} />
      <Route path="/build/roadmap" element={guard(['admin', 'founder', 'partner', 'investor'], <RoadmapPage />)} />
      <Route path="/build/metrics" element={guard(['admin', 'founder', 'partner', 'investor'], <MetricsPage />)} />
      <Route path="/build/captable" element={guard(['admin', 'founder', 'partner', 'investor'], <CapTablePage />)} />
      <Route path="/marketplace" element={guard(['admin', 'founder', 'partner', 'investor'], <MarketplacePage user={user} />)} />
      <Route path="/needs" element={guard(['admin', 'founder', 'partner', 'investor'], <NeedsBoardPage user={user} />)} />
      <Route path="/services" element={guard(['admin', 'founder', 'partner', 'investor'], <ServiceCatalogPage user={user} />)} />
      <Route path="/founder/post-need" element={guard(['admin', 'founder'], <NeedsBoardPage user={user} />)} />
      <Route path="/partner/needs" element={guard(['admin', 'partner'], <NeedsBoardPage user={user} />)} />
      <Route path="/partner/insights" element={guard(['admin', 'partner', 'investor'], <PartnerInsightsPage />)} />
      <Route path="/deck/:id/print" element={guard(['admin', 'founder', 'partner', 'investor'], <PitchDeckPrintPage />)} />
      <Route path="/deck/share/:token" element={<PitchDeckPrintPage shareMode />} />
      {/* Task #53 — canonical share URL per spec is /share/deck/<token>. */}
      <Route path="/share/deck/:token" element={<PitchDeckPrintPage shareMode />} />
      <Route path="/admin" element={guard(['admin'], <AdminPage onImpersonate={handleImpersonate} />)} />
      <Route path="/admin/trash" element={guard(['admin'], <AdminTrashPage />)} />
      <Route path="/admin/refer-earn" element={guard(['admin'], <AdminReferEarnPayouts />)} />
      <Route path="/admin/partners" element={guard(['admin'], <AdminPartnerInvitations />)} />
      <Route path="/admin/team" element={guard(['admin'], <AdminTeam />)} />
      <Route path="/admin/telegram" element={guard(['admin'], <AdminTelegram />)} />
      <Route path="/admin/x" element={guard(['admin'], <AdminX />)} />
      <Route path="/admin/news" element={guard(['admin'], <AdminNewsQueue />)} />
      <Route path="/news" element={guard(['admin', 'founder', 'partner', 'investor', 'mentor'], <NewsAuthorPage />)} />
      {/* Task #1 — Articles. Reader pages are public (no guard); author + admin gated. */}
      <Route path="/articles" element={<ArticlesPage />} />
      <Route path="/articles/draft" element={guard(['admin', 'founder', 'partner', 'investor', 'mentor', 'coach'], <ArticleAuthorPage />)} />
      <Route path="/articles/edit/:id" element={guard(['admin', 'founder', 'partner', 'investor', 'mentor', 'coach'], <ArticleAuthorPage />)} />
      <Route path="/admin/articles" element={guard(['admin'], <ArticlesQueuePage />)} />
      <Route path="/articles/:slug" element={<ArticleReaderPage />} />
      <Route path="/admin/publications" element={guard(['admin'], <AdminPublications />)} />
      <Route path="/admin/publications/new" element={guard(['admin'], <AdminPublicationNew />)} />
      <Route path="/admin/publications/:id" element={guard(['admin'], <AdminPublicationDetail />)} />
      <Route path="/insights/public/:slug" element={<PublicInsight />} />
      <Route path="/admin/due-diligence" element={guard(['admin', 'partner', 'investor', 'mentor'], <AdminDueDiligencePage />)} />
      <Route path="/admin/due-diligence/:uid" element={guard(['admin', 'partner', 'investor', 'mentor'], <AdminDueDiligenceCasePage />)} />
      <Route path="/scoring" element={guard(['admin', 'partner', 'investor'], <ScoringPage />)} />
      <Route path="/projects" element={guard(['admin', 'founder', 'partner', 'investor'], <ProjectsPage />)} />
      <Route path="/projects/:id" element={guard(['admin', 'founder', 'partner', 'investor'], <ProjectDetail />)} />
      <Route path="/legal" element={guard(['admin', 'founder'], <LegalPage />)} />
      <Route path="/incorporate" element={guard(['admin', 'founder', 'partner', 'investor'], <IncorporatePage />)} />
      <Route path="/incorporate/cofounder-agreement" element={guard(['admin', 'founder', 'partner'], <CofounderAgreementPage />)} />
      <Route path="/incorporate/83b" element={guard(['admin', 'founder', 'partner'], <Section83bPage />)} />
      <Route path="/compliance" element={guard(['admin', 'founder', 'partner'], <CompliancePage />)} />
      <Route path="/wellbeing" element={guard(['admin', 'founder'], <WellbeingPage />)} />
      <Route path="/partners" element={guard(['admin', 'partner', 'investor'], <PartnersPage />)} />
      <Route path="/capital" element={guard(['admin', 'investor'], <CapitalPage />)} />
      <Route path="/tickets" element={guard(['admin', 'founder', 'partner', 'investor', 'mentor'], <TicketsPage />)} />
      <Route path="/deals" element={guard(['admin', 'partner', 'investor'], <DealsPage />)} />
      <Route path="/market-intel" element={guard(['admin', 'partner', 'investor'], <MarketIntelPage />)} />
      <Route path="/advisory" element={guard(['admin', 'founder'], <AdvisoryPage />)} />
      <Route path="/mentors" element={guard(['admin', 'founder', 'partner', 'investor', 'mentor'], <MentorsPage />)} />
      <Route path="/office-hours" element={guard(['admin', 'mentor'], <OfficeHoursPage />)} />
      <Route path="/partner/office-hours" element={guard(['admin', 'partner'], <PartnerOfficeHoursPage />)} />
      <Route path="/comarketing" element={guard(['admin', 'partner', 'founder', 'investor'], <CoMarketingPage user={user} />)} />
      <Route path="/calendar" element={guard(['admin', 'founder', 'partner', 'investor', 'mentor'], <CalendarPage />)} />
      <Route path="/cofounder" element={guard(['admin', 'founder'], <CofounderPage />)} />
      <Route path="/portfolio/health" element={guard(['admin', 'founder', 'partner', 'investor'], <PortfolioHealthPage />)} />
      <Route path="/watchlist" element={guard(['admin', 'partner', 'investor'], <WatchlistJournalPage />)} />
      <Route path="/activity" element={guard(['admin', 'founder', 'partner', 'investor', 'mentor'], <ActivityPage />)} />
      <Route path="/kyc" element={guard(['admin', 'founder', 'partner', 'investor'], <KYCPage />)} />
      <Route path="/trust" element={guard(['admin', 'founder', 'partner', 'investor'], <TrustCenterPage />)} />
      <Route path="/api-bridge" element={guard(['admin'], <ApiBridgePage />)} />
      <Route path="/spinouts" element={guard(['admin', 'founder', 'partner', 'investor'], <SpinOutsPage />)} />
      {/* Friendly-URL alias: the canonical route is /spinouts (no hyphen),
          but users frequently type or link /spin-outs. Redirect instead of
          rendering a blank page. */}
      <Route path="/spin-outs" element={<Navigate to="/spinouts" replace />} />
      <Route path="/monitoring" element={guard(['admin'], <MonitoringPage />)} />
      <Route path="/liquidity" element={guard(['admin', 'founder', 'partner', 'investor'], <LiquidityPage currentUser={user} />)} />
      <Route path="/funds" element={guard(['admin', 'investor'], <FundsPage currentUser={user} />)} />
      <Route path="/portfolio/reserves" element={guard(['admin', 'investor'], <ReservesPage />)} />
      <Route path="/portfolio/waterfall" element={guard(['admin', 'investor'], <WaterfallPage />)} />
      <Route path="/founder" element={guard(['admin', 'founder'], <FounderPortal />)} />
      <Route path="/refer" element={guard(['admin', 'founder', 'partner', 'investor'], <ReferEarnPage />)} />
      <Route path="/integrations" element={guard(['admin', 'partner', 'investor'], <IntegrationsPage />)} />
      <Route path="/payouts" element={guard(['admin', 'founder', 'partner', 'investor'], <PayoutsPage />)} />
      <Route path="/network" element={guard(['admin', 'founder', 'partner', 'investor'], <NetworkPage />)} />
      <Route path="/matches" element={guard(['admin', 'partner', 'investor'], <MatchesPage />)} />
      <Route path="/studio-ops" element={guard(['admin', 'founder', 'partner', 'investor'], <StudioOpsPage />)} />
      <Route path="/network-effects" element={guard(['admin', 'founder', 'partner', 'investor'], <NetworkEffectsPage />)} />
      <Route path="/pipeline" element={guard(['admin', 'founder', 'partner', 'investor'], <PipelinePage />)} />
      <Route path="/relationships" element={guard(['admin', 'founder', 'partner', 'investor'], <RelationshipsPage />)} />
      <Route path="/legal-capital" element={guard(['admin', 'founder', 'partner', 'investor'], <LegalCapitalPage />)} />
      <Route path="/partner-portal" element={guard(['admin', 'partner', 'investor'], <PartnerPortal />)} />
      {/* Task #9 (X-2) — Deal-specific Partner Portal (referral code,
          granted tiers, redemption count). Distinct from the legacy
          /partner-portal which keeps the LP/capital-call surface. */}
      <Route path="/partners/portal" element={guard(['admin', 'partner'], <PartnerDealPortal />)} />
      {/* Task #2 (DD) — Direct-URL guard for admin docs. Non-admins
          (or anonymous visitors) hitting /docs/admin/* see a Not Found
          screen so the page literally pretends not to exist; admins are
          redirected into the hash-anchored docs surface. */}
      <Route path="/docs/admin/*" element={<AdminDocsPathGuard />} />
      <Route path="/docs" element={guard(['admin', 'founder', 'partner', 'investor', 'mentor'], <DocsPage />)} />
      <Route path="/settings" element={guard(['admin', 'founder', 'partner', 'investor', 'mentor'], <SettingsPage />)} />

      {/* Task #53 — Public partner directory + profiles (no auth). The
          static /partners route below takes precedence over /partners/:slug
          per React Router v6 path ranking, so authenticated users still
          land on the internal CRM at /partners. */}
      <Route path="/directory" element={<PublicDirectoryPage />} />
      <Route path="/partners/:slug" element={<PublicPartnerProfilePage />} />
      {/* Task #55 — Public profile pages, unauthenticated, role-tailored. */}
      <Route path="/u/:handle" element={<PublicProfilePage />} />

      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/risk-disclosures" element={<RiskDisclosuresPage />} />
      {/* Task #4 (ID) — Public marketing surfaces. No auth. */}
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/demo" element={<DemoPage />} />
      <Route path="/status" element={<StatusPage />} />
      <Route path="/changelog" element={<ChangelogPage />} />
      <Route path="/roadmap" element={<PublicRoadmapPage />} />
      <Route path="/academy/:slug" element={guard(['admin', 'founder', 'partner', 'investor'], <AcademyLessonPage />)} />
      <Route path="/academy" element={guard(['admin', 'founder', 'partner', 'investor'], <AcademyLessonPage />)} />
    </Routes>
  );
}

// Mount the assistant at the auth-shell level so it persists across
// route changes (Task #5: "pinned… persistent across pages"). The
// component itself fail-closes when assistant_enabled !== 1, so it's
// safe to render for unauthenticated users too.
function GlobalAssistantMount() {
  const { user } = useAuth();
  return <PersonalAssistant user={user} />;
}

// Task #6 — Mount the tier paywall once at the app shell so any 402
// `tier_required` response (or sidebar lock click) opens the same modal.
function GlobalPaywallMount() {
  const { user } = useAuth();
  return <PaywallModal user={user} />;
}

// Task #2 (DD) — Direct-URL guard for /docs/admin/* paths.
// Non-admins (and anonymous visitors) get a Not Found screen with no
// hint that admin docs exist. Admins are redirected to the hash-
// anchored docs surface (`/docs#admin/<sub>`), preserving the
// trailing path as the anchor's subsection id when present.
function AdminDocsPathGuard() {
  const { user, role, loading } = useAuth() || {};
  const location = useLocation();
  if (loading) return null;
  const isAdmin = !!user && role === 'admin';
  if (isAdmin) {
    const sub = location.pathname.replace(/^\/docs\/admin\/?/, '').split('/')[0] || 'overview';
    return <Navigate to={`/docs#admin/${encodeURIComponent(sub)}`} replace />;
  }
  return (
    <div className="max-w-xl mx-auto py-24 px-6 text-center">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Page not found</h1>
      <p className="text-sm text-gray-600">
        The page you’re looking for doesn’t exist. Head back to the{' '}
        <a className="text-violet-700 hover:underline" href="/docs">documentation home</a>.
      </p>
    </div>
  );
}

export default function App() {
  // T20 — AuthProvider must be inside <BrowserRouter> (it uses
  // useLocation to throttle /me re-syncs to one per route change).
  // main.jsx already wraps <App /> in BrowserRouter.
  return (
    <AuthProvider>
      <SettingsProvider>
        <AppInner />
        {/* Task #28 — global "always-on" mounts live OUTSIDE <Routes>,
            so a render-time throw inside any of them blanks the entire
            app (every route, including /login). Wrap each in a
            SafeMount error boundary so a regression in one widget
            degrades to "that one widget is missing" instead of "the
            whole app is gone". */}
        <SafeMount name="SpinoutLabListener"><SpinoutLabListener /></SafeMount>
        <SafeMount name="GlobalAssistantMount"><GlobalAssistantMount /></SafeMount>
        <SafeMount name="GlobalPaywallMount"><GlobalPaywallMount /></SafeMount>
      </SettingsProvider>
    </AuthProvider>
  );
}
