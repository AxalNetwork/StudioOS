/** #3747: real migrated SQLite, synthetic ventures and an in-memory R2 bucket. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { hardDeleteProject, sweepTrashedProjects } from '../src/services/projectTrash.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const sqlRoot = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', sqlRoot), 'utf8');
const migrations = readdirSync(new URL('migrations/', sqlRoot)).filter(name => /^\d+_.*\.sql$/.test(name) && migrationNumber(name) > BASELINE_CUTOFF).sort()
  .map(name => readFileSync(new URL('migrations/' + name, sqlRoot), 'utf8'));
// Apply the canonical migrations once, then copy their resulting schema for
// each isolated case. Replaying hundreds of ALTERs per case is unnecessary;
// no hand-copied DDL or shared rows stand in for the production schema.
const schema = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  try {
    db.exec(baseline); for (const sql of migrations) db.exec(sql);
    return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END`).all() as { sql: string }[])
      .map(row => row.sql + ';').join('\n');
  } finally { db.close(); }
})();

const marker = 'project-deck-images-purge:1';
const stores = ['pitch_decks', 'pitch_deck_proposals', 'pitch_deck_share_tokens', 'deck_share_views', 'deck_share_feedback', 'deck_share_conversions', 'deck_view_slides', 'deck_exports', 'deck_notes', 'deck_images', 'deck_checks'];

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(schema);
  db.exec(`INSERT INTO founders(id,name,email) VALUES(100,'Synthetic founder','founder@example.invalid');
    INSERT INTO users(id, role, name, email, founder_id) VALUES(2,'founder','Synthetic founder','delete@example.invalid',100);
    INSERT INTO projects(id,name,founder_id,deleted_at) VALUES(1,'Synthetic venture',100,'2000-01-01'),(10,'Other venture',100,NULL);`);
  for (const [deck, project] of [[7, 1], [8, 1], [9, 10]]) {
    const version = deck === 8 ? 2 : 1;
    db.prepare('INSERT INTO pitch_decks(id,project_id,version,is_current,slides) VALUES(?,?,?,?,?)').run(deck, project, version, deck === 7 ? 0 : 1, '[]');
    db.prepare("INSERT INTO pitch_deck_share_tokens(id,deck_id,token_hash,expires_at) VALUES(?,?,?, '2099-01-01')").run(deck, deck, 'synthetic-' + deck);
    db.prepare('INSERT INTO deck_share_views(id,share_token_id,deck_id) VALUES(?,?,?)').run(deck, deck, deck);
    // Deliberately no project_id: deck ownership, not a nullable copy, scopes these.
    db.prepare("INSERT INTO deck_share_conversions(view_id,share_token_id,deck_id,type) VALUES(?,?,?,'synthetic')").run(deck, deck, deck);
    db.prepare("INSERT INTO deck_share_feedback(view_id,deck_id,overall_note) VALUES(?,?,'Synthetic feedback')").run(deck, deck);
    db.prepare('INSERT INTO deck_view_slides(view_id,slide_index,seconds) VALUES(?,0,5)').run(deck);
    db.prepare("INSERT INTO deck_notes(project_id,deck_id,deck_version,author_user_id,author_kind,body) VALUES(?,?,?,2,'founder','Synthetic note')").run(project, deck, version);
    db.prepare("INSERT INTO deck_exports(deck_id,version,format,content_hash,created_by) VALUES(?,?,'pdf','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',2)").run(deck, version);
    db.prepare("INSERT INTO deck_checks(deck_id,project_id,surface_version) VALUES(?,?,'synthetic')").run(deck, project);
    db.prepare("INSERT INTO pitch_deck_proposals(project_id,base_deck_id,slides) VALUES(?,?,'[]')").run(project, deck);
  }
  const objects = new Map<string, string>();
  for (const [id, deck, project] of [[1, 7, 1], [2, 7, 1], [3, 8, 1], [4, 9, 10]]) {
    const key = `deck-images/${project}/${id}.png`;
    db.prepare(`INSERT INTO deck_images(uid,project_id,deck_id,r2_key,mime,size_bytes,source,use,state,alt)
      VALUES(?,?,?,?,'image/png',10,'upload','content',?,'Synthetic image')`).run('image-' + id, project, deck, key, id === 1 ? 'discarded' : id === 2 ? 'proposed' : 'kept');
    objects.set(key, 'synthetic');
  }
  // Prefix cleanup also catches files without rows, but not similarly named ventures.
  objects.set('deck-images/1/orphan.png', 'synthetic');
  objects.set('documents/1/keep.pdf', 'synthetic');
  db.exec('PRAGMA foreign_keys = ON');
  const lists: any[] = [], deletes: string[][] = [];
  let fail: 'list' | 'delete' | undefined;
  const FILES = {
    list: async (options: any) => {
      lists.push(options);
      if (fail === 'list') throw new Error('Synthetic list failure');
      const keys = [...objects.keys()].filter(key => key.startsWith(options.prefix) && (!options.cursor || key > options.cursor)).sort();
      const page = keys.slice(0, options.limit);
      return { objects: page.map(key => ({ key })), truncated: keys.length > page.length, ...(keys.length > page.length ? { cursor: page.at(-1) } : {}) };
    },
    delete: async (keys: string[]) => {
      deletes.push(keys);
      if (fail === 'delete') throw new Error('Synthetic delete failure');
      for (const key of keys) objects.delete(key);
    },
  };
  const env: any = { DB: d1Over(db), FILES };
  const n = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n;
  const pending = () => db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(marker);
  return { db, env, objects, lists, deletes, n, pending, fail: (value?: 'list' | 'delete') => { fail = value; } };
}

test('hard deletion removes both decks, all share/notes/image children and only their R2 prefix', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const before = Object.fromEntries(stores.map(table => [table, f.n(table)]));
  await hardDeleteProject(f.env, 1);
  assert.equal(f.db.prepare('SELECT id FROM projects WHERE id = 1').get(), undefined);
  assert.ok(f.db.prepare('SELECT id FROM projects WHERE id = 10').get());
  for (const table of stores) {
    assert.equal(f.n(table), 1, table);
    assert.ok(before[table] > f.n(table), table + ' actually exercised');
  }
  assert.equal(f.pending(), undefined);
  assert.deepEqual([...f.objects.keys()].sort(), ['deck-images/10/4.png', 'documents/1/keep.pdf']);
  assert.deepEqual(f.lists, [{ prefix: 'deck-images/1/', limit: 500 }]);
  assert.equal(f.deletes.flat().length, 4);
});

test('purge follows 500-object pages, includes orphan files and can repeat safely', async t => {
  const f = fixture(); t.after(() => f.db.close());
  for (let i = 0; i < 1002; i++) f.objects.set(`deck-images/1/extra-${String(i).padStart(4, '0')}.png`, 'synthetic');
  await hardDeleteProject(f.env, 1);
  assert.equal(f.lists.length, 3);
  assert.deepEqual(f.deletes.map(keys => keys.length), [500, 500, 6]);
  assert.ok(f.lists.slice(1).every(page => page.limit === 500 && page.cursor));
  assert.equal([...f.objects.keys()].filter(key => key.startsWith('deck-images/1/')).length, 0);
  await hardDeleteProject(f.env, 1);
  assert.equal(f.pending(), undefined);
  assert.ok(f.objects.has('deck-images/10/4.png'));
});

for (const operation of ['list', 'delete'] as const) test(`${operation} failure retains retry after project removal; cron finishes it without a project row`, async t => {
  const f = fixture(); t.after(() => f.db.close());
  f.fail(operation);
  await hardDeleteProject(f.env, 1);
  assert.equal(f.db.prepare('SELECT id FROM projects WHERE id=1').get(), undefined);
  assert.ok(f.pending());
  assert.equal(f.n('pitch_decks'), 1);
  assert.ok(f.objects.has('deck-images/1/1.png'));
  f.fail();
  assert.deepEqual(await sweepTrashedProjects(f.env), { scanned: 0, deleted: 0, failed: 0 });
  assert.equal(f.pending(), undefined);
  assert.deepEqual([...f.objects.keys()].sort(), ['deck-images/10/4.png', 'documents/1/keep.pdf']);
});

test('a missing bucket keeps a durable retry; a missing retry store refuses deletion before any rows change', async t => {
  const f = fixture(); t.after(() => f.db.close());
  delete f.env.FILES;
  await hardDeleteProject(f.env, 1);
  assert.ok(f.pending());
  const g = fixture(); t.after(() => g.db.close());
  g.db.exec('DROP TABLE platform_settings');
  await assert.rejects(hardDeleteProject(g.env, 1), /cleanup store unavailable/);
  assert.equal(g.n('pitch_decks'), 3);
  assert.equal(g.n('projects'), 2);
  assert.equal(g.lists.length, 0);
});

test('a blocked parent deletion rolls back all SQL children and marker and never touches R2', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const snapshot = Object.fromEntries(stores.map(table => [table, f.n(table)]));
  f.db.exec("CREATE TRIGGER synthetic_parent_refusal BEFORE DELETE ON projects BEGIN SELECT RAISE(ABORT, 'Synthetic refusal'); END");
  await assert.rejects(hardDeleteProject(f.env, 1), /Synthetic refusal/);
  assert.equal(f.n('projects'), 2);
  for (const table of stores) assert.equal(f.n(table), snapshot[table], table);
  assert.equal(f.pending(), undefined);
  assert.equal(f.lists.length, 0);
  assert.equal(f.objects.size, 6);
});

test('retry completion failure and partial page failure remain idempotently recoverable', async t => {
  const f = fixture(); t.after(() => f.db.close());
  f.db.exec("CREATE TRIGGER synthetic_marker_refusal BEFORE DELETE ON platform_settings WHEN OLD.key LIKE 'project-deck-images-purge:%' BEGIN SELECT RAISE(ABORT,'Synthetic marker refusal'); END");
  await hardDeleteProject(f.env, 1);
  assert.ok(f.pending());
  assert.equal(f.objects.size, 2);
  f.db.exec('DROP TRIGGER synthetic_marker_refusal');
  await sweepTrashedProjects(f.env);
  assert.equal(f.pending(), undefined);
  const g = fixture(); t.after(() => g.db.close());
  for (let i = 0; i < 501; i++) g.objects.set(`deck-images/1/extra-${i}.png`, 'synthetic');
  const remove = g.env.FILES.delete;
  let calls = 0;
  g.env.FILES.delete = async (keys: string[]) => { if (++calls === 2) throw new Error('Synthetic second page failure'); return remove(keys); };
  await hardDeleteProject(g.env, 1);
  assert.ok(g.pending());
  assert.equal([...g.objects.keys()].filter(key => key.startsWith('deck-images/1/')).length, 5);
  g.env.FILES.delete = remove;
  await sweepTrashedProjects(g.env);
  assert.equal(g.pending(), undefined);
  assert.equal(g.objects.size, 2);
});

test('a marker write failure rolls back the venture and all children before any storage call', async t => {
  const f = fixture(); t.after(() => f.db.close());
  f.db.exec("CREATE TRIGGER synthetic_marker_insert_refusal BEFORE INSERT ON platform_settings WHEN NEW.key LIKE 'project-deck-images-purge:%' BEGIN SELECT RAISE(ABORT,'Synthetic marker insert refusal'); END");
  await assert.rejects(hardDeleteProject(f.env, 1), /Synthetic marker insert refusal/);
  assert.equal(f.n('pitch_decks'), 3);
  assert.equal(f.n('deck_notes'), 3);
  assert.equal(f.n('deck_images'), 4);
  assert.equal(f.n('projects'), 2);
  assert.equal(f.pending(), undefined);
  assert.equal(f.lists.length, 0);
});

test('cron bounds retry work and eventually drains the backlog; malformed keys cannot broaden a purge', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const insert = f.db.prepare('INSERT INTO platform_settings(key,value) VALUES(?,?)');
  for (let id = 100; id < 202; id++) insert.run('project-deck-images-purge:' + id, String(id));
  for (const suffix of ['../', '0', '-1', '9007199254740992']) insert.run('project-deck-images-purge:' + suffix, '1');
  f.db.exec('UPDATE projects SET deleted_at = NULL');
  assert.deepEqual(await sweepTrashedProjects(f.env), { scanned: 0, deleted: 0, failed: 0 });
  assert.ok(f.lists.length <= 25);
  for (let pass = 0; pass < 5; pass++) {
    // Advance old failed/malformed attempts to a prior second without sleeping.
    f.db.exec("UPDATE platform_settings SET updated_at = '2000-01-01' WHERE key NOT IN ('project-deck-images-purge:../','project-deck-images-purge:0','project-deck-images-purge:-1','project-deck-images-purge:9007199254740992')");
    const before = f.lists.length;
    await sweepTrashedProjects(f.env);
    assert.ok(f.lists.length - before <= 25);
  }
  assert.equal(f.lists.length, 102);
  assert.ok(f.lists.every(page => /^deck-images\/(1\d\d|20[01])\/$/.test(page.prefix)));
  assert.equal((f.db.prepare("SELECT COUNT(*) n FROM platform_settings WHERE key LIKE 'project-deck-images-purge:%'").get() as any).n, 4);
  assert.equal(f.objects.size, 6);
});

test('a non-advancing R2 cursor retains the marker instead of looping or claiming completion', async t => {
  const f = fixture(); t.after(() => f.db.close());
  f.env.FILES.list = async () => ({ objects: [], truncated: true });
  await hardDeleteProject(f.env, 1);
  assert.ok(f.pending());
  assert.equal(f.n('projects'), 1);
  assert.equal(f.objects.size, 6);
});

test('populated existing children and their cascade dependants delete in order over the full schema', async t => {
  const f = fixture(); t.after(() => f.db.close());
  f.db.exec(`INSERT INTO score_snapshots(id,project_id,total_score,tier) VALUES(1,1,50,'synthetic');
    INSERT INTO deal_memos(project_id,score_snapshot_id,startup_name,founders,total_score,tier) VALUES(1,1,'Synthetic venture','Synthetic founder',50,'synthetic');
    INSERT INTO deals(id,project_id) VALUES(1,1);
    INSERT INTO deal_notes(deal_id,author_user_id,body) VALUES(1,2,'Synthetic deal note');
    INSERT INTO cap_table_holders(id,user_id,project_id,name) VALUES(1,2,1,'Synthetic holder');
    INSERT INTO founder_contributions(project_id,holder_id,text) VALUES(1,1,'Synthetic contribution');
    INSERT INTO round_calls(id,uid,project_id,name,amount_cents,instrument,terms,minimum_cheque_cents,target_close,deck_id,terms_hash,created_by)
      VALUES(1,'synthetic-call',1,'Synthetic call',100,'safe','Synthetic terms',10,'2099-01-01',7,'synthetic',2);
    INSERT INTO round_call_recipients(call_id,investor_user_id,origin) VALUES(1,2,'chosen');
    INSERT INTO round_call_questions(uid,call_id,investor_user_id,question) VALUES('synthetic-question',1,2,'Synthetic question');
    INSERT INTO activity_logs(project_id,user_id,action) VALUES(1,2,'synthetic-action');`);
  await hardDeleteProject(f.env, 1);
  for (const table of ['score_snapshots','deal_memos','deals','deal_notes','cap_table_holders','founder_contributions','round_calls','round_call_recipients','round_call_questions']) assert.equal(f.n(table), 0, table);
  assert.equal(f.n('activity_logs'), 1);
  assert.equal((f.db.prepare('SELECT project_id FROM activity_logs').get() as any).project_id, null);
  assert.equal(f.n('pitch_decks'), 1);
  assert.equal(f.objects.size, 2);
});

test('an existing non-cascading financial/deal reference refuses atomically rather than losing other children', async t => {
  const f = fixture(); t.after(() => f.db.close());
  f.db.exec(`INSERT INTO deals(id,project_id) VALUES(1,1);
    INSERT INTO ic_meetings(uid,title,start_at,deal_id,organizer_user_id) VALUES('synthetic-meeting','Synthetic meeting','2099-01-01',1,2)`);
  await assert.rejects(hardDeleteProject(f.env, 1), /FOREIGN KEY/);
  assert.equal(f.n('projects'), 2);
  assert.equal(f.n('pitch_decks'), 3);
  assert.equal(f.n('deck_notes'), 3);
  assert.equal(f.n('deck_images'), 4);
  assert.equal(f.n('deals'), 1);
  assert.equal(f.n('ic_meetings'), 1);
  assert.equal(f.pending(), undefined);
  assert.equal(f.lists.length, 0);
});

test('SQL sweep precedes capped retries and older failures rotate behind unattempted markers', async t => {
  const f = fixture(); t.after(() => f.db.close());
  for (let id = 100; id < 126; id++) f.db.prepare("INSERT INTO platform_settings(key,value,updated_at) VALUES(?,?,'2000-01-01')").run('project-deck-images-purge:' + id, String(id));
  const list = f.env.FILES.list;
  const attempts: string[] = [];
  f.env.FILES.list = async (options: any) => {
    assert.equal(f.db.prepare('SELECT id FROM projects WHERE id=1').get(), undefined, 'SQL sweep must run before retry storage calls');
    attempts.push(options.prefix);
    if (options.prefix !== 'deck-images/1/') throw new Error('Synthetic retry failure');
    return list(options);
  };
  assert.deepEqual(await sweepTrashedProjects(f.env), { scanned: 1, deleted: 1, failed: 0 });
  assert.equal(attempts.length, 26, 'one immediate venture purge plus 25 retries');
  assert.equal(attempts.includes('deck-images/125/'), false);
  const before = attempts.length;
  await sweepTrashedProjects(f.env);
  assert.equal(attempts[before], 'deck-images/125/');
  assert.equal(attempts.length - before, 25);
  assert.equal((f.db.prepare("SELECT COUNT(*) n FROM platform_settings WHERE key LIKE 'project-deck-images-purge:%'").get() as any).n, 26);
});

test('retry SQL failures are logged, retain the marker and preserve the completed sweep result', async t => {
  const errors: any[][] = [];
  const error = console.error;
  console.error = (...args: any[]) => { errors.push(args); };
  t.after(() => { console.error = error; });
  for (const failure of ['read', 'update']) {
    const f = fixture(); t.after(() => f.db.close());
    const key = 'project-deck-images-purge:100';
    f.db.prepare('INSERT INTO platform_settings(key,value) VALUES(?,?)').run(key, '100');
    if (failure === 'update') {
      f.db.exec("CREATE TRIGGER synthetic_retry_update_refusal BEFORE UPDATE ON platform_settings WHEN OLD.key='project-deck-images-purge:100' BEGIN SELECT RAISE(ABORT,'Synthetic retry update refusal'); END");
    } else {
      const prepare = f.env.DB.prepare.bind(f.env.DB);
      f.env.DB.prepare = (sql: string) => prepare(sql.startsWith('SELECT key FROM platform_settings') ? 'SELECT missing_retry_column FROM platform_settings' : sql);
    }
    const before = errors.length;
    assert.deepEqual(await sweepTrashedProjects(f.env), { scanned: 1, deleted: 1, failed: 0 });
    assert.equal(f.n('projects'), 1);
    assert.equal(f.n('pitch_decks'), 1);
    assert.ok(f.db.prepare('SELECT value FROM platform_settings WHERE key=?').get(key));
    assert.equal(f.objects.size, 2);
    assert.ok(errors.slice(before).some(args => args[0] === '[projectTrash.deckImages] pending retry scan failed'));
  }
});

test('a sweep discovers each cleanup table once, with fresh discovery on the next invocation', async t => {
  const f = fixture(); t.after(() => f.db.close());
  f.db.exec("INSERT INTO projects(id,name,founder_id,deleted_at) VALUES(2,'Another synthetic trashed venture',100,'2000-01-01')");
  const prepare = f.env.DB.prepare.bind(f.env.DB);
  const reads = new Map<string, number>();
  f.env.DB.prepare = (sql: string) => {
    if (sql.startsWith('PRAGMA table_info(')) reads.set(sql, (reads.get(sql) ?? 0) + 1);
    return prepare(sql);
  };
  assert.deepEqual(await sweepTrashedProjects(f.env), { scanned: 2, deleted: 2, failed: 0 });
  assert.ok(reads.has('PRAGMA table_info(activity_logs)'));
  assert.ok(reads.has('PRAGMA table_info(round_calls)'));
  assert.ok([...reads.values()].every(count => count === 1), 'metadata round-trips must not multiply by the venture count');
  assert.equal(f.n('projects'), 1);
  f.db.exec("INSERT INTO projects(id,name,founder_id,deleted_at) VALUES(3,'Next invocation venture',100,'2000-01-01')");
  assert.deepEqual(await sweepTrashedProjects(f.env), { scanned: 1, deleted: 1, failed: 0 });
  assert.ok([...reads.values()].every(count => count === 2), 'schema discovery must be fresh per invocation');
  assert.equal(f.n('projects'), 1);
  assert.equal(f.objects.size, 2);
});
