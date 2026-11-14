// D4162 (#4162, SA6b): the words of the banner every team sees while Axal HQ
// has paused all AI agents, from `GET /api/teams/platform-status`. Nothing
// paused (or nothing read) is no banner. The admin is named, never by email;
// HQ's reason is not shown to teams.
export function pausedLine(s) {
  if (!s?.paused) return null;
  const when = s.since ? ` since ${String(s.since).slice(0, 16).replace('T', ' ')} UTC` : '';
  const who = s.by_name ? ` by ${s.by_name}` : '';
  return `Axal has paused all AI agents on the platform${when}${who}. Agents start no new work; proposals already made can still be decided.`;
}
