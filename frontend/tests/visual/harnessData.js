// D1511 (#3762) — what the visual harness mounts, from `fixture.json`, which
// `cloudflare-worker/test/deck_visual_fixture_d1511.test.ts` builds from the
// Worker's own modules and fails on when they change: the model, every theme
// the Worker serves, the 17 structures, each aspect's Grid and the accepted
// one-click deck.
import { readFileSync } from 'node:fs';

const F = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'));

export const THEMES = F.themes;
export const ASPECTS = F.aspects;
export const STRUCTURES = F.structures;
export const ONE_CLICK = F.oneclick;
export const USER = { id: 2, role: 'founder', founder_id: 20, name: 'Synthetic Founder' };

/** Everything the harness reads, for a deck of `slides` in `theme` at `aspect`, with its Grid reply. */
export function harness({ slides = F.cards, grid = F.grids[aspectOf(arguments[0]?.aspect)], theme = 'brand', aspect = '16:9', dark = false, page = 'editor' } = {}) {
  const deck = {
    id: 31, project_id: 7, version: 3, title: 'Synthetic deck', created_at: '2026-10-24 10:00:00', audience: 'seed_fund',
    theme: { kind: theme, background: null, ...(aspect === '4:3' ? { aspect: '4:3' } : {}) }, slides,
  };
  return { user: USER, model: F.model, deck, grid, dark, page };
}

function aspectOf(a) { return a === '4:3' ? '4:3' : '16:9'; }
