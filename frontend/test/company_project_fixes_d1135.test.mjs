import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CompanySwitcher, { useCompanySwitch } from '../src/ui/CompanySwitcher.jsx';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import { api, companyActionsApi, setActiveCompanyId, initActiveCompanyId } from '../src/lib/api.js';
const h = React.createElement;
async function mount(el) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(el); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, pr, buttons: () => walk(container).filter((n) => n.tagName === 'BUTTON'), text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}



const one = { id: 1, uid: 'one', company_name: 'One' };
const two = { id: 2, uid: 'two', company_name: 'Two' };
let controls;
function Probe() { controls = useCompanySwitch(); return h('span', { 'data-testid': 'state' }, JSON.stringify({ company: controls.company, companies: controls.companies })); }
function Harness({ role = 'founder' }) {
  const [company, setCompany] = useState(one); const [companies, setCompanies] = useState([one, two]);
  // D1140: the switcher's Manage link needs a router.
  return h(MemoryRouter, null, h(ActiveCompanyContext.Provider, { value: { company, setCompany, companies, setCompanies } }, h(Probe), h(CompanySwitcher, { role })));
}
test('successful leave removes the membership and clears persisted active selection; failure keeps both', async () => {
  const original = companyActionsApi.leave; const originalList = api.listMyCompanies; const calls = []; let fail = true;
  api.listMyCompanies = async () => [one, two];
  companyActionsApi.leave = async (uid) => { calls.push(uid); if (fail) throw new Error('Not saved'); };
  const view = await mount(h(Harness));
  try {
    setActiveCompanyId(1);
    await assert.rejects(() => controls.leave('one'), /Not saved/);
    assert.equal(controls.company.id, 1); assert.equal(controls.companies.length, 2); assert.equal(initActiveCompanyId(), 1);
    fail = false;
    await act(async () => { await controls.leave('one'); });
    assert.deepEqual(calls, ['one', 'one']); assert.equal(controls.company, null); assert.deepEqual(controls.companies, [two]); assert.equal(initActiveCompanyId(), null);
  } finally { await view.unmount(); companyActionsApi.leave = original; api.listMyCompanies = originalList; setActiveCompanyId(null); }
});
test('leaving an inactive company preserves the active one', async () => {
  const original = companyActionsApi.leave; const originalList = api.listMyCompanies;
  api.listMyCompanies = async () => [one, two]; companyActionsApi.leave = async () => ({ ok: true });
  const view = await mount(h(Harness));
  try { setActiveCompanyId(1); await act(async () => { await controls.leave('two'); }); assert.equal(controls.company.id, 1); assert.equal(initActiveCompanyId(), 1); assert.deepEqual(controls.companies, [one]); }
  finally { await view.unmount(); companyActionsApi.leave = original; api.listMyCompanies = originalList; setActiveCompanyId(null); }
});

test('Explorer sees no create control; a working profile can create from the switcher', async () => {
  const originalList = api.listMyCompanies; api.listMyCompanies = async () => [one, two];
  try {
    for (const role of ['exploring', 'founder']) {
      const view = await mount(h(Harness, { role }));
      try {
        const toggle = view.buttons()[0]; await act(async () => { view.pr(toggle).onClick(); });
        if (role === 'exploring') assert.doesNotMatch(view.text(), /Add a new company/);
        else assert.match(view.text(), /Add a new company/);
      } finally { await view.unmount(); }
    }
  } finally { api.listMyCompanies = originalList; }
});

test('an active company changed during the leave request is preserved', async () => {
  const original = companyActionsApi.leave; const originalList = api.listMyCompanies; let complete;
  api.listMyCompanies = async () => [one, two]; companyActionsApi.leave = () => new Promise((resolve) => { complete = resolve; });
  const view = await mount(h(Harness));
  try {
    let pending; await act(async () => { pending = controls.leave('one'); controls.switchTo(two); });
    await act(async () => { complete({ ok: true }); await pending; });
    assert.equal(controls.company.id, 2); assert.equal(initActiveCompanyId(), 2); assert.deepEqual(controls.companies, [two]);
  } finally { await view.unmount(); companyActionsApi.leave = original; api.listMyCompanies = originalList; setActiveCompanyId(null); }
});
