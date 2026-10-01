/**
 * Task #19 — Best-Fit. Coach fit bank.
 *
 * Coach has no advisor role of its own, so these questions are delivered inside
 * the advisor conversation (Question.persona = 'advisor') but keep the
 * `fit.coach.*` id prefix so axalFit.ts scores them against the coach rubric
 * (shared with advisor). Behavioral self-ratings (0–5) + the 5 Axal values.
 *
 * Profiling v2, Session 12 (PROFILING_V2.md §2.4). Before this the bank asked
 * no archetype, skill or value question, so a coach could never be
 * classified. It now carries the coach's own archetype module — the 20 shared
 * trait probes, eight coach-flavoured role probes, four pick-ones separating
 * Hands-On Coach from Accountability Anchor and two reverse-keyed probes per
 * trait — plus behavioural skills on all 8 radar axes, the four Schwartz
 * values and a situation-then-choice variant of each Axal value. The
 * illustration question is not repeated here: the advisor bank asks it in the
 * same conversation, and it sets one account-wide choice.
 *
 * In the advisor conversation this bank follows the advisor bank, and the
 * profiling modules are pooled over both, so adaptive selection reaches these
 * items only past the advisor floors. They are the coach's own signal and the
 * conversation's headroom, not a second survey.
 */
import type { Question } from '../questionBank.ts';
import { buildFitBank, axalValueRows, archetypeTraitRows, archetypePersonaRows, pickOne, reverseKeyed, type FitRowSpec } from './fitShared.ts';
import { withSharedReask } from './fit_advisor.ts';

const BEHAVIOUR_HINT = 'In the last year: 0 = not once, 5 = most months.';
const SITUATION_HINT = 'No wrong answers — 0 = very unlikely, 5 = what I would do.';

// ---- Situational pick-ones (§3.2) -------------------------------------
// Same rule as the advisor bank: one option per archetype, each loading the
// two traits where it stands apart at its centroid values, Hands-On Coach and
// Accountability Anchor always both offered, options in a Latin square (each
// position holds each archetype once across the four items).
const COACH_PICK_ONES: FitRowSpec[] = [
  pickOne({
    key: 'arch_co_pick_stalled',
    prompt: 'Someone you coach has been stuck on the same goal for three sessions. What do you most likely do?',
    choices: [
      { key: 'work_it', label: 'Work on it with them in the session until it moves', loadings: { builder: 4, connector: 5 } },
      { key: 'shrink', label: 'Make the commitment smaller and ask them to report back by a set day', loadings: { operator: 5, connector: 4 } },
      { key: 'question', label: 'Step back and ask whether it is still the right goal', loadings: { visionary: 5, connector: 4 } },
      { key: 'teach', label: 'Teach them the technique they are missing', loadings: { builder: 5, operator: 4 } },
    ],
    reask_prompt: 'When someone you coach is stuck, is that still what you do?',
  }),
  pickOne({
    key: 'arch_co_pick_open',
    prompt: 'How do you usually open a coaching session?',
    choices: [
      { key: 'the_work', label: 'With a piece of their work for us to look at together', loadings: { builder: 5, visionary: 3 } },
      { key: 'big_q', label: 'With a big question about where they are heading', loadings: { visionary: 5, operator: 3 } },
      { key: 'dive_in', label: 'By asking what they are working on right now and diving in with them', loadings: { connector: 5, operator: 3 } },
      { key: 'review', label: 'By reviewing what they committed to last time', loadings: { operator: 5, visionary: 2 } },
    ],
    reask_prompt: 'Is that still how you open a session?',
  }),
  pickOne({
    key: 'arch_co_pick_close',
    prompt: 'At the end of a session, what do you most want to be true?',
    choices: [
      { key: 'owned', label: 'The next steps have owners and dates', loadings: { operator: 5, builder: 3 } },
      { key: 'moved', label: 'We moved something forward together today', loadings: { builder: 4, operator: 3 } },
      { key: 'new_skill', label: 'They leave with a skill they did not have', loadings: { builder: 5, connector: 2 } },
      { key: 'new_view', label: 'They leave seeing the problem in a new way', loadings: { visionary: 5, builder: 2 } },
    ],
    reask_prompt: 'Is that still what you want at the end of a session?',
  }),
  pickOne({
    key: 'arch_co_pick_more',
    prompt: 'Someone you coach says they need more from you this month. What do you offer?',
    choices: [
      { key: 'longer', label: 'Longer, less frequent conversations about the big calls', loadings: { visionary: 5, connector: 4 } },
      { key: 'review_work', label: 'A closer weekly review of their work', loadings: { operator: 4, connector: 2 } },
      { key: 'tighter', label: 'A tighter check-in rhythm on their commitments', loadings: { operator: 5, connector: 4 } },
      { key: 'alongside', label: 'More time working alongside them', loadings: { builder: 4, connector: 5 } },
    ],
    reask_prompt: 'If someone needed more from you this month, would you still offer that?',
  }),
];

