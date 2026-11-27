/** D6201 (#6201): route unavailability preserves its reason, suppresses figures and chase rows.
 *
 * From frontend/test/README.md (moved by #6472): `portfolio_unavailable_6201.test.mjs` (D6201)
 * keeps explicit route failure reasons on financial figures and reporting, and excludes failed
 * reads from chase rows.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readOf, SHAPES, performanceOf, reportingFor, obligationRowsOf } from '../src/pages/portfolio/portfolioModel.js';

function failed(reason) {
  return { status: 'rejected', reason: Object.assign(new Error(reason), { status: 503, data: { available: false, reason, detail: reason } }) };
}

test('distribution failure renders Unavailable and the route reason for dependent financial figures', () => {
  const reason = 'Portfolio distributions could not be read.';
  const read = readOf(failed(reason), SHAPES.analytics);
  const perf = performanceOf(read, { state: 'ok', value: { items: [] } });
  const figures = [...perf.multiples, ...perf.flows].filter((x) => ['distributed', 'dpi', 'tvpi', 'irr'].includes(x.key));
  assert.equal(figures.length, 4);
  for (const figure of figures) assert.deepEqual([figure.value, figure.state, figure.reason], ['Unavailable', 'unavailable', reason]);
});

for (const reason of ['Required KPIs could not be read.', 'Submitted portfolio updates could not be read.']) {
  test(`${reason} never labels a company not received or makes it chaseable`, () => {
    const compliance = readOf(failed(reason), SHAPES.compliance);
    assert.deepEqual(reportingFor({ project_id: 6 }, compliance), { state: 'Unreadable', reason });
    assert.deepEqual(obligationRowsOf({ compliance }).rows, []);
  });
}
