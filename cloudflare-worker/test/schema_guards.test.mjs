/**
 * The parsers behind the schema guards, tested on the shapes that fooled them.
 *
 * `check-sqlite-tables` and `check-sqlite-columns` are only as good as their
 * reading of the source. Six distinct parser faults were found while building
 * them, and every one made the guard REPORT A COLUMN OR TABLE THAT EXISTS —
 * or, worse in one case, silently stop reading a query at all. A guard that
 * cries wolf gets ignored; a guard with a blind spot is decoration.
 *
 * Each case below is one of those faults, written from the real source shape
 * that produced it. They are cheap to run and they are the only thing standing
 * between these checks and a slow slide back into noise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sqlStrings } from '../../scripts/check-sqlite-dialect.mjs';
import { collapseStringConcat, knownColumns, unknownColumns, setClause, singleTableSelect, incompleteTables, runtimeColumns } from '../../scripts/check-sqlite-columns.mjs';
import { stripSqlLiterals, knownTables } from '../../scripts/check-sqlite-tables.mjs';

test('a query introduced by a line comment is still seen', () => {
  const src = `
    await env.DB.prepare(
      // why this query is shaped this way
      \`SELECT id FROM widgets\`,
    ).run();`;
  const found = sqlStrings(src);
  assert.equal(found.length, 1, 'only whitespace used to be skipped before the quote');
  assert.match(found[0].body, /FROM widgets/);
});

test('a query introduced by a block comment is still seen', () => {
  const src = `await env.DB.prepare(/* note */ \`SELECT id FROM widgets\`).run();`;
  assert.equal(sqlStrings(src).length, 1);
});

test('prose inside a SQL string literal cannot look like a table', () => {
  // 'requests from the operator marketplace.' otherwise contributes `the`.
  const sql = `INSERT INTO t (a) VALUES ('requests from the operator marketplace.')`;
  assert.doesNotMatch(stripSqlLiterals(sql), /from the operator/);
  assert.match(stripSqlLiterals(sql), /INSERT INTO t/);
});

test('DDL assembled by string concatenation is harvested', () => {
  const src = `env.DB.exec('CREATE TABLE IF NOT EXISTS t (' + 'a TEXT, ' + 'b TEXT)')`;
  assert.match(collapseStringConcat(src), /CREATE TABLE IF NOT EXISTS t \(a TEXT, b TEXT\)/);
});

test('the real schema is harvested, and it is not empty', () => {
  const schema = knownColumns();
  assert.ok(schema.size > 300, `expected a few hundred tables, got ${schema.size}`);

  // A comment containing commas used to corrupt the top-level split and
  // swallow every column defined below it — partner_deals lost five.
  const deals = schema.get('partner_deals');
  for (const c of ['deal_type', 'granted_tier_founder', 'granted_tier_investor', 'term_months', 'status']) {
    assert.ok(deals?.has(c), `partner_deals.${c} should be known`);
  }

  // `KEY` is not a SQLite table constraint, so a definition starting with it
  // is a column literally named `key`. Treating it as a constraint reported
  // both of these as missing.
  assert.ok(schema.get('cohort_settings')?.has('key'), 'cohort_settings.key should be known');
  assert.ok(schema.get('signal_sources')?.has('key'), 'signal_sources.key should be known');

  // Concatenated DDL — integrations/oauth.ts builds this one with `+`.
  const oauth = schema.get('oauth_state_tokens');
  assert.ok(oauth?.has('pkce_verifier'), 'oauth_state_tokens.pkce_verifier should be known');
  assert.ok(oauth?.has('extra_json'), 'oauth_state_tokens.extra_json should be known');

  // Added by migration 178 after seven admin routers probed for it in vain.
  assert.ok(schema.get('admin_audit_log')?.has('actor'), 'admin_audit_log.actor should be known');
  for (const c of ['level', 'source', 'details']) {
    assert.ok(schema.get('error_logs')?.has(c), `error_logs.${c} should be known`);
  }
});

