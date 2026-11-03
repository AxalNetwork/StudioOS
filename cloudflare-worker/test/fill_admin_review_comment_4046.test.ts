/**
 * #4046 Group B4 — Ask on the review drawer's new comment (Super Admin ·
 * Content · Content queue / `review-comment`). One composition field,
 * `article_review_comments.body`; the paragraph it points at, a reply,
 * Resolve, every stage change and its reason are never listed.
 *
 *   - A new comment hangs under the article (`article`, `article_id`): any
 *     admin may draft one on an article that exists (POST
 *     /api/admin/articles/:id/comments is `requireAdmin`). A founder, a partner
 *     and anyone else are refused, as the route refuses them; it is not
 *     concealed, since the route conceals nothing from an admin.
 *   - A sent comment is read by any admin and filled by its author alone: a
 *     Super Admin gets no trigger on another admin's words.
 *   - The run reads the article's own text and its first comments; never the
 *     author's name or email, a reply, a rejection reason, another article's
 *     comments or the stage. It adds a reviewer's voice line.
 *   - After Send the record step keeps the comment; an Undo is always refused
 *     (`no_prior`): the author may already have read it.
 *
 * On the migrated schema, synthetic rows only; the model and the quoter are stubs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fill_admin_review_comment_4046.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import fills from '../src/routes/fills.ts';
import adminArticles from '../src/routes/admin_articles.ts';
import { railRunRoutes } from '../src/routes/rail_run.ts';
import { FILL_FIELDS, fieldsOf, fillFieldProblems } from '../src/services/fills/fields.ts';
import { UNDO_WRITES } from '../src/services/fills/keep.ts';
import { RECORD_SCOPES } from '../src/services/fills/scopes.ts';
import { FILL_FIELDS as SPA_FIELDS } from '../../frontend/src/lib/fillFields.js';

const SECRET = 'synthetic-fill-review-comment-4046-'.repeat(3);
test.after(() => removeMigratedDatabases());

const PAGE = 'Super Admin · Content · Content queue';
const FORM = 'review-comment';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const PROPOSED = 'The second paragraph claims a 40% drop; name the source.';

// 51 admin (the reviewer); 52 another admin; 53 a Super Admin; 7 founder (the article's author); 31 partner; 61 explorer.
// Article 700 is under review, 701 another. Comment 800 on 700 is 52's, 801 a reply to it by the author, 802 on 701.
function fixture(output: unknown = { fields: [] }) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,is_active) VALUES
      (51,'Reviewer','rv@example.test','admin',1),
      (52,'Other admin','ad2@example.test','admin',1),
      (53,'Super','su@example.test','admin',1),
      (7,'Ada Writer','ada.writer@example.test','founder',1),
      (31,'Partner','pa@example.test','partner',1),
      (61,'Explorer','x@example.test','exploring',1);
    INSERT INTO super_admins(user_id) VALUES (53);
    INSERT INTO articles(id,slug,title,subtitle,sector,status,author_user_id,body_markdown,rejection_reason) VALUES
      (700,'seed-pricing','Pricing for seed studios','What we learned in a year','fintech','in_review',7,'Studios priced too low.\n\nOur churn fell by 40% after the change.','Earlier rejection reason never read'),
      (701,'other-piece','Another piece',NULL,NULL,'in_review',7,'Other article text never read.',NULL);
    INSERT INTO article_review_comments(id,article_id,author_id,body,anchor,parent_id) VALUES
      (800,700,52,'Open note: check the chart caption.',NULL,NULL),
      (801,700,7,'Author reply never read.',NULL,800),
      (802,701,51,'Another article note never read.',NULL,NULL);
  `);
  const runs: any[] = [];
  const quotes: any[] = [];
  const run = async (_env: any, input: any) => {
    runs.push(input);
    return { ok: true, output: JSON.stringify(output), usageLogId: null, usage: { model: MODEL }, guard: { input: 'pass', output: 'pass', codes: [], calls: 2 } };
  };
  const quote = async (_env: any, input: any) => { quotes.push(input); return { ok: true, hold_microusd: 1200, model: MODEL } as any; };
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, e?.status || 500));
  app.route('/api/ai/rail', railRunRoutes({ run, quote }));
  app.route('/api/fills', fills);
  app.route('/api/admin/articles', adminArticles);
  const call = async (who: number, method: string, path: string, body?: unknown, opts: { support?: boolean } = {}) => {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role, ...(opts.support ? { impersonated_by: 53 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const r = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await r.text();
    return { status: r.status, type: r.headers.get('content-type') || '', text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const sheet = (who: number, q: Record<string, string | number> = {}, opts: { support?: boolean } = {}) =>
    call(who, 'GET', `/api/fills/sheet?${new URLSearchParams(Object.entries({ page: PAGE, form: FORM, ...q }).map(([k, v]) => [k, String(v)]))}`, undefined, opts);
  const runForm = async (who: number, body: Record<string, unknown>) => {
    const r = await call(who, 'POST', '/api/ai/rail/run', { page: PAGE, option: `form:${FORM}`, ...body });
    const evs = r.type.startsWith('text/event-stream')
      ? r.text.trim().split('\n\n').map((b) => ({ event: /^event: (.+)$/m.exec(b)![1], data: JSON.parse(/^data: (.+)$/m.exec(b)![1]) }))
      : [];
    return { ...r, done: evs.find((e) => e.event === 'done')?.data };
  };
  return { db, call, sheet, runForm, runs, quotes };
}
const prompt = (input: any) => input.messages.map((m: any) => m.content).join('\n');

test('the registry: the comment, in both copies; never the paragraph, a reply, Resolve or a stage change', () => {
  // Mutation checked: the entry dropped from the SPA copy → the deepEqual fails.
  assert.deepEqual(fillFieldProblems(), []);
  assert.deepEqual(JSON.parse(JSON.stringify(SPA_FIELDS)), JSON.parse(JSON.stringify(FILL_FIELDS)));
  assert.deepEqual(fieldsOf(PAGE, FORM).map((f) => [f.field, f.label, f.table, f.column, f.class, f.sources]),
    [['body', 'Comment', 'article_review_comments', 'body', 'composition', ['eadwyn']]]);
  assert.ok(!FILL_FIELDS.some((f) => f.table === 'article_review_comments' && f.column !== 'body'));
  assert.ok(!FILL_FIELDS.some((f) => f.table === 'articles' && /rejection|reason|status/.test(f.column)));
  const undo = UNDO_WRITES['article_review_comments.body'];
  assert.deepEqual([undo?.scoped, undo?.required, undo?.int], [true, true, false], 'sent as it is made: an Undo has no prior');
  assert.match(undo.write, /edited_at = strftime\('%Y-%m-%dT%H:%M:%fZ', 'now'\)/, 'the route stamps edited_at with an ISO time');
  assert.doesNotMatch(undo.write, /updated_at/, 'article_review_comments has no updated_at');
  assert.equal(RECORD_SCOPES.article_review_comments.concealed, undefined, 'the route conceals nothing from an admin');
  assert.deepEqual(RECORD_SCOPES.article_review_comments.parent && [RECORD_SCOPES.article_review_comments.parent.kind, RECORD_SCOPES.article_review_comments.parent.column], ['article', 'article_id']);
  assert.equal((RECORD_SCOPES.article_review_comments.read.match(/\?/g) || []).length, 1);
});

test('who gets Ask: any admin, under an article that exists; a founder and a partner are refused; a support session keeps nothing', async () => {
  // Mutations checked: `isAdminUser` dropped from the scope → the founder reads 200; the articles check dropped
  // (BOTH for any parent) → article 999 reads 200.
  const f = fixture();
  for (const who of [51, 52, 53]) {
    const r = await f.sheet(who, { parent: 700 });
    assert.equal(r.status, 200, `user ${who}: ${r.text}`);
    assert.deepEqual([r.body.scope, r.body.can_fill, r.body.fields.map((x: any) => [x.field, x.trigger])], ['article:700', true, [['body', true]]], `user ${who}`);
  }
  for (const who of [7, 31]) {
    const r = await f.sheet(who, { parent: 700 });
    assert.deepEqual([r.status, r.body.error], [403, 'record_not_available'], `user ${who}: ${r.text}`);
  }
  assert.deepEqual([(await f.sheet(61, { parent: 700 })).status, (await f.sheet(61, { parent: 700 })).body.error], [403, 'no_profile']);
  const none = await f.sheet(51, { parent: 999 });
  assert.equal(none.status, 403, `no article 999: ${none.text}`);
  assert.equal((await f.sheet(51, { parent: 700 }, { support: true })).body.can_fill, false);
});

test('a sent comment: any admin reads it, only its author may fill it; a Super Admin gets no trigger on another admin\'s words', async () => {
  // Mutation checked: the author check on a saved row dropped (BOTH for any admin) → 51 and 53 read can_fill true.
  const f = fixture();
  const mine = await f.sheet(52, { record: 800 });
  assert.equal(mine.status, 200, mine.text);
  assert.equal(mine.body.can_fill, true);
  for (const who of [51, 53]) {
    const other = await f.sheet(who, { record: 800 });
    assert.equal(other.status, 200, other.text);
    assert.equal(other.body.can_fill, false, `user ${who} reads it and fills nothing`);
  }
  assert.equal((await f.sheet(7, { record: 800 })).status, 403);
});

test('the run: the article\'s text and its first comments, never a reply, the author, a reason or another article; nothing is written', async () => {
  // Mutations checked: `AND parent_id IS NULL` dropped from the gather → the author's reply reaches the prompt;
  // `article_id = ?` bound to the wrong id → the open note is missing; the guide dropped → no verdict line.
  const f = fixture({ fields: [{ field: 'body', value: PROPOSED }, { field: 'anchor', value: 'Paragraph 2' }] });
  const run = await f.runForm(51, { parent: 700, input: { values: { body: '' } } });
  assert.equal(run.status, 200, run.text);
  assert.deepEqual(run.done.proposals.map((p: any) => [p.field, p.value]), [['body', PROPOSED]]);
  assert.deepEqual(run.done.dropped.map((d: any) => [d.field, d.why]), [['anchor', 'unknown_field']]);
  const p = prompt(f.runs[0]);
  for (const read of [/Title: Pricing for seed studios/, /Subtitle: What we learned in a year/, /Sector: fintech/, /Our churn fell by 40% after the change/, /Open note: check the chart caption/]) {
    assert.match(p, read);
  }
  assert.match(p, /Never say whether it will be approved, rejected or published/);
  for (const never of [/Author reply never read/, /Another article note never read/, /Other article text never read/, /Earlier rejection reason never read/, /Ada Writer/, /ada\.writer@example\.test/, /in_review/]) {
    assert.doesNotMatch(p, never);
  }
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM article_review_comments').get() as any).n, 3, 'the run writes nothing');
  const payload = JSON.parse((f.db.prepare('SELECT payload_json FROM ai_rail_proposals').get() as any).payload_json);
  assert.deepEqual([payload.project, payload.scope], [null, 'article:700']);
  // A founder is refused before any hold; so is an article that does not exist.
  assert.equal((await f.runForm(7, { parent: 700, input: { values: {} } })).status, 403);
  assert.equal((await f.runForm(51, { parent: 999, input: { values: {} } })).status, 403);
  assert.equal(f.quotes.length, 1);
});

test('after Send: the 201 names the id; the reviewer keeps the comment; another admin records nothing; an Undo is refused', async () => {
  // Mutation checked: `required: true` → false on the undo entry → the Undo blanks the comment and answers 200.
  const f = fixture({ fields: [{ field: 'body', value: PROPOSED }] });
  const run = await f.runForm(51, { parent: 700, input: { values: { body: '' } } });
  const uid = run.done.proposals[0].uid;
  const made = await f.call(51, 'POST', '/api/admin/articles/700/comments', { body: PROPOSED, anchor: 'Paragraph 2' });
  assert.equal(made.status, 201, made.text);
  const id = made.body.id;
  assert.ok(Number.isSafeInteger(id) && id > 802);
  assert.equal((await f.call(52, 'POST', '/api/fills/record', { page: PAGE, form: FORM, record: id, proposals: [uid] })).status, 403, 'not their comment');
  const kept = await f.call(51, 'POST', '/api/fills/record', { page: PAGE, form: FORM, record: id, proposals: [uid] });
  assert.equal(kept.status, 200, kept.text);
  assert.deepEqual(kept.body.outcomes.map((o: any) => [o.field, o.outcome]), [['body', 'kept']]);
  const undo = await f.call(51, 'POST', `/api/fills/${kept.body.outcomes[0].provenance_id}/undo`);
  assert.deepEqual([undo.status, undo.body.error], [409, 'no_prior']);
  const row = f.db.prepare('SELECT body, edited_at FROM article_review_comments WHERE id = ?').get(id) as any;
  assert.deepEqual([row.body, row.edited_at], [PROPOSED, null], 'the author reads what was sent, unedited');
});

test('after Send: a comment typed over is let go; one on another article keeps nothing', async () => {
  const f = fixture({ fields: [{ field: 'body', value: PROPOSED }] });
  const run = await f.runForm(51, { parent: 700, input: { values: {} } });
  const uid = run.done.proposals[0].uid;
  const own = await f.call(51, 'POST', '/api/admin/articles/700/comments', { body: 'My own words instead.' });
  assert.equal(own.status, 201, own.text);
  const typed = await f.call(51, 'POST', '/api/fills/record', { page: PAGE, form: FORM, record: own.body.id, proposals: [uid] });
  assert.deepEqual(typed.body.outcomes.map((o: any) => [o.field, o.outcome]), [['body', 'not_kept']], typed.text);
  // The proposal was made under article 700: a comment on 701 with the same words is not its record.
  const elsewhere = await f.call(51, 'POST', '/api/admin/articles/701/comments', { body: PROPOSED });
  const moved = await f.call(51, 'POST', '/api/fills/record', { page: PAGE, form: FORM, record: elsewhere.body.id, proposals: [uid] });
  assert.equal((moved.body?.outcomes || []).some((o: any) => o.outcome === 'kept'), false, moved.text);
});

test('a frozen admin gets no Ask: requireAdmin refuses their comment (D135), so no run is spent', async () => {
  // Review finding (B4): the scope skipped the freeze. Mutation checked: the freeze check dropped → can_fill true.
  const f = fixture();
  f.db.exec(`INSERT INTO admin_notices(uid,user_id,kind,subject,body,respond_by,status) VALUES ('an-rc',52,'fees','Fees','Pay','2026-01-01 00:00:00','overdue')`);
  const r = await f.sheet(52, { parent: 700 });
  assert.deepEqual([r.status, r.body.can_fill], [200, false], r.text);
  assert.equal((await f.sheet(51, { parent: 700 })).body.can_fill, true, 'another admin is not frozen');
});
