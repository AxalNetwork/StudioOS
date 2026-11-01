/**
 * D1556 (#3803) — retrieval of consented interview quotes, on SQLite (the
 * baseline and every migration) with an in-memory stand-in for the
 * `axal-deck-quotes` index, the embedder and the reranker.
 *
 *   1. Only consented sessions are indexed: recorded consent to record, the
 *      interview's consent to quote, the final transcript, the interviewee's
 *      own lines. Indexing deletes a vector whose consent was withdrawn.
 *   2. No other venture is returned, even from an index that ignored its
 *      filter: every hit is re-checked in D1.
 *   3. The reranker orders the quotes; each carries its role, never a name,
 *      and its session provenance.
 *   4. Nothing to quote, or no index, is a block with its reason, never an
 *      invented quote.
 *   5. The route: the deck gate, the refusals, and "not switched on yet"
 *      while the owner has not approved the index.
 *   6. The two models are the catalogue's, reached through the module tasks.
 *
 * Every name and line is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckQuotes from '../src/routes/deck_quotes.ts';
import {
  QUOTE_DIMENSIONS, QUOTE_EMBED_MODEL, QUOTE_RERANK_MODEL, REASONS,
  indexProjectQuotes, quotableLines, retrieveQuotes, vectorId, type QuoteDeps, type QuoteIndex,
} from '../src/services/decks/quoteRetrieval.ts';
import { modelById } from '../src/services/ai/catalogue.ts';
import { MODULE_ROUTES } from '../src/services/ai/moduleConnections.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d1556-deck-quotes-0123456789-abcdef';
const OWNER = 1, OTHER = 5;
const PID = 7, OTHER_PID = 8;

// Segment ids, by what makes each one quotable or not.
const S = {
  ok_pain: 101, ok_price: 102, ok_named_role: 103,
  founder_line: 104, unknown_speaker: 105, live_draft: 106, too_short: 107,
  no_record_consent: 108, declined: 109, no_quote_consent: 110, quote_declined: 111,
  other_venture: 112,
};

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) {
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Synthetic Founder', 'f@example.test'), (11, 'Synthetic Other', 'o@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES
      (${OWNER}, 'owner@example.test', 'Synthetic Owner', 'founder', 10),
      (${OTHER}, 'other@example.test', 'Synthetic Other Founder', 'founder', 11);
    INSERT INTO projects (id, name, founder_id) VALUES (${PID}, 'Synthetic venture', 10), (${OTHER_PID}, 'Synthetic other venture', 11);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${PID}, ${OWNER}, 'owner', 'accepted');`);
  // Interviews: id, project, name, role, quote_consent.
  const iv = db.prepare(`INSERT INTO discovery_interviews (id, project_id, interviewee_name, interviewee_role, interviewee_company, interview_date, quote_consent, stage)
    VALUES (?, ?, ?, ?, 'Synthetic Freight Co', '2026-10-01', ?, 'done')`);
  iv.run(1, PID, 'Rowan Synth', 'Head of Operations', 1);
  iv.run(2, PID, 'Sky Synth', null, 1);
  iv.run(3, PID, 'Tam Synth', 'Controller', null);
  iv.run(4, PID, 'Uma Synth', 'CFO', 0);
  iv.run(5, OTHER_PID, 'Vic Synth', 'COO', 1);
  // Sessions: id, interview, project, consent_status, consent_at.
  const ss = db.prepare(`INSERT INTO interview_sessions (id, uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, consent_at)
    VALUES (?, ?, ?, ?, ${OWNER}, 'video', 'reviewed', ?, ?)`);
  ss.run(11, 'sess-ok', 1, PID, 'given', '2026-10-01 10:00:00');
  ss.run(12, 'sess-noat', 1, PID, 'given', null);
  ss.run(13, 'sess-declined', 1, PID, 'declined', null);
  ss.run(14, 'sess-role-missing', 2, PID, 'given', '2026-10-02 10:00:00');
  ss.run(15, 'sess-no-quote', 3, PID, 'given', '2026-10-03 10:00:00');
  ss.run(16, 'sess-quote-declined', 4, PID, 'given', '2026-10-04 10:00:00');
  ss.run(17, 'sess-other', 5, OTHER_PID, 'given', '2026-10-05 10:00:00');
  const seg = db.prepare(`INSERT INTO interview_transcript_segments (id, session_id, source, start_ms, end_ms, speaker_label, text) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  seg.run(S.ok_pain, 11, 'final', 1000, 9000, 'Rowan Synth', 'We reconcile every freight invoice by hand and it takes two days each month.');
  seg.run(S.ok_price, 11, 'final', 9000, 15000, 'Rowan Synth', 'We would pay for anything that removes the invoice matching from our month end.');
  seg.run(S.ok_named_role, 14, 'final', 0, 5000, 'Interviewee', 'Our invoice disputes take weeks because nobody trusts the spreadsheet.');
  seg.run(S.founder_line, 11, 'final', 15000, 17000, 'Me', 'So how long does the invoice reconciliation take you today?');
  seg.run(S.unknown_speaker, 11, 'final', 17000, 19000, 'Speaker ?', 'The invoice team is three people and they are always behind.');
  seg.run(S.live_draft, 11, 'live', 1000, 9000, 'Rowan Synth', 'We reconcile every freight invoice by hand, the live draft.');
  seg.run(S.too_short, 11, 'final', 19000, 20000, 'Rowan Synth', 'Invoices. Yes.');
  seg.run(S.no_record_consent, 12, 'final', 0, 5000, 'Rowan Synth', 'This invoice line was said in a session with no consent time.');
  seg.run(S.declined, 13, 'final', 0, 5000, 'Rowan Synth', 'This invoice line was said in a session that declined recording.');
  seg.run(S.no_quote_consent, 15, 'final', 0, 5000, 'Tam Synth', 'This invoice line comes from an interview never asked to be quoted.');
  seg.run(S.quote_declined, 16, 'final', 0, 5000, 'Uma Synth', 'This invoice line comes from an interview that declined quotes.');
  seg.run(S.other_venture, 17, 'final', 0, 5000, 'Vic Synth', 'Another venture invoice line that must never be returned here.');
  return db;
}

/** A deterministic 1024-dimension "embedding": word buckets. */
function embedOf(text: string): number[] {
  const v = new Array(QUOTE_DIMENSIONS).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % QUOTE_DIMENSIONS;
    v[h] += 1;
  }
  return v;
}
const cos = (a: number[], b: number[]) => {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i += 1) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? d / Math.sqrt(x * y) : 0;
};

