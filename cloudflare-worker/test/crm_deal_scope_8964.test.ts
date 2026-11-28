// D8964 (#8964): every HubSpot and Salesforce statement that scopes a deal or project to the integration owner,
// run on the real schema (baseline plus every migration, `_storage_schema.ts`), with no column added by the fixture.
// `founders` has no `user_id`; a founder belongs to a user through `users.founder_id`.
//
// Ids are chosen so a wrong predicate leaks: user A (id 1) holds founder 2 and user B (id 2) holds founder 1, so a
// predicate comparing the founder id to the user id reads the other tenant's rows. Both tenants' deals carry the same
// HubSpot and Salesforce ids (HubSpot ids are not unique across portals), and A's integration is also enabled for
// B's company, so only the owner predicate keeps B's deal out.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/crm_deal_scope_8964.test.ts
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import {
  FOUNDER_OF_OWNER, ownerDealsChangedSinceSql, ownerDealByCrmIdSql, SF_OWNER_DEAL_SQL, SF_OWNER_PROJECT_SQL,
} from '../src/integrations/crmDealScope.ts';

after(removeMigratedDatabases);

const USER_A = 1, USER_B = 2, ADMIN = 3;
const FOUNDER_A = 2, FOUNDER_B = 1;
const PROJECT_A = 10, PROJECT_B = 20, COMPANY_A = 100, COMPANY_B = 200;
const DEAL_A = 1000, DEAL_B = 2000;
const INTEGRATION_A = 50, INTEGRATION_B = 60, INTEGRATION_ADMIN = 70;
const SINCE = '2026-01-01 00:00:00'; // the last sync's watermark, before both deals' updated_at

function seeded() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders (id, name, email) VALUES (${FOUNDER_B}, 'Founder B', 'b@example.test'), (${FOUNDER_A}, 'Founder A', 'a@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES
      (${USER_A}, 'a@example.test', 'A', 'founder', ${FOUNDER_A}),
      (${USER_B}, 'b@example.test', 'B', 'founder', ${FOUNDER_B}),
      (${ADMIN}, 'admin@example.test', 'Admin', 'admin', NULL);
    INSERT INTO projects (id, name, founder_id, company_id) VALUES
      (${PROJECT_A}, 'Venture A', ${FOUNDER_A}, ${COMPANY_A}), (${PROJECT_B}, 'Venture B', ${FOUNDER_B}, ${COMPANY_B});
    INSERT INTO deals (id, project_id, status, hubspot_deal_id, sf_opportunity_id, updated_at) VALUES
      (${DEAL_A}, ${PROJECT_A}, 'active', 'hs-shared', 'sf-shared', '2026-01-02 00:00:00'),
      (${DEAL_B}, ${PROJECT_B}, 'active', 'hs-shared', 'sf-shared', '2026-01-02 00:00:00');
    INSERT INTO integrations (id, uid, user_id, provider_key, auth_type) VALUES
      (${INTEGRATION_A}, 'int-a', ${USER_A}, 'hubspot', 'oauth2'),
      (${INTEGRATION_B}, 'int-b', ${USER_B}, 'hubspot', 'oauth2'),
      (${INTEGRATION_ADMIN}, 'int-admin', ${ADMIN}, 'hubspot', 'oauth2');
    INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES
      (${INTEGRATION_A}, ${COMPANY_A}, 1), (${INTEGRATION_A}, ${COMPANY_B}, 1),
      (${INTEGRATION_B}, ${COMPANY_B}, 1),
      (${INTEGRATION_ADMIN}, ${COMPANY_A}, 1), (${INTEGRATION_ADMIN}, ${COMPANY_B}, 1);
  `);
  return db;
}

const ids = (rows: any[]) => rows.map((r) => Number(r.id)).sort((x, y) => x - y);

test('founders has no user_id on the migrated schema; the scope reads users.founder_id', () => {
  const db = migratedDatabase();
  const founderCols = db.prepare('PRAGMA table_info(founders)').all().map((c: any) => c.name);
  assert.ok(!founderCols.includes('user_id'), 'the fixture must not need a founders.user_id column');
  assert.ok(db.prepare('PRAGMA table_info(users)').all().some((c: any) => c.name === 'founder_id'));
  assert.match(FOUNDER_OF_OWNER, /users u WHERE u\.id = \?/);
  db.close();
});

for (const key of ['hubspot_deal_id', 'sf_opportunity_id'] as const) {
  test(`${key}: outbound sync reads only the owner's deals`, () => {
    const db = seeded();
    const sql = ownerDealsChangedSinceSql(key);
    assert.deepEqual(ids(db.prepare(sql).all(USER_A, SINCE, INTEGRATION_A)), [DEAL_A]);
    assert.deepEqual(ids(db.prepare(sql).all(USER_B, SINCE, INTEGRATION_B)), [DEAL_B]);
    // Salesforce's row carries user_id as text; SQLite's integer affinity still matches it.
    assert.deepEqual(ids(db.prepare(sql).all(String(USER_A), SINCE, INTEGRATION_A)), [DEAL_A]);
    // Cross-tenant: B's id with A's integration reads only B's deal in a company A's integration enabled, never A's.
    assert.deepEqual(ids(db.prepare(sql).all(USER_B, SINCE, INTEGRATION_A)), [DEAL_B]);
    // An owner with no founder (an admin) reads nothing, even with both companies enabled.
    assert.deepEqual(ids(db.prepare(sql).all(ADMIN, SINCE, INTEGRATION_ADMIN)), []);
    // Nothing changed after the watermark: nothing to push.
    assert.deepEqual(ids(db.prepare(sql).all(USER_A, '2026-01-03 00:00:00', INTEGRATION_A)), []);
    // D5454: the guarded provider read adds its hidden IDs without changing owner or company scope.
    const guarded = db.prepare(ownerDealsChangedSinceSql(key, true));
    assert.deepEqual(ids(guarded.all(USER_A, SINCE, INTEGRATION_A, '[]')), [DEAL_A]);
    assert.deepEqual(ids(guarded.all(USER_A, SINCE, INTEGRATION_A, JSON.stringify([DEAL_A]))), []);
    assert.deepEqual(ids(guarded.all(USER_A, SINCE, INTEGRATION_A, JSON.stringify([DEAL_B]))), [DEAL_A]);
    // The company scope still applies: with A's company switched off, A's own deal is not pushed.
    db.prepare('UPDATE integration_companies SET enabled = 0 WHERE integration_id = ? AND company_id = ?').run(INTEGRATION_A, COMPANY_A);
    assert.deepEqual(ids(db.prepare(sql).all(USER_A, SINCE, INTEGRATION_A)), []);
    db.close();
  });

  test(`${key}: inbound match and webhook find only the owner's deal for a shared CRM id`, () => {
    const db = seeded();
    const sql = ownerDealByCrmIdSql(key);
    const crmId = key === 'hubspot_deal_id' ? 'hs-shared' : 'sf-shared';
    assert.equal(Number((db.prepare(sql).get(crmId, USER_A, INTEGRATION_A) as any)?.id), DEAL_A);
    assert.equal(Number((db.prepare(sql).get(crmId, USER_B, INTEGRATION_B) as any)?.id), DEAL_B);
    // Cross-tenant refusal: B's integration (company B only) never reaches A's deal, nor does an admin's.
    assert.deepEqual(ids(db.prepare(sql).all(crmId, USER_B, INTEGRATION_B)), [DEAL_B]);
    assert.equal(db.prepare(sql).get(crmId, ADMIN, INTEGRATION_ADMIN), undefined);
    assert.equal(db.prepare(sql).get('no-such-id', USER_A, INTEGRATION_A), undefined);
    db.prepare('UPDATE integration_companies SET enabled = 0 WHERE integration_id = ? AND company_id = ?').run(INTEGRATION_A, COMPANY_A);
    assert.equal(db.prepare(sql).get(crmId, USER_A, INTEGRATION_A), undefined, 'a switched-off company is not matched');
    db.close();
  });
}

