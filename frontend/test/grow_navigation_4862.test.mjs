import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { matchRoutes, MemoryRouter } from 'react-router-dom';
import FounderGrowFocus from '../src/pages/founder/FounderGrowFocus.jsx';
import FounderGrowCustomers from '../src/pages/founder/FounderGrowCustomers.jsx';
import FounderGrowTalent from '../src/pages/founder/FounderGrowTalent.jsx';
import FounderGrowPartnerships from '../src/pages/founder/FounderGrowPartnerships.jsx';
import FounderGrowLaunch from '../src/pages/founder/FounderGrowLaunch.jsx';
import { CycleHeader } from '../src/pages/cycles/CycleOverview.jsx';
import { MODULES } from '../src/pages/cycles/modules.js';
import { readRoutesSource } from './_routesSource.mjs';
import { codeOnly } from './_codeOnly.mjs';

const pages = {
  focus: FounderGrowFocus,
  customers: FounderGrowCustomers,
  talent: FounderGrowTalent,
  partnerships: FounderGrowPartnerships,
  launch: FounderGrowLaunch,
};

for (const [slug, Page] of Object.entries(pages)) {
  test(slug + ' links back to Grow with the venture from the deep link, before any data loads', () => {
    for (const [query, expected] of [
      ['?project_id=41&tab=old', '/grow?project_id=41'],
      ['?project=19', '/grow?project_id=19'],
      ['?project_id=bad', '/grow'],
      ['', '/grow'],
    ]) {
      const html = renderToStaticMarkup(React.createElement(MemoryRouter, {
        initialEntries: ['/grow/' + slug + query],
      }, React.createElement(Page)));
      const crumb = html.match(/class="fg-[a-z]+-crumb"><a[^>]* href="([^"]+)"/);
      assert.equal(crumb?.[1], expected);
    }
  });
}

test('GR-04 entry points and existing module, Distribution and Reporting deep links reach their specific routes', () => {
  const source = codeOnly(readRoutesSource());
  const routes = Array.from(source.matchAll(/<Route\s+path="([^"]+)"/g), ([, path]) => ({ path }));
  function check(pathname, pattern = pathname) {
    const match = matchRoutes(routes, { pathname, search: '?project_id=41' })?.at(-1);
    assert.equal(match?.route.path, pattern, pathname);
  }

  for (const path of ['/grow', '/grow/update', '/grow/reporting', '/grow/reporting/duties', '/build/brand']) check(path);
  for (const slug of Object.keys(pages)) check('/grow/' + slug);
  check('/grow/reporting/report-123', '/grow/reporting/:id');
  check('/grow/reporting/report-123/edit', '/grow/reporting/:id/edit');

  const modules = new Set(MODULES.grow.map(({ slug }) => slug));
  const legacy = ['product-improvement', 'revenue-and-traction', 'distribution', 'team-expansion',
    'partner-network', 'market-expansion', 'durable-company-building'];
  for (const slug of legacy) assert.ok(modules.has(slug), slug + ' must remain a recognized Grow module');
  for (const slug of modules) {
    check('/grow/' + slug, '/grow/:slug');
    check('/grow/' + slug + '/new', '/grow/:slug/new');
    check('/grow/' + slug + '/record-123', '/grow/:slug/:id');
  }
  for (const tab of ['channels', 'campaigns', 'calendar', 'ads', 'newsletter', 'prospects', 'inbox', 'results']) {
    check('/grow/distribution/' + tab);
  }
  check('/grow/distribution/campaigns/new');
  check('/grow/distribution/campaigns/campaign-123', '/grow/distribution/campaigns/:uid');
});

test('Focus and Customers subsections link both ways and preserve only the project query', () => {
  for (const [root, slug, title] of [
    ['focus', 'revenue-and-traction', 'KPIs and revenue'],
    ['customers', 'product-improvement', 'Feedback'],
  ]) {
    for (const [query, canonical] of [['?project_id=41&tab=old', '?project_id=41'], ['?project=19', '?project_id=19'], ['', '']]) {
      for (const active of [root, slug]) {
        const page = active === root
          ? React.createElement(pages[root])
          : React.createElement(CycleHeader, { cycle: 'grow', cards: [], active, title: 'Legacy name', search: query });
        const html = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/grow/' + active + query] }, page));
        const strip = html.match(/<nav[^>]+data-testid="grow-subsections"[^>]*>(.*?)<\/nav>/)?.[1];
        for (const key of [root, slug]) {
          const link = strip?.match(new RegExp('<a[^>]+href="/grow/' + key + '[^"]*"[^>]*>'))?.[0];
          assert.ok(link?.includes('href="/grow/' + key + canonical + '"'));
          assert.equal(link.includes('aria-current="page"'), key === active);
        }
        if (active === slug) assert.match(html, new RegExp('<h1[^>]*>' + title + '<'));
      }
    }
  }
});
