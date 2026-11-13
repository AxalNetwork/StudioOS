-- 259 — a branch pushes an item UP to HQ, and gets an answer back (D108).
--
-- THE CONCEPT DID NOT EXIST. `admin_hq.ts` says so in the payload it serves
-- today: "No escalation exists on the platform: a subsidiary cannot push a
-- ticket up to HQ, so there is nothing to list." Both canvases assume it —
-- H1 draws "Escalations awaiting HQ" with ages, S3 draws a "To HQ" lane
-- beside the four local queues — and neither can be built until a row exists
-- for the thing being escalated.
--
-- THE ROW LIVES AT HQ, WRITTEN OVER RPC BY THE BRANCH. It is the one store
-- in this programme that is deliberately NOT a per-branch table: the whole
-- point is that HQ sees every branch's queue on one screen, and a copy pushed
-- the other way would make "awaiting HQ" a number each branch computed about
-- itself. `branch_code` is stamped by `BranchEntrypoint` from the CALLER's own
-- `BRANCH_CODE`, not from the request body, because a binding does not tell
-- the callee who called it (D.7) and a body-supplied code would let any branch
-- file under another's name.
--
-- `kind` IS NOT A TICKET TYPE. The four values are the four things the
-- subsidiary canvas says a branch cannot decide for itself: moderation it
-- wants HQ to take, content it needs brand approval for, a seat increase
-- (seats are HQ's to grant — "a request to make, not a number to change"),
-- and other. A fifth value is a product decision, not a column change.
--
-- `subject_ref` IS FREE TEXT ON PURPOSE. The item being escalated lives in
-- the BRANCH's database — an LP application id, a spinout user id, a draft
-- article — and HQ has no row to point at. A foreign key here would be a
-- reference into a database this one cannot read. The branch sends a label a
-- person can act on and, where it helps, a deep link into its own host.
--
-- SLA IS STORED AS THE DUE DATE, NOT AS A BAND. "<24h / <72h / >=72h" is how
-- S3 displays age; storing the band would freeze it at write time and it
-- would be wrong an hour later. The due date is the fact; the band is derived
-- on read, the same way `okr_column_moves` stores the Monday and derives the
-- window.

CREATE TABLE IF NOT EXISTS hq_escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  branch_code TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  subject_ref TEXT,
  detail TEXT,
  -- The branch-side person who raised it, as a display name and id IN THE
  -- BRANCH's user space. Never joined to HQ's `users`: the id spaces collide
  -- by construction (D104), so treating it as an HQ id would name the wrong
  -- person with complete confidence.
  raised_by_name TEXT,
  raised_by_branch_user_id INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  due_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- The answer, and who at HQ gave it. `answered_by_user_id` IS an HQ id and
  -- is safe to join, which is why the two ids are named differently rather
  -- than sharing an `actor` column that means different things per row.
  answer TEXT,
  answered_by_user_id INTEGER,
  answered_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hq_escalations_status ON hq_escalations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hq_escalations_branch ON hq_escalations(branch_code, status);
CREATE INDEX IF NOT EXISTS idx_hq_escalations_kind ON hq_escalations(kind, status);
