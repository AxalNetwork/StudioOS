/**
 * D220 — one dead-letter backlog, and a failed read stays a failed read.
 *
 * The backlog is both tables, summed by dlqDepth. A row that lives only in
 * cf_dlq_mirror is part of that sum, so the Technical report, the queue
 * stats, and HQ Platform all print the same total. Dropping the mirror
 * makes the figure null and names the table: the management CSV leaves the
 * value empty and carries the reason, and the report HTML says unreadable.
 * Neither surface prints 0.
 *
 * Tables come from schema_baseline.sql. A fixture that invents a schema
 * only confirms its own assumptions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SignJWT } from 'jose';

import platform from '../src/routes/admin_platform.ts';
import { Jobs } from '../src/models/jobs.ts';
import {
  loadTechnical, reportToCsv, reportToHtml, parseRange,
} from '../src/services/analyticsReports.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 801;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
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
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { return x; },
  };
}

const BASELINE = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8',
);
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

const SWITCHES_MIGRATION = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/migrations/283_platform_switches.sql'), 'utf8',
);

const TABLES = [
  'users', 'super_admins', 'integrations', 'cron_run_history',
  'dead_letter_queue', 'cf_dlq_mirror', 'status_incidents',
  'telegram_channels', 'telegram_posts', 'x_accounts',
  'queue_jobs', 'system_metrics', 'error_logs',
];

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of TABLES) db.exec(ddl(t));
  db.exec(SWITCHES_MIGRATION);
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)')
    .run(SUPER, 'admin', 'The Holder', 'holder@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  return db;
}

function envOf(db: InstanceType<typeof DatabaseSync>) {
  return { DB: makeD1(db), ENVIRONMENT: 'development' } as any;
}

async function platformTotal(db: InstanceType<typeof DatabaseSync>) {
  const jwt = await new SignJWT({ user_id: SUPER, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await platform.fetch(
    new Request('http://x/summary', { headers: { Authorization: `Bearer ${jwt}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  const text = await res.text();
  assert.equal(res.status, 200, text);
  return JSON.parse(text).monitoring.dlq;
}

const range = parseRange('2026-09-01', '2026-09-24');

function managementCsvRow(csv: string, metric: string): { value: string; note: string } {
  const line = csv.split('\n').find((l) => l.startsWith(`technical,${metric},`));
  assert.ok(line, `no technical,${metric} row in\n${csv}`);
  // value is the third field; a quoted note may contain commas.
  const rest = line.slice(`technical,${metric},`.length);
  const comma = rest.indexOf(',');
  assert.ok(comma >= 0, line);
  const value = rest.slice(0, comma);
  let note = rest.slice(comma + 1);
  if (note.startsWith('"')) {
    note = note.slice(1, note.endsWith('"') ? -1 : undefined).replace(/""/g, '"');
  }
  return { value, note };
}

function dlqHtml(html: string): string {
  const m = html.match(/<strong>DLQ:<\/strong>\s*([^<]+)/);
  assert.ok(m, html);
  return m[1];
}

test('a mirror-only dead letter is the Technical figure, and it equals Platform and the queue stat', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO cf_dlq_mirror (message_id, job_type) VALUES ('m-only', 'email')").run();

  const technical = await loadTechnical(envOf(db), range);
  const platformDlq = await platformTotal(db);
  const stats = await Jobs.stats(envOf(db));

  assert.equal(platformDlq.available, true);
  assert.equal(platformDlq.mirror, 1);
  assert.equal(platformDlq.legacy, 0);
  assert.equal(technical.dlq_count, platformDlq.total);
  assert.equal(technical.dlq_count, 1);
  assert.equal(technical.dlq_reason, null);
  assert.equal(stats.dlq_count, platformDlq.total);
  assert.equal(stats.dlq_reason, null);
  // An empty pending queue is a measured zero, not an unreadable one.
  assert.equal(technical.queue_depth, 0);
  assert.equal(technical.queue_depth_reason, null);

  const csv = reportToCsv('management', { technical });
  const row = managementCsvRow(csv, 'dlq_count');
  assert.equal(row.value, '1');
  assert.equal(row.note, '');
  const line = dlqHtml(reportToHtml('technical', technical, range));
  assert.equal(line, '1');
});

test('a dropped mirror makes the backlog null, names the table, and never prints 0', async () => {
  const db = freshDb();
  db.exec("INSERT INTO dead_letter_queue (job_type, last_error) VALUES ('email', 'boom')");
  db.exec('DROP TABLE cf_dlq_mirror');

  const technical = await loadTechnical(envOf(db), range);
  const platformDlq = await platformTotal(db);
  const stats = await Jobs.stats(envOf(db));

  assert.equal(technical.dlq_count, null);
  assert.notEqual(technical.dlq_count, 0);
  assert.match(String(technical.dlq_reason), /cf_dlq_mirror/);
  assert.equal(platformDlq.available, false);
  assert.match(String(platformDlq.reason), /cf_dlq_mirror/);
  assert.equal(stats.dlq_count, null);
  assert.match(String(stats.dlq_reason), /cf_dlq_mirror/);

  const csv = reportToCsv('management', { technical });
  assert.match(csv, /^section,metric,value,note$/m);
  const row = managementCsvRow(csv, 'dlq_count');
  assert.equal(row.value, '');
  assert.match(row.note, /cf_dlq_mirror/);
  assert.doesNotMatch(csv, /^technical,dlq_count,0/m);

  const line = dlqHtml(reportToHtml('management', { technical }, range));
  assert.match(line, /^unreadable/);
  assert.match(line, /cf_dlq_mirror/);
  assert.doesNotMatch(line, /null|undefined/);
  assert.notEqual(line, '0');
});

test('a dropped queue_jobs table makes queue depth null and names the table', async () => {
  const db = freshDb();
  db.exec('DROP TABLE queue_jobs');
  const technical = await loadTechnical(envOf(db), range);
  assert.equal(technical.queue_depth, null);
  assert.match(String(technical.queue_depth_reason), /queue_jobs/);
  const row = managementCsvRow(reportToCsv('management', { technical }), 'queue_depth');
  assert.equal(row.value, '');
  assert.match(row.note, /queue_jobs/);
  const html = reportToHtml('technical', technical, range);
  const m = html.match(/<strong>Queue depth:<\/strong>\s*([^<·]+)/);
  assert.ok(m, html);
  assert.match(m[1], /^unreadable/);
  assert.match(m[1], /queue_jobs/);
});

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walkTs(p, out);
    else if (name.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const COUNT_EITHER = /COUNT\s*\(\s*\*\s*\)(?:\s+\w+)*\s+FROM\s+(?:dead_letter_queue|cf_dlq_mirror)/g;

test('nothing outside deadLetters and the DLQ console counts either backlog table', () => {
  const root = resolve(process.cwd(), 'cloudflare-worker/src');
  const allowed = new Set([
    resolve(root, 'services/deadLetters.ts'),
    resolve(root, 'routes/infra.ts'),
  ]);
  const offenders: string[] = [];
  for (const file of walkTs(root)) {
    const hits = codeOnly(readFileSync(file, 'utf8')).match(COUNT_EITHER);
    if (hits && !allowed.has(file)) offenders.push(`${file}: ${hits.join(' | ')}`);
  }
  assert.deepEqual(offenders, []);
  const defined = codeOnly(readFileSync(resolve(root, 'services/deadLetters.ts'), 'utf8')).match(COUNT_EITHER);
  assert.ok(defined && defined.length >= 2, 'dlqDepth no longer counts both tables');
});
