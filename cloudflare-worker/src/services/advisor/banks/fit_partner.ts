/**
 * Task #19 — Best-Fit. Operating-partner fit bank.
 *
 * Behavioral self-ratings (0–5) feeding the partner rubric in axalFit.ts plus
 * network/GTM skill axes and the 5 Axal values.
 *
 * D491 (Profiling v2, Session 11) extends it without renaming or removing an
 * id (PROFILING_V2.md §3):
 *   - eight situational pick-ones, five separating Embedded Operator from
 *     Systems Builder (1.73 apart, the tightest pair in the system) and three
 *     separating Strategic Connector from Growth Catalyst. Every option stands
 *     for one of the four partner archetypes, so each person finds their own
 *     answer, and the archetype behind the FIRST option rotates, so always
 *     picking the first option is not a profile;
 *   - two reverse-keyed probes per trait, so rating everything 5 is not a
 *     profile either (the engine's consistency check reads them);
 *   - behavioural skill questions for the three radar axes this bank never
 *     asked about (engineering, design, marketing_brand);
 *   - behavioural variants of the partner's value dimensions and of all six
 *     Axal values: a situation, then how likely you are to act;
 *   - a re-ask wording for every question (§7.3), including the shared ones,
 *     which this bank words for a partner (PARTNER_REASK below).
 *
 * The new archetype items come BEFORE the shared module rows on purpose.
 * Adaptive selection asks the first unanswered item of each uncovered trait,
 * then the rest in bank order, so a person reaching the archetype floor (6)
 * answers four reverse-keyed probes, one per trait, and the first two
 * close-pair situations.
 */
import type { Question } from '../questionBank.ts';
import { buildFitBank, axalValueRows, archetypeModuleRows, pickOne, reverseKeyed, type FitRowSpec } from './fitShared.ts';

const SCALE_LIKELY = '0 = not at all likely, 5 = I would, every time.';
const SCALE_OFTEN = '0 = never, 5 = it is a regular part of my work.';

/**
 * The option loadings, one per partner archetype. Each loads the two traits
 * that tell that archetype from its close neighbour (§3.2: at most two), at
 * the archetype's own centroid values, so choosing it reads as "this trait is
 * where that archetype sits":
 *   Strategic Connector (2,4,5,3) · Embedded Operator (5,2,3,4)
 *   Growth Catalyst     (4,4,4,2) · Systems Builder   (4,2,2,5)
 */
const SC_A = { connector: 5, visionary: 4 };
const SC_B = { connector: 5, builder: 2 };
const EO_A = { builder: 5, connector: 3 };
const EO_B = { builder: 5, operator: 4 };
const GC_A = { builder: 4, operator: 2 };
const GC_B = { visionary: 4, operator: 2 };
const GC_C = { builder: 4, visionary: 4 };
const SB_A = { operator: 5, connector: 2 };
const SB_B = { operator: 5, visionary: 2 };
const SB_C = { operator: 5, builder: 4 };

