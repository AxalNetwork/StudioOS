/**
 * The parsers behind the schema guards, tested on the shapes that fooled them.
 *
 * `check-sqlite-tables` and `check-sqlite-columns` are only as good as their
 * reading of the source. Eleven distinct parser faults were found while building
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
import fs from 'node:fs';
import { sqlStrings } from '../../scripts/check-sqlite-dialect.mjs';
import { collapseStringConcat, knownColumns, unknownColumns, setClause, singleTableSelect, incompleteTables, runtimeColumns, aliasMap, singleTablePredicate, predicateIdents, blankLiterals, substituteBindings, coverage } from '../../scripts/check-sqlite-columns.mjs';
import { stripSqlLiterals, knownTables } from '../../scripts/check-sqlite-tables.mjs';
import { routedWrites, mapColumns, assignmentBrace, unroutableColumns, unroutableSavedTo } from '../../scripts/check-write-router-columns.mjs';
import { tableColumns, fatalCollisions, definitions } from '../../scripts/check-sqlite-table-collisions.mjs';
import { isMoney, nonIntegerCents, floatMoney } from '../../scripts/check-money-cents.mjs';
import { selectKeys, typeFields, phantomFields, coverage as genericCoverage } from '../../scripts/check-row-generics.mjs';
import { parseSections, bindings, missingFromProduction, unknownTables } from '../../scripts/check-wrangler-binding-parity.mjs';
import { codeqlIgnores, semgrepIgnores, generatedTrees, gaps } from '../../scripts/check-scanner-ignore-parity.mjs';

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
  // Migration 180. `users` is at D1's 100-column limit, so the advisor's
  // organization answer belongs in the existing one-to-one profile sidecar.
  assert.ok(schema.get('user_profile_ext')?.has('organization'), 'user_profile_ext.organization should be known');
  assert.ok(!schema.get('users')?.has('organization'), 'users.organization must not consume another users column');
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

test('an alias is only trusted when it binds to exactly one table', () => {
  const one = aliasMap('SELECT p.id FROM partners p LEFT JOIN users u ON u.partner_id = p.id');
  assert.equal(one.get('p'), 'partners');
  assert.equal(one.get('u'), 'users');

  // `JOIN t ON …` must not bind an alias called `on`.
  assert.equal(aliasMap('SELECT a FROM widgets JOIN gadgets ON gadgets.id = 1').get('on'), undefined);

  // The same alias on two tables is ambiguous; null means "do not judge".
  const ambiguous = aliasMap('SELECT x.a FROM partners x JOIN projects x ON 1=1');
  assert.equal(ambiguous.get('x'), null);
});

test('the columns the qualified-reference pass found are now right', () => {
  const s = knownColumns();
  assert.ok(s.get('esign_envelopes')?.has('document_type') && !s.get('esign_envelopes')?.has('agreement_type'));
  assert.ok(s.get('users')?.has('full_legal_name') && !s.get('users')?.has('full_name'));
  assert.ok(s.get('users')?.has('headshot_r2_key') && !s.get('users')?.has('avatar_url'));
  // The directory opt-out is real, just on another table — it was preserved,
  // not dropped, because widening a people directory is not a repair.
  assert.ok(s.get('user_settings')?.has('show_in_directory'));
  assert.ok(!s.get('users')?.has('show_in_directory'));
  assert.ok(!s.get('projects')?.has('owner_user_id') && s.get('projects')?.has('founder_id'));
  // The second copy of the partner_deals query, matching the first.
  assert.ok(s.get('partner_deals')?.has('user_id') && !s.get('partner_deals')?.has('partner_user_id'));
  assert.ok(!s.get('partner_deals')?.has('granted_tiers') && s.get('partner_deals')?.has('granted_tier_founder'));
});

test('a subquery puts a second table in scope, so the predicate is declined', () => {
  // Parser fault #10. Counting SELECTs is not enough: an UPDATE has none of
  // its own, so `UPDATE users … (SELECT … FROM users)` counts exactly one and
  // the inner FROM was read as a column of the outer table.
  assert.equal(
    singleTablePredicate(
      'UPDATE users SET tier = ? WHERE seat_primary_user_id IN (SELECT id FROM users WHERE customer_id = ?)',
    ),
    null,
  );
  assert.equal(
    singleTablePredicate(
      "UPDATE limited_partners SET returns = returns + ? WHERE id = ? AND EXISTS (SELECT 1 FROM fund_distributions WHERE id = ?)",
    ),
    null,
  );
  // Without a subquery the same statement shape is read normally.
  const ok = singleTablePredicate('UPDATE users SET tier = ? WHERE stripe_customer_id = ?');
  assert.equal(ok.table, 'users');
});

test('a SELECT-list alias is a result name, not a column', () => {
  // Parser fault #11 — twenty-one of the first twenty-nine findings.
  const p = singleTablePredicate(
    "SELECT substr(created_at, 1, 10) AS day, SUM(est_cost_usd) AS total_cost FROM ai_usage_logs WHERE created_at >= ? GROUP BY day ORDER BY total_cost DESC",
  );
  assert.equal(p.table, 'ai_usage_logs');
  assert.ok(p.aliases.has('day') && p.aliases.has('total_cost'));

  const named = predicateIdents(p.region).map((x) => x.col);
  assert.ok(named.includes('created_at'), 'a real column is still named');
  // …and the function wrapping it is not.
  assert.ok(!named.includes('substr') && !named.includes('sum'));
});

test('a predicate reads columns, never comments or literals', () => {
  const blanked = blankLiterals("SELECT id FROM t -- the filter never ran\n WHERE kind = 'archived'");
  assert.ok(!blanked.includes('never') && !blanked.includes('archived'));
  assert.ok(blanked.includes('kind'), 'the column survives');

  const p = singleTablePredicate("SELECT id FROM widgets WHERE kind = 'archived' -- was: status\n");
  assert.deepEqual(predicateIdents(p.region).map((x) => x.col), ['where', 'kind']);
});

test('a join or a comma join is declined, a lone table is not', () => {
  assert.equal(singleTablePredicate('SELECT a FROM x JOIN y ON y.id = x.id WHERE x.a = 1'), null);
  assert.equal(singleTablePredicate('SELECT a FROM x, y WHERE x.id = y.id'), null);
  assert.equal(singleTablePredicate('SELECT a FROM x WHERE a = 1 UNION SELECT b FROM y'), null);
  assert.equal(singleTablePredicate('SELECT a FROM widgets w WHERE w.kind = ?').alias, 'w');
});

test('the two predicate defects are corrected at the source', () => {
  const s = knownColumns();
  // dd_external_sources names the connector `connector`; `source_kind` is the
  // sibling column on dd_findings, which is how the mistake was made.
  assert.ok(s.get('dd_external_sources')?.has('connector'));
  assert.ok(!s.get('dd_external_sources')?.has('source_kind'));
  assert.ok(s.get('dd_findings')?.has('source_kind'));
  // `documents` has no signer email at all — only signed_by, set once signed.
  assert.ok(!s.get('documents')?.has('signer_email') && s.get('documents')?.has('signed_by'));
  // The canonical per-recipient link, and the audit table the name came from.
  assert.ok(s.get('esign_recipients')?.has('recipient_email'));
  assert.ok(s.get('esign_audit_events')?.has('signer_email'));
});

test('a tagged-template interpolation is the bound ? it becomes', () => {
  assert.equal(
    substituteBindings('SELECT id FROM t WHERE a = ${x} AND b = ${y}'),
    'SELECT id FROM t WHERE a = ? AND b = ?',
  );
  // Braces are matched, not scanned to the first `}` — an interpolation can
  // carry an object literal or a nested template.
  assert.equal(
    substituteBindings('SELECT id FROM t WHERE a = ${JSON.stringify({ b: 1 })}'),
    'SELECT id FROM t WHERE a = ?',
  );
  assert.equal(substituteBindings('SELECT ${oops FROM t'), null, 'unbalanced declines');
  assert.equal(substituteBindings('SELECT id FROM t'), 'SELECT id FROM t', 'no-op when literal');
});

test('the guard reports how much of the SQL it actually read', () => {
  unknownColumns();
  // Raw `.prepare(`/`.exec(` interpolation can splice an identifier, so those
  // stay skipped and the count is printed rather than hidden.
  assert.ok(coverage.read > 3500, `expected most strings read, got ${coverage.read}`);
  assert.ok(coverage.skipped > 0 && coverage.skipped < 500, `unexpected skip count ${coverage.skipped}`);
});

test('the ten tagged-template defects are corrected at the source', () => {
  const s = knownColumns();
  // A booking carries no time of its own; the slot does.
  assert.ok(!s.get('advisor_bookings')?.has('scheduled_start'));
  assert.ok(s.get('advisor_bookings')?.has('slot_id') && s.get('advisor_bookings')?.has('founder_user_id'));
  assert.ok(s.get('advisor_office_hour_slots')?.has('starts_at') && s.get('advisor_office_hour_slots')?.has('meeting_url'));
  assert.ok(s.get('partner_office_hour_slots')?.has('starts_at'));
  assert.ok(s.get('advisors')?.has('display_name') && !s.get('advisors')?.has('name'));
  // founders is reached through users.founder_id, never the other way.
  assert.ok(!s.get('founders')?.has('user_id') && s.get('users')?.has('founder_id'));
  // projects owns founder_id; submitted_by is a tickets column, score a snapshot one.
  assert.ok(!s.get('projects')?.has('submitted_by') && !s.get('projects')?.has('user_id'));
  assert.ok(!s.get('projects')?.has('score') && s.get('score_snapshots')?.has('total_score'));
  assert.ok(s.get('tickets')?.has('submitted_by') && s.get('tickets')?.has('title') && !s.get('tickets')?.has('subject'));
  // The third copy of the partner_deals join.
  assert.ok(!s.get('partner_deals')?.has('partner_user_id'));
  // Migration 181 — the write existed, the column did not.
  assert.ok(s.get('calendar_sync_records')?.has('last_error'));
});

test('the worker INSERTs, UPDATEs and SELECTs no column that does not exist', () => {
  // The runnable form of the whole exercise. `check-sqlite-columns` is the
  // gate; this keeps the property visible in the test suite too. Covers both
  // INSERT lists, UPDATE SET clauses, single-table SELECT lists, qualified
  // join references and single-table predicates.
  // One reviewed gap remains on record: corporate_profiles.kyb_status, where
  // nothing writes a KYB decision at all, so a column would not help.
  const unknown = [...unknownColumns().keys()].sort();
  assert.deepEqual(unknown, ['corporate_profiles.kyb_status'], `unexpected: ${unknown.join(', ')}`);
});

test('a map is resolved by name, never by proximity', () => {
  // Parser fault #12. Binding each UPDATE to the nearest preceding map
  // attributed partnerMap's six columns to explorer_needs and invented six
  // defects. Names are unique enough; distance is not.
  const src = [
    "const partnerMap = { 'a.b': 'organization', 'c.d': 'role_title' };",
    "const pcol = partnerMap[questionId];",
    "await db.prepare(`UPDATE partner_profiles SET ${pcol} = ?`);",
    "const sharedLeaf = EXPLORER_SHARED_LEAF_MAP[leaf];",
    "await db.prepare(`UPDATE explorer_needs SET ${sharedLeaf.col} = ?`);",
  ].join('\n');
  const w = routedWrites(src);
  assert.equal(w.length, 2);
  assert.deepEqual(w[0], { table: 'partner_profiles', expr: 'pcol', line: 3, map: 'partnerMap', columns: ['organization', 'role_title'] });
  // The explorer map is declared elsewhere, so it resolves to no columns —
  // reported as unresolved rather than borrowing partnerMap's.
  assert.deepEqual(w[1].columns, []);
});

test('an arrow type in a declaration is not the assignment', () => {
  // The guard's own near-miss: `Record<string, { coerce?: (v: string) => n }>`
  // made the first version resolve 2 maps of 6 and report success on the rest.
  const decl = "const map: Record<string, { col: string; coerce?: (v: string) => number }> = { 'q': { col: 'bio' } };";
  const brace = assignmentBrace(decl, decl.indexOf('map') + 3);
  assert.equal(decl[brace], '{');
  assert.deepEqual(mapColumns(decl.slice(brace + 1)), ['bio']);
});

test('a two-literal ternary is a column choice, not a map', () => {
  const src = [
    "const col = questionId === 'founder.brand.tagline' ? 'tagline' : 'theme_color';",
    "await db.prepare(`UPDATE landing_pages SET ${col} = ?`);",
  ].join('\n');
  assert.deepEqual(routedWrites(src)[0].columns, ['tagline', 'theme_color']);
});

test('every column the advisor writeRouter routes to actually exists', () => {
  assert.deepEqual(unroutableColumns(), []);
  assert.deepEqual(unroutableSavedTo(), []);
  // Migration 182 — 042 added these three to `mentors`, a table nothing creates.
  const a = knownColumns().get('advisors');
  assert.ok(a?.has('topics_willing_json') && a?.has('topics_unwilling_json') && a?.has('weekly_hours_band'));
});

test('only a NOT NULL column with no default makes an omission fatal', () => {
  const cols = tableColumns([
    'id INTEGER PRIMARY KEY AUTOINCREMENT',
    "uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16))))",
    'amount REAL NOT NULL',
    'notes TEXT',
    "status TEXT NOT NULL DEFAULT 'pending'",
    '-- commented_out TEXT NOT NULL',
  ].join(',\n'));
  assert.equal(cols.get('amount'), true, 'NOT NULL with no default is required');
  assert.equal(cols.get('uid'), false, 'a default satisfies the constraint');
  assert.equal(cols.get('id'), false, 'a rowid alias is filled in');
  assert.equal(cols.get('status'), false);
  assert.equal(cols.get('notes'), false);
  assert.ok(!cols.has('commented_out'), 'a commented-out column is not a column');
});

test('a collision counts only when neither definition can host the other', () => {
  const all = fatalCollisions();
  // Both directions must be fatal: a strict subset is an older shape a later
  // ALTER filled in, which is ordinary rather than a conflict.
  for (const [, pairs] of all) {
    for (const p of pairs) {
      assert.ok(p.aNeeds.length && p.bNeeds.length, 'one-directional pairs must not be reported');
    }
  }
  assert.deepEqual([...all.keys()].sort(), [
    'advisor_bookings', 'calendar_events', 'capital_calls', 'founder_checkins',
    'ic_meetings', 'metrics_snapshots', 'service_offerings', 'wellbeing_resources',
  ]);
});

test('the column guard unions competing definitions, which is why it cannot see them', () => {
  // Not a defect — a stated limitation, pinned so it stays true. capital_calls
  // has two irreconcilable definitions; knownColumns reports their union, which
  // is wider than either.
  const defs = definitions().get('capital_calls');
  assert.ok(defs.length >= 2);
  const union = knownColumns().get('capital_calls');
  for (const d of defs) assert.ok(union.size > d.cols.size, 'the union exceeds every single definition');
  assert.ok(union.has('amount') && union.has('amount_cents'), 'both money shapes appear at once');
});

test('a money word is not the same as an amount of money', () => {
  // The classifier over-matched in both directions before these exclusions.
  for (const yes of ['amount', 'amount_cents', 'price_usd', 'mrr', 'monthly_burn_usd',
                     'called_capital', 'nav', 'cash_balance', 'market_cap', 'hourly_rate']) {
    assert.ok(isMoney(yes), `${yes} should read as money`);
  }
  for (const no of [
    'management_fee_pct',   // a percentage
    'carried_interest',     // a fraction — vc_funds defaults it to 0.20
    'usd_rate',             // an exchange rate
    'total_shares',         // a count
    'capital_total',        // a score component
    'total_score',          // a score
    'distributed_at',       // a timestamp
    'principal_key',        // a security principal
    'revenue_range',        // a band label
    'revenue_notes',        // prose
  ]) {
    assert.ok(!isMoney(no), `${no} should not read as money`);
  }
});

test('every *_cents column is an integer, and the legacy dollar list is closed', () => {
  assert.deepEqual(nonIntegerCents(), [], 'a REAL cents column promises what it cannot deliver');
  // 52 legacy REAL dollar columns are on record. The gate fails on a 53rd, and
  // equally on one of the 52 that has since been converted.
  const baseline = JSON.parse(
    fs.readFileSync(new URL('../../scripts/money-cents-baseline.json', import.meta.url), 'utf8'),
  ).columns;
  const found = [...floatMoney().keys()].sort();
  assert.deepEqual(found, Object.keys(baseline).sort());
  assert.ok(found.includes('limited_partners.commitment_amount'), 'fiduciary amounts are in the ledger');
});

test('an alias names the result whatever the expression is', () => {
  assert.deepEqual(selectKeys('SELECT p.id, u.name AS owner, COUNT(*) AS n FROM projects p'),
    ['id', 'owner', 'n']);
  // Testing the whole list for `*` up front declined every aggregate query and
  // cost about a third of the coverage.
  assert.deepEqual(selectKeys('SELECT COUNT(*) AS c FROM t'), ['c']);
  // A bare star, qualified or not, makes the shape the table's, not the query's.
  assert.equal(selectKeys('SELECT * FROM projects'), null);
  assert.equal(selectKeys('SELECT p.*, u.name AS owner FROM projects p'), null);
  // An expression with no alias is named after its own text; nobody reads it
  // that way, so the query is declined rather than guessed at.
  assert.equal(selectKeys('SELECT COALESCE(a,b), id FROM t'), null);
});

test('angle brackets are not brackets in a TypeScript row type', () => {
  // The `>` in an arrow type drove the depth negative and every field after it
  // was skipped — an under-report, which looks exactly like a clean pass.
  assert.deepEqual(
    typeFields('{ id: number; nested: { a: 1 }; fn: (x: number) => void; last: string }'),
    ['id', 'nested', 'fn', 'last'],
  );
  // And the outer braces must come off first, or every field sits at depth 1
  // and none of them is read at all.
  assert.deepEqual(typeFields('{ only: string }'), ['only']);
});

test('no row generic declares a field its SELECT does not return', () => {
  assert.deepEqual(phantomFields(), []);
  const { pairs, checked } = genericCoverage();
  assert.ok(checked > 150, `expected most pairs checkable, got ${checked} of ${pairs}`);
  assert.ok(pairs > checked, 'some are declined, and the count is printed rather than hidden');
});

test('a value may contain a hash, and a comment may not be read as one', () => {
  const secs = parseSections([
    '[[kv_namespaces]]',
    'binding = "TOKENS"   # the session token store',
    'id = "abc#123"',
    '[env.production]',
    'name = "studioos"',
  ].join('\n'));
  assert.equal(secs.length, 2);
  assert.equal(secs[0].kv.get('binding'), '"TOKENS"', 'a trailing comment is stripped');
  assert.equal(secs[0].kv.get('id'), '"abc#123"', 'a hash inside quotes is part of the value');
});

test('parity is by binding identity, not by section presence', () => {
  // The subtle case: the table exists in both, and a binding added to only one
  // of them would pass a name-only comparison.
  const secs = parseSections([
    '[[kv_namespaces]]', 'binding = "TOKENS"',
    '[[kv_namespaces]]', 'binding = "SESSION_CACHE"',
    '[[env.production.kv_namespaces]]', 'binding = "TOKENS"',
  ].join('\n'));
  const top = bindings(secs, '');
  const prod = bindings(secs, 'env.production.');
  assert.deepEqual([...top.get('kv_namespaces')].sort(), ['"SESSION_CACHE"', '"TOKENS"']);
  assert.deepEqual([...prod.get('kv_namespaces')], ['"TOKENS"']);
});

test('observability inherits and is excluded; routes are per-environment', () => {
  const secs = parseSections(['[observability]', 'enabled = true', '[[routes]]', 'pattern = "x"'].join('\n'));
  const top = bindings(secs, '');
  assert.ok(!top.has('observability'), 'the root config documents observability as inheriting');
  assert.ok(!top.has('routes'), 'routes are environment-specific by design');
});

test('every wrangler binding is re-declared under [env.production]', () => {
  // The 2026-05-05 login outage was a binding declared only at the top level.
  assert.deepEqual(unknownTables(), [], 'an unrecognised table cannot be compared, so it fails');
  assert.deepEqual(missingFromProduction(), []);
});

test('every table the worker queries is created somewhere', () => {
  const known = knownTables();
  assert.ok(known.size > 300, `expected a few hundred tables, got ${known.size}`);
  assert.ok(known.has('workflows') && known.has('workflow_tasks') && known.has('shared_services_log'),
    'migration 177 should have defined all three');
});

/* ------------------------------------------------------------------ *
 * check-scanner-ignore-parity — the two static-analysis ignore lists  *
 * ------------------------------------------------------------------ */

