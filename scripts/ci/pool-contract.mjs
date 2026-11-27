#!/usr/bin/env node
/**
 * D8072 (#8072): the untrusted pool contract, checked over every workflow under .github/workflows/.
 *
 * A job that a pull request can start (`pull_request`, `pull_request_target` or `merge_group`, after
 * its own `if:` and `needs:` are read) runs code a branch wrote. It must:
 *   - run on a GitHub-hosted label or the `untrusted` runner group, never another self-hosted runner
 *     and never a `runs-on` this check cannot read (an expression);
 *   - declare its token, at the job or the top, and hold no `write` scope (a read-only token);
 *   - hold no `id-token`;
 *   - read no secret: no `secrets.NAME` (the `GITHUB_TOKEN` is the token above), no `secrets[...]`,
 *     no `toJSON(secrets)`, no `secrets:` passed to a reusable workflow;
 *   - name no environment (an environment carries its own secrets).
 *
 * A job that names a deploy environment runs only from a push to main or a `workflow_dispatch`, on a
 * GitHub-hosted label or the `trusted` runner group.
 *
 * A job that genuinely needs one of these on a pull request is an EXCEPTION below, by workflow and
 * job, with what it is allowed, why, and the date it expires. An exception past its date, or one that
 * no longer matches anything, fails the check, so the list only shrinks.
 *
 *   node scripts/ci/pool-contract.mjs [--root DIR] [--today YYYY-MM-DD] [--json]
 *
 * Exit 0 when every job keeps the contract, 1 on a violation, 2 on a bad option.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// CI installs the Worker's YAML parser, not a root or frontend copy (frontend/test/dr_cleanup_7917).
const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const YAML = createRequire(join(REPO, 'cloudflare-worker', 'package.json'))('yaml');

/** The events that run a branch's code. `pull_request_target` is refused outright by WF-4 too. */
export const PR_EVENTS = ['pull_request', 'pull_request_target', 'merge_group'];
/** Runner groups, by name. #8065 records the organisation's groups; these are the names it creates. */
export const UNTRUSTED_GROUPS = ['untrusted'];
export const TRUSTED_GROUPS = ['trusted'];
/** The environments that deploy. Other environments (production-ops, landing-bot…) are #8069's. */
export const DEPLOY_ENVIRONMENTS = ['production', 'preview', 'agent-compute-preview']; // D8069: preview (was pr-preview)
/** GitHub-hosted labels: `ubuntu-24.04`, `ubuntu-latest`, `windows-…`, `macos-…`. */
const HOSTED = /^(ubuntu|windows|macos)-[A-Za-z0-9.-]+$/;

/**
 * The reviewed exceptions. `allow` names violation kinds (see `KINDS`). Each one has an owner issue
 * that removes it; D8072 records them.
 */
