/**
 * D543 (#1106) — support-ticket triage: the bounty and feature labels are
 * declared, and AGENTS.md says who applies them and when.
 *
 * What this pins:
 *   - labels.yml declares the eight labels, and they are exactly the bounty
 *     and feature labels the Worker acts on (D542's `bugBounties.ts`, D544's
 *     `admin_ticket_reviews.ts`): labels-sync creates only what labels.yml
 *     declares, so a label the Worker reads and the file lacks never exists;
 *   - AGENTS.md's "Support-ticket triage" section, inside the task protocol:
 *     every label named, only Session 1 adds a bounty label, the four steps
 *     in order, the hourly check from #1105, features through #1107, and
 *     nothing on GitHub claims a bounty;
 *   - the claim the section rests on: `BOUNTY_GRANTERS` holds only the owner
 *     account, in both of wrangler.toml's var tables.
 *
 * Run with:
 *   node --test frontend/test/support_triage_d543.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const TRIAGE_LABELS = [
  'bounty:confirmed',
  'bounty:not-a-bug',
  'bounty:duplicate',
  'bounty:verified-high',
  'bounty:verified-medium',
  'bounty:verified-low',
  'feature:approved',
  'feature:declined',
];
const OWNER = 'guillaumelauzier';

/** labels.yml's names, from its flat `- name: "…"` entries. */
const declaredNames = (src) => [...src.matchAll(/^- name: "([^"]+)"/gm)].map((m) => m[1]);

/** Every quoted `bounty:` or `feature:` label a Worker file names as a literal. */
const workerLabels = (src) => [...src.matchAll(/'((?:bounty|feature):[a-z-]+)'/g)].map((m) => m[1]);

/** AGENTS.md's "Support-ticket triage" section, up to the next heading of its level or above. */
function triageSection() {
  const md = read('AGENTS.md');
  const from = md.indexOf('\n### Support-ticket triage\n');
  assert.ok(from >= 0, 'AGENTS.md has no "### Support-ticket triage" section');
  const next = md.slice(from + 1).search(/\n#{2,3} /);
  return { md, from, text: next === -1 ? md.slice(from) : md.slice(from, from + 1 + next) };
}

test('labels.yml declares every triage label, each once', () => {
  const names = declaredNames(read('.github/labels.yml'));
  assert.deepEqual(TRIAGE_LABELS.filter((l) => !names.includes(l)), [],
    'labels-sync creates only what labels.yml declares');
  const twice = TRIAGE_LABELS.filter((l) => names.filter((n) => n === l).length > 1);
  assert.deepEqual(twice, [], 'a label declared twice is synced twice, the second entry winning silently');
});

test('the declared triage labels are exactly the bounty and feature labels the Worker acts on', () => {
  const used = [...new Set([
    ...workerLabels(read('cloudflare-worker/src/services/bugBounties.ts')),
    ...workerLabels(read('cloudflare-worker/src/routes/admin_ticket_reviews.ts')),
  ])].sort();
  assert.deepEqual(used, [...TRIAGE_LABELS].sort(),
    'a label the Worker reads that labels.yml lacks never exists on GitHub, and one declared that nothing reads is noise');
  const declared = declaredNames(read('.github/labels.yml')).filter((n) => /^(bounty|feature):/.test(n)).sort();
  assert.deepEqual(declared, [...TRIAGE_LABELS].sort());
});

test('AGENTS.md has the triage section inside the task protocol, naming every label', () => {
  const { md, from, text } = triageSection();
  const protocol = md.indexOf('\n## Task protocol\n');
  const house = md.indexOf('\n## House rules (StudioOS)\n');
  assert.ok(protocol >= 0 && protocol < from && from < house, 'the section belongs to the task protocol, before the house rules');
  const unnamed = [...TRIAGE_LABELS, 'support-ticket', 'bug'].filter((l) => !text.includes(`\`${l}\``));
  assert.deepEqual(unnamed, [], 'an agent cannot follow a label it was never told about');
});

test('AGENTS.md says only Session 1 adds a bounty label, and why that holds', () => {
  const flat = triageSection().text.replace(/\s+/g, ' ');
  assert.ok(flat.includes('Only Session 1 adds or removes a bounty label, as the owner account'));
  assert.ok(flat.includes('the platform acts on a bounty label only when that account added it (D542)'));
  assert.ok(flat.includes('No other agent touches a `bounty:` or `feature:` label.'));
});

test('AGENTS.md gives the four steps in order, the hourly check, and features through the Super Admin', () => {
  const flat = triageSection().text.replace(/\s+/g, ' ');
  const at = ['**Check.**', '**Label the outcome,**', '**Verify.**', '**Grade.**'].map((s) => flat.indexOf(s));
  assert.ok(at.every((i) => i >= 0), 'a step is missing');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'the steps are out of order');
  assert.ok(flat.includes('with read-only checks only'), 'production is checked read-only');
  assert.ok(flat.includes('Session 1 runs this check every hour, from the day #1105 merges.'));
  assert.ok(flat.includes('A feature request is never built until the Super Admin approves it (#1107).'));
  assert.ok(flat.includes('The approval adds `feature:approved`, and Session 1 then files the build task'));
});

test('AGENTS.md says nothing on GitHub claims a bounty', () => {
  const flat = triageSection().text.replace(/\s+/g, ' ');
  assert.ok(flat.includes('A bounty is a credit on the platform, granted to the member who filed the ticket.'));
  assert.ok(flat.includes('a `/claim` comment or a pull request from outside the project claims nothing'));
  assert.ok(flat.includes('closed without being merged'));
});

test('BOUNTY_GRANTERS holds only the owner account, in both var tables', () => {
  const values = [...read('wrangler.toml').matchAll(/^BOUNTY_GRANTERS = "([^"]*)"$/gm)].map((m) => m[1]);
  assert.equal(values.length, 2, 'BOUNTY_GRANTERS is declared at the top and again under the production vars (D542)');
  assert.deepEqual(values, [OWNER, OWNER],
    'AGENTS.md says only Session 1, writing as the owner account, adds a bounty label; another login here would pay itself');
});
