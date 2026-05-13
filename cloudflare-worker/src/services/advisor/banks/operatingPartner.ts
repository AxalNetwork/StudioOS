/**
 * Task #2 (AR) + Task #5 (CH) — Operating Partner bank.
 *
 * Split into 4 sub-types via `partner_subtype`:
 *   - service_provider  (legal, accounting, design, PR, recruiting)
 *   - mentor_advisor    (formal advisor seats, EIRs, fractionals)
 *   - strategic         (channel / distribution / corporate partner)
 *   - corporate_venture (CVC + commercial bundle)
 *
 * Each sub-type has ~50 questions across PROFILE / SUPPLY / DEMAND /
 * CONFLICTS / FOCUS / COMMS so the advisor can run a meaningful
 * 60-minute conversation per sub-type. Original Task #2 IDs (e.g.
 * `partner.firm.name`) are preserved AND reused across sub-types
 * with sub-type-specific variants in the `partner.<subtype>.<n>`
 * namespace — only the original 7 carry the writeRouter mapping.
 */
import type { Question, PartnerSubtype } from '../questionBank';

const ROLES = ['Investor', 'Service Provider', 'Mentor / Advisor', 'Strategic Partner', 'Other'];

type RowSpec = {
  id: string; prompt: string;
  kind?: Question['input_kind']; imp?: Question['importance'];
  hint?: string; opts?: string[]; skip?: boolean; ev?: boolean;
  followups?: string[]; mi?: Question['mi_section'];
  sent?: boolean; talc?: boolean;
};
const inferValidate = (k?: Question['input_kind']): Question['validate'] =>
  k === 'select' ? 'select' : k === 'number' ? 'number' :
  k === 'short' ? 'short'   : k === 'multi'  ? 'multi'  : 'long';
const block = (subtype: PartnerSubtype | undefined, section: string,
               page: string, anchor: string, rows: RowSpec[]): Question[] =>
  rows.map(r => ({
    id: r.id, persona: 'partner', section,
    prompt: r.prompt, hint: r.hint,
    input_kind: r.kind ?? 'long', options: r.opts,
    importance: r.imp ?? 'normal',
    page_target: page, doc_anchor: anchor,
    validate: r.id.endsWith('.services_offered') || r.id.endsWith('.dealflow.channels')
      ? 'csv' : inferValidate(r.kind),
    skip_allowed: r.skip,
    requires_evidence: r.ev,
    followups: r.followups,
    mi_section: r.mi,
    sentiment_eligible: r.sent,
    talc_eligible: r.talc,
    partner_subtype: subtype,
  }));

// =====================================================================
// SHARED — preserved Task #2 IDs (no partner_subtype tag; visible to
// all sub-types as the common onboarding spine).
// =====================================================================
const SHARED: Question[] = block(undefined, 'FIRM', '/partner-portal', 'network/partners', [
  { id: 'partner.firm.name', prompt: 'Which firm or organization are you with?', kind: 'short', imp: 'critical', followups: ['partner.role.kind'] },
  { id: 'partner.role.kind', prompt: 'Which role best describes your partnership with the studio?', kind: 'select', opts: ROLES, imp: 'critical', followups: ['partner.services.offered'] },
  { id: 'partner.services.offered', prompt: 'What do you bring to portfolio companies? (comma-separated services)', kind: 'short', imp: 'high', followups: ['partner.deals.interest'] },
  { id: 'partner.deals.interest', prompt: 'What kinds of deals or projects most interest you?', imp: 'high', mi: 'demand_supply' },
  { id: 'partner.dealflow.channels', prompt: 'Where does your deal flow come from today? (comma-separated)', kind: 'short' },
  { id: 'partner.conflicts.list', prompt: 'Any conflicts of interest we should know about? (companies / sectors to avoid)', skip: true, imp: 'high' },
  { id: 'partner.profile.focus', prompt: 'What slice of the studio do you want to focus on this quarter?', skip: true },
  // Task #5 (CH) — adopted from legacy frontend bank for cross-bank
  // ID parity. Reused across all sub-types as part of the spine.
  { id: 'partner.rate.hourly', prompt: 'Hourly rate (USD), if you charge by the hour. 0 = not applicable.', kind: 'number', skip: true, ev: true },
  { id: 'partner.rate.project', prompt: 'Typical project rate band (USD), if you do fixed-fee work.', kind: 'short', skip: true },
  { id: 'partner.comp.model', prompt: 'Compensation model — cash, equity, hybrid, pro-bono?', kind: 'select', opts: ['Cash','Equity','Hybrid','Pro-bono'] },
]);

// =====================================================================
// SUB-TYPE: service_provider (~50 questions)
// =====================================================================
const SP = (rows: RowSpec[], section: string, page = '/partner-portal',
            anchor = 'network/partners') =>
  block('service_provider', section, page, anchor, rows);

