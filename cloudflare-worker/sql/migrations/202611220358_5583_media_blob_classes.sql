-- D5583 part 2: extend the existing blob ledger with media class and quota attribution.
-- Generic keys and rows retain their old meaning. Each physical class/digest copy
-- is counted once; references and revisions never duplicate its storage charge.
CREATE TABLE work_graph_blobs_classed (
  tenant_id INTEGER NOT NULL CHECK (tenant_id > 0),
  company_id INTEGER NOT NULL CHECK (company_id > 0),
  object_class TEXT NOT NULL DEFAULT 'generic' CHECK (object_class IN ('generic','master','snapshot','rendition','thumbnail')),
  digest TEXT NOT NULL CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  residency TEXT CHECK (residency IS NULL OR length(residency) <= 40),
  admitted_owner_user_id INTEGER CHECK (admitted_owner_user_id IS NULL OR admitted_owner_user_id > 0),
  project_id INTEGER NOT NULL DEFAULT 0 CHECK (project_id >= 0),
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (tenant_id, company_id, project_id, object_class, digest)
);
INSERT INTO work_graph_blobs_classed (tenant_id,company_id,digest,byte_length,residency,created_at,deleted_at)
  SELECT tenant_id,company_id,digest,byte_length,residency,created_at,deleted_at FROM work_graph_blobs;
DROP TABLE work_graph_blobs;
ALTER TABLE work_graph_blobs_classed RENAME TO work_graph_blobs;
CREATE INDEX idx_work_graph_blobs_company ON work_graph_blobs (company_id, project_id, deleted_at);
CREATE TRIGGER work_graph_blobs_fixed BEFORE UPDATE ON work_graph_blobs
WHEN NEW.tenant_id IS NOT OLD.tenant_id OR NEW.company_id IS NOT OLD.company_id OR NEW.object_class IS NOT OLD.object_class
  OR NEW.digest IS NOT OLD.digest OR NEW.byte_length IS NOT OLD.byte_length OR NEW.residency IS NOT OLD.residency
  OR NEW.admitted_owner_user_id IS NOT OLD.admitted_owner_user_id OR NEW.project_id IS NOT OLD.project_id OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'work_graph_blobs: only deleted_at changes (D5583 part 2).'); END;
CREATE TRIGGER work_graph_blobs_no_delete BEFORE DELETE ON work_graph_blobs
BEGIN SELECT RAISE(ABORT, 'work_graph_blobs is never deleted, set deleted_at (D5583 part 2).'); END;
