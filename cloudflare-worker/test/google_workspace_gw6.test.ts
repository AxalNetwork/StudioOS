/**
 * D1095 (#2960): Google Workspace part 6, Grow. A mapped metrics Sheet lands
 * in `project_metrics` as `google_sheets`, only in columns no connected
 * source writes; Calendar events the founder tags become obligation proposals.
 * Real SQL on node:sqlite and real routes; Google is a stub that answers GET
 * only. Every name, figure and id is invented.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { growDb, call, PID, FOUNDER, COFOUNDER, INVESTOR, TODAY } from './_mercury_grow_fixture.ts';
import {
  CONNECTED_METRIC_COLUMNS, GoogleGrowRefused, MAX_SHEET_ROWS, SHEET_METRIC_FIELDS, calendarProposals, calendarTag, metricsMapping,
  sheetDay, sheetNumber, sheetRange, sheetRows,
} from '../src/services/google/growFeeds.ts';
import { CONNECTED_METRIC_SOURCES, isConnectedSource } from '../src/routes/progress.ts';
import { GOOGLE_WORKSPACE_FEEDS } from '../src/integrations/googleWorkspaceFeeds.ts';
import { CONNECTOR_METADATA } from '../src/integrations/registry.ts';
import { DRIVE_FILE_SCOPE } from '../src/services/google/workspace.ts';
import { growFigures } from '../src/services/growCycle.ts';
import { kpiRows } from '../src/services/growKpis.ts';

const here = dirname(fileURLToPath(import.meta.url));
const M = resolve(here, '../sql/migrations');
const migration = (p: string) => readFileSync(resolve(M, readdirSync(M).find((f) => f.startsWith(`${p}_`))!), 'utf8');
const src = (p: string) => readFileSync(resolve(here, '../src', p), 'utf8');
const NOW = Date.parse(`${TODAY}T12:00:00Z`);
const WORKSPACE = 77;
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

/** Google, answering GET only: the Sheet's values, the Calendar's events, and the OAuth token exchange. */
function google(sheet: unknown[][], events: unknown[], opts: { calendarStatus?: number; nextPage?: boolean } = {}) {
  const calls: Array<{ host: string; path: string; method: string; query: string }> = [];
  const fetcher = async (input: any, init: any = {}) => {
    const url = new URL(String(input)); const method = init.method || 'GET';
    calls.push({ host: url.hostname, path: url.pathname, method, query: url.search });
    if (url.href === 'https://oauth2.googleapis.com/token' && method === 'POST') return Response.json({ access_token: 'synthetic-access', token_type: 'Bearer' });
    if (method !== 'GET') throw new Error('provider_write_refused');
    if (url.hostname === 'sheets.googleapis.com' && /\/values\//.test(url.pathname)) return Response.json({ values: sheet });
    if (url.hostname === 'www.googleapis.com' && url.pathname === '/calendar/v3/calendars/primary/events') {
      if (opts.calendarStatus) return Response.json({ error: 'raw-private-provider-body' }, { status: opts.calendarStatus });
      return Response.json({ items: events, ...(opts.nextPage ? { nextPageToken: 'more' } : {}) });
    }
    throw new Error('unexpected_provider_read');
  };
  return { fetcher, calls };
}

const SHEET = [
  ['Date', 'New users', 'CAC', 'MRR (EUR)', 'Headcount'],
  ['2026-08', '40', '$1,200', '9000', '4'],
  ['2026-09-30', 55, '1,150.50', '9500', '5'],
  ['2026-10-20', '61', '', '9900', '5.5'],
  ['last week', '9', '9', '9', '9'],
  ['2026-09-30', '99', '99', '99', '9'],
  ['', '', '', '', ''],
  ['2026-10-01', 'many', '', '9800', ''],
];
const MAPPING = { date: 'A', new_users: 'B', cac: 'C', headcount: 'E' };
const EVENTS = [
  { id: 'evboard1', summary: 'Q4 review #board', start: { dateTime: '2026-11-03T09:00:00+01:00' }, description: 'private agenda text', location: 'Synthetic HQ', attendees: [{ email: 'guest@else.example' }] },
  { id: 'evfile1', summary: '#filing Delaware franchise tax', start: { date: '2027-03-01' } },
  { id: 'evplain', summary: 'Lunch', start: { date: '2026-11-05' } },
  { id: 'evboth', summary: 'Strategy #board #filing', start: { date: '2026-11-06' } },
  { id: 'evcancel', status: 'cancelled', summary: 'Old #board', start: { date: '2026-11-07' } },
  { id: 'evboarding', summary: 'Print #boarding pass', start: { date: '2026-11-08' } },
];

async function world(opts: { scope?: string } = {}) {
  const { db, env } = await growDb();
  db.exec(migration('588'));
  db.exec('CREATE TABLE IF NOT EXISTS integration_companies(integration_id INTEGER, company_id INTEGER, enabled INTEGER, PRIMARY KEY(integration_id, company_id))');
  db.exec('CREATE TABLE google_oauth_tokens(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE, refresh_token TEXT, scope TEXT, google_sub TEXT, google_email TEXT, updated_at TEXT)');
  Object.assign(env, { GOOGLE_CAL_CLIENT_ID: 'public-client', GOOGLE_CAL_CLIENT_SECRET: 'synthetic-secret', PUBLIC_BASE_URL: 'https://axal.vc' });
  db.prepare('INSERT INTO google_oauth_tokens(user_id, refresh_token, scope, google_sub) VALUES (?, ?, ?, ?)')
    .run(FOUNDER, 'server-refresh-only', opts.scope ?? `${DRIVE_FILE_SCOPE} ${CALENDAR_SCOPE}`, 'google-member');
  db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, display_name, status, auth_type) VALUES (?, 'gw', ?, 'google_workspace', 'Google Workspace', 'active', 'oauth2')").run(WORKSPACE, FOUNDER);
  db.prepare('INSERT INTO integration_companies VALUES (?, 70, 1)').run(WORKSPACE);
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (70, ?)').run(FOUNDER);
  db.prepare(`INSERT INTO google_workspace_files (uid, integration_id, user_id, project_id, module, drive_file_id, mime_type, kind, name, mapping_json)
    VALUES ('f-metrics', ?, ?, ?, 'revenue_traction', 'sheetMetrics', 'application/vnd.google-apps.spreadsheet', 'sheet', 'Metrics', ?)`).run(WORKSPACE, FOUNDER, PID, JSON.stringify(MAPPING));
  // Stripe's and Mercury's own rows, dated before the Sheet's last row.
  db.prepare("INSERT INTO project_metrics (project_id, snapshot_date, mrr, arr, paying_accounts, monthly_churn_pct, active_users, source) VALUES (?, '2026-09-25', 4800, 57600, 11, 2.5, 11, 'stripe')").run(PID);
  db.prepare("INSERT INTO project_metrics (project_id, snapshot_date, mrr, arr, paying_accounts, monthly_churn_pct, active_users, source) VALUES (?, '2026-10-15', 5100, 61200, 12, 2.0, 12, 'stripe')").run(PID);
  db.prepare("INSERT INTO project_metrics (project_id, snapshot_date, net_burn, cash_balance, source) VALUES (?, '2026-09-30', 7000, 91000, 'mercury')").run(PID);
  return { db, env };
}

