/**
 * D1478 (#3721) — the Workers AI coverage matrix: every catalogue model against
 * every platform module, as a view generated from the registries that already
 * decide it. Nothing here is a second model list.
 *
 *   - which models exist, and which are offered: `CATALOGUE`, `isOffered` (D760);
 *   - what each model is for: `MODEL_CONNECTIONS` (#3626, D1369);
 *   - which models a page runs and lists: `railMatrix.json` (D764) and
 *     `moduleConnections` (#3626);
 *   - which models a fixed job runs: `ROUTE` (the router), reached from the
 *     call sites in `FIXED_JOBS`, each one cited by the file that calls it;
 *   - Record a Session's speech-to-text picker: `STT_MODELS` (D657).
 *
 * A cell is one of four states (`CellState`). `renderCoverage()` writes
 * `documentation/architecture/AI_MODEL_COVERAGE.md`, and
 * `test/ai_model_coverage_d1478.test.ts` fails when the committed file differs,
 * so a model, a page or a job that changes without a re-render is red.
 *
 * Pure: plain values in, plain values out, no binding and no D1. The owner's
 * switches are read as "every gate the owner can open is open" (partner models
 * on), and each row says which gate it waits on.
 */
import matrix from './railMatrix.json';
import { CATALOGUE, CATALOGUE_READ, PROVIDER_MODELS, isOffered, isPriced, partnerGated, type CatalogueModel } from './catalogue';
import { MODEL_CONNECTIONS, moduleConnections, type ModuleOperation } from './moduleConnections';
import { AI_MARKUP, billedMicro, type RunUnits } from './pricing';
import { ROUTE } from '../aiRouter';
import { DEFAULT_FINAL_MODEL, DEFAULT_LIVE_MODEL, STT_MODELS, isChoosable } from '../sttModels';

export type ModuleKey =
  | 'validate' | 'record' | 'build' | 'raise' | 'grow' | 'network' | 'research'
  | 'calendar' | 'articles' | 'email' | 'studio' | 'admin' | 'safety' | 'workspaces';

export interface CoverageModule { key: ModuleKey; label: string; source: string }

/** The 14 columns, in the order the matrix prints them. */
export const COVERAGE_MODULES: readonly CoverageModule[] = Object.freeze([
  { key: 'validate', label: 'Validate', source: 'Founder · Validate pages' },
  { key: 'record', label: 'Record a Session', source: '`STT_MODELS` and the session jobs' },
  { key: 'build', label: 'Build', source: 'Founder · Build pages' },
  { key: 'raise', label: 'Raise', source: 'Founder · Raise pages (Pitch deck, Investor narrative, Data room, Readiness)' },
  { key: 'grow', label: 'Grow', source: 'Founder · Grow pages (Distribution carries Brand)' },
  { key: 'network', label: 'Network', source: '`* · Network` pages and the search index' },
  { key: 'research', label: 'Research', source: '`* · Research` pages, the search index and `research_ask`' },
  { key: 'calendar', label: 'Calendar', source: 'none (`frontend/src/lib/railPages.js`, `off`)' },
  { key: 'articles', label: 'Articles', source: 'none on main (D1409, #3695)' },
  { key: 'email', label: 'Email', source: '`mail_draft`' },
  { key: 'studio', label: 'Studio / Eadwyn', source: '`* · Studio` and `* · Home` pages, Eadwyn\'s jobs' },
  { key: 'admin', label: 'Admin consoles', source: '`Admin · *` and `Super Admin · *` pages, the admin jobs' },
  { key: 'safety', label: 'Moderation and safety', source: '`safety`, the D763 guard' },
  { key: 'workspaces', label: 'Investor, Advisor and Partner workspaces', source: 'their remaining pages and jobs' },
]);

