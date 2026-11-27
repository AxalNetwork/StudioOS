/**
 * D9203 (#9203) — three hot reads that scanned a whole table.
 *
 *   1. agents/skillRubric.monthSpend   ai_usage_logs WHERE surface = ? AND created_at >= ?
 *   2. agents/runActivity.heldFor      ai_budget_reservations WHERE execution_id = ?
 *   3. fundLedger.postLedgerEntry      the posting UPDATE's three subqueries on fund_ledger_lines
 *
 * Each statement is captured from the code as it builds it (a recording D1 that
 * answers the reads postLedgerEntry needs and commits nothing), then planned
 * with EXPLAIN QUERY PLAN against the migrated schema (baseline plus every
 * migration). Each must SEARCH its table through an index and never SCAN it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/scan_indexes_9203.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { monthSpend } from '../src/services/agents/skillRubric.ts';
import { heldFor } from '../src/services/agents/runActivity.ts';
import { postLedgerEntry } from '../src/services/fundLedger.ts';

const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
loadSchema(db);

/** A D1 stand-in that records every prepared SQL string and answers the ledger's reads. */
function recorder() {
  const sql: string[] = [];
  const stmt = (text: string) => {
    const s: any = {
      bind: () => s,
      first: async () => (/FROM fund_accounting_periods/.test(text)
        ? { id: 1, fund_id: 10, closed: 0, version: 1, start_date: '2024-01-01', end_date: '2024-03-31' }
        : { usd: 0, held: null, n: 0 }),
      all: async () => ({ success: true, results: [{ id: 3, category: 'asset' }, { id: 2, category: 'liability' }] }),
      run: async () => ({ success: true, meta: { changes: 1 } }),
    };
    return s;
  };
  const DB = {
    prepare(text: string) { sql.push(text); return stmt(text); },
    batch: async (statements: unknown[]) => statements.map(() => ({ success: true, meta: { changes: 1 } })),
  };
  return { env: { DB } as any, sql };
}

function plan(sql: string): string {
  return db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map((row: any) => String(row.detail)).join('\n');
}

function assertSearched(detail: string, table: string, index: RegExp) {
  assert.doesNotMatch(detail, new RegExp(`\\bSCAN ${table}\\b`), `${table} is scanned:\n${detail}`);
  assert.match(detail, new RegExp(`SEARCH ${table} USING (COVERING )?INDEX `), `${table} is not searched by an index:\n${detail}`);
  assert.match(detail, index, `${table} is searched by another index:\n${detail}`);
}

test('the monthly rubric spend searches ai_usage_logs by surface and created_at', async () => {
  const { env, sql } = recorder();
  await monthSpend(env, new Date('2026-11-27T12:00:00Z'));
  const read = sql.find(s => /FROM ai_usage_logs/.test(s));
  assert.ok(read, 'monthSpend prepared no ai_usage_logs read');
  assertSearched(plan(read!), 'ai_usage_logs', /INDEX idx_ai_usage_logs_surface_created \(surface=\? AND created_at>\?\)/);
});

test("a run's held cost searches ai_budget_reservations by execution_id", async () => {
  const { env, sql } = recorder();
  await heldFor(env, 'run-uid-9203');
  const read = sql.find(s => /FROM ai_budget_reservations/.test(s));
  assert.ok(read, 'heldFor prepared no ai_budget_reservations read');
  assertSearched(plan(read!), 'ai_budget_reservations', /INDEX idx_ai_reservations_execution \(execution_id=\?\)/);
});

test("posting an entry recomputes its totals through idx_fund_ledger_lines_entry, never a scan of every fund's lines", async () => {
  const { env, sql } = recorder();
  await postLedgerEntry(env, { id: 1, role: 'admin' }, 10, 1, {
    entry_date: '2024-02-01', description: 'Opening cash',
    lines: [{ account_id: 3, debit_cents: 1000000, credit_cents: 0 }, { account_id: 2, debit_cents: 0, credit_cents: 1000000 }],
  });
  const update = sql.find(s => /UPDATE fund_ledger_entries SET posted=1/.test(s));
  assert.ok(update, 'postLedgerEntry prepared no posting UPDATE');
  const detail = plan(update!);
  assertSearched(detail, 'fund_ledger_lines', /INDEX idx_fund_ledger_lines_entry \(fund_id=\? AND entry_id=\?\)/);
  // One correlated subquery per total: debit, credit and the line count.
  assert.equal(detail.match(/SEARCH fund_ledger_lines USING (COVERING )?INDEX idx_fund_ledger_lines_entry \(fund_id=\? AND entry_id=\?\)/g)?.length, 3, detail);
});
