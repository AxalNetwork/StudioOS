# Secret Setup

1. Go to the folder that contains `wrangler.toml`:
```bash
cd cloudflare-worker
```

2. Confirm the Worker name in `wrangler.toml`:
```toml
name = "studioos"
```

3. Add Gmail secrets for this Worker:
```bash
npx wrangler secret put GMAIL_CLIENT_ID
npx wrangler secret put GMAIL_CLIENT_SECRET
npx wrangler secret put GMAIL_REFRESH_TOKEN
```

4. If Wrangler cannot detect the project, pass the Worker name manually:
```bash
npx wrangler secret put GMAIL_CLIENT_ID --name studioos
npx wrangler secret put GMAIL_CLIENT_SECRET --name studioos
npx wrangler secret put GMAIL_REFRESH_TOKEN --name studioos
```

5. Verify the Worker sees them:
```bash
curl https://studioos.guillaumelauzier.workers.dev/api/health
```

You want:
```json
"gmail": true
```
