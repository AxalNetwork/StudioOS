/**
 * Task #2 (AR) — Existing Founder bank.
 *
 * For founders past the Spin-Out Lab phase. Cycles through 4
 * sections: BUILD / CAPITAL / LEGAL / NETWORK. The advisor's
 * `/next-question?focus=<section>` endpoint pins to a section so the
 * founder can drill into one area at a time; otherwise rotation is
 * critical-first within each section.
 */
import type { Question } from '../questionBank';

const SECTORS = ['AI', 'B2B SaaS', 'Climate', 'Fintech', 'Healthcare', 'Consumer', 'Deep Tech', 'Other'];
const STAGES = ['Idea', 'Prototype', 'Pre-seed', 'Seed', 'Series A', 'Later'];

export const EXISTING_FOUNDER_BANK: Question[] = [
  // ---- BUILD ----------------------------------------------------------
  { id: 'founder.project.name', persona: 'founder', section: 'BUILD',
    prompt: 'Confirm your company / project name.',
    input_kind: 'short', importance: 'critical',
    page_target: '/projects', doc_anchor: 'build/projects',
    validate: 'short' },
  { id: 'founder.project.pitch', persona: 'founder', section: 'BUILD',
    prompt: 'One-paragraph pitch — refresh how you position yourselves today.',
    input_kind: 'long', importance: 'high',
    page_target: '/projects', doc_anchor: 'build/projects',
    validate: 'long' },
  { id: 'founder.project.sector', persona: 'founder', section: 'BUILD',
    prompt: 'Sector?',
    input_kind: 'select', options: SECTORS, importance: 'high',
    page_target: '/projects', doc_anchor: 'build/projects',
    validate: 'select' },
  { id: 'founder.project.stage', persona: 'founder', section: 'BUILD',
    prompt: 'Current stage?',
    input_kind: 'select', options: STAGES, importance: 'high',
    page_target: '/projects', doc_anchor: 'build/projects',
    validate: 'select' },
  { id: 'founder.project.traction', persona: 'founder', section: 'BUILD',
    prompt: 'Latest traction — top 2-3 numbers (MRR, paid logos, growth).',
    input_kind: 'long', importance: 'normal',
    page_target: '/build/metrics', doc_anchor: 'capital/metrics',
    validate: 'long', skip_allowed: true },
  { id: 'founder.okrs.q1_objective1', persona: 'founder', section: 'BUILD',
    prompt: 'Top objective for the next 90 days?',
    input_kind: 'long', importance: 'high',
    page_target: '/build/roadmap', doc_anchor: 'build/roadmap',
    validate: 'long' },
  { id: 'founder.okrs.q1_objective2', persona: 'founder', section: 'BUILD',
    prompt: 'Second objective?',
    input_kind: 'long', importance: 'normal',
    page_target: '/build/roadmap', doc_anchor: 'build/roadmap',
    validate: 'long' },
  { id: 'founder.okrs.q1_objective3', persona: 'founder', section: 'BUILD',
    prompt: 'Third objective?',
    input_kind: 'long', importance: 'normal',
    page_target: '/build/roadmap', doc_anchor: 'build/roadmap',
    validate: 'long' },

  // ---- CAPITAL --------------------------------------------------------
  { id: 'founder.financials.runway_months', persona: 'founder', section: 'CAPITAL',
    prompt: 'How many months of runway do you have? (whole number)',
    input_kind: 'number', importance: 'critical',
    page_target: '/build/financials', doc_anchor: 'capital/metrics',
    validate: 'number', requires_evidence: true },
  { id: 'founder.financials.monthly_burn_usd', persona: 'founder', section: 'CAPITAL',
    prompt: 'Monthly burn (USD).',
    input_kind: 'number', importance: 'critical',
    page_target: '/build/financials', doc_anchor: 'capital/metrics',
    validate: 'number', requires_evidence: true },
  { id: 'founder.financials.mrr_usd', persona: 'founder', section: 'CAPITAL',
    prompt: 'Monthly recurring revenue (USD). Enter 0 if none.',
    input_kind: 'number', importance: 'high',
    page_target: '/build/financials', doc_anchor: 'capital/metrics',
    validate: 'number', requires_evidence: true },
  { id: 'founder.pipeline.top_deals', persona: 'founder', section: 'CAPITAL',
    prompt: 'What are your top 3 sales deals or design partners in flight?',
    input_kind: 'long', importance: 'normal',
    page_target: '/build/metrics', doc_anchor: 'capital/metrics',
    validate: 'long' },
  { id: 'founder.capital.raise_active', persona: 'founder', section: 'CAPITAL',
    prompt: 'Are you actively raising right now?',
    input_kind: 'select', options: ['Yes', 'No', 'Soon'], importance: 'high',
    page_target: '/capital/fundraise', doc_anchor: 'capital/fundraise',
    validate: 'select' },
  { id: 'founder.capital.raise_target_usd', persona: 'founder', section: 'CAPITAL',
    prompt: 'How much are you raising (USD)?',
    input_kind: 'number', importance: 'high',
    page_target: '/capital/fundraise', doc_anchor: 'capital/fundraise',
    validate: 'number', skip_allowed: true, requires_evidence: true },

  // ---- LEGAL ----------------------------------------------------------
  { id: 'founder.captable.entity', persona: 'founder', section: 'LEGAL',
    prompt: 'Are you incorporated? If yes, what entity (e.g. Delaware C-Corp)?',
    input_kind: 'short', importance: 'critical',
    page_target: '/legal/incorporation', doc_anchor: 'legal/incorporation',
    validate: 'short' },
  { id: 'founder.captable.ownership', persona: 'founder', section: 'LEGAL',
    prompt: 'Roughly, who owns the company today? (e.g. "Founders 80%, ESOP 10%, Angels 10%")',
    input_kind: 'long', importance: 'high',
    page_target: '/build/captable', doc_anchor: 'capital/cap-table',
    validate: 'long' },
  { id: 'founder.compliance.status', persona: 'founder', section: 'LEGAL',
    prompt: 'Compliance — anything overdue (83(b), annual filings, taxes)?',
    input_kind: 'long', importance: 'high',
    page_target: '/legal/compliance', doc_anchor: 'legal/compliance',
    validate: 'long' },

  // ---- NETWORK --------------------------------------------------------
  { id: 'founder.mentors.needs', persona: 'founder', section: 'NETWORK',
    prompt: 'What expertise do you most need from a mentor right now? (comma-separated)',
    input_kind: 'short', importance: 'high',
    page_target: '/mentors', doc_anchor: 'portals/mentor',
    validate: 'csv' },
  { id: 'founder.team.cofounders', persona: 'founder', section: 'NETWORK',
    prompt: 'Solo or co-founders? (comma-separated names)',
    input_kind: 'short', importance: 'normal',
    page_target: '/cofounder-match', doc_anchor: 'getting-started/invite-team',
    validate: 'short', skip_allowed: true },
];

export default EXISTING_FOUNDER_BANK;
