/**
 * Persona invitations: the canvas's copy, and the unsubscribe rule.
 *
 * The rule is the reason these tests exist. The Emails canvas states it in one
 * line — unsubscribe appears on the weekly digest and the broadcast
 * invitations, never on transactional mail, and never on the GP's personal
 * notes — and every clause of that can be got wrong in a way no compiler and
 * no reviewer reliably catches. Omitting it from a broadcast is a compliance
 * problem. Showing it on a password reset invites someone to unsubscribe from
 * their own account. Showing it under "I am writing personally because a
 * template would undersell this" makes the message contradict its own first
 * sentence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONA_INVITES, PERSONA_KEYS, isPersonaKey } from '../src/services/email/personaInvites';
import { footerFor, unsubscribeAllowed, SENDER_POSTAL } from '../src/services/email/inviteChrome';
import { renderInvite, kindFor } from '../src/services/email/personaInviteRender';

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

// ---------- the unsubscribe rule ----------

test('only a broadcast may carry an unsubscribe link', () => {
  assert.equal(unsubscribeAllowed('broadcast'), true);
  assert.equal(unsubscribeAllowed('transactional'), false);
  assert.equal(unsubscribeAllowed('personal'), false);
});

test('a broadcast without an unsubscribe URL throws rather than dropping the link', () => {
  // Silently rendering a broadcast with no exit is the failure that would ship.
  assert.throws(
    () => footerFor('broadcast', { to: base.to }),
    /requires an unsubscribeUrl/,
  );
});

test('transactional and personal footers say why there is no exit', () => {
  for (const kind of ['transactional', 'personal'] as const) {
    const f = footerFor(kind, { to: base.to });
    assert.doesNotMatch(f, /Unsubscribe<\/a>/, `${kind} must not offer unsubscribe`);
    assert.match(f, /essential to your account/, `${kind} must explain the absence`);
  }
});

test('every footer carries the postal identity', () => {
  // A bulk sender has to show it, and it is the field most likely to be
  // forgotten in exactly the template nobody re-reads.
  const fs = [
    footerFor('broadcast', { ...base, unsubscribeUrl: 'https://axal.vc/u/abc' }),
    footerFor('transactional', base),
    footerFor('personal', base),
  ];
  for (const f of fs) assert.ok(f.includes(SENDER_POSTAL));
});

test('the variant fixes the kind — a personal note can never be a broadcast', () => {
  assert.equal(kindFor('personal'), 'personal');
  assert.equal(kindFor('broadcast'), 'broadcast');
});

// ---------- rendering ----------

test('the personal note drops the bullets and the marketing headline', () => {
  const p = PERSONA_INVITES.founder;
  const out = renderInvite({ ...base, persona: 'founder', variant: 'personal', gpName: 'Guillaume' });
  assert.doesNotMatch(out.html, new RegExp(p.h1.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'the broadcast headline has no place in a personal note');
  for (const [label] of p.bullets) {
    assert.ok(!out.html.includes(`<strong style="color:#18181b;">${label}</strong>`),
      `bullet "${label}" leaked into the personal note`);
  }
  assert.ok(out.html.includes(p.gpNote[0].replace(/'/g, '&#39;')) || out.html.includes(p.gpNote[0]));
  assert.match(out.html, /Guillaume/);
  assert.doesNotMatch(out.html, /Unsubscribe<\/a>/);
});

test('the broadcast carries the headline, all five bullets and an unsubscribe', () => {
  const out = renderInvite({
    ...base, persona: 'investor', variant: 'broadcast',
    unsubscribeUrl: 'https://axal.vc/u/abc',
    reason: 'because you hold an Investor licence',
  });
  const p = PERSONA_INVITES.investor;
  assert.equal(out.subject, p.h1);
  for (const [label] of p.bullets) assert.ok(out.html.includes(label), `missing bullet ${label}`);
  assert.match(out.html, /Unsubscribe<\/a>/);
  assert.match(out.html, /because you hold an Investor licence/);
});

test('no image can be load-bearing — the chrome has none', () => {
  // The canvas: "anything an image blocker removes must not be load-bearing".
  // The wordmark is text, so there is no <img> to block.
  const out = renderInvite({ ...base, persona: 'partner', variant: 'broadcast',
    unsubscribeUrl: 'https://axal.vc/u/abc' });
  assert.doesNotMatch(out.html, /<img/i);
  assert.match(out.html, /Axal VC<\/div>/);
});

test('the text part is not empty and carries the link', () => {
  for (const k of PERSONA_KEYS) {
    for (const variant of ['broadcast', 'personal'] as const) {
      const out = renderInvite({
        ...base, persona: k, variant,
        unsubscribeUrl: variant === 'broadcast' ? 'https://axal.vc/u/abc' : undefined,
      });
      assert.ok(out.text.trim().length > 80, `${k}/${variant} text part is too thin`);
      assert.ok(out.text.includes(base.ctaUrl), `${k}/${variant} text part lost the link`);
      assert.ok(out.subject.trim().length > 0);
    }
  }
});

test('copy is escaped, not interpolated raw', () => {
  const out = renderInvite({
    ...base, to: '<script>alert(1)</script>@x.com', persona: 'founder', variant: 'broadcast',
    unsubscribeUrl: 'https://axal.vc/u/abc', reason: '<img src=x onerror=alert(1)>',
  });
  // Assert the PROPERTY, not the absence of a substring. Escaping turns
  // `<img src=x onerror=alert(1)>` into `&lt;img src=x onerror=alert(1)&gt;`,
  // which is inert — but the literal text `onerror=` is still in the document,
  // as text, exactly as intended. The first version of this test matched
  // /onerror=/ and failed against correctly-escaped output.
  assert.doesNotMatch(out.html, /<script/i, 'no live script tag');
  assert.doesNotMatch(out.html, /<img/i, 'no live img tag');
  assert.match(out.html, /&lt;img src=x onerror=alert\(1\)&gt;/, 'the payload survives only as escaped text');
  // The address only renders when no `reason` is given — `reason` replaces the
  // default "Sent to {to}." line. Asserting both in one case checked a string
  // that was never in the document.
  const noReason = renderInvite({
    ...base, to: '<script>alert(1)</script>@x.com', persona: 'founder', variant: 'broadcast',
    unsubscribeUrl: 'https://axal.vc/u/abc',
  });
  assert.match(noReason.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'the address is escaped');
  assert.doesNotMatch(noReason.html, /<script/i);
});
