/**
 * Task #19 — Best-Fit. Founder fit bank.
 *
 * Behavioral self-ratings (0–5) feeding the founder rubric in axalFit.ts plus
 * skill axes, the 5 bipolar founder value spectrums, and the 5 Axal values.
 * value_dim prompts are authored so 5 = the dimension's `pole_high`
 * (Mission-First / Speed-First / Risk-Seeking / Hyper-Growth / Autonomy).
 *
 * PROFILING v2, SESSION 9 (D319, PROFILING_V2.md §3–§6). Every id below the
 * v1 rows is new; no v1 id is renamed, reworded or removed (ids are
 * append-only: answers and history are keyed by them).
 *
 *   - ARCHETYPE. Eight situational pick-ones, each offering three or four
 *     archetypes; at least three put Missionary against Rocketeer (mission
 *     against momentum) and at least three put Rocketeer against Maverick
 *     (team-led against lone). Every option loads the two traits on which its
 *     archetype stands apart, at that archetype's own centroid values, so a
 *     choice pulls the trait vector straight towards one archetype. The first
 *     options are ordered so that "always the first one" is not a profile.
 *     Two reverse-keyed probes per trait mean that agreeing with everything
 *     cancels itself out (the engine's consistency term, D357).
 *   - SKILLS. Behavioural siblings ("in the last year, how often did you…")
 *     for every radar axis, including legal_compliance, which the v1 bank
 *     never asked. Session 8's platform evidence corroborates these; which
 *     tool relates to which axis is in PROFILING_V2.md §5.5, not in a prompt.
 *   - VALUES. A situation for each of the five founder spectrums (the
 *     canonical dimensions other roles are matched against — slugs unchanged)
 *     and the four Schwartz values the founder bank never asked (§6).
 *     These are 0–5 scales about a concrete situation, not pick-ones: the
 *     spec allows pick-ones to feed archetype traits only (§3.3), so a
 *     situational value item states the situation and asks how likely the
 *     person is to take one side of it.
 *   - AXAL VALUES. A behavioural situation for each of the six, beside the v1
 *     self-ratings (whose red-flag probes stay as they are).
 *   - RE-ASK. Every founder item carries the "still true?" wording Session 13
 *     uses when an answer ages out (§7.3) — new items inline, v1 and shared
 *     items through FOUNDER_REASK below, so the shared rows other banks use
 *     are untouched.
 */
import type { Question } from '../questionBank.ts';
import { buildFitBank, axalValueRows, archetypeModuleRows, pickOne, reverseKeyed, type FitRowSpec } from './fitShared.ts';

const AGREE_HINT = 'No wrong answers — 0 = not like me at all, 5 = exactly like me.';
const OFTEN_HINT = 'No wrong answers — 0 = never, 5 = most weeks.';
const LIKELY_HINT = 'No wrong answers — 0 = very unlikely, 5 = almost certainly.';

/**
 * The option signature per founder archetype: the two traits on which it
 * stands apart from the others, at its centroid values
 * (PROFILING_V2.md §2.2 — Missionary 2,5,5,3 · Rocketeer 4,4,4,2 ·
 * Architect 5,2,2,5 · Maverick 5,4,1,2).
 */
const MISSIONARY = { visionary: 5, builder: 2 } as const;
const ROCKETEER = { builder: 4, connector: 4 } as const;
const ARCHITECT = { operator: 5, visionary: 2 } as const;
const MAVERICK = { builder: 5, connector: 1 } as const;

