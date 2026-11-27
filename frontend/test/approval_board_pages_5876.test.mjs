/** #5876: each mounted board keeps its count and active-page requests independent.
 *
 * From frontend/test/README.md (moved by #6472): Mounted regressions for lane counts and
 * active-page reads (#5876).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import TesterBoard from '../src/pages/admin/approvals/TesterBoard.jsx';
import ExpertBoard from '../src/pages/admin/approvals/ExpertBoard.jsx';
import PitchBoard from '../src/pages/admin/approvals/PitchBoard.jsx';

const cases = [
  { Board: TesterBoard, id: 'testers', tab: 'waiting', count: 'Pending', control: 'page', next: '2',
    path: '/api/admin/product-testers', page: { matching: 73, rows: [{ id: 1, status: 'applied', member: { name: 'Visible member' } }] },
    summary: { counts: { applied: 73 }, recent_by_role: [], in_programme: 0 } },
  { Board: ExpertBoard, id: 'experts', tab: 'verify', count: 'Needs verification', control: 'offset', next: '25',
    path: '/api/wellbeing/admin/experts', page: { total: 73, items: [{ uid: 'sample', name: 'Visible expert', profile_completion_pct: 75 }] },
    summary: { counts: { verify: 73 } } },
  { Board: PitchBoard, id: 'pitches', tab: 'proposed', count: 'Proposed', control: 'offset', next: '25',
    path: '/api/comarketing/admin/queue', page: { total: 73, items: [{ uid: 'sample', title: 'Visible pitch', status: 'proposed' }] },
    summary: { counts: { proposed: 73 }, attribution_30d: { visit: 0, signup: 0 } } },
];

for (const fixture of cases) {
  test(`${fixture.id}: counts span the lane, a failed summary leaves the page, and Next reads only the page`, async () => {
    const original = globalThis.fetch;
    const calls = [];
    let fail = false;
    globalThis.fetch = async (value) => {
      const url = new URL(String(value), 'https://example.invalid');
      if (url.pathname === fixture.path + '/summary') {
        calls.push(url);
        return fail ? Response.json({ code: 'summary_unreadable' }, { status: 503 }) : Response.json(fixture.summary);
      }
      if (url.pathname === fixture.path) {
        calls.push(url);
        return Response.json(fixture.page);
      }
      return Response.json({ items: [], total: 0, reviewers: [], assignments: { available: true } });
    };
    let mounted;
    try {
      mounted = await mountContracts(h(fixture.Board, { at: { tab: fixture.tab } }));
      await mounted.flush();
      assert.equal(calls.filter(({ pathname }) => pathname === fixture.path + '/summary').length, 1);
      assert.equal(calls.filter(({ pathname }) => pathname === fixture.path).length, 1);
      assert.match(mounted.text(), new RegExp(`${fixture.count}\\s*73`));
      await mounted.click('Next');
      await mounted.flush();
      assert.equal(calls.length, 3);
      assert.equal(calls.at(-1).searchParams.get(fixture.control), fixture.next);
      await mounted.unmount();
      mounted = null;
      fail = true;
      mounted = await mountContracts(h(fixture.Board, { at: { tab: fixture.tab } }));
      await mounted.flush();
      assert.match(mounted.text(), /Visible (member|expert|pitch)/);
      assert.match(mounted.text(), new RegExp(`${fixture.count}\\s*—`));
    } finally {
      await mounted?.unmount();
      globalThis.fetch = original;
    }
  });
}
