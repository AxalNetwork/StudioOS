/**
 * D702 (#1664). PR 1 — the three /account visibility labels say what the
 * Worker does. PR 2 — the four profile pages, their routes and menus, and the
 * archetype card on a phone (tests 9 to 13, numbered as the issue numbers
 * them). Widths are a `matchMedia` stub on `window`, as D701's tests do:
 * `usePhoneWidth` seeds its state from it on the first render.
 *
 * PR 1's notes:
 *
 * Copy that promises a behaviour must be true (decision D-s). The Worker now
 * enforces the stored value on GET /api/public/u/:handle and on the founder
 * cards of GET /api/public/startup/:handle (services/userSettings.ts
 * `visibleToViewer`):
 *
 *   public  → anyone with the address
 *   network → signed-in members only
 *   private → the owner only (not "admins only": no admin arm exists)
 *
 * so the labels name those three audiences, and the old three — which promised
 * an admin audience the read never had and a "network" the read never checked —
 * are gone. The /docs Privacy how-to says the same and says what "not chosen"
 * means (Public), because a stored 'network' nobody chose is served as Public.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { escapeRe } from './_escapeRe.mjs';
import { EadwynMenu, PROFILE_ROWS_LIVE } from '../src/pages/founder/EadwynMenu.jsx';
import ProfileFrame from '../src/pages/profile/ProfileFrame.jsx';
import YouPage, { YouView, COFOUNDER_EDITOR, PROFILE_EDITOR, safeLink } from '../src/pages/profile/YouPage.jsx';
import VenturePage, { VentureView, VentureForm, MODULES_NOTE, NO_VENTURE } from '../src/pages/profile/VenturePage.jsx';
import PreviewPage, { PreviewView } from '../src/pages/profile/PreviewPage.jsx';
import VisibilityPage, { VisibilityView, MATCHING_SUB, FINDABLE_SUB } from '../src/pages/profile/VisibilityPage.jsx';
import { PROFILE_PAGES, NOT_CHOSEN_LINE, figureView, profileLinks, ventureChanges, ventureDraft } from '../src/pages/profile/profileModel.js';
import { PhoneArchetypePage, PUBLISHED_SUB, PHONE_TITLE, PHONE_SUB } from '../src/pages/ArchetypeCardPage.jsx';
import { archetypeMeta } from '../src/lib/assessmentMeta.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/SettingsPage.jsx'));
const DOCS = read('frontend/src/pages/docs/sections/account.js');
const WORKER = codeOnly(read('cloudflare-worker/src/services/userSettings.ts'));

function privacyCard() {
  const a = PAGE.indexOf('function PrivacyCoreCard(');
  assert.ok(a >= 0, 'PrivacyCoreCard is gone');
  const b = PAGE.indexOf('\nfunction ', a + 1);
  return PAGE.slice(a, b > a ? b : undefined);
}

test('the three options carry the D702 labels, one per stored value', () => {
  const card = privacyCard();
  const options = [...card.matchAll(/<option value="(\w+)">([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(options, [
    ['public', 'Public — anyone with the address'],
    ['network', 'Members only — signed-in Axal VC members'],
    ['private', 'Hidden — only you'],
  ]);
});

test('the old labels are gone from the page', () => {
  for (const old of ['anyone with the link', 'Network only — Axal VC members', 'Private — admins only']) {
    assert.ok(!PAGE.includes(old), `still says "${old}"`);
  }
});

test('a change sends only the field that changed, so a toggle never stamps a visibility choice', () => {
  const card = privacyCard();
  assert.match(card, /api\.updatePrivacySettings\(delta\)/);
  assert.doesNotMatch(card, /api\.updatePrivacySettings\(next\)/);
});

test('the labels are the audiences the Worker enforces', () => {
  // public: anyone; network: any signed-in viewer; private: the owner only.
  assert.match(WORKER, /export function visibleToViewer\(/);
  assert.match(WORKER, /'public'[\s\S]{0,80}return true/);
  assert.match(WORKER, /viewerId\s*!=\s*null/);
  assert.match(WORKER, /Number\(viewerId\)\s*===\s*Number\(ownerUserId\)/);
});

test('the /docs Privacy how-to uses the same three words and says what "not chosen" means', () => {
  assert.ok(DOCS.includes('Public (anyone with the address) / Members only (signed-in Axal VC members) / Hidden (only you)'));
  assert.ok(DOCS.includes('Until you choose, your profile is public.'));
  assert.ok(!DOCS.includes('Network only'));
});

// ===========================================================================
// PR 2 — the pages
// ===========================================================================

const h = React.createElement;
const APP = codeOnly(read('frontend/src/App.jsx'));
const SMP = read('design/canvases/integrated/Studio Mobile Page.dc.html');
const noop = () => {};
const ready = (data) => ({ status: 'ready', data, error: null, reload: noop, set: noop });
const LOADING = { status: 'loading', data: null, error: null, reload: noop, set: noop };

/** A `matchMedia` for a viewport `width` px wide: it answers `(max-width: Npx)`. */
const mediaAt = (width) => (query) => {
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  return { matches: Boolean(max) && width <= Number(max[1]), addEventListener() {}, removeEventListener() {} };
};
function atWidth(width, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const original = globalThis.window;
  try { globalThis.window = { matchMedia: mediaAt(width) }; return fn(); } finally {
    if (had) globalThis.window = original; else delete globalThis.window;
  }
}
const html = (el, path = '/profile') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
const text = (m) => m.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const hrefs = (m) => [...m.matchAll(/<a [^>]*href="([^"]*)"/g)].map((x) => x[1].replace(/&amp;/g, '&'));

