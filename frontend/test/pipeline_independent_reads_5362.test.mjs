import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import partnerPipelineBoard from '../src/workspaces/boards/partnerPipeline.js';

const source = readFileSync(new URL('../src/pages/founder/FounderBuildBoard.jsx', import.meta.url), 'utf8');

test('proposal rows and analytics use independent source reads', async () => {
  let proposals = 0;
  let analytics = 0;
  const board = partnerPipelineBoard('partner', {
    myQuotes: async () => { proposals += 1; return { items: [{ id: 1, status: 'pending', price: 42 }] }; },
    quotesAnalytics: async () => { analytics += 1; throw new Error('analytics unavailable'); },
    listPartnerLeads: async () => ({}),
    listPartnerNegotiations: async () => ({}),
    listPartnerRetainers: async () => ({}),
  });

  const proposalData = await board.sources.proposals();
  await assert.rejects(board.sources.analytics());
  assert.equal(board.sections.find((section) => section.slug === 'proposals').source, 'proposals');
  assert.equal(board.sections.find((section) => section.slug === 'analytics').source, 'analytics');
  assert.equal(board.sections.find((section) => section.slug === 'proposals').rows(proposalData).length, 1);
  assert.equal(proposals, 1);
  assert.equal(analytics, 1);

  // A retry invokes only the source selected by useBucketSources.
  await board.sources.proposals();
  assert.equal(proposals, 2);
  assert.equal(analytics, 1);
});

test('a proposal failure does not prevent the analytics payload from reading', async () => {
  const board = partnerPipelineBoard('partner', {
    myQuotes: async () => { throw new Error('quotes unavailable'); },
    quotesAnalytics: async () => ({ pipeline: { pending: 2 }, by_shape: [] }),
  });
  await assert.rejects(board.sources.proposals());
  assert.equal((await board.sources.analytics()).pipeline.pending, 2);
});

test('the founder lane read has an honest error state, lane-only retry, and preserves a prior board', () => {
  assert.match(source, /setBoardRead\('error'\)/);
  assert.match(source, /status-board-lanes-error/);
  assert.match(source, /button-retry-board-lanes/);
  assert.match(source, /onClick=\{\(\) => readBoardLanes\(selectedId\)\}/);
  const failure = source.slice(source.indexOf('} catch {', source.indexOf('const readBoardLanes')), source.indexOf('return null;', source.indexOf('} catch {', source.indexOf('const readBoardLanes'))) + 12);
  assert.doesNotMatch(failure, /setBoard\(null\)/, 'a rejected refresh keeps the last successful lanes');
});
