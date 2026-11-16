/** D6135 (#6135): real investor wizard save failures, retries, retained progress and role-safe LP handoff. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { useLocation } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import OnboardingInvestorPage from '../src/pages/OnboardingInvestorPage.jsx';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { api } from '../src/lib/api.js';
import { investorFundHref } from '../src/lib/onboarding.js';

const h = React.createElement;
const ANSWERS = { investor_type: 'angel', country: 'Canada', accreditation_status: 'non_us', sectors: ['General Tech'], stages: ['Seed'], geos: ['Europe'], check_size: '$10k-$50k', thesis_text: 'Synthetic thesis', contribute_to_signals: false, anti_thesis_sectors: ['Parenting/Families'], lp_intent: 'maybe', lp_target_usd: '50000', notes: 'Synthetic note', mission_driven: 0.7 };
const PROFILE = { investor_type: 'angel', sectors: ['General Tech'], stages: ['Seed'], geos: ['Europe'], ticket_band: '$10k-$50k', thesis_text: 'Synthetic thesis', contribute_to_signals: false, anti_thesis_sectors: ['Parenting/Families'], anti_thesis_stages: [], firm_name: null, accreditation_status: 'non_us', country: 'Canada', lp_intent: 'maybe', lp_target_usd: '50000', notes: 'Synthetic note' };
function Probe() { return h('span', { 'data-testid': 'location' }, useLocation().pathname); }
async function fixture({ role = 'investor', step = 8, completed = false, profileFail = false, progressFail = false } = {}) {
  const methods = ['onboardingGetProgress', 'onboardingSaveProgress', 'onboardingComplete', 'saveInvestorProfile', 'getMe'];
  const original = Object.fromEntries(methods.map(k => [k, api[k]]));
  const oldDispatch = globalThis.dispatchEvent;
  const user = { id: 6135, role, name: 'Synthetic member' };
  const progress = [], copies = [], completions = [];
  const state = { profileFail, progressFail };
  api.getMe = async () => user;
  api.onboardingGetProgress = async () => ({ flow: 'investor', step, total_steps: 9, data: { ...ANSWERS }, completed_at: completed ? '2026-11-01' : null });
  api.onboardingSaveProgress = async v => { progress.push(v); if (state.progressFail) throw new Error('Synthetic unavailable progress'); return {}; };
  api.onboardingComplete = async flow => { completions.push(flow); return {}; };
  api.saveInvestorProfile = async v => { copies.push(v); if (state.profileFail) throw new Error('Synthetic unavailable profile'); return {}; };
  const m = await mountContracts(h(AuthProvider, null, h(OnboardingInvestorPage), h(Probe)), '/onboarding/investor', user);
  globalThis.dispatchEvent = () => true;
  const settle = async () => { for (let n = 0; n < 5; n++) await m.flush(); };
  await settle();
  const props = id => { const node = m.nodes().find(n => m.props(n)?.['data-testid'] === id); return node ? m.props(node) : undefined; };
  const close = async () => { await m.unmount(); globalThis.dispatchEvent = oldDispatch; Object.assign(api, original); };
  return { ...m, props, state, progress, copies, completions, settle, close };
}

test('a failed profile copy stays visible, retries the same answers and offers the eligible fund beside deal flow', async () => {
  const m = await fixture({ profileFail: true });
  try {
    await m.click('Finish profile'); await m.settle();
    assert.match(m.text(), /Your profile was not saved/);
    assert.equal(m.props('location').children, '/onboarding/investor');
    assert.deepEqual(m.progress.at(-1).data, ANSWERS);
    assert.equal(m.progress.at(-1).total_steps, 8);
    assert.deepEqual(m.completions, ['investor']);
    assert.deepEqual(m.copies, [PROFILE]);
    assert.ok(!('value_weights' in m.copies[0]));
    m.state.profileFail = false;
    await m.click('Try again'); await m.settle();
    assert.match(m.text(), /Your profile is saved/);
    assert.deepEqual(m.copies[0], m.copies[1]);
    assert.ok(m.props('investor-deals') && m.props('investor-fund'));
    await m.click('Open the Axal VC Fund'); await m.settle();
    assert.equal(m.props('location').children, '/spinout-lab/investor-workspace');
  } finally { await m.close(); }
});

test('Continue anyway is explicit and does not retry the refused copy', async () => {
  const m = await fixture({ profileFail: true });
  try {
    await m.click('Finish profile'); await m.settle();
    await m.click('Continue anyway'); await m.settle();
    assert.match(m.text(), /without saving your profile/);
    assert.equal(m.copies.length, 1);
    await m.click('See deal flow'); await m.settle();
    assert.equal(m.props('location').children, '/deals');
  } finally { await m.close(); }
});

test('an exploring member has a holding-page handoff and no fund door', async () => {
  const m = await fixture({ role: 'exploring' });
  try {
    await m.click('Finish profile'); await m.settle();
    assert.ok(!m.props('investor-fund'));
    await m.click('See membership status'); await m.settle();
    assert.equal(m.props('location').children, '/exploring');
  } finally { await m.close(); }
});

test('old slider and LP step indexes resume at LP intent with answers intact; earlier steps still resume', async () => {
  for (const step of [7, 8, 6]) {
    const m = await fixture({ step });
    try {
      assert.match(m.text(), step === 6 ? /Anti-thesis \(hard exclusions\)/ : /LP commitment intent/);
      assert.doesNotMatch(m.text(), /What matters most|matching|match you|NEVER match/);
      assert.equal(m.copies.length, 0);
      if (step !== 6) {
        await m.click('Finish profile'); await m.settle();
        assert.deepEqual(m.progress.at(-1).data, ANSWERS);
      }
    } finally { await m.close(); }
  }
});

test('final progress failure prevents completion and profile copy until the answers are saved', async () => {
  const m = await fixture({ progressFail: true });
  try {
    await m.click('Finish profile'); await m.settle();
    assert.match(m.text(), /Could not save progress/);
    assert.equal(m.completions.length, 0); assert.equal(m.copies.length, 0);
    m.state.progressFail = false;
    await m.click('Finish profile'); await m.settle();
    assert.deepEqual(m.progress.at(-1).data, ANSWERS);
    assert.equal(m.completions.length, 1); assert.equal(m.copies.length, 1);
  } finally { await m.close(); }
});

test('reopening a completed wizard preserves answers and requires an explicit profile save', async () => {
  const m = await fixture({ completed: true });
  try {
    assert.equal(m.copies.length, 0);
    assert.match(m.text(), /Your onboarding answers are saved/);
    await m.click('Save profile'); await m.settle();
    assert.deepEqual(m.copies, [PROFILE]);
    assert.equal(m.completions.length, 0);
  } finally { await m.close(); }
});

test('only admitted roles and recorded LP intent get the fund route', () => {
  for (const role of ['investor', 'admin']) for (const intent of ['yes_now', 'maybe']) assert.equal(investorFundHref(role, intent), '/spinout-lab/investor-workspace');
  for (const role of ['exploring', 'partner', 'advisor', 'founder', undefined]) assert.equal(investorFundHref(role, 'yes_now'), null);
  for (const intent of ['deal_only', 'no', undefined]) assert.equal(investorFundHref('investor', intent), null);
});


test('every remaining step uses current thesis-fit copy and contains no unused value sliders', async () => {
  for (let step = 0; step < 8; step++) {
    const m = await fixture({ step });
    try {
      assert.doesNotMatch(m.text(), /matching|match you|NEVER match|What matters most/);
      assert.ok(!m.nodes().some(n => n.tagName === 'INPUT' && m.props(n)?.type === 'range'));
      if (step === 0 || step === 3) assert.match(m.text(), /thesis fit shown on deals/);
      if (step === 3) assert.match(m.text(), /With your consent/);
    } finally { await m.close(); }
  }
});

test('handoff stays unavailable while the profile save is still pending', async () => {
  const m = await fixture(); let reply;
  api.saveInvestorProfile = () => new Promise(resolve => { reply = resolve; });
  try {
    await m.click('Finish profile'); await m.settle();
    assert.match(m.text(), /Saving your investor profile/);
    assert.ok(!m.props('investor-fund') && !m.props('investor-deals'));
    reply({}); await m.settle();
    assert.ok(m.props('investor-deals') && m.props('investor-fund'));
  } finally { await m.close(); }
});
