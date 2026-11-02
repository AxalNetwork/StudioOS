/**
 * D1587 (#3834, deck v2 F8, owner decision R = B) — the investor's granted
 * deck on their deal page, read-only, and the founder's grants (migration 745).
 * On real SQLite: the baseline's tables with migrations 597, 600 and 745 over
 * them. Every person, firm, venture and slide below is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_grants_d1587.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckGrants, { NOT_GRANTED, NO_LONGER_AVAILABLE, withoutProvenance } from '../src/routes/deck_grants.ts';
import dealContext from '../src/routes/deal_context.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const secret = 'unit-test-secret-deck-grants-d1587-0123456789';

const SLIDES = JSON.stringify([
  { type: 'title', title: 'Fixture Robotics', notes: 'PRIVATE SPEAKER NOTE', binding: { source_key: 'records.mrr', grade: 'A', as_of: '2026-10-01', record: 'PRIVATE RECORD' },
    fields: [
      { key: 'headline', kind: 'text', value: 'We build fixture robots' },
      { key: 'mrr', kind: 'metric_grid', value: '$40k', binding: { source_key: 'records.mrr', grade: 'B', as_of: '2026-10-01', snapshot: 'PRIVATE SNAPSHOT' } },
      { key: 'vr_score', kind: 'text', value: 'PRIVATE INTERNAL SCORE' },
      { key: 'bank_balance', kind: 'text', value: 'PRIVATE BALANCE' },
      { key: 'quote_1', kind: 'quote', value: 'PRIVATE UNCONSENTED QUOTE' },
    ] },
  { type: 'appendix', title: 'Sources', appendix: true, fields: [{ key: 'src', kind: 'text', value: 'SOURCE LIST' }] },
]);

// 1 and 2 investors at Firm A (11); 3 an investor at Firm B (22); 5 the venture's founder; 6 another founder; 4 an admin.
function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'founders', 'projects', 'deals', 'deal_invitations', 'commitments', 'investor_dealroom_members', 'company_profiles', 'user_company_links', 'dd_cases', 'dd_reviewers', 'dd_requests', 'ic_decisions', 'ic_votes', 'esign_envelopes', 'esign_recipients', 'documents', 'pitch_decks', 'activity_logs']) db.exec(tableFromBaseline(baseline, t));
  const m = readFileSync('cloudflare-worker/sql/migrations/490_mercury_raise_receipts.sql', 'utf8');
  const start = m.indexOf('CREATE TABLE mercury_personal_matches_490');
  db.exec(m.slice(start, m.indexOf('\n);', start) + 3).replace('mercury_personal_matches_490', 'mercury_personal_matches'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/600_deal_seen_and_notes.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/597_company_archive_and_events.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/745_deck_grants.sql', 'utf8'));
  db.exec(`INSERT INTO founders(id,name,email) VALUES (50,'Founder','f50@example.test'),(60,'Other','f60@example.test');
    INSERT INTO users(id,name,email,role,is_active,founder_id) VALUES (1,'Ivy One','one@example.test','investor',1,NULL),(2,'Ian Two','two@example.test','investor',1,NULL),
      (3,'Ike Three','three@example.test','investor',1,NULL),(4,'Admin','admin@example.test','admin',1,NULL),(5,'Fay Founder','founder@example.test','founder',1,50),(6,'Gus Other','other@example.test','founder',1,60);
    INSERT INTO projects(id,name,founder_id) VALUES(7,'Fixture Robotics',50),(8,'Elsewhere',60);
    INSERT INTO deals(id,project_id,status) VALUES(9,7,'active'),(10,8,'active');
    INSERT INTO company_profiles(id,uid,company_name) VALUES(11,'firm-a','Firm A'),(22,'firm-b','Firm B');
    INSERT INTO user_company_links(uid,user_id,company_id) VALUES('l1',1,11),('l2',2,11),('l3',3,22);
    INSERT INTO deal_invitations(deal_id,investor_user_id,company_id) VALUES(9,1,11),(9,3,22);
    INSERT INTO commitments(deal_id,investor_user_id,company_id,amount) VALUES(9,2,11,100);
    INSERT INTO pitch_decks(id,project_id,version,slides,title,created_at) VALUES(70,7,3,'${SLIDES.replace(/'/g, "''")}','Seed deck','2026-10-20 10:00:00'),(71,7,4,'[]','Seed deck','2026-10-25 10:00:00'),(80,8,1,'[]','Other deck','2026-10-20');
    INSERT INTO deal_notes(uid,deal_id,author_user_id,company_id,tag,body) VALUES('n1',9,1,11,'thesis','PRIVATE INVESTOR NOTE');`);
  const raw = d1Over(db);
  const DB = { ...raw, prepare(sql: string) {
    const p = raw.prepare(sql); let values: any[] = []; const bind = p.bind;
    p.bind = (...v: any[]) => { values = v; return bind(...v); };
    if (/^SELECT\b/i.test(sql.trim())) p.runSync = () => ({ success: true, results: db.prepare(sql).all(...values), meta: { changes: 0, last_row_id: 0 } });
    return p;
  } };
  const app = new Hono();
  app.route('/api/deals', deckGrants as any);
  app.route('/api/deals', dealContext as any);
  async function call(user: number, path: string, method = 'GET', body?: any, support = false) {
    const tok = await new SignJWT({ user_id: user, ...(support ? { impersonated_by: 4 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
    const res = await app.request(`/api/deals/${path}`, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB, JWT_SECRET: secret, ENVIRONMENT: 'development' } as any);
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text };
  }
  return { db, call };
}

const grant = (w: any, investor = 1, deck = 70, include?: any) => w.call(5, '9/deck-grants', 'POST', { deck_id: deck, investor_user_id: investor, ...(include ? { include } : {}) });

test('the investor reads nothing until granted, then exactly the granted version', async () => {
  const w = world();
  const before = await w.call(1, '9/deck');
  assert.deepEqual([before.status, before.body], [200, { granted: false, message: NOT_GRANTED }]);
  const g = await grant(w);
  assert.equal(g.status, 201);
  const r = await w.call(1, '9/deck');
  assert.equal(r.status, 200);
  assert.equal(r.body.granted, true);
  assert.equal(r.body.venture, 'Fixture Robotics');
  assert.deepEqual(r.body.deck.frozen, { version: 3, as_of: '2026-10-20 10:00:00' }, 'the granted version, not the latest (v4)');
  assert.equal(r.body.deck.title, 'Seed deck');
  assert.match(r.text, /We build fixture robots/);
});

test('only the caller\'s own grant, for their own firm: another investor or another firm reads nothing', async () => {
  const w = world();
  await grant(w, 1);
  assert.equal((await w.call(2, '9/deck')).body.granted, false, 'a colleague at the same firm has no grant of their own');
  assert.equal((await w.call(3, '9/deck')).body.granted, false, 'another firm\'s investor');
  w.db.exec('UPDATE deck_grants SET company_id = 22');
  assert.equal((await w.call(1, '9/deck')).body.granted, false, 'a grant for another firm is not this firm\'s');
  assert.equal((await w.call(1, '10/deck')).status, 404, 'a deal the investor is not on');
});

test('what leaves: no provenance, no internal score, bank field, unconsented quote, speaker note or record; nothing unticked', async () => {
  const w = world();
  await grant(w, 1, 70, { figures: false, sources: false, notes: true, bands: false });
  const r = await w.call(1, '9/deck');
  for (const banned of ['PRIVATE', 'binding', 'provenance', 'source_key', 'vr_score', 'bank_balance', 'quote_1']) assert.ok(!r.text.includes(banned), `the investor reads ${banned}`);
  assert.ok(!r.text.includes('$40k'), 'figures unticked: the figure field is gone');
  assert.ok(!r.text.includes('SOURCE LIST'), 'sources unticked: the appendix is gone');
  assert.ok(!/Not recorded/.test(r.text), 'no placeholder for a card the founder did not tick');
  assert.deepEqual(r.body.included, { figures: false, sources: false, notes: true, bands: false, cap_table: false, team_photos: false });
  const all = world(); await grant(all, 1);
  const d = await all.call(1, '9/deck');
  assert.match(d.text, /\$40k/, 'figures on by default');
  assert.ok(!d.text.includes('binding') && !d.text.includes('PRIVATE'), 'a ticked figure still carries no provenance');
  assert.deepEqual(withoutProvenance({ a: 1, binding: { x: 1 }, list: [{ badges: ['x'], b: 2 }] }), { a: 1, list: [{ b: 2 }] });
});

test('the founder never sees investor notes or scores', async () => {
  const w = world();
  w.db.exec(`INSERT INTO ic_decisions(uid,deal_id,title,decision,created_by,company_id) VALUES('ic',9,'PRIVATE IC MEMO','pass',1,11)`);
  await grant(w, 1);
  const list = await w.call(5, '9/deck-grants');
  assert.equal(list.status, 200);
  for (const banned of ['PRIVATE INVESTOR NOTE', 'thesis', 'PRIVATE IC MEMO', 'pass', 'score', 'weight', '@example.test']) assert.ok(!list.text.includes(banned), `the founder reads ${banned}`);
  assert.deepEqual(list.body.investors.map((i: any) => [i.user_id, i.firm]).sort(), [[1, 'Firm A'], [2, 'Firm A'], [3, 'Firm B']], 'the investors on the deal, by invitation or commitment, with their firms');
  assert.deepEqual(list.body.grants.map((g: any) => [g.investor.user_id, g.version, g.withdrawn_at]), [[1, 3, null]]);
  for (const path of ['9/notes', '9/deck', '9/stage']) assert.equal((await w.call(5, path)).status, 403, `the founder opens ${path}`);
});

test('grants: only the venture\'s founder, a version of this venture, an investor on the deal; a new grant replaces the live one; withdraw keeps the row', async () => {
  const w = world();
  assert.equal((await w.call(6, '9/deck-grants', 'POST', { deck_id: 70, investor_user_id: 1 })).status, 404, 'another founder');
  assert.equal((await w.call(1, '9/deck-grants')).status, 404, 'an investor cannot list grants');
  assert.equal((await w.call(5, '9/deck-grants', 'POST', { deck_id: 70, investor_user_id: 1 }, true)).status, 403, 'a support session');
  assert.equal((await grant(w, 1, 80)).body.error, 'deck_not_found', 'another venture\'s deck');
  assert.equal((await grant(w, 6)).body.error, 'investor_not_on_deal');
  assert.equal((await w.call(5, '9/deck-grants', 'POST', { deck_id: 70, investor_user_id: 1, include: { secret: true } })).body.error, 'include_invalid');
  const first = await grant(w, 1, 70);
  const second = await grant(w, 1, 71);
  assert.equal(second.status, 201);
  assert.equal((await w.call(1, '9/deck')).body.deck.frozen.version, 4, 'the new grant replaced the old');
  const rows = w.db.prepare('SELECT uid, revoked_at FROM deck_grants ORDER BY id').all() as any[];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].uid, first.body.uid);
  assert.ok(rows[0].revoked_at, 'the replaced grant is withdrawn, not deleted');
  const out = await w.call(5, `9/deck-grants/${second.body.uid}`, 'DELETE');
  assert.deepEqual([out.status, out.body], [200, { withdrawn: true }]);
  assert.equal((await w.call(1, '9/deck')).body.granted, false, 'withdrawn: the investor reads nothing');
  assert.equal((await w.call(5, `9/deck-grants/${second.body.uid}`, 'DELETE')).status, 404, 'already withdrawn');
  assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM deck_grants').get() as any).n, 2, 'nothing is deleted');
  assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action IN ('deck_granted','deck_grant_withdrawn')").get() as any).n, 3);
});

test('a granted version that is gone says so; a support session cannot open the investor read', async () => {
  const w = world();
  await grant(w, 1);
  w.db.exec('DELETE FROM pitch_decks WHERE id = 70');
  assert.deepEqual((await w.call(1, '9/deck')).body, { granted: false, message: NO_LONGER_AVAILABLE });
  assert.equal((await w.call(1, '9/deck', 'GET', undefined, true)).status, 403);
});

test('What\'s new counts the grant as the deck source, and drops the "unavailable" deck line once granted', async () => {
  const w = world();
  const none = await w.call(1, '9/whats-new');
  assert.match(none.body.unavailable[0].reason, /has not granted you a deck version/);
  await w.call(1, '9/whats-new');
  await grant(w, 1);
  w.db.exec("UPDATE deal_seen SET last_seen_at = '2020-01-01T00:00:00Z'");
  const after = await w.call(1, '9/whats-new');
  assert.deepEqual(after.body.unavailable, []);
  assert.ok(after.body.changes.some((c: any) => c.type === 'deck'), 'the new grant is a change');
});
