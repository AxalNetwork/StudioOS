#!/usr/bin/env node
/**
 * Task #9 (LG) — Deck template registry drift guard.
 *
 * Statically asserts that `frontend/src/decks/templates/index.ts`:
 *   (1) Imports exactly 12 Deck_* components from sibling .tsx files.
 *   (2) Declares exactly 12 entries in the TEMPLATES record.
 *   (3) Every entry has `key`, `label`, `description`, `slide_count`,
 *       `required_tier`, and `Component` fields populated.
 *   (4) Exports `TEMPLATE_LIST` so consumers can iterate without
 *       coupling to the record shape.
 *
 * Wired into `npm run test:drift`. Failing this guard means the picker
 * grid will render fewer than 12 thumbnails (or none at all).
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const INDEX_PATH = join(ROOT, 'frontend/src/decks/templates/index.ts');
const TEMPLATES_DIR = join(ROOT, 'frontend/src/decks/templates');

const EXPECTED = 13;
const REQUIRED_FIELDS = ['key', 'label', 'description', 'slide_count', 'required_tier', 'Component'];

function fail(msg) {
  console.error(`\n✖ check-deck-templates: ${msg}\n`);
  process.exit(1);
}

if (!existsSync(INDEX_PATH)) {
  fail(`registry not found at ${INDEX_PATH}`);
}

const src = readFileSync(INDEX_PATH, 'utf8');

const importMatches = [...src.matchAll(/import\s+\{\s*(Deck_\w+)\s*\}\s+from\s+['"]\.\/(\w+)['"]/g)];
if (importMatches.length !== EXPECTED) {
  fail(`expected ${EXPECTED} Deck_* imports, found ${importMatches.length}`);
}

for (const [, , fileBase] of importMatches) {
  const tsx = join(TEMPLATES_DIR, `${fileBase}.tsx`);
  if (!existsSync(tsx)) fail(`imported template missing on disk: ${tsx}`);
}

const recordMatch = src.match(/export\s+const\s+TEMPLATES\s*:\s*Record<[^>]+>\s*=\s*\{([\s\S]*?)\n\}\s*;/);
if (!recordMatch) fail('could not locate TEMPLATES record block');

const body = recordMatch[1];
const entryRegex = /(\w+)\s*:\s*\{([^}]*)\}/g;
const entries = [...body.matchAll(entryRegex)];
if (entries.length !== EXPECTED) {
  fail(`expected ${EXPECTED} TEMPLATES entries, found ${entries.length}`);
}

for (const [, key, entryBody] of entries) {
  for (const field of REQUIRED_FIELDS) {
    const re = new RegExp(`\\b${field}\\s*:`);
    if (!re.test(entryBody)) {
      fail(`TEMPLATES['${key}'] missing required field '${field}'`);
    }
  }
}

if (!/export\s+const\s+TEMPLATE_LIST\b/.test(src)) {
  fail("missing named export `TEMPLATE_LIST` — consumers iterate this");
}

console.log(`✓ check-deck-templates: ${EXPECTED} templates wired correctly`);
