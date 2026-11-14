/**
 * The company page writes name, category and summary. A fetched URL becomes a
 * source and does not become the homepage. A crawl records sources and signals
 * and does not write details or relevance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceKind } from '../src/services/competitorAnalysis.ts';

const routes = readFileSync(new URL('../src/routes/competitors.ts', import.meta.url), 'utf8');
const crawl = readFileSync(new URL('../src/services/competitorAnalysis.ts', import.meta.url), 'utf8');

function slice(from: string, to: string): string {
  const start = routes.indexOf(from);
  const end = routes.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `slice ${from} → ${to}`);
  return routes.slice(start, end);
}

test('a pricing path is a pricing source, and a bare host is a homepage', () => {
  assert.equal(sourceKind('https://example.com/pricing'), 'pricing');
  assert.equal(sourceKind('https://example.com/'), 'homepage');
  assert.equal(sourceKind('https://example.com/careers'), 'careers');
});

test('the candidate patch does not write a score, an origin, or a homepage', () => {
  const body = slice("competitors.patch('/:id/candidates/:cid'", "competitors.post('/:id/candidates/:cid/sources'");
  assert.match(body, /category !== 'direct' && body\.category !== 'adjacent'/);
  assert.doesNotMatch(body, /relevance_score/);
  assert.doesNotMatch(body, /SET url/);
  assert.doesNotMatch(body, /origin =/);
  assert.doesNotMatch(body, /details_json/);
});

test('adding a URL fetches it and records a source without setting the homepage', () => {
  const body = slice("competitors.post('/:id/candidates/:cid/sources'", "competitors.post('/:id/candidates/:cid/crawl'");
  assert.match(body, /fetchPage\(/);
  assert.match(body, /INSERT INTO competitor_sources/);
  assert.match(body, /sourceKind\(page\.url\)/);
  assert.doesNotMatch(body, /SET url/);
  assert.doesNotMatch(body, /details_json/);
  assert.doesNotMatch(body, /summary =/);
});

test('crawling one site records sources and signals and puts the candidate fields back', () => {
  const body = slice("competitors.post('/:id/candidates/:cid/crawl'", "competitors.post('/:id/rerun'");
  assert.match(body, /collectCandidateCrawl\(/);
  assert.match(body, /if \(!cand\.url\)/);
  assert.match(body, /INSERT INTO competitor_sources/);
  assert.match(body, /INSERT INTO competitor_signals/);
  assert.doesNotMatch(body, /details_json/);
  assert.doesNotMatch(body, /relevance_score/);
  assert.match(crawl, /cand\.details = saved\.details/);
  assert.match(crawl, /cand\.relevance_score = saved\.relevance_score/);
});
