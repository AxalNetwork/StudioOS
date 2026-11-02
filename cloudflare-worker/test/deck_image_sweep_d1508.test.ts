/**
 * D1508 (#3759, deck v2 A15): deck images nothing references leave R2.
 * The real migrated schema in memory; R2 is a map. Synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/deck_image_sweep_d1508.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckImages from '../src/routes/deck_images.ts';
import { MAX_DELETES, imageReferenced, sweepDeckImages } from '../src/services/decks/imageSweep.ts';
import { Jobs } from '../src/models/jobs.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const names = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF)
  .sort((a, b) => migrationNumber(a) - migrationNumber(b) || a.localeCompare(b));
const sqlOf = (n: string) => readFileSync(new URL('migrations/' + n, root), 'utf8');

const NOW = new Date('2026-11-02T03:05:00Z');
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
const UID = (n: number) => `0b6a2c1e-3f4d-4a5b-8c9d-${String(n).padStart(12, '0')}`;

function fixture(upTo = Infinity) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(baseline);
  for (const n of names) if (migrationNumber(n) <= upTo) db.exec(sqlOf(n));
  db.exec("INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (2, 'founder', 100, 'Synthetic founder', 'synthetic-2@example.invalid', 1, 'studio')");
  db.exec("INSERT INTO projects(id, name, founder_id) VALUES (1, 'Synthetic venture', 100), (2, 'Other synthetic venture', 200)");
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (7, 1, 1, ?, ?, 1)').run('[]', 'Synthetic deck');
  const r2 = new Map<string, Uint8Array>();
  let failDelete = false;
  const FILES = {
    put: async (key: string, b: Uint8Array) => { r2.set(key, b); },
    get: async (key: string) => (r2.has(key) ? { body: new Blob([r2.get(key)!]).stream() } : null),
    delete: async (key: string) => { if (failDelete) throw new Error('R2 down'); r2.delete(key); },
  };
  const env: any = { DB: d1Over(db), FILES };
  let n = 0;
  const image = (o: { state: 'proposed' | 'kept' | 'discarded'; createdHoursAgo: number; discardedHoursAgo?: number | null; project?: number; bytes?: number }) => {
    n += 1;
    const uid = UID(n);
    const project = o.project ?? 1;
    const key = `deck-images/${project}/${uid}.png`;
    r2.set(key, new Uint8Array([1, 2, 3]));
    db.prepare(`INSERT INTO deck_images (uid, project_id, deck_id, r2_key, mime, size_bytes, source, use, state, created_at, discarded_at)
      VALUES (?, ?, 7, ?, 'image/png', ?, 'generated', 'content', ?, ?, ?)`)
      .run(uid, project, key, o.bytes ?? 1000, o.state, at(o.createdHoursAgo), o.discardedHoursAgo == null ? null : at(o.discardedHoursAgo));
    return { uid, key, id: Number((db.prepare('SELECT id FROM deck_images WHERE uid = ?').get(uid) as any).id) };
  };
  const row = (uid: string) => db.prepare('SELECT * FROM deck_images WHERE uid = ?').get(uid) as any;
  const tombstones = () => db.prepare('SELECT key, project_id, bytes, reason, deleted_at FROM deck_r2_tombstones ORDER BY key').all() as any[];
  return { db, env, r2, image, row, tombstones, failR2: () => { failDelete = true; } };
}
type F = ReturnType<typeof fixture>;
const gone = (f: F, img: { uid: string; key: string }) => !f.row(img.uid) && !f.r2.has(img.key);
const stays = (f: F, img: { uid: string; key: string }) => !!f.row(img.uid) && f.r2.has(img.key);

test('a discarded image goes 24 hours after Discard, a proposal nobody kept after 14 days; a kept image never', async () => {
  const f = fixture();
  const discardedOld = f.image({ state: 'discarded', createdHoursAgo: 100, discardedHoursAgo: 25, bytes: 1234 });
  const discardedNew = f.image({ state: 'discarded', createdHoursAgo: 100, discardedHoursAgo: 23 });
  const proposalOld = f.image({ state: 'proposed', createdHoursAgo: 24 * 14 + 1, bytes: 66 });
  const proposalNew = f.image({ state: 'proposed', createdHoursAgo: 24 * 13 });
  const keptOld = f.image({ state: 'kept', createdHoursAgo: 24 * 400 });
  const r = await sweepDeckImages(f.env, NOW);
  assert.deepEqual([r.deleted, r.failed, r.bytes], [2, 0, 1300]);
  assert.ok(gone(f, discardedOld) && gone(f, proposalOld));
  assert.ok(stays(f, discardedNew) && stays(f, proposalNew) && stays(f, keptOld));
  assert.deepEqual(f.tombstones().map((t) => [t.key, t.project_id, t.bytes, t.reason, t.deleted_at]).sort(), [
    [discardedOld.key, 1, 1234, 'discarded', '2026-11-02 03:05:00'],
    [proposalOld.key, 1, 66, 'unkept_proposal', '2026-11-02 03:05:00'],
  ].sort());
});

test('an image any version, draft, proposed deck or derivative of its venture names is never removed', async () => {
  const f = fixture();
  const old = () => f.image({ state: 'discarded', createdHoursAgo: 100, discardedHoursAgo: 48 });
  const inSlides = old(); const inTheme = old(); const inDraft = old(); const inProposal = old(); const inDerivative = old(); const other = old();
  f.db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, theme_json) VALUES (8, 1, 2, ?, ?, 0, ?)')
    .run(JSON.stringify([{ title: 'A', blocks: [{ kind: 'image', image_url: `https://axal.vc/api/decks/images/${inSlides.uid}/file` }] }]), 'v2', JSON.stringify({ background: { image_id: inTheme.uid } }));
  f.db.prepare("INSERT INTO pitch_deck_cards (deck_id, card_uid, json) VALUES (7, 'c1', ?)").run(JSON.stringify({ blocks: [{ kind: 'image', image_id: inDraft.uid }] }));
  f.db.prepare('INSERT INTO pitch_deck_proposals (project_id, base_deck_id, slides) VALUES (1, 7, ?)').run(JSON.stringify([{ image_url: `/api/decks/images/${inProposal.uid}/file` }]));
  f.db.prepare("INSERT INTO deck_derivatives (uid, deck_id, project_id, format, title, slides, proposal_uid, created_by) VALUES ('dv1', 7, 1, 'teaser', 'Teaser', ?, 'pp1', 2)")
    .run(JSON.stringify([{ image_url: `/api/decks/images/${inDerivative.uid}/file` }]));
  // Another venture's deck naming this image does not keep it: its file route never serves a discarded image.
  f.db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (9, 2, 1, ?, ?, 1)').run(JSON.stringify([{ image_id: other.uid }]), 'other');
  const r = await sweepDeckImages(f.env, NOW);
  for (const [name, img] of Object.entries({ inSlides, inTheme, inDraft, inProposal, inDerivative })) assert.ok(stays(f, img), `${name} was removed`);
  assert.ok(gone(f, other));
  assert.deepEqual([r.deleted, r.kept_named], [1, 5]);
  assert.equal(await imageReferenced(f.env, inSlides.id), true);
});

test('a save that names the image after the check still keeps it: the claim repeats the rule', async () => {
  const f = fixture();
  const img = f.image({ state: 'proposed', createdHoursAgo: 24 * 20 });
  const real = f.env.DB;
  // Right after the first check reads "not named", a save names the image.
  f.env.DB = { ...real, prepare: (sql: string) => {
    const st = real.prepare(sql);
    if (!sql.includes('FROM deck_images_named WHERE id = ?) AS named')) return st;
    return { bind: (...a: unknown[]) => { const b = st.bind(...a); return { ...b, first: async () => {
      const out = await b.first();
      f.db.prepare('UPDATE pitch_decks SET slides = ? WHERE id = 7').run(JSON.stringify([{ image_id: img.uid }]));
      return out;
    } }; } };
  }, batch: real.batch.bind(real) };
  const r = await sweepDeckImages(f.env, NOW);
  assert.equal(r.deleted, 0);
  assert.ok(stays(f, img), 'the image named in between was deleted');
  assert.deepEqual(f.tombstones(), [], 'no tombstone for an image that stayed');
});

test(`at most ${MAX_DELETES} objects a run, oldest first; a failed R2 delete is counted`, async () => {
  const f = fixture();
  const imgs = Array.from({ length: MAX_DELETES + 3 }, (_, i) => f.image({ state: 'proposed', createdHoursAgo: 24 * 30 + (MAX_DELETES + 3 - i) }));
  const r = await sweepDeckImages(f.env, NOW);
  assert.equal(r.deleted, MAX_DELETES);
  assert.ok(imgs.slice(0, MAX_DELETES).every((x) => gone(f, x)), 'the oldest went first');
  assert.ok(imgs.slice(MAX_DELETES).every((x) => stays(f, x)), 'the rest wait for tomorrow');
  f.failR2();
  const again = await sweepDeckImages(f.env, NOW);
  assert.deepEqual([again.deleted, again.failed], [0, 3]);
  assert.equal(f.tombstones().length, MAX_DELETES + 3, 'a tombstone names the key an operator must remove');
});

test('no storage bound: nothing is touched', async () => {
  const f = fixture();
  const img = f.image({ state: 'discarded', createdHoursAgo: 100, discardedHoursAgo: 48 });
  delete f.env.FILES;
  assert.deepEqual(await sweepDeckImages(f.env, NOW), { scanned: 0, deleted: 0, kept_named: 0, failed: 0, bytes: 0 });
  assert.ok(f.row(img.uid));
});

test('migration 722 gives an image discarded before it a discard time, so it waits a day after deploy', () => {
  const f = fixture(721);
  f.db.prepare("INSERT INTO deck_images (uid, project_id, r2_key, mime, source, use, state) VALUES (?, 1, 'deck-images/1/a.png', 'image/png', 'generated', 'content', 'discarded')").run(UID(1));
  f.db.prepare("INSERT INTO deck_images (uid, project_id, r2_key, mime, source, use, state) VALUES (?, 1, 'deck-images/1/b.png', 'image/png', 'generated', 'content', 'proposed')").run(UID(2));
  f.db.exec(sqlOf(names.find((n) => migrationNumber(n) === 722)!));
  const rows = f.db.prepare('SELECT uid, discarded_at FROM deck_images ORDER BY uid').all() as any[];
  assert.ok(rows[0].discarded_at, 'the discarded row has a time');
  assert.equal(rows[1].discarded_at, null, 'a proposal has none');
});

test('Discard records when it was pressed', async () => {
  const f = fixture();
  const img = f.image({ state: 'proposed', createdHoursAgo: 1 });
  const JWT_SECRET = 'synthetic-d1508-only-not-a-real-credential'.repeat(2);
  f.env.JWT_SECRET = JWT_SECRET; f.env.ENVIRONMENT = 'development';
  await ensureProjectMembershipSchema(f.env);
  const app = new Hono<any>().route('/api/decks', deckImages);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const token = await new SignJWT({ user_id: 2 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`https://axal.vc/api/decks/images/${img.uid}/discard`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, f.env);
  assert.equal(res.status, 200, await res.text());
  const row = f.row(img.uid);
  assert.equal(row.state, 'discarded');
  assert.ok(row.discarded_at, 'no discard time recorded');
});

test('the daily cleanup (Jobs.cleanup, 03:00) runs the sweep', async () => {
  const f = fixture();
  const img = f.image({ state: 'discarded', createdHoursAgo: 24 * 10, discardedHoursAgo: 24 * 9 });
  await Jobs.cleanup(f.env);
  assert.ok(gone(f, img), 'the daily cleanup did not remove an unreferenced discarded image');
});
