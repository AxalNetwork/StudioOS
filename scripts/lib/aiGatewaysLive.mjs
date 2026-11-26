/**
 * #8508 layer 2 (D8508-p2): the live, read-only half of the AI gateway check, not mounted yet.
 *
 * For one variable table of `wrangler.toml` it asks three questions of the Cloudflare account and answers each
 * with a state, never with what it read:
 *   - gateway  does each AI Gateway the table names exist?         GET ai-gateway/gateways/<id>
 *   - binding  is AGENT_AI_GATEWAY_TOKEN bound to the Worker?       GET workers/scripts/<worker>/secrets (names only)
 *   - alias    does each account alias resolve on the agents gateway? GET ai-gateway/gateways/<id>/provider_configs
 *
 * States: `present`, `missing` (a 404, or a complete listing without the name), `could not be read` (401, 403,
 * 429, 5xx, a timeout, a network error, an answer that is not the expected JSON, or a listing longer than the
 * pages it reads). Only `missing` on a route that is switched on stops a release. The Advisor's and the deck's
 * gateways have a fallback: a missing one is a warning (owner answer A on #8508, 2026-11-26).
 *
 * Nothing here chooses a credential, calls the network or prints: `request(path)` is handed in and answers
 * `{ status, body }` for a path relative to the account. A result holds kinds, names from the table, states and
 * routes only: never a token, an account id, a path or an answer's text. `scripts/check-ai-gateways-live.mjs`
 * drives it in the release preflight with the release token (owner answer A on #8508).
 */
import { parseToml } from './branchConfig.mjs';

export const STATES = Object.freeze({ present: 'present', missing: 'missing', unread: 'could not be read' });
export const TOKEN_BINDING = 'AGENT_AI_GATEWAY_TOKEN';
/** The account slots and their aliases, as `cloudflare-worker/src/services/agents/agentAccounts.ts` names them. */
export const ALIAS_SLOTS = Object.freeze([
  { aliasVar: 'AGENT_CLAUDE_ALIAS_1', provider: 'anthropic' },
  { aliasVar: 'AGENT_CLAUDE_ALIAS_2', provider: 'anthropic' },
  { aliasVar: 'AGENT_CLAUDE_ALIAS_3', provider: 'anthropic' },
  { aliasVar: 'AGENT_OPENAI_ALIAS', provider: 'openai' },
]);
/** Gateways whose route falls back without them: missing is a warning, not a stop (owner answer A, #8508). */
export const FALLBACK_ROUTES = Object.freeze(['advisor', 'deck']);
export const TIMEOUT_MS = 10_000;
export const MAX_PAGES = 5;
const PER_PAGE = 100;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const WORKER = /^[a-z0-9][a-z0-9-]{0,62}$/;

const unquote = (v) => {
  if (v === undefined) return '';
  const t = String(v).trim();
  if (t.startsWith('"')) { try { return JSON.parse(t); } catch { return t.slice(1, -1); } }
  if (t.startsWith("'")) return t.slice(1, -1);
  return t;
};

/**
 * What to read for one table (`vars`, `env.production.vars`, `env.preview.vars`), from the toml alone.
 * `providerSwitch` is the catalogue's GATEWAY_TEXT_SWITCH (read by `codeFacts` in check-ai-gateways.mjs).
 */
export function livePlan(toml, table, { providerSwitch = 'AI_PROVIDER_GATEWAY_OPENAI' } = {}) {
  const { sections, root } = parseToml(toml);
  const vars = sections.find((s) => s.name === table && !s.double);
  if (!vars) throw new Error(`the table [${table}] is missing`);
  const get = (k) => String(unquote(vars.kv.get(k)) ?? '').trim();
  const envName = table.startsWith('env.') ? table.slice(4, -'.vars'.length) : null;
  const envSection = envName ? sections.find((s) => s.name === `env.${envName}` && !s.double) : null;
  const worker = unquote(envSection?.kv.get('name') ?? root.get('name'));
  const engineOn = get('AGENT_ENGINE') !== '' && get('AGENT_ENGINE') !== 'off' && get('AGENT_INFERENCE_STUB') !== 'on';
  const routes = [
    { route: 'advisor', key: 'CF_AI_GATEWAY_SLUG_ADVISOR', on: true },
    { route: 'deck', key: 'CF_AI_GATEWAY_SLUG_DECK', on: true },
    { route: 'providers', key: 'CF_AI_GATEWAY_SLUG_PROVIDERS', on: get(providerSwitch) === 'on' },
    { route: 'agents', key: 'AGENT_AI_GATEWAY', on: engineOn },
  ];
  const gateways = [];
  for (const r of routes) {
    const id = get(r.key);
    if (!ID.test(id)) continue; // empty or malformed: layer 1's finding, nothing to read here
    const seen = gateways.find((g) => g.name === id);
    if (seen) { seen.routes.push(r.route); seen.on ||= r.on; continue; }
    gateways.push({ name: id, key: r.key, routes: [r.route], on: r.on });
  }
  const agentsGateway = ID.test(get('AGENT_AI_GATEWAY')) ? get('AGENT_AI_GATEWAY') : null;
  const aliases = ALIAS_SLOTS.map((s) => ({ ...s, alias: get(s.aliasVar) }))
    .filter((s) => ALIAS.test(s.alias) && s.alias !== 'default')
    .map((s) => ({ name: s.alias, key: s.aliasVar, provider: s.provider, on: engineOn }));
  return { table, worker: WORKER.test(worker ?? '') ? worker : null, gateways, agentsGateway, aliases,
    binding: { name: TOKEN_BINDING, on: engineOn } };
}

