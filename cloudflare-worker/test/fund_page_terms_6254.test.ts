/** D6254: recorded terms and the narrow document projection for the existing fund-page read. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { readFundPage } from '../src/services/fundReports.ts';
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
function fixture() {
  const { DB, db } = makeD1(['limited_partners', 'portfolio_positions', 'legal_documents', 'fund_report_periods'].map(t => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n'));
  db.exec(`INSERT INTO limited_partners(fund_id,commitment_amount) VALUES(10,500);
    INSERT INTO legal_documents(id,deal_id,type,status,version,content,file_url,updated_at) VALUES(9,1,'lpa','signed',3,'PRIVATE_BODY_SENTINEL','PRIVATE_STORAGE_SENTINEL','2026-10-01');
    INSERT INTO fund_report_periods(fund_id,period,period_start,period_end,status) VALUES(10,'Issued','2026-01-01','2026-03-31','issued'),(10,'Private draft','2026-04-01','2026-06-30','draft');`);
  const fund = { id: 10, name: 'Fixture fund', fund_size_cents: 10000, management_fee: 0.02, carried_interest: 0.2, lpa_doc_id: 9, gp_user_id: 'PRIVATE_GP_SENTINEL', company_id: 'PRIVATE_COMPANY_SENTINEL' };
  return { db, env: { DB } as any, fund };
}
test('GP and LP reads expose the same recorded fractional terms and only LPA metadata', async () => {
  const f = fixture();
  try {
    for (const manager of [true, false]) {
      const result = await readFundPage(f.env, f.fund, manager);
      assert.deepEqual(result.terms, { management_fee: 0.02, carried_interest: 0.2, management_fee_reason: null, carried_interest_reason: null });
      assert.deepEqual(result.documents, [{ kind: 'lpa', status: 'signed', version: 3, updated_at: '2026-10-01' }]);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_(BODY|STORAGE|GP|COMPANY)_SENTINEL/);
      assert.equal(result.periods.length, manager ? 2 : 1);
      if (!manager) assert.ok(result.periods.every((p: any) => p.status === 'issued'));
      assert.match(result.documents_reason, /Other fund documents are not recorded/);
    }
  } finally { f.db.close(); }
});
test('zero terms are recorded values; absent terms and an unattached LPA retain explicit gaps', async () => {
  const f = fixture();
  try {
    const zero = await readFundPage(f.env, { ...f.fund, management_fee: 0, carried_interest: 0 }, false);
    assert.equal(zero.terms.management_fee, 0); assert.equal(zero.terms.carried_interest, 0);
    const missing = await readFundPage(f.env, { ...f.fund, management_fee: null, carried_interest: undefined, lpa_doc_id: null }, false);
    assert.equal(missing.terms.management_fee, null); assert.equal(missing.terms.carried_interest, null);
    assert.match(missing.terms.management_fee_reason!, /not been recorded/);
    assert.match(missing.terms.carried_interest_reason!, /not been recorded/);
    assert.deepEqual(missing.documents, []);
    for (const invalid of [NaN, Infinity, -0.01, 1.01, '0.02']) {
      await assert.rejects(readFundPage(f.env, { ...f.fund, management_fee: invalid }, false), /terms unreadable/);
    }
  } finally { f.db.close(); }
});
test('a referenced but unreadable document fails the read rather than claiming no document exists', async () => {
  const f = fixture();
  try { await assert.rejects(readFundPage(f.env, { ...f.fund, lpa_doc_id: 999 }, false), /LPA unreadable/); }
  finally { f.db.close(); }
});
