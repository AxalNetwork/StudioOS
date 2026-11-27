/**
 * D6023 (#6023) — a feature's risks on its Solution design record: each row
 * shows owner, state and mitigation beside the severity, and a writer can edit,
 * close and reopen a risk through PATCH /risks/:id's own `patchRisk`.
 *
 *   1. the Risks rows, Not recorded for an empty owner or mitigation, and the
 *      actions a writer gets (Close offers live risks, Reopen closed ones);
 *      a reader gets the rows with no action and cannot run one;
 *   2. Edit changes only what it is sent, refuses an empty edit, and logs on the feature;
 *   3. Close and Reopen move the state, log on the feature and leave the
 *      module chart's risk counts as they were;
 *   4. another feature's or another venture's risk is a 404 that writes nothing.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_risk_actions_6023.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import records from '../src/routes/cycle_records.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const SECRET = '6023-local-test-secret-0123456789-abcdef';
const WRITER = 10, READER = 11, OTHER = 12;
const app = new Hono<any>();
app.route('/api/cycles', records);
app.route('/api/cycles/build', build);
app.onError((error, c) => c.json({ detail: error.message }, 500));

/** Feature 7 has risks 1 (owned, open) and 2 (closed, with a mitigation); feature 8 has risk 3; venture 2's feature 9 has risk 4. */
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,is_active) VALUES
    (${WRITER},'owner@example.test','Synthetic Owner','founder',1001,1), (${READER},'reader@example.test','Synthetic Reader','partner',NULL,1),
    (${OTHER},'other@example.test','Synthetic Other','founder',1002,1);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES (1,'Example',1001,5),(2,'Other',1002,6);
    INSERT INTO user_company_links(uid,user_id,company_id) VALUES ('owner',${WRITER},5);
    INSERT INTO mvp_features(id,project_id,title) VALUES (7,1,'Synthetic feature'),(8,1,'Synthetic sibling'),(9,2,'Other venture feature');
    INSERT INTO venture_risks(id,project_id,title,severity,owner_user_id,mitigation,state,feature_id,created_by) VALUES
      (1,1,'Synthetic rate limits','high',${WRITER},NULL,'open',7,${WRITER}),
      (2,1,'Synthetic vendor lock-in','low',NULL,'Keep an export path','closed',7,${WRITER}),
      (3,1,'Synthetic sibling risk','medium',NULL,NULL,'open',8,${WRITER}),
      (4,2,'Other venture risk','medium',NULL,NULL,'open',9,${OTHER});`);
  return db;
}
const envFor = (db: DatabaseSync) => ({ DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' }) as any;
async function request(db: DatabaseSync, path: string, method = 'GET', user = WRITER, body?: unknown) {
  const token = await new SignJWT({ user_id: user, role: user === READER ? 'partner' : 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(1).setExpirationTime(4102444800).sign(new TextEncoder().encode(SECRET));
  const response = await withThrownResponses(() => app.request('/api/cycles/build' + path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  }, envFor(db)));
  return { status: response.status, body: await response.json() as any };
}
const record = (id = 7, project = 1) => `/modules/solution-design/records/${id}?project=${project}`;
const act = (db: DatabaseSync, key: string, body: unknown, user = WRITER, id = 7, project = 1) =>
  request(db, `/modules/solution-design/records/${id}/actions/${key}?project=${project}`, 'POST', user, body);
const risksOf = (body: any) => body.main.find((s: any) => s.key === 'risks').rows;
const risk = (db: DatabaseSync, id: number) => ({ ...db.prepare('SELECT title, severity, mitigation, state FROM venture_risks WHERE id = ?').get(id) as any });
const logs = (db: DatabaseSync) => (db.prepare('SELECT entity_type, entity_id, action, details FROM activity_logs ORDER BY id').all() as any[]).map(r => ({ ...r }));
async function riskChart(db: DatabaseSync) {
  const r = await request(db, '/modules/solution-design?project=1');
  assert.equal(r.status, 200);
  return r.body.card.series.find((s: any) => s.rows?.[0]?.label === 'Risks')?.rows[0].parts;
}

test('1. each risk shows severity, owner, state and mitigation; a writer gets Edit, Close and Reopen, a reader none', async () => {
  // Mutation checked: owner read as 'No owner' again; the state or the mitigation dropped from the read;
  // Close or Reopen offering every risk; a single choice not chosen; the row's body naming no risk;
  // row actions left on for readers (cycle_records.ts).
  const db = fixture();
  try {
    const writer = await request(db, record());
    assert.equal(writer.status, 200);
    assert.deepEqual(risksOf(writer.body), [
      { a: 'Synthetic rate limits', b: 'Owner: Synthetic Owner · State: Open · Mitigation: Not recorded', c: 'High', tone: 'bad',
        action: { key: 'edit-risk', body: { risk_id: 1 } } },
      { a: 'Synthetic vendor lock-in', b: 'Owner: Not recorded · State: Closed · Mitigation: Keep an export path', c: 'Low', tone: 'grey',
        action: { key: 'edit-risk', body: { risk_id: 2 } } },
    ]);
    const declared = (key: string) => writer.body.actions.find((a: any) => a.key === key);
    assert.deepEqual(['edit-risk', 'close-risk', 'reopen-risk'].map(k => declared(k)?.label), ['Edit a risk', 'Close a risk', 'Reopen a risk']);
    const options = (key: string) => declared(key).form.fields.find((f: any) => f.key === 'risk_id');
    assert.deepEqual(options('edit-risk').options.map((o: any) => o.value), ['1', '2']);
    assert.deepEqual([options('close-risk').options.map((o: any) => o.value), options('close-risk').value], [['1'], '1'], 'Close offers the open risk, chosen');
    assert.deepEqual([options('reopen-risk').options.map((o: any) => o.value), options('reopen-risk').value], [['2'], '2'], 'Reopen offers the closed risk, chosen');
    assert.notEqual(writer.body.next?.action, 'edit-risk', 'a risk row is not the record\'s next step');

    const reader = await request(db, record(), 'GET', READER);
    assert.equal(reader.status, 200);
    assert.deepEqual(reader.body.actions, []);
    assert.deepEqual(risksOf(reader.body).map((r: any) => [r.b, Object.hasOwn(r, 'action')]), [
      ['Owner: Synthetic Owner · State: Open · Mitigation: Not recorded', false], ['Owner: Not recorded · State: Closed · Mitigation: Keep an export path', false]]);
    for (const [key, body] of [['edit-risk', { risk_id: 1, title: 'Taken over' }], ['close-risk', { risk_id: 1 }], ['reopen-risk', { risk_id: 2 }]] as const) {
      assert.equal((await act(db, key, body, READER)).status, 403, key);
    }
    assert.deepEqual([risk(db, 1).title, risk(db, 1).state, risk(db, 2).state], ['Synthetic rate limits', 'open', 'closed']);
    assert.deepEqual(logs(db), []);
  } finally { db.close(); }
});

test('2. Edit a risk changes what it is sent through patchRisk, keeps a blank field, and logs on the feature', async () => {
  // Mutation checked: mitigation made clearable (a blank wipes it); the empty-edit refusal removed;
  // the edit written to a fixed risk id; the log's entity the project, not the feature (patchRisk).
  const db = fixture();
  try {
    let r = await act(db, 'edit-risk', { risk_id: '2', title: 'Synthetic vendor exit', severity: 'medium', mitigation: '' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(risk(db, 2), { title: 'Synthetic vendor exit', severity: 'medium', mitigation: 'Keep an export path', state: 'closed' }, 'a blank mitigation keeps the stored one');
    r = await act(db, 'edit-risk', { risk_id: 1, title: '', severity: '', mitigation: 'Cache the bank responses' });
    assert.equal(r.status, 200);
    assert.deepEqual(risk(db, 1), { title: 'Synthetic rate limits', severity: 'high', mitigation: 'Cache the bank responses', state: 'open' });
    const before = logs(db).length;
    r = await act(db, 'edit-risk', { risk_id: 1, title: '', severity: '', mitigation: '' });
    assert.deepEqual([r.status, r.body.detail], [400, 'Change the risk, its severity or its mitigation']);
    assert.equal((await act(db, 'edit-risk', { title: 'No risk named' })).status, 400);
    assert.equal((await act(db, 'edit-risk', { risk_id: 1, severity: 'critical' })).status, 400, 'patchRisk refuses as the route does');
    assert.equal(logs(db).length, before, 'a refused edit logs nothing');
    assert.deepEqual(logs(db), [
      { entity_type: 'build.solution-design', entity_id: '7', action: 'build_risk_changed', details: 'Risk changed: medium severity, closed' },
      { entity_type: 'build.solution-design', entity_id: '7', action: 'build_risk_changed', details: 'Risk changed: high severity, open' },
    ]);
    const activity = await request(db, '/modules/solution-design/records/7/activity?project=1');
    assert.equal(activity.status, 200);
    assert.deepEqual(activity.body.items.filter((i: any) => i.action === 'build_risk_changed').map((i: any) => i.a), [
      'Risk changed: high severity, open by Synthetic Owner', 'Risk changed: medium severity, closed by Synthetic Owner'], 'both changes are on the feature\'s activity');
  } finally { db.close(); }
});

test('3. Close and Reopen move the state, log on the feature, and leave the module chart\'s risk counts alone', async () => {
  // Mutation checked: Close writing 'mitigating'; Reopen writing 'closed'; either 409 removed;
  // the module chart counting only risks not closed (cycle_build.ts).
  const db = fixture();
  try {
    const chart = await riskChart(db);
    assert.deepEqual(chart, [1, 1, 1], 'high, medium, low across the venture');
    assert.equal((await act(db, 'close-risk', { risk_id: '1' })).status, 200);
    assert.equal(risk(db, 1).state, 'closed');
    assert.deepEqual(await riskChart(db), chart, 'a closed risk stays in the counts');
    const read = await request(db, record());
    assert.equal(read.body.actions.find((a: any) => a.key === 'close-risk'), undefined, 'nothing is left to close');
    assert.deepEqual(read.body.actions.find((a: any) => a.key === 'reopen-risk').form.fields[0].options.map((o: any) => o.value), ['1', '2']);
    const again = await act(db, 'reopen-risk', { risk_id: 1 });
    assert.equal(again.status, 200);
    assert.equal(risk(db, 1).state, 'open');
    assert.deepEqual((await act(db, 'close-risk', { risk_id: 2 })), { status: 409, body: { detail: 'That risk is already closed' } });
    assert.deepEqual((await act(db, 'reopen-risk', { risk_id: 1 })), { status: 409, body: { detail: 'That risk is not closed' } });
    assert.deepEqual(await riskChart(db), chart);
    assert.deepEqual(logs(db).map(l => [l.entity_id, l.action, l.details]), [
      ['7', 'build_risk_changed', 'Risk changed: high severity, closed'], ['7', 'build_risk_changed', 'Risk changed: high severity, open']]);
  } finally { db.close(); }
});

test('4. another feature\'s or another venture\'s risk is a 404 that writes nothing', async () => {
  // Mutation checked: riskWrite without its feature_id filter (risk 3 is then written).
  const db = fixture();
  try {
    for (const [key, id] of [['edit-risk', 3], ['close-risk', 3], ['edit-risk', 4], ['close-risk', 4]] as const) {
      const r = await act(db, key, { risk_id: id, title: 'Taken over' });
      assert.equal(r.status, 404, `${key} ${id}: ${JSON.stringify(r.body)}`);
    }
    assert.equal((await act(db, 'close-risk', { risk_id: 4 }, OTHER)).status, 403, 'another venture\'s founder cannot reach this record');
    assert.deepEqual([risk(db, 3), risk(db, 4)].map(r => [r.title, r.state]), [['Synthetic sibling risk', 'open'], ['Other venture risk', 'open']]);
    assert.deepEqual(logs(db), []);
    // The route itself still answers as it did before the move.
    const patched = await request(db, '/risks/3?project=1', 'PATCH', WRITER, { state: 'mitigating' });
    assert.deepEqual([patched.status, risk(db, 3).state], [200, 'mitigating']);
  } finally { db.close(); }
});
