// #9035: three stdlib-only Python test files that no suite or workflow ran. This runs them in the ordinary
// frontend suite, as stripe_test_mode_d8511.test.mjs runs its backend cases. No network, no pip packages.
//   scripts/test_fund_lp_flags.py          D539: the EIF/EIFO LP rule the fund importers share
//   scripts/test_import_research_funds.py  D535/D8605: the research-fund importer (D8605 said "not run by CI")
//   backend/test_deals_scope.py            the investor deal scope, in the dev FastAPI and in the Worker route
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const python = (args) => spawnSync('python3', ['-B', ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });

for (const [file, atLeast] of [['scripts/test_fund_lp_flags.py', 4], ['scripts/test_import_research_funds.py', 46]]) {
  test(`${file} passes under unittest`, () => {
    const r = python(['-m', 'unittest', file]);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const ran = Number((r.stderr.match(/^Ran (\d+) tests?/m) || [])[1]);
    assert.ok(ran >= atLeast, `expected at least ${atLeast} tests from ${file}, saw ${ran}\n${r.stderr}`);
  });
}

test('backend/test_deals_scope.py passes (its plain test_ functions, run without pytest)', () => {
  const r = python(['-c', [
    'import runpy',
    "ns = runpy.run_path('backend/test_deals_scope.py')",
    "names = sorted(k for k, v in ns.items() if k.startswith('test_') and callable(v))",
    'for k in names: ns[k]()',
    "print('ran', len(names))",
  ].join('\n')]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /^ran ([2-9]|\d{2,})$/m, `expected both deal-scope checks to run\n${r.stdout}`);
});
