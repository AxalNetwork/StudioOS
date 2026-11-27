/**
 * D8730 (#8730) — the Founder and Exploring previews stay in role.
 *
 *   - GET /api/advisor/preview-examples gives an admin the first questions of
 *     the PREVIEWED role's bank (never the admin bank), with no answers;
 *   - an admin's advisor write marked as a Founder or Exploring preview is
 *     refused before any handler runs; a member, or an unmarked write, is not;
 *   - /progress says profiling is not applicable to a still-exploring visitor,
 *     who is only ever asked the discovery bank;
 *   - the discovery bank's page_target is a page that exists, and the role
 *     option reads "I advise founders" and still maps to advisor.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/role_previews_8730.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import type { Env } from '../src/types';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors';
import advisor, { previewExamplesFor } from '../src/routes/advisor';
import { ROLE_DETECTOR, bankFor, mapRoleAnswer } from '../src/services/advisor/questionBank';
import { explorerBankForTrack } from '../src/services/advisor/banks/explorer';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = new TextEncoder().encode('synthetic-d8730-test-key-only');
const HQ = 1, FOUNDER = 2, EXPLORER = 3, ADMIN = 4;
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const table of ['users', 'super_admins', 'user_sessions']) db.exec(tableFromBaseline(baseline, table));
  db.exec(`
    INSERT INTO users(id, name, email, role, is_active) VALUES
      (1, 'Synthetic HQ', 'a@example.test', 'admin', 1),
      (2, 'Synthetic Founder', 'b@example.test', 'founder', 1),
      (3, 'Synthetic Visitor', 'c@example.test', 'exploring', 1),
      (4, 'Synthetic Admin', 'd@example.test', 'admin', 1);
    INSERT INTO super_admins(user_id) VALUES (1);
  `);
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/advisor', advisor);
  app.onError((err, c) => {
    if (err instanceof Response) return err;
    const status = AUTH_ERROR_STATUSES[err.message];
    if (!status) throw err;
    return c.json({ error: err.message }, status as 401 | 403);
  });
  const env = { DB: d1Over(db), JWT_SECRET: new TextDecoder().decode(SECRET), ENVIRONMENT: 'development' } as Env;
  async function call(actor: number, method: string, path: string, shell: string | null = null, input?: unknown) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (shell) headers.set('X-Axal-Preview-Shell', shell);
    const token = await new SignJWT({ user_id: actor }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(SECRET);
    headers.set('Authorization', 'Bearer ' + token);
    const res = await app.request('/api/advisor' + path, { method, headers, body: input === undefined ? undefined : JSON.stringify(input) }, env);
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  }
  return { call, db };
}

test('the founder examples are the founder bank\'s first two questions, then the next two as Next up, with no answer anywhere', () => {
  const out = previewExamplesFor('founder', null)!;
  const bank = bankFor('founder', { spinoutLabActive: false });
  assert.deepEqual(out.examples.map((q) => q.prompt), [bank[0].prompt, bank[1].prompt]);
  assert.equal(out.examples[0].prompt, 'Confirm your company / project name.');
  assert.deepEqual(out.next_up.map((q) => q.id), [bank[2].id, bank[3].id]);
  assert.ok(out.next_up.every((q) => typeof q.page_target === 'string' && q.page_target.startsWith('/')), 'Next up links to founder pages');
  assert.ok(!out.examples.some((q) => /admin/.test(q.page_target || '')), 'no /admin link');
  const keys = new Set([...out.examples, ...out.next_up].flatMap((q) => Object.keys(q)));
  assert.deepEqual([...keys].sort(), ['id', 'options', 'page_target', 'prompt', 'section']);
  assert.ok(!('conversation_uid' in out) && !('answered' in out), 'the envelope carries no conversation and no count');
});

test('Exploring examples follow the visitor state: the role question with no track, the track\'s discovery bank with one', () => {
  const none = previewExamplesFor('exploring', null)!;
  assert.equal(none.bank, 'role');
  assert.equal(none.examples.length, 1);
  assert.equal(none.examples[0].prompt, ROLE_DETECTOR[0].prompt);
  assert.deepEqual(none.examples[0].options, ['I am building a startup', 'I invest in startups', 'I advise founders', 'I partner with the studio']);
  for (const track of ['founder', 'investor', 'advisor', 'partner']) {
    const out = previewExamplesFor('exploring', track)!;
    assert.equal(out.bank, 'discovery', track);
    assert.equal(out.total, 12, track);
    assert.deepEqual(out.examples.map((q) => q.id), explorerBankForTrack(track).slice(0, 2).map((q) => q.id), track);
    assert.deepEqual(out.next_up, [], `${track}: discovery questions are answered in Eadwyn, so no Next up links`);
  }
  assert.equal(previewExamplesFor('exploring', 'admin'), null, 'admin is not an Exploring track');
  assert.equal(previewExamplesFor('admin', null), null, 'the admin bank is never a preview example');
  assert.equal(previewExamplesFor('investor', null), null);
});

test('GET /preview-examples answers an admin, refuses a member, and rejects a role it does not preview', async () => {
  const { call } = fixture();
  const founder = await call(HQ, 'GET', '/preview-examples?shell=founder');
  assert.equal(founder.status, 200);
  assert.equal(founder.body.examples[1].prompt, bankFor('founder', { spinoutLabActive: false })[1].prompt);
  const investor = await call(ADMIN, 'GET', '/preview-examples?shell=exploring&track=investor');
  assert.equal(investor.status, 200);
  assert.equal(investor.body.track, 'investor');
  const none = await call(ADMIN, 'GET', '/preview-examples?shell=exploring&track=none');
  assert.equal(none.body.bank, 'role');
  assert.equal((await call(FOUNDER, 'GET', '/preview-examples?shell=founder')).status, 403, 'a member is not handed the preview read');
  assert.equal((await call(EXPLORER, 'GET', '/preview-examples?shell=exploring')).status, 403);
  const bad = await call(HQ, 'GET', '/preview-examples?shell=admin');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'preview_role_unknown');
});

test('an admin\'s advisor writes from a Founder or Exploring preview are refused before any handler runs', async () => {
  const { call, db } = fixture();
  for (const shell of ['founder', 'exploring', 'Founder']) {
    for (const [path, input] of [['/start', {}], ['/answer', { conversation_uid: 'x', question_id: 'founder.project.name', value: 'Synthetic' }], ['/skip', { conversation_uid: 'x', question_id: 'q' }], ['/turn', { text: 'hi' }]] as const) {
      for (const actor of [HQ, ADMIN]) {
        const res = await call(actor, 'POST', path, shell, input);
        assert.equal(res.status, 403, `${shell} ${path} ${actor}`);
        assert.equal(res.body.error, 'role_preview_read_only', `${shell} ${path}`);
        assert.equal(res.body.message, 'Answers are not saved in a preview. Back to HQ to keep working as yourself.');
      }
    }
  }
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'advisor_%'").all();
  assert.deepEqual(tables, [], 'no advisor table was even created: nothing ran past the refusal');
});

test('the marker narrows, never grants: a member, an unmarked write and the investor marker are not refused by it', async () => {
  const { call } = fixture();
  const member = await call(FOUNDER, 'POST', '/skip', 'founder', {});
  assert.notEqual(member.body?.error, 'role_preview_read_only', 'a founder sending the header is a founder, not a preview');
  const unmarked = await call(HQ, 'POST', '/skip', null, {});
  assert.notEqual(unmarked.body?.error, 'role_preview_read_only');
  const investor = await call(HQ, 'POST', '/skip', 'investor', {});
  assert.notEqual(investor.body?.error, 'role_preview_read_only');
  const read = await call(HQ, 'GET', '/preview-examples?shell=founder', 'founder');
  assert.equal(read.status, 200, 'reads pass in a preview');
});

test('/progress tells a still-exploring visitor that profiling does not apply, with or without a track', async () => {
  const { call, db } = fixture();
  const none = await call(EXPLORER, 'GET', '/progress');
  assert.equal(none.status, 200, JSON.stringify(none.body));
  assert.equal(none.body.profiling.applicable, false);
  db.exec(`INSERT INTO user_role_review(user_id, suggested_role) VALUES (3, 'founder')`);
  const founderTrack = await call(EXPLORER, 'GET', '/progress');
  assert.equal(founderTrack.status, 200);
  assert.equal(founderTrack.body.persona, 'founder', 'the overlay still picks the founder track');
  assert.equal(founderTrack.body.overall.total, 12, 'the discovery bank is what is counted');
  assert.equal(founderTrack.body.profiling.applicable, false, 'the fit bank of the suggested role is never asked while exploring');
  const member = await call(FOUNDER, 'GET', '/progress');
  assert.equal(member.status, 200);
  assert.equal(member.body.profiling.applicable, true, 'a founder member is still profiled');
});

test('the discovery bank points at a page that exists, and "I advise founders" maps to advisor', () => {
  for (const track of ['founder', 'investor', 'advisor', 'partner']) {
    for (const q of explorerBankForTrack(track)) assert.equal(q.page_target, '/exploring', q.id);
  }
  assert.equal(mapRoleAnswer('I advise founders'), 'advisor');
  assert.equal(mapRoleAnswer('I advisor founders'), 'advisor', 'an answer stored with the old copy still maps');
  assert.equal(mapRoleAnswer('I am building a startup'), 'founder');
  assert.equal(mapRoleAnswer('I invest in startups'), 'investor');
  assert.equal(mapRoleAnswer('I partner with the studio'), 'partner');
  const src = readFileSync(new URL('../src/services/advisor/writeRouter.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\/explorer\/profile/, 'no saved_to names the page that never existed');
});