/** Situational pick-ones (§3.2). Order is the delivery order within the module. */
const PARTNER_SITUATIONS: FitRowSpec[] = [
  // ---- Embedded Operator vs Systems Builder (5) ------------------------
  pickOne({
    key: 'pick_first_month',
    prompt: 'It is your first month with a new client company. Where does most of your time go?',
    choices: [
      { key: 'system', label: 'Mapping how the work flows and writing down the way it should run', loadings: SB_A },
      { key: 'inside', label: 'Sitting inside their team, doing the work with them', loadings: EO_A },
      { key: 'people', label: 'Meeting the people around them: investors, partners, future hires', loadings: SC_A },
      { key: 'lever', label: 'Finding the one growth lever and pushing it hard myself', loadings: GC_A },
    ],
    reask_prompt: 'Is that still where your first month with a new client goes?',
  }),
  pickOne({
    key: 'pick_leave_behind',
    prompt: 'An engagement is ending. What do you most want to leave behind?',
    choices: [
      { key: 'team', label: 'A team that did the hard part with me and can keep doing it', loadings: EO_A },
      { key: 'doors', label: 'Relationships that keep opening doors after I have gone', loadings: SC_A },
      { key: 'machine', label: 'Systems and dashboards that run without anyone watching them', loadings: SB_B },
      { key: 'curve', label: 'A growth curve that is already bending upward', loadings: GC_B },
    ],
    reask_prompt: 'Is that still what you most want to leave behind when an engagement ends?',
  }),
  pickOne({
    key: 'pick_breaking_process',
    prompt: 'A client’s release process keeps breaking. What do you do first?',
    choices: [
      { key: 'growth', label: 'Check whether it is actually slowing growth, and fix only that', loadings: GC_B },
      { key: 'redesign', label: 'Redesign the process so it cannot break the same way twice', loadings: SB_A },
      { key: 'join', label: 'Join the next release and fix it with them as it happens', loadings: EO_B },
      { key: 'expert', label: 'Bring in someone who has solved exactly this before', loadings: SC_B },
    ],
    reask_prompt: 'When a client’s process keeps breaking, is that still your first move?',
  }),
  pickOne({
    key: 'pick_short_staffed',
    prompt: 'A client will be short-staffed for six weeks. What do you offer?',
    choices: [
      { key: 'intros', label: 'Introductions to people who could fill the gap', loadings: SC_A },
      { key: 'growth', label: 'I take on the growth work myself so the numbers keep moving', loadings: GC_A },
      { key: 'step_in', label: 'I step into the role, day to day, until they hire', loadings: EO_A },
      { key: 'tooling', label: 'I set up tooling and checklists so fewer people can cover it', loadings: SB_C },
    ],
    reask_prompt: 'If a client were short-staffed today, would you still offer that?',
  }),
  pickOne({
    key: 'pick_success_signal',
    prompt: 'Six months after you leave a client, what would tell you the work succeeded?',
    choices: [
      { key: 'no_questions', label: 'Nobody has had to ask me how something works', loadings: SB_B },
      { key: 'same_way', label: 'The team still works the way we worked together', loadings: EO_A },
      { key: 'revenue', label: 'Revenue grew faster than it did before I came', loadings: GC_B },
      { key: 'intros', label: 'They are still working with people I introduced', loadings: SC_B },
    ],
    reask_prompt: 'Is that still how you would know an engagement worked?',
  }),
  // ---- Strategic Connector vs Growth Catalyst (3) ----------------------
  pickOne({
    key: 'pick_growth_stall',
    prompt: 'A client’s growth has stalled. What is your first move?',
    choices: [
      { key: 'experiments', label: 'Run growth experiments myself until something moves', loadings: GC_C },
      { key: 'unlock', label: 'Introduce them to the partner or buyer who can unlock the next stage', loadings: SC_A },
      { key: 'funnel', label: 'Find where the funnel leaks and put a process around it', loadings: SB_A },
      { key: 'sell', label: 'Join their sales calls and sell alongside them', loadings: EO_A },
    ],
    reask_prompt: 'When a client’s growth stalls, is that still your first move?',
  }),
  pickOne({
    key: 'pick_new_market',
    prompt: 'A client wants to enter a new market. Where are you most useful?',
    choices: [
      { key: 'who_to_call', label: 'Knowing who to call there and getting them in the room', loadings: SC_B },
      { key: 'go_with', label: 'Going there with the team and doing the first deals together', loadings: EO_B },
      { key: 'launch', label: 'Designing and running the launch plan myself', loadings: GC_A },
      { key: 'playbook', label: 'Building the playbook the team repeats in each new market', loadings: SB_B },
    ],
    reask_prompt: 'Is that still where you are most useful when a client enters a new market?',
  }),
  pickOne({
    key: 'pick_good_week',
    prompt: 'Think of a good week with a client. What filled most of it?',
    choices: [
      { key: 'hands_on', label: 'Hands-on work inside their team', loadings: EO_A },
      { key: 'connecting', label: 'Conversations that connected them to the right people', loadings: SC_A },
      { key: 'experiments', label: 'Launching and tuning growth experiments', loadings: GC_C },
      { key: 'repeatable', label: 'Turning what we learned into a repeatable process', loadings: SB_C },
    ],
    reask_prompt: 'Does a good week with a client still look like that?',
  }),
];

/**
 * Reverse-keyed probes (§3.2: at least two per trait). A high answer means
 * LESS of the trait; the engine scores it as 5 − answer and checks it against
 * the plain probes on the same trait.
 */
