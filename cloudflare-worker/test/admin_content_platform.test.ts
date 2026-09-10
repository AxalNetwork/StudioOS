/**
 * `GET /api/admin/content/summary` and `/api/admin/platform/summary` — H6.
 *
 * WHAT THESE TWO ROUTES ARE ACTUALLY FOR. The artboard's subtitle is "one
 * pipeline replacing three systems", and checking that premise before
 * building is what shaped both endpoints:
 *
 *   - News is NOT a third system. `admin_news.ts` reads the same `articles`
 *     table and already answers with a Deprecation header. A third of the
 *     unification has happened; reporting it as outstanding would be wrong
 *     about the repo's own state.
 *   - The master template library the artboard draws in this zone already
 *     exists at `/admin/contracts`. Two pages over one store drift apart, so
 *     this one points rather than rebuilds.
 *   - Feature flags have no store at all. What is called flags is per-user
 *     settings, which is a preference and not an operator switch.
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
  assert.match(String(r.body.unified_pipeline_reason), /News is no longer a third/);
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

test('localisation is refused, with its own reason', async () => {
  const db = freshDb();
  const r = await call(content, db, SUPER);
  assert.equal(r.body.localisation_available, false);
  assert.match(String(r.body.localisation_reason), /no localisation link/);
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

test('a job is failed, stale or running — three states, not one bucket', async () => {
  const db = freshDb();
  const ins = db.prepare(
    'INSERT INTO cron_run_history (trigger_name, started_at, finished_at, status, error) VALUES (?, ?, ?, ?, ?)',
  );
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 72 * 3600_000).toISOString();
  ins.run('nightly-ok', now, now, 'ok', null);
  ins.run('nightly-broken', now, now, 'error', 'boom');
  ins.run('nightly-silent', old, old, 'ok', null);
  ins.run('nightly-running', now, null, 'started', null);

  const r = await call(platform, db, SUPER);
  const by = Object.fromEntries(r.body.jobs.triggers.map((j: any) => [j.trigger_name, j.state]));
  assert.equal(by['nightly-ok'], 'ok');
  assert.equal(by['nightly-broken'], 'failed');
  assert.equal(by['nightly-silent'], 'stale', 'a trigger that stopped firing reads as healthy');
  assert.equal(by['nightly-running'], 'running', 'an unfinished run reads as a failure');
  assert.equal(r.body.jobs.failing, 1);
  assert.equal(r.body.jobs.stale, 1);
  assert.equal(r.body.jobs.stale_after_hours, 26, 'the staleness window is not stated in the payload');
});

test('flags are refused: per-user settings are not a platform switch', async () => {
  const db = freshDb();
  const r = await call(platform, db, SUPER);
  assert.equal(r.body.flags_available, false);
  assert.match(String(r.body.flags_reason), /no feature-flag store/);
  assert.match(String(r.body.flags_reason), /per-user settings/);
  assert.equal(r.body.flags, undefined, 'a flags list appeared');
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
