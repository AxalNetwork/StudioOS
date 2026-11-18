/**
 * Signals live pipeline — parsers, ingestion gates, and honesty invariants.
 *
 * The adapters' fetch halves hit free public APIs; their parse halves are pure
 * (JSON in → EvidenceItem[] out) and are pinned here against realistic fixture
 * payloads shaped like each API's documented response. No network involved.
 *
 * Run with:
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/signals_pipeline.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseAlgoliaStories,
  parseAlgoliaHiringComments,
  parseStackExchangeQuestions,
  parseGithubRepoSearch,
  parseFederalRegisterDocs,
  parseEdgarFullText,
  sourceDisabled,
  EVIDENCE_ADAPTERS,
} from '../src/services/signals/adapters';
import {
  deriveQueries,
  dedupeEvidence,
  meetsThreshold,
  MIN_EVIDENCE_ITEMS,
  MIN_EVIDENCE_KINDS,
} from '../src/services/signals/ingest';
import { getSeedSignals, SEED_ANCHOR } from '../src/services/signals/seed';
import { getRankedSignals, SignalsUnreadableError } from '../src/services/signals/engine';
import { SOURCE_REGISTRY } from '../src/services/signals/sources';
import { rankedSignalsResponse } from '../src/routes/signals';
import { EVIDENCE_KINDS } from '../src/services/signals/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- parsers

test('parseAlgoliaStories: maps hits, thresholds points, real URLs + timestamps', () => {
  const items = parseAlgoliaStories({
    hits: [
      { objectID: '1', title: 'Compliance tooling thread', url: 'https://example.com/a', points: 42, num_comments: 17, created_at: '2026-08-01T10:00:00Z' },
      { objectID: '2', title: 'Low-signal post', points: 1, created_at: '2026-08-02T10:00:00Z' }, // below threshold
      { objectID: '3', title: 'Ask HN: no external url', points: 12, num_comments: 3, created_at: '2026-08-03T10:00:00Z' },
      { objectID: '4', title: '', points: 99, created_at: '2026-08-04T10:00:00Z' }, // no title
    ],
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, 'discussion');
  assert.equal(items[0].url, 'https://example.com/a');
  assert.equal(items[0].observed_at, '2026-08-01T10:00:00.000Z');
  assert.match(items[0].detail!, /42 points · 17 comments/);
  // A story without an external url links to its HN item page, never nowhere.
  assert.equal(items[1].url, 'https://news.ycombinator.com/item?id=3');
});

test('parseAlgoliaHiringComments: only who-is-hiring comments qualify, HTML stripped', () => {
  const items = parseAlgoliaHiringComments({
    hits: [
      { objectID: '10', story_title: 'Ask HN: Who is hiring? (August 2026)', comment_text: '<p>Acme Corp | Platform engineer | Remote | We automate compliance evidence collection for audits and more</p>', created_at: '2026-08-02T00:00:00Z' },
      { objectID: '11', story_title: 'Some unrelated thread', comment_text: 'We are hiring too but this thread does not count for the proxy at all', created_at: '2026-08-02T00:00:00Z' },
      { objectID: '12', story_title: 'Ask HN: Who is hiring? (August 2026)', comment_text: 'short', created_at: '2026-08-02T00:00:00Z' },
    ],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'hiring');
  assert.ok(!items[0].title.includes('<p>'), 'HTML must be stripped');
  assert.equal(items[0].url, 'https://news.ycombinator.com/item?id=10');
});

test('parseStackExchangeQuestions: epoch seconds → ISO, accepted-answer gap surfaced', () => {
  const items = parseStackExchangeQuestions({
    items: [
      { title: 'How to automate audit evidence in Terraform?', link: 'https://stackoverflow.com/q/1', score: 14, answer_count: 3, is_answered: false, creation_date: 1754006400 },
      { title: 'Entity &amp; encoding &#39;test&#39;', link: 'https://stackoverflow.com/q/2', score: 2, answer_count: 1, is_answered: true, creation_date: 1754006400 },
    ],
  });
  assert.equal(items.length, 2);
  assert.match(items[0].detail!, /no accepted answer/);
  assert.ok(!/no accepted answer/.test(items[1].detail!));
  assert.equal(items[1].title, "Entity & encoding 'test'");
  assert.equal(items[0].observed_at, new Date(1754006400 * 1000).toISOString());
});

test('parseGithubRepoSearch: pushed_at drives recency; stars never surface', () => {
  const items = parseGithubRepoSearch({
    items: [
      { full_name: 'acme/evidence-collector', description: 'Collects audit evidence', html_url: 'https://github.com/acme/evidence-collector', pushed_at: '2026-07-30T12:00:00Z', open_issues_count: 8, stargazers_count: 99999 },
      { full_name: '', pushed_at: '2026-07-30T12:00:00Z' }, // nameless → dropped
    ],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'developer');
  assert.ok(!JSON.stringify(items[0]).includes('99999'), 'star counts are vanity metrics and must not surface');
  assert.match(items[0].detail!, /8 open issues/);
});

test('parseFederalRegisterDocs: rulemaking docs → filing evidence with agencies', () => {
  const items = parseFederalRegisterDocs({
    results: [
      { title: 'Cybersecurity Incident Reporting Requirements', type: 'Rule', html_url: 'https://www.federalregister.gov/d/1', publication_date: '2026-07-15', agencies: [{ name: 'Securities and Exchange Commission' }] },
    ],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'filing');
  assert.equal(items[0].source_key, 'federal_register');
  assert.match(items[0].detail!, /Rule · Securities and Exchange Commission/);
  assert.equal(items[0].observed_at.slice(0, 10), '2026-07-15');
});

test('parseEdgarFullText: filings map with cleaned display names', () => {
  const items = parseEdgarFullText({
    hits: { hits: [
      { _source: { display_names: ['Acme Corp  (ACME)  (CIK 0000123456)'], file_type: '10-K', file_date: '2026-06-30' } },
      { _source: { display_names: [], file_date: '2026-06-30' } }, // nameless → dropped
    ] },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].source_key, 'sec_edgar');
  assert.ok(!items[0].title.includes('CIK'), 'CIK noise stripped from the display name');
  assert.match(items[0].title, /10-K/);
});

test('parsers: garbage and empty payloads return [], never throw or invent', () => {
  for (const p of [parseAlgoliaStories, parseAlgoliaHiringComments, parseStackExchangeQuestions, parseGithubRepoSearch, parseFederalRegisterDocs, parseEdgarFullText]) {
    assert.deepEqual(p(null), []);
    assert.deepEqual(p({}), []);
    assert.deepEqual(p('nonsense'), []);
  }
});

// ---------------------------------------------------------------- registry

test('every evidence adapter is registered with a real source + valid kind', () => {
  const keys = new Set(SOURCE_REGISTRY.map((s) => s.key));
  for (const a of EVIDENCE_ADAPTERS) {
    assert.ok(keys.has(a.source.key), `${a.source.key} missing from SOURCE_REGISTRY`);
    assert.ok((EVIDENCE_KINDS as readonly string[]).includes(a.source.kind));
    assert.equal(typeof a.fetchEvidence, 'function');
  }
});

test('sourceDisabled: SIGNALS_SOURCES_OFF disables listed sources only', () => {
  const env: any = { SIGNALS_SOURCES_OFF: 'github_activity, hn_discussion' };
  assert.equal(sourceDisabled(env, 'github_activity'), true);
  assert.equal(sourceDisabled(env, 'hn_discussion'), true);
  assert.equal(sourceDisabled(env, 'sec_edgar'), false);
  assert.equal(sourceDisabled({} as any, 'github_activity'), false);
});

// ---------------------------------------------------------------- ingest gates

test('deriveQueries: niche leads, tags widen, capped and deduped', () => {
  const qs = deriveQueries({ niche: 'SMB credit infrastructure', sector: 'Financial Services', tags: ['smb credit infrastructure', 'credit'] });
  assert.equal(qs[0], 'SMB credit infrastructure');
  assert.ok(qs.length <= 3);
  assert.equal(new Set(qs.map((q) => q.toLowerCase())).size, qs.length, 'no case-insensitive duplicates');
});

test('dedupeEvidence: same URL twice keeps one; distinct URLs survive', () => {
  const mk = (url: string, title = 't'): any => ({ kind: 'news', title, source_key: 'news_rss', url, observed_at: '2026-08-01T00:00:00Z' });
  const out = dedupeEvidence([mk('https://a/x'), mk('https://a/x/'), mk('https://a/y'), { ...mk(''), title: 'no-url', url: undefined }]);
  assert.equal(out.length, 3);
});

test('meetsThreshold: needs both enough items AND multiple independent kinds', () => {
  const item = (kind: string): any => ({ kind, title: 't', source_key: 's', observed_at: '2026-08-01T00:00:00Z' });
  // Plenty of items, one kind → held. Single-family evidence is not a trend.
  assert.equal(meetsThreshold(Array.from({ length: 6 }, () => item('news'))), false);
  // Two kinds but too few records → held.
  assert.equal(meetsThreshold([item('news'), item('filing')]), false);
  // Two kinds, enough records → promoted.
  assert.equal(meetsThreshold([item('news'), item('news'), item('filing'), item('discussion')]), true);
  assert.ok(MIN_EVIDENCE_ITEMS >= 3 && MIN_EVIDENCE_KINDS >= 2, 'thresholds must not be quietly weakened');
});

// ---------------------------------------------------------------- honesty

test('seed timestamps are anchored — Date.now() must not appear in seed.ts', () => {
  const src = readFileSync(resolve(__dirname, '../src/services/signals/seed.ts'), 'utf8');
  assert.ok(!src.includes('Date.now()'), 'seed evidence must age from a fixed anchor, never recompute to look fresh');
  assert.ok(src.includes('SEED_ANCHOR'), 'anchor constant missing');
  assert.ok(Number.isFinite(Date.parse(SEED_ANCHOR)));
  for (const s of getSeedSignals()) {
    for (const e of s.evidence_items) {
      assert.ok(Date.parse(e.observed_at) <= Date.parse(SEED_ANCHOR), `${s.id} evidence postdates the anchor`);
    }
  }
});

// ---------------------------------------------------------------- read states (D7173)
//
// The single fallback test that stood here used an env where every `prepare`
// threw, and so locked in the example set for ANY error. D7173 splits it: a
// missing table (or a store no ingest ever wrote) is illustrative; any other
// D1 error is 503 `signals_unreadable` and writes nothing to KV; an ingested
// store with no active signal is live and empty; evidence that cannot be read
// is `evidence_state: 'unavailable'` with confidence null.

type Answer = any[] | Error;
/** A D1 stub that answers by the first matching SQL fragment; unmatched SQL answers []. */
function fakeEnv(answers: Array<[RegExp, Answer]>, puts: string[] = []): any {
  const answer = (sql: string) => {
    const hit = answers.find(([re]) => re.test(sql));
    const a = hit ? hit[1] : [];
    if (a instanceof Error) throw a;
    return { results: a };
  };
  const stmt = (sql: string) => ({
    bind: () => stmt(sql),
    all: async () => answer(sql),
  });
  return {
    DB: { prepare: (sql: string) => stmt(sql) },
    RATE_LIMITS: { get: async () => null, put: async (k: string) => { puts.push(k); } },
  };
}
const missing = () => new Error('D1_ERROR: no such table: signals: SQLITE_ERROR');
const broken = () => new Error('D1_ERROR: Network connection lost.');

