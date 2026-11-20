/**
 * D5867 (#5867, part 3 of #2401) — the TikTok audience fact for Share an update, the Overview reach line, and the
 * daily sync, on the Grow world Mercury's tests use (`_mercury_grow_fixture.ts`): real SQL on node:sqlite. TikTok is
 * a stub of the client's two reads; every name, id and figure is invented.
 *
 *  1. The audience fact: from the count before the period to its last, with "TikTok · followers, as of <date>".
 *  2. No count in the period: no audience fact and no draft from it. Never 0.
 *  3. The reach line: this month's posts with a view count, beside the funnel and never in it; none, no line.
 *  4. The daily sync lands through part 2a's sync, once a day per connection, and writes no KPI.
 *  5. It skips a connection with no enabled company, a revoked or errored one, an unlinked one, a switched-off venture.
 *  6. A fact the founder deleted is not re-created; one failed connection does not stop the pass; logs carry counts.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/tiktok_part3_5867.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { audienceFact, draftLines, parseDraft, periodFacts, periodFollowers, buildMetrics } from '../src/services/updateShare.ts';
import { distributionCard, tiktokReach } from '../src/services/growCycle.ts';
import { syncAllTiktokIntegrations } from '../src/services/tiktok/daily.ts';
import { deleteTikTokRow } from '../src/services/tiktok/grow.ts';
import { TikTokReadError, type TikTokReads } from '../src/services/tiktok/client.ts';
import { CARDS } from '../../frontend/src/pages/cycles/adapters/grow.js';
import { FOUNDER, PID, growDb } from './_mercury_grow_fixture.ts';

const TT = 61;
const COMPANY = 70;
const M = 'cloudflare-worker/sql/migrations';
const MIGRATION = readdirSync(M).find((f) => /^\d{12}_5863_tiktok_grow_facts\.sql$/.test(f))!;
// D5614: fixed instants, passed in; nothing here reads the wall clock.
const DAY1 = Date.UTC(2026, 10, 15, 10, 41, 0);
const DAY2 = Date.UTC(2026, 10, 16, 10, 41, 0);
const SCOPES = ['user.info.basic', 'user.info.stats', 'video.list'];

async function world() {
  const { db, env } = await growDb();
  db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
  db.exec(readFileSync(`${M}/435_connector_companies.sql`, 'utf8'));
  db.exec(readFileSync(`${M}/${MIGRATION}`, 'utf8'));
  // D5864 (#5864, PR #6875): once part 2b is on main, a sync also raises the channel proposal into its own table.
  const proposals = readdirSync(M).find((f) => /^\d{12}_5864_tiktok_proposals\.sql$/.test(f));
  if (proposals) db.exec(readFileSync(`${M}/${proposals}`, 'utf8'));
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)').run(COMPANY, FOUNDER);
  return { db, env };
}

/** A TikTok connection, switched on for the company and linked to the venture unless told otherwise. */
function connection(db: any, id: number, o: { status?: string; enabled?: number; project?: number | null; config?: string } = {}) {
  // One TikTok per member: each connection is its own member of the company (the founder's is TT's).
  const user = id === TT ? FOUNDER : 100 + id;
  if (user !== FOUNDER) db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)').run(COMPANY, user);
  db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, scopes_json, config_json) VALUES (?, ?, ?, 'tiktok', ?, 'oauth2', ?, ?)")
    .run(id, `tt-${id}`, user, o.status ?? 'active', JSON.stringify(SCOPES), o.config ?? null);
  db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, ?)').run(id, COMPANY, o.enabled ?? 1);
  const project = o.project === undefined ? PID : o.project;
  if (project != null) db.prepare('INSERT INTO tiktok_account_links (integration_id, project_id, linked_by) VALUES (?, ?, ?)').run(id, project, FOUNDER);
}

