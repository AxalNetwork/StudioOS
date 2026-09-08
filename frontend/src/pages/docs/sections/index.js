// Manifest module for the docs surface. Both the left rail and the
// client-side search consume this file. Each top-level entry exports
// { id, title, icon (lucide name as string), subsections: [...] }.
// Anchors are formed as `#${section.id}/${subsection.id}` and stay
// stable across copy edits — never renumber existing ids.

// `./admin` is registered here again, and the nine days between two commits
// are the whole reason.
//
// 2026-05-13, `88e6d1f97` "Task #2 (DD) — Hide Admin docs from non-admins",
// built the machinery this file still carries: `roles: ['admin']` on the admin
// section, `filterSectionsForRole` below, `adminOnlyAnchors()` for the URL
// guard, a role-scoped search index, and `AdminDocsPathGuard` in `App.jsx` on
// both `/docs/admin/*` and `/help/admin/*`.
//
// 2026-05-22, `2c38e60b3` "Remove administrative sections from user
// documentation", deleted the import and the SECTIONS entry — "from the
// StudioOS documentation navigation and search index", which is precisely what
// the previous week's work already did, per viewer. It was a second, blunter
// fix for a problem that was already solved, and it left the first one guarding
// nothing: `adminOnlyAnchors()` returned no admin anchor, the path guard
// redirected admins to `/help#admin/<sub>` where no such anchor existed, and
// 179 lines of written admin documentation were unreachable by anyone.
//
// So this is not a reversal of that decision — the decision was "admin content
// must not appear in user documentation", and it still holds: `admin.js` is
// tagged `roles: ['admin']`, so every non-admin viewer sees exactly what they
// saw yesterday, in the rail, the body, the "on this page" list and search.
// What changes is that an ADMIN can now read the admin docs the path guard has
// been pointing at for four months. DECISIONS D61.
import admin from './admin';
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
import troubleshooting from './troubleshooting';
import changelog from './changelog';

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
  troubleshooting,
  changelog,
  // Last, so an admin's rail keeps the order every other viewer sees and the
  // operator content sits below the product content rather than above it.
  admin,
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
// Takes the manifest as an argument, defaulting to the real one, so the
// subsection branch below can be tested. Its sibling `filterSectionsForRole`
// already had that shape; this one read `SECTIONS` directly and so could only
// ever be exercised by whatever the corpus happened to contain — which today is
// tagged sections and no tagged subsections, leaving half of it unguarded.
export function adminOnlyAnchors(sections = SECTIONS) {
  const anchors = new Set();
  for (const section of sections) {
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
