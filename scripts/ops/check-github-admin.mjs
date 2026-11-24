#!/usr/bin/env node
/**
 * D8082 (#8082): the admin baseline as code. Reads the expected GitHub settings
 * from `documentation/operations/GITHUB_ADMIN_BASELINE.md`, reads the live ones
 * through REST GETs only, prints the diff and, with `--file-issues`, files or
 * updates one `slot:chatgptpro` issue per drifted setting.
 *
 *   node scripts/ops/check-github-admin.mjs [--baseline <file>] [--report <file>]
 *     reads with ADMIN_DRIFT_READ_TOKEN (a fine-grained read-only token); exit 0 no
 *     drift, 2 drift, 1 the check could not run (missing or insufficient token, an
 *     unreadable baseline row) — never "no drift" when nothing was read.
 *   node scripts/ops/check-github-admin.mjs --file-issues
 *     reads the report from ADMIN_DRIFT_REPORT and writes issues with GH_TOKEN.
 *
 * The reading half has no write method at all; the issue half never touches a setting.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE = 'documentation/operations/GITHUB_ADMIN_BASELINE.md';
export const TOKEN_ENV = 'ADMIN_DRIFT_READ_TOKEN';
export const TO_BE_RECORDED = 'to be recorded';
export const UNREADABLE = 'unreadable';
export const ISSUE_LABELS = Object.freeze(['slot:chatgptpro', 'state:ready']);
export const BOT_LOGIN = 'github-actions[bot]';
const MARKER = /<!-- studioos-admin-drift:v1 (\{[^\n]*?\}) -->/;
const API = 'https://api.github.com';
const PER_PAGE = 100;
const MAX_PAGES = 20;

/** Which section each key kind belongs to; a row with any other kind is a baseline error. */
export const SECTIONS = Object.freeze({
  ruleset: 'Rulesets', rulesets: 'Rulesets',
  repo: 'Repository settings',
  actions: 'Actions',
  org: 'Organisation',
  environment: 'Environments', environments: 'Environments',
  app: 'GitHub Apps', apps: 'GitHub Apps',
  runner_group: 'Runner groups', runner_groups: 'Runner groups',
  cloud: 'Cloud',
});
const KEY = /^([a-z_]+)(?:\[([^\]\n`|]{1,80})\])?((?:\.[a-z_]+)+)$/;

export class CheckError extends Error {}

/** One canonical string per value: lists sorted and comma-joined, so order never reads as drift. */
export function normalize(value) {
  const text = String(value ?? '').trim();
  if (!text.includes(',')) return text;
  return text.split(',').map(part => part.trim()).filter(Boolean).sort().join(', ');
}
const list = items => (items.length ? normalize(items.join(', ')) : 'none');

export function parseKey(key) {
  const match = KEY.exec(key);
  if (!match || !Object.hasOwn(SECTIONS, match[1])) return null;
  return { kind: match[1], name: match[2] ?? null, field: match[3].slice(1), section: SECTIONS[match[1]] };
}

/**
 * The baseline's rows: every table row whose first cell is a backticked key. The second
 * cell is the expected value, backticked, or the words "to be recorded".
 */
export function parseBaseline(markdown) {
  const rows = [];
  const errors = [];
  const seen = new Set();
  for (const [index, line] of String(markdown).split('\n').entries()) {
    const cells = /^\|\s*`([^`]+)`\s*\|([^|]*)\|/.exec(line);
    if (!cells) continue;
    const [, key, rawExpected] = cells;
    const parsed = parseKey(key);
    if (!parsed) { errors.push(`line ${index + 1}: unknown setting key \`${key}\``); continue; }
    if (seen.has(key)) { errors.push(`line ${index + 1}: \`${key}\` is listed twice`); continue; }
    seen.add(key);
    const cell = rawExpected.trim();
    const quoted = /^`([^`]*)`$/.exec(cell);
    let expected;
    if (quoted) expected = normalize(quoted[1]);
    else if (cell.replace(/[_*]/g, '').trim().toLowerCase() === TO_BE_RECORDED) expected = null;
    else { errors.push(`line ${index + 1}: \`${key}\` expected value must be backticked or "${TO_BE_RECORDED}"`); continue; }
    rows.push({ key, ...parsed, expected, line: index + 1 });
  }
  if (!rows.length) errors.push('the baseline has no setting rows');
  return { rows, errors };
}

