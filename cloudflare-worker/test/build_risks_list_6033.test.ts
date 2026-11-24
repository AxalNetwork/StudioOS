/**
 * D6033 (#6033, BD25) — Solution design's risks as a list, read on its own.
 *
 *   1. every risk is listed, a risk tied to no feature and an accepted Build Plan risk too,
 *      High first, with its owner (You, a name or none), its feature or none, its mitigation
 *      and "From the Build Plan"; the counts are the venture's whole list;
 *   2. 25 a page, with the total and the page count; a filter narrows the rows and the total,
 *      not the counts; a bad state, feature or page is a 400;
 *   3. a writer gets the owners and features Add offers, a reader neither; another venture's
 *      risks never appear, and a viewer who cannot read the board is refused;
 *   4. a feature-less risk is the venture's own record (`ownedRow`), so the list's Edit closes it
 *      through PATCH; another venture's risk stays a 404;
 *   5. the module read is unchanged: its statement count and its risk counts are what they were.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_risks_list_6033.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import { ownedRow } from '../src/services/records/owned.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const SECRET = '6033-local-test-secret-0123456789-abcdef';
const WRITER = 10, READER = 11, OTHER = 12, MEMBER = 13;
const app = new Hono<any>();
app.route('/api/cycles/build', build);
app.onError((error, c) => c.json({ detail: error.message }, 500));

/**
 * Venture 1: risks 1–4 (feature 7, two feature-less, one landed from the Build Plan), venture 2: risk 9.
 * Company 5's members are the writer and a second member; the plan item lands risk 3.
 */
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,is_active) VALUES
    (${WRITER},'owner@example.test','Synthetic Owner','founder',1001,1), (${READER},'reader@example.test','Synthetic Reader','partner',NULL,1),
    (${OTHER},'other@example.test','Synthetic Other','founder',1002,1), (${MEMBER},'member@example.test','Synthetic Member','founder',1003,1);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES (1,'Example',1001,5),(2,'Other',1002,6);
    INSERT INTO user_company_links(uid,user_id,company_id) VALUES ('owner',${WRITER},5),('member',${MEMBER},5),('other',${OTHER},6);
    INSERT INTO mvp_features(id,project_id,title) VALUES (7,1,'Synthetic import'),(8,1,'Synthetic wizard'),(9,2,'Other venture feature');
    INSERT INTO venture_risks(id,project_id,title,severity,owner_user_id,mitigation,state,feature_id,created_by) VALUES
      (1,1,'Synthetic low risk','low',NULL,NULL,'open',NULL,${WRITER}),
      (2,1,'Synthetic tied risk','high',${WRITER},'Synthetic review step','mitigating',7,${WRITER}),
      (3,1,'Synthetic plan risk','high',${MEMBER},NULL,'open',NULL,${WRITER}),
      (4,1,'Synthetic closed risk','medium',NULL,'  ','closed',8,${WRITER}),
      (9,2,'Other venture risk','high',NULL,NULL,'open',9,${OTHER});
    INSERT INTO build_plans(id,uid,project_id,scope,trigger,status,evidence_hash,created_by) VALUES (1,'plan-1',1,'venture','manual','open','synthetic-hash',${WRITER});
    INSERT INTO ai_rail_proposals(uid,user_id,rail_page,rail_option,kind,status,payload_json) VALUES ('p-1',${WRITER},'build/plan','plan','proposal','accepted','{}');
    INSERT INTO build_plan_items(uid,plan_id,project_id,module,kind,item_key,proposal_uid,evidence_json,landed_table,landed_id,marker)
      VALUES ('i-1',1,1,'solution-design','risk','risk-1','p-1','[]','venture_risks','3','m-1');`);
  return db;
}
let seen: string[] = [];
const envFor = (db: DatabaseSync) => {
  const d1 = d1Over(db) as any;
  const prepare = d1.prepare.bind(d1);
  d1.prepare = (sql: string) => { seen.push(sql); return prepare(sql); };
  return { DB: d1, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
};
async function request(db: DatabaseSync, path: string, method = 'GET', user = WRITER, body?: unknown) {
  const token = await new SignJWT({ user_id: user, role: user === READER ? 'partner' : 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(1).setExpirationTime(4102444800).sign(new TextEncoder().encode(SECRET));
  const response = await withThrownResponses(() => app.request('/api/cycles/build' + path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  }, envFor(db)));
  return { status: response.status, body: await response.json() as any };
}

test('1. every risk is listed, feature-less and Build Plan risks too, High first, with owner, feature, mitigation and origin', async () => {
  // Mutation checked: the feature join made inner → risks 1 and 3 vanish; the severity order dropped → id order;
  // from_plan read from another table → false for risk 3; "You" ignored → the writer's name; a blank mitigation kept as text.
  const db = fixture();
  const r = await request(db, '/risks?project=1');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rows.map((x: any) => x.id), [2, 3, 4, 1], 'High (open before closed), then Medium, then Low');
  const [tied, plan, closed, loose] = r.body.rows;
  assert.deepEqual(tied, { id: 2, title: 'Synthetic tied risk', severity: 'high', state: 'mitigating', mitigation: 'Synthetic review step',
    owner: { you: true, name: 'Synthetic Owner' }, feature: { id: 7, title: 'Synthetic import' }, from_plan: false });
  assert.deepEqual([plan.feature, plan.owner, plan.from_plan], [null, { you: false, name: 'Synthetic Member' }, true]);
  assert.equal(closed.mitigation, null, 'a blank mitigation is no mitigation');
  assert.deepEqual([loose.owner, loose.feature], [null, null]);
  assert.deepEqual(r.body.counts, { all: 4, open: 2, mitigating: 1, closed: 1, tied: 2, untied: 2, high: 2, medium: 1, low: 1 });
  assert.deepEqual([r.body.total, r.body.page, r.body.per_page, r.body.pages], [4, 1, 25, 1]);
});

test('2. 25 a page with its total; a filter narrows rows and total, not counts; a bad query is a 400', async () => {
  // Mutation checked: OFFSET left at 0 → page 2 repeats page 1; the state filter not bound → every state;
  // tied/untied swapped; the total read without the filter → 4; no page check → a page of "x" answered.
  const db = fixture();
  const insert = db.prepare(`INSERT INTO venture_risks(project_id,title,severity,state,created_by) VALUES (1,?,?,'open',${WRITER})`);
  for (let i = 0; i < 26; i++) insert.run(`Synthetic extra ${i}`, 'low');
  const one = await request(db, '/risks?project=1');
  const two = await request(db, '/risks?project=1&page=2');
  assert.deepEqual([one.body.rows.length, two.body.rows.length, one.body.total, one.body.pages], [25, 5, 30, 2]);
  assert.equal(new Set([...one.body.rows, ...two.body.rows].map((x: any) => x.id)).size, 30, 'no risk on both pages');
  const open = await request(db, '/risks?project=1&state=open');
  assert.equal(open.body.total, 28);
  assert.ok(open.body.rows.every((x: any) => x.state === 'open'));
  assert.equal(open.body.counts.all, 30, 'the counts are the whole list');
  const untied = await request(db, '/risks?project=1&feature=untied&state=closed');
  assert.equal(untied.body.total, 0);
  const tied = await request(db, '/risks?project=1&feature=tied');
  assert.deepEqual(tied.body.rows.map((x: any) => x.id), [2, 4]);
  for (const bad of ['state=done', 'feature=some', 'page=0', 'page=x']) {
    const r = await request(db, `/risks?project=1&${bad}`);
    assert.equal(r.status, 400, bad);
    assert.ok(r.body.error && r.body.detail, `${bad}: a code and a sentence`);
  }
});

test('3. a writer gets the Add choices and a reader none; another venture never appears; a stranger is refused', async () => {
  // Mutation checked: choices sent to readers; the members read not scoped to the company → the other venture's founder;
  // the features read not scoped to the venture; the gate dropped → a stranger gets the list.
  const db = fixture();
  const writer = await request(db, '/risks?project=1');
  assert.equal(writer.body.can_write, true);
  assert.deepEqual(writer.body.choices, {
    owners: [{ value: String(MEMBER), label: 'Synthetic Member' }, { value: String(WRITER), label: 'Synthetic Owner' }],
    features: [{ value: '7', label: 'Synthetic import' }, { value: '8', label: 'Synthetic wizard' }],
  });
  const reader = await request(db, '/risks?project=1', 'GET', READER);
  assert.equal(reader.status, 200);
  assert.equal(reader.body.can_write, false);
  assert.equal(reader.body.choices, undefined, 'a reader is sent no member list');
  assert.deepEqual(reader.body.rows.map((x: any) => x.id), [2, 3, 4, 1]);
  assert.ok(!JSON.stringify(writer.body).includes('Other venture'), 'another venture’s risk or feature is never listed');
  const stranger = await request(db, '/risks?project=1', 'GET', OTHER);
  assert.equal(stranger.status, 403);
  assert.equal((await request(db, '/risks?project=99')).status, 404);
});

test('4. a feature-less risk is the venture’s own record, and the list’s Edit closes it; another venture’s stays a 404', async () => {
  // Mutation checked: ownedRow's feature join left inner → risk 1 is not the venture's; the project check dropped → risk 9 is.
  const db = fixture();
  const env = envFor(db);
  assert.equal(await ownedRow(env, 'venture_risks', '1', 1), true, 'a risk with no feature');
  assert.equal(await ownedRow(env, 'venture_risks', '2', 1), true, 'a risk on the venture’s feature');
  assert.equal(await ownedRow(env, 'venture_risks', '9', 1), false, 'another venture’s risk');
  db.exec('UPDATE venture_risks SET feature_id = 9 WHERE id = 4');
  assert.equal(await ownedRow(env, 'venture_risks', '4', 1), false, 'a risk naming another venture’s feature is not this venture’s');
  const closed = await request(db, '/risks/1?project=1', 'PATCH', WRITER, { title: 'Synthetic low risk', severity: 'low', state: 'closed', mitigation: null });
  assert.equal(closed.status, 200);
  assert.equal((db.prepare('SELECT state FROM venture_risks WHERE id = 1').get() as any).state, 'closed');
  assert.equal((await request(db, '/risks/9?project=1', 'PATCH', WRITER, { state: 'closed' })).status, 404);
  assert.equal((await request(db, '/risks/1?project=1', 'PATCH', READER, { state: 'open' })).status, 403);
});

test('5. the module read is what it was: one statement reads the risks, for their counts', async () => {
  // Mutation checked: a risks list put back in the module read → a second venture_risks statement there.
  const db = fixture();
  const risky = () => seen.filter((sql) => /venture_risks/.test(sql));
  seen = [];
  const before = await request(db, '/modules/solution-design?project=1');
  const moduleRisks = risky();
  seen = [];
  await request(db, '/risks?project=1');
  const listRisks = risky();
  assert.equal(before.status, 200);
  assert.equal(before.body.facts?.risks, undefined, 'the module read sends no risk list (#4603 part 2)');
  assert.deepEqual(before.body.card.series.find((s: any) => s.rows?.[0]?.label === 'Risks').rows[0].parts, [2, 1, 1]);
  assert.ok(!JSON.stringify(before.body).includes('Synthetic plan risk'), 'no risk title in the module read');
  assert.equal(moduleRisks.length, 1, 'the module reads risks once, grouped by severity');
  assert.match(moduleRisks[0], /GROUP BY severity/);
  assert.equal(listRisks.length, 3, 'the list reads them in its own request: counts, total, page');
});
