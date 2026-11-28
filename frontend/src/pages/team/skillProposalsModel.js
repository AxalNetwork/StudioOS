/**
 * D8827 (#8827, D5963) — Eadwyn's proposals on Compare with Axal, as pure functions.
 *
 * `POST /api/teams/skills/:uid/proposals` answers a summary of what Axal changed from vB to vN and, per conflicting
 * part, a rebase choice (`mine`, `axal`, or `edit` with a value). The page shows them and stores nothing. Accepting one
 * puts its choice into the rebase sheet (SK-20); the draft is written only when the editor presses Create draft there,
 * through `POST /skills/:uid/rebase` with `expected_draft_hash` (D8827). The Worker has already withheld any proposal
 * naming a tool outside Axal vN (D5963); nothing here adds or guesses one.
 */
import { PART_LABELS } from './extensionCompareModel.js';

const num = (n) => (Number.isSafeInteger(n) && n > 0 ? n : null);
const label = (part) => PART_LABELS[part] || part;

/** A list of part names in words: "Name, Output and Roles". */
export function partList(parts) {
  const ls = (Array.isArray(parts) ? parts : []).map(label);
  return ls.length > 1 ? `${ls.slice(0, -1).join(', ')} and ${ls[ls.length - 1]}` : ls[0] || '';
}

/** The lead words of one proposal, as SK-17's rail draws them. */
export function proposalLead(p, version) {
  if (p?.choice === 'mine') return 'Keep yours.';
  if (p?.choice === 'axal') return `Take Axal v${version}.`;
  return 'Combine:';
}

/** Whether an answer was made on the comparison the page shows now (the same three versions). */
export function basisMatches(basis, view) {
  if (!basis || view?.kind !== 'compare' || !view.update) return false;
  return num(basis.version) === view.newestVersion
    && num(basis.based_on_version) === view.baseVersion
    && (basis.company?.side === 'draft' ? 'draft' : 'version') === view.companySide
    && (num(basis.company?.version) ?? null) === (view.companyVersion ?? null);
}

/**
 * The answer as the panel draws it, or null when it is not one. Only parts the comparison flags as conflicts keep a
 * proposal; a proposal for any other part is dropped rather than shown.
 */
export function proposalsView(answer, view) {
  if (!answer || !Array.isArray(answer.proposals) || !Array.isArray(answer.summary)) return null;
  const conflicts = new Set((view?.rows || []).filter((r) => r.marker === 'c').map((r) => r.field));
  const summarised = new Set(answer.summary.map((s) => s.part));
  return {
    summary: answer.summary.filter((s) => s && typeof s.text === 'string').map((s) => ({ part: s.part, label: label(s.part), text: s.text })),
    undescribed: (answer.changed || []).filter((p) => !summarised.has(p)),
    unchanged: Array.isArray(answer.unchanged) ? answer.unchanged : [],
    proposals: answer.proposals.filter((p) => conflicts.has(p.part)).map((p) => ({ ...p, label: label(p.part) })),
    missing: (answer.missing || []).filter((p) => conflicts.has(p)),
    withheld: (answer.withheld || []).filter((w) => w && typeof w.message === 'string'),
  };
}

/**
 * A proposal as the rebase sheet's starting choice for its part (`RebaseSheet`'s `initial`): the choice, and for
 * `edit` the value in the hand editor's own form (steps one per line, tools as keys, text as text).
 */
export function rebaseChoiceOf(p) {
  if (!p || !['mine', 'axal', 'edit'].includes(p.choice)) return null;
  if (p.choice !== 'edit') return { choice: p.choice };
  if (p.part === 'steps') return { choice: 'edit', value: (Array.isArray(p.value) ? p.value : []).join('\n') };
  if (p.part === 'tools') return { choice: 'edit', value: Array.isArray(p.value) ? p.value.map(String) : [] };
  return { choice: 'edit', value: typeof p.value === 'string' ? p.value : '' };
}

/** Every accepted proposal as the sheet's `initial`: `{ [part]: { choice, value? } }`. */
export function acceptedChoices(proposals, accepted) {
  const out = {};
  for (const p of proposals || []) {
    if (!accepted?.[p.part]) continue;
    const c = rebaseChoiceOf(p);
    if (c) out[p.part] = c;
  }
  return out;
}

/** What one micro-USD hold reads as: "$0.0042". */
export const holdWords = (micro) => `$${(Number(micro || 0) / 1e6).toFixed(4)}`;

/** The panel's state after a refusal: Eadwyn unavailable, a fresh quote, or the Worker's own sentence. */
export function refusalState(out) {
  if (out?.refused && out.code === 'quote_changed' && out.estimate) return { kind: 'quote', estimate: out.estimate, changed: true };
  if (out?.refused && !['proposals_unavailable', 'proposals_unmatched'].includes(out.code) && out.reason) return { kind: 'refused', code: out.code, text: out.reason };
  return {
    kind: 'unavailable',
    text: out?.refused && out.reason ? out.reason : 'Eadwyn could not be reached. Nothing was proposed.',
  };
}
