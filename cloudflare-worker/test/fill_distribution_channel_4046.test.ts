/**
 * #4046 (S1, 2026-11-04) — Ask on Grow › Distribution's channel: its name
 * (`growth_channels.name`), composition only, keyed by the channel's uid like
 * feedback. The kind and state are the founder's choice; the spend and the bar
 * are money, and none of them is offered. On the migrated schema, synthetic
 * rows only; the model is stubbed.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fill_distribution_channel_4046.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import fills, { ROW_KEYS, ROW_READS, venturedRowId } from '../src/routes/fills.ts';
import { ROW_REQUIRED, railRunRoutes } from '../src/routes/rail_run.ts';
import { FILL_FIELDS, fieldsOf, fillFieldProblems, offeredToEadwyn } from '../src/services/fills/fields.ts';
import { EXISTING_READS } from '../src/services/fills/formRun.ts';
import { UNDO_WRITES } from '../src/services/fills/keep.ts';
import { FILL_FIELDS as SPA_FIELDS } from '../../frontend/src/lib/fillFields.js';
import { KEYED_FILL_TABLES } from '../../frontend/src/lib/fillForms.js';

const JWT_SECRET = 'synthetic-distribution-4046-only-not-a-real-credential'.repeat(2);
test.after(() => removeMigratedDatabases());

const PAGE = 'Founder · Grow · Distribution';
const CH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const THEIRS = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';

type Run = (env: any, input: any) => Promise<any>;
const seen: string[] = [];
const answer = (output: unknown): Run => async (_env, input) => {
  seen.push(JSON.stringify(input?.messages ?? input));
  return { ok: true, output: JSON.stringify(output), usageLogId: null, usage: { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }, guard: { input: 'pass', output: 'pass', codes: [], calls: 2 } };
};
const freeQuote = async () => ({ ok: true, hold_microusd: 1200, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }) as any;

function fixture(run: Run = answer({ fields: [] })) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test'),(202,'Two','two@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES (11,'Owner','owner@example.test','founder',101,1),(22,'Other','other@example.test','founder',202,1);
    INSERT INTO projects(id,uid,name,founder_id) VALUES (701,'v-acme','Acme Field',101),(702,'v-theirs','Theirs',202);
    INSERT INTO growth_channels(id,uid,project_id,name,utm_source,state,kind,cac_bar_cents) VALUES
      (31,'${CH}',701,'Founder-led LinkedIn','founder-led-linkedin','active','content',43210),
      (32,'${THEIRS}',702,'Their webinar','their-webinar','active','events',NULL),
      (33,'c0ffee00c0ffee00c0ffee00c0ffee00',701,'Partner referrals','partner-referrals','testing','referral',NULL);
  `);
  const env: any = { JWT_SECRET: JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/ai/rail', railRunRoutes({ run, quote: freeQuote }));
  app.route('/api/fills', fills);
  const call = async (who: number, method: string, path: string, body?: unknown) => {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const r = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await r.text();
    return { status: r.status, type: r.headers.get('content-type') || '', text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const runForm = async (body: Record<string, unknown>) => {
    const r = await call(11, 'POST', '/api/ai/rail/run', { page: PAGE, option: 'form:channel', project: 701, ...body });
    const events = r.type.startsWith('text/event-stream')
      ? r.text.trim().split('\n\n').map((b) => ({ event: /^event: (.+)$/m.exec(b)![1], data: JSON.parse(/^data: (.+)$/m.exec(b)![1]) }))
      : [];
    return { ...r, done: events.find((e) => e.event === 'done')?.data };
  };
  return { db, env, call, runForm };
}

test('the registry: the name alone, both copies; its reads and a required undo; no rows offered', () => {
  // Mutation checked: dropping the ROW_READS, EXISTING_READS or UNDO_WRITES entry, or `required: true`, turns this red.
  assert.deepEqual(fillFieldProblems(), []);
  assert.deepEqual(JSON.parse(JSON.stringify(SPA_FIELDS)), JSON.parse(JSON.stringify(FILL_FIELDS)), 'the two copies agree');
  const fs = fieldsOf(PAGE, 'channel');
  assert.deepEqual(fs.map((f) => [f.field, f.table, f.column, f.class]), [['name', 'growth_channels', 'name', 'composition']], 'kind, state, spend and the bar are never listed');
  assert.ok(offeredToEadwyn(fs[0]));
  const db = migratedDatabase();
  for (const sql of [ROW_READS.growth_channels, EXISTING_READS.growth_channels, UNDO_WRITES['growth_channels.name'].read]) assert.doesNotThrow(() => db.prepare(sql), sql);
  assert.doesNotThrow(() => db.prepare(UNDO_WRITES['growth_channels.name'].write.replace('(SELECT undone_at FROM fill_provenance WHERE id = ?) IS NULL', '1')));
  assert.equal(UNDO_WRITES['growth_channels.name'].required, true, 'a channel is never left without its name');
  assert.doesNotMatch(UNDO_WRITES['growth_channels.name'].write, /utm_source/, 'an undo never rewrites the UTM source its customers are counted by');
  assert.doesNotMatch(EXISTING_READS.growth_channels, /spend|cac|utm/, 'the run reads names, never a spend, a bar or a UTM source');
  assert.ok(!Object.hasOwn(ROW_REQUIRED, 'growth_channels'), 'Add channel offers no "add several rows"');
  assert.deepEqual(Object.keys(ROW_KEYS).sort(), [...KEYED_FILL_TABLES].sort(), 'the keyed tables agree on both sides');
});

test('a channel\'s uid reaches its own venture\'s row only', async () => {
  // Mutation checked: the uid read without `AND project_id = ?` resolves another venture's channel.
  const f = fixture();
  assert.equal(await venturedRowId(f.env, 'growth_channels', CH, 701), 31);
  assert.equal(await venturedRowId(f.env, 'growth_channels', THEIRS, 701), null, 'another venture\'s channel');
  assert.equal(await venturedRowId(f.env, 'growth_channels', `${CH}' OR '1'='1`, 701), null, 'not a key');
  assert.equal(await venturedRowId(f.env, 'growth_channels', '31', 701), 31, 'an id still reads as an id');
});

test('Add channel proposes a name from the venture\'s own channel names, and never a spend, a bar or a kind', async () => {
  // Mutation checked: EXISTING_READS reading `cac_bar_cents` puts 43210 in the prompt.
  seen.length = 0;
  const f = fixture(answer({ fields: [{ field: 'name', value: 'Founder podcast' }, { field: 'spend', value: '$900' }, { field: 'kind', value: 'paid_social' }, { field: 'bar', value: '$200' }] }));
  const add = await f.runForm({});
  assert.equal(add.status, 200, add.text);
  assert.deepEqual(add.done.proposals.map((p: any) => [p.field, p.value]), [['name', 'Founder podcast']], 'only the name is proposed');
  assert.ok(seen.some((m) => m.includes('Partner referrals')), 'the venture\'s own channel names, so a name is not repeated');
  assert.ok(seen.every((m) => !m.includes('Their webinar')), 'never another venture\'s channel');
  assert.ok(seen.every((m) => !m.includes('43210') && !m.includes('founder-led-linkedin')), 'never a bar or a UTM source');
  assert.equal(Number((f.db.prepare("SELECT COUNT(*) AS n FROM growth_channels WHERE name = 'Founder podcast'").get() as any).n), 0, 'the run writes nothing');
});

test('Save keeps the placed name on the channel its Add answered (by uid); an undo to blank is refused', async () => {
  // Mutation checked: ROW_KEYS without growth_channels → the record step answers 404.
  const f = fixture(answer({ fields: [{ field: 'name', value: 'Founder podcast' }] }));
  const add = await f.runForm({});
  // Add channel's own route wrote the row and answered its uid.
  f.db.exec("INSERT INTO growth_channels(id,uid,project_id,name,utm_source,state) VALUES (34,'d00dd00dd00dd00dd00dd00dd00dd00d',701,'Founder podcast','founder-podcast','active')");
  const kept = await f.call(11, 'POST', '/api/fills/record', { page: PAGE, form: 'channel', project: 701, record: 'd00dd00dd00dd00dd00dd00dd00dd00d', proposals: [add.done.proposals[0].uid] });
  assert.equal(kept.status, 200, kept.text);
  assert.equal(kept.body.record, 'growth_channels:34');
  assert.deepEqual(kept.body.outcomes.map((o: any) => o.outcome), ['kept']);
  const prov = f.db.prepare("SELECT target_row_id, target_column FROM fill_provenance WHERE target_table = 'growth_channels'").all() as any[];
  assert.deepEqual(prov.map((p) => [p.target_row_id, p.target_column]), [[34, 'name']]);
  // Another venture's uid is not this venture's record.
  assert.equal((await f.call(11, 'POST', '/api/fills/record', { page: PAGE, form: 'channel', project: 701, record: THEIRS, proposals: [add.done.proposals[0].uid] })).status, 404);
});

test('Edit channel reads the venture\'s own channel by uid; a named channel has nothing to ask', async () => {
  const f = fixture();
  const sheet = await f.call(11, 'GET', `/api/fills/sheet?page=${encodeURIComponent(PAGE)}&form=channel&project=701&record=${CH}`);
  assert.equal(sheet.status, 200, sheet.text);
  assert.equal(sheet.body.record, 'growth_channels:31');
  assert.equal((await f.call(11, 'GET', `/api/fills/sheet?page=${encodeURIComponent(PAGE)}&form=channel&project=701&record=${THEIRS}`)).status, 404);
  assert.equal((await f.runForm({ record: { type: 'growth_channels', id: CH } })).status, 400, 'its one field is filled');
});