const PARTNER_REVERSED: FitRowSpec[] = [
  // The first four cover one trait each, in trait order; the bank places
  // them before the situations and the second four after.
  reverseKeyed({
    key: 'rev_builder_hand_off',
    trait: 'builder',
    prompt: 'When a client needs something made, how much would you rather scope it and hand it to someone else to build?',
    hint: '0 = I would rather make it myself, 5 = I would rather hand it off.',
    reask_prompt: 'Would you still rather scope the work and hand it to someone else to build?',
  }),
  reverseKeyed({
    key: 'rev_visionary_brief',
    trait: 'visionary',
    prompt: 'How content are you to deliver exactly the brief you were given, without reshaping where it points?',
    hint: '0 = I always reshape the brief, 5 = I deliver the brief as written.',
    reask_prompt: 'Are you still content to deliver the brief as written?',
  }),
  reverseKeyed({
    key: 'rev_connector_solo',
    trait: 'connector',
    prompt: 'How much would you rather solve a client’s problem yourself than find the person who already has?',
    hint: '0 = I find the person, 5 = I solve it myself.',
    reask_prompt: 'Would you still rather solve it yourself than find the person who already has?',
  }),
  reverseKeyed({
    key: 'rev_operator_no_process',
    trait: 'operator',
    prompt: 'How comfortable are you leaving a client with no written process, as long as the result landed?',
    hint: '0 = not at all, 5 = completely comfortable.',
    reask_prompt: 'Are you still comfortable leaving without a written process when the result landed?',
  }),
  reverseKeyed({
    key: 'rev_builder_conversation',
    trait: 'builder',
    prompt: 'How much of your best work with a client happens in conversation rather than in the work itself?',
    hint: '0 = almost none, 5 = nearly all of it.',
    reask_prompt: 'Does most of your best client work still happen in conversation?',
  }),
  reverseKeyed({
    key: 'rev_visionary_quarter',
    trait: 'visionary',
    prompt: 'How much do you keep your attention on this quarter’s deliverables rather than on where the client could be in three years?',
    hint: '0 = I look years ahead, 5 = this quarter is my whole horizon.',
    reask_prompt: 'Is this quarter still where your attention stays with a client?',
  }),
  reverseKeyed({
    key: 'rev_connector_small_circle',
    trait: 'connector',
    prompt: 'How happy are you working with the same few people on the client side rather than widening the circle?',
    hint: '0 = I always widen it, 5 = the same few people suit me.',
    reask_prompt: 'Do you still prefer working with the same few people on the client side?',
  }),
  reverseKeyed({
    key: 'rev_operator_improvise',
    trait: 'operator',
    prompt: 'How much do you prefer improvising each engagement over running the same playbook?',
    hint: '0 = I run the playbook, 5 = I improvise every time.',
    reask_prompt: 'Do you still prefer to improvise each engagement?',
  }),
];

/** Behavioural skill questions for the three radar axes this bank lacked. */
const PARTNER_SKILLS: FitRowSpec[] = [
  {
    key: 'skill_engineering_review',
    prompt: 'In the last year, how often did you review a client’s technical plan or architecture and change what they built?',
    hint: SCALE_OFTEN,
    measures: { skill_axis: 'engineering' },
    reask_prompt: 'Are you still reviewing clients’ technical plans as often as before?',
  },
  {
    key: 'skill_design_feedback',
    prompt: 'In the last year, how often did you give a client design feedback, on product flows, screens or a brand, that they acted on?',
    hint: SCALE_OFTEN,
    measures: { skill_axis: 'design' },
    reask_prompt: 'Are you still giving clients design feedback they act on as often as before?',
  },
  {
    key: 'skill_marketing_delivery',
    prompt: 'In the last year, how often did you shape or run a client’s positioning, messaging or launch campaign?',
    hint: SCALE_OFTEN,
    measures: { skill_axis: 'marketing_brand' },
    reask_prompt: 'Are you still shaping clients’ positioning and launches as often as before?',
  },
];

/**
 * Behavioural variants of the partner's value dimensions (§6: partner asks
 * autonomy_vs_structure and Schwartz benevolence, self_direction and
 * universalism; achievement is added here so Session 14 can compare it with
 * the investor's). Same slugs as the other banks, same direction: 5 is the
 * dimension's high pole.
 */
