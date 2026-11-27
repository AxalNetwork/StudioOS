/**
 * D8730 (#8730) — the Founder and Exploring previews stay in role, and the
 * Exploring page has one next step per state (`design/incoming/Studio Home
 * Previews Page.dc.html`). The Worker side is
 * cloudflare-worker/test/role_previews_8730.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/role_previews_8730.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { PREVIEW_SHELLS, rolePreviewOf } from '../src/lib/previewShells.js';
import { investorPreviewHeaders, setInvestorPreview, setRolePreviewShell } from '../src/lib/investorPreview.js';
import {
  EXPLORING_EXAMPLE_STATES, FOUNDER_FIGURES, PREVIEW_COPY, examplesOf, exampleStateOf, pageName, viewAsPath,
} from '../src/components/rolePreviewModel.js';
import {
  AVAILABLE_NOW, OPENS_WITH_MEMBERSHIP, PROFILING_NA, discoveryOf, exploringStateOf, nextStepFor, trackOf, welcomeLine,
} from '../src/pages/exploringModel.js';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import ViewModeContext from '../src/contexts/ViewModeContext.js';
import { RolePreviewInterview, RolePreviewNotice } from '../src/components/RolePreviewParts.jsx';
import FounderStudioPreview from '../src/pages/founder/FounderStudioPreview.jsx';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const LANE = { next: 'reviews your investor profile and sends a membership agreement to sign. Once it is signed, deal flow and diligence surfaces open up.' };
const FOUNDER_LANE = { next: 'reviews your venture profile and sends a membership agreement to sign.', cta: { to: '/spinout-lab', label: 'Apply to the Spin-Out Lab' } };
const HQ_MODE = { isAdmin: true, isImpersonating: false, superAdmin: true, exitPreview: () => {} };
const render = (el, mode = null) => renderToStaticMarkup(h(MemoryRouter, null, h(ViewModeContext.Provider, { value: mode }, el)));

/* ───────────────────────── who is previewing ───────────────────────── */

test('a preview is an admin, not in a support session, on the Founder or Exploring shell; anything else is a member\'s own page', () => {
  assert.equal(rolePreviewOf({ ...HQ_MODE, viewMode: 'founder' }), 'founder');
  assert.equal(rolePreviewOf({ ...HQ_MODE, viewMode: 'exploring' }), 'exploring');
  assert.equal(rolePreviewOf({ ...HQ_MODE, viewMode: 'investor' }), null, 'Investor keeps D5915');
  assert.equal(rolePreviewOf({ ...HQ_MODE, viewMode: 'admin' }), null);
  assert.equal(rolePreviewOf({ ...HQ_MODE, viewMode: 'founder', isImpersonating: true }), null, 'View As is a person');
  assert.equal(rolePreviewOf({ isAdmin: false, viewMode: 'founder' }), null, 'a founder is never a preview');
  assert.equal(rolePreviewOf(null), null);
  const menu = Object.fromEntries(PREVIEW_SHELLS.map((o) => [o.key, o.what]));
  assert.equal(menu.founder, 'The founder shell. Interview questions show as examples.');
  assert.equal(menu.exploring, 'The exploring shell. Pick the visitor state to show.');
});

test('a preview marks its writes with its shell, and the investor marker keeps precedence', () => {
  setRolePreviewShell('founder');
  assert.deepEqual(investorPreviewHeaders(), { 'X-Axal-Preview-Shell': 'founder' });
  setRolePreviewShell('exploring');
  assert.deepEqual(investorPreviewHeaders(), { 'X-Axal-Preview-Shell': 'exploring' });
  setInvestorPreview(true);
  assert.deepEqual(investorPreviewHeaders(), { 'X-Axal-Preview-Shell': 'investor' });
  setInvestorPreview(false);
  setRolePreviewShell('admin');
  assert.deepEqual(investorPreviewHeaders(), {}, 'only the two role previews are marked');
  setRolePreviewShell(null);
  assert.deepEqual(investorPreviewHeaders(), {});
  assert.match(read('contexts/ViewModeContext.js'), /createElement\(RolePreviewMarker, \{ mode: value \}\)/);
});

/* ───────────────────────── the example read ───────────────────────── */

