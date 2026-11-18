/**
 * D7169 (#7169) — quarterly reports in a private fund dossier: create-only
 * POST, partial PATCH (absent keeps, null clears), the If-Match revision and
 * field-level 400s. Runs the real SQL against migration 230 in node:sqlite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
import {
  createReport, fieldErrorSentence, nextRevision, parseReportFields, patchReport, readIfMatch,
} from '../src/services/researchFundReports.ts';

const migration = readFileSync(new URL('../sql/migrations/230_research_fund_reports.sql', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes/research.ts', import.meta.url), 'utf8');

const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY);
  CREATE TABLE research_funds (uid TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL);
  ${migration}
`;
const SEED = `
  INSERT INTO users (id) VALUES (1), (2);
  INSERT INTO research_funds (uid, owner_user_id) VALUES ('f1', 1), ('f2', 2);
`;

const FULL = {
  period: '2026-Q2', report_date: '2026-07-14', nav_cents: 10_000_000, quarterly_return_bps: null,
  net_irr_bps: 940, tvpi_bps: 140, source_url: 'https://example.com/lp/2026-q2.pdf', notes: 'NAV from the letter.',
};
const at = (iso: string) => new Date(iso);

async function seeded() {
  const { DB, db } = makeD1(SCHEMA, SEED);
  const out = await createReport(DB as any, 1, 'f1', FULL, 'r1', '2026-11-12T09:10:00.000Z');
  assert.equal(out.kind, 'created');
  return { DB, db, report: (out as any).report };
}

test('adding a return to a saved quarter keeps NAV, IRR, TVPI, the source and the note (FND-Q4)', async () => {
  const { DB, report } = await seeded();
  const out = await patchReport(DB as any, 1, 'f1', 'r1', { quarterly_return_bps: 420 }, report.updated_at, at('2026-11-16T14:32:00Z'));
  assert.equal(out.kind, 'updated');
  const row = (out as any).report;
  assert.equal(row.quarterly_return_bps, 420);
  assert.equal(row.nav_cents, 10_000_000);
  assert.equal(row.net_irr_bps, 940);
  assert.equal(row.tvpi_bps, 140);
  assert.equal(row.source_url, FULL.source_url);
  assert.equal(row.notes, FULL.notes);
  assert.equal(row.report_date, '2026-07-14');
  assert.deepEqual((out as any).changed, ['quarterly_return_bps']);
  assert.equal(row.updated_at, '2026-11-16T14:32:00.000Z');
});

test('null clears a field to Not recorded; absent keeps it', async () => {
  const { DB, report } = await seeded();
  const out = await patchReport(DB as any, 1, 'f1', 'r1', { tvpi_bps: null, nav_cents: 10_250_000 }, report.updated_at, at('2026-11-16T14:32:00Z'));
  const row = (out as any).report;
  assert.equal(row.tvpi_bps, null);
  assert.equal(row.nav_cents, 10_250_000);
  assert.equal(row.net_irr_bps, 940);
});

test('POST is create-only: a saved period answers period_exists with its row and is not overwritten', async () => {
  const { DB } = await seeded();
  const out = await createReport(DB as any, 1, 'f1', { period: '2026-Q2', source_url: 'https://example.com/other', quarterly_return_bps: 420 }, 'r2', '2026-11-16T14:00:00.000Z');
  assert.equal(out.kind, 'period_exists');
  const row = (out as any).report;
  assert.equal(row.uid, 'r1');
  assert.equal(row.nav_cents, 10_000_000);
  assert.equal(row.quarterly_return_bps, null);
  assert.equal(row.source_url, FULL.source_url);
});

test('a stale If-Match answers report_changed with the current row and writes nothing', async () => {
  const { DB, report } = await seeded();
  const first = await patchReport(DB as any, 1, 'f1', 'r1', { nav_cents: 10_100_000 }, report.updated_at, at('2026-11-16T14:30:00Z'));
  assert.equal(first.kind, 'updated');
  const second = await patchReport(DB as any, 1, 'f1', 'r1', { quarterly_return_bps: 420 }, report.updated_at, at('2026-11-16T14:32:00Z'));
  assert.equal(second.kind, 'report_changed');
  assert.equal((second as any).report.nav_cents, 10_100_000);
  assert.equal((second as any).report.quarterly_return_bps, null);
  const third = await patchReport(DB as any, 1, 'f1', 'r1', { quarterly_return_bps: 420 }, (second as any).report.updated_at, at('2026-11-16T14:33:00Z'));
  assert.equal(third.kind, 'updated');
  assert.equal((third as any).report.nav_cents, 10_100_000);
});

test('PATCH without a revision is refused rather than written blind', async () => {
  const { DB } = await seeded();
  const out = await patchReport(DB as any, 1, 'f1', 'r1', { quarterly_return_bps: 420 }, null);
  assert.equal(out.kind, 'revision_required');
});

test('the revision moves even when the clock has not', () => {
  assert.equal(nextRevision('2026-11-16T14:32:00.000Z', at('2026-11-16T14:32:00.000Z')), '2026-11-16T14:32:00.001Z');
  assert.equal(nextRevision('2026-11-16T14:32:00.000Z', at('2026-11-16T14:33:00.000Z')), '2026-11-16T14:33:00.000Z');
  assert.equal(readIfMatch('W/"2026-11-16T14:32:00.000Z"'), '2026-11-16T14:32:00.000Z');
  assert.equal(readIfMatch('  '), null);
});

test('another owner, another fund or an unknown report is not found', async () => {
  const { DB, report } = await seeded();
  assert.equal((await patchReport(DB as any, 2, 'f1', 'r1', { nav_cents: 1 }, report.updated_at)).kind, 'not_found');
  assert.equal((await patchReport(DB as any, 1, 'f2', 'r1', { nav_cents: 1 }, report.updated_at)).kind, 'not_found');
  assert.equal((await patchReport(DB as any, 1, 'f1', 'nope', { nav_cents: 1 }, report.updated_at)).kind, 'not_found');
});

test('a non-number is a field error, never a stored null (FND-Q7)', async () => {
  const { DB, report } = await seeded();
  const out = await patchReport(DB as any, 1, 'f1', 'r1', { nav_cents: '100k', quarterly_return_bps: 4.2 }, report.updated_at);
  assert.equal(out.kind, 'invalid');
  assert.deepEqual((out as any).errors.map((e: any) => e.field), ['nav_cents', 'quarterly_return_bps']);
  const unchanged = await patchReport(DB as any, 1, 'f1', 'r1', {}, report.updated_at);
  assert.equal((unchanged as any).report.nav_cents, 10_000_000);
});

test('field rules: ranges, URLs, dates, the period', () => {
  const errs = (body: unknown, mode: 'create' | 'patch' = 'patch') => parseReportFields(body, mode).errors.map((e) => e.field);
  assert.deepEqual(errs({ quarterly_return_bps: -210 }), []);
  assert.deepEqual(errs({ quarterly_return_bps: 0 }), []);
  assert.deepEqual(errs({ quarterly_return_bps: -10001 }), ['quarterly_return_bps']);
  assert.deepEqual(errs({ nav_cents: -1 }), ['nav_cents']);
  assert.deepEqual(errs({ tvpi_bps: Number.NaN }), ['tvpi_bps']);
  assert.deepEqual(errs({ tvpi_bps: '140' }), ['tvpi_bps']);
  assert.deepEqual(errs({ source_url: null }), ['source_url']);
  assert.deepEqual(errs({ source_url: 'javascript:alert(1)' }), ['source_url']);
  assert.deepEqual(errs({ report_url: null, notes: '' }), []);
  assert.deepEqual(errs({ report_date: '2026-02-30' }), ['report_date']);
  assert.deepEqual(errs({ report_date: '2026-07-14' }), []);
  assert.deepEqual(errs({ period: '2026-Q5', source_url: 'https://x.test' }, 'create'), ['period']);
  assert.deepEqual(errs({ period: '2026-Q1' }, 'create'), ['source_url']);
  assert.equal(parseReportFields({ notes: 'x'.repeat(2001) }, 'patch').errors[0].field, 'notes');
  assert.equal(fieldErrorSentence([{ field: 'nav_cents', detail: 'A.' }]), 'A.');
  assert.match(fieldErrorSentence([{ field: 'a', detail: 'A.' }, { field: 'b', detail: 'B.' }]), /^2 fields need a fix: a, b\.$/);
});

test('a saved period cannot be renamed by PATCH', async () => {
  const { DB, report } = await seeded();
  const out = await patchReport(DB as any, 1, 'f1', 'r1', { period: '2026-Q3' }, report.updated_at);
  assert.equal(out.kind, 'invalid');
  assert.equal((out as any).errors[0].field, 'period');
  assert.equal((await patchReport(DB as any, 1, 'f1', 'r1', { period: '2026-Q2' }, report.updated_at)).kind, 'updated');
});

test('the routes: owner-gated, POST no longer upserts, codes and statuses as drawn', () => {
  const post = routes.slice(routes.indexOf("research.post('/funds/:uid/reports'"), routes.indexOf("research.patch('/funds/:uid/reports/:reportUid'"));
  const patch = routes.slice(routes.indexOf("research.patch('/funds/:uid/reports/:reportUid'"), routes.indexOf("research.delete('/funds/:uid/reports/:reportUid'"));
  assert.match(post, /requireAuth\(c\)/);
  assert.match(post, /owner_user_id = \?/);
  assert.doesNotMatch(post, /DO UPDATE/);
  assert.match(post, /code: 'period_exists'[\s\S]*409/);
  assert.match(patch, /requireAuth\(c\)/);
  assert.match(patch, /patchReport\(c\.env\.DB as any, user\.id, fundUid/);
  assert.match(patch, /readIfMatch\(c\.req\.header\('If-Match'\)\)/);
  assert.match(patch, /code: 'report_changed'[\s\S]*409/);
  assert.match(patch, /code: 'revision_required'[\s\S]*428/);
  assert.match(patch, /code: 'invalid_report_field'[\s\S]*400/);
});