const PARTNER_VALUES: FitRowSpec[] = [
  {
    key: 'val_founder_way',
    prompt: 'A founder wants to do it their way, and you think a more structured approach would work better. How likely are you to back their way and help it succeed?',
    hint: '0 = I push for the structure, 5 = I back the founder’s way.',
    measures: { value_dim: 'founder_autonomy_vs_structure' },
    reask_prompt: 'Would you still back a founder’s way over the structure you prefer?',
  },
  {
    key: 'val_measurable_target',
    prompt: 'In the last year, how often did you set yourself a measurable target on an engagement and track whether you hit it?',
    hint: SCALE_OFTEN,
    measures: { value_dim: 'schwartz_achievement' },
    reask_prompt: 'Do you still set yourself measurable targets on an engagement?',
  },
  {
    key: 'val_budget_runs_out',
    prompt: 'A client runs out of budget before the work is finished. How likely are you to keep helping informally until they are back on their feet?',
    hint: SCALE_LIKELY,
    measures: { value_dim: 'schwartz_benevolence' },
    reask_prompt: 'Would you still keep helping a client whose budget ran out?',
  },
  {
    key: 'val_off_brief',
    prompt: 'A client hands you a tightly defined brief. How likely are you to propose a different way of doing it that you believe in more?',
    hint: SCALE_LIKELY,
    measures: { value_dim: 'schwartz_self_direction' },
    reask_prompt: 'Would you still propose your own way against a tight brief?',
  },
  {
    key: 'val_turn_down',
    prompt: 'A well-paid engagement would help a company you think does real harm. How likely are you to turn it down?',
    hint: SCALE_LIKELY,
    measures: { value_dim: 'schwartz_universalism' },
    reask_prompt: 'Would you still turn down well-paid work for a company you think does harm?',
  },
];

/**
 * Behavioural variants of the six Axal values: a situation, then how likely
 * you are to act. They average with the shared self-ratings (§7.2); the red
 * flags stay on the shared rows, so a flag is never counted twice.
 */
const PARTNER_AXAL: FitRowSpec[] = [
  {
    key: 'axal_pt_own_mistake',
    prompt: 'You find a mistake in work you already delivered, and the client has not noticed. How likely are you to tell them before they find it?',
    hint: SCALE_LIKELY,
    measures: { axal_value: 'integrity' },
    reask_prompt: 'Would you still tell a client about a mistake they had not noticed?',
  },
  {
    key: 'axal_pt_extend_or_not',
    prompt: 'A client offers to extend your engagement, but you think the money would do more elsewhere in their business. How likely are you to tell them so?',
    hint: SCALE_LIKELY,
    measures: { axal_value: 'stewardship' },
    reask_prompt: 'Would you still tell a client their money would do more elsewhere?',
  },
  {
    key: 'axal_pt_test_pushback',
    prompt: 'A founder pushes back on your approach. How often do you test whether they are right before defending it?',
    hint: SCALE_OFTEN,
    measures: { axal_value: 'curiosity' },
    reask_prompt: 'Do you still test a founder’s pushback before defending your approach?',
  },
  {
    key: 'axal_pt_client_walks',
    prompt: 'A client you worked hard for walks away mid-engagement. How quickly are you giving full effort to your other clients again?',
    hint: '0 = it takes me weeks, 5 = the same week.',
    measures: { axal_value: 'resilience' },
    reask_prompt: 'Is that still how quickly you are back to full effort after losing a client?',
  },
  {
    key: 'axal_pt_founders_win',
    prompt: 'A result you drove is presented to the board as the founder’s win. How comfortable are you with that?',
    hint: '0 = it bothers me, 5 = that is how it should be.',
    measures: { axal_value: 'collaboration' },
    reask_prompt: 'Are you still comfortable when a result you drove is presented as the founder’s win?',
  },
  {
    key: 'axal_pt_stretch_scope',
    prompt: 'When you scope an engagement, how often do you aim for an outcome that would change the client’s trajectory, rather than one you are sure to hit?',
    hint: SCALE_OFTEN,
    measures: { axal_value: 'ambition' },
    reask_prompt: 'Do you still scope engagements for the outcome that would change a client’s trajectory?',
  },
];

/**
 * Re-ask wording (§7.3) for every question this bank already had, including
 * the shared rows from fitShared.ts, worded for a partner. A check-in, not a
 * retest. Applied only where a row has none of its own.
 */
