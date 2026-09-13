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
  extractJsonArray, parseTagProposals, parseDraftProposals,
} from '../../routes/_founder_validate_proposals';
import { MAX_PAIN_PHRASE, insertHypothesis, upsertPainAlias } from '../../routes/_founder_validate_writes';
import { ASSUMPTION_COLUMNS, loadAssumptions, saveOneAssumption } from '../marketAssumptions';
import { citeFor } from './citations';
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
  assistSurface: 'workspace',
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
  assistSurface: 'workspace',
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

/**
 * `market/sizing` — an addressable population and an ACV, each with a citation.
 *
 * THE FIRST `sourced` FILL, AND THE REASON THE CLASS EXISTS. `SpinoutLabMarketPage`
 * carries a comment its author wrote deliberately: "Design says AI-assisted
 * estimates — these figures are founder-entered/derived, not AI output, so the
 * copy drops that claim rather than lie about provenance." On screen it says
 * "Nothing on this page is auto-invented — empty means not researched yet", and
 * stamps each card "Founder research" or "Founder model". Three true statements,
 * and this entry is built so they stay true rather than get contradicted.
 *
 * IT DOES NOT PROPOSE TAM. The page DERIVES TAM from population × ACV with the
 * founder's own assumptions, so proposing a TAM would write over their arithmetic
 * with a number whose reasoning is invisible — into `projects.tam`, a bare REAL
 * with nothing beside it to say who produced it. What this proposes is the INPUTS,
 * into `project_market_assumptions` (247), where a provenance row can point at
 * one column and the page can mark that figure and not the rest.
 *
 * NO CITATION, NO PROPOSAL. `parse` asks `services/fills/citations.ts` for a
 * passage supporting each figure — the founder's own library first, a research
 * call second — and returns nothing for a figure it cannot source.
 * `refuseReason` refuses it a second time on the write path, which is belt and
 * braces on purpose: this is the one code path where a silent failure writes an
 * invented number into a column a measured one occupies.
 */
const MARKET_FIELDS: Record<string, { label: string; asks: string }> = {
  population: {
    label: 'Addressable population',
    asks: 'how many organisations or people are in the addressable market',
  },
  acv: {
    label: 'Annual contract value',
    asks: 'what a comparable product charges per customer per year',
  },
  cagr: {
    label: 'Market growth rate',
    asks: 'the compound annual growth rate of this market',
  },
};