/** One bounded read: the answer, or `null` for anything that is not a usable JSON answer in time. */
async function read(request, path, timeoutMs) {
  let timer;
  try {
    const answer = await Promise.race([
      Promise.resolve().then(() => request(path)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    const status = Number(answer?.status);
    if (!Number.isInteger(status)) return null;
    return { status, body: answer.body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A listing of every page, or `{ state }` when it is a 404 (missing) or cannot be read whole. */
async function readAll(request, path, timeoutMs) {
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await read(request, `${path}${path.includes('?') ? '&' : '?'}per_page=${PER_PAGE}&page=${page}`, timeoutMs);
    if (!r) return { state: STATES.unread };
    if (r.status === 404) return { state: STATES.missing };
    if (r.status !== 200 || r.body?.success !== true || !Array.isArray(r.body.result)) return { state: STATES.unread };
    rows.push(...r.body.result);
    const total = Number(r.body.result_info?.total_count);
    const done = Number.isInteger(total) ? rows.length >= total : r.body.result.length < PER_PAGE;
    if (done) return { rows };
    if (!r.body.result.length) return { state: STATES.unread };
  }
  return { state: STATES.unread };
}

/**
 * The states for one plan. `request(path)` answers `{ status, body }` for a path under the account; it is called
 * at most `2 + MAX_PAGES * 2 + gateways` times, one at a time, each bounded by `timeoutMs`.
 */
export async function readLiveState(plan, { request, timeoutMs = TIMEOUT_MS }) {
  if (typeof request !== 'function') throw new Error('readLiveState needs a request function');
  const items = [];
  for (const g of plan.gateways) {
    const r = await read(request, `ai-gateway/gateways/${encodeURIComponent(g.name)}`, timeoutMs);
    const state = !r ? STATES.unread : r.status === 404 ? STATES.missing
      : r.status === 200 && r.body?.success === true && r.body.result?.id === g.name ? STATES.present : STATES.unread;
    items.push({ kind: 'gateway', name: g.name, key: g.key, routes: [...g.routes], on: g.on, state });
  }
  if (plan.binding) {
    let state = STATES.unread;
    if (plan.worker) {
      const r = await read(request, `workers/scripts/${encodeURIComponent(plan.worker)}/secrets`, timeoutMs);
      if (r?.status === 404) state = STATES.missing;
      else if (r?.status === 200 && r.body?.success === true && Array.isArray(r.body.result)) {
        state = r.body.result.some((s) => s?.name === plan.binding.name) ? STATES.present : STATES.missing;
      }
    }
    items.push({ kind: 'binding', name: plan.binding.name, routes: ['agents'], on: plan.binding.on, state });
  }
  if (plan.aliases.length) {
    const listing = plan.agentsGateway
      ? await readAll(request, `ai-gateway/gateways/${encodeURIComponent(plan.agentsGateway)}/provider_configs`, timeoutMs)
      : { state: STATES.unread };
    for (const a of plan.aliases) {
      const state = listing.state ?? (listing.rows.some((row) => row?.alias === a.name && row?.provider_slug === a.provider) ? STATES.present : STATES.missing);
      items.push({ kind: 'alias', name: a.name, key: a.key, provider: a.provider, routes: ['agents'], on: a.on, state });
    }
  }
  return { table: plan.table, items, ...liveVerdict(items) };
}

/**
 * What the states mean for a release. `stops`: missing on a route that is on and has no fallback. `warnings`:
 * missing on a fallback route (the Advisor's, the deck's), which then runs without its gateway (owner answer A on
 * #8508). `unread`: could not be read; reported, never a stop on its own.
 */
export function liveVerdict(items) {
  const label = (i) => `${i.kind} ${i.name}`;
  const fallbackOnly = (i) => i.routes.every((r) => FALLBACK_ROUTES.includes(r));
  const missing = items.filter((i) => i.state === STATES.missing);
  return {
    stops: missing.filter((i) => i.on && !fallbackOnly(i)).map(label),
    warnings: missing.filter((i) => fallbackOnly(i)).map(label),
    unread: items.filter((i) => i.state === STATES.unread).map(label),
  };
}

/** One line per item, for a job summary: names and states only. */
export function liveSummaryLines(result) {
  const lines = result.items.map((i) => `${i.kind} ${i.name} (${i.routes.join(', ')}${i.on ? '' : ', switched off'}): ${i.state}`);
  if (result.stops.length) lines.push(`stops the release: ${result.stops.join(', ')}`);
  if (result.warnings.length) lines.push(`missing, the route falls back without it (warning): ${result.warnings.join(', ')}`);
  if (result.unread.length) lines.push(`could not be read: ${result.unread.join(', ')}`);
  return lines;
}
