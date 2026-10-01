/**
 * D401 — the rail's lasting "Last run" receipt.
 *
 * The canvas draws "Last run · in/out · cost" in the Usage block, persisting
 * across page loads. `/api/ai/me/spend` already returned `last_run` without
 * token counts; D401 adds them (null where the log's zero is not a count) and
 * a `last_run_recorded` flag so a failed read is not "no runs". The rail draws
 * it labelled as the ACCOUNT's last run, because `ai_usage_logs` records no
 * page.
 *
 * The Worker half is pinned on real SQLite in
 * `cloudflare-worker/test/ai_spend_self.test.ts` (the D401 block).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/worker_rail_last_run_d401.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { lastRunReceipt } from '../src/ui/assistCost.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const RAIL = 'frontend/src/ui/WorkerRail.jsx';

const LIVE = {
  task: 'workspace_explain', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  cost_usd: 0.00061, prompt_tokens: 812, completion_tokens: 1440,
  cached: false, fallback_used: false, refusal: null, at: '2026-08-27 11:30:00',
};

// ── The line ────────────────────────────────────────────────────────────

test('a live run reads model · in/out · cost', () => {
  assert.equal(lastRunReceipt(LIVE, 'Llama 3.3 70B Fast'),
    'Llama 3.3 70B Fast · 812 in / 1,440 out · $0.0006');
});

test('with no display name the model falls back to its id, never blank', () => {
  assert.match(lastRunReceipt(LIVE), /^llama-3\.3-70b-instruct-fp8-fast · /);
});

test('a zero is never printed as a token count', () => {
  // The Worker nulls every zero it cannot vouch for; the line must not
  // re-invent one from a missing field, and must not print one it is handed.
  for (const run of [
    { ...LIVE, prompt_tokens: null, completion_tokens: null },
    { ...LIVE, prompt_tokens: 0, completion_tokens: 0 },
    { ...LIVE, prompt_tokens: undefined, completion_tokens: undefined },
  ]) {
    const line = lastRunReceipt(run);
    assert.doesNotMatch(line, /\b0 in\b|\b0 out\b/, `printed a zero count: ${line}`);
    assert.match(line, /tokens not recorded/);
  }
});

test('a streamed call has a prompt count and says the completion is not recorded', () => {
  assert.match(lastRunReceipt({ ...LIVE, completion_tokens: null }), /812 in \/ out not recorded/);
});

test('a cached answer and a refusal say what they were, not a token count', () => {
  assert.match(lastRunReceipt({ ...LIVE, cached: true, prompt_tokens: null, completion_tokens: null }),
    /cached, no model called/);
  assert.match(lastRunReceipt({ ...LIVE, refusal: 'budget_user_day', cost_usd: 0 }),
    /refused, nothing run/);
  // A refusal with stray counts is still a refusal.
  assert.doesNotMatch(lastRunReceipt({ ...LIVE, refusal: 'budget_user_day' }), /812 in/);
});

test('a fallback is named, because the answer came from a different model', () => {
  assert.match(lastRunReceipt({ ...LIVE, fallback_used: true }), /a smaller model answered$/);
});

test('an absent cost is said, not printed as $0.0000', () => {
  assert.match(lastRunReceipt({ ...LIVE, cost_usd: null }), /cost not recorded/);
  assert.doesNotMatch(lastRunReceipt({ ...LIVE, cost_usd: null }), /\$0\.0000/);
});

test('no run is null, so the rail decides what absence looks like', () => {
  assert.equal(lastRunReceipt(null), null);
  assert.equal(lastRunReceipt(undefined), null);
});

// ── The rail ────────────────────────────────────────────────────────────

/** The Usage block of the rail, from source. */
function usageBlock() {
  const src = codeOnly(read(RAIL));
  const from = src.indexOf('<span>Usage this month</span>');
  assert.ok(from > 0, 'the usage block was not found');
  return src.slice(from, src.indexOf('</section>', from));
}

test('the rail draws the lasting receipt in the Usage block, labelled account-wide', () => {
  const block = usageBlock();
  assert.match(block, /lastRunReceipt\(spend\.last_run, MODEL_COPY\[spend\.last_run\.model\]\?\.name\)/,
    'the receipt is not drawn from the spend report\'s last_run');
  // The label must say whose run it is. `ai_usage_logs` records no page, so a
  // label that reads as "this page's last run" states a fact the log lacks.
  assert.match(block, /<b>Last run · your account, any page<\/b>/,
    'the receipt is not labelled as the account\'s');
});

test('a failed last-run read is Unreadable with a retry, not "no runs"', () => {
  const block = usageBlock();
  assert.match(block,
    /spend\.last_run_recorded === false\s*\?\s*\(\s*<div[^>]*>\s*<Unreadable[\s\S]{0,160}?onRetry=\{reload\}/,
    'an unreadable last run renders as if there were none');
});

test('a successful run re-reads the report, so the receipt is current', () => {
  const src = codeOnly(read(RAIL));
  const body = src.slice(src.indexOf('const readBack = useCallback'), src.indexOf('} catch (e) {', src.indexOf('const readBack = useCallback')));
  assert.match(body, /setRun\(\{ state: 'done'[^\n]*\n[\s\S]*?reload\(\);/,
    'a run completes and the lasting receipt keeps describing the one before it');
  // The dependency list, not its exact spelling: D404 added `pagePath` to it.
  const deps = src.slice(src.indexOf('} catch (e) {', src.indexOf('const readBack = useCallback')));
  assert.match(deps, /^[\s\S]*?\}, \[[^\]]*\breload\b[^\]]*\]\);/,
    'readBack closes over a stale reload');
});

test('an unreadable task breakdown does not claim "no runs of this yet"', () => {
  const src = codeOnly(read(RAIL));
  assert.match(src, /spend\?\.by_task_recorded === false\s*\?\s*<Unreadable[^>]*onRetry=\{reload\}/,
    'a failed by_task read renders the no-history sentence');
});
