/**
 * D1568 (#3815, deck v2 D7): follow-up signals from an investor's views.
 * The share heartbeat route on the real migrated schema in memory; synthetic
 * rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/raise_prospect_signals_d1568.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import decks from '../src/routes/decks.ts';
import deckInvestorLinks from '../src/routes/deck_investor_links.ts';
import { SignJWT } from 'jose';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { REVISIT_AFTER_HOURS, afterViewDraft, proposedStage, signalKinds, signalsForLinks } from '../src/services/raiseSignals.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF)
  .sort((a, b) => migrationNumber(a) - migrationNumber(b) || a.localeCompare(b)).map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const JWT_SECRET = 'synthetic-d1568-only-not-a-real-credential'.repeat(2);
const ASK_DECK = JSON.stringify([{ title: 'Problem' }, { title: 'Solution' }, { title: 'The ask', spec_id: 'ask' }]);
const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');

function b64url(bytes: Uint8Array | ArrayBuffer): string {
  return Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** A share token minted as `routes/decks.ts` mints one. */
async function shareToken(deckId: number): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify({ k: `deck:${deckId}:v1`, exp: Math.floor(Date.now() / 1000) + 600 })));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${body}.${b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))}`;
}

async function fixture(o: { prospect?: boolean; stage?: string } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(baseline); for (const sql of migrations) db.exec(sql);
  db.exec("INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (2, 'founder', 100, 'Synthetic founder', 'synthetic-2@example.invalid', 1, 'studio')");
  db.exec("INSERT INTO projects(id, name, founder_id) VALUES (1, 'Synthetic venture', 100)");
  db.prepare("INSERT INTO raise_prospects (id, uid, project_id, name, firm, stage, created_at, updated_at) VALUES (9, 'p9', 1, 'Ada Synthetic', 'Fund Synthetic', ?, datetime('now'), datetime('now'))").run(o.stage ?? 'to_contact');
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (5, 1, 1, ?, ?, 1)').run(ASK_DECK, 'Synthetic deck');
  const tok = await shareToken(5);
  db.prepare("INSERT INTO pitch_deck_share_tokens (id, deck_id, token_hash, expires_at, prospect_id, created_by) VALUES (1, 5, ?, '2999-01-01 00:00:00', ?, 2)")
    .run(createHash('sha256').update(tok).digest('hex'), o.prospect === false ? null : 9);
  const app = new Hono<any>().route('/api/decks', decks);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const view = (id: number, hoursAgo: number, read = 0) => db.prepare('INSERT INTO deck_share_views (id, share_token_id, deck_id, read_seconds, created_at) VALUES (?, 1, 5, ?, ?)').run(id, read, at(hoursAgo));
  const beat = async (viewId: number, slides: Record<number, number>) => {
    const res = await app.request(`/api/decks/share/${tok}/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view_id: viewId, seconds: 90, slides }) }, env);
    assert.equal(res.status, 200);
  };
  const signals = () => db.prepare('SELECT kind, view_id, draft_uid, proposal_uid FROM raise_prospect_signals ORDER BY id').all() as any[];
  const notices = () => db.prepare("SELECT title, body FROM notifications_inbox WHERE type = 'raise_prospect_signal' ORDER BY id").all() as any[];
  const drafts = () => db.prepare("SELECT uid, person_ref, intent, subject, body, model FROM mail_drafts ORDER BY id").all() as any[];
  const proposals = () => db.prepare("SELECT uid, rail_option, record_ref, kind, payload_json, status FROM ai_rail_proposals ORDER BY id").all() as any[];
  const stage = () => (db.prepare('SELECT stage FROM raise_prospects WHERE id = 9').get() as any).stage;
  return { db, env, view, beat, signals, notices, drafts, proposals, stage };
}

test('one revisit creates one signal and one notification; the same heartbeat again creates neither', async () => {
  const f = await fixture({ stage: 'contacted' });
  f.view(1, 72, 120); // read three days ago
  f.view(2, 1);       // opened an hour ago
  await f.beat(2, { 0: 30, 1: 20 });
  assert.deepEqual(f.signals().map((s) => [s.kind, s.view_id]), [['revisit', 2]]);
  assert.equal(f.notices().length, 1);
  assert.match(f.notices()[0].title, /^Ada Synthetic: revisited after 48 h$/);
  await f.beat(2, { 0: 40, 1: 30 });
  assert.equal(f.signals().length, 1, 'a second heartbeat of the same view adds no signal');
  assert.equal(f.notices().length, 1, 'and no notification');
});

test('first view and the ask reached, each once per link; a view under 48 hours after the last is no revisit', async () => {
  const f = await fixture();
  f.view(1, 5);
  await f.beat(1, { 0: 20 });
  assert.deepEqual(f.signals().map((s) => s.kind), ['first_view']);
  f.view(2, 1);
  await f.beat(2, { 0: 10, 1: 10, 2: 10 });
  assert.deepEqual(f.signals().map((s) => s.kind), ['first_view', 'reached_ask'], 'four hours later is no revisit; the ask card was read');
  f.view(3, 0);
  await f.beat(3, { 2: 10 });
  assert.equal(f.signals().length, 2, 'the ask is reached once per link');
  assert.equal(f.notices().length, 2);
});