// ── Reading the live values (GET only) ─────────────────────────────────────

/** A GET-only client. There is deliberately no other method on it. */
export function makeReader({ token, fetchImpl = globalThis.fetch, base = API }) {
  if (!token) throw new CheckError(`${TOKEN_ENV} is not set: the check cannot read the admin settings, so it reports nothing instead of "no drift". Provision the read-only token in the production-ops environment.`);
  return {
    async get(path) {
      const response = await fetchImpl(base + path, {
        method: 'GET',
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'studioos-admin-drift' },
      });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return { status: response.status, body };
    },
  };
}

class SectionUnreadable extends Error {
  constructor(path, status) { super(`GET ${path} returned ${status}`); this.status = status; }
}

async function getOk(reader, path) {
  const { status, body } = await reader.get(path);
  if (status === 401) throw new CheckError(`GET ${path} returned 401: the read-only token is invalid or expired. Rotate ${TOKEN_ENV} in production-ops.`);
  if (status !== 200) throw new SectionUnreadable(path, status);
  return body;
}

async function getAll(reader, path, field) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const join = path.includes('?') ? '&' : '?';
    const body = await getOk(reader, `${path}${join}per_page=${PER_PAGE}&page=${page}`);
    const items = field ? body?.[field] : body;
    if (!Array.isArray(items)) throw new SectionUnreadable(path, 'an unexpected body');
    out.push(...items);
    if (items.length < PER_PAGE) return out;
  }
  throw new CheckError(`GET ${path}: more than ${MAX_PAGES} pages`);
}

const bool = value => (typeof value === 'boolean' ? String(value) : UNREADABLE);
const field = value => (value === undefined || value === null ? UNREADABLE : String(value));

/** Reads one section; a 403/404 marks every key of the section unreadable with the reason. */
async function section(live, name, read) {
  try {
    await read();
  } catch (error) {
    if (!(error instanceof SectionUnreadable)) throw error;
    live.unreadable.set(name, error.message);
  }
}

