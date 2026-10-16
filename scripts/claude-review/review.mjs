#!/usr/bin/env node
/**
 * The effects for the advisory pull-request review
 * (`.github/workflows/claude-review.yml`): git, the GitHub REST API and the
 * Anthropic Messages API through the official SDK. Every decision is in
 * `../lib/claudeReview.mjs` and `../lib/claudeReviewRun.mjs`.
 *
 * Environment (set by the workflow):
 *   ANTHROPIC_API_KEY        repository secret; read by the SDK, never printed
 *   ANTHROPIC_MODEL, ANTHROPIC_MODEL_HIGH_RISK, CLAUDE_REVIEW_*  repository variables
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
import { appendFileSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { parseRates, readConfig } from '../lib/claudeReview.mjs';
import { runReview } from '../lib/claudeReviewRun.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SHA = /^[0-9a-f]{40}$/;
const RECORD_PREFIX = 'claude-review_v1_';
const MAX_FILE_BYTES = 2_000_000;

/** Map an SDK error to the runner's kinds, most specific class first. */
export function classifyError(e, sdk = Anthropic) {
  const requestId = e?.requestID || e?.request_id || undefined;
  const status = typeof e?.status === 'number' ? e.status : undefined;
  let kind = 'unknown';
  if (e instanceof sdk.AuthenticationError) kind = 'authentication';
  else if (e instanceof sdk.PermissionDeniedError) kind = 'permission';
  else if (e instanceof sdk.NotFoundError) kind = 'not_found';
  else if (e instanceof sdk.RateLimitError) kind = 'rate_limit';
  else if (e instanceof sdk.BadRequestError) kind = 'bad_request';
  else if (e instanceof sdk.APIConnectionTimeoutError) kind = 'timeout';
  else if (e instanceof sdk.APIConnectionError) kind = 'connection';
  else if (e instanceof sdk.InternalServerError) kind = status === 529 ? 'overloaded' : 'server';
  else if (e instanceof sdk.APIError) kind = status === 402 ? 'billing' : status === 529 ? 'overloaded' : 'unknown';
  const out = new Error(`Anthropic API error: ${kind}`);
  Object.assign(out, { kind, status, requestId });
  return out;
}

/** The SDK behind the runner's two calls. */
export function anthropicClient({ apiKey, maxRetries, timeoutSeconds, sdk = Anthropic }) {
  // Built on first use: the constructor throws without a key, and a missing key
  // is the runner's configuration error to report, not a crash before it runs.
  let client = null;
  const get = () => (client ||= new sdk({ apiKey, maxRetries, timeout: timeoutSeconds * 1000 }));
  const wrap = async (fn) => {
    try { return await fn(get()); } catch (e) { throw classifyError(e, sdk); }
  };
  return {
    countTokens: (p) => wrap((c) => c.messages.countTokens({ model: p.model, system: p.system, messages: p.messages })),
    create: (p) => wrap((c) => (p.betas ? c.beta.messages.create(p) : c.messages.create(p))),
  };
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
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path.split('?')[0]}`);
  return res.json();
}

/** The two GitHub REST reads: the merge base, and this repository's review records. */
export function githubClient({ apiUrl, token, repository }) {
  return {
    async mergeBase(base, head) {
      if (!SHA.test(base) || !SHA.test(head)) throw new Error('base or head is not a commit id');
      const cmp = await gh(apiUrl, token, `/repos/${repository}/compare/${base}...${head}?per_page=1`);
      const sha = cmp?.merge_base_commit?.sha;
      if (!SHA.test(sha || '')) throw new Error('GitHub returned no merge base');
      return sha;
    },
    // Every page, up to a cap, rather than stopping at the month's start:
    // the ledger must not depend on the order the API lists artifacts in. A
    // listing cut off by the cap is incomplete, and with a monthly budget set
    // the runner then refuses rather than under-count the spend.
    async listArtifacts(sinceIso) {
      const artifacts = [];
      for (let page = 1; page <= 30; page += 1) {
        const data = await gh(apiUrl, token, `/repos/${repository}/actions/artifacts?per_page=100&page=${page}`);
        const list = Array.isArray(data?.artifacts) ? data.artifacts : [];
        for (const a of list) {
          if (String(a.name || '').startsWith(RECORD_PREFIX) && String(a.created_at || '') >= sinceIso) {
            artifacts.push({ name: a.name, created_at: a.created_at, expired: !!a.expired });
          }
        }
        if (list.length < 100) return { artifacts, complete: true };
      }
      return { artifacts, complete: false };
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
        if (statSync(real).size > MAX_FILE_BYTES) return null;
        return readFileSync(real, 'utf8').split('\n');
      } catch {
        return null;
      }
    },
    anthropic: null,
  };
  const { config } = readConfig(env);
  deps.anthropic = anthropicClient({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: config.maxRetries, timeoutSeconds: config.timeoutSeconds });

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
    if (result.findingsFile) writeFileSync(join(outDir, 'review.json'), `${result.findingsFile}\n`);
  }
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `outcome=${result.outcome}\nrecord_name=${result.record ? result.record.name : ''}\n`);
  }
  process.stdout.write(`claude-review: ${result.outcome}\n`);
  return result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`claude-review: could not start (${String(e?.message || e).slice(0, 200)})\n`);
    process.exitCode = 1;
  });
}
