/**
 * Spin-Out Lab · Studio Ops — the derivations behind the page.
 *
 * The page shows six things. Two are stored (the cadence and the closeout
 * review, on /api/spinout-lab/studio-ops); the other four are computed HERE
 * from data the Lab already has:
 *
 *   sprint position   /spinout-lab/state → started_at, days_remaining, week
 *   commitments       the week catalog's `deliverables`, marked done by the
 *                     founder's real `milestones` rows
 *   execution health  the ratio of those, plus whether anything is blocking
 *   blockers          which required commitments are still open, weighed
 *                     against how much of the week is actually gone
 *
 * Deriving rather than storing is the point. A stored copy of "3 of 5 done"
 * would be a second answer to a question the workspace already answers, and
 * the two would disagree the first time a milestone landed anywhere else.
 *
 * The functions are pure and exported individually so
 * `frontend/test/spinout_studio_ops.test.mjs` can exercise the honest-empty
 * and boundary cases without mounting React.
 */

const SPRINT_DAYS = 28;
const DAYS_PER_WEEK = 7;

/**
 * Sprint position from a LabState.
 *
 * `days_remaining` is server-computed (28 − days since start), so the day
 * number is derived from it rather than from the browser clock — a founder
 * with a wrong system clock still sees the day the program thinks it is.
 *
 * Returns `day: null` when the sprint has not started; the caller renders the
 * week alone rather than "Day NaN".
 */
export function sprintPosition(state) {
  const week = Math.min(4, Math.max(1, Number(state?.week) || 1));
  const remaining = Number(state?.days_remaining);
  if (!state?.started_at || !Number.isFinite(remaining)) {
    return { week, day: null, dayInWeek: null, weekElapsedPct: 0, label: `Week ${week}` };
  }
  // Day 1 is the start day itself, so a fresh sprint (28 remaining) is day 1.
  const day = Math.min(SPRINT_DAYS, Math.max(1, SPRINT_DAYS - remaining + 1));
  // Position inside the CURRENT week, from the sprint day rather than from the
  // week number: a founder who advanced early is further into the sprint than
  // their week alone implies, and the blocker heuristic below reads this.
  const dayInWeek = ((day - 1) % DAYS_PER_WEEK) + 1;
  return {
    week,
    day,
    dayInWeek,
    weekElapsedPct: Math.round(((dayInWeek - 1) / DAYS_PER_WEEK) * 100),
    label: `Week ${week} · Day ${day}`,
  };
}

/**
 * Is this deliverable done?
 *
 * A row lists one or more milestone `keys` and is done when ANY is recorded —
 * that mirrors `countDeliverables` in the workspace, which is what the week's
 * progress bar there already uses. Same rule, so the two surfaces agree.
 */
export function deliverableDone(deliverable, doneKeys) {
  return (deliverable?.keys || []).some((k) => doneKeys.has(k));
}

/**
 * The week's deliverables as execution-tracker commitments.
 *
 * "Commitments pulled from your modules this week" is literal: every row is a
 * real deliverable from the week catalog, its module is the tool that owns it,
 * and its `to` is that tool's route — so a founder can click straight from the
 * tracker into the thing that completes it.
 *
 * `owner` is the signed-in founder. The Lab knows of exactly one founder per
 * sprint until Co-founder Match records another, so assigning rows to invented
 * teammates is not available to us and is not attempted.
 *
 * There is no per-deliverable due date anywhere in the Lab — the real deadline
 * is the week's, so that is what `due` carries. An invented "due Wed" would be
 * the one number on this page a founder could act on and be wrong about.
 */
export function buildCommitments({ weekDef, doneKeys, toolInfo, ownerName }) {
  if (!weekDef) return [];
  return (weekDef.deliverables || []).map((d, i) => {
    const tool = toolInfo?.[d.tool];
    const done = deliverableDone(d, doneKeys);
    return {
      id: `${weekDef.num}-${i}`,
      title: d.label,
      module: tool?.label || d.tool,
      to: tool?.to || null,
      owner: ownerName || 'You',
      due: `Week ${weekDef.num}`,
      status: done ? 'Done' : 'Open',
      done,
      // Bonus rows do not gate the week, and the workspace already excludes
      // them from its denominator. Carrying the flag keeps both counts equal.
      optional: Boolean(d.optional),
    };
  });
}

