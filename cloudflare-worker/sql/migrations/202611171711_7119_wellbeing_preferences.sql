-- D7119 (#7119): Wellness recommendations. A member's own choices, and the
-- suggestions they dismissed.
--
-- wellbeing_preferences: one row per member, written only by that member.
--   support_types_json  the kinds of support they asked for (therapy,
--                       dietetics, nutrition, coaching, mindfulness, spiritual)
--   languages_json, timezone, price_max_cents, formats_json (one_to_one, group)
--   suggestions         1 = show suggestions on the home; 0 = browse only
--   topic_consent       1 = the member allowed the topics they chose on their
--                       own reflections to be used for suggestions; off by
--                       default, and revocable at any time
--   topic_sources_json  which of their records that consent covers (day,
--                       week, month, earlier)
-- No row means nothing chosen and consent off.
--
-- wellbeing_recommendation_dismissals: "Dismiss" on a suggestion. Undo deletes
-- the row; Reset deletes them all.

CREATE TABLE IF NOT EXISTS wellbeing_preferences (
  user_id INTEGER PRIMARY KEY,
  support_types_json TEXT NOT NULL DEFAULT '[]',
  languages_json TEXT NOT NULL DEFAULT '[]',
  timezone TEXT,
  price_max_cents INTEGER,
  formats_json TEXT NOT NULL DEFAULT '[]',
  suggestions INTEGER NOT NULL DEFAULT 1,
  topic_consent INTEGER NOT NULL DEFAULT 0,
  topic_sources_json TEXT NOT NULL DEFAULT '[]',
  topic_consent_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wellbeing_recommendation_dismissals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('expert', 'session')),
  target_uid TEXT NOT NULL,
  dismissed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, target_kind, target_uid)
);
