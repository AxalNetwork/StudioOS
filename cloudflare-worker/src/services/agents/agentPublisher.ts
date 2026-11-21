/**
 * D5569 part 2 (#5569): the trusted GitHub publisher's broker contract, pure and off by default. Given an agent
 * workspace's content-addressed publish intent and what the broker observed (flag, installation, base head, the
 * repository's agent PRs, the last GitHub 403/429, the combined candidate's required checks, approvals), it returns
 * one deterministic decision: a planned `agent/<task>/<attempt>` branch and draft PR, or a typed refusal.
 *
 * No route, D1 write, credential, fetch or clock: the caller injects every observation, `now_ms` included. The plan
 * has no approve, merge, auto-merge or protection-bypass field, so nothing built on it can ask for one; a human
 * review and GitHub's protected merge queue (#5500) and exact-SHA release (#5501) decide what lands.
 */
import { escape, order, pairs } from '../../../../scripts/lib/prOverlap.mjs';

export const PUBLISHER_VERSION = 1 as const;
export const PUBLISH_MARKER = 'studioos-agent-publish:v1';
/** An installation read older than this is stale: the broker must read GitHub again before it plans. */
export const INSTALLATION_OBSERVATION_TTL_MS = 5 * 60_000;
/** GitHub's guidance for a secondary limit with no `retry-after`: wait at least a minute, then back off exponentially. */
export const SECONDARY_BACKOFF_MS = 60_000;
export const MAX_BACKOFF_MS = 60 * 60_000;
export const MAX_FILES = 300;
export const MAX_UNTRUSTED_CHARS = 2_000;
/** Paths no agent PR may change, whatever the installation allows: they steer CI, required checks and review. */
const PROTECTED_PATH = /(^|\/)CODEOWNERS$|^\.github\/(?:workflows|actions)\//;

/** The feature flag. Only the exact string `on` enables planning; anything else, unset included, is off. */
export const publisherEnabled = (flag: unknown): boolean => flag === 'on';

export type CheckConclusion = 'success' | 'failure' | 'cancelled' | 'timed_out' | 'action_required' | 'pending' | 'skipped' | 'neutral';
export type FileChange = { path: string; change: 'added' | 'modified' | 'removed' };
export type PublishIntent = {
  version: typeof PUBLISHER_VERSION;
  tenant_id: number;
  company_id: number;
  project_id: number;
  /** `venture_git_installations.uid` (D5569 part 1). */
  installation_uid: string;
  repository_full_name: string;
  target_ref: string;
  base_sha: string;
  /** `sha256:<hex>` of the exact patch the workspace produced. */
  patch_digest: string;
  files: FileChange[];
  provenance: {
    agent_id: string;
    task_id: string;
    run_uuid: string;
    attempt: number;
    image_digest: string;
    evidence_digest: string;
  };
  agent_checks: { tests: 'passed' | 'failed' | 'missing'; scan: 'passed' | 'failed' | 'missing' };
  idempotency_key: string;
  /** Untrusted agent text: quoted and escaped in the body, never in the title. */
  summary: string;
  log_excerpt?: string | null;
};
export type InstallationObservation = {
  uid: string;
  tenant_id: number;
  company_id: number;
  project_id: number;
  repository_full_name: string;
  base_ref: string;
  revoked_at: string | null;
  approved_by_user_id: number | null;
  /** What GitHub said about the installation at `observed_at_ms`. */
  github_status: 'active' | 'suspended' | 'missing' | 'unknown';
  /** Exact paths, or folders ending in `/`. Empty allows nothing. */
  allowed_paths: string[];
  observed_at_ms: number;
};
export type ExistingAgentPr = {
  number: number;
  url: string;
  head_ref: string;
  state: 'open' | 'closed' | 'merged';
  task_id: string | null;
  idempotency_key: string | null;
  intent_digest: string | null;
  files: string[];
};
export type GithubResponseObservation = {
  status: 403 | 429;
  at_ms: number;
  retry_after_s?: number | null;
  ratelimit_remaining?: number | null;
  ratelimit_reset_s?: number | null;
  /** GitHub's body named a secondary rate limit. */
  secondary?: boolean;
  /** How many limited responses in a row, this one included. */
  consecutive: number;
};
export type PublisherObservations = {
  now_ms: number;
  enabled: boolean;
  installation: InstallationObservation | null;
  base_head_sha: string | null;
  existing_prs: ExistingAgentPr[];
  last_github_response: GithubResponseObservation | null;
  /** The combined candidate (this patch on the current base) against the protected branch's required checks. */
  candidate_checks: { required: string[]; results: Record<string, CheckConclusion> } | null;
  /** Human task approvals the platform recorded. Rendered, never granted by this module. */
  approvals: { user_id: number; decision_uid: string }[];
  /** Open PRs a human coordinator has cleared this task to overlap. */
  coordination_cleared?: number[];
};

