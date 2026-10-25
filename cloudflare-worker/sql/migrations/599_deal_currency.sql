-- D1149 (#3054): existing deals retain their recorded USD denomination.
ALTER TABLE deals ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'
  CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]');
