/**
 * Task #11 (AC-2) — Partner question bank.
 *
 * Partner profile is owned by the partner-onboarding wizard
 * (Task #9, X-2). To avoid double-prompting, the AC-1 write-router
 * intentionally NOOPs partner-bank answers — the chat client
 * (AC-3) renders the answer back as an ambient note and deep-links
 * to the Partner Portal so the binding partner_profiles row is
 * filled there with full validation.
 *
 * The single id the router does persist is `partner.profile.focus`,
 * which is the original AC-1 seed and lands as a noop note today;
 * AC-3 will surface it on the Partner Portal as a “quarterly focus”
 * banner.
 */
import { all, required, minChars, maxChars, csvNonEmpty, oneOf, nonNegativeNumber } from '../validators';

const ROLES = ['Investor', 'Service Provider', 'Mentor / Advisor', 'Strategic Partner', 'Other'];
const SERVICES = ['Capital', 'Engineering', 'Design', 'Legal', 'Sales / GTM', 'Marketing', 'Recruiting', 'Operations', 'Other'];
// Cash / Equity / Hybrid are the three core comp models from the
// task spec; `Pro Bono` is an intentional fourth bucket so partners
// who don't charge can still answer (and the histogram shows the
// genuine compensation mix instead of forcing them into "Cash").
const COMP_MODELS = ['Cash', 'Equity', 'Hybrid', 'Pro Bono'];

export const PARTNER_BANK = [
  // --- Firm ------------------------------------------------------------
  {
    id: 'partner.firm.name',
    label: 'Which firm or organization are you with?',
    type: 'short',
    explainer: 'Used on your partner portal card and any deal-flow attribution.',
    doc_anchor: 'network/partners',
    page_target: '/partner-portal',
    validate: all(required, minChars(2), maxChars(140)),
  },

  // --- Role ------------------------------------------------------------
  {
    id: 'partner.role.kind',
    label: 'Which role best describes your partnership with the studio?',
    type: 'select',
    options: ROLES,
    explainer: 'Determines which Partner Portal tabs and tools are surfaced to you.',
    doc_anchor: 'network/partners',
    page_target: '/partner-portal',
    validate: all(required, oneOf(ROLES)),
  },

  // --- Services or capital --------------------------------------------
  {
    id: 'partner.services.offered',
    label: 'What do you bring to portfolio companies? (comma-separated)',
    type: 'short',
    explainer: `Pick from: ${SERVICES.join(', ')}. Multiple OK.`,
    doc_anchor: 'network/partners',
    page_target: '/partner-portal',
    validate: all(required, csvNonEmpty(1)),
  },

  // --- Deal-type interest ---------------------------------------------
  {
    id: 'partner.deals.interest',
    label: 'What kinds of deals or projects most interest you?',
    type: 'long',
    explainer: 'Free-text — used by studio partners to route inbound to you.',
    doc_anchor: 'network/partners',
    page_target: '/partner-portal',
    validate: all(required, minChars(15), maxChars(500)),
  },

  // --- Conflicts -------------------------------------------------------
  {
    id: 'partner.conflicts.list',
    label: 'Any conflicts of interest we should know about? (companies / sectors to avoid)',
    type: 'long',
    explainer: 'Optional but strongly recommended — keeps the deal-flow surface honest.',
    doc_anchor: 'network/partners',
    page_target: '/partner-portal',
    validate: maxChars(800),
  },

  // --- Deal-flow channels ---------------------------------------------
  {
    id: 'partner.dealflow.channels',
    label: 'Where does your deal flow come from today? (comma-separated)',
    type: 'short',
    explainer: 'e.g. Inbound, Network, Accelerators, Conferences',
    doc_anchor: 'network/effects',
    page_target: '/partner-portal',
    validate: all(required, csvNonEmpty(1)),
  },

  // --- Quarterly focus (legacy AC-1 seed) -----------------------------
  {
    id: 'partner.profile.focus',
    label: 'What slice of the studio do you want to focus on this quarter?',
    type: 'long',
    explainer: 'Shown as a quarterly-focus banner on the Partner Portal.',
    doc_anchor: 'network/partners',
    page_target: '/partner-portal',
    validate: maxChars(500),
  },

  // --- Compensation: rate-card & comp model ---------------------------
  // These three questions feed Marketplace Pulse rate-card medians and
  // the comp-model donut on the Market Intel page. Answers are
  // anonymised and aggregated with k≥5 suppression — the partner's
  // identity never appears in the output. Asked AFTER `partner.services.offered`
  // because the rate-card extractor uses the most recent services answer
  // to derive the topic (skill) the rate is bucketed under.
  {
    id: 'partner.rate.hourly',
    label: 'What is your typical hourly rate in USD? (Enter a number, e.g. 250)',
    type: 'short',
    explainer: 'Aggregated anonymously into the Marketplace Pulse rate-card medians (k≥5 suppression).',
    doc_anchor: 'network/partners',
    page_target: '/partner-portal',
    validate: all(required, nonNegativeNumber),
  },
  {
    id: 'partner.rate.project',
    label: 'What is your typical per-project rate in USD? (Optional — enter 0 if you only do hourly.)',
    type: 'short',
    explainer: 'Used alongside hourly rates in the anonymised marketplace pulse.',
    doc_anchor: 'network/partners',
    page_target: '/partner-portal',
    validate: nonNegativeNumber,
  },
  {
    id: 'partner.comp.model',
    label: 'How are you typically compensated for partner work?',
    type: 'select',
    options: COMP_MODELS,
    explainer: 'Aggregated into the comp-model distribution donut on Marketplace Pulse.',
    doc_anchor: 'network/partners',
    page_target: '/partner-portal',
    validate: all(required, oneOf(COMP_MODELS)),
  },
];

export default PARTNER_BANK;
