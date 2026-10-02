/**
 * D503 (#972) — agents coordinate through issues, and five places carry the
 * protocol. Each pin below sits on the one thing that, if it drifted, would
 * break the protocol while every other test stayed green:
 *
 *   .github/labels.yml — the labels the work queues run on. labels-sync.yml
 *     creates only what this file declares, so a slot missing here has no
 *     queue on any repository that does not already carry its label.
 *   AGENTS.md — the one rule file every agent reads after CLAUDE.md. A state
 *     label it never names is one no agent knows to set, a STATUS field it
 *     drops is one Session 1 stops receiving, and its house rules are the
 *     only copy an agent that never loads CLAUDE.md will ever see.
 *   .github/pull_request_template.md — the eight sections every agent's PR
 *     fills in.
 *   .github/workflows/labels-sync.yml — writes labels with the job's token. It
 *     needs `issues: write` to work at all, so it must run no third-party code
 *     while holding it, take nothing from `${{ }}` inside `run:`, and never
 *     delete a label.
 *   .github/ISSUE_TEMPLATE/ — GitHub applies a form's labels for whoever files
 *     it, outsiders included. A form that applied `state:ready` or a slot label
 *     would let anyone put work in an agent's queue, which is why the task form
 *     applies none: only Session 1 makes a task ready.
 *
 * Read as text, the way copilot_setup_steps.test.mjs reads a workflow: there is
 * no YAML parser in this tree. labels.yml is kept to the flat shape the reader
 * below accepts, and that reader throws on any other line rather than guess.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const at = (p) => readFileSync(resolve(root, p), 'utf8');

const LABELS = '.github/labels.yml';
const AGENTS = 'AGENTS.md';
const PR_TEMPLATE = '.github/pull_request_template.md';
const SYNC = '.github/workflows/labels-sync.yml';
const CI = '.github/workflows/ci.yml';
const FORMS = '.github/ISSUE_TEMPLATE';

const STATE_LABELS = ['state:ready', 'state:in-progress', 'state:blocked', 'state:review'];
const SLOT_LABELS = Array.from({ length: 20 }, (_, i) => `slot:S${String(i + 1).padStart(2, '0')}`);

/** The block every agent posts. AGENTS.md carries it to be reproduced exactly. */
const STATUS_BLOCK = [
  'STATUS',
  'task: #<issue>   slot: <SLOT>   agent: <AGENT NAME>',
  'branch: <branch>',
  'state: IN_PROGRESS | BLOCKED | READY_FOR_REVIEW | DONE',
  'files: <main files touched>',
  'blockers: <none, or what>',
  'questions: <none, or what>',
  'tests: <what ran, and the result>',
  'pr: <link, or none yet>',
];

const PR_SECTIONS = [
  'Objective',
  'Implementation',
  'Files changed',
  'Testing',
  'Risks',
  'Dependencies',
  'Agent',
  'Review requested',
];

/** What each issue form applies by itself. The task form applies nothing. */
const FORM_LABELS = {
  'blocked.yml': ['state:blocked'],
  'bug.yml': ['bug'],
  'needs-decision.yml': ['needs-decision'],
  'question.yml': ['question'],
  'task.yml': [],
};

/**
 * One anchor per house rule. An agent on another platform never loads
 * CLAUDE.md, so if a rule leaves this section it leaves that agent's view.
 */
const HOUSE_RULES = [
  'cloudflare-worker/', // build in the Worker first
  'backend/', // FastAPI, never deployed
  'frontend/src/lib/api.js', // no method without a mounted Worker route
  'cloudflare-worker/sql/migrations/', // a migration is a new file
  'Not recorded', // no store: say so, and why
  'Unreadable', // a failed read is never zero
  'Eadwyn', // the AI's name, and its banned words
  'logAdminAction', // the actor is recorded …
  'activity_logs', // … through one of the two
  'npm run test:drift', // the suite, its exit code read from a redirected log
  'npm run build', // docs/ is committed
  'node scripts/check-decision-ids.mjs', // the D-entry, in numeric position
  'Production D1', // read schema and aggregates only
  'deploy log', // say so when you cannot read it
];

const isComment = (line) => line.trimStart().startsWith('#');
const indentOf = (line) => line.length - line.trimStart().length;

/** `"x"`, `'x'` or `x` → `x`. */
function scalar(raw) {
  const v = raw.trim();
  const quoted = v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0];
  return quoted ? v.slice(1, -1) : v;
}

