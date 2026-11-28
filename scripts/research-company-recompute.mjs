#!/usr/bin/env node
/**
 * D9030 (#9030): the operator's resumable driver for the D7821 company
 * classification recompute (`POST /api/admin/research-company-mapping/recompute`).
 *
 * The route recomputes at most 100 company rows per call and its counts
 * describe only that page (D7821). This driver loops pages until `done:true`,
 * carrying `after` and `rules_version` from each answer into the next request,
 * and sums the per-state, per-method and per-scheme counts over the pages it
 * accepted. A 409 `recompute_rules_changed` (an override landed mid-run)
 * discards the partial sums and restarts once from an empty cursor; a second
 * 409, any other non-200 answer, a network error, a malformed body or a page
 * that does not advance stops the run and prints the cursor it stopped at.
 *
 *   RESEARCH_RECOMPUTE_COOKIE='<Cookie header of an admin session>' \
 *     node scripts/research-company-recompute.mjs --base https://<host> \
 *       [--confirm-production] [--after <uid> --rules-version <v>] [--limit 1..100]
 *   node scripts/research-company-recompute.mjs --dry-run
 *
 * - The admin session comes only from RESEARCH_RECOMPUTE_COOKIE. It is sent
 *   as the Cookie header, its `studioos_csrf*` value is mirrored into
 *   X-CSRF-Token (the cookie flow's double submit), and it is never printed.
 * - A base host of axal.vc or app.axal.vc is refused without an explicit
 *   `--confirm-production`. Plain http is accepted for localhost only.
 * - `--dry-run` answers every page from an in-process stub of synthetic
 *   pages: nothing leaves the machine, and no cookie is needed or read.
 * - Output is one JSON object on stdout: `complete`, the summed `counts`,
 *   `pages`, `processed`, `restarts`, `rules_version`, `after`, and on a stop
 *   `stopped` (`status`, `code`, `at_after`). Exit 0 when complete, 1 when
 *   stopped, 2 on a usage error or refusal.
 */

export const RECOMPUTE_PATH = '/api/admin/research-company-mapping/recompute';
export const COOKIE_ENV = 'RESEARCH_RECOMPUTE_COOKIE';
export const PRODUCTION_HOSTS = new Set(['axal.vc', 'app.axal.vc']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const GROUPS = ['state', 'method', 'scheme'];
const CODE_RE = /^[a-z0-9_]{1,64}$/;
const TIMEOUT_MS = 30_000;

const USAGE = `usage: ${COOKIE_ENV}=<cookie> node scripts/research-company-recompute.mjs --base https://<host> [--confirm-production] [--after <uid> --rules-version <v>] [--limit 1..100]
       node scripts/research-company-recompute.mjs --dry-run`;

/** Parse argv into options, or `{ error }`. */
export function parseArgs(argv) {
  const opts = { base: null, confirmProduction: false, dryRun: false, after: '', rulesVersion: null, limit: 100, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return null;
      i += 1;
      return v;
    };
    if (arg === '--base') { opts.base = value(); if (opts.base === null) return { error: '--base needs a URL' }; }
    else if (arg === '--confirm-production') opts.confirmProduction = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--after') { opts.after = value(); if (!opts.after) return { error: '--after needs a cursor' }; }
    else if (arg === '--rules-version') { opts.rulesVersion = value(); if (!opts.rulesVersion) return { error: '--rules-version needs a value' }; }
    else if (arg === '--limit') {
      const v = Number(value());
      if (!Number.isInteger(v) || v < 1 || v > 100) return { error: '--limit must be an integer from 1 to 100' };
      opts.limit = v;
    } else if (arg === '--help' || arg === '-h') opts.help = true;
    else return { error: `unknown option ${arg}` };
  }
  if (opts.after && !opts.rulesVersion) return { error: '--after resumes a run and needs the --rules-version that page returned' };
  if (opts.rulesVersion && !opts.after) return { error: '--rules-version is only used with --after' };
  if (opts.after.length > 200 || (opts.rulesVersion && opts.rulesVersion.length > 100)) return { error: '--after or --rules-version is too long' };
  if (!opts.dryRun && !opts.help && !opts.base) return { error: '--base is required (or use --dry-run)' };
  return opts;
}

/** Validate the base URL: `{ origin, production }` or `{ error }`. Refuses production hosts without `confirmProduction`. */
export function checkBase(base, confirmProduction) {
  let url;
  try { url = new URL(base); } catch { return { error: 'the base is not a URL' }; }
  if (url.username || url.password) return { error: 'the base must not carry credentials' };
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return { error: 'the base is an origin only, with no path, query or fragment' };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(host)) return { error: 'plain http is accepted for localhost only' };
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'the base must be https' };
  const production = PRODUCTION_HOSTS.has(host);
  if (production && !confirmProduction) return { error: `${host} is production: rerun with --confirm-production once the owner has authorised the run` };
  return { origin: url.origin, production };
}

