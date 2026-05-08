import React, { useState, useEffect, createContext, useContext } from 'react';
import { safeReadJSON } from './lib/storage';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuthSync';
import SpinoutLabListener from './components/SpinoutLabListener';
import {
  LayoutDashboard, Target, FileText, Users, DollarSign,
  Ticket, Menu, X, Zap, Handshake, Rocket, UserCircle,
  Globe, Brain, Activity, LogOut, Shield,
  ChevronDown, Eye, ArrowLeft, Code, ShieldCheck, Share2, Wallet, Network, Sparkles, Briefcase, TrendingUp, Layers, Scale, Plug, MessageSquare, Package, Lock, Calendar,
  Settings as SettingsIcon, PieChart as PieIcon, Heart, Bookmark, Megaphone, BookOpen
} from 'lucide-react';
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
import MarketIntelPage from './pages/MarketIntelPage';
import AdvisoryPage from './pages/AdvisoryPage';
import ActivityPage from './pages/ActivityPage';
import AdminPage from './pages/AdminPage';
import ApiBridgePage from './pages/ApiBridgePage';
import LandingPage from './pages/LandingPage';
import SpinoutLabPage from './pages/SpinoutLabPage';
import RegisterPage from './pages/RegisterPage';
import LoginPage from './pages/LoginPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
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
import MonitoringPage from './pages/MonitoringPage';
import LiquidityPage from './pages/LiquidityPage';
import FundsPage from './pages/FundsPage';
import ReservesPage from './pages/ReservesPage';
import WaterfallPage from './pages/WaterfallPage';
import SettingsPage from './pages/SettingsPage';
import DocsPage from './pages/DocsPage';
import OnboardingPersonaPage from './pages/OnboardingPersonaPage';
import AcademyLessonPage from './pages/AcademyLessonPage';
import OnboardingFounderPage from './pages/OnboardingFounderPage';
import OnboardingInvestorPage from './pages/OnboardingInvestorPage';
import OnboardingPartnerPage from './pages/OnboardingPartnerPage';
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
import InstallPrompt from './components/InstallPrompt';
import useInactivityTimeout from './hooks/useInactivityTimeout';

