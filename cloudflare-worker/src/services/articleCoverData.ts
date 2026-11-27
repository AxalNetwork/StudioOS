// D4574 H3 (#4574): the seed covers' bytes are no longer embedded here.
//
// Each cover is a static file under `frontend/public/article-covers/`, built
// into `docs/` and served by the Worker's own assets binding. The two JPEGs
// were base64 strings in this file, 411 KiB of the Worker script that every
// isolate parsed on start and that only the first article read ever used.
// `articleCovers.ts` fetches the file through `env.ASSETS` when a seed is
// actually needed.
export interface SeedCover {
  slug: string;
  mime: string;
  /** The asset path the cover is served at, under the Worker's `[assets]` directory. */
  asset: string;
}

export const SEED_COVERS: SeedCover[] = [
  { slug: 'how-ai-is-changing-startup-investment-and-venture-support', mime: 'image/jpeg', asset: '/article-covers/how-ai-is-changing-startup-investment-and-venture-support.jpg' },
  { slug: 'how-global-partnerships-accelerate-scaling', mime: 'image/jpeg', asset: '/article-covers/how-global-partnerships-accelerate-scaling.jpg' },
];
