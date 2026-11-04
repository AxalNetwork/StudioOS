#!/usr/bin/env node
/**
 * The effects for the advisory pull-request review
 * (`.github/workflows/claude-review.yml`): git, the GitHub REST API and the
 * Anthropic Messages API through the official SDK. Every decision is in
 * `../lib/claudeReview.mjs` and `../lib/claudeReviewRun.mjs`.
 *
 * Environment (set by the workflow):
 *   ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID, ANTHROPIC_SERVICE_ACCOUNT_ID,
 *   ANTHROPIC_WORKSPACE_ID   repository variables: workload identity federation, preferred.
 *                            GitHub's OIDC token (audience https://api.anthropic.com) is
 *                            exchanged for a short-lived Anthropic token; needs id-token: write
 *   ANTHROPIC_API_KEY        repository secret, the fallback; read by the SDK, never printed
 *   ANTHROPIC_MODEL, ANTHROPIC_MODEL_HIGH_RISK, CLAUDE_REVIEW_*  repository variables
 *   ANTHROPIC_API_KEY_2, ANTHROPIC_API_KEY_3, OPENAI_API_KEY, KIMI_API_KEY  repository secrets, optional: the
 *                            credit fallback chain, tried in that order, each only when the
 *                            account before it answers that its credit balance is exhausted
 *   OPENAI_MODEL, OPENAI_BASE_URL  owner-selected model (no default), optional HTTPS endpoint
 *   KIMI_MODEL, KIMI_BASE_URL  repository variables, optional (defaults in claudeReview.mjs)
 *   GITHUB_TOKEN             the job's read-only token (contents, pull-requests, actions)
 *   GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_STEP_SUMMARY, GITHUB_OUTPUT
 *   CLAUDE_REVIEW_PR_DIR     the checkout of the pull request's head (data only; nothing in it runs)
 *   CLAUDE_REVIEW_OUT_DIR    where the usage record is written for upload
 *
 * Nothing the model writes is printed except through escaped annotations, so
 * no answer can issue a workflow command. The diff and the source are never
 * logged.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { oidcFederationProvider } from '@anthropic-ai/sdk/lib/credentials/oidc-federation';
import { WorkloadIdentityError } from '@anthropic-ai/sdk/lib/credentials/types';
import { REVIEW_OUTPUT_SCHEMA, escapeCommandData, escapeCommandProperty, parseRates, readConfig } from '../lib/claudeReview.mjs';
import { runReview } from '../lib/claudeReviewRun.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SHA = /^[0-9a-f]{40}$/;
const RECORD_PREFIX = 'claude-review_v1_';
const MAX_FILE_BYTES = 2_000_000;
// budget_refused's reason is the runner's own arithmetic, never model or PR text.
const LOGGED_REASONS = new Set(['api_error', 'configuration_error', 'budget_refused']);

/** The audience Anthropic's token exchange expects on GitHub's identity token. */
export const OIDC_AUDIENCE = 'https://api.anthropic.com';

/** GitHub could not issue its identity token (the job lacks `id-token: write`, or the request failed). */
export class GithubIdentityError extends Error {}

/**
 * GitHub's OIDC token for this job, fetched fresh on every call, for the SDK's
 * federation exchange. It is never logged or written to disk; the runner only
 * hands it to the exchange.
 */
