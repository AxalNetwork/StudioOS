/**
 * D7817 (#7817) — a Research Project keeps a frozen copy of a saved analysis
 * version, and a finding may cite a source of it, on a schema built from the
 * baseline plus every migration (this issue's included). Covers each point of
 * the issue's "Done when": attach once and repeat, a copy that survives edit,
 * refresh, rerun and delete, citations of attached sources, a generated
 * finding taken over only as an interpretation, detach keeping findings and
 * `updated_at`, no study reference, owner scope, archived and support-session
 * refusals, and the router's paths beside the other routers on its prefix.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_project_attachments_7817.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { planMounts } from '../src/util/routeRegistry.ts';
import attachments, { mount } from '../src/routes/research_project_attachments.ts';
import { mount as briefsMount } from '../src/routes/research_project_briefs.ts';
import { mount as comparisonsMount } from '../src/routes/research_project_comparisons.ts';
import { mount as findingsMount } from '../src/routes/research_project_findings.ts';
import { mount as projectsMount } from '../src/routes/research_projects.ts';
import { mount as studiesMount } from '../src/routes/research_studies.ts';
import {
  ATTACHMENTS_PER_PROJECT, ATTACHMENT_KINDS, COPY_BYTES_LIMIT, buildCopy, citableSource, mayReadAnalysis,
} from '../src/services/researchProjectAttachments.ts';

// Every router on the prefix, in the order the registry plans them.
const MODULES = [
  { file: 'research_project_attachments', mount },
  { file: 'research_project_briefs', mount: briefsMount },
  { file: 'research_project_comparisons', mount: comparisonsMount },
  { file: 'research_project_findings', mount: findingsMount },
  { file: 'research_projects', mount: projectsMount },
  { file: 'research_studies', mount: studiesMount },
];
const app = new Hono();
for (const m of planMounts(MODULES)) app.route(m.path, m.router);
app.onError((error, c) => c.json({ detail: error.message }, error.message === 'Unauthorized' ? 401 : 500));
const SECRET = 'unit-research-attachments-7817-0123456789ab';
const OWNER = 701, OTHER = 702;

const OUTPUT_V2 = {
  market_summary: 'Clinic scheduling is crowded.',
  wedge: 'Small clinics.',
  findings: [
    { text: 'Acme raised its prices in 2026.', kind: 'fact', source_ids: ['s-ok', 's-fail'] },
    { text: '   ', kind: 'interpretation', source_ids: [] },
    { text: 'Acme is moving up-market.', kind: 'interpretation', source_ids: ['s-ok'] },
  ],
};
const SNAPSHOT_V1 = {
  id: 'an-1', title: 'Clinic scheduling (first save)', status: 'complete',
  candidates: [{ id: 'c-1', name: 'Acme', domain: 'acme.example', url: 'https://acme.example', category: 'direct', summary: 'Old summary' }],
  sources: [{ id: 's-old', candidate_id: 'c-1', url: 'https://acme.example/', kind: 'homepage', title: 'Acme home', status: 200, fetched_at: '2026-11-01T09:00:00Z' }],
  output: { market_summary: 'First take.', findings: [] },
};

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`INSERT INTO users (id, email, name, role, is_active) VALUES
      (701, 'owner@example.test', 'Owner', 'founder', 1), (702, 'other@example.test', 'Other', 'founder', 1);
    INSERT INTO competitor_analyses (id, user_id, title, status, updated_at) VALUES
      ('an-1', 701, 'Clinic scheduling', 'complete', '2026-11-15 10:00:00'),
      ('an-draft', 701, 'Still running', 'running', '2026-11-15 10:00:00'),
      ('an-other', 702, 'Theirs', 'complete', '2026-11-15 10:00:00');
    INSERT INTO competitor_candidates (id, analysis_id, name, domain, url, category, summary, position) VALUES
      ('c-1', 'an-1', 'Acme', 'acme.example', 'https://acme.example', 'direct', 'Scheduling for clinics', 0),
      ('c-9', 'an-other', 'Other Co', 'other.example', 'https://other.example', 'direct', 'Theirs', 0);
    INSERT INTO competitor_sources (id, analysis_id, candidate_id, url, kind, title, status, fetched_at) VALUES
      ('s-ok', 'an-1', 'c-1', 'https://acme.example/pricing', 'pricing', 'Acme pricing', 200, '2026-11-10T10:00:00Z'),
      ('s-fail', 'an-1', 'c-1', 'https://acme.example/about', 'about', 'Acme about', 404, '2026-11-10T10:01:00Z'),
      ('s-theirs', 'an-other', 'c-9', 'https://other.example/', 'homepage', 'Other', 200, '2026-11-10T10:00:00Z');`);
  db.prepare('INSERT INTO competitor_analysis_outputs (analysis_id, output_json, version, updated_at) VALUES (?, ?, ?, ?)')
    .run('an-1', JSON.stringify(OUTPUT_V2), 2, '2026-11-15 10:00:00');
  db.prepare('INSERT INTO competitor_analysis_outputs (analysis_id, output_json, version, updated_at) VALUES (?, ?, ?, ?)')
    .run('an-other', JSON.stringify({ market_summary: 'Theirs' }), 1, '2026-11-15 10:00:00');
  db.prepare('INSERT INTO competitor_analysis_versions (analysis_id, version, snapshot_json, saved_at) VALUES (?, ?, ?, ?)')
    .run('an-1', 1, JSON.stringify(SNAPSHOT_V1), '2026-11-12 08:00:00');
  db.exec('PRAGMA foreign_keys=ON');
  const statements: string[] = [];
  const underlying = d1Over(db);
  const DB = { ...underlying, prepare(query: string) { statements.push(query); return underlying.prepare(query); } };
  return { db, statements, env: { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, method: string, path: string, body?: unknown, who = OWNER, support = false) {
  const token = await new SignJWT({ user_id: who, role: 'founder', ...(support ? { impersonated_by: 9000 } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const response = await app.request(`/api/research/projects${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  return { status: response.status, body: await response.json() as any };
}
const one = (f: F, q: string, ...args: any[]) => ({ ...(f.db.prepare(q).get(...args) as any) });
const count = (f: F, table: string) => Number(one(f, `SELECT COUNT(*) AS n FROM ${table}`).n);
const receipts = (f: F) => f.db.prepare("SELECT action, details FROM activity_logs WHERE action LIKE 'research_project_%' ORDER BY id").all() as any[];
const newProject = async (f: F, who = OWNER) => (await call(f, 'POST', '', { question: 'Who sells clinic scheduling?' }, who)).body.item.uid as string;
const attach = (f: F, uid: string, version = 2, objectId = 'an-1', who = OWNER, support = false) =>
  call(f, 'POST', `/${uid}/attachments`, { kind: 'competitor_analysis', object_id: objectId, version }, who, support);

test('every path of the router is /:uid/attachments…, with no static first segment and no `before`', () => {
  assert.equal(mount.path, '/api/research/projects');
  assert.equal(mount.router, attachments);
  // Mutation checked: add `before: [projects]` → this fails.
  assert.equal((mount as any).before, undefined);
  const paths = attachments.routes.map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(paths.sort(), [
    'DELETE /:uid/attachments/:attachmentUid', 'GET /:uid/attachments', 'GET /:uid/attachments/:attachmentUid', 'POST /:uid/attachments',
  ]);
  for (const r of attachments.routes) assert.match(r.path, /^\/:uid\/attachments(\/|$)/, r.path);
  const registry = readFileSync(new URL('../src/routes/_registry.ts', import.meta.url), 'utf8');
  assert.match(registry, /research_project_attachments/);
  assert.deepEqual([...ATTACHMENT_KINDS], ['competitor_analysis']);
});

test('/with-study and /briefs/saved still answer from their own routers', async () => {
  const f = fixture();
  // research_studies' own refusal sentence: the attachment router never took the path.
  const study = await call(f, 'POST', '/with-study', { project: { question: 'Q?' }, study: { product: 'P' } }, OWNER, true);
  assert.deepEqual([study.status, study.body.error, study.body.message], [403, 'support_read_only', 'Support sessions cannot create research projects.']);
  const saved = await call(f, 'GET', '/briefs/saved');
  assert.deepEqual([saved.status, saved.body], [200, { items: [] }]);
});

test('the owner attaches a completed analysis at a named version once; a repeat returns the same attachment', async () => {
  const f = fixture();
  const uid = await newProject(f);
  const before = f.statements.length;
  const made = await attach(f, uid);
  assert.equal(made.status, 201);
  assert.deepEqual([made.body.created, made.body.item.kind, made.body.item.object_id, made.body.item.version, made.body.item.title, made.body.item.copy_format],
    [true, 'competitor_analysis', 'an-1', 2, 'Clinic scheduling', 1]);
  // Attaching writes the attachment and its receipts (logAdminAction), and nothing else: no study reference.
  const writes = f.statements.slice(before).filter((q) => /^\s*(INSERT|UPDATE|DELETE)/i.test(q));
  assert.deepEqual(writes.map((q) => q.match(/(?:INTO|UPDATE|FROM)\s+(\w+)/i)![1]), ['research_project_attachments', 'activity_logs', 'admin_audit_log']);
  assert.equal(f.statements.some((q) => /study/i.test(q)), false);
  // Mutation checked: drop the existing-row read and the conflict re-read → the repeat is a 409.
  const again = await attach(f, uid);
  assert.deepEqual([again.status, again.body.created, again.body.item.uid], [200, false, made.body.item.uid]);
  assert.equal(count(f, 'research_project_attachments'), 1);
  const earlier = await attach(f, uid, 1);
  assert.deepEqual([earlier.status, earlier.body.item.version, earlier.body.item.title], [201, 1, 'Clinic scheduling (first save)']);

  // The list names what was attached and never carries the copy's body.
  const list = await call(f, 'GET', `/${uid}/attachments`);
  assert.deepEqual(list.body.items.map((i: any) => [i.version, i.saved_at]), [[1, '2026-11-12 08:00:00'], [2, '2026-11-15 10:00:00']]);
  assert.equal(list.body.limit, ATTACHMENTS_PER_PROJECT);
  assert.doesNotMatch(JSON.stringify(list.body), /crowded|acme\.example/);
  // The receipt carries ids, never research text.
  assert.deepEqual(receipts(f).filter((r) => r.action.includes('attachment')).map((r) => r.action), ['research_project_attachment_added', 'research_project_attachment_added']);
  assert.doesNotMatch(JSON.stringify(receipts(f)), /Clinic scheduling|crowded/);
});

test('only a completed analysis the caller owns, at its current or a kept version, can be attached', async () => {
  const f = fixture();
  const uid = await newProject(f);
  const theirs = await newProject(f, OTHER);
  const statuses = [
    (await attach(f, uid, 3)).status, // not a version on record
    (await attach(f, uid, 1, 'an-draft')).status, // not complete
    (await attach(f, uid, 1, 'an-other')).status, // another member's analysis
    (await attach(f, uid, 1, 'an-missing')).status,
    (await attach(f, theirs)).status, // another member's project
    (await call(f, 'POST', `/${uid}/attachments`, { kind: 'study', object_id: 'an-1', version: 2 })).status,
    (await call(f, 'POST', `/${uid}/attachments`, { kind: 'competitor_analysis', object_id: 'an-1', version: '2' })).status,
    (await call(f, 'POST', `/${uid}/attachments`, { kind: 'competitor_analysis', object_id: "an-1' OR 1=1 --", version: 2 })).status,
  ];
  // Mutation checked: drop mayReadAnalysis from the analysis read → the third is 201.
  // Mutation checked: drop the complete check → the second is 201.
  assert.deepEqual(statuses, [404, 404, 404, 404, 404, 400, 400, 400]);
  assert.equal(count(f, 'research_project_attachments'), 0);
  const kept = await attach(f, uid);
  assert.equal((await call(f, 'GET', `/${uid}/attachments/${kept.body.item.uid}`, undefined, OTHER)).status, 404);
  assert.equal((await call(f, 'GET', `/${uid}/attachments`, undefined, OTHER)).status, 404);
  assert.equal((await call(f, 'DELETE', `/${uid}/attachments/${kept.body.item.uid}`, undefined, OTHER)).status, 404);
  assert.equal(mayReadAnalysis(OWNER, OWNER), true);
  assert.equal(mayReadAnalysis(OTHER, OWNER), false);
});

test('editing, refreshing, rerunning or deleting the analysis does not change what the attachment returns', async () => {
  const f = fixture();
  const uid = await newProject(f);
  const att = (await attach(f, uid)).body.item.uid;
  const first = (await call(f, 'GET', `/${uid}/attachments/${att}`)).body.item;
  assert.deepEqual(first.copy.sources.map((s: any) => [s.key, s.url, s.title, s.kind, s.status, s.fetched, s.retrieved_at]), [
    ['s-ok', 'https://acme.example/pricing', 'Acme pricing', 'pricing', 200, true, '2026-11-10T10:00:00Z'],
    ['s-fail', 'https://acme.example/about', 'Acme about', 'about', 404, false, '2026-11-10T10:01:00Z'],
  ]);
  assert.deepEqual([first.copy.title, first.copy.version, first.copy.saved_at, first.copy.sections.market_summary, first.copy.competitors.map((c: any) => c.name)],
    ['Clinic scheduling', 2, '2026-11-15 10:00:00', 'Clinic scheduling is crowded.', ['Acme']]);
  // An edit (a new version), a refresh (sources rewritten), a rerun (candidates replaced), then a delete.
  f.db.exec(`UPDATE competitor_analysis_outputs SET output_json = '{"market_summary":"Edited"}', version = 3 WHERE analysis_id = 'an-1';
    UPDATE competitor_analyses SET title = 'Renamed' WHERE id = 'an-1';
    UPDATE competitor_sources SET status = 500, title = 'Refreshed' WHERE analysis_id = 'an-1';
    DELETE FROM competitor_candidates WHERE analysis_id = 'an-1';`);
  assert.deepEqual((await call(f, 'GET', `/${uid}/attachments/${att}`)).body.item, first);
  f.db.exec("DELETE FROM competitor_analyses WHERE id = 'an-1'");
  assert.equal(count(f, 'competitor_analysis_versions'), 0, 'deleting the analysis deletes its versions');
  // Mutation checked: read the copy from the live analysis → this is a 404 or differs.
  assert.deepEqual((await call(f, 'GET', `/${uid}/attachments/${att}`)).body.item, first);
  assert.equal((await attach(f, uid)).body.item.uid, att, 'the attachment on record is still returned');
});

test('a conclusion cites a fetched source of the attached version and keeps its link, title and retrieval date', async () => {
  const f = fixture();
  const uid = await newProject(f);
  const other = await newProject(f);
  const att = (await attach(f, uid)).body.item.uid;
  const elsewhere = (await attach(f, other, 1)).body.item.uid;
  const statuses: Array<[number, string]> = [];
  for (const citations of [
    [{ attachment_uid: att, source_key: 's-fail' }], // not fetched
    [{ attachment_uid: att, source_key: 's-missing' }],
    [{ attachment_uid: 'not-an-attachment', source_key: 's-ok' }],
    [{ attachment_uid: elsewhere, source_key: 's-old' }], // attached to another project
  ]) {
    const r = await call(f, 'POST', `/${uid}/findings`, { kind: 'conclusion', text: 'Acme is pricing up.', citations });
    statuses.push([r.status, r.body.detail]);
  }
  // Mutation checked: accept any source of the copy → the first is 201.
  // Mutation checked: read attachments across projects → the fourth is 201.
  assert.deepEqual(statuses, Array(4).fill([400, 'citation_not_in_project']));
  // A source fact still needs a recorded passage, and none is recorded for an analysis source.
  const fact = await call(f, 'POST', `/${uid}/findings`, { kind: 'source_fact', text: 'Acme lists prices.', citations: [{ attachment_uid: att, source_key: 's-ok' }] });
  assert.deepEqual([fact.status, fact.body.detail], [400, 'passage_required']);
  assert.equal(count(f, 'research_project_findings'), 0);

  const made = await call(f, 'POST', `/${uid}/findings`, { kind: 'conclusion', text: 'Acme is pricing up.', citations: [{ attachment_uid: att, source_key: 's-ok' }, { attachment_uid: att, source_key: 's-ok' }] });
  assert.equal(made.status, 201);
  const read = (await call(f, 'GET', `/${uid}/findings`)).body;
  assert.deepEqual(read.items[0].citations, [{
    n: 1, document_uid: null, title: 'Acme pricing', passage: null, page: null, answer_uid: null,
    availability: 'attached', in_evidence: false, index_state: null, in_ask: null, source_year: null,
    kind: 'analysis_source', state: 'attached', attachment_uid: att, source_key: 's-ok',
    url: 'https://acme.example/pricing', retrieved_at: '2026-11-10T10:00:00Z',
  }]);
  // The findings read never carries the copy's body.
  assert.doesNotMatch(JSON.stringify(read), /crowded|Small clinics|moving up-market/);
  assert.equal(f.statements.some((q) => /copy_json/.test(q) && /research_project_findings f/.test(q)), false);
  // Editing the conclusion keeps the rule.
  const patched = await call(f, 'PATCH', `/${uid}/findings/${made.body.item.uid}`, { text: 'Changed.', citations: [{ attachment_uid: att, source_key: 's-fail' }] });
  assert.deepEqual([patched.status, patched.body.detail], [400, 'citation_not_in_project']);
});

test('a taken-over generated finding is stored only as an interpretation, its generated words kept as an Ask interpretation keeps them', async () => {
  const f = fixture();
  const uid = await newProject(f);
  const att = (await attach(f, uid)).body.item.uid;
  const path = (n: number | string) => `/${uid}/interpretations/attachments/${att}/${n}`;
  const statuses = [
    (await call(f, 'POST', path(1), { decision: 'maybe' })).status,
    (await call(f, 'POST', path(2), { decision: 'accept' })).status, // blank generated text
    (await call(f, 'POST', path(9), { decision: 'accept' })).status,
    (await call(f, 'POST', `/${uid}/interpretations/attachments/nope/1`, { decision: 'accept' })).status,
    (await call(f, 'POST', path(1), { decision: 'edit', text: 'Acme raised its prices in 2026.' })).status,
  ];
  assert.deepEqual(statuses, [400, 409, 404, 404, 400]);
  // A member cannot type it in as their own finding either.
  assert.equal((await call(f, 'POST', `/${uid}/findings`, { kind: 'interpretation', text: 'Acme raised its prices in 2026.' })).status, 400);

  const proposed = 'Acme raised its prices in 2026.';
  const accepted = await call(f, 'POST', path(1), { decision: 'accept' });
  assert.deepEqual([accepted.status, accepted.body.item.kind, accepted.body.item.state], [200, 'interpretation', 'accepted']);
  const stored = one(f, 'SELECT kind, text, proposed_text, state, answer_id, attachment_finding_n FROM research_project_findings');
  // Mutation checked: store it as a conclusion → the kind CHECKs refuse or this differs.
  assert.deepEqual(stored, { kind: 'interpretation', text: proposed, proposed_text: proposed, state: 'accepted', answer_id: null, attachment_finding_n: 1 });
  let read = (await call(f, 'GET', `/${uid}/findings`)).body;
  // Only the fetched source the generated finding names travels with it.
  // Mutation checked: carry every named source → s-fail appears.
  assert.deepEqual(read.items[0].citations.map((c: any) => [c.source_key, c.state, c.url]), [['s-ok', 'attached', 'https://acme.example/pricing']]);
  assert.deepEqual([read.items[0].attachment_uid, read.items[0].attachment_finding_n], [att, 1]);

  const edited = await call(f, 'POST', path(1), { decision: 'edit', text: 'Acme raised prices.' });
  assert.equal(edited.body.item.uid, accepted.body.item.uid, 'a new decision updates the one row');
  read = (await call(f, 'GET', `/${uid}/findings`)).body;
  // Mutation checked: write the edit over proposed_text → the generated words are lost here.
  assert.deepEqual(read.items.map((i: any) => [i.kind, i.state, i.text, i.proposed_text]), [['interpretation', 'edited', 'Acme raised prices.', proposed]]);
  await call(f, 'POST', path(1), { decision: 'discard' });
  read = (await call(f, 'GET', `/${uid}/findings`)).body;
  assert.deepEqual([read.items[0].state, read.counts.interpretation, read.counts.discarded], ['discarded', 0, 1]);
  // A decision stays on record, as for an Ask interpretation.
  assert.equal((await call(f, 'DELETE', `/${uid}/findings/${accepted.body.item.uid}`)).status, 409);
  assert.equal(count(f, 'research_project_findings'), 1);
  assert.deepEqual(receipts(f).filter((r) => r.action.includes('interpretation')).length, 3);
  assert.doesNotMatch(JSON.stringify(receipts(f)), /Acme raised/);
});

test('after a detach the finding and its citation remain, read as attachment removed, and updated_at is unchanged', async () => {
  const f = fixture();
  const uid = await newProject(f);
  const att = (await attach(f, uid)).body.item.uid;
  await call(f, 'POST', `/${uid}/findings`, { kind: 'conclusion', text: 'Acme is pricing up.', citations: [{ attachment_uid: att, source_key: 's-ok' }] });
  await call(f, 'POST', `/${uid}/interpretations/attachments/${att}/3`, { decision: 'accept' });
  f.db.exec("UPDATE research_project_findings SET updated_at = '2026-11-01 00:00:00'");
  // The detach clears its links itself and does not lean on the foreign keys' SET NULL.
  f.db.exec('PRAGMA foreign_keys=OFF');
  const removed = await call(f, 'DELETE', `/${uid}/attachments/${att}`);
  assert.equal(removed.status, 200);
  assert.equal(count(f, 'research_project_attachments'), 0);
  assert.equal((await call(f, 'GET', `/${uid}/attachments/${att}`)).status, 404);
  // Mutation checked: touch updated_at in the detach → these read the detach time.
  assert.deepEqual(f.db.prepare('SELECT updated_at FROM research_project_findings ORDER BY id').all().map((r: any) => r.updated_at), ['2026-11-01 00:00:00', '2026-11-01 00:00:00']);
  const read = (await call(f, 'GET', `/${uid}/findings`)).body;
  assert.deepEqual(read.items.map((i: any) => [i.kind, i.state, i.attachment_uid, i.citations.map((c: any) => [c.state, c.availability, c.title, c.url, c.retrieved_at, c.attachment_uid])]), [
    ['interpretation', 'accepted', null, [['attachment_removed', 'attachment_removed', 'Acme pricing', 'https://acme.example/pricing', '2026-11-10T10:00:00Z', null]]],
    ['conclusion', null, null, [['attachment_removed', 'attachment_removed', 'Acme pricing', 'https://acme.example/pricing', '2026-11-10T10:00:00Z', null]]],
  ]);
  assert.deepEqual(receipts(f).map((r) => r.action).filter((a) => a.includes('attachment')), ['research_project_attachment_added', 'research_project_attachment_removed']);
  // Mutation checked: drop the citation UPDATE → a citation still names the gone attachment's id.
  assert.equal(count(f, 'research_project_finding_citations WHERE attachment_id IS NOT NULL'), 0);
  // Mutation checked: drop the finding UPDATE → the interpretation still names it.
  assert.equal(count(f, 'research_project_findings WHERE attachment_id IS NOT NULL'), 0);
});

test('an archived project refuses writes; a support session cannot write but reads', async () => {
  const f = fixture();
  const uid = await newProject(f);
  const att = (await attach(f, uid)).body.item.uid;
  for (const [method, path, body] of [
    ['POST', `/${uid}/attachments`, { kind: 'competitor_analysis', object_id: 'an-1', version: 1 }],
    ['DELETE', `/${uid}/attachments/${att}`, undefined],
  ] as const) {
    const r = await call(f, method, path, body, OWNER, true);
    // Mutation checked: drop the support_session check → each write lands.
    assert.deepEqual([r.status, r.body.error], [403, 'support_read_only'], `${method} ${path}`);
  }
  const support = await call(f, 'POST', `/${uid}/interpretations/attachments/${att}/1`, { decision: 'accept' }, OWNER, true);
  assert.deepEqual([support.status, support.body.detail], [403, 'support_read_only']);
  assert.equal((await call(f, 'GET', `/${uid}/attachments`, undefined, OWNER, true)).status, 200, 'a support session still reads');

  await call(f, 'POST', `/${uid}/archive`);
  const archived = [
    await attach(f, uid, 1),
    await call(f, 'DELETE', `/${uid}/attachments/${att}`),
    await call(f, 'POST', `/${uid}/interpretations/attachments/${att}/1`, { decision: 'accept' }),
  ];
  assert.deepEqual(archived.map((r) => r.status), [409, 409, 409]);
  assert.equal(count(f, 'research_project_attachments'), 1);
  assert.equal(count(f, 'research_project_findings'), 0);
  assert.equal((await call(f, 'GET', `/${uid}/attachments/${att}`)).status, 200);
});

test('a stated cap on attachments per project and on the size of a copy', async () => {
  const f = fixture();
  const uid = await newProject(f);
  const pid = one(f, 'SELECT id FROM research_projects WHERE uid = ?', uid).id;
  const fill = f.db.prepare(`INSERT INTO research_project_attachments (uid, project_id, owner_user_id, kind, object_id, object_version, title, copy_format, copy_json, attached_by)
    VALUES (?, ?, 701, 'competitor_analysis', 'an-x', ?, 'Filler', 1, '{}', 701)`);
  for (let i = 1; i <= ATTACHMENTS_PER_PROJECT; i++) fill.run(`fill-${i}`, pid, i);
  const full = await attach(f, uid);
  // Mutation checked: drop the count clause from the insert → this is 201.
  assert.deepEqual([full.status, full.body.error], [409, 'attachment_limit']);
  f.db.exec("DELETE FROM research_project_attachments WHERE uid = 'fill-1'");
  f.db.prepare("UPDATE competitor_analysis_outputs SET output_json = ? WHERE analysis_id = 'an-1'")
    .run(JSON.stringify({ market_summary: 'x'.repeat(COPY_BYTES_LIMIT) }));
  const big = await attach(f, uid);
  assert.deepEqual([big.status, big.body.error], [413, 'copy_too_large']);
});

test('buildCopy and citableSource: the copy records each source, and only a fetched one is citable', () => {
  const copy = buildCopy({
    analysis_id: 'a', version: 1, title: '', saved_at: null, subject: null,
    output: '{"gaps":["g"],"findings":[{"text":"T","kind":"fact","source_ids":["s1"]}],"secret_field":"no"}',
    candidates: [{ id: 'c', name: 'C' }],
    sources: [{ id: 's1', url: 'https://a.example', status: 302 }, { id: 's2', url: 'https://b.example', status: null }, { id: 's3', url: '' }],
  });
  assert.deepEqual([copy.title, Object.keys(copy.sections), copy.findings, copy.sources.map((s) => [s.key, s.fetched])], [
    'Untitled analysis', ['gaps'], [{ n: 1, text: 'T', kind: 'fact', source_keys: ['s1'] }], [['s1', true], ['s2', false]],
  ]);
  assert.equal(citableSource(copy, 's1')?.url, 'https://a.example');
  assert.equal(citableSource(copy, 's2'), null);
  assert.equal(citableSource(null, 's1'), null);
});

test('the copy names its subject company only through the reviewed read: a withdrawn company is not named (D7819)', async () => {
  const f = fixture();
  f.db.exec(`INSERT INTO research_company_directory (uid, name, website, source_url, as_of) VALUES
      ('co-ok', 'Acme Scheduling', 'https://acme.example', 'https://acme.example', '2026-11-01'),
      ('co-gone', 'Withdrawn Co', 'https://gone.example', 'https://gone.example', '2026-11-01');
    INSERT INTO research_company_reviews (uid, status, reason_code, reviewer, reviewed_on) VALUES
      ('co-gone', 'withdrawn', 'source_withdrawn', 'reviewer', '2026-11-02');`);
  const uid = await newProject(f);
  const subjectOf = async (company: string) => {
    f.db.prepare("UPDATE competitor_analyses SET subject_uid = ? WHERE id = 'an-1'").run(company);
    f.db.exec("DELETE FROM research_project_attachments");
    const made = await attach(f, uid);
    assert.equal(made.status, 201);
    return (await call(f, 'GET', `/${uid}/attachments/${made.body.item.uid}`)).body.item.copy.subject;
  };
  // Mutation checked: read research_company_directory directly again → the withdrawn company is named.
  assert.deepEqual(await subjectOf('co-ok'), { uid: 'co-ok', name: 'Acme Scheduling', read: 'ok' });
  assert.deepEqual(await subjectOf('co-gone'), { uid: 'co-gone', name: null, read: 'not_found' });
  assert.deepEqual(await subjectOf('co-missing'), { uid: 'co-missing', name: null, read: 'not_found' });
});
