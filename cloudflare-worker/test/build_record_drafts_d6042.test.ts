/**
 * D6042 (#6042): Eadwyn's two record-only drafts on Build — `build/founding`
 * (Founding team: check the split and vesting, list what is not recorded) and
 * `build/company` (Company creation: open filings, what is due next, the
 * formation state).
 *
 *   · input assembly: what each surface hands the model is the project's own
 *     record, with every gap spelled NOT RECORDED, the split's total and each
 *     filing's day count computed here, and the next one due named;
 *   · nothing to draft: an empty record answers 409 before any model runs;
 *   · refusal on another venture: a founder naming a project that is not
 *     theirs gets the same 409, with no prompt, and no other venture's row
 *     ever reaches the model.
 *
 * Synthetic records only; Workers AI is a stub that keeps its prompt.
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_record_drafts_d6042.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { AI_LOG_SCHEMA, AI_BUDGET_MIGRATION } from './_ai_budget_fixture.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import research, { FOUNDER_DRAFT_PAGES } from '../src/routes/research.ts';
import { RAIL_OPTION_JOBS } from '../src/services/ai/textJobs.ts';
import { COMPANY_INSTRUCTION, FOUNDING_INSTRUCTION, companyMaterial, foundingMaterial } from '../src/services/buildRecordDrafts.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MINE = { user: 80, founder_id: 180 };
const THEIRS = { user: 81, founder_id: 181 };
const TWO = { user: 82, founder_id: 182 };
const MY_PROJECT = 960, THEIR_PROJECT = 961, TWO_A = 962, TWO_B = 963, EMPTY = 964;
const TODAY = '2026-11-15';

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  // Shapes as production has them: `cap_table_holders`/`cap_table_vesting`/`documents`/`incorporations`/`entities`
  // from sql/schema_baseline.sql (+ founder_role, migration 441), `cofounder_agreement_parties` from 309,
  // `formation_steps` from 441 + 461, `entity_obligations` from 374, `incorporations` + 411's dates.
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE founders (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, email TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, deleted_at TEXT);
    CREATE TABLE cap_table_holders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, project_id INTEGER,
      name TEXT NOT NULL, email TEXT, security_type TEXT, shares REAL DEFAULT 0, ownership_pct REAL,
      source TEXT NOT NULL DEFAULT 'manual', carta_stakeholder_id TEXT, carta_security_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      kind TEXT, founder_role TEXT);
    CREATE TABLE cap_table_vesting (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, holder_id INTEGER,
      security_id INTEGER, carta_vesting_id TEXT, start_date TEXT, cliff_months INTEGER, total_months INTEGER,
      total_shares REAL, vested_shares REAL, source TEXT DEFAULT 'manual',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL, project_id INTEGER,
      title TEXT NOT NULL, doc_type TEXT NOT NULL DEFAULT 'other', status TEXT NOT NULL DEFAULT 'draft', content TEXT,
      template_name TEXT, signed_by TEXT, signed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE cofounder_agreement_parties (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL,
      party_index INTEGER NOT NULL, name TEXT NOT NULL, email TEXT, user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (document_id, party_index));
    CREATE TABLE formation_steps (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0), due_date TEXT,
      state TEXT NOT NULL DEFAULT 'todo' CHECK (state IN ('todo', 'doing', 'done')), proof_file_key TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0, created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      kind TEXT, jurisdiction TEXT, for_holder_id INTEGER);
    CREATE TABLE incorporations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, project_id INTEGER NOT NULL,
      jurisdiction_id TEXT NOT NULL, company_name TEXT NOT NULL, amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_payment', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      paid_at TIMESTAMP, packet_ready_at TEXT, filed_on TEXT);
    CREATE TABLE entities (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, name TEXT NOT NULL, entity_type TEXT NOT NULL,
      parent_id INTEGER, jurisdiction TEXT, incorporation_date TEXT, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE entity_obligations (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, entity_id INTEGER NOT NULL,
      kind TEXT NOT NULL, title TEXT NOT NULL, cadence TEXT NOT NULL, due_date TEXT,
      status TEXT NOT NULL DEFAULT 'open', proof_file_key TEXT);
    CREATE TABLE research_zone_drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      owner_user_id INTEGER NOT NULL, surface TEXT NOT NULL, scope_key TEXT, body TEXT NOT NULL, model TEXT,
      cost_micro_usd INTEGER NOT NULL DEFAULT 0, accepted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  for (const who of [MINE, THEIRS, TWO]) {
    db.prepare('INSERT INTO users (id, role, founder_id) VALUES (?, ?, ?)').run(who.user, 'founder', who.founder_id);
    db.prepare('INSERT INTO founders (id, name) VALUES (?, ?)').run(who.founder_id, `Founder ${who.user}`);
  }
  const owner: Record<number, number> = { [MY_PROJECT]: MINE.founder_id, [THEIR_PROJECT]: THEIRS.founder_id, [TWO_A]: TWO.founder_id, [TWO_B]: TWO.founder_id };
  // Every venture carries both records, each naming its own id, so a 409 below is the ownership check
  // and never a thin fixture, and a dropped WHERE shows as another venture's id in the prompt.
  for (const [pid, fid] of Object.entries(owner).map(([p, f]) => [Number(p), f])) {
    db.prepare('INSERT INTO entities (id, name, entity_type, jurisdiction, incorporation_date) VALUES (?, ?, ?, ?, ?)')
      .run(pid, `Entity ${pid} Inc.`, 'project', 'US-DE', '2026-03-02');
    db.prepare('INSERT INTO projects (id, name, founder_id, entity_id) VALUES (?, ?, ?, ?)').run(pid, `Venture ${pid}`, fid, pid);
    const a = Number(db.prepare(`INSERT INTO cap_table_holders (user_id, project_id, name, shares, ownership_pct, founder_role)
      VALUES (?, ?, ?, 6000000, 60, 'CEO')`).run(pid * 10 + 1, pid, `Ada ${pid}`).lastInsertRowid);
    db.prepare(`INSERT INTO cap_table_holders (user_id, project_id, name, shares, ownership_pct, founder_role)
      VALUES (?, ?, ?, 3000000, 30, 'CTO')`).run(pid * 10 + 2, pid, `Ben ${pid}`);
    db.prepare(`INSERT INTO cap_table_vesting (user_id, holder_id, start_date, cliff_months, total_months, vested_shares)
      VALUES (?, ?, '2026-01-01', 12, 48, 1500000)`).run(pid * 10 + 1, a);
    db.prepare(`INSERT INTO formation_steps (project_id, title, due_date, state, kind, jurisdiction, created_by)
      VALUES (?, ?, '2026-11-10', 'doing', 'ein', 'US', 1)`).run(pid, `EIN for ${pid}`);
    db.prepare(`INSERT INTO entity_obligations (uid, entity_id, kind, title, cadence, due_date)
      VALUES (?, ?, 'franchise_tax', ?, 'annual', '2027-03-01')`).run(`o${pid}`, pid, `Franchise tax for ${pid}`);
  }
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(EMPTY, 'Nothing yet', 999);
  db.exec(AI_LOG_SCHEMA + AI_BUDGET_MIGRATION);
  return db;
}

const envOf = (db: InstanceType<typeof DatabaseSync>) => ({ env: { DB: d1Over(db) } }) as any;

async function draft(db: InstanceType<typeof DatabaseSync>, who: { user: number }, surface: string, scopeKey?: string) {
  let prompt: string | null = null;
  const AI = withGuard({
    run: async (_model: string, payload: any) => {
      const messages = payload?.messages || [];
      prompt = String(messages[messages.length - 1]?.content ?? '');
      return { response: 'a drafted paragraph' };
    },
  });
  const auth = await new SignJWT({ user_id: who.user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await research.fetch(new Request('http://x/drafts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify({ surface, ...(scopeKey === undefined ? {} : { scope_key: scopeKey }) }),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI } as any);
  return { status: res.status, prompt: prompt as string | null, body: await res.json().catch(() => null) };
}

test('each surface is registered on its module\'s page and its page kind\'s Build job', () => {
  assert.equal(FOUNDER_DRAFT_PAGES['build/founding'], 'Founder · Build · Founding team');
  assert.equal(FOUNDER_DRAFT_PAGES['build/company'], 'Founder · Build · Company creation');
  assert.equal(RAIL_OPTION_JOBS['draft:build/founding'], 'BU2');
  assert.equal(RAIL_OPTION_JOBS['draft:build/company'], 'BU8');
});

for (const surface of ['build/founding', 'build/company']) {
  test(`${surface} drafts over the caller's own venture, and only that one`, async () => {
    const db = freshDb();
    const { status, prompt, body } = await draft(db, MINE, surface, String(MY_PROJECT));
    assert.equal(status, 201, JSON.stringify(body));
    assert.ok(prompt && prompt.includes(String(MY_PROJECT)), 'the caller\'s own record never reached the model');
    for (const other of [THEIR_PROJECT, TWO_A, TWO_B]) assert.ok(!prompt!.includes(String(other)), `${surface} handed venture ${other}'s record to the model`);
    assert.ok(prompt!.startsWith(surface === 'build/founding' ? FOUNDING_INSTRUCTION : COMPANY_INSTRUCTION), 'the surface\'s own instruction leads the prompt');
    // Kept where the surface defines: a stored draft, unaccepted, scoped to the venture.
    const row = db.prepare('SELECT surface, scope_key, accepted_at FROM research_zone_drafts').get() as any;
    assert.deepEqual({ ...row }, { surface, scope_key: String(MY_PROJECT), accepted_at: null });
  });

  test(`${surface} refuses another founder's venture before any model runs`, async () => {
    const db = freshDb();
    const { status, prompt, body } = await draft(db, MINE, surface, String(THEIR_PROJECT));
    assert.equal(status, 409);
    assert.equal(body?.detail, 'nothing_to_draft', 'the same answer as an empty record, so the route cannot tell them apart');
    assert.equal(prompt, null, 'a refused draft still reached the model');
    for (const junk of ['0', '-1', 'null', '1 OR 1=1', '999999']) assert.equal((await draft(db, MINE, surface, junk)).status, 409, `scope_key ${junk} was not refused`);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM research_zone_drafts').get() as any).n, 0, 'a refusal stored a draft');
  });

  test(`${surface} refuses to guess between two ventures, picks a lone one, and skips a deleted one`, async () => {
    const db = freshDb();
    assert.equal((await draft(db, TWO, surface)).status, 409, 'two ventures and no scope key drafted over one of them');
    const named = await draft(db, TWO, surface, String(TWO_B));
    assert.equal(named.status, 201);
    assert.ok(!named.prompt!.includes(String(TWO_A)), 'naming one venture handed over the other');
    assert.equal((await draft(db, MINE, surface)).status, 201, 'a lone venture is the one drafted over');
    db.prepare('UPDATE projects SET deleted_at = ? WHERE id = ?').run('2026-09-01T00:00:00Z', MY_PROJECT);
    assert.equal((await draft(db, MINE, surface, String(MY_PROJECT))).status, 409, 'a deleted venture was drafted over');
  });
}

test('build/founding: each founder\'s split, vesting and agreement as recorded, the total computed, and every gap named', async () => {
  const db = freshDb();
  const lines = await foundingMaterial(envOf(db), MY_PROJECT);
  const text = lines.join('\n');
  assert.match(text, /FOUNDER: Ada 960 — role CEO; ownership 60%; shares 6000000; vesting starts 2026-01-01, 12-month cliff, 48 months in all, 1500000 shares vested; cofounder agreement NOT RECORDED/);
  assert.match(text, /FOUNDER: Ben 960 — role CTO; ownership 30%; shares 3000000; VESTING NOT RECORDED; cofounder agreement NOT RECORDED/);
  // The split is totalled here and short of 100%: the model reads the figure, it does not add.
  assert.ok(lines.includes('RECORDED FOUNDER OWNERSHIP TOTALS 90% across 2 founders.'), text);
  assert.ok(lines.includes('NOT RECORDED: Ada 960: cofounder agreement; Ben 960: vesting, cofounder agreement.'), text);
  assert.match(text, /investors, option holders and the option pool are not in front of you/);

  // An unrecorded percentage is never read as zero: the split cannot be totalled.
  db.prepare('UPDATE cap_table_holders SET ownership_pct = NULL WHERE name = ?').run('Ben 960');
  const gap = await foundingMaterial(envOf(db), MY_PROJECT);
  assert.ok(gap.includes('THE SPLIT CANNOT BE TOTALLED: ownership is NOT RECORDED for 1 of 2 founders; the 1 recorded add up to 60%.'), gap.join('\n'));
  assert.match(gap.join('\n'), /Ben 960: ownership, vesting, cofounder agreement/);

  // A signed agreement and a recorded cliff of zero read back as such, and close those gaps.
  const doc = Number(db.prepare(`INSERT INTO documents (uid, project_id, title, template_name, status) VALUES ('cfa', ?, 'CFA', 'cofounder_agreement', 'signed')`).run(MY_PROJECT).lastInsertRowid);
  db.prepare('INSERT INTO cofounder_agreement_parties (document_id, party_index, name, user_id) VALUES (?, 0, ?, ?)').run(doc, 'Ada', MY_PROJECT * 10 + 1);
  db.prepare('UPDATE cap_table_vesting SET cliff_months = 0 WHERE user_id = ?').run(MY_PROJECT * 10 + 1);
  const signed = (await foundingMaterial(envOf(db), MY_PROJECT)).join('\n');
  assert.match(signed, /Ada 960 .*no cliff.*cofounder agreement signed/);
  assert.doesNotMatch(signed, /Ada 960: /, 'Ada has nothing left to record');

  // An investor is not a founder, and a schedule keyed to another user is never joined.
  db.prepare(`INSERT INTO cap_table_holders (user_id, project_id, name, ownership_pct) VALUES (5, ?, 'Investor Fund', 10)`).run(MY_PROJECT);
  db.prepare(`INSERT INTO cap_table_vesting (user_id, holder_id, start_date, cliff_months, total_months) VALUES (999, (SELECT id FROM cap_table_holders WHERE name = 'Ben 960'), '2025-01-01', 6, 24)`).run();
  const scoped = (await foundingMaterial(envOf(db), MY_PROJECT)).join('\n');
  assert.doesNotMatch(scoped, /Investor Fund/);
  assert.match(scoped, /Ben 960 .*VESTING NOT RECORDED/, 'a vesting row keyed to another user was joined');

  // No founder is nothing to draft.
  assert.deepEqual(await foundingMaterial(envOf(db), EMPTY), []);
});

test('build/company: the formation state, each open filing\'s timing from today, and the next one due', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO incorporations (user_id, project_id, jurisdiction_id, company_name, amount_cents, status, paid_at, packet_ready_at)
    VALUES (1, ?, 'US-DE', 'Venture 960 Inc.', 50000, 'paid', '2026-02-01 10:00:00', '2026-02-10')`).run(MY_PROJECT);
  db.prepare(`INSERT INTO formation_steps (project_id, title, due_date, state, kind, proof_file_key, created_by)
    VALUES (?, '83(b) for Ada', '2026-11-25', 'todo', '83b', NULL, 1), (?, 'Bylaws adopted', '2026-02-20', 'done', 'formation', 'build-proof/x', 1),
           (?, 'Open a bank account', NULL, 'todo', NULL, NULL, 1)`).run(MY_PROJECT, MY_PROJECT, MY_PROJECT);
  const lines = await companyMaterial(envOf(db), MY_PROJECT, TODAY);
  const text = lines.join('\n');
  assert.equal(lines[0], `Today is ${TODAY}.`);
  // The order's steps: what is recorded as done, and what is not.
  assert.match(text, /FORMATION ORDER: Venture 960 Inc\.; jurisdiction US-DE; order status paid; order paid 2026-02-01; formation packet ready 2026-02-10; filed with the state NOT RECORDED/);
  // Each step and obligation with its timing, computed here.
  assert.match(text, /FORMATION STEP: EIN for 960; kind EIN; jurisdiction US; in progress; OVERDUE by 5 days; proof not recorded/);
  assert.match(text, /FORMATION STEP: 83\(b\) for Ada; kind 83\(b\) election; jurisdiction not recorded; to do; due in 10 days; proof not recorded/);
  assert.match(text, /FORMATION STEP: Bylaws adopted; kind formation; jurisdiction not recorded; done; due date 2026-02-20; proof stored/);
  assert.match(text, /FORMATION STEP: Open a bank account; kind not recorded; jurisdiction not recorded; to do; NO DUE DATE RECORDED/);
  assert.match(text, /ENTITY: Entity 960 Inc\.; jurisdiction US-DE; incorporated 2026-03-02; status active/);
  assert.match(text, /OPEN OBLIGATION: Franchise tax for 960; kind franchise tax; due in 106 days/);
  // The overdue filing is next, ahead of the one due soonest; an undated one is never named next.
  assert.ok(lines.includes('NEXT DUE: EIN for 960, OVERDUE by 5 days (2026-11-10).'), text);

  // Nothing outside the venture: no other entity's obligations, no other venture's steps.
  for (const other of [THEIR_PROJECT, TWO_A, TWO_B]) assert.ok(!text.includes(String(other)), `venture ${other}'s filings reached the material`);

  // Closing the overdue one moves NEXT DUE on; with only undated filings open, none is named.
  db.prepare("UPDATE formation_steps SET state = 'done' WHERE title = 'EIN for 960'").run();
  assert.ok((await companyMaterial(envOf(db), MY_PROJECT, TODAY)).includes('NEXT DUE: 83(b) for Ada, due in 10 days (2026-11-25).'));
  db.prepare("UPDATE formation_steps SET state = 'done' WHERE due_date IS NOT NULL").run();
  db.prepare("UPDATE entity_obligations SET status = 'filed'").run();
  const undated = await companyMaterial(envOf(db), MY_PROJECT, TODAY);
  assert.ok(undated.some((l) => l.startsWith('NO OPEN FILING CARRIES A DUE DATE: 2 are open')), undated.join('\n'));
  assert.ok(undated.includes('No open obligation is recorded against the entity.'));
  db.prepare("UPDATE formation_steps SET state = 'done'").run();
  db.prepare("UPDATE incorporations SET filed_on = '2026-02-15'").run();
  assert.ok((await companyMaterial(envOf(db), MY_PROJECT, TODAY)).includes('NOTHING IS OPEN: every recorded step is done and no obligation is open.'));
});

test('build/company: a missing order, step or entity is spelled out; a pending order is not an order; an empty record is nothing to draft', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO incorporations (user_id, project_id, jurisdiction_id, company_name, amount_cents, status) VALUES (1, ?, 'US-DE', 'Unpaid', 1, 'pending_payment')`).run(MY_PROJECT);
  const text = (await companyMaterial(envOf(db), MY_PROJECT, TODAY)).join('\n');
  assert.match(text, /NO FORMATION ORDER IS RECORDED\./);
  assert.doesNotMatch(text, /Unpaid/, 'an order still waiting on payment was read as a formation order');

  db.prepare('UPDATE projects SET entity_id = NULL WHERE id = ?').run(MY_PROJECT);
  db.prepare('DELETE FROM formation_steps WHERE project_id = ?').run(MY_PROJECT);
  db.prepare("UPDATE incorporations SET status = 'paid' WHERE project_id = ?").run(MY_PROJECT);
  const orderOnly = (await companyMaterial(envOf(db), MY_PROJECT, TODAY)).join('\n');
  assert.match(orderOnly, /NO FORMATION STEP IS RECORDED\./);
  assert.match(orderOnly, /NO ENTITY RECORD IS LINKED/);
  assert.match(orderOnly, /order paid NOT RECORDED; formation packet ready NOT RECORDED; filed with the state NOT RECORDED/);
  assert.match(orderOnly, /NO OPEN FILING CARRIES A DUE DATE: 3 are open/);

  assert.deepEqual(await companyMaterial(envOf(db), EMPTY, TODAY), [], 'no order, step or entity is nothing to draft');
  const route = await draft(db, MINE, 'build/company', String(MY_PROJECT));
  assert.equal(route.status, 201);
  db.prepare('DELETE FROM incorporations').run();
  const none = await draft(db, MINE, 'build/company', String(MY_PROJECT));
  assert.equal(none.status, 409);
  assert.equal(none.prompt, null);
});