/** Situational pick-ones (§3.2). */
const FOUNDER_PICK_ONES: FitRowSpec[] = [
  // The order is deliberate. The first two are what adaptive selection asks
  // before the archetype floor: `contract` puts Missionary against Rocketeer,
  // `weekend` puts Rocketeer against Maverick. Within each item the FIRST
  // option is chosen so that "always the first option" lands between
  // archetypes rather than on one — measured against the engine by an
  // exhaustive search over option orders, not guessed (D319).
  pickOne({
    key: 'arch_fo_pick_contract',
    prompt: 'A large customer will sign a contract that triples your revenue — but only if you bend the product away from the problem you set out to solve. What do you do?',
    choices: [
      { key: 'a', label: 'Build a version for them myself, on the side, without pulling anyone else in', loadings: MAVERICK },
      { key: 'b', label: 'Hold to the problem, and spend my energy bringing that customer round to it', loadings: MISSIONARY },
      { key: 'c', label: 'Sign it and get the team shipping — the momentum is worth the detour', loadings: ROCKETEER },
    ],
    reask_prompt: 'A while back you told us how you would handle a big contract that pulls the product off course. Is that still what you would do?',
  }),
  pickOne({
    key: 'arch_fo_pick_weekend',
    prompt: 'On Friday you spot a way to fix your biggest customer complaint. What happens next?',
    choices: [
      { key: 'a', label: 'I build it myself over the weekend and show everyone on Monday', loadings: MAVERICK },
      { key: 'b', label: 'I pull the team together on Monday, agree the fix, and we ship it that week', loadings: ROCKETEER },
      { key: 'c', label: 'I write up the fix, assign an owner and a date, and add it to the plan', loadings: ARCHITECT },
    ],
    reask_prompt: 'You told us what you do when you spot a fix on a Friday. Is that still how your weekends go?',
  }),
  pickOne({
    key: 'arch_fo_pick_hire',
    prompt: 'You can hire one person this quarter. Who do you pick?',
    choices: [
      { key: 'a', label: 'Someone who cares about the mission as much as I do, even if they are less experienced', loadings: MISSIONARY },
      { key: 'b', label: 'A fast, hands-on generalist who can build and sell alongside me', loadings: ROCKETEER },
      { key: 'c', label: 'An operator who will put process and structure around what we already do', loadings: ARCHITECT },
    ],
    reask_prompt: 'Last time, you said who you would hire first if you had one seat. Would you still pick the same kind of person?',
  }),
  pickOne({
    key: 'arch_fo_pick_disagree',
    prompt: 'Your team disagrees with a direction you are fairly sure of. What do you do?',
    choices: [
      { key: 'a', label: 'Keep talking until the team is behind it — a direction nobody believes in will not ship', loadings: ROCKETEER },
      { key: 'b', label: 'Go ahead on my own and let the result make the case', loadings: MAVERICK },
      { key: 'c', label: 'Remind everyone what we are here to do, and let that settle it', loadings: MISSIONARY },
    ],
    reask_prompt: 'Last time, you said how you handle the team disagreeing with you. Still true?',
  }),
  pickOne({
    key: 'arch_fo_pick_story',
    prompt: 'You have five minutes on stage in front of people who have never heard of you. What do you spend them on?',
    choices: [
      { key: 'a', label: 'The change we want to see in the world, and why it matters to the people in the room', loadings: MISSIONARY },
      { key: 'b', label: 'The traction — how fast we are growing and where we will be next year', loadings: ROCKETEER },
      { key: 'c', label: 'How the product actually works, and why it is built the way it is', loadings: ARCHITECT },
    ],
    reask_prompt: 'You once told us what you would put in a five-minute pitch to strangers. Still the same story?',
  }),
  pickOne({
    key: 'arch_fo_pick_scale',
    prompt: 'Growth doubles overnight and everything starts to creak. What is your first move?',
    choices: [
      { key: 'a', label: 'Recruit fast and bring in people who have done this before', loadings: ROCKETEER },
      { key: 'b', label: 'Stop and rebuild the parts that are breaking before we take on more', loadings: ARCHITECT },
      { key: 'c', label: 'Patch the worst of it myself, tonight, and keep going', loadings: MAVERICK },
    ],
    reask_prompt: 'You told us your first move when growth outruns the company. Would it still be the same?',
  }),
  pickOne({
    key: 'arch_fo_pick_proud',
    prompt: 'A year from now, which would you be proudest to say?',
    choices: [
      { key: 'a', label: 'We changed something real for the people we set out to help', loadings: MISSIONARY },
      { key: 'b', label: 'We built something that runs well without me in every room', loadings: ARCHITECT },
      { key: 'c', label: 'We went from nothing to a company everyone in our market talks about', loadings: ROCKETEER },
      { key: 'd', label: 'I built the thing nobody believed could be built', loadings: MAVERICK },
    ],
    reask_prompt: 'A while ago you told us what you would be proudest of a year on. Is that still the one?',
  }),
  pickOne({
    key: 'arch_fo_pick_stuck',
    prompt: 'You are stuck on a hard problem in the product. What do you actually do?',
    choices: [
      { key: 'a', label: 'Shut the door and work it out myself', loadings: MAVERICK },
      { key: 'b', label: 'Break it down, write it up, and work through it step by step', loadings: ARCHITECT },
      { key: 'c', label: 'Get the team in a room and push through it together', loadings: ROCKETEER },
      { key: 'd', label: 'Go back to the people we are building for and ask what matters most to them', loadings: MISSIONARY },
    ],
    reask_prompt: 'You told us what you do when you are stuck on a hard product problem. Still how you work?',
  }),
];

