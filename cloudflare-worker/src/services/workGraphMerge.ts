/**
 * D5582 part 1 (#5582, WorkGraph P1 under the #5577 epic) — what happens when two drafts of one document, deck,
 * offer or legal instrument were cut from the same base: which edits proceed, which merge, which conflict, and which
 * a person must look at. Pure. The units come from `workGraphUnits.ts`; the result is a CANDIDATE, never a
 * published or signed revision.
 *
 *   NON-OVERLAP   A unit only one side changed takes that side. Two agents editing different slides or clauses
 *                 never lose an edit.
 *   SAME EDIT     Both sides made the identical change: taken once.
 *   CONFLICT      Both sides changed one unit differently, or one deleted what the other changed. The unit is NOT
 *                 replaced; the plan carries base, ours and theirs, and only a person's `chooseVariant` (or a
 *                 later edit) resolves it.
 *   TEXT MERGE    Only for a unit marked `textMergeable` (plain deck text, a template clause, a document section),
 *                 only when no side of it is sensitive, only when the kind's policy allows it (never for an offer or
 *                 signed evidence), and only when the two sides' line changes do not touch the same lines of the
 *                 base. Anything else is a conflict.
 *   REVIEW        Every changed unit whose old or new text is sensitive (money, equity, signatures, liability, legal
 *                 entity, jurisdiction, investor claims) is listed in `review`, whatever merged.
 *   CONFIRMATION  `requiresHumanConfirmation` is true whenever the candidate combines both sides or touches a
 *                 sensitive unit, and always for a legal template. The combined revision is approved by a person
 *                 against its exact digest (D5579), never by this module and never by an agent.
 */
import type { Actor, AssetKind } from './workGraphContracts';
import { stable } from './decks/coedit';
import type { SensitiveCategory, Unit } from './workGraphUnits';

/** Kinds whose units may be combined by the guarded text merge. Offers and signed evidence never are. */
export const TEXT_MERGE_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>(['pitch_deck', 'document', 'legal_template']);
/** Kinds whose every candidate needs a person's confirmation, merged or not. */
export const ALWAYS_CONFIRM_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>(['legal_template', 'offer']);
/** Longest text the line merge takes on. A longer unit's concurrent edits are a conflict for a person. */
export const MERGE_MAX_LINES = 2000;

export type UnitOutcome =
  | 'unchanged' | 'ours' | 'theirs' | 'same' | 'text_merged' | 'conflict' | 'added_ours' | 'added_theirs'
  | 'deleted_ours' | 'deleted_theirs' | 'deleted_both';

export interface Conflict {
  unitId: string;
  reason: 'both_changed' | 'delete_vs_change' | 'both_added' | 'text_overlap' | 'sensitive' | 'not_text_mergeable' | 'too_long';
  base: Unit | null;
  ours: Unit | null;
  theirs: Unit | null;
}

export interface ReviewItem { unitId: string; categories: SensitiveCategory[] }

export interface MergePlan {
  kind: AssetKind;
  /** The candidate's units, in order. A conflicted unit holds its BASE (or is absent if it had none) until resolved. */
  units: Unit[];
  outcomes: Record<string, UnitOutcome>;
  conflicts: Conflict[];
  review: ReviewItem[];
  requiresHumanConfirmation: boolean;
}

export type MergeRefusal = { ok: false; code: 'immutable_record' | 'not_a_person' | 'unknown_unit' | 'not_in_conflict' };

// ---------------------------------------------------------------------------------------------------------------
// The line merge.
// ---------------------------------------------------------------------------------------------------------------

/** One base range a side replaced: base lines [start, end) became `lines`. */
interface Hunk { start: number; end: number; lines: string[] }

/** The hunks that turn `base` into `side`, from a longest-common-subsequence alignment. */
function hunks(base: string[], side: string[]): Hunk[] {
  const n = base.length, m = side.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = base[i] === side[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: Hunk[] = [];
  let i = 0, j = 0, open: Hunk | null = null;
  const close = () => { if (open) { out.push(open); open = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === side[j]) { close(); i += 1; j += 1; continue; }
    if (!open) open = { start: i, end: i, lines: [] };
    if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) { open.lines.push(side[j]); j += 1; } else { i += 1; open.end = i; }
  }
  close();
  return out;
}

