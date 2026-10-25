import LegacyContractsRedirect from './pages/admin/LegacyContractsRedirect';
import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { safeReadJSON } from './lib/storage';
import { reportError } from './lib/log';
import { preserveReloadGuards } from './lib/reloadGuard';
import { consumePendingNextOnce, markPendingNextRedirected, pendingNextRedirected } from './lib/pendingNext';
import { Routes, Route, Navigate, Link, useNavigate, useLocation, useParams } from 'react-router-dom';
import SidebarNav from './ui/SidebarNav';
import { AuthProvider, useAuth } from './hooks/useAuthSync';
import { SettingsProvider } from './contexts/SettingsContext';
import { ActiveCompanyContext } from './contexts/ActiveCompanyContext';
// ViewModeContext lives in its own module so App.jsx exports only React
// components — mixing component + hook exports breaks Vite Fast Refresh.
import ViewModeContext from './contexts/ViewModeContext';
import ViewAsBranchContext from './contexts/ViewAsBranchContext';
// Single source of truth for "which role is this session browsing as". The
// shell picks the sidebar from it and the router picks route elements from it;
// when those two disagree the nav offers one thing and the route serves another.
import { resolveActiveRole } from './lib/activeRole';
const SpinoutLabListener = lazy(() => import('./components/SpinoutLabListener'));
import SafeMount from './components/SafeMount';
import AxalLogo from './components/AxalLogo';
import CookieConsent from './components/CookieConsent';
import RouteErrorBoundary from './components/RouteErrorBoundary';
// ── Route modules (D528) ──────────────────────────────────────────────────
// A NEW area's routes live in frontend/src/routes/<area>.jsx, not here: this
// file changed in 109 of the last 624 commits and any two PRs that add a page
// collide in it. One import per module, alphabetical by file name, and one
// composition line per module in the block of the same name inside the Routes
// element below. The 409 routes already here stay here (156 tests read this
// file by path, and several slice it at the Routes element's opening tag, so
// that tag is not written in prose here). See frontend/src/routes/README.md;
// routes_modules_d528.test.mjs fails the build for a module that is not wired in.
import learningRoutes from './routes/learning';
import BranchDigestRedirect from './pages/branch/BranchDigestRedirect';
import HqCreditsRedirect from './pages/hq/HqCreditsRedirect';
import { useRedirectBeacon } from './lib/redirectBeacon';
// ── end route modules ─────────────────────────────────────────────────────
import {
  Menu,
  Shield,
  ChevronDown, Eye, Sparkles,
  Gift, Mail, Globe
} from 'lucide-react';
import { SIDEBAR_GROUPS, filterItemsByTier, hasInvestorTier, FOUNDER_FULL_BLEED, INVESTOR_FULL_BLEED, ADVISOR_FULL_BLEED, PARTNER_FULL_BLEED, SHARED_FULL_BLEED, SHARED_FULL_BLEED_PREFIXES, ONBOARDING_CANVAS_PATHS } from './sidebarConfig';
import { isCyclePath } from './pages/cycles/cyclePaths';
import { BOUNDARY_ROLES as NARRATIVE_BOUNDARY_ROLES } from './pages/raise/narrative/narrativeModel';
import { adminRefusal } from './pages/hq/hqNoticeModel';
import PaywallModal from './components/PaywallModal';
import AdminFrozenBar from './components/AdminFrozenBar';
import BranchSuspendedBar from './components/BranchSuspendedBar';
import HqSupportSessionBar from './components/HqSupportSessionBar';
import HqViewingAsBar from './components/HqViewingAsBar';
import BranchNotDeployedBar from './components/BranchNotDeployedBar';
// D504 — the phone's tab bar (D425), mounted by the shell beside the drawer's
// backdrop. It takes the shell role AS RESOLVED, never the sidebar's
// `|| 'founder'` default: a viewer with no role gets no bar.
import MobileTabBar from './components/MobileTabBar';
import { HeaderForWidth } from './ui/phone/PhoneHeader';
import { CompanyVisits } from './ui/phone/CompanySheet';
import ImpersonationBar from './components/ImpersonationBar';
import useBranchDeployment from './hooks/useBranchDeployment';
import { LensProvider, useLensLocation } from './workspaces/lens';
import HqSubNavStrip, { StripLink } from './components/HqSubNavStrip';
import { RailStripSlot } from './ui/RailFrame';
import { RailPageProvider } from './ui/railCrumbs';
import { MESSAGES_ROLES } from './lib/paletteIndex';
import { stripFor } from './lib/hqStrips';
import { clearSupportSession } from './lib/supportSession';
import { disablePush } from './lib/pwa';
import { readStoredReason, clearStoredReason } from './lib/impersonationBar';
import { api, initActiveCompanyId, setActiveCompanyId } from './lib/api';
// Task #8 — NotFoundPage is imported eagerly (not lazy) so the catch-all 404
// renders synchronously on first paint. It marks itself a no-auth-redirect
// surface on mount; a lazy chunk could load AFTER the background settings 401
// returns, racing the flag and still bouncing logged-out visitors to /login.
import NotFoundPage from './pages/NotFoundPage';
import { ParamRedirect } from './pages/cycles/ParamRedirect.jsx';
import { ValidateZoneRedirect } from './pages/cycles/ValidateZoneRedirect.jsx';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ArchetypeCardPage = lazy(() => import('./pages/ArchetypeCardPage'));

// The four workspace shells, rebuilt from the design canvases. The IA itself
// lives in src/workspaces/shellConfig.js — the sidebar, the zone nav and a
// guard test all read that one file, so a row can never advertise a door the
// router does not open.
// D660 (#1473) — one interview session: record, live transcript, review.
const InterviewSessionPage = lazy(() => import('./pages/founder/InterviewSessionPage'));
// D684 (#1578) — customer chats from business Telegram and WhatsApp, waiting for an interview.
const ChannelsInboxPage = lazy(() => import('./pages/founder/ChannelsInbox'));
const ResearchWorkspace = lazy(() => import('./workspaces/ResearchWorkspace'));
const FundDossier = lazy(() => import('./pages/research/FundDossier'));
const FundCatalogProfile = lazy(() => import('./pages/research/FundCatalogProfile'));
const CompanyCandidate = lazy(() => import('./pages/research/CompanyCandidate'));
const CompanyAnalysis = lazy(() => import('./pages/research/CompanyAnalysis'));
const CompanyProfile = lazy(() => import('./pages/research/CompanyProfile'));
const BenchmarkDetail = lazy(() => import('./pages/research/BenchmarkDetail'));
const MarketReading = lazy(() => import('./pages/research/MarketReading'));
const MarketSectorProfile = lazy(() => import('./pages/research/MarketSectorProfile'));
const GeographyProfile = lazy(() => import('./pages/research/GeographyProfile'));
const DiligenceRoom = lazy(() => import('./pages/research/DiligenceRoom'));
const DiligenceFile = lazy(() => import('./pages/research/DiligenceFile'));
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
const AcceptCompanyInvitePage = lazy(() => import('./pages/AcceptCompanyInvitePage'));
const AcceptInvestorSeatPage = lazy(() => import('./pages/AcceptInvestorSeatPage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));
const IncorporatePage = lazy(() => import('./pages/IncorporatePage'));
const IncorporateSuccessPage = lazy(() => import('./pages/IncorporateSuccessPage'));
const CofounderAgreementPage = lazy(() => import('./pages/CofounderAgreementPage'));
const SpinoutLab83bPage = lazy(() => import('./pages/SpinoutLab83bPage'));
const SpinoutLabCompliancePage = lazy(() => import('./pages/SpinoutLabCompliancePage'));
const CompliancePage = lazy(() => import('./pages/CompliancePage'));
const WellbeingPage = lazy(() => import('./pages/WellbeingPage'));
const WellbeingBookPage = lazy(() => import('./pages/wellbeing/WellbeingBookPage'));
const WellbeingResourceLibrary = lazy(() => import('./pages/wellbeing/WellbeingResourceLibrary'));
const ExpertProfilePage = lazy(() => import('./pages/ExpertProfilePage'));
const ExpertEditorPage = lazy(() => import('./pages/ExpertEditorPage'));
const TicketsPage = lazy(() => import('./pages/TicketsPage'));
const DealsPage = lazy(() => import('./pages/DealsPage'));
const DealRoomPage = lazy(() => import('./pages/DealRoomPage'));
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
// D286 — the five landings of the Admin shell on accounts HQ holds directly
// (canvas S20). Under /admin/held/ so none can collide with an HQ console:
// /admin/accounts is HQ's Team, and the HQ consoles are flat /admin/<noun>.
const HeldAccounts = lazy(() => import('./pages/admin/HeldAccounts'));
const HeldApprovals = lazy(() => import('./pages/admin/HeldApprovals'));
// D953 (#2371) — Admin › Programs: the catalogue, one page per program with its
// tabs as sub-paths, and the three old addresses' redirects.
const AdminProgramsCatalogue = lazy(() => import('./pages/admin/programs/ProgramsCatalogue'));
const AdminMentorCohortAccess = lazy(() => import('./pages/admin/programs/MentorCohortAccess'));
const AdminReferAndEarn = lazy(() => import('./pages/admin/programs/ReferAndEarn'));
const AdminProgramPage = lazy(() => import('./pages/admin/programs/ProgramPage'));
const HeldProgramsRedirect = lazy(() => import('./pages/admin/programs/HeldProgramsRedirect'));
const AdvisorCohortsRedirect = lazy(() => import('./pages/admin/programs/AdvisorCohortsRedirect'));
const ReferEarnRedirect = lazy(() => import('./pages/admin/programs/ReferEarnRedirect'));
const AdminCommunity = lazy(() => import('./pages/admin/community/AdminCommunity'));
const HeldCommunityRedirect = lazy(() => import('./pages/admin/community/HeldCommunityRedirect'));
const PitchPositioningRedirect = lazy(() => import('./pages/raise/narrative/PitchPositioningRedirect'));
const AdminInsights = lazy(() => import('./pages/admin/insights/AdminInsights'));
const HeldInsightsRedirect = lazy(() => import('./pages/admin/insights/HeldInsightsRedirect'));
const AdminLpApplications = lazy(() => import('./pages/admin/AdminLpApplications'));
const AdminLicences = lazy(() => import('./pages/admin/AdminLicences'));
const ProgramGrants = lazy(() => import('./pages/admin/grants/ProgramGrants'));
const AdvisorsPartners = lazy(() => import('./pages/admin/advisors/AdvisorsPartners'));
// D989 (#2380): Partner profiles, out of the Admin Console, under Approvals.
const PartnerProfiles = lazy(() => import('./pages/admin/profiles/PartnerProfiles'));
// D997 (#2378): Persona segments, out of the Admin Console, under Accounts (HQ: Content).
const PersonaSegments = lazy(() => import('./pages/admin/segments/PersonaSegments'));
// D1008 (#2386): Payments, out of the Admin Console, under Platform, HQ only.
const Payments = lazy(() => import('./pages/admin/payments/Payments'));
const ApRedirect = lazy(() => import('./pages/admin/advisors/ApRedirect'));
const FirmLinksRedirect = lazy(() => import('./pages/admin/advisors/FirmLinksRedirect'));
// Task #102 — Spin-Out Lab admin dashboard (applications + participants).
const AdminLab = lazy(() => import('./pages/admin/lab/AdminLab'));
const LabRedirect = lazy(() => import('./pages/admin/lab/LabRedirect'));
const LabPreviewRedirect = lazy(() => import('./pages/admin/lab/LabPreviewRedirect'));
const SpinoutModerationPage = lazy(() => import('./pages/admin/SpinoutModerationPage'));
const AdminSpinoutJourneyPreview = lazy(() => import('./pages/admin/AdminSpinoutJourneyPreview'));
const AdminTelegram = lazy(() => import('./pages/admin/AdminTelegram'));
const AdminX = lazy(() => import('./pages/admin/AdminX'));
// Task #1 — Articles surfaces (public + author + admin queue).
const ArticlesPage = lazy(() => import('./pages/ArticlesPage'));
const ArticleReaderPage = lazy(() => import('./pages/ArticleReaderPage'));
const ArticleAuthorPage = lazy(() => import('./pages/ArticleAuthorPage'));
const AuthorProfilePage = lazy(() => import('./pages/AuthorProfilePage'));
const ArticlesQueuePage = lazy(() => import('./pages/admin/ArticlesQueuePage'));
const AdminPublicationNew = lazy(() => import('./pages/admin/PublicationNew'));
const AdminPublicationDetail = lazy(() => import('./pages/admin/PublicationDetail'));
const PublicInsight = lazy(() => import('./pages/insights/PublicInsight'));
const ActivityPage = lazy(() => import('./pages/ActivityPage'));
// D938 (#2743) — the Admin Console's tools, each a page at its own address.
const AllAccountsPage = lazy(() => import('./pages/admin/ConsolePages').then((m) => ({ default: m.AllAccountsPage })));
const KycPage = lazy(() => import('./pages/admin/ConsolePages').then((m) => ({ default: m.KycPage })));
const DirectoryPage = lazy(() => import('./pages/admin/ConsolePages').then((m) => ({ default: m.DirectoryPage })));
const AdminWellbeingPage = lazy(() => import('./pages/admin/ConsolePages').then((m) => ({ default: m.AdminWellbeingPage })));
const BankAccountsPage = lazy(() => import('./pages/admin/ConsolePages').then((m) => ({ default: m.BankAccountsPage })));
const ProductTestingHqPage = lazy(() => import('./pages/admin/ConsolePages').then((m) => ({ default: m.ProductTestingHqPage })));
const PromoCodesPage = lazy(() => import('./pages/admin/ConsolePages').then((m) => ({ default: m.PromoCodesPage })));
const BillingPage = lazy(() => import('./pages/admin/ConsolePages').then((m) => ({ default: m.BillingPage })));
const AdminTrashPage = lazy(() => import('./pages/AdminTrashPage'));
// D569 — the commissions-and-payouts console (canvas pea-commissions).
const AdminCommissions = lazy(() => import('./pages/admin/AdminCommissions'));
const ReferralsPage = lazy(() => import('./pages/ReferralsPage'));
const CompanySettingsPage = lazy(() => import('./pages/CompanySettingsPage'));
const AdminDueDiligencePage = lazy(() => import('./pages/AdminDueDiligencePage'));
const AdminDueDiligenceCasePage = lazy(() => import('./pages/AdminDueDiligenceCasePage'));
const DueDiligenceRequestsPage = lazy(() => import('./pages/DueDiligenceRequestsPage'));
const SharedCapTablePage = lazy(() => import('./pages/SharedCapTablePage'));
const LabReportSharePage = lazy(() => import('./pages/LabReportSharePage'));
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
const FundPage = lazy(() => import('./pages/FundPage'));
const FundReportPeriodPage = lazy(() => import('./pages/FundReportPeriodPage'));
const InvestorNetworkWorkspace = lazy(() => import('./pages/investor/InvestorNetworkWorkspace'));
const InvestorResearchWorkspace = lazy(() => import('./pages/investor/InvestorResearchWorkspace'));
const AdvisorPreviewNotice = lazy(() => import('./pages/advisor/AdvisorPreviewNotice'));
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
// Auth surfaces are imported eagerly — not lazy — so /login never depends on a
// second hashed chunk that can 404 after a deploy. That missing chunk was the
// stale-deploy case behind Safari's "This webpage was reloaded because a problem
// occurred" banner: logout and session expiry hard-navigate here, the lazy
// import fails, and three independent reload recoveries stack on top of each other.
import RegisterPage from './pages/RegisterPage';
import LoginPage from './pages/LoginPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
const NetworkIntroReviewPage = lazy(() => import('./pages/NetworkIntroReviewPage'));
import RecoverPage from './pages/RecoverPage';
const ESignPage = lazy(() => import('./pages/ESignPage'));
// Send for signature — the non-admin origination page. POST /legal/esign/send
// stopped being admin-only in task #156; this is the UI that finally matches.
const SendForSignaturePage = lazy(() => import('./pages/legal/SendForSignaturePage'));
// The subsidiary administrator's read of their own territory licence.
// Migration 190 made "which licence is this admin's?" answerable at all.
const MyLicencePage = lazy(() => import('./pages/subsidiary/MyLicencePage'));
const BranchSettings = lazy(() => import('./pages/branch/BranchSettings'));
const BranchApprovals = lazy(() => import('./pages/branch/BranchApprovals'));
// The frame every /branch/* route below renders in, and the branch tier's one
// Worker AI rail mount (D126). `BranchZone` is NOT lazily imported here: every
// branch page wraps ITSELF in it — see the notes on the branch routes below —
// so a second binding in this file had no route to serve and was removed.
const BranchAccounts = lazy(() => import('./pages/branch/BranchAccounts'));
const BranchPrograms = lazy(() => import('./pages/branch/BranchPrograms'));
const BranchCommunity = lazy(() => import('./pages/branch/BranchCommunity'));
const BranchContracts = lazy(() => import('./pages/branch/BranchContracts'));
const BranchInsights = lazy(() => import('./pages/branch/BranchInsights'));
const BranchAnalytics = lazy(() => import('./pages/branch/BranchAnalytics'));
// The Super Admin's HQ-only surfaces (migrations 199/207). `hqOnly` below
// renders the notice for an admin without the elevation.
const SuperAdminOnlyNotice = lazy(() => import('./pages/hq/SuperAdminOnlyNotice'));
const AdminOnlyNotice = lazy(() => import('./pages/hq/AdminOnlyNotice'));
const HqContractsPage = lazy(() => import('./pages/hq/ContractsPage'));
const HqAccountsPage = lazy(() => import('./pages/hq/AccountsPage'));
const HqHomePage = lazy(() => import('./pages/hq/HqHomePage'));
const HqRevenuePage = lazy(() => import('./pages/hq/RevenuePage'));
const HqDisputePage = lazy(() => import('./pages/hq/DisputePage'));
const HqContentPage = lazy(() => import('./pages/hq/ContentPage'));
const HqMeetingBotsPage = lazy(() => import('./pages/hq/MeetingBotsPage'));
const HqPlatformPage = lazy(() => import('./pages/hq/PlatformPage'));
const HqPlatformSwitchesPage = lazy(() => import('./pages/hq/PlatformSwitchesPage'));
// D642 (#1435) — U7, each plan's AI allowance and the runs held for a check.
const HqPlatformAllowancesPage = lazy(() => import('./pages/hq/PlatformAllowancesPage'));
const HqAiUsagePage = lazy(() => import('./pages/hq/AiUsagePage'));
const HqPlatformTopologyPage = lazy(() => import('./pages/hq/PlatformTopologyPage'));
// The owner's ruling (2026-10-20): the providers' keys and GitHub Sync, one
// Super Admin page and its own HQ row, no longer Admin Console tabs.
const HqIntegrationKeysPage = lazy(() => import('./pages/hq/IntegrationKeysPage'));
const HqAnalyticsPage = lazy(() => import('./pages/hq/HqAnalyticsPage'));
const HqSecurityPage = lazy(() => import('./pages/hq/SecurityPage'));
const HqSupportPage = lazy(() => import('./pages/hq/HqSupportPage'));
// D606 (#1107) — the Super Admin's review queue, the Eadwyn Tickets canvas's T1 and T1b.
const ReviewQueuePage = lazy(() => import('./pages/hq/ReviewQueuePage'));
const CreditRulesPage = lazy(() => import('./pages/hq/CreditRulesRegistryPage'));
const MemberCreditsPage = lazy(() => import('./pages/hq/MemberCreditsPage'));
const TrustObligationsPage = lazy(() => import('./pages/hq/TrustObligationsPage'));
const HqFundsPage = lazy(() => import('./pages/hq/HqFundsPage'));
// D714 (#1779) PR 4a — fund administration for the Super Admin and every Admin on HQ.
const FundAdminConsole = lazy(() => import('./pages/admin/fundAdmin/FundAdminConsole'));
const KYCPage = lazy(() => import('./pages/KYCPage'));
const TrustCenterPage = lazy(() => import('./pages/TrustCenterPage'));
const AdvisorsPage = lazy(() => import('./pages/AdvisorsPage'));
const AdvisorProfilePage = lazy(() => import('./pages/advisor/AdvisorProfilePage'));
const PublicAdvisorBookingPage = lazy(() => import('./pages/advisor/PublicAdvisorBookingPage'));
const AttestConsentPage = lazy(() => import('./pages/AttestConsentPage'));
const PartnerAttestConsentPage = lazy(() => import('./pages/PartnerAttestConsentPage'));
const PartnerOfficeHoursPage = lazy(() => import('./pages/PartnerOfficeHoursPage'));
const CoMarketingPage = lazy(() => import('./pages/CoMarketingPage'));
const CoMarketingPitchPage = lazy(() => import('./pages/CoMarketingPitchPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
// Task #40 (E2) — Event host/attendee surface.
const MyEventsPage = lazy(() => import('./pages/events/MyEventsPage'));
const EventEditorPage = lazy(() => import('./pages/events/EventEditorPage'));
const EventManagePage = lazy(() => import('./pages/events/EventManagePage'));
const MyJobsPage = lazy(() => import('./pages/jobs/MyJobsPage'));
const JobEditorPage = lazy(() => import('./pages/jobs/JobEditorPage'));
const JobManagePage = lazy(() => import('./pages/jobs/JobManagePage'));
const MyApplicationsPage = lazy(() => import('./pages/jobs/MyApplicationsPage'));
// Team (D435) — the founder's roster, advisors, hiring and coverage at
// /build/team?mode=workspace. It replaced TeamBuildingPage, whose Advisor /
// Co-Founder / Jobs tabs were the discovery surfaces; those open inside the
// Advisors and Hiring tabs here, so the founder redirects below still land.
const FounderTeamPage = lazy(() => import('./pages/founder/FounderTeamPage'));
// Task #20 — /skills and /values are consolidated into the advisor flow, and
// their routes redirect to /studio, where the profile band draws both. The two
// pages were imported by nothing and were deleted in D323.
const AdminBestFitPage = lazy(() => import('./pages/admin/AdminBestFitPage'));
// D358 — aggregates of how profiles move over time (counts only).
const AdminProfilingTrends = lazy(() => import('./pages/admin/AdminProfilingTrends'));
const NetworkPage = lazy(() => import('./pages/NetworkPage'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const SupportRedeemPage = lazy(() => import('./pages/SupportRedeemPage'));
const JoinBranchPage = lazy(() => import('./pages/JoinBranchPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const TeamPage = lazy(() => import('./pages/TeamPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const InterviewNoticePage = lazy(() => import('./pages/InterviewNoticePage'));
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
// The four audience doors (D676) render pages/site/DoorPage.jsx, which reads
// its meta from data/productPages.js and its copy from lib/siteDoors.js.
// D675–D680 (#1546) — the public site's pages, built to the owner's website
// canvas. Each renders inside components/site/SitePage.jsx.
const DoorPage = lazy(() => import('./pages/site/DoorPage'));
const FirmPage = lazy(() => import('./pages/site/FirmPage'));
const PlatformPage = lazy(() => import('./pages/site/PlatformPage'));
const AdministratorsPage = lazy(() => import('./pages/site/AdministratorsPage'));
const MethodologyPage = lazy(() => import('./pages/site/MethodologyPage'));
const IntelligencePage = lazy(() => import('./pages/site/IntelligencePage'));
const ResourcesPage = lazy(() => import('./pages/site/ResourcesPage'));
// D813 (#2259) — the newsletter's public pages: signup, confirm, and the
// preferences a link in every email opens (no sign-in).
const NewsletterPage = lazy(() => import('./pages/site/NewsletterPage'));
const NewsletterConfirmPage = lazy(() => import('./pages/site/NewsletterConfirmPage'));
const NewsletterPreferencesPage = lazy(() => import('./pages/site/NewsletterPreferencesPage'));
const DemoPage = lazy(() => import('./pages/DemoPage'));
const StatusPage = lazy(() => import('./pages/StatusPage'));
const ChangelogPage = lazy(() => import('./pages/ChangelogPage'));
const PublicCertificateVerifyPage = lazy(() => import('./pages/PublicCertificateVerifyPage'));
const MonitoringPage = lazy(() => import('./pages/MonitoringPage'));
const FundOpsWorkspace = lazy(() => import('./pages/FundOpsWorkspace'));
const PortfolioWorkspace = lazy(() => import('./pages/PortfolioWorkspace'));
const PipelineWorkspace = lazy(() => import('./pages/PipelineWorkspace'));
// Exit Waterfall renders on its own: Fund Modeling's other tab, Reserve
// Allocation, was removed on the owner's instruction (2026-10-20).
const WaterfallPage = lazy(() => import('./pages/WaterfallPage'));
const ICDecisionsPage = lazy(() => import('./pages/ICDecisionsPage'));
const ICDecisionPage = lazy(() => import('./pages/ICDecisionPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const HelpCenterPage = lazy(() => import('./pages/HelpCenterPage'));
// D144 — `/inbox`, the address `services/notify.ts` has been putting in mail
// since before any route answered it.
const InboxPage = lazy(() => import('./pages/InboxPage'));
const OnboardingPersonaPage = lazy(() => import('./pages/OnboardingPersonaPage'));
const AcademyLessonPage = lazy(() => import('./pages/AcademyLessonPage'));
const OnboardingFounderPage = lazy(() => import('./pages/OnboardingFounderPage'));
const ChooseLicencePage = lazy(() => import('./pages/ChooseLicencePage'));
// Task #178 — rendered in place by RequireAuth rather than routed to, so it
// blocks every path without an exemption list and so Decline can use the app's
// own `onLogout`. Lazy like its sibling: it is a once-per-account screen and
// does not belong in the entry chunk.
const AcceptTermsPage = lazy(() => import('./pages/AcceptTermsPage'));
// Template landing pages — audience-specific conversion surfaces.
const SpinoutDemoDayPage = lazy(() => import('./pages/templates/SpinoutDemoDayPage'));
const OnboardingInvestorPage = lazy(() => import('./pages/OnboardingInvestorPage'));
const OnboardingPartnerPage = lazy(() => import('./pages/OnboardingPartnerPage'));
const OnboardingChatPage = lazy(() => import('./pages/OnboardingChatPage'));
const BrandBuilderPage = lazy(() => import('./pages/BrandBuilderPage'));
const CompetitorAnalysisPage = lazy(() => import('./pages/CompetitorAnalysisPage'));
// D632 — a draft variant, renamed and edited in place.
const CapTableVariantsPage = lazy(() => import('./pages/CapTableVariantsPage'));
const DataRoomPage = lazy(() => import('./pages/raise/DataRoomPage'));
const MessagesPage = lazy(() => import('./pages/MessagesPage'));
// D702 (#1664) — the founder's profile pages (Studio · Mobile S6m, S7m, S9m, S10m).
const YouPage = lazy(() => import('./pages/profile/YouPage'));
const VenturePage = lazy(() => import('./pages/profile/VenturePage'));
const ProfilePreviewPage = lazy(() => import('./pages/profile/PreviewPage'));
const VisibilityPage = lazy(() => import('./pages/profile/VisibilityPage'));
const PerksPage = lazy(() => import('./pages/PerksPage'));
const FounderMarketplacePage = lazy(() => import('./pages/FounderMarketplacePage'));
// Wraps the Pipeline/Offers pages in the tab bar that lets those shell rows
// own their sections. Role-filtered — see PartnerWorkspaceTabs.jsx.
const PartnerWorkspaceTabs = lazy(() => import('./pages/partner/PartnerWorkspaceTabs'));
// Founder editor pages return to their cycle module (#1539).
const FounderModuleBackLink = lazy(() => import('./pages/founder/FounderModuleBackLink'));
const FounderWorkspacePage = lazy(() => import('./pages/founder/FounderWorkspacePage'));
// D661 (#1474): the cycle overview and module pages, wired to each cycle's read.
const CycleRoute = lazy(() => import('./pages/cycles/CycleRoute'));
const FounderBuildBoard = lazy(() => import('./pages/founder/FounderBuildBoard'));
const FounderBuildThisWeek = lazy(() => import('./pages/founder/FounderBuildThisWeek'));
const FounderBuildRoadmap = lazy(() => import('./pages/founder/FounderBuildRoadmap'));
const FounderBuildKpi = lazy(() => import('./pages/founder/FounderBuildKpi'));
const FounderBuildCadence = lazy(() => import('./pages/founder/FounderBuildCadence'));
// D894 (#2434): the Pitch deck studio, its home and Share & analytics tabs, and the old editor address's redirect.
const PitchStudio = lazy(() => import('./pages/raise/pitch/PitchStudio'));
const PitchWorkspaceMoved = lazy(() => import('./pages/raise/pitch/PitchWorkspaceMoved'));
const PitchPresent = lazy(() => import('./pages/raise/pitch/PitchPresent'));
const PitchEditor = lazy(() => import('./pages/raise/pitch/PitchEditor'));
const PitchBoundary = lazy(() => import('./pages/raise/pitch/PitchBoundary'));
const NewDeck = lazy(() => import('./pages/raise/pitch/NewDeck'));
const NarrativeBoundary = lazy(() => import('./pages/raise/narrative/NarrativeAdmin').then((m) => ({ default: m.NarrativeBoundary })));
const FounderRaiseStatus = lazy(() => import('./pages/founder/FounderRaiseStatus'));
const FounderRaiseCapital = lazy(() => import('./pages/founder/FounderRaiseCapital'));
const FounderRaiseLegal = lazy(() => import('./pages/founder/FounderRaiseLegal'));
const FounderRaiseDataRoom = lazy(() => import('./pages/founder/FounderRaiseDataRoom'));
const SentUpdatePage = lazy(() => import('./pages/founder/SentUpdatePage'));
// D668 (#1498): an AI assistant's consent page (D665, D666).
const ConnectAssistantPage = lazy(() => import('./pages/connect/ConnectAssistantPage'));
const RoundCallPage = lazy(() => import('./pages/founder/RoundCallPage'));
const RaiseCallPage = lazy(() => import('./pages/founder/RaiseCallPage'));
const RoundCallIndex = lazy(() => import('./pages/founder/RoundCallPage').then(module => ({ default: module.RoundCallIndex })));
const FounderGrowFocus = lazy(() => import('./pages/founder/FounderGrowFocus'));
const FounderGrowTalent = lazy(() => import('./pages/founder/FounderGrowTalent'));
const FounderGrowCustomers = lazy(() => import('./pages/founder/FounderGrowCustomers'));
const FounderGrowPartnerships = lazy(() => import('./pages/founder/FounderGrowPartnerships'));
const FounderGrowCapitalMatch = lazy(() => import('./pages/founder/FounderGrowCapitalMatch'));
const FounderGrowLaunch = lazy(() => import('./pages/founder/FounderGrowLaunch'));
const FounderNetworkDesk = lazy(() => import('./pages/founder/FounderNetworkDesk'));
const FounderResearchDesk = lazy(() => import('./pages/founder/FounderResearchDesk'));
const PartnerInsightsPage = lazy(() => import('./pages/PartnerInsightsPage'));
// D569 — the partner earnings screens (canvas pe-earnings, pe-referrals,
// pe-log, pe-board).
const PartnerEarnings = lazy(() => import('./pages/partner/earnings/PartnerEarnings'));
const PartnerReferrals = lazy(() => import('./pages/partner/earnings/PartnerReferrals'));
const PartnerRelationshipLog = lazy(() => import('./pages/partner/earnings/PartnerRelationshipLog'));
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
// Partner Operations shell — tabbed workspace (Overview, Capabilities, Portfolio,
// Engagements, Performance).
// Authenticated-shell widgets — lazy so they leave the entry chunk. They only
// ever render inside ProtectedLayout (logged-in users), so a logged-out visitor
// hitting the landing page never downloads them. Each render site below is
// wrapped in its own <Suspense fallback> so fetching a chunk can't blank the app.
const InactivityWarningModal = lazy(() => import('./components/InactivityWarningModal'));
const RecordLivePage = lazy(() => import('./pages/founder/RecordLivePage'));
const NotificationBell = lazy(() => import('./components/NotificationBell'));
const FounderWellbeingMenu = lazy(() => import('./components/FounderWellbeingMenu'));
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const StepUpModal = lazy(() => import('./components/StepUpModal'));
const InstallPrompt = lazy(() => import('./components/InstallPrompt'));
const KeyboardShortcutsOverlay = lazy(() => import('./components/KeyboardShortcutsOverlay'));
import useInactivityTimeout from './hooks/useInactivityTimeout';
// D685 §5.6 (#1588): the one recording, above the routes, and its pill.
import { ActiveRecordingProvider, useActiveRecording } from './contexts/ActiveRecordingContext';
import RecordingPill from './pages/founder/RecordingPill';
import { ONBOARDING_COMPLETE_EVENT, ONBOARDING_LICENCE_CHOSEN_EVENT, TERMS_ACCEPTED_EVENT } from './lib/onboarding';
import { shellRoleFor, branchOfUser, isSuperAdminUser, readHqView, writeHqView, clearHqView } from './lib/shellRole';
import { buildCompetitorsRedirect } from './lib/companyDirectoryView';
import { connectorsRedirect } from './pages/account/connectorsModel';
import { signInPath as assistantSignInPath } from './pages/connect/assistantConsentModel';
import { InvestorPricingRedirect, PlansAndPricingRedirect } from './pages/pricingRedirects.jsx';
import {
  PREVIEW_SHELLS, PREVIEW_TRIGGER, PREVIEW_HEADER, PREVIEW_FOOTER,
  previewOptionsFor, selectedPreviewKey, homePreviewKey, previewChip, previewNote,
} from './lib/previewShells';

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
// D686 §3.2 item 2: a cycle's history address (/build/tools, /raise/calls,
// /grow/updates) is its module section, the query kept and the hash added, as
// D571's redirects keep theirs.
export function HistoryRedirect({ to, hash }) {
  const location = useLocation();
  return <Navigate replace to={{ pathname: to, search: location.search, hash }} />;
}

// D696 (#1658, decision 13): an old or canvas-slug address that names a
// record, redirected with its params encoded and the query and hash kept.
export { ParamRedirect };

// D704 (#1666, decision 1): a retired Validate page lands on the module that
// holds its work now, the query and the hash kept. Mounted by PR 2b and the
// closing PR on the three addresses.
export { ValidateZoneRedirect };

// D755 §13 (#1915): /products keeps its query and its hash, so an old
// /products#token-packs link still lands on the Token packs. D786 (#2211):
// the catalogue is at /pricing/products now.
function ProductsRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: '/pricing/products', search: loc.search, hash: loc.hash }} replace />;
}


function DashboardRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: '/studio', search: loc.search, hash: loc.hash }} replace />;
}

// #2342 — /partners/portal was the partner deal portal (terms, tiers, the
// deal's referral code, redemptions, milestones) and /partner-portal its older
// alias. The owner removed the page and its features (#2297 §7); both
// addresses land on Refer & earn. Old bookmarks keep their query string and
// hash.
function PartnerPortalRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: '/referrals', search: loc.search, hash: loc.hash }} replace />;
}

// #2338 — the needs board and the service catalogue at their pre-bucket
// addresses (/needs, /services, /founder/post-need, /partner/needs and the
// older /marketplace) are removed (#2297 §7). A founder keeps the redirect to
// the matching tab of the founder marketplace; everyone else lands on the
// partner's zone that took the job, Pipeline · Leads or Offers · Catalog.
function MarketplaceRedirect({ role, founderTab, to }) {
  const loc = useLocation();
  if (role === 'founder') return <Navigate to={`/build/marketplace?tab=${founderTab}`} replace />;
  return <Navigate to={{ pathname: to, search: loc.search, hash: loc.hash }} replace />;
}

// D371 — /funds/capital-calls was Fund Ops' Capital Calls tab: a read-only
// list (the studio-wide ledger for an admin, the caller's own LP calls for an
// investor). The Calls zone at /funds/calls is the fund's call ledger with
// writes: numbered calls, each LP's line, receipts and the wire trail, for
// any fund the caller operates. The tab accepted no query string of its own;
// whatever a bookmark carries travels anyway.
function FundCapitalCallsRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: '/funds/calls', search: loc.search, hash: loc.hash }} replace />;
}