/** An in-memory index. `leaky` ignores the filter, as a misconfigured metadata index would. */
function fakeIndex(opts: { leaky?: boolean } = {}) {
  const vectors = new Map<string, { values: number[]; metadata: Record<string, number> }>();
  const calls = { filters: [] as Array<Record<string, number>>, deleted: [] as string[] };
  const index: QuoteIndex = {
    async upsert(list) { for (const v of list) vectors.set(v.id, { values: v.values, metadata: v.metadata }); },
    async deleteByIds(ids) { for (const id of ids) { vectors.delete(id); calls.deleted.push(id); } },
    async query(vector, q) {
      calls.filters.push(q.filter);
      const matches = [...vectors.entries()]
        .filter(([, v]) => opts.leaky || Object.entries(q.filter).every(([k, val]) => v.metadata[k] === val))
        .map(([id, v]) => ({ id, score: cos(vector, v.values) }))
        .sort((a, b) => b.score - a.score).slice(0, q.topK);
      return { matches };
    },
  };
  return { index, vectors, calls };
}

/** The reranker stand-in scores by how many query words a line shares, plus a tiebreak it controls. */
function deps(index: QuoteIndex | null, boost: Record<string, number> = {}): QuoteDeps & { reranked: string[][] } {
  const reranked: string[][] = [];
  return {
    index,
    reranked,
    async embed(text) { return embedOf(text); },
    async rerank(query, contexts) {
      reranked.push(contexts);
      const words = new Set(query.toLowerCase().match(/[a-z]+/g) ?? []);
      return contexts.map((c, index) => ({
        index,
        score: (c.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => words.has(w)).length + (Object.entries(boost).find(([k]) => c.includes(k))?.[1] ?? 0),
      }));
    },
  };
}

