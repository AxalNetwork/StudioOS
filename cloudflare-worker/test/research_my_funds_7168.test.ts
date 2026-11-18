/**
 * D7168 (#7168) — My funds past 500, identity by catalogue uid, conflict
 * detection on PATCH, the intended allocation, and the dossier's public record
 * apart from its private fields.
 *
 * The real research router against the full migrated schema (`loadSchema`),
 * so migration 202611180053_7168 is what these rows are written into.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_my_funds_7168.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import research from '../src/routes/research.ts';
import { fundIdentity, parseMyFundsQuery, publicRecordFor } from '../src/services/researchMyFunds.ts';
import { fundAllocationNote } from '../src/services/researchFundRead.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';

const app = new Hono().route('/api/research', research);
app.onError((error, c) => c.json({ detail: error.message }, 500));
const SECRET = 'unit-research-my-funds-7168-secret-0123456789';
const OWNER = 7101;
const OTHER = 7102;
const LIST = 'A sample public list';
const GONE = 'A list taken down';

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`INSERT INTO users (id,email,name,role) VALUES (${OWNER},'owner@example.test','Owner','founder'), (${OTHER},'other@example.test','Other','founder')`);
  const dir = db.prepare(`INSERT INTO research_fund_directory (uid, name, hq, source_name, source_url, as_of) VALUES (?, ?, ?, ?, 'https://list.example', '2026-10-04')`);
  dir.run('atlas-a-i', 'Atlas A-I Fund II', 'London', LIST);
  dir.run('atlasai', 'Atlas AI Fund I', 'Bay Area', LIST);
  dir.run('withdrawn-1', 'Withdrawn Fund', 'Paris', GONE);
  db.prepare(`INSERT INTO research_fund_sources (source_name, title, terms_status, evidence, verdict, verdict_reason, reviewed_on)
              VALUES (?, 't', 'not found', 'e', 'not allowed', 'Its terms forbid republishing.', '2026-10-06')`).run(GONE);
  return { db, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
type F = ReturnType<typeof fixture>;

let n = 0;
/** A saved row written straight into the table: legacy unless `own` or `catalogue` say otherwise. */
function seed(f: F, o: Record<string, unknown> = {}) {
  n += 1;
  const uid = String(o.uid ?? `f_${n}`);
  const stamp = String(o.updated_at ?? `2026-11-${String(1 + (n % 28)).padStart(2, '0')}T10:00:00.${String(n % 1000).padStart(3, '0')}Z`);
  f.db.prepare(`INSERT INTO research_funds (uid, owner_user_id, name, stage_fit, path, status, pass_reason, note,
      cheque_min_cents, cheque_max_cents, catalogue_uid, own_record_at, intended_allocation_cents, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    uid, Number(o.owner ?? OWNER), String(o.name ?? `Fund ${n}`), (o.stage_fit as string) ?? null, (o.path as string) ?? null,
    String(o.status ?? 'researching'), (o.pass_reason as string) ?? null, (o.note as string) ?? null,
    (o.lo as number) ?? null, (o.hi as number) ?? null, (o.catalogue as string) ?? null, (o.own as string) ?? null,
    (o.alloc as number) ?? null, stamp, stamp,
  );
  return uid;
}

async function call(f: F, method: string, path: string, body?: unknown, userId = OWNER) {
  const token = await new SignJWT({ user_id: userId, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const r = await app.request(`/api/research${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  }, f.env);
  return { status: r.status, body: await r.json() as any };
}

test('the list pages past 500 and every count is over all saved rows, not the page', async () => {
  const f = fixture();
  for (let i = 0; i < 520; i += 1) seed(f, { stage_fit: i % 4 === 0 ? 'right' : null, path: i % 10 === 0 ? 'warm' : null });
  seed(f, { status: 'passed', pass_reason: null });
  seed(f, { owner: OTHER, stage_fit: 'right' });

  const first = await call(f, 'GET', '/funds');
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 50, 'a page is 50 rows by default');
  assert.equal(first.body.total, 521, 'the total is every saved row, past the old 500 cap');
  assert.equal(first.body.saved_count, 521);
  assert.equal(first.body.right_stage_count, 130, 'counted over all 520, not over the page');
  assert.equal(first.body.warm_path_count, 52);
  assert.equal(first.body.passed_without_reason, 1);
  assert.equal(first.body.counts_scope, 'all_saved');

  const last = await call(f, 'GET', '/funds?limit=100&offset=500');
  assert.equal(last.body.items.length, 21, 'the rows past 500 are reachable');
  assert.equal(last.body.right_stage_count, 130, 'paging does not change a count');

  const filtered = await call(f, 'GET', '/funds?filter=right&limit=10');
  assert.equal(filtered.body.total, 130);
  assert.ok(filtered.body.items.every((x: any) => x.stage_fit === 'right'));
  assert.equal(filtered.body.saved_count, 521, 'a filter narrows the list, not the counts');
});