// --- 9. Routes --------------------------------------------------------------

test('9. the three /profile/* lines are founders only; /profile is You for a founder and the redirect for anyone else', () => {
  for (const [path, page] of [['/profile/venture', 'VenturePage'], ['/profile/preview', 'ProfilePreviewPage'], ['/profile/visibility', 'VisibilityPage']]) {
    assert.match(APP, new RegExp(`<Route path="${escapeRe(path)}" element=\\{guard\\(\\['founder'\\], <${page} \\/>\\)\\} \\/>`), path);
  }
  assert.match(APP, /<Route path="\/profile" element=\{effectiveRole === 'founder' \? guard\(\['founder'\], <YouPage \/>\) : <SettingsRedirect \/>\} \/>/);
  // The redirect still carries the query and the hash.
  assert.match(APP, /pathname: '\/account', search: loc\.search, hash: loc\.hash/);
});

test('9. the desktop "Your profile" row is above Account, for founders only', () => {
  const menu = APP.slice(APP.indexOf('function UserDropdown('), APP.indexOf('function UserDropdown(') + 6000);
  assert.match(menu, /\{user\?\.role === 'founder' && \(\s*<Link to="\/profile"[\s\S]{0,260}?role="menuitem">\s*Your profile\s*<\/Link>\s*\)\}\s*<Link to="\/account"/);
});

// --- 10. The pages at 1440 and 390 -------------------------------------------

const PAGES = [
  ['you', YouPage, '/profile'],
  ['venture', VenturePage, '/profile/venture?project_id=7'],
  ['preview', PreviewPage, '/profile/preview?project_id=7'],
  ['visibility', VisibilityPage, '/profile/visibility?project_id=7'],
];

