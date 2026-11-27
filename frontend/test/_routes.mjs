/**
 * Read one <Route> declaration out of App.jsx as a bounded window of lines.
 *
 * A route's `element` used to always fit on the line carrying `path="..."`,
 * so a dozen guards were written as `lines.find(l => l.includes(path))` and
 * then matched against that single line. That assumption is not stable: every
 * time a route grows a second branch — an investor arm ahead of the founder
 * one, a `?mode=workspace` ternary — Prettier wraps the element across lines
 * and the single-line read silently stops seeing the thing it was pinning.
 * `724dfc9f` did exactly that to /raise/data-room and /raise/pitch and took
 * four assertions red with it, none of which described a behaviour change.
 *
 * So: start at the line declaring the path and read forward, stopping at the
 * next `<Route` so the window can never walk into a neighbour's markup and
 * false-positive on it. `limit` caps the walk for a route that is the last in
 * its block.
 */
export function routeBlock(app, path, limit = 8) {
  const lines = Array.isArray(app) ? app : app.split('\n');
  const start = lines.findIndex((l) => l.includes(`path="${path}"`));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && end < start + limit && !lines[end].includes('<Route ')) end++;
  return lines.slice(start, end).join('\n');
}