/** labels.yml as `[{ name, color, description }]`. */
function declaredLabels() {
  const labels = [];
  for (const line of at(LABELS).split('\n')) {
    if (!line.trim() || isComment(line)) continue;
    const m = /^(- | {2})(name|color|description):(.*)$/.exec(line);
    if (!m || (m[1] !== '- ' && labels.length === 0)) {
      throw new Error(`${LABELS}: a line outside the flat name/color/description shape — ${line}`);
    }
    if (m[1] === '- ') labels.push({});
    labels[labels.length - 1][m[2]] = scalar(m[3]);
  }
  return labels;
}

/** A file's lines, blank and comment lines dropped: prose that names a command does not run it. */
const codeLines = (src) => src.split('\n').filter((l) => l.trim() && !isComment(l));

/** The value after `key:` on a line, a trailing ` # comment` stripped; undefined when absent. */
function valueOf(line, key) {
  const t = line.trim().replace(/^- /, '');
  if (!t.startsWith(`${key}:`)) return undefined;
  const v = t.slice(key.length + 1);
  const hash = v.indexOf(' #');
  return (hash >= 0 ? v.slice(0, hash) : v).trim();
}

/** Every `permissions:` in a workflow, as its entries; an inline value is one entry. */
function permissionBlocks(lines) {
  const blocks = [];
  lines.forEach((line, i) => {
    const inline = valueOf(line, 'permissions');
    if (inline === undefined) return;
    if (inline) { blocks.push([inline]); return; }
    const block = [];
    for (const next of lines.slice(i + 1)) {
      if (indentOf(next) <= indentOf(line)) break;
      block.push(next.trim());
    }
    blocks.push(block);
  });
  return blocks;
}

/** Every `uses:` value in a workflow. */
const usesOf = (lines) => lines.map((l) => valueOf(l, 'uses')).filter(Boolean);

/**
 * Every line of every `run:`, a block scalar's body included — and its shell
 * comments too, read from the RAW file: GitHub expands `${{ }}` before the
 * shell sees the script, so an expression in a `#` comment is still
 * substituted, and a value carrying a newline walks out of the comment.
 */
function runLines(rawLines) {
  const out = [];
  rawLines.forEach((line, i) => {
    if (isComment(line)) return;
    const v = valueOf(line, 'run');
    if (v === undefined) return;
    if (!/^[|>]/.test(v)) { out.push(v); return; }
    for (const next of rawLines.slice(i + 1)) {
      if (!next.trim()) continue;
      if (indentOf(next) <= indentOf(line)) break;
      out.push(next.trim());
    }
  });
  return out;
}

/** The labels an issue form applies: absent, a flow list, a comma string, or a block list. */
function formLabels(src) {
  const lines = src.split('\n');
  const i = lines.findIndex((l) => /^labels:/.test(l));
  if (i === -1) return [];
  const inline = lines[i].slice('labels:'.length).trim();
  if (inline.startsWith('[')) {
    if (!inline.endsWith(']')) throw new Error(`a labels list this reader cannot follow — ${lines[i]}`);
    return inline.slice(1, -1).split(',').map(scalar).filter(Boolean);
  }
  if (inline) return scalar(inline).split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const next of lines.slice(i + 1)) {
    const m = /^\s+-\s+(.*)$/.exec(next);
    if (!m) break;
    out.push(scalar(m[1]));
  }
  return out;
}

// ---------- .github/labels.yml ----------

test('labels.yml declares the four state labels, needs-decision and slot:S01 to slot:S20', () => {
  const names = declaredLabels().map((l) => l.name);
  const missing = [...STATE_LABELS, 'needs-decision', ...SLOT_LABELS].filter((n) => !names.includes(n));
  assert.deepEqual(missing, [],
    `labels-sync.yml creates only what ${LABELS} declares, so these would not exist on a repository `
    + `that lost them: ${missing.join(', ')}`);
});

test('every declared label has a name, a six-digit hex colour and a description', () => {
  const malformed = declaredLabels()
    .filter((l) => !l.name || !/^[0-9A-Fa-f]{6}$/.test(l.color ?? '') || !l.description)
    .map((l) => l.name || '(no name)');
  assert.deepEqual(malformed, [],
    `labels-sync.yml refuses the whole file, before its first write, over these entries: ${malformed.join(', ')}`);
});

// ---------- AGENTS.md ----------

test('AGENTS.md names every state label, and needs-decision', () => {
  const agents = at(AGENTS);
  const declaredStates = declaredLabels().map((l) => l.name).filter((n) => n.startsWith('state:'));
  const labels = [...new Set([...STATE_LABELS, ...declaredStates, 'needs-decision'])];
  const unnamed = labels.filter((l) => !agents.includes(`\`${l}\``));
  assert.deepEqual(unnamed, [],
    `AGENTS.md never names ${unnamed.join(', ')}; an agent cannot set a label it was never told about`);
});

