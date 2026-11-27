/**
 * Canvas transactional templates M1–M5 from Emails.dc.html.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderCapitalCall,
  renderSignatureRequest,
  renderSpinoutDecision,
  renderWeeklyDigest,
  renderWorkspaceInvite,
} from '../src/services/email/canvasTransactional';
import { SENDER_POSTAL } from '../src/services/email/inviteChrome';

const baseTo = 'ines@meridianrobotics.nl';

test('M1 workspace invite states role before CTA and omits unsubscribe', () => {
  const out = renderWorkspaceInvite({
    to: baseTo,
    inviteeEmail: 'lukas@meridianrobotics.nl',
    inviterName: 'Ines Marchetti',
    inviterRole: 'Founder',
    workspaceName: 'Meridian Robotics',
    roleName: 'Engineer',
    seatType: 'Full-time · internal',
    joinUrl: 'https://app.axal.vc/join/abc',
  });
  assert.match(out.subject, /Ines Marchetti invited you to Meridian Robotics/);
  assert.match(out.html, /YOUR SEAT/);
  assert.match(out.html, /Engineer/);
  assert.match(out.html, /Join Meridian Robotics/);
  assert.doesNotMatch(out.html, /Unsubscribe/i);
  assert.ok(out.html.includes(SENDER_POSTAL));
});

test('M2 signature request carries security note and amber expiry', () => {
  const out = renderSignatureRequest({
    to: baseTo,
    documentTitle: 'SAFE — Meridian Robotics',
    companyName: 'Meridian Robotics B.V.',
    counterparty: 'Latitude Seed · countersigned',
    signatorySummary: '2 of 2 · you are the last',
    expiresAt: '2 Sep 2026 · 18:00 CEST',
    signUrl: 'https://app.axal.vc/sign/xyz',
  });
  assert.match(out.subject, /Signature requested/);
  assert.match(out.html, /SIGNATURE REQUEST/);
  assert.match(out.html, /BEFORE YOU CLICK/);
  assert.match(out.html, /notifications@axal\.vc/);
  assert.match(out.html, /#92400e/);
  assert.doesNotMatch(out.html, /Unsubscribe/i);
});

test('M3 capital call states wire-never-in-email rule', () => {
  const out = renderCapitalCall({
    to: 'm.halloran@keystone.lp',
    fundName: 'Axal VC Fund II',
    callNumber: 3,
    callPercent: 18,
    commitmentFormatted: '€2,000,000',
    calledToDateFormatted: '€840,000',
    priorPercent: 42,
    amountDueFormatted: '€360,000',
    dueDate: '9 Sep 2026',
    unfundedFormatted: '€800,000',
    unfundedPercent: 40,
    viewUrl: 'https://app.axal.vc/lp/calls/3',
    asAtDate: '26 Aug 2026',
  });
  assert.match(out.subject, /Capital call №3/);
  assert.match(out.html, /CAPITAL CALL/);
  assert.match(out.html, /WIRE INSTRUCTIONS/);
  assert.match(out.html, /never sent by email/i);
  assert.doesNotMatch(out.html, /Unsubscribe/i);
});

test('M4 weekly digest is the only transactional template with digest unsubscribe', () => {
  const out = renderWeeklyDigest({
    to: baseTo,
    weekLabel: '24 August',
    cards: [{
      kicker: 'METRICS · MERIDIAN ROBOTICS',
      title: 'MRR up 8% on last week',
      figure: '+8%',
      figNote: 'wk/wk',
      figInk: '#047857',
      body: 'Two pilots converted to paid.',
      link: 'Open Metrics',
    }],
    dashboardUrl: 'https://app.axal.vc/dashboard',
    frequencyUrl: 'https://app.axal.vc/account/notifications/frequency',
    unsubscribeUrl: 'https://axal.vc/api/notifications/unsubscribe?token=abc',
  });
  assert.match(out.html, /WEEKLY DIGEST/);
  assert.match(out.html, /Manage frequency/);
  assert.match(out.html, /Unsubscribe from digests/);
  assert.doesNotMatch(out.html, />Unsubscribe<\/a>/);
});

test('M5 spin-out decision carries numbered checklist', () => {
  const out = renderSpinoutDecision({
    to: baseTo,
    companyName: 'Meridian Robotics',
    cohortLabel: 'Cohort 7',
    decisionParagraph: 'Meridian Robotics is one of eight companies in Cohort 7.',
    programmeRows: [
      { k: 'Cohort', v: 'Spin-Out Lab · Cohort 7' },
      { k: 'Starts', v: '28 Sep 2026' },
      { k: 'Demo Day', v: '26 Oct 2026' },
      { k: 'Companies', v: '8', last: true },
    ],
    checklist: [
      { n: '01', k: 'Accept your place', v: 'Within five working days.' },
      { n: '02', k: 'Name your TU Delft contact', v: 'We open the licence conversation in week one.' },
    ],
    onboardingUrl: 'https://app.axal.vc/spinout/onboard',
    acceptDeadline: '2 September',
  });
  assert.match(out.subject, /You're in — Spin-Out Lab Cohort 7/);
  assert.match(out.html, /SPIN-OUT LAB · COHORT 7/);
  assert.match(out.html, /BEFORE 28 SEPTEMBER/);
  assert.match(out.html, /Accept your place/);
  assert.doesNotMatch(out.html, /Unsubscribe/i);
});
