/**
 * D1084 (#2949, Lovable part 5 of #2398) — the words for a GitHub repository
 * the founder marked "Synced with Lovable", in one place for the GitHub
 * connector's Repositories and Build's Solution design and Prototype / MVP.
 * The mark is the founder's alone (`synced_with` on the GitHub connection's
 * config); a sync never sets it, so nothing here guesses it.
 */
export const LOVABLE_MARK = 'Synced with Lovable';
export const LOVABLE_HINT = 'Built in Lovable? Sync it to GitHub in Lovable, then pick the repository here.';

/** True only for the one value the Worker stores. */
export const isLovable = (v) => v === 'lovable';
