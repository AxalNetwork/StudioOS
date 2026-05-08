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
import network from './network';
import portals from './portals';
import account from './account';
import troubleshooting from './troubleshooting';

export const SECTIONS = [
  gettingStarted,
  spinOutLab,
  build,
  validateGrow,
  capital,
  legal,
  network,
  portals,
  account,
  troubleshooting,
];

// Flat search corpus — one record per subsection. Includes a `text`
// blob fuse.js can score against, plus the metadata the result list
// renders (section title, subsection title, anchor).
export function buildSearchIndex() {
  const records = [];
  for (const section of SECTIONS) {
    for (const sub of section.subsections) {
      const text = [
        sub.title,
        sub.overview || '',
        ...(sub.howto || []),
        ...(sub.tips || []),
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
