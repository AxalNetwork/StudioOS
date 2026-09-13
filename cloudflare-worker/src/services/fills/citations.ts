/**
 * Where a `sourced` fill's number comes from, and the quote that supports it.
 *
 * A `restatement` needs no source: `parseTagProposals` refuses a phrase that is
 * not already in the project, so the evidence is on file before the proposal
 * exists. A market size has no such anchor — the whole point of asking for TAM is
 * that the project does not contain it — and with no replacement guarantee,
 * filling it means writing an unsourced number into `projects.tam`, a column the
 * founder's own derivation occupies. This module is the replacement.
 *
 * TWO SOURCES, IN THIS ORDER, AND THE ORDER IS THE DESIGN.
 *
 *   1. THE READER'S OWN LIBRARY. `research_documents` (migration 213) is already
 *      chunked and embedded per account, and `searchSemantic` already returns the
 *      passage. A figure drawn from a document the founder uploaded is the best
 *      citation available anywhere in this product: they can open it. It costs
 *      one embedding and no model call.
 *   2. A LIVE RESEARCH CALL, only when the library cannot answer. `research_ask`
 *      is an existing router task class, and the query travels onto the citation
 *      so a reader can see what was asked rather than only what came back.
 *
 * THE RULE THAT MAKES THE CLASS MEAN SOMETHING: no citation, no proposal. This
 * module returns null and `refuseReason` in `types.ts` drops the proposal — never
 * written with a null citation, never written with a hedge. It is the direct
 * analogue of the tagger dropping a phrase it cannot match, and it is the only
 * thing standing between an invented figure and a column a measured one holds.
 *
 * WHAT THIS MODULE WILL NOT DO. It does not decide whether a figure is right, and
 * it cannot: a quote that mentions a number is not a quote that supports the
 * number a model attached to it. What it guarantees is narrower and checkable —
 * that a reader is shown the passage and can judge for themselves. A citation
 * whose quote is absent, empty, or not actually from the retrieved passage is
 * refused here, because a citation nobody can check is worse than none: it
 * borrows the authority of a source without accepting the check.
 */
import type { Env } from '../../types';
import { searchSemantic, researchNamespace } from '../vectorize';
import { run as runAI } from '../aiRouter';
import type { Citation } from './types';

/**
 * The relevance floor, taken from `routes/research.ts` rather than chosen again.
 *
 * Ask refuses to answer below 0.55 and tells the reader the library had nothing
 * close enough. A fill that cited a 0.3 match would be claiming support Ask
 * itself would have declined to claim, from the same documents, over the same
 * index — two numbers for one judgement, and the looser one deciding what gets
 * written. If this floor should move it should move for both.
 */
export const CITE_SCORE_FLOOR = 0.55;

/** How much of a passage travels onto the citation. Enough to judge, not a page. */
export const MAX_QUOTE = 400;

/**
 * The shortest quote that can support anything.
 *
 * A four-character "42%" is not a citation, it is the figure again with a source
 * label attached. The floor is deliberately low — a real supporting sentence is
 * far longer — and exists to catch a truncated or empty passage rather than to
 * judge prose.
 */
export const MIN_QUOTE = 24;

const tidy = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Cite from the founder's own library, or return null.
 *
 * Scoped three ways, all of them `searchSemantic`'s own: `type: 'research_doc'`
 * so the owner-private default does not drop every hit, the account's namespace,
 * and `ownerUserId` re-checked against each hit. That is the same triple
 * `routes/research.ts` passes — a fill must not be able to see documents Ask
 * cannot, and passing two of the three is how that would happen quietly.
 */
