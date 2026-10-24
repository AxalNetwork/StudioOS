/**
 * D908 (#2692) — the Investor narrative's stores and `/api/cycles/raise/narrative/*`,
 * on real SQLite: migrations 442, 459, 463 and 544 over schema_baseline.sql.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/narrative_stores_d908.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import cycleRaise from '../src/routes/cycle_raise.ts';
import { NARRATIVE_SECTIONS } from '../src/services/narrative/store.ts';
import { SPINOUT_OVERRIDABLE_KEYS } from '../src/services/decks/spinoutDeckOverrides.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');

const FOUNDER = 110, OTHER = 120, PARTNER = 140, INVESTOR = 150, ADMIN = 30;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder', [PARTNER]: 'partner', [INVESTOR]: 'investor', [ADMIN]: 'admin' };
const P = 1, PB = 2;
const HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  // The tables migration 463 alters, as raise_writes_d691's cycle fixture builds them.
  for (const t of [
    'users', 'projects', 'activity_logs', 'cap_table_scenarios', 'cap_table_holders', 'cap_table_vesting', 'raise_prospects', 'raise_rounds',
    'spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens', 'deck_share_views', 'data_room_folders', 'data_room_files',
    'dd_cases', 'dd_requests', 'contacts', 'pain_groups', 'hypotheses', 'mvp_features', 'roadmap_okrs',
  ]) db.exec(tableFromBaseline(BASELINE, t));
  const cols = (t: string) => new Set((db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as any[]).map((r) => r.name));
  if (!cols('pitch_deck_share_tokens').has('revoked_at')) db.exec(sqlOf('248_deck_share_revoked_at.sql'));
  db.exec(sqlOf('129_captable_one_canonical_per_project.sql'));
  db.exec(sqlOf('249_project_metrics.sql'));
  db.exec(sqlOf('410_safe_issuances.sql'));
  db.exec(sqlOf('442_raise_cycle_stores.sql'));
  db.exec(sqlOf('459_cycle_activity_convention.sql'));
  db.exec(sqlOf('463_raise_record_stores.sql'));
  db.exec(sqlOf('544_narrative_sections.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null);
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null);
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001), (${PB}, 'Osprey Works', 1002)`);
  db.exec(`INSERT INTO pitch_decks (id, project_id, version, slides) VALUES (5, ${P}, 2, '[]')`);
  // The live deck's wording (version 0).
  const w = db.prepare('INSERT INTO spinout_deck_overrides (project_id, field_key, value, version) VALUES (?, ?, ?, 0)');
  w.run(P, 'problem.framing', 'Finance teams close the month by hand.');
  w.run(P, 'traction.takeaway', 'Pilots convert to paid.');
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/raise', cycleRaise);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, pid = P) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await app.request(`/api/cycles/raise${path}${sep}project=${pid}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null };
  } finally { [console.warn, console.error] = saved; }
}
const logs = (db: DatabaseSync) => db.prepare(
  `SELECT entity_type, entity_id, action, details FROM activity_logs WHERE entity_type = 'raise.investor-narrative' ORDER BY id`,
).all() as any[];
const one = (db: DatabaseSync, sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any;

/** Version 1, started from the live deck. */
async function v1(db: DatabaseSync) {
  const r = await call(db, FOUNDER, 'POST', '/narrative-versions', { investor_type: 'seed_fund' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.version as number;
}
const section = (r: any, key: string) => r.body.sections.items.find((s: any) => s.key === key);

test('the sections: ten, in the canvas order, each deck key a real overridable deck field', () => {
  assert.deepEqual(NARRATIVE_SECTIONS.map((s) => s.key),
    ['problem', 'solution', 'why_now', 'market', 'traction', 'business_model', 'competition', 'team', 'ask', 'closing']);
  for (const s of NARRATIVE_SECTIONS) {
    if (s.store === 'deck') assert.ok(SPINOUT_OVERRIDABLE_KEYS.includes(s.deckKey!), `${s.key}: ${s.deckKey}`);
    else assert.equal(s.deckKey, null, s.key);
  }
  // Every deck key the issue names is writable per version.
  for (const k of ['problem.framing', 'traction.takeaway', 'competitive.whitespace', 'market.assumptions', 'deal.closingLine']) {
    assert.ok(NARRATIVE_SECTIONS.some((s) => s.deckKey === k), k);
  }
});

test('GET /narrative/0 is the live deck: its words, Not recorded (null) elsewhere, and no write reaches it', async () => {
  const db = fixture();
  const r = await call(db, FOUNDER, 'GET', '/narrative/0');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.meta.live, true);
  assert.equal(section(r, 'problem').body, 'Finance teams close the month by hand.');
  assert.equal(section(r, 'traction').body, 'Pilots convert to paid.');
  for (const k of ['solution', 'why_now', 'team', 'ask']) assert.equal(section(r, k).body, null, `${k} is Not recorded`);
  const put = await call(db, FOUNDER, 'PUT', '/narrative/0/sections/problem', { body: 'Changed' });
  assert.equal(put.status, 409);
  assert.equal(one(db, "SELECT value FROM spinout_deck_overrides WHERE project_id = ? AND version = 0 AND field_key = 'problem.framing'", P).value,
    'Finance teams close the month by hand.', 'the live deck is unchanged');
});

test('PUT a section: deck-keyed words go to the version\'s deck row, Why now to its meta, the rest to narrative_sections; each logs once, without its words', async () => {
  const db = fixture();
  const v = await v1(db);
  const before = logs(db).length;
  const t = await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/traction`, { body: 'Pilots convert in weeks.' });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal(one(db, "SELECT value FROM spinout_deck_overrides WHERE project_id = ? AND version = ? AND field_key = 'traction.takeaway'", P, v).value, 'Pilots convert in weeks.');
  assert.equal(one(db, "SELECT value FROM spinout_deck_overrides WHERE project_id = ? AND version = 0 AND field_key = 'traction.takeaway'", P).value, 'Pilots convert to paid.', 'the live deck is unchanged');
  const tr = one(db, 'SELECT body, prior_value FROM narrative_sections WHERE project_id = ? AND version = ? AND section = ?', P, v, 'traction');
  assert.deepEqual([tr.body, tr.prior_value], [null, 'Pilots convert to paid.'], 'the deck row holds the words; the prior is kept');

  assert.equal((await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/why_now`, { body: 'Rules change next year.' })).status, 200);
  assert.equal(one(db, 'SELECT why_now FROM narrative_version_meta WHERE project_id = ? AND version = ?', P, v).why_now, 'Rules change next year.');

  const team = await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/team`, { body: 'Two operators who ran close for a decade.', audience_note: 'Lead with the CFO' });
  assert.equal(team.status, 200);
  assert.deepEqual(team.body.section, {
    key: 'team', label: 'Team', store: 'section', deck_key: null, position: 7, body: 'Two operators who ran close for a decade.',
    audience_note: 'Lead with the CFO', source: null, updated_at: team.body.section.updated_at,
  });
  assert.equal(one(db, 'SELECT body FROM narrative_sections WHERE project_id = ? AND version = ? AND section = ?', P, v, 'team').body,
    'Two operators who ran close for a decade.');

  const l = logs(db).slice(before);
  assert.deepEqual(l.map((x) => [x.entity_id, x.action]), [[String(v), 'narrative_section_saved'], [String(v), 'narrative_section_saved'], [String(v), 'narrative_section_saved']]);
  assert.ok(!/Pilots|Rules|operators|CFO/.test(JSON.stringify(l)), 'no log carries the words');

  const r = await call(db, FOUNDER, 'GET', `/narrative/${v}`);
  assert.deepEqual(r.body.sections.items.map((s: any) => s.key), NARRATIVE_SECTIONS.map((s) => s.key), 'the default order');
  assert.equal(section(r, 'problem').body, 'Finance teams close the month by hand.', 'started from the live deck');
  assert.equal(section(r, 'solution').body, null);
});

test('a deck-keyed write runs the version\'s check again; a section-only write does not', async () => {
  const db = fixture();
  const v = await v1(db);
  const stale = db.prepare("INSERT INTO narrative_checks (project_id, version, figure, stated_value, stated_source, metric_value, metric_source) VALUES (?, ?, 'mrr', 1, 's', 2, 'm')");
  stale.run(P, v);
  await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/team`, { body: 'Two operators.' });
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM narrative_checks WHERE project_id = ? AND version = ?', P, v).n, 1, 'a section-only write leaves the check');
  await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/market`, { body: 'Small finance teams in Europe.' });
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM narrative_checks WHERE project_id = ? AND version = ?', P, v).n, 0, 'the check ran again');
});

test('refusals: an unknown section, an unknown version, nothing to change, too long, Eadwyn with a number, a bad source', async () => {
  const db = fixture();
  const v = await v1(db);
  const unknown = await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/vision`, { body: 'x' });
  assert.deepEqual([unknown.status, unknown.body.detail, unknown.body.sections], [404, 'Unknown section', NARRATIVE_SECTIONS.map((s) => s.key)]);
  assert.equal((await call(db, FOUNDER, 'PUT', '/narrative/9/sections/team', { body: 'x' })).status, 404);
  assert.equal((await call(db, FOUNDER, 'GET', '/narrative/9')).status, 404);
  assert.equal((await call(db, FOUNDER, 'GET', '/narrative/abc')).status, 404);
  assert.equal((await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/team`, {})).status, 400);
  assert.equal((await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/ask`, { body: 'x'.repeat(301) })).status, 400);
  const eadwyn = await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/team`, { body: 'Grew 40% in a quarter.', source: { kind: 'eadwyn' } });
  assert.deepEqual([eadwyn.status, eadwyn.body.detail], [400, "Eadwyn's wording carries no number. Insert the figure as a bound figure instead."]);
  assert.equal((await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/team`, { body: 'Grew fast.', source: { kind: 'eadwyn' } })).status, 200);
  for (const source of [{ kind: 'guess' }, { kind: 'connector', label: 'rumour' }, { kind: 'eadwyn', label: 'typed' }, 'eadwyn']) {
    assert.equal((await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/team`, { body: 'x', source })).status, 400, JSON.stringify(source));
  }
  // A typed figure is the founder's: it is not refused.
  assert.equal((await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/team`, { body: 'Grew 40% in a quarter.' })).status, 200);
});

