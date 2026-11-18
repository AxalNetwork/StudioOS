/** D6897 (#6897, RA-30): the readiness snapshot shared outside Axal as a link.
 *  Real SQLite with the production schema and migrations; every person, venture and figure is synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import router from '../src/routes/cycle_raise.ts';
import evidenceSharePublic from '../src/routes/evidence_share_public.ts';
import readinessSharePublic from '../src/routes/readiness_share_public.ts';
import { EVIDENCE_SHARE_READ } from '../src/middleware/rateLimit.ts';
import { createReadinessLink, listPackLinks, revokePackLink, readinessBody, coveringLine, NOT_SCORED, TEAM_LINE } from '../src/services/raiseEvidenceShare.ts';

const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); loadSchema(db);
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all().map((r: any) => r.sql); db.close(); return ddl;
})();
const secret = 't'.repeat(64); // in-memory test signing seed only
const KEYS = ['narrative', 'deck', 'data_room', 'cap_table', 'use_of_funds', 'traction', 'team', 'pmf'];

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); for (const sql of DDL) db.exec(sql);
  db.exec(`INSERT INTO users(id,name,email,role,founder_id,is_active,spinout_lab_active,kyc_status) VALUES
   (1,'Synthetic Founder','one@example.invalid','founder',100,1,0,NULL),(3,'Synthetic Admin','three@example.invalid','admin',NULL,1,0,NULL);
   INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES(1,'venture-one','Synthetic Venture',100,10);
   INSERT INTO company_profiles(id,uid,company_name) VALUES(10,'company-one','Synthetic One');
   INSERT INTO user_company_links(uid,user_id,company_id) VALUES('one',1,10),('three',3,10);`);
  KEYS.forEach((k, i) => db.prepare('INSERT INTO readiness_items(id,project_id,item_key,label,position) VALUES(?,?,?,?,?)').run(i + 1, 1, k, k, i));
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' };
  const ctx: any = { env, user: db.prepare('SELECT * FROM users WHERE id=1').get(), projectId: 1, companyId: 10, founder: true };
  const app = new Hono<any>(); app.route('/api/cycles/raise', router); app.route('/api/share/evidence', evidenceSharePublic); app.route('/api/share/readiness', readinessSharePublic);
  return { db, env, ctx, app };
}
type World = ReturnType<typeof world>;
function score(w: World, key: string, value: number, evidence: string, missing: string | null, at: string, source = 'computed') {
  w.db.prepare(`INSERT INTO readiness_scores(item_id,project_id,score,evidence,missing,source,scored_at) VALUES(?,?,?,?,?,?,?)`)
    .run(KEYS.indexOf(key) + 1, 1, value, evidence, missing, source, at);
}
function scored(w: World) {
  score(w, 'narrative', 5, 'pattern', 'A sharper why-now.', '2026-10-01 09:00:00');
  score(w, 'narrative', 7, 'stated', 'One customer story.', '2026-11-02 09:00:00');
  score(w, 'deck', 6, 'pattern', null, '2026-11-03 09:00:00');
  score(w, 'traction', 8, 'stated', 'Bank-connected revenue.', '2026-11-04 09:00:00');
  score(w, 'team', 9, 'anecdote', 'PRIVATE TEAM NOTE', '2026-11-05 09:00:00', 'manual');
  score(w, 'pmf', 4, 'pattern', 'PRIVATE PMF NOTE', '2026-11-06 09:00:00');
}
const tokenOf = (path: string) => path.split('/').pop() as string;
async function call(w: World, who: number, method: string, tail: string, body?: unknown) {
  const auth = { Authorization: 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret)) };
  const r = await w.app.request('/api/cycles/raise' + tail, { method, headers: { 'Content-Type': 'application/json', 'X-Company-Id': '10', ...auth }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, w.env);
  return { status: r.status, body: await r.json() as any };
}
async function open(w: World, token: string, page = 'readiness') {
  const r = await w.app.request(`/api/share/${page}/` + token, { method: 'GET' }, w.env);
  return { status: r.status, cache: r.headers.get('Cache-Control'), body: await r.json() as any };
}

test('the snapshot: seven areas, no PMF row, no overall score; Not scored yet, never 0; Team by a person', async () => {
  const w = world(); try {
    scored(w);
    const { body } = await readinessBody(w.env, 1);
    // Mutation checked: drop the pmf filter → 8 areas.
    assert.deepEqual(body.areas.map((a) => a.key), ['narrative', 'deck', 'data_room', 'cap_table', 'use_of_funds', 'traction', 'team']);
    assert.ok(!('overall' in body) && !JSON.stringify(body).includes('PMF') && !JSON.stringify(body).includes('Product-market'));
    const by = Object.fromEntries(body.areas.map((a) => [a.key, a]));
    assert.deepEqual(by.narrative, { key: 'narrative', label: 'Investor narrative', score: 7, evidence: 'Stated', missing: 'One customer story.', scored_on: '2026-11-02', words: '7 of 10' });
    assert.equal(by.deck.evidence, 'Pattern'); assert.equal(by.deck.missing, null);
    // Mutation checked: score null → 0 makes these fail.
    for (const k of ['data_room', 'cap_table', 'use_of_funds']) {
      assert.equal(by[k].score, null, k); assert.equal(by[k].words, NOT_SCORED); assert.equal(by[k].scored_on, null);
    }
    // Mutation checked: let Team's score through → score 9 and its note leak.
    assert.deepEqual(by.team, { key: 'team', label: 'Team', score: null, evidence: null, missing: null, scored_on: null, words: TEAM_LINE });
    assert.ok(!JSON.stringify(body).includes('PRIVATE'));
  } finally { w.db.close(); }
});

test('making, opening, listing and revoking a snapshot link; pack and snapshot tokens never cross', async () => {
  const w = world(); try {
    scored(w);
    const made = await call(w, 1, 'POST', '/readiness/share-links?project=1', { label: 'Synthetic Fund', covering_line: '  Where we stand   before the partner meeting. ' });
    assert.equal(made.status, 201); assert.equal(made.body.output, 'readiness'); assert.equal(made.body.item_count, 7); assert.equal(made.body.sent, false);
    assert.match(made.body.path, /^\/share\/readiness\/[A-Za-z0-9_-]{40,}$/);
    assert.equal(made.body.covering_line, 'Where we stand before the partner meeting.');
    const token = tokenOf(made.body.path);
    const row: any = w.db.prepare('SELECT * FROM raise_evidence_share_links').get();
    assert.equal(row.output, 'readiness'); assert.equal(row.reader, 'before_nda'); assert.ok(!JSON.stringify(row).includes(token));
    assert.equal((w.db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action='readiness_snapshot_shared'").get() as any).n, 1);

    const seen = await open(w, token);
    assert.equal(seen.status, 200); assert.equal(seen.cache, 'no-store');
    assert.equal(seen.body.snapshot.kind, 'readiness'); assert.equal(seen.body.snapshot.venture, 'Synthetic One');
    assert.equal(seen.body.snapshot.covering_line, 'Where we stand before the partner meeting.');
    assert.equal(seen.body.snapshot.areas.length, 7); assert.ok(!JSON.stringify(seen.body).includes('PRIVATE'));
    // Mutation checked: drop `AND output = ?` in openPackLink → the pack page opens a snapshot token.
    const cross = await open(w, token, 'evidence'); assert.equal(cross.status, 404); assert.equal(cross.body.state, 'not_found');
    assert.equal((w.db.prepare('SELECT view_count FROM raise_evidence_share_links').get() as any).view_count, 1);

    // Frozen: a later score does not change what the link shows, but the founder's list says it changed.
    score(w, 'data_room', 6, 'measured', null, '2026-11-10 09:00:00');
    const again = await open(w, token);
    assert.equal(again.body.snapshot.areas.find((a: any) => a.key === 'data_room').words, NOT_SCORED);
    const list: any = await listPackLinks(w.ctx);
    const mine = list.links.find((l: any) => l.uid === made.body.uid);
    assert.equal(mine.output, 'readiness'); assert.equal(mine.changed_since_sent, true);

    await revokePackLink(w.ctx, made.body.uid);
    const gone = await open(w, token); assert.equal(gone.status, 410); assert.equal(gone.body.state, 'revoked');
    assert.equal((await open(w, 'no-such-token')).status, 404);
    // Not a founder: the admin reaches the route and is refused.
    assert.equal((await call(w, 3, 'POST', '/readiness/share-links?project=1', { label: 'x' })).status, 403);
  } finally { w.db.close(); }
});

test('a snapshot unchanged since sent reads as unchanged', async () => {
  const w = world(); try {
    scored(w);
    const made: any = await createReadinessLink(w.ctx, { label: 'Synthetic Angel' });
    assert.equal(made.covering_line, null);
    const list: any = await listPackLinks(w.ctx);
    assert.equal(list.links.find((l: any) => l.uid === made.uid).changed_since_sent, false);
  } finally { w.db.close(); }
});

test('refusals: not a founder, malformed input, a long or multi-line covering line', async () => {
  const w = world(); try {
    await assert.rejects(createReadinessLink({ ...w.ctx, founder: false }, { label: 'x' }), (e: any) => e.status === 403);
    for (const bad of [{}, { label: '' }, { label: 'x', view_limit: 0 }, { label: 'x', expires_in_days: 9999 }, { label: 'x', reader: 'after_nda' },
      { label: 'x', covering_line: 'x'.repeat(201) }, { label: 'x', covering_line: 'one\ntwo' }, { label: 'x', covering_line: 5 }]) {
      await assert.rejects(createReadinessLink(w.ctx, bad as any), (e: any) => e.code === 'invalid' && e.status === 400, JSON.stringify(bad));
    }
    assert.equal(coveringLine(''), null); assert.equal(coveringLine('x'.repeat(200)), 'x'.repeat(200));
    assert.equal((w.db.prepare('SELECT COUNT(*) n FROM raise_evidence_share_links').get() as any).n, 0);
  } finally { w.db.close(); }
});

test('the public read shares the evidence pack rate-limit bucket', () => {
  assert.ok(EVIDENCE_SHARE_READ.test('/api/share/readiness/abc'));
  assert.ok(EVIDENCE_SHARE_READ.test('/api/share/evidence/abc'));
  assert.ok(!EVIDENCE_SHARE_READ.test('/api/share/readiness/abc/more'));
});
