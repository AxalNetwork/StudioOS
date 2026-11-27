/**
 * D4574 H3 (#4574) — the icon set's geometry for a test, and the assets
 * binding that serves it.
 *
 * In production the nodes are a static asset
 * (`frontend/public/deck-icons/lucide-<version>.json`, built into `docs/`) that
 * the Worker reads through `env.ASSETS`. A test has no assets binding, so it
 * reads the same file from disk: `iconGeometryFromDisk()` for a direct call
 * into `elements.ts`, `assetsForIcons()` for a route or a handler that calls
 * `loadIconGeometry(env)`.
 *
 * `assetsForIcons({ fail: true })` is the other half: the binding answering the
 * SPA shell, which is what a missing or misnamed asset really does
 * (`not_found_handling = "single-page-application"`). Tests use it to check
 * that a caller says the set could not be read.
 */
import { readFileSync } from 'node:fs';
import { ICON_ASSET, type IconGeometry } from '../src/services/decks/elements';

/** The asset's bytes as the deploy ships them, read from `frontend/public`. */
export function iconAssetText(): string {
  return readFileSync(new URL(`../../frontend/public${ICON_ASSET}`, import.meta.url), 'utf8');
}

/** The geometry `elements.ts` draws from, read straight off disk. */
export function iconGeometryFromDisk(): IconGeometry {
  const body = JSON.parse(iconAssetText()) as { licence_text: string; icons: Record<string, any> };
  return { nodes: body.icons, licence_text: body.licence_text };
}

/**
 * An assets binding that serves the icon asset — or, with `fail`, answers the
 * SPA shell for every path, the way a missing static file does.
 */
export function assetsForIcons({ fail = false }: { fail?: boolean } = {}): { fetch: (input: string) => Promise<Response> } {
  return {
    fetch: async (input: string) => {
      const path = new URL(String(input)).pathname;
      if (fail || path !== ICON_ASSET) {
        return new Response('<!doctype html><title>StudioOS</title>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      return new Response(iconAssetText(), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
}
