import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const app = read('frontend/src/App.jsx');
const page = read('frontend/src/pages/founder/FounderValidatePage.jsx');
const styles = read('frontend/src/pages/founder/founderValidate.css');

test('founder active role owns the A2 Validate landing page', () => {
  assert.match(
    app,
    /path="\/build\/discovery"[^\n]+effectiveRole === 'founder' \? <FounderValidatePage \/> : <DiscoveryPage \/>/,
  );
  assert.doesNotMatch(
    app,
    /path="\/build\/discovery"[^\n]+founderWorkspace\('validate'/,
  );
});

test('A2 renders every requested evidence surface', () => {
  for (const copy of [
    'Prove someone wants this',
    'Interview library',
    'Pain map',
    'Hypotheses',
    'Validation summary',
    'Worker AI · Validate',
  ]) assert.match(page, new RegExp(copy));
});

test('A2 uses live discovery sources and retains the detailed editor', () => {
  for (const source of ['listProjects', 'listInterviews', 'getProgressSignals', 'painGroups']) {
    assert.match(page, new RegExp(source));
  }
  assert.match(page, /if \(isWorkspace\) \{/);
  assert.match(page, /initialProjects=\{projects\}/);
  assert.match(page, /initialInterviews=\{interviews\}/);
  assert.match(page, /initialTab="interviews"/);
  assert.match(page, /workspaceMode/);
  assert.match(page, /to=\{detailLink\} state=\{workspaceNavigationState\}/);
  assert.match(page, /founderValidateSeed/);
  assert.match(page, /\['leads', 'interviews', 'insights'\]\.includes\(searchParams\.get\('tab'\)\)/);
  assert.match(page, /setReloadKey\(\(value\) => value \+ 1\)/);
});

test('A2 does not ship canvas sample evidence, companies, models, or costs', () => {
  for (const sample of [
    'Priya',
    'Dev Raman',
    'Sara Lindqvist',
    'Tobias',
    'Verwood',
    'HandOff opacity',
    'Tool sprawl',
    'Status theatre',
    'Procurement drag',
    'Whisper',
    'Llama',
    'BGE-M3',
  ]) assert.doesNotMatch(page, new RegExp(sample, 'i'));
});

test('A2 preserves its composition across responsive and dark layouts', () => {
  assert.match(styles, /\.dark \.validate-desk/);
  assert.match(styles, /@media\(max-width:900px\)/);
  assert.match(styles, /@media\(max-width:680px\)/);
});