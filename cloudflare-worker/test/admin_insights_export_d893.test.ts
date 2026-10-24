/**
 * D893 (#2661) — POST /api/admin/insights/export: a logged, counts-only CSV or
 * PDF of the Insights read (#2660). The read is the injected reader here,
 * answering the response contract #2660 fixes. Real SQLite for the users and
 * `admin_audit_log`, an in-memory R2, and Browser Run stubbed.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/admin_insights_export_d893.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { insightsExportRoutes, type InsightsReader } from '../src/routes/admin_insights_export.ts';
import { cell, pageRows, groupRows, label, refusesCountsOnly } from '../src/services/insightsExport.ts';
import analytics from '../src/routes/monitoring_analytics.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const ADMIN = 1, FOUNDER = 2;

/** The #2660 contract, seeded. Every figure is a count; the extras are fields the read must never leak. */
function READ(over: Record<string, unknown> = {}) {
  return {
    range: '8w', weeks: ['2026-08-31', '2026-09-07'], current_week: '2026-09-07', as_of: '2026-10-21', scope: { label: 'Axal HQ' },
    kpis: {
      accounts: { total: 120, new_30d: 14, deactivated: 3 },
      new_this_week: { count: 5, last_week: 4 },
      active_last_week: { value: 61, week_before: 58 },
      activated: { rate_pct: 42.5, cohorts_counted: 8 },
    },
    blocks: {
      who: { available: true, total: 120, by_profile: [{ profile: 'founder', count: 80 }, { profile: 'investor', count: 40 }], lps: 6, product_testers: { recorded: false, reason: 'Product testers are not defined yet.' } },
      plan: { available: true, by_tier: [{ tier: 'free', count: 90 }, { tier: 'growth', count: 30 }], paid: 30, paid_pct: 25 },
      growth: { available: true, weeks: [{ week: '2026-08-31', total: 3, to_date: 117, by_profile: { founder: 2, investor: 1 } }] },
      activity: { available: true, values: [55, null], previous: null },
      retention: { available: true, cohorts: [{ week: '2026-08-31', signups: 3, retained_30d: 2 }] },
      countries: { available: true, rows: [{ country: 'United Arab Emirates', count: 50 }, { country: 'bad@example.test', count: 1 }], not_stated: 9 },
      identity: { available: true, not_started: 70, pending: 10, approved: 38, rejected: 2 },
      completeness: { available: true, bands: [{ band: '0–25', count: 20 }] },
      dormant: { available: false, unreadable: true, reason: 'last_active_at could not be read.' },
      tickets: { available: true, open: 4, by_status: { open: 3, pending: 1 } },
      spend: { available: true, usd: 12.5, calls: 300, by_profile: [{ profile: 'founder', usd: 10, calls: 250 }] },
    },
    group: { available: true, count: 80, new_30d: 9, active_last_week: 40, activated_pct: 50, dormant: 7, signups_by_week: [2, 3], active_by_week: [30, 40],
      by_country: [{ country: 'France', accounts: 10, new_30d: 1, active_last_week: 5 }] },
    // Fields the read does not promise and the export must never carry.
    leaked: { email: 'leak@example.test', name: 'Fay Founder', user_id: 4242 },
    ...over,
  };
}

