/**
 * The founder draft surfaces, and the one thing standing between them.
 *
 * `POST /api/research/drafts` authorises on `requireAuth` ALONE. Which surface
 * you may draft over, and whose records it may read, is delegated entirely to
 * that surface's own `gather` — which is what makes the mechanism role-agnostic
 * and shareable between a partner and a founder, and what makes a gather that
 * forgets to scope a cross-account read rather than a bug on one page. The
 * twenty-two partner surfaces scope on `users.partner_id`; these scope on a
 * PROJECT, and the `scope_key` naming that project comes straight off the wire.
 *
 * SO THE PROPERTY UNDER TEST IS SIMPLE AND WORTH TESTING BY EXECUTION rather
 * than by reading the source: a founder who asks to draft over a project id
 * that is not theirs gets nothing. Not a filtered draft, not an empty one —
 * the same 409 as a founder with no records at all, because the route cannot
 * tell those apart and must not.
 *
 * THE MODEL IS A STUB THAT KEEPS ITS PROMPT, which makes the gathered material
 * observable. `nothing_to_draft` (409) is returned BEFORE the model is called,
 * so a refusal is a 409 with no prompt at all and a draft is a 201 whose
 * prompt is exactly what the surface decided to hand over — which is the thing
 * worth asserting, since every rule these gathers carry ("never name an owner",
 * "one snapshot is not a movement") only reaches the model through that text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import research from '../src/routes/research.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const MINE = { user: 70, founder_id: 170 };     // our founder
const THEIRS = { user: 71, founder_id: 171 };   // a different founder entirely
const SOLO = { user: 72, founder_id: 172 };     // a founder with two startups
const MY_PROJECT = 900;
const THEIR_PROJECT = 901;
const SOLO_A = 902;
const SOLO_B = 903;

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

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  // Verbatim shapes: `founders`/`projects` from sql/schema_baseline.sql,
  // `roadmap_okrs` from sql/migrations/001_progress_tables.sql, `mvp_tasks`
  // from the baseline, and `project_metrics` from migration 249.
  //
  // THAT LAST ONE USED TO BE THE BUG, AND ITS OWN COMMENT SAID SO. It read
  // "`project_metrics` in the shape `ensureMetricsSnapshotsSchema` creates
  // (project_id, not the baseline dump's historical deal_id)" — calling the
  // production shape "historical" and building the one production has never had.
  // So this harness created a `project_metrics` with `project_id`, the route
  // under test wrote to it happily, and the same route threw `no such column:
  // project_id` against the real database. A fixture that is a schema production
  // does not have is how a test passes over a broken feature, which is the rule
  // `partner_pipeline_stores.test.ts` states and the reason migration 249 exists.
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    -- The founders table has NO user_id: the account behind a founder record
    -- is found through users.founder_id. An earlier version of this harness
    -- invented the column, which let a query naming it pass here and fail
    -- against the canonical schema (see schema_guards).
    -- No backticks in here: this comment sits inside a JS template literal.
    CREATE TABLE founders (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, email TEXT);
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT
    );
    CREATE TABLE roadmap_okrs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, objective TEXT NOT NULL,
      key_results_json TEXT, kanban_status TEXT NOT NULL DEFAULT 'now', quarter TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE mvp_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL, title TEXT NOT NULL,
      description TEXT, assigned_to INTEGER, status TEXT NOT NULL DEFAULT 'todo',
      ai_generated INTEGER DEFAULT 0, due_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE project_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, snapshot_date TEXT NOT NULL,
      mrr REAL, arr REAL, cac REAL, ltv REAL, monthly_churn_pct REAL,
      active_users INTEGER, new_users INTEGER, net_burn REAL, cash_balance REAL,
      headcount INTEGER, nrr_pct REAL, paying_accounts INTEGER,
      notes TEXT, source TEXT, created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE raise_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL,
      name TEXT, target_amount REAL, close_date TEXT, status TEXT NOT NULL DEFAULT 'active',
      notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), pro_rata_reserved REAL, pre_money REAL
    );
    CREATE TABLE raise_prospects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL,
      contact_id INTEGER, name TEXT, email TEXT, firm TEXT,
      stage TEXT NOT NULL DEFAULT 'to_contact', notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      amount REAL, close_id INTEGER, commit_status TEXT, instrument TEXT
    );
    CREATE TABLE cap_table_scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, owner_user_id INTEGER NOT NULL,
      project_id INTEGER, name TEXT NOT NULL, inputs_json TEXT NOT NULL, result_json TEXT,
      computed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), is_variant INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL, project_id INTEGER,
      title TEXT NOT NULL, doc_type TEXT NOT NULL DEFAULT 'other',
      status TEXT NOT NULL DEFAULT 'draft', content TEXT, template_name TEXT,
      signed_by TEXT, signed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE data_room_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL,
      name TEXT NOT NULL, parent_id INTEGER, visibility TEXT NOT NULL DEFAULT 'open',
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE data_room_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL,
      folder_id INTEGER, name TEXT NOT NULL, r2_key TEXT NOT NULL, content_type TEXT,
      size_bytes INTEGER, visibility TEXT NOT NULL DEFAULT 'open', uploaded_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE data_room_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL,
      investor_user_id INTEGER NOT NULL, granted_by_user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE data_room_access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, file_id INTEGER,
      user_id INTEGER NOT NULL, action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE waitlist_signups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, landing_page_id INTEGER,
      email TEXT NOT NULL, name TEXT, source TEXT, ip_hash TEXT,
      created_at TEXT DEFAULT (datetime('now')), audience TEXT,
      crm_status TEXT DEFAULT 'new', invited_at TEXT, followed_up_at TEXT,
      promoted_at TEXT, promoted_interview_id INTEGER
    );
    CREATE TABLE pain_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, title TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE pain_group_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, group_id INTEGER NOT NULL,
      phrase_norm TEXT NOT NULL, display_phrase TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE job_postings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, host_user_id INTEGER,
      project_id INTEGER, title TEXT NOT NULL, employment_type TEXT NOT NULL DEFAULT 'full_time',
      location_text TEXT, remote INTEGER NOT NULL DEFAULT 0, seniority TEXT NOT NULL DEFAULT 'mid',
      summary TEXT, description TEXT, status TEXT NOT NULL DEFAULT 'draft',
      admin_published INTEGER NOT NULL DEFAULT 0, review_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE job_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, posting_id INTEGER NOT NULL, user_id INTEGER,
      name TEXT, email TEXT NOT NULL, cover_note TEXT, linkedin_url TEXT, portfolio_url TEXT,
      resume_key TEXT, resume_name TEXT, status TEXT NOT NULL DEFAULT 'submitted',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE research_zone_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      owner_user_id INTEGER NOT NULL, surface TEXT NOT NULL, scope_key TEXT,
      body TEXT NOT NULL, model TEXT, cost_micro_usd INTEGER NOT NULL DEFAULT 0,
      accepted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  for (const who of [MINE, THEIRS, SOLO]) {
    db.prepare('INSERT INTO users (id, role, founder_id) VALUES (?, ?, ?)').run(who.user, 'founder', who.founder_id);
    db.prepare('INSERT INTO founders (id, name) VALUES (?, ?)').run(who.founder_id, `Founder ${who.user}`);
  }
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(MY_PROJECT, 'Mine', MINE.founder_id);
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(THEIR_PROJECT, 'Theirs', THEIRS.founder_id);
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(SOLO_A, 'One', SOLO.founder_id);
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(SOLO_B, 'Two', SOLO.founder_id);

  // Every founder surface has something to gather on EVERY project, so a 409
  // in any test below is the ownership check and never a thin fixture.
  for (const pid of [MY_PROJECT, THEIR_PROJECT, SOLO_A, SOLO_B]) {
    db.prepare(`INSERT INTO roadmap_okrs (project_id, objective, key_results_json, kanban_status, quarter)
                VALUES (?, ?, ?, 'now', 'Q3 2026')`)
      .run(pid, `Objective for ${pid}`, JSON.stringify([{ text: 'Ship it', current: 1, target: 4, unit: '' }]));
    db.prepare('INSERT INTO mvp_tasks (deal_id, title, status) VALUES (?, ?, ?)').run(pid, `Card for ${pid}`, 'todo');
    db.prepare('INSERT INTO project_metrics (project_id, snapshot_date, mrr) VALUES (?, ?, ?)')
      .run(pid, '2026-09-01', 4200);
    db.prepare(`INSERT INTO raise_rounds (uid, project_id, name, target_amount, pre_money, status)
                VALUES (?, ?, ?, 1500000, 12000000, 'active')`).run(`r${pid}`, pid, `Round for ${pid}`);
    db.prepare(`INSERT INTO raise_prospects (uid, project_id, name, firm, stage, amount, commit_status)
                VALUES (?, ?, ?, ?, 'committed', 250000, 'signed')`)
      .run(`p${pid}`, pid, `Prospect for ${pid}`, `Firm ${pid}`);
    db.prepare(`INSERT INTO cap_table_scenarios (uid, owner_user_id, project_id, name, inputs_json, result_json, is_variant)
                VALUES (?, 0, ?, ?, ?, ?, 0)`)
      .run(`s${pid}`, pid, `Scenario for ${pid}`, '{"founders":89.5}', '{"post":66.1}');
    db.prepare(`INSERT INTO documents (uid, project_id, title, doc_type, status, content)
                VALUES (?, ?, ?, 'term_sheet', 'draft', ?)`)
      .run(`d${pid}`, pid, `Term sheet for ${pid}`, `Clause body for ${pid}`);
    db.prepare(`INSERT INTO data_room_folders (uid, project_id, name, visibility)
                VALUES (?, ?, ?, 'open')`).run(`rf${pid}`, pid, `Folder for ${pid}`);
    db.prepare(`INSERT INTO data_room_files (uid, project_id, name, r2_key, visibility)
                VALUES (?, ?, ?, 'k', 'open')`).run(`rx${pid}`, pid, `File for ${pid}`);
    db.prepare(`INSERT INTO data_room_grants (uid, project_id, investor_user_id, granted_by_user_id, status)
                VALUES (?, ?, 99, 1, 'active')`).run(`rg${pid}`, pid);
    db.prepare(`INSERT INTO waitlist_signups (project_id, email, name, source, crm_status)
                VALUES (?, ?, ?, ?, 'invited')`)
      .run(pid, `signup${pid}@example.test`, `Signup for ${pid}`, `Source for ${pid}`);
    db.prepare('INSERT INTO pain_groups (id, project_id, title) VALUES (?, ?, ?)')
      .run(pid, pid, `Pain for ${pid}`);
    db.prepare(`INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase)
                VALUES (?, ?, ?, ?)`).run(pid, pid, `phrase${pid}`, `Phrase for ${pid}`);
    db.prepare(`INSERT INTO job_postings (id, slug, project_id, title, seniority, status)
                VALUES (?, ?, ?, ?, 'senior', 'published')`)
      .run(pid, `slug-${pid}`, pid, `Role for ${pid}`);
    db.prepare(`INSERT INTO job_applications (posting_id, name, email, cover_note, resume_key)
                VALUES (?, ?, ?, ?, 'k')`)
      .run(pid, `Applicant for ${pid}`, `applicant${pid}@example.test`, `Cover note for ${pid}`);
  }
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/**
 * POST /drafts as `who`, returning the status and the prompt the model saw.
 *
 * `prompt` is null when the route never reached the model — which is the only
 * outcome a refusal may have.
 */
