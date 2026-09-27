/**
 * Task #19 — Best-Fit. Shared builder for the conversational fit banks.
 *
 * Each fit bank delivers behavioral 0–5 `scale` questions (plus one select for
 * illustration sex), one per turn, inside the Personal Advisor (human tone, "no
 * wrong answers"). Question ids follow
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
import type { Question, FitMeasures, FitPersona, Importance, ValidateKind } from '../questionBank.ts';
import { ARCHETYPE_PRESENTATION_OPTIONS } from '../../archetypePresentation.ts';

const SCALE_HINT = 'No wrong answers — rate 0 (not at all) to 5 (completely).';

export interface FitRowSpec {
  key: string;
  prompt: string;
  hint?: string;
  measures: FitMeasures;
  input_kind?: Question['input_kind'];
  options?: string[];
  validate?: ValidateKind;
  importance?: Importance;
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
    input_kind: r.input_kind ?? 'scale',
    options: r.options,
    validate: r.validate ?? (r.input_kind === 'select' ? 'select' : 'scale'),
    importance: r.importance ?? 'low',
    skip_allowed: true,
    page_target: '/dashboard',
    doc_anchor: 'getting-started/personas',
    measures: r.measures,
  }));
}

/**
 * Task #45 — Archetype trait probes, asked of every persona. Five angles on
 * each of the four behavioural leanings (builder / visionary / connector /
 * operator) that the nearest-centroid classifier in services/archetypeScoring.ts
 * maps to a role-specific archetype. Extra probes per axis average together, so
 * a single noisy self-rating cannot swing the classification. Adaptive
 * selection still stops once the module floor is met — this is headroom, not a
 * forced survey.
 */