test('10. each page draws the canvas title and sub at 1440 and at 390, and at 390 "‹ Studio" and the Eadwyn menu button', () => {
  for (const [key, Page, path] of PAGES) {
    const { title, sub } = PROFILE_PAGES[key];
    // The copy is the canvas's, byte for byte.
    assert.ok(SMP.includes(`title: '${title}', sub: '${sub.replace('’', '\\u2019')}'`) || SMP.includes(`title: '${title}', sub: '${sub}'`), `${key}: not the canvas's copy`);
    const wide = atWidth(1440, () => html(h(Page), path));
    assert.match(wide, /data-testid="profile-desktop"/, key);
    assert.ok(text(wide).includes(`‹ Studio ${title} ${sub}`), `${key} at 1440: ${text(wide).slice(0, 120)}`);
    assert.doesNotMatch(wide, /Open the Eadwyn menu/);
    const narrow = atWidth(390, () => html(h(Page), path));
    assert.match(narrow, /data-testid="profile-phone"/, key);
    assert.ok(text(narrow).includes(`‹ Studio ${title} ${sub}`), `${key} at 390`);
    assert.match(narrow, /aria-label="Open the Eadwyn menu"/, key);
    assert.match(narrow, /<a [^>]*href="\/studio"[^>]*>‹ Studio<\/a>/, `${key}: Back goes to /studio`);
  }
  // The venture's sub keeps its U+2019.
  assert.equal(PROFILE_PAGES.venture.sub, 'Your company’s public facts.');
});

// --- 11. Behaviour --------------------------------------------------------------

const PRIVACY = {
  visibility: 'public', visibility_chosen: false, show_in_directory: true, discoverable: false, matching_opt_in: true,
  profile_completion_pct: 72, matching_min_pct: 60, matching_eligible: true, project_id: 7, investor_findable: true,
};

async function mountVisibility(props) {
  globalThis.matchMedia = mediaAt(1440);
  return mountContracts(h(VisibilityView, { privacy: ready(PRIVACY), published: ready({ published: true }), hasVenture: true, write: async () => ({}), ...props }), '/profile/visibility');
}
const switchOf = (view, id) => view.nodes().find((n) => n.tagName === 'BUTTON' && view.props(n)?.role === 'switch'
  && view.props(n)['aria-labelledby'] === `visibility-${id}-label`);

test('11. each toggle calls its write on change, with the field it governs', async () => {
  const calls = [];
  const view = await mountVisibility({ write: async (k, v) => { calls.push([k, v]); return {}; } });
  try {
    for (const id of ['directory', 'matching', 'findable', 'archetype']) {
      const sw = switchOf(view, id);
      assert.ok(sw, `no ${id} switch`);
      await act(async () => { view.props(sw).onClick(); });
    }
    assert.deepEqual(calls, [['show_in_directory', false], ['matching_opt_in', false], ['investor_findable', false], ['archetype_published', false]]);
  } finally { await view.unmount(); }
});

test('11. the matching refusal shows inline, the row carries its sub, and a blocked toggle says why', async () => {
  const refusal = Object.assign(new Error('Complete at least 60% of your profile before opting into matching.'),
    { status: 400, field: 'matching_opt_in', data: { errors: { matching_opt_in: 'Profile is 40% complete (need 60%).' } } });
  const view = await mountVisibility({
    privacy: ready({ ...PRIVACY, matching_opt_in: false, matching_eligible: true }),
    write: async () => { throw refusal; },
  });
  try {
    await act(async () => { view.props(switchOf(view, 'matching')).onClick(); });
    const t = view.text();
    assert.ok(t.includes('Appear in co-founder matching' + MATCHING_SUB), 'the row carries its sub');
    assert.ok(t.includes('Complete at least 60% of your profile before opting into matching. Profile is 40% complete (need 60%).'), 'the refusal shows inline');
    assert.equal(view.props(switchOf(view, 'matching'))['aria-checked'], 'false', 'a refused write rolls back');
  } finally { await view.unmount(); }
  assert.equal(MATCHING_SUB, 'Also member introductions and best-fit matches');
  const blocked = html(h(VisibilityView, { privacy: ready({ ...PRIVACY, matching_opt_in: false, matching_eligible: false, profile_completion_pct: 40 }), published: ready({ published: false }), hasVenture: true, write: noop }));
  assert.match(text(blocked), /Complete at least 60% of your profile to turn this on \(currently 40%\)\./);
  assert.match(blocked, /aria-checked="false" aria-labelledby="visibility-matching-label" disabled=""/);
});

