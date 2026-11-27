/** D7811: file-keyed debt ledger; shared helpers own new CSV escaping, private copies stay untouched.
 *
 * From frontend/test/README.md (moved by #6472): D7811: file-keyed pending CSV copies and
 * detection of new private escapers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { transformWithOxc } from 'vite';
import { Parser } from 'acorn';
import jsx from 'acorn-jsx';
const parser = Parser.extend(jsx());
export const PENDING = new Set([
  "cloudflare-worker/src/routes/admin.ts",
  "cloudflare-worker/src/routes/admin_accounts.ts",
  "cloudflare-worker/src/routes/events.ts",
  "cloudflare-worker/src/routes/financials.ts",
  "cloudflare-worker/src/routes/fund_reporting.ts",
  "cloudflare-worker/src/routes/research_market_data.ts",
  "cloudflare-worker/src/services/agents/adminAudit.ts",
  "cloudflare-worker/src/services/aiCost.ts",
  "cloudflare-worker/src/services/analyticsReports.ts",
  "cloudflare-worker/src/services/capTableRegister.ts",
  "cloudflare-worker/src/services/captable.ts",
  "cloudflare-worker/src/services/fundAdminLpsCsv.ts",
  "cloudflare-worker/src/services/insightsExport.ts",
  "cloudflare-worker/src/services/kycGovernance.ts",
  "cloudflare-worker/src/services/programExport.ts",
  "cloudflare-worker/src/services/publications.ts",
  "frontend/src/pages/SpinoutLabCapitalPage.jsx",
  "frontend/src/pages/admin/advisors/peopleModel.js",
  "frontend/src/pages/admin/events/allEventsModel.js",
  "frontend/src/pages/admin/fundAdmin/fundAdminModel.js",
  "frontend/src/pages/admin/grants/grantsModel.js",
  "frontend/src/pages/admin/partners/invitationsModel.js",
  "frontend/src/pages/advisor/practice/EarningsZone.jsx",
  "frontend/src/pages/closing/deskModel.js",
  "frontend/src/pages/deal/dealInsightsModel.js",
  "frontend/src/pages/founder/FounderTeamPage.jsx",
  "frontend/src/pages/hq/aiAgents/registryModel.js",
  "frontend/src/pages/investor/dealflow/compareModel.js",
  "frontend/src/pages/investor/portfolioReportsModel.js",
  "frontend/src/pages/raise/caprel/capRelTabsModel.js"
]);
PENDING.add('frontend/src/pages/research/listedCompaniesRead.js');
PENDING.add('frontend/src/pages/research/marketDirectoryExport.js');
const SHARED = new Set(['frontend/src/lib/csvExport.js', 'cloudflare-worker/src/services/csv.ts']);

export async function doublesCsvQuotes(source, path) {
  const code = /\.(?:[cm]?ts|tsx)$/.test(path) ? (await transformWithOxc(source, path, { jsx: { runtime: 'automatic' } })).code : source;
  const ast = parser.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  let found = false;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
      const method = node.callee.computed ? node.callee.property.value : node.callee.property.name;
      const [first, second] = node.arguments;
      if (second?.value === '""' && ((method === 'replace' && first?.regex?.pattern === '"')
        || (method === 'replaceAll' && first?.value === '"'))) found = true;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  return found;
}
export async function newCopies(entries) {
  const result = [];
  for (const [path, source] of entries) if (!SHARED.has(path) && !PENDING.has(path) && await doublesCsvQuotes(source, path)) result.push(path);
  return result;
}
function sources(dir, output = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, output);
    else if (!/\.d\.[cm]?ts$/.test(path) && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)) output.push([relative(process.cwd(), path).replaceAll('\\', '/'), readFileSync(path, 'utf8')]);
  }
  return output;
}
test('no new private CSV escaper outside the shared helpers; pending debt is keyed by file', async () => {
  assert.deepEqual(await newCopies([...sources('frontend/src'), ...sources('cloudflare-worker/src')]), []);
});
test('a new private copy fails, an owner edit in an existing pending file does not, and prose does not count', async () => {
  const code = `export const cell = s => s.replace(/"/g, '""');`;
  const file = 'frontend/src/newExport.js';
  assert.deepEqual(await newCopies([[file, code]]), [file]);
  assert.deepEqual(await newCopies([['frontend/src/pages/research/listedCompaniesRead.js', code]]), []);
  assert.deepEqual(await newCopies([['frontend/src/pages/research/marketDirectoryExport.js', code]]), []);
  assert.deepEqual(await newCopies([['frontend/src/newProse.js', '// '+code]]), []);
  assert.deepEqual(await newCopies([[file, `export const cell = s => s.replaceAll('"', '""');`]]), [file]);
});

test('file discovery catches private copies in ESM, CommonJS and TypeScript module extensions', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'csv-private-7811-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const ext of ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts']) {
    writeFileSync(join(dir, `private.${ext}`), `const cell = s => s.replace(/"/g, '""');`);
  }
  writeFileSync(join(dir, 'README.md'), 'Escaping is described here, not implemented.');
  const found = await newCopies(sources(dir));
  assert.deepEqual(found.map(path => path.split('.').at(-1)).sort(), ['cjs', 'cts', 'js', 'jsx', 'mjs', 'mts', 'ts', 'tsx']);
});
