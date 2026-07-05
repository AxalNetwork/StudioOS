/**
 * Signals — seeded sample dataset.
 *
 * Purpose: give the UI real, credible-looking signals to render before any live
 * ingestion has run, and give tests a deterministic corpus. Every company here
 * is a REAL public company and every signal is a plausible founder thesis, but
 * the specific evidence lines are illustrative scaffolding — the live adapters
 * (services/signals/sources.ts) replace them once a refresh runs.
 *
 * Timestamps are generated relative to "now" at read time so freshness scores
 * stay meaningful in the demo. Companies are normalized through the same band
 * helpers the live adapters use, so seed + live data are interchangeable.
 */
import type { NormalizedCompany, Signal } from './types';
import { capBand, employeeBand, maturityFrom } from './sources';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

// Raw company facts (public, slow-moving). Market caps are order-of-magnitude
// approximations for banding only — this engine never displays a live price.
interface RawCompany {
  symbol: string;
  name: string;
  exchange: string;
  country: string;
  region: NormalizedCompany['region'];
  sector: string;
  industry: string;
  market_cap: number;
  employee_count: number;
  ceo: string;
  description: string;
  customer_type: NormalizedCompany['customer_type'];
}

const RAW_COMPANIES: RawCompany[] = [
  // — LATAM fintech —
  { symbol: 'NU', name: 'Nu Holdings', exchange: 'NYSE', country: 'Brazil', region: 'Latin America', sector: 'Financial Services', industry: 'Digital Banking', market_cap: 55e9, employee_count: 8000, ceo: 'David Vélez', description: 'Digital bank serving 100M+ customers across Brazil, Mexico and Colombia.', customer_type: 'consumer' },
  { symbol: 'STNE', name: 'StoneCo', exchange: 'NASDAQ', country: 'Brazil', region: 'Latin America', sector: 'Financial Services', industry: 'Payments', market_cap: 4e9, employee_count: 14000, ceo: 'Pedro Zinner', description: 'Payments and software for Brazilian SMB merchants.', customer_type: 'smb' },
  { symbol: 'DLO', name: 'DLocal', exchange: 'NASDAQ', country: 'Uruguay', region: 'Latin America', sector: 'Financial Services', industry: 'Cross-border Payments', market_cap: 3e9, employee_count: 1000, ceo: 'Pedro Arnt', description: 'Cross-border payments infrastructure for emerging markets.', customer_type: 'enterprise' },
  { symbol: 'MELI', name: 'MercadoLibre', exchange: 'NASDAQ', country: 'Argentina', region: 'Latin America', sector: 'Consumer Discretionary', industry: 'E-commerce & Fintech', market_cap: 90e9, employee_count: 58000, ceo: 'Ariel Szarfsztejn', description: 'Largest e-commerce and fintech ecosystem in Latin America.', customer_type: 'consumer' },

  // — US vertical SaaS —
  { symbol: 'TOST', name: 'Toast', exchange: 'NYSE', country: 'United States', region: 'North America', sector: 'Technology', industry: 'Restaurant Software', market_cap: 22e9, employee_count: 5000, ceo: 'Aman Narang', description: 'All-in-one restaurant point-of-sale and management platform.', customer_type: 'smb' },
  { symbol: 'PCOR', name: 'Procore', exchange: 'NYSE', country: 'United States', region: 'North America', sector: 'Technology', industry: 'Construction Software', market_cap: 10e9, employee_count: 4000, ceo: 'Tooey Courtemanche', description: 'Construction management software for owners, GCs and specialty contractors.', customer_type: 'mid_market' },
  { symbol: 'PHR', name: 'Phreesia', exchange: 'NYSE', country: 'United States', region: 'North America', sector: 'Healthcare', industry: 'Healthcare Workflow', market_cap: 1.5e9, employee_count: 1400, ceo: 'Chaim Indig', description: 'Patient intake, scheduling and payments automation for provider groups.', customer_type: 'healthcare_provider' },
  { symbol: 'INTA', name: 'Intapp', exchange: 'NASDAQ', country: 'United States', region: 'North America', sector: 'Technology', industry: 'Professional Services Software', market_cap: 4e9, employee_count: 1300, ceo: 'John Hall', description: 'Software for law firms, accountants and capital-markets advisers.', customer_type: 'enterprise' },
  { symbol: 'NCNO', name: 'nCino', exchange: 'NASDAQ', country: 'United States', region: 'North America', sector: 'Technology', industry: 'Banking Software', market_cap: 4e9, employee_count: 1700, ceo: 'Sean Desmond', description: 'Cloud banking operating system for financial institutions.', customer_type: 'financial_institution' },
  { symbol: 'DH', name: 'Definitive Healthcare', exchange: 'NASDAQ', country: 'United States', region: 'North America', sector: 'Healthcare', industry: 'Healthcare Data', market_cap: 550e6, employee_count: 900, ceo: 'Kevin Coop', description: 'Healthcare commercial intelligence and provider data platform.', customer_type: 'enterprise' },

  // — Cybersecurity / compliance —
  { symbol: 'S', name: 'SentinelOne', exchange: 'NYSE', country: 'United States', region: 'North America', sector: 'Technology', industry: 'Cybersecurity', market_cap: 7e9, employee_count: 2500, ceo: 'Tomer Weingarten', description: 'Autonomous endpoint and cloud security platform.', customer_type: 'enterprise' },
  { symbol: 'CYBR', name: 'CyberArk', exchange: 'NASDAQ', country: 'United States', region: 'North America', sector: 'Technology', industry: 'Identity Security', market_cap: 15e9, employee_count: 3200, ceo: 'Matt Cohen', description: 'Identity security and privileged access management.', customer_type: 'enterprise' },
  { symbol: 'RPD', name: 'Rapid7', exchange: 'NASDAQ', country: 'United States', region: 'North America', sector: 'Technology', industry: 'Cybersecurity', market_cap: 2.5e9, employee_count: 2600, ceo: 'Corey Thomas', description: 'Security operations, vulnerability and threat detection platform.', customer_type: 'mid_market' },

  // — Europe / UK —
  { symbol: 'WISE.L', name: 'Wise', exchange: 'LSE', country: 'United Kingdom', region: 'Europe', sector: 'Financial Services', industry: 'Cross-border Payments', market_cap: 12e9, employee_count: 5500, ceo: 'Kristo Käärmann', description: 'Cross-border money transfer and multi-currency accounts.', customer_type: 'consumer' },
  { symbol: 'DARK.L', name: 'Darktrace', exchange: 'LSE', country: 'United Kingdom', region: 'Europe', sector: 'Technology', industry: 'Cybersecurity', market_cap: 5e9, employee_count: 2300, ceo: 'Poppy Gustafsson', description: 'Self-learning AI cyber-defence (acquired by Thoma Bravo, 2024).', customer_type: 'enterprise' },

  // — Southeast Asia —
  { symbol: 'SE', name: 'Sea Limited', exchange: 'NYSE', country: 'Singapore', region: 'Southeast Asia', sector: 'Consumer Discretionary', industry: 'E-commerce & Fintech', market_cap: 60e9, employee_count: 67000, ceo: 'Forrest Li', description: 'Shopee e-commerce, SeaMoney fintech and Garena gaming across SEA.', customer_type: 'consumer' },
  { symbol: 'GRAB', name: 'Grab Holdings', exchange: 'NASDAQ', country: 'Singapore', region: 'Southeast Asia', sector: 'Technology', industry: 'Super-app / Fintech', market_cap: 18e9, employee_count: 11000, ceo: 'Anthony Tan', description: 'Deliveries, mobility and digital financial services super-app.', customer_type: 'consumer' },

  // — South Asia —
  { symbol: 'PB', name: 'PB Fintech (Policybazaar)', exchange: 'NSE', country: 'India', region: 'South Asia', sector: 'Financial Services', industry: 'Insurtech', market_cap: 9e9, employee_count: 15000, ceo: 'Yashish Dahiya', description: 'Online insurance and lending marketplace for Indian consumers.', customer_type: 'consumer' },
  { symbol: 'ZOMATO.NS', name: 'Eternal (Zomato)', exchange: 'NSE', country: 'India', region: 'South Asia', sector: 'Consumer Discretionary', industry: 'Food Delivery & Quick Commerce', market_cap: 30e9, employee_count: 6000, ceo: 'Deepinder Goyal', description: 'Food delivery, dining-out and Blinkit quick commerce.', customer_type: 'consumer' },

  // — MENA / Africa —
  { symbol: 'NETW', name: 'Network International', exchange: 'LSE', country: 'United Arab Emirates', region: 'MENA', sector: 'Financial Services', industry: 'Payments', market_cap: 2.7e9, employee_count: 2000, ceo: 'Nandan Mer', description: 'Payment processing across the Middle East and Africa.', customer_type: 'enterprise' },
  { symbol: 'JMIA', name: 'Jumia Technologies', exchange: 'NYSE', country: 'Nigeria', region: 'Sub-Saharan Africa', sector: 'Consumer Discretionary', industry: 'E-commerce', market_cap: 700e6, employee_count: 3000, ceo: 'Francis Dufay', description: 'Pan-African e-commerce and logistics marketplace.', customer_type: 'consumer' },
];

