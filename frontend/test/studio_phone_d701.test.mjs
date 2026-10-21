/**
 * D701 (#1663) — on a phone, Studio is Eadwyn. PR 1: the read, one breakpoint,
 * the tab in the URL and the ticket route, at every width.
 *
 *   8. the client calls the one new read;
 *   9. one breakpoint, 1024px, in a module a test can import;
 *  10. `?tab=` at every width, written with a replace and keeping the rest;
 *  11. `/studio/tickets/new`, `?type=`, `project_id` kept, and the collapse.
 * PR 2: the phone page.
 *  12. the bar, the no-advisor line, and no zone below 1024px;
 *  13. the drawer: its links, `project_id`, the current row and closing;
 *  14. the Conversations list, the viewer's day, and read-only transcripts;
 *  15. the composer;
 *  16. Tasks: the focus chips, the buckets and the suggestions;
 *  17. My tickets;
 *  18. the ticket card;
 *  19. the collapsed interview keeps the list.
 *
 * `PersonalAdvisor`, `StudioInterview` and `FounderStudioHome` reach
 * `lib/advisor/router.js`, which a Node test cannot import, so their wiring is
 * pinned in the source through `codeOnly`, as the D324 and D606 tests pin it.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/studio_phone_d701.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { mountContracts } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import {
  BUCKET_PREVIEW, PhoneBuckets, PhoneFocus, PhoneTicketCard, threadLabel, useIsDesktop,
} from '../src/components/advisor/eadwynPhone.jsx';
import { PanelTabs, TasksPanelView, TicketsPanelView } from '../src/components/advisor/EadwynPanels.jsx';
import {
  STUDIO_PATH, STUDIO_TICKET_PATH, conversationRows, searchWithTab, studioTabOf, ticketTypeOf, withProjectId,
} from '../src/pages/founder/studioPhoneModel.js';
import StudioPhone, {
  ConversationsList, NO_ADVISOR, StudioConversations, TranscriptSheet,
} from '../src/pages/founder/StudioPhone.jsx';
import { EADWYN_MENU, EadwynMenu, PROFILE_ROWS_LIVE } from '../src/pages/founder/EadwynMenu.jsx';

const h = React.createElement;
const read = (rel) => readFileSync(resolve(rel), 'utf8');
const ADVISOR = codeOnly(read('frontend/src/components/advisor/PersonalAdvisor.jsx'));
const INTERVIEW = codeOnly(read('frontend/src/components/advisor/StudioInterview.jsx'));
const HOME = codeOnly(read('frontend/src/pages/founder/FounderStudioHome.jsx'));

/** A `matchMedia` for a viewport `width` px wide: it answers `(max-width: Npx)`. */
const mediaAt = (width) => (query) => {
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  return { matches: Boolean(max) && width <= Number(max[1]), addEventListener() {}, removeEventListener() {} };
};

function withWindow(win, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const original = globalThis.window;
  try {
    if (win === undefined) delete globalThis.window; else globalThis.window = win;
    return fn();
  } finally {
    if (had) globalThis.window = original; else delete globalThis.window;
  }
}

test('8. the client calls GET /eadwyn/conversations/mine, with no id and no parameter', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url).replace(/^.*\/api/, '')]);
    return new Response('{"conversations":[],"unreadable":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { eadwynApi } = await import('../src/lib/api/eadwyn.js');
    assert.equal(eadwynApi.conversationsMine.length, 0, 'the read takes no argument');
    await eadwynApi.conversationsMine();
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(calls, [['GET', '/eadwyn/conversations/mine']]);
  // The Worker has the route, ahead of `/conversations/:uid` (test:drift checks the mount).
  const worker = read('cloudflare-worker/src/routes/eadwyn.ts');
  const mine = worker.indexOf("eadwyn.get('/conversations/mine'");
  assert.ok(mine > 0, 'the Worker route');
  assert.ok(mine < worker.indexOf("eadwyn.get('/conversations/:uid'"), 'registered before /conversations/:uid');
});

test('9. one breakpoint: the chat is a phone below 1024px, and desktop with no window', () => {
  const Probe = () => h('span', null, useIsDesktop() ? 'desktop' : 'phone');
  const render = () => renderToStaticMarkup(h(Probe));
  assert.match(withWindow({ matchMedia: mediaAt(900) }, render), />phone</);
  assert.match(withWindow({ matchMedia: mediaAt(1023) }, render), />phone</);
  assert.match(withWindow({ matchMedia: mediaAt(1024) }, render), />desktop</);
  assert.match(withWindow({ matchMedia: mediaAt(800) }, render), />phone</, '768–1023px is a phone now');
  assert.match(withWindow(undefined, render), />desktop</, 'a server render is desktop');
  assert.match(ADVISOR, /import \{[^}]*\buseIsDesktop\b[^}]*\} from '\.\/eadwynPhone';/);
  assert.doesNotMatch(ADVISOR, /function useIsDesktop\(/, 'the chat keeps its own hook');
  assert.doesNotMatch(ADVISOR, /innerWidth >= 768/);
  // The module a test imports reaches nothing that imports the banks manifest.
  const phone = read('frontend/src/components/advisor/eadwynPhone.jsx');
  for (const m of phone.matchAll(/^import .* from '([^']+)';$/gm)) {
    assert.doesNotMatch(m[1], /advisor\/router|PersonalAdvisor|StudioInterview|FounderStudioHome|AdvisorProgressWidget/, m[1]);
  }
});

