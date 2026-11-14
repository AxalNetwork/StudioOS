/**
 * D220 — a null backlog is Unreadable on both surfaces, and a measured
 * zero is still a zero. The pages must wire the null fields through
 * DepthCount; a `?? 0` left on either figure fails the source pin.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { TechnicalDepthRow, DlqLine } from '../src/pages/DepthCount.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const html = (el, props) => renderToStaticMarkup(createElement(el, props));

const MIRROR = 'The Cloudflare Queue dead-letter mirror (cf_dlq_mirror) could not be read, so the backlog is unknown rather than empty.';
const QUEUE = 'The pending-job count (queue_jobs) could not be read, so the queue depth is unknown rather than empty.';

test('both Technical figures render Unreadable for null, with the server reason', () => {
  const markup = html(TechnicalDepthRow, {
    data: {
      queue_depth: null,
      queue_depth_reason: QUEUE,
      dlq_count: null,
      dlq_reason: MIRROR,
    },
  });
  assert.match(markup, /Queue depth could not be read/);
  assert.match(markup, /queue_jobs/);
  assert.match(markup, /DLQ could not be read/);
  assert.match(markup, /cf_dlq_mirror/);
  assert.equal(markup.includes('data-testid="depth-value-'), false);
  assert.doesNotMatch(markup, />0</);
});

test('the infrastructure DLQ line renders Unreadable for a null count', () => {
  const markup = html(DlqLine, { queue: { dlq_count: null, dlq_reason: MIRROR } });
  assert.match(markup, /DLQ could not be read/);
  assert.match(markup, /cf_dlq_mirror/);
  assert.equal(markup.includes('data-testid="depth-value-DLQ"'), false);
  assert.doesNotMatch(markup, />0</);
});

test('a measured zero is drawn as zero, on both stats', () => {
  const markup = html(TechnicalDepthRow, {
    data: { queue_depth: 0, queue_depth_reason: null, dlq_count: 0, dlq_reason: null },
  });
  assert.match(markup, /data-testid="depth-value-Queue depth">0</);
  assert.match(markup, /data-testid="depth-value-DLQ">0</);
  assert.equal(markup.includes('could not be read'), false);
  const line = html(DlqLine, { queue: { dlq_count: 0, dlq_reason: null } });
  assert.match(line, /data-testid="depth-value-DLQ">0</);
});

test('the two pages pass the null fields through and do not coerce them to zero', () => {
  const analytics = read('frontend/src/pages/AnalyticsTab.jsx');
  const infra = read('frontend/src/pages/InfrastructureTab.jsx');
  assert.match(analytics, /<TechnicalDepthRow data=\{data\} \/>/);
  assert.doesNotMatch(analytics, /dlq_count\s*\?\?/);
  assert.doesNotMatch(analytics, /dlq_count\s*\|\|/);
  assert.doesNotMatch(analytics, /queue_depth\s*\?\?/);
  assert.doesNotMatch(analytics, /queue_depth\s*\|\|/);
  assert.match(infra, /<DlqLine queue=\{queue\} \/>/);
  assert.doesNotMatch(infra, /dlq_7d/);
  assert.doesNotMatch(infra, /dlq_count\s*\?\?/);
  assert.doesNotMatch(infra, /dlq_count\s*\|\|/);
});