// D372 — /lp-portal was "My LP Portal": the LP's own commitments, capital
// calls, distributions, TVPI/DPI and LPA signing. The My-commitment section of
// the LP workspace does every one of those jobs, so the old page redirects to
// that section. A bookmark's own query string travels; its hash, if it had
// one, wins over the section anchor.
function LpPortalRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: '/spinout-lab/investor-workspace', search: loc.search, hash: loc.hash || '#my-commitment' }} replace />;
}

// D372 — /funds/lp-workspace rendered the same LP workspace as a Fund Ops tab,
// embedded. It is one route now.
function FundLpWorkspaceRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: '/spinout-lab/investor-workspace', search: loc.search, hash: loc.hash }} replace />;
}

// Legacy /refer redirects to the standalone /referrals page, preserving ?tab=.
function ReferRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: '/referrals', search: loc.search }} replace />;
}

// User Settings renamed to Account: /settings -> /account.
//
// THESE REDIRECTS ARE PERMANENT, not a migration shim, and query + hash are
// preserved because both are genuinely emitted. The worker puts `/settings/*`
// into outbound notification email (routes/notifications.ts), into the Google
// OAuth link callback (routes/auth_google.ts), into the recovery-codes
// redirect (routes/auth_recover.ts, which appends `#security-recovery-codes`)
// and into the generated advisor bank manifest. Those links are already in
// people's inboxes; a plain `<Navigate to="/account">` would land them on the
// page but drop the section, the tab and the anchor that made the link worth
// sending.
function SettingsRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: '/account', search: loc.search, hash: loc.hash }} replace />;
}

// The section has to travel too: /settings/security?tab=… -> /account/security?tab=…
// SettingsPage's own PATH_TO_SECTION still resolves the four legacy aliases
// (jurisdictions, email, auth, role), so an old deep link keeps working after
// the hop.
function SettingsSectionRedirect() {
  const loc = useLocation();
  const { section } = useParams();
  return <Navigate to={{ pathname: `/account/${section}`, search: loc.search, hash: loc.hash }} replace />;
}

// Support Hub renamed to Help Center: /tickets -> /help. The plain /tickets
// redirect is a one-liner beside its route; this one exists because the id has
// to travel. `tickets.ts` emits `path: /tickets/<id>` for its "Open ticket"
// CTA, so those links must land on the ticket, not on the list.
//
// Task #103 — the ticket flow now lives at `/help/tickets`, because `/help`
// became the Help Center itself. Both legacy shapes still land on the ticket.
function TicketsRedirect() {
  const loc = useLocation();
  const { id } = useParams();
  return <Navigate to={{ pathname: `/help/tickets/${id}`, search: loc.search, hash: loc.hash }} replace />;
}

// Task #103 — `/help/<id>` was the ticket detail from D39 until the Help
// Center took `/help`. `tickets.ts:147` emits `path: /help/<id>` for its
// "Open ticket" Slack CTA and those messages are already sent, so the shape
// is permanent, not a shim. Static children (`/help/tickets`, `/help/admin/*`)
// outrank this by React Router's own specificity ranking, so it only ever
// catches an id.
function HelpTicketIdRedirect() {
  const loc = useLocation();
  const { id } = useParams();
  return <Navigate to={{ pathname: `/help/tickets/${id}`, search: loc.search, hash: loc.hash }} replace />;
}

// Task #103 — `/docs` folded into the Help Center. The hash has to travel:
// seven surfaces deep-link `#<section>/<subsection>` (CommandPalette,
// PageExplainer, EmptyState, ProjectsPage, PersonalAdvisor,
// AdvisorProgressWidget) and the anchor IS the address of the article.
function DocsRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: '/help', search: loc.search, hash: loc.hash }} replace />;
}

// Task #103 — `/support?topic=<x>` had no route at all. `ErrorState` builds it
// from four pages' failure paths, so every one of those "contact support"
// buttons has been landing on the catch-all 404. The topic is carried into the
// Help Center's search box rather than dropped: it is already the name of the
// surface that failed ("projects", "integrations", "signals", "activity").
function SupportRedirect() {
  const loc = useLocation();
  const topic = new URLSearchParams(loc.search).get('topic') || '';
  return (
    <Navigate
      to={{ pathname: '/help', search: topic ? `?q=${encodeURIComponent(topic)}` : '' }}
      replace
    />
  );
}

// D651 (#1463) — Connectors replace Integrations (D649). /integrations and
// /account/integrations both land on /account/connectors with their query and
// hash, because every provider's sign-in still returns to /integrations?… and
// the Connectors section reads that query to say how the sign-in went. The
// router state asks the section for its once-only "Integrations are now
// Connectors" notice.
function IntegrationsRedirect() {
  const loc = useLocation();
  return <Navigate to={connectorsRedirect(loc)} state={{ connectorsMoved: true }} replace />;
}


