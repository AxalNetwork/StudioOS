#!/usr/bin/env node
// One-shot helper to add Tailwind `dark:` variants beside common
// hardcoded light-mode utility classes on the page files listed below.
//
// Idempotent: each replacement uses a negative lookahead to skip tokens
// that already have the matching `dark:` sibling on the same className.
//
// Run from repo root: `node scripts/add-dark-variants.mjs`

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = [
  'frontend/src/pages/NetworkEffectsPage.jsx',
  'frontend/src/pages/ReferEarnPage.jsx',
  'frontend/src/pages/PipelinePage.jsx',
  'frontend/src/pages/StudioOpsPage.jsx',
  'frontend/src/pages/PortfolioHealthPage.jsx',
  'frontend/src/pages/WellbeingPage.jsx',
];

const MAP = [
  ['bg-white',        'dark:bg-gray-900'],
  ['bg-gray-50',      'dark:bg-gray-900'],
  ['bg-gray-100',     'dark:bg-gray-800'],
  ['bg-slate-50',     'dark:bg-slate-900'],
  ['bg-slate-100',    'dark:bg-slate-800'],
  ['text-gray-900',   'dark:text-gray-100'],
  ['text-gray-800',   'dark:text-gray-200'],
  ['text-gray-700',   'dark:text-gray-300'],
  ['text-gray-600',   'dark:text-gray-400'],
  ['text-gray-500',   'dark:text-gray-400'],
  ['text-slate-900',  'dark:text-slate-100'],
  ['text-slate-800',  'dark:text-slate-200'],
  ['text-slate-700',  'dark:text-slate-300'],
  ['text-slate-600',  'dark:text-slate-400'],
  ['text-slate-500',  'dark:text-slate-400'],
  ['border-gray-200', 'dark:border-gray-700'],
  ['border-gray-300', 'dark:border-gray-600'],
  ['border-slate-200','dark:border-slate-700'],
  ['border-slate-300','dark:border-slate-600'],
  ['divide-gray-200', 'dark:divide-gray-700'],
  ['divide-slate-200','dark:divide-slate-700'],
  ['hover:bg-gray-50','dark:hover:bg-gray-800'],
  ['hover:bg-gray-100','dark:hover:bg-gray-700'],
];

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function patchSource(src) {
  let out = src;
  for (const [light, dark] of MAP) {
    // Match the light token as a whole word, when NOT already followed
    // (anywhere on the rest of the same className) by its dark sibling.
    // Simpler & safe: require the next char after the token to be NOT
    // followed by " dark:<exact dark utility>" within ~120 chars of
    // string. To stay robust on ambiguous lookbehinds we keep it local:
    // refuse to add if the dark utility appears within the next 120
    // chars (heuristic for "same className string").
    const re = new RegExp(
      `\\b${escapeRe(light)}\\b(?![^"'\`]{0,200}\\b${escapeRe(dark)}\\b)`,
      'g',
    );
    out = out.replace(re, `${light} ${dark}`);
  }
  return out;
}

let totalChanges = 0;
for (const rel of FILES) {
  const abs = resolve(rel);
  const before = readFileSync(abs, 'utf8');
  const after = patchSource(before);
  if (before !== after) {
    writeFileSync(abs, after);
    const delta = after.length - before.length;
    totalChanges += 1;
    console.log(`patched ${rel}  (+${delta} chars)`);
  } else {
    console.log(`unchanged ${rel}`);
  }
}
console.log(`\n${totalChanges}/${FILES.length} files updated.`);
