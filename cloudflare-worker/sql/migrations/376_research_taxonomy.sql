-- 376 — the Research sector and country crosswalk (D533, issue #1080).
--
-- Four sector vocabularies never met: the 82 market-directory slugs (229), the
-- 12 market-intelligence sectors (services/market_intel/aggregator.ts), the
-- free-text `sector` on research_company_directory (228) and the free-text
-- `sector_focus` on research_fund_directory (365). Geography was free text too:
-- company `country` is a name, fund `hq` is whatever the spreadsheet said.
--
-- This migration holds the two things that are facts rather than rules:
--   research_countries       ISO 3166-1 alpha-2 code, name and region.
--   research_market_sectors  each market slug's market-intelligence sector, or
--                            NULL where none fits. Chosen by hand, row by row.
-- and one table for hand corrections:
--   research_taxonomy_overrides  a raw value mapped by hand, which wins over
--                                the rule in services/researchTaxonomy.ts.
--                                A row with target NULL pins a value unmapped.
--
-- Raw company and fund strings are mapped at read time by the exact-match
-- dictionaries in services/researchTaxonomy.ts; every answer it gives carries
-- `method` ('rule' or 'manual'). A value no dictionary names stays unmapped.

CREATE TABLE IF NOT EXISTS research_countries (
  code TEXT PRIMARY KEY CHECK (length(code) = 2 AND code = upper(code)),
  name TEXT NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('Europe', 'North America', 'Latin America', 'Asia', 'Middle East', 'Africa', 'Oceania'))
);

CREATE TABLE IF NOT EXISTS research_market_sectors (
  market_slug TEXT PRIMARY KEY,
  mi_sector TEXT,
  method TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('rule', 'manual')),
  note TEXT
);

CREATE TABLE IF NOT EXISTS research_taxonomy_overrides (
  kind TEXT NOT NULL CHECK (kind IN ('company_sector', 'fund_focus', 'company_country', 'fund_hq')),
  raw_value TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT 'manual' CHECK (method = 'manual'),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (kind, raw_value, target)
);

INSERT OR IGNORE INTO research_countries (code, name, region) VALUES
  ('AE','United Arab Emirates','Middle East'),
  ('AL','Albania','Europe'),
  ('AR','Argentina','Latin America'),
  ('AT','Austria','Europe'),
  ('AU','Australia','Oceania'),
  ('BE','Belgium','Europe'),
  ('BG','Bulgaria','Europe'),
  ('BR','Brazil','Latin America'),
  ('CA','Canada','North America'),
  ('CH','Switzerland','Europe'),
  ('CL','Chile','Latin America'),
  ('CN','China','Asia'),
  ('CY','Cyprus','Europe'),
  ('CZ','Czechia','Europe'),
  ('DE','Germany','Europe'),
  ('DK','Denmark','Europe'),
  ('EE','Estonia','Europe'),
  ('EG','Egypt','Africa'),
  ('ES','Spain','Europe'),
  ('FI','Finland','Europe'),
  ('FR','France','Europe'),
  ('GB','United Kingdom','Europe'),
  ('GG','Guernsey','Europe'),
  ('GR','Greece','Europe'),
  ('HK','Hong Kong','Asia'),
  ('HR','Croatia','Europe'),
  ('HU','Hungary','Europe'),
  ('ID','Indonesia','Asia'),
  ('IE','Ireland','Europe'),
  ('IL','Israel','Middle East'),
  ('IN','India','Asia'),
  ('IR','Iran','Middle East'),
  ('IS','Iceland','Europe'),
  ('IT','Italy','Europe'),
  ('JP','Japan','Asia'),
  ('KE','Kenya','Africa'),
  ('KR','South Korea','Asia'),
  ('LK','Sri Lanka','Asia'),
  ('LT','Lithuania','Europe'),
  ('LU','Luxembourg','Europe'),
  ('LV','Latvia','Europe'),
  ('MC','Monaco','Europe'),
  ('MT','Malta','Europe'),
  ('MX','Mexico','Latin America'),
  ('NG','Nigeria','Africa'),
  ('NL','Netherlands','Europe'),
  ('NO','Norway','Europe'),
  ('NZ','New Zealand','Oceania'),
  ('PL','Poland','Europe'),
  ('PT','Portugal','Europe'),
  ('RO','Romania','Europe'),
  ('RS','Serbia','Europe'),
  ('RU','Russia','Europe'),
  ('SA','Saudi Arabia','Middle East'),
  ('SE','Sweden','Europe'),
  ('SG','Singapore','Asia'),
  ('SI','Slovenia','Europe'),
  ('TH','Thailand','Asia'),
  ('TR','Turkey','Europe'),
  ('TW','Taiwan','Asia'),
  ('TZ','Tanzania','Africa'),
  ('UA','Ukraine','Europe'),
  ('US','United States','North America'),
  ('UZ','Uzbekistan','Asia'),
  ('VN','Vietnam','Asia'),
  ('ZA','South Africa','Africa');

