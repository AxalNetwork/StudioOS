-- 261 — the branch's own copy of what it escalated, and what HQ answered (D112).
--
-- WHY A SECOND TABLE FOR ONE FACT. `hq_escalations` (migration 259) is the
-- ledger, and it lives at HQ deliberately: the whole point is that HQ sees
-- every branch's queue on one screen. But a branch is its own Worker over its
-- own database (D.2), so it cannot read that ledger at all — and S3's To-HQ
-- lane is a list of the branch's OWN escalations, on the branch's own screen.
-- Without a local row, that lane would either be blank or would have to reach
-- across the binding on every render, which is exactly the "screen that goes
-- blank when the binding is slow" that migration 256 exists to avoid.
--
-- SO THE FLOW IS: the branch writes here AND calls `HQ.escalate`, HQ writes its
-- ledger row and returns the uid, and the branch stores that uid so the two
-- rows are the same escalation. When HQ later answers, it pushes the answer
-- back and this row carries it. The branch never invents a uid: HQ's is
-- authoritative, because HQ's row is the one an operator acts on.
--
-- `hq_uid` IS NULLABLE, AND THAT IS THE HONEST STATE RATHER THAN A FAILURE.
-- The binding can be slow or absent — a branch deployed before HQ redeployed
-- with its `BRANCH_<CODE>` entry has no link at all. A raise that could not
-- reach HQ is still a thing the person did, and losing it because the transport
-- was down would be worse than showing it as not-yet-delivered. The lane
-- renders those as "not delivered to HQ", with the reason, and they are
-- retryable. A row with no `hq_uid` is NOT an escalation HQ has; nothing may
-- count it as one.
--
-- THE ANSWER IS ONE DECISION, NOT A THREAD, and the screen must say so. The
-- canvas draws "the answer coming back as a thread with HQ's decision and who
-- made it"; what exists is a single `answer` with an author and a time, which
-- is the decision half and not the conversation half. A second table of
-- messages is a real feature and is not this one — dressing one column as a
-- thread would promise a reply box that writes nowhere.
--
-- `answered_by_name` IS A NAME, NOT AN ID. HQ's user ids and this database's
-- user ids collide by construction (D104), so an HQ id stored here could be
-- joined to a local `users` row and name the wrong person with complete
-- confidence. The push carries the display name HQ resolved; there is nothing
-- to join and nothing that can be mis-joined.

CREATE TABLE IF NOT EXISTS branch_escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- HQ's uid for the same escalation. NULL until the raise reaches HQ.
  hq_uid TEXT UNIQUE,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  subject_ref TEXT,
  detail TEXT,
  -- The local person who raised it. These ARE this database's ids, so they are
  -- safe to join here — the opposite of `answered_by_name` below.
  raised_by_user_id INTEGER,
  raised_by_name TEXT,
  --   open      — with HQ, no answer yet
  --   answered  — HQ decided; `answer` and `answered_at` are set
  --   undelivered — the raise did not reach HQ; `hq_uid` is NULL and
  --                 `delivery_error` says why. Retryable.
  status TEXT NOT NULL DEFAULT 'open'
         CHECK (status IN ('open', 'answered', 'undelivered')),
  delivery_error TEXT,
  -- Copied from HQ's row so the branch can draw the same SLA band without a
  -- second definition of it. Derived on read, never stored as a band (259).
  due_at TEXT,
  answer TEXT,
  answered_by_name TEXT,
  answered_at TEXT,
  -- When HQ asserted the answer, carried across in the push — not when this
  -- database wrote it. Same rule as migration 256's `pushed_at`.
  pushed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_branch_escalations_status
  ON branch_escalations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_branch_escalations_kind
  ON branch_escalations(kind, status);
