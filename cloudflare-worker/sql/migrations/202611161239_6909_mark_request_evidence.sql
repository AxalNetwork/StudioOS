-- D6909 (#6909): evidence on a mark request, optional (owner answer A on
-- D6228: a file or a link). A request carries at most one: a link
-- (`evidence_url`, http or https) or a file stored in R2 under
-- `mark-request-evidence/<project_id>/` (`evidence_file_key` with its name,
-- size and type). Neither is required; a request with none reads "No evidence".
--
-- The columns are written once, with the request. Nothing here changes how a
-- request is answered (D6205).

ALTER TABLE portfolio_mark_requests ADD COLUMN evidence_url TEXT
  CHECK (evidence_url IS NULL OR ((evidence_url LIKE 'https://%' OR evidence_url LIKE 'http://%') AND length(evidence_url) <= 2000));
ALTER TABLE portfolio_mark_requests ADD COLUMN evidence_file_key TEXT
  CHECK (evidence_file_key IS NULL OR evidence_file_key LIKE 'mark-request-evidence/%');
ALTER TABLE portfolio_mark_requests ADD COLUMN evidence_file_name TEXT
  CHECK (evidence_file_name IS NULL OR length(evidence_file_name) BETWEEN 1 AND 200);
ALTER TABLE portfolio_mark_requests ADD COLUMN evidence_file_size INTEGER
  CHECK (evidence_file_size IS NULL OR evidence_file_size > 0);
ALTER TABLE portfolio_mark_requests ADD COLUMN evidence_file_mime TEXT;

-- One kind of evidence, never both; a file's columns are all set or all empty.
CREATE TRIGGER IF NOT EXISTS trg_portfolio_mark_requests_evidence_ins
BEFORE INSERT ON portfolio_mark_requests
WHEN (NEW.evidence_url IS NOT NULL AND NEW.evidence_file_key IS NOT NULL)
  OR ((NEW.evidence_file_key IS NULL) <> (NEW.evidence_file_name IS NULL))
  OR ((NEW.evidence_file_key IS NULL) <> (NEW.evidence_file_size IS NULL))
  OR ((NEW.evidence_file_key IS NULL) <> (NEW.evidence_file_mime IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'mark_request_evidence_shape');
END;

-- Evidence is written with the request and never changed afterwards.
CREATE TRIGGER IF NOT EXISTS trg_portfolio_mark_requests_evidence_frozen
BEFORE UPDATE ON portfolio_mark_requests
WHEN OLD.evidence_url IS NOT NEW.evidence_url
  OR OLD.evidence_file_key IS NOT NEW.evidence_file_key
  OR OLD.evidence_file_name IS NOT NEW.evidence_file_name
  OR OLD.evidence_file_size IS NOT NEW.evidence_file_size
  OR OLD.evidence_file_mime IS NOT NEW.evidence_file_mime
BEGIN
  SELECT RAISE(ABORT, 'mark_request_evidence_frozen');
END;
