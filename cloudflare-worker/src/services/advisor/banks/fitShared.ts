/**
 * Task #19 — Best-Fit. Shared builder for the conversational fit banks.
 *
 * Each fit bank delivers behavioral 0–5 `scale` questions, one per turn, inside
 * the Personal Advisor (human tone, "no wrong answers"). Question ids follow
 * `fit.<FitPersona>.<key>`; `fitMeasuresIndex()` parses the persona from that
 * prefix (NOT from `Question.persona`) so the coach bank can ride inside the
 * advisor conversation. Each question is tagged with a `measures` map consumed by
 * services/axalFit.ts (rubric_category / axal_value / red_flag) and the
 * write-router (skill_axis → user_skills, value_dim → user_values,
 * axal_value → axal_values).
 *
 * These banks are registered in questionBank.ts BANKS (so `bankFor`,
 * `questionById`, and `fitMeasuresIndex` see them) but are deliberately kept out
 * of the generated `banks.manifest.json` / questionIds.gen.ts: fit answers are
 * routed by a generic `fit.*` branch in the write-router, not per-id, so they
 * don't need manifest coverage. Importance is `low` so they trail the persona's
 * onboarding questions without disturbing the existing ranking / anti-repeat.
 */
import type { Question, FitMeasures, FitPersona } from '../questionBank.ts';

const SCALE_HINT = 'No wrong answers — rate 0 (not at all) to 5 (completely).';

export interface FitRowSpec {
  key: string;
  prompt: string;
  hint?: string;
  measures: FitMeasures;
}

/**
 * Build a persona fit bank. `Question.persona` is the advisor persona enum, so
 * the coach bank (no advisor role) is delivered as `advisor`; the FitPersona is
 * preserved in the `fit.<persona>.` id prefix.
 */
export function buildFitBank(persona: FitPersona, rows: FitRowSpec[]): Question[] {
  const qPersona: Question['persona'] = persona === 'coach' ? 'advisor' : persona;
  return rows.map((r) => ({
    id: `fit.${persona}.${r.key}`,
    persona: qPersona,
    section: 'FIT',
    prompt: r.prompt,
    hint: r.hint ?? SCALE_HINT,
    input_kind: 'scale',
    validate: 'scale',
    importance: 'low',
    skip_allowed: true,
    page_target: '/dashboard',
    doc_anchor: 'getting-started/personas',
    measures: r.measures,
  }));
}

/**
 * Task #45 — Archetype trait probes, asked of every persona. Four generic
 * behavioural leanings (builder / visionary / connector / operator) that the
 * nearest-centroid classifier in services/archetypeScoring.ts maps to a
 * role-specific archetype. Kept generic so every bank shares one compact,
 * diagnostic set — the archetype module only needs 3 of the 4 answered to
 * classify confidently, so this is deliberately small, not a survey.
 */
export function archetypeTraitRows(): FitRowSpec[] {
  return [
    {
      key: 'arch_builder',
      prompt: 'How much do you gravitate to hands-on making — building the thing yourself rather than directing from above?',
      hint: '0 = I direct and delegate, 5 = I love being hands-on in the work.',
      measures: { archetype_trait: 'builder' },
    },
    {
      key: 'arch_visionary',
      prompt: 'How much of your energy goes to the long-range picture and narrative versus the immediate task in front of you?',
      hint: '0 = focused on the next task, 5 = focused on the long-range vision.',
      measures: { archetype_trait: 'visionary' },
    },
    {
      key: 'arch_connector',
      prompt: 'How central are people and relationships to how you create value — do you win mostly through your network?',
      hint: '0 = I work mostly solo, 5 = I create value mostly through people.',
      measures: { archetype_trait: 'connector' },
    },
    {
      key: 'arch_operator',
      prompt: 'How much do you rely on process, systems, and discipline rather than improvising as you go?',
      hint: '0 = I improvise, 5 = I run on process and systems.',
      measures: { archetype_trait: 'operator' },
    },
  ];
}

/**
 * The Axal behavioral values, asked of every persona. Three carry a red-flag
 * probe that fires when the self-rating is at or below the threshold.
 *
 * Task #19 (Fit & Values v2) — a 6th value, `ambition`, is appended below. It is
 * additive: v1 scoring (services/axalFit.ts AXAL_VALUES = 5) ignores it, while
 * the v2 decision engine (services/fitV2Decision.ts) reads all 6. Because every
 * persona bank calls this helper, `ambition` is measured for every account type
 * with a single edit — no per-bank change needed.
 */
export function axalValueRows(): FitRowSpec[] {
  return [
    {
      key: 'axal_integrity',
      prompt: 'When something goes wrong on your watch, how fully do you own it instead of pointing to circumstances or other people?',
      measures: { axal_value: 'integrity', red_flag: { key: 'blame_shifting', at_or_below: 1 } },
    },
    {
      key: 'axal_stewardship',
      prompt: "How much do you treat other people's money, time, and trust as something to protect rather than something to spend?",
      measures: { axal_value: 'stewardship', red_flag: { key: 'transactional', at_or_below: 1 } },
    },
    {
      key: 'axal_curiosity',
      prompt: 'How actively do you go looking for evidence that you might be wrong?',
      measures: { axal_value: 'curiosity' },
    },
    {
      key: 'axal_resilience',
      prompt: 'After a genuine setback, how quickly do you recover and get execution moving again?',
      measures: { axal_value: 'resilience' },
    },
    {
      key: 'axal_collaboration',
      prompt: 'How readily do you share credit and put the mission ahead of being the one who is right?',
      measures: { axal_value: 'collaboration', red_flag: { key: 'ego_over_collaboration', at_or_below: 1 } },
    },
    // Task #19 (Fit & Values v2) — 6th Axal value. Drive/ambition to build
    // something enduringly significant. Read only by services/fitV2Decision.ts.
    {
      key: 'axal_ambition',
      prompt: 'How driven are you to build something genuinely significant — not just comfortable, but lasting and consequential?',
      measures: { axal_value: 'ambition' },
    },
  ];
}
