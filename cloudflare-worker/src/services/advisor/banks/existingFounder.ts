/**
 * Task #2 (AR) + Task #5 (CH) — Existing Founder bank.
 *
 * For founders past the Spin-Out Lab phase. Cycles through sections:
 * BUILD / CAPITAL / LEGAL / NETWORK / METRICS / GTM / OPS / HIRING /
 * WELLBEING / DEEP_DIVE. Original Task #2 question IDs are preserved
 * verbatim so the writeRouter mapping in writeRouter.ts keeps working.
 */
import type { Question } from '../questionBank';

const SECTORS = ['AI', 'B2B SaaS', 'Climate', 'Fintech', 'Healthcare', 'Consumer', 'Deep Tech', 'Other'];
const STAGES = ['Idea', 'Prototype', 'Pre-seed', 'Seed', 'Series A', 'Later'];

// Compact builder: q(section, page, anchor) returns a function that
// builds many rows efficiently. Keeps file lines ~3× shorter than
// the verbose object literal form while preserving every Question
// field. Defaults: input_kind='long', importance='normal',
// validate inferred from input_kind.
type RowSpec = {
  id: string; prompt: string;
  kind?: Question['input_kind']; imp?: Question['importance'];
  hint?: string; opts?: string[]; skip?: boolean; ev?: boolean;
  followups?: string[]; mi?: Question['mi_section'];
  sent?: boolean; talc?: boolean; tier?: string;
};
const inferValidate = (k?: Question['input_kind']): Question['validate'] =>
  k === 'select' ? 'select' : k === 'number' ? 'number' :
  k === 'short' ? 'short'   : k === 'multi'  ? 'multi'  : 'long';
const block = (section: string, page: string, anchor: string,
               rows: RowSpec[]): Question[] =>
  rows.map(r => ({
    id: r.id, persona: 'founder', section,
    prompt: r.prompt, hint: r.hint,
    input_kind: r.kind ?? 'long',
    options: r.opts,
    importance: r.imp ?? 'normal',
    page_target: page, doc_anchor: anchor,
    validate: inferValidate(r.kind),
    skip_allowed: r.skip,
    requires_evidence: r.ev,
    followups: r.followups,
    mi_section: r.mi,
    sentiment_eligible: r.sent,
    talc_eligible: r.talc,
    tier_required: r.tier,
  }));

