import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import LegacyContractsRedirect, { legacyContractsTarget, CONTRACTS_MOVED_NOTICE } from '../src/pages/admin/LegacyContractsRedirect.jsx';

test('D647: old legal deep links move, keeping the rest of the query (D938)', () => {
  assert.equal(legacyContractsTarget('?tab=legal&unused=1'), '/admin/contracts?unused=1&moved=legal');
  // D938: the console is retired, so every other address forwards too.
  for (const query of ['', '?tab=users', '?tab=illegal']) assert.equal(legacyContractsTarget(query), '/admin/accounts/all?moved=users', query);
  assert.equal(legacyContractsTarget('?search=legal'), '/admin/accounts/all?search=legal&moved=users');
  assert.match(CONTRACTS_MOVED_NOTICE, /Legal now lives under Contracts/);
});

test('D647, D938: /admin mounts nothing, so no old console reads anything', () => {
  let mounted = 0;
  function Console() { mounted++; return React.createElement('p', null, 'Console users'); }
  const render = (url) => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [url] },
    React.createElement(LegacyContractsRedirect, null, React.createElement(Console))));
  for (const url of ['/admin?tab=legal', '/admin?tab=users', '/admin']) assert.doesNotMatch(render(url), /Console users/, url);
  assert.equal(mounted, 0);
});

import ContractsPage from '../src/pages/hq/ContractsPage.jsx';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';

test('D647: both shells render Contracts, but only canonical Super Admins see registry controls', () => {
  const previous = globalThis.localStorage;
  try {
    for (const elevated of [false, true]) {
      globalThis.localStorage = { getItem: (key) => key === 'user' ? JSON.stringify({ id: 2, role: 'admin', is_super_admin: elevated ? 1 : 0 }) : null };
      const markup = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/admin/contracts?moved=legal'] },
        React.createElement(AuthProvider, null, React.createElement(ContractsPage))));
      assert.match(markup, /Contracts tabs/);
      assert.match(markup, /Legal now lives under Contracts/);
      assert.equal(markup.includes('Document types'), elevated);
      assert.equal(markup.includes('registry-new-doc-type'), false);
      assert.equal(markup.includes('Loading the registry'), false);
      assert.match(markup, elevated ? /HQ.*Contracts/ : /Admin.*Contracts/);
    }
  } finally { globalThis.localStorage = previous; }
});
