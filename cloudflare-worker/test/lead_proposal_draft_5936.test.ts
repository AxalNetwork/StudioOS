/**
 * D4838 part 10 (#5936): a lead's proposal draft through the mounted routes on real SQL — save, edit,
 * discard, origin kept through an edit, the three-set refusals, another firm's lead never reached,
 * and nothing about a draft saying it was sent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import partnerPipeline from '../src/routes/partner_pipeline.ts';

test.after(removeMigratedDatabases);

const secret = 'unit-test-jwt-secret-0123456789-abcdef';

async function harness() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO partners (id, name, email) VALUES (1, 'Ours', 'ours@example.test'), (2, 'Other', 'other@example.test');
    INSERT INTO users (id, email, name, role, partner_id) VALUES
      (80, 'ours@example.test', 'Ours', 'partner', 1), (81, 'other@example.test', 'Other', 'partner', 2);
    INSERT INTO founders (id, name, email) VALUES (5, 'Fran', 'fran@example.test');
    INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description, status) VALUES
      (1, 'n-1', 9, 5, 'engineering', 'Open lead', 'desc', 'open'),
      (2, 'n-2', 9, 5, 'engineering', 'Bid on', 'desc', 'open'),
      (3, 'n-3', 9, 5, 'engineering', 'Passed', 'desc', 'open'),
      (4, 'n-4', 9, 5, 'engineering', 'Closed', 'desc', 'closed');
    INSERT INTO quotes (id, uid, need_id, partner_id, price, deliverables, status) VALUES (1, 'q-1', 2, 1, 100, '[]', 'pending');
    INSERT INTO partner_lead_passes (partner_id, need_id, reason, passed_at) VALUES (1, 3, 'timing', '2026-01-01 00:00:00');
  `);
  const token = async (userId: number) => new SignJWT({ user_id: userId, role: 'partner' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const call = async (userId: number, method: string, path: string, body?: unknown) => {
    const response = await partnerPipeline.request(path, {
      method,
      headers: { Authorization: `Bearer ${await token(userId)}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' });
    return { status: response.status, body: await response.json() as any };
  };
  return { db, call };
}

test('save, edit and discard a lead draft; origin is kept through an edit; nothing says sent', async () => {
  const { db, call } = await harness();
  try {
    assert.deepEqual((await call(80, 'GET', '/leads/1/draft')).body, { need_id: 1, draft: null });

    const saved = await call(80, 'PUT', '/leads/1/draft', { shape: 'retainer', price_cents: 1250000, currency: 'usd', scope: ' Eight weeks, then monthly. ', origin: 'eadwyn' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.draft.shape, 'retainer');
    assert.equal(saved.body.draft.price_cents, 1250000);
    assert.equal(saved.body.draft.currency, 'USD');
    assert.equal(saved.body.draft.scope, 'Eight weeks, then monthly.');
    assert.equal(saved.body.draft.origin, 'eadwyn');
    assert.ok(!('sent' in saved.body.draft) && !('sent_at' in saved.body.draft) && !('status' in saved.body.draft), 'a draft carries no sent state');

    const edited = await call(80, 'PUT', '/leads/1/draft', { shape: 'fixed_project', price_cents: null, scope: 'Reworded.' });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.draft.shape, 'fixed_project');
    assert.equal(edited.body.draft.price_cents, null);
    assert.equal(edited.body.draft.origin, 'eadwyn', 'an edit keeps the origin it started from');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM partner_lead_proposal_drafts').get().n, 1, 'one draft per lead');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM quotes').get().n, 1, 'a draft writes no proposal');

    const columns = db.prepare("SELECT name FROM pragma_table_info('partner_lead_proposal_drafts')").all().map((r: any) => r.name);
    assert.ok(!columns.some((c: string) => /sent|status|recipient/.test(c)), 'the store has no sent column to set');

    assert.equal((await call(80, 'DELETE', '/leads/1/draft')).status, 200);
    assert.equal((await call(80, 'GET', '/leads/1/draft')).body.draft, null);
    const typed = await call(80, 'PUT', '/leads/1/draft', { scope: 'From nothing', origin: 'manual' });
    assert.equal(typed.body.draft.origin, 'manual');
    const accepted = await call(80, 'PUT', '/leads/1/draft', { scope: 'Eadwyn text', origin: 'eadwyn' });
    assert.equal(accepted.body.draft.origin, 'eadwyn', 'accepting an Eadwyn draft into a typed one marks it');
  } finally { db.close(); }
});

test('a draft belongs to a lead: bid, passed, closed and missing needs are refused; bad fields are refused', async () => {
  const { db, call } = await harness();
  try {
    for (const need of [2, 3, 4]) {
      assert.equal((await call(80, 'GET', `/leads/${need}/draft`)).status, 409, `need ${need} is not a lead`);
      assert.equal((await call(80, 'PUT', `/leads/${need}/draft`, { scope: 'x' })).status, 409);
    }
    assert.equal((await call(80, 'PUT', '/leads/99/draft', { scope: 'x' })).status, 404);
    assert.equal((await call(80, 'PUT', '/leads/abc/draft', { scope: 'x' })).status, 404);
    assert.equal((await call(80, 'PUT', '/leads/1/draft', { shape: 'barter' })).status, 400);
    assert.equal((await call(80, 'PUT', '/leads/1/draft', { price_cents: 12.5 })).status, 400);
    assert.equal((await call(80, 'PUT', '/leads/1/draft', { price_cents: -1 })).status, 400);
    assert.equal((await call(80, 'PUT', '/leads/1/draft', { scope: 'x', currency: 'dollars' })).status, 400);
    assert.equal((await call(80, 'PUT', '/leads/1/draft', { scope: 'x', origin: 'sent' })).status, 400);
    assert.equal((await call(80, 'PUT', '/leads/1/draft', { scope: '   ' })).status, 400, 'an empty draft is refused');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM partner_lead_proposal_drafts').get().n, 0);
  } finally { db.close(); }
});

test("one firm never reads, edits or discards another firm's draft", async () => {
  const { db, call } = await harness();
  try {
    await call(80, 'PUT', '/leads/1/draft', { scope: 'Ours' });
    assert.equal((await call(81, 'GET', '/leads/1/draft')).body.draft, null, "the other firm sees none of ours");
    await call(81, 'PUT', '/leads/1/draft', { scope: 'Theirs' });
    await call(81, 'DELETE', '/leads/1/draft');
    assert.equal((await call(80, 'GET', '/leads/1/draft')).body.draft.scope, 'Ours', 'their save and discard touched only their own row');
  } finally { db.close(); }
});

test("the sheet's Eadwyn draft is scoped to its one open lead, and a named non-lead drafts nothing", async () => {
  const { db } = await harness();
  const { default: research } = await import('../src/routes/research.ts');
  const { withGuard } = await import('./_guard_stub.mjs');
  try {
    db.exec(`INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description, status) VALUES
      (5, 'n-5', 9, 5, 'engineering', 'Another open lead', 'desc', 'open');`);
    // A top-up balance so the run reaches the (stubbed) model; the allowance rules are not this test's.
    db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,50000000)').run(80);
    const draft = async (scope?: string) => {
      let prompt: string | null = null;
      const AI = withGuard({
        run: async (_model: string, payload: any) => {
          const messages = payload?.messages || [];
          prompt = String(messages[messages.length - 1]?.content ?? '');
          return { response: 'An outline.' };
        },
      });
      const token = await new SignJWT({ user_id: 80, role: 'partner' }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
      const res = await research.fetch(new Request('http://x/drafts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ surface: 'pipeline/leads', ...(scope === undefined ? {} : { scope_key: scope }) }),
      }), { JWT_SECRET: secret, ENVIRONMENT: 'development', DB: d1Over(db), AI } as any);
      return { status: res.status, prompt: prompt as string | null };
    };
    const one = await draft('1');
    assert.ok(one.prompt, 'the model was reached for an open lead');
    assert.match(one.prompt!, /Open lead/);
    assert.doesNotMatch(one.prompt!, /Another open lead/, 'a scoped draft reads only its own lead');
    const page = await draft();
    assert.match(page.prompt!, /Another open lead/, 'the Leads page band still reads every open lead');
    for (const scope of ['2', '3', '4', '99', 'abc', 'null']) {
      const refused = await draft(scope);
      assert.equal(refused.status, 409, `scope ${scope} drafts nothing`);
      assert.equal(refused.prompt, null, 'the model is never reached');
    }
  } finally { db.close(); }
});
