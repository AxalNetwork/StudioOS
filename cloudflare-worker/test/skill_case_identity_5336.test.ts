/**
 * D5336 (#5336) — stable case identities and multi-case packaging: #4588's scenarios
 * become stored cases beside each skill's golden case, checked by the CI gate.
 *
 *   1. The identity helper: `case_id` + `revision` where the source gives them, the
 *      unchanged `<slug>#<sha12>` for a v1 golden case; one helper for every reader.
 *   2. Generator: every scenario is in the generated module, beside the golden case, under its own name.
 *   3. Seed, fresh store: a golden case and five scenarios are six live cases; a second run adds nothing.
 *   4. Seed, a store seeded before this change: only the missing cases are added, no existing row changes.
 *   5. Coverage: one scenario followed from file to module to row; every scenario present at each stage.
 *   6. Gate: each new rule on a targeted fixture, duplicate identities, an unsound module (D5612), the case cap.
 *   7. Reconciliation classes with multi-case sources; a changed revision is a new case, never an edit.
 *
 * Every record is made up; no model runs (model_evaluation: not_run).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/skill_case_identity_5336.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeD1 } from './_d1_sqlite.mjs';
import { stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { caseIdentity, goldenName, identityKey, storedCaseIdentity, caseSha as identityCaseSha } from '../src/services/agents/skillCaseIdentity.ts';
import { CASES_MAX, caseSha, checkCase } from '../src/services/agents/skillLifecycle.ts';
import { checkSourceCatalogue, persistedManifest, reconcile, summary, type Finding } from '../src/services/agents/skillCatalogue.ts';
import { checkLibrary, seedLibrary } from '../src/services/agents/skillLibrarySeed.ts';
import { scenarioCase as tsScenarioCase, type Pack } from '../src/services/agents/skillScenarios.ts';
import { SKILL_LIBRARY, type LibraryEntry } from '../src/services/agents/skillLibrary.generated.ts';
import { SKILL_LIBRARY_REL, libraryEntries, render, scenarioCase as mjsScenarioCase, skillLibraryProblems } from '../../scripts/build-skill-library.mjs';
import { generatedSound, readSources, taxonomyFromSeed } from '../../scripts/check-skill-library.mjs';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const TAXONOMY = taxonomyFromSeed(sql('migrations/090_seed_skills_values_taxonomy.sql'));
const SKILLS = join(process.cwd(), 'cloudflare-worker/src/services/agents/skills');
const GENERATED = join(process.cwd(), 'cloudflare-worker/src/services/agents/skillLibrary.generated.ts');
const REAL = readSources();
const PACKS: Pack[] = readdirSync(join(SKILLS, 'scenarios')).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(join(SKILLS, 'scenarios', f), 'utf8')));
const REASON = 'Seed a local fixture for the case identity test.';
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

function world(opts: { sourceIdentity?: boolean } = {}) {
  const { DB, db } = makeD1(['users', 'company_profiles', 'user_company_links', 'projects', 'activity_logs'].map((t) => stripForeignKeys(tableFromBaseline(sql('schema_baseline.sql'), t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'));
  for (const m of ['199_super_admin', '089_skills_values_taxonomy', '090_seed_skills_values_taxonomy', '712_team_agents', '759_agent_skills',
    '202611022046_ai_admin_audit', '202611022055_agent_skill_moderation', '202611022140_hq_skill_lifecycle', '202611022313_agent_skill_runs',
    '202611081919_skill_release_evidence', '202611090904_skill_eval_result_identity']) db.exec(sql(`migrations/${m}.sql`));
  if (opts.sourceIdentity !== false) db.exec(sql('migrations/202611100853_skill_case_source_identity.sql'));
  db.prepare("INSERT INTO users (id, uid, email, name, role) VALUES (1, 'u-super', 'super@example.test', 'Sue Super', 'admin')").run();
  return { db, env: { DB } as any };
}
type W = ReturnType<typeof world>;
const rows = (w: W, q: string, ...b: unknown[]) => w.db.prepare(q).all(...(b as any[])) as any[];
const caseRows = (w: W) => rows(w, 'SELECT * FROM agent_skill_cases ORDER BY id');
const entry = (slug: string) => SKILL_LIBRARY.find((e) => e.slug === slug)!;
const packOf = (slug: string) => PACKS.find((p) => p.skill === slug)!;
const skillId = (w: W, slug: string) => (w.db.prepare("SELECT id FROM agent_skills WHERE scope = 'hq' AND slug = ?").get(slug) as any).id as number;
const liveOf = (w: W, slug: string) => rows(w, 'SELECT * FROM agent_skill_cases WHERE skill_id = ? AND removed_at IS NULL ORDER BY id', skillId(w, slug));

/** The seed as it was before D5336: each skill with its one golden case, by name, with no source identity. */
function legacySeed(w: W, entries: readonly LibraryEntry[]) {
  for (const c of checkLibrary(new Set(TAXONOMY.keys()), entries.map((e) => ({ ...e, cases: e.cases.slice(0, 1) })))) {
    assert.ok(c.ok, c.entry.slug);
    if (!c.ok) continue;
    const d = c.draft;
    const id = (w.db.prepare(`INSERT INTO agent_skills (uid, scope, company_id, slug, name, purpose, steps_json, allowed_tools_json, output_kind, created_by, updated_by)
      VALUES (?, 'hq', NULL, ?, ?, ?, ?, ?, ?, 1, 1) RETURNING id`).get(`legacy-${d.slug}`.slice(0, 32).padEnd(32, '0'), d.slug, d.name, d.purpose, JSON.stringify(d.steps), JSON.stringify(d.tools), d.output_kind) as any).id;
    for (const t of d.tags) w.db.prepare('INSERT INTO agent_skill_tags (skill_id, taxonomy_skill_slug, level) VALUES (?, ?, ?)').run(id, t.slug, t.level);
    for (const r of d.roles) w.db.prepare('INSERT INTO agent_skill_roles (skill_id, role_key) VALUES (?, ?)').run(id, r);
    for (const [i, k] of c.cases.entries()) w.db.prepare('INSERT INTO agent_skill_cases (uid, skill_id, name, input_json, expect_json, created_by) VALUES (?, ?, ?, ?, ?, 1)')
      .run(`lc${id}-${i}`.padEnd(32, '0'), id, goldenName(d.slug), JSON.stringify(k.input), JSON.stringify(k.expect));
  }
}