export type PublisherRefusalCode =
  | 'publisher_disabled' | 'invalid_intent' | 'invalid_observation'
  | 'installation_not_found' | 'installation_revoked' | 'installation_approval_missing'
  | 'installation_suspended' | 'installation_stale' | 'repository_mismatch' | 'target_ref_mismatch'
  | 'duplicate_publish' | 'idempotency_conflict' | 'task_already_merged' | 'task_pr_declined'
  | 'github_forbidden' | 'github_rate_limited'
  | 'protected_path' | 'scope_violation'
  | 'base_unknown' | 'base_moved'
  | 'agent_checks_failed' | 'agent_checks_missing'
  | 'required_checks_missing' | 'required_checks_pending' | 'required_checks_failed'
  | 'coordination_required';
export type CoordinationEntry = { number: number; url: string; paths: { path: string; class: string }[]; migration_stamps: string[] };
export type PublisherRefusal = {
  ok: false;
  code: PublisherRefusalCode;
  /** Whether the same intent may be offered again later without a human changing anything. */
  retryable: boolean;
  retry_at?: string;
  field?: string;
  paths?: string[];
  checks?: string[];
  reuse?: { number: number; url: string };
  coordination?: { with: CoordinationEntry[]; textual_conflict: 'not checked'; suggested_order: (number | 'this')[] };
};
export type PullRequestPlan = {
  repository_full_name: string;
  base_ref: string;
  expected_base_sha: string;
  head_branch: string;
  /** Per-ref conditional update: the branch is created only if it does not exist. */
  head_ref_condition: 'must_not_exist';
  draft: true;
  title: string;
  body: string;
  labels: string[];
  intent_digest: string;
  patch_digest: string;
  /** Open agent PRs with disjoint paths: they proceed in parallel. */
  parallel_with: number[];
};
export type PublishDecision = { ok: true; action: 'open_pull_request'; plan: PullRequestPlan } | PublisherRefusal;

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const UID = /^[a-f0-9]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TASK = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const AGENT = /^[a-z0-9][a-z0-9:._-]{0,79}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const REF = /^refs\/heads\/[A-Za-z0-9._/-]{1,200}$/;
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const PASSING: ReadonlySet<CheckConclusion> = new Set(['success']);
const FAILING: ReadonlySet<CheckConclusion> = new Set(['failure', 'cancelled', 'timed_out', 'action_required']);

const refuse = (code: PublisherRefusalCode, retryable: boolean, extra: Omit<PublisherRefusal, 'ok' | 'code' | 'retryable'> = {}): PublisherRefusal =>
  ({ ok: false, code, retryable, ...extra });

/** A repository-relative file path: no `..`, no absolute path, no `.git` segment, no control character. */
export function safePath(path: unknown): path is string {
  if (typeof path !== 'string' || !path || path.length > 400 || /[\u0000-\u001f\u007f\\]/.test(path)) return false;
  if (path.startsWith('/') || path.endsWith('/')) return false;
  return path.split('/').every(s => s !== '' && s !== '.' && s !== '..' && s.toLowerCase() !== '.git');
}