async function withGoogle<T>(g: ReturnType<typeof google>, fn: () => Promise<T>): Promise<T> {
  const old = globalThis.fetch; globalThis.fetch = g.fetcher as any;
  try { return await fn(); } finally { globalThis.fetch = old; }
}
const sheetRowsOf = (db: any) => db.prepare("SELECT * FROM project_metrics WHERE project_id = ? AND source = 'google_sheets' ORDER BY snapshot_date").all(PID);

// ─────────────────────────────────────────────────────────── the mapping

test('a mapping offers new users, CAC, LTV, headcount and NRR only: active users and every Stripe or Mercury column are refused', () => {
  assert.deepEqual([...SHEET_METRIC_FIELDS], ['new_users', 'cac', 'ltv', 'headcount', 'nrr_pct']);
  for (const col of ['active_users', 'mrr', 'arr', 'paying_accounts', 'monthly_churn_pct', 'net_burn', 'cash_balance', 'cash_in_cents']) {
    assert.throws(() => metricsMapping({ date: 'A', [col]: 'B' }), (e: any) => e instanceof GoogleGrowRefused && e.code === 'mapping_column_not_allowed' && e.field === col, col);
  }
  assert.throws(() => metricsMapping({ date: 'A', notes: 'B' }), (e: any) => e.code === 'invalid_mapping');
  assert.throws(() => metricsMapping({ new_users: 'B' }), (e: any) => e.code === 'invalid_mapping' && e.field === 'date');
  assert.throws(() => metricsMapping({ date: 'A' }), (e: any) => e.code === 'mapping_needs_a_figure');
  assert.throws(() => metricsMapping({ date: 'A', cac: 'A' }), (e: any) => e.code === 'mapping_column_twice');
  assert.throws(() => metricsMapping({ date: 'AA', cac: 'B' }), (e: any) => e.code === 'invalid_mapping');
  assert.deepEqual(metricsMapping({ date: 'A', nrr_pct: 'D', tab: "Q's" }), { date: 'A', tab: "Q's", header: true, fields: { nrr_pct: 'D' } });
  assert.equal(sheetRange(metricsMapping({ date: 'A', cac: 'B', tab: "Q's" })), `'Q''s'!A1:Z${MAX_SHEET_ROWS + 2}`);
});

