/**
 * D6991 (#6991) — one set of Spin-Out Lab week names, owner answer F1 on #6976:
 * Week 1 Test demand, Week 2 Build, Week 3 Pitch, Week 4 Prepare to raise, and
 * formation "depends on your starting point". The list lives in
 * lib/spinoutLab.js; the homepage band, the Lab page, the brief, the events
 * card and the methodology page import it and declare none of their own. The
 * methodology page's Validate, Build, Raise, Grow are labelled as the company
 * lifecycle, apart from the Lab's weeks.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_lab_week_names_6991.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import {
  LAB_FORMATION, LAB_WEEKS, PIPELINE_PHASES, formationItemsFor, pipelineItemsFor,
} from '../src/lib/spinoutLab.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** Every surface that names the Lab's weeks. */
const SURFACES = [
  'pages/LandingPage.jsx',
  'components/spinout/LabIntro.jsx',
  'pages/SpinoutLabPage.jsx',
  'pages/SpinoutLabBriefPage.jsx',
  'lib/spinoutBrief.js',
  'pages/events/PublicEventsPage.jsx',
  'lib/siteMethod.js',
  'pages/site/MethodologyPage.jsx',
];

/** Week names any of those pages used before D6991, and the shared ones. */
const OLD = ['Idea & Customer', 'Solution & Roadmap', 'Validate & Team', 'Incorporate & Capital'];
const NAMES = ['Test demand', 'Build', 'Pitch', 'Prepare to raise'];

test('the one list: the owner\'s F1 names, in order, each with one line', () => {
  assert.deepEqual(LAB_WEEKS.map((w) => w.name), NAMES);
  assert.deepEqual(LAB_WEEKS.map((w) => w.n), ['Week 1', 'Week 2', 'Week 3', 'Week 4']);
  assert.deepEqual(PIPELINE_PHASES.map((p) => p.name), NAMES, 'the gates the Lab checks carry the same names');
  for (const w of LAB_WEEKS) {
    assert.ok(typeof w.desc === 'string' && w.desc.length > 20 && !w.desc.includes('\n'), `${w.name} has a one-line description`);
    assert.ok(!/\bFund\b/.test(w.name + w.desc), 'no week promises funding');
  }
  assert.ok(Object.isFrozen(LAB_WEEKS));
});

test('formation sits in no week and reads "depends on your starting point"', () => {
  assert.match(LAB_FORMATION, /^Formation depends on your starting point\./);
  const formation = /incorporat|83\(b\)|83\(i\)|formation|entity/i;
  for (const p of PIPELINE_PHASES) {
    for (const item of pipelineItemsFor(p)) assert.ok(!formation.test(item), `${p.name} lists formation: ${item}`);
    assert.ok(!formation.test(p.desc), `${p.name}'s line places formation in it`);
  }
  assert.deepEqual(formationItemsFor('de'), ['Delaware C-Corp incorporation', '83(b) election filing']);
});

test('no surface declares its own week names', () => {
  for (const file of SURFACES) {
    const src = codeOnly(read(file));
    for (const name of [...OLD, 'Test demand', 'Prepare to raise']) {
      assert.ok(!src.includes(`'${name}'`) && !src.includes(`"${name}"`) && !src.includes(`>${name}<`),
        `${file} types the week name "${name}"`);
    }
    assert.doesNotMatch(src, /\{\s*n:\s*['"]Week \d/, `${file} declares a week list of its own`);
    assert.doesNotMatch(src, /Validate, Build, Pitch, Fund/, `${file} types the old Lab names`);
  }
  for (const file of ['pages/LandingPage.jsx', 'pages/site/MethodologyPage.jsx', 'pages/SpinoutLabPage.jsx']) {
    assert.match(read(file), /\bLAB_WEEKS\b[^\n]*\n?[^\n]*from ['"][./]+lib\/spinoutLab['"]|import \{[^}]*\bLAB_WEEKS\b[^}]*\} from ['"][./]+lib\/spinoutLab['"]/, `${file} imports LAB_WEEKS from lib/spinoutLab`);
  }
});

test('methodology: the lifecycle is labelled as such and the Lab section draws the Lab\'s weeks', async () => {
  const { default: MethodologyPage } = await import('../src/pages/site/MethodologyPage.jsx');
  const t = text(renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/methodology'] }, React.createElement(MethodologyPage))));
  const stages = t.slice(t.indexOf('The company lifecycle'), t.indexOf('The methodology in motion.'));
  assert.ok(stages.startsWith('The company lifecycle · four stages'), 'the four stages are labelled as the company lifecycle');
  for (const s of ['Validate', 'Build', 'Raise', 'Grow']) assert.ok(stages.includes(s), `the lifecycle keeps ${s}`);
  const lab = t.slice(t.indexOf('The methodology in motion.'), t.indexOf('The result is not simply a pitch.'));
  assert.match(lab, /not the four lifecycle stages above/, 'the Lab section says its weeks are not the stages');
  assert.doesNotMatch(lab, /Each week maps to one stage|through all four stages/);
  let at = -1;
  for (const w of LAB_WEEKS) {
    const i = lab.indexOf(w.name);
    assert.ok(i > at, `the Lab section draws ${w.name} in order`);
    assert.ok(lab.includes(w.desc), `and its line`);
    at = i;
  }
  for (const s of ['Raise', 'Grow']) assert.ok(!lab.includes(` ${s} `), `the Lab section no longer names the stage ${s} as a week`);
});

test('the Lab page and the brief draw the formation line once, under the gates', async () => {
  const { LabGates } = await import('../src/components/spinout/LabIntro.jsx');
  const gates = text(renderToStaticMarkup(React.createElement(LabGates, { jurisdiction: 'wy' })));
  for (const w of LAB_WEEKS) assert.ok(gates.includes(w.name), `the gates name ${w.name}`);
  assert.equal(gates.split('Formation depends on your starting point').length - 1, 1);
  assert.ok(gates.includes(formationItemsFor('wy')[0]), 'with the chosen jurisdiction\'s incorporation line');
  const brief = codeOnly(read('pages/SpinoutLabBriefPage.jsx'));
  assert.equal(brief.split('{LAB_FORMATION}').length - 1, 1, 'the brief prints the formation line once');
});