test('11. the radios show the effective visibility, and the "not chosen" line shows only while nothing was chosen', () => {
  const never = html(h(VisibilityView, { privacy: ready(PRIVACY), published: ready({ published: true }), hasVenture: true, write: noop }));
  assert.match(never, /checked="" value="public"/);
  assert.doesNotMatch(never, /checked="" value="network"/, 'Members only is not preselected');
  assert.ok(text(never).includes(NOT_CHOSEN_LINE));
  assert.equal(NOT_CHOSEN_LINE, 'You have not chosen yet, so your profile is public.');
  const chosen = html(h(VisibilityView, { privacy: ready({ ...PRIVACY, visibility: 'network', visibility_chosen: true }), published: ready({ published: true }), hasVenture: true, write: noop }));
  assert.match(chosen, /checked="" value="network"/);
  assert.ok(!text(chosen).includes(NOT_CHOSEN_LINE));
  // The canvas's words, the reworded archetype row, and the investor toggle drawn on until chosen.
  const t = text(never);
  assert.match(t, /Public Anyone with the address .*Members only Signed-in Axal VC members .*Hidden Only you/);
  assert.match(t, /Show my archetype to members/);
  assert.doesNotMatch(t, /Show my archetype on my profile/);
  assert.match(t, new RegExp(`Let investors find my venture ${FINDABLE_SUB}`));
  assert.match(never, /aria-checked="true" aria-labelledby="visibility-findable-label"/);
  // With no venture the investor toggle is off, disabled and says why.
  const none = html(h(VisibilityView, { privacy: ready(PRIVACY), published: ready({ published: true }), hasVenture: false, write: noop }));
  assert.match(none, /aria-checked="false" aria-labelledby="visibility-findable-label" disabled=""/);
  assert.ok(text(none).includes(NO_VENTURE));
});

const PREVIEW = {
  audience: 'investors',
  card: { person_name: 'Sam Example', venture_name: 'Testventure Labs', sector: 'Fintech', archetype: { slug: 'missionary', label: 'The Missionary' } },
  figures: [
    { key: 'mrr', label: 'MRR', display: 'masked', value: null },
    { key: 'revenue', label: 'Revenue', display: 'value', value: 12000 },
    { key: 'raise', label: 'Raise', display: 'value', value: null },
  ],
  notes: ['Revenue is on your public venture page, for anyone with its address.', 'In the app, figures stay masked until an NDA is signed through an introduction.'],
  addresses: {
    profile: { url: 'https://axal.vc/u/u-abc', served_to: 'everyone', reason: 'Your profile is public.' },
    venture: { url: 'https://axal.vc/startups/p-xyz', served_to: 'no_one', reason: 'Your venture page is not public while the venture is in intake.' },
  },
};

test('11. the preview draws a value, "••••" or no row as the read says, and never an Interviews row', () => {
  const m = html(h(PreviewView, { read: ready(PREVIEW), audience: 'investors' }), '/profile/preview');
  const t = text(m);
  assert.match(t, /As investors see you Sam Example · Founder of Testventure Labs The Missionary Fintech/);
  assert.match(t, /Figures MRR •••• Revenue \$12,000 Raise Not recorded/);
  assert.doesNotMatch(t, /Users/, 'a field no read serves draws no row');
  assert.doesNotMatch(t, /Interviews/);
  for (const n of PREVIEW.notes) assert.ok(t.includes(n), n);
  assert.match(t, /axal\.vc\/u\/u-abc Your profile · Served to everyone\. Your profile is public\. Copy/);
  assert.match(t, /axal\.vc\/startups\/p-xyz Your venture · Served to no one\. Your venture page is not public while the venture is in intake\./);
  assert.deepEqual(figureView([{ key: 'users', label: 'Users', display: 'value', value: 1500 }]).map((r) => r.value), ['1,500']);
  // Without an archetype the read lists, no chip.
  const plain = text(html(h(PreviewView, { read: ready({ ...PREVIEW, card: { ...PREVIEW.card, archetype: null } }), audience: 'founders' })));
  assert.match(plain, /As founders see you Sam Example · Founder of Testventure Labs Fintech Figures/);
  // The tabs are a tablist, the open one selected, and the page keeps ?audience=.
  const page = atWidth(1440, () => html(h(PreviewPage), '/profile/preview?project_id=7&audience=partners'));
  assert.match(page, /role="tablist" aria-label="Audience"/);
  assert.match(page, /role="tab" aria-selected="true"[^>]*>Partners</);
  assert.equal([...page.matchAll(/role="tab"/g)].length, 3);
});

