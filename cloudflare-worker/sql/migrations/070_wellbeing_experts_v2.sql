-- Task #4 (DI v2) — Wellbeing experts: paid bookings, services,
-- recurring availability, Stripe Connect onboarding, profile completion.
--
-- Additive only. CREATE TABLE IF NOT EXISTS. NEVER wrap in BEGIN/COMMIT
-- (D1 raw SQL rejects nested transactions). Column ALTERs for `experts`
-- and `expert_bookings` are NOT in this file — they're applied lazily by
-- ensureWellbeingSchema() in routes/wellbeing.ts using the
-- duplicate-column-swallow pattern (SQLite ALTER is not idempotent).

CREATE TABLE IF NOT EXISTS expert_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  expert_id INTEGER NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expert_services_expert
  ON expert_services(expert_id, is_active, sort_order);

CREATE TABLE IF NOT EXISTS expert_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  expert_id INTEGER NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  start_minute INTEGER NOT NULL,
  end_minute INTEGER NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expert_availability_expert
  ON expert_availability(expert_id, day_of_week);

CREATE INDEX IF NOT EXISTS idx_expert_bookings_expert_status
  ON expert_bookings(expert_id, status, scheduled_at);
