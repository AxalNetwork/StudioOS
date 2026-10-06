/**
 * Task #19 — Best-Fit. Investor fit bank.
 *
 * Behavioral self-ratings (0–5) feeding the investor rubric in axalFit.ts plus
 * capital/network skill axes and the 5 Axal values. value_dim risk/growth
 * prompts are authored so 5 = the dimension's `pole_high`.
 *
 * D386 (Profiling v2, Session 10) extends it without renaming or removing an
 * id (PROFILING_V2.md §3):
 *   - six situational pick-ones. At least three put Thesis-Driven Backer
 *     against Disciplined Allocator, the investor pair 2.45 apart. Every
 *     option stands for one of the four investor archetypes, and the
 *     archetype behind the first option rotates;
 *   - two reverse-keyed probes per trait, so rating everything 5 is not a
 *     profile;
 *   - behavioural skill questions for the three radar axes this bank never
 *     asked (engineering, design, marketing_brand);
 *   - a situation for risk appetite, growth versus sustain, and the three
 *     Schwartz dimensions this role asks;
 *   - a situation for each of the six Axal values, beside the shared ratings;
 *   - a re-ask wording for every question, including the shared ones
 *     (INVESTOR_REASK).
 *
 * The new archetype items come first. Adaptive selection asks one uncovered
 * trait at a time and then keeps bank order, so the floor of six is four
 * reverse-keyed probes and two close-pair situations.
 */
import type { Question } from '../questionBank.ts';
import { buildFitBank, axalValueRows, archetypeModuleRows, pickOne, reverseKeyed, type FitRowSpec } from './fitShared.ts';

const AGREE = 'No wrong answers — 0 = not like me at all, 5 = exactly like me.';
const OFTEN = 'No wrong answers — 0 = never, 5 = most weeks.';
const LIKELY = 'No wrong answers — 0 = very unlikely, 5 = almost certainly.';

/**
 * Two traits each investor archetype stands apart on, at its centroid
 * (Thesis-Driven 2,5,2,4 · Network Amplifier 2,3,5,2 · Hands-On 4,3,4,4 ·
 * Allocator 1,3,2,5).
 */
const THESIS = { visionary: 5, operator: 4 } as const;
const NETWORK = { connector: 5, builder: 2 } as const;
const HANDS = { builder: 4, connector: 4 } as const;
const ALLOC = { operator: 5, visionary: 3 } as const;

const INVESTOR_REVERSE_FIRST: FitRowSpec[] = [
  reverseKeyed({ key: 'arch_inv_rev_builder_altitude', trait: 'builder', hint: AGREE,
    prompt: 'I would rather stay at a distance from the work than get into it beside a founder.',
    reask_prompt: 'You once said you would rather stay at a distance from the work. Is that still true?' }),
  reverseKeyed({ key: 'arch_inv_rev_visionary_room', trait: 'visionary', hint: AGREE,
    prompt: 'A written thesis is a distraction. I back whoever is strongest in the room that week.',
    reask_prompt: 'You told us a written thesis gets in the way. Is that still how you invest?' }),
  reverseKeyed({ key: 'arch_inv_rev_connector_alone', trait: 'connector', hint: AGREE,
    prompt: 'I get more done reviewing deals on my own than by making introductions.',
    reask_prompt: 'You once said you get more done alone than by introducing people. Still true?' }),
  reverseKeyed({ key: 'arch_inv_rev_operator_skip', trait: 'operator', hint: AGREE,
    prompt: 'When a deal is exciting, I skip the usual process and decide on the spot.',
    reask_prompt: 'You told us you skip the usual process when a deal is exciting. Still true?' }),
];

const INVESTOR_REVERSE_SECOND: FitRowSpec[] = [
  reverseKeyed({ key: 'arch_inv_rev_builder_cheque', trait: 'builder', hint: AGREE,
    prompt: 'After the cheque, my job is the board pack, not the product, the hiring or the go-to-market.',
    reask_prompt: 'Last time, you said your job after the cheque is the board pack. Still the same?' }),
  reverseKeyed({ key: 'arch_inv_rev_visionary_now', trait: 'visionary', hint: AGREE,
    prompt: 'I would rather back what is working this quarter than a market that does not exist yet.',
    reask_prompt: 'You told us you would rather back what is working this quarter. Has that changed?' }),
  reverseKeyed({ key: 'arch_inv_rev_connector_intro', trait: 'connector', hint: AGREE,
    prompt: 'Asking people in my network for an introduction feels like spending something I would rather keep.',
    reask_prompt: 'A while back you said introductions feel like spending something you would rather keep. Still true?' }),
  reverseKeyed({ key: 'arch_inv_rev_operator_gut', trait: 'operator', hint: AGREE,
    prompt: 'A repeatable diligence checklist slows me down more than it protects me.',
    reask_prompt: 'You once said a diligence checklist slows you down. Is that still how you see it?' }),
];

