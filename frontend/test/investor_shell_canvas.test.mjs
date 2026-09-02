/**
 * Pins investor zone archetypes and taglines to the Pages · Investor * canvases
 * and the Investor LP Canvas artboard headings. The shell config is the single
 * source of truth ZoneNav and future archetype badges read from; drift here
 * means the nav advertises the wrong page type.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHELLS } from '../src/workspaces/shellConfig.js';

const investor = SHELLS.investor;

const archetypeLabel = (zone) => zone.archetype?.label;

test('investor bucket taglines match the Investor LP Canvas headings', () => {
  const expected = {
    Deals: 'Find and close investments',
    Portfolio: 'Know how my investments are doing',
    Fund: 'Run my fund',
    Network: 'Work my relationships',
    Research: 'Go deep before money moves',
  };
  for (const row of investor.rows.filter((r) => r.kind === 'bucket')) {
    assert.equal(row.tagline, expected[row.label],
      `${row.label} tagline drifted from the canvas`);
  }
});

test('investor Deals zones match Pages · Investor Deals (ID1–ID4)', () => {
  const deals = investor.rows.find((r) => r.label === 'Deals');
  assert.deepEqual(deals.zones.map((z) => [z.slug, archetypeLabel(z)]), [
    ['pipeline', 'WORK BOARD'],
    ['screening', 'ANALYTICS'],
    ['commit', 'LEDGER'],
    ['closing', 'COLLECTION'],
  ]);
});

test('investor Portfolio zones match Pages · Investor Portfolio (IP1–IP3)', () => {
  const portfolio = investor.rows.find((r) => r.label === 'Portfolio');
  assert.deepEqual(portfolio.zones.map((z) => [z.slug, archetypeLabel(z)]), [
    ['positions', 'LEDGER'],
    ['updates', 'FEED'],
    ['value-add', 'FEED'],
  ]);
});

test('investor Fund zones match Pages · Investor Fund (IF1–IF4)', () => {
  const fund = investor.rows.find((r) => r.label === 'Fund');
  assert.deepEqual(fund.zones.map((z) => [z.slug, archetypeLabel(z)]), [
    ['lps', 'COLLECTION'],
    ['calls', 'LEDGER'],
    ['ledger', 'LEDGER'],
    ['reporting', 'COLLECTION'],
  ]);
});

test('investor Network zones match Pages · Investor Network (IN1–IN3)', () => {
  const network = investor.rows.find((r) => r.label === 'Network');
  assert.deepEqual(network.zones.map((z) => [z.slug, archetypeLabel(z)]), [
    ['relationships', 'MATCH ENGINE'],
    ['introductions', 'FEED'],
    ['organizations', 'COLLECTION'],
  ]);
});

test('investor Research zones match Pages · Investor Research (IR1–IR5)', () => {
  const research = investor.rows.find((r) => r.label === 'Research');
  assert.deepEqual(research.zones.map((z) => [z.slug, archetypeLabel(z)]), [
    ['ask', 'FEED'],
    ['diligence', 'COLLECTION'],
    ['benchmarking', 'ANALYTICS'],
    ['markets', 'ANALYTICS'],
    ['library', 'COLLECTION'],
  ]);
});

test('investor accent stays indigo, not seam cyan', () => {
  assert.equal(investor.accent, 'investor');
  assert.equal(SHELLS.investor.rows[0].kind, 'link');
  // Guard against accidental import of seam hue into ACCENT — checked elsewhere
  // too, but investor is the licence this task cares about.
  const config = readFileSync(resolve(process.cwd(), 'frontend/src/workspaces/shellConfig.js'), 'utf8');
  const accentBlock = /investor: \{ ink: '([^']+)'/.exec(config);
  assert.ok(accentBlock, 'ACCENT.investor missing');
  assert.equal(accentBlock[1], '#4f46e5', 'investor accent must stay indigo-600 per canvas I1');
});