function world({ reader, r2 = true, browser, real = false }: { reader?: InsightsReader; r2?: boolean; browser?: any; real?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(tableFromBaseline(BASELINE, 'users'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test');
  const store = new Map<string, { body: any; type: string }>();
  const FILES = r2 ? {
    async put(k: string, v: any, o: any) { store.set(k, { body: v, type: o?.httpMetadata?.contentType }); },
    async get(k: string) { const o = store.get(k); return o ? { body: o.body, httpMetadata: { contentType: o.type } } : null; },
    async delete(k: string) { store.delete(k); },
  } : undefined;
  const reads: string[] = [];
  const read: InsightsReader = reader ?? (async (_c, q) => { reads.push(q.toString()); return { status: 200, body: READ() }; });
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES, ...(browser ? { BROWSER: browser } : {}) };
  const app = new Hono<any>();
  // `real`: the route as index.ts mounts it, on its default reader, the page's own read.
  app.route('/api/admin/insights/export', real ? insightsExportRoutes() : insightsExportRoutes(read));
  app.route('/api/monitoring/analytics', analytics);
  app.onError((err: any, c) => {
    const status = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (status) return c.json({ detail: err.message }, status);
    throw err;
  });
  return { db, env, app, store, reads };
}

async function post(w: any, body: unknown, who = ADMIN) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const quiet = console.warn; console.warn = () => {};
  try {
    const res = await w.app.request('/api/admin/insights/export', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) }, w.env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { console.warn = quiet; }
}
const stored = (w: any) => [...w.store.values()].map((o: any) => (typeof o.body === 'string' ? o.body : new TextDecoder().decode(o.body)));
const audit = (db: any) => {
  // The table is created by the first export that is logged; none means no row.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'admin_audit_log'").get()) return [];
  return db.prepare("SELECT admin_user_id, action, report_type, format, filters_json, storage_key FROM admin_audit_log WHERE action = 'insights_export'").all();
};

test('D893 the CSV for a seeded read: the header, every figure by name, and unknown never 0', async () => {
  const w = world();
  const r = await post(w, { what: 'page', format: 'csv', range: '8w' });
  assert.equal(r.status, 200);
  assert.equal(r.body.format, 'csv');
  assert.match(r.body.download_url, /^http:\/\/localhost\/api\/monitoring\/analytics\/download\//);
  const [csv] = stored(w);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'Axal Insights,Figures on this page');
  assert.ok(lines.includes('Range,8w · 2026-08-31 to 2026-09-07'));
  assert.ok(lines.includes('Counts only,"This file holds counts only, never names or emails."'));
  for (const row of ['Accounts,total,,120', 'Accounts,deactivated,,3', 'Active last week,value,,61', 'Activated,rate %,,42.5', 'Who,accounts,founder,80',
    'Who,product testers,,Not recorded: Product testers are not defined yet.', 'Plan,paid %,,25', 'Growth,sign-ups · investor,2026-08-31,1',
    'Activity,active accounts,2026-08-31,55', 'Activity,active accounts,2026-09-07,', 'Retention,retained 30 days,2026-08-31,2',
    'Countries,accounts,United Arab Emirates,50', 'Countries,accounts,(other),1', 'Identity checks,waiting,,10', 'Profile completeness,accounts,0–25,20',
    'Dormant,status,,Unreadable: last_active_at could not be read.', 'Tickets,tickets,pending,1', 'AI spend this month,USD,founder,10']) {
    assert.ok(lines.includes(row), `missing: ${row}`);
  }
  assert.ok(!lines.some((l) => l.startsWith('Group,')), 'the page export holds no group block');
  assert.ok(!lines.some((l) => l.startsWith('Dormant,count')), 'an unreadable block is a status, never a 0');
  assert.deepEqual(w.reads, ['range=8w']);
});

test('D893 no email, name or id reaches any file, CSV or PDF, page or group', async () => {
  const pdf = new Uint8Array([37, 80, 68, 70]);
  const w = world({ browser: { fetch: async (_u: string, init: any) => { w2html.push(JSON.parse(init.body).html); return new Response(pdf, { status: 200 }); } } });
  const w2html: string[] = [];
  for (const [what, format] of [['page', 'csv'], ['page', 'pdf'], ['group', 'csv'], ['group', 'pdf']]) {
    const r = await post(w, { what, format, group: what === 'group' ? 'founder' : undefined });
    assert.equal(r.status, 200, `${what} ${format}`);
  }
  for (const text of [...stored(w).filter((t) => !t.startsWith('%PDF')), ...w2html]) {
    assert.ok(!/@/.test(text), 'no email');
    assert.ok(!text.includes('Fay Founder') && !text.includes('Ada Admin'), 'no name');
    assert.ok(!text.includes('4242') && !text.includes('user_id'), 'no id');
  }
  assert.equal(label('a@b.co'), '(other)');
  assert.equal(label('=cmd()'), '(other)');
});

test('D893 the PDF path: Browser Run renders the HTML; without it, or when it fails, the HTML ships and says so', async () => {
  const seen: string[] = [];
  const ok = world({ browser: { fetch: async (url: string, init: any) => { seen.push(url); assert.match(JSON.parse(init.body).html, /<h2>Accounts<\/h2>/); return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }); } } });
  const r = await post(ok, { what: 'page', format: 'pdf' });
  assert.deepEqual([r.status, r.body.format, seen], [200, 'pdf', ['https://browser.local/pdf']]);
  assert.equal([...ok.store.values()][0].type, 'application/pdf');
  const broken = world({ browser: { fetch: async () => new Response('no', { status: 500 }) } });
  assert.equal((await post(broken, { format: 'pdf' })).body.format, 'html');
  const none = world();
  const h = await post(none, { format: 'pdf' });
  assert.equal(h.body.format, 'html');
  assert.match(stored(none)[0], /^<!doctype html>.*This file holds counts only/s);
});