/** Situational pick-ones. The first option rotates so "always the first" is not one archetype. */
const INVESTOR_PICKS: FitRowSpec[] = [
  pickOne({
    key: 'arch_inv_pick_outside',
    prompt: 'A founder you rate highly is raising, and the company sits outside the thesis you wrote down. What do you do?',
    choices: [
      { key: 'alloc', label: 'Pass. The allocation rules exist so a great meeting cannot move them', loadings: ALLOC },
      { key: 'thesis', label: 'Pass, and tell them which part of the thesis they would have to change for a second look', loadings: THESIS },
      { key: 'network', label: 'Pass on the cheque and introduce them to two people who do invest there', loadings: NETWORK },
      { key: 'hands', label: 'Take a small cheque and spend the next month in the work with them', loadings: HANDS },
    ],
    reask_prompt: 'A while back you told us what you do with a great founder outside your thesis. Is that still what you would do?',
  }),
  pickOne({
    key: 'arch_inv_pick_monday',
    prompt: 'It is the Monday after you wired the round. Where does your week go?',
    choices: [
      { key: 'thesis', label: 'Writing up what this company confirms or breaks in the thesis, for the next one', loadings: THESIS },
      { key: 'hands', label: 'In the company: product, hiring or the first customers, beside the founder', loadings: HANDS },
      { key: 'network', label: 'On the phone, opening the doors the founder cannot open alone', loadings: NETWORK },
      { key: 'alloc', label: 'On the file: ownership, reserves and the process for the next check', loadings: ALLOC },
    ],
    reask_prompt: 'You told us where the week after a wire goes. Would it still go there?',
  }),
  pickOne({
    key: 'arch_inv_pick_board',
    prompt: 'The board is split on whether to hire a sales lead now. What do you do?',
    choices: [
      { key: 'network', label: 'I bring three people who have made that hire, and let the founder hear them', loadings: NETWORK },
      { key: 'alloc', label: 'I ask for the plan, the cost and the reserve impact, and I wait for those', loadings: ALLOC },
      { key: 'thesis', label: 'I ask whether this hire is the one the thesis said would matter, and I hold to that', loadings: THESIS },
      { key: 'hands', label: 'I sit with the founder and help run the search myself', loadings: HANDS },
    ],
    reask_prompt: 'Last time, you said how you handle a split board on a hire. Still the same?',
  }),
  pickOne({
    key: 'arch_inv_pick_sideways',
    prompt: 'A company you backed is a year in and clearly off plan. What is your first move?',
    choices: [
      { key: 'hands', label: 'I go in for two weeks and work the problem with the team', loadings: HANDS },
      { key: 'network', label: 'I call the people who have seen this before and put the founder in front of them', loadings: NETWORK },
      { key: 'alloc', label: 'I re-read the reserves and the process, and I decide what the next cheque is allowed to be', loadings: ALLOC },
      { key: 'thesis', label: 'I ask whether the original bet is still the bet, and I say so in writing', loadings: THESIS },
    ],
    reask_prompt: 'You told us your first move when a company is a year off plan. Would it still be that?',
  }),
  pickOne({
    key: 'arch_inv_pick_followon',
    prompt: 'A winner asks you to lead the next round, larger than your usual cheque. What do you do?',
    choices: [
      { key: 'alloc', label: 'I stay inside the reserve I set at the first cheque, even if I like the company', loadings: ALLOC },
      { key: 'hands', label: 'I lead it, and I plan to be in the company more, not less', loadings: HANDS },
      { key: 'thesis', label: 'I lead it only if this round is still the thesis, and I write that down first', loadings: THESIS },
      { key: 'network', label: 'I bring the rest of the round from people I trust, and I stay in my usual size', loadings: NETWORK },
    ],
    reask_prompt: 'A while ago you told us what you do when a winner asks you to lead a larger round. Still the same?',
  }),
  pickOne({
    key: 'arch_inv_pick_term',
    prompt: 'You and the founder disagree on one term that will matter in five years. What happens?',
    choices: [
      { key: 'network', label: 'I introduce a founder I backed who lived with that term, and I let them talk', loadings: NETWORK },
      { key: 'thesis', label: 'I explain the term from the kind of company I believe this has to become', loadings: THESIS },
      { key: 'alloc', label: 'I hold the term. It is how the fund stays consistent across deals', loadings: ALLOC },
      { key: 'hands', label: 'I work through the operating consequence with them until we both see the same thing', loadings: HANDS },
    ],
    reask_prompt: 'You told us how you handle a term you and a founder disagree on. Still how you do it?',
  }),
];

