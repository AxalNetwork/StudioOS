/**
 * D8505 (#8505) — claude-code.yml decides who may start a run in a read-only job, and only the model job
 * gets the token it needs. Beside workflow_security_4571 (SC-02 keeps the author_association first filter).
 *
 *   · each job's permissions, exactly: widening one fails here;
 *   · the model job runs only on the admit job's `admitted == 'true'`, after a head check, with no checkout credential;
 *   · the admission script's refusal path, as dry runs of `--fixture`: nothing is read from the network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { SUMMARY_LINES, decide, headStillAdmitted, parseAllowlist, requestOf, safeLine, summaryLine } from '../../scripts/lib/claudeCodeAdmission.mjs';

const ROOT = new URL('../../', import.meta.url);
const WF = parse(readFileSync(new URL('.github/workflows/claude-code.yml', ROOT), 'utf8'));
const CLI = new URL('scripts/claude-code-admission.mjs', ROOT).pathname;

const REPO = 'AxalNetwork/StudioOS';
const HEAD = 'a'.repeat(40);
const MOVED = 'b'.repeat(40);
const MAIN = 'c'.repeat(40);
const repository = { full_name: REPO };

const comment = (login, { pr = true, body = '@claude please look', sender = login } = {}) => ({
  eventName: 'issue_comment', repository: REPO, ref: 'refs/heads/main', sha: MAIN,
  event: { repository, sender: { login: sender }, issue: { number: 42, ...(pr ? { pull_request: { url: 'x' } } : {}) }, comment: { body, user: { login } } },
});
const review = (login, eventHead) => ({
  eventName: 'pull_request_review', repository: REPO, ref: 'refs/heads/main', sha: MAIN,
  event: { repository, sender: { login }, pull_request: { number: 42, head: { sha: eventHead } }, review: { body: '@claude fix it', user: { login } } },
});

function dryRun(fixture) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-admit-'));
  try {
    const file = join(dir, 'fixture.json');
    writeFileSync(file, JSON.stringify(fixture));
    const env = { PATH: process.env.PATH }; // no token, no GITHUB_OUTPUT: a dry run cannot reach the network
    const r = spawnSync(process.execPath, [CLI, '--fixture', file], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('each job states its own permissions, and only these: the admit job reads, the model job reads and asks for an OIDC token', () => {
  // Mutation checked: `issues: write` added to the claude job; `contents: write` put back at the top.
  assert.deepEqual(WF.permissions, {}, 'no token by default');
  assert.deepEqual(Object.keys(WF.jobs), ['admit', 'claude'], 'a new job states its permissions here first');
  assert.deepEqual(WF.jobs.admit.permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.deepEqual(WF.jobs.claude.permissions, { contents: 'read', 'pull-requests': 'read', 'id-token': 'write' });
  for (const [id, job] of Object.entries(WF.jobs)) {
    const writes = Object.entries(job.permissions).filter(([k, v]) => v === 'write' && k !== 'id-token');
    assert.deepEqual(writes, [], `${id}: no write scope on GITHUB_TOKEN`);
  }
});

test('the admit job decides before anything else: it carries the SC-02 filter, no model step and no federation', () => {
  const admit = WF.jobs.admit;
  assert.match(admit.if, /author_association/, 'the first filter stays (#4571 SC-02)');
  assert.equal(admit.needs, undefined);
  const uses = admit.steps.map((s) => s.uses).filter(Boolean);
  assert.ok(uses.every((u) => u.startsWith('actions/checkout@')), 'no action but the checkout');
  assert.doesNotMatch(JSON.stringify(admit), /CLAUDE_CODE_FEDERATION|anthropic|id-token/i);
  const decideStep = admit.steps.find((s) => s.id === 'decide');
  assert.equal(decideStep.run, 'node scripts/claude-code-admission.mjs');
  for (const k of ['admitted', 'reason', 'kind', 'number', 'head_sha', 'repository']) {
    assert.equal(admit.outputs[k], `\${{ steps.decide.outputs.${k} }}`, `output ${k}`);
  }
});

test('the model job starts only on an admitted, same-repository request, checks the head first, and keeps no credential', () => {
  // Mutation checked: the `admitted == 'true'` condition dropped; the head check moved after the action.
  const job = WF.jobs.claude;
  assert.equal(job.needs, 'admit');
  assert.match(job.if, /^needs\.admit\.outputs\.admitted == 'true' && needs\.admit\.outputs\.repository == github\.repository$/);
  const names = job.steps.map((s) => s.name ?? s.uses);
  const head = names.indexOf('Head still at the admitted commit');
  const action = job.steps.findIndex((s) => String(s.uses).startsWith('anthropics/claude-code-action@'));
  assert.ok(head > 0 && action > head, 'the head check runs before the action');
  assert.equal(job.steps[head].run, 'node scripts/claude-code-admission.mjs --verify-head');
  assert.equal(job.steps[head].env.ADMITTED_HEAD_SHA, '${{ needs.admit.outputs.head_sha }}');
  for (const j of Object.values(WF.jobs)) {
    for (const s of j.steps.filter((x) => String(x.uses).startsWith('actions/checkout@'))) assert.equal(s.with['persist-credentials'], false);
  }
  assert.equal(job.steps[action].with.github_token, undefined, 'the action is not handed this job\'s token');
});

test('dry run: a commenter with read permission is refused, with no model step to start', () => {
  const d = dryRun({ ...comment('outsider'), permissions: { outsider: 'read' } });
  assert.equal(d.admitted, false);
  assert.equal(d.reason, 'not_permitted');
  assert.match(d.summary, /^Refused: outsider has read permission/);
  assert.ok(d.outputs.includes('admitted=false'));
  assert.ok(d.outputs.includes('head_sha='), 'nothing is bound');
  // The model job's own condition is what turns this output into "no model step".
  assert.match(WF.jobs.claude.if, /admitted == 'true'/);
});

test('dry run: a writer on a pull request is admitted and bound to the head read now', () => {
  const d = dryRun({ ...comment('maintainer'), permissions: { maintainer: 'write' }, pulls: { 42: { sha: HEAD } } });
  assert.equal(d.admitted, true, d.summary);
  assert.deepEqual(d.outputs, ['admitted=true', 'reason=admitted', 'kind=pull_request', 'number=42', `head_sha=${HEAD}`, `repository=${REPO}`]);
});

test('dry run: every refusal fails closed', () => {
  const cases = [
    [{ ...comment('maintainer'), permissions: {} }, 'permission_unavailable'],
    [{ ...comment('maintainer'), permissions: { maintainer: 'write' }, pulls: {} }, 'head_unavailable'],
    [{ ...review('maintainer', MOVED), permissions: { maintainer: 'admin' }, pulls: { 42: { sha: HEAD } } }, 'head_moved'],
    [{ ...comment('maintainer', { sender: 'outsider' }), permissions: { maintainer: 'write', outsider: 'none' } }, 'not_permitted'],
    [{ ...comment('maintainer'), permissions: { maintainer: 'write' }, pulls: { 42: { sha: HEAD } }, allowlist: 'owner-a, owner-b' }, 'not_on_allowlist'],
    [{ ...comment('maintainer', { body: 'no mention' }), permissions: { maintainer: 'write' } }, 'no_mention'],
    [{ ...comment('maintainer'), repository: 'someone/else', permissions: { maintainer: 'write' } }, 'repository_mismatch'],
    [{ eventName: 'workflow_dispatch', repository: REPO, ref: 'refs/heads/feature', sha: MAIN, event: { repository, sender: { login: 'maintainer' } }, permissions: { maintainer: 'admin' } }, 'dispatch_not_main'],
    [{ ...comment('maintainer'), eventName: 'push' }, 'unsupported_event'],
  ];
  for (const [f, reason] of cases) {
    const d = dryRun(f);
    assert.equal(d.admitted, false, reason);
    assert.equal(d.reason, reason);
    assert.ok(d.outputs.includes('admitted=false'));
  }
});

test('the allowlist narrows, never widens: a listed login still needs write', async () => {
  assert.deepEqual(parseAllowlist(' A, b  c,,a '), ['a', 'b', 'c']);
  const api = { permission: async () => 'read', pullHead: async () => ({ sha: HEAD }) };
  const d = await decide({ ...comment('A'), allowlist: ['a'] }, api);
  assert.equal(d.reason, 'not_permitted');
  const ok = await decide({ ...comment('A', { pr: false }), allowlist: ['a'] }, { ...api, permission: async () => 'admin' });
  assert.equal(ok.admitted, true);
  assert.equal(ok.kind, 'issue');
  assert.equal(ok.headSha, MAIN, 'an issue binds to the commit the run started on');
});

test('requests read who wrote the text and who caused the event; an assignment needs both', () => {
  const r = requestOf('issues', { sender: { login: 'assigner' }, issue: { number: 7, title: '@claude do it', user: { login: 'author' } } });
  assert.deepEqual(r.requesters, ['author', 'assigner']);
  assert.equal(r.mention, true);
  assert.equal(requestOf('workflow_dispatch', { sender: { login: 'x' } }).kind, 'dispatch');
  assert.equal(requestOf('push', {}), null);
});

test('the head check stops a moved head and an unreadable one', () => {
  assert.equal(headStillAdmitted(HEAD, HEAD).ok, true);
  assert.equal(headStillAdmitted(HEAD, MOVED).ok, false);
  assert.equal(headStillAdmitted(HEAD, undefined).ok, false);
  assert.equal(headStillAdmitted('', HEAD).ok, false);
});

test('nothing the API answers reaches the summary or the outputs unchecked', async () => {
  // Mutation checked: the KNOWN_PERMISSIONS mapping removed → the injected permission reaches the summary.
  const api = { permission: async () => 'read\n<img src=x>| [link](http://x)', pullHead: async () => ({ sha: HEAD }) };
  const d = await decide(comment('outsider'), api);
  assert.equal(d.reason, 'not_permitted');
  assert.match(d.summary, /outsider has none permission/, 'an undefined permission reads as none');
  assert.equal(safeLine('a\nb <x> `c` |d| [e](f) **g** →'), 'a b x c d e(f) g to ');
  assert.equal(safeLine('x'.repeat(400)).length, 300);
});

test('the job summary carries fixed text only: one line per outcome, never what the API answered', () => {
  // Mutation checked: summary(d.summary) put back in the CLI → the source check fails.
  const cli = readFileSync(CLI, 'utf8');
  const calls = [...cli.matchAll(/\bsummary\((.*)\);/g)].map((m) => m[1]).filter((a) => a !== 'fixed');
  assert.ok(calls.length >= 3);
  for (const a of calls) assert.match(a, /^(summaryLine\('?[a-z_.]+'?\)|summaryLine\(d\.reason\)|r\.ok \? HEAD_LINES\.ok : HEAD_LINES\.stopped)$/, a);
  const reasons = ['unsupported_event', 'repository_mismatch', 'no_mention', 'dispatch_not_main', 'malformed_event', 'permission_unavailable', 'not_permitted', 'not_on_allowlist', 'head_unavailable', 'head_moved', 'admitted', 'admission_error'];
  assert.deepEqual(Object.keys(SUMMARY_LINES).sort(), [...reasons].sort(), 'every outcome has its line');
  for (const line of Object.values(SUMMARY_LINES)) assert.equal(safeLine(line), line, 'each line is plain text already');
  assert.equal(summaryLine('something else'), SUMMARY_LINES.admission_error);
});
