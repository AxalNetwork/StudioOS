import assert from 'node:assert/strict';
import test from 'node:test';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import partnerPipeline from '../src/routes/partner_pipeline.ts';

const secret = 'unit-test-jwt-secret-0123456789-abcdef';

test.after(() => removeMigratedDatabases());

test('negotiation lane limits are advisory and isolated to the editing firm', async () => {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO partners (id, name, email) VALUES (1, 'First', 'first@example.com'), (2, 'Second', 'second@example.com');
    INSERT INTO users (id, name, email, role, partner_id) VALUES
      (80, 'Editor', 'editor@example.com', 'partner', 1),
      (81, 'Other editor', 'other@example.com', 'partner', 2),
      (82, 'Founder', 'founder@example.com', 'founder', 1);
    INSERT INTO founders (id, name, email) VALUES (5, 'Founder', 'founder@example.com');
    INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description)
      VALUES (1, 'need-1', 9, 5, 'engineering', 'Fixture need', 'Description');
    INSERT INTO quotes (id, uid, need_id, partner_id, price, deliverables)
      VALUES (1, 'quote-1', 1, 1, 100, 'Fixture quote');
  `);
  const env = {
    JWT_SECRET: secret,
    ENVIRONMENT: 'development',
    DB: {
      prepare(sql: string) {
        const statement = db.prepare(sql);
        let args: Parameters<typeof statement.get> = [];
        const query = {
          bind(...values: Parameters<typeof statement.get>) { args = values; return query; },
          async first() { return statement.get(...args) ?? null; },
          async all() { return { results: statement.all(...args) }; },
          async run() { return statement.run(...args); },
        };
        return query;
      },
    },
  };

  async function request(user: number, method = 'GET', path = '/negotiations', body?: unknown) {
    const role = user === 82 ? 'founder' : 'partner';
    const token = await new SignJWT({ user_id: user, role })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret));
    const response = await partnerPipeline.request(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env as never);
    return { status: response.status, body: await response.json() as any };
  }

  const empty = { scoping: null, terms: null, legal: null, ready_to_sign: null };
  const limits = '/negotiations/wip-limits';
  assert.deepEqual(await request(80).then(r => r.body.wip_limits), empty);
  assert.equal((await request(82, 'PUT', `${limits}/scoping`, { limit: 4 })).status, 403);
  assert.equal((await request(80, 'PUT', `${limits}/closed`, { limit: 1 })).status, 400);
  for (const invalid of [{}, { limit: '1' }, { limit: -1 }, { limit: 1.5 }, { limit: 2 ** 53 }, null]) {
    assert.equal((await request(80, 'PUT', `${limits}/scoping`, invalid)).status, 400);
  }
  assert.deepEqual(await request(80, 'PUT', `${limits}/scoping`, { limit: 0 }), {
    status: 200, body: { stage: 'scoping', limit: 0 },
  });
  assert.equal((await request(80, 'PUT', `${limits}/terms`, { limit: 2 })).status, 200);
  assert.equal((await request(81, 'PUT', `${limits}/terms`, { limit: 7 })).status, 200);
  assert.equal((await request(80, 'PUT', '/negotiations/1', { stage: 'scoping' })).status, 200);
  const first = await request(80);
  assert.deepEqual(first.body.wip_limits, { ...empty, scoping: 0, terms: 2 });
  assert.equal(first.body.items[0].negotiation.stage, 'scoping');
  assert.deepEqual((await request(81)).body.wip_limits, { ...empty, terms: 7 });

  assert.equal((await request(80, 'PUT', `${limits}/terms`, { limit: 5 })).status, 200);
  assert.equal((await request(80)).body.wip_limits.terms, 5);
  assert.equal((await request(80, 'PUT', `${limits}/terms`, { limit: null })).status, 200);
  assert.deepEqual((await request(80)).body.wip_limits, { ...empty, scoping: 0 });
  assert.deepEqual((await request(81)).body.wip_limits, { ...empty, terms: 7 });
});
