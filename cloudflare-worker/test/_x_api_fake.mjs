/** Request recorder for the shared X API client tests (#5290). */
export function fakeX(t, reply) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://api.x.com') throw new Error('Unexpected X API origin');
    const request = { url, ...init };
    requests.push(request);
    return reply(request);
  });
  return requests;
}