test('a view never read is not a visit: it neither counts as the first nor starts the 48 hours', async () => {
  const f = await fixture();
  f.view(1, 100);      // opened, never read
  f.view(2, 1);
  await f.beat(2, { 0: 20 });
  assert.deepEqual(f.signals().map((s) => s.kind), ['first_view']);
});

test('each signal leaves an after_view draft with no seconds and no figures, and a stage proposal only to Accept', async () => {
  const f = await fixture({ stage: 'to_contact' });
  f.view(1, 5);
  await f.beat(1, { 0: 45, 1: 30, 2: 12 });
  const [first, ask] = f.signals();
  assert.deepEqual([first.kind, ask.kind], ['first_view', 'reached_ask']);
  const drafts = f.drafts();
  assert.equal(drafts.length, 2);
  for (const d of drafts) {
    assert.deepEqual([d.person_ref, d.intent, d.model], ['prospect:9', 'after_view', null]);
    assert.doesNotMatch(`${d.subject} ${d.body}`, /\d/, 'no figure');
    assert.doesNotMatch(`${d.subject} ${d.body}`, /second|minute|\bsec\b|\bmin\b/i, 'no read time');
    assert.match(d.body, /^Hi Ada,/);
  }
  assert.equal(first.draft_uid, drafts[0].uid);
  const props = f.proposals();
  assert.equal(props.length, 1, 'one stage proposal waits at a time');
  assert.deepEqual([props[0].rail_option, props[0].record_ref, props[0].kind, props[0].status], ['signal:stage', 'prospect:9', 'proposal', 'proposed']);
  assert.deepEqual(JSON.parse(props[0].payload_json).stage_to, 'contacted');
  assert.equal(first.proposal_uid, props[0].uid);
  assert.equal(f.stage(), 'to_contact', 'nothing changed the stage: only Accept and the record\'s own save do');
});

test('a link made for no prospect signals nothing', async () => {
  const f = await fixture({ prospect: false });
  f.view(1, 5);
  await f.beat(1, { 0: 20, 2: 5 });
  assert.deepEqual([f.signals().length, f.notices().length, f.drafts().length, f.proposals().length], [0, 0, 0, 0]);
});

test('the investor row reads each link\'s signals, oldest first, in words', async () => {
  const f = await fixture({ stage: 'meeting' });
  f.view(1, 72);
  await f.beat(1, { 0: 10 });   // read three days ago: the first view
  f.view(2, 1);
  await f.beat(2, { 2: 10 });   // an hour ago: a revisit that reached the ask
  // The pd35 row, through the route the table reads.
  await ensureProjectMembershipSchema(f.env);
  const app = new Hono<any>().route('/api/decks', deckInvestorLinks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const jwt = await new SignJWT({ user_id: 2 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request('https://axal.vc/api/decks/5/investor-links', { headers: { Authorization: `Bearer ${jwt}` } }, f.env);
  assert.equal(res.status, 200, await res.clone().text());
  const row = (await res.json() as any).links.find((l: any) => l.id === 1);
  assert.deepEqual(row.signals.map((x: any) => x.words), ['Opened', 'Revisited after 48 h', 'Reached the ask'], 'oldest first');
  assert.doesNotMatch(JSON.stringify(row.signals), /read_seconds|seconds/, 'a signal carries no read time');
  const got = await signalsForLinks(f.env, [1, 99]);
  assert.deepEqual(got.get(1)!.map((s) => [s.kind, s.words]), [['first_view', 'Opened'], ['revisit', 'Revisited after 48 h'], ['reached_ask', 'Reached the ask']]);
  assert.equal(got.has(99), false);
  assert.equal(f.proposals().length, 0, 'a prospect already at a meeting gets no proposal');
});

test('the rules', () => {
  assert.equal(REVISIT_AFTER_HOURS, 48);
  const base = { isFirst: false, askIndex: 2, readSlides: [0] };
  assert.deepEqual(signalKinds({ ...base, previousAt: '2026-11-01 10:00:00', viewAt: '2026-11-03 10:00:00' }), ['revisit']);
  assert.deepEqual(signalKinds({ ...base, previousAt: '2026-11-01 10:00:01', viewAt: '2026-11-03 10:00:00' }), [], 'one second under 48 hours');
  assert.deepEqual(signalKinds({ ...base, isFirst: true, previousAt: null, viewAt: '2026-11-03 10:00:00', readSlides: [3] }), ['first_view', 'reached_ask']);
  assert.deepEqual(signalKinds({ ...base, isFirst: true, previousAt: null, viewAt: '2026-11-03 10:00:00', askIndex: null, readSlides: [9] }), ['first_view'], 'no ask card: never reached');
  assert.deepEqual([proposedStage('first_view', 'to_contact'), proposedStage('first_view', 'contacted'), proposedStage('revisit', 'contacted'), proposedStage('reached_ask', null), proposedStage('revisit', 'meeting'), proposedStage('reached_ask', 'committed')],
    ['contacted', null, 'meeting', 'meeting', null, null], 'forward only, never past a meeting');
  assert.match(afterViewDraft('first_view', null).body, /^Hi,/);
  assert.match(afterViewDraft('revisit', 'Bo 2 Synthetic').body, /^Hi Bo,/);
});
