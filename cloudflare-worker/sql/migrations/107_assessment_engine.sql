-- Task #ASSESS-1 — Gamified Assessment Engine: content / config tables.
--
-- The gamified assessment is NOT a new survey store. It is an engaging
-- elicitation front-end that *writes into the canonical taxonomy outputs the
-- matching engine already reads*:
--
--     • per-dimension value scores  → user_values   (migration 094, −2..+2)
--     • per-skill proficiency       → user_skills    (migration 091, 0..5)
--     • investor thesis vectors      → investor_profiles (migrations 009/096)
--
-- ...while adding its own game layer (this file + 108): a catalog of playable
-- "games" (one per persona track), the chapters/items that make up each game,
-- the named archetypes a finished playthrough resolves to, and the badge
-- catalog. Per-user play + computed results live in 108_assessment_play.sql.
--
-- Reference data, versioned + admin-authorable. Additive only, every statement
-- is IF NOT EXISTS / INSERT OR IGNORE on a UNIQUE slug, so re-applying is a
-- clean no-op. The worker carries a lazy bootstrap mirror in
-- services/assessmentSchema.ts::ensureAssessmentSchema() (CREATE TABLE IF NOT
-- EXISTS on the cold path — it creates SHAPE only, never seeds; bulk-seeding
-- content is this migration's job) so routes self-heal on a D1 that has not yet
-- had this migration applied — same pattern as ensureSkillsTaxonomySchema().
--
-- Apply (D1 "studioos-db" is bound as DB in the repo-root wrangler.toml):
--   npx wrangler d1 execute studioos-db --config wrangler.toml --remote \
--     --file=cloudflare-worker/sql/migrations/107_assessment_engine.sql
--
-- ============================================================================
-- PERSONA TRACKS (assessment_games.track — stable enum, NOT a users.role)
-- ----------------------------------------------------------------------------
--   founder_new       New / first-time founders (idea / pre-incorporation)
--   founder_existing  Operating founders (post-traction / scaling)
--   investor_lp       Investors & LPs (capital allocators)
--   partner           Service partners (legal, finance, GTM, design, …)
--   mentor            Operator-mentors (domain office hours)
--   coach             Coaches (personal / leadership / wellbeing development)
--
-- `track` is deliberately independent of the users.role CHECK constraint
-- (admin|founder|partner|investor) so mentors/coaches — which are modelled via
-- the mentors table + personas, not a DB role — get their own game without
-- fighting the role enum. The route layer resolves a user's eligible track(s)
-- from role + persona + the mentors/partners records.
--
-- MECHANICS (assessment_chapters.mechanic / assessment_items.mechanic)
-- ----------------------------------------------------------------------------
--   dilemma     Forced trade-off between 2-3 loaded options ("The Crossroads")
--   card_sort   Drag a scarce deck into a ranking ("Priorities Draft")
--   sjt         Situational-judgement skill quest ("Prove It")
--   speed       Timed rapid-fire binary ("Gut Check") — latency is signal
--   allocation  Distribute a fixed budget across buckets ("Allocation")
--   reflection  Free / optional self-report, unlocks a Scout-Report reveal
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) assessment_games — one playable game per (track, version).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_games (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT NOT NULL UNIQUE,          -- stable join key, never rename
  track             TEXT NOT NULL,                 -- see PERSONA TRACKS above
  title             TEXT NOT NULL,
  tagline           TEXT,
  description       TEXT,
  theme             TEXT,                          -- cosmetic skin key (frontend)
  version           INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'draft',  -- draft|published|archived
  estimated_minutes INTEGER NOT NULL DEFAULT 8,
  is_default        INTEGER NOT NULL DEFAULT 0,     -- 1 == default game for its track
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assessment_games_track
  ON assessment_games (track, status);

-- ---------------------------------------------------------------------------
-- 2) assessment_chapters — ordered chapters inside a game; each has a mechanic.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_chapters (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  game_slug         TEXT NOT NULL,                 -- → assessment_games.slug
  slug              TEXT NOT NULL,
  title             TEXT NOT NULL,
  subtitle          TEXT,
  mechanic          TEXT NOT NULL,                 -- see MECHANICS above
  display_order     INTEGER NOT NULL DEFAULT 0,
  reward_badge_slug TEXT,                          -- → badge_catalog.slug (nullable)
  config_json       TEXT NOT NULL DEFAULT '{}',     -- mechanic config (timer_ms, pick_n, …)
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (game_slug, slug)
);
CREATE INDEX IF NOT EXISTS idx_assessment_chapters_game
  ON assessment_chapters (game_slug, display_order);

