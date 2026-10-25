import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { installDocument, mountContracts } from './_contracts_dom.mjs';
import { api, events } from '../src/lib/api.js';
import { personaSegmentsApi } from '../src/lib/api/personaSegments.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import NewSegment from '../src/pages/admin/segments/NewSegment.jsx';
import PersonaSegments from '../src/pages/admin/segments/PersonaSegments.jsx';
import PersonaFollowUpCheck from '../src/pages/account/PersonaFollowUpCheck.jsx';
import OnboardingPersonaPage from '../src/pages/OnboardingPersonaPage.jsx';
import EventManagePage from '../src/pages/events/EventManagePage.jsx';
import { readFileSync } from 'node:fs';
import { sourceModule } from './_form_d695.mjs';
const h = React.createElement;
const HQ = { id: 1, role: 'admin', is_super_admin: 1 };
const originalApi = { ...api }, originalSegments = { ...personaSegmentsApi }, originalEvents = { ...events };
const id = (v, value) => v.nodes().find(n => v.props(n)?.['data-testid'] === value);
async function change(v, node, value) { await act(async () => v.props(node).onChange({ target: { value } })); }
function restore() { Object.assign(api, originalApi); Object.assign(personaSegmentsApi, originalSegments); Object.assign(events, originalEvents); }
function Probe() { const location = useLocation(); return h('p', { 'data-testid': 'location' }, location.pathname + location.search + ':' + Boolean(location.state?.skipPersonaFollowUp)); }

test('HQ gets both New segment doors on an empty Overview; a plain Admin gets no authoring door', async () => {
  api.listPersonasAdmin = async () => ({ users: [] });
  for (const hq of [false, true]) {
    const v = await mountContracts(h(AuthProvider, null, h(PersonaSegments)), '/admin/persona-segments', { ...HQ, is_super_admin: hq ? 1 : 0 });
    try {
      const doors = v.nodes().filter(n => n.tagName === 'A' && String(v.props(n)?.href).startsWith('/admin/persona-segments/new'));
      assert.equal(doors.length, hq ? 2 : 0);
      if (hq) assert.ok(doors.some(n => v.props(n).href.endsWith('?profile=advisor')));
      else assert.match(v.text(), /HQ writes the segment profiles/);
    } finally { await v.unmount(); }
  }
  restore();
});

test('ordinary Admin sees the SEG13 refusal and never creates a segment', async () => {
  let calls = 0; personaSegmentsApi.createSegment = async () => { calls++; };
  const v = await mountContracts(h(AuthProvider, null, h(NewSegment)), '/admin/persona-segments/new', { ...HQ, is_super_admin: 0 });
  try { assert.match(v.text(), /Only HQ creates segments/); assert.equal(v.nodes().filter(n => n.tagName === 'INPUT').length, 0); assert.equal(calls, 0); }
  finally { await v.unmount(); restore(); }
});

test('creation confirms its effect before posting, shows a refusal inside the dialog, then shows the recorded result', async () => {
  const calls = [];
  personaSegmentsApi.createSegment = async body => { calls.push(body); if (calls.length === 1) throw new Error('A segment already has that key.'); return { segment: { ...body } }; };
  const v = await mountContracts(h(AuthProvider, null, h(NewSegment)), '/admin/persona-segments/new?profile=advisor', HQ);
  try {
    await v.fill('Segment key', 'specialist_advisors'); await v.fill('Name', 'Specialist advisors');
    assert.equal(v.props(v.nodes().find(n => n.tagName === 'SELECT')).value, 'advisor');
    const form = v.nodes().find(n => n.tagName === 'FORM');
    await act(async () => v.props(form).onSubmit({ preventDefault() {} }));
    assert.equal(calls.length, 0); assert.match(v.text(), /applies to every studio/);
    await v.click('Confirm creation');
    const dialog = v.nodes().find(n => v.props(n)?.role === 'dialog');
    const descendants = n => [n, ...n.childNodes.flatMap(descendants)];
    assert.ok(descendants(dialog).some(n => v.props(n)?.role === 'alert'));
    await v.click('Confirm creation');
    assert.equal(calls.length, 2); assert.equal(calls[1].key, 'specialist_advisors'); assert.equal(calls[1].status, 'draft');
    assert.match(v.text(), /Created Specialist advisors/); assert.match(v.text(), /Questions: Not recorded/);
    assert.ok(!v.nodes().some(n => v.props(n)?.role === 'dialog'));
  } finally { await v.unmount(); restore(); }
});