test('the list of columns a Sheet may never write is read from Stripe\'s and Mercury\'s own writers, and shares nothing with the Sheet\'s', () => {
  const writers = [src('integrations/providers/stripe.ts'), src('services/mercury/growFeeds.ts'), src('routes/revenue.ts')].join('\n');
  const written = new Set<string>();
  for (const m of writers.matchAll(/INSERT INTO project_metrics \(([^)]*)\)/g)) {
    for (const col of m[1].split(',').map((x) => x.trim())) if (!['project_id', 'snapshot_date', 'notes', 'source', 'created_by'].includes(col)) written.add(col);
  }
  assert.ok(written.size >= 7, [...written].join());
  for (const col of written) assert.ok(CONNECTED_METRIC_COLUMNS.includes(col), `${col} is written by Stripe or Mercury`);
  for (const f of SHEET_METRIC_FIELDS) assert.ok(!written.has(f) && !CONNECTED_METRIC_COLUMNS.includes(f), f);
});

test('google_sheets is a connected source: a typed snapshot cannot claim it', () => {
  assert.deepEqual([...CONNECTED_METRIC_SOURCES], ['stripe', 'mercury', 'google_sheets', 'posthog'], 'D1604: PostHog joins; it writes no project_metrics row');
  assert.equal(isConnectedSource(' Google_Sheets '), true);
  const route = src('routes/progress.ts');
  assert.match(route, /if \(isConnectedSource\(body\?\.source\)\) \{\s*return c\.json\(\{ detail: \{ code: 'source_reserved'/);
  assert.match(route, /=== 'google_sheets'\s*&& fields\.some\(\(\[k, v\]\) => k !== 'notes' && v !== undefined\)\) \{\s*return c\.json\(\{ detail: \{ code: 'sheet_figure_locked'/);
});

test('a Sheet reads ISO days and months, names every row it skips, and never guesses a number', () => {
  assert.equal(sheetDay('2026-09'), '2026-09-30'); assert.equal(sheetDay('2026/02/28'), '2026-02-28');
  assert.equal(sheetDay('2026-02-30'), null); assert.equal(sheetDay('10/03/2026'), null); assert.equal(sheetDay(46000), null);
  assert.equal(sheetNumber('$1,200', 'cac'), 1200); assert.equal(sheetNumber('112 %', 'nrr_pct'), 112);
  assert.equal(sheetNumber('1.234,5', 'cac'), null); assert.equal(sheetNumber('5.5', 'headcount'), null); assert.equal(sheetNumber('-3', 'new_users'), null);
  const { rows, skipped, partial } = sheetRows(SHEET, metricsMapping(MAPPING));
  assert.deepEqual(rows.map((r) => [r.day, r.figures]), [
    ['2026-08-31', { new_users: 40, cac: 1200, headcount: 4 }],
    ['2026-09-30', { new_users: 55, cac: 1150.5, headcount: 5 }],
    ['2026-10-20', { new_users: 61 }],
  ]);
  assert.deepEqual(skipped, [
    { row: 4, reason: 'not_a_number', field: 'headcount' }, { row: 5, reason: 'not_a_date' }, { row: 6, reason: 'date_repeated' },
    { row: 8, reason: 'not_a_number', field: 'new_users' }, { row: 8, reason: 'no_figures' },
  ]);
  assert.equal(partial, false);
  assert.equal(sheetRows([['Date', 'n'], ...Array.from({ length: MAX_SHEET_ROWS + 1 }, (_, i) => [`2025-01-01`, i])], metricsMapping({ date: 'A', new_users: 'B' })).partial, true);
});

// ─────────────────────────────────────────────────────────── the Sheet sync

test('a Sheet sync lands one google_sheets row per day in the allowed columns only, and Stripe\'s MRR and Customers and Mercury\'s burn read the same', async () => {
  const { db, env } = await world();
  const x = { env, projectId: PID, now: NOW, href: () => '' };
  const figures = async () => (await growFigures(x)).filter((f: any) => f.key === 'mrr' || f.key === 'customers');
  const kpis = async () => (await kpiRows(env, PID, NOW)).filter((k: any) => ['mrr', 'paying_accounts', 'churn', 'net_burn', 'runway'].includes(k.id));
  const before = { figures: await figures(), kpis: await kpis() };
  assert.equal(before.figures.find((f: any) => f.key === 'mrr')!.value, 5100);
  assert.equal(before.figures.find((f: any) => f.key === 'customers')!.value, 12);

  const g = google(SHEET, EVENTS);
  const res = await withGoogle(g, () => call(env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID, part: 'sheets' }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.sheets.written, 3); assert.equal(res.body.sheets.problems.length, 0);
  assert.deepEqual(res.body.sheets.skipped.map((s: any) => [s.row, s.reason]), [[4, 'not_a_number'], [5, 'not_a_date'], [6, 'date_repeated'], [8, 'not_a_number'], [8, 'no_figures']]);
  assert.equal(res.body.calendar, undefined, 'part: sheets reads no Calendar');

  const rows = sheetRowsOf(db);
  assert.deepEqual(rows.map((r: any) => [r.snapshot_date, r.new_users, r.cac, r.headcount]), [['2026-08-31', 40, 1200, 4], ['2026-09-30', 55, 1150.5, 5], ['2026-10-20', 61, null, null]]);
  for (const r of rows) for (const col of CONNECTED_METRIC_COLUMNS) if (col in r) assert.equal(r[col], null, `${col} stays empty`);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM connector_fed_items WHERE integration_id = ? AND module = 'revenue_and_traction' AND kind = 'metric_day' AND local_id IS NOT NULL").get(WORKSPACE).n, 3);

  assert.deepEqual(await figures(), before.figures);
  assert.deepEqual(await kpis(), before.kpis);
  assert.ok(g.calls.every((c) => c.method === 'GET' || c.host === 'oauth2.googleapis.com'));

  // Idempotent: a second sync updates the same three rows.
  const again = await withGoogle(google(SHEET, EVENTS), () => call(env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID, part: 'sheets' }));
  assert.equal(again.body.sheets.written, 3); assert.equal(sheetRowsOf(db).length, 3);
  assert.equal((db.prepare("SELECT last_error, status FROM google_workspace_files WHERE uid = 'f-metrics'").get() as any).status, 'active');
});

test('a Sheet row the founder deletes stays deleted; Stop using keeps the rows, and choosing the file again links them again', async () => {
  const { db, env } = await world();
  await withGoogle(google(SHEET, EVENTS), () => call(env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID, part: 'sheets' }));
  const aug = (sheetRowsOf(db) as any[]).find((r) => r.snapshot_date === '2026-08-31');
  assert.equal((await call(env, INVESTOR, 'DELETE', `/api/cycles/grow/google/facts/${aug.id}?project=${PID}`)).status, 403);
  const stripeRow = (db.prepare("SELECT id FROM project_metrics WHERE source = 'stripe' LIMIT 1").get() as any).id;
  assert.equal((await call(env, FOUNDER, 'DELETE', `/api/cycles/grow/google/facts/${stripeRow}?project=${PID}`)).status, 404, 'only a Sheet row');
  assert.equal((await call(env, FOUNDER, 'DELETE', `/api/cycles/grow/google/facts/${aug.id}?project=${PID}`)).status, 200);
  const next = await withGoogle(google(SHEET, EVENTS), () => call(env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID, part: 'sheets' }));
  assert.equal(next.body.sheets.kept_deleted, 1); assert.equal(next.body.sheets.written, 2);
  assert.deepEqual(sheetRowsOf(db).map((r: any) => r.snapshot_date), ['2026-09-30', '2026-10-20']);

  // Stop using (D1091's route) unlinks this file's ledger rows under the ledger module too, and keeps the rows.
  db.exec("UPDATE connector_fed_items SET local_id = NULL WHERE integration_id = 77 AND project_id = 7 AND module IN ('revenue_traction', 'revenue_and_traction') AND substr(external_id, 1, 13) = 'sheetMetrics:'");
  assert.equal(sheetRowsOf(db).length, 2);
  const relinked = await withGoogle(google(SHEET, EVENTS), () => call(env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID, part: 'sheets' }));
  assert.equal(relinked.body.sheets.written, 2); assert.equal(relinked.body.sheets.kept_deleted, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM connector_fed_items WHERE kind = 'metric_day' AND local_id IS NOT NULL").get().n, 2);
  assert.match(src('routes/google_workspace.ts'), /module IN \(\?, \?\)[\s\S]*GOOGLE_WORKSPACE_LEDGER_MODULE\[row\.module\] \?\? row\.module/);
});

test('two Sheets naming the same day keep one row: the second Sheet\'s row is skipped with its reason', async () => {
  const { db, env } = await world();
  db.prepare(`INSERT INTO google_workspace_files (uid, integration_id, user_id, project_id, module, drive_file_id, mime_type, kind, name, mapping_json)
    VALUES ('f-second', ?, ?, ?, 'revenue_traction', 'sheetSecond', 'application/vnd.google-apps.spreadsheet', 'sheet', 'Second', ?)`).run(WORKSPACE, FOUNDER, PID, JSON.stringify(MAPPING));
  const res = await withGoogle(google(SHEET, EVENTS), () => call(env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID, part: 'sheets' }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.sheets.files, 2); assert.equal(res.body.sheets.written, 3);
  assert.deepEqual(res.body.sheets.skipped.filter((s: any) => s.file === 'f-second' && s.reason === 'date_in_another_sheet').map((s: any) => s.row), [2, 3, 4]);
  assert.equal(sheetRowsOf(db).length, 3);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM connector_fed_items WHERE substr(external_id, 1, 12) = 'sheetSecond:'").get().n, 0);
});

test('an unmapped or wrongly mapped Sheet lands nothing and says so; a mapping naming a refused column is refused when it is saved', async () => {
  const { db, env } = await world();
  db.prepare("UPDATE google_workspace_files SET mapping_json = ? WHERE uid = 'f-metrics'").run(JSON.stringify({ date: 'A', active_users: 'B' }));
  const res = await withGoogle(google(SHEET, EVENTS), () => call(env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID, part: 'sheets' }));
  assert.deepEqual(res.body.sheets.problems, [{ file: 'f-metrics', error: 'mapping_column_not_allowed' }]);
  db.prepare("UPDATE google_workspace_files SET mapping_json = NULL WHERE uid = 'f-metrics'").run();
  const none = await withGoogle(google(SHEET, EVENTS), () => call(env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID, part: 'sheets' }));
  assert.deepEqual(none.body.sheets.problems, [{ file: 'f-metrics', error: 'not_mapped' }]);
  assert.equal(sheetRowsOf(db).length, 0);
  assert.equal((db.prepare("SELECT status FROM google_workspace_files").get() as any).status, 'active', 'a mapping problem is not an unreadable file');
  const route = src('routes/google_workspace.ts');
  assert.match(route, /if \(row\.module === METRICS_FILE_MODULE\) \{\s*try \{ metricsMapping\(body\.mapping\); \}/);
});

test('every "latest row" reader of a Stripe or Mercury column skips google_sheets rows', () => {
  const progress = src('routes/progress.ts');
  for (const sql of [
    /SELECT mrr, active_users, monthly_churn_pct, new_users\s+FROM project_metrics WHERE project_id = \? AND COALESCE\(source, ''\) <> 'google_sheets'/,
    /SELECT snapshot_date, mrr, arr, cac, ltv, monthly_churn_pct, active_users, new_users\s+FROM project_metrics WHERE project_id = \? AND COALESCE\(source, ''\) <> 'google_sheets'/,
  ]) assert.match(progress, sql);
  assert.equal((progress.match(/FROM project_metrics WHERE project_id = \? AND \(COALESCE\(source, ''\) <> 'google_sheets' OR \$\{safeMetric\} IS NOT NULL\)/g) || []).length, 2);
  assert.match(src('routes/research.ts'), /SELECT snapshot_date, mrr, paying_accounts, net_burn, cash_balance\s+FROM project_metrics WHERE project_id = \? AND COALESCE\(source, ''\) <> 'google_sheets'/);
  assert.match(src('services/records/grow.ts'), /cash_balance AS cash, net_burn AS burn FROM project_metrics WHERE project_id = \? AND COALESCE\(source, ''\) <> 'google_sheets'/);
});

// ─────────────────────────────────────────────────────────── the Calendar

test('only an event the founder tags #board or #filing, once, is proposed; its title loses the tag', () => {
  assert.deepEqual(calendarTag('Q4 review #board'), { kind: 'board_meeting', title: 'Q4 review' });
  assert.deepEqual(calendarTag('#FILING'), { kind: 'filing_deadline', title: 'Filing deadline' });
  assert.equal(calendarTag('#boarding pass'), null); assert.equal(calendarTag('#board #filing'), null); assert.equal(calendarTag('Lunch'), null);
  assert.deepEqual(calendarProposals(EVENTS as any), [
    { event_id: 'evboard1', kind: 'board_meeting', title: 'Q4 review', date: '2026-11-03' },
    { event_id: 'evfile1', kind: 'filing_deadline', title: 'Delaware franchise tax', date: '2027-03-01' },
  ]);
});

test('a Calendar sync proposes tagged events and keeps no description, place or guest; Accept writes the obligation, Dismiss stays dismissed', async () => {
  const { db, env } = await world();
  const g = google(SHEET, EVENTS);
  const logs: string[] = []; const oldLog = console.log; const oldErr = console.error;
  console.log = (...a: unknown[]) => { logs.push(a.join(' ')); }; console.error = (...a: unknown[]) => { logs.push(a.join(' ')); };
  let res;
  try { res = await withGoogle(g, () => call(env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID, part: 'calendar' })); }
  finally { console.log = oldLog; console.error = oldErr; }
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.calendar, { proposed: 2, updated: 0, withdrawn: 0, decided_kept: 0, partial: false });
  assert.equal(res.body.sheets, undefined);
  const read = g.calls.find((c) => c.path === '/calendar/v3/calendars/primary/events')!;
  assert.equal(read.method, 'GET'); assert.match(decodeURIComponent(read.query), /fields=items\(id,status,summary,start\),nextPageToken/);
  const stored = JSON.stringify(db.prepare('SELECT * FROM google_workspace_proposals').all());
  assert.doesNotMatch(stored, /private agenda|Synthetic HQ|guest@else|Lunch|#board/);
  assert.doesNotMatch(logs.join('\n'), /Q4 review|franchise|private agenda|synthetic-access|server-refresh-only/);

  const list = await call(env, FOUNDER, 'GET', `/api/cycles/grow/google/durable-company-building?project=${PID}`);
  assert.deepEqual(list.body.proposals.map((p: any) => [p.kind, p.title, p.date]), [['board_meeting', 'Q4 review', '2026-11-03'], ['filing_deadline', 'Delaware franchise tax', '2027-03-01']]);
  const [board, filing] = list.body.proposals;
  assert.deepEqual((await call(env, COFOUNDER, 'GET', `/api/cycles/grow/google/durable-company-building?project=${PID}`)).body.proposals, [], 'proposals are the member\'s own');
  assert.equal((await call(env, COFOUNDER, 'POST', `/api/cycles/grow/google/proposals/${board.id}/accept`, { project: PID })).status, 409, 'no Workspace connection of their own');

  const accepted = await call(env, FOUNDER, 'POST', `/api/cycles/grow/google/proposals/${board.id}/accept`, { project: PID });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const ob = db.prepare('SELECT title, due_date, kind, event_type, source FROM compliance_events WHERE id = ?').get(accepted.body.obligation_id) as any;
  assert.deepEqual({ ...ob }, { title: 'Q4 review', due_date: '2026-11-03', kind: 'governance', event_type: 'board_meeting', source: 'google_calendar' });
  assert.equal(db.prepare("SELECT local_id FROM connector_fed_items WHERE external_id = 'calendar:evboard1:7'").get().local_id, accepted.body.obligation_id);
  assert.equal((await call(env, FOUNDER, 'POST', `/api/cycles/grow/google/proposals/${board.id}/accept`, { project: PID })).status, 409);
  assert.equal((await call(env, FOUNDER, 'POST', `/api/cycles/grow/google/proposals/${filing.id}/dismiss`, { project: PID })).status, 200);
  assert.equal((await call(env, FOUNDER, 'POST', `/api/cycles/grow/google/proposals/999/dismiss`, { project: PID })).status, 404);

  // Re-sync: a decided event is never proposed again, and nothing new is written.
  const again = await withGoogle(google(SHEET, EVENTS), () => call(env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID, part: 'calendar' }));
  assert.deepEqual(again.body.calendar, { proposed: 0, updated: 0, withdrawn: 0, decided_kept: 2, partial: false });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM compliance_events').get().n, 1);
  assert.deepEqual((await call(env, FOUNDER, 'GET', `/api/cycles/grow/google/durable-company-building?project=${PID}`)).body.decided, { accepted: 1, dismissed: 1 });
});

test('a pending proposal follows its event; it is withdrawn only after a whole read, and an obligation already due that day is refused in words', async () => {
  const { db, env } = await world();
  await withGoogle(google(SHEET, EVENTS), () => call(env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID, part: 'calendar' }));
  const moved = EVENTS.map((e) => (e.id === 'evboard1' ? { ...e, summary: 'Q4 board review #board', start: { date: '2026-11-10' } } : e));
  const upd = await withGoogle(google(SHEET, moved), () => call(env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID, part: 'calendar' }));
  assert.equal(upd.body.calendar.updated, 1);
  assert.equal((db.prepare("SELECT title FROM google_workspace_proposals WHERE source_key = 'calendar:evboard1'").get() as any).title, 'Q4 board review');
  const untagged = moved.filter((e) => e.id !== 'evfile1');
  const partial = await withGoogle(google(SHEET, untagged, { nextPage: true }), () => call(env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID, part: 'calendar' }));
  assert.equal(partial.body.calendar.partial, true); assert.equal(partial.body.calendar.withdrawn, 0);
  const whole = await withGoogle(google(SHEET, untagged), () => call(env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID, part: 'calendar' }));
  assert.equal(whole.body.calendar.withdrawn, 1);

  db.prepare("INSERT INTO compliance_events (project_id, jurisdiction, event_type, title, due_date, source) VALUES (?, 'Unspecified', 'board_meeting', 'Typed', '2026-11-10', 'manual')").run(PID);
  const id = (db.prepare("SELECT id FROM google_workspace_proposals WHERE source_key = 'calendar:evboard1'").get() as any).id;
  const clash = await call(env, FOUNDER, 'POST', `/api/cycles/grow/google/proposals/${id}/accept`, { project: PID });
  assert.equal(clash.status, 409); assert.match(clash.body.detail, /already due on 2026-11-10/);
  assert.equal((db.prepare('SELECT status FROM google_workspace_proposals WHERE id = ?').get(id) as any).status, 'pending');
});

