/**
 * The role wizards sit inside the app shell. The licence picker does not.
 *
 * `/onboarding` keeps its own logo, on the landscape, because nothing else
 * is on screen. `/onboarding/founder` (and the investor and partner wizards)
 * already have the header logo and the sidebar. A second logo in the body,
 * and a background that stops inside the shell's padding, are the two
 * things this pins down.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = read('../src/App.jsx');
const shell = read('../src/components/auth/AuthShell.jsx');
const css = read('../src/index.css');
const sidebar = read('../src/sidebarConfig.js');
const licence = read('../src/pages/ChooseLicencePage.jsx');
const founder = read('../src/pages/OnboardingFounderPage.jsx');
const investor = read('../src/pages/OnboardingInvestorPage.jsx');
const partner = read('../src/pages/OnboardingPartnerPage.jsx');

function codeOnly(src) {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('the licence picker keeps its logo and its landscape', () => {
  const body = codeOnly(licence);
  const tag = body.match(/<AuthShell[\s\S]*?>/);
  assert.ok(tag, 'the picker must still render AuthShell');
  assert.match(tag[0], /backgroundSrc="\/auth\/login-background\.webp"/);
  assert.doesNotMatch(tag[0], /\bembedded\b/, '/onboarding is not inside the app shell');
  assert.doesNotMatch(tag[0], /\bplain\b/, 'the picker paints its own background');
});

test('the three wizards drop the in-body logo and do not paint a second background', () => {
  for (const [name, src] of [['founder', founder], ['investor', investor], ['partner', partner]]) {
    const body = codeOnly(src);
    assert.match(body, /<OnboardingCanvas>/, `${name} must use the embedded canvas`);
    assert.doesNotMatch(body, /<AuthShell|<AxalLogo/, `${name} must not draw its own logo`);
  }
  const canvas = codeOnly(shell).slice(codeOnly(shell).indexOf('function OnboardingCanvas'));
  assert.match(canvas, /<AuthShell embedded wide plain>/);
  assert.doesNotMatch(canvas, /backgroundSrc/, 'the landscape is painted once, on the body, not on this box');
});

test('AuthShell hides its header when a wizard is embedded in the app', () => {
  const body = codeOnly(shell);
  const header = body.indexOf('<header');
  const logo = body.indexOf('<AxalLogo');
  const gate = body.indexOf('!embedded &&');
  assert.ok(gate > 0 && gate < header && header < logo,
    'the logo must live in the header, and the header must be skipped when embedded');
});

test('the wizard body is the landscape, edge to edge, with no footer', () => {
  assert.match(sidebar, /export const ONBOARDING_CANVAS_PATHS = \[[\s\S]*?'\/onboarding\/founder',[\s\S]*?'\/onboarding\/investor',[\s\S]*?'\/onboarding\/partner',/);
  assert.match(sidebar, /\.\.\.ONBOARDING_CANVAS_PATHS/,
    'flush and full width have to follow the same list as every other full-bleed surface');
  assert.doesNotMatch(
    codeOnly(sidebar).slice(codeOnly(sidebar).indexOf('ONBOARDING_CANVAS_PATHS')),
    /'\/onboarding',/,
    'the exact licence path must stay off this list — it is not inside the app shell',
  );
  assert.match(app, /ONBOARDING_CANVAS_PATHS\.includes\(location\.pathname\)/);
  assert.match(app, /data-onboarding-canvas/);
  assert.match(app, /onboardingCanvas \? ' flex w-full min-h-full flex-1 flex-col'/);
  assert.match(app, /\{!onboardingCanvas && \(/,
    'the footer is a band of the body; the landscape has to reach the bottom');
  assert.match(css, /main\[data-onboarding-canvas\]/);
  assert.match(css, /url\(\/auth\/login-background\.webp\)/);
  assert.match(css, /background-size:\s*cover/);
});
