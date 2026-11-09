/**
 * #4532 — the skill library's CI gate (`scripts/check-skill-library.mjs`, rules
 * in `services/agents/skillCatalogue.ts`) and its reconciliation with the store.
 *
 *   1. The committed library passes with no error, and the manifest covers every source file.
 *   2. Each targeted defect fails with its own rule, file and slug (the mutation fixtures the issue lists).
 *   3. The reconciliation, on a local D1: exact, source-only, persisted-only, content and case drift,
 *      a missing case, HQ against company scope, a duplicate on either side; and it writes nothing.
 *   4. The summary says the model evaluation and an absent reconciliation were not run.
 *   5. The command exits 0 on the repository and writes its JSON summary, and exits 1 on a failing reconciliation.
 *
 * Every record here is made up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeD1 } from './_d1_sqlite.mjs';
import { stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { checkSourceCatalogue, persistedManifest, reconcile, summary, type Finding } from '../src/services/agents/skillCatalogue.ts';
import { seedLibrary } from '../src/services/agents/skillLibrarySeed.ts';
import { SKILL_LIBRARY } from '../src/services/agents/skillLibrary.generated.ts';
import { readSources, taxonomyFromSeed } from '../../scripts/check-skill-library.mjs';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const TAXONOMY = taxonomyFromSeed(sql('migrations/090_seed_skills_values_taxonomy.sql'));
const SLUG = 'board-meeting-brief';
const REAL = readSources();
const MD = REAL.definitions[`${SLUG}.md`];
const CASE = REAL.cases[`${SLUG}.json`];

/** A one-skill catalogue, mutated by `over`. */
async function check(over: { definitions?: Record<string, string>; cases?: Record<string, string>; fresh?: boolean; generated?: any[] } = {}) {
  const definitions = over.definitions ?? { [`${SLUG}.md`]: MD };
  const cases = over.cases ?? { [`${SLUG}.json`]: CASE };
  const generated = over.generated ?? Object.keys(definitions).sort().map((f) => f.slice(0, -3))
    .map((s) => ({ slug: s, skill_md: definitions[`${s}.md`], cases: [] }));
  return checkSourceCatalogue({ definitions, cases, generated, generatedFresh: over.fresh ?? true, taxonomy: TAXONOMY });
}
const errors = (fs: Finding[]) => fs.filter((f) => f.level === 'error');
const rules = (fs: Finding[]) => errors(fs).map((f) => f.rule);

test('the committed library passes with no error, and the manifest covers every source file', async () => {
  const { findings, manifest } = await checkSourceCatalogue({ ...REAL, generated: SKILL_LIBRARY, generatedFresh: true, taxonomy: TAXONOMY });
  assert.deepEqual(errors(findings), []);
  assert.equal(manifest.length, Object.keys(REAL.definitions).length, 'one line per definition, whatever the total');
  assert.ok(manifest.every((m) => m.draft_hash && m.cases.length === 1));
  assert.equal(new Set(manifest.flatMap((m) => m.cases.map((c) => c.case_id))).size, manifest.length, 'distinct case identities');
  // `refuse_when` is carried but never evaluated: a warning, so nobody reads it as an assertion.
  assert.ok(findings.some((f) => f.rule === 'expect_key_unknown' && f.field === 'expect.refuse_when'));
  // #4531: `numbers` is judged, so a case that asserts one is not told it proves nothing.
  const withNumbers = JSON.parse(CASE);
  withNumbers.expect.numbers = [{ metric: 'Runway', value: 14, unit: 'months', tolerance: 0 }];
  const numbered = await check({ cases: { [`${SLUG}.json`]: JSON.stringify(withNumbers) } });
  assert.deepEqual(errors(numbered.findings), []);
  assert.ok(!numbered.findings.some((f) => f.rule === 'expect_key_unknown'));
  // #4531 slice 2: the new assertions are judged too, and a malformed one is the runtime's case_invalid error.
  const withMore = JSON.parse(CASE);
  const key = Object.keys(withMore.input.records)[0];
  Object.assign(withMore.expect, {
    structure: { sections: ['Summary', 'Risks'] }, evidence: { cite: [key] }, refusal: { mode: 'not_recorded', subject: 'runway' },
    claims: { required: [{ subject: 'cash', object: 'recorded' }] }, output_schema: { format: 'json', schema: { type: 'object' } },
  });
  const more = await check({ cases: { [`${SLUG}.json`]: JSON.stringify(withMore) } });
  assert.deepEqual(errors(more.findings), []);
  assert.ok(!more.findings.some((f) => f.rule === 'expect_key_unknown'));
  withMore.expect.evidence = { cite: ['stripe.read'] };
  const madeUp = await check({ cases: { [`${SLUG}.json`]: JSON.stringify(withMore) } });
  assert.deepEqual(errors(madeUp.findings).map((f) => [f.rule, f.message]), [['case_invalid', 'The case asks for a citation of stripe.read, which its records do not hold.']]);
});

