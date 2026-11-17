/**
 * D4828 (#4828, Expertise UX) — the shared states, the one feedback pattern,
 * the phone section nav and the accessibility checks the Expertise v2 canvas
 * asks for (boards EX-04a, EX-04b, EX-14, EX-16).
 *
 * The zones and the board are the real files; only `lib/api` is replaced.
 * Fixtures are synthetic. Each test names the rule it pins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { h, mountForm, sourceModule, textOf } from './_form_d695.mjs';
import { Field, InlineSaveStatus, SaveNote, ZoneBody, buttonClass, ghostButtonClass } from '../src/pages/advisor/expertise/kit.jsx';
import { NOT_SAVED_KEPT, SAVED, limitLine, limitState, notSavedKept, overLimitKeys, overLimitLine } from '../src/pages/advisor/expertise/feedback.js';
import { LICENCE_SENTENCES } from '../src/pages/advisor/expertise/licenceRefusal.js';
import { PROFILE_LIMITS, SERVICE_LIMITS } from '../src/lib/advisorLimits.js';
import ZoneNav from '../src/workspaces/ZoneNav.jsx';
import BucketBoard from '../src/workspaces/BucketBoard.jsx';
import advisorExpertiseBoard from '../src/workspaces/boards/advisorExpertise.js';
import { bucketForPath } from '../src/workspaces/shellConfig.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const zoneSrc = (name) => read(`frontend/src/pages/advisor/expertise/${name}`);
const canvas = read('design/incoming/Expertise v2 Page.dc.html');
const API_IMPORT = "import { api } from '../../../lib/api';";
const ZONES = ['ProfileZone.jsx', 'ServicesZone.jsx', 'ProofZone.jsx', 'ThinkingZone.jsx', 'VisibilityZone.jsx'];

async function zone(name, apiImpl) {
  const page = zoneSrc(name);
  assert.ok(page.includes(API_IMPORT), `${name} imports lib/api`);
  globalThis.__api4828 = { api: apiImpl };
  return sourceModule(page.replace(API_IMPORT, 'const { api } = globalThis.__api4828;'), `pages/advisor/expertise/${name}`);
}
const deferred = () => { let resolve; let reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const type = async (f, id, value) => { const n = f.by(id); assert.ok(n, id); await act(async () => f.props(n).onChange({ target: { value } })); };
const describedText = (f, node) => String(f.props(node)['aria-describedby'] || '').split(' ').filter(Boolean)
  .map((id) => textOf(f.nodes().find((n) => f.props(n).id === id))).join(' | ');

// ─────────────────────────────────────────── EX-14: one feedback pattern

test('the save sentences are the canvas pair: "Profile updated" and "Not saved, your text is kept"', () => {
  assert.equal(SAVED.profile, 'Profile updated.');
  assert.equal(NOT_SAVED_KEPT, 'Not saved, your text is kept.');
  assert.equal(notSavedKept('The profile could not be saved.'), 'Not saved, your text is kept. The profile could not be saved.');
  assert.equal(notSavedKept(''), 'Not saved, your text is kept.');
});

test('InlineSaveStatus is the one save status: SaveNote is the same component, and saved and not saved differ by shape, not colour alone', async () => {
  // Mutation checked: the glyph dropped from InlineSaveStatus → no data-save-glyph; SaveNote a second component → identity fails.
  assert.equal(SaveNote, InlineSaveStatus);
  const f = await mountForm(h(InlineSaveStatus, { note: null, testid: 's' }));
  try {
    assert.equal(f.props(f.by('s')).role, 'status');
    assert.equal(f.props(f.by('s'))['aria-live'], 'polite');
    await f.render(h(InlineSaveStatus, { note: { ok: true, text: SAVED.profile }, testid: 's' }));
    const tick = f.nodes().find((n) => f.props(n)['data-save-glyph']);
    assert.equal(f.props(tick)['data-save-glyph'], 'tick');
    assert.equal(f.props(tick)['aria-hidden'], 'true');
    assert.equal(textOf(f.by('s')), 'Profile updated.', 'the sentence alone is what is read');
    assert.ok(!f.nodes().some((n) => f.props(n).role === 'alert'), 'a save is polite');
    await f.render(h(InlineSaveStatus, { note: { ok: false, text: notSavedKept('') }, testid: 's' }));
    assert.equal(f.props(f.nodes().find((n) => f.props(n)['data-save-glyph']))['data-save-glyph'], 'cross');
    const alert = f.nodes().find((n) => f.props(n).role === 'alert');
    assert.equal(textOf(alert), 'Not saved, your text is kept.');
  } finally { await f.unmount(); }
});

// ─────────────────────────────────────────── EX-14: shared section states

test('a zone that names what it reads says "Loading …" by word, on the shared skeleton', async () => {
  // Mutation checked: SectionState's sr-only word removed → the text check fails.
  const f = await mountForm(h(ZoneBody, { loading: true, what: 'Your services' }, 'rows'));
  try {
    const busy = f.nodes().find((n) => f.props(n)['aria-busy'] === 'true' && f.props(n).role === 'status');
    assert.ok(busy, 'the loading region is a status');
    assert.match(textOf(busy), /Loading your services…/);
    assert.ok(f.nodes().some((n) => f.props(n)['data-platform-state'] === 'loading'), "#5129's loading skeleton");
    assert.doesNotMatch(f.text(), /rows/);
  } finally { await f.unmount(); }
});

test('a failed read is Unavailable with its own Try again, an alert, and never the empty state', async () => {
  // Mutation checked: ZoneBody's `shared ||` dropped on the error path → the old card, no data-platform-state.
  let retried = 0;
  const f = await mountForm(h(ZoneBody, { error: 'Your services could not be read.', what: 'Your services', onRetry: () => { retried += 1; }, isEmpty: true, empty: h('p', null, 'No services yet') }, 'rows'));
  try {
    const block = f.nodes().find((n) => f.props(n)['data-platform-state'] === 'unavailable');
    assert.ok(block, "#5129's Unavailable");
    assert.equal(f.props(block).role, 'alert', 'a failed read is announced');
    assert.match(textOf(block), /Unavailable/);
    assert.match(textOf(block), /Your services could not be read\./);
    assert.match(textOf(block), /Other sections are unaffected\./);
    assert.doesNotMatch(f.text(), /No services yet|\b0\b/, 'failed never looks like empty or 0');
    await f.click('Try again');
    assert.equal(retried, 1, 'Try again reads this section again');
  } finally { await f.unmount(); }
});

test('the Advisor licence refusal is Refused, says where to get the licence, and offers no Try again', async () => {
  // Mutation checked: the isLicenceSentence branch removed from SectionState → Unavailable with Try again.
  const f = await mountForm(h(ZoneBody, { error: LICENCE_SENTENCES.expertise, what: 'Your services', onRetry: () => {} }, 'rows'));
  try {
    const block = f.by('advisor-licence-required');
    assert.equal(f.props(block)['data-platform-state'], 'refused');
    assert.match(textOf(block), /Expertise needs the Advisor licence on this account\./);
    assert.match(textOf(block), /Ask HQ to add it\./);
    assert.doesNotMatch(f.text(), /Try again/);
  } finally { await f.unmount(); }
});

test('all five Expertise zones draw the shared states, each naming what it reads', () => {
  const what = { 'ProfileZone.jsx': 'Your profile', 'ServicesZone.jsx': 'Your services', 'ProofZone.jsx': 'Your proof', 'ThinkingZone.jsx': 'Your writing', 'VisibilityZone.jsx': 'Your visibility' };
  for (const name of ZONES) assert.match(zoneSrc(name), new RegExp(`what="${what[name]}"`), name);
  // A block of Visibility that did not answer leads with the Unavailable chip.
  assert.match(zoneSrc('VisibilityZone.jsx'), /<StateChip kind="unavailable" \/>/);
});

// ─────────────────────────────────────────── EX-16: field limits

test('a limit is counted the way the Worker counts it, and said in words', () => {
  assert.deepEqual(limitState('  abc  ', 5), { used: 3, limit: 5, over: 0, ok: true });
  assert.deepEqual(limitState('abcdefg', 5), { used: 7, limit: 5, over: 2, ok: false });
  assert.equal(limitLine(limitState('abc', 200)), '3 of 200 characters');
  assert.equal(limitLine(limitState('abcdef', 5)), '1 character over the 5 limit. Shorten it to save; nothing is cut.');
  assert.deepEqual(overLimitKeys({ title: 'x'.repeat(201), scope: 'ok', duration_note: '' }, SERVICE_LIMITS), ['title']);
  assert.equal(overLimitLine(['title', 'scope'], { title: 'Title', scope: 'What it covers' }),
    'Not saved, your text is kept. Title and What it covers are over the limit.');
  assert.equal(overLimitLine([], {}), '');
});

test('a field with a limit has a live counter tied by aria-describedby, and is aria-invalid over it', async () => {
  // Mutation checked: the counter id left out of aria-describedby → the described text has no count.
  const f = await mountForm(h(Field, { label: 'Headline', hint: 'One line.', limit: 10 }, h('input', { 'data-testid': 'hl', value: 'abc', onChange() {} })));
  try {
    assert.equal(describedText(f, f.by('hl')), 'One line. | 3 of 10 characters');
    assert.equal(f.props(f.by('hl'))['aria-invalid'], undefined);
    await f.render(h(Field, { label: 'Headline', hint: 'One line.', limit: 10 }, h('input', { 'data-testid': 'hl', value: 'abcdefghijkl', onChange() {} })));
    assert.equal(f.props(f.by('hl'))['aria-invalid'], 'true');
    assert.match(describedText(f, f.by('hl')), /2 characters over the 10 limit/);
    const counter = f.nodes().find((n) => f.props(n)['data-field-limit'] === 'over');
    assert.equal(f.props(counter)['aria-live'], 'polite', 'going over is announced');
    assert.equal(f.props(f.by('hl')).maxLength, undefined, 'nothing is cut');
  } finally { await f.unmount(); }
});

test('no Expertise input cuts what is typed: the limits are counters, not maxLength', () => {
  // Mutation checked: maxLength restored on the bio textarea → this fails.
  for (const name of ZONES) assert.doesNotMatch(zoneSrc(name), /maxLength=/, name);
  for (const key of Object.keys(PROFILE_LIMITS)) assert.match(zoneSrc('ProfileZone.jsx'), new RegExp(`limit=\\{PROFILE_LIMITS\\.${key}\\}`), key);
  for (const key of Object.keys(SERVICE_LIMITS)) assert.match(zoneSrc('ServicesZone.jsx'), new RegExp(`limit=\\{SERVICE_LIMITS\\.${key}\\}`), key);
});

const PROFILE = { uid: 'adv-1', display_name: 'Synthetic Advisor', headline: 'Synthetic headline', bio: null, expertise: [], sectors: [], stages: null, languages: null, country: null, timezone: null, availability_note: null, headshot_url: null, linkedin_url: null, updated_at: '2026-11-01 10:00:00' };

test('Profile: over a limit blocks the save and keeps every character; a save says "Profile updated"; a failure keeps the text', async () => {
  // Mutation checked: the `over.length` guard removed from save() → the write is sent;
  // notSavedKept dropped from the catch → the alert lacks "your text is kept".
  const writes = [];
  let fail = null;
  const mod = await zone('ProfileZone.jsx', {
    async getMyAdvisor() { return PROFILE; },
    async upsertMyAdvisor(body) { writes.push(body); if (fail) throw fail; return { ...PROFILE, ...body, updated_at: '2026-11-02 10:00:00' }; },
  });
  const f = await mountForm(h(mod.default));
  try {
    await f.flush();
    const long = 'x'.repeat(PROFILE_LIMITS.headline + 5);
    await type(f, 'advisor-profile-headline', long);
    assert.equal(f.props(f.by('advisor-profile-headline')).value, long, 'nothing is cut');
    assert.equal(f.props(f.by('advisor-profile-headline'))['aria-invalid'], 'true');
    assert.ok(f.props(f.by('advisor-profile-save')).disabled, 'over a limit blocks the save');
    assert.equal(textOf(f.by('advisor-profile-over-limit')), 'Not saved, your text is kept. Headline is over the limit.');
    await f.submit();
    assert.equal(writes.length, 0, 'nothing is written over a limit');

    await type(f, 'advisor-profile-headline', 'A shorter headline');
    assert.ok(!f.props(f.by('advisor-profile-save')).disabled);
    await f.submit();
    assert.equal(writes.length, 1);
    assert.equal(textOf(f.by('advisor-profile-note')), 'Profile updated.');
    assert.ok(!f.nodes().some((n) => f.props(n).role === 'alert'), 'a save is announced politely');

    fail = Object.assign(new Error('D1_ERROR: synthetic'), { status: 500 });
    await type(f, 'advisor-profile-headline', 'Typed and not saved');
    await f.submit();
    const alert = f.nodes().find((n) => f.props(n).role === 'alert');
    assert.equal(textOf(alert), 'Not saved, your text is kept. The profile could not be saved.');
    assert.equal(f.props(f.by('advisor-profile-headline')).value, 'Typed and not saved', 'the text is kept');
    assert.doesNotMatch(f.text(), /D1_ERROR/);
  } finally { await f.unmount(); }
});

test('Services: a title over its limit blocks the add and nothing is sent', async () => {
  // Mutation checked: the overLimitKeys guard removed from add() → a create is sent.
  const writes = [];
  const mod = await zone('ServicesZone.jsx', {
    async listMyAdvisorServices() { return { items: [], counts: { total: 0 }, page: { offset: 0, limit: 200, total: 0, next_offset: null } }; },
    async createMyAdvisorService(body) { writes.push(body); return { id: 1, ...body }; },
  });
  const f = await mountForm(h(mod.default));
  try {
    await f.flush();
    await type(f, 'advisor-service-title', 't'.repeat(SERVICE_LIMITS.title + 1));
    assert.ok(f.props(f.by('advisor-service-add-submit')).disabled);
    await act(async () => f.props(f.by('advisor-service-add')).onSubmit({ preventDefault() {} }));
    assert.equal(writes.length, 0);
    assert.equal(textOf(f.by('advisor-services-note')), 'Not saved, your text is kept. Title is over the limit.');
  } finally { await f.unmount(); }
});

// ─────────────────────────────────────────── the Overview: one slow source, one failed, one refused

function boardApi({ proof, services, thinking }) {
  return {
    getMyAdvisor: async () => ({ ...PROFILE, is_active: true, expertise: ['GTM'], sectors: ['Fintech'] }),
    listMyAdvisorServices: services,
    listMyAdvisorProof: proof,
    listMyAdvisorThinking: thinking,
    getMyAdvisorVisibility: async () => ({ surfaces: [], links: { total: 0 }, requests: { total: 0 } }),
  };
}

test('Overview: a slow source keeps only its section loading, a failed one is Unavailable with its own retry, a refused one is Refused', async () => {
  // Mutation checked: `states: 'platform'` removed from the board → the old markup, no data-platform-state;
  // the code dropped from useBucketSources' error → the licence reads as Unavailable.
  const slow = deferred();
  let servicesCalls = 0;
  const api = boardApi({
    proof: () => slow.p,
    services: async () => { servicesCalls += 1; throw new Error('D1_ERROR: synthetic'); },
    thinking: async () => { throw Object.assign(new Error('refused'), { code: 'advisor_licence_required', status: 403 }); },
  });
  const bucket = bucketForPath('advisor', '/expertise');
  const f = await mountForm(h(BucketBoard, { bucket, role: 'advisor', board: advisorExpertiseBoard('advisor', api) }));
  try {
    await f.flush();
    const section = (anchor) => f.nodes().find((n) => f.props(n).id === anchor);
    assert.match(textOf(section('ex-proof')), /Loading Proof…/, 'the slow section says it is loading, by word');
    assert.match(textOf(section('ex-profile')), /Synthetic Advisor/, 'the profile drew without waiting for proof');
    // Rows, not a sideways table, on a phone (EX-04, EX-16).
    assert.ok(f.by('board-rows-profile'), 'the profile rows as blocks below 768px');
    assert.ok(!f.nodes().some((n) => /overflow-x-auto|min-w-\[520px\]/.test(f.props(n).className || '')), 'no horizontal table');
    const failed = section('ex-services');
    assert.match(textOf(failed), /Unavailable/);
    assert.match(textOf(failed), /This section could not be read\./);
    assert.doesNotMatch(textOf(failed), /You have listed no service yet|\b0 live\b/, 'failed never looks like empty or 0');
    const refused = section('ex-thinking');
    assert.match(textOf(refused), /Refused\./);
    assert.match(textOf(refused), /Expertise needs the Advisor licence on this account\./);
    assert.doesNotMatch(textOf(refused), /Try again/);
    const retry = f.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Try again');
    await act(async () => f.props(retry).onClick({}));
    await f.flush();
    assert.equal(servicesCalls, 2, 'Try again reads the failed section again');
    await act(async () => { slow.resolve({ items: [], counts: { attested: 0, self_stated: 0 }, page: { total: 0 } }); });
    await f.flush();
    assert.match(textOf(section('ex-proof')), /No claim is recorded yet\./);
  } finally { await f.unmount(); }
});

test('Overview rows are rows on a phone, never a sideways table; other boards keep theirs', () => {
  // Mutation checked: rowsOnPhone forced false → overflow-x-auto and min-w-[520px] return.
  const api = boardApi({ proof: async () => ({}), services: async () => ({}), thinking: async () => ({}) });
  const board = advisorExpertiseBoard('advisor', api);
  assert.equal(board.states, 'platform');
  const src = read('frontend/src/workspaces/BucketBoard.jsx');
  assert.match(src, /rowsOnPhone \? <BoardRows/);
  const rows = read('frontend/src/workspaces/BoardSectionStates.jsx');
  assert.match(rows, /md:hidden" data-testid=\{`board-rows-/);
  assert.match(rows, /"hidden md:block"/);
  assert.doesNotMatch(rows, /overflow-x-auto|min-w-\[/, 'no horizontal table');
});

// ─────────────────────────────────────────── EX-04: the phone section nav

const navHtml = (path) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] },
  h(ZoneNav, { bucket: bucketForPath('advisor', path), role: 'advisor', activeSlug: path === '/expertise' ? null : undefined })));

test('the phone section nav is the canvas’s: Overview, Profile, Services, Proof, More ▾, each 44px', () => {
  // Mutation checked: `more` dropped from the Expertise row → no More button, Thinking shows below 1024px.
  const tabs = JSON.parse(canvas.match(/const mtabs = [^[]*(\[[^\]]+\])/)[1].replace(/'/g, '"'));
  assert.deepEqual(tabs, ['Overview', 'Profile', 'Services', 'Proof', 'More ▾']);
  const html = navHtml('/expertise');
  const order = [...html.matchAll(/data-testid="link-zone-([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['overview', 'profile', 'services', 'proof', 'thinking', 'visibility', 'more']);
  // Below 1024px the folded two are hidden and More stands in; from 1024px it is the other way round.
  for (const slug of ['thinking', 'visibility']) {
    assert.match(html, new RegExp(`data-testid="link-zone-${slug}" class="hidden lg:inline-flex `), slug);
  }
  for (const slug of ['overview', 'profile', 'services', 'proof']) {
    assert.match(html, new RegExp(`data-testid="link-zone-${slug}"[^>]*class="inline-flex min-h-\\[44px\\] `), slug);
  }
  assert.match(html, /<button type="button" class="inline-flex min-h-\[44px\][^"]*lg:hidden[^"]*"[^>]*aria-expanded="false"[^>]*data-testid="link-zone-more">More<span aria-hidden="true">▾<\/span>/);
  assert.match(html, /data-testid="link-zone-overview" aria-current="page"/, 'the Overview is current on the root');
});

test('More opens the folded sections as 44px rows, and a folded section that is current names itself', async () => {
  // Mutation checked: the button's onClick removed → no panel.
  const bucket = bucketForPath('advisor', '/expertise/thinking');
  const f = await mountForm(h(ZoneNav, { bucket, role: 'advisor', activeSlug: 'thinking' }));
  try {
    const more = f.by('link-zone-more');
    assert.match(textOf(more), /^More: Thinking▾$/, 'the button says where you are');
    assert.equal(f.by('zone-nav-more-panel'), undefined);
    await act(async () => f.props(more).onClick());
    assert.equal(f.props(f.by('link-zone-more'))['aria-expanded'], true);
    const panel = f.by('zone-nav-more-panel');
    assert.equal(f.props(more)['aria-controls'], f.props(panel).id);
    const thinking = f.by('link-zone-more-thinking');
    // aria-current comes from NavLink matching the URL (the route is /expertise/thinking in the app).
    assert.match(textOf(thinking), /^ThinkingCurrent$/);
    assert.equal(f.props(thinking).href, '/expertise/thinking');
    assert.match(f.props(thinking).className, /min-h-\[44px\]/);
    assert.ok(f.by('link-zone-more-visibility'));
  } finally { await f.unmount(); }
});

test('the Practice row and every bucket without a `more` are unchanged', () => {
  const html = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/practice/earnings'] },
    h(ZoneNav, { bucket: bucketForPath('advisor', '/practice/earnings'), role: 'advisor' })));
  assert.doesNotMatch(html, /link-zone-more|zone-nav-more/);
});

// ─────────────────────────────────────────── EX-04a, EX-16: layout and focus

test('a tablet shows proof cards two a row; a phone gets single-column forms and full-width primary actions', () => {
  assert.match(zoneSrc('ProofZone.jsx'), /className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 lg:grid-cols-1" data-testid="advisor-proof-cards"/);
  assert.match(zoneSrc('ProfileZone.jsx'), /<form onSubmit=\{save\} className="grid grid-cols-1 gap-3 sm:grid-cols-2">/);
  assert.match(zoneSrc('ProfileZone.jsx'), /className=\{`\$\{buttonClass\} w-full sm:w-auto`\}/);
  assert.match(zoneSrc('ServicesZone.jsx'), /className=\{`\$\{buttonClass\} w-full sm:w-auto`\}/);
});

test('buttons show keyboard focus and are 44px targets on a phone; the meter respects reduced motion', () => {
  // Mutation checked: FOCUS_TARGET emptied → both class checks fail.
  for (const cls of [buttonClass, ghostButtonClass]) {
    assert.match(cls, /focus-visible:outline focus-visible:outline-2/);
    assert.match(cls, /min-h-\[44px\] lg:min-h-0/);
  }
  assert.match(zoneSrc('ProfileZone.jsx'), /transition-all motion-reduce:transition-none/);
  assert.match(zoneSrc('ProofZone.jsx'), /min-h-\[44px\][^"]*focus-visible:outline[^"]*lg:min-h-\[32px\]/, 'the destructive button too');
});

test('the destructive confirmation names the third-party data that goes with the claim', () => {
  // EX-14's "Its 1 confirmation request goes too, including R. Haddad's name and email": already in place (D4681).
  const model = zoneSrc('expertiseModel.js');
  assert.match(model, /names, emails and statements/);
  assert.match(model, /It cannot be undone\./);
});