export function githubIdentityToken(env, fetchImpl = fetch) {
  return async () => {
    const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (!url || !bearer) throw new GithubIdentityError('GitHub issued no identity token: the job needs `permissions: id-token: write`');
    const u = new URL(url);
    u.searchParams.set('audience', OIDC_AUDIENCE);
    const res = await fetchImpl(u, { headers: { Authorization: `bearer ${bearer}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new GithubIdentityError(`GitHub's identity token request failed (HTTP ${res.status})`);
    const body = await res.json().catch(() => null);
    if (typeof body?.value !== 'string' || !body.value) throw new GithubIdentityError('GitHub returned no identity token');
    return body.value;
  };
}

const isFederationError = (e) => {
  for (let c = e, depth = 0; c && depth < 4; c = c.cause, depth += 1) {
    if (c instanceof WorkloadIdentityError || c instanceof GithubIdentityError) return c;
  }
  return null;
};

// What the API or the token exchange said, cut to one short line with anything
// credential-shaped removed. The SDK redacts the exchange response's known
// token fields only; a key, a bearer value or a JWT quoted anywhere else in
// the text (an echoed assertion, say) is removed here.
const DETAIL_MAX = 400;
export function errorDetail(e, fed) {
  let text;
  if (fed) text = fed.message;
  else if (e?.error?.error?.message) text = `${e.error.error.type || e.type || 'error'}: ${e.error.error.message}`;
  else if (typeof e?.message === 'string') text = e.message;
  else text = String(e?.name || 'Error');
  return String(text)
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[redacted]')
    .replace(/\b(Bearer|bearer)\s+\S+/g, '$1 [redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, DETAIL_MAX);
}

/** Map an SDK error to the runner's kinds, most specific class first. */
export function classifyError(e, sdk = Anthropic) {
  const requestId = e?.requestID || e?.request_id || undefined;
  let status = typeof e?.status === 'number' ? e.status : undefined;
  let kind = 'unknown';
  const fed = isFederationError(e);
  if (fed) {
    kind = 'federation';
    if (typeof fed.statusCode === 'number') status = fed.statusCode;
  } else if (typeof sdk.APIUserAbortError === 'function' && e instanceof sdk.APIUserAbortError) kind = 'timeout';
  else if (e instanceof sdk.AuthenticationError) kind = 'authentication';
  else if (e instanceof sdk.PermissionDeniedError) kind = 'permission';
  else if (e instanceof sdk.NotFoundError) kind = 'not_found';
  else if (e instanceof sdk.RateLimitError) kind = 'rate_limit';
  else if (e instanceof sdk.BadRequestError) kind = 'bad_request';
  else if (e instanceof sdk.APIConnectionTimeoutError) kind = 'timeout';
  else if (e instanceof sdk.APIConnectionError) kind = 'connection';
  else if (e instanceof sdk.InternalServerError) kind = status === 529 ? 'overloaded' : 'server';
  else if (e instanceof sdk.APIError) kind = status === 402 ? 'billing' : status === 529 ? 'overloaded' : 'unknown';
  if (['insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active'].includes(e?.code || e?.error?.code)) kind = 'billing';
  if (e?.name === 'APIUserAbortError' || e?.name === 'AbortError') kind = 'timeout';
  const out = new Error(`Anthropic API error: ${kind}`);
  Object.assign(out, { kind, status, requestId: requestId || fed?.requestId || undefined, detail: errorDetail(e, fed) });
  return out;
}

/** A connected stream may have billed tokens even if its final message fails. */
async function streamMessage(messages, p, options, sdk) {
  let streamStarted = false;
  try {
    const stream = messages().stream(p, options);
    stream.on?.('connect', () => { streamStarted = true; });
    return await stream.finalMessage();
  } catch (e) {
    const out = classifyError(e, sdk);
    out.streamStarted = streamStarted;
    if (options?.signal?.aborted) out.kind = 'timeout';
    throw out;
  }
}

/**
 * The SDK behind the runner's two calls, authenticated by workload identity
 * federation when `federation` is given, else by the API key. Under
 * federation `apiKey` and `authToken` are passed as null, because an API key
 * (even one read from the environment) outranks `credentials`.
 */
export function anthropicClient({ apiKey, federation = null, identityToken = null, workspaceId, maxRetries, timeoutSeconds, sdk = Anthropic, makeProvider = oidcFederationProvider }) {
  // Built on first use: a run that never calls the API never builds a client,
  // and a credential problem is the runner's error to report, not a crash.
  let client = null;
  const build = () => {
    const base = { maxRetries: 0, timeout: timeoutSeconds * 1000 };
    // Fallbacks pass null when unset to suppress another account's ambient header.
    // The main API-key client does not set this option.
    const workspaceHeaders = workspaceId === undefined ? {} : { defaultHeaders: { 'anthropic-workspace-id': workspaceId || null } };
    if (!federation) return new sdk({ ...base, apiKey, ...workspaceHeaders });
    const credentials = makeProvider({
      identityTokenProvider: identityToken,
      federationRuleId: federation.ruleId,
      organizationId: federation.organizationId,
      serviceAccountId: federation.serviceAccountId || undefined,
      workspaceId: federation.workspaceId || undefined,
      baseURL: 'https://api.anthropic.com',
      fetch: globalThis.fetch,
    });
    return new sdk({ ...base, apiKey: null, authToken: null, credentials });
  };
  const get = () => (client ||= build());
  const wrap = async (fn) => {
    try { return await fn(get()); } catch (e) { throw classifyError(e, sdk); }
  };
  return {
    countTokens: (p) => wrap((c) => c.messages.countTokens({ model: p.model, system: p.system, messages: p.messages })),
    create: (p, options) => streamMessage(() => p.betas ? get().beta.messages : get().messages, p, options, sdk),
  };
}

/**
 * The credit fallback: Kimi through Moonshot's Anthropic-compatible endpoint,
 * with the same SDK, the same retries and the same error kinds. Built on first
 * use, so a run that never needs it never touches the key.
 */
export function kimiClient({ apiKey, baseURL, maxRetries, timeoutSeconds, sdk = Anthropic, fetchImpl = globalThis.fetch }) {
  let client = null;
  // Only the Kimi key goes to Moonshot: authToken is pinned to null (the SDK
  // would read ANTHROPIC_AUTH_TOKEN), and every header outside the allowlist
  // (ANTHROPIC_CUSTOM_HEADERS, an Authorization bearer) is dropped on the way out.
  const get = () => (client ||= new sdk({ apiKey, authToken: null, baseURL, maxRetries: 0, timeout: timeoutSeconds * 1000, fetch: kimiFetch(fetchImpl) }));
  return {
    create: (p, options) => streamMessage(() => get().messages, p, options, sdk),
  };
}

/** OpenAI's own request headers only; no Anthropic or ambient workspace headers. */
export const OPENAI_HEADERS = /^(authorization|content-type|content-length|accept|accept-encoding|user-agent|idempotency-key|x-stainless-[a-z0-9-]+)$/i;
export function openaiFetch(fetchImpl, apiKey) {
  return (url, init = {}) => {
    const headers = new Headers(init.headers);
    for (const name of [...headers.keys()]) if (!OPENAI_HEADERS.test(name)) headers.delete(name);
    headers.set('authorization', `Bearer ${apiKey}`);
    return fetchImpl(url, { ...init, headers });
  };
}

/** Streaming Responses API mapped into the runner's existing Message shape. */
export function openaiClient({ apiKey, baseURL, timeoutSeconds, sdk = OpenAI, fetchImpl = globalThis.fetch }) {
  let client;
  const get = () => (client ||= new sdk({ apiKey, baseURL, organization: null, project: null, maxRetries: 0, timeout: timeoutSeconds * 1000, fetch: openaiFetch(fetchImpl, apiKey) }));
  return {
    create: async (p, options) => {
      let streamStarted = false;
      try {
        const stream = await get().responses.create({
          model: p.model, instructions: p.system, input: p.messages,
          max_output_tokens: p.max_tokens, stream: true, store: false,
          text: { format: { type: 'json_schema', name: 'review', strict: true, schema: REVIEW_OUTPUT_SCHEMA } },
        }, options);
        // HTTP success starts the uncertain-cost window. The SDK can throw on
        // the first SSE error before yielding any event to this iterator.
        streamStarted = true;
        let response;
        for await (const event of stream) {
          if (event.type === 'response.completed' || event.type === 'response.incomplete') response = event.response;
          if (event.type === 'response.failed' || event.type === 'error') {
            const error = event.response?.error || event;
            throw Object.assign(new Error(error.message || 'OpenAI stream failed'), { code: error.code });
          }
        }
        if (!response) throw Object.assign(new Error('OpenAI stream ended before a final response'), { name: 'APIConnectionTimeoutError' });
        const content = (response.output || []).filter(item => item.type === 'message').flatMap(item => item.content || []);
        const refused = content.some(item => item.type === 'refusal');
        const usage = response.usage;
        const cached = usage?.input_tokens_details?.cached_tokens || 0;
        return {
          _request_id: response._request_id,
          stop_reason: refused ? 'refusal' : response.status === 'incomplete' ? 'max_tokens' : 'end_turn',
          content: content.filter(item => item.type === 'output_text').map(item => ({ type: 'text', text: item.text })),
          usage: usage ? { input_tokens: typeof usage.input_tokens === 'number' ? Math.max(0, usage.input_tokens - cached) : undefined, output_tokens: usage.output_tokens, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 } : undefined,
        };
      } catch (e) {
        const classified = classifyError(e, sdk);
        classified.streamStarted = streamStarted;
        if (options?.signal?.aborted) classified.kind = 'timeout';
        if (e?.name === 'APIConnectionTimeoutError') classified.kind = 'timeout';
        throw classified;
      }
    },
  };
}

/** The headers Kimi may receive: the request's own, never another credential. */
export const KIMI_HEADERS = /^(content-type|content-length|accept|accept-encoding|x-api-key|anthropic-version|user-agent|idempotency-key|x-stainless-[a-z0-9-]+)$/i;

/** A fetch that forwards only the allowlisted headers. */
export function kimiFetch(fetchImpl) {
  return (url, init = {}) => {
    const headers = new Headers(init.headers);
    for (const name of [...headers.keys()]) if (!KIMI_HEADERS.test(name)) headers.delete(name);
    return fetchImpl(url, { ...init, headers });
  };
}

/**
 * The credit fallback chain's clients, by step id: a further Claude account
 * (its own API key, its own Console organization) through the same Anthropic
 * client, or Kimi. Each is built only if a review reaches it.
 */
export function fallbacksFor(env, overrides = {}) {
  const { config } = readConfig(env);
  const out = {};
  for (const step of config.creditFallbacks) {
    const common = { maxRetries: config.maxRetries, timeoutSeconds: config.timeoutSeconds };
    out[step.id] = step.provider === 'openai'
      ? openaiClient({ apiKey: env.OPENAI_API_KEY, baseURL: step.baseURL, ...common, ...(overrides.openai || {}) })
      : step.provider === 'kimi'
      ? kimiClient({ apiKey: env.KIMI_API_KEY, baseURL: step.baseURL, ...common, ...(overrides.kimi || {}) })
      : anthropicClient({ apiKey: env[step.secret], federation: null, workspaceId: step.workspaceId, ...common, ...(overrides.anthropic || {}) });
  }
  return out;
}

/** The client the run uses: federation when the variables configure it, else the API key. */
export function clientFor(env, overrides = {}) {
  const { config } = readConfig(env);
  return anthropicClient({
    apiKey: env.ANTHROPIC_API_KEY,
    federation: config.auth === 'federation' ? config.federation : null,
    identityToken: githubIdentityToken(env),
    maxRetries: config.maxRetries,
    timeoutSeconds: config.timeoutSeconds,
    ...overrides,
  });
}

/** A path inside the pull request checkout, or null for anything that would leave it. */
export function safePath(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\0')) return null;
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return full;
}

function git(prDir, args, maxBuffer = 64 * 1024 * 1024) {
  return execFileSync('git', ['-C', prDir, ...args], { encoding: 'utf8', maxBuffer, timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function gh(apiUrl, token, path) {
  const res = await fetch(`${apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    // Only artifact page reads use this retry metadata; other GitHub reads do not retry.
    const body = res.status === 403 ? await res.json().catch(() => null) : null;
    const rateLimited = res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after') || /rate limit/i.test(body?.message || ''));
    throw Object.assign(new Error(`GitHub API ${res.status} for ${path.split('?')[0]}`), { status: res.status, rateLimited });
  }
  return res.json();
}

/**
 * The listing's page cap: 5,000 artifacts. The repository keeps about 17 days
 * of artifacts, near 190 a day (3,272 on 2026-11-03), so a month's listing
 * reads at most about 34 pages; the cap is the backstop for a listing whose
 * order cannot be trusted.
 */
export const LEDGER_MAX_PAGES = 50;

/**
 * #4281: how far before the month's start a listing reads before it stops.
 * GitHub lists a repository's artifacts by id, newest first, but an
 * artifact's `created_at` (when its upload began) drifts from that order by
 * up to about 47 minutes (measured 2026-11-03). A day is far beyond that, so
 * no record of the month can follow the stopping point.
 */
export const LEDGER_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * The review records created since `sinceIso`, from a listing read one page
 * of 100 at a time (`fetchPage(page)` resolves to the API's reply). Complete
 * when the listing ends, or when, in id order newest first, it reaches an
 * artifact created a day before `sinceIso`; incomplete when the page cap cuts
 * it off, or when the ids come out of order (then it reads on to the cap).
 */
export async function listMonthRecords(fetchPage, sinceIso, maxPages = LEDGER_MAX_PAGES, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const artifacts = [];
  const stopBefore = new Date(Date.parse(sinceIso) - LEDGER_SKEW_MS).toISOString().replace('.000', '');
  let previousId = null;
  let newestFirst = true;
  for (let page = 1; page <= maxPages; page += 1) {
    let data;
    for (let attempt = 0; ; attempt += 1) {
      try { data = await fetchPage(page); break; } catch (e) {
        const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
        const network = e instanceof TypeError;
        const status = Number(e?.status);
        const retryable = status >= 500 && status <= 599 || status === 429 || status === 403 && e.rateLimited || timeout || network;
        if (retryable && attempt < 3) { await sleep(1000 * 2 ** attempt); continue; }
        // Fixed vocabulary only: never expose response bodies, URLs, credentials or raw errors.
        const cause = Number.isInteger(status) && status >= 100 && status <= 599 ? `HTTP ${status}` : timeout ? 'timeout' : network ? 'network error' : 'read error';
        const reason = `artifact listing page ${page}: ${cause}`;
        throw Object.assign(new Error(reason), { ledgerReadFailure: reason });
      }
    }
    // A reply with no list is not the end of the listing: an error must not read as a month with no spend.
    if (!Array.isArray(data?.artifacts)) throw Object.assign(new Error(`GitHub returned no artifact list on page ${page}`), { ledgerReadFailure: `artifact listing page ${page}: no artifact list` });
    const list = data.artifacts;
    let pastStop = false;
    for (const a of list) {
      const id = Number(a.id);
      if (!Number.isFinite(id) || (previousId !== null && id >= previousId)) newestFirst = false;
      previousId = id;
      const at = String(a.created_at || '');
      if (at < stopBefore) pastStop = true;
      if (at >= sinceIso && String(a.name || '').startsWith(RECORD_PREFIX)) artifacts.push({ name: a.name, created_at: a.created_at, expired: !!a.expired });
    }
    if (list.length < 100) return { artifacts, complete: true };
    if (pastStop && newestFirst) return { artifacts, complete: true };
  }
  return { artifacts, complete: false };
}

/** The two GitHub REST reads: the merge base, and this repository's review records. */
export function githubClient({ apiUrl, token, repository, sleep }) {
  return {
    async mergeBase(base, head) {
      if (!SHA.test(base) || !SHA.test(head)) throw new Error('base or head is not a commit id');
      const cmp = await gh(apiUrl, token, `/repos/${repository}/compare/${base}...${head}?per_page=1`);
      const sha = cmp?.merge_base_commit?.sha;
      if (!SHA.test(sha || '')) throw new Error('GitHub returned no merge base');
      return sha;
    },
    // #4281: the month's records. GitHub lists a repository's artifacts by
    // id, newest first, so once the listing is a day past the month's start
    // every record of the month has been seen, and the listing is complete.
    // That holds only while the order holds: each id must be lower than the
    // one before it. Should the API ever list out of order, the
    // listing reads every page up to the cap instead, and one cut off by the
    // cap is incomplete, so with a monthly budget set the runner refuses
    // rather than under-count the spend. The cap alone was the whole rule
    // before: once the repository held 3,000 artifacts, every review in every
    // month was refused as "spend unreadable", and none ran.
    async listArtifacts(sinceIso) {
      return listMonthRecords((page) => gh(apiUrl, token, `/repos/${repository}/actions/artifacts?per_page=100&page=${page}`), sinceIso, LEDGER_MAX_PAGES, sleep);
    },
  };
}

export async function main(env = process.env) {
  const prDir = resolve(env.CLAUDE_REVIEW_PR_DIR || '.');
  const outDir = resolve(env.CLAUDE_REVIEW_OUT_DIR || join(prDir, '..', 'claude-review-out'));
  const apiUrl = env.GITHUB_API_URL || 'https://api.github.com';
  const repository = env.GITHUB_REPOSITORY || '';
  const token = env.GITHUB_TOKEN || '';
  const event = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const rates = parseRates(JSON.parse(readFileSync(join(here, 'rates.json'), 'utf8')));
  const realRoot = (() => { try { return realpathSync(prDir); } catch { return prDir; } })();

  const deps = {
    env,
    event,
    repository,
    rates,
    now: () => new Date(),
    nonce: () => randomBytes(8).toString('hex'),
    github: githubClient({ apiUrl, token, repository }),
    git: {
      async authorMarkers(sha) {
        if (!SHA.test(sha)) throw new Error('not a commit id');
        return git(prDir, ['show', '-s', '--format=%an%n%cn', sha]).split('\n').map(s => s.slice(0, 500));
      },
      async fetch(sha) {
        if (!SHA.test(sha)) throw new Error('not a commit id');
        try { git(prDir, ['cat-file', '-e', `${sha}^{commit}`]); return; } catch { /* not present yet */ }
        git(prDir, ['fetch', '--no-tags', '--no-recurse-submodules', '--depth=1', 'origin', sha]);
      },
      async diff(from, to) {
        if (!SHA.test(from) || !SHA.test(to)) throw new Error('not a commit id');
        return git(prDir, ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--find-renames', '--unified=3', from, to, '--',
          '.', ':(exclude)docs', ':(exclude)design', ':(exclude)attached_assets', ':(exclude,glob)**/package-lock.json', ':(exclude,glob)**/*.lock']);
      },
    },
    readLines(path) {
      const full = safePath(prDir, path);
      if (!full) return null;
      try {
        const real = realpathSync(full);
        const rel = relative(realRoot, real);
        if (rel.startsWith('..') || isAbsolute(rel)) return null;
        // One descriptor for the size check and the read, so the file
        // measured is the file read.
        const fd = openSync(real, 'r');
        try {
          if (fstatSync(fd).size > MAX_FILE_BYTES) return null;
          return readFileSync(fd, 'utf8').split('\n');
        } finally {
          closeSync(fd);
        }
      } catch {
        return null;
      }
    },
    persistRecord(record) {
      const account = JSON.parse(record.body).account_id || 'main';
      const dir = join(outDir, account);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'record.json'), `${record.body}\n`);
      writeFileSync(join(dir, 'name.txt'), record.name);
      // Keep a root copy for diagnostics and older consumers.
      writeFileSync(join(outDir, 'record.json'), `${record.body}\n`);
    },
    anthropic: null,
    fallbacks: {},
  };
  deps.anthropic = clientFor(env);
  deps.fallbacks = fallbacksFor(env);

  let result;
  try {
    result = await runReview(deps);
  } catch (e) {
    // A defect in the reviewer itself. Say so without echoing anything it read.
    result = {
      outcome: 'internal_error',
      exitCode: /^(1|true|yes|on)$/i.test(String(env.CLAUDE_REVIEW_FAIL_ON_ERROR || '')) ? 1 : 0,
      summary: `## Claude review (advisory)\n\n**Outcome:** internal_error — the reviewer failed before finishing (${String(e?.name || 'Error').replace(/[^A-Za-z]/g, '')}). Nothing was published as a finding.\n`,
      annotations: [],
      record: null,
    };
  }

  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, result.summary);
  for (const line of result.annotations) process.stdout.write(`${line}\n`);
  if (result.record) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'record.json'), `${result.record.body}\n`);
    if (result.findingsFile) {
      writeFileSync(join(outDir, 'review.json'), `${result.findingsFile}\n`);
      const account = JSON.parse(result.record.body).account_id || 'main';
      writeFileSync(join(outDir, account, 'review.json'), `${result.findingsFile}\n`);
    }
  }
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `outcome=${result.outcome}\nrecord_name=${result.record ? result.record.name : ''}\n`);
  }
  // A failed call's reason goes to the log as well as the summary: a job
  // summary cannot be read through the API, and an error the log does not name
  // has to be guessed. A warning annotation carries it to the check run; it
  // never fails the step. Only these outcomes, whose reason is the API's, the
  // exchange's or the configuration check's own text; the others can quote the
  // model's answer or the pull request, which stay out of the log.
  const logged = LOGGED_REASONS.has(result.outcome) ? String(result.reason || '').replace(/[\r\n]+/g, ' ') : '';
  if (logged) {
    process.stdout.write(`::warning title=${escapeCommandProperty(`Claude review: ${result.outcome}`)}::${escapeCommandData(logged)}\n`);
  }
  process.stdout.write(`claude-review: ${result.outcome}${logged ? ` — ${logged}` : ''}\n`);
  return result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`claude-review: could not start (${String(e?.message || e).slice(0, 200)})\n`);
    process.exitCode = 1;
  });
}