const SERVICE_PROVIDER: Question[] = [
  ...SP([
    { id: 'partner.sp.firm_type', prompt: 'Which type of service firm are you? (legal, accounting, design, PR, recruiting, dev shop, other)', kind: 'select', opts: ['Legal','Accounting','Design','PR / Comms','Recruiting','Dev shop','Marketing','Other'], imp: 'critical' },
    { id: 'partner.sp.years_in_business', prompt: 'How many years has the firm been in business?', kind: 'number' },
    { id: 'partner.sp.team_size', prompt: 'Total team headcount.', kind: 'number' },
    { id: 'partner.sp.startup_team_size', prompt: 'How many people are dedicated specifically to startup clients?', kind: 'number', skip: true },
    { id: 'partner.sp.headquarter_geo', prompt: 'Where is your firm headquartered?', kind: 'short', mi: 'sentiment_geo' },
    { id: 'partner.sp.geos_served', prompt: 'Which geographies do you serve clients in? (comma-separated)', kind: 'short', mi: 'sentiment_geo' },
  ], 'PROFILE'),
  ...SP([
    { id: 'partner.sp.services_detailed', prompt: 'List your full menu of services (one per line).', imp: 'high' },
    { id: 'partner.sp.signature_offering', prompt: 'What is your signature offering — the thing you do better than anyone?', imp: 'high' },
    { id: 'partner.sp.scope_minimum_usd', prompt: 'Minimum engagement size you accept (USD).', kind: 'number', skip: true, ev: true },
    { id: 'partner.sp.pricing_model', prompt: 'Pricing model — hourly, fixed-fee, retainer, success-fee, hybrid?', kind: 'select', opts: ['Hourly','Fixed-fee','Retainer','Success-fee','Hybrid'] },
    { id: 'partner.sp.startup_discount_pct', prompt: 'Do you offer a startup-friendly discount? If yes, %.', kind: 'number', skip: true },
    { id: 'partner.sp.deferred_fees_open', prompt: 'Are you open to deferred fees / equity for early-stage clients?', kind: 'select', opts: ['Yes','Sometimes','No'] },
    { id: 'partner.sp.sla_response_hours', prompt: 'Standard response SLA on client requests (hours).', kind: 'number', skip: true },
    { id: 'partner.sp.case_study_link', prompt: 'Link to a recent case study or client win (or "none public").', kind: 'short', skip: true },
    { id: 'partner.sp.references_count', prompt: 'How many startup-stage client references can you provide on request?', kind: 'number', skip: true },
    { id: 'partner.sp.tooling_used', prompt: 'Top 3 tools you use to deliver work (one per line).', skip: true },
  ], 'SUPPLY'),
  ...SP([
    { id: 'partner.sp.target_stages', prompt: 'Which startup stages are your sweet spot? (comma-separated)', kind: 'short', mi: 'capital_velocity' },
    { id: 'partner.sp.target_sectors', prompt: 'Which sectors do you target most? (comma-separated)', kind: 'short', mi: 'sector_heat' },
    { id: 'partner.sp.deal_volume_pref_qtr', prompt: 'Roughly how many new portfolio engagements per quarter is ideal?', kind: 'number', mi: 'demand_supply' },
    { id: 'partner.sp.current_capacity_pct', prompt: 'On a 1-100, how much spare capacity do you have right now? (100=fully open)', kind: 'number', mi: 'demand_supply' },
    { id: 'partner.sp.intro_friendly', prompt: 'Are you open to portfolio-company-to-portfolio-company intros via the platform?', kind: 'select', opts: ['Yes','Sometimes','No'] },
    { id: 'partner.sp.cold_inbound_open', prompt: 'Are you open to cold inbound from new founders, or referrals only?', kind: 'select', opts: ['Cold OK','Referrals only','Selective'] },
    { id: 'partner.sp.intake_process', prompt: 'Briefly — what does your client intake process look like?' },
    { id: 'partner.sp.kickoff_time_days', prompt: 'How long from contract signed to actual kickoff (days)?', kind: 'number', skip: true },
  ], 'DEMAND'),
  ...SP([
    { id: 'partner.sp.conflicts_companies', prompt: 'Any specific companies (current clients) you cannot take competing work from?', skip: true, imp: 'high' },
    { id: 'partner.sp.conflicts_sectors', prompt: 'Any sectors you avoid for ethical / regulatory reasons?', skip: true },
    { id: 'partner.sp.exclusivity_clauses', prompt: 'Do any of your existing engagements have exclusivity clauses we should know about?', skip: true },
    { id: 'partner.sp.confidentiality_walls', prompt: 'Briefly — how do you handle Chinese-wall situations across competing clients?' },
  ], 'CONFLICTS'),
  ...SP([
    { id: 'partner.sp.priority_focus_qtr', prompt: 'What is your single biggest focus across the studio this quarter?', imp: 'high' },
    { id: 'partner.sp.expansion_goal', prompt: 'Are you trying to grow into a new sector or service line through studio engagements?', mi: 'demand_supply' },
    { id: 'partner.sp.success_metric', prompt: 'How do you measure success of a portfolio engagement? (1-2 sentences)' },
    { id: 'partner.sp.escalation_contact', prompt: 'Who is the right escalation contact for an unhappy founder client?', kind: 'short' },
  ], 'FOCUS'),
  ...SP([
    { id: 'partner.sp.preferred_comms_channel', prompt: 'Preferred channel for studio communications?', kind: 'select', opts: ['Email','Slack','In-platform','Phone','Other'] },
    { id: 'partner.sp.weekly_digest_optin', prompt: 'Want a weekly digest of new portfolio opportunities?', kind: 'select', opts: ['Yes','Monthly','Off'] },
    { id: 'partner.sp.case_study_consent', prompt: 'May we feature anonymised case studies of your engagements in studio marketing?', kind: 'select', opts: ['Yes','Anonymised only','No'] },
    { id: 'partner.sp.availability_office_hours', prompt: 'Are you willing to host studio-wide office hours? Cadence?', kind: 'select', opts: ['Weekly','Monthly','Quarterly','No'], mi: 'partner_pulse' },
    { id: 'partner.sp.satisfaction_score', prompt: 'On a 1-10, how satisfied are you with the studio partnership today?', kind: 'select', opts: ['1','2','3','4','5','6','7','8','9','10'], mi: 'sentiment', sent: true },
    { id: 'partner.sp.referral_nps', prompt: 'NPS — likelihood to refer another firm to the studio (0-10).', kind: 'select', opts: ['0','1','2','3','4','5','6','7','8','9','10'], mi: 'sentiment', sent: true },
    { id: 'partner.sp.biggest_friction', prompt: 'Biggest friction in working with the studio today?', mi: 'sentiment', sent: true },
    { id: 'partner.sp.improvement_suggestion', prompt: 'One concrete change that would unlock more value for you?', mi: 'partner_pulse' },
  ], 'COMMS'),
  ...SP([
    { id: 'partner.sp.dd.fintech_specialty', prompt: 'Fintech work — any sub-specialty (charters, lending, payments, crypto)?', kind: 'short', skip: true, mi: 'sector_heat' },
    { id: 'partner.sp.dd.healthcare_specialty', prompt: 'Healthcare work — any sub-specialty (HIPAA, FDA, reimbursement)?', kind: 'short', skip: true, mi: 'sector_heat' },
    { id: 'partner.sp.dd.ai_specialty', prompt: 'AI work — any sub-specialty (data licensing, model IP, content liability)?', kind: 'short', skip: true, mi: 'sector_heat' },
    { id: 'partner.sp.dd.intl_expansion', prompt: 'Cross-border / international expansion expertise — which jurisdictions?', kind: 'short', skip: true, mi: 'sentiment_geo' },
    { id: 'partner.sp.dd.licensing_held', prompt: 'Any specific professional licenses / certifications relevant to portfolio work?', kind: 'short', skip: true },
    { id: 'partner.sp.dd.security_compliance', prompt: 'Hold any security / compliance certifications (SOC2, ISO27001, GDPR DPA template)?', kind: 'short', skip: true },
    { id: 'partner.sp.dd.data_handling', prompt: 'How do you handle sensitive client data — segregated environments, NDAs default, other?', skip: true },
    { id: 'partner.sp.dd.team_seniority_mix', prompt: 'Mix of senior vs junior staff on a typical startup engagement (rough %).', kind: 'short', skip: true },
    { id: 'partner.sp.dd.tooling_integrations', prompt: 'Tools you can integrate with directly (Linear, Notion, GitHub, Stripe, etc.).', kind: 'short', skip: true },
    { id: 'partner.sp.dd.engagement_kpi', prompt: 'KPIs you report to clients during an engagement (one per line).', skip: true },
  ], 'DEEP_DIVE'),
];

