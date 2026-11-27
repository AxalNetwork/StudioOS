import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  handTableFiles, handTableProblems, loadInventory, permissionsCell, renderInventory, run, withInventory, writeScopes,
} from '../../scripts/workflow-inventory.mjs';

const README = new URL('../../.github/workflows/README.md', import.meta.url);

test('the README workflow table and merge queue listener list match the YAML', () => {
  const workflows = loadInventory();
  assert.ok(workflows.some(workflow => workflow.file === 'ci.yml'));
  const readme = readFileSync(README, 'utf8');
  const expected = withInventory(readme, renderInventory(workflows));
  assert.ok(readme === expected, 'Run node scripts/workflow-inventory.mjs --write to update the generated inventory.');
  const generatedBlock = readme.split('<!-- workflow-inventory:start -->')[1].split('<!-- workflow-inventory:end -->')[0];
  const tableFiles = [...generatedBlock.matchAll(/^\| `([^\n`]+\.ya?ml)` \|/gm)].map(([, file]) => file);
  assert.deepEqual(tableFiles, workflows.map(workflow => workflow.file));
});

// #9054: the token-permissions column is built from each workflow's `permissions:` and each job's own block.
test('#9054: the Token permissions column states the workflow grant and every job that writes', () => {
  assert.equal(writeScopes(undefined), 'unset');
  assert.deepEqual(writeScopes({}), []);
  assert.deepEqual(writeScopes({ contents: 'read', issues: 'write', 'id-token': 'write' }), ['id-token', 'issues']);
  assert.equal(writeScopes('write-all'), 'write-all');
  assert.throws(() => writeScopes(['contents']), /Unexpected permissions/);
  const fixture = (permissions, jobs) => permissionsCell({ permissions, jobs: jobs.map(([id, p]) => ({ id, permissions: p })) });
  assert.equal(fixture(undefined, [['a', undefined]]), 'workflow: not set (repository default)');
  assert.equal(fixture({}, [['a', { contents: 'read' }], ['b', {}]]), 'workflow: none (`{}`)');
  assert.equal(fixture({ contents: 'read' }, [['a', { contents: 'read', 'pull-requests': 'write' }], ['b', 'write-all']]),
    'workflow: read only<br>`a` write: pull-requests<br>`b` `write-all`');
  assert.equal(fixture({ contents: 'write', issues: 'write' }, []), 'workflow: write: contents, issues');

  // The live rows the issue named as wrong or incomplete now come from the YAML.
  const readme = readFileSync(README, 'utf8');
  const row = file => readme.split('\n').find(line => line.startsWith(`| \`${file}\` | `) && line.includes('workflow: '));
  assert.match(row('branch-provision.yml'), /\| workflow: write: contents, pull-requests \|$/);
  assert.match(row('ci.yml'), /`capacity-submit` write: id-token.*`suite` write: actions.*`digest` write: pull-requests \|$/);
  assert.match(row('codeql.yml'), /`analyze` write: security-events/);
  assert.doesNotMatch(row('deck-visual.yml'), /write: .*contents/);
});

// #9054: the purpose table below the generated block is the one hand-written row per workflow.
test('#9054: every workflow has exactly one purpose row, and every row names a workflow that exists', () => {
  const readme = readFileSync(README, 'utf8');
  const files = loadInventory().map(workflow => workflow.file);
  assert.deepEqual(handTableProblems(readme, files), []);
  assert.deepEqual([...handTableFiles(readme)].sort(), [...files].sort());
  // `--check` runs the same rule and passes on this README.
  const quiet = { log: () => {}, error: () => {} };
  assert.equal(run('--check', quiet), 0);

  // A workflow added with no row, a row for a file that is gone, and a second row for one file are each refused.
  assert.deepEqual(handTableProblems(readme, [...files, 'fixture-added.yml']), ['fixture-added.yml has no row in the purpose table']);
  const gone = files.find(file => file === 'deck-visual.yml');
  assert.deepEqual(handTableProblems(readme, files.filter(file => file !== gone)), [`the purpose table has a row for ${gone}, which is not a workflow file`]);
  const firstRow = readme.split('\n').find(line => line.startsWith('| `ci-scorecard.yml` | D5603'));
  assert.ok(firstRow, 'the purpose table still starts with ci-scorecard.yml');
  assert.deepEqual(handTableProblems(readme.replace(firstRow, `${firstRow}\n${firstRow}`), files), ['ci-scorecard.yml has 2 rows in the purpose table']);
  // A row that does not lead with a file in backticks is refused rather than skipped.
  assert.throws(() => handTableFiles(readme.replace(firstRow, firstRow.replace('| `ci-scorecard.yml` |', '| ci-scorecard |'))), /does not start with a workflow file/);
});