test('paths-ignore is read without a YAML dependency, quotes and all', () => {
  const src = [
    'name: "x"',
    '# a comment',
    'paths-ignore:',
    '  - docs',
    '  # why the next one is ignored',
    '  - "Axal VC platform"',
    "  - 'quoted too'",
    'queries: security-extended',
  ].join('\n');
  assert.deepEqual(codeqlIgnores(src), ['docs', 'Axal VC platform', 'quoted too']);
});

test('a key after the list ends the block rather than being read as an entry', () => {
  const src = ['paths-ignore:', '  - docs', 'paths:', '  - frontend'].join('\n');
  assert.deepEqual(codeqlIgnores(src), ['docs'], 'the `paths:` block is not an exclusion');
});

test('semgrep patterns are normalised, and an unanchored one is reported', () => {
  const { entries, unanchored } = semgrepIgnores([
    '# comment',
    '/docs/',
    '/Axal VC platform/',
    'docs',
  ].join('\n'));
  assert.deepEqual(entries, ['docs', 'Axal VC platform']);
  assert.deepEqual(unanchored, ['docs'],
    'a bare name would also strip frontend/src/lib/docs from the scan');
});

test('the generated trees on disk are found by their generator header', () => {
  const trees = generatedTrees();
  assert.ok(trees.includes('Axal VC platform'),
    'the canvases ship a dc-runtime bundle and must be discoverable');
  assert.ok(trees.includes('spin-out-lab-pipeline'),
    'the tree this rule was originally written for');
  assert.ok(!trees.includes('frontend') && !trees.includes('cloudflare-worker'),
    'real source must never be picked up as generated');
});

test('every generated tree is ignored by BOTH scanners', () => {
  // `Axal VC platform/` was in neither list: ~60 security alerts and 1345 of
  // 1384 quality findings came from a 49M tree that nothing builds or serves.
  assert.deepEqual(gaps(), []);
});
