/**
 * Every fill kind, and the one place a new surface is added.
 *
 * `routes/founder_validate.ts` knows both of Validate's kinds by name. Its
 * propose route branches on `if (kind === 'pain_tag')` to choose a prompt and
 * assemble facts; its accept route branches on the same string to choose a
 * writer. Adding a third kind there means editing two branches in a file about
 * Validate, and a fourth means three. This registry is where that stops.
 *
 * THE INVARIANT A REVIEWER SHOULD CHECK FIRST, before anything else in this
 * file: every entry's `apply` calls the function the manual form already calls.
 * D46 states it for Validate — "accepting and typing produce the same row" — and
 * the reason is concrete rather than tidy: `insertHypothesis` allocates `H1, H2 …`
 * from `MAX(CAST(substr(code,2) AS INTEGER))` over every code ever used, so a
 * retired `H2` is never reissued. A second writer with its own idea of that rule
 * is how duplicate codes start being handed out, quietly, to a founder who will
 * find out when two claims share a name in a board pack.
 *
 * `fills_registry.test.ts` asserts it mechanically: each entry's `apply` body
 * must name a function that the surface's own manual route also calls.
 *
 * NOTHING IN HERE DECIDES ANYTHING. A kind gathers facts, parses a reply into
 * proposals, and — once a person has accepted one — applies it. The decision is
 * always the reader's, and `parse` is where a proposal earns the right to be
 * offered at all: see `types.ts` on the three classes and what each must prove.
 *
 * THE TWO VALIDATE KINDS MOVED HERE UNCHANGED, deliberately. Their prompts,
 * parsers, gathers and writers are the ones that shipped; the only thing that
 * changed is who calls them. A generalisation that also alters behaviour cannot
 * be reviewed, because nothing tells you which half broke.
 */
import type { Env } from '../../types';
import { getPainGroupsView, normPhrase } from '../painGroups';
import {
  MAX_PROMPT_ITEMS, TAG_PROMPT, DRAFT_PROMPT,
  parseTagProposals, parseDraftProposals,
} from '../../routes/_founder_validate_proposals';
import { MAX_PAIN_PHRASE, insertHypothesis, upsertPainAlias } from '../../routes/_founder_validate_writes';
import type { FillKind, Gathered, Proposed } from './types';

/**
 * `validate/pain-map` — sort logged phrases into themes the founder named.
 *
 * A RESTATEMENT, and the strictest one in the product. `parseTagProposals`
 * refuses a phrase that is not in this project's own ungrouped set and a
 * `pain_group_id` that is not one of its own themes, and it emits the PROJECT'S
 * phrase string rather than the model's echo of it — so a near-miss spelling
 * cannot become a second phrase. D46: "the tagger sorts phrases into themes the
 * founder wrote and cannot create one: naming the thing the venture is about is
 * not a thing to hand over."
 */