async function draft(
  db: any, who: { user: number }, surface: string, scopeKey?: string, page?: unknown,
): Promise<{ status: number; prompt: string | null }> {
  let prompt: string | null = null;
  const AI = {
    run: async (_model: string, payload: any) => {
      const messages = payload?.messages || [];
      prompt = String(messages[messages.length - 1]?.content ?? '');
      return { response: 'a drafted paragraph' };
    },
  };
  const res = await research.fetch(
    new Request('http://x/drafts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await token(who.user, 'founder')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        surface,
        ...(scopeKey === undefined ? {} : { scope_key: scopeKey }),
        ...(page === undefined ? {} : { page }),
      }),
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), AI } as any,
  );
  return { status: res.status, prompt };
}
/** The status alone, for the many cases where only the refusal matters. */
const statusOf = async (...a: Parameters<typeof draft>) => (await draft(...a)).status;

const SURFACES = [
  'build/this-week', 'build/roadmap', 'build/kpi', 'build/retro',
  'raise/capital', 'raise/legal', 'raise/data-room', 'raise/liquidity',
  'grow/customers', 'grow/talent',
];

for (const surface of SURFACES) {
  test(`${surface} drafts over the caller's own project, and only that one`, async () => {
    const db = freshDb();
    const { status, prompt } = await draft(db, MINE, surface, String(MY_PROJECT));
    assert.equal(status, 201);
    assert.ok(prompt, 'the model was never reached');
    // The material is the caller's own project and nobody else's. Both
    // projects carry records with their own id in the text, so a gather that
    // read the wrong rows — or all of them — shows up here rather than in a
    // count that happens to match.
    assert.ok(String(prompt).includes(String(MY_PROJECT)) || surface === 'build/kpi',
      `${surface} handed over no material from the caller's own project`);
    // Every fixture row names its own project id, so a gather that read every
    // project's rows — the shape a dropped WHERE produces — shows up as another
    // founder's id in the text rather than as a count that happens to match.
    assert.ok(!String(prompt).includes(String(THEIR_PROJECT)),
      `${surface} handed another founder's records to the model`);
  });

  test(`${surface} refuses a project the caller does not own`, async () => {
    const db = freshDb();
    // The project exists, has records, and is not theirs. Identical to the
    // empty case from the outside, which is the point.
    const { status, prompt } = await draft(db, MINE, surface, String(THEIR_PROJECT));
    assert.equal(status, 409);
    assert.equal(prompt, null, 'a refused draft still reached the model');
  });

  test(`${surface} refuses a scope key that is not a project at all`, async () => {
    const db = freshDb();
    for (const junk of ['0', '-1', 'null', "1 OR 1=1", '999999']) {
      assert.equal(await statusOf(db, MINE, surface, junk), 409, `scope_key ${junk} was not refused`);
    }
  });

  test(`${surface} picks a lone project when no scope key is sent`, async () => {
    const db = freshDb();
    assert.equal(await statusOf(db, MINE, surface), 201);
  });

  test(`${surface} refuses to guess between two of the caller's projects`, async () => {
    // A draft written about the wrong startup is worse than no draft, so an
    // ambiguous request gets nothing rather than whichever sorted first.
    const db = freshDb();
    assert.equal(await statusOf(db, SOLO, surface), 409);
    // Naming one resolves it, and to that one.
    const { status, prompt } = await draft(db, SOLO, surface, String(SOLO_B));
    assert.equal(status, 201);
    assert.ok(!String(prompt).includes(String(SOLO_A)),
      'naming one startup handed over the other one too');
  });
}