test('the async scorer writes to its own table, never score_snapshots', () => {
  const schema = knownColumns();
  const drafts = schema.get('ai_score_drafts');
  assert.ok(drafts, 'migration 179 should define ai_score_drafts');
  // No tier: a tier is a decision, and a 0-75 scorer is not equipped to make
  // one against thresholds of 85 and 70. This is the whole reason the table
  // exists rather than the column names being corrected.
  assert.ok(!drafts.has('tier'), 'ai_score_drafts must not carry a tier');
  assert.ok(drafts.has('total_0_75'), 'the scale belongs in the column name');
});

test('a SET clause ends at WHERE, and not at a WHERE inside a string', () => {
  const at = (sql) => sql.indexOf('SET ') + 4;
  const a = `UPDATE t SET a = 1, b = 2 WHERE id = ?`;
  assert.equal(setClause(a, at(a)).trim(), 'a = 1, b = 2');

  // A column named in the WHERE is not the SET clause's to vouch for; the
  // guard deliberately attributes only SET columns, where the table is certain.
  const b = `UPDATE t SET a = 1 WHERE weird_col = ?`;
  assert.doesNotMatch(setClause(b, at(b)), /weird_col/);

  // 'WHERE' as prose inside a value must not end the clause early.
  const c = `UPDATE t SET note = 'ask them WHERE they are', b = 2 WHERE id = ?`;
  assert.match(setClause(c, at(c)), /b = 2/);

  // RETURNING and FROM terminate it too.
  const d = `UPDATE t SET a = 1 RETURNING id`;
  assert.equal(setClause(d, at(d)).trim(), 'a = 1');
});

test('the columns the UPDATE pass found are now present', () => {
  const schema = knownColumns();
  // Migration 180. Its absence broke the advisor's headline question too,
  // because both answered-checks ride on one SELECT.
  assert.ok(schema.get('users')?.has('organization'), 'users.organization should be known');
  // `pipeline_stage` exists on no table; both writers now use `stage`.
  const owners = [...schema].filter(([, c]) => c && c.has('pipeline_stage')).map(([t]) => t);
  assert.deepEqual(owners, [], 'nothing should define pipeline_stage');
  assert.ok(schema.get('projects')?.has('stage'), 'projects.stage is the real column');
});

test('a SELECT is only attributed when exactly one table can own the columns', () => {
  const one = singleTableSelect('SELECT a, b FROM widgets WHERE id = ?');
  assert.equal(one?.table, 'widgets');
  assert.equal(one.list.trim(), 'a, b');

  const aliased = singleTableSelect('SELECT w.a FROM widgets w WHERE id = ?');
  assert.equal(aliased?.alias, 'w');

  // Each of these makes attribution a guess, so the check declines.
  for (const sql of [
    'SELECT a FROM widgets JOIN gadgets g ON g.id = widget_id',
    'SELECT * FROM widgets',
    'SELECT a FROM widgets UNION SELECT a FROM gadgets',
    'WITH x AS (SELECT 1) SELECT a FROM x',
    'SELECT a FROM (SELECT a FROM widgets)',
  ]) {
    assert.equal(singleTableSelect(sql), null, `should decline: ${sql}`);
  }
});

test('both dynamic-ALTER loop shapes are read', () => {
  const flat = runtimeColumns(
    "for (const col of ['notes TEXT', 'follow_up_at TEXT']) {\n"
    + '  await env.DB.prepare(`ALTER TABLE advisor_profiles ADD COLUMN ${col}`).run();\n}',
  );
  assert.deepEqual(flat, [{ table: 'advisor_profiles', cols: ['notes', 'follow_up_at'] }]);

  const tuple = runtimeColumns(
    "for (const [col, decl] of [['utm_json', 'TEXT'], ['referrer', 'TEXT']]) {\n"
    + '  await env.DB.prepare(`ALTER TABLE contacts ADD COLUMN ${col} ${decl}`).run();\n}',
  );
  assert.deepEqual(tuple, [{ table: 'contacts', cols: ['utm_json', 'referrer'] }]);
});

