/** D6558: mounted own-book writes, pending matches, isolation, support refusal and transactional provenance. Synthetic people only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import contactImports from '../src/routes/contact_imports';

test.after(() => removeMigratedDatabases());
const secret = 'unit-only-6558-'.repeat(8);
function fixture() {
  const db = migratedDatabase();
  db.exec(`INSERT INTO users(id,name,email,role,is_active) VALUES
    (2,'Member','member@example.test','partner',1),(3,'Other','other@example.test','partner',1);
    INSERT INTO network_connections(id,user_id,name,email,company,linkedin_url,source) VALUES
    (21,2,'Existing','existing@example.test','Kept company','https://www.linkedin.com/in/existing','typed'),
    (31,3,'Foreign','foreign@example.test','Private company','https://www.linkedin.com/in/foreign','typed');`);
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/contacts', contactImports);
  async function call(who: number | null, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) {
    const jwt = who == null ? null : await new SignJWT({ user_id: who, ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));
    const r = await app.request('https://unit.test/api/contacts' + path, {
      method, headers: { ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env);
    return { status: r.status, body: await r.json() as any };
  }
  const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n);
  return { db, env, call, count };
}

test('adds only to the caller book with typed provenance, normalized optional fields and no import or invitation', async () => {
  const f = fixture();
  const r = await f.call(2, 'POST', '/book', { user_id: 3, name: ' New Person ', company: ' New Company ', title: ' Engineer ', email: ' NEW@example.test ', linkedin_url: 'linkedin.com/in/New-Person/?trk=ignored' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual([r.body.review_uid, r.body.contacted], [null, false]);
  const row: any = f.db.prepare('SELECT * FROM network_connections WHERE id=?').get(r.body.contact_id);
  assert.deepEqual([row.user_id,row.name,row.company,row.title,row.email,row.linkedin_url,row.source], [2,'New Person','New Company','Engineer','new@example.test','https://www.linkedin.com/in/new-person','typed']);
  const source: any = f.db.prepare('SELECT * FROM contact_sources WHERE contact_id=?').get(row.id);
  assert.deepEqual([source.owner_user_id,source.source,source.created_row,source.job_id], [2,'typed',1,null]);
  assert.equal(f.count('contact_import_jobs'), 0);
  assert.equal(f.count('notifications_inbox'), 0);
  const other = await f.call(3,'GET','/book');
  assert.doesNotMatch(JSON.stringify(other.body), /New Person|new@example.test/);
  const own = await f.call(2,'GET','/book?source=typed');
  assert.match(JSON.stringify(own.body), /New Person/);
});

test('own email and URL matches create pending reviews and leave existing records untouched until a decision', async () => {
  const f = fixture();
  const before = f.db.prepare('SELECT * FROM network_connections WHERE id=21').get();
  for (const [input, reason] of [[{ name:'Email duplicate', email:' EXISTING@example.test ' },'email'], [{ name:'URL duplicate', linkedin_url:'https://www.linkedin.com/in/EXISTING/' },'url']] as const) {
    const r = await f.call(2,'POST','/book',input);
    assert.equal(r.status,201,JSON.stringify(r.body));
    const review: any = f.db.prepare('SELECT * FROM contact_match_reviews WHERE uid=?').get(r.body.review_uid);
    assert.deepEqual([review.owner_user_id,review.contact_id,review.candidate_id,review.candidate_table,review.reason,review.status], [2,r.body.contact_id,21,'network_connections',reason,'pending']);
    assert.deepEqual(f.db.prepare('SELECT * FROM network_connections WHERE id=21').get(),before);
    assert.notEqual(r.body.contact_id,21);
  }
  const pending = await f.call(2,'GET','/import/reviews');
  assert.equal(pending.body.reviews.length,2);
  const merged = await f.call(2,'POST','/import/reviews/'+pending.body.reviews[0].uid+'/merge');
  assert.equal(merged.status,200,JSON.stringify(merged.body));
  assert.deepEqual(f.db.prepare('SELECT * FROM network_connections WHERE id=21').get(),before);
});

test('foreign matches are not reviewed or read, while the same URL in the caller book is reviewed', async () => {
  const f=fixture();const foreign=f.db.prepare('SELECT * FROM network_connections WHERE id=31').get();
  const r=await f.call(2,'POST','/book',{name:'My own person',email:'foreign@example.test',linkedin_url:'linkedin.com/in/foreign'});
  assert.equal(r.status,201);assert.equal(r.body.review_uid,null);
  assert.deepEqual(f.db.prepare('SELECT * FROM network_connections WHERE id=31').get(),foreign);
  const again=await f.call(2,'POST','/book',{name:'Again',linkedin_url:'linkedin.com/in/foreign'});
  const review: any=f.db.prepare('SELECT * FROM contact_match_reviews WHERE uid=?').get(again.body.review_uid);
  assert.equal(review.candidate_id,r.body.contact_id);
  assert.equal((await f.call(3,'GET','/import/reviews')).body.reviews.length,0);
});

test('invalid fields, anonymous callers and support sessions write nothing', async () => {
  const f=fixture();
  for(const [input,field] of [[{},'name'],[{name:' '},'name'],[{name:'x'.repeat(201)},'name'],[{name:'Person',company:12},'company'],[{name:'Person',title:[]},'title'],[{name:'Person',email:'bad'},'email'],[{name:'Person',linkedin_url:'https://evil.example/in/one'},'linkedin_url']] as const){
    const r=await f.call(2,'POST','/book',input);assert.equal(r.status,400);assert.equal(r.body.field,field);
  }
  assert.equal((await f.call(null,'POST','/book',{name:'Anonymous'})).status,401);
  assert.equal((await f.call(2,'POST','/book',{name:'Support'}, {impersonated_by:99})).status,403);
  assert.deepEqual([f.count('network_connections'),f.count('contact_sources'),f.count('contact_match_reviews')],[2,0,0]);
});

test('provenance failure rolls the new contact back with the batch', async () => {
  const f=fixture();
  f.db.exec("CREATE TRIGGER typed_source_failure BEFORE INSERT ON contact_sources BEGIN SELECT RAISE(ABORT, 'synthetic provenance failure'); END;");
  const r=await f.call(2,'POST','/book',{name:'Not committed',email:'existing@example.test'});
  assert.equal(r.status,500);
  assert.deepEqual([f.count('network_connections'),f.count('contact_sources'),f.count('contact_match_reviews')],[2,0,0]);
  assert.doesNotMatch(JSON.stringify(r.body),/synthetic provenance failure|existing@example.test/);
});
