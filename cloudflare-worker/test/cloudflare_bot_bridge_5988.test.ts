/** #5988 (D5674): the scheduled stage bridge against a real SQLite ledger and source store — fire, repeat, recovery, inventory, port and audience. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { d1Over } from './_d1_sqlite.mjs';
import { runBotSourceBridge, storedBotEpisodes, cfBotDeliveryPort, botSourceKey, BOT_REPEAT_MS } from '../src/services/cloudflareBotBridge.ts';
import { botEpisodeKey } from '../src/services/cloudflareBotHealth.ts';
import { cfReceiptSchema, type CfDeliveryPort } from '../src/services/cloudflareSourceReceipt.ts';
import { receiveCloudflare } from '../../engineering-notifications/cloudflare-receiver-5671.mjs';

const T = 1900000000000, H = 3_600_000, A = 'a'.repeat(40), B = 'b'.repeat(40);
const SECRET = 's'.repeat(40), URL_ = 'https://cf-notify.example.invalid/';
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../sql/migrations/202611121040_5673_cloudflare_source_receipts.sql', import.meta.url), 'utf8'));
  // The columns D5674's projection reads, nothing else.
  db.exec(`CREATE TABLE meeting_bots (uid TEXT PRIMARY KEY, session_id INTEGER, platform TEXT, status TEXT, failure_code TEXT, created_at INTEGER, scheduled_at INTEGER,
      started_at INTEGER, ended_at INTEGER, heartbeat_at INTEGER, runtime_callback_seen_at INTEGER, runtime_error_code TEXT, runtime_version TEXT);
    CREATE TABLE interview_sessions (id INTEGER PRIMARY KEY, processing_updated_at TEXT);
    CREATE TABLE interview_session_receipts (session_id INTEGER, kind TEXT, outcome TEXT, created_at TEXT);`);
  let n = 0;
  const bot = (p: { platform?: string; status: string; at: number; failure_code?: string | null; runtime_error_code?: string | null; runtime_version?: string | null; final?: boolean }) => {
    const sid = ++n;
    db.prepare('INSERT INTO interview_sessions (id) VALUES (?)').run(sid);
    db.prepare(`INSERT INTO meeting_bots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`private-recording-${sid}`, sid, p.platform ?? 'zoom', p.status, p.failure_code ?? null,
      p.at - 600000, p.at - 600000, p.at - 590000, ['done', 'failed', 'stopped'].includes(p.status) ? p.at : null, p.at - 1000, p.at - 580000, p.runtime_error_code ?? null, p.runtime_version ?? null);
    if (p.final) db.prepare(`INSERT INTO interview_session_receipts VALUES (?, 'final', 'ok', ?)`).run(sid, new Date(p.at).toISOString().replace('T', ' ').slice(0, 19));
  };
  const env = (patch: Record<string, unknown> = {}) => ({ DB: d1Over(db), MEETING_BOT: 'on', ...patch }) as any;
  const rows = (key = botSourceKey('studioos-meeting-bot')) => db.prepare('SELECT receipt_json, forwarded_ms FROM cf_source_receipts WHERE source_key=? ORDER BY observed_ms, receipt_id').all(key)
    .map((r: any) => ({ ...JSON.parse(r.receipt_json), forwarded_ms: r.forwarded_ms }));
  return { db, bot, env, rows };
}
const sink = () => { const sent: any[] = []; const port: CfDeliveryPort = { async enqueue(route) { sent.push(route); return { durable: true }; } }; return { sent, port }; };

test('fire, repeat and duplicate passes: one episode key, one stored fire per hour, one delivery per receipt', async () => {
  const f = fixture(), { sent, port } = sink();
  f.bot({ status: 'failed', at: T - 60000, failure_code: 'recording_failed', runtime_version: A });
  const first = await runBotSourceBridge(f.env(), { now: T, port });
  assert.equal(first.stored, 1); assert.equal(first.forwarded, 1); assert.equal(first.inventory, 'complete');
  const [fire] = f.rows();
  assert.equal(fire.state, 'firing'); assert.equal(fire.component, 'capture'); assert.equal(fire.revision, A, 'the affected version is carried when every counted run agrees');
  assert.equal(fire.episode_key, await botEpisodeKey('studioos-meeting-bot', 'zoom', 'capture'));
  // The same pass again (a duplicate callback / overlapping tick) stores and sends nothing new.
  assert.equal((await runBotSourceBridge(f.env(), { now: T, port })).stored, 0);
  // Five minutes later the failure is still in the window: the episode stays open, no second fire.
  assert.equal((await runBotSourceBridge(f.env(), { now: T + 300000, port })).stored, 0);
  // A second site/host observation of the same cause an hour later is a repeat under the same key.
  f.bot({ status: 'failed', at: T + H - 1000, failure_code: 'recording_failed', runtime_version: A });
  assert.equal((await runBotSourceBridge(f.env(), { now: T + H, port })).stored, 1);
  const fires = f.rows().filter(r => r.state === 'firing');
  assert.equal(fires.length, 2); assert.equal(new Set(fires.map(r => r.episode_key)).size, 1);
  const inv = await storedBotEpisodes(f.env().DB, 'studioos-meeting-bot');
  assert.equal(inv.complete, true); assert.equal(inv.episodes.length, 1); assert.equal(inv.episodes[0].opened_ms, T);
  assert.equal(sent.length, 2); assert.equal(new Set(sent.map(s => s.receipt.id)).size, 2);
  f.db.close();
});

test('recovery only from a fresh final success at the affected version once no failure of that cause remains', async () => {
  const f = fixture(), { port } = sink();
  f.bot({ status: 'failed', at: T - 60000, failure_code: 'recording_failed', runtime_version: A });
  await runBotSourceBridge(f.env(), { now: T, port });
  // A success while the failure is still in the 24-hour window does not close it.
  f.bot({ status: 'done', at: T + H, runtime_version: A, final: true });
  await runBotSourceBridge(f.env(), { now: T + 2 * H, port });
  assert.equal(f.rows().some(r => r.state === 'recovered'), false);
  // After the failure ages out: a success at another version, or without its final receipt, does not close it.
  const later = T + 25 * H;
  f.db.exec("DELETE FROM meeting_bots WHERE status='done'");
  f.bot({ status: 'done', at: later - H, runtime_version: B, final: true });
  f.bot({ status: 'done', at: later - H, runtime_version: A, final: false });
  await runBotSourceBridge(f.env(), { now: later, port });
  assert.equal(f.rows().some(r => r.state === 'recovered'), false);
  f.bot({ status: 'done', at: later + 60000, runtime_version: A, final: true });
  await runBotSourceBridge(f.env(), { now: later + 120000, port });
  const recovered = f.rows().filter(r => r.state === 'recovered');
  assert.equal(recovered.length, 1); assert.equal(recovered[0].episode_key, await botEpisodeKey('studioos-meeting-bot', 'zoom', 'capture'));
  assert.equal((await storedBotEpisodes(f.env().DB, 'studioos-meeting-bot')).episodes.length, 0, 'the stored recovery closes the episode');
  await runBotSourceBridge(f.env(), { now: later + 600000, port });
  assert.equal(f.rows().filter(r => r.state === 'recovered').length, 1, 'a closed episode is not recovered twice');
  f.db.close();
});

test('the latest stored fire names the affected version; the HQ read without an inventory never recovers', async () => {
  const f = fixture(), { port } = sink();
  f.bot({ status: 'failed', at: T - 60000, failure_code: 'recording_failed', runtime_version: A });
  await runBotSourceBridge(f.env(), { now: T, port });
  // A day later only the new failure is in the window, at another version.
  f.bot({ status: 'failed', at: T + 25 * H - 60000, failure_code: 'recording_failed', runtime_version: B });
  await runBotSourceBridge(f.env(), { now: T + 25 * H, port });
  const inv = await storedBotEpisodes(f.env().DB, 'studioos-meeting-bot');
  assert.equal(inv.episodes[0].version, B); assert.equal(inv.episodes[0].opened_ms, T);
  f.db.exec('DELETE FROM meeting_bots'); f.bot({ status: 'done', at: T + 50 * H, runtime_version: B, final: true });
  const { readBotSourceEvidence } = await import('../src/services/cloudflareBotHealth.ts');
  for (const inventory of [undefined, { complete: false, episodes: inv.episodes }])
    assert.equal((await readBotSourceEvidence(f.env(), T + 50 * H + 60000, { inventory })).receipts.some(r => r.state === 'recovered'), false);
  await runBotSourceBridge(f.env(), { now: T + 50 * H + 60000, port });
  assert.equal(f.rows().filter(r => r.state === 'recovered').length, 1);
  f.db.close();
});

test('an incomplete or unreadable inventory produces no recovery', async () => {
  const f = fixture(), { port } = sink();
  f.bot({ status: 'failed', at: T - 60000, failure_code: 'recording_failed' });
  await runBotSourceBridge(f.env(), { now: T, port });
  f.db.exec('DELETE FROM meeting_bots');f.bot({ status: 'done', at: T + 25 * H, final: true });
  // A foreign row in this partition makes the inventory incomplete.
  const foreign = { ...f.rows()[0], script: 'studioos-meeting-bot-preview', audience: 'preview', id: 'f'.repeat(64) }; delete foreign.forwarded_ms;
  f.db.prepare('INSERT INTO cf_source_receipts (receipt_id,source_key,observed_ms,receipt_json,forwarded_ms) VALUES (?,?,?,?,?)').run(foreign.id, botSourceKey('studioos-meeting-bot'), T, JSON.stringify(foreign), T);
  const r = await runBotSourceBridge(f.env(), { now: T + 25 * H + 60000, port });
  assert.equal(r.inventory, 'incomplete'); assert.equal(f.rows().some(x => x.state === 'recovered'), false);
  // Unreadable: the inventory read fails, the pass still never recovers.
  const broken = { prepare(sql: string) { if (sql.includes('WITH r AS')) throw Error('private diagnostic'); return f.env().DB.prepare(sql); }, batch: (s: any) => f.env().DB.batch(s) };
  assert.equal((await storedBotEpisodes(broken as any, 'studioos-meeting-bot')).complete, false);
  f.db.close();
});

test('port down, non-durable or probe acknowledgements and an unset port all leave receipts pending', async () => {
  const f = fixture();
  f.bot({ status: 'failed', at: T - 60000, failure_code: 'recording_failed' });
  // Unset: no URL or secret means no port at all, and nothing is fetched.
  let fetched = 0; const counting = (async () => { fetched++; return new Response(null, { status: 202 }); }) as unknown as typeof fetch;
  for (const env of [{}, { CF_BOT_DELIVERY_URL: URL_ }, { CF_BOT_DELIVERY_SECRET: SECRET }, { CF_BOT_DELIVERY_URL: 'http://plain.example.invalid/', CF_BOT_DELIVERY_SECRET: SECRET },
    { CF_BOT_DELIVERY_URL: URL_, CF_BOT_DELIVERY_SECRET: 'short' }]) assert.equal(cfBotDeliveryPort(env as any, counting), null);
  const unset = await runBotSourceBridge(f.env(), { now: T });
  assert.equal(unset.delivery, 'not_configured'); assert.equal(unset.stored, 1); assert.equal(fetched, 0);
  assert.equal(f.rows().filter(r => r.forwarded_ms === null).length, 1);
  for (const reply of [() => { throw Error('connect refused'); }, () => Response.json({ accepted: false, probe: true }), () => new Response('durable delivery unavailable', { status: 503 }),
    () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.invalid/' } }), () => Response.json({ accepted: false }, { status: 202 }),
    () => Response.json({ accepted: true }, { status: 200 }), () => Response.json({ accepted: true, probe: true }, { status: 202 })]) {
    const port = cfBotDeliveryPort({ CF_BOT_DELIVERY_URL: URL_, CF_BOT_DELIVERY_SECRET: SECRET }, (async () => reply()) as unknown as typeof fetch)!;
    const r = await runBotSourceBridge(f.env(), { now: T + 60000, port });
    assert.equal(r.delivery, 'pending'); assert.equal(r.forwarded, 0); assert.equal(f.rows().filter(x => x.forwarded_ms === null).length, 1);
  }
  // Today's #5671 receiver authenticates the header and refuses an unregistered (non-policy) event: still pending, nothing invented.
  const toReceiver = (async (url: string, init: RequestInit) => receiveCloudflare(new Request(url, init), { secret: SECRET, config: null, accept: () => { throw Error('must not accept'); } })) as unknown as typeof fetch;
  const r = await runBotSourceBridge(f.env(), { now: T + 120000, port: cfBotDeliveryPort({ CF_BOT_DELIVERY_URL: URL_, CF_BOT_DELIVERY_SECRET: SECRET }, toReceiver) });
  assert.equal(r.delivery, 'pending'); assert.equal(f.rows().filter(x => x.forwarded_ms === null).length, 1);
  f.db.close();
});

test('the forwarded payload is the route plus schema fields only, authenticated, with no session, recording, URL or tenant', async () => {
  const f = fixture(), calls: { url: string; init: RequestInit }[] = [];
  f.bot({ status: 'failed', at: T - 60000, failure_code: 'recording_failed', runtime_version: A });
  f.bot({ status: 'failed', at: T - 60000, platform: 'google_meet', runtime_error_code: 'container_start_failed' });
  const port = cfBotDeliveryPort({ CF_BOT_DELIVERY_URL: URL_, CF_BOT_DELIVERY_SECRET: SECRET },
    (async (url: string, init: RequestInit) => { calls.push({ url, init }); return Response.json({ accepted: true, key: 'c'.repeat(64) }, { status: 202 }); }) as unknown as typeof fetch)!;
  const r = await runBotSourceBridge(f.env({ APP_URL: 'https://app.axal.vc/' }), { now: T, port });
  assert.equal(r.forwarded, 2); assert.equal(r.delivery, 'forwarded'); assert.equal(f.rows().every(x => x.forwarded_ms === T), true);
  const fields = Object.keys(cfReceiptSchema.shape).sort();
  for (const c of calls) {
    assert.equal(c.url, URL_); assert.equal((c.init.headers as Record<string, string>)['cf-webhook-auth'], SECRET);
    const body = JSON.parse(String(c.init.body));
    assert.deepEqual(Object.keys(body).sort(), ['destination', 'drilldown', 'labels', 'owner', 'receipt', 'subject']);
    assert.deepEqual(Object.keys(body.receipt).sort(), fields); cfReceiptSchema.parse(body.receipt);
    assert.doesNotMatch(JSON.stringify(body), /private-recording|session|tenant|attendee|participant|https?:|axal\.vc|example\.invalid/);
  }
  assert.equal(JSON.parse(String(calls.find(c => JSON.parse(String(c.init.body)).receipt.component === 'startup')!.init.body)).subject, 'meeting_bot:start_failed', 'site and host share the platform cause');
  f.db.close();
});

test('preview receipts stay in the preview partition and route to the preview audience only', async () => {
  const f = fixture(), { sent, port } = sink();
  f.bot({ status: 'failed', at: T - 60000, runtime_error_code: 'container_start_failed' });
  // Stored with no port first, so the preview receipt is still pending when production forwards.
  const held = await runBotSourceBridge(f.env({ ENVIRONMENT: 'preview' }), { now: T, port: null });
  assert.equal(held.script, 'studioos-meeting-bot-preview'); assert.equal(held.stored, 1);
  assert.equal(f.rows().length, 0, 'nothing lands in the production partition');
  const [p] = f.rows(botSourceKey('studioos-meeting-bot-preview'));
  assert.equal(p.audience, 'preview'); assert.equal(p.platform_episode, null); assert.equal(p.owner, 'preview_owner');
  // A production pass never forwards the preview partition.
  const prod = sink(); await runBotSourceBridge(f.env(), { now: T + 60000, port: prod.port });
  assert.ok(prod.sent.length > 0); assert.equal(prod.sent.some(s => s.receipt.audience === 'preview'), false);
  const r = await runBotSourceBridge(f.env({ ENVIRONMENT: 'preview' }), { now: T + 120000, port });
  assert.equal(r.forwarded, 1); assert.equal(sent.length, 1);
  assert.equal(sent[0].destination, 'preview'); assert.equal(sent[0].receipt.audience, 'preview'); assert.notEqual(sent[0].subject, 'meeting_bot:start_failed');
  f.db.close();
});

test('a branch deployment never runs the bridge; an unreadable ledger stores one coverage gap per interval', async () => {
  const f = fixture(), { sent, port } = sink();
  assert.equal((await runBotSourceBridge(f.env({ BRANCH_CODE: 'acme' }), { now: T, port })).state, 'skipped');
  f.db.exec('DROP TABLE meeting_bots');
  assert.equal((await runBotSourceBridge(f.env(), { now: T, port })).stored, 1);
  assert.equal((await runBotSourceBridge(f.env(), { now: T + 300000, port })).stored, 0);
  assert.equal((await runBotSourceBridge(f.env(), { now: T + BOT_REPEAT_MS + 1, port })).stored, 1);
  assert.ok(f.rows().every(r => r.component === 'coverage' && r.state === 'unknown')); assert.equal(sent.length, 2);
  f.db.close();
});
