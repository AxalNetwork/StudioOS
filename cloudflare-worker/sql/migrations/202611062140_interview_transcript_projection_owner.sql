-- D4626 (#4626) — name the session whose final transcript is projected onto
-- discovery_interviews. The nullable owner leaves direct uploads and composed
-- channel mirrors unchanged. Historical rows are claimed only when a final
-- session transcript exactly matches the parent projection; ambiguous or
-- independently-authored text stays unowned and is never guessed at deletion.

ALTER TABLE discovery_interviews ADD COLUMN transcript_session_uid TEXT;

UPDATE discovery_interviews AS interview
SET transcript_session_uid = (
  SELECT session.uid
  FROM interview_sessions AS session
  WHERE session.interview_id = interview.id
    AND interview.transcript = (
      SELECT group_concat(text, char(10))
      FROM (
        SELECT segment.text
        FROM interview_transcript_segments AS segment
        WHERE segment.session_id = session.id AND segment.source = 'final'
        ORDER BY segment.id
      )
    )
  ORDER BY session.updated_at DESC, session.id DESC
  LIMIT 1
)
WHERE interview.transcript IS NOT NULL
  AND interview.transcript_session_uid IS NULL;
