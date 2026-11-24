/**
 * #8078 (D8078): venture namespaces. Venture code lives in `ventures/<slug>/` (owner, Q1 A); only the owner adds a
 * namespace, in the root `ventures.json` (Q2 A). The branch parser reads both shapes, the `venture:<slug>` labels
 * are generated from `ventures.json` and kept in step, and a branch is confined to its own venture's folder.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  parseBranch, validateVentures, ventureBranchViolations, ventureLabelsBlock, ventureOfPath, VENTURE_SLUG, withVentureLabels,
} from '../../scripts/lib/workIntent.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const VENTURES = [{ slug: 'globex', name: 'Globex', company_id: 9 }, { slug: 'acme', name: 'Acme', company_id: 2 }];

test('#8078: the parser reads platform and venture branches, and nothing else', () => {
  assert.deepEqual(parseBranch('agent/S20/8078-venture-namespaces'), { kind: 'platform', owner: 'S20', issue: 8078, slug: 'venture-namespaces' });
  assert.deepEqual(parseBranch('agent/claude/8078-x'), { kind: 'platform', owner: 'claude', issue: 8078, slug: 'x' });
  assert.deepEqual(parseBranch('refs/heads/agent/S20/acme/12-landing-page'), { kind: 'venture', owner: 'S20', venture: 'acme', issue: 12, slug: 'landing-page' });
  for (const ref of ['main', 'agent/S20', 'agent/S20/x-12', 'agent/S20/0-x', 'agent/S20/Acme/12-x', 'agent/S20/acme/beta/12-x', 'agent/S20/acme/12', 'feature/S20/12-x', 'agent/S20/-a/12-x', null]) {
    assert.deepEqual(parseBranch(ref), { kind: 'other' }, String(ref));
  }
});

test('#8078: a venture slug is lowercase, starts with a letter and has no stray hyphen', () => {
  for (const ok of ['acme', 'a1', 'acme-labs', 'x'.repeat(40)]) assert.ok(VENTURE_SLUG.test(ok), ok);
  for (const bad of ['a', 'Acme', '1acme', 'acme-', '-acme', 'acme--labs', 'x'.repeat(41), 'acme_labs', 'acme/labs']) assert.ok(!VENTURE_SLUG.test(bad), bad);
});

test('#8078: a branch is confined to its own venture, and a platform branch to no venture', () => {
  assert.equal(ventureOfPath('ventures/acme/app/a.ts'), 'acme');
  assert.equal(ventureOfPath('frontend/src/a.jsx'), null);
  assert.equal(ventureOfPath('ventures/'), null);
  assert.deepEqual(ventureBranchViolations('agent/S20/acme/12-x', ['ventures/acme/a.ts'], VENTURES), []);
  assert.deepEqual(ventureBranchViolations('agent/S20/acme/12-x', ['ventures/globex/b.ts', 'scripts/a.mjs'], VENTURES), [
    { path: 'ventures/globex/b.ts', reason: 'belongs to venture globex, not acme' },
    { path: 'scripts/a.mjs', reason: 'is outside ventures/acme/' },
  ]);
  assert.deepEqual(ventureBranchViolations('agent/S20/12-x', ['ventures/acme/a.ts', 'scripts/a.mjs'], VENTURES), [
    { path: 'ventures/acme/a.ts', reason: 'belongs to venture acme: use a branch agent/<slot>/acme/<issue>-<slug>' },
  ]);
  // A venture the owner has not declared owns nothing, not even its own folder.
  assert.deepEqual(ventureBranchViolations('agent/S20/initech/12-x', ['ventures/initech/a.ts'], VENTURES), [
    { path: 'ventures/initech/a.ts', reason: 'venture initech is not in ventures.json' },
  ]);
});

test('#8078: ventures.json is valid, and only the owner\'s fields are accepted', () => {
  const doc = JSON.parse(read('ventures.json'));
  const v = validateVentures(doc);
  assert.ok(v.ok, v.problems.join('; '));
  assert.deepEqual(validateVentures({ version: 1, ventures: VENTURES }).problems, []);
  const cases = [
    [{ ventures: [] }, /must be/],
    [{ version: 1, ventures: [{ ...VENTURES[0], slug: 'Globex' }] }, /slug is not a venture slug/],
    [{ version: 1, ventures: [VENTURES[0], { ...VENTURES[1], slug: 'globex' }] }, /used twice/],
    [{ version: 1, ventures: [VENTURES[0], { ...VENTURES[1], company_id: 9 }] }, /already has a venture/],
    [{ version: 1, ventures: [{ ...VENTURES[0], company_id: 0 }] }, /not a company id/],
    [{ version: 1, ventures: [{ ...VENTURES[0], name: 'Say "hi"' }] }, /name must be/],
    [{ version: 1, ventures: [{ ...VENTURES[0], repo: 'x/y' }] }, /unknown fields: repo/],
  ];
  for (const [doc2, why] of cases) {
    const r = validateVentures(doc2);
    assert.equal(r.ok, false);
    assert.deepEqual(r.ventures, []);
    assert.match(r.problems.join('; '), why);
  }
});

test('#8078: the venture labels are generated in slug order, and labels.yml is in step with ventures.json', () => {
  const block = ventureLabelsBlock(VENTURES);
  assert.match(block, /^# venture-labels:begin[^\n]*\n- name: "venture:acme"\n {2}color: "0E8A16"\n {2}description: "Work in the Acme venture namespace, ventures\/acme\/ \(D8078\)"\n- name: "venture:globex"/);
  assert.match(block, /\n# venture-labels:end$/);
  const labels = read('.github/labels.yml');
  const ventures = validateVentures(JSON.parse(read('ventures.json'))).ventures;
  assert.equal(withVentureLabels(labels, ventures), labels, 'run: node scripts/lib/workIntent.mjs --venture-labels');
  // Adding a venture changes only the block.
  const next = withVentureLabels(labels, VENTURES);
  assert.notEqual(next, labels);
  assert.equal(withVentureLabels(next, ventures), labels);
  assert.throws(() => withVentureLabels('- name: "x"\n', VENTURES), /no single venture-labels block/);
  const twice = `${labels}\n# venture-labels:begin (generated from ventures.json, D8078; never edit by hand)\n# venture-labels:end\n`;
  assert.throws(() => withVentureLabels(twice, VENTURES), /no single venture-labels block/);
  // A hand-added venture label outside the block is not allowed.
  assert.doesNotMatch(labels.replace(/# venture-labels:begin[\s\S]*?# venture-labels:end/, ''), /name: "venture:/);
});

test('#8078: the CLI check passes on main\'s files', () => {
  const out = execFileSync(process.execPath, ['scripts/lib/workIntent.mjs', '--venture-labels', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(out, '');
});

test('#8078: the CLI check fails when a venture is added without its label, and the write mode fixes it', () => {
  // A copy of the two files the CLI reads, so the real files are never written.
  const dir = mkdtempSync(join(tmpdir(), 'ventures-'));
  mkdirSync(join(dir, '.github'));
  writeFileSync(join(dir, '.github/labels.yml'), read('.github/labels.yml'));
  writeFileSync(join(dir, 'ventures.json'), JSON.stringify({ version: 1, ventures: VENTURES }));
  const run = (...a) => { try { execFileSync(process.execPath, ['scripts/lib/workIntent.mjs', '--venture-labels', `--root=${dir}`, ...a], { cwd: ROOT, stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
  assert.equal(run('--check'), 1);
  assert.equal(run(), 0);
  assert.equal(run('--check'), 0);
  assert.match(readFileSync(join(dir, '.github/labels.yml'), 'utf8'), /name: "venture:acme"[\s\S]*name: "venture:globex"/);
  writeFileSync(join(dir, 'ventures.json'), JSON.stringify({ version: 1, ventures: [{ slug: 'Bad', name: 'x', company_id: 1 }] }));
  assert.equal(run('--check'), 1, 'an invalid ventures.json fails');
});