test('who: a partner, an investor and another venture\'s founder get 403 on every read and write; an admin reads only (D914)', async () => {
  const db = fixture();
  const v = await v1(db);
  for (const who of [PARTNER, INVESTOR, OTHER]) {
    for (const [m, path, body] of [
      ['GET', `/narrative/${v}`], ['GET', '/narrative/positioning'], ['GET', `/narrative/compare?a=0&b=${v}`],
      ['PUT', `/narrative/${v}/sections/team`, { body: 'x' }], ['PUT', '/narrative/positioning', { kind: 'one_liner', text: 'x' }],
    ] as const) {
      assert.equal((await call(db, who, m, path, body)).status, 403, `${ROLE[who]} ${who} ${m} ${path}`);
    }
  }
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM narrative_sections').n, 0);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM narrative_positioning').n, 0);
  // D914 (#2698): an admin reads the narrative and leaves notes; their writes are refused.
  const admin = await call(db, ADMIN, 'PUT', `/narrative/${v}/sections/team`, { body: 'Admin' });
  assert.deepEqual([admin.status, admin.body.code], [403, 'admin_read_only']);
  // Another venture's version is not this one's.
  assert.equal((await call(db, OTHER, 'GET', `/narrative/${v}`, undefined, PB)).status, 404);
});

