-- 595 — data-room access requests in one queue (D1104, #2984).
-- Reserved for D1104 on #2984 (part 3 of Data room, #2456), 2026-10-25.
--
-- An investor asks to see a venture's room from a round call (the call's
-- "Request the data room") or, once DEAL #2421's DL9 is built, from the deal
-- page. Until now a round-call request lived only on its recipient row
-- (`round_call_recipients.data_room_requested_at`) and was shown only on the
-- call page. One queue holds both, and the founder answers it on the room.
--
--   ONE OPEN REQUEST PER INVESTOR AND VENTURE. The partial unique index holds
--   it, so asking twice (two calls, or a call and the deal page) is one row.
--   A decided request stays as the record of the answer; a later request
--   opens a new row.
--
--   ACCEPTED WRITES THE GRANT. The route that accepts a request writes the
--   `data_room_grants` row (with part 2's folders and end date when given);
--   this table records who decided and when. DECLINED keeps the reason the
--   investor was told.
--
--   `round_call_id` names the call a round-call request came from (null for
--   the deal page, or when the call is deleted).
--
-- THE BACKFILL. One row per investor and venture from every round-call
-- request recorded so far, dated by the earliest. An investor who already
-- holds a live grant on that venture was answered before the queue existed:
-- that row is `accepted`, with `decided_by` and `decided_at` null — who
-- decided and when were never recorded, and the read says so. Any other is
-- `open`. A re-run adds nothing (NOT EXISTS on the same venture and investor).
--
-- Grep first (D689 D-t): no `data_room_access_requests` table exists in any
-- earlier migration or the baseline.
CREATE TABLE IF NOT EXISTS data_room_access_requests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  uid              TEXT NOT NULL UNIQUE,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  investor_user_id INTEGER NOT NULL REFERENCES users(id),
  source           TEXT NOT NULL CHECK (source IN ('round_call', 'deal_page')),
  round_call_id    INTEGER REFERENCES round_calls(id) ON DELETE SET NULL,
  message          TEXT CHECK (message IS NULL OR length(message) <= 2000),
  state            TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'accepted', 'declined')),
  decided_by       INTEGER REFERENCES users(id),
  decided_at       TEXT,
  decline_reason   TEXT CHECK (decline_reason IS NULL OR length(decline_reason) <= 500),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dr_requests_open
  ON data_room_access_requests(project_id, investor_user_id) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS idx_dr_requests_project
  ON data_room_access_requests(project_id, state, created_at);

INSERT OR IGNORE INTO data_room_access_requests
  (uid, project_id, investor_user_id, source, round_call_id, state, created_at)
SELECT lower(hex(randomblob(16))), c.project_id, r.investor_user_id, 'round_call', MIN(c.id),
       CASE WHEN EXISTS (
         SELECT 1 FROM data_room_grants g
          WHERE g.project_id = c.project_id AND g.investor_user_id = r.investor_user_id AND g.status = 'active'
            AND (g.expires_at IS NULL OR datetime(g.expires_at) > datetime('now'))
       ) THEN 'accepted' ELSE 'open' END,
       MIN(r.data_room_requested_at)
  FROM round_call_recipients r
  JOIN round_calls c ON c.id = r.call_id
 WHERE r.data_room_requested_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM data_room_access_requests q
      WHERE q.project_id = c.project_id AND q.investor_user_id = r.investor_user_id
   )
 GROUP BY c.project_id, r.investor_user_id;
