# MCP API keys: switch on, check, roll back, revoke, read usage (D850)

The owner's runbook for member API keys on `https://axal.vc/mcp` (#2463's
backend phase). The plan is
[`architecture/MCP_API_PLATFORM.md`](../architecture/MCP_API_PLATFORM.md);
its §3 holds the contracts this file checks against. MCP itself (OAuth, the
server, `OAUTH_KV`) has its own switch-off in
[`architecture/PRODUCTION.md`](../architecture/PRODUCTION.md), "MCP
enablement". This file never names a secret value, and every production read
in it returns counts and sums, never a member's content.

**What is on `main` today (2026-10-22).** Keys and their management (D841,
#2464) are. `/mcp` accepting a key (D842, #2470), the usage rows (D843,
#2465), metering (D844, #2466) and the reports (D845, #2471) are not yet.
A step that needs one of them says so; do not switch keys on before #2470
is deployed, because until then a key can be created but used nowhere.

## 1. The flags

| Flag | Where | Off means |
| --- | --- | --- |
| `MCP_SERVER_ENABLED` | `wrangler.toml` `[vars]`, `[env.production.vars]` (on); `[env.preview.vars]` (off) | Every MCP and OAuth path is 404 (D681). Keys are useless without it. |
| `API_KEYS_ENABLED` | the same three blocks, `"false"` in all three (D841) | `/api/developer/keys` is 404 and `/mcp` refuses every `axk_` bearer. Stored keys are kept, not deleted. |

`API_KEYS_ENABLED` is read as on only when it is exactly `"true"`
(`apiKeysEnabled` in `cloudflare-worker/src/services/apiKeys.ts`). Preview
keeps it `"false"` whatever production says.

## 2. Switch keys on

**Before you start:** #2470, #2465 and #2466 are merged and deployed (the
deploy log of `.github/workflows/cloudflare-worker-deploy.yml` lists their
commits), and `cloudflare-worker/test/mcp_platform_e2e_d850.test.ts` runs
every step of the flow green on `main`.

1. **One PR to `main` that edits two lines** of `wrangler.toml`:
   `API_KEYS_ENABLED = "true"` in the top-level `[vars]` and in
   `[env.production.vars]`. `[env.preview.vars]` stays `"false"`. No test pins
   the value, so CI needs nothing else. The PR updates plan §8 with the date.
2. **Merge it.** The deploy workflow builds, applies pending D1 migrations,
   then deploys (`documentation/operations/DEPLOY.md`). Never switch on with a
   hand `wrangler deploy --var`: the next CI deploy would switch it back off.
3. **Run §3's checks** once the deploy finishes.

## 3. Check it, read-only

None of these writes anything.

1. **The routes answer.** Signed out, the key list asks for a session instead
   of hiding:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' https://axal.vc/api/developer/keys
   ```

   `401` means on. `404` means off.
2. **A malformed key is refused, and says nothing about real keys** (after
   #2470). The value below is a placeholder, not a key:

   ```sh
   curl -s -X POST https://axal.vc/mcp \
     -H 'Authorization: Bearer axk_000000000000_placeholder' \
     -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
   ```

   Expect `401` with the code `invalid_key` (plan §3). Ten of these from one
   address in a minute trip the per-address throttle; stop at two.
3. **Your own list.** Signed in as the owner, open `GET /api/developer/keys`
   from the browser (Account › Developer, when the Saturday UI ships). It
   answers `200` with `enabled: true`, `max_live_keys: 25` and
   `scopes_available`.
4. **The end-to-end check, on your own account.** Create a key with
   `validate:read` on one of your own ventures, point an MCP client at
   `https://axal.vc/mcp` with it, run `tools/list` and one read tool, read
   `/api/developer/usage` for today (one call, `ok`), then revoke the key and
   see the next call answer `401 revoked_key`. This writes your own key and
   usage rows only. Paste the secret into the client and nowhere else: not in
   an issue, a PR, a chat or a terminal history you share.
5. **The aggregates** in §6 show keys and calls moving.

## 4. Roll back: keys off

Switching off deletes nothing: keys, usage rows and holds stay. Every key is
refused at `/mcp` and every key route is 404 until the flag is back on
(`mcp_platform_e2e_d850.test.ts`, "rollback").

1. **Lasting: one PR to `main`** that sets both `"true"` lines back to
   `"false"`. Its merge deploys the Worker with keys off.
