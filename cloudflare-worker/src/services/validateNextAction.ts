/**
 * D4589 (#4589) — Validate's one next-action policy, shared by the desktop
 * overview and the phone root. `validateFocus.focusOf` reads the facts below
 * and calls `nextAction`; the overview read (`routes/cycle_validate.ts`)
 * returns the result as `focus`, which both presentations draw through one
 * browser adapter (`frontend/src/pages/cycles/validatePhone.js` `phoneFocus`).
 * Nothing here reads or writes: it is a pure function of the facts, so the
 * same venture state always gives the same action on both.
 *
 * THE POLICY is the first rule that holds (D4589.md is the agreed order):
 *   0. a fact a rule needs could not be read: `unavailable`, with no primary
 *      action. Missing data is never turned into progress or into "nothing
 *      is waiting";
 *   1. the venture has no interview: record the first conversation (anyone,
 *      as before);
 *   — a caller who cannot write gets the first card's own `next` (D692);
 *   2. an interview session is waiting for review: review it;
 *   3. the venture's current decision is Stop: review that decision. Nothing
 *      prompts more recording or building; reopening is a new decision the
 *      founder records themselves (secondary action). Pending review (2)
 *      comes first because it is evidence already gathered, the policy's one
 *      reason to revisit a Stop;
 *   4. a claim's supporting interviews have no ICP fit recorded, so its
 *      status cannot be computed: record the fit, on the claim's record;
 *   5. an experiment is marked done with no observed result: record it;
 *   6. a claim has both supporting and contradicting interviews and is
 *      neither supported nor refuted: plan the next test for it;
 *   7. no venture decision yet and a claim is supported or refuted: consider
 *      the decision. The panel links the founder's own decision form and
 *      never records Proceed, Pivot or Stop itself;
 *   8. the current decision is Proceed or Pivot and the caller owns the
 *      venture: the existing Plan the build handoff (D1069), at its own href;
 *   9. otherwise record the next customer conversation.
 *
 * Every primary action carries a short `why` and an exact href that names
 * the venture. Record a session stays available as a secondary action
 * wherever it is not the primary and the venture is not stopped.
 */
import type { Focus } from './cycleFocus';

export type Unreadable = 'unreadable';
export const UNREAD: Unreadable = 'unreadable';

export type ReviewFact = { interviewId: number; sessionId: number; headline: string; why: string };
export type ClaimFact = {
  id: number; code: string; status: string;
  supporting: number; contradicting: number; fit_unrecorded: number;
};
export type ResultFact = { hypothesisId: number; code: string; title: string };
export type DecisionFact = { id: number; decision: string; decided_at: string | null };

export type NextActionFacts = {
  projectId: number;
  canWrite: boolean;
  /** The venture's founder: the Plan the build gate D1069 uses. */
  ownsVenture: boolean;
  /** The caller may read decisions (`canReadDecision`); a writer always may. */
  canReadDecision: boolean;
  interviews: number | Unreadable;
  /** The session to review, or null; read for writers only. */
  review: ReviewFact | null | Unreadable;
  /** The current venture-level decision; null when there is none. */
  decision: DecisionFact | null | Unreadable;
  claims: ClaimFact[] | Unreadable;
  /** Experiments marked done whose observed result is empty. */
  results: ResultFact[] | Unreadable;
  /** Rule 9's why tail ("You are at 14 of 20 this month."), '' when unknown. */
  meterTail: string;
  /** Rule 9's Then, from the first other card's next, or null. */
  then: string | null;
  /** A reader's focus, the card rule (D692), computed by the caller. */
  readerFocus: Focus | null;
  /** "12 Oct" for a decision date, the caller's formatter. */
  dayMonth: (v: string | null) => string | null;
};

type Link = { label: string; href: string };

const EYEBROW = 'Validate · Next';
export const recordHref = (pid: number) => `/validate/record?project=${pid}`;
export const claimHref = (pid: number, hypothesisId: number) => `/validate/experiments/${hypothesisId}?project=${pid}`;
export const decisionHref = (pid: number, id: number) => `/validate/verdict/${id}?project=${pid}`;
export const newDecisionHref = (pid: number) => `/validate/verdict/new?project=${pid}&for=venture`;
/** D1069's Plan the build link: one builder for the Verdict record's action and this policy. */
export const planBuildHref = (pid: number, hypothesisId: number | null = null) =>
  `/build/plan?project_id=${pid}${hypothesisId == null ? '' : `&scope=h-${hypothesisId}`}`;