// ── 1. The identity helper ──────────────────────────────────────────────────

test('identity: a scenario is case_id + revision; a v1 golden case keeps <slug>#<sha12> of its content, unchanged', async () => {
  const input = { records: { 'stripe.revenue': { mrr: 1 } } }; const expect = { output: 'brief', must_include: ['x'], must_say_not_recorded: [], must_not_include: [] };
  const g = await caseIdentity('demo-skill', { input, expect });
  const content = createHash('sha256').update(JSON.stringify({ input, expect })).digest('hex');
  assert.deepEqual(g, { case_id: `demo-skill#${content.slice(0, 12)}`, revision: null, key: `demo-skill#${content.slice(0, 12)}`, sha256: content });
  const s1 = await caseIdentity('demo-skill', { case_id: 'demo-skill-a', revision: 1, input, expect });
  assert.deepEqual([s1.key, s1.case_id, s1.revision, s1.sha256], ['demo-skill-a:r1', 'demo-skill-a', 1, content]);
  // Same text, another id or another revision: another identity.
  assert.notEqual((await caseIdentity('demo-skill', { case_id: 'demo-skill-b', revision: 1, input, expect })).key, s1.key);
  assert.notEqual((await caseIdentity('demo-skill', { case_id: 'demo-skill-a', revision: 2, input, expect })).key, s1.key);
  assert.equal(identityKey('x', null), 'x');
  // A stored row: its recorded source identity, else its content; the same answer as the source side.
  const row = { input_json: JSON.stringify(input), expect_json: JSON.stringify(expect) };
  assert.deepEqual(await storedCaseIdentity('demo-skill', row), g);
  assert.deepEqual(await storedCaseIdentity('demo-skill', { ...row, source_case_id: 'demo-skill-a', source_revision: 1 }), s1);
  // #4531's caseSha is the same function wherever it is imported from.
  assert.equal(caseSha, identityCaseSha);
});

