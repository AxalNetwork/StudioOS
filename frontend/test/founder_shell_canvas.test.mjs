/**
 * Pins founder zone archetypes and taglines to the Founder Workspaces Canvas
 * and Pages · Founder * detail canvases. The app SidebarNav is untouched — this
 * only asserts the page-layer IA that ZoneNav and WorkspaceShell read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHELLS } from '../src/workspaces/shellConfig.js';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const founder = SHELLS.founder;
const archetypeLabel = (zone) => zone.archetype?.label;

test('founder bucket taglines match the Founder Workspaces Canvas headings', () => {
  const expected = {
    Validate: 'Prove someone wants this',
    Build: 'Operate the company this week',
    Raise: 'Get capital, stay legal',
    Grow: 'Get customers, people, reach',
    Network: 'Work my relationships',
    Research: 'Go deep on a market or company',
  };
  for (const row of founder.rows.filter((r) => r.kind === 'bucket')) {
    assert.equal(row.tagline, expected[row.label],
      `${row.label} tagline drifted from the canvas`);
  }
});

test('founder Validate zones match Pages · Founder Validate (V1–V4)', () => {
  const validate = founder.rows.find((r) => r.label === 'Validate');
  assert.deepEqual(validate.zones.map((z) => [z.slug, archetypeLabel(z)]), [
    ['interviews', 'COLLECTION'],
    ['pain-map', 'ANALYTICS'],
    ['hypotheses', 'WORK BOARD'],
    ['verdict', 'LEDGER'],
  ]);
});

test('founder Build zones match Pages · Founder Build (FB1–FB5)', () => {
  const build = founder.rows.find((r) => r.label === 'Build');
  assert.deepEqual(build.zones.map((z) => [z.slug, archetypeLabel(z)]), [
    ['this-week', 'WORK BOARD'],
    ['board', 'WORK BOARD'],
    ['roadmap', 'WORK BOARD'],
    ['cadence', 'FEED'],
    ['kpi', 'LEDGER'],
  ]);
});

test('founder Raise zones match Pages · Founder Raise (FR1–FR6)', () => {
  const raise = founder.rows.find((r) => r.label === 'Raise');
  assert.deepEqual(raise.zones.map((z) => [z.slug, archetypeLabel(z)]), [
    ['status', 'ANALYTICS'],
    ['pitch', 'COLLECTION'],
    ['capital', 'LEDGER'],
    ['legal', 'COLLECTION'],
    ['data-room', 'COLLECTION'],
    ['liquidity', 'LEDGER'],
  ]);
});

test('founder Grow zones match Pages · Founder Grow (FG1–FG7)', () => {
  const grow = founder.rows.find((r) => r.label === 'Grow');
  assert.deepEqual(grow.zones.map((z) => [z.slug, archetypeLabel(z)]), [
    ['focus', 'ANALYTICS'],
    ['talent', 'MATCH ENGINE'],
    ['customers', 'WORK BOARD'],
    ['partnerships', 'WORK BOARD'],
    ['capital-match', 'MATCH ENGINE'],
    ['brand', 'COLLECTION'],
    ['launch', 'FEED'],
  ]);
});

test('founder Network zones match Pages · Founder Network (FN1–FN3)', () => {
  const network = founder.rows.find((r) => r.label === 'Network');
  assert.deepEqual(network.zones.map((z) => [z.slug, archetypeLabel(z)]), [
    ['relationships', 'MATCH ENGINE'],
    ['introductions', 'FEED'],
    ['organizations', 'COLLECTION'],
  ]);
});

test('founder Research zones match Pages · Founder Research (FS1–FS5)', () => {
  const research = founder.rows.find((r) => r.label === 'Research');
  assert.deepEqual(research.zones.map((z) => [z.slug, archetypeLabel(z)]), [
    ['ask', 'FEED'],
    ['markets', 'ANALYTICS'],
    ['companies', 'COLLECTION'],
    ['funds', 'MATCH ENGINE'],
    ['library', 'COLLECTION'],
  ]);
});

test('integrated workspace pages do not import the canvas license sidebar', () => {
  // Every design canvas draws a `.side` column listing all nine licence rows.
  // That nav is owned by SidebarNav in App.jsx — pages must be main + rail only.
  const dirs = [
    'frontend/src/pages/founder',
    'frontend/src/pages/investor',
    'frontend/src/workspaces/founder',
  ];
  const banned = [
    /className="[^"]*\bside\b[^"]*"/,
    /CANONICAL Investor shell/,
    /CANONICAL Founder shell/,
    /navLic/,
    /dc-import name="InvRail"/,
    /dc-import name="RailNav"/,
  ];
  const offenders = [];
  for (const dir of dirs) {
    for (const file of readdirSync(resolve(process.cwd(), dir))) {
      if (!/\.(jsx|css)$/.test(file)) continue;
      const src = codeOnly(read(`${dir}/${file}`));
      for (const pattern of banned) {
        if (pattern.test(src)) offenders.push(`${dir}/${file}: ${pattern}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    'a page re-imported the canvas left nav instead of using the app sidebar');
});
