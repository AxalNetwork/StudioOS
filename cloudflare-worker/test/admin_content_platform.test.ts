/**
 * `GET /api/admin/content/summary` and `/api/admin/platform/summary` — H6.
 *
 * WHAT THESE TWO ROUTES ARE ACTUALLY FOR. The artboard's subtitle is "one
 * pipeline replacing three systems", and checking that premise before
 * building is what shaped both endpoints:
 *
 *   - News is NOT a third system. The `/api/admin/news` queue read the same
 *     `articles` table behind a Deprecation header, and D166 retired it
 *     outright — it accepted `in_review` at publish, so the approval gate on
 *     `/api/admin/articles` could be walked around by calling it. A third of
 *     the unification is DONE; reporting it as outstanding would be wrong
 *     about the repo's own state.
 *   - The master template library the artboard draws in this zone already
 *     exists at `/admin/contracts`. Two pages over one store drift apart, so
 *     this one points rather than rebuilds.
 *   - Feature flags. This header first said there was no store at all and
 *     that what is called flags is per-user settings; D202 found the second
 *     half false (MI_FLAG_* and DD_FLAG_* are platform switches set at
 *     deploy), and D203 the first — `platform_switches` (migration 283) is an
 *     operator store for the one switch HQ can throw. The switches and the
 *     H17 consoles are held by platform_consoles_d202.test.ts, the store by
 *     operator_switches_d203.test.ts.
 *
 * So most of what follows asserts a figure is ABSENT with its reason, or
 * that a count is computed from the store rather than assumed — the two
 * ways a page like this tells a comfortable lie.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import content from '../src/routes/admin_content.ts';
import platform from '../src/routes/admin_platform.ts';
import {
  CRON_TRIGGERS, STALE_GRACE_MINUTES, leaseHolderValue, recordLeaseHeldFire, writeCronRunHistory,
} from '../src/util/cronHistory.ts';
import { sqlStamp } from '../src/util/cronSchedule.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 801;
const PLAIN_ADMIN = 802;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { return x; },
  };
}

const BASELINE = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8',
);
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

/**
 * `admin_publications` is NOT in the baseline — migration 045 creates it and
 * the route self-creates it too. Taken from the migration verbatim for the
 * same reason every other table here is taken from the baseline verbatim: a
 * harness that invents a schema only confirms its own assumptions.
 */
