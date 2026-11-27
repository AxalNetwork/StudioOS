/** #5291 — the web consent request names exactly the approved read scopes. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { exchangeTikTokCode, refreshTikTokToken, revokeTikTokToken, tiktokAuthorizeUrl } from '../src/integrations/tiktokOAuth.ts';
import { fakeTikTok } from './_tiktok_fake.mjs';

test('TikTok web consent binds the callback and state and asks only for reads', () => {
  const callback = 'https://axal.vc/api/integrations/oauth/tiktok/callback';
  const url = new URL(tiktokAuthorizeUrl('test-app', callback, 'signed+state='));
  assert.equal(url.origin + url.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_key: 'test-app',
    redirect_uri: callback,
    state: 'signed+state=',
    response_type: 'code',
    scope: 'user.info.basic,user.info.stats,video.list',
  });
});

test('TikTok exchange and refresh use provider expiry fields and carry rotated credentials', async t => {
  const requests = fakeTikTok(t, url => url.pathname.endsWith('/revoke/')
    ? new Response(null, { status: 204 })
    : Response.json({
      access_token: 'new-access', refresh_token: 'new-refresh', open_id: 'test-user',
      expires_in: 7200, refresh_expires_in: 15552000, scope: 'user.info.basic',
    }));
  const app = { id: 'test-app', secret: 'test-secret' };
  const tokens = await exchangeTikTokCode(app, 'code', 'https://axal.vc/callback');
  const rotated = await refreshTikTokToken(app, 'old-refresh');
  await revokeTikTokToken(app, rotated.access_token);
  assert.equal(tokens.expires_in, 7200);
  assert.equal(rotated.refresh_token, 'new-refresh');
  assert.deepEqual(requests.map(r => r.url.pathname), ['/v2/oauth/token/', '/v2/oauth/token/', '/v2/oauth/revoke/']);
  assert.equal(requests[1].init.body.get('refresh_token'), 'old-refresh');
  assert.equal(requests[2].init.body.get('token'), 'new-access');
});