/**
 * Two reverse-keyed probes per trait (§3.2): a 5 here pulls the trait down.
 * Round one (one per trait) is asked first, so the archetype floor is reached
 * with every trait covered; round two is headroom and re-ask material.
 */
const FOUNDER_REVERSE_FIRST: FitRowSpec[] = [
  reverseKeyed({ key: 'arch_fo_rev_builder_describe', trait: 'builder', hint: AGREE_HINT,
    prompt: 'I would rather describe what needs building than build it myself.',
    reask_prompt: 'You once said whether you would rather describe the work than do it. Is that still true?' }),
  reverseKeyed({ key: 'arch_fo_rev_visionary_quarter', trait: 'visionary', hint: AGREE_HINT,
    prompt: 'I prefer to plan only as far as the next quarter.',
    reask_prompt: 'You told us how far ahead you like to plan. Has that changed?' }),
  reverseKeyed({ key: 'arch_fo_rev_connector_alone', trait: 'connector', hint: AGREE_HINT,
    prompt: 'I get more done when I keep other people out of it.',
    reask_prompt: 'You once told us whether you get more done on your own. Is that still how it is?' }),
  reverseKeyed({ key: 'arch_fo_rev_operator_improvise', trait: 'operator', hint: AGREE_HINT,
    prompt: 'I would rather improvise each time than write down how we did it.',
    reask_prompt: 'You told us whether you improvise or write things down. Still true?' }),
];

const FOUNDER_REVERSE_SECOND: FitRowSpec[] = [
  reverseKeyed({ key: 'arch_fo_rev_builder_away', trait: 'builder', hint: AGREE_HINT,
    prompt: 'Hands-on work pulls me away from where I add the most value.',
    reask_prompt: 'Last time, you told us how you feel about hands-on work. Still the same?' }),
  reverseKeyed({ key: 'arch_fo_rev_visionary_distraction', trait: 'visionary', hint: AGREE_HINT,
    prompt: 'Talking about where the company could be in ten years feels like a distraction.',
    reask_prompt: 'A while back you said whether long-range talk feels like a distraction. Still true?' }),
  reverseKeyed({ key: 'arch_fo_rev_connector_intro', trait: 'connector', hint: AGREE_HINT,
    prompt: 'Asking someone for an introduction is a last resort for me.',
    reask_prompt: 'Last time, you said how you feel about asking for introductions. Still the same?' }),
  reverseKeyed({ key: 'arch_fo_rev_operator_meetings', trait: 'operator', hint: AGREE_HINT,
    prompt: 'Recurring meetings and checklists slow a young company down more than they help.',
    reask_prompt: 'A while ago you told us what you think of recurring meetings and checklists. Has that changed?' }),
];

