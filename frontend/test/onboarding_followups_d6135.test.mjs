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
const PERSISTED = { ...ANSWERS, _investor_onboarding_version: 2 };
const PROFILE = { investor_type: 'angel', sectors: ['General Tech'], stages: ['Seed'], geos: ['Europe'], ticket_band: '$10k-$50k', thesis_text: 'Synthetic thesis', contribute_to_signals: false, anti_thesis_sectors: ['Parenting/Families'], anti_thesis_stages: [], firm_name: null, accreditation_status: 'non_us', country: 'Canada', lp_intent: 'maybe', lp_target_usd: '50000', notes: 'Synthetic note' };
function Probe() { return h('span', { 'data-testid': 'location' }, useLocation().pathname); }
async function fixture({ role = 'investor', step = 7, legacy = false, completed = false, profileFail = false, progressFail = false } = {}) {
  const methods = ['onboardingGetProgress', 'onboardingSaveProgress', 'onboardingComplete', 'saveInvestorProfile', 'getInvestorProfile', 'getMe'];
  const original = Object.fromEntries(methods.map(k => [k, api[k]]));
  const oldDispatch = globalThis.dispatchEvent;
  const user = { id: 6135, role, name: 'Synthetic member' };
  const progress = [], copies = [], completions = [];
  const state = { profileFail, progressFail };
  api.getMe = async () => user;
  api.onboardingGetProgress = async () => ({ flow: 'investor', step, total_steps: legacy ? 9 : 8, data: legacy ? { ...ANSWERS } : { ...PERSISTED }, completed_at: completed ? '2026-11-01' : null });
  api.onboardingSaveProgress = async v => { progress.push(v); if (state.progressFail) throw new Error('Synthetic unavailable progress'); return {}; };
  api.onboardingComplete = async (flow, values) => {
    completions.push(flow);
    copies.push(values);
    if (state.profileFail) throw new Error('Could not finish your investor profile.');
    return { completed_at: true, profile: { ...PROFILE, completed_at: '2026-11-27' } };
  };
  api.saveInvestorProfile = async () => assert.fail('The wizard must use the atomic completion endpoint');
  api.getInvestorProfile = async () => ({ profile: null });
  const m = await mountContracts(h(AuthProvider, null, h(OnboardingInvestorPage), h(Probe)), '/onboarding/investor', user);
  globalThis.dispatchEvent = () => true;
  const settle = async () => { for (let n = 0; n < 5; n++) await m.flush(); };
  await settle();
  const props = id => { const node = m.nodes().find(n => m.props(n)?.['data-testid'] === id); return node ? m.props(node) : undefined; };
  const close = async () => { await m.unmount(); globalThis.dispatchEvent = oldDispatch; Object.assign(api, original); };
  return { ...m, props, state, progress, copies, completions, settle, close };
}

test('a failed atomic finish keeps Review and retries the same answers before offering the fund', async () => {
  const m = await fixture({ profileFail: true });
  try {
    await m.click('Finish profile'); await m.settle();
    assert.match(m.text(), /Could not finish your investor profile/);
    assert.equal(m.props('location').children, '/onboarding/investor');
    assert.deepEqual(m.progress.at(-1).data, PERSISTED);
    assert.equal(m.progress.at(-1).total_steps, 8);
    assert.deepEqual(m.completions, ['investor']);
    assert.deepEqual(m.copies, [PERSISTED]);
    m.state.profileFail = false;
    await m.click('Finish profile'); await m.settle();
    assert.match(m.text(), /Your profile is saved/);
    assert.deepEqual(m.copies[0], m.copies[1]);
    assert.ok(m.props('investor-deals') && m.props('investor-fund'));
    await m.click('Read about the fund'); await m.settle();
    assert.equal(m.props('location').children, '/spinout-lab/investor-workspace');
  } finally { await m.close(); }
});

test('a failed finish offers neither a bypass nor an ending', async () => {
  const m = await fixture({ profileFail: true });
  try {
    await m.click('Finish profile'); await m.settle();
    assert.doesNotMatch(m.text(), /Continue anyway|Your profile is saved/);
    assert.equal(m.copies.length, 1);
    assert.ok(!m.props('investor-fund') && !m.props('investor-deals'));
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
    const m = await fixture({ step, legacy: true });
    try {
      assert.match(m.text(), step === 6 ? /Anti-thesis \(hard exclusions\)/ : /LP commitment intent/);
      assert.doesNotMatch(m.text(), /What matters most|matching|match you|NEVER match/);
      assert.equal(m.copies.length, 0);
      if (step !== 6) {
        await m.click('Continue'); await m.settle();
        await m.click('Finish profile'); await m.settle();
        assert.deepEqual(m.progress.at(-1).data, PERSISTED);
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
    assert.deepEqual(m.progress.at(-1).data, PERSISTED);
    assert.equal(m.completions.length, 1); assert.equal(m.copies.length, 1);
  } finally { await m.close(); }
});

test('reopening a completed wizard preserves answers and requires an explicit profile save', async () => {
  const m = await fixture({ completed: true });
  try {
    assert.equal(m.copies.length, 0);
    assert.match(m.text(), /Your profile still needs to be saved/);
    await m.click('Save profile'); await m.settle();
    assert.deepEqual(m.copies, [PERSISTED]);
    assert.equal(m.completions.length, 1);
  } finally { await m.close(); }
});

test('only admitted roles and recorded LP intent get the fund route', () => {
  for (const role of ['investor', 'admin']) for (const intent of ['yes_now', 'maybe']) assert.equal(investorFundHref(role, intent), '/spinout-lab/investor-workspace');
  for (const role of ['exploring', 'partner', 'advisor', 'founder', undefined]) assert.equal(investorFundHref(role, 'yes_now'), null);
  for (const intent of ['deal_only', 'no', undefined]) assert.equal(investorFundHref('investor', intent), null);
});


test('every remaining step uses current thesis-fit copy and contains no unused value sliders', async () => {
  for (let step = 0; step < 8; step++) {
    const m = await fixture({ step, legacy: true });
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
  api.onboardingComplete = () => new Promise(resolve => { reply = resolve; });
  try {
    await m.click('Finish profile'); await m.settle();
    assert.match(m.text(), /Review your answers/);
    assert.ok(!m.props('investor-fund') && !m.props('investor-deals'));
    reply({ completed_at: true, profile: { ...PROFILE, completed_at: '2026-11-27' } }); await m.settle();
    assert.ok(m.props('investor-deals') && m.props('investor-fund'));
  } finally { await m.close(); }
});
