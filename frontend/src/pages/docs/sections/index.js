// Manifest module for the docs surface. Both the left rail and the
// client-side search consume this file. Each top-level entry exports
// { id, title, icon (lucide name as string), subsections: [...] }.
// Anchors are formed as `#${section.id}/${subsection.id}` and stay
// stable across copy edits — never renumber existing ids.

import gettingStarted from './getting-started';
import spinOutLab from './spin-out-lab';
import build from './build';
import validateGrow from './validate-grow';
import capital from './capital';
import legal from './legal';
import partnerships from './partnerships';
import network from './network';
import portals from './portals';
import integrations from './integrations';
import account from './account';
import admin from './admin';
import troubleshooting from './troubleshooting';

export const SECTIONS = [
  gettingStarted,
  spinOutLab,
  build,
  validateGrow,
  capital,
  legal,
  partnerships,
  network,
  portals,
  integrations,
  account,
  admin,
  troubleshooting,
];

// Legacy in-manifest search index. Kept for backwards compatibility
// with anything still importing buildSearchIndex from this module;
// new callers should use `frontend/src/lib/docs/search.js` which
// includes pitfalls and related-link labels in the corpus.
// Task #2 (DD) — Helper to filter manifest sections (and their
// subsections) based on the viewer's role. Sections OR subsections
// without an explicit `roles` array are public. Sections whose
// `roles` array is set are only included when the viewer's role is
// in the array; subsections are filtered the same way. A section
// whose every subsection is filtered out is dropped entirely so the
// rail doesn't render an empty group.
export function filterSectionsForRole(sections, role) {
  const r = String(role || '').toLowerCase();
  const out = [];
  for (const section of sections) {
    if (Array.isArray(section.roles) && !section.roles.includes(r)) continue;
    const subs = section.subsections.filter(
      (sub) => !Array.isArray(sub.roles) || sub.roles.includes(r),
    );
    if (subs.length === 0) continue;
    out.push({ ...section, subsections: subs });
  }
  return out;
}

// Set of every section/subsection anchor that is admin-only. Used by
// DocsLayout to 404-style guard direct hash navigation by non-admin
// viewers without leaking the page's existence.
export function adminOnlyAnchors() {
  const anchors = new Set();
  for (const section of SECTIONS) {
    const sectionAdmin = Array.isArray(section.roles) && section.roles.length === 1 && section.roles[0] === 'admin';
    for (const sub of section.subsections) {
      const subAdmin = Array.isArray(sub.roles) && sub.roles.length === 1 && sub.roles[0] === 'admin';
      if (sectionAdmin || subAdmin) {
        anchors.add(`${section.id}/${sub.id}`);
      }
    }
  }
  return anchors;
}

export function buildSearchIndex() {
  const records = [];
  for (const section of SECTIONS) {
    for (const sub of section.subsections) {
      const text = [
        sub.title,
        sub.overview || '',
        ...(sub.howto || []),
        ...(sub.tips || []),
        ...(sub.pitfalls || []),
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