// =====================================================================
// SUB-TYPE: mentor_advisor (~50)
// =====================================================================
const MA = (rows: RowSpec[], section: string, page = '/partner-portal',
            anchor = 'network/partners') =>
  block('mentor_advisor', section, page, anchor, rows);

const MENTOR_ADVISOR: Question[] = [
  ...MA([
    { id: 'partner.ma.role_type', prompt: 'Are you a formal advisor, EIR, fractional executive, or mentor?', kind: 'select', opts: ['Formal advisor','EIR','Fractional exec','Mentor','Mix'], imp: 'critical' },
    { id: 'partner.ma.years_operating', prompt: 'Years of operating experience (founder/exec/IC).', kind: 'number' },
    { id: 'partner.ma.notable_outcomes', prompt: 'Notable exits or outcomes (1-2 lines).', skip: true },
    { id: 'partner.ma.current_advisor_seats', prompt: 'How many active formal advisor seats do you currently hold?', kind: 'number' },
    { id: 'partner.ma.current_eir_engagements', prompt: 'How many active EIR / fractional engagements?', kind: 'number', skip: true },
    { id: 'partner.ma.geos_active', prompt: 'Which geographies are you most plugged into? (comma-separated)', kind: 'short', mi: 'sentiment_geo' },
  ], 'PROFILE'),
  ...MA([
    { id: 'partner.ma.functional_expertise', prompt: 'Top 3 functional areas of expertise (one per line).', imp: 'high' },
    { id: 'partner.ma.signature_topic', prompt: 'Your signature topic — the talk you can give to any founder?', imp: 'high' },
    { id: 'partner.ma.session_length_min', prompt: 'Default session length (minutes).', kind: 'select', opts: ['15','30','45','60','90'] },
    { id: 'partner.ma.async_or_sync', prompt: 'Async or sync preference for ongoing support?', kind: 'select', opts: ['Async','Sync','Mix'] },
    { id: 'partner.ma.pricing_model', prompt: 'Pricing model — equity, cash, both, pro-bono?', kind: 'select', opts: ['Equity','Cash','Both','Pro-bono'] },
    { id: 'partner.ma.equity_floor_pct', prompt: 'Minimum equity bps you accept for an advisor seat.', kind: 'number', skip: true, ev: true },
    { id: 'partner.ma.cash_rate_usd_hr', prompt: 'Your cash hourly rate (USD), 0 if not applicable.', kind: 'number', skip: true, ev: true },
    { id: 'partner.ma.weekly_hours_open', prompt: 'Hours per week available for new founders.', kind: 'select', opts: ['<1','1-2','3-5','5+'], mi: 'demand_supply' },
    { id: 'partner.ma.intros_offered_qtr', prompt: 'Roughly how many intros can you make per quarter?', kind: 'number', mi: 'partner_pulse' },
    { id: 'partner.ma.coaching_credentials', prompt: 'Any formal coaching / facilitation credentials?', kind: 'short', skip: true },
  ], 'SUPPLY'),
  ...MA([
    { id: 'partner.ma.target_stages', prompt: 'Which startup stages do you most enjoy advising? (comma-separated)', kind: 'short', mi: 'capital_velocity' },
    { id: 'partner.ma.target_sectors', prompt: 'Which sectors are sweet spots? (comma-separated)', kind: 'short', mi: 'sector_heat' },
    { id: 'partner.ma.adoption_curve', prompt: 'Sharper on early-adopter GTM or scaling-into-mass-market?', kind: 'select', opts: ['Early adopters','Early majority','Both'], mi: 'talc', talc: true },
    { id: 'partner.ma.founder_archetype', prompt: 'What founder archetype do you most like working with? (1-2 sentences)' },
    { id: 'partner.ma.intake_process', prompt: 'Briefly — what does your intake process look like for a new founder?' },
    { id: 'partner.ma.minimum_engagement_months', prompt: 'Minimum engagement length you commit to (months).', kind: 'number', skip: true },
  ], 'DEMAND'),
  ...MA([
    { id: 'partner.ma.conflicts_companies', prompt: 'Companies you currently advise where you cannot take competing work?', skip: true, imp: 'high' },
    { id: 'partner.ma.conflicts_funds', prompt: 'Any fund affiliations that should be disclosed?', skip: true },
    { id: 'partner.ma.confidentiality_practice', prompt: 'How do you handle confidentiality across multiple founder relationships?' },
  ], 'CONFLICTS'),
  ...MA([
    { id: 'partner.ma.quarter_focus', prompt: 'What is your biggest focus this quarter as an advisor?', imp: 'high' },
    { id: 'partner.ma.success_metric', prompt: 'How do you measure success of an advisor engagement?' },
    { id: 'partner.ma.case_studies_open', prompt: 'May we feature you in studio mentor-spotlight content?', kind: 'select', opts: ['Yes','Anonymised','No'] },
    { id: 'partner.ma.community_participation', prompt: 'Open to facilitating cohort-based learning sessions for the studio?', kind: 'select', opts: ['Yes','Sometimes','No'] },
  ], 'FOCUS'),
  ...MA([
    { id: 'partner.ma.calendar_link', prompt: 'Drop your booking link (Calendly / Cal.com / similar). Skip if private.', kind: 'short', skip: true },
    { id: 'partner.ma.preferred_comms', prompt: 'Preferred communication channel?', kind: 'select', opts: ['Email','Slack','In-platform','SMS','Other'] },
    { id: 'partner.ma.weekly_digest_optin', prompt: 'Want a weekly digest of new mentee requests?', kind: 'select', opts: ['Yes','Monthly','Off'] },
    { id: 'partner.ma.satisfaction_score', prompt: 'On a 1-10, how satisfied are you with current advisor engagements?', kind: 'select', opts: ['1','2','3','4','5','6','7','8','9','10'], mi: 'sentiment', sent: true },
    { id: 'partner.ma.referral_nps', prompt: 'NPS — likelihood to refer another advisor (0-10).', kind: 'select', opts: ['0','1','2','3','4','5','6','7','8','9','10'], mi: 'sentiment', sent: true },
    { id: 'partner.ma.biggest_friction', prompt: 'Biggest friction in your current studio engagements?', mi: 'sentiment', sent: true },
    { id: 'partner.ma.suggestion_for_studio', prompt: 'One concrete improvement that would help you mentor better here?', mi: 'partner_pulse' },
  ], 'COMMS'),
  ...MA([
    { id: 'partner.ma.dd.go_to_market', prompt: 'GTM expertise — outbound, PLG, channels, enterprise sales? (comma-separated)', kind: 'short', skip: true },
    { id: 'partner.ma.dd.product_strategy', prompt: 'Product strategy expertise — discovery, prioritisation, platform thinking?', kind: 'short', skip: true },
    { id: 'partner.ma.dd.fundraising_help', prompt: 'Are you willing to help founders prepare for fundraising? Cadence?', kind: 'select', opts: ['Yes weekly','Yes ad-hoc','Workshops only','No'] },
    { id: 'partner.ma.dd.hiring_help', prompt: 'Will you take inbound from portfolio cos for executive hiring intros?', kind: 'select', opts: ['Yes','Selective','No'] },
    { id: 'partner.ma.dd.crisis_support', prompt: 'Open to "crisis weekends" with founders facing existential decisions?', kind: 'select', opts: ['Yes','Sometimes','No'] },
    { id: 'partner.ma.dd.board_observer_open', prompt: 'Are you open to taking board observer seats? Cap on count?', kind: 'short', skip: true },
    { id: 'partner.ma.dd.podcast_or_writing_consent', prompt: 'May we feature your insights in studio content? (podcast, blog, panel)', kind: 'select', opts: ['Yes','Anonymised','No'] },
    { id: 'partner.ma.dd.intl_geo_expertise', prompt: 'Specific international markets you can advise expansion into (comma-separated).', kind: 'short', skip: true, mi: 'sentiment_geo' },
    { id: 'partner.ma.dd.regulatory_navigation', prompt: 'Which regulatory regimes are you fluent in? (e.g. FDA, FINRA, EU AI Act, GDPR)', kind: 'short', skip: true },
    { id: 'partner.ma.dd.exec_search_partners', prompt: 'Do you have go-to recruiting partners you can refer?', kind: 'short', skip: true },
    { id: 'partner.ma.dd.workshops_offered', prompt: 'Workshops you can run for cohorts (sales mechanics, fundraising prep, etc.)', skip: true },
    { id: 'partner.ma.dd.feedback_style', prompt: 'Direct truth-teller or warm-cushioned coach? (1-2 sentences on style)' },
    { id: 'partner.ma.dd.preferred_meeting_format', prompt: 'In-person, video, walking-call, or async-first?', kind: 'select', opts: ['In-person','Video','Walking call','Async first','Mix'] },
    { id: 'partner.ma.dd.public_speaking_open', prompt: 'Are you open to speaking at studio events / demo days?', kind: 'select', opts: ['Yes','Sometimes','No'] },
  ], 'DEEP_DIVE'),
];