/** The one column a matrix page belongs to. Admin keys first, so `Admin · Home` is an admin page. */
export function moduleOfPage(pageKey: string): ModuleKey {
  if (/^(Super )?Admin · /.test(pageKey)) return 'admin';
  if (/ · Network(?: · |$)/.test(pageKey)) return 'network';
  if (/ · Research(?: · |$)/.test(pageKey)) return 'research';
  if (pageKey.startsWith('Founder · Validate')) return 'validate';
  if (pageKey.startsWith('Founder · Build')) return 'build';
  if (pageKey.startsWith('Founder · Raise')) return 'raise';
  if (pageKey.startsWith('Founder · Grow')) return 'grow';
  if (/ · (Studio|Home)$/.test(pageKey)) return 'studio';
  return 'workspaces';
}

/**
 * The jobs that run outside a rail, each cited by the file that calls its
 * router task. The test fails when that file no longer names the task, so a
 * moved or removed call is found, not silently mis-cited. Line numbers are not
 * kept: unrelated edits shift them, and a citation that goes red on every
 * edit above it would hold every other PR hostage (D1478).
 */
export interface FixedJob { module: ModuleKey; task: keyof typeof ROUTE; ref: string }
export const FIXED_JOBS: readonly FixedJob[] = Object.freeze([
  { module: 'validate', task: 'validate_tag_pains', ref: 'services/fills/registry.ts' },
  { module: 'validate', task: 'validate_draft_hypotheses', ref: 'services/fills/registry.ts' },
  { module: 'validate', task: 'market_sizing_inputs', ref: 'services/fills/registry.ts' },
  { module: 'validate', task: 'competitor_scan', ref: 'services/fills/registry.ts' },
  { module: 'validate', task: 'research_ask', ref: 'services/fills/citations.ts' },
  { module: 'validate', task: 'transcribe', ref: 'services/interviewProcessing.ts' },
  { module: 'record', task: 'transcribe', ref: 'routes/founder_validate.ts' },
  { module: 'record', task: 'detect_language', ref: 'services/sessionTranslation.ts' },
  { module: 'record', task: 'translate_segment', ref: 'services/sessionTranslation.ts' },
  { module: 'record', task: 'structure_interview', ref: 'services/interviewStructuring.ts' },
  { module: 'record', task: 'summarise_interview', ref: 'services/interviewStructuring.ts' },
  { module: 'record', task: 'extract_conversation_items', ref: 'services/conversationItems.ts' },
  { module: 'raise', task: 'deck_image', ref: 'routes/deck_images.ts' },
  { module: 'grow', task: 'grow_theme_feedback', ref: 'services/fills/registry.ts' },
  { module: 'grow', task: 'brand_autofill', ref: 'routes/brand.ts' },
  { module: 'grow', task: 'brand_logo', ref: 'routes/brand.ts' },
  { module: 'grow', task: 'brand_palette', ref: 'routes/brand.ts' },
  { module: 'grow', task: 'brand_taglines', ref: 'routes/brand.ts' },
  { module: 'network', task: 'embed', ref: 'services/vectorize.ts' },
  { module: 'research', task: 'embed', ref: 'services/vectorize.ts' },
  { module: 'research', task: 'research_ask', ref: 'routes/research.ts' },
  { module: 'research', task: 'workspace_explain', ref: 'routes/research.ts' },
  { module: 'research', task: 'paraphrase', ref: 'services/market_intel/extractors/index.ts' },
  { module: 'email', task: 'mail_draft', ref: 'services/mail/drafts.ts' },
  { module: 'studio', task: 'tool_call', ref: 'routes/advisor.ts' },
  { module: 'studio', task: 'advisor_explain', ref: 'routes/advisor.ts' },
  { module: 'studio', task: 'rerank', ref: 'services/advisor/rerank.ts' },
  { module: 'studio', task: 'transcribe', ref: 'routes/advisor.ts' },
  { module: 'studio', task: 'onboarding_chat', ref: 'routes/profiling.ts' },
  { module: 'studio', task: 'workspace_explain', ref: 'routes/ai.ts' },
  { module: 'admin', task: 'ops_summary', ref: 'routes/monitoring.ts' },
  { module: 'admin', task: 'image_screen', ref: 'routes/admin_x.ts' },
  { module: 'admin', task: 'image_alt_text', ref: 'routes/admin_x.ts' },
  { module: 'safety', task: 'safety', ref: 'services/aiRouter.ts' },
  { module: 'safety', task: 'safety', ref: 'services/advisor/guardrails.ts' },
  { module: 'workspaces', task: 'workspace_explain', ref: 'routes/deal_flow.ts' },
  { module: 'workspaces', task: 'dd_synthesis', ref: 'services/deckExtract.ts' },
  { module: 'workspaces', task: 'publication', ref: 'services/publications.ts' },
]);

