/**
 * Admin GitHub ticket-sync config. Mounted at `/api/admin/github`.
 *
 *   GET    /       → connection status (no secret values), the repository
 *                    this Worker is deployed with, and the webhook URL
 *   PUT    /       → set the token and/or the webhook secret (each promoted as
 *                    a Cloudflare Worker secret). Never the repository.
 *   POST   /test   → probe the target repo with the configured token
 *   DELETE /       → delete the token and the webhook secret
 *
 * D270 — THE REPOSITORY IS A DEPLOY-TIME SETTING, NOT A SECRET THIS CONSOLE
 * WRITES. `GITHUB_REPO_OWNER` and `GITHUB_REPO_NAME` are plain `[vars]` in
 * wrangler.toml, in both tables, and every deploy writes them back over the
 * Worker's settings. The Save used to push both as Worker secrets on every
 * click, pre-filled from display defaults, so an admin could "change" the
 * repository and the next deploy would silently restore AxalNetwork/StudioOS
 * (the D171 finding). The same two values aim the branch-deploy dispatch
 * (`services/githubSync.ts`) and are copied to every branch
 * (`scripts/branchConfig.mjs`). So PUT now refuses a body whose owner or name
 * differs from the deployed value, with a sentence saying where they are set,
 * and DELETE no longer deletes either name. Changing the repository means
 * changing wrangler.toml and deploying.
 *
 * GitHub credentials differ from the OAuth id/secret pairs handled by
 * admin_integration_keys.ts (single token + repo + webhook secret), so this
 * is a dedicated route that reuses the same Cloudflare secret-promotion
 * helpers (`setSecret`/`deleteSecret`).
 *
 * D223 — WHO MAY WRITE. PUT and DELETE write Worker secrets (two since D270)
 * onto production's own `studioos` script. `GITHUB_ACCESS_TOKEN` is not only the
 * ticket mirror's credential: it is the token that dispatches a branch deploy
 * (`POST /api/admin/licences/:uid/deploy`, `requireSuperAdminWriteBar`). So
 * whoever could overwrite it could aim that dispatch at a token of their own
 * choosing, and before D223 that was every admin. Both writes now take the
 * same bar as the dispatch, and each is audited once through
 * `logAdminAction` (D159) — the secret NAMES, never a value.
 *
 * THE READS STAY `requireAdmin`. `GET /` answers booleans, the repository it
 * names and the webhook URL; `POST /test` exercises the token and changes no
 * secret (its write probe opens one fixed-text issue and closes it). Support
 * staff need both to tell a broken mirror from a working one.
 *
 * AND `GET /` NO LONGER CARRIES `token_preview`. It was `maskClientId` of the
 * token — eight characters of a whole credential. That mask was written for
 * OAuth client ids, which are the public half of a pair; a token has no public
 * half. `has_token` is all the console needs, and D213's Platform payload
 * already refuses the name.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireSuperAdminWriteBar } from '../auth';
import { setSecret, deleteSecret } from '../services/cloudflareSecrets';
import { logAdminAction } from '../services/adminAudit';
import { refusalBody } from '../util/refusal';

const r = new Hono<{ Bindings: Env }>();

/** Where the repository is set, in the words a refusal and the panel both use. */
const REPO_IS_DEPLOY_TIME =
  'The repository is set at deploy time: GITHUB_REPO_OWNER and GITHUB_REPO_NAME are [vars] in '
  + 'wrangler.toml, and every deploy writes them back. Change them there and deploy.';

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
  return c.json({
    configured: hasToken && !!env.GITHUB_REPO_OWNER && !!env.GITHUB_REPO_NAME,
    source: hasToken ? 'env' : 'unconfigured',
    has_token: hasToken,
    // D270 — what the running Worker has, or null. No display default: the
    // sync reads these with no fallback, so a default here would name a
    // repository nothing writes to.
    repo_owner: env.GITHUB_REPO_OWNER || null,
    repo_name: env.GITHUB_REPO_NAME || null,
    repo_set_at: 'deploy',
    repo_note: REPO_IS_DEPLOY_TIME,
    has_webhook_secret: !!env.GITHUB_WEBHOOK_SECRET,
    webhook_url: webhookUrl(c),
  });
});