/** The client's two reads, stubbed; `reads` counts the connections read. */
function stub(o: { fail?: number } = {}) {
  const s = { reads: [] as number[], followers: 1240 };
  const readsFor = async (_env: unknown, row: { id: number }): Promise<TikTokReads> => {
    s.reads.push(Number(row.id));
    if (o.fail === Number(row.id)) throw new TikTokReadError('unauthorized');
    return {
      account: async () => ({ followers: s.followers, following: 18, likes_total: 5310, video_count: 2 }),
      videos: async () => ({
        has_more: false, cursor: null, videos: [
          { id: '7301', posted_on: '2026-11-03', title: 'Launch day', duration_s: 42, views: 9100, likes: 410, comments: 22, shares: 9 },
          { id: '7302', posted_on: '2026-11-09', title: 'Behind the scenes', duration_s: 15, views: 300, likes: 12, comments: 0, shares: 0 },
        ],
      }),
    };
  };
  return { s, readsFor };
}

const snapshots = (db: any) => db.prepare('SELECT snapshot_date, followers FROM tiktok_account_facts ORDER BY snapshot_date').all().map((r: any) => [r.snapshot_date, r.followers]);
const snap = (db: any, date: string, followers: number | null) => db.prepare(
  "INSERT INTO tiktok_account_facts (followers, as_of, integration_id, project_id, snapshot_date) VALUES (?, ?, ?, ?, ?)",
).run(followers, date, TT, PID, date);
const video = (db: any, id: string, posted: string | null, views: number | null, asOf = '2026-11-15') => db.prepare(
  'INSERT INTO tiktok_video_facts (posted_on, views, as_of, integration_id, project_id, video_id) VALUES (?, ?, ?, ?, ?, ?)',
).run(posted, views, asOf, TT, PID, id);

test('1. the audience fact runs from the count before the period to its last, with its source and date', async () => {
  const { db, env } = await world();
  snap(db, '2026-10-28', 1240);
  snap(db, '2026-11-04', 1400);
  snap(db, '2026-11-15', 1610);
  snap(db, '2026-11-20', null); // a snapshot TikTok gave no follower count for is not a count
  const f = await periodFollowers(env, PID, '2026-11-01', '2026-11-30');
  const fact = audienceFact(f)!;
  assert.deepEqual(fact, { kind: 'audience', text: 'TikTok followers 1,240 → 1,610 this period',
    source: { label: 'TikTok · followers, as of 2026-11-15', ref: 'revenue_and_traction', as_of: '2026-11-15' } });

  // No count before the period: from its first count. One count only: that count.
  db.prepare("DELETE FROM tiktok_account_facts WHERE snapshot_date = '2026-10-28'").run();
  assert.equal(audienceFact(await periodFollowers(env, PID, '2026-11-01', '2026-11-30'))!.text, 'TikTok followers 1,400 → 1,610 this period');
  assert.equal(audienceFact({ before: null, first: { snapshot_date: '2026-11-15', followers: 1610 }, last: { snapshot_date: '2026-11-15', followers: 1610 } })!.text,
    'TikTok followers: 1,610');

  // A drafted line drawn from it carries the fact's source and date: the founder sees where it came from, and sends.
  const facts = periodFacts(buildMetrics([], [], '2026-11-01'), [], null, '2026-11-30', [], fact);
  assert.deepEqual(facts.map((x) => x.kind), ['audience']);
  const d = parseDraft(JSON.stringify({ highlights: [{ text: 'Our TikTok audience grew to 1,610', fact: 0 }] }), facts);
  assert.deepEqual(d.highlights[0].source, fact.source);
});

test('2. no count in the period: no audience fact, and nothing to draft from. Never 0', async () => {
  const { db, env } = await world();
  assert.equal(audienceFact(await periodFollowers(env, PID, '2026-11-01', '2026-11-30')), null, 'no TikTok data at all');
  snap(db, '2026-10-28', 1240);
  snap(db, '2026-11-10', null);
  const f = await periodFollowers(env, PID, '2026-11-01', '2026-11-30');
  assert.deepEqual(f, { before: null, first: null, last: null }, 'a count before the period alone is not this period');
  assert.equal(audienceFact(f), null);
  const facts = periodFacts(buildMetrics([], [], '2026-11-01'), [], null, '2026-11-30', [], audienceFact(f));
  assert.deepEqual(facts, []);
  assert.equal((await draftLines({} as any, 1, facts)).status, 'nothing');
  // A database without the TikTok tables reads as no count.
  const bare = (await growDb()).env;
  assert.deepEqual(await periodFollowers(bare, PID, '2026-11-01', '2026-11-30'), { before: null, first: null, last: null });
});

