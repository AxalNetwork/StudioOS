/**
 * Task #2 (AR) — Operating Partner bank.
 *
 * Demand-supply sequencing: firm + role → services offered (supply
 * side) → deal interest + channels (demand side) → conflicts →
 * quarterly focus.
 */
import type { Question } from '../questionBank';

const ROLES = ['Investor', 'Service Provider', 'Mentor / Advisor', 'Strategic Partner', 'Other'];

export const OPERATING_PARTNER_BANK: Question[] = [
  { id: 'partner.firm.name', persona: 'partner', section: 'FIRM',
    prompt: 'Which firm or organization are you with?',
    input_kind: 'short', importance: 'critical',
    page_target: '/partner-portal', doc_anchor: 'network/partners',
    validate: 'short' },
  { id: 'partner.role.kind', persona: 'partner', section: 'FIRM',
    prompt: 'Which role best describes your partnership with the studio?',
    input_kind: 'select', options: ROLES, importance: 'critical',
    page_target: '/partner-portal', doc_anchor: 'network/partners',
    validate: 'select' },
  { id: 'partner.services.offered', persona: 'partner', section: 'SUPPLY',
    prompt: 'What do you bring to portfolio companies? (comma-separated services)',
    input_kind: 'short', importance: 'high',
    page_target: '/partner-portal', doc_anchor: 'network/partners',
    validate: 'csv' },
  { id: 'partner.deals.interest', persona: 'partner', section: 'DEMAND',
    prompt: 'What kinds of deals or projects most interest you?',
    input_kind: 'long', importance: 'high',
    page_target: '/partner-portal', doc_anchor: 'network/partners',
    validate: 'long' },
  { id: 'partner.dealflow.channels', persona: 'partner', section: 'DEMAND',
    prompt: 'Where does your deal flow come from today? (comma-separated)',
    input_kind: 'short', importance: 'normal',
    page_target: '/partner-portal', doc_anchor: 'network/effects',
    validate: 'csv' },
  { id: 'partner.conflicts.list', persona: 'partner', section: 'CONFLICTS',
    prompt: 'Any conflicts of interest we should know about? (companies / sectors to avoid)',
    input_kind: 'long', importance: 'high',
    page_target: '/partner-portal', doc_anchor: 'network/partners',
    validate: 'long', skip_allowed: true },
  { id: 'partner.profile.focus', persona: 'partner', section: 'FOCUS',
    prompt: 'What slice of the studio do you want to focus on this quarter?',
    input_kind: 'long', importance: 'normal',
    page_target: '/partner-portal', doc_anchor: 'network/partners',
    validate: 'long', skip_allowed: true },
];

export default OPERATING_PARTNER_BANK;