-- ---------------------------------------------------------------------------
-- 3) assessment_items — the individual prompts (cards / dilemmas / quests).
--
-- options_json   array of {key,label,loads:{<dimension|axis slug>: weight},
--                seniority_hint?}. For dilemma/speed/sjt: choosing an option
--                applies its `loads`. For card_sort: options ARE the deck cards
--                and rank position scales the load. For allocation: options are
--                buckets and the allocated amount scales the load.
-- measures_json  array of value_dimensions.slug and/or skill_categories.slug
--                this item informs (drives which canonical output it writes).
-- scoring_json   optional per-item overrides (weight, reverse, latency band).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  slug          TEXT NOT NULL UNIQUE,             -- stable join key, never rename
  game_slug     TEXT NOT NULL,                    -- → assessment_games.slug
  chapter_slug  TEXT NOT NULL,                    -- → assessment_chapters.slug
  mechanic      TEXT NOT NULL,                    -- see MECHANICS above
  prompt        TEXT NOT NULL,
  helptext      TEXT,
  options_json  TEXT NOT NULL DEFAULT '[]',
  measures_json TEXT NOT NULL DEFAULT '[]',
  scoring_json  TEXT NOT NULL DEFAULT '{}',
  tags_json     TEXT NOT NULL DEFAULT '[]',
  display_order INTEGER NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assessment_items_chapter
  ON assessment_items (game_slug, chapter_slug, display_order);
CREATE INDEX IF NOT EXISTS idx_assessment_items_active
  ON assessment_items (is_active);

-- ---------------------------------------------------------------------------
-- 4) assessment_archetypes — named output clusters per track. A finished
--    playthrough resolves to the nearest archetype by distance between the
--    player's value/skill vector and these centroids.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_archetypes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                TEXT NOT NULL UNIQUE,
  track               TEXT NOT NULL,
  name                TEXT NOT NULL,
  tagline             TEXT,
  description         TEXT,
  icon                TEXT,                        -- lucide icon name
  color               TEXT,                        -- hex / token for the card
  value_centroid_json TEXT NOT NULL DEFAULT '{}',   -- {value_dimension_slug: −2..+2}
  skill_emphasis_json TEXT NOT NULL DEFAULT '{}',   -- {skill_category_slug: 0..5}
  display_order       INTEGER NOT NULL DEFAULT 0,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assessment_archetypes_track
  ON assessment_archetypes (track, display_order);

-- ---------------------------------------------------------------------------
-- 5) badge_catalog — the achievements a player / attendee can earn. Awarded
--    rows live in 108 (user_badges). Events (migration 109) award from here too.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS badge_catalog (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  icon          TEXT,
  color         TEXT,
  category      TEXT NOT NULL DEFAULT 'assessment', -- assessment|event|engagement|milestone
  criteria_json TEXT NOT NULL DEFAULT '{}',          -- documents how it is earned
  rarity        TEXT NOT NULL DEFAULT 'common',      -- common|rare|epic|legendary
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===========================================================================
-- SEED — structural catalog (self-contained slugs) + a playable flagship
-- (founder_new) and template items for the other tracks. Idempotent via the
-- UNIQUE slug + INSERT OR IGNORE. Value-dimension slugs referenced below are
-- the canonical ones seeded by 090 (founder_* bipolar −2..+2, schwartz_*);
-- skill axes are the 8 skill_categories slugs. Authoring the full item bank
-- for every track is a downstream content task (see design/REPLIT_PROMPTS.md).
-- ===========================================================================

-- 5a) The six games — one per persona track.
INSERT OR IGNORE INTO assessment_games
  (slug, track, title, tagline, description, theme, version, status, estimated_minutes, is_default) VALUES
  ('founder_origin_v1',  'founder_new',      'Founder Origin',   'Discover the founder you are becoming.',        'A scenario game that maps your values and skill baseline as a new founder.', 'origin',   1, 'published', 8,  1),
  ('operators_path_v1',  'founder_existing', 'Operator''s Path',  'Lead under real pressure.',                     'Growth-stage dilemmas that surface your leadership values and evidence-backed strengths.', 'operator', 1, 'published', 9,  1),
  ('thesis_lab_v1',      'investor_lp',      'Thesis Lab',       'Allocate, decide, reveal your edge.',           'Mock allocations and deal triage that map your investment thesis and conviction style.', 'thesis',   1, 'published', 9,  1),
  ('partner_playbook_v1','partner',          'Partner Playbook', 'Scope it. Prioritise it. Own it.',              'Engagement scenarios that map your service strengths and working style.', 'playbook', 1, 'published', 7,  1),
  ('mentor_compass_v1',  'mentor',           'Mentor Compass',   'How do you show up for founders?',              'Coaching-moment dilemmas that map your domain strengths and mentoring style.', 'compass',  1, 'published', 7,  1),
  ('coachs_lens_v1',     'coach',            'Coach''s Lens',     'Meet the founder where they are.',              'Personal-development scenarios that map your coaching focus and modality.', 'lens',     1, 'published', 7,  1);

