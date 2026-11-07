/**
 * #4739 — HQ › AI agents: a refusal in the page's words.
 *
 * Pure. A write the Worker refuses answers `{ error|code, message }` (D278:
 * `message` is a sentence we wrote, the code is a name). The client puts the
 * body on `e.data`. This file maps each code to its own sentence; a code it
 * does not know shows the Worker's sentence, and failing that a plain one. It
 * never shows `e.message` (the raw error text of a request that never got an
 * answer: a network failure, a proxy page).
 */
import { readRefusal } from '../../../lib/api.js';

/** Every change here takes a reason; the Worker refuses one outside this range. */
export const REASON_MIN = 10;
export const REASON_MAX = 500;
const WHY = `Say why, in ${REASON_MIN} to ${REASON_MAX} characters. It is recorded with the change.`;

/** The code and the Worker's sentence from whatever the client threw. */
export function refusalOf(e) {
  const { message, code } = readRefusal(e?.data);
  // The client puts the body on `e.data`; a caller that already has the code (a bulk item) passes `{ code }`.
  const named = code || (typeof e?.code === 'string' ? e.code : null);
  return { code: named || null, message: message && message !== named ? message : null, data: e?.data ?? e ?? null };
}

/** One table's sentence for a code, else the Worker's own sentence, else `plain`. */
export function wordsFor(table, e, plain = 'That change was not saved.') {
  const { code, message, data } = refusalOf(e);
  const own = code ? table[code] : null;
  if (typeof own === 'function') return own(data) || message || plain;
  return own || message || plain;
}

/** SA3 and SA4 — the lifecycle of From Axal skills (`routes/admin_hq_skills.ts`, `skillPublish`, `team_skills`). */
export const SKILL_REFUSALS = {
  reason_required: WHY,
  not_found: 'There is no such Axal skill.',
  reviewer_invalid: 'Choose a Super Admin to review the draft.',
  reviewer_is_author: 'A second Super Admin reviews the draft, not its author.',
  review_open: 'A review of this draft is already open.',
  review_conflict: 'This review changed just now. Reload the skill and try again.',
  retired: 'This skill is retired.',
  comment_required: `Say what to change, in at least ${REASON_MIN} characters.`,
  no_review: 'No review of this skill is open.',
  review_stale: 'The draft changed after the review was asked for. Ask for a new review.',
  self_approval: 'The draft’s author cannot approve it. A second Super Admin does.',
  not_reviewer: 'Only the Super Admin asked to review this draft decides it.',
  cases_invalid: 'A skill has up to 20 golden cases.',
  case_invalid: 'Each case needs a name, input records, an expected output and at least one phrase it must or must not contain.',
  case_has_email: 'A golden case never holds an email address. Use made-up records.',
  models_invalid: 'Choose from the models agents may run on.',
  no_cases: 'This skill has no golden cases yet. Add one, then run the evals.',
  replacement_required: 'Name the Axal skill that replaces this one.',
  replacement_invalid: 'The replacement must be a different, published Axal skill.',
  retire_conflict: 'This skill was retired just now. Reload it.',
  publish_conflict: 'This skill was published by someone else just now. Reload it and try again.',
  needs_approval: 'A second Super Admin must approve this draft before it is published.',
  golden_cases_failing: (d) => (Number.isFinite(d?.pass) && Number.isFinite(d?.total)
    ? `The golden cases pass ${d.pass} of ${d.total}, below the bar. Fix the skill or its cases, then re-run the evals.`
    : 'The golden cases pass below the bar. Fix the skill or its cases, then re-run the evals.'),
  tool_not_read_only: (d) => (d?.tool ? `Skills may only use read tools. ${d.tool} can write.` : 'Skills may only use read tools.'),
  version_unknown: 'Compare a published version (v1, v2, …) or the draft.',
  action_invalid: 'Choose Publish, Retire or Re-run evals.',
  uids_invalid: 'Choose at least one skill, and no more than the list allows.',
  forbidden: 'Only a Super Admin can do this.',
};
export const skillRefusal = (e) => wordsFor(SKILL_REFUSALS, e, 'That change was not saved.');

/** One bulk result as a line: done, or the refusal's own sentence. */
export function bulkLine(action, r, nameOf = (u) => u) {
  const who = nameOf(r.uid);
  if (r.ok) {
    if (action === 'publish') return `${who}: published${r.version ? ` as v${r.version}` : ''}.`;
    if (action === 'retire') return `${who}: retired${Number.isFinite(r.pinned_agents) ? `; ${r.pinned_agents} pinned agent${r.pinned_agents === 1 ? '' : 's'} moved` : ''}.`;
    return `${who}: evals ran${Number.isFinite(r.pass) && Number.isFinite(r.total) ? `, ${r.pass} of ${r.total} passed` : ''}.`;
  }
  const own = r.code ? SKILL_REFUSALS[r.code] : null;
  const words = typeof own === 'function' ? own(r) : own;
  return `${who}: ${words || r.message || 'Not done.'}`;
}

/** SA6 and SA6b — the platform policy (`routes/admin_ai_agents_policy.ts`) and the engine halt (`routes/admin_agents.ts`). */
export const POLICY_REFUSALS = {
  reason_required: WHY,
  reason_too_long: `Keep the reason under ${REASON_MAX} characters.`,
  invalid_models: 'Each area suggests 1 to 3 different models from the catalogue, in order.',
  invalid_area: 'That is not one of the 8 areas.',
  invalid_default: 'The default model is one of the area’s suggestions.',
  unknown_model: 'Choose a model from the catalogue.',
  already_locked: 'That model is already locked off.',
  not_locked: 'That model is not locked.',
  invalid_cap: 'A cap is a dollar amount above zero, or blank to clear it.',
  default_over_max: 'The default team cap cannot be above the maximum team cap.',
  invalid_tools: 'List up to 50 connector tools by name, such as hubspot.read_contacts.',
  write_tool: (d) => d?.message || 'Skills may only request read tools.',
  confirm_required: 'Type PAUSE to pause every AI agent on the platform.',
  already_paused: 'AI agents are already paused.',
  not_paused: 'AI agents are not paused.',
  policy_unreadable: 'The AI policy could not be read. Nothing was changed.',
  invalid_halt: `Say halted or cleared, with a reason of up to 64 characters.`,
  forbidden: 'Only a Super Admin can do this.',
};
export const policyRefusal = (e) => wordsFor(POLICY_REFUSALS, e, 'The change could not be saved. Read the current policy before trying again.');