/** Where Record a Session's picker is: its live and final model each a per-session choice. */
export const STT_REF = 'services/sttModels.ts (STT_MODELS)';

/**
 * Where each operation fits. A model that fits a module and is neither wired
 * nor offered there is a gap; one wired or offered outside its fit is listed
 * under "Connected outside its fit". Draw is kept off Validate, Record a
 * Session, Network, Research, Email and Calendar (the owner's own example: no
 * image generator in Record a Session); the test pins it. Draw fits Admin for
 * Super Admin · Content · Publications, as `connectionOnPage` already says.
 */
export const FITS: Readonly<Record<ModuleOperation, readonly ModuleKey[]>> = Object.freeze({
  chat: ['validate', 'record', 'build', 'raise', 'grow', 'network', 'research', 'articles', 'email', 'studio', 'admin', 'workspaces'],
  vision: ['build', 'raise', 'research', 'studio', 'admin', 'workspaces'],
  decision: ['validate', 'build', 'raise', 'grow', 'network', 'research', 'email', 'studio', 'admin', 'safety', 'workspaces'],
  image_labels: ['raise', 'research', 'admin', 'safety'],
  embed: ['validate', 'raise', 'grow', 'network', 'research', 'studio', 'admin', 'workspaces'],
  rerank: ['validate', 'raise', 'grow', 'network', 'research', 'studio', 'admin', 'workspaces'],
  sentiment: ['validate', 'record', 'grow', 'email', 'admin', 'workspaces'],
  translate: ['validate', 'record', 'grow', 'research', 'articles', 'email', 'studio', 'workspaces'],
  stream: ['validate', 'record', 'studio', 'workspaces'],
  transcribe: ['validate', 'record', 'raise', 'studio', 'workspaces'],
  turn: ['validate', 'record', 'studio', 'workspaces'],
  voice: ['validate', 'raise', 'grow', 'articles', 'studio', 'admin', 'workspaces'],
  draw: ['build', 'raise', 'grow', 'articles', 'admin', 'workspaces'],
  guard: ['safety'],
});

/** Why an operation does not fit a module: one line per operation. */
const NOT_HERE: Readonly<Record<ModuleOperation, string>> = Object.freeze({
  chat: 'no text job here (Calendar has no model; safety runs the guard)',
  vision: 'no image is read here',
  decision: 'no choice among fixed options is made here',
  image_labels: 'no image is tagged here',
  embed: 'no search or match index here',
  rerank: 'no ranked list here',
  sentiment: 'no feedback text to score here',
  translate: 'no text crosses languages here',
  stream: 'no live audio here',
  transcribe: 'no audio enters here',
  turn: 'no live conversation here',
  voice: 'nothing is read aloud here',
  draw: 'images belong to image-authoring modules only',
  guard: 'runs inside run() on every member run, never pickable',
});

/**
 * Options whose run is a fixed job, and the operation that job performs. A
 * listed model of another operation is a pick the run never reads: Part B of
 * #3721 makes these lists the run's own, and the section empties.
 */
export const OPTION_RUNS: Readonly<Record<string, { operation: ModuleOperation; run: string }>> = Object.freeze({
  'deck:image': { operation: 'draw', run: '`deck_image` (routes/deck_images.ts)' },
  'draft:logo': { operation: 'draw', run: '`brand_logo` (routes/brand.ts)' },
  'transcribe:voice-answer': { operation: 'transcribe', run: '`transcribe`' },
  'transcribe:interview': { operation: 'transcribe', run: '`transcribe`' },
  'transcribe:session': { operation: 'transcribe', run: '`transcribe`' },
  'transcribe:recording': { operation: 'transcribe', run: '`transcribe`' },
});

