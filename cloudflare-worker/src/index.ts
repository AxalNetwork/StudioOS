/**
 * Cloudflare Worker — StudioOS production API.
 *
 * ARCHITECTURE (live as of 2026-04-28):
 * The worker IS the production API at axal.vc. It owns:
 *   1. All `/api/*` route handlers (mounted from `./routes/*.ts`).
 *   2. WebSocket fan-out via Durable Objects (`PipelineRoom`, `OnboardingChat`).
 *   3. Cron + Queues consumer that drains the background-job queue.
 *
 * The Python FastAPI in `backend/` is the local dev backend used during Replit
 * iteration. It is NOT deployed to production — D1 (Cloudflare-only) is the
 * canonical user store, so the worker has to handle requests itself.
 *
 * Earlier "audit #4" attempted to make FastAPI canonical and turn this worker
 * into a proxy via FASTAPI_ORIGIN, but the FastAPI side was never publicly
 * deployed and the 23 production user accounts already live in D1. We keep
 * the legacy in-worker routes mounted here as the source of truth.
 */

import { LEGACY_BUILDER_PATHS, builderRedirectTarget } from './services/builderRedirect';
import { isMcpPath, routeMcp } from './mcp/oauth';
import { assistantGrants, mcpConsent } from './routes/mcp_consent';
import { developerKeys } from './routes/developer_keys';
import { connectorApi } from './routes/connector_api';
import { adminConnectorClients } from './routes/admin_connector_clients';
import { developerLimits } from './routes/developer_limits';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, JobMessage } from './types';