test('11. Copy writes the full https:// address', async () => {
  const written = [];
  globalThis.matchMedia = mediaAt(1440);
  const view = await mountContracts(h(PreviewView, { read: ready(PREVIEW), audience: 'investors' }), '/profile/preview');
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => { written.push(t); } } }, configurable: true });
  try {
    const row = view.nodes().find((n) => view.props(n)?.['data-testid'] === 'preview-address-profile');
    await act(async () => { await view.props(row).onClick(); });
    assert.deepEqual(written, ['https://axal.vc/u/u-abc']);
    assert.match(view.text(), /Copied/);
  } finally {
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
    await view.unmount();
  }
});

const VENTURE = {
  project_id: 7,
  card: { name: 'Testventure Labs', description: 'Ledgers for small clinics.', sector: 'Fintech', stage: { id: 'validate', label: 'Validate' } },
  problem_statement: 'Clinics reconcile by hand.',
  facts: { founded_year: 2025, hq: 'Sampleton', employee_count: null, website: 'https://testventure.example' },
  modules: [
    { key: 'interviews', label: 'Interviews', sub: 'Validate · Customer research', value: '12', state: 'ok', reason: null },
    { key: 'hypotheses_supported', label: 'Hypotheses supported', sub: 'Validate · Experiments and evidence', value: '3 of 7', state: 'ok', reason: null },
    { key: 'waitlist_signups', label: 'Waitlist sign-ups', sub: 'Validate · Demand and urgency signals', value: null, state: 'empty', reason: 'No waitlist sign-up yet' },
    { key: 'mrr', label: 'MRR', sub: 'Grow · no MRR recorded yet', value: null, state: 'empty', reason: 'Not recorded' },
  ],
};

test('11. Your venture draws its card, facts and module rows, and Edit saves only what changed through saveVenture', async () => {
  const t = text(html(h(VentureView, { read: ready(VENTURE), onEdit: noop }), '/profile/venture'));
  assert.match(t, /Venture Edit Testventure Labs Ledgers for small clinics\. Fintech Validate/);
  assert.match(t, /Facts Edit Founded 2025 Location Sampleton Team Not recorded Website https:\/\/testventure\.example/);
  assert.match(t, /Read from your modules Interviews Validate · Customer research 12 Hypotheses supported Validate · Experiments and evidence 3 of 7/);
  assert.match(t, /MRR Grow · no MRR recorded yet Not recorded/);
  assert.ok(t.includes(MODULES_NOTE));
  assert.doesNotMatch(t, /no revenue source connected/);
  // The form sends only the changed fields, Founded as a number and an emptied one as null.
  const before = ventureDraft(VENTURE);
  assert.deepEqual(ventureChanges(before, { ...before, founded_year: '2024', hq: '' }), { founded_year: 2024, hq: null });
  assert.deepEqual(ventureChanges(before, before), {});
  // Saving, through the page's own wiring.
  assert.match(codeOnly(read('frontend/src/pages/profile/VenturePage.jsx')), /save=\{\(changes\) => profileApi\.saveVenture\(pid, changes\)\}/);
  const saved = [];
  globalThis.matchMedia = mediaAt(1440);
  const view = await mountContracts(h(VentureForm, { venture: VENTURE, onClose: noop, onSaved: (v) => saved.push(v), save: async (c) => { saved.push(c); return VENTURE; } }), '/profile/venture');
  try {
    const input = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.value === 'Sampleton');
    await act(async () => { view.props(input).onChange({ target: { value: 'Exampletown' } }); });
    const form = view.nodes().find((n) => n.tagName === 'FORM');
    await act(async () => { await view.props(form).onSubmit({ preventDefault() {} }); });
    assert.deepEqual(saved[0], { hq: 'Exampletown' });
  } finally { await view.unmount(); }
});

