/**
 * D1292 (#3388) — the author page's one-click chain (submit → approve →
 * publish for an admin) follows the self-approval rule: an Admin's own
 * article offers no chain and says another admin decides it; a Super Admin's
 * own article asks for a reason in the page first, which goes with approve
 * and publish; someone else's article keeps the chain as before.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/article_chain_d1292.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publishChainFor, OVERRIDE_REASON_MIN } from '../src/pages/ArticleAuthorPage.jsx';

const read = (p) => readFileSync(p, 'utf8');
const ADMIN = { id: 2, role: 'admin' };
const SUPER = { id: 1, role: 'admin', is_super_admin: 1 };
const FOUNDER = { id: 5, role: 'founder' };
const art = (author, status = 'draft') => ({ id: 9, author_user_id: author, status });

test('the chain on each article: none, blocked, override or direct', () => {
  assert.equal(publishChainFor({ user: FOUNDER, article: art(5) }), 'none', 'an author who is not an admin submits');
  assert.equal(publishChainFor({ user: ADMIN, article: art(2) }), 'blocked', 'an Admin’s own article');
  assert.equal(publishChainFor({ user: ADMIN, article: art('2', 'approved') }), 'blocked', 'ids compared as numbers');
  assert.equal(publishChainFor({ user: SUPER, article: art(1) }), 'override', 'a Super Admin’s own article asks a reason');
  assert.equal(publishChainFor({ user: ADMIN, article: art(5) }), 'direct');
  assert.equal(publishChainFor({ user: SUPER, article: art(5, 'approved') }), 'direct');
  assert.equal(publishChainFor({ user: ADMIN, article: art(5, 'published') }), 'none');
  assert.equal(publishChainFor({ user: ADMIN, article: art(null) }), 'direct', 'no recorded author is nobody’s own');
  assert.equal(publishChainFor({ user: ADMIN, article: null }), 'none');
  assert.equal(OVERRIDE_REASON_MIN, 8);
  assert.match(read('cloudflare-worker/src/routes/admin_articles.ts'), /export const OVERRIDE_REASON_MIN = 8;/, 'the page and the Worker agree');
});

test('the page wires it: no button on blocked, a reason dialog before an override, the reason sent to approve and publish', () => {
  const src = read('frontend/src/pages/ArticleAuthorPage.jsx');
  assert.match(src, /\{chain === 'blocked' && \(\s*<span[^>]*data-testid="article-self-approval-note">You wrote this\. Another admin approves and publishes it\.<\/span>/);
  assert.match(src, /\{\(chain === 'direct' \|\| chain === 'override'\) && \(\s*<button\s*onClick=\{\(\) => adminPublish\(\)\}/);
  assert.match(src, /if \(chain === 'none' \|\| chain === 'blocked'\) return;/);
  assert.match(src, /if \(chain === 'override' && !overrideReason\) \{ setOverrideAsk\(true\); return; \}/);
  assert.match(src, /await adminApi\.approve\(article\.id, overrideReason\);/);
  assert.match(src, /await adminApi\.publish\(article\.id, overrideReason\);/);
  assert.match(src, /onConfirm=\{\(r\) => \{ setOverrideAsk\(false\); adminPublish\(r\); \}\}/);
  assert.match(src, /disabled=\{short\}/, 'no override without a reason');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /\b(alert|confirm|prompt)\s*\(/, 'no browser pop-up');
  assert.match(src, /r\.returned_to_queue/, 'an edit that sent it back is said');
  const api = read('frontend/src/lib/api.js');
  assert.match(api, /approve: \(id, overrideReason\) =>\s*request\(`\/admin\/articles\/\$\{id\}\/approve`, \{ method: 'POST', body: JSON\.stringify\(overrideReason \? \{ override_reason: overrideReason \} : \{\}\) \}\)/);
  assert.match(api, /publish: \(id, overrideReason\) =>\s*request\(`\/admin\/articles\/\$\{id\}\/publish`, \{ method: 'POST', body: JSON\.stringify\(overrideReason \? \{ override_reason: overrideReason \} : \{\}\) \}\)/);
});

test('the docs', () => {
  assert.match(read('documentation/architecture/decisions/D1292.md'), /## D1292/);
  assert.match(read('documentation/architecture/ROUTE_MAP.md'), /D1292/);
});
