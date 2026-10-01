/**
 * Task #19 — Best-Fit. Advisor fit bank.
 *
 * Behavioral self-ratings (0–5) feeding the shared advisor/coach rubric in
 * axalFit.ts plus a domain skill axis and the 5 Axal values.
 *
 * Profiling v2, Session 12 (PROFILING_V2.md §3, §5, §6). Added, never renamed:
 *   * four situational pick-ones that force the Hands-On Coach /
 *     Accountability Anchor choice (the advisor set's closest pair, 2.45) and
 *     give each of the four archetypes an option of its own;
 *   * two reverse-keyed probes per trait, so agreeing with everything scores
 *     as a contradiction rather than a profile;
 *   * behavioural skill items on all 8 radar axes, behavioural Schwartz
 *     values, and a situation-then-choice variant of each Axal value;
 *   * a re-ask wording on every item (§7.3).
 * Order matters to adaptive selection (profilingModules.ts): within a module
 * the gaps are filled first, then bank order decides. So the pick-ones sit
 * ahead of the trait probes — at the archetype floor (6) a person has
 * answered one probe per trait and the first two pick-ones — and the
 * behavioural skill and value items sit ahead of the older self-ratings.
 * The red-flag Axal probes stay ahead of their behavioural variants.
 */
import type { Question } from '../questionBank.ts';
import { buildFitBank, axalValueRows, archetypeModuleRows, pickOne, reverseKeyed, type FitRowSpec } from './fitShared.ts';

const BEHAVIOUR_HINT = 'In the last year: 0 = not once, 5 = most months.';
const SITUATION_HINT = 'No wrong answers — 0 = very unlikely, 5 = what I would do.';

/**
 * Re-ask wording for the rows advisors and coaches share with every persona
 * (the 20 trait probes, the illustration and the 6 Axal values). Kept here, not
 * in fitShared.ts, so the other bank sessions' edits to those rows never
 * collide with this one; a wording set on the shared row itself wins.
 */
export const ADVISOR_COACH_SHARED_REASK: Record<string, string> = {
  arch_builder: 'It has been a while — do you still gravitate to hands-on making as much as you did?',
  arch_builder_fix: 'Is it still true that you fix a broken thing yourself before handing it off?',
  arch_builder_craft: 'Does your credibility still come from craft you have done with your own hands?',
  arch_builder_ship: 'Are you still personally shipping something tangible in a normal week?',
  arch_builder_first: 'When a first version is needed, do you still build it yourself?',
  arch_visionary: 'Is your energy still split between the long-range picture and the task in front of you the way it was?',
  arch_visionary_pull: 'Do you still pull people toward a future that is not fully specified yet?',
  arch_visionary_bet: 'Do you still choose the bigger story over the safer next step as often?',
  arch_visionary_horizon: 'How far out do you plan these days — has it changed?',
  arch_visionary_story: 'Does the story you tell still carry as much of your influence?',
  arch_connector: 'Are people and relationships still as central to how you create value?',
  arch_connector_doors: 'Is opening doors and making introductions still a core move of yours?',
  arch_connector_first_call: 'When you are stuck, is your first move still to call someone?',
  arch_connector_rooms: 'Do rooms of people still energise you the way they did?',
  arch_connector_trust: 'Do you still turn new relationships into working alliances as quickly?',
  arch_operator: 'Do you still run on process and systems as much as you did?',
  arch_operator_cadence: 'Do you still insist on cadence, checklists and clear owners?',
  arch_operator_gap: 'Does a missing process still pull you to install one?',
  arch_operator_owners: 'Does a task still need an owner and a date before it feels real to you?',
  arch_operator_repeat: 'Do you still turn one-off wins into playbooks as quickly?',
  arch_illustration: 'Still happy with how your character is drawn?',
  axal_integrity: 'It has been a while — when something goes wrong on your watch, do you still own it the same way?',
  axal_stewardship: "Do you still treat other people's money, time and trust as something to protect?",
  axal_curiosity: 'Do you still go looking for evidence that you might be wrong as actively?',
  axal_resilience: 'After a setback, do you still recover and get moving as quickly?',
  axal_collaboration: 'Do you still share credit and put the mission ahead of being right?',
  axal_ambition: 'Are you still as driven to build something significant and lasting?',
};

