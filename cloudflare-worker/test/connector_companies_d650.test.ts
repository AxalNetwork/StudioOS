import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migration = readFileSync('cloudflare-worker/sql/migrations/435_connector_companies.sql', 'utf8');
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');

function tableFromBaseline(name: string): string {
  const match = baseline.match(new RegExp(`CREATE TABLE ${name} \\([\\s\\S]*?\\n\\);`));
  assert.ok(match, `${name} exists in the deployed schema copy`);
  return match[0];
}

test('migration 435 backfills only companies already linked to each connection owner', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE founders(id INTEGER PRIMARY KEY); CREATE TABLE partners(id INTEGER PRIMARY KEY)');
  for (const name of ['users', 'company_profiles', 'user_company_links', 'integrations']) db.exec(tableFromBaseline(name));
  db.exec(`INSERT INTO users(id, email, name) VALUES (1, 'one@example.test', 'One'), (2, 'two@example.test', 'Two');
    INSERT INTO company_profiles(id, uid, company_name) VALUES (10, 'c10', 'One'), (20, 'c20', 'Two'), (30, 'c30', 'Three');
    INSERT INTO user_company_links(uid, user_id, company_id) VALUES ('l1', 1, 10), ('l2', 1, 20), ('l3', 2, 30);
    INSERT INTO integrations(id, uid, user_id, provider_key, auth_type) VALUES (100, 'i100', 1, 'hubspot', 'oauth2'), (200, 'i200', 2, 'calendly', 'oauth2');`);
  db.exec(migration);
  assert.deepEqual(db.prepare('SELECT integration_id, company_id, enabled FROM integration_companies ORDER BY integration_id, company_id').all().map((row) => ({ ...row })), [
    { integration_id: 100, company_id: 10, enabled: 1 },
    { integration_id: 100, company_id: 20, enabled: 1 },
    { integration_id: 200, company_id: 30, enabled: 1 },
  ]);
  db.exec("INSERT INTO user_company_links(uid, user_id, company_id) VALUES ('l4', 1, 30)");
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM integration_companies WHERE integration_id = 100 AND company_id = 30').get()?.n, 0);
  assert.throws(() => db.exec('INSERT INTO integration_companies(integration_id, company_id, enabled) VALUES (100, 30, 2)'), /CHECK constraint failed/);
  db.close();
});