test('a deleted project is not the caller’s project', async () => {
  const db = freshDb();
  db.prepare('UPDATE projects SET deleted_at = ? WHERE id = ?').run('2026-09-01T00:00:00Z', MY_PROJECT);
  for (const surface of SURFACES) {
    assert.equal(await statusOf(db, MINE, surface, String(MY_PROJECT)), 409, `${surface} drafted over a deleted project`);
  }
});

test('build/kpi says so rather than treating one snapshot as a movement', async () => {
  // Two snapshots is the minimum for "burn jumped 31%" to mean anything. With
  // one there is no movement, and the gather has to tell the model that in
  // words — a single figure silently presented as a comparison is how an
  // invented change reaches an investor update.
  const db = freshDb();
  const one = await draft(db, MINE, 'build/kpi', String(MY_PROJECT));
  assert.equal(one.status, 201);
  assert.match(String(one.prompt), /ONLY ONE SNAPSHOT EXISTS/,
    'a lone snapshot went to the model with nothing saying it is not a movement');

  db.prepare('INSERT INTO project_metrics (project_id, snapshot_date, mrr) VALUES (?, ?, ?)')
    .run(MY_PROJECT, '2026-08-01', 3000);
  const two = await draft(db, MINE, 'build/kpi', String(MY_PROJECT));
  assert.doesNotMatch(String(two.prompt), /ONLY ONE SNAPSHOT EXISTS/,
    'the single-snapshot warning survived a second snapshot');
  assert.match(String(two.prompt), /2026-09-01[\s\S]*2026-08-01/,
    'the two snapshots reach the model newest first, so "moved" has a direction');

  db.prepare('DELETE FROM project_metrics WHERE project_id = ?').run(MY_PROJECT);
  assert.equal(await statusOf(db, MINE, 'build/kpi', String(MY_PROJECT)), 409,
    'with no snapshot at all there is nothing to draft');
});