/** Behavioural skill items, one or more per radar axis (§5.1). */
const FOUNDER_SKILLS: FitRowSpec[] = [
  { key: 'skill_product_cut', hint: OFTEN_HINT, measures: { skill_axis: 'product' },
    prompt: 'In the last year, how often did you drop something from the plan because users showed you it did not matter?',
    reask_prompt: 'It has been a while — how often are you cutting things from the plan based on what users show you these days?' },
  { key: 'skill_engineering_built', hint: OFTEN_HINT, measures: { skill_axis: 'engineering' },
    prompt: 'In the last year, how often did you write, or review line by line, the code that went into the product?',
    reask_prompt: 'It has been a while — how often are you in the code yourself these days?' },
  { key: 'skill_design_tested', hint: OFTEN_HINT, measures: { skill_axis: 'design' },
    prompt: 'In the last year, how often did you put a design or prototype in front of users and change it because of what you saw?',
    reask_prompt: 'It has been a while — how often are you testing designs with users now?' },
  { key: 'skill_gtm_calls', hint: OFTEN_HINT, measures: { skill_axis: 'gtm_sales' },
    prompt: 'In the last year, how often did you talk directly with a potential customer about buying?',
    reask_prompt: 'It has been a while — how often are you on sales conversations yourself now?' },
  { key: 'skill_brand_written', hint: OFTEN_HINT, measures: { skill_axis: 'marketing_brand' },
    prompt: 'In the last year, how often did you write or rework your own website, deck or launch copy?',
    reask_prompt: 'It has been a while — how often are you writing your own website, deck or launch copy these days?' },
  { key: 'skill_finance_model', hint: OFTEN_HINT, measures: { skill_axis: 'finance_ops' },
    prompt: 'In the last year, how often did you update your own financial model or runway plan and change a decision because of it?',
    reask_prompt: 'It has been a while — how often are you working in your own numbers now?' },
  { key: 'skill_legal_handled', hint: OFTEN_HINT, measures: { skill_axis: 'legal_compliance' },
    prompt: 'In the last year, how often did you read and handle a legal step yourself — incorporation, founder stock, a SAFE, an NDA — rather than sign it unread?',
    reask_prompt: 'It has been a while — how often are you reading and handling the legal steps yourself now?' },
  { key: 'skill_capital_asks', hint: OFTEN_HINT, measures: { skill_axis: 'capital_network' },
    prompt: 'In the last year, how often did you personally ask someone for money, a key hire or a partnership?',
    reask_prompt: 'It has been a while — how often are you making those asks yourself now?' },
];

