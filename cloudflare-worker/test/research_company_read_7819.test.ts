/** D7819 (#7819): canonical-schema public projections, review retention and independent freshness evidence.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): `research_company_read_7819.test.ts`
 * verifies the D7819 contract against synthetic inputs and the canonical migrated schema.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import {
  COUNTED_COMPANIES,
  REACHABLE_COMPANIES,
  readCompanyByUid,
  readCompaniesByUid,
} from '../src/services/researchCompanyRead.ts';
function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  for (const uid of ['unreviewed', 'admitted', 'held', 'excluded', 'withdrawn'])
    db.prepare(
      `INSERT INTO research_company_directory(uid,name,website,source_url,source_name,source_license,as_of) VALUES (?,?,'https://example.test','https://example.test/source','Synthetic publisher','Synthetic terms','2026-01-01')`,
    ).run(`7819-${uid}`, `Synthetic ${uid}`);
  for (const status of ['admitted', 'held', 'excluded', 'withdrawn'])
    db.prepare(
      `INSERT INTO research_company_reviews(uid,status,reason_code,admin_note,reviewer,reviewed_on,next_review_on) VALUES (?,?,'quality_hold','PRIVATE_SENTINEL',123,'2026-02-01','2026-12-01')`,
    ).run(`7819-${status}`, status);
  return { db, env: { DB: d1Over(db) } as any };
}
test('reachable/count relations preserve unreviewed, distinguish held and never expose private review columns', async () => {
  const { db, env } = fixture();
  try {
    for (const [relation, want] of [
      [REACHABLE_COMPANIES, ['admitted', 'held', 'unreviewed']],
      [COUNTED_COMPANIES, ['admitted', 'unreviewed']],
    ] as const) {
      const rows = db
        .prepare(
          `SELECT * FROM ${relation} WHERE uid LIKE '7819-%' ORDER BY uid`,
        )
        .all();
      assert.deepEqual(
        rows.map((r) => r.uid),
        want.map((s) => `7819-${s}`),
      );
      assert.ok(rows.every((r) => !('reviewer' in r) && !('admin_note' in r)));
    }
    const heldRelation: any = db
      .prepare(`SELECT * FROM ${REACHABLE_COMPANIES} WHERE uid='7819-held'`)
      .get();
    assert.equal(
      heldRelation.reason,
      'This record is held while its quality is checked.',
    );
    const unreviewedRelation: any = db
      .prepare(`SELECT * FROM ${COUNTED_COMPANIES} WHERE uid='7819-unreviewed'`)
      .get();
    assert.equal(unreviewedRelation.review_label, 'No review recorded');
    const row: any = await readCompanyByUid(env, '7819-unreviewed');
    assert.equal(row.review_label, 'No review recorded');
    assert.equal(row.review_status, 'not_recorded');
    assert.equal(row.dates.retrieved, null);
    assert.equal(row.dates.verified, null);
    const held: any = await readCompanyByUid(env, '7819-held');
    assert.equal(held.review_status, 'held');
    assert.match(held.reason, /quality/);
    assert.doesNotMatch(
      JSON.stringify(held),
      /PRIVATE_SENTINEL|reviewer|admin_note/,
    );
    for (const uid of ['7819-excluded', '7819-withdrawn'])
      assert.deepEqual(
        Object.keys((await readCompanyByUid(env, uid))!).sort(),
        ['reason', 'reason_code', 'review_status', 'uid'],
      );
    assert.deepEqual(
      await readCompaniesByUid(env, ['7819-held', 'absent', '7819-held']),
      [held, null, held],
    );
  } finally {
    db.close();
  }
});
test('history and check evidence are append-only; deleting a company retains its review and removes fresh values', async () => {
  const { db, env } = fixture();
  try {
    db.exec(
      `UPDATE research_company_reviews SET reason_code='verified' WHERE uid='7819-held'`,
    );
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) n FROM research_company_review_history WHERE uid='7819-held'`,
        )
        .get()!.n,
      2,
    );
    for (const table of [
      'research_company_review_history',
      'research_company_checks',
    ]) {
      if (table.endsWith('checks'))
        db.exec(
          `INSERT INTO research_company_checks(uid,kind,checked_at,outcome,proof_url) VALUES('7819-held','website','2026-03-01','ok','https://example.test/proof')`,
        );
      assert.throws(
        () => db.exec(`UPDATE ${table} SET uid='other'`),
        /append only/,
      );
      assert.throws(() => db.exec(`DELETE FROM ${table}`), /append only/);
    }
    db.exec(
      `INSERT INTO research_company_checks(uid,kind,checked_at,outcome,proof_url) VALUES('7819-held','website','2026-04-01','failed','https://example.test/failure')`,
    );
    const before: any = await readCompanyByUid(env, '7819-held');
    assert.equal(before.dates.source_effective, '2026-01-01');
    assert.equal(before.dates.verified, null);
    assert.equal(before.dates.last_failed_check, '2026-04-01');
    assert.equal(before.dates.next_review, '2026-12-01');
    assert.deepEqual(
      before.checks.map((c: any) => c.outcome),
      ['ok', 'failed'],
    );
    db.exec(`DELETE FROM research_company_directory WHERE uid='7819-held'`);
    const after: any = await readCompanyByUid(env, '7819-held');
    assert.equal(after.review_status, 'held');
    assert.equal(after.name, undefined);
    assert.equal(after.dates, undefined);
    assert.throws(
      () =>
        db.exec(`DELETE FROM research_company_reviews WHERE uid='7819-held'`),
      /retain review/,
    );
  } finally {
    db.close();
  }
});
test('unreadable review ledger fails closed, and invalid UIDs never reach SQL', async () => {
  const { db, env } = fixture();
  try {
    await assert.rejects(
      readCompaniesByUid(env, ['x'.repeat(65)]),
      /invalid_company_uids/,
    );
    db.exec('DROP TABLE research_company_reviews');
    await assert.rejects(
      readCompanyByUid(env, '7819-unreviewed'),
      /no such table/,
    );
    assert.throws(
      () => db.prepare(`SELECT COUNT(*) FROM ${COUNTED_COMPANIES}`).get(),
      /no such table/,
    );
  } finally {
    db.close();
  }
});
test('evidence dates stay with their UID and a successful check does not invent record verification', async () => {
  const { db, env } = fixture();
  try {
    const id = db
      .prepare(
        `SELECT id FROM research_company_directory WHERE uid='7819-held'`,
      )
      .get()!.id;
    db.prepare(
      `INSERT INTO company_sources(company_id,field_name,source_name,source_type,source_url,publication_date,retrieved_at,verified_at) VALUES(?,'revenue','Synthetic filing','filing','https://example.test/filing','2025-12-01','2026-01-03','2026-01-05')`,
    ).run(id);
    db.exec(
      `INSERT INTO research_company_checks(uid,kind,checked_at,outcome,proof_url) VALUES('7819-held','registry_status','2026-05-01','ok','https://example.test/good')`,
    );
    const held: any = await readCompanyByUid(env, '7819-held');
    assert.equal(held.evidence.length, 1);
    assert.equal(held.evidence[0].publication_date, '2025-12-01');
    assert.equal(held.evidence[0].retrieved_at, '2026-01-03');
    assert.equal(held.evidence[0].verified_at, '2026-01-05');
    assert.equal(held.dates.verified, null);
    assert.equal(held.dates.last_failed_check, null);
    const other: any = await readCompanyByUid(env, '7819-admitted');
    assert.deepEqual(other.evidence, []);
    assert.deepEqual(other.checks, []);
    assert.throws(
      () =>
        db.exec(
          `INSERT INTO research_company_reviews(uid,status,reason_code,reviewer,reviewed_on) VALUES('bad','invented','verified',1,'2026-01-01')`,
        ),
      /CHECK/,
    );
    assert.throws(
      () =>
        db.exec(
          `INSERT INTO research_company_reviews(uid,status,reason_code,reviewer,reviewed_on) VALUES('bad','held','invented',1,'2026-01-01')`,
        ),
      /CHECK/,
    );
    assert.throws(
      () =>
        db.exec(
          `INSERT INTO research_company_reviews(uid,status,reason_code,reviewer,reviewed_on) VALUES('7819-held','held','verified',1,'2026-01-01')`,
        ),
      /UNIQUE/,
    );
  } finally {
    db.close();
  }
});
test('canonical ledger declares its complete columns, indexes and closed check sets without a run foreign key', () => {
  const { db } = fixture();
  try {
    const columns = db
      .prepare('PRAGMA table_info(research_company_reviews)')
      .all();
    assert.deepEqual(
      columns.map((c) => c.name),
      [
        'uid',
        'status',
        'reason_code',
        'admin_note',
        'proof_url',
        'reviewer',
        'reviewed_on',
        'next_action',
        'next_review_on',
        'withdrawn_on',
        'run_reference',
      ],
    );
    const run = columns.find((c) => c.name === 'run_reference')!;
    assert.equal(run.type, 'TEXT');
    assert.equal(run.notnull, 0);
    assert.deepEqual(
      db.prepare('PRAGMA foreign_key_list(research_company_reviews)').all(),
      [],
    );
    const indexes = db
      .prepare('PRAGMA index_list(research_company_reviews)')
      .all()
      .map((i) => i.name);
    assert.ok(indexes.includes('idx_research_company_reviews_status'));
    assert.ok(indexes.includes('idx_research_company_reviews_next'));
    assert.deepEqual(
      db
        .prepare('PRAGMA index_info(idx_research_company_reviews_status)')
        .all()
        .map((c) => c.name),
      ['status', 'uid'],
    );
    assert.deepEqual(
      db
        .prepare('PRAGMA index_info(idx_research_company_checks_uid)')
        .all()
        .map((c) => c.name),
      ['uid', 'checked_at', 'id'],
    );
    for (const [kind, outcome] of [
      ['invented', 'ok'],
      ['website', 'invented'],
    ])
      assert.throws(
        () =>
          db
            .prepare(
              `INSERT INTO research_company_checks(uid,kind,checked_at,outcome,proof_url) VALUES('7819-held',?,'2026-01-01',?,'https://example.test/check')`,
            )
            .run(kind, outcome),
        /CHECK/,
      );
    for (const kind of ['website', 'registry_status', 'source_published'])
      for (const outcome of ['ok', 'failed', 'changed'])
        db.prepare(
          `INSERT INTO research_company_checks(uid,kind,checked_at,outcome,proof_url) VALUES('7819-held',?,'2026-01-01',?,'https://example.test/check')`,
        ).run(kind, outcome);
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) n FROM research_company_checks WHERE uid='7819-held'`,
        )
        .get()!.n,
      9,
    );
  } finally {
    db.close();
  }
});
