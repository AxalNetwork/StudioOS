-- D1592 (#3860): a company's own documents. A company document is a
-- `documents` row with `company_id` set and `project_id` NULL; `uploaded_by`
-- is the member who uploaded it. Additive only; the ledger runner applies it.
ALTER TABLE documents ADD COLUMN company_id INTEGER REFERENCES company_profiles(id);
ALTER TABLE documents ADD COLUMN uploaded_by INTEGER REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_id, doc_type, created_at) WHERE company_id IS NOT NULL;
