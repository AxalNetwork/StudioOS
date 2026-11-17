/** #6136 — "My thesis" lets an investor correct the onboarding answers, one field per save. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement as h } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import InvestorMyThesisCard from '../src/pages/account/InvestorMyThesisCard.jsx';
import { DETAIL_FIELDS, VERIFICATIONS_HREF, detailPayload } from '../src/pages/account/InvestorProfileDetails.jsx';
import { useInvestorProfile } from '../src/pages/account/useInvestorProfile.js';

function Card() {
  const investorProfile = useInvestorProfile(true);
  return h(InvestorMyThesisCard, { role: 'investor', flash() {}, investorProfile });
}

const base = {
  investor_type: 'angel', sectors: ['Fintech'], stages: ['Seed'], geos: ['Europe'],
  ticket_band: '10k_50k', thesis_text: 'Initial thesis', completed_at: '2026-11-14',
  anti_thesis_sectors: [], anti_thesis_stages: [], value_weights: {}, contribute_to_signals: true,
};

async function mount(t, profile) {
  const writes = [];
  let stored = profile;
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    if (request.method === 'PUT') {
      const body = JSON.parse(request.body);
      writes.push(body);
      // The Worker keeps an onboarding field it is not sent (investor_signals.ts).
      stored = { ...stored, ...body };
    }
    return Response.json({ profile: stored });
  });
  const view = await mountContracts(h(Card), '/account/security-privacy');
  t.after(() => view.unmount());
  const row = (key) => view.nodes().find(n => view.props(n)?.['data-testid'] === `investor-detail-${key}`);
  const within = (node, pred) => { const walk = x => [x, ...(x.childNodes || []).flatMap(walk)]; return walk(node).find(pred); };
  const button = (key, label) => within(row(key), n => n.tagName === 'BUTTON' && view.props(n)?.children === label)
    || within(row(key), n => n.tagName === 'BUTTON' && [].concat(view.props(n)?.children).includes(label));
  const field = (key) => within(row(key), n => ['INPUT', 'SELECT'].includes(n.tagName));
  const textOf = (x) => (x.nodeType === 3 ? x.textContent || '' : x.childNodes?.length ? x.childNodes.map(textOf).join('') : x.textContent || '');
  const rowText = (key) => textOf(row(key));
  return { view, writes, row, button, field, rowText, stored: () => stored };
}

test('every onboarding field shows "Not recorded" when the profile has none, never a blank or 0', async (t) => {
  const { rowText } = await mount(t, base);
  for (const f of DETAIL_FIELDS) assert.match(rowText(f.key), /Not recorded/, f.key);
  assert.doesNotMatch(rowText('lp_target_usd'), /\$0/);
});

test('each field loads its stored value in the onboarding wording', async (t) => {
  const { rowText } = await mount(t, {
    ...base, firm_name: 'Example Fund', accreditation_status: 'qp', country: 'Canada',
    lp_intent: 'deal_only', lp_target_usd: 250000,
  });
  assert.match(rowText('firm_name'), /Example Fund/);
  assert.match(rowText('accreditation_status'), /Qualified Purchaser/);
  assert.match(rowText('country'), /Canada/);
  assert.match(rowText('lp_intent'), /Deal-by-deal only for now/);
  assert.match(rowText('lp_target_usd'), /\$250,000/);
  for (const f of DETAIL_FIELDS) assert.doesNotMatch(rowText(f.key), /Not recorded/, f.key);
});

test('saving one field sends only that field, and the others stay as they were', async (t) => {
  const stored = { ...base, firm_name: 'Old Fund', accreditation_status: 'accredited', country: 'Canada', lp_intent: 'maybe', lp_target_usd: 100000 };
  const { view, writes, button, field, rowText } = await mount(t, stored);
  await act(async () => view.props(button('country', 'Edit')).onClick());
  assert.equal(view.props(field('country')).value, 'Canada', 'the editor opens on the stored value');
  await act(async () => view.props(field('country')).onChange({ target: { value: 'France' } }));
  await act(async () => view.props(button('country', 'Save')).onClick());
  assert.equal(writes.length, 1);
  assert.equal(writes[0].country, 'France');
  for (const key of ['firm_name', 'accreditation_status', 'lp_intent', 'lp_target_usd']) {
    assert.ok(!Object.hasOwn(writes[0], key), `${key} is not sent, so the Worker keeps it`);
  }
  assert.ok(!Object.hasOwn(writes[0], 'contribute_to_signals'));
  assert.deepEqual(writes[0].sectors, ['Fintech'], 'the full-replace thesis columns are resent from the saved profile');
  assert.match(rowText('country'), /France/);
  assert.match(rowText('firm_name'), /Old Fund/);
  assert.match(rowText('accreditation_status'), /Accredited \(US\)/);
  assert.match(rowText('lp_intent'), /Open, want more info/);
  assert.match(rowText('lp_target_usd'), /\$100,000/);
});

test('a target that is not a whole number is refused before any save; blank clears it', async (t) => {
  const { view, writes, button, field, rowText } = await mount(t, { ...base, lp_target_usd: 5000 });
  await act(async () => view.props(button('lp_target_usd', 'Edit')).onClick());
  await act(async () => view.props(field('lp_target_usd')).onChange({ target: { value: '12.5' } }));
  await act(async () => view.props(button('lp_target_usd', 'Save')).onClick());
  assert.equal(writes.length, 0);
  assert.match(rowText('lp_target_usd'), /whole number/);
  await act(async () => view.props(field('lp_target_usd')).onChange({ target: { value: '' } }));
  await act(async () => view.props(button('lp_target_usd', 'Save')).onClick());
  assert.equal(writes.length, 1);
  assert.equal(writes[0].lp_target_usd, null);
  assert.match(rowText('lp_target_usd'), /Not recorded/);
});

test('accreditation is labelled self-declared and links to Trust Center verifications', async (t) => {
  const { view, row, rowText } = await mount(t, { ...base, accreditation_status: 'accredited' });
  assert.equal(VERIFICATIONS_HREF, '/trust/me?tab=verifications');
  assert.match(rowText('accreditation_status'), /self-declared/);
  const walk = x => [x, ...(x.childNodes || []).flatMap(walk)];
  const link = walk(row('accreditation_status')).find(n => n.tagName === 'A');
  assert.ok(link, 'a link is drawn');
  assert.equal(view.props(link)?.href, '/trust/me?tab=verifications');
});

test('detailPayload trims text, clears on blank and accepts only whole dollars', () => {
  const text = DETAIL_FIELDS.find(f => f.key === 'firm_name');
  const num = DETAIL_FIELDS.find(f => f.key === 'lp_target_usd');
  assert.deepEqual(detailPayload(text, '  Fund  '), { ok: true, value: 'Fund' });
  assert.deepEqual(detailPayload(text, '   '), { ok: true, value: null });
  assert.deepEqual(detailPayload(num, '250000'), { ok: true, value: 250000 });
  assert.deepEqual(detailPayload(num, ''), { ok: true, value: null });
  assert.equal(detailPayload(num, '-5').ok, false);
  assert.equal(detailPayload(num, '1e5').ok, false);
});
