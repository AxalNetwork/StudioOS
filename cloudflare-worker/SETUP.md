# StudioOS — Cloudflare Worker Deployment Guide

Complete step-by-step instructions to deploy the Axal VC StudioOS API on Cloudflare Workers.

---

## Prerequisites

- Node.js 18+ and npm installed
- A Cloudflare account (free tier works)
- A PostgreSQL database (Neon, Supabase, or any external Postgres)
- A Resend account for transactional email (https://resend.com)

---

## Step 1: Install Wrangler CLI

```bash
npm install -g wrangler
wrangler login
```

---

## Step 2: Install Worker Dependencies

```bash
cd cloudflare-worker
npm install
```

---

## Step 3: Create KV Namespaces

```bash
npx wrangler kv:namespace create "TOKENS"
npx wrangler kv:namespace create "RATE_LIMITS"
```

Copy the returned IDs and paste them into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "TOKENS"
id = "<paste TOKENS ID here>"

[[kv_namespaces]]
binding = "RATE_LIMITS"
id = "<paste RATE_LIMITS ID here>"
```

---

## Step 4: Create Hyperdrive (PostgreSQL Connection)

You need an external PostgreSQL database. Get your connection string from Neon, Supabase, etc.

```bash
npx wrangler hyperdrive create studioos-db \
  --connection-string="postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require"
```

Copy the returned Hyperdrive ID and paste into `wrangler.toml`:

```toml
[[hyperdrive]]
binding = "DB"
id = "<paste Hyperdrive ID here>"
```

---

## Step 5: Initialize the Database Schema

Connect to your PostgreSQL database and run the schema:

```bash
psql "postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require" -f sql/schema.sql
```

Or use your database provider's SQL console to execute the contents of `sql/schema.sql`.

---

## Step 6: Set Secrets

```bash
npx wrangler secret put JWT_SECRET
# Paste a strong random string (e.g., openssl rand -hex 32)

npx wrangler secret put RESEND_API_KEY
# Paste your Resend API key (from https://resend.com/api-keys)
```

Optional secrets:

```bash
npx wrangler secret put OPENAI_API_KEY
# Only needed if you want AI-powered advisory responses

npx wrangler secret put GITHUB_ACCESS_TOKEN
# Only needed for GitHub ticket sync
```

---

## Step 7: Configure Environment Variables

Edit the `[vars]` section in `wrangler.toml`:

```toml
[vars]
APP_URL = "https://your-worker-subdomain.your-account.workers.dev"
GITHUB_REPO_OWNER = "YourOrg"
GITHUB_REPO_NAME = "YourRepo"
```

After first deploy, update `APP_URL` to your actual worker URL or custom domain.

---

## Step 8: Deploy

```bash
npx wrangler deploy
```

Your API is now live at: `https://studioos-api.<your-subdomain>.workers.dev`

---

## Step 9: Configure Resend Domain (for production email)

1. Go to https://resend.com/domains
2. Add your domain (e.g., `axal.vc`)
3. Add the DNS records Resend provides (SPF, DKIM, DMARC)
4. Update the `from` address in `src/services/email.ts` if needed

---

## Step 10: (Optional) Custom Domain

```bash
npx wrangler domains add api.axal.vc
```

Or configure via Cloudflare Dashboard → Workers → your worker → Settings → Domains & Routes.

---

## API Endpoints Reference

All endpoints are prefixed with `/api`.

### Auth (`/api/auth`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | No | Register new user (sends verification email) |
| POST | `/resend-verification` | No | Resend verification email |
| GET | `/verify-email?token=` | No | Validate email verification token |
| POST | `/confirm-verify-email` | No | Confirm email & get setup token |
| POST | `/setup-totp` | No | Set up TOTP authenticator |
| POST | `/login` | No | Login with email + TOTP code |
| GET | `/me` | Yes | Get current user |

### Scoring (`/api/scoring`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/score` | Yes | Score a startup (100-pt engine) |
| POST | `/score/:projectId/deal-memo` | Yes | Generate deal memo |
| GET | `/scores/:projectId` | Yes | Get score history |
| GET | `/deal-memos/:projectId` | Yes | Get deal memos |
| GET | `/queue` | Yes | Get scoring queue |

### Projects (`/api/projects`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Yes | List projects |
| POST | `/` | Yes | Create project |
| POST | `/submit` | Yes | Submit + auto-score |
| GET | `/:id` | Yes | Get project |
| PUT | `/:id` | Yes | Update project |
| DELETE | `/:id` | Yes | Delete project |
| POST | `/:id/advance-week` | Yes | Advance playbook week |

### Legal (`/api/legal`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/templates` | Yes | List all 18 legal templates |
| GET | `/templates/:key` | Yes | Get specific template |
| POST | `/templates/:key/generate` | Yes | Generate document from template |
| GET/POST | `/documents` | Yes | List/create documents |
| PUT | `/documents/:id/sign` | Yes | Sign a document |
| GET/POST | `/entities` | Yes | List/create legal entities |

### Partners (`/api/partners`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST | `/` | Yes | List/create partners |
| GET | `/:id` | Yes | Get partner |
| GET | `/referral/:code` | Yes | Lookup referral |
| POST | `/referral/:code/use` | Yes | Track referral |
| GET | `/matchmaking/recommend` | Yes | Get partner recommendations |
| POST | `/matchPartners` | Yes | Run partner matching |

### Capital (`/api/capital`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST | `/investors` | Yes | List/create LP investors |
| GET | `/investors/:id` | Yes | Get investor + calls |
| GET/POST | `/calls` | Yes | List/create capital calls |
| POST | `/calls/:id/pay` | Yes | Mark call as paid |
| POST | `/capitalCall` | Yes | Issue capital call to all LPs |
| GET | `/portfolio` | Yes | Portfolio overview |

### Deals (`/api/deals`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST | `/` | Yes | List/create deals |
| GET | `/:id` | Yes | Get deal |
| PUT | `/:id` | Yes | Update deal |

### Tickets (`/api/tickets`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST | `/` | Yes | List/create tickets (+ GitHub sync) |
| GET | `/:id` | Yes | Get ticket |
| PUT | `/:id` | Yes | Update ticket status |

### Users (`/api/users`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Yes | List users |
| POST | `/` | Admin | Create user |
| GET | `/:id` | Yes | Get user |

### Admin (`/api/admin`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users` | Admin | List all users |
| POST | `/impersonate/:userId` | Admin | Impersonate user |
| PATCH | `/users/:userId/role` | Admin | Change user role |
| PATCH | `/users/:userId/toggle-active` | Admin | Toggle active status |

### Activity (`/api/activity`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Yes | List activity logs |
| GET | `/summary` | Yes | Activity summary |

### Market Intel (`/api/market-intel`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/market-pulse` | No | Market pulse signals |
| GET | `/macro` | No | Macro data |
| GET | `/private-rounds` | No | Recent private rounds |
| GET | `/studio-benchmarks` | No | Studio benchmarks |
| GET | `/competitive-intelligence` | No | High-conviction plays |

### Advisory (`/api/advisory`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/ask` | Yes | Ask advisory question |
| POST | `/financial-plan` | Yes | Generate financial plan |
| POST | `/diligence` | Yes | Run diligence check |

### Private Data (`/api/private-data`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/profile` | Yes | User profile with linked entities |
| GET | `/market/private-signals` | Admin/Partner | Private market signals |
| GET | `/portfolio/metrics` | Yes | Role-based portfolio metrics |
| GET | `/founder/:userId` | Yes | Founder-specific data |

### Other
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Health check |
| GET | `/api/dashboard/stats` | Yes | Dashboard statistics |

---

## Architecture

```
Cloudflare Workers (Edge)
├── Hono (Router + Middleware)
├── JWT Auth (jose)
├── TOTP 2FA (otpauth)
├── Resend (Email)
├── KV: TOKENS (verification tokens)
├── KV: RATE_LIMITS (login/resend throttling)
└── Hyperdrive → PostgreSQL (Neon/Supabase)
```

---

## Troubleshooting

- **"Too many subrequests"**: Cloudflare Workers have a 50-subrequest limit per request. The SQL driver uses one subrequest per query. Complex endpoints may hit this — optimize by combining queries.
- **KV eventually consistent**: KV writes may take up to 60 seconds to propagate globally. Rate limiting is best-effort.
- **Hyperdrive cold starts**: First request after idle may be slower. Hyperdrive connection pooling handles this automatically.
- **Resend "from" address**: Must match a verified domain in Resend. Use `onboarding@resend.dev` for testing.
