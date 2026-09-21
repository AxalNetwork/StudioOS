/**
 * One competitor inside an analysis. The list at `/research/companies` opens
 * it. A blank relevance is not zero, the draft only restates the page, and a
 * placeholder host is parsed rather than matched as text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  recordedRelevance,
  draftExplanation,
  draftText,
  removeConsequence,
  exampleHost,
  detailRows,
} from '../src/pages/research/companyCandidateRead.js';

const page = readFileSync(new URL('../src/pages/research/CompanyCandidate.jsx', import.meta.url), 'utf8');
const read = readFileSync(new URL('../src/pages/research/companyCandidateRead.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const list = readFileSync(new URL('../src/components/CompetitorAnalysis.jsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../src/workspaces/ResearchWorkspace.jsx', import.meta.url), 'utf8');

test('a zero with no subscores is not a score', () => {
  assert.equal(recordedRelevance({ relevance_score: 0, scores: {} }), null);
  assert.equal(recordedRelevance({ relevance_score: null, scores: { industry: 10 } }), null);
  assert.equal(recordedRelevance({ relevance_score: 0, scores: { industry: 0 } }), 0);
  assert.equal(recordedRelevance({ relevance_score: 74.2, scores: { industry: 80 } }), 74);
});

test('the draft repeats the summary and the source titles, and nothing else', () => {
  assert.equal(draftExplanation('', []), 'Add a summary or a source first.');
  assert.match(draftExplanation('A review layer.', [{ title: 'Home' }, { title: 'Pricing' }]), /the summary and 2 source titles \(Home, Pricing\)/);
  assert.equal(draftText('A review layer.', [{ title: 'Home' }]), 'A review layer.\n\nHome');
  assert.equal(draftText('', []), '');
  assert.doesNotMatch(draftText('A review layer.', [{ title: 'Home' }]), /\$\d|headcount|funding/);
});

test('removing a manual row says a re-run will not bring it back', () => {
  assert.match(removeConsequence('manual'), /will not bring a manual row back/);
  assert.match(removeConsequence('discovered'), /may find this company again/);
});

test('example.com is a hostname, not a substring', () => {
  assert.equal(exampleHost('https://example.com/pricing'), true);
  assert.equal(exampleHost('https://notexample.com/pricing'), false);
  assert.equal(exampleHost('https://example.com.evil.test/'), false);
});

test('an empty detail stays empty beside a filled one', () => {
  const rows = detailRows({ features: ['Async video review'], pricing: [], positioning: 'Sells to the design lead.', traction: '' });
  assert.equal(rows.find((r) => r.k === 'Features').chips[0], 'Async video review');
  assert.equal(rows.find((r) => r.k === 'Pricing').nr, true);
  assert.equal(rows.find((r) => r.k === 'Positioning').text, 'Sells to the design lead.');
  assert.equal(rows.find((r) => r.k === 'Traction').nr, true);
});

test('the company page is a route for the same licences as the list', () => {
  assert.match(app, /path="\/research\/companies\/:analysisId\/:candidateId"/);
  assert.match(app, /guard\(labRoles\(\['admin', 'founder', 'advisor'\]\), <CompanyCandidate/);
  assert.match(workspace, /linkToDossier/);
  assert.match(list, /linkToDossier=\{linkToDossier\}/,
    'the list accepts the flag and must hand it to the results view, or Open is a free variable');
  assert.match(list, /\/research\/companies\/\$\{encodeURIComponent\(analysis\.id\)\}/);
});

test('the page states the limits and does not stamp fixture data as SAMPLE', () => {
  assert.match(page, /Accept writes the summary\. It does not add sources\./);
  assert.match(page, /no URL — nothing here will invent one/);
  assert.match(page, /This is not a company you track/);
  assert.match(page, /Headcount and funding are not fields/);
  assert.match(page, /POST \/competitors\/fetch needs a url/);
  assert.match(page, /blank, not zero/);
  assert.doesNotMatch(page, /SAMPLE/);
  assert.doesNotMatch(read, /\/example\\\.com\/i/);
  assert.match(read, /host === 'example\.com'/);
  assert.match(page, /hidden md:block/);
});