export const PARTNER_REASK: Record<string, string> = {
  strat_thesis: 'Does your focus still overlap with the companies the studio builds?',
  strat_portfolio_fit: 'Do you still tailor your support to where each company actually is?',
  trust_reliability: 'Do your deliverables still land on time as reliably as before?',
  trust_confidentiality: 'Is protecting what clients share with you still as tight as before?',
  network_depth: 'Is the network you can open for companies still as deep and relevant?',
  network_activation: 'Do you still make the warm introductions you promise?',
  exec_hands_on: 'Are you still as willing to do the work alongside a founder?',
  exec_bandwidth: 'Is the bandwidth you give each company still realistic?',
  collab_style: 'Can you still collaborate without needing to be the most important person there?',
  collab_founder_led: 'Are you still comfortable letting the founder lead while you support?',
  rep_track_record: 'Are the companies you worked with still glad they did?',
  rep_conduct: 'Do you still treat client relationships as long-term?',
  skill_product: 'Is your product and technical judgement still where it was?',
  skill_finance_ops: 'Is the finance and operations side still where it was for you?',
  skill_legal: 'Is the legal and contractual side of the work still where it was for you?',
  val_benevolence: 'Does helping the teams you work with still drive you beyond the engagement?',
  val_self_direction: 'Do you still value the freedom to work your own way?',
  val_universalism: 'Do fairness and broader impact still shape the work you take on?',
  arch_builder: 'Is hands-on making still where you gravitate?',
  arch_builder_fix: 'When something breaks, do you still fix it yourself first?',
  arch_builder_craft: 'Does your credibility still come from work you made yourself?',
  arch_builder_ship: 'Do you still ship something tangible most weeks?',
  arch_builder_first: 'Would you still build the first version yourself?',
  arch_visionary: 'Does your energy still go to the long-range picture?',
  arch_visionary_pull: 'Do you still pull people toward a future that is not fully specified?',
  arch_visionary_bet: 'Do you still choose the bigger story over the safer next step?',
  arch_visionary_horizon: 'Is that still how far out you naturally plan?',
  arch_visionary_story: 'Does your influence still come from the story you tell?',
  arch_connector: 'Do you still create value mostly through people?',
  arch_connector_doors: 'Is opening doors and making introductions still a core move of yours?',
  arch_connector_first_call: 'When you are stuck, is calling someone still your first move?',
  arch_connector_rooms: 'Is that still where you come alive: rooms of people or deep solo work?',
  arch_connector_trust: 'Do you still turn new relationships into working alliances quickly?',
  arch_operator: 'Do you still run on process and systems rather than improvising?',
  arch_operator_cadence: 'Do you still install cadence and clear owners so heroics are rare?',
  arch_operator_gap: 'Does a missing process still pull you to install one?',
  arch_operator_owners: 'Does a task still need a named owner and a date before it feels real?',
  arch_operator_repeat: 'Do you still turn one-off wins into playbooks quickly?',
  arch_pt_trenches: 'Is most of your work still in the trenches, delivering?',
  arch_pt_hours: 'Is your value still hours of doing rather than frameworks?',
  arch_pt_momentum: 'Do you still turn early momentum into a growth motion?',
  arch_pt_scale: 'Do you still push companies from traction into growth?',
  arch_pt_people: 'Is lining up the right people still most of your impact?',
  arch_pt_broker: 'Is brokering alignment across organisations still a big part of your week?',
  arch_pt_machinery: 'Is what you leave behind still durable machinery?',
  arch_pt_process_leave: 'Do you still stay until a process exists that does not need you?',
  arch_illustration: 'Should we still draw your character as before?',
  axal_integrity: 'When something goes wrong on your watch, do you still own it fully?',
  axal_stewardship: 'Do you still protect other people’s money, time and trust?',
  axal_curiosity: 'Do you still go looking for evidence you might be wrong?',
  axal_resilience: 'Is that still how quickly you recover after a setback?',
  axal_collaboration: 'Do you still share credit readily?',
  axal_ambition: 'Are you still driven to build something lasting and significant?',
};

function withPartnerReask(rows: FitRowSpec[]): FitRowSpec[] {
  return rows.map((r) => (r.reask_prompt || !PARTNER_REASK[r.key] ? r : { ...r, reask_prompt: PARTNER_REASK[r.key] }));
}

