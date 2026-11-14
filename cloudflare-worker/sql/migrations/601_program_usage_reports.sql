-- D1156: latest count-only report per studio and granted program. No member data.
CREATE TABLE IF NOT EXISTS program_usage_reports (
  licence_uid TEXT NOT NULL REFERENCES territory_licences(uid) ON DELETE CASCADE,
  program_key TEXT NOT NULL,
  branch_code TEXT NOT NULL,
  period TEXT NOT NULL,
  people INTEGER CHECK (people IS NULL OR (typeof(people) = 'integer' AND people BETWEEN 0 AND 9007199254740991)),
  cohorts INTEGER CHECK (cohorts IS NULL OR (typeof(cohorts) = 'integer' AND cohorts BETWEEN 0 AND 9007199254740991)),
  referrals INTEGER CHECK (referrals IS NULL OR (typeof(referrals) = 'integer' AND referrals BETWEEN 0 AND 9007199254740991)),
  claims INTEGER CHECK (claims IS NULL OR (typeof(claims) = 'integer' AND claims BETWEEN 0 AND 9007199254740991)),
  unreadable INTEGER NOT NULL DEFAULT 0 CHECK (unreadable BETWEEN 0 AND 15),
  reported_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (licence_uid, program_key)
);
