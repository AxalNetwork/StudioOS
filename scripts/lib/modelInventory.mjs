/**
 * D8519 (#8519) — the model inventory: every model id the Worker can call, the
 * surfaces that name it, and whether a price entry holds it.
 *
 * Model ids are spread across the Worker: Workers AI ids in `services/ai/` and
 * `services/aiRouter.ts`, outside providers' ids in the provider tables of
 * `services/ai/catalogue.ts`, the agent accounts' models in `wrangler.toml`
 * vars, a direct Anthropic route with its own price table. No one list said
 * which models production can call or which of them has a price. This file
 * reads the repository as text (no import of Worker code, no network, no model
 * call: whether a model still exists at its provider is #8508's live layer) and
 * builds that list; `scripts/build-model-inventory.mjs` writes it and checks it.
 *
 * WHAT COUNTS
 *   called   a string literal equal to the id in a Worker source file (comments
 *            stripped; the catalogue and cost-history files, which list every
 *            model there is, and the job table's `notOffered` block, which
 *            lists models the Worker refuses, do not count), or a `*MODEL`
 *            var of `wrangler.toml`, or (for an id in a provider table) any
 *            file that reads the table through its accessor.
 *   priced   a Workers AI catalogue row with a price, a row of a provider
 *            table with its rate, or a key of a route's own price table.
 *
 * TWO FAILURES (each can be allowlisted, with its reason, in `ALLOWLIST`):
 *   unpriced  the code can call an id and nothing prices it;
 *   stale     a price entry for an id no code calls.
 * An allowlist entry that no longer matches a gap is a failure too, so the list
 * cannot outlive the gap it explains.
 *
 * The extraction is deliberately plain: regular expressions over the files'
 * own layout, so a reviewer can follow every rule. When the layout changes and
 * a rule stops matching, the usual result is a loud "unpriced" or "stale"
 * finding, not a silent pass.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../check-model-coverage.mjs';

export const INVENTORY_REL = 'documentation/architecture/MODEL_INVENTORY.json';

const SRC = 'cloudflare-worker/src';
const CATALOGUE_REL = `${SRC}/services/ai/catalogue.ts`;
/** Files that list models rather than call them: Cloudflare's catalogue and the cost-history names. */
const LISTING_FILES = new Set([CATALOGUE_REL, `${SRC}/services/aiCatalog.ts`]);

/**
 * A mention in a table of models the Worker REFUSES is not a call. The job
 * table's `notOffered` block names each model it hides, with the reason.
 */
const NOT_CALLS = Object.freeze([
  { file: `${SRC}/services/ai/modelUseCases.ts`, start: /notOffered:\s*Object\.freeze\(\{/, end: /\n\s*\}\)/ },
]);

/**
 * The provider tables of the catalogue: where an id is priced by its row, the
 * `rate` that makes a row priced, and the names a caller reads the table by.
 */
