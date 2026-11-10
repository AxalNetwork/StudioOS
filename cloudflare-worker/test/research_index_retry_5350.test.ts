/** #5350 — bounded retries for stranded Research documents and the one-time pre-D4605 vector upgrade. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { embedAndUpsertById } from '../src/services/vectorize.ts';
import {
  RESEARCH_LEGACY_LIMIT,
  RESEARCH_PENDING_LIMIT,
  sweepResearchIndex,
} from '../src/services/researchIndexSweep.ts';

test.after(() => removeMigratedDatabases());

const NOW = new Date('2026-11-10T10:00:00Z');
const OLD = '2026-11-10 08:00:00';

function fixture() {
  const db = migratedDatabase();
  const kv = new Map<string, string>();
  const vectors = new Map<string, any>();
  const env: any = {
    DB: d1Over(db),
    RATE_LIMITS: {
      get: async (key: string) => kv.get(key) ?? null,
      put: async (key: string, value: string) => { kv.set(key, value); },
    },
    FILES: {
      get: async () => ({ arrayBuffer: async () => new TextEncoder().encode('# Evidence\n\nThe whole passage survives beyond its short preview.').buffer }),
    },
    AI: { run: async () => ({ data: [Array(768).fill(0.01)] }) },
    VECTORIZE: {
      getByIds: async (ids: string[]) => ids.flatMap((id) => vectors.has(id) ? [structuredClone(vectors.get(id))] : []),
      upsert: async (items: any[]) => { for (const item of items) vectors.set(String(item.id), structuredClone(item)); },
      deleteByIds: async (ids: string[]) => { for (const id of ids) vectors.delete(id); },
      query: async () => ({ matches: [] }),
    },
  };
  const document = (id: number, state: string, updatedAt = OLD, indexedAt: string | null = null) => {
    db.prepare(`INSERT INTO research_documents
      (id, uid, owner_user_id, title, r2_key, content_type, size_bytes, index_state, indexed_at, chunk_count, created_at, updated_at)
      VALUES (?, ?, 801, ?, ?, 'text/plain', 60, ?, ?, 1, ?, ?)`).run(
      id, `doc-${id}`, `Document ${id}`, `research/801/doc-${id}.txt`, state, indexedAt, updatedAt, updatedAt,
    );
  };
  const close = () => { const file = db.location(); db.close(); if (file) rmSync(file, { force: true }); };
  return { db, env, kv, vectors, document, close };
}

const jobs = (f: ReturnType<typeof fixture>) => f.db.prepare(
  "SELECT id, payload, status, attempts, max_retries, updated_at FROM queue_jobs WHERE job_type = 'embed_entity' ORDER BY id",
).all() as any[];

test('a stale pending document is queued once, not beside a live job, and exhausts after three attempts', async () => {
  // Mutations checked: drop the live-job exclusion → a second row appears; drop the attempt limit → the document stays pending.
  const f = fixture();
  try {
    f.document(1, 'pending');
    const first = await sweepResearchIndex(f.env, NOW);
    assert.deepEqual([first.pending_scanned, first.pending_enqueued, jobs(f).length], [1, 1, 1]);

    f.db.prepare("UPDATE research_documents SET updated_at = '2026-11-10 08:00:00' WHERE id = 1").run();
    f.db.prepare("UPDATE queue_jobs SET updated_at = '2026-11-10 08:00:00' WHERE id = 1").run();
    const live = await sweepResearchIndex(f.env, new Date('2026-11-10T12:00:00Z'));
    assert.deepEqual([live.pending_scanned, jobs(f).length], [0, 1], 'an old pending queue row is still live work');

    f.db.prepare("UPDATE queue_jobs SET status = 'processing', attempts = 1, updated_at = '2026-11-10 10:00:00' WHERE id = 1").run();
    const recovered = await sweepResearchIndex(f.env, new Date('2026-11-10T12:00:00Z'));
    assert.equal(recovered.pending_requeued, 1);
    const retried = f.db.prepare('SELECT status, attempts FROM queue_jobs WHERE id = 1').get() as any;
    assert.deepEqual([retried.status, retried.attempts], ['pending', 1]);
    assert.equal(jobs(f).length, 1, 'stale processing reuses its job');

    f.db.prepare("UPDATE research_documents SET updated_at = '2026-11-10 12:00:00' WHERE id = 1").run();
    f.db.prepare("UPDATE queue_jobs SET status = 'processing', attempts = 3, updated_at = '2026-11-10 12:00:00' WHERE id = 1").run();
    const exhausted = await sweepResearchIndex(f.env, new Date('2026-11-10T14:00:00Z'));
    const doc = f.db.prepare('SELECT index_state, index_note FROM research_documents WHERE id = 1').get() as any;
    assert.equal(exhausted.pending_failed, 1);
    assert.equal(doc.index_state, 'failed');
    assert.match(doc.index_note, /after 3 attempts/);
  } finally { f.close(); }
});

test('pending recovery is bounded per hourly tick', async () => {
  // Mutation checked: removing the LIMIT enqueues all 25 rows in the first tick.
  const f = fixture();
  try {
    for (let id = 1; id <= RESEARCH_PENDING_LIMIT + 5; id += 1) f.document(id, 'pending');
    const first = await sweepResearchIndex(f.env, NOW);
    assert.deepEqual([first.pending_scanned, first.pending_enqueued, jobs(f).length], [RESEARCH_PENDING_LIMIT, RESEARCH_PENDING_LIMIT, RESEARCH_PENDING_LIMIT]);
    const second = await sweepResearchIndex(f.env, new Date('2026-11-10T11:01:00Z'));
    assert.deepEqual([second.pending_scanned, second.pending_enqueued, jobs(f).length], [5, 5, RESEARCH_PENDING_LIMIT + 5]);
  } finally { f.close(); }
});

test('attempts from the last successful revision do not shorten a later manual re-index', async () => {
  // Mutation checked: summing the document's lifetime jobs marks this fresh pending run failed immediately.
  const f = fixture();
  try {
    f.document(1, 'pending', OLD, '2026-11-01 09:00:00.000');
    f.db.prepare(`INSERT INTO queue_jobs
      (job_type, payload, status, attempts, max_retries, created_at, updated_at, completed_at)
      VALUES ('embed_entity', ?, 'completed', 3, 3, '2026-11-01 08:00:00', '2026-11-01 09:00:00', '2026-11-01 09:00:00')`)
      .run(JSON.stringify({ type: 'research_doc', id: 1 }));
    const result = await sweepResearchIndex(f.env, NOW);
    const row = f.db.prepare('SELECT index_state FROM research_documents WHERE id = 1').get() as any;
    assert.deepEqual([result.pending_enqueued, result.pending_failed, row.index_state], [1, 0, 'pending']);
    assert.equal(jobs(f).at(-1).max_retries, 3, 'the new run receives its own three-attempt window');
  } finally { f.close(); }
});

test('a pre-D4605 vector is upgraded once to a revision and whole passage while a current row is left alone', async () => {
  // Mutations checked: treating every indexed row as legacy queues doc 101; omitting `passage` leaves the upgraded vector preview-only.
  const f = fixture();
  try {
    const revision = '2026-11-09 09:00:00.000';
    f.document(100, 'indexed', OLD, '2026-10-01 09:00:00');
    f.document(101, 'indexed', OLD, revision);
    f.vectors.set('research_doc:100:0', { id: 'research_doc:100:0', values: [], metadata: { type: 'research_doc', entity_id: 100, snippet: 'short legacy preview' } });
    f.vectors.set('research_doc:101:0', { id: 'research_doc:101:0', values: [], metadata: { type: 'research_doc', entity_id: 101, snippet: 'short', passage: 'whole', revision } });
    const upgraded = await sweepResearchIndex(f.env, NOW);
    assert.deepEqual([upgraded.legacy_scanned, upgraded.legacy_enqueued, upgraded.legacy_done], [2, 1, true]);
    assert.deepEqual(jobs(f).map((job) => JSON.parse(job.payload).id), [100]);
    assert.equal((f.db.prepare('SELECT index_state FROM research_documents WHERE id = 101').get() as any).index_state, 'indexed');

    assert.equal(await embedAndUpsertById(f.env, 'research_doc' as any, 100), true);
    const row = f.db.prepare('SELECT index_state, indexed_at FROM research_documents WHERE id = 100').get() as any;
    const vector = f.vectors.get('research_doc:100:0');
    assert.equal(row.index_state, 'indexed');
    assert.equal(vector.metadata.revision, row.indexed_at);
    assert.match(vector.metadata.passage, /whole passage survives/);
    const again = await sweepResearchIndex(f.env, new Date('2026-11-10T11:00:00Z'));
    assert.deepEqual([again.legacy_scanned, jobs(f).length], [0, 1], 'the one-time cursor does not enqueue the upgraded row again');
  } finally { f.close(); }
});

test('legacy discovery advances in fixed batches until no pre-D4605 row remains', async () => {
  // Mutation checked: removing the legacy LIMIT queues all 25 rows in one tick; not advancing the cursor repeats the first 20.
  const f = fixture();
  try {
    for (let id = 1; id <= RESEARCH_LEGACY_LIMIT + 5; id += 1) {
      f.document(id, 'indexed', OLD, '2026-10-01 09:00:00');
      f.vectors.set(`research_doc:${id}:0`, { id: `research_doc:${id}:0`, values: [], metadata: { type: 'research_doc', entity_id: id, snippet: 'legacy' } });
    }
    const first = await sweepResearchIndex(f.env, NOW);
    assert.deepEqual([first.legacy_scanned, first.legacy_enqueued, first.legacy_done], [RESEARCH_LEGACY_LIMIT, RESEARCH_LEGACY_LIMIT, false]);
    const second = await sweepResearchIndex(f.env, new Date('2026-11-10T11:00:00Z'));
    assert.deepEqual([second.legacy_scanned, second.legacy_enqueued, second.legacy_done], [5, 5, true]);
    assert.equal(jobs(f).length, RESEARCH_LEGACY_LIMIT + 5);
  } finally { f.close(); }
});