/** Situational value items (§6): 5 = the dimension's pole_high. */
const FOUNDER_VALUES: FitRowSpec[] = [
  { key: 'values_sit_mission', hint: LIKELY_HINT, measures: { value_dim: 'founder_mission_vs_profit' },
    prompt: 'A buyer offers a life-changing price, but would shut down the part of the product your users rely on most. How likely are you to walk away from the offer?',
    reask_prompt: 'A while ago you told us whether you would walk away from a big offer that hurts your users. Still true?' },
  { key: 'values_sit_speed', hint: LIKELY_HINT, measures: { value_dim: 'founder_speed_vs_quality' },
    prompt: 'A feature is 80% ready and a competitor launches next week. How likely are you to ship it now and fix it in public?',
    reask_prompt: 'You told us whether you would ship an 80%-ready feature to beat a competitor. Would you still?' },
  { key: 'values_sit_risk', hint: LIKELY_HINT, measures: { value_dim: 'founder_risk_appetite' },
    prompt: 'You could put most of your remaining runway into one bet that doubles the company if it works and ends it if it does not. How likely are you to make it?',
    reask_prompt: 'Last time, you said whether you would bet most of the runway on one big move. Still the same answer?' },
  { key: 'values_sit_growth', hint: LIKELY_HINT, measures: { value_dim: 'founder_growth_vs_sustain' },
    prompt: 'Investors offer enough to triple headcount this year; the alternative is growing on your own revenue. How likely are you to take the money and hire?',
    reask_prompt: 'You told us whether you would take money to triple the team. Would you still?' },
  { key: 'values_sit_autonomy', hint: LIKELY_HINT, measures: { value_dim: 'founder_autonomy_vs_structure' },
    prompt: 'A new hire asks for a written process for how decisions get made. How likely are you to tell them to use their own judgement instead?',
    reask_prompt: 'A while back you said how you answer a hire who wants a written decision process. Still how you would answer?' },
  // ---- Schwartz (the founder bank never asked these; §6) ----------------
  { key: 'values_achievement', hint: OFTEN_HINT, measures: { value_dim: 'schwartz_achievement' },
    prompt: 'In the last month, how often did you set yourself a measurable target and then check whether you hit it?',
    reask_prompt: 'It has been a while — how often are you setting yourself measurable targets now?' },
  { key: 'values_benevolence', hint: OFTEN_HINT, measures: { value_dim: 'schwartz_benevolence' },
    prompt: 'When someone on your team is struggling, how often do you give up time you had planned for your own work to help them?',
    reask_prompt: 'It has been a while — how often are you making time for teammates who are struggling these days?' },
  { key: 'values_universalism', hint: AGREE_HINT, measures: { value_dim: 'schwartz_universalism' },
    prompt: 'The effect of my company on people outside it — not users, not investors — changes decisions I make.',
    reask_prompt: 'You told us how much the company\'s effect on outsiders shapes your decisions. Still true?' },
  { key: 'values_self_direction', hint: LIKELY_HINT, measures: { value_dim: 'schwartz_self_direction' },
    prompt: 'Offered a safer path where someone else sets the direction, how likely are you to choose the less certain one where you decide how the work is done?',
    reask_prompt: 'Last time, you said whether you would give up certainty to set your own direction. Would you still?' },
];

/** Behavioural situations for the six Axal values, beside the v1 self-ratings. */
const FOUNDER_AXAL_SITUATIONS: FitRowSpec[] = [
  { key: 'axal_integrity_sit', hint: LIKELY_HINT, measures: { axal_value: 'integrity' },
    prompt: 'Your investor update looks better if you leave out one bad week. How likely are you to put the bad week in anyway?',
    reask_prompt: 'You told us whether you would include a bad week in an investor update. Still true?' },
  { key: 'axal_stewardship_sit', hint: LIKELY_HINT, measures: { axal_value: 'stewardship' },
    prompt: 'You have budget left near the end of the quarter. How likely are you to keep it in the bank rather than spend it before it "expires"?',
    reask_prompt: 'Last time, you told us what you do with leftover budget. Still the same?' },
  { key: 'axal_curiosity_sit', hint: OFTEN_HINT, measures: { axal_value: 'curiosity' },
    prompt: 'When a customer tells you the product is wrong for them, how often do you go back and find out exactly why?',
    reask_prompt: 'It has been a while — how often are you following up with customers who say no?' },
  { key: 'axal_resilience_sit', hint: LIKELY_HINT, measures: { axal_value: 'resilience' },
    prompt: 'The morning after a round falls through, how likely are you to be back in front of investors within the week?',
    reask_prompt: 'You told us how quickly you get back out after a round falls through. Still true?' },
  { key: 'axal_collaboration_sit', hint: LIKELY_HINT, measures: { axal_value: 'collaboration' },
    prompt: 'A teammate\'s idea beat yours in a decision. How likely are you to say, in front of the team, that they got it right?',
    reask_prompt: 'Last time, you said whether you name the teammate whose idea won. Still how you do it?' },
  { key: 'axal_ambition_sit', hint: AGREE_HINT, measures: { axal_value: 'ambition' },
    prompt: 'My plan is built for the long shot — leading a category — rather than for a solid, comfortable business.',
    reask_prompt: 'A while back you told us whether your plan is built for the long shot. Is it still?' },
];

