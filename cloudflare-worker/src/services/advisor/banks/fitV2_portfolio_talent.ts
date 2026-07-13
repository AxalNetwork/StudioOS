/**
 * Fit v2 — portfolio-support-talent role bank (`fit.portfolio_talent.v2_*`).
 *
 * STAGED-ONLY: prefix does not match FIT_ID_RE — invisible to the whole v1
 * pipeline by construction (see fitV2_internal_hire.ts for the mechanics).
 */
import type { Question } from '../questionBank.ts';
import { buildFitV2Bank, roleRubricRows, sharedFitV2Rows } from './fitV2Shared.ts';

export const FITV2_PORTFOLIO_TALENT_BANK: Question[] = buildFitV2Bank('portfolio_talent', 'unknown', [
  ...sharedFitV2Rows(),
  ...roleRubricRows([
    {
      category: 'engagement_reliability',
      core: 'How reliably do your engagements end with the founder getting exactly what was scoped?',
      second: 'How honestly do you size what you can actually deliver before you commit?',
    },
    {
      category: 'context_adaptation',
      core: "How quickly do you become useful inside someone else's company, stack, and culture?",
      second: "How well do you adjust your playbook to a company's actual stage rather than your favorite one?",
    },
    {
      category: 'outcome_focus',
      core: 'How consistently is your work tied to a business number the founder can watch move?',
      second: 'How willing are you to be measured on outcomes rather than activity?',
    },
    {
      category: 'founder_trust',
      core: 'How often do founders bring you back — or refer you — without being asked?',
      second: "How carefully do you handle one company's confidential context when working across several?",
    },
  ]),
]);
