/**
 * MIGRATION 210 TOUCHES ONE ROW, AND THIS IS WHAT PROVES IT.
 *
 * A data migration is a different animal from a schema one. A `CREATE TABLE IF
 * NOT EXISTS` that is wrong fails loudly on the next deploy; an `UPDATE` that is
 * wrong succeeds, writes, and is indistinguishable afterwards from a correct
 * one. The only moment it can be checked is before it runs.
 *
 * What makes this particular UPDATE worth pinning is what it grants. It sets
 * `users.partner_id`, and every partner route scopes its reads on that column —
 * `requirePartnerProfile` resolves it and the pipeline, delivery and offers
 * endpoints filter on the firm it returns. A row matched too broadly does not
 * fail closed. It hands one party another party's quotes, engagements and
 * clients, silently, with a 200.
 *
 * So the assertions below are mostly about what the statement does NOT do. It
 * runs against production, dev and preview databases alike, and on two of those
 * three the ids in it mean nothing — the correct behaviour there is to match
 * nothing at all.
 *
 * Real SQLite (node:sqlite) rather than a stub, for the same reason the other
 * migration tests use it: the guards are a compound WHERE with a correlated
 * EXISTS, and asserting that a query engine evaluates it the way the comment
 * claims is the entire exercise. A stub would only replay my own assumptions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SQL = readFileSync(
  join(resolve(process.cwd()), 'cloudflare-worker', 'sql', 'migrations',
    '210_link_partner_user_to_firm.sql'),
  'utf8',
);

/**
 * The two columns the statement reads and the one it writes, and nothing else.
 *
 * Deliberately NOT the real `users` table: that one is at D1's 100-column cap,
 * and reproducing it here would make this test a copy of the schema rather than
 * a check on the statement. Any column the migration does not name is one it
 * cannot depend on.
 */
function db({ firm = 'Oblivira', role = 'partner', existing = null } = {}) {
  const d = new DatabaseSync(':memory:');
  d.exec(`
    CREATE TABLE partners (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT, partner_id INTEGER, is_active INTEGER DEFAULT 1
    );
  `);
  d.exec(`INSERT INTO partners (id, name) VALUES (9, '${firm}'), (3, 'Algo Size');`);
  const ins = d.prepare('INSERT INTO users (id, role, partner_id, is_active) VALUES (?,?,?,?)');
  // The target.
  ins.run(29, role, existing, 1);
  // Decoys, each one a row a broader statement would have caught:
  ins.run(25, 'partner', null, 1);   // the OTHER active orphan — must stay orphaned
  ins.run(3, 'partner', null, 0);    // an inactive orphan, id colliding with a firm id
  ins.run(30, 'partner', 3, 1);      // already linked, to a different firm
  ins.run(31, 'founder', null, 1);   // not a partner at all
  return d;
}

const linkOf = (d, id) =>
  d.prepare('SELECT partner_id FROM users WHERE id = ?').get(id).partner_id;

test('the one account it is for gets the firm it belonged to', () => {
  const d = db();
  d.exec(SQL);
  assert.equal(linkOf(d, 29), 9, 'user 29 should resolve to firm 9 after the migration');
});

test('nothing else moves — not the other orphan, not an existing link', () => {
  const d = db();
  d.exec(SQL);
  // 25 is the other ACTIVE orphan and is deliberately left alone: the
  // NoPartnerProfile card is the correct answer for an account with no firm,
  // and linking it to something to clear the card would invent the fact the
  // card exists to refuse to invent.
  assert.equal(linkOf(d, 25), null, 'the other active orphan must stay orphaned');
  assert.equal(linkOf(d, 3), null, 'an inactive orphan must stay orphaned');
  assert.equal(linkOf(d, 30), 3, "an existing link must not be rewritten");
  assert.equal(linkOf(d, 31), null, 'a founder must not be given a partner firm');
});

test('a replay is a no-op, not a second write', () => {
  // The runner is forward-only, but a file can be re-applied against a database
  // that was restored, branched or baselined. `partner_id IS NULL` is what makes
  // the second run do nothing.
  const d = db();
  d.exec(SQL);
  d.exec(SQL);
  assert.equal(linkOf(d, 29), 9);
  const changed = d.prepare(
    'SELECT COUNT(*) AS n FROM users WHERE partner_id IS NOT NULL').get().n;
  assert.equal(changed, 2, 'exactly the target and the already-linked row carry a firm');
});

test('it does not clobber a link someone set by hand first', () => {
  // The real scenario this guards: the owner fixes the account in the D1
  // console, then the migration runs. Without `partner_id IS NULL` this would
  // overwrite their answer with the one written weeks earlier.
  const d = db({ existing: 3 });
  d.exec(SQL);
  assert.equal(linkOf(d, 29), 3, "a hand-set link must survive the migration");
});

test('on a database where the ids mean something else, it matches nothing', () => {
  // Dev and preview have their own id sequences. A migration that silently does
  // nothing on the wrong database is correct; one that writes is not.
  for (const [label, opts] of [
    ['firm 9 is a different company', { firm: 'Someone Else' }],
    ['user 29 is not a partner', { role: 'founder' }],
  ]) {
    const d = db(opts);
    d.exec(SQL);
    assert.equal(linkOf(d, 29), null, `${label}: nothing should have been written`);
  }
});

test('it is a single UPDATE — no ALTER, no transaction statement', () => {
  // `users` is at D1's 100-column limit, where an ALTER fails with "too many
  // columns" for an existing column as readily as a new one and takes the
  // deploy with it. And D1 rejects transaction statements inside a migration
  // outright — migration 200 was rewritten after the whole file rolled back on
  // the production run.
  const code = SQL.replace(/^\s*--[^\n]*$/gm, '');
  assert.doesNotMatch(code, /ALTER TABLE/i, 'an ALTER against users fails on the column cap');
  assert.doesNotMatch(code, /\b(BEGIN|COMMIT|ROLLBACK)\s+TRANSACTION\b/i,
    'D1 rejects transaction statements in a migration');
  const statements = code.split(';').map((s) => s.trim()).filter(Boolean);
  assert.equal(statements.length, 1, `expected one statement, found ${statements.length}`);
  assert.match(statements[0], /^UPDATE users/);
});

test('no email address is committed in the file', () => {
  // The guards do not need one, and a migration file is a worse place to keep a
  // person's address than the database already is. This is the assertion that
  // stops the "make it self-documenting" edit from putting one back.
  assert.doesNotMatch(SQL, /[\w.+-]+@[\w-]+\.[\w.]+/,
    'identify the row by id and guard it by shape, not by writing someone\'s email here');
});
