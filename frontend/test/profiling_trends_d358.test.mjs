/** #3734: the placeholder Academy and the two retired admin pages stay absent.
 * D358's aggregate privacy/API behavior remains covered by the Worker tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { api } from '../src/lib/api.js';
import { installDocument } from './_contracts_dom.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const APP = read('../src/App.jsx');
const RETIRED = ['/academy', '/admin/best-fit', '/admin/profiling-trends'];
const pageFiles = ['../src/pages/AcademyLessonPage.jsx', '../src/pages/admin/AdminBestFitPage.jsx', '../src/pages/admin/AdminProfilingTrends.jsx'];
const navFiles = ['../src/lib/siteDoors.js', '../src/lib/adminPlacement.js', '../src/lib/railOptions/admin.js', '../src/lib/railPages.js',
  '../src/sidebarConfig.js', '../src/pages/admin/programs/ProgramsCatalogue.jsx', '../src/pages/admin/programs/programsModel.js',
  '../src/pages/admin/adminStudioOverview.js', '../src/pages/admin/approvals/AdminApprovals.jsx', '../src/pages/branch/BranchApprovals.jsx'];

test('#3734 retired pages have no route, import, page file or navigation entry', () => {
  assert.deepEqual(RETIRED.filter(path => APP.includes(path)), []);
  assert.doesNotMatch(APP, /AcademyLessonPage|AdminBestFitPage|AdminProfilingTrends/);
  assert.deepEqual(pageFiles.filter(path => existsSync(new URL(path, import.meta.url))), []);
  assert.deepEqual(navFiles.flatMap(file => RETIRED.filter(path => read(file).includes(path)).map(path => `${file}: ${path}`)), []);
});

test('#3734 admin report fetch is retired; consultations keep their report builder', () => {
  const worker = read('../../cloudflare-worker/src/index.ts');
  assert.equal(typeof api.adminGetBestFitReport, 'undefined');
  assert.doesNotMatch(worker, /adminBestFit|admin_bestfit|\/api\/admin\/best-fit/);
  assert.equal(existsSync(new URL('../../cloudflare-worker/src/routes/admin_bestfit.ts', import.meta.url)), false);
  assert.match(read('../../cloudflare-worker/src/routes/consultations.ts'), /await buildBestFitReport\(c.env, user.id\)/);
  assert.match(read('../../cloudflare-worker/src/services/bestFit.ts'), /export async function buildBestFitReport\(/);
});

test('#3734 member best-fit, its archetype consumer and project deep links remain', async () => {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => { requests.push(String(url)); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ fit: [] }) }; };
  try { await api.bestFit.me(); } finally { globalThis.fetch = previous; restore(); }
  assert.deepEqual(requests, ['/api/best-fit/me']);
  assert.match(read('../../cloudflare-worker/src/index.ts'), /app.route\('\/api\/best-fit', bestFitSelf\)/);
  assert.match(read('../src/pages/ArchetypeCardPage.jsx'), /wire\(api.bestFit.me\(\), setFit/);
  assert.match(APP, /path="\/projects\/:id"/);
  assert.match(APP, /<ProjectDetail/);
});

test('D358 profile re-ask and aggregate trends API are retained independently of the retired page', () => {
  const source = read('../src/lib/api.js');
  assert.match(source, /profileReask: \(\) => request\('\/profile\/reask'\),/);
  assert.match(source, /adminProfilingTrends: \(months\) =>/);
});
