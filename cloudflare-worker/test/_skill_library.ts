/**
 * D4574 H3 (#4574) — the skill library's entries for a test, and the assets
 * binding that serves them.
 *
 * In production the entries are a static asset
 * (`frontend/public/skill-library/library-<digest16>.json`, written by
 * `scripts/build-skill-library.mjs` and built into `docs/`) that the Worker
 * reads through `env.ASSETS`; the generated module holds only the index. A
 * test has no assets binding, so it reads the same file from disk:
 * `SKILL_LIBRARY` for a direct call into `skillLibrarySeed.ts` or
 * `skillCatalogue.ts`, `assetsForSkillLibrary()` for a route that calls
 * `loadSkillLibrary(env)`.
 *
 * `assetsForSkillLibrary({ fail: true })` is the other half: the binding
 * answering the SPA shell, which is what a missing or misnamed asset really
 * does (`not_found_handling = "single-page-application"`).
 */
import { readFileSync } from 'node:fs';
import { SKILL_LIBRARY_ASSET, type LibraryEntry } from '../src/services/agents/skillLibrary.generated.ts';

/** The asset's bytes as the deploy ships them, read from `frontend/public`. */
export function skillLibraryAssetText(): string {
  return readFileSync(new URL(`../../frontend/public${SKILL_LIBRARY_ASSET}`, import.meta.url), 'utf8');
}

/** Every library entry, slug order: what the routes read through the binding. */
export const SKILL_LIBRARY: readonly LibraryEntry[] = JSON.parse(skillLibraryAssetText()).entries;

/**
 * An assets binding that serves the library asset — or, with `fail`, answers
 * the SPA shell for every path, the way a missing static file does. `body`
 * replaces the asset's bytes (a tampered or stale file). `reads` counts calls.
 */
export function assetsForSkillLibrary({ fail = false, body }: { fail?: boolean; body?: string } = {}) {
  const binding = {
    reads: 0,
    fetch: async (input: string) => {
      binding.reads++;
      const path = new URL(String(input)).pathname;
      if (fail || path !== SKILL_LIBRARY_ASSET) {
        return new Response('<!doctype html><title>StudioOS</title>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      return new Response(body ?? skillLibraryAssetText(), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  return binding;
}
