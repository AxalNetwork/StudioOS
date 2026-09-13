/**
 * What a fill kind is, and the three promises one has to keep.
 *
 * "AI fills the blanks" shipped on founder Validate with the dispatch hardcoded:
 * `routes/founder_validate.ts`'s accept path reads `if (row.kind === 'pain_tag')`
 * and knows both kinds by name. That is the one place generality has to land, and
 * this file is the shape it lands in.
 *
 * WHY THERE ARE THREE CLASSES RATHER THAN ONE PIPELINE. D46's honesty mechanism
 * is MATCH-BACK: "every item is matched back against something that exists in the
 * project before it can become a row". `parseTagProposals` refuses a phrase not in
 * the project's own ungrouped set; `parseDraftProposals` refuses a claim that
 * restates one on file. Both of Validate's fills are RESTATEMENTS of evidence the
 * founder logged, so the rule fits them exactly.
 *
 * It does not fit a market size. Asking Eadwyn for TAM is asking for something the
 * project does not contain, so there is nothing to match back against — and with
 * no replacement guarantee, filling it means writing an unsourced number into
 * `projects.tam`, a column `SpinoutLabMarketPage` fills by deriving it from an
 * addressable population and an ACV the founder supplied. The column would stop
 * distinguishing a figure somebody reasoned to from one a model produced.
 *
 * So each kind declares which promise it keeps:
 *
 *   restatement   It restates something already in the project. The parse must
 *                 refuse anything it cannot match to an existing row. Free —
 *                 no citation needed, because the evidence is already on file.
 *
 *   sourced       It brings in a fact from outside. The parse must refuse
 *                 anything with no citation. A `sourced` proposal with a null
 *                 `citation` is DROPPED, never written with a hedge — the direct
 *                 analogue of an unmatched phrase being dropped today.
 *
 *   composition   It writes prose that makes no factual claim — a tagline, a
 *                 positioning line. Nothing to match, nothing to cite. Its
 *                 promise is narrower and structural: it may never target a
 *                 column that holds a MEASURED value, and `assertFillClass`
 *                 below is where that is enforced rather than remembered.
 *
 * THE INVARIANT THAT MATTERS MOST, AND THE ONE A REVIEWER SHOULD CHECK FIRST:
 * `apply` must be the function the manual form already calls. D46 states it for
 * Validate — "accepting and typing produce the same row" — and the reason is
 * concrete: `insertHypothesis` allocates `H1, H2 …` from
 * `MAX(CAST(substr(code,2) AS INTEGER))` so a retired code is never reissued, and
 * a second writer with its own idea of that rule is how duplicate codes start
 * being handed out. A registry entry that reimplements a write instead of calling
 * the form's own writer has broken the whole point of the registry.
 */
import type { Env, User } from '../../types';

/** The three promises. See the header for why they are not interchangeable. */
export type FillClass = 'restatement' | 'sourced' | 'composition';
export const FILL_CLASSES: readonly FillClass[] = ['restatement', 'sourced', 'composition'];
export const isFillClass = (v: unknown): v is FillClass =>
  typeof v === 'string' && (FILL_CLASSES as readonly string[]).includes(v);

/**
 * Where a sourced value came from, with the quote that supports it.
 *
 * The quote is not decoration. A citation that names a document and nothing else
 * asks a reader to trust the label; one that carries the sentence lets them judge
 * whether it says what the fill claims it says. `library` costs no external call
 * — `research_documents` (213) through `services/vectorize.ts` already returns
 * cited snippets. `research` is the live call, used only when the library cannot
 * answer, and it keeps the query so a reader can see what was asked.
 */
export type Citation =
  | { kind: 'library'; document_id: number; title: string; chunk: number; quote: string }
  | { kind: 'research'; task: string; query: string; source: string; quote: string };

/** One proposed value, before anybody has decided anything about it. */
export interface Proposed {
  /** The payload the `apply` of this kind understands. Shape is the kind's own. */
  payload: Record<string, unknown>;
  /**
   * Which blank this fills, as the surface addresses it. Opaque to the store;
   * `target()` turns it into a physical address for `fill_provenance`.
   */
  targetRef: string;
  /** Required for `sourced`, refused for the other two. See `assertFillClass`. */
  citation?: Citation;
  /**
   * The value as a person reads it, for `fill_provenance.proposed_value`. Kept
   * separately from `payload` because a payload is shaped for a writer and a
   * provenance row is shaped for a reader asking "what did it say before I
   * changed it".
   */
  readable: string;
}