test('3. the reach line: this month\'s posts with a view count, beside the funnel and never in it; none, no line', async () => {
  const { db, env } = await world();
  const x = { env, projectId: PID, now: DAY1, href: (slug: string) => `/grow/${slug}?project_id=${PID}`, team: true };
  assert.equal(await tiktokReach(env, PID, '2026-11'), null);
  const none = await distributionCard(x as any);
  assert.equal((none.series as any).tiktok, null, 'no TikTok video: no line, never 0');
  assert.ok(!CARDS.distribution(none.series).some((c: any) => c.kind === 'rows' && c.items.some((i: any) => /TikTok/.test(i.label))));

  video(db, '7301', '2026-11-03', 9100, '2026-11-14');
  video(db, '7302', '2026-11-09', 300, '2026-11-15');
  video(db, '7303', '2026-11-10', null); // TikTok gave no view count: not counted as a post with 0 views
  video(db, '7000', '2026-10-20', 50000); // last month's post
  video(db, '7004', null, 70); // no post date
  const reach = await tiktokReach(env, PID, '2026-11');
  assert.deepEqual(reach, { views: 9400, posts: 2, as_of: '2026-11-15', source: 'From TikTok', text: 'TikTok reach this month: 9,400 views across 2 posts' });
  const card = await distributionCard(x as any);
  assert.deepEqual((card.series as any).tiktok, reach);
  assert.ok(!JSON.stringify((card.series as any).funnel).match(/tiktok/i), 'a view is not a funnel step');
  const drawn = CARDS.distribution({ ...(card.series as any), channels: [] }).flatMap((c: any) => (c.kind === 'rows' ? c.items : []));
  assert.deepEqual(drawn.filter((i: any) => /TikTok/.test(i.label)),
    [{ label: 'TikTok reach this month', value: '9,400 views across 2 posts · From TikTok, as of 2026-11-15' }]);
  assert.equal(await tiktokReach(env, PID, '2026-12'), null, 'a month with no post: no line');
});

test('4. the daily sync lands through part 2a\'s sync, once a day per connection, and writes no KPI', async () => {
  const { db, env } = await world();
  connection(db, TT);
  const t = stub();
  const first = await syncAllTiktokIntegrations(env, DAY1, t.readsFor as any);
  assert.deepEqual(first, { scanned: 1, ok: 1, failed: 0, skipped: 0, snapshots: 1, videos: 2, kept_deleted: 0 });
  assert.deepEqual(snapshots(db), [['2026-11-15', 1240]]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tiktok_video_facts').get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM connector_fed_items WHERE kind = 'tiktok_account_snapshot'").get().n, 1);

  // The same day again: skipped, nothing read, no second snapshot.
  const again = await syncAllTiktokIntegrations(env, DAY1 + 3_600_000, t.readsFor as any);
  assert.deepEqual([again.scanned, again.skipped], [0, 1]);
  assert.deepEqual(t.s.reads, [TT]);
  // Even a second pass the same day that does read (the stamp cleared) updates that day's row, never adds one.
  db.prepare('UPDATE integrations SET last_synced_at = NULL WHERE id = ?').run(TT);
  t.s.followers = 1300;
  await syncAllTiktokIntegrations(env, DAY1 + 7_200_000, t.readsFor as any);
  assert.deepEqual(snapshots(db), [['2026-11-15', 1300]]);

  // The next day: one more snapshot.
  db.prepare("UPDATE integrations SET last_synced_at = '2026-11-15 12:41:00' WHERE id = ?").run(TT);
  t.s.followers = 1610;
  const next = await syncAllTiktokIntegrations(env, DAY2, t.readsFor as any);
  assert.equal(next.snapshots, 1);
  assert.deepEqual(snapshots(db), [['2026-11-15', 1300], ['2026-11-16', 1610]]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_metrics').get().n, 0, 'no TikTok figure is a metric');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM custom_kpi_values').get().n, 0, 'no TikTok figure is a KPI value');
  for (const f of ['src/services/tiktok/daily.ts', 'src/services/tiktok/grow.ts']) {
    assert.doesNotMatch(readFileSync(`cloudflare-worker/${f}`, 'utf8'), /INTO\s+(project_metrics|custom_kpi_values|portfolio_updates)/i, `${f} writes no metric, KPI or update`);
  }
});

