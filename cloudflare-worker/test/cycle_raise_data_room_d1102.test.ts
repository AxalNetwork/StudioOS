/**
 * D1102 (#2982, part 2) — the data room's paths in `routes/cycle_raise.ts`
 * take D1102's owner-only rule: an admin is not the room's owner. Real SQLite
 * on the canonical schema (the baseline, then every migration above the
 * cutoff), the route mounted on a bare Hono. All people and files are synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cycle_raise_data_room_d1102.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { JWT_SECRET, token } from './_esign_harness.ts';
import cycleRaise from '../src/routes/cycle_raise.ts';

const MIGRATIONS = new URL('../sql/migrations/', import.meta.url);
const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  for (const n of readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations)) {
    db.exec(readFileSync(new URL(n, MIGRATIONS), 'utf8'));
  }
  const out = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map((r) => r.sql).join(';\n');
  db.close(); return out;
})();

const OWNER = 1, INVESTOR = 2, OTHER = 3, ADMIN = 900;
const ROLE: Record<number, string> = { [OWNER]: 'founder', [INVESTOR]: 'investor', [OTHER]: 'founder', [ADMIN]: 'admin' };
const app = new Hono<any>().route('/api/cycles/raise', cycleRaise);
app.onError((e: any, c: any) => (e instanceof Response ? e : c.json({ error: String(e?.message || '') }, 500)));

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); db.exec(ddl);
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active,subscription_tier) VALUES
      (1,'founder','Synthetic founder','founder@example.com',11,1,'studio'),(2,'investor','Synthetic investor','investor@example.com',NULL,1,'free'),
      (3,'founder','Other founder','other@example.com',33,1,'studio'),(900,'admin','Synthetic admin','admin@example.com',NULL,1,'studio');
    INSERT INTO projects(id,uid,name,founder_id) VALUES (1,'room-one','Synthetic venture',11),(2,'room-two','Other venture',33);
    INSERT INTO data_room_folders(id,uid,project_id,name) VALUES (1,'folder-one',1,'Private folder');
    INSERT INTO data_room_files(id,uid,project_id,folder_id,name,r2_key,visibility,access_tier,checklist_item) VALUES
      (1,'file-one',1,1,'Private strategy.pdf','synthetic/one','nda','invited','incorporation'),
      (2,'file-two',1,1,'Private model.xlsx','synthetic/two','open','invited',NULL),
      (3,'file-three',1,1,'Private plan.pdf','synthetic/three','nda','invited',NULL),
      (4,'file-other',2,NULL,'Other private file','synthetic/other','nda','invited','incorporation');
    INSERT INTO data_room_grants(id,uid,project_id,investor_user_id,granted_by_user_id,status,expires_at) VALUES
      (1,'grant-one',1,2,1,'active',NULL),(2,'grant-old',1,3,1,'revoked',NULL);
    INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status) VALUES (1,2,'active');
    INSERT INTO data_room_access_log(project_id,user_id,file_id,action,created_at) VALUES (1,2,2,'download',datetime('now','-1 day'));`);
  const binding = d1Over(db); const statements: string[] = [];
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: { ...binding, prepare(sql: string) { statements.push(sql); return binding.prepare(sql); } } };
  const call = async (who: number, method: string, path: string, body?: unknown) => {
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const r = await app.request('/api/cycles/raise' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(who, ROLE[who])}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
      return { status: r.status, body: await r.json().catch(() => null) as any };
    } finally { [console.warn, console.error] = saved; }
  };
  return { db, env, call, statements };
}
const cardOf = (body: any, slug: string) => body.cards.find((c: any) => c.slug === slug);
const rowsOf = (card: any) => Object.fromEntries(card.series[0].items.map((i: any) => [i.label, i.value]));
const PRIVATE = /Private|Synthetic investor|investor@|@example|file-one|folder-one|synthetic\/one|grant-one/;
const OWNER_CARD_READ = /FROM data_room_access_log l LEFT JOIN users/;
const snapshot = (db: DatabaseSync) => JSON.stringify({ files: db.prepare('SELECT * FROM data_room_files ORDER BY id').all(), logs: db.prepare('SELECT * FROM activity_logs ORDER BY id').all() });

test('an admin overview carries the room summary as its data-room card, with no names, emails or access rows', async () => {
  const f = fixture(); try {
    const r = await f.call(ADMIN, 'GET', '/overview?project=1');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const card = cardOf(r.body, 'data-room');
    assert.equal(card.state, 'ok'); assert.equal(card.next, null); assert.equal(card.range, 'All files');
    assert.match(card.caption, /stay with the founder/);
    assert.deepEqual(rowsOf(card), { Files: 3, 'Files gated by NDA': 2, 'Checklist items with a tagged file': '1 of 12', 'Active grants': 1 });
    assert.doesNotMatch(JSON.stringify(card), PRIVATE);
    assert.ok(!f.statements.some((s) => OWNER_CARD_READ.test(s)), "the owner's card is never read for an admin");
  } finally { f.db.close(); }
});

test("D1191: the admin overview restricts capital while preserving other tools' existing cards", async () => {
  const f = fixture(); try {
    const owner = (await f.call(OWNER, 'GET', '/overview?project=1')).body;
    const admin = (await f.call(ADMIN, 'GET', '/overview?project=1')).body;
    assert.equal(admin.mode, 'summary');
    assert.equal(admin.cards.length, 7);
    for (const card of admin.cards.filter((c:any)=>!['capital-relationships','data-room'].includes(c.slug))) assert.deepEqual(card,cardOf(owner,card.slug));
    assert.deepEqual(admin.figures.map((f:any)=>f.key), ['readiness_score','runway_months','deck_views_8w','data_room_files']);
    assert.equal(owner.cards.length, 7);
    assert.equal(owner.figures.length, 6);
    assert.ok(!JSON.stringify(admin).includes('Synthetic investor'));
  } finally { f.db.close(); }
});

test("the owner's overview keeps the detailed card: coverage by area and who opened the room", async () => {
  const f = fixture(); try {
    const r = await f.call(OWNER, 'GET', '/overview?project=1');
    assert.equal(r.status, 200);
    const card = cardOf(r.body, 'data-room');
    assert.match(card.caption, /who opened the room/);
    assert.equal(card.series[0].kind, 'progress');
    assert.equal(card.series[1].items[0].label, 'Synthetic investor');
    assert.ok(f.statements.some((s) => OWNER_CARD_READ.test(s)));
  } finally { f.db.close(); }
});

test('a summary block that cannot be read says Unreadable on its row; all of them failing is an unreadable card', async () => {
  const f = fixture(); try {
    f.db.exec('DROP TABLE data_room_grants');
    let card = cardOf((await f.call(ADMIN, 'GET', '/overview?project=1')).body, 'data-room');
    assert.equal(card.state, 'ok');
    assert.deepEqual(rowsOf(card), { Files: 3, 'Files gated by NDA': 2, 'Checklist items with a tagged file': '1 of 12', 'Active grants': 'Unreadable' });
    f.db.exec('DROP TABLE data_room_files');
    card = cardOf((await f.call(ADMIN, 'GET', '/overview?project=1')).body, 'data-room');
    assert.equal(card.state, 'unreadable'); assert.equal(card.series, null);
    assert.equal(card.reason, 'The data room summary could not be read');
  } finally { f.db.close(); }
});

test("an admin's data-room module read is refused with D1102's code before anything is read; the owner reads it", async () => {
  const f = fixture(); try {
    f.statements.length = 0;
    const r = await f.call(ADMIN, 'GET', '/modules/data-room?project=1');
    assert.equal(r.status, 403); assert.equal(r.body.error, 'support_read_required');
    assert.doesNotMatch(JSON.stringify(r.body), PRIVATE);
    assert.ok(!f.statements.some((s) => /data_room_(files|folders|grants|access_log)/.test(s)), 'refused before any room read');
    const owner = await f.call(OWNER, 'GET', '/modules/data-room?project=1&sort=name');
    assert.equal(owner.status, 200);
    assert.deepEqual(owner.body.records.rows.map((x: any) => x.cells.file), ['Private model.xlsx', 'Private plan.pdf', 'Private strategy.pdf']);
    assert.equal((await f.call(OTHER, 'GET', '/modules/data-room?project=1')).status, 403, 'another founder, as before');
  } finally { f.db.close(); }
});

test("an admin cannot set a file's checklist item and nothing changes; the owner can", async () => {
  const f = fixture(); try {
    const before = snapshot(f.db);
    for (const item of ['financial_model', null]) {
      const r = await f.call(ADMIN, 'PUT', '/data-room/files/2/checklist?project=1', { item });
      assert.equal(r.status, 403); assert.equal(r.body.detail, 'Forbidden');
      assert.equal(snapshot(f.db), before);
    }
    const r = await f.call(OWNER, 'PUT', '/data-room/files/2/checklist?project=1', { item: 'financial_model' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((f.db.prepare('SELECT checklist_item AS c FROM data_room_files WHERE id = 2').get() as any).c, 'financial_model');
  } finally { f.db.close(); }
});

test("an admin's paths outside the data room keep their rules", async () => {
  const f = fixture(); try {
    for (const slug of ['cap-table', 'use-of-funds', 'capital-relationships']) {
      assert.equal((await f.call(ADMIN, 'GET', `/modules/${slug}?project=1`)).status, 200, slug);
    }
    const r = await f.call(ADMIN, 'PUT', '/use-of-funds?project=1', { sections: [{ key: 'product', pct: 100 }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await f.call(ADMIN, 'POST', '/readiness/rescore?project=1', {})).status, 200);
    assert.equal((await f.call(INVESTOR, 'GET', '/overview?project=1')).status, 403, 'an investor reaches nothing, as before');
  } finally { f.db.close(); }
});
