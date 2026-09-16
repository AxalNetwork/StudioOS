/**
 * EVERY EXPIRY GATE COMPARES `datetime(column)`, NOT THE BARE COLUMN.
 *
 * SQLite has no date type. A timestamp is TEXT and a comparison is a
 * lexicographic string compare, so two formats that look alike do not compare
 * alike:
 *
 *     new Date(...).toISOString()   ->  2026-09-16T10:41:47.120Z
 *     CURRENT_TIMESTAMP / now       ->  2026-09-16 10:56:47
 *
 * Position 10 decides it: 'T' (0x54) beats ' ' (0x20). So while the DATE halves
 * match, an ISO string is ALWAYS greater — and a TTL written that way does not
 * expire until the UTC date rolls over, up to ~24 hours late.
 *
 * WHY THE COLUMN AND NOT THE OTHER SIDE. Rewriting the comparison to
 * `expires_at > datetime('now')` looks like the fix and is not one: measured,
 * a value that expired fifteen minutes ago answers 1 for BOTH
 * `> CURRENT_TIMESTAMP` and `> datetime('now')`, because the stored text is
 * still the greater string. Only `datetime(expires_at) > datetime('now')`
 * normalises the value that is actually in the row, which is what makes it
 * correct for rows written before this change and for any writer added after
 * it. D120 (`rpc/branchOps.ts:708-731`) gets the same result the other way —
 * by writing `datetime('now', ?)` so both sides are already SQL-format — and
 * that is sound, but it only protects a column whose writers all cooperate.
 * `services/partnerDeals.ts:570` already used the form this file pins.
 *
 * WHY THESE GATES. Each one decides access, so being wrong means a door that
 * should be shut is open:
 *   - magic_link_tokens     a sign-in link the email calls 15-minute
 *   - webauthn_challenges   the passkey ceremony's 5-minute replay window
 *   - advisor_client_grants whether an advisor may open a founder's brief
 *   - data_room_grants      whether an investor may list and download files
 *   - pairwise_ndas         the NDA behind the data room and the market-intel
 *                           identity un-mask
 *   - legal_obligations     the daily sweep that marks an obligation expired
 *
 * THE SQL IS SLICED OUT OF THE SOURCE, NOT RETYPED. A copy of the predicate in
 * a test proves the copy is right. These tests read the real template literal
 * out of the route file and run it, so a change to the route changes what is
 * under test — and an anchor that stops matching fails loudly rather than
 * silently testing nothing.
 *
 * AND THE FIXTURE IS NOT TIME-OF-DAY DEPENDENT, which is the trap this file
 * would otherwise walk into. "Expired a minute ago" run at 00:00:30 UTC lands
 * on YESTERDAY's date, where the BROKEN predicate happens to be right — so the
 * test would pass against unfixed code for one minute a day. The expired
 * fixture is therefore pinned to `date('now') || 'T00:00:00.000Z'`: always in
 * the past, always on today's UTC date, so the 'T'-versus-space comparison is
 * always the one being exercised.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const src = (rel: string) => read(`cloudflare-worker/src/${rel}`);

/** The table's shape as production has it, sliced from the baseline verbatim. */
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

/**
 * The template literal containing `anchor`, taken out of a source file.
 *
 * THE ANCHOR MUST BE UNIQUE, and that is enforced rather than assumed. The
 * first draft of this file anchored the NDA sweep on `UPDATE pairwise_ndas`,
 * which appears TWICE in `trust.ts`, and the obligation sweep on
 * `UPDATE legal_obligations`, which appears NINE times. `indexOf` cheerfully
 * returned the first — a different statement in both cases — so the tests ran
 * against SQL they were not about and one of them failed for the wrong reason.
 * A test aimed at code other than the code it names proves nothing, and the
 * near miss is that it could as easily have PASSED. Both misses (absent, and
 * ambiguous) are hard failures here.
 */
function sqlAround(file: string, anchor: string): string {
  const s = src(file);
  const hits = s.split(anchor).length - 1;
  assert.ok(hits > 0, `${file}: "${anchor}" not found — this test is aimed at code that moved`);
  assert.equal(hits, 1, `${file}: "${anchor}" matches ${hits} places — pick an anchor that names one statement`);
  const at = s.indexOf(anchor);
  const open = s.lastIndexOf('`', at);
  const close = s.indexOf('`', at);
  assert.ok(open > 0 && close > at, `${file}: "${anchor}" is not inside a template literal`);
  return s.slice(open + 1, close);
}