// Item shapes:
//   { to, icon, label }                         -> nav link
//   { section: 'Core' }                         -> section header
//   { divider: true }                           -> horizontal rule
const NAV_BY_ROLE = {
  admin: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/admin', icon: Shield, label: 'Admin Console' },

    { section: 'Core' },
    { to: '/projects', icon: Zap, label: 'Projects' },
    { to: '/pipeline', icon: Layers, label: 'Pipeline Board' },
    { to: '/studio-ops', icon: Briefcase, label: 'Studio Ops' },
    { to: '/spinouts', icon: Rocket, label: 'Spin-Outs' },

    { section: 'Intelligence' },
    { to: '/scoring', icon: Target, label: 'Scoring Engine' },
    { to: '/market-intel', icon: Globe, label: 'Market Intelligence' },
    { to: '/advisory', icon: Brain, label: 'AI Advisory Suite' },
    { to: '/matches', icon: Sparkles, label: 'AI Matches' },
    { to: '/deals', icon: Handshake, label: 'Deal Flow' },

    { section: 'Network' },
    { to: '/partners', icon: Users, label: 'Partners' },
    { to: '/refer', icon: Share2, label: 'Refer & Earn' },
    { to: '/relationships', icon: Handshake, label: 'Relationships' },
    { to: '/network-effects', icon: TrendingUp, label: 'Network Effects' },

    { section: 'Capital & Liquidity' },
    { to: '/capital', icon: DollarSign, label: 'Capital & Investment' },
    { to: '/liquidity', icon: TrendingUp, label: 'Liquidity & Exits' },
    { to: '/payouts', icon: Wallet, label: 'Payouts' },
    { to: '/portfolio/health', icon: Heart, label: 'Portfolio Health' },
    { to: '/portfolio/reserves', icon: Layers, label: 'Reserve Allocation' },
    { to: '/portfolio/waterfall', icon: TrendingUp, label: 'Exit Waterfall' },
    { to: '/watchlist', icon: Bookmark, label: 'Watchlist & Journal' },

    { section: 'Legal & Compliance' },
    { to: '/legal-capital', icon: Scale, label: 'Legal & Capital' },
    { to: '/incorporate', icon: Scale, label: 'Incorporate' },
    { to: '/incorporate/cofounder-agreement', icon: Users, label: 'Co-Founder Agreement' },
    { to: '/incorporate/83b', icon: Calendar, label: '83(b) Tracker' },
    { to: '/compliance', icon: Calendar, label: 'Compliance Calendar' },
    { to: '/trust', icon: Lock, label: 'Trust Center' },
    { to: '/wellbeing', icon: Heart, label: 'Founder Wellbeing' },

    { section: 'Advanced' },
    { to: '/monitoring', icon: Activity, label: 'Monitoring' },
    { to: '/activity', icon: Activity, label: 'Activity Log' },
    { to: '/tickets', icon: Ticket, label: 'Support' },
    { to: '/integrations', icon: Plug, label: 'Integrations' },
    { to: '/marketplace', icon: Briefcase, label: 'Marketplace' },
    { to: '/services', icon: Package, label: 'Service Catalogue' },
    { to: '/needs', icon: MessageSquare, label: 'Needs Board' },
    { to: '/partner/insights', icon: TrendingUp, label: 'Demand Insights' },
    { to: '/partner/office-hours', icon: Calendar, label: 'Partner Office Hours' },
    { to: '/comarketing', icon: Megaphone, label: 'Co-Marketing Review' },

    { section: 'Portals' },
    { to: '/founder', icon: Rocket, label: 'Founder Portal' },
    { to: '/partner-portal', icon: UserCircle, label: 'Partner / Investor Portal' },

    { divider: true },
    { to: '/docs', icon: BookOpen, label: 'Documentation' },
    { to: '/settings', icon: SettingsIcon, label: 'Settings' },
  ],

  founder: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },

    { section: 'Core' },
    { to: '/projects', icon: Zap, label: 'Projects' },
    { to: '/pipeline', icon: Layers, label: 'Pipeline Board' },
    { to: '/studio-ops', icon: Briefcase, label: 'Studio Ops' },
    { to: '/spinouts', icon: Rocket, label: 'Spin-Outs' },

    { section: 'Intelligence' },
    { to: '/advisory', icon: Brain, label: 'AI Advisory Suite' },
    { to: '/build/brand', icon: Sparkles, label: 'Brand & Landing' },
    { to: '/build/deck', icon: Sparkles, label: 'Pitch Deck' },
    { to: '/build/financials', icon: DollarSign, label: 'Financial Model' },
    { to: '/build/discovery', icon: MessageSquare, label: 'Customer Discovery' },
    { to: '/build/roadmap', icon: Layers, label: 'Roadmap' },
    { to: '/build/metrics', icon: TrendingUp, label: 'Metrics' },
    { to: '/build/captable', icon: PieIcon, label: 'Cap Table' },

    { section: 'Legal & Compliance' },
    { to: '/legal-capital', icon: Scale, label: 'Legal & Capital' },
    { to: '/incorporate', icon: Scale, label: 'Incorporate' },
    { to: '/incorporate/cofounder-agreement', icon: Users, label: 'Co-Founder Agreement' },
    { to: '/incorporate/83b', icon: Calendar, label: '83(b) Tracker' },
    { to: '/compliance', icon: Calendar, label: 'Compliance Calendar' },
    { to: '/trust', icon: Lock, label: 'Trust Center' },

    { section: 'Wellbeing' },
    { to: '/wellbeing', icon: Heart, label: 'Founder Wellbeing' },

    { section: 'Network & Growth' },
    { to: '/services', icon: Package, label: 'Service Catalogue' },
    { to: '/needs', icon: MessageSquare, label: 'Needs Board' },
    { to: '/refer', icon: Share2, label: 'Refer & Earn' },
    { to: '/relationships', icon: Handshake, label: 'Relationships' },
    { to: '/network-effects', icon: TrendingUp, label: 'Network Effects' },

    { section: 'Capital & Liquidity' },
    { to: '/liquidity', icon: TrendingUp, label: 'Liquidity & Exits' },
    { to: '/payouts', icon: Wallet, label: 'Payouts' },

    { section: 'Support' },
    { to: '/activity', icon: Activity, label: 'Activity Log' },
    { to: '/tickets', icon: Ticket, label: 'Support' },
    // KYC intentionally hidden from founders. Identity verification is only
    // mandatory at the moment a founder signs binding incorporation/SAFE
    // docs — the signing endpoints enforce that server-side and the eSign
    // page surfaces a banner with a link to /kyc when needed. The /kyc
    // route itself remains reachable by direct URL.

    { divider: true },
    { to: '/calendar', icon: Calendar, label: 'Calendar' },
    { to: '/cofounder', icon: Users, label: 'Find a Co-founder' },
    { to: '/mentors', icon: UserCircle, label: 'Find a Mentor' },
    { to: '/portfolio/health', icon: Heart, label: 'Portfolio Health' },
    { to: '/founder', icon: Rocket, label: 'Founder Portal', highlight: true },
    { to: '/docs', icon: BookOpen, label: 'Documentation' },
    { to: '/settings', icon: SettingsIcon, label: 'Settings' },
  ],

  partner: [
    { section: 'Intelligence' },
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/scoring', icon: Target, label: 'Scoring Engine' },
    { to: '/market-intel', icon: Globe, label: 'Market Intelligence' },
    { to: '/matches', icon: Sparkles, label: 'AI Matches' },
    { to: '/deals', icon: Handshake, label: 'Deal Flow' },

    { section: 'Core' },
    { to: '/projects', icon: Zap, label: 'Projects' },
    { to: '/pipeline', icon: Layers, label: 'Pipeline Board' },

    { section: 'Network' },
    { to: '/services', icon: Package, label: 'My Service Catalogue' },
    { to: '/needs', icon: MessageSquare, label: 'Needs Board' },
    { to: '/partners', icon: Users, label: 'Partners' },
    { to: '/partner/office-hours', icon: Calendar, label: 'My Office Hours' },
    { to: '/comarketing', icon: Megaphone, label: 'Co-Marketing' },
    { to: '/refer', icon: Share2, label: 'Refer & Earn' },
    { to: '/relationships', icon: Handshake, label: 'Relationships' },
    { to: '/network-effects', icon: TrendingUp, label: 'Network Effects' },

    { section: 'Capital & Liquidity' },
    // Phase 0.1 — /capital and /funds are investor-only LP surfaces; partners
    // see liquidity + payouts (their commission/exit surface).
    { to: '/liquidity', icon: TrendingUp, label: 'Liquidity & Exits' },
    { to: '/payouts', icon: Wallet, label: 'Payouts' },
    { to: '/portfolio/health', icon: Heart, label: 'Portfolio Health' },
    { to: '/watchlist', icon: Bookmark, label: 'Watchlist & Journal' },

    { section: 'Legal & Compliance' },
    { to: '/legal-capital', icon: Scale, label: 'Legal & Capital' },

    { section: 'Support' },
    { to: '/activity', icon: Activity, label: 'Activity Log' },
    { to: '/tickets', icon: Ticket, label: 'Support' },
    { to: '/kyc', icon: ShieldCheck, label: 'Identity Verification' },
    { to: '/trust', icon: Lock, label: 'Trust Center' },

    { divider: true },
    { to: '/calendar', icon: Calendar, label: 'Calendar' },
    { to: '/mentors', icon: UserCircle, label: 'Find a Mentor' },
    { to: '/partner-portal', icon: UserCircle, label: 'Partner Portal', highlight: true },
    { to: '/docs', icon: BookOpen, label: 'Documentation' },
    { to: '/settings', icon: SettingsIcon, label: 'Settings' },
  ],

  // Phase 0.1 — investor lane. Capital-allocator nav: scoring, deal flow,
  // matches, market intel, capital, liquidity, funds, legal-capital. No
  // partner-side payouts/relationships/refer surface — that's service-provider
  // territory.
  investor: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },

    { section: 'Intelligence' },
    { to: '/scoring', icon: Target, label: 'Scoring Engine' },
    { to: '/market-intel', icon: Globe, label: 'Market Intelligence' },
    { to: '/matches', icon: Sparkles, label: 'AI Matches' },
    { to: '/deals', icon: Handshake, label: 'Deal Flow' },

    { section: 'Pipeline' },
    { to: '/projects', icon: Zap, label: 'Projects' },
    { to: '/pipeline', icon: Layers, label: 'Pipeline Board' },

    { section: 'Capital & Liquidity' },
    { to: '/capital', icon: DollarSign, label: 'Capital & Investment' },
    { to: '/funds', icon: TrendingUp, label: 'Funds' },
    { to: '/liquidity', icon: TrendingUp, label: 'Liquidity & Exits' },
    { to: '/portfolio/health', icon: Heart, label: 'Portfolio Health' },
    { to: '/portfolio/reserves', icon: Layers, label: 'Reserve Allocation' },
    { to: '/portfolio/waterfall', icon: TrendingUp, label: 'Exit Waterfall' },
    { to: '/watchlist', icon: Bookmark, label: 'Watchlist & Journal' },

    { section: 'Legal & Compliance' },
    { to: '/legal-capital', icon: Scale, label: 'Legal & Capital' },
    { to: '/kyc', icon: ShieldCheck, label: 'Identity Verification' },
    { to: '/trust', icon: Lock, label: 'Trust Center' },

    { section: 'Support' },
    { to: '/activity', icon: Activity, label: 'Activity Log' },
    { to: '/tickets', icon: Ticket, label: 'Support' },

    { divider: true },
    { to: '/calendar', icon: Calendar, label: 'Calendar' },
    { to: '/mentors', icon: UserCircle, label: 'Find a Mentor' },
    { to: '/partner-portal', icon: UserCircle, label: 'Investor Portal', highlight: true },
    { to: '/docs', icon: BookOpen, label: 'Documentation' },
    { to: '/settings', icon: SettingsIcon, label: 'Settings' },
  ],

  // Task #35 — mentor lane. Manages own office hours + reviews mentees.
  mentor: [
    { to: '/office-hours', icon: Calendar, label: 'Office Hours', highlight: true },
    { to: '/calendar', icon: Calendar, label: 'Calendar' },
    { to: '/mentors', icon: UserCircle, label: 'Mentor Directory' },
    { section: 'Account' },
    { to: '/tickets', icon: Ticket, label: 'Support' },
    { to: '/activity', icon: Activity, label: 'Activity Log' },
    { divider: true },
    { to: '/calendar', icon: Calendar, label: 'Calendar' },
    { to: '/docs', icon: BookOpen, label: 'Documentation' },
    { to: '/settings', icon: SettingsIcon, label: 'Settings' },
  ],
};

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
};

