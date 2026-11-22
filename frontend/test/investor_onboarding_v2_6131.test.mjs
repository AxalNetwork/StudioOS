import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import OnboardingInvestorPage from '../src/pages/OnboardingInvestorPage.jsx';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { api } from '../src/lib/api.js';
import { investorResumeStep } from '../src/lib/onboarding.js';

const answers = { _investor_onboarding_version: 2, investor_type: 'angel', firm_name: 'Synthetic office', accreditation_status: 'non_us', country: 'Canada', check_size: '$10k-$50k', stages: ['Seed'], sectors: ['General Tech'], geos: ['Europe'], anti_thesis_sectors: ['Parenting/Families'], anti_thesis_stages: ['Growth'], thesis_text: 'Synthetic thesis', contribute_to_signals: false, lp_intent: 'yes_now', lp_target_usd: '50000', notes: 'Synthetic note' };
async function fixture({ step = 7, data = answers, readFails = false, saveFails = false } = {}) {
  const keys = ['getMe', 'onboardingGetProgress', 'onboardingSaveProgress', 'onboardingComplete', 'saveInvestorProfile', 'getCorporateProfile', 'updateCorporateProfile'];
  const original = Object.fromEntries(keys.map(key => [key, api[key]]));
  const state = { readFails, saveFails };
  const progress = [], entities = [];
  let completes = 0, reads = 0;
  api.getMe = async () => ({ id: 6131, role: 'investor' });
  api.onboardingGetProgress = async () => { reads++; if (state.readFails) throw Error('Synthetic read failed'); return { flow: 'investor', step, total_steps: 8, data: structuredClone(data) }; };
  api.onboardingSaveProgress = async v => { progress.push(v); if (state.saveFails) throw Error('Synthetic save failed'); };
  api.onboardingComplete = async () => { completes++; };
  api.saveInvestorProfile = async () => ({});
  api.getCorporateProfile = async () => ({ entity_name: 'Synthetic stored entity', entity_type: 'ag', tax_id_number: 'DO NOT COPY' });
  api.updateCorporateProfile = async v => { entities.push(v); return v; };
  const m = await mountContracts(React.createElement(AuthProvider, null, React.createElement(OnboardingInvestorPage)), '/onboarding/investor', { id: 6131, role: 'investor' });
  const settle = async () => { for (let i = 0; i < 6; i++) await m.flush(); };
  await settle();
  const props = n => m.props(n);
  const edit = async label => { const node = m.nodes().find(n => props(n)?.['aria-label'] === `Edit ${label}`); assert.ok(node, label); props(node).onClick(); await settle(); };
  const close = async () => { await m.unmount(); Object.assign(api, original); };
  return { ...m, state, progress, entities, settle, edit, close, completes: () => completes, reads: () => reads };
}

test('legacy indexes map to the same question and malformed positions remain valid', () => {
  assert.deepEqual(Array.from({ length: 9 }, (_, step) => investorResumeStep({ step, total_steps: 9 })), [0, 1, 2, 3, 3, 5, 4, 6, 6]);
  for (const step of [NaN, Infinity, 1.5, '4', null]) assert.equal(investorResumeStep({ step }), 0);
  assert.equal(investorResumeStep({ step: 200, data: answers }), 7);
  assert.equal(investorResumeStep({ step: -2, data: answers }), 0);
});

test('review shows every current answer without legacy sliders or internal keys', async () => {
  const m = await fixture();
  try {
    for (const text of ['Synthetic office', 'Non-US investor', 'Canada', '$10k-$50k', 'Seed', 'General Tech', 'Europe', 'Parenting/Families', 'Growth', 'Synthetic thesis', 'No', 'Yes, ready to commit this cycle', '50000', 'Synthetic note', 'not verified']) assert.ok(m.text().includes(text), text);
    assert.doesNotMatch(m.text(), /_investor_onboarding_version|Step 8 of 7/);
    assert.equal(m.completes(), 0);
  } finally { await m.close(); }
});

test('editing a review group returns directly to review and preserves other answers', async () => {
  const m = await fixture();
  try {
    await m.edit('Check size and stages');
    assert.match(m.text(), /Step 3 of 7/);
    await m.click('Return to review'); await m.settle();
    assert.match(m.text(), /Review your answers/);
    assert.equal(m.progress.at(-1).step, 7);
    assert.deepEqual(m.progress.at(-1).data, answers);
  } finally { await m.close(); }
});

test('skipping optional questions clears only their answers and review records Skipped', async () => {
  const m = await fixture({ step: 4 });
  try {
    await m.click('Skip for now'); await m.settle();
    assert.match(m.text(), /Step 6 of 7/);
    let saved = m.progress.at(-1).data;
    assert.ok(!('anti_thesis_sectors' in saved) && !('anti_thesis_stages' in saved));
    assert.deepEqual(saved._skipped, ['anti-thesis']);
    assert.equal(saved.thesis_text, answers.thesis_text);
    await m.click('Skip for now'); await m.settle();
    await m.click('Skip for now'); await m.settle();
    assert.match(m.text(), /Review your answers/); assert.match(m.text(), /Skipped/);
    saved = m.progress.at(-1).data;
    assert.ok(!saved.thesis_text && !saved.lp_intent && !saved.lp_target_usd && !saved.notes);
    assert.equal(saved.contribute_to_signals, false, 'skipping thesis does not opt into Signals');
  } finally { await m.close(); }
});

test('unreadable progress is retried and never treated as a blank first visit', async () => {
  const m = await fixture({ readFails: true });
  try {
    assert.match(m.text(), /Your progress is unreadable/);
    assert.equal(m.progress.length, 0);
    m.state.readFails = false;
    await m.click('Try again'); await m.settle();
    assert.match(m.text(), /Synthetic office/);
    assert.equal(m.reads(), 2);
  } finally { await m.close(); }
});