/** Each option row whose list holds models its run cannot use. */
export function optionMismatches(): Array<{ pageKey: string; optionKey: string; run: string; wants: ModuleOperation; listed: string[] }> {
  const out: Array<{ pageKey: string; optionKey: string; run: string; wants: ModuleOperation; listed: string[] }> = [];
  for (const o of OPTIONS) {
    const r = OPTION_RUNS[o.optionKey ?? ''];
    if (!r) continue;
    const listed = choicesOf(o).filter((id) => MODEL_CONNECTIONS[id]?.operation !== r.operation);
    if (listed.length) out.push({ pageKey: o.pageKey, optionKey: o.optionKey!, run: r.run, wants: r.operation, listed });
  }
  return out;
}

/** Every wired or offered cell outside its operation's fit. */
export function outsideFit(): Array<{ id: string; operation: ModuleOperation; module: ModuleKey; cell: Cell }> {
  const out: Array<{ id: string; operation: ModuleOperation; module: ModuleKey; cell: Cell }> = [];
  for (const m of CATALOGUE) {
    const op = MODEL_CONNECTIONS[m.id]?.operation;
    if (!op) continue;
    for (const { key } of COVERAGE_MODULES) {
      const cell = coverageCell(m.id, key);
      if ((cell.state === 'wired' || cell.state === 'offered') && !FITS[op].includes(key)) out.push({ id: m.id, operation: op, module: key, cell });
    }
  }
  return out;
}

/** Gaps: a fit with nothing connected. The plan on #3721 (tasks 1 to 4) carries each. */
export const GAP_ISSUE = '#3721';

export type CellState = 'wired' | 'offered' | 'gap' | 'n/a';
export interface Cell { state: CellState; refs: string[]; reason?: string }

export const SWITCHES_ALL_ON = Object.freeze({ AI_PARTNER_MODELS: 'on' });

/** Why a catalogue row is never offered, or null when it is. */
export function notOfferedReason(m: CatalogueModel): string | null {
  if (m.status === 'deprecated') return 'deprecated';
  if (m.status === 'beta' || m.status === 'not_found') return m.status === 'beta' ? 'beta' : 'not found';
  if (!isPriced(m)) return 'unpriced';
  return isOffered(m, SWITCHES_ALL_ON) ? null : 'partner gate';
}

/** #3745: `models` are the (at most 3) suggested cards; `more` are the rest, pickable under All models. */
type RowLike = { pageKey: string; kind: string; models: Array<{ id: string; role: string }>; more?: Array<{ id: string }>; optionKey?: string };
const choicesOf = (r: RowLike): string[] => [...r.models, ...(r.more ?? [])].map((m) => m.id);
const ROWS = matrix.rows as RowLike[];
const OPTIONS = matrix.options as RowLike[];

function routeModels(task: keyof typeof ROUTE): { primary: string[]; picks: string[] } {
  const r = ROUTE[task] as { model: string; fallbackChain?: string[]; alternates?: string[] };
  const primary = [r.model, ...(r.fallbackChain ?? [])];
  return { primary, picks: (r.alternates ?? []).filter((id) => !primary.includes(id)) };
}

