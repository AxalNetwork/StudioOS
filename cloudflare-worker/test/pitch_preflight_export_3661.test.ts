/**
 * #3661: Pitch preflight, the fixed deck exported. The deliberately defective
 * synthetic deck of `frontend/test/pitch_preflight_3661.test.mjs`, once the
 * founder has fixed what preflight found, passes every check and goes through
 * the offline HTML writer (D901's HTML export) with its words kept. The
 * frontend test cannot load the writer: it imports the legal paper's fonts,
 * which only this loader reads.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/pitch_preflight_export_3661.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportGate, runPreflight } from '../../frontend/src/pages/raise/pitch/preflightModel.js';
import { writeOfflineDeck } from '../src/services/decks/offlineHtml.ts';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const g = (c1: number, c2: number, r1: number, r2: number) => ({ c1, c2, r1, r2 });
const bind = (as_of: string) => ({ source_key: 'stripe.mrr', record_ref: 'metric:1', as_of, grade: 'verified', snapshot_hash: 'a'.repeat(64) });

test('the defective deck, fixed by the founder, passes and exports with its words kept', async () => {
  const fixed = {
    id: 9001, version: 4, theme: { kind: 'neutral_light' },
    slides: [
      { title: 'Opening', blocks: [
        { id: 'b1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 1), text: 'Welcome to Synthetic Labs' },
        { id: 'b2', kind: 'text', style: 'paragraph', grid: g(1, 12, 2, 4), text: 'Every site inspection, scheduled for you.' },
      ] },
      { title: 'Traction', blocks: [
        { id: 'b1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 1), text: 'Traction' },
        { id: 'b2', kind: 'metric', grid: g(1, 3, 2, 3), label: 'MRR', value: '$12,000', binding: bind('2026-10-25') },
        { id: 'b3', kind: 'metric', grid: g(4, 6, 2, 3), label: 'Customers', value: '40', binding: bind('2026-10-25') },
      ] },
      { title: 'Team', blocks: [
        { id: 'b1', kind: 'text', style: 'paragraph', grid: g(1, 12, 1, 1), text: 'Two founders, two hires planned.' },
        { id: 'b3', kind: 'image', grid: g(7, 12, 2, 6), image_url: 'https://cdn.example.test/team.png', alt: 'The two founders, a synthetic picture' },
      ] },
      { title: 'Ask', blocks: [{ id: 'b1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 2), text: 'The ask' }] },
    ],
  };
  const measurements: Record<string, any> = {};
  fixed.slides.forEach((s: any, i: number) => s.blocks.forEach((b: any) => { measurements[`${i}:${b.id}`] = b.kind === 'image' ? { natural_w: 1600, natural_h: 1200 } : { clipped: false, font_px: b.style === 'heading' ? 64 : 30 }; }));
  const r = runPreflight(fixed, { now: NOW, measurements });
  assert.deepEqual(r.findings, [], JSON.stringify(r.findings));
  assert.ok(r.checks.every((c) => c.state === 'pass'));
  assert.equal(exportGate(r).blocked, false);
  const html = await writeOfflineDeck({ title: 'Synthetic deck', version: fixed.version, slides: fixed.slides, images: new Map(), footer: null, watermark: null, notes: false, sources: true });
  for (const words of ['Welcome to Synthetic Labs', 'Every site inspection, scheduled for you.', '$12,000', 'Two founders, two hires planned.', 'The ask']) {
    assert.ok(html.includes(words.replace(/&/g, '&amp;')), `the export keeps “${words}”`);
  }
  assert.ok(!html.includes('[Synthetic Labs]'));
});