const painTag: FillKind = {
  kind: 'pain_tag',
  surface: 'validate/pain-map',
  fillClass: 'restatement',
  task: 'validate_tag_pains',
  copy: {
    run: 'Tag ungrouped phrases',
    heading: 'Proposal · phrases sorted into your themes',
    empty: 'Nothing proposed yet. Eadwyn will sort logged phrases into themes you have already named — it never names one.',
    accept: 'Add to the theme',
  },
  prompt: TAG_PROMPT,
  // The phrase is the project's own logged string and cannot be retyped without
  // breaking the match-back this kind rests on. See `editableField` in types.ts.
  editableField: null,
  readable: (p) => `${String(p.phrase)} → ${String(p.group_title)}`,

  async gather(ctx): Promise<Gathered> {
    const view = await getPainGroupsView(ctx.env, ctx.projectId);
    const groups = view.groups.map((g) => ({ id: Number(g.id), title: String(g.title) }));
    const ungrouped = view.ungrouped.map((u) => String(u.display_phrase)).slice(0, MAX_PROMPT_ITEMS);
    // Two different empties, said differently, because they need different
    // actions: no themes means group one by hand first, and no ungrouped
    // phrases means there is nothing left to sort. Spending a run to be told
    // either by a model is a run wasted.
    if (!groups.length) {
      return { facts: '', empty: true, emptyReason: 'There are no pain themes to sort into yet. Group one phrase by hand first.' };
    }
    if (!ungrouped.length) {
      return { facts: '', empty: true, emptyReason: 'Every logged phrase is already in a theme.' };
    }
    return {
      facts: [
        'Themes:',
        ...groups.map((g) => `  ${g.id}: ${g.title}`),
        '',
        'Ungrouped phrases:',
        ...ungrouped.map((p) => `  - ${p}`),
      ].join('\n'),
      // The match-back set is every ungrouped phrase, and the group list travels
      // with it through `known` so `parse` can check both halves.
      known: view.ungrouped.map((u) => String(u.display_phrase)),
      groups,
    } as Gathered & { groups: Array<{ id: number; title: string }> };
  },

  parse(text, gathered): Proposed[] {
    const groups = (gathered as Gathered & { groups?: Array<{ id: number; title: string }> }).groups || [];
    return parseTagProposals(text, gathered.known || [], groups).map((p) => ({
      payload: { ...p },
      // The address is the theme, because that is the row the alias hangs off.
      targetRef: `pain_group:${p.pain_group_id}`,
      readable: `${p.phrase} → ${p.group_title}`,
    }));
  },

  async apply(ctx, payload) {
    // `upsertPainAlias` — the same function `PUT /pain-groups/:id/aliases` calls.
    // It verifies the theme belongs to this project and returns false when it
    // does not, which is the tenancy check rather than a convenience.
    const groupId = Number(payload.pain_group_id);
    const ok = await upsertPainAlias(ctx.env, ctx.projectId, groupId, String(payload.phrase));
    if (!ok) throw new Error('That theme no longer exists');

    // READ BACK WHAT WAS STORED rather than echo the payload. `upsertPainAlias`
    // trims and caps the phrase at `MAX_PAIN_PHRASE` and normalises it, so the
    // stored `display_phrase` is the truthful half of the audit pair — and a
    // phrase that was capped on the way in is a real difference between what was
    // proposed and what was written, which is exactly what `edited` is for.
    const stored = await ctx.env.DB.prepare(
      `SELECT a.id, a.display_phrase, g.title
         FROM pain_group_aliases a JOIN pain_groups g ON g.id = a.group_id
        WHERE a.project_id = ? AND a.group_id = ? AND a.phrase_norm = ?`,
    ).bind(ctx.projectId, groupId, normPhrase(String(payload.phrase || '').trim().slice(0, MAX_PAIN_PHRASE)))
      .first<{ id: number; display_phrase: string; title: string }>();

    return {
      written: stored ? `${stored.display_phrase} → ${stored.title}` : String(payload.phrase),
      // THE ALIAS ROW, AND ITS `group_id` — not its phrase. The phrase is the
      // project's own logged string and the tagger cannot invent one; the theme
      // is the only thing this fill decided, so it is the only thing the
      // provenance row may claim. Addressing `display_phrase` instead would
      // record that Eadwyn supplied a phrase the founder typed.
      target: stored
        ? { table: 'pain_group_aliases', rowId: Number(stored.id), column: 'group_id' }
        : undefined,
      result: { kind: 'pain_tag' },
    };
  },

  // The fallback for a database that somehow lost the row between the upsert and
  // the read above. `pain_groups` is the one id known before the write.
  target(payload) {
    return { table: 'pain_groups', rowId: Number(payload.pain_group_id), column: 'id' };
  },
};

/**
 * `validate/hypotheses` — draft a claim from the themes already on the board.
 *
 * ALSO A RESTATEMENT, and the thing it restates is the fold of the evidence
 * rather than one row. `parseDraftProposals` refuses a claim under four words and
 * dedupes against both the hypotheses on file AND everything ever proposed for
 * this project — pending, accepted or discarded — so a suggestion a founder threw
 * away is never offered a second time.
 */