// ---- Reverse-keyed probes: a 5 here pulls the trait DOWN (§3.2) --------
const COACH_REVERSE: FitRowSpec[] = [
  reverseKeyed({
    key: 'arch_co_r_talk_only',
    trait: 'builder',
    prompt: 'How much of your coaching stays in conversation, without ever working on the actual task together?',
    hint: '0 = we often work on the task together, 5 = it stays in conversation.',
    reask_prompt: 'Does your coaching still stay in conversation rather than the task itself?',
  }),
  reverseKeyed({
    key: 'arch_co_r_no_demo',
    trait: 'builder',
    prompt: 'How firmly do you avoid showing someone how you would do it yourself?',
    hint: '0 = I show them when it helps, 5 = I never show them my way.',
    reask_prompt: 'Do you still avoid showing people how you would do it?',
  }),
  reverseKeyed({
    key: 'arch_co_r_present_only',
    trait: 'visionary',
    prompt: 'How much do you keep sessions on the goal in front of the person, leaving the longer arc of their career alone?',
    hint: '0 = I often bring in the longer arc, 5 = I stay on the goal in front of them.',
    reask_prompt: 'Do you still keep sessions on the goal in front of the person?',
  }),
  reverseKeyed({
    key: 'arch_co_r_no_future',
    trait: 'visionary',
    prompt: 'How uncomfortable are you painting a picture of who someone could become?',
    hint: '0 = I do it readily, 5 = I avoid it.',
    reask_prompt: 'Are you still uncomfortable painting a picture of who someone could become?',
  }),
  reverseKeyed({
    key: 'arch_co_r_arms_length',
    trait: 'connector',
    prompt: 'How much do you keep the people you coach at arm’s length outside the sessions?',
    hint: '0 = I stay close between sessions, 5 = strictly arm’s length.',
    reask_prompt: 'Do you still keep people at arm’s length outside the sessions?',
  }),
  reverseKeyed({
    key: 'arch_co_r_solo_path',
    trait: 'connector',
    prompt: 'How strongly do you believe people should grow on their own, without others brought in?',
    hint: '0 = I bring others in, 5 = they should grow on their own.',
    reask_prompt: 'Do you still believe people should grow without others brought in?',
  }),
  reverseKeyed({
    key: 'arch_co_r_no_tracking',
    trait: 'operator',
    prompt: 'How comfortable are you coaching without any record of what the person committed to?',
    hint: '0 = I always keep a record, 5 = I am comfortable without one.',
    reask_prompt: 'Are you still comfortable coaching without a record of commitments?',
  }),
  reverseKeyed({
    key: 'arch_co_r_let_drift',
    trait: 'operator',
    prompt: 'When someone quietly drops a commitment, how often do you let it go unmentioned?',
    hint: '0 = I always raise it, 5 = I usually let it go.',
    reask_prompt: 'Do you still let a dropped commitment go unmentioned?',
  }),
];

