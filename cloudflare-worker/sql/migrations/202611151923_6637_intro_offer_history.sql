-- D6637: matching keeps its existing one-per-pair record. Member offers retain
-- closed records and admit at most one open offer in each direction.
DROP INDEX IF EXISTS idx_intro_props_pair;
CREATE UNIQUE INDEX IF NOT EXISTS idx_intro_props_pair ON intro_propositions(user_id,target_user_id) WHERE source<>'offered';
CREATE UNIQUE INDEX IF NOT EXISTS idx_intro_offers_open ON intro_propositions(user_id,target_user_id) WHERE source='offered' AND status='pending';
