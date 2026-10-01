/**
 * Withdrawing a deck share link — Task #196, and the four ways it could be fake.
 *
 * A founder could mint a link and never stop it. `pitch_deck_share_tokens` had
 * `expires_at`, `used_at`, `view_limit` and `view_count` — four ways for a link to
 * run out on its own and none for its owner to end it — while the Engagement
 * panel listed the link and its view count, so the founder could watch a link
 * they could not stop being used. Migration 248 adds `revoked_at` and
 * `DELETE /api/decks/:id/shares/:shareId` sets it.
 *
 * WHAT THIS FILE IS FOR IS THE FOUR FAILURES THAT WOULD LOOK LIKE SUCCESS:
 *
 *   · The withdraw writes `revoked_at` and the CLAIM QUERY IGNORES IT. Revoking
 *     also sets `expires_at`, so the link would in fact stop opening and the
 *     column would look load-bearing while the route's actual guarantee rested on
 *     one of two writes landing. `refuses a link that is revoked but NOT yet
 *     expired` is the only case that can tell those apart, and it is why the
 *     claim query carries `AND revoked_at IS NULL` rather than relying on the
 *     expiry it also sets.
 *   · The second withdraw OVERWRITES the first timestamp. The founder then learns
 *     the link was ended today rather than the day they discovered the leak, and
 *     the one fact they want from the record is the one that moved.
 *   · The scope check is on `id` alone, so a founder who owns deck A ends a link
 *     on deck B by guessing a number. The row is looked up
 *     `WHERE id = ? AND deck_id = ?` for exactly this reason.
 *   · The withdraw DELETES the token, orphaning every `deck_share_views` row
 *     (`share_token_id` has no FK and would dangle) and taking the impression
 *     history with it — the evidence a founder most wants after discovering the
 *     link went somewhere it should not have. `routes/captable.ts` got here
 *     first: *"Revoke by expiring rather than deleting, so the view history
 *     stays attributable to a link the owner can still see they created."*
 *
 * THE SQL UNDER TEST IS READ OUT OF THE ROUTE, NOT RETYPED HERE. A hand-copied
 * predicate is a second query that agrees with the first until someone edits one
 * of them, and the whole subject of this file is a predicate that must not be
 * dropped. `sqlNear` lifts the real statement out of `decks.ts` and runs it, so
 * deleting `AND revoked_at IS NULL` from the route turns this file red.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs --test \
 *     cloudflare-worker/test/deck_share_revoke.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, '..', p), 'utf8');

const ROUTE = read('src/routes/decks.ts');
const MIGRATION = read('sql/migrations/248_deck_share_revoked_at.sql');
const BASELINE = read('sql/schema_baseline.sql');

/**
 * The string literal in `decks.ts` that `needle` sits inside.
 *
 * ANCHORED ON `prepare(`, NOT ON THE NEAREST QUOTE. The first version of this
 * reader walked outwards to the nearest quote character in each direction and cut
 * the claim query in half at the apostrophe inside `datetime('now')` — SQLite
 * then rejected the fragment as "incomplete input", which at least failed loudly.
 * Starting at the `prepare(` that owns the statement gets the opening delimiter
 * right, and the closing one is then the next quote OF THE SAME KIND.
 *
 * Every statement this file runs is `?`-bound with no interpolation, so what
 * comes back is the exact SQL D1 receives.
 */
function sqlNear(needle: string): string {
  const at = ROUTE.indexOf(needle);
  assert.ok(at > 0, `decks.ts no longer contains: ${needle}`);
  const open = ROUTE.lastIndexOf('prepare(', at);
  assert.ok(open > 0, `${needle} is not inside a prepare() call`);
  let start = open + 'prepare('.length;
  while (start < at && !'`\'"'.includes(ROUTE[start])) start += 1;
  assert.ok(start < at, 'no string literal between prepare( and the needle');
  const quote = ROUTE[start];
  const end = ROUTE.indexOf(quote, at);
  assert.ok(end > start, 'could not delimit the statement');
  const sql = ROUTE.slice(start + 1, end);
  assert.ok(/^\s*(SELECT|UPDATE|INSERT|DELETE)/i.test(sql), `not a statement: ${sql.slice(0, 60)}`);
  return sql;
}

/** The claim in `GET /share/:token` — the one that decides if a link opens. */
const CLAIM = sqlNear('SET view_count = view_count + 1');
/** The withdraw in `DELETE /:id/shares/:shareId`. */
const REVOKE = sqlNear("SET revoked_at = datetime('now'), expires_at = datetime('now')");
/** The ownership lookup that runs before it. */
const SCOPE = sqlNear('SELECT id, revoked_at FROM pitch_deck_share_tokens WHERE id = ? AND deck_id = ?');

