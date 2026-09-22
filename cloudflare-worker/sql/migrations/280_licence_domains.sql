-- 280 — a licence records the host its admin bound, and who may detach it
-- (D197, S17–S19 + H31–H34).
--
-- WHAT WAS BROKEN. `AdminLicences.jsx:1333` renders `d.custom_domain`.
-- `custom_domain` exists NOWHERE — measured across `cloudflare-worker/src`
-- and every file under `sql/`, zero hits — so the domain strip has rendered
-- "Not recorded" unconditionally for every licence that has ever existed.
-- Same shape as migration 279's `kind` one block over: a control shipped
-- against a column nobody wrote.
--
-- THE HOST IS HQ'S ROW EVEN THOUGH THE TENANT WRITES IT, and the reason is
-- the UNIQUE index below. H33's rule is "One host, one licence", and a branch
-- is its own Worker over its own D1 (D.2) — it structurally cannot see what
-- another tenant bound, so it cannot enforce uniqueness and cannot produce
-- the collision refusal that names the other operator. HQ can. The branch
-- reaches this table the way it already reaches `hq_escalations`: over the
-- authenticated branch→HQ leg, never by holding its own copy.
--
-- WHAT THIS TABLE DOES *NOT* CLAIM. `state` stops at `verified`. Making a
-- host actually serve a tenant needs a Cloudflare for SaaS custom hostname on
-- the `os.axal.vc` zone, and there is zero groundwork for it in this
-- repository — no `custom_hostname`, no SaaS call anywhere — plus a
-- Cloudflare token nobody has set. So there is deliberately no 'active'
-- value: a column that could hold a state nothing can reach is a claim
-- waiting to be made falsely. S17's own sentence is what makes the gap
-- harmless — **a licence never waits on DNS**; members stay on the fallback
-- host the deploy issued, and that host is `licence_deployments.hostname`.
--
-- `hostname` IS UNIQUE ACROSS THE WHOLE TABLE, INCLUDING DETACHED ROWS, and
-- that is deliberate rather than an oversight. A detached host is one HQ took
-- away for a collision or abuse; letting the next licence claim it
-- immediately would re-create the collision the detach resolved. Releasing a
-- host is therefore a deletion, which is an explicit act, not a side effect
-- of detaching.
--
-- ONE ROW PER LICENCE. H31's strip has one Custom host column and S18 says
-- "One host per field in this pass. Wildcards come later; add a second row
-- then." `licence_id UNIQUE` is that "this pass" written down, so a second
-- host is a migration rather than an accident.
--
-- NO `licence_events` VALUE IS ADDED, and avoiding one is worth stating.
-- SQLite cannot ALTER a CHECK, so migration 266 had to REBUILD
-- `licence_events` to admit a single new event. Nothing here needs that: a
-- detach is an HQ admin act and belongs in `admin_audit_log` through
-- `logAdminAction` (D159), which has no CHECK, and the tenant's own bind and
-- verification live in this row's own timestamps.
--
-- No BEGIN/COMMIT: D1 rejects transaction control in a migration file (#26).

CREATE TABLE IF NOT EXISTS licence_domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- One host per licence in this pass; see the header.
  licence_id INTEGER NOT NULL UNIQUE REFERENCES territory_licences(id) ON DELETE CASCADE,
  -- Lowercased at the boundary by `normaliseHostname`. UNIQUE is the
  -- "one host, one licence" rule made structural rather than a check in a
  -- handler that a second writer could forget.
  hostname TEXT NOT NULL UNIQUE,
  -- The value the tenant publishes as `axal-verify=<token>` in the TXT
  -- record. Minted once per hostname, so replacing the host mints a new one
  -- and an old published record cannot verify a new claim.
  challenge_token TEXT NOT NULL,
  -- `pending`  — added, records not both confirmed
  -- `verified` — both records confirmed by a resolver; as far as this
  --              migration can honestly go (see the header)
  -- `detached` — HQ took it away; `detach_reason` is what the admin reads
  state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'verified', 'detached')),
  -- Per record, because S19a names WHICH row is wrong rather than saying
  -- "DNS error" to somebody standing in a registrar panel.
  txt_verified_at TEXT,
  cname_verified_at TEXT,
  last_checked_at TEXT,
  -- The verdict the last check produced, as JSON, so the screen can reprint
  -- the failure sentences without re-querying a resolver on every render.
  last_check_json TEXT,
  -- Which host members are sent to. Stays 0 until a host can actually serve,
  -- which this migration cannot reach — so nothing writes 1 yet and the
  -- column exists to be written by whatever closes that gap.
  is_primary INTEGER NOT NULL DEFAULT 0,
  detached_at TEXT,
  detached_by_user_id INTEGER,
  detach_reason TEXT,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The collision lookup: "who already holds this host" is the one query H33's
-- refusal needs, and it must be fast on the write path.
CREATE INDEX IF NOT EXISTS idx_licence_domains_host ON licence_domains(hostname);
CREATE INDEX IF NOT EXISTS idx_licence_domains_state ON licence_domains(state, updated_at);