// #9054: the generated column is the only statement of a GITHUB_TOKEN scope; the hand table names secrets.
test('#9054: no purpose row restates a GITHUB_TOKEN scope in its secrets column', () => {
  const readme = readFileSync(README, 'utf8');
  // The purpose table only: the rows from its header to the first line that is not a table row.
  const after = readme.slice(readme.indexOf('<!-- workflow-inventory:end -->')).split('\n').slice(1);
  const rows = after.slice(2, after.findIndex(line => !line.startsWith('|')));
  assert.equal(rows.length, handTableFiles(readme).length);
  const scope = /`(?:actions|attestations|checks|contents|deployments|id-token|issues|packages|pages|pull-requests|security-events|statuses): (?:read|write)`/;
  const offenders = rows.filter(line => scope.test(line.split(' | ').at(-1)));
  assert.deepEqual(offenders.map(line => line.slice(0, 60)), []);
  const deck = rows.find(line => line.startsWith('| `deck-visual.yml` |'));
  assert.doesNotMatch(deck, /contents: write|committed to the branch/);
});

// #9054 acceptance: `--check` fails when a fixture workflow is added with no row, and passes once its row is written.
test('#9054: --check fails on a fixture workflow with no purpose row, and --write cannot paper over it', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'workflows-9054-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const at = (name) => pathToFileURL(join(dir, name));
  writeFileSync(at('alpha.yml'), 'name: Alpha\non: push\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: []\n');
  const readmeUrl = at('README.md');
  const purpose = '| Workflow file | What it does | Triggers | Secrets, variables and environments |\n|---|---|---|---|\n| `alpha.yml` | A | push | none |\n';
  writeFileSync(readmeUrl, `# W\n\n<!-- workflow-inventory:start -->\n<!-- workflow-inventory:end -->\n${purpose}\nMore.\n`);
  const errors = [];
  const io = { directory: pathToFileURL(`${dir}/`), readmeUrl, log: () => {}, error: (m) => errors.push(m) };
  assert.equal(run('--write', io), 0);
  assert.equal(run('--check', io), 0, errors.join('\n'));
  assert.match(readFileSync(readmeUrl, 'utf8'), /\| `alpha\.yml` \| Alpha \|.*\| workflow: read only \|/);

  writeFileSync(at('beta.yml'), 'name: Beta\non: push\njobs:\n  b:\n    runs-on: ubuntu-latest\n    permissions:\n      issues: write\n    steps: []\n');
  errors.length = 0;
  assert.equal(run('--write', io), 0, '--write still writes the generated block');
  assert.match(errors.join('\n'), /beta\.yml has no row in the purpose table/);
  assert.match(readFileSync(readmeUrl, 'utf8'), /\| `beta\.yml` \| Beta \|.*\| workflow: not set \(repository default\)<br>`b` write: issues \|/);
  errors.length = 0;
  assert.equal(run('--check', io), 1);
  assert.deepEqual(errors.map((m) => m.split('.')[0]), ['Purpose table: beta']);

  writeFileSync(readmeUrl, readFileSync(readmeUrl, 'utf8').replace('| `alpha.yml` | A | push | none |\n', '| `alpha.yml` | A | push | none |\n| `beta.yml` | B | push | none |\n'));
  errors.length = 0;
  assert.equal(run('--check', io), 0, errors.join('\n'));
  // A generated block edited by hand is drift, as before #9054.
  writeFileSync(readmeUrl, readFileSync(readmeUrl, 'utf8').replace('workflow: read only', 'workflow: write: contents'));
  errors.length = 0;
  assert.equal(run('--check', io), 1);
  assert.match(errors.join('\n'), /Workflow inventory has drifted/);
});