export async function citeFromLibrary(
  env: Env, userId: number, query: string,
): Promise<Citation | null> {
  const q = tidy(query);
  if (!q) return null;
  let hits;
  try {
    hits = await searchSemantic(env, q, {
      topK: 5,
      type: 'research_doc',
      namespace: researchNamespace(userId),
      ownerUserId: userId,
    });
  } catch (e) {
    console.error('[fills] citeFromLibrary:', (e as Error).message);
    return null;
  }
  const best = (hits || []).filter((h) => Number(h.score) >= CITE_SCORE_FLOOR)[0];
  if (!best) return null;

  const quote = tidy(best.snippet).slice(0, MAX_QUOTE);
  // A HIT WITH NO PASSAGE IS NOT A CITATION. `snippet` is capped at 280 chars on
  // upsert and can be empty for a vector written before the library stored one;
  // citing it would name a document and show nothing.
  if (quote.length < MIN_QUOTE) return null;
  const documentId = Number(best.entity_id);
  if (!Number.isFinite(documentId) || documentId <= 0) return null;

  return {
    kind: 'library',
    document_id: documentId,
    title: tidy(best.title) || 'Untitled document',
    // Chunk 0 is a real chunk — the first of every document, and the one most
    // likely to be cited — so the test is finiteness rather than truthiness. A
    // hit that carries no chunk at all is a whole-entity vector, and 0 is the
    // right thing to record for it: the passage IS the document.
    chunk: Number.isFinite(Number(best.chunk)) ? Number(best.chunk) : 0,
    quote,
  };
}

/**
 * The model's own answer to a research question, with the source it names.
 *
 * USED ONLY WHEN THE LIBRARY CANNOT ANSWER, and it asks for the source as part of
 * the reply rather than inferring one afterwards: a citation assembled after the
 * fact would be a label this code chose for a sentence the model produced, which
 * is exactly the pretence this whole module exists to avoid. A reply that names
 * no source, or whose quote is too short to check, returns null and the proposal
 * is dropped.
 *
 * `usage.model` — the model that ACTUALLY ran, not the one requested — is what
 * the caller records, so the router's fallback chain cannot make a provenance row
 * name a model that never saw the question.
 */
export interface ResearchedCitation {
  citation: Citation | null;
  /** The model that ran, for the provenance row. Null when nothing ran. */
  model: string | null;
}

export async function citeFromResearch(
  env: Env, userId: number, query: string,
): Promise<ResearchedCitation> {
  const q = tidy(query);
  if (!q) return { citation: null, model: null };

  const prompt = [
    'You answer one factual research question and name where the answer comes from.',
    'Reply with ONE JSON object and nothing else:',
    '{"source": "the publication, report or organisation", "quote": "the sentence that states it"}',
    'The quote must be a sentence a reader could look up, not a restatement of the question.',
    'If you do not have a source you can name, reply exactly {"source": null, "quote": null}.',
    'Never invent a publication, a report title, a date or a URL.',
    '',
    `Question: ${q}`,
  ].join('\n');

  let out;
  try {
    out = await runAI(env, { task: 'research_ask', userId, text: prompt, maxTokens: 400 });
  } catch (e) {
    console.error('[fills] citeFromResearch:', (e as Error).message);
    return { citation: null, model: null };
  }
  // `usage` is non-optional on every path the router takes, refusals included,
  // which is why the model can be reported even when no citation comes back.
  const model = out?.usage?.model ?? null;
  if (!out?.ok || !out.output) return { citation: null, model };

  let parsed: any = null;
  try {
    const text = String(out.output);
    const at = text.indexOf('{');
    const to = text.lastIndexOf('}');
    parsed = at >= 0 && to > at ? JSON.parse(text.slice(at, to + 1)) : null;
  } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object') return { citation: null, model };

  const source = tidy(parsed.source);
  const quote = tidy(parsed.quote).slice(0, MAX_QUOTE);
  // BOTH HALVES OR NEITHER. A source with no quote asks for trust in a label; a
  // quote with no source is an assertion in quotation marks. The "I have no
  // source" reply lands here too, which is the outcome this path is designed to
  // make cheap rather than an error to work around.
  if (!source || quote.length < MIN_QUOTE) return { citation: null, model };

  return {
    citation: { kind: 'research', task: 'research_ask', query: q, source, quote },
    model,
  };
}

/**
 * Library first, a call second, null if neither can answer.
 *
 * The order is not a preference between two equal options. A library hit is a
 * document the reader owns and can open; a research call is a model's word about
 * a source the reader has to go and find. Trying the cheap, checkable one first
 * is also what keeps a fill from spending a model call on a question the
 * founder's own uploads already answer.
 */
export async function citeFor(
  env: Env, userId: number, query: string,
): Promise<ResearchedCitation> {
  const fromLibrary = await citeFromLibrary(env, userId, query);
  // No model ran, so no model is named. A provenance row for a library-cited
  // fill names the model that PROPOSED it, which the caller already has from its
  // own run — not this one.
  if (fromLibrary) return { citation: fromLibrary, model: null };
  return citeFromResearch(env, userId, query);
}