export async function readLive({ reader, repository }) {
  const [owner] = repository.split('/');
  const repo = `/repos/${repository}`;
  const live = { values: new Map(), entities: new Map(), unreadable: new Map() };
  const set = (key, value) => live.values.set(key, normalize(value));
  const entity = (kind, names) => live.entities.set(kind, new Set(names));

  // The probe: actions/permissions needs administration:read, so a token without it fails closed here.
  let actions;
  try {
    actions = await getOk(reader, `${repo}/actions/permissions`);
  } catch (error) {
    if (error instanceof SectionUnreadable) {
      throw new CheckError(`${error.message}: the token cannot read repository administration settings. ${TOKEN_ENV} needs "Administration: read" on this repository; nothing was checked.`);
    }
    throw error;
  }

  await section(live, 'Actions', async () => {
    set('actions.enabled', bool(actions?.enabled));
    set('actions.allowed_actions', field(actions?.allowed_actions));
    if (actions?.sha_pinning_required !== undefined) set('actions.sha_pinning_required', bool(actions.sha_pinning_required));
    if (actions?.allowed_actions === 'selected') {
      const selected = await getOk(reader, `${repo}/actions/permissions/selected-actions`);
      set('actions.selected.github_owned_allowed', bool(selected?.github_owned_allowed));
      set('actions.selected.verified_allowed', bool(selected?.verified_allowed));
      set('actions.selected.patterns_allowed', Array.isArray(selected?.patterns_allowed) ? list(selected.patterns_allowed) : UNREADABLE);
    } else {
      for (const key of ['github_owned_allowed', 'verified_allowed', 'patterns_allowed']) set(`actions.selected.${key}`, 'n/a');
    }
    const workflow = await getOk(reader, `${repo}/actions/permissions/workflow`);
    set('actions.workflow.default_permissions', field(workflow?.default_workflow_permissions));
    set('actions.workflow.can_approve_pull_request_reviews', bool(workflow?.can_approve_pull_request_reviews));
    try {
      const fork = await getOk(reader, `${repo}/actions/permissions/fork-pr-contributor-approval`);
      set('actions.fork_pr_approval', field(fork?.approval_policy));
    } catch (error) {
      if (!(error instanceof SectionUnreadable)) throw error;
      set('actions.fork_pr_approval', UNREADABLE);
    }
  });

  await section(live, 'Repository settings', async () => {
    const data = await getOk(reader, repo);
    for (const key of ['allow_auto_merge', 'allow_update_branch', 'delete_branch_on_merge', 'has_wiki', 'has_discussions',
      'allow_squash_merge', 'allow_merge_commit', 'allow_rebase_merge']) set(`repo.${key}`, bool(data?.[key]));
    const security = data?.security_and_analysis;
    set('repo.secret_scanning', field(security?.secret_scanning?.status));
    set('repo.secret_scanning_push_protection', field(security?.secret_scanning_push_protection?.status));
    set('repo.dependabot_security_updates', field(security?.dependabot_security_updates?.status));
    try {
      const pvr = await getOk(reader, `${repo}/private-vulnerability-reporting`);
      set('repo.private_vulnerability_reporting', bool(pvr?.enabled));
    } catch (error) {
      if (!(error instanceof SectionUnreadable)) throw error;
      set('repo.private_vulnerability_reporting', UNREADABLE);
    }
  });

  await section(live, 'Rulesets', async () => {
    const summaries = await getAll(reader, `${repo}/rulesets?includes_parents=true`);
    entity('ruleset', summaries.map(s => s.name));
    set('rulesets.names', list(summaries.map(s => s.name)));
    for (const summary of summaries) {
      const r = await getOk(reader, `${repo}/rulesets/${encodeURIComponent(summary.id)}`);
      const k = `ruleset[${summary.name}]`;
      const rules = Array.isArray(r?.rules) ? r.rules : [];
      const rule = type => rules.find(x => x?.type === type)?.parameters;
      set(`${k}.enforcement`, field(r?.enforcement));
      set(`${k}.target`, field(r?.target));
      set(`${k}.include`, list(r?.conditions?.ref_name?.include ?? []));
      set(`${k}.exclude`, list(r?.conditions?.ref_name?.exclude ?? []));
      // Bypass actors are visible only to an admin reader; ids are never kept, only type and mode.
      set(`${k}.bypass_actors`, Array.isArray(r?.bypass_actors) ? list(r.bypass_actors.map(a => `${a.actor_type}:${a.bypass_mode}`)) : UNREADABLE);
      set(`${k}.rules`, list(rules.map(x => x?.type).filter(Boolean)));
      const checks = rule('required_status_checks');
      set(`${k}.required_status_checks`, checks ? list((checks.required_status_checks ?? []).map(c => c.context)) : 'none');
      set(`${k}.strict_required_status_checks`, checks ? bool(checks.strict_required_status_checks_policy) : 'n/a');
      const pr = rule('pull_request');
      set(`${k}.pull_request.required_approving_review_count`, pr ? field(pr.required_approving_review_count) : 'n/a');
      set(`${k}.pull_request.require_code_owner_review`, pr ? bool(pr.require_code_owner_review) : 'n/a');
      set(`${k}.pull_request.dismiss_stale_reviews_on_push`, pr ? bool(pr.dismiss_stale_reviews_on_push) : 'n/a');
      set(`${k}.pull_request.require_last_push_approval`, pr ? bool(pr.require_last_push_approval) : 'n/a');
      const queue = rule('merge_queue');
      set(`${k}.merge_queue.merge_method`, queue ? field(queue.merge_method) : 'n/a');
      set(`${k}.merge_queue.max_entries_to_merge`, queue ? field(queue.max_entries_to_merge) : 'n/a');
      set(`${k}.merge_queue.grouping_strategy`, queue ? field(queue.grouping_strategy) : 'n/a');
      const paths = rule('file_path_restriction');
      set(`${k}.file_paths`, paths ? list(paths.restricted_file_paths ?? []) : 'none');
    }
  });

  await section(live, 'Environments', async () => {
    const environments = await getAll(reader, `${repo}/environments`, 'environments');
    // A stored name can carry invisible whitespace (PRODUCTION_CREDENTIALS.md); keys use the trimmed name.
    const clean = name => String(name).trim();
    entity('environment', environments.map(e => clean(e.name)));
    set('environments.names', list(environments.map(e => clean(e.name))));
    for (const env of environments) {
      const name = clean(env.name);
      const k = `environment[${name}]`;
      const path = `${repo}/environments/${encodeURIComponent(env.name)}`;
      set(`${k}.name_exact`, String(env.name === name));
      const rules = Array.isArray(env.protection_rules) ? env.protection_rules : [];
      const reviewers = rules.find(r => r?.type === 'required_reviewers');
      set(`${k}.required_reviewers`, String(reviewers?.reviewers?.length ?? 0));
      set(`${k}.reviewer_types`, list((reviewers?.reviewers ?? []).map(r => r.type)));
      set(`${k}.prevent_self_review`, reviewers ? bool(reviewers.prevent_self_review) : 'n/a');
      set(`${k}.wait_timer`, String(rules.find(r => r?.type === 'wait_timer')?.wait_timer ?? 0));
      const policy = env.deployment_branch_policy;
      const mode = !policy ? 'all' : policy.protected_branches ? 'protected' : policy.custom_branch_policies ? 'custom' : UNREADABLE;
      set(`${k}.branch_policy`, mode);
      if (mode === 'custom') {
        const policies = await getAll(reader, `${path}/deployment-branch-policies`, 'branch_policies');
        set(`${k}.branch_policies`, list(policies.map(p => `${p.name} (${p.type ?? 'branch'})`)));
      } else {
        set(`${k}.branch_policies`, 'n/a');
      }
      for (const [kind, key] of [['secrets', 'secret_names'], ['variables', 'variable_names']]) {
        try {
          const items = await getAll(reader, `${path}/${kind}`, kind);
          set(`${k}.${key}`, list(items.map(i => i.name)));
        } catch (error) {
          if (!(error instanceof SectionUnreadable)) throw error;
          set(`${k}.${key}`, UNREADABLE);
        }
      }
    }
  });

  await section(live, 'Organisation', async () => {
    const org = await getOk(reader, `/orgs/${owner}`);
    set('org.two_factor_requirement_enabled', bool(org?.two_factor_requirement_enabled));
    set('org.default_repository_permission', field(org?.default_repository_permission));
    set('org.members_can_create_public_repositories', bool(org?.members_can_create_public_repositories));
    set('org.members_can_create_private_repositories', bool(org?.members_can_create_private_repositories));
  });

  await section(live, 'GitHub Apps', async () => {
    const installations = await getAll(reader, `/orgs/${owner}/installations`, 'installations');
    entity('app', installations.map(i => i.app_slug));
    set('apps.installed', list(installations.map(i => i.app_slug)));
    for (const installation of installations) {
      const k = `app[${installation.app_slug}]`;
      set(`${k}.installed`, 'true');
      set(`${k}.repository_selection`, field(installation.repository_selection));
      set(`${k}.permissions`, list(Object.entries(installation.permissions ?? {}).map(([p, a]) => `${p}:${a}`)));
      set(`${k}.events`, list(installation.events ?? []));
    }
  });

  await section(live, 'Runner groups', async () => {
    const groups = await getAll(reader, `/orgs/${owner}/actions/runner-groups`, 'runner_groups');
    entity('runner_group', groups.map(g => g.name));
    set('runner_groups.names', list(groups.map(g => g.name)));
    for (const group of groups) {
      const k = `runner_group[${group.name}]`;
      set(`${k}.visibility`, field(group.visibility));
      set(`${k}.allows_public_repositories`, bool(group.allows_public_repositories));
      set(`${k}.restricted_to_workflows`, bool(group.restricted_to_workflows));
      set(`${k}.selected_workflows`, list(group.selected_workflows ?? []));
      if (group.visibility === 'selected') {
        const repos = await getAll(reader, `/orgs/${owner}/actions/runner-groups/${encodeURIComponent(group.id)}/repositories`, 'repositories');
        set(`${k}.repository_count`, String(repos.length));
        set(`${k}.includes_this_repository`, String(repos.some(r => r.full_name === repository)));
      } else {
        set(`${k}.repository_count`, group.visibility === 'all' ? 'all' : UNREADABLE);
        set(`${k}.includes_this_repository`, group.visibility === 'all' ? 'true' : UNREADABLE);
      }
    }
  });

  return live;
}