const PROVIDER_TABLES = Object.freeze([
  { name: 'PROVIDER_MODELS', rate: /rates:\s*Object\.freeze\(\{[^}]*tokens_in:\s*'\d/, accessors: ['providerModelById', 'PROVIDER_MODELS'] },
  { name: 'GATEWAY_IMAGE_MODELS', rate: /usdPerImage:\s*'\d/, accessors: ['gatewayImageModelFor', 'GATEWAY_IMAGE_MODELS'] },
  { name: 'GATEWAY_TEXT_MODELS', rate: /rates:\s*Object\.freeze\(\{[^}]*tokens_in:\s*'\d/, accessors: ['gatewayTextModelById', 'GATEWAY_TEXT_MODELS'] },
]);

/** A route's own price table, keyed by `[CONST]` names or literals. */
const LOCAL_PRICE_TABLES = Object.freeze([
  { file: `${SRC}/routes/assistant.ts`, name: 'PRICING' },
]);

/** A string literal that is exactly a model id; the shape of each provider's ids. */
const ID_LITERAL = /(['"`])((?:@cf|@hf)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+|(?:anthropic|openai|bria|pruna)\/[A-Za-z0-9._-]+|claude-[a-z]+-[0-9][A-Za-z0-9.-]*|gpt-[0-9][A-Za-z0-9.-]*)\1/g;

export const providerOf = (id) => (/^@(?:cf|hf)\//.test(id) ? 'workers-ai' : id.split('/')[0].replace(/^claude-.*/, 'anthropic').replace(/^gpt-.*/, 'openai'));

/**
 * Gaps the owner has reviewed. `rule` is `unpriced` or `stale`; `reason` says
 * why the gap is not a defect. Keep it short: a gap that is a defect is fixed.
 */
/**
 * A priced catalogue row whose status is `deprecated` is kept priced on purpose,
 * so a run already recorded against the retired model keeps its cost
 * (catalogue.ts header: "every other row stays in the file"). It is never
 * stale, by rule rather than by id: `check-model-coverage` forbids naming a
 * deprecated id anywhere under `scripts/`.
 */
export const DEPRECATED_HISTORY_RULE = 'deprecated';

export const ALLOWLIST = Object.freeze([
  { id: '@cf/cloudflare/clairic', rule: 'stale', reason: 'A priced beta preview the job table lists under `notOffered` ("B (c) never offers beta"): the row is Cloudflare\'s price, the Worker refuses the run.' },
  { id: '@cf/google/embeddinggemma-300m', rule: 'unpriced', reason: 'Named in shapes.ts only to say what shape its call takes. The catalogue has no price for it, so refusalFor() answers model_unpriced and no run reaches it; the job table lists it under `notOffered` ("ga, no price").' },
  { id: '@cf/openai/whisper-tiny-en', rule: 'unpriced', reason: 'Named in sttFormats.ts for its audio format. A beta row with no price: refusalFor() answers model_not_offered, so no run reaches it; the job table lists it under `notOffered` ("beta, no price").' },
  { id: 'openai/gpt-5.3-codex', rule: 'unpriced', reason: 'OPENAI_MODEL in wrangler.toml. No catalogue row prices it; agentAccounts.slotModel() calls it only once the owner sets the AGENT_OPENAI_RATES variable, whose value is not in the repository, and skips the slot otherwise (D7073-p2). OWNER: confirm the rates are set in production or take the model out of wrangler.toml.' },
]);

// ───────────────────────────────────────────────────────────── reading the repository

const readOrNull = (path) => {
  try { return readFileSync(path, 'utf8'); } catch (e) { if (e && e.code === 'ENOENT') return null; throw e; }
};

function walk(root, rel, out) {
  for (const name of readdirSync(join(root, rel)).sort()) {
    const child = `${rel}/${name}`;
    if (statSync(join(root, child)).isDirectory()) walk(root, child, out);
    else if (/\.(ts|json)$/.test(name) && !/\.generated\.|\/_registry\.ts$/.test(child)) out.push(child);
  }
  return out;
}

/**
 * The inputs, as text: every Worker source file (`rel`, `text`), the catalogue
 * and `wrangler.toml`. `reversed` reverses the listing before it is sorted,
 * the determinism check's way of proving the output does not depend on it.
 */
export function readSources(root, { reversed = false } = {}) {
  const listed = walk(root, SRC, []);
  const files = (reversed ? listed.reverse() : listed).sort().map((rel) => ({ rel, text: readFileSync(join(root, rel), 'utf8') }));
  return { files, wrangler: readOrNull(join(root, 'wrangler.toml')) ?? '' };
}

/** Source with comments removed (JSON has none) and the refusal tables blanked. */
function callableText({ rel, text }) {
  let t = rel.endsWith('.json') ? text : stripComments(text);
  for (const n of NOT_CALLS) {
    if (n.file !== rel) continue;
    const s = n.start.exec(t);
    if (!s) continue;
    const rest = t.slice(s.index + s[0].length);
    const e = n.end.exec(rest);
    t = t.slice(0, s.index) + (e ? rest.slice(e.index + e[0].length) : '');
  }
  return t;
}

/** Workers AI catalogue rows: `{ id, status, priced }`, from the one-line rows of `CATALOGUE`. */
export function catalogueRows(catalogueText) {
  const rows = [];
  for (const line of catalogueText.split('\n')) {
    const m = /^\s*\{ id: '([^']+)'.*?status: '(\w+)'.*?prices: \{([^}]*)\}/.exec(line);
    if (m) rows.push({ id: m[1], status: m[2], priced: m[3].trim() !== '' });
  }
  return rows;
}

/** The rows of one provider table: `{ id, priced }`. A row runs from its `id:` to the next. */
export function providerRows(catalogueText, table) {
  const start = catalogueText.indexOf(`export const ${table.name}`);
  if (start < 0) return [];
  const end = catalogueText.indexOf('\n]);', start);
  const body = catalogueText.slice(start, end < 0 ? undefined : end);
  const parts = body.split(/\n\s+id:\s*'/).slice(1);
  return parts.map((p) => ({ id: p.slice(0, p.indexOf("'")), priced: table.rate.test(p) }));
}

/** A route's own price table: the ids its keys name, resolving `[CONST]` keys through `const CONST = 'id'`. */
export function localPriceIds(text, name) {
  const t = stripComments(text);
  const m = new RegExp(`const ${name}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};?`).exec(t);
  if (!m) return [];
  const ids = [];
  for (const k of m[1].matchAll(/^\s*(?:\[(\w+)\]|'([^']+)'|"([^"]+)")\s*:/gm)) {
    if (k[1]) {
      const c = new RegExp(`const ${k[1]}\\s*=\\s*'([^']+)'`).exec(t);
      if (c) ids.push(c[1]);
    } else ids.push(k[2] ?? k[3]);
  }
  return ids;
}

/** `*MODEL*` vars of `wrangler.toml`, any environment: `[{ key, id }]`. `OPENAI_MODEL` is `openai/<id>` where the code reads it. */
export function wranglerModels(wrangler) {
  const out = [];
  for (const m of wrangler.matchAll(/^([A-Z][A-Z0-9_]*MODEL[A-Z0-9_]*)\s*=\s*"([^"]+)"/gm)) {
    const id = m[1] === 'OPENAI_MODEL' && !m[2].includes('/') ? `openai/${m[2]}` : m[2];
    out.push({ key: m[1], id });
  }
  return out;
}

// ───────────────────────────────────────────────────────────── the inventory

/**
 * The inventory of the given sources: `{ models: [{ id, provider, surfaces,
 * priced, price, status? }] }`, sorted by id, surfaces sorted. `price` says
 * where the price entry is (`null` when there is none).
 */
export function buildInventory({ files, wrangler }) {
  const byId = new Map();
  const model = (id) => {
    if (!byId.has(id)) byId.set(id, { id, provider: providerOf(id), surfaces: new Set(), price: null });
    return byId.get(id);
  };

  // Price entries.
  const catalogueFile = files.find((f) => f.rel === CATALOGUE_REL);
  const catalogueText = catalogueFile ? stripComments(catalogueFile.text) : '';
  for (const r of catalogueRows(catalogueText)) {
    const m = model(r.id);
    m.status = r.status;
    if (r.priced) m.price = `${CATALOGUE_REL} CATALOGUE`;
  }
  const tableOf = new Map();
  for (const t of PROVIDER_TABLES) {
    for (const r of providerRows(catalogueText, t)) {
      const m = model(r.id);
      tableOf.set(r.id, t);
      if (r.priced) m.price = `${CATALOGUE_REL} ${t.name}`;
    }
  }
  for (const t of LOCAL_PRICE_TABLES) {
    const f = files.find((x) => x.rel === t.file);
    for (const id of f ? localPriceIds(f.text, t.name) : []) model(id).price = `${t.file} ${t.name}`;
  }

  // Call surfaces.
  for (const f of files) {
    if (LISTING_FILES.has(f.rel)) continue;
    const text = callableText(f);
    for (const m of text.matchAll(ID_LITERAL)) model(m[2]).surfaces.add(f.rel);
    for (const [id, t] of tableOf) {
      if (t.accessors.some((a) => new RegExp(`\\b${a}\\b`).test(text))) model(id).surfaces.add(f.rel);
    }
  }
  for (const w of wranglerModels(wrangler)) model(w.id).surfaces.add(`wrangler.toml ${w.key}`);

  const models = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((m) => {
    const out = { id: m.id, provider: m.provider, surfaces: [...m.surfaces].sort(), priced: m.price !== null, price: m.price };
    if (m.status) out.status = m.status;
    return out;
  });
  return { models };
}

/** The inventory's file text: stable JSON, one trailing newline. */
export const renderInventory = (inventory) => `${JSON.stringify(inventory, null, 2)}\n`;

/**
 * What is wrong with an inventory: a callable id with no price, a price entry
 * for an id nothing calls, and an allowlist entry that explains nothing.
 */
export function inventoryProblems(inventory, allowlist = ALLOWLIST) {
  const problems = [];
  const bad = [];
  for (const e of allowlist) {
    if (!['unpriced', 'stale'].includes(e.rule)) problems.push(`allowlist: ${e.id} has the rule "${e.rule}"; use "unpriced" or "stale"`);
    if (typeof e.reason !== 'string' || e.reason.trim().length < 20) problems.push(`allowlist: ${e.id} (${e.rule}) has no reason; say why the gap is not a defect`);
  }
  const listed = (id, rule) => allowlist.some((e) => e.id === id && e.rule === rule);
  const used = new Set();
  for (const m of inventory.models) {
    const called = m.surfaces.length > 0;
    if (called && !m.priced) {
      if (listed(m.id, 'unpriced')) used.add(`${m.id} unpriced`);
      else bad.push(`unpriced: ${m.id} (${m.provider}) is called from ${m.surfaces.join(', ')} and no price entry holds it. Add its price, stop calling it, or allowlist it in scripts/lib/modelInventory.mjs with the reason.`);
    }
    if (m.priced && !called && m.status !== DEPRECATED_HISTORY_RULE) {
      if (listed(m.id, 'stale')) used.add(`${m.id} stale`);
      else bad.push(`stale: ${m.id} (${m.provider}) has a price entry (${m.price}) and no code calls it. Remove the entry, or allowlist it in scripts/lib/modelInventory.mjs with the reason.`);
    }
  }
  for (const e of allowlist) {
    if (!used.has(`${e.id} ${e.rule}`)) problems.push(`allowlist: ${e.id} (${e.rule}) no longer has that gap; delete the entry`);
  }
  return [...bad, ...problems];
}
