import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { safeReadJSON } from './lib/storage';
import { consumePendingNextOnce, markPendingNextRedirected, pendingNextRedirected } from './lib/pendingNext';
import { Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom';
import SidebarNav from './ui/SidebarNav';
import { AuthProvider, useAuth } from './hooks/useAuthSync';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import { ActiveCompanyContext } from './contexts/ActiveCompanyContext';
// ViewModeContext lives in its own module so App.jsx exports only React
// components — mixing component + hook exports breaks Vite Fast Refresh.
import ViewModeContext from './contexts/ViewModeContext';
// Single source of truth for "which role is this session browsing as". The
// shell picks the sidebar from it and the router picks route elements from it;
// when those two disagree the nav offers one thing and the route serves another.
import { resolveActiveRole } from './lib/activeRole';
const SpinoutLabListener = lazy(() => import('./components/SpinoutLabListener'));
import SafeMount from './components/SafeMount';
import CookieConsent from './components/CookieConsent';
import RouteErrorBoundary from './components/RouteErrorBoundary';
import {
  Menu,
  Shield,
  ChevronDown, Eye, ArrowLeft, Sparkles,
  Gift
} from 'lucide-react';
import { SIDEBAR_GROUPS, filterItemsByTier, hasInvestorTier } from './sidebarConfig';
import PaywallModal from './components/PaywallModal';
import { api } from './lib/api';
// Task #8 — NotFoundPage is imported eagerly (not lazy) so the catch-all 404
// renders synchronously on first paint. It marks itself a no-auth-redirect
// surface on mount; a lazy chunk could load AFTER the background settings 401
// returns, racing the flag and still bouncing logged-out visitors to /login.
import NotFoundPage from './pages/NotFoundPage';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ScoringPage = lazy(() => import('./pages/ScoringPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));

// The four workspace shells, rebuilt from the design canvases. The IA itself
// lives in src/workspaces/shellConfig.js — the sidebar, the zone nav and a
// guard test all read that one file, so a row can never advertise a door the
// router does not open.
const FounderValidateWorkspace = lazy(() => import('./workspaces/founder/FounderValidateWorkspace'));
const ResearchWorkspace = lazy(() => import('./workspaces/ResearchWorkspace'));
const InvestorDealsRoutes = lazy(() => import('./workspaces/investor/InvestorDealsRoutes'));
const AdvisorBucketRoutes = lazy(() => import('./workspaces/advisor/AdvisorBucketRoutes'));
const PartnerBucketRoutes = lazy(() => import('./workspaces/partner/PartnerBucketRoutes'));
const NetworkWorkspace = lazy(() => import('./workspaces/NetworkWorkspace'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const ExecutionPage = lazy(() => import('./pages/ExecutionPage'));
const PitchWorkspacePage = lazy(() => import('./pages/PitchWorkspacePage'));
const CapitalWorkspacePage = lazy(() => import('./pages/CapitalWorkspacePage'));
const LegalEnginePage = lazy(() => import('./pages/LegalEnginePage'));
const AcceptInvitePage = lazy(() => import('./pages/AcceptInvitePage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));
const IncorporatePage = lazy(() => import('./pages/IncorporatePage'));
const IncorporateSuccessPage = lazy(() => import('./pages/IncorporateSuccessPage'));
const CofounderAgreementPage = lazy(() => import('./pages/CofounderAgreementPage'));
const SpinoutLab83bPage = lazy(() => import('./pages/SpinoutLab83bPage'));
const SpinoutLabCompliancePage = lazy(() => import('./pages/SpinoutLabCompliancePage'));
const CompliancePage = lazy(() => import('./pages/CompliancePage'));
const WellbeingPage = lazy(() => import('./pages/WellbeingPage'));
const ExpertProfilePage = lazy(() => import('./pages/ExpertProfilePage'));
const ExpertEditorPage = lazy(() => import('./pages/ExpertEditorPage'));
const PartnersPage = lazy(() => import('./pages/PartnersPage'));
const CapitalPage = lazy(() => import('./pages/CapitalPage'));
const TicketsPage = lazy(() => import('./pages/TicketsPage'));
const DealsPage = lazy(() => import('./pages/DealsPage'));
const DealRoomPage = lazy(() => import('./pages/DealRoomPage'));
const PartnerPortal = lazy(() => import('./pages/PartnerPortal'));
const PartnerDealPortal = lazy(() => import('./pages/PartnerDealPortal'));
const PartnerOnboardPage = lazy(() => import('./pages/PartnerOnboardPage'));
const AdminPartnerInvitations = lazy(() => import('./pages/admin/PartnerInvitations'));
const AdminPublications = lazy(() => import('./pages/admin/Publications'));
const AdminEventsPage = lazy(() => import('./pages/admin/AdminEventsPage'));
const AdminJobsPage = lazy(() => import('./pages/admin/AdminJobsPage'));
const AdminCirclesPage = lazy(() => import('./pages/admin/AdminCirclesPage'));
const AdminTeam = lazy(() => import('./pages/admin/AdminTeam'));
// Task #9 — 'exploring' holding-state surfaces.
const ExploringDashboard = lazy(() => import('./pages/ExploringDashboard'));
const AdminExploring = lazy(() => import('./pages/admin/AdminExploring'));
const AdminLpApplications = lazy(() => import('./pages/admin/AdminLpApplications'));
const AdminLicences = lazy(() => import('./pages/admin/AdminLicences'));
const AdminNetworkProfiles = lazy(() => import('./pages/admin/AdminNetworkProfiles'));
// Task #102 — Spin-Out Lab admin dashboard (applications + participants).
const AdminSpinoutLab = lazy(() => import('./pages/admin/AdminSpinoutLab'));
const AdminSpinoutJourneyPreview = lazy(() => import('./pages/admin/AdminSpinoutJourneyPreview'));
const AdminTelegram = lazy(() => import('./pages/admin/AdminTelegram'));
const AdminX = lazy(() => import('./pages/admin/AdminX'));
// Task #3 — Assessment admin authoring + analytics surface.
const AdminAssessment = lazy(() => import('./pages/admin/assessment/AdminAssessmentPage'));
// Task #1 — Articles surfaces (public + author + admin queue).
const ArticlesPage = lazy(() => import('./pages/ArticlesPage'));
const ArticleReaderPage = lazy(() => import('./pages/ArticleReaderPage'));
const ArticleAuthorPage = lazy(() => import('./pages/ArticleAuthorPage'));
const AuthorProfilePage = lazy(() => import('./pages/AuthorProfilePage'));
const ArticlesQueuePage = lazy(() => import('./pages/admin/ArticlesQueuePage'));
const AdminPublicationNew = lazy(() => import('./pages/admin/PublicationNew'));
const AdminPublicationDetail = lazy(() => import('./pages/admin/PublicationDetail'));
const PublicInsight = lazy(() => import('./pages/insights/PublicInsight'));
const InsightsPage = lazy(() => import('./pages/insights/InsightsPage'));
const MarketIntelPage = lazy(() => import('./pages/MarketIntelPage'));
const AdvisoryPage = lazy(() => import('./pages/AdvisoryPage'));
const ActivityPage = lazy(() => import('./pages/ActivityPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const AdminTrashPage = lazy(() => import('./pages/AdminTrashPage'));
const AdminReferralReview = lazy(() => import('./pages/admin/ReferralReview'));
const ReferralsPage = lazy(() => import('./pages/ReferralsPage'));
const CompanySettingsPage = lazy(() => import('./pages/CompanySettingsPage'));
const AdminDueDiligencePage = lazy(() => import('./pages/AdminDueDiligencePage'));
const AdminDueDiligenceCasePage = lazy(() => import('./pages/AdminDueDiligenceCasePage'));
const DueDiligenceRequestsPage = lazy(() => import('./pages/DueDiligenceRequestsPage'));
const SharedCapTablePage = lazy(() => import('./pages/SharedCapTablePage'));
const ApiBridgePage = lazy(() => import('./pages/ApiBridgePage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const SpinoutLabPage = lazy(() => import('./pages/SpinoutLabPage'));
// The investor journey's two pages. Separate lazy imports (rather than reaching
// the workspace through FundOpsWorkspace) so /spinout-lab and
// /spinout-lab/investor-workspace serve them directly without pulling the whole
// Fund Ops shell — and so a founder never downloads either chunk.
const SpinoutLabInvestorPage = lazy(() => import('./pages/SpinoutLabInvestorPage'));
const InvestorWorkspacePage = lazy(() => import('./pages/investor/InvestorWorkspacePage'));
const InvestorFundLanding = lazy(() => import('./pages/investor/InvestorFundLanding'));
const InvestorFundLPs = lazy(() => import('./pages/investor/InvestorFundLPs'));
const InvestorFundCalls = lazy(() => import('./pages/investor/InvestorFundCalls'));
const InvestorFundAccounting = lazy(() => import('./pages/investor/InvestorFundAccounting'));
const InvestorFundReporting = lazy(() => import('./pages/investor/InvestorFundReporting'));
const InvestorNetworkWorkspace = lazy(() => import('./pages/investor/InvestorNetworkWorkspace'));
const InvestorResearchWorkspace = lazy(() => import('./pages/investor/InvestorResearchWorkspace'));
const SpinoutLabStartupPage = lazy(() => import('./pages/SpinoutLabStartupPage'));
const SpinoutLabDiscoveryPage = lazy(() => import('./pages/SpinoutLabDiscoveryPage'));
const SpinoutLabMarketPage = lazy(() => import('./pages/SpinoutLabMarketPage'));
const SpinoutLabRoadmapPage = lazy(() => import('./pages/SpinoutLabRoadmapPage'));
const SpinoutLabProfilingPage = lazy(() => import('./pages/SpinoutLabProfilingPage'));
const SpinoutLabScoringPage = lazy(() => import('./pages/SpinoutLabScoringPage'));
const SpinoutLabAdvisorsPage = lazy(() => import('./pages/SpinoutLabAdvisorsPage'));
const SpinoutLabRevenuePage = lazy(() => import('./pages/SpinoutLabRevenuePage'));
const SpinoutLabUseOfFundsPage = lazy(() => import('./pages/SpinoutLabUseOfFundsPage'));
const SpinoutLabIncorporatePage = lazy(() => import('./pages/SpinoutLabIncorporatePage'));
const SpinoutLabCapitalPage = lazy(() => import('./pages/SpinoutLabCapitalPage'));
const SpinoutLabCapTablePage = lazy(() => import('./pages/SpinoutLabCapTablePage'));
const SpinoutLabPitchDeckPage = lazy(() => import('./pages/SpinoutLabPitchDeckPage'));
const SpinoutLabBrandPage = lazy(() => import('./pages/SpinoutLabBrandPage'));
const SpinoutLabOfficeHoursPage = lazy(() => import('./pages/SpinoutLabOfficeHoursPage'));
const SpinoutLabCofounderAgreementPage = lazy(() => import('./pages/SpinoutLabCofounderAgreementPage'));
const SpinoutLabCofounderMatchPage = lazy(() => import('./pages/SpinoutLabCofounderMatchPage'));
const SpinoutLabCertificatePage = lazy(() => import('./pages/SpinoutLabCertificatePage'));
const SpinoutLabApplyPage = lazy(() => import('./pages/SpinoutLabApplyPage'));
const SpinoutLabBriefPage = lazy(() => import('./pages/SpinoutLabBriefPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const NetworkIntroReviewPage = lazy(() => import('./pages/NetworkIntroReviewPage'));
const RecoverPage = lazy(() => import('./pages/RecoverPage'));
const ESignPage = lazy(() => import('./pages/ESignPage'));
// Send for signature — the non-admin origination page. POST /legal/esign/send
// stopped being admin-only in task #156; this is the UI that finally matches.
const SendForSignaturePage = lazy(() => import('./pages/legal/SendForSignaturePage'));
// The subsidiary administrator's read of their own territory licence.
// Migration 190 made "which licence is this admin's?" answerable at all.
const MyLicencePage = lazy(() => import('./pages/subsidiary/MyLicencePage'));
const KYCPage = lazy(() => import('./pages/KYCPage'));
const TrustCenterPage = lazy(() => import('./pages/TrustCenterPage'));
const AdvisorsPage = lazy(() => import('./pages/AdvisorsPage'));
const OfficeHoursPage = lazy(() => import('./pages/OfficeHoursPage'));
const PartnerOfficeHoursPage = lazy(() => import('./pages/PartnerOfficeHoursPage'));
const CoMarketingPage = lazy(() => import('./pages/CoMarketingPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
// Task #40 (E2) — Event host/attendee surface.
const MyEventsPage = lazy(() => import('./pages/events/MyEventsPage'));
const EventEditorPage = lazy(() => import('./pages/events/EventEditorPage'));
const EventManagePage = lazy(() => import('./pages/events/EventManagePage'));
const MyJobsPage = lazy(() => import('./pages/jobs/MyJobsPage'));
const JobEditorPage = lazy(() => import('./pages/jobs/JobEditorPage'));
const JobManagePage = lazy(() => import('./pages/jobs/JobManagePage'));
const MyApplicationsPage = lazy(() => import('./pages/jobs/MyApplicationsPage'));
const CofounderPage = lazy(() => import('./pages/CofounderPage'));
// Team Building — founder workspace consolidating Advisor, Co-Founder
// and Jobs into one tabbed page at /build/team.
const TeamBuildingPage = lazy(() => import('./pages/TeamBuildingPage'));
// Task #20 — /skills and /values are consolidated into the advisor flow.
// The underlying SkillsProfilePage/ValuesAssessmentPage files are kept intact on
// disk (data stores), but their routes now redirect to /studio.
const AdminBestFitPage = lazy(() => import('./pages/admin/AdminBestFitPage'));
const PortfolioCoveragePage = lazy(() => import('./pages/PortfolioCoveragePage'));
const RiskMatrixPage = lazy(() => import('./pages/RiskMatrixPage'));
const WatchlistJournalPage = lazy(() => import('./pages/WatchlistJournalPage'));
const MatchesPage = lazy(() => import('./pages/MatchesPage'));
const NetworkEffectsPage = lazy(() => import('./pages/NetworkEffectsPage'));
const NetworkPage = lazy(() => import('./pages/NetworkPage'));
const LegalCapitalPage = lazy(() => import('./pages/LegalCapitalPage'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const TeamPage = lazy(() => import('./pages/TeamPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const RiskDisclosuresPage = lazy(() => import('./pages/RiskDisclosuresPage'));
// Task #5 — Public event surface.
const PublicEventsPage = lazy(() => import('./pages/events/PublicEventsPage'));
const PublicEventDetailPage = lazy(() => import('./pages/events/PublicEventDetailPage'));
const InviteRsvpPage = lazy(() => import('./pages/events/InviteRsvpPage'));
const PublicJobsPage = lazy(() => import('./pages/jobs/PublicJobsPage'));
const PublicJobDetailPage = lazy(() => import('./pages/jobs/PublicJobDetailPage'));
// Task #4 (ID) — Public marketing surfaces.
const PricingPage = lazy(() => import('./pages/PricingPage'));
// Products — in-house catalog + checkout + explorer promo redemption.
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
// Products one-time cart checkout + post-checkout confirmation.
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const CheckoutConfirmationPage = lazy(() => import('./pages/CheckoutConfirmationPage'));
// Audience product pages (For Founders / Investors & LPs / Service Partners /
// Advisors) — one data-driven component rendered per slug from
// data/productPages.js; footer links live in components/PublicFooter.jsx.
const ProductAudiencePage = lazy(() => import('./pages/ProductAudiencePage'));
const DemoPage = lazy(() => import('./pages/DemoPage'));
const StatusPage = lazy(() => import('./pages/StatusPage'));
const ChangelogPage = lazy(() => import('./pages/ChangelogPage'));
const PublicRoadmapPage = lazy(() => import('./pages/PublicRoadmapPage'));
const PublicCertificateVerifyPage = lazy(() => import('./pages/PublicCertificateVerifyPage'));
const MonitoringPage = lazy(() => import('./pages/MonitoringPage'));
const LiquidityPage = lazy(() => import('./pages/LiquidityPage'));
const FundOpsWorkspace = lazy(() => import('./pages/FundOpsWorkspace'));
const PortfolioWorkspace = lazy(() => import('./pages/PortfolioWorkspace'));
const PipelineWorkspace = lazy(() => import('./pages/PipelineWorkspace'));
const FundModelingWorkspace = lazy(() => import('./pages/FundModelingWorkspace'));
const LPPortalPage = lazy(() => import('./pages/LPPortalPage'));
const InvestorPricingPage = lazy(() => import('./pages/InvestorPricingPage'));
const ICDecisionsPage = lazy(() => import('./pages/ICDecisionsPage'));
const ICDecisionPage = lazy(() => import('./pages/ICDecisionPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const DocsPage = lazy(() => import('./pages/DocsPage'));
const OnboardingPersonaPage = lazy(() => import('./pages/OnboardingPersonaPage'));
const AcademyLessonPage = lazy(() => import('./pages/AcademyLessonPage'));
const OnboardingFounderPage = lazy(() => import('./pages/OnboardingFounderPage'));
// Template landing pages — audience-specific conversion surfaces.
const FounderHomePage = lazy(() => import('./pages/templates/FounderHomePage'));
const CustomerDiscoveryHomePage = lazy(() => import('./pages/templates/CustomerDiscoveryHomePage'));
const InvestorDealflowHomePage = lazy(() => import('./pages/templates/InvestorDealflowHomePage'));
const PartnerPartnershipHomePage = lazy(() => import('./pages/templates/PartnerPartnershipHomePage'));
const SpinoutDemoDayPage = lazy(() => import('./pages/templates/SpinoutDemoDayPage'));
const OnboardingInvestorPage = lazy(() => import('./pages/OnboardingInvestorPage'));
const OnboardingPartnerPage = lazy(() => import('./pages/OnboardingPartnerPage'));
const OnboardingChatPage = lazy(() => import('./pages/OnboardingChatPage'));
const BrandBuilderPage = lazy(() => import('./pages/BrandBuilderPage'));
const CompetitorAnalysisPage = lazy(() => import('./pages/CompetitorAnalysisPage'));
const FinancialsPage = lazy(() => import('./pages/FinancialsPage'));
const DiscoveryPage = lazy(() => import('./pages/DiscoveryPage'));
const RoadmapPage = lazy(() => import('./pages/RoadmapPage'));
const MetricsPage = lazy(() => import('./pages/MetricsPage'));
const SignalsPage = lazy(() => import('./pages/SignalsPage'));
const CapTablePage = lazy(() => import('./pages/CapTablePage'));
const DataRoomPage = lazy(() => import('./pages/raise/DataRoomPage'));
const MessagesPage = lazy(() => import('./pages/MessagesPage'));
const PerksPage = lazy(() => import('./pages/PerksPage'));
const FounderMarketplacePage = lazy(() => import('./pages/FounderMarketplacePage'));
const NeedsBoardPage = lazy(() => import('./pages/NeedsBoardPage'));
// Wraps the Pipeline/Offers pages in the tab bar that lets those shell rows
// own their sections. Role-filtered — see PartnerWorkspaceTabs.jsx.
const PartnerWorkspaceTabs = lazy(() => import('./pages/partner/PartnerWorkspaceTabs'));
// The Founder shell's five workspace rows (Validate, Build, Raise, Grow,
// Research) own their sections through this bar. Role- and tier-filtered —
// see FounderWorkspaceTabs.jsx.
const FounderWorkspaceTabs = lazy(() => import('./pages/founder/FounderWorkspaceTabs'));
const FounderWorkspacePage = lazy(() => import('./pages/founder/FounderWorkspacePage'));
const FounderValidatePage = lazy(() => import('./pages/founder/FounderValidatePage'));
const FounderBuildDesk = lazy(() => import('./pages/founder/FounderBuildDesk'));
const FounderBuildBoard = lazy(() => import('./pages/founder/FounderBuildBoard'));
const FounderBuildThisWeek = lazy(() => import('./pages/founder/FounderBuildThisWeek'));
const FounderBuildRoadmap = lazy(() => import('./pages/founder/FounderBuildRoadmap'));
const FounderBuildKpi = lazy(() => import('./pages/founder/FounderBuildKpi'));
const FounderBuildCadence = lazy(() => import('./pages/founder/FounderBuildCadence'));
const FounderRaiseDesk = lazy(() => import('./pages/founder/FounderRaiseDesk'));
const FounderRaisePitch = lazy(() => import('./pages/founder/FounderRaisePitch'));
const FounderRaiseStatus = lazy(() => import('./pages/founder/FounderRaiseStatus'));
const FounderRaiseCapital = lazy(() => import('./pages/founder/FounderRaiseCapital'));
const FounderRaiseLegal = lazy(() => import('./pages/founder/FounderRaiseLegal'));
const FounderRaiseDataRoom = lazy(() => import('./pages/founder/FounderRaiseDataRoom'));
const FounderRaiseLiquidity = lazy(() => import('./pages/founder/FounderRaiseLiquidity'));
const FounderGrowDesk = lazy(() => import('./pages/founder/FounderGrowDesk'));
const FounderGrowFocus = lazy(() => import('./pages/founder/FounderGrowFocus'));
const FounderGrowTalent = lazy(() => import('./pages/founder/FounderGrowTalent'));
const FounderGrowCustomers = lazy(() => import('./pages/founder/FounderGrowCustomers'));
const FounderGrowPartnerships = lazy(() => import('./pages/founder/FounderGrowPartnerships'));
const FounderGrowCapitalMatch = lazy(() => import('./pages/founder/FounderGrowCapitalMatch'));
const FounderGrowBrand = lazy(() => import('./pages/founder/FounderGrowBrand'));
const FounderGrowLaunch = lazy(() => import('./pages/founder/FounderGrowLaunch'));
const FounderNetworkDesk = lazy(() => import('./pages/founder/FounderNetworkDesk'));
const FounderNetworkRelationships = lazy(() => import('./pages/founder/FounderNetworkRelationships'));
const FounderNetworkIntroductions = lazy(() => import('./pages/founder/FounderNetworkIntroductions'));
const FounderNetworkOrganizations = lazy(() => import('./pages/founder/FounderNetworkOrganizations'));
const FounderResearchDesk = lazy(() => import('./pages/founder/FounderResearchDesk'));
const ServiceCatalogPage = lazy(() => import('./pages/ServiceCatalogPage'));
const PartnerInsightsPage = lazy(() => import('./pages/PartnerInsightsPage'));
const PublicDirectoryPage = lazy(() => import('./pages/PublicDirectoryPage'));
const CirclesPage = lazy(() => import('./pages/CirclesPage'));
const PublicPartnerProfilePage = lazy(() => import('./pages/PublicPartnerProfilePage'));
const PublicProfilePage = lazy(() => import('./pages/PublicProfilePage'));
const PublicStartupProfilePage = lazy(() => import('./pages/PublicStartupProfilePage'));
const PitchDeckPrintPage = lazy(() => import('./pages/PitchDeckPrintPage'));
import { PERSONA_BY_ID as PERSONA_LOOKUP } from './lib/personas';
const EmailChangeConfirmPage = lazy(() => import('./pages/EmailChangeConfirmPage'));
const EmailChangeRevokePage = lazy(() => import('./pages/EmailChangeRevokePage'));
// Advisor sections shell — tabbed workspaces (Network, Advisory, Research).
const AdvisorAdvisoryWorkspace = lazy(() => import('./pages/advisor/advisory/AdvisorAdvisoryWorkspace'));
const AdvisorExpertiseWorkspace = lazy(() => import('./pages/advisor/AdvisorExpertiseWorkspace'));
// Partner Operations shell — tabbed workspace (Overview, Capabilities, Portfolio,
// Engagements, Performance).
const PartnerOperationsWorkspace = lazy(() => import('./pages/partner/operations/PartnerOperationsWorkspace'));
// Authenticated-shell widgets — lazy so they leave the entry chunk. They only
// ever render inside ProtectedLayout (logged-in users), so a logged-out visitor
// hitting the landing page never downloads them. Each render site below is
// wrapped in its own <Suspense fallback> so fetching a chunk can't blank the app.
const InactivityWarningModal = lazy(() => import('./components/InactivityWarningModal'));
const NotificationBell = lazy(() => import('./components/NotificationBell'));
const FounderWellbeingMenu = lazy(() => import('./components/FounderWellbeingMenu'));
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const StepUpModal = lazy(() => import('./components/StepUpModal'));
const InstallPrompt = lazy(() => import('./components/InstallPrompt'));
const KeyboardShortcutsOverlay = lazy(() => import('./components/KeyboardShortcutsOverlay'));
import useInactivityTimeout from './hooks/useInactivityTimeout';

// Phase B · Prompt 5 — sidebar groups now live in `frontend/src/sidebarConfig.js`.

const ROLE_LABELS = {
  admin: 'Admin',
  founder: 'Founder',
  partner: 'Partner',
  investor: 'Investor',
  advisor: 'Advisor',
  // Task #9 — chat-onboarded holding state awaiting admin role review.
  exploring: 'Exploring',
};

const ROLE_COLORS = {
  admin: 'bg-violet-100 text-violet-700',
  founder: 'bg-blue-100 text-blue-700',
  partner: 'bg-emerald-100 text-emerald-700',
  investor: 'bg-purple-100 text-purple-700',
  advisor: 'bg-amber-100 text-amber-700',
  exploring: 'bg-sky-100 text-sky-700',
};

const ROLE_DEFAULT_PATH = {
  admin: '/studio',
  // Founders land on Studio directly, avoiding an extra redirect hop on
  // login/root navigation.
  founder: '/studio',
  partner: '/studio',
  investor: '/studio',
  advisor: '/studio',
  // Task #51 follow-up — fresh Google signups land with role='pending' until
  // the onboarding chatbot classifies them. The pending-gate in RequireAuth
  // pins them to /onboarding/chat, but this default keeps any stray
  // role-lookup (e.g. landing-page fallback) from 404-ing them out.
  pending: '/onboarding/chat',
  // Task #9 — chat-completed users hold at 'exploring' until an admin signs
  // them in via the binding agreement + assigns the final role. RoleGuard
  // bounces them here from any route their role can't access.
  exploring: '/exploring',
};

// Legacy /dashboard → /studio. Preserve the query string and hash so old links
// and server-driven OAuth callbacks (?google=ok, ?advisor=1, ?profile_pending=1)
// keep working after the rename.
function DashboardRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: '/studio', search: loc.search, hash: loc.hash }} replace />;
}

// Legacy /refer redirects to the standalone /referrals page, preserving ?tab=.
function ReferRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: '/referrals', search: loc.search }} replace />;
}

// Integrations merged into Settings. Legacy /integrations (and
// /integrations?... from OAuth callbacks / existing links) redirects into the
// Settings "Integrations" section, preserving the query string so post-connect
// success/error states still render on the tile that owns them.
function IntegrationsRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: '/settings/integrations', search: loc.search }} replace />;
}


/**
 * The shell a super admin sees.
 *
 * `super_admin` is an elevation on `admin` rather than a role beside it
 * (migration 199), so `user.role` is still `'admin'` here and the shell has to
 * be chosen on the flag. Only when the caller is genuinely acting as an admin:
 * an admin using the "view as" switch to check a founder's experience must get
 * the FOUNDER shell, or the switch shows them their own console back.
 */
function shellRoleFor(role, user) {
  return role === 'admin' && Number(user?.is_super_admin ?? 0) === 1 ? 'super_admin' : role;
}

function getSidebarGroups(role, primaryPersonaId, user) {
  const base = SIDEBAR_GROUPS[shellRoleFor(role, user)] || SIDEBAR_GROUPS.founder;
  // Apply tier gating per group (stub passes everything through today;
  // Phase C will swap `hasTier` for the real subscription check).
  const groups = base
    .map((g) => ({ ...g, items: filterItemsByTier(g.items) }))
    .filter((g) => (g.items || []).length > 0);

  // Persona-specific deep-links surface as their own collapsible group
  // inserted right after Home, skipping anything the role already shows
  // so we never duplicate a row.
  const persona = primaryPersonaId ? PERSONA_LOOKUP[primaryPersonaId] : null;
  if (!persona || !Array.isArray(persona.nav_extras) || persona.nav_extras.length === 0) {
    return groups;
  }
  // Never inject a persona group whose role_alignment differs from the
  // current user — a Founder nav extra has no place in an Investor sidebar.
  if (persona.role_alignment && String(persona.role_alignment) !== String(role)) {
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

// Carta-style user dropdown — top-right of the global header.
function UserDropdown({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const keydown = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keydown);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-gray-50 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="max-w-[160px] truncate">{user?.name || user?.email || 'Account'}</span>
        <ChevronDown size={13} className={`flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 w-52 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl py-1.5 z-50"
          role="menu"
        >
          <Link to="/settings" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            User Settings
          </Link>
          <Link to="/trust" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Trust Center
          </Link>
          <Link to="/calendar" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Calendar
          </Link>
          <Link to="/my/events" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Events
          </Link>
          <Link to="/articles/draft" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Articles
          </Link>
          <Link to="/tickets" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Support
          </Link>
          <Link to="/docs" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Documentation
          </Link>
          <Link to="/plans-and-pricing" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Plans &amp; Pricing
          </Link>
          <div className="my-1 border-t border-gray-100 dark:border-gray-800" role="separator" />
          <button type="button" onClick={() => { setOpen(false); onLogout(); }}
            className="w-full flex items-center px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Log Out
          </button>
        </div>
      )}
    </div>
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
                {/* Task #14 — 'exploring' is offered in View-as (it was filtered
                    out in v1) so admins can preview the holding-state experience
                    end-to-end: /exploring dashboard, the lean exploring sidebar,
                    and RoleGuard bounces on non-exploring routes. Per-user
                    review still lives at /admin/exploring. */}
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
  const location = useLocation();
  // Active-company context state — owned here so descendants (CompanySwitcher,
  // CompanySettingsPage, etc.) share the same reference without prop drilling.
  const [activeCompany, setActiveCompany] = useState(null);
  const [companyList, setCompanyList] = useState([]);

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
  const activeRole = resolveActiveRole({ user, realUser, viewMode, isImpersonating });
  const fullWidthSurface = (activeRole === 'founder'
    && ['/build/discovery', '/execution', '/build/this-week', '/grow/customers', '/grow/talent', '/grow/brand', '/grow/capital-match', '/grow/partnerships', '/grow/launch', '/raise/pitch', '/build/team', '/network', '/network/relationships', '/network/introductions', '/network/organizations', '/signals'].includes(location.pathname))
    || (activeRole === 'investor' && (
      location.pathname.startsWith('/portfolio/')
      || ['/deals', '/pipeline', '/pipeline/screening', '/pipeline/commit', '/pipeline/transactions', '/funds', '/network', '/market-intel'].includes(location.pathname)
    ))
    || activeRole === 'advisor'
    || location.pathname === '/spinout-lab'
    || location.pathname.startsWith('/spinout-lab/');
  const flushSurface = activeRole === 'founder'
    && ['/execution', '/build/this-week', '/grow/customers', '/grow/talent', '/grow/brand', '/grow/capital-match', '/grow/partnerships', '/grow/launch', '/raise/pitch', '/build/discovery', '/build/team', '/network', '/network/relationships', '/network/introductions', '/network/organizations', '/signals'].includes(location.pathname)
    || (activeRole === 'investor' && (
      location.pathname.startsWith('/portfolio/')
      || ['/deals', '/pipeline', '/pipeline/screening', '/pipeline/commit', '/pipeline/transactions', '/funds', '/network', '/market-intel'].includes(location.pathname)
    ));
  const sidebarGroups = getSidebarGroups(activeRole || 'founder', primaryPersonaId, user);

  // Auto-logout after 20 minutes of inactivity, with a 60-second warning modal.
  // Tracks mouse/keyboard/scroll/touch on `window`. Disabled when no user is
  // present (covers the brief render between logout and redirect).
  const { warningOpen, secondsLeft, stayLoggedIn, logoutNow } = useInactivityTimeout({
    timeoutMs: 20 * 60 * 1000,
    warningMs: 60 * 1000,
    enabled: !!user,
    onTimeout: onLogout,
  });

  // Memoize the context value so consumers of `useViewMode()` don't re-render
  // on every App render. Stable identity unless one of the three inputs changes.
  const viewModeContextValue = useMemo(
    () => ({ viewMode: activeRole, isAdmin, isImpersonating }),
    [activeRole, isAdmin, isImpersonating],
  );

  return (
    <ActiveCompanyContext.Provider value={{ company: activeCompany, setCompany: setActiveCompany, companies: companyList, setCompanies: setCompanyList }}>
    <ViewModeContext.Provider value={viewModeContextValue}>
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

        {/* ── Carta-style global top header ─────────────────────────────── */}
        <header className="z-40 h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center px-4 gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <button
              className="lg:hidden text-gray-500 dark:text-gray-400 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={18} />
            </button>
            <img src="/axal-mark.png" alt="Axal VC" className="h-7 w-7 rounded-md object-cover flex-shrink-0" />
            <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 hidden sm:block">Axal VC</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {isImpersonating && (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                Impersonating {user.name}
              </span>
            )}
            {isAdmin && activeRole !== 'admin' && (
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[activeRole]}`}>
                {ROLE_LABELS[activeRole]} View
              </span>
            )}
            {(activeRole === 'founder' || activeRole === 'admin') && (
              <Suspense fallback={<span className="inline-block h-8 w-8" />}>
                <FounderWellbeingMenu />
              </Suspense>
            )}
            <Suspense fallback={<span className="inline-block w-8 h-8" />}>
              <NotificationBell userId={user?.id} />
            </Suspense>
            <Link
              to="/referrals"
              className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors whitespace-nowrap"
            >
              <Gift size={14} />
              Refer &amp; Earn
            </Link>
            <UserDropdown user={user} onLogout={onLogout} />
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <aside className={`
            fixed ${sidebarOpen ? 'lg:relative' : ''}
            inset-y-0 left-0 z-50 ${effectiveCollapsed ? 'w-20' : 'w-64'} bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800
            flex flex-col
            transform transition-transform duration-200
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:hidden'}
          `}>
            <SidebarNav groups={sidebarGroups} role={activeRole || 'founder'} onNavigate={closeOnMobileNav} user={user} collapsed={effectiveCollapsed} onCollapse={toggleSidebarCollapsed} onClose={() => setSidebarOpen(false)} />
          </aside>

          {sidebarOpen && (
            <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
          )}

          <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
            <div data-app-main data-density-target className={`${flushSurface ? 'p-0 edge-to-edge-surface' : 'p-4 md:p-6'} ${fullWidthSurface ? '' : 'max-w-7xl mx-auto'}`}>
              {children}
            </div>
            <footer className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 md:px-6 py-4">
              <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-gray-400 dark:text-gray-500">
                <span>
                  © Copyright {new Date().getFullYear()}, Axal VC Management LLC. Axal VC Holdings LLC. All rights reserved.
                </span>
                <div className="flex items-center gap-4">
                  <Link to="/terms" className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">Terms of service</Link>
                  <Link to="/privacy" className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">Privacy policy</Link>
                </div>
              </div>
            </footer>
          </main>
        </div>
      </div>
      <Suspense fallback={null}>
        <InactivityWarningModal
          open={warningOpen}
          secondsLeft={secondsLeft}
          onStay={stayLoggedIn}
          onLogout={logoutNow}
        />
        <CommandPalette />
        <KeyboardShortcutsOverlay />
        <InstallPrompt />
        <StepUpModal />
      </Suspense>
    </ViewModeContext.Provider>
    </ActiveCompanyContext.Provider>
  );
}

function RequireAuth({ user, children, onLogout, viewMode, onViewModeChange, isImpersonating, onExitImpersonation, realUser, onImpersonate }) {
  const location = useLocation();
  const { oauthBootstrapping } = useAuth();
  const [kycStatus, setKycStatus] = useState(user?.kyc_status || null);
  const [accessLevel, setAccessLevel] = useState(user?.access_level || null);
  // Task #24 — authoritative role from /api/me. The login token / stored
  // `user` role is never refreshed, so an account created as a partner and
  // later promoted to admin keeps a stale client role. The onboarding-chat
  // bypass below must evaluate against this fresh role, not `user.role`.
  const [serverRole, setServerRole] = useState(user?.role || null);
  const [primaryPersonaId, setPrimaryPersonaId] = useState(null);
  const [onboardingFlow, setOnboardingFlow] = useState(null);
  const [onboardingComplete, setOnboardingComplete] = useState(true);
  const [onboardingLoaded, setOnboardingLoaded] = useState(false);

  // Task #1 — invite/deep-link continuity. RegisterPage persisted a validated
  // `?next=` path (localStorage `gvpn:next`) before the email/OAuth
  // round-trip; consume it once per page load after auth resolves and route
  // the user there BEFORE the onboarding-chat gate engages. While the user
  // remains on that target, the gate stays suppressed so an invitation
  // acceptance is never hijacked by the chatbot (they get nudged to the chat
  // on their next navigation instead).
  const pendingNext = user && !oauthBootstrapping ? consumePendingNextOnce() : null;
  const pendingTargetPath = pendingNext ? pendingNext.split(/[?#]/)[0] : null;
  const atPendingNext = !!(pendingTargetPath && location.pathname === pendingTargetPath);
  const pendingRedirect = !!(pendingNext && !atPendingNext && !pendingNextRedirected());
  useEffect(() => {
    // Marked post-commit so StrictMode's double render can't half-consume
    // the redirect (both renders return the same <Navigate>).
    if (pendingRedirect) markPendingNextRedirected();
  }, [pendingRedirect]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await api.getMe();
        if (cancelled) return;
        setKycStatus(me.kyc_status || 'not_started');
        setAccessLevel(me.access_level || null);
        setServerRole(me.role || null);
        const stored = safeReadJSON('user', {});
        if (
          stored.kyc_status !== me.kyc_status ||
          stored.access_level !== me.access_level ||
          stored.role !== me.role
        ) {
          localStorage.setItem('user', JSON.stringify({
            ...stored,
            role: me.role,
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

  // Post-OAuth bootstrap in flight. The Google callback set the session
  // cookie entirely server-side and 302'd us to a protected route;
  // useAuthSync is force-probing /me to reconcile the cookie-backed identity.
  // Show a spinner until it settles — checked BEFORE the `!user` branch so we
  // (a) never bounce to /login (which lands on AuthScreen and would tear the
  // freshly-minted session down as an "account switch"), and (b) never flash
  // protected UI under a STALE cached user (e.g. a prior browser user still
  // in localStorage) before the fresh /me lands. Cleared on settle, so a
  // genuinely failed bootstrap falls through to the normal checks below.
  if (oauthBootstrapping) {
    return (
      <div className="flex items-center justify-center min-h-screen text-sm text-gray-500 dark:text-gray-400">
        Signing you in…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Task #1 — route to the stored invite/deep-link target (at most once per
  // page load) before the chat gate below can pin the user to the chatbot.
  if (pendingRedirect) {
    return <Navigate to={pendingNext} replace />;
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
  //
  // Task #24 — evaluate the admin bypass against `serverRole` (the live
  // role from /api/me), not `user.role` (the stale login-token role). An
  // account created as a partner and later promoted to admin would
  // otherwise keep being pinned to the chatbot. While impersonating,
  // `realUser` is the admin and `user`/serverRole is the impersonated
  // persona, so `!isImpersonating` already short-circuits that case.
  const chatGateRole = serverRole || user.role;
  const onChatPath = location.pathname === '/onboarding/chat';
  if (
    onboardingLoaded &&
    onboardingFlow === 'chat' &&
    !onboardingComplete &&
    !onChatPath &&
    !atPendingNext && // Task #1 — invite target outranks the chat gate
    chatGateRole !== 'admin' &&
    realUser?.role !== 'admin' &&
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
  // Partners (including Advisor / Operator / Counsel / Technical / Liquidity
  // sub-personas that fold into role='partner' for the CHECK constraint)
  // onboard via the AI chatbot at /onboarding/chat — not the legacy
  // /onboarding/partner "Your firm" form. The chatbot saves the persona
  // into partner_profiles for admin review, which is everything the form
  // used to collect plus more. Founders and investors keep their existing
  // wizards (founders' 28-day Spin-Out Lab is gated separately via
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
  // pages. Founders, partners, and advisors do not require KYC at all — and
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

function RoleGuard({ user, allowedRoles, children, viewMode, realUser, isImpersonating, impersonationTargetRef }) {
  const effectiveRole = isImpersonating ? user?.role : ((realUser || user)?.role === 'admin' ? viewMode : user?.role);
  if (!allowedRoles.includes(effectiveRole)) {
    // Task #102 — impersonation handoff. When an admin starts impersonating
    // from an admin-only route (e.g. /admin/spinout-lab → "Open workspace"),
    // this guard re-renders with the impersonated role BEFORE the caller's
    // own navigation lands, and its redirect wins the transition race. If a
    // target path is pending, redirect THERE instead of the role default.
    // Read-only here (render must stay pure — StrictMode double-renders);
    // the AppInner effect clears the ref after the state settles.
    const pendingTarget = isImpersonating ? impersonationTargetRef?.current : null;
    const defaultPath = pendingTarget || ROLE_DEFAULT_PATH[effectiveRole] || '/studio';
    return <Navigate to={defaultPath} replace />;
  }
  return children;
}

// Task #49 — wrapper for the public auth screens (/register, /login). When an
// already-signed-in user (typically an admin) lands here, treat it as intent
// to use a different account: tear down the prior session instead of bouncing
// them to the admin dashboard. clearSession() runs ONCE on mount and, because
// it setUser(null)s synchronously, `user` flips to null and the form renders —
// the server-side cookie/session revoke completes in the background. A signed-
// out visitor renders the form immediately with no teardown.
function AuthScreen({ user, clearSession, children }) {
  const startedRef = React.useRef(false);
  useEffect(() => {
    if (user && !startedRef.current) {
      startedRef.current = true;
      clearSession();
    }
  }, [user, clearSession]);
  if (user) {
    return (
      <div className="flex items-center justify-center min-h-screen text-sm text-gray-500 dark:text-gray-400">
        Signing you out of your previous session…
      </div>
    );
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
  const location = useLocation();

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem('viewMode', mode);
    const defaultPath = ROLE_DEFAULT_PATH[mode] || '/studio';
    navigate(defaultPath);
  };

  // Task #102 — optional `targetPath` lets callers land somewhere specific
  // (e.g. the admin Spin-Out Lab dashboard opens the founder's /spinout-lab
  // workspace) instead of the role's default page.
  //
  // The navigation itself is DEFERRED to the effect below: navigate() is
  // transition-wrapped in React Router, so calling it here loses the race
  // against RoleGuard, whose urgent re-render (admin route + now-founder
  // user) issues its own <Navigate> to the role default path. Navigating
  // after the impersonation state commits — from an ancestor effect that
  // runs AFTER RoleGuard's — makes our destination win deterministically.
  const pendingImpersonationPathRef = useRef(null);
  const handleImpersonate = (token, impersonatedUser, targetPath) => {
    const currentUser = safeReadJSON('user');
    const currentToken = localStorage.getItem('token');
    localStorage.setItem('realUser', JSON.stringify(currentUser));
    localStorage.setItem('realToken', currentToken);
    setRealUser(currentUser);

    localStorage.setItem('token', token);
    setUser(impersonatedUser);
    setViewMode(impersonatedUser.role);
    localStorage.setItem('viewMode', impersonatedUser.role);
    pendingImpersonationPathRef.current =
      targetPath || ROLE_DEFAULT_PATH[impersonatedUser.role] || '/studio';
    // T20 — bypass the 5-min /me throttle so the impersonated session is
    // immediately reconciled against the server (KYC, access_level, etc.).
    refresh({ force: true });
  };

  // Navigate once the impersonation state has committed. The ref is NOT
  // cleared here: async state updates (e.g. the forced /me re-sync
  // resolving) can trigger urgent re-renders while the location change is
  // still a pending transition — RoleGuard then re-renders on the OLD
  // admin route and issues another redirect. As long as the ref survives,
  // every such redirect keeps pointing at the target instead of the role
  // default. Cleared by the arrival effect below once the URL settles.
  useEffect(() => {
    if (realUser && pendingImpersonationPathRef.current) {
      navigate(pendingImpersonationPathRef.current, { replace: true });
    }
  }, [realUser, navigate]);

  useEffect(() => {
    if (pendingImpersonationPathRef.current && location.pathname === pendingImpersonationPathRef.current) {
      pendingImpersonationPathRef.current = null;
    }
  }, [location.pathname]);

  const exitImpersonation = () => {
    pendingImpersonationPathRef.current = null;
    const origToken = localStorage.getItem('realToken');
    const origUser = safeReadJSON('realUser');
    localStorage.setItem('token', origToken);
    // Cohort Timing task — close the impersonation audit session
    // (best-effort, fired AFTER the admin token is restored so the call
    // authenticates as the admin; dev backend has no session id).
    try {
      const impSessionId = localStorage.getItem('impersonationSessionId');
      if (impSessionId) {
        localStorage.removeItem('impersonationSessionId');
        api.adminImpersonateEnd(impSessionId).catch(() => {});
      }
    } catch { /* storage unavailable */ }
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

  // Task #49 — full session teardown WITHOUT a redirect. Shared by logout()
  // (which redirects afterwards) and the AuthScreen wrapper on /register and
  // /login (which renders the form afterwards so an already-signed-in user —
  // e.g. an admin — can start a different account instead of being bounced
  // to the admin dashboard).
  //
  // Order matters: purge client state FIRST (synchronously) so a concurrent
  // useAuthSync refresh() — which keys off the cached `user` — gates out and
  // can't re-hydrate the stale session from /me while we're tearing it down.
  // The httpOnly auth cookie is untouched by clearing localStorage, so the
  // server-side revoke below still runs over the cookie.
  const clearSession = useCallback(async () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('realUser');
    localStorage.removeItem('realToken');
    localStorage.removeItem('viewMode');
    // Sweep any per-tab sensitive state (drafts, in-flight wizards, etc.).
    try { sessionStorage.clear(); } catch (e) { /* ignore */ }
    setUser(null);
    setRealUser(null);
    // T6 — revoke the server-side session + clear the httpOnly auth/CSRF
    // cookies. Failures are non-fatal: the client is already signed out
    // above. Time-boxed to ~5s so a dead network can't hang sign-out.
    try {
      await Promise.race([
        api.logout(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch (e) { /* logout must never block the UI sign-out */ }
  }, [setUser]);

  const logout = useCallback(async () => {
    await clearSession();
    // Full-document navigation to the sign-in screen (NOT client-side routing):
    // a fresh load fetches the current index.html + chunks rather than relying
    // on this tab's old in-memory module graph, and `replace` keeps the
    // torn-down session out of history so Back can't land on a dead
    // authenticated page. NOTE: clearSession() already flipped `user` to null,
    // so RequireAuth may briefly client-side-redirect into the lazy /login
    // chunk during the awaited teardown; the stale-chunk error from that is
    // absorbed calmly by RouteErrorBoundary + the vite:preloadError reload
    // (see main.jsx) — not by this navigation.
    window.location.replace('/login');
  }, [clearSession]);

  // Task #8 — Universal referral attribution. Capture a `?ref=CODE` from ANY
  // entry point (not just /register) into the `axal_ref` cookie so a later
  // purchase of ANY SKU can pay the referrer a commission. First-touch wins:
  // we never overwrite an existing cookie. 30-day window, SameSite=Lax so it
  // survives the cross-domain marketing → app hop.
  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get('ref');
      if (!code) return;
      const normalized = code.trim().toUpperCase().replace(/^AXAL[-_]?/, '').replace(/[^A-Z0-9]/g, '');
      if (!normalized) return;
      const already = document.cookie.split(';').some((c) => c.trim().startsWith('axal_ref='));
      if (already) return; // first-touch wins
      const secure = window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `axal_ref=${encodeURIComponent(normalized)}; path=/; max-age=2592000; SameSite=Lax${secure}`;
    } catch { /* attribution must never break navigation */ }
  }, []);

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
      <RoleGuard user={user} allowedRoles={roles} viewMode={viewMode} realUser={realUser} isImpersonating={isImpersonating} impersonationTargetRef={pendingImpersonationPathRef}>
        {component}
      </RoleGuard>
    </RequireAuth>
  );

  // Spin-Out Lab participants unlock the lab's tool pages regardless of the
  // role they held before admission (e.g. 'exploring' users accepted into a
  // cohort). The workspace UI still week-gates the tool cards; this only
  // stops RoleGuard from bouncing an active lab member off a lab tool route.
  //
  // Admin users browsing via the "View as" switcher (not impersonation) have
  // effectiveRole = viewMode, not 'admin'. We add viewMode to the list so
  // RoleGuard doesn't redirect them while they're previewing another role.
  const labRoles = (roles) => {
    const result = [...roles];
    if (user && user.spinout_lab_active === 1 && !result.includes(user.role)) {
      result.push(user.role);
    }
    if (user?.role === 'admin' && !isImpersonating && viewMode && !result.includes(viewMode)) {
      result.push(viewMode);
    }
    return result;
  };

  // Task #9 — authoring is open to any authenticated user (no role gate).
  const authOnly = (component) => <RequireAuth {...authProps}>{component}</RequireAuth>;

  // The role the session is browsing as. Same helper the shell uses to pick the
  // sidebar (ProtectedLayout), so the nav and the routes cannot disagree about
  // who the viewer is — which is exactly how an admin previewing Investor View
  // ended up with an "Investor View" chip above the FOUNDER Spin-Out Lab.
  const effectiveRole = resolveActiveRole({ user, realUser, viewMode, isImpersonating });

  // Which shell's Research zone list to render. Admin has no research shell of
  // its own, so it previews the founder one rather than falling through to a
  // bucket with no zones.
  //
  // MUST stay below effectiveRole. It was briefly declared above it, which put
  // the read inside the temporal dead zone of a `const` in the same function
  // body — a ReferenceError on every render of AppInner, so a blank app. The
  // build does not catch it because it is a runtime error, not a compile one.
  const researchRole = (!effectiveRole || effectiveRole === 'admin') ? 'founder' : effectiveRole;
  // Same rule as researchRole, and the same reason it lives below
  // effectiveRole rather than above it.
  const networkRole = researchRole;
  const investorWorkspace = (page, component, options = {}) => (
    effectiveRole === 'investor'
      ? <InvestorWorkspacePage page={page} {...options}>{component}</InvestorWorkspacePage>
      : component
  );
  const investorFundWorkspace = (component) => investorWorkspace('fund', component, {
    fundUnlocked: hasInvestorTier(user, 'institutional'),
  });
  const founderWorkspace = (page, component, options = {}) => (
    effectiveRole === 'founder'
      ? <FounderWorkspacePage page={page} {...options}>{component}</FounderWorkspacePage>
      : component
  );
  const advisorRolePreview = user?.role === 'admin' && !isImpersonating && effectiveRole === 'advisor';
  const advisorPrivateWorkspace = (component) => (
    advisorRolePreview ? <Navigate to="/studio" replace /> : component
  );
  const partnerRolePreview = effectiveRole === 'partner' && user?.role !== 'partner';
  const partnerPrivateWorkspace = (component) => (
    partnerRolePreview ? <Navigate to="/studio" replace /> : component
  );
  const founderRaiseLanding = effectiveRole === 'founder'
    && new URLSearchParams(location.search).get('mode') !== 'workspace';
  const founderGrowLanding = effectiveRole === 'founder'
    && new URLSearchParams(location.search).get('mode') !== 'workspace';
  const networkParams = new URLSearchParams(location.search);
  const founderNetworkLanding = effectiveRole === 'founder'
    && networkParams.get('mode') !== 'workspace'
    && !networkParams.has('tab')
    && !networkParams.has('intro');
  const signalsParams = new URLSearchParams(location.search);
  const signalsMode = signalsParams.get('mode');
  const signalsHasNonProjectQuery = [...signalsParams.keys()].some((key) => key !== 'project_id');
  const founderResearchLanding = effectiveRole === 'founder'
    && (signalsMode === 'landing' || (!signalsHasNonProjectQuery && signalsMode !== 'workspace'));

  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-gray-500 dark:text-gray-400">Loading…</div>}>
<RouteErrorBoundary>
<Routes>
      <Route path="/" element={user ? <Navigate to={ROLE_DEFAULT_PATH[user.role] || '/studio'} replace /> : <LandingPage />} />
      {/* /spinout-lab is THREE surfaces behind one path, because "Spin-Out Lab"
          means something different depending on who is asking:

            - logged out            → the public marketing page
            - investor / LP         → the FUND-I SALES PAGE (SpinoutLabInvestorPage):
                                      the conviction step. What founders do
                                      inside the Lab, the operating stack, why
                                      the model matters in an AI-native
                                      environment, Axal's underwriting edge,
                                      and the studio proof — every CTA routes
                                      into the deeper LP & Investor Workspace
                                      below, where the fund terms, raise
                                      status, reporting and the application
                                      flow live. An LP's relationship with the
                                      Lab is the fund, not the 4-week founder
                                      curriculum.
            - everyone else         → the founder Lab (marketing → application
                                      → the 4-week workspace, per enrollment)

          Branched at the ROUTE, not inside SpinoutLabPage, for two reasons:
          SpinoutLabPage loads founder-scoped Lab state on mount, so an investor
          would fire a request that is not theirs to make; and all three pages
          are lazy, so an investor never downloads the founder chunk (or vice
          versa). Logged-in visitors get the normal app shell either way. */}
      <Route
        path="/spinout-lab"
        element={
          user
            ? authOnly(effectiveRole === 'investor'
                ? <SpinoutLabInvestorPage />
                : <SpinoutLabPage />)
            : <SpinoutLabPage />
        }
      />
      {/* Spin-Out Lab · LP & Investor Workspace — the DEEPER second step of the
          investor journey (fund overview, terms, tiers, underwriting data,
          reporting archive, allocation, and the apply / request-access flow).
          First-class route under /spinout-lab so the journey stays in one
          namespace: /spinout-lab → /spinout-lab/investor-workspace. The same
          component is also a Fund Ops tab at /funds/lp-workspace (embedded
          there, standalone here) — one component behind both routes, so the
          two surfaces cannot drift. Role-gated like the Fund Ops route: this
          content is for investors and admins only. */}
      <Route path="/spinout-lab/investor-workspace" element={guard(['admin', 'investor'], investorWorkspace('axal-vc-fund', null))} />
      {/* Lab tool page — the founder's company record (design: workspace tool
          pages). labRoles admits the active lab member's own role; admins can
          open it for support. */}
      <Route path="/spinout-lab/startup" element={guard(labRoles(['admin']), <SpinoutLabStartupPage />)} />
      <Route path="/spinout-lab/discovery" element={guard(labRoles(['admin']), <SpinoutLabDiscoveryPage />)} />
      <Route path="/spinout-lab/market" element={guard(labRoles(['admin']), <SpinoutLabMarketPage />)} />
      <Route path="/spinout-lab/roadmap" element={guard(labRoles(['admin']), <SpinoutLabRoadmapPage />)} />
      <Route path="/spinout-lab/profiling" element={guard(labRoles(['admin']), <SpinoutLabProfilingPage />)} />
      <Route path="/spinout-lab/scoring" element={guard(labRoles(['admin']), <SpinoutLabScoringPage />)} />
      <Route path="/spinout-lab/advisors" element={guard(labRoles(['admin']), <SpinoutLabAdvisorsPage />)} />
      <Route path="/spinout-lab/revenue" element={guard(labRoles(['admin']), <SpinoutLabRevenuePage />)} />
      <Route path="/spinout-lab/use-of-funds" element={guard(labRoles(['admin']), <SpinoutLabUseOfFundsPage />)} />
      <Route path="/spinout-lab/incorporate" element={guard(labRoles(['admin']), <SpinoutLabIncorporatePage />)} />
      <Route path="/spinout-lab/capital" element={guard(labRoles(['admin']), <SpinoutLabCapitalPage />)} />
      <Route path="/spinout-lab/captable" element={guard(labRoles(['admin']), <SpinoutLabCapTablePage />)} />
      <Route path="/spinout-lab/pitch-deck" element={guard(labRoles(['admin']), <SpinoutLabPitchDeckPage />)} />
      {/* New Brand & Landing Pages tool (design: Brand & Landing Page.dc) —
          replaces /build/brand as the founders' entry point, so it keeps the
          same roles as the old route (any founder, plus active lab members). */}
      <Route path="/spinout-lab/brand" element={guard(labRoles(['admin', 'founder']), founderWorkspace('grow', <FounderWorkspaceTabs set="grow" user={user}><SpinoutLabBrandPage /></FounderWorkspaceTabs>))} />
      <Route path="/spinout-lab/cofounder-agreement" element={guard(labRoles(['admin']), <SpinoutLabCofounderAgreementPage />)} />
      {/* Co-founder Match tool page (design: Co-founder Match.dc) — the Lab
          decision console; /cofounder stays the full browse/connections/NDA
          surface and is linked from the page header. */}
      <Route path="/spinout-lab/cofounder-match" element={guard(labRoles(['admin', 'founder']), <SpinoutLabCofounderMatchPage />)} />
      {/* Graduation Certificate (design: Graduation Certificate.dc) — the
          Week-4 credential, conferred on the incorporation_completed
          milestone and downloadable as a vector A4-landscape PDF. */}
      <Route path="/spinout-lab/certificate" element={guard(labRoles(['admin', 'founder']), <SpinoutLabCertificatePage />)} />
      {/* Office Hours tool page (design: Office Hours.dc) — founder-side
          partner session booking; /office-hours stays the advisor console. */}
      <Route path="/spinout-lab/office-hours" element={guard(labRoles(['admin']), <SpinoutLabOfficeHoursPage />)} />
      {/* Cohort application form — signed-in founders only (contact info
          comes from the account); logged-out visitors are sent to register
          with the spinout-lab product intent. */}
      <Route path="/spinout-lab/apply" element={user ? authOnly(<SpinoutLabApplyPage />) : <Navigate to="/register?lane=founder&product=spinout-lab" replace />} />
      {/* Printable Program Brief — deliberately rendered OUTSIDE the app
          shell (even when logged in) so "Save as PDF" prints a clean
          brochure with no sidebar/nav. Public: it's marketing collateral. */}
      <Route path="/spinout-lab/brief" element={<SpinoutLabBriefPage />} />
      {/* Audience product pages — public marketing surface. */}
      <Route path="/for-founders" element={<ProductAudiencePage slug="founders" />} />
      <Route path="/for-investors" element={<ProductAudiencePage slug="investors" />} />
      <Route path="/for-service-partners" element={<ProductAudiencePage slug="service-partners" />} />
      <Route path="/for-mentors" element={<Navigate to="/for-advisors" replace />} />
      <Route path="/for-advisors" element={<ProductAudiencePage slug="advisors" />} />
      <Route path="/pricing/investor" element={<InvestorPricingPage />} />
      <Route path="/register" element={<AuthScreen user={user} clearSession={clearSession}><RegisterPage /></AuthScreen>} />
      <Route path="/login" element={<AuthScreen user={user} clearSession={clearSession}><LoginPage /></AuthScreen>} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/network-intro/:token" element={<NetworkIntroReviewPage />} />
      {/* Task #50 — Lost-TOTP recovery. Catch-all subroute so /auth/recover,
          /auth/recover/email and /auth/recover/attest all land here. */}
      <Route path="/auth/recover" element={<RecoverPage />} />
      <Route path="/auth/recover/*" element={<RecoverPage />} />
      <Route path="/esign/:token" element={<ESignPage />} />
      <Route path="/legal/send" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <SendForSignaturePage />)} />
      {/* Task #1 (Spin-Out Teams) — tokenized co-founder/advisor invite
          acceptance. Public route; the page bounces logged-out visitors to
          sign-in with a `?next=` return path, then POSTs the bound token. */}
      <Route path="/projects/invitations/accept" element={<AcceptInvitePage />} />
      {/* Task #9 (X-2) — Public token-gated partner onboarding wizard.
          Mounted at the path embedded in admin-emailed magic links AND a
          query-string variant for fallback share-by-link channels. */}
      <Route path="/partner-onboarding/:token" element={<PartnerOnboardPage />} />
      <Route path="/partners/onboard" element={<PartnerOnboardPage />} />
      <Route path="/settings/email/confirm" element={<EmailChangeConfirmPage />} />
      <Route path="/settings/email/revoke" element={<EmailChangeRevokePage />} />
      <Route path="/settings/:section" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <SettingsPage />)} />

      {/* Phase 0.1 — investor role added to every guard a partner currently
          passes. Investor-only nav is curated above (NAV_BY_ROLE.investor)
          so we get a tighter capital-allocator surface; per-route guards
          stay permissive so deep links keep working during the split. */}
      {/* Spin-Out Lab members (role `exploring`, lab-active) build their skills +
          values profile in Studio too — the lab Profiling page reads from it. */}
      <Route path="/studio" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <Dashboard activeRole={effectiveRole} authUser={user} />)} />
      {/* Task #9 — holding-state dashboard for chat-onboarded users awaiting admin role review. */}
      <Route path="/exploring" element={guard(['admin', 'exploring'], <ExploringDashboard />)} />
      <Route path="/dashboard" element={<DashboardRedirect />} />
      <Route path="/onboarding/chat" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'pending', 'exploring'], <OnboardingChatPage />)} />
      <Route path="/onboarding/persona" element={guard(['admin', 'founder', 'partner', 'investor'], <OnboardingPersonaPage />)} />
      <Route path="/onboarding/founder" element={guard(['admin', 'founder'], <OnboardingFounderPage />)} />
      <Route path="/onboarding/investor" element={guard(['admin', 'investor'], <OnboardingInvestorPage />)} />
      <Route path="/onboarding/partner" element={guard(['admin', 'partner'], <OnboardingPartnerPage />)} />
      <Route path="/build/brand" element={guard(labRoles(['admin', 'founder']), founderWorkspace('grow', <BrandBuilderPage />))} />
      {/* Task #1 — RAISE Workspaces: founder-exclusive Pitch Deck / Reviewer
          routes now live inside the Pitch workspace; redirect to the right tab. */}
      <Route path="/build/deck" element={<Navigate to="/raise/pitch" replace />} />
      <Route path="/build/deck-reviewer" element={<Navigate to="/raise/pitch/review" replace />} />
      <Route path="/build/competitors" element={guard(['admin', 'founder', 'partner', 'investor'], founderWorkspace('research', <CompetitorAnalysisPage />))} />
      <Route path="/build/financials" element={guard(['admin', 'founder', 'partner', 'investor'], founderWorkspace('raise', <FinancialsPage />))} />
      <Route path="/build/discovery" element={guard(labRoles(['admin', 'founder', 'partner', 'investor']), effectiveRole === 'founder' ? <FounderValidatePage /> : <DiscoveryPage />)} />

      {/* ── Validate · the four evidence stages ──────────────────────────────
          Interviews and Pain map read the SAME records Discovery writes; the
          two routes are doors onto one log, not a fork of it. Hypotheses and
          Verdict have no store yet and say so rather than 404-ing behind a
          sidebar row that promises a page. */}
      <Route path="/validate" element={<Navigate to="/validate/interviews" replace />} />
      <Route path="/validate/interviews" element={guard(labRoles(['admin', 'founder']), <FounderValidateWorkspace />)} />
      <Route path="/validate/pain-map" element={guard(labRoles(['admin', 'founder']), <FounderValidateWorkspace />)} />
      <Route path="/validate/hypotheses" element={guard(labRoles(['admin', 'founder']), <FounderValidateWorkspace />)} />
      <Route path="/validate/verdict" element={guard(labRoles(['admin', 'founder']), <FounderValidateWorkspace />)} />

      {/* ── Research · one path, four zone lists ─────────────────────────────
          Shared like /network already is: the route role-branches its element
          and the zone row comes from the shell config, so each license sees
          the zones its own canvas specifies. Markets mounts the live signals
          feed; Companies revives CompetitorAnalysisPage, which had been
          reachable only by deep link since it left the sidebar. */}
      <Route path="/research" element={<Navigate to="/research/ask" replace />} />
      <Route path="/research/ask" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <ResearchWorkspace role={researchRole} />)} />
      <Route path="/research/markets" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <ResearchWorkspace role={researchRole} />)} />
      <Route path="/research/companies" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <ResearchWorkspace role={researchRole} />)} />
      <Route path="/research/funds" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <ResearchWorkspace role={researchRole} />)} />
      <Route path="/research/library" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <ResearchWorkspace role={researchRole} />)} />
      <Route path="/research/diligence" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <ResearchWorkspace role={researchRole} />)} />
      <Route path="/research/benchmarking" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <ResearchWorkspace role={researchRole} />)} />
      <Route path="/research/client-prep" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <ResearchWorkspace role={researchRole} />)} />
      {/* Legacy Customer Discovery folds into the unified Discovery workspace. */}
      <Route path="/customer-discovery" element={<Navigate to="/build/discovery" replace />} />
      <Route path="/build/roadmap" element={guard(labRoles(['admin', 'founder', 'partner', 'investor']), founderWorkspace('build', <FounderBuildRoadmap />))} />
      <Route path="/build/cadence" element={guard(labRoles(['admin', 'founder']), founderWorkspace('build', <FounderBuildCadence />))} />
      <Route path="/build/kpi" element={guard(labRoles(['admin', 'founder']), founderWorkspace('build', <FounderBuildKpi />))} />
      <Route path="/build/metrics" element={guard(['admin', 'founder', 'partner', 'investor'], founderWorkspace('build', <FounderWorkspaceTabs set="build" user={user}><MetricsPage /></FounderWorkspaceTabs>))} />
      {/* Signals — founder decision engine over public-market evidence. Shared
          by Founder + Advisor modes (mode changes ordering + copy only). */}
      <Route path="/signals" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], founderResearchLanding
        ? <FounderResearchDesk />
        : founderWorkspace('research', <FounderWorkspaceTabs set="research" user={user}><SignalsPage user={user} /></FounderWorkspaceTabs>))} />
      <Route path="/build/captable" element={guard(labRoles(['admin', 'founder', 'partner', 'investor']), founderWorkspace('raise', <CapTablePage />))} />
      {/* documentation/architecture/DECISIONS.md D11 — /marketplace was a partner-provider directory with
          inquiry threads and reviews whose backend exists only in the dev-only
          FastAPI: all 11 api.marketplace* calls hit /marketplace/* and the
          worker mounts none of it. Discovery is already served by working
          surfaces — /services (services.ts), /needs (needs.ts) and /partners
          (partners.ts) — so the redirect lands on one of those rather than a
          page where nothing loads. Inquiry threads and reviews have no backend
          anywhere and leave with the page. */}
      <Route path="/marketplace" element={<Navigate to="/services" replace />} />
      {/* Task #2 — Founder Marketplace merges the Service Catalogue (/services) and
          Needs Board (/needs) into one tabbed page at /build/marketplace. The
          standalone routes below stay registered for the partner/investor/admin
          personas; founders are redirected into the matching ?tab= here. */}
      <Route path="/build/marketplace" element={guard(['admin', 'founder'], founderWorkspace('validate', <FounderWorkspaceTabs set="validate" user={user}><FounderMarketplacePage user={user} /></FounderWorkspaceTabs>))} />
      <Route path="/needs" element={guard(['admin', 'founder', 'partner', 'investor'], partnerPrivateWorkspace(user?.role === 'founder' ? <Navigate to="/build/marketplace?tab=needs" replace /> : <PartnerWorkspaceTabs set="pipeline" user={user}><NeedsBoardPage user={user} /></PartnerWorkspaceTabs>))} />
      <Route path="/services" element={guard(['admin', 'founder', 'partner', 'investor'], partnerPrivateWorkspace(user?.role === 'founder' ? <Navigate to="/build/marketplace?tab=services" replace /> : <PartnerWorkspaceTabs set="offers" user={user}><ServiceCatalogPage user={user} /></PartnerWorkspaceTabs>))} />
      <Route path="/founder/post-need" element={guard(['admin', 'founder'], user?.role === 'founder' ? <Navigate to="/build/marketplace?tab=mine" replace /> : <NeedsBoardPage user={user} />)} />
      <Route path="/partner/needs" element={guard(['admin', 'partner'], partnerPrivateWorkspace(<NeedsBoardPage user={user} />))} />
      <Route path="/partner/insights" element={guard(['admin', 'partner', 'investor'], partnerPrivateWorkspace(<PartnerWorkspaceTabs set="pipeline" user={user}><PartnerInsightsPage /></PartnerWorkspaceTabs>))} />
      <Route path="/deck/:id/print" element={guard(['admin', 'founder', 'partner', 'investor'], <PitchDeckPrintPage />)} />
      <Route path="/deck/share/:token" element={<PitchDeckPrintPage shareMode />} />
      {/* Task #53 — canonical share URL per spec is /share/deck/<token>. */}
      {/* Build queue #120 — public, audience-scoped cap-table link. No auth:
          the payload is redacted server-side for the link's audience. */}
      <Route path="/share/captable/:token" element={<SharedCapTablePage />} />
      <Route path="/share/deck/:token" element={<PitchDeckPrintPage shareMode />} />
      {/* Task #2 — public, HMAC-token-gated print target consumed only by
          the Cloudflare Browser Rendering session that drives server-side
          PDF / PPTX exports. Not auth-guarded; the token is signed and
          short-lived. */}
      <Route path="/deck/print-export/:token" element={<PitchDeckPrintPage exportMode />} />
      <Route path="/admin" element={guard(['admin'], <AdminPage onImpersonate={handleImpersonate} />)} />
      <Route path="/admin/trash" element={guard(['admin'], <AdminTrashPage />)} />
      <Route path="/admin/refer-earn" element={guard(['admin'], <AdminReferralReview />)} />
      <Route path="/admin/partners" element={guard(['admin'], <AdminPartnerInvitations />)} />
      <Route path="/admin/team" element={guard(['admin'], <AdminTeam />)} />
      {/* Task #9 — exploring-users review queue (binding e-sign + role assignment). */}
      <Route path="/admin/exploring" element={guard(['admin'], <AdminExploring />)} />
      <Route path="/admin/lp-applications" element={guard(['admin'], <AdminLpApplications />)} />
      {/* Territory licence ledger (migration 187). Admin only — it carries the
          fee, the revenue share and an exclusive grant over whole countries. */}
      <Route path="/admin/licences" element={guard(['admin'], <AdminLicences />)} />
      {/* A subsidiary admin reads their OWN licence; /admin/licences is HQ's ledger of every one. */}
      <Route path="/admin/my-licence" element={guard(['admin'], <MyLicencePage />)} />
      <Route path="/admin/network-profiles" element={guard(['admin'], <AdminNetworkProfiles />)} />
      {/* Task #102 — standalone Spin-Out Lab admin dashboard (same component
          as the AdminPage 'lab-applications' tab). */}
      <Route path="/admin/spinout-lab" element={guard(['admin'], <AdminSpinoutLab standalone onImpersonate={handleImpersonate} />)} />
      {/* Task #106 — read-only admin preview of the new-founder Spin-Out Lab
          journey (simulated client-side state; no impersonation, no writes). */}
      <Route path="/admin/spinout-lab/preview" element={guard(['admin'], <AdminSpinoutJourneyPreview />)} />
      <Route path="/admin/telegram" element={guard(['admin'], <AdminTelegram />)} />
      <Route path="/admin/x" element={guard(['admin'], <AdminX />)} />
      <Route path="/admin/assessment" element={guard(['admin'], <AdminAssessment />)} />
      {/* Task #20 — Admin Best-Fit console (consultation queue + full report). */}
      <Route path="/admin/best-fit" element={guard(['admin'], <AdminBestFitPage />)} />
      {/* Task #3 — News & Articles admin queues merged into one Content Queue. Legacy routes redirect. */}
      <Route path="/admin/news" element={<Navigate to="/admin/articles" replace />} />
      <Route path="/news" element={<Navigate to="/articles/draft" replace />} />
      {/* Task #1 — Articles. Reader pages are public (no guard); author + admin gated. */}
      <Route path="/articles" element={<ArticlesPage />} />
      <Route path="/articles/draft" element={authOnly(<ArticleAuthorPage />)} />
      <Route path="/articles/edit/:id" element={authOnly(<ArticleAuthorPage />)} />
      {/* Articles hub is public-only; the writing workspace lives at /articles/draft. Legacy /articles/mine redirects there. */}
      <Route path="/articles/mine" element={<Navigate to="/articles/draft" replace />} />
      <Route path="/authors/:userId" element={<AuthorProfilePage />} />
      <Route path="/admin/articles" element={guard(['admin'], <ArticlesQueuePage />)} />
      <Route path="/articles/:slug" element={<ArticleReaderPage />} />
      <Route path="/admin/events" element={guard(['admin'], <AdminEventsPage />)} />
      <Route path="/admin/jobs" element={guard(['admin'], <AdminJobsPage />)} />
      <Route path="/admin/circles" element={guard(['admin'], <AdminCirclesPage />)} />
      <Route path="/admin/publications" element={guard(['admin'], <AdminPublications />)} />
      <Route path="/admin/publications/new" element={guard(['admin'], <AdminPublicationNew />)} />
      <Route path="/admin/publications/:id" element={guard(['admin'], <AdminPublicationDetail />)} />
      <Route path="/insights" element={<InsightsPage />} />
      <Route path="/insights/public/:slug" element={<PublicInsight />} />
      <Route path="/admin/due-diligence" element={guard(['admin', 'partner', 'investor', 'advisor'], <AdminDueDiligencePage />)} />
      <Route path="/admin/due-diligence/:uid" element={guard(['admin', 'partner', 'investor', 'advisor'], <AdminDueDiligenceCasePage />)} />
      {/* Task #83 — de-admin Due Diligence: investor/advisor-facing alias of the same pages (no /admin framing). */}
      <Route path="/due-diligence" element={guard(['admin', 'partner', 'investor', 'advisor'], <AdminDueDiligencePage />)} />
      {/* Build queue #128 — subject-facing request inbox. Founders included by design:
          this surface exposes only the requests addressed to them, never case data
          (the "founders NEVER read DD" invariant lives in the worker). React Router
          ranks the static segment above /:uid, so this never shadows a case UID. */}
      <Route path="/due-diligence/requests" element={guard(['founder', 'admin', 'partner', 'investor', 'advisor'], <DueDiligenceRequestsPage />)} />
      <Route path="/due-diligence/:uid" element={guard(['admin', 'partner', 'investor', 'advisor'], <AdminDueDiligenceCasePage />)} />
      <Route path="/scoring" element={guard(labRoles(['admin', 'partner', 'investor']), <ScoringPage />)} />
      <Route path="/projects" element={guard(labRoles(['admin', 'founder', 'partner', 'investor']), founderWorkspace('build', <ProjectsPage />))} />
      <Route path="/projects/:id" element={guard(labRoles(['admin', 'founder', 'partner', 'investor']), founderWorkspace('build', <ProjectDetail />))} />
      {/* Task #12 — Founder Execution area: one deep-linkable shell wrapping the
          Projects / Board / Roadmap views. Standalone routes above stay intact
          for other personas. */}
      <Route path="/execution" element={guard(['admin', 'founder'], effectiveRole === 'founder' ? <FounderBuildDesk /> : founderWorkspace('build', <FounderWorkspaceTabs set="build" user={user}><ExecutionPage /></FounderWorkspaceTabs>))} />
      <Route path="/build/this-week" element={guard(['admin', 'founder'], founderWorkspace('build', <FounderBuildThisWeek />, { hideHeader: true }))} />
      <Route path="/build/board" element={guard(['admin', 'founder'], founderWorkspace('build', <FounderBuildBoard />))} />
      <Route path="/execution/board" element={guard(['admin', 'founder'], founderWorkspace('build', <ExecutionPage />))} />
      <Route path="/execution/roadmap" element={guard(['admin', 'founder'], founderWorkspace('build', <ExecutionPage />))} />
      {/* Task #1 — RAISE Workspaces. Three founder workspaces compose the
          existing pages via an `embedded` prop; each guarded for the roles of
          the pages it wraps. Standalone routes (/build/financials, /build/captable,
          /incorporate, /incorporate/*, /compliance, /legal-capital) stay intact
          for the investor/partner personas that share them. */}
       <Route path="/raise/pitch" element={guard(labRoles(['admin', 'founder']),
         new URLSearchParams(location.search).get('mode') === 'workspace'
           ? founderWorkspace('raise', <FounderWorkspaceTabs set="raise" user={user}><PitchWorkspacePage /></FounderWorkspaceTabs>)
           : <FounderRaisePitch />)} />
       <Route path="/raise/status" element={guard(labRoles(['admin', 'founder']), <FounderRaiseStatus />)} />
      <Route path="/raise/pitch/positioning" element={guard(labRoles(['admin', 'founder']), founderWorkspace('raise', <PitchWorkspacePage />))} />
      <Route path="/raise/pitch/review" element={guard(labRoles(['admin', 'founder']), founderWorkspace('raise', <PitchWorkspacePage />))} />
      <Route path="/raise/capital" element={guard(['admin', 'founder'],
        new URLSearchParams(location.search).get('mode') === 'workspace'
          ? founderWorkspace('raise', <FounderWorkspaceTabs set="raise" user={user}><CapitalWorkspacePage /></FounderWorkspaceTabs>)
          : <FounderRaiseCapital />)} />
      <Route path="/raise/capital/model" element={guard(['admin', 'founder'], founderWorkspace('raise', <CapitalWorkspacePage />))} />
      <Route path="/raise/capital/cap-table" element={guard(['admin', 'founder'], founderWorkspace('raise', <CapitalWorkspacePage />))} />
      {/* Founders manage their room; investors see what was shared with them. One route, role-branched inside the page, so there is no second root. */}
      <Route path="/raise/data-room" element={guard(['admin', 'founder', 'investor'],
        effectiveRole === 'investor'
          ? investorWorkspace('deals', <DataRoomPage user={user} />)
          : new URLSearchParams(location.search).get('mode') === 'workspace'
            ? founderWorkspace('raise', <FounderWorkspaceTabs set="raise" user={user}><DataRoomPage user={user} /></FounderWorkspaceTabs>)
            : <FounderRaiseDataRoom />)} />
       <Route path="/raise/liquidity" element={guard(['admin', 'founder'],
         new URLSearchParams(location.search).get('mode') === 'workspace'
           ? founderWorkspace('raise', <FounderWorkspaceTabs set="raise" user={user}><LiquidityPage currentUser={user} /></FounderWorkspaceTabs>)
           : <FounderRaiseLiquidity />)} />
      {/* Every persona, listed explicitly. `guard([])` would deny everyone —
          RoleGuard tests `allowedRoles.includes(effectiveRole)`, which is
          always false on an empty array, so the route would exist and be
          unreachable. */}
      <Route path="/messages" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <MessagesPage user={user} />)} />
      {/* Same explicit list. The partner and admin tabs inside the page are
          gated on the role again there — a role that cannot submit a listing
          simply does not see the tab. */}
      <Route path="/perks" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], effectiveRole === 'founder' ? founderWorkspace('grow', <FounderWorkspaceTabs set="grow" user={user}><PerksPage user={user} /></FounderWorkspaceTabs>) : <PartnerWorkspaceTabs set="offers" user={user}><PerksPage user={user} /></PartnerWorkspaceTabs>)} />
      <Route path="/raise/capital/pipeline" element={guard(['admin', 'founder'], founderWorkspace('raise', <CapitalWorkspacePage />))} />
       <Route path="/raise/legal" element={guard(['admin', 'founder'], <FounderRaiseLegal />)} />
      <Route path="/raise/legal-engine" element={guard(['admin', 'founder', 'partner'], founderWorkspace('raise', <FounderWorkspaceTabs set="raise" user={user}><LegalEnginePage /></FounderWorkspaceTabs>))} />
      <Route path="/raise/legal-engine/incorporation" element={guard(['admin', 'founder', 'partner'], founderWorkspace('raise', <LegalEnginePage />))} />
      <Route path="/raise/legal-engine/founders" element={guard(['admin', 'founder', 'partner'], founderWorkspace('raise', <LegalEnginePage />))} />
      <Route path="/raise/legal-engine/compliance" element={guard(['admin', 'founder', 'partner'], founderWorkspace('raise', <LegalEnginePage />))} />
      <Route path="/raise/legal-engine/equity" element={guard(['admin', 'founder', 'partner'], founderWorkspace('raise', <LegalEnginePage />))} />
      <Route path="/legal" element={guard(['admin', 'founder'], <LegalPage />)} />
      <Route path="/incorporate" element={guard(labRoles(['admin', 'founder', 'partner', 'investor']), <IncorporatePage />)} />
      <Route path="/incorporate/success" element={guard(labRoles(['admin', 'founder', 'partner', 'investor']), <IncorporateSuccessPage />)} />
      <Route path="/incorporate/cofounder-agreement" element={guard(labRoles(['admin', 'founder', 'partner']), <CofounderAgreementPage />)} />
      <Route path="/spinout-lab/83b" element={guard(labRoles(['admin']), <SpinoutLab83bPage />)} />
      <Route path="/spinout-lab/compliance" element={guard(labRoles(['admin']), <SpinoutLabCompliancePage />)} />
      {/* 83(b) moved into the Lab (Week 4 deliverable). Old Incorporate
          path kept as a redirect so existing links and bookmarks survive. */}
      <Route path="/incorporate/83b" element={<Navigate to="/spinout-lab/83b" replace />} />
      <Route path="/compliance" element={guard(labRoles(['admin', 'founder', 'partner']), <CompliancePage />)} />
      <Route path="/wellbeing" element={guard(['admin', 'founder'], <WellbeingPage />)} />
      <Route path="/wellbeing/expert-dashboard" element={guard(['admin', 'founder', 'partner', 'advisor'], <ExpertEditorPage />)} />
      <Route path="/wellbeing/expert/:uid" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <ExpertProfilePage />)} />
      <Route path="/partners" element={guard(['admin', 'partner', 'investor'], <PartnersPage />)} />
      <Route path="/capital" element={guard(['admin', 'investor'], <CapitalPage />)} />
      <Route path="/tickets" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <TicketsPage />)} />
      {/* Products — catalog + checkout + explorer promo redemption. Open to
          every signed-in role incl. 'exploring' (that's where the Personal
          Advisor's one-time 30-day-license codes get redeemed). */}
      <Route path="/plans-and-pricing" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <ProductsPage />)} />
      {/* Product slide-over deep link — same page, pre-opens the detail panel. */}
      <Route path="/plans-and-pricing/:productId" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <ProductsPage />)} />
      {/* Legacy /products redirects — keep for any saved links or external references. */}
      <Route path="/products" element={<Navigate to="/plans-and-pricing" replace />} />
      <Route path="/products/:productId" element={<Navigate to="/plans-and-pricing" replace />} />
      {/* One-time cart checkout + post-checkout confirmation (auth-protected). */}
      <Route path="/checkout" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <CheckoutPage />)} />
      <Route path="/checkout/confirmation" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <CheckoutConfirmationPage />)} />
      <Route path="/deals" element={guard(['admin', 'partner', 'investor'], investorWorkspace('deals', <DealsPage />))} />

      {/* ── Deals · the four stages, as four routes ──────────────────────────
          The zone slugs are InvestorDealsWorkspace's own anchor ids with the
          prefix stripped — the canvas took them from there. Four deep-linkable
          URLs replacing five that never said which stage you were on; the
          workspace still renders all four sections and the route scrolls to
          one. Splitting it into four pages is a content decision, not a
          routing one. */}
      <Route path="/deals/pipeline" element={guard(['admin', 'partner', 'investor'], <InvestorDealsRoutes />)} />
      <Route path="/deals/screening" element={guard(['admin', 'investor'], <InvestorDealsRoutes />)} />
      <Route path="/deals/commit" element={guard(['admin', 'investor'], <InvestorDealsRoutes />)} />
      <Route path="/deals/closing" element={guard(['admin', 'investor'], <InvestorDealsRoutes />)} />
      <Route path="/deals/:dealId" element={guard(['admin', 'partner', 'investor', 'founder'], investorWorkspace('deals', <DealRoomPage />))} />
      <Route path="/market-intel" element={guard(labRoles(['admin', 'partner', 'investor']), effectiveRole === 'investor'
        ? <InvestorResearchWorkspace />
        : investorWorkspace('research', <FounderWorkspaceTabs set="research" user={user}><MarketIntelPage /></FounderWorkspaceTabs>))} />
      <Route path="/advisory" element={guard(['admin', 'founder'], <FounderWorkspaceTabs set="validate" user={user}><AdvisoryPage /></FounderWorkspaceTabs>)} />
      {/* Team Building consolidation (Build › Team). Founders reach Advisor/
          Advisor, Co-Founder and Jobs through the unified /build/team
          workspace; the legacy standalone routes stay live for every other
          role but redirect a founder into the matching tab so old deep links
          keep resolving. */}
      <Route path="/build/team" element={guard(['admin', 'founder'], founderGrowLanding ? <FounderGrowDesk /> : founderWorkspace('grow', <FounderWorkspaceTabs set="grow" user={user}><TeamBuildingPage /></FounderWorkspaceTabs>))} />
      <Route path="/grow/focus" element={guard(['admin', 'founder'], <FounderGrowFocus />)} />
      <Route path="/grow/talent" element={guard(['admin', 'founder'], <FounderGrowTalent />)} />
      <Route path="/grow/customers" element={guard(['admin', 'founder'], <FounderGrowCustomers />)} />
      <Route path="/grow/partnerships" element={guard(['admin', 'founder'], <FounderGrowPartnerships />)} />
      <Route path="/grow/capital-match" element={guard(['admin', 'founder'], <FounderGrowCapitalMatch />)} />
      <Route path="/grow/brand" element={guard(['admin', 'founder'], <FounderGrowBrand />)} />
      <Route path="/grow/launch" element={guard(['admin', 'founder'], <FounderGrowLaunch />)} />
      <Route path="/build/command-center" element={guard(labRoles(['admin', 'founder']), <Navigate to="/studio" replace />)} />
      {/* Task #74 — back-compat redirect from the pre-rename /mentors path. */}
      <Route path="/mentors" element={<Navigate to="/advisors" replace />} />
      <Route path="/advisors" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), user?.role === 'founder' ? <Navigate to="/build/team?tab=advisor" replace /> : <AdvisorsPage />)} />
      <Route path="/office-hours" element={guard(['admin', 'advisor'], advisorPrivateWorkspace(effectiveRole === 'advisor' ? <AdvisorExpertiseWorkspace /> : <OfficeHoursPage />))} />
      <Route path="/partner/office-hours" element={guard(['admin', 'partner'], partnerPrivateWorkspace(<PartnerWorkspaceTabs set="offers" user={user}><PartnerOfficeHoursPage /></PartnerWorkspaceTabs>))} />
      <Route path="/comarketing" element={guard(['admin', 'partner', 'founder', 'investor'], partnerPrivateWorkspace(effectiveRole === 'founder' ? founderWorkspace('grow', <FounderWorkspaceTabs set="grow" user={user}><CoMarketingPage user={user} /></FounderWorkspaceTabs>) : <PartnerWorkspaceTabs set="offers" user={user}><CoMarketingPage user={user} /></PartnerWorkspaceTabs>))} />
      <Route path="/calendar" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <CalendarPage />)} />
      {/* Task #40 (E2) — Event host/attendee surface. */}
      <Route path="/my/events" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <MyEventsPage />)} />
      <Route path="/events/new" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <EventEditorPage />)} />
      <Route path="/events/:id/edit" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <EventEditorPage />)} />
      <Route path="/events/:id/manage" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <EventManagePage />)} />
      <Route path="/my/jobs" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], user?.role === 'founder' ? <Navigate to="/build/team?tab=jobs" replace /> : <MyJobsPage />)} />
      <Route path="/my/applications" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <MyApplicationsPage />)} />
      <Route path="/jobs/new" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <JobEditorPage />)} />
      <Route path="/jobs/:id/edit" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <JobEditorPage />)} />
      <Route path="/jobs/:id/manage" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <JobManagePage />)} />
      <Route path="/cofounder" element={guard(labRoles(['admin', 'founder']), user?.role === 'founder' ? <Navigate to="/build/team?tab=cofounder" replace /> : <CofounderPage />)} />
      {/* Task #20 — Consolidated profile/advisor flow. The advisor conversation
          now builds the skill + values profile; the legacy /skills and /values
          routes redirect here (underlying data stores kept intact). */}
      <Route path="/skills" element={<Navigate to="/studio" replace />} />
      <Route path="/values" element={<Navigate to="/studio" replace />} />
      <Route path="/portfolio/health" element={guard(['admin', 'founder', 'partner', 'investor'], investorWorkspace('portfolio', <PortfolioWorkspace activeRole={effectiveRole} />))} />
      {/* Task #18 — Partner Coverage Analytics (admin/partner-only internal dashboard). */}
      <Route path="/portfolio/coverage" element={guard(['admin', 'partner'], <PortfolioCoveragePage />)} />
      {/* Task #10 — portfolio Venture Risk matrix (internal deal team). */}
      <Route path="/portfolio/risk-matrix" element={guard(['admin', 'partner', 'investor'], <RiskMatrixPage />)} />
      <Route path="/watchlist" element={guard(['admin', 'partner', 'investor'], <WatchlistJournalPage />)} />
      <Route path="/activity" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <ActivityPage />)} />
      <Route path="/kyc" element={guard(['admin', 'founder', 'partner', 'investor'], <KYCPage />)} />
      {/* 'advisor' belongs here: services/trust.ts ROLE_MATRIX gives advisors four
          obligations — two of them REQUIRED (mentor_nda_v1,
          mentor_disclaimer_v1) — and the Trust Center link in the user dropdown
          carries no role gating, so every advisor could see the link, click it,
          and be bounced off the only page listing what they owe. */}
      <Route path="/trust" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], investorWorkspace('trust', <TrustCenterPage />))} />
      <Route path="/api-bridge" element={guard(['admin'], <ApiBridgePage />)} />
      <Route path="/monitoring" element={guard(['admin'], <MonitoringPage />)} />
      <Route path="/liquidity" element={guard(['admin', 'founder', 'partner', 'investor'], founderWorkspace('raise', <FounderWorkspaceTabs set="raise" user={user}><LiquidityPage currentUser={user} /></FounderWorkspaceTabs>))} />
      <Route path="/funds" element={guard(['admin', 'investor'], effectiveRole === 'investor' ? <InvestorFundLanding fundUnlocked={hasInvestorTier(user, 'institutional')} /> : <FundOpsWorkspace />)} />
      <Route path="/funds/capital-calls" element={guard(['admin', 'investor'], investorFundWorkspace(<FundOpsWorkspace />))} />
      <Route path="/lp-portal" element={guard(['admin', 'investor'], investorWorkspace('axal-vc-fund', <LPPortalPage />))} />
      {/* Spin-Out Fund I LP participation workspace — a Fund Ops tab, so it
          renders inside the same investor shell as the other fund surfaces. */}
      <Route path="/funds/lp-workspace" element={guard(['admin', 'investor'], investorFundWorkspace(<FundOpsWorkspace />))} />
      <Route path="/portfolio/reserves" element={guard(['admin', 'investor'], <FundModelingWorkspace />)} />
      <Route path="/portfolio/waterfall" element={guard(['admin', 'investor'], <FundModelingWorkspace />)} />
      {/* Task #18 — investor-lifecycle features ported from PR #119. */}
      <Route path="/ic" element={guard(['admin', 'partner', 'investor'], <ICDecisionsPage />)} />
      <Route path="/ic/:uid" element={guard(['admin', 'partner', 'investor'], <ICDecisionPage />)} />
      <Route path="/lp-reports" element={guard(['admin', 'investor'], investorFundWorkspace(<FundOpsWorkspace />))} />
      <Route path="/portfolio/updates" element={guard(['admin', 'partner', 'investor', 'founder'], investorWorkspace('portfolio', <PortfolioWorkspace activeRole={effectiveRole} />))} />
      <Route path="/portfolio/positions" element={guard(['admin', 'investor'], investorWorkspace('portfolio', <PortfolioWorkspace activeRole={effectiveRole} />))} />
      {/* Advisor sections shell — three tabbed workspaces (Network, Advisory,
          Research) scoped to the advisor (and admin) roles. Each tab deep-links
          to its own route; the workspace derives the active tab from the URL.
          Bare section paths redirect to their first tab so every workspace is
          reachable by direct URL and by clicking the sidebar. */}
      {/* documentation/architecture/DECISIONS.md D10 — /network is the one network surface. These three
          tabs were the ones every role's sidebar linked, and none of them
          worked: Introductions and Organizations called /api/network-introductions
          and /api/organizations, neither of which the worker mounts, and
          Relationships rendered from a fixture with no API calls at all.
          Meanwhile /network's three panels are wired to contacts.ts,
          introductions.ts and partnernet.ts and have worked throughout.
          Introductions and Relationships map onto real tabs; Organizations has
          no counterpart — it never returned data, so nothing is lost by
          landing on the page's default tab. */}
      <Route path="/advisor/network" element={<Navigate to="/network" replace />} />
      <Route path="/advisor/network/introductions" element={<Navigate to="/network?tab=introductions" replace />} />
      <Route path="/advisor/network/relationships" element={<Navigate to="/network?tab=relationships" replace />} />
      <Route path="/advisor/network/organizations" element={<Navigate to="/network" replace />} />

      {/* ── Advisor · Practice, Cohorts, Expertise ───────────────────────────
          Three of Practice's five zones mount the live /advisor/advisory
          workspace; Sessions and Earnings have no store and say so. Cohorts is
          entirely new and reads Spin-Out Lab data read-only — it owns no Lab
          route and writes nothing back. Expertise mounts the live workspace
          that /office-hours already serves. The legacy /advisor/advisory/* and
          /office-hours routes stay: Clients and Contracts are working tabs the
          canvas has no zone for. */}
      <Route path="/practice" element={<Navigate to="/practice/opportunities" replace />} />
      <Route path="/practice/opportunities" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes />)} />
      <Route path="/practice/engagements" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes />)} />
      <Route path="/practice/delivery" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes />)} />
      <Route path="/practice/sessions" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes />)} />
      <Route path="/practice/earnings" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes />)} />
      <Route path="/cohorts" element={<Navigate to="/cohorts/founders" replace />} />
      <Route path="/cohorts/founders" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes />)} />
      <Route path="/cohorts/guidance" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes />)} />
      <Route path="/cohorts/this-week" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes />)} />
      <Route path="/cohorts/calendar" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes />)} />
      <Route path="/cohorts/outcomes" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes />)} />
      <Route path="/expertise" element={<Navigate to="/expertise/profile" replace />} />
      <Route path="/expertise/profile" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes />)} />
      <Route path="/expertise/services" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes />)} />
      <Route path="/expertise/proof" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes />)} />
      <Route path="/expertise/thinking" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes />)} />
      <Route path="/expertise/visibility" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes />)} />

      <Route path="/advisor/advisory" element={<Navigate to="/advisor/advisory/opportunities" replace />} />
      <Route path="/advisor/advisory/opportunities" element={guard(['admin', 'advisor'], advisorPrivateWorkspace(<AdvisorAdvisoryWorkspace />))} />
      <Route path="/advisor/advisory/clients" element={guard(['admin', 'advisor'], advisorPrivateWorkspace(<AdvisorAdvisoryWorkspace />))} />
      <Route path="/advisor/advisory/engagements" element={guard(['admin', 'advisor'], advisorPrivateWorkspace(<AdvisorAdvisoryWorkspace />))} />
      <Route path="/advisor/advisory/delivery" element={guard(['admin', 'advisor'], advisorPrivateWorkspace(<AdvisorAdvisoryWorkspace />))} />
      <Route path="/advisor/advisory/contracts" element={guard(['admin', 'advisor'], advisorPrivateWorkspace(<AdvisorAdvisoryWorkspace />))} />
      {/* documentation/architecture/DECISIONS.md D12 — the Research row is /market-intel and nothing else.
          D8 redirected the market tab; D9 withdrew the funds tab; D12 withdrew
          the remaining four (companies, AI research, news, documents) for the
          same reason D9 gave, having corrected D9's own per-tab table.

          D9 recorded news and ai as having real backends. They do not, in the
          sense that matters: `news.ts` is the platform's article authoring
          pipeline (draft / submit / retract / cover), while the tab rendered a
          third-party industry feed with sentiment and company tagging;
          `assistant.ts` is a conversational chat surface, while the tab
          rendered SWOTs, market maps, company reports and comparables. Both
          were matched on the tab's NAME, not on its material. Companies needed
          thirteen datasets and had one (per-project competitor analysis);
          documents had `files.ts` — a single signed-download endpoint, not a
          library.

          `/advisor/research` now lands on the one research surface that is
          real. The four withdrawn tabs are removed rather than redirected
          there: /market-intel has no company, document or news data either,
          so pointing "Companies" at it would swap a blank surface for a
          misleading one. They return when a data source is licensed. */}
      <Route path="/advisor/research" element={<Navigate to="/signals" replace />} />
      <Route path="/advisor/research/market" element={<Navigate to="/signals" replace />} />

      {/* ── Partner · Pipeline, Delivery, Offers ─────────────────────────────
          Nine of these fifteen zones already have a live surface, spread over
          five prefixes that share no logic. The six that do not say what they
          would hold.

          /pipeline is a SHARED prefix and that is deliberate: the investor
          shell has held /pipeline, /pipeline/screening, /pipeline/commit and
          /pipeline/transactions for a long time. The two sets share no slug and
          bucketForPath is role-scoped, so each licence resolves to its own
          bucket. Check both lists before adding a sixth slug to either.

          The legacy /partner/operations/*, /needs, /services, /perks and
          /partner/insights routes all stay mounted — retiring that prefix is an
          open decision, not this migration's to take. */}
      <Route path="/pipeline/leads" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/pipeline/proposals" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/pipeline/negotiations" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/pipeline/retainers" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/pipeline/analytics" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/delivery/board" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/delivery/deliverables" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/delivery/capacity" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/delivery/status-reports" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/delivery/health" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/offers/catalog" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/offers/perk-deals" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/offers/visibility" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/offers/proof" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/offers/audience-fit" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/delivery" element={<Navigate to="/delivery/board" replace />} />
      <Route path="/offers" element={<Navigate to="/offers/catalog" replace />} />

      <Route path="/partner/operations" element={<Navigate to="/partner/operations/overview" replace />} />
      <Route path="/partner/operations/overview" element={guard(['admin', 'partner'], partnerPrivateWorkspace(<PartnerOperationsWorkspace />))} />
      <Route path="/partner/operations/capabilities" element={guard(['admin', 'partner'], partnerPrivateWorkspace(<PartnerOperationsWorkspace />))} />
      <Route path="/partner/operations/portfolio" element={guard(['admin', 'partner'], partnerPrivateWorkspace(<PartnerOperationsWorkspace />))} />
      <Route path="/partner/operations/engagements" element={guard(['admin', 'partner'], partnerPrivateWorkspace(<PartnerOperationsWorkspace />))} />
      <Route path="/partner/operations/performance" element={guard(['admin', 'partner'], partnerPrivateWorkspace(<PartnerOperationsWorkspace />))} />
      {/* Task #5 — investor lifecycle sections now live. Pipeline stages render
          the tabbed PipelineWorkspace; portfolio/funds analytics render as tabs
          within their existing workspaces. Investor-scoped (admin can view). */}
      <Route path="/pipeline/screening" element={guard(['admin', 'investor'], investorWorkspace('deals', <PipelineWorkspace />))} />
      <Route path="/pipeline/commit" element={guard(['admin', 'investor'], investorWorkspace('deals', <PipelineWorkspace />))} />
      <Route path="/pipeline/transactions" element={guard(['admin', 'investor'], investorWorkspace('deals', <PipelineWorkspace />))} />
      <Route path="/portfolio/performance" element={guard(['admin', 'investor'], investorWorkspace('portfolio', <PortfolioWorkspace activeRole={effectiveRole} />))} />
      <Route path="/portfolio/growth" element={guard(['admin', 'investor'], investorWorkspace('portfolio', <PortfolioWorkspace activeRole={effectiveRole} />))} />
      <Route path="/portfolio/value-add" element={guard(['admin', 'investor'], investorWorkspace('portfolio', <PortfolioWorkspace activeRole={effectiveRole} />))} />
      <Route path="/funds/performance" element={guard(['admin', 'investor'], investorFundWorkspace(<FundOpsWorkspace />))} />
      <Route path="/funds/accounting" element={guard(['admin', 'investor'], investorFundWorkspace(<FundOpsWorkspace />))} />
      <Route path="/funds/lps" element={guard(['admin', 'investor'], investorFundWorkspace(<InvestorFundLPs />))} />
      <Route path="/funds/calls" element={guard(['admin', 'investor'], investorFundWorkspace(<InvestorFundCalls />))} />
      <Route path="/funds/ledger" element={guard(['admin', 'investor'], investorFundWorkspace(<InvestorFundAccounting />))} />
      <Route path="/funds/reporting" element={guard(['admin', 'investor'], investorFundWorkspace(<InvestorFundReporting />))} />
      {/* Task #1 — Contacts merged into the unified Network page. The legacy
          /contacts route now redirects into the Contacts tab. */}
      <Route path="/contacts" element={<Navigate to="/network?tab=contacts" replace />} />
      {/* Raise pipeline — investor contacts promoted from the Contacts hub. */}
      {/* Task #1 — RAISE Workspaces: legacy /raise (Raise Pipeline) now lives in
          the Capital workspace pipeline tab. */}
      {/* Raise zone root — A4's desk.
          `724dfc9f` rebuilt the Raise SECTIONS as six dedicated pages
          (Status · Pitch · Capital · Legal · Data room · Liquidity), each
          rendering the zone's section switcher, and pointed the sidebar row
          at /raise/pitch. That took over the slot A4's desk had been mounted
          in, and the desk — a zone OVERVIEW, a different level of the same
          IA — was left on disk with nothing importing it, while its four
          siblings (Build at /execution, Grow at /build/team, Network at
          /network, Research at /signals) all kept theirs.
          The zone root is where an overview belongs, and it was spending
          itself on a redirect into a sub-sub-route of Capital. Every section
          page Replit shipped is untouched; only the redirect is replaced,
          and only for a founder in landing mode. */}
      <Route path="/raise" element={founderRaiseLanding
        ? guard(labRoles(['admin', 'founder']), <FounderRaiseDesk />)
        : <Navigate to="/raise/capital/pipeline" replace />} />
      {/* Standalone Referrals page (Refer & Earn + Payouts). Legacy /refer also redirects here. */}
      <Route path="/referrals" element={guard(['admin', 'founder', 'partner', 'investor'], partnerPrivateWorkspace(<ReferralsPage />))} />
      <Route path="/refer" element={guard(['admin', 'founder', 'partner', 'investor'], <ReferRedirect />)} />
      <Route path="/company-settings" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <Suspense fallback={null}><CompanySettingsPage /></Suspense>)} />
      {/* Integrations now lives inside Settings; /integrations redirects there
          (preserving any ?query= so OAuth-return states still show). Available
          to every authenticated profile, matching the all-roles Settings tab. */}
      <Route path="/integrations" element={authOnly(<IntegrationsRedirect />)} />
      <Route path="/payouts" element={guard(['admin', 'founder', 'partner', 'investor'], <Navigate to="/referrals" replace />)} />
      <Route path="/matches" element={guard(['admin', 'partner', 'investor'], partnerPrivateWorkspace(<PartnerWorkspaceTabs set="pipeline" user={user}><MatchesPage /></PartnerWorkspaceTabs>))} />
      <Route path="/network-effects" element={guard(['admin', 'founder', 'partner', 'investor'], founderWorkspace('grow', <FounderWorkspaceTabs set="grow" user={user}><NetworkEffectsPage /></FounderWorkspaceTabs>))} />
      <Route path="/pipeline" element={guard(['admin', 'founder', 'partner', 'investor'], investorWorkspace('deals', <PipelineWorkspace />))} />
      {/* Task #1 — unified Network page (Contacts + Introductions +
          Relationships tabs). The legacy /relationships route redirects into
          the Relationships tab. Advisors are included so the Introductions
          feature (and its notification deep links) work for every user type. */}
      <Route path="/network" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], partnerPrivateWorkspace(effectiveRole === 'investor' ? <InvestorNetworkWorkspace /> : founderNetworkLanding ? <FounderNetworkDesk /> : founderWorkspace('network', <NetworkPage />, { hideHeader: true })))} />
      {/* ── Network · three zones, every licence ─────────────────────────────
          These were guarded ['admin','founder'] because they were built for
          the founder shell and nothing else linked them. All four canvases
          specify this bucket, so the shell config renders a pill for each zone
          in every shell — and three of the four licences were being bounced to
          their default path when they clicked one. Widened and role-branched:
          founders keep their three dedicated pages, investors get
          InvestorNetworkWorkspace, advisors and operators get the same
          NetworkPage /network already gives them. */}
      <Route path="/network/relationships" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <NetworkWorkspace role={networkRole} />)} />
      <Route path="/network/introductions" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <NetworkWorkspace role={networkRole} />)} />
      <Route path="/network/organizations" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <NetworkWorkspace role={networkRole} />)} />
      <Route path="/relationships" element={<Navigate to="/network?tab=relationships" replace />} />
      <Route path="/legal-capital" element={guard(['admin', 'founder', 'partner', 'investor'], <LegalCapitalPage />)} />
      {/* Task #17 — the investor sidebar no longer surfaces "Investor Portal"
          (redundant with Studio). Investors hitting the old bookmark are
          redirected to /studio; admin/partner keep the LP/capital-call surface. */}
      <Route path="/partner-portal" element={guard(['admin', 'partner', 'investor'], partnerPrivateWorkspace(user?.role === 'investor' ? <Navigate to="/studio" replace /> : <PartnerPortal />))} />
      {/* Task #9 (X-2) — Deal-specific Partner Portal (referral code,
          granted tiers, redemption count). Distinct from the legacy
          /partner-portal which keeps the LP/capital-call surface. */}
      <Route path="/partners/portal" element={guard(['admin', 'partner'], partnerPrivateWorkspace(<PartnerDealPortal />))} />
      {/* Task #2 (DD) — Direct-URL guard for admin docs. Non-admins
          (or anonymous visitors) hitting /docs/admin/* see a Not Found
          screen so the page literally pretends not to exist; admins are
          redirected into the hash-anchored docs surface. */}
      <Route path="/docs/admin/*" element={<AdminDocsPathGuard />} />
      <Route path="/docs" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <DocsPage />)} />
      {/* Task #17 — investor "Profile" nav lands on the self-profile surface
          (the Settings profile section rendered at its own path so the sidebar
          item highlights independently of Settings). */}
      <Route path="/profile" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <SettingsPage />)} />
      <Route path="/settings" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <SettingsPage />)} />

      {/* Task #53 — Public partner directory + profiles (no auth). The
          static /partners route below takes precedence over /partners/:slug
          per React Router v6 path ranking, so authenticated users still
          land on the internal CRM at /partners. */}
      <Route path="/directory" element={<PublicDirectoryPage />} />
      {/* Task #9 — Public Network layer: Communities & Circles (curated). */}
      <Route path="/circles" element={<CirclesPage />} />
      <Route path="/communities" element={<Navigate to="/circles" replace />} />
      <Route path="/partners/:slug" element={<PublicPartnerProfilePage />} />
      {/* Task #55 — Public profile pages, unauthenticated, role-tailored. */}
      <Route path="/u/:handle" element={<PublicProfilePage />} />
      <Route path="/startups/:handle" element={<PublicStartupProfilePage />} />
      {/* Task #5 — Public event surface (no auth). */}
      <Route path="/events" element={<PublicEventsPage />} />
      <Route path="/events/:slug" element={<PublicEventDetailPage />} />
      <Route path="/jobs" element={<PublicJobsPage />} />
      <Route path="/jobs/:slug" element={<PublicJobDetailPage />} />
      <Route path="/invite/:token" element={<InviteRsvpPage />} />

      <Route path="/terms" element={<TermsPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/about" element={<TeamPage />} />
      <Route path="/team" element={<Navigate to="/about" replace />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/risk-disclosures" element={<RiskDisclosuresPage />} />
      {/* Task #4 (ID) — Public marketing surfaces. No auth. */}
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/demo" element={<DemoPage />} />
      <Route path="/status" element={<StatusPage />} />
      <Route path="/changelog" element={<ChangelogPage />} />
      {/* Public credential verification — unauthenticated by design. */}
      <Route path="/verify/:token" element={<PublicCertificateVerifyPage />} />
      <Route path="/roadmap" element={<PublicRoadmapPage />} />
      <Route path="/academy/:slug" element={guard(['admin', 'founder', 'partner', 'investor'], <AcademyLessonPage />)} />
      <Route path="/academy" element={guard(['admin', 'founder', 'partner', 'investor'], <AcademyLessonPage />)} />
      {/* Audience-specific landing page templates. */}
      <Route path="/lp/founder" element={<FounderHomePage />} />
      <Route path="/lp/customer-discovery" element={<CustomerDiscoveryHomePage />} />
      <Route path="/lp/investor" element={<InvestorDealflowHomePage />} />
      <Route path="/lp/partner" element={<PartnerPartnershipHomePage />} />
      <Route path="/lp/spinout-demo-day" element={<SpinoutDemoDayPage />} />
      {/* Task #11 — Catch-all 404. Must stay LAST so it only matches when no
          other route (public, alias, or guarded) does. */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
</RouteErrorBoundary>
</Suspense>
  );
}

// Task #6 — Mount the tier paywall once at the app shell so any 402
// `tier_required` response (or sidebar lock click) opens the same modal.
function GlobalPaywallMount() {
  const { user } = useAuth();
  return <PaywallModal user={user} />;
}

// Founder-only global listener — lazy + gated on auth so a logged-out visitor
// (e.g. the landing page) never downloads its chunk. The `spinout-lab:advanced`
// events it reacts to are only ever dispatched by authenticated founder actions.
function GlobalSpinoutLabListenerMount() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <Suspense fallback={null}>
      <SpinoutLabListener />
    </Suspense>
  );
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

