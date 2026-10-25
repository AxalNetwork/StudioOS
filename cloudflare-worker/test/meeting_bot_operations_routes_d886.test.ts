import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import platform from '../src/routes/admin_platform.ts';
import { readMeetingBotOperations } from '../src/services/meetingBotOperationsRead.ts';
import { recordMeetingBotAlert } from '../src/services/meetingBotOperationsAlerts.ts';

const SECRET = 'synthetic-meeting-bot-test-secret-0123456789';
const baseline = readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
function world() {
  const fixture = makeD1(['users','super_admins','notifications','notifications_inbox'].map(t => tableFromBaseline(baseline,t)).join('\n'));
  fixture.db.exec('PRAGMA foreign_keys=OFF');
  const start = baseline.indexOf('CREATE UNIQUE INDEX uq_notifications_dedupe');
  const index = baseline.slice(start,baseline.indexOf(';',start)+1);
  assert.ok(index); fixture.db.exec(index);
  for (const [id,role,active] of [[1,'admin',1],[2,'admin',1],[3,'admin',0],[4,'founder',1]]) {
    fixture.db.prepare('INSERT INTO users(id,name,email,role,is_active) VALUES(?,?,?,?,?)').run(id,'Synthetic',`synthetic${id}@example.test`,role,active);
  }
  for (const id of [1,3,4]) fixture.db.prepare('INSERT INTO super_admins(user_id) VALUES(?)').run(id);
  return { ...fixture, env: { DB: fixture.DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
async function request(env: any, actor: number | null, path='/meeting-bots', method='GET', body?: object) {
  const headers = new Headers({ 'content-type':'application/json' });
  if (actor !== null) headers.set('authorization','Bearer '+await new SignJWT({ user_id: actor, role: actor === 4 ? 'founder' : 'admin' })
    .setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET)));
  return platform.fetch(new Request('https://example.test'+path,{method,headers,body: body ? JSON.stringify(body) : undefined}),env);
}
const alert = {kind:'missed_heartbeat' as const,platform:'teams' as const,runs:1};

test('D886 HQ reads deny unauthenticated, plain admin, member, inactive and branch elevation',async () => {
  const {db,env} = world();
  try {
    for (const actor of [null,2,3,4]) assert.notEqual((await request(env,actor)).status,200);
    assert.notEqual((await request({...env,BRANCH_CODE:'fr'},1)).status,200);
    const response = await request(env,1); assert.equal(response.status,200);
    const result: any = await response.json();
    assert.equal(result.operations.state,'not_recorded');
    assert.equal(result.pricing.state,'ceiling');
    assert.equal(result.pricing.bot_per_minute_microusd,2790);
    assert.equal(JSON.stringify(result).includes('synthetic1'),false);
    for (const actor of [null,1,2,4]) assert.notEqual((await request(env,actor,'/meeting-bots/test','POST',{session_id:1,meeting_url:'https://example.test'})).status,200);
    for (const actor of [null,2,3,4]) assert.notEqual((await request(env,actor,'/meeting-bots/test/00000000-0000-0000-0000-000000000001')).status,200);
  } finally {db.close();}
});

test('D886 absent and failed stores stay distinct; no schema is created on reads',async () => {
  const {db,env} = world();
  try {
    assert.equal((await readMeetingBotOperations(env)).state,'not_recorded');
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='meeting_bots'").get(),undefined);
    const broken = {...env,DB:{prepare(){throw new Error('SYNTHETIC_PRIVATE_MARKER');}}};
    const result = await readMeetingBotOperations(broken);
    assert.equal(result.state,'unreadable');
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_MARKER'),false);
  } finally {db.close();}
});

async function receipts(publish = recordMeetingBotAlert) {
  const {db,env} = world();
  try {
    await Promise.all([publish(env,alert,'synthetic-episode'),publish(env,alert,'synthetic-episode')]);
    assert.equal(await publish(env,alert,'synthetic-episode'),0);
    assert.deepEqual(db.prepare('SELECT user_id,type,category FROM notifications_inbox').all().map(r=>({...r})),[{user_id:1,type:'meeting_bot_operations',category:'operations'}]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get()!.n,1);
    assert.equal(await publish(env,alert,'second-episode'),1);
    assert.equal(await publish({...env,BRANCH_CODE:'fr'},alert,'branch'),0);
    db.prepare('UPDATE users SET notification_prefs=? WHERE id=1').run(JSON.stringify({meeting_bot_operations:{in_app:false}}));
    assert.equal(await publish(env,alert,'opted-out'),0);
    const inbox = JSON.stringify(db.prepare('SELECT title,body,payload,link FROM notifications_inbox').all());
    assert.equal(inbox.includes('synthetic'),false); assert.equal(inbox.includes('heartbeat'),true);
  } finally {db.close();}
}
test('D886 alert retries/concurrent sweeps elect one inbox item per eligible recipient and episode',()=>receipts());

async function rollback(publish = recordMeetingBotAlert) {
  const {db,env} = world();
  try {
    // A SQLite fixture failure, not a production migration or hand-made trigger.
    db.exec('ALTER TABLE notifications_inbox RENAME TO unavailable_inbox');
    await assert.rejects(()=>publish(env,alert,'retryable'));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get()!.n,0);
    db.exec('ALTER TABLE unavailable_inbox RENAME TO notifications_inbox');
    assert.equal(await publish(env,alert,'retryable'),1);
  } finally {db.close();}
}
test('D886 failed inbox insert rolls back receipt and permits a later retry',()=>rollback());

let mutation = 0;
async function changedAlert(before: string, after: string) {
  const path = new URL('../src/services/meetingBotOperationsAlerts.ts',import.meta.url);
  const source = readFileSync(path,'utf8'); assert.ok(source.includes(before));
  const replaced = source.replace(before,()=>after);
  const executable = before === 'await env.DB.batch([' ? replaced.replace('    ]);', '    ].map(statement => statement.run()));') : replaced;
  const changed = stripTypeScriptTypes(executable,{mode:'strip'})
    .replace(/(from\s*['"])(\.[^'"]+)(['"])/g,(_m,p,s,q)=>p+new URL(s+'.ts',path).href+q);
  return import('data:text/javascript;base64,'+Buffer.from(changed+'\n// mutation '+ ++mutation).toString('base64'));
}
for (const [name,before,after,scenario] of [
  ['branch sends HQ inbox', 'if (branchOf(env)) return 0;', '', receipts],
  ['ordinary admin gets inbox', 'JOIN users u ON u.id=s.user_id', 'JOIN users u ON 1=1', receipts],
  ['inactive admin gets inbox', "u.is_active=1 AND u.role='admin'", "u.role='admin'", receipts],
  ['opt-out ignored', 'if (enabled !== undefined && enabled !== true) continue;', '', receipts],
  ['duplicate sweep writes inbox', 'AND dedupe_key=? AND meta=?', 'AND dedupe_key=? AND (? IS NOT NULL)', receipts],
  ['receipt survives inbox failure', 'await env.DB.batch([', 'await Promise.all([', rollback],
] as const) test('D886 inbox mutation: '+name,async()=>{
  await scenario();
  const changed=await changedAlert(before,after);
  // Promise.all variant runs the same statements individually below.
  await assert.rejects(()=>scenario(changed.recordMeetingBotAlert));
  await scenario();
});
