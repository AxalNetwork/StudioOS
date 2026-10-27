/**
 * D1094 (#2959, Google Workspace part 5) — Raise: a Slides deck as a deck
 * version proposal, chosen Drive files copied into the data room, and
 * Calendar "last met" proposals on Capital relationships. Google is stubbed
 * throughout: no test reaches a provider host. All data is synthetic.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/google_workspace_gw5.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  CALENDAR_DAYS, COPY_ACCESS, GOOGLE_CALENDAR_READS, acceptRaiseGoogleProposal, calendarEventDays, deleteRaiseGoogleCopy, dismissRaiseGoogleProposal,
  domainOf, raiseGooglePart, slidesFromPresentation, syncRaiseGoogle,
} from '../src/services/google/raise.ts';
import { MAX_COPY_BYTES, WorkspaceError, ensureWorkspaceIntegration } from '../src/services/google/workspace.ts';
import { GOOGLE_WORKSPACE_FEEDS } from '../src/integrations/googleWorkspaceFeeds.ts';
import { CONNECTOR_METADATA } from '../src/integrations/registry.ts';
import { ensureIntegrationsSchema } from '../src/integrations/registry.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const baseline = read('../sql/schema_baseline.sql');
/** A migration's `ALTER TABLE <table> ADD COLUMN` statements, found by plain string search. */
function alters(file: string, table: string): string[] {
  // Comments go first: a semicolon inside one would cut a statement short.
  return read(file).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim())
    .filter((s) => s.startsWith(`ALTER TABLE ${table} ADD COLUMN`));
}
function created(file: string, table: string): string {
  const sql = read(file); const at = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  return sql.slice(at, sql.indexOf(');', at) + 2);
}

const PRESENTATION = {
  title: 'Seed deck v7',
  slides: [
    { pageElements: [
      { shape: { placeholder: { type: 'CENTERED_TITLE' }, text: { textElements: [{ textRun: { content: 'Northwind Labs\n' } }] } } },
      { shape: { placeholder: { type: 'SUBTITLE' }, text: { textElements: [{ textRun: { content: 'Seed, 2026' } }] } } },
    ], slideProperties: { notesPage: { notesProperties: { speakerNotesObjectId: 'n1' }, pageElements: [{ objectId: 'n1', shape: { text: { textElements: [{ textRun: { content: 'Open with the pilot.' } }] } } }] } } },
    { pageElements: [
      { shape: { placeholder: { type: 'BODY' }, text: { textElements: [{ textRun: { content: 'Line one\n' } }, { textRun: { content: 'Line two' } }] } } },
      { shape: { placeholder: { type: 'TITLE' }, text: { textElements: [{ textRun: { content: 'Problem' } }] } } },
      { image: { contentUrl: 'https://example.test/x.png' } },
    ] },
    { pageElements: [] },
  ],
};

