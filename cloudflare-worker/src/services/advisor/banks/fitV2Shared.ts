/**
 * Fit v2 — shared bank builder + the role-agnostic question modules.
 *
 * Layer separation is the whole point: Values rows answer "what do they
 * optimize for", Archetype rows answer "how do they operate" (preference, no
 * right answers), Skills rows answer "what can they reliably execute", and
 * Validation rows exist only to test the consistency/evidence of the rest.
 * The engine (services/fitDecision.ts) scores each layer independently and
 * only the decision rubric combines them.
 *
 * Authoring rules:
 *   - ids become `fit.<prefix>.v2_<key>` — five-persona prefixes ride every
 *     v1 rail (FIT_ID_RE) for free; internal_hire / portfolio_talent prefixes
 *     are invisible to v1 by construction.
 *   - every row keeps chat-safe v1 fields (input_kind/options/validate) so
 *     the conversational advisor can serve it; the staged /fit flow reads the
 *     richer `fit_v2` spec (per-option loads, validation pairs, evidence).
 *   - `measures` appears ONLY where it truthfully feeds v1: archetype_trait
 *     on the four v1 trait likerts, red_flag on the classic value probes.
 *     Everything else is v2-only so v1 scores cannot drift.
 *   - option `loads` use namespaced dimension keys (`value:*`, `trait:*`,
 *     `skill:*`, `rubric:*`) — see fitDecision.primaryDimension.
 *
 * Counts (pinned by test/fitBankV2.test.ts): values 30, archetypes 24,
 * skills 24, validation 16, context 3, role add-ons 8 per role.
 */
import type { FitMeasures, FitV2Kind, FitV2Spec, Persona, Question } from '../questionBank.ts';

export const FIT_V2_SCALE_HINT = 'No wrong answers — rate 0 (not at all) to 5 (completely).';
const EVIDENCE_HINT = 'A real, specific story beats a polished summary — names, numbers, and dates welcome.';
const RANK_HINT = 'Order the options from most like you to least like you.';

export interface FitV2Row {
  key: string;
  prompt: string;
  hint?: string;
  spec: FitV2Spec;
  measures?: FitMeasures;
}

const KIND_INPUT: Record<FitV2Kind, Question['input_kind']> = {
  likert: 'scale',
  confidence_check: 'scale',
  forced_choice: 'select',
  sjt: 'select',
  tradeoff: 'select',
  rank_order: 'select',
  multi_select: 'multi',
  behavioral_evidence: 'long',
};

const KIND_VALIDATE: Record<FitV2Kind, NonNullable<Question['validate']>> = {
  likert: 'scale',
  confidence_check: 'scale',
  forced_choice: 'select',
  sjt: 'select',
  tradeoff: 'select',
  rank_order: 'select',
  multi_select: 'multi',
  behavioral_evidence: 'long',
};

const KIND_UI: Record<FitV2Kind, NonNullable<FitV2Spec['ui']>> = {
  likert: 'slider',
  confidence_check: 'slider',
  forced_choice: 'dilemma',
  sjt: 'sjt',
  tradeoff: 'dilemma',
  rank_order: 'card_sort',
  multi_select: 'pills',
  behavioral_evidence: 'reflection',
};

const KIND_HINT: Partial<Record<FitV2Kind, string>> = {
  likert: FIT_V2_SCALE_HINT,
  confidence_check: FIT_V2_SCALE_HINT,
  behavioral_evidence: EVIDENCE_HINT,
  rank_order: RANK_HINT,
};

/**
 * Instantiate shared rows for one role prefix. `Question.persona` is the
 * advisor persona that may see the item conversationally; staged-only
 * prefixes pass their nearest persona but are never appended by bankFor.
 */
export function buildFitV2Bank(prefix: string, persona: Persona, rows: FitV2Row[]): Question[] {
  return rows.map((r) => {
    const spec: FitV2Spec = { ...r.spec, ui: r.spec.ui ?? KIND_UI[r.spec.kind] };
    if (spec.validation_pair && !spec.validation_pair.startsWith('fit.')) {
      spec.validation_pair = `fit.${prefix}.v2_${spec.validation_pair}`;
    }
    return {
      id: `fit.${prefix}.v2_${r.key}`,
      persona,
      section: 'FIT_V2',
      prompt: r.prompt,
      hint: r.hint ?? KIND_HINT[spec.kind],
      input_kind: KIND_INPUT[spec.kind],
      options: spec.options_v2?.map((o) => o.label),
      validate: KIND_VALIDATE[spec.kind],
      importance: 'low',
      skip_allowed: true,
      page_target: '/fit',
      doc_anchor: 'getting-started/personas',
      measures: r.measures,
      fit_v2: spec,
    } satisfies Question;
  });
}

// ---------------------------------------------------------------------------
// VALUES — 30 rows (5 per value × 6). Direct + indirect self-rating, a
// tradeoff under pressure, a behavioral-evidence probe, and an SJT each.
// ---------------------------------------------------------------------------