function db(...tables: string[]) {
  const d = new DatabaseSync(':memory:');
  // The grant tables carry real foreign keys to `users` and `projects`, and the
  // baseline shapes are kept verbatim rather than trimmed — a fixture that
  // quietly dropped the constraints would not be the table production has. Two
  // stub parents satisfy them; `users` is at D1's 100-column cap and nothing
  // here reads a column of it, so a one-column stand-in is the honest minimum.
  d.exec('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)');
  d.exec('CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY)');
  for (let i = 1; i <= 300; i += 1) {
    d.prepare('INSERT INTO users (id) VALUES (?)').run(i);
    if (i <= 10) d.prepare('INSERT INTO projects (id) VALUES (?)').run(i);
  }
  for (const t of tables) d.exec(ddl(t));
  return d;
}

/** Today's UTC date at midnight, in the ISO shape every broken writer emits. */
function expiredIso(d: InstanceType<typeof DatabaseSync>): string {
  const row = d.prepare("SELECT date('now') AS day").get() as { day: string };
  return `${row.day}T00:00:00.000Z`;
}
/** Unambiguously live under any comparison, in the same ISO shape. */
const LIVE_ISO = '2099-01-01T00:00:00.000Z';

test('a magic-link token that expired today cannot be claimed', () => {
  const d = db('magic_link_tokens');
  const sql = sqlAround('routes/auth.ts', 'UPDATE magic_link_tokens SET used_at');
  const ins = d.prepare('INSERT INTO magic_link_tokens (email, token_hash, expires_at) VALUES (?, ?, ?)');
  ins.run('spent@example.com', 'hash-spent', expiredIso(d));
  ins.run('live@example.com', 'hash-live', LIVE_ISO);
  // The same instant as the spent one, written the way SQLite would write it —
  // proof the fix did not simply stop matching everything.
  d.exec("INSERT INTO magic_link_tokens (email, token_hash, expires_at) VALUES ('sql@example.com','hash-sql', datetime('now','+1 hour'))");

  assert.equal(d.prepare(sql).get('hash-spent'), undefined, 'a spent link still signed someone in');
  assert.equal((d.prepare(sql).get('hash-live') as any)?.email, 'live@example.com', 'a live link stopped working');
  assert.equal((d.prepare(sql).get('hash-sql') as any)?.email, 'sql@example.com', 'a correctly-written live link stopped working');
});

test('a passkey challenge that expired today cannot be claimed', () => {
  const d = db('webauthn_challenges');
  const sql = sqlAround('routes/auth_passkey.ts', 'UPDATE webauthn_challenges SET used_at');
  const ins = d.prepare('INSERT INTO webauthn_challenges (challenge, user_id, kind, expires_at) VALUES (?, ?, ?, ?)');
  ins.run('c-spent', 1, 'authentication', expiredIso(d));
  ins.run('c-live', 1, 'authentication', LIVE_ISO);

  assert.equal(d.prepare(sql).get('c-spent', 'authentication'), undefined, 'a stale challenge was still replayable');
  assert.ok(d.prepare(sql).get('c-live', 'authentication'), 'a live challenge stopped working');
});

test('an advisor grant that expired today no longer opens the brief', () => {
  const d = db('advisor_client_grants');
  const sql = sqlAround('routes/advisor_grants.ts', "AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))");
  const ins = d.prepare(
    `INSERT INTO advisor_client_grants (uid, project_id, advisor_user_id, granted_by_user_id, status, expires_at)
     VALUES (?, ?, ?, 9, 'active', ?)`,
  );
  ins.run('g-spent', 1, 100, expiredIso(d));
  ins.run('g-live', 2, 100, LIVE_ISO);
  // The shipped SPA sends no expires_at at all, so the commonest row is NULL —
  // "no expiry" must keep meaning "does not expire", not "expired".
  ins.run('g-null', 3, 100, null);

  assert.equal(d.prepare(sql).get(1, 100), undefined, 'an expired advisor grant still opened the client brief');
  assert.ok(d.prepare(sql).get(2, 100), 'a live advisor grant was closed');
  assert.ok(d.prepare(sql).get(3, 100), 'a grant with no expiry was treated as expired');
});

test('a data-room grant that expired today no longer lists files', () => {
  const d = db('data_room_grants');
  const sql = sqlAround('routes/data_room.ts', 'SELECT * FROM data_room_grants');
  const ins = d.prepare(
    `INSERT INTO data_room_grants (uid, project_id, investor_user_id, granted_by_user_id, status, expires_at)
     VALUES (?, ?, ?, 9, 'active', ?)`,
  );
  ins.run('d-spent', 1, 200, expiredIso(d));
  ins.run('d-live', 2, 200, LIVE_ISO);
  ins.run('d-null', 3, 200, null);

  assert.equal(d.prepare(sql).get(1, 200), undefined, 'an expired data-room grant still listed the founder files');
  assert.ok(d.prepare(sql).get(2, 200), 'a live data-room grant was closed');
  assert.ok(d.prepare(sql).get(3, 200), 'a grant with no expiry was treated as expired');
});

