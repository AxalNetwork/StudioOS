/**
 * D1504 (#3755, deck v2 A11) — catalogue drift: every model a run can be
 * routed to, and what would make one unroutable.
 *
 * A routed id is any model a run reaches without a person typing it:
 *   - a router task's model, its alternates and its fallback chain (`ROUTE`,
 *     which carries the module routes too);
 *   - a deck element's suggested models, the rest under All models, its chain
 *     and its fixed pipeline steps (`ELEMENT_ROUTES`, `choicesFor`, D1503).
 *
 * Each must be a `ga` or `partner` catalogue row with a price, and a deck
 * element's models must do the element's kind of work (write: chat; draw and
 * edit: draw; an upload's screen: vision or chat). `ai_model_terms_d1504`
 * fails CI on any problem, so a model Cloudflare retires or reprices is caught
 * before a whole-deck run meets it. The weekly drift job (B9) reads the same list.
 */
import { ROUTE } from '../aiRouter';
import { MODEL_CONNECTIONS } from './moduleConnections';
import { isPriced, modelById, type CatalogueModel } from './catalogue';
import { ELEMENT_ROUTES, choicesFor } from '../decks/elementModels';

export type Routed = { id: string; where: string[] };

/** Every routed id, with where each is routed from (a task, or `element:<id>`). */
export function routedModels(): Routed[] {
  const by = new Map<string, Set<string>>();
  const add = (id: unknown, where: string) => {
    if (typeof id !== 'string' || !id) return;
    if (!by.has(id)) by.set(id, new Set());
    by.get(id)!.add(where);
  };
  for (const [task, e] of Object.entries(ROUTE) as Array<[string, any]>) {
    add(e.model, task);
    for (const x of e.alternates ?? []) add(x, `${task}:alternate`);
    for (const x of e.fallbackChain ?? []) add(x, `${task}:chain`);
  }
  for (const [el, r] of Object.entries(ELEMENT_ROUTES)) {
    const c = choicesFor(el);
    for (const m of [...c.suggested, ...c.more]) add(m.id, `element:${el}`);
    for (const x of r.chain) add(x, `element:${el}:chain`);
    for (const p of r.pipeline) add(p.model, `element:${el}:${p.kind}`);
  }
  return [...by.entries()].map(([id, w]) => ({ id, where: [...w].sort() })).sort((a, b) => a.id.localeCompare(b.id));
}

const OPERATIONS_OF: Readonly<Record<string, readonly string[]>> = Object.freeze({
  write: ['chat'], draw: ['draw'], edit_image: ['draw'], screen: ['vision', 'chat'],
});

/**
 * What is wrong with the routed set against a catalogue, one sentence each; [] when nothing.
 * `lookup` is the catalogue's `modelById` unless a test passes another.
 */
export function driftProblems(lookup: (id: string) => CatalogueModel | null = modelById): string[] {
  const out: string[] = [];
  for (const { id, where } of routedModels()) {
    const m = lookup(id);
    if (!m) { out.push(`${id} (${where[0]}) is not in the catalogue`); continue; }
    if (m.status !== 'ga' && m.status !== 'partner') out.push(`${id} (${where[0]}) is ${m.status}, not ga or partner`);
    else if (!isPriced(m)) out.push(`${id} (${where[0]}) has no price`);
  }
  for (const [el, r] of Object.entries(ELEMENT_ROUTES)) {
    const c = choicesFor(el);
    const want = OPERATIONS_OF[r.kind];
    if (want) for (const m of [...c.suggested, ...c.more]) {
      const op = MODEL_CONNECTIONS[m.id]?.operation ?? 'none';
      if (!want.includes(op)) out.push(`${m.id} on ${el} does ${op}, not ${want.join(' or ')}`);
    }
    for (const p of r.pipeline) {
      const pw = OPERATIONS_OF[p.kind];
      const op = MODEL_CONNECTIONS[p.model]?.operation ?? 'none';
      if (pw && !pw.includes(op)) out.push(`${p.model} on ${el}'s ${p.kind} step does ${op}, not ${pw.join(' or ')}`);
    }
  }
  for (const [task, e] of Object.entries(ROUTE) as Array<[string, any]>) {
    const want = e.isEmbed ? 'embed' : e.isAudio ? 'transcribe' : null;
    if (!want) continue;
    for (const id of [e.model, ...(e.alternates ?? []), ...(e.fallbackChain ?? [])]) {
      const op = MODEL_CONNECTIONS[id]?.operation;
      if (op && op !== want) out.push(`${id} on ${task} does ${op}, not ${want}`);
    }
  }
  return out;
}