r.put('/', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  let body: { token?: string; repo_owner?: string; repo_name?: string; webhook_secret?: string; generate_webhook_secret?: boolean } = {};
  try { body = await c.req.json(); } catch { /* empty */ }

  // D270 — the repository is not written here. A body that names a different
  // owner or name is refused before anything is pushed; one that repeats the
  // deployed values (an older panel sends both on every Save) is accepted and
  // they are ignored.
  const differs = (sent: unknown, deployed: string | undefined) =>
    typeof sent === 'string' && sent.trim() !== '' && sent.trim() !== (deployed ?? '');
  if (differs(body.repo_owner, c.env.GITHUB_REPO_OWNER) || differs(body.repo_name, c.env.GITHUB_REPO_NAME)) {
    return c.json({ error: 'repo_is_deploy_time', message: REPO_IS_DEPLOY_TIME }, 400);
  }

  const pushes: Array<{ name: string; value: string }> = [];
  if (typeof body.token === 'string' && body.token.trim()) {
    if (body.token.trim().length > 4096) return c.json({ error: 'value_too_long' }, 400);
    pushes.push({ name: 'GITHUB_ACCESS_TOKEN', value: body.token.trim() });
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

  // ONE AUDIT ROW PER REQUEST, naming the secrets and never their values. A
  // push that fails part-way records what had already landed, because the
  // pushes are not a transaction and the ones before the failure are live.
  const names = pushes.map((p) => p.name);
  const pushed: string[] = [];
  for (const p of pushes) {
    const res = await setSecret(c.env, p.name, p.value);
    if (!res.ok) {
      await logAdminAction(c.env, admin.id, admin.email, 'github_sync_secrets_set', {
        secrets: names, pushed, failed_secret: p.name, outcome: 'failed',
        cf_status: res.status ?? null, cf_code: res.code ?? null,
      });
      const httpStatus = res.code === 'cloudflare_api_token_missing' ? 503 : 502;
      return c.json(refusalBody({ code: res.code || 'cf_api_failed', message: 'Cloudflare did not accept the secret change. The upstream field says why.', raw: res.error || null, audience: 'admin', extra: { failed_secret: p.name } }), httpStatus);
    }
    pushed.push(p.name);
  }
  await logAdminAction(c.env, admin.id, admin.email, 'github_sync_secrets_set', {
    secrets: names, pushed, outcome: 'ok', generated_webhook_secret: !!generatedSecret,
  });

  const resp: Record<string, unknown> = { ok: true };
  if (generatedSecret) resp.webhook_secret = generatedSecret;
  return c.json(resp);
});

/**
 * WHY THIS ROUTE REPORTS THREE VERDICTS AND NOT ONE "Connected".
 *
 * It used to make a single call — `GET /repos/{owner}/{repo}` — and answer
 * `ok: true, "Connected to <repo>."` on a 200. **A fine-grained PAT carries
 * Metadata: Read automatically and that permission cannot be removed**, so
 * that probe returned 200 for a token with no Issues access whatsoever. The
 * panel went green, the badge read "Connected", and `POST /issues` went on
 * 403-ing forever. The panel's own copy said "Needs Issues: Read and write"
 * and nothing checked it.
 *
 * Measured against production D1 after the fix shipped: the mirror worked
 * on 16-17 April 2026 (two tickets became issues #3 and #4, one second
 * apart from their rows) and has failed on EVERY ticket since 5 July --
 * seven in a row over five months, while the panel reported a healthy
 * connection throughout. A working window that closed is what a credential
 * expiring looks like, and it is precisely what the metadata probe could
 * not see. A check that cannot fail on the bug it exists for is decoration.
 *
 * So each capability is now named and reported separately:
 *
 *   reachable        GET /repos/{o}/{r}        — Metadata: Read. Proves the
 *                                                repo exists and the token
 *                                                can see it. NOTHING MORE.
 *   issues_readable  GET /repos/{o}/{r}/issues — the Issues permission was
 *                                                granted at all, rather than
 *                                                the token being metadata-only.
 *   can_write        only a real create proves it — see below.
 *
 * ON `can_write` AND WHY IT IS 'unproven' BY DEFAULT. A cheap probe was
 * considered and rejected on measurement: POSTing a deliberately invalid
 * issue body and treating 422 as "authorised, payload merely bad". That
 * requires GitHub to evaluate authorisation BEFORE payload validation, and
 * that ordering could not be confirmed. Shipping it would have re-created
 * the exact defect above — a check that passes regardless. So the default
 * says plainly that write is unproven, and `{ write: true }` runs the only
 * thing that settles it: create a real issue and immediately close it.
 */
