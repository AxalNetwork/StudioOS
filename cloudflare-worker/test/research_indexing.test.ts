/**
 * Indexing a document, and the two ways it must fail honestly.
 *
 * `indexResearchDocument` is reached through `embedAndUpsertById`, which the
 * queue consumer calls generically. What it must never do is leave a row
 * looking indexed when Ask cannot read it — that is the fabricated-fact
 * failure in its most persuasive form, because the library's index column is
 * exactly what tells a reader how far Ask can see.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { embedAndUpsertById, deleteChunkedEntity, researchNamespace } from '../src/services/vectorize.ts';

const MIGRATION = readFileSync(
  new URL('../sql/migrations/213_research_library.sql', import.meta.url), 'utf8');

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

/** D1-shaped adapter over real SQLite, plus recording R2/Vectorize fakes. */
function makeEnv(opts: { body?: string; mime?: string; noAi?: boolean; missingObject?: boolean } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, role TEXT);`);
  db.exec(MIGRATION);
  db.exec(`INSERT INTO users (id, email, role) VALUES (1, 'a@example.test', 'advisor')`);

  const upserted: any[] = [];
  const deleted: string[] = [];
  const env: any = {
    DB: {
      prepare(sql: string) {
        const st = () => db.prepare(sql);
        return {
          bind: (...args: any[]) => ({
            all: async () => ({ results: st().all(...coerce(args)) }),
            first: async () => st().get(...coerce(args)) ?? null,
            run: async () => ({ meta: st().run(...coerce(args)) }),
          }),
          all: async () => ({ results: st().all() }),
          first: async () => st().get() ?? null,
          run: async () => ({ meta: st().run() }),
        };
      },
    },
    FILES: {
      get: async () => (opts.missingObject ? null : {
        arrayBuffer: async () => new TextEncoder().encode(opts.body ?? '# One\n\nalpha\n\n\n# Two\n\nbeta').buffer,
      }),
    },
    VECTORIZE: {
      upsert: async (vs: any[]) => { upserted.push(...vs); },
      deleteByIds: async (ids: string[]) => { deleted.push(...ids); },
      query: async () => ({ matches: [] }),
    },
  };
  // `extractDeck` decodes text/markdown directly when AI.toMarkdown is absent,
  // which is how these tests exercise the real extractor without a model.
  if (!opts.noAi) {
    env.AI = { run: async () => ({ data: [Array.from({ length: 768 }, () => 0.02)] }) };
  }
  return { env, db, upserted, deleted };
}

const insertDoc = (db: any, mime = 'text/markdown', chunkCount: number | null = null) => {
  db.prepare(`INSERT INTO research_documents (uid, owner_user_id, title, r2_key, content_type, chunk_count)
              VALUES ('u1', 1, 'Doc', 'research/1/u1.md', ?, ?)`).run(mime, chunkCount);
  return (db.prepare(`SELECT id FROM research_documents WHERE uid='u1'`).get() as any).id;
};

test('a markdown document becomes one vector per chunk, owned and namespaced', async () => {
  const { env, db, upserted } = makeEnv();
  const id = insertDoc(db);
  const ok = await embedAndUpsertById(env, 'research_doc' as any, id);
  assert.equal(ok, true, 'indexing reported failure');

  assert.ok(upserted.length >= 2, `expected several chunks, got ${upserted.length}`);
  for (const v of upserted) {
    assert.match(v.id, /^research_doc:\d+:\d+$/, 'a chunk vector id is not {type}:{id}:{chunk}');
    assert.equal(v.namespace, researchNamespace(1), 'a chunk was written outside its owner’s namespace');
    assert.equal(v.metadata.owner_user_id, 1, 'a chunk carries no owner, so searchSemantic would drop it');
    assert.equal(v.metadata.type, 'research_doc');
  }

  const row: any = db.prepare(`SELECT * FROM research_documents WHERE id = ?`).get(id);
  assert.equal(row.index_state, 'indexed');
  assert.equal(row.chunk_count, upserted.length, 'chunk_count must equal the vectors actually written, or delete misses some');
  assert.ok(row.indexed_at, 'indexed_at was not set on a successful index');
  assert.equal(row.index_note, null, 'a successful index left a note behind');
});

test('re-indexing removes the previous chunks first', async () => {
  // A file that got SHORTER would otherwise leave its tail chunks in the
  // index — still answerable, no longer backed by the document.
  const { env, db, deleted } = makeEnv();
  const id = insertDoc(db, 'text/markdown', 5);
  await embedAndUpsertById(env, 'research_doc' as any, id);
  assert.deepEqual(deleted.slice(0, 5), [0, 1, 2, 3, 4].map((n) => `research_doc:${id}:${n}`),
    'the previous run’s chunks were not cleared before re-indexing');
});

test('a file nothing can be read from is unsupported, and never counts as indexed', async () => {
  const { env, db } = makeEnv({ body: '   ' });
  const id = insertDoc(db);
  const ok = await embedAndUpsertById(env, 'research_doc' as any, id);
  assert.equal(ok, false);
  const row: any = db.prepare(`SELECT * FROM research_documents WHERE id = ?`).get(id);
  assert.equal(row.index_state, 'unsupported');
  assert.ok(row.index_note, 'an unreadable file must say why, not just fail');
  assert.equal(row.chunk_count, null, 'chunk_count was set for a file that produced no chunks');
  assert.equal(row.indexed_at, null, 'indexed_at was set for a file Ask cannot read');
});

test('a missing object fails loudly rather than silently reporting success', async () => {
  const { env, db } = makeEnv({ missingObject: true });
  const id = insertDoc(db);
  const ok = await embedAndUpsertById(env, 'research_doc' as any, id);
  assert.equal(ok, false);
  const row: any = db.prepare(`SELECT * FROM research_documents WHERE id = ?`).get(id);
  assert.equal(row.index_state, 'failed');
  assert.match(row.index_note, /could not be found/i);
  assert.equal(row.indexed_at, null);
});

test('conversion being unavailable is retryable, and says so', async () => {
  // No AI binding and a non-text mime: `extractDeck` returns
  // 'document_conversion_unavailable' rather than throwing, and the row must
  // read as a transient failure — the hourly sweep will come back to it.
  const { env, db } = makeEnv({ noAi: true });
  const id = insertDoc(db, 'application/pdf');
  const ok = await embedAndUpsertById(env, 'research_doc' as any, id);
  assert.equal(ok, false);
  const row: any = db.prepare(`SELECT * FROM research_documents WHERE id = ?`).get(id);
  assert.equal(row.index_state, 'failed');
  assert.match(row.index_note, /retried/i, 'a transient failure must not read as a permanent one');
});

test('deleting a never-indexed document removes nothing rather than one wrong id', async () => {
  // chunk_count NULL means no vectors exist. Treating NULL as 0-or-more and
  // deleting `research_doc:{id}:0` would be a delete of something that was
  // never written — harmless here, but it is the same arithmetic that would
  // MISS chunks if NULL were read as a count.
  const { env, deleted } = makeEnv();
  await deleteChunkedEntity(env, 'research_doc' as any, 7, null);
  assert.deepEqual(deleted, []);
  await deleteChunkedEntity(env, 'research_doc' as any, 7, 0);
  assert.deepEqual(deleted, []);
  await deleteChunkedEntity(env, 'research_doc' as any, 7, 3);
  assert.deepEqual(deleted, ['research_doc:7:0', 'research_doc:7:1', 'research_doc:7:2']);
});

test('a row deleted between enqueue and processing does not resurrect', async () => {
  const { env, db } = makeEnv();
  const id = insertDoc(db);
  db.prepare(`DELETE FROM research_documents WHERE id = ?`).run(id);
  const ok = await embedAndUpsertById(env, 'research_doc' as any, id);
  assert.equal(ok, false, 'indexing a deleted row reported success');
});