test("an apostrophe in a comment does not swallow the array", () => {
  // `// at D1's 100-column limit` opened a string scan that ate the rest of
  // the file, which is how SETTINGS_USER_COLUMNS came back unresolved.
  const src = "const COLS = [\n"
    + "  ['bio', 'TEXT'],\n"
    + "  // near D1's 100-column limit; see ensureProfileExpansionSchema\n"
    + "  ['headline', 'TEXT'],\n"
    + '];\n'
    + 'for (const [col, type] of COLS) {\n'
    + '  await db.prepare(`ALTER TABLE users ADD COLUMN ${col} ${type}`).run();\n}';
  assert.deepEqual(runtimeColumns(src), [{ table: 'users', cols: ['bio', 'headline'] }]);
});

test('nothing is left unreadable, and no column is invented', () => {
  const s = knownColumns();   // populates incompleteTables as a side effect
  assert.equal(incompleteTables.size, 0,
    `every dynamic-ALTER loop should resolve; unread: ${[...incompleteTables].join(', ')}`);

  // The columns those loops add are now known — this is what the skip rule cost.
  assert.ok(s.get('users')?.has('kyc_provider'), 'users.kyc_provider comes from KYC_COLUMNS');
  assert.ok(s.get('users')?.has('jwt_min_iat'), 'users.jwt_min_iat comes from SETTINGS_USER_COLUMNS');
  assert.ok(s.get('partners')?.has('oh_when_to_book'), 'partners gains its office-hours guidance columns');

  // `ADD COLUMN ${col}` backtracks and hands back the word COLUMN as the name;
  // `ALTER TABLE ... ADD COLUMN` in prose is not a table called `...`.
  assert.equal([...s].filter(([, c]) => c && c.has('column')).length, 0, 'no phantom `column`');
  assert.ok(!s.has('...'), 'no phantom `...` table');
});

test('the columns the runtime-harvest pass found are now right', () => {
  const s = knownColumns();
  // partners has email/company and no user link; the link is users.partner_id.
  assert.ok(s.get('partners')?.has('email') && !s.get('partners')?.has('contact_email'));
  assert.ok(s.get('partners')?.has('company') && !s.get('partners')?.has('organization'));
  assert.ok(!s.get('partners')?.has('user_id') && s.get('users')?.has('partner_id'));
  // kyb_status is on no table at all — the KYB flow does not write one.
  assert.equal([...s].filter(([, c]) => c && c.has('kyb_status')).length, 0);
  // projects carries neither; the composite lives in score_snapshots.
  assert.ok(!s.get('projects')?.has('score') && !s.get('projects')?.has('ai_decision'));
});

test('the columns the SELECT pass found are now right', () => {
  const s = knownColumns();
  // Each pair is a real fix: the name on the left was queried, the one on the
  // right is what the table actually has.
  assert.ok(!s.get('activity_logs')?.has('target_type') && s.get('activity_logs')?.has('entity_type'));
  assert.ok(!s.get('calendar_events')?.has('location') && s.get('calendar_events')?.has('location_uri'));
  assert.ok(!s.get('founders')?.has('user_id') && s.get('users')?.has('founder_id'));
  assert.ok(!s.get('integrations')?.has('provider_name') && s.get('integrations')?.has('provider_key'));
  assert.ok(!s.get('queue_jobs')?.has('fund_id'), 'the fund id lives in the payload JSON');
  assert.ok(!s.get('score_snapshots')?.has('score') && s.get('score_snapshots')?.has('total_score'));
});

test('the worker INSERTs, UPDATEs and SELECTs no column that does not exist', () => {
  // The runnable form of the whole exercise. `check-sqlite-columns` is the
  // gate; this keeps the property visible in the test suite too. Covers both
  // INSERT lists, UPDATE SET clauses and single-table SELECT lists.
  const unknown = [...unknownColumns().keys()].sort();
  assert.deepEqual(unknown, [], `unknown columns: ${unknown.join(', ')}`);
});

test('every table the worker queries is created somewhere', () => {
  const known = knownTables();
  assert.ok(known.size > 300, `expected a few hundred tables, got ${known.size}`);
  assert.ok(known.has('workflows') && known.has('workflow_tasks') && known.has('shared_services_log'),
    'migration 177 should have defined all three');
});
