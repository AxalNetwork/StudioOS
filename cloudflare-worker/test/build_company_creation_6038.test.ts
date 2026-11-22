/**
 * #6038 (D6038) — Company creation's company-first read: the entity summary,
 * one 83(b) row per founder and the company's papers, each its own block, on
 * the module page only. Through `routes/cycle_build.ts` over the real migrated
 * schema (`_build_reads.ts`). Every person, company and date is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_company_creation_6038.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReads, seedHolders, PROJECT } from './_build_reads.ts';
import { FORMED_SOURCE } from '../src/services/buildCompanyCreation.ts';

const page = (h: Awaited<ReturnType<typeof buildReads>>, user = 1) => h.get(`/api/cycles/build/modules/company-creation?project=${PROJECT}`, user);
const ahead = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function withVenture(setup: (db: any) => void) {
  const h = await buildReads(2);
  setup(h.db);
  return h;
}

test('no order, no entity and no company: has_company is false (BD26) and papers say not linked', async () => {
  const h = await withVenture((db) => db.exec(`UPDATE projects SET entity_id = NULL, company_id = NULL WHERE id = ${PROJECT}; DELETE FROM formation_steps;`));
  try {
    const r = await page(h);
    assert.equal(r.status, 200);
    assert.equal(r.body.facts.entity.state, 'ok');
    assert.equal(r.body.facts.entity.has_company, false);
    assert.equal(r.body.facts.entity.order, null);
    assert.equal(r.body.facts.entity.formed_on.value, null);
    assert.equal(r.body.facts.entity.formed_on.reason, 'No formation date is recorded.');
    assert.equal(r.body.facts.papers.state, 'not_linked');
    assert.deepEqual(r.body.facts.elections, { state: 'ok', rows: [], done: 0, total: 0 });
    // The existing facts stay.
    assert.ok('ip' in r.body.facts && 'incorporation' in r.body.facts);
  } finally { h.close(); }
});

test('a v2 order filed with the state: Formed on is the registry date, named as such; the order line has all three dates', async () => {
  const h = await withVenture((db) => db.exec(`
    INSERT INTO incorporations(id, user_id, project_id, jurisdiction_id, company_name, registered_agent_name, amount_cents, status, paid_at, packet_ready_at, filed_on, created_at)
      VALUES (900, 1, ${PROJECT}, 'DE', 'Synthetic Northline Inc', 'Synthetic Agent LLC', 50000, 'filed', '2026-10-01 10:00:00', '2026-10-06', '2026-10-09', '2026-09-30');
    INSERT INTO formation_cases(id, uid, user_id, intent, project_id, track, stage) VALUES (70, 'case-70', 1, 'convert_project', ${PROJECT}, 'v2', 'registered');
    INSERT INTO formation_case_orders(case_id, incorporation_id) VALUES (70, 900);
    INSERT INTO formation_steps(project_id, title, state, kind, sort_order, created_by) VALUES (${PROJECT}, 'EIN', 'done', 'ein', 99, 1);`));
  try {
    const e = (await page(h)).body.facts.entity;
    assert.equal(e.has_company, true);
    assert.deepEqual(e.name, { value: 'Synthetic Northline Inc', source: 'The incorporation order', reason: null });
    assert.equal(e.jurisdiction.value, 'DE');
    assert.equal(e.registered_agent.value, 'Synthetic Agent LLC');
    assert.deepEqual(e.formed_on, { value: '2026-10-09', source: FORMED_SOURCE.v2, reason: null });
    assert.equal(e.order.track, 'v2');
    assert.equal(e.order.status_label, 'Filed with state');
    assert.deepEqual(e.order.steps.map((s: any) => s.date), ['2026-10-01', '2026-10-06', '2026-10-09']);
    assert.equal(e.ein.state, 'issued');
    assert.equal(e.ein.label, 'Issued');
    assert.equal(e.ein.number, null, 'no column holds the EIN number');
  } finally { h.close(); }
});

test('a legacy order: the same filed_on is the submission day an admin typed, and says so', async () => {
  const h = await withVenture((db) => db.exec(`
    INSERT INTO incorporations(id, user_id, project_id, jurisdiction_id, company_name, amount_cents, status, paid_at, packet_ready_at, filed_on, created_at)
      VALUES (901, 1, ${PROJECT}, 'DE', 'Synthetic Legacy Inc', 50000, 'filed', '2026-08-01', '2026-08-04', '2026-08-07', '2026-07-30');`));
  try {
    const e = (await page(h)).body.facts.entity;
    assert.equal(e.order.track, 'legacy_v1');
    assert.deepEqual(e.formed_on, { value: '2026-08-07', source: FORMED_SOURCE.legacy_v1, reason: null });
    assert.equal(e.ein.state, 'not_recorded');
  } finally { h.close(); }
});

test('a v2 filing with the registry reads Packet ready, and no Filed with state date is drawn', async () => {
  const h = await withVenture((db) => db.exec(`
    INSERT INTO incorporations(id, user_id, project_id, jurisdiction_id, company_name, amount_cents, status, paid_at, packet_ready_at, filed_on, created_at)
      VALUES (902, 1, ${PROJECT}, 'DE', 'Synthetic Pending Inc', 50000, 'packet_ready', '2026-11-01', '2026-11-03', NULL, '2026-10-30');
    INSERT INTO formation_cases(id, uid, user_id, intent, project_id, track, stage) VALUES (71, 'case-71', 1, 'convert_project', ${PROJECT}, 'v2', 'submitted');
    INSERT INTO formation_case_orders(case_id, incorporation_id) VALUES (71, 902);
    UPDATE entities SET incorporation_date = NULL;`));
  try {
    const e = (await page(h)).body.facts.entity;
    assert.equal(e.order.status, 'packet_ready');
    assert.equal(e.order.status_label, 'Packet ready');
    assert.equal(e.order.steps[2].date, null);
    assert.equal(e.formed_on.value, null);
    assert.match(e.formed_on.reason, /Not filed with the state yet/);
  } finally { h.close(); }
});

test('one 83(b) row per founder: the viewer\'s, a co-founder\'s mailed tracker, a missed one, and one with nothing recorded', async () => {
  const h = await withVenture((db) => {
    seedHolders(db, 4);
    const holders = db.prepare(`SELECT id, user_id FROM cap_table_holders WHERE project_id = ${PROJECT} AND founder_role IS NOT NULL ORDER BY id`).all();
    const [a] = holders as any[];
    db.prepare(`INSERT INTO formation_steps(project_id, title, state, kind, due_date, for_holder_id, sort_order, created_by) VALUES (?, '83(b) election', 'todo', '83b', ?, ?, 50, 1)`).run(PROJECT, ahead(8), a.id);
    db.exec(`INSERT INTO section_83b_trackers(project_id, user_id, taxpayer_name, grant_date, deadline_date, mailed_at, receipt_doc_id, status)
        VALUES (${PROJECT}, 2, 'Synthetic holder 2', '2026-10-01', '2026-10-31', '2026-10-20', NULL, 'mailed');
      INSERT INTO section_83b_trackers(project_id, user_id, taxpayer_name, grant_date, deadline_date, status)
        VALUES (${PROJECT}, 3, 'Synthetic holder 3', '2026-01-02', '2026-02-01', 'pending');`);
  });
  try {
    const el = (await page(h)).body.facts.elections;
    assert.equal(el.state, 'ok');
    assert.equal(el.total, 3, 'the three founders, not the investor or option holders');
    const [mine, mailed, missed] = el.rows;
    assert.equal(mine.you, true);
    assert.equal(mine.status, 'pending');
    assert.equal(mine.deadline, ahead(8), 'no tracker: the deadline is the Build filing\'s due date');
    assert.equal(mine.proof, 'Missing', 'due within 30 days with no proof');
    assert.match(mine.filing_id, /^step-\d+$/);
    assert.equal(mine.grant_date, null);
    assert.match(mine.reason, /No 83\(b\) tracker/);
    assert.equal(mailed.you, false);
    assert.equal(mailed.status_label, 'Mailed');
    assert.equal(mailed.mailed_on, '2026-10-20');
    assert.equal(mailed.grant_date, '2026-10-01', 'Q1 A: a co-founder\'s row is read in full');
    assert.equal(mailed.proof, 'Missing', 'mailed with no receipt stored');
    assert.equal(missed.status, 'missed', 'a passed deadline with nothing mailed is Missed');
    assert.equal(el.done, 1);
  } finally { h.close(); }
});

test('a founder with neither tracker nor filing is Not recorded, with no deadline and no proof state', async () => {
  const h = await withVenture((db) => seedHolders(db, 1));
  try {
    const [row] = (await page(h)).body.facts.elections.rows;
    assert.equal(row.status, 'not_recorded');
    assert.equal(row.status_label, null);
    assert.equal(row.deadline, null);
    assert.equal(row.proof, null);
    assert.match(row.reason, /No 83\(b\) tracker or 83\(b\) filing/);
  } finally { h.close(); }
});

test('papers: a member reads the four slots as Stored or Missing; a viewer who is not a member is refused', async () => {
  const h = await withVenture((db) => db.exec(`
    INSERT INTO company_profiles(id, uid, company_name) VALUES (10, 'co-synthetic', 'Synthetic Co');
    INSERT INTO user_company_links(uid, company_id, user_id) VALUES ('link-1', 10, 1);
    INSERT INTO documents(company_id, title, doc_type, status, content, created_at)
      VALUES (10, 'Bylaws', 'bylaws', 'draft', '{"r2_key":"company/10/bylaws.pdf","content_type":"application/pdf"}', '2026-10-12 09:00:00');`));
  try {
    const papers = (await page(h)).body.facts.papers;
    assert.equal(papers.state, 'ok');
    assert.equal(papers.company_uid, 'co-synthetic');
    assert.deepEqual(papers.rows.map((r: any) => [r.kind, r.state]), [
      ['certificate_of_incorporation', 'Missing'], ['bylaws', 'Stored'], ['tax_id_letter', 'Missing'], ['registered_agent_agreement', 'Missing']]);
    assert.equal(papers.rows[1].at, '2026-10-12');
    assert.equal(papers.stored, 1);
    h.db.exec(`DELETE FROM user_company_links`);
    const refused = (await page(h)).body.facts.papers;
    assert.equal(refused.state, 'refused');
    assert.deepEqual(refused.rows, [], 'nothing from the record, not even counts');
    assert.equal(refused.company_uid, null);
  } finally { h.close(); }
});

test('each block fails on its own: no 83(b) store leaves the summary, the papers and the filings readable', async () => {
  const h = await withVenture((db) => { seedHolders(db, 2); db.exec('DROP TABLE section_83b_trackers'); });
  try {
    const r = await page(h);
    assert.equal(r.status, 200);
    assert.equal(r.body.card.state, 'ok');
    assert.equal(r.body.facts.elections.state, 'unreadable');
    assert.equal(r.body.facts.elections.total, null, 'not a measured zero');
    assert.equal(r.body.facts.entity.state, 'ok');
    assert.ok(r.body.records.rows.length > 0);
  } finally { h.close(); }
});

test('the overview reads none of the new blocks, and next_filing names its row', async () => {
  const h = await withVenture(() => {});
  try {
    const o = await h.get(`/api/cycles/build/overview?project=${PROJECT}`);
    assert.equal(o.status, 200);
    assert.equal(o.log.some((s: any) => /section_83b_trackers|company_profiles|formation_case_orders/.test(s.sql)), false);
    const m = (await page(h)).body;
    assert.ok(m.facts.next_filing == null || /^(lab|step|obligation)-/.test(m.facts.next_filing.id));
  } finally { h.close(); }
});