/** The live value of one baseline row: read, absent (the named thing does not exist), or unreadable. */
function liveValueOf(row, live) {
  if (live.unreadable.has(row.section)) return UNREADABLE;
  if (live.values.has(row.key)) return live.values.get(row.key);
  if (row.name !== null) {
    const names = live.entities.get(row.kind);
    if (names && !names.has(row.name)) return 'absent';
  }
  return UNREADABLE;
}

/**
 * Each row's status: `match`, `drift`, `to-be-recorded` (never flagged), `not-checked`
 * (Cloud: no read-only credential), or `unreadable` (fails the check when a value is expected).
 */
export function diffBaseline(rows, live) {
  const results = rows.map(row => {
    const base = { key: row.key, section: row.section, expected: row.expected };
    if (row.kind === 'cloud') return { ...base, live: null, status: 'not-checked' };
    const value = liveValueOf(row, live);
    if (row.expected === null) return { ...base, live: value, status: 'to-be-recorded' };
    if (value === UNREADABLE) return { ...base, live: value, status: 'unreadable' };
    return { ...base, live: value, status: normalize(value) === row.expected ? 'match' : 'drift' };
  });
  const failures = results.filter(r => r.status === 'unreadable')
    .map(r => `${r.key}: expected \`${r.expected}\` but the token cannot read it${live.unreadable.has(r.section) ? ` (${live.unreadable.get(r.section)})` : ''}`);
  return { results, failures };
}

