#!/usr/bin/env node
/**
 * #3939 (D1478, task 5 of the model use-case plan, #3721 §6 PR 5) — the
 * model-coverage drift check. It fails the build when the job table that
 * decides which model each job runs (`services/ai/modelUseCases.ts`, task 0)
 * drifts from the catalogue, or when a page lists a model of the wrong kind:
 *
 *   uncovered        a current catalogue id is in no row of the model table;
 *   duplicated       a catalogue id is in two rows;
 *   no-default       a job (or one of its steps) has no Default;
 *   two-defaults     a job has two Defaults (two values, or the same job id twice);
 *   default-kind     a Default is not in its kind's model list;
 *   deprecated       a deprecated id appears in source outside `catalogue.ts`,
 *                    `aiCatalog.ts` and the router's price list of retired ids;
 *   reader-in-draw   a model that is not a text-to-image model sits under Draw;
 *   text-in-listen   a text model sits under Listen;
 *   group-no-job     a deck element group (`deckV2Model.js` `ELEMENT_GROUPS`)
 *                    names no job id, or one the table does not have.
 *
 * It sits beside `ai_model_coverage_d1478.test.ts` and AI_MODEL_COVERAGE.md,
 * not in their place: those keep the matrix's "Picks the run never reads" and
 * "Connected outside its fit" sections empty; this one checks the job table.
 *
 * `checkCoverage()` is pure (plain values in, findings out) so each rule has a
 * fixture test (`frontend/test/model_coverage_check_3939.test.mjs`). `load()`
 * reads the repository. Comments are stripped before the deprecated scan, so a
 * comment that names a retired id for history is not a use of it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     scripts/check-model-coverage.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Rail kinds that draw, and that listen. A Draw selector lists drawers only; a Listen selector, speech recognisers. */
export const DRAW_KINDS = Object.freeze(['draw', 'image', 'edit_image']);
export const LISTEN_KINDS = Object.freeze(['listen', 'speech']);
/** Catalogue kinds a Draw list may hold, and catalogue kinds a Listen list may never hold. */
export const DRAWER_KINDS = Object.freeze(['Text-to-Image']);
export const TEXT_KINDS = Object.freeze(['Text Generation', 'Summarization']);

/** Where a deprecated id may still be named: the catalogue, the cost-history catalogue, and the router's price list. */
export const DEPRECATED_HOMES = Object.freeze([
  'cloudflare-worker/src/services/ai/catalogue.ts',
  'cloudflare-worker/src/services/aiCatalog.ts',
]);
const ROUTER = 'cloudflare-worker/src/services/aiRouter.ts';
/** The router's list of priced ids, retired ones included for runs already recorded against them. */
const ROUTER_PRICE_LIST = /export const PRICE_USD_PER_1M_TOKENS[^=]*=\s*tokenPriceView\(\[[\s\S]*?\]\);/;

/** The trees the deprecated scan reads. Tests are left out: a test names a retired id to prove it is refused. */
export const SCAN_ROOTS = Object.freeze([
  'cloudflare-worker/src', 'cloudflare-worker/ai-workers', 'cloudflare-worker/scripts', 'frontend/src', 'meeting-bot/src', 'scripts',
]);
const SCAN_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json)$/;

/** Strip // and /* *\/ comments, keeping strings (a URL's `//` is not a comment). JSON has none. */
export function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c;
      for (i++; i < src.length && src[i] !== q; i++) { if (src[i] === '\\') out += src[i++]; out += src[i]; }
      out += q; continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; } i++; continue; }
    out += c;
  }
  return out;
}

/** Where `id` first appears whole, or -1: a retired id must not match a current id that starts with it (the 8B and its fp8 build). */
export function indexOfWhole(text, id) {
  for (let at = text.indexOf(id); at !== -1; at = text.indexOf(id, at + 1)) {
    if (!/[\w.-]/.test(text[at + id.length] ?? '')) return at;
  }
  return -1;
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const asList = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v.filter((x) => x != null && x !== '') : [v]);

/**
 * The findings, each `{ rule, detail }`.
 *
 * @param {object} input
 * @param {{ id: string, kind: string, status: string }[]} input.catalogue
 * @param {{ id: string }[]} input.models  the model table's rows: every current catalogue id, once
 * @param {{ id: string, kind?: string, default?: string|string[], steps?: { kind: string, default?: string|string[] }[] }[]} input.jobs
 * @param {Record<string, string[]>} input.kindModels  each kind's model list
 * @param {{ where: string, kind: string, models: string[] }[]} input.selectors  every selector a page lists (the rail matrix, and the kinds' lists)
 * @param {{ id: string, job?: string }[]} input.elementGroups
 * @param {{ path: string, text: string }[]} input.sources
 */
