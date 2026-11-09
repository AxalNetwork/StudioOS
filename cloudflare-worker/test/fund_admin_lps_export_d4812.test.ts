/**
 * D4812 part 4 (#4812, FA-02) — `GET /api/fund-admin/lps/export`, the LP
 * roster's Export view.
 *
 *   · an Admin and the Super Admin export; a founder, a support session and a
 *     branch Worker do not, and a refused export is not audited;
 *   · the rows are the roster's own filters, every page, never one page;
 *   · a missing figure is "Not recorded" or "Unreadable", never 0;
 *   · no email leaves; a cell a spreadsheet would run as a formula is not one;
 *   · the read is audited first, as an export; a failed audit sends nothing.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_admin_lps_export_d4812.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import fundAdmin from '../src/routes/fund_admin.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { csvCell } from '../src/services/fundAdminLpsCsv.ts';
import { ADMIN, SUPER, FOUNDER, JTI, envFor, freshDb, one, tokenFor } from './_mercury_fixture.ts';

const app = new Hono<any>();
app.route('/api/fund-admin', fundAdmin);
app.onError((err: any, c) => c.json({ detail: err?.message }, AUTH_ERROR_STATUSES[err?.message ?? ''] ?? 500));

function seeded() {
  const db = freshDb();
  const lps = Array.from({ length: 60 }, (_, i) => `(${100 + i}, 1, NULL, 'LP ${String(i).padStart(2, '0')}', 'lp${i}@example.invalid', ${1000 + i}, 0, 'active', ${i % 2})`).join(',\n  ');
  db.exec(`
INSERT INTO vc_funds (id, name, gp_user_id) VALUES (1, 'Spin-Out Fund I', NULL), (2, 'Outside Fund', ${FOUNDER});
INSERT INTO limited_partners (id, fund_id, user_id, name, email, commitment_amount, invested_amount, status, lpa_signed) VALUES
  ${lps},
  (200, 1, NULL, '=HYPERLINK("http://example.invalid","x")', 'formula@example.invalid', 50, 0, 'active', 0),
  (300, 2, NULL, 'Outside LP', 'outside@example.invalid', 900, 0, 'active', 1);
`);
  return db;
}

async function get(db: any, qs: string, as: number, opts: { jti?: string; impersonated?: boolean; env?: Record<string, unknown> } = {}) {
  const res: Response = await (app.request(`/api/fund-admin/lps/export${qs}`, {
    headers: { Authorization: `Bearer ${await tokenFor(as, opts)}` },
  }, envFor(db, opts.env)) as Promise<Response>).catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  return { status: res.status, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition'), text: await res.text() };
}
const audits = (db: any) => Number(one(db, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'fund_lps_read' AND filters_json LIKE '%fund_admin.lps.export%'").n);
const lines = (text: string) => text.trim().split('\r\n');

test('roles: a founder, a support session and a branch are refused and not audited; Admin and Super Admin export', async () => {
  const db = seeded();
  assert.equal((await get(db, '', FOUNDER)).status, 403);
  assert.equal((await get(db, '', SUPER, { jti: JTI.superFresh, impersonated: true })).status, 403);
  assert.equal((await get(db, '', ADMIN, { jti: JTI.adminTotp, env: { BRANCH_CODE: 'fr' } })).status, 403);
  assert.equal(audits(db), 0);
  for (const [u, jti] of [[ADMIN, JTI.adminTotp], [SUPER, JTI.superFresh]] as const) {
    const r = await get(db, '', u, { jti });
    assert.equal(r.status, 200, r.text);
    assert.match(r.type || '', /^text\/csv/);
    assert.match(r.disposition || '', /^attachment; filename="fund-admin-lps-\d{4}-\d{2}-\d{2}\.csv"$/);
  }
  assert.equal(audits(db), 2, 'each export is audited, as an export');
});

test('every page of the filtered roster, never one page; only administered funds', async () => {
  const db = seeded();
  const all = lines((await get(db, '', ADMIN, { jti: JTI.adminTotp })).text);
  assert.equal(all.length, 1 + 61, 'a header and all 61 administered LPs, more than one page of the roster (50)');
  assert.equal(all[0], 'LP,Fund,LP type,Commitment ($),Called ($),Received ($),Outstanding ($),Distributed ($),LPA,Identity,Booklet,Last notice');
  assert.ok(!all.some((l) => l.startsWith('Outside LP')), 'an outside GP\'s fund is not exported');
  const signed = lines((await get(db, '?lpa=signed&page=2&per_page=1', ADMIN, { jti: JTI.adminTotp })).text);
  assert.equal(signed.length, 1 + 30, 'the filter holds; page and per_page are ignored');
  const one = lines((await get(db, '?q=LP%2007', ADMIN, { jti: JTI.adminTotp })).text);
  assert.equal(one.length, 2);
  assert.match(one[1], /^LP 07,Spin-Out Fund I,/);
  assert.match(one[1], /,1007\.00,/, 'money in dollars with two decimals');
});

test('no email; a missing figure is never 0; a formula is not one', async () => {
  const db = seeded();
  const r = await get(db, '', ADMIN, { jti: JTI.adminTotp });
  assert.ok(!r.text.includes('@'), 'no email leaves');
  const row = lines(r.text).find((l) => l.startsWith('LP 00'))!;
  assert.match(row, /(Not recorded|Unreadable)/, 'a figure no store gives is named');
  assert.doesNotMatch(row.split(',').slice(4, 8).join(','), /(^|,)0\.00(,|$)/, 'never a fabricated 0.00');
  const f = lines(r.text).find((l) => l.includes('HYPERLINK'))!;
  assert.ok(f.startsWith(`"'=HYPERLINK(`), f);
  assert.equal(csvCell('-12.50'), '-12.50', 'a negative amount stays a number');
  assert.equal(csvCell('+1 555'), "'+1 555");
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
});

test('a bad filter is a 400; a fund not administered a 404; a failed audit sends nothing', async () => {
  const db = seeded();
  assert.equal((await get(db, '?lpa=maybe', ADMIN, { jti: JTI.adminTotp })).status, 400);
  assert.equal((await get(db, '?fund=2', ADMIN, { jti: JTI.adminTotp })).status, 404);
  db.exec(`CREATE TRIGGER audit_down BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END;`);
  const r = await get(db, '', ADMIN, { jti: JTI.adminTotp });
  assert.equal(r.status, 503);
  assert.ok(!r.text.includes('LP 00'), 'no row before the audit');
});
