/**
 * D214 — H18 and H19, drawn on HQ · Content by `GET /api/admin/content/summary`:
 * the six-lane board (C3), the Assessment Studio (C1), the personas taxonomy
 * (C2) and the Advisors & Partners deck roster (C4).
 *
 * WHAT THIS FILE HOLDS THE ROUTE TO. The canvas draws four panels and says
 * they retire four consoles; the brief says nothing retires. So Content reads
 * what each console stores, says what none of them stores, and writes nothing.
 * Five rules run through the tests below.
 *
 *   1. Each block has three states — readable, empty, unreadable — and one
 *      block failing never empties another or fails the route.
 *   2. The GET alters no schema. A summary that bootstraps the tables it reads
 *      turns "could not be read" into "empty" (D204's rule for GETs).
 *   3. A lane's total is the sum of its parts only when every part answered;
 *      otherwise it is null and the store that failed is named. A total
 *      smaller than the truth is never shown as the total.
 *   4. The roster is marked by THE DECK'S OWN RULE. The test calls the deck's
 *      reader directly and holds the summary's order equal to it, and holds
 *      `deckRosterReach` equal to what `deckProfiles` and `deckMentorNames`
 *      pick for every shape of roster up to twelve rows.
 *   5. Nothing personal the panel does not draw leaves the database: no bio,
 *      no photo key, no LinkedIn URL.
 *
 * Every table is created from schema_baseline.sql verbatim, for the reason
 * admin_content_platform.test.ts gives: a fixture that invents a schema only
 * confirms its own assumptions. The three tables that post-date the baseline
 * are read off disk — `admin_publications` from migration 045, and
 * `hq_escalations` from 259 plus 267 — never retyped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import content from '../src/routes/admin_content.ts';
import { PERSONAS } from '../src/personas.ts';
import { GAME_STATUSES } from '../src/services/assessmentSchema.ts';
import { NETWORK_KINDS } from '../src/services/networkProfilesSchema.ts';
import { OPEN_ESCALATION_CEILING } from '../src/rpc/hqOps.ts';
import {
  DECK_ROSTER_NAMES, DECK_ROSTER_PROFILES, deckAdvisorRole, deckMentorNames, deckProfiles,
  deckRosterReach,
} from '../src/services/decks/deckRoster.ts';
import { loadNetworkProfiles } from '../src/services/decks/axalSpinoutDemoDay.ts';
import { codeOnly } from './_codeOnly.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 801;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
/**
 * `seen` records every statement the code under test prepares or execs — a
 * batch's statements were prepared first, so they are in it too. `after` runs
 * once a read has returned, so a test can land a write BETWEEN two reads: the
 * only way a test can tell one measurement from two measurements of the same
 * rows, which agree whenever nothing moves.
 */
