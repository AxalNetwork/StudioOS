-- D5315 part 4: keep private edits separate from the public advisor row.
CREATE TABLE IF NOT EXISTS advisor_profile_drafts (
  advisor_id           INTEGER PRIMARY KEY REFERENCES advisors(id) ON DELETE CASCADE,
  revision             TEXT NOT NULL,
  base_revision        TEXT NOT NULL,
  fields_json          TEXT NOT NULL CHECK (json_valid(fields_json)),
  updated_at           TEXT NOT NULL,
  publish_requested_at TEXT
);

-- The guarded request, public row update, and draft removal are one write.
CREATE TRIGGER IF NOT EXISTS advisor_profile_drafts_publish
AFTER UPDATE OF publish_requested_at ON advisor_profile_drafts
WHEN NEW.publish_requested_at IS NOT NULL
BEGIN
  UPDATE advisors SET
    display_name = json_extract(NEW.fields_json, '$.display_name'),
    bio = json_extract(NEW.fields_json, '$.bio'),
    linkedin_url = json_extract(NEW.fields_json, '$.linkedin_url'),
    hourly_rate_usd = json_extract(NEW.fields_json, '$.hourly_rate_usd'),
    expertise_json = json_extract(NEW.fields_json, '$.expertise_json'),
    sectors_json = json_extract(NEW.fields_json, '$.sectors_json'),
    headline = json_extract(NEW.fields_json, '$.headline'),
    stages_json = json_extract(NEW.fields_json, '$.stages_json'),
    languages_json = json_extract(NEW.fields_json, '$.languages_json'),
    country = json_extract(NEW.fields_json, '$.country'),
    timezone = json_extract(NEW.fields_json, '$.timezone'),
    availability_note = json_extract(NEW.fields_json, '$.availability_note'),
    headshot_url = json_extract(NEW.fields_json, '$.headshot_url'),
    updated_at = NEW.publish_requested_at
  WHERE id = NEW.advisor_id AND updated_at IS NEW.base_revision;

  DELETE FROM advisor_profile_drafts
   WHERE advisor_id = NEW.advisor_id AND revision = NEW.revision
     AND EXISTS (
       SELECT 1 FROM advisors
        WHERE id = NEW.advisor_id AND updated_at = NEW.publish_requested_at
     );
END;
