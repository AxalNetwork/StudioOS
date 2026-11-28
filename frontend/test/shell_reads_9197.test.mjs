// D9197 — signed-in shell request budget, bounded 429 replay and switcher recovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useLayoutEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '../src/hooks/useAuthSync.jsx';
import { SettingsProvider } from '../src/contexts/SettingsContext.jsx';
import PaywallModal from '../src/components/PaywallModal.jsx';
import CompanySwitcher from '../src/ui/CompanySwitcher.jsx';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import { request } from '../src/lib/api.js';
import { installDocument, mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const user = { id: 9197, role: 'founder', name: 'Synthetic Member' };
const json = (body, init) => new Response(JSON.stringify(body), init);
const limited = (retryAfter = '0') => json({ error: 'rate_limited', message: 'Wait before retrying.' }, {
  status: 429, headers: { 'Retry-After': retryAfter },
});

function Prepared({ prepare, children }) {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    prepare();
    setReady(true);
  }, [prepare]);
  return ready ? children : null;
}

function LateIdentityRead({ reader }) {
  reader.current = useAuth().readCurrentUser;
  return null;
}

test('signed-in shell providers read identity and bundled preferences once and leave the closed paywall idle', async (t) => {
  const calls = [];
  const reader = { current: null };
  t.mock.method(globalThis, 'fetch', async (path) => {
    calls.push(path);
    if (path === '/api/auth/me') return json({ ...user, shell: { settings: { theme: 'light', dismissed: ['sample'] } } });
    return json({ plans: [] });
  });
  const prepare = () => {
    document.documentElement.dataset = {};
    document.documentElement.classList = { toggle() {}, remove() {} };
  };
  const mounted = await mountContracts(h(Prepared, { prepare }, h(AuthProvider, null,
    h(SettingsProvider, null, h(PaywallModal, { user }), h(LateIdentityRead, { reader })))), '/studio', user);
  t.after(() => mounted.unmount());
  await mounted.flush();
  assert.equal((await reader.current()).id, user.id);
  assert.deepEqual(calls, ['/api/auth/me']);
  assert.equal(localStorage.getItem('dismissed_explainers'), '["sample"]');
});

test('a GET retries once after Retry-After and a POST never retries', async (t) => {
  const restore = installDocument();
  t.after(restore);
  localStorage.setItem('user', JSON.stringify(user));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push([path, options.method ?? 'GET']);
    return path.endsWith('/success') && calls.length === 2 ? json({ recovered: true }) : limited();
  });
  assert.deepEqual(await request('/test/success'), { recovered: true });
  await assert.rejects(request('/test/still-limited'), { status: 429, code: 'rate_limited' });
  await assert.rejects(request('/test/write', { method: 'POST' }), { status: 429 });
  assert.deepEqual(calls, [
    ['/api/test/success', 'GET'], ['/api/test/success', 'GET'],
    ['/api/test/still-limited', 'GET'], ['/api/test/still-limited', 'GET'],
    ['/api/test/write', 'POST'],
  ]);
});

test('the wait honours the supplied delay, caps it and aborts with its caller', async (t) => {
  const restore = installDocument();
  t.after(restore);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => t.mock.timers.reset());
  let calls = 0;
  let header = '20';
  t.mock.method(globalThis, 'fetch', async () => (++calls === 2 ? json({ recovered: true }) : limited(header)));
  const read = request('/test/slow', { timeoutMs: null });
  await Promise.resolve();
  t.mock.timers.tick(4999);
  await Promise.resolve();
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  assert.deepEqual(await read, { recovered: true });
  const controller = new AbortController();
  const cancelled = request('/test/cancelled', { signal: controller.signal, timeoutMs: null });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(calls, 3);
  header = 'unreadable';
  await assert.rejects(request('/test/no-valid-delay'), { status: 429 });
  assert.equal(calls, 4);

  header = '1';
  const oldIdentity = request('/test/changed-account', { timeoutMs: null });
  await Promise.resolve();
  localStorage.setItem('user', JSON.stringify({ id: 9198 }));
  t.mock.timers.tick(999);
  assert.equal(calls, 5);
  t.mock.timers.tick(1);
  await assert.rejects(oldIdentity, { name: 'AbortError' });
  assert.equal(calls, 5);
});

function SwitcherFixture({ navigation }) {
  const [company, setCompany] = useState(null);
  const [companies, setCompanies] = useState([]);
  const navigate = useNavigate();
  navigation.current = navigate;
  return h(ActiveCompanyContext.Provider, { value: { company, companies, setCompany, setCompanies } },
    h(CompanySwitcher, { role: 'founder' }));
}

for (const recovery of ['button', 'navigation', 'focus']) {
  test(`the failed company switcher recovers on ${recovery} and stops refreshing on focus`, async (t) => {
    let reads = 0;
    const navigation = { current: null };
    t.mock.method(globalThis, 'fetch', async (path) => {
      if (path !== '/api/company/memberships') return json({});
      if (++reads === 1) return json({ error: 'unavailable', message: 'Membership read failed.' }, { status: 503 });
      return json([{ id: 10, uid: 'sample-company', company_name: 'Sample Company' }]);
    });
    const listeners = new Map();
    const prepare = () => {
      window.addEventListener = (name, fn) => listeners.set(name, fn);
      window.removeEventListener = (name, fn) => {
        if (listeners.get(name) === fn) listeners.delete(name);
      };
    };
    const mounted = await mountContracts(h(Prepared, { prepare }, h(SwitcherFixture, { navigation })), '/studio', user);
    t.after(() => mounted.unmount());
    await mounted.flush();
    assert.match(mounted.text(), /Unavailable/);

    if (recovery === 'button') {
      const toggle = mounted.nodes().find(node => mounted.props(node)?.['data-testid'] === 'switcher-trigger');
      await act(async () => mounted.props(toggle).onClick());
      await mounted.click('Try again');
    } else if (recovery === 'navigation') {
      await act(async () => navigation.current('/network'));
    } else {
      await act(async () => listeners.get('focus')?.());
    }
    await mounted.flush();
    assert.match(mounted.text(), /Sample Company/);
    assert.equal(reads, 2);
    await act(async () => listeners.get('focus')?.());
    assert.equal(reads, 2);
  });
}