test('5. it skips no enabled company, manual, revoked, error, unlinked, and a venture whose company is switched off', async () => {
  const { db, env } = await world();
  connection(db, 71, { enabled: 0 });
  db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (8, 'p8', 'Other', 10, 70), (9, 'p9', 'Elsewhere', 10, 71), (10, 'p10', 'Third', 10, 70)").run();
  connection(db, 72, { status: 'revoked', project: 8 });
  connection(db, 73, { status: 'error', project: null });
  connection(db, 74, { project: null }); // never linked by a founder's sync: the cron never picks a venture
  connection(db, 75, { project: 9 }); // linked to a venture of a company this connection is not switched on for
  connection(db, 76, { project: 10, config: JSON.stringify({ sync_frequency: 'manual' }) }); // the member chose manual syncs
  const t = stub();
  const r = await syncAllTiktokIntegrations(env, DAY1, t.readsFor as any);
  assert.deepEqual(t.s.reads, [], 'no connection was read');
  assert.deepEqual([r.scanned, r.ok, r.skipped], [0, 0, 3], 'the revoked, errored and unlinked ones are not even listed');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tiktok_account_facts').get().n, 0);
});

test('6. a deleted fact is not re-created; one failure does not stop the pass; the log carries counts only', async () => {
  const { db, env } = await world();
  connection(db, TT);
  const t = stub();
  await syncAllTiktokIntegrations(env, DAY1, t.readsFor as any);
  const snapId = db.prepare('SELECT id FROM tiktok_account_facts').get().id;
  const vidId = db.prepare("SELECT id FROM tiktok_video_facts WHERE video_id = '7301'").get().id;
  assert.equal(await deleteTikTokRow(env, 'account', PID, snapId), 'revenue-and-traction');
  assert.equal(await deleteTikTokRow(env, 'video', PID, vidId), 'distribution');
  db.prepare('UPDATE integrations SET last_synced_at = NULL WHERE id = ?').run(TT);
  const r = await syncAllTiktokIntegrations(env, DAY1 + 3_600_000, t.readsFor as any);
  assert.deepEqual([r.ok, r.snapshots, r.videos, r.kept_deleted], [1, 0, 1, 2]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tiktok_account_facts').get().n, 0, 'the deleted snapshot stays deleted');
  assert.deepEqual(db.prepare('SELECT video_id FROM tiktok_video_facts').all().map((v: any) => v.video_id), ['7302'], 'the deleted video stays deleted');

  // A second venture's connection whose token TikTok refuses: it fails on its own, with a code, and the other lands.
  const w = await world();
  w.db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (8, 'p8', 'Other', 10, 70)").run();
  connection(w.db, 81, { project: 8 });
  connection(w.db, 82);
  const s = stub({ fail: 81 });
  const out = await syncAllTiktokIntegrations(w.env, DAY1, s.readsFor as any);
  assert.deepEqual([out.scanned, out.ok, out.failed], [2, 1, 1]);
  assert.deepEqual(w.db.prepare('SELECT id, last_error, last_synced_at IS NOT NULL AS synced FROM integrations WHERE provider_key = \'tiktok\' ORDER BY id').all().map((x: any) => ({ ...x })),
    [{ id: 81, last_error: 'tiktok_unauthorized', synced: 0 }, { id: 82, last_error: null, synced: 1 }]);

  // The cron calls it hourly at :41, gated by its own once-a-day skip, and logs the totals only.
  const index = readFileSync('cloudflare-worker/src/index.ts', 'utf8');
  const block = index.slice(index.indexOf('D5867 (#5867) — the daily TikTok sync'), index.indexOf("taskFailed('tiktok sync'"));
  assert.match(block, /getUTCMinutes\(\) === 41[\s\S]*syncAllTiktokIntegrations\(env, now\.getTime\(\)\)/);
  const logged = /console\.info\(`([^`]*)`\)/.exec(block)![1];
  assert.deepEqual([...logged.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]), ['r.scanned', 'r.ok', 'r.failed', 'r.skipped', 'r.snapshots', 'r.videos', 'r.kept_deleted']);
  assert.doesNotMatch(readFileSync('cloudflare-worker/src/services/tiktok/daily.ts', 'utf8'), /console\./, 'the pass itself logs nothing');
});
