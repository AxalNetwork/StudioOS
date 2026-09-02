/**
 * Persona invitations: canvas copy and the unsubscribe rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONA_INVITES, PERSONA_KEYS, isPersonaKey } from '../src/services/email/personaInvites';
import { footerFor, unsubscribeAllowed, SENDER_POSTAL } from '../src/services/email/inviteChrome';
import { renderInvite, kindFor } from '../src/services/email/personaInviteRender';
import { GP_INVITER } from '../src/services/email/canvasEmailParts';

const base = { to: 'ines@example.com', ctaUrl: 'https://axal.vc/register?p=founder' };

test('all four personas carry both variants', () => {
  assert.deepEqual(PERSONA_KEYS, ['founder', 'investor', 'advisor', 'partner']);
  for (const k of PERSONA_KEYS) {
    const p = PERSONA_INVITES[k];
    assert.equal(p.bullets.length, 5, `${k} lost a bullet`);
    assert.ok(p.gpNote.length >= 3, `${k} personal note is too short to be one`);
    assert.ok(p.h1 && p.line && p.cta && p.gpCta, `${k} is missing copy`);
    for (const [label, detail] of p.bullets) assert.ok(label && detail);
  }
});

test('isPersonaKey rejects anything else', () => {
  for (const v of ['admin', 'exploring', '', 'Founder', null, 7, {}]) {
    assert.equal(isPersonaKey(v), false, `${JSON.stringify(v)} must not be a persona`);
  }
  assert.equal(isPersonaKey('founder'), true);
});

test('only a broadcast may carry an unsubscribe link', () => {
  assert.equal(unsubscribeAllowed('broadcast'), true);
  assert.equal(unsubscribeAllowed('transactional'), false);
  assert.equal(unsubscribeAllowed('personal'), false);
});

test('a broadcast without an unsubscribe URL throws rather than dropping the link', () => {
  assert.throws(
    () => footerFor('broadcast', { to: base.to }),
    /requires an unsubscribeUrl/,
  );
});

test('transactional footers omit unsubscribe', () => {
  const f = footerFor('transactional', { to: base.to, reason: 'Sent because you were invited.' });
  assert.doesNotMatch(f, /Unsubscribe/i);
});

test('personal footers omit unsubscribe link and postal line', () => {
  const f = footerFor('personal', { to: base.to });
  assert.doesNotMatch(f, /Unsubscribe<\/a>/);
  assert.doesNotMatch(f, /16192 Coastal Hwy/);
});

test('broadcast and transactional footers carry the postal identity', () => {
  const fs = [
    footerFor('broadcast', { ...base, unsubscribeUrl: 'https://axal.vc/u/abc' }),
    footerFor('transactional', base),
  ];
  for (const f of fs) assert.ok(f.includes(SENDER_POSTAL));
});

test('the variant fixes the kind — a personal note can never be a broadcast', () => {
  assert.equal(kindFor('personal'), 'personal');
  assert.equal(kindFor('broadcast'), 'broadcast');
});

test('Set B personal note has greeting band and inviter sign-off, not broadcast bullets', () => {
  const p = PERSONA_INVITES.founder;
  const out = renderInvite({ ...base, persona: 'founder', variant: 'personal', firstName: 'Ines' });
  assert.equal(out.subject, 'A note about Axal VC');
  assert.doesNotMatch(out.html, new RegExp(p.h1.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(out.html, /Hi Ines,/);
  assert.match(out.html, /background:#f4f0fe/);
  assert.match(out.html, new RegExp(GP_INVITER.name));
  for (const [label] of p.bullets) {
    assert.ok(!out.html.includes(`>${label}</strong>`), `bullet "${label}" leaked`);
  }
  assert.doesNotMatch(out.html, /Unsubscribe<\/a>/);
});

test('Set A broadcast has bullets, inviter block, and unsubscribe', () => {
  const out = renderInvite({
    ...base, persona: 'investor', variant: 'broadcast',
    unsubscribeUrl: 'https://axal.vc/u/abc',
  });
  const p = PERSONA_INVITES.investor;
  assert.match(out.subject, /invited to join Axal VC as an investor/i);
  for (const [label] of p.bullets) assert.ok(out.html.includes(label), `missing bullet ${label}`);
  assert.match(out.html, /Invited by/);
  assert.match(out.html, new RegExp(GP_INVITER.name));
  assert.match(out.html, /Unsubscribe<\/a>/);
  assert.match(out.html, /16192 Coastal Hwy/);
});

test('M0 chrome uses text wordmark — purple A block, no load-bearing logo img in header', () => {
  const out = renderInvite({ ...base, persona: 'partner', variant: 'broadcast',
    unsubscribeUrl: 'https://axal.vc/u/abc' });
  assert.match(out.html, /background:#7c3aed/);
  assert.match(out.html, />A</);
  assert.match(out.html, /Axal VC/);
});

test('inviter photo is decorative — alt text present in sign-off only', () => {
  const out = renderInvite({ ...base, persona: 'founder', variant: 'broadcast',
    unsubscribeUrl: 'https://axal.vc/u/abc' });
  const imgs = out.html.match(/<img/gi) || [];
  assert.equal(imgs.length, 1, 'exactly one decorative headshot in inviter block');
  assert.match(out.html, /alt="Guillaume Lauzier"/);
});

test('copy is escaped, not interpolated raw', () => {
  const out = renderInvite({
    ...base, to: '<script>alert(1)</script>@x.com', persona: 'founder', variant: 'broadcast',
    unsubscribeUrl: 'https://axal.vc/u/abc', reason: '<img src=x onerror=alert(1)>',
  });
  assert.doesNotMatch(out.html, /<script/i);
  assert.doesNotMatch(out.html, /<img src=x/i);
  assert.match(out.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
