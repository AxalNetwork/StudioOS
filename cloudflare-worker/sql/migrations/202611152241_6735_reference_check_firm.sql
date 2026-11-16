-- D6735 (#6735): record the verified active firm on new reference checks.
-- Historical checks stay private to their author and admins.
ALTER TABLE reference_checks ADD COLUMN company_id INTEGER REFERENCES company_profiles(id);
