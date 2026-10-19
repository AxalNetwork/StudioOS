/**
 * D752 (#1990) — the member privacy guard: a member's own Mercury data reaches
 * only the member it belongs to, and the admin read of a shared statement.
 *
 *  - No Eadwyn reader, MCP tool, cron path or admin route reaches the three
 *    modules that hold member bank data (`services/mercuryPersonal.ts`, the
 *    connection and every member bank read; `services/capitalAttestations.ts`,
 *    the proof-of-funds check; `services/mercurySpend.ts`, the spending maths),
 *    through any chain of imports, static or dynamic.
 *  - The admin attestation route reads `capital_attestations` and `users`
 *    only, and never names `integrations` or `mercury_personal_matches`.
 *  - The deals code reaches none of the three and names no D752 table.
 *  - `capital_attestations` (migration 491) has no balance-like column.
 *  - A revoked statement's admin DTO carries no amount, holder or account count.
 *  - No admin page draws `available_cents` or `cash_cents`.
 *  - D710's money guard covers D752's new files: none names Mercury's host, a
 *    money act or a denied path, calls fetch, or imports the client directly.
 *
 * Every file and route name here is taken from #1887 (PR #1942), #1888
 * (PR #1970), #1889 (PR #1973) and #1890 (PR #1975).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_member_privacy_d752.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { codeOnly } from './_codeOnly.mjs';
import { CONNECTOR_READERS } from '../src/services/eadwynReaders.ts';
import { adminDto } from '../src/services/capitalAttestationTerms.ts';

const ROOT = process.cwd();
/** D710's denied Mercury paths, read from its guard's source so this file does not re-run its tests. */
const DENIED_PATHS = (() => {
  const src = readFileSync(resolve(ROOT, 'cloudflare-worker/test/mercury_read_only_d710.test.mjs'), 'utf8');
  const m = /export const DENIED_PATHS = \[([^\]]+)\]/.exec(src);
  assert.ok(m, 'D710 lists its denied paths');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
})();
const SRC = resolve(ROOT, 'cloudflare-worker/src');
const rel = (p) => relative(SRC, p);
const at = (p) => join(SRC, p);

/** The modules that hold a member's own bank data. */
export const MEMBER_MODULES = Object.freeze(['services/mercuryPersonal.ts', 'services/capitalAttestations.ts', 'services/mercurySpend.ts']);
/** D752's new Worker files (#1887 adds none of its own: it extends D713's). */
export const D752_FILES = Object.freeze([
  'services/capitalAttestationTerms.ts', 'services/capitalAttestations.ts', 'services/mercurySpend.ts',
  'routes/mercury_attestations.ts', 'routes/admin_capital_attestations.ts',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|js|mjs)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}
const FILES = walk(SRC);

/** A relative import's file, or null for a package or a path that does not resolve. */
function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.js`, join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
/** Every file's static, re-exported, side-effect and dynamic relative imports. */
export function importGraph(files = FILES, readText = (f) => readFileSync(f, 'utf8')) {
  const graph = new Map();
  for (const f of files) {
    const deps = new Set();
    for (const m of readText(f).matchAll(IMPORT_RE)) {
      const r = resolveImport(f, m[1] || m[2] || m[3]);
      if (r) deps.add(r);
    }
    graph.set(f, deps);
  }
  return graph;
}
export function reach(graph, starts) {
  const seen = new Set();
  const stack = [...starts];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const d of graph.get(f) || []) stack.push(d);
  }
  return seen;
}
const GRAPH = importGraph();
const memberIn = (set) => MEMBER_MODULES.filter((m) => set.has(at(m)));

/**
 * The cron's entry modules: every module `index.ts` imports under a name its
 * `scheduled` handler mentions, every module that handler imports dynamically,
 * and the queue consumer the cron drains. A name that merely appears in the
 * handler counts, so the set errs wide, never narrow.
 */
export function cronEntries(indexText = readFileSync(at('index.ts'), 'utf8')) {
  const start = indexText.indexOf('async scheduled(');
  assert.ok(start > 0, 'index.ts has a scheduled handler');
  let i = indexText.indexOf('{', start), depth = 0, end = i;
  for (; end < indexText.length; end += 1) {
    if (indexText[end] === '{') depth += 1;
    else if (indexText[end] === '}' && --depth === 0) break;
  }
  const body = indexText.slice(i, end);
  const entries = new Set([at('queue-consumer.ts')]);
  for (const m of indexText.matchAll(/import\s+(?:type\s+)?([^;]*?)\s+from\s*['"]([^'"]+)['"]/g)) {
    const file = resolveImport(at('index.ts'), m[2]);
    if (!file) continue;
    const names = m[1].replace(/[{}]/g, ',').split(',').map((s) => s.trim().replace(/^\*\s+as\s+/, '').split(/\s+as\s+/).pop().trim()).filter((n) => /^[\w$]+$/.test(n));
    if (names.some((n) => new RegExp(`(^|[^\\w$])${n.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(body))) entries.add(file);
  }
  for (const m of body.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const file = resolveImport(at('index.ts'), m[1]);
    if (file) entries.add(file);
  }
  return entries;
}

