// D1379: what Google's OAuth verification reads on axal.vc: the privacy policy's
// Google user data section (with the Limited Use statement), and a homepage that
// names the app and says what it does before any script runs or anyone signs in.
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/google_verification_d1379.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const { default: PrivacyPage } = await import('../src/pages/PrivacyPage.jsx');
const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('D1379 the Privacy Policy has a Google user data section with the Limited Use statement', () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/privacy'] }, React.createElement(PrivacyPage)));
  assert.match(html, /<span class="ax-mono ax-legal-n">09<\/span><h2 id="ax-legal-s9" class="ax-legal-h2">Google user data<\/h2>/);
  const body = text(html);
  assert.ok(body.includes('Axal VC\'s use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy , including the Limited Use requirements.'),
    'Google\'s required Limited Use sentence');
  assert.match(html, /href="https:\/\/developers\.google\.com\/terms\/api-services-user-data-policy"/);
  for (const product of ['Google Calendar:', 'Google Meet:', 'Google Drive and Google Sheets:', 'Gmail:']) assert.ok(body.includes(product), product);
  assert.ok(body.includes('We do not use it to train generalized AI or machine-learning models.'));
  assert.ok(body.includes('deletes the stored tokens and revokes Axal VC\'s access'));
  assert.match(html, /href="https:\/\/myaccount\.google\.com\/permissions"/);
});

test('D1379 the homepage shell names Axal VC and says what it does before the app starts', () => {
  const index = src('frontend/index.html');
  const root = index.slice(index.indexOf('<div id="root">'), index.indexOf('<script', index.indexOf('<div id="root">')));
  assert.match(root, /<h1[^>]*>Axal VC<\/h1>/);
  assert.match(root, /founders validate an idea with customer interviews/i);
  assert.match(root, /href="\/privacy"/);
  assert.match(root, /href="\/terms"/);
  assert.match(index, /<title>Axal VC — from idea to funded company<\/title>/);
  assert.doesNotMatch(index, /Global Venture Partner Network — partners/);
});

test('D1379 the prerendered homepage description says what the app does', () => {
  const registry = src('frontend/src/lib/ogRegistry.js');
  const home = registry.slice(registry.indexOf("path: '/',"), registry.indexOf("path: '/spinout-lab'"));
  assert.match(home, /Axal VC is a venture studio platform: founders validate an idea with customer interviews/);
});
