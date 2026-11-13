/**
 * D448 — the moderation page paints a failed read, a loading first paint,
 * a missing count, and a payload that is not a list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import SpinoutModerationPage from '../src/pages/admin/SpinoutModerationPage.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const render = (props) => renderToStaticMarkup(createElement(SpinoutModerationPage, props));

test('the route is an admin guard, and the page does not preselect an action', () => {
  const app = raw('frontend/src/App.jsx');
  assert.match(app, /guard\(\['admin'\], <SpinoutModerationPage \/>\)/);
  const page = raw('frontend/src/pages/admin/SpinoutModerationPage.jsx');
  assert.doesNotMatch(page, /useState\('suspend'\)/);
  assert.match(page, /aria-label=\{`Decide on \$\{row\.who\}`\}/);
  assert.match(page, /requestSeq\.current !== mine/);
  assert.doesNotMatch(page, />This member</);
  assert.match(page, /actError\.code === 'super_admin_required'/);
});

test('a loading first paint, a failed read, a missing count, and a non-array list', () => {
  const loading = render();
  assert.match(loading, /Loading open cases/);
  assert.doesNotMatch(loading, /The list was read and holds nothing/);

  const failed = render({ resolved: { error: { message: 'Open moderation cases could not be read.' } } });
  assert.match(failed, /data-testid="spinout-moderation-unreadable"/);
  assert.match(failed, /could not be read/);
  assert.doesNotMatch(failed, /The list was read and holds nothing/);
  assert.doesNotMatch(failed, /0 awaiting/);

  const missing = render({
    resolved: {
      list: {
        cases: [{ id: 4, user_id: 8, who: 'Ada Member', status: 'under_review', reason_code: 'spam' }],
        sanctions: [],
        sanctions_count: 0,
      },
    },
  });
  assert.match(missing, /Count not recorded/);
  assert.match(missing, /not shown as zero/);
  assert.doesNotMatch(missing, /0 awaiting/);
  assert.doesNotMatch(missing, /Showing 1 of /);
  assert.match(missing, /aria-label="Decide on Ada Member"/);

  const malformed = render({
    resolved: { list: { cases: { bad: true }, open_count: 4, sanctions: [], sanctions_count: 0 } },
  });
  assert.match(malformed, /data-testid="spinout-moderation-cases-unreadable"/);
  assert.match(malformed, /could not be read/);
  assert.doesNotMatch(malformed, /The list was read and holds nothing/);
  assert.doesNotMatch(malformed, /Showing 0 of 4/);
});

test('the heading names the person, history is shown, and a capped list says how many', () => {
  const html = render({
    resolved: {
      list: {
        cases: [{ id: 4, user_id: 8, who: 'Ada Member', status: 'under_review', reason_code: 'spam', severity: 'high' }],
        open_count: 3,
        sanctions: [{ id: 9, user_id: 8, who: 'Ada Member', status: 'suspended', reason_code: 'abuse' }],
        sanctions_count: 1,
      },
      picked: 8,
      who: 'Ada Member',
      history: {
        lab_access: false,
        moderation_scope: 'spinout_lab_active',
        cases: [
          { id: 4, status: 'under_review', reason_code: 'spam', resolved_at: null },
          { id: 2, status: 'suspended', reason_code: 'abuse', resolved_at: '2026-09-02 00:00:00' },
        ],
      },
      actError: {
        code: 'super_admin_required',
        message: 'Only a super admin can decide a moderation case on another admin.',
      },
    },
  });
  assert.match(html, /<h2[^>]*>Ada Member<\/h2>/);
  assert.match(html, /data-testid="spinout-moderation-history"/);
  assert.match(html, /under_review/);
  assert.match(html, /closed/);
  assert.match(html, /Showing 1 of 3 awaiting a decision/);
  assert.match(html, /1 sanctions in force/);
  assert.doesNotMatch(html, /4 awaiting/);
  assert.match(html, /data-testid="spinout-moderation-super-admin"/);
  assert.match(html, /Only a super admin can decide/);
  assert.match(html, /value="close"/);
  assert.match(html, /Choose an action/);
});