test('build/this-week hands over no owner and no status to invent one from', async () => {
  // The artboard's own fixture is "+ Ship async digest v1 · Amara", and an
  // owner is exactly what a model handed a Monday plan will supply. Neither is
  // recorded, so neither may be in the material OR implied by the instruction.
  const db = freshDb();
  db.prepare('UPDATE mvp_tasks SET assigned_to = ? WHERE deal_id = ?').run(99, MY_PROJECT);
  const { prompt } = await draft(db, MINE, 'build/this-week', String(MY_PROJECT));
  assert.ok(prompt, 'the model was never reached');
  assert.doesNotMatch(String(prompt), /assigned|owner:|\bwho\b/i,
    'an owner reached the model from a column the product does not show');
  assert.match(String(prompt), /Never name an owner and never call a commitment on track or at risk/,
    'the instruction no longer forbids the two fields nothing records');
});

test('raise/liquidity tells the model no preference term is recorded', async () => {
  // A model asked about exits will supply a preference stack, a participation
  // multiple and a comparable outcome. None of the three is recorded for any
  // company in this product, so the absence has to be IN the material — an
  // instruction alone leaves the model reasoning over a silent gap.
  const db = freshDb();
  const { prompt } = await draft(db, MINE, 'raise/liquidity', String(MY_PROJECT));
  assert.match(String(prompt), /NO LIQUIDATION PREFERENCE, PARTICIPATION RIGHT OR EXIT MODEL IS RECORDED/);

  // And with no cap table there is no ownership to pay out at all.
  db.prepare('DELETE FROM cap_table_scenarios WHERE project_id = ?').run(MY_PROJECT);
  assert.equal(await statusOf(db, MINE, 'raise/liquidity', String(MY_PROJECT)), 409);
});

