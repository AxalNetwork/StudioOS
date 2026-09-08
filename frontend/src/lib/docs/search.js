// Fuse.js-backed search index for the docs surface. Pure JS — no
// JSX — so the module is safe to import from any callsite (tests,
// future global search palette, etc.). The DocsLayout wraps the
// returned snippet text in its own JSX <mark> highlighter.

import Fuse from 'fuse.js';
import { SECTIONS, filterSectionsForRole } from '../../pages/docs/sections';

// Build a flat list of search records — one per subsection — with a
// `text` blob fuse can score against. The blob folds in the overview,
// how-to steps, tips, pitfalls, and related-link labels so a query
// like "vesting cliff" matches the cap-table page even when the term
// only appears inside a how-to step.
export function buildDocsRecords(role) {
  const records = [];
  // Task #2 (DD) excluded admin-tagged sections from the corpus "when a role is
  // provided", and returned the FULL index when `role` was undefined — stated
  // as back-compat for callers that pass nothing.
  //
  // THAT FAILED OPEN, and the only reason it never leaked is that the admin
  // section was not in the manifest at all (removed nine days later by
  // `2c38e60b3`; see `pages/docs/sections/index.js`). Re-registering it makes
  // the hole live: `DocsLayout` passes `role` straight from `useAuth()`, which
  // is `undefined` for an anonymous visitor, so `createDocsFuse(undefined)`
  // would have handed the admin corpus to anyone who typed in the Help Center
  // search box — while the rail beside it correctly showed nothing, because
  // `filterSectionsForRole(SECTIONS, undefined)` compares against '' and drops
  // the section.
  //
  // So the filter is now unconditional. An unknown role is a NON-admin, which
  // is the only safe reading of "unknown", and it makes the two surfaces agree.
  // No caller loses anything: nothing in the repo calls this with no argument.
  const visible = filterSectionsForRole(SECTIONS, role);
  for (const section of visible) {
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
export function createDocsFuse(role) {
  return new Fuse(buildDocsRecords(role), {
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

// Split `text` around every case-insensitive occurrence of `q`,
// returning a flat array of { text, match } parts. Callers wrap the
// match parts in their own highlight component (the docs layout uses
// a <mark> element, but other surfaces could differ).
export function splitForHighlight(text, q) {
  const str = String(text ?? '');
  if (!q) return [{ text: str, match: false }];
  const lower = str.toLowerCase();
  const ql = q.toLowerCase();
  const out = [];
  let cursor = 0;
  let idx = lower.indexOf(ql, cursor);
  while (idx !== -1) {
    if (idx > cursor) out.push({ text: str.slice(cursor, idx), match: false });
    out.push({ text: str.slice(idx, idx + q.length), match: true });
    cursor = idx + q.length;
    idx = lower.indexOf(ql, cursor);
  }
  if (cursor < str.length) out.push({ text: str.slice(cursor), match: false });
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
