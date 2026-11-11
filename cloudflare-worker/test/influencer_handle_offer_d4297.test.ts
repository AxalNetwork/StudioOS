/**
 * D4297 (#4297, D4289 P8) — the public @handle read carries the influencer's
 * featured offer (P4 #4293's `featuredOffer`), so IN7 can show it beside the
 * disclosure. No featured active offer is none. An offer store that cannot be
 * read shows no offer and the page still answers. Every person is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/influencer_handle_offer_d4297.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { publicHandle } from '../src/services/influencerHandles.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const SUPER = 1, JANE = 10;
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

function world(o: { featured?: number; status?: string } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, uid, role, name, email, is_active, email_verified) VALUES (?, ?, ?, ?, ?, 1, 1)');
  u.run(SUPER, 'u-sue', 'admin', 'Sue Super', 'sue@example.test');
  u.run(JANE, 'u-jane', 'investor', 'Jane Rivera', 'jane@example.test');
  db.prepare(`INSERT INTO influencers (id, uid, user_id, tier, status, admitted_by, handle) VALUES (1, 'inf_jane', ?, 'verified_influencer', 'active', ?, 'jane')`).run(JANE, SUPER);
  db.prepare(`INSERT INTO promo_codes (id, code, code_normalized, coupon_id, percent_off, amount_off, currency, duration, duration_in_months, product_ids_json,
      max_redemptions, times_redeemed, active, expires_at, plan_keys_json, intervals_json, once_per_member, first_purchase_only, created_at, synced_at)
    VALUES ('promo_jane20', 'JANE20', 'JANE20', 'cpn_20', 20, NULL, NULL, 'repeating', 3, '[]', NULL, 0, 1, '2027-01-01T00:00:00Z', '[]', NULL, 1, 0, datetime('now'), datetime('now'))`).run();
  db.prepare(`INSERT INTO influencer_offers (uid, influencer_user_id, promo_id, budget_cents, currency, status, featured, created_by)
    VALUES ('off_1', ?, 'promo_jane20', 200000, 'USD', ?, ?, ?)`).run(JANE, o.status ?? 'active', o.featured ?? 1, SUPER);
  return db;
}
const read = (db: DatabaseSync) => publicHandle({ DB: d1Over(db), ENVIRONMENT: 'test' } as any, 'jane', null, null, NOW);

test('a live handle carries its featured active offer, in the words P4 writes, beside the disclosure', async () => {
  const r = await read(world());
  assert.equal(r.status, 200);
  const b: any = r.body;
  assert.equal(b.state, 'live');
  assert.equal(b.offer?.uid, 'off_1');
  assert.equal(b.offer?.discount, '20% off for 3 months');
  assert.equal(b.offer?.who_for, 'Once per member');
  assert.equal(b.disclosure, 'Jane Rivera earns a commission when you subscribe. Axal memberships are software, not an investment.');
  assert.ok(!JSON.stringify(b.offer).includes('200000'), 'the budget is HQ\'s, never the visitor\'s');
});

test('no featured offer, or a paused one, is none; an unreadable offer store shows none and the page still answers', async () => {
  assert.equal(((await read(world({ featured: 0 }))).body as any).offer, null);
  assert.equal(((await read(world({ status: 'paused' }))).body as any).offer, null);
  const broken = world();
  broken.exec('DROP TABLE influencer_offers');
  const saved = console.warn; console.warn = () => {};
  try {
    const r = await read(broken);
    assert.equal(r.status, 200);
    assert.equal((r.body as any).state, 'live');
    assert.equal((r.body as any).offer, null);
  } finally { console.warn = saved; }
});
