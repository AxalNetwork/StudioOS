// The Research data import workflow (#1229, #1230, #1231, #1232, #1081).
//
// It runs the research importers, or fetches public pages, on a GitHub-hosted
// runner because the agents' sandboxes cannot reach those hosts, and pushes
// the result to a data/ branch. These tests run its real shell blocks: the
// input checks, the host allowlist and the page-to-text conversion. They also
// hold the rules that keep a write-capable job narrow: dispatch only, one
// permission, no expression inside `run:`, pinned actions, a data/ branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..', '..');
const FILE = '.github/workflows/research-import.yml';
const yml = readFileSync(resolve(root, FILE), 'utf8');
const lines = yml.split('\n');

/** The `run: |` block that starts on line `runAt`, dedented. */
function blockAt(runAt) {
  const keyIndent = lines[runAt].search(/\S/);
  const body = [];
  for (let i = runAt + 1; i < lines.length; i += 1) {
    const l = lines[i];
    if (l.trim() !== '' && l.search(/\S/) <= keyIndent) break;
    body.push(l);
  }
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  return body.map((l) => l.slice(indent)).join('\n');
}

/** The `run: |` block of the step with this name. */
function runBlock(stepName) {
  const at = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  assert.ok(at >= 0, `the workflow has a step named "${stepName}"`);
  return blockAt(lines.findIndex((l, i) => i > at && /^\s+run: \|\s*$/.test(l)));
}

/** Every `run: |` block in the file. */
function allRunBlocks() {
  return lines.flatMap((l, i) => (/^\s+run: \|\s*$/.test(l) ? [blockAt(i)] : []));
}

