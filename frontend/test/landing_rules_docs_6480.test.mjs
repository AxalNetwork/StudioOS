// #6480 (D6480): the landing rules sessions read, held to what is on main. Every label, variable and workflow the
// text names must exist in `.github/labels.yml` and the workflow files; the numbers it states must equal the bot's
// constants; and no sentence may permit a session to merge, approve, force-push or re-queue. Reads files only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  LABELS, MAX_ATTEMPTS, MAX_BOT_COMMITS_PER_DAY, MAX_MODEL_RUNS_PER_DAY, BREAKER_ALERTS, mode,
} from '../../scripts/landing-bot/rules.mjs';
import { KEEPER_MAX_ATTEMPTS } from '../../scripts/landing-bot/keeper-plan.mjs';
import { classify } from '../../scripts/merge-policy.mjs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const WF = '.github/workflows';
const workflowFiles = readdirSync(new URL(`../../${WF}/`, import.meta.url)).filter((f) => /\.ya?ml$/.test(f));
const landingWorkflows = workflowFiles.filter((f) => f.startsWith('landing-')).sort();
const allYaml = workflowFiles.map((f) => read(`${WF}/${f}`)).join('\n');
const labelNames = new Set([...read('.github/labels.yml').matchAll(/^- name: "([^"]+)"/gm)].map((m) => m[1]));

/** The text from a heading line to the next heading of the same or a higher level. */
function section(md, heading) {
  const start = md.indexOf(heading);
  assert.ok(start >= 0, `missing heading: ${heading}`);
  const level = /^#+/.exec(heading)[0].length;
  const rest = md.slice(start + heading.length);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return heading + (next < 0 ? rest : rest.slice(0, next));
}

const AGENTS = read('AGENTS.md');
const BOT_SECTION = section(AGENTS, '### What the landing bot does to your PR (D6480)');
const RED_MAIN = section(AGENTS, '### Red main and a backed-up queue (D5398)');
const WF_README = section(read(`${WF}/README.md`), '## The landing bot (#6480)');
const RUNBOOK = read('documentation/operations/LANDING_BOT.md');
const DECISION = read('documentation/architecture/decisions/D6480.md');
const SKILLS = ['land-pr', 'red-ci-triage', 'task-lifecycle'].map((s) => read(`.claude/skills/${s}/SKILL.md`));
const TEXTS = { 'AGENTS.md landing section': BOT_SECTION, 'AGENTS.md red main': RED_MAIN, 'workflows README': WF_README, runbook: RUNBOOK, D6480: DECISION };

const ticks = (text) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);

