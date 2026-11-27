/**
 * #4645 (D4645) — the states a figure can be in, and the read that tells them
 * apart, as the platform vocabulary the owner approved on 2026-11-07 names
 * them. Written for the Portfolio audit's source-availability package so that
 * Portfolio uses the platform's set rather than one of its own.
 *
 * THE FIVE STATES. Four of them are absences and each means something
 * different; the fifth is a number:
 *
 *   `0`              a figure that was read and is zero. A FACT, and the one
 *                    state here that is a value. It is in the vocabulary
 *                    because it is the state the other four keep being
 *                    mistaken for.
 *   not_recorded     the store answered and holds nothing yet.
 *   unavailable      the figure needs a source this deployment does not have
 *                    (no integration, no connected account).
 *   not_applicable   the figure has no meaning for this subject.
 *   unreadable       the store exists and the read FAILED. Nothing is known.
 *
 * WHY A MODULE AND NOT A CONVENTION. Collapsing these into one falsy value is
 * the defect this package was opened for. `computeScore` in `routes/portfolio.ts`
 * read four sources, caught every failure, and turned each one into a benign
 * number: a missing or unreadable scoring snapshot became the figure **50**,
 * an unreadable ticket count became "no open tickets", and an unreadable
 * activity count became "no activity in 30 days" — which then LOWERED the
 * company's health score and could raise its intervention flag. A store that
 * could not be read made a company look dormant, and nothing in the response
 * said so.
 *
 * So the rule this module exists to keep (`CLAUDE.md`, Honesty): where no
 * store exists the answer says "Not recorded" and gives the reason; where a
 * read fails it says "Unreadable", never zero; and no figure the platform does
 * not record is ever invented.
 *
 * A `reason` is a fixed sentence written for a person, never a driver message
 * or a thrown error's text, which can carry SQL.
 */

export type Absence = 'not_recorded' | 'unavailable' | 'not_applicable' | 'unreadable';
export type SourceState = 'recorded' | Absence;

export type Source<T> =
  | { state: 'recorded'; value: T; reason: null }
  | { state: Absence; value: null; reason: string };

/** A figure that was read. `0` is recorded, like any other value. */
export const recorded = <T>(value: T): Source<T> => ({ state: 'recorded', value, reason: null });

/** An absence, with the fixed sentence that says which one it is. */
export const absent = <T>(state: Absence, reason: string): Source<T> => ({ state, value: null, reason });

/**
 * Run one read and keep what happened to it.
 *
 * `read` returns the value, or `null` to mean the store answered and holds
 * nothing (`not_recorded`). A THROW is `unreadable`: the failure is logged
 * under `label` and never reaches the caller as a value, so no caller can mistake
 * a failure for an answer. The thrown text is not put in `reason`.
 */
export async function readSource<T>(
  label: string,
  read: () => Promise<T | null>,
  reasons: { notRecorded: string; unreadable: string },
): Promise<Source<T>> {
  try {
    const value = await read();
    return value == null ? absent<T>('not_recorded', reasons.notRecorded) : recorded(value);
  } catch (e) {
    console.warn('[sourceState] read failed', label, (e as Error).message);
    return absent<T>('unreadable', reasons.unreadable);
  }
}

/** The labels of the sources that could not be read, in the order given. */
export function unreadableLabels(sources: Record<string, Source<unknown>>): string[] {
  return Object.entries(sources).filter(([, s]) => s.state === 'unreadable').map(([label]) => label);
}

/** How a source reads over the wire: the state, the reason when it is an absence, and the value when there is one. */
export const sourceDto = <T>(s: Source<T>) => ({ state: s.state, value: s.value, reason: s.reason });