export function publishIntentProblem(i: PublishIntent): string | null {
  if (!i || typeof i !== 'object') return 'intent';
  if (i.version !== PUBLISHER_VERSION) return 'version';
  for (const k of ['tenant_id', 'company_id', 'project_id'] as const) if (!positive(i[k])) return k;
  if (typeof i.installation_uid !== 'string' || !UID.test(i.installation_uid)) return 'installation_uid';
  if (typeof i.repository_full_name !== 'string' || !REPO.test(i.repository_full_name)) return 'repository_full_name';
  if (typeof i.target_ref !== 'string' || !REF.test(i.target_ref)) return 'target_ref';
  if (typeof i.base_sha !== 'string' || !SHA.test(i.base_sha)) return 'base_sha';
  if (typeof i.patch_digest !== 'string' || !DIGEST.test(i.patch_digest)) return 'patch_digest';
  if (!Array.isArray(i.files) || !i.files.length || i.files.length > MAX_FILES) return 'files';
  const seen = new Set<string>();
  for (const f of i.files) {
    if (!f || !safePath(f.path) || !['added', 'modified', 'removed'].includes(f.change) || seen.has(f.path)) return 'files';
    seen.add(f.path);
  }
  const p = i.provenance;
  if (!p || typeof p !== 'object') return 'provenance';
  if (typeof p.agent_id !== 'string' || !AGENT.test(p.agent_id)) return 'provenance.agent_id';
  if (typeof p.task_id !== 'string' || !TASK.test(p.task_id)) return 'provenance.task_id';
  if (typeof p.run_uuid !== 'string' || !UUID.test(p.run_uuid)) return 'provenance.run_uuid';
  if (!positive(p.attempt) || p.attempt > 99) return 'provenance.attempt';
  if (typeof p.image_digest !== 'string' || !DIGEST.test(p.image_digest)) return 'provenance.image_digest';
  if (typeof p.evidence_digest !== 'string' || !DIGEST.test(p.evidence_digest)) return 'provenance.evidence_digest';
  const states = ['passed', 'failed', 'missing'];
  if (!i.agent_checks || !states.includes(i.agent_checks.tests) || !states.includes(i.agent_checks.scan)) return 'agent_checks';
  if (typeof i.idempotency_key !== 'string' || !KEY.test(i.idempotency_key)) return 'idempotency_key';
  if (typeof i.summary !== 'string') return 'summary';
  if (i.log_excerpt != null && typeof i.log_excerpt !== 'string') return 'log_excerpt';
  return null;
}

function observationProblem(o: PublisherObservations): string | null {
  if (!Number.isSafeInteger(o.now_ms) || o.now_ms < 0) return 'now_ms';
  if (!Array.isArray(o.existing_prs) || o.existing_prs.some(pr => !positive(pr?.number) || !Array.isArray(pr.files))) return 'existing_prs';
  if (!Array.isArray(o.approvals) || o.approvals.some(a => !positive(a?.user_id) || typeof a.decision_uid !== 'string' || !UID.test(a.decision_uid))) return 'approvals';
  return null;
}