import realtime from './routes/realtime';
import auth from './routes/auth';
import authSms from './routes/auth_sms';
import authRecover from './routes/auth_recover';
// Task #51 — Optional "Continue with Google" sign-in. Sits alongside
// /api/auth (magic link + TOTP); never the only path in. See
// routes/auth_google.ts for the linking precedence and step-up rules.
import authGoogle from './routes/auth_google';
import { PRIVATE_LINK_GLOBS, SOCIAL_CARD_GLOBS, serveSocialCard } from './services/socialCards';
import authPasskey from './routes/auth_passkey';
import { recoveryCoolOff } from './middleware/recoveryCoolOff';
import scoring from './routes/scoring';
import labReportShares from './routes/lab_report_shares';
import projects from './routes/projects';
import accountCompanies from './routes/account_companies';
import accountPortfolio from './routes/account_portfolio';
import slugCheck from './routes/slug_check';
import legal from './routes/legal';
import legalcap from './routes/legalcap';
import partners from './routes/partners';
import adminPartners from './routes/admin_partners';
import adminPartnersReads from './routes/admin_partners_reads';
import adminPartnerFirms from './routes/admin_partner_firms';
import adminPartnerDealReads from './routes/admin_partner_deal_reads';
import adminNetworkReads from './routes/admin_network_reads';
import adminFeatureFlags from './routes/admin_feature_flags';
import adminPublications from './routes/admin_publications';
// Task #10 (LD) — Admin team roster + public team endpoint.
import adminTeam from './routes/admin_team';
import adminNetworkProfiles from './routes/admin_network_profiles';
import adminNetwork from './routes/admin_network';
import adminInvestorCohorts from './routes/admin_investor_cohorts';
import investorCohorts from './routes/investor_cohorts';
import profileHistoryRoutes from './routes/profile_history';
import founderProfileRoutes from './routes/founder_profile';
import adminProfilingRoutes from './routes/admin_profiling';
import adminPartnerProfilesRoutes from './routes/admin_partner_profiles';
import helpCenterRoutes, { adminHelpCenter } from './routes/help_center';
import networkPublic from './routes/network_public';
// Task #3 — Admin Telegram channels + aggregator + post send.
import adminTelegram from './routes/admin_telegram';
import telegramJoin from './routes/telegram_join';
import adminX from './routes/admin_x';
import adminSlack from './routes/admin_slack';
// Task #2 — News with author proposals + admin queue.
import newsRoutes from './routes/news';
import articlesRoutes from './routes/articles';
import articleAssist from './routes/article_assist';
import adminArticles from './routes/admin_articles';
import teamPublic from './routes/team_public';
import contactRoutes from './routes/contact';
import newsletterRoutes from './routes/newsletter';
import mailLinkRoutes from './routes/mail_link';
import testingMailRoutes from './routes/testing_mail';
import partnerOnboarding from './routes/partner_onboarding';
import partnerPortal from './routes/partner_portal';
// Task #10 (AC-1) — Personal advisor backend + write-router.
import advisorRoutes from './routes/advisor';
import partnernet from './routes/partnernet';
import capital from './routes/capital';
import tickets from './routes/tickets';
import deals from './routes/deals';
import dealFlow from './routes/deal_flow';
import relationships from './routes/relationships';
import mailAccounts from './routes/mail_accounts';
import mailDrafts from './routes/mail_drafts';
import mailShares from './routes/mail_shares';
import mailPeople from './routes/mail_people';
import { bindMailTools } from './services/mail/mcpTools';
import dealContext from './routes/deal_context';
import deckGrants from './routes/deck_grants';
import dealInsights from './routes/deal_insights';
import dealWorkroom from './routes/deal_workroom';
import dealViews from './routes/deal_views';
import users from './routes/users';
import marketIntel from './routes/market_intel';
import marketIntelPublic from './routes/market_intel_public';
import { investorProfile } from './routes/investor_signals';
import assistantRoutes, { sweepExpiredConversations } from './routes/assistant';
import aiRoutes from './routes/ai';
import aiBudgetRoutes from './routes/ai_budget';
import railRunRoutes from './routes/rail_run';
import { developerUsage } from './routes/developer_usage';
// D1316 (#3474): Builder › MCP and services' overview.
import { developerAssistants } from './routes/developer_assistants';
// D791 (#2216): HQ › AI usage, Super Admin with step-up.
import adminAiUsageRoutes from './routes/admin_ai_usage';
import aiRailProposalsRoutes from './routes/ai_rail_proposals';
import { runTotpRemediation } from './services/totpRemediation';
import { writeDailySnapshot } from './services/analyticsReports';
// Task #5 (IE) — Backup + DR. Daily KV snapshot to R2.
import { runDailyKvSnapshot, writeBackupHeartbeat } from './services/backup';
import advisory from './routes/advisory';
import activity from './routes/activity';
import admin from './routes/admin';
import adminAccounts from './routes/admin_accounts';
import adminBilling from './routes/admin_billing';
import adminPromos from './routes/admin_promos';
import ventureScoreModels from './routes/venture_score_models';
import adminContracts from './routes/admin_contracts';
import adminContractDocRegistry from './routes/admin_contract_doc_registry';
// Task #9 — Hardcoded IRS-style forms (SS-4, 8821, Faxed-EIN, Confirmation).
import adminForms from './routes/admin_forms';
import adminIntegrationKeys from './routes/admin_integration_keys';
import adminMercury from './routes/admin_mercury';
// D966 (#2630): the owner's repair of Mercury SAFEs accepted before #2629.
import adminMercurySafeBasis from './routes/admin_mercury_safe_basis';
import adminGithub from './routes/admin_github';
import githubWebhook from './routes/github';
import vercelWebhook from './routes/vercel_webhook';
// Task #4 (AW) — Admin reader for advisor_turn_audit (L6) + lock/shadow controls (L7).
import adminAdvisorAudit from './routes/admin_advisor_audit';
import adminCohort from './routes/admin_cohort';
import adminIncorporations from './routes/admin_incorporations';
import safeIssuances from './routes/safe_issuances';
import admin83bReview from './routes/admin_83b_review';
import companyEin from './routes/company_ein';
import privateData from './routes/private-data';
import monitoring from './routes/monitoring';
import infra from './routes/infra';
import funds from './routes/funds';
import fundLedger from './routes/fund_ledger';
import fundFees from './routes/fund_fees';
import fundAdmin from './routes/fund_admin';
import closings, { adminClosings } from './routes/closings';
import companyReceivingAccounts from './routes/company_receiving_accounts';
import reporting from './routes/reporting';
import reportingReports from './routes/reporting_reports';
import fundReporting from './routes/fund_reporting';
import fundBooklets from './routes/fund_booklets';
import fundNotices from './routes/fund_notices';
import fundPerformance from './routes/fund_performance';
import liquidity from './routes/liquidity';
import email from './routes/email';
import pipeline from './routes/pipeline';
import search, { ensureAcademySchema } from './routes/search';
import kyc from './routes/kyc';
import kybAdmin from './routes/kyb_admin';
import kycGovernance from './routes/kyc_governance';
import esign from './routes/esign';
import trust from './routes/trust';
import { expireDueArtifacts as expireTrustArtifacts, resyncKycKyb, renewalSweep } from './services/trust';
import integrations from './routes/integrations';
import { REGISTRY, getProviderImpl, readinessOf } from './integrations/registry';
import eadwynRoutes from './routes/eadwyn';
// Task #2 — HubSpot provider. Side-effect import: the module's top-level
// `registerProvider({ key: 'hubspot', ... })` runs at boot so the route
// layer in routes/integrations.ts can dispatch to it.
import { syncAllHubspotIntegrations } from './integrations/providers/hubspot';
// Task #3 — Calendly provider. Side-effect import so registerProvider() runs at boot.
import { syncAllCalendlyIntegrations } from './integrations/providers/calendly';
// Task #4 — Salesforce provider. Side-effect import so registerProvider() runs at boot.
import { syncAllSalesforceIntegrations } from './integrations/providers/salesforce';
// Task #5 — Carta provider. Side-effect import so registerProvider() runs at boot.
import { syncAllCartaIntegrations } from './integrations/providers/carta';
// Task #2 — DocuSign provider. Side-effect import so registerProvider() runs at boot.
import { syncAllDocusignIntegrations } from './integrations/providers/docusign';
// Task #1 (2026-05-10) — Slack provider (one-way notifications).
// Side-effect import so registerProvider() runs at boot. No cron/sync —
// Slack is send-only, driven by services/notify.ts.
import './integrations/providers/slack';
// Crunchbase provider — named import (not bare side-effect) so CodeQL's
// unused-import check sees a real reference. The module's top-level
// `registerProvider(impl)` still runs as soon as it's loaded.
import { crunchbaseFetch as _registerCrunchbase } from './integrations/providers/crunchbase';
void _registerCrunchbase;
// Task #6 (DG) — Stripe provider. Side-effect import so registerProvider() runs at boot.
import './integrations/providers/stripe';
// D655 (#1467) — GitHub: read-only issues, pull requests and releases from chosen repositories.
import './integrations/providers/github';
// D1096: the read-only Vercel Integration.
import './integrations/providers/vercel';
// D713 (#1778) — a founder's or partner's own Mercury, read-only: `connect` only.
import './integrations/providers/mercury';
// D1085 (#2950) — a founder's own Notion, read-only, through Notion's MCP server: sign-in only.
import './integrations/providers/notion';
import './integrations/providers/posthog';
// D2407 (#2407) — a founder's own Beehiiv newsletter, read-only, through Beehiiv's MCP server: sign-in only.
import './integrations/providers/beehiiv';
// D855 §4 (#3733 part 1) — a member's own Linear, read-only, through Linear's read-only MCP server: sign-in only, not listed yet.
import './integrations/providers/linear';
// D855 §4 (#3733 part 2) — a member's own Cloudflare, read-only, through Cloudflare's REST API: sign-in only, not listed yet.
import './integrations/providers/cloudflare';
// D1088 (#2953): Build's Notion writers and the design-note acceptor register with the sync engine.
import './services/notion/build';
import crunchbaseRoutes from './routes/crunchbase';
import network from './routes/network';
import referEarn from './routes/refer_earn';
import ventureScores from './routes/venture_scores';
import networkfx from './routes/networkfx';
import profiling from './routes/profiling';
import dashboard from './routes/dashboard';
import matches from './routes/matches';
import settings from './routes/settings';
import personas from './routes/personas';
import personaSegments from './routes/persona_segments';
import segmentAggregates from './routes/persona_segment_aggregates';
import personaMembers from './routes/persona_members';
import onboarding from './routes/onboarding';
// Task #6 (IF) — per-role onboarding checklist + product-tour tracking.
import onboardingChecklist from './routes/onboarding_checklist';
// Task #7 (IG) — Customer chat for paid tiers (Studio/Institutional/Partner).
import customerChat from './routes/customer_chat';
// Task #8 (IH) — Data import + migration tools (Carta/AngelList CSV/Deck
// PDF+PPTX/Investor portfolio/HubSpot pipeline/Universal CSV).
import importsRoutes from './routes/imports';
import brand, { renderLandingHtml, renderLandingPreview, renderTemplatePreview, renderSitePage } from './routes/brand';
import decks from './routes/decks';
import competitors from './routes/competitors';
import deckReviewer from './routes/deck_reviewer';
import research from './routes/research';
import usage from './routes/usage';
import researchOverview from './routes/research_overview';
import researchMarkets from './routes/research_markets';
import researchSectors from './routes/research_sectors';
import cycleGrow from './routes/cycle_grow';
// Task #6 — share-link viewer onboarding (signup/NDA/feedback/deal-pack)
// + conversion tracking. MUST be mounted BEFORE the `/api/decks`
// catch-all so its `/share/:token/...` subpaths take precedence over
// the existing /share/:token reader in decks.ts.
import deckShareActions from './routes/deck_share_actions';
// D901 (#2680) — the HTML export and the deck export ledger.
import deckExports from './routes/deck_exports';
import deckNotes from './routes/deck_notes';
// D1570 (#3817): comments on a deck's cards, @mentions, assignee, Resolve, and the approval a share waits for.
import deckComments from './routes/deck_comments';
import deckReview from './routes/deck_review';
import deckSources from './routes/deck_sources';
import deckCheck from './routes/deck_check';
import deckGrid from './routes/deck_grid';
import deckAreas from './routes/deck_areas';
import deckInstruct from './routes/deck_instruct';
import deckNarrative from './routes/deck_narrative';
import deckBatches from './routes/deck_batches';
import deckDraft from './routes/deck_draft';
import deckCoedit from './routes/deck_coedit';
import deckElementModels from './routes/deck_element_models';
import { adminDeckModels, deckModelPresets } from './routes/deck_model_presets';
import deckTemplates from './routes/deck_templates';
import deckElements from './routes/deck_elements';
import deckUsage from './routes/deck_usage';
import deckStage from './routes/deck_stage';
import deckRemix from './routes/deck_remix';
import deckTypedValues from './routes/deck_typed_values';
// D1543 (#3781): the venture-record elements and the logos store (migration 732).
import deckVentureElements from './routes/deck_venture_elements';
import deckFigures from './routes/deck_figures';
import deckNew from './routes/deck_new';
import deckAssist from './routes/deck_assist';
import deckDerive from './routes/deck_derive';
import deckCritic from './routes/deck_critic';
import deckCritique from './routes/deck_critique';
import deckQaRoutes from './routes/deck_qa';
import deckTransform from './routes/deck_transform';
import deckImages from './routes/deck_images';
import deckImageEdits from './routes/deck_image_edits';
import deckRehearsals from './routes/deck_rehearsals';
// D1565 (#3812): one link per investor, and tailored variants.
import deckInvestorLinks from './routes/deck_investor_links';
import deckPublish, { serveDeckEmbed, serveDeckShareCard } from './routes/deck_publish';
import notificationsRoutes from './routes/notifications';
import linkedinRoutes from './routes/linkedin';
import calendarRoutes from './routes/calendar';
import googleWorkspaceRoutes from './routes/google_workspace';
// D1319 (#3480): founder publishing to an outside service, pressed by the founder only.
import publishRoutes from './routes/publish';
import financialsRoutes from './routes/financials';
import progressRoutes from './routes/progress';
import cycleBuildRoutes from './routes/cycle_build';
import lovableAppLinks from './routes/lovable_app_links';
import lovableSignups from './routes/lovable_signups';
import buildGoogleRoutes from './routes/build_google';
import buildPlanRoutes, { buildEvidenceRoutes } from './routes/build_plan';
import buildPlanStateRoutes from './routes/build_plan_state';
import metricsRoutes from './routes/metrics';
import revenueRoutes from './routes/revenue';
import wellbeingRoutes from './routes/wellbeing';
import complianceRoutes from './routes/compliance';
import captableRoutes from './routes/captable';
import captableAccessRoutes from './routes/captable_access';
import dataRoomRoutes from './routes/data_room';
import advisorGrantRoutes from './routes/advisor_grants';
import perksRoutes from './routes/perks';
import adminLicences from './routes/admin_licences';
import adminProgramGrants from './routes/admin_program_grants';
import adminProgramRequests from './routes/admin_program_requests';
// D986 (#2776) — partner deal types per licence: HQ's reads and write, and the studio's own read.
import adminPartnerDealTypes from './routes/admin_partner_deal_types';
import licencePartnerDealTypes from './routes/licence_partner_deal_types';
import adminDeployments from './routes/admin_deployments';
import adminStatements from './routes/admin_statements';
import adminEscalations from './routes/admin_escalations';
import adminSupportSessions from './routes/admin_support_sessions';
import branchEscalationRoutes from './routes/branch_escalations';
import branchApprovalRoutes from './routes/branch_approvals';
import branchApprovalAssignmentRoutes from './routes/branch_approval_assignments';
import adminApprovalRoutes from './routes/admin_approvals';
import branchHomeRoutes from './routes/branch_home';
import branchTemplateRoutes from './routes/branch_templates';
import branchInsightsRoutes from './routes/branch_insights';
import branchDeploymentRoutes from './routes/branch_deployment';
import branchInvitationRoutes from './routes/branch_invitations';
import branchSupportSessionRoutes from './routes/branch_support_sessions';
import adminSuperAdmins from './routes/admin_super_admins';
import adminCreditRules from './routes/admin_credit_rules';
import adminTicketReviews from './routes/admin_ticket_reviews';
import communityTasksRoutes from './routes/community_tasks';
import learningRoutes from './routes/learning';
import learningPlanRoutes from './routes/learning_plan';
import adminLearningRoutes from './routes/admin_learning';
import learningAssessmentRoutes from './routes/learning_assessment';
import adminLearningAssessmentRoutes from './routes/admin_learning_assessment';
import learningProgramsRoutes from './routes/learning_programs';
import adminLearningProgramsRoutes from './routes/admin_learning_programs';
import learningWebinarsRoutes from './routes/learning_webinars';
import adminLearningWebinarsRoutes from './routes/admin_learning_webinars';
import { adminLearningVideo, learningVideo } from './routes/learning_video';
import adminHq from './routes/admin_hq';
import adminInsightsScopes from './routes/admin_insights_scopes';
import adminCommunityRoutes from './routes/admin_community';
import adminRevenue from './routes/admin_revenue';
import adminContent from './routes/admin_content';
import adminPlatform from './routes/admin_platform';
import adminSecurity from './routes/admin_security';
import adminTrustCenter from './routes/admin_trust_center';
import trustPublic from './routes/trust_public';
import { securityReports, adminSecurityReports } from './routes/security_reports';
import adminHqSupport from './routes/admin_hq_support';
import adminStudioGlance from './routes/admin_studio_glance';
import adminInsights from './routes/admin_insights';
import adminPrograms from './routes/admin_programs';
import adminProgramProposals from './routes/admin_program_proposals';
import adminInsightsExport from './routes/admin_insights_export';
import adminAccountsOverview from './routes/admin_accounts_overview';
// The holder-facing read of one licence — see routes/licence.ts for why it is
// not a role branch inside the admin ledger.
import licence from './routes/licence';
// D799 — the Administrator's requests to HQ, under the same prefix.
import licenceRequests from './routes/licence_requests';
import licencePrograms from './routes/licence_programs';
import cofounderRoutes from './routes/cofounder';
import skillsRoutes from './routes/skills';
import valuesRoutes from './routes/values';
import radarRoutes from './routes/radar';
import spinoutLabRoutes from './routes/spinout_lab';
import spinoutCertificateRoutes, { publicCertificateRoutes } from './routes/spinout_certificates';
import spinoutModerationRoutes from './routes/spinout_moderation';
import { labHosts, adminLabHosts } from './routes/lab_hosts';
// T13/T14/T15 — port of FastAPI mentors/partner_office_hours/watchlist/journal/
// portfolio_health/references/comarketing/company/needs/insights routers.
import advisorsRoutes from './routes/advisors';
import partnerOfficeHoursRoutes from './routes/partner_office_hours';
// Task #6 (W-1) — investor paywall surfaces.
import introductionsRoutes from './routes/introductions';
import investorSeatsRoutes, { downgradeExpiredInvestorTrials } from './routes/investor_seats';
import { requireInvestorTierExcept } from './middleware/requireInvestorTier';
import watchlistRoutes from './routes/watchlist';
import followsRoutes from './routes/follows';
import journalRoutes from './routes/journal';
import portfolioRoutes from './routes/portfolio';
import referencesRoutes from './routes/references';
import comarketingRoutes from './routes/comarketing';
import companyRoutes from './routes/company';
import companyLifecycle from './routes/company_lifecycle';
import companyLegal from './routes/company_legal';
import companyDocuments from './routes/company_documents';
import projectLifecycle from './routes/project_lifecycle';
import needsRoutes, { quotesRouter, engagementsRouter } from './routes/needs';
// #45 — the partner workspace's own stores (migrations 208/209). Mounted under
// `/api/partner/…` singular, which is a free first segment: `/api/partners` is
// the public firm directory and a different path, and `/api/pipeline/vote*`
// below belongs to deal voting rather than to a partner's deal pipeline.
import partnerPipeline from './routes/partner_pipeline';
import partnerOffers from './rou…50065 tokens truncated…    'src/routes/public.ts',
    'src/services/profileExpansion.ts',
    'src/routes/follows.ts',
    'src/services/teamSchema.ts',
    'src/services/networkProfilesSchema.ts',
    'src/routes/spinout_certificates.ts',
  ]) {
    const source = await read(relativePath);
    // The latch moved from `flag = true` to `<WeakMap>.set(bindingKey(env), true)`
    // in #204. What is pinned is unchanged and is the only thing that matters
    // here: production takes the early return WITHOUT running a statement, and
    // it still marks itself done so the check is paid once. The `.set(` form is
    // required explicitly, so a file that drops back to a module-level boolean
    // fails this test as well as the readiness guard.
    assert.match(
      source,
      /if \(env\.ENVIRONMENT === 'production'\) \{\s*[A-Z_]+\.set\(bindingKey\(env\), true\);\s*return(?: true)?;\s*\}/s,
      `${relativePath} must let production migrations, not request-time DDL, own its schema`,
    );
  }
});

