// D5721: public Help retains every member rail key without widening other routes' inferred audiences.
import test from 'node:test';
import assert from 'node:assert/strict';
import {railRoutes} from './_railRoutes.mjs';
import {pageKeyFor} from '../src/lib/railPages.js';

const members = ['founder', 'investor', 'advisor', 'partner', 'admin', 'exploring'];
test('public Help is censused for all member profiles and retains their page keys', () => {
  const routes = railRoutes();
  for (const [path, concrete] of [['/help', '/help'], ['/help/:area/:guide', '/help/getting-started/welcome']]) {
    const route = routes.find(r => r.path === path);
    assert.ok(route?.rail, path);
    assert.deepEqual(route.roles, members, path);
    for (const shell of ['founder', 'investor', 'advisor', 'partner', 'admin', 'super_admin']) {
      assert.ok(pageKeyFor(concrete, shell), `${path}: ${shell} retains its Help key`);
    }
  }
});

test('public Help inference excludes admin and redirect paths and preserves ticket guards', () => {
  const routes = railRoutes();
  for (const path of ['/help/admin/*', '/help/:id', '/remote']) {
    assert.deepEqual(routes.find(r => r.path === path)?.roles, [], path);
  }
  for (const path of ['/help/tickets', '/help/tickets/:id']) {
    assert.deepEqual(routes.find(r => r.path === path)?.roles, ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], path);
  }
});