test('a failed intermediate save stays on the question; retry saves before moving', async () => {
  const m = await fixture({ step: 2, saveFails: true });
  try {
    await m.click('Continue'); await m.settle();
    assert.match(m.text(), /Step 3 of 7/); assert.match(m.text(), /Could not save progress/);
    m.state.saveFails = false;
    await m.click('Continue'); await m.settle();
    assert.match(m.text(), /Step 4 of 7/);
  } finally { await m.close(); }
});

test('sector search retains selections and regions remain required on the combined question', async () => {
  const m = await fixture({ step: 3, data: { ...answers, geos: [] } });
  try {
    const search = m.nodes().find(n => m.props(n)?.type === 'search');
    assert.ok(search); m.props(search).onChange({ target: { value: 'not a sector' } }); await m.settle();
    assert.match(m.text(), /1 picked/);
    await m.click('Continue'); await m.settle();
    assert.match(m.text(), /Select at least one region/); assert.equal(m.progress.length, 0);
  } finally { await m.close(); }
});

test('Start over requires confirmation and a successful save before clearing answers', async () => {
  const m = await fixture({ saveFails: true });
  try {
    await m.click('Start over'); await m.settle();
    assert.equal(m.progress.length, 0);
    await m.click('Keep my answers'); await m.settle(); assert.match(m.text(), /Synthetic office/);
    await m.click('Start over'); await m.settle();
    await m.click('Confirm start over'); await m.settle(); assert.match(m.text(), /Synthetic office/);
    m.state.saveFails = false;
    await m.click('Confirm start over'); await m.settle();
    assert.match(m.text(), /Step 1 of 7/);
    assert.deepEqual(m.progress.at(-1).data, { _investor_onboarding_version: 2 });
  } finally { await m.close(); }
});

test('entity edits use only the six canonical fields and save before progress advances', async () => {
  const m = await fixture({ step: 0, data: { ...answers, investor_type: 'family_office' } });
  try {
    assert.ok(m.nodes().some(n => m.props(n)?.value === 'Synthetic stored entity'));
    await m.fill('Legal entity name', 'Synthetic changed entity'); await m.settle();
    await m.click('Continue'); await m.settle();
    assert.equal(m.entities.length, 1); assert.equal(m.entities[0].entity_name, 'Synthetic changed entity');
    assert.ok(!('tax_id_number' in m.entities[0])); assert.equal(Object.keys(m.entities[0]).length, 6);
    assert.equal(m.progress.at(-1).step, 1);
  } finally { await m.close(); }
});

test('an entity save failure preserves the edited values on the profile question', async () => {
  const m = await fixture({ step: 0, data: { ...answers, investor_type: 'family_office' } });
  try {
    await m.fill('Legal entity name', 'Synthetic unsaved entity'); await m.settle();
    api.updateCorporateProfile = async () => { throw Error('Synthetic entity refusal'); };
    await m.click('Continue'); await m.settle();
    assert.match(m.text(), /Step 1 of 7/); assert.match(m.text(), /Synthetic entity refusal/);
    assert.equal(m.progress.length, 0);
    const input = m.nodes().find(n => m.props(n)?.value === 'Synthetic unsaved entity'); assert.ok(input);
  } finally { await m.close(); }
});

test('exclusions cannot add a thesis sector, and legacy overlapping exclusions can still be removed', async () => {
  const m = await fixture({ step: 4 });
  try {
    const sector = m.nodes().find(n => n.tagName === 'BUTTON' && m.props(n)?.disabled && m.props(n)?.children?.[0] === 'General Tech');
    assert.ok(sector); m.props(sector).onClick(); await m.settle();
    await m.click('Continue'); await m.settle(); assert.deepEqual(m.progress.at(-1).data.anti_thesis_sectors, answers.anti_thesis_sectors);
  } finally { await m.close(); }
});

test('two immediate finish presses produce one progress write and one completion', async () => {
  const m = await fixture(); let release, writes = 0;
  const oldDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = () => true;
  api.onboardingSaveProgress = () => { writes++; return new Promise(resolve => { release = resolve; }); };
  try {
    const button = m.nodes().find(n => n.tagName === 'BUTTON' && m.props(n)?.children?.includes?.('Finish profile'));
    assert.ok(button); const press = m.props(button).onClick;
    press(); press(); await m.settle(); assert.equal(writes, 1);
    release({}); await m.settle(); assert.equal(m.completes(), 1);
  } finally { globalThis.dispatchEvent = oldDispatch; await m.close(); }
});

test('a recorded zero target stays zero in review and the editable number field', async () => {
  for (const step of [6, 7]) {
    const m = await fixture({ step, data: { ...answers, lp_target_usd: 0 } });
    try {
      if (step === 7) assert.ok(m.nodes().some(n => n.tagName === 'DD' && m.props(n)?.children === 0));
      else assert.ok(m.nodes().some(n => m.props(n)?.type === 'number' && m.props(n)?.value === '0'));
    } finally { await m.close(); }
  }
});

test('sector search resets between questions while saved selections remain intact', async () => {
  const m = await fixture({ step: 3 });
  try {
    const search = m.nodes().find(n => m.props(n)?.type === 'search');
    m.props(search).onChange({ target: { value: 'General Tech' } }); await m.settle();
    await m.click('Continue'); await m.settle();
    const exclusionsSearch = m.nodes().find(n => m.props(n)?.type === 'search');
    assert.equal(m.props(exclusionsSearch).value, '');
    assert.deepEqual(m.progress.at(-1).data.sectors, answers.sectors);
  } finally { await m.close(); }
});
