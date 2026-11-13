/**
 * Task #2 (AR) + Task #5 (CH) — Investor bank.
 *
 * Decision-support sequencing: identity → sectors/stages → ticket
 * size → thesis (paywalled) → pipeline → DD discipline → portfolio
 * mgmt → LP relations → watchlist seed → sector deep-dives. Every
 * Task #2 IDs preserved; new IDs in `investor.<topic>.<n>` namespace.
 */
import type { Question } from '../questionBank';

const TYPES = ['Angel', 'Family Office', 'Micro VC', 'Traditional VC', 'Corporate Venture', 'Syndicate Lead'];
const TICKETS = ['<$25k', '$25k–$100k', '$100k–$500k', '$500k–$2M', '$2M+'];
const VOLUME = ['<5', '5–20', '20–50', '50+'];

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
    id: r.id, persona: 'investor', section,
    prompt: r.prompt, hint: r.hint,
    input_kind: r.kind ?? 'long', options: r.opts,
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

export const INVESTOR_BANK: Question[] = [
  // ---- PROFILE / IDENTITY --------------------------------------------
  ...block('PROFILE', '/investor-profile', 'portals/portfolio-health', [
    { id: 'investor.profile.investor_type', prompt: 'Which best describes your investing capacity?', kind: 'select', opts: TYPES, imp: 'critical', followups: ['investor.profile.sectors'] },
    { id: 'investor.profile.sectors', prompt: 'Which sectors are you actively investing in? (comma-separated)', kind: 'short', imp: 'high', hint: 'e.g. AI, Climate, Fintech', mi: 'sector_heat', followups: ['investor.profile.stages'] },
    { id: 'investor.profile.stages', prompt: 'Which stages do you write checks at? (comma-separated)', kind: 'short', imp: 'high', hint: 'e.g. Pre-seed, Seed, Series A', mi: 'capital_velocity', followups: ['investor.profile.ticket_band'] },
    { id: 'investor.profile.ticket_band', prompt: 'What ticket size do you typically write?', kind: 'select', opts: TICKETS, imp: 'high', mi: 'investor_signals', followups: ['investor.profile.fund_size_usd'] },
    { id: 'investor.profile.fund_size_usd', prompt: 'Current fund size (USD), or total annual personal capital deployed if angel.', kind: 'number', skip: true, ev: true, mi: 'capital_velocity' },
    { id: 'investor.profile.fund_vintage', prompt: 'Fund vintage year (the year you started deploying this fund).', kind: 'number', skip: true },
    { id: 'investor.profile.geo_focus', prompt: 'Geographic focus (comma-separated regions or "global").', kind: 'short', mi: 'sentiment_geo' },
    { id: 'investor.profile.lp_base', prompt: 'Briefly — who are your LPs? (e.g. "endowments, family offices, fund-of-funds")', skip: true, tier: 'investor_pro' },
  ]),

  // ---- THESIS (tier-gated for premium) -------------------------------
  ...block('THESIS', '/investor-profile', 'portals/portfolio-health', [
    { id: 'investor.profile.thesis', prompt: 'Tell me your investment thesis in 2-4 sentences.', imp: 'high', tier: 'investor_pro' },
    { id: 'investor.thesis.macro_trends', prompt: 'Which 2-3 macro trends are MOST shaping your thesis right now?', mi: 'sector_heat', tier: 'investor_pro', followups: ['investor.thesis.contrarian_view'] },
    { id: 'investor.thesis.contrarian_view', prompt: 'What is your most contrarian take that other VCs would push back on?', mi: 'investor_signals', tier: 'investor_pro', followups: ['investor.thesis.must_haves'] },
    { id: 'investor.thesis.passes_recent', prompt: 'In the last quarter, what is the most common reason you passed on a deal?', mi: 'investor_signals', sent: true },
    { id: 'investor.thesis.must_haves', prompt: 'What 3 things MUST be present for you to invest? (comma-separated)', kind: 'short' },
    { id: 'investor.thesis.deal_breakers', prompt: 'What 3 things instantly kill a deal for you? (comma-separated)', kind: 'short' },
    { id: 'investor.thesis.adoption_curve_focus', prompt: 'Where in the buyer adoption curve do your best companies sit?', kind: 'select', opts: ['Innovators','Early adopters','Early majority','Late majority'], mi: 'talc', talc: true },
    { id: 'investor.thesis.market_size_floor_usd', prompt: 'Minimum TAM (USD) you require for an investment to make sense.', kind: 'number', skip: true, ev: true },
    { id: 'investor.thesis.founder_archetype', prompt: 'What founder archetype most often makes you say yes? (1-2 sentences)' },
  ]),

  // ---- PIPELINE -------------------------------------------------------
  ...block('PIPELINE', '/deal-flow', 'portals/portfolio-health', [
    { id: 'investor.pipeline.deal_volume', prompt: 'How many deals do you actively look at per quarter?', kind: 'select', opts: VOLUME, mi: 'demand_supply' },
    { id: 'investor.pipeline.first_meetings_qtr', prompt: 'First-meeting count last quarter.', kind: 'number', skip: true, mi: 'demand_supply', ev: true, followups: ['investor.pipeline.term_sheets_qtr'] },
    { id: 'investor.pipeline.term_sheets_qtr', prompt: 'Term sheets issued last quarter.', kind: 'number', skip: true, ev: true, mi: 'capital_velocity', followups: ['investor.pipeline.investments_closed_qtr'] },
    { id: 'investor.pipeline.investments_closed_qtr', prompt: 'Investments closed last quarter.', kind: 'number', skip: true, ev: true, mi: 'capital_velocity', followups: ['investor.pipeline.avg_dd_days'] },
    { id: 'investor.pipeline.avg_dd_days', prompt: 'Average due diligence cycle (days from first meeting to wire).', kind: 'number', skip: true },
    { id: 'investor.pipeline.source_split', prompt: 'How does your sourcing split — inbound, network, scout, outbound? (rough %)', kind: 'short' },
    { id: 'investor.pipeline.scout_program', prompt: 'Do you run a scout / venture-partner program?', kind: 'select', opts: ['Yes','Considering','No'] },
    { id: 'investor.pipeline.deals_per_partner', prompt: 'Roughly how many investments per partner per year is your model?', kind: 'number', skip: true },
    { id: 'investor.coinvest.preferences', prompt: 'Lead, follow, or both? Anything we should know about co-invest preferences?' },
    { id: 'investor.coinvest.preferred_partners', prompt: '3 funds you most often co-invest with, in priority order.' },
    { id: 'investor.coinvest.minimum_lead_check_usd', prompt: 'When leading, minimum check (USD).', kind: 'number', skip: true, ev: true },
  ]),

  // ---- DUE DILIGENCE --------------------------------------------------
  ...block('DD', '/deal-flow', 'portals/portfolio-health', [
    { id: 'investor.dd.checklist_link', prompt: 'Drop a link to your DD checklist (or describe in one paragraph).', kind: 'short', skip: true },
    { id: 'investor.dd.references_required', prompt: 'How many founder references do you typically take before a yes?', kind: 'select', opts: ['0-1','2-3','4-5','6+'] },
    { id: 'investor.dd.customer_calls_required', prompt: 'How many customer / pipeline reference calls do you typically take?', kind: 'select', opts: ['0','1-2','3-5','6+'] },
    { id: 'investor.dd.legal_review_outsourced', prompt: 'Do you outsource legal DD or do it in-house?', kind: 'select', opts: ['In-house','Outsourced','Mix'] },
    { id: 'investor.dd.tech_diligence_partner', prompt: 'For technical DD, do you bring in a specialist? Who?', skip: true },
    { id: 'investor.dd.financial_diligence_depth', prompt: 'How deep do you go on financial DD at seed / Series A?' },
    { id: 'investor.dd.background_checks', prompt: 'Do you run background checks on founders? When?', kind: 'select', opts: ['Always','Sometimes','Never'] },
    { id: 'investor.dd.competitive_diligence_method', prompt: 'How do you assess competitive landscape — analyst reports, expert calls, in-house?', kind: 'short' },
    { id: 'investor.dd.valuation_framework', prompt: 'Which framework do you anchor on for valuation? (comps, scorecard, gut, multiple of revenue)', kind: 'select', opts: ['Comparables','Scorecard','Gut','Multiple of revenue','First-principles model','Other'] },
    { id: 'investor.dd.red_flags_recent', prompt: 'What is the most recent red flag that killed a deal during DD?', mi: 'investor_signals', sent: true },
  ]),

  // ---- PORTFOLIO MANAGEMENT ------------------------------------------
  ...block('PORTFOLIO', '/portfolio', 'portals/portfolio-health', [
    { id: 'investor.portfolio.total_companies', prompt: 'How many active portfolio companies?', kind: 'number', skip: true, ev: true },
    { id: 'investor.portfolio.board_seats', prompt: 'How many board seats do you currently hold?', kind: 'number', skip: true },
    { id: 'investor.portfolio.observer_seats', prompt: 'How many board observer roles?', kind: 'number', skip: true },
    { id: 'investor.portfolio.review_cadence', prompt: 'How often do you review the portfolio formally?', kind: 'select', opts: ['Weekly','Monthly','Quarterly','Ad-hoc'], mi: 'partner_pulse' },
    { id: 'investor.portfolio.support_offered', prompt: 'Top 3 ways you actively help portfolio companies (comma-separated).', kind: 'short' },
    { id: 'investor.portfolio.intros_made_qtr', prompt: 'Roughly how many intros did you make for portfolio cos last quarter?', kind: 'number', skip: true, mi: 'partner_pulse' },
    { id: 'investor.portfolio.followon_reserves_pct', prompt: 'What % of fund is reserved for follow-on?', kind: 'number', skip: true, ev: true, mi: 'capital_velocity' },
    { id: 'investor.portfolio.exits_to_date', prompt: 'Realised exits to date (count + brief headline result).' },
  ]),

  // ---- LP / COMMS -----------------------------------------------------
  ...block('LP_COMMS', '/investor-profile', 'portals/portfolio-health', [
    { id: 'investor.lp.report_cadence', prompt: 'How often do you report to LPs?', kind: 'select', opts: ['Monthly','Quarterly','Semi-annually','Annually'], tier: 'investor_pro' },
    { id: 'investor.lp.report_format', prompt: 'Briefly — what does your LP report include?', tier: 'investor_pro' },
    { id: 'investor.lp.next_fund_planning', prompt: 'When do you plan to start raising the next fund?', kind: 'short', skip: true, mi: 'capital_velocity', tier: 'investor_pro' },
    { id: 'investor.lp.dpi_to_date_x', prompt: 'DPI (cash returned ÷ paid-in) to date.', kind: 'number', skip: true, ev: true, tier: 'investor_pro' },
    { id: 'investor.lp.tvpi_to_date_x', prompt: 'TVPI (total value ÷ paid-in) to date.', kind: 'number', skip: true, ev: true, tier: 'investor_pro' },
    { id: 'investor.lp.communication_pain', prompt: 'Biggest pain in LP communication today?', mi: 'sentiment', sent: true, tier: 'investor_pro' },
  ]),

  // ---- WATCHLIST ------------------------------------------------------
  ...block('WATCHLIST', '/portfolio', 'portals/portfolio-health', [
    { id: 'investor.watchlist.seed_companies', prompt: "Any companies you're already tracking? (comma-separated)", kind: 'short', skip: true },
    { id: 'investor.watchlist.alert_cadence', prompt: 'How often do you want watchlist updates?', kind: 'select', opts: ['Realtime','Daily','Weekly','Off'] },
    { id: 'investor.watchlist.signals_of_interest', prompt: 'Which signals matter most? (comma-separated: round close, hire, traction, press, churn risk)', kind: 'short' },
    { id: 'investor.watchlist.shadow_companies', prompt: 'Any companies you passed on but want to keep watching?', skip: true, mi: 'investor_signals' },
  ]),

  // ---- SECTOR DEEP-DIVES ---------------------------------------------
  ...block('SECTOR_DD', '/deal-flow', 'portals/portfolio-health', [
    { id: 'investor.sector.ai_inference_econ', prompt: 'AI investments — at what gross margin do you require AI startups to operate to be defensible?', kind: 'short', skip: true, mi: 'sector_heat' },
    { id: 'investor.sector.fintech_regulatory', prompt: 'Fintech investments — what regulatory regime are you most comfortable underwriting? (US, EU, LATAM, etc.)', kind: 'short', skip: true, mi: 'sentiment_geo' },
    { id: 'investor.sector.climate_metric_required', prompt: 'Climate investments — what unit-economic threshold or impact metric do you require?', skip: true, mi: 'sector_heat' },
    { id: 'investor.sector.healthcare_reimbursement', prompt: 'Healthcare investments — comfort with reimbursement-dependent revenue (Yes / Conditional / No)?', kind: 'select', opts: ['Yes','Conditional','No'], skip: true },
    { id: 'investor.sector.deeptech_capital_intensity', prompt: 'Deep Tech investments — max capital intensity to first revenue (USD)?', kind: 'number', skip: true, ev: true, mi: 'sector_heat' },
    { id: 'investor.sector.consumer_payback_floor', prompt: 'Consumer investments — minimum acceptable CAC payback period (months)?', kind: 'number', skip: true, ev: true },
  ]),
];

export default INVESTOR_BANK;