function bash(script, env, cwd) {
  return spawnSync('bash', ['-c', script], { cwd, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
}

test('it runs only when dispatched by hand, never on a push, a PR or a schedule', () => {
  const on = yml.slice(yml.indexOf('\non:'), yml.indexOf('\npermissions:'));
  assert.match(on, /workflow_dispatch:/);
  for (const trigger of ['push:', 'pull_request', 'schedule:', 'workflow_run', 'issue_comment']) {
    assert.ok(!on.includes(trigger), `no ${trigger} trigger`);
  }
});

test('the token may write contents and nothing else', () => {
  const perms = yml.slice(yml.indexOf('\npermissions:'), yml.indexOf('\nconcurrency:')).trim().split('\n');
  assert.deepEqual(perms.map((l) => l.trim()), ['permissions:', 'contents: write']);
});

test('no ${{ }} expression sits inside any run block, so a dispatched value is never spliced into a script', () => {
  const blocks = allRunBlocks();
  assert.equal(blocks.length, 4, 'the four run steps are read');
  for (const body of blocks) assert.ok(!body.includes('${{'), body.split('\n')[0]);
});

test('every action is pinned to a full commit SHA with its version comment', () => {
  const uses = lines.filter((l) => /^\s+- uses: /.test(l));
  assert.ok(uses.length >= 2);
  for (const l of uses) assert.match(l, /@[0-9a-f]{40} # v\d/, l.trim());
});

test('it pushes to a new data/ branch, and nowhere else', () => {
  const push = runBlock('Push what it wrote to a new branch');
  assert.match(push, /BRANCH="data\/\$\{SOURCE\}-\$\{GITHUB_RUN_ID\}"/);
  const pushes = push.split('\n').filter((l) => l.includes('git push'));
  assert.deepEqual(pushes.map((l) => l.trim()), ['git push -q origin "$BRANCH"']);
  assert.ok(!/\bmain\b/.test(push), 'the push step never names main');
});

test('the allowlist names exactly the data hosts the five imports read', () => {
  const m = /ALLOWED_HOSTS: (.+)/.exec(yml);
  assert.deepEqual(m[1].trim().split(/\s+/).sort(), [
    'docs.google.com', 'download.companieshouse.gov.uk', 'hello-tomorrow.org',
    'query.wikidata.org', 'www.hello-tomorrow.org', 'www.sec.gov',
  ]);
});

test('the input check refuses a taken migration number, a malformed name and an empty URL list', () => {
  const check = runBlock('Check the inputs');
  const run = (env) => bash(check, env, root);
  assert.equal(run({ SOURCE: 'wikidata', MIGRATION: '999_research_test_only.sql' }).status, 0);
  const taken = run({ SOURCE: 'sec-edgar', MIGRATION: '404_research_public_companies_again.sql' });
  assert.equal(taken.status, 1);
  assert.match(taken.stdout, /migration number 404 is already taken/);
  assert.equal(run({ SOURCE: 'companies-house', MIGRATION: '405_Bad-Name.sql' }).status, 1);
  assert.equal(run({ SOURCE: 'companies-house', MIGRATION: '' }).status, 1);
  assert.equal(run({ SOURCE: 'urls', URLS: '' }).status, 1);
  assert.equal(run({ SOURCE: 'something-else' }).status, 1);
});

test('the fetch step keeps a page as text with its terms links, a CSV as it came, and logs a failed URL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-import-'));
  const bin = join(dir, 'bin');
  const repo = join(dir, 'repo');
  const temp = join(dir, 'tmp');
  for (const d of [bin, repo, temp]) mkdirSync(d);
  // A stand-in for curl that answers by URL, the way the real hosts would.
  writeFileSync(join(bin, 'curl'), [
    '#!/bin/bash',
    'out=""; url=""',
    'while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -A|-w|--max-filesize) shift 2;; -*) shift;; *) url="$1"; shift;; esac; done',
    'case "$url" in',
    '  *export?format=csv*) printf "Fund,Country\\nAlpha,FR\\n" > "$out"; echo "text/csv";;',
    '  *missing*) exit 22;;',
    '  *) printf "<html><script>var hidden=1</script><body><h1>Hello</h1><p>Read  the terms.</p><a href=\\"/terms-of-use\\">Terms</a><a href=\\"/about\\">About</a></body></html>" > "$out"; echo "text/html; charset=utf-8";;',
    'esac',
  ].join('\n'));
  chmodSync(join(bin, 'curl'), 0o755);
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    RUNNER_TEMP: temp,
    GITHUB_STEP_SUMMARY: join(dir, 'summary'),
    GITHUB_RUN_ID: '7',
    UA: 'test',
    ALLOWED_HOSTS: /ALLOWED_HOSTS: (.+)/.exec(yml)[1].trim(),
    URLS: 'home=https://hello-tomorrow.org/ list.csv=https://docs.google.com/spreadsheets/d/x/export?format=csv gone=https://hello-tomorrow.org/missing',
  };
  const fetched = join(repo, 'attached_assets', 'fetched');
  const ok = bash(runBlock('Fetch the URLs'), env, repo);
  assert.equal(ok.status, 0, ok.stderr);
  const text = readFileSync(join(fetched, 'home.txt'), 'utf8');
  assert.match(text, /Hello/);
  assert.match(text, /Read the terms\./);
  assert.ok(!text.includes('hidden'), 'script content is dropped');
  assert.equal(readFileSync(join(fetched, 'home.links.txt'), 'utf8').trim(), '/terms-of-use');
  assert.equal(readFileSync(join(fetched, 'list.csv'), 'utf8'), 'Fund,Country\nAlpha,FR\n');
  const log = readFileSync(join(fetched, 'fetch-log.txt'), 'utf8');
  assert.match(log, /OK home https:\/\/hello-tomorrow\.org\//);
  assert.match(log, /FAILED gone https:\/\/hello-tomorrow\.org\/missing/);
  assert.ok(!existsSync(join(fetched, 'gone')), 'a failed URL writes no file');

  const refused = bash(runBlock('Fetch the URLs'), { ...env, URLS: 'x=https://example.com/terms' }, repo);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /host not allowed: example\.com/);
  const plain = bash(runBlock('Fetch the URLs'), { ...env, URLS: 'x=http://docs.google.com/a' }, repo);
  assert.equal(plain.status, 1, 'plain http is refused');
});

test('the workflows README has a row for it', () => {
  const readme = readFileSync(resolve(root, '.github/workflows/README.md'), 'utf8');
  assert.ok(readme.split('\n').some((l) => l.startsWith('| `research-import.yml` |')));
});
