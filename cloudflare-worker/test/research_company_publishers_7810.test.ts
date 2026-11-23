/** D7810 (#7810): real grouped publisher inventory, reference terms and the shared Companies licence gate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import router, { mount } from '../src/routes/research_company_publishers.ts';
import {
  readCompanyPublishers,
  companyPublishersLabel,
} from '../src/services/researchCompanyPublishers.ts';
const SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(
    `DELETE FROM research_company_directory; INSERT INTO users(id,email,name,role,is_active) VALUES(781001,'7810-founder@example.test','Synthetic founder','founder',1),(781002,'7810-investor@example.test','Synthetic investor','investor',1),(781003,'7810-advisor@example.test','Synthetic advisor','advisor',1),(781004,'7810-admin@example.test','Synthetic admin','admin',1);`,
  );
  const rows = [
    ['Wikidata', 'CC0-1.0', 'https://www.wikidata.org/wiki/Q1', '2026-01-01'],
    [
      'Wikidata',
      'legacy sentence',
      'https://example.test/default-stamp',
      '2026-02-01',
    ],
    [
      'Companies House',
      'Contains public sector information licensed under the Open Government Licence v3.0.',
      'https://example.test/ch',
      '2026-03-01',
    ],
    ['Norway BRREG', 'NLOD-2.0', 'https://example.test/no', '2026-04-01'],
    ['Estonia RIK', 'CC-BY-4.0', 'https://example.test/ee', '2026-04-02'],
    ['Finland PRH', 'CC-BY-4.0', 'https://example.test/fi', '2026-04-03'],
    ['', 'Unknown', 'https://example.test/empty', '2026-04-04'],
  ];
  rows.forEach(([name, licence, url, date], i) =>
    db
      .prepare(
        `INSERT INTO research_company_directory(uid,name,website,source_name,source_license,source_url,as_of) VALUES(?,?,'https://example.test',?,?,?,?)`,
      )
      .run(`publisher-${i}`, `Synthetic ${i}`, name, licence, url, date),
  );
  const statements: string[] = [];
  const base = d1Over(db);
  const DB = {
    ...base,
    prepare(q: string) {
      statements.push(q);
      return base.prepare(q);
    },
  };
  const app = new Hono().route(mount.path, router);
  app.onError((e, c) =>
    c.json(
      { detail: e.message === 'Unauthorized' ? 'Unauthorized' : 'Unavailable' },
      e.message === 'Unauthorized' ? 401 : 500,
    ),
  );
  return {
    db,
    statements,
    app,
    env: { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any,
  };
}
async function call(f: ReturnType<typeof fixture>, who: number | null) {
  const headers: Record<string, string> = {};
  if (who)
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
  return f.app.request('/api/research/company-publishers', { headers }, f.env);
}
test('one grouped read counts every stored row, preserves distinct raw licences, references and unreviewed publishers', async () => {
  const f = fixture();
  try {
    const result = await readCompanyPublishers(f.env);
    assert.equal(f.statements.length, 1);
    assert.match(f.statements[0], /GROUP BY d.source_name/);
    assert.equal(result.record_count, 7);
    assert.equal(result.scope, 'all stored company records');
    assert.equal(result.wikidata_non_record_links, 1);
    const wikidata = result.publishers.find(
      (p) => p.source_name === 'Wikidata',
    )!;
    assert.equal(wikidata.record_count, 2);
    assert.equal(wikidata.latest_as_of, '2026-02-01');
    assert.deepEqual(wikidata.stored_licences, ['CC0-1.0', 'legacy sentence']);
    assert.equal(wikidata.licence_id, 'CC0-1.0');
    const ch = result.publishers.find(
      (p) => p.source_name === 'Companies House',
    )!;
    assert.equal(
      ch.required_attribution,
      'Contains public sector information licensed under the Open Government Licence v3.0.',
    );
    assert.equal(ch.terms_state, 'reviewed');
    for (const name of ['Norway BRREG', 'Estonia RIK', 'Finland PRH', '']) {
      const row = result.publishers.find((p) => p.source_name === name)!;
      assert.equal(row.terms_state, 'licence terms not reviewed');
      assert.equal(row.licence_name, null);
    }
    assert.match(result.label, /company records from 5 publishers/);
    assert.doesNotMatch(result.label, /mix/i);
    assert.equal(
      companyPublishersLabel(['B', 'A', 'A']),
      'company records from 2 publishers: A, B',
    );
  } finally {
    f.db.close();
  }
});
test('the route accepts Companies licences, admin and active Lab, refuses others, and reports failed reads as unavailable', async () => {
  const f = fixture();
  try {
    assert.equal((await call(f, null)).status, 401);
    for (const who of [781001, 781003, 781004])
      assert.equal((await call(f, who)).status, 200);
    assert.equal((await call(f, 781002)).status, 403);
    f.db.exec('UPDATE users SET spinout_lab_active=1 WHERE id=781002');
    assert.equal((await call(f, 781002)).status, 200);
    f.db.exec('UPDATE users SET spinout_lab_active=0 WHERE id=781002');
    f.db.exec(
      `INSERT INTO account_licences(user_id,licence,source) VALUES(781002,'advisor','synthetic')`,
    );
    assert.equal((await call(f, 781002)).status, 200);
    f.db.exec('DROP TABLE research_company_publishers');
    const response = await call(f, 781001);
    assert.equal(response.status, 500);
    assert.equal(((await response.json()) as any).detail, 'Unavailable');
  } finally {
    f.db.close();
  }
});
