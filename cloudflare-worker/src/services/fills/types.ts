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
  /**
   * The value actually written, AS A PERSON READS IT AND IN THE SAME SHAPE AS
   * `readable(payload)`. `recordFill` derives `edited` by comparing the two, so a
   * kind that returns a raw column value here while `readable` returns a sentence
   * marks every accept as corrected. The pair is an audit record, not two
   * different views.
   */
  written: string;
  /**
   * The address, when only the write knows it.
   *
   * `target()` is computed before `apply` runs and cannot name a row an INSERT is
   * about to allocate — `insertHypothesis` returns its id, and a pain alias upsert
   * lands on a row whose id depends on whether the phrase was already grouped. A
   * kind that writes one of those returns the address it actually wrote, and the
   * accept route prefers it. `target()` stays for kinds whose address is known up
   * front, and as the fallback when this is absent.
   */
  target?: FillTarget;
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
  /**
   * The blank's own address — `validate/pain-map`, `market/sizing`. Stored in
   * `validate_proposals.surface`, and what a band names when it lists what it can
   * offer. Fine-grained on purpose: two kinds on one page are two bands.
   */
  surface: string;
  /**
   * The `ASSIST_SURFACES` key in `frontend/src/ui/eadwynConfig.js` whose `mode`
   * entry gates this kind — a COARSER namespace, and not the same one.
   *
   * `eadwynConfig` is keyed per RAIL, and one rail sits behind many zones:
   * `workspace` is the single entry for every workspace zone, and that file says
   * why — "twenty surfaces over one task class would report the same average
   * twenty times and call it per-page data". This registry addresses individual
   * blanks instead. Naming both makes the link one field rather than a
   * convention, and lets `fills_registry.test.ts` check D17's rule against it: a
   * kind whose rail declares no `mode` entry is a capability with no switch,
   * which is the mirror image of the dead config
   * `ui_assist_rail_and_sidebar` already refuses — a switch with no capability.
   */
  assistSurface: string;
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

  /**
   * Which payload key a founder may rewrite before accepting, or null when none.
   *
   * NOT EVERY FILL IS EDITABLE, AND SAYING SO IS THE POINT. A `pain_tag`'s phrase
   * is the PROJECT'S OWN STRING — `parseTagProposals` emits the logged phrase
   * rather than the model's echo of it, precisely so a near-miss spelling cannot
   * become a second phrase. Letting a founder retype it would break the one
   * guarantee a restatement makes: that the value matches a row already on file.
   * What they would actually want to change there is the THEME, which is a picker
   * and not a text box, so the kind declares `null` and the route refuses an edit
   * with that as its reason rather than silently accepting the original.
   *
   * A `hypothesis` claim is the opposite: prose the founder owns the moment they
   * touch it, and the canvas has offered "Edit the claim" since the band was
   * drawn.
   */
  editableField: string | null;

  /** The proposal as a person reads it — what `fill_provenance` stores. */
  readable(payload: Record<string, unknown>): string;

  gather(ctx: FillContext): Promise<Gathered>;
  /**
   * The model's reply, turned into proposals — and this is where a proposal earns
   * the right to be offered at all.
   *
   * ASYNC AND GIVEN THE CONTEXT, because a `sourced` kind has to go and find its
   * citation: the model returns a figure, and `services/fills/citations.ts` looks
   * for a passage that supports it in the founder's own library and then, failing
   * that, in a research call. A synchronous `parse` would force the citation step
   * to happen somewhere else, and "somewhere else" is how a `sourced` proposal
   * ends up stored with a null citation. A `restatement` ignores `ctx` and returns
   * an array; the caller awaits either.
   */
  parse(text: string, gathered: Gathered, ctx: FillContext): Proposed[] | Promise<Proposed[]>;
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