/**
 * Execution health across the week's counted commitments.
 *
 * Optional rows are excluded from the denominator for the same reason the
 * workspace excludes them: a founder who finished every required deliverable
 * is at 100%, not at "5 of 7", and telling them otherwise would make the
 * program look unfinishable.
 *
 * A high-severity blocker downgrades an otherwise-green week to "At risk".
 * Progress and risk are different questions, and a week can be both mostly
 * done and genuinely stuck — the design's own example is exactly that case.
 */
export function executionHealth(commitments, blockers = []) {
  const counted = commitments.filter((c) => !c.optional);
  const total = counted.length;
  const done = counted.filter((c) => c.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const highBlockers = blockers.filter((b) => b.severity === 'High').length;
  const atRisk = highBlockers > 0;

  const parts = [`${done} of ${total} commitment${total === 1 ? '' : 's'} done`];
  if (highBlockers > 0) {
    parts.push(`${highBlockers} high blocker${highBlockers === 1 ? '' : 's'}`);
  }

  return {
    done,
    total,
    pct,
    atRisk,
    label: total === 0 ? 'Not started' : atRisk ? 'At risk' : done === total ? 'Complete' : 'On track',
    tone: total === 0 ? 'muted' : atRisk ? 'warn' : 'active',
    note: parts.join(' · '),
  };
}

/**
 * Blockers and risks, derived from the week's real state.
 *
 * There is no blockers table, and inventing one would mean asking founders to
 * maintain a second list of things the program already knows. What it knows is:
 * which required deliverables are still open, and how much of the week is gone.
 * Those two facts are what a weekly review would surface anyway.
 *
 *   past 70% of the week, still open  → High  (this is the week's failure mode)
 *   past 40% of the week, still open  → Medium
 *   earlier than that                 → not a blocker, just work in progress
 *
 * A frozen cohort gate outranks all of it: a paused sprint is the blocker, and
 * listing the deliverables underneath it would bury the reason they are stuck.
 */
export function deriveBlockers({ weekDef, doneKeys, position, cohortTiming, toolInfo }) {
  if (cohortTiming?.frozen) {
    return [{
      id: 'frozen',
      title: `Sprint paused at Week ${cohortTiming.frozen_week}`,
      severity: 'High',
      type: 'Program',
      recommended:
        'Deliverables cannot be recorded until an admin grants a grace extension or an override. '
        + 'Raise it at your next advisor session.',
      escalate: true,
    }];
  }
  if (!weekDef) return [];

  const elapsed = position?.weekElapsedPct ?? 0;
  if (elapsed < 40) return [];
  const severity = elapsed >= 70 ? 'High' : 'Medium';

  return (weekDef.deliverables || [])
    .filter((d) => !d.optional && !deliverableDone(d, doneKeys))
    .map((d, i) => {
      const tool = toolInfo?.[d.tool];
      return {
        id: `open-${i}`,
        title: d.label,
        severity,
        type: 'Deliverable',
        recommended: `${elapsed}% of Week ${weekDef.num} has elapsed and this is still open. `
          + `Open ${tool?.label || d.tool} and close it out.`,
        // Escalating everything escalates nothing. Only the high-severity ones
        // are worth an advisor's slot.
        escalate: severity === 'High',
        to: tool?.to || null,
      };
    });
}

/**
 * The week's must-hit list for the focus panel.
 *
 * Sourced from the catalog's summary `chips` rather than its prose `panels`,
 * because chips carry milestone `keys` — so each line can show whether it is
 * actually done instead of rendering three permanently-grey bullets.
 */
export function mustHitList(weekDef, doneKeys) {
  if (!weekDef) return [];
  return (weekDef.chips || []).map((chip, i) => ({
    id: `mh-${i}`,
    text: chip.label,
    done: (chip.keys || []).some((k) => doneKeys.has(k)),
  }));
}