function publicationsDdl(): string {
  const sql = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/sql/migrations/045_admin_publications.sql'), 'utf8',
  );
  const at = sql.search(/CREATE TABLE (IF NOT EXISTS )?admin_publications \(/);
  assert.ok(at >= 0, 'migration 045 no longer creates admin_publications');
  const end = sql.indexOf(');', at);
  assert.ok(end > at, "the admin_publications definition in migration 045 is unterminated");
  return sql.slice(at, end + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of ['users', 'super_admins', 'articles', 'legal_templates',
                   'legal_template_versions', 'integrations', 'cron_run_history']) {
    db.exec(ddl(t));
  }
  db.exec(publicationsDdl());
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(SUPER, 'admin', 'The Holder', 'holder@example.test');
  u.run(PLAIN_ADMIN, 'admin', 'Plain Admin', 'admin@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  return db;
}

const article = (db: any, slug: string, status: string) => db.prepare(
  `INSERT INTO articles (slug, title, body_markdown, status, author_user_id, updated_at)
   VALUES (?, ?, '', ?, ?, datetime('now'))`,
).run(slug, slug, status, SUPER);

async function call(app: any, db: any, actor: number) {
  const jwt = await new SignJWT({ user_id: actor, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(
    new Request('http://x/summary', { headers: { Authorization: `Bearer ${jwt}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

/* ── Content ─────────────────────────────────────────────────────────── */

test('a plain admin cannot read either HQ summary', async () => {
  const db = freshDb();
  for (const [name, app] of [['content', content], ['platform', platform]] as const) {
    const r = await call(app, db, PLAIN_ADMIN);
    assert.notEqual(r.status, 200, `a plain admin read the ${name} summary`);
  }
});

test('the four lanes count the statuses the articles table actually uses', async () => {
  const db = freshDb();
  article(db, 'a', 'draft');
  article(db, 'b', 'draft');
  article(db, 'c', 'submitted');
  article(db, 'd', 'in_review');
  article(db, 'e', 'changes_requested');
  article(db, 'f', 'approved');
  article(db, 'g', 'published');
  article(db, 'h', 'rejected');

  const r = await call(content, db, SUPER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const lanes = Object.fromEntries(r.body.pipeline.lanes.map((l: any) => [l.key, l.n]));
  assert.equal(lanes.draft, 2);
  assert.equal(lanes.review, 3, 'submitted, in_review and changes_requested are one review lane');
  assert.equal(lanes.scheduled, 1, 'approved is what queues a piece to go out');
  assert.equal(lanes.published, 1);
  // Rejected is not a lane and is not silently folded into one either.
  assert.equal(r.body.pipeline.rejected, 1);
  assert.equal(r.body.pipeline.in_pipeline, 6, 'the pipeline count includes published, which it should not');
});

test('a status no lane names is reported, not dropped', async () => {
  // `articles.status` carries NO check constraint, so a new status can appear
  // without any schema change. Swallowing it would make the lane totals a
  // subset presented as the whole pipeline.
  const db = freshDb();
  article(db, 'a', 'draft');
  article(db, 'b', 'embargoed');
  const r = await call(content, db, SUPER);
  assert.deepEqual(r.body.pipeline.unmapped_statuses, [{ status: 'embargoed', n: 1 }]);
});

test('publications are reported as the SECOND vocabulary, not merged into the first', async () => {
  const db = freshDb();
  article(db, 'a', 'published');
  db.prepare(
    `INSERT INTO admin_publications (slug, title, section, status, created_by)
     VALUES (?, ?, 'ops', ?, ?)`,
  ).run('p1', 'Q3 letter', 'published', SUPER);

  const r = await call(content, db, SUPER);
  assert.equal(r.body.publications.available, true);
  assert.equal(r.body.publications.total, 1);
  assert.equal(r.body.publications.by_status.published, 1);
  // The published article and the published publication are NOT added up.
  const lanes = Object.fromEntries(r.body.pipeline.lanes.map((l: any) => [l.key, l.n]));
  assert.equal(lanes.published, 1, 'a publication was counted as an article');
  assert.equal(r.body.unified_pipeline_available, false);
  assert.match(String(r.body.unified_pipeline_reason), /two stores with two meanings/);
  // And the reason says the part that is already done, or the page misreports
  // the repo's own state as worse than it is.
  //
  // D166 RE-AIMED THIS, and finding it was the point. Two files assert this
  // premise against the same live response STRING — here and
  // frontend/test/hq_content_platform_h6.test.mjs — and a third asserted it
  // by reading routes/admin_news.ts, which the delete made throw ENOENT.
  // Only that third one fails loudly when the router goes. These two keep
  // passing on whatever the sentence happens to say, so had the wording not
  // moved with the delete, the product would have gone on telling operators
  // that a router which no longer exists "already answers with a Deprecation
  // header". The assertion now pins the retirement and explicitly refuses
  // the alias wording, so it cannot drift back.
  assert.match(String(r.body.unified_pipeline_reason), /News is not a third/);
  assert.doesNotMatch(String(r.body.unified_pipeline_reason), /Deprecation header pointing at/,
    'the reason describes admin_news as a live deprecated alias again');
});

test('the template library is pointed at, not rebuilt', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO legal_templates (slug, title) VALUES ('partner-msa', 'Partner MSA')").run();
  const r = await call(content, db, SUPER);
  assert.equal(r.body.templates.available, true);
  assert.equal(r.body.templates.templates, 1);
  assert.equal(r.body.templates.owned_by, '/admin/contracts',
    'the summary does not say which page owns the library');
});

test('localisation is counted from what branches send, and the reason names what still is not recorded', async () => {
  // NARROWED IN D112, NOT LIFTED. The refusal used to cover three absences —
  // no localisation link, no brand-approval state, no per-subsidiary
  // attribution. Two of them acquired a store (a content escalation carries
  // its branch code and takes a decision), so this assertion moved with the
  // sentence rather than being deleted.
  //
  // RE-AIMED IN D275, NOT RELAXED. The third acquired a store too: a content
  // escalation that names an item records whether it localises it (migration
  // 296), and the board's Localisation lane counts that. So the payload says
  // localisation is available — and the reason, which stays, must name the two
  // things that are still not recorded rather than the link that now is.
  const db = freshDb();
  const r = await call(content, db, SUPER);
  assert.equal(r.body.localisation_available, true);
  const reason = String(r.body.localisation_reason);
  assert.match(reason, /localisation of another/,
    'the reason stopped saying a pre-296 row is never counted as a localisation');
  assert.match(reason, /raised before that was recorded/,
    'the reason no longer says rows older than the relation are not recorded');
  assert.match(reason, /localises in its own database without sending it to HQ/,
    'the reason no longer says a branch-local localisation is invisible here');
  assert.doesNotMatch(reason, /What is still not recorded is the RELATION/,
    'the reason still says the relation is not recorded, which D275 made false');
  assert.doesNotMatch(String(r.body.localisation_reason), /no brand-approval state/,
    'the reason still claims there is no brand-approval state, which D112 made false');
  assert.equal(r.body.localisation_lane_endpoint, '/api/admin/escalations?kind=content',
    'the summary does not point at the lane that closed the other two absences');
  assert.equal(r.body.localised, undefined, 'a localisation count appeared');
  assert.equal(r.body.derived_metrics_available, false, 'per-subsidiary content is not U1-gated');
});

test('one unreadable content store does not take the others down', async () => {
  const db = freshDb();
  db.exec('DROP TABLE admin_publications');
  article(db, 'a', 'draft');
  const r = await call(content, db, SUPER);
  assert.equal(r.status, 200, 'one missing table took the whole payload down');
  assert.equal(r.body.publications.available, false);
  assert.match(String(r.body.publications.reason), /could not be read/);
  assert.equal(r.body.pipeline.available, true, 'a readable zone was dragged down with the unreadable one');
});

/* ── Platform ────────────────────────────────────────────────────────── */

test('integrations are grouped by provider and state, and no secret is read', async () => {
  const db = freshDb();
  const ins = db.prepare(
    `INSERT INTO integrations (uid, user_id, provider_key, status, auth_type)
     VALUES (?, ?, ?, ?, 'api_key')`,
  );
  // A DIFFERENT USER for the second slack row: `integrations` carries
  // UNIQUE(user_id, provider_key), so one account holds at most one
  // connection per provider. The first version of this fixture gave SUPER
  // two slack rows and the constraint refused them — which is the reason
  // the DDL is lifted verbatim rather than hand-written.
  ins.run('u1', SUPER, 'slack', 'active');
  ins.run('u2', PLAIN_ADMIN, 'slack', 'error');
  ins.run('u3', SUPER, 'telegram', 'active');

  const r = await call(platform, db, SUPER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.integrations.total, 3);
  assert.equal(r.body.integrations.unhealthy, 1, 'an errored connection is not counted as unhealthy');
  const slack = r.body.integrations.providers.find((p: any) => p.provider === 'slack');
  assert.deepEqual(slack.by_status, { active: 1, error: 1 });

  // THE ONE THAT MATTERS. A summary endpoint must not carry key material,
  // and must say so, so nobody adds a reveal to it later.
  assert.equal(r.body.integrations.secrets_included, false);
  const flat = JSON.stringify(r.body);
  for (const leak of ['access_token', 'refresh_token', 'api_key', 'secret_', 'credential']) {
    assert.ok(!flat.includes(leak), `the payload carries a ${leak} field`);
  }
});

test('each DECLARED trigger is read against its own schedule, from rows the writers wrote', async () => {
  // D201 — RE-AIMED. This test used to insert ISO strings under invented
  // trigger names and assert a 26-hour window. ISO is not the format the
  // writer stores, so the test agreed with the bug it should have caught: on
  // the same date ' ' sorts before 'T', and a fresh daily run read as stale.
  // Rows now come from the production writers themselves, under the declared
  // expressions, so the format under test is the format that ships.
  const db = freshDb();
  const env = { DB: makeD1(db) } as any;
  const now = Date.now();
  const ago = (min: number) => sqlStamp(now - min * 60_000);
  await writeCronRunHistory(env, { triggerName: '* * * * *', startedAt: ago(2), cronError: null, summary: [] });
  await writeCronRunHistory(env, { triggerName: '0 3 * * *', startedAt: ago(0), cronError: 'boom', summary: [] });
  await writeCronRunHistory(env, { triggerName: '0 */6 * * *', startedAt: ago(8 * 24 * 60), cronError: null, summary: [] });
  // '0 4 * * *' has no row at all.
  await recordLeaseHeldFire(env, {
    triggerName: '0 9 * * *', scheduledTime: now, holder: leaseHolderValue('a', now, '* * * * *'),
  });
  await recordLeaseHeldFire(env, {
    triggerName: '0 9 * * 2', scheduledTime: now, holder: leaseHolderValue('b', now - 60_000, '* * * * *'),
  });
  // A name no deployment declares is not a job HQ runs, however recent.
  await writeCronRunHistory(env, { triggerName: 'nightly-legacy', startedAt: ago(0), cronError: null, summary: [] });

  const r = await call(platform, db, SUPER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const jobs = r.body.jobs;
  assert.deepEqual(jobs.triggers.map((j: any) => j.trigger_name), CRON_TRIGGERS.map((t) => t.expr),
    'the list is not the declared triggers, in their declared order');
  const by = Object.fromEntries(jobs.triggers.map((j: any) => [j.trigger_name, j]));
  assert.equal(by['* * * * *'].state, 'ok');
  assert.equal(by['* * * * *'].name, 'scheduled', 'the display name is missing');
  assert.equal(by['0 3 * * *'].state, 'failed');
  assert.equal(by['0 3 * * *'].error, 'boom');
  assert.equal(by['0 */6 * * *'].state, 'stale', 'a trigger that stopped firing reads as healthy');
  assert.equal(by['0 4 * * *'].state, 'never', 'a trigger with no row at all is not reported as such');
  assert.equal(by['0 4 * * *'].last_started_at, null);
  assert.equal(by['0 9 * * *'].state, 'ok', 'a minute run by the concurrent tick read as a failure');
  assert.equal(by['0 9 * * *'].status, 'deduped');
  assert.equal(by['0 9 * * 2'].state, 'failed', 'a minute that ran nowhere read as healthy');
  assert.match(String(by['0 9 * * 2'].error), /this tick ran nothing/);
  for (const j of jobs.triggers) {
    assert.match(String(j.expected_at), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/, `${j.trigger_name} has no expected time`);
  }
  assert.ok(!by['nightly-legacy'], 'an undeclared trigger name was listed as a job');
  assert.equal(jobs.failing, 2);
  assert.equal(jobs.stale, 1);
  assert.equal(jobs.never, 1);
  assert.equal(jobs.grace_minutes, STALE_GRACE_MINUTES, 'the grace is not stated in the payload');
  assert.equal(jobs.stale_after_hours, undefined, 'the one-window-for-every-cadence figure came back');
});

test('flags are no longer refused: the switches carry the operator store (D203)', async () => {
  // This test pinned `flags_available: false` and a reason saying no store
  // existed. D203 built one and retired the pair; per-user settings still are
  // not a platform switch, and nothing here turns one into a flag.
  const db = freshDb();
  const r = await call(platform, db, SUPER);
  assert.equal(r.status, 200);
  assert.equal(r.body.flags_available, undefined, 'the retired flags pair came back');
  assert.equal(r.body.flags_reason, undefined, 'the retired flags pair came back');
  assert.equal(r.body.flags, undefined, 'a flags list appeared');
  // THIS FIXTURE HAS NO `platform_switches`, which is what a database that has
  // not applied 283 looks like — so the switch the store backs reads
  // unreadable with the store's own reason, never "off".
  const eadwyn = r.body.switches.items.find((sw: any) => sw.key === 'eadwyn_off');
  assert.ok(eadwyn, 'the Eadwyn switch is not listed');
  assert.equal(eadwyn.state, 'unreadable', 'an uncreated store read as a switch nobody threw');
  assert.equal(eadwyn.operator.available, false);
  assert.match(String(eadwyn.operator.reason), /has not been created on this database yet/);
});

test('an unreadable platform store says so and leaves the other alone', async () => {
  const db = freshDb();
  db.exec('DROP TABLE cron_run_history');
  const r = await call(platform, db, SUPER);
  assert.equal(r.status, 200);
  assert.equal(r.body.jobs.available, false);
  assert.match(String(r.body.jobs.reason), /could not be read/);
  assert.equal(r.body.jobs.failing, undefined, 'an unreadable job history reported zero failures');
  assert.equal(r.body.integrations.available, true);
});
