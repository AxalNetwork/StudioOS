/**
 * #6999 (X17): the network handoffs say where they go.
 *
 *   1  `/insights` ends on `/articles`, with no hash (pinned with the rest of
 *      the publications fold in advisory_publications_2297.test.mjs, which
 *      also pins that an empty Briefs shelf draws nothing).
 *   2  Jobs: signed out, the band's action reads "Sign in to post a role" and
 *      opens `/login?next=/jobs/new`; the `next` is a same-origin path, so
 *      LoginPage's safeNextPath() keeps it and the person lands on the
 *      editor. Signed in, it stays "Post a role →" to `/jobs/new`.
 *   3  The page draws that action from the signed-in user, not a fixed link.
 *
 * Mutation checked (each broke a test below, then was restored):
 *   · postRoleAction ignores the user (always the editor link) → test 1 fails.
 *   · `next` built without encodeURIComponent → test 1 fails (raw path).
 *   · `next` pointing at `//jobs/new` → test 1 fails (not same-origin).
 *   · the band's Link back to the fixed POST_ROLE_HREF → test 2 fails.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/network_handoffs_6999.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { postRoleAction, POST_ROLE_HREF } from '../src/pages/jobs/PublicJobsPage.jsx';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('1: signed out, the jobs action asks to sign in and returns to the editor; signed in, it opens the editor', () => {
  const out = postRoleAction(null);
  assert.equal(out.label, 'Sign in to post a role');
  assert.equal(out.href, '/login?next=%2Fjobs%2Fnew');
  const url = new URL(out.href, 'https://axal.vc');
  assert.equal(url.origin, 'https://axal.vc', 'the action stays on this origin');
  assert.equal(url.pathname, '/login');
  const next = url.searchParams.get('next');
  assert.equal(next, POST_ROLE_HREF, 'sign-in returns to the job editor');
  assert.ok(next.startsWith('/') && !next.startsWith('//'), 'next is a same-origin path');
  assert.equal(new URL(next, 'https://axal.vc').origin, 'https://axal.vc');

  const signedIn = postRoleAction({ id: 7, role: 'founder' });
  assert.deepEqual(signedIn, { label: 'Post a role →', href: '/jobs/new' });
});

test('2: the jobs page draws the band action from the signed-in user', () => {
  const src = read('../src/pages/jobs/PublicJobsPage.jsx');
  assert.match(src, /const \{ user \} = useAuth\(\) \|\| \{\};\s*\n\s*const postRole = postRoleAction\(user\);/);
  assert.match(src, /<Link to=\{postRole\.href\}[^>]*data-testid="jobs-post-role">\{postRole\.label\}<\/Link>/);
  assert.doesNotMatch(src, /<Link to=\{POST_ROLE_HREF\}/, 'no fixed editor link that bounces a signed-out visitor');
});
