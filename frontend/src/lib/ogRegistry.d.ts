// D1439 (#3914): the types of `ogRegistry.js` for the Worker, which imports it
// to build record cards from the same registry (`services/socialCards.ts`).
// Only what the Worker reads is declared; the registry itself stays plain JS.
export interface OgEntry { path: string; title: string; description: string; key?: string; type: string; section: string; prefix?: boolean }
export interface OgTags {
  path: string; title: string; description: string; url: string; image: string;
  type: string; siteName: string; card: string; imageAlt: string;
}
export const SITE_URL: string;
export const SITE_NAME: string;
export const DEFAULT_OG_KEY: string;
export function ogImageKeys(): string[];
export function ogEntryFor(pathname: string): OgEntry | null;
export function ogImageUrl(key: string): string;
export function ogTagsFor(pathname: string, overrides?: { title?: string; description?: string; image?: string; type?: string }): OgTags;
