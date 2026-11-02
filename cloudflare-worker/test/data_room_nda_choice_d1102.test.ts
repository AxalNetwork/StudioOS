/**
 * D1102 (#2982, part 2) — migration 608 and the deck's "NDA required", on real
 * SQLite: the canonical schema (the baseline, then every migration above the
 * cutoff), the deck builder, and the two writers mounted on a bare Hono. All
 * people, ventures and files are synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/data_room_nda_choice_d1102.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { JWT_SECRET, token } from './_esign_harness.ts';
import { fillAxalSpinoutDemoDay } from '../src/services/decks/axalSpinoutDemoDay.ts';
import { mapToSpinoutDeckData } from '../src/services/decks/spinoutDeckData.ts';
import { deckNdaRequired, ndaChoiceInput, storedNdaChoice } from '../src/services/dataRoomNda.ts';
import projects from '../src/routes/projects.ts';
import decks from '../src/routes/decks.ts';

const MIGRATIONS = new URL('../sql/migrations/', import.meta.url);
const sql = (name: string) => readFileSync(new URL(name, MIGRATIONS), 'utf8');
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const M608 = '608_data_room_nda_choice.sql';
const above = readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations);

/** A database as a fresh D1 gets it, or (without 608) as production stood before 608. */
function build(skip608 = false) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(baseline);
  for (const name of above) if (!(skip608 && name === M608)) db.exec(sql(name));
  return db;
}
const fresh = (() => {
  const db = build();
  const ddl = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map((r) => r.sql).join(';\n');
  db.close(); return ddl;
})();