/**
 * Re-ask wording (§7.3) for the v1 founder rows and the shared rows the
 * founder bank uses. Applied here so the shared rows other banks read keep
 * their own wording (their sessions write theirs).
 */
export const FOUNDER_REASK: Record<string, string> = {
  vision_north_star: 'It has been a while — can you still state the future you are building in one sentence?',
  vision_why_now: 'Is "why now" still as clear to you as when you last told us?',
  exec_ship_rate: 'It has been a while — how consistently are plans turning into shipped progress these days?',
  exec_prioritization: 'Are you still as disciplined about cutting good ideas to protect the one that matters?',
  domain_edge: 'Has your earned insight into this market changed since you last told us?',
  domain_customer_proximity: 'How close are you to the people with this problem now?',
  coach_feedback: 'Still as ready to change course when someone makes a strong argument?',
  coach_seek_help: 'How actively are you seeking out help on your weak spots these days?',
  resilience_setbacks: 'Still able to keep the team steady when a launch or a raise falls through?',
  resilience_stamina: 'Is your pace still one you could hold for years?',
  comm_clarity: 'Still getting complex ideas across as clearly as you told us?',
  comm_persuasion: 'How effective are you at getting talented people to say yes now?',
  team_attract: 'Still attracting people who are better than you at their craft?',
  team_conflict: 'How are you handling hard disagreements with co-founders and early hires now?',
  values_mission: 'Is this still driven by a mission you would pursue for a smaller upside?',
  values_ethics: 'Under pressure to hit a number, is your ethical line still where it was?',
  lean_speed: 'Still leaning the same way between shipping fast and polishing first?',
  lean_risk: 'Still as comfortable with big, hard-to-reverse bets?',
  lean_growth: 'Still leaning the same way between aggressive growth and sustainable building?',
  lean_autonomy: 'Still preferring the same balance of autonomy and structure?',
  skill_engineering: 'Has your hands-on engineering strength changed since you last told us?',
  skill_design: 'Has your product and design sense changed since you last told us?',
  skill_finance_ops: 'How comfortable are you running the numbers and operations now?',
  // shared archetype probes
  arch_builder: 'Still as drawn to hands-on making as you told us?',
  arch_builder_fix: 'When something breaks, do you still fix it yourself first?',
  arch_builder_craft: 'Does your credibility still come from the same place?',
  arch_builder_ship: 'In a typical week now, how often are you shipping something yourself?',
  arch_builder_first: 'Are you still the one who builds the first version?',
  arch_visionary: 'Is your energy still split between the long view and the next task the way you told us?',
  arch_visionary_pull: 'Still pulling people towards a future that is not fully specified yet?',
  arch_visionary_bet: 'Still choosing the bigger story over the safer step as often?',
  arch_visionary_horizon: 'How far out are you planning these days?',
  arch_visionary_story: 'Is the story still as central to your influence?',
  arch_connector: 'Are people and relationships still as central to how you create value?',
  arch_connector_doors: 'Still opening doors and making introductions as naturally?',
  arch_connector_first_call: 'When you are stuck now, is your first move still to call someone?',
  arch_connector_rooms: 'Still getting the same energy from rooms of people versus solo work?',
  arch_connector_trust: 'Still turning new relationships into working alliances as quickly?',
  arch_operator: 'Still relying on process and systems the way you told us?',
  arch_operator_cadence: 'Still insisting on cadence, checklists and clear owners?',
  arch_operator_gap: 'Does a missing process still bother you as much?',
  arch_operator_owners: 'Is a task still not real until it has an owner and a date?',
  arch_operator_repeat: 'Still turning one-off wins into playbooks as quickly?',
  arch_fo_independent: 'Still making the call when the room disagrees?',
  arch_fo_playbook: 'Still preferring to invent the path over following a known playbook?',
  arch_fo_breakout: 'Still willing to outrun the process for a breakout?',
  arch_fo_raise: 'Still comfortable raising big and moving before the system is ready?',
  arch_fo_mission_pull: 'Is the mission still what converts people for you?',
  arch_fo_conviction: 'Does the mission still hold when a faster commercial path appears?',
  arch_fo_systems: 'How much of your week goes on systems that run without you now?',
  arch_fo_quality: 'Is your quality bar still one you would hold even if it costs a window?',
  arch_illustration: 'Still happy with how your character is drawn?',
  // shared Axal values
  axal_integrity: 'When something goes wrong on your watch now, do you still own it the way you told us?',
  axal_stewardship: 'Still treating other people\'s money, time and trust as something to protect?',
  axal_curiosity: 'How actively are you looking for evidence you might be wrong these days?',
  axal_resilience: 'After a setback now, how quickly are you getting moving again?',
  axal_collaboration: 'Still sharing credit and putting the mission ahead of being right?',
  axal_ambition: 'Still as driven to build something significant and lasting?',
};