const LIVE_ROW = {
  id: 'sig-live-1', type: 'workflow_digitization', title: 'Live signal', thesis: 't', why_now: 'because',
  region: 'Europe', country: 'Germany', sector: 'Energy storage', niche: 'n', market_cap_band: 'small',
  target_customers: '[]', confidence_score: 70, freshness_score: 50, tags: '[]', status: 'active',
  updated_at: '2026-11-10T00:00:00Z',
};
const EVIDENCE = [
  { id: 'e1', signal_id: 'sig-live-1', kind: 'filing', title: 'A filing', source_key: 'sec_edgar', url: 'https://example.com/f', observed_at: '2026-11-01T00:00:00Z' },
  { id: 'e2', signal_id: 'sig-live-1', kind: 'news', title: 'A story', source_key: 'news_rss', url: null, observed_at: '2026-11-05T00:00:00Z' },
];

test('engine: missing tables → LABELED illustrative, the example corpus still renders', async () => {
  const res = await getRankedSignals(fakeEnv([[/./, missing()]]), { mode: 'founder' } as any);
  assert.equal(res.data_state, 'illustrative');
  assert.ok(res.signals.length > 0);
});

test('engine: tables present but no ingest ever wrote a signal → illustrative', async () => {
  const res = await getRankedSignals(fakeEnv([[/FROM signals/, []]]), { mode: 'founder' } as any);
  assert.equal(res.data_state, 'illustrative');
  assert.ok(res.signals.length > 0);
});

