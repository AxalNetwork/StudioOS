/**
 * D1087 (#2952, #2405 part 3) — Validate from a founder's Notion: interview
 * pages as proposals that need the interviewee's consent, and research pages
 * as market sources. On the actual migrated schema, synthetic rows only.
 * Notion is a stub of `NotionReads` (`notionDeps.reads`): no test reaches a
 * provider host.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/notion_nt3.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import notionRoutes, { notionCycleRoutes, notionDeps } from '../src/routes/notion.ts';
import { NOTION_VIA, notionPageUrl } from '../src/services/notion/validate.ts';
import { acceptorFor, factWriterFor } from '../src/services/notion/sync.ts';

const SECRET = 'synthetic-notion-validate-secret-'.repeat(3);
test.after(() => removeMigratedDatabases());

const TREE = '66666666777748889999000000000000';
const RESEARCH = '12121212343456567878909090909090';
const page = (n: number) => `${String(n).padStart(8, '0')}eeee4fff8aaabbbbbbbbbbbb`;
const NOTES = 'Q: How do you plan routes today?\nA: A spreadsheet, rebuilt every Monday.';

function stubNotion() {
  const s: any = {
    children: new Map<string, Array<{ id: string; title: string }>>(),
    pages: new Map<string, string>(),
    calls: [] as string[],
  };
  s.reads = {
    offered: ['notion-search', 'notion-fetch', 'notion-query-data-sources'],
    async searchSources() { return []; },
    async dataSourceSchema(id: string) { return { id, title: 'DB', properties: [] }; },
    async queryRows() { return { rows: [], next_cursor: null }; },
    async listChildren(id: string) { s.calls.push(`children:${id}`); return (s.children.get(id) || []).map((c: any) => ({ id: c.id, kind: 'page', title: c.title })); },
    async fetchPage(id: string) {
      s.calls.push(`page:${id}`);
      const md = s.pages.get(id) ?? '';
      const title = [...s.children.values()].flat().find((c: any) => c.id === id)?.title ?? (id === TREE ? 'Interviews' : 'Research');
      return { id, title, url: `https://www.notion.so/${id}`, last_edited: '2026-10-21T09:00:00.000Z', markdown: md, fingerprint: createHash('sha256').update(md).digest('hex') };
    },
  };
  return s;
}

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES (11,'Owner','owner@example.test','founder',101,1),(22,'Other','other@example.test','founder',NULL,1);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (1,'co-acme','Acme Robotics');
    INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin) VALUES ('l1',1,11,1);
    INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES (701,'v-acme','Acme Field',101,1);
    INSERT INTO integrations(id,uid,user_id,provider_key,status,auth_type) VALUES (5,'i-notion',11,'notion','active','oauth_mcp');
    INSERT INTO integration_companies(integration_id,company_id,enabled) VALUES (5,1,1);
  `);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db), RATE_LIMITS: memKV() };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e?.message] || 500));
  app.route('/api/connectors/notion', notionRoutes);
  app.route('/api/cycles', notionCycleRoutes);
  const notion = stubNotion();
  notionDeps.reads = async () => notion.reads;
  const call = async (who: number, method: string, path: string, b?: unknown) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n);
  return { db, env, notion, call, count };
}

const CONSENT = { status: 'given', method: 'verbal', recorded_at: '2026-10-20T10:00:00.000Z' };

async function interviews(t: ReturnType<typeof fixture>) {
  t.notion.children.set(TREE, [{ id: page(1), title: 'Interview notes — Customer 4' }]);
  t.notion.pages.set(page(1), NOTES);
  const r = await t.call(11, 'POST', '/api/connectors/notion/sources', { project: 701, module: 'customer_research', kind: 'page_tree', notion_id: TREE });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const s = await t.call(11, 'POST', '/api/cycles/validate/notion/sync', { project: 701 });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const id = Number((t.db.prepare("SELECT id FROM notion_proposals WHERE kind = 'interview'").get() as any).id);
  return id;
}

const accept = (t: ReturnType<typeof fixture>, id: number, b: Record<string, unknown>) =>
  t.call(11, 'POST', `/api/cycles/validate/notion/proposals/${id}/accept`, { project: 701, ...b });

const nothingStored = (t: ReturnType<typeof fixture>, id: number) => {
  assert.equal(t.count('discovery_interviews'), 0, 'no interview');
  assert.equal(t.count('interview_sessions'), 0, 'no session');
  assert.equal(t.count('interview_transcript_segments'), 0, 'no transcript');
  assert.equal((t.db.prepare('SELECT status FROM notion_proposals WHERE id = ?').get(id) as any).status, 'pending', 'the proposal still waits');
};

test('the Validate writers are registered on the routes\' import', () => {
  assert.ok(acceptorFor('interview'));
  assert.equal(factWriterFor('market_intelligence')?.localTable, 'market_sources');
});

test('an interview page waits as a proposal; without consent given, Accept is 409 and nothing is read or stored', async () => {
  const t = fixture();
  const id = await interviews(t);
  assert.equal(t.count('discovery_interviews'), 0, 'a sync stores no interview');
  const before = t.notion.calls.length;
  for (const consent of [undefined, { status: 'refused', method: 'verbal', recorded_at: CONSENT.recorded_at }, { status: 'given', method: 'telepathy', recorded_at: CONSENT.recorded_at }, { status: 'given', method: 'verbal' }]) {
    const r = await accept(t, id, { consent, occurred_at: '2026-10-20', interviewee: { label: 'Ops lead, logistics firm' } });
    assert.equal(r.status, 409, JSON.stringify(consent)); assert.equal(r.body.error, 'consent_not_given');
    assert.doesNotMatch(JSON.stringify(r.body), /spreadsheet|Customer 4/, 'the refusal echoes no text');
  }
  assert.equal(t.notion.calls.length, before, 'Notion is not even read without consent');
  nothingStored(t, id);
});

test('an email or a phone in the interviewee is refused, and nothing is stored', async () => {
  const t = fixture();
  const id = await interviews(t);
  for (const interviewee of [{ label: 'ana@example.test' }, { label: 'Ops lead', role: 'call +44 20 7946 0958' }, { label: 'Ops lead', company: 'x@y.co' }, { label: 'Ops lead', email: 'a@b.co' }]) {
    const r = await accept(t, id, { consent: CONSENT, occurred_at: '2026-10-20', interviewee });
    assert.equal(r.status, 400, JSON.stringify(interviewee)); assert.equal(r.body.error, 'contact_not_accepted');
    assert.doesNotMatch(JSON.stringify(r.body), /example\.test|7946/);
  }
  const noDate = await accept(t, id, { consent: CONSENT, interviewee: { label: 'Ops lead' } });
  assert.deepEqual([noDate.status, noDate.body.error], [400, 'invalid_occurred_at'], 'a date is given, never guessed');
  const badChannel = await accept(t, id, { consent: CONSENT, occurred_at: '2026-10-20', interviewee: { label: 'Ops lead' }, channel: 'carrier_pigeon' });
  assert.deepEqual([badChannel.status, badChannel.body.error], [400, 'invalid_channel']);
  nothingStored(t, id);
});

test('with consent, the page lands through D667\'s storage step: the interview, its session with consent, the notes; nothing reaches another module', async () => {
  const t = fixture();
  const id = await interviews(t);
  const r = await accept(t, id, { consent: CONSENT, occurred_at: '2026-10-20', interviewee: { label: 'Ops lead, logistics firm', role: 'Operations' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.local_table, 'interview_sessions');
  const iv = t.db.prepare('SELECT interviewee_name, interviewee_role, interview_date, stage, channel FROM discovery_interviews').get() as any;
  assert.deepEqual({ ...iv }, { interviewee_name: 'Ops lead, logistics firm', interviewee_role: 'Operations', interview_date: '2026-10-20', stage: 'done', channel: 'manual' }, 'manual by default');
  const s = t.db.prepare('SELECT id, consent_status, consent_method, consent_at, submitted_via, submitted_via_name FROM interview_sessions').get() as any;
  assert.deepEqual([s.consent_status, s.consent_method, s.consent_at, s.submitted_via, s.submitted_via_name], ['given', 'verbal', CONSENT.recorded_at, NOTION_VIA, 'Notion']);
  assert.equal(Number(s.id), r.body.local_id);
  const segs = t.db.prepare("SELECT speaker_label, text FROM interview_transcript_segments WHERE session_id = ? AND source = 'final'").all(s.id) as any[];
  assert.deepEqual(segs.map((x) => ({ ...x })), [{ speaker_label: 'Notes', text: NOTES }], 'the page\'s notes, whole');
  assert.equal(t.count('interview_findings'), 0, 'no placement before the founder structures and accepts one');
  assert.equal((t.db.prepare('SELECT status FROM notion_proposals WHERE id = ?').get(id) as any).status, 'accepted');
  const log = t.db.prepare("SELECT details FROM activity_logs WHERE action = 'interview_session_submitted'").get() as any;
  assert.doesNotMatch(log.details, /spreadsheet|Ops lead|Customer 4/, 'the audit row holds ids and counts only');
  const chosen = fixture();
  const id2 = await interviews(chosen);
  assert.equal((await accept(chosen, id2, { consent: CONSENT, occurred_at: '2026-10-20', interviewee: { label: 'Ops lead' }, channel: 'video' })).status, 200);
  assert.equal((chosen.db.prepare('SELECT channel FROM discovery_interviews').get() as any).channel, 'video', 'the channel the founder picks');
});

test('a page that changed in Notion since it was proposed is refused until it is synced again', async () => {
  const t = fixture();
  const id = await interviews(t);
  t.notion.pages.set(page(1), `${NOTES}\nQ: And pricing?`);
  const r = await accept(t, id, { consent: CONSENT, occurred_at: '2026-10-20', interviewee: { label: 'Ops lead' } });
  assert.deepEqual([r.status, r.body.error], [409, 'changed_in_notion']);
  nothingStored(t, id);
  await t.call(11, 'POST', '/api/cycles/validate/notion/sync', { project: 701 });
  assert.equal((await accept(t, id, { consent: CONSENT, occurred_at: '2026-10-20', interviewee: { label: 'Ops lead' } })).status, 200, 'after a sync, what is stored is what was proposed');
  assert.match((t.db.prepare("SELECT text FROM interview_transcript_segments WHERE source = 'final'").get() as any).text, /And pricing\?/);
});

test('an empty page is refused, and nothing is stored', async () => {
  const t = fixture();
  t.notion.children.set(TREE, [{ id: page(2), title: 'Empty' }]);
  t.notion.pages.set(page(2), '   ');
  await t.call(11, 'POST', '/api/connectors/notion/sources', { project: 701, module: 'customer_research', kind: 'page_tree', notion_id: TREE });
  await t.call(11, 'POST', '/api/cycles/validate/notion/sync', { project: 701 });
  const id = Number((t.db.prepare("SELECT id FROM notion_proposals WHERE kind = 'interview'").get() as any).id);
  const r = await accept(t, id, { consent: CONSENT, occurred_at: '2026-10-20', interviewee: { label: 'Ops lead' } });
  assert.deepEqual([r.status, r.body.error], [400, 'notes_empty']);
  nothingStored(t, id);
});

test('Market intelligence: each research page lands as a source, kind notion, with its Notion link; a re-sync does not duplicate; a deleted one stays deleted', async () => {
  const t = fixture();
  t.notion.children.set(RESEARCH, [{ id: page(7), title: 'Sector map 2026' }, { id: page(8), title: 'Competitor teardown' }]);
  const r = await t.call(11, 'POST', '/api/connectors/notion/sources', { project: 701, module: 'market_intelligence', kind: 'page_tree', notion_id: RESEARCH });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await t.call(11, 'POST', '/api/cycles/validate/notion/sync', { project: 701 });
  const rows = () => (t.db.prepare('SELECT id, title, url, kind, added_by FROM market_sources ORDER BY id').all() as any[]).map((x) => ({ ...x }));
  assert.deepEqual(rows().map((x) => [x.title, x.url, x.kind, x.added_by]), [
    ['Sector map 2026', `https://www.notion.so/${page(7)}`, 'notion', 11],
    ['Competitor teardown', `https://www.notion.so/${page(8)}`, 'notion', 11],
  ]);
  assert.ok(!t.notion.calls.some((c: string) => c === `page:${page(7)}`), 'the text stays in Notion: no page is fetched');
  t.notion.children.set(RESEARCH, [{ id: page(7), title: 'Sector map 2027' }, { id: page(8), title: 'Competitor teardown' }]);
  await t.call(11, 'POST', '/api/cycles/validate/notion/sync', { project: 701 });
  assert.deepEqual(rows().map((x) => x.title), ['Sector map 2027', 'Competitor teardown'], 'a re-sync updates the one row, never a second');
  const view = await t.call(11, 'GET', '/api/cycles/validate/notion?project=701&module=market_intelligence');
  assert.equal(view.body.writer_ready, true);
  assert.deepEqual(view.body.fields.map((f: any) => f.key), ['title', 'url']);
  assert.deepEqual(view.body.facts.map((f: any) => f.values.title).sort(), ['Competitor teardown', 'Sector map 2027']);
  const ledger = Number((t.db.prepare("SELECT id FROM connector_fed_items WHERE module = 'market_intelligence' ORDER BY id").get() as any).id);
  assert.equal((await t.call(11, 'DELETE', `/api/cycles/validate/notion/facts/${ledger}?project=701`)).status, 200);
  await t.call(11, 'POST', '/api/cycles/validate/notion/sync', { project: 701 });
  assert.deepEqual(rows().map((x) => x.title), ['Competitor teardown'], 'deleted stays deleted');
  t.db.exec("INSERT INTO market_sources (project_id, title, url, kind, added_by) VALUES (701, 'Typed by hand', NULL, 'manual', 11)");
  await t.call(11, 'POST', '/api/cycles/validate/notion/sync', { project: 701 });
  assert.ok(rows().some((x) => x.title === 'Typed by hand' && x.kind === 'manual'), 'a source typed by hand is never touched');
});

test('a Notion link is built only from a Notion id', () => {
  assert.equal(notionPageUrl(`notion:701:market_intelligence:${page(7)}`), `https://www.notion.so/${page(7)}`);
  assert.equal(notionPageUrl('notion:701:market_intelligence:12345678-1234-1234-1234-123456789abc'), 'https://www.notion.so/12345678123412341234123456789abc');
  assert.equal(notionPageUrl('notion:701:market_intelligence:https://evil.example/x'), null);
});