test('10. ?tab= picks the panel tab at every width, and a change replaces it keeping the rest', () => {
  assert.equal(studioTabOf('?tab=tasks'), 'tasks');
  assert.equal(studioTabOf('?tab=tickets'), 'tickets');
  assert.equal(studioTabOf(''), 'conversation');
  assert.equal(studioTabOf('?tab=conversations'), 'conversation');
  assert.equal(studioTabOf('?tab=bogus'), 'conversation');
  assert.equal(studioTabOf('?project_id=7&tab=tickets'), 'tickets');
  assert.equal(searchWithTab('?project_id=7', 'tasks'), '?project_id=7&tab=tasks');
  assert.equal(searchWithTab('?tab=tasks&project_id=7', 'tickets'), '?tab=tickets&project_id=7');
  assert.equal(searchWithTab('?tab=tasks&project_id=7', 'conversation'), '?project_id=7', 'Conversation removes ?tab=');
  assert.equal(searchWithTab('?tab=tasks', 'conversation'), '');

  const tabs = renderToStaticMarkup(h(PanelTabs, { tab: 'tasks', onTab() {} }));
  assert.match(tabs, /aria-selected="true"[^>]*data-testid="eadwyn-tab-tasks"/);
  assert.match(tabs, /aria-selected="false"[^>]*data-testid="eadwyn-tab-conversation"/);

  // The founder's home passes the URL's tab, and writes a change with a replace.
  assert.match(HOME, /const tab = studioTabOf\(search\);/);
  assert.match(HOME, /const onTab = \(next\) => navigate\(\{ pathname, search: searchWithTab\(search, next\) \}, \{ replace: true \}\);/);
  assert.match(HOME, /\n\s+tab=\{tab\}\n\s+onTab=\{onTab\}\n/);
  assert.match(INTERVIEW, /\n\s+tab=\{tab\}\n\s+onTab=\{onTab\}\n/, 'StudioInterview passes the tab on');
  // The chat reads `tab` over its own state; every change goes through `onTab`.
  assert.match(ADVISOR, /const panelTab = tab \?\? ownPanelTab;/);
  assert.match(ADVISOR, /const setPanelTab = onTab \?\? setOwnPanelTab;/);
  assert.doesNotMatch(ADVISOR, /const \[panelTab, setPanelTab\] = useState/);
  assert.match(ADVISOR, /if \(!isDesktop\) setPanelTab\('conversation'\);\n\s+\}, \[isDesktop, setPanelTab\]\);/, 'Start returns to Conversation through the URL');
  assert.match(ADVISOR, /onPanelTab=\{setPanelTab\}/, 'the fullscreen tabs go through the URL');
  assert.equal((ADVISOR.match(/setOwnPanelTab/g) || []).length, 2, 'nothing writes the local tab around onTab');
});