// Top-level safety net for AppInner itself. RouteErrorBoundary already
// protects every component rendered inside <Routes>; this boundary catches
// the rarer case where AppInner's own hooks or top-of-render expressions
// throw (e.g. a bad hook call, a context consumer outside its provider).
// Without it those crashes blank the entire page with no visible message.
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    try {
      // eslint-disable-next-line no-console
      console.error('[AppErrorBoundary] top-level crash:', error, info?.componentStack);
    } catch { /* ignore */ }
  }
  render() {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error?.message || String(this.state.error);
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', padding: '2rem' }}>
        <div style={{ maxWidth: 520, border: '1px solid #fca5a5', borderRadius: 12, background: '#fff1f2', padding: '1.5rem' }}>
          <strong style={{ display: 'block', marginBottom: '0.5rem', color: '#991b1b' }}>App failed to start</strong>
          <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#7f1d1d', margin: 0 }}>{msg}</pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: '#1f2937', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

export default function App() {
  // T20 — AuthProvider must be inside <BrowserRouter> (it uses
  // useLocation to throttle /me re-syncs to one per route change).
  // main.jsx already wraps <App /> in BrowserRouter.
  return (
    <AuthProvider>
      <SettingsProvider>
        <AppErrorBoundary>
        <AppInner />
        </AppErrorBoundary>
        {/* Task #28 — global "always-on" mounts live OUTSIDE <Routes>,
            so a render-time throw inside any of them blanks the entire
            app (every route, including /login). Wrap each in a
            SafeMount error boundary so a regression in one widget
            degrades to "that one widget is missing" instead of "the
            whole app is gone". */}
        <SafeMount name="SpinoutLabListener"><GlobalSpinoutLabListenerMount /></SafeMount>
        <SafeMount name="GlobalPaywallMount"><GlobalPaywallMount /></SafeMount>
        <SafeMount name="CookieConsent"><CookieConsent /></SafeMount>
      </SettingsProvider>
    </AuthProvider>
  );
}
