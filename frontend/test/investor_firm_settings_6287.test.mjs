import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, act } from 'react';
import { readFileSync } from 'node:fs';
import { api } from '../src/lib/api.js';
import InvestorFirmSettings from '../src/pages/investor/settings/InvestorFirmSettings.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const route = '/account/portfolio/settings';
const mount = () => mountContracts(createElement(InvestorFirmSettings), route);

test('a failed read has no editor and Try again fetches the profile', async (t) => {
  let attempts = 0;
  t.mock.method(api, 'getInvestorProfile', async () => {
    if (++attempts === 1) throw new Error('read unavailable');
    return { profile: { firm_name: null, contribute_to_signals: false } };
  });
  const view = await mount();
  try {
    assert.match(view.text(), /Firm settings unavailable/);
    assert.ok(!view.nodes().some((node) => node.tagName === 'FORM'));
    await view.click('Try again');
    assert.match(view.text(), /Firm profile/);
    assert.match(view.text(), /Not recorded/);
  } finally {
    await view.unmount();
  }
});

test('one save updates changed firm fields, keeps consent, and reads back on reload', async (t) => {
  let profile = { firm_name: 'Original', investor_type: 'angel', ticket_band: '<$10k', contribute_to_signals: false, sectors: ['Climate'] };
  const writes = [];
  t.mock.method(api, 'getInvestorProfile', async () => ({ profile }));
  t.mock.method(api, 'saveInvestorProfile', async (body) => {
    writes.push(body);
    profile = { ...profile, ...body };
    return { profile };
  });
  const view = await mount();
  try {
    await view.fill('Firm name', 'Updated Firm');
    await view.fill('Investor type', 'institutional');
    await view.fill('Check size', '$50k-$250k');
    const form = view.nodes().find((node) => node.tagName === 'FORM');
    await act(async () => view.props(form).onSubmit({ preventDefault() {} }));
    assert.deepEqual(writes, [{
      firm_name: 'Updated Firm', investor_type: 'institutional', ticket_band: '$50k-$250k', contribute_to_signals: false,
    }]);
    assert.match(view.text(), /Saved/);
  } finally {
    await view.unmount();
  }
  const reopened = await mount();
  try {
    const name = reopened.nodes().find((node) => node.tagName === 'INPUT' && reopened.props(node).maxLength === 120);
    assert.equal(reopened.props(name).value, 'Updated Firm');
  } finally {
    await reopened.unmount();
  }
});

test('the no-company investor branch precedes company fallback and leaves other roles routed', () => {
  const source = readFileSync(new URL('../src/pages/account/companies/CompanySettingsAt.jsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!uid\) \{\s*if \(user\?\.role === 'investor'\)/);
  assert.match(source, /return <InvestorFirmSettings companyLink=\{companyLink\} \/>/);
  assert.match(source, /company\?\.uid && user\?\.role === 'partner'/);
  assert.match(source, /return <CompanySettingsPage \/>/);
});