/** Fill in re-ask wording for shared rows that do not carry their own. */
export function withSharedReask(rows: FitRowSpec[]): FitRowSpec[] {
  return rows.map((r) => (r.reask_prompt || !ADVISOR_COACH_SHARED_REASK[r.key] ? r : { ...r, reask_prompt: ADVISOR_COACH_SHARED_REASK[r.key] }));
}

// ---- Situational pick-ones (§3.2) -------------------------------------
// Each option is written for one archetype and loads the two traits where
// that archetype stands apart, at its centroid values:
//   Sage Guide (2,5,4,3) · Hands-On Coach (4,2,5,3)
//   Accountability Anchor (3,2,4,5) · Craft Master (5,3,2,4)
// Hands-On Coach and Accountability Anchor share connector and differ most on
// operator, then builder: every item offers both, one working alongside, one
// holding the person to what they committed. The options are ordered as a
// Latin square: each position (first, second, …) holds each archetype once
// across the four items, so "always option N" answers once for every
// archetype and never adds up to a confident profile.
const ADVISOR_PICK_ONES: FitRowSpec[] = [
  pickOne({
    key: 'arch_mt_pick_missed',
    prompt: 'A founder you support comes back having not done what they committed to last time. What do you most likely do?',
    choices: [
      { key: 'alongside', label: 'Roll up my sleeves and work through it with them in the session', loadings: { builder: 4, connector: 5 } },
      { key: 'recommit', label: 'Name the miss, agree a new date, and check back on that date', loadings: { operator: 5, connector: 4 } },
      { key: 'meaning', label: 'Ask what the miss says about where they really want to go', loadings: { visionary: 5, connector: 4 } },
      { key: 'demonstrate', label: 'Show them exactly how I would do it, step by step', loadings: { builder: 5, operator: 4 } },
    ],
    reask_prompt: 'When a founder misses a commitment these days, is that still how you respond?',
  }),
  pickOne({
    key: 'arch_mt_pick_deadline',
    prompt: 'It is the week before a founder you support has a big deadline. Where does most of your time with them go?',
    choices: [
      { key: 'quality', label: 'Reviewing the work itself and raising the quality bar', loadings: { builder: 5, visionary: 3 } },
      { key: 'picture', label: 'Helping them keep the bigger picture in view', loadings: { visionary: 5, builder: 2 } },
      { key: 'checkin', label: 'A short daily check-in on the list they committed to', loadings: { operator: 5, builder: 3 } },
      { key: 'beside', label: 'Beside them, working the problems as they come up', loadings: { builder: 4, operator: 3 } },
    ],
    reask_prompt: 'Before a founder’s big deadline, is that still where your time goes?',
  }),
  pickOne({
    key: 'arch_mt_pick_working',
    prompt: 'How do you know that your support for a founder is working?',
    choices: [
      { key: 'reframe', label: 'They start seeing their situation differently', loadings: { visionary: 5, operator: 3 } },
      { key: 'together', label: 'We have moved real things forward side by side', loadings: { connector: 5, visionary: 2 } },
      { key: 'craft', label: 'Their work gets visibly better at the craft', loadings: { builder: 5, connector: 2 } },
      { key: 'delivered', label: 'They hit what they said they would, week after week', loadings: { operator: 5, visionary: 2 } },
    ],
    reask_prompt: 'Is that still how you tell that your support is working?',
  }),
  pickOne({
    key: 'arch_mt_pick_quarter',
    prompt: 'A founder asks you to support them closely for the next quarter. Which role do you offer?',
    choices: [
      { key: 'anchor', label: 'Accountability partner: I hold the plan and the dates', loadings: { operator: 5, builder: 3 } },
      { key: 'teacher', label: 'Teacher of the craft: I review the work and show how it is done', loadings: { operator: 4, connector: 2 } },
      { key: 'coach', label: 'Hands-on coach: I am in the weekly work with them', loadings: { builder: 4, connector: 5 } },
      { key: 'sounding', label: 'Sounding board: I help with the big calls', loadings: { visionary: 5, builder: 2 } },
    ],
    reask_prompt: 'If a founder asked for a quarter of close support today, would you still offer that role?',
  }),
];

