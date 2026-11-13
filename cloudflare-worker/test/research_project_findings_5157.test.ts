/**
 * D5157 part 2 (#5157) — a Research Project's findings against the canonical
 * migrations: the kinds and their CHECKs, citations that must name what the
 * project holds, Accept / Edit / Discard on an Eadwyn interpretation taken from
 * the project's Ask answers, your own conclusion edited and deleted, owner
 * scoping and the archived guard.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_project_findings_5157.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { d1Over } from './_d1_sqlite.mjs';
import projects from '../src/routes/research_projects.ts';
import findings, { mount, readText, resolveCitations } from '../src/routes/research_project_findings.ts';

// Mounted as the registry mounts them: findings first, then the project router.
const app = new Hono().route('/api/research/projects', findings).route('/api/research/projects', projects);
app.onError((error, c) => c.json({ detail: error.message }, error.message === 'Unauthorized' ? 401 : 500));
const SECRET = 'unit-research-findings-01234567890123456789';
const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');
const MIGRATION = 'migrations/202611130254_5157_research_project_findings.sql';

const CITES = JSON.stringify([
  { n: 1, title: 'EU Data Act', document_uid: 'doc-indexed', passage: 'This Regulation shall apply from 12 September 2025.', page: 4 },
  { n: 2, title: 'Power prices', document_uid: 'doc-pending', passage: 'Nordic power is the cheapest in Europe.', page: 1 },
  { n: 3, title: 'Outside the project', document_uid: 'doc-outside', passage: 'Not part of this project.', page: 2 },
]);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = sql('schema_baseline.sql');
  db.exec(baseline.match(/CREATE TABLE users \([\s\S]*?;/)![0]);
  db.exec(baseline.match(/CREATE TABLE projects \([\s\S]*?;/)![0]);
  db.exec(baseline.match(/CREATE TABLE activity_logs \([\s\S]*?;/)![0]);
  db.exec(sql('migrations/213_research_library.sql'));
  db.exec(sql('migrations/221_research_ask_sessions.sql'));
  db.exec(sql('migrations/385_research_disposition_collections.sql'));
  db.exec(sql('migrations/202611092035_research_projects.sql'));
  db.exec(sql(MIGRATION));
  db.exec("INSERT INTO users (id,email,name,role) VALUES (701,'owner@example.test','Owner','founder'),(702,'other@example.test','Other','founder')");
  db.exec(`INSERT INTO research_documents (id,uid,owner_user_id,title,r2_key,index_state,created_at) VALUES
    (1,'doc-indexed',701,'EU Data Act','r/1','indexed','2026-11-01 10:00:00'),
    (2,'doc-pending',701,'Power prices','r/2','pending','2026-11-02 10:00:00'),
    (3,'doc-outside',701,'Not in the project','r/3','indexed','2026-11-03 10:00:00'),
    (4,'other-doc',702,'Other file','r/4','indexed','2026-11-04 10:00:00')`);
  db.exec("INSERT INTO research_ask_sessions (id,uid,owner_user_id) VALUES (1,'ses-own',701),(2,'ses-loose',701),(3,'ses-other',702)");
  const answer = db.prepare('INSERT INTO research_ask_answers (id,uid,session_id,owner_user_id,question,answer,reason,citations) VALUES (?,?,?,?,?,?,?,?)');
  answer.run(1, 'ans-cited', 1, 701, 'When does the Data Act apply?', 'It applies from 12 September 2025 [1]; power is cheap in the Nordics [2].', 'answered', CITES);
  answer.run(2, 'ans-nosource', 1, 701, 'What is the EU GPU count?', null, 'no_source', '[]');
  answer.run(3, 'ans-loose', 2, 701, 'Not kept with the project', 'A loose answer [1].', 'answered', CITES);
  answer.run(4, 'ans-other', 3, 702, 'Private?', 'Private [1].', 'answered', '[]');
  db.exec('PRAGMA foreign_keys=ON');
  const statements: string[] = [];
  const underlying = d1Over(db);
  const DB = { ...underlying, prepare(query: string) { statements.push(query); return underlying.prepare(query); } };
  return { db, statements, env: { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, method: string, path: string, body?: unknown, who: number | null = 701) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who != null) {
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
  }
  const response = await app.request(`/api/research/projects${path}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  return { status: response.status, body: await response.json() as any };
}
const rows = (f: F, q: string) => f.db.prepare(q).all().map((r) => ({ ...r }));
const receipts = (f: F) => rows(f, "SELECT action FROM activity_logs WHERE action LIKE 'research_project_%' ORDER BY id").map((r: any) => r.action);

/** A project holding doc-indexed and doc-pending as evidence and ses-own's answers. */
async function project(f: F, who = 701) {
  const uid = (await call(f, 'POST', '', { question: 'Can a seed company enter EU GPU capacity?' }, who)).body.item.uid as string;
  if (who === 701) {
    await call(f, 'POST', `/${uid}/documents`, { document_uid: 'doc-indexed' });
    await call(f, 'POST', `/${uid}/documents`, { document_uid: 'doc-pending' });
    await call(f, 'POST', `/${uid}/sessions`, { session_uid: 'ses-own' });
  }
  return uid;
}