test('AGENTS.md carries the STATUS block exactly, every field in order', () => {
  const lines = at(AGENTS).split('\n');
  const start = lines.indexOf('STATUS');
  assert.deepEqual(lines.slice(start, start + STATUS_BLOCK.length), STATUS_BLOCK,
    'every agent reports in this block and Session 1 reads it by these field names; '
    + 'a field dropped or renamed here is one no agent sends');
});

test('AGENTS.md states the house rules, after the task protocol', () => {
  const md = at(AGENTS);
  const protocol = md.indexOf('\n## Task protocol\n');
  const house = md.indexOf('\n## House rules (StudioOS)\n');
  const end = house === -1 ? -1 : md.indexOf('\n## ', house + 1);
  // Whitespace collapsed: prose wraps, and "deploy log" may straddle a line.
  const section = house === -1 ? '' : md.slice(house, end === -1 ? md.length : end).replace(/\s+/g, ' ');
  assert.deepEqual(
    {
      afterTheTaskProtocol: protocol !== -1 && house > protocol,
      missing: HOUSE_RULES.filter((rule) => !section.includes(rule)),
    },
    { afterTheTaskProtocol: true, missing: [] },
    'agents on other platforms never load CLAUDE.md, so AGENTS.md must state its house rules '
    + 'in a "House rules (StudioOS)" section after the task protocol',
  );
});

// ---------- .github/pull_request_template.md ----------

test('the PR template has the eight sections, in order', () => {
  const headings = at(PR_TEMPLATE).split('\n')
    .filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3).trim());
  assert.deepEqual(headings, PR_SECTIONS);
});

// ---------- .github/workflows/labels-sync.yml ----------

test('labels-sync.yml holds issues: write and contents: read, and nothing else', () => {
  const blocks = permissionBlocks(codeLines(at(SYNC)));
  const distinct = [...new Set(blocks.map((b) => b.join(', ')))];
  assert.deepEqual(distinct, ['contents: read, issues: write'],
    'the job writes labels, which needs issues: write, and reads the file, which needs contents: read; '
    + 'every permissions block must grant exactly that');
});

test('labels-sync.yml runs no third-party action, and pins checkout where every other workflow does', () => {
  const uses = usesOf(codeLines(at(SYNC)));
  const thirdParty = uses.filter((u) => !/^(actions|github)\//.test(u));
  assert.deepEqual(thirdParty, [],
    `a third-party action would run with this job's issues: write token: ${thirdParty.join(', ')}`);
  const pin = (lines) => [...new Set(usesOf(lines).filter((u) => u.startsWith('actions/checkout@')))];
  assert.deepEqual(pin(codeLines(at(SYNC))), pin(codeLines(at(CI))),
    'actions/checkout must be pinned to the same full SHA as ci.yml (.github/workflows/README.md, pinning policy)');
});

test('labels-sync.yml never deletes a label, and puts no ${{ }} inside run:', () => {
  const src = at(SYNC);
  assert.doesNotMatch(codeLines(src).join('\n'), /\blabel\s+delete\b|-X\s*DELETE\b|--method[\s=]+DELETE\b/i,
    'an entry taken out of labels.yml must leave its label alone; deleting one is a person\'s decision');
  const interpolated = runLines(src.split('\n')).filter((l) => l.includes('${{'));
  assert.deepEqual(interpolated, [],
    'values reach run: through env: and shell variables; an expression inside run: is parsed as shell');
});

// ---------- .github/ISSUE_TEMPLATE/ ----------

test('each issue form applies only its own label, and the task form applies none', () => {
  const forms = readdirSync(resolve(root, FORMS))
    .filter((f) => f.endsWith('.yml') && f !== 'config.yml')
    .sort();
  const applied = Object.fromEntries(forms.map((f) => [f, formLabels(at(`${FORMS}/${f}`))]));
  assert.deepEqual(applied, FORM_LABELS,
    'GitHub applies a form\'s labels for anyone who files it; a form that applied state:ready or a '
    + 'slot label would let anyone queue work for an agent');
});

test('blank issues stay open, and security reports go to a private advisory', () => {
  const config = at(`${FORMS}/config.yml`);
  assert.match(config, /^blank_issues_enabled: true\s*$/m,
    'blank issues stay enabled; the forms are a help, not a gate');
  assert.match(config, /^\s+url: https:\/\/github\.com\/AxalNetwork\/StudioOS\/security\/advisories\/new\s*$/m,
    'the repository is public: the issue chooser must send a security report to a private advisory');
});
