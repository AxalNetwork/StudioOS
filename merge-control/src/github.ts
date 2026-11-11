/** D5618: request-scoped GitHub App installation client; no PAT, no production Worker import. */
import type { Env, GithubApi } from './types.ts';
import { createPrivateKey, sign } from 'node:crypto';
const base64url = (value: Uint8Array | string) => Buffer.from(value).toString('base64url');
export async function githubClient(env: Env, fetcher: typeof fetch = fetch): Promise<GithubApi> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.REPOSITORY) || !/^\d+$/.test(env.GITHUB_APP_ID ?? '') || !/^\d+$/.test(env.GITHUB_INSTALLATION_ID ?? '') || !env.GITHUB_APP_PRIVATE_KEY) throw new Error('App not configured');
  const now = Math.floor(Date.now() / 1000);
  const input = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID }))}`;
  const signature = sign('RSA-SHA256', Buffer.from(input), createPrivateKey(env.GITHUB_APP_PRIVATE_KEY));
  const response = await fetcher(`https://api.github.com/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`, {
    method: 'POST', headers: { Authorization: `Bearer ${input}.${base64url(new Uint8Array(signature))}`, Accept: 'application/vnd.github+json', 'User-Agent': 'StudioOS-Merge-Control', 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositories: [env.REPOSITORY.split('/')[1]], permissions: { actions: 'write', contents: 'read' } }) });
  if (!response.ok) throw new Error(`App authentication HTTP ${response.status}`);
  const { token } = await response.json<{ token: string }>();
  if (!token) throw new Error('missing installation token');
  let requests = 0;
  return async (method, path, body) => {
    if (++requests > 100 || !/^[\w./?=&%_-]+$/.test(path) || path.includes('..')) throw new Error('GitHub request cap or invalid path');
    const res = await fetcher(`https://api.github.com/repos/${env.REPOSITORY}/${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'StudioOS-Merge-Control', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!res.ok && !(method === 'POST' && path.endsWith('/cancel') && res.status === 409)) throw Object.assign(new Error(`GitHub HTTP ${res.status}`), { status: res.status });
    return res.status === 204 || res.status === 202 || res.status === 409 ? null : res.json();
  };
}