test('D893 one audit row per export, naming the admin, what, format and filters, never a figure', async () => {
  const w = world();
  await post(w, { what: 'page', format: 'csv', range: 'quarter', profile: 'founder', country: 'France' });
  await post(w, { what: 'group', format: 'csv', group: 'investor' });
  const rows = audit(w.db);
  assert.equal(rows.length, 2);
  assert.deepEqual({ ...rows[0], storage_key: undefined }, { admin_user_id: ADMIN, action: 'insights_export', report_type: 'page', format: 'csv', storage_key: undefined,
    filters_json: JSON.stringify({ range: 'quarter', profile: 'founder', country: 'France', group: null }) });
  assert.match(rows[0].storage_key, /^insights-exports\/1\/.+-page-[0-9a-f]{12}\.csv$/);
  assert.equal(rows[1].report_type, 'group');
  assert.ok(!rows.some((r: any) => /120|80/.test(r.filters_json)), 'no figure in the log');
  assert.deepEqual(w.reads, ['range=quarter&profile=founder&country=France', 'range=8w&group=investor']);
});

test('D893 an export that cannot be logged is not made: 503, and the stored file is removed', async () => {
  const w = world();
  w.db.exec("CREATE TABLE admin_audit_log (id INTEGER PRIMARY KEY, admin_user_id INTEGER NOT NULL, action TEXT NOT NULL CHECK (action != 'insights_export'), report_type TEXT, format TEXT, filters_json TEXT, storage_key TEXT, download_url TEXT, exported_at TEXT DEFAULT (datetime('now')), viewed_user_id INTEGER, conversation_id INTEGER, viewed_at TEXT)");
  const r = await post(w, { format: 'csv' });
  assert.deepEqual([r.status, r.body.code], [503, 'export_not_logged']);
  assert.equal(w.store.size, 0, 'no file left behind');
  assert.equal(r.body.download_url, undefined);
});

test('D893 refusals: a non-admin, a bad option, a group export with no group, and the read\'s own refusal passed through unlogged', async () => {
  const w = world();
  assert.equal((await post(w, { format: 'csv' }, FOUNDER)).status, 403);
  for (const [body, code] of [[{ what: 'all' }, 'invalid_what'], [{ format: 'xlsx' }, 'invalid_format'], [{ range: '5y' }, 'invalid_range'],
    [{ country: 'x'.repeat(65) }, 'invalid_filter'], [{ profile: '<script>' }, 'invalid_filter'], [{ what: 'group' }, 'group_required']] as const) {
    const r = await post(w, body);
    assert.deepEqual([r.status, r.body.code], [400, code], JSON.stringify(body));
  }
  const hq = world({ reader: async () => ({ status: 403, body: { code: 'hq_only', detail: 'Only HQ reads another scope.' } }) });
  const r = await post(hq, { format: 'csv' });
  assert.deepEqual([r.status, r.body.code], [403, 'hq_only']);
  assert.equal(audit(hq.db).length, 0);
  assert.equal(hq.store.size, 0);
  assert.deepEqual(audit(w.db), [], 'no refused export is logged');
});

