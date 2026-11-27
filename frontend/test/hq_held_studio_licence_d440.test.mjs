/**
 * D440 — HQ-held Studio and My Licence.
 *
 * Off a branch, Studio's Open links are the S20 rows (the render guard lives
 * in held_admin_shell_d286.test.mjs and admin_studio_overview.test.mjs).
 * This file holds the other three defects: the appeal that pointed at a
 * page HQ refuses, a missing seat printed as zero, and a domain removed
 * on one click.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { LicenceAppeal, seatFigure } from '../src/pages/subsidiary/MyLicencePage.jsx';
import { hostnameConfirmsRemoval } from '../src/components/licence/DomainWizard.jsx';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/subsidiary/MyLicencePage.jsx'));
const WIZARD = codeOnly(read('frontend/src/components/licence/DomainWizard.jsx'));
const API = codeOnly(read('frontend/src/lib/api.js'));

const render = (node) => renderToStaticMarkup(createElement(MemoryRouter, null, node));

test('a branch appeal opens the approvals page, and an HQ-held account is told there is none', () => {
  const on = render(createElement(LicenceAppeal, { onBranch: true }));
  assert.match(on, /href="\/branch\/approvals"/, 'a branch appeal stopped opening the page that answers');
  assert.match(on, /open one/);

  const off = render(createElement(LicenceAppeal, { onBranch: false }));
  assert.doesNotMatch(off, /href="\/branch\//, 'an HQ-held appeal still links a page that refuses on HQ');
  assert.match(off, /No appeal from this page/);
  assert.match(off, /refuses here/);
  assert.match(PAGE, /<LicenceAppeal onBranch=\{onBranch\}/);
  assert.match(PAGE, /branchOfUser\(user\)/);
});

test('a seat the copy omitted is not zero, and a measured zero stays zero', () => {
  const missing = renderToStaticMarkup(seatFigure(undefined));
  assert.match(missing, /Not recorded/);
  assert.match(missing, /not shown as zero/);
  assert.doesNotMatch(missing, />0</, 'a missing seat rendered as zero');

  const absent = renderToStaticMarkup(seatFigure(null));
  assert.match(absent, /Not recorded/);

  const zero = renderToStaticMarkup(seatFigure(0));
  assert.equal(zero, '0');
  assert.doesNotMatch(zero, /Not recorded/, 'a measured zero was drawn as an absence');

  const ten = renderToStaticMarkup(seatFigure(10));
  assert.equal(ten, '10');

  assert.match(PAGE, /seatFigure\(seats\[k\]\)/);
  assert.doesNotMatch(PAGE, /seats\[k\] \?\? 0/, 'the page prints zero for a seat the copy did not carry');
});

test('removing a host requires the bound hostname, and the typed value is what is sent', () => {
  assert.equal(hostnameConfirmsRemoval('app.example.com', 'app.example.com'), true);
  assert.equal(hostnameConfirmsRemoval('APP.example.com', 'app.example.com'), false,
    'a different spelling confirms a removal the route will be asked to refuse');
  assert.equal(hostnameConfirmsRemoval('other.example.com', 'app.example.com'), false);
  assert.equal(hostnameConfirmsRemoval('', 'app.example.com'), false);
  assert.equal(hostnameConfirmsRemoval('app.example.com', ''), false);
  assert.equal(hostnameConfirmsRemoval('app.example.com', null), false);

  assert.match(WIZARD, /data-testid="domain-remove-hostname"/);
  assert.match(WIZARD, /Type the hostname to confirm/);
  assert.match(WIZARD, /hostnameConfirmsRemoval\(confirmHost, domain\.hostname\)/);
  assert.match(WIZARD, /api\.myDomainRemove\(confirmHost\)/);
  assert.doesNotMatch(WIZARD, /myDomainRemove\(\)/, 'Remove still sends no hostname');
  assert.doesNotMatch(WIZARD, /onClick=\{\(\) => run\('remove'/,
    'Remove fires on the first click, before the hostname is typed');

  const at = API.indexOf('myDomainRemove:');
  const slice = API.slice(at, at + 240);
  assert.match(slice, /request\('\/licence\/mine\/domain'/);
  assert.match(slice, /method: 'DELETE'/);
  assert.match(slice, /JSON\.stringify\(\{ hostname \}\)/,
    'the typed hostname is not in the DELETE body');
});