test('the router mounts itself at /api/research/projects beside the project router (#4105)', () => {
  assert.equal(mount.path, '/api/research/projects');
  assert.equal(mount.router, findings);
  const registry = readFileSync(new URL('../src/routes/_registry.ts', import.meta.url), 'utf8');
  assert.match(registry, /research_project_findings/);
});

test('the migration keeps a state and Eadwyn’s words on interpretations only, one decision per answer', () => {
  const f = fixture();
  f.db.exec("INSERT INTO research_projects (id,uid,owner_user_id,title,question,created_by) VALUES (1,'p',701,'T','Q',701)");
  const insert = (kind: string, state: string | null, proposed: string | null, answerId: number | null = null) => f.db.prepare(
    `INSERT INTO research_project_findings (uid,project_id,owner_user_id,kind,text,proposed_text,answer_id,state,decided_by,created_by)
     VALUES (lower(hex(randomblob(8))),1,701,?,'Text',?,?,?,701,701)`,
  ).run(kind, proposed, answerId, state);
  // Mutation checked: drop the state CHECK pair → the first two insert.
  assert.throws(() => insert('conclusion', 'accepted', null), /CHECK/);
  assert.throws(() => insert('interpretation', null, 'Eadwyn'), /CHECK/);
  // Mutation checked: drop the proposed_text CHECK pair → these two insert.
  assert.throws(() => insert('interpretation', 'accepted', null), /CHECK/);
  assert.throws(() => insert('source_fact', null, 'Eadwyn'), /CHECK/);
  assert.throws(() => insert('opinion', null, null), /CHECK/);
  insert('interpretation', 'accepted', 'Eadwyn', 1);
  // Mutation checked: drop the partial unique index → a second decision row inserts.
  assert.throws(() => insert('interpretation', 'discarded', 'Eadwyn', 1), /UNIQUE/);
  insert('conclusion', null, null);
});

test('list: the project’s answered Ask answers are proposals, with the sources each cites', async () => {
  const f = fixture();
  const uid = await project(f);
  const read = await call(f, 'GET', `/${uid}/findings`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.items, []);
  // ans-nosource has no words to decide on; ans-loose and ans-other are not this project's.
  assert.deepEqual(read.body.proposals.map((p: any) => p.answer_uid), ['ans-cited']);
  const cites = read.body.proposals[0].citations;
  assert.deepEqual(cites.map((x: any) => [x.n, x.document_uid, x.availability, x.in_evidence, x.in_ask]), [
    [1, 'doc-indexed', 'available', true, true],
    [2, 'doc-pending', 'available', true, false],
  ]);
  // The passages a source fact may cite: recorded with the project's answers, from its evidence only.
  assert.deepEqual(read.body.passages.map((p: any) => [p.answer_uid, p.n, p.document_uid]), [['ans-cited', 1, 'doc-indexed'], ['ans-cited', 2, 'doc-pending']]);
  assert.deepEqual(read.body.counts, { source_fact: 0, interpretation: 0, conclusion: 0, discarded: 0, proposals: 1 });
  assert.equal((await call(f, 'GET', `/${uid}/findings`, undefined, 702)).status, 404);
  assert.equal((await call(f, 'GET', `/${uid}/findings`, undefined, null)).status, 401);
});

