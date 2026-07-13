/**
 * Fit v2 — advisor role bank (`fit.advisor.v2_*`).
 * Shared spine + advisor rubric add-ons (FIT_ROLE_TEMPLATES.advisor).
 */
import type { Question } from '../questionBank.ts';
import { buildFitV2Bank, roleRubricRows, sharedFitV2Rows } from './fitV2Shared.ts';

export const FITV2_ADVISOR_BANK: Question[] = buildFitV2Bank('advisor', 'advisor', [
  ...sharedFitV2Rows(),
  ...roleRubricRows([
    {
      category: 'teaching_ability',
      core: 'How consistently do founders leave your sessions with something concrete they can act on?',
      second: 'How effectively do you turn one-off answers into frameworks founders can reuse without you?',
    },
    {
      category: 'listening',
      core: 'How often do you ask questions to understand before offering your view?',
      second: 'How well do you hear what a founder is not saying, not just their words?',
    },
    {
      category: 'reliability',
      core: 'How reliably do you show up prepared for the commitments you make to founders?',
      second: 'How dependable is the cadence you keep with the people you advise?',
    },
    {
      category: 'founder_empathy',
      core: 'How well do you understand the emotional reality of building — not just the tactics?',
      second: 'How attuned are you to when a founder needs support versus a push?',
    },
  ]),
]);