test('each targeted defect fails with its own rule, file and slug', async () => {
  const md = (from: string, to: string) => ({ definitions: { [`${SLUG}.md`]: MD.replace(from, to) } });
  const kase = (patch: (c: any) => void) => { const c = JSON.parse(CASE); patch(c); return { cases: { [`${SLUG}.json`]: JSON.stringify(c) } }; };
  const tagLine = /^taxonomy: .*$/m.exec(MD)![0];
  const firstTag = /\{([a-z_]+):/.exec(tagLine)![1];
  const toolLine = /^tools: .*$/m.exec(MD)![0];
  const recordKey = Object.keys(JSON.parse(CASE).input.records)[0];
  const cases: Array<[string, Parameters<typeof check>[0], string]> = [
    ['an invalid slug', { definitions: { 'Board_Brief.md': MD.replace(`name: ${SLUG}`, 'name: Board_Brief') }, cases: { 'Board_Brief.json': CASE } }, 'slug_invalid'],
    ['an unknown taxonomy tag', md(`${firstTag}:`, 'no_such_skill:'), 'tag_unknown'],
    ['an invalid proficiency', md(tagLine, tagLine.replace(/: (aware|working|proficient|advanced|expert)/, ': wizard')), 'tags_invalid'],
    ['an unknown role', md(/^roles: \[([a-z_]+)/m.exec(MD)![0], 'roles: [chief_vibes_officer'), 'role_unknown'],
    ['a write tool', md(toolLine, toolLine.replace(/\]$/, ', mercury.create_transfer]')), 'tool_not_read_only'],
    ['a tool from no read source', md(toolLine, toolLine.replace(/\]$/, ', hubspot.read]')), 'tool_source_unknown'],
    ['a malformed case', { cases: { [`${SLUG}.json`]: '{ "skill": ' } }, 'case_malformed'],
    ['a case with an email', kase((c) => { c.input.records[recordKey].contact = 'someone@example.com'; }), 'case_has_email'],
    ['a case with no phrase', kase((c) => { c.expect = { output: c.expect.output }; }), 'case_invalid'],
    ['a case for another skill', kase((c) => { c.skill = 'weekly-kpi-digest'; }), 'case_skill_mismatch'],
    ['a case expecting another output', kase((c) => { c.expect.output = c.expect.output === 'brief' ? 'draft' : 'brief'; }), 'case_output_mismatch'],
    ['a record from a read the skill does not list', kase((c) => { c.input.records['github.repos'] = { repos: 1 }; }), 'record_key_outside_tools'],
    ['a record keyed by no read', kase((c) => { c.input.records['made.up'] = { x: 1 }; }), 'record_key_unknown'],
    ['a missing case', { cases: {} }, 'case_missing'],
    ['an orphan case', { cases: { [`${SLUG}.json`]: CASE, 'no-such-skill.json': CASE } }, 'case_orphan'],
    ['a duplicate slug', { definitions: { [`${SLUG}.md`]: MD, 'board-meeting-brief-copy.md': MD }, cases: { [`${SLUG}.json`]: CASE, 'board-meeting-brief-copy.json': CASE } }, 'duplicate_slug'],
    ['a stale generated module', { fresh: false }, 'generated_stale'],
    ['a generated module out of order', { generated: [{ slug: 'zz', skill_md: '', cases: [] }, { slug: SLUG, skill_md: MD, cases: [] }] }, 'generated_order'],
  ];
  for (const [what, over, rule] of cases) {
    const { findings } = await check(over);
    assert.ok(rules(findings).includes(rule), `${what}: expected ${rule}, got ${JSON.stringify(rules(findings))}`);
    const f = errors(findings).find((x) => x.rule === rule)!;
    assert.ok(f.file && f.message && f.remediation, `${what}: file, message and remediation`);
  }
  // A first tag with no radar area: a taxonomy whose category is not an axis.
  const odd = new Map(TAXONOMY); odd.set(firstTag, 'not_an_axis');
  const area = await checkSourceCatalogue({ definitions: { [`${SLUG}.md`]: MD }, cases: { [`${SLUG}.json`]: CASE }, generated: [{ slug: SLUG, skill_md: MD, cases: [] }], generatedFresh: true, taxonomy: odd });
  assert.deepEqual(rules(area.findings), ['area_unknown']);
  // An unknown frontmatter key is a warning, not a failure.
  const extra = await check(md('version: 1', 'version: 1\nowner: someone'));
  assert.deepEqual(rules(extra.findings), []);
  assert.ok(extra.findings.some((f) => f.rule === 'front_key_unknown' && f.level === 'warning'));
  // And the unmutated fixture is clean, so each rule above is the mutation's.
  assert.deepEqual(rules((await check()).findings), []);
});

