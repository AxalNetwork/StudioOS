/**
 * D701 (#1663) — on a phone, Studio is Eadwyn. PR 1: the read, one breakpoint,
 * the tab in the URL and the ticket route, at every width.
 *
 *   8. the client calls the one new read;
 *   9. one breakpoint, 1024px, in a module a test can import;
 *  10. `?tab=` at every width, written with a replace and keeping the rest;
 *  11. `/studio/tickets/new`, `?type=`, `project_id` kept, and the collapse.
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
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { useIsDesktop } from '../src/components/advisor/eadwynPhone.jsx';
import { PanelTabs } from '../src/components/advisor/EadwynPanels.jsx';
import {
  STUDIO_PATH, STUDIO_TICKET_PATH, searchWithTab, studioTabOf, ticketTypeOf, withProjectId,
} from '../src/pages/founder/studioPhoneModel.js';

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
  assert.match(ADVISOR, /import \{ useIsDesktop \} from '\.\/eadwynPhone';/);
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
  assert.equal((ADVISOR.match(/\{ticketShown && \(\n\s+<AdvisorTicketPanel key=\{ticketPreset \|\| 'any'\} initialType=\{ticketPreset\} onFiled=\{ticketFiled\} onClose=\{closeTicket\} \/>/g) || []).length, 1);
  assert.match(ADVISOR, /ticketOpen=\{ticketShown\}\n\s+ticketPreset=\{ticketPreset\}\n\s+onToggleTicket=\{headerTicket\}\n\s+onTicketFiled=\{ticketFiled\}\n\s+onCloseTicket=\{closeTicket\}/, 'the fullscreen view follows the route too');
  assert.match(ADVISOR, /setTicketPreset\(null\);\n\s+if \(routedTicket\) onTicketClose\?\.\(\);\n\s+\}, \[routedTicket, onTicketClose\]\);/, '× and Cancel leave the route');
  assert.match(ADVISOR, /handleTicketFiled\(t\);\n\s+if \(routedTicket\) onTicketClose\?\.\(\);/, 'a filed ticket leaves the route after the message');
  assert.match(ADVISOR, /const suggest = useCallback\(\(\) => \(onTicketOpen \? onTicketOpen\('task'\) : suggestTask\(\)\), \[onTicketOpen, suggestTask\]\);/);
  assert.equal((ADVISOR.match(/<TasksPanel onSuggest=\{suggest\} /g) || []).length, 2, 'both card Tasks panels suggest through the route');
  assert.match(ADVISOR, /onSuggestTask=\{suggest\}/);
  assert.match(ADVISOR, /const headerTicket = routedTicket \? closeTicket : toggleTicket;/, "the header's Open a ticket keeps its local toggle");
  // The desktop form is today's: its selects and the empty type option (D606 :353).
  const panel = ADVISOR.slice(ADVISOR.indexOf('function AdvisorTicketPanel('));
  assert.ok((panel.match(/<select\b/g) || []).length >= 2, 'the desktop form keeps its selects');
  assert.match(panel, /<option value="" disabled>Choose a type<\/option>/);

  // The collapsed row is the conversation's: only on Conversation, with no form open.
  assert.match(INTERVIEW, /const collapsed = summary\?\.complete === true && !reopened;/);
  assert.match(INTERVIEW, /const rowShown = collapsed && \(tab === undefined \|\| tab === 'conversation'\) && !ticket;/);
  assert.match(INTERVIEW, /\{rowShown \? \(\n\s+<InterviewCompleteRow/);
  assert.match(INTERVIEW, /onOpenTicket=\{onTicketOpen \? openTicketRoute : \(\) => setReopened\('ticket'\)\}/);
  assert.match(INTERVIEW, /const openTicketRoute = \(\) => \{ setReopened\('chat'\); onTicketOpen\(\); \};/);
});