const env = (db: any, extra: Record<string, unknown> = {}) => ({ DB: d1Over(db), ...extra }) as any;
const segIds = (ids: Iterable<string>) => [...ids].map((id) => Number(id.split(':')[1])).sort((a, b) => a - b);

test('D1556: only consented sessions are indexed, and a withdrawn consent loses its vector', async () => {
  const db = fixture();
  const lines = await quotableLines(env(db), PID);
  assert.deepEqual(lines.map((l) => Number(l.segment_id)).sort((a, b) => a - b), [S.ok_pain, S.ok_price, S.ok_named_role]);

  const fake = fakeIndex();
  // A vector left from before: a declined session's line, as if indexed when consent was given.
  await fake.index.upsert([{ id: vectorId(S.declined), values: embedOf('invoice'), metadata: { project_id: PID, segment_id: S.declined } }]);
  const out = await indexProjectQuotes(env(db), PID, deps(fake.index));
  assert.equal(out.available, true);
  assert.deepEqual(segIds(fake.vectors.keys()), [S.ok_pain, S.ok_price, S.ok_named_role]);
  assert.ok(fake.calls.deleted.includes(vectorId(S.declined)));
  for (const v of fake.vectors.values()) assert.equal(v.metadata.project_id, PID);
  assert.equal((out as any).value.indexed, 3);

  // Consent to quote withdrawn: the next index removes both of that interview's lines.
  db.prepare('UPDATE discovery_interviews SET quote_consent = 0 WHERE id = 1').run();
  await indexProjectQuotes(env(db), PID, deps(fake.index));
  assert.deepEqual(segIds(fake.vectors.keys()), [S.ok_named_role]);
});

test('D1556: no other venture is returned, even from an index that ignored its filter', async () => {
  const db = fixture();
  const fake = fakeIndex({ leaky: true });
  await indexProjectQuotes(env(db), PID, deps(fake.index));
  await indexProjectQuotes(env(db), OTHER_PID, deps(fake.index));
  assert.ok(fake.vectors.has(vectorId(S.other_venture)), 'the other venture is in the shared index');
  // And a stale vector of an unconsented line of this venture, never re-indexed.
  fake.vectors.set(vectorId(S.no_quote_consent), { values: embedOf('invoice'), metadata: { project_id: PID, segment_id: S.no_quote_consent } });

  const got = await retrieveQuotes(env(db), PID, 'freight invoice', deps(fake.index), 10);
  assert.equal(got.available, true);
  const ids = (got as any).value.map((q: any) => q.provenance.segment_id).sort((a: number, b: number) => a - b);
  assert.deepEqual(ids, [S.ok_pain, S.ok_price, S.ok_named_role]);
  assert.deepEqual(fake.calls.filters.at(-1), { project_id: PID });
  // Only the index's hits come back: a quotable line the index did not return is not added.
  const one = fakeIndex();
  await one.index.upsert([{ id: vectorId(S.ok_pain), values: embedOf('freight invoice'), metadata: { project_id: PID, segment_id: S.ok_pain } }]);
  const only = await retrieveQuotes(env(db), PID, 'freight invoice', deps(one.index), 10);
  assert.deepEqual((only as any).value.map((q: any) => q.provenance.segment_id), [S.ok_pain]);
  const other = await retrieveQuotes(env(db), OTHER_PID, 'freight invoice', deps(fake.index), 10);
  assert.deepEqual((other as any).value.map((q: any) => q.provenance.segment_id), [S.other_venture]);
});

test('D1556: the reranker orders the quotes; each carries its role and session, never a name', async () => {
  const db = fixture();
  const fake = fakeIndex();
  await indexProjectQuotes(env(db), PID, deps(fake.index));
  // The reranker prefers a line that is neither first in the index nor first in D1's order.
  const d = deps(fake.index, { 'pay for anything': 100 });
  const got = await retrieveQuotes(env(db), PID, 'invoice month', d, 2);
  assert.equal(got.available, true);
  const quotes = (got as any).value;
  assert.equal(quotes.length, 2, 'the limit holds');
  assert.equal(quotes[0].provenance.segment_id, S.ok_price, 'the reranker\'s order, not the index\'s');
  assert.equal(d.reranked.length, 1);
  const all = (await retrieveQuotes(env(db), PID, 'invoice disputes', deps(fake.index), 10) as any).value;
  const unnamed = all.find((q: any) => q.provenance.segment_id === S.ok_named_role);
  assert.equal(unnamed.attribution, 'Interviewee');
  assert.equal(unnamed.role_recorded, false);
  const rowan = all.find((q: any) => q.provenance.session_uid === 'sess-ok');
  assert.equal(rowan.attribution, 'Head of Operations');
  assert.equal(rowan.provenance.consent, 'given');
  assert.equal(rowan.provenance.interview_id, 1);
  assert.equal(rowan.provenance.held_on, '2026-10-01');
  const text = JSON.stringify([got, all]);
  for (const leak of ['Rowan', 'Sky Synth', 'Synthetic Freight Co', 'Speaker ?']) assert.ok(!text.includes(leak), leak);
});