test('Profile opens the existing question screen; answering a moved segment never finalizes or overwrites the admin placement', async () => {
  let pending = true; let finalized = 0;
  const answers = [];
  api.getMyPersonas = async () => ({ follow_up: { pending, recorded: true, persona_id: 'corporate_vc', name: 'Stored Corporate VC name', questions: pending ? [{ key: 'focus', type: 'text', prompt: 'Synthetic segment question' }] : [] } });
  api.finalizePersona = async () => { finalized++; };
  personaSegmentsApi.answerFollowUp = async (...args) => { answers.push(args); pending = false; };
  const tree = h(React.Fragment, null, h(Probe), h(Routes, null,
    h(Route, { path: '/account/profile', element: h(React.Fragment, null, h(PersonaFollowUpCheck), h('p', null, 'Profile body')) }),
    h(Route, { path: '/onboarding/persona', element: h(OnboardingPersonaPage) })));
  const v = await mountContracts(tree, '/account/profile');
  try {
    await v.flush(); assert.match(v.text(), /Your segment questions/); assert.match(v.text(), /Stored Corporate VC name/); assert.doesNotMatch(v.text(), /In one or two sentences/);
    const input = v.nodes().find(n => n.tagName === 'INPUT' && v.props(n)?.id === 'persona-question-input');
    assert.ok(v.props(input).className.includes('min-h-[44px]'));
    await change(v, input, 'Synthetic answer'); await v.click('Finish');
    assert.deepEqual(answers, [['corporate_vc', 'focus', 'Synthetic answer']]); assert.equal(finalized, 0);
    assert.match(v.text(), /Your segment placement is unchanged/);
    await v.click('Return to profile'); await v.flush(); assert.match(v.text(), /Profile body/);
    assert.match(v.props(id(v, 'location')).children, /^\/account\/profile/);
  } finally { await v.unmount(); restore(); }
});

test('question reads fail independently and retry; Not now returns without an immediate redirect loop', async () => {
  let calls = 0;
  api.getMyPersonas = async () => { if (++calls === 1) throw new Error('unreadable'); return { follow_up: { pending: true, questions: [{ key: 'q', type: 'text', prompt: 'Synthetic question' }], persona_id: 'corporate_vc', name: 'Corporate VC' } }; };
  const tree = h(React.Fragment, null, h(Probe), h(Routes, null,
    h(Route, { path: '/account/profile', element: h(React.Fragment, null, h(PersonaFollowUpCheck), h('p', null, 'Profile remains available')) }),
    h(Route, { path: '/onboarding/persona', element: h(OnboardingPersonaPage) })));
  const v = await mountContracts(tree, '/account/profile');
  try {
    assert.match(v.text(), /could not be read/); assert.match(v.text(), /Profile remains available/);
    await v.click('Retry'); await v.flush(); assert.match(v.text(), /Synthetic question/);
    await v.click('Not now — return to profile'); await v.flush();
    assert.match(v.text(), /Profile remains available/); assert.match(v.props(id(v, 'location')).children, /:true$/);
  } finally { await v.unmount(); restore(); }
});

test('canonical Profile address preserves the one-visit deferral state', async () => {
  // Stripe payment widgets are outside this profile-route probe.
  const url = new URL('../src/pages/SettingsPage.jsx', import.meta.url);
  const source = readFileSync(url, 'utf8').replace(/import AxalCheckout[^;]+;/, 'const AxalCheckout = () => null;').replace(/import BillingDashboard[^;]+;/, 'const BillingDashboard = () => null;');
  const { default: SettingsPage } = await sourceModule(source, 'pages/SettingsPage.jsx');
  api.getSettings = () => new Promise(() => {});
  const v = await mountContracts(h(React.Fragment, null, h(SettingsPage), h(Probe)), { pathname: '/account/profile', state: { skipPersonaFollowUp: true } });
  try { await v.flush(); assert.equal(v.props(id(v, 'location')).children, '/account:true'); }
  finally { await v.unmount(); restore(); }
});