test('identity: every committed golden case keeps the identity D4532 gave it', async () => {
  const { manifest } = await checkSourceCatalogue({ ...REAL, generated: SKILL_LIBRARY, generatedSound: true, taxonomy: TAXONOMY });
  for (const e of SKILL_LIBRARY) {
    const k = checkCase({ name: goldenName(e.slug), input: e.cases[0].input, expect: e.cases[0].expect });
    assert.ok(k.ok);
    const old = createHash('sha256').update(JSON.stringify({ input: k.ok && k.input, expect: k.ok && k.expect })).digest('hex');
    assert.equal(manifest.find((m) => m.slug === e.slug)!.cases[0].case_id, `${e.slug}#${old.slice(0, 12)}`, e.slug);
  }
});

// ── 2. Generator ────────────────────────────────────────────────────────────

test('generator: the built module is the script\'s output, golden case first, then every scenario under its own name', () => {
  // D5612: the module is built before every test, never committed — its generator is deterministic and git does not track it.
  assert.deepEqual(skillLibraryProblems(), []);
  assert.equal(readFileSync(GENERATED, 'utf8'), render(libraryEntries()), 'the module this run imports is not the current build; run node scripts/build-generated.mjs');
  for (const e of SKILL_LIBRARY) assert.deepEqual(e.cases[0], JSON.parse(REAL.cases[`${e.slug}.json`]), `${e.slug}: golden case first, as committed`);
  for (const p of PACKS) {
    const e = entry(p.skill);
    assert.equal(e.cases.length, 1 + p.scenarios.length, p.skill);
    for (const [i, s] of p.scenarios.entries()) {
      // One packing, in the generator and the gate.
      assert.equal(JSON.stringify(mjsScenarioCase(p.skill, s)), JSON.stringify(tsScenarioCase(p.skill, s)));
      assert.equal(JSON.stringify(e.cases[1 + i]), JSON.stringify(tsScenarioCase(p.skill, s)), s.case_id);
    }
  }
});

// ── 3. Seed, fresh store ────────────────────────────────────────────────────

test('seed: a golden case and five scenarios are six distinct live cases on a fresh store; a second run adds nothing', async () => {
  const e = SKILL_LIBRARY.find((x) => x.cases.length === 6)!;
  assert.ok(e, 'a skill with a golden case and five scenarios');
  const w = world();
  const first = await seedLibrary(w.env, 1, REASON, [e]);
  assert.deepEqual(first.map((l) => [l.outcome, l.cases]), [['created', 6]]);
  const live = liveOf(w, e.slug);
  assert.equal(live.length, 6);
  assert.equal(new Set(live.map((r) => r.name)).size, 6, 'six names');
  assert.equal(new Set(live.map((r) => `${r.source_case_id}:${r.source_revision}`)).size, 6, 'six identities');
  assert.equal(live[0].name, goldenName(e.slug));
  assert.equal(live[0].source_revision, null);
  assert.deepEqual(live.slice(1).map((r) => [r.source_case_id, r.source_revision, r.name]), packOf(e.slug).scenarios.map((s) => [s.case_id, s.revision, s.name]));
  const before = sha(caseRows(w));
  const second = await seedLibrary(w.env, 1, REASON, [e]);
  assert.deepEqual(second.map((l) => l.outcome), ['present']);
  assert.equal(sha(caseRows(w)), before, 'a second run changed a row');
  assert.equal(rows(w, "SELECT COUNT(*) AS n FROM agent_skills WHERE status <> 'draft'")[0].n, 0, 'the seed published');
});

// ── 4. Seed, a store seeded before this change ──────────────────────────────

