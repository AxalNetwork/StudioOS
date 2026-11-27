/**
 * D778 part 12 (#2103) — the Studio interview's two presses that run a model,
 * named as each profile's inventory names them:
 *
 *   Send (`POST /tool/auto`)     founder `ask:studio`, advisor and partner `answer:interview`
 *   Explain (`POST /explain`)    `explain:question` in all three
 *
 * The press sends its own key (`railPressHeaders`), and `railFor` lets it win.
 * This is the fallback for a run with no rail context: it used to name
 * `tool:advisor` and `explain:advisor`, keys no inventory lists. A role whose
 * inventory has no such press (an investor, an admin) keeps those.
 *
 * The page stays the shared `studio`, as the mic's does (part 6): the routes
 * serve the founder's, advisor's and partner's Studio alike, and the page's AI
 * switch and model picks are stored under it.
 */
export const STUDIO_OPTIONS = {
  send: { founder: 'ask:studio', advisor: 'answer:interview', partner: 'answer:interview' },
  explain: { founder: 'explain:question', advisor: 'explain:question', partner: 'explain:question' },
} as const satisfies Record<string, Record<string, string>>;

const UNLISTED = { send: 'tool:advisor', explain: 'explain:advisor' } as const;

export type StudioPress = keyof typeof STUDIO_OPTIONS;

/** The option a Studio press names for the caller's role. */
export function studioOption(press: StudioPress, role: unknown): string {
  return (STUDIO_OPTIONS[press] as Record<string, string>)[String(role)] ?? UNLISTED[press];
}