// ─────────────────────────────────────────────────────────── who can reach member bank data

test('the graph sees the real paths: the routes that serve the member reach their modules', () => {
  for (const m of [...MEMBER_MODULES, ...D752_FILES]) assert.ok(existsSync(at(m)), `${m} exists`);
  assert.deepEqual(memberIn(reach(GRAPH, [at('routes/revenue.ts')])), ['services/mercuryPersonal.ts', 'services/mercurySpend.ts']);
  assert.deepEqual(memberIn(reach(GRAPH, [at('routes/mercury_attestations.ts')])), ['services/mercuryPersonal.ts', 'services/capitalAttestations.ts']);
  assert.deepEqual(memberIn(reach(GRAPH, [at('routes/mercury_personal.ts')])), ['services/mercuryPersonal.ts']);
});

test('no Eadwyn reader reaches member bank data, and none is Mercury', () => {
  assert.deepEqual(Object.keys(CONNECTOR_READERS).filter((k) => /mercury/i.test(k)), []);
  const eadwyn = FILES.filter((f) => /eadwyn|assistant|advisor/i.test(rel(f)) && !rel(f).startsWith('mcp/'));
  assert.ok(eadwyn.some((f) => rel(f) === 'services/eadwynReaders.ts') && eadwyn.length > 10, 'the Eadwyn files were found');
  for (const f of eadwyn) assert.deepEqual(memberIn(reach(GRAPH, [f])), [], rel(f));
});

test('no MCP tool reaches member bank data', () => {
  const mcp = FILES.filter((f) => rel(f).startsWith('mcp/'));
  assert.ok(mcp.some((f) => rel(f).startsWith('mcp/tools/')), 'the MCP tools were found');
  for (const f of mcp) assert.deepEqual(memberIn(reach(GRAPH, [f])), [], rel(f));
});

test('no cron path reaches member bank data', () => {
  const entries = cronEntries();
  assert.ok(entries.size > 10, 'the scheduled handler\'s modules were found');
  assert.deepEqual(memberIn(reach(GRAPH, entries)), []);
});

test('no admin route reaches member bank data', () => {
  const admin = FILES.filter((f) => /^routes\/admin[^/]*\.ts$/.test(rel(f)));
  assert.ok(admin.some((f) => rel(f) === 'routes/admin_capital_attestations.ts') && admin.some((f) => rel(f) === 'routes/admin_mercury.ts'));
  for (const f of admin) assert.deepEqual(memberIn(reach(GRAPH, [f])), [], rel(f));
});

test('the admin attestation route reads capital_attestations and users only, never a connection or a match', () => {
  const code = codeOnly(readFileSync(at('routes/admin_capital_attestations.ts'), 'utf8'));
  // `json_each` is SQLite's function over a bound JSON list of ids, not a table.
  const tables = [...new Set([...code.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]+)/g)].map((m) => m[1]))].filter((t) => t !== 'json_each').sort();
  assert.deepEqual(tables, ['capital_attestations', 'users']);
  assert.doesNotMatch(code, /\bintegrations\b|mercury_personal_matches/);
});

test('the deals code reaches no member module and names no D752 table', () => {
  assert.deepEqual(memberIn(reach(GRAPH, [at('routes/deals.ts')])), []);
  const code = codeOnly(readFileSync(at('routes/deals.ts'), 'utf8'));
  assert.doesNotMatch(code, /capital_attestations|mercury_personal_matches/);
});

// ─────────────────────────────────────────────────────────── what is stored and shown

/** The columns of a table created by a migration's SQL. */
export function columnsOf(sql, table) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY);');
  db.exec(sql);
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}
const BALANCE_LIKE = /balance|available|current|last_four|account_id|account_number|routing|counterparty|transaction/;

