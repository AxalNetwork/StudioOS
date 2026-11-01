/**
 * D1344 (#3552, part 5 of #3547): the Email page's rules.
 *
 *   · the Email action shows only on a record with a person (EM4);
 *   · no other member's address is rendered unless `GET /api/mail/shares`
 *     serves it, once both have shared (D1342);
 *   · the estimate is shown before every draft, and Draft is not pressable
 *     without it (EM3a);
 *   · EM1's cards are the providers the Worker offers, Gmail sends only and
 *     nothing offers "Save to Gmail drafts" (D1347 §3);
 *   · EM8's states, in the canvas's words; every class has its dark pair.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/email_page_d1344.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  aiTokens, canDraft, draftName, emailHref, estimateLine, founderPeople, mailboxLine, networkCard, offeredProviders, pageLabel,
  personOfRecord, PROVIDERS, quotedLine, recipientFor, sendingAccount, stateFor,
} from '../src/pages/email/emailModel.js';
import { EmailAction } from '../src/pages/email/emailParts.jsx';
import { mailApi } from '../src/lib/api/mail.js';
import { codeOnly } from './_codeOnly.mjs';

const render = (el) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));

test('the Email action shows only on a record with a person', () => {
  assert.equal(personOfRecord('validate', 'customer-research', '11'), 'interviewee:11');
  assert.equal(personOfRecord('raise', 'capital-relationships', '21'), 'prospect:21');
  assert.equal(personOfRecord('build', 'founding-team', 'h-5'), 'cofounder:h-5');
  assert.equal(personOfRecord('grow', 'partner-network', 'gp1abc'), 'growth_partner:gp1abc');
  assert.equal(personOfRecord('build', 'founding-team', '5'), null, 'a holder id without h- is no co-founder');
  assert.equal(personOfRecord('grow', 'revenue-and-traction', '3'), null, 'a module with no person');
  assert.equal(personOfRecord('validate', 'customer-research', ''), null);
  assert.equal(personOfRecord('validate', 'customer-research', 'new'), null);
  assert.equal(personOfRecord('constructor', undefined, '1'), null, 'an inherited key is no module');
  assert.equal(personOfRecord('__proto__', 'x', '1'), null);
  assert.equal(render(React.createElement(EmailAction, { person: null })), '', 'no person, no button');
  const html = render(React.createElement(EmailAction, { person: 'prospect:21', from: 'Ben · Capital relationships' }));
  assert.match(html, /data-testid="email-action"/);
  assert.match(html, /href="\/email\?person=prospect%3A21&amp;compose=1&amp;from=Ben\+%C2%B7\+Capital\+relationships"/);
  assert.equal(emailHref('member:abc'), '/email?person=member%3Aabc&compose=1');
  // The action is mounted once, in the record route, for every record body.
  // D1454 (#3710, IV-D1): it goes into the record's one action row (after Ask), never a row of its own.
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.match(route, /<RecordHeaderProvider[\s\S]*?email=\{recordState\.data && personOfRecord\(cycle, slug, recordId\)\s*\?\s*<EmailAction person=\{personOfRecord\(cycle, slug, recordId\)\}/);
  assert.doesNotMatch(route, /<div className="flex justify-end">\s*<EmailAction/, 'no lone Email row');
});

test('no other member\'s address is rendered unless the shares read serves it', () => {
  const member = { ref: 'member:u1', kind: 'member', address: 'leak@example.invalid' };
  assert.equal(recipientFor(member, []), null, 'a match\'s address never comes from the pack');
  assert.equal(recipientFor(member, [{ uid: 'u1', ready: false, address: 'early@example.invalid' }]), null, 'not until both have shared');
  assert.equal(recipientFor(member, [{ uid: 'u1', ready: true, address: 'sam@example.invalid' }]), 'sam@example.invalid');
  assert.equal(recipientFor(member, [{ uid: 'u2', ready: true, address: 'other@example.invalid' }]), null, 'another pair\'s share is not this one\'s');
  assert.equal(recipientFor({ ref: 'prospect:21', kind: 'prospect', address: 'ben@example.invalid' }, []), 'ben@example.invalid', 'a record\'s own address');
  assert.equal(recipientFor({ ref: 'interviewee:11', kind: 'interviewee', address: null }, []), null, 'none recorded: asked for, never guessed');
  // The page reads a match's address only through recipientFor; the pack's person.address is never drawn for a member.
  const page = readFileSync(new URL('../src/pages/email/EmailPage.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /person\.address/, 'the page never draws the pack\'s address directly');
  assert.match(page, /const to = recipientFor\(person, shares\);/);
});

test('the estimate is shown before every draft, and Draft waits for it', () => {
  assert.equal(aiTokens(6000), '$0.0060');
  assert.equal(aiTokens(1_250_000), '$1.25');
  assert.equal(aiTokens(null), null, 'no figure is never $0');
  assert.equal(estimateLine(null), null);
  assert.equal(estimateLine({ hold_microusd: 6000 }), 'Draft with Eadwyn · holds up to $0.0060 in AI tokens. Nothing is charged until you press Draft.');
  assert.equal(canDraft({ estimate: null, intent: 'thank_follow_up' }), false, 'no estimate, no Draft');
  assert.equal(canDraft({ estimate: { hold_microusd: 6000 }, intent: null }), false, 'no intent, no Draft');
  assert.equal(canDraft({ estimate: { hold_microusd: 6000 }, intent: 'thank_follow_up', busy: true }), false);
  assert.equal(canDraft({ estimate: { hold_microusd: 6000 }, intent: 'thank_follow_up' }), true);
  const sheet = codeOnly(readFileSync(new URL('../src/pages/email/ComposeSheet.jsx', import.meta.url), 'utf8'));
  assert.match(sheet, /disabled=\{!canDraft\(\{ estimate, intent, busy \}\)\} onClick=\{press\}/, 'Draft and Regenerate both wait for the estimate');
  assert.equal((sheet.match(/canDraft\(\{ estimate, intent, busy \}\)/g) || []).length, 2);
  assert.match(sheet, /api\.estimate\(ask\)/, 'the estimate is read for the exact request Draft sends');
  assert.match(sheet, /setConfirm\(true\)/, 'Send is behind a confirmation');
  assert.doesNotMatch(sheet, /Gmail drafts|Schedule/, 'no Copy to Gmail drafts (D1347 §3), no Schedule without a Worker route');
});

test('connect: only the providers the Worker offers; Gmail sends only; no Save to Gmail drafts', () => {
  assert.deepEqual(offeredProviders({ outlook: true, gmail: false, imap: true }).map((p) => p.key), ['outlook', 'imap']);
  assert.deepEqual(offeredProviders({ outlook: true, gmail: true, imap: true, mcp: true }).map((p) => p.key), ['gmail', 'outlook', 'imap', 'mcp']);
  assert.deepEqual(offeredProviders(undefined), []);
  assert.match(PROVIDERS[0].cannot, /Does not read your inbox/);
  const connect = codeOnly(readFileSync(new URL('../src/pages/email/ConnectPanel.jsx', import.meta.url), 'utf8'));
  assert.doesNotMatch(connect, /Save drafts to your Gmail drafts|Gmail drafts/);
  assert.equal(mailboxLine({ provider: 'gmail', address: 'me@example.invalid', can_read: false }), 'Gmail · me@example.invalid · sends only');
  assert.equal(mailboxLine({ provider: 'outlook', address: 'me@example.invalid', can_read: true }), 'Outlook · me@example.invalid · sends and shows replies');
  assert.equal(sendingAccount([{ uid: 'a', status: 'expired' }, { uid: 'b', status: 'active' }]).uid, 'b');
  assert.equal(sendingAccount([{ uid: 'a', status: 'expired' }]), null);
});

test('the states, the Network cards and the People pane, in the canvas\'s words', () => {
  assert.deepEqual(stateFor('no_address', { name: 'Tom Sample', module: 'Customer research' }),
    { title: 'No email address on record', line: 'Tom Sample has no address in Customer research.', action: 'Add their email' });
  assert.equal(stateFor('not_shared', { name: 'Sam Match' }).line, 'Sam Match hasn’t shared their address. You can email them once they do.');
  assert.equal(stateFor('no_mailbox').title, 'No mailbox connected');
  assert.equal(stateFor('nonsense'), null);
  const line = 'You’re matched. Email needs both of you to share an address.';
  assert.equal(networkCard({ name: 'Sam', ready: false, mine: 'pending', line }).line, line, 'D1347 §3: "You\'re matched"');
  assert.equal(networkCard({ name: 'Sam', ready: false, mine: 'shared' }).title, 'Waiting for Sam');
  assert.equal(networkCard({ name: 'Sam', ready: true, mine: 'shared' }).action, 'Email Sam');
  const groups = founderPeople({
    drafts: [
      { uid: 'd2', person: 'prospect:21', created_at: '2026-10-20 10:00:00', sources: [{ ref: 'prospect:21', label: 'Capital relationships · Ben Investor' }] },
      { uid: 'd1', person: 'prospect:21', created_at: '2026-10-19 10:00:00', sources: [] },
      { uid: 'd0', person: 'member:x', created_at: '2026-10-18 10:00:00', sources: [] },
    ],
    shares: [{ uid: 'x', person: 'member:x', name: 'Sam Match', matched_at: '2026-10-20 09:00:00' }],
  });
  assert.deepEqual(groups.map((g) => [g.key, g.people.map((p) => p.ref)]), [['recent', ['prospect:21']], ['network', ['member:x']]], 'one row per person; a match is in Network only');
  assert.equal(groups[0].people[0].name, 'Ben Investor');
  assert.equal(groups[1].people[0].source, 'Network · accepted 2026-10-20');
  assert.equal(draftName({ person: 'interviewee:9', sources: [] }), 'interviewee:9');
  assert.equal(pageLabel(2, 20, 23), '21–23 of 23');
  assert.equal(pageLabel(1, 20, 0), '0 sent');
  assert.equal(pageLabel(1, 20, undefined), null);
  assert.equal(quotedLine({ quoted: [] }), 'Quoted: nothing', 'never blank');
});

test('every page method the Email page calls has its client method, and each class has a dark pair', () => {
  for (const m of ['accounts', 'connect', 'connectImap', 'verifyAccount', 'disconnect', 'confirmSend', 'send', 'context', 'estimate', 'draft', 'revise', 'drafts', 'shares', 'share', 'sent']) {
    assert.equal(typeof mailApi[m], 'function', m);
  }
  for (const f of ['EmailPage.jsx', 'ComposeSheet.jsx', 'ConnectPanel.jsx', 'EmailSettings.jsx', 'emailParts.jsx']) {
    const src = readFileSync(new URL(`../src/pages/email/${f}`, import.meta.url), 'utf8');
    for (const light of ['bg-white', 'text-axal-ink', 'border-axal-hairline']) {
      if (src.includes(light)) assert.match(src, /dark:/, `${f} draws ${light} with no dark pair`);
    }
  }
});
