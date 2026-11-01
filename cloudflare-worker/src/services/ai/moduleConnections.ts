/** #3626: executable module connections. The canvas keeps its defaults;
 * these are additional explicit choices, never extra automatic fallbacks.
 * Product copy and backend dispatch read the same capability assignments.
 */
import assignments from './moduleModels';
import { isOffered, modelById, type CatalogueSwitches } from './catalogue';
import { HIDDEN_MODELS, PAGE_JOBS, RAIL_KIND_USE, USE_CASE_KINDS, jobById, jobForOption, kindList, moreFor } from './modelUseCases';

export type ModuleOperation = 'chat' | 'vision' | 'decision' | 'image_labels' | 'embed' | 'rerank' | 'sentiment' | 'translate' | 'stream' | 'transcribe' | 'turn' | 'voice' | 'draw' | 'guard';
export type ModelConnection = { operation: ModuleOperation; kinds: string[]; purpose: string };
export const MODEL_CONNECTIONS = assignments as Record<string, ModelConnection>;
type Page = { pageKey: string; kind: string; models: Array<{ id: string; role: string; line: string }>; more?: Array<{ id: string; line: string }> };

export function connectionOnPage(id: string, page: Pick<Page, 'pageKey' | 'kind'>): boolean {
  const c = MODEL_CONNECTIONS[id];
  if (!c) return false;
  if (c.operation === 'guard') return true;
  // Images belong to actual image-authoring modules, not every writing page.
  if (c.operation === 'draw') return / · (Pitch deck|Distribution|Brand|Publications)(?: · |$)/.test(page.pageKey);
  if (c.kinds.includes(page.kind)) return true;
  // D1478 (#3934): a model a job on this page lists for one of its steps is on the page
  // (phonellm is a Voice turn model, so it is on Studio, whose voice mode takes a turn).
  return (PAGE_JOBS[page.pageKey] ?? []).some((j) => jobById(j)?.steps.some((s) => !s.fixed && kindList(s.kind).includes(id)));
}

/**
 * #3741: connected models are explicit choices under All models, never extra
 * cards. D1478 (#3934): All models is the job table's list for the row's kind
 * (`modelUseCases.ts`): an option reads its job's step, a page row its rail
 * kind. The row's `models` (its automatic chain) stay as the canvas wrote
 * them, less the two hidden models, so no press runs a different model.
 */
export function withModuleModels<T extends Page>(row: T): T & { more: Array<{ id: string; line: string }> } {
  const models = row.models.filter(m => MODEL_CONNECTIONS[m.id]?.operation !== 'vision' && !HIDDEN_MODELS.includes(m.id)).map(m => ({ ...m }));
  const optionKey = (row as { optionKey?: string }).optionKey;
  const job = optionKey ? jobForOption(row.pageKey, optionKey) : null;
  const kind = job?.steps.find((s) => !s.fixed)?.kind ?? RAIL_KIND_USE[row.kind];
  if (!kind) return { ...row, models, more: [] };
  const line = (id: string) => (row.more ?? []).find((m) => m.id === id)?.line ?? MODEL_CONNECTIONS[id]?.purpose ?? USE_CASE_KINDS[kind].label;
  // A pick is only worth listing when the row's run reads it: `resolveRailChain` runs chat
  // models, an image option draws, and what the canvas already listed stays.
  const runs: ModuleOperation = row.kind === 'image' ? 'draw' : 'chat';
  const canvas = new Set((row.more ?? []).map((m) => m.id));
  const more = moreFor(job, kind, models.map((m) => m.id))
    .filter((id) => canvas.has(id) || MODEL_CONNECTIONS[id]?.operation === runs)
    .map((id) => ({ id, line: line(id) }));
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
    return m && isOffered(m, env) && !HIDDEN_MODELS.includes(id) && c.operation !== 'guard' && c.operation !== 'stream'
      && (connectionOnPage(id, page) || [...page.models, ...(page.more ?? [])].some(m => m.id === id));
  }).map(([id, c]) => ({ id, operation: c.operation, purpose: c.purpose }));
}

export const MODULE_OPERATIONS = ['chat', 'decision', 'image_labels', 'embed', 'rerank', 'sentiment', 'translate', 'transcribe', 'turn', 'voice', 'draw', 'vision'] as const;
export type ModuleTask = `module_${typeof MODULE_OPERATIONS[number]}`;
export const MODULE_ROUTES = Object.fromEntries(MODULE_OPERATIONS.map(operation => {
  const models = Object.keys(MODEL_CONNECTIONS).filter(id => MODEL_CONNECTIONS[id].operation === operation && !HIDDEN_MODELS.includes(id));
  // Other image readers stay available through their page's ordinary rail task.
  return [`module_${operation}`, {
    provider: 'workers-ai' as const, model: operation === 'chat' ? '@cf/meta/llama-3.3-70b-instruct-fp8-fast' : models[0], alternates: models,
    ...(operation === 'embed' ? { isEmbed: true } : {}),
    ...(operation === 'transcribe' ? { isAudio: true } : {}),
  }];
})) as Record<ModuleTask, { provider: 'workers-ai'; model: string; alternates: string[]; isEmbed?: boolean; isAudio?: boolean }>;