test('D893 a file that would carry an email is refused, not handed out', async () => {
  const w = world({ reader: async () => ({ status: 200, body: READ({ blocks: { ...READ().blocks, dormant: { unreadable: true, reason: 'ask ops@example.test' } } }) }) });
  const r = await post(w, { format: 'csv' });
  assert.deepEqual([r.status, r.body.code], [500, 'export_not_counts_only']);
  assert.equal(w.store.size, 0);
  assert.equal(audit(w.db).length, 0);
  assert.equal(refusesCountsOnly('Accounts,total,,120'), false);
  assert.equal(refusesCountsOnly('x,someone@axal.vc'), true);
});

test('D893 the group export: the group block only; a read without a group is refused', async () => {
  const rows = groupRows(READ())!;
  assert.ok(rows.every((r) => r.section === 'Group'));
  assert.ok(rows.some((r) => r.figure === 'accounts' && r.label === 'France' && r.value === '10'));
  assert.ok(rows.some((r) => r.figure === 'sign-ups' && r.label === '2026-09-07' && r.value === '3'));
  assert.equal(groupRows(READ({ group: undefined })), null);
  const w = world({ reader: async () => ({ status: 200, body: READ({ group: undefined }) }) });
  assert.deepEqual((await post(w, { what: 'group', group: 'founder' })).status, 409);
  assert.ok(!pageRows(READ()).some((r) => r.section === 'Group'));
});

test('D893 the link downloads the file once signed, through the analytics download route', async () => {
  const w = world();
  const r = await post(w, { format: 'csv' });
  const path = new URL(r.body.download_url).pathname;
  const res = await w.app.request(path, {}, w.env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition')!, /filename=".+-page-[0-9a-f]{12}\.csv"/);
  assert.match(await res.text(), /^Axal Insights,Figures on this page/);
  // Flip the signature's first character: a last base64url character can carry only padding bits.
  const dot = path.lastIndexOf('.') + 1;
  const tampered = path.slice(0, dot) + (path[dot] === 'A' ? 'B' : 'A') + path.slice(dot + 1);
  assert.equal((await w.app.request(tampered, {}, w.env)).status, 403, 'a tampered link is refused');
});

test('D893 without R2 the file is inline, and still logged', async () => {
  const w = world({ r2: false });
  const r = await post(w, { format: 'csv' });
  assert.match(r.body.download_url, /^data:text\/csv; charset=utf-8;base64,/);
  assert.equal(audit(w.db).length, 1);
});

test('D893 a CSV cell cannot start a formula', async () => {
  const w = world({ reader: async () => ({ status: 200, body: READ({ blocks: { ...READ().blocks, dormant: { recorded: false, reason: '=HYPERLINK("x")' } } }) }) });
  await post(w, { format: 'csv' });
  const line = stored(w)[0].split('\r\n').find((l: string) => l.startsWith('Dormant'))!;
  assert.equal(line, 'Dormant,status,,"Not recorded: =HYPERLINK(""x"")"');
  for (const [v, out] of [['=1+1', "'=1+1"], ['+x', "'+x"], ['@x', "'@x"], ['-x', "'-x"], ['-3', '-3'], ['12', '12'], ['a,b', '"a,b"']]) assert.equal(cell(v), out, v);
});

test('D893 end to end on the real read (#2660): the export gets the page\'s own answer, gates and all', async () => {
  const w = world({ real: true });
  const quiet = [console.error, console.warn]; console.error = () => {};
  let r;
  try { r = await post(w, { what: 'page', format: 'csv', range: 'quarter' }); } finally { [console.error] = quiet; }
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const csv = stored(w)[0];
  assert.match(csv, /^Axal Insights,Figures on this page\r\nRange,quarter/);
  assert.ok(csv.includes('Accounts,total,,2'), 'the read counted both seeded accounts');
  assert.ok(!/@|Ada Admin|Fay Founder/.test(csv), 'counts only, through the real read');
  assert.equal(audit(w.db).length, 1);
  // The read's own gate answers for the export too.
  assert.equal((await post(w, { format: 'csv' }, FOUNDER)).status, 403);
  assert.equal(audit(w.db).length, 1);
});
