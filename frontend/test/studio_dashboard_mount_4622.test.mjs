// #4622 (Studio audit 4/5): what the Studio page waits for before it mounts a home.
// The real Dashboard is mounted; only the network is stubbed, with the dashboard read held open.
//   · a founder on their own Studio mounts the founder home at once and never asks for the broad dashboard read;
//   · every other viewer still reads it, and draws "Loading your studio…", not a home, until it answers;
//   · an admin previewing the founder Studio (the session user is not a founder) still reads it;
//   · the homes are lazy: Dashboard's static imports do not reach any of the five.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { h, mountForm, textOf } from './_form_d695.mjs';
import Dashboard from '../src/pages/Dashboard.jsx';

const reply = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const deferred = () => { let resolve; const promise = new Promise((a) => { resolve = a; }); return { promise, resolve }; };

// A home's chunk may not load in this harness (its chat reaches Worker JSON modules); that rejection is
// swallowed here, because what is asserted is what mounts first and what is requested.
class Quiet extends React.Component {
  constructor(p) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {}
  render() { return this.state.failed ? React.createElement('div', { 'data-testid': 'home-chunk-failed' }) : this.props.children; }
}

async function mountDashboard({ activeRole, authUser }) {
  const before = globalThis.fetch;
  const log = [];
  const dashboard = deferred();
  globalThis.fetch = async (url) => {
    const path = String(url).replace(/^.*\/api/, '').split('?')[0];
    log.push(path);
    if (path === '/dashboard') return dashboard.promise;
    return reply({}, 404);
  };
  const quiet = { error: console.error, warn: console.warn };
  console.error = () => {}; console.warn = () => {};
  const m = await mountForm(h(Quiet, null, h(Dashboard, { activeRole, authUser })));
  const settle = async () => { await m.flush(); await m.flush(); };
  await settle();
  return { m, log, dashboard, settle, async close() { await m.unmount(); globalThis.fetch = before; console.error = quiet.error; console.warn = quiet.warn; } };
}

test('a founder on their own Studio mounts the founder home at once and never asks for the dashboard', async () => {
  const t = await mountDashboard({ activeRole: 'founder', authUser: { id: 4, role: 'founder', name: 'Synthetic Founder' } });
  try {
    assert.equal(t.log.includes('/dashboard'), false, 'the founder path uses the session user, so the broad read is not made');
    assert.doesNotMatch(textOf(t.m.root ?? document.body), /Loading your studio/);
    assert.ok(t.m.by('studio-home-loading') || t.m.by('home-chunk-failed') || t.m.by('founder-studio-home'), 'the founder home (or its skeleton) is mounted without the dashboard');
  } finally { await t.close(); }
});

test('everyone else still reads the dashboard and waits for it before a home draws', async () => {
  for (const viewer of [
    { activeRole: 'investor', authUser: { id: 5, role: 'investor' } },
    { activeRole: 'advisor', authUser: { id: 6, role: 'advisor' } },
    { activeRole: 'founder', authUser: { id: 1, role: 'admin' } }, // an admin previewing the founder Studio
  ]) {
    const t = await mountDashboard(viewer);
    try {
      assert.ok(t.log.includes('/dashboard'), `${viewer.authUser.role} as ${viewer.activeRole} reads the dashboard`);
      assert.match(textOf(document.body), /Loading your studio/, 'a home does not draw before it answers');
      assert.equal(t.m.by('studio-home-loading'), undefined, 'no home is mounted yet');
    } finally { await t.close(); }
  }
});

test('the five homes are lazy: Dashboard\'s own imports reach none of them', () => {
  const dash = readFileSync(new URL('../src/pages/Dashboard.jsx', import.meta.url), 'utf8');
  for (const home of ['founder/FounderStudioHome', 'investor/InvestorStudioHome', 'advisor/AdvisorStudioHome', 'partner/PartnerStudioHome', 'admin/AdminStudioHome']) {
    assert.doesNotMatch(dash, new RegExp(`from '\\./${home.replace('/', '\\/')}'`), `${home} is not a static import`);
  }
  assert.match(dash, /from '\.\/StudioHomesLazy'/);
  const lazy = readFileSync(new URL('../src/pages/StudioHomesLazy.jsx', import.meta.url), 'utf8');
  assert.equal((lazy.match(/lazy\(\(\) => import\(/g) || []).length, 5, 'each home is its own dynamic import');
});