test('seed: a store seeded before this change gains only the missing cases; no existing row changes', async () => {
  const w = world({ sourceIdentity: false });
  legacySeed(w, SKILL_LIBRARY);
  // Production's path: the old rows exist, then the migration adds the columns (NULL), then the new seed runs.
  w.db.exec(sql('migrations/202611100853_skill_case_source_identity.sql'));
  const tables = ['agent_skills', 'agent_skill_tags', 'agent_skill_roles', 'agent_skill_cases'];
  const snapshot = Object.fromEntries(tables.map((t) => [t, rows(w, `SELECT * FROM ${t} ORDER BY rowid`)]));
  const maxCase = Math.max(...snapshot.agent_skill_cases.map((r: any) => r.id));
  const lines = await seedLibrary(w.env, 1, REASON);
  const scenarioCount = PACKS.reduce((n, p) => n + p.scenarios.length, 0);
  for (const l of lines) {
    const p = PACKS.find((x) => x.skill === l.slug);
    assert.deepEqual([l.outcome, l.cases], p ? ['cases_added', p.scenarios.length] : ['present', undefined], l.slug);
  }
  // Every row that was there is byte for byte as it was (the golden case of every skill, refuse_when's included).
  for (const t of tables) {
    const now = rows(w, `SELECT * FROM ${t} ORDER BY rowid`).slice(0, snapshot[t].length);
    assert.equal(sha(now.map((r: any) => (t === 'agent_skill_cases' ? { ...r, source_case_id: undefined, source_revision: undefined } : r))),
      sha(snapshot[t].map((r: any) => (t === 'agent_skill_cases' ? { ...r, source_case_id: undefined, source_revision: undefined } : r))), `${t} changed`);
  }
  assert.ok(snapshot.agent_skill_cases.every((r: any) => r.source_case_id == null), 'legacy rows carry no identity');
  assert.deepEqual(rows(w, 'SELECT source_case_id, source_revision FROM agent_skill_cases WHERE id <= ? AND (source_case_id IS NOT NULL OR source_revision IS NOT NULL)', maxCase), []);
  const added = rows(w, 'SELECT * FROM agent_skill_cases WHERE id > ?', maxCase);
  assert.equal(added.length, scenarioCount);
  assert.ok(added.every((r) => r.source_case_id && Number.isInteger(r.source_revision)));
  // And the store now matches the source exactly, under identity and content.
  const { manifest } = await checkSourceCatalogue({ ...REAL, generated: SKILL_LIBRARY, generatedSound: true, taxonomy: TAXONOMY });
  const rec = reconcile(manifest, await persistedManifest(w.env));
  assert.deepEqual([...new Set(rec.map((l) => l.class))], ['exact']);
  const again = sha(caseRows(w));
  assert.ok((await seedLibrary(w.env, 1, REASON)).every((l) => l.outcome === 'present'));
  assert.equal(sha(caseRows(w)), again);
});

// ── 5. Coverage: source → generated → imported ──────────────────────────────

