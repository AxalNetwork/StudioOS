/** #3626: executable module connections. The canvas keeps its defaults;
 * these are additional explicit choices, never extra automatic fallbacks.
 * Product copy and backend dispatch read the same capability assignments.
 */
import assignments from './moduleModels';
import { isOffered, modelById, type CatalogueSwitches } from './catalogue';

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
  return c.kinds.includes(page.kind);
}

/** #3741: connected models are explicit choices under All models, never extra cards. */
export function withModuleModels<T extends Page>(row: T): T & { more: Array<{ id: string; line: string }> } {
  const models = row.models.filter(m => MODEL_CONNECTIONS[m.id]?.operation !== 'vision').map(m => ({ ...m }));
  const more = (row.more ?? []).map(({ id, line }) => ({ id, line }));
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