test('a stored-only active segment with no question bank can actually be selected and finalized', async () => {
  const finalized = [];
  api.getPersonaTaxonomy = async () => ({ personas: [{ id: 'custom_advisor', label: 'Custom advisor', short_description: 'Synthetic profile', follow_up_questions: [] }] });
  api.classifyPersona = async () => ({ persona_id: null, needs_disambiguation: true });
  api.finalizePersona = async (...args) => { finalized.push(args); };
  const v = await mountContracts(h(OnboardingPersonaPage), '/onboarding/persona');
  try {
    const intro = v.nodes().find(n => n.tagName === 'TEXTAREA'); await change(v, intro, 'Synthetic intro'); await v.click('Continue');
    const button = v.nodes().find(n => n.tagName === 'BUTTON' && v.props(n)?.onClick && n.childNodes.some(c => v.props(c)?.children === 'Custom advisor'));
    assert.ok(button); await act(async () => v.props(button).onClick());
    assert.match(v.text(), /Questions: Not recorded/); await v.click('Use this segment');
    assert.deepEqual(finalized, [['custom_advisor', 1, 'self_select', null]]); assert.match(v.text(), /All set/);
  } finally { await v.unmount(); restore(); }
});

test('Events choice names are stored ones and an unreadable choice list has retry, not the code taxonomy', async () => {
  events.get = async () => ({ event: { id: 4, title: 'Synthetic event', starts_at: '2099-01-01', audience_rules: { mode: 'selected', personas: ['custom_advisor'] } }, agenda: [] });
  events.roster = async () => ({ registrations: [], counts: { seats_taken: 0, waitlisted: 0, capacity: null } });
  events.eligibility = async () => ({ eligible: true, reason: 'Synthetic eligibility' });
  let calls = 0; personaSegmentsApi.audienceSegments = async () => { if (++calls === 1) throw new Error('unreadable'); return { segments: [{ key: 'custom_advisor', name: 'HQ stored advisor name', status: 'active' }] }; };
  const v = await mountContracts(h(Routes, null, h(Route, { path: '/events/:id/manage/eligibility', element: h(EventManagePage) })), '/events/4/manage/eligibility');
  try {
    assert.match(v.text(), /Segment choices are unreadable/); assert.doesNotMatch(v.text(), /LP — Individual/);
    await v.click('Try again'); assert.match(v.text(), /HQ stored advisor name/);
    const checked = v.nodes().find(n => n.tagName === 'INPUT' && v.props(n)?.type === 'checkbox' && v.props(n)?.checked === true);
    assert.ok(checked, 'the saved stored segment remains selected');
  } finally { await v.unmount(); restore(); }
});

test('new client methods use the mounted Worker paths and preserve the expected-primary flag', async () => {
  const restoreDoc = installDocument();
  const previous = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options = {}) => { calls.push({ url: String(url), options }); return new Response('{}', { headers: { 'content-type': 'application/json' } }); };
  try {
    await personaSegmentsApi.createSegment({ key: 'custom' });
    await personaSegmentsApi.completion('corporate_vc');
    await personaSegmentsApi.audienceSegments();
    await personaSegmentsApi.answerFollowUp('corporate_vc', 'focus', 'Synthetic value');
    assert.ok(calls[0].url.endsWith('/api/personas/segments')); assert.equal(calls[0].options.method, 'POST');
    assert.ok(calls[1].url.endsWith('/api/personas/segments/corporate_vc/completion'));
    assert.ok(calls[2].url.endsWith('/api/personas/audience-segments'));
    assert.ok(calls[3].url.endsWith('/api/personas/answer')); assert.equal(JSON.parse(calls[3].options.body).expected_primary, true);
  } finally { globalThis.fetch = previous; restoreDoc(); }
});