type ShimOpts = { seen?: string[]; after?: (sql: string) => void };
function makeD1(db: InstanceType<typeof DatabaseSync>, opts: ShimOpts = {}) {
  return {
    prepare(sql: string) {
      opts.seen?.push(sql);
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { const row = db.prepare(sql).get(...b) ?? null; opts.after?.(sql); return row; },
        async all() { const results = db.prepare(sql).all(...b); opts.after?.(sql); return { results }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { opts.seen?.push(sql); db.exec(sql); return { count: 0, duration: 0 }; },
    // A batch is never executed here: the one caller that reaches it is the
    // deck reader's schema bootstrap, and the tests that call that reader run
    // it after every schema comparison is done. Which is exactly why a schema
    // comparison alone cannot see a bootstrap on the GET: its batch changes
    // nothing here, and the roster bootstrap swallows its own failed ALTER. The
    // statements are therefore recorded as they are prepared (see `seen`).
    async batch(x: any[]) { return x; },
  };
}

const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

/** Migration 045's table, off disk: it is not in the baseline. */
function publicationsDdl(): string {
  const sql = read('cloudflare-worker/sql/migrations/045_admin_publications.sql');
  const at = sql.search(/CREATE TABLE (IF NOT EXISTS )?admin_publications \(/);
  assert.ok(at >= 0, 'migration 045 no longer creates admin_publications');
  const end = sql.indexOf(');', at);
  assert.ok(end > at, 'the admin_publications definition in migration 045 is unterminated');
  return sql.slice(at, end + 2);
}

/** Migrations 259 and 267, off disk: the escalation table and its SLA claim. */
const M259 = read('cloudflare-worker/sql/migrations/259_hq_escalations.sql');
const M267 = read('cloudflare-worker/sql/migrations/267_hq_escalation_sla_claim.sql');

/** The tables the three panels read. The board reads the pipeline's and 259's. */
const PANEL_TABLES = [
  'assessment_games', 'assessment_chapters', 'assessment_archetypes', 'assessment_items',
  'assessment_sessions', 'user_personas', 'network_profiles',
];
const PIPELINE_TABLES = ['articles', 'legal_templates', 'legal_template_versions'];

function freshDb(opts: { without?: string[] } = {}) {
  const without = new Set(opts.without ?? []);
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of ['users', 'super_admins', ...PIPELINE_TABLES, ...PANEL_TABLES]) {
    if (!without.has(t)) db.exec(ddl(t));
  }
  if (!without.has('admin_publications')) db.exec(publicationsDdl());
  if (!without.has('hq_escalations')) { db.exec(M259); db.exec(M267); }
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)')
    .run(SUPER, 'admin', 'The Holder', 'holder@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  return db;
}

/** The route, called as the holder. */
async function summary(db: any, opts: ShimOpts = {}) {
  const jwt = await new SignJWT({ user_id: SUPER, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await content.fetch(
    new Request('http://x/summary', { headers: { Authorization: `Bearer ${jwt}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, opts) } as any,
  );
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* the status says it */ }
  return { status: res.status, body, text };
}

const schemaOf = (db: any): string => JSON.stringify(
  db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all(),
);

// ── Seeders, each writing only the columns its table requires ─────────────
let seq = 0;
function article(db: any, status: string, updatedAt: string | null = null): number {
  seq += 1;
  const r = db.prepare(
    `INSERT INTO articles (slug, title, status, author_user_id, updated_at)
     VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))`,
  ).run(`a-${seq}`, `Article ${seq}`, status, SUPER, updatedAt);
  return Number(r.lastInsertRowid);
}
function publication(db: any, status: string, updatedAt: string | null = null): number {
  seq += 1;
  const r = db.prepare(
    `INSERT INTO admin_publications (slug, title, section, status, created_by, updated_at)
     VALUES (?, ?, 'market_pulse', ?, ?, COALESCE(?, datetime('now')))`,
  ).run(`p-${seq}`, `Publication ${seq}`, status, SUPER, updatedAt);
  return Number(r.lastInsertRowid);
}
function escalation(db: any, kind: string, status: string, createdAt: string): string {
  seq += 1;
  const uid = `esc-${seq}`;
  db.prepare(
    `INSERT INTO hq_escalations (uid, branch_code, kind, subject, status, due_at, created_at)
     VALUES (?, 'fr', ?, ?, ?, ?, ?)`,
  ).run(uid, kind, `Subject ${seq}`, status, '2099-01-01T00:00:00.000Z', createdAt);
  return uid;
}
function game(db: any, g: { id: number; status: string; order: number; version?: number }) {
  db.prepare(
    `INSERT INTO assessment_games (id, slug, track, title, status, version, display_order)
     VALUES (?, ?, 'founder', ?, ?, ?, ?)`,
  ).run(g.id, `game-${g.id}`, `Game ${g.id}`, g.status, g.version ?? 1, g.order);
}
function chapter(db: any, gameId: number): number {
  seq += 1;
  return Number(db.prepare(
    'INSERT INTO assessment_chapters (game_id, slug, title) VALUES (?, ?, ?)',
  ).run(gameId, `ch-${seq}`, `Chapter ${seq}`).lastInsertRowid);
}
function archetype(db: any, gameId: number) {
  seq += 1;
  db.prepare(
    `INSERT INTO assessment_archetypes (game_id, track, slug, label) VALUES (?, 'founder', ?, ?)`,
  ).run(gameId, `ar-${seq}`, `Archetype ${seq}`);
}
function item(db: any, gameId: number, chapterId: number, active: 0 | 1) {
  seq += 1;
  db.prepare(
    `INSERT INTO assessment_items (game_id, chapter_id, slug, mechanic, prompt, is_active)
     VALUES (?, ?, ?, 'choice', 'A prompt', ?)`,
  ).run(gameId, chapterId, `it-${seq}`, active);
}
function session(db: any, gameId: number, status: string) {
  seq += 1;
  db.prepare(
    `INSERT INTO assessment_sessions (public_id, user_id, game_id, game_slug, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(`s-${seq}`, SUPER, gameId, `game-${gameId}`, status);
}
function account(db: any, id: number, active: 0 | 1) {
  db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, ?)')
    .run(id, 'founder', `User ${id}`, `u${id}@example.test`, active);
}
function tag(db: any, userId: number, personaId: string, primary: 0 | 1) {
  db.prepare('INSERT INTO user_personas (user_id, persona_id, is_primary) VALUES (?, ?, ?)')
    .run(userId, personaId, primary);
}
function profile(db: any, p: {
  name: string; order: number; active?: 0 | 1; kind?: string; role?: string | null;
  company?: string | null; bio?: string; linkedin?: string; photo?: string;
}): number {
  return Number(db.prepare(
    `INSERT INTO network_profiles
       (name, kind, role, company, bio, linkedin_url, photo_r2_key, display_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    p.name, p.kind ?? 'advisor', p.role ?? null, p.company ?? null, p.bio ?? null,
    p.linkedin ?? null, p.photo ?? null, p.order, p.active ?? 1,
  ).lastInsertRowid);
}

// ════════════════════════════════════════════════════════════════════════
// Rule 2 — the GET alters no schema
// ════════════════════════════════════════════════════════════════════════

/** A statement that changes a schema, bootstrap or not. */
const DDL = /^\s*(?:CREATE|ALTER|DROP)\b/i;

test('the GET alters no schema, with every table present', async () => {
  const db = freshDb();
  const before = schemaOf(db);
  const seen: string[] = [];
  const { status } = await summary(db, { seen });
  assert.equal(status, 200);
  assert.equal(schemaOf(db), before, 'reading the summary changed the schema');
  assert.ok(seen.length > 10, 'the shim recorded nothing, so the DDL check below proves nothing');
  assert.deepEqual(seen.filter((q) => DDL.test(q)), [],
    'the GET issued DDL — a bootstrap ran, even where it changed nothing');
});

test('the GET alters no schema and bootstraps nothing when every table is missing', async () => {
  const db = freshDb({
    without: [...PIPELINE_TABLES, ...PANEL_TABLES, 'admin_publications', 'hq_escalations'],
  });
  const before = schemaOf(db);
  const seen: string[] = [];
  const { status, body } = await summary(db, { seen });
  assert.equal(status, 200, 'a database with none of the tables must still answer');
  assert.equal(schemaOf(db), before,
    'a bootstrap ran — "could not be read" would now read as "empty"');
  // The comparison above cannot see a bootstrap whose batch this shim drops,
  // or one that swallows its own failure. The statements it was ASKED to run
  // can: none may create, alter or drop anything.
  assert.deepEqual(seen.filter((q) => DDL.test(q)), [],
    'the GET issued DDL against a database missing its tables — a bootstrap ran');
  for (const block of ['assessment', 'personas', 'roster']) {
    assert.equal(body[block].available, false, `${block} claimed to have read a missing table`);
    assert.ok(String(body[block].reason || '').length > 20, `${block} gives no reason`);
  }
  // The board says what it could not count rather than reporting zeroes.
  for (const lane of body.board.lanes) {
    assert.equal(lane.total, null, `lane ${lane.key} reports a total over tables that are missing`);
  }
  assert.equal(body.board.total, null);
  assert.equal(body.board.in_flight, null);
});

// ════════════════════════════════════════════════════════════════════════
// C3 — the board
// ════════════════════════════════════════════════════════════════════════

function seedBoard(db: any) {
  article(db, 'draft');
  article(db, 'draft');
  // THE REVIEW LANE IS MERGED FROM THREE STATEMENTS, and its stamps are in
  // both formats the table holds. `in_review` is newest; the ISO `submitted`
  // row is an hour OLDER on the same day, and a raw string compare would put
  // it first, because 'T' sorts above ' '.
  article(db, 'submitted', '2026-09-22T06:00:00.000Z');
  article(db, 'in_review', '2026-09-22 07:00:00');
  article(db, 'changes_requested', '2026-09-21T23:00:00.000Z');
  article(db, 'approved');
  article(db, 'published');
  article(db, 'rejected');
  article(db, 'weird_status');
  publication(db, 'draft');
  publication(db, 'published');
  publication(db, 'published');
  publication(db, 'queued_for_print');
  const oldest = escalation(db, 'content', 'open', '2026-09-20 08:00:00');
  const newer = escalation(db, 'content', 'open', '2026-09-21 08:00:00');
  escalation(db, 'content', 'answered', '2026-09-19 08:00:00');
  escalation(db, 'content', 'declined', '2026-09-19 09:00:00');
  escalation(db, 'moderation', 'open', '2026-09-18 08:00:00');
  return { oldest, newer };
}

const laneOf = (body: any, key: string) => body.board.lanes.find((l: any) => l.key === key);

test('the board draws six lanes in H19\'s order, from the two stores and the escalations', async () => {
  const db = freshDb();
  seedBoard(db);
  const { status, body } = await summary(db);
  assert.equal(status, 200);
  assert.deepEqual(body.board.lanes.map((l: any) => l.key),
    ['draft', 'review', 'localisation', 'brand_approval', 'scheduled', 'published']);
  assert.deepEqual(body.board.lanes.map((l: any) => l.label),
    ['Draft', 'Review', 'Localisation', 'Brand approval', 'Scheduled', 'Published']);

  const totals = Object.fromEntries(body.board.lanes.map((l: any) => [l.key, l.total]));
  assert.deepEqual(totals, {
    draft: 3, review: 3, localisation: null, brand_approval: 2, scheduled: 1, published: 3,
  });
  // Localisation is refused with its reason, never given a number.
  const loc = laneOf(body, 'localisation');
  assert.deepEqual(loc.parts, []);
  assert.equal(loc.recorded, false);
  assert.match(loc.reason, /nothing records that one piece is a localisation/i);

  // Every item in a measured lane, and everything short of Published.
  assert.equal(body.board.total, 12);
  assert.equal(body.board.in_flight, 9);
});

test('each lane names its store, and the two meanings of published stay two parts', async () => {
  const db = freshDb();
  seedBoard(db);
  const { body } = await summary(db);
  const stores = (key: string) => laneOf(body, key).parts.map((p: any) => p.store);
  assert.deepEqual(stores('draft'), ['articles', 'publications']);
  assert.deepEqual(stores('review'), ['articles']);
  assert.deepEqual(stores('brand_approval'), ['escalations']);
  assert.deepEqual(stores('scheduled'), ['articles']);
  assert.deepEqual(stores('published'), ['articles', 'publications']);
  assert.deepEqual(laneOf(body, 'review').parts[0].statuses,
    ['submitted', 'in_review', 'changes_requested']);
  assert.deepEqual(laneOf(body, 'scheduled').parts[0].statuses, ['approved']);
  assert.match(laneOf(body, 'published').note, /Two meanings of "published"/);
  assert.match(laneOf(body, 'scheduled').note, /Nothing stores a publish time/);
});

test('a lane cannot disagree with the pipeline block beside it: one read, not two', async () => {
  const db = freshDb();
  seedBoard(db);
  // A second count of the same rows agrees with the first whenever nothing
  // moves, so agreement alone proves nothing. Right after each store's one
  // GROUP BY returns, a writer lands one more row in every lane. A board built
  // from that read cannot see them; a board that counts again would.
  const moved = { articles: 0, publications: 0 };
  const after = (sql: string) => {
    if (!moved.articles && /\bFROM articles GROUP BY status\b/.test(sql)) {
      moved.articles += 1;
      for (const st of ['draft', 'in_review', 'approved', 'published']) article(db, st);
    }
    if (!moved.publications && /\bFROM admin_publications GROUP BY status\b/.test(sql)) {
      moved.publications += 1;
      for (const st of ['draft', 'published']) publication(db, st);
    }
  };
  const { body } = await summary(db, { after });
  assert.deepEqual(moved, { articles: 1, publications: 1 },
    'a store\'s count never ran, so nothing moved between reads and this test proved nothing');
  const pipe = Object.fromEntries(body.pipeline.lanes.map((l: any) => [l.key, l.n]));
  const articlesIn = (key: string) => laneOf(body, key).parts.find((p: any) => p.store === 'articles').n;
  for (const key of ['draft', 'review', 'scheduled', 'published']) {
    assert.equal(articlesIn(key), pipe[key], `the ${key} lane counts articles differently from the pipeline`);
  }
  const pubs = body.publications.by_status;
  assert.equal(laneOf(body, 'draft').parts[1].n, pubs.draft);
  assert.equal(laneOf(body, 'published').parts[1].n, pubs.published);
});

test('cards are the newest rows per lane, in one order across both stamp formats', async () => {
  const db = freshDb();
  seedBoard(db);
  const { body } = await summary(db);
  const review = laneOf(body, 'review').parts[0].cards;
  assert.deepEqual(review.map((c: any) => c.status), ['in_review', 'submitted', 'changes_requested'],
    'the ISO row was sorted above a newer SQL-format row on the same day');
  for (const c of review) {
    assert.equal(c.store, 'article');
    assert.deepEqual(Object.keys(c).sort(), ['id', 'status', 'store', 'title', 'updated_at']);
  }
  assert.equal(laneOf(body, 'published').parts[1].cards[0].store, 'publication');
});

test('a lane shows at most three cards, and a status the count found empty is not queried', async () => {
  const db = freshDb();
  for (let i = 0; i < 5; i += 1) article(db, 'draft', `2026-09-2${i} 10:00:00`);
  const { body } = await summary(db);
  const cards = laneOf(body, 'draft').parts[0].cards;
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((c: any) => c.updated_at),
    ['2026-09-24 10:00:00', '2026-09-23 10:00:00', '2026-09-22 10:00:00']);
  assert.equal(laneOf(body, 'draft').parts[0].n, 5, 'the count is the store\'s, not the cards\'');
  assert.deepEqual(laneOf(body, 'review').parts[0].cards, []);
});

test('Brand approval counts open content escalations only, oldest first, from the one statement', async () => {
  const db = freshDb();
  const { oldest, newer } = seedBoard(db);
  const { body } = await summary(db);
  const part = laneOf(body, 'brand_approval').parts[0];
  assert.equal(part.n, 2, 'answered, declined or non-content escalations were counted');
  assert.deepEqual(part.cards.map((c: any) => c.uid), [oldest, newer]);
  for (const c of part.cards) {
    assert.deepEqual(Object.keys(c).sort(), ['branch_code', 'created_at', 'sla', 'store', 'subject', 'uid']);
    assert.equal(c.store, 'escalation');
    assert.equal(c.branch_code, 'fr');
  }
  assert.match(laneOf(body, 'brand_approval').note, /Axal subsidiaries only/);
  // The route reads `openEscalationSummary`, never its own `status = 'open'`.
  const src = read('cloudflare-worker/src/routes/admin_content.ts');
  assert.ok(src.includes('await openEscalationSummary(env)'), 'the lane stopped reading D204\'s statement');
  assert.ok(!/FROM hq_escalations/.test(src), 'the route wrote a second open-escalation statement');
});

test('past the ceiling the Brand approval lane has no total, and says why', async () => {
  const db = freshDb();
  const ins = db.prepare(
    `INSERT INTO hq_escalations (uid, branch_code, kind, subject, status, created_at)
     VALUES (?, 'fr', 'content', 'Busy', 'open', ?)`,
  );
  db.exec('BEGIN');
  for (let i = 0; i <= OPEN_ESCALATION_CEILING; i += 1) {
    ins.run(`bulk-${i}`, `2026-01-01 ${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`);
  }
  db.exec('COMMIT');
  const { body } = await summary(db);
  const lane = laneOf(body, 'brand_approval');
  assert.equal(lane.parts[0].n, null, 'a count cut at the ceiling was shown as the total');
  assert.ok(lane.parts[0].reason.includes(`More than ${OPEN_ESCALATION_CEILING} escalations`),
    'the reason does not name the ceiling');
  assert.equal(lane.parts[0].cards.length, 3, 'the oldest items are still exact and still shown');
  assert.equal(lane.total, null);
  assert.match(lane.total_reason, /escalations could not be counted/);
  assert.equal(body.board.total, null);
});

test('a lane whose part could not be read has no total, and names the store', async () => {
  const db = freshDb({ without: ['admin_publications'] });
  article(db, 'draft');
  article(db, 'submitted');
  article(db, 'published');
  const { status, body } = await summary(db);
  assert.equal(status, 200);
  assert.equal(body.publications.available, false);
  for (const key of ['draft', 'published']) {
    const lane = laneOf(body, key);
    assert.equal(lane.total, null, `the ${key} lane reported a total missing one of its stores`);
    assert.match(lane.total_reason, /^publications could not be counted/);
    const pub = lane.parts.find((p: any) => p.store === 'publications');
    assert.equal(pub.n, null, 'an unreadable part was counted as zero');
    assert.equal(pub.cards, null);
    assert.match(pub.reason, /publications table could not be read/);
    // The part that DID answer keeps its own count.
    assert.equal(lane.parts.find((p: any) => p.store === 'articles').n, 1);
  }
  assert.equal(laneOf(body, 'review').total, 1, 'a lane with no unreadable part lost its total');
  assert.equal(body.board.total, null);
  assert.equal(body.board.in_flight, null);
});

test('an unreadable escalation table empties only the Brand approval lane', async () => {
  const db = freshDb({ without: ['hq_escalations'] });
  article(db, 'draft');
  const { body } = await summary(db);
  const lane = laneOf(body, 'brand_approval');
  assert.equal(lane.parts[0].n, null);
  assert.equal(lane.parts[0].cards, null);
  assert.match(lane.parts[0].reason, /escalations table could not be read/);
  assert.equal(lane.total, null);
  assert.equal(laneOf(body, 'draft').total, 1);
});

test('a publication status outside the two is reported, never placed in a lane', async () => {
  const db = freshDb();
  seedBoard(db);
  const { body } = await summary(db);
  assert.deepEqual(body.board.other_publication_statuses, [{ status: 'queued_for_print', n: 1 }]);
  assert.deepEqual(body.pipeline.unmapped_statuses, [{ status: 'weird_status', n: 1 }]);
  assert.equal(body.board.publish_time.recorded, false);
  assert.equal(body.board.origin.recorded, false);
  assert.match(body.board.origin.reason, /only a content escalation carries a branch code/);
});

// ════════════════════════════════════════════════════════════════════════
// C1 — the Assessment Studio
// ════════════════════════════════════════════════════════════════════════

function seedAssessment(db: any, opts: { sessions?: boolean } = {}) {
  game(db, { id: 1, status: 'published', order: 2, version: 3 });
  game(db, { id: 2, status: 'draft', order: 1 });
  game(db, { id: 3, status: 'archived', order: 1 });
  game(db, { id: 4, status: 'retired', order: 9 });
  const c1 = chapter(db, 1);
  chapter(db, 1);
  const c2 = chapter(db, 2);
  archetype(db, 1); archetype(db, 1); archetype(db, 1);
  item(db, 1, c1, 1); item(db, 1, c1, 1); item(db, 1, c1, 1); item(db, 1, c1, 0);
  item(db, 2, c2, 1);
  if (opts.sessions === false) return;
  session(db, 1, 'completed'); session(db, 1, 'completed'); session(db, 1, 'in_progress');
  session(db, 2, 'abandoned');
}

test('each game carries its own chapters, archetypes, active questions and completed runs', async () => {
  const db = freshDb();
  seedAssessment(db);
  const { body } = await summary(db);
  const a = body.assessment;
  assert.equal(a.available, true);
  assert.deepEqual(a.games.map((g: any) => g.id), [2, 3, 1, 4], 'not the console\'s display order');
  const g = Object.fromEntries(a.games.map((x: any) => [x.id, x]));
  assert.deepEqual(
    { chapters: g[1].chapters, archetypes: g[1].archetypes, questions: g[1].questions, runs: g[1].runs, version: g[1].version },
    { chapters: 2, archetypes: 3, questions: 3, runs: 2, version: 3 },
    'game 1 counted another game\'s rows, an inactive question or an unfinished run',
  );
  assert.deepEqual(
    { chapters: g[2].chapters, archetypes: g[2].archetypes, questions: g[2].questions, runs: g[2].runs },
    { chapters: 1, archetypes: 0, questions: 1, runs: 0 },
  );
  assert.equal(a.games_total, 4);
  assert.deepEqual(a.by_status, { draft: 1, published: 1, archived: 1 });
  assert.deepEqual(Object.keys(a.by_status), [...GAME_STATUSES]);
  assert.deepEqual(a.other_statuses, [{ status: 'retired', n: 1 }], 'a status outside the three was dropped');
  assert.equal(a.chapters_total, 3);
  assert.equal(a.archetypes_total, 3);
  assert.equal(a.runs_available, true);
  assert.equal(a.truncated, false);
  // "Live on N branches" is refused, never drawn as a number.
  assert.equal(a.branches.recorded, false);
  assert.match(a.branches.reason, /No game reaches a branch/);
  assert.match(a.runs_basis, /routes that recorded a run are retired/);
});

test('an unreadable sessions table leaves the games listed and every run unreadable', async () => {
  const db = freshDb({ without: ['assessment_sessions'] });
  seedAssessment(db, { sessions: false });
  const { body } = await summary(db);
  const a = body.assessment;
  assert.equal(a.available, true, 'a missing sessions table took the games down with it');
  assert.equal(a.games.length, 4);
  for (const g of a.games) assert.equal(g.runs, null, 'an unreadable run count was shown as a number');
  assert.equal(a.runs_available, false);
  assert.match(a.runs_reason, /sessions table could not be read/);
});

test('no games is an empty studio, and missing tables are an unreadable one', async () => {
  const empty = await summary(freshDb());
  assert.equal(empty.body.assessment.available, true);
  assert.deepEqual(empty.body.assessment.games, []);
  assert.equal(empty.body.assessment.games_total, 0);
  assert.deepEqual(empty.body.assessment.by_status, { draft: 0, published: 0, archived: 0 });

  const missing = await summary(freshDb({ without: ['assessment_games'] }));
  assert.equal(missing.status, 200);
  assert.equal(missing.body.assessment.available, false);
  assert.equal(missing.body.assessment.games, undefined, 'an unreadable studio still listed games');
  assert.match(missing.body.assessment.reason, /could not be read/);
});

test('the games list stops at fifty and says it was cut', async () => {
  const db = freshDb();
  for (let i = 1; i <= 51; i += 1) game(db, { id: i, status: 'draft', order: i });
  const { body } = await summary(db);
  assert.equal(body.assessment.games.length, 50);
  assert.equal(body.assessment.truncated, true);
  assert.equal(body.assessment.games_total, 51, 'the total was read off the cut list');
});

// ════════════════════════════════════════════════════════════════════════
// C2 — the personas taxonomy
// ════════════════════════════════════════════════════════════════════════

const P0 = PERSONAS[0].id;
const P1 = PERSONAS[1].id;

function seedPersonas(db: any) {
  account(db, 11, 1); tag(db, 11, P0, 1);                  // one primary
  account(db, 12, 1); tag(db, 12, P1, 1);                  // one primary
  account(db, 13, 1); tag(db, 13, P0, 0);                  // a secondary tag only
  account(db, 14, 0); tag(db, 14, P0, 1);                  // inactive
  account(db, 15, 1); tag(db, 15, 'ghost_persona', 1);     // not in the code's set
  account(db, 16, 1); tag(db, 16, P0, 1); tag(db, 16, P1, 1); // two primaries
}

test('every persona the code defines is listed, in the code\'s order, counted by primary tag', async () => {
  const db = freshDb();
  seedPersonas(db);
  const { body } = await summary(db);
  const p = body.personas;
  assert.equal(p.available, true);
  assert.deepEqual(p.items.map((i: any) => i.id), PERSONAS.map((x) => x.id));
  assert.deepEqual(p.items.map((i: any) => i.label), PERSONAS.map((x) => x.label));
  const n = Object.fromEntries(p.items.map((i: any) => [i.id, i.tagged]));
  assert.equal(n[P0], 2, 'a secondary tag or an inactive account was counted');
  assert.equal(n[P1], 2);
  for (const i of p.items.slice(2)) assert.equal(i.tagged, 0, 'a persona nobody carries is a measured zero');
});

test('a tag outside the code\'s set is reported, and the footing says what the counts are over', async () => {
  const db = freshDb();
  seedPersonas(db);
  const { body } = await summary(db);
  const p = body.personas;
  assert.deepEqual(p.unrecognised, [{ id: 'ghost_persona', tagged: 1 }]);
  // Active: the holder, 11, 12, 13, 15, 16. Unclassified: the holder and 13.
  assert.equal(p.active_accounts, 6);
  assert.equal(p.unclassified, 2);
  assert.equal(p.accounts_tagged, 4);
  assert.equal(p.multi_primary, 1, 'an account with two primary tags was not reported');
  // The rows sum past the tagged accounts by exactly the second primary.
  assert.equal(p.tagged_sum, 5);
  assert.match(p.schema_note, /defined in code/);
  assert.match(p.scope_note, /HQ's database only/);
});

test('personas: empty and unreadable are two states', async () => {
  const empty = await summary(freshDb());
  assert.equal(empty.body.personas.available, true);
  assert.equal(empty.body.personas.accounts_tagged, 0);
  assert.equal(empty.body.personas.unclassified, 1, 'the holder carries no tag and is unclassified');

  const missing = await summary(freshDb({ without: ['user_personas'] }));
  assert.equal(missing.body.personas.available, false);
  assert.equal(missing.body.personas.items, undefined, 'an unreadable taxonomy still listed counts');
  assert.match(missing.body.personas.reason, /could not be read/);
});

// ════════════════════════════════════════════════════════════════════════
// C4 — the Advisors & Partners deck roster
// ════════════════════════════════════════════════════════════════════════

test('the roster comes out in the deck\'s own order, read by the deck\'s own reader', async () => {
  const db = freshDb();
  // Inserted out of order on purpose; display_order ties break on name, then id.
  profile(db, { name: 'Zoe', order: 2 });
  profile(db, { name: 'Adam', order: 2 });
  profile(db, { name: 'Mia', order: 1 });
  profile(db, { name: 'Old Hand', order: 0, active: 0 });
  profile(db, { name: 'Bea', order: 3 });
  profile(db, { name: 'Bea', order: 3 });
  const { body } = await summary(db);
  const env = { DB: makeD1(db), ENVIRONMENT: 'development' } as any;
  const deck = await loadNetworkProfiles(env);
  const active = body.roster.rows.filter((r: any) => r.active);
  assert.deepEqual(active.map((r: any) => r.name), deck.map((d) => d.name),
    'the panel and the deck read the roster in different orders');
  assert.deepEqual(active.map((r: any) => r.name), ['Mia', 'Adam', 'Zoe', 'Bea', 'Bea']);
  // Archived rows come after every active one, and are never the deck's.
  const last = body.roster.rows[body.roster.rows.length - 1];
  assert.deepEqual([last.name, last.active, last.reach], ['Old Hand', false, 'archived']);
});

test('each active row is marked with what the deck does with it, at the two caps', async () => {
  const db = freshDb();
  const names = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'];
  names.forEach((name, i) => profile(db, { name, order: i }));
  profile(db, { name: 'Gone', order: 0, active: 0 });
  const { body } = await summary(db);
  const reach = body.roster.rows.map((r: any) => [r.name, r.reach]);
  assert.deepEqual(reach, [
    ['A1', 'profile'], ['A2', 'profile'], ['A3', 'profile'], ['A4', 'profile'], ['A5', 'profile'],
    ['A6', 'profile'],            // row 6 — the last the Team & Network slide is passed
    ['A7', 'named'],              // row 7 — by name only
    ['A8', 'named'],              // row 8 — the eighth name
    ['A9', 'counted'],            // row 9 — counted, never named
    ['A10', 'counted'],
    ['Gone', 'archived'],
  ]);
  assert.deepEqual(body.roster.caps, { profiles: DECK_ROSTER_PROFILES, names: DECK_ROSTER_NAMES });
  assert.equal(DECK_ROSTER_PROFILES, 6);
  assert.equal(DECK_ROSTER_NAMES, 8);
});

test('a row with no name inside the profile cap is drawn nameless and frees a name slot', async () => {
  const db = freshDb();
  ['B1', 'B2', '', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10'].forEach((name, i) => profile(db, { name, order: i }));
  const { body } = await summary(db);
  assert.deepEqual(body.roster.rows.map((r: any) => r.reach), [
    'profile', 'profile', 'profile', 'profile', 'profile', 'profile',
    'named', 'named', 'named', 'counted',
  ], 'a nameless profile was counted against the eight names');
  const deck = await loadNetworkProfiles({ DB: makeD1(db), ENVIRONMENT: 'development' } as any);
  const namedHere = body.roster.rows
    .filter((r: any) => (r.reach === 'profile' && r.name) || r.reach === 'named')
    .map((r: any) => r.name);
  assert.deepEqual(namedHere, deckMentorNames(deck), 'the panel names a different eight than the deck');
});

test('"Role on decks" is exactly what the slide prints, and only for a row it draws', async () => {
  const db = freshDb();
  profile(db, { name: 'Has role', order: 0, role: 'Operating Partner' });
  profile(db, { name: 'Blank role', order: 1, role: '' });
  profile(db, { name: 'Dash role', order: 2, role: '—' });
  profile(db, { name: 'No role', order: 3, role: null });
  for (let i = 4; i < 7; i += 1) profile(db, { name: `Filler ${i}`, order: i, role: 'Mentor' });
  const { body } = await summary(db);
  const byName = Object.fromEntries(body.roster.rows.map((r: any) => [r.name, r]));
  assert.equal(byName['Has role'].deck_role, 'Operating Partner');
  assert.equal(byName['Blank role'].deck_role, 'Advisor');
  assert.equal(byName['Dash role'].deck_role, 'Advisor');
  assert.equal(byName['No role'].deck_role, 'Advisor');
  assert.equal(byName['Blank role'].role, null, 'an empty role was sent as a role');
  assert.equal(byName['Filler 6'].reach, 'named');
  assert.equal(byName['Filler 6'].deck_role, null, 'a row the slide does not draw was given a printed role');
  for (const r of body.roster.rows.filter((x: any) => x.reach === 'profile')) {
    assert.equal(r.deck_role, deckAdvisorRole(r.role ?? ''));
  }
});

test('counts by kind name every kind the code knows and report one it does not', async () => {
  const db = freshDb();
  profile(db, { name: 'A', order: 0, kind: 'advisor' });
  profile(db, { name: 'B', order: 1, kind: 'partner', active: 0 });
  profile(db, { name: 'C', order: 2, kind: 'coach' });
  const { body } = await summary(db);
  const kinds = Object.fromEntries(body.roster.by_kind.map((k: any) => [k.kind, k]));
  for (const k of NETWORK_KINDS) assert.equal(kinds[k].known, true, `${k} is missing from the counts`);
  assert.deepEqual([kinds.advisor.active, kinds.advisor.archived], [1, 0]);
  assert.deepEqual([kinds.partner.active, kinds.partner.archived], [0, 1]);
  assert.deepEqual([kinds.coach.known, kinds.coach.active], [false, 1]);
  assert.equal(body.roster.active, 2);
  assert.equal(body.roster.archived, 1);
  assert.equal(body.roster.nominations.recorded, false);
  assert.match(body.roster.nominations.reason, /Nothing records who put a person on the roster/);
  assert.match(body.roster.branch_rule, /A branch authors its own roster/);
});

test('the roster list stops at fifty and says it was cut', async () => {
  const db = freshDb();
  for (let i = 0; i < 51; i += 1) profile(db, { name: `R${String(i).padStart(2, '0')}`, order: i });
  const { body } = await summary(db);
  assert.equal(body.roster.rows.length, 50);
  assert.equal(body.roster.truncated, true);
  assert.equal(body.roster.active, 51, 'the count was read off the cut list');
});

test('archived rows never push an active row off the fifty-row list', async () => {
  // Archived rows sorted first by display order would fill the fifty slots and
  // hide every row the deck reads. The panel sorts active rows ahead of
  // archived ones whatever their display order, so the list can be cut
  // without cutting the deck.
  const db = freshDb();
  for (let i = 0; i < 55; i += 1) profile(db, { name: `Old ${String(i).padStart(2, '0')}`, order: 0, active: 0 });
  ['Live A', 'Live B', 'Live C'].forEach((name, i) => profile(db, { name, order: 100 + i }));
  const { body } = await summary(db);
  assert.equal(body.roster.rows.length, 50);
  assert.equal(body.roster.truncated, true);
  assert.deepEqual(body.roster.rows.slice(0, 3).map((r: any) => [r.name, r.reach]),
    [['Live A', 'profile'], ['Live B', 'profile'], ['Live C', 'profile']],
    'archived rows filled the list and the deck\'s own rows fell off it');
  assert.equal(body.roster.active, 3);
  assert.equal(body.roster.archived, 55);
});

test('roster: empty and unreadable are two states', async () => {
  const empty = await summary(freshDb());
  assert.equal(empty.body.roster.available, true);
  assert.deepEqual(empty.body.roster.rows, []);
  const missing = await summary(freshDb({ without: ['network_profiles'] }));
  assert.equal(missing.body.roster.available, false);
  assert.equal(missing.body.roster.rows, undefined);
  assert.match(missing.body.roster.reason, /could not be read/);
});

test('deckRosterReach picks exactly what deckProfiles and deckMentorNames pick, for every roster up to twelve', () => {
  // Every pattern of named and nameless rows, lengths 0 to 12: 8,191 rosters.
  for (let n = 0; n <= 12; n += 1) {
    for (let mask = 0; mask < (1 << n); mask += 1) {
      const names = Array.from({ length: n }, (_, i) => ((mask >> i) & 1 ? `N${i}` : ''));
      const rows = names.map((name, i) => ({ name, i }));
      const reach = deckRosterReach(names);
      const drawn = new Set(deckProfiles(rows).map((r) => r.i));
      const profiles = reach.flatMap((r, i) => (r === 'profile' ? [i] : []));
      assert.deepEqual(profiles, [...drawn], `profiles differ for ${JSON.stringify(names)}`);
      const named = names.filter((name, i) => (reach[i] === 'profile' && name) || reach[i] === 'named');
      assert.deepEqual(named, deckMentorNames(rows), `names differ for ${JSON.stringify(names)}`);
      for (let i = 0; i < n; i += 1) {
        if (reach[i] === 'counted') assert.ok(!drawn.has(i));
      }
    }
  }
});

test('the deck builds its roster through the same two helpers the panel reads', () => {
  // deckProfiles is `slice(0, DECK_ROSTER_PROFILES)`, so a deck that cut its
  // own roster by a literal 6 would behave identically today and drift the day
  // the cap moves — the panel would then mark rows the slide no longer draws.
  // No behaviour can tell the two apart until then, so this reads the source.
  const src = codeOnly(read('cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts'));
  assert.match(src, /\bdeckProfiles\(\s*networkRoster\s*\)/,
    'the deck no longer takes its profile block from deckProfiles');
  assert.match(src, /\bdeckMentorNames\(\s*networkRoster\s*\)/,
    'the deck no longer takes its names list from deckMentorNames');
  assert.doesNotMatch(src, /\bnetworkRoster\s*\.\s*slice\s*\(/,
    'the deck cuts its own roster instead of asking deckRoster.ts');
});

// ════════════════════════════════════════════════════════════════════════
// Rule 1 and rule 5 — isolation, and what never leaves the database
// ════════════════════════════════════════════════════════════════════════

test('one unreadable panel never empties another', async () => {
  const db = freshDb({ without: ['network_profiles'] });
  seedAssessment(db);
  seedPersonas(db);
  seedBoard(db);
  const { status, body } = await summary(db);
  assert.equal(status, 200);
  assert.equal(body.roster.available, false);
  assert.equal(body.assessment.available, true);
  assert.equal(body.personas.available, true);
  assert.equal(body.board.total, 12);
  assert.equal(body.pipeline.available, true);
});

test('no bio, photo key or LinkedIn URL reaches the payload', async () => {
  const db = freshDb();
  profile(db, {
    name: 'Private', order: 0, bio: 'BIO-SENTINEL-7Q2', linkedin: 'https://linkedin.example/LI-SENTINEL-7Q2',
    photo: 'network/PHOTO-SENTINEL-7Q2.png',
  });
  const { text, body } = await summary(db);
  assert.ok(!text.includes('SENTINEL-7Q2'), 'a field the panel never draws was sent');
  assert.deepEqual(Object.keys(body.roster.rows[0]).sort(),
    ['active', 'company', 'deck_role', 'id', 'kind', 'name', 'reach', 'role']);
});

test('the four new blocks carry no console path: the page writes each link itself', async () => {
  const db = freshDb();
  seedAssessment(db);
  seedPersonas(db);
  seedBoard(db);
  profile(db, { name: 'A', order: 0 });
  const { body } = await summary(db);
  for (const block of ['assessment', 'personas', 'roster', 'board']) {
    assert.ok(!JSON.stringify(body[block]).includes('/admin'),
      `${block} carries a path — a field nothing reads is not a pointer`);
  }
});