const marketSizing: FillKind = {
  kind: 'market_input',
  surface: 'market/sizing',
  assistSurface: 'market',
  fillClass: 'sourced',
  task: 'market_sizing_inputs',
  copy: {
    run: 'Find sizing inputs',
    heading: 'Proposal · sizing inputs, each with a source',
    empty: 'Nothing proposed yet. Eadwyn looks for an addressable population, an ACV benchmark and a growth rate — and proposes only the ones it can cite.',
    accept: 'Use this figure',
  },
  prompt: [
    'You propose INPUTS to a market-sizing calculation. You never propose the market size itself.',
    'Reply with ONE JSON array and nothing else. Each item:',
    '{"field": "population" | "acv" | "cagr", "value": "the figure, as a person would write it", "asked": "the research question that would confirm it"}',
    'Give at most one item per field, and only for fields the facts below leave empty.',
    '"value" is a figure with its unit — "41,200 firms", "$18,000 / year", "11%".',
    '"asked" is a question a researcher could look up, naming the market and the year.',
    'Do NOT state a source in your reply. A source is looked up separately, and an item',
    'whose figure cannot be supported is discarded rather than published.',
    'If you cannot propose a figure for a field, omit the field. An empty array is a valid answer.',
  ].join('\n'),
  // A figure is the founder's the moment they correct it, and correcting a
  // researched number against their own knowledge of the market is the normal
  // case rather than the exception. `fill_provenance` keeps both values and marks
  // it edited, which is what makes a corrected fill legible as neither the
  // model's answer nor an unaided one.
  editableField: 'value',
  readable: (p) => {
    const field = String(p.field || '');
    const label = MARKET_FIELDS[field]?.label || field;
    return `${label}: ${String(p.value ?? '')}`;
  },

  async gather(ctx): Promise<Gathered> {
    const project = await ctx.env.DB.prepare(
      'SELECT name, sector, description FROM projects WHERE id = ?',
    ).bind(ctx.projectId).first<{ name: string; sector: string | null; description: string | null }>();
    if (!project) {
      return { facts: '', empty: true, emptyReason: 'This project could not be read.' };
    }
    // WHAT IS ALREADY FILLED IS NOT PROPOSED AGAIN. A founder who typed a
    // population does not want it argued with, and spending a run to be offered
    // a replacement for a figure they researched themselves is worse than
    // spending nothing: it invites them to overwrite their own work.
    const current = await loadAssumptions(ctx.env, ctx.projectId);
    const open = Object.keys(MARKET_FIELDS)
      .filter((f) => !String((current as unknown as Record<string, unknown>)[f] ?? '').trim());
    if (!open.length) {
      return {
        facts: '', empty: true,
        emptyReason: 'Every sizing input is already filled in. Clear one to have Eadwyn look for it.',
      };
    }
    if (!String(project.sector || '').trim()) {
      return {
        facts: '', empty: true,
        emptyReason: 'Set this venture’s sector first — without it there is no market to size.',
      };
    }
    return {
      facts: [
        `Venture: ${project.name}`,
        `Sector: ${project.sector}`,
        project.description ? `What it does: ${String(project.description).slice(0, 600)}` : '',
        current.geography ? `Geography: ${current.geography}` : '',
        current.targetYear ? `Target year: ${current.targetYear}` : '',
        '',
        `Fields still empty, and what each one is: ${open.map((f) => `${f} (${MARKET_FIELDS[f].asks})`).join('; ')}`,
      ].filter(Boolean).join('\n'),
      // NOT A MATCH-BACK SET. `known` is the restatement mechanism and this kind
      // is `sourced`; what it carries here is which fields may be proposed at
      // all, so `parse` can drop an item naming one that is already filled.
      known: open,
    };
  },

  async parse(text, gathered, ctx): Promise<Proposed[]> {
    const items = extractJsonArray(text);
    const open = new Set(gathered.known || []);
    const out: Proposed[] = [];
    const seen = new Set<string>();
    for (const raw of items.slice(0, MAX_PROMPT_ITEMS)) {
      if (!raw || typeof raw !== 'object') continue;
      const field = String((raw as any).field || '').trim();
      const value = String((raw as any).value ?? '').trim().slice(0, 200);
      const asked = String((raw as any).asked || '').trim().slice(0, 300);
      // A field this project has not left open, or one this store has no column
      // for, is a proposal with nowhere to go.
      if (!MARKET_FIELDS[field] || !open.has(field) || seen.has(field)) continue;
      if (!value) continue;
      seen.add(field);

      // THE CITATION IS FETCHED HERE AND THE PROPOSAL IS DROPPED WITHOUT ONE.
      // The question comes from the model's own `asked` when it gave one and from
      // the field's fixed description otherwise, so a model that skips the field
      // cannot skip the search.
      const query = asked || `${MARKET_FIELDS[field].asks} for ${gathered.facts.split('\n')[1] || 'this sector'}`;
      const { citation } = await citeFor(ctx.env, Number(ctx.user.id), query);
      if (!citation) continue;

      out.push({
        payload: { field, value, asked: query },
        targetRef: `market_assumption:${field}`,
        citation,
        readable: `${MARKET_FIELDS[field].label}: ${value}`,
      });
    }
    return out;
  },

  async apply(ctx, payload) {
    // `saveOneAssumption` — the same store, sanitiser and patch semantics the
    // drawer's own PUT goes through. A field name it does not know throws, which
    // the accept route turns into a revert rather than a silent no-op.
    const field = String(payload.field || '');
    const value = String(payload.value ?? '').trim();
    if (!MARKET_FIELDS[field]) throw new Error(`There is no sizing input called ${field}`);
    if (!value) throw new Error('That proposal no longer carries a figure');
    await saveOneAssumption(ctx.env, ctx.projectId, field, value, Number(ctx.user.id));
    const row = await ctx.env.DB.prepare(
      'SELECT id FROM project_market_assumptions WHERE project_id = ?',
    ).bind(ctx.projectId).first<{ id: number }>();
    return {
      written: `${MARKET_FIELDS[field].label}: ${value}`,
      // The assumptions row, and the column this fill wrote — which is what lets
      // the page mark THIS figure "Eadwyn · sourced" and leave the founder's own
      // figures beside it unlabelled.
      target: row
        ? { table: 'project_market_assumptions', rowId: Number(row.id), column: ASSUMPTION_COLUMNS[field] }
        : undefined,
      result: { kind: 'market_input', field, value },
    };
  },

  target(payload) {
    // The fallback, for a database that lost the row between the write and the
    // read above. Row 0 cannot exist, so an unaddressed provenance row reads as
    // unaddressed rather than pointing at somebody else's assumptions.
    return {
      table: 'project_market_assumptions',
      rowId: 0,
      column: ASSUMPTION_COLUMNS[String(payload.field || '')] || 'population',
    };
  },
};

/** Every kind, by its stable id. The one list a new surface is added to. */
export const FILL_KINDS: Record<string, FillKind> = {
  [painTag.kind]: painTag,
  [hypothesis.kind]: hypothesis,
  [marketSizing.kind]: marketSizing,
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