test('a change of note or place keeps where the words came from', async () => {
  const db = fixture();
  const v = await v1(db);
  await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/solution`, { body: 'A close tool.', source: { kind: 'module', ref: 'validate:icp', label: 'recorded' } });
  await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/solution`, { audience_note: 'Short for angels', position: 0 });
  const r = await call(db, FOUNDER, 'GET', `/narrative/${v}`);
  assert.deepEqual(section(r, 'solution').source, { kind: 'module', ref: 'validate:icp', label: 'recorded' });
  assert.equal(r.body.sections.items[0].key, 'solution', 'the place moved it first');
  assert.equal(section(r, 'solution').body, 'A close tool.');
  // New words typed by hand are the founder's own.
  await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/solution`, { body: 'A faster close tool.' });
  const r2 = await call(db, FOUNDER, 'GET', `/narrative/${v}`);
  assert.equal(section(r2, 'solution').source, null);
  assert.equal(one(db, 'SELECT prior_value FROM narrative_sections WHERE project_id = ? AND version = ? AND section = ?', P, v, 'solution').prior_value, 'A close tool.');
});

test('bindings: D896\'s five fields per section, replaced on each write, refused when malformed', async () => {
  const db = fixture();
  const v = await v1(db);
  const good = [
    { source_key: 'revenue.mrr', record_ref: 'project_metrics:7', as_of: '2026-10-01', grade: 'Measured', snapshot_hash: HASH },
    { source_key: 'validate.interviews', record_ref: null, as_of: null, grade: 'Stated', snapshot_hash: null },
  ];
  const r = await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/traction`, { bindings: good });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.bindings.map((b: any) => [b.source_key, b.grade, b.position]), [['revenue.mrr', 'Measured', 0], ['validate.interviews', 'Stated', 1]]);
  const read = await call(db, FOUNDER, 'GET', `/narrative/${v}`);
  assert.deepEqual(read.body.bindings.items.map((b: any) => ({ source_key: b.source_key, record_ref: b.record_ref, as_of: b.as_of, grade: b.grade, snapshot_hash: b.snapshot_hash })), good);
  await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/traction`, { bindings: [good[0]] });
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM narrative_bindings WHERE version = ?', v).n, 1, 'replaced');
  for (const bad of [
    [{ ...good[0], grade: 'Not recorded' }], [{ ...good[0], source_key: 'MRR' }], [{ ...good[0], as_of: '1 Oct' }],
    [{ ...good[0], snapshot_hash: 'xyz' }], 'revenue.mrr', Array.from({ length: 21 }, () => good[1]),
  ]) assert.equal((await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/traction`, { bindings: bad })).status, 400, JSON.stringify(bad).slice(0, 80));
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM narrative_bindings WHERE version = ?', v).n, 1, 'a refused write changes nothing');
});