// ── Never publish a secret, a token, an id or a host ──────────────────────

const WITHHELD = '[withheld: looks like a secret, an id or a host]';
const SECRET_LIKE = [
  /gh[pousr]_[A-Za-z0-9]{16,}/, /github_pat_/i, /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, /eyJ[A-Za-z0-9_-]{8,}\./,
  /-----BEGIN/, /\bxox[abprs]-/, /\bsk-[A-Za-z0-9_-]{16,}/,
  /(?<![@A-Za-z0-9])[0-9a-f]{32,}(?![A-Za-z0-9])/i, // a 32-hex account id or a key; a commit SHA after `@` is a pin, not a secret
  /(?<![@A-Za-z0-9+/])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/])/, // a long base64 blob
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, // a tenant or subscription id
  /(?<![\w.])\d{7,}(?![\w.])/, // an account, installation or environment id
  /:\/\//, /\b(?:\d{1,3}\.){3}\d{1,3}\b/, /\.(?:internal|local|lan|corp|intranet)\b/i,
];
export const looksSecret = value => SECRET_LIKE.some(pattern => pattern.test(String(value)));
/** A value fit for an issue: never secret-shaped, and unable to break out of its code span or table cell. */
export function safeValue(value) {
  if (value === null || value === undefined) return '—';
  const text = String(value);
  if (looksSecret(text)) return WITHHELD;
  return text.replace(/[`<>|\r\n]/g, ' ').slice(0, 300);
}

export function renderTable(results) {
  const lines = ['| Setting | Section | Baseline | Live | Status |', '| --- | --- | --- | --- | --- |'];
  for (const r of results) {
    lines.push(`| \`${safeValue(r.key)}\` | ${r.section} | ${r.expected === null ? TO_BE_RECORDED : `\`${safeValue(r.expected)}\``} | ${r.live === null ? 'not checked' : `\`${safeValue(r.live)}\``} | ${r.status} |`);
  }
  return lines.join('\n');
}

// ── Filing one issue per drift key ─────────────────────────────────────────

const markerOf = body => {
  const found = MARKER.exec(String(body ?? ''));
  if (!found) return null;
  try {
    const value = JSON.parse(found[1]);
    return typeof value?.key === 'string' ? value : null;
  } catch { return null; }
};

export function issueTitle(key) {
  return `[admin drift] ${safeValue(key)}`.slice(0, 200);
}

export function issueBody(result, { date, runUrl }) {
  const state = { key: safeValue(result.key), expected: safeValue(result.expected), live: safeValue(result.live), resolved: result.status === 'match' };
  return [
    `**Admin drift (D8082).** A live GitHub setting differs from \`${BASELINE}\` on \`main\`.`,
    '',
    '| Setting | Section | Baseline | Live |',
    '| --- | --- | --- | --- |',
    `| \`${state.key}\` | ${result.section} | \`${state.expected}\` | \`${state.live}\` |`,
    '',
    `Last checked ${date}${runUrl ? ` by [the admin drift run](${runUrl})` : ''}.${state.resolved ? ' **The live value matches the baseline again.**' : ''}`,
    '',
    '**For `slot:chatgptpro`.** Either set the console value back to the baseline and post the STATUS (names and values only), or, if the live value is the intended one, ask a coding slot to change the baseline row in a pull request. This issue was filed by a read-only check; it changed no setting.',
    '',
    `<!-- studioos-admin-drift:v1 ${JSON.stringify(state)} -->`,
  ].join('\n');
}