test('raise/legal reads the document body, not just its title', async () => {
  // A clause read from a title is a guess about a document. The body is the
  // material — and a document with a record but no text says so, rather than
  // letting the model treat the title as the terms.
  const db = freshDb();
  const { prompt } = await draft(db, MINE, 'raise/legal', String(MY_PROJECT));
  assert.match(String(prompt), new RegExp(`Clause body for ${MY_PROJECT}`));
  db.prepare('UPDATE documents SET content = NULL WHERE project_id = ?').run(MY_PROJECT);
  const empty = await draft(db, MINE, 'raise/legal', String(MY_PROJECT));
  assert.match(String(empty.prompt), /NO TEXT STORED/);
});

test('grow/talent never hands an applicant email to the model', async () => {
  // The material is what a founder can check for themselves: a name, what the
  // applicant wrote, and which attachments exist. An email address identifies a
  // real person to a third-party model and adds nothing a ranking can use, so
  // it is not in the SELECT at all — a rule that only holds while nobody
  // widens the query to `SELECT *`.
  const db = freshDb();
  const { prompt } = await draft(db, MINE, 'grow/talent', String(MY_PROJECT));
  assert.match(String(prompt), new RegExp(`Applicant for ${MY_PROJECT}`), 'the applicant is not in the material');
  assert.match(String(prompt), new RegExp(`Cover note for ${MY_PROJECT}`), 'what they wrote is not in the material');
  assert.doesNotMatch(String(prompt), /@example\.test/, 'an applicant email reached the model');
  // A draft posting has no live applicants to rank.
  db.prepare("UPDATE job_postings SET status = 'draft' WHERE project_id = ?").run(MY_PROJECT);
  assert.equal(await statusOf(db, MINE, 'grow/talent', String(MY_PROJECT)), 409);
});

