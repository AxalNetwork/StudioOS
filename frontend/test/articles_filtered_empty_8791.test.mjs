/**
 * D8791 (#8791) — the public Articles list tells a filtered zero result, a
 * failed read and an empty publication apart, and offers the full list in
 * one action.
 *
 * The browser retest (documentation/architecture/decisions/D8791.md) drew
 * "No articles yet. Be the first to publish." for Fintech, for Quantum with
 * an author filter, and for a request answered 503. These checks pin the
 * logic; the layout waits on the canvas (`needs-design`).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/articles_filtered_empty_8791.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CLEARED_ARTICLE_FILTERS,
  appliedArticleFilters,
  articleFiltersApplied,
  articleListMessage,
  articleListState,
  offersShowAll,
} from '../src/lib/articleListState.js';
import { ArticleListStatus } from '../src/pages/ArticlesPage.jsx';

const SECTORS = [{ key: 'fintech', label: 'Fintech' }, { key: 'quantum', label: 'Quantum' }];
const ROLES = [{ id: '', label: 'All authors' }, { id: 'investor', label: 'Investors' }];
const ARTICLE = { id: 1, slug: 'fictional', title: 'Fictional' };
const EMPTY_PUBLICATION = /No articles yet\. Be the first to publish\./;

test('a sector with no match names the sector and is not an empty publication', () => {
  const s = articleListState({ items: [], total: 0, sector: 'fintech', sectors: SECTORS, roles: ROLES });
  assert.equal(s.kind, 'no-match');
  assert.equal(articleListMessage(s), 'No articles match Fintech.');
  assert.doesNotMatch(articleListMessage(s), EMPTY_PUBLICATION);
  assert.equal(offersShowAll(s), true);
});

test('a combined sector, author and search names all three, in that order', () => {
  const s = articleListState({ items: [], sector: 'quantum', role: 'investor', q: '  ledger ', sectors: SECTORS, roles: ROLES });
  assert.equal(s.kind, 'no-match');
  assert.deepEqual(s.filters.map((f) => f.kind), ['sector', 'author', 'search']);
  assert.equal(articleListMessage(s), 'No articles match Quantum · Investors · “ledger”.');
});

test('only an unfiltered, successful, empty read says the publication is empty', () => {
  const s = articleListState({ items: [], total: 0, sectors: SECTORS, roles: ROLES });
  assert.equal(s.kind, 'empty');
  assert.match(articleListMessage(s), EMPTY_PUBLICATION);
  assert.equal(offersShowAll(s), false, 'nothing to clear');
});

test('a failed read says Unreadable, with or without a filter', () => {
  for (const sector of ['', 'fintech']) {
    const s = articleListState({ failed: true, items: [], sector, sectors: SECTORS });
    assert.equal(s.kind, 'unreadable');
    assert.match(articleListMessage(s), /^Unreadable/);
    assert.doesNotMatch(articleListMessage(s), EMPTY_PUBLICATION);
    assert.equal(offersShowAll(s), Boolean(sector), 'the full list is offered only when a filter narrowed the read');
  }
});

test('loading wins over everything and claims nothing', () => {
  const s = articleListState({ loading: true, failed: true, items: [], sector: 'fintech' });
  assert.equal(s.kind, 'loading');
  assert.equal(offersShowAll(s), false);
});

test('a populated read carries its count, filtered or not', () => {
  assert.equal(articleListMessage(articleListState({ items: [ARTICLE, ARTICLE], total: 14 })), '14 articles.');
  assert.equal(articleListMessage(articleListState({ items: [ARTICLE], total: 1, sector: 'fintech', sectors: SECTORS })), '1 article match Fintech.');
});

test('an unknown sector or author key is shown as its key, never dropped', () => {
  const f = appliedArticleFilters({ sector: 'zeta', role: 'coach', sectors: SECTORS, roles: ROLES });
  assert.deepEqual(f.map((x) => x.label), ['zeta', 'coach']);
  assert.equal(articleFiltersApplied({ q: '   ' }), false, 'a blank search is no filter');
  assert.deepEqual({ ...CLEARED_ARTICLE_FILTERS }, { sector: '', role: '', search: '' });
});

const render = (props) => renderToStaticMarkup(React.createElement(ArticleListStatus, props));

test('the drawn status: one Show all action for a filtered zero result, a polite status for every read', () => {
  const noMatch = render({ state: articleListState({ items: [], sector: 'fintech', sectors: SECTORS }), onShowAll: () => {} });
  assert.match(noMatch, /role="status"[^>]*aria-live="polite"[^>]*>No articles match Fintech\.</);
  assert.equal((noMatch.match(/data-testid="articles-show-all"/g) || []).length, 1);
  assert.match(noMatch, />Show all articles</);

  const empty = render({ state: articleListState({ items: [] }), onShowAll: () => {} });
  assert.match(empty, EMPTY_PUBLICATION);
  assert.doesNotMatch(empty, /articles-show-all/);

  const list = render({ state: articleListState({ items: [ARTICLE], total: 3 }), onShowAll: () => {} });
  assert.doesNotMatch(list, /class="ax-empty"/, 'a populated list draws no note');
  assert.match(list, /role="status"[^>]*>3 articles\.</);

  const loading = render({ state: articleListState({ loading: true }), onShowAll: () => {} });
  assert.match(loading, /role="status"[^>]*><\/p>/, 'loading announces nothing');
});

test('the page wires the state: failures are recorded, Show all clears every filter and keeps focus in the filters', () => {
  const src = readFileSync(new URL('../src/pages/ArticlesPage.jsx', import.meta.url), 'utf8');
  assert.match(src, /setFailed\(true\)/, 'a failed read is recorded, not drawn as empty');
  assert.match(src, /articleListState\(\{ loading, failed, items, total, sector, role, q: debouncedQ/);
  const showAll = src.slice(src.indexOf('const showAll = () => {'), src.indexOf('};', src.indexOf('const showAll = () => {')));
  for (const call of ["setSector('')", "setRole('')", "setSearch('')", "setDebouncedQ('')", 'setPage(0)', '.focus()']) {
    assert.ok(showAll.includes(call), `Show all must ${call}`);
  }
  assert.doesNotMatch(src, /No articles matching/, 'the search-only sentence is replaced by the named filters');
});
