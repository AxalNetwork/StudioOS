-- D5361 (#5361) — a territory-licence termination must remember every former
-- administrator whose trust obligations still need to be re-seeded. The row is
-- inserted in the same batch as the demotion and binding deletion, so losing a
-- Worker after that batch cannot lose the cleanup it owes.
CREATE TABLE IF NOT EXISTS licence_termination_reseeds (
  licence_id      INTEGER NOT NULL REFERENCES licence_termination_ops(licence_id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state           TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  failure_code    TEXT,
  last_attempt_at TEXT,
  completed_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (licence_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_licence_termination_reseeds_pending
  ON licence_termination_reseeds(licence_id, state);