/**
 * THE TABLE IS BUILT THE WAY PRODUCTION GOT IT: the baseline shape, then
 * migration 248's ALTER applied verbatim. A fixture that typed the post-248
 * shape directly would pass with the migration file empty — which is the one
 * thing a migration test exists to catch.
 */
function ddlFromBaseline(table: string): string {
  const at = BASELINE.indexOf(`CREATE TABLE ${table} (`);
  assert.ok(at >= 0, `the baseline no longer defines ${table}`);
  const end = BASELINE.indexOf(';', at);
  assert.ok(end > at, 'the baseline DDL does not close where this reader expects');
  return BASELINE.slice(at, end + 1);
}

/**
 * Migration 248 with its header comments stripped — the SQL D1 would actually be
 * asked to run.
 *
 * THE COMMENTS HAVE TO GO BEFORE ANYTHING IS ASSERTED ABOUT THE TEXT, and the
 * BEGIN/COMMIT check is why: the header explains *why there is no BEGIN*, so a
 * check against the raw file reports the prose as the violation and would push
 * the next person to delete the explanation rather than keep the property. Prose
 * satisfying — or here breaking — a code assertion is the same bug either way.
 */
const MIGRATION_SQL = MIGRATION.replace(/^\s*--[^\n]*$/gm, '');

function migrationStatements(): string[] {
  return MIGRATION_SQL.split(';').map((s) => s.trim()).filter(Boolean);
}

const FUTURE = '2099-01-01 00:00:00';
const PAST = '2000-01-01 00:00:00';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(ddlFromBaseline('pitch_deck_share_tokens'));
  db.exec(ddlFromBaseline('deck_share_views'));
  for (const stmt of migrationStatements()) db.exec(stmt);
  return db;
}

interface Seed {
  hash: string;
  deck?: number;
  expires?: string;
  count?: number;
  limit?: number;
  used?: string | null;
  revoked?: string | null;
}