const INVESTOR_SKILLS: FitRowSpec[] = [
  { key: 'skill_engineering_read', hint: OFTEN, measures: { skill_axis: 'engineering' },
    prompt: 'In the last year, how often did you read a technical design with a founder and push on whether it would hold?',
    reask_prompt: 'It has been a while — how often are you in the technical design with a founder now?' },
  { key: 'skill_design_read', hint: OFTEN, measures: { skill_axis: 'design' },
    prompt: 'In the last year, how often did you sit with a product and say what a new user would fail to understand?',
    reask_prompt: 'It has been a while — how often are you sitting with the product as a new user would?' },
  { key: 'skill_marketing_read', hint: OFTEN, measures: { skill_axis: 'marketing_brand' },
    prompt: 'In the last year, how often did you work through a company’s story, site or deck and say what a stranger would not believe?',
    reask_prompt: 'It has been a while — how often are you working through a company’s story with them now?' },
];

const INVESTOR_VALUES: FitRowSpec[] = [
  { key: 'sit_risk', hint: LIKELY, measures: { value_dim: 'founder_risk_appetite' },
    prompt: 'A company has almost no proof and a founder you believe. How likely are you to write the cheque now rather than wait for the next round of evidence?',
    reask_prompt: 'You told us whether you would write a cheque before the proof. Would you still?' },
  { key: 'sit_growth', hint: LIKELY, measures: { value_dim: 'founder_growth_vs_sustain' },
    prompt: 'A company can grow faster if it spends the reserves you had meant to keep. How likely are you to push for that spend?',
    reask_prompt: 'Last time, you said whether you would push a company to spend reserves for faster growth. Still the same?' },
  { key: 'sit_achievement', hint: OFTEN, measures: { value_dim: 'schwartz_achievement' },
    prompt: 'In the last year, how often did you write down a result you meant to hit and then check whether you hit it?',
    reask_prompt: 'It has been a while — how often are you checking a result you wrote down?' },
  { key: 'sit_benevolence', hint: LIKELY, measures: { value_dim: 'schwartz_benevolence' },
    prompt: 'A founder you backed is struggling and the return is no longer the point. How likely are you to give them time you had kept for new deals?',
    reask_prompt: 'You told us whether you would give a struggling founder time you had kept for new deals. Still true?' },
  { key: 'sit_universalism', hint: LIKELY, measures: { value_dim: 'schwartz_universalism' },
    prompt: 'A deal would return well and, in your view, harm people the company never meets. How likely are you to pass?',
    reask_prompt: 'You told us whether you would pass on a harmful deal that returns well. Would you still?' },
];

const INVESTOR_AXAL: FitRowSpec[] = [
  { key: 'axal_inv_bad_quarter', hint: LIKELY, measures: { axal_value: 'integrity' },
    prompt: 'Your update to your own backers looks better if you leave out one bad quarter. How likely are you to put the bad quarter in?',
    reask_prompt: 'You told us whether you would include a bad quarter in an update. Still true?' },
  { key: 'axal_inv_reserves', hint: LIKELY, measures: { axal_value: 'stewardship' },
    prompt: 'A founder you like asks for reserves you had set aside for a later, harder moment. How likely are you to keep them where you put them?',
    reask_prompt: 'Last time, you said whether you keep reserves for the harder moment. Still the same?' },
  { key: 'axal_inv_wrong', hint: OFTEN, measures: { axal_value: 'curiosity' },
    prompt: 'When a company you passed on does well, how often do you go back and find out what you missed?',
    reask_prompt: 'It has been a while — how often do you go back to a pass that did well?' },
  { key: 'axal_inv_fell_through', hint: LIKELY, measures: { axal_value: 'resilience' },
    prompt: 'A round you had spent months on falls through. How likely are you to be in front of the next founder within the week?',
    reask_prompt: 'You told us how quickly you are back after a round falls through. Still true?' },
  { key: 'axal_inv_founder_right', hint: LIKELY, measures: { axal_value: 'collaboration' },
    prompt: 'In a board discussion the founder’s view beats yours. How likely are you to say so, in the room?',
    reask_prompt: 'Last time, you said whether you name it when a founder’s view beats yours. Still how you do it?' },
  { key: 'axal_inv_category', hint: AGREE, measures: { axal_value: 'ambition' },
    prompt: 'I back companies that are trying to lead a category, not ones that are aiming for a comfortable, smaller outcome.',
    reask_prompt: 'A while back you said you back companies trying to lead a category. Is that still the bet?' },
];