export function checkCoverage({ catalogue, models, jobs, kindModels, selectors = [], elementGroups = [], sources = [] }) {
  const findings = [];
  const add = (rule, detail) => findings.push({ rule, detail });
  const byId = new Map(catalogue.map((m) => [m.id, m]));
  const current = catalogue.filter((m) => m.status !== 'deprecated').map((m) => m.id);

  const seen = new Map();
  for (const row of models) seen.set(row.id, (seen.get(row.id) || 0) + 1);
  for (const id of current) if (!seen.has(id)) add('uncovered', `${id} is in the catalogue but in no row of the model table`);
  for (const [id, n] of seen) if (n > 1) add('duplicated', `${id} is in ${n} rows of the model table`);

  const jobIds = new Map();
  for (const job of jobs) jobIds.set(job.id, (jobIds.get(job.id) || 0) + 1);
  for (const [id, n] of jobIds) if (n > 1) add('two-defaults', `job ${id} is declared ${n} times, so it has ${n} Defaults`);
  for (const job of jobs) {
    const steps = job.steps?.length ? job.steps.map((s, i) => ({ ...s, label: `${job.id} step ${i + 1} (${s.kind})` })) : [{ ...job, label: `${job.id} (${job.kind})` }];
    for (const step of steps) {
      const defaults = asList(step.default);
      if (defaults.length === 0) { add('no-default', `${step.label} has no Default`); continue; }
      if (defaults.length > 1) { add('two-defaults', `${step.label} has ${defaults.length} Defaults: ${defaults.join(', ')}`); continue; }
      const list = kindModels[step.kind];
      if (!list) add('default-kind', `${step.label}: the kind ${step.kind} has no model list`);
      else if (!list.includes(defaults[0])) add('default-kind', `${step.label}: its Default ${defaults[0]} is not in the ${step.kind} list`);
    }
  }

  for (const s of selectors) {
    if (DRAW_KINDS.includes(s.kind)) {
      for (const id of s.models) {
        const kind = byId.get(id)?.kind;
        if (!DRAWER_KINDS.includes(kind)) add('reader-in-draw', `${s.where} lists ${id} (${kind || 'not in the catalogue'}) under Draw`);
      }
    }
    if (LISTEN_KINDS.includes(s.kind)) {
      for (const id of s.models) {
        const kind = byId.get(id)?.kind;
        if (TEXT_KINDS.includes(kind)) add('text-in-listen', `${s.where} lists the text model ${id} under Listen`);
      }
    }
  }

  for (const g of elementGroups) {
    if (!g.job) add('group-no-job', `deck element group ${g.id} names no job id`);
    else if (!jobIds.has(g.job)) add('group-no-job', `deck element group ${g.id} names job ${g.job}, which the job table does not have`);
  }

  const deprecated = catalogue.filter((m) => m.status === 'deprecated').map((m) => m.id);
  for (const { path, text } of sources) {
    if (DEPRECATED_HOMES.includes(path)) continue;
    let body = path.endsWith('.json') ? text : stripComments(text);
    if (path === ROUTER) body = body.replace(ROUTER_PRICE_LIST, (m) => m.replace(/[^\n]/g, ' '));
    for (const id of deprecated) {
      const at = indexOfWhole(body, id);
      if (at !== -1) add('deprecated', `${path}:${lineOf(body, at)} names the deprecated ${id}`);
    }
  }
  return findings;
}

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SCAN_EXT.test(name)) out.push(p);
  }
  return out;
}

/** The deck element groups, read from the module (it has no imports a script cannot load). */
async function elementGroupsOf() {
  const mod = await import(pathToFileURL(join(ROOT, 'frontend/src/pages/raise/pitch/deckV2Model.js')).href);
  return mod.ELEMENT_GROUPS.map((g) => ({ id: g.id, job: g.job }));
}

/** Everything `checkCoverage` reads, from the repository. Needs the TypeScript loader (see the header). */
export async function load() {
  const worker = (p) => pathToFileURL(join(ROOT, 'cloudflare-worker/src', p)).href;
  const { CATALOGUE } = await import(worker('services/ai/catalogue.ts'));
  const useCases = await import(worker('services/ai/modelUseCases.ts'));
  const matrix = JSON.parse(readFileSync(join(ROOT, 'cloudflare-worker/src/services/ai/railMatrix.json'), 'utf8'));
  const self = relative(ROOT, fileURLToPath(import.meta.url)).split(sep).join('/');
  const sources = SCAN_ROOTS.flatMap((r) => walk(join(ROOT, r), []))
    .map((p) => relative(ROOT, p).split(sep).join('/'))
    .filter((p) => p !== self && !p.startsWith('scripts/test/') && !/\.test\./.test(p))
    .map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }));
  const kindModels = useCases.KIND_MODELS;
  const selectors = [
    ...[...matrix.rows, ...matrix.options].map((s) => ({
      where: `railMatrix ${s.pageKey}${s.optionKey ? ` / ${s.optionKey}` : ''}`,
      kind: s.kind,
      models: [...s.models, ...(s.more || [])].map((m) => m.id),
    })),
    ...Object.entries(kindModels).map(([kind, models]) => ({ where: `modelUseCases ${kind}`, kind: kind.toLowerCase().replace(/\s+/g, '_'), models })),
  ];
  return {
    catalogue: CATALOGUE.map((m) => ({ id: m.id, kind: m.kind, status: m.status })),
    models: useCases.MODEL_USES.map((r) => ({ id: r.id })),
    jobs: useCases.JOBS,
    kindModels,
    selectors,
    elementGroups: await elementGroupsOf(),
    sources,
  };
}

async function main() {
  let input;
  try { input = await load(); } catch (e) {
    console.error(`✗ check-model-coverage: could not read the tables (${e?.code || e?.name || 'error'}: ${e?.message || ''}).`);
    return 1;
  }
  const findings = checkCoverage(input);
  if (!findings.length) {
    console.log(`✓ check-model-coverage: ${input.catalogue.length} catalogue ids, ${input.jobs.length} jobs, ${input.selectors.length} selectors and ${input.elementGroups.length} deck element groups agree.`);
    return 0;
  }
  console.error(`✗ check-model-coverage: ${findings.length} finding${findings.length === 1 ? '' : 's'}.`);
  for (const f of findings) console.error(`  [${f.rule}] ${f.detail}`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().then((code) => process.exit(code));