/** What `gather` hands the parser: the facts to prompt with, and what to match. */
export interface Gathered {
  /** The prompt body. Bounded by the caller to `MAX_PROMPT_ITEMS`. */
  facts: string;
  /**
   * The match-back set, for a `restatement`. Anything the model returns that is
   * not in here is dropped. Empty for `sourced` and `composition`, which is why
   * `assertFillClass` refuses a `restatement` that declares one.
   */
  known?: readonly string[];
  /** Everything already offered for this kind, so a discard is never re-offered. */
  priors?: readonly string[];
  /** True when there is genuinely nothing to work from — a clean 400, not a run. */
  empty?: boolean;
  /** Why it is empty, in the words the page shows. */
  emptyReason?: string;
}

/** The physical address a provenance row records. */
export interface FillTarget {
  table: string;
  rowId: number;
  column: string;
}

/** What `apply` did, for the provenance row and the HTTP response. */
export interface Applied {
  /** The value actually written, as a person reads it. */
  written: string;
  /** Anything the surface wants echoed back — an id, a code. */
  result?: Record<string, unknown>;
}

/** The caller, and what they are filling for. */
export interface FillContext {
  env: Env;
  user: User;
  projectId: number;
}

export interface FillKind {
  /** Stable id. Stored in `validate_proposals.kind` and never re-used. */
  kind: string;
  /** Zone key — `validate/pain-map`, `grow/market`. Drives the mode gate. */
  surface: string;
  fillClass: FillClass;
  /**
   * The router task class. It MUST declare `alternates` in `aiRouter`'s ROUTE
   * table, or `run()` refuses every `opts.model` outright — including the
   * primary — and the rail's model menu becomes a control that cannot be used.
   */
  task: string;
  /** Copy for the band. The registry owns it so a surface cannot drift from it. */
  copy: { run: string; heading: string; empty: string; accept: string };
  /** The system prompt. A `string[].join('\n')`, per this repo's convention. */
  prompt: string;

  gather(ctx: FillContext): Promise<Gathered>;
  parse(text: string, gathered: Gathered): Proposed[];
  apply(ctx: FillContext, payload: Record<string, unknown>, targetRef: string): Promise<Applied>;
  target(payload: Record<string, unknown>, targetRef: string, ctx: FillContext): FillTarget;
}

/**
 * Refuse a proposal whose class and evidence disagree — before it is stored.
 *
 * This is the check the whole three-class design exists to make possible, and it
 * runs on the WRITE path rather than in a review: a `sourced` value with no
 * citation is not a lower-quality fill, it is an assertion with nothing behind
 * it, and the store must not be able to hold one.
 *
 * Returns the reason it was refused, or null when it may be written. A reason
 * rather than a boolean because the propose route counts refusals and says how
 * many were dropped — a run that silently returns two of five proposals reads as
 * a model that had little to say, when what happened is that three were refused.
 */
export function refuseReason(kind: FillKind, p: Proposed): string | null {
  if (!p || typeof p !== 'object') return 'not a proposal';
  if (!p.readable || !String(p.readable).trim()) return 'no readable value';
  if (!p.targetRef || !String(p.targetRef).trim()) return 'no target';
  if (kind.fillClass === 'sourced') {
    if (!p.citation) return 'a sourced fill with no citation';
    const c = p.citation as Citation;
    if (!c.quote || !String(c.quote).trim()) return 'a citation with no quote';
    if (c.kind === 'library' && !Number.isFinite(Number(c.document_id))) return 'a library citation naming no document';
    if (c.kind === 'research' && !String(c.query || '').trim()) return 'a research citation naming no query';
    if (c.kind !== 'library' && c.kind !== 'research') return 'a citation of an unknown kind';
    return null;
  }
  // A citation on a restatement or a composition is not harmless — it would put
  // a source beside a value the source did not supply, which is the one thing a
  // citation must never do.
  if (p.citation) return `a ${kind.fillClass} fill carrying a citation`;
  return null;
}
