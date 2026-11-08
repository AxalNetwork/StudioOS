/**
 * #4714 (D4714) — the owner's slot grid says what each booked hour was priced
 * at, from the bookings' own `amount_cents` (migration 205: NULL is unpriced,
 * 0 is free), so the Booked tile never counts an hour with no price as free.
 *
 * On the migrated schema, synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_slot_pricing_4714.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import advisors from '../src/routes/advisors.ts';

const SECRET = 'test'.repeat(16);
test.after(() => removeMigratedDatabases());
const later = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

test('booked_pricing: priced, free, unpriced, mixed, and null for a slot nobody holds', async () => {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,is_active) VALUES (21,'Advisor','a@example.test','advisor',1),
      (11,'F1','f1@example.test','founder',1),(12,'F2','f2@example.test','founder',1);
    INSERT INTO advisors(id,uid,user_id,display_name,email) VALUES (201,'a-1',21,'Advisor','a@example.test');
  `);
  const s = db.prepare('INSERT INTO advisor_office_hour_slots(id,uid,advisor_id,starts_at,ends_at,capacity) VALUES (?,?,201,?,?,2)');
  for (let i = 1; i <= 6; i += 1) s.run(i, `s-${i}`, later(i), later(i + 0.05));
  const b = db.prepare('INSERT INTO advisor_bookings(uid,slot_id,advisor_id,founder_user_id,status,amount_cents) VALUES (?,?,201,?,?,?)');
  b.run('b1', 1, 11, 'confirmed', 15000);   // priced
  b.run('b2', 2, 11, 'confirmed', 0);       // free
  b.run('b3', 3, 11, 'pending', null);      // unpriced
  b.run('b4', 4, 11, 'confirmed', 15000); b.run('b5', 4, 12, 'confirmed', null); // mixed
  b.run('b6', 5, 11, 'cancelled', 15000);   // cancelled: nobody holds slot 5
  // slot 6: never booked
  const app = new Hono<any>(); app.route('/api/advisors', advisors);
  const jwt = await new SignJWT({ user_id: 21 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request('/api/advisors/me/slots?days=30', { headers: { Authorization: `Bearer ${jwt}` } }, { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const body = await res.json() as any;
  assert.equal(res.status, 200, JSON.stringify(body));
  const by = Object.fromEntries(body.items.map((x: any) => [x.uid, x.booked_pricing]));
  assert.deepEqual(by, { 's-1': 'priced', 's-2': 'free', 's-3': 'unpriced', 's-4': 'mixed', 's-5': null, 's-6': null });
  db.close();
});
