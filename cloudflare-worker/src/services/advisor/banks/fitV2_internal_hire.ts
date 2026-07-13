/**
 * Fit v2 — internal-hire role bank (`fit.internal_hire.v2_*`).
 *
 * STAGED-ONLY: this prefix deliberately does NOT match FIT_ID_RE, so no part
 * of the v1 pipeline (fitMeasuresIndex, v1 writeRouter fit branch, v1
 * recompute triggers) ever sees these ids. Answers land in field_sources via
 * the v2 write branch and score only through fitDecision. Never appended by
 * bankFor — the persona field is inert.
 */
import type { Question } from '../questionBank.ts';
import { buildFitV2Bank, roleRubricRows, sharedFitV2Rows } from './fitV2Shared.ts';

export const FITV2_INTERNAL_HIRE_BANK: Question[] = buildFitV2Bank('internal_hire', 'unknown', [
  ...sharedFitV2Rows(),
  ...roleRubricRows([
    {
      category: 'ownership_scope',
      core: 'How fully do you take a fuzzy objective and own it to done without needing to be managed?',
      second: 'When something adjacent to your lane is broken, how instinctively do you pick it up anyway?',
    },
    {
      category: 'cadence',
      core: 'How consistently do you ship on a weekly cadence other people can plan around?',
      second: 'How well does your quality hold when the pace stays high for months?',
    },
    {
      category: 'collaboration_fit',
      core: 'How well do you operate inside a small, high-trust team where feedback is direct and immediate?',
      second: 'How readily do you surface bad news early to exactly the people who need it?',
    },
    {
      category: 'learning_speed',
      core: 'How quickly do you become dangerous in a domain you knew nothing about a month ago?',
      second: 'How visibly does your behavior change within weeks of receiving hard feedback?',
    },
  ]),
]);
