/**
 * #6965 — Product testing's admin detail carries "View presentation", like the other nine.
 *
 * The /admin/programs door for Product testing opens /admin/platform/product-testing/programs,
 * the HQ testing page (`ProductTestingHqPage`), which is not a `ProgramFrame` and so did not get
 * the shortcut the other built-in programs' detail headers have (D6966 PGS07). The final #6965
 * check found it missing; this pins it.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_testing_detail_presentation_6965.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { ProductTestingHqPage } from '../src/pages/admin/ConsolePages.jsx';
import { programFor } from '../src/pages/programs/registry.jsx';

const h = React.createElement;
const SUPER = { id: 1, role: 'admin', is_super_admin: 1, name: 'Super', email: 's@example.com' };
const response = (body) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

async function mounted(url) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.fetch = async () => response({ items: [], rows: [], totals: {} });
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(SUPER));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(ProductTestingHqPage)))));
  await act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const nodes = walk(container);
  const index = (id) => nodes.findIndex((n) => pr(n)['data-testid'] === id);
  return {
    index,
    props: (id) => pr(nodes[index(id)]),
    text: (id) => txt(nodes[index(id)]).replace(/\s+/g, ' ').trim(),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

test('Product testing\'s admin detail leads its header with View presentation → /programs/product-testing', async () => {
  // Mutation checked: dropping <ViewPresentationLink programKey="product-testing" /> from the
  // header's actions fails the first assertion; a wrong key fails the href.
  const program = programFor('product-testing');
  assert.equal(program.canonical, '/programs/product-testing');
  for (const url of ['/admin/platform/product-testing/programs', '/admin/platform/product-testing']) {
    const m = await mounted(url);
    try {
      const at = m.index('programs-view-presentation');
      assert.ok(at >= 0, `${url}: no View presentation in the header`);
      assert.equal(m.props('programs-view-presentation').href, program.canonical);
      assert.match(m.text('programs-view-presentation'), /View presentation/);
      const create = m.index('testing-new-programme');
      assert.ok(create > at, `${url}: View presentation comes first, New program stays`);
    } finally {
      await m.close();
    }
  }
});
