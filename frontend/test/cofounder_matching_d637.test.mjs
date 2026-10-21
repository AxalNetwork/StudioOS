/**
 * D637 (#1395) — co-founder matching controls on `/build/team?tab=cofounders`,
 * rendered from the real component: Unlist me, Withdraw interest, and each
 * connection's state, with the other person's email hidden until both have
 * signed (D610).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CofounderMatchingView, emailLine, CONNECTION_STATUS } from '../src/pages/founder/CofounderMatchingPanel.jsx';
import { resolveTab, TABS } from '../src/pages/founder/FounderTeamPage.jsx';
import { codeOnly } from './_codeOnly.mjs';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const words = (markup) => {
  let out = '';
  let inTag = false;
  for (const ch of String(markup)) {
    if (ch === '<') { inTag = true; out += ' '; } else if (ch === '>' && inTag) inTag = false;
    else if (!inTag) out += ch;
  }
  return out.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
};

const ME = { uid: 'p-ada', listed: true };
const SENT = [{ user_uid: 'u-ben', name: 'Ben', looking_for: 'A commercial co-founder', listed: true, sent_at: '2026-10-12 09:00:00', connection_uid: null }];
const PENDING = { uid: 'c-1', status: 'pending_nda', i_signed_at: '2026-10-12 09:00:00', they_signed_at: null,
  counterparty: { name: 'Cy', email: null, email_withheld: 'until_both_sign' } };
const ACTIVE = { uid: 'c-2', status: 'active', i_signed_at: '2026-10-12 09:00:00', they_signed_at: '2026-10-13 09:00:00',
  counterparty: { name: 'Dee', email: 'dee@example.test' } };
const CLOSED = { uid: 'c-3', status: 'closed', i_signed_at: null, they_signed_at: '2026-10-13 09:00:00',
  counterparty: { name: 'Eve', email: null, email_withheld: 'until_both_sign' } };
const view = (read) => html(h(CofounderMatchingView, { read: { kind: 'ready', me: ME, sent: SENT, connections: [], ...read }, onBrowse: () => {} }));

test('the email is hidden until both have signed, and shown once they have', () => {
  const markup = view({ connections: [PENDING, ACTIVE, CLOSED] });
  const pending = words(markup.slice(markup.indexOf('data-testid="connection-c-1"'), markup.indexOf('data-testid="connection-c-2"')));
  assert.match(pending, /Cy Waiting for both NDAs You signed 12 Oct Cy has not signed Email: shown once both NDAs are signed\./);
  assert.doesNotMatch(pending, /@/);
  const active = markup.slice(markup.indexOf('data-testid="connection-c-2"'), markup.indexOf('data-testid="connection-c-3"'));
  assert.match(words(active), /Dee Active You signed 12 Oct Dee signed 13 Oct Email: dee@example\.test/);
  assert.match(active, /href="mailto:dee@example\.test"/);
  const closed = words(markup.slice(markup.indexOf('data-testid="connection-c-3"')));
  assert.match(closed, /Eve Closed You has not signed Eve signed 13 Oct Email: not shared\. You did not both sign the NDA before it closed\./);
  assert.deepEqual(emailLine(PENDING), { shown: false, text: 'Email: shown once both NDAs are signed.' });
  assert.equal(CONNECTION_STATUS.pending_nda.label, 'Waiting for both NDAs');
});

test('the page never prints an email the Worker withheld, even if a name is missing', () => {
  const markup = view({ connections: [{ ...PENDING, counterparty: { name: null, email: null } }] });
  assert.match(words(markup), /The other founder Waiting for both NDAs/);
  assert.doesNotMatch(markup, /mailto:/);
});

test('Unlist me, List me again and Withdraw interest', () => {
  const listed = words(view({}));
  assert.match(listed, /Your listing Listed Founders browsing can see your profile and send interest\. Unlist me/);
  assert.match(listed, /Interest you sent Ben Looking for: A commercial co-founder · sent 12 Oct Withdraw interest/);
  const unlisted = words(view({ me: { ...ME, listed: false } }));
  assert.match(unlisted, /Unlisted Your profile is kept, but nobody browsing can see it\. List me again/);
  assert.doesNotMatch(unlisted, /Unlist me/);
  assert.match(words(view({ me: null })), /You have no co-founder profile yet, so you are not listed\./);
  assert.match(words(view({ sent: [{ ...SENT[0], listed: false, connection_uid: 'c-9' }] })), /· no longer listed · mutual, see Connections Withdraw interest/);
});

test('empty, loading and unreadable', () => {
  const empty = words(view({ sent: [], connections: [] }));
  assert.match(empty, /You have not sent interest to anyone\. Browse profiles/);
  assert.match(empty, /No connection yet\. One opens when interest is mutual\./);
  assert.match(words(html(h(CofounderMatchingView, { read: { kind: 'loading' } }))), /Loading your matching…/);
  const unread = words(html(h(CofounderMatchingView, { read: { kind: 'unreadable', message: 'Network down.' } })));
  assert.match(unread, /Matching could not be read just now\. Network down\. Try again/);
  assert.doesNotMatch(unread, /You have not sent interest|No connection yet/);
});

test('laid out for a 390-wide phone: full-width buttons that shrink on wider screens', () => {
  const markup = view({});
  assert.match(markup, />Unlist me</);
  assert.match(markup, /class="w-full [^"]*sm:w-auto"[^>]*>Unlist me</);
  assert.match(markup, /class="flex flex-col gap-2 sm:flex-row/);
});

test('the Team page has a cofounders tab that renders the panel', () => {
  assert.equal(resolveTab('cofounders'), 'cofounders');
  assert.equal(resolveTab('cofounder'), 'hiring', 'the legacy id still lands where it did');
  assert.deepEqual(TABS.map((t) => t.id), ['roster', 'advisors', 'hiring', 'coverage', 'cofounders']);
  const src = codeOnly(readFileSync(new URL('../src/pages/founder/FounderTeamPage.jsx', import.meta.url), 'utf8'));
  // #2355: Browse opens Co-founder Match, the one matcher, now that the
  // Hiring tab no longer embeds the removed /cofounder page.
  assert.match(src, /\{tab === 'cofounders' && \(\s*<TierGate tier="studio"[^>]*>\s*<CofounderMatchingPanel onBrowse=\{\(\) => navigate\(COFOUNDER_MATCH\)\} \/>/);
  assert.match(src, /const COFOUNDER_MATCH = '\/spinout-lab\/cofounder-match';/);
  const panel = codeOnly(readFileSync(new URL('../src/pages/founder/CofounderMatchingPanel.jsx', import.meta.url), 'utf8'));
  assert.match(panel, /client\.cofounderUnlistMe\(\)/);
  assert.match(panel, /client\.cofounderWithdrawInterest\(s\.user_uid\)/);
  assert.match(panel, /client\.cofounderSentInterests\(\)/);
});
