-- D7713: cover grouped company placement and find member sort keys by their exact raw labels.
CREATE INDEX IF NOT EXISTS idx_research_company_directory_sector_country
  ON research_company_directory (sector, country);
