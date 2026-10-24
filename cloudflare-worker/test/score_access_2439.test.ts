import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import risk from '../src/routes/venture_risk.ts';
import trust from '../src/routes/trust.ts';
import decks from '../src/routes/decks.ts';
import deals, { userMayReadDeal, userReadableDealIds } from '../src/routes/deals.ts';
import { signScore, getVerifiedLatestSnapshots } from '../src/services/scoreIntegrity.ts';
import { mayReadTrustScores } from '../src/services/scoreAccess.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const secret = 'synthetic-test-only-'.repeat(3);
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['users', 'projects', 'deals', 'deal_invitations', 'commitments',
    'user_company_links', 'score_snapshots', 'activity_logs',
    'super_admins', 'user_personas', 'mi_pro_subscriptions']) {
    db.exec(tableFromBaseline(baseline, name));
  }
  db.exec(readFileSync(new URL('../sql/migrations/114_venture_risk.sql', import.meta.url), 'utf8'));
  for (const [id, role, founder] of [[1, 'admin', null], [2, 'partner', null], [3, 'investor', null],
    [4, 'founder', 40], [5, 'founder', 50], [6, 'advisor', null], [7, 'exploring', 70]]) {
    db.prepare('INSERT INTO users(id,email,name,role,founder_id) VALUES(?,?,?,?,?)')
      .run(id, `person${id}@example.invalid`, `Person ${id}`, role, founder);
  }
  db.exec(`INSERT INTO projects(id,name,founder_id,company_id) VALUES(10,'Synthetic A',40,100),(20,'Synthetic B',50,200);
    INSERT INTO deals(id,project_id) VALUES(100,10),(200,20);
    INSERT INTO deal_invitations(deal_id,investor_user_id) VALUES(100,3);
    INSERT INTO user_company_links(uid,company_id,user_id) VALUES('synthetic-member',100,6);`);
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, SCORING_HMAC_SECRET: secret, ENVIRONMENT: 'development' };
  return { db, env };
}
async function request(app: any, env: any, id: number, path: string, body?: any) {
  const token = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  return app.request(path, { method: body ? 'POST' : 'GET', headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
  }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
}
async function snapshot(f: ReturnType<typeof fixture>, status = 'approved', signed = true, score = 91) {
  const at = '2026-10-01T00:00:00Z';
  const hash = signed ? await signScore(f.env, 10, score, at) : null;
  f.db.prepare(`INSERT INTO score_snapshots(project_id,total_score,tier,created_at,integrity_hash,
    admin_review_status,team_total,market_total) VALUES(10,?,'A',?,?,?,20,25)`)
    .run(score, at, hash, status);
}

test('risk: only deal-related investors read one project; matrix and writes remain internal', async () => {
  const f = fixture();
  try {
    await snapshot(f);
    assert.equal((await request(risk, f.env, 3, '/by-project/10')).status, 200);
    assert.equal((await request(risk, f.env, 3, '/by-project/20')).status, 403);
    assert.equal((await request(risk, f.env, 3, '/matrix')).status, 403);
    assert.equal((await request(risk, f.env, 3, '/10/recompute', {})).status, 403);
    for (const id of [4, 6, 7]) {
      assert.equal((await request(risk, f.env, id, '/by-project/10')).status, 403);
      assert.equal((await request(risk, f.env, id, '/matrix')).status, 403);
    }
    for (const id of [1, 2]) assert.equal((await request(risk, f.env, id, '/matrix')).status, 200);
    const logs: any[] = f.db.prepare("SELECT * FROM activity_logs WHERE action='score_read'").all();
    assert.ok(logs.some(row => row.user_id === 3 && row.project_id === 10));
    assert.ok(logs.some(row => row.user_id === 2 && row.project_id === 10));
  } finally { f.db.close(); }
});

test('risk and screening: flagged/rejected/unsigned/tampered rows supply no components; verified reads are audited', async () => {
  for (const kind of ['flagged', 'rejected', 'unsigned', 'tampered', 'approved']) {
    const f = fixture();
    try {
      await snapshot(f, kind === 'flagged' || kind === 'rejected' ? kind : 'approved', kind !== 'unsigned');
      if (kind === 'tampered') f.db.exec('UPDATE score_snapshots SET total_score = 99');
      const assessment: any = await (await request(risk, f.env, 2, '/by-project/10')).json();
      const screeningResponse = await request(deals, f.env, 2, '/screening');
      assert.equal(screeningResponse.status, 200);
      const screening: any = await screeningResponse.json();
      assert.equal(screening.scored.available, true);
      const row = screening.scored.rows.find((r: any) => r.deal_id === 100);
      assert.equal(row.total_score, kind === 'approved' ? 91 : null, kind);
      assert.equal('flags' in row, false);
      assert.equal('review_status' in row, false);
      assert.equal(screening.flags.available, false);
      const investorAssessment: any = await (await request(risk, f.env, 3, '/by-project/10')).json();
      assert.equal(investorAssessment.layers.find((l: any) => l.key === 'founder').auto_score, kind === 'approved' ? 100 : null, kind);
      const founder = assessment.layers.find((l: any) => l.key === 'founder');
      assert.equal(founder.auto_score, kind === 'approved' ? 100 : null, kind);
      const logs: any[] = f.db.prepare("SELECT * FROM activity_logs WHERE action='score_read'").all();
      if (['approved', 'unsigned', 'tampered'].includes(kind)) assert.equal(logs.length, 3, kind);
      if (kind === 'approved') assert.ok(logs.every(row => JSON.parse(row.details).integrity_valid === true));
      for (const id of [3, 4, 6, 7]) assert.equal((await request(deals, f.env, id, '/screening')).status, 403);
      assert.equal((await request(deals, f.env, 1, '/screening')).status, 200);
    } finally { f.db.close(); }
  }
});

test('trust: related venture members get bare scores; self/admin retain missing obligations', async () => {
  const f = fixture();
  try {
    for (const id of [2, 3]) {
      const response = await request(trust, f.env, id, '/score/4');
      assert.equal(response.status, 200);
      const score: any = await response.json();
      assert.deepEqual(Object.keys(score).sort(), ['score', 'user_id']);
      assert.equal((await request(trust, f.env, id, '/score/999')).status, 403);
      const batch = await request(trust, f.env, id, '/score/batch', { user_ids: [4, 6] });
      assert.equal(batch.status, 200);
      const body: any = await batch.json();
      assert.ok(body.scores.every((row: any) => !('missing' in row) && !('required_total' in row)));
    }
    assert.equal((await request(trust, f.env, 3, '/score/5')).status, 403);
    assert.equal((await request(trust, f.env, 3, '/score/7')).status, 403);
    assert.equal((await request(trust, f.env, 3, '/score/batch', { user_ids: [4, 5] })).status, 403);
    assert.equal((await request(trust, f.env, 4, '/score/5')).status, 403);
    for (const id of [6, 7]) assert.equal((await request(trust, f.env, id, '/score/4')).status, 403);
    for (const id of [4, 6, 7]) {
      assert.equal((await request(trust, f.env, id, '/score/batch', { user_ids: [4] })).status, 403);
    }
    for (const id of [1, 4]) {
      const response = await request(trust, f.env, id, '/score/4');
      assert.equal(response.status, 200);
      const body: any = await response.json();
      assert.ok(Array.isArray(body.missing));
      assert.ok(body.missing.length > 0);
      assert.ok(body.required_total > 0);
    }
    f.db.exec('UPDATE projects SET deleted_at = CURRENT_TIMESTAMP WHERE id=10');
    assert.equal(await mayReadTrustScores(f.env, { id: 3, role: 'investor' } as any, [4]), false);
  } finally { f.db.close(); }
});


test('deck generation: fallback uses project facts without internal scores', async () => {
  const f = fixture();
  try {
    await snapshot(f);
    f.db.exec("UPDATE users SET subscription_tier='studio' WHERE id=4");
    const response = await request(decks, f.env, 4, '/generate', { project_id: 10 });
    assert.equal(response.status, 200, await response.clone().text());
    const deck: any = await response.json();
    assert.equal(deck.slides.length, 10);
    assert.doesNotMatch(JSON.stringify(deck.slides), /Internal score|Market scoring|91\/100/);
    // The AI and positioning paths must never receive the private snapshot.
    const source = readFileSync(new URL('../src/routes/decks.ts', import.meta.url), 'utf8');
    const drafting = source.slice(source.indexOf('async function aiSlides'), source.indexOf('// Spec: deck'));
    assert.doesNotMatch(drafting, /scoring:|Use the scoring numbers|snap\./);
    const positioning = source.slice(source.indexOf("decks.post('/positioning'"), source.indexOf("decks.post('/positioning'") + 6500);
    assert.doesNotMatch(positioning, /score_tier|latestScore/);
  } finally { f.db.close(); }
});


test('bulk score reads: deduplicate deals and batch audit without weakening visibility', async () => {
  const f = fixture();
  try {
    await snapshot(f);
    f.db.exec('INSERT INTO deals(id,project_id) VALUES(101,10)');
    let selections = 0;
    let auditBatches = 0;
    const originalPrepare = f.env.DB.prepare.bind(f.env.DB);
    const originalBatch = f.env.DB.batch.bind(f.env.DB);
    f.env.DB.prepare = (sql: string) => {
      if (sql.includes('FROM score_snapshots')) selections++;
      return originalPrepare(sql);
    };
    f.env.DB.batch = async (statements: any[]) => {
      auditBatches++;
      return originalBatch(statements);
    };
    const response = await request(deals, f.env, 2, '/screening');
    assert.equal(response.status, 200);
    const body: any = await response.json();
    assert.equal(body.scored.rows.filter((r: any) => r.total_score === 91).length, 2);
    assert.equal(selections, 1);
    assert.equal(auditBatches, 1);
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action='score_read'").get() as any).n, 1);
    selections = 0; auditBatches = 0;
    assert.equal((await request(risk, f.env, 2, '/matrix')).status, 200);
    assert.equal(selections, 1);
    assert.equal(auditBatches, 1);
    const visible = await getVerifiedLatestSnapshots(f.env, [10, 10, 20], { role: 'investor', userId: 3 });
    assert.equal(visible.size, 1);
    assert.equal(visible.get(10)?.row.total_score, 91);
    f.db.exec("UPDATE score_snapshots SET total_score=99");
    assert.equal((await getVerifiedLatestSnapshots(f.env, [10], { role: 'investor', userId: 3 })).size, 0);
  } finally { f.db.close(); }
});


test('trust bulk permissions: bounded queries match single-deal invitations and commitments', async () => {
  const f = fixture();
  try {
    f.db.exec('INSERT INTO commitments(deal_id,investor_user_id,amount) VALUES(200,3,1)');
    for (const [id, role] of [[1, 'admin'], [2, 'partner'], [3, 'investor']] as const) {
      const user: any = { id, role };
      const bulk = await userReadableDealIds(f.env, user, [100, 200, 999]);
      for (const dealId of [100, 200, 999]) {
        assert.equal(bulk.has(dealId), await userMayReadDeal(f.env, user, dealId));
      }
    }
    for (const role of ['founder', 'advisor', 'exploring']) {
      assert.equal((await userReadableDealIds(f.env, { id: 4, role } as any, [100])).size, 0);
    }
    let queries = 0;
    const prepare = f.env.DB.prepare.bind(f.env.DB);
    f.env.DB.prepare = (sql: string) => { queries++; return prepare(sql); };
    assert.equal(await mayReadTrustScores(f.env, { id: 3, role: 'investor' } as any, [4, 5, 6]), true);
    assert.equal(queries, 2, 'one indexed membership query and one bulk authorization query');
  } finally { f.db.close(); }
});

test('risk: unavailable score storage preserves project-data assessment without score disclosure', async () => {
  const f = fixture();
  try {
    await snapshot(f);
    const prepare = f.env.DB.prepare.bind(f.env.DB);
    f.env.DB.prepare = (sql: string) => {
      if (sql.includes('FROM score_snapshots')) throw new Error('synthetic unavailable store');
      return prepare(sql);
    };
    for (const id of [2, 3]) {
      const response = await request(risk, f.env, id, '/by-project/10');
      assert.equal(response.status, 200);
      const body: any = await response.json();
      assert.equal(body.layers.find((l: any) => l.key === 'founder').auto_has_data, false);
    }
    assert.equal((await request(risk, f.env, 2, '/matrix')).status, 200);
  } finally { f.db.close(); }
});