const ME = {
  person: { name: 'Sam Example', role_line: 'Founder · Sampleton' },
  bio: 'Building ledgers for small clinics.',
  background: { experience: [{ line: 'CTO at Exampleco', period: '2019 – 2023' }], education: [{ line: 'BSc, Sample University', year: '2018' }] },
  links: [
    { key: 'linkedin', label: 'LinkedIn', url: 'https://linkedin.com/in/sam-example' },
    { key: 'website', label: 'Website', url: 'javascript:alert(1)' },
    { key: 'github', label: 'GitHub', url: null },
  ],
  preferences: { recorded: true, looking_for: 'CTO', commitment: 'full_time', commitment_label: 'Full-time', location: 'Sampleton · remote' },
};

test('11. You draws its stores, and each Edit opens the editor that owns the data', () => {
  const m = html(h(YouView, { me: ready(ME), fit: LOADING }));
  const t = text(m);
  assert.match(t, /SE Sam Example Founder · Sampleton Edit Bio Edit Building ledgers/);
  assert.match(t, /Background Edit CTO at Exampleco 2019 – 2023 BSc, Sample University 2018/);
  assert.match(t, /GitHub No link added yet Not recorded/);
  assert.match(t, /Founder preferences Edit Looking for a co-founder CTO Commitment Full-time Location Sampleton · remote/);
  const links = hrefs(m);
  assert.equal(links.filter((x) => x === PROFILE_EDITOR).length, 4, 'person, Bio, Background and Links edit at /account/profile');
  assert.ok(links.includes(COFOUNDER_EDITOR));
  assert.equal(COFOUNDER_EDITOR, '/build/team?mode=workspace&tab=cofounder');
  assert.equal(links.filter((x) => x === 'https://linkedin.com/in/sam-example').length, 1, 'the LinkedIn link is drawn once');
  // Every href's scheme, read by the URL parser (relative ones resolve against
  // the site), so no casing or leading space can hide a script scheme.
  const scheme = (x) => { try { return new URL(x, 'https://axal.vc').protocol; } catch { return null; } };
  assert.deepEqual(links.filter((x) => !['http:', 'https:'].includes(scheme(x))), [], 'a member-typed link that is not http(s) is never an href');
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'vbscript:msgbox(1)']) assert.equal(safeLink(bad), null, bad);
  // No co-founder profile reads Not recorded with its reason.
  const none = text(html(h(YouView, { me: ready({ ...ME, preferences: { recorded: false, reason: 'No co-founder profile yet' } }), fit: LOADING })));
  assert.match(none, /Founder preferences Edit Founder preferences No co-founder profile yet Not recorded/);
});

test('11. the desktop link row keeps project_id on its venture links, and adds none without it', () => {
  const kept = atWidth(1440, () => html(h(ProfileFrame, { page: PROFILE_PAGES.venture }, 'BODY'), '/profile/venture?project_id=7'));
  assert.deepEqual(hrefs(kept).slice(1), ['/profile', '/profile/venture?project_id=7', '/studio/archetype', '/profile/preview?project_id=7', '/profile/visibility?project_id=7']);
  assert.match(kept, /aria-current="page"[^>]*>Your venture</);
  const bare = atWidth(1440, () => html(h(ProfileFrame, { page: PROFILE_PAGES.venture }, 'BODY'), '/profile/venture'));
  assert.deepEqual(hrefs(bare).slice(1), ['/profile', '/profile/venture', '/studio/archetype', '/profile/preview', '/profile/visibility']);
  assert.deepEqual(profileLinks('').map((l) => l.title), ['You', 'Your venture', 'Archetype card', 'What others see', 'Visibility']);
});