/** Re-ask wording for every row this bank already had, worded for an investor. */
export const INVESTOR_REASK: Record<string, string> = {
  thesis_focus: 'Is the thesis you invest against still as sharp as when you last told us?',
  thesis_conviction: 'Still as willing to lead a round before the rest of the market agrees?',
  capital_dry_powder: 'Is your capital still as dependable when you commit?',
  capital_followon: 'Still as reliable with follow-on for the companies that are working?',
  gov_board_value: 'Still adding the same kind of value in the board room, beyond the cheque?',
  gov_founder_respect: 'Still letting founders run the company rather than steering from the back seat?',
  rep_references: 'If a founder called people you backed who struggled, would the reference still be as strong?',
  rep_conduct: 'When a deal goes sideways now, is your conduct still where you said it was?',
  decision_diligence: 'Still doing the work to understand what you are backing?',
  decision_consistency: 'Are the reasons you give still the same before and after you know how it turned out?',
  values_alignment: 'Still putting the long-term health of the company ahead of your near-term return?',
  values_patience: 'Still as patient with durable building versus pushing for aggressive growth?',
  lean_risk: 'Still as comfortable backing earlier, riskier bets?',
  skill_gtm: 'Has your read on go-to-market changed since you last told us?',
  skill_product: 'Has your ability to judge a product changed since you last told us?',
  skill_legal: 'Still as comfortable with term sheets and the mechanics of a deal?',
  val_achievement: 'Does being measurably right still drive you the way you said?',
  val_benevolence: 'Still weighing the welfare of the founders you back, not just the return?',
  val_universalism: 'Do broader impact and fairness still factor into what you fund?',
  arch_builder: 'Still as drawn to hands-on work as you told us?',
  arch_builder_fix: 'When something breaks, do you still get into it yourself first?',
  arch_builder_craft: 'Does your credibility with founders still come from the same place?',
  arch_builder_ship: 'In a typical week now, how often are you in the work yourself?',
  arch_builder_first: 'Are you still the one who gets into the first version with a founder?',
  arch_visionary: 'Is your energy still split between the long view and the next task the way you told us?',
  arch_visionary_pull: 'Still pulling founders towards a future that is not fully specified yet?',
  arch_visionary_bet: 'Still choosing the bigger story over the safer step as often?',
  arch_visionary_horizon: 'How far out are you looking these days?',
  arch_visionary_story: 'Is the story still as central to how you decide?',
  arch_connector: 'Are people and relationships still as central to how you create value?',
  arch_connector_doors: 'Still opening doors and making introductions as naturally?',
  arch_connector_first_call: 'When you are stuck now, is your first move still to call someone?',
  arch_connector_rooms: 'Still getting the same energy from rooms of people versus working alone?',
  arch_connector_trust: 'Still turning new relationships into working ones as quickly?',
  arch_operator: 'Still relying on process the way you told us?',
  arch_operator_cadence: 'Still insisting on cadence, owners and dates?',
  arch_operator_gap: 'Does a missing process still bother you as much?',
  arch_operator_owners: 'Is a task still not real until it has an owner and a date?',
  arch_operator_repeat: 'Still turning one-off wins into a process as quickly?',
  arch_inv_sleeves: 'Still as often in the work beside a founder, rather than at board altitude?',
  arch_inv_product: 'Still as often in the product, go-to-market or hiring after the cheque?',
  arch_inv_thesis: 'Still investing from a written thesis rather than from who is in the room?',
  arch_inv_lead: 'Still leading rounds on conviction before the crowd agrees?',
  arch_inv_doors: 'Is opening doors still as much of your value after the cheque?',
  arch_inv_reputation: 'Are the rooms and reputation you bring still as much of the reason a founder takes your cheque?',
  arch_inv_process: 'Still holding the allocation process when a deal is exciting?',
  arch_inv_diligence: 'Is your edge still repeatable diligence rather than access or instinct?',
  arch_illustration: 'Still happy with how your character is drawn?',
  axal_integrity: 'When something goes wrong on your watch now, do you still own it the way you told us?',
  axal_stewardship: 'Still treating other people’s money and trust as something to protect?',
  axal_curiosity: 'How actively are you looking for evidence you might be wrong these days?',
  axal_resilience: 'After a setback now, how quickly are you moving again?',
  axal_collaboration: 'Still sharing credit and putting the company ahead of being right?',
  axal_ambition: 'Still as driven to back something significant and lasting?',
};

