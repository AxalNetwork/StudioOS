/**
 * #4571 (Security S2) — repo-wide guards on every GitHub Actions workflow.
 *
 * Several workflows already pin their own rules (labels-sync, copilot setup,
 * code scanning upload, the merge queue). These hold the same rules for EVERY
 * file under .github/workflows/, so a new workflow cannot quietly be the first
 * to break one:
 *
 *   WF-1  every action is pinned to a full commit SHA (a local `./` action, or
 *         a `docker://` image pinned by digest, are the other two forms);
 *   WF-2  every container image is pinned by digest, or is a recorded finding;
 *   WF-3  every workflow declares its token's permissions, at the top or on
 *         every job, and never `write-all`;
 *   WF-4  no `pull_request_target` and no `workflow_run`: a fork's pull request
 *         never runs with this repository's secrets or a write token;
 *   WF-5  text an outsider writes (a PR title, body or branch name, an issue or
 *         comment body, a commit message) is never expanded inside a `run:`
 *         script or a github-script `script:`; it reaches a step through `env:`;
 *   WF-6  a workflow that an issue or comment can start, and that holds a write
 *         token, says who may start it (`author_association`), or is a recorded
 *         finding.
 *
 * A recorded finding is an entry below naming its risk-register id in
 * documentation/audits/SECURITY_CONTROL_MATRIX_2026-11-06.md. Taking one out is
 * the remediation; adding one needs that register row first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const DIR = new URL('.github/workflows/', ROOT);
const REGISTER = readFileSync(new URL('documentation/audits/SECURITY_CONTROL_MATRIX_2026-11-06.md', ROOT), 'utf8');
const FILES = readdirSync(DIR).filter((n) => /\.ya?ml$/.test(n)).sort();
const read = (name) => readFileSync(new URL(name, DIR), 'utf8');

/** Recorded findings: file → register id. Each id must be a row in the register. */
export const MUTABLE_IMAGES = Object.freeze({
  'ci.yml': 'SC-03',
  'deck-visual.yml': 'SC-03',
});
// SC-02 (claude-code.yml) was closed by gating each comment event on its author's association.
export const UNGATED_COMMENT_TRIGGERS = Object.freeze({});

const indentOf = (l) => l.length - l.trimStart().length;
const isComment = (l) => l.trimStart().startsWith('#');
const codeLines = (src) => src.split('\n').filter((l) => l.trim() && !isComment(l));

/** The value after `key:` (a list dash allowed), a trailing ` # comment` stripped. */
function valueOf(line, key) {
  const t = line.trim().replace(/^- /, '');
  if (!t.startsWith(`${key}:`)) return undefined;
  const v = t.slice(key.length + 1);
  const hash = v.indexOf(' #');
  return (hash >= 0 ? v.slice(0, hash) : v).trim().replace(/^['"]|['"]$/g, '');
}

/** Every body line of a `key:` block scalar (or its inline value), read RAW: GitHub expands `${{ }}` in shell comments too. */
function blockBodies(src, key) {
  const lines = src.split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    const v = valueOf(line, key);
    if (v === undefined) return;
    if (!/^[|>]/.test(v)) { out.push(v); return; }
    for (const next of lines.slice(i + 1)) {
      if (!next.trim()) continue;
      if (indentOf(next) <= indentOf(line)) break;
      out.push(next.trim());
    }
  });
  return out;
}

/** The top-level `on:` block, as text. */
function triggersOf(src) {
  const lines = src.split('\n');
  const at = lines.findIndex((l) => /^(on|"on"|'on'):/.test(l));
  if (at < 0) return '';
  const inline = lines[at].replace(/^[^:]+:/, '').trim();
  const body = [inline];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() && indentOf(l) === 0 && !isComment(l)) break;
    if (!isComment(l)) body.push(l);
  }
  return body.join('\n');
}