test('search reaches every saved fund by name and catalogue id, and a wildcard is a literal', async () => {
  const f = fixture();
  for (let i = 0; i < 600; i += 1) seed(f);
  seed(f, { name: 'Atlas A-I', catalogue: 'atlas-a-i', updated_at: '2020-01-01T00:00:00.000Z' });
  seed(f, { name: 'Atlas AI' });
  seed(f, { name: 'Keel 100% Seed' });
  seed(f, { owner: OTHER, name: 'Atlas Other' });

  const r = await call(f, 'GET', '/funds?q=atlas');
  assert.deepEqual(r.body.items.map((x: any) => x.name).sort(), ['Atlas A-I', 'Atlas AI'],
    'the oldest-updated row is found, and another member\'s is not');
  assert.equal(r.body.total, 2);
  assert.equal(r.body.saved_count, 603, 'the counts still describe every saved fund');
  assert.deepEqual((await call(f, 'GET', '/funds?q=a-i')).body.items.map((x: any) => x.name), ['Atlas A-I']);
  assert.deepEqual((await call(f, 'GET', '/funds?q=100%25')).body.items.map((x: any) => x.name), ['Keel 100% Seed']);
  assert.equal((await call(f, 'GET', '/funds?q=%25')).body.total, 1, '"%" matches only a name that holds one');
});

test('a bad page or filter is a 400 naming its field, never a silent default', async () => {
  const f = fixture();
  for (const [qs, field] of [['limit=0', 'limit'], ['limit=101', 'limit'], ['offset=-1', 'offset'], ['filter=best', 'filter'],
    ['identity=guessed', 'identity'], ['sort=fit', 'sort'], ['catalogue_uid=a%20b', 'catalogue_uid']]) {
    const r = await call(f, 'GET', `/funds?${qs}`);
    assert.equal(r.status, 400, qs);
    assert.equal(r.body.field, field, qs);
  }
  assert.throws(() => parseMyFundsQuery((k) => (k === 'q' ? 'x'.repeat(121) : undefined)), /q must be at most 120/);
});

test('identity per row: linked, your own record, or a legacy entry; and the legacy filter', async () => {
  const f = fixture();
  const legacy = seed(f, { name: 'Atlas AI' });
  seed(f, { name: 'Atlas A-I', catalogue: 'atlas-a-i' });
  const hand = await call(f, 'POST', '/funds', { name: 'Keel Seed Collective' });
  assert.equal(hand.status, 201);
  assert.equal(hand.body.identity, 'own', 'a fund typed in by hand is your own record');
  const fromDir = await call(f, 'POST', '/funds', { name: 'Atlas AI Fund I', catalogue_uid: 'atlasai' });
  assert.equal(fromDir.body.identity, 'linked');

  const all = await call(f, 'GET', '/funds');
  assert.equal(all.body.legacy_count, 1);
  assert.equal(all.body.linked_count, 2);
  assert.equal(all.body.own_count, 1);
  const legacyOnly = await call(f, 'GET', '/funds?identity=legacy');
  assert.deepEqual(legacyOnly.body.items.map((x: any) => x.uid), [legacy]);
  assert.equal(legacyOnly.body.items[0].identity, 'legacy');
  assert.deepEqual((await call(f, 'GET', '/funds?identity=own')).body.items.map((x: any) => x.name), ['Keel Seed Collective']);

  // The directory's map: every linked row by catalogue uid, whatever the page.
  const links = (await call(f, 'GET', '/funds?limit=1')).body.catalogue_links;
  assert.deepEqual(links.map((l: any) => l.catalogue_uid).sort(), ['atlas-a-i', 'atlasai']);
  const one = await call(f, 'GET', '/funds?catalogue_uid=atlasai');
  assert.deepEqual(one.body.items.map((x: any) => x.uid), [fromDir.body.uid], 'a catalogue uid finds its one entry, never a name match');

  assert.equal(fundIdentity({ catalogue_uid: 'x', own_record_at: '2026' }), 'linked');
  assert.equal(fundIdentity({ catalogue_uid: null, own_record_at: '2026' }), 'own');
  assert.equal(fundIdentity({ catalogue_uid: null, own_record_at: null }), 'legacy');
});

