#!/usr/bin/env node
/**
 * #8508 layer 2 (D8508-p2): the live, read-only AI gateway check in the release preflight.
 *
 *   node scripts/check-ai-gateways-live.mjs                      [env.production.vars], what ships
 *   node scripts/check-ai-gateways-live.mjs --table <table>       another table of wrangler.toml
 *
 * Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (the release token, owner answer A on #8508) and asks the
 * account, read-only, whether each gateway the table names exists, whether AGENT_AI_GATEWAY_TOKEN is bound to the
 * Worker by name, and whether each account alias resolves. The rules are `scripts/lib/aiGatewaysLive.mjs`.
 *
 * Exit 1 only when an item is missing on a switched-on route with no fallback. A missing Advisor or deck gateway is
 * a warning (owner answer A: the route falls back). "Could not be read" (for example a token without AI Gateway
 * Read) is a warning, never a stop. It prints names and states only: never the token, the account id or an answer.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFERENCE, SOURCES, codeFacts } from './check-ai-gateways.mjs';
import { TIMEOUT_MS, livePlan, liveSummaryLines, readLiveState } from './lib/aiGatewaysLive.mjs';

const ACCOUNT = /^[0-9a-f]{32}$/;
const CF = 'https://api.cloudflare.com/client/v4';

/**
 * `request(path)` for the adapter: a GET under the account, bounded by `timeoutMs`, answering `{ status, body }`.
 * Without a usable token or account id it calls nothing and answers `null`, which the adapter reads as
 * "could not be read".
 */
export function cloudflareRequest({ account, token, fetchImpl = fetch, timeoutMs = TIMEOUT_MS }) {
  const usable = ACCOUNT.test(String(account ?? '')) && typeof token === 'string' && token.trim().length > 0;
  return async (path) => {
    if (!usable) return null;
    const response = await fetchImpl(`${CF}/accounts/${account}/${path}`, {
      method: 'GET', headers: { Authorization: `Bearer ${token.trim()}` }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    return { status: response.status, body };
  };
}

/** The whole check; returns `{ status, result }`. `log` and `annotate` print; `summary(text)` appends to the job summary. */
export async function runLiveCheck({ toml, src, env, table = REFERENCE, fetchImpl, log = console.log, annotate = console.log, summary = () => {} }) {
  const { providerSwitch } = codeFacts(src);
  const plan = livePlan(toml, table, { providerSwitch });
  const request = cloudflareRequest({ account: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN, fetchImpl });
  const result = await readLiveState(plan, { request });
  for (const line of liveSummaryLines(result)) log(line);
  for (const s of result.stops) annotate(`::error title=AI gateway (D8508)::${s} is missing on a switched-on route; the release stops`);
  for (const w of result.warnings) annotate(`::warning title=AI gateway (D8508)::${w} is missing; its route runs without a gateway (owner answer A, #8508)`);
  if (result.unread.length) annotate(`::warning title=AI gateway (D8508)::could not be read: ${result.unread.join(', ')}`);
  const rows = result.items.map((i) => `| ${i.kind} | \`${i.name}\` | ${i.routes.join(', ')} | ${i.on ? 'on' : 'off'} | ${i.state} |`);
  summary(`### AI gateways, live (D8508) — [${table}]\n\n| Kind | Name | Routes | Route | State |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n`
    + `${result.stops.length ? `**Stops the release:** ${result.stops.join(', ')}\n\n` : ''}`
    + `${result.warnings.length ? `Missing, the route falls back without it: ${result.warnings.join(', ')}\n\n` : ''}`
    + `${result.unread.length ? `Could not be read: ${result.unread.join(', ')}\n\n` : ''}`);
  if (!result.stops.length) log(`✓ check-ai-gateways-live: [${table}] ${result.items.length} items read; nothing missing on a switched-on route`);
  return { status: result.stops.length ? 1 : 0, result };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (p) => readFileSync(resolve(root, p), 'utf8');
  const args = process.argv.slice(2);
  const at = args.indexOf('--table');
  const table = at >= 0 ? args[at + 1] : REFERENCE;
  const { status } = await runLiveCheck({
    toml: read('wrangler.toml'), src: Object.fromEntries(SOURCES.map((p) => [p, read(p)])), env: process.env, table,
    summary: (text) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text); },
  });
  process.exit(status);
}
