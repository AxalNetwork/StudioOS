/** TikTok OAuth stub used by the connector contract tests (#5291). */
export function fakeTikTok(t, reply) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://open.tiktokapis.com') throw new Error('Unexpected TikTok API origin');
    requests.push({ url, init });
    return reply(url);
  });
  return requests;
}