test('a source fact stands on a passage the project holds; a conclusion may stand alone', async () => {
  const f = fixture();
  const uid = await project(f);
  const statuses: number[] = [];
  for (const body of [
    { kind: 'interpretation', text: 'Typed by hand' },
    { kind: 'source_fact', text: 'The Data Act applies from 12 September 2025.' },
    { kind: 'source_fact', text: 'Cited by document only', citations: [{ document_uid: 'doc-indexed' }] },
    { kind: 'source_fact', text: 'Outside', citations: [{ answer_uid: 'ans-cited', n: 3 }] },
    { kind: 'source_fact', text: 'Loose', citations: [{ answer_uid: 'ans-loose', n: 1 }] },
    { kind: 'source_fact', text: 'Theirs', citations: [{ answer_uid: 'ans-other', n: 1 }] },
    { kind: 'conclusion', text: 'Theirs', citations: [{ document_uid: 'other-doc' }] },
    { kind: 'conclusion', text: '   ' },
    { kind: 'conclusion', text: 'x'.repeat(4001) },
    { kind: 'conclusion', text: 'Many', citations: Array.from({ length: 9 }, () => ({ document_uid: 'doc-indexed' })) },
  ]) statuses.push((await call(f, 'POST', `/${uid}/findings`, body)).status);
  // Mutation checked: let a source fact through without a passage → the second and third are 201.
  // Mutation checked: accept any citation as the source fact's footing → the third is 201.
  // Mutation checked: drop the evidence check on an answer citation → the fourth is 201.
  assert.deepEqual(statuses, [400, 400, 400, 400, 400, 400, 400, 400, 400, 400]);
  assert.deepEqual(rows(f, 'SELECT COUNT(*) AS n FROM research_project_findings'), [{ n: 0 }]);

  const text = "The Data Act applies from 12 September 2025.'; DROP TABLE research_project_findings; --";
  const fact = await call(f, 'POST', `/${uid}/findings`, { kind: 'source_fact', text: `  ${text}  `, citations: [{ answer_uid: 'ans-cited', n: 1 }, { answer_uid: 'ans-cited', n: 1 }] });
  assert.equal(fact.status, 201);
  // Mutation checked: inline the text, escaped or not → a statement carries it.
  assert.equal(f.statements.some((q) => q.includes('DROP TABLE')), false, 'request text never reaches the query text');
  const mine = await call(f, 'POST', `/${uid}/findings`, { kind: 'conclusion', text: 'Entry is viable only with a power-cost advantage.' });
  assert.equal(mine.status, 201);
  const read = (await call(f, 'GET', `/${uid}/findings`)).body;
  assert.deepEqual(read.items.map((i: any) => [i.kind, i.text, i.state, i.citations.length]), [
    ['conclusion', 'Entry is viable only with a power-cost advantage.', null, 0],
    ['source_fact', text, null, 1],
  ]);
  assert.deepEqual(read.items[1].citations[0], {
    n: 1, document_uid: 'doc-indexed', title: 'EU Data Act', passage: 'This Regulation shall apply from 12 September 2025.', page: 4,
    answer_uid: 'ans-cited', availability: 'available', in_evidence: true, index_state: 'indexed', in_ask: true, source_year: null,
  });
  assert.deepEqual(receipts(f).filter((a) => a.includes('finding')), ['research_project_finding_added', 'research_project_finding_added']);
  assert.doesNotMatch(JSON.stringify(rows(f, 'SELECT details FROM activity_logs')), /Data Act applies/, 'the receipt carries no finding text');
});

