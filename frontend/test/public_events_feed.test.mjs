/**
 * Public events: the archive is an archive, and the feed is not silently
 * clipped at 20 (Wave 3).
 *
 * Two defects sat behind the Events canvas rather than in front of it:
 *
 *   1. `?past=1` only *dropped* the upcoming predicate. The Past tab therefore
 *      returned upcoming and past events together, oldest first — a visitor
 *      clicking "Past" saw the same future events they had just scrolled. The
 *      worker test that covered it asserted `.some(slug === 'old')`, which is
 *      true under both the broken and the fixed behaviour.
 *   2. The page requested the API's default `limit` with no offset handling,
 *      so a 21st public event did not exist on the public events page and
 *      nothing said so.
 *
 * The canvas also asks for a "replay" chip on past events. There is no
 * `recording_url` or `replay_url` column on `events`, so the past-event CTA
 * says "View details" — it used to say "View recap", which promised a
 * recording the platform has never stored.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const PAGE = 'frontend/src/pages/events/PublicEventsPage.jsx';

test('the archive is its own range and reads backwards', () => {
  const w = read('cloudflare-worker/src/routes/events_public.ts');
  assert.match(w, /includePast\s*\n?\s*\?\s*`COALESCE\(ends_at, starts_at\) < datetime\('now'\)`/,
    'past=1 must select finished events only');
  assert.match(w, /:\s*`COALESCE\(ends_at, starts_at\) >= datetime\('now'\)`/,
    'upcoming must run until an event ENDS, so a session in progress stays listed');
  assert.match(w, /const order = includePast \? 'DESC' : 'ASC'/,
    'the archive must be most-recent-first');
  // The old shape must not survive anywhere in the handler.
  assert.ok(!/!includePast\) \{ where\.push\(`starts_at >= datetime/.test(w),
    'the old "drop the predicate" branch is the bug');
});

test('the page pages, and does not blank itself while appending', () => {
  const s = read(PAGE);
  assert.match(s, /const PAGE_SIZE = 50/);
  assert.match(s, /limit: PAGE_SIZE,\n\s*offset,/, 'the request must carry the offset');
  assert.match(s, /setEvents\(\(prev\) => \(offset === 0 \? page : \[\.\.\.prev, \.\.\.page\]\)\)/,
    'page 2 must append, not replace');
  assert.match(s, /loading && offset === 0 \?/,
    'the full-page spinner must not replace the list during a Load more');
  assert.match(s, /setHasMore\(page\.length === PAGE_SIZE\)/);
});

test('changing a filter restarts paging', () => {
  // Without this, page 2 of the previous query lands under the new one.
  const s = read(PAGE);
  const i = s.indexOf('setOffset(0);');
  assert.ok(i > 0, 'an effect must reset the offset');
  const dep = s.slice(i, i + 140);
  for (const f of ['filterType', 'filterFrom', 'filterTo', 'searchQ', 'when']) {
    assert.ok(dep.includes(f), `${f} must reset paging`);
  }
});

test('months are grouped in the same timezone the cards are rendered in', () => {
  const s = read(PAGE);
  assert.match(s, /function groupByMonth/);
  const body = s.slice(s.indexOf('function groupByMonth'), s.indexOf('function DateTile'));
  assert.ok(!/getUTC/.test(body),
    'the cards render in local time; bucketing by UTC files an evening event under the wrong month');
  // Grouping must preserve the server's order rather than re-sorting, or the
  // archive would come back oldest-first on the client.
  assert.ok(!/\.sort\(/.test(body), 'the server already ordered the feed');
});

test('no surface promises a recap or a replay that is not stored', () => {
  const raw = read(PAGE);
  // The code comment next to the CTA names the old label to explain why it is
  // gone, so the ban has to look at code only.
  const s = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(raw.includes('View recap'), 'the rationale comment should still name the old label');
  assert.ok(!s.includes('View recap'), 'there is no recap to view');
  assert.match(s, /isPast \? 'View details' : 'Register'/);

  // The premise: no such column exists on events.
  const sql = (() => {
    const dir = resolve(root, 'cloudflare-worker/sql');
    const parts = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name));
        else if (e.name.endsWith('.sql')) parts.push(readFileSync(join(d, e.name), 'utf8'));
      }
    };
    walk(dir);
    return parts.join('\n');
  })();
  for (const col of ['recording_url', 'replay_url', 'stream_url']) {
    assert.ok(!sql.includes(col), `${col} now exists — build the replay chip`);
  }
});
