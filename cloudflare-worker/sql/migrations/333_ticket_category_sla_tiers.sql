-- 333 — a ticket's category is one of eight, and HQ's ticket SLA hours are a
-- store HQ edits (D482, #1022).
--
-- THE CATEGORY. `Support Security · Super.dc.html` (canvas Y1) draws a fixed
-- taxonomy of eight: Fund administration, Contracts, Access & permissions,
-- Licence & seats, Billing, Data & reporting, Onboarding, Other. Its note:
-- free-text categories make a support taxonomy unreadable within a quarter,
-- and the per-tenant read depends on these being comparable. The column holds
-- the slug; `services/ticketCategories.ts` holds the labels. NULL means no
-- category was recorded (every ticket filed before this migration, and a
-- ticket filed without one); the page counts those apart, never as Other.
--
-- THE SLA TIERS. HQ's P1/P2/P3 hours were constants in
-- `services/supportSlaPolicy.ts` (24 / 48 / 96, settled by D459). They become
-- rows HQ edits at /api/admin/hq-support/sla-tiers, each change audited
-- through `logAdminAction`. The seed is today's constants, so nothing bands
-- differently the day this applies. The escalation kinds' hours
-- (`rpc/hqOps.ts` SLA_HOURS) stay in code: they stamp `due_at` when a branch
-- raises one, which is a second promise this store does not hold.
--
-- No runtime statement creates either object: `services/githubSync.ts`'s
-- runtime ALTERs on `tickets` are left as they are (owner call A on #1022),
-- and every database the repo builds runs this file.
--
-- Apply with the ledger-driven runner (NOT a raw `wrangler d1 execute`):
--   npm run d1:migrate:remote      # === node scripts/migrate-d1.mjs --remote

ALTER TABLE tickets ADD COLUMN category TEXT CHECK (category IS NULL OR category IN (
  'fund_administration', 'contracts', 'access_permissions', 'licence_seats',
  'billing', 'data_reporting', 'onboarding', 'other'
));

CREATE INDEX IF NOT EXISTS idx_tickets_category ON tickets(category);

CREATE TABLE IF NOT EXISTS hq_support_sla_tiers (
  tier        TEXT PRIMARY KEY CHECK (tier IN ('P1', 'P2', 'P3')),
  hours       INTEGER NOT NULL CHECK (hours BETWEEN 1 AND 720),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 200),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  INTEGER REFERENCES users(id)
);

INSERT OR IGNORE INTO hq_support_sla_tiers (tier, hours, description) VALUES
  ('P1', 24, 'Money, access, or data at risk'),
  ('P2', 48, 'A workflow is blocked, a workaround exists'),
  ('P3', 96, 'Wrong, but nobody is stopped');
