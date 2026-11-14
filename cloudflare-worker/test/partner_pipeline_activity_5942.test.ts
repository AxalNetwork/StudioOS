import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import partnerPipeline from '../src/routes/partner_pipeline.ts';

test.after(removeMigratedDatabases);

const stamp = (second: number) => `2026-01-01 00:00:0${second}`;

test('lifecycle activity uses recorded timestamps and scopes each event to the requested opportunity and partner', async () => {
  const db = migratedDatabase();
  try {
    db.exec(`
      INSERT INTO partners (id, name, email) VALUES (1, 'Ours', 'ours@example.test'), (2, 'Other', 'other@example.test');
      INSERT INTO users (id, email, name, role, partner_id) VALUES (80, 'ours@example.test', 'Ours', 'partner', 1);
      INSERT INTO founders (id, name, email) VALUES (5, 'Fran', 'fran@example.test');
      INSERT INTO user_company_links (uid, user_id, company_id) VALUES ('link-11', 80, 11), ('link-12', 80, 12);
      INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description) VALUES
        (1, 'n-1', 9, 5, 'engineering', 'First', 'desc'),
        (2, 'n-2', 9, 5, 'engineering', 'Second', 'desc'),
        (3, 'n-3', 9, 5, 'engineering', 'Third', 'desc'),
        (4, 'n-4', 9, 5, 'engineering', 'Fourth', 'desc');
    `);
    const secret = 'unit-test-jwt-secret-0123456789-abcdef';
    const token = await new SignJWT({ user_id: 80, role: 'partner' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
    const get = async (path: string) => {
      const response = await partnerPipeline.request(path, {
        headers: { Authorization: `Bearer ${token}`, 'X-Company-Id': '11' },
      }, { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' });
      return { status: response.status, body: await response.json() as any };
    };
    const pass = db.prepare("INSERT INTO partner_lead_passes (partner_id, need_id, reason, passed_at) VALUES (?, ?, 'timing', ?)");
    pass.run(1, 1, stamp(1)); pass.run(2, 3, stamp(4));
    const quote = db.prepare("INSERT INTO quotes (id, uid, need_id, partner_id, price, deliverables, status, decided_at) VALUES (?, ?, ?, ?, 100, '[]', 'rejected', ?)");
    quote.run(1, 'quote-1', 2, 1, stamp(3)); quote.run(2, 'quote-2', 3, 1, null);
    db.prepare("INSERT INTO quote_versions (quote_id, version, change_summary, created_at) VALUES (1, 1, 'First', ?)").run(stamp(2));
    db.prepare("UPDATE quotes SET company_id = 11 WHERE id IN (1, 2)").run();
    db.prepare("INSERT INTO quotes (id, uid, need_id, partner_id, company_id, price, deliverables, status, decided_at) VALUES (3, 'quote-3', 4, 1, 12, 100, '[]', 'accepted', ?)").run(stamp(5));
    const all = await get('/activity');
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.items.map((e: any) => [e.kind, e.occurred_at, e.opportunity.need_id]), [
      ['proposal_lost', stamp(3), 2], ['proposal_version', stamp(2), 2], ['passed', stamp(1), 1],
    ]);
    assert.deepEqual((await get('/activity?need_id=1')).body.items.map((e: any) => e.kind), ['passed']);
    assert.deepEqual((await get('/activity?need_id=3')).body.items, []);
    assert.equal((await get('/activity?need_id=wrong')).status, 400);
  } finally { db.close(); }
});