function world() {
  const { DB, db } = makeD1(['users', 'company_profiles', 'user_company_links', 'projects', 'activity_logs'].map((t) => stripForeignKeys(tableFromBaseline(sql('schema_baseline.sql'), t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'));
  for (const m of ['199_super_admin', '089_skills_values_taxonomy', '090_seed_skills_values_taxonomy', '712_team_agents', '759_agent_skills',
    '202611022046_ai_admin_audit', '202611022055_agent_skill_moderation', '202611022140_hq_skill_lifecycle']) db.exec(sql(`migrations/${m}.sql`));
    db.exec(sql('migrations/202611090904_skill_eval_result_identity.sql')); // D4531 slice 3: the evaluator (and case text) on each result row
  db.prepare("INSERT INTO users (id, uid, email, name, role) VALUES (1, 'u-super', 'super@example.test', 'Sue Super', 'admin')").run();
  db.exec("INSERT INTO company_profiles (id, uid, company_name) VALUES (7, 'co-7', 'Acme')");
  return { db, env: { DB } as any };
}
const tableCounts = (db: any) => Object.fromEntries(['agent_skills', 'agent_skill_tags', 'agent_skill_roles', 'agent_skill_cases'].map((t) => [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n]));

test('reconciliation on a local D1: every class, HQ scope only, and nothing written', async () => {
  const w = world();
  const three = SKILL_LIBRARY.slice(0, 4);
  // Seed three of the four; the fourth stays source-only.
  await seedLibrary(w.env, 1, 'Seed a local fixture for the reconciliation test.', three.slice(0, 3));
  const { manifest } = await checkSourceCatalogue({
    definitions: Object.fromEntries(three.map((e) => [`${e.slug}.md`, e.skill_md])),
    cases: Object.fromEntries(three.map((e) => [`${e.slug}.json`, JSON.stringify(e.cases[0])])),
    generated: three, generatedFresh: true, taxonomy: TAXONOMY,
  });
  const [a, b, c, d] = three.map((e) => e.slug);
  const before = tableCounts(w.db);
  let lines = reconcile(manifest, await persistedManifest(w.env));
  assert.deepEqual(lines.map((l) => [l.slug, l.class]), [[a, 'exact'], [b, 'exact'], [c, 'exact'], [d, 'source_only']]);
  assert.equal(lines.find((l) => l.slug === d)!.disposition, 'seed');
  assert.deepEqual(tableCounts(w.db), before, 'reading and reconciling wrote nothing');

  // A company's skill with the same slug is not part of the library.
  w.db.prepare(`INSERT INTO agent_skills (uid, scope, company_id, slug, name, purpose, output_kind, created_by) VALUES ('${'c'.repeat(32)}', 'company', 7, ?, 'Company copy', 'Their own.', 'brief', 1)`).run(a);
  // An edited draft, a changed case, a removed case, and an HQ skill the source does not have.
  w.db.prepare("UPDATE agent_skills SET steps_json = ? WHERE scope = 'hq' AND slug = ?").run(JSON.stringify(['An edited step.']), a);
  const bId = (w.db.prepare("SELECT id FROM agent_skills WHERE scope = 'hq' AND slug = ?").get(b) as any).id;
  w.db.prepare("UPDATE agent_skill_cases SET expect_json = ? WHERE skill_id = ?").run(JSON.stringify({ output: 'brief', must_include: ['changed'], must_say_not_recorded: [], must_not_include: [] }), bId);
  const cId = (w.db.prepare("SELECT id FROM agent_skills WHERE scope = 'hq' AND slug = ?").get(c) as any).id;
  w.db.prepare("UPDATE agent_skill_cases SET removed_at = CURRENT_TIMESTAMP WHERE skill_id = ?").run(cId);
  w.db.prepare(`INSERT INTO agent_skills (uid, scope, company_id, slug, name, purpose, output_kind, created_by) VALUES ('${'d'.repeat(32)}', 'hq', NULL, 'hq-only-skill', 'HQ only', 'Not in the files.', 'brief', 1)`).run();
  const after = tableCounts(w.db);
  lines = reconcile(manifest, await persistedManifest(w.env));
  assert.deepEqual(lines.map((l) => [l.slug, l.class, l.disposition]), [
    [a, 'content_drift', 'report'], [b, 'case_drift', 'report'], [c, 'missing_case', 'report'], [d, 'source_only', 'seed'], ['hq-only-skill', 'persisted_only', 'report'],
  ]);
  assert.ok(lines.every((l) => l.disposition !== 'fail'));
  assert.deepEqual(tableCounts(w.db), after, 'still nothing written');
  // A duplicate identity in the source fails.
  const dup = reconcile([...manifest, manifest[0]], await persistedManifest(w.env));
  assert.ok(dup.some((l) => l.class === 'duplicate_identity' && l.disposition === 'fail'));
  // Two store rows for one source slug fail too: the reconciliation cannot say which one the library means.
  const persisted = await persistedManifest(w.env);
  const twice = reconcile(manifest, [...persisted, { ...persisted.find((p) => p.slug === a)!, uid: 'e'.repeat(32) }]);
  assert.deepEqual(twice.filter((l) => l.slug === a).map((l) => [l.class, l.disposition]), [['duplicate_identity', 'fail']]);
});

test('the summary: the model evaluation and an absent reconciliation are not run, never passed', async () => {
  const { findings, manifest } = await check();
  const s = summary(findings, manifest, null);
  assert.equal(s.ok, true);
  assert.equal(s.model_evaluation.status, 'not_run');
  assert.equal((s.reconciliation as any).status, 'not_run');
  const failing = summary(findings, manifest, [{ slug: SLUG, class: 'duplicate_identity', disposition: 'fail', source: null, persisted: null }]);
  assert.equal(failing.ok, false);
  const bad = await check({ cases: {} });
  assert.equal(summary(bad.findings, bad.manifest, null).ok, false);
});

test('the command exits 0 on the repository and writes its JSON summary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skill-ci-'));
  const out = join(dir, 'summary.json');
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--import', './cloudflare-worker/test/_ts-loader.mjs',
    'scripts/check-skill-library.mjs', '--json', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const s = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(s.ok, true);
  assert.equal(s.errors, 0);
  assert.equal(s.skills, Object.keys(REAL.definitions).length);
  assert.equal(s.model_evaluation.status, 'not_run');
});

test('the command exits 1 when the reconciliation fails, and says why', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skill-ci-'));
  const persisted = join(dir, 'persisted.json');
  const row = { slug: SLUG, uid: 'f'.repeat(32), status: 'draft', current_version: 0, draft_hash: null, cases: [] };
  writeFileSync(persisted, JSON.stringify([row, { ...row, uid: 'a'.repeat(32) }]));
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--import', './cloudflare-worker/test/_ts-loader.mjs',
    'scripts/check-skill-library.mjs', '--persisted', persisted], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, new RegExp(`${SLUG}: duplicate_identity \\(fail\\)`));
  assert.match(r.stderr, /✖ check-skill-library:/);
});
