/** #3626: executable module connections. The canvas keeps its defaults;
 * these are additional explicit choices, never extra automatic fallbacks.
 * Product copy and backend dispatch read the same capability assignments.
 */
import assignments from './moduleModels';
import { isOffered, modelById, type CatalogueSwitches } from './catalogue';
import { RAIL_KIND_JOBS, jobStep, selectorFor } from './modelUseCases';

export type ModuleOperation = 'chat' | 'vision' | 'decision' | 'image_labels' | 'embed' | 'rerank' | 'sentiment' | 'translate' | 'stream' | 'transcribe' | 'turn' | 'voice' | 'draw' | 'guard';
export type ModelConnection = { operation: ModuleOperation; kinds: string[]; purpose: string };
export const MODEL_CONNECTIONS = assignments as Record<string, ModelConnection>;
type Page = { pageKey: string; kind: string; models: Array<{ id: string; role: string; line: string }>; more?: Array<{ id: string; line: string }> };

/**
 * The pages that author images. D1478 Part A: the Pitch deck, Distribution,
 * Brand and Publications. #3935 (task 1) adds:
 * - Events (`· Events`, the event cover EV2 and EV3);
 * - Articles (`Content queue`, beside Publications: AR4);
 * - Learning (`Learning` and `Courses`, the course cover LE8; no rail page
 *   carries either word yet, so this matches nothing until one does);
 * - Grow campaigns (`Distribution`, already here, and `Revenue and traction`: GR6, GR7);
 * - Narrative (`Investor narrative`);
 * - Build (`Prototype / MVP` and `Solution design`, the mock-ups BU7).
 */
export const DRAW_PAGES = / · (Pitch deck|Investor narrative|Distribution|Revenue and traction|Brand|Publications|Content queue|Events|Learning|Courses|Prototype \/ MVP|Solution design)(?: · |$)/;

export function connectionOnPage(id: string, page: Pick<Page, 'pageKey' | 'kind'>): boolean {
  const c = MODEL_CONNECTIONS[id];
  if (!c) return false;
  if (c.operation === 'guard') return true;
  // Images belong to actual image-authoring modules, not every writing page.
  if (c.operation === 'draw') return DRAW_PAGES.test(page.pageKey);
  return c.kinds.includes(page.kind);
}

/**
 * Whether a model can do a rail kind's run, by its connection: a text kind
 * needs a chat model, a vision kind one that also reads images, speech one
 * that transcribes, and each of #3934's kinds its own operation.
 */
export function fitsRailKind(kind: string, id: string): boolean {
  const op = MODEL_CONNECTIONS[id]?.operation;
  switch (kind) {
    case 'speech': return op === 'transcribe';
    case 'vision': return chatCompatible(id, true);
    case 'draw': case 'edit_image': return op === 'draw';
    case 'decide': return op === 'decision';
    case 'sentiment': return op === 'sentiment' || op === 'decision';
    case 'translate': return op === 'translate';
    default: return op === 'chat';
  }
}

/**
 * The models a page row or an option shows. #3934: a rail kind's row reads
 * its job step in `modelUseCases.ts` (RAIL_KIND_JOBS): at most three
 * suggested (Default, Alternative, Deeper) and the rest of the step and its
 * kind under All models, each a model the row's run can do and a rail may
 * list. #3741's `{ models, more }` shape is unchanged.
 */
/** #3935: the draw job each image option runs; an image option not named here reads the deck's DK4. */
export const IMAGE_OPTION_JOBS: Readonly<Record<string, string>> = Object.freeze({ 'deck:image': 'DK4', 'draft:logo': 'GR3' });

export function withModuleModels<T extends Page>(row: T): T & { more: Array<{ id: string; line: string }> } {
  const models = row.models.filter(m => MODEL_CONNECTIONS[m.id]?.operation !== 'vision').map(m => ({ ...m }));
  const more = (row.more ?? []).map(({ id, line }) => ({ id, line }));
  // D1478 (#3721): a transcription option lists what transcribes; no chat model joins it.
  if ((row as { handler?: string }).handler === 'transcribe') return { ...row, models, more };
  // #3935: an image option reads its draw job (the deck's images DK4, the logo GR3), so only
  // draw models are listed under it: no reader and no chat model, and none Legal holds.
  if (row.kind === 'image') {
    const optionKey = (row as { optionKey?: string }).optionKey ?? '';
    const imageJob = jobStep(IMAGE_OPTION_JOBS[optionKey] ?? 'DK4', 0);
    if (imageJob) return { ...row, ...selectorFor(imageJob, (id) => MODEL_CONNECTIONS[id]?.operation === 'draw') };
  }
  const ref = RAIL_KIND_JOBS[row.kind];
  const job = ref ? jobStep(ref.id, ref.step) : null;
  if (job) return { ...row, ...selectorFor(job, (id) => fitsRailKind(row.kind, id)) };
  for (const [id, c] of Object.entries(MODEL_CONNECTIONS)) {
    if (c.operation !== 'chat' || !connectionOnPage(id, row) || [...models, ...more].some(m => m.id === id)) continue;
    more.push({ id, line: c.purpose });
  }
  return { ...row, models, more };
}

/** A specialist never goes to chat just because the catalogue says Text Generation. */
export function chatCompatible(id: string, vision: boolean): boolean {
  const c = MODEL_CONNECTIONS[id];
  if (!c || c.operation !== 'chat') return false;
  return !vision || modelById(id)?.capabilities.includes('Vision') === true;
}

export function moduleConnections(page: Page, env: CatalogueSwitches) {
  return Object.entries(MODEL_CONNECTIONS).filter(([id, c]) => {
    const m = modelById(id);
    return m && isOffered(m, env) && c.operation !== 'guard' && c.operation !== 'stream'
      && (connectionOnPage(id, page) || [...page.models, ...(page.more ?? [])].some(m => m.id === id));
  }).map(([id, c]) => ({ id, operation: c.operation, purpose: c.purpose }));
}

export const MODULE_OPERATIONS = ['chat', 'decision', 'image_labels', 'embed', 'rerank', 'sentiment', 'translate', 'transcribe', 'turn', 'voice', 'draw', 'vision'] as const;
export type ModuleTask = `module_${typeof MODULE_OPERATIONS[number]}`;
export const MODULE_ROUTES = Object.fromEntries(MODULE_OPERATIONS.map(operation => {
  const models = Object.keys(MODEL_CONNECTIONS).filter(id => MODEL_CONNECTIONS[id].operation === operation);
  // Other image readers stay available through their page's ordinary rail task.
  return [`module_${operation}`, {
    provider: 'workers-ai' as const, model: operation === 'chat' ? '@cf/meta/llama-3.3-70b-instruct-fp8-fast' : models[0], alternates: models,
    ...(operation === 'embed' ? { isEmbed: true } : {}),
    ...(operation === 'transcribe' ? { isAudio: true } : {}),
  }];
})) as Record<ModuleTask, { provider: 'workers-ai'; model: string; alternates: string[]; isEmbed?: boolean; isAudio?: boolean }>;