export function archetypeTraitRows(): FitRowSpec[] {
  return [
    // ---- builder (5) ------------------------------------------------------
    {
      key: 'arch_builder',
      prompt: 'How much do you gravitate to hands-on making — building the thing yourself rather than directing from above?',
      hint: '0 = I direct and delegate, 5 = I love being hands-on in the work.',
      measures: { archetype_trait: 'builder' },
    },
    {
      key: 'arch_builder_fix',
      prompt: 'When something is broken, how often do you fix it yourself before handing it off?',
      hint: '0 = I assign it immediately, 5 = I get my hands on it first.',
      measures: { archetype_trait: 'builder' },
    },
    {
      key: 'arch_builder_craft',
      prompt: 'How much of your credibility comes from having made the thing with your own hands?',
      hint: '0 = my credibility is direction and judgment, 5 = it is craft I have personally done.',
      measures: { archetype_trait: 'builder' },
    },
    {
      key: 'arch_builder_ship',
      prompt: 'In a typical week, how often do you personally ship something tangible — a prototype, a page, a model, a close?',
      hint: '0 = almost never, 5 = that is a normal week for me.',
      measures: { archetype_trait: 'builder' },
    },
    {
      key: 'arch_builder_first',
      prompt: 'When a first version is needed, how likely are you to build it yourself rather than specify it for someone else?',
      hint: '0 = I write the spec and hand it off, 5 = I make the first version.',
      measures: { archetype_trait: 'builder' },
    },
    // ---- visionary (5) ----------------------------------------------------
    {
      key: 'arch_visionary',
      prompt: 'How much of your energy goes to the long-range picture and narrative versus the immediate task in front of you?',
      hint: '0 = focused on the next task, 5 = focused on the long-range vision.',
      measures: { archetype_trait: 'visionary' },
    },
    {
      key: 'arch_visionary_pull',
      prompt: 'How strongly do you pull people toward a future that is not fully specified yet?',
      hint: '0 = I wait until the plan is concrete, 5 = I recruit to a picture that is still forming.',
      measures: { archetype_trait: 'visionary' },
    },
    {
      key: 'arch_visionary_bet',
      prompt: 'How often do you choose the bigger story over the safer next step?',
      hint: '0 = I take the safer increment, 5 = I bet on the larger narrative.',
      measures: { archetype_trait: 'visionary' },
    },
    {
      key: 'arch_visionary_horizon',
      prompt: 'How far out do you naturally plan — years and categories, or this week’s list?',
      hint: '0 = this week’s list, 5 = years and categories.',
      measures: { archetype_trait: 'visionary' },
    },
    {
      key: 'arch_visionary_story',
      prompt: 'How much of your influence comes from the story you tell about where this is going?',
      hint: '0 = influence comes from the work itself, 5 = the story is a core instrument.',
      measures: { archetype_trait: 'visionary' },
    },
    // ---- connector (5) ----------------------------------------------------
    {
      key: 'arch_connector',
      prompt: 'How central are people and relationships to how you create value — do you win mostly through your network?',
      hint: '0 = I work mostly solo, 5 = I create value mostly through people.',
      measures: { archetype_trait: 'connector' },
    },
    {
      key: 'arch_connector_doors',
      prompt: 'How naturally do you open doors, make introductions, and bring the right people together?',
      hint: '0 = that is not how I work, 5 = that is a core move of mine.',
      measures: { archetype_trait: 'connector' },
    },
    {
      key: 'arch_connector_first_call',
      prompt: 'When you are stuck, how often is your first move to call someone rather than sit with the problem alone?',
      hint: '0 = I sit with it myself, 5 = I reach for a person first.',
      measures: { archetype_trait: 'connector' },
    },
    {
      key: 'arch_connector_rooms',
      prompt: 'How energized are you by rooms of people versus deep solo work?',
      hint: '0 = solo work is where I come alive, 5 = rooms of people are where I come alive.',
      measures: { archetype_trait: 'connector' },
    },
    {
      key: 'arch_connector_trust',
      prompt: 'How quickly do you turn a new relationship into a working alliance?',
      hint: '0 = slowly, if at all, 5 = that is a native move.',
      measures: { archetype_trait: 'connector' },
    },
    // ---- operator (5) -----------------------------------------------------
    {
      key: 'arch_operator',
      prompt: 'How much do you rely on process, systems, and discipline rather than improvising as you go?',
      hint: '0 = I improvise, 5 = I run on process and systems.',
      measures: { archetype_trait: 'operator' },
    },
    {
      key: 'arch_operator_cadence',
      prompt: 'How much do you insist on cadence, checklists, and clear owners so the work runs without heroics?',
      hint: '0 = I am fine with heroics, 5 = I install cadence so heroics are rare.',
      measures: { archetype_trait: 'operator' },
    },
    {
      key: 'arch_operator_gap',
      prompt: 'How strongly do you feel the need to install a process when one is missing?',
      hint: '0 = missing process does not bother me, 5 = I cannot leave a gap un-systemed.',
      measures: { archetype_trait: 'operator' },
    },
    {
      key: 'arch_operator_owners',
      prompt: 'How strongly do you assign a named owner and a next date before a task feels real?',
      hint: '0 = informal is fine, 5 = it is not real until someone owns it and a date exists.',
      measures: { archetype_trait: 'operator' },
    },
    {
      key: 'arch_operator_repeat',
      prompt: 'How quickly do you turn a one-off win into a repeatable playbook?',
      hint: '0 = I will reinvent it next time, 5 = I write it down before I forget.',
      measures: { archetype_trait: 'operator' },
    },
  ];
}

/**
 * Illustration sex for the archetype sprite. Select, not a 0–5 scale — the
 * write-router stores `m` / `f` / `both` on user_settings.archetype_sex.
 * Counted in the Archetype profiling module so it is asked with the trait
 * probes, but it does not load a trait axis.
 */
export function archetypePresentationRow(): FitRowSpec {
  return {
    key: 'arch_illustration',
    prompt: 'Your archetype is drawn as a pixel-art character. Should we draw you as a man or a woman?',
    hint: 'This only chooses the illustration — you can change it any time in Settings → Profile details.',
    input_kind: 'select',
    options: [...ARCHETYPE_PRESENTATION_OPTIONS],
    validate: 'select',
    measures: { archetype_presentation: true },
  };
}

/**
 * Role-flavoured situational probes — two per distinctive lean of that
 * persona's four archetypes. Still tagged with a single shared trait so they
 * average into the same centroid space as the generic probes.
 */