/** Canonical JSON (sorted keys) so the same intent always yields the same digest. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** `sha256:<hex>` of the intent's canonical form, files sorted by path: the content address the PR body records. */
export async function intentDigest(intent: PublishIntent): Promise<string> {
  const files = [...intent.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const bytes = new TextEncoder().encode(canonical({ ...intent, files, log_excerpt: intent.log_excerpt ?? null }));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${[...hash].map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Untrusted text as one inline `<code>` element: control and bidi characters become spaces, newlines collapse (no
 * line can start with `/approve` or a fake marker), and every Markdown, HTML, mention, reference and link character
 * is an entity (D5616's `escape` plus `/`, `#`, `:` and `$`). GitHub skips mentions and references inside code.
 */
export function quoteUntrusted(value: unknown): string {
  const flat = String(value ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  // One pass per character, so an entity `escape` wrote is never escaped a second time.
  const safe = [...flat].slice(0, MAX_UNTRUSTED_CHARS).map(c => (/[/#:$]/.test(c) ? `&#${c.charCodeAt(0)};` : escape(c))).join('');
  return safe ? `<code>${safe}</code>${[...flat].length > MAX_UNTRUSTED_CHARS ? ' (cut)' : ''}` : '_none_';
}

/**
 * GitHub's 403 and 429, classified. A 429, or a 403 carrying `retry-after`, `x-ratelimit-remaining: 0` or a
 * secondary-limit message, waits for `retry-after`, else the reset, else one minute, doubled per consecutive limit
 * and capped at an hour. Any other 403 is a permission refusal that waiting does not fix.
 */
export function classifyGithubResponse(r: GithubResponseObservation): { kind: 'forbidden' } | { kind: 'rate_limited'; retry_at_ms: number } {
  const limited = r.status === 429 || r.secondary === true || r.retry_after_s != null || r.ratelimit_remaining === 0;
  if (!limited) return { kind: 'forbidden' };
  let wait = SECONDARY_BACKOFF_MS;
  if (r.retry_after_s != null && r.retry_after_s > 0) wait = r.retry_after_s * 1000;
  else if (r.ratelimit_remaining === 0 && r.ratelimit_reset_s != null) wait = Math.max(r.ratelimit_reset_s * 1000 - r.at_ms, SECONDARY_BACKOFF_MS);
  const n = Math.max(1, Math.min(Math.trunc(r.consecutive) || 1, 16));
  wait = Math.min(Math.max(wait, SECONDARY_BACKOFF_MS * 2 ** (n - 1)), MAX_BACKOFF_MS);
  return { kind: 'rate_limited', retry_at_ms: r.at_ms + wait };
}

const allowedBy = (allowed: string[], path: string) =>
  allowed.some(a => typeof a === 'string' && (a.endsWith('/') ? path.startsWith(a) : path === a));
const iso = (ms: number) => new Date(ms).toISOString();

function renderBody(intent: PublishIntent, digest: string, approvals: PublisherObservations['approvals']): string {
  const p = intent.provenance;
  const code = (v: string | number) => `\`${v}\``;
  const rows: [string, string][] = [
    ['Agent', code(p.agent_id)],
    ['Task', code(p.task_id)],
    ['Run', `${code(p.run_uuid)} attempt ${p.attempt}`],
    ['Tenant', code(intent.tenant_id)],
    ['Company', code(intent.company_id)],
    ['Project', code(intent.project_id)],
    ['Installation', code(intent.installation_uid)],
    ['Base', `${code(intent.target_ref)} at ${code(intent.base_sha)}`],
    ['Workspace image', code(p.image_digest)],
    ['Evidence', code(p.evidence_digest)],
    ['Patch', code(intent.patch_digest)],
    ['Intent', code(digest)],
    ['Agent tests / scan', `${intent.agent_checks.tests} / ${intent.agent_checks.scan}`],
    ['Task approvals', approvals.length ? approvals.map(a => `${code(a.decision_uid)} by user ${a.user_id}`).join(', ') : 'none recorded'],
  ];
  return [
    `<!-- ${PUBLISH_MARKER} key=${intent.idempotency_key} digest=${digest} -->`,
    '### Agent publication',
    '',
    'Opened by the trusted publisher (D5569) for a recorded agent run. It carries no approval and no merge right: '
      + 'a human reviews it, and the protected branch\'s required checks and merge queue decide whether it lands.',
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '**Agent summary (untrusted, quoted):**',
    '',
    `> ${quoteUntrusted(intent.summary)}`,
    '',
    '**Log excerpt (untrusted, quoted):**',
    '',
    `> ${quoteUntrusted(intent.log_excerpt)}`,
  ].join('\n');
}

/** The one decision. Refusals come in a fixed order, so the same inputs always give the same code. */
export async function planAgentPublish(intent: PublishIntent, obs: PublisherObservations): Promise<PublishDecision> {
  if (obs?.enabled !== true) return refuse('publisher_disabled', false);
  const bad = publishIntentProblem(intent);
  if (bad) return refuse('invalid_intent', false, { field: bad });
  const badObs = observationProblem(obs);
  if (badObs) return refuse('invalid_observation', true, { field: badObs });

  const inst = obs.installation;
  if (!inst || inst.uid !== intent.installation_uid || inst.tenant_id !== intent.tenant_id
      || inst.company_id !== intent.company_id || inst.project_id !== intent.project_id) {
    return refuse('installation_not_found', false);
  }
  if (inst.revoked_at !== null) return refuse('installation_revoked', false);
  if (inst.approved_by_user_id === null) return refuse('installation_approval_missing', false);
  if (inst.github_status === 'suspended') return refuse('installation_suspended', false);
  if (inst.github_status !== 'active') return refuse('installation_stale', true);
  const age = obs.now_ms - inst.observed_at_ms;
  if (!Number.isSafeInteger(inst.observed_at_ms) || age < 0 || age > INSTALLATION_OBSERVATION_TTL_MS) return refuse('installation_stale', true);
  if (inst.repository_full_name.toLowerCase() !== intent.repository_full_name.toLowerCase()) return refuse('repository_mismatch', false);
  if (inst.base_ref !== intent.target_ref) return refuse('target_ref_mismatch', false);

  const digest = await intentDigest(intent);
  const p = intent.provenance;
  const reuse = (pr: ExistingAgentPr) => ({ number: pr.number, url: pr.url });
  const sameKey = obs.existing_prs.find(pr => pr.idempotency_key === intent.idempotency_key);
  if (sameKey) {
    return sameKey.intent_digest === digest
      ? refuse('duplicate_publish', false, { reuse: reuse(sameKey) })
      : refuse('idempotency_conflict', false, { reuse: reuse(sameKey) });
  }
  const sameTask = obs.existing_prs.filter(pr => pr.task_id === p.task_id || pr.head_ref.startsWith(`agent/${p.task_id}/`));
  const open = sameTask.find(pr => pr.state === 'open');
  if (open) return refuse('duplicate_publish', false, { reuse: reuse(open) });
  const merged = sameTask.find(pr => pr.state === 'merged');
  if (merged) return refuse('task_already_merged', false, { reuse: reuse(merged) });
  const closed = sameTask.find(pr => pr.state === 'closed');
  if (closed) return refuse('task_pr_declined', false, { reuse: reuse(closed) });

  if (obs.last_github_response) {
    const g = classifyGithubResponse(obs.last_github_response);
    if (g.kind === 'forbidden') return refuse('github_forbidden', false);
    if (obs.now_ms < g.retry_at_ms) return refuse('github_rate_limited', true, { retry_at: iso(g.retry_at_ms) });
  }

  const paths = intent.files.map(f => f.path);
  const protectedPaths = paths.filter(path => PROTECTED_PATH.test(path));
  if (protectedPaths.length) return refuse('protected_path', false, { paths: protectedPaths });
  const allowed = Array.isArray(inst.allowed_paths) ? inst.allowed_paths : [];
  const outside = paths.filter(path => !allowedBy(allowed, path));
  if (outside.length) return refuse('scope_violation', false, { paths: outside });

  if (typeof obs.base_head_sha !== 'string' || !SHA.test(obs.base_head_sha)) return refuse('base_unknown', true);
  if (obs.base_head_sha !== intent.base_sha) return refuse('base_moved', false);

  const agentFailed = (['tests', 'scan'] as const).filter(k => intent.agent_checks[k] === 'failed');
  if (agentFailed.length) return refuse('agent_checks_failed', false, { checks: agentFailed });
  const agentMissing = (['tests', 'scan'] as const).filter(k => intent.agent_checks[k] !== 'passed');
  if (agentMissing.length) return refuse('agent_checks_missing', false, { checks: agentMissing });

  const cc = obs.candidate_checks;
  if (!cc || !Array.isArray(cc.required) || !cc.required.length) return refuse('required_checks_missing', false);
  const results = cc.results ?? {};
  const failed = cc.required.filter(name => FAILING.has(results[name]));
  if (failed.length) return refuse('required_checks_failed', false, { checks: failed });
  const notReported = cc.required.filter(name => results[name] === undefined);
  if (notReported.length) return refuse('required_checks_missing', true, { checks: notReported });
  const pending = cc.required.filter(name => !PASSING.has(results[name]));
  if (pending.length) return refuse('required_checks_pending', true, { checks: pending });

  const cleared = new Set(obs.coordination_cleared ?? []);
  const others = obs.existing_prs.filter(pr => pr.state === 'open');
  const self = { number: 0, files: paths };
  const overlaps = pairs([self, ...others.map(pr => ({ number: pr.number, files: pr.files }))])
    .filter(pair => (pair.a.number === 0 || pair.b.number === 0) && !cleared.has(pair.a.number === 0 ? pair.b.number : pair.a.number));
  if (overlaps.length) {
    const byNumber = new Map(others.map(pr => [pr.number, pr]));
    const entries = overlaps.map(pair => {
      const other = byNumber.get(pair.a.number === 0 ? pair.b.number : pair.a.number)!;
      return { number: other.number, url: other.url, paths: pair.paths, migration_stamps: pair.migrationStamps };
    }).sort((a, b) => a.number - b.number);
    const cluster = order([self, ...entries.map(e => ({ number: e.number, files: byNumber.get(e.number)!.files }))]);
    return refuse('coordination_required', true, {
      coordination: { with: entries, textual_conflict: 'not checked', suggested_order: cluster.map(c => (c.number === 0 ? 'this' : c.number)) },
    });
  }

  const plan: PullRequestPlan = {
    repository_full_name: inst.repository_full_name,
    base_ref: intent.target_ref,
    expected_base_sha: intent.base_sha,
    head_branch: `agent/${p.task_id}/${p.attempt}`,
    head_ref_condition: 'must_not_exist',
    draft: true,
    title: `agent: ${p.task_id} (attempt ${p.attempt})`,
    body: renderBody(intent, digest, obs.approvals),
    labels: ['agent-authored'],
    intent_digest: digest,
    patch_digest: intent.patch_digest,
    parallel_with: others.map(pr => pr.number).sort((a, b) => a - b),
  };
  return { ok: true, action: 'open_pull_request', plan: Object.freeze(plan) as PullRequestPlan };
}