test('Salesforce push: a deal is read only for its owner', () => {
  const db = seeded();
  const own = db.prepare(SF_OWNER_DEAL_SQL).get(DEAL_A, USER_A) as any;
  assert.equal(Number(own?.id), DEAL_A);
  assert.equal(own?.project_name, 'Venture A');
  assert.equal(db.prepare(SF_OWNER_DEAL_SQL).get(DEAL_B, USER_A), undefined, "A cannot push B's deal by guessing its id");
  assert.equal(db.prepare(SF_OWNER_DEAL_SQL).get(DEAL_A, USER_B), undefined, "B cannot push A's deal");
  assert.equal(db.prepare(SF_OWNER_DEAL_SQL).get(DEAL_A, ADMIN), undefined, 'an owner without a founder pushes nothing');
  db.close();
});

test('Salesforce account push: a project is read only for its owner', () => {
  const db = seeded();
  const own = db.prepare(SF_OWNER_PROJECT_SQL).get(PROJECT_A, String(USER_A)) as any;
  assert.equal(Number(own?.id), PROJECT_A);
  assert.equal(Number(own?.f_id), FOUNDER_A);
  assert.equal(own?.founder_email, 'a@example.test');
  assert.equal(db.prepare(SF_OWNER_PROJECT_SQL).get(PROJECT_B, USER_A), undefined, "A cannot push B's project");
  assert.equal(db.prepare(SF_OWNER_PROJECT_SQL).get(PROJECT_A, USER_B), undefined, "B cannot push A's project");
  assert.equal(db.prepare(SF_OWNER_PROJECT_SQL).get(PROJECT_A, ADMIN), undefined, 'an owner without a founder pushes nothing');
  db.close();
});

test('the providers read through these statements, not a founders.user_id of their own', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['hubspot.ts', 'salesforce.ts']) {
    const src = readFileSync(new URL(`../src/integrations/providers/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\bf\.user_id\b/, `${file} filters on founders.user_id`);
    assert.match(src, /ownerDealsChangedSinceSql\(/);
    assert.match(src, /ownerDealByCrmIdSql\(/);
  }
});