test('a legacy entry is linked by catalogue uid, refused when another entry holds it, and can be kept as your own', async () => {
  const f = fixture();
  const linked = seed(f, { name: 'Atlas A-I', catalogue: 'atlas-a-i' });
  const legacy = seed(f, { name: 'Atlas AI', note: 'Met at the robotics dinner.', stage_fit: 'right' });
  const other = seed(f, { owner: OTHER, name: 'Atlas AI', catalogue: 'atlasai' });

  const taken = await call(f, 'PATCH', `/funds/${legacy}`, { catalogue_uid: 'atlas-a-i' });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error, 'catalogue_uid_taken');
  assert.deepEqual(taken.body.holder, { uid: linked, name: 'Atlas A-I' }, 'the refusal names the entry that holds it');

  assert.equal((await call(f, 'PATCH', `/funds/${legacy}`, { catalogue_uid: 'nope' })).body.error, 'catalogue_vehicle_not_found');
  assert.equal((await call(f, 'PATCH', `/funds/${legacy}`, { catalogue_uid: 'withdrawn-1' })).status, 410);
  assert.equal((await call(f, 'PATCH', `/funds/${legacy}`, { catalogue_uid: "x' OR 1=1" })).status, 400);

  const ok = await call(f, 'PATCH', `/funds/${legacy}`, { catalogue_uid: 'atlasai' });
  assert.equal(ok.status, 200, 'another member holding the same vehicle does not block yours');
  assert.equal(ok.body.identity, 'linked');
  assert.equal(ok.body.note, 'Met at the robotics dinner.', 'linking leaves the note alone');
  assert.equal(ok.body.stage_fit, 'right', 'and the reads');
  const again = await call(f, 'PATCH', `/funds/${legacy}`, { catalogue_uid: 'atlas-a-i' });
  assert.equal(again.body.error, 'fund_already_linked', 'a linked entry is never re-pointed');
  assert.equal(f.db.prepare('SELECT catalogue_uid FROM research_funds WHERE uid = ?').get(other)!.catalogue_uid, 'atlasai');

  const keep = seed(f, { name: 'Keel' });
  const kept = await call(f, 'PATCH', `/funds/${keep}`, { own_record: true });
  assert.equal(kept.body.identity, 'own');
  assert.ok(kept.body.own_record_at);
  assert.equal((await call(f, 'GET', '/funds?identity=legacy')).body.total, 0, 'a kept record is not offered a match again');
});

test('PATCH carrying a stale updated_at answers 409 with the stored row and writes nothing', async () => {
  const f = fixture();
  const uid = seed(f, { note: 'Led two robotics seeds.' });
  const opened = (await call(f, 'GET', `/funds/${uid}`)).body.updated_at;

  const elsewhere = await call(f, 'PATCH', `/funds/${uid}`, { note: 'Intro offered for 24 Nov.', expected_updated_at: opened });
  assert.equal(elsewhere.status, 200);
  assert.notEqual(elsewhere.body.updated_at, opened, 'every write moves the stamp');

  const mine = await call(f, 'PATCH', `/funds/${uid}`, { note: 'Ask about reserves.', expected_updated_at: opened });
  assert.equal(mine.status, 409);
  assert.equal(mine.body.error, 'fund_changed');
  assert.equal(mine.body.item.note, 'Intro offered for 24 Nov.', 'the stored row comes back to compare');
  assert.equal(f.db.prepare('SELECT note FROM research_funds WHERE uid = ?').get(uid)!.note, 'Intro offered for 24 Nov.');

  const resolved = await call(f, 'PATCH', `/funds/${uid}`, { note: 'Combined.', expected_updated_at: mine.body.item.updated_at });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.note, 'Combined.');

  // A field save sends only its own key: a stage change leaves the note as stored.
  const stage = await call(f, 'PATCH', `/funds/${uid}`, { stage_fit: 'right', expected_updated_at: resolved.body.updated_at });
  assert.equal(stage.body.note, 'Combined.');
  // A write that names no stamp behaves as before.
  assert.equal((await call(f, 'PATCH', `/funds/${uid}`, { path: 'warm' })).status, 200);
});