test('grow/customers carries the founder’s own pains, or says there are none', async () => {
  // "Opens on the handoff-opacity pain THEIR OWN SEGMENT NAMED" is the whole
  // reason this band is worth its tokens. Without the pains in the material a
  // model writes a generic cold email and the band is a worse version of a
  // template.
  const db = freshDb();
  const withPain = await draft(db, MINE, 'grow/customers', String(MY_PROJECT));
  assert.match(String(withPain.prompt), new RegExp(`Pain for ${MY_PROJECT}`));
  assert.doesNotMatch(String(withPain.prompt), /NO PAIN IS RECORDED/);

  db.prepare('DELETE FROM pain_groups WHERE project_id = ?').run(MY_PROJECT);
  const without = await draft(db, MINE, 'grow/customers', String(MY_PROJECT));
  assert.match(String(without.prompt), /NO PAIN IS RECORDED for this startup/,
    'with no pain map the model is left to invent an opener');

  // And with no signups there is nobody to write to.
  db.prepare('DELETE FROM waitlist_signups WHERE project_id = ?').run(MY_PROJECT);
  assert.equal(await statusOf(db, MINE, 'grow/customers', String(MY_PROJECT)), 409);
});

test('a gather never reads a record belonging to another founder', async () => {
  // The whole property in one place: every founder surface, one founder, one
  // pass over what the model saw.
  const db = freshDb();
  for (const surface of SURFACES) {
    const { prompt } = await draft(db, MINE, surface, String(MY_PROJECT));
    for (const foreign of [THEIR_PROJECT, SOLO_A, SOLO_B]) {
      assert.ok(!String(prompt).includes(`for ${foreign}`) && !String(prompt).includes(`Objective for ${foreign}`),
        `${surface} handed the model a record from project ${foreign}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * D510 — the Friday retro, and every run recorded against its page
 * ------------------------------------------------------------------ */

/**
 * A card with its clock set. `created`, `updated` and `due` are SQLite
 * modifiers on 'now' (`'-12 days'`), so the week boundary is measured from
 * the same clock the gather reads, with days of margin either side of it.
 */
function card(
  db: any, pid: number, title: string, status: string,
  when: { created: string; updated: string; due?: string },
) {
  db.prepare(
    `INSERT INTO mvp_tasks (deal_id, title, status, created_at, updated_at, due_date)
     VALUES (?, ?, ?, datetime('now', ?), datetime('now', ?), CASE WHEN ? IS NULL THEN NULL ELSE date('now', ?) END)`,
  ).run(pid, title, status, when.created, when.updated, when.due ?? null, when.due ?? null);
}

test('D510: build/retro reads the week off the board, and only what the board records', async () => {
  const db = freshDb();
  // The fixture's own card was created and touched just now.
  card(db, MY_PROJECT, 'Shipped card', 'done', { created: '-30 days', updated: '-2 days' });
  card(db, MY_PROJECT, 'Quiet card', 'in_progress', { created: '-40 days', updated: '-20 days', due: '+10 days' });
  card(db, MY_PROJECT, 'Late card', 'todo', { created: '-40 days', updated: '-12 days', due: '-3 days' });
  card(db, MY_PROJECT, 'Done late card', 'done', { created: '-40 days', updated: '-15 days', due: '-5 days' });
  // Another founder's late card: the past-due read is its own statement, and
  // the fixture's cards carry no due date, so only this proves it is scoped.
  card(db, THEIR_PROJECT, 'Their late card', 'todo', { created: '-40 days', updated: '-12 days', due: '-3 days' });

  const { status, prompt } = await draft(db, MINE, 'build/retro', String(MY_PROJECT));
  assert.equal(status, 201);
  const p = String(prompt);
  assert.match(p, /The board holds 5 cards: 2 done, 1 in progress, 2 todo\./, 'the board count is not this board');
  assert.match(p, new RegExp(`Touched this week: Card for ${MY_PROJECT} — now todo; added this week;`));
  assert.match(p, /Touched this week: Shipped card — now done; added \d{4}-\d{2}-\d{2}; last touched \d{4}-\d{2}-\d{2}; no due date recorded/);
  assert.doesNotMatch(p, /Touched this week: (Quiet card|Late card|Done late card)/,
    'a card untouched for over a week was read as this week');
  assert.match(p, /Past due and still open: Late card — todo; was due \d{4}-\d{2}-\d{2}; last touched/);
  assert.doesNotMatch(p, /Past due and still open: (Done late card|Quiet card|Shipped card)/,
    'a finished card, or one not yet due, was called late');
  assert.doesNotMatch(p, /Their late card/, 'another founder’s card reached the model');
  // What the board does not record reaches the model as a fact, and the
  // instruction forbids the counts the canvas's fixture makes from it.
  assert.match(p, /NO MOVE HISTORY IS STORED/);
  assert.match(p, /never say how many times a card moved, slipped or carried over, and never say when a card was finished/);
  assert.match(p, /Never name an owner, give a cause or state a decision/);
});

test('D510: a capped list says how many it left out, and never reads as complete', async () => {
  // Raised in review on PR 1033: the past-due read stops at 20 while the
  // instruction said "name every open card that is past its due date", so a
  // board with more would have reached the model as a complete list. Each
  // read now counts its whole match, and the material says what was cut.
  const db = freshDb();
  for (let i = 0; i < 21; i++) {
    card(db, MY_PROJECT, `Overdue ${i}`, 'todo', { created: '-40 days', updated: '-12 days', due: `-${i + 2} days` });
  }
  const one = String((await draft(db, MINE, 'build/retro', String(MY_PROJECT))).prompt);
  assert.equal((one.match(/Past due and still open:/g) || []).length, 20);
  assert.match(one, /1 more open card is past its due date and not listed here: only the 20 longest overdue are\./);
  // The cut is the least overdue: the longest overdue are the ones listed.
  assert.match(one, /Past due and still open: Overdue 20 — /);
  assert.doesNotMatch(one, /Past due and still open: Overdue 0 — /);

  card(db, MY_PROJECT, 'Overdue 21', 'todo', { created: '-40 days', updated: '-12 days', due: '-23 days' });
  card(db, MY_PROJECT, 'Overdue 22', 'todo', { created: '-40 days', updated: '-12 days', due: '-24 days' });
  for (let i = 0; i < 44; i++) {
    card(db, MY_PROJECT, `Busy ${i}`, 'in_progress', { created: '-30 days', updated: '-1 days' });
  }
  const many = String((await draft(db, MINE, 'build/retro', String(MY_PROJECT))).prompt);
  assert.match(many, /3 more open cards are past their due date and not listed here: only the 20 longest overdue are\./);
  // The fixture's own card and 44 more were touched this week: 45, 40 listed.
  assert.equal((many.match(/Touched this week:/g) || []).length, 40);
  assert.match(many, /5 more cards were touched this week and are not listed here: only the 40 most recently touched are\./);
  assert.match(many, /Where the material says more cards are not listed, say how many, and never present a list as complete when it is not\./);

  // Within the caps nothing claims a cut.
  const few = String((await draft(freshDb(), MINE, 'build/retro', String(MY_PROJECT))).prompt);
  assert.doesNotMatch(few, /not listed here/);
});

test('D510: a card touched an hour before the week, written as ISO, is outside it', async () => {
  // D124/D125: SQLite compares TEXT, and on one date an ISO string sorts above
  // a space-separated one ('T' beats ' '), so a bare `updated_at >=` would
  // count this card as this week's. Every writer of `mvp_tasks.updated_at`
  // emits SQL format today; the wrap is what keeps the window right if one
  // ever does not. (In the first hour after UTC midnight the two sides fall on
  // different dates and a bare compare happens to agree, so this guards the
  // other twenty-three.)
  const db = freshDb();
  db.prepare(`INSERT INTO mvp_tasks (deal_id, title, status, created_at, updated_at)
              VALUES (?, 'Iso card', 'in_progress', datetime('now', '-30 days'),
                      strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days', '-1 hours'))`).run(MY_PROJECT);
  const { prompt } = await draft(db, MINE, 'build/retro', String(MY_PROJECT));
  assert.doesNotMatch(String(prompt), /Touched this week: Iso card/, 'an ISO timestamp outside the week was read as inside it');
});

test('D510: a quiet week is said, and an empty board is nothing to draft', async () => {
  const db = freshDb();
  db.prepare(`UPDATE mvp_tasks SET created_at = datetime('now', '-30 days'), updated_at = datetime('now', '-20 days') WHERE deal_id = ?`)
    .run(MY_PROJECT);
  const quiet = await draft(db, MINE, 'build/retro', String(MY_PROJECT));
  assert.equal(quiet.status, 201, 'a board with cards and a quiet week was refused');
  assert.match(String(quiet.prompt), /No card was touched in the seven days to \d{4}-\d{2}-\d{2}\./);
  assert.doesNotMatch(String(quiet.prompt), /Touched this week:/);

  db.prepare('DELETE FROM mvp_tasks WHERE deal_id = ?').run(MY_PROJECT);
  const empty = await draft(db, MINE, 'build/retro', String(MY_PROJECT));
  assert.equal(empty.status, 409, 'an empty board was drafted over');
  assert.equal(empty.prompt, null, 'an empty board reached the model');
});

// Migration 319's shape, which the router's own bootstrap mirrors. Created
// here rather than left to that bootstrap, so the assertion below reads the
// declared table and not whatever a safety net happened to build.
const USAGE_DDL = "CREATE TABLE IF NOT EXISTS ai_usage_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, task TEXT NOT NULL, model TEXT NOT NULL, latency_ms INTEGER NOT NULL DEFAULT 0, prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0, est_cost_usd REAL NOT NULL DEFAULT 0, safety_score REAL, fallback_used INTEGER NOT NULL DEFAULT 0, cached INTEGER NOT NULL DEFAULT 0, refusal TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), surface TEXT)";
const draftRuns = (db: any) => db.prepare(
  `SELECT user_id, surface FROM ai_usage_logs WHERE task = 'workspace_explain' ORDER BY id`,
).all() as Array<{ user_id: number; surface: string | null }>;

test('D510: every draft run records the page it was asked from', async () => {
  for (const surface of SURFACES) {
    const db = freshDb();
    db.exec(USAGE_DDL);
    const { status } = await draft(db, MINE, surface, String(MY_PROJECT), '/build');
    assert.equal(status, 201, `${surface} did not draft`);
    const runs = draftRuns(db);
    assert.equal(runs.length, 1, `${surface} wrote ${runs.length} usage rows for one run`);
    assert.equal(runs[0].user_id, MINE.user);
    // The page, never the draft key: the rail groups "This page this month"
    // on the path it stands on, and no reader stands on `build/retro`.
    assert.equal(runs[0].surface, '/build', `${surface}'s run did not record its page`);
  }
});

test('D510: a run with no page, or one that is not a plain app path, records NULL', async () => {
  for (const page of [undefined, '', 'build/retro', 'https://example.test/build', '/build?x=1', '/build#a', 42]) {
    const db = freshDb();
    db.exec(USAGE_DDL);
    await draft(db, MINE, 'build/retro', String(MY_PROJECT), page);
    const runs = draftRuns(db);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].surface, null, `${JSON.stringify(page)} was recorded as a page`);
  }
  // One page, not two: the trailing slash is the router's to strip.
  const db = freshDb();
  db.exec(USAGE_DDL);
  await draft(db, MINE, 'build/retro', String(MY_PROJECT), '/build/');
  assert.equal(draftRuns(db)[0].surface, '/build');
});

test('D510: a refused draft never reaches the model, so it records no run', async () => {
  const db = freshDb();
  db.exec(USAGE_DDL);
  const { status } = await draft(db, MINE, 'build/retro', String(THEIR_PROJECT), '/build');
  assert.equal(status, 409);
  assert.deepEqual(draftRuns(db), [], 'a refused draft was recorded as a run against the page');
});