test('every label the landing text names is in .github/labels.yml', () => {
  const botLabels = new Set(Object.values(LABELS));
  for (const [where, text] of Object.entries(TEXTS)) {
    for (const t of ticks(text)) {
      if (botLabels.has(t) || /^(?:bot|pr|state):[\w-]+$/.test(t)) assert.ok(labelNames.has(t), `${where} names the label \`${t}\`, which .github/labels.yml does not define`);
    }
  }
  // The AGENTS.md table gives each label the bot writes one row, and every one of them exists.
  const rows = [...BOT_SECTION.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
  for (const l of Object.values(LABELS).filter((l) => l !== LABELS.off)) assert.ok(rows.includes(l), `AGENTS.md has no row for \`${l}\``);
  for (const l of rows) assert.ok(labelNames.has(l), `AGENTS.md has a row for \`${l}\`, which is not a label`);
  assert.match(BOT_SECTION, /\*\*`bot:off`\.\*\*/, 'AGENTS.md says what `bot:off` does');
});

test('every variable the landing text names is read by a workflow, and the README lists every one the bot reads', () => {
  const read_ = new Set([...allYaml.matchAll(/(?:vars|secrets)\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]));
  for (const [where, text] of Object.entries(TEXTS)) {
    for (const t of ticks(text).flatMap((x) => x.split(/[=\s]/)).filter((x) => /^(?:LANDING_[A-Z_]+|QUEUE_ALERT_IGNORE_BEFORE)$/.test(x))) {
      assert.ok(read_.has(t), `${where} names \`${t}\`, which no workflow reads as a variable or secret`);
    }
  }
  const landingVars = new Set(landingWorkflows.flatMap((f) => [...read(`${WF}/${f}`).matchAll(/vars\.((?:LANDING|QUEUE)_[A-Z_]+)/g)].map((m) => m[1])));
  const table = WF_README.slice(WF_README.indexOf('| Actions variable |'));
  for (const v of landingVars) assert.match(table, new RegExp(`\`${v}\``), `the workflows README's variable table omits \`${v}\``);
});

test('every workflow the landing text names exists, and the README table lists each landing workflow with its triggers', () => {
  for (const [where, text] of Object.entries(TEXTS)) {
    for (const t of ticks(text).filter((x) => /^landing[\w-]*\.ya?ml$/.test(x))) assert.ok(workflowFiles.includes(t), `${where} names \`${t}\`, which does not exist`);
  }
  for (const f of landingWorkflows) {
    const row = WF_README.split('\n').find((l) => l.startsWith(`| \`${f}\` |`));
    assert.ok(row, `the workflows README's landing table has no row for ${f}`);
    const yml = read(`${WF}/${f}`);
    const crons = [...yml.matchAll(/cron: '([^ ]+) \* \* \* \*'/g)].map((m) => m[1]);
    for (const c of crons) assert.ok(row.includes(`\`${c}\``), `${f} runs on ${c}; its README row does not say so`);
    for (const c of [...row.matchAll(/`(\d+-59\/\d+)`/g)].map((m) => m[1])) assert.ok(crons.includes(c), `${f}'s row names ${c}, which is not its schedule`);
    assert.equal(/workflow_dispatch:/.test(yml), /manual dispatch/.test(row), `${f}: the row and the YAML disagree about manual dispatch`);
    assert.equal(/\n  push:\n    branches: \[main\]/.test(yml), /push to `main`/.test(row), `${f}: the row and the YAML disagree about the push trigger`);
  }
});

test('the three values of LANDING_BOT_ENABLED are the ones mode() reads', () => {
  assert.equal(mode({ LANDING_BOT_ENABLED: 'true' }), 'all');
  assert.equal(mode({ LANDING_BOT_ENABLED: 'dispatch' }), 'dispatch');
  for (const v of [undefined, '', 'false', 'TRUE', 'yes']) assert.equal(mode({ LANDING_BOT_ENABLED: v }), 'off');
  assert.match(WF_README, /\*\*`LANDING_BOT_ENABLED` has three values\*\*[\s\S]*- `true`: every trigger[\s\S]*- `dispatch`: only a manual run acts, on the one PR it names[\s\S]*- anything else, unset included: off/);
  assert.match(BOT_SECTION, /`LANDING_BOT_ENABLED` is `true` \(every\s+trigger\), `dispatch` \(a manual run on one named PR\) or anything else \(off\)/);
  for (const f of landingWorkflows.filter((f) => f.startsWith('landing-bot-') && !f.includes('model'))) {
    assert.match(read(`${WF}/${f}`), /vars\.LANDING_BOT_ENABLED == 'true'/, `${f} is not behind LANDING_BOT_ENABLED`);
  }
});

test('the numbers the rules state are the bot\'s constants, and the breakers are its alerts', () => {
  const words = { 2: 'two', 3: 'three', 4: 'four' };
  assert.match(BOT_SECTION, new RegExp(`${words[MAX_ATTEMPTS]}\\s+attempts of each kind, ${words[MAX_BOT_COMMITS_PER_DAY]} bot commits and ${words[MAX_MODEL_RUNS_PER_DAY]} model runs in any 24 hours,\\s+${words[KEEPER_MAX_ATTEMPTS]} keeper attempts for good`));
  assert.match(RED_MAIN, new RegExp(`${words[KEEPER_MAX_ATTEMPTS]} keeper attempts per PR`));
  const flat = (s) => s.replace(/\s+/g, ' ');
  for (const alert of BREAKER_ALERTS) {
    assert.ok(flat(BOT_SECTION).includes(`\`${alert}\``), `AGENTS.md omits the breaker ${alert}`);
    assert.ok(flat(WF_README).includes(`\`${alert}\``), `the workflows README omits the breaker ${alert}`);
  }
  // The feeder's owner labels, as AGENTS.md lists them.
  const plan = read('scripts/landing-bot/feeder-plan.mjs');
  assert.match(plan, /new Set\(\[LABELS\.off, LABELS\.resolved, LABELS\.mainRepair\]\)/);
  assert.match(flat(BOT_SECTION), /no `bot:off`, `bot:resolved` or `main-repair` label/);
});

test('no sentence lets a session merge, approve, force-push or re-queue, and the limits on sessions stay', () => {
  // Paragraphs, list items and table rows first, then sentences and clauses, so a line with no full stop never hides one.
  const sentences = AGENTS.split(/\n\s*\n|\n(?=\s*(?:[-|#]|\d+\.) )/).map((p) => p.replace(/\s+/g, ' ')).flatMap((p) => p.split(/(?<=[.!?;:])\s+/));
  const permits = sentences.filter((s) => /\b(?:may|can|is allowed to)\b/i.test(s)
    && /\b(?:approve|force-push|re-queue|merges? (?!of\b|`main`|main\b|queue|commit|through|your own branch)|--admin)/i.test(s)
    && !/\bnever\b|\bnot\b|\bno session\b/i.test(s));
  assert.deepEqual(permits, [], 'a sentence in AGENTS.md permits what only the owner or the bot does');
  const flat = BOT_SECTION.replace(/\s+/g, ' ');
  for (const must of [/\*\*Sessions still never\*\* merge `main` into branches in bulk/, /re-queue a PR, approve a PR/, /force-push/,
    /It is not a session: the rules in this file bind sessions/]) assert.match(flat, must);
  assert.match(AGENTS.replace(/\s+/g, ' '), /never re-queue one the queue ejected/);
  assert.match(AGENTS.replace(/\s+/g, ' '), /That review is advisory: it is not a GitHub approval, and no session or bot approves a PR\./);
});

test('the runbook keeps the switch and the caps the owner\'s, and names real credentials', () => {
  const flat = RUNBOOK.replace(/\s+/g, ' ');
  assert.match(flat, /\*\*Only the owner changes the switch and the caps\.\*\*/);
  assert.match(flat, /The owner sets `LANDING_BOT_ENABLED=true` only after #6480 is merged/);
  for (const h of ['## Turn it off', '## Change a cap', '## Read the sticky comment', '## Rotate the App key']) assert.ok(RUNBOOK.includes(`\n${h}\n`), `runbook lacks ${h}`);
  for (const secret of ['LANDING_BOT_APP_ID', 'LANDING_BOT_APP_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']) {
    assert.ok(RUNBOOK.includes(`\`${secret}\``), `runbook omits ${secret}`);
    assert.ok(allYaml.includes(`secrets.${secret}`), `runbook names ${secret}, which no workflow reads`);
  }
  assert.match(RUNBOOK, /`<!-- landing-bot -->`/);
  assert.match(read('scripts/landing-bot/rules.mjs'), /STICKY_MARKER = '<!-- landing-bot -->'/);
  assert.match(read('documentation/operations/README.md'), /^\| `LANDING_BOT\.md` \|/m);
});

test('the three skills follow the new rules', () => {
  const [land, triage, lifecycle] = SKILLS;
  assert.match(land, /## The landing bot \(D6480\)/);
  assert.match(land, /Never re-queue a PR the queue ejected/);
  assert.doesNotMatch(land, /`cloudflare-worker\/src\/\{routes,services\}\/\*\*`/, 'land-pr still lists the pre-D6679 T1 folders');
  // Each folder the skill calls T1 or T0 is that tier under the classifier.
  const t1 = /- \*\*T1\*\* \(D6679\): (.+)/.exec(land)?.[1] ?? '';
  const folders = (root) => [...t1.split(root)[1].split(')')[0].matchAll(/`([\w-]+)`/g)].map((m) => m[1]);
  for (const f of folders('`frontend/src/` (')) assert.equal(classify([{ path: `frontend/src/${f}/x.js`, status: 'A' }]).tier, 'T1', `frontend/src/${f}`);
  for (const f of folders('`cloudflare-worker/src/` (')) assert.equal(classify([{ path: `cloudflare-worker/src/${f}/x.ts`, status: 'A' }]).tier, 'T1', `cloudflare-worker/src/${f}`);
  assert.ok(folders('`frontend/src/` (').length >= 12 && folders('`cloudflare-worker/src/` (').length >= 13, 'the T1 folder lists are complete');
  assert.match(triage, /main-repair/);
  assert.match(triage, /serial refresh updates inherited-red, non-draft PRs one at a time/);
  assert.match(triage, /Fetch and merge your own branch first/);
  assert.match(lifecycle, /Fetch and merge your own branch before every\s+push/);
  assert.match(lifecycle, /Never re-queue,\s+approve or merge/);
});
