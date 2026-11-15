/**
 * #6031 (D6031, BD8) — Prototype / MVP's table: a Test cell naming the latest
 * session, Built and Tested as two marks that never borrow each other's state,
 * the summary's `blocked` figure, and the next blocked or due must-have as the
 * page's dominant action.
 *
 * Through `routes/cycle_build.ts` over the real migrated schema (`_build_reads.ts`):
 *   1. Test names the latest session (dated newest first, then undated); with
 *      none it reads Not expected yet before Done and Not recorded after;
 *      the hypothesis's claim is no longer drawn as a test;
 *   2. Tested needs a done session with a finding; Built comes from GitHub's
 *      pull request state, else the delivery status;
 *   3. an unreadable GitHub part makes Built Unavailable and nothing else; an
 *      unreadable session store makes Test and Tested Unavailable and nothing else;
 *   4. Built names the production deploy Vercel recorded for a merged must-have;
 *   5. facts carry `blocked`, and the card's next is the next blocked, else due, must-have;
 *   6. the sessions read is one statement for the page's 25 must-haves, also on the SQL page.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_mvp_marks_6031.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReads, PROJECT } from './_build_reads.ts';
import { builtMark } from '../src/routes/cycle_build.ts';

const page = (h: any, query = '') => h.get(`/api/cycles/build/modules/prototype-mvp?project=${PROJECT}${query}`);
const byTitle = (body: any) => Object.fromEntries(body.records.rows.map((r: any) => [r.cells.must_have, r.cells]));

/** Six must-haves, each covering one case; ids 1–6 in this order. */
async function seeded() {
  const h = await buildReads(0);
  h.db.exec(`
    INSERT INTO hypotheses(id, project_id, code, claim) VALUES (1, ${PROJECT}, 'H1', 'Synthetic claim that is not a test');
    INSERT INTO mvp_features(id, project_id, title, is_must_have, delivery_status, hypothesis_id, due_date, sort_order, pr_state) VALUES
      (1, ${PROJECT}, 'Synthetic tested', 1, 'Done', 1, '2026-12-20', 1, 'built'),
      (2, ${PROJECT}, 'Synthetic done untested', 1, 'Done', NULL, NULL, 2, NULL),
      (3, ${PROJECT}, 'Synthetic building', 1, 'In Progress', 1, '2026-12-05', 3, 'in_review'),
      (4, ${PROJECT}, 'Synthetic blocked', 1, 'Blocked', NULL, '2026-12-30', 4, NULL),
      (5, ${PROJECT}, 'Synthetic not started', 1, 'Backlog', NULL, '2026-12-01', 5, NULL),
      (6, ${PROJECT}, 'Synthetic planned only', 1, 'In Progress', NULL, NULL, 6, NULL);
    INSERT INTO mvp_test_sessions(id, project_id, feature_id, title, held_on, status) VALUES
      (1, ${PROJECT}, 1, 'Synthetic usability round', '2026-11-02', 'done'),
      (2, ${PROJECT}, 1, 'Synthetic concierge round', '2026-11-09', 'done'),
      (3, ${PROJECT}, 1, 'Synthetic undated round', NULL, 'planned'),
      (4, ${PROJECT}, 2, 'Synthetic session with no finding', '2026-11-03', 'done'),
      (5, ${PROJECT}, 6, 'Synthetic planned round', '2026-12-01', 'planned');
    INSERT INTO mvp_test_findings(session_id, text, direction) VALUES (1, 'Synthetic finding', 'supports');
  `);
  return h;
}

