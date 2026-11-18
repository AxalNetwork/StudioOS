/** GitHub REST transport for D6935. Error messages never contain response bodies or alert details. */
export function githubApi(owner, repo, token, fetcher = fetch) {
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo) || !token) {
    throw new Error('Missing GitHub repository or authentication');
  }
  const root = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = {
    authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
    'x-github-api-version': '2026-03-10', 'content-type': 'application/json',
  };
  async function json(method, url, body) {
    const response = await fetcher(url, {
      method, headers, redirect: 'error', signal: AbortSignal.timeout(30_000),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      // A rate limit must halt the sweep even if another endpoint considers 403 a local refusal.
      const limited = response.status === 429 || response.headers.has('retry-after')
        || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
      let prCreationDisabled = false;
      if (!limited && response.status === 403 && method === 'POST' && url === root + '/pulls') {
        const detail = await response.json().catch(() => null);
        prCreationDisabled = /^GitHub Actions is not permitted to create or approve pull requests\.?$/i.test(detail?.message ?? '');
      }
      throw Object.assign(new Error(`GitHub HTTP ${response.status}`), {
        status: response.status, limited, prCreationDisabled,
      });
    }
    if (response.status === 204) return null;
    if (response.status === 202) {
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }
    return response.json();
  }
  function request(method, path, body) {
    const target = new URL(root + path);
    if ((path && !path.startsWith('/')) || path.startsWith('//') ||
        (target.href !== root && !target.href.startsWith(root + '/'))) throw new Error('Invalid API path');
    return json(method, target.href, body);
  }
  async function pages(path) {
    const items = [];
    for (let page = 1; page <= 200; page++) {
      const rows = await request('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(rows)) throw new Error('Incomplete GitHub inventory');
      items.push(...rows);
      if (rows.length < 100) return items;
    }
    throw new Error('GitHub inventory exceeded pagination limit');
  }
  async function searchIssues(query) {
    const items = [];
    const q = encodeURIComponent(`repo:${owner}/${repo} ${query}`);
    for (let page = 1; page <= 10; page++) {
      const result = await json('GET', `https://api.github.com/search/issues?q=${q}&per_page=100&page=${page}`);
      if (result.incomplete_results !== false || !Array.isArray(result.items) ||
          !Number.isSafeInteger(result.total_count) || result.total_count > 1000) {
        throw new Error('Incomplete GitHub issue search');
      }
      items.push(...result.items);
      if (items.length >= result.total_count) return items;
      if (!result.items.length) break;
    }
    throw new Error('Incomplete GitHub issue search');
  }
  return { request, pages, searchIssues };
}