test('engine: any other D1 error is unreadable — never examples, nothing cached', async () => {
  const puts: string[] = [];
  await assert.rejects(
    getRankedSignals(fakeEnv([[/WHERE status = 'active'/, broken()]], puts), { mode: 'founder' } as any),
    (e: any) => e instanceof SignalsUnreadableError,
  );
  assert.deepEqual(puts, [], 'a failed read must not be written to KV');
  // The probe that tells live-empty from never-ingested failing is a failed read too.
  await assert.rejects(
    getRankedSignals(fakeEnv([[/WHERE status = 'active'/, []], [/LIMIT 1/, broken()]], puts), { mode: 'founder' } as any),
    (e: any) => e instanceof SignalsUnreadableError,
  );
  // So is the company roster the rank reads.
  await assert.rejects(
    getRankedSignals(fakeEnv([[/FROM signal_companies/, broken()], [/WHERE status = 'active'/, [LIVE_ROW]]], puts), { mode: 'founder' } as any),
    (e: any) => e instanceof SignalsUnreadableError,
  );
  assert.deepEqual(puts, []);
});

test('engine: ingested store with no active signal → live with none, not examples', async () => {
  const res = await getRankedSignals(
    fakeEnv([[/WHERE status = 'active'/, []], [/LIMIT 1/, [{ one: 1 }]]]),
    { mode: 'founder' } as any,
  );
  assert.equal(res.data_state, 'live');
  assert.deepEqual(res.signals, []);
  assert.equal(res.total, 0);
});