/** Give a row the founder re-ask wording when it has none of its own. */
const withReask = (r: FitRowSpec): FitRowSpec =>
  r.reask_prompt || !FOUNDER_REASK[r.key] ? r : { ...r, reask_prompt: FOUNDER_REASK[r.key] };

export const FIT_FOUNDER_BANK: Question[] = buildFitBank('founder', [
  // Order matters for adaptive selection (profilingModules.ts): within a
  // module it asks gap-filling items first and then keeps bank order. The v2
  // archetype items therefore come first, so the six answers that reach the
  // archetype floor are one reverse-keyed probe per trait and two pick-ones
  // aimed at the close pairs — not six generic self-ratings.
  ...FOUNDER_REVERSE_FIRST,
  ...FOUNDER_PICK_ONES,
  ...FOUNDER_REVERSE_SECOND,
  // ---- vision_clarity -------------------------------------------------
  { key: 'vision_north_star', prompt: 'How clearly can you state, in one sentence, the future your company is trying to create?', measures: { rubric_category: 'vision_clarity' } },
  { key: 'vision_why_now', prompt: 'How well can you explain why now is the right moment for this — not five years ago, not five years from now?', measures: { rubric_category: 'vision_clarity' } },
  // ---- execution_ability ----------------------------------------------
  { key: 'exec_ship_rate', prompt: 'Over the last month, how consistently did you turn plans into shipped, visible progress?', measures: { rubric_category: 'execution_ability', skill_axis: 'product', red_flag: { key: 'poor_follow_through', at_or_below: 1 } } },
  { key: 'exec_prioritization', prompt: 'How disciplined are you at cutting good ideas to protect the one that matters most this week?', measures: { rubric_category: 'execution_ability' } },
  // ---- domain_insight -------------------------------------------------
  { key: 'domain_edge', prompt: 'How much non-obvious, earned insight do you have about this specific market?', measures: { rubric_category: 'domain_insight' } },
  { key: 'domain_customer_proximity', prompt: 'How close are you to the people who feel this problem most acutely?', measures: { rubric_category: 'domain_insight', skill_axis: 'gtm_sales' } },
  // ---- coachability ---------------------------------------------------
  { key: 'coach_feedback', prompt: 'When someone challenges your plan with a strong argument, how readily do you change course?', measures: { rubric_category: 'coachability', red_flag: { key: 'overconfidence', at_or_below: 1 } } },
  { key: 'coach_seek_help', prompt: 'How proactively do you seek out advisors and mentors for the things you are weakest at?', measures: { rubric_category: 'coachability' } },
  // ---- resilience -----------------------------------------------------
  { key: 'resilience_setbacks', prompt: 'How well do you keep the team steady and moving when a launch or a raise falls through?', measures: { rubric_category: 'resilience' } },
  { key: 'resilience_stamina', prompt: 'How sustainable is your pace — could you hold this intensity for years, not just months?', measures: { rubric_category: 'resilience' } },
  // ---- communication --------------------------------------------------
  { key: 'comm_clarity', prompt: 'How clearly do you get a complex idea across to someone hearing it for the first time?', measures: { rubric_category: 'communication', skill_axis: 'marketing_brand' } },
  { key: 'comm_persuasion', prompt: 'How effectively do you get talented people to say yes — to join, to invest, or to partner?', measures: { rubric_category: 'communication', skill_axis: 'capital_network' } },
  // ---- team_dynamics --------------------------------------------------
  { key: 'team_attract', prompt: 'How strong is your track record of attracting people who are better than you at their craft?', measures: { rubric_category: 'team_dynamics' } },
  { key: 'team_conflict', prompt: 'How well do you handle hard disagreements with a co-founder or a key early hire?', measures: { rubric_category: 'team_dynamics' } },
  // ---- values_fit -----------------------------------------------------
  { key: 'values_mission', prompt: 'How much is this driven by a mission you would pursue even if the financial upside were smaller?', measures: { rubric_category: 'values_fit', value_dim: 'founder_mission_vs_profit' } },
  { key: 'values_ethics', prompt: 'Under real pressure to hit a number, how firmly do you hold an ethical line?', measures: { rubric_category: 'values_fit', red_flag: { key: 'weak_ethics', at_or_below: 1 } } },
  // ---- founder value spectrums (5 = pole_high) ------------------------
  { key: 'lean_speed', prompt: 'How strongly do you favour shipping fast and learning in the wild over polishing before release?', hint: '0 = quality-first, 5 = speed-first.', measures: { value_dim: 'founder_speed_vs_quality' } },
  { key: 'lean_risk', prompt: 'How comfortable are you making big, hard-to-reverse bets under real uncertainty?', hint: '0 = risk-averse, 5 = risk-seeking.', measures: { value_dim: 'founder_risk_appetite' } },
  { key: 'lean_growth', prompt: 'How much do you bias toward aggressive growth over durable, sustainable building?', hint: '0 = sustainable, 5 = hyper-growth.', measures: { value_dim: 'founder_growth_vs_sustain' } },
  { key: 'lean_autonomy', prompt: 'How much do you prefer flexible autonomy over defined process and structure?', hint: '0 = process & structure, 5 = autonomy & flex.', measures: { value_dim: 'founder_autonomy_vs_structure' } },
  // ---- skills breadth (radar axes not already covered above) ----------
  // Task #45 — the radar needs signal across ≥5 of the 8 axes; the rubric
  // questions above only touch product/gtm_sales/marketing_brand/capital_network,
  // so these broaden coverage to engineering / design / finance_ops.
  { key: 'skill_engineering', prompt: 'How strong is your own hands-on engineering — could you build or credibly lead the build of the product?', hint: '0 = not my strength, 5 = deep engineering strength.', measures: { skill_axis: 'engineering' } },
  { key: 'skill_design', prompt: 'How strong is your product/design sense — shaping something people find intuitive and want to use?', hint: '0 = not my strength, 5 = a real strength.', measures: { skill_axis: 'design' } },
  { key: 'skill_finance_ops', prompt: 'How comfortable are you running the numbers and operations — budgets, runway, hiring plans, cadence?', hint: '0 = not my strength, 5 = a real strength.', measures: { skill_axis: 'finance_ops' } },
  // ---- archetype traits + illustration sex ---------------------------
  ...archetypeModuleRows('founder'),
  // ---- Axal values ----------------------------------------------------
  ...axalValueRows(),
  // ---- Profiling v2 (Session 9): behavioural skills, values, Axal -----
  ...FOUNDER_SKILLS,
  ...FOUNDER_VALUES,
  ...FOUNDER_AXAL_SITUATIONS,
].map(withReask));
