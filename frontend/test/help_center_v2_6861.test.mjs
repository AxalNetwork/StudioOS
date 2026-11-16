/**
 * D6861 (#6861) — Help Center v2, built to its canvas (D4957, boards HC1 to
 * HC16): search first, one page per guide, honest about what is not verified.
 *
 * What is pinned, and why:
 *   - the search shows at most 25 and says "First 25 results" only when more
 *     match, never a total it did not count (the owner's option A);
 *   - area chips count the results shown; the arrow keys never leave the list;
 *   - nothing found offers only broader terms that find a guide, and a ticket
 *     that carries the search;
 *   - Go to is drawn only for a page the viewer can open; every guide reads
 *     "Verification pending" until a first verified date exists;
 *   - after a No, what next; a ticket from a guide carries its link and the
 *     member's words and nothing else;
 *   - the sheet asks ticket or security concern first, and each goes to its
 *     own endpoint, unchanged;
 *   - the directory's role filter dims and never hides;
 *   - signed out: six public guides, Account recovery first;
 *   - the admin review names no one, and a failed read of the searches that
 *     found nothing is never an empty list.
 *
 * Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/help_center_v2_6861.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import { SECTIONS, PUBLIC_HELP_ANCHORS, filterSectionsForRole } from '../src/pages/docs/sections/index.js';
import { createDocsFuse } from '../src/lib/docs/search.js';
import { guidePlacement } from '../src/pages/docs/guidePlacement.js';
import {
  SEARCH_SHOWN, appliesToLine, areaChips, broaderTerms, defaultDirectoryRole, directoryAreas, goToTarget, guideLinkFlags,
  guideOutline, guideTicketDraft, inArea, linkFlagLine, moveSelection, publicGuides, resultLine, searchGuides,
  searchMissesView, ticketTitleFromSearch,
} from '../src/pages/docs/v2/helpV2.js';
import { HelpArticle, NothingFound, SearchResults, StatusLine } from '../src/pages/docs/DocsLayout.jsx';
import { HelpTicketSheetView, securityErrors, ticketFiledOutcome } from '../src/pages/docs/v2/HelpTicketSheet.jsx';
import { HelpDirectoryView } from '../src/pages/docs/v2/HelpDirectory.jsx';
import { GuideFeedbackView, SearchMissesAdminView } from '../src/pages/docs/HelpSignals.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const count = (s, needle) => s.split(needle).length - 1;
const founder = filterSectionsForRole(SECTIONS, 'founder');
const admin = filterSectionsForRole(SECTIONS, 'admin');
const anon = filterSectionsForRole(SECTIONS, 'public');
const noop = () => {};

/** A stand-in index that returns `n` records for any query, honouring `limit`. */
const fakeFuse = (n) => ({
  search: (_q, { limit } = {}) => Array.from({ length: Math.min(n, limit ?? n) }, (_, i) => ({
    item: { anchor: i % 2 ? 'capital/cap-table' : 'validate-grow/data-room', sectionId: 'x', sectionTitle: 'X', subsectionTitle: `Guide ${i}`, text: 'share it' },
  })),
});

// ── HC3: search ─────────────────────────────────────────────────────────────

test('HC3: at most 25 results, and "First 25" only when the index has more', () => {
  const many = searchGuides(fakeFuse(40), 'share');
  assert.equal(many.results.length, SEARCH_SHOWN);
  assert.equal(many.capped, true);
  assert.equal(resultLine(many), 'First 25 results · refine your search to narrow them');
  const exactly = searchGuides(fakeFuse(25), 'share');
  assert.deepEqual([exactly.results.length, exactly.capped], [25, false], 'exactly 25 is a count the search knows');
  assert.equal(resultLine(exactly), '25 results');
  assert.equal(resultLine(searchGuides(fakeFuse(12), 'q')), '12 results');
  assert.equal(resultLine(searchGuides(fakeFuse(1), 'q')), '1 result');
  assert.equal(resultLine(searchGuides(fakeFuse(0), 'q')), '0 results');
  assert.deepEqual(searchGuides(fakeFuse(5), '   '), { results: [], capped: false }, 'an empty query searches nothing');
  // The real index, on a real query, never shows more than 25.
  const real = searchGuides(createDocsFuse('admin'), 'account');
  assert.ok(real.results.length <= SEARCH_SHOWN);
});