-- 5b) Badge catalog — earned via assessment completion, archetypes, and events.
INSERT OR IGNORE INTO badge_catalog (slug, name, description, icon, color, category, rarity) VALUES
  ('first_playthrough',   'Origin Story',        'Completed your first assessment game.',                 'Sparkles',   '#8b5cf6', 'assessment', 'common'),
  ('full_radar',          'Full Spectrum',       'Filled in all eight skill axes.',                       'Radar',      '#22c55e', 'assessment', 'rare'),
  ('calibrated',          'Calibrated',          'High confidence-calibration — you know what you know.',  'Target',     '#0ea5e9', 'assessment', 'rare'),
  ('decisive',            'Decisive',            'Completed a Gut Check speed round without timing out.',  'Zap',        '#f59e0b', 'assessment', 'common'),
  ('risk_taker',          'Risk-Taker',          'Your choices lean strongly risk-seeking.',              'Flame',      '#ef4444', 'assessment', 'common'),
  ('systems_thinker',     'Systems Thinker',     'Your choices favour durable structure and process.',    'Network',    '#6366f1', 'assessment', 'common'),
  ('mission_driven',      'Mission-Driven',      'Mission consistently outweighs near-term profit.',      'Compass',    '#14b8a6', 'assessment', 'common'),
  ('thesis_locked',       'Thesis Locked',       'Defined a clear, internally-consistent investing thesis.','Crosshair', '#a855f7', 'assessment', 'rare'),
  ('archetype_revealed',  'Archetype Revealed',  'Unlocked your archetype card.',                         'Award',      '#eab308', 'assessment', 'rare'),
  ('demo_day_presenter',  'Demo Day Presenter',  'Presented at an Axal Spin-Out demo day.',               'Presentation','#f97316', 'event',     'epic'),
  ('networker',           'Networker',           'Checked in to five Axal events.',                       'Users',      '#3b82f6', 'event',     'rare'),
  ('founding_attendee',   'Founding Attendee',   'Among the first to attend a public Axal event.',        'Star',       '#facc15', 'event',     'legendary');