export const EXCEPTIONS = [
  {
    workflow: 'ci.yml', job: 'suite', allow: ['write:actions'], expires: '2027-01-31', owner: '#8072',
    reason: 'D7881: in the merge queue one Worker part dispatches macbook-worker.yml and cancels it; a pull_request run never does, but one job serves both events.',
  },
  {
    workflow: 'ci.yml', job: 'digest', allow: ['write:pull-requests'], expires: '2027-01-31', owner: '#8072',
    reason: 'D5502: posts the CI failure digest comment on the failing pull request; it runs only after a failure and reads no secret.',
  },
  {
    workflow: 'landing-policy.yml', job: 'label', allow: ['write:pull-requests'], expires: '2027-01-31', owner: '#8067',
    reason: 'D8067: sets or clears the pr:privileged label from the policy job\'s output; it checks out nothing, runs no repository code, reads no secret and skips forks.',
  },
  {
    workflow: 'codeql.yml', job: 'analyze', allow: ['write:security-events'], expires: '2027-01-31', owner: '#8072',
    reason: 'Uploads the pull request’s CodeQL SARIF so its findings show on the PR (D721); the token can write code-scanning results only.',
  },
  {
    workflow: 'semgrep.yml', job: 'scan', allow: ['write:security-events'], expires: '2027-01-31', owner: '#8072',
    reason: 'Uploads the pull request’s Semgrep SARIF, as CodeQL does; the token can write code-scanning results only.',
  },
  {
    workflow: 'claude-review.yml', job: 'review', allow: ['secret', 'id-token'], expires: '2027-01-31', owner: '#8069',
    reason: 'The model reviewer needs provider keys; it runs only for a same-repository head and takes its reviewer code from the base commit (#6461).',
  },
  {
    workflow: 'claude-review.yml', job: 'alert', allow: ['secret', 'write:issues'], expires: '2027-01-31', owner: '#8069',
    reason: 'Files or updates the reviewer-outage alert and posts it to Slack when the review job failed; it checks out no branch code.',
  },
  {
    workflow: 'pr-preview.yml', job: 'delete-merged-branch', allow: ['write:contents'], expires: '2027-01-31', owner: '#8069',
    reason: 'Deletes the head branch once its pull request merged (`closed` and `merged`); it checks out no branch code.',
  },
  {
    workflow: 'pr-preview-deploy.yml', job: 'deploy', allow: ['deploy-trigger'], expires: '2027-01-31', owner: '#8069',
    reason: 'D7146: the preview is deployed by a reviewed workflow_run workflow from main (WF-4), with a preview-only token.',
  },
  {
    workflow: 'pr-preview-deploy.yml', job: 'delete', allow: ['deploy-trigger'], expires: '2027-01-31', owner: '#8069',
    reason: 'D7146: the same workflow_run workflow deletes the preview when its pull request closes.',
  },
  {
    workflow: 'ci.yml', job: 'capacity-route', allow: ['id-token'], expires: '2027-01-31', owner: '#8626',
    reason: 'D8626: the pinned capacity planner authenticates a merge-queue submission with GitHub OIDC; it runs only under queue routing, from a reviewed main commit, never on a pull request.',
  },
];

/** Every kind a violation can have, with the sentence the table prints. */
export const KINDS = {
  'runs-on-self-hosted': 'runs on a self-hosted runner outside the untrusted group',
  'runs-on-trusted': 'runs in the trusted runner group',
  'runs-on-unreadable': 'its runs-on is an expression this check cannot read',
  'permissions-undeclared': 'declares no permissions, so it gets the repository default token',
  'write-all': 'holds a write-all token',
  'id-token': 'holds an id-token',
  secret: 'reads a secret',
  environment: 'names an environment',
  'deploy-trigger': 'deploys from a trigger other than a push to main or workflow_dispatch',
  'deploy-runner': 'deploys from a runner outside the trusted group or GitHub-hosted labels',
};
const kindText = (k) => KINDS[k] || (k.startsWith('write:') ? `holds ${k.slice(6)}: write` : k);

// ---------------------------------------------------------------- reading a workflow

/** The workflow's events, whatever form `on:` takes. */
export function eventsOf(doc) {
  const on = doc?.on ?? doc?.[true];
  if (!on) return [];
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  return Object.keys(on);
}

const unwrapExpr = (s) => String(s).trim().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1').trim();

/** Split on a top-level operator (`&&` or `||`), outside parentheses and quotes. */
export function splitTop(expr, op) {
  const parts = []; let depth = 0; let quote = null; let start = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (depth === 0 && expr.startsWith(op, i)) { parts.push(expr.slice(start, i).trim()); start = i + op.length; i += op.length - 1; }
  }
  parts.push(expr.slice(start).trim());
  return parts;
}

/** `(a)` → `a` when the parentheses wrap the whole expression. */
function unparen(s) {
  let e = s.trim();
  while (e.startsWith('(') && e.endsWith(')')) {
    let depth = 0; let whole = true;
    for (let i = 0; i < e.length; i += 1) {
      if (e[i] === '(') depth += 1;
      else if (e[i] === ')') { depth -= 1; if (depth === 0 && i < e.length - 1) { whole = false; break; } }
    }
    if (!whole) break;
    e = e.slice(1, -1).trim();
  }
  return e;
}

const EQ = /^github\.event_name\s*==\s*'([^']+)'$/;
const NE = /^github\.event_name\s*!=\s*'([^']+)'$/;
const MAIN = /^github\.ref\s*==\s*'refs\/heads\/main'$/;
const STATUS_FN = /\b(always|failure|cancelled)\s*\(\s*\)/;

/**
 * Narrow `events` (the pull-request events the workflow has) by a job's `if:`. Only what the
 * expression proves is removed; anything it does not prove keeps the event, so a job is never let
 * off by an expression this cannot read.
 */
