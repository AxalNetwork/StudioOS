/**
 * D4667-p3 (#4667): one explicitly selected data-room document's versioned text, through the real `data_room.index`
 * reader on the real migrated schema, into the skill evidence boundary #7539 gates runs on. Synthetic files and
 * passages only; nothing is read from R2 or an index, the model is a stub and nothing is charged for real.
 *
 *   · the reader: no selection answers the room's index and no text; one selected current document answers its
 *     file uid, current version, version digest and passages with stable references, bounded, with a continuation;
 *     the room's own rule decides who reads it (owner, accepted co-founder; never an outsider or an admin);
 *   · complete: `contract-clause-extraction` is ready, and the manual run carries the passages it judged;
 *   · partial (bounded): a document longer than one read is conditional, and says how many passages it supplied;
 *   · unreadable, not current, never read, not found and not selected each refuse `skill_not_ready`, naming why;
 *   · the scheduled path reads the document its session targets, and refuses a session with none;
 *   · the owner's answers on #4588 (A, A): `safe-convertible-instrument-review` reads its instrument from the selected
 *     document (ready complete, conditional bounded, not_ready with none), and the review policy stays a person's.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/skill_document_evidence_4667.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { ADMIN, AGENT, MEMBER, PROJECT, SPONSOR, STRANGER, fakeAgentRun, loopDeps, world, type World } from './_agent_engine_fixture.ts';
import { AI_FIXTURE_PLANS } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { agentRun, type AgentRunInput } from '../src/services/agents/agentRun.ts';
import { load, context, runStep } from '../src/agents/loop.ts';
import { roleOf } from '../src/services/agents/catalogue.ts';
import { DOCUMENT_TEXT_BUDGET, READERS, ReadPageError, coverageOf, readOne, type ReadContext } from '../src/services/agents/reads.ts';
import { FIRST_TEN, preflight } from '../src/services/agents/skillInputs.ts';
import { readLibrarySkill } from '../src/services/agents/skillLibrarySeed.ts';
import { skillEvidenceForRun } from '../src/services/agents/skillEvidence.ts';
import { targetReadable } from '../src/services/agents/sessions.ts';

after(removeMigratedDatabases);

const RUN_MODEL = '@cf/openai/gpt-oss-120b';
const GUARD = '@cf/meta/llama-guard-3-8b';
const SKILL_UID = 'e'.repeat(32);
const SLUG = 'contract-clause-extraction';
const STEP = { module: 'use-of-funds', option: 'draft:raise/use-of-funds-runway', prompt: 'Extract the clauses.' };
const P = { kind: 'project' as const, id: PROJECT };
const SCOPE = { kind: 'project', id: PROJECT, name: 'Kestrel', founder_id: 100, company_id: 1 } as any;
const READS = ['project.summary', 'company.profile', 'data_room.index'];
const MSA = '1'.repeat(32);
const LONG = '2'.repeat(32);
const BROKEN = '3'.repeat(32);
const NOW = Date.parse('2026-11-19T12:00:00Z');
const CLAUSE = 'Each party\'s aggregate liability shall not exceed the fees paid in the twelve months before the claim.';

/** A project agent with `contract-clause-extraction` pinned, its rule book reading the data room, and a synthetic room. */
function docWorld(o: { sponsor?: number } = {}) {
  __resetForTest();
  const w = world();
  const sponsor = o.sponsor ?? SPONSOR;
  w.agent(AGENT, 'cfo', { sponsor });
  w.db.exec(AI_FIXTURE_PLANS);
  w.db.prepare("UPDATE users SET subscription_tier = 'growth', subscription_status = 'active' WHERE id = ?").run(sponsor);
  w.db.prepare("INSERT INTO ai_licence_caps(licence_key, daily_microusd, monthly_microusd, recorded_by) VALUES ('founder:growth', 0, 0, 1), ('admin', 0, 0, 1)").run();
  w.db.prepare('INSERT INTO ai_topup_accounts(user_id, balance_microusd) VALUES (?, 50000000)').run(sponsor);
  w.db.prepare('UPDATE team_agents SET model_id = ? WHERE id = ?').run(RUN_MODEL, AGENT);
  const rules = { ...roleOf('cfo')!.default_rules, reads: READS };
  w.db.prepare(`INSERT INTO team_rulebooks (uid, scope_kind, project_id, role_key, version, rules_json, created_by)
    VALUES ('book-4667-p3', 'project', ?, 'cfo', 1, ?, ?)`).run(PROJECT, JSON.stringify(rules), SPONSOR);
  w.db.prepare(`INSERT INTO agent_skills (id, uid, scope, slug, name, purpose, steps_json, allowed_tools_json, output_kind, status, current_version, created_by)
    VALUES (1, ?, 'hq', ?, 'Contract clause extraction', 'Clauses from the contract text.', '["Read the contract"]', '[]', 'brief', 'published', 1, ?)`).run(SKILL_UID, SLUG, ADMIN);
  w.db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
    VALUES (1, 1, 'md', 'Contract clause extraction', 'Clauses from the contract text.', '["Read the contract"]', '[]', 'brief', '[]', '["cfo"]', ?)`).run(ADMIN);
  w.db.prepare('INSERT INTO agent_skill_links (agent_id, skill_id, version, linked_by) VALUES (?, 1, 1, ?)').run(AGENT, sponsor);
  w.db.exec(`INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (8, 'p8', 'Other venture', 101, 1)`);
  // The MSA: replaced once (version 1 kept), then indexed: its current version is 2, and its text on record is version 2's.
  file(w, 70, MSA, PROJECT, 'Synthetic MSA.pdf', 'data-room/p7/msa-v2', '2026-11-01 09:00:00');
  w.db.prepare("INSERT INTO data_room_file_versions (file_id, version, r2_key, content_type, size_bytes) VALUES (70, 1, 'data-room/p7/msa-v1', 'application/pdf', 10)").run();
  indexed(w, 70, PROJECT, ['Master Services Agreement (synthetic). 4.2 Fees: thirty days.', `9.1 Limitation of liability: ${CLAUSE}`]);
  // A long document: six whole passages of 1,100 characters, more than one read carries.
  file(w, 71, LONG, PROJECT, 'Synthetic long contract.pdf', 'data-room/p7/long', '2026-11-01 09:00:00');
  indexed(w, 71, PROJECT, Array.from({ length: 6 }, (_, i) => `Section ${i + 1}. ${'x'.repeat(1_100 - 11)}`));
  // A scanned file no text could be read from.
  file(w, 72, BROKEN, PROJECT, 'Synthetic scan.pdf', 'data-room/p7/scan', '2026-11-01 09:00:00');
  w.db.prepare("INSERT INTO data_room_search_state (file_id, project_id, status, passages, error, indexed_at) VALUES (72, ?, 'failed', 0, 'embed_failed', '2026-11-01 10:00:00')").run(PROJECT);
  const prompts: string[] = [];
  const calls: string[] = [];
  w.env.AI = withGuard({ run: async (model: string, input: any) => {
    calls.push(model);
    if (model !== GUARD) prompts.push(JSON.stringify(input.messages ?? input));
    return { response: 'Clause 9.1 caps liability.', usage: { prompt_tokens: 40, completion_tokens: 10 } };
  } });
  return { w, prompts, calls };
}
function file(w: World, id: number, uid: string, project: number, name: string, key: string, updated: string) {
  w.db.prepare('INSERT INTO data_room_files (id, uid, project_id, name, r2_key, content_type, size_bytes, updated_at) VALUES (?, ?, ?, ?, ?, ?, 10, ?)')
    .run(id, uid, project, name, key, 'application/pdf', updated);
}
function indexed(w: World, id: number, project: number, passages: string[]) {
  w.db.prepare("INSERT INTO data_room_search_state (file_id, project_id, status, passages, indexed_at) VALUES (?, ?, 'indexed', ?, '2026-11-01 10:00:00')").run(id, project, passages.length);
  passages.forEach((t, seq) => w.db.prepare('INSERT INTO data_room_passages (project_id, file_id, seq, text, vector_id) VALUES (?, ?, ?, ?, ?)').run(project, id, seq, t, `drf:${id}:${seq}`));
}
const agentOf = (w: World) => w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(AGENT) as any;
const ctx = (w: World, document: string | null = null, page?: ReadContext['page']): ReadContext => ({ scope: SCOPE, agent: agentOf(w), projectId: PROJECT, document, page });
const count = (w: World, sql: string) => (w.db.prepare(sql).get() as any).n as number;
const modelCalls = (calls: string[]) => calls.filter((m) => m !== GUARD).length;
const manual = (w: World, over: Partial<AgentRunInput> = {}) => agentRun(w.env, { agent: agentOf(w), ...STEP, skill: SKILL_UID, ...over });
const docInput = async (w: World, document: string | null) =>
  (await preflight(w.env, SLUG, ctx(w, document), READERS, NOW, undefined, {}, { granted: READS }))!;

// ── The reader ──────────────────────────────────────────────────────────────

test('data_room.index with no document selected answers the room\'s index, and no text', async () => {
  const f = docWorld();
  try {
    file(f.w, 73, '4'.repeat(32), 8, 'Other venture.pdf', 'data-room/p8/x', '2026-11-01 09:00:00');
    file(f.w, 74, '5'.repeat(32), PROJECT, 'Binned.pdf', 'data-room/p7/bin', '2026-11-01 09:00:00');
    f.w.db.exec("UPDATE data_room_files SET removed_at = '2026-11-02 09:00:00' WHERE id = 74");
    const r: any = await readOne(f.w.env, 'data_room.index', ctx(f.w));
    assert.equal(r.data.document_status, 'not_selected');
    assert.equal(r.data.document, null);
    // Mutation checked: the Trash clause dropped → the binned file is listed and counted.
    assert.deepEqual(r.data.files.map((x: any) => [x.ref, x.version, x.text]).sort(),
      [[`data_room_file:${MSA}`, 2, 'read'], [`data_room_file:${LONG}`, 1, 'read'], [`data_room_file:${BROKEN}`, 1, 'failed']].sort());
    assert.deepEqual(r.data.coverage, { returned: 3, total: 3, omitted: 0, complete: true });
    assert.ok(!JSON.stringify(r).includes('Limitation of liability'), 'an index carries no text');
  } finally { f.w.close(); }
});

test('one selected current document: its file uid, version, version digest and passages, each with a stable reference', async () => {
  const f = docWorld();
  try {
    const r: any = await readOne(f.w.env, 'data_room.index', ctx(f.w, `data_room_file:${MSA}`));
    const d = r.data.document;
    assert.equal(r.data.document_status, 'read');
    assert.deepEqual([d.ref, d.file_uid, d.version, d.name], [`data_room_file:${MSA}`, MSA, 2, 'Synthetic MSA.pdf']);
    assert.deepEqual(d.passages.map((p: any) => p.ref), [`data_room_passage:${MSA}:0`, `data_room_passage:${MSA}:1`]);
    assert.ok(d.passages[1].text.includes(CLAUSE), 'a passage is never cut');
    assert.deepEqual(d.coverage, { returned: 2, total: 2, omitted: 0, complete: true, first: 0 });
    assert.equal(d.page.next, null);
    // The digest is over this version's object and its whole text on record, so a replaced, re-read file changes it.
    const texts = (f.w.db.prepare('SELECT text FROM data_room_passages WHERE file_id = 70 ORDER BY seq').all() as any[]).map((x) => x.text);
    const want = createHash('sha256').update([MSA, 'data-room/p7/msa-v2', ...texts].join('\n\u0000\n')).digest('hex');
    assert.equal(d.version_digest, `sha256:${want}`);
    // A bare uid selects the same document.
    assert.equal(((await readOne(f.w.env, 'data_room.index', ctx(f.w, MSA))).data as any).document.version_digest, d.version_digest);
    f.w.db.exec("UPDATE data_room_files SET r2_key = 'data-room/p7/msa-v3', updated_at = '2026-11-01 09:30:00' WHERE id = 70");
    const changed: any = await readOne(f.w.env, 'data_room.index', ctx(f.w, MSA));
    assert.notEqual(changed.data.document.version_digest, d.version_digest);
    // Another venture's file, and a file in Trash, are not in this room.
    file(f.w, 73, '4'.repeat(32), 8, 'Other venture.pdf', 'data-room/p8/x', '2026-11-01 09:00:00');
    indexed(f.w, 73, 8, ['Other venture text.']);
    assert.equal(((await readOne(f.w.env, 'data_room.index', ctx(f.w, '4'.repeat(32)))).data as any).document_status, 'not_found');
    f.w.db.exec("UPDATE data_room_files SET removed_at = '2026-11-02 09:00:00' WHERE id = 70");
    assert.equal(((await readOne(f.w.env, 'data_room.index', ctx(f.w, MSA))).data as any).document_status, 'not_found');
  } finally { f.w.close(); }
});

test('a document longer than one read is bounded by whole passages, says what it left out, and continues', async () => {
  const f = docWorld();
  try {
    const first: any = (await readOne(f.w.env, 'data_room.index', ctx(f.w, LONG))).data;
    const d = first.document;
    // Mutation checked: the budget not applied → all six passages are carried and coverage reads complete.
    assert.equal(d.passages.length, Math.floor(DOCUMENT_TEXT_BUDGET / 1_100));
    assert.deepEqual(d.coverage, { returned: 4, total: 6, omitted: 2, complete: false, first: 0 });
    assert.equal(d.page.next, `data_room_passage:${LONG}:3`);
    const rest: any = (await readOne(f.w.env, 'data_room.index', ctx(f.w, LONG, { after: d.page.next }))).data;
    assert.deepEqual(rest.document.passages.map((p: any) => p.seq), [4, 5]);
    assert.equal(rest.document.page.next, null);
    assert.equal(rest.document.coverage.complete, false, 'a later page is not the whole document');
    assert.equal(rest.document.version_digest, d.version_digest, 'every page names the same version');
    // A continuation from another document, or one this document never gave, is refused, never widened.
    await assert.rejects(() => readOne(f.w.env, 'data_room.index', ctx(f.w, LONG, { after: `data_room_passage:${MSA}:0` })), (e: any) => e instanceof ReadPageError && e.code === 'unknown_cursor');
    await assert.rejects(() => readOne(f.w.env, 'data_room.index', ctx(f.w, LONG, { after: 'activity:x' })), (e: any) => e instanceof ReadPageError && e.code === 'invalid_page');
  } finally { f.w.close(); }
});

test('the room\'s own rule: the owner and an accepted co-founder read it; an outsider and an admin are withheld', async () => {
  for (const [who, member, want] of [[SPONSOR, null, 'read'], [MEMBER, 'accepted', 'read'], [MEMBER, 'invited', 'withheld'], [STRANGER, null, 'withheld'], [ADMIN, null, 'withheld']] as const) {
    const f = docWorld({ sponsor: who });
    try {
      if (member) f.w.db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'cofounder', ?)").run(PROJECT, who, member);
      const r: any = (await readOne(f.w.env, 'data_room.index', ctx(f.w, MSA))).data;
      // Mutation checked: the co-founder's `status = 'accepted'` dropped → an invited member reads the room.
      assert.equal(r.withheld ? 'withheld' : r.document_status, want, `sponsor ${who} ${member ?? ''}`);
      if (r.withheld) assert.ok(!JSON.stringify(r).includes('Synthetic MSA'), 'none of the room is carried');
    } finally { f.w.close(); }
  }
});

// ── The evidence boundary ───────────────────────────────────────────────────

test('preflight: complete is ready, bounded is conditional, and unreadable, not current, never read, not found and not selected are not ready', async () => {
  const f = docWorld();
  try {
    const complete = await docInput(f.w, `data_room_file:${MSA}`);
    assert.equal(complete.inputs.find((i) => i.read === 'data_room.index')!.status, 'available');
    assert.deepEqual([complete.state, complete.limits], ['ready', []]);
    const bounded = await docInput(f.w, LONG);
    const doc = bounded.inputs.find((i) => i.read === 'data_room.index')!;
    assert.deepEqual([bounded.state, doc.status], ['conditional', 'partial']);
    assert.ok(bounded.limits.includes('the contract text, with document and version identity: 4 of 6 passages of the document supplied; 2 left out.'));
    const why = async (document: string | null) => {
      const p = await docInput(f.w, document);
      const i = p.inputs.find((x) => x.read === 'data_room.index')!;
      return [p.state, i.status, i.reason];
    };
    assert.deepEqual(await why(BROKEN), ['not_ready', 'unreadable', 'failed']);
    f.w.db.exec("UPDATE data_room_search_state SET status = 'no_text', error = NULL WHERE file_id = 72");
    assert.deepEqual(await why(BROKEN), ['not_ready', 'unreadable', 'no_text']);
    assert.deepEqual(await why(null), ['not_ready', 'missing', 'not_selected']);
    assert.deepEqual(await why('9'.repeat(32)), ['not_ready', 'missing', 'not_found']);
    f.w.db.exec('DELETE FROM data_room_search_state WHERE file_id = 70');
    assert.deepEqual(await why(MSA), ['not_ready', 'missing', 'not_read']);
    f.w.db.exec("INSERT INTO data_room_search_state (file_id, project_id, status, passages, indexed_at) VALUES (70, 7, 'indexed', 2, '2026-11-01 10:00:00')");
    // Replaced after its text was read: the text on record is version 2's, the current version is 3.
    // Mutation checked: the `updated_at > indexed_at` arm dropped → version 2's text is supplied as the current one.
    f.w.db.exec("UPDATE data_room_files SET updated_at = '2026-11-03 09:00:00' WHERE id = 70");
    assert.deepEqual(await why(MSA), ['not_ready', 'missing', 'not_current']);
  } finally { f.w.close(); }
});

test('manual: a run on a selected document carries the passages it judged; one with no document is refused before any charge', async () => {
  const f = docWorld();
  try {
    const none: any = await manual(f.w);
    assert.deepEqual([none.ok, none.status, none.code], [false, 422, 'skill_not_ready'], JSON.stringify(none));
    assert.deepEqual(none.extra.inputs, [{ field: 'the contract text, with document and version identity', read: 'data_room.index', status: 'missing', reason: 'not_selected' }]);
    assert.match(none.message, /no document is selected for the run/);
    assert.equal(modelCalls(f.calls), 0);
    assert.equal(count(f.w, 'SELECT COUNT(*) AS n FROM ai_usage_logs'), 0);
    const broken: any = await manual(f.w, { record: `data_room_file:${BROKEN}` });
    assert.equal(broken.code, 'skill_not_ready');
    assert.match(broken.message, /could not be read to text/);
    assert.equal(modelCalls(f.calls), 0);
    // Mutation checked: the record not passed as `document` → the run is refused not_selected.
    const r: any = await manual(f.w, { record: `data_room_file:${MSA}` });
    assert.equal(r.ok, true, JSON.stringify(r));
    const turn = f.prompts.join('\n');
    assert.match(turn, /source=\\"read:data_room\.index\\" trust=\\"data\\"/);
    assert.ok(turn.includes(`data_room_passage:${MSA}:1`) && turn.includes('aggregate liability'), 'the passage the check read is the one the run carries');
    assert.equal(r.proposal.record_ref, `data_room_file:${MSA}`, 'the proposal names the document it worked on');
  } finally { f.w.close(); }
});

// ── Scheduled path ──────────────────────────────────────────────────────────

async function scheduled(f: ReturnType<typeof docWorld>, target: string | null) {
  const { w } = f;
  w.db.prepare(`INSERT INTO agent_duties (uid, agent_id, kind, title, cadence, hour_utc, minute_utc, zone, run_at, skill_id, skill_version, target_kind, target_id, instruction, next_due_at, status, created_by)
    VALUES ('session-1', ?, 'session', 'Clauses', 'once', 9, 0, 'UTC', '2027-03-16 09:00:00', 1, 1, ?, ?, 'List the clauses.', '2027-03-16 09:00:00', 'active', ?)`)
    .run(AGENT, target ? 'document' : null, target, SPONSOR);
  w.task(200, AGENT);
  w.db.prepare("UPDATE scope_tasks SET source_kind = 'duty', source_ref = 'session-1' WHERE id = 200").run();
  const a = await w.runtime.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
  assert.ok(a.ok, JSON.stringify(a));
  const inputs: AgentRunInput[] = [];
  const prompts: string[] = [];
  const inner = fakeAgentRun(w);
  const d = loopDeps(w, async (env, input) => { inputs.push(input); prompts.push(input.prompt); return inner.fn(env, input); });
  assert.ok((await load(d, a.run.uid)).go);
  assert.ok((await context(d, a.run.uid)).go, 'the context step reads the room');
  return { uid: a.run.uid, d, inputs, prompts, inner };
}

test('scheduled: a session on a document reads its text and runs; a session with none ends skill_not_ready before agentRun', async () => {
  const f = docWorld();
  try {
    const s = await scheduled(f, MSA);
    assert.ok((await runStep(s.d, s.uid)).go);
    assert.equal(s.inputs.length, 1);
    // Mutation checked: the session's target not passed to the reads → the context carries the index and the check refuses.
    assert.ok(s.prompts[0].includes(`data_room_passage:${MSA}:1`), 'the session\'s document text is in the context');
    assert.equal(s.inputs[0].readiness?.slug, SLUG);
  } finally { f.w.close(); }
  const g = docWorld();
  try {
    const s = await scheduled(g, null);
    assert.deepEqual(await runStep(s.d, s.uid), { go: false, status: 'refused', refusal: 'skill_not_ready' });
    assert.equal(s.inputs.length, 0);
    assert.equal(s.inner.state.charges, 0);
  } finally { g.w.close(); }
});

test('a session may target a document only of a room in its scope that the sponsor reads whole', async () => {
  const f = docWorld();
  try {
    const a = agentOf(f.w);
    assert.deepEqual(await targetReadable(f.w.env, a, SCOPE, { kind: 'document', id: MSA }), { title: 'Synthetic MSA.pdf', href: null });
    file(f.w, 73, '4'.repeat(32), 8, 'Other venture.pdf', 'data-room/p8/x', '2026-11-01 09:00:00');
    assert.equal(await targetReadable(f.w.env, a, SCOPE, { kind: 'document', id: '4'.repeat(32) }), null, 'another venture\'s file');
    assert.equal(await targetReadable(f.w.env, a, SCOPE, { kind: 'document', id: 'not-a-uid' }), null);
    f.w.db.exec("UPDATE data_room_files SET removed_at = '2026-11-02 09:00:00' WHERE id = 70");
    assert.equal(await targetReadable(f.w.env, a, SCOPE, { kind: 'document', id: MSA }), null, 'a file in Trash');
  } finally { f.w.close(); }
  // An admin sponsor reads the team, but reads a room only through an audited support read, never as an agent's sponsor.
  const g = docWorld({ sponsor: ADMIN });
  try {
    // Mutation checked: the room rule not checked → the admin's agent may target the venture's document.
    assert.equal(await targetReadable(g.w.env, agentOf(g.w), SCOPE, { kind: 'module', id: 'use-of-funds' }) !== null, true, 'the sponsor reads the team');
    assert.equal(await targetReadable(g.w.env, agentOf(g.w), SCOPE, { kind: 'document', id: MSA }), null);
  } finally { g.w.close(); }
  // The check is the same one a run makes.
  const h = docWorld();
  try {
    const ok = await skillEvidenceForRun(h.w.env, { agent: agentOf(h.w), scope: SCOPE, rules: { reads: READS }, slug: SLUG, projectId: PROJECT, document: `data_room_file:${LONG}` });
    assert.ok(ok.ok && ok.evidence?.state === 'conditional' && ok.evidence.blocks.some((b) => b.includes(`data_room_passage:${LONG}:0`)));
  } finally { h.w.close(); }
});

// ── The owner's answers on #4588 (A, A) ─────────────────────────────────────

const SAFE = 'safe-convertible-instrument-review';
const SAFE_READS = ['data_room.index', 'cap_table.read', 'raise.records'];
/** The cap table and raise terms answer complete and fresh, so the instrument's text is the only thing in question. */
const typedRest = {
  ...READERS,
  'cap_table.read': async () => ({ records: [{ ref: `cap_table:${PROJECT}`, at: '2026-11-10 10:00:00' }], coverage: coverageOf(1, 1) }),
  'raise.records': async () => ({ records: [{ ref: 'activity:raise-1', at: '2026-11-10 10:00:00' }], coverage: coverageOf(1, 1) }),
} as any;

test('#4588 A: the SAFE review reads its instrument text from the selected document, and declares data_room.read', async () => {
  const need = FIRST_TEN.find((s) => s.slug === SAFE)!.needs.find((n) => n.field.startsWith('the instrument text'))!;
  // Mutation checked: the need moved to `raise.records` (typed), or made optional → this fails, and so do the states below.
  assert.deepEqual([need.read, need.expects, need.required], ['data_room.index', 'document_text', true]);
  const md = readFileSync(new URL('../src/services/agents/skills/safe-convertible-instrument-review.md', import.meta.url), 'utf8');
  // Mutation checked: data_room.read dropped from the skill's tools → this fails.
  assert.ok((readLibrarySkill(md)!.tools as string[]).includes('data_room.read'), 'the skill declares the read its instrument comes from');
  const f = docWorld();
  try {
    const safe = async (document: string | null) => (await preflight(f.w.env, SAFE, ctx(f.w, document), typedRest, NOW, undefined, {}, { granted: SAFE_READS }))!;
    const text = (p: Awaited<ReturnType<typeof safe>>) => p.inputs.find((i) => i.read === 'data_room.index')!;
    const complete = await safe(`data_room_file:${MSA}`);
    assert.deepEqual([complete.state, text(complete).status, complete.limits], ['ready', 'available', []]);
    const none = await safe(null);
    assert.deepEqual([none.state, text(none).status, text(none).reason], ['not_ready', 'missing', 'not_selected']);
    const bounded = await safe(LONG);
    assert.deepEqual([bounded.state, text(bounded).status], ['conditional', 'partial']);
    assert.deepEqual(bounded.limits, ['the instrument text, with version identity: 4 of 6 passages of the document supplied; 2 left out.']);
  } finally { f.w.close(); }
});

test('#4588 A: the contract review policy stays a person\'s evidence, manual:review_policy, never a company-profile field', async () => {
  const risk = FIRST_TEN.find((s) => s.slug === 'contract-risk-issue-spotting')!;
  const policy = risk.needs.find((n) => n.field === 'the organization review policy')!;
  // Mutation checked: the policy read as `company.profile.review_policy` → this and the preflight below fail.
  assert.deepEqual([policy.read, policy.expects, policy.required], ['manual:review_policy', 'manual_evidence', true]);
  assert.ok(!FIRST_TEN.some((s) => s.needs.some((n) => n.read.includes('review_policy') && n.read !== 'manual:review_policy')));
  const f = docWorld();
  try {
    const at = (supplied = {}) => preflight(f.w.env, 'contract-risk-issue-spotting', ctx(f.w, `data_room_file:${MSA}`), READERS, NOW, undefined, supplied, { granted: READS });
    const without = (await at())!;
    const p = without.inputs.find((i) => i.read === 'manual:review_policy')!;
    assert.deepEqual([without.state, p.status, p.source], ['not_ready', 'missing', 'manual']);
    const given = (await at({ 'manual:review_policy': { ref: 'manual:review-policy-2026', recorded_at: '2026-11-01', text: 'Cap liability at twelve months of fees.' } }))!;
    const q = given.inputs.find((i) => i.read === 'manual:review_policy')!;
    assert.deepEqual([q.status, q.source, q.ref], ['available', 'manual', 'manual:review-policy-2026']);
    assert.notEqual(given.state, 'not_ready', 'a person\'s policy and the selected contract are enough to run');
  } finally { f.w.close(); }
});