test('an NDA whose term ended today stops reading as active', () => {
  const d = db('pairwise_ndas');
  const sql = sqlAround('routes/data_room.ts', "AND (valid_until IS NULL OR datetime(valid_until) > datetime('now'))");
  const ins = d.prepare(
    `INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status, valid_until) VALUES (?, ?, 'active', ?)`,
  );
  ins.run(1, 10, expiredIso(d));
  ins.run(2, 20, LIVE_ISO);
  ins.run(3, 30, null);

  assert.equal(d.prepare(sql).get(1, 10), undefined, 'an ended NDA still gated the data room open');
  assert.ok(d.prepare(sql).get(2, 20), 'a live NDA stopped counting');
  assert.ok(d.prepare(sql).get(3, 30), 'an open-ended NDA was treated as ended');
});

test('the daily sweep expires the artifacts whose term ended today', () => {
  const d = db('pairwise_ndas', 'legal_obligations');

  const ndaSweep = sqlAround('services/trust.ts', "AND datetime(valid_until) < datetime('now')");
  const nda = d.prepare(
    `INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status, valid_until) VALUES (?, ?, 'active', ?)`,
  );
  nda.run(1, 10, expiredIso(d));
  nda.run(2, 20, LIVE_ISO);
  nda.run(3, 30, null);
  d.prepare(ndaSweep).run();
  const state = (a: number) =>
    (d.prepare('SELECT status FROM pairwise_ndas WHERE party_a_user_id = ?').get(a) as any).status;
  assert.equal(state(1), 'expired', 'the sweep left an ended NDA active');
  assert.equal(state(2), 'active', 'the sweep expired an NDA that is still running');
  assert.equal(state(3), 'active', 'the sweep expired an open-ended NDA');

  const obSweep = sqlAround('services/trust.ts', "AND datetime(expires_at) < datetime('now')");
  const cols = ddl('legal_obligations');
  const ob = d.prepare(
    `INSERT INTO legal_obligations (${/user_id/.test(cols) ? 'user_id, ' : ''}obligation_key, status, expires_at) VALUES (${/user_id/.test(cols) ? '?, ' : ''}?, 'satisfied', ?)`,
  );
  if (/user_id/.test(cols)) { ob.run(1, 'tos_v1', expiredIso(d)); ob.run(2, 'privacy_v1', LIVE_ISO); }
  else { ob.run('tos_v1', expiredIso(d)); ob.run('privacy_v1', LIVE_ISO); }
  d.prepare(obSweep).run();
  const obState = (k: string) =>
    (d.prepare('SELECT status FROM legal_obligations WHERE obligation_key = ?').get(k) as any).status;
  assert.equal(obState('tos_v1'), 'expired', 'the sweep left an expired obligation satisfied');
  assert.equal(obState('privacy_v1'), 'satisfied', 'the sweep expired an obligation still in force');
});

test('no access-control gate compares a bare timestamp column', () => {
  // The behavioural tests above cover six gates. Seven more read the same four
  // columns from other routes, and one of them going back to the bare form is
  // the same defect in a place no fixture would catch — so the shape is pinned
  // across every file that gates on these two columns.
  const FILES = [
    'routes/auth.ts', 'routes/auth_passkey.ts', 'routes/advisor_grants.ts',
    'routes/advisors.ts', 'routes/data_room.ts', 'routes/research.ts',
    'routes/market_intel.ts', 'services/trust.ts',
  ];
  // A bare column on either side of a comparison against the clock. The
  // negative lookbehind lets `datetime(expires_at)` through and nothing else.
  const BARE = /(?<!datetime\()\b[a-z_]*\.?(?:expires_at|valid_until)\s*[<>]=?\s*(?:CURRENT_TIMESTAMP|datetime\('now'\))/;
  for (const f of FILES) {
    const hit = BARE.exec(src(f));
    assert.equal(hit, null, `${f} compares a bare timestamp column: ${hit?.[0]}`);
  }
  // And the fix is actually present, so this test cannot pass by the files
  // having lost their gates altogether.
  const wrapped = FILES.reduce((n, f) => n + (src(f).match(/datetime\([a-z_]*\.?(?:expires_at|valid_until)\)/g) || []).length, 0);
  assert.equal(wrapped, 13, `expected 13 normalised comparisons across the gated files, found ${wrapped}`);
});
