/**
 * Admin GitHub ticket-sync config. Mounted at `/api/admin/github`.
 *
 *   GET    /       → connection status (no secret values) + webhook URL
 *   PUT    /       → set token / repo owner / repo name / webhook secret
 *                    (each promoted as a Cloudflare Worker secret)
 *   POST   /test   → probe the target repo with the configured token
 *   DELETE /       → delete all four Worker secrets
 *
 * GitHub credentials differ from the OAuth id/secret pairs handled by
 * admin_integration_keys.ts (single token + repo + webhook secret), so this
 * is a dedicated route that reuses the same Cloudflare secret-promotion
 * helpers (`setSecret`/`deleteSecret`). Gated on `requireAdmin`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { setSecret, deleteSecret, maskClientId } from '../services/cloudflareSecrets';

const r = new Hono<{ Bindings: Env }>();

const DEFAULT_OWNER = 'AxalNetwork';
const DEFAULT_REPO = 'StudioOS';

function webhookUrl(c: any): string {
  const appUrl = (c.env as { APP_URL?: string }).APP_URL;
  if (appUrl) return `${appUrl.replace(/\/$/, '')}/api/github/webhook`;
  try {
    const u = new URL(c.req.url);
    return `${u.origin}/api/github/webhook`;
  } catch {
    return '/api/github/webhook';
  }
}

r.get('/', async (c) => {
  await requireAdmin(c);
  const env = c.env;
  const hasToken = !!env.GITHUB_ACCESS_TOKEN;
  const owner = env.GITHUB_REPO_OWNER || DEFAULT_OWNER;
  const repo = env.GITHUB_REPO_NAME || DEFAULT_REPO;
  return c.json({
    configured: hasToken && !!env.GITHUB_REPO_OWNER && !!env.GITHUB_REPO_NAME,
    source: hasToken ? 'env' : 'unconfigured',
    has_token: hasToken,
    token_preview: hasToken ? maskClientId(env.GITHUB_ACCESS_TOKEN!) : null,
    repo_owner: owner,
    repo_name: repo,
    default_repo_owner: DEFAULT_OWNER,
    default_repo_name: DEFAULT_REPO,
    has_webhook_secret: !!env.GITHUB_WEBHOOK_SECRET,
    webhook_url: webhookUrl(c),
  });
});

r.put('/', async (c) => {
  await requireAdmin(c);
  let body: { token?: string; repo_owner?: string; repo_name?: string; webhook_secret?: string; generate_webhook_secret?: boolean } = {};
  try { body = await c.req.json(); } catch { /* empty */ }

  const pushes: Array<{ name: string; value: string }> = [];
  if (typeof body.token === 'string' && body.token.trim()) {
    if (body.token.trim().length > 4096) return c.json({ error: 'value_too_long' }, 400);
    pushes.push({ name: 'GITHUB_ACCESS_TOKEN', value: body.token.trim() });
  }
  if (typeof body.repo_owner === 'string' && body.repo_owner.trim()) {
    pushes.push({ name: 'GITHUB_REPO_OWNER', value: body.repo_owner.trim() });
  }
  if (typeof body.repo_name === 'string' && body.repo_name.trim()) {
    pushes.push({ name: 'GITHUB_REPO_NAME', value: body.repo_name.trim() });
  }

  let generatedSecret: string | null = null;
  if (body.generate_webhook_secret || (typeof body.webhook_secret === 'string' && !body.webhook_secret.trim())) {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    generatedSecret = Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
    pushes.push({ name: 'GITHUB_WEBHOOK_SECRET', value: generatedSecret });
  } else if (typeof body.webhook_secret === 'string' && body.webhook_secret.trim()) {
    pushes.push({ name: 'GITHUB_WEBHOOK_SECRET', value: body.webhook_secret.trim() });
  }

  if (pushes.length === 0) return c.json({ error: 'nothing_to_update' }, 400);

  for (const p of pushes) {
    const res = await setSecret(c.env, p.name, p.value);
    if (!res.ok) {
      const httpStatus = res.code === 'cloudflare_api_token_missing' ? 503 : 502;
      return c.json({ error: res.code || 'cf_api_failed', detail: res.error || null, failed_secret: p.name }, httpStatus);
    }
  }

  const resp: Record<string, unknown> = { ok: true };
  if (generatedSecret) resp.webhook_secret = generatedSecret;
  return c.json(resp);
});

r.post('/test', async (c) => {
  await requireAdmin(c);
  const env = c.env;
  if (!env.GITHUB_ACCESS_TOKEN || !env.GITHUB_REPO_OWNER || !env.GITHUB_REPO_NAME) {
    return c.json({ ok: false, reachable: false, http_status: null, detail: 'GitHub is not fully configured (token, owner, repo required).' });
  }
  const repoFull = `${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}`;
  let resp: Response;
  try {
    resp = await fetch(`https://api.github.com/repos/${repoFull}`, {
      headers: {
        Authorization: `Bearer ${env.GITHUB_ACCESS_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'StudioOS-Worker',
      },
    });
  } catch (e: any) {
    return c.json({ ok: false, reachable: false, http_status: null, detail: `Network error: ${String(e?.message || e).slice(0, 200)}` });
  }
  if (resp.status === 200) return c.json({ ok: true, reachable: true, http_status: 200, detail: `Connected to ${repoFull}.`, repo: repoFull });
  if (resp.status === 404) return c.json({ ok: false, reachable: true, http_status: 404, detail: `Repo ${repoFull} not found, or the token lacks access to it.` });
  if (resp.status === 401 || resp.status === 403) return c.json({ ok: false, reachable: true, http_status: resp.status, detail: 'GitHub rejected the token (check it has Issues read/write on the repo).' });
  return c.json({ ok: false, reachable: true, http_status: resp.status, detail: `GitHub returned HTTP ${resp.status}.` });
});

r.delete('/', async (c) => {
  await requireAdmin(c);
  for (const name of ['GITHUB_ACCESS_TOKEN', 'GITHUB_REPO_OWNER', 'GITHUB_REPO_NAME', 'GITHUB_WEBHOOK_SECRET']) {
    const res = await deleteSecret(c.env, name);
    if (!res.ok && res.code !== 'cloudflare_api_token_missing') {
      return c.json({ error: res.code || 'cf_api_failed', detail: res.error || null, failed_secret: name }, 502);
    }
  }
  return c.json({ ok: true });
});

export default r;