-- 5c) Archetypes — flagship founder set + a representative set per other track.
INSERT OR IGNORE INTO assessment_archetypes
  (slug, track, name, tagline, description, icon, color, value_centroid_json, skill_emphasis_json, display_order) VALUES
  ('founder_builder',   'founder_new',      'The Builder',     'Ships first, learns fast.',           'Bias to action and product velocity; learns by shipping.',          'Hammer',  '#22c55e', '{"founder_speed_vs_quality":2,"founder_risk_appetite":1,"founder_autonomy_vs_structure":1}', '{"product":4,"engineering":4}', 1),
  ('founder_visionary', 'founder_new',      'The Visionary',   'Mission over everything.',            'Long-horizon, mission-anchored, narrative-led.',                    'Compass', '#14b8a6', '{"founder_mission_vs_profit":2,"founder_growth_vs_sustain":1,"schwartz_universalism":1}', '{"marketing_brand":4,"capital_network":3}', 2),
  ('founder_operator',  'founder_new',      'The Operator',    'Systems make it scale.',              'Process, durability, and disciplined execution.',                  'Network', '#6366f1', '{"founder_autonomy_vs_structure":-2,"founder_growth_vs_sustain":-1,"schwartz_security":1}', '{"finance_ops":4,"product":3}', 3),
  ('founder_hustler',   'founder_new',      'The Hustler',     'Revenue is oxygen.',                  'Sales-led, fast to monetise, comfortable with risk.',              'Flame',   '#ef4444', '{"founder_mission_vs_profit":-1,"founder_risk_appetite":2,"founder_speed_vs_quality":1}', '{"gtm_sales":4,"marketing_brand":3}', 4),
  ('founder_scientist', 'founder_new',      'The Scientist',   'Evidence over opinion.',              'Rigorous, research-led, quality-biased.',                          'FlaskConical','#0ea5e9','{"founder_speed_vs_quality":-2,"schwartz_self_direction":1,"founder_risk_appetite":-1}', '{"engineering":4,"product":3}', 5),
  ('operator_captain',  'founder_existing', 'The Captain',     'Calm hand at scale.',                 'Leads through ambiguity; balances team, board, and burn.',         'Anchor',  '#0ea5e9', '{"founder_autonomy_vs_structure":-1,"schwartz_benevolence":1}', '{"finance_ops":4,"capital_network":3}', 1),
  ('operator_closer',   'founder_existing', 'The Closer',      'Turns pipeline into revenue.',        'Revenue-obsessed operator who scales GTM.',                        'TrendingUp','#f59e0b','{"founder_growth_vs_sustain":2,"founder_risk_appetite":1}', '{"gtm_sales":5,"capital_network":3}', 2),
  ('investor_conviction','investor_lp',     'The Conviction Bettor','Few bets, deep belief.',         'Concentrated, thesis-driven, high-conviction allocator.',          'Crosshair','#a855f7','{"founder_risk_appetite":2,"schwartz_achievement":1}', '{}', 1),
  ('investor_architect','investor_lp',      'The Portfolio Architect','Construction over picks.',     'Diversified, disciplined portfolio construction and reserves.',    'LayoutGrid','#6366f1','{"founder_risk_appetite":-1,"founder_growth_vs_sustain":-1,"schwartz_security":1}', '{}', 2),
  ('investor_catalyst', 'investor_lp',      'The Network Catalyst','Capital plus connections.',       'Value-add through network, hands-on with founders.',               'Share2',  '#14b8a6', '{"schwartz_benevolence":1,"founder_autonomy_vs_structure":1}', '{"capital_network":5}', 3),
  ('partner_specialist','partner',          'The Specialist',  'Deep in one domain.',                 'Narrow, deep expertise with a high bar.',                          'Gem',     '#0ea5e9', '{"founder_speed_vs_quality":-1,"schwartz_achievement":1}', '{}', 1),
  ('partner_generalist','partner',          'The Swiss Army',  'Adapts across the stack.',            'Broad operator-partner who flexes to the founder''s gap.',          'Wrench',  '#22c55e', '{"founder_autonomy_vs_structure":1}', '{}', 2),
  ('mentor_socratic',   'mentor',           'The Socratic',    'Asks the question behind the question.','Draws answers out; coaching over telling.',                       'MessageCircleQuestion','#8b5cf6','{"schwartz_benevolence":1,"founder_autonomy_vs_structure":1}', '{}', 1),
  ('mentor_operator',   'mentor',           'The Playbook',    'Been there, hands you the map.',       'Directive, pattern-library mentoring from lived experience.',      'BookOpen', '#f59e0b', '{"founder_autonomy_vs_structure":-1,"schwartz_achievement":1}', '{}', 2),
  ('coach_steadier',    'coach',            'The Steadier',    'Resilience and regulation.',          'Focus on founder wellbeing, resilience, and emotional regulation.','HeartHandshake','#14b8a6','{"schwartz_benevolence":2,"schwartz_security":1}', '{}', 1),
  ('coach_sharpener',   'coach',            'The Sharpener',   'Leadership and communication edge.',  'Focus on leadership presence, communication, and conflict.',       'Swords',   '#ef4444', '{"schwartz_achievement":1,"founder_autonomy_vs_structure":-1}', '{}', 2);

-- 5d) Flagship playable content — Founder Origin (founder_new) chapters.
INSERT OR IGNORE INTO assessment_chapters
  (game_slug, slug, title, subtitle, mechanic, display_order, reward_badge_slug, config_json) VALUES
  ('founder_origin_v1', 'crossroads',  'The Crossroads',   'No right answer — just yours.',      'dilemma',    1, NULL,                '{}'),
  ('founder_origin_v1', 'draft',       'Priorities Draft', 'You can only keep five.',            'card_sort',  2, NULL,                '{"pick_n":5}'),
  ('founder_origin_v1', 'prove_it',    'Prove It',         'Pick the lever you''d actually pull.','sjt',       3, 'full_radar',        '{}'),
  ('founder_origin_v1', 'gut_check',   'Gut Check',        'Don''t think. React.',               'speed',      4, 'decisive',          '{"timer_ms":6000}'),
  ('founder_origin_v1', 'scout',       'Scout Report',     'Meet your archetype.',               'reflection', 5, 'archetype_revealed','{}');