export function archetypePersonaRows(persona: FitPersona): FitRowSpec[] {
  switch (persona) {
    case 'founder':
      return [
        {
          key: 'arch_fo_independent',
          prompt: 'How independently do you make the call even when the room disagrees?',
          hint: '0 = I wait for consensus, 5 = I will take the unpopular call.',
          measures: { archetype_trait: 'builder' },
        },
        {
          key: 'arch_fo_playbook',
          prompt: 'How much do you prefer inventing the path over following a known playbook?',
          hint: '0 = I want a proven playbook, 5 = I would rather invent the path.',
          measures: { archetype_trait: 'builder' },
        },
        {
          key: 'arch_fo_breakout',
          prompt: 'How willing are you to move faster than the process can keep up, if it gets you a breakout?',
          hint: '0 = process first, 5 = breakout first.',
          measures: { archetype_trait: 'visionary' },
        },
        {
          key: 'arch_fo_raise',
          prompt: 'How comfortable are you raising big and moving first, even before the system is ready?',
          hint: '0 = foundations first, 5 = raise and move first.',
          measures: { archetype_trait: 'visionary' },
        },
        {
          key: 'arch_fo_mission_pull',
          prompt: 'How much do you convert people by making them feel the mission, not just the product?',
          hint: '0 = the product does the converting, 5 = the mission does.',
          measures: { archetype_trait: 'connector' },
        },
        {
          key: 'arch_fo_conviction',
          prompt: 'How tightly do you hold the mission when a faster commercial path appears?',
          hint: '0 = I take the commercial path, 5 = the mission holds.',
          measures: { archetype_trait: 'connector' },
        },
        {
          key: 'arch_fo_systems',
          prompt: 'How much of your week is spent installing systems that still work when you are not in the room?',
          hint: '0 = almost none, 5 = that is a large part of how I build.',
          measures: { archetype_trait: 'operator' },
        },
        {
          key: 'arch_fo_quality',
          prompt: 'How unwilling are you to ship below your quality bar, even if waiting costs a window?',
          hint: '0 = ship and iterate, 5 = the bar holds even if we wait.',
          measures: { archetype_trait: 'operator' },
        },
      ];
    case 'investor':
      return [
        {
          key: 'arch_inv_sleeves',
          prompt: 'How often do you roll up your sleeves beside a founder rather than staying at board altitude?',
          hint: '0 = board altitude, 5 = in the work with them.',
          measures: { archetype_trait: 'builder' },
        },
        {
          key: 'arch_inv_product',
          prompt: 'How often are you in the product, GTM, or hiring work with a founder after the cheque?',
          hint: '0 = rarely, 5 = that is a normal week.',
          measures: { archetype_trait: 'builder' },
        },
        {
          key: 'arch_inv_thesis',
          prompt: 'How much do you invest from a written thesis rather than from who is in the room?',
          hint: '0 = relationships lead, 5 = the thesis leads.',
          measures: { archetype_trait: 'visionary' },
        },
        {
          key: 'arch_inv_lead',
          prompt: 'How often do you lead a round on conviction before the crowd agrees?',
          hint: '0 = I wait for consensus, 5 = I lead before the crowd.',
          measures: { archetype_trait: 'visionary' },
        },
        {
          key: 'arch_inv_doors',
          prompt: 'How much of your value after the cheque is opening doors and compounding relationships?',
          hint: '0 = the cheque is the value, 5 = the network is the value.',
          measures: { archetype_trait: 'connector' },
        },
        {
          key: 'arch_inv_reputation',
          prompt: 'How much of a founder’s reason to take your cheque is the rooms and reputation you bring?',
          hint: '0 = not the reason, 5 = that is a primary reason.',
          measures: { archetype_trait: 'connector' },
        },
        {
          key: 'arch_inv_process',
          prompt: 'How strictly do you stick to allocation process even when a deal is exciting?',
          hint: '0 = excitement can override process, 5 = process holds.',
          measures: { archetype_trait: 'operator' },
        },
        {
          key: 'arch_inv_diligence',
          prompt: 'How much of your edge is repeatable diligence rather than access or instinct?',
          hint: '0 = access and instinct, 5 = repeatable diligence.',
          measures: { archetype_trait: 'operator' },
        },
      ];
    case 'partner':
      return [
        {
          key: 'arch_pt_trenches',
          prompt: 'How much of your work happens in the trenches, delivering, not just talking?',
          hint: '0 = I advise, 5 = I deliver beside them.',
          measures: { archetype_trait: 'builder' },
        },
        {
          key: 'arch_pt_hours',
          prompt: 'How much of your value is hours of doing, not frameworks?',
          hint: '0 = frameworks, 5 = hours of doing.',
          measures: { archetype_trait: 'builder' },
        },
        {
          key: 'arch_pt_momentum',
          prompt: 'How much do you turn early momentum into a growth motion rather than a one-off win?',
          hint: '0 = I land the win, 5 = I install the motion.',
          measures: { archetype_trait: 'visionary' },
        },
        {
          key: 'arch_pt_scale',
          prompt: 'How strongly do you push a company from traction into a growth motion?',
          hint: '0 = I wait until they ask, 5 = I push when traction is real.',
          measures: { archetype_trait: 'visionary' },
        },
        {
          key: 'arch_pt_people',
          prompt: 'How much of your impact is lining up the right people to a plan?',
          hint: '0 = I do the work myself, 5 = I align the right people.',
          measures: { archetype_trait: 'connector' },
        },
        {
          key: 'arch_pt_broker',
          prompt: 'How much of your week is brokering alignment across organizations?',
          hint: '0 = almost none, 5 = that is the core of the week.',
          measures: { archetype_trait: 'connector' },
        },
        {
          key: 'arch_pt_machinery',
          prompt: 'How much of what you leave behind is durable machinery, not a one-off win?',
          hint: '0 = a win for this week, 5 = machinery that outlasts the engagement.',
          measures: { archetype_trait: 'operator' },
        },
        {
          key: 'arch_pt_process_leave',
          prompt: 'How much do you refuse to leave until a process exists that does not need you?',
          hint: '0 = I leave when the win lands, 5 = I leave when the system runs.',
          measures: { archetype_trait: 'operator' },
        },
      ];
    case 'advisor':
    case 'coach':
      return [
        {
          key: 'arch_mt_craft',
          prompt: 'How much of what you share is deep craft you have personally mastered?',
          hint: '0 = I mostly hold space and ask, 5 = I teach a craft I have done.',
          measures: { archetype_trait: 'builder' },
        },
        {
          key: 'arch_mt_demo',
          prompt: 'How often do you teach by demonstrating the craft in the work, not by telling?',
          hint: '0 = I tell, 5 = I demonstrate in the work.',
          measures: { archetype_trait: 'builder' },
        },
        {
          key: 'arch_mt_perspective',
          prompt: 'How much of your value is perspective and judgment at the hard moments, not hours of doing?',
          hint: '0 = I do the hours, 5 = I bring judgment when it counts.',
          measures: { archetype_trait: 'visionary' },
        },
        {
          key: 'arch_mt_altitude',
          prompt: 'How often is your best move a high-altitude reframe rather than a tactic for this week?',
          hint: '0 = this week’s tactic, 5 = a reframe of the decade.',
          measures: { archetype_trait: 'visionary' },
        },
        {
          key: 'arch_mt_beside',
          prompt: 'How much do you coach session by session, beside the person, rather than from a distance?',
          hint: '0 = at a distance, 5 = beside them, session by session.',
          measures: { archetype_trait: 'connector' },
        },
        {
          key: 'arch_mt_relationship',
          prompt: 'How much of the work is the relationship itself, rebuilt every session?',
          hint: '0 = the work is the advice, 5 = the work is the relationship.',
          measures: { archetype_trait: 'connector' },
        },
        {
          key: 'arch_mt_honest',
          prompt: 'How firmly do you keep commitments honest even when it strains the relationship?',
          hint: '0 = I protect the relationship first, 5 = honesty holds even when it is hard.',
          measures: { archetype_trait: 'operator' },
        },
        {
          key: 'arch_mt_cadence',
          prompt: 'How strictly do you run a cadence of commitments the person can see and inspect?',
          hint: '0 = informal follow-up, 5 = a visible cadence with owners and dates.',
          measures: { archetype_trait: 'operator' },
        },
      ];
    default:
      return [];
  }
}

/** Every archetype-module row for a persona (traits + illustration + role probes). */
export function archetypeModuleRows(persona: FitPersona): FitRowSpec[] {
  return [
    ...archetypeTraitRows(),
    ...archetypePersonaRows(persona),
    archetypePresentationRow(),
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