export function valuesV2Rows(): FitV2Row[] {
  const V = (key: string, rest: Omit<FitV2Row, 'key'>): FitV2Row => ({ key, ...rest });
  return [
    // -- integrity ----------------------------------------------------------
    V('val_integrity_direct', {
      prompt: 'When something fails on your watch, how fully do you own it — publicly and specifically — rather than pointing to circumstances or other people?',
      spec: {
        module: 'values', stage: 'values', kind: 'likert', mvp_core: true, value_key: 'integrity',
        signal_notes: {
          strong: 'Names their own decision as the cause before anyone asks.',
          weak: 'Ownership language arrives only after prompting, hedged by context.',
          contradiction: 'High rating + blame-shaped stories in the evidence probes.',
        },
        followup_prompts: ['What did owning it cost you that time?'],
      },
      measures: { red_flag: { key: 'blame_shifting', at_or_below: 1 } },
    }),
    V('val_integrity_kept', {
      prompt: 'Across the last year, what share of the commitments you made to other people landed exactly as promised?',
      hint: '0 = few of them, 5 = essentially all of them.',
      spec: {
        module: 'values', stage: 'values', kind: 'likert', value_key: 'integrity',
        signal_notes: { strong: 'Comfortable being pinned to a number.', weak: 'Reframes the question toward intent instead of delivery.' },
      },
    }),
    V('val_integrity_trade', {
      prompt: 'A key metric slipped badly the week before your investor update. Which is closest to your instinct?',
      spec: {
        module: 'values', stage: 'values', kind: 'tradeoff', mvp_core: true, chat_core: true, value_key: 'integrity',
        options_v2: [
          { key: 'report_plain', label: 'Report it plainly, with the recovery plan attached', score: 5 },
          { key: 'reframe_wins', label: 'Reframe the update around wins and mention it briefly', score: 2 },
          { key: 'hold_cycle', label: 'Hold it back one cycle while we fix it', score: 0, flag: 'weak_ethics' },
        ],
        signal_notes: { strong: 'Plain reporting chosen without hesitation.', contradiction: 'Chooses concealment while rating integrity 4-5.' },
      },
    }),
    V('val_integrity_evidence', {
      prompt: 'Tell me about a specific time you took a real cost — money, status, a deal — to keep your word or correct a mistake. What happened?',
      spec: {
        module: 'values', stage: 'values', kind: 'behavioral_evidence', mvp_core: true, value_key: 'integrity',
        evidence: { required: true, min_len: 120, probe: 'example' },
        signal_notes: { strong: 'Concrete cost, named counterparty, verifiable outcome.', weak: 'Abstract principles with no incident attached.' },
        followup_prompts: ['Who could confirm that account?', 'What would you do differently now?'],
      },
    }),
    V('val_integrity_sjt', {
      prompt: 'You discover a teammate quietly inflated pilot results in a customer deck that already went out. You…',
      spec: {
        module: 'values', stage: 'values', kind: 'sjt', value_key: 'integrity',
        options_v2: [
          { key: 'correct_customer', label: 'Correct the record with the customer and fix the process', score: 5 },
          { key: 'fix_internal', label: 'Fix it internally; the customer relationship is too fragile to reopen it', score: 2 },
          { key: 'let_ride', label: 'Let it ride this quarter — the real numbers will catch up', score: 0, flag: 'weak_ethics' },
        ],
      },
    }),

    // -- stewardship --------------------------------------------------------
    V('val_stewardship_direct', {
      prompt: "How much do you treat other people's money, time, and trust as something to protect rather than something to spend?",
      spec: {
        module: 'values', stage: 'values', kind: 'likert', mvp_core: true, value_key: 'stewardship',
        signal_notes: { strong: 'Talks about downside protection unprompted.', weak: 'Treats resources as fuel for personal trajectory.' },
      },
      measures: { red_flag: { key: 'transactional', at_or_below: 1 } },
    }),
    V('val_stewardship_burn', {
      prompt: "When you control someone else's budget, how differently do you spend it than if the downside were your own?",
      hint: '0 = more freely than my own, 5 = more carefully than my own.',
      spec: { module: 'values', stage: 'values', kind: 'likert', value_key: 'stewardship' },
    }),
    V('val_stewardship_trade', {
      prompt: 'Your budget can fund either a high-visibility launch event or two more months of runway for experiments. Default instinct?',
      spec: {
        module: 'values', stage: 'values', kind: 'tradeoff', mvp_core: true, chat_core: true, value_key: 'stewardship',
        options_v2: [
          { key: 'runway', label: 'The runway — visibility can wait, learning cannot', score: 5 },
          { key: 'split', label: 'Split it — some signal now, some runway kept', score: 3 },
          { key: 'event', label: 'The event — momentum and perception compound', score: 1 },
        ],
      },
    }),
    V('val_stewardship_evidence', {
      prompt: "Describe a time you protected someone else's money, time, or reputation when spending it would have benefited you.",
      spec: {
        module: 'values', stage: 'values', kind: 'behavioral_evidence', mvp_core: true, value_key: 'stewardship',
        evidence: { required: true, min_len: 120, probe: 'example' },
        followup_prompts: ['Did the owner of that trust ever find out?'],
      },
    }),
    V('val_stewardship_sjt', {
      prompt: 'A departing client asks you to keep working with data they are not entitled to take. The relationship is lucrative. You…',
      spec: {
        module: 'values', stage: 'values', kind: 'sjt', value_key: 'stewardship',
        options_v2: [
          { key: 'decline_flag', label: 'Decline and tell the data owner what was asked', score: 5 },
          { key: 'decline_quiet', label: 'Decline quietly and keep the relationship warm', score: 3 },
          { key: 'grey_zone', label: 'Find a defensible grey-zone way to keep the engagement', score: 0, flag: 'weak_ethics' },
        ],
      },
    }),

    // -- curiosity ----------------------------------------------------------
    V('val_curiosity_direct', {
      prompt: 'How actively do you go looking for evidence that you might be wrong?',
      spec: {
        module: 'values', stage: 'values', kind: 'likert', mvp_core: true, value_key: 'curiosity',
        signal_notes: { strong: 'Can name their current strongest counter-argument.', weak: '"I\'m very open-minded" with no live example.' },
        followup_prompts: ['What are you actively trying to disprove right now?'],
      },
    }),
    V('val_curiosity_update', {
      prompt: 'When strong evidence contradicts a position you have defended publicly, how quickly do you update — and say so out loud?',
      spec: { module: 'values', stage: 'values', kind: 'likert', value_key: 'curiosity' },
    }),
    V('val_curiosity_trade', {
      prompt: 'Before committing to a big strategy, which do you actually do most often?',
      spec: {
        module: 'values', stage: 'values', kind: 'tradeoff', mvp_core: true, chat_core: true, value_key: 'curiosity',
        options_v2: [
          { key: 'seek_critic', label: 'Hunt down the strongest argument against it', score: 5 },
          { key: 'stress_supporters', label: 'Stress-test it with people who broadly agree', score: 2.5 },
          { key: 'commit_iterate', label: 'Commit fast and let reality do the arguing', score: 1.5 },
        ],
      },
    }),
    V('val_curiosity_evidence', {
      prompt: 'Tell me about the last significant belief you changed your mind on because of evidence. What was the evidence?',
      spec: {
        module: 'values', stage: 'values', kind: 'behavioral_evidence', mvp_core: true, value_key: 'curiosity',
        evidence: { required: true, min_len: 100, probe: 'example' },
        signal_notes: { strong: 'A real reversal with a date and a cost.', weak: 'A "belief" that conveniently flatters them either way.' },
      },
    }),
    V('val_curiosity_sjt', {
      prompt: 'Fresh user research undercuts the roadmap you spent a month selling internally. You…',
      spec: {
        module: 'values', stage: 'values', kind: 'sjt', value_key: 'curiosity',
        options_v2: [
          { key: 'replan_public', label: 'Surface it, re-plan openly, credit the research', score: 5 },
          { key: 'quiet_adjust', label: 'Adjust quietly over the next two sprints', score: 2.5 },
          { key: 'defend_plan', label: 'Defend the plan — one study should not swing strategy', score: 1 },
        ],
      },
    }),

    // -- resilience ---------------------------------------------------------
    V('val_resilience_direct', {
      prompt: 'After a genuine setback, how quickly do you recover and get execution moving again?',
      spec: {
        module: 'values', stage: 'values', kind: 'likert', mvp_core: true, value_key: 'resilience',
        signal_notes: { strong: 'Describes a repeatable recovery routine.', weak: 'Recovery depends on external rescue or long withdrawal.' },
      },
    }),
    V('val_resilience_pace', {
      prompt: 'How sustainable is your current operating pace — could you hold it for years, not just a sprint?',
      spec: { module: 'values', stage: 'values', kind: 'likert', value_key: 'resilience' },
    }),
    V('val_resilience_trade', {
      prompt: 'A funding round you counted on just collapsed. What do the first 48 hours actually look like?',
      spec: {
        module: 'values', stage: 'values', kind: 'tradeoff', mvp_core: true, chat_core: true, value_key: 'resilience',
        options_v2: [
          { key: 'replan_comms', label: 'Re-plan the runway and tell the team the truth with a path', score: 5 },
          { key: 'pause_recover', label: 'Take a beat to recover, then re-plan deliberately', score: 3.5 },
          { key: 'escalate_everything', label: 'Escalate pace on everything at once until something works', score: 1.5 },
        ],
      },
    }),
    V('val_resilience_evidence', {
      prompt: 'Describe your hardest professional setback — and specifically what you did in the two weeks that followed.',
      spec: {
        module: 'values', stage: 'values', kind: 'behavioral_evidence', mvp_core: true, value_key: 'resilience',
        evidence: { required: true, min_len: 120, probe: 'example' },
        followup_prompts: ['What still works today that you built in those two weeks?'],
      },
    }),
    V('val_resilience_sjt', {
      prompt: 'Your co-founder quits the week a flagship customer churns. The team is watching you. You…',
      spec: {
        module: 'values', stage: 'values', kind: 'sjt', value_key: 'resilience',
        options_v2: [
          { key: 'stabilize', label: 'Stabilize: honest all-hands, 30-day plan, personal check-ins', score: 5 },
          { key: 'heads_down', label: 'Go heads-down and outwork it; the team follows energy', score: 2.5 },
          { key: 'minimize', label: 'Downplay both events to protect morale', score: 1 },
        ],
      },
    }),

    // -- collaboration ------------------------------------------------------
    V('val_collab_direct', {
      prompt: 'How readily do you share credit and put the mission ahead of being the one who is right?',
      spec: {
        module: 'values', stage: 'values', kind: 'likert', mvp_core: true, value_key: 'collaboration',
        signal_notes: { strong: 'Stories star other people.', weak: 'Every anecdote has one hero.' },
      },
      measures: { red_flag: { key: 'ego_over_collaboration', at_or_below: 1 } },
    }),
    V('val_collab_credit', {
      prompt: 'When a win lands, how instinctively do you push the spotlight onto the people who did the work?',
      spec: { module: 'values', stage: 'values', kind: 'likert', value_key: 'collaboration' },
    }),
    V('val_collab_trade', {
      prompt: 'You own a decision and a strong peer disagrees hard. Which is closest to what you do?',
      spec: {
        module: 'values', stage: 'values', kind: 'tradeoff', mvp_core: true, chat_core: true, value_key: 'collaboration',
        options_v2: [
          { key: 'decide_carry', label: 'Decide — but carry their strongest point into the plan, credited', score: 5 },
          { key: 'defer_consensus', label: 'Work it until we agree, even if it costs the timeline', score: 2.5 },
          { key: 'decide_move', label: 'Decide and move; explaining costs time we do not have', score: 1 },
        ],
      },
    }),
    V('val_collab_evidence', {
      prompt: 'Tell me about a time you materially helped someone else win when there was nothing in it for you.',
      spec: {
        module: 'values', stage: 'values', kind: 'behavioral_evidence', mvp_core: true, value_key: 'collaboration',
        evidence: { required: true, min_len: 100, probe: 'example' },
      },
    }),
    V('val_collab_sjt', {
      prompt: 'A board member publicly credits you for work your teammate led. In the moment, you…',
      spec: {
        module: 'values', stage: 'values', kind: 'sjt', value_key: 'collaboration',
        options_v2: [
          { key: 'redirect_now', label: 'Redirect the credit right there, by name', score: 5 },
          { key: 'correct_later', label: 'Accept gracefully, correct the record privately afterwards', score: 3 },
          { key: 'accept', label: 'Accept it — leadership means representing the team', score: 1 },
        ],
      },
    }),

    // -- ambition (net-new v2 value) ----------------------------------------
    V('val_ambition_direct', {
      prompt: 'How much are you playing a long game — building something that compounds for a decade rather than something that flips in two years?',
      hint: '0 = quick outcomes, 5 = decade-scale compounding.',
      spec: {
        module: 'values', stage: 'values', kind: 'likert', mvp_core: true, chat_core: true, value_key: 'ambition',
        signal_notes: { strong: 'Concrete multi-year commitments already in motion.', weak: 'Long-term language, short-term behavior.' },
        followup_prompts: ['What are you doing this quarter that only pays off in three years?'],
      },
    }),
    V('val_ambition_standard', {
      prompt: "How high is the bar you hold when 'good enough' would already pass?",
      spec: { module: 'values', stage: 'values', kind: 'likert', value_key: 'ambition' },
    }),
    V('val_ambition_trade', {
      prompt: 'Two paths open: a quick win that peaks fast, or a slower path that compounds. Which do you actually take?',
      spec: {
        module: 'values', stage: 'values', kind: 'tradeoff', mvp_core: true, chat_core: true, value_key: 'ambition',
        options_v2: [
          { key: 'compound', label: 'The compounding path — durable advantage beats quick optics', score: 5 },
          { key: 'optionality', label: 'Whichever preserves the most optionality right now', score: 3 },
          { key: 'quick_win', label: 'The quick win — momentum today funds the long game', score: 1.5 },
        ],
      },
    }),
    V('val_ambition_evidence', {
      prompt: 'What is the longest game you have deliberately played — and what did you give up early on to keep playing it?',
      spec: {
        module: 'values', stage: 'values', kind: 'behavioral_evidence', mvp_core: true, value_key: 'ambition',
        evidence: { required: true, min_len: 100, probe: 'example' },
      },
    }),
    V('val_ambition_sjt', {
      prompt: 'Eighteen months in, a soft acqui-hire offer lands: decent outcome, mission ends. Runway is fine. You…',
      spec: {
        module: 'values', stage: 'values', kind: 'sjt', value_key: 'ambition',
        options_v2: [
          { key: 'decline_build', label: 'Decline — the compounding is just starting', score: 5 },
          { key: 'test_market', label: 'Use it to test the market and sharpen the plan', score: 3 },
          { key: 'take_it', label: 'Take it — a sure win now beats a maybe later', score: 1 },
        ],
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// ARCHETYPES — 24 rows: 6 direct + 6 indirect likerts, 6 forced-choice pairs,
// 6 SJTs. Preference measurement: options load traits, none is "better".
// ---------------------------------------------------------------------------

export function archetypeV2Rows(): FitV2Row[] {
  const A = (key: string, rest: Omit<FitV2Row, 'key'>): FitV2Row => ({ key, ...rest });
  const direct = (trait: string, prompt: string, hint: string, opts: { chat?: boolean; v1?: boolean } = {}): FitV2Row =>
    A(`arch_${trait}_direct`, {
      prompt,
      hint,
      spec: { module: 'archetypes', stage: 'archetypes', kind: 'likert', mvp_core: true, chat_core: opts.chat, trait },
      measures: opts.v1 ? { archetype_trait: trait } : undefined,
    });
  const indirect = (trait: string, prompt: string): FitV2Row =>
    A(`arch_${trait}_indirect`, {
      prompt,
      spec: { module: 'archetypes', stage: 'archetypes', kind: 'likert', trait },
    });
  const pair = (key: string, prompt: string, a: { key: string; label: string; trait: string }, b: { key: string; label: string; trait: string }): FitV2Row =>
    A(`arch_fc_${key}`, {
      prompt,
      hint: 'Both are legitimate — pick the one that is more you.',
      spec: {
        module: 'archetypes', stage: 'archetypes', kind: 'forced_choice', mvp_core: true, chat_core: true,
        options_v2: [
          { key: a.key, label: a.label, loads: { [`trait:${a.trait}`]: 4.5 } },
          { key: b.key, label: b.label, loads: { [`trait:${b.trait}`]: 4.5 } },
        ],
        signal_notes: { strong: 'Fast, unhedged pick.', weak: 'Wants both — probe with the SJTs.' },
      },
    });
  return [
    direct('builder', 'How much do you gravitate to hands-on making — building the thing yourself rather than directing from above?', '0 = I direct and delegate, 5 = I love being hands-on in the work.', { v1: true }),
    direct('visionary', 'How much of your energy goes to the long-range picture and narrative versus the immediate task in front of you?', '0 = the next task, 5 = the long-range vision.', { v1: true }),
    direct('connector', 'How central are people and relationships to how you create value — do you win mostly through your network?', '0 = mostly solo, 5 = mostly through people.', { v1: true }),
    direct('operator', 'How much do you rely on process, systems, and discipline rather than improvising as you go?', '0 = I improvise, 5 = process and systems.', { v1: true }),
    direct('scout', 'How much of your energy goes to exploring the frontier — new markets, tools, and ideas — before others get there?', '0 = exploit what is known, 5 = explore the frontier.', { chat: true }),
    direct('steward', 'How strongly do you feel personally responsible for protecting quality, trust, and downside — even when it slows things?', '0 = speed first, 5 = protection first.', { chat: true }),

    indirect('builder', 'Starting something new, how soon do you have a rough working version in your hands?'),
    indirect('visionary', 'How often do people come to you specifically to make sense of where things are heading?'),
    indirect('connector', 'How often is your first move on a hard problem to call someone rather than open a document?'),
    indirect('operator', 'How much calm do you get from a plan with owners, dates, and a cadence?'),
    indirect('scout', 'How often are you the first in your circle to spot a shift that later becomes obvious?'),
    indirect('steward', 'How often are you the one who catches the risk everyone else walked past?'),

    pair('build_vision', 'A new initiative kicks off this week. Which is closer to you?',
      { key: 'ship_v1', label: 'Ship a rough v1 by Friday and learn from contact', trait: 'builder' },
      { key: 'frame_first', label: 'Get the strategy and story right before anything ships', trait: 'visionary' }),
    pair('connect_operate', 'When a team stalls, which is more your move?',
      { key: 'mobilize', label: 'Mobilize people — energy and the right introductions', trait: 'connector' },
      { key: 'systematize', label: 'Fix the system — cadence, owners, and accountability', trait: 'operator' }),
    pair('scout_steward', 'With one free day a month, which do you actually spend it on?',
      { key: 'frontier', label: 'Scouting the frontier for the next edge', trait: 'scout' },
      { key: 'protect', label: 'Hardening and protecting what we have already built', trait: 'steward' }),
    pair('build_operate', 'Which compliment lands better?',
      { key: 'made_thing', label: '“You made the thing.”', trait: 'builder' },
      { key: 'made_machine', label: '“You built the machine that makes the thing.”', trait: 'operator' }),
    pair('vision_scout', 'Facing an uncertain market, which is more you?',
      { key: 'commit_future', label: 'Commit to one future and bend reality toward it', trait: 'visionary' },
      { key: 'keep_scanning', label: 'Keep scanning until the signal is undeniable', trait: 'scout' }),
    pair('connect_steward', 'Your network is an asset. Which instinct is stronger?',
      { key: 'open_doors', label: 'Open more doors — breadth compounds', trait: 'connector' },
      { key: 'deepen_trust', label: 'Deepen and protect the trust already there', trait: 'steward' }),

    A('arch_sjt_ambiguity', {
      prompt: 'You are dropped into a fuzzy, high-stakes project with no brief. What does your first week actually look like?',
      spec: {
        module: 'archetypes', stage: 'archetypes', kind: 'sjt', mvp_core: true, chat_core: true,
        options_v2: [
          { key: 'prototype', label: 'Build a scrappy prototype to make the problem concrete', loads: { 'trait:builder': 4.5 } },
          { key: 'stakeholders', label: 'Map the people, recruit allies, and build momentum', loads: { 'trait:connector': 4.5 } },
          { key: 'endstates', label: 'Frame the three plausible end-states and pick a bet', loads: { 'trait:visionary': 4.5 } },
          { key: 'workplan', label: 'Define the workplan, owners, and first milestones', loads: { 'trait:operator': 4.5 } },
        ],
      },
    }),
    A('arch_sjt_crisis', {
      prompt: 'A critical launch is visibly failing at 9pm. Your honest first move?',
      spec: {
        module: 'archetypes', stage: 'archetypes', kind: 'sjt', mvp_core: true, chat_core: true,
        options_v2: [
          { key: 'dive_in', label: 'Dive in and fix it with my own hands', loads: { 'trait:builder': 4.5 } },
          { key: 'triage', label: 'Run triage — sequence the fixes and assign them', loads: { 'trait:operator': 4.5 } },
          { key: 'call_expert', label: 'Get the one person who has solved this on the phone', loads: { 'trait:connector': 4.5 } },
          { key: 'halt_protect', label: 'Halt the launch — protecting users beats saving face', loads: { 'trait:steward': 4.5 } },
        ],
      },
    }),
    A('arch_sjt_growth', {
      prompt: 'Growth has flatlined for two quarters. Where do you instinctively look first?',
      spec: {
        module: 'archetypes', stage: 'archetypes', kind: 'sjt',
        options_v2: [
          { key: 'new_segment', label: 'A market or segment nobody has priced in yet', loads: { 'trait:scout': 4.5 } },
          { key: 'reposition', label: 'The story — reposition what we already have', loads: { 'trait:visionary': 4 } },
          { key: 'funnel_fix', label: 'The funnel — instrument it and fix the leaks', loads: { 'trait:operator': 4 } },
          { key: 'product_bet', label: 'The product — build the missing wedge feature', loads: { 'trait:builder': 4 } },
        ],
      },
    }),
    A('arch_sjt_conflict', {
      prompt: 'Two senior people you respect are locked in a real disagreement that is slowing the team. You…',
      spec: {
        module: 'archetypes', stage: 'archetypes', kind: 'sjt',
        options_v2: [
          { key: 'broker', label: 'Broker it — get them in a room and translate', loads: { 'trait:connector': 4.5 } },
          { key: 'decide_criteria', label: 'Define the decision criteria and force a call', loads: { 'trait:operator': 4 } },
          { key: 'zoom_out', label: 'Reframe upward — both positions serve a bigger picture', loads: { 'trait:visionary': 4 } },
          { key: 'protect_team', label: 'Contain the blast radius and protect the team first', loads: { 'trait:steward': 4 } },
        ],
      },
    }),
    A('arch_sjt_newmarket', {
      prompt: 'You get three months and a small budget to explore a brand-new market. Day one?',
      spec: {
        module: 'archetypes', stage: 'archetypes', kind: 'sjt',
        options_v2: [
          { key: 'field_scan', label: 'Go to the field — 30 conversations before any thesis', loads: { 'trait:scout': 4.5 } },
          { key: 'thesis_first', label: 'Write the thesis, then hunt for disconfirmation', loads: { 'trait:visionary': 4 } },
          { key: 'insider_net', label: 'Recruit two insiders who already live in that market', loads: { 'trait:connector': 4 } },
          { key: 'probe_product', label: 'Ship a landing-page probe and buy real signal', loads: { 'trait:builder': 4 } },
        ],
      },
    }),
    A('arch_sjt_scale', {
      prompt: 'The thing you built is suddenly working — demand is 5× capacity. Your instinct?',
      spec: {
        module: 'archetypes', stage: 'archetypes', kind: 'sjt',
        options_v2: [
          { key: 'build_system', label: 'Build the operating system: hiring plan, process, cadence', loads: { 'trait:operator': 4.5 } },
          { key: 'guard_quality', label: 'Gate growth to protect quality and the early promise', loads: { 'trait:steward': 4.5 } },
          { key: 'automate', label: 'Automate the bottleneck myself before we hire into it', loads: { 'trait:builder': 4 } },
          { key: 'partner_up', label: 'Find the partner who has scaled this before', loads: { 'trait:connector': 4 } },
        ],
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// SKILLS — 24 rows: 10 self-ratings, 5 scenario probes, 5 evidence probes,
// 4 recency checks. Claims without evidence are capped by the engine.
// ---------------------------------------------------------------------------

export function skillsV2Rows(): FitV2Row[] {
  const S = (key: string, rest: Omit<FitV2Row, 'key'>): FitV2Row => ({ key, ...rest });
  const self = (slug: string, short: string, prompt: string): FitV2Row =>
    S(`skill_${short}_self`, {
      prompt,
      hint: 'Anchor on the last 12 months, not your best-ever year. 0 = not my skill, 5 = I am the person others call.',
      spec: {
        module: 'skills', stage: 'skills', kind: 'likert', mvp_core: true,
        skill_v2: { slug },
        signal_notes: { contradiction: 'High rating with a thin or absent evidence probe.' },
      },
    });
  const recency = (slug: string, short: string, prompt: string): FitV2Row =>
    S(`skill_${short}_recency`, {
      prompt,
      hint: '0 = years ago / never, 5 = within the last quarter at a high level.',
      spec: { module: 'skills', stage: 'skills', kind: 'likert', skill_v2: { slug, weight: 0.6 } },
    });
  return [
    self('fitv2_fundraising_narrative', 'fundraising', 'Rate your evidenced ability to construct a capital narrative and actually close the round.'),
    self('fitv2_market_research', 'research', 'Rate your evidenced ability to size, segment, and map a market well enough to bet on it.'),
    self('fitv2_analytical_judgment', 'analytical', 'Rate your evidenced ability to reason from messy numbers to a defensible decision.'),
    self('fitv2_product_thinking', 'product', 'Rate your evidenced ability to pick the right problem, scope it, and iterate to product truth.'),
    self('fitv2_sales_relationships', 'sales', 'Rate your evidenced ability to open, advance, and close high-trust relationships or deals.'),
    self('fitv2_hiring', 'hiring', 'Rate your evidenced ability to attract, assess, and close talent better than you.'),
    self('fitv2_execution_management', 'execution', 'Rate your evidenced ability to turn plans into shipped outcomes on a reliable cadence.'),
    self('fitv2_communication', 'communication', 'Rate your evidenced ability to make a complex idea land — written and spoken, under pressure.'),
    self('fitv2_diligence', 'diligence', 'Rate your evidenced ability to verify claims: references, data rooms, primary checks.'),
    self('fitv2_strategic_synthesis', 'synthesis', 'Rate your evidenced ability to integrate noisy signals into one decision-ready view.'),

    S('skill_fundraising_sjt', {
      prompt: 'Three weeks into a raise: two soft passes, one term sheet at a valuation 40% below plan. Next move?',
      spec: {
        module: 'skills', stage: 'skills', kind: 'sjt', mvp_core: true,
        skill_v2: { slug: 'fitv2_fundraising_narrative' },
        options_v2: [
          { key: 'diagnose_narrative', label: 'Diagnose the narrative gap from the passes, re-cut the story, restart sequencing', score: 5 },
          { key: 'leverage_sheet', label: 'Use the sheet to create urgency with everyone else this week', score: 3.5 },
          { key: 'take_sheet', label: 'Take the sheet — certainty beats price at this stage', score: 2 },
          { key: 'push_metrics', label: 'Pause the raise and push metrics for two months', score: 2.5 },
        ],
      },
    }),
    S('skill_sales_sjt', {
      prompt: 'A flagship prospect goes quiet after a great demo. Two emails unanswered. You…',
      spec: {
        module: 'skills', stage: 'skills', kind: 'sjt',
        skill_v2: { slug: 'fitv2_sales_relationships' },
        options_v2: [
          { key: 'champion_map', label: 'Re-map the buying committee and activate a second champion', score: 5 },
          { key: 'value_recap', label: 'Send a crisp value recap with a dated next step', score: 3.5 },
          { key: 'breakup', label: 'Send the break-up email to force a response', score: 2.5 },
          { key: 'wait', label: 'Give it two more weeks — pushing reads as desperate', score: 1 },
        ],
      },
    }),
    S('skill_hiring_sjt', {
      prompt: 'Your top candidate aces interviews but a back-channel reference says “brilliant, corrosive”. You…',
      spec: {
        module: 'skills', stage: 'skills', kind: 'sjt', mvp_core: true,
        skill_v2: { slug: 'fitv2_hiring' },
        options_v2: [
          { key: 'structured_probe', label: 'Run two more targeted references and a structured behavioral probe on exactly that', score: 5 },
          { key: 'confront_direct', label: 'Put it to the candidate directly and weigh the response', score: 3.5 },
          { key: 'pass_safe', label: 'Pass — culture damage compounds faster than brilliance', score: 2.5 },
          { key: 'hire_manage', label: 'Hire and manage it — output like that is rare', score: 1 },
        ],
      },
    }),
    S('skill_diligence_sjt', {
      prompt: 'A deal you like claims “$40k MRR, 15% m/m”. The data room has a summary spreadsheet only. You…',
      spec: {
        module: 'skills', stage: 'skills', kind: 'sjt',
        skill_v2: { slug: 'fitv2_diligence' },
        options_v2: [
          { key: 'primary_pull', label: 'Ask for a read-only billing export and call three customers', score: 5 },
          { key: 'founder_walkthrough', label: 'Have the founder walk the spreadsheet live and probe the cohorts', score: 3.5 },
          { key: 'trust_reference', label: 'Lean on the lead investor’s diligence — they priced it', score: 1.5 },
          { key: 'pattern_match', label: 'The team quality is the real signal; move fast', score: 1 },
        ],
      },
    }),
    S('skill_execution_sjt', {
      prompt: 'Mid-quarter: the team is 60% to plan and morale is wobbling. Your first structural move?',
      spec: {
        module: 'skills', stage: 'skills', kind: 'sjt',
        skill_v2: { slug: 'fitv2_execution_management' },
        options_v2: [
          { key: 'cut_scope', label: 'Cut scope to the one thing that matters and re-baseline publicly', score: 5 },
          { key: 'weekly_cadence', label: 'Tighten the cadence: weekly commitments, visible scoreboard', score: 4 },
          { key: 'add_hours', label: 'Rally everyone to push harder for four weeks', score: 1.5 },
          { key: 'renegotiate', label: 'Renegotiate the plan with stakeholders before changing anything', score: 2.5 },
        ],
      },
    }),

    S('skill_product_evidence', {
      prompt: 'Describe a product call you made against internal pressure that later proved right. What signal did you trust?',
      spec: {
        module: 'skills', stage: 'skills', kind: 'behavioral_evidence', mvp_core: true,
        skill_v2: { slug: 'fitv2_product_thinking' },
        evidence: { required: true, min_len: 120, probe: 'example' },
      },
    }),
    S('skill_analytical_evidence', {
      prompt: 'Walk me through a decision where the numbers said one thing and instinct said another. What did you do, and what happened?',
      spec: {
        module: 'skills', stage: 'skills', kind: 'behavioral_evidence', mvp_core: true,
        skill_v2: { slug: 'fitv2_analytical_judgment' },
        evidence: { required: true, min_len: 120, probe: 'example' },
      },
    }),
    S('skill_communication_evidence', {
      prompt: 'Tell me about the hardest room you ever had to win — hostile, senior, or skeptical. What did you actually say or do?',
      spec: {
        module: 'skills', stage: 'skills', kind: 'behavioral_evidence',
        skill_v2: { slug: 'fitv2_communication' },
        evidence: { required: true, min_len: 100, probe: 'example' },
      },
    }),
    S('skill_synthesis_evidence', {
      prompt: 'Describe a time you took a mess of conflicting signals and produced the one-pager that set direction. What did you cut?',
      spec: {
        module: 'skills', stage: 'skills', kind: 'behavioral_evidence',
        skill_v2: { slug: 'fitv2_strategic_synthesis' },
        evidence: { required: true, min_len: 100, probe: 'example' },
      },
    }),
    S('skill_research_evidence', {
      prompt: 'Tell me about a market you mapped before acting. What did your map get right — and wrong?',
      spec: {
        module: 'skills', stage: 'skills', kind: 'behavioral_evidence',
        skill_v2: { slug: 'fitv2_market_research' },
        evidence: { required: true, min_len: 100, probe: 'example' },
      },
    }),

    recency('fitv2_fundraising_narrative', 'fundraising', 'How recently have you personally run a raise (or an LP/fund process) end to end?'),
    recency('fitv2_hiring', 'hiring', 'How recently have you personally sourced, closed, and onboarded a key hire?'),
    recency('fitv2_sales_relationships', 'sales', 'How recently have you personally opened and closed a high-stakes deal or partnership?'),
    recency('fitv2_execution_management', 'execution', 'How recently have you personally run a delivery cadence for a team of 3+?'),
  ];
}

// ---------------------------------------------------------------------------
// VALIDATION — 16 rows. Reverse-keyed pairs, social-desirability catches,
// evidence-consistency probes, confidence checks, pressure tradeoffs.
// Validation-only: nothing here feeds a layer score directly except through
// the pair/contradiction machinery (see fitDecision.detectContradictions).
// ---------------------------------------------------------------------------

export function validationV2Rows(): FitV2Row[] {
  const X = (key: string, rest: Omit<FitV2Row, 'key'>): FitV2Row => ({ key, ...rest });
  const rev = (key: string, partnerKey: string, valueKey: string, prompt: string, core: boolean): FitV2Row =>
    X(key, {
      prompt,
      hint: 'Answer honestly — this one has no “right” direction.',
      spec: {
        module: 'validation', stage: 'validation', kind: 'likert', mvp_core: core,
        value_key: valueKey, reverse_scored: true, validation_pair: partnerKey,
        signal_notes: { contradiction: 'Agreement here while rating the paired item high means one of the two is performance.' },
      },
    });
  return [
    rev('valx_integrity_rev', 'val_integrity_direct', 'integrity',
      'When a failure lands on your desk, how often is the honest root cause genuinely outside your control?', true),
    rev('valx_collab_rev', 'val_collab_direct', 'collaboration',
      'How often is it simply faster and better when you do the important work yourself and inform people after?', true),
    rev('valx_curiosity_rev', 'val_curiosity_direct', 'curiosity',
      'Once you have done the analysis, how often is further debate mostly a tax on execution?', true),
    rev('valx_resilience_rev', 'val_resilience_direct', 'resilience',
      'After a hard setback, how much time do you genuinely need before you can operate at full capacity again?', false),
    rev('valx_ambition_rev', 'val_ambition_direct', 'ambition',
      'How often do you take the near-term win, on the theory that survival is the only long game that matters?', false),
    rev('valx_stewardship_rev', 'val_stewardship_direct', 'stewardship',
      'How often is spending aggressively — money, goodwill, favors — simply what winning requires?', false),

    X('valx_sd_exaggerate', {
      prompt: 'Which is closer to the truth for you?',
      spec: {
        module: 'validation', stage: 'validation', kind: 'forced_choice', mvp_core: true,
        value_key: 'integrity',
        options_v2: [
          { key: 'never', label: 'I have never overstated anything to win a deal or a round', score: 1.5 },
          { key: 'have_corrected', label: 'I have overstated before, and I corrected course', score: 4.5 },
        ],
        signal_notes: { strong: 'Owning the second option is the honest signal.', weak: 'Claiming the implausible first option under a high integrity self-rating.' },
      },
    }),
    X('valx_sd_conflict', {
      prompt: 'Be honest: how do you feel when someone publicly proves you wrong?',
      spec: {
        module: 'validation', stage: 'validation', kind: 'forced_choice', mvp_core: true,
        value_key: 'curiosity',
        options_v2: [
          { key: 'sting_learn', label: 'It stings, then I want to understand what I missed', score: 4.5 },
          { key: 'love_it', label: 'I genuinely love it every time — no sting at all', score: 2 },
          { key: 'depends_who', label: 'Depends entirely on who is doing the proving', score: 2.5 },
        ],
      },
    }),
    X('valx_sd_credit', {
      prompt: 'A little status is honest fuel. How much does public credit actually matter to you?',
      spec: {
        module: 'validation', stage: 'validation', kind: 'forced_choice',
        value_key: 'collaboration',
        options_v2: [
          { key: 'matters_some', label: 'It matters some — I notice it, and I manage it', score: 4.5 },
          { key: 'not_at_all', label: 'Not at all — I am fully indifferent to credit', score: 2 },
          { key: 'matters_lot', label: 'A lot — visible wins are how careers compound', score: 2.5 },
        ],
      },
    }),

    X('valx_proof_top_skill', {
      prompt: 'Take the skill you rated highest. Walk me through the single best proof you have — something a reference could confirm.',
      spec: {
        module: 'validation', stage: 'validation', kind: 'behavioral_evidence', mvp_core: true,
        evidence: { required: true, min_len: 120, probe: 'reference' },
        signal_notes: { strong: 'Names a verifiable artifact, metric, or person.', weak: 'Restates the self-rating in more words.' },
        followup_prompts: ['Who would I call to confirm that?', 'What would they say you were weakest at?'],
      },
    }),
    X('valx_proof_value', {
      prompt: 'You rated your values a moment ago. Which single decision from the last year best shows one of them costing you something?',
      spec: {
        module: 'validation', stage: 'validation', kind: 'behavioral_evidence',
        evidence: { required: true, min_len: 100, probe: 'example' },
      },
    }),
    X('valx_proof_weakness', {
      prompt: 'What is the skill you most often get asked to compensate for — and how do you actually compensate?',
      spec: {
        module: 'validation', stage: 'validation', kind: 'behavioral_evidence',
        evidence: { required: true, min_len: 80, probe: 'example' },
        signal_notes: { strong: 'A real weakness with a real system around it.', weak: 'A humble-brag (“I care too much”).' },
      },
    }),

    X('valx_conf_ratings', {
      prompt: 'How many of your self-ratings today would survive a tough reference check unchanged?',
      hint: '0 = few would survive, 5 = essentially all.',
      spec: { module: 'validation', stage: 'validation', kind: 'confidence_check', mvp_core: true },
    }),
    X('valx_conf_peers', {
      prompt: 'How confident are you that close colleagues would rate you the way you just rated yourself?',
      spec: { module: 'validation', stage: 'validation', kind: 'confidence_check', mvp_core: true },
    }),

    X('valx_pressure_deadline', {
      prompt: 'A launch date you promised publicly is at risk unless you ship with a known, non-critical defect. You…',
      spec: {
        module: 'validation', stage: 'validation', kind: 'tradeoff', mvp_core: true,
        value_key: 'integrity',
        options_v2: [
          { key: 'ship_disclose', label: 'Ship on time and disclose the defect plainly', score: 4.5 },
          { key: 'slip_date', label: 'Slip the date — the promise was quality, not the day', score: 3.5 },
          { key: 'ship_quiet', label: 'Ship and fix it quietly next sprint', score: 1, flag: 'weak_ethics' },
        ],
      },
    }),
    X('valx_pressure_shortcut', {
      prompt: 'You can hit this quarter by borrowing hard against next quarter (discounts, promises, deferred work). You…',
      spec: {
        module: 'validation', stage: 'validation', kind: 'tradeoff',
        value_key: 'stewardship',
        options_v2: [
          { key: 'hold_line', label: 'Hold the line — the compounding cost is not worth it', score: 4.5 },
          { key: 'borrow_transparent', label: 'Borrow a little, with the payback plan written down', score: 3 },
          { key: 'hit_number', label: 'Hit the number — quarters are how trust is built', score: 1.5 },
        ],
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// CONTEXT — 3 rows. Unscored; frames the session for reviewers + branching.
// ---------------------------------------------------------------------------

export function contextV2Rows(): FitV2Row[] {
  return [
    {
      key: 'ctx_situation',
      prompt: 'Which of these describe your current situation? Pick all that apply.',
      spec: {
        module: 'context', stage: 'context', kind: 'multi_select', mvp_core: true,
        options_v2: [
          { key: 'operating', label: 'Operating a company right now' },
          { key: 'building_new', label: 'Starting something new' },
          { key: 'investing', label: 'Actively investing' },
          { key: 'advising', label: 'Advising or coaching founders' },
          { key: 'employed', label: 'Employed full-time elsewhere' },
          { key: 'between', label: 'Between things, exploring' },
        ],
      },
    },
    {
      key: 'ctx_horizon',
      prompt: 'What time horizon are you committing your next chapter to?',
      spec: {
        module: 'context', stage: 'context', kind: 'forced_choice', mvp_core: true,
        options_v2: [
          { key: 'under_1y', label: 'Under a year — testing' },
          { key: 'one_three', label: '1–3 years' },
          { key: 'three_plus', label: '3–10 years — building something durable' },
        ],
      },
    },
    {
      key: 'ctx_stakes',
      prompt: 'What is genuinely at stake for you in the outcome of this assessment?',
      spec: {
        module: 'context', stage: 'context', kind: 'forced_choice', mvp_core: true,
        options_v2: [
          { key: 'curiosity', label: 'Curiosity — I want the mirror' },
          { key: 'role_decision', label: 'A live role or engagement decision' },
          { key: 'team_design', label: 'Designing a team or partnership around it' },
        ],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Role add-on helper — 2 likert probes per rubric category (first is core).
// Role bank files author their categories with this.
// ---------------------------------------------------------------------------

export function roleRubricRows(
  entries: Array<{ category: string; core: FitV2Row['prompt']; second: FitV2Row['prompt']; coreHint?: string; secondHint?: string }>,
): FitV2Row[] {
  const rows: FitV2Row[] = [];
  for (const e of entries) {
    rows.push({
      key: `role_${e.category}_1`,
      prompt: e.core,
      hint: e.coreHint,
      spec: { module: 'role', stage: 'skills', kind: 'likert', mvp_core: true, rubric_v2: { category: e.category } },
    });
    rows.push({
      key: `role_${e.category}_2`,
      prompt: e.second,
      hint: e.secondHint,
      spec: { module: 'role', stage: 'skills', kind: 'likert', rubric_v2: { category: e.category } },
    });
  }
  return rows;
}

/** The shared spine every role bank instantiates (97 rows before add-ons). */
export function sharedFitV2Rows(): FitV2Row[] {
  return [
    ...contextV2Rows(),
    ...valuesV2Rows(),
    ...archetypeV2Rows(),
    ...skillsV2Rows(),
    ...validationV2Rows(),
  ];
}