function seed(db: InstanceType<typeof DatabaseSync>, rows: Seed[]): Record<string, number> {
  const ins = db.prepare(
    `INSERT INTO pitch_deck_share_tokens
       (deck_id, token_hash, expires_at, used_at, view_limit, view_count, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const ids: Record<string, number> = {};
  for (const r of rows) {
    const res = ins.run(
      r.deck ?? 1, r.hash, r.expires ?? FUTURE, r.used ?? null,
      r.limit ?? 1, r.count ?? 0, r.revoked ?? null,
    );
    ids[r.hash] = Number(res.lastInsertRowid);
  }
  return ids;
}

/** Run the route's own claim statement. Returns rows changed — 1 means it opened. */
function claim(db: InstanceType<typeof DatabaseSync>, hash: string): number {
  return Number(db.prepare(CLAIM).run(hash).changes);
}

// ---------------------------------------------------------------- the claim

test('a live link still opens, and every dead one is refused', () => {
  const db = freshDb();
  seed(db, [
    { hash: 'live' },
    { hash: 'revoked', expires: FUTURE, revoked: '2026-09-01 10:00:00' },
    { hash: 'expired', expires: PAST },
    { hash: 'spent', count: 1, limit: 1 },
    { hash: 'both', expires: PAST, revoked: '2026-09-01 10:00:00' },
  ]);

  // THE GOOD PATH FIRST. A refusal test that never checks the accept passes with
  // the claim query broken for everyone.
  assert.equal(claim(db, 'live'), 1, 'a live share link no longer opens');
  assert.equal(claim(db, 'expired'), 0);
  assert.equal(claim(db, 'spent'), 0);
  assert.equal(claim(db, 'both'), 0);

  // AND THE CASE THAT PINS THE PREDICATE. `revoked` is not expired and has views
  // left: the ONLY thing stopping it is `AND revoked_at IS NULL`. Drop that from
  // the route and this is the assertion that fails.
  assert.equal(claim(db, 'revoked'), 0,
    'a withdrawn link still opens — the claim query is not checking revoked_at');

  // A refused claim consumed nothing, so the founder's own record of the link is
  // unchanged. A claim that incremented before refusing would show a view that
  // never happened.
  const row = db.prepare('SELECT view_count, last_viewed_at FROM pitch_deck_share_tokens WHERE token_hash = ?')
    .get('revoked') as any;
  assert.equal(Number(row.view_count), 0, 'a refused claim still counted a view');
  assert.equal(row.last_viewed_at, null);
});

test('the second claim on a one-view link is refused', () => {
  // Task #53's guarantee, re-checked here because migration 248 touched the
  // predicate list it lives in. Two predicates in one WHERE is how one of them
  // gets dropped with the other looking like it still works.
  const db = freshDb();
  seed(db, [{ hash: 'once', limit: 1 }]);
  assert.equal(claim(db, 'once'), 1);
  assert.equal(claim(db, 'once'), 0, 'a one-view link opened twice');
  const row = db.prepare('SELECT view_count, used_at FROM pitch_deck_share_tokens WHERE token_hash = ?')
    .get('once') as any;
  assert.equal(Number(row.view_count), 1);
  assert.ok(row.used_at, 'the claim no longer stamps used_at when the last view is spent');
});

// ------------------------------------------------------------- the withdraw

test('withdrawing stops the link and is visible as the owner ending it', () => {
  const db = freshDb();
  const ids = seed(db, [{ hash: 'doomed' }]);
  assert.equal(claim(db, 'doomed'), 1, 'precondition: the link opens before it is withdrawn');

  // Reset the single view so the refusal below can only come from the withdraw.
  db.prepare('UPDATE pitch_deck_share_tokens SET view_count = 0, used_at = NULL WHERE id = ?')
    .run(ids.doomed);

  const changed = Number(db.prepare(REVOKE).run(ids.doomed).changes);
  assert.equal(changed, 1, 'the withdraw wrote nothing');
  assert.equal(claim(db, 'doomed'), 0, 'the link still opens after being withdrawn');

  const row = db.prepare('SELECT revoked_at, expires_at FROM pitch_deck_share_tokens WHERE id = ?')
    .get(ids.doomed) as any;
  assert.ok(row.revoked_at, 'revoked_at was not set');
  assert.ok(row.expires_at, 'expires_at was cleared rather than brought forward');
  // BOTH, not one. The expiry is what makes the link dead to anything that reads
  // only `expires_at`; `revoked_at` is what says a person ended it.
  assert.equal(String(row.expires_at).slice(0, 10), String(row.revoked_at).slice(0, 10));
});

test('withdrawing twice keeps the FIRST timestamp', () => {
  // The founder wants the day they discovered the leak, not the day they clicked
  // the button again. `WHERE revoked_at IS NULL` is the whole mechanism, so the
  // second call must report zero rows changed rather than a fresh stamp.
  const db = freshDb();
  const FIRST = '2026-08-14 09:30:00';
  const ids = seed(db, [{ hash: 'already', revoked: FIRST }]);

  const changed = Number(db.prepare(REVOKE).run(ids.already).changes);
  assert.equal(changed, 0, 'a second withdraw rewrote the record of the first');

  const row = db.prepare('SELECT revoked_at FROM pitch_deck_share_tokens WHERE id = ?')
    .get(ids.already) as any;
  assert.equal(row.revoked_at, FIRST, 'the original withdraw timestamp was overwritten');
});

test('a link on another deck cannot be withdrawn by guessing its id', () => {
  // The scope lookup is the authorization, because the ownership check upstream
  // is on the DECK. Without `AND deck_id = ?` a founder who owns deck 1 ends any
  // link in the table by incrementing a number.
  const db = freshDb();
  const ids = seed(db, [{ hash: 'theirs', deck: 2 }]);

  const asDeck1 = db.prepare(SCOPE).get(ids.theirs, 1) ?? null;
  assert.equal(asDeck1, null, 'a token on another deck is visible to this deck’s owner');
  const asDeck2 = db.prepare(SCOPE).get(ids.theirs, 2) as any;
  assert.ok(asDeck2, 'the owning deck cannot find its own token');
  assert.equal(Number(asDeck2.id), ids.theirs);

  // And the route returns 404 on that null rather than falling through to the
  // UPDATE, so the link stays live.
  const at = ROUTE.indexOf("decks.delete('/:id/shares/:shareId'");
  assert.ok(at > 0, 'the withdraw route is gone');
  const body = ROUTE.slice(at, ROUTE.indexOf('\n});', at));
  const scopeAt = body.indexOf('WHERE id = ? AND deck_id = ?');
  const guardAt = body.indexOf("if (!tok) return c.json({ error: 'not found' }, 404);");
  const writeAt = body.indexOf("SET revoked_at = datetime('now')");
  assert.ok(scopeAt > 0 && guardAt > scopeAt && writeAt > guardAt,
    'the withdraw writes before it has checked the token belongs to this deck');
});

test('withdrawing keeps the view history, because it is not a delete', () => {
  const db = freshDb();
  const ids = seed(db, [{ hash: 'watched', limit: 3 }]);
  const insView = db.prepare(
    `INSERT INTO deck_share_views (share_token_id, deck_id, ip_hash, ua_fingerprint, read_seconds)
     VALUES (?, ?, ?, ?, ?)`,
  );
  insView.run(ids.watched, 1, 'aaaa1111', 'bbbb2222', 42);
  insView.run(ids.watched, 1, 'cccc3333', 'dddd4444', 7);

  db.prepare(REVOKE).run(ids.watched);

  // The rows survive AND still resolve back to the link they belong to. An
  // orphaned row is not much better than a deleted one: the panel groups
  // impressions by `share_token_id`, and `share_token_id` has no FK to protect it.
  const kept = db.prepare(
    `SELECT v.read_seconds FROM deck_share_views v
       JOIN pitch_deck_share_tokens t ON t.id = v.share_token_id
      WHERE v.share_token_id = ? ORDER BY v.id`,
  ).all(ids.watched) as any[];
  assert.deepEqual(kept.map((r) => Number(r.read_seconds)), [42, 7],
    'withdrawing a link dropped the impressions it had already collected');

  // The token row is still there to be listed, which is what makes the history
  // attributable to a link the founder can still see they created.
  const tok = db.prepare('SELECT id, view_limit FROM pitch_deck_share_tokens WHERE id = ?')
    .get(ids.watched) as any;
  assert.ok(tok, 'the withdraw deleted the token row');

  // The mechanical half: nothing in the route deletes from either table.
  assert.doesNotMatch(ROUTE, /DELETE FROM pitch_deck_share_tokens/,
    'a route deletes share tokens — the view history would dangle');
  assert.doesNotMatch(ROUTE, /DELETE FROM deck_share_views/);
});

// -------------------------------------------------------- migration + schema

test('migration 248 adds exactly one column and no transaction', () => {
  const stmts = migrationStatements();
  assert.equal(stmts.length, 1, 'migration 248 no longer is a single statement');
  assert.match(stmts[0], /^ALTER TABLE pitch_deck_share_tokens ADD COLUMN revoked_at TEXT$/);
  // D1's HTTP API rejects transaction statements inside a migration file —
  // migration 200 failed a production deploy that way.
  assert.doesNotMatch(MIGRATION_SQL, /\bBEGIN\b/i, 'migration 248 carries a BEGIN');
  assert.doesNotMatch(MIGRATION_SQL, /\bCOMMIT\b/i, 'migration 248 carries a COMMIT');
  // Nullable, with no default: every link that existed before 248 reads as
  // never withdrawn, which is what it is.
  assert.doesNotMatch(stmts[0], /NOT NULL|DEFAULT/,
    'the column is not nullable — every pre-248 row would need a value it does not have');
});

test('a database built fresh has the same columns as one upgraded by 248', () => {
  // THE DIVERGENCE THIS CATCHES IS SILENT AND TOTAL. `ensureSchema` creates the
  // table on a new deployment and the migration adds the column on an existing
  // one; a column added to only one of them means the claim query — which now
  // names `revoked_at` — throws "no such column" on whichever side was missed,
  // and the share link stops working entirely rather than visibly.
  const upgraded = freshDb();
  const fresh = new DatabaseSync(':memory:');
  const at = ROUTE.indexOf('CREATE TABLE IF NOT EXISTS pitch_deck_share_tokens');
  assert.ok(at > 0, 'ensureSchema no longer creates the share token table');
  fresh.exec(ROUTE.slice(at, ROUTE.indexOf(')`', at) + 1));

  const cols = (db: InstanceType<typeof DatabaseSync>) =>
    (db.prepare('PRAGMA table_info(pitch_deck_share_tokens)').all() as any[])
      .map((r) => String(r.name)).sort();
  assert.deepEqual(cols(fresh), cols(upgraded),
    'ensureSchema and the migration story disagree about this table');
  assert.ok(cols(fresh).includes('revoked_at'));

  // And the lazy PRAGMA bootstrap covers it too — that is the path for a
  // deployment whose table exists but predates the migration.
  const boot = ROUTE.slice(ROUTE.indexOf('PRAGMA table_info(pitch_deck_share_tokens)'));
  assert.match(boot, /if \(!have\.has\('revoked_at'\)\) \{/,
    'the lazy column bootstrap does not add revoked_at');
});

test('the engagement panel is told which links were withdrawn', () => {
  // SELECTING THE COLUMN IS NOT SENDING IT. The panel distinguishes "the owner
  // ended this" from "it ran out", and withdrawing sets `expires_at` as well —
  // so without this field on the wire a link the founder had just withdrawn
  // would render as `active`, which reads as a failed withdraw.
  const at = ROUTE.indexOf("decks.get('/:id/engagement'");
  assert.ok(at > 0, 'the engagement route is gone');
  const body = ROUTE.slice(at, ROUTE.indexOf('\n});', at));
  assert.match(body, /revoked_at, created_at/, 'the engagement query stopped reading revoked_at');
  assert.match(body, /revoked_at: t\.revoked_at \|\| null,/,
    'revoked_at is read from the row and never sent to the panel');
});