export const reviewHref = (pid: number, interviewId: number, sessionId: number) =>
  `/validate/customer-research/${interviewId}?project_id=${pid}&session=${sessionId}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const WORD: Record<string, string> = { proceed: 'Proceed', pivot: 'Pivot', stop: 'Stop' };

function focus(rule: Focus['rule'], headline: string, why: string, cta: Link | null, secondary: Link[], then: string | null = null): Focus {
  return { rule, eyebrow: EYEBROW, headline, why, cta, then, secondary, state: cta ? 'ok' : 'unavailable' };
}

function unavailable(pid: number, what: string, canWrite: boolean): Focus {
  return focus('unavailable', 'The next step could not be worked out.',
    `${what} could not be read. This is not a claim that nothing is waiting.`,
    null, canWrite ? [{ label: 'Record a session', href: recordHref(pid) }] : []);
}

/** The one action for this venture state. Pure: same facts, same action. */
export function nextAction(f: NextActionFacts): Focus | null {
  const pid = f.projectId;
  const record: Link = { label: 'Record a session', href: recordHref(pid) };
  if (f.interviews === UNREAD) return unavailable(pid, 'The interviews', f.canWrite);
  if (f.interviews === 0) {
    return focus('first_interview', 'Record your first conversation.',
      'Validate starts with one interview. Everything else in the venture builds on what it finds.',
      record, [], 'Write the claim you most need to be true.');
  }
  // A reader is never sent to a write (D692).
  if (!f.canWrite) return f.readerFocus;

  if (f.review === UNREAD) return unavailable(pid, 'The interview sessions', true);
  if (f.review) {
    return focus('review', f.review.headline, f.review.why,
      { label: 'Review the interview', href: reviewHref(pid, f.review.interviewId, f.review.sessionId) }, [record]);
  }

  if (f.decision === UNREAD) return unavailable(pid, 'The current decision', true);
  const decision = f.canReadDecision ? f.decision : null;
  if (decision && decision.decision === 'stop') {
    const when = f.dayMonth(decision.decided_at);
    return focus('stopped', `You decided to stop${when ? ` on ${when}` : ''}.`,
      'Recording and building wait on that decision. Review it and its evidence; reopening the work is a new decision you record yourself.',
      { label: 'Review the Stop decision', href: decisionHref(pid, decision.id) },
      [{ label: 'Record a new decision', href: newDecisionHref(pid) }]);
  }

  if (f.claims === UNREAD) return unavailable(pid, 'The hypotheses and their evidence', true);
  const decided = (c: ClaimFact) => c.status === 'supported' || c.status === 'refuted';

  const unfit = f.claims.find((c) => c.fit_unrecorded > 0 && !decided(c));
  if (unfit) {
    return focus('missing_fit', `Record ICP fit for the interviews behind ${unfit.code}.`,
      `${plural(unfit.fit_unrecorded, 'supporting interview has', 'supporting interviews have')} no ICP fit recorded, so ${unfit.code}’s status cannot be worked out.`,
      { label: `Open ${unfit.code}`, href: claimHref(pid, unfit.id) }, [record]);
  }

  if (f.results === UNREAD) return unavailable(pid, 'The experiments', true);
  const result = f.results[0];
  if (result) {
    return focus('record_result', `Record what ${result.code}’s experiment observed.`,
      `“${result.title}” is marked done with no result, so it is not evidence yet.`,
      { label: `Open ${result.code}`, href: claimHref(pid, result.hypothesisId) }, [record]);
  }

  const mixed = f.claims.find((c) => !decided(c) && c.supporting > 0 && c.contradicting > 0);
  if (mixed) {
    return focus('next_test', `Plan the next test for ${mixed.code}.`,
      `${plural(mixed.supporting, 'interview supports', 'interviews support')} it and ${plural(mixed.contradicting, 'contradicts', 'contradict')} it. One more test should tell them apart.`,
      { label: `Open ${mixed.code}`, href: claimHref(pid, mixed.id) }, [record]);
  }

  if (f.canReadDecision && !decision) {
    const ready = f.claims.find(decided);
    if (ready) {
      return focus('decision_ready', 'A decision is ready to consider.',
        `${ready.code} is ${ready.status} on the interviews so far. Proceed, Pivot or Stop is yours to record; nothing here records it for you.`,
        { label: 'Consider the decision', href: newDecisionHref(pid) }, [record]);
    }
  }

  if (decision && (decision.decision === 'proceed' || decision.decision === 'pivot') && f.ownsVenture) {
    const when = f.dayMonth(decision.decided_at);
    return focus('plan_build', 'Plan the build from this evidence.',
      `You recorded ${WORD[decision.decision]}${when ? ` on ${when}` : ''}. The plan turns that decision into the work to build.`,
      { label: 'Plan the build', href: planBuildHref(pid) }, [record, { label: 'Review the decision', href: decisionHref(pid, decision.id) }]);
  }

  return focus('next_interview', 'Record your next customer conversation.',
    `Every interview feeds the pain themes, the hypotheses and the verdict.${f.meterTail}`,
    record, [], f.then);
}