// --- 12. The archetype card on a phone ------------------------------------------------

const ARCH = (role) => {
  const meta = archetypeMeta('fo_missionary');
  return h(PhoneArchetypePage, {
    activeRole: role, latest: { slug: 'fo_missionary', label: meta?.label || 'The Missionary', confidence: 0.82 }, meta, sex: 'f', pct: 82,
    title: meta?.label || 'The Missionary', accent: meta?.accent || '#7c3aed', licence: 'Founder',
    xp: { state: 'loading', data: null }, onRetryXp: noop, publish: { state: 'ready', published: true, saving: false, saveFailed: false },
    onTogglePublish: noop, onRetryPublish: noop, states: null, sections: null,
  });
};

test('12. at 390 the card draws PhoneBar, the 4:3 banner with its tagline, and the published row\'s true sub', () => {
  const m = html(ARCH('founder'), '/studio/archetype');
  assert.ok(text(m).includes(`‹ Studio ${PHONE_TITLE} ${PHONE_SUB}`));
  assert.match(m, /class="acp-hero acp-hero-phone"/);
  assert.match(m, /<img src="\/archetypes\/banners\/[^"]+\.webp"/);
  assert.match(m, /class="acp-fade"/);
  const meta = archetypeMeta('fo_missionary');
  assert.match(m, new RegExp(`data-testid="archetype-tagline">${escapeRe(meta.tagline)}<`));
  const row = text(m.slice(m.indexOf('data-testid="archetype-published-row"')));
  assert.ok(row.includes(PUBLISHED_SUB));
  assert.doesNotMatch(row, /tagline/);
  assert.match(text(m), /Core approach .*Description .*Strengths .*Blind spots .*Complements .*Shown to members Published/);
  assert.match(m, /aria-label="Open the Eadwyn menu"/, 'a founder\'s bar has the menu');
  assert.doesNotMatch(html(ARCH('investor')), /Open the Eadwyn menu/, 'an investor\'s has none');
  // Desktop is unchanged: 21:9, and the well draws no gradient.
  const src = read('frontend/src/pages/ArchetypeCardPage.jsx');
  assert.match(src, /\.acp-hero \{[^}]*aspect-ratio: 21 \/ 9;/);
  assert.doesNotMatch(src.slice(src.indexOf('.acp-well {'), src.indexOf('}', src.indexOf('.acp-well {'))), /gradient/);
  assert.match(codeOnly(src), /if \(phone\) \{\s*return \(\s*<PhoneArchetypePage/);
});

// --- 13. The menus ------------------------------------------------------------------

test('13. with PROFILE_ROWS_LIVE the Eadwyn menu holds nine links, the venture ones keeping project_id', () => {
  assert.equal(PROFILE_ROWS_LIVE, true);
  const m = html(h(EadwynMenu, { open: true, onClose: noop, active: '/profile/venture' }), '/profile/venture?project_id=7');
  const links = hrefs(m);
  assert.equal(links.length, 9);
  assert.deepEqual(links.slice(4), ['/profile', '/profile/venture?project_id=7', '/studio/archetype', '/profile/preview?project_id=7', '/profile/visibility?project_id=7']);
  assert.match(m, /<a aria-current="page"[^>]*href="\/profile\/venture\?project_id=7"/);
  // Each reaches a mounted page for a founder.
  for (const route of ['/profile', '/profile/venture', '/profile/preview', '/profile/visibility', '/studio/archetype']) {
    assert.ok(APP.includes(`<Route path="${route}"`), route);
  }
});