export const FIT_COACH_BANK: Question[] = buildFitBank('coach', withSharedReask([
  // ---- domain_expertise -----------------------------------------------
  { key: 'domain_method', prompt: 'How well-developed is your coaching method — a repeatable way you help people grow?', measures: { rubric_category: 'domain_expertise' }, reask_prompt: 'Is your coaching method still as well developed?' },
  { key: 'domain_breadth', prompt: 'How broad is the range of founder situations you can coach across with confidence?', measures: { rubric_category: 'domain_expertise' }, reask_prompt: 'Can you still coach across as broad a range of founder situations?' },
  // ---- teaching_ability -----------------------------------------------
  { key: 'teach_actionable', prompt: 'How consistently do founders leave a session with something concrete they can act on?', measures: { rubric_category: 'teaching_ability' }, reask_prompt: 'Do founders still leave your sessions with something concrete to act on?' },
  { key: 'teach_accountability', prompt: 'How effectively do you hold founders accountable to what they said they would do?', measures: { rubric_category: 'teaching_ability' }, reask_prompt: 'Do you still hold founders accountable to what they said they would do?' },
  // ---- listening ------------------------------------------------------
  { key: 'listen_deep', prompt: 'How well do you hear what a founder is not saying, not just their words?', measures: { rubric_category: 'listening' }, reask_prompt: 'Do you still hear what a founder is not saying?' },
  { key: 'listen_nonjudgmental', prompt: 'How safe do founders feel being honest with you about what is really going wrong?', measures: { rubric_category: 'listening' }, reask_prompt: 'Do founders still feel safe being honest with you?' },
  // ---- founder_empathy ------------------------------------------------
  { key: 'empathy_founder', prompt: 'How deeply do you understand the isolation and pressure of being a founder?', measures: { rubric_category: 'founder_empathy' }, reask_prompt: 'Is your feel for the isolation and pressure of founding still as deep?' },
  { key: 'empathy_holding', prompt: 'How well do you hold space for a founder in a genuinely hard moment?', measures: { rubric_category: 'founder_empathy' }, reask_prompt: 'Can you still hold space for a founder in a hard moment as well?' },
  // ---- reliability ----------------------------------------------------
  { key: 'reliable_consistency', prompt: 'How consistent and dependable is the cadence you keep with the people you coach?', measures: { rubric_category: 'reliability', red_flag: { key: 'poor_follow_through', at_or_below: 1 } }, reask_prompt: 'Is the cadence you keep with the people you coach still as dependable?' },
  { key: 'reliable_boundaries', prompt: 'How well do you keep clear, healthy boundaries while still being available?', measures: { rubric_category: 'reliability' }, reask_prompt: 'Are your boundaries still clear and healthy?' },
  // ---- values_alignment -----------------------------------------------
  { key: 'values_align', prompt: 'How much do you coach toward the founder’s own goals rather than the outcome you would pick?', measures: { rubric_category: 'values_alignment' }, reask_prompt: 'Do you still coach toward the founder’s own goals?' },
  { key: 'values_ethics', prompt: 'How firmly do you keep the coaching relationship ethical and free of hidden agendas?', measures: { rubric_category: 'values_alignment', red_flag: { key: 'weak_ethics', at_or_below: 1 } }, reask_prompt: 'Do you still keep the coaching relationship free of hidden agendas?' },
  // ---- skills, by behaviour (all 8 radar axes; §5) ----------------------
  // How often they coached a founder through each area in the last year.
  { key: 'skill_b_product', prompt: 'In the last year, how often did you coach a founder through a product decision — what to build, cut, or test next?', hint: BEHAVIOUR_HINT, measures: { skill_axis: 'product' }, reask_prompt: 'Lately, are you still coaching founders through product decisions as often?' },
  { key: 'skill_b_engineering', prompt: 'In the last year, how often did you coach a founder through leading engineers or making a technical trade-off?', hint: BEHAVIOUR_HINT, measures: { skill_axis: 'engineering' }, reask_prompt: 'Lately, are you still coaching founders through technical trade-offs as often?' },
  { key: 'skill_b_design', prompt: 'In the last year, how often did you coach a founder on the quality of their product experience or brand design?', hint: BEHAVIOUR_HINT, measures: { skill_axis: 'design' }, reask_prompt: 'Lately, are you still coaching founders on design quality as often?' },
  { key: 'skill_b_gtm', prompt: 'In the last year, how often did you coach a founder through selling — a pitch to a customer, a pipeline review, a lost deal?', hint: BEHAVIOUR_HINT, measures: { skill_axis: 'gtm_sales' }, reask_prompt: 'Lately, are you still coaching founders through selling as often?' },
  { key: 'skill_b_marketing', prompt: 'In the last year, how often did you coach a founder on how they tell their story to the market?', hint: BEHAVIOUR_HINT, measures: { skill_axis: 'marketing_brand' }, reask_prompt: 'Lately, are you still coaching founders on how they tell their story?' },
  { key: 'skill_b_finance_ops', prompt: 'In the last year, how often did you coach a founder through running the business — hiring plans, budgets, or cash?', hint: BEHAVIOUR_HINT, measures: { skill_axis: 'finance_ops' }, reask_prompt: 'Lately, are you still coaching founders through running the business as often?' },
  { key: 'skill_b_legal', prompt: 'In the last year, how often did you coach a founder through a legal or compliance worry and help them decide when to bring in a lawyer?', hint: BEHAVIOUR_HINT, measures: { skill_axis: 'legal_compliance' }, reask_prompt: 'Lately, are you still coaching founders through legal and compliance worries as often?' },
  { key: 'skill_b_capital', prompt: 'In the last year, how often did you coach a founder through a fundraise, or connect them to someone who could help with one?', hint: BEHAVIOUR_HINT, measures: { skill_axis: 'capital_network' }, reask_prompt: 'Lately, are you still coaching founders through fundraising as often?' },
  // ---- work values, by behaviour (Schwartz; §6 — coach shares advisor's four) --
  { key: 'val_b_benevolence', prompt: 'In the last year, how often did you coach someone who could not pay your usual rate, because you wanted them to grow?', hint: BEHAVIOUR_HINT, measures: { value_dim: 'schwartz_benevolence' }, reask_prompt: 'Lately, are you still coaching people who cannot pay your usual rate?' },
  { key: 'val_b_universalism', prompt: 'In the last year, how often did you raise how a founder’s choices would affect their team or customers, even when they had not asked?', hint: BEHAVIOUR_HINT, measures: { value_dim: 'schwartz_universalism' }, reask_prompt: 'Lately, do you still raise how a founder’s choices affect others?' },
  { key: 'val_b_self_direction', prompt: 'In the last year, how often did you change your coaching approach because the usual method did not fit the person?', hint: BEHAVIOUR_HINT, measures: { value_dim: 'schwartz_self_direction' }, reask_prompt: 'Lately, are you still changing your approach to fit the person?' },
  { key: 'val_b_achievement', prompt: 'In the last year, how often did you set a measurable goal with someone you coach and check it at the end?', hint: BEHAVIOUR_HINT, measures: { value_dim: 'schwartz_achievement' }, reask_prompt: 'Lately, are you still setting and checking measurable goals?' },
  // ---- archetype: situational pick-ones, then traits, then reverse keys --
  ...COACH_PICK_ONES,
  ...archetypeTraitRows(),
  ...archetypePersonaRows('coach'),
  ...COACH_REVERSE,
  // ---- Axal values ----------------------------------------------------
  ...axalValueRows(),
  // ---- Axal values, by behaviour: a situation, then what you would do --
  { key: 'axal_b_integrity', prompt: 'You realise an exercise you gave someone you coach sent them the wrong way for weeks. How likely are you to name it as your mistake in the next session?', hint: SITUATION_HINT, measures: { axal_value: 'integrity' }, reask_prompt: 'If an exercise of yours sent someone the wrong way, would you still name it as your mistake?' },
  { key: 'axal_b_stewardship', prompt: 'Someone you coach no longer needs weekly sessions, but they are paying for them. How likely are you to suggest fewer?', hint: SITUATION_HINT, measures: { axal_value: 'stewardship' }, reask_prompt: 'Would you still suggest fewer sessions when someone no longer needs them?' },
  { key: 'axal_b_curiosity', prompt: 'A method you trust is not working for someone you coach. How likely are you to go and learn a different one?', hint: SITUATION_HINT, measures: { axal_value: 'curiosity' }, reask_prompt: 'When your method stops working for someone, do you still go and learn another?' },
  { key: 'axal_b_resilience', prompt: 'Someone you coached for months stops without explanation. How likely are you to reflect, adjust, and bring your full energy to the next person that week?', hint: SITUATION_HINT, measures: { axal_value: 'resilience' }, reask_prompt: 'When a coaching relationship ends badly, do you still bounce back as quickly?' },
  { key: 'axal_b_collaboration', prompt: 'Someone you coach credits a peer group, not you, for their breakthrough. How likely are you to encourage them to lean on that group even more?', hint: SITUATION_HINT, measures: { axal_value: 'collaboration' }, reask_prompt: 'Would you still encourage someone to lean on the group that got the credit?' },
  { key: 'axal_b_ambition', prompt: 'Someone you coach sets a goal you think is too small for them. How likely are you to challenge them to aim higher?', hint: SITUATION_HINT, measures: { axal_value: 'ambition' }, reask_prompt: 'Would you still challenge someone to aim higher than the goal they set?' },
]));