test('positioning: the core, a version\'s own field over it, clearing back to the core, lines by place', async () => {
  const db = fixture();
  const v = await v1(db);
  assert.deepEqual((await call(db, FOUNDER, 'GET', '/narrative/positioning')).body, { version: null, core: [], overrides: [], effective: [] }, 'no positioning yet is an empty core, not an error');
  assert.equal((await call(db, FOUNDER, 'PUT', '/narrative/positioning', { kind: 'one_liner', text: 'The close, done in a day.' })).status, 200);
  assert.equal((await call(db, FOUNDER, 'PUT', '/narrative/positioning', { kind: 'category', text: 'Finance operations' })).status, 200);
  assert.equal((await call(db, FOUNDER, 'PUT', '/narrative/positioning', { kind: 'line', position: 1, text: 'Second line' })).status, 200);
  const o = await call(db, FOUNDER, 'PUT', `/narrative/positioning?version=${v}`, { kind: 'one_liner', text: 'For seed funds: the close in a day.' });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  const g = (await call(db, FOUNDER, 'GET', `/narrative/positioning?version=${v}`)).body;
  assert.deepEqual(g.core.map((x: any) => x.kind), ['category', 'line', 'one_liner']);
  assert.deepEqual(g.overrides.map((x: any) => [x.kind, x.version]), [['one_liner', v]]);
  assert.deepEqual(g.effective.map((x: any) => [x.kind, x.text]), [['one_liner', 'For seed funds: the close in a day.'], ['line', 'Second line'], ['category', 'Finance operations']]);
  // The version's read carries the same positioning.
  assert.deepEqual((await call(db, FOUNDER, 'GET', `/narrative/${v}`)).body.positioning.effective, g.effective);
  // Clearing the version's field reads the core again.
  assert.equal((await call(db, FOUNDER, 'PUT', `/narrative/positioning?version=${v}`, { kind: 'one_liner', text: null })).status, 200);
  const after = (await call(db, FOUNDER, 'GET', `/narrative/positioning?version=${v}`)).body;
  assert.equal(after.effective.find((x: any) => x.kind === 'one_liner').text, 'The close, done in a day.');
  // Saving again replaces, keeping the prior words.
  await call(db, FOUNDER, 'PUT', '/narrative/positioning', { kind: 'category', text: 'Finance automation' });
  assert.deepEqual({ ...one(db, "SELECT text, prior_value FROM narrative_positioning WHERE version IS NULL AND kind = 'category'") },
    { text: 'Finance automation', prior_value: 'Finance operations' });
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM narrative_positioning WHERE version IS NULL AND kind = 'category'").n, 1);
  for (const [qs, b] of [
    ['', { kind: 'slogan', text: 'x' }], ['', { kind: 'one_liner', position: 1, text: 'x' }], ['', { kind: 'line', position: 20, text: 'x' }],
    ['', { kind: 'one_liner' }], ['?version=0', { kind: 'one_liner', text: 'x' }], ['?version=9', { kind: 'one_liner', text: 'x' }],
    ['', { kind: 'wedge', text: 'Only 3 tools do this', source: { kind: 'eadwyn' } }],
  ] as const) assert.ok([400, 404, 409].includes((await call(db, FOUNDER, 'PUT', `/narrative/positioning${qs}`, b)).status), JSON.stringify(b));
  assert.ok(logs(db).some((x) => x.action === 'narrative_positioning_saved' && x.entity_id === null && x.details === 'Core positioning: one liner saved'));
  assert.ok(logs(db).some((x) => x.action === 'narrative_positioning_cleared' && x.entity_id === String(v)));
});