test('D1556: nothing to quote, or no index, is a block with its reason, never an invented quote', async () => {
  const db = fixture();
  assert.deepEqual(await retrieveQuotes(env(db), PID, 'invoice', deps(null)), { available: false, reason: REASONS.not_set_up });
  assert.deepEqual(await indexProjectQuotes(env(db), PID, deps(null)), { available: false, reason: REASONS.not_set_up });
  const fake = fakeIndex();
  assert.deepEqual(await retrieveQuotes(env(db), PID, 'invoice', deps(fake.index)), { available: false, reason: REASONS.no_quote }, 'nothing indexed yet');
  await indexProjectQuotes(env(db), PID, deps(fake.index));
  db.exec("UPDATE interview_sessions SET consent_status = 'declined' WHERE project_id = 7");
  assert.deepEqual(await retrieveQuotes(env(db), PID, 'invoice', deps(fake.index)), { available: false, reason: REASONS.no_quote }, 'consent withdrawn after indexing');
  const broken = { ...deps(fake.index), async rerank() { return null; } };
  db.exec("UPDATE interview_sessions SET consent_status = 'given' WHERE project_id = 7");
  assert.deepEqual(await retrieveQuotes(env(db), PID, 'invoice', broken), { available: false, reason: REASONS.unreadable });
});

async function call(db: any, who: number | null, path: string, body: unknown, extra: Record<string, unknown> = {}) {
  const app = new Hono<any>().route('/api/decks', deckQuotes);
  app.onError((err: any, c: any) => c.json({ error: err?.message === 'Unauthorized' ? 'unauthorized' : 'error' }, err?.message === 'Unauthorized' ? 401 : 500));
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (who) h.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extra } as any, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('D1556: the route keeps the deck gate and says "not switched on yet" without the index', async () => {
  const db = fixture();
  const off = await call(db, OWNER, '/api/decks/quotes/search', { project_id: PID, query: 'invoice' });
  assert.equal(off.status, 200);
  assert.deepEqual(off.body.quotes, { available: false, reason: REASONS.not_set_up });
  assert.deepEqual((await call(db, OWNER, '/api/decks/quotes/index', { project_id: PID })).body.index, { available: false, reason: REASONS.not_set_up });
  assert.equal((await call(db, OWNER, '/api/decks/quotes/search', { project_id: PID, query: '  ' })).body.error, 'query_required');
  assert.equal((await call(db, OWNER, '/api/decks/quotes/search', { query: 'invoice' })).body.error, 'project_id_required');
  assert.equal((await call(db, OTHER, '/api/decks/quotes/search', { project_id: PID, query: 'invoice' })).status, 403);
  assert.equal((await call(db, OTHER, '/api/decks/quotes/index', { project_id: PID })).status, 403);
  assert.equal((await call(db, null, '/api/decks/quotes/search', { project_id: PID, query: 'invoice' })).status, 401);
});

test('D1556: the two models are the catalogue\'s, reached through the module tasks', () => {
  assert.equal(modelById(QUOTE_EMBED_MODEL)?.kind, 'Text Embeddings');
  assert.equal(modelById(QUOTE_RERANK_MODEL)?.name, 'bge-reranker-base');
  assert.ok((MODULE_ROUTES as any).module_embed.alternates.includes(QUOTE_EMBED_MODEL));
  assert.ok((MODULE_ROUTES as any).module_rerank.alternates.includes(QUOTE_RERANK_MODEL));
});
