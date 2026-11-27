/**
 * D6045 (#6045, Raise V2 build 1/5) — `GET /api/cycles/raise/overview` answers the stage, the one primary
 * action (RA-03), the Pitch card's state (RA-05) and investor activity (RA-02) from recorded state, on
 * real SQLite (the baseline plus every migration, as `cycle_focus_d692.test.ts` builds it).
 *
 * The clock is mocked (`mock.timers`, Date only) to 2026-11-18 12:00 UTC; every stored time is written
 * explicitly, so nothing reads the real clock.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/raise_overview_journey_6045.test.ts
 */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleRaise from '../src/routes/cycle_raise.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());

const FOUNDER = 10, ADMIN = 30;
const P = 1;
const roleOf: Record<number, string> = { [FOUNDER]: 'founder', [ADMIN]: 'admin' };

function freshBuild(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return db;
}
const BUILT_DDL = (freshBuild().prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
  ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);

/** One venture, its founder and an admin. */
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Ada Quill', 'ada@example.test', 1001);
  u.run(ADMIN, 'admin', 'Ann Admin', 'ann@example.test', null);
  u.run(60, 'investor', 'Ivy Investor', 'ivy@example.test', null);
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (?, 'Juniper Labs', 1001)`).run(P);
  return db;
}

/** A D1 binding that throws on any statement containing `needle`. */
function failing(db: any, needle: string | null) {
  const inner = d1Over(db);
  if (!needle) return inner;
  return {
    ...inner,
    prepare(sql: string) {
      if (!sql.includes(needle)) return inner.prepare(sql);
      const boom = async () => { throw new Error('injected failure'); };
      const api: any = { bind: () => api, all: boom, first: boom, run: boom, raw: boom };
      return api;
    },
  };
}

const app = new Hono<any>();
app.route('/api/cycles/raise', cycleRaise);
async function read(db: any, o: { who?: number; needle?: string | null; flags?: Record<string, string> } = {}) {
  const who = o.who ?? FOUNDER;
  const token = await new SignJWT({ user_id: who, role: roleOf[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(`/api/cycles/raise/overview?project=${P}`, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: failing(db, o.needle ?? null), ...(o.flags ?? {}) } as any);
    const body = await res.json().catch(() => null) as any;
    assert.equal(res.status, 200, JSON.stringify(body));
    return body;
  } finally { [console.warn, console.error] = saved; }
}
const pitchOf = (body: any) => body.cards.find((c: any) => c.slug === 'pitch-deck').pitch_state;

// Deck cards: a titled card with no areas passes /deck-ready; an untitled one has a row to fix.
const READY = JSON.stringify([{ uid: 'c1', title: 'The problem', blocks: [] }]);
const NOT_READY = JSON.stringify([{ uid: 'c1', blocks: [] }]);
const deck = (db: any, id: number, version: number, slides: string, current = 1) =>
  db.prepare(`INSERT INTO pitch_decks (id, project_id, version, slides, is_current, created_at) VALUES (?, ?, ?, ?, ?, '2026-11-01 09:00:00')`)
    .run(id, P, version, slides, current);
const narrative = (db: any, version: number) =>
  db.prepare(`INSERT INTO spinout_deck_overrides (project_id, version, field_key, value, updated_at) VALUES (?, ?, '_version', '1', '2026-11-02 09:00:00')`)
    .run(P, version);
let tokenSeq = 0;
const link = (db: any, deckId: number, o: { expires?: string; revoked?: string | null } = {}) => {
  tokenSeq += 1;
  db.prepare(`INSERT INTO pitch_deck_share_tokens (id, deck_id, token_hash, expires_at, revoked_at, view_limit, view_count, investor_label, created_at)
              VALUES (?, ?, ?, ?, ?, 10, 0, ?, '2026-11-10 09:00:00')`)
    .run(tokenSeq, deckId, `h${tokenSeq}`, o.expires ?? '2026-12-31 00:00:00', o.revoked ?? null, `Fund ${tokenSeq}`);
  return tokenSeq;
};
let prSeq = 0;
const prospect = (db: any, stage: string, updated: string) => {
  prSeq += 1;
  db.prepare(`INSERT INTO raise_prospects (id, uid, project_id, name, firm, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(prSeq, `p${prSeq}`, P, `Investor ${prSeq}`, `Firm ${prSeq}`, stage, updated, updated);
};

