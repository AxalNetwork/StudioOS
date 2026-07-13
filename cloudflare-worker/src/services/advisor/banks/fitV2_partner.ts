/**
 * Fit v2 — operator / operating-partner role bank (`fit.partner.v2_*`).
 * The role_context is `operator`; the id prefix stays `partner` so these ids
 * match FIT_ID_RE and ride the v1 rails (same indirection as coach → mentor
 * in v1). Shared spine + operator rubric add-ons.
 */
import type { Question } from '../questionBank.ts';
import { buildFitV2Bank, roleRubricRows, sharedFitV2Rows } from './fitV2Shared.ts';

export const FITV2_PARTNER_BANK: Question[] = buildFitV2Bank('partner', 'partner', [
  ...sharedFitV2Rows(),
  ...roleRubricRows([
    {
      category: 'reliability',
      core: 'When you commit a deliverable to a portfolio company, how reliably does it land on time?',
      second: 'How realistic is the bandwidth you promise the companies you take on?',
    },
    {
      category: 'hands_on_support',
      core: 'How willing are you to do the work alongside a founder, rather than advise from the side?',
      second: 'How well do you tailor support to where a company actually is, instead of running one playbook?',
    },
    {
      category: 'network_activation',
      core: 'How readily do you actually make the warm introduction, rather than promising it?',
      second: 'How deep and current is the network you could open for a company this quarter?',
    },
    {
      category: 'strategic_alignment',
      core: 'How closely does your own focus overlap with the kinds of companies the studio builds?',
      second: 'How comfortable are you letting the founder lead while you support from beside them?',
    },
  ]),
]);