export function narrowByIf(events, condition) {
  if (condition == null || condition === '') return new Set(events);
  let set = new Set(events);
  for (const raw of splitTop(unwrapExpr(condition), '&&')) {
    const c = unparen(raw);
    let m;
    if ((m = c.match(EQ))) set = new Set([...set].filter((e) => e === m[1]));
    else if ((m = c.match(NE))) set.delete(m[1]);
    // The queue's ref is gh-readonly-queue/…; a merged pull request's `closed` event does run with
    // refs/heads/main (pr-preview.yml's branch delete), so main rules out the queue only.
    else if (MAIN.test(c)) set.delete('merge_group');
    else {
      // A disjunction every branch of which pins the event: `(event == 'a' || event == 'b' && …)`.
      const branches = splitTop(c, '||');
      if (branches.length < 2) continue;
      const pinned = new Set();
      let all = true;
      for (const b of branches) {
        const hit = splitTop(unparen(b), '&&').map(unparen);
        const eq = hit.map((x) => x.match(EQ)).find(Boolean);
        if (!eq) { all = false; break; }
        if (!(eq[1] === 'merge_group' && hit.some((x) => MAIN.test(x)))) pinned.add(eq[1]);
      }
      if (all) set = new Set([...set].filter((e) => pinned.has(e)));
    }
  }
  return set;
}

/** The pull-request events each job of a workflow can run under. */
export function jobEvents(doc, inherited = null) {
  const wfEvents = inherited ?? eventsOf(doc).filter((e) => PR_EVENTS.includes(e));
  const jobs = doc?.jobs || {};
  const memo = new Map();
  const visit = (name, seen = new Set()) => {
    if (memo.has(name)) return memo.get(name);
    if (seen.has(name)) return new Set(wfEvents);
    seen.add(name);
    const job = jobs[name] || {};
    let set = narrowByIf(wfEvents, job.if);
    const needs = [].concat(job.needs || []);
    // Without always(), failure() or cancelled(), a job runs only when every job it needs ran.
    if (needs.length && !STATUS_FN.test(String(job.if ?? ''))) {
      for (const n of needs) { const up = visit(n, seen); set = new Set([...set].filter((e) => up.has(e))); }
    }
    memo.set(name, set);
    return set;
  };
  return Object.fromEntries(Object.keys(jobs).map((n) => [n, visit(n)]));
}

/** True when a job (or a job it must wait for) only runs on main. */
function mainOnly(doc, name, seen = new Set()) {
  if (seen.has(name)) return false;
  seen.add(name);
  const job = doc.jobs?.[name] || {};
  if (job.if != null && splitTop(unwrapExpr(job.if), '&&').map(unparen).some((c) => MAIN.test(c))) return true;
  if (STATUS_FN.test(String(job.if ?? ''))) return false;
  return [].concat(job.needs || []).some((n) => mainOnly(doc, n, seen));
}