test('1: no deck and no round — Prepare, Prepare to raise, no deck, and measured zeros', async () => {
  const body = await read(fixture());
  assert.deepEqual(body.stage, { state: 'ok', key: 'prepare', label: 'Prepare', rule: 'No narrative version saved' });
  assert.deepEqual(body.primary_action, {
    state: 'ok', key: 'prepare_to_raise', label: 'Prepare to raise', href: `/raise/fundraising-readiness?project=${P}`, rule: 'No narrative version saved',
  });
  assert.deepEqual(pitchOf(body), { state: 'ok', key: 'no_deck', label: 'No deck', version: null, live_links: 0, to_fix: null, unsaved_changes: false });
  const a = body.investor_activity;
  assert.equal(a.in_pipeline, 0);
  assert.equal(a.active_conversations, 0);
  assert.equal(a.deck_views_8_weeks, 0);
  assert.equal(a.call_responses_this_month, null, 'round calls are off, so there is no figure');
  assert.deepEqual(a.recent, []);
  assert.equal(a.sources.pipeline.status, 'ready');
  assert.equal(a.sources.pipeline.source_updated_at, null);
  assert.equal(a.sources.deck_views.status, 'ready');
  assert.deepEqual(a.sources.round_calls, { status: 'not_applicable', reason: 'Calls for capital are not switched on.' });
});

test('2: a deck draft — a working draft with no saved version; a saved narrative makes it Build pitch', async () => {
  const db = fixture();
  db.prepare(`INSERT INTO pitch_deck_proposals (project_id, base_deck_id, slides, title) VALUES (?, 0, ?, 'Draft')`).run(P, READY);
  let body = await read(db);
  assert.deepEqual(pitchOf(body), { state: 'ok', key: 'draft', label: 'Working draft only', version: null, live_links: 0, to_fix: null, unsaved_changes: true });
  assert.equal(body.stage.key, 'prepare', 'an unkept draft is not a saved deck, and no narrative is saved');

  narrative(db, 1);
  body = await read(db);
  assert.equal(body.stage.key, 'build_the_story');
  assert.equal(body.stage.label, 'Build the story');
  assert.deepEqual([body.primary_action.key, body.primary_action.label, body.primary_action.href],
    ['build_pitch', 'Build pitch', `/raise/pitch?project_id=${P}`]);

  // A saved version that /deck-ready still has a row against: Saved, not reviewed; still Build pitch.
  deck(db, 5, 1, NOT_READY);
  body = await read(db);
  const p = pitchOf(body);
  assert.deepEqual([p.key, p.label, p.version, p.to_fix, p.unsaved_changes], ['saved', 'Saved, not reviewed', 1, 1, true]);
  assert.equal(body.primary_action.key, 'build_pitch');

  // The proposal kept: the working copy on the current version is what is unsaved now.
  db.exec(`DELETE FROM pitch_deck_proposals`);
  assert.equal(pitchOf(await read(db)).unsaved_changes, false);
  db.prepare(`INSERT INTO pitch_deck_cards (deck_id, card_uid, ord, json) VALUES (5, 'c1', 0, '{}')`).run();
  assert.equal(pitchOf(await read(db)).unsaved_changes, true);
});

test('3: a deck shared with no investors — Shared, and the deck rule chooses Share with investor', async () => {
  const db = fixture();
  deck(db, 5, 1, READY, 0);
  deck(db, 6, 2, READY);
  let body = await read(db);
  let p = pitchOf(body);
  assert.deepEqual([p.key, p.label, p.version, p.live_links, p.to_fix], ['reviewed', 'Reviewed, ready to send', 2, 0, 0]);
  assert.deepEqual([body.stage.key, body.primary_action.key, body.primary_action.label, body.primary_action.href],
    ['prepare_diligence', 'share_with_investor', 'Share with investor', `/raise/pitch/share?project_id=${P}`]);

  // Revoked and expired links are not live; a live one on the earlier version shares that version.
  link(db, 6, { revoked: '2026-11-11 09:00:00' });
  link(db, 6, { expires: '2026-11-17 00:00:00' });
  assert.equal(pitchOf(await read(db)).key, 'reviewed');
  const live = link(db, 5);
  db.prepare(`INSERT INTO deck_share_views (share_token_id, deck_id, created_at) VALUES (?, 5, '2026-11-16 10:00:00'), (?, 5, '2026-09-01 10:00:00')`).run(live, live);
  body = await read(db);
  p = pitchOf(body);
  assert.deepEqual([p.key, p.label, p.version, p.live_links], ['shared', 'Shared', 1, 1]);
  assert.equal(body.stage.key, 'prepare_diligence', 'no investor is in the pipeline yet');
  assert.equal(body.investor_activity.deck_views_8_weeks, 1, 'the September view is outside the eight weeks');
  assert.equal(body.investor_activity.sources.deck_views.source_updated_at, '2026-11-16 10:00:00');
  assert.deepEqual(body.investor_activity.recent[0], { at: '2026-11-16 10:00:00', kind: 'deck_opened', investor: 'Fund 3', detail: 'Opened the deck' });
});

