// D7151 (#7151): the release rollback class. Every fixture migration below is
// a real file from cloudflare-worker/sql/migrations/, read from disk, except
// the NOT NULL column with no default: SQLite refuses that statement on a
// table with rows, so no shipped migration carries one, and it is written
// here as the one synthetic statement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CLASSES,
  MANUAL_RULES,
  classifyRelease,
  classifyStatement,
  pendingFromPlan,
  previousVersion,
  productionConfig,
  reduceVersion,
  removedBindings,
  renderSummary,
  sqlStatements,
} from './rollbackClass.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'cloudflare-worker', 'sql', 'migrations');
const file = (name) => ({ name, sql: readFileSync(path.join(DIR, name), 'utf8') });
const rules = (r) => [...new Set(r.reasons.map((x) => x.rule))].sort();

const CANDIDATE = productionConfig(readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8'));
const LIVE_TAG = CANDIDATE.migrationTags.at(-1);
const LIVE = {
  id: '0b1c2d3e-0000-4000-8000-000000000001',
  bindings: CANDIDATE.bindings.map((name) => ({ name, type: 'kv_namespace' })),
  migrationTag: LIVE_TAG,
  commit: null,
};
const PREVIOUS = { id: LIVE.id, split: false, versions: [{ id: LIVE.id, percentage: 100 }] };
const release = (names, over = {}) => {
  const migrations = names.map((n) => (typeof n === 'string' ? file(n) : n));
  return classifyRelease({
    plan: migrations.map((m) => m.name),
    migrations,
    candidate: CANDIDATE,
    deployed: LIVE,
    deployedTag: LIVE_TAG,
    previous: PREVIOUS,
    ...over,
  });
};

// ── the three classes ──────────────────────────────────────────────────────

test('auto: no pending migration, the live tag is the last, every binding kept, one version to return to', () => {
  const r = release([]);
  assert.equal(r.class, 'auto');
  assert.deepEqual(r.reasons, []);
  assert.equal(r.previousVersionId, LIVE.id);
  assert.deepEqual(r.pendingDoTags, []);
  assert.equal(r.reportOnly, true);
  assert.deepEqual(CLASSES, ['auto', 'auto-additive', 'manual']);
});

test('auto-additive: real migrations that only add a nullable column, a table and an index', () => {
  const r = release(['202611161255_6908_pro_rata_offer.sql', '202611161155_6218_portfolio_attention_alerts.sql']);
  assert.equal(r.class, 'auto-additive');
  assert.deepEqual(r.reasons, []);
  const kinds = new Set(r.additive.map((a) => a.kind));
  assert.ok(kinds.has('add-column') && kinds.has('create-table') && kinds.has('create-index'), [...kinds].join());
});

test('auto-additive: a trigger, a unique index and rows confined to a table the release creates', () => {
  // 6689 creates the formation catalogue with append-only triggers; 6690 seeds
  // it. Released together, nothing touches a table the previous Worker knows.
  const r = release(['202611151923_6689_formation_catalogue.sql', '202611161600_6690_formation_catalogue_seed_v1.sql']);
  assert.equal(r.class, 'auto-additive', JSON.stringify(r.reasons.slice(0, 2)));
  const kinds = new Set(r.additive.map((a) => a.kind));
  assert.ok(kinds.has('trigger-on-new-table'), [...kinds].join());
  assert.ok(kinds.has('seed-new-table'), [...kinds].join());
});

test('the seed alone, without the release that creates its tables, writes rows into existing tables: manual', () => {
  const r = release(['202611161600_6690_formation_catalogue_seed_v1.sql']);
  assert.equal(r.class, 'manual');
  assert.ok(rules(r).includes('data-write'), rules(r).join());
});

test('a CHECK naming a column the same release adds stays additive (202611022205 work_workload)', () => {
  const r = release(['202611022205_work_workload.sql']);
  assert.equal(r.class, 'auto-additive', JSON.stringify(r.reasons));
});

// ── each manual reason ─────────────────────────────────────────────────────

const ONE_RULE = [
  ['drop', '202611022352_retire_messages.sql'],
  ['data-rewrite', '202611161117_6872_obligation_event_types.sql'],
  ['data-write', '202611161045_6686_formation_case_stage_records.sql'],
  ['unique-index', '202611152342_6216_portfolio_support_ask_link.sql'],
  ['trigger', '202611161239_6909_mark_request_evidence.sql'],
  ['unrecognised', '547_partner_invitation_sends.sql'],
  ['cross-column-check', '385_research_disposition_collections.sql'],
];
for (const [rule, name] of ONE_RULE) {
  test(`manual: ${rule} (${name})`, () => {
    const r = release([name]);
    assert.equal(r.class, 'manual');
    assert.deepEqual(rules(r), [rule]);
    assert.equal(r.reasons[0].file, name);
    assert.equal(r.reasons[0].text, MANUAL_RULES[rule]);
  });
}

test('manual: rename, with the file and the line it starts on (6687 rebuilds incorporations)', () => {
  const name = '202611161616_6687_incorporations_company_subject.sql';
  const r = release([name]);
  assert.equal(r.class, 'manual');
  const rename = r.reasons.find((x) => x.rule === 'rename');
  assert.ok(rename, rules(r).join());
  const lines = file(name).sql.split('\n');
  assert.match(lines[rename.line - 1], /^ALTER TABLE incorporations_new RENAME TO incorporations/);
  const drops = r.reasons.filter((x) => x.rule === 'drop').map((x) => lines[x.line - 1]);
  assert.ok(drops.includes('DROP TABLE incorporations;'), drops.join(' / '));
});

test('manual: a NOT NULL column with no default (synthetic: SQLite refuses it, so no shipped file has one)', () => {
  const r = release([{ name: '202611180000_7151_example.sql', sql: '-- x\nALTER TABLE deals ADD COLUMN owner_id INTEGER NOT NULL;\n' }]);
  assert.deepEqual(rules(r), ['not-null-no-default']);
  assert.equal(r.reasons[0].line, 2);
  const ok = release([{ name: '202611180000_7151_example.sql', sql: 'ALTER TABLE deals ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 0;' }]);
  assert.equal(ok.class, 'auto-additive');
});

test('manual: an unreadable plan, an unreadable file', () => {
  assert.deepEqual(rules(release([], { plan: null })), ['plan-unreadable']);
  const r = release([{ name: '202611180000_7151_gone.sql', sql: null }]);
  assert.deepEqual(rules(r), ['migration-unreadable']);
  assert.equal(r.reasons[0].file, '202611180000_7151_gone.sql');
});

test('manual: a Durable Object migration the release adds, a live tag not in the list, an unknown live tag', () => {
  const more = { ...CANDIDATE, migrationTags: [...CANDIDATE.migrationTags, 'v9-new-room'] };
  const r = release([], { candidate: more });
  assert.deepEqual(rules(r), ['do-migration']);
  assert.deepEqual(r.pendingDoTags, ['v9-new-room']);
  assert.match(r.reasons[0].text, /v9-new-room/);
  assert.deepEqual(rules(release([], { deployedTag: 'v0-gone' })), ['do-tag-foreign']);
  assert.deepEqual(rules(release([], { deployedTag: null })), ['do-tag-unknown']);
  // A Worker with no Durable Object migrations has nothing to cross.
  assert.equal(release([], { deployedTag: null, candidate: { ...CANDIDATE, migrationTags: [] } }).class, 'auto');
});

test('manual: a removed binding; a removed variable or secret is not one; unknown bindings are manual', () => {
  const deployed = { ...LIVE, bindings: [...LIVE.bindings, { name: 'OLD_BUCKET', type: 'r2_bucket' },
    { name: 'OLD_FLAG', type: 'plain_text' }, { name: 'OLD_SECRET', type: 'secret_text' }, { name: 'OLD_JSON', type: 'json' }] };
  const r = release([], { deployed });
  assert.deepEqual(rules(r), ['binding-removed']);
  assert.deepEqual(r.removedBindings, [{ name: 'OLD_BUCKET', type: 'r2_bucket' }]);
  assert.deepEqual(rules(release([], { deployed: null })), ['bindings-unknown']);
});

test('manual: no recorded version to return to, or traffic split across two', () => {
  assert.deepEqual(rules(release([], { previous: { id: null, split: false, versions: [] } })), ['previous-version-unknown']);
  assert.deepEqual(rules(release([], { previous: { id: null, split: true, versions: [] } })), ['split-deployment']);
});

test('a mixed release: one destructive file makes the whole release manual, the additive ones are still listed', () => {
  const r = release(['202611161255_6908_pro_rata_offer.sql', '202611022352_retire_messages.sql',
    '202611161155_6218_portfolio_attention_alerts.sql'], { candidate: { ...CANDIDATE, migrationTags: [...CANDIDATE.migrationTags, 'v9-x'] } });
  assert.equal(r.class, 'manual');
  assert.deepEqual(rules(r), ['do-migration', 'drop']);
  assert.ok(r.reasons.filter((x) => x.rule === 'drop').every((x) => x.file === '202611022352_retire_messages.sql'));
  const additiveFiles = new Set(r.additive.map((a) => a.file));
  assert.ok(additiveFiles.has('202611161255_6908_pro_rata_offer.sql') && additiveFiles.has('202611161155_6218_portfolio_attention_alerts.sql'), [...additiveFiles].join());
});

// ── the parts ──────────────────────────────────────────────────────────────

test('statements: quotes keep ; and --, a trigger body stays whole, lines are where each statement starts', () => {
  const sql = "-- head\nINSERT INTO t VALUES ('a;b -- c');\n/* x\n y */ CREATE TRIGGER g AFTER INSERT ON t BEGIN\n  UPDATE t SET a = 1;\nEND;\nSELECT \"x;\";";
  const st = sqlStatements(sql);
  assert.deepEqual(st.map((s) => s.line), [2, 4, 7]);
  assert.equal(st[0].text, "INSERT INTO t VALUES ('a;b -- c')");
  assert.match(st[1].text, /^CREATE TRIGGER g .* END$/);
});

test('statement rules not reached by a whole file above', () => {
  assert.equal(classifyStatement('CREATE VIEW IF NOT EXISTS v AS SELECT 1').kind, 'create-view');
  assert.equal(classifyStatement('ALTER TABLE t DROP COLUMN c').rule, 'drop');
  assert.equal(classifyStatement('ALTER TABLE t RENAME COLUMN a TO b').rule, 'rename');
  assert.equal(classifyStatement('DELETE FROM t WHERE 1').rule, 'data-rewrite');
  assert.equal(classifyStatement('REPLACE INTO t VALUES (1)').rule, 'data-write');
  assert.equal(classifyStatement('PRAGMA defer_foreign_keys = TRUE').rule, 'unrecognised');
  assert.equal(classifyStatement('ALTER TABLE t ADD COLUMN p INTEGER DEFAULT 1 REFERENCES x(id)').rule, 'cross-column-check');
  assert.equal(classifyStatement('ALTER TABLE t ADD COLUMN p INTEGER REFERENCES x(id)').kind, 'add-column');
  const created = new Set(['n']);
  assert.equal(classifyStatement('DELETE FROM "main"."N" WHERE 1', created).kind, 'rows-of-new-table');
  assert.equal(classifyStatement('CREATE UNIQUE INDEX u ON n (a)', created).kind, 'create-index');
});

test('the dry-run plan: pending files, and no plan when the runner refused or printed something else', () => {
  const plan = '[migrate-d1] x\n\n[migrate-d1] Plan:\n  skip  001_a.sql\n  apply 202611180000_7151_b.sql\n';
  assert.deepEqual(pendingFromPlan(plan), ['202611180000_7151_b.sql']);
  assert.deepEqual(pendingFromPlan('[migrate-d1] Plan:\n  skip  001_a.sql\n'), []);
  assert.equal(pendingFromPlan('[migrate-d1] no plan here'), null);
  assert.equal(pendingFromPlan(null), null);
  assert.equal(pendingFromPlan(`  A live run in apply mode would REFUSE rather than replay history.\n${plan}`), null);
  assert.equal(pendingFromPlan('[migrate-d1] Plan:\n  mark  001_a.sql\n'), null);
  assert.equal(pendingFromPlan('[migrate-d1] Plan:\n  apply 001_a.sql\n✖ boom\n'), null);
});

test('wrangler.toml: production tags in order, binding names, no variables', () => {
  assert.equal(CANDIDATE.migrationTags[0], 'v1-realtime');
  for (const b of ['DB', 'ASSETS', 'AGENT_TASK', 'JOB_QUEUE', 'PIPELINE_ROOM', 'FILES', 'AI']) assert.ok(CANDIDATE.bindings.includes(b), b);
  assert.ok(!CANDIDATE.bindings.includes('studioos-agent-task'), 'a workflow is named by its binding');
  const toml = '[[kv_namespaces]]\nbinding = "TOP"\n[env.production.vars]\nbinding = "A_VARIABLE_NAMED_BINDING"\n[[env.production.migrations]]\ntag = "a"\n[[env.production.migrations]]\ntag = "b"\n[[env.production.kv_namespaces]]\nbinding = "K"\n[[migrations]]\ntag = "top"\n';
  assert.deepEqual(productionConfig(toml), { migrationTags: ['a', 'b'], bindings: ['K'] });
});

test('the live version: only names, types, tag and commit survive; the deployment list names the rollback target', () => {
  const sha = 'a'.repeat(40);
  const v = reduceVersion({ id: 'v1', metadata: { author_email: 'someone@example.com' }, resources: {
    script_runtime: { migration_tag: 'v8' }, bindings: [{ name: 'WORKER_DEPLOY_VERSION', type: 'plain_text', text: sha }, { name: 'K', type: 'kv_namespace', namespace_id: 'n' }] } });
  assert.deepEqual(v, { id: 'v1', bindings: [{ name: 'WORKER_DEPLOY_VERSION', type: 'plain_text' }, { name: 'K', type: 'kv_namespace' }], migrationTag: 'v8', commit: sha });
  assert.ok(!JSON.stringify(v).includes('someone@example.com'), 'the version author\'s email survived');
  assert.equal(reduceVersion({ resources: {} }), null);
  assert.equal(reduceVersion({ resources: { bindings: [{ name: 'WORKER_DEPLOY_VERSION', type: 'plain_text', text: 'not-a-sha' }] } }).commit, null);
  const list = [
    { created_on: '2026-11-18T10:00:00Z', versions: [{ version_id: 'new', percentage: 100 }] },
    { created_on: '2026-11-17T10:00:00Z', versions: [{ version_id: 'old', percentage: 100 }] },
  ];
  assert.equal(previousVersion(list).id, 'new');
  const split = previousVersion([{ created_on: 'x', versions: [{ version_id: 'a', percentage: 50 }, { version_id: 'b', percentage: 50 }] }]);
  assert.deepEqual([split.id, split.split], [null, true]);
  const partial = previousVersion([{ created_on: 'x', versions: [{ version_id: 'a', percentage: 40 }] }]);
  assert.deepEqual([partial.id, partial.split], [null, false]);
  assert.deepEqual(previousVersion(null), { id: null, split: false, versions: [] });
  assert.deepEqual(removedBindings([{ name: 'A', type: 'inherit' }], []), []);
});

test('the summary names the class, the target and each reason with its file and line', () => {
  const r = release(['202611022352_retire_messages.sql']);
  const md = renderSummary(r);
  assert.match(md, /^### Rollback class: `manual` \(report only, D7151\)/);
  assert.match(md, new RegExp(`Rollback target .*\`${LIVE.id}\``));
  assert.match(md, /\| `drop` \| 202611022352_retire_messages\.sql:16 \|/);
  assert.match(renderSummary(release([])), /`auto`[\s\S]*Nothing in this release changes/);
  assert.match(renderSummary(release(['202611161255_6908_pro_rata_offer.sql'])), /`auto-additive`[\s\S]*only adds/);
});

// ── the release step ───────────────────────────────────────────────────────

const WORKFLOW = readFileSync(path.join(ROOT, '.github', 'workflows', 'cloudflare-worker-deploy.yml'), 'utf8');
const DEPLOY = WORKFLOW.split('\n  deploy:\n')[1].split('\n  spa-smoke:\n')[0];
const STEPS = DEPLOY.split(/^ {6}- (?:name: |uses: )/m).slice(1).map((s) => s.trim());
const NAMES = STEPS.map((s) => s.split('\n')[0]);

test('the release records the class after the plan and before the last admission check and every write', () => {
  const at = NAMES.indexOf('Record the release rollback class');
  assert.ok(at > 0, 'no rollback class step');
  assert.equal(NAMES[at - 1], 'Record migration plan and previous Worker version');
  assert.equal(NAMES[at + 1], 'Confirm the candidate still owns the production release');
  assert.ok(at < NAMES.indexOf('Apply pending D1 migrations') && at < NAMES.indexOf('Deploy to Cloudflare Worker'));
  const step = STEPS[at];
  assert.match(step, /\n {8}continue-on-error: true\n/, 'report only: it must never fail the release');
  assert.doesNotMatch(step, /\n {8}id: /, 'report only: no later step may read its outcome');
  assert.match(step, /run: node scripts\/release-rollback-class\.mjs "\$RUNNER_TEMP\/release-evidence"$/);
  assert.doesNotMatch(DEPLOY, /steps\.[\w-]*rollback[\w-]*\.outputs/i, 'nothing acts on the class until #7152');
});

test('the release step exits 0 and records manual when it can read nothing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rollback-class-'));
  try {
    const summary = path.join(dir, 'summary.md');
    writeFileSync(summary, '');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'release-rollback-class.mjs'), dir], {
      encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: summary },
    });
    assert.equal(r.status, 0, r.stderr);
    const rec = JSON.parse(readFileSync(path.join(dir, 'rollback-class.json'), 'utf8'));
    assert.equal(rec.class, 'manual');
    assert.deepEqual([...new Set(rec.reasons.map((x) => x.rule))].sort(), ['bindings-unknown', 'do-tag-unknown', 'plan-unreadable', 'previous-version-unknown']);
    assert.match(readFileSync(summary, 'utf8'), /Rollback class: `manual`/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a fault inside the release step is recorded as manual and still exits 0', () => {
  const dir = path.join(tmpdir(), 'rollback-class-missing-dir', 'nowhere');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'release-rollback-class.mjs'), dir], {
    encoding: 'utf8', env: { PATH: process.env.PATH },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Rollback class: `manual`[\s\S]*`classifier-error`/);
});

test('the summary escapes backslashes before pipes, so a file name cannot break or forge a table cell', () => {
  const md = renderSummary({ class: 'manual', previousVersionId: null, pendingMigrations: [], removedBindings: [],
    reasons: [{ rule: 'drop', file: 'a\\|b', line: 1, detail: 'x\ny' }] });
  const row = md.split('\n').find((l) => l.includes('`drop`'));
  assert.ok(row.includes('a\\\\\\|b'), row);
  assert.ok(!row.includes('x\ny'));
});