/** Fully-normalized seed companies (bands + maturity derived like live data). */
export function getSeedCompanies(): NormalizedCompany[] {
  return RAW_COMPANIES.map((c) => {
    const band = capBand(c.market_cap);
    const eb = employeeBand(c.employee_count);
    return {
      ...c,
      market_cap_band: band,
      employee_band: eb,
      maturity_stage: maturityFrom(band, eb),
      source_key: 'company_profile',
      updated_at: daysAgo(3),
    };
  });
}

/** Seed signals — one or more per SIGNAL_TYPE. Scores are placeholders; the
 *  ranking engine recomputes confidence/freshness/rank at read time. */
export function getSeedSignals(): Signal[] {
  return [
    {
      id: 'sig_latam_smb_lending',
      type: 'underserved_segment',
      title: 'SMB credit underwriting for LATAM merchants',
      thesis: 'Public LATAM fintechs are scaling consumer banking fast but leave thin-file SMB merchants underserved on working-capital credit.',
      why_now: 'StoneCo and Nu both flagged SMB credit expansion in recent results while default models still lean on scarce bureau data — a gap a focused underwriting layer can fill.',
      region: 'Latin America', country: 'Brazil',
      sector: 'Financial Services', industry: 'Digital Banking', niche: 'SMB working-capital credit',
      market_cap_band: 'small',
      target_customers: ['smb', 'financial_institution'],
      maturity_stage: 'scaling',
      related_companies: ['STNE', 'NU', 'DLO'],
      evidence_items: [
        { kind: 'earnings', title: 'StoneCo names SMB credit re-acceleration a 2024 priority', source_key: 'company_profile', weight: 0.8, observed_at: daysAgo(21) },
        { kind: 'filing', title: 'Nu 20-F: expanding secured and unsecured lending to underbanked segments', source_key: 'sec_edgar', weight: 0.95, observed_at: daysAgo(64) },
        { kind: 'news', title: 'Brazil SMBs still cite credit access as top growth blocker', source_key: 'news_rss', weight: 0.5, observed_at: daysAgo(9) },
        { kind: 'hiring', title: 'Multiple LATAM fintechs hiring risk & credit-model engineers', source_key: 'hiring_signal', weight: 0.45, observed_at: daysAgo(12) },
      ],
      founder_opportunity: 'Build a cash-flow-based underwriting API that ingests merchant payment rails (Pix, card acquiring) to score thin-file SMBs in real time.',
      advisor_note: 'Point founders with payments or risk backgrounds here — the incumbents are consumer-first, so an SMB-credit wedge avoids head-on competition.',
      build: {
        headline: 'Real-time working-capital underwriting for LATAM merchants',
        wedge: 'Start with card/Pix cash-flow scoring for a single acquirer’s long tail of merchants.',
        icp: 'Brazilian SMB merchants (< $2M revenue) with card/Pix history but no bank credit line.',
        gtm: 'Embed via acquirers and vertical SaaS (POS) rather than direct-to-merchant.',
        moat: 'Proprietary repayment data compounding into a better default model over time.',
        risks: 'Credit is capital-intensive and cyclical; needs a funding partner from day one.',
      },
      market: { growth_direction: 'accelerating', cap_band_spread: ['small', 'mid', 'large'], tam_note: 'LATAM SMB credit gap estimated in the hundreds of billions USD by IDB.' },
      confidence_score: 0, freshness_score: 0,
      source_attribution: ['company_profile', 'sec_edgar', 'news_rss', 'hiring_signal'],
      tags: ['fintech', 'lending', 'latam'],
      updated_at: daysAgo(9),
    },
    {
      id: 'sig_construction_field_ai',
      type: 'workflow_digitization',
      title: 'AI field-ops copilots for construction subcontractors',
      thesis: 'Construction software has digitized the GC office but subcontractor field workflows (daily logs, RFIs, punch lists) remain manual and paper-bound.',
      why_now: 'Procore’s own filings emphasize expanding beyond GCs to the specialty-contractor long tail — validation that the field layer is the next frontier.',
      region: 'North America', country: 'United States',
      sector: 'Technology', industry: 'Construction Software', niche: 'Subcontractor field operations',
      market_cap_band: 'mid',
      target_customers: ['smb', 'mid_market'],
      maturity_stage: 'scaling',
      related_companies: ['PCOR'],
      evidence_items: [
        { kind: 'filing', title: 'Procore 10-K: TAM expansion into specialty contractors and field workflows', source_key: 'sec_edgar', weight: 0.95, observed_at: daysAgo(80) },
        { kind: 'hiring', title: 'Construction-tech job postings for field/mobile product roles rising', source_key: 'hiring_signal', weight: 0.45, observed_at: daysAgo(15) },
        { kind: 'news', title: 'Labour shortages push contractors toward mobile-first automation', source_key: 'news_rss', weight: 0.5, observed_at: daysAgo(6) },
      ],
      founder_opportunity: 'Ship a voice/photo-first mobile app that auto-generates daily logs and RFIs from a foreman’s phone, syncing back to Procore/Autodesk.',
      advisor_note: 'A classic "sell into the incumbent’s gaps" play — integrate rather than compete; the exit logic (acquisition by a GC platform) is clean.',
      build: {
        headline: 'Voice-first field copilot for subcontractors',
        wedge: 'Auto-generated daily logs from photos + voice, one trade at a time (e.g. electrical).',
        icp: 'Specialty subcontractors, 20–200 field crew, already on a GC’s Procore instance.',
        gtm: 'Bottoms-up via foremen; expand to the sub’s back office; partner-list on Procore.',
        moat: 'Trade-specific data models + being the system-of-record for field labour.',
        risks: 'Field adoption is hard; must be faster than paper on day one.',
      },
      market: { growth_direction: 'steady', cap_band_spread: ['mid'] },
      confidence_score: 0, freshness_score: 0,
      source_attribution: ['sec_edgar', 'hiring_signal', 'news_rss'],
      tags: ['vertical-saas', 'construction', 'ai'],
      updated_at: daysAgo(6),
    },
    {
      id: 'sig_healthcare_intake',
      type: 'vertical_software',
      title: 'Specialty-clinic patient intake beyond the big platforms',
      thesis: 'Horizontal patient-intake platforms optimize for large provider groups, leaving specialty and independent clinics with clunky, generic workflows.',
      why_now: 'Phreesia and Definitive Healthcare data show intake automation spreading, but specialty verticals (dental, derm, behavioral) still bolt together forms + payments manually.',
      region: 'North America', country: 'United States',
      sector: 'Healthcare', industry: 'Healthcare Workflow', niche: 'Specialty-clinic intake & payments',
      market_cap_band: 'small',
      target_customers: ['healthcare_provider', 'smb'],
      maturity_stage: 'scaling',
      related_companies: ['PHR', 'DH'],
      evidence_items: [
        { kind: 'earnings', title: 'Phreesia guidance: expanding into new specialties and payments attach', source_key: 'company_profile', weight: 0.8, observed_at: daysAgo(28) },
        { kind: 'filing', title: 'Definitive Healthcare data shows fragmented specialty provider software stacks', source_key: 'sec_edgar', weight: 0.9, observed_at: daysAgo(70) },
        { kind: 'news', title: 'Independent clinics cite admin burden and no-shows as top pain', source_key: 'news_rss', weight: 0.5, observed_at: daysAgo(11) },
      ],
      founder_opportunity: 'Pick one high-no-show specialty (e.g. behavioral health) and own intake→eligibility→payment end to end, with specialty-specific forms.',
      advisor_note: 'Steer clinically-adjacent founders here; the wedge is depth in one specialty, not breadth — that’s where incumbents are weak.',
      build: {
        headline: 'Vertical intake OS for a single clinical specialty',
        wedge: 'No-show reduction via smart reminders + pre-visit eligibility for one specialty.',
        icp: 'Independent / small-group specialty clinics (2–20 providers).',
        gtm: 'Specialty association channels + per-location land-and-expand.',
        moat: 'Specialty-specific compliance + payer eligibility logic; sticky system-of-record.',
        risks: 'Healthcare sales cycles and integration with legacy EHRs.',
      },
      confidence_score: 0, freshness_score: 0,
      source_attribution: ['company_profile', 'sec_edgar', 'news_rss'],
      tags: ['healthtech', 'vertical-saas'],
      updated_at: daysAgo(11),
    },
    {
      id: 'sig_dora_compliance',
      type: 'regulatory_pressure',
      title: 'DORA operational-resilience tooling for EU financial firms',
      thesis: 'The EU Digital Operational Resilience Act forces financial entities to prove ICT resilience and manage third-party risk — creating durable, budgeted software demand.',
      why_now: 'DORA enforcement is live in 2025; public security and banking-software vendors are repositioning, but mid-market EU firms lack turnkey compliance tooling.',
      region: 'Europe', country: 'United Kingdom',
      sector: 'Technology', industry: 'Governance, Risk & Compliance', niche: 'DORA / ICT third-party risk',
      market_cap_band: 'mid',
      target_customers: ['financial_institution', 'mid_market'],
      maturity_stage: 'scaling',
      related_companies: ['CYBR', 'DARK.L', 'NCNO'],
      evidence_items: [
        { kind: 'filing', title: 'CyberArk highlights regulatory tailwinds for identity & resilience controls', source_key: 'sec_edgar', weight: 0.95, observed_at: daysAgo(50) },
        { kind: 'registry', title: 'Surge in EU RegTech entity formations around resilience/GRC', source_key: 'registry_opencorporates', weight: 0.7, observed_at: daysAgo(40) },
        { kind: 'news', title: 'DORA deadline drives compliance-spend scramble at mid-size EU banks', source_key: 'news_rss', weight: 0.5, observed_at: daysAgo(5) },
        { kind: 'hiring', title: 'GRC/resilience engineering roles spiking across EU financial firms', source_key: 'hiring_signal', weight: 0.45, observed_at: daysAgo(8) },
      ],
      founder_opportunity: 'Build a DORA control-mapping + third-party-risk register that continuously evidences resilience testing for mid-market EU firms.',
      advisor_note: 'Regulatory deadlines are the best go-to-market a founder can ask for. Prioritize this for founders with fintech/security operator experience.',
      build: {
        headline: 'Continuous DORA compliance for mid-market EU finance',
        wedge: 'Automated ICT third-party risk register + resilience-test evidence pack.',
        icp: 'EU financial entities of 200–2,000 staff without a big-4 GRC budget.',
        gtm: 'Partner with auditors and MSPs already inside these accounts.',
        moat: 'Regulatory content library + audit-ready evidence trail; switching cost.',
        risks: 'Regulatory interpretation shifts; must track guidance closely.',
      },
      market: { growth_direction: 'accelerating', cap_band_spread: ['mid', 'large'], tam_note: 'DORA touches 20,000+ EU financial entities.' },
      confidence_score: 0, freshness_score: 0,
      source_attribution: ['sec_edgar', 'registry_opencorporates', 'news_rss', 'hiring_signal'],
      tags: ['regtech', 'compliance', 'europe'],
      updated_at: daysAgo(5),
    },
    {
      id: 'sig_sea_embedded_finance',
      type: 'geographic_expansion',
      title: 'Embedded finance for Southeast Asian SMB commerce',
      thesis: 'SEA super-apps have digitized consumer payments; the next layer is embedded credit and treasury for the millions of SMBs selling through their marketplaces.',
      why_now: 'Sea and Grab both expanded SeaMoney/GrabFin into lending, signalling that SMB financial services in SEA are entering scale-up — with room for specialist infrastructure.',
      region: 'Southeast Asia', country: 'Singapore',
      sector: 'Financial Services', industry: 'Embedded Finance', niche: 'Marketplace SMB credit & treasury',
      market_cap_band: 'mid',
      target_customers: ['smb', 'developer'],
      maturity_stage: 'scaling',
      related_companies: ['SE', 'GRAB'],
      evidence_items: [
        { kind: 'earnings', title: 'Sea reports SeaMoney lending book growth and credit expansion', source_key: 'company_profile', weight: 0.8, observed_at: daysAgo(24) },
        { kind: 'news', title: 'Grab extends merchant lending across Indonesia and Vietnam', source_key: 'news_rss', weight: 0.5, observed_at: daysAgo(7) },
        { kind: 'registry', title: 'Rising fintech incorporations in Singapore serving regional SMBs', source_key: 'registry_opencorporates', weight: 0.7, observed_at: daysAgo(35) },
      ],
      founder_opportunity: 'Offer embedded-finance rails (KYC + underwriting + disbursement) as an API for the second-tier SEA marketplaces the super-apps don’t serve.',
      advisor_note: 'Geographic-expansion signal: the pattern is proven by the leaders, so the risk shifts from "does demand exist" to execution and licensing.',
      build: {
        headline: 'Embedded-finance API for SEA marketplaces',
        wedge: 'One country (e.g. Vietnam) + one product (merchant cash advance) first.',
        icp: 'Regional vertical marketplaces and B2B commerce platforms without a fintech arm.',
        gtm: 'Developer-led + partnerships; licensing via a sponsor bank per market.',
        moat: 'Local licensing + repayment data per corridor; hard to replicate quickly.',
        risks: 'Fragmented regulation across ASEAN; capital and licensing heavy.',
      },
      market: { growth_direction: 'accelerating', cap_band_spread: ['mid', 'large'] },
      confidence_score: 0, freshness_score: 0,
      source_attribution: ['company_profile', 'news_rss', 'registry_opencorporates'],
      tags: ['fintech', 'embedded-finance', 'sea'],
      updated_at: daysAgo(7),
    },
    {
      id: 'sig_cyber_consolidation',
      type: 'consolidation_signal',
      title: 'Post-consolidation gaps in mid-market cyber tooling',
      thesis: 'Repeated take-privates and roll-ups of cyber vendors are pulling focus upmarket, orphaning mid-market customers who still need affordable, integrated tooling.',
      why_now: 'Darktrace’s take-private and ongoing sector M&A concentrate attention on enterprise deals — leaving a servicing gap for 200–2,000-seat firms.',
      region: 'North America', country: 'United States',
      sector: 'Technology', industry: 'Cybersecurity', niche: 'Mid-market security operations',
      market_cap_band: 'mid',
      target_customers: ['mid_market'],
      maturity_stage: 'established',
      related_companies: ['DARK.L', 'RPD', 'S', 'CYBR'],
      evidence_items: [
        { kind: 'news', title: 'Darktrace acquired by Thoma Bravo in take-private deal', source_key: 'news_rss', weight: 0.5, observed_at: daysAgo(30) },
        { kind: 'filing', title: 'Rapid7 10-K notes competitive dynamics and mid-market focus', source_key: 'sec_edgar', weight: 0.9, observed_at: daysAgo(75) },
        { kind: 'news', title: 'Analysts flag consolidation wave concentrating cyber spend at the top', source_key: 'news_rss', weight: 0.5, observed_at: daysAgo(13) },
      ],
      founder_opportunity: 'Build an opinionated, integrated SecOps bundle priced and packaged for the mid-market that roll-ups are neglecting.',
      advisor_note: 'Consolidation signals are double-edged — validate that the orphaned segment is reachable and not simply unprofitable before steering a founder in.',
      build: {
        headline: 'Integrated SecOps for the neglected mid-market',
        wedge: 'Bundle detection + response + reporting for firms without a SOC team.',
        icp: 'Companies of 200–2,000 employees with 1–3 security staff.',
        gtm: 'MSP/channel-led; land via compliance reporting (SOC 2 / cyber insurance).',
        moat: 'Integration + service depth; being the single pane the mid-market trusts.',
        risks: 'Crowded category; must differentiate on packaging and price, not features.',
      },
      market: { growth_direction: 'mixed', cap_band_spread: ['mid', 'large'] },
      confidence_score: 0, freshness_score: 0,
      source_attribution: ['news_rss', 'sec_edgar'],
      tags: ['cybersecurity', 'consolidation'],
      updated_at: daysAgo(13),
    },
    {
      id: 'sig_india_insurance_distribution',
      type: 'emerging_niche_demand',
      title: 'Agent-enablement tooling for India insurance distribution',
      thesis: 'India’s insurance penetration is rising through digital marketplaces, but the vast offline agent channel lacks modern quote-to-issue and persistency tooling.',
      why_now: 'PB Fintech’s scale proves online demand, yet regulators and insurers still push agent-led distribution — a niche the pure marketplaces underserve.',
      region: 'South Asia', country: 'India',
      sector: 'Financial Services', industry: 'Insurtech', niche: 'Insurance agent enablement',
      market_cap_band: 'small',
      target_customers: ['smb', 'financial_institution'],
      maturity_stage: 'emerging',
      related_companies: ['PB'],
      evidence_items: [
        { kind: 'earnings', title: 'PB Fintech reports growth alongside continued agent-channel relevance', source_key: 'company_profile', weight: 0.8, observed_at: daysAgo(26) },
        { kind: 'news', title: 'IRDAI reforms push "insurance for all", expanding agent networks', source_key: 'news_rss', weight: 0.5, observed_at: daysAgo(10) },
        { kind: 'hiring', title: 'Insurtechs hiring for agent-app and vernacular-UX roles', source_key: 'hiring_signal', weight: 0.45, observed_at: daysAgo(18) },
      ],
      founder_opportunity: 'Build a mobile agent OS (multi-insurer quotes, KYC, issuance, renewals) with vernacular UX for tier-2/3 India agents.',
      advisor_note: 'Emerging-niche-demand signal: strong tailwind but thin comps — pressure-test unit economics of serving low-ticket agents at scale.',
      build: {
        headline: 'Agent operating system for Indian insurance distribution',
        wedge: 'Multi-insurer motor/health quotes + instant issuance in one vernacular app.',
        icp: 'Independent insurance agents and small agencies in tier-2/3 cities.',
        gtm: 'Insurer partnerships for supply; referral-led agent acquisition.',
        moat: 'Agent workflow lock-in + renewals data; distribution relationships.',
        risks: 'Low ARPU per agent; regulatory constraints on commissions and data.',
      },
      market: { growth_direction: 'accelerating', cap_band_spread: ['small', 'large'] },
      confidence_score: 0, freshness_score: 0,
      source_attribution: ['company_profile', 'news_rss', 'hiring_signal'],
      tags: ['insurtech', 'india', 'distribution'],
      updated_at: daysAgo(10),
    },
    {
      id: 'sig_professional_services_ai',
      type: 'category_creation',
      title: 'AI-native work product for professional-services firms',
      thesis: 'Software for law/accounting/advisory has been systems-of-record; AI now enables systems-of-work that draft the actual deliverable, creating a new category.',
      why_now: 'Intapp and peers are layering AI onto records, but a greenfield category — "AI associate" tools that produce first-draft work product — is still forming.',
      region: 'North America', country: 'United States',
      sector: 'Technology', industry: 'Professional Services Software', niche: 'AI work-product generation',
      market_cap_band: 'small',
      target_customers: ['enterprise', 'mid_market'],
      maturity_stage: 'emerging',
      related_companies: ['INTA'],
      evidence_items: [
        { kind: 'filing', title: 'Intapp emphasizes AI roadmap across the professional-services stack', source_key: 'sec_edgar', weight: 0.9, observed_at: daysAgo(60) },
        { kind: 'news', title: 'Law and accounting firms pilot generative-AI drafting tools', source_key: 'news_rss', weight: 0.5, observed_at: daysAgo(4) },
        { kind: 'hiring', title: 'Applied-AI and domain-expert roles rising at prof-services vendors', source_key: 'hiring_signal', weight: 0.45, observed_at: daysAgo(9) },
      ],
      founder_opportunity: 'Own one deliverable (e.g. audit workpapers, or a specific legal filing) end to end with an AI system-of-work, not a copilot bolt-on.',
      advisor_note: 'Category-creation signals carry timing risk — recommend to founders who have deep domain credibility to win trust in a regulated craft.',
      build: {
        headline: 'AI system-of-work for one professional deliverable',
        wedge: 'Automate a single, high-volume deliverable with human-in-the-loop review.',
        icp: 'Mid-size professional-services firms drowning in repetitive drafting.',
        gtm: 'Land with a champion partner; expand by deliverable type.',
        moat: 'Domain-tuned models + firm-specific templates + audit trail.',
        risks: 'Trust, liability and accuracy bars are high in regulated professions.',
      },
      market: { growth_direction: 'accelerating', cap_band_spread: ['small'] },
      confidence_score: 0, freshness_score: 0,
      source_attribution: ['sec_edgar', 'news_rss', 'hiring_signal'],
      tags: ['ai', 'legaltech', 'proserv'],
      updated_at: daysAgo(4),
    },
    {
      id: 'sig_africa_commerce_logistics',
      type: 'underserved_segment',
      title: 'Reliable last-mile logistics for African e-commerce',
      thesis: 'African e-commerce growth is throttled by fragmented, unreliable last-mile delivery — a picks-and-shovels opportunity beneath the marketplaces.',
      why_now: 'Jumia’s repeated emphasis on logistics as its moat and cost centre shows delivery is the binding constraint, not demand.',
      region: 'Sub-Saharan Africa', country: 'Nigeria',
      sector: 'Technology', industry: 'Logistics Software', niche: 'Last-mile delivery orchestration',
      market_cap_band: 'micro',
      target_customers: ['smb', 'enterprise'],
      maturity_stage: 'emerging',
      related_companies: ['JMIA'],
      evidence_items: [
        { kind: 'filing', title: 'Jumia annual report frames logistics-as-a-service as strategic', source_key: 'sec_edgar', weight: 0.9, observed_at: daysAgo(85) },
        { kind: 'news', title: 'Delivery reliability cited as top barrier to African online retail', source_key: 'news_rss', weight: 0.5, observed_at: daysAgo(14) },
      ],
      founder_opportunity: 'Build delivery-orchestration software that aggregates informal couriers with tracking, escrow and reliability scoring for merchants.',
      advisor_note: 'Underserved-segment signal with thin comps — the risk is infrastructure, not demand. Best for founders with on-the-ground operating experience.',
      build: {
        headline: 'Last-mile orchestration OS for African merchants',
        wedge: 'Aggregate informal couriers + escrow + delivery-reliability scoring.',
        icp: 'SMB online sellers and marketplaces in one metro (e.g. Lagos) first.',
        gtm: 'Merchant-led; expand corridor by corridor.',
        moat: 'Courier supply network + reliability data; cash-on-delivery escrow trust.',
        risks: 'Capital-intensive ops; informal-sector coordination is hard.',
      },
      market: { growth_direction: 'steady', cap_band_spread: ['micro'] },
      confidence_score: 0, freshness_score: 0,
      source_attribution: ['sec_edgar', 'news_rss'],
      tags: ['logistics', 'africa', 'ecommerce'],
      updated_at: daysAgo(14),
    },
    {
      id: 'sig_midcap_payments_momentum',
      type: 'midcap_momentum',
      title: 'Mid-cap payments momentum in cross-border corridors',
      thesis: 'Mid-cap cross-border payment firms are compounding volume faster than mega-cap incumbents, signalling durable demand for corridor-specific rails.',
      why_now: 'Wise, DLocal and Network International each report strong take-rate-adjusted volume growth in specific corridors the giants under-serve.',
      region: 'Europe', country: 'United Kingdom',
      sector: 'Financial Services', industry: 'Cross-border Payments', niche: 'Corridor-specific payment rails',
      market_cap_band: 'mid',
      target_customers: ['enterprise', 'smb'],
      maturity_stage: 'scaling',
      related_companies: ['WISE.L', 'DLO', 'NETW'],
      evidence_items: [
        { kind: 'earnings', title: 'Wise reports continued cross-border volume and account growth', source_key: 'company_profile', weight: 0.8, observed_at: daysAgo(22) },
        { kind: 'filing', title: 'DLocal 20-F: emerging-market corridor expansion and take rates', source_key: 'sec_edgar', weight: 0.9, observed_at: daysAgo(55) },
        { kind: 'news', title: 'MENA–Africa payment corridors highlighted as high-growth', source_key: 'news_rss', weight: 0.5, observed_at: daysAgo(8) },
      ],
      founder_opportunity: 'Pick one under-served corridor (e.g. Gulf→South Asia remittance for businesses) and build compliant, cheaper rails than the incumbents.',
      advisor_note: 'Mid-cap-momentum signals reward corridor focus. Warn founders away from "global from day one" — depth in one corridor is the whole game.',
      build: {
        headline: 'Corridor-native B2B cross-border payments',
        wedge: 'One high-friction corridor, one customer type (SMB importers) first.',
        icp: 'SMBs and mid-market firms trading in a specific corridor.',
        gtm: 'Partner with local banks/PSPs; land via trade communities.',
        moat: 'Licensing + liquidity + compliance per corridor; network of payout partners.',
        risks: 'Regulatory + treasury complexity; FX and liquidity management.',
      },
      market: { growth_direction: 'accelerating', cap_band_spread: ['mid', 'small'] },
      confidence_score: 0, freshness_score: 0,
      source_attribution: ['company_profile', 'sec_edgar', 'news_rss'],
      tags: ['payments', 'cross-border', 'fintech'],
      updated_at: daysAgo(8),
    },
  ];
}
