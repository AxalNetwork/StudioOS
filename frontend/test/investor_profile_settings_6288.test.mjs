/** #6288 — The thesis cards send edits over the latest saved profile. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement as h } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import InvestorMyThesisCard from '../src/pages/account/InvestorMyThesisCard.jsx';
import { InvestorSignalsContributionCard, InvestorThesisEditorCard } from '../src/pages/account/InvestorProfileCards.jsx';
import { useInvestorProfile } from '../src/pages/account/useInvestorProfile.js';

function Cards() {
  const investorProfile = useInvestorProfile(true);
  const props = { role: 'investor', flash() {}, investorProfile };
  return [
    h(InvestorSignalsContributionCard, { ...props, key: 'signals' }),
    h(InvestorMyThesisCard, { ...props, key: 'thesis' }),
    h(InvestorThesisEditorCard, { ...props, key: 'matching' }),
  ];
}

const profile = {
  investor_type: 'angel', sectors: ['Fintech'], stages: ['Seed'], geos: ['Europe'],
  ticket_band: '10k_50k', thesis_text: 'Initial thesis', completed_at: '2026-11-14',
  anti_thesis_sectors: [], anti_thesis_stages: [], value_weights: { market_timing: 0.8 },
  contribute_to_signals: true,
};

test('a matching save followed by a thesis save carries the new anti-thesis into the second PUT', async (t) => {
  let reads = 0;
  let stored = profile;
  const writes = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(url, '/api/investor-profile/me');
    if (request.method === 'PUT') {
      const body = JSON.parse(request.body);
      writes.push(body);
      stored = { ...stored, ...body };
    } else {
      reads += 1;
    }
    return Response.json({ profile: stored });
  });

  const view = await mountContracts(h(Cards), '/account/security-privacy');
  t.after(() => view.unmount());

  const textarea = () => view.nodes().find(node => node.tagName === 'TEXTAREA');
  await act(async () => view.props(textarea()).onChange({ target: { value: 'New thesis' } }));
  const climate = view.nodes().filter(node => node.tagName === 'BUTTON' && view.props(node)?.children === 'Climate').at(-1);
  await act(async () => view.props(climate).onClick());
  await view.click('Save Changes');
  assert.deepEqual(writes[0].anti_thesis_sectors, ['Climate']);
  assert.equal(writes[0].thesis_text, 'Initial thesis', 'matching saves only its own draft');
  assert.equal(view.props(textarea()).value, 'New thesis', 'the unsaved thesis survives the matching response');
  await view.click('Save thesis');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].anti_thesis_sectors, ['Climate']);
  assert.deepEqual(writes[1].value_weights, { market_timing: 0.8 });
  assert.equal(writes[1].thesis_text, 'New thesis');
  assert.match(view.text(), /Anti-thesis:\s*Climate/);
  assert.equal(reads, 1, 'all three cards share one GET');

  const checkbox = view.nodes().find(node => view.props(node)?.type === 'checkbox');
  await act(async () => view.props(checkbox).onChange({ target: { checked: false } }));
  assert.equal(writes[2].contribute_to_signals, false);
  assert.deepEqual(writes[2].anti_thesis_sectors, ['Climate']);
  assert.equal(writes[2].thesis_text, 'New thesis');
  assert.ok(writes.slice(0, 2).every(body => !Object.hasOwn(body, 'contribute_to_signals')));
});

test('Retry starts one shared read after a failed read', async (t) => {
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    reads += 1;
    if (reads === 1) return Response.json({ error: 'Try again shortly' }, { status: 503 });
    return Response.json({ profile });
  });
  const view = await mountContracts(h(Cards), '/account/security-privacy');
  t.after(() => view.unmount());

  assert.match(view.text(), /Your investor profile could not be read/);
  const retries = view.nodes().filter(node => node.tagName === 'BUTTON' && view.props(node)?.onClick);
  assert.ok(retries.length >= 2, 'both visible cards offer Retry');
  await act(async () => {
    view.props(retries[0]).onClick();
    view.props(retries[1]).onClick();
  });
  assert.equal(reads, 2, 'overlapping Retry clicks share the same GET');
  assert.doesNotMatch(view.text(), /could not be read/);
  assert.match(view.text(), /Save thesis/);
});

test('a full-replace save blocks another card until its reply arrives', async (t) => {
  const writes = [];
  const pending = [];
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    if (request.method !== 'PUT') return Response.json({ profile });
    const body = JSON.parse(request.body);
    writes.push(body);
    return new Promise(resolve => {
      pending.push(() => resolve(Response.json({ profile: { ...profile, ...body } })));
    });
  });
  const view = await mountContracts(h(Cards), '/account/security-privacy');
  t.after(() => view.unmount());

  const button = (label) => view.nodes().find(node =>
    node.tagName === 'BUTTON' && view.props(node)?.children?.includes?.(label));
  await act(async () => {
    view.props(button('Save Changes')).onClick();
    view.props(button('Save thesis')).onClick();
  });
  try {
    assert.equal(writes.length, 1, 'rapid saves never start a second full replacement');
    assert.equal(view.props(button('Save thesis')).disabled, true);
    assert.equal(view.props(view.nodes().find(node => view.props(node)?.type === 'checkbox')).disabled, true);
  } finally {
    await act(async () => { pending.forEach(complete => complete()); });
  }
  assert.equal(view.props(button('Save thesis')).disabled, false);
});