test('coverage: one scenario followed from its file to the module to a row with its own identity; every scenario at each stage', async () => {
  const w = world();
  await seedLibrary(w.env, 1, REASON);
  // One scenario, end to end.
  const file = JSON.parse(readFileSync(join(SKILLS, 'scenarios', 'board-meeting-brief.json'), 'utf8')) as Pack;
  const s = file.scenarios.find((x) => x.case_id === 'board-meeting-brief-missing-burn')!;
  const gen = entry('board-meeting-brief').cases.find((k) => k.case_id === s.case_id)!;
  assert.deepEqual([gen.revision, gen.name, gen.input, gen.expect], [s.revision, s.name, s.input, s.expect]);
  const row = liveOf(w, 'board-meeting-brief').find((r) => r.source_case_id === s.case_id)!;
  assert.ok(row, 'imported');
  const k = checkCase({ name: s.name, input: s.input, expect: s.expect });
  assert.ok(k.ok);
  assert.deepEqual([row.name, row.source_revision, row.input_json, row.expect_json], [s.name, s.revision, JSON.stringify(k.ok && k.input), JSON.stringify(k.ok && k.expect)]);
  assert.equal((await storedCaseIdentity('board-meeting-brief', row)).key, `board-meeting-brief-missing-burn:r${s.revision}`);

  // Every scenario in skills/scenarios/, at each of the three stages.
  const imported = new Set(rows(w, "SELECT s.slug || '/' || k.source_case_id || ':r' || k.source_revision AS id FROM agent_skill_cases k JOIN agent_skills s ON s.id = k.skill_id WHERE k.removed_at IS NULL AND k.source_revision IS NOT NULL").map((r) => r.id));
  let n = 0;
  for (const p of PACKS) for (const x of p.scenarios) {
    n += 1;
    const id = `${p.skill}/${x.case_id}:r${x.revision}`;
    assert.ok(entry(p.skill).cases.some((c) => c.case_id === x.case_id && c.revision === x.revision && c.name === x.name), `${id}: not in the generated module`);
    assert.ok(imported.has(id), `${id}: not imported`);
  }
  assert.equal(imported.size, n, 'an imported scenario no source has');
  // Two scenarios of one skill never share an importer identity, and the store refuses a second live row for one.
  for (const p of PACKS) {
    const keys = await Promise.all(liveOf(w, p.skill).map((r) => storedCaseIdentity(p.skill, r)));
    assert.equal(new Set(keys.map((x) => x.key)).size, keys.length, p.skill);
  }
  assert.throws(() => w.db.prepare('INSERT INTO agent_skill_cases (uid, skill_id, name, input_json, expect_json, created_by, source_case_id, source_revision) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
    .run('f'.repeat(32), row.skill_id, 'Another name', row.input_json, row.expect_json, row.source_case_id, row.source_revision), /UNIQUE/);
  assert.throws(() => w.db.prepare('UPDATE agent_skill_cases SET source_revision = 9 WHERE id = ?').run(row.id), /immutable/);
});

// ── 6. Gate ─────────────────────────────────────────────────────────────────

const SLUG = 'contract-clause-extraction';
const ONE = { definitions: { [`${SLUG}.md`]: REAL.definitions[`${SLUG}.md`] }, cases: { [`${SLUG}.json`]: REAL.cases[`${SLUG}.json`] } };
const PACK = JSON.parse(REAL.scenarios[`${SLUG}.json`]) as Pack;
async function gate(pack: unknown, over: { cases?: Record<string, string>; sound?: boolean } = {}) {
  const scenarios = { [`${SLUG}.json`]: typeof pack === 'string' ? pack : JSON.stringify(pack) };
  return checkSourceCatalogue({ ...ONE, ...(over.cases ? { cases: over.cases } : {}), scenarios, generated: [{ slug: SLUG, skill_md: ONE.definitions[`${SLUG}.md`], cases: [] }], generatedSound: over.sound ?? true, taxonomy: TAXONOMY });
}
const errs = (f: Finding[]) => f.filter((x) => x.level === 'error');
const mutate = (patch: (p: Pack) => void) => { const p = structuredClone(PACK); patch(p); return p; };
const clone = (p: Pack, i: number, n: number) => ({ ...structuredClone(p.scenarios[0]), case_id: `${SLUG}-copy-${i}-${n}`, name: `Copy ${i} of ${n}` });

test('gate: the unmutated pack is clean, and each scenario rule fails its targeted fixture', async () => {
  assert.deepEqual(errs((await gate(PACK)).findings), []);
  const fixtures: Array<[string, unknown, string]> = [
    ['a malformed pack', '{ "skill": ', 'scenario_malformed'],
    ['a pack for another skill', mutate((p) => { p.skill = 'board-meeting-brief'; }), 'scenario_orphan'],
    ['a case id without the slug', mutate((p) => { p.scenarios[1].case_id = 'missing-version'; }), 'scenario_case_id_invalid'],
    ['a case id used twice', mutate((p) => { p.scenarios[1].case_id = p.scenarios[0].case_id; }), 'scenario_case_id_duplicate'],
    ['a fractional revision', mutate((p) => { p.scenarios[1].revision = 1.5; }), 'scenario_revision_invalid'],
    ['a name used twice', mutate((p) => { p.scenarios[1].name = p.scenarios[0].name; }), 'scenario_name_duplicate'],
    ['the golden case\'s name', mutate((p) => { p.scenarios[1].name = goldenName(SLUG); }), 'scenario_name_duplicate'],
    ['an email in an output', mutate((p) => { p.scenarios[1].outputs.correct += '\nContact: someone@example.com'; }), 'scenario_has_email'],
    ['a read the skill does not declare', mutate((p) => { (p.scenarios[1].input.records as any)['github.repos'] = { repos: 1 }; }), 'record_key_outside_tools'],
    ['a correct output that fails', mutate((p) => { p.scenarios[0].outputs.correct = 'Nothing useful.'; }), 'scenario_correct_fails'],
    ['an incorrect output that passes', mutate((p) => { p.scenarios[0].outputs.incorrect[0] = { targets: p.scenarios[0].outputs.incorrect[0].targets, text: p.scenarios[0].outputs.correct }; }), 'scenario_incorrect_not_caught'],
    ['an edit that is not in the output', mutate((p) => { p.scenarios[0].outputs.incorrect[0] = { targets: 'x', edit: [['no such text anywhere', 'y']] }; }), 'scenario_incorrect_invalid'],
    ['an assertion no incorrect output catches', mutate((p) => { p.scenarios[0].outputs.incorrect = []; }), 'scenario_assertion_uncaught'],
    ['more cases than the cap', mutate((p) => { p.scenarios.push(...Array.from({ length: CASES_MAX }, (_, i) => clone(p, i, CASES_MAX))); }), 'cases_max'],
  ];
  for (const [what, pack, rule] of fixtures) {
    const { findings } = await gate(pack);
    const hit = errs(findings).find((f) => f.rule === rule);
    assert.ok(hit, `${what}: expected ${rule}, got ${JSON.stringify(errs(findings).map((f) => f.rule))}`);
    assert.ok(hit!.file && hit!.slug && hit!.message && hit!.remediation, `${what}: names file, slug, message and remediation`);
  }
});

test('gate: two cases with one identity fail; an unsound generated module fails', async () => {
  // A golden case file that claims a scenario's identity.
  const golden = { ...JSON.parse(REAL.cases[`${SLUG}.json`]), case_id: PACK.scenarios[0].case_id, revision: PACK.scenarios[0].revision };
  const dup = await gate(PACK, { cases: { [`${SLUG}.json`]: JSON.stringify(golden) } });
  assert.deepEqual(errs(dup.findings).map((f) => [f.rule, f.case_id]), [['case_identity_duplicate', `${PACK.scenarios[0].case_id}:r1`]]);
  // The reconciliation fails on it too.
  assert.deepEqual(reconcile(dup.manifest, []).map((l) => [l.class, l.disposition]), [['duplicate_identity', 'fail']]);

  // D5612: a module git tracks is unsound, whatever its bytes; so is one that is not this run's build of the files.
  const root = mkdtempSync(join(tmpdir(), 'skill-5336-'));
  const skills = join(root, 'cloudflare-worker/src/services/agents/skills');
  mkdirSync(skills, { recursive: true });
  cpSync(SKILLS, skills, { recursive: true });
  const built = render(libraryEntries(skills));
  writeFileSync(join(root, SKILL_LIBRARY_REL), built);
  assert.equal(generatedSound(root, built), true, 'built and untracked');
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  assert.equal(generatedSound(root, built), true, 'in a work tree, still untracked');
  execFileSync('git', ['add', '-f', SKILL_LIBRARY_REL], { cwd: root, stdio: 'ignore' });
  const tracked = generatedSound(root, built);
  assert.equal(tracked, false, 'git add -f');
  assert.deepEqual(errs((await gate(PACK, { sound: tracked })).findings).map((f) => f.rule), ['generated_unsound']);
  execFileSync('git', ['rm', '-q', '--cached', SKILL_LIBRARY_REL], { cwd: root, stdio: 'ignore' });
  const changed = mutate((p) => { p.scenarios[0].revision = 2; });
  writeFileSync(join(skills, 'scenarios', `${SLUG}.json`), JSON.stringify(changed, null, 2));
  const sound = generatedSound(root, built);
  assert.equal(sound, false, 'a scenario changed after the build');
  assert.deepEqual(errs((await gate(changed, { sound })).findings).map((f) => f.rule), ['generated_unsound']);
});

test('gate: the cap holds the golden case plus ten scenarios, and fails a skill whose sources exceed it', async () => {
  const ten = mutate((p) => { p.scenarios = [...p.scenarios, ...Array.from({ length: 10 - p.scenarios.length }, (_, i) => clone(p, i, 10))]; });
  assert.equal(ten.scenarios.length, 10);
  assert.deepEqual(errs((await gate(ten)).findings), [], 'golden + 10');
  const over = mutate((p) => { p.scenarios = [...p.scenarios, ...Array.from({ length: CASES_MAX - p.scenarios.length }, (_, i) => clone(p, i, CASES_MAX))]; });
  assert.equal(over.scenarios.length + 1, CASES_MAX + 1);
  assert.deepEqual(errs((await gate(over)).findings).map((f) => f.rule), ['cases_max']);
  // The seed refuses it as well, on a fresh store and onto a draft that already holds cases.
  const w = world();
  const e = entry(SLUG);
  const big: LibraryEntry = { ...e, cases: [e.cases[0], ...over.scenarios.map((s) => tsScenarioCase(SLUG, s) as any)] };
  assert.deepEqual((await seedLibrary(w.env, 1, REASON, [big])).map((l) => [l.outcome, l.code]), [['refused', 'cases_max']]);
  await seedLibrary(w.env, 1, REASON, [e]);
  // An admin's own cases fill the draft to 16 live cases; the five new scenarios would make 21.
  const id = skillId(w, SLUG);
  const k = liveOf(w, SLUG)[0];
  for (let i = 0; i < CASES_MAX - 4 - e.cases.length; i += 1) {
    w.db.prepare('INSERT INTO agent_skill_cases (uid, skill_id, name, input_json, expect_json, created_by) VALUES (?, ?, ?, ?, ?, 1)').run(`admin-${i}`.padEnd(32, '0'), id, `Admin case ${i}`, k.input_json, k.expect_json);
  }
  assert.equal(liveOf(w, SLUG).length, CASES_MAX - 4);
  const before = sha(caseRows(w));
  const elevenCases: LibraryEntry = { ...e, cases: [e.cases[0], ...ten.scenarios.map((s) => tsScenarioCase(SLUG, s) as any)] };
  assert.equal(elevenCases.cases.length, 11);
  const l = await seedLibrary(w.env, 1, REASON, [elevenCases]);
  assert.deepEqual(l.map((x) => [x.outcome, x.code]), [['refused', 'cases_max']]);
  assert.equal(sha(caseRows(w)), before, 'a refused seed wrote a row');
});

test('gate: the summary reports scenario coverage per skill apart from executions, and never a model result', async () => {
  const { findings, manifest, coverage } = await checkSourceCatalogue({ ...REAL, generated: SKILL_LIBRARY, generatedSound: true, taxonomy: TAXONOMY });
  const s = summary(findings, manifest, null, coverage);
  assert.equal(s.ok, true);
  assert.equal(s.model_evaluation.status, 'not_run');
  assert.deepEqual(s.executions, { status: 'not_run', runs: 0 });
  assert.deepEqual(s.scenario_coverage.skills.map((x) => x.slug), PACKS.map((p) => p.skill));
  for (const p of PACKS) {
    const c = s.scenario_coverage.skills.find((x) => x.slug === p.skill)!;
    assert.equal(c.scenarios, p.scenarios.length);
    assert.equal(c.cases, 1 + p.scenarios.length);
    assert.ok(c.assertions > 0 && c.incorrect_outputs >= c.scenarios);
  }
  assert.equal(s.scenario_coverage.scenarios, PACKS.reduce((n, p) => n + p.scenarios.length, 0));
});

// ── 7. Reconciliation with multi-case sources ───────────────────────────────

test('reconciliation: every class holds with multi-case sources; a changed revision is a new case, never an edit', async () => {
  const w = world();
  const multi = PACKS.slice(0, 2).map((p) => entry(p.skill));
  const plain = SKILL_LIBRARY.find((e) => e.cases.length === 1)!;
  const three = [...multi, plain].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  await seedLibrary(w.env, 1, REASON, three);
  const src = (packs: Record<string, string> = {}) => checkSourceCatalogue({
    definitions: Object.fromEntries(three.map((e) => [`${e.slug}.md`, e.skill_md])),
    cases: Object.fromEntries(three.map((e) => [`${e.slug}.json`, REAL.cases[`${e.slug}.json`]])),
    scenarios: { ...Object.fromEntries(multi.map((e) => [`${e.slug}.json`, REAL.scenarios[`${e.slug}.json`]])), ...packs },
    generated: three, generatedSound: true, taxonomy: TAXONOMY,
  });
  const [a, b] = multi.map((e) => e.slug);
  let lines = reconcile((await src()).manifest, await persistedManifest(w.env));
  assert.deepEqual(lines.map((l) => l.class), ['exact', 'exact', 'exact']);
  assert.equal(lines.find((l) => l.slug === a)!.source!.case_keys.length, entry(a).cases.length);

  // A removed scenario is case drift; the seed adds it back as a new row, and the removed row stays as it was.
  const victim = liveOf(w, a).at(-1);
  w.db.prepare('UPDATE agent_skill_cases SET removed_at = CURRENT_TIMESTAMP WHERE id = ?').run(victim.id);
  lines = reconcile((await src()).manifest, await persistedManifest(w.env));
  assert.deepEqual(lines.find((l) => l.slug === a)!.class, 'case_drift');
  const removed = rows(w, 'SELECT * FROM agent_skill_cases WHERE id = ?', victim.id)[0];
  assert.deepEqual((await seedLibrary(w.env, 1, REASON, three)).filter((l) => l.outcome !== 'present').map((l) => [l.slug, l.outcome, l.cases]), [[a, 'cases_added', 1]]);
  assert.deepEqual(rows(w, 'SELECT * FROM agent_skill_cases WHERE id = ?', victim.id)[0], removed);
  assert.equal(reconcile((await src()).manifest, await persistedManifest(w.env)).find((l) => l.slug === a)!.class, 'exact');

  // A changed revision: case drift, then the seed adds it beside the old one, which is not edited or removed.
  const bumped = structuredClone(packOf(b));
  bumped.scenarios[0].revision += 1;
  bumped.scenarios[0].expect.must_include = [...(bumped.scenarios[0].expect.must_include as string[]), bumped.scenarios[0].outputs.correct.split('\n')[0].slice(0, 20)];
  const next = await src({ [`${b}.json`]: JSON.stringify(bumped) });
  assert.equal(reconcile(next.manifest, await persistedManifest(w.env)).find((l) => l.slug === b)!.class, 'case_drift');
  const before = sha(caseRows(w));
  const bEntry: LibraryEntry = { ...entry(b), cases: [entry(b).cases[0], ...bumped.scenarios.map((s) => tsScenarioCase(b, s) as any)] };
  assert.deepEqual((await seedLibrary(w.env, 1, REASON, [bEntry])).map((l) => [l.outcome, l.cases]), [['cases_added', 1]]);
  assert.equal(sha(caseRows(w).slice(0, -1)), before, 'an existing row changed');
  const both = liveOf(w, b).filter((r) => r.source_case_id === bumped.scenarios[0].case_id).map((r) => r.source_revision);
  assert.deepEqual(both, [bumped.scenarios[0].revision - 1, bumped.scenarios[0].revision]);
  assert.equal(reconcile(next.manifest, await persistedManifest(w.env)).find((l) => l.slug === b)!.class, 'exact');
  // Identity, not content alone: a bumped revision over the same text is still a case the store does not hold.
  const relabelled = structuredClone(bumped);
  relabelled.scenarios[1].revision += 1;
  const again = await src({ [`${b}.json`]: JSON.stringify(relabelled) });
  assert.equal(reconcile(again.manifest, await persistedManifest(w.env)).find((l) => l.slug === b)!.class, 'case_drift');

  // No live case at all: missing_case. A published skill gains nothing and stays published.
  for (const r of liveOf(w, a)) w.db.prepare('UPDATE agent_skill_cases SET removed_at = CURRENT_TIMESTAMP WHERE id = ?').run(r.id);
  assert.equal(reconcile((await src()).manifest, await persistedManifest(w.env)).find((l) => l.slug === a)!.class, 'missing_case');
  w.db.prepare("UPDATE agent_skills SET status = 'published' WHERE id = ?").run(skillId(w, a));
  const pub = await seedLibrary(w.env, 1, REASON, three);
  assert.equal(pub.find((l) => l.slug === a)!.outcome, 'present');
  assert.equal(liveOf(w, a).length, 0);
  assert.equal(rows(w, 'SELECT status FROM agent_skills WHERE id = ?', skillId(w, a))[0].status, 'published');
});