async function existingIssues(client, repository) {
  const found = new Map();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = await client.request('GET', `/repos/${repository}/issues?state=all&labels=${encodeURIComponent(ISSUE_LABELS[0])}&per_page=${PER_PAGE}&page=${page}`);
    if (!Array.isArray(items)) throw new CheckError('cannot list the admin slot issues');
    for (const issue of items) {
      if (issue.pull_request || issue.user?.login !== BOT_LOGIN) continue;
      const marker = markerOf(issue.body);
      if (!marker) continue;
      const held = found.get(marker.key);
      if (!held || issue.number < held.issue.number) found.set(marker.key, { issue, marker });
    }
    if (items.length < PER_PAGE) break;
  }
  return found;
}

/**
 * One issue per drift key: a new drift opens one; a repeat updates its body (and comments only
 * when the live value changed, or the drift came back); a resolved drift is noted once and left
 * open for the admin slot to close. Returns the actions taken.
 */
export async function syncDriftIssues({ client, repository, results, date, runUrl = null }) {
  const actions = [];
  const existing = await existingIssues(client, repository);
  for (const result of results) {
    const key = safeValue(result.key);
    const held = existing.get(key);
    if (result.status === 'drift') {
      const body = issueBody(result, { date, runUrl });
      if (!held) {
        const issue = await client.request('POST', `/repos/${repository}/issues`, { title: issueTitle(result.key), body, labels: [...ISSUE_LABELS] });
        actions.push({ key, action: 'opened', number: issue?.number ?? null });
        continue;
      }
      const reopened = held.issue.state === 'closed';
      await client.request('PATCH', `/repos/${repository}/issues/${held.issue.number}`, reopened ? { body, state: 'open' } : { body });
      const live = safeValue(result.live);
      let note = null;
      if (reopened || held.marker.resolved) note = `The drift is back on ${date}: live \`${live}\`, baseline \`${safeValue(result.expected)}\`.`;
      else if (held.marker.live !== live || held.marker.expected !== safeValue(result.expected)) note = `The values changed on ${date}: live \`${live}\` (was \`${safeValue(held.marker.live)}\`), baseline \`${safeValue(result.expected)}\`.`;
      if (note) await client.request('POST', `/repos/${repository}/issues/${held.issue.number}/comments`, { body: note });
      actions.push({ key, action: reopened ? 'reopened' : note ? 'updated-and-noted' : 'updated', number: held.issue.number });
    } else if (result.status === 'match' && held && held.issue.state === 'open' && !held.marker.resolved) {
      await client.request('PATCH', `/repos/${repository}/issues/${held.issue.number}`, { body: issueBody(result, { date, runUrl }) });
      await client.request('POST', `/repos/${repository}/issues/${held.issue.number}/comments`, {
        body: `Resolved on ${date}: the live value matches the baseline (\`${safeValue(result.expected)}\`). Left open for \`slot:chatgptpro\` to confirm and close.`,
      });
      actions.push({ key, action: 'noted-resolved', number: held.issue.number });
    }
  }
  return actions;
}