// =====================================================================
// SUB-TYPE: strategic (~50) — channel / distribution / corporate partner
// =====================================================================
const ST = (rows: RowSpec[], section: string, page = '/partner-portal',
            anchor = 'network/partners') =>
  block('strategic', section, page, anchor, rows);

const STRATEGIC: Question[] = [
  ...ST([
    { id: 'partner.st.partnership_type', prompt: 'Type of strategic partnership — channel, distribution, technology, marketing, other?', kind: 'select', opts: ['Channel','Distribution','Technology','Marketing','Co-development','Other'], imp: 'critical' },
    { id: 'partner.st.parent_company', prompt: 'Parent company name (if different from firm).', kind: 'short', skip: true },
    { id: 'partner.st.industry', prompt: 'Primary industry of the partner organization.', kind: 'short', mi: 'sector_heat' },
    { id: 'partner.st.regions_active', prompt: 'Regions you operate in (comma-separated).', kind: 'short', mi: 'sentiment_geo' },
    { id: 'partner.st.team_dedicated_to_partnerships', prompt: 'Team headcount dedicated to startup partnerships.', kind: 'number', skip: true },
    { id: 'partner.st.years_in_partnerships', prompt: 'Years your firm has worked with startup partnerships.', kind: 'number', skip: true },
  ], 'PROFILE'),
  ...ST([
    { id: 'partner.st.assets_offered', prompt: 'Top 3 strategic assets you bring (distribution, data, brand, regulatory access). One per line.', imp: 'high' },
    { id: 'partner.st.audience_reach', prompt: 'Estimated audience reach you can offer a partner (users, customers, ARR).', kind: 'short', skip: true, mi: 'demand_supply' },
    { id: 'partner.st.api_or_marketplace', prompt: 'Do you have an API, marketplace, or integration program startups can plug into?', kind: 'select', opts: ['Yes API','Yes marketplace','Yes both','No'] },
    { id: 'partner.st.referral_economics', prompt: 'Briefly — what does the referral / rev-share economic look like?', mi: 'capital_velocity' },
    { id: 'partner.st.commercial_minimums', prompt: 'Any minimum commercial commitments to start a partnership? (USD or volume)', kind: 'short', skip: true },
    { id: 'partner.st.case_study_link', prompt: 'Link to a case study of a startup partnership you have run.', kind: 'short', skip: true },
    { id: 'partner.st.brand_assets_available', prompt: 'Are co-marketing brand assets available to partners?', kind: 'select', opts: ['Yes','On request','No'] },
    { id: 'partner.st.legal_template_speed_days', prompt: 'How long from initial conversation to signed partnership template (days)?', kind: 'number', skip: true },
    { id: 'partner.st.exclusivity_offered', prompt: 'Are you willing to offer category exclusivity to a startup partner?', kind: 'select', opts: ['Yes','Sometimes','No'] },
    { id: 'partner.st.success_examples_count', prompt: 'How many successful startup partnerships have you run in the last 12 months?', kind: 'number', skip: true, mi: 'partner_pulse' },
  ], 'SUPPLY'),
  ...ST([
    { id: 'partner.st.target_stages', prompt: 'Which startup stages do you partner with? (comma-separated)', kind: 'short', mi: 'capital_velocity' },
    { id: 'partner.st.target_sectors', prompt: 'Which sectors are strategic priorities? (comma-separated)', kind: 'short', mi: 'sector_heat' },
    { id: 'partner.st.partnership_volume_qtr', prompt: 'Roughly how many new partnerships you can absorb per quarter.', kind: 'number', mi: 'demand_supply' },
    { id: 'partner.st.qualifying_traction', prompt: 'What traction signal qualifies a startup for a partnership conversation?', kind: 'short' },
    { id: 'partner.st.warm_intro_required', prompt: 'Do you require a warm intro to engage, or do you take cold inbound?', kind: 'select', opts: ['Warm only','Cold OK','Selective'] },
    { id: 'partner.st.ideal_partner_archetype', prompt: 'In one sentence — your ideal startup partner archetype.' },
  ], 'DEMAND'),
  ...ST([
    { id: 'partner.st.conflicts_competitors', prompt: 'Any direct competitors of yours we should not partner with?', skip: true, imp: 'high' },
    { id: 'partner.st.conflicts_existing_partners', prompt: 'Any existing partners with category exclusivity we should respect?', skip: true },
    { id: 'partner.st.compliance_constraints', prompt: 'Any compliance / regulatory constraints on the kind of startups you can partner with?', skip: true },
  ], 'CONFLICTS'),
  ...ST([
    { id: 'partner.st.quarter_focus', prompt: 'Top strategic objective for the partnership program this quarter.', imp: 'high' },
    { id: 'partner.st.executive_sponsor', prompt: 'Who is the executive sponsor for this program inside your org?', kind: 'short', skip: true },
    { id: 'partner.st.budget_band_usd', prompt: 'Annual budget band for partnership investments (USD).', kind: 'select', opts: ['<$100k','$100k-$500k','$500k-$2M','$2M+'], skip: true, mi: 'capital_velocity' },
    { id: 'partner.st.success_metric', prompt: 'How is the program measured internally? (revenue, logos, integrations)' },
    { id: 'partner.st.kpi_north_star', prompt: 'North-star KPI for partnership success this year.', kind: 'short' },
  ], 'FOCUS'),
  ...ST([
    { id: 'partner.st.preferred_comms', prompt: 'Preferred communication channel?', kind: 'select', opts: ['Email','Slack','In-platform','Phone','Other'] },
    { id: 'partner.st.review_cadence', prompt: 'How often do you want to formally review the partnership pipeline?', kind: 'select', opts: ['Weekly','Monthly','Quarterly'], mi: 'partner_pulse' },
    { id: 'partner.st.weekly_digest_optin', prompt: 'Want a weekly digest of new startup partnership opportunities?', kind: 'select', opts: ['Yes','Monthly','Off'] },
    { id: 'partner.st.satisfaction_score', prompt: 'On a 1-10, how satisfied are you with the studio partnership today?', kind: 'select', opts: ['1','2','3','4','5','6','7','8','9','10'], mi: 'sentiment', sent: true },
    { id: 'partner.st.referral_nps', prompt: 'NPS — likelihood to refer another strategic partner (0-10).', kind: 'select', opts: ['0','1','2','3','4','5','6','7','8','9','10'], mi: 'sentiment', sent: true },
    { id: 'partner.st.biggest_friction', prompt: 'Biggest friction in working with the studio today?', mi: 'sentiment', sent: true },
    { id: 'partner.st.suggestion_for_studio', prompt: 'One concrete change that would unlock more value?', mi: 'partner_pulse' },
  ], 'COMMS'),
  ...ST([
    { id: 'partner.st.dd.api_access_program', prompt: 'Does your API have a startup tier / sandbox? Briefly.', skip: true, mi: 'demand_supply' },
    { id: 'partner.st.dd.intl_expansion_help', prompt: 'Can you help startups expand into your geographies?', kind: 'select', opts: ['Yes','Sometimes','No'], mi: 'sentiment_geo' },
    { id: 'partner.st.dd.regulatory_help', prompt: 'Can you help navigate regulatory approvals in your industry?', kind: 'select', opts: ['Yes','Sometimes','No'] },
    { id: 'partner.st.dd.brand_co_marketing_examples', prompt: 'List 1-2 best examples of past startup co-marketing (with links if public).', skip: true },
    { id: 'partner.st.dd.event_co_hosting', prompt: 'Open to co-hosting events with portfolio companies?', kind: 'select', opts: ['Yes','Sometimes','No'] },
    { id: 'partner.st.dd.data_sharing_open', prompt: 'Open to data-sharing arrangements with portfolio cos under NDA?', kind: 'select', opts: ['Yes','Selective','No'] },
    { id: 'partner.st.dd.executive_intros', prompt: 'Can you make executive intros inside the parent? Up to what level?', kind: 'select', opts: ['Director','VP','C-suite','None'] },
    { id: 'partner.st.dd.procurement_path', prompt: 'Briefly — how do startups become a vendor to your firm? Time-to-PO.' },
    { id: 'partner.st.dd.poc_funding_available', prompt: 'Is internal POC / pilot funding available for promising startups?', kind: 'select', opts: ['Yes','Sometimes','No'] },
    { id: 'partner.st.dd.ip_licensing_open', prompt: 'Open to IP / patent licensing or technology transfer deals with startups?', kind: 'select', opts: ['Yes','Selective','No'] },
    { id: 'partner.st.dd.sustainability_priorities', prompt: 'Sustainability / ESG priorities driving partnership decisions (1-2 lines).', skip: true, mi: 'sector_heat' },
    { id: 'partner.st.dd.competitive_intel_share', prompt: 'Are you willing to share competitive intel under NDA when relevant?', kind: 'select', opts: ['Yes','Sometimes','No'] },
    { id: 'partner.st.dd.warm_intro_quota', prompt: 'Roughly how many warm intros per quarter can you sponsor for studio cos?', kind: 'number', skip: true, mi: 'partner_pulse' },
  ], 'DEEP_DIVE'),
];