const hypothesis: FillKind = {
  kind: 'hypothesis',
  surface: 'validate/hypotheses',
  fillClass: 'restatement',
  task: 'validate_draft_hypotheses',
  copy: {
    run: 'Draft a hypothesis',
    heading: 'Proposal · drafted from recurring pains',
    empty: 'Nothing proposed yet. Eadwyn drafts a claim from the themes already on your board.',
    accept: 'Add to the board',
  },
  prompt: DRAFT_PROMPT,
  // Prose the founder owns the moment they touch it. The canvas has offered
  // "Edit the claim" since this band was drawn and only accept and discard were
  // ever built.
  editableField: 'claim',
  readable: (p) => String(p.claim || ''),

  async gather(ctx): Promise<Gathered> {
    const view = await getPainGroupsView(ctx.env, ctx.projectId);
    if (!view.groups.length) {
      return { facts: '', empty: true, emptyReason: 'There are no pain themes to draft a claim from yet.' };
    }
    const existing = await ctx.env.DB.prepare('SELECT claim FROM hypotheses WHERE project_id = ?')
      .bind(ctx.projectId).all<{ claim: string }>();
    return {
      facts: [
        'Pain themes, with how many interviews mentioned each:',
        ...view.groups.slice(0, MAX_PROMPT_ITEMS)
          .map((g) => `  - ${g.title} (${g.count} of ${view.interview_total} interviews)`),
      ].join('\n'),
      // What counts as taken. The caller appends everything ever proposed.
      known: (existing.results || []).map((h) => String(h.claim)),
    };
  },

  parse(text, gathered): Proposed[] {
    return parseDraftProposals(text, [...(gathered.known || []), ...(gathered.priors || [])]).map((p) => ({
      payload: { ...p },
      targetRef: 'hypotheses',
      readable: String(p.claim),
    }));
  },

  async apply(ctx, payload) {
    // `insertHypothesis` — the same function `POST /hypotheses` calls, and the
    // only place the `H1, H2 …` allocation lives. See this file's header.
    const written = await insertHypothesis(ctx.env, ctx.projectId, String(payload.claim || '').trim());
    return {
      written: written.claim,
      // The row the insert allocated, which is knowable only here. `target()`
      // below cannot name it, and guessing would address some other project's
      // hypothesis whose id happened to match.
      target: { table: 'hypotheses', rowId: written.id, column: 'claim' },
      result: { kind: 'hypothesis', hypothesis: written },
    };
  },

  target(_payload, _targetRef, ctx) {
    // UNREACHABLE IN PRACTICE, and deliberately useless: `apply` above always
    // returns the real address, and this is what the route falls back to when it
    // somehow does not. `id 0` is a row that cannot exist, which is a provenance
    // row a reader can spot as unaddressed rather than one silently pointing at
    // an unrelated claim — which is what `rowId: ctx.projectId` did here before.
    void ctx;
    return { table: 'hypotheses', rowId: 0, column: 'claim' };
  },
};

/** Every kind, by its stable id. The one list a new surface is added to. */
export const FILL_KINDS: Record<string, FillKind> = {
  [painTag.kind]: painTag,
  [hypothesis.kind]: hypothesis,
};

export const fillKind = (kind: string): FillKind | null => FILL_KINDS[kind] || null;

/** Every kind a surface offers, in registration order. */
export function kindsForSurface(surface: string): FillKind[] {
  return Object.values(FILL_KINDS).filter((k) => k.surface === surface);
}

/**
 * The surfaces that have any fill at all.
 *
 * `eadwynConfig`'s rule is that "config follows a mount, never the other way
 * round", and D46's is that the switch appears only where a page branches. This
 * is the server's half of both: a surface absent from here has nothing to offer,
 * and `fills_registry.test.ts` checks it against the SPA's own mode entries so
 * neither side can grow a surface the other does not have.
 */
export const FILL_SURFACES: readonly string[] = [
  ...new Set(Object.values(FILL_KINDS).map((k) => k.surface)),
];

/** Does this env even have the table? Used by the route to answer honestly. */
export async function proposalsTableReady(env: Env): Promise<boolean> {
  try {
    const r = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'validate_proposals'",
    ).first<{ name: string }>();
    return !!r;
  } catch { return false; }
}