test('HC3: area chips count the results shown, most first, and filter them', () => {
  const r = searchGuides(fakeFuse(5), 'share').results;
  const chips = areaChips(r);
  assert.deepEqual(chips.map((c) => [c.id, c.label, c.count]), [
    ['all', 'All', 5], ['data', 'Data rooms & due diligence', 3], ['raising', 'Raising & cap table', 2],
  ]);
  assert.equal(inArea(r, 'raising').length, 2);
  assert.equal(inArea(r, 'all').length, 5);
});

test('HC3: arrow keys move the selection and never leave the list', () => {
  assert.equal(moveSelection('ArrowDown', -1, 3), 0);
  assert.equal(moveSelection('ArrowDown', 1, 3), 2);
  assert.equal(moveSelection('ArrowDown', 2, 3), 2);
  assert.equal(moveSelection('ArrowUp', 2, 3), 1);
  assert.equal(moveSelection('ArrowUp', 0, 3), 0);
  assert.equal(moveSelection('ArrowUp', -1, 3), 0);
  assert.equal(moveSelection('ArrowDown', 0, 0), -1, 'no list, no selection');
  assert.equal(moveSelection('x', 1, 3), 1);
});

test('HC3: the results draw the live line, chips, an option per result and the 25 note', () => {
  const search = searchGuides(fakeFuse(30), 'share');
  const out = html(h(SearchResults, { search, query: 'share', chip: 'all', active: 1 }));
  assert.match(out, /role="status" aria-live="polite"[^>]*>First 25 results · refine your search to narrow them</);
  assert.equal(count(out, 'role="option"'), 25);
  assert.match(out, /id="help-result-1" role="option" aria-selected="true"/);
  assert.equal(count(out, 'aria-selected="true"'), 1);
  assert.match(out, /role="radiogroup" aria-label="Filter results by area"/);
  assert.match(out, /data-testid="help-results-capped"/);
  assert.match(renderedText(out), /The search stops at 25\. It does not know how many more match, so it never shows a total\./);
  const twelve = html(h(SearchResults, { search: searchGuides(fakeFuse(12), 'share'), query: 'share' }));
  assert.match(twelve, />12 results</);
  assert.doesNotMatch(twelve, /help-results-capped/);
  // The field controls the list, with the selection as its active descendant.
  const layout = codeOnly(read('frontend/src/pages/docs/DocsLayout.jsx'));
  assert.match(layout, /role="combobox"/);
  assert.match(layout, /aria-controls="help-results"/);
  assert.match(layout, /aria-activedescendant=\{activeId \|\| undefined\}/);
  assert.match(layout, /if \(e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'\)/);
  assert.match(layout, /if \(r\) \{ e\.preventDefault\(\); navigate\(guideHref\(r\.anchor\)\); \}/);
  assert.match(layout, /else if \(e\.key === 'Escape'\)/);
});

// ── HC4: nothing found ──────────────────────────────────────────────────────

test('HC4: broader terms find a guide; the ticket carries the search', () => {
  const fuse = createDocsFuse('founder');
  const terms = broaderTerms('export qqqzzz cap table', fuse);
  assert.ok(terms.length > 0 && terms.length <= 3);
  assert.ok(!terms.includes('qqqzzz'));
  for (const t of terms) assert.ok(fuse.search(t, { limit: 1 }).length > 0, t);
  assert.deepEqual(broaderTerms('how do the', fuse), [], 'stop words are never offered');
  assert.equal(ticketTitleFromSearch('export invoices'), 'How do I export invoices?');
  assert.equal(ticketTitleFromSearch('how do I update my cap table?'), 'How do I update my cap table?');
  assert.equal(ticketTitleFromSearch('  '), '');
  assert.ok(ticketTitleFromSearch('x'.repeat(300)).length <= 200, 'within the ticket title limit');

  const opened = [];
  const signedIn = html(h(NothingFound, { query: 'export qqqzzz invoices', fuse, user: { role: 'founder' }, onQuery: noop, onTicket: (t) => opened.push(t), publicCount: 6 }));
  assert.match(renderedText(signedIn), /No guide matches “export qqqzzz invoices”\./);
  assert.match(renderedText(signedIn), /Title: How do I export qqqzzz invoices\?/);
  assert.match(signedIn, /data-testid="help-none-ticket"/);
  assert.match(signedIn, /href="\/help\?view=all"/);
  const signedOut = html(h(NothingFound, { query: 'export invoices', fuse: createDocsFuse('public'), user: null, onQuery: noop, onTicket: noop, publicCount: 6 }));
  assert.match(renderedText(signedOut), /No public guide matches\.Sign in to search every guide\./);
  assert.match(renderedText(signedOut), /Browse the 6 public guides/);
  assert.doesNotMatch(signedOut, /help-none-ticket/, 'signed out, no ticket: it needs a member');
});

test('HC4: a search that found nothing is recorded only for a member, after typing stops', () => {
  const layout = codeOnly(read('frontend/src/pages/docs/DocsLayout.jsx'));
  assert.match(layout, /if \(!user \|\| !trimmedQuery \|\| search\.results\.length > 0 \|\| trimmedQuery\.length < 2\) return undefined;/);
  assert.match(layout, /helpCenterApi\.recordSearchMiss\(trimmedQuery\)/);
  assert.match(layout, /\}, SEARCH_MISS_IDLE_MS\);/);
  const client = read('frontend/src/lib/api/helpCenter.js');
  assert.match(client, /request\('\/help\/search-misses', \{ method: 'POST', body: JSON\.stringify\(\{ query \}\) \}\)/);
  assert.match(client, /request\(`\/admin\/help\/search-misses\?days=\$\{encodeURIComponent\(days\)\}`\)/);
  const worker = read('cloudflare-worker/src/routes/help_center.ts');
  assert.match(worker, /help\.post\('\/search-misses'/);
  assert.match(worker, /adminHelpCenter\.get\('\/search-misses'/);
});

// ── HC5, HC9: the guide page ────────────────────────────────────────────────

test('HC5: Go to only for a page the viewer can open; Start recovery for account recovery', () => {
  const dataRoom = guidePlacement('validate-grow/data-room', { role: 'founder' });
  assert.deepEqual(goToTarget(dataRoom, { role: 'founder' }), { label: 'Go to Data Room', path: '/raise/data-room' });
  assert.equal(goToTarget(guidePlacement('validate-grow/data-room', { role: 'advisor' }), { role: 'advisor' }), null, 'a page this viewer cannot open draws no button');
  assert.equal(goToTarget(guidePlacement('validate-grow/office-hours'), { role: 'founder' }), null, 'a guide with no page draws no button');
  assert.deepEqual(goToTarget(guidePlacement('account/auth-recovery'), null), { label: 'Start recovery', path: '/auth/recover' });
  assert.equal(appliesToLine(['partner']), 'Applies to: Operating partner');
  assert.equal(appliesToLine(null), 'Every account');
});

test('HC5: the guide page — one primary Go to, address, On this page, owner and review', () => {
  const out = html(h(HelpArticle, { sections: founder, area: 'validate-grow', guide: 'data-room', user: { role: 'founder' }, onOpenTicket: noop }));
  const text = renderedText(out);
  assert.equal(count(out, 'data-testid="help-guide-go"'), 1);
  assert.match(out, /data-testid="help-guide-go"[^>]*>Go to Data Room</);
  assert.match(text, /Opens \/raise\/data-room/);
  assert.match(text, /\/help\/validate-grow\/data-room/);
  assert.match(out, /<nav aria-label="On this page"/);
  assert.match(text, /OwnerUnassignedReviewVerification pending/);
  assert.match(text, /Related guides/);
  assert.match(text, /Did this answer it\?/);
  assert.equal(count(out, '<h1'), 1);
  // A priority guide carries its owner, still pending: no verified date is invented (#4641).
  const recovery = html(h(HelpArticle, { sections: anon, area: 'account', guide: 'auth-recovery', user: null }));
  assert.match(renderedText(recovery), /OwnerAxal VC SupportReviewVerification pending/);
  assert.doesNotMatch(renderedText(recovery), /Verified \d/);
});

test('HC9: account recovery, signed out — Start recovery, the private channels, no ticket and no answer', () => {
  const out = html(h(HelpArticle, { sections: anon, area: 'account', guide: 'auth-recovery', user: null }));
  const text = renderedText(out);
  assert.match(text, /Can’t sign in\?/);
  assert.match(out, /data-testid="help-guide-go" href="\/auth\/recover"[^>]*>Start recovery</);
  assert.match(text, /Still can’t get in\?/);
  assert.match(out, /href="\/help\/troubleshooting\/contact-support"/);
  assert.match(out, /security\/advisories\/new/);
  assert.match(out, /href="\/trust\/disclosure"/);
  assert.match(out, /mailto:security@axal\.vc/);
  assert.doesNotMatch(out, /Did this answer it\?|help-tickets/);
  assert.deepEqual(guideOutline({ overview: 'x', howto: ['a'] }, { stuck: true }).map((o) => o.label), ['Overview', 'Steps', 'Still can’t get in?']);
});

// ── HC6: what next ──────────────────────────────────────────────────────────

const IDLE = { busy: false, failed: false };
const fb = (props) => html(h(GuideFeedbackView, { mode: 'idle', missing: '', save: IDLE, ...props }));

test('HC6: after a No, what next — related guides, search again, a ticket, chat only with the plan', () => {
  const related = [{ anchor: 'validate-grow/due-diligence', title: 'Due Diligence' }];
  const asked = [];
  const next = { related, chatAvailable: false, onOpenChat: noop, onOpenTicket: (m) => asked.push(m) };
  const no = fb({ read: { state: 'answered', answer: 'no', missing: 'Revoke one investor' }, next });
  assert.match(no, /data-testid="help-feedback-next"/);
  assert.match(renderedText(no), /What next/);
  assert.match(no, /href="\/help\/validate-grow\/due-diligence"/);
  assert.match(no, /<form role="search"/);
  assert.match(renderedText(no), /Carries this guide’s link and your words above\. You see and edit both before Submit\./);
  assert.doesNotMatch(no, /Message the team/);
  assert.match(fb({ read: { state: 'answered', answer: 'no', missing: null }, next: { ...next, chatAvailable: true } }), /Message the team/);
  assert.doesNotMatch(fb({ read: { state: 'answered', answer: 'yes', missing: null }, next }), /help-feedback-next/, 'a Yes needs no next step');
  assert.doesNotMatch(fb({ read: { state: 'none' }, next }), /help-feedback-next/);
});

test('HC6: a ticket from a guide carries its link and the member\'s words, and nothing else', () => {
  const d = guideTicketDraft({ anchor: 'validate-grow/data-room', title: 'Data Room', missing: '  Revoke one investor.\nNot the whole room.  ' });
  assert.deepEqual(d, {
    title: 'Revoke one investor.',
    description: 'From the guide: /help/validate-grow/data-room\n\nRevoke one investor.\nNot the whole room.',
  });
  assert.deepEqual(guideTicketDraft({ anchor: 'a/b', title: 'Data Room', missing: '' }), {
    title: 'Question about “Data Room”', description: 'From the guide: /help/a/b',
  });
});

// ── HC7: the sheet ──────────────────────────────────────────────────────────

const sheetState = (over = {}) => ({
  kind: 'ticket', errors: {}, busy: false, failed: null, done: null,
  ticket: { title: 'Revoke access', description: 'From the guide: /help/validate-grow/data-room', type: '', priority: 'medium', category: '' },
  security: { affected: '', what: '', how: '' },
  ...over,
});
const sheet = (state, from = { anchor: 'validate-grow/data-room', title: 'Data Room' }) => html(h(HelpTicketSheetView, {
  from, state, onKind: noop, onTicket: noop, onSecurity: noop, onSubmit: noop, onClose: noop,
}));

test('HC7: the sheet asks what kind of help first, then the ordinary ticket with its warning', () => {
  const out = sheet(sheetState());
  const text = renderedText(out);
  assert.ok(out.indexOf('What kind of help?') < out.indexOf('help-sheet-title-field'), 'the choice comes before the form');
  assert.match(out, /data-testid="help-sheet-kind-ticket"[^>]*checked=""|checked=""[^>]*data-testid="help-sheet-kind-ticket"/);
  assert.match(text, /From Data Room/);
  assert.match(text, /Get help with this guide/);
  assert.match(text, /Only the guide’s link and your own words were carried over\. Edit freely\./);
  assert.match(text, /may be mirrored to a public tracker, and attachments are not supported/);
  assert.match(out, /role="radiogroup" aria-label="Type"/);
  assert.equal(count(out, 'aria-checked="true"'), 0, 'Type has no default (D544)');
  assert.match(out, /data-testid="help-sheet-submit"[^>]*>Submit ticket</);
});

test('HC7: the security concern — private, five in 24 hours, the other ways, Send privately', () => {
  const out = sheet(sheetState({ kind: 'security' }));
  const text = renderedText(out);
  assert.match(text, /Sent privately to HQ’s security team\. At most 5 reports in 24 hours\./);
  assert.match(out, /security\/advisories\/new/);
  assert.match(out, /mailto:security@axal\.vc/);
  assert.match(out, /data-testid="help-sheet-submit"[^>]*>Send privately</);
  assert.doesNotMatch(text, /mirrored to a public tracker, and attachments/);
  assert.deepEqual(Object.keys(securityErrors({ affected: '', what: '' })).sort(), ['affected', 'what']);
  assert.deepEqual(securityErrors({ affected: 'Data room', what: 'It leaked', how: '' }), {});
  assert.ok(securityErrors({ affected: 'x'.repeat(201), what: 'y' }).affected);
});

test('HC7: sent, filed, not mirrored, and refused — each in its own words', () => {
  assert.deepEqual(ticketFiledOutcome({ id: 413, github_sync_status: 'synced' }), { id: 413, mirrored: true });
  assert.deepEqual(ticketFiledOutcome({ id: 413, github_sync_status: 'failed' }), { id: 413, mirrored: false });
  const filed = sheet(sheetState({ done: { kind: 'ticket', id: 413, mirrored: false } }));
  assert.match(renderedText(filed), /Ticket #413 filed\./);
  assert.match(filed, /href="\/help\/tickets\/413"/);
  assert.match(filed, /data-testid="help-sheet-not-mirrored"/);
  assert.doesNotMatch(sheet(sheetState({ done: { kind: 'ticket', id: 413, mirrored: true } })), /help-sheet-not-mirrored/);
  const sent = sheet(sheetState({ kind: 'security', done: { kind: 'security' } }));
  assert.match(renderedText(sent), /Sent privately\. Only HQ’s security team reads it\.It stays private and never becomes a ticket\./);
  const refused = sheet(sheetState({ kind: 'security', failed: 'You have sent 5 reports in the last 24 hours. Email security@axal.vc for anything more.' }));
  assert.match(refused, /role="alert"[^>]*data-testid="help-sheet-refused"/);
  assert.match(renderedText(refused), /You have sent 5 reports in the last 24 hours/);
  const notFiled = sheet(sheetState({ failed: 'title must be 1-200 characters' }));
  assert.match(renderedText(notFiled), /The ticket was not filed\. Your title and description are kept\. title must be 1-200 characters/);
});

test('HC7: the sheet files on the same two endpoints, unchanged', () => {
  const src = codeOnly(read('frontend/src/pages/docs/v2/HelpTicketSheet.jsx'));
  assert.match(src, /api\.createTicket\(\{/);
  assert.match(src, /securityReportsApi\.send\(\{/);
  assert.match(src, /affected: r\.affected\.trim\(\), what_happened: r\.what\.trim\(\)/);
  assert.match(src, /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); onClose\(\); return; \}/);
  assert.match(src, /role="dialog"\s+aria-modal="true"/);
  const layout = codeOnly(read('frontend/src/pages/docs/DocsLayout.jsx'));
  assert.match(layout, /\{user && sheet && <HelpTicketSheet initial=\{sheet\} onClose=\{closeSheet\} \/>\}/, 'signed out, no sheet');
});

// ── HC8: the directory ──────────────────────────────────────────────────────

test('HC8: the role filter dims guides for other roles and never hides one', () => {
  const all = directoryAreas(founder, 'all');
  const total = all.reduce((n, a) => n + a.guides.length, 0);
  assert.equal(total, founder.reduce((n, s) => n + s.subsections.length, 0), 'every guide the viewer can read');
  assert.equal(all.flatMap((a) => a.guides).filter((g) => g.dim).length, 0, 'All dims nothing');
  for (const role of ['founder', 'investor', 'advisor', 'partner']) {
    const areas = directoryAreas(founder, role);
    const guides = areas.flatMap((a) => a.guides);
    assert.equal(guides.length, total, `${role} hides nothing`);
    for (const g of guides) {
      if (g.appliesTo.length === 0) assert.equal(g.dim, false, `${g.anchor}: a guide for every account is never dimmed`);
      else assert.equal(g.dim, !g.appliesTo.includes(role), `${g.anchor} for ${role}`);
    }
  }
  assert.ok(all.flatMap((a) => a.guides).some((g) => g.noPage), 'guides with no page are marked');
  assert.equal(directoryAreas(admin).some((a) => a.id === 'admin'), true, 'admins see Running the platform');
  assert.equal(directoryAreas(founder).some((a) => a.id === 'admin'), false);
  assert.equal(defaultDirectoryRole('investor'), 'investor');
  assert.equal(defaultDirectoryRole('admin'), 'all');

  const out = html(h(HelpDirectoryView, { sections: founder, filter: 'founder', onFilter: noop, onSearch: noop }));
  assert.equal(count(out, 'data-testid="help-directory-guide"'), total);
  assert.ok(count(out, 'data-dim="true"') > 0);
  assert.match(out, /role="radiogroup" aria-label="Role filter"/);
  assert.match(out, /role="radio" aria-checked="true"[^>]*>Founder</);
  assert.match(renderedText(out), new RegExp(`${total} guides in 11 areas`));
  assert.match(out, /id="area-data"/);
});

// ── HC2: signed out ─────────────────────────────────────────────────────────

test('HC2: six public guides, Account recovery first', () => {
  const g = publicGuides(anon);
  assert.equal(g.length, PUBLIC_HELP_ANCHORS.size);
  assert.equal(g[0].anchor, 'account/auth-recovery');
  assert.deepEqual(new Set(g.map((x) => x.anchor)), PUBLIC_HELP_ANCHORS);
  assert.deepEqual(publicGuides(founder).map((x) => x.anchor)[0], 'account/auth-recovery');
});

// ── HC11: the status line ───────────────────────────────────────────────────

test('HC11: every status carries a word and a glyph; nothing is drawn before the probe answers', () => {
  for (const [k, glyph, words] of [['operational', '✓', 'All monitored services operational'], ['degraded', '!', 'Some systems degraded'], ['down', '✕', 'Active outage'], ['unknown', '?', 'Status could not be read']]) {
    const out = html(h(StatusLine, { overall: k }));
    assert.match(out, new RegExp(`aria-hidden="true">\\${glyph}</span>${words}`), k);
    assert.match(out, /role="status"/);
  }
  assert.doesNotMatch(html(h(StatusLine, { overall: null })), /help-status-line/);
});

// ── HC12: admin review ──────────────────────────────────────────────────────

test('HC12: broken links are checked against the manifest; stale is not recorded', () => {
  for (const s of SECTIONS) for (const g of s.subsections) {
    assert.deepEqual(guideLinkFlags(`${s.id}/${g.id}`, SECTIONS), { broken: [] }, `${s.id}/${g.id}`);
  }
  const bad = [{ id: 'capital', title: 'Capital', subsections: [{ id: 'cap-table', title: 'Cap Table', related: [{ href: '#capital/gone' }, { href: '#capital/cap-table' }] }] }];
  assert.deepEqual(guideLinkFlags('capital/cap-table', bad), { broken: ['Related: capital/gone'] });
  assert.equal(linkFlagLine({ broken: ['Related: capital/gone'] }), '1 broken link');
  assert.equal(linkFlagLine({ broken: [] }), 'No broken link');
  assert.equal(guideLinkFlags('no/guide', SECTIONS), null);
  assert.equal(linkFlagLine(null), 'Not in the Help Center');
});

test('HC12: the searches that found nothing — loading, unreadable, none, and the list, no names', () => {
  assert.equal(searchMissesView({ window_days: 30 }), null, 'no list is a failed read, not an empty month');
  assert.equal(searchMissesView(null), null);
  assert.deepEqual(searchMissesView({ window_days: 30, searches: [{ query: 'export invoices', searches: 3, user_id: 9 }, { query: 'x', searches: 0 }] }),
    { days: 30, searches: [{ query: 'export invoices', searches: 3 }] }, 'a field about a member never passes through');
  assert.match(html(h(SearchMissesAdminView, { read: { status: 'loading', view: null } })), /aria-busy="true"/);
  const failed = html(h(SearchMissesAdminView, { read: { status: 'error', view: null }, onRetry: noop }));
  assert.match(failed, /role="alert"/);
  assert.match(renderedText(failed), /could not be read\. This is not a sign every search found a guide\./);
  assert.doesNotMatch(failed, /help-search-misses-none|help-search-miss"/);
  assert.match(html(h(SearchMissesAdminView, { read: { status: 'ok', view: { days: 30, searches: [] } } })), /data-testid="help-search-misses-none"/);
  const some = html(h(SearchMissesAdminView, { read: { status: 'ok', view: { days: 30, searches: [{ query: 'export invoices', searches: 3 }] } } }));
  assert.match(renderedText(some), /“export invoices”3 member searches/);
});