-- 5e) Founder Origin — Crossroads dilemmas (cover all 5 founder spectrums).
INSERT OR IGNORE INTO assessment_items
  (slug, game_slug, chapter_slug, mechanic, prompt, helptext, options_json, measures_json, display_order) VALUES
  ('fo_x_ship', 'founder_origin_v1', 'crossroads', 'dilemma',
   'The demo is Friday. The build works but has three known rough edges.',
   'Pick what you''d actually do.',
   '[{"key":"a","label":"Ship Friday — momentum matters","loads":{"founder_speed_vs_quality":2,"founder_risk_appetite":1}},{"key":"b","label":"Slip two weeks and polish","loads":{"founder_speed_vs_quality":-2,"schwartz_achievement":1}}]',
   '["founder_speed_vs_quality","founder_risk_appetite"]', 1),
  ('fo_x_equity', 'founder_origin_v1', 'crossroads', 'dilemma',
   'A strong co-founder will join — but wants an equal equity split.',
   NULL,
   '[{"key":"a","label":"50/50 — partners or nothing","loads":{"schwartz_benevolence":1,"founder_autonomy_vs_structure":1}},{"key":"b","label":"Weight it to contribution and control","loads":{"schwartz_power":1,"founder_autonomy_vs_structure":-1}}]',
   '["schwartz_benevolence","schwartz_power","founder_autonomy_vs_structure"]', 2),
  ('fo_x_raise', 'founder_origin_v1', 'crossroads', 'dilemma',
   'You can raise a big round now at a punchy valuation, or stay lean and bootstrap longer.',
   NULL,
   '[{"key":"a","label":"Raise big, go fast","loads":{"founder_growth_vs_sustain":2,"founder_risk_appetite":1}},{"key":"b","label":"Stay lean, own more","loads":{"founder_growth_vs_sustain":-2,"founder_autonomy_vs_structure":1}}]',
   '["founder_growth_vs_sustain","founder_risk_appetite"]', 3),
  ('fo_x_mission', 'founder_origin_v1', 'crossroads', 'dilemma',
   'A lucrative enterprise contract would pull you off your core mission for two quarters.',
   NULL,
   '[{"key":"a","label":"Take the cash — runway is king","loads":{"founder_mission_vs_profit":-2}},{"key":"b","label":"Protect the mission","loads":{"founder_mission_vs_profit":2,"schwartz_universalism":1}}]',
   '["founder_mission_vs_profit","schwartz_universalism"]', 4),
  ('fo_x_process', 'founder_origin_v1', 'crossroads', 'dilemma',
   'The team is at ten people and things are getting messy.',
   NULL,
   '[{"key":"a","label":"Install process and structure now","loads":{"founder_autonomy_vs_structure":-2,"schwartz_security":1}},{"key":"b","label":"Keep it loose and fast a while longer","loads":{"founder_autonomy_vs_structure":2,"founder_speed_vs_quality":1}}]',
   '["founder_autonomy_vs_structure","founder_speed_vs_quality"]', 5);

-- 5f) Founder Origin — Priorities Draft (single card_sort item; cards load
--     Schwartz dimensions; rank position scales the load in the scorer).
INSERT OR IGNORE INTO assessment_items
  (slug, game_slug, chapter_slug, mechanic, prompt, helptext, options_json, measures_json, display_order) VALUES
  ('fo_draft_main', 'founder_origin_v1', 'draft', 'card_sort',
   'Keep the five that drive you. Drop the rest.',
   'Drag your top five to the keep pile.',
   '[{"key":"achievement","label":"Achievement","loads":{"schwartz_achievement":1}},{"key":"independence","label":"Independence","loads":{"schwartz_self_direction":1}},{"key":"security","label":"Security","loads":{"schwartz_security":1}},{"key":"impact","label":"Impact on the world","loads":{"schwartz_universalism":1}},{"key":"helping","label":"Helping others","loads":{"schwartz_benevolence":1}},{"key":"status","label":"Status & influence","loads":{"schwartz_power":1}},{"key":"novelty","label":"Novelty & challenge","loads":{"schwartz_stimulation":1}},{"key":"enjoyment","label":"Enjoyment","loads":{"schwartz_hedonism":1}},{"key":"tradition","label":"Craft & tradition","loads":{"schwartz_tradition":1}},{"key":"belonging","label":"Belonging","loads":{"schwartz_conformity":1}}]',
   '["schwartz_achievement","schwartz_self_direction","schwartz_security","schwartz_universalism","schwartz_benevolence","schwartz_power","schwartz_stimulation","schwartz_hedonism","schwartz_tradition","schwartz_conformity"]', 1);

