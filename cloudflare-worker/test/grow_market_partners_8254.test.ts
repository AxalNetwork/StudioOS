/**
 * D8254 (#8254, Grow Markets) — which partners work a market.
 *
 *   1  A partner is linked to markets through its Edit form's `markets` field (a PATCH of market uids): linking, re-
 *      linking (the set replaces) and unlinking with an empty list; a body without `markets` leaves links alone.
 *   2  The partner's Edit form offers the venture's markets with the current links ticked.
 *   3  The market's record lists its linked partners; a market with none reads an empty list (not null).
 *   4  Permissions and scope: a reader cannot link (403); a market of another venture is a 400 and nothing changes;
 *      another venture's partner is 404.
 *   5  Removing a market or a partner takes its links with it, and nothing else.
 *   6  A failed read of the links is `partners: null`, `partners_state: 'unreadable'`, never an empty list.
 *
 * Mutation checked (each broke a test below, then was restored): the delete of links no longer wanted dropped (1);
 *   the venture check on the market uids dropped (4); `project_id` dropped from the market's partner read (4);
 *   a failed read returning [] (6); `markets` left out of PARTNER_EDIT (1b).
 *
 * Every name and value is made up. The database is the baseline plus every migration, in memory.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_market_partners_8254.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleGrow from '../src/routes/cycle_grow.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = ['fixture', 'key', 'for', 'market', 'partners', '8254'].join('-');
const FOUNDER = 10, ADVISOR = 12, OTHER = 13;
const A = 1, B = 2;

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = ON');
  for (const [id, name] of [[FOUNDER, 'Ana Wren'], [ADVISOR, 'Dee Advisor'], [OTHER, 'Oli Other']] as const) {
    db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(id, name, `f${id}@example.test`);
    db.prepare('INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(id, 'founder', name, `u${id}@example.test`, id);
  }
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER}), (${B}, 'Other Venture', ${OTHER})`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${A}, ${ADVISOR}, 'advisor', 'accepted')`);
  db.exec(`INSERT INTO markets (id, uid, project_id, name, state, created_by) VALUES
    (1, 'mkp', ${A}, 'Portugal', 'considering', ${FOUNDER}), (2, 'mks', ${A}, 'Spain', 'considering', ${FOUNDER}),
    (3, 'mkc', ${A}, 'Chile', 'considering', ${FOUNDER}), (9, 'mkx', ${B}, 'Elsewhere', 'considering', ${OTHER})`);
  db.exec(`INSERT INTO growth_partners (id, uid, project_id, name, type, stage, created_by) VALUES
    (1, 'pta', ${A}, 'Harbour Resellers', 'reseller', 'signed', ${FOUNDER}), (2, 'ptb', ${A}, 'Anchor Agency', 'agency', 'talking', ${FOUNDER}),
    (9, 'ptx', ${B}, 'Foreign Partner', 'reseller', 'signed', ${OTHER})`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
app.route('/api/cycles', createCycleRecords());
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    }, { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const patch = (db: DatabaseSync, uid: string, body: Record<string, unknown>, who = FOUNDER, project = A) =>
  call(db, who, 'PATCH', `/api/cycles/grow/partners/${uid}`, { project, ...body });
const links = (db: DatabaseSync, partner: string) => (db.prepare(
  'SELECT m.uid FROM growth_partner_markets l JOIN growth_partners p ON p.id = l.partner_id JOIN markets m ON m.id = l.market_id WHERE p.uid = ? ORDER BY m.uid').all(partner) as any[]).map((r) => r.uid);
const market = async (db: DatabaseSync, uid: string) => (await call(db, FOUNDER, 'GET', `/api/cycles/grow/modules/market-expansion/records/${uid}?project=${A}`)).body.parts.market;

test('1: markets link, re-link as a set and unlink; a body without markets leaves them alone', async () => {
  const db = fixture();
  assert.equal((await patch(db, 'pta', { markets: ['mkp', 'mks'] })).status, 200);
  assert.deepEqual(links(db, 'pta'), ['mkp', 'mks']);
  assert.equal((await patch(db, 'pta', { markets: ['mks', 'mkc'] })).status, 200);
  assert.deepEqual(links(db, 'pta'), ['mkc', 'mks']);
  assert.equal((await patch(db, 'pta', { stage: 'paused' })).status, 200);
  assert.deepEqual(links(db, 'pta'), ['mkc', 'mks'], 'no markets key, no change');
  assert.equal((await patch(db, 'pta', { markets: [] })).status, 200);
  assert.deepEqual(links(db, 'pta'), []);
  assert.equal((await patch(db, 'ptb', { markets: ['mkp'] })).status, 200);
  assert.deepEqual(links(db, 'ptb'), ['mkp'], 'another partner\'s links are its own');
});

test('1b: the record\'s own Edit action carries the markets through to the links', async () => {
  const db = fixture();
  const r = await call(db, FOUNDER, 'POST', `/api/cycles/grow/modules/partner-network/records/pta/actions/edit?project=${A}`, { name: 'Harbour Resellers', markets: ['mkp'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(links(db, 'pta'), ['mkp']);
});

test('2: the Edit form offers the venture\'s markets with the current links ticked', async () => {
  const db = fixture();
  await patch(db, 'pta', { markets: ['mks'] });
  const r = await call(db, FOUNDER, 'GET', `/api/cycles/grow/modules/partner-network/records/pta?project=${A}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const f = r.body.actions.find((a: any) => a.key === 'edit').form.fields.find((x: any) => x.key === 'markets');
  assert.equal(f.kind, 'CK');
  assert.deepEqual(f.options, [{ value: 'mkc', label: 'Chile' }, { value: 'mkp', label: 'Portugal' }, { value: 'mks', label: 'Spain' }], 'this venture\'s markets only');
  assert.deepEqual(f.value, ['mks']);
});

test('3: the market record lists its linked partners; none linked is an empty list', async () => {
  const db = fixture();
  await patch(db, 'pta', { markets: ['mkp'] }); await patch(db, 'ptb', { markets: ['mkp', 'mks'] });
  const m = await market(db, 'mkp');
  assert.equal(m.partners_state, 'ok');
  assert.deepEqual(m.partners, [{ uid: 'ptb', name: 'Anchor Agency', type: 'agency', stage: 'talking' }, { uid: 'pta', name: 'Harbour Resellers', type: 'reseller', stage: 'signed' }]);
  assert.deepEqual((await market(db, 'mkc')).partners, []);
});

test('4: a reader cannot link; another venture\'s market is refused and changes nothing; another venture\'s partner is 404', async () => {
  const db = fixture();
  assert.equal((await patch(db, 'pta', { markets: ['mkp'] }, ADVISOR)).status, 403);
  const bad = await patch(db, 'pta', { markets: ['mkp', 'mkx'] });
  assert.equal(bad.status, 400); assert.equal(bad.body.field, 'markets');
  assert.deepEqual(links(db, 'pta'), []);
  assert.equal((await patch(db, 'ptx', { markets: ['mkp'] })).status, 404);
  assert.equal((await patch(db, 'ptx', { markets: ['mkx'] }, OTHER, B)).status, 200);
  assert.deepEqual((await market(db, 'mkp')).partners, [], 'another venture\'s partner never lists here');
  db.exec('INSERT INTO growth_partner_markets (partner_id, market_id) VALUES (9, 1)');
  assert.deepEqual((await market(db, 'mkp')).partners, [], 'a stray cross-venture row is not listed either');
});

test('5: removing a market or a partner takes its links and nothing else', async () => {
  const db = fixture();
  await patch(db, 'pta', { markets: ['mkp', 'mks'] }); await patch(db, 'ptb', { markets: ['mkp'] });
  assert.equal((await call(db, FOUNDER, 'DELETE', '/api/cycles/grow/markets/mks', { project: A })).status, 200);
  assert.deepEqual(links(db, 'pta'), ['mkp']);
  assert.equal((await call(db, FOUNDER, 'DELETE', '/api/cycles/grow/partners/ptb', { project: A })).status, 200);
  assert.deepEqual(links(db, 'ptb'), []);
  assert.deepEqual(links(db, 'pta'), ['mkp']);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM growth_partners WHERE uid = ?').get('pta') as any).n, 1);
});

test('6: a failed read of the links is unreadable, never an empty list', async () => {
  const db = fixture();
  db.exec('DROP TABLE growth_partner_markets');
  const m = await market(db, 'mkp');
  assert.equal(m.partners, null); assert.equal(m.partners_state, 'unreadable');
  assert.equal(m.replies_state, 'ok', 'the other reads are unaffected');
});
