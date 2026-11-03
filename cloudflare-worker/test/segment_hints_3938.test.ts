/**
 * #3938 part 7 (D1478 task 4) — VA12's retrieve step: the New segment fill
 * embeds the venture's interviewees and segments, and the writer reads who sits
 * near which segment, and who is near nobody, as a hint.
 *
 *   1. The plan's row: VA12 retrieves with bge-m3 before its writer.
 *   2. `segmentHints`: near a segment when close enough; the rest grouped by
 *      meaning; a segment that cannot be embedded places nobody; an interviewee
 *      who cannot be embedded, or whose vector is the wrong size, is left out;
 *      fewer than two interviewees, no hint. Never a name.
 *   3. The press: the hint reaches the writer after the facts, on the form's
 *      rail; a refusal at the retrieve step stops the press before the writer;
 *      another form, or a venture with one interviewee, embeds nothing.
 * Synthetic records only; the models are stubs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/segment_hints_3938.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { railRunRoutes } from '../src/routes/rail_run.ts';
import { HINT_DEPS, HintRefused, retrieveModel, type ThemeHintDeps } from '../src/services/ai/themeHints.ts';
import { NEAR_SEGMENT, SEGMENT_JOB, label, segmentHints, segmentSection, type Interviewee } from '../src/services/ai/segmentHints.ts';
import { jobStep } from '../src/services/ai/modelUseCases.ts';

const SECRET = 'synthetic-segment-hints-3938-'.repeat(3);
test.after(() => removeMigratedDatabases());
const ICP = 'Founder · Validate · Ideal customer profile';
const PROBLEM = 'Founder · Validate · Problem discovery';

// Two meanings: field crews (x) and finance (y). A text's vector says which it is near.
const vec = (t: string): number[] => /site|crew|foreman|inspection/i.test(t) ? [1, 0.05] : /financ|cfo|invoice|account/i.test(t) ? [0.05, 1] : [0.6, 0.6];
const deps = (map: (t: string) => number[] | null = vec, seen: string[] = []): ThemeHintDeps => ({ embed: async (t) => { seen.push(t); return map(t); } });
const person = (id: number, role: string, company: string, pains: string[] = []): Interviewee => ({ id, role, company, fit: null, pains });

test('1. VA12 retrieves with bge-m3 before its writer', () => {
  assert.equal(SEGMENT_JOB, 'VA12');
  assert.equal(jobStep('VA12', 0)?.kind, 'retrieve');
  assert.equal(jobStep('VA12', 1)?.kind, 'synth');
  assert.equal(retrieveModel('VA12'), '@cf/baai/bge-m3');
});

test('2. near a segment when close enough; the rest grouped by meaning; never a name', async () => {
  const seen: string[] = [];
  const people = [
    { ...person(1, 'Site foreman', 'Acme Build', ['Inspections run late']), name: 'Dana Secret' } as Interviewee,
    person(2, 'Crew lead', 'Beta Works'),
    person(3, 'CFO', 'Gamma Ltd', ['Invoices take a week']),
    person(4, 'Finance manager', 'Delta Co'),
  ];
  const h = await segmentHints(people, [{ name: 'Site managers', who: 'People who run crews on site' }], deps(vec, seen));
  assert.deepEqual(h!.bySegment, [{ segment: 'Site managers', people: ['Interview 1 (Site foreman, Acme Build)', 'Interview 2 (Crew lead, Beta Works)'] }]);
  assert.deepEqual(h!.groups, [['Interview 3 (CFO, Gamma Ltd)', 'Interview 4 (Finance manager, Delta Co)']], 'the two finance people group together, near no segment');
  assert.ok(!seen.join(' ').includes('Dana Secret'), 'a name is never embedded');
  const text = segmentSection(h);
  assert.match(text, /^Interviewees by meaning \(a hint from the retrieval step, not an answer/);
  assert.match(text, /Near "Site managers": Interview 1 \(Site foreman, Acme Build\); Interview 2/);
  assert.match(text, /Not near any segment, group 1: Interview 3 \(CFO, Gamma Ltd\); Interview 4/);
  assert.ok(!text.includes('Dana'), 'nor shown');
  assert.equal(label(person(9, '', '')), 'Interview 9');
  assert.ok(NEAR_SEGMENT > 0 && NEAR_SEGMENT < 1);
});

test('2b. a segment that cannot be embedded places nobody; a bad interviewee is left out; fewer than two, no hint', async () => {
  const people = [person(1, 'Site foreman', 'A'), person(2, 'Crew lead', 'B'), person(3, 'CFO', 'C')];
  const noSeg = await segmentHints(people, [{ name: 'Site managers', who: null }, { name: 'Broken', who: null }],
    deps((t) => (/Broken/.test(t) ? null : vec(t))));
  assert.deepEqual(noSeg!.bySegment, [], 'a partial segment list places nobody');
  assert.deepEqual(noSeg!.groups, [['Interview 1 (Site foreman, A)', 'Interview 2 (Crew lead, B)'], ['Interview 3 (CFO, C)']]);
  const wrong = await segmentHints([...people, person(4, 'Inspector', 'D')], [{ name: 'Site managers', who: null }],
    deps((t) => (/Inspector/.test(t) ? [1, 0, 0] : vec(t))));
  assert.ok(!JSON.stringify(wrong).includes('Interview 4'), 'a wrong-size vector is left out, never placed');
  assert.equal(await segmentHints([person(1, 'Site foreman', 'A')], [], deps()), null, 'one interviewee: no hint');
  assert.equal(await segmentHints(people, [], deps((t) => (/CFO|Crew/.test(t) ? null : vec(t)))), null, 'one embedded: no hint');
  assert.equal(segmentSection(null), '');
});

function fixture(opts: { interviews?: Array<[number, string, string, string]> } = {}) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES (11,'Owner','owner@example.test','founder',101,1);
    INSERT INTO projects(id,uid,name,founder_id) VALUES (701,'v-acme','Acme Field',101);
    INSERT INTO customer_segments(id,project_id,name,name_norm,source,who_they_are) VALUES (71,701,'Site managers','site managers','manual','People who run crews on site');
  `);
  for (const [id, role, company, pains] of opts.interviews ?? []) {
    db.prepare("INSERT INTO discovery_interviews(id,project_id,interviewee_name,interviewee_role,interviewee_company,pains_json) VALUES (?,?,?,?,?,?)")
      .run(id, 701, `Private Name ${id}`, role, company, pains);
  }
  const seen: { messages: any[]; rail: any }[] = [];
  const run = async (_env: any, input: any) => { seen.push({ messages: input.messages, rail: input.rail }); return { ok: true, output: JSON.stringify({ fields: [] }), usageLogId: null, usage: { model: 'm' }, guard: { input: 'pass', output: 'pass', codes: [], calls: 2 } }; };
  const quote = async () => ({ ok: true, hold_microusd: 1200, model: 'm' }) as any;
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/ai/rail', railRunRoutes({ run, quote }));
  const press = async (page: string, form: string) => {
    const jwt = await new SignJWT({ user_id: 11, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const r = await app.request('/api/ai/rail/run', { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ page, option: `form:${form}`, project: 701 }) }, env);
    const text = await r.text();
    const events = text.trim().split('\n\n').filter(Boolean).map((b) => ({ event: /^event: (.+)$/m.exec(b)?.[1], data: JSON.parse(/^data: (.+)$/m.exec(b)?.[1] || 'null') }));
    return { status: r.status, events, done: events.find((e) => e.event === 'done')?.data };
  };
  return { db, seen, press };
}

const INTERVIEWS: Array<[number, string, string, string]> = [
  [1, 'Site foreman', 'Acme Build', '["Inspections run late"]'],
  [2, 'Crew lead', 'Beta Works', '[{"pain":"Crews wait for sign-off"}]'],
  [3, 'CFO', 'Gamma Ltd', '[]'],
  [4, 'Finance manager', 'Delta Co', 'not json'],
];

test('3. the press: the writer reads the hint after the facts; embeddings go on the form\'s rail', async () => {
  const f = fixture({ interviews: INTERVIEWS });
  const charged: any[] = [];
  const made = HINT_DEPS.make;
  HINT_DEPS.make = (_env, charge, job) => { charged.push({ charge, job }); return deps(); };
  try {
    const r = await f.press(ICP, 'segment');
    assert.equal(r.status, 200);
    assert.equal(f.seen.length, 1, 'the writer ran once');
    const user = f.seen[0].messages.find((m: any) => m.role === 'user').content as string;
    assert.match(user, /Interviewees by meaning \(a hint from the retrieval step, not an answer/);
    assert.match(user, /Near "Site managers": Interview 2 \(Crew lead, Beta Works\); Interview 1 \(Site foreman, Acme Build\)/);
    assert.match(user, /Not near any segment, group 1: Interview 4 \(Finance manager, Delta Co\); Interview 3 \(CFO, Gamma Ltd\)/);
    assert.ok(!user.includes('Private Name'), 'no interviewee name reaches the writer');
    assert.equal(charged.length, 1);
    assert.equal(charged[0].job, 'VA12');
    assert.deepEqual([charged[0].charge.userId, charged[0].charge.rail.page, charged[0].charge.rail.option], [11, ICP, 'form:segment']);
  } finally { HINT_DEPS.make = made; }
});

test('3b. a refusal at the retrieve step stops the press; another form or one interviewee embeds nothing', async () => {
  const made = HINT_DEPS.make;
  try {
    HINT_DEPS.make = () => ({ embed: async () => { throw new HintRefused({ ok: false, refusal: 'assist_off', error: 'Assist is off.' } as any); } });
    const f = fixture({ interviews: INTERVIEWS });
    const r = await f.press(ICP, 'segment');
    assert.equal(f.seen.length, 0, 'the writer never ran');
    assert.ok(r.done?.refusal, 'the press answers the refusal');
    assert.deepEqual(r.done.proposals, []);
    assert.ok(!r.events.some((e) => e.event === 'meta'), 'nothing was held');
    let calls = 0;
    HINT_DEPS.make = () => { calls += 1; return deps(); };
    const other = fixture({ interviews: INTERVIEWS });
    await other.press(PROBLEM, 'theme');
    assert.equal(calls, 0, 'another form embeds nothing');
    const one = fixture({ interviews: INTERVIEWS.slice(0, 1) });
    await one.press(ICP, 'segment');
    assert.ok(!(one.seen[0].messages.find((m: any) => m.role === 'user').content as string).includes('Interviewees by meaning'), 'one interviewee: no hint');
  } finally { HINT_DEPS.make = made; }
});