/** The `studioos_csrf*` value in a Cookie header, mirrored into X-CSRF-Token; null when absent. */
export function csrfFromCookie(cookie) {
  for (const part of String(cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (name === 'studioos_csrf' || name.startsWith('studioos_csrf_')) return part.slice(eq + 1).trim();
  }
  return null;
}

const emptyCounts = () => ({ state: {}, method: {}, scheme: {} });
const isCountMap = (m) => m && typeof m === 'object' && !Array.isArray(m)
  && Object.values(m).every((n) => Number.isInteger(n) && n >= 0);

/** True when `body` is a route page: processed, after, done, rules_version and three count maps. */
export function isPage(body) {
  return !!body && typeof body === 'object'
    && Number.isInteger(body.processed) && body.processed >= 0
    && typeof body.after === 'string' && typeof body.done === 'boolean'
    && typeof body.rules_version === 'string' && body.rules_version.length > 0
    && !!body.counts && GROUPS.every((g) => isCountMap(body.counts[g]));
}

function addCounts(total, page) {
  for (const g of GROUPS) {
    for (const [key, n] of Object.entries(page[g])) total[g][key] = (total[g][key] || 0) + n;
  }
}

/** A refusal's code. `refusalBody` (cloudflare-worker/src/util/refusal.ts) puts it on `error`; its message is never printed. */
async function readCode(res) {
  try {
    const code = (await res.json())?.error;
    return typeof code === 'string' && CODE_RE.test(code) ? code : null;
  } catch { return null; }
}

/**
 * Drive the recompute to `done:true`. `fetchImpl(url, init)` is the network;
 * `cookie` is sent but never returned. Resolves to the summary object that
 * the CLI prints; it never throws for a server or network failure.
 */
export async function runRecompute({ origin, cookie = '', fetchImpl = fetch, limit = 100, after = '', rulesVersion = null, maxRestarts = 1, timeoutMs = TIMEOUT_MS }) {
  const headers = { accept: 'application/json', 'content-type': 'application/json' };
  if (cookie) {
    headers.cookie = cookie;
    const csrf = csrfFromCookie(cookie);
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  let cursor = after, version = rulesVersion, counts = emptyCounts();
  let pages = 0, processed = 0, restarts = 0, resumedFrom = after || null;
  const summary = (extra) => ({ complete: false, resumed_from: resumedFrom, pages, processed, restarts, rules_version: version, after: cursor, counts, ...extra });
  const stop = (status, code) => summary({ stopped: { status, code, at_after: cursor } });

  for (;;) {
    const body = { after: cursor, limit };
    if (version) body.rules_version = version;
    let res;
    try {
      res = await fetchImpl(`${origin}${RECOMPUTE_PATH}`, {
        method: 'POST', headers, body: JSON.stringify(body), redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      return stop(null, e?.name === 'TimeoutError' ? 'timeout' : 'network_error');
    }
    if (res.status === 409) {
      const code = await readCode(res);
      if (code === 'recompute_rules_changed' && restarts < maxRestarts) {
        // An override changed the rules: every page summed so far was mapped
        // under the old version, so its counts are discarded with the cursor.
        restarts += 1;
        cursor = ''; version = null; counts = emptyCounts(); pages = 0; processed = 0; resumedFrom = null;
        continue;
      }
      return stop(409, code);
    }
    if (res.status !== 200) return stop(res.status, await readCode(res));
    let page;
    try { page = await res.json(); } catch { return stop(200, 'invalid_page_body'); }
    if (!isPage(page)) return stop(200, 'invalid_page_body');
    if (!page.done && (page.processed === 0 || page.after === cursor)) return stop(200, 'no_progress');
    addCounts(counts, page.counts);
    pages += 1;
    processed += page.processed;
    cursor = page.after;
    version = page.rules_version;
    if (page.done) return summary({ complete: true });
  }
}

/** An in-process stand-in for the route, answering synthetic pages in order (used by --dry-run). */
export function stubFetch(answers = DRY_RUN_PAGES) {
  let i = 0;
  return async () => {
    const answer = answers[Math.min(i, answers.length - 1)];
    i += 1;
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
  };
}

const DRY_RUN_PAGES = [
  { status: 200, body: { stale: false, processed: 2, after: 'dry-0002', done: false, rules_version: 'dry-run:0', counts: { state: { mapped: 1, no_label: 1 }, method: { code: 1, none: 1 }, scheme: { 'UK SIC': 1, none: 1 } } } },
  { status: 200, body: { stale: false, processed: 1, after: 'dry-0003', done: true, rules_version: 'dry-run:0', counts: { state: { outside_tracked_markets: 1 }, method: { rule: 1 }, scheme: { none: 1 } } } },
];

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) { console.error(`research-company-recompute: ${opts.error}\n${USAGE}`); return 2; }
  if (opts.help) { console.log(USAGE); return 0; }
  let run;
  if (opts.dryRun) {
    run = { origin: 'https://dry-run.invalid', fetchImpl: stubFetch() };
  } else {
    const base = checkBase(opts.base, opts.confirmProduction);
    if (base.error) { console.error(`research-company-recompute: ${base.error}`); return 2; }
    const cookie = String(process.env[COOKIE_ENV] || '');
    if (!cookie) { console.error(`research-company-recompute: set ${COOKIE_ENV} to an admin session's Cookie header`); return 2; }
    if (/[\r\n]/.test(cookie)) { console.error(`research-company-recompute: ${COOKIE_ENV} must be one header line`); return 2; }
    run = { origin: base.origin, cookie, fetchImpl: fetch };
  }
  const result = await runRecompute({ ...run, limit: opts.limit, after: opts.after, rulesVersion: opts.rulesVersion });
  console.log(JSON.stringify({ dry_run: opts.dryRun, ...result }, null, 2));
  return result.complete ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
