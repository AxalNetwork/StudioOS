/**
 * Fit v2 — founder role bank (`fit.founder.v2_*`).
 * Shared spine (context/values/archetypes/skills/validation) + founder
 * rubric add-ons. Categories mirror FIT_ROLE_TEMPLATES.founder.rubricWeights.
 */
import type { Question } from '../questionBank.ts';
import { buildFitV2Bank, roleRubricRows, sharedFitV2Rows } from './fitV2Shared.ts';

export const FITV2_FOUNDER_BANK: Question[] = buildFitV2Bank('founder', 'founder', [
  ...sharedFitV2Rows(),
  ...roleRubricRows([
    {
      category: 'vision_clarity',
      core: 'How clearly can you state, in one sentence, the future your company is trying to create?',
      second: 'How well can you explain why now is the moment for it — not five years ago, not five years from now?',
    },
    {
      category: 'execution_ability',
      core: 'Over the last month, how consistently did you turn plans into shipped, visible progress?',
      second: 'How ruthlessly do you cut good ideas to protect the one that matters most this week?',
    },
    {
      category: 'team_leadership',
      core: 'How strong is your track record of attracting people who are better than you at their craft?',
      second: 'How well do you handle a hard disagreement with a co-founder or a key early hire?',
    },
    {
      category: 'customer_insight',
      core: 'How much earned, non-obvious insight do you have about your specific customer?',
      second: 'How close are you — in real hours per week — to the people who feel the problem most acutely?',
    },
  ]),
]);