test('Accept, Edit and Discard decide on Eadwyn’s words and keep them beside an edit', async () => {
  const f = fixture();
  const uid = await project(f);
  const statuses: number[] = [];
  for (const [path, body] of [
    ['/interpretations/ans-cited', { decision: 'maybe' }],
    ['/interpretations/ans-loose', { decision: 'accept' }],
    ['/interpretations/ans-other', { decision: 'accept' }],
    ['/interpretations/ans-nosource', { decision: 'accept' }],
    ['/interpretations/ans-cited', { decision: 'edit', text: '' }],
    ['/interpretations/ans-cited', { decision: 'edit', text: 'It applies from 12 September 2025 [1]; power is cheap in the Nordics [2].' }],
  ] as const) statuses.push((await call(f, 'POST', `/${uid}${path}`, body)).status);
  assert.deepEqual(statuses, [400, 404, 404, 409, 400, 400]);

  const proposed = 'It applies from 12 September 2025 [1]; power is cheap in the Nordics [2].';
  const accepted = await call(f, 'POST', `/${uid}/interpretations/ans-cited`, { decision: 'accept' });
  assert.deepEqual([accepted.status, accepted.body.item.state], [200, 'accepted']);
  let read = (await call(f, 'GET', `/${uid}/findings`)).body;
  // Mutation checked: keep decided answers among the proposals → ans-cited is still proposed.
  assert.deepEqual(read.proposals, []);
  assert.deepEqual(read.items.map((i: any) => [i.kind, i.state, i.text, i.proposed_text, i.answer_uid]), [['interpretation', 'accepted', proposed, proposed, 'ans-cited']]);
  // The sources the answer cites travel with it; [3] is not cited, so it does not.
  // Mutation checked: keep every retrieved passage, cited or not → a third citation appears.
  assert.deepEqual(read.items[0].citations.map((x: any) => [x.n, x.document_uid, x.passage]), [
    [1, 'doc-indexed', 'This Regulation shall apply from 12 September 2025.'],
    [2, 'doc-pending', 'Nordic power is the cheapest in Europe.'],
  ]);

  const edited = await call(f, 'POST', `/${uid}/interpretations/ans-cited`, { decision: 'edit', text: 'The Act applies from September 2025.' });
  assert.equal(edited.body.item.uid, accepted.body.item.uid, 'a new decision updates the one row');
  read = (await call(f, 'GET', `/${uid}/findings`)).body;
  // Mutation checked: write the edit over proposed_text → Eadwyn's words are lost here.
  assert.deepEqual(read.items.map((i: any) => [i.state, i.text, i.proposed_text]), [['edited', 'The Act applies from September 2025.', proposed]]);
  await call(f, 'POST', `/${uid}/interpretations/ans-cited`, { decision: 'discard' });
  read = (await call(f, 'GET', `/${uid}/findings`)).body;
  assert.deepEqual([read.items[0].state, read.counts.interpretation, read.counts.discarded, read.proposals.length], ['discarded', 0, 1, 0]);
  assert.deepEqual(rows(f, 'SELECT COUNT(*) AS n FROM research_project_findings'), [{ n: 1 }]);
  assert.deepEqual(rows(f, 'SELECT COUNT(*) AS n FROM research_project_finding_citations'), [{ n: 2 }]);
  // A decision stays on record: it is not deleted, and it is not edited as text.
  assert.equal((await call(f, 'DELETE', `/${uid}/findings/${accepted.body.item.uid}`)).status, 409);
  assert.equal((await call(f, 'PATCH', `/${uid}/findings/${accepted.body.item.uid}`, { text: 'Rewritten' })).status, 409);
  assert.deepEqual(receipts(f).filter((a) => a.includes('interpretation')), ['research_project_interpretation_decided', 'research_project_interpretation_decided', 'research_project_interpretation_decided']);
});

test('your conclusion is edited and deleted by you only', async () => {
  const f = fixture();
  const uid = await project(f);
  const other = await project(f, 702);
  const made = (await call(f, 'POST', `/${uid}/findings`, { kind: 'conclusion', text: 'Start in Norway.' })).body.item.uid;
  const fact = (await call(f, 'POST', `/${uid}/findings`, { kind: 'source_fact', text: 'Power is cheap.', citations: [{ answer_uid: 'ans-cited', n: 2 }] })).body.item.uid;
  assert.equal((await call(f, 'PATCH', `/${uid}/findings/${made}`, { text: 'Stolen' }, 702)).status, 404);
  assert.equal((await call(f, 'PATCH', `/${other}/findings/${made}`, { text: 'Stolen' }, 702)).status, 404);
  assert.equal((await call(f, 'DELETE', `/${uid}/findings/${made}`, undefined, 702)).status, 404);
  assert.equal((await call(f, 'PATCH', `/${uid}/findings/${fact}`, { text: 'Changed' })).status, 409);
  assert.equal((await call(f, 'PATCH', `/${uid}/findings/${made}`, { text: '' })).status, 400);
  const edited = await call(f, 'PATCH', `/${uid}/findings/${made}`, { text: 'Start in Norway, then Sweden.', citations: [{ document_uid: 'doc-indexed' }] });
  assert.equal(edited.status, 200);
  let read = (await call(f, 'GET', `/${uid}/findings`)).body;
  const conclusion = read.items.find((i: any) => i.uid === made);
  assert.deepEqual([conclusion.text, conclusion.citations.map((x: any) => [x.document_uid, x.passage])], ['Start in Norway, then Sweden.', [['doc-indexed', null]]]);
  assert.equal((await call(f, 'DELETE', `/${uid}/findings/${fact}`)).status, 200);
  assert.equal((await call(f, 'DELETE', `/${uid}/findings/${made}`)).status, 200);
  read = (await call(f, 'GET', `/${uid}/findings`)).body;
  assert.deepEqual(read.items, []);
  assert.deepEqual(rows(f, 'SELECT COUNT(*) AS n FROM research_project_finding_citations'), [{ n: 0 }]);
});