-- Each of the 82 market slugs, chosen by hand. NULL means no market-intelligence
-- sector fits closely enough to borrow its index series; the market page then
-- says "Not recorded" for the index rather than showing a neighbour's.
INSERT OR IGNORE INTO research_market_sectors (market_slug, mi_sector, note) VALUES
  ('advertising', NULL, NULL),
  ('agtech', NULL, NULL),
  ('ai', 'Enterprise AI', NULL),
  ('analytics', 'Data / Analytics', NULL),
  ('ar-vr', NULL, NULL),
  ('audiotech', NULL, NULL),
  ('autotech', NULL, NULL),
  ('biotech', 'Bio-Automation', NULL),
  ('chemicals', NULL, NULL),
  ('climatetech-cleantech', 'Climate Intelligence', NULL),
  ('cloud-infrastructure', NULL, 'AI Infrastructure is narrower than cloud; not borrowed.'),
  ('constructiontech', NULL, NULL),
  ('consumer-health', NULL, NULL),
  ('consumer-internet', NULL, NULL),
  ('cosmetics', NULL, NULL),
  ('creator-passion-economy', NULL, NULL),
  ('cybersecurity', 'Cybersecurity', NULL),
  ('data-services', 'Data / Analytics', NULL),
  ('deeptech', NULL, NULL),
  ('defensetech', NULL, NULL),
  ('developer-tools', 'DevTools', NULL),
  ('diagnostics', NULL, NULL),
  ('digital-health', NULL, NULL),
  ('direct-to-consumer-dtc', NULL, NULL),
  ('drug-delivery', NULL, NULL),
  ('e-commerce', NULL, NULL),
  ('education', NULL, NULL),
  ('energytech', 'Climate Intelligence', NULL),
  ('enterprise-applications', NULL, NULL),
  ('enterprise-infrastructure', NULL, NULL),
  ('enterprise', NULL, NULL),
  ('entertainment-sports', NULL, NULL),
  ('fashion', NULL, NULL),
  ('fintech', 'Fintech / DeFi', NULL),
  ('food-and-beverage', NULL, NULL),
  ('future-of-work', NULL, NULL),
  ('games', NULL, NULL),
  ('gaming-esports', NULL, NULL),
  ('general-tech', NULL, NULL),
  ('generative-tech-ai', 'Enterprise AI', NULL),
  ('gig-economy', NULL, NULL),
  ('govtech', NULL, NULL),
  ('hardware', NULL, NULL),
  ('health-hospital-services', NULL, NULL),
  ('health-it', NULL, NULL),
  ('human-capital-hrtech', NULL, NULL),
  ('impact', NULL, NULL),
  ('insurance', NULL, NULL),
  ('iot', NULL, NULL),
  ('legaltech', NULL, NULL),
  ('local-services', NULL, NULL),
  ('lodging-hospitality', NULL, NULL),
  ('logistics', NULL, NULL),
  ('manufacturing', NULL, NULL),
  ('marketingtech', NULL, NULL),
  ('marketplaces', NULL, NULL),
  ('material-science', NULL, NULL),
  ('media-content', NULL, NULL),
  ('medical-devices', NULL, NULL),
  ('messaging', NULL, NULL),
  ('parenting-families', NULL, NULL),
  ('payments', 'Fintech / DeFi', NULL),
  ('pharmaceuticals', NULL, NULL),
  ('real-estate-proptech', NULL, NULL),
  ('retail', NULL, NULL),
  ('robotics', 'Autonomous Robotics', NULL),
  ('saas', NULL, NULL),
  ('sales-crm', NULL, NULL),
  ('security', NULL, 'Physical and digital security together; not only cybersecurity.'),
  ('semiconductors', NULL, NULL),
  ('smart-cities-urbantech', NULL, NULL),
  ('smb-software', NULL, NULL),
  ('social-commerce', NULL, NULL),
  ('social-networks', NULL, NULL),
  ('space', NULL, NULL),
  ('supply-chain-tech', NULL, NULL),
  ('therapeutics', NULL, NULL),
  ('transportationtech', NULL, NULL),
  ('travel', NULL, NULL),
  ('web3-blockchain', 'Fintech / DeFi', NULL),
  ('web3-crypto', 'Fintech / DeFi', NULL),
  ('wellness-fitness', NULL, NULL);