/** `ubuntu-latest`, `[self-hosted, linux]`, `{ group, labels }` or an expression. */
export function runnerOf(job) {
  const r = job['runs-on'];
  if (r == null) return job.uses ? { kind: 'reusable' } : { kind: 'unreadable', text: '(none)' };
  if (typeof r === 'string') {
    if (/\$\{\{/.test(r)) return { kind: 'unreadable', text: r };
    if (r === 'self-hosted') return { kind: 'self-hosted', text: r };
    return HOSTED.test(r) ? { kind: 'hosted', text: r } : { kind: 'self-hosted', text: r };
  }
  if (Array.isArray(r)) {
    const labels = r.map(String);
    if (labels.some((l) => /\$\{\{/.test(l))) return { kind: 'unreadable', text: labels.join(',') };
    if (labels.length === 1 && HOSTED.test(labels[0])) return { kind: 'hosted', text: labels[0] };
    return { kind: 'self-hosted', text: labels.join(',') };
  }
  if (typeof r === 'object') {
    const group = r.group == null ? null : String(r.group);
    if (group && /\$\{\{/.test(group)) return { kind: 'unreadable', text: group };
    if (group && UNTRUSTED_GROUPS.includes(group)) return { kind: 'untrusted', text: `group:${group}` };
    if (group && TRUSTED_GROUPS.includes(group)) return { kind: 'trusted', text: `group:${group}` };
    const labels = [].concat(r.labels || []).map(String);
    if (!group && labels.length === 1 && HOSTED.test(labels[0])) return { kind: 'hosted', text: labels[0] };
    return { kind: 'self-hosted', text: group ? `group:${group}` : labels.join(',') };
  }
  return { kind: 'unreadable', text: String(r) };
}

/** The job's effective token: its own `permissions`, else the workflow's. */
export function tokenOf(doc, job) {
  if (job.permissions !== undefined) return job.permissions;
  return doc.permissions;
}

/** Secret reads anywhere in a value: a named secret, `secrets[…]`, `toJSON(secrets)`. */
export function secretReads(value) {
  const text = JSON.stringify(value ?? null);
  const out = new Set();
  for (const m of text.matchAll(/\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) if (m[1] !== 'GITHUB_TOKEN') out.add(`secrets.${m[1]}`);
  if (/\bsecrets\s*\[/.test(text)) out.add('secrets[…]');
  if (/toJSON\s*\(\s*secrets\s*\)/i.test(text)) out.add('toJSON(secrets)');
  return [...out];
}

const envName = (e) => (e == null ? null : typeof e === 'string' ? e : e.name ?? null);

/** Every violation of one job, as kinds. */
export function jobViolations(doc, name, prEvents) {
  const job = doc.jobs[name] || {};
  const out = [];
  if (prEvents.size) {
    const runner = runnerOf(job);
    if (runner.kind === 'self-hosted') out.push('runs-on-self-hosted');
    if (runner.kind === 'trusted') out.push('runs-on-trusted');
    if (runner.kind === 'unreadable') out.push('runs-on-unreadable');
    const token = tokenOf(doc, job);
    if (token === undefined || token === null) out.push('permissions-undeclared');
    else if (token === 'write-all') out.push('write-all');
    else if (typeof token === 'object') {
      for (const [scope, level] of Object.entries(token)) {
        if (String(level) !== 'write') continue;
        out.push(scope === 'id-token' ? 'id-token' : `write:${scope}`);
      }
    }
    const reads = [...secretReads(job), ...secretReads(doc.env)];
    if (job.secrets !== undefined) reads.push(job.secrets === 'inherit' ? 'secrets: inherit' : 'secrets: passed');
    if (reads.length) out.push('secret');
    if (envName(job.environment)) out.push('environment');
  }
  const env = envName(job.environment);
  if (env && DEPLOY_ENVIRONMENTS.includes(env)) {
    const events = eventsOf(doc);
    const on = doc.on ?? doc[true] ?? {};
    const pushBranches = typeof on === 'object' && !Array.isArray(on) ? [].concat(on.push?.branches || []) : [];
    const pushMain = pushBranches.length === 1 && pushBranches[0] === 'main';
    const allowed = events.every((e) => e === 'workflow_dispatch' || (e === 'push' && (pushMain || mainOnly(doc, name))));
    if (!events.length || !allowed) out.push('deploy-trigger');
    const runner = runnerOf(job);
    if (!['hosted', 'trusted'].includes(runner.kind)) out.push('deploy-runner');
  }
  return [...new Set(out)];
}

/** The callers of each local reusable workflow, so its jobs inherit the callers' pull-request events. */
function reusableEvents(docs) {
  const inherited = new Map();
  for (const [file, doc] of Object.entries(docs)) {
    if (!doc?.jobs) continue;
    const events = jobEvents(doc);
    for (const [name, job] of Object.entries(doc.jobs)) {
      const m = typeof job.uses === 'string' && job.uses.match(/^\.\/\.github\/workflows\/([^@]+)$/);
      if (!m || !events[name].size) continue;
      const set = inherited.get(m[1]) || new Set();
      for (const e of events[name]) set.add(e);
      inherited.set(m[1], set);
      if (file === m[1]) continue;
    }
  }
  return inherited;
}

// ---------------------------------------------------------------- the check

/**
 * Check a set of workflows, `{ 'ci.yml': '<yaml text>' }`. `today` is `YYYY-MM-DD`.
 * Returns every row, the violations no exception covers, the exceptions past their date and the
 * exceptions nothing needs any more.
 */
export function checkWorkflows(sources, { today, exceptions = EXCEPTIONS } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today))) throw new Error(`today must be YYYY-MM-DD, got ${today}`);
  const docs = {};
  const rows = [];
  const violations = [];
  for (const [file, text] of Object.entries(sources)) {
    try { docs[file] = YAML.parse(text); }
    catch (error) { violations.push({ workflow: file, job: '(file)', kind: 'unparseable', text: `cannot be read: ${error.message}` }); }
  }
  const called = reusableEvents(docs);
  const used = new Set();
  const expired = [];
  for (const [file, doc] of Object.entries(docs)) {
    if (!doc?.jobs) continue;
    const callers = called.get(file);
    const events = jobEvents(doc, callers && eventsOf(doc).includes('workflow_call')
      ? [...new Set([...eventsOf(doc).filter((e) => PR_EVENTS.includes(e)), ...callers])]
      : null);
    for (const name of Object.keys(doc.jobs)) {
      const kinds = jobViolations(doc, name, events[name]);
      const env = envName(doc.jobs[name].environment);
      if (!events[name].size && !(env && DEPLOY_ENVIRONMENTS.includes(env))) continue;
      const runner = runnerOf(doc.jobs[name]);
      const row = { workflow: file, job: name, events: [...events[name]], runner: runner.text ?? runner.kind, kinds, excepted: [] };
      for (const kind of kinds) {
        const ex = exceptions.find((x) => x.workflow === file && x.job === name && x.allow.includes(kind));
        if (ex) {
          used.add(ex);
          row.excepted.push(kind);
          if (ex.expires < today) expired.push({ ...ex, kind });
        } else violations.push({ workflow: file, job: name, kind, text: kindText(kind) });
      }
      rows.push(row);
    }
  }
  const stale = exceptions.filter((ex) => !used.has(ex));
  return { rows, violations, expired, stale, ok: !violations.length && !expired.length && !stale.length };
}

/** Every workflow file under `root/.github/workflows`. */
export function readWorkflows(root = REPO) {
  const dir = join(root, '.github', 'workflows');
  return Object.fromEntries(readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
}

/** The date of the commit under test, so an exception expires with the code, not the wall clock. */
export function commitDate(root = REPO) {
  try { return execFileSync('git', ['-C', root, 'log', '-1', '--format=%cs'], { encoding: 'utf8' }).trim(); }
  catch { return new Date().toISOString().slice(0, 10); }
}

/** The table the command prints. */
export function formatReport(result) {
  const lines = ['| Workflow | Job | Pull-request events | Runner | Result |', '| --- | --- | --- | --- | --- |'];
  for (const r of result.rows) {
    const open = r.kinds.filter((k) => !r.excepted.includes(k));
    const result_ = open.length ? `VIOLATION: ${open.map(kindText).join('; ')}`
      : r.excepted.length ? `exception: ${r.excepted.map(kindText).join('; ')}` : 'ok';
    lines.push(`| ${r.workflow} | ${r.job} | ${r.events.join(', ') || '—'} | ${r.runner} | ${result_} |`);
  }
  for (const v of result.violations.filter((x) => x.kind === 'unparseable')) lines.push(`| ${v.workflow} | — | — | — | VIOLATION: ${v.text} |`);
  for (const e of result.expired) lines.push(`\nEXPIRED exception: ${e.workflow} › ${e.job} (${e.kind}) expired ${e.expires}; ${e.owner} removes it.`);
  for (const e of result.stale) lines.push(`\nSTALE exception: ${e.workflow} › ${e.job} (${e.allow.join(', ')}) matches no violation; delete it.`);
  lines.push('', result.ok ? 'pool contract: ok' : `pool contract: ${result.violations.length} violation(s), ${result.expired.length} expired, ${result.stale.length} stale`);
  return lines.join('\n');
}

function main(argv) {
  let root = REPO; let today = null; let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--root') root = resolve(argv[++i] ?? '');
    else if (a === '--today') today = argv[++i];
    else if (a === '--json') json = true;
    else { console.error(`pool-contract: unknown option ${a}`); return 2; }
  }
  if (today != null && !/^\d{4}-\d{2}-\d{2}$/.test(today)) { console.error('pool-contract: --today takes YYYY-MM-DD'); return 2; }
  const result = checkWorkflows(readWorkflows(root), { today: today ?? commitDate(root) });
  console.log(json ? JSON.stringify(result, null, 2) : formatReport(result));
  return result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
