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
  // from the baseline, and `metrics_snapshots` in the shape
  // `ensureMetricsSnapshotsSchema` creates (project_id, not the baseline
  // dump's historical deal_id).
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
    CREATE TABLE metrics_snapshots (
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
    db.prepare('INSERT INTO metrics_snapshots (project_id, snapshot_date, mrr) VALUES (?, ?, ?)')
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
  db: any, who: { user: number }, surface: string, scopeKey?: string,
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
      body: JSON.stringify(scopeKey === undefined ? { surface } : { surface, scope_key: scopeKey }),
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), AI } as any,
  );
  return { status: res.status, prompt };
}
/** The status alone, for the many cases where only the refusal matters. */
const statusOf = async (...a: Parameters<typeof draft>) => (await draft(...a)).status;

const SURFACES = [
  'build/this-week', 'build/roadmap', 'build/kpi',
  'raise/capital', 'raise/legal', 'raise/data-room', 'raise/liquidity',
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

  db.prepare('INSERT INTO metrics_snapshots (project_id, snapshot_date, mrr) VALUES (?, ?, ?)')
    .run(MY_PROJECT, '2026-08-01', 3000);
  const two = await draft(db, MINE, 'build/kpi', String(MY_PROJECT));
  assert.doesNotMatch(String(two.prompt), /ONLY ONE SNAPSHOT EXISTS/,
    'the single-snapshot warning survived a second snapshot');
  assert.match(String(two.prompt), /2026-09-01[\s\S]*2026-08-01/,
    'the two snapshots reach the model newest first, so "moved" has a direction');

  db.prepare('DELETE FROM metrics_snapshots WHERE project_id = ?').run(MY_PROJECT);
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