test('the intended allocation is USD cents, blank is Not recorded, and the list counts it over all rows', async () => {
  const f = fixture();
  const a = seed(f, { lo: 15_000_000, hi: 50_000_000 });
  seed(f, { lo: 100_000_000, hi: 400_000_000, alloc: 25_000_000 }); // below their range
  seed(f, { hi: 200_000_000, alloc: 25_000_000 }); // low end open: counts
  seed(f, { alloc: 25_000_000 }); // no range: never counted
  for (let i = 0; i < 60; i += 1) seed(f);

  const set = await call(f, 'PATCH', `/funds/${a}`, { intended_allocation_cents: 25_000_000 });
  assert.equal(set.body.intended_allocation_cents, 25_000_000);
  assert.equal((await call(f, 'PATCH', `/funds/${a}`, { intended_allocation_cents: -1 })).body.error, 'allocation_invalid');
  assert.equal((await call(f, 'PATCH', `/funds/${a}`, { intended_allocation_cents: 'lots' })).status, 400);

  const list = await call(f, 'GET', '/funds?limit=5');
  assert.equal(list.body.allocation_set_count, 4);
  assert.equal(list.body.allocation_count, 2, 'inside a and the open-ended range, over every row');
  assert.equal(list.body.allocation_currency, 'USD');
  assert.equal(list.body.cheque_overlap_count, null, 'no raise target: the whole-round count is absent, not 0');

  const dossier = await call(f, 'GET', `/funds/${a}`);
  assert.equal(dossier.body.allocation_test.result, 'inside');
  const cleared = await call(f, 'PATCH', `/funds/${a}`, { intended_allocation_cents: null });
  assert.equal(cleared.body.intended_allocation_cents, null, 'blank stays blank, never 0');

  assert.equal(fundAllocationNote({ cheque_min_cents: null, cheque_max_cents: null, intended_allocation_cents: null }).result, 'not_set');
  assert.equal(fundAllocationNote({ cheque_min_cents: null, cheque_max_cents: null, intended_allocation_cents: 1 }).result, 'nothing_to_compare');
  assert.equal(fundAllocationNote({ cheque_min_cents: 100, cheque_max_cents: 200, intended_allocation_cents: 99 }).result, 'below');
  assert.equal(fundAllocationNote({ cheque_min_cents: 100, cheque_max_cents: 200, intended_allocation_cents: 201 }).result, 'above');
  assert.equal(fundAllocationNote({ cheque_min_cents: 100, cheque_max_cents: 200, intended_allocation_cents: 200 }).result, 'inside', 'ends are inclusive');
});

test('the dossier carries the linked public record apart from the private fields, or says why it has none', async () => {
  const f = fixture();
  const linked = seed(f, { name: 'Atlas A-I', catalogue: 'atlas-a-i', note: 'private words' });
  const legacy = seed(f, { name: 'Atlas AI' });
  const gone = seed(f, { name: 'Withdrawn', catalogue: 'withdrawn-1' });

  const a = await call(f, 'GET', `/funds/${linked}`);
  assert.equal(a.status, 200);
  assert.equal(a.body.public_record.state, 'ok');
  assert.equal(a.body.public_record.record.uid, 'atlas-a-i');
  assert.equal(a.body.public_record.record.hq, 'London');
  assert.equal(a.body.public_record.record.note, undefined, 'no private field travels in the public record');
  assert.equal(a.body.note, 'private words');

  const l = await call(f, 'GET', `/funds/${legacy}`);
  assert.equal(l.body.public_record.state, 'not_linked', 'nothing is borrowed from a similar name');
  assert.equal(l.body.public_record.record, null);

  const g = await call(f, 'GET', `/funds/${gone}`);
  assert.equal(g.status, 200, 'the dossier still loads');
  assert.equal(g.body.public_record.state, 'withdrawn');
  assert.equal(g.body.public_record.status, 410);
  assert.equal(g.body.public_record.record, null, 'a withdrawn list shows none of its fields');

  const broken = { DB: { prepare() { throw new Error('D1 down'); } } } as any;
  const u = await publicRecordFor(broken, 'atlas-a-i');
  assert.equal(u.state, 'unavailable', 'a failed catalogue read is Unavailable, never an empty record');
  assert.equal((await call(f, 'GET', `/funds/${linked}`, undefined, OTHER)).status, 404, 'another member\'s entry is not found');
});