test('4: an active round with prospects — Run the raise, Add investor, and investor activity with names', async () => {
  const db = fixture();
  prospect(db, 'meeting', '2026-11-15 09:00:00');
  prospect(db, 'to_contact', '2026-11-12 09:00:00');
  prospect(db, 'passed', '2026-11-17 09:00:00');
  const body = await read(db, { flags: { ROUND_CALLS_ENABLED: 'true' } });
  assert.deepEqual([body.stage.key, body.stage.label, body.primary_action.key, body.primary_action.label, body.primary_action.href],
    ['run_the_raise', 'Run the raise', 'add_investor', 'Add investor', `/raise/capital-relationships/new?project=${P}`]);
  const a = body.investor_activity;
  assert.equal(a.in_pipeline, 2, 'a passed investor is not in the pipeline');
  assert.equal(a.active_conversations, 1);
  assert.equal(a.call_responses_this_month, 0, 'round calls are on and none answered: a measured zero');
  assert.equal(a.sources.round_calls.status, 'ready');
  assert.equal(a.sources.pipeline.source_updated_at, '2026-11-17 09:00:00');
  assert.deepEqual(a.recent.map((e: any) => [e.at, e.kind, e.investor, e.detail]), [
    ['2026-11-17 09:00:00', 'prospect_updated', 'Investor 3 · Firm 3', 'Stage: Passed'],
    ['2026-11-15 09:00:00', 'prospect_updated', 'Investor 1 · Firm 1', 'Stage: Meeting'],
    ['2026-11-12 09:00:00', 'prospect_updated', 'Investor 2 · Firm 2', 'Stage: Identified'],
  ]);

  // A call response this month counts; one from last month does not.
  db.exec(`INSERT INTO round_calls (id, uid, project_id, name, amount_cents, instrument, terms, minimum_cheque_cents, target_close, terms_hash, created_by, state)
           VALUES (1, 'rc1', ${P}, 'Seed call', 100000, 'safe', 'Terms', 1000, '2026-12-31', 'h', ${FOUNDER}, 'sent')`);
  db.exec(`INSERT INTO round_call_recipients (call_id, investor_user_id, origin, responded_at, last_response_at)
           VALUES (1, 60, 'chosen', '2026-11-18 08:00:00', '2026-11-18 08:00:00'), (1, ${ADMIN}, 'chosen', '2026-10-20 08:00:00', '2026-10-20 08:00:00')`);
  const b2 = await read(db, { flags: { ROUND_CALLS_ENABLED: 'true' } });
  assert.equal(b2.investor_activity.call_responses_this_month, 1);
  assert.deepEqual(b2.investor_activity.recent[0], { at: '2026-11-18 08:00:00', kind: 'call_response', investor: 'Ivy Investor', detail: 'Responded to Seed call' });
});

test('5: an unreadable source makes the fields it feeds Unavailable, never a guessed stage', async () => {
  // The pipeline unreadable: the stage is not known, even with a ready deck that would otherwise choose it.
  const db = fixture();
  deck(db, 5, 1, READY);
  let body = await read(db, { needle: 'FROM raise_prospects' });
  assert.deepEqual(body.stage, { state: 'unreadable', reason: 'The investor pipeline could not be read, so the stage is not known.' });
  assert.deepEqual(body.primary_action, body.stage);
  assert.equal(body.investor_activity.in_pipeline, null);
  assert.equal(body.investor_activity.active_conversations, null);
  assert.equal(body.investor_activity.sources.pipeline.status, 'unavailable');
  assert.equal(body.investor_activity.deck_views_8_weeks, 0, 'the deck views read on their own');
  assert.equal(pitchOf(body).key, 'reviewed', 'the Pitch state does not read the pipeline');

  // The deck unreadable: no prospect, so the stage needs it and is Unavailable; so is the Pitch state.
  body = await read(db, { needle: 'is_current = 1' });
  assert.deepEqual(body.stage, { state: 'unreadable', reason: 'The deck could not be read, so the stage is not known.' });
  assert.deepEqual(pitchOf(body), { state: 'unreadable', reason: 'The deck could not be read, so its state is not known.' });

  // ...but with an investor in the pipeline the deck cannot change the answer, so the stage is known.
  prospect(db, 'meeting', '2026-11-15 09:00:00');
  body = await read(db, { needle: 'is_current = 1' });
  assert.equal(body.stage.key, 'run_the_raise');

  // The narrative unreadable, with no ready deck and no prospect: Unavailable, never Prepare.
  const db2 = fixture();
  body = await read(db2, { needle: 'spinout_deck_overrides' });
  assert.deepEqual(body.stage, { state: 'unreadable', reason: 'The narrative versions could not be read, so the stage is not known.' });

  // The links unreadable beside a saved deck: whether it is shared is not known.
  body = await read(db, { needle: 'pitch_deck_share_tokens' });
  assert.deepEqual(pitchOf(body), { state: 'unreadable', reason: 'The investor links could not be read, so whether the deck is shared is not known.' });
});

test('6: staff read the stage and the counts, with no investor names and no action', async () => {
  const db = fixture();
  prospect(db, 'meeting', '2026-11-15 09:00:00');
  const body = await read(db, { who: ADMIN });
  assert.equal(body.read_only, true);
  assert.equal(body.stage.key, 'run_the_raise');
  assert.equal(body.primary_action, null);
  assert.equal(body.investor_activity.in_pipeline, 1);
  assert.equal('recent' in body.investor_activity, false);
  assert.equal(pitchOf(body).key, 'no_deck');
});
