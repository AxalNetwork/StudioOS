import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TicketGithubRecovery } from '../src/pages/TicketsPage.jsx';
import { githubSyncBadge } from '../src/pages/AdminPage.jsx';

const render = props => renderToStaticMarkup(React.createElement(TicketGithubRecovery, {
  isAdmin: true, pending: 3, configured: true, busy: false, onRetry() {}, ...props,
}));

test('recovery is offered only to admins with unlinked tickets', () => {
  assert.equal(render({ isAdmin: false }), '');
  assert.equal(render({ pending: 0 }), '');
  const html = render({});
  assert.match(html, /3 saved tickets/);
  assert.match(html, /Create missing GitHub issues/);
  assert.match(html, /up to 25/);
  assert.match(html, /href="\/admin\?tab=github"/);
  assert.doesNotMatch(html, /disabled=""/);
});

test('recovery cannot run while busy, unconfigured, or configuration is unknown', () => {
  for (const props of [{ busy: true }, { configured: false }, { configured: null }]) {
    assert.match(render(props), /disabled=""/);
  }
});

test('configured and readable never report verified issue creation, and a failed write stays red', () => {
  const cfg = { configured: true, has_token: true };
  assert.equal(githubSyncBadge(cfg, null).text, 'Write access unverified');
  assert.equal(githubSyncBadge(cfg, { ok: true, can_write: 'unproven' }).text, 'Write access unverified');
  const failed = githubSyncBadge(cfg, { can_write: false, http_status: 403 });
  assert.equal(failed.text, 'Issue creation failed');
  assert.match(failed.cls, /red/);
  assert.equal(githubSyncBadge(cfg, { can_write: true }).text, 'Issue creation verified');
});
