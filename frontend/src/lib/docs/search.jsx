// Fuse.js-backed search index for the docs surface. The DocsLayout
// imports `createDocsFuse` to build a memoized index, and `highlight`
// / `snippet` to render matches in the result list. Keeping all of
// this out of the layout component lets the matcher be unit-tested
// and re-used (e.g. by a future global search palette).

import Fuse from 'fuse.js';
import { SECTIONS } from '../../pages/docs/sections';

// Build a flat list of search records — one per subsection — with a
// `text` blob fuse can score against. The blob folds in the overview,
// how-to steps, tips, pitfalls, and related-link labels so a query
// like "vesting cliff" matches the cap-table page even when the term
// only appears inside a how-to step.
export function buildDocsRecords() {
  const records = [];
  for (const section of SECTIONS) {
    for (const sub of section.subsections) {
      const text = [
        sub.title,
        sub.overview || '',
        ...(sub.howto || []),
        ...(sub.tips || []),
        ...(sub.pitfalls || []),
        ...((sub.related || []).map(r => r.label)),
      ].join(' \n ');
      records.push({
        sectionId: section.id,
        sectionTitle: section.title,
        subsectionId: sub.id,
        subsectionTitle: sub.title,
        anchor: `${section.id}/${sub.id}`,
        text,
      });
    }
  }
  return records;
}

// Build a configured Fuse instance. Threshold 0.35 + ignoreLocation
// gives forgiving matches without flooding the rail with noise.
export function createDocsFuse() {
  return new Fuse(buildDocsRecords(), {
    keys: [
      { name: 'subsectionTitle', weight: 0.5 },
      { name: 'sectionTitle', weight: 0.2 },
      { name: 'text', weight: 0.3 },
    ],
    threshold: 0.35,
    includeMatches: false,
    minMatchCharLength: 2,
    ignoreLocation: true,
  });
}

// Highlight every occurrence of `q` inside `text` (case-insensitive).
// Returns a JSX-friendly array; safe to drop straight into a node.
export function highlight(text, q) {
  if (!q) return text;
  const lower = String(text).toLowerCase();
  const ql = q.toLowerCase();
  const out = [];
  let cursor = 0;
  let idx = lower.indexOf(ql, cursor);
  let key = 0;
  while (idx !== -1) {
    if (idx > cursor) out.push(text.slice(cursor, idx));
    out.push(
      <mark key={key++} className="bg-yellow-200 text-gray-900 rounded px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    cursor = idx + q.length;
    idx = lower.indexOf(ql, cursor);
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

// Centred snippet around the first occurrence of `q`, padded with
// ellipses. Falls back to the start of the text when there's no hit.
export function snippet(text, q, span = 140) {
  if (!text) return '';
  if (!q) return text.slice(0, span) + (text.length > span ? '…' : '');
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx === -1) return text.slice(0, span) + (text.length > span ? '…' : '');
  const start = Math.max(0, idx - Math.floor(span / 3));
  const end = Math.min(text.length, start + span);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}
