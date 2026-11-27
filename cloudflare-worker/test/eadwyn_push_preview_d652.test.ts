/**
 * D652 (#1464) — a provider's `preview` is exactly what its `push` sends.
 *
 * Eadwyn's card shows `preview`, the pending action hashes it, and confirm
 * refuses when a fresh `preview` differs. That is only worth anything if
 * `preview` and `push` cannot disagree, so this runs the real HubSpot and
 * Salesforce providers against a stubbed network and compares, field by
 * field, the preview with the request bodies the push actually sent.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/eadwyn_push_preview_d652.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { getProviderImpl } from '../src/integrations/registry.ts';
import '../src/integrations/providers/hubspot.ts';
import '../src/integrations/providers/salesforce.ts';

const JWT_SECRET = 'x'.repeat(64); // synthetic fixture key
const ME = 2, COMPANY = 41;

async function world(provider: 'hubspot' | 'salesforce') {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE founders (id INTEGER PRIMARY KEY, user_id INTEGER, email TEXT, name TEXT, sf_contact_id TEXT);
    INSERT INTO founders VALUES (9, ${ME}, 'ada@example.test', 'Ada King Lovelace', NULL);
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT, description TEXT, sector TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT,
      hubspot_company_id TEXT, hubspot_primary_contact_id TEXT, sf_account_id TEXT, sf_primary_contact_id TEXT
    );
    INSERT INTO projects (id, name, description, sector, founder_id, company_id) VALUES (5, 'Mine', 'Grid storage', 'Climate', 9, ${COMPANY});
    INSERT INTO projects (id, name, description, sector, founder_id, company_id, hubspot_company_id) VALUES (7, 'Linked', NULL, 'Fintech', 9, ${COMPANY}, 'hs-co-7');
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, amount REAL, notes TEXT,
      hubspot_deal_id TEXT, sf_opportunity_id TEXT
    );
    INSERT INTO deals VALUES (50, 5, 'active', 250000, NULL, NULL, NULL), (51, 7, 'funded', NULL, NULL, NULL, NULL);
    CREATE TABLE integrations (
      id INTEGER PRIMARY KEY, uid TEXT, user_id INTEGER, provider_key TEXT, status TEXT, credentials_enc TEXT,
      config_json TEXT, last_synced_at TEXT, updated_at TEXT
    );
    CREATE TABLE integration_companies (integration_id INTEGER, company_id INTEGER, enabled INTEGER);
    INSERT INTO integration_companies VALUES (1, ${COMPANY}, 1);
    CREATE TABLE user_company_links (user_id INTEGER, company_id INTEGER);
    INSERT INTO user_company_links VALUES (${ME}, ${COMPANY});
  `);
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any;
  const creds = provider === 'hubspot'
    ? { access_token: 'pat-fixture', is_private_app: true }
    : { access_token: 'sf-fixture', instance_url: 'https://example.my.salesforce.com' };
  const enc = await encryptCredentials(env, 'i1', creds);
  db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, status, credentials_enc) VALUES (1, 'i1', ?, ?, 'active', ?)")
    .run(ME, provider, enc);
  const row = { ...(db.prepare('SELECT * FROM integrations WHERE id = 1').get() as any) };
  return { db, env, row };
}

/** Stub the network: every request is recorded and answered with a new id. */
function network() {
  const sent: { url: string; method: string; body: any }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    sent.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ id: `new-${sent.length}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as any;
  return { sent, restore: () => { globalThis.fetch = real; } };
}

const asFields = (o: Record<string, unknown>, prefix = '') =>
  Object.entries(o).map(([name, value]) => ({ name: `${prefix}${name}`, value: value ?? null }));

async function previewThenPush(provider: 'hubspot' | 'salesforce', payload: Record<string, number>) {
  const { env, row } = await world(provider);
  const impl = getProviderImpl(provider)!;
  const preview = await impl.preview!(env, row, payload);
  const net = network();
  try {
    await impl.push!({ env } as any, { id: ME } as any, row, payload);
  } finally {
    net.restore();
  }
  return { preview, sent: net.sent };
}

test('HubSpot, new company: the preview lists the company and the contact exactly as pushed', async () => {
  const { preview, sent } = await previewThenPush('hubspot', { project_id: 5 });
  assert.equal(preview.target, 'New HubSpot company "Mine"');
  assert.equal(sent.length, 2);
  assert.deepEqual(preview.fields, [
    ...asFields(sent[0].body.properties),
    ...asFields(sent[1].body.properties, 'contact '),
  ]);
  assert.deepEqual(sent[1].body.properties, { email: 'ada@example.test', firstname: 'Ada', lastname: 'King Lovelace' });
});

test('HubSpot, new deal: the preview lists every property and the associated company as pushed', async () => {
  const { preview, sent } = await previewThenPush('hubspot', { deal_id: 51 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'POST');
  assert.deepEqual(preview.fields, [
    ...asFields(sent[0].body.properties),
    { name: 'associated company', value: sent[0].body.associations[0].to.id },
  ]);
  assert.equal(preview.target, 'New HubSpot deal "Linked"');
});

test('HubSpot, deal without a company: no association is shown and none is sent', async () => {
  const { preview, sent } = await previewThenPush('hubspot', { deal_id: 50 });
  assert.equal(sent[0].body.associations, undefined);
  assert.deepEqual(preview.fields, asFields(sent[0].body.properties));
});

test('Salesforce, new account: the preview lists the account and the contact exactly as pushed', async () => {
  const { preview, sent } = await previewThenPush('salesforce', { project_id: 5 });
  assert.equal(preview.target, 'New Salesforce account "Mine"');
  assert.equal(sent.length, 2);
  const { AccountId, ...contact } = sent[1].body;
  assert.equal(AccountId, 'new-1', 'the contact was not attached to the new account');
  assert.deepEqual(preview.fields, [...asFields(sent[0].body), ...asFields(contact, 'Contact ')]);
});

test('Salesforce, new opportunity: the preview lists every field, the close date included, as pushed', async () => {
  const { preview, sent } = await previewThenPush('salesforce', { deal_id: 50 });
  assert.equal(sent.length, 1);
  assert.deepEqual(preview.fields, asFields(sent[0].body));
  assert.ok(preview.fields.some((f) => f.name === 'CloseDate'), 'the close date Salesforce receives was not shown');
});

test('a preview refuses where the push would: a project in a company switched off', async () => {
  for (const provider of ['hubspot', 'salesforce'] as const) {
    const { db, env, row } = await world(provider);
    db.prepare('UPDATE integration_companies SET enabled = 0').run();
    await assert.rejects(getProviderImpl(provider)!.preview!(env, row, { project_id: 5 }), /company_not_enabled/);
  }
});
