/**
 * D1124 (#3004) — the D953 gaps' Worker reads, on real Hono routes and node:sqlite.
 *
 *  1. Refer & Earn's funnel: each referral counts at the furthest stage it
 *     reached, from its status events and its current status; a draft counts
 *     nowhere; More info needed sits with Under review, Reward eligible with
 *     Converted; a rejection keeps the stage it had reached.
 *  2. The Queue: the referrer's role on every admin row and on one referral; a
 *     Referrer role filter; a search over the referred person, their
 *     organisation and the referrer's name or email, bound and literal, in the
 *     page and its total alike; refusals for an unknown role and a long search.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/programs_gaps_d1124.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { freshDb, makeD1, token, ADMIN, FOUNDER, INVESTOR, ADVISOR } from './_perks_harness.ts';
import { ensureAdminAuditLogTable } from '../src/routes/admin.ts';
import refer from '../src/routes/refer_earn.ts';
import { mapError } from '../src/routes/_t13t14t15_helpers.ts';
import { ensureReferralSubmissionsSchema, FUNNEL_STAGES } from '../src/services/referralSubmissions.ts';

async function harness() {
  const db = freshDb();
  db.exec("ALTER TABLE users ADD COLUMN referral_code TEXT; ALTER TABLE users ADD COLUMN legacy_referral_code TEXT; UPDATE users SET referral_code='ref_' || id");
  db.exec(`UPDATE users SET name = 'Ana Founder' WHERE id = ${FOUNDER}; UPDATE users SET name = 'Ivo Investor', email = 'ivo@fund.example' WHERE id = ${INVESTOR}`);
  const env: any = { JWT_SECRET: 'unit-test-jwt-secret-0123456789-abcdef', ENVIRONMENT: 'development', DB: makeD1(db, { beforeBatch: null }) };
  await ensureReferralSubmissionsSchema(env);
  await ensureAdminAuditLogTable(env);
  const app = new Hono().route('/refer', refer);
  app.onError((e, c) => mapError(c as any, e));
  const call = async (path: string, who = ADMIN) => {
    const res = await app.request(path, { headers: { Authorization: `Bearer ${await token(who)}` } }, env);
    return { status: res.status, body: await res.json() as any };
  };
  let n = 0;
  const referral = (status: string, opts: { by?: number; name?: string; org?: string | null; history?: string[] } = {}) => {
    n += 1;
    const uid = `r${n}`;
    db.prepare(`INSERT INTO referral_submissions (uid, referrer_user_id, category, referred_name, referred_org, status, created_at) VALUES (?, ?, 'startup', ?, ?, ?, ?)`)
      .run(uid, opts.by ?? FOUNDER, opts.name ?? `Person ${n}`, opts.org ?? null, status, `2026-10-${String(n).padStart(2, '0')} 12:00:00`);
    const id = (db.prepare('SELECT id FROM referral_submissions WHERE uid = ?').get(uid) as any).id;
    for (const s of opts.history ?? []) db.prepare(`INSERT INTO referral_submission_events (submission_id, label, status) VALUES (?, 'x', ?)`).run(id, s);
    return uid;
  };
  return { db, env, call, referral };
}

const counts = (body: any) => Object.fromEntries(body.stages.map((s: any) => [s.key, s.count]));

test('1. the funnel counts each referral at the furthest stage it reached', async () => {
  const h = await harness();
  try {
    h.referral('draft');                                                                     // never submitted
    h.referral('submitted', { history: ['submitted'] });
    h.referral('more_info_needed', { history: ['submitted'] });                              // under review's level, from its status alone
    h.referral('qualified', { history: ['submitted'] });                                     // skipped Under review
    h.referral('rejected', { history: ['submitted', 'under_review', 'qualified'] });         // keeps Qualified
    h.referral('in_conversation');
    h.referral('reward_eligible', { history: ['submitted', 'qualified', 'in_conversation', 'converted'] });
    h.referral('reward_issued');
    h.referral('closed', { history: ['submitted'] });
    const r = await h.call('/refer/admin/submissions/funnel');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.stages.map((s: any) => [s.key, s.label]), FUNNEL_STAGES.map((s) => [s.key, s.label]));
    assert.deepEqual(counts(r.body), { submitted: 8, under_review: 6, qualified: 5, in_conversation: 3, converted: 2, reward_issued: 1 });
    // Nothing recorded: every stage is a real zero, never missing.
    const empty = await harness();
    try { assert.deepEqual(Object.values(counts((await empty.call('/refer/admin/submissions/funnel')).body)), [0, 0, 0, 0, 0, 0]); }
    finally { empty.db.close(); }
    // An admin read only.
    assert.equal((await h.call('/refer/admin/submissions/funnel', FOUNDER)).status, 403);
  } finally { h.db.close(); }
});

test('2. the Queue: the referrer\'s role, a role filter and a bound search, in the page and its total', async () => {
  const h = await harness();
  try {
    const a = h.referral('submitted', { by: FOUNDER, name: 'Bluefern Health', org: 'Bluefern Labs' });
    const b = h.referral('under_review', { by: INVESTOR, name: 'Harbor Robotics', org: null });
    const c = h.referral('submitted', { by: ADVISOR, name: '100% Pure', org: 'Under_score Co' });
    const page = await h.call('/refer/admin/submissions?offset=0&limit=25');
    const by = Object.fromEntries(page.body.items.map((x: any) => [x.uid, x]));
    assert.equal(by[a].referrer_role, 'founder');
    assert.equal(by[b].referrer_role, 'investor');
    assert.equal((await h.call(`/refer/admin/submissions/${b}`)).body.referrer_role, 'investor', 'one referral carries it too');
    // The role filter, with its total.
    const investors = await h.call('/refer/admin/submissions?role=investor&offset=0');
    assert.deepEqual([investors.body.total, investors.body.items.map((x: any) => x.uid)], [1, [b]]);
    assert.equal((await h.call('/refer/admin/submissions?role=founder&offset=0')).body.total, 1);
    // The search: the referred person, their organisation, the referrer's name or email; case-blind.
    const search = async (q: string) => (await h.call(`/refer/admin/submissions?q=${encodeURIComponent(q)}&offset=0`)).body;
    assert.deepEqual((await search('bluefern')).items.map((x: any) => x.uid), [a]);
    assert.deepEqual((await search('LABS')).items.map((x: any) => x.uid), [a], 'the organisation');
    assert.deepEqual((await search('ivo invest')).items.map((x: any) => x.uid), [b], 'the referrer\'s name');
    assert.deepEqual((await search('fund.example')).items.map((x: any) => x.uid), [b], 'the referrer\'s email');
    assert.equal((await search('nobody')).total, 0);
    // `%` and `_` are literal, never wildcards.
    assert.deepEqual((await search('%')).items.map((x: any) => x.uid), [c]);
    assert.deepEqual((await search('_')).items.map((x: any) => x.uid), [c]);
    // Filters combine, and the total follows them.
    const both = await h.call('/refer/admin/submissions?q=e&role=investor&status=under_review&offset=0');
    assert.deepEqual([both.body.total, both.body.items.map((x: any) => x.uid)], [1, [b]]);
    // Refusals with a code.
    assert.equal((await h.call('/refer/admin/submissions?role=wizard&offset=0')).body.error, 'bad_role');
    assert.equal((await h.call(`/refer/admin/submissions?q=${'x'.repeat(101)}&offset=0`)).body.error, 'bad_search');
    // Without the new parameters, today's shapes are unchanged: the legacy array still answers.
    assert.ok(Array.isArray((await h.call('/refer/admin/submissions')).body));
  } finally { h.db.close(); }
});