test('1–2. Test names the latest session; Tested and Built each read their own source', async () => {
  // Mutation checked: the latest ordered oldest first → "Synthetic usability round";
  // Tested counting any done session (no finding needed) → "Synthetic done untested" reads Tested;
  // Tested reading the delivery status → "Synthetic done untested" reads Tested;
  // Built ignoring GitHub's state → "Synthetic building" reads Not expected yet.
  const h = await seeded();
  try {
    const r = await page(h);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.records.cols.map((c: any) => c.key), ['must_have', 'test', 'state', 'owner', 'due', 'built', 'tested']);
    const c = byTitle(r.body);
    const NOT_EXPECTED = { text: 'Not expected yet', tone: 'grey' };
    assert.deepEqual([c['Synthetic tested'].test, c['Synthetic tested'].tested, c['Synthetic tested'].built],
      ['Synthetic concierge round', { text: 'Tested', tone: 'ok' }, { text: 'Built', tone: 'ok' }]);
    assert.deepEqual([c['Synthetic done untested'].test, c['Synthetic done untested'].tested, c['Synthetic done untested'].built],
      ['Synthetic session with no finding', null, { text: 'Built', tone: 'ok' }], 'a done session with no finding is not Tested; Done with no pull request is Built');
    assert.deepEqual([c['Synthetic building'].test, c['Synthetic building'].tested, c['Synthetic building'].built],
      [NOT_EXPECTED, NOT_EXPECTED, { text: 'In review', tone: 'v1' }]);
    assert.deepEqual([c['Synthetic blocked'].test, c['Synthetic blocked'].tested, c['Synthetic blocked'].built], [null, null, null], 'blocked: Not recorded');
    assert.deepEqual([c['Synthetic not started'].test, c['Synthetic not started'].built], [NOT_EXPECTED, NOT_EXPECTED]);
    assert.deepEqual([c['Synthetic planned only'].test, c['Synthetic planned only'].tested], ['Synthetic planned round', NOT_EXPECTED]);
    assert.ok(!JSON.stringify(r.body.records.rows).includes('Synthetic claim that is not a test'), 'the hypothesis claim is not drawn as a test');
    // The Hypothesis filter still offers it.
    assert.deepEqual(r.body.records.filters.find((f: any) => f.key === 'hypothesis').options.map((o: any) => o.label), ['Synthetic claim that is not a test', 'No hypothesis']);
  } finally { h.close(); }
});

test('3. an unreadable connector is Unavailable for Built only; an unreadable session store for Test and Tested only', async () => {
  // Mutation checked: GitHub's failure ignored → Built reads Built; the sessions read's failure not caught → the module is Unreadable.
  const h = await seeded();
  try {
    const UNAVAILABLE = { text: 'Unavailable', tone: 'warn' };
    h.db.exec('ALTER TABLE mvp_features RENAME COLUMN pr_url TO pr_url_synthetic');
    let c = byTitle((await page(h)).body);
    assert.deepEqual(c['Synthetic tested'].built, UNAVAILABLE);
    assert.deepEqual(c['Synthetic done untested'].built, UNAVAILABLE);
    assert.deepEqual([c['Synthetic tested'].tested, c['Synthetic tested'].test], [{ text: 'Tested', tone: 'ok' }, 'Synthetic concierge round'], 'Tested keeps its own state');
    h.db.exec('ALTER TABLE mvp_features RENAME COLUMN pr_url_synthetic TO pr_url; ALTER TABLE mvp_test_findings RENAME TO mvp_test_findings_synthetic');
    const r = await page(h);
    assert.equal(r.status, 200);
    assert.notEqual(r.body.card.state, 'unreadable');
    c = byTitle(r.body);
    for (const cells of Object.values(c) as any[]) assert.deepEqual([cells.test, cells.tested], [UNAVAILABLE, UNAVAILABLE]);
    assert.deepEqual(c['Synthetic tested'].built, { text: 'Built', tone: 'ok' }, 'Built keeps its own state');
  } finally { h.close(); }
});

test('4. a merged must-have names the production deploy Vercel recorded for it', () => {
  // Mutation checked: the date dropped → "Built"; an unreadable Vercel part read as a deploy → it names one.
  const github = { state: 'ok', must_haves: [{ id: 7, state: 'built', label: 'Built' }] };
  assert.deepEqual(builtMark(7, 'done', github, { state: 'ok', must_haves: [{ feature_id: 7, in_production_since: '2026-11-06T10:00:00Z' }] }),
    { text: 'Built · in production since 6 Nov 2026', tone: 'ok' });
  assert.deepEqual(builtMark(7, 'done', github, { state: 'unreadable' }), { text: 'Built', tone: 'ok' });
  assert.deepEqual(builtMark(7, 'done', github, { state: 'ok', must_haves: [{ feature_id: 7, in_production_since: null }] }), { text: 'Built', tone: 'ok' });
  assert.deepEqual(builtMark(7, 'done', { state: 'unreadable' }, null), { text: 'Unavailable', tone: 'warn' });
});

