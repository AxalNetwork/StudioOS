/**
 * The platform switches as HQ's two pages draw them: Platform's Feature flags
 * zone lists every switch read-only (D202), and Platform → Switches throws and
 * releases the ones an operator can (D203). What both need lives here once —
 * `lib/README.md`'s rule, since the second page is what would otherwise make
 * these the second copy.
 *
 * NOTHING HERE DECIDES A STATE. The worker computes each switch's state through
 * the predicate the code that obeys it calls (services/platformSwitches.ts);
 * these only say, in words and colour, what the payload already says.
 */

/**
 * One tone per state the switch registry can return. `services/platformSwitches`
 * exports the same three as SWITCH_STATES, and `hq_platform_consoles_d202`
 * fails when the lists differ. An unknown state falls back to the unreadable
 * tone, never to "on" or "off", because a state these pages do not know is not
 * one they can report.
 */
export const SWITCH_TONE = {
  on: 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900',
  off: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  unreadable: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
};

/** What sets a switch, in the words both pages print. */
export function setByLabel(setBy) {
  if (setBy === 'runtime') return 'set at runtime';
  if (setBy === 'operator') return 'thrown by HQ or at deploy';
  return 'set at deploy';
}

/**
 * A stored stamp to the minute, as written. `set_at` is SQLite's clock in
 * UTC, so it is shown as UTC rather than parsed into the reader's zone.
 */
export const stampMinutes = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : null);

/**
 * The operator half of a switch in one sentence, from what is stored and
 * nothing else. Null for a switch with no operator half — one set at deploy
 * or at runtime. An unreadable store says so; it is never "never thrown".
 */
export function operatorLine(sw) {
  const op = sw?.operator;
  if (!op) return null;
  if (!op.available) return `Unreadable — ${op.reason}`;
  if (!op.set_at) return 'Never thrown by HQ.';
  const who = op.set_by_name
    || (op.set_by_user_id != null ? `account #${op.set_by_user_id}` : 'an account that was not recorded');
  return `${op.thrown ? 'Thrown' : 'Released'} by ${who} at ${stampMinutes(op.set_at)} UTC — ${op.reason}`;
}
