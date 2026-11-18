/**
 * D7170 (#7170) — Research › Funds Google Sheets sync: tab identity, the
 * export write order and read-back, paging past 500, physical rows and the
 * mapped uid column, field ticks and Resolve rows, previews, the run record
 * with its idempotency key, the uncertain state and reconcile.
 *
 * The service runs against in-process SQLite (the real migrations) and a fake
 * Google Sheets API that keeps a grid per tab, so a writeback to the wrong row
 * or column, or a retry that creates the same fund twice, shows up as cells
 * and rows rather than as a mocked call count.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  planImport, readSyncFields, readResolutions, findTab, columnLetter, describeExport,
  listOwnerFunds, exportFundsToSheet, importFundsFromSheet, reconcileImportRun,
  previewExport, previewImport, listWorkbookTabs, saveSheetDestination, checkLinkedTab,
  latestRuns, openImportRun, readIdempotencyKey, SheetSyncError, SHEET_HEADERS,
  type FundRecord,
} from '../src/services/fundSheets.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ── D1 over node:sqlite ────────────────────────────────────────────────────

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

function makeD1(db: InstanceType<typeof DatabaseSync>, hooks: { failBatch?: boolean } = {}) {
  const d1: any = {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    // D1's batch is one transaction: all of it lands or none of it does.
    async batch(stmts: any[]) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        if (hooks.failBatch) throw new Error('batch_failed');
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return d1;
}

const SID = '1Abcdefghijklmnopqrstuvwxyz0123456789';

function fresh(hooks: { failBatch?: boolean } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)');
  db.exec('CREATE TABLE projects (id INTEGER PRIMARY KEY)');
  db.exec(read('cloudflare-worker/sql/migrations/216_research_funds.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/274_research_fund_sheets.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/202611180052_7170_research_fund_sheet_runs.sql'));
  db.exec(`INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')`);
  db.exec(`INSERT INTO google_sheets_oauth_tokens (user_id, refresh_token, google_email) VALUES (1, 'refresh-1', 'hq@example.com')`);
  db.exec(`INSERT INTO research_fund_sheet_links (owner_user_id, spreadsheet_id, sheet_gid, sheet_title) VALUES (1, '${SID}', 100, 'Shortlist')`);
  const env = {
    DB: makeD1(db, hooks),
    JWT_SECRET: 'unit-test-jwt-secret-0123456789-abcdef',
    GOOGLE_SHEETS_CLIENT_ID: 'id', GOOGLE_SHEETS_CLIENT_SECRET: 'secret', PUBLIC_BASE_URL: 'https://axal.vc',
  } as any;
  return { db, env };
}

function addFund(db: InstanceType<typeof DatabaseSync>, uid: string, name: string, extra: Partial<FundRecord> = {}, owner = 1, created = '2026-01-01') {
  db.prepare(`INSERT INTO research_funds (uid, owner_user_id, name, status, stage_fit, path, note, pass_reason, thesis, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uid, owner, name, extra.status || 'researching', extra.stage_fit ?? null, extra.path ?? null,
      extra.note ?? null, extra.pass_reason ?? null, extra.thesis ?? null, created, created);
}

// ── A fake Google Sheets API: a grid per tab ────────────────────────────────

type Tab = { gid: number; title: string; index: number; grid: string[][] };

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseRange(range: string) {
  const m = range.match(/^'((?:[^']|'')*)'(?:!([A-Z]+)?(\d+)?(?::([A-Z]+)?(\d+)?)?)?$/);
  if (!m) throw new Error(`bad range ${range}`);
  return {
    title: m[1].replace(/''/g, "'"),
    c1: m[2] ? colIndex(m[2]) : 0,
    r1: m[3] ? Number(m[3]) - 1 : 0,
    c2: m[4] ? colIndex(m[4]) : m[2] && !m[4] && !range.includes(':') ? colIndex(m[2]) : 1000,
    r2: m[5] ? Number(m[5]) - 1 : m[3] && !range.includes(':') ? Number(m[3]) - 1 : 100000,
  };
}

function fakeGoogle(tabs: Tab[], opts: { failOn?: (method: string, path: string) => 'timeout' | number | null } = {}) {
  const calls: string[] = [];
  const tab = (title: string) => {
    const t = tabs.find((x) => x.title === title);
    if (!t) throw new Error(`no tab ${title}`);
    return t;
  };
  const get = (range: string) => {
    const r = parseRange(range);
    const g = tab(r.title).grid;
    const out: string[][] = [];
    for (let i = r.r1; i <= Math.min(r.r2, g.length - 1); i++) {
      const row = (g[i] || []).slice(r.c1, r.c2 + 1);
      while (row.length && (row[row.length - 1] ?? '') === '') row.pop();
      out.push(row);
    }
    while (out.length && out[out.length - 1].length === 0) out.pop();
    return out;
  };
  const put = (range: string, values: string[][]) => {
    const r = parseRange(range);
    const g = tab(r.title).grid;
    values.forEach((row, i) => {
      const at = r.r1 + i;
      while (g.length <= at) g.push([]);
      row.forEach((v, j) => {
        const c = r.c1 + j;
        while (g[at].length <= c) g[at].push('');
        g[at][c] = String(v);
      });
    });
  };
  const clear = (range: string) => {
    const r = parseRange(range);
    const g = tab(r.title).grid;
    for (let i = r.r1; i <= Math.min(r.r2, g.length - 1); i++) {
      for (let c = r.c1; c <= r.c2 && c < (g[i] || []).length; c++) g[i][c] = '';
    }
  };
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const fetchImpl = async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    if (url.hostname === 'oauth2.googleapis.com') return json({ access_token: 'access' });
    const path = decodeURIComponent(url.pathname.replace(`/v4/spreadsheets/${SID}`, ''));
    calls.push(`${method} ${path}`);
    const fail = opts.failOn?.(method, path);
    if (fail === 'timeout') throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    if (typeof fail === 'number') return new Response('{"error":"refused"}', { status: fail });
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (path === '' && method === 'GET') {
      return json({ properties: { title: 'Axal HQ · Fund shortlist' }, sheets: tabs.map((t) => ({ properties: { sheetId: t.gid, title: t.title, index: t.index } })) });
    }
    if (path === ':batchUpdate') {
      const title = body.requests[0].addSheet.properties.title;
      const gid = 900 + tabs.length;
      tabs.push({ gid, title, index: tabs.length, grid: [] });
      return json({ replies: [{ addSheet: { properties: { sheetId: gid, title, index: tabs.length - 1 } } }] });
    }
    if (path === '/values:batchGet') {
      return json({ valueRanges: url.searchParams.getAll('ranges').map((r) => ({ range: r, values: get(r) })) });
    }
    if (path === '/values:batchUpdate') {
      for (const d of body.data) put(d.range, d.values);
      return json({});
    }
    if (path.startsWith('/values/') && path.endsWith(':clear')) {
      clear(path.slice('/values/'.length, -':clear'.length));
      return json({});
    }
    if (path.startsWith('/values/') && method === 'PUT') {
      put(path.slice('/values/'.length), body.values);
      return json({});
    }
    if (path.startsWith('/values/') && method === 'GET') {
      return json({ values: get(path.slice('/values/'.length)) });
    }
    throw new Error(`unhandled ${method} ${path}`);
  };
  return { fetchImpl, calls };
}

async function withGoogle<T>(g: ReturnType<typeof fakeGoogle>, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  (globalThis as any).fetch = g.fetchImpl;
  try { return await fn(); } finally { (globalThis as any).fetch = original; }
}

const H = [...SHEET_HEADERS];
const NO_PRIVATE = readSyncFields({});
const ALL_FIELDS = readSyncFields({ thesis: true, note: true, pass_reason: true });

// ── Field ticks ─────────────────────────────────────────────────────────────

test('private fields are off unless a run ticks them; thesis is on unless unticked', () => {
  assert.deepEqual(readSyncFields(undefined), { thesis: true, note: false, pass_reason: false });
  assert.deepEqual(readSyncFields({ note: 'yes', pass_reason: 1 }), { thesis: true, note: false, pass_reason: false });
  assert.deepEqual(readSyncFields({ thesis: false, note: true, pass_reason: true }), { thesis: false, note: true, pass_reason: true });
});

test('an idempotency key is required and shaped', () => {
  assert.throws(() => readIdempotencyKey(''), (e: any) => e instanceof SheetSyncError && e.code === 'idempotency_key_required');
  assert.throws(() => readIdempotencyKey('short'), (e: any) => e.code === 'idempotency_key_required');
  assert.equal(readIdempotencyKey('run-0123456789'), 'run-0123456789');
});

test('resolutions keep only row numbers and the two choices', () => {
  assert.deepEqual(readResolutions({ 17: 'keep_axal', 6: 'skip', x: 'skip', 9: 'take_over' }), { 17: 'keep_axal', 6: 'skip' });
});

test('column letters run past Z', () => {
  assert.equal(columnLetter(0), 'A');
  assert.equal(columnLetter(3), 'D');
  assert.equal(columnLetter(25), 'Z');
  assert.equal(columnLetter(26), 'AA');
});

// ── Tab identity ────────────────────────────────────────────────────────────

test('a missing gid is tab_missing, never the first tab', () => {
  const tabs = [{ gid: 0, title: 'Archive 2025', index: 0 }, { gid: 412, title: 'Notes', index: 1 }];
  assert.throws(() => findTab(tabs, 100), (e: any) => e instanceof SheetSyncError && e.code === 'tab_missing' && e.status === 409);
  assert.equal(findTab([...tabs, { gid: 100, title: 'Shortlist', index: 2 }], 100).title, 'Shortlist');
});

test('export refuses tab_missing, writes nothing and keeps the link', async () => {
  const { db, env } = fresh();
  addFund(db, 'f1', 'Fjord Ventures');
  const archive: Tab = { gid: 0, title: 'Archive 2025', index: 0, grid: [['Old', 'rows']] };
  const g = fakeGoogle([archive]);
  await withGoogle(g, async () => {
    await assert.rejects(
      exportFundsToSheet(env, { id: 1 }, { fields: NO_PRIVATE, idempotencyKey: 'key-export-1' }),
      (e: any) => e.code === 'tab_missing',
    );
    await assert.rejects(
      importFundsFromSheet(env, { id: 1 }, { fields: NO_PRIVATE, resolutions: {}, idempotencyKey: 'key-import-1' }),
      (e: any) => e.code === 'tab_missing',
    );
  });
  assert.deepEqual(archive.grid, [['Old', 'rows']], 'the first tab was written to');
  const link = db.prepare('SELECT sheet_gid, sheet_title FROM research_fund_sheet_links WHERE owner_user_id = 1').get() as any;
  assert.equal(link.sheet_gid, 100, 'the link was moved to another tab');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM research_fund_sheet_runs').get() as any).n, 0);
  assert.ok(!g.calls.some((c) => c.startsWith('PUT') || c.includes(':clear')));
});

test('the card status sees a missing tab', async () => {
  const { env } = fresh();
  const g = fakeGoogle([{ gid: 0, title: 'Archive 2025', index: 0, grid: [] }]);
  const link = { spreadsheet_id: SID, sheet_gid: 100, sheet_title: 'Shortlist' } as any;
  const state = await withGoogle(g, () => checkLinkedTab(env, 1, link));
  assert.equal(state.state, 'missing');
});

test('tabs are listed by gid with rows and a header match; saving needs a chosen gid', async () => {
  const { db, env } = fresh();
  const tabs: Tab[] = [
    { gid: 0, title: 'Archive 2025', index: 0, grid: [['Name', 'Year'], ['A', '1'], ['B', '2']] },
    { gid: 100, title: 'Shortlist', index: 1, grid: [H, ['u1', 'Fjord']] },
  ];
  const g = fakeGoogle(tabs);
  await withGoogle(g, async () => {
    const listing = await listWorkbookTabs(env, { id: 1 });
    assert.deepEqual(listing.tabs.map((t) => [t.gid, t.rows, t.headers_match]), [[0, 3, false], [100, 2, true]]);
    assert.equal(listing.linked_present, true);
    await assert.rejects(saveSheetDestination(env, { id: 1 }, { spreadsheetId: SID, sheetGid: null, createTab: null }),
      (e: any) => e.code === 'tab_required');
    await assert.rejects(saveSheetDestination(env, { id: 1 }, { spreadsheetId: SID, sheetGid: 55, createTab: null }),
      (e: any) => e.code === 'tab_missing');
    const made = await saveSheetDestination(env, { id: 1 }, { spreadsheetId: SID, sheetGid: null, createTab: 'Axal funds' });
    assert.equal(made.sheet_title, 'Axal funds');
    assert.equal(tabs.length, 3);
    assert.equal(Number(made.sheet_gid), tabs[2].gid);
    await assert.rejects(saveSheetDestination(env, { id: 1 }, { spreadsheetId: SID, sheetGid: null, createTab: 'axal funds' }),
      (e: any) => e.code === 'tab_exists');
  });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM research_funds').get() as any).n, 0);
});

// ── Export ──────────────────────────────────────────────────────────────────

test('export pages past 500 and reports every fund', async () => {
  const { db, env } = fresh();
  const insert = db.prepare(`INSERT INTO research_funds (uid, owner_user_id, name, status, created_at, updated_at) VALUES (?, 1, ?, 'researching', ?, ?)`);
  for (let i = 0; i < 501; i++) {
    const at = `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`;
    insert.run(`u${i}`, `Fund ${i}`, at, at);
  }
  addFund(db, 'other', 'Not mine', {}, 2);
  assert.equal((await listOwnerFunds(env, { id: 1 })).length, 501);
  const shortlist: Tab = { gid: 100, title: 'Shortlist', index: 0, grid: [] };
  const { run } = await withGoogle(fakeGoogle([shortlist]), () =>
    exportFundsToSheet(env, { id: 1 }, { fields: NO_PRIVATE, idempotencyKey: 'key-export-501' }));
  assert.equal(run.status, 'complete');
  assert.equal(run.counts.expected, 501);
  assert.equal(run.counts.written, 501);
  assert.equal(shortlist.grid.length, 502);
  assert.equal(shortlist.grid[501][0], 'u0', 'the oldest fund is the last row');
});

test('export writes first, clears only rows past the end, and never touches L onward', async () => {
  const { db, env } = fresh();
  addFund(db, 'f1', 'Fjord Ventures', { note: 'private note', pass_reason: 'too early', thesis: 'climate' }, 1, '2026-01-02');
  addFund(db, 'f2', 'Quarry Fund', {}, 1, '2026-01-01');
  const shortlist: Tab = {
    gid: 100, title: 'Shortlist', index: 0,
    grid: [
      [...H, 'Owner'],
      ['old1', 'Old 1', '', '', '', '', '', '', '', '', '', 'Ann'],
      ['old2', 'Old 2', '', '', '', '', '', '', '', '', '', 'Bo'],
      ['old3', 'Old 3', '', '', '', '', '', '', '', '', '', 'Cy'],
      ['Total', '=SUM(C2:C4)', '16 Nov'],
    ],
  };
  const g = fakeGoogle([shortlist]);
  const preview = await withGoogle(g, () => previewExport(env, { id: 1 }, NO_PRIVATE));
  assert.equal(preview.range, 'A1:K3');
  assert.deepEqual(preview.cleared.cells, ['A4', 'B4', 'A5', 'B5', 'C5']);
  assert.equal(preview.cleared.range, 'A4:K5');
  assert.deepEqual(preview.other_columns, [{ column: 'L', header: 'Owner', filled: 3 }]);
  assert.deepEqual(preview.private, { note: 0, pass_reason: 0 });
  assert.equal(preview.available.note, 1);
  assert.ok(!g.calls.some((c) => c.startsWith('PUT') || c.includes(':clear')), 'a preview wrote to the sheet');

  const { run } = await withGoogle(g, () => exportFundsToSheet(env, { id: 1 }, { fields: NO_PRIVATE, idempotencyKey: 'key-export-clr' }));
  const order = g.calls.filter((c) => c.startsWith('PUT') || c.includes(':clear'));
  assert.ok(order[0].startsWith('PUT'), 'the export cleared before it wrote');
  assert.match(order[1], /A4:K5:clear$/, 'the clear was not bounded to rows past the end');
  assert.equal(run.status, 'complete');
  assert.deepEqual(shortlist.grid[1].slice(0, 2), ['f1', 'Fjord Ventures']);
  assert.equal(shortlist.grid[1][9], '', 'a note was written without being ticked');
  assert.equal(shortlist.grid[1][7], '', 'a pass reason was written without being ticked');
  assert.equal(shortlist.grid[1][8], 'climate');
  assert.equal(shortlist.grid[1][11], 'Ann', 'column L was overwritten');
  assert.deepEqual(shortlist.grid[4].slice(0, 3), ['', '', '']);
});

test('export writes private fields only when ticked', async () => {
  const { db, env } = fresh();
  addFund(db, 'f1', 'Fjord Ventures', { note: 'private note', pass_reason: 'too early' });
  const shortlist: Tab = { gid: 100, title: 'Shortlist', index: 0, grid: [] };
  await withGoogle(fakeGoogle([shortlist]), () =>
    exportFundsToSheet(env, { id: 1 }, { fields: ALL_FIELDS, idempotencyKey: 'key-export-prv' }));
  assert.equal(shortlist.grid[1][9], 'private note');
  assert.equal(shortlist.grid[1][7], 'too early');
});

test('an export Google refuses is failed with nothing written; a timeout before read-back is not complete', async () => {
  const { db, env } = fresh();
  addFund(db, 'f1', 'Fjord Ventures');
  const shortlist: Tab = { gid: 100, title: 'Shortlist', index: 0, grid: [H, ['keep', 'Kept']] };
  const refused = await withGoogle(
    fakeGoogle([shortlist], { failOn: (m) => (m === 'PUT' ? 403 : null) }),
    () => exportFundsToSheet(env, { id: 1 }, { fields: NO_PRIVATE, idempotencyKey: 'key-export-403' }),
  );
  assert.equal(refused.run.status, 'failed');
  assert.equal(refused.run.counts.written, 0);
  assert.deepEqual(shortlist.grid[1], ['keep', 'Kept'], 'a refused export cleared the tab');

  let reads = 0;
  const timedOut = await withGoogle(
    fakeGoogle([shortlist], { failOn: (m, p) => (m === 'PUT' ? 'timeout' : m === 'GET' && p.startsWith('/values/') && ++reads > 1 ? 'timeout' : null) }),
    () => exportFundsToSheet(env, { id: 1 }, { fields: NO_PRIVATE, idempotencyKey: 'key-export-tmo' }),
  );
  assert.equal(timedOut.run.status, 'uncertain');
});

test('the export review bounds the clear to the cells past the new last row', () => {
  const funds = [{ uid: 'a' }, { uid: 'b' }] as FundRecord[];
  const d = describeExport(funds, [H, ['x'], ['y'], ['z']], NO_PRIVATE);
  assert.equal(d.range, 'A1:K3');
  assert.deepEqual(d.cleared.cells, ['A4']);
});

// ── Import planning ─────────────────────────────────────────────────────────

const owned = (rows: Partial<FundRecord>[]) => new Map(rows.map((r) => [r.uid as string, {
  uid: r.uid, name: r.name || 'x', cheque_min_cents: null, cheque_max_cents: null, stage_fit: null, path: null,
  status: 'researching', pass_reason: null, thesis: null, note: null, source_url: null, ...r,
} as FundRecord]));

test('a blank row keeps its number and the uid goes to the mapped column', () => {
  const values = [
    ['Fund', 'Cheque min (USD)', 'Cheque max (USD)', 'uid', 'Stage fit'],
    ['Fjord Ventures', '', '', 'f1', 'right'],
    [],
    ['Larch Partners', '', '', '', 'wrong'],
  ];
  const plan = planImport(values, owned([{ uid: 'f1', name: 'Fjord Ventures', stage_fit: 'right' }]), NO_PRIVATE);
  assert.equal(plan.mapping.uid_column, 'D');
  assert.deepEqual(plan.rows.map((r) => [r.row, r.action]), [[2, 'unchanged'], [3, 'blank'], [4, 'create']]);
  assert.equal(plan.rows[2].uid_cell, 'D4');
  assert.equal(plan.counts.unchanged, 1);
});

test('only mapped and ticked fields update; a missing column keeps Axal’s value', () => {
  const values = [
    ['uid', 'Fund', 'Note', 'Pass reason', 'State'],
    ['f1', 'Fjord Ventures', 'sheet note', 'sheet reason', 'passed'],
  ];
  const axal = owned([{ uid: 'f1', name: 'Fjord Ventures', note: 'axal note', pass_reason: null, thesis: 'kept', cheque_min_cents: 5000 }]);
  const off = planImport(values, axal, NO_PRIVATE);
  assert.deepEqual(off.rows[0].changes.map((c) => c.field), ['status'], 'an unticked private field or a missing column changed');
  const on = planImport(values, axal, readSyncFields({ pass_reason: true }));
  assert.deepEqual(on.rows[0].changes.map((c) => [c.field, c.private]), [['status', false], ['pass_reason', true]]);
});

test('an unrecognised value is a Resolve row until it is kept or skipped', () => {
  const values = [['uid', 'Fund', 'Stage fit', 'Path'], ['r1', 'Ridge Angels', 'maybe', 'warm']];
  const axal = owned([{ uid: 'r1', name: 'Ridge Angels', stage_fit: 'right', path: 'cold' }]);
  const open = planImport(values, axal, NO_PRIVATE);
  assert.equal(open.rows[0].action, 'resolve');
  assert.equal(open.rows[0].resolve?.field, 'stage_fit');
  assert.equal(open.rows[0].resolve?.axal_value, 'right');
  const kept = planImport(values, axal, NO_PRIVATE, { 2: 'keep_axal' });
  assert.equal(kept.rows[0].action, 'update');
  assert.deepEqual(kept.rows[0].changes.map((c) => c.field), ['path'], 'keep Axal’s value still cleared or changed stage fit');
  assert.equal(planImport(values, axal, NO_PRIVATE, { 2: 'skip' }).rows[0].action, 'skip');
});

test('a uid that is not this owner’s, or repeats, is never imported', () => {
  const values = [['uid', 'Fund'], ['theirs', 'Stolen'], ['f1', 'Mine'], ['f1', 'Mine again']];
  const plan = planImport(values, owned([{ uid: 'f1', name: 'Mine' }]), NO_PRIVATE, { 2: 'keep_axal' });
  assert.deepEqual(plan.rows.map((r) => [r.action, r.resolve?.kind || null]),
    [['resolve', 'foreign_uid'], ['unchanged', null], ['resolve', 'duplicate_uid']]);
});

test('a row with no fund name is a skip; a tab with no Fund or uid header is refused', () => {
  const plan = planImport([['uid', 'Fund', 'Path'], ['', '', 'warm']], new Map(), NO_PRIVATE);
  assert.equal(plan.rows[0].action, 'skip');
  assert.throws(() => planImport([['Name?', 'Year']], new Map(), NO_PRIVATE), (e: any) => e.code === 'header_missing');
});

// ── Import runs ─────────────────────────────────────────────────────────────

function importTab(): Tab {
  return {
    gid: 100, title: 'Shortlist', index: 0,
    grid: [
      ['Fund', 'Cheque min (USD)', 'Cheque max (USD)', 'uid', 'Stage fit', 'Path', 'State'],
      ['Fjord Ventures', '', '1500000', 'f1', 'right', 'warm', 'researching'],
      ['Larch Partners', '', '', '', '', 'warm', ''],
      [],
      ['Osier Capital', '', '', '', '', 'cold', ''],
    ],
  };
}

test('import writes the new uids to the mapped column on the sheet’s own rows and reads them back', async () => {
  const { db, env } = fresh();
  addFund(db, 'f1', 'Fjord Ventures', { stage_fit: 'right', path: 'warm' });
  const tab = importTab();
  const g = fakeGoogle([tab]);
  const preview = await withGoogle(g, () => previewImport(env, { id: 1 }, NO_PRIVATE, {}));
  assert.deepEqual(preview.rows.map((r: any) => [r.row, r.action]), [[2, 'update'], [3, 'create'], [4, 'blank'], [5, 'create']]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM research_funds').get() as any).n, 1, 'a preview wrote to Axal');

  const { run } = await withGoogle(g, () => importFundsFromSheet(env, { id: 1 }, { fields: NO_PRIVATE, resolutions: {}, idempotencyKey: 'key-import-ok' }));
  assert.equal(run.status, 'complete');
  assert.equal(run.counts.created, 2);
  assert.equal(run.counts.updated, 1);
  assert.equal(run.counts.ids_confirmed, 2);
  const larch = db.prepare(`SELECT uid FROM research_funds WHERE name = 'Larch Partners'`).get() as any;
  const osier = db.prepare(`SELECT uid FROM research_funds WHERE name = 'Osier Capital'`).get() as any;
  assert.equal(tab.grid[2][3], larch.uid, 'Larch’s uid is not in D3');
  assert.equal(tab.grid[4][3], osier.uid, 'Osier’s uid shifted up past the blank row');
  assert.equal(tab.grid[2][0], 'Larch Partners', 'the writeback overwrote the fund name in column A');
  const fjord = db.prepare(`SELECT cheque_max_cents, note FROM research_funds WHERE uid = 'f1'`).get() as any;
  assert.equal(fjord.cheque_max_cents, 150_000_000);
});

test('a timeout after the Axal writes is uncertain, blocks the next import, and a replay creates nothing', async () => {
  const { db, env } = fresh();
  addFund(db, 'f1', 'Fjord Ventures', { stage_fit: 'right', path: 'warm' });
  const tab = importTab();
  const flaky = fakeGoogle([tab], { failOn: (m, p) => (m === 'POST' && p === '/values:batchUpdate' ? 'timeout' : null) });
  const first = await withGoogle(flaky, () => importFundsFromSheet(env, { id: 1 }, { fields: NO_PRIVATE, resolutions: {}, idempotencyKey: 'key-import-tmo' }));
  assert.equal(first.run.status, 'uncertain');
  assert.equal(first.run.counts.created, 2);
  assert.deepEqual(first.run.pending.map((p) => p.cell), ['D3', 'D5']);
  const count = () => (db.prepare('SELECT COUNT(*) AS n FROM research_funds WHERE owner_user_id = 1').get() as any).n;
  assert.equal(count(), 3);

  const again = await withGoogle(flaky, () => importFundsFromSheet(env, { id: 1 }, { fields: NO_PRIVATE, resolutions: {}, idempotencyKey: 'key-import-tmo' }));
  assert.equal(again.replayed, true);
  assert.equal(again.run.uid, first.run.uid);
  await assert.rejects(
    withGoogle(flaky, () => importFundsFromSheet(env, { id: 1 }, { fields: NO_PRIVATE, resolutions: {}, idempotencyKey: 'key-import-new' })),
    (e: any) => e.code === 'reconcile_required' && e.extra.run === first.run.uid,
  );
  assert.equal(count(), 3, 'a retry created the same funds again');
  assert.equal((await openImportRun(env, 1))?.uid, first.run.uid);

  // One identifier did land; the check finds 1 of 2 and writes only the other.
  tab.grid[2][3] = first.run.pending[0].uid;
  const ok = fakeGoogle([tab]);
  const checked = await withGoogle(ok, () => reconcileImportRun(env, { id: 1 }, first.run.uid, { write: false }));
  assert.equal(checked.status, 'uncertain');
  assert.deepEqual(checked.pending.map((p) => p.state), ['matches', 'empty']);
  assert.ok(!ok.calls.some((c) => c.includes('batchUpdate')), 'the check wrote to the sheet');
  const done = await withGoogle(ok, () => reconcileImportRun(env, { id: 1 }, first.run.uid, { write: true }));
  assert.equal(done.status, 'complete');
  assert.ok(done.verified_at);
  assert.equal(tab.grid[4][3], first.run.pending[1].uid);
  assert.equal(await openImportRun(env, 1), null);
  const runs = await latestRuns(env, 1);
  assert.equal(runs.import?.status, 'complete');
  assert.equal(runs.import?.counts.ids_confirmed, 2);
});

test('reconcile leaves a cell holding something else alone and is owner-scoped', async () => {
  const { db, env } = fresh();
  const tab = importTab();
  const flaky = fakeGoogle([tab], { failOn: (m, p) => (m === 'POST' && p === '/values:batchUpdate' ? 503 : null) });
  const first = await withGoogle(flaky, () => importFundsFromSheet(env, { id: 1 }, { fields: NO_PRIVATE, resolutions: {}, idempotencyKey: 'key-import-503' }));
  assert.equal(first.run.status, 'uncertain');
  tab.grid[2][3] = 'typed by hand';
  const done = await withGoogle(fakeGoogle([tab]), () => reconcileImportRun(env, { id: 1 }, first.run.uid, { write: true }));
  assert.equal(done.status, 'partial');
  assert.equal(tab.grid[2][3], 'typed by hand');
  await assert.rejects(
    withGoogle(fakeGoogle([tab]), () => reconcileImportRun(env, { id: 2 }, first.run.uid, { write: true })),
    (e: any) => e.code === 'run_not_found',
  );
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM research_fund_sheet_runs WHERE owner_user_id = 2`).get() as any).n, 0);
});

test('an Axal batch that fails writes no fund and records the run as failed', async () => {
  const { db, env } = fresh({ failBatch: true });
  const tab = importTab();
  const { run } = await withGoogle(fakeGoogle([tab]), () => importFundsFromSheet(env, { id: 1 }, { fields: NO_PRIVATE, resolutions: {}, idempotencyKey: 'key-import-bat' }));
  assert.equal(run.status, 'failed');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM research_funds').get() as any).n, 0);
  assert.equal(tab.grid[2][3] ?? '', '');
});

test('import never deletes and never takes over another owner’s fund', async () => {
  const { db, env } = fresh();
  addFund(db, 'mine', 'Mine');
  addFund(db, 'theirs', 'Secret', {}, 2);
  const tab: Tab = { gid: 100, title: 'Shortlist', index: 0, grid: [['uid', 'Fund'], ['theirs', 'Stolen']] };
  const { run } = await withGoogle(fakeGoogle([tab]), () => importFundsFromSheet(env, { id: 1 }, { fields: NO_PRIVATE, resolutions: { 2: 'keep_axal' }, idempotencyKey: 'key-import-own' }));
  assert.equal(run.status, 'complete');
  assert.equal((run.counts.planned as any).resolve, 1);
  const theirs = db.prepare(`SELECT name, owner_user_id FROM research_funds WHERE uid = 'theirs'`).get() as any;
  assert.deepEqual([theirs.name, theirs.owner_user_id], ['Secret', 2]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM research_funds').get() as any).n, 2);
});
