/** Shared X client requests and caller-safe errors (#5290). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { getXAudience, revokeToken, setMediaAltText, uploadMedia, weightedLength, XError } from '../src/services/xClient.ts';
import { fakeX } from './_x_api_fake.mjs';

test('weighted length handles NFC, emoji sequences, CJK and shortened URLs', () => {
  assert.equal(weightedLength('cafe\u0301'), 4);
  assert.equal(weightedLength('👨‍👩‍👧‍👦漢'), 4);
  assert.equal(weightedLength('https://example.com/some/long/path'), 23);
});

test('v2 uploads send alt text to the uploaded media id', async t => {
  const requests = fakeX(t, ({ url }) => url.pathname.endsWith('/upload')
    ? Response.json({ data: { id: '42' } }) : new Response(null, { status: 204 }));
  const uploaded = await uploadMedia({ accessToken: 'test-token', accountId: 'alt', bytes: Uint8Array.of(1) });
  await setMediaAltText('test-token', 'alt', uploaded.media_id_string, 'A diagram');
  assert.deepEqual(requests.map(r => r.url.pathname), ['/2/media/upload', '/2/media/metadata']);
  assert.deepEqual(JSON.parse(requests[1].body), { id: '42', metadata: { alt_text: { text: 'A diagram' } } });
});

test('metrics failures do not expose response text, and revoke uses the supplied app', async t => {
  const requests = fakeX(t, ({ url }) => url.pathname.endsWith('/revoke')
    ? new Response(null, { status: 204 }) : new Response('private fixture', { status: 400 }));
  await assert.rejects(getXAudience('test-token', 'audience'), error =>
    error instanceof XError && error.status === 400 && !error.message.includes('private fixture'));
  await revokeToken({ clientId: 'fixture-app', clientSecret: 'fixture-secret' }, 'test-token');
  assert.equal(requests[0].url.searchParams.get('user.fields'), 'public_metrics');
  assert.equal(requests[1].body.get('client_id'), 'fixture-app');
});
