/**
 * Task #11 (AC-2) — Existing Founder question bank.
 *
 * For founders past the Spin-Out Lab phase: company facts, cap
 * table, financials, pipeline, compliance, capital, roadmap, and
 * mentor needs. Re-uses the AC-1 write-router for the project
 * fields; the rest are recorded by the router and deep-link to the
 * dedicated pages where the structured data lives.
 */
import { all, required, minChars, maxChars, oneOf, nonNegativeNumber, csvNonEmpty } from '../validators';

const SECTORS = ['AI', 'B2B SaaS', 'Climate', 'Fintech', 'Healthcare', 'Consumer', 'Deep Tech', 'Other'];
const STAGES = ['Idea', 'Prototype', 'Pre-seed', 'Seed', 'Series A', 'Later'];

export const EXISTING_FOUNDER_BANK = [
  // --- Company facts ---------------------------------------------------
  {
    id: 'founder.project.name',
    label: 'Confirm your company / project name.',
    type: 'short',
    explainer: 'We’ll use this on every dashboard, deck merge-field, and contract.',
    doc_anchor: 'build/projects',
    page_target: '/projects',
    validate: all(required, minChars(2), maxChars(80)),
  },
  {
    id: 'founder.project.pitch',
    label: 'One-paragraph pitch — refresh how you position yourselves today.',
    type: 'long',
    explainer: 'Replaces the project description on your portfolio card.',
    doc_anchor: 'build/projects',
    page_target: '/projects',
    validate: all(required, minChars(40)),
  },
  {
    id: 'founder.project.sector',
    label: 'Sector?',
    type: 'select',
    options: SECTORS,
    explainer: 'Drives sector-specific dashboards and investor matching.',
    doc_anchor: 'build/projects',
    page_target: '/projects',
    validate: all(required, oneOf(SECTORS)),
  },
  {
    id: 'founder.project.stage',
    label: 'Current stage?',
    type: 'select',
    options: STAGES,
    explainer: 'Stage gates the milestones and capital tools we surface.',
    doc_anchor: 'build/projects',
    page_target: '/projects',
    validate: all(required, oneOf(STAGES)),
  },
  {
    id: 'founder.project.traction',
    label: 'Latest traction — top 2-3 numbers (MRR, paid logos, growth).',
    type: 'long',
    explainer: 'Saved as growth_signals on your project — feeds the metrics dashboard.',
    doc_anchor: 'capital/metrics',
    page_target: '/build/metrics',
    validate: maxChars(800),
  },

  // --- Cap table -------------------------------------------------------
  {
    id: 'founder.captable.entity',
    label: 'Are you incorporated? If yes, what entity (e.g. Delaware C-Corp)?',
    type: 'short',
    explainer: 'If not, we’ll point you at the Legal → Incorporation flow.',
    doc_anchor: 'legal/incorporation',
    page_target: '/legal/incorporation',
    validate: all(required, maxChars(140)),
  },
  {
    id: 'founder.captable.ownership',
    label: 'Roughly, who owns the company today? (e.g. “Founders 80%, ESOP 10%, Angels 10%”)',
    type: 'long',
    explainer: 'We’ll mirror this into the cap-table simulator. Refine numbers there.',
    doc_anchor: 'capital/cap-table',
    page_target: '/build/captable',
    validate: all(required, minChars(10)),
  },

  // --- Financials ------------------------------------------------------
  {
    id: 'founder.financials.runway_months',
    label: 'How many months of runway do you have? (whole number)',
    type: 'number',
    explainer: 'Drives the runway gauge on the founder dashboard.',
    doc_anchor: 'capital/metrics',
    page_target: '/build/financials',
    validate: all(required, nonNegativeNumber),
  },
  {
    id: 'founder.financials.monthly_burn_usd',
    label: 'Monthly burn (USD).',
    type: 'number',
    explainer: 'Used by the financial model builder to estimate fundraise timing.',
    doc_anchor: 'capital/metrics',
    page_target: '/build/financials',
    validate: all(required, nonNegativeNumber),
  },
  {
    id: 'founder.financials.mrr_usd',
    label: 'Monthly recurring revenue (USD). Enter 0 if none.',
    type: 'number',
    explainer: 'Feeds MRR into your metrics + portfolio-health colour rating.',
    doc_anchor: 'capital/metrics',
    page_target: '/build/financials',
    validate: nonNegativeNumber,
  },

  // --- Pipeline --------------------------------------------------------
  {
    id: 'founder.pipeline.top_deals',
    label: 'What are your top 3 sales deals or design partners in flight?',
    type: 'long',
    explainer: 'Recorded as a pipeline note today; the full CRM-style view lives on the metrics page.',
    doc_anchor: 'capital/metrics',
    page_target: '/build/metrics',
    validate: all(required, minChars(10)),
  },

  // --- Compliance ------------------------------------------------------
  {
    id: 'founder.compliance.status',
    label: 'Compliance — anything overdue (83(b), annual filings, taxes)?',
    type: 'long',
    explainer: 'We’ll surface action items on the Compliance Calendar.',
    doc_anchor: 'legal/compliance',
    page_target: '/legal/compliance',
    validate: all(required, minChars(2)),
  },

  // --- Capital ---------------------------------------------------------
  {
    id: 'founder.capital.raise_active',
    label: 'Are you actively raising right now?',
    type: 'select',
    options: ['Yes', 'No', 'Soon'],
    explainer: 'Saying Yes opens the follow-up about target round size.',
    doc_anchor: 'capital/fundraise',
    page_target: '/capital/fundraise',
    validate: all(required, oneOf(['Yes', 'No', 'Soon'])),
    followups: (a) => (String(a).toLowerCase() === 'yes' ? ['founder.capital.raise_target_usd'] : []),
  },
  {
    id: 'founder.capital.raise_target_usd',
    label: 'How much are you raising (USD)?',
    type: 'number',
    explainer: 'Pre-fills the fundraise tracker; you can refine the round structure on the Capital page.',
    doc_anchor: 'capital/fundraise',
    page_target: '/capital/fundraise',
    validate: nonNegativeNumber,
  },

  // --- Roadmap ---------------------------------------------------------
  {
    id: 'founder.okrs.q1_objective1',
    label: 'Top objective for the next 90 days?',
    type: 'long',
    explainer: 'Lands as the first OKR row on your roadmap’s “Now” column.',
    doc_anchor: 'build/roadmap',
    page_target: '/build/roadmap',
    validate: all(required, minChars(10)),
  },
  {
    id: 'founder.okrs.q1_objective2',
    label: 'Second objective?',
    type: 'long',
    explainer: 'Second roadmap OKR — keep it scoped to a single measurable outcome.',
    doc_anchor: 'build/roadmap',
    page_target: '/build/roadmap',
    validate: all(required, minChars(10)),
  },

  // --- Mentors needed --------------------------------------------------
  {
    id: 'founder.mentors.needs',
    label: 'What expertise do you most need from a mentor right now? (comma-separated)',
    type: 'short',
    explainer: 'We’ll use this for mentor matching on the Network page.',
    doc_anchor: 'portals/mentor',
    page_target: '/network/mentors',
    validate: all(required, csvNonEmpty(1)),
  },
];

export default EXISTING_FOUNDER_BANK;
