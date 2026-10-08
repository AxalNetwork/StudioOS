import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { publishedContractTemplates, publishContractTemplates, preparePublishedContract, publicationFields } from '../src/services/contractPublication.ts';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
  for (const table of ['users', 'activity_logs', 'legal_templates', 'deals']) db.exec(tableFromBaseline(baseline, table));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/434_contract_template_publications.sql', 'utf8'));
  db.exec("INSERT INTO users(id,name,email,role) VALUES(1,'Admin','admin@example.test','admin'),(2,'Other','other@example.test','admin'),(3,'Founder','founder@example.test','founder'); INSERT INTO legal_templates(id,slug,title,body_md,version) VALUES(1,'safe','SAFE','Hello {{recipient_name}} {{company.name}} {{price}}',3),(2,'draft','Draft','Draft body',1),(3,'stub','Stub','Stub body',1); UPDATE legal_templates SET is_stub=1 WHERE id=3");
  return { db, env: { DB: d1Over(db) } as any };
}
const input = { template_slug: 'safe', template_version: 3, recipient_name: 'Founder', recipient_email: 'founder@example.test', fields: { 'company.name': 'Example Ltd', price: '$100' } };

test('D647 publication is explicit, excludes stubs, snapshots body and records actor', async () => {
  const { db, env } = fixture();
  assert.deepEqual(await publishedContractTemplates(env), []);
  await publishContractTemplates(env, 1, 'hashed-actor');
  const rows = await publishedContractTemplates(env);
  assert.deepEqual(rows.map(t => t.slug), ['draft', 'safe']);
  assert.deepEqual(publicationFields(rows[1]).map(f => [f.key, f.required]), [['company.name', true], ['price', true], ['recipient_name', false]]);
  assert.equal(rows[1].published_by, 1);
  assert.equal(db.prepare("SELECT user_id FROM activity_logs WHERE action='contract_templates_published'").get()!.user_id, 1);
  db.exec("UPDATE legal_templates SET version=4, body_md='Different {{price}}' WHERE id=1");
  assert.equal((await preparePublishedContract(env, input, 1, false)).body, 'Hello Founder Example Ltd $100');
  await publishContractTemplates(env, 1, 'hashed-actor');
  await assert.rejects(preparePublishedContract(env, input, 1, false), { code: 'published_version_changed' });
  db.exec('UPDATE legal_templates SET is_active=0 WHERE id=1');
  await assert.rejects(preparePublishedContract(env, { ...input, template_version: 4 }, 1, false), { code: 'template_not_published' });
});

test('D647 preparation binds the real account, refuses missing fields and other admins', async () => {
  const { env } = fixture();
  await publishContractTemplates(env, 1, 'hashed-actor');
  const prepared = await preparePublishedContract(env, { ...input, recipient_user_id: 1, rendered_body: 'Injected' }, 1, false);
  assert.equal(prepared.recipientUserId, 3);
  assert.equal(prepared.body, 'Hello Founder Example Ltd $100');
  await assert.rejects(preparePublishedContract(env, { ...input, fields: { price: '$100' } }, 1, false), { code: 'required_fields_missing', fields: ['company.name'] });
  await assert.rejects(preparePublishedContract(env, { ...input, fields: { ...input.fields, recipient_name: 'Impersonated' } }, 1, false), { code: 'fields_invalid' });
  await assert.rejects(preparePublishedContract(env, { ...input, recipient_name: '' }, 1, false), { code: 'recipient_or_template_invalid' });
  await assert.rejects(preparePublishedContract(env, { ...input, recipient_email: 'other@example.test' }, 1, false), { code: 'recipient_unavailable' });
  assert.equal((await preparePublishedContract(env, { ...input, recipient_email: 'other@example.test' }, 1, true)).recipientUserId, 2);
  assert.equal((await preparePublishedContract(env, { ...input, recipient_email: 'new@example.test' }, 1, false)).recipientUserId, null);
  await assert.rejects(preparePublishedContract(env, { ...input, deal_id: 999 }, 1, false), { code: 'deal_not_found' });
});

test('D647 publication rolls back if its actor audit cannot commit', async () => {
  const { db, env } = fixture();
  // Force a failure when the prepared audit executes, after the snapshot
  // statement, rather than a missing-table failure during preparation.
  db.exec("CREATE UNIQUE INDEX test_audit_failure ON activity_logs(user_id); INSERT INTO activity_logs(action,details,actor,user_id) VALUES('fixture','{}','hash',1)");
  await assert.rejects(publishContractTemplates(env, 1, 'hashed-actor'));
  assert.deepEqual(await publishedContractTemplates(env), []);
});

test('D647 recorded recipient identifiers resolve without accepting a typed replacement', async () => {
  const { db, env } = fixture();
  db.exec("UPDATE legal_templates SET body_md='{{counterparty.founder_id}} {{counterparty.user_id}}' WHERE id=1; UPDATE users SET founder_public_id='AXF-EXAMPLE' WHERE id=3");
  await publishContractTemplates(env, 1, 'hashed-actor');
  const prepared = await preparePublishedContract(env, { ...input, fields: {} }, 1, false);
  assert.equal(prepared.body, 'AXF-EXAMPLE 3');
  assert.equal(publicationFields(prepared.template).every(field => !field.required), true);
  await assert.rejects(preparePublishedContract(env, { ...input, fields: { 'counterparty.founder_id': 'FORGED' } }, 1, false), { code: 'fields_invalid' });
  db.exec('UPDATE users SET founder_public_id=NULL WHERE id=3');
  await assert.rejects(preparePublishedContract(env, { ...input, fields: {} }, 1, false), { code: 'required_fields_missing', fields: ['counterparty.founder_id'] });
});

test('D647 a blank saved draft leaves the approved body available until publication withdraws it',async()=>{
  const {db,env}=fixture();await publishContractTemplates(env,1,'hashed-actor');
  db.exec("UPDATE legal_templates SET body_md='',is_stub=1,version=4 WHERE id=1");
  assert.equal((await preparePublishedContract(env,input,1,false)).body,'Hello Founder Example Ltd $100');
  await publishContractTemplates(env,1,'hashed-actor');
  await assert.rejects(preparePublishedContract(env,input,1,false),{code:'template_not_published'});
});