test('both deploy targets keep the apex route table to the audited allowlist', async () => {
  const toml = await readFile(resolve(workspaceRoot, 'wrangler.toml'), 'utf8');
  const topLevel = toml.slice(0, toml.indexOf('\n[assets]'));
  const productionStart = toml.indexOf('[env.production]');
  const productionEnd = toml.indexOf('[env.production.vars]');
  const production = toml.slice(productionStart, productionEnd);
  const patterns = (source) => [...source.matchAll(/^pattern\s*=\s*"([^"]+)"/gm)].map((match) => match[1]).sort();

  const topPatterns = patterns(topLevel);
  const productionPatterns = patterns(production);

  // This assertion was INVERTED on 2026-08-31, and the inversion is the whole
  // point. It used to enforce a FLOOR (">= 68 entries; the table must never
  // shrink"), because the Worker served apex HTML through an explicit route
  // table and a missing route was a 404. Cloudflare Pages owned the apex
  // frontend for that one day; today the Worker answers every path of both
  // hosts through whole-host custom domains (the Pages mirror was retired on
  // 2026-09-03), so a small table is correct and GROWING it is the hazard:
  // re-adding a page or asset route pairs the HTML with a different Worker
  // asset build, the entry module 404s, and the boot watchdog spins on
  // `?__reboot=`. That is not hypothetical — it is what took the apex down
  // before this was rewritten.
  //
  // So: an exact allowlist, not a bound in either direction. The floor also
  // carried a hardcoded 68 that was 166 by the time it mattered, which is the
  // other reason it earned no trust.
  //
  // CORRECTED 2026-09-01; attribution fixed 2026-09-03 from git. The
  // four-entry table the paragraph above defends (`app.axal.vc` as a custom
  // domain plus `axal.vc/api/*`, `/landing/*`, `/p/*`) was the PAGES cutover's,
  // from `e1de44c2` ("Stop apex Pages and Worker asset skew", 2026-08-31
  // 10:51Z), and #371 pinned it here the same day — correct at the time. The
  // flip back came in `1d320dda9` (2026-09-01 09:08Z, author "Replit Agent",
  // message "Remove stale documentation asset files"): it replaced the three
  // path routes with a whole-host `axal.vc` custom domain in BOTH tables and
  // touched no test and no documentation, so one asset build sits behind the
  // apex and app.axal.vc and the two can no longer drift apart — in a commit
  // whose message never mentions it. The toml and this guard therefore
  // shipped disagreeing, and this was red on `main` until #374 (2026-09-01)
  // rewrote it to match. The toml is the deployed truth: the deploy log ends
  // with "Deployed studioos triggers: axal.vc (custom domain), app.axal.vc
  // (custom domain)". `frontend/test/apex_route_coverage.test.mjs` carries
  // the same correction and additionally pins that each entry is a custom
  // domain rather than a zone route.
  const ALLOWED = [
    'axal.vc',      // Workers Custom Domain — the Worker serves this whole host
    'app.axal.vc',  // Workers Custom Domain — same build, same handlers
  ].sort();

  assert.deepEqual(topPatterns, ALLOWED);
  assert.deepEqual(productionPatterns, ALLOWED);
  assert.equal(topPatterns.includes('axal.vc/*'), false);
  assert.equal(topPatterns.includes('axal.vc/assets/*'), false);
});