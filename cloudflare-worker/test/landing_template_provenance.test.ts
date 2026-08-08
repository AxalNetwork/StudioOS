// Guards template PROVENANCE — does a catalog entry that claims to be a
// recreation of an uploaded design actually correspond to a real directory
// under `brandtemplates/`, and does every real directory have a template.
//
// This is not hypothetical. `proof-builder` was grouped in code comments
// (both this file's TEMPLATE_REGISTRY and the frontend catalog's header)
// with genuinely-ported templates ("Task #24 — ported uploaded landing
// designs") and given a "recreated source designs" description, but no
// `brandtemplates/` directory has ever existed for it in the repo's history.
// An August 2026 fidelity audit caught it by hand; this test catches it
// mechanically so a future template can't drift the same way — either by
// claiming a source it doesn't have, or by a real upload landing in
// `brandtemplates/` and never getting wired into the catalog at all.
//
// Deliberately NOT a content/text fidelity check — the content-schema system
// parameterizes nearly everything with brand-specific placeholders, so a
// literal source-vs-render text diff would be permanently, uselessly noisy.
// Content fidelity is a human-audit-time concern (see the August 2026 audit
// report); this test enforces the mechanical, structural half: provenance.
//
// MUST stay in the test:drift file list in the root package.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATE_KEYS, TEMPLATE_SOURCES, TEMPLATE_SOURCE_DUPLICATE_DIRS } from '../src/services/landingTemplates.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRANDTEMPLATES_DIR = path.join(HERE, '..', '..', 'brandtemplates');

const GENERIC_STYLES = new Set(['minimal', 'bold-hero', 'video-first', 'editorial', 'product-mock']);

function realDirectories(): string[] {
  return fs.readdirSync(BRANDTEMPLATES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

test('TEMPLATE_SOURCES covers exactly the non-generic TEMPLATE_KEYS — no more, no less', () => {
  const nonGeneric = TEMPLATE_KEYS.filter((k) => !GENERIC_STYLES.has(k));
  const sourced = Object.keys(TEMPLATE_SOURCES);
  for (const key of nonGeneric) {
    assert.ok(sourced.includes(key), `"${key}" is a non-generic template key with no TEMPLATE_SOURCES entry — its provenance is undocumented`);
  }
  for (const key of sourced) {
    assert.ok((nonGeneric as readonly string[]).includes(key), `TEMPLATE_SOURCES has a "${key}" entry that isn't a real TEMPLATE_KEYS value — stale entry`);
  }
});

test('every non-null TEMPLATE_SOURCES value is a real brandtemplates/ directory', () => {
  const real = new Set(realDirectories());
  for (const [key, dir] of Object.entries(TEMPLATE_SOURCES)) {
    if (dir === null) continue;
    assert.ok(
      real.has(dir),
      `"${key}" claims provenance from brandtemplates/"${dir}", but no such directory exists — `
      + 'a fabricated or stale source claim (this is exactly how the proof-builder mismatch happened)',
    );
  }
});

test('every real brandtemplates/ directory is claimed by exactly one template (or documented as a duplicate)', () => {
  const claimed = new Map<string, string>(); // dir -> key
  for (const [key, dir] of Object.entries(TEMPLATE_SOURCES)) {
    if (dir !== null) claimed.set(dir, key);
  }
  for (const dir of realDirectories()) {
    if (dir in TEMPLATE_SOURCE_DUPLICATE_DIRS) {
      // A documented duplicate must point at a directory that IS claimed —
      // otherwise it's silently orphaning a real, distinct upload.
      const canonical = TEMPLATE_SOURCE_DUPLICATE_DIRS[dir];
      assert.ok(
        claimed.has(canonical),
        `"${dir}" is recorded as a duplicate of "${canonical}", but "${canonical}" has no template — `
        + 'either the duplicate mapping is wrong, or this is actually an un-integrated template',
      );
      continue;
    }
    assert.ok(
      claimed.has(dir),
      `brandtemplates/"${dir}" has no corresponding template in TEMPLATE_SOURCES and isn't listed in `
      + 'TEMPLATE_SOURCE_DUPLICATE_DIRS — an uploaded design that was never integrated, or silently dropped',
    );
  }
});

test('proof-builder is documented as original, not a fabricated ported source', () => {
  assert.equal(TEMPLATE_SOURCES['proof-builder'], null, 'proof-builder regained a source claim — verify a brandtemplates/ directory genuinely exists for it before setting this');
});

test('TEMPLATE_SOURCE_DUPLICATE_DIRS entries are themselves real directories', () => {
  const real = new Set(realDirectories());
  for (const dir of Object.keys(TEMPLATE_SOURCE_DUPLICATE_DIRS)) {
    assert.ok(real.has(dir), `TEMPLATE_SOURCE_DUPLICATE_DIRS references brandtemplates/"${dir}", which no longer exists — stale entry`);
  }
});