/** The job ids under `jobs:`, and whether each declares `permissions:`. */
function jobsOf(src) {
  const lines = src.split('\n');
  const at = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (at < 0) return [];
  const jobs = [];
  let jobIndent = null;
  for (const l of lines.slice(at + 1)) {
    if (!l.trim() || isComment(l)) continue;
    if (indentOf(l) === 0) break;
    if (jobIndent === null) jobIndent = indentOf(l);
    if (indentOf(l) === jobIndent) { jobs.push({ id: l.trim().replace(/:.*$/, ''), permissions: false }); continue; }
    if (indentOf(l) === jobIndent + 2 && /^permissions:/.test(l.trim())) jobs[jobs.length - 1].permissions = true;
  }
  return jobs;
}

const topPermissions = (src) => src.split('\n').some((l) => /^permissions:/.test(l));

/** Event text an outsider controls. `github.head_ref` is the branch name, which a fork chooses. */
const UNTRUSTED = /\$\{\{[^}]*\bgithub\.(head_ref|event\.(pull_request\.(title|body|head\.ref|head\.label)|issue\.(title|body)|comment\.body|review\.body|review_comment\.body|discussion\.(title|body)|head_commit\.(message|author\.(name|email))|commits|pages))/;

test('the guard reads every workflow, and each recorded finding is a row in the risk register', () => {
  assert.ok(FILES.length >= 30, `found ${FILES.length} workflows`);
  for (const [file, id] of Object.entries({ ...MUTABLE_IMAGES, ...UNGATED_COMMENT_TRIGGERS })) {
    assert.ok(FILES.includes(file), `${file} is recorded but does not exist`);
    assert.match(REGISTER, new RegExp(`\\|\\s*${id}\\s*\\|`), `${id} (${file}) has no row in the risk register`);
  }
});

test('WF-1: every action is pinned to a full commit SHA', () => {
  // Mutation checked: `actions/checkout@v4` written into a workflow.
  const bad = [];
  for (const f of FILES) {
    for (const u of codeLines(read(f)).map((l) => valueOf(l, 'uses')).filter(Boolean)) {
      if (u.startsWith('./')) continue;
      if (u.startsWith('docker://')) { if (!/@sha256:[0-9a-f]{64}$/.test(u)) bad.push(`${f}: ${u}`); continue; }
      if (!/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(u)) bad.push(`${f}: ${u}`);
    }
  }
  assert.deepEqual(bad, [], 'a tag or branch can be moved to new code after review; pin the full SHA and keep the tag as a comment');
});

test('WF-2: every container image is pinned by digest, or is a recorded finding', () => {
  const bad = [];
  for (const f of FILES) {
    for (const img of codeLines(read(f)).map((l) => valueOf(l, 'image')).filter(Boolean)) {
      if (/@sha256:[0-9a-f]{64}$/.test(img)) continue;
      if (MUTABLE_IMAGES[f]) continue;
      bad.push(`${f}: ${img}`);
    }
  }
  assert.deepEqual(bad, []);
  // A recorded file that has since been pinned must leave the list, so the register stays true.
  for (const f of Object.keys(MUTABLE_IMAGES)) {
    const mutable = codeLines(read(f)).map((l) => valueOf(l, 'image')).filter((i) => i && !/@sha256:/.test(i));
    assert.ok(mutable.length > 0, `${f} pins its images now: remove it from MUTABLE_IMAGES and close its register row`);
  }
});

test('WF-3: every workflow declares its token permissions (top level or every job), never write-all', () => {
  // Mutation checked: semgrep.yml's top-level permissions block removed.
  const bad = [];
  for (const f of FILES) {
    const src = read(f);
    if (/^\s*permissions:\s*(write-all|read-all)\b/m.test(src)) bad.push(`${f}: write-all/read-all`);
    if (topPermissions(src)) continue;
    const jobs = jobsOf(src);
    const missing = jobs.filter((j) => !j.permissions).map((j) => j.id);
    if (!jobs.length || missing.length) bad.push(`${f}: no top-level permissions, and job(s) ${missing.join(', ') || '(none found)'} declare none`);
  }
  assert.deepEqual(bad, [], 'an undeclared token gets the repository default, which an owner can widen without touching this file');
});

test('WF-4: no pull_request_target and no workflow_run trigger', () => {
  // Mutation checked: `pull_request_target:` added to ci.yml's triggers.
  const bad = FILES.filter((f) => /\b(pull_request_target|workflow_run)\b/.test(triggersOf(read(f))));
  assert.deepEqual(bad, [], 'both run with this repository\'s secrets and a write token on a fork\'s pull request');
});

test('WF-5: outsider-written event text is never expanded inside run: or a github-script script:', () => {
  // Mutation checked: `echo "${{ github.event.pull_request.title }}"` added to a run: step.
  const bad = [];
  for (const f of FILES) {
    const src = read(f);
    for (const line of [...blockBodies(src, 'run'), ...blockBodies(src, 'script')]) {
      if (UNTRUSTED.test(line)) bad.push(`${f}: ${line.slice(0, 120)}`);
    }
  }
  assert.deepEqual(bad, [], 'pass it through env: and quote the variable; an expression is pasted into the script before the shell parses it');
  // The pattern itself catches what it must (a guard that matches nothing guards nothing).
  for (const s of ['${{ github.event.pull_request.title }}', '${{ github.head_ref }}', '${{ github.event.comment.body }}', '${{github.event.issue.body}}']) {
    assert.match(s, UNTRUSTED, s);
  }
  assert.doesNotMatch('${{ github.event.pull_request.number }}', UNTRUSTED);
});

test('WF-6: a workflow an issue or comment can start, holding a write token, says who may start it — or is a recorded finding', () => {
  const COMMENT_EVENTS = /\b(issue_comment|pull_request_review_comment|pull_request_review|discussion_comment|issues)\s*:/;
  const bad = [];
  for (const f of FILES) {
    const src = read(f);
    if (!COMMENT_EVENTS.test(triggersOf(src))) continue;
    const writes = /^\s*[a-z-]+:\s*write\b/m.test(src);
    if (!writes) continue;
    const gated = /author_association/.test(codeLines(src).join('\n'));
    if (gated) continue;
    if (UNGATED_COMMENT_TRIGGERS[f]) continue;
    bad.push(f);
  }
  assert.deepEqual(bad, [], 'anyone can comment on a public repository; gate the job on OWNER, MEMBER or COLLABORATOR');
  for (const f of Object.keys(UNGATED_COMMENT_TRIGGERS)) {
    assert.doesNotMatch(codeLines(read(f)).join('\n'), /author_association/, `${f} is gated now: remove it from UNGATED_COMMENT_TRIGGERS and close its register row`);
  }
});

test('SC-02: claude-code.yml lets only an owner, member or collaborator start it, on every comment and issue event', () => {
  // Mutation checked: one event's author_association check removed (pull_request_review) while the others stay.
  const src = codeLines(read('claude-code.yml')).join('\n');
  const at = src.indexOf('if: |');
  assert.ok(at > 0, 'the job condition');
  const cond = src.slice(at, src.indexOf('runs-on:', at));
  const GATE = (obj) => `contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.${obj}.author_association)`;
  for (const [event, obj] of [['issue_comment', 'comment'], ['pull_request_review_comment', 'comment'], ['pull_request_review', 'review'], ['issues', 'issue']]) {
    const from = cond.indexOf(`github.event_name == '${event}'`);
    assert.ok(from >= 0, `${event} is a trigger`);
    const next = cond.indexOf("github.event_name == '", from + 1);
    const clause = cond.slice(from, next < 0 ? cond.length : next);
    assert.ok(clause.includes(GATE(obj)), `${event}: the mention must come from an owner, member or collaborator (${obj}.author_association)`);
  }
  assert.doesNotMatch(cond, /CONTRIBUTOR|FIRST_TIME|NONE|MANNEQUIN/, 'only the three trusted associations');
  // Every non-dispatch branch is gated: four gates for four events.
  assert.equal(cond.split('author_association').length - 1, 4);
});