2. **Faster, while that PR waits,** follow PRODUCTION.md's MCP switch-off
   step 1 with `--var API_KEYS_ENABLED:false` in place of
   `--var MCP_SERVER_ENABLED:false`: disable the deploy workflow first, let
   any running or queued deploy finish, deploy `main`'s head from the root
   with `npm run deploy -- --var API_KEYS_ENABLED:false --var WORKER_DEPLOY_VERSION:$(git rev-parse HEAD)`,
   and re-enable the workflow only when the step-1 PR is ready to merge.
3. **Confirm** with §3 check 1: `404`.

**Switching back on revives every key that was live when it went off.** A
key revoked or expired in the meantime stays refused. If keys went off
because a key leaked, revoke it (§5) before switching back on.

## 5. Revoke a member's keys

- **The member, one key:** Account › Developer › Revoke, or
  `POST /api/developer/keys/:uid/revoke`. Immediate: every call reads the key
  from D1, with no cache. Logged as `api_key_revoked` with the key's uid only.
- **HQ, every key a member holds:** HQ's `POST /api/admin/security/force-reauth/:userId`
  (`routes/admin_security.ts`) raises the member's `jwt_min_iat`. Every key
  made before it is then refused as `revoked_key` (`verifyKey`), as every
  OAuth grant is, and the member's sessions end too. The same happens when the
  member signs out everywhere, or when their account is deactivated or has a
  deletion request.
  - **The list does not show it.** Those keys keep `revoked_at` NULL, so the
    member's key list still shows them as live although they are refused. Tell
    the member to revoke them and make new ones.
- **Last resort, the owner only:** a D1 write against production. Use it only
  when the two above cannot run, and record why on the incident issue:

  ```sh
  npx wrangler d1 execute studioos-db --remote --env production --command \
    "UPDATE member_api_keys SET revoked_at = datetime('now'), revoked_reason = 'revoked', updated_at = datetime('now')
     WHERE user_id = <USER_ID> AND revoked_at IS NULL"
  ```

  Replace `<USER_ID>` with the member's numeric id. It writes no
  `activity_logs` line; the incident issue is the record.

## 6. Read usage: aggregates only

From the repository root, with `npx wrangler d1 execute studioos-db --remote --env production --command "…"`.
Select counts and sums only. Never select `secret_sha256`, a key's `name`, an
`execution_id` or anything that names a member's work.

- **Keys.** Live, revoked and expired, with no member named:

  ```sql
  SELECT CASE WHEN revoked_at IS NOT NULL THEN 'revoked'
              WHEN expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now') THEN 'expired'
              ELSE 'live' END AS state,
         COUNT(*) AS keys, COUNT(DISTINCT user_id) AS members
  FROM member_api_keys GROUP BY state
  ```

- **Calls a day, by outcome** (after #2465 is deployed). `charged` is NULL
  when no call of the group was metered, never 0:

  ```sql
  SELECT date(created_at) AS day, surface, outcome, COUNT(*) AS calls,
         SUM(api_key_uid IS NOT NULL) AS by_key, SUM(charged_microusd) AS charged_microusd
  FROM api_usage_events WHERE created_at >= datetime('now', '-7 days')
  GROUP BY day, surface, outcome ORDER BY day
  ```

- **Why calls fail** (after #2465):

  ```sql
  SELECT error_category, COUNT(*) AS calls FROM api_usage_events
  WHERE outcome != 'ok' AND created_at >= datetime('now', '-1 day') GROUP BY error_category
  ```

- **Holds that did not finish** (after #2466). A `pending` hold past its
  `expires_at` is released when the member next takes a hold
  (`services/aiBudget.ts`), so a few are normal; `review` waits for HQ (D640):

  ```sql
  SELECT status, COUNT(*) AS holds FROM ai_budget_reservations
  WHERE idempotency_key LIKE 'exec:%' AND created_at >= datetime('now', '-1 day') GROUP BY status
  ```

A member's own detail is theirs to read, in `/api/developer/usage` (D845).
HQ reads totals here and nothing per member.

## 7. When something is wrong

| Symptom | First look |
| --- | --- |
| Check 1 answers `404` after switch-on | The deploy did not carry the flag: the deploy log's vars, then `wrangler.toml`. |
| Every key call answers `401 invalid_key` | #2470 not deployed, or `MCP_SERVER_ENABLED` off (then `/mcp` is 404, not 401). |
| `insufficient_tokens` for a member with tokens | `budget_review` or a pause (D844's refusal words); the holds query above. |
| A secret appears anywhere | Revoke that key (§5) at once, then remove the text where it appeared. Keys are not recoverable from storage: only the hash is kept. |