test('Calendar failures answer in codes on their own: a missing grant, a reconnect, and Google\'s body is never returned', async () => {
  const { env } = await world({ scope: DRIVE_FILE_SCOPE });
  const noScope = await withGoogle(google(SHEET, EVENTS), () => call(env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID }));
  assert.equal(noScope.status, 200);
  assert.deepEqual(noScope.body.calendar, { error: 'calendar_not_allowed' });
  assert.equal(noScope.body.sheets.written, 3, 'one failed part never blanks the other');
  const w = await world();
  const refused = await withGoogle(google(SHEET, EVENTS, { calendarStatus: 401 }), () => call(w.env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID, part: 'calendar' }));
  assert.deepEqual(refused.body.calendar, { error: 'calendar_reconnect' });
  assert.doesNotMatch(JSON.stringify(refused.body), /raw-private-provider-body/);
});

test('support sessions, admins and a disabled company are refused before Google is read', async () => {
  const { db, env } = await world();
  const g = google(SHEET, EVENTS);
  db.exec('UPDATE integration_companies SET enabled = 0');
  const off = await withGoogle(g, () => call(env, FOUNDER, 'POST', '/api/cycles/grow/google/sync', { project: PID }));
  assert.deepEqual([off.status, off.body.error], [409, 'company_not_enabled']);
  assert.equal(g.calls.length, 0);
  assert.equal((await call(env, INVESTOR, 'POST', '/api/cycles/grow/google/sync', { project: PID })).status, 403);
  assert.equal((await call(env, FOUNDER, 'GET', '/api/cycles/grow/google/team-expansion?project=7')).status, 404);
});

test('the feed registry names both Grow feeds, and the directory reads them', () => {
  const grow = GOOGLE_WORKSPACE_FEEDS.filter((f) => f.decision === 'D1095');
  assert.deepEqual(grow.map((f) => [f.key, f.module, f.lands]), [
    ['grow_metrics_sheet', 'revenue_and_traction', 'fact'], ['grow_calendar_obligations', 'durable_company_building', 'proposal'],
  ]);
  assert.deepEqual(
    CONNECTOR_METADATA.google_workspace.pulls.filter((p) => grow.some((f) => f.what === p.what && f.module === p.module)),
    grow.map((f) => ({ what: f.what, module: f.module })),
  );
  for (const module of ['revenue_and_traction', 'durable_company_building']) {
    assert.ok(CONNECTOR_METADATA.google_workspace.feeds.includes(module), module);
  }
});