-- 5g) Founder Origin — Prove It (SJT skill quests; selected option's loads +
--     seniority_hint inform the player's user_skills self_level per axis).
INSERT OR IGNORE INTO assessment_items
  (slug, game_slug, chapter_slug, mechanic, prompt, helptext, options_json, measures_json, display_order) VALUES
  ('fo_skill_gtm', 'founder_origin_v1', 'prove_it', 'sjt',
   'Your cold outbound gets a 0.4% reply rate. First lever you pull?',
   'Pick the move you''d genuinely make first.',
   '[{"key":"a","label":"Rewrite the subject line and resend","loads":{"gtm_sales":1},"seniority_hint":"working"},{"key":"b","label":"Tighten the ICP and re-segment the list","loads":{"gtm_sales":2},"seniority_hint":"proficient"},{"key":"c","label":"Run a 3-variant offer test against one segment","loads":{"gtm_sales":3,"product_experimentation":1},"seniority_hint":"advanced"},{"key":"d","label":"I haven''t run outbound","loads":{"gtm_sales":0},"seniority_hint":"aware"}]',
   '["gtm_sales"]', 1),
  ('fo_skill_eng', 'founder_origin_v1', 'prove_it', 'sjt',
   'The MVP needs to be live in two weeks. How do you approach the build?',
   NULL,
   '[{"key":"a","label":"No-code / off-the-shelf to validate","loads":{"engineering":1,"product":1},"seniority_hint":"working"},{"key":"b","label":"Thin custom stack, ship the happy path","loads":{"engineering":3},"seniority_hint":"advanced"},{"key":"c","label":"I''d need to bring in an engineer","loads":{"engineering":0},"seniority_hint":"aware"}]',
   '["engineering"]', 2),
  ('fo_skill_finance', 'founder_origin_v1', 'prove_it', 'sjt',
   'An investor asks for your default-alive date. What do you reach for?',
   NULL,
   '[{"key":"a","label":"A live model with burn, runway and scenarios","loads":{"finance_ops":3},"seniority_hint":"advanced"},{"key":"b","label":"A rough spreadsheet of cash in / out","loads":{"finance_ops":1},"seniority_hint":"working"},{"key":"c","label":"I''d have to figure that out","loads":{"finance_ops":0},"seniority_hint":"aware"}]',
   '["finance_ops"]', 3);

-- 5h) Founder Origin — Gut Check (timed binary; same loads as dilemmas but the
--     scorer weights low-latency answers as stronger revealed preference).
INSERT OR IGNORE INTO assessment_items
  (slug, game_slug, chapter_slug, mechanic, prompt, helptext, options_json, measures_json, display_order) VALUES
  ('fo_gut_a', 'founder_origin_v1', 'gut_check', 'speed', 'Move fast and break things, or measure twice?', NULL,
   '[{"key":"a","label":"Move fast","loads":{"founder_speed_vs_quality":2}},{"key":"b","label":"Measure twice","loads":{"founder_speed_vs_quality":-2}}]',
   '["founder_speed_vs_quality"]', 1),
  ('fo_gut_b', 'founder_origin_v1', 'gut_check', 'speed', 'Big risky bet, or steady compounding?', NULL,
   '[{"key":"a","label":"Big bet","loads":{"founder_risk_appetite":2}},{"key":"b","label":"Compound","loads":{"founder_risk_appetite":-2}}]',
   '["founder_risk_appetite"]', 2),
  ('fo_gut_c', 'founder_origin_v1', 'gut_check', 'speed', 'Own less of a rocket, or more of a steady ship?', NULL,
   '[{"key":"a","label":"Rocket","loads":{"founder_growth_vs_sustain":2}},{"key":"b","label":"Steady ship","loads":{"founder_growth_vs_sustain":-2}}]',
   '["founder_growth_vs_sustain"]', 3);