// ---- Reverse-keyed probes: a 5 here pulls the trait DOWN (§3.2) --------
const ADVISOR_REVERSE: FitRowSpec[] = [
  reverseKeyed({
    key: 'arch_mt_r_leave_work',
    trait: 'builder',
    prompt: 'How much do you leave the hands-on work entirely to the founder and stay in the conversation?',
    hint: '0 = I get into the work with them, 5 = the work is theirs; I stay in the conversation.',
    reask_prompt: 'Do you still leave the hands-on work to the founder as much as you did?',
  }),
  reverseKeyed({
    key: 'arch_mt_r_refer_out',
    trait: 'builder',
    prompt: 'When a founder asks you to show them how something is done, how often do you point them to someone else instead?',
    hint: '0 = I show them myself, 5 = I nearly always point them elsewhere.',
    reask_prompt: 'When asked to show how it is done, do you still point founders elsewhere as often?',
  }),
  reverseKeyed({
    key: 'arch_mt_r_this_week',
    trait: 'visionary',
    prompt: 'How strictly do you keep your conversations on this week’s concrete problem rather than where the company could be in five years?',
    hint: '0 = I often widen to the long view, 5 = I keep to this week’s problem.',
    reask_prompt: 'Do you still keep conversations on this week’s problem rather than the long view?',
  }),
  reverseKeyed({
    key: 'arch_mt_r_no_direction',
    trait: 'visionary',
    prompt: 'How uneasy are you offering a view on a founder’s long-range direction?',
    hint: '0 = I offer one readily, 5 = I stay away from it.',
    reask_prompt: 'Are you still as uneasy offering a view on a founder’s long-range direction?',
  }),
  reverseKeyed({
    key: 'arch_mt_r_async',
    trait: 'connector',
    prompt: 'How much do you prefer to help through written notes and comments rather than time together?',
    hint: '0 = I want the time together, 5 = written notes suit me best.',
    reask_prompt: 'Do you still prefer written notes over time together?',
  }),
  reverseKeyed({
    key: 'arch_mt_r_between',
    trait: 'connector',
    prompt: 'Between sessions, how much do you leave founders entirely to themselves?',
    hint: '0 = I stay in touch between sessions, 5 = we speak only at sessions.',
    reask_prompt: 'Between sessions, do you still leave founders to themselves as much?',
  }),
  reverseKeyed({
    key: 'arch_mt_r_no_next_steps',
    trait: 'operator',
    prompt: 'How comfortable are you letting a session end without agreed next steps or dates?',
    hint: '0 = never without next steps, 5 = entirely comfortable.',
    reask_prompt: 'Are you still comfortable ending a session without agreed next steps?',
  }),
  reverseKeyed({
    key: 'arch_mt_r_let_slide',
    trait: 'operator',
    prompt: 'How often do you let a founder’s missed commitment pass without bringing it up?',
    hint: '0 = I always bring it up, 5 = I usually let it pass.',
    reask_prompt: 'Do you still let a missed commitment pass without bringing it up?',
  }),
];