/** Every cell, computed once: model id → module → cell. */
function buildCells(): Map<string, Map<ModuleKey, Cell>> {
  const wired = new Map<string, Map<ModuleKey, Set<string>>>();
  const offered = new Map<string, Map<ModuleKey, Set<string>>>();
  const note = (into: typeof wired, id: string, mod: ModuleKey, ref: string) => {
    const byMod = into.get(id) ?? new Map<ModuleKey, Set<string>>();
    const refs = byMod.get(mod) ?? new Set<string>();
    refs.add(ref);
    byMod.set(mod, refs);
    into.set(id, byMod);
  };
  for (const row of ROWS) {
    const mod = moduleOfPage(row.pageKey);
    const ref = `railMatrix.json "${row.pageKey}"`;
    choicesOf(row).forEach((id, i) => note(i === 0 ? wired : offered, id, mod, ref));
    for (const c of moduleConnections(row as never, SWITCHES_ALL_ON)) note(offered, c.id, mod, `/api/ai/modules on "${row.pageKey}"`);
  }
  for (const opt of OPTIONS) {
    const mod = moduleOfPage(opt.pageKey);
    for (const id of choicesOf(opt)) note(offered, id, mod, `railMatrix.json option ${opt.optionKey}`);
  }
  for (const job of FIXED_JOBS) {
    const { primary, picks } = routeModels(job.task);
    for (const id of primary) note(wired, id, job.module, `${job.ref} (${String(job.task)})`);
    for (const id of picks) note(offered, id, job.module, `${job.ref} (${String(job.task)})`);
  }
  for (const s of STT_MODELS) {
    if (!isChoosable(s.model, s.kind)) continue;
    const isDefault = s.model === (s.kind === 'live' ? DEFAULT_LIVE_MODEL : DEFAULT_FINAL_MODEL);
    note(isDefault ? wired : offered, s.model, 'record', `${STT_REF}, ${s.kind}`);
  }

  const cells = new Map<string, Map<ModuleKey, Cell>>();
  for (const m of CATALOGUE) {
    const byMod = new Map<ModuleKey, Cell>();
    const why = notOfferedReason(m);
    const op = MODEL_CONNECTIONS[m.id]?.operation;
    for (const { key } of COVERAGE_MODULES) {
      if (why) { byMod.set(key, { state: 'n/a', refs: [], reason: why }); continue; }
      const w = wired.get(m.id)?.get(key);
      const o = offered.get(m.id)?.get(key);
      if (w?.size) byMod.set(key, { state: 'wired', refs: [...w].sort() });
      else if (o?.size) byMod.set(key, { state: 'offered', refs: [...o].sort() });
      else if (op && FITS[op].includes(key)) byMod.set(key, { state: 'gap', refs: [GAP_ISSUE] });
      else byMod.set(key, { state: 'n/a', refs: [], reason: op ? `${op}: ${NOT_HERE[op]}` : 'no module connection' });
    }
    cells.set(m.id, byMod);
  }
  return cells;
}

let CELLS: Map<string, Map<ModuleKey, Cell>> | null = null;
const cellsOnce = () => (CELLS ??= buildCells());

/** One cell. Unknown models and modules are `n/a`. */
export function coverageCell(modelId: string, module: ModuleKey): Cell {
  return cellsOnce().get(modelId)?.get(module) ?? { state: 'n/a', refs: [], reason: 'not in the catalogue' };
}

// ─────────────────────────────────────────────────────── pitch deck v2 (#3716)

export interface DeckRole { role: string; model: string; units: RunUnits; unitsLine: string; why: string }

/** The models #3716's deck agents should use, each priced per run at the stated units. */
export const DECK_V2_ROLES: readonly DeckRole[] = Object.freeze([
  { role: 'Writing', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', units: { tokens_in: 2000, tokens_out: 500 }, unitsLine: '2,000 in, 500 out',
    why: 'Today\'s deck writer (`rail_write` default). Alternates: Mistral Small 3.1 24B, GLM-4.7 Flash.' },
  { role: 'Images and illustrations', model: '@cf/black-forest-labs/flux-1-schnell', units: { tiles: 4, steps: 4 }, unitsLine: 'one 1024×1024 image: 4 tiles, 4 steps',
    why: 'Today\'s `deck_image`. Partner alternatives wait on owner question A: FLUX.2 Klein 4B, FLUX.2 Dev, Lucid Origin, Phoenix 1.0.' },
  { role: 'Vision (read a slide or upload)', model: '@cf/google/gemma-4-26b-a4b-it', units: { tokens_in: 2000, tokens_out: 500 }, unitsLine: '2,000 in, 500 out',
    why: '`rail_vision` default. Fallback: Llama 4 Scout.' },
  { role: 'Design check', model: '@cf/openai/gpt-oss-120b', units: { tokens_in: 2000, tokens_out: 500 }, unitsLine: '2,000 in, 500 out',
    why: 'Code first (#3716); this model only as a separate quoted press (`rail_reason`).' },
  { role: 'Embeddings', model: '@cf/baai/bge-base-en-v1.5', units: { tokens_in: 2000 }, unitsLine: '2,000 in',
    why: 'The only model that may write `axal-search`. v2 needs none unless a "similar slide" search is added.' },
  { role: 'Safety', model: '@cf/meta/llama-guard-3-8b', units: { tokens_in: 2000, tokens_out: 20 }, unitsLine: '2,000 in, 20 out',
    why: 'On every run, never pickable.' },
]);

