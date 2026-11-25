-- D7845 (#7845): owner-private atomic fund saves. Catalogue references live only in research_funds.
CREATE TABLE IF NOT EXISTS research_fund_save_requests (
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 64),
  ids_digest TEXT NOT NULL CHECK (length(ids_digest) = 64 AND ids_digest NOT GLOB '*[^0-9a-f]*'),
  created_dossier_ids TEXT NOT NULL CHECK (json_valid(created_dossier_ids) AND json_type(created_dossier_ids) = 'array'),
  already_dossier_ids TEXT NOT NULL CHECK (json_valid(already_dossier_ids) AND json_type(already_dossier_ids) = 'array'),
  PRIMARY KEY (owner_user_id, request_id)
);