// The shell a super admin sees is chosen by `shellRoleFor` (lib/shellRole.js):
// `super_admin` is an elevation on `admin`, so `user.role` is still 'admin'
// here and the sidebar has to be picked on the flag — and on `hqView`, the
// holder's own choice between the HQ shell and the plain admin one.
function getSidebarGroups(role, primaryPersonaId, user, hqView = true) {
  const base = SIDEBAR_GROUPS[shellRoleFor(role, user, hqView)] || SIDEBAR_GROUPS.founder;
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
  // Never inject a persona group whose profile differs from the
  // current user — a Founder nav extra has no place in an Investor sidebar.
  if (persona.profile && String(persona.profile) !== String(role)) {
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
          {/* D702 (#1664) — the founder's profile pages, above Account. A
              phone reaches them from the Eadwyn menu and the account sheet. */}
          {user?.role === 'founder' && (
            <Link to="/profile" onClick={() => setOpen(false)}
              className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
              Your profile
            </Link>
          )}
          <Link to="/account" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Account
          </Link>
          {/* D642 (#1435) — the member's own usage, right under Account. */}
          <Link to="/account/usage" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Usage
          </Link>
          {/* D651 (#1463) — Connectors, under Usage, as the Connectors canvas's user menu draws it. */}
          <Link to="/account/connectors" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Connectors
          </Link>
          <Link to="/trust" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Trust Center
          </Link>
          {/*
            THE ONLY ROLE-CONDITIONAL ENTRY IN THIS MENU, and the asymmetry is
            deliberate. Every other item above and below relies on its route
            guard to do the gating — App.jsx's `/trust` route even carries a
            comment saying `advisor` was added to its guard *because* the
            dropdown link has none. Perks is different: `/perks` is guarded to
            all six roles and stays that way, because the catalogue is a
            marketplace an investor or advisor may legitimately browse. What
            narrows here is the INVITATION. Claiming a perk is a founder's
            action and offering one is a partner's; putting "Perks" in front of
            an investor would advertise a page whose two verbs are not theirs.
            Admin sees it because the review queue lives on the same page.
          */}
          {['founder', 'partner', 'admin'].includes(user?.role) && (
            <Link to="/perks" onClick={() => setOpen(false)}
              className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
              Perks
            </Link>
          )}
          <Link to="/calendar" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Calendar
          </Link>
          <Link to="/my/events" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Events
          </Link>
          {/* D562 — "Learning" replaces "Articles" (the owner, epic #1157).
              Articles live inside Learning now: its Articles tab lists them,
              each opens at `/articles/:slug`, and "Write an article" there
              still goes to `/articles/draft`. */}
          <Link to="/learning" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Learning
          </Link>
          {/* Task #103 — one entry, not two. "Help Center" and "Documentation"
              used to be a ticket tracker and a docs site sitting side by side;
              they are the same surface now. */}
          <Link to="/help" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Help Center
          </Link>
          <Link to="/pricing" onClick={() => setOpen(false)}
            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" role="menuitem">
            Pricing
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


function PortalSwitcher({ viewMode, onViewModeChange, isImpersonating, superAdmin = false, hqView = true }) {
  const [open, setOpen] = useState(false);
  // D288 / H38 — "View as" is Preview shell. "HQ" is a VIEW of the admin
  // role, not a role: choosing it browses as admin with the HQ shell,
  // choosing "HQ's own accounts" browses as admin with the plain shell —
  // exactly what an HQ-held admin sees, without impersonating anyone. HQ is
  // offered only to a holder. The words are `lib/previewShells.js`'s.
  const hq = superAdmin && viewMode === 'admin' && hqView;
  const previewOptions = previewOptionsFor(superAdmin);
  const selectedKey = selectedPreviewKey(viewMode, hq);
  const selected = PREVIEW_SHELLS.find((o) => o.key === selectedKey) || null;
  const home = PREVIEW_SHELLS.find((o) => o.key === homePreviewKey(superAdmin));
  const previewing = selected && home && selected.key !== home.key;
  const choose = (key) => {
    if (key === 'hq') onViewModeChange('admin', { hq: true });
    else if (key === 'admin') onViewModeChange('admin', { hq: false });
    else onViewModeChange(key);
  };

  return (
    <div className={`${superAdmin ? 'bg-gradient-to-r from-[#881337] to-violet-800' : 'bg-gradient-to-r from-violet-700 to-indigo-700'} text-white px-4 py-2 flex items-center gap-3 text-sm relative z-[60]`}>
      <Shield size={14} className="opacity-80" />
      <span className="font-medium opacity-90">{superAdmin ? 'Super Admin Mode' : 'Admin Mode'}</span>

      {isImpersonating ? (
        /* D290 / H25 — the support session's own chrome is `ImpersonationBar`,
           mounted above this bar: who, as whom, why, the limit, the clock,
           Extend and End session. Nothing about the session is drawn twice;
           this bar only says why the picker is not offered. */
        <span className="ml-2 text-xs opacity-80" data-testid="portal-switcher-support-note">
          Support session in progress — the bar above says who, as whom, why and for how long.
        </span>
      ) : (
        <div className="ml-2 relative">
          <button
            onClick={() => setOpen(!open)}
            data-testid="preview-shell-trigger"
            className="flex items-center gap-2 bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Eye size={13} />
            <span>{PREVIEW_TRIGGER}</span>
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
              <div
                className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[280px] z-50"
                data-testid="preview-shell-menu"
              >
                <div className="px-4 pt-1.5 pb-2 text-[10.5px] font-extrabold uppercase tracking-[.08em] text-gray-500">
                  {PREVIEW_HEADER}
                </div>
                {/* Task #14 — 'exploring' stays offered (it was filtered out in
                    v1) so admins can preview the holding-state experience
                    end-to-end. H38 omits it; D288 keeps it, last. */}
                {previewOptions.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => { choose(o.key); setOpen(false); }}
                    data-preview-shell={o.key}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
                      selectedKey === o.key ? 'text-violet-700 font-medium bg-violet-50' : 'text-gray-700'
                    }`}
                  >
                    <span className="block">{o.label}</span>
                    <span className="block text-[11px] text-gray-500">{o.what}</span>
                  </button>
                ))}
                <div className="mt-1 border-t border-gray-100 px-4 pt-2 pb-1.5 text-[11px] leading-snug text-gray-500">
                  {PREVIEW_FOOTER}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* H38's strip: while a shell other than the viewer's own is previewed,
          the chip, the sentence about whose name the writes carry — "the
          Super Admin" to the holder, "you" to anyone else — and the way back. */}
      {!isImpersonating && previewing && (
        <div className="ml-2 flex flex-wrap items-center gap-2 text-xs" data-testid="preview-shell-strip">
          <span className="rounded-full bg-white/20 px-2 py-0.5 font-semibold">{previewChip(selected.label)}</span>
          <span className="opacity-90">{previewNote(superAdmin)}</span>
          <button
            type="button"
            onClick={() => choose(home.key)}
            className="rounded-md bg-white/20 px-2 py-0.5 font-medium hover:bg-white/30"
          >
            Back to {home.label}
          </button>
        </div>
      )}

    </div>
  );
}

/**
 * Which paths own the full dashboard, per licence. Derived in
 * `sidebarConfig.js` from the shell config rather than typed here; this table
 * is only the role → list mapping, so adding a fifth shell is one line.
 */
const FULL_BLEED_BY_ROLE = {
  founder: FOUNDER_FULL_BLEED,
  investor: INVESTOR_FULL_BLEED,
  advisor: ADVISOR_FULL_BLEED,
  partner: PARTNER_FULL_BLEED,
};

function ProtectedLayout({ children, user, onLogout, viewMode, onViewModeChange, isImpersonating, onExitImpersonation, realUser, onImpersonate, primaryPersonaId, hqView = true, supportLeftMs = null, onExtendImpersonation, supportReason = null }) {
  const location = useLocation();
  // ONE TYPE FACE FOR THE SIGNED-IN PRODUCT: the investor Fund page's
  // (--font-app, index.css). The class sits on <html> so portals mounted on
  // <body> get it too, and comes off on the way back to the public site,
  // which keeps its own face. A layout effect, so the first paint is already
  // in the right face.
  useLayoutEffect(() => {
    document.documentElement.classList.add('app-type');
    return () => document.documentElement.classList.remove('app-type');
  }, []);
  // Active-company context state — owned here so descendants (CompanySwitcher,
  // CompanySettingsPage, etc.) share the same reference without prop drilling.
  const [activeCompany, setActiveCompany] = useState(null);
  // Restore the saved company BEFORE any page effect can fire, so the first
  // wave of requests already carries it. Doing this inside the switcher's own
  // effect was too late: sibling page effects run in the same commit, so their
  // first requests went out with no company (or a stale one) and the page
  // showed the wrong rows until something else happened to refetch. The
  // switcher confirms this id against the caller's memberships once they load
  // and corrects it if it is stale.
  const [savedCompanyId] = useState(() => initActiveCompanyId());
  // D153 / H12 — the view-as scope. See the provider below.
  const [viewAsBranch, setViewAsBranch] = useState(null);
  const [companyList, setCompanyList] = useState([]);

  // Start with the desktop sidebar visible and the mobile drawer closed.
  // Manual sidebar controls continue to manage it after the first render.
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return typeof window === 'undefined' || !window.matchMedia('(max-width: 1023px)').matches;
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
  // Keep the desktop sidebar open during navigation; on mobile, selecting
  // a destination closes the drawer so the page is visible.
  const closeOnMobileNav = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      setSidebarOpen(false);
    }
  }, []);
  const isAdmin = (realUser || user)?.role === 'admin';
  const activeRole = resolveActiveRole({ user, realUser, viewMode, isImpersonating });
  // The elevation belongs to the session that signed in; the shell follows
  // the identity being browsed (which is the same person unless impersonating,
  // and a holder is the only one allowed to impersonate a holder).
  const superAdmin = isSuperAdminUser(realUser || user);
  const shellRole = shellRoleFor(activeRole, user, hqView);
  // D107. `user`, not `realUser`: the branch is a property of the deployment
  // this SPA is served from, so it is the same fact for every session on it —
  // and during an HQ support session the badge must keep naming the branch the
  // support session is being run ON, which is the one the copy comes from.
  const branchFact = branchOfUser(user) ? user.branch : null;
  // ONE RULE, FOUR LICENCES. This read two lists and named two roles, so the
  // other two got whatever the fallback happened to be: advisor routes were
  // full width but padded, and partner routes were padded AND centred at
  // `max-w-7xl` — the only licence constrained to 1280px, and the single
  // biggest reason Partner looked least like its canvas. All four lists are
  // now derived from `workspaces/shellConfig.js` rather than typed, so a zone
  // cannot be added to a shell and left out of its layout.
  //
  // The pages themselves stopped depending on this for their inner padding in
  // the same change: `WorkspaceShell` now carries the canvases' own
  // `.main { padding }`, so a workspace route wants `p-0` here on every
  // licence — including `/research/*`, which was carved out of both lists
  // precisely because the shell had no padding of its own.
  const fullBleedSurface = (FULL_BLEED_BY_ROLE[activeRole] || []).includes(location.pathname)
    || SHARED_FULL_BLEED.includes(location.pathname)
    // D631's two fund child pages carry WorkspaceShell's own inset and rail.
    || /^\/funds\/[1-9][0-9]*(?:\/reporting\/(?:new|[1-9][0-9]*))?$/.test(location.pathname)
    // The Lab's tool routes, by prefix rather than by twenty-three entries.
    // This is where `/spinout-lab/` is tested, and the only place: it used to
    // be typed on the width flag below AND on the padding flag under it, which
    // is two tests of one fact that could be changed apart.
    || SHARED_FULL_BLEED_PREFIXES.some((prefix) => location.pathname.startsWith(prefix))
    // Every licence uses the cycle's own gutter for its module and action pages.
    || isCyclePath(location.pathname);
  const fullWidthSurface = fullBleedSurface
    // Advisor's blanket clause stays, and only this clause is still blanket:
    // it also covers the advisor pages OUTSIDE any workspace, which have been
    // full width since the advisor shell shipped. Narrowing it to the derived
    // list would silently re-centre those, which is a separate decision from
    // this one.
    || activeRole === 'advisor'
    // Account fills the column but keeps the shell gutter its phone frame cancels.
    || /^\/account(?:\/|$)/.test(location.pathname);
  const flushSurface = fullBleedSurface;
  // The three role wizards paint their own background across this column.
  // Padding and the footer are the gaps around it; both have to go, or the
  // landscape stops short of the sidebar and the bottom of the body.
  const onboardingCanvas = ONBOARDING_CANVAS_PATHS.includes(location.pathname);
  const sidebarGroups = getSidebarGroups(activeRole || 'founder', primaryPersonaId, user, hqView);
  // D285 / H36 — which sub-navigation strip this location sits under, in the
  // HQ shell only. The strips are written below as LITERAL links rather than
  // mapped from `HQ_STRIPS`, because the reachability guard reads navigation
  // syntax and a `.map` over data is not a door it can see; the guard holds
  // this markup equal to that list.
  const hqStrip = shellRole === 'super_admin' ? stripFor(location.pathname) : null;
  // The strip is drawn above the page container, unless the page docks a
  // Worker AI rail: then the rail's frame takes it into the top of its body,
  // so the panel runs from the header rather than from under the strip
  // (RailFrame's `RailStripSlot`). The frame says when it holds it.
  const [stripInFrame, setStripInFrame] = useState(false);
  const hqStripNav = (
    <>
      {hqStrip === 'Platform' && (
        <HqSubNavStrip label="Platform">
          <StripLink to="/admin/platform">Overview</StripLink>
          <StripLink to="/admin/platform/switches">Switches</StripLink>
          <StripLink to="/admin/platform/topology">Topology</StripLink>
          <StripLink to="/admin/platform/allowances">AI allowances</StripLink>
          <StripLink to="/admin/platform/ai-usage">AI usage</StripLink>
          <StripLink to="/admin/platform/payments">Payments</StripLink>
          <StripLink to="/admin/platform/bank-accounts">Bank accounts</StripLink>
          <StripLink to="/admin/platform/product-testing">Product testing</StripLink>
          <StripLink to="/admin/platform/promo-codes">Promo codes</StripLink>
          <StripLink to="/monitoring">Monitoring</StripLink>
          <StripLink to="/admin/telegram">Telegram</StripLink>
        </HqSubNavStrip>
      )}
      {hqStrip === 'Licences' && (
        <HqSubNavStrip label="Licences">
          <StripLink to="/admin/licences">Ledger</StripLink>
          <StripLink to="/admin/licences/programs">Program grants</StripLink>
        </HqSubNavStrip>
      )}
      {hqStrip === 'Content' && (
        <HqSubNavStrip label="Content">
          <StripLink to="/admin/content">Overview</StripLink>
          <StripLink to="/admin/articles">Content queue</StripLink>
          <StripLink to="/admin/publications">Publications</StripLink>
          <StripLink to="/admin/persona-segments">Persona segments</StripLink>
          <StripLink to="/admin/advisors-partners">Advisors &amp; Partners</StripLink>
          <StripLink to="/admin/team">Public team page</StripLink>
        </HqSubNavStrip>
      )}
    </>
  );
  const railStrip = hqStrip ? { strip: hqStripNav, inFrame: stripInFrame, dock: setStripInFrame } : null;
  // D287 / S21 — read only where the strip could apply: the plain Admin
  // shell off a branch, the person's own session. The hook memoises one read
  // per user; the strip above the top bar and the badge inside it both draw
  // from this one model.
  const notDeployed = useBranchDeployment(
    !branchFact && shellRole === 'admin' && activeRole === 'admin' && !isImpersonating,
    user?.id,
  );

  // Auto-logout after 20 minutes of inactivity, with a 60-second warning modal.
  // Tracks mouse/keyboard/scroll/touch on `window`. Disabled when no user is
  // present (covers the brief render between logout and redirect).
  // A recording gives no input: the logout is suspended while one is
  // recording, paused or uploading (D685 §5.6.8).
  const { recorder: activeRecorder } = useActiveRecording();
  const { warningOpen, secondsLeft, stayLoggedIn, logoutNow } = useInactivityTimeout({
    timeoutMs: 20 * 60 * 1000,
    warningMs: 60 * 1000,
    enabled: !!user && !activeRecorder.isCapturing(),
    onTimeout: onLogout,
  });

  // Memoize the context value so consumers of `useViewMode()` don't re-render
  // on every App render. Stable identity unless one of the three inputs changes.
  const viewModeContextValue = useMemo(
    () => ({ viewMode: activeRole, isAdmin, isImpersonating, shellRole }),
    [activeRole, isAdmin, isImpersonating, shellRole],
  );

  // D153 / H12 — the view-as scope, held in the SHELL rather than on a page,
  // for the reason the frozen bar is: it changes what the chrome says, and a
  // page that owned it would drop it the moment the operator navigated.
  //
  // IT PERSISTS NOTHING — no localStorage, no sessionStorage, no URL — on
  // `AdminFrozenBar`'s stated rule: a mode the viewer must not be able to
  // forget they are in must not survive into a session that did not enter it.
  // That is also why `clearSession` needs no line for it, unlike the support
  // payload it does purge: there is no key to remove, and signing out unmounts
  // this layout, which IS the purge. A stored scope would need one; this is
  // the reason it is not stored.
  const viewAsBranchContextValue = useMemo(
    () => ({ branch: viewAsBranch, setBranch: setViewAsBranch }),
    [viewAsBranch],
  );

  return (
    <ActiveCompanyContext.Provider value={{ company: activeCompany, setCompany: setActiveCompany, companies: companyList, setCompanies: setCompanyList }}>
    <ViewModeContext.Provider value={viewModeContextValue}>
    <ViewAsBranchContext.Provider value={viewAsBranchContextValue}>
      {/* D504 — `viewport-fit=cover` is live (D425), so the installed app draws
          under a phone's status bar. The shell's root reserves the top inset,
          not the header: on an admin's phone `PortalSwitcher` and the support,
          impersonation and branch-status strips render BEFORE the header, so
          an inset on the header alone left the first interactive bar under the
          status bar (Codex on #1039). Here, whichever bar is first sits below
          it, and every bar keeps its own height. `env(…, 0px)` is 0 on every
          screen without an inset. */}
      {/* `app-shell` reserves the top safe-area inset (index.css; D504), unless the
          founder's phone band is the first thing in it and takes the inset itself.
          The height is the dynamic viewport where the browser has one: iOS Safari's
          100vh is taller than the visible screen, so the whole shell scrolled and
          took the band with it. */}
      <div className="app-shell flex flex-col h-screen overflow-hidden bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100" style={{ height: '100dvh' }}>
        {/* D142 / S13 — ABOVE `PortalSwitcher`, and the order is the point.
            `isImpersonating` is `!!realUser`, which an HQ support session never
            sets (the operator is a row in HQ's database this deployment cannot
            read). So supporting a branch ADMIN mounted the ordinary purple
            "Admin Mode" bar with a working View-as picker — an HQ-driven
            session dressed as the admin's own — and supporting anyone else
            rendered nothing at all. This renders first, so that bar can never
            be the only chrome on a session the viewer did not start. It draws
            nothing when there is no live support session. */}
        <SafeMount name="HqSupportSessionBar"><HqSupportSessionBar /></SafeMount>
        {/* D153 / H12 — ABOVE `PortalSwitcher`, for D142's reason one tier up:
            the ordinary admin chrome must never be the only frame on a view
            the operator is not in by default. It draws nothing outside the
            overlay. */}
        <SafeMount name="HqViewingAsBar"><HqViewingAsBar /></SafeMount>
        {/* D290 / H25 — ABOVE `PortalSwitcher`, for D142's reason on the
            operator's own side: the ordinary admin chrome must never be the
            only frame on a session the operator is not in by default. Global
            chrome, so it frames every route the session can reach — until
            D290 the strip lived inside `PortalSwitcher` and said neither who
            nor why. Who · As · Why · Limit, the shell's clock, Extend and End
            session. It draws nothing when nobody is being impersonated. */}
        <SafeMount name="ImpersonationBar">
          <ImpersonationBar
            operator={isImpersonating ? realUser : null}
            target={isImpersonating ? user : null}
            reason={supportReason}
            holder={superAdmin}
            leftMs={supportLeftMs}
            onExtend={onExtendImpersonation}
            onExit={onExitImpersonation}
          />
        </SafeMount>
        {isAdmin && (
          <PortalSwitcher
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            isImpersonating={isImpersonating}
            superAdmin={superAdmin}
            hqView={hqView}
          />
        )}

        {/* D287 / S21 — ABOVE THE TOP BAR: the fact of a licence
            administrator's account whose branch is not deployed yet. It
            cannot be dismissed and stores nothing; it draws nothing for
            everyone else, and nothing once the branch is live. */}
        <SafeMount name="BranchNotDeployedBar"><BranchNotDeployedBar strip={notDeployed} /></SafeMount>

        {/* D699 — below 1024px a founder gets the phone band instead
            (ui/phone/PhoneHeader.jsx); everyone else, and a founder at 1024px
            and up, gets the header below unchanged. One is mounted, never both. */}
        {/* ── Carta-style global top header ─────────────────────────────── */}
        <HeaderForWidth founder={shellRole === 'founder'} user={user} onLogout={onLogout} branchFact={branchFact}>
        <header className="z-40 h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center px-4 gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <button
              className="lg:hidden text-gray-500 dark:text-gray-400 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={18} />
            </button>
            <div className="flex items-center gap-2.5 dark:rounded-lg dark:bg-white/95 dark:px-2 dark:py-1">
              {/* onLight: this island is white in dark mode. Default AxalLogo
                  ink is dark:text-gray-100 and would disappear on it. */}
              <AxalLogo size="sm" onLight showRelease />
            </div>
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
            {/* A holder sees which of its two admin shells it is in: HQ, or the
                plain one a subsidiary admin gets. Neither chip shows for an
                admin without the elevation, whose only admin shell is the plain
                one and needs no label. */}
            {superAdmin && activeRole === 'admin' && !isImpersonating && (
              shellRole === 'super_admin'
                ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200">HQ</span>
                : <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS.admin}`}>Admin View</span>
            )}
            {/* D107 — the territory badge, in the slot the HQ chip occupies and
                at the same weight, because both answer the same question: whose
                data am I looking at. On HQ that question has a switcher behind
                it; on a branch it has one answer and no control, which is the
                tenancy wall stated in the chrome rather than on each page.

                It renders from `/me.branch` only. A branch is a property of the
                DEPLOYMENT (D106), so there is nothing here for a user to be
                wrong about and nothing to fall back to when the key is absent:
                HQ and the dev FastAPI both show no badge, which is correct. */}
            {branchFact && (
              <span
                data-testid="territory-badge"
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
              >
                {branchFact.name || branchFact.code}
                {(branchFact.territories || []).length > 0 && ` · ${(branchFact.territories || []).join(' · ')}`}
                {' · BRANCH'}
                {/* D142 — `/me.branch` has carried `status` and `as_of` since
                    D106 and the badge read NEITHER, so a suspended branch's
                    badge was byte-identical to an active one. The word only
                    appears when the state is not active: a badge that said
                    "ACTIVE" on every branch would be noise, and the one state
                    worth interrupting someone over is the one that changes what
                    they can do. */}
                {branchFact.status && branchFact.status !== 'active'
                  && ` · ${String(branchFact.status).toUpperCase()}`}
              </span>
            )}
            {/* D286 / S20 — the same slot, the same question, for the plain
                Admin shell off a branch: whose data am I looking at. HQ's own
                — the accounts HQ holds on axal.vc — because no branch is
                deployed. The scope chip reads "HQ-held · axal.vc" and the
                badge "HQ-HELD", each as the artboard draws it (D282's tension
                1: the changelog's wording is the chip's, the badge's is the
                badge's). Not for the holder in HQ view, whose chip says HQ. */}
            {!branchFact && shellRole === 'admin' && activeRole === 'admin' && !isImpersonating && (
              notDeployed
                /* D287 / S21 — the same slot for a licence administrator whose
                   branch is not deployed: "{brand} · on axal.vc" and the badge
                   "BRANCH · NOT DEPLOYED", as the artboard draws them. */
                ? (
                  <span
                    data-testid="branch-not-deployed-badge"
                    className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300"
                  >
                    <Globe size={12} aria-hidden="true" />
                    {notDeployed.brand || 'This licence'} · on axal.vc
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200">BRANCH · NOT DEPLOYED</span>
                  </span>
                )
                : (
                  <span
                    data-testid="hq-held-badge"
                    className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300"
                  >
                    <Globe size={12} aria-hidden="true" />
                    HQ-held · axal.vc
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200">HQ-HELD</span>
                  </span>
                )
            )}
            {(activeRole === 'founder' || activeRole === 'admin') && (
              <Suspense fallback={<span className="inline-block h-8 w-8" />}>
                <FounderWellbeingMenu />
              </Suspense>
            )}
            {/* D284 — Messages left the sidebar rows for the top bar. It is
                offered to exactly the roles the /messages route admits, on
                every shell those roles get. */}
            {MESSAGES_ROLES.includes(activeRole) && (
              <Link
                to="/messages"
                data-testid="messages-door"
                className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors whitespace-nowrap"
              >
                <Mail size={14} />
                Messages
              </Link>
            )}
            {/* D563 — no Workspaces launcher. Its 28 pages each light the
                profile sidebar row that owns them and are linked from that
                row's overview ("Also in"); an admin reaches them through
                View As and the command palette. */}
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
        </HeaderForWidth>

        <div className="flex flex-1 overflow-hidden">
          <aside className={`
            fixed ${sidebarOpen ? 'lg:relative' : ''}
            inset-y-0 left-0 z-50 ${effectiveCollapsed ? 'w-20' : 'w-64'} bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800
            flex flex-col
            transform transition-transform duration-200
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:hidden'}
          `}>
            <SidebarNav groups={sidebarGroups} role={shellRole || 'founder'} onNavigate={closeOnMobileNav} user={user} collapsed={effectiveCollapsed} onCollapse={toggleSidebarCollapsed} onClose={() => setSidebarOpen(false)} />
          </aside>

          {sidebarOpen && (
            <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
          )}
          {/* D504 — the phone's tab bar (D425): four tabs and More below 1024px,
              built from the sidebar's own rows. The role is the shell's as
              resolved, without the sidebar's `|| 'founder'` fallback, so a
              viewer with no role gets no bar. The bar renders nothing for a
              licence whose plan is not built yet (`mobilePlan` returns null). */}
          <MobileTabBar role={shellRole} onMore={() => setSidebarOpen(true)} />
          {/* D699 — the founder's last opened cycle per company, for the
              company sheet. Never while an operator acts as someone else. */}
          <CompanyVisits role={shellRole} record={!isImpersonating && !(isAdmin && activeRole !== 'admin')} />
          {/* D685 §5.6: the recording outlives every route; its pill sits in the corner. */}
          <ActiveRecordingProvider userId={user?.id ?? null} />
          <SafeMount name="RecordingPill"><RecordingPill /></SafeMount>

          {/* A COLUMN, so the footer stays at the bottom on short pages while
              still following long page content inside the scroll container.
              `data-app-scroll` is where the phone tab bar's clearance goes
              (mobileTabBar.css, D504): the footer is the last thing in this
              container, so padding the content block above it (`[data-app-main]`,
              as D425 did) left the footer's Terms and Privacy row under the bar
              at the end of the scroll. */}
          <main
            data-app-scroll
            {...(onboardingCanvas ? { 'data-onboarding-canvas': '' } : {})}
            className={`flex flex-1 flex-col overflow-y-auto ${onboardingCanvas ? '' : 'bg-gray-50 dark:bg-gray-950'}`}
          >
            {stripInFrame ? null : hqStripNav}
            {/* Keyed on the active company so a switch REMOUNTS every page
                below the sidebar. Pages do not read the company from context —
                it rides in the X-Company-Id header on each request — so
                without this a page fetched under one company kept showing it
                after the switcher moved to another, until the next navigation
                happened to refetch. `savedCompanyId` is the id restored before
                first render, so a reload that lands on the same company does
                not remount once the switcher confirms it. */}
            {/* D768 (#2092): every rail below reads its page key from the route (lib/railPages.js). */}
            <RailPageProvider role={shellRole}>
            <RailStripSlot.Provider value={railStrip}>
              <div key={activeCompany?.id ?? savedCompanyId ?? 'none'} data-app-main className={`${flushSurface ? 'p-0 edge-to-edge-surface' : 'p-4 md:p-6'} ${fullWidthSurface ? '' : 'max-w-7xl mx-auto w-full'}${onboardingCanvas ? ' flex w-full min-h-full flex-1 flex-col' : ''}`}>
                {children}
              </div>
            </RailStripSlot.Provider>
            </RailPageProvider>
            {!onboardingCanvas && (
            <footer className="mt-auto shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 md:px-6 py-4">
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
            )}
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
    </ViewAsBranchContext.Provider>
    </ViewModeContext.Provider>
    </ActiveCompanyContext.Provider>
  );
}

function RequireAuth({ user, children, onLogout, viewMode, onViewModeChange, isImpersonating, onExitImpersonation, realUser, onImpersonate, hqView = true, supportLeftMs = null, onExtendImpersonation, supportReason = null }) {
  const location = useLocation();
  const { oauthBootstrapping } = useAuth();
  const [kycStatus, setKycStatus] = useState(user?.kyc_status || null);
  const [accessLevel, setAccessLevel] = useState(user?.access_level || null);
  // Task #24 — authoritative role from /api/me. The login token / stored
  // `user` role is never refreshed, so an account created as a partner and
  // later promoted to admin keeps a stale client role. The onboarding-chat
  // bypass below must evaluate against this fresh role, not `user.role`.
  const [serverRole, setServerRole] = useState(user?.role || null);
  const [suggestedRole, setSuggestedRole] = useState(user?.suggested_role || null);
  const [primaryPersonaId, setPrimaryPersonaId] = useState(null);
  const [onboardingFlow, setOnboardingFlow] = useState(null);
  const [onboardingComplete, setOnboardingComplete] = useState(true);
  const [onboardingLoaded, setOnboardingLoaded] = useState(false);
  // Task #178 — does this account still owe an acceptance of the terms?
  // FALSE IS THE ONLY SAFE INITIAL VALUE, and it covers three cases at once: the
  // moment before /me answers (so no interstitial flashes over a page that is
  // loading), a /me that errored, and the dev FastAPI, whose response has no
  // such key at all. Absent must read as "do not gate" in every one of them —
  // the inverse would lock a Replit session out of its own product.
  const [termsPending, setTermsPending] = useState(false);
  // Set when the licence picker announces a choice, so an in-flight
  // progress read — started before the click, answering `flow: 'licence'` —
  // cannot put the gate back after the click has already moved the account on.
  const licenceChosen = useRef(false);
  const progressUserId = useRef(null);

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
    // A different account must not inherit the previous one's choice. The
    // same account re-running this effect (StrictMode) must not wipe a
    // choice that already landed, or the late progress read wins again.
    if (progressUserId.current !== user.id) {
      progressUserId.current = user.id;
      licenceChosen.current = false;
    }
    let cancelled = false;
    (async () => {
      try {
        const me = await api.getMe();
        if (cancelled) return;
        setKycStatus(me.kyc_status || 'not_started');
        setAccessLevel(me.access_level || null);
        setServerRole(me.role || null);
        // A /me that left before Continue must not put the suggested role or
        // the terms gate back. The licence request already recorded both, and
        // the picker has told this shell. Applying the stale answer here is
        // how the next screen becomes the terms interstitial, or the licence
        // picker, after a click that succeeded.
        if (!licenceChosen.current) {
          setSuggestedRole(me.suggested_role || null);
          // `=== true`, not truthy. The key is absent on the dev FastAPI's /me and
          // on any older worker, and `undefined` must land on "do not gate"
          // rather than on whatever a loose check would make of it.
          setTermsPending(me.terms_acceptance_pending === true);
        }
        const stored = safeReadJSON('user', {});
        const suggestedRole = licenceChosen.current
          ? (stored.suggested_role || null)
          : (me.suggested_role || null);
        if (
          stored.kyc_status !== me.kyc_status ||
          stored.access_level !== me.access_level ||
          stored.role !== me.role ||
          stored.suggested_role !== suggestedRole
        ) {
          localStorage.setItem('user', JSON.stringify({
            ...stored,
            role: me.role,
            kyc_status: me.kyc_status,
            access_level: me.access_level || null,
            suggested_role: suggestedRole,
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
        if (cancelled || licenceChosen.current) return;
        setOnboardingFlow(p?.flow || null);
        setOnboardingComplete(!!p?.completed_at);
        setOnboardingLoaded(true);
      } catch {
        // Endpoint missing or transient error — don't block login.
        if (!cancelled && !licenceChosen.current) {
          setOnboardingComplete(true);
          setOnboardingLoaded(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // The effect above is keyed on `[user?.id]`, so it reads onboarding
  // progress once per session and never re-reads. That is fine until a
  // wizard FINISHES mid-session: the shell still holds completed=false, and
  // the wizard-resume gate below then bounces the user off wherever they
  // just landed and back into a wizard chosen from their role — an investor
  // who had just finished was being sent to the founder wizard. The wizard
  // announces its own completion; listening is cheaper and more reliable
  // than re-fetching a fact we have already been told.
  useEffect(() => {
    const done = () => { setOnboardingComplete(true); setOnboardingLoaded(true); };
    window.addEventListener(ONBOARDING_COMPLETE_EVENT, done);
    return () => window.removeEventListener(ONBOARDING_COMPLETE_EVENT, done);
  }, []);

  // Choosing a licence is the same shape of fact as finishing a wizard: the
  // server has already moved on, and this shell will not ask it again until
  // the next full load. Without this listener the licence gate still holds
  // `flow === 'licence'` and returns the navigation to `/onboarding`, so
  // Continue appears to do nothing until a refresh.
  useEffect(() => {
    const chosen = (e) => {
      const licence = e?.detail?.licence;
      if (licence !== 'founder' && licence !== 'investor' && licence !== 'advisor' && licence !== 'partner') return;
      licenceChosen.current = true;
      setOnboardingLoaded(true);
      setOnboardingFlow(licence);
      // The server marks only the advisor row complete. The other three open
      // a wizard, and reporting them complete would skip it.
      setOnboardingComplete(licence === 'advisor');
      setSuggestedRole(licence);
      // The same request recorded the terms. Retire the interstitial here as
      // well as on TERMS_ACCEPTED_EVENT, so one of the two events is enough.
      setTermsPending(false);
    };
    window.addEventListener(ONBOARDING_LICENCE_CHOSEN_EVENT, chosen);
    return () => window.removeEventListener(ONBOARDING_LICENCE_CHOSEN_EVENT, chosen);
  }, []);

  // Task #178 — the same shape, one gate along, for the same reason. The effect
  // that reads `terms_acceptance_pending` is keyed on `[user?.id]`, so accepting
  // would not change this shell's belief and the interstitial would re-render
  // itself over the page the reader was on their way to.
  useEffect(() => {
    const accepted = () => setTermsPending(false);
    window.addEventListener(TERMS_ACCEPTED_EVENT, accepted);
    return () => window.removeEventListener(TERMS_ACCEPTED_EVENT, accepted);
  }, []);

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

  // Task #66 — legacy onboarding-chatbot gate (pre–Auth v2 accounts).
  // New signups seed flow='licence' instead; this gate remains for rows
  // already in flight with flow='chat'.
  const chatGateRole = serverRole || user.role;
  const onChatPath = location.pathname === '/onboarding/chat';
  if (
    onboardingLoaded &&
    onboardingFlow === 'chat' &&
    !onboardingComplete &&
    !onChatPath &&
    !atPendingNext &&
    chatGateRole !== 'admin' &&
    realUser?.role !== 'admin' &&
    !isImpersonating &&
    accessLevel !== 'limited'
  ) {
    return <Navigate to="/onboarding/chat" replace />;
  }

  // Auth v2 — licence picker gate (A2). Fresh signups must choose a licence
  // before entering a role wizard or the exploring holding state.
  const onLicencePath = location.pathname === '/onboarding';
  if (
    onboardingLoaded &&
    onboardingFlow === 'licence' &&
    !onboardingComplete &&
    !onLicencePath &&
    !atPendingNext &&
    chatGateRole !== 'admin' &&
    realUser?.role !== 'admin' &&
    !isImpersonating &&
    accessLevel !== 'limited'
  ) {
    return <Navigate to="/onboarding" replace />;
  }

  // Task #178 — terms re-acceptance, for every account the licence gate above
  // will never reach.
  //
  // PR #549 made that consent real, but only fresh Auth-v2 signups pass through
  // the gate that collects it. Admins, impersonated sessions, `limited`
  // accounts, the legacy `flow='chat'` rows and EVERY account older than #549
  // still have `tos_v1` and `privacy_v1` sitting `pending` — satisfiable since
  // #549, satisfied by nothing.
  //
  // IT RENDERS IN PLACE RATHER THAN NAVIGATING, which is the one structural
  // difference from the two gates above and is deliberate twice over. It blocks
  // every path including `/onboarding/*` with no exemption list to keep in step
  // with the KYC gate's below; and `onLogout` is in scope here, so Decline runs
  // the app's own session teardown instead of a second copy of it. The reader
  // keeps their URL, so accepting drops them exactly where they were going.
  //
  // `licenceGateOwnsConsent` IS WHY NOBODY IS ASKED TWICE. A fresh signup mid
  // licence flow will accept at the licence screen — `onboardingChooseLicence`
  // records it — so this stands down for them. Stated as a fact about the
  // account rather than as a path test, because a path test would have to name
  // every screen that flow can be on.
  const licenceGateOwnsConsent = onboardingLoaded
    && onboardingFlow === 'licence'
    && !onboardingComplete;
  if (
    termsPending &&
    !licenceGateOwnsConsent &&
    !atPendingNext &&
    chatGateRole !== 'admin' &&
    realUser?.role !== 'admin' &&
    !isImpersonating &&
    accessLevel !== 'limited'
  ) {
    return <AcceptTermsPage email={user.email} onDecline={onLogout} />;
  }

  // Phase 0.2 / Task #23 — wizard resume gate.
  // Roles that have a dedicated wizard land back on it until completion.
  // Exploring users may run the wizard for their chosen licence while
  // membership is under review (suggested_role from /me).
  const WIZARD_FOR_LICENCE = {
    founder: '/onboarding/founder',
    investor: '/onboarding/investor',
    partner: '/onboarding/partner',
  };
  const wizardRole = (serverRole === 'exploring' ? (suggestedRole || user?.suggested_role) : (serverRole || user.role));
  const myWizard = WIZARD_FOR_LICENCE[wizardRole] || null;
  // The bare `/onboarding` has to count. Before the licence picker moved
  // there it sat at `/onboarding/licence`, which this prefix matched for
  // free; `'/onboarding'.startsWith('/onboarding/')` is false, so leaving
  // the prefix alone would let THIS gate bounce a user straight back off
  // the licence picker the gate above just sent them to.
  const onWizardPath = location.pathname === '/onboarding'
    || location.pathname.startsWith('/onboarding/');
  const needsWizard = !onboardingComplete && (
    onboardingFlow === null ||
    onboardingFlow === user.role ||
    (serverRole === 'exploring' && onboardingFlow === wizardRole)
  );
  if (
    myWizard &&
    !isImpersonating &&
    onboardingLoaded &&
    needsWizard &&
    !onWizardPath &&
    chatGateRole !== 'admin'
  ) {
    return <Navigate to={myWizard} replace />;
  }

  // Onboarding gate: only investors must complete KYC before accessing other
  // pages. Founders, partners, and advisors do not require KYC at all — and
  // admins (or impersonation sessions) always bypass for support purposes.
  // Investor signing endpoints (capital actions, deal-flow gating) still
  // enforce KYC server-side regardless of this client-side gate.
  // The /kyc, /activity, /help routes remain reachable for everyone.
  const effectiveRole = (realUser || user)?.role;
  const ALLOWED_BEFORE_KYC = ['/kyc', '/activity'];
  // Task #103 — /help and everything under it, not just the bare path. The
  // exact-match list allowed `/help` (then the ticket list) but not
  // `/help/<id>` (then a ticket), so an investor waiting on KYC who clicked
  // "Open ticket" in a notification was bounced to /kyc — cut off from the
  // one channel that could unblock them. The Help Center and the ticket flow
  // are both under /help now, and both have to stay open.
  const onHelpPath = location.pathname === '/help' || location.pathname.startsWith('/help/');
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
    !onHelpPath &&
    !onOnboardingPath
  ) {
    return <Navigate to="/kyc" replace />;
  }

  // Task #66 / Auth v2 — render onboarding gates full-screen, without the
  // app sidebar / topbar.
  if (onChatPath || onLicencePath) {
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
      hqView={hqView}
      supportLeftMs={supportLeftMs}
      onExtendImpersonation={onExtendImpersonation}
      supportReason={supportReason}
    >
      {children}
    </ProtectedLayout>
  );
}

/**
 * D914 (#2698), NAR14a: a page some profiles are not for draws its boundary,
 * inside their own shell, instead of RoleGuard's redirect. The route's guard
 * is unchanged; only who is refused is told why.
 */
const ROUTE_BOUNDARIES = [
  { under: /^\/raise\/investor-narrative(\/|$)/, roles: NARRATIVE_BOUNDARY_ROLES, Panel: NarrativeBoundary },
];

function RoleGuard({ user, allowedRoles, children, viewMode, realUser, isImpersonating, impersonationTargetRef }) {
  const { pathname } = useLocation();
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
    // A pending handoff still wins: the boundary is drawn only when nothing is on its way.
    const boundary = !pendingTarget && ROUTE_BOUNDARIES.find((b) => b.under.test(pathname) && b.roles.has(effectiveRole));
    if (boundary) return <boundary.Panel home={defaultPath} />;
    // D940: retain the canonical policy, including preview and impersonation exceptions.
    if (adminRefusal({ pathname, realRole: (realUser || user)?.role, isImpersonating })) {
      return <AdminOnlyNotice home={ROLE_DEFAULT_PATH[effectiveRole] || '/studio'} />;
    }
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
  // The Super Admin's choice between the HQ shell and the plain admin shell.
  // Per browser, default HQ, cleared with the session (lib/shellRole.js).
  const [hqView, setHqView] = useState(() => readHqView());

  const isImpersonating = !!realUser;
  const navigate = useNavigate();
  const location = useLocation();
  // D575 — on a phone a zone pill opens its lens in place: the routes below
  // render the lens's location while the URL and history stay put.
  const lensLocation = useLensLocation();
  // #2301 — count each opening of an old redirect address before it is retired.
  useRedirectBeacon(location.pathname, location.search);

  // `opts.hq` is only meaningful for mode 'admin': true is the HQ shell
  // ("Super Admin" in the list), false the plain shell ("Admin"). Other modes
  // leave the toggle where it was, so switching to Founder and back returns
  // the holder to whichever admin shell they were in.
  const handleViewModeChange = (mode, opts = {}) => {
    setViewMode(mode);
    localStorage.setItem('viewMode', mode);
    let defaultPath = ROLE_DEFAULT_PATH[mode] || '/studio';
    if (mode === 'admin' && typeof opts.hq === 'boolean') {
      setHqView(opts.hq);
      writeHqView(opts.hq);
      if (opts.hq) defaultPath = '/hq';
    }
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
  // D290 — `reason` is the text the worker STORED, as its response echoed it
  // (null when its write failed). `beginSupportSession` passes it; a caller
  // that passes nothing gets the copy `api.adminImpersonate` kept, which is
  // the same echo. Nothing here reads the typed text back from a dialog.
  const handleImpersonate = (token, impersonatedUser, targetPath, reason) => {
    const currentUser = safeReadJSON('user');
    const currentToken = localStorage.getItem('token');
    localStorage.setItem('realUser', JSON.stringify(currentUser));
    localStorage.setItem('realToken', currentToken);
    setRealUser(currentUser);

    localStorage.setItem('token', token);
    setUser(impersonatedUser);
    setViewMode(impersonatedUser.role);
    localStorage.setItem('viewMode', impersonatedUser.role);
    // `api.adminImpersonate` has just written this; lifting it into state is
    // what starts the banner's countdown.
    try { setImpersonationExpiresAt(localStorage.getItem('impersonationExpiresAt')); } catch { /* storage unavailable */ }
    setImpersonationReason(typeof reason === 'string' && reason.trim() ? reason : readStoredReason());
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

  /**
   * A support session is thirty minutes, and the banner has to say so.
   *
   * THE HAND-BACK IS THE LOAD-BEARING PART. The token dies on its own; if
   * the client simply carried on, the next call would 401, and
   * `api.request` reads a 401 as a dead session and bounces to /login —
   * ending the ADMIN's real session, not just the support session. So the
   * clock is watched here and the session handed back before that happens.
   */
  const [impersonationExpiresAt, setImpersonationExpiresAt] = useState(
    () => { try { return localStorage.getItem('impersonationExpiresAt'); } catch { return null; } },
  );
  const [impersonationLeftMs, setImpersonationLeftMs] = useState(null);
  // D290 — the stored reason, beside the stored expiry, so a reload mid-session
  // still draws H25's Why. Null reads "Not recorded" in the bar; it is never
  // initialised from a literal.
  const [impersonationReason, setImpersonationReason] = useState(() => readStoredReason());

  useEffect(() => {
    if (!isImpersonating || !impersonationExpiresAt) { setImpersonationLeftMs(null); return undefined; }
    const due = Date.parse(impersonationExpiresAt);
    if (Number.isNaN(due)) { setImpersonationLeftMs(null); return undefined; }
    const tick = () => setImpersonationLeftMs(Math.max(0, due - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [isImpersonating, impersonationExpiresAt]);

  const extendImpersonation = async () => {
    try {
      const id = localStorage.getItem('impersonationSessionId');
      if (!id) return;
      const res = await api.adminImpersonateExtend(id);
      if (res?.expires_at) setImpersonationExpiresAt(res.expires_at);
    } catch (e) {
      // Extending needs a recent TOTP step-up, which the admin may no
      // longer have. Say so rather than leaving the countdown running
      // toward a silent hand-back.
      alert(e?.message || 'The session could not be extended. It will end when the timer runs out.');
    }
  };

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
      localStorage.removeItem('impersonationExpiresAt');
    } catch { /* storage unavailable */ }
    // D290 — the reason goes with the session it explained: on End session
    // here, and on the thirty-minute hand-back, which comes through here.
    clearStoredReason();
    setImpersonationReason(null);
    localStorage.removeItem('realUser');
    localStorage.removeItem('realToken');
    setUser(origUser);
    setRealUser(null);
    setViewMode('admin');
    localStorage.setItem('viewMode', 'admin');
    // Back to the holder's own desk. A support session ends where the
    // franchisor works, not in the shell they were checking.
    setHqView(true);
    writeHqView(true);
    navigate(isSuperAdminUser(origUser) ? '/hq' : '/admin/accounts/all');
    setImpersonationExpiresAt(null);
    setImpersonationLeftMs(null);
    // T20 — restore the real admin's freshest profile immediately rather
    // than wait for the next throttled re-sync.
    refresh({ force: true });
  };

  // THE HAND-BACK. The support token dies on its own after thirty minutes.
  // Left alone, the next request would 401 and `api.request` would read that
  // as a dead session and bounce to /login — ending the ADMIN's own session
  // rather than just the support session. Handing it back a beat early
  // restores the real token cleanly instead.
  //
  // `exitImpersonation` is deliberately not in the dependency list: it is
  // rebuilt every render, and depending on it would tear down and re-arm
  // this effect once a second alongside the countdown.
  const exitImpersonationRef = useRef(exitImpersonation);
  exitImpersonationRef.current = exitImpersonation;
  useEffect(() => {
    if (!isImpersonating || impersonationLeftMs === null) return;
    if (impersonationLeftMs > 0) return;
    exitImpersonationRef.current();
  }, [isImpersonating, impersonationLeftMs]);

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
    // Codex review on D334: this never revoked a push subscription, so an
    // endpoint enabled under one account kept receiving THAT account's
    // notifications on this device after sign-out — `getPushState()` only
    // checks whether the browser has any subscription at all, and the next
    // account to sign in on the same device sees push already "on" and never
    // calls `enablePush()` to re-home it to its own `user_id`.
    //
    // A FOLLOW-UP REVIEW CAUGHT THE FIRST FIX HERE TOO: it awaited
    // `disablePush()` (behind a 3s race) before any of the synchronous local
    // teardown below — `setUser(null)` and the token/user wipe included. A
    // stalled service worker, subscription lookup or unsubscribe request
    // held up ALL of it for up to 3s, and a tab closed during that stall
    // kept both the local token and the server cookie alive: still signed
    // in on the next visit. So this no longer awaits `disablePush()` at
    // all — the token is captured now (it's about to be removed below) and
    // handed to `disablePush` explicitly, so the revocation can finish
    // fully in the background without the local teardown waiting on it or
    // on the token still being in `localStorage` by the time its own
    // `await`s resolve.
    const tokenForPushRevoke = localStorage.getItem('token');
    disablePush({ authToken: tokenForPushRevoke }).catch(() => { /* best-effort, never blocks sign-out */ });

    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('realUser');
    localStorage.removeItem('realToken');
    localStorage.removeItem('viewMode');
    // D142 — the HQ support-session payload, which this did not clear. It was
    // written by `SupportRedeemPage`, read by nothing, and removed by nothing,
    // so it outlived both the thirty-minute session and sign-out on that
    // browser: the next ordinary session on the same machine would have been
    // told HQ was inside the account. `lib/supportSession.js` owns the key so
    // the purge and the reader cannot be renamed apart.
    clearSupportSession();
    // D290 — and the operator's own stored reason, which would otherwise
    // outlive sign-out on this browser and be drawn on the next session
    // that impersonates from it.
    clearStoredReason();
    setImpersonationReason(null);
    clearHqView();
    // The active company is a per-BROWSER memory (localStorage), not a
    // per-account one. Left in place, the next account to sign in on this
    // browser would send the previous account's company on its first
    // requests. The worker ignores a company the caller does not belong to,
    // so nothing leaks — but that first paint would be unscoped rather than
    // the new account's own company.
    setActiveCompanyId(null);
    // Sweep any per-tab sensitive state (drafts, in-flight wizards, etc.) —
    // but NOT the reload guards, which this used to take with it.
    //
    // A bare `sessionStorage.clear()` here removed every loop bound in the app
    // at once, and `/login` is where that bit. `AuthScreen` calls `clearSession`
    // on mount for anyone arriving still signed in — which is every arrival via
    // `logout()` and via `RequireAuth`'s redirect — and `main.jsx` strips the
    // boot watchdog's `?__reboot=` marker on every successful boot. Between the
    // two, the watchdog lost both of its guards on that route and the next
    // failed boot had a fresh budget. `main.jsx` says this in writing: "Clearing
    // it while `main.jsx` also strips `?__reboot=` from the URL removed BOTH of
    // the boot watchdog's loop guards at once."
    //
    // The guards are not session state and are not sensitive; they are counts
    // that bound a recovery. `lib/reloadGuard.js` owns the list so a guard added
    // to any caller cannot be silently dropped here.
    preserveReloadGuards(() => {
      try { sessionStorage.clear(); } catch (e) { /* ignore */ }
    });
    // AND the API responses the service worker put on disk. localStorage and
    // sessionStorage were the only two places sign-out swept, so a signed-out
    // account's own project and academy bodies stayed in Cache Storage —
    // readable by the next person on this browser the moment the network
    // blinked. `sw.js` names those buckets `studioos-api-<VERSION>-<id>`;
    // dropping every one of them costs nothing but a re-fetch, and dropping
    // them ALL rather than just this account's means a bucket left by an
    // earlier build or an earlier account goes too.
    //
    // Not awaited and never fatal: sign-out must not hang or fail on a
    // browser that refuses Cache Storage (private windows, blocked site
    // data), where `caches` is absent or every call throws.
    try {
      if (typeof caches !== 'undefined' && caches?.keys) {
        caches.keys()
          .then((names) => Promise.all(
            names.filter((n) => n.startsWith('studioos-api-')).map((n) => caches.delete(n)),
          ))
          .catch(() => {});
      }
    } catch (e) { /* Cache Storage unavailable */ }
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
    user, onLogout: logout, viewMode, onViewModeChange: handleViewModeChange, hqView,
    isImpersonating, onExitImpersonation: exitImpersonation, realUser, onImpersonate: handleImpersonate,
    supportLeftMs: impersonationLeftMs, onExtendImpersonation: extendImpersonation,
    supportReason: impersonationReason,
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
  const founderEditor = (component) => <><FounderModuleBackLink user={user} />{component}</>;
  const founderWorkspace = (page, component, options = {}) => (
    effectiveRole === 'founder'
      ? <FounderWorkspacePage page={page} {...options}>{component}</FounderWorkspacePage>
      : component
  );
  // An admin who has switched View mode to Advisor has selected a ROLE, not a
  // person, so the surfaces that render one advisor's clients, bookings and
  // engagements have nothing to scope to. That boundary is right; the silent
  // <Navigate to="/studio"> that used to enforce it was not — clicking Practice
  // and landing on Studio with no explanation reads as a broken link, and was
  // reported as one. The notice says which boundary was hit and how to cross it.
  const advisorRolePreview = user?.role === 'admin' && !isImpersonating && effectiveRole === 'advisor';
  // The notice sits ABOVE the workspace rather than instead of it — the same
  // change `AdvisorBucketRoutes` makes for its eighteen zone routes, and for
  // the same reason: a card that replaces the body states the boundary once per
  // route and shows the product on none of them. `AdvisorAdvisoryWorkspace`
  // scopes on the signed-in advisor, so a preview reader sees its frame over no
  // rows, with the line above saying why.
  const advisorPrivateWorkspace = (component) => (
    advisorRolePreview
      ? <><AdvisorPreviewNotice />{component}</>
      : component
  );
  // The HQ-only surfaces, same shape as the advisor notice: a stated boundary
  // inside the shell, not a bounce. Keyed on the browsed identity's elevation
  // off /me — the route guard has already proved admin, and the worker
  // re-checks every call with requireSuperAdmin regardless. An admin without
  // the elevation used to reach these pages and watch each action 403.
  const hqOnly = (component) => (
    isSuperAdminUser(user) ? component : <SuperAdminOnlyNotice />
  );
  const partnerRolePreview = effectiveRole === 'partner' && user?.role !== 'partner';
  const partnerPrivateWorkspace = (component) => (
    partnerRolePreview ? <Navigate to="/studio" replace /> : component
  );
  const founderRaiseLanding = effectiveRole === 'founder'
    && new URLSearchParams(location.search).get('mode') !== 'workspace';
  const founderGrowLanding = effectiveRole === 'founder'
    && new URLSearchParams(location.search).get('mode') !== 'workspace';
  // Build's root owns its overview, as Raise, Grow and Network do: founder,
  // and not asking for the editor. Validate's root no longer branches at all
  // (D704, decision 2): every role its guard admits gets the cycle page.
  const founderBuildLanding = effectiveRole === 'founder'
    && new URLSearchParams(location.search).get('mode') !== 'workspace';
  const networkParams = new URLSearchParams(location.search);
  const founderNetworkLanding = effectiveRole === 'founder'
    && networkParams.get('mode') !== 'workspace'
    && !networkParams.has('tab')
    && !networkParams.has('intro');
  const researchParams = new URLSearchParams(location.search);
  const researchMode = researchParams.get('mode');
  const researchHasNonProjectQuery = [...researchParams.keys()].some((key) => key !== 'project_id');
  const founderResearchLanding = effectiveRole === 'founder'
    && (researchMode === 'landing' || (!researchHasNonProjectQuery && researchMode !== 'workspace'));
  // D422. FOUNDER MOUNTS THAT WERE A SECOND URL FOR A DESK. Bare
  // `/execution` rendered, for a founder, the very desk `/build` renders, so
  // it redirects, query string and all. The EDITOR behind it stays:
  // `?mode=workspace` still opens ExecutionPage, because no canvas zone yet
  // carries its writes — creating a task or an objective. `/build/discovery`
  // was the second, and #2335 retired it with its editor (the owner's call):
  // it forwards to Validate · Customer research for everyone. `/signals` was
  // the third, and D670 retired its page: it redirects to `/research`.
  const founderExecutionEditor = effectiveRole === 'founder'
    && new URLSearchParams(location.search).get('mode') === 'workspace';

  // D528 — what every route module (frontend/src/routes/<area>.jsx) gets from
  // this file's closures, so a route in a module is gated by the same `guard`,
  // `hqOnly` and `authOnly` as one written here, never by a copy of them. The
  // first module, Learning (D562), added it; routes_modules_d528.test.mjs holds
  // it present, in exactly this shape, while a module exists.
  const routeTools = { guard, hqOnly, authOnly, labRoles, effectiveRole, user, location };

  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-gray-500 dark:text-gray-400">Loading…</div>}>
<RouteErrorBoundary>
<Routes location={lensLocation || location}>
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
          namespace: /spinout-lab → /spinout-lab/investor-workspace. It was
          also a Fund Ops tab at /funds/lp-workspace, and /lp-portal was a
          second page for the same LP's own position; D372 retired both into
          this one route (redirects below). Role-gated like the Fund Ops
          route: this content is for investors and admins only. */}
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
          the founders' entry point for brand work. It does NOT replace
          /build/brand: layout and media editing still live there and the Lab
          page links to it (D360). It keeps the same roles as the old route
          (any founder, plus active lab members).
          A SPIN-OUT LAB PAGE, NOT A GROW PAGE. It used to be wrapped in
          founderWorkspace('grow', …) and the Grow tab bar, so the Lab tool
          wore Grow's header, tabs and seam. Grow's Brand page is /build/brand
          (#2343: /grow/brand forwards there); the two are separate pages and
          neither dresses as the other. */}
      <Route path="/spinout-lab/brand" element={guard(labRoles(['admin', 'founder']), <SpinoutLabBrandPage />)} />
      <Route path="/spinout-lab/cofounder-agreement" element={guard(labRoles(['admin']), <SpinoutLabCofounderAgreementPage />)} />
      {/* Co-founder Match tool page (design: Co-founder Match.dc) — the one
          co-founder matcher (#2297 §3). The older /cofounder browse page is
          removed (#2355) and its address lands here. */}
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
      <Route path="/for-founders" element={<DoorPage door="founders" />} />
      <Route path="/for-investors" element={<DoorPage door="investors" />} />
      <Route path="/for-service-partners" element={<DoorPage door="partners" />} />
      <Route path="/for-mentors" element={<Navigate to="/for-advisors" replace />} />
      <Route path="/for-advisors" element={<DoorPage door="advisors" />} />
      {/* D786 (#2211): the Investor tab of the one /pricing page. */}
      <Route path="/pricing/investor" element={<InvestorPricingRedirect />} />
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
      {/* Task #121 — public like its project sibling: the invitee may have no
          account yet, and the page bounces them to sign-in with a ?next= that
          returns here. Guarding it would send them somewhere with no way back. */}
      <Route path="/company/invitations/accept" element={<AcceptCompanyInvitePage />} />
      {/* D611 — the colleague's accept link. Unguarded: they may not be signed in yet. */}
      <Route path="/investor-seats/accept" element={<AcceptInvestorSeatPage />} />
      {/* Task #9 (X-2) — Public token-gated partner onboarding wizard.
          Mounted at the path embedded in admin-emailed magic links AND a
          query-string variant for fallback share-by-link channels. */}
      <Route path="/partner-onboarding/:token" element={<PartnerOnboardPage />} />
      <Route path="/partners/onboard" element={<PartnerOnboardPage />} />
      {/*
        These two are UNGATED on purpose — an email-change confirmation is
        followed from a mail client, often signed out. `isPublicPath()` in
        lib/api.js has a matching literal; both moved together.
      */}
      <Route path="/account/email/confirm" element={<EmailChangeConfirmPage />} />
      <Route path="/account/email/revoke" element={<EmailChangeRevokePage />} />
      <Route path="/settings/email/confirm" element={<EmailChangeConfirmPage />} />
      <Route path="/settings/email/revoke" element={<EmailChangeRevokePage />} />
      {/* D568 — the Account center's Developer section reads GET
          /settings/developer, which answers 403 to every role but admin, so
          its address carries the same gate. The static path outranks
          `:section` below; the page also lists the section for admins only. */}
      <Route path="/account/developer" element={guard(['admin'], <SettingsPage />)} />
      {/* D753 — a connector's own page, inside the Account center. */}
      <Route path="/account/connectors/:key" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <SettingsPage />)} />
      <Route path="/account/:section" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <SettingsPage />)} />
      {/* D789, D807 — Usage's own pages, /account/usage/cost and /usage/limits.
          `:section` above matches one segment only, so without this every
          Usage sub-page answered 404; SettingsPage reads the page from the path. */}
      <Route path="/account/usage/:page" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <SettingsPage />)} />
      <Route path="/settings/:section" element={<SettingsSectionRedirect />} />

      {/* Phase 0.1 — investor role added to every guard a partner currently
          passes. Investor-only nav is curated above (NAV_BY_ROLE.investor)
          so we get a tighter capital-allocator surface; per-route guards
          stay permissive so deep links keep working during the split. */}
      {/* Spin-Out Lab members (role `exploring`, lab-active) build their skills +
          values profile in Studio too — the lab Profiling page reads from it. */}
      <Route path="/studio" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <Dashboard activeRole={effectiveRole} authUser={user} />)} />
      <Route path="/studio/tickets/new" element={guard(['founder'], <Dashboard activeRole={effectiveRole} authUser={user} />)} />
      <Route path="/studio/archetype" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <ArchetypeCardPage activeRole={effectiveRole} />)} />
      {/* Task #9 — holding-state dashboard for chat-onboarded users awaiting admin role review. */}
      <Route path="/exploring" element={guard(['admin', 'exploring'], <ExploringDashboard />)} />
      <Route path="/dashboard" element={<DashboardRedirect />} />
      <Route path="/onboarding/chat" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'pending', 'exploring'], <OnboardingChatPage />)} />
      <Route path="/onboarding" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'pending', 'exploring'], <ChooseLicencePage />)} />
      {/* The licence picker answers "which adventure", not "which licence",
          so it lives at /onboarding. The old path stays as a redirect rather
          than a second mount: a welcome email, an OAuth callback or a
          bookmark sent before the rename must not 404, and two live mounts
          of the same page would let the gate and the links disagree about
          which one is canonical. */}
      <Route path="/onboarding/licence" element={<Navigate to="/onboarding" replace />} />
      <Route path="/onboarding/persona" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <OnboardingPersonaPage />)} />
      <Route path="/onboarding/founder" element={guard(['admin', 'founder', 'exploring'], <OnboardingFounderPage />)} />
      <Route path="/onboarding/investor" element={guard(['admin', 'investor', 'exploring'], <OnboardingInvestorPage />)} />
      <Route path="/onboarding/partner" element={guard(['admin', 'partner', 'exploring'], <OnboardingPartnerPage />)} />
      <Route path="/build/brand" element={guard(labRoles(['admin', 'founder']), founderWorkspace('grow', <BrandBuilderPage />))} />
      {/* Task #1 — RAISE Workspaces: founder-exclusive Pitch Deck / Reviewer
          routes now live inside the Pitch workspace; redirect to the right tab. */}
      <Route path="/build/deck" element={<Navigate to="/raise/pitch" replace />} />
      <Route path="/build/deck-reviewer" element={<Navigate to="/raise/pitch/review" replace />} />
      {/* D313 — a founder's saved analysis is `/research/companies/:id` now, and the list is
          `/research/companies`, so for everyone that route admits this redirects there, `?id=`
          included. Partner and investor are not admitted by it and no canvas-built page does
          this job for them, so for them the page stays. */}
      <Route path="/build/competitors" element={guard(['admin', 'founder', 'partner', 'investor'],
        effectiveRole === 'partner' || effectiveRole === 'investor'
          ? founderWorkspace('research', <CompetitorAnalysisPage />)
          : <Navigate
              to={new URLSearchParams(location.search).get('id')
                ? `/research/companies/${encodeURIComponent(new URLSearchParams(location.search).get('id'))}`
                : buildCompetitorsRedirect(location.search)}
              replace
            />)} />
      {/* #2339, #2335 (the owner's "Remove", #2297): two retired pages. The
          Financial Model is Capital's tab, the same FinancialsPage; customer
          discovery is Validate · Customer research. Each old address forwards,
          query and hash kept, until #2319 retires the redirects. */}
      <Route path="/build/financials" element={<Navigate replace to={{ pathname: '/raise/capital/model', search: location.search, hash: location.hash }} />} />
      <Route path="/build/discovery" element={<Navigate replace to={{ pathname: '/validate/customer-research', search: location.search, hash: location.hash }} />} />

      {/* ── Validate ─────────────────────────────────────────────────────────
          D661 (#1474): /validate is the cycle overview from #1487's read, and
          /validate/<module> its module pages. D704 (#1666, decision 2): the
          root no longer branches, so every role the guard admits, with or
          without `?mode=workspace`, gets the cycle page. The Interviews, Pain
          map and Hypotheses pages are gone: each address redirects to its
          module below (`ValidateZoneRedirect`). */}
      <Route path="/validate" element={guard(labRoles(['admin', 'founder']), <CycleRoute cycle="validate" />)} />
      {/* D685 §5.4: Record a session is the Validate page with the setup lightbox open over it, deep-linkable; closing goes back. */}
      <Route path="/validate/record" element={guard(labRoles(['admin', 'founder']), <CycleRoute cycle="validate" lightbox />)} />
      {/* D685 §5.6.2 (#1588): the Recording View full screen, bound to the app's one recording. */}
      <Route path="/validate/record/live" element={guard(labRoles(['admin', 'founder']), <RecordLivePage />)} />
      <Route path="/validate/:slug" element={guard(labRoles(['admin', 'founder']), <CycleRoute cycle="validate" />)} />
      <Route path="/validate/:slug/:id" element={guard(labRoles(['admin', 'founder']), <CycleRoute cycle="validate" record />)} />
      {/* D695: every Add has an address. Customer research's Add stays Record a session, the query kept. */}
      <Route path="/validate/customer-research/new" element={guard(labRoles(['admin', 'founder']), <HistoryRedirect to="/validate/record" />)} />
      <Route path="/validate/:slug/new" element={guard(labRoles(['admin', 'founder']), <CycleRoute cycle="validate" adding />)} />
      {/* D704 (#1666, PR 2b): the Interviews page is Customer research. The
          query and the hash are kept, and ?new= opens what it opened (decision 1). */}
      <Route path="/validate/interviews" element={guard(labRoles(['admin', 'founder']), <ValidateZoneRedirect zone="interviews" />)} />
      {/* D685 §5.11 (#1589): one interview's review: its sessions, the summary and the proposed findings.
          D696 (#1658): it is Customer research's record, so its address is
          /validate/customer-research/:id, and the old one redirects there with
          the query and the hash. D697 (#1659): CycleRoute draws it in record
          mode, through Validate's `recordPage`; the static path passes its slug. */}
      <Route path="/validate/customer-research/:id" element={guard(labRoles(['admin', 'founder']), <CycleRoute cycle="validate" slug="customer-research" record />)} />
      <Route path="/validate/interviews/:id" element={guard(labRoles(['admin', 'founder']), <ParamRedirect to="/validate/customer-research/:id" />)} />
      {/* D696 decision 13: the canvas's module slugs, redirected to the app's. */}
      <Route path="/validate/experiments-and-evidence" element={<ParamRedirect to="/validate/experiments" />} />
      <Route path="/validate/experiments-and-evidence/:id" element={<ParamRedirect to="/validate/experiments/:id" />} />
      <Route path="/validate/demand-and-urgency-signals" element={<ParamRedirect to="/validate/demand-signals" />} />
      <Route path="/validate/demand-and-urgency-signals/:id" element={<ParamRedirect to="/validate/demand-signals/:id" />} />
      {/* D704 (#1666): the Pain map and Hypotheses pages are Problem discovery
          and Experiments and evidence, the query and the hash kept (decision 1). */}
      <Route path="/validate/pain-map" element={guard(labRoles(['admin', 'founder']), <ValidateZoneRedirect zone="pain-map" />)} />
      <Route path="/validate/hypotheses" element={guard(labRoles(['admin', 'founder']), <ValidateZoneRedirect zone="hypotheses" />)} />
      {/* D693 decision 12 (#1704): a static line, so the founder zone keeps its roles; it renders the Verdict module. */}
      <Route path="/validate/verdict" element={guard(labRoles(['admin', 'founder']), <CycleRoute cycle="validate" slug="verdict" />)} />
      <Route path="/validate/session/:id" element={guard(labRoles(['admin', 'founder']), <InterviewSessionPage />)} />
      <Route path="/validate/inbox" element={guard(labRoles(['admin', 'founder']), <ChannelsInboxPage />)} />

      {/* ── Research · one path, four zone lists ─────────────────────────────
          Shared like /network already is: the route role-branches its element
          and the zone row comes from the shell config, so each license sees
          the zones its own canvas specifies. Markets mounts the live signals
          feed; Companies revives CompetitorAnalysisPage, which had been
          reachable only by deep link since it left the sidebar.

          THE ROOT BRANCHES TOO. `/research` used to be founder-only, and every
          other licence was redirected past it to `/research/ask` — so an
          investor could never reach their own Research overview, which was
          mounted at `/market-intel` alone. Worse, `/research/ask` is one of the
          zones that deliberately renders "No store behind this yet", so the
          first screen a licence saw was an honest empty state standing in for
          a page that exists. The root now serves the investor overview.
          `/market-intel` rendered the same component for its inbound links
          until D670 retired that page; it now redirects here. */}
      <Route path="/research" element={founderResearchLanding
        ? guard(labRoles(['admin', 'founder']), <FounderResearchDesk />)
        : researchRole === 'investor'
          ? guard(labRoles(['admin', 'investor']), <InvestorResearchWorkspace />)
          : researchRole === 'advisor' || researchRole === 'partner'
            ? guard(labRoles(['admin', 'advisor', 'partner']), <ResearchWorkspace role={researchRole} user={user} />)
            : <Navigate to="/research/ask" replace />} />
      <Route path="/research/ask" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <ResearchWorkspace role={researchRole} user={user} />)} />
      <Route path="/research/markets" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <ResearchWorkspace role={researchRole} user={user} />)} />
      <Route path="/research/markets/sector/:slug" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <MarketSectorProfile role={researchRole} />)} />
      <Route path="/research/markets/:uid" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <MarketReading role={researchRole} />)} />
      {/* D533/D546 (#1080) — Geographies, guarded like /research/markets. */}
      <Route path="/research/geographies" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <ResearchWorkspace role={researchRole} user={user} />)} />
      <Route path="/research/geographies/:code" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <GeographyProfile role={researchRole} />)} />
      <Route path="/research/companies" element={guard(labRoles(['admin', 'founder', 'advisor']), <ResearchWorkspace role={researchRole} user={user} />)} />
      <Route path="/research/companies/company/:uid" element={guard(labRoles(['admin', 'founder', 'advisor']), <CompanyProfile role={researchRole} />)} />
      <Route path="/research/companies/:id" element={guard(labRoles(['admin', 'founder', 'advisor']), <CompanyAnalysis role={researchRole} />)} />
      <Route path="/research/companies/:analysisId/:candidateId" element={guard(labRoles(['admin', 'founder', 'advisor']), <CompanyCandidate role={researchRole} />)} />
      <Route path="/research/funds" element={guard(labRoles(['admin', 'founder']), <ResearchWorkspace role={researchRole} user={user} />)} />
      <Route path="/research/funds/catalog/:id" element={guard(labRoles(['admin', 'founder']), <FundCatalogProfile role={researchRole} />)} />
      <Route path="/research/funds/:uid" element={guard(labRoles(['admin', 'founder']), <FundDossier role={researchRole} />)} />
      <Route path="/research/library" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <ResearchWorkspace role={researchRole} user={user} />)} />
      <Route path="/research/diligence" element={guard(labRoles(['admin', 'investor']), <ResearchWorkspace role={researchRole} user={user} />)} />
      <Route path="/research/diligence/:grantUid" element={guard(labRoles(['admin', 'investor']), <DiligenceRoom role={researchRole} />)} />
      <Route path="/research/diligence/:grantUid/files/:fileUid" element={guard(labRoles(['admin', 'investor']), <DiligenceFile role={researchRole} />)} />
      <Route path="/research/benchmarking" element={guard(labRoles(['admin', 'investor']), <ResearchWorkspace role={researchRole} user={user} />)} />
      <Route path="/research/benchmarking/:uid" element={guard(labRoles(['admin', 'investor']), <BenchmarkDetail role={researchRole} />)} />
      <Route path="/research/client-prep" element={guard(labRoles(['admin', 'advisor', 'partner']), <ResearchWorkspace role={researchRole} user={user} />)} />
      {/* Legacy Customer Discovery lands on Validate · Customer research (#2335). */}
      <Route path="/customer-discovery" element={<Navigate to="/validate/customer-research" replace />} />
      <Route path="/build/roadmap" element={guard(labRoles(['admin', 'founder']), <FounderBuildRoadmap />)} />
      <Route path="/build/cadence" element={guard(labRoles(['admin', 'founder']), <FounderBuildCadence />)} />
      <Route path="/build/kpi" element={guard(labRoles(['admin', 'founder']), <FounderBuildKpi />)} />
      {/* #2336 (the owner's "Remove", #2297): Metrics is KPI entry's. */}
      <Route path="/build/metrics" element={<Navigate replace to={{ pathname: '/build/kpi', search: location.search, hash: location.hash }} />} />
      {/* D670 — the Signals page is retired. Research reads the same signals
          table, so an old link lands there for everyone, with its query kept
          as D422's redirects keep theirs (`?project_id=` lands where it did). */}
      <Route path="/signals" element={<Navigate to={`/research${location.search}`} replace />} />
      {/* #2340 (the owner's "Remove", #2297): the cap table is Capital's tab. */}
      <Route path="/build/captable" element={<Navigate replace to={{ pathname: '/raise/capital/cap-table', search: location.search, hash: location.hash }} />} />
      {/* documentation/architecture/DECISIONS.md D11 — /marketplace was a partner-provider directory with
          inquiry threads and reviews whose backend exists only in the dev-only
          FastAPI: all 11 api.marketplace* calls hit /marketplace/* and the
          worker mounts none of it. Discovery is already served by working
          surfaces — /services (services.ts), /needs (needs.ts) and /partners
          (partners.ts) — so the redirect lands on one of those rather than a
          page where nothing loads. Inquiry threads and reviews have no backend
          anywhere and leave with the page. */}
      <Route path="/marketplace" element={<MarketplaceRedirect role={user?.role} founderTab="services" to="/offers/catalog" />} />
      {/* Task #2 — Founder Marketplace merges the Service Catalogue and the
          Needs Board into one tabbed page at /build/marketplace. #2338: their
          standalone addresses below only forward now (MarketplaceRedirect). */}
      <Route path="/build/marketplace" element={guard(['admin', 'founder'], founderWorkspace('validate', founderEditor(<FounderMarketplacePage user={user} />)))} />
      <Route path="/needs" element={guard(['admin', 'founder', 'partner'], <MarketplaceRedirect role={user?.role} founderTab="needs" to="/pipeline/leads" />)} />
      <Route path="/services" element={guard(['admin', 'founder', 'partner'], <MarketplaceRedirect role={user?.role} founderTab="services" to="/offers/catalog" />)} />
      <Route path="/founder/post-need" element={guard(['admin', 'founder'], <MarketplaceRedirect role={user?.role} founderTab="mine" to="/pipeline/leads" />)} />
      <Route path="/partner/needs" element={guard(['admin', 'partner'], <MarketplaceRedirect role={user?.role} founderTab="needs" to="/pipeline/leads" />)} />
      <Route path="/partner/insights" element={guard(['admin', 'partner'], partnerPrivateWorkspace(<PartnerWorkspaceTabs set="pipeline" user={user}><PartnerInsightsPage /></PartnerWorkspaceTabs>))} />
      {/* D569 — the partner earnings screens, at the canvas's own routes: no
          partner bucket holds them (`shellConfig.js` has no `/partner` prefix),
          so they are pages of their own with one pill row between three of
          them. NOT wrapped in `partnerPrivateWorkspace`, for the reason the
          `/referrals` route below gives: every route they call is
          `requireAuth` scoped to the caller (commissions, payouts, the code,
          the sign-ups, the credits, the board), or a party-or-admin check
          (the relationship's events and interactions), so an admin reading
          them reads their own and there is no partner-private boundary to
          state. The guard is the persona's, the narrower of the two. */}
      <Route path="/partner/earnings" element={guard(['admin', 'partner'], <PartnerEarnings />)} />
      <Route path="/partner/referrals" element={guard(['admin', 'partner'], <PartnerReferrals />)} />
      <Route path="/partner/relationships/:id" element={guard(['admin', 'partner'], <PartnerRelationshipLog />)} />
      <Route path="/deck/:id/print" element={guard(['admin', 'founder', 'partner', 'investor'], <PitchDeckPrintPage />)} />
      <Route path="/deck/share/:token" element={<PitchDeckPrintPage shareMode />} />
      {/* Task #53 — canonical share URL per spec is /share/deck/<token>. */}
      {/* Build queue #120 — public, audience-scoped cap-table link. No auth:
          the payload is redacted server-side for the link's audience. */}
      <Route path="/share/captable/:token" element={<SharedCapTablePage />} />
      {/* D588 — signed-in read. The Worker checks the named account. */}
      <Route path="/share/lab-report/:token" element={<RequireAuth {...authProps}><LabReportSharePage /></RequireAuth>} />
      <Route path="/share/deck/:token" element={<PitchDeckPrintPage shareMode />} />
      {/* Task #2 — public, HMAC-token-gated print target consumed only by
          the Cloudflare Browser Rendering session that drives server-side
          PDF / PPTX exports. Not auth-guarded; the token is signed and
          short-lived. */}
      <Route path="/deck/print-export/:token" element={<PitchDeckPrintPage exportMode />} />
      {/* D938 (#2743) — the Admin Console is retired. `/admin` and every
          `/admin?tab=` forward before anything mounts, keeping the query and
          hash and adding ?moved=<tab>. The guard stays, so a member is
          turned away here as before, not after a forward. */}
      <Route path="/admin" element={guard(['admin'], <LegacyContractsRedirect />)} />
      {/* Each tool at its #2375 address, under AdminPageHeader. All accounts
          sits under /admin/accounts until #2375's question 1 is answered
          (part 4, #2746); /admin/accounts itself stays HQ › Team. */}
      <Route path="/admin/accounts/all" element={guard(['admin'], <AllAccountsPage onImpersonate={handleImpersonate} />)} />
      <Route path="/admin/kyc" element={guard(['admin'], <KycPage />)} />
      <Route path="/admin/directory" element={guard(['admin'], <DirectoryPage />)} />
      <Route path="/admin/wellbeing" element={guard(['admin'], <AdminWellbeingPage />)} />
      {/* Platform and Revenue pages are the Super Admin's, like every other (#2375). */}
      <Route path="/admin/platform/bank-accounts" element={guard(['admin'], hqOnly(<BankAccountsPage />))} />
      <Route path="/admin/platform/product-testing" element={guard(['admin'], hqOnly(<ProductTestingHqPage />))} />
      <Route path="/admin/platform/promo-codes" element={guard(['admin'], hqOnly(<PromoCodesPage />))} />
      <Route path="/admin/revenue/billing" element={guard(['admin'], hqOnly(<BillingPage />))} />
      <Route path="/admin/trash" element={guard(['admin'], <AdminTrashPage />)} />
      {/* D940 (#2745), SHL7b: an /admin address no route names. An admin reads Not found; a member reads that admin pages are for studio admins (RoleGuard's /admin boundary), not a silent bounce. Ranked below every named /admin route. */}
      <Route path="/admin/*" element={guard(['admin'], <NotFoundPage />)} />
      {/* D953 (#2371) — Referral review is now Refer & Earn › Queue, under
          Programs. The old address keeps its query and hash and adds
          ?moved=refer-earn; it is counted for #2319. */}
      <Route path="/admin/refer-earn" element={<ReferEarnRedirect />} />
      {/* D569 — every read on it is `requireAdmin` and answers on either tier,
          so the guard is `['admin']` and never `hqOnly`. Its one HQ-only
          zone, the take rate, is `requireSuperAdmin`; the page asks only when
          `/me` carries the elevation and says so otherwise. */}
      <Route path="/admin/commissions" element={guard(['admin'], hqOnly(<AdminCommissions user={user} />))} />
      {/* D923 (#2370) — Partner invitations moved to its tabs. The old address
          lands on Overview with the moved notice; it is counted for #2319. */}
      <Route path="/admin/partners" element={<Navigate to="/admin/partner-invitations?moved=partners" replace />} />
      {/* D923 (#2370) — the tabs and one address per invitation and per deal,
          each behind today's guard, never hqOnly. Static paths before :id. */}
      <Route path="/admin/partner-invitations" element={guard(['admin'], <AdminPartnerInvitations />)} />
      <Route path="/admin/partner-invitations/invitations" element={guard(['admin'], <AdminPartnerInvitations />)} />
      <Route path="/admin/partner-invitations/invitations/:id" element={guard(['admin'], <AdminPartnerInvitations />)} />
      <Route path="/admin/partner-invitations/deals" element={guard(['admin'], <AdminPartnerInvitations />)} />
      <Route path="/admin/partner-invitations/deals/:id" element={guard(['admin'], <AdminPartnerInvitations />)} />
      <Route path="/admin/partner-invitations/referrals" element={guard(['admin'], <AdminPartnerInvitations />)} />
      {/* D952 (#2728): Firm links moved to Advisors & Partners › Firms; the old address forwards there. */}
      <Route path="/admin/partner-invitations/firm-links" element={<FirmLinksRedirect />} />
      <Route path="/admin/team" element={guard(['admin'], <AdminTeam />)} />
      {/* Task #9 — exploring-users review queue (binding e-sign + role assignment). */}
      <Route path="/admin/exploring" element={guard(['admin'], <AdminExploring />)} />
      <Route path="/admin/lp-applications" element={guard(['admin'], <AdminLpApplications />)} />
      {/* Territory licence ledger (migration 187). Admin only — it carries the
          fee, the revenue share and an exclusive grant over whole countries. */}
      <Route path="/admin/licences" element={guard(['admin'], hqOnly(<AdminLicences />))} />
      {/* D981 (#2376) — Program grants: which programs each licensed studio may run. */}
      <Route path="/admin/licences/programs" element={guard(['admin'], hqOnly(<ProgramGrants />))} />
      <Route path="/admin/funds" element={guard(['admin'], hqOnly(<HqFundsPage />))} />
      {/* D714 decision 7: guard(['admin']), not hqOnly — that wrapper admits the Super Admin alone. On a branch the console says so and reads nothing. */}
      <Route path="/admin/fund-admin" element={guard(['admin'], <FundAdminConsole />)} />
      {/* A subsidiary admin reads their OWN licence; /admin/licences is HQ's ledger of every one. */}
      <Route path="/admin/my-licence" element={guard(['admin'], <MyLicencePage />)} />
      {/* D800 (#2233): the Licences page's tabs, each a sub-path of the page, behind the same guard. */}
      <Route path="/admin/my-licence/terms" element={guard(['admin'], <MyLicencePage />)} />
      <Route path="/admin/my-licence/programs" element={guard(['admin'], <MyLicencePage />)} />
      <Route path="/admin/my-licence/contract" element={guard(['admin'], <MyLicencePage />)} />
      <Route path="/admin/my-licence/statements" element={guard(['admin'], <MyLicencePage />)} />
      <Route path="/admin/my-licence/requests" element={guard(['admin'], <MyLicencePage />)} />
      <Route path="/admin/my-licence/history" element={guard(['admin'], <MyLicencePage />)} />
      {/* D286 — S20's five landings. `guard(['admin'])` and never `hqOnly`:
          this is the plain admin's own shell. Each carries its consoles as
          literal links, which is how the reachability walk reaches them. */}
      <Route path="/admin/held/accounts" element={guard(['admin'], <HeldAccounts />)} />
      <Route path="/admin/held/approvals" element={guard(['admin'], <HeldApprovals />)} />
      {/* D953 (#2371) — Programs left /admin/held/ when it was rebuilt to its
          canvas. The old address keeps its query and hash and adds
          ?moved=held. The catalogue and each program page with its tabs as
          static sub-paths, each behind today's guard, never hqOnly. */}
      <Route path="/admin/held/programs" element={<HeldProgramsRedirect />} />
      <Route path="/admin/programs" element={guard(['admin'], <AdminProgramsCatalogue />)} />
      <Route path="/admin/programs/mentor-cohorts" element={guard(['admin'], <AdminMentorCohortAccess />)} />
      <Route path="/admin/programs/mentor-cohorts/how-it-runs" element={guard(['admin'], <AdminMentorCohortAccess />)} />
      <Route path="/admin/programs/mentor-cohorts/people" element={guard(['admin'], <AdminMentorCohortAccess />)} />
      <Route path="/admin/programs/refer-and-earn" element={guard(['admin'], <AdminReferAndEarn />)} />
      <Route path="/admin/programs/refer-and-earn/how-it-runs" element={guard(['admin'], <AdminReferAndEarn />)} />
      <Route path="/admin/programs/refer-and-earn/queue" element={guard(['admin'], <AdminReferAndEarn />)} />
      <Route path="/admin/programs/refer-and-earn/settings" element={guard(['admin'], <AdminReferAndEarn />)} />
      <Route path="/admin/programs/perks" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/perks/how-it-runs" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/perks/queue" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/learning" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/learning/how-it-runs" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/learning/people" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/referral-partners" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/referral-partners/how-it-runs" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/investor-cohorts" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/ai-native-venture" element={guard(['admin'], <AdminProgramPage />)} />
      {/* D930 (#2367) — Community left /admin/held/ when it was rebuilt to its
          canvas, as Insights did. The old address keeps its query and hash
          and adds ?moved=held-community. */}
      <Route path="/admin/community" element={guard(['admin'], <AdminCommunity />)} />
      <Route path="/admin/held/community" element={<HeldCommunityRedirect />} />
      {/* D893 (#2366) — Insights left /admin/held/ when it was rebuilt to its
          canvas. The old address keeps its query and hash and adds ?moved=. */}
      <Route path="/admin/insights" element={guard(['admin'], <AdminInsights />)} />
      <Route path="/admin/held/insights" element={<HeldInsightsRedirect />} />
      {/* D107 — the eight subsidiary rows (Admin · Subsidiary S0–S6). Each one
          has a route so no sidebar row can 404; the ones whose artboards are
          not built state what they will show and which PR builds them.

          `guard(['admin'])` and NOT a branch check. The shell arm is a
          sidebar, never a permission (lib/shellRole.js), and the tenancy wall
          is not a client-side route test: on a branch these pages read the
          branch's own database because that is the only database bound to the
          Worker serving them, and on HQ they carry no data at all. A second,
          weaker copy of the wall in the router would be the thing that looks
          like the guarantee without being it. */}
      {/* D473 — the digest opens Studio. The path stays, so a bookmark lands,
          and the query string and hash travel. `/branch/*` is unchanged. */}
      <Route path="/branch" element={guard(['admin'], <BranchDigestRedirect />)} />
      {/* D129 — LIVE, and it wraps ITSELF in BranchZone because its rail
          coverage is what it loaded. The notice this replaces said seats used
          "is not a number that can be shown today", which D127 made false: a
          branch counts its own seats from `users.role`. S8's seat LEDGER still
          does not ship, and the page says so in the rail's unavailable list
          rather than in a notice standing in for the whole screen. */}
      <Route path="/branch/accounts" element={guard(['admin'], <BranchAccounts user={user} />)} />
      {/* D112 — the outbound HALF of S3 is live: the To-HQ lane and HQ's
          answers. The local board is the eleven lanes (D215), on the same page. */}
      {/* Approvals wraps ITSELF in BranchZone, unlike the seven above, and the
          asymmetry is the point: it loads live escalations, so only the page
          knows what its rail can report. A zone with nothing loaded takes the
          frame from its route here; a zone with data owns it, exactly as every
          workspace page passes its own `rail` to WorkspaceShell. Each of these
          seven loses its wrapper on the day PR 12 or PR 14 gives it a page. */}
      <Route path="/branch/approvals" element={guard(['admin'], <BranchApprovals user={user} />)} />
      <Route path="/branch/programs" element={guard(['admin'], <BranchPrograms user={user} />)} />
      <Route path="/branch/community" element={guard(['admin'], <BranchCommunity user={user} />)} />
      <Route path="/branch/contracts" element={guard(['admin'], <BranchContracts user={user} />)} />
      <Route path="/branch/insights" element={guard(['admin'], <BranchInsights user={user} />)} />
      {/* D210 — S15, reached from Insights by a literal link and lit under its
          row. Not suspension-gated: a frozen branch still reads where it stands. */}
      <Route path="/branch/insights/analytics" element={guard(['admin'], <BranchAnalytics user={user} />)} />
      <Route path="/branch/settings" element={guard(['admin'], <BranchSettings user={user} />)} />
      {/* The HQ shell's Contracts and Team rows. Both frame panels the Admin
          Console already has (Legal templates; the Users table) for the
          franchisor, with the holder console above the accounts. */}
      <Route path="/admin/contracts" element={guard(['admin'], <HqContractsPage />)} />
      <Route path="/admin/accounts" element={guard(['admin'], hqOnly(<HqAccountsPage onImpersonate={handleImpersonate} />))} />
      {/* D633 (#1391, Q2) — one member's credits; the Team directory's drawer is its door. */}
      <Route path="/admin/accounts/credits/:userId" element={guard(['admin'], hqOnly(<MemberCreditsPage />))} />
      {/* HQ · Home (canvas H1). The whole business on one screen; every
          per-subsidiary figure says Not recorded until accounts carry a licence. */}
      <Route path="/hq" element={guard(['admin'], hqOnly(<HqHomePage />))} />
      {/* D210 — H15. Not a sidebar row: its artboard lights Home, and it is
          reached from Home's Accounts tile by a literal link. */}
      <Route path="/admin/analytics" element={guard(['admin'], hqOnly(<HqAnalyticsPage />))} />
      {/* HQ · Security (canvas Y2, decision A4). Four zones read their stores;
          four say what is not recorded. Force re-auth is the one write. */}
      <Route path="/admin/revenue" element={guard(['admin'], hqOnly(<HqRevenuePage />))} />
      {/* D634 — one billing dispute, read live from Stripe (canvas hq-dispute). */}
      <Route path="/admin/revenue/disputes/:disputeId" element={guard(['admin'], hqOnly(<HqDisputePage />))} />
      <Route path="/admin/content" element={guard(['admin'], hqOnly(<HqContentPage />))} />
      <Route path="/admin/platform" element={guard(['admin'], hqOnly(<HqPlatformPage />))} />
      {/* D203 — the operator switches. Not a sidebar row: the HQ group is eleven
          rows by design, and this page is reached from Platform's Feature flags
          zone by a literal link, which the reachability walk counts. */}
      <Route path="/admin/platform/switches" element={guard(['admin'], hqOnly(<HqPlatformSwitchesPage />))} />
      {/* D1008 (#2386): Payments, its two tabs as sub-paths, HQ only; /admin?tab=payments forwards here (LegacyContractsRedirect). */}
      <Route path="/admin/platform/payments" element={guard(['admin'], hqOnly(<Payments />))} />
      <Route path="/admin/platform/payments/stripe" element={guard(['admin'], hqOnly(<Payments />))} />
      <Route path="/admin/platform/meeting-bots" element={guard(['admin'], hqOnly(<HqMeetingBotsPage />))} />
      <Route path="/admin/platform/topology" element={guard(['admin'], hqOnly(<HqPlatformTopologyPage />))} />
      <Route path="/admin/platform/allowances" element={guard(['admin'], hqOnly(<HqPlatformAllowancesPage />))} />
      <Route path="/admin/platform/ai-usage" element={guard(['admin'], hqOnly(<HqAiUsagePage />))} />
      {/* The owner's ruling (2026-10-20) — Integration keys, with GitHub Sync as
          its second section (#github), is a Super Admin row of its own. The
          old Admin Console tab links (integration-keys, github) redirect here. */}
      <Route path="/admin/integration-keys" element={guard(['admin'], hqOnly(<HqIntegrationKeysPage />))} />
      <Route path="/admin/hq-support" element={guard(['admin'], hqOnly(<HqSupportPage />))} />
      <Route path="/hq/review" element={guard(['admin'], hqOnly(<ReviewQueuePage />))} />
      {/* D638 (#1384, #1412) — the one page for the reward rules and grants, Super Admin only.
          Its doors are Platform's Perk credits zone and the review queue; it lights the Platform row. */}
      <Route path="/admin/credit-rules" element={guard(['admin'], hqOnly(<CreditRulesPage />))} />
      {/* #1412 — #1399's address for the same page; old links keep their query and hash. */}
      <Route path="/hq/credits" element={<HqCreditsRedirect />} />
      <Route path="/admin/security" element={guard(['admin'], hqOnly(<HqSecurityPage />))} />
      {/* D633 (#1391, Q3) — trust obligations by role, read-only; HQ Security links to it. */}
      <Route path="/admin/security/obligations" element={guard(['admin'], hqOnly(<TrustObligationsPage />))} />
      {/* D972 (#2369) — Advisors & Partners under Community, its tabs as
          sub-paths (D936's header). /admin/network-profiles and the Admin
          Console's ?tab=network-profiles forward to the Deck roster tab. */}
      <Route path="/admin/advisors-partners" element={guard(['admin'], <AdvisorsPartners />)} />
      <Route path="/admin/advisors-partners/firms" element={guard(['admin'], <AdvisorsPartners />)} />
      <Route path="/admin/advisors-partners/deck" element={guard(['admin'], <AdvisorsPartners />)} />
      {/* D989 (#2380): Partner profiles, its two tabs as sub-paths; /admin?tab=profiles forwards here (LegacyContractsRedirect). */}
      <Route path="/admin/partner-profiles" element={guard(['admin'], <PartnerProfiles />)} />
      <Route path="/admin/partner-profiles/all" element={guard(['admin'], <PartnerProfiles />)} />
      {/* D997 (#2378): Persona segments, its two tabs as sub-paths; /admin?tab=personas forwards here (LegacyContractsRedirect). */}
      <Route path="/admin/persona-segments" element={guard(['admin'], <PersonaSegments />)} />
      <Route path="/admin/persona-segments/unclassified" element={guard(['admin'], <PersonaSegments />)} />
      <Route path="/admin/network-profiles" element={<ApRedirect />} />
      {/* D937 (#2374) — the Spin-Out Lab under Programs, its tabs as sub-paths
          (D936's header). /admin/spinout-lab, its /preview and the Admin
          Console's ?tab=lab-applications forward here with the moved notice. */}
      <Route path="/admin/programs/spinout-lab" element={guard(['admin'], <AdminLab onImpersonate={handleImpersonate} />)} />
      <Route path="/admin/programs/spinout-lab/applications" element={guard(['admin'], <AdminLab onImpersonate={handleImpersonate} />)} />
      <Route path="/admin/programs/spinout-lab/cohorts" element={guard(['admin'], <AdminLab onImpersonate={handleImpersonate} />)} />
      <Route path="/admin/programs/spinout-lab/cohorts/:ym" element={guard(['admin'], <AdminLab onImpersonate={handleImpersonate} />)} />
      <Route path="/admin/programs/spinout-lab/participants" element={guard(['admin'], <AdminLab onImpersonate={handleImpersonate} />)} />
      <Route path="/admin/programs/spinout-lab/participants/:uid" element={guard(['admin'], <AdminLab onImpersonate={handleImpersonate} />)} />
      <Route path="/admin/programs/spinout-lab/hosts" element={guard(['admin'], <AdminLab onImpersonate={handleImpersonate} />)} />
      <Route path="/admin/programs/spinout-lab/formation" element={guard(['admin'], <AdminLab onImpersonate={handleImpersonate} />)} />
      <Route path="/admin/programs/spinout-lab/graduation" element={guard(['admin'], <AdminLab onImpersonate={handleImpersonate} />)} />
      <Route path="/admin/spinout-lab" element={<LabRedirect />} />
      {/* D442 — the console the approvals board links to. Never a tab of the retired Admin Console. */}
      <Route path="/admin/spinout-moderation" element={guard(['admin'], <SpinoutModerationPage />)} />
      {/* Task #106 — read-only admin preview of the new-founder Spin-Out Lab
          journey (simulated client-side state; no impersonation, no writes). */}
      <Route path="/admin/programs/spinout-lab/preview" element={guard(['admin'], <AdminSpinoutJourneyPreview />)} />
      <Route path="/admin/spinout-lab/preview" element={<LabPreviewRedirect />} />
      <Route path="/admin/telegram" element={guard(['admin'], hqOnly(<AdminTelegram />))} />
      <Route path="/admin/x" element={guard(['admin'], hqOnly(<AdminX />))} />
      {/* Task #20 — Admin Best-Fit console (consultation queue + full report). */}
      <Route path="/admin/best-fit" element={guard(['admin'], <AdminBestFitPage />)} />
      <Route path="/admin/profiling-trends" element={guard(['admin'], <AdminProfilingTrends />)} />
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
      {/* D915 (#2368): the Events desk's tabs and one page per event, behind the same guard; the static paths sit before `:id`. */}
      <Route path="/admin/events/review" element={guard(['admin'], <AdminEventsPage />)} />
      <Route path="/admin/events/all" element={guard(['admin'], <AdminEventsPage />)} />
      <Route path="/admin/events/calendar" element={guard(['admin'], <AdminEventsPage />)} />
      <Route path="/admin/events/:id" element={guard(['admin'], <AdminEventsPage />)} />
      <Route path="/admin/jobs" element={guard(['admin'], <AdminJobsPage />)} />
      <Route path="/admin/circles" element={guard(['admin'], <AdminCirclesPage />)} />
      <Route path="/admin/publications" element={guard(['admin'], <AdminPublications />)} />
      <Route path="/admin/publications/new" element={guard(['admin'], <AdminPublicationNew />)} />
      <Route path="/admin/publications/:id" element={guard(['admin'], <AdminPublicationDetail />)} />
      {/* #2333 — one publications list: /articles carries the briefs the
          /insights index listed; each brief keeps its share link below. */}
      <Route path="/insights" element={<Navigate to="/articles#briefs" replace />} />
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
      {/* /projects is RETIRED (task #101). It was the "Startups" list: a table
          of projects, a filter box, and the create form.

          The list is what /build already is — sidebarConfig has matched
          /projects into the Build bucket for as long as that bucket has
          existed, so the nav has treated them as one place and only the URL
          disagreed.

          THE CREATE FORM MOVED FIRST, because it was the only one. This page
          held the sole `api.createProject` caller in the whole SPA, with ten
          empty states across the app pointing at it ("Create one →") and a
          Command Palette entry addressing it as /projects?new=1. Deleting the
          page without moving that would have removed the only way to make a
          startup, and nothing in CI would have said so — check-api-drift reads
          api.js -> worker and never the reverse. It now lives in
          components/CreateStartupForm.jsx, mounted on the Build cycle overview
          (pages/cycles/CycleRoute.jsx, D661), which honours ?new=1 because a
          redirect cannot carry a query string.

          /projects/:id below is NOT retired: ProjectDetail is deep-linked from
          the dashboard, the investor desk, the slide editor
          and the invite-accept flow. */}
      <Route path="/projects" element={<Navigate to="/build" replace />} />
      <Route path="/projects/:id" element={guard(labRoles(['admin', 'founder', 'partner', 'investor']), founderWorkspace('build', <ProjectDetail />))} />
      {/* Task #12 — Founder Execution area: one deep-linkable shell wrapping the
          Projects / Board / Roadmap views. Standalone routes above stay intact
          for other personas. */}
      {/* D661 (#1474): a founder's /build is the cycle overview from #1475's
          read, and /build/<module> its module pages. Every Build page above
          and below is a static route and wins over /build/:slug; no module
          slug is one of them. */}
      <Route path="/build" element={founderBuildLanding
        ? guard(['admin', 'founder'], <CycleRoute cycle="build" />)
        : <Navigate to="/build/this-week" replace />} />
      {/* D686 §5.1: Connect a tool, the Build page with its lightbox open; /build/tools is the history's address. */}
      <Route path="/build/connect" element={guard(['admin', 'founder'], <CycleRoute cycle="build" lightbox />)} />
      <Route path="/build/tools" element={guard(['admin', 'founder'], <HistoryRedirect to="/build/operating-systems" hash="#tools" />)} />
      <Route path="/build/:slug" element={guard(['admin', 'founder'], <CycleRoute cycle="build" />)} />
      <Route path="/build/:slug/:id" element={guard(['admin', 'founder'], <CycleRoute cycle="build" record />)} />
      <Route path="/build/:slug/new" element={guard(['admin', 'founder'], <CycleRoute cycle="build" adding />)} />
      <Route path="/execution" element={guard(['admin', 'founder'], effectiveRole === 'founder' && !founderExecutionEditor
        ? <Navigate to={`/build${location.search}`} replace />
        : founderWorkspace('build', founderEditor(<ExecutionPage />)))} />
      <Route path="/build/this-week" element={guard(['admin', 'founder'], <FounderBuildThisWeek />)} />
      <Route path="/build/board" element={guard(['admin', 'founder'], <FounderBuildBoard />)} />
      {/* Task #1 — RAISE Workspaces. Three founder workspaces compose the
          existing pages via an `embedded` prop; each guarded for the roles of
          the pages it wraps. Standalone routes (/incorporate, /incorporate/*,
          /compliance) stay intact for the investor/partner personas that share
          them; /build/financials and /build/captable forward to Capital's tabs
          (#2339, #2340). */}
      {/* D894 (#2434) — the Pitch deck studio. Its home, Review and Share &
          analytics tabs are the studio's own; the deck builder moved to
          /raise/pitch/edit until #2434 part 4 builds the editor, and the old
          ?mode=workspace address redirects there with a moved notice. */}
      {/* D905 (#2684), PD22: an Advisor, an Operating Partner or an Explorer
          reads the studio's boundary inside their own shell, never a bounce
          (as `hqOnly`'s notice is drawn). Nothing from a deck is read. */}
       <Route path="/raise/pitch" element={guard(labRoles(['admin', 'founder', 'advisor', 'partner', 'exploring']),
         (effectiveRole === 'advisor' || effectiveRole === 'partner' || effectiveRole === 'exploring') && user?.spinout_lab_active !== 1
           ? <PitchBoundary role={effectiveRole} />
           : new URLSearchParams(location.search).get('mode') === 'workspace'
           ? <PitchWorkspaceMoved />
           : founderEditor(<PitchStudio tab="decks" />))} />
       <Route path="/raise/status" element={guard(labRoles(['admin', 'founder']), <FounderRaiseStatus />)} />
      {/* D898 (#2676): the canvas's editor (PD1) at /raise/pitch/edit. Today's
          template builder moves to /raise/pitch/builder until the editor covers
          its templates and fills, when #2676's last part retires it. */}
      <Route path="/raise/pitch/edit" element={guard(labRoles(['admin', 'founder']), founderWorkspace('raise', founderEditor(<PitchEditor />)))} />
      <Route path="/raise/pitch/builder" element={guard(labRoles(['admin', 'founder']), founderWorkspace('raise', founderEditor(<PitchWorkspacePage />)))} />
      {/* D897 (#2677), PD3–PD6: New deck. A static path, so `/raise/:slug/new` never takes it. */}
      <Route path="/raise/pitch/new" element={guard(labRoles(['admin', 'founder']), founderEditor(<NewDeck />))} />
      <Route path="/raise/pitch/analytics" element={guard(labRoles(['admin', 'founder']), founderEditor(<PitchStudio tab="analytics" />))} />
      {/* D911 (#2695): Positioning moved into Investor narrative › Positioning (NAR18). */}
      <Route path="/raise/pitch/positioning" element={<PitchPositioningRedirect />} />
      <Route path="/raise/pitch/review" element={guard(labRoles(['admin', 'founder']), founderEditor(<PitchStudio tab="review" />))} />
      {/* D901 (#2680) — present mode (PD16): full screen, reads one version, writes nothing. */}
      <Route path="/raise/pitch/present" element={guard(labRoles(['admin', 'founder']), founderEditor(<PitchPresent />))} />
      <Route path="/raise/pitch/notes" element={guard(labRoles(['admin', 'founder']), founderEditor(<PitchStudio tab="notes" />))} />
      <Route path="/raise/capital" element={guard(['admin', 'founder'],
        new URLSearchParams(location.search).get('mode') === 'workspace'
          ? founderWorkspace('raise', founderEditor(<CapitalWorkspacePage />))
          : <FounderRaiseCapital />)} />
      <Route path="/raise/capital/model" element={guard(['admin', 'founder'], founderWorkspace('raise', founderEditor(<CapitalWorkspacePage />)))} />
      <Route path="/raise/capital/cap-table" element={guard(['admin', 'founder'], founderWorkspace('raise', founderEditor(<CapitalWorkspacePage />)))} />
      {/* D632 — the cap table's draft variants (Ops canvas `ct-variants`). The main
          cap table stays one per company at /raise/capital/cap-table. */}
      <Route path="/raise/cap-table/variants" element={guard(['admin', 'founder'], founderWorkspace('raise', <CapTableVariantsPage />))} />
      <Route path="/raise/cap-table/variants/:variant" element={guard(['admin', 'founder'], founderWorkspace('raise', <CapTableVariantsPage />))} />
      {/* D696 decision 12: /raise/data-room answers by mode, in this order. An investor's rooms are
          read by grant under Research · Diligence (D311): the investor branch is a redirect there, so a
          bookmark still lands, and the guard keeps admitting investor so the redirect can run. A founder's
          ?mode=workspace is the files tool (uploads, Share and Revoke, the NDA switches, advisor grants);
          ?mode=access is the read-only access view; the bare address is the Data room module page,
          whose records open at /raise/data-room/:id. Both tools return to the module page. */}
      <Route path="/raise/data-room" element={guard(['admin', 'founder', 'investor'],
        effectiveRole === 'investor'
          ? <Navigate to="/research/diligence" replace />
          : new URLSearchParams(location.search).get('mode') === 'workspace'
            ? founderWorkspace('raise', founderEditor(<DataRoomPage user={user} />))
            : new URLSearchParams(location.search).get('mode') === 'access'
              ? founderEditor(<FounderRaiseDataRoom />)
              : <CycleRoute cycle="raise" slug="data-room" />)} />
      {/* Every persona, listed explicitly. `guard([])` would deny everyone —
          RoleGuard tests `allowedRoles.includes(effectiveRole)`, which is
          always false on an empty array, so the route would exist and be
          unreachable. */}
      <Route path="/messages" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <MessagesPage user={user} />)} />
      {/* Same explicit list. The partner and admin tabs inside the page are
          gated on the role again there — a role that cannot submit a listing
          simply does not see the tab. */}
      {/* D413 — the standalone /perks page owns its own Marketplace, My perks
          and admin Review queue tabs. The partner-side Submit and Performance
          surface lives separately at /offers/perk-deals. */}
      <Route path="/perks" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], effectiveRole === 'partner' ? <Navigate replace to="/offers/perk-deals" /> : <PerksPage user={user} />)} />
      <Route path="/raise/capital/pipeline" element={guard(['admin', 'founder'], founderWorkspace('raise', founderEditor(<CapitalWorkspacePage />)))} />
       <Route path="/raise/legal" element={guard(['admin', 'founder'], <FounderRaiseLegal />)} />
      <Route path="/raise/legal-engine" element={guard(['admin', 'founder', 'partner'], founderWorkspace('raise', founderEditor(<LegalEnginePage />)))} />
      <Route path="/raise/legal-engine/incorporation" element={guard(['admin', 'founder', 'partner'], founderWorkspace('raise', founderEditor(<LegalEnginePage />)))} />
      <Route path="/raise/legal-engine/founders" element={guard(['admin', 'founder', 'partner'], founderWorkspace('raise', founderEditor(<LegalEnginePage />)))} />
      <Route path="/raise/legal-engine/compliance" element={guard(['admin', 'founder', 'partner'], founderWorkspace('raise', founderEditor(<LegalEnginePage />)))} />
      <Route path="/raise/legal-engine/equity" element={guard(['admin', 'founder', 'partner'], founderWorkspace('raise', founderEditor(<LegalEnginePage />)))} />
      <Route path="/legal" element={guard(['admin', 'founder'], <LegalPage />)} />
      <Route path="/incorporate" element={guard(labRoles(['admin', 'founder', 'partner', 'investor']), <IncorporatePage />)} />
      <Route path="/incorporate/success" element={guard(labRoles(['admin', 'founder', 'partner', 'investor']), <IncorporateSuccessPage />)} />
      <Route path="/incorporate/cofounder-agreement" element={guard(labRoles(['admin', 'founder', 'partner']), <CofounderAgreementPage />)} />
      <Route path="/spinout-lab/83b" element={guard(labRoles(['admin']), <SpinoutLab83bPage />)} />
      <Route path="/spinout-lab/compliance" element={guard(labRoles(['admin']), <SpinoutLabCompliancePage />)} />
      {/* 83(b) moved into the Lab (Week 4 deliverable). Old Incorporate
          path kept as a redirect so existing links and bookmarks survive. */}
      {/* D361: the tracker lives at /spinout-lab/83b for Lab members and admins
          (its guard), and inside the Studio-gated Legal Engine card for every
          other founder. Sending those founders to the Lab route only reached a
          refusal, so the old path now lands each on the one they can open. */}
      <Route path="/incorporate/83b" element={<Navigate to={user?.spinout_lab_active === 1 || user?.role === 'admin' ? '/spinout-lab/83b' : '/raise/legal-engine/equity'} replace />} />
      <Route path="/compliance" element={guard(labRoles(['admin', 'founder', 'partner']), <CompliancePage />)} />
      {/* D570 — Wellbeing, built to the Ops canvas. Home and booking keep the
          home page's guard (the Worker refuses investors on the check-in and
          expert routes).
          The expert's practice is the old expert dashboard, extended: the old
          path redirects, so notification links and the Stripe return URL land
          on it. The library is admin-only, as its two writes are. */}
      <Route path="/wellbeing" element={guard(['admin', 'founder'], <WellbeingPage />)} />
      <Route path="/wellbeing/book" element={guard(['admin', 'founder'], <WellbeingBookPage />)} />
      <Route path="/wellbeing/practice" element={guard(['admin', 'founder', 'partner', 'advisor'], <ExpertEditorPage />)} />
      <Route path="/wellbeing/expert-dashboard" element={<Navigate to="/wellbeing/practice" replace />} />
      <Route path="/wellbeing/expert/:uid" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <ExpertProfilePage />)} />
      <Route path="/admin/wellbeing/resources" element={guard(['admin'], <WellbeingResourceLibrary />)} />
      {/* /partners is RETIRED (task #101). It was "Partner Ecosystem": a list of
          partner accounts, a create form, and two match buttons.

          Both halves have a live home, which is what made this page outdated
          rather than merely old. Browsing the ecosystem is /directory, the
          public partner directory. Getting a partner INTO the system is
          /admin/partner-invitations, the invitation flow, or /partners/onboard for
          self-serve — both of which run the onboarding this page's four-field
          `api.createPartner` skipped entirely.

          So unlike /projects above, nothing had to move first.
          `api.matchPartners` and `api.recommendPartners` lose their only caller
          here and are left in api.js rather than deleted: they are the one
          capability with no successor, and removing them would decide that
          question silently.

          This redirect keeps the route ahead of /partners/:slug, which the
          comment on the public directory block relies on for path ranking, and
          /partners/onboard and /partners/portal are untouched. */}
      <Route path="/partners" element={<Navigate to="/directory" replace />} />
      {/*
        /tickets -> /help. The redirects are PERMANENT, not a migration shim:
        the worker emits `/tickets` into notification payloads
        (routes/tickets.ts, routes/github.ts) and those rows are already in
        people's inboxes and activity feeds. `/tickets/:id` is included
        because tickets.ts has always emitted `path: /tickets/<id>` for its
        "Open ticket" CTA while App.jsx declared no such route — that link
        has been landing on the catch-all 404. It resolves now.
      */}
      {/*
        Task #103 — `/help` is the Help Center now, and the ticket flow sits
        under it at `/help/tickets`. Until this change `/help` was the ticket
        tracker wearing an `<h1>Help Center</h1>`, and the documentation the
        Help Center canvas describes lived at `/docs` under a different name.
        Every legacy address still resolves, to the ticket or to the article:
        `/tickets`, `/tickets/<id>`, `/help/<id>`, `/docs`, `/docs/admin/*`.
      */}
      <Route path="/help" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <HelpCenterPage />)} />
      {/* Every role, `exploring` included: an application decision is a
          notification, and the person waiting on one holds no other role. */}
      <Route path="/inbox" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <InboxPage />)} />
      {/* #2314: member Product testing is retired; old notification links open Studio. */}
      <Route path="/product-testing" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <Navigate to="/studio" replace />)} />
      {/* D336 — `/notifications` has never been this page's address (D144
          put the panel at `/inbox`), but the bell's own settings link reads
          `/account/notifications` and the Settings tab is `#notifications`;
          either one typed as a bare path, or an old bookmark from before
          `/inbox` existed, should still land somewhere real rather than the
          404 page. */}
      <Route path="/notifications" element={<Navigate to="/inbox" replace />} />
      <Route path="/notifications/*" element={<Navigate to="/inbox" replace />} />
      <Route path="/help/tickets" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <TicketsPage />)} />
      <Route path="/help/tickets/:id" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <TicketsPage />)} />
      {/* D599 — every guide has its own page (the canvas's H2). Static
          children (`/help/tickets/:id`, `/help/admin/*`) outrank this by React
          Router's own ranking; the page reads the role-filtered manifest, so a
          guide the viewer may not read answers "not found". */}
      <Route path="/help/:area/:guide" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <HelpCenterPage />)} />
      <Route path="/help/admin/*" element={<AdminDocsPathGuard />} />
      <Route path="/help/:id" element={<HelpTicketIdRedirect />} />
      <Route path="/tickets" element={<Navigate to="/help/tickets" replace />} />
      <Route path="/tickets/:id" element={<TicketsRedirect />} />
      {/* `ErrorState` has always built `/support?topic=<x>`; nothing declared
          the route. It lands in the Help Center with the topic as the query. */}
      <Route path="/support" element={<SupportRedirect />} />
      {/* Products — catalog + checkout + explorer promo redemption. Open to
          every signed-in role incl. 'exploring' (that's where the Personal
          Advisor's one-time 30-day-license codes get redeemed). D755 §13
          (#1915): visitors see it too — the plans and the Token packs, with
          Sign in to buy; the page leaves out what only a member has. A member
          still reads it through `guard`, so inside the app's header, sidebar
          and footer; a visitor reads it in the public site's frame
          (ProductsPage draws `SitePage` for them). */}
      {/* D786 (#2211): the catalogue, add-ons, licences and cart moved to
          /pricing/products, unchanged; /plans-and-pricing redirects to /pricing. */}
      <Route path="/pricing/products" element={user ? guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <ProductsPage />) : <ProductsPage />} />
      {/* Product slide-over deep link — same page, pre-opens the detail panel. */}
      <Route path="/pricing/products/:productId" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <ProductsPage />)} />
      <Route path="/plans-and-pricing" element={<PlansAndPricingRedirect />} />
      <Route path="/plans-and-pricing/:productId" element={<ParamRedirect to="/pricing/products/:productId" />} />
      {/* Legacy /products redirects — keep for any saved links or external references. */}
      <Route path="/products" element={<ProductsRedirect />} />
      <Route path="/products/:productId" element={<ParamRedirect to="/pricing/products/:productId" />} />
      {/* One-time cart checkout + post-checkout confirmation (auth-protected). */}
      <Route path="/checkout" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <CheckoutPage />)} />
      <Route path="/checkout/confirmation" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <CheckoutConfirmationPage />)} />
      {/* THE BUCKET ROOT GOES TO THE BUCKET ROUTER, which is what its four zone
          routes below already do. It used to go to `InvestorWorkspacePage`,
          whose `ownsDealsRoute` branch renders `InvestorDealsWorkspace` — the
          page ID1–ID4 emptied, one panel at a time, until its own comment read
          "All four decision panels are gone". So `/deals` drew a heading, a
          pill row and nothing. `InvestorDealsRoutes` answers the root with the
          bucket board, the same overview every partner and advisor root has.

          The non-investor arm is untouched: `investorWorkspace` returned the
          bare component for any other effective role, and a partner reading
          /deals still gets `DealsPage` exactly as before. */}
      <Route path="/deals" element={guard(['admin', 'partner', 'investor'],
        effectiveRole === 'investor' ? <InvestorDealsRoutes /> : <DealsPage />)} />

      {/* ── Deals · the four stages, as four routes ──────────────────────────
          The zone slugs are InvestorDealsWorkspace's own anchor ids with the
          prefix stripped — the canvas took them from there. Four deep-linkable
          URLs replacing five that never said which stage you were on; the
          workspace still renders all four sections and the route scrolls to
          one. Splitting it into four pages is a content decision, not a
          routing one. */}
      <Route path="/deals/pipeline" element={guard(['admin', 'investor'], <InvestorDealsRoutes />)} />
      <Route path="/deals/screening" element={guard(['admin', 'investor'], <InvestorDealsRoutes />)} />
      <Route path="/deals/commit" element={guard(['admin', 'investor'], <InvestorDealsRoutes />)} />
      <Route path="/deals/closing" element={guard(['admin', 'investor'], <InvestorDealsRoutes />)} />
      <Route path="/deals/:dealId" element={guard(['admin', 'partner', 'investor', 'founder'], investorWorkspace('deals', <DealRoomPage />))} />
      {/* D670 — the Market intelligence page is retired, with its sector
          digest email. Research reads the same market data, so an old link
          (and a link in a digest already sent) lands there. */}
      <Route path="/market-intel" element={<Navigate to="/research" replace />} />
      {/* #2341 — the owner removed /advisory. Its address forwards to Team ›
          Advisors, the directory /advisors already sends a founder to. */}
      <Route path="/advisory" element={guard(['admin', 'founder'], <Navigate to="/build/team?mode=workspace&tab=advisors" replace />)} />
      {/* Team (Grow › Talent). Founders reach the advisor directory,
          Co-founder Match and their roles through the Team workspace at
          /build/team; the legacy standalone routes stay live for every other
          role but redirect a founder into the tab that owns that job (D435).
          A bare /build/team was the Grow desk for a founder until D661
          (#1474) retired the desks: Grow's landing is the cycle overview at
          /grow, so /build/team is the Team workspace for everyone, and the
          redirects' `mode=workspace` is kept only so old links stay stable. */}
      <Route path="/build/team" element={guard(['admin', 'founder'], founderWorkspace('grow', founderEditor(<FounderTeamPage />)))} />
      {/* D654 — a sent "Share an update": the author's replies and opens, or what a recipient's audience may read. */}
      <Route path="/round-calls" element={guard(['founder', 'investor', 'exploring'], <RoundCallIndex />)} />
      <Route path="/round-calls/:uid" element={guard(['admin', 'founder', 'investor', 'exploring'], <RoundCallPage />)} />
      {/* D668 (#1498): approve an AI assistant for the companies ticked. Outside
          the shell's guard on purpose: the assistant's OAuth flow lands here,
          and a signed-out visitor goes to sign-in and back to this request. */}
      <Route path="/connect/assistant" element={user ? <ConnectAssistantPage /> : <Navigate to={assistantSignInPath(location)} replace />} />
      <Route path="/updates/:uid" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <SentUpdatePage />)} />
      {/* D661 (#1474): a founder's /grow is the cycle overview from #1488's
          read, and /grow/<module> its module pages. The seven Grow pages
          below are static and win over /grow/:slug; no module slug is one of
          them. */}
      <Route path="/grow" element={founderGrowLanding
        ? guard(['admin', 'founder'], <CycleRoute cycle="grow" />)
        : <Navigate to="/grow/focus" replace />} />
      {/* D686 §5.1: Share an update, the Grow page with its lightbox open; /grow/updates is the history's address. */}
      <Route path="/grow/update" element={guard(['admin', 'founder'], <CycleRoute cycle="grow" lightbox />)} />
      <Route path="/grow/updates" element={guard(['admin', 'founder'], <HistoryRedirect to="/grow/durable-company-building" hash="#updates" />)} />
      <Route path="/grow/:slug" element={guard(['admin', 'founder'], <CycleRoute cycle="grow" />)} />
      <Route path="/grow/:slug/:id" element={guard(['admin', 'founder'], <CycleRoute cycle="grow" record />)} />
      <Route path="/grow/:slug/new" element={guard(['admin', 'founder'], <CycleRoute cycle="grow" adding />)} />
      <Route path="/grow/focus" element={guard(['admin', 'founder'], <FounderGrowFocus />)} />
      <Route path="/grow/talent" element={guard(['admin', 'founder'], <FounderGrowTalent />)} />
      <Route path="/grow/customers" element={guard(['admin', 'founder'], <FounderGrowCustomers />)} />
      <Route path="/grow/partnerships" element={guard(['admin', 'founder'], <FounderGrowPartnerships />)} />
      <Route path="/raise/capital-match" element={guard(['admin', 'founder'], <FounderGrowCapitalMatch user={user} />)} />
      <Route path="/grow/capital-match" element={guard(['admin', 'founder'], <Navigate replace to={{ pathname: '/raise/capital-match', search: location.search, hash: location.hash }} />)} />
      {/* #2343: one brand page. Grow's read of pages and leads moved into the
          builder (`BrandPagesSection`); the old address forwards there. */}
      <Route path="/grow/brand" element={<Navigate replace to={{ pathname: '/build/brand', search: location.search, hash: location.hash }} />} />
      <Route path="/grow/launch" element={guard(['admin', 'founder'], <FounderGrowLaunch />)} />
      <Route path="/build/command-center" element={guard(labRoles(['admin', 'founder']), <Navigate to="/studio" replace />)} />
      {/* Task #74 — back-compat redirect from the pre-rename /mentors path. */}
      <Route path="/mentors" element={<Navigate to="/advisors" replace />} />
      <Route path="/advisors" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), user?.role === 'founder' ? <Navigate to="/build/team?mode=workspace&tab=advisor" replace /> : <AdvisorsPage />)} />
      {/* D571 — one advisor's profile as a client sees it (the Ops canvas's
          A5). Same roles as the directory, because `GET /api/advisors/:uid`
          answers any signed-in caller. A founder is NOT sent to the team tab
          here: the founder is the client this page is drawn for. */}
      <Route path="/advisors/:uid" element={<AdvisorProfilePage />} />
      <Route path="/b/*" element={<PublicAdvisorBookingPage />} />
      {/* /office-hours is RETIRED (task #124's freeze lifted; UNRESOLVED_ITEMS
          U4 resolved). It coupled the storefront to booking and was broken at
          both jobs: it read five keys the DTOs never emitted, so every slot
          showed "Invalid Date", its cancel button never rendered, and
          Confirm/Decline were gated on a status the worker has never written —
          an advisor could not accept a booking there, ever.

          Both halves now have a working home. The storefront is /expertise/*
          and booking is /practice/*, which were already immune to the same
          contract breaks. This redirect keeps every bookmark alive; it points
          at Opportunities because availability is what "office hours" meant. */}
      <Route path="/office-hours" element={<Navigate to="/practice/opportunities" replace />} />
      <Route path="/partner/office-hours" element={guard(['admin', 'partner'], partnerPrivateWorkspace(<PartnerWorkspaceTabs set="offers" user={user}><PartnerOfficeHoursPage /></PartnerWorkspaceTabs>))} />
      <Route path="/comarketing" element={guard(['admin', 'partner', 'founder', 'investor'], partnerPrivateWorkspace(effectiveRole === 'founder' ? founderWorkspace('grow', founderEditor(<CoMarketingPage user={user} />)) : <PartnerWorkspaceTabs set="offers" user={user}><CoMarketingPage user={user} /></PartnerWorkspaceTabs>))} />
      {/* D637 — one pitch, edited while Proposed. Only a partner owns pitches (or an admin reads one). */}
      <Route path="/comarketing/:pitch" element={guard(['admin', 'partner'], partnerPrivateWorkspace(<PartnerWorkspaceTabs set="offers" user={user}><CoMarketingPitchPage /></PartnerWorkspaceTabs>))} />
      <Route path="/calendar" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <CalendarPage />)} />
      {/* Task #40 (E2) — Event host/attendee surface. */}
      <Route path="/my/events" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <MyEventsPage />)} />
      <Route path="/events/new" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <EventEditorPage />)} />
      <Route path="/events/:id/edit" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <EventEditorPage />)} />
      <Route path="/events/:id/manage" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <EventManagePage />)} />
      <Route path="/events/:id/manage/registrations" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <EventManagePage />)} />
      <Route path="/events/:id/manage/agenda" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <EventManagePage />)} />
      <Route path="/my/jobs" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], user?.role === 'founder' ? <Navigate to="/build/team?mode=workspace&tab=jobs" replace /> : <MyJobsPage />)} />
      <Route path="/my/applications" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <MyApplicationsPage />)} />
      <Route path="/jobs/new" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <JobEditorPage />)} />
      <Route path="/jobs/:id/edit" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <JobEditorPage />)} />
      <Route path="/jobs/:id/manage" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <JobManagePage />)} />
      {/* #2355 (#2297 §3): the /cofounder browse page is removed; Co-founder Match at
          /spinout-lab/cofounder-match is the one matcher. The old address lands there,
          and is counted with #2301's redirects. */}
      <Route path="/cofounder" element={<Navigate to="/spinout-lab/cofounder-match" replace />} />
      {/* Task #20 — Consolidated profile/advisor flow. The advisor conversation
          now builds the skill + values profile; the legacy /skills and /values
          routes redirect here (underlying data stores kept intact). */}
      <Route path="/skills" element={<Navigate to="/studio" replace />} />
      <Route path="/values" element={<Navigate to="/studio" replace />} />
      {/* The Portfolio ROOT. It had no route at all, so an investor clicking
          Portfolio landed on NotFoundPage unless the sidebar row aimed one
          level down at a zone — which is exactly how the founder overviews
          were lost. `PortfolioWorkspace` derives its tab from the pathname and
          falls through to 'health' when no segment matches, so the bare root
          yields the I4 overview for an investor and the generic tab shell for
          everyone else. `/portfolio/health` stays live as its legacy alias. */}
      <Route path="/portfolio" element={guard(['admin', 'founder', 'partner', 'investor'], investorWorkspace('portfolio', <PortfolioWorkspace activeRole={effectiveRole} />))} />
      <Route path="/portfolio/health" element={guard(['admin', 'founder', 'partner', 'investor'], investorWorkspace('portfolio', <PortfolioWorkspace activeRole={effectiveRole} />))} />
      {/* #2337 — Partner coverage analytics is removed (#2297 §7); its address
          forwards to Delivery · Health. */}
      <Route path="/portfolio/coverage" element={guard(['admin', 'partner'], <Navigate to="/delivery/health" replace />)} />
      <Route path="/activity" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <ActivityPage />)} />
      <Route path="/kyc" element={guard(['admin', 'founder', 'partner', 'investor'], <KYCPage />)} />
      {/* 'advisor' belongs here: services/trust.ts ROLE_MATRIX gives advisors four
          obligations — two of them REQUIRED (mentor_nda_v1,
          mentor_disclaimer_v1) — and the Trust Center link in the user dropdown
          carries no role gating, so every advisor could see the link, click it,
          and be bounced off the only page listing what they owe. */}
      <Route path="/trust" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], investorWorkspace('trust', <TrustCenterPage chromeless={effectiveRole === 'investor'} />))} />
      <Route path="/monitoring" element={guard(['admin'], <MonitoringPage />)} />
      <Route path="/funds" element={guard(['admin', 'investor'], effectiveRole === 'investor' ? <InvestorFundLanding fundUnlocked={hasInvestorTier(user, 'institutional')} /> : <FundOpsWorkspace />)} />
      <Route path="/funds/capital-calls" element={<FundCapitalCallsRedirect />} />
      <Route path="/lp-portal" element={<LpPortalRedirect />} />
      <Route path="/funds/lp-workspace" element={<FundLpWorkspaceRedirect />} />
      <Route path="/portfolio/waterfall" element={guard(['admin', 'investor'], <WaterfallPage />)} />
      {/* Task #18 — investor-lifecycle features ported from PR #119. */}
      <Route path="/ic" element={guard(['admin', 'partner', 'investor'], <ICDecisionsPage />)} />
      <Route path="/ic/:uid" element={guard(['admin', 'partner', 'investor'], <ICDecisionPage />)} />
      {/* D463 — the guard stays ['admin','investor']: this is a zone route of
          the portfolio shell, and the founder's shell has no such zone. The
          founder composes in Grow · Share an update (D654; the card on
          /build/metrics left with that page, #2336). */}
      <Route path="/portfolio/updates" element={guard(['admin', 'investor'], investorWorkspace('portfolio', <PortfolioWorkspace activeRole={effectiveRole} />))} />
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
          ONE of Practice's five zones still mounts the live /advisor/advisory
          workspace — Delivery, until canvas PR3 lands. Opportunities (PR1),
          Engagements (PR2), Sessions and Earnings all have their own pages over
          real stores; the clause here that said "Sessions and Earnings have no
          store and say so" was stale from migration 205 onward and is gone.
          Cohorts is entirely new and reads Spin-Out Lab data read-only — it owns
          no Lab route and writes nothing back. Expertise mounts the live
          workspace that /office-hours already serves. The legacy
          /advisor/advisory/* routes stay for Clients and Contracts, which are
          working tabs the canvas has no zone for; the three it DOES have zones
          for redirect as each artboard lands. */}
      <Route path="/practice" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      <Route path="/practice/opportunities" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      <Route path="/practice/engagements" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      <Route path="/practice/delivery" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      <Route path="/practice/sessions" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      <Route path="/practice/earnings" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      {/* D571 — the Ops canvas's four practice addresses. Each is a SECTION of
          the zone that already reads its store, so each lands there rather than
          on a second page answering the same question: deliverables are the
          Delivery zone grouped by client, session types and booking links are
          two cards on Sessions, and the access log sits under the Engagements
          board. The guard is the zones' own: every `/me/*` store answers only a
          caller with an advisor row. */}
      <Route path="/practice/deliverables" element={guard(['admin', 'advisor'], <Navigate to="/practice/delivery?view=by_client" replace />)} />
      <Route path="/practice/session-types" element={guard(['admin', 'advisor'], <Navigate to="/practice/sessions#session-types" replace />)} />
      <Route path="/practice/booking-links" element={guard(['admin', 'advisor'], <Navigate to="/practice/sessions#booking-links" replace />)} />
      <Route path="/practice/access-log" element={guard(['admin', 'advisor'], <Navigate to="/practice/engagements#access-log" replace />)} />
      {/* Admin: which advisor may read which Lab cohort's founders. Never a
          tab on the Spin-Out Lab console — that console is Lab-owned and under
          a do-not-touch instruction, and the endpoints live under
          /api/advisors/admin/ rather than /api/admin/cohort/. D953 (#2371):
          the console is now Programs › Mentor cohort access › People; this
          old address keeps its query and hash and adds ?moved=advisor-cohorts. */}
      <Route path="/admin/advisor-cohorts" element={<AdvisorCohortsRedirect />} />

      {/* Cohorts now carries the preview gate, which it deliberately did not
          before. It used to render only Lab-sourced empty cards — nothing
          personal, so nothing to scope. Founders, This week and Outcomes read
          the signed-in user's own assignments, and an admin previewing the
          Advisor ROLE has selected no person, so they would see "no batch
          assigned" — a boundary rendered as an absence, which is the exact
          defect this whole pass exists to remove. */}
      <Route path="/cohorts" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      <Route path="/cohorts/founders" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      <Route path="/cohorts/guidance" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      <Route path="/cohorts/this-week" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      <Route path="/cohorts/calendar" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      <Route path="/cohorts/outcomes" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      <Route path="/expertise" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      <Route path="/expertise/profile" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      <Route path="/expertise/services" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      <Route path="/expertise/proof" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      <Route path="/expertise/thinking" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />
      <Route path="/expertise/visibility" element={guard(['admin', 'advisor'], <AdvisorBucketRoutes preview={advisorRolePreview} />)} />

      {/* THE LEGACY WORKSPACE'S DEFAULT TAB IS NOW `clients`, because
          `opportunities` is a redirect below and a default that redirects makes
          /advisor/advisory a two-hop bounce. Clients is the first tab the canvas
          has no zone for, which is what this route now exists to serve. */}
      <Route path="/advisor/advisory" element={<Navigate to="/advisor/advisory/clients" replace />} />
      {/* THREE REDIRECTS, ONE PER ARTBOARD THAT HAS LANDED, and that is now every
          tab the canvas has a zone for. The opportunities one was owed by PR1 and
          missed — the zone shipped, the legacy inbox stayed reachable at its old
          URL, and two pages answered the same question with different
          instruments. The delivery one is owed by PR3 for the same reason and is
          not a deletion: the review loop that tab uniquely carried is a section
          of the new page, so the redirect loses no capability.

          CLIENTS AND CONTRACTS ARE THE WHOLE REMAINING WORKSPACE. Neither has an
          artboard, which is a gap in the canvas rather than permission to drop a
          working tab, so both keep their URL and stay linked from Opportunities. */}
      <Route path="/advisor/advisory/opportunities" element={<Navigate to="/practice/opportunities" replace />} />
      <Route path="/advisor/advisory/engagements" element={<Navigate to="/practice/engagements" replace />} />
      <Route path="/advisor/advisory/delivery" element={<Navigate to="/practice/delivery" replace />} />
      <Route path="/advisor/advisory/clients" element={guard(['admin', 'advisor'], advisorPrivateWorkspace(<AdvisorAdvisoryWorkspace />))} />
      <Route path="/advisor/advisory/contracts" element={guard(['admin', 'advisor'], advisorPrivateWorkspace(<AdvisorAdvisoryWorkspace />))} />
      {/* documentation/architecture/DECISIONS.md D12 — the Research row is /market-intel and nothing else.
          (D670 retired /market-intel itself; the Research row is /research.)
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

          The four withdrawn tabs are removed rather than redirected: a
          surface with no company, document or news data would swap a blank
          page for a misleading one. They return when a data source is licensed.

          D392 — the section root and the market tab land on the advisor's
          Research bucket, not /signals. /signals was the one live surface when
          these were repointed; the canvas-built bucket (/research, five live
          zones) is now the advisor's research home, and /research/markets is
          the comparable-readings zone the Advisor Research canvas's AR3 draws.
          Both guards admit 'advisor'. The sector feed keeps its own route. */}
      <Route path="/advisor/research" element={<Navigate to="/research" replace />} />
      <Route path="/advisor/research/market" element={<Navigate to="/research/markets" replace />} />

      {/* ── Partner · Pipeline, Delivery, Offers ─────────────────────────────
          Nine of these fifteen zones already have a live surface, spread over
          five prefixes that share no logic. The six that do not say what they
          would hold.

          /pipeline is a SHARED prefix and that is deliberate: the investor
          shell has held /pipeline, /pipeline/screening, /pipeline/commit and
          /pipeline/transactions for a long time. The two sets share no slug and
          bucketForPath is role-scoped, so each licence resolves to its own
          bucket. Check both lists before adding a sixth slug to either.

          The legacy /needs, /services, /perks and /partner/insights routes
          stay mounted. /partner/operations/* retired in D395: each of its
          addresses is a redirect below, to the canvas-built page that took
          its job. */}
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
      <Route path="/offers/testing" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/delivery" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      <Route path="/offers" element={guard(['admin', 'partner'], <PartnerBucketRoutes />)} />
      {/* Partner canvas P3 — the partner Pipeline root is the bucket overview,
          not the investor deal pipeline that owns this prefix for investors.
          Investor and founder keep the page they had; partner gets the shell. */}
      <Route path="/pipeline" element={guard(['admin', 'founder', 'partner', 'investor'], effectiveRole === 'partner' ? <PartnerBucketRoutes /> : investorWorkspace('deals', <PipelineWorkspace />))} />

      {/* D395 — /partner/operations/* RETIRED. Each tab's job has a
          canvas-built home, and each address lands on it. No guard here: the
          destination guards itself, so an unentitled visitor is refused there
          rather than at a URL that no longer has a page (the D118 shape).
          None of the retired pages read a query string, so none is carried.
            root, overview → /company-settings (the firm profile card, D390)
            capabilities   → /offers/catalog (the service catalogue writes)
            portfolio      → /delivery/health (founder reviews, D390)
            engagements    → /pipeline/proposals (withdraw; the lifecycle and
                              invoice ledger are on /delivery/board)
            performance    → /pipeline/analytics (the same quotesAnalytics read) */}
      <Route path="/partner/operations" element={<Navigate to="/company-settings" replace />} />
      <Route path="/partner/operations/overview" element={<Navigate to="/company-settings" replace />} />
      <Route path="/partner/operations/capabilities" element={<Navigate to="/offers/catalog" replace />} />
      <Route path="/partner/operations/portfolio" element={<Navigate to="/delivery/health" replace />} />
      <Route path="/partner/operations/engagements" element={<Navigate to="/pipeline/proposals" replace />} />
      <Route path="/partner/operations/performance" element={<Navigate to="/pipeline/analytics" replace />} />
      {/* D118/D119 — the three investor Deals sub-paths retire to `/deals/*`,
          which is now their equal: #586 ported the search and the counted
          chips they had and the zones did not. The destination guards itself,
          so these carry no guard of their own — an unentitled visitor is
          refused there rather than at a URL that no longer has a page.

          `/pipeline` (the ROOT, above) deliberately does NOT redirect. It is
          role-forked — partner gets PartnerBucketRoutes, investor and founder
          keep PipelineWorkspace — so an unconditional redirect would take the
          founder's board and the partner's bucket root with it. */}
      <Route path="/pipeline/screening" element={<Navigate to="/deals/screening" replace />} />
      <Route path="/pipeline/commit" element={<Navigate to="/deals/commit" replace />} />
      <Route path="/pipeline/transactions" element={<Navigate to="/deals/closing" replace />} />
      <Route path="/portfolio/performance" element={guard(['admin', 'investor'], investorWorkspace('portfolio', <PortfolioWorkspace activeRole={effectiveRole} />))} />
      <Route path="/portfolio/value-add" element={guard(['admin', 'investor'], investorWorkspace('portfolio', <PortfolioWorkspace activeRole={effectiveRole} />))} />
      <Route path="/funds/performance" element={guard(['admin', 'investor'], investorFundWorkspace(<FundOpsWorkspace />))} />
      <Route path="/funds/lps" element={guard(['admin', 'investor'], investorFundWorkspace(<InvestorFundLPs />))} />
      <Route path="/funds/calls" element={guard(['admin', 'investor'], investorFundWorkspace(<InvestorFundCalls />))} />
      <Route path="/funds/ledger" element={guard(['admin', 'investor'], investorFundWorkspace(<InvestorFundAccounting />))} />
      <Route path="/funds/reporting" element={guard(['admin', 'investor'], investorFundWorkspace(<InvestorFundReporting />))} />
      <Route path="/funds/:fundId" element={guard(['admin', 'investor'], <FundPage role={effectiveRole} />)} />
      <Route path="/funds/:fundId/reporting/:periodId" element={guard(['admin', 'investor'], <FundReportPeriodPage role={effectiveRole} />)} />
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
      {/* D661 (#1474): a founder's /raise is the cycle overview from #1501's
          read, and /raise/<module> its module pages. Every Raise tool route
          above is static and wins; /raise/data-room's own route draws the Data
          room module page itself when no mode is asked for (D696). */}
      <Route path="/raise" element={founderRaiseLanding
        ? guard(labRoles(['admin', 'founder']), <CycleRoute cycle="raise" />)
        : <Navigate to="/raise/capital/pipeline" replace />} />
      {/* D686 §3.1 item 14: a founder's call inside the Raise shell; investors and counsel stay on /round-calls/:uid. */}
      <Route path="/raise/calls/:uid" element={guard(labRoles(['admin', 'founder']), <RaiseCallPage />)} />
      {/* D686 §5.1: Call for Capital, the Raise page with its lightbox open; /raise/calls is the history's address. */}
      <Route path="/raise/call" element={guard(labRoles(['admin', 'founder']), <CycleRoute cycle="raise" lightbox />)} />
      <Route path="/raise/calls" element={guard(labRoles(['admin', 'founder']), <HistoryRedirect to="/raise/capital-relationships" hash="#calls" />)} />
      <Route path="/raise/:slug" element={guard(labRoles(['admin', 'founder']), <CycleRoute cycle="raise" />)} />
      <Route path="/raise/:slug/:id" element={guard(labRoles(['admin', 'founder']), <CycleRoute cycle="raise" record />)} />
      <Route path="/raise/:slug/new" element={guard(labRoles(['admin', 'founder']), <CycleRoute cycle="raise" adding />)} />
      {/* Standalone Referrals page (Refer & Earn + Payouts). Legacy /refer also redirects here. */}
      {/* Advisors were the one signed-in licence this guard omitted, and the
          omission was not a policy: `ReferralsPage` has no role branch at all,
          and every endpoint it calls (`/refer-earn/overview`, `/submissions`,
          `/submissions/:uid`, `/strategic-access`) is `requireAuth` and scoped
          to `referrer_user_id`. The referral programme's own category list even
          names advisors as referrers. Network · Relationships reads these rows,
          so leaving the page unreachable made that section permanently empty
          with no way to fill it. */}
      {/* NOT wrapped in `partnerPrivateWorkspace`. That wrapper bounces an admin
          previewing Partner to /studio, and it was doing so over a page the comment
          above correctly describes as having no role branch at all: every endpoint
          is `requireAuth` scoped to `referrer_user_id`, so the rows an admin sees
          are their own, exactly as in the plain Admin view where the wrapper never
          fired. There is no partner-private boundary here to state, so there is
          nothing for a notice to say either — the wrapper was not this route's to
          carry.

          /refer and /payouts are ALIASES of this route: they exist only to arrive
          here, so all three carry the same role list. Both omitted advisor while
          this one admitted it, so an advisor following a /refer link bounced off a
          page /referrals would have shown them. */}
      <Route path="/referrals" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <ReferralsPage />)} />
      <Route path="/refer" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <ReferRedirect />)} />
      <Route path="/company-settings" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <Suspense fallback={null}><CompanySettingsPage /></Suspense>)} />
      {/* D651 — Integrations are Connectors now; both old addresses redirect
          to /account/connectors, keeping ?query= so OAuth returns still land.
          Available to every authenticated profile, as the Account center is. */}
      <Route path="/integrations" element={authOnly(<IntegrationsRedirect />)} />
      <Route path="/account/integrations" element={authOnly(<IntegrationsRedirect />)} />
      <Route path="/payouts" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <Navigate to="/referrals" replace />)} />
      {/* #2324 (#2297 §3): Network Effects is removed; its parts belong to Network, Deals and the
          marketplace. The old address lands on Network, and is counted with #2301's redirects. */}
      <Route path="/network-effects" element={<Navigate to="/network" replace />} />
      {/* /pipeline lives with the Partner bucket routes above — the partner
          canvas claims the prefix root as its Pipeline overview, and the
          investor deal pipeline keeps the zone slugs below it. */}
      {/* Task #1 — unified Network page (Contacts + Introductions +
          Relationships tabs). The legacy /relationships route redirects into
          the Relationships tab. Advisors are included so the Introductions
          feature (and its notification deep links) work for every user type. */}
      {/* The advisor arm renders the zone shell rather than the bare page: the
          Network row points here, and NetworkPage on its own carries no zone
          row, no breadcrumb and no Worker AI rail — the advisor's Network was
          a violet founder-shaped page with an empty right column. The shell
          resolves the zone to `relationships` on a bare prefix, so the row
          lands on the bucket and the pills navigate from there. */}
      <Route path="/network" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], effectiveRole === 'partner' ? <NetworkWorkspace role="partner" /> : partnerPrivateWorkspace(effectiveRole === 'investor' ? <InvestorNetworkWorkspace /> : effectiveRole === 'advisor' ? <NetworkWorkspace role="advisor" /> : founderNetworkLanding ? <FounderNetworkDesk /> : founderWorkspace('network', <NetworkPage />, { hideHeader: true })))} />
      {/* ── Network · three zones, every licence ─────────────────────────────
          These were guarded ['admin','founder'] because they were built for
          the founder shell and nothing else linked them. All four canvases
          specify this bucket, so the shell config renders a pill for each zone
          in every shell — and three of the four licences were being bounced to
          their default path when they clicked one. Widened and role-branched:
          founders keep their three dedicated pages, investors get
          InvestorNetworkWorkspace, advisors get their own three zones under
          pages/advisor/network/, and operators get NetworkPage — whose tab now
          follows the path, so none of them lands on a zone it did not name. */}
      <Route path="/network/relationships" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <NetworkWorkspace role={networkRole} />)} />
      <Route path="/network/introductions" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <NetworkWorkspace role={networkRole} />)} />
      <Route path="/network/organizations" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <NetworkWorkspace role={networkRole} />)} />
      <Route path="/relationships" element={<Navigate to="/network?tab=relationships" replace />} />
      {/* #2354 (#2297 §3): the Legal & Capital Engine is removed, one of four legal
          surfaces. The old address lands on Raise › Legal, and is counted with
          #2301's redirects. */}
      <Route path="/legal-capital" element={<Navigate to="/raise/legal" replace />} />
      {/* #2342 — the partner deal portal and its older alias forward to Refer & earn. */}
      <Route path="/partner-portal" element={guard(['admin', 'partner', 'investor'], <PartnerPortalRedirect />)} />
      <Route path="/partners/portal" element={guard(['admin', 'partner'], <PartnerPortalRedirect />)} />
      {/* Task #2 (DD) — Direct-URL guard for admin docs. Non-admins
          (or anonymous visitors) hitting /docs/admin/* see a Not Found
          screen so the page literally pretends not to exist; admins are
          redirected into the hash-anchored docs surface. */}
      <Route path="/docs/admin/*" element={<AdminDocsPathGuard />} />
      <Route path="/docs" element={<DocsRedirect />} />
      {/* Task #17 mounted SettingsPage a second time at /profile so an investor
          "Profile" nav row could highlight independently of Settings. That row
          is gone; the exploring sidebar's "My Profile" now points at /account
          itself. D433 retires the duplicate on D304's shape: a redirect, never
          a 404, with the query and hash carried through. D702 (#1664) narrows
          that: a founder gets You here, and every other role keeps the
          redirect. The three pages under it are a founder's alone. */}
      <Route path="/profile" element={effectiveRole === 'founder' ? guard(['founder'], <YouPage />) : <SettingsRedirect />} />
      <Route path="/profile/venture" element={guard(['founder'], <VenturePage />)} />
      <Route path="/profile/preview" element={guard(['founder'], <ProfilePreviewPage />)} />
      <Route path="/profile/visibility" element={guard(['founder'], <VisibilityPage />)} />
      <Route path="/account" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <SettingsPage />)} />
      <Route path="/settings" element={<SettingsRedirect />} />

      {/* Task #53 — Public partner directory + profiles (no auth). The
          static /partners route below takes precedence over /partners/:slug
          per React Router v6 path ranking, so authenticated users still
          land on the internal CRM at /partners. */}
      <Route path="/directory" element={<PublicDirectoryPage />} />
      {/* D679 — the Network section's hub. /network stays the signed-in workspace. */}
      <Route path="/resources" element={<ResourcesPage />} />
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
      {/* The attester's side of an advisor's proof claim (migration 204). No
          auth: the token is the credential, and an attester is usually not a
          user of this product. `isPublicPath` lists /attest/ for the same
          reason /esign/ is there — a background settings 401 must not bounce
          someone who came to answer a question. */}
      <Route path="/attest/:token" element={<AttestConsentPage />} />
      {/* The client's side of a PARTNER firm's proof claim (migration 209). A
          separate page against a separate table — 209 uses `consenter_*` where
          204 uses `attester_*` — and two path segments rather than one, so
          neither route can shadow the other. `isPublicPath` whitelists the
          whole `/attest/` prefix, so this needs no entry of its own. Landed
          WITH the firm-side ask: a token nobody can answer is not a consent
          mechanism, it is a column that never gets set. */}
      <Route path="/attest/partner/:token" element={<PartnerAttestConsentPage />} />

      {/* D120 — the branch landing for an HQ support session.

          `/support/session`, NOT `/support`, AND THE DIFFERENCE IS THE WHOLE
          ROUTE. `/support` is already taken: `SupportRedirect` at :2287 sends
          it to /help, preserving `?topic=`. Registering a second `/support`
          here would have been dead code — React Router takes the first match,
          so the hand-off link would have redirected to the help centre and
          dropped its code, on every branch, with CI green. Caught by
          support_handoff_page.test.mjs before it shipped. The help shortcut is
          untouched.

          OUTSIDE RequireAuth by necessity, not by preference: the HQ operator
          arriving here holds no session on this host and cannot, since HQ's JWT
          is signed with a different secret (D.4). Wrapping it would redirect
          them to /login to sign in as a branch account they do not have. The
          page itself grants nothing — the one-time code does, and only through
          POST /api/auth/support/redeem on the branch. `isPublicPath` lists the
          same path for the same reason. */}
      <Route path="/support/session" element={<SupportRedeemPage />} />
      {/* D441 — a move onto this branch. The invitee has no account here
          yet, so the route is not behind the sign-in gate. /invite/:token
          stays the events RSVP page. */}
      <Route path="/join/:token" element={<JoinBranchPage />} />

      <Route path="/terms" element={<TermsPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/newsletter" element={<NewsletterPage />} />
      <Route path="/newsletter/confirm" element={<NewsletterConfirmPage />} />
      <Route path="/newsletter/preferences" element={<NewsletterPreferencesPage />} />
      {/* D677 — /about is the Firm page; the team page moved to /team. */}
      <Route path="/about" element={<FirmPage />} />
      <Route path="/team" element={<TeamPage />} />
      <Route path="/platform" element={<PlatformPage />} />
      <Route path="/administrators" element={<AdministratorsPage />} />
      {/* D678 — the Methodology and Eadwyn Intelligence pages. */}
      <Route path="/methodology" element={<MethodologyPage />} />
      <Route path="/intelligence" element={<IntelligencePage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/privacy/interviews" element={<InterviewNoticePage />} />
      <Route path="/risk-disclosures" element={<RiskDisclosuresPage />} />
      {/* D786 part 2 (#2211) — /pricing for everyone: a visitor reads it in the
          public site's frame, a member inside the app's top bar and left
          sidebar, with their own plan marked, as /plans-and-pricing was. */}
      <Route path="/pricing" element={user ? guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <PricingPage user={user} />) : <PricingPage />} />
      {/* Task #4 (ID) — Public marketing surfaces. No auth. */}
      <Route path="/demo" element={<DemoPage />} />
      <Route path="/status" element={<StatusPage />} />
      <Route path="/changelog" element={<ChangelogPage />} />
      {/* Public credential verification — unauthenticated by design. */}
      <Route path="/verify/:token" element={<PublicCertificateVerifyPage />} />
      <Route path="/academy/:slug" element={guard(['admin', 'founder', 'partner', 'investor'], <AcademyLessonPage />)} />
      <Route path="/academy" element={guard(['admin', 'founder', 'partner', 'investor'], <AcademyLessonPage />)} />
      {/* #2321 — the retired audience pages forward to their door pages.
          Keep external links working and count the redirects in #2301. */}
      <Route path="/lp/founder" element={<Navigate to="/for-founders" replace />} />
      <Route path="/lp/customer-discovery" element={<Navigate to="/for-founders" replace />} />
      <Route path="/lp/investor" element={<Navigate to="/for-investors" replace />} />
      <Route path="/lp/partner" element={<Navigate to="/for-service-partners" replace />} />
      <Route path="/lp/spinout-demo-day" element={<SpinoutDemoDayPage />} />
      {/* ── Route modules (D528) ── one line per frontend/src/routes/<area>.jsx,
          alphabetical, each `{<area>Routes(routeTools)}`; the imports sit in
          the block of the same name at the top of this file. Above the
          catch-all, so a module's routes are matched before it. */}
      {learningRoutes(routeTools)}
      {/* ── end route modules ── */}
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

// Task #2 (DD) — Direct-URL guard for admin docs paths, mounted at both
// `/docs/admin/*` and `/help/admin/*`. Non-admins (and anonymous visitors)
// get a Not Found screen with no hint that admin docs exist. Admins are
// redirected to the hash-anchored surface (`/help#admin/<sub>`), preserving
// the trailing path as the anchor's subsection id when present.
function AdminDocsPathGuard() {
  const { user, role, loading } = useAuth() || {};
  const location = useLocation();
  if (loading) return null;
  const isAdmin = !!user && role === 'admin';
  if (isAdmin) {
    // D599 — an admin guide has its own page now, at this very address. So
    // `/help/admin/<sub>` renders it, and the legacy `/docs/admin/<sub>` comes
    // here first; redirecting to `/help#admin/<sub>` as before would send the
    // Help Center's hash handler straight back, round and round.
    const raw = location.pathname.replace(/^\/(?:docs|help)\/admin\/?/, '').split('/')[0];
    const sub = /^[a-z0-9-]+$/.test(raw) ? raw : 'overview';
    const target = `/help/admin/${sub}`;
    if (location.pathname !== target) return <Navigate to={target} replace />;
    return <HelpCenterPage />;
  }
  return (
    <div className="max-w-xl mx-auto py-24 px-6 text-center">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Page not found</h1>
      <p className="text-sm text-gray-600">
        The page you’re looking for doesn’t exist. Head back to the{' '}
        <a className="text-violet-700 hover:underline" href="/help">Help Center</a>.
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
      // This is the crash class lib/log.js's own header says it was built for
      // — "a production-only failure left no trace anywhere" — and it was the
      // one boundary that never reported. The other three (TopLevelErrorBoundary,
      // RouteErrorBoundary, SafeMount) have always paired the two calls: the
      // beacon carries a redacted entry, and the console line adds
      // `info.componentStack`, which toEntry has no field for.
      reportError('AppErrorBoundary:top-level-crash', error);
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
        <LensProvider><AppInner /></LensProvider>
        </AppErrorBoundary>
        {/* Task #28 — global "always-on" mounts live OUTSIDE <Routes>,
            so a render-time throw inside any of them blanks the entire
            app (every route, including /login). Wrap each in a
            SafeMount error boundary so a regression in one widget
            degrades to "that one widget is missing" instead of "the
            whole app is gone". */}
        <SafeMount name="SpinoutLabListener"><GlobalSpinoutLabListenerMount /></SafeMount>
        <SafeMount name="GlobalPaywallMount"><GlobalPaywallMount /></SafeMount>
        {/* D136 — mounted here for the same reason the paywall is: the
            compliance freeze refuses writes on every admin surface, so the
            thing that explains the refusal cannot live on one page. It renders
            nothing until a 423 arrives. */}
        <SafeMount name="AdminFrozenBar"><AdminFrozenBar /></SafeMount>
        {/* D142 — the branch twin, mounted for the same reason: the suspension
            refuses writes across the whole branch shell, so the thing that
            explains the refusal cannot live on one page. Renders nothing until
            a 423 carrying `code: 'branch_suspended'` arrives. */}
        <SafeMount name="BranchSuspendedBar"><BranchSuspendedBar /></SafeMount>
        <SafeMount name="CookieConsent"><CookieConsent /></SafeMount>
      </SettingsProvider>
    </AuthProvider>
  );
}