/** A micro-USD amount as dollars, six places. */
const usd = (micro: number): string => `$${(micro / 1_000_000).toFixed(6)}`;

// ─────────────────────────────────────────────────────────────── the file

const SYMBOL: Readonly<Record<CellState, string>> = Object.freeze({ wired: 'W', offered: 'O', gap: 'G', 'n/a': '·' });

function priceLine(m: CatalogueModel): string {
  const p = Object.entries(m.prices);
  return p.length ? p.map(([u, v]) => `${u} ${v}`).join(', ') : 'Not recorded';
}

function plan(m: CatalogueModel): string {
  return [m.paid_only ? 'paid' : 'all', partnerGated(m) ? 'partner gate' : ''].filter(Boolean).join(', ');
}

/** A table cell: backslashes first, then pipes, so no cell can end its own column. */
export const mdCell = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

/** The committed Markdown, exactly. */
export function renderCoverage(): string {
  const cells = cellsOnce();
  const out: string[] = [];
  out.push('# Workers AI model coverage');
  out.push('');
  out.push('Generated by `cloudflare-worker/src/services/ai/coverage.ts` (D1478, #3721). Do not edit by hand:');
  out.push('`cloudflare-worker/test/ai_model_coverage_d1478.test.ts` fails when this file differs from');
  out.push('`renderCoverage()`. Re-render with `node cloudflare-worker/scripts/render-ai-coverage.mjs`.');
  out.push('');
  out.push(`Catalogue read on ${CATALOGUE_READ.read_on}; the pricing page it read was updated on ${CATALOGUE_READ.pricing_page_updated}.`);
  out.push(`${CATALOGUE.length} catalogue rows, ${CATALOGUE.filter((m) => isOffered(m, SWITCHES_ALL_ON)).length} offered with the partner gate open.`);
  out.push('Prices are Cloudflare\'s printed USD per unit (per 1M tokens, per 1k characters, per audio minute, per tile or step), at cost.');
  out.push('');
  out.push('## Legend');
  out.push('');
  out.push('- **W, wired**: a job runs it in that module by default: a page\'s default model, a fixed job\'s model or fallback, or Record a Session\'s default.');
  out.push('- **O, offered**: a member can pick it there (a page\'s other models, a rail option, `/api/ai/modules`, a session picker), but no job runs it by default.');
  out.push(`- **G, gap**: it fits that module and nothing connects it. Each gap is carried by the plan on ${GAP_ISSUE}.`);
  out.push('- **·, n/a**: it does not fit, or the model is not offered. "Why n/a" below gives the reason.');
  out.push('');
  out.push('## Modules');
  out.push('');
  out.push('| # | Module | Source |');
  out.push('| --- | --- | --- |');
  COVERAGE_MODULES.forEach((c, i) => out.push(`| ${i + 1} | ${c.label} | ${c.source} |`));
  out.push('');
  out.push('## The matrix');
  out.push('');
  out.push(`| Model | Task | Status | Price | Context | Plan | ${COVERAGE_MODULES.map((_, i) => String(i + 1)).join(' | ')} |`);
  out.push(`| --- | --- | --- | --- | --- | --- | ${COVERAGE_MODULES.map(() => '---').join(' | ')} |`);
  for (const m of CATALOGUE) {
    const row = COVERAGE_MODULES.map(({ key }) => SYMBOL[cells.get(m.id)!.get(key)!.state]);
    out.push(`| \`${m.id}\` | ${m.kind} | ${m.status} | ${mdCell(priceLine(m))} | ${m.context_window ?? 'Not recorded'} | ${plan(m)} | ${row.join(' | ')} |`);
  }
  out.push('');
  out.push('## Where each offered model is wired and offered');
  out.push('');
  for (const m of CATALOGUE) {
    if (notOfferedReason(m)) continue;
    const op = MODEL_CONNECTIONS[m.id];
    out.push(`### \`${m.id}\``);
    out.push('');
    out.push(`${op ? `${op.operation}: ${op.purpose}.` : 'No module connection.'}`);
    out.push('');
    for (const { key, label } of COVERAGE_MODULES) {
      const c = cells.get(m.id)!.get(key)!;
      if (c.state === 'n/a') continue;
      const shown = c.refs.slice(0, 4).map((r) => `\`${r}\``).join('; ');
      const more = c.refs.length > 4 ? `; and ${c.refs.length - 4} more` : '';
      out.push(`- ${label}: **${c.state}**, ${shown}${more}`);
    }
    out.push('');
  }
  out.push('## Picks the run never reads');
  out.push('');
  const mism = optionMismatches();
  if (!mism.length) out.push('None: every option lists only models its run uses.');
  else {
    out.push('These options list models their run does not use, so a pick of one changes nothing. Part B of #3721 fixes them.');
    out.push('');
    out.push('| Page | Option | The run | Needs | Listed, not usable |');
    out.push('| --- | --- | --- | --- | --- |');
    for (const x of mism) out.push(`| ${x.pageKey} | \`${x.optionKey}\` | ${x.run} | ${x.wants} | ${x.listed.map((id) => `\`${id}\``).join(', ')} |`);
  }
  out.push('');
  out.push('## Connected outside its fit');
  out.push('');
  const outside = outsideFit();
  if (!outside.length) out.push('None.');
  else {
    out.push('| Model | Operation | Module | State | Where |');
    out.push('| --- | --- | --- | --- | --- |');
    for (const x of outside) {
      const label = COVERAGE_MODULES.find((c) => c.key === x.module)!.label;
      out.push(`| \`${x.id}\` | ${x.operation} | ${label} | ${x.cell.state} | ${x.cell.refs.map((r) => `\`${r}\``).join('; ')} |`);
    }
  }
  out.push('');
  out.push('## Why n/a');
  out.push('');
  out.push('A model that is not offered is n/a in every module:');
  out.push('');
  for (const why of ['beta', 'deprecated', 'unpriced', 'partner gate', 'not found']) {
    const ids = CATALOGUE.filter((m) => notOfferedReason(m) === why).map((m) => `\`${m.id}\``);
    if (ids.length) out.push(`- **${why}** (${ids.length}): ${ids.join(', ')}`);
  }
  out.push('');
  out.push('An offered model is n/a where its operation does not fit:');
  out.push('');
  out.push('| Operation | Fits | Elsewhere |');
  out.push('| --- | --- | --- |');
  for (const [op, fits] of Object.entries(FITS) as Array<[ModuleOperation, readonly ModuleKey[]]>) {
    const labels = fits.map((k) => COVERAGE_MODULES.find((c) => c.key === k)!.label).join(', ');
    out.push(`| ${op} | ${labels} | ${NOT_HERE[op]} |`);
  }
  out.push('');
  out.push('## Provider models (D851)');
  out.push('');
  out.push('Served by a provider\'s own API, not Workers AI, and off unless the provider\'s switch is exactly `on`.');
  out.push('');
  out.push('| Model | Provider | Rates (USD per 1M) | Read |');
  out.push('| --- | --- | --- | --- |');
  for (const p of PROVIDER_MODELS) {
    out.push(`| \`${p.id}\` | ${p.provider} | ${Object.entries(p.rates).map(([u, v]) => `${u} ${v}`).join(', ')} | ${p.read} |`);
  }
  out.push('');
  out.push('## Pitch deck v2 (#3716)');
  out.push('');
  out.push(`Price per run is \`billedMicro\` at \`AI_MARKUP\` ${AI_MARKUP}, for the units stated, rounded up once.`);
  out.push('');
  out.push('| Role | Model | Units per run | Price per run | Why |');
  out.push('| --- | --- | --- | --- | --- |');
  for (const r of DECK_V2_ROLES) {
    out.push(`| ${r.role} | \`${r.model}\` | ${r.unitsLine} | ${usd(billedMicro(r.model, r.units, AI_MARKUP))} | ${r.why} |`);
  }
  out.push('');
  return out.join('\n');
}