test('engine: a live store fully filtered out → live with none', async () => {
  const res = await getRankedSignals(
    fakeEnv([[/WHERE status = 'active'/, [LIVE_ROW]], [/FROM signal_evidence/, EVIDENCE]]),
    { mode: 'founder', sector: 'Nothing like it' } as any,
  );
  assert.equal(res.data_state, 'live');
  assert.equal(res.total, 0);
  assert.deepEqual(res.signals, []);
});

test('engine: live rows carry evidence, a 0–100 confidence and evidence_state recorded', async () => {
  const puts: string[] = [];
  const res = await getRankedSignals(
    fakeEnv([[/WHERE status = 'active'/, [LIVE_ROW]], [/FROM signal_evidence/, EVIDENCE]], puts),
    { mode: 'founder' } as any,
  );
  assert.equal(res.data_state, 'live');
  const s = res.signals[0];
  assert.equal(s.evidence_state, 'recorded');
  assert.equal(s.evidence_items.length, 2);
  assert.equal(s.evidence_items[1].url, undefined, 'a null URL stays absent, never a dead link');
  assert.ok(Number.isInteger(s.confidence_score) && s.confidence_score! > 1 && s.confidence_score! <= 100, `confidence ${s.confidence_score} is on the 0–100 scale`);
  assert.equal(puts.length, 1, 'a whole read is cached');
});

test('engine: evidence read failing → evidence_state unavailable, confidence null, not cached', async () => {
  const puts: string[] = [];
  const res = await getRankedSignals(
    fakeEnv([[/WHERE status = 'active'/, [LIVE_ROW]], [/FROM signal_evidence/, broken()]], puts),
    { mode: 'advisor' } as any,
  );
  assert.equal(res.data_state, 'live');
  const s = res.signals[0];
  assert.equal(s.evidence_state, 'unavailable');
  assert.equal(s.confidence_score, null, 'unknown, never 0');
  assert.deepEqual(s.evidence_items, []);
  assert.deepEqual(puts, [], 'a partial read is not cached');
});

test('route: GET /api/signals answers 503 signals_unreadable on a failed read, 200 otherwise', async () => {
  const ctx = (env: any) => ({ env, json: (body: any, status = 200) => ({ body, status }) });
  const errLog = console.error;
  console.error = () => {};
  try {
    const failed: any = await rankedSignalsResponse(ctx(fakeEnv([[/WHERE status = 'active'/, broken()]])), { mode: 'founder' } as any);
    assert.equal(failed.status, 503);
    assert.equal(failed.body.error, 'signals_unreadable');
    assert.ok(!('signals' in failed.body), 'no example set rides along with the refusal');
    assert.doesNotMatch(failed.body.message, /Network connection lost/, 'the raw D1 text is logged, never sent');
  } finally {
    console.error = errLog;
  }
  const ok: any = await rankedSignalsResponse(ctx(fakeEnv([[/./, missing()]])), { mode: 'founder' } as any);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data_state, 'illustrative');
});

// 'engine: kpis report last_refreshed_at null before any ingestion' stood
// here. The KPI strip and `getKpis` were retired with the /signals page (D670).