/**
 * Three-way merge of line text. Returns the merged text when the two sides' hunks touch disjoint base ranges (two
 * pure insertions at the same point overlap too: their order is a person's call), else null.
 */
export function mergeLines(base: string, ours: string, theirs: string): string | null {
  const b = base.split('\n'), o = ours.split('\n'), t = theirs.split('\n');
  if (Math.max(b.length, o.length, t.length) > MERGE_MAX_LINES) return null;
  const ho = hunks(b, o).map((h) => ({ ...h, side: 'o' as const }));
  const ht = hunks(b, t).map((h) => ({ ...h, side: 't' as const }));
  const all = [...ho, ...ht].sort((x, y) => x.start - y.start || x.end - y.end);
  // Sorted by start, a hunk overlaps or touches the other side's work iff it starts at or before the furthest end
  // that side has reached. Touching (adjacent lines, or two insertions at one point) counts: its order or its
  // meaning is a person's call, never a guess.
  const reach = { o: -1, t: -1 };
  for (const h of all) {
    const other = h.side === 'o' ? 't' : 'o';
    if (reach[other] >= 0 && h.start <= reach[other]) return null;
    reach[h.side] = Math.max(reach[h.side], h.end);
  }
  const out: string[] = [];
  let cursor = 0;
  for (const h of all) {
    out.push(...b.slice(cursor, h.start), ...h.lines);
    cursor = h.end;
  }
  out.push(...b.slice(cursor));
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// The plan.
// ---------------------------------------------------------------------------------------------------------------

function byId(units: Unit[]): Map<string, Unit> {
  return new Map(units.map((u) => [u.id, u]));
}

const changed = (a: Unit | undefined, b: Unit | undefined) => (a?.value ?? null) !== (b?.value ?? null);

function categoriesOf(...us: (Unit | null | undefined)[]): SensitiveCategory[] {
  return [...new Set(us.flatMap((u) => u?.sensitive ?? []))];
}

/**
 * Plan the merge of two drafts cut from one base. `kind` is the asset kind (D5579): signed evidence is refused, and
 * the kind decides whether text merges and whether a person must confirm.
 */
export function planMerge(kind: AssetKind, base: Unit[], ours: Unit[], theirs: Unit[]): MergePlan | MergeRefusal {
  if (kind === 'legal_signed') return { ok: false, code: 'immutable_record' };
  const B = byId(base), O = byId(ours), T = byId(theirs);
  const outcomes: Record<string, UnitOutcome> = {};
  const conflicts: Conflict[] = [];
  const review = new Map<string, Set<SensitiveCategory>>();
  const chosen = new Map<string, Unit | null>(); // null: deleted
  let combined = false;

  const flag = (id: string, cats: SensitiveCategory[]) => {
    if (!cats.length) return;
    if (!review.has(id)) review.set(id, new Set());
    for (const c of cats) review.get(id)!.add(c);
  };

  const ids = [...new Set([...base.map((u) => u.id), ...ours.map((u) => u.id), ...theirs.map((u) => u.id)])];
  for (const id of ids) {
    const b = B.get(id), o = O.get(id), t = T.get(id);
    const oc = changed(b, o), tc = changed(b, t);
    if (!oc && !tc) { outcomes[id] = 'unchanged'; chosen.set(id, b ?? null); continue; }
    flag(id, categoriesOf(oc ? b : null, oc ? o : null, tc ? b : null, tc ? t : null));
    if (oc && !tc) {
      outcomes[id] = !b ? 'added_ours' : !o ? 'deleted_ours' : 'ours'; chosen.set(id, o ?? null); continue;
    }
    if (tc && !oc) {
      outcomes[id] = !b ? 'added_theirs' : !t ? 'deleted_theirs' : 'theirs'; chosen.set(id, t ?? null); continue;
    }
    // Both changed.
    if (!changed(o, t)) {
      outcomes[id] = !o ? 'deleted_both' : 'same'; chosen.set(id, o ?? null); continue;
    }
    const conflict = (reason: Conflict['reason']) => {
      outcomes[id] = 'conflict';
      conflicts.push({ unitId: id, reason, base: b ?? null, ours: o ?? null, theirs: t ?? null });
      chosen.set(id, b ?? null);
    };
    if (!b) { conflict('both_added'); continue; }
    if (!o || !t) { conflict('delete_vs_change'); continue; }
    if (!TEXT_MERGE_KINDS.has(kind) || !b.textMergeable || !o.textMergeable || !t.textMergeable) { conflict('not_text_mergeable'); continue; }
    if (b.sensitive.length || o.sensitive.length || t.sensitive.length) { conflict('sensitive'); continue; }
    if (Math.max(b.text.split('\n').length, o.text.split('\n').length, t.text.split('\n').length) > MERGE_MAX_LINES) { conflict('too_long'); continue; }
    const merged = mergeLines(b.text, o.text, t.text);
    if (merged === null) { conflict('text_overlap'); continue; }
    // No sensitive check is needed on the merged text: neither side is sensitive, the two sides' hunks are always
    // separated by at least one unchanged base line, and every pattern matches within one line or across a single
    // newline, so a merge cannot assemble a sensitive phrase that neither side had.
    outcomes[id] = 'text_merged';
    combined = true;
    chosen.set(id, { ...o, value: rewriteValue(o, merged), text: merged, sensitive: [] });
  }

  // Order: ours' order, then units only theirs has, each after its predecessor in theirs (or at the end).
  const order: string[] = ours.map((u) => u.id);
  for (const id of base.map((u) => u.id)) if (!order.includes(id)) order.push(id);
  theirs.forEach((u, i) => {
    if (order.includes(u.id)) return;
    const prev = i > 0 ? theirs[i - 1].id : null;
    const at = prev ? order.indexOf(prev) : -1;
    order.splice(at + 1, 0, u.id);
  });
  const units = order.map((id) => chosen.get(id)).filter((u): u is Unit => !!u);

  const sides = new Set(Object.values(outcomes).map((x) => (x.endsWith('ours') ? 'o' : x.endsWith('theirs') ? 't' : x)));
  if (sides.has('o') && sides.has('t')) combined = true;

  return {
    kind,
    units,
    outcomes,
    conflicts,
    review: [...review.entries()].map(([unitId, c]) => ({ unitId, categories: [...c].sort() })),
    requiresHumanConfirmation: ALWAYS_CONFIRM_KINDS.has(kind) || combined || review.size > 0 || conflicts.length > 0,
  };
}

/** A merged text unit's value: plain text units hold the text; a deck text block holds the block with new text. */
function rewriteValue(u: Unit, text: string): string {
  try {
    const v = JSON.parse(u.value);
    if (typeof v === 'string') return stable(text);
    if (v && typeof v === 'object' && typeof v.text === 'string') return stable({ ...v, text });
  } catch { /* fall through */ }
  return stable(text);
}

/**
 * A person picks one side of a conflicted unit (or the base). The plan stays a candidate that needs confirmation;
 * an agent cannot choose (D5579: approval is a person's).
 */
export function chooseVariant(plan: MergePlan, unitId: string, pick: 'base' | 'ours' | 'theirs', by: Actor): MergePlan | MergeRefusal {
  if (by.kind !== 'person') return { ok: false, code: 'not_a_person' };
  const c = plan.conflicts.find((x) => x.unitId === unitId);
  if (!c) return { ok: false, code: plan.outcomes[unitId] ? 'not_in_conflict' : 'unknown_unit' };
  const unit = c[pick];
  const at = plan.units.findIndex((u) => u.id === unitId);
  const units = [...plan.units];
  if (unit) {
    if (at >= 0) units[at] = unit; else units.push(unit);
  } else if (at >= 0) {
    units.splice(at, 1);
  }
  return {
    ...plan,
    units,
    outcomes: { ...plan.outcomes, [unitId]: pick === 'base' ? 'unchanged' : pick },
    conflicts: plan.conflicts.filter((x) => x.unitId !== unitId),
    requiresHumanConfirmation: true,
  };
}

/** Whether the plan may become a ChangeSet: no conflict left. Publication still needs a person's ReviewDecision. */
export function readyForReview(plan: MergePlan): boolean {
  return plan.conflicts.length === 0;
}