test('compare: two versions section by section, changed, same or Not recorded', async () => {
  const db = fixture();
  const v = await v1(db);
  await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/traction`, { body: 'Pilots convert in weeks.' });
  await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/problem`, { body: '  Finance teams close the month   by hand. ' });
  const r = await call(db, FOUNDER, 'GET', `/narrative/compare?a=0&b=${v}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const by = Object.fromEntries(r.body.pairs.map((p: any) => [p.key, p]));
  assert.equal(by.traction.state, 'changed');
  assert.deepEqual([by.traction.a.body, by.traction.b.body], ['Pilots convert to paid.', 'Pilots convert in weeks.']);
  assert.equal(by.problem.state, 'same', 'whitespace is not a change');
  assert.equal(by.team.state, 'not_recorded');
  assert.equal(r.body.pairs.length, NARRATIVE_SECTIONS.length);
  assert.equal((await call(db, FOUNDER, 'GET', `/narrative/compare?a=0&b=9`)).status, 404);
});

test('a store that fails to read is unreadable, never an empty list', async () => {
  const db = fixture();
  const v = await v1(db);
  db.exec('DROP TABLE narrative_positioning');
  const r = await call(db, FOUNDER, 'GET', `/narrative/${v}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.positioning, { state: 'unreadable' });
  assert.equal(r.body.sections.state, 'ok', 'the other parts still read');
  const p = await call(db, FOUNDER, 'GET', '/narrative/positioning');
  assert.deepEqual([p.status, p.body.code], [503, 'unreadable']);
  db.exec('DROP TABLE narrative_sections');
  assert.deepEqual((await call(db, FOUNDER, 'GET', `/narrative/${v}`)).body.sections, { state: 'unreadable' });
  assert.deepEqual([(await call(db, FOUNDER, 'GET', `/narrative/compare?a=0&b=${v}`)).status], [503]);
});

test('a version started from another, or duplicated, carries its sections, bindings and positioning overrides', async () => {
  const db = fixture();
  const v = await v1(db);
  await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/team`, { body: 'Two operators.', bindings: [{ source_key: 'team.size', grade: 'Stated' }] });
  await call(db, FOUNDER, 'PUT', `/narrative/positioning?version=${v}`, { kind: 'wedge', text: 'Month-end first' });
  // A fill that was undone stays behind.
  await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/solution`, { body: 'An undone fill.' });
  db.prepare("UPDATE narrative_sections SET undone_at = datetime('now'), undone_by = ? WHERE version = ? AND section = 'solution'").run(FOUNDER, v);
  const next = await call(db, FOUNDER, 'POST', '/narrative-versions', { investor_type: 'angel', start_from: 'version', based_on_version: v });
  assert.equal(next.status, 201, JSON.stringify(next.body));
  const r = await call(db, FOUNDER, 'GET', `/narrative/${next.body.version}`);
  assert.equal(section(r, 'team').body, 'Two operators.');
  assert.equal(section(r, 'solution').body, null, 'an undone fill is not carried');
  assert.deepEqual(r.body.bindings.items.map((b: any) => [b.section, b.source_key]), [['team', 'team.size']]);
  assert.deepEqual(r.body.positioning.overrides.map((x: any) => [x.kind, x.text, x.version]), [['wedge', 'Month-end first', next.body.version]]);
  // From the live deck, nothing of version 1's is carried.
  const fresh = await call(db, FOUNDER, 'POST', '/narrative-versions', { investor_type: 'angel' });
  const f = await call(db, FOUNDER, 'GET', `/narrative/${fresh.body.version}`);
  assert.equal(section(f, 'team').body, null);
  assert.deepEqual(f.body.bindings.items, []);
});