test('11. /studio/tickets/new is the founder\'s ticket form, on ?type=, keeping project_id', () => {
  const app = read('frontend/src/App.jsx');
  const line = '<Route path="/studio/tickets/new" element={guard([\'founder\'], <Dashboard activeRole={effectiveRole} authUser={user} />)} />';
  assert.equal(app.split(line).length - 1, 1, 'one /studio/tickets/new line, guarded founder');
  assert.ok(app.indexOf(line) > app.indexOf('<Route path="/studio" element='), 'beside /studio');
  assert.equal(STUDIO_PATH, '/studio');
  assert.equal(STUDIO_TICKET_PATH, '/studio/tickets/new');

  assert.equal(ticketTypeOf('?type=task'), 'task');
  assert.equal(ticketTypeOf('?type=bug'), 'bug');
  assert.equal(ticketTypeOf('?type=feature'), 'feature');
  assert.equal(ticketTypeOf('?type=other'), null);
  assert.equal(ticketTypeOf(''), null, 'no default type (D544)');

  assert.equal(withProjectId('/studio?tab=tasks', '?project_id=7'), '/studio?tab=tasks&project_id=7');
  assert.equal(withProjectId('/studio', '?project_id=7&tab=tasks'), '/studio?project_id=7');
  assert.equal(withProjectId('/studio/tickets/new?type=task', '?project_id=7'), '/studio/tickets/new?type=task&project_id=7');
  assert.equal(withProjectId('/studio?tab=tasks', '?tab=tickets'), '/studio?tab=tasks');
  assert.equal(withProjectId('/studio', ''), '/studio');

  // The home reads the path and `?type=`; both handlers keep project_id.
  assert.match(HOME, /const \{ pathname, search \} = useLocation\(\);/);
  assert.match(HOME, /const ticket = pathname === STUDIO_TICKET_PATH \? \{ type: ticketTypeOf\(search\) \} : null;/);
  assert.match(HOME, /const onTicketOpen = \(type\) => navigate\(withProjectId\(type === 'task' \? `\$\{STUDIO_TICKET_PATH\}\?type=task` : STUDIO_TICKET_PATH, search\)\);/);
  assert.match(HOME, /const onTicketClose = \(\) => navigate\(withProjectId\(ticket\?\.type === 'task' \? `\$\{STUDIO_PATH\}\?tab=tasks` : STUDIO_PATH, search\), \{ replace: true \}\);/);
  assert.match(HOME, /\n\s+ticket=\{ticket\}\n\s+onTicketOpen=\{onTicketOpen\}\n\s+onTicketClose=\{onTicketClose\}\n/);
  assert.match(INTERVIEW, /\n\s+ticket=\{ticket\}\n\s+onTicketOpen=\{onTicketOpen\}\n\s+onTicketClose=\{onTicketClose\}\n/, 'StudioInterview passes the ticket on');

  // The chat: the route opens the form on its preset; leaving it calls onTicketClose.
  assert.match(ADVISOR, /const routedTicket = Boolean\(ticket\);/);
  assert.match(ADVISOR, /const ticketShown = routedTicket \|\| ticketOpen;/);
  assert.match(ADVISOR, /const ticketPreset = routedTicket \? ticket\.type : ownTicketPreset;/);
  assert.match(ADVISOR, /const ticketPanel = ticketShown && \(\n\s+<AdvisorTicketPanel key=\{ticketPreset \|\| 'any'\} initialType=\{ticketPreset\} onFiled=\{ticketFiled\} onClose=\{closeTicket\} \/>/);
  assert.equal((ADVISOR.match(/<AdvisorTicketPanel key=/g) || []).length, 2, 'one card form, one fullscreen form');
  assert.ok((ADVISOR.match(/\{ticketPanel\}/g) || []).length >= 1, 'the card draws the routed form');
  assert.match(ADVISOR, /ticketOpen=\{ticketShown\}\n\s+ticketPreset=\{ticketPreset\}\n\s+onToggleTicket=\{headerTicket\}\n\s+onTicketFiled=\{ticketFiled\}\n\s+onCloseTicket=\{closeTicket\}/, 'the fullscreen view follows the route too');
  assert.match(ADVISOR, /setTicketPreset\(null\);\n\s+if \(routedTicket\) onTicketClose\?\.\(\);\n\s+\}, \[routedTicket, onTicketClose\]\);/, '× and Cancel leave the route');
  assert.match(ADVISOR, /handleTicketFiled\(t\);\n\s+if \(routedTicket\) onTicketClose\?\.\(\);/, 'a filed ticket leaves the route after the message');
  assert.match(ADVISOR, /const suggest = useCallback\(\(\) => \(onTicketOpen \? onTicketOpen\('task'\) : suggestTask\(\)\), \[onTicketOpen, suggestTask\]\);/);
  assert.equal((ADVISOR.match(/<TasksPanel onSuggest=\{suggest\} /g) || []).length, 3, 'the card\'s two Tasks panels and the phone\'s suggest through the route');
  assert.match(ADVISOR, /onSuggestTask=\{suggest\}/);
  assert.match(ADVISOR, /const headerTicket = routedTicket \? closeTicket : toggleTicket;/, "the header's Open a ticket keeps its local toggle");
  // The desktop form is today's: its selects and the empty type option (D606 :353).
  const panel = ADVISOR.slice(ADVISOR.indexOf('function AdvisorTicketPanel('));
  assert.ok((panel.match(/<select\b/g) || []).length >= 2, 'the desktop form keeps its selects');
  assert.match(panel, /<option value="" disabled>Choose a type<\/option>/);

  // The collapsed row is the conversation's: only on Conversation, with no form open.
  assert.match(INTERVIEW, /const collapsed = summary\?\.complete === true && !reopened;/);
  assert.match(INTERVIEW, /const rowShown = collapsed && \(tab === undefined \|\| tab === 'conversation'\) && !ticket;/);
  assert.match(INTERVIEW, /\{rowShown \? \(\n\s+<>\n\s+<InterviewCompleteRow/);
  assert.match(INTERVIEW, /onOpenTicket=\{onTicketOpen \? openTicketRoute : \(\) => setReopened\('ticket'\)\}/);
  assert.match(INTERVIEW, /const openTicketRoute = \(\) => \{ setReopened\('chat'\); onTicketOpen\(\); \};/);
});

// ── PR 2: the phone page ───────────────────────────────────────────────────

const NOW = new Date('2026-10-15T12:30:00Z');
const inRouter = (element, path = '/studio') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, element));
const textOf = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const hrefs = (markup) => [...markup.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
const PHONE_FRAME = ADVISOR.slice(ADVISOR.indexOf('if (phone) {'), ADVISOR.indexOf('const containerClass ='));

test('12. below 1024px the founder\'s /studio is the phone page: the bar, its own no-advisor line, and no zone', () => {
  const page = (props) => withWindow({ matchMedia: mediaAt(900) }, () => inRouter(h(StudioPhone, props, h('div', null, 'STUB CHAT'))));
  const conv = page({});
  assert.match(conv, /Eadwyn AI/);
  assert.match(conv, /data-testid="studio-phone-tab">Conversations</);
  assert.match(conv, /aria-label="Open the Eadwyn menu"/);
  assert.match(conv, /src="\/eadwyn-ai.png"[^>]*width="34"/);
  assert.match(conv, /STUB CHAT/);
  assert.match(page({ tab: 'tasks' }), /data-testid="studio-phone-tab">Tasks</);
  assert.match(page({ tab: 'tickets' }), /data-testid="studio-phone-tab">My tickets</);
  assert.doesNotMatch(conv, /role="dialog"/, 'the drawer starts closed');

  const none = textOf(page({ advisorAvailable: false }));
  assert.ok(none.includes(NO_ADVISOR));
  assert.equal(NO_ADVISOR, 'The guided founder interview is not available in this environment.');
  assert.doesNotMatch(none, /remain below/);
  assert.doesNotMatch(conv, new RegExp(NO_ADVISOR), 'said only when the advisor is missing');

  // The home: StudioPhone in place of FounderStudioBody below 1024px, one chat element for either.
  assert.match(HOME, /const phone = usePhoneWidth\(\);/);
  assert.match(HOME, /if \(phone\) \{\n\s+return <StudioPhone tab=\{tab\} ticketOpen=\{Boolean\(ticket\)\} advisorAvailable=\{advisorAvailable\}>\{chat\}<\/StudioPhone>;\n\s+\}/);
  assert.match(HOME, /<FounderStudioBody user=\{user\}[^\n]*\n\s+\{chat\}\n\s+<\/FounderStudioBody>/);
  assert.match(HOME, /\n\s+phone=\{phone\}\n\s+venture=\{venture\}\n\s+belowThread=\{phone \? <StudioConversations \/> : null\}\n/);
  const phoneFile = codeOnly(read('frontend/src/pages/founder/StudioPhone.jsx'));
  assert.doesNotMatch(phoneFile, /founder-studio-summary|zone-founder-/, 'a zone on the phone page');
  for (const m of phoneFile.matchAll(/^import .* from '([^']+)';$/gm)) {
    assert.doesNotMatch(m[1], /PersonalAdvisor|StudioInterview|FounderStudioHome|AdvisorProgressWidget|advisor\/router/, m[1]);
  }
  assert.match(phoneFile, /-m-4 [^"]*md:-m-6/, 'the page cancels the shell\'s padding');
});

test('13. the drawer: a dialog of the routes that work, keeping project_id, marking the current row', async () => {
  // D702 (#1664) turned the four profile rows on with their routes.
  assert.equal(PROFILE_ROWS_LIVE, true);
  const menu = (path, props = {}) => inRouter(h(EadwynMenu, { open: true, onClose() {}, ...props }), path);
  const closed = inRouter(h(EadwynMenu, { open: false, onClose() {} }));
  assert.equal(closed, '', 'closed, it draws nothing');

  const five = menu('/studio', { profileRowsLive: false });
  assert.match(five, /role="dialog" aria-modal="true" aria-label="Eadwyn menu"/);
  assert.match(five, /z-50/);
  assert.deepEqual(hrefs(five), ['/studio/tickets/new', '/studio', '/studio?tab=tasks', '/studio?tab=tickets', '/studio/archetype']);
  assert.ok(!hrefs(five).some((x) => x.startsWith('/profile')));
  assert.match(textOf(five), /Eadwyn .*Open a ticket .*Conversations .*Tasks .*My tickets .*Your profile .*Archetype card/);

  const nine = menu('/studio');
  assert.deepEqual(hrefs(nine), ['/studio/tickets/new', '/studio', '/studio?tab=tasks', '/studio?tab=tickets',
    '/profile', '/profile/venture', '/studio/archetype', '/profile/preview', '/profile/visibility']);
  assert.deepEqual(EADWYN_MENU.flatMap((g) => g.rows.map((r) => r.route)), hrefs(nine));

  const kept = hrefs(menu('/studio?project_id=7&tab=tasks', { profileRowsLive: false }));
  assert.deepEqual(kept, ['/studio/tickets/new?project_id=7', '/studio?project_id=7', '/studio?tab=tasks&project_id=7',
    '/studio?tab=tickets&project_id=7', '/studio/archetype']);
  const keptLive = hrefs(menu('/studio?project_id=7&tab=tasks'));
  assert.deepEqual(keptLive.slice(4), ['/profile', '/profile/venture?project_id=7', '/studio/archetype',
    '/profile/preview?project_id=7', '/profile/visibility?project_id=7']);

  const current = menu('/studio?project_id=7&tab=tasks', { active: '/studio?tab=tasks' });
  assert.equal((current.match(/aria-current="page"/g) || []).length, 1);
  assert.match(current, /<a aria-current="page"[^>]*href="\/studio\?tab=tasks&amp;project_id=7"/);

  let closes = 0;
  const view = await mountContracts(h(EadwynMenu, { open: true, onClose: () => { closes += 1; } }), '/studio');
  try {
    await view.click('×');
    assert.equal(closes, 1, '× closes');
    const scrim = view.nodes().find((n) => view.props(n)?.['data-testid'] === 'eadwyn-menu-scrim');
    view.props(scrim).onClick();
    assert.equal(closes, 2, 'the scrim closes');
  } finally { await view.unmount(); }
  const src = codeOnly(read('frontend/src/pages/founder/EadwynMenu.jsx'));
  assert.match(src, /useEscapeClose\(onClose, \{ active: open \}\);/);
  assert.match(src, /inertOutside\(layer\.current\)/);
  assert.match(src, /lockScroll\(document\.body\)/);
  assert.match(src, /tabTarget\(/);
});

test('14. the Conversations list: the Worker\'s rows in the viewer\'s day, the unreadable half named, transcripts read-only', async () => {
  const payload = {
    conversations: [
      { id: 'a1', kind: 'eadwyn', title: 'Pricing the pilot', workspace: 'build', updated_at: '2026-10-15 12:00:00', messages: 4, answered: null, total: null, active: false },
      { id: 'p1', kind: 'profiling', title: 'Profiling questions', workspace: null, updated_at: '2026-10-14 09:00:00', messages: 9, answered: 8, total: 14, active: true },
      { id: 'a2', kind: 'eadwyn', title: 'Round planning', workspace: 'raise', updated_at: '2026-10-13 12:00:00', messages: 1, answered: null, total: null, active: false },
    ],
    unreadable: [],
  };
  const list = conversationRows(payload, NOW);
  assert.deepEqual(list.rows.map((r) => r.value), ['Today', '57%', null]);
  assert.match(list.rows[0].description, /^\d{1,2} Oct · 4 messages$/);
  assert.match(list.rows[1].description, /^\d{1,2} Oct · 8 of 14 answered$/);
  assert.match(list.rows[2].description, /^\d{1,2} Oct · 1 message$/);
  const zero = conversationRows({ conversations: [{ ...payload.conversations[1], answered: 0, total: 0 }], unreadable: [] }, NOW).rows[0];
  assert.equal(zero.value, null, 'no pill, never 0%');
  assert.doesNotMatch(zero.description, /answered/);

  // The viewer's day, in the farthest zones either side of UTC.
  for (const TZ of ['Etc/GMT+12', 'Pacific/Kiritimati', 'UTC', 'America/Los_Angeles']) {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
      const m = await import(${JSON.stringify(new URL('../src/pages/founder/studioPhoneModel.js', import.meta.url).href)});
      const now = new Date('2026-10-15T12:30:00Z');
      const rows = m.conversationRows({ conversations: [
        { id: 'x', kind: 'eadwyn', title: 'x', updated_at: '2026-10-15 12:00:00', messages: 1 },
        { id: 'y', kind: 'eadwyn', title: 'y', updated_at: '2026-10-13 12:00:00', messages: 1 },
      ] }, now).rows;
      process.stdout.write(JSON.stringify(rows.map((r) => r.value)));
    `], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), ['Today', null], TZ);
  }
  // Where the viewer's day and the UTC day disagree, the viewer's wins.
  const la = execFileSync(process.execPath, ['--input-type=module', '-e', `
    const m = await import(${JSON.stringify(new URL('../src/pages/founder/studioPhoneModel.js', import.meta.url).href)});
    const rows = (now, a, b) => m.conversationRows({ conversations: [
      { id: 'x', kind: 'eadwyn', title: 'x', updated_at: a, messages: 1 },
      { id: 'y', kind: 'eadwyn', title: 'y', updated_at: b, messages: 1 },
    ] }, new Date(now)).rows.map((r) => r.value);
    process.stdout.write(JSON.stringify([
      rows('2026-10-15T01:00:00Z', '2026-10-14 23:00:00', '2026-10-14 06:00:00'),
      rows('2026-10-15T12:30:00Z', '2026-10-15 01:00:00', '2026-10-15 12:00:00'),
    ]));
  `], { env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(la), [['Today', null], [null, 'Today']], 'Los Angeles: the viewer\'s day, not UTC\'s');

  assert.equal(threadLabel({ at: '2026-10-15 12:00:00', venture: 'Juniper Labs', now: NOW }), 'Today · Juniper Labs');
  assert.match(threadLabel({ at: '2026-10-13 12:00:00', venture: 'Juniper Labs', now: NOW }), /^1[23] Oct · Juniper Labs$/);
  assert.equal(threadLabel({ at: null, venture: 'Juniper Labs', now: NOW }), 'Today · Juniper Labs', 'sent in this tab');
  assert.equal(threadLabel({ at: '2026-10-15 12:00:00', venture: null, now: NOW }), 'Today');
  const model = codeOnly(read('frontend/src/pages/founder/studioPhoneModel.js'));
  assert.match(model, /export function storedDate\(at\) \{\n\s+const iso = toUtcInstant\(at\);/);
  assert.match(model, /const at = storedDate\(c\?\.updated_at\);/);
  const phoneSrc = codeOnly(read('frontend/src/components/advisor/eadwynPhone.jsx'));
  assert.match(phoneSrc, /const last = at \? storedDate\(at\) : now;/);
  assert.match(ADVISOR, /question_id: m\.question_id \|\| null,\n\s+created_at: m\.created_at \|\| null,/, 'the history keeps created_at');
  assert.match(PHONE_FRAME, /threadLabel\(\{ at: last\?\.created_at, venture \}\)/);

  const drawn = inRouter(h(ConversationsList, { read: { status: 'ready', data: payload }, now: NOW, onOpen() {} }));
  const t = textOf(drawn);
  for (const want of ['Conversations', 'Pricing the pilot', 'Today', 'Profiling questions', '8 of 14 answered', '57%', 'Round planning']) assert.ok(t.includes(want), want);
  const half = textOf(inRouter(h(ConversationsList, { read: { status: 'ready', data: { conversations: [], unreadable: ['eadwyn'] } }, now: NOW })));
  assert.ok(half.includes('Your Eadwyn conversations could not be read.'));
  assert.doesNotMatch(half, /No conversations/);
  assert.ok(textOf(inRouter(h(ConversationsList, { read: { status: 'ready', data: { conversations: [], unreadable: [] } }, now: NOW }))).includes('No conversations yet.'));
  assert.doesNotMatch(textOf(inRouter(h(ConversationsList, { read: { status: 'unreadable' }, now: NOW }))), /No conversations/);

  // A non-active row opens its transcript: user and assistant only.
  const sheet = await mountContracts(h(TranscriptSheet, {
    row: { id: 'a1', kind: 'eadwyn', title: 'Pricing the pilot' }, onClose() {},
    read: async () => ({ messages: [
      { role: 'user', content: 'What should the pilot cost?' },
      { role: 'assistant', content: 'Start from what the pain costs them.' },
      { role: 'tool', content: '{"tool":"x"}' },
      { role: 'system', content: 'SYSTEM LINE' },
    ] }),
  }), '/studio');
  try {
    await sheet.flush();
    const st = sheet.text();
    assert.ok(st.includes('What should the pilot cost?') && st.includes('Start from what the pain costs them.'));
    assert.ok(!st.includes('SYSTEM LINE') && !st.includes('"tool"'));
    assert.ok(!sheet.nodes().some((n) => n.tagName === 'TEXTAREA' || (n.tagName === 'BUTTON' && /Send/.test(n.textContent || ''))), 'no Send in the sheet');
  } finally { await sheet.unmount(); }
  const refused = await mountContracts(h(TranscriptSheet, {
    row: { id: 'p0', kind: 'profiling', title: 'Profiling questions' }, onClose() {},
    read: async () => { throw Object.assign(new Error('The assistant is paused for your account.'), { status: 423 }); },
  }), '/studio');
  try {
    await refused.flush();
    assert.ok(refused.text().includes('The assistant is paused for your account.'));
  } finally { await refused.unmount(); }

  // The active profiling row is the thread: it opens no sheet.
  const view = await mountContracts(h(StudioConversations, { read: async () => payload }), '/studio');
  try {
    await view.flush();
    const press = async (title) => {
      const node = view.nodes().find((n) => n.tagName === 'BUTTON' && textOfNode(n).startsWith(title));
      assert.ok(node, title);
      view.props(node).onClick();
      await view.flush();
    };
    await press('Profiling questions');
    assert.ok(!view.nodes().some((n) => view.props(n)?.['data-testid'] === 'studio-transcript'), 'the active row opened a sheet');
    await press('Round planning');
    assert.ok(view.nodes().some((n) => view.props(n)?.['data-testid'] === 'studio-transcript'), 'a rail row opens its transcript');
  } finally { await view.unmount(); }
});

function textOfNode(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.textContent || '';
  return (node.childNodes || []).map(textOfNode).join('') || node.textContent || '';
}

test('15. the composer: "Currently:", the option chips, Skip and the canvas\'s placeholder', () => {
  const code = read('frontend/src/components/advisor/PersonalAdvisor.jsx');
  assert.ok(code.includes(`'Type your answer, or "explain …"'`));
  assert.ok(!code.includes('explain ...'), 'the three dots are gone');
  assert.match(PHONE_FRAME, /<CurrentQuestion\n\s+q=\{question\}/);
  assert.match(PHONE_FRAME, /<Composer\n[\s\S]*?onSkip=\{skip\}[\s\S]*?options=\{question\?\.options\}\n\s+onPickOption=\{\(opt\) => submit\(opt\)\}/);
  // bottom-0: the shell's <main> pads by the tab bar, and a sticky row is held inside that padding (2026-10-21).
  assert.match(PHONE_FRAME, /className="sticky bottom-0 [^"]*" data-testid="eadwyn-phone-composer"/, 'pinned above the tab bar');
  assert.doesNotMatch(PHONE_FRAME, /<Header\b|<PanelTabs\b/, 'the phone frame has no header and no panel tabs');
  assert.match(PHONE_FRAME, /\{belowThread\}/);
  assert.match(PHONE_FRAME, /<Transcript\n[\s\S]*?\n\s+phone\n\s+\/>/);
});

test('16. Tasks: the focus chips, the buckets drawn the canvas\'s way, and the suggestions', () => {
  const focus = renderToStaticMarkup(h(PhoneFocus, {
    sectionStats: [{ section: 'Governance', percent: 100 }, { section: 'Oversight', percent: 75 }, { section: 'Prefs', percent: 0 }],
    focusSection: 'Oversight', pickFocus() {},
  }));
  assert.match(focus, /Focus a section/);
  for (const chip of ['Governance · 100%', 'Oversight · 75%', '>Prefs<']) assert.ok(focus.includes(chip), chip);
  assert.equal((focus.match(/aria-pressed="true"/g) || []).length, 1);
  assert.equal(renderToStaticMarkup(h(PhoneFocus, { sectionStats: [{ section: 'Only', percent: 10 }], pickFocus() {} })), '');

  const card = (i, extra = {}) => ({ key: `q${i}`, title: `Question ${i}`, importance: 'normal', link: { to: '/account', label: 'Open Account' }, learn: '/help#q', ...extra });
  const buckets = (completed) => inRouter(h(PhoneBuckets, { buckets: [
    { id: 'proposed', label: 'Proposed', count: 0, cards: [] },
    { id: 'pending', label: 'Pending', count: 1, cards: [card(1, { pct: 30 })] },
    { id: 'completed', label: 'Completed', count: completed, cards: Array.from({ length: completed }, (_, i) => card(10 + i, { when: 'Completed 12 Sep 2026' })) },
  ] }));
  const b = buckets(8);
  const bt = textOf(b);
  for (const want of ['Proposed', 'Pending', 'Completed', 'You’re all caught up!', 'New questions appear here as your work unlocks them.', 'Open Account →', 'Learn', 'Completed 12 Sep 2026', 'Show all 8']) assert.ok(bt.includes(want), want);
  assert.match(b, /Proposed<\/span><span[^>]*>0</);
  assert.match(b, /Completed<\/span><span[^>]*>8</);
  assert.equal((b.match(/data-testid="eadwyn-phone-card"/g) || []).length, 1 + BUCKET_PREVIEW, 'Completed shows its three newest');
  assert.doesNotMatch(bt, /Open Admin/);
  assert.doesNotMatch(textOf(buckets(3)), /Show all/);
  const widget = codeOnly(read('frontend/src/components/advisor/AdvisorProgressWidget.jsx'));
  assert.match(widget, /if \(variant === 'phone'\) \{/);
  assert.match(widget, /<PhoneBuckets\n/);
  assert.match(widget, /link: target \? \{ to: target, label: `Open \$\{pageLabel\(target\)\}` \} : null,/);
  assert.match(widget, /when: done \? `Completed \$\{fullDayText\(done\)\}` : null,/);
  assert.match(PHONE_FRAME, /<PhoneFocus sectionStats=\{sectionStats\} focusSection=\{focusSection\} pickFocus=\{pickFocus\} \/>\n\s+<AdvisorProgressWidget\n\s+variant="phone"/);
  assert.match(PHONE_FRAME, /<TasksPanel onSuggest=\{suggest\} onStart=\{startTask\} variant="phone" \/>/);

  const list = { status: 'ready', data: {
    tasks: [{ id: 1, title: 'Map your first ten customers', body: 'Who they are.' }],
    my_suggestions: [
      { id: 11, ticket_id: 501, title: 'Weekly digest', status: 'pending', created_at: '2026-10-12 09:00:00' },
      { id: 12, ticket_id: 502, title: 'Interview script', status: 'approved', created_at: '2026-10-01 09:00:00', decided_at: '2026-10-03 09:00:00', reward: { credits: 10 } },
      { id: 13, ticket_id: 503, title: 'Board pack', status: 'approved', created_at: '2026-10-01 09:00:00', decided_at: '2026-10-04 09:00:00', reward: null },
      { id: 14, ticket_id: 504, title: 'Cap table import', status: 'declined', decline_reason: 'Already on the roadmap.', created_at: '2026-10-01 09:00:00', decided_at: '2026-10-05 09:00:00' },
    ],
    my_suggestions_next: null,
  } };
  const tasks = inRouter(h(TasksPanelView, { list, rewards: { status: 'ready', data: {} }, onSuggest() {}, onStart() {}, variant: 'phone', now: NOW }));
  const tt = textOf(tasks);
  for (const want of ['Community tasks', 'Map your first ten customers', 'Start →', 'My suggestions', 'Pending review', 'Approved', '+10 credits', 'no credits paid', 'Declined · Already on the roadmap.', 'Declined', 'Suggest a task']) assert.ok(tt.includes(want), want);
  assert.match(tt, /Sent \d{1,2} Oct/);
  assert.match(tt, /Approved \d{1,2} Oct/);
  assert.equal((tt.match(/\+10 credits/g) || []).length, 1, '+10 credits only for the paid approval');
  assert.doesNotMatch(tt, /Approved · /, 'the pill drops "Approved · "');
  assert.match(tasks, /data-testid="eadwyn-suggest-task"/);
  for (const status of ['loading', 'unreadable']) {
    const other = textOf(inRouter(h(TasksPanelView, { list: { status }, rewards: { status }, onSuggest() {}, onStart() {}, onRetry() {}, variant: 'phone', now: NOW })));
    assert.doesNotMatch(other, /No tasks yet/, status);
    assert.ok(other.includes('Suggest a task'), status);
  }
});

test('17. My tickets: the balance, and each ticket in D542\'s or D604\'s words', () => {
  const tickets = { status: 'ready', data: [
    { id: 41, title: 'Export fails', type: 'bug', created_at: '2026-10-12 09:00:00', bounty: { state: 'under_review' } },
    { id: 42, title: 'Chart misaligned', type: 'bug', created_at: '2026-10-03 09:00:00', bounty: { state: 'fixed', credits: 150 } },
    { id: 43, title: 'Login loop', type: 'bug', created_at: '2026-10-02 09:00:00', bounty: { state: 'not_a_bug' } },
    { id: 44, title: 'Dark charts', type: 'feature', created_at: '2026-09-28 09:00:00', review: { state: 'awaiting' } },
  ] };
  const drawn = inRouter(h(TicketsPanelView, { tickets, balance: { status: 'ready', data: { balance: 230 } }, rewards: { status: 'ready', data: {} }, variant: 'phone', now: NOW }));
  const t = textOf(drawn);
  for (const want of ['Credit balance', '230 credits', 'US$1 each, spent on Perks', 'Perks', 'My tickets', 'Under review', 'Fixed: 150 credits', 'Not a bug', 'The reason is in the ticket’s comments.', 'Awaiting review']) assert.ok(t.includes(want), want);
  assert.doesNotMatch(t, /\+150/);
  assert.match(t, /Bug · \d{1,2} Oct/);
  assert.match(t, /Feature · \d{1,2} Sep/);
  assert.ok(hrefs(drawn).includes('/perks'));
  for (const id of [41, 42, 43, 44]) assert.ok(hrefs(drawn).includes(`/help/tickets/${id}`), id);
  const withheld = textOf(inRouter(h(TicketsPanelView, { tickets, balance: { status: 'unreadable' }, rewards: { status: 'ready', data: {} }, variant: 'phone', now: NOW })));
  assert.ok(withheld.includes('Your balance could not be read. It is withheld, not zero.'));
  assert.doesNotMatch(withheld, /\b0 credits/);
  const failed = textOf(inRouter(h(TicketsPanelView, { tickets: { status: 'unreadable' }, balance: { status: 'ready', data: { balance: 1 } }, rewards: { status: 'ready', data: {} }, onRetry() {}, variant: 'phone', now: NOW })));
  assert.ok(failed.includes('Your tickets could not be read.'));
  assert.doesNotMatch(failed, /You have not opened a ticket/);
  assert.match(PHONE_FRAME, /<TicketsPanel variant="phone" \/>/);
});

test('18. the ticket card: no default type, Medium first, today\'s checks, and a filed ticket', async () => {
  const markup = renderToStaticMarkup(h(PhoneTicketCard, { onFiled() {}, onClose() {} }));
  const t = textOf(markup);
  assert.ok(t.includes('New ticket'));
  assert.match(markup, /placeholder="Title" aria-label="Title"/);
  assert.match(markup, /placeholder="What happened, or what you need" aria-label="What happened, or what you need"/);
  const radios = [...markup.matchAll(/role="radio" aria-checked="(true|false)"[^>]*>([^<]+)</g)].map((m) => [m[2], m[1]]);
  assert.deepEqual(radios, [['Task', 'false'], ['Bug', 'false'], ['Feature', 'false'], ['Low', 'false'], ['Medium', 'true'], ['High', 'false'], ['Urgent', 'false']]);
  assert.match(markup, /role="radiogroup" aria-label="Type"/);
  assert.match(markup, /role="radiogroup" aria-label="Priority"/);
  assert.match(markup, /<button [^>]*disabled=""[^>]*>File ticket<\/button>/, 'File ticket waits for a title');
  assert.match(renderToStaticMarkup(h(PhoneTicketCard, { initialType: 'task', onFiled() {}, onClose() {} })), /role="radio" aria-checked="true"[^>]*>Task</);
  assert.doesNotMatch(renderToStaticMarkup(h(PhoneTicketCard, { initialType: 'other', onFiled() {}, onClose() {} })), /aria-checked="true"[^>]*>(Task|Bug|Feature)</);

  const calls = [];
  const filed = [];
  let closed = 0;
  const orig = api.createTicket;
  api.createTicket = async (body) => { calls.push(body); return { id: 77, title: body.title }; };
  const view = await mountContracts(h(PhoneTicketCard, { onFiled: (x) => filed.push(x), onClose: () => { closed += 1; } }), '/studio/tickets/new');
  try {
    const title = view.nodes().find((n) => view.props(n)?.['aria-label'] === 'Title');
    const { act } = await import('react');
    await act(async () => { view.props(title).onChange({ target: { value: 'Export fails on Safari' } }); });
    await view.click('File ticket');
    assert.ok(view.text().includes('Choose a type: Task, Bug or Feature.'));
    assert.equal(calls.length, 0, 'no call without a type');
    await view.click('Bug');
    await view.click('File ticket');
    await view.flush();
    assert.deepEqual(calls, [{ title: 'Export fails on Safari', priority: 'medium', type: 'bug', description: undefined }]);
    assert.deepEqual(filed, [{ id: 77, title: 'Export fails on Safari' }]);
    await view.click('Cancel');
    assert.equal(closed, 1);
  } finally { api.createTicket = orig; await view.unmount(); }

  const panel = ADVISOR.slice(ADVISOR.indexOf('function AdvisorTicketPanel('), ADVISOR.indexOf('function CurrentQuestion('));
  assert.match(panel, /const desktop = useIsDesktop\(\);/);
  assert.match(panel, /if \(!desktop\) return <PhoneTicketCard initialType=\{initialType\} onFiled=\{onFiled\} onClose=\{onClose\} \/>;/);
  assert.ok(panel.indexOf('return <PhoneTicketCard') < panel.indexOf('<select'), 'the phone card returns before the desktop form');
  assert.match(panel, /<MyBugReports \/>/, 'the desktop form keeps My bug reports');
  assert.match(PHONE_FRAME, /\{ticketPanel\}/);
});

test('19. the collapsed interview keeps the Conversations list under its row', () => {
  assert.match(INTERVIEW, /onRetryProposals=\{readProposals\}\n\s+\/>\n\s+\{belowThread\}\n\s+<\/>/);
  assert.match(INTERVIEW, /\n\s+phone=\{phone\}\n\s+venture=\{venture\}\n\s+belowThread=\{belowThread\}\n\s+\/>/);
});