export const EXISTING_FOUNDER_BANK: Question[] = [
  // ---- BUILD (project + product) -------------------------------------
  ...block('BUILD', '/projects', 'build/projects', [
    { id: 'founder.project.name', prompt: 'Confirm your company / project name.', kind: 'short', imp: 'critical' },
    { id: 'founder.project.pitch', prompt: 'One-paragraph pitch — refresh how you position yourselves today.', imp: 'high' },
    { id: 'founder.project.sector', prompt: 'Sector?', kind: 'select', opts: SECTORS, imp: 'high', mi: 'sector_heat' },
    { id: 'founder.project.stage', prompt: 'Current stage?', kind: 'select', opts: STAGES, imp: 'high', mi: 'capital_velocity' },
    { id: 'founder.project.traction', prompt: 'Latest traction — top 2-3 numbers (MRR, paid logos, growth).', skip: true, mi: 'demand_supply' },
    // Task #14 — deck-autofill fields. Every entry maps to a projects
    // column added by migration 069 (lazy-bootstrapped at runtime).
    // writeRouter colMap routes each id directly to its column.
    { id: 'founder.project.tagline', prompt: 'A one-line tagline for your company — the line you would put on a billboard.', kind: 'short', imp: 'high' },
    { id: 'founder.project.logo_url', prompt: 'Drop a public HTTPS URL to your logo (used on the title + closing slides of every deck).', kind: 'short', skip: true },
    { id: 'founder.project.som_usd', prompt: 'Serviceable Obtainable Market (USD) — the slice you realistically capture in 3 years.', kind: 'number', skip: true, ev: true },
    { id: 'founder.project.cac_usd', prompt: 'Blended CAC (USD). Used on the business-model slide of every deck.', kind: 'number', skip: true, ev: true },
    { id: 'founder.project.gross_margin_pct', prompt: 'Gross margin %. Used on the business-model + unit-economics slides.', kind: 'number', skip: true, ev: true },
    { id: 'founder.project.contact_email', prompt: 'Best contact email for inbound from investors. Renders on the closing slide of every deck.', kind: 'short', imp: 'high' },
    { id: 'founder.project.vision', prompt: 'One-paragraph vision — where the company is in 10 years if everything goes right.', imp: 'high' },
    { id: 'founder.project.traction_summary', prompt: 'A short summary of your traction so far (3-4 sentences). Used as the body of the Traction slide.', skip: true },
    { id: 'founder.product.what_works', prompt: 'In one paragraph — what is consistently working in the product right now?', mi: 'sentiment', sent: true, followups: ['founder.product.what_breaks'] },
    { id: 'founder.product.what_breaks', prompt: 'And what is consistently breaking, or where do users churn / get confused?', mi: 'sentiment', sent: true, followups: ['founder.product.next_big_bet'] },
    { id: 'founder.product.next_big_bet', prompt: 'What is the next big bet on the product roadmap, and why now?' },
    { id: 'founder.product.dev_velocity', prompt: 'How many production releases do you ship per week? (rough average)', kind: 'number', skip: true },
    { id: 'founder.product.tech_debt_score', prompt: 'On a 1-10, how heavy is your tech debt today? (1=greenfield, 10=blocking)', kind: 'select', opts: ['1','2','3','4','5','6','7','8','9','10'] },
    { id: 'founder.product.qa_coverage', prompt: 'Do you have automated test coverage on your critical paths? (Yes / Partial / No)', kind: 'select', opts: ['Yes','Partial','No'] },
    { id: 'founder.product.platform_choice', prompt: 'Briefly — what is your core stack (frontend / backend / DB / cloud)?', kind: 'short', skip: true },
  ]),

  // ---- ICP / CUSTOMER FIT --------------------------------------------
  ...block('FIT', '/build/discovery', 'build/customer-discovery', [
    { id: 'founder.fit.icp_statement', prompt: 'One-sentence ICP today: "We sell to <persona> at <company stage> who are trying to <job-to-be-done>."', imp: 'high', mi: 'fit' },
    { id: 'founder.fit.icp_v_buyer', prompt: 'Is the user the same as the economic buyer? If not, name each.', mi: 'fit' },
    { id: 'founder.fit.icp_segments', prompt: 'How many distinct customer segments are you actively serving? Which is your bullseye?', mi: 'fit' },
    { id: 'founder.fit.activation_definition', prompt: "What is your single 'activated' moment for a new user? (e.g. 'sent first invoice')", imp: 'high', followups: ['founder.fit.activation_rate_pct'] },
    { id: 'founder.fit.activation_rate_pct', prompt: 'Of the last 100 signups, what % hit that moment?', kind: 'number', mi: 'demand_supply', ev: true, followups: ['founder.fit.retention_30d_pct'] },
    { id: 'founder.fit.retention_30d_pct', prompt: '30-day retention % for new users in the last cohort.', kind: 'number', skip: true, ev: true },
    { id: 'founder.fit.nps_or_csat', prompt: 'Latest NPS or CSAT score, and N respondents.', kind: 'short', skip: true, mi: 'sentiment', sent: true },
    { id: 'founder.fit.ipspf_signal', prompt: 'On the Sean Ellis "very disappointed" PMF survey, what % said "very disappointed" if your product disappeared?', kind: 'number', skip: true, mi: 'sentiment', sent: true },
    { id: 'founder.fit.churn_top_reason', prompt: 'When customers churn, what is the #1 stated reason?', mi: 'sentiment', sent: true },
    { id: 'founder.fit.expansion_signal', prompt: 'Are existing customers expanding (more seats, more usage, more product)? Quantify if you can.', mi: 'demand_supply' },
    { id: 'founder.fit.adoption_curve', prompt: 'Where in the adoption curve are your buyers — innovators, early adopters, early majority?', kind: 'select', opts: ['Innovators','Early adopters','Early majority','Late majority','Laggards'], mi: 'talc', talc: true },
    { id: 'founder.fit.discovery_volume_qtr', prompt: 'How many new customer-discovery conversations did you do last quarter?', kind: 'number', skip: true },
  ]),

  // ---- METRICS / FINANCIALS ------------------------------------------
  ...block('METRICS', '/build/financials', 'capital/metrics', [
    { id: 'founder.financials.runway_months', prompt: 'How many months of runway do you have? (whole number)', kind: 'number', imp: 'critical', ev: true, followups: ['founder.financials.monthly_burn_usd'] },
    { id: 'founder.financials.monthly_burn_usd', prompt: 'Monthly burn (USD).', kind: 'number', imp: 'critical', ev: true, mi: 'capital_velocity', followups: ['founder.financials.mrr_usd'] },
    { id: 'founder.financials.mrr_usd', prompt: 'Monthly recurring revenue (USD). Enter 0 if none.', kind: 'number', imp: 'high', ev: true, mi: 'demand_supply', followups: ['founder.financials.gross_margin_pct'] },
    { id: 'founder.financials.arr_usd', prompt: 'ARR (USD), or 12 × MRR if you bill monthly.', kind: 'number', skip: true, ev: true },
    { id: 'founder.financials.gross_margin_pct', prompt: 'Gross margin %. Rough is fine.', kind: 'number', skip: true, ev: true },
    { id: 'founder.financials.cac_usd', prompt: 'Blended CAC (USD) — total S&M / new customers, last quarter.', kind: 'number', skip: true, ev: true, followups: ['founder.financials.ltv_usd'] },
    { id: 'founder.financials.ltv_usd', prompt: 'Estimated LTV per customer (USD). Even a back-of-envelope number is useful.', kind: 'number', skip: true, ev: true, followups: ['founder.financials.payback_months'] },
    { id: 'founder.financials.payback_months', prompt: 'CAC payback period in months.', kind: 'number', skip: true },
    { id: 'founder.financials.net_revenue_retention_pct', prompt: 'Net revenue retention % (last 12 months).', kind: 'number', skip: true, ev: true },
    { id: 'founder.financials.gross_revenue_retention_pct', prompt: 'Gross revenue retention % (last 12 months).', kind: 'number', skip: true, ev: true },
    { id: 'founder.financials.magic_number', prompt: 'Magic number / sales efficiency — last 4 quarters average if you have it.', kind: 'number', skip: true },
    { id: 'founder.financials.bookings_qtr_usd', prompt: 'New bookings last quarter (USD).', kind: 'number', skip: true, mi: 'demand_supply', ev: true },
    { id: 'founder.financials.budget_vs_actual', prompt: 'Are you on, ahead, or behind your annual budget? Briefly explain why.', kind: 'select', opts: ['Ahead','On','Behind','No budget yet'], mi: 'capital_velocity' },
    { id: 'founder.financials.financial_model_link', prompt: 'Drop a link to your latest financial model (or "not yet").', kind: 'short', skip: true },
  ]),

  // ---- PIPELINE / GTM -------------------------------------------------
  ...block('GTM', '/build/metrics', 'capital/metrics', [
    { id: 'founder.pipeline.top_deals', prompt: 'What are your top 3 sales deals or design partners in flight?', imp: 'normal' },
    { id: 'founder.pipeline.size_usd', prompt: 'Total open pipeline value (USD).', kind: 'number', skip: true, mi: 'demand_supply', ev: true },
    { id: 'founder.pipeline.avg_sales_cycle_days', prompt: 'Average sales cycle in days.', kind: 'number', skip: true },
    { id: 'founder.pipeline.win_rate_pct', prompt: 'Win rate on qualified opportunities (%).', kind: 'number', skip: true, ev: true },
    { id: 'founder.gtm.primary_channel', prompt: 'Primary acquisition channel right now?', kind: 'select', opts: ['Outbound','Inbound (SEO/content)','Paid (ads)','PLG','Partnerships','Events','Word of mouth','Other'], mi: 'demand_supply' },
    { id: 'founder.gtm.channel_cac_split', prompt: 'How does CAC differ across your top 2 channels? (1-2 lines)' },
    { id: 'founder.gtm.outbound_volume_wk', prompt: 'How many outbound touches per week (across all reps)?', kind: 'number', skip: true },
    { id: 'founder.gtm.inbound_lead_volume_wk', prompt: 'Average inbound leads per week.', kind: 'number', skip: true, mi: 'demand_supply' },
    { id: 'founder.gtm.first_call_to_close_pct', prompt: 'Of qualified first calls last quarter, what % closed?', kind: 'number', skip: true, ev: true },
    { id: 'founder.gtm.avg_acv_usd', prompt: 'Average ACV (USD) on closed-won deals last quarter.', kind: 'number', skip: true, mi: 'demand_supply', ev: true },
    { id: 'founder.gtm.pricing_model', prompt: 'Pricing model — per seat, usage-based, tiered, custom, or hybrid?', kind: 'select', opts: ['Per seat','Usage','Tiered','Custom','Hybrid'] },
    { id: 'founder.gtm.pricing_changes_planned', prompt: 'Any pricing changes planned in the next 90 days? Why?' },
    { id: 'founder.gtm.brand_awareness', prompt: 'How are you investing in brand / awareness today? (channels, $ rough)' },
    { id: 'founder.gtm.community_motion', prompt: 'Do you have a community motion (Slack, Discord, events)? How active?' },
    { id: 'founder.gtm.customer_advisory_board', prompt: 'Do you run a customer advisory board? How often does it meet?', kind: 'select', opts: ['Yes monthly','Yes quarterly','Ad-hoc','No'] },
  ]),

  // ---- CAPITAL --------------------------------------------------------
  ...block('CAPITAL', '/capital/fundraise', 'capital/fundraise', [
    { id: 'founder.capital.raise_active', prompt: 'Are you actively raising right now?', kind: 'select', opts: ['Yes','No','Soon'], imp: 'high', mi: 'capital_velocity', followups: ['founder.capital.raise_target_usd'] },
    { id: 'founder.capital.raise_target_usd', prompt: 'How much are you raising (USD)?', kind: 'number', imp: 'high', skip: true, ev: true, mi: 'capital_velocity' },
    { id: 'founder.capital.target_close_date', prompt: 'Target close date for this round?', kind: 'short', skip: true, mi: 'capital_velocity', followups: ['founder.capital.lead_status'] },
    { id: 'founder.capital.lead_status', prompt: 'Do you have a committed lead, term sheet, or just exploring?', kind: 'select', opts: ['Committed lead','Term sheet','Multiple parties','Exploring','No conversations yet'], mi: 'capital_velocity', followups: ['founder.capital.valuation_target_usd'] },
    { id: 'founder.capital.valuation_target_usd', prompt: 'Target post-money valuation (USD).', kind: 'number', skip: true, ev: true, mi: 'capital_velocity', followups: ['founder.capital.use_of_funds'] },
    { id: 'founder.capital.previous_round_usd', prompt: 'Most recent round size (USD), or 0 if pre-seed.', kind: 'number', skip: true, ev: true },
    { id: 'founder.capital.previous_round_post_usd', prompt: 'Post-money valuation of that previous round (USD).', kind: 'number', skip: true, ev: true },
    { id: 'founder.capital.investors_on_captable', prompt: 'List your current institutional investors (comma-separated).', kind: 'short', skip: true },
    { id: 'founder.capital.bridge_likely', prompt: 'Is a bridge round likely if the next round slips? Why or why not?' },
    { id: 'founder.capital.preferred_lead_funds', prompt: '3-5 specific funds you would love to lead the next round.', skip: true, mi: 'capital_velocity' },
    { id: 'founder.capital.warm_intro_count', prompt: 'How many warm intros do you already have lined up to those funds?', kind: 'number', skip: true },
    { id: 'founder.capital.use_of_funds', prompt: 'In one paragraph — how will the next round be deployed? (hires, GTM, R&D, runway extension)', mi: 'capital_velocity' },
    { id: 'founder.capital.dilution_floor_pct', prompt: 'Maximum dilution you are willing to accept on this round (%).', kind: 'number', skip: true, ev: true },
    { id: 'founder.capital.option_pool_pct', prompt: 'Current option pool (%). Refresh planned this round?', kind: 'number', skip: true, ev: true },
    { id: 'founder.capital.runway_after_raise_months', prompt: 'How many months of runway will the new round buy?', kind: 'number', skip: true, mi: 'capital_velocity' },
  ]),

  // ---- LEGAL ----------------------------------------------------------
  ...block('LEGAL', '/legal/incorporation', 'legal/incorporation', [
    { id: 'founder.captable.entity', prompt: 'Are you incorporated? If yes, what entity (e.g. Delaware C-Corp)?', kind: 'short', imp: 'critical' },
    { id: 'founder.captable.ownership', prompt: 'Roughly, who owns the company today? (e.g. "Founders 80%, ESOP 10%, Angels 10%")', imp: 'high' },
    { id: 'founder.compliance.status', prompt: 'Compliance — anything overdue (83(b), annual filings, taxes)?', imp: 'high' },
    { id: 'founder.legal.ip_assignment_status', prompt: 'Have all employees + contractors signed IP assignment agreements?', kind: 'select', opts: ['All signed','Partial','None','Unknown'], imp: 'high' },
    { id: 'founder.legal.trademarks_filed', prompt: 'Have you filed trademarks for your brand / product names? (Yes / In progress / No)', kind: 'select', opts: ['Yes','In progress','No'] },
    { id: 'founder.legal.patents_filed', prompt: 'Any patent or provisional applications filed?', kind: 'short', skip: true },
    { id: 'founder.legal.dpa_template', prompt: 'Do you have a Data Processing Agreement template you can send to enterprise customers?', kind: 'select', opts: ['Yes','In progress','No'] },
    { id: 'founder.legal.privacy_policy', prompt: 'Is your privacy policy current (last reviewed within 12 months)?', kind: 'select', opts: ['Yes','No','Unknown'] },
    { id: 'founder.legal.security_certs', prompt: 'SOC2 / ISO27001 / HIPAA — any certifications in flight or achieved? (comma-separated)', kind: 'short', skip: true },
    { id: 'founder.legal.litigation_active', prompt: 'Any active or threatened litigation we should know about?', skip: true },
    { id: 'founder.legal.foreign_subsidiaries', prompt: 'Do you have foreign subsidiaries or PE risk? (comma-separated countries)', kind: 'short', skip: true, mi: 'sentiment_geo' },
    { id: 'founder.legal.terms_of_service_current', prompt: 'When were your customer Terms of Service last reviewed?', kind: 'short', skip: true },
    { id: 'founder.legal.export_controls', prompt: 'Any export control / OFAC concerns with your customer base?', skip: true, mi: 'sentiment_geo' },
  ]),

  // ---- HIRING / TEAM --------------------------------------------------
  ...block('HIRING', '/network', 'getting-started/invite-team', [
    { id: 'founder.team.headcount_total', prompt: 'Total headcount today (full-time equivalents).', kind: 'number' },
    { id: 'founder.team.headcount_by_function', prompt: 'Headcount split by function (e.g. "Eng 6, Product 2, GTM 3, Ops 1").', kind: 'short' },
    { id: 'founder.team.hires_planned_qtr', prompt: 'Roles you plan to hire next quarter (one per line).', skip: true },
    { id: 'founder.team.cofounders', prompt: 'Solo or co-founders? (comma-separated names)', kind: 'short', skip: true },
    { id: 'founder.team.first_eng_hired', prompt: 'When did you hire your first non-founder engineer? (date or "not yet")', kind: 'short', skip: true },
    { id: 'founder.team.attrition_12m', prompt: 'Voluntary attrition over the last 12 months (count).', kind: 'number', skip: true },
    { id: 'founder.team.diversity_snapshot', prompt: 'Briefly describe team diversity today (gender, ethnicity, backgrounds). Skip if you prefer.', skip: true },
    { id: 'founder.team.compensation_philosophy', prompt: 'How do you set comp — band-driven, market p75, founder gut?', kind: 'select', opts: ['Band-driven','Market p75','Market p50','Founder gut','Hybrid'] },
    { id: 'founder.team.equity_refresh_policy', prompt: 'Do you have an equity refresh policy for top performers? Briefly.', skip: true },
    { id: 'founder.team.remote_policy', prompt: 'Remote, hybrid, or in-office? Why?', kind: 'select', opts: ['Fully remote','Hybrid','In-office'] },
    { id: 'founder.team.culture_doc_link', prompt: 'Drop a link to your culture / handbook doc (or "not yet").', kind: 'short', skip: true },
    { id: 'founder.team.exec_team_complete', prompt: 'Of CEO / CTO / CPO / CRO / CFO / COO — which roles are filled? (comma-separated)', kind: 'short' },
  ]),

  // ---- OPS ------------------------------------------------------------
  ...block('OPS', '/account', 'getting-started/personas', [
    { id: 'founder.ops.tooling_stack', prompt: 'Top 5 tools your team uses daily (one per line).', skip: true },
    { id: 'founder.ops.weekly_metric_cadence', prompt: 'Do you publish a weekly metrics email / Slack? How disciplined is the cadence?' },
    { id: 'founder.ops.board_cadence', prompt: 'Board cadence — monthly, quarterly, ad-hoc, or no board yet?', kind: 'select', opts: ['Monthly','Quarterly','Ad-hoc','No board'], mi: 'partner_pulse' },
    { id: 'founder.ops.allhands_cadence', prompt: 'How often do you do an all-hands? (weekly / biweekly / monthly / ad-hoc)', kind: 'select', opts: ['Weekly','Biweekly','Monthly','Ad-hoc'] },
    { id: 'founder.ops.okrs_cadence', prompt: 'Do you run quarterly OKRs? Are they reviewed mid-quarter?', kind: 'select', opts: ['Yes monthly','Yes quarterly','Tried, dropped','No'] },
    { id: 'founder.ops.standup_format', prompt: 'Daily standups, async, or no standup? Why?', kind: 'select', opts: ['Sync daily','Async daily','Weekly','None'] },
    { id: 'founder.ops.bug_triage_sla_hrs', prompt: 'Median triage SLA on a P1 customer bug (hours).', kind: 'number', skip: true },
    { id: 'founder.ops.oncall_rotation', prompt: 'Do you have an on-call rotation? Who is in it?', kind: 'short', skip: true },
    { id: 'founder.ops.knowledge_base', prompt: 'Where does your team document decisions? (Notion, Confluence, Linear docs, none)', kind: 'select', opts: ['Notion','Confluence','Linear docs','GitHub wiki','Other','None yet'] },
  ]),

  // ---- NETWORK --------------------------------------------------------
  ...block('NETWORK', '/advisors', 'portals/advisor', [
    { id: 'founder.advisors.needs', prompt: 'What expertise do you most need from an advisor right now? (comma-separated)', kind: 'short', imp: 'high' },
    { id: 'founder.advisors.current_advisors', prompt: 'How many active formal advisors do you have today?', kind: 'number', skip: true, mi: 'partner_pulse' },
    { id: 'founder.advisors.most_valuable', prompt: 'Of your current advisors, who has been most valuable in the last 90 days, and what did they do?', skip: true, mi: 'partner_pulse', sent: true },
    { id: 'founder.advisors.gap_areas', prompt: "What domain expertise is MISSING from your current network?" },
    { id: 'founder.advisors.intro_priority', prompt: "Name one specific intro you want this quarter — even an aspirational one." },
    { id: 'founder.partners.active_count', prompt: 'How many active strategic / channel partners do you have?', kind: 'number', skip: true, mi: 'partner_pulse' },
    { id: 'founder.partners.health_score', prompt: 'On a 1-10, how healthy is your partner ecosystem today?', kind: 'select', opts: ['1','2','3','4','5','6','7','8','9','10'], mi: 'partner_pulse', sent: true },
    { id: 'founder.partners.biggest_friction', prompt: 'Biggest friction with your existing partners? (1-2 sentences)', mi: 'partner_pulse', sent: true },
  ]),

  // ---- WELLBEING ------------------------------------------------------
  ...block('WELLBEING', '/wellbeing', 'support/wellbeing', [
    { id: 'founder.wellbeing.energy_score', prompt: 'On a 1-10, how is your energy this week?', kind: 'select', opts: ['1','2','3','4','5','6','7','8','9','10'], mi: 'sentiment', sent: true },
    { id: 'founder.wellbeing.sleep_hours', prompt: 'Average sleep per night this past week (hours).', kind: 'number', skip: true, mi: 'sentiment', sent: true },
    { id: 'founder.wellbeing.support_system', prompt: 'Who do you turn to when things are hard — and have you talked to them recently?', skip: true },
    { id: 'founder.wellbeing.biggest_stressor', prompt: 'Biggest source of stress right now?', mi: 'sentiment', sent: true },
    { id: 'founder.wellbeing.therapist_or_coach', prompt: 'Do you work with a therapist or coach? (Yes / No / Considering)', kind: 'select', opts: ['Yes','No','Considering'], skip: true },
    { id: 'founder.wellbeing.vacation_planned', prompt: 'When did you last take a real disconnected break (≥4 days)?', kind: 'short', skip: true },
  ]),

  // ---- DEEP DIVES — sector / stage specific (≥12) --------------------
  ...block('DEEP_DIVE', '/build/metrics', 'capital/metrics', [
    { id: 'founder.dd.fintech_kyc', prompt: 'Fintech only — what KYC / KYB provider are you using, and what is your false-positive rate?', kind: 'short', skip: true },
    { id: 'founder.dd.fintech_licensing', prompt: 'Fintech only — what money transmitter / banking partner / charter relationship do you rely on?', kind: 'short', skip: true },
    { id: 'founder.dd.fintech_chargeback_pct', prompt: 'Fintech only — chargeback / dispute rate (%).', kind: 'number', skip: true, ev: true },
    { id: 'founder.dd.ai_inference_cost_per_1k', prompt: 'AI infra — average inference cost per 1k requests (USD). Critical for unit econ.', kind: 'number', skip: true, ev: true },
    { id: 'founder.dd.ai_model_strategy', prompt: 'AI — are you using foundation models, fine-tuned, or your own from scratch? Why?', kind: 'select', opts: ['Foundation models (API)','Fine-tuned','Open-source self-hosted','Trained from scratch','Hybrid'], mi: 'sector_heat' },
    { id: 'founder.dd.ai_data_moat', prompt: 'AI — what proprietary data / feedback loop gives you a moat?' },
    { id: 'founder.dd.healthcare_hipaa_status', prompt: 'Healthcare only — HIPAA BAA in place? Any HITRUST / SOC2 work?', kind: 'short', skip: true },
    { id: 'founder.dd.consumer_cac_payback_months', prompt: 'Consumer only — CAC payback for paid acquisition cohorts (months).', kind: 'number', skip: true, ev: true },
    { id: 'founder.dd.consumer_d30_retention_pct', prompt: 'Consumer only — D30 retention by cohort (%).', kind: 'number', skip: true, ev: true },
    { id: 'founder.dd.b2b_saas_logos_paid', prompt: 'B2B SaaS only — number of paying logos.', kind: 'number', skip: true, ev: true, mi: 'demand_supply' },
    { id: 'founder.dd.b2b_saas_seat_expansion', prompt: 'B2B SaaS only — average seats per customer at month 12 vs month 1.', kind: 'short', skip: true, mi: 'demand_supply' },
    { id: 'founder.dd.climate_carbon_metric', prompt: 'Climate only — what is your headline impact metric (t CO2e avoided / yr, etc.)?', kind: 'short', skip: true },
    { id: 'founder.dd.deeptech_tech_readiness', prompt: 'Deep Tech only — current TRL (Technology Readiness Level, 1-9).', kind: 'select', opts: ['1','2','3','4','5','6','7','8','9'], skip: true },
    { id: 'founder.dd.preseed_lois', prompt: 'Pre-seed only — how many Letters of Intent / signed design partner agreements?', kind: 'number', skip: true, ev: true, mi: 'demand_supply' },
    { id: 'founder.dd.seriesa_cohort_retention', prompt: 'Series A only — paid retention curve at M12 for your earliest cohort (%).', kind: 'number', skip: true, ev: true },
    { id: 'founder.dd.seriesb_growth_rate', prompt: 'Series B only — last 12 months YoY revenue growth (%).', kind: 'number', skip: true, ev: true, mi: 'capital_velocity' },
  ]),
];

export default EXISTING_FOUNDER_BANK;