async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'founders', 'projects', 'user_company_links', 'pitch_decks', 'data_room_files', 'raise_prospects', 'contacts', 'activity_logs']) db.exec(tableFromBaseline(baseline, t));
  for (const [f, t] of [['442_raise_cycle_stores', 'data_room_files'], ['463_raise_record_stores', 'data_room_files'], ['596_data_room_file_source', 'data_room_files'],
    ['539_pitch_deck_editor', 'pitch_decks'], ['442_raise_cycle_stores', 'raise_prospects'], ['463_raise_record_stores', 'raise_prospects'], ['607_raise_money_cents', 'raise_prospect_events']] as const) {
    if (t === 'raise_prospect_events' && !db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'raise_prospect_events'").get()) db.exec(created('../sql/migrations/463_raise_record_stores.sql', 'raise_prospect_events'));
    for (const s of alters(`../sql/migrations/${f}.sql`, t)) { try { db.exec(s); } catch (e) { if (!/duplicate column/.test(String(e))) throw e; } }
  }
  db.exec(read('../sql/migrations/445_connector_fed_items.sql')); db.exec(read('../sql/migrations/588_google_workspace_files.sql'));
  db.exec('CREATE TABLE google_oauth_tokens(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER UNIQUE,refresh_token TEXT,scope TEXT,google_sub TEXT,google_email TEXT,updated_at TEXT)');
  db.exec("INSERT INTO users(id,email,name,role,is_active,founder_id) VALUES (1,'founder@northwind.test','Synthetic founder','founder',1,1)");
  db.exec("INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES (1,'proj-one','Synthetic project',1,1),(2,'proj-two','Other project',2,2)");
  db.exec("INSERT INTO pitch_decks(project_id,version,slides,title,is_current) VALUES (1,1,'[]','v1',1)");
  db.exec(`INSERT INTO contacts(id,uid,project_id,audience,email) VALUES (5,'c5',1,'investor','partner@harbourvc.test')`);
  db.exec(`INSERT INTO raise_prospects(id,uid,project_id,contact_id,name,email,firm,stage) VALUES
    (10,'p10',1,5,'Synthetic partner',NULL,'Harbour VC','meeting'),
    (11,'p11',1,NULL,'Another partner','someone@gmail.com','Webmail Capital','to_contact'),
    (12,'p12',1,NULL,'Logged partner','gp@quayfund.test','Quay Fund','meeting'),
    (13,'p13',1,NULL,'Passed partner','gp@passedfund.test','Passed Fund','passed'),
    (14,'p14',2,NULL,'Other venture partner','gp@harbourvc.test','Harbour VC','meeting')`);
  db.exec(`INSERT INTO raise_prospect_events(uid,prospect_id,kind,done_at) VALUES ('e1',12,'meeting','2026-10-20')`);
  const env: any = { DB: d1Over(db), JWT_SECRET: 'gw5-'.repeat(10) /* synthetic, low entropy: no literal key */, ENVIRONMENT: 'development', GOOGLE_CAL_CLIENT_ID: 'public-client', GOOGLE_CAL_CLIENT_SECRET: 'synthetic-secret', PUBLIC_BASE_URL: 'https://axal.vc' };
  await ensureIntegrationsSchema(env);
  const integration = await ensureWorkspaceIntegration(env, 1);
  const r2 = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  env.FILES = { put: async (k: string, v: Uint8Array) => { r2.set(k, v); }, get: async (k: string) => r2.get(k) ?? null, delete: async (k: string) => { deleted.push(k); r2.delete(k); } };
  const pick = (module: string, id: string, kind: string, name: string, mime: string) => db.prepare(
    'INSERT INTO google_workspace_files(uid,integration_id,user_id,project_id,module,drive_file_id,mime_type,kind,name,modified_time) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(`u-${id}`, integration.id, 1, 1, module, id, mime, kind, name, '2026-10-01T00:00:00Z');
  return { db, env, integration, r2, deleted, pick };
}

/** A stubbed reader with Google's answers per file, counting each call. */
function reader(meta: Record<string, any>) {
  const calls: { call: string; id: string; options?: any }[] = [];
  const fn = async (call: string, id: string, options?: any) => {
    calls.push({ call, id, options });
    if (meta[id]?.refuse) throw new WorkspaceError(meta[id].refuse, 403);
    if (call === 'files.get') return { id, ...meta[id] };
    if (call === 'presentations.get') return PRESENTATION;
    if (call === 'files.export') { assert.equal(options?.mimeType, 'application/pdf'); return new TextEncoder().encode(`%PDF ${meta[id].modifiedTime}`); }
    if (call === 'alt=media') return new TextEncoder().encode(`bytes ${meta[id].modifiedTime}`);
    throw new Error('unexpected read');
  };
  return { fn, calls };
}
const user: any = { id: 1, role: 'founder', founder_id: 1 };

test('Slides become the deck editor’s slides: titles, body text and speaker notes; images left for the editor', () => {
  const d = slidesFromPresentation(PRESENTATION);
  assert.equal(d.title, 'Seed deck v7');
  assert.deepEqual(d.slides, [
    { title: 'Northwind Labs', body: 'Seed, 2026', notes: 'Open with the pilot.' },
    { title: 'Problem', body: 'Line one\nLine two' },
    { title: 'Slide 3', body: '' },
  ]);
  assert.equal(slidesFromPresentation({ slides: Array.from({ length: 70 }, () => ({})) }).slides.length, 60);
  assert.deepEqual(slidesFromPresentation(null).slides, []);
});

test('a Slides deck is proposed as the next version, once per Google version; Accept writes it and the current version stays', async () => {
  const { db, env, integration, pick } = await fixture();
  pick('pitch_deck', 'deck1', 'slides', 'Seed deck v7', 'application/vnd.google-apps.presentation');
  const meta: any = { deck1: { name: 'Seed deck v7', mimeType: 'application/vnd.google-apps.presentation', modifiedTime: '2026-10-20T10:00:00Z' } };
  const r = reader(meta);
  const a = { integrationId: integration.id, projectId: 1, user, read: r.fn as any, eventDays: null };
  assert.equal((await syncRaiseGoogle(env, a)).decks_proposed, 1);
  assert.equal((await syncRaiseGoogle(env, a)).decks_proposed, 1);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM google_workspace_proposals WHERE status = 'pending'").get() as any).n, 1, 'a re-sync refreshes, never duplicates');
  // A newer Google version withdraws the pending one it replaces.
  meta.deck1.modifiedTime = '2026-10-21T10:00:00Z';
  await syncRaiseGoogle(env, a);
  const pending = db.prepare("SELECT id, source_key FROM google_workspace_proposals WHERE status = 'pending'").all() as any[];
  assert.deepEqual(pending.map((p) => p.source_key), ['slides:deck1:2026-10-21T10:00:00Z']);
  const part: any = await raiseGooglePart(env, { integrationId: integration.id, userId: 1, projectId: 1, slug: 'pitch-deck' });
  assert.equal(part.proposals[0].title, 'Import “Seed deck v7” as version 2?');
  assert.equal(part.proposals[0].keeps, 'Version 1 stays as it is. You can switch back to it at any time.');
  assert.deepEqual(part.proposals[0].slide_titles, ['Northwind Labs', 'Problem', 'Slide 3']);
  assert.equal(part.proposals[0].as_of, '2026-10-21T10:00:00Z');
  assert.equal(part.files[0].name, 'Seed deck v7');
  // Nothing is written to the deck before Accept.
  assert.equal((db.prepare('SELECT COUNT(*) n FROM pitch_decks').get() as any).n, 1);
  const out: any = await acceptRaiseGoogleProposal(env, { integrationId: integration.id, projectId: 1, id: pending[0].id, user });
  assert.equal(out.ok, true);
  const versions = db.prepare('SELECT version, is_current, title, slides FROM pitch_decks ORDER BY version').all() as any[];
  assert.deepEqual(versions.map((v) => [v.version, v.is_current]), [[1, 0], [2, 1]], 'version 1 is kept');
  assert.equal(versions[1].title, 'From Google Slides: Seed deck v7');
  assert.equal(JSON.parse(versions[1].slides)[0].notes, 'Open with the pilot.');
  assert.equal((db.prepare("SELECT local_table FROM connector_fed_items WHERE external_id = 'deck1:deck:1:2026-10-21T10:00:00Z'").get() as any).local_table, 'pitch_decks');
  assert.equal((await acceptRaiseGoogleProposal(env, { integrationId: integration.id, projectId: 1, id: pending[0].id, user }) as any).code, 'proposal_decided');
  // Accepted once: the same Google version is never proposed again.
  await syncRaiseGoogle(env, a);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM google_workspace_proposals WHERE status = 'pending'").get() as any).n, 0);
  // Another venture's proposal is not this one's to decide.
  assert.equal((await acceptRaiseGoogleProposal(env, { integrationId: integration.id, projectId: 2, id: pending[0].id, user }) as any).code, 'proposal_not_found');
});

test('a dismissed deck stays dismissed; an empty deck proposes nothing', async () => {
  const { db, env, integration, pick } = await fixture();
  pick('pitch_deck', 'deck1', 'slides', 'Seed deck v7', 'application/vnd.google-apps.presentation');
  const r = reader({ deck1: { name: 'Seed deck v7', modifiedTime: '2026-10-20T10:00:00Z' } });
  const a = { integrationId: integration.id, projectId: 1, user, read: r.fn as any, eventDays: null };
  await syncRaiseGoogle(env, a);
  const id = (db.prepare('SELECT id FROM google_workspace_proposals').get() as any).id;
  assert.equal((await dismissRaiseGoogleProposal(env, { integrationId: integration.id, projectId: 1, id, user }) as any).ok, true);
  const before = (db.prepare('SELECT fingerprint, payload_json FROM google_workspace_proposals').get() as any);
  const changed = { ...a, read: (async (call: string, id: string) => (call === 'files.get' ? { id, name: 'Seed deck v7', modifiedTime: '2026-10-20T10:00:00Z' } : { slides: [{ pageElements: [] }] })) as any };
  await syncRaiseGoogle(env, changed);
  const after = db.prepare("SELECT status, fingerprint, payload_json FROM google_workspace_proposals").get() as any;
  assert.equal(after.status, 'dismissed');
  assert.deepEqual([after.fingerprint, after.payload_json], [before.fingerprint, before.payload_json], 'a decided proposal is never refreshed');
  assert.equal((await dismissRaiseGoogleProposal(env, { integrationId: integration.id, projectId: 1, id, user }) as any).code, 'proposal_decided');
  const empty = { ...a, read: (async (call: string, id: string) => (call === 'files.get' ? { id, name: 'Blank', modifiedTime: '2026-10-22T00:00:00Z' } : { slides: [] })) as any };
  db.exec('DELETE FROM google_workspace_proposals');
  assert.equal((await syncRaiseGoogle(env, empty)).decks_proposed, 0);
});

test('Drive files are copied into the data room under the venture’s key, replaced only on a new modifiedTime, and a deleted copy stays deleted', async () => {
  const { db, env, integration, r2, deleted, pick } = await fixture();
  pick('data_room', 'doc1', 'doc', 'Board memo', 'application/vnd.google-apps.document');
  pick('data_room', 'pdf1', 'file', 'Financials.pdf', 'application/pdf');
  const meta: any = { doc1: { name: 'Board memo', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-10-01T00:00:00Z' }, pdf1: { name: 'Financials.pdf', mimeType: 'application/pdf', modifiedTime: '2026-10-02T00:00:00Z' } };
  const r = reader(meta);
  const a = { integrationId: integration.id, projectId: 1, user, read: r.fn as any, eventDays: null };
  const first = await syncRaiseGoogle(env, a);
  assert.equal(first.copies_added, 2);
  const rows = db.prepare('SELECT * FROM data_room_files ORDER BY id').all() as any[];
  assert.deepEqual(rows.map((f) => [f.name, f.content_type, f.visibility, f.access_tier, f.source_kind, f.source_ref]), [
    ['Board memo.pdf', 'application/pdf', COPY_ACCESS.visibility, COPY_ACCESS.access_tier, 'connector', 'google_drive'],
    ['Financials.pdf', 'application/pdf', 'nda', 'nobody', 'connector', 'google_drive'],
  ]);
  for (const f of rows) assert.ok(f.r2_key.startsWith('data-room/proj-one/'), 'the R2 key belongs to the venture');
  assert.equal(new TextDecoder().decode(r2.get(rows[0].r2_key)), '%PDF 2026-10-01T00:00:00Z', 'a Google file is exported to PDF');
  assert.deepEqual(r.calls.filter((c) => c.call === 'files.export').map((c) => c.options), [{ mimeType: 'application/pdf', maxBytes: MAX_COPY_BYTES }]);
  assert.equal(r.calls.filter((c) => c.call === 'alt=media').length, 1, 'a stored file is downloaded as it is');
  // The same modifiedTime: nothing is read again or replaced.
  const before = r.calls.length;
  const second = await syncRaiseGoogle(env, a);
  assert.equal(second.copies_unchanged, 2);
  assert.deepEqual(r.calls.slice(before).map((c) => c.call), ['files.get', 'files.get']);
  // A new modifiedTime replaces the copy in place: same row, new object, old object deleted.
  meta.doc1.modifiedTime = '2026-10-15T00:00:00Z';
  assert.equal((await syncRaiseGoogle(env, a)).copies_replaced, 1);
  const after = db.prepare('SELECT * FROM data_room_files WHERE id = ?').get(rows[0].id) as any;
  assert.notEqual(after.r2_key, rows[0].r2_key);
  assert.ok(deleted.includes(rows[0].r2_key));
  assert.equal(new TextDecoder().decode(r2.get(after.r2_key)), '%PDF 2026-10-15T00:00:00Z');
  const part: any = await raiseGooglePart(env, { integrationId: integration.id, userId: 1, projectId: 1, slug: 'data-room' });
  assert.deepEqual(part.copies.map((c: any) => [c.name, c.as_of]), [['Board memo.pdf', '2026-10-15T00:00:00Z'], ['Financials.pdf', '2026-10-02T00:00:00Z']]);
  // Delete: the file and its object go; a re-sync never copies it again, even after a change.
  assert.equal(await deleteRaiseGoogleCopy(env, { integrationId: integration.id, projectId: 2, id: after.id, user }), false, 'another venture cannot delete it');
  assert.equal(await deleteRaiseGoogleCopy(env, { integrationId: integration.id, projectId: 1, id: after.id, user }), true);
  assert.ok(deleted.includes(after.r2_key));
  meta.doc1.modifiedTime = '2026-10-20T00:00:00Z';
  const exports = r.calls.filter((c) => c.call === 'files.export').length;
  assert.equal((await syncRaiseGoogle(env, a)).copies_kept_deleted, 1);
  assert.equal(r.calls.filter((c) => c.call === 'files.export').length, exports);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM data_room_files').get() as any).n, 1);
  assert.equal(((await raiseGooglePart(env, { integrationId: integration.id, userId: 1, projectId: 1, slug: 'data-room' })) as any).deleted_kept, 1);
  // A copy deleted in the data room itself (not through this route) also stays deleted.
  db.exec("DELETE FROM data_room_files WHERE name = 'Financials.pdf'");
  meta.pdf1.modifiedTime = '2026-10-21T00:00:00Z';
  assert.equal((await syncRaiseGoogle(env, a)).copies_kept_deleted, 2);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM data_room_files').get() as any).n, 0);
  // "Stop using" (part 2) keeps a copy and is not counted as a deletion.
  db.exec("UPDATE google_workspace_files SET status = 'stopped' WHERE drive_file_id = 'pdf1'");
  assert.equal(((await raiseGooglePart(env, { integrationId: integration.id, userId: 1, projectId: 1, slug: 'data-room' })) as any).deleted_kept, 1);
});

test('a file Google refuses is marked unreadable and the rest still sync; a rate limit stops the sync as partly synced', async () => {
  const { db, env, integration, pick } = await fixture();
  pick('data_room', 'gone', 'file', 'Gone.pdf', 'application/pdf');
  pick('data_room', 'pdf1', 'file', 'Financials.pdf', 'application/pdf');
  const r = reader({ gone: { refuse: 'file_not_shared' }, pdf1: { name: 'Financials.pdf', mimeType: 'application/pdf', modifiedTime: '2026-10-02T00:00:00Z' } });
  const out = await syncRaiseGoogle(env, { integrationId: integration.id, projectId: 1, user, read: r.fn as any, eventDays: null });
  assert.equal(out.files_unreadable, 1); assert.equal(out.copies_added, 1); assert.equal(out.partly_synced, false);
  assert.deepEqual({ ...db.prepare("SELECT drive_file_id, status, last_error FROM google_workspace_files WHERE drive_file_id = 'gone'").get() }, { drive_file_id: 'gone', status: 'unreadable', last_error: 'file_not_shared' });
  const limited = reader({ gone: { refuse: 'google_rate_limited' }, pdf1: { name: 'x', mimeType: 'application/pdf', modifiedTime: '2026-10-09T00:00:00Z' } });
  const out2 = await syncRaiseGoogle(env, { integrationId: integration.id, projectId: 1, user, read: limited.fn as any, eventDays: null });
  assert.equal(out2.partly_synced, true);
  assert.equal(limited.calls.filter((c) => c.id === 'pdf1').length, 0, 'nothing after the limit is read');
});

test('Calendar proposes "last met" from a prospect’s firm domain only; no address, title or event text is stored', async () => {
  const { db, env, integration } = await fixture();
  const asked: [string, string][] = [];
  const eventDays = async (from: string, to: string) => {
    asked.push([from, to]);
    return { capped: false, events: [
      { day: '2026-10-12', domains: ['harbourvc.test', 'unrelated.test'] },
      { day: '2026-10-05', domains: ['harbourvc.test'] },
      { day: '2026-10-11', domains: ['gmail.com'] },
      { day: '2026-10-15', domains: ['quayfund.test'] },
      { day: '2026-10-16', domains: ['passedfund.test'] },
    ] };
  };
  const a = { integrationId: integration.id, projectId: 1, user, read: reader({}).fn as any, eventDays, now: new Date('2026-10-27T12:00:00Z') };
  const out = await syncRaiseGoogle(env, a);
  assert.equal(out.last_met_proposed, 1, 'Harbour VC only: Quay Fund already has a later meeting, a webmail address names no firm, a passed prospect is left');
  assert.equal(new Date(asked[0][1]).getTime() - new Date(asked[0][0]).getTime(), CALENDAR_DAYS * 86400000);
  const p = db.prepare('SELECT * FROM google_workspace_proposals').get() as any;
  assert.deepEqual([p.module, p.kind, p.source_key, p.title, JSON.parse(p.payload_json)], ['capital_relationships', 'last_met', 'met:10:2026-10-12', 'Last met 2026-10-12', { prospect_id: 10, day: '2026-10-12' }]);
  // Only the prospect's id and the day are kept: nothing in any table names a domain or an address from the calendar.
  for (const t of ['google_workspace_proposals', 'connector_fed_items', 'google_workspace_files']) {
    assert.doesNotMatch(JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all()), /harbourvc|unrelated|@/, t);
  }
  const part: any = await raiseGooglePart(env, { integrationId: integration.id, userId: 1, projectId: 1, slug: 'capital-relationships' });
  assert.deepEqual(part.proposals.map((x: any) => [x.title, x.prospect, x.day]), [['Last met 2026-10-12', 'Synthetic partner', '2026-10-12']]);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM raise_prospect_events WHERE prospect_id = 10').get() as any).n, 0, 'nothing is logged before Accept');
  // A prospect gone since: Accept is refused in words and the claim handed back, so nothing is half-written.
  db.exec("UPDATE raise_prospects SET project_id = 99 WHERE id = 10");
  const refused: any = await acceptRaiseGoogleProposal(env, { integrationId: integration.id, projectId: 1, id: p.id, user });
  assert.equal(refused.ok, false); assert.equal(refused.code, 'accept_refused');
  assert.equal((db.prepare('SELECT status FROM google_workspace_proposals WHERE id = ?').get(p.id) as any).status, 'pending');
  db.exec("UPDATE raise_prospects SET project_id = 1 WHERE id = 10");
  const ok: any = await acceptRaiseGoogleProposal(env, { integrationId: integration.id, projectId: 1, id: p.id, user });
  assert.equal(ok.ok, true);
  assert.deepEqual({ ...db.prepare('SELECT kind, done_at, note FROM raise_prospect_events WHERE prospect_id = 10').get() }, { kind: 'meeting', done_at: '2026-10-12', note: 'Met, from Google Calendar' });
  // Once accepted, the logged meeting is the latest: the same day is not proposed again.
  assert.equal((await syncRaiseGoogle(env, a)).last_met_proposed, 0);
  // A later meeting replaces a pending earlier proposal for the same prospect.
  db.exec("DELETE FROM raise_prospect_events WHERE prospect_id = 10");
  db.exec("UPDATE google_workspace_proposals SET status = 'pending' WHERE id = " + p.id);
  const later = { ...a, eventDays: async () => ({ capped: false, events: [{ day: '2026-10-20', domains: ['harbourvc.test'] }] }) };
  await syncRaiseGoogle(env, later);
  assert.deepEqual((db.prepare("SELECT source_key FROM google_workspace_proposals WHERE status = 'pending'").all() as any[]).map((x) => x.source_key), ['met:10:2026-10-20']);
});

test('with no prospect firm to match, the calendar is not read at all', async () => {
  const { db, env, integration } = await fixture();
  db.exec('DELETE FROM raise_prospects');
  let read = 0;
  await syncRaiseGoogle(env, { integrationId: integration.id, projectId: 1, user, read: reader({}).fn as any, eventDays: async () => { read += 1; return { events: [], capped: false }; } });
  assert.equal(read, 0);
});

test('the Calendar read is one GET with fields limited to the day and attendees, needs a Calendar grant, and returns domains, never addresses', async () => {
  const { db, env } = await fixture();
  db.prepare('INSERT INTO google_oauth_tokens(user_id,refresh_token,scope) VALUES (?,?,?)').run(1, 'server-refresh-only', 'openid https://www.googleapis.com/auth/drive.file');
  const calls: { url: URL; method: string }[] = [];
  const old = globalThis.fetch;
  globalThis.fetch = (async (u: any, init: any = {}) => {
    const url = new URL(String(u?.url ?? u));
    if (url.href === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic-access' });
    throw new Error('unexpected');
  }) as any;
  const fetcher = (async (u: any, init: any = {}) => {
    const url = new URL(String(u)); calls.push({ url, method: init.method || 'GET' });
    return Response.json({ items: [
      { start: { dateTime: '2026-10-12T15:00:00Z' }, summary: 'Private title', description: 'Private text', attendees: [{ email: 'founder@northwind.test', self: true }, { email: 'partner@harbourvc.test' }, { email: 'friend@gmail.com' }] },
      { start: { date: '2026-10-13' }, attendees: [{ email: 'no-domain' }] },
    ] });
  }) as any;
  try {
    await assert.rejects(calendarEventDays(env, 1, fetcher)('2026-05-01T00:00:00Z', '2026-10-27T00:00:00Z'), (e: any) => e.code === 'calendar_not_allowed');
    assert.equal(calls.length, 0, 'no Calendar grant: nothing is read');
    db.exec("UPDATE google_oauth_tokens SET scope = 'openid https://www.googleapis.com/auth/calendar.readonly'");
    const out = await calendarEventDays(env, 1, fetcher)('2026-05-01T00:00:00Z', '2026-10-27T00:00:00Z');
    assert.deepEqual(out, { events: [{ day: '2026-10-12', domains: ['harbourvc.test'] }], capped: false });
    assert.doesNotMatch(JSON.stringify(out), /@|Private/);
    assert.equal(calls.length, 1);
    const spec = GOOGLE_CALENDAR_READS['events.list'];
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].url.origin + calls[0].url.pathname, spec.origin + spec.path);
    assert.equal(calls[0].url.searchParams.get('fields'), 'items(start,attendees(email,self)),nextPageToken');
    assert.equal(calls[0].url.searchParams.get('singleEvents'), 'true');
  } finally { globalThis.fetch = old; }
  assert.equal(domainOf('A@Harbour.VC.test'), 'harbour.vc.test');
  for (const v of ['x@gmail.com', 'nope', null, '@x.test', 'a@b']) assert.equal(domainOf(v), null, String(v));
});

test('the feed registry names Raise’s three feeds, and the directory reads them', () => {
  // Parts 3 and 4 register theirs first; Raise's three follow, and the directory reads each of them.
  const raise = GOOGLE_WORKSPACE_FEEDS.filter((f) => f.decision === 'D1094');
  assert.deepEqual(raise.map((f) => [f.key, f.module, f.file_kind, f.lands]), [
    ['slides_deck_version', 'pitch_deck', 'slides', 'proposal'], ['drive_data_room_copy', 'data_room', 'file', 'fact'], ['calendar_last_met', 'capital_relationships', 'calendar', 'proposal'],
  ]);
  for (const m of ['pitch_deck', 'data_room', 'capital_relationships']) {
    assert.ok(CONNECTOR_METADATA.google_workspace.feeds.includes(m), m);
    assert.ok(CONNECTOR_METADATA.google_workspace.pulls.some((p: any) => p.module === m), m);
  }
  // The service calls no provider write: only the reader and the one GET Calendar read.
  const src = read('../src/services/google/raise.ts');
  assert.doesNotMatch(src, /method: '(POST|PUT|PATCH|DELETE)'/);
  assert.doesNotMatch(src, /console\.(log|warn|error)/, 'the service logs nothing; the route logs a code');
});

test('the four Raise routes each pass part 2’s gates first, and three module reads carry parts.google', () => {
  const src = read('../src/routes/cycle_raise.ts');
  for (const [method, path] of [['post', '/google/sync'], ['post', '/google/proposals/:id/accept'], ['post', '/google/proposals/:id/dismiss'], ['delete', '/google/facts/:id']]) {
    const at = src.indexOf(`cycleRaise.${method}('${path}'`);
    assert.ok(at > 0, path);
    const body = src.slice(at, src.indexOf('\n});', at));
    assert.ok(body.indexOf('await scope(c)') > 0 && body.indexOf('await googleOwner(c, s)') > body.indexOf('await scope(c)'), path);
    assert.ok(body.indexOf('own.integration.id') > body.indexOf('googleOwner'), `${path} acts on the member’s own connection`);
  }
  assert.match(src, /return await workspaceContext\(c, s\.user, s\.projectId\)/);
  assert.match(src, /RAISE_GOOGLE_SLUGS as readonly string\[\]\)\.includes\(slug\)/);
  assert.match(src, /parts\.google = \{ state: 'unreadable'/, 'a failed Google part never fails the module');
  assert.match(src, /console\.error\('\[cycle_raise\] google sync failed:', e instanceof WorkspaceError \? e\.code : 'error'\)/);
  const gate = read('../src/routes/google_workspace.ts');
  assert.match(gate, /export async function workspaceContext[\s\S]{0,200}impersonated_by\) throw new WorkspaceError\('support_session_refused', 403\)[\s\S]{0,40}return context\(c, user, project\)/);
});