const ViewModeContext = createContext(null);
export const useViewMode = () => useContext(ViewModeContext);

function getNavItems(role, primaryPersonaId) {
  const base = NAV_BY_ROLE[role] || NAV_BY_ROLE.founder;
  const persona = primaryPersonaId ? PERSONA_LOOKUP[primaryPersonaId] : null;
  if (!persona || !Array.isArray(persona.nav_extras) || persona.nav_extras.length === 0) {
    return base;
  }
  // Surface persona-specific deep-links above the divider, but skip ones the
  // role's nav already exposes so we never produce duplicate sidebar rows.
  const existingPaths = new Set(base.filter((i) => i.to).map((i) => i.to));
  const extras = persona.nav_extras.filter((e) => !existingPaths.has(e.to));
  if (extras.length === 0) return base;
  const dividerIdx = base.findIndex((i) => i.divider);
  const insertAt = dividerIdx === -1 ? base.length : dividerIdx;
  const personaSection = [
    { section: `For ${persona.label}` },
    ...extras.map((e) => ({ to: e.to, icon: Sparkles, label: e.label })),
  ];
  return [...base.slice(0, insertAt), ...personaSection, ...base.slice(insertAt)];
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
              <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isAdmin = (realUser || user)?.role === 'admin';
  const activeRole = isImpersonating ? user?.role : (isAdmin ? viewMode : user?.role);
  const navItems = getNavItems(activeRole || 'founder', primaryPersonaId);
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
      <div className="flex flex-col h-screen overflow-hidden bg-gray-50">
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
            fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200
            flex flex-col
            transform transition-transform duration-200
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            lg:relative lg:translate-x-0
          `}>
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-200">
              <img src="/axal-mark.png" alt="Axal VC" className="h-8 w-8 rounded-lg object-cover flex-shrink-0" />
              <div>
                <div className="font-semibold text-sm text-gray-900">Axal VC</div>
                <div className="text-[10px] text-gray-500">StudioOS v1.0</div>
              </div>
              {isAdmin && activeRole !== 'admin' && (
                <span className={`ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[activeRole]}`}>
                  {ROLE_LABELS[activeRole]} View
                </span>
              )}
              <button className="ml-auto lg:hidden text-gray-600" onClick={() => setSidebarOpen(false)}>
                <X size={18} />
              </button>
            </div>
            {inSpinoutLab ? (
              <SpinoutLabSidebar onNavigate={() => setSidebarOpen(false)} />
            ) : (
            <nav className="flex-1 py-3 overflow-y-auto">
              {navItems.map((item, idx) => {
                if (item.section) {
                  return (
                    <div
                      key={`section-${idx}`}
                      className="px-5 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400"
                    >
                      {item.section}
                    </div>
                  );
                }
                if (item.divider) {
                  return <div key={`divider-${idx}`} className="mx-5 my-2 border-t border-gray-200" />;
                }
                const { to, icon: Icon, label, highlight } = item;
                return (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-5 py-2 text-sm transition-colors ${
                        isActive
                          ? 'text-violet-600 bg-violet-50 border-r-2 border-violet-600'
                          : highlight
                            ? 'text-violet-700 font-medium bg-violet-50/60 hover:bg-violet-100'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                      }`
                    }
                  >
                    <Icon size={16} />
                    {label}
                  </NavLink>
                );
              })}
            </nav>
            )}
            <div className="px-5 py-3 border-t border-gray-200">
              {user && (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-gray-900 font-medium truncate">{user.name}</div>
                    <div className="text-[10px] text-gray-500 truncate">{user.email}</div>
                    <span className={`inline-block mt-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full ${ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-600'}`}>
                      {ROLE_LABELS[user.role] || user.role}
                    </span>
                  </div>
                  <button onClick={onLogout} className="text-gray-500 hover:text-red-500 transition-colors" title="Sign out">
                    <LogOut size={14} />
                  </button>
                </div>
              )}
            </div>
          </aside>

          {sidebarOpen && (
            <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
          )}

          <main className="flex-1 overflow-y-auto">
            <header className="lg:hidden sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-gray-200 px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 lg:hidden">
                <img src="/axal-mark.png" alt="Axal VC" className="h-8 w-8 rounded-lg object-contain flex-shrink-0" />
                <div>
                  <div className="text-sm font-bold text-gray-900 leading-tight">Axal VC</div>
                  <div className="text-[10px] text-gray-500 leading-tight">StudioOS v1.0</div>
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
              <NotificationBell userId={user?.id} />
              <button className="lg:hidden text-gray-600" onClick={() => setSidebarOpen(true)}>
                <Menu size={20} />
              </button>
            </header>
            <div className="p-4 md:p-6 max-w-7xl mx-auto">
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

  // Phase 0.2 / Task #23 — wizard resume gate.
  // Roles that have a dedicated wizard land back on it until completion.
  // Admins are exempt; persona-only flows (/onboarding/persona) and the
  // wizard pages themselves are always reachable so the user can finish.
  // Two redirect cases:
  //   • brand-new user (no progress row → flow=null, completed=false)
  //   • returning user with a saved-but-incomplete row for their role
  // Cross-role rows (e.g. role-changed mid-flow) are ignored — those
  // users keep their default landing path until they re-enter onboarding.
  const wizardForRole = { founder: '/onboarding/founder', investor: '/onboarding/investor', partner: '/onboarding/partner' };
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

  // Onboarding gate: non-admin users must complete KYC before accessing other pages.
  // Bypassed for:
  //   - admins (and impersonation sessions)
  //   - founders — KYC for founders is only mandatory at the moment they
  //     sign binding incorporation/SAFE docs; the signing endpoints enforce
  //     that server-side, and the eSign page shows a banner pointing to /kyc.
  //   - users with admin-granted `access_level === 'limited'`
  // The /kyc, /activity, /tickets routes remain reachable for everyone.
  const effectiveRole = (realUser || user)?.role;
  const ALLOWED_BEFORE_KYC = ['/kyc', '/activity', '/tickets'];
  // Onboarding wizards (/onboarding/*) are always reachable so the
  // wizard-resume gate above can land users without bouncing them to
  // /kyc — otherwise the two gates form a `/kyc` ↔ `/onboarding/<role>`
  // redirect loop for incomplete, not-yet-approved users.
  const onOnboardingPath = location.pathname.startsWith('/onboarding/');
  if (
    effectiveRole !== 'admin' &&
    effectiveRole !== 'founder' &&
    !isImpersonating &&
    accessLevel !== 'limited' &&
    kycStatus &&
    kycStatus !== 'approved' &&
    !ALLOWED_BEFORE_KYC.includes(location.pathname) &&
    !onOnboardingPath
  ) {
    return <Navigate to="/kyc" replace />;
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
      <Route path="/register" element={user ? <Navigate to="/dashboard" replace /> : <RegisterPage />} />
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/esign/:token" element={<ESignPage />} />
      <Route path="/settings/email/confirm" element={<EmailChangeConfirmPage />} />
      <Route path="/settings/email/revoke" element={<EmailChangeRevokePage />} />
      <Route path="/settings/:section" element={guard(['admin', 'founder', 'partner', 'investor', 'mentor'], <SettingsPage />)} />

      {/* Phase 0.1 — investor role added to every guard a partner currently
          passes. Investor-only nav is curated above (NAV_BY_ROLE.investor)
          so we get a tighter capital-allocator surface; per-route guards
          stay permissive so deep links keep working during the split. */}
      <Route path="/dashboard" element={guard(['admin', 'founder', 'partner', 'investor', 'mentor'], <Dashboard />)} />
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
      <Route path="/admin" element={guard(['admin'], <AdminPage onImpersonate={handleImpersonate} />)} />
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
      <Route path="/tickets" element={guard(['admin', 'founder', 'partner', 'investor'], <TicketsPage />)} />
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
      <Route path="/activity" element={guard(['admin', 'founder', 'partner', 'investor'], <ActivityPage />)} />
      <Route path="/kyc" element={guard(['admin', 'founder', 'partner', 'investor'], <KYCPage />)} />
      <Route path="/trust" element={guard(['admin', 'founder', 'partner', 'investor'], <TrustCenterPage />)} />
      <Route path="/api-bridge" element={guard(['admin'], <ApiBridgePage />)} />
      <Route path="/spinouts" element={guard(['admin', 'founder', 'partner', 'investor'], <SpinOutsPage />)} />
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
      <Route path="/docs" element={guard(['admin', 'founder', 'partner', 'investor', 'mentor'], <DocsPage />)} />
      <Route path="/settings" element={guard(['admin', 'founder', 'partner', 'investor'], <SettingsPage />)} />

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
      <Route path="/academy/:slug" element={guard(['admin', 'founder', 'partner', 'investor'], <AcademyLessonPage />)} />
      <Route path="/academy" element={guard(['admin', 'founder', 'partner', 'investor'], <AcademyLessonPage />)} />
    </Routes>
  );
}

export default function App() {
  // T20 — AuthProvider must be inside <BrowserRouter> (it uses
  // useLocation to throttle /me re-syncs to one per route change).
  // main.jsx already wraps <App /> in BrowserRouter.
  return (
    <AuthProvider>
      <AppInner />
      <SpinoutLabListener />
    </AuthProvider>
  );
}