test('5. the summary counts the blocked; the dominant action is the next blocked, else due, must-have', async () => {
  // Mutation checked: blocked first dropped → "Complete Synthetic not started" while one is blocked;
  // due order dropped → "Complete Synthetic building" (read order) once nothing is blocked.
  const h = await seeded();
  try {
    let r = await page(h);
    assert.deepEqual(r.body.facts, { done: 2, total: 6, blocked: 1, target_date: r.body.facts.target_date, can_set_target: true,
      // #6027: the overdue count depends on today against these December due dates; build_overview_6027 pins it.
      overdue: r.body.facts.overdue });
    assert.equal(r.body.card.next?.text, 'Unblock Synthetic blocked');
    h.db.exec(`UPDATE mvp_features SET delivery_status = 'In Progress' WHERE id = 4`);
    r = await page(h);
    assert.equal(r.body.facts.blocked, 0);
    assert.equal(r.body.card.next?.text, 'Complete Synthetic not started', 'the earliest due date (1 Dec) among those not done');
    h.db.exec(`UPDATE mvp_features SET due_date = NULL WHERE project_id = ${PROJECT}`);
    r = await page(h);
    assert.equal(r.body.card.next?.text, 'Complete Synthetic building', 'with no due dates, the first not done in read order');
    // Mutation checked: `can_set_target` not gated on canWrite → the partner is offered Set.
    h.db.exec(`INSERT INTO users(id, role, name, email, is_active) VALUES (3, 'partner', 'Synthetic partner', 'partner@example.invalid', 1)`);
    const partner = await h.get(`/api/cycles/build/modules/prototype-mvp?project=${PROJECT}`, 3);
    assert.equal(partner.status, 200, 'a partner reads the board');
    assert.equal(partner.body.facts.can_set_target, false, 'but may not set the date');
    const o = await h.get(`/api/cycles/build/overview?project=${PROJECT}`);
    assert.equal(o.status, 200);
  } finally { h.close(); }
});

test('6. the sessions read is one statement for the page\'s must-haves, on the SQL page and in memory', async () => {
  // Mutation checked: the read run once per must-have → 30 statements; the page's ids not bound → it reads another page's sessions.
  const h = await buildReads(0);
  try {
    const feat = h.db.prepare(`INSERT INTO mvp_features(project_id, title, is_must_have, delivery_status, sort_order) VALUES (?, ?, 1, 'Backlog', ?)`);
    for (let i = 1; i <= 30; i += 1) feat.run(PROJECT, `Synthetic page must ${i}`, i);
    const last = h.db.prepare(`SELECT id FROM mvp_features WHERE title = 'Synthetic page must 30'`).get() as any;
    h.db.prepare(`INSERT INTO mvp_test_sessions(project_id, feature_id, title, status) VALUES (?, ?, 'Synthetic second-page session', 'done')`).run(PROJECT, last.id);
    // The log keeps a statement's first 140 characters: the sessions read is the one that starts this way.
    const sessionsReads = (log: any[]) => log.filter((s) => s.sql.startsWith('SELECT s.feature_id, SUM(CASE WHEN s.status'));
    const first = await page(h, '&sort=state');
    assert.equal(sessionsReads(first.log).length, 1);
    assert.equal(sessionsReads(first.log)[0].rows, 0, 'the first page does not read the second page\'s session');
    const second = await page(h, '&sort=state&page=2');
    assert.equal(sessionsReads(second.log).length, 1);
    assert.ok(second.body.records.rows.some((r: any) => r.cells.test === 'Synthetic second-page session'));
    const searched = await page(h, '&q=page%20must%2030');
    assert.deepEqual(searched.body.records.rows.map((r: any) => r.cells.test), ['Synthetic second-page session']);
    assert.equal(sessionsReads(searched.log).length, 1);
  } finally { h.close(); }
});
