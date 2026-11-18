/**
 * D6118 (#6118, GR-09) — Partnerships is one page: partners and co-marketing.
 *
 *   · /grow/partnerships renders the partner-network module; /grow/partner-network forwards to it,
 *     query and hash kept; a record, /new and /co-marketing keep their addresses;
 *   · the Mercury proposal sits above the partner table, co-marketing under it;
 *   · co-marketing reads the founder-side route, scoped to the venture, and says Not recorded or
 *     Unreadable rather than inventing a figure (#5129).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/partnerships_gr09_6118.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { matchRoutes, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { readRoutesSource } from './_routesSource.mjs';
import { codeOnly } from './_codeOnly.mjs';
import grow from '../src/pages/cycles/defs/grow.jsx';
import { fnOf } from '../src/pages/cycles/adapters/index.js';
import { ParamRedirect } from '../src/pages/cycles/ParamRedirect.jsx';
import PartnershipsCoMarketing, { CoMarketingSection, coMarketingFor, CO_MARKETING_WORKSPACE, UNREADABLE } from '../src/pages/cycles/PartnershipsCoMarketing.jsx';
import UpdateAskReplies from '../src/pages/cycles/UpdateAskReplies.jsx';
import { growModuleTitle, growArea } from '../src/pages/cycles/growOverviewModel.js';
import { editorModuleLink } from '../src/pages/cycles/founderToolNavigation.js';
import { REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';

const h = React.createElement;
const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const app = codeOnly(readRoutesSource());
const routeLine = (path) => app.split('\n').find((line) => line.includes(`<Route path="${path}"`)) || '';

// Mutation checked: the route back on the old desk (fails); the forward dropped (fails); the forward without `keep` (fails).
test('/grow/partnerships is the partner-network module page, and /grow/partner-network forwards to it', () => {
  assert.match(routeLine('/grow/partnerships'), /guard\(\['admin', 'founder'\], <CycleRoute cycle="grow" slug="partner-network" \/>\)/);
  assert.match(routeLine('/grow/partner-network'), /guard\(\['admin', 'founder'\], <ParamRedirect to="\/grow\/partnerships" \/>\)/);
  assert.doesNotMatch(app, /FounderGrowPartnerships/);
  assert.deepEqual(REDIRECT_ROUTES.find((r) => r.path === '/grow/partner-network'), { path: '/grow/partner-network', keep: true });

  const routes = Array.from(app.matchAll(/<Route\s+path="([^"]+)"/g), ([, path]) => ({ path }));
  const matched = (pathname) => matchRoutes(routes, { pathname })?.at(-1)?.route.path;
  assert.equal(matched('/grow/partnerships'), '/grow/partnerships');
  assert.equal(matched('/grow/partner-network'), '/grow/partner-network');
  // A record, Add partner and the co-marketing workspace keep their addresses.
  assert.equal(matched('/grow/partner-network/gp_1'), '/grow/:slug/:id');
  assert.equal(matched('/grow/partner-network/new'), '/grow/:slug/new');
  assert.equal(matched('/grow/partner-network/co-marketing'), '/grow/partner-network/co-marketing');
});

test('the forward keeps the venture and the hash', async () => {
  const restore = installDocument();
  const seen = [];
  function Landed() { const l = useLocation(); seen.push(l.pathname + l.search + l.hash); return null; }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/grow/partner-network?project_id=7#from-mercury'] },
      h(Routes, null,
        h(Route, { path: '/grow/partner-network', element: h(ParamRedirect, { to: '/grow/partnerships' }) }),
        h(Route, { path: '/grow/partnerships', element: h(Landed) })))));
    assert.equal(seen.at(-1), '/grow/partnerships?project_id=7#from-mercury');
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});

// Mutation checked: the Mercury proposal back under the table (fails); co-marketing dropped from the parts (fails).
test('GR-09: the Mercury proposal sits above the partner table; co-marketing and update-ask replies sit under it', () => {
  const above = fnOf(grow.aboveRecords, 'partner-network');
  assert.equal(typeof above, 'function');
  const proposal = above({ parts: { from_mercury: null } }, { projectId: 7, reload() {} });
  assert.equal(proposal?.props?.slug, 'partner-network', 'the Mercury part, for Partner network');

  const parts = fnOf(grow.parts, 'partner-network')({ parts: { from_update_asks: [] } }, { projectId: 7 });
  const types = React.Children.toArray(parts.props.children).map((c) => c.type);
  assert.deepEqual(types, [UpdateAskReplies, PartnershipsCoMarketing]);
  const coMarketing = React.Children.toArray(parts.props.children).find((c) => c.type === PartnershipsCoMarketing);
  assert.equal(coMarketing.props.projectId, 7);
  // No other half to link to any more (#6109's pair link).
  assert.equal(grow.tools.get('partner-network'), undefined);
});

test('the page is headed Partnerships and lights the Partnerships tab; the workspace returns to it', () => {
  assert.equal(growModuleTitle('partner-network'), 'Partnerships');
  assert.equal(growArea('partner-network').path, '/grow/partnerships');
  assert.deepEqual(editorModuleLink(CO_MARKETING_WORKSPACE, '?project_id=7&tab=x', { role: 'founder' }),
    { href: '/grow/partnerships?project_id=7', label: '← Grow › Partnerships' });
  const worker = readFileSync(new URL('../../cloudflare-worker/src/services/studioModules.ts', import.meta.url), 'utf8');
  assert.match(worker, /'grow\/partner-network': 'Partners by stage and the revenue they bring\.'/);
});

test('co-marketing is scoped to the venture: its attributions, and only the pitches they name', () => {
  const read = {
    attributions: [
      { id: 1, pitch_id: 10, project_id: 7, event_kind: 'lead' },
      { id: 2, pitch_id: 11, project_id: 8, event_kind: 'visit' },
    ],
    pitches: [{ id: 10, title: 'Webinar', status: 'approved' }, { id: 11, title: 'Other venture' }, { id: 12, title: 'Unlinked' }],
  };
  const { pitches, attributions } = coMarketingFor(read, 7);
  assert.deepEqual(attributions.map((a) => a.id), [1]);
  assert.deepEqual(pitches.map((p) => p.title), ['Webinar']);
  assert.deepEqual(coMarketingFor(null, 7), { pitches: [], attributions: [] });
  assert.deepEqual(coMarketingFor(read, null), { pitches: [], attributions: [] });
});

// Mutation checked: "Unreadable" replaced by an empty table (fails); the workspace link without the venture (fails).
test('co-marketing states: loading, unreadable with a retry, none recorded, and the rows with what each delivered', () => {
  const loading = ssr(h(CoMarketingSection, { projectId: 7, state: { status: 'loading', pitches: [], attributions: [] } }));
  assert.match(loading, /data-testid="status-co-marketing-loading"/);
  assert.doesNotMatch(loading, /<table/);

  const failed = ssr(h(CoMarketingSection, { projectId: 7, state: { status: 'failed', pitches: [], attributions: [] }, onRetry() {} }));
  assert.match(failed, new RegExp(`data-testid="status-co-marketing-unreadable"[\\s\\S]*${UNREADABLE}\\.[\\s\\S]*Retry`));
  assert.doesNotMatch(failed, /<table|filter-partnerships-/, 'a failed read draws no rows and no filters');

  const none = ssr(h(CoMarketingSection, { projectId: 7, state: { status: 'ready', pitches: [], attributions: [] } }));
  assert.match(none, /No co-marketing pitch is recorded for this venture\./);
  assert.match(none, /href="\/grow\/partner-network\/co-marketing\?project_id=7"/);

  const pitches = [{ id: 10, title: 'Webinar', status: 'approved', type: 'webinar', created_at: '2026-10-02T00:00:00Z' }, { id: 12, title: 'Podcast', status: 'proposed' }];
  const rows = ssr(h(CoMarketingSection, { projectId: 7, state: { status: 'ready', pitches, attributions: [{ pitch_id: 10, event_kind: 'lead' }, { pitch_id: 10, event_kind: 'lead' }] } }));
  assert.match(rows, /Webinar[\s\S]*2 attribution events · lead/);
  assert.match(rows, /Podcast[\s\S]*Not recorded/, 'no attribution: delivery is Not recorded');
  assert.match(rows, /data-testid="filter-partnerships-signed"/);
  assert.match(rows, /Source: co-marketing pitches and attributions · 2 attribution events/);
});

test('co-marketing reads only the founder-side route', () => {
  const src = codeOnly(readFileSync(new URL('../src/pages/cycles/PartnershipsCoMarketing.jsx', import.meta.url), 'utf8'));
  assert.match(src, /api\.founderCoMarketing\(projectId\)/);
  assert.doesNotMatch(src, /listMyCoMarketing/);
});
