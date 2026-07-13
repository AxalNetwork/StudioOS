/**
 * Fit v2 — investor role bank (`fit.investor.v2_*`).
 * Shared spine + investor rubric add-ons (FIT_ROLE_TEMPLATES.investor).
 */
import type { Question } from '../questionBank.ts';
import { buildFitV2Bank, roleRubricRows, sharedFitV2Rows } from './fitV2Shared.ts';

export const FITV2_INVESTOR_BANK: Question[] = buildFitV2Bank('investor', 'investor', [
  ...sharedFitV2Rows(),
  ...roleRubricRows([
    {
      category: 'thesis_quality',
      core: 'How sharply defined is the thesis you invest against — the kind of company you back over and over?',
      second: 'How willing are you to lead a round on conviction before the rest of the market agrees?',
    },
    {
      category: 'judgment_consistency',
      core: 'How consistent are the reasons you give for a decision before and after the outcome is known?',
      second: 'How rigorous does your diligence stay when you already like the deal?',
    },
    {
      category: 'founder_support',
      core: 'How much real value do you add between board meetings — not just at them?',
      second: 'How well do you let founders run their company while staying genuinely useful?',
    },
    {
      category: 'reputation',
      core: 'If a founder called three people you backed whose companies struggled, how strong would your reference be?',
      second: 'How consistently do you behave well when a deal goes sideways and incentives get tense?',
    },
  ]),
]);
