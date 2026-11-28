/**
 * D9284 (#9284) — Eadwyn's panel names three actions, each leading to its own
 * outcome, each with one line saying what happens next:
 *
 *   Tasks       Suggest a community task  the ticket form on Type = Task, with
 *                                         its reward line (D606), unchanged
 *               Assign project work       #8767's company Work path, HIDDEN
 *                                         while that path is not on main
 *   My tickets  Open a support ticket     the Help Center ticket form
 *
 * Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/eadwyn_panel_actions_9284.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  ASSIGN_LABEL, ASSIGN_NOTE, ASSIGN_WORK_PATH_LIVE, SUGGEST_LABEL, SUPPORT_TICKET_PATH, TICKET_LABEL, TICKET_NOTE,
  TasksPanelView, TicketsPanelView, assignWorkHref,
} from '../src/components/advisor/EadwynPanels.jsx';
import { suggestNote } from '../src/lib/eadwynTickets.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const hrefOf = (markup, testId) => {
  const tag = (markup.match(new RegExp(`<a [^>]*data-testid="${testId}"[^>]*>`)) || [])[0];
  const m = tag && tag.match(/href="([^"]*)"/);
  return m ? m[1].replace(/&amp;/g, '&') : null;
};
const noteOf = (markup, testId) => {
  const m = markup.match(new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`));
  return m ? text(m[1]) : null;
};

const NOW = new Date('2026-11-28T12:00:00Z');
const ready = (data) => ({ status: 'ready', data });
const PAYS = ready({ rewards: { task_approved: { credits: 10, active: true } } });
const LIST = ready({ tasks: [{ id: 1, title: 'Share a cap-table template', body: 'Upload it.' }], my_suggestions: [], my_suggestions_next: null });
const noop = () => {};
const tasks = (o = {}) => html(h(TasksPanelView, { list: LIST, rewards: PAYS, onSuggest: noop, onStart: noop, onRetry: noop, onOlder: noop, now: NOW, ...o }));
const tickets = (o = {}) => html(h(TicketsPanelView, { tickets: ready([]), balance: ready({ balance: 5 }), rewards: PAYS, onRetry: noop, now: NOW, ...o }));
const SCOPE = { companyUid: 'co_ab12', projectId: 7 };
const LIVE_HREF = assignWorkHref(SCOPE, true);

test('the three labels are three different names', () => {
  assert.equal(SUGGEST_LABEL, 'Suggest a community task');
  assert.equal(ASSIGN_LABEL, 'Assign project work');
  assert.equal(TICKET_LABEL, 'Open a support ticket');
});

for (const variant of [undefined, 'phone']) {
  const v = variant || 'desktop';

  test(`${v}: Suggest a community task keeps the ticket form on Task, and its line names the system and the reward`, () => {
    const markup = tasks({ variant });
    assert.match(markup, /<button type="button"[^>]*data-testid="eadwyn-suggest-task">Suggest a community task<\/button>/);
    assert.equal(noteOf(markup, 'eadwyn-suggest-note'),
      'Opens a Help Center ticket with Type set to Task. Axal reviews it; an approved one joins Community tasks. An approved suggestion earns 10 credits.');
    // The chat still hands the panel `suggest`, which opens the form on Task (D606, D701).
    assert.match(read('frontend/src/components/advisor/PersonalAdvisor.jsx'), /const suggestTask = useCallback\(\(\) => \{ setTicketPreset\('task'\); setTicketOpen\(true\); \}, \[\]\);/);
    assert.equal(noteOf(tasks({ variant, rewards: { status: 'unreadable' } }), 'eadwyn-suggest-note'),
      'Opens a Help Center ticket with Type set to Task. Axal reviews it; an approved one joins Community tasks.', 'no reward claimed when the rule cannot be read');
  });

  test(`${v}: Assign project work is hidden while #8767's path is not live, on every read state`, () => {
    for (const list of [LIST, { status: 'loading' }, { status: 'unreadable' }]) {
      const markup = tasks({ variant, list, assignHref: assignWorkHref(SCOPE) });
      assert.doesNotMatch(markup, /eadwyn-assign-work/, list.status);
      assert.ok(!text(markup).includes(ASSIGN_LABEL), list.status);
      assert.ok(text(markup).includes(SUGGEST_LABEL), `${list.status}: Suggest stays`);
    }
  });

  test(`${v}: once live, Assign project work links to the company Work path with its line`, () => {
    const markup = tasks({ variant, assignHref: LIVE_HREF });
    assert.equal(hrefOf(markup, 'eadwyn-assign-work'), '/account/companies/co_ab12/work?tab=tasks&project=7');
    assert.match(markup, />Assign project work<\/a>/);
    assert.equal(noteOf(markup, 'eadwyn-assign-note'), ASSIGN_NOTE);
    // Suggest and Assign are different destinations: one opens the form, the other is a link.
    assert.doesNotMatch(markup, /<a [^>]*data-testid="eadwyn-suggest-task"/);
  });

  test(`${v}: My tickets carries Open a support ticket, to the Help Center form, on every read state`, () => {
    for (const t of [ready([]), { status: 'loading' }, { status: 'unreadable' }]) {
      const markup = tickets({ variant, tickets: t });
      assert.equal(hrefOf(markup, 'eadwyn-open-ticket'), '/help/tickets?new=1', t.status);
      assert.match(markup, />Open a support ticket<\/a>/, t.status);
      assert.equal(noteOf(markup, 'eadwyn-open-ticket-note'), TICKET_NOTE, t.status);
    }
    assert.equal(SUPPORT_TICKET_PATH, '/help/tickets?new=1');
    assert.equal(TICKET_NOTE, 'Opens the Help Center ticket form. Nothing from this conversation is copied into it.');
    // The ticket action lives on My tickets only, and Tasks never offers it.
    assert.doesNotMatch(tasks({ variant, assignHref: LIVE_HREF }), /eadwyn-open-ticket/);
    assert.doesNotMatch(tickets({ variant }), /eadwyn-suggest-task|eadwyn-assign-work/);
  });
}

test('assignWorkHref: null while not live or without a company; encodes the company; project is optional', () => {
  assert.equal(ASSIGN_WORK_PATH_LIVE, false, '#8767 (PR #8968) is not on main');
  assert.equal(assignWorkHref(SCOPE), null);
  assert.equal(assignWorkHref(SCOPE, false), null);
  assert.equal(assignWorkHref(null, true), null);
  assert.equal(assignWorkHref({ projectId: 7 }, true), null);
  assert.equal(assignWorkHref({ companyUid: 'a/b' }, true), '/account/companies/a%2Fb/work?tab=tasks');
  assert.equal(assignWorkHref({ companyUid: 'c', projectId: '' }, true), '/account/companies/c/work?tab=tasks');
  assert.equal(assignWorkHref({ companyUid: 'c', projectId: 0 }, true), '/account/companies/c/work?tab=tasks&project=0');
});

test('the switch cannot be on while main has no company Work route', () => {
  const routes = read('frontend/src/routes/team.jsx');
  const hasPath = /path="\/account\/companies\/:uid\/work"/.test(routes);
  if (!hasPath) assert.equal(ASSIGN_WORK_PATH_LIVE, false, 'Assign project work would link to a 404');
});

test('the suggestion line is the one function, so the reward semantics stay D606\'s', () => {
  assert.equal(suggestNote(PAYS), noteOf(tasks(), 'eadwyn-suggest-note'));
  assert.equal(suggestNote(ready({ rewards: { task_approved: { credits: 10, active: false } } })),
    'Opens a Help Center ticket with Type set to Task. Axal reviews it; an approved one joins Community tasks.');
});