export function makeIssueClient({ token, fetchImpl = globalThis.fetch, base = API }) {
  if (!token) throw new CheckError('GH_TOKEN is not set: cannot file the drift issues.');
  return {
    async request(method, path, body) {
      const response = await fetchImpl(base + path, {
        method,
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'studioos-admin-drift', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status < 200 || response.status > 299) throw new CheckError(`${method} ${path.split('?')[0]} returned ${response.status}`);
      return response.status === 204 ? null : response.json();
    },
  };
}

// ── The command line ───────────────────────────────────────────────────────

/** A report another job may read: names, expected and live values only, each re-sanitized. */
export function toReport(results) {
  return { schema: 1, results: results.map(r => ({ key: safeValue(r.key), section: r.section, expected: r.expected === null ? null : safeValue(r.expected), live: r.live === null ? null : safeValue(r.live), status: r.status })) };
}

export function fromReport(text) {
  const report = JSON.parse(text);
  const statuses = new Set(['match', 'drift', 'to-be-recorded', 'not-checked', 'unreadable']);
  if (report?.schema !== 1 || !Array.isArray(report.results) || !report.results.every(r => typeof r?.key === 'string' && statuses.has(r.status))) {
    throw new CheckError('the drift report is malformed');
  }
  return report.results;
}

export async function checkCommand({ baselineText, reader, repository, log = console.log }) {
  const { rows, errors } = parseBaseline(baselineText);
  if (errors.length) throw new CheckError(`the baseline cannot be read:\n${errors.join('\n')}`);
  const live = await readLive({ reader, repository });
  const { results, failures } = diffBaseline(rows, live);
  log(renderTable(results));
  for (const [name, reason] of live.unreadable) log(`section ${name}: unreadable with this token (${reason})`);
  if (failures.length) throw new CheckError(`cannot check ${failures.length} expected setting(s); failing closed:\n${failures.join('\n')}`);
  const drift = results.filter(r => r.status === 'drift');
  log(drift.length ? `${drift.length} setting(s) drifted from the baseline.` : `no drift: ${results.filter(r => r.status === 'match').length} matched, ${results.filter(r => r.status === 'to-be-recorded').length} to be recorded, ${results.filter(r => r.status === 'not-checked').length} not checked.`);
  return { results, drift: drift.length };
}

async function main(argv) {
  const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const repository = process.env.GITHUB_REPOSITORY || 'AxalNetwork/StudioOS';
  if (argv.includes('--file-issues')) {
    const results = fromReport(process.env.ADMIN_DRIFT_REPORT || '');
    const client = makeIssueClient({ token: process.env.GH_TOKEN });
    const runUrl = /^\d+$/.test(process.env.GITHUB_RUN_ID || '') ? `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
    const actions = await syncDriftIssues({ client, repository, results, date: new Date().toISOString().slice(0, 10), runUrl });
    for (const a of actions) console.log(`${a.action}: #${a.number} ${a.key}`);
    if (!actions.length) console.log('no issue to file or update');
    return 0;
  }
  const baselineText = readFileSync(arg('--baseline') ?? BASELINE, 'utf8');
  const reader = makeReader({ token: process.env[TOKEN_ENV] });
  const { results, drift } = await checkCommand({ baselineText, reader, repository });
  const out = arg('--report');
  if (out) writeFileSync(out, JSON.stringify(toReport(results)));
  return drift ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.error(`✖ admin drift: ${error instanceof CheckError ? error.message : error?.stack || error}`);
    process.exitCode = 1;
  });
}