-- 5i) Template items for the other tracks (one each) — show the allocation and
--     dilemma mechanics so the per-track content author has a working pattern.
INSERT OR IGNORE INTO assessment_chapters
  (game_slug, slug, title, subtitle, mechanic, display_order, reward_badge_slug, config_json) VALUES
  ('thesis_lab_v1',       'allocate', 'Build the Fund', 'Deploy $100 of conviction.',     'allocation', 1, 'thesis_locked', '{"total":100}'),
  ('operators_path_v1',   'pressure', 'Under Pressure', 'The call is yours.',             'dilemma',    1, NULL,            '{}'),
  ('partner_playbook_v1', 'scope',    'Scope It',       'Where do you create most value?','dilemma',    1, NULL,            '{}'),
  ('mentor_compass_v1',   'moment',   'The Moment',     'A founder just asked you this.',  'dilemma',    1, NULL,            '{}'),
  ('coachs_lens_v1',      'meet',     'Meet Them',      'Your founder is struggling.',     'dilemma',    1, NULL,            '{}');

INSERT OR IGNORE INTO assessment_items
  (slug, game_slug, chapter_slug, mechanic, prompt, helptext, options_json, measures_json, display_order) VALUES
  ('tl_alloc_main', 'thesis_lab_v1', 'allocate', 'allocation',
   'Split $100 across these bets the way your gut says.',
   'Allocations reveal your stage, sector and risk posture.',
   '[{"key":"preseed_ai","label":"Pre-seed AI infra","loads":{"founder_risk_appetite":2}},{"key":"seed_b2b","label":"Seed B2B SaaS","loads":{"founder_risk_appetite":0}},{"key":"a_growth","label":"Series A growth","loads":{"founder_risk_appetite":-1,"founder_growth_vs_sustain":1}},{"key":"deep_tech","label":"Deep tech / long horizon","loads":{"founder_growth_vs_sustain":-1,"founder_mission_vs_profit":1}}]',
   '["founder_risk_appetite","founder_growth_vs_sustain","founder_mission_vs_profit"]', 1),
  ('op_pressure_fire', 'operators_path_v1', 'pressure', 'dilemma',
   'A senior hire is loved by the team but consistently misses targets.',
   NULL,
   '[{"key":"a","label":"Coach hard for one more quarter","loads":{"schwartz_benevolence":1,"founder_speed_vs_quality":-1}},{"key":"b","label":"Make the change now","loads":{"founder_growth_vs_sustain":1,"schwartz_achievement":1}}]',
   '["schwartz_benevolence","schwartz_achievement","founder_growth_vs_sustain"]', 1),
  ('pp_scope_main', 'partner_playbook_v1', 'scope', 'dilemma',
   'A founder asks for help "with everything." What do you do?',
   NULL,
   '[{"key":"a","label":"Go deep on the one thing I''m best at","loads":{"schwartz_achievement":1,"founder_autonomy_vs_structure":-1}},{"key":"b","label":"Flex across whatever they need most","loads":{"founder_autonomy_vs_structure":1}}]',
   '["schwartz_achievement","founder_autonomy_vs_structure"]', 1),
  ('mc_moment_main', 'mentor_compass_v1', 'moment', 'dilemma',
   '"Should I pivot?" the founder asks. Your instinct?',
   NULL,
   '[{"key":"a","label":"Ask what the data is telling them","loads":{"founder_autonomy_vs_structure":1,"schwartz_self_direction":1}},{"key":"b","label":"Tell them what I''d do","loads":{"founder_autonomy_vs_structure":-1,"schwartz_achievement":1}}]',
   '["founder_autonomy_vs_structure","schwartz_self_direction"]', 1),
  ('cl_meet_main', 'coachs_lens_v1', 'meet', 'dilemma',
   'A founder is burned out and avoiding hard conversations.',
   NULL,
   '[{"key":"a","label":"Work on regulation and recovery first","loads":{"schwartz_security":1,"schwartz_benevolence":1}},{"key":"b","label":"Build the courage to have the conversation","loads":{"schwartz_achievement":1,"founder_risk_appetite":1}}]',
   '["schwartz_security","schwartz_benevolence","schwartz_achievement"]', 1);