test('examples: loading, unavailable (never empty), empty, and ready with the first two prompts and no answer', () => {
  assert.equal(examplesOf({ status: 'loading' }).state, 'loading');
  assert.equal(examplesOf({ status: 'error' }).state, 'unavailable');
  assert.equal(examplesOf({ status: 'ok', value: {} }).state, 'unavailable', 'a malformed envelope is not an empty bank');
  assert.equal(examplesOf({ status: 'ok', value: { examples: [] } }).state, 'empty');
  const ready = examplesOf({ status: 'ok', value: {
    total: 12,
    examples: [
      { id: 'a', section: 'BUILD', prompt: 'Confirm your company / project name.', page_target: '/build', answer: 'Synthetic' },
      { id: 'b', prompt: 'Second?', options: ['One', 2] },
      { id: 'c', prompt: 'Third, never drawn' },
    ],
    next_up: [{ id: 'd', prompt: 'Current stage?', page_target: '/build' }, { id: 'e', prompt: 'Off-site', page_target: 'https://example.test' }],
  } });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.total, 12);
  assert.deepEqual(ready.examples.map((q) => q.prompt), ['Confirm your company / project name.', 'Second?']);
  assert.deepEqual(ready.examples[1].options, ['One']);
  assert.ok(ready.examples.every((q) => !('answer' in q)), 'an answer never reaches the page, even if one is sent');
  assert.deepEqual(ready.nextUp.map((q) => q.to), ['/build', null], 'only an in-app page is linked');
});

test('the Exploring example states are the canvas\'s six, in order, and an unknown one falls back to the founder track', () => {
  assert.deepEqual(EXPLORING_EXAMPLE_STATES.map((s) => s.label), ['No role chosen', 'Founder track', 'Investor track', 'Advisor track', 'Partner track', 'Discovery finished']);
  assert.equal(exampleStateOf('nonsense').key, 'founder');
  assert.equal(exampleStateOf('none').role, null);
  assert.equal(viewAsPath(true), '/admin/hq-team');
  assert.equal(viewAsPath(false), '/admin/accounts/all');
});

/* ───────────────────────── one next step per state ───────────────────────── */

test('each Exploring state has one next step with its final copy and destination', () => {
  const none = nextStepFor({ state: 'none', role: null });
  assert.equal(none.heading, 'Tell Eadwyn which role you are exploring');
  assert.deepEqual([none.action.kind, none.action.label], ['chat', 'Answer in Eadwyn']);
  const founder = nextStepFor({ state: 'founder', role: 'founder', lane: FOUNDER_LANE });
  assert.equal(founder.heading, 'Apply to the Spin-Out Lab');
  assert.deepEqual([founder.action.kind, founder.action.to], ['link', '/spinout-lab']);
  assert.match(founder.body, /^The Axal team reviews your venture profile/);
  const discovery = { state: 'ready', answered: 5, total: 12, complete: false };
  const investor = nextStepFor({ state: 'discovery', role: 'investor', discovery });
  assert.equal(investor.heading, 'Answer the investor discovery questions');
  assert.match(investor.body, /^5 of 12 answered\. They tell the Axal team what you invest in/);
  assert.equal(investor.action.label, 'Continue with Eadwyn');
  for (const role of ['advisor', 'partner']) assert.equal(nextStepFor({ state: 'discovery', role, discovery }).heading, `Answer the ${role} discovery questions`);
  const done = nextStepFor({ state: 'done', role: 'investor', lane: LANE });
  assert.equal(done.heading, 'Nothing is needed from you now');
  assert.deepEqual([done.action.label, done.action.button], ['Review your answers in Eadwyn', false], 'no button, a link');
  assert.match(done.body, /deal flow and diligence surfaces open up/);
  assert.doesNotMatch(nextStepFor({ state: 'discovery', role: 'investor', discovery, preview: true }).body, /of 12 answered/, 'a preview draws no visitor count');
});

test('Eadwyn unavailable: a role or discovery step says so with no action, and Apply stays live', () => {
  for (const [state, role] of [['none', null], ['discovery', 'advisor']]) {
    const step = nextStepFor({ state, role, discovery: { state: 'loading' }, eadwynAvailable: false });
    assert.equal(step.body, 'Eadwyn is unavailable right now. Try again in a few minutes.');
    assert.equal(step.action, null);
    assert.equal(step.unavailable, true);
  }
  assert.equal(nextStepFor({ state: 'founder', role: 'founder', lane: FOUNDER_LANE, eadwynAvailable: false }).action.to, '/spinout-lab');
});

