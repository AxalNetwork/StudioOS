#!/usr/bin/env node
/**
 * check-refusal-bodies — D278.
 *
 * Under cloudflare-worker/src/routes, no `message`, `detail` or `error` key
 * takes an exception's text or a provider response's text. That text goes to
 * the log beside a code, through `util/refusal.ts` (`refuse`, `refusalBody`,
 * `rowFailureSentence`); the body carries a sentence we wrote.
 *
 * WHAT COUNTS AS RAW TEXT: `e.message`, `e?.message`, `(e as Error).message`
 * (and the same for `err`, `ex`, `error`, `exc`), `String(e…)`, and a
 * response's `.text()` — on the same line as the key.
 *
 * A FLOOR, so it cannot pass on an empty tree: it must find at least
 * HELPER_FLOOR calls to the helper. Deleting the sweep, or pointing the guard
 * at the wrong directory, fails it for that reason alone.
 *
 * A NAMED LEDGER of the sites kept on purpose, each with its reason. An entry
 * that no longer matches a flagged line is stale and fails the guard — the
 * ledger only records what is still true.
 *
 * Run: node scripts/check-refusal-bodies.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROUTES_DIR = path.join(ROOT, 'cloudflare-worker', 'src', 'routes');

/** The number of helper calls the sweep put in place, less a margin for honest removals. */
export const HELPER_FLOOR = 110;

const RAW = String.raw`(?:\b(?:e|err|ex|error|exc)\??\.message\b|\((?:e|err|ex|error|exc)\s+as\s+(?:Error|any)\)\??\.message|String\((?:e|err|ex|error|exc)\b|\.text\(\))`;
const KEYED_RAW = new RegExp(String.raw`\b(?:message|detail|error)\s*:\s*[^,}]*` + RAW);
const HELPER_CALL = /\b(?:refuse|refusalBody|rowFailureSentence)\(/g;

/**
 * Sites kept on purpose. `contains` is a substring of the flagged line; one
 * entry may cover several identical lines in its file.
 */
export const LEDGER = [
  { file: 'admin_contracts.ts', contains: 'if (e instanceof TemplateError) return c.json({ error: e.message', reason: 'TemplateError carries a sentence services/ wrote, not provider or SQLite text.' },
  { file: 'admin_telegram.ts', contains: "error: 'telegram_token_missing', code: 'telegram_token_missing', message: e.message", reason: 'TelegramTokenMissing is our own configuration sentence.' },
  { file: 'admin_x.ts', contains: 'if (e instanceof XConfigMissing) return', reason: 'XConfigMissing is our own configuration sentence.' },
  { file: 'cofounder.ts', contains: 'try { gate(user); } catch (e: any) { return c.json({ detail: e.message }', reason: "gate() throws one sentence we wrote ('Co-founder matching is for founder accounts')." },
  { file: 'monitoring_analytics.ts', contains: 'if (e instanceof BadRangeError)', reason: 'BadRangeError is our own validation sentence.' },
  { file: 'monitoring_analytics.ts', contains: 'if (e instanceof PlanCreateError) return c.json({ detail: e.message }', reason: 'PlanCreateError is our own validation sentence.' },
  { file: 'refer_earn.ts', contains: '{ ok: false, error: { code: e.code, message: e.message } }', reason: 'ReferralError is our own sentence with its code.' },
  { file: 'scoring.ts', contains: "return c.json({ error: e.message, field: e.field, code: 'reserved_field' }", reason: 'ReservedFieldError is our own validation sentence.' },
  { file: 'scoring.ts', contains: "return c.json({ error: e.message, missing: e.missing, code: 'missing_official_inputs' }", reason: 'MissingOfficialInputsError is our own validation sentence.' },
  { file: 'settings.ts', contains: 'const body: Record<string, unknown> = { error: e.message };', reason: 'SettingsValidationError / ProfileValidationError: field-level sentences we wrote. Recasting `error` to a code is filed in D278.' },
  { file: 'settings.ts', contains: 'return c.json({ error: e.message, code: e.code }, e.status as 400);', reason: 'LinkedInImportError is our own sentence with its code.' },
  { file: 'admin_github.ts', contains: 'detail: `Network error', reason: 'A 200-status health-check body; out of scope and filed in D278.' },
  { file: 'infra.ts', contains: "{ ok: false, detail: ", reason: 'Health-check bodies (200); out of scope and filed in D278.' },
  { file: 'advisor.ts', contains: "sseEvent('error', { message: (e as Error).message })", reason: 'An SSE error event; out of scope and filed in D278.' },
  { file: 'advisor.ts', contains: 'toolCalls: [{ name, error: (e as Error).message }]', reason: 'A tool-call result inside a streamed turn; out of scope and filed in D278.' },
  { file: 'assistant.ts', contains: 'resultJson = { error: (e as Error).message }', reason: 'A tool-call result inside a streamed turn; out of scope and filed in D278.' },
  { file: 'assistant.ts', contains: "send('error', { message: (e as Error).message", reason: 'An SSE error event; out of scope and filed in D278.' },
  { file: 'integrations.ts', contains: "'integration_oauth_failed', JSON.stringify({ provider_key: provider, message:", reason: 'An audit-log row, not a response body.' },
];

/**
 * @param {Map<string,string>} files  file name → source
 * @param {typeof LEDGER} ledger
 */
export function scan(files, ledger = LEDGER) {
  const violations = [];
  const used = new Set();
  let helperCalls = 0;
  for (const [file, src] of files) {
    helperCalls += (src.match(HELPER_CALL) || []).length;
    src.split('\n').forEach((line, i) => {
      if (!KEYED_RAW.test(line)) return;
      const hit = ledger.findIndex((l) => l.file === file && line.includes(l.contains));
      if (hit >= 0) { used.add(hit); return; }
      violations.push(`${file}:${i + 1}: ${line.trim().slice(0, 160)}`);
    });
  }
  const stale = ledger.filter((_, i) => !used.has(i)).map((l) => `${l.file}: ${l.contains}`);
  return { violations, stale, helperCalls };
}

export function readRoutes(dir = ROUTES_DIR) {
  const files = new Map();
  if (!fs.existsSync(dir)) return files;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.ts')) files.set(f, fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  return files;
}

export function check(files, { floor = HELPER_FLOOR, ledger = LEDGER } = {}) {
  const r = scan(files, ledger);
  const problems = [];
  for (const v of r.violations) problems.push(`raw text in a refusal body — ${v}`);
  for (const s of r.stale) problems.push(`stale ledger entry — ${s}`);
  if (r.helperCalls < floor) {
    problems.push(`only ${r.helperCalls} calls to refuse/refusalBody/rowFailureSentence (floor ${floor}) — the guard is not looking at the sweep`);
  }
  return { ...r, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = check(readRoutes());
  if (r.problems.length) {
    console.error('✖ check-refusal-bodies:');
    for (const p of r.problems) console.error(`  ${p}`);
    console.error('\nPut the raw text on `raw:` of refuse()/refusalBody() in util/refusal.ts, and our sentence on `message:`.');
    process.exit(1);
  }
  console.log(`✓ check-refusal-bodies: no raw text in a refusal body (${r.helperCalls} helper calls, ${LEDGER.length} ledgered sites).`);
}