// =====================================================================
// SUB-TYPE: corporate_venture (~50) — CVC + commercial bundle
// =====================================================================
const CV = (rows: RowSpec[], section: string, page = '/partner-portal',
            anchor = 'network/partners') =>
  block('corporate_venture', section, page, anchor, rows);

const CORPORATE_VENTURE: Question[] = [
  ...CV([
    { id: 'partner.cv.parent_company', prompt: 'Parent corporation.', kind: 'short', imp: 'critical' },
    { id: 'partner.cv.cvc_unit_age_years', prompt: 'How long has the CVC unit been operating? (years)', kind: 'number' },
    { id: 'partner.cv.cvc_team_size', prompt: 'CVC team headcount.', kind: 'number' },
    { id: 'partner.cv.fund_size_usd', prompt: 'Current fund size or annual deployment budget (USD).', kind: 'number', skip: true, ev: true, mi: 'capital_velocity' },
    { id: 'partner.cv.geos_active', prompt: 'Geographies you actively invest in (comma-separated).', kind: 'short', mi: 'sentiment_geo' },
    { id: 'partner.cv.balance_sheet_or_separate', prompt: 'Are you investing off the balance sheet or via a separate fund vehicle?', kind: 'select', opts: ['Balance sheet','Separate fund','Hybrid'] },
  ], 'PROFILE'),
  ...CV([
    { id: 'partner.cv.thesis_one_line', prompt: 'CVC thesis in one sentence.', imp: 'high' },
    { id: 'partner.cv.target_sectors', prompt: 'Which sectors are strategic priorities? (comma-separated)', kind: 'short', imp: 'high', mi: 'sector_heat' },
    { id: 'partner.cv.target_stages', prompt: 'Stages you write checks at.', kind: 'short', mi: 'capital_velocity' },
    { id: 'partner.cv.ticket_band_usd', prompt: 'Typical ticket band (USD).', kind: 'select', opts: ['<$100k','$100k-$500k','$500k-$2M','$2M-$10M','$10M+'], mi: 'investor_signals' },
    { id: 'partner.cv.followon_reserve_pct', prompt: '% of fund reserved for follow-on.', kind: 'number', skip: true, ev: true, mi: 'capital_velocity' },
    { id: 'partner.cv.lead_or_follow', prompt: 'Lead, follow, or both?', kind: 'select', opts: ['Lead','Follow','Both'] },
    { id: 'partner.cv.commercial_bundle_offered', prompt: 'In addition to capital — what commercial assets do you bundle? (data, distribution, customers)' },
    { id: 'partner.cv.dilution_neutral_clauses', prompt: 'Are you willing to write checks without info rights / pro-rata demands at seed?', kind: 'select', opts: ['Yes','Sometimes','No'] },
    { id: 'partner.cv.investments_per_yr', prompt: 'Roughly investments closed per year.', kind: 'number', mi: 'capital_velocity' },
    { id: 'partner.cv.support_offered', prompt: 'Top 3 ways CVC actively helps portfolio cos (comma-separated).', kind: 'short' },
  ], 'SUPPLY'),
  ...CV([
    { id: 'partner.cv.deals_screened_qtr', prompt: 'Deals screened per quarter.', kind: 'number', skip: true, mi: 'demand_supply' },
    { id: 'partner.cv.deals_closed_qtr', prompt: 'Deals closed per quarter.', kind: 'number', skip: true, ev: true, mi: 'capital_velocity' },
    { id: 'partner.cv.average_dd_days', prompt: 'Average DD cycle (days from first meeting to wire).', kind: 'number', skip: true },
    { id: 'partner.cv.warm_intro_required', prompt: 'Do you require a warm intro?', kind: 'select', opts: ['Always','Strong preference','No'] },
    { id: 'partner.cv.coinvest_partners', prompt: 'Top 3 funds you most often co-invest with.', kind: 'short' },
    { id: 'partner.cv.lps_or_internal_committee', prompt: 'Do you have LPs or only an internal investment committee?', kind: 'select', opts: ['LPs','Internal committee','Both'] },
  ], 'DEMAND'),
  ...CV([
    { id: 'partner.cv.conflicts_competitors', prompt: 'Direct competitors of the parent corp we cannot invest in (comma-separated).', skip: true, imp: 'high' },
    { id: 'partner.cv.conflicts_existing_portcos', prompt: 'Existing portfolio companies that have category exclusivity.', skip: true },
    { id: 'partner.cv.regulatory_constraints', prompt: 'Any export-control / national-security constraints on investments?', skip: true, mi: 'sentiment_geo' },
    { id: 'partner.cv.strategic_vs_financial', prompt: 'Are decisions primarily strategic or primarily financial?', kind: 'select', opts: ['Strategic','Financial','Balanced'] },
  ], 'CONFLICTS'),
  ...CV([
    { id: 'partner.cv.quarter_focus', prompt: 'Top focus this quarter (e.g. close 3 seed checks, build pipeline in X sector).', imp: 'high' },
    { id: 'partner.cv.executive_sponsor', prompt: 'Executive sponsor inside the parent corp.', kind: 'short', skip: true },
    { id: 'partner.cv.success_metric', prompt: 'How is success of the CVC measured internally? (1-2 sentences)' },
    { id: 'partner.cv.next_year_priorities', prompt: 'Top 3 priorities for next year (one per line).' },
  ], 'FOCUS'),
  ...CV([
    { id: 'partner.cv.preferred_comms', prompt: 'Preferred communication channel?', kind: 'select', opts: ['Email','Slack','In-platform','Phone','Other'] },
    { id: 'partner.cv.weekly_digest_optin', prompt: 'Want a weekly digest of new investment opportunities?', kind: 'select', opts: ['Yes','Monthly','Off'] },
    { id: 'partner.cv.review_cadence', prompt: 'Cadence for joint pipeline reviews with the studio.', kind: 'select', opts: ['Weekly','Monthly','Quarterly'], mi: 'partner_pulse' },
    { id: 'partner.cv.satisfaction_score', prompt: 'On a 1-10, how satisfied with the studio relationship today?', kind: 'select', opts: ['1','2','3','4','5','6','7','8','9','10'], mi: 'sentiment', sent: true },
    { id: 'partner.cv.referral_nps', prompt: 'NPS — likelihood to refer another CVC to the studio (0-10).', kind: 'select', opts: ['0','1','2','3','4','5','6','7','8','9','10'], mi: 'sentiment', sent: true },
    { id: 'partner.cv.biggest_friction', prompt: 'Biggest friction in working with the studio today?', mi: 'sentiment', sent: true },
    { id: 'partner.cv.suggestion_for_studio', prompt: 'One concrete improvement that would unlock more deal flow?', mi: 'partner_pulse' },
  ], 'COMMS'),
  ...CV([
    { id: 'partner.cv.dd.commercial_signoff_required', prompt: 'Does each investment need a commercial-side sponsor inside the parent? Briefly.', skip: true },
    { id: 'partner.cv.dd.preferred_exit_path', prompt: 'Preferred exit path for investments — strategic to parent, IPO, third-party M&A?', kind: 'select', opts: ['Strategic to parent','IPO','Third-party M&A','Open'] },
    { id: 'partner.cv.dd.right_of_first_refusal', prompt: 'Do you require ROFR / ROFO clauses on portfolio acquisitions?', kind: 'select', opts: ['Always','Sometimes','Never'] },
    { id: 'partner.cv.dd.brand_use_restrictions', prompt: 'Any restrictions on portfolio cos using the parent brand publicly?', skip: true },
    { id: 'partner.cv.dd.commercial_velocity_days', prompt: 'Average days from investment to first commercial pilot with the parent.', kind: 'number', skip: true, mi: 'capital_velocity' },
    { id: 'partner.cv.dd.followon_signal_window', prompt: 'How early do you need traction signal to participate in a follow-on?' },
    { id: 'partner.cv.dd.board_seats_required', prompt: 'Do you require board seats / observer rights at lead-check ticket sizes?', kind: 'select', opts: ['Always','Above threshold','Optional','Never'] },
    { id: 'partner.cv.dd.commercial_team_intros', prompt: 'Will the commercial team take warm intros from portfolio cos? Cadence?', kind: 'select', opts: ['Always','Selective','Rarely'] },
    { id: 'partner.cv.dd.pro_rata_intent', prompt: 'How aggressively do you exercise pro-rata in subsequent rounds?', kind: 'select', opts: ['Always','Strategic only','Rare','Never'], mi: 'investor_signals' },
    { id: 'partner.cv.dd.bridge_support', prompt: 'Are you willing to bridge a portfolio co between rounds in extreme cases?', kind: 'select', opts: ['Yes','Sometimes','No'] },
    { id: 'partner.cv.dd.lp_communication_role', prompt: 'Do you brief external LPs / parent execs jointly with portfolio cos?', kind: 'select', opts: ['Yes','Sometimes','No'] },
    { id: 'partner.cv.dd.public_pr_consent', prompt: 'May we publicly announce co-investments with you?', kind: 'select', opts: ['Always','Case-by-case','No'] },
    { id: 'partner.cv.dd.product_roadmap_input', prompt: 'Do you offer input on portfolio product roadmaps when commercially relevant?', kind: 'select', opts: ['Yes','Selective','No'] },
  ], 'DEEP_DIVE'),
];

// =====================================================================
// EXPORT — concat all 4 sub-types + the shared spine.
// Drift script asserts each sub-type ≥ BANK_SIZE_TARGETS.operatingPartnerPerSubtype.
// =====================================================================
export const OPERATING_PARTNER_BANK: Question[] = [
  ...SHARED,
  ...SERVICE_PROVIDER,
  ...MENTOR_ADVISOR,
  ...STRATEGIC,
  ...CORPORATE_VENTURE,
];

export default OPERATING_PARTNER_BANK;
