// #3662: the live acceptance script's pure parts (scripts/pitch-acceptance-live.mjs). The browser
// half cannot run here; what decides a verdict can: when the run may start (never against an
// unconfirmed account, and "not configured" is exit 2, never a pass), what a broken page looks
// like, whether downloaded bytes are the file they claim, and that the matrix says "Not tested"
// for every row the run does not cover.
//
//   node --test frontend/test/pitch_acceptance_live_3662.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { MANUAL_ROWS, PAGES, VIEWPORTS, configProblem, fileVerdict, matrixMarkdown, pageVerdict } from '../../scripts/pitch-acceptance-live.mjs';

const OK_ENV = { PITCH_BASE_URL: 'https://staging.example.test', PITCH_TEST_ACCOUNT: 'synthetic', PITCH_SESSION: 'sid=abc', PITCH_PROJECT_ID: '12' };

test('the run starts only when configured, on https or localhost, against a confirmed test account', () => {
  assert.equal(configProblem(OK_ENV), null);
  assert.equal(configProblem({ ...OK_ENV, PITCH_BASE_URL: 'http://localhost:5173' }), null);
  assert.match(configProblem({}), /PITCH_BASE_URL/);
  assert.match(configProblem({ ...OK_ENV, PITCH_BASE_URL: 'not a url' }), /not a URL/);
  assert.match(configProblem({ ...OK_ENV, PITCH_BASE_URL: 'http://staging.example.test' }), /https/);
  assert.match(configProblem({ ...OK_ENV, PITCH_TEST_ACCOUNT: undefined }), /synthetic/);
  assert.match(configProblem({ ...OK_ENV, PITCH_TEST_ACCOUNT: 'yes' }), /synthetic/);
  assert.match(configProblem({ ...OK_ENV, PITCH_SESSION: '' }), /PITCH_SESSION/);
  assert.match(configProblem({ ...OK_ENV, PITCH_PROJECT_ID: 'abc' }), /PITCH_PROJECT_ID/);
  assert.match(configProblem({ ...OK_ENV, PITCH_EXPORTS: '1' }), /PITCH_DECK_ID/);
  assert.equal(configProblem({ ...OK_ENV, PITCH_EXPORTS: '1', PITCH_DECK_ID: '9' }), null);
});

test('a page that broke or drew nothing fails; a drawn page passes', () => {
  assert.equal(pageVerdict('Decks · Fixture complete deck · version 3 · Edit · Present · Share').ok, true);
  assert.equal(pageVerdict('Something went wrong. Reload the page and try again, please.').ok, false);
  assert.equal(pageVerdict("TypeError: Cannot read properties of undefined (reading 'slides') and more").ok, false);
  assert.equal(pageVerdict('   Loading   ').ok, false);
  assert.equal(pageVerdict(null).ok, false);
});

const pad = (s) => new TextEncoder().encode(s.padEnd(200, ' '));
test('downloaded bytes are judged by what they are, not by the answer that carried them', () => {
  assert.equal(fileVerdict('pdf', pad('%PDF-1.7 ...')).ok, true);
  assert.equal(fileVerdict('pdf', pad('<!doctype html> an error page')).ok, false);
  assert.equal(fileVerdict('pptx', pad('PK\u0003\u0004 ppt/presentation.xml')).ok, true);
  assert.equal(fileVerdict('pptx', pad('PK\u0003\u0004 word/document.xml')).ok, false, 'a zip that is not a PowerPoint');
  assert.equal(fileVerdict('pptx', pad('%PDF-1.7')).ok, false);
  assert.equal(fileVerdict('html', pad('<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="x">')).ok, true);
  assert.equal(fileVerdict('html', pad('<!DOCTYPE html><p>Sign in</p>')).ok, false, 'the sign-in page is not the offline deck');
  assert.equal(fileVerdict('pdf', new TextEncoder().encode('%PDF-1.7')).ok, false, 'a header alone is not a file');
  assert.equal(fileVerdict('pdf', undefined).ok, false);
  assert.equal(fileVerdict('docx', pad('PK')).ok, false);
});

test('the matrix records the revision, every result, and "Not tested" for every manual row — never a pass', () => {
  const md = matrixMarkdown([
    { label: 'Decks (PD2), desktop', ok: true, why: null, evidence: 'out/decks-desktop.png' },
    { label: 'Export PDF', ok: false, why: 'HTTP 500', evidence: 'out/export.pdf' },
  ], { revision: 'abc1234', base: 'https://staging.example.test', when: '2026-10-28T00:00:00Z' });
  assert.match(md, /\*\*Revision:\*\* abc1234/);
  assert.match(md, /\| Decks \(PD2\), desktop \| Pass \| out\/decks-desktop\.png \|/);
  assert.match(md, /\| Export PDF \| Fail \| out\/export\.pdf — HTTP 500 \|/);
  for (const row of MANUAL_ROWS) assert.ok(md.includes(`| ${row} | Not tested |`), row);
  assert.equal((md.match(/\| Pass \|/g) || []).length, 1);
  assert.match(matrixMarkdown([]), /\*\*Revision:\*\* not recorded/);
});

test('the run covers the five studio pages at a desktop and a phone width', () => {
  assert.deepEqual(PAGES.map((p) => p.key), ['decks', 'editor', 'review', 'present', 'analytics']);
  assert.deepEqual(VIEWPORTS.map((v) => v.width), [1440, 390]);
});
