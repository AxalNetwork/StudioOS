# Claude Code setup (API-key auth)

This repo uses [Anthropic Claude Code](https://docs.anthropic.com/en/docs/claude-code)
with **API-key authentication**, not the Claude.ai subscription path.
The Anthropic org tied to this account has subscription access to
Claude Code disabled, which produces the error:

> Your organization has disabled Claude subscription access for Claude
> Code · Use an Anthropic API key instead, or ask your admin to enable
> access.

The fix is to always run Claude Code with an `ANTHROPIC_API_KEY`
environment variable. Usage is then billed against your Anthropic API
account, **not** the Claude.ai subscription. Add credit / monitor spend
at [console.anthropic.com → Billing](https://console.anthropic.com/settings/billing).

---

## 1. Replit setup

1. Open the **Secrets** pane (lock icon in the left sidebar).
2. Add a new secret:
   - **Key**: `ANTHROPIC_API_KEY`
   - **Value**: the key from
     [console.anthropic.com → API Keys](https://console.anthropic.com/settings/keys)
     (starts with `sk-ant-…`).
3. Restart the workflow / open a fresh shell so the env var loads
   (Replit injects Secrets into new processes only).
4. Verify:
   ```bash
   bash scripts/check-anthropic-key.sh
   # → ANTHROPIC_API_KEY detected (length=108).
   ```
5. Install Claude Code (one-time, from a Replit shell):
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
6. Run it:
   ```bash
   claude        # interactive
   claude "summarize the cloudflare-worker routes"  # one-shot
   ```
   The CLI auto-reads `ANTHROPIC_API_KEY` from the environment — no
   `claude login`, no subscription flow.

---

## 2. GitHub Actions setup

1. **Add the repository secret**:
   - Go to **Repo → Settings → Secrets and variables → Actions → New repository secret**.
   - **Name**: `ANTHROPIC_API_KEY`
   - **Value**: paste the same key as above.
2. The workflow is already wired at
   [`.github/workflows/claude-code.yml`](../.github/workflows/claude-code.yml).
   It runs on:
   - `@claude` mentions in issue comments, PR comments, or PR reviews.
   - Manual `workflow_dispatch` (Actions tab → Claude Code → Run workflow).
3. The workflow gates every run on `scripts/check-anthropic-key.sh`, so
   if the secret is missing you get a clear error in the Actions log
   instead of an opaque 401 from the action.
4. (Optional, one-time) Install Anthropic's GitHub App so Claude Code
   can comment on PRs:
   ```
   From a local clone with Claude Code installed:
     /install-github-app
   ```
   This is the path called out in Anthropic's docs as "easiest" — the
   workflow file in this repo is the equivalent manual setup and is the
   recommended path if you'd rather not install the app.

---

## 3. Running Claude Code from the Replit shell

```bash
# Once-per-repl:
npm install -g @anthropic-ai/claude-code

# Verify auth wiring:
bash scripts/check-anthropic-key.sh

# Interactive session:
claude

# One-shot from CI / a script:
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" claude --print "list TODOs in cloudflare-worker/"
```

Convenience wrapper added in `package.json`:

```bash
npm run claude:check    # just the secret check
```

---

## 4. Diagnosing auth issues

| Symptom | Cause | Fix |
|---|---|---|
| `Your organization has disabled Claude subscription access` | Claude Code is trying subscription auth. | Set `ANTHROPIC_API_KEY` in the environment; the CLI prefers it over subscription auth. |
| `401 Unauthorized` from the action | Secret is wrong / revoked. | Rotate at console.anthropic.com, update the GitHub secret + Replit secret. |
| `ANTHROPIC_API_KEY is not set` from the bootstrap script | The env var isn't being injected. | Replit: re-open the shell after adding the secret. Actions: confirm secret name is exactly `ANTHROPIC_API_KEY` under repo (not org/environment-scoped). |
| Action says secret is `***` and still fails | Org-level secret scoping. | Ensure the secret is at **repo** scope, or that the calling workflow is allow-listed by the org. |
| Local CLI works but the Action fails | Action runs in a clean sandbox without your local env. | Confirm `ANTHROPIC_API_KEY` is added as a **repository secret**, not just a local `.env`. |

Never commit a `.env` containing real keys. `.gitignore` already excludes
`.env*`; if you accidentally commit one, rotate the key immediately at
console.anthropic.com.

---

## 5. Billing note

API-key usage is billed via the Anthropic API (pay-per-token, console
billing), **not** the Claude.ai subscription. Set spend limits at
[console.anthropic.com → Limits](https://console.anthropic.com/settings/limits)
to cap monthly cost. The default Claude Code model is `claude-sonnet-*`;
override per-call with `--model` if needed.