export const FIT_ADVISOR_BANK: Question[] = buildFitBank('advisor', withSharedReask([
  // ---- domain_expertise -----------------------------------------------
  { key: 'domain_depth', prompt: 'How deep is your earned expertise in the areas founders come to you for?', measures: { rubric_category: 'domain_expertise' }, reask_prompt: 'Is your expertise in the areas founders come to you for as deep as it was?' },
  { key: 'domain_recency', prompt: 'How current is that expertise — are you close to how the work is done today, not a decade ago?', measures: { rubric_category: 'domain_expertise', skill_axis: 'product' }, reask_prompt: 'Is your expertise still close to how the work is done today?' },
  // ---- teaching_ability -----------------------------------------------
  { key: 'teach_clarity', prompt: 'How well do you make a hard concept click for someone who is new to it?', measures: { rubric_category: 'teaching_ability' }, reask_prompt: 'Do hard concepts still click as well when you explain them?' },
  { key: 'teach_frameworks', prompt: 'How effectively do you give founders reusable frameworks rather than one-off answers?', measures: { rubric_category: 'teaching_ability' }, reask_prompt: 'Do you still give founders reusable frameworks rather than one-off answers?' },
  // ---- listening ------------------------------------------------------
  { key: 'listen_questions', prompt: 'How often do you ask questions to understand before offering your view?', measures: { rubric_category: 'listening' }, reask_prompt: 'Do you still ask to understand before offering your view?' },
  { key: 'listen_patience', prompt: 'How well do you resist jumping straight to your own answer before a founder finishes?', measures: { rubric_category: 'listening', red_flag: { key: 'overconfidence', at_or_below: 1 } }, reask_prompt: 'Do you still let a founder finish before offering your own answer?' },
  // ---- founder_empathy ------------------------------------------------
  { key: 'empathy_walked', prompt: 'How well do you understand the emotional reality of building, not just the tactics?', measures: { rubric_category: 'founder_empathy' }, reask_prompt: 'Is your feel for the emotional reality of building still as strong?' },
  { key: 'empathy_pressure', prompt: 'How attuned are you to when a founder needs support versus a push?', measures: { rubric_category: 'founder_empathy' }, reask_prompt: 'Can you still tell when a founder needs support rather than a push?' },
  // ---- reliability ----------------------------------------------------
  { key: 'reliable_showup', prompt: 'How reliably do you show up for the sessions and commitments you make to founders?', measures: { rubric_category: 'reliability', red_flag: { key: 'poor_follow_through', at_or_below: 1 } }, reask_prompt: 'Are you still showing up for your sessions and commitments as reliably?' },
  { key: 'reliable_prep', prompt: 'How well do you come prepared rather than winging each conversation?', measures: { rubric_category: 'reliability' }, reask_prompt: 'Do you still come prepared rather than winging it?' },
  // ---- values_alignment -----------------------------------------------
  { key: 'values_align', prompt: 'How much do you advise to genuinely help the founder rather than to advance your own interests?', measures: { rubric_category: 'values_alignment' }, reask_prompt: 'Is your advising still about helping the founder rather than your own interests?' },
  { key: 'values_conflicts', prompt: 'How openly do you flag conflicts of interest instead of letting them sit unsaid?', measures: { rubric_category: 'values_alignment', red_flag: { key: 'transactional', at_or_below: 1 } }, reask_prompt: 'Do you still flag conflicts of interest openly?' },
  // ---- skills, by behaviour (all 8 radar axes; §5) ----------------------
  // How often they judged and taught each area to a founder. Session 8's
  // platform evidence corroborates these per axis; the prompt names the
  // behaviour, never a tool.
  { key: 'skill_b_product', prompt: 'In the last year, how often did you help a founder decide what to build next, in a way that changed their plan?', hint: BEHAVIOUR_HINT, measures: { skill_axis: 'product' }, reask_prompt: 'Lately, are you still helping founders decide what to build next as often?' },
  { key: 'skill_b_engineering', prompt: 'In the last year, how often did you help a founder judge a technical decision — an architecture, a build-or-buy, or the bar for an engineering hire?', hint: BEHAVIOUR_HINT, measures: { skill_axis: 'engineering' }, reask_prompt: 'Lately, are you still helping founders judge technical decisions as often?' },
  { key: 'skill_b_design', prompt: 'In the last year, how often did you give a founder design feedback — on a product flow, a page, or a brand — that they acted on?', hint: BEHAVIOUR_HINT, measures: { skill_axis: 'design' }, reask_prompt: 'Lately, are founders still acting on your design feedback as often?' },
  { key: 'skill_b_gtm', prompt: 'In the last year, how often did you work through a founder’s sales pipeline or go-to-market plan with them?', hint: BEHAVIOUR_HINT, measures: { skill_axis: 'gtm_sales' }, reask_prompt: 'Lately, are you still working through founders’ go-to-market plans as often?' },
  { key: 'skill_b_marketing', prompt: 'In the last year, how often did you help a founder sharpen their positioning, message, or brand?', hint: BEHAVIOUR_HINT, measures: { skill_axis: 'marketing_brand' }, reask_prompt: 'Lately, are you still helping founders sharpen their positioning as often?' },
  { key: 'skill_b_finance_ops', prompt: 'In the last year, how often did you go through a founder’s numbers with them — a model, a budget, or a raise plan?', hint: BEHAVIOUR_HINT, measures: { skill_axis: 'finance_ops' }, reask_prompt: 'Lately, are you still going through founders’ numbers with them as often?' },
  { key: 'skill_b_legal', prompt: 'In the last year, how often did you walk a founder through a legal or compliance question — a term, a filing, a contract — and know when to send them to a lawyer?', hint: BEHAVIOUR_HINT, measures: { skill_axis: 'legal_compliance' }, reask_prompt: 'Lately, are you still walking founders through legal and compliance questions as often?' },
  { key: 'skill_b_capital', prompt: 'In the last year, how often did you introduce a founder to an investor, customer, or hire who took the meeting?', hint: BEHAVIOUR_HINT, measures: { skill_axis: 'capital_network' }, reask_prompt: 'Lately, are your introductions still turning into meetings as often?' },
  // ---- skills breadth (the domains founders come to you for) ----------
  // Task #45 — advisors advise across the whole company, not just product; these
  // give the radar signal across ≥5 axes (domain_recency above covers product).
  { key: 'skill_gtm', prompt: 'How strong is your guidance on go-to-market and sales for the founders you help?', hint: '0 = not my area, 5 = a real strength.', measures: { skill_axis: 'gtm_sales' }, reask_prompt: 'Is go-to-market and sales still a strength of your guidance?' },
  { key: 'skill_marketing', prompt: 'How strong is your guidance on marketing, positioning, and brand?', hint: '0 = not my area, 5 = a real strength.', measures: { skill_axis: 'marketing_brand' }, reask_prompt: 'Is marketing and brand still a strength of your guidance?' },
  { key: 'skill_finance_ops', prompt: 'How strong is your guidance on finance, fundraising strategy, and operations?', hint: '0 = not my area, 5 = a real strength.', measures: { skill_axis: 'finance_ops' }, reask_prompt: 'Is finance and operations still a strength of your guidance?' },
  { key: 'skill_capital', prompt: 'How strong is your ability to open your network and capital doors for founders?', hint: '0 = not my area, 5 = a real strength.', measures: { skill_axis: 'capital_network' }, reask_prompt: 'Can you still open network and capital doors for founders as well?' },
  // ---- work values, by behaviour (Schwartz; §6 — advisor: all four) -----
  { key: 'val_b_benevolence', prompt: 'In the last year, how often did you give a founder real time with nothing expected back?', hint: BEHAVIOUR_HINT, measures: { value_dim: 'schwartz_benevolence' }, reask_prompt: 'Lately, are you still giving founders time with nothing expected back?' },
  { key: 'val_b_universalism', prompt: 'In the last year, how often did a company’s effect on its customers, staff, or community change the help you gave it?', hint: BEHAVIOUR_HINT, measures: { value_dim: 'schwartz_universalism' }, reask_prompt: 'Lately, does a company’s wider effect still change the help you give?' },
  { key: 'val_b_self_direction', prompt: 'In the last year, how often did you turn down or reshape an engagement because it did not fit how you work?', hint: BEHAVIOUR_HINT, measures: { value_dim: 'schwartz_self_direction' }, reask_prompt: 'Lately, are you still reshaping engagements to fit how you work?' },
  { key: 'val_b_achievement', prompt: 'In the last year, how often did you track whether the founders you support hit a measurable result?', hint: BEHAVIOUR_HINT, measures: { value_dim: 'schwartz_achievement' }, reask_prompt: 'Lately, are you still tracking the measurable results of the founders you support?' },
  // ---- work values (Schwartz dims for a rounded values wheel) ---------
  { key: 'val_benevolence', prompt: 'How much is helping founders grow, for its own sake, a core motivation for you?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_benevolence' }, reask_prompt: 'Is helping founders grow, for its own sake, still a core motivation?' },
  { key: 'val_universalism', prompt: 'How much do fairness and the wider impact of the companies you help matter to you?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_universalism' }, reask_prompt: 'Do fairness and wider impact still matter to you as much?' },
  { key: 'val_self_direction', prompt: 'How much do you value advising on your own terms rather than to a set curriculum?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_self_direction' }, reask_prompt: 'Do you still value advising on your own terms as much?' },
  { key: 'val_achievement', prompt: 'How much does seeing the founders you back succeed measurably drive you?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_achievement' }, reask_prompt: 'Does measurable founder success still drive you as much?' },
  // ---- archetype: situational pick-ones, then traits, then reverse keys --
  ...ADVISOR_PICK_ONES,
  ...archetypeModuleRows('advisor'),
  ...ADVISOR_REVERSE,
  // ---- Axal values ----------------------------------------------------
  ...axalValueRows(),
  // ---- Axal values, by behaviour: a situation, then what you would do --
  // Scales, not pick-ones: a pick-one feeds archetype traits only (§3.3).
  { key: 'axal_b_integrity', prompt: 'A founder you support made a call on your suggestion and it went badly. How likely are you to tell them plainly that the suggestion was yours and it was wrong?', hint: SITUATION_HINT, measures: { axal_value: 'integrity' }, reask_prompt: 'If a suggestion of yours went badly today, would you still say so plainly?' },
  { key: 'axal_b_stewardship', prompt: 'A founder offers to pay you for a session you think they do not need. How likely are you to tell them so and not take it?', hint: SITUATION_HINT, measures: { axal_value: 'stewardship' }, reask_prompt: 'Would you still turn down a paid session you think a founder does not need?' },
  { key: 'axal_b_curiosity', prompt: 'A founder’s data contradicts a view you have shared with founders many times. How likely are you to dig into the data before defending the view?', hint: SITUATION_HINT, measures: { axal_value: 'curiosity' }, reask_prompt: 'When a founder’s data contradicts a view you often share, do you still dig in first?' },
  { key: 'axal_b_resilience', prompt: 'A company you supported for a year shuts down. How likely are you to be back supporting another founder within the month?', hint: SITUATION_HINT, measures: { axal_value: 'resilience' }, reask_prompt: 'After a company you supported closes, do you still get back to it as quickly?' },
  { key: 'axal_b_collaboration', prompt: 'Another advisor gets the credit for a turnaround you shaped. How likely are you to let it stand and keep working with them?', hint: SITUATION_HINT, measures: { axal_value: 'collaboration' }, reask_prompt: 'Would you still let credit you earned go to someone else and keep working together?' },
  { key: 'axal_b_ambition', prompt: 'You could keep a comfortable set of easy engagements or take on a harder founder with a much bigger goal. How likely are you to take the harder one?', hint: SITUATION_HINT, measures: { axal_value: 'ambition' }, reask_prompt: 'Would you still take the harder founder with the bigger goal?' },
]));