test('the state follows the track and a progress read that says complete; a failed read is Unavailable, never 0', () => {
  assert.equal(trackOf('admin'), null);
  assert.equal(exploringStateOf({ role: undefined }), 'none');
  assert.equal(exploringStateOf({ role: 'founder', discovery: { state: 'ready', complete: true } }), 'founder');
  assert.equal(exploringStateOf({ role: 'investor', discovery: { state: 'ready', complete: false } }), 'discovery');
  assert.equal(exploringStateOf({ role: 'investor', discovery: { state: 'ready', complete: true } }), 'done');
  assert.equal(exploringStateOf({ role: 'investor', discovery: { state: 'unavailable' } }), 'discovery', 'only a read that says complete moves to done');
  assert.deepEqual(discoveryOf({ status: 'error' }), { state: 'unavailable' });
  assert.deepEqual(discoveryOf({ status: 'ok', value: { overall: { total: 0 } } }), { state: 'unavailable' });
  assert.deepEqual(discoveryOf({ status: 'ok', value: { overall: { total: 12, answered: 7, skipped: 0 } } }), { state: 'ready', answered: 7, total: 12, complete: false });
  assert.equal(discoveryOf({ status: 'ok', value: { overall: { total: 12, answered: 10, skipped: 2 } } }).complete, true);
  assert.equal(welcomeLine('none'), 'Tell us which role you are exploring, and the Axal team reviews your profile for it.');
});