r.post('/test', async (c) => {
  await requireAdmin(c);
  const env = c.env;
  if (!env.GITHUB_ACCESS_TOKEN || !env.GITHUB_REPO_OWNER || !env.GITHUB_REPO_NAME) {
    return c.json({
      ok: false, reachable: false, issues_readable: false, can_write: false, http_status: null,
      detail: 'GitHub is not fully configured (token, owner, repo required).',
    });
  }
  const repoFull = `${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}`;
  const gh = (path: string, init: RequestInit = {}) => fetch(`https://api.github.com/repos/${repoFull}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_ACCESS_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'StudioOS-Worker',
      ...(init.headers || {}),
    },
  });

  let resp: Response;
  try {
    resp = await gh('');
  } catch (e: any) {
    return c.json({
      ok: false, reachable: false, issues_readable: false, can_write: false, http_status: null,
      detail: `Network error: ${String(e?.message || e).slice(0, 200)}`,
    });
  }
  if (resp.status !== 200) {
    const detail = resp.status === 404
      ? `Repo ${repoFull} not found, or the token lacks access to it.`
      : (resp.status === 401 || resp.status === 403)
        ? 'GitHub rejected the token.'
        : `GitHub returned HTTP ${resp.status}.`;
    return c.json({ ok: false, reachable: false, issues_readable: false, can_write: false, http_status: resp.status, detail });
  }

  // Issues: Read. A fine-grained token cannot hold write without read, so a
  // failure here is conclusive — no write either — while a pass still does
  // not establish write.
  let issuesReadable = false;
  let issuesStatus: number | null = null;
  try {
    const ir = await gh('/issues?per_page=1');
    issuesStatus = ir.status;
    issuesReadable = ir.status === 200;
  } catch { /* leave false */ }

  let wantWrite = false;
  try { wantWrite = !!(await c.req.json())?.write; } catch { /* no body: reads only */ }

  if (!wantWrite) {
    return c.json({
      ok: issuesReadable,
      reachable: true,
      issues_readable: issuesReadable,
      issues_http_status: issuesStatus,
      can_write: 'unproven',
      http_status: 200,
      repo: repoFull,
      detail: issuesReadable
        ? `Reached ${repoFull} and can read its issues. This does NOT prove the token can CREATE one — run the write test to settle that.`
        : `Reached ${repoFull}, but could not read its issues (HTTP ${issuesStatus}). The token is missing the Issues permission, so the ticket mirror cannot work.`,
    });
  }

  // THE ONLY CHECK THAT SETTLES IT. Creates a real issue and closes it, so
  // the capability is exercised exactly as `createIssue` exercises it.
  let created: any = null;
  try {
    const cr = await gh('/issues', {
      method: 'POST',
      body: JSON.stringify({
        title: 'StudioOS connection test',
        body: 'Opened by the StudioOS admin GitHub Sync write test, and closed immediately. Safe to ignore.',
      }),
    });
    const data: any = await cr.json().catch(() => null);
    if (!cr.ok) {
      const detail = cr.status === 403
        ? 'The token reached the repo but may not create issues — it needs Issues: Read and write.'
        : cr.status === 410
          ? 'Issues are disabled on this repository, so nothing can be mirrored to it.'
          : `GitHub refused the create with HTTP ${cr.status}: ${data?.message || 'no message'}.`;
      return c.json({
        ok: false, reachable: true, issues_readable: issuesReadable, can_write: false,
        http_status: cr.status, repo: repoFull, detail,
      });
    }
    created = data;
  } catch (e: any) {
    return c.json({
      ok: false, reachable: true, issues_readable: issuesReadable, can_write: false, http_status: null,
      detail: `Network error during the write test: ${String(e?.message || e).slice(0, 200)}`,
    });
  }

  // Best-effort close. The write is already proven by this point, so a
  // failure to close is reported beside the pass rather than turning it into
  // a failure — leaving the issue open is untidy, not wrong.
  let closed = false;
  try {
    const cl = await gh(`/issues/${created.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
    closed = cl.ok;
  } catch { /* reported below */ }

  return c.json({
    ok: true,
    reachable: true,
    issues_readable: issuesReadable,
    can_write: true,
    http_status: 201,
    repo: repoFull,
    test_issue_number: created.number,
    test_issue_closed: closed,
    detail: `Created and ${closed ? 'closed' : 'COULD NOT CLOSE'} issue #${created.number} on ${repoFull}. The ticket mirror has everything it needs.${closed ? '' : ' Close it by hand.'}`,
  });
});

r.delete('/', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  // D270 — the token and the webhook secret only. The repository is a
  // wrangler.toml var, so deleting it as a secret removed nothing the next
  // deploy would not restore. A secret of either name left by the old Save is
  // a stale leftover; see D270 for the one-time clean-up.
  const names = ['GITHUB_ACCESS_TOKEN', 'GITHUB_WEBHOOK_SECRET'];
  // A missing Cloudflare API token skips every delete; the audit says so
  // rather than recording a removal that did not happen.
  let tokenMissing = false;
  for (const name of names) {
    const res = await deleteSecret(c.env, name);
    if (res.code === 'cloudflare_api_token_missing') tokenMissing = true;
    if (!res.ok && res.code !== 'cloudflare_api_token_missing') {
      await logAdminAction(c.env, admin.id, admin.email, 'github_sync_secrets_delete', {
        secrets: names, failed_secret: name, outcome: 'failed',
        cf_status: res.status ?? null, cf_code: res.code ?? null,
      });
      return c.json(refusalBody({ code: res.code || 'cf_api_failed', message: 'Cloudflare did not accept the secret change. The upstream field says why.', raw: res.error || null, audience: 'admin', extra: { failed_secret: name } }), 502);
    }
  }
  await logAdminAction(c.env, admin.id, admin.email, 'github_sync_secrets_delete', {
    secrets: names, outcome: tokenMissing ? 'failed' : 'ok', cf_code: tokenMissing ? 'cloudflare_api_token_missing' : null,
  });
  return c.json({ ok: true, cf_token_missing: tokenMissing });
});

export default r;