const withReask = (r: FitRowSpec): FitRowSpec =>
  r.reask_prompt || !INVESTOR_REASK[r.key] ? r : { ...r, reask_prompt: INVESTOR_REASK[r.key] };

export const FIT_INVESTOR_BANK: Question[] = buildFitBank('investor', [
  ...INVESTOR_REVERSE_FIRST,
  ...INVESTOR_PICKS,
  ...INVESTOR_REVERSE_SECOND,
  { key: 'thesis_focus', prompt: 'How sharply defined is the thesis you invest against — the kind of company you back over and over?', measures: { rubric_category: 'thesis_fit' } },
  { key: 'thesis_conviction', prompt: 'How willing are you to lead a round on conviction before the rest of the market agrees?', measures: { rubric_category: 'thesis_fit' } },
  { key: 'capital_dry_powder', prompt: 'How dependable is your capital — do you have the reserves to actually deploy when you commit?', measures: { rubric_category: 'capital_quality', skill_axis: 'capital_network' } },
  { key: 'capital_followon', prompt: 'How reliably do you support winners with follow-on capital in later rounds?', measures: { rubric_category: 'capital_quality', skill_axis: 'finance_ops' } },
  { key: 'gov_board_value', prompt: 'How much real value do you add in the board room beyond the cheque?', measures: { rubric_category: 'governance_style' } },
  { key: 'gov_founder_respect', prompt: 'How well do you let founders run their company rather than steering from the back seat?', measures: { rubric_category: 'governance_style', red_flag: { key: 'ego_over_collaboration', at_or_below: 1 } } },
  { key: 'rep_references', prompt: 'If a founder called three people you backed who struggled, how strong would your reference be?', measures: { rubric_category: 'reputation' } },
  { key: 'rep_conduct', prompt: 'How consistently do you behave well when a deal goes sideways and incentives get tense?', measures: { rubric_category: 'reputation', red_flag: { key: 'weak_ethics', at_or_below: 1 } } },
  { key: 'decision_diligence', prompt: 'How rigorous is your diligence — do you do the work to understand what you are backing?', measures: { rubric_category: 'decision_quality' } },
  { key: 'decision_consistency', prompt: 'How consistent are the reasons you give for a decision before and after the outcome is known?', measures: { rubric_category: 'decision_quality', red_flag: { key: 'inconsistent_stories', at_or_below: 1 } } },
  { key: 'values_alignment', prompt: 'How much do you optimise for the long-term health of the company over your own near-term return?', measures: { rubric_category: 'values_fit' } },
  { key: 'values_patience', prompt: 'How patient are you with durable, sustainable building versus pushing for aggressive growth?', hint: '0 = patient / sustainable, 5 = pushes hyper-growth.', measures: { rubric_category: 'values_fit', value_dim: 'founder_growth_vs_sustain' } },
  { key: 'lean_risk', prompt: 'How comfortable are you backing earlier, riskier bets versus waiting for more proof?', hint: '0 = risk-averse, 5 = risk-seeking.', measures: { value_dim: 'founder_risk_appetite' } },
  { key: 'skill_gtm', prompt: 'How sharp is your read on a company’s go-to-market and sales motion?', hint: '0 = not my strength, 5 = a real strength.', measures: { skill_axis: 'gtm_sales' } },
  { key: 'skill_product', prompt: 'How well can you judge whether a product is genuinely good and defensible?', hint: '0 = not my strength, 5 = a real strength.', measures: { skill_axis: 'product' } },
  { key: 'skill_legal', prompt: 'How comfortable are you with term sheets, governance, and the legal mechanics of a deal?', hint: '0 = not my strength, 5 = a real strength.', measures: { skill_axis: 'legal_compliance' } },
  { key: 'val_achievement', prompt: 'How much does demonstrable success and being measurably right drive you?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_achievement' } },
  { key: 'val_benevolence', prompt: 'How much do you weigh the welfare of the founders and teams you back, not just returns?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_benevolence' } },
  { key: 'val_universalism', prompt: 'How much do broader impact and fairness factor into what you choose to fund?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_universalism' } },
  ...archetypeModuleRows('investor'),
  ...axalValueRows(),
  ...INVESTOR_SKILLS,
  ...INVESTOR_VALUES,
  ...INVESTOR_AXAL,
].map(withReask));