export const FIT_PARTNER_BANK: Question[] = buildFitBank('partner', withPartnerReask([
  // ---- strategic_alignment --------------------------------------------
  { key: 'strat_thesis', prompt: 'How closely does your own focus overlap with the kinds of companies the studio builds?', measures: { rubric_category: 'strategic_alignment' } },
  { key: 'strat_portfolio_fit', prompt: 'How well do you tailor your support to where a company actually is, rather than a one-size playbook?', measures: { rubric_category: 'strategic_alignment' } },
  // ---- trustworthiness ------------------------------------------------
  { key: 'trust_reliability', prompt: 'When you commit to a deliverable for a portfolio company, how reliably does it land on time?', measures: { rubric_category: 'trustworthiness', red_flag: { key: 'poor_follow_through', at_or_below: 1 } } },
  { key: 'trust_confidentiality', prompt: 'How carefully do you protect sensitive information shared with you across companies?', measures: { rubric_category: 'trustworthiness', red_flag: { key: 'weak_ethics', at_or_below: 1 } } },
  // ---- network_quality ------------------------------------------------
  { key: 'network_depth', prompt: 'How deep and relevant is the network you can open up for the companies you support?', measures: { rubric_category: 'network_quality', skill_axis: 'capital_network' } },
  { key: 'network_activation', prompt: 'How readily do you actually make warm introductions rather than just promising them?', measures: { rubric_category: 'network_quality' } },
  // ---- execution_support ----------------------------------------------
  { key: 'exec_hands_on', prompt: 'How willing are you to roll up your sleeves and do the work alongside a founder, not just advise?', measures: { rubric_category: 'execution_support', skill_axis: 'gtm_sales' } },
  { key: 'exec_bandwidth', prompt: 'How realistic is the bandwidth you can give each company you take on?', measures: { rubric_category: 'execution_support' } },
  // ---- collaboration_style --------------------------------------------
  { key: 'collab_style', prompt: 'How well do you collaborate without needing to be the most important person in the room?', measures: { rubric_category: 'collaboration_style', red_flag: { key: 'ego_over_collaboration', at_or_below: 1 } } },
  { key: 'collab_founder_led', prompt: 'How comfortable are you letting the founder lead while you support from beside them?', hint: '0 = prefers clear structure, 5 = thrives in founder-led autonomy.', measures: { rubric_category: 'collaboration_style', value_dim: 'founder_autonomy_vs_structure' } },
  // ---- reputation -----------------------------------------------------
  { key: 'rep_track_record', prompt: 'How strong is your track record of companies that are glad they worked with you?', measures: { rubric_category: 'reputation' } },
  { key: 'rep_conduct', prompt: 'How consistently do you treat relationships as long-term rather than purely transactional?', measures: { rubric_category: 'reputation', red_flag: { key: 'transactional', at_or_below: 1 } } },
  // ---- skills breadth (service surface beyond network/GTM) ------------
  // Task #45 — partners deliver across product, ops, and legal too; broaden
  // the radar past capital_network / gtm_sales so it has real shape.
  { key: 'skill_product', prompt: 'How strong is your product and technical judgement when advising a company?', hint: '0 = not my strength, 5 = a real strength.', measures: { skill_axis: 'product' } },
  { key: 'skill_finance_ops', prompt: 'How strong are you on the finance and operations side — planning, hiring, process?', hint: '0 = not my strength, 5 = a real strength.', measures: { skill_axis: 'finance_ops' } },
  { key: 'skill_legal', prompt: 'How comfortable are you with the legal, compliance, and contractual side of the work?', hint: '0 = not my strength, 5 = a real strength.', measures: { skill_axis: 'legal_compliance' } },
  // D491 — the three radar axes this bank never asked about.
  ...PARTNER_SKILLS,
  // ---- work values (Schwartz dims for a rounded values wheel) ---------
  { key: 'val_benevolence', prompt: 'How much does genuinely helping the teams you work with drive you, beyond the engagement?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_benevolence' } },
  { key: 'val_self_direction', prompt: 'How much do you value the freedom to work in your own way rather than to a fixed brief?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_self_direction' } },
  { key: 'val_universalism', prompt: 'How much do fairness and broader impact shape which engagements you take on?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_universalism' } },
  // D491 — the same dimensions asked as situations, plus achievement.
  ...PARTNER_VALUES,
  // ---- archetype: D491 items first (see the header for why) ------------
  // One reverse-keyed probe per trait fills each trait's gap; the close-pair
  // situations come next, so they are what a person answers on the way to
  // the floor; the second reverse-keyed probe per trait follows.
  ...PARTNER_REVERSED.slice(0, 4),
  ...PARTNER_SITUATIONS,
  ...PARTNER_REVERSED.slice(4),
  // ---- archetype traits + illustration sex ---------------------------
  ...archetypeModuleRows('partner'),
  // ---- Axal values ----------------------------------------------------
  ...axalValueRows(),
  // D491 — each Axal value asked as a situation.
  ...PARTNER_AXAL,
]));