test('every enabled link on the Exploring page opens a page the exploring shell offers; member-only pages carry none', () => {
  const exploringRows = SIDEBAR_GROUPS.exploring.flatMap((g) => g.items.map((i) => i.to));
  for (const item of AVAILABLE_NOW) assert.ok(exploringRows.includes(item.to), `${item.t} → ${item.to}`);
  assert.ok(OPENS_WITH_MEMBERSHIP.every((item) => !('to' in item)), 'no link to a page RoleGuard bounces');
  const src = codeOnly(read('pages/ExploringDashboard.jsx'));
  for (const bounced of ["'/validate'", "'/build'", "'/research/ask'", "'/studio'"]) assert.ok(!src.includes(bounced), `${bounced} is linked again`);
  assert.doesNotMatch(src, /<ProfileFitSection/, 'Fit and Completion no longer disagree on this page: profiling reads Not applicable while exploring');
  // lib/advisor/router.js reads the Worker's bank manifest, which a Node test cannot import, so its wiring is read.
  const router = codeOnly(read('lib/advisor/router.js'));
  assert.match(router, /export const IN_CHAT_TARGETS = Object\.freeze\(\['\/exploring'\]\);/);
  assert.match(router, /return path && !IN_CHAT_TARGETS\.includes\(path\) \? path : null;/);
  const widget = codeOnly(read('components/advisor/AdvisorProgressWidget.jsx'));
  assert.equal((widget.match(/const target = openableTarget\(/g) || []).length, 2, 'a discovery card draws no "Open Exploring" back to its own page');
  assert.equal(pageName('/build'), 'Build');
  assert.equal(pageName('/validate/customer-research'), 'Customer Research');
});

/* ───────────────────────── what draws ───────────────────────── */

test('the preview interview withholds the operator\'s conversation and keeps the composer off but focusable', () => {
  const html = render(h(RolePreviewInterview, { role: 'founder', nextUp: true }), { ...HQ_MODE, viewMode: 'founder' });
  const text = renderedText(html);
  assert.match(text, /Eadwyn · founder interview/);
  assert.match(text, /Withheld in preview/);
  assert.match(text, new RegExp(PREVIEW_COPY.heldHq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /<textarea[^>]*readOnly=""[^>]*aria-disabled="true"|<textarea[^>]*aria-disabled="true"/);
  assert.match(html, /<button[^>]*aria-disabled="true"[^>]*>Send<\/button>/);
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Send/, 'Send keeps focus so its reason is read');
  assert.match(text, /Send is off because a preview has no one to save an answer for\./);
  assert.match(html, /id="studio-chat"/);
  assert.doesNotMatch(text, /Open Admin/);
});

test('the notice names the role, not a person, and offers View As', () => {
  const text = renderedText(render(h(RolePreviewNotice, { role: 'exploring' }), { ...HQ_MODE, viewMode: 'exploring' }));
  assert.match(text, /Exploring preview/);
  assert.match(text, /You are previewing the Exploring role, not a person\./);
  assert.match(text, /View As a visitor from Team →/);
});

test('the Founder preview: six figures and the profile read Not applicable in preview, never 0, and the modules stay withheld', () => {
  const html = render(h(FounderStudioPreview, { user: { id: 1, role: 'admin' } }), { ...HQ_MODE, viewMode: 'founder' });
  const text = renderedText(html);
  assert.equal((text.match(/Not applicable in preview/g) || []).length, FOUNDER_FIGURES.length + 1);
  for (const k of FOUNDER_FIGURES) assert.match(text, new RegExp(k));
  assert.match(text, /HQ holds no founder record, so none is drawn here, not even 0\./);
  assert.match(text, /Founder profile/);
  assert.match(text, /Founder preview/);
  assert.doesNotMatch(text, /\b0%|\b0 of\b/);
  assert.match(codeOnly(read('pages/founder/FounderStudioPreview.jsx')), /<StudioModules studio=\{studio\} tiles=\{\{\}\} withheld \/>/);
  const dash = codeOnly(read('pages/Dashboard.jsx'));
  assert.match(dash, /if \(founderPreview\) return <FounderStudioPreview user=\{authUser\} \/>;/);
  assert.match(dash, /if \(ownFounder \|\| founderPreview\) \{ setLoading\(false\); return; \}/, 'the preview waits on no dashboard read');
});

test('the Exploring page in preview: the example state select, "Welcome" with no name, examples, and profiling Not applicable', () => {
  // The page mounts PersonalAdvisor, whose imports reach the Worker's bank manifest, so its wiring is read.
  const src = codeOnly(read('pages/ExploringDashboard.jsx'));
  assert.match(src, /const preview = rolePreviewOf\(mode\) === 'exploring' \|\| \(user\?\.role === 'admin' && !mode\?\.isImpersonating\);/);
  assert.match(src, /<label htmlFor="exploring-example-select"[^>]*>Show the Exploring page as<\/label>/);
  assert.match(src, /\{preview \? 'Welcome' : `Welcome, \$\{firstName\}`\}/, 'a preview greets no one by name');
  assert.match(src, /\{preview \? \(\s*<RolePreviewInterview role="exploring" track=\{trackOf\(role\)\} \/>/, 'a preview never mounts the operator\'s own Eadwyn');
  assert.match(src, /\{!preview && <ProductTestingStudio user=\{user\} \/>\}/, 'the operator\'s tester lists are their own');
  assert.match(src, /if \(preview\) return undefined;/, 'a preview reads no progress of the operator\'s');
  assert.match(src, /\{state === 'founder' && <Lanes \/>\}/);
  assert.match(src, /<NotApplicableChip>\{PROFILING_NA\}<\/NotApplicableChip>/);
});

test('Back to HQ returns focus to the trigger and says the preview ended, politely; the button is 44px on a phone', () => {
  const app = codeOnly(read('App.jsx'));
  const sw = app.slice(app.indexOf('function PortalSwitcher('), app.indexOf('const FULL_BLEED_BY_ROLE'));
  assert.match(sw, /setEnded\(Boolean\(previewing\) && key === home\?\.key\);/);
  assert.match(sw, /useEffect\(\(\) => \{ if \(ended\) triggerRef\.current\?\.focus\(\); \}, \[ended\]\);/);
  assert.match(sw, /ref=\{triggerRef\}/);
  assert.match(sw, /role="status" aria-live="polite"/);
  assert.match(sw, /`Preview ended\. You are back in \$\{home\.label\}\.`/);
  assert.match(sw, /className="min-h-11 [^"]*sm:min-h-0/);
});

test('Fit agrees with Completion when profiling does not apply', () => {
  const src = codeOnly(read('components/profile/ProfileFitSection.jsx'));
  assert.match(src, /<FitBody state=\{fitState\} profilingApplicable=\{progressState\?\.data\?\.profiling\?\.applicable !== false\} \/>/);
  assert.match(src, /profilingApplicable === false\) \{\s*return <Nudge>Fit scores come from profiling, which doesn’t apply to your account type\.<\/Nudge>;/);
});
