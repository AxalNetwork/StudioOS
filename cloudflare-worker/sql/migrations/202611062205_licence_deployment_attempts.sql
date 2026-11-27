-- D4706 (#4706) — a deployment is one thing; each try at provisioning it is another.
--
-- `licence_deployments` (migration 258) is the branch's IDENTITY: its code,
-- hostname and residency, one row per licence. Until now it was also the only
-- record of the ATTEMPT, so a failed dispatch left a `failed` row that nothing
-- could move again: the deploy route answered `already_deployed`, and the only
-- way back was deleting the row by hand.
--
-- This table keeps every attempt — who asked, when, how it ended, which
-- Actions run it became and that run's link — so HQ can see the current
-- attempt, the last failure and the last success at once, and a retry is a
-- NEW attempt rather than a rewrite of the old one.
--
-- `current_attempt` on the deployment is the retry's compare-and-set key: a
-- retry names the attempt it saw fail, and only one retry of that attempt can
-- ever win. A double click, or a replay after a lost response, finds the
-- counter already moved and is answered with the state, never a second
-- dispatch.
--
-- `do_jurisdiction` was dispatched but never stored, and a retry has to send
-- the same write-once value the first try sent. Rows written before this
-- migration leave it null; the retry then asks for it rather than guessing.

CREATE TABLE IF NOT EXISTS licence_deployment_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  licence_uid TEXT NOT NULL,
  code TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  -- dispatching: the row exists, GitHub has not answered yet.
  -- dispatched:  GitHub accepted the dispatch (204); the run's outcome is not known.
  -- failed:      the dispatch was refused, or the run concluded without success.
  -- succeeded:   the run concluded `success` (the branch answered its smoke test).
  status TEXT NOT NULL DEFAULT 'dispatching',
  failure_code TEXT,
  failure_note TEXT,
  run_id TEXT,
  run_url TEXT,
  run_status TEXT,
  run_conclusion TEXT,
  requested_by_user_id INTEGER,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  settled_at TEXT,
  UNIQUE (licence_uid, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_licence_deployment_attempts_licence
  ON licence_deployment_attempts(licence_uid, attempt_no);

ALTER TABLE licence_deployments ADD COLUMN current_attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE licence_deployments ADD COLUMN do_jurisdiction TEXT;

-- Every deployment that exists already had exactly one attempt: the one that
-- wrote it. Its outcome is what the row says, and nothing more is known — a
-- `requested` row's run was never read, so it stays `dispatched`, not
-- `succeeded`.
INSERT OR IGNORE INTO licence_deployment_attempts
  (uid, licence_uid, code, attempt_no, status, failure_note, run_id, requested_by_user_id, requested_at, settled_at)
SELECT 'att_' || lower(hex(randomblob(12))), licence_uid, code, 1,
       CASE WHEN status = 'failed' THEN 'failed'
            WHEN status = 'requested' THEN 'dispatched'
            ELSE 'succeeded' END,
       CASE WHEN status = 'failed' THEN status_note END,
       provision_run_id, requested_by_user_id, requested_at,
       CASE WHEN status = 'requested' THEN NULL ELSE updated_at END
  FROM licence_deployments;