test('capital_attestations has no balance-like column', () => {
  const cols = columnsOf(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/491_mercury_capital_attestations.sql'), 'utf8'), 'capital_attestations');
  assert.ok(cols.includes('amount_floor_cents') && cols.includes('holder_name'), 'the table was read');
  assert.deepEqual(cols.filter((c) => BALANCE_LIKE.test(c)), []);
});

test('a revoked statement\'s admin DTO carries its date and no amount, holder or account count', () => {
  const row = {
    id: 1, uid: 'pf-1', user_id: 30, purpose: 'lp_application', target_id: 201, deal_id: null, fund_id: 7,
    amount_floor_cents: 10000000, as_of: '2026-10-01', expires_on: '2026-10-31', holder_name: 'Own Practice LLC', accounts_counted: 2,
    consented_at: '2026-10-01 10:00:00', state: 'revoked', revoked_at: '2026-10-05 09:00:00', investor_name: 'Investor',
  };
  const dto = adminDto(row, '2026-10-19', [{ uid: 'pf-2', purpose: 'deal_commitment', deal_id: 3, amount_floor_cents: 500000, as_of: '2026-10-02', expires_on: '2026-11-01' }]);
  for (const k of ['amount_floor_cents', 'holder_name', 'accounts_counted', 'as_of', 'expires_on', 'other_active', 'other_active_count', 'shared_on']) assert.ok(!(k in dto), k);
  assert.equal(dto.revoked_on, '2026-10-05');
  assert.doesNotMatch(JSON.stringify(dto), /\$|100000|Own Practice/);
  assert.ok('amount_floor_cents' in adminDto({ ...row, state: 'active', revoked_at: null }, '2026-10-19'), 'an active one does carry it');
});

/**
 * The one admin page that draws an available balance, and why: D714's fund
 * administration console shows Axal's own entity accounts, read by
 * `/api/admin/mercury`, never a member's.
 */
const ENTITY_BALANCE_PAGES = Object.freeze(['fundAdmin/OverviewTab.jsx']);

test('no admin page draws available_cents or cash_cents, save the entity accounts\' own page', () => {
  const dir = resolve(ROOT, 'frontend/src/pages/admin');
  const pages = readdirSync(dir, { recursive: true }).filter((n) => /\.(jsx?|mjs)$/.test(n)).map((n) => join(dir, n));
  assert.ok(pages.length > 20, 'the admin pages were found');
  const drawing = pages.filter((p) => /available_cents|cash_cents/.test(readFileSync(p, 'utf8'))).map((p) => relative(dir, p)).sort();
  assert.deepEqual(drawing, [...ENTITY_BALANCE_PAGES]);
  for (const p of ENTITY_BALANCE_PAGES) assert.doesNotMatch(readFileSync(join(dir, p), 'utf8'), /mercury\/personal|capital-attestations|mercury-spend|mercuryPersonal|cash_cents/, p);
});

// ─────────────────────────────────────────────────────────── D710's money guard covers the new files

test('D752\'s new files name no Mercury host, money act or denied path, call no fetch, and never import the client', () => {
  for (const f of D752_FILES) {
    const text = readFileSync(at(f), 'utf8');
    const code = codeOnly(text);
    assert.doesNotMatch(text, /api\.mercury\./, f);
    assert.doesNotMatch(text, /send-money|sendMoney|transfer-money|requestSendMoney|requestTransferMoney/, f);
    for (const p of DENIED_PATHS) assert.ok(!code.includes(`'${p}`) && !code.includes(`\`${p}`) && !code.includes(`"${p}`), `${f}: ${p}`);
    assert.doesNotMatch(code, /\bfetch\s*\(/, f);
    assert.ok(![...GRAPH.get(at(f))].includes(at('services/mercury/client.ts')), `${f} imports the client`);
  }
  for (const f of ['routes/mercury_attestations.ts', 'routes/admin_capital_attestations.ts']) {
    const paths = [...readFileSync(at(f), 'utf8').matchAll(/\.(get|post|put|patch|delete)\('([^']+)'/g)].map((m) => m[2]);
    assert.ok(paths.length >= 1, `${f}: the routes were found`);
    for (const p of paths) assert.doesNotMatch(p, /send|transfer|pay|payout|wire/i, `${f}: ${p}`);
  }
});
