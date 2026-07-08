// Task #2 (Legal Engine v1) — shared jurisdiction catalog.
//
// Extracted verbatim from routes/legal.ts (Task #30 wizard catalogue) so the
// lightweight legal_engine sub-app can import it without dragging legal.ts's
// heavy import graph (billing → payments → queue) into the strip-types test
// loader — same isolation rationale as routes/legal_83b.ts. legal.ts
// re-imports from here; there is exactly ONE copy of this data.

export interface Jurisdiction {
  id: string;
  label: string;
  country: string;
  country_code: string;
  entity_type: string;
  summary: string;
  est_cost_usd: [number, number];
  time_to_form_days: [number, number];
  fundraising_friendly: boolean;
  atlas_supported: boolean;
  pros: string[];
  cons: string[];
  tax_summary: string;
  templates: string[];
}

export const JURISDICTIONS: Jurisdiction[] = [
  { id: 'us_de_ccorp', label: 'Delaware C-Corp', country: 'United States', country_code: 'US', entity_type: 'C Corporation', summary: 'The default for VC-backed startups.', est_cost_usd: [500, 1500], time_to_form_days: [1, 7], fundraising_friendly: true, atlas_supported: true, pros: ['Stripe Atlas one-click', 'Universally accepted by US VCs'], cons: ['21% federal corporate tax', 'Annual filings + agent'], tax_summary: '21% federal corporate income tax. DE franchise tax $400–$1,750.', templates: ['certificate_of_incorporation_de', 'bylaws', 'stock_purchase_agreement', 'section_83b'] },
  { id: 'us_de_llc', label: 'Delaware LLC', country: 'United States', country_code: 'US', entity_type: 'Limited Liability Company', summary: 'Pass-through taxation. Hard to take VC.', est_cost_usd: [300, 800], time_to_form_days: [1, 5], fundraising_friendly: false, atlas_supported: false, pros: ['Pass-through tax', 'Flexible operating agreement'], cons: ['Most VCs cannot invest in LLCs', 'Self-employment tax'], tax_summary: 'Pass-through. DE franchise tax flat $300/yr.', templates: ['operating_agreement', 'ein_application_kit', 'member_consent'] },
  { id: 'uk_ltd', label: 'UK Private Limited (Ltd)', country: 'United Kingdom', country_code: 'GB', entity_type: 'Private Limited Company', summary: 'Fast and credible for European VCs.', est_cost_usd: [50, 250], time_to_form_days: [1, 3], fundraising_friendly: true, atlas_supported: false, pros: ['£50 same-day filing', 'SEIS/EIS angel tax relief'], cons: ['US VCs may want a flip', 'Public PSC register'], tax_summary: 'Corporation tax 25% (19% small-profits up to £50k).', templates: ['uk_memorandum_of_association', 'uk_articles_of_association', 'uk_form_in01_kit'] },
  { id: 'sg_pte', label: 'Singapore Pte Ltd', country: 'Singapore', country_code: 'SG', entity_type: 'Private Limited (Pte. Ltd.)', summary: 'Asia hub. Strong rule of law, English-language filings.', est_cost_usd: [600, 1500], time_to_form_days: [1, 5], fundraising_friendly: true, atlas_supported: false, pros: ['Startup tax exemption ~75% on first S$100k', '17% headline corporate tax'], cons: ['Need SG-resident director', 'Bank account 2–4 weeks'], tax_summary: '17% corporate tax; effective ~4–8% in years 1–3.', templates: ['sg_constitution', 'sg_acra_form_45_kit', 'sg_first_directors_resolution'] },
  { id: 'ee_oy', label: 'Estonia OÜ (e-Residency)', country: 'Estonia', country_code: 'EE', entity_type: 'Osaühing (Private Limited)', summary: 'Fully remote, 0% tax on retained earnings.', est_cost_usd: [200, 500], time_to_form_days: [3, 14], fundraising_friendly: false, atlas_supported: false, pros: ['0% tax on retained earnings', '100% online incorporation'], cons: ['20% distribution tax on dividends', 'Need e-Residency first (~6–8 weeks)'], tax_summary: '0% on retained earnings. 20% distribution tax on dividends.', templates: ['ee_articles_of_association', 'ee_e_residency_application_kit', 'ee_founding_resolution'] },
];

// Titles for jurisdiction-specific formation docs (fallbacks when the D1
// legal_templates store is unavailable). Extracted from legal.ts alongside
// the catalog above.
export const JURISDICTION_TEMPLATE_TITLES: Record<string, { title: string }> = {
  certificate_of_incorporation_de: { title: 'Certificate of Incorporation (Delaware C-Corp)' },
  bylaws: { title: 'Corporate Bylaws' },
  stock_purchase_agreement: { title: "Founders' Restricted Stock Purchase Agreement" },
  section_83b: { title: 'Section 83(b) Election' },
  operating_agreement: { title: 'Operating Agreement (LLC)' },
  ein_application_kit: { title: 'IRS EIN Application Kit (Form SS-4)' },
  member_consent: { title: 'Initial Member Written Consent' },
  uk_memorandum_of_association: { title: 'Memorandum of Association (UK Ltd)' },
  uk_articles_of_association: { title: 'Articles of Association (UK Ltd) — Model Articles' },
  uk_form_in01_kit: { title: 'UK IN01 Filing Kit (Companies House)' },
  sg_constitution: { title: 'Company Constitution (Singapore Pte Ltd)' },
  sg_acra_form_45_kit: { title: 'ACRA Filing Kit — BizFile Incorporation Pack' },
  sg_first_directors_resolution: { title: "First Directors' Resolution (Singapore)" },
  ee_articles_of_association: { title: 'Articles of Association (Estonia OÜ)' },
  ee_e_residency_application_kit: { title: 'Estonia e-Residency Application Kit' },
  ee_founding_resolution: { title: 'Founding Resolution (Estonia OÜ)' },
};