test('an archived project’s findings are read, never written', async () => {
  const f = fixture();
  const uid = await project(f);
  const made = (await call(f, 'POST', `/${uid}/findings`, { kind: 'conclusion', text: 'Kept.' })).body.item.uid;
  await call(f, 'POST', `/${uid}/archive`);
  const statuses = [
    (await call(f, 'POST', `/${uid}/findings`, { kind: 'conclusion', text: 'New' })).status,
    (await call(f, 'PATCH', `/${uid}/findings/${made}`, { text: 'Changed' })).status,
    (await call(f, 'DELETE', `/${uid}/findings/${made}`)).status,
    (await call(f, 'POST', `/${uid}/interpretations/ans-cited`, { decision: 'accept' })).status,
  ];
  // Mutation checked: drop the archived guard on the decision route → the last is 200.
  assert.deepEqual(statuses, [409, 409, 409, 409]);
  assert.deepEqual((await call(f, 'GET', `/${uid}/findings`)).body.items.map((i: any) => i.text), ['Kept.']);
});

test('a deleted source leaves its passage and says it was removed; a deleted answer keeps the decision', async () => {
  const f = fixture();
  const uid = await project(f);
  await call(f, 'POST', `/${uid}/findings`, { kind: 'source_fact', text: 'Power is cheap.', citations: [{ answer_uid: 'ans-cited', n: 2 }] });
  await call(f, 'POST', `/${uid}/interpretations/ans-cited`, { decision: 'accept' });
  f.db.exec("DELETE FROM research_documents WHERE uid='doc-pending'");
  let read = (await call(f, 'GET', `/${uid}/findings`)).body;
  const fact = read.items.find((i: any) => i.kind === 'source_fact');
  // Mutation checked: read availability from the document uid alone → this says available.
  assert.deepEqual([fact.citations[0].availability, fact.citations[0].passage, fact.citations[0].in_ask], ['removed', 'Nordic power is the cheapest in Europe.', null]);
  f.db.exec("DELETE FROM research_ask_answers WHERE uid='ans-cited'");
  read = (await call(f, 'GET', `/${uid}/findings`)).body;
  assert.deepEqual(read.items.map((i: any) => [i.kind, i.state, i.answer_uid]), [['interpretation', 'accepted', null], ['source_fact', null, null]]);
});

test('readText and resolveCitations refuse what is not text or not the project’s', () => {
  assert.deepEqual(readText(7), { error: 'text_required' });
  assert.deepEqual(readText(' ok '), { value: 'ok' });
  const evidence = new Map([['d1', { id: 1, uid: 'd1', title: 'D1', index_state: 'indexed', source_year: 2025 }]]);
  const answers = [{ id: 9, uid: 'a1', question: 'Q', answer: 'A [1]', reason: 'answered', created_at: '', citations: '[{"document_uid":"d1","passage":"P"}]' }];
  // A citation stored without `n` is numbered by its position.
  assert.deepEqual(resolveCitations([{ answer_uid: 'a1', n: 1 }], answers, evidence).citations?.map((c) => [c.document_uid, c.passage, c.answer_id]), [['d1', 'P', 9]]);
  assert.deepEqual(resolveCitations('nope', answers, evidence), { error: 'invalid_citations' });
  assert.deepEqual(resolveCitations([{ answer_uid: 'a1', n: '1' }], answers, evidence), { error: 'citation_not_in_project' });
  assert.deepEqual(resolveCitations(undefined, answers, evidence), { citations: [] });
});