const FOUNDER = 1, OTHER = 3, ADMIN = 900;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder', [ADMIN]: 'admin' };
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); db.exec(fresh);
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active,subscription_tier) VALUES
      (1,'founder','Synthetic founder','founder@example.com',11,1,'studio'),(3,'founder','Other founder','other@example.com',33,1,'studio'),
      (900,'admin','Synthetic admin','admin@example.com',NULL,1,'studio');
    INSERT INTO projects(id,uid,name,founder_id) VALUES (1,'synthetic-one','Synthetic venture',11),(2,'synthetic-two','Other venture',33);`);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/projects', projects).route('/api/decks', decks);
  app.onError((e: any, c: any) => (e instanceof Response ? e : c.json({ error: String(e?.message || '') }, e?.message === 'Unauthorized' ? 401 : 500)));
  const call = async (who: number, method: string, path: string, body?: unknown) => {
    const r = await app.request(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(who, ROLE[who])}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  return { db, env, call };
}
function file(db: DatabaseSync, id: number, visibility: string, tier = 'invited', expiry: string | null = null, project = 1) {
  db.prepare('INSERT INTO data_room_files(id,uid,project_id,name,r2_key,visibility,access_tier,access_expires_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, 'synthetic-file-' + id, project, 'Synthetic file ' + id, 'synthetic/' + id, visibility, tier, expiry);
}
const choiceOf = (db: DatabaseSync, id = 1) => ({ ...db.prepare('SELECT data_room_nda_choice AS c, data_room_nda_required AS r FROM projects WHERE id = ?').get(id) as any });
const deckNda = async (env: any) => (await fillAxalSpinoutDemoDay(env, FOUNDER, 1)).contact.deal_access.nda_required;

// ---------------------------------------------------------------------------
// Migration 608
// ---------------------------------------------------------------------------

test('608 adds a nullable choice to a fresh build: unset is NULL, and only 0 or 1 is a choice', () => {
  const db = build(); try {
    const col = (db.prepare('PRAGMA table_info(projects)').all() as any[]).find((c) => c.name === 'data_room_nda_choice');
    assert.ok(col, 'the column exists on a fresh build');
    assert.equal(col.notnull, 0); assert.equal(col.dflt_value, null);
    db.exec("INSERT INTO projects(id,name) VALUES (1,'Synthetic venture')");
    assert.equal(choiceOf(db).c, null, 'a new venture has not chosen');
    assert.throws(() => db.exec('UPDATE projects SET data_room_nda_choice = 2 WHERE id = 1'), /CHECK/);
    for (const v of [0, 1]) { db.exec(`UPDATE projects SET data_room_nda_choice = ${v} WHERE id = 1`); assert.equal(choiceOf(db).c, v); }
  } finally { db.close(); }
});

test('608 on the live schema: a stored 1 stays 1, a stored 0 becomes unset, and the old column keeps its values', () => {
  const db = build(true); try {
    assert.ok(!(db.prepare('PRAGMA table_info(projects)').all() as any[]).some((c) => c.name === 'data_room_nda_choice'), 'production before 608');
    db.exec(`INSERT INTO projects(id,name,data_room_nda_required) VALUES (1,'Said yes',1),(2,'Stored zero',0);
      INSERT INTO projects(id,name) VALUES (3,'Untouched default');`);
    db.exec(sql(M608));
    assert.deepEqual([1, 2, 3].map((id) => choiceOf(db, id).c), [1, null, null]);
    assert.deepEqual([1, 2, 3].map((id) => choiceOf(db, id).r), [1, 0, 0]);
  } finally { db.close(); }
});

// ---------------------------------------------------------------------------
// The deck's "NDA required"
// ---------------------------------------------------------------------------

test('unset derives from the room: an NDA-gated file investors can be admitted to makes it true', async () => {
  for (const tier of ['invited', 'committed']) {
    const { db, env } = fixture(); try {
      file(db, 1, 'nda', tier);
      assert.equal(choiceOf(db).c, null);
      assert.equal(await deckNda(env), true, tier);
    } finally { db.close(); }
  }
});

test('unset with no NDA-gated file a room shares is false', async () => {
  const cases: Array<[string, (db: DatabaseSync) => void]> = [
    ['no files', () => {}],
    ['open files only', (db) => { file(db, 1, 'open'); file(db, 2, 'open', 'committed'); }],
    ['an NDA file shared with nobody', (db) => file(db, 1, 'nda', 'nobody')],
    ['an NDA file whose window closed', (db) => file(db, 1, 'nda', 'invited', '2000-01-01T00:00:00Z')],
    ["another venture's NDA file", (db) => file(db, 1, 'nda', 'invited', null, 2)],
  ];
  for (const [name, seed] of cases) {
    const { db, env } = fixture(); try {
      seed(db);
      assert.equal(await deckNda(env), false, name);
    } finally { db.close(); }
  }
});

test('the old column is never read: a stored 1 there with no choice still derives from the room', async () => {
  const { db, env } = fixture(); try {
    db.exec('UPDATE projects SET data_room_nda_required = 1 WHERE id = 1');
    assert.equal(await deckNda(env), false);
  } finally { db.close(); }
});

test('an explicit No with an NDA file is false; an explicit Yes is true, room or no room', async () => {
  const { db, env } = fixture(); try {
    file(db, 1, 'nda');
    db.exec('UPDATE projects SET data_room_nda_choice = 0 WHERE id = 1');
    assert.equal(await deckNda(env), false, 'the founder said No');
    db.exec('UPDATE projects SET data_room_nda_choice = 1 WHERE id = 1');
    assert.equal(await deckNda(env), true, 'the founder said Yes');
    db.exec('DELETE FROM data_room_files');
    assert.equal(await deckNda(env), true, 'Yes needs no NDA-gated file');
    db.exec('DROP TABLE data_room_files');
    assert.equal(await deckNdaRequired(env, 1, 1), true, 'a choice is not re-read from the room');
  } finally { db.close(); }
});

test('an unset choice over a room that cannot be read is Unreadable, never Not required', async () => {
  const { db, env } = fixture(); try {
    db.exec('DROP TABLE data_room_files');
    assert.equal(await deckNdaRequired(env, 1, null), null);
    const deck = await fillAxalSpinoutDemoDay(env, FOUNDER, 1);
    assert.equal(deck.contact.deal_access.nda_required, null);
    assert.equal(mapToSpinoutDeckData(deck).data.deal.ready.find((x: any) => x[0] === 'NDA')![1], 'Unreadable');
    for (const [nda, said] of [[true, 'Required'], [false, 'Not required']] as const) {
      const shown = structuredClone(deck); shown.contact.deal_access.nda_required = nda;
      assert.equal(mapToSpinoutDeckData(shown).data.deal.ready.find((x: any) => x[0] === 'NDA')![1], said);
    }
  } finally { db.close(); }
});

test('only a 0 or 1 is a stored choice, and only Yes or No is a written one', () => {
  assert.deepEqual([1, 0, null, undefined, 2, '1', true].map(storedNdaChoice), [1, 0, null, null, null, null, null]);
  assert.deepEqual([true, false, 1, 0, null, undefined, 'true', 'no', 2].map(ndaChoiceInput), [1, 0, 1, 0, undefined, undefined, undefined, undefined, undefined]);
});

// ---------------------------------------------------------------------------
// The writers store each explicit choice, and nothing else
// ---------------------------------------------------------------------------

test('PUT /api/projects/:id stores Yes and No as the choice, mirrored for a rolled-back Worker', async () => {
  const { db, env, call } = fixture(); try {
    file(db, 1, 'nda');
    let r = await call(FOUNDER, 'PUT', '/api/projects/1', { data_room_url: 'https://example.com/room', data_room_nda_choice: false });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(choiceOf(db), { c: 0, r: 0 }); assert.equal(r.body.data_room_nda_choice, 0);
    assert.equal(await deckNda(env), false, 'the explicit No holds over an NDA-gated file');
    r = await call(FOUNDER, 'PUT', '/api/projects/1', { data_room_nda_choice: true });
    assert.equal(r.status, 200); assert.deepEqual(choiceOf(db), { c: 1, r: 1 });
  } finally { db.close(); }
});

test('a save that does not choose leaves the choice unset, and the old key is not a choice', async () => {
  const { db, call } = fixture(); try {
    assert.equal((await call(FOUNDER, 'PUT', '/api/projects/1', { data_room_url: 'https://example.com/room' })).status, 200);
    assert.deepEqual(choiceOf(db), { c: null, r: 0 });
    for (const legacy of [false, true]) {
      assert.equal((await call(FOUNDER, 'PUT', '/api/projects/1', { data_room_nda_required: legacy })).status, 200);
      assert.deepEqual(choiceOf(db), { c: null, r: 0 }, `old key ${legacy}`);
    }
  } finally { db.close(); }
});

test('anything but Yes or No is refused, with nothing written', async () => {
  const { db, call } = fixture(); try {
    for (const bad of [null, 'yes', 2, '']) {
      const r = await call(FOUNDER, 'PUT', '/api/projects/1', { data_room_url: 'https://example.com/changed', data_room_nda_choice: bad });
      assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.body.error, 'invalid_nda_choice');
      assert.deepEqual(choiceOf(db), { c: null, r: 0 });
      assert.equal((db.prepare('SELECT data_room_url AS u FROM projects WHERE id = 1').get() as any).u, null);
    }
  } finally { db.close(); }
});

/** A Spin-Out demo-day version whose Review-the-deal slide carries `nda`, as the deck builder writes it. */
function demoDayDeck(db: DatabaseSync, nda: boolean | undefined, legacyField?: boolean) {
  const fields: any[] = [{ key: 'contact_headline', label: 'Headline', kind: 'paragraph', value: 'Review the deal.', source: 'data' }];
  if (nda !== undefined) fields.push({ key: 'contact_deal_access_json', label: 'Deal access', kind: 'paragraph', value: JSON.stringify({ deal_room_url: '', nda_required: nda, data_room_ready: false, cta_label: 'Review the deal' }), source: 'data' });
  if (legacyField !== undefined) fields.push({ key: 'contact_deal_access_nda_required', label: 'NDA', kind: 'paragraph', value: legacyField, source: 'data' });
  const slides = [{ title: 'Review the deal', subtitle: null, body: '', bullets: [], image_url: null, method_id: 'axal_spinout_demoday', spec_id: 'review_the_deal', fields }];
  db.prepare('INSERT INTO pitch_decks(id,project_id,version,slides,title,is_current,created_by) VALUES(10,1,1,?,?,1,?)').run(JSON.stringify(slides), 'Synthetic deck', FOUNDER);
  return slides;
}
const withNda = (slides: any[], nda: boolean) => slides.map((s) => ({ ...s, fields: s.fields.map((f: any) => (f.key === 'contact_deal_access_json'
  ? { ...f, value: JSON.stringify({ ...JSON.parse(f.value), nda_required: nda }) } : f)) }));

test('PUT /api/decks/:id: the NDA flag a save carries unchanged is the deck echoing itself, not a choice', async () => {
  for (const shown of [true, false]) {
    const { db, call } = fixture(); try {
      const slides = demoDayDeck(db, shown);
      const r = await call(FOUNDER, 'PUT', '/api/decks/10', { model_version: 2, slides, title: 'Synthetic deck' });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(choiceOf(db), { c: null, r: 0 }, `an unchanged ${shown} stays unset`);
    } finally { db.close(); }
  }
});

test('PUT /api/decks/:id: a changed NDA flag is the founder\'s choice, Yes or No, mirrored', async () => {
  for (const [saved, next] of [[true, false], [false, true]] as const) {
    const { db, call } = fixture(); try {
      const slides = demoDayDeck(db, saved);
      const r = await call(FOUNDER, 'PUT', '/api/decks/10', { model_version: 2, slides: withNda(slides, next), title: 'Synthetic deck' });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(choiceOf(db), { c: next ? 1 : 0, r: next ? 1 : 0 }, `${saved} changed to ${next}`);
    } finally { db.close(); }
  }
  const { db, call } = fixture(); try {
    const slides = demoDayDeck(db, undefined, false);
    const next = slides.map((s) => ({ ...s, fields: s.fields.map((f: any) => (f.key === 'contact_deal_access_nda_required' ? { ...f, value: true } : f)) }));
    assert.equal((await call(FOUNDER, 'PUT', '/api/decks/10', { model_version: 2, slides: next, title: 'Synthetic deck' })).status, 200);
    assert.deepEqual(choiceOf(db), { c: 1, r: 1 }, 'the legacy slide field, changed, is a choice too');
  } finally { db.close(); }
});
