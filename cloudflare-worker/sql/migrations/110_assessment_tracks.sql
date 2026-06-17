-- 110_assessment_tracks.sql — Task #4
--
-- Seeds the remaining five assessment tracks so the engine can exercise every
-- canonical track key (operators_path_v1, thesis_lab_v1, partner_playbook_v1,
-- mentor_compass_v1, coachs_lens_v1). Each track has 12 items, 2-3 chapters,
-- 3 archetypes, and badges. All statements are INSERT OR IGNORE (UNIQUE slugs)
-- so re-application is idempotent.
--
-- Apply after 108 (wrangler needs Node 22+ — see GOTCHAS "Migrations & schema"):
--   npx wrangler d1 execute studioos-db --config wrangler.toml --remote \
--     --file=cloudflare-worker/sql/migrations/110_assessment_tracks.sql

-- ===========================================================================
-- 1) OPERATORS_PATH_V1 — for operators / execution-focused builders
-- ===========================================================================

INSERT OR IGNORE INTO assessment_games
  (slug, track, title, subtitle, description, target_role, status, version, display_order)
VALUES
  ('operators_path_v1', 'operators_path_v1', 'Operator Path',
   'How you execute, scale, and survive',
   'A set of hard operational calls that reveal how you build systems, handle pressure, trade speed for quality, and lead through execution. Ends with your Operator Report and archetype.',
   'operator', 'published', 1, 2);

-- Chapters
INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'execution', 'Execution', 'How you ship and scale.', 1
  FROM assessment_games WHERE slug = 'operators_path_v1';
INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'resilience', 'Resilience', 'How you hold up under pressure.', 2
  FROM assessment_games WHERE slug = 'operators_path_v1';
INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'report', 'Operator Report', 'Meet your operator archetype.', 3
  FROM assessment_games WHERE slug = 'operators_path_v1';

-- Items
INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'op_speed_quality_dilemma', 'dilemma',
  'Your team has a critical release. The code is functional but not polished.',
  'What do you do?',
  '{"options":[{"key":"ship","label":"Ship now and iterate in production","loads":{"founder_speed_vs_quality":2,"engineering":1,"product":1}},{"key":"polish","label":"Hold the release until quality is excellent","loads":{"founder_speed_vs_quality":-2,"engineering":1,"design":1}}]}',
  '{"values":["founder_speed_vs_quality"],"skills":["engineering","product","design"]}',
  '{"founder_speed_vs_quality":{"scale":2}}',
  '{}', 1
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'operators_path_v1' AND c.slug = 'execution';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'op_process_cardsort', 'card_sort',
  'Which two rituals keep you most effective?',
  'Drag your top two to the top.',
  '{"pick_n":2,"cards":[{"key":"metrics","label":"Daily metrics review and clear OKRs","loads":{"founder_autonomy_vs_structure":-2,"finance_ops":1}},{"key":"autonomy","label":"Let teams self-organize around goals","loads":{"founder_autonomy_vs_structure":2,"product":1}},{"key":"standups","label":"Strict daily standups and sprint planning","loads":{"founder_autonomy_vs_structure":-1,"engineering":1}},{"key":"deepwork","label":"Long blocks of uninterrupted deep work","loads":{"founder_autonomy_vs_structure":1,"engineering":1}}]}',
  '{"values":["founder_autonomy_vs_structure"],"skills":["finance_ops","product","engineering"]}',
  '{"founder_autonomy_vs_structure":{"scale":2}}',
  '{"pick_n":2}', 2
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'operators_path_v1' AND c.slug = 'execution';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'op_runway_allocation', 'allocation',
  'You have a surprise $200k budget. Split it.',
  'Distribute 100 points across the two.',
  '{"total":100,"buckets":[{"key":"hires","label":"Hire two senior ICs immediately","loads":{"founder_growth_vs_sustain":2,"finance_ops":1,"engineering":1}},{"key":"runway","label":"Extend runway and improve margins","loads":{"founder_growth_vs_sustain":-2,"finance_ops":1}}]}',
  '{"values":["founder_growth_vs_sustain"],"skills":["finance_ops","engineering"]}',
  '{"founder_growth_vs_sustain":{"scale":2}}',
  '{"total":100}', 3
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'operators_path_v1' AND c.slug = 'execution';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'op_system_sjt', 'sjt',
  'A core system is down. Your engineering lead says it needs a full rewrite. The team wants to patch and ship.',
  'What do you do?',
  '{"options":[{"key":"rewrite","label":"Authorize the rewrite, delay the feature","loads":{"founder_speed_vs_quality":-2,"engineering":2,"founder_risk_appetite":-1}},{"key":"patch","label":"Patch and ship, plan the rewrite for next quarter","loads":{"founder_speed_vs_quality":2,"engineering":1,"founder_risk_appetite":1}}],"confidence_wager":true}',
  '{"values":["founder_speed_vs_quality","founder_risk_appetite"],"skills":["engineering"]}',
  '{"founder_speed_vs_quality":{"scale":2},"founder_risk_appetite":{"scale":1}}',
  '{"seniority_hint":{"skill":"engineering","self_level":3}}', 4
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'operators_path_v1' AND c.slug = 'execution';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'op_pressure_speed', 'speed',
  'A key vendor just pulled out. You have 48 hours to replace them.',
  'React fast.',
  '{"timer_ms":8000,"options":[{"key":"aggressive","label":"Aggressively negotiate with three alternatives simultaneously","loads":{"founder_risk_appetite":2,"finance_ops":1}},{"key":"safe","label":"Go with the safest fallback, even if more expensive","loads":{"founder_risk_appetite":-2,"finance_ops":1}}]}',
  '{"values":["founder_risk_appetite"],"skills":["finance_ops"]}',
  '{"founder_risk_appetite":{"scale":2}}',
  '{"timer_ms":8000}', 5
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'operators_path_v1' AND c.slug = 'resilience';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'op_achievement_dilemma', 'dilemma',
  'You have achieved a major milestone. How do you celebrate?',
  'Pick the response that feels most natural.',
  '{"options":[{"key":"team","label":"Team celebration, credit the crew","loads":{"schwartz_benevolence":2,"schwartz_achievement":1,"founder_mission_vs_profit":1}},{"key":"personal","label":"Quiet personal reflection, plan the next move","loads":{"schwartz_achievement":2,"schwartz_self_direction":1}}]}',
  '{"values":["schwartz_benevolence","schwartz_achievement","schwartz_self_direction","founder_mission_vs_profit"],"skills":[]}',
  '{"schwartz_benevolence":{"scale":2},"schwartz_achievement":{"scale":1},"founder_mission_vs_profit":{"scale":1}}',
  '{}', 6
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'operators_path_v1' AND c.slug = 'resilience';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'op_stress_sjt', 'sjt',
  'The board is losing confidence. A board member wants you to replace your CTO.',
  'Your move?',
  '{"options":[{"key":"defend","label":"Defend the CTO, present a recovery plan","loads":{"schwartz_benevolence":1,"founder_risk_appetite":1,"engineering":1}},{"key":"replace","label":"Replace the CTO to restore board confidence","loads":{"schwartz_power":1,"founder_risk_appetite":-1,"finance_ops":1}}],"confidence_wager":true}',
  '{"values":["schwartz_benevolence","schwartz_power","founder_risk_appetite"],"skills":["engineering","finance_ops"]}',
  '{"schwartz_benevolence":{"scale":1},"schwartz_power":{"scale":1},"founder_risk_appetite":{"scale":1}}',
  '{"seniority_hint":{"skill":"finance_ops","self_level":3}}', 7
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'operators_path_v1' AND c.slug = 'resilience';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'op_report_reflection', 'reflection',
  'Your Operator Report',
  'Watch your radar and meet your archetype.',
  '{"reveal":"operator_report","fields":[{"key":"takeaway","label":"What surprised you most?","kind":"text","optional":true}]}',
  '{}',
  '{}',
  '{"reveal":true}', 1
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'operators_path_v1' AND c.slug = 'report';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'op_hiring_dilemma', 'dilemma',
  'You need to hire fast for a critical role. Two candidates: one is a culture fit but needs ramp-up; the other is a proven performer but may clash with the team.',
  'Who do you pick?',
  '{"options":[{"key":"culture","label":"Culture fit; invest in ramp-up","loads":{"schwartz_benevolence":1,"founder_speed_vs_quality":-1,"product":1,"engineering":1}},{"key":"performer","label":"Proven performer; manage the friction","loads":{"schwartz_achievement":2,"founder_speed_vs_quality":2,"schwartz_power":1,"engineering":1}}]}',
  '{"values":["schwartz_benevolence","schwartz_achievement","founder_speed_vs_quality","schwartz_power"],"skills":["product","engineering"]}',
  '{"schwartz_benevolence":{"scale":1},"schwartz_achievement":{"scale":2},"founder_speed_vs_quality":{"scale":2},"schwartz_power":{"scale":1}}',
  '{}', 5
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'operators_path_v1' AND c.slug = 'execution';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'op_growth_cardsort', 'card_sort',
  'Which two principles guide your growth decisions?',
  'Pick your top two.',
  '{"pick_n":2,"cards":[{"key":"growth","label":"Growth at all costs; capture the market","loads":{"founder_growth_vs_sustain":2,"schwartz_achievement":1,"gtm_sales":1}},{"key":"sustain","label":"Sustainable unit economics; never grow unprofitably","loads":{"founder_growth_vs_sustain":-2,"schwartz_security":1,"finance_ops":1}},{"key":"organic","label":"Organic growth through product excellence and word of mouth","loads":{"schwartz_self_direction":1,"founder_growth_vs_sustain":0,"product":1}},{"key":"capital","label":"Raise aggressively and deploy capital to scale fast","loads":{"schwartz_power":1,"founder_growth_vs_sustain":2,"capital_network":1}}]}',
  '{"values":["founder_growth_vs_sustain","schwartz_achievement","schwartz_security","schwartz_self_direction","schwartz_power"],"skills":["gtm_sales","finance_ops","product","capital_network"]}',
  '{"founder_growth_vs_sustain":{"scale":2},"schwartz_achievement":{"scale":1},"schwartz_security":{"scale":1},"schwartz_self_direction":{"scale":1},"schwartz_power":{"scale":1}}',
  '{"pick_n":2}', 6
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'operators_path_v1' AND c.slug = 'execution';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'op_recovery_speed', 'speed',
  'Your team just missed a major deadline. The client is angry.',
  'React fast.',
  '{"timer_ms":6000,"options":[{"key":"overdeliver","label":"Over-deliver on the next milestone to make it up","loads":{"founder_speed_vs_quality":2,"schwartz_achievement":1,"engineering":1}},{"key":"communicate","label":"Communicate transparently and reset expectations","loads":{"schwartz_benevolence":1,"founder_speed_vs_quality":-1,"schwartz_security":1,"product":1}}]}',
  '{"values":["founder_speed_vs_quality","schwartz_achievement","schwartz_benevolence","schwartz_security"],"skills":["engineering","product"]}',
  '{"founder_speed_vs_quality":{"scale":2},"schwartz_achievement":{"scale":1},"schwartz_benevolence":{"scale":1},"schwartz_security":{"scale":1}}',
  '{"timer_ms":6000}', 6
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'operators_path_v1' AND c.slug = 'resilience';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'op_team_dilemma', 'dilemma',
  'A top performer is toxic to the team. Replacing them will slow the roadmap.',
  'What do you do?',
  '{"options":[{"key":"keep","label":"Keep them; performance is the top priority","loads":{"schwartz_achievement":2,"schwartz_power":1,"founder_speed_vs_quality":2,"engineering":1}},{"key":"replace","label":"Replace them; culture is the foundation","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"founder_speed_vs_quality":-1,"product":1}}]}',
  '{"values":["schwartz_achievement","schwartz_power","schwartz_benevolence","schwartz_universalism","founder_speed_vs_quality"],"skills":["engineering","product"]}',
  '{"schwartz_achievement":{"scale":2},"schwartz_power":{"scale":1},"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1},"founder_speed_vs_quality":{"scale":2}}',
  '{}', 7
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'operators_path_v1' AND c.slug = 'resilience';

-- Archetypes
INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'operators_path_v1', 'op_executor', 'The Executor',
  'Ship fast, ship often, fix in flight.',
  'Speed-first and growth-oriented. Comfortable with risk and prefers autonomy over rigid process.',
  '{"values":{"founder_speed_vs_quality":2,"founder_risk_appetite":1,"founder_growth_vs_sustain":1,"founder_autonomy_vs_structure":2,"schwartz_achievement":1},"skills":{"engineering":3,"product":3}}',
  'op_archetype_executor', 1
FROM assessment_games WHERE slug = 'operators_path_v1';

INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'operators_path_v1', 'op_builder', 'The Builder',
  'Craft systems that last.',
  'Quality-first and risk-aware. Prefers structure, process, and sustainable building over raw speed.',
  '{"values":{"founder_speed_vs_quality":-2,"founder_risk_appetite":-1,"founder_growth_vs_sustain":-1,"founder_autonomy_vs_structure":-2,"schwartz_security":1},"skills":{"engineering":4,"design":2,"finance_ops":2}}',
  'op_archetype_builder', 2
FROM assessment_games WHERE slug = 'operators_path_v1';

INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'operators_path_v1', 'op_fixer', 'The Fixer',
  'Steady under pressure.',
  'Balanced approach: neither too fast nor too cautious. Strong on people and process. Thrives in turnaround situations.',
  '{"values":{"founder_speed_vs_quality":0,"founder_risk_appetite":0,"founder_growth_vs_sustain":0,"founder_autonomy_vs_structure":0,"schwartz_benevolence":1,"schwartz_achievement":1},"skills":{"finance_ops":3,"engineering":2,"product":2}}',
  'op_archetype_fixer', 3
FROM assessment_games WHERE slug = 'operators_path_v1';

-- Badges
INSERT OR IGNORE INTO assessment_badges
  (slug, label, description, kind, icon, criteria_json, xp_reward, display_order) VALUES
  ('op_archetype_executor', 'Executor', 'Earned by being assigned The Executor archetype.', 'archetype', 'zap',
    '{"track":"operators_path_v1","archetype":"op_executor"}', 100, 10),
  ('op_archetype_builder', 'Builder', 'Earned by being assigned The Builder archetype.', 'archetype', 'ruler',
    '{"track":"operators_path_v1","archetype":"op_builder"}', 100, 11),
  ('op_archetype_fixer', 'Fixer', 'Earned by being assigned The Fixer archetype.', 'archetype', 'shield',
    '{"track":"operators_path_v1","archetype":"op_fixer"}', 100, 12),
  ('operators_path_complete', 'Operator Certified', 'Completed the Operator Path track.', 'milestone', 'award',
    '{"event":"game_complete","track":"operators_path_v1"}', 75, 13);

-- ===========================================================================
-- 2) THESIS_LAB_V1 — for investors / LPs
-- ===========================================================================

INSERT OR IGNORE INTO assessment_games
  (slug, track, title, subtitle, description, target_role, status, version, display_order)
VALUES
  ('thesis_lab_v1', 'thesis_lab_v1', 'Thesis Lab',
   'Your conviction, your edge, your risk',
   'A series of investment calls that reveal how you form conviction, size risk, and build an edge. Ends with your Investor Thesis Report and archetype.',
   'investor_lp', 'published', 1, 3);

INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'conviction', 'Conviction', 'How you form and hold conviction.', 1
  FROM assessment_games WHERE slug = 'thesis_lab_v1';
INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'risk', 'Risk', 'How you size and manage risk.', 2
  FROM assessment_games WHERE slug = 'thesis_lab_v1';
INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'thesis_report', 'Thesis Report', 'Meet your investor archetype.', 3
  FROM assessment_games WHERE slug = 'thesis_lab_v1';

-- Items
INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'tl_conviction_dilemma', 'dilemma',
  'You have a strong thesis on a sector, but the leading company in that sector just missed earnings.',
  'What do you do?',
  '{"options":[{"key":"double","label":"Double down; the thesis is stronger now with cheaper prices","loads":{"founder_risk_appetite":2,"schwartz_self_direction":1,"capital_network":1}},{"key":"wait","label":"Wait for more data; earnings matter","loads":{"founder_risk_appetite":-1,"schwartz_security":1,"finance_ops":1}}]}',
  '{"values":["founder_risk_appetite","schwartz_self_direction","schwartz_security"],"skills":["capital_network","finance_ops"]}',
  '{"founder_risk_appetite":{"scale":2},"schwartz_self_direction":{"scale":1},"schwartz_security":{"scale":1}}',
  '{}', 1
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'thesis_lab_v1' AND c.slug = 'conviction';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'tl_thesis_cardsort', 'card_sort',
  'What drives your best investment decisions?',
  'Pick your top two.',
  '{"pick_n":2,"cards":[{"key":"pattern","label":"Pattern recognition from past cycles","loads":{"schwartz_achievement":1,"schwartz_self_direction":1,"capital_network":1}},{"key":"data","label":"Deep data and fundamental analysis","loads":{"schwartz_achievement":1,"schwartz_security":1,"finance_ops":1}},{"key":"network","label":"Network and insider access","loads":{"schwartz_power":1,"capital_network":1}},{"key":"conviction","label":"Gut conviction and founder alignment","loads":{"schwartz_self_direction":2,"schwartz_benevolence":1}}]}',
  '{"values":["schwartz_achievement","schwartz_self_direction","schwartz_security","schwartz_power","schwartz_benevolence"],"skills":["capital_network","finance_ops"]}',
  '{"schwartz_achievement":{"scale":1},"schwartz_self_direction":{"scale":1},"schwartz_security":{"scale":1},"schwartz_power":{"scale":1},"schwartz_benevolence":{"scale":1}}',
  '{"pick_n":2}', 2
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'thesis_lab_v1' AND c.slug = 'conviction';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'tl_portfolio_allocation', 'allocation',
  'You have $1M dry powder. A promising pre-seed wants $500K. Your LP wants you to hold more reserves.',
  'Split 100 points.',
  '{"total":100,"buckets":[{"key":"invest","label":"Lead the round with $500K","loads":{"founder_risk_appetite":2,"schwartz_self_direction":1,"capital_network":1}},{"key":"reserve","label":"Take $250K and keep reserves","loads":{"founder_risk_appetite":-1,"schwartz_security":1,"finance_ops":1}}]}',
  '{"values":["founder_risk_appetite","schwartz_self_direction","schwartz_security"],"skills":["capital_network","finance_ops"]}',
  '{"founder_risk_appetite":{"scale":2},"schwartz_self_direction":{"scale":1},"schwartz_security":{"scale":1}}',
  '{"total":100}', 3
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'thesis_lab_v1' AND c.slug = 'conviction';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'tl_due_diligence_sjt', 'sjt',
  'A founder you deeply respect is fundraising. Your analyst found a red flag in the cap table.',
  'How do you proceed?',
  '{"options":[{"key":"confront","label":"Confront the founder directly, seek explanation","loads":{"schwartz_benevolence":1,"founder_risk_appetite":1,"capital_network":1}},{"key":"pass","label":"Pass on the deal; red flags are non-negotiable","loads":{"schwartz_security":2,"founder_risk_appetite":-1,"finance_ops":1}}],"confidence_wager":true}',
  '{"values":["schwartz_benevolence","schwartz_security","founder_risk_appetite"],"skills":["capital_network","finance_ops"]}',
  '{"schwartz_benevolence":{"scale":1},"schwartz_security":{"scale":2},"founder_risk_appetite":{"scale":1}}',
  '{"seniority_hint":{"skill":"capital_network","self_level":3}}', 4
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'thesis_lab_v1' AND c.slug = 'risk';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'tl_market_timing_speed', 'speed',
  'A market is crashing. You have three positions to adjust.',
  'React fast.',
  '{"timer_ms":10000,"options":[{"key":"cut","label":"Cut losses immediately and reassess","loads":{"founder_risk_appetite":-2,"schwartz_security":1,"finance_ops":1}},{"key":"hold","label":"Hold and add to the strongest position","loads":{"founder_risk_appetite":2,"schwartz_self_direction":1,"capital_network":1}}]}',
  '{"values":["founder_risk_appetite","schwartz_security","schwartz_self_direction"],"skills":["finance_ops","capital_network"]}',
  '{"founder_risk_appetite":{"scale":2},"schwartz_security":{"scale":1},"schwartz_self_direction":{"scale":1}}',
  '{"timer_ms":10000}', 5
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'thesis_lab_v1' AND c.slug = 'risk';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'tl_power_dilemma', 'dilemma',
  'You have a board seat. The founder wants to do a side-project that might dilute focus.',
  'Your vote?',
  '{"options":[{"key":"support","label":"Support the founder; autonomy builds the best companies","loads":{"schwartz_self_direction":1,"schwartz_benevolence":1,"founder_autonomy_vs_structure":2}},{"key":"oppose","label":"Oppose; the charter is the charter","loads":{"schwartz_power":1,"schwartz_conformity":1,"founder_autonomy_vs_structure":-2}}]}',
  '{"values":["schwartz_self_direction","schwartz_benevolence","schwartz_power","schwartz_conformity","founder_autonomy_vs_structure"],"skills":["capital_network"]}',
  '{"schwartz_self_direction":{"scale":1},"schwartz_benevolence":{"scale":1},"schwartz_power":{"scale":1},"schwartz_conformity":{"scale":1},"founder_autonomy_vs_structure":{"scale":2}}',
  '{}', 6
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'thesis_lab_v1' AND c.slug = 'risk';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'tl_report_reflection', 'reflection',
  'Your Thesis Report',
  'Meet your investor archetype.',
  '{"reveal":"thesis_report","fields":[{"key":"edge","label":"What is your strongest edge as an investor?","kind":"text","optional":true}]}',
  '{}',
  '{}',
  '{"reveal":true}', 1
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'thesis_lab_v1' AND c.slug = 'thesis_report';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'tl_sector_cardsort', 'card_sort',
  'Which two traits matter most when you evaluate a sector?',
  'Pick your top two.',
  '{"pick_n":2,"cards":[{"key":"macro","label":"Macro tailwinds and policy momentum","loads":{"schwartz_self_direction":1,"schwartz_achievement":1,"capital_network":1}},{"key":"founder","label":"Founder quality and unique insights","loads":{"schwartz_benevolence":1,"schwartz_self_direction":2,"capital_network":1}},{"key":"moat","label":"Defensible moat and network effects","loads":{"schwartz_security":1,"schwartz_achievement":1,"finance_ops":1}},{"key":"timing","label":"Timing and market readiness","loads":{"founder_risk_appetite":1,"schwartz_self_direction":1,"gtm_sales":1}}]}',
  '{"values":["schwartz_self_direction","schwartz_achievement","schwartz_benevolence","schwartz_security","founder_risk_appetite"],"skills":["capital_network","finance_ops","gtm_sales"]}',
  '{"schwartz_self_direction":{"scale":1},"schwartz_achievement":{"scale":1},"schwartz_benevolence":{"scale":1},"schwartz_security":{"scale":1},"founder_risk_appetite":{"scale":1}}',
  '{"pick_n":2}', 5
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'thesis_lab_v1' AND c.slug = 'conviction';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'tl_lp_dilemma', 'dilemma',
  'Your LP wants quarterly distributions. You believe the best returns come from holding winners longer.',
  'What do you do?',
  '{"options":[{"key":"hold","label":"Hold and defend the long-term thesis to the LP","loads":{"schwartz_self_direction":2,"founder_risk_appetite":2,"schwartz_achievement":1,"capital_network":1}},{"key":"distribute","label":"Distribute early to preserve the LP relationship","loads":{"schwartz_benevolence":1,"schwartz_security":1,"finance_ops":1,"founder_risk_appetite":-1}}]}',
  '{"values":["schwartz_self_direction","founder_risk_appetite","schwartz_achievement","schwartz_benevolence","schwartz_security"],"skills":["capital_network","finance_ops"]}',
  '{"schwartz_self_direction":{"scale":2},"founder_risk_appetite":{"scale":2},"schwartz_achievement":{"scale":1},"schwartz_benevolence":{"scale":1},"schwartz_security":{"scale":1}}',
  '{}', 6
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'thesis_lab_v1' AND c.slug = 'conviction';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'tl_valuation_speed', 'speed',
  'A competitor just bid 2x your term sheet for a hot company. You have 15 minutes to respond.',
  'React fast.',
  '{"timer_ms":8000,"options":[{"key":"match","label":"Match the bid; losing the deal is worse than overpaying","loads":{"founder_risk_appetite":2,"schwartz_achievement":2,"founder_speed_vs_quality":2,"capital_network":1}},{"key":"walk","label":"Walk away; discipline beats FOMO","loads":{"founder_risk_appetite":-2,"schwartz_security":1,"schwartz_self_direction":1,"finance_ops":1}}]}',
  '{"values":["founder_risk_appetite","schwartz_achievement","founder_speed_vs_quality","schwartz_security","schwartz_self_direction"],"skills":["capital_network","finance_ops"]}',
  '{"founder_risk_appetite":{"scale":2},"schwartz_achievement":{"scale":2},"founder_speed_vs_quality":{"scale":2},"schwartz_security":{"scale":1},"schwartz_self_direction":{"scale":1}}',
  '{"timer_ms":8000}', 7
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'thesis_lab_v1' AND c.slug = 'risk';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'tl_reputation_allocation', 'allocation',
  'You have built a strong reputation as a disciplined investor. A high-profile deal is risky but would elevate your brand.',
  'Split 100 points.',
  '{"total":100,"buckets":[{"key":"reputation","label":"Take the deal; reputation compounds","loads":{"schwartz_achievement":2,"schwartz_power":1,"founder_risk_appetite":2,"capital_network":1}},{"key":"discipline","label":"Pass; discipline is the real brand","loads":{"schwartz_security":2,"schwartz_self_direction":1,"founder_risk_appetite":-2,"finance_ops":1}}]}',
  '{"values":["schwartz_achievement","schwartz_power","founder_risk_appetite","schwartz_security","schwartz_self_direction"],"skills":["capital_network","finance_ops"]}',
  '{"schwartz_achievement":{"scale":2},"schwartz_power":{"scale":1},"founder_risk_appetite":{"scale":2},"schwartz_security":{"scale":2},"schwartz_self_direction":{"scale":1}}',
  '{"total":100}', 8
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'thesis_lab_v1' AND c.slug = 'risk';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'tl_portfolio_dilemma', 'dilemma',
  'One portfolio company is thriving. Another is struggling. You have limited follow-on capital.',
  'What do you do?',
  '{"options":[{"key":"winner","label":"Double down on the winner; concentration creates alpha","loads":{"schwartz_achievement":2,"schwartz_self_direction":1,"founder_risk_appetite":2,"capital_network":1}},{"key":"support","label":"Support the struggling one; your commitment builds trust","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"founder_risk_appetite":-1,"finance_ops":1}}]}',
  '{"values":["schwartz_achievement","schwartz_self_direction","founder_risk_appetite","schwartz_benevolence","schwartz_universalism"],"skills":["capital_network","finance_ops"]}',
  '{"schwartz_achievement":{"scale":2},"schwartz_self_direction":{"scale":1},"founder_risk_appetite":{"scale":2},"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1}}',
  '{}', 7
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'thesis_lab_v1' AND c.slug = 'risk';

-- Archetypes
INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'thesis_lab_v1', 'tl_conviction_investor', 'The Conviction Investor',
  'Trust the thesis, bet the thesis.',
  'High autonomy, high risk appetite. Forms strong convictions and doubles down. Network-driven and pattern-matched.',
  '{"values":{"founder_risk_appetite":2,"schwartz_self_direction":2,"schwartz_achievement":1,"schwartz_power":1,"founder_autonomy_vs_structure":2},"skills":{"capital_network":3,"finance_ops":2}}',
  'tl_archetype_conviction', 1
FROM assessment_games WHERE slug = 'thesis_lab_v1';

INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'thesis_lab_v1', 'tl_thesis_builder', 'The Thesis Builder',
  'Build the edge, not just the bet.',
  'Deep analytical and data-driven. Builds conviction through fundamental work. Risk-aware but not risk-averse.',
  '{"values":{"founder_risk_appetite":0,"schwartz_self_direction":1,"schwartz_achievement":2,"schwartz_security":1,"founder_autonomy_vs_structure":0},"skills":{"finance_ops":3,"capital_network":2}}',
  'tl_archetype_thesis_builder', 2
FROM assessment_games WHERE slug = 'thesis_lab_v1';

INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'thesis_lab_v1', 'tl_risk_aware', 'The Risk-Aware Allocator',
  'Preserve capital, capture upside.',
  'Security-first, process-oriented. Balances portfolio carefully and avoids binary bets. Strong governance instincts.',
  '{"values":{"founder_risk_appetite":-2,"schwartz_self_direction":-1,"schwartz_achievement":1,"schwartz_security":2,"founder_autonomy_vs_structure":-1},"skills":{"finance_ops":3,"capital_network":1}}',
  'tl_archetype_risk_aware', 3
FROM assessment_games WHERE slug = 'thesis_lab_v1';

-- Badges
INSERT OR IGNORE INTO assessment_badges
  (slug, label, description, kind, icon, criteria_json, xp_reward, display_order) VALUES
  ('tl_archetype_conviction', 'Conviction Investor', 'Earned by being assigned The Conviction Investor archetype.', 'archetype', 'zap',
    '{"track":"thesis_lab_v1","archetype":"tl_conviction_investor"}', 100, 20),
  ('tl_archetype_thesis_builder', 'Thesis Builder', 'Earned by being assigned The Thesis Builder archetype.', 'archetype', 'book-open',
    '{"track":"thesis_lab_v1","archetype":"tl_thesis_builder"}', 100, 21),
  ('tl_archetype_risk_aware', 'Risk-Aware Allocator', 'Earned by being assigned The Risk-Aware Allocator archetype.', 'archetype', 'shield',
    '{"track":"thesis_lab_v1","archetype":"tl_risk_aware"}', 100, 22),
  ('thesis_lab_complete', 'Thesis Lab Graduate', 'Completed the Thesis Lab track.', 'milestone', 'award',
    '{"event":"game_complete","track":"thesis_lab_v1"}', 75, 23);

-- ===========================================================================
-- 3) PARTNER_PLAYBOOK_V1 — for BD / partnership builders
-- ===========================================================================

INSERT OR IGNORE INTO assessment_games
  (slug, track, title, subtitle, description, target_role, status, version, display_order)
VALUES
  ('partner_playbook_v1', 'partner_playbook_v1', 'Partner Playbook',
   'How you build bridges and close deals',
   'A set of partnership scenarios that reveal how you collaborate, negotiate, and build alliances. Ends with your Partner Report and archetype.',
   'partner', 'published', 1, 4);

INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'collaboration', 'Collaboration', 'How you work with others.', 1
  FROM assessment_games WHERE slug = 'partner_playbook_v1';
INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'dealmaking', 'Dealmaking', 'How you close.', 2
  FROM assessment_games WHERE slug = 'partner_playbook_v1';
INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'partner_report', 'Partner Report', 'Meet your partner archetype.', 3
  FROM assessment_games WHERE slug = 'partner_playbook_v1';

-- Items
INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'pp_collab_dilemma', 'dilemma',
  'A potential partner is slow to respond. Your internal team wants to build the feature instead.',
  'What do you do?',
  '{"options":[{"key":"partner","label":"Invest more time in the partnership; the leverage is worth it","loads":{"schwartz_benevolence":1,"schwartz_power":1,"capital_network":1,"gtm_sales":1}},{"key":"build","label":"Build it internally; control is better than dependency","loads":{"schwartz_self_direction":1,"schwartz_achievement":1,"engineering":1,"product":1}}]}',
  '{"values":["schwartz_benevolence","schwartz_power","schwartz_self_direction","schwartz_achievement"],"skills":["capital_network","gtm_sales","engineering","product"]}',
  '{"schwartz_benevolence":{"scale":1},"schwartz_power":{"scale":1},"schwartz_self_direction":{"scale":1},"schwartz_achievement":{"scale":1}}',
  '{}', 1
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'partner_playbook_v1' AND c.slug = 'collaboration';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'pp_trust_cardsort', 'card_sort',
  'What makes a partnership truly valuable?',
  'Pick your top two.',
  '{"pick_n":2,"cards":[{"key":"trust","label":"Deep trust and aligned values","loads":{"schwartz_benevolence":2,"schwartz_universalism":1}},{"key":"leverage","label":"Clear leverage and mutual gain","loads":{"schwartz_power":1,"schwartz_achievement":1,"capital_network":1}},{"key":"speed","label":"Speed to market and execution","loads":{"founder_speed_vs_quality":1,"gtm_sales":1}},{"key":"stability","label":"Long-term stability and contractual clarity","loads":{"schwartz_security":1,"schwartz_conformity":1,"legal_compliance":1}}]}',
  '{"values":["schwartz_benevolence","schwartz_universalism","schwartz_power","schwartz_achievement","founder_speed_vs_quality","schwartz_security","schwartz_conformity"],"skills":["capital_network","gtm_sales","legal_compliance"]}',
  '{"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1},"schwartz_power":{"scale":1},"schwartz_achievement":{"scale":1},"founder_speed_vs_quality":{"scale":1},"schwartz_security":{"scale":1},"schwartz_conformity":{"scale":1}}',
  '{"pick_n":2}', 2
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'partner_playbook_v1' AND c.slug = 'collaboration';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'pp_deal_allocation', 'allocation',
  'A partnership deal gives you $50K in value. You can reinvest in the relationship or bank the gain.',
  'Split 100 points.',
  '{"total":100,"buckets":[{"key":"reinvest","label":"Reinvest in the partnership to deepen it","loads":{"schwartz_benevolence":2,"capital_network":1,"gtm_sales":1}},{"key":"bank","label":"Bank the gain and move to the next deal","loads":{"schwartz_achievement":2,"schwartz_power":1,"finance_ops":1}}]}',
  '{"values":["schwartz_benevolence","schwartz_achievement","schwartz_power"],"skills":["capital_network","gtm_sales","finance_ops"]}',
  '{"schwartz_benevolence":{"scale":2},"schwartz_achievement":{"scale":2},"schwartz_power":{"scale":1}}',
  '{"total":100}', 3
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'partner_playbook_v1' AND c.slug = 'collaboration';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'pp_negotiation_sjt', 'sjt',
  'The partner wants exclusivity. Your team wants the option to work with their competitor.',
  'Your move?',
  '{"options":[{"key":"exclusivity","label":"Grant exclusivity to secure the deal","loads":{"schwartz_benevolence":1,"founder_risk_appetite":-1,"capital_network":1,"legal_compliance":1}},{"key":"open","label":"Keep it open; competition drives better terms","loads":{"schwartz_self_direction":1,"founder_risk_appetite":1,"gtm_sales":1}}],"confidence_wager":true}',
  '{"values":["schwartz_benevolence","schwartz_self_direction","founder_risk_appetite"],"skills":["capital_network","legal_compliance","gtm_sales"]}',
  '{"schwartz_benevolence":{"scale":1},"schwartz_self_direction":{"scale":1},"founder_risk_appetite":{"scale":1}}',
  '{"seniority_hint":{"skill":"capital_network","self_level":3}}', 4
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'partner_playbook_v1' AND c.slug = 'dealmaking';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'pp_deal_speed', 'speed',
  'A deal is stalling. The partner wants more time. Your CEO wants it closed by Friday.',
  'React fast.',
  '{"timer_ms":7000,"options":[{"key":"push","label":"Push hard for close; create urgency","loads":{"schwartz_power":1,"founder_speed_vs_quality":2,"gtm_sales":1}},{"key":"accommodate","label":"Accommodate the partner; trust builds deals","loads":{"schwartz_benevolence":1,"founder_speed_vs_quality":-1,"capital_network":1}}]}',
  '{"values":["schwartz_power","schwartz_benevolence","founder_speed_vs_quality"],"skills":["gtm_sales","capital_network"]}',
  '{"schwartz_power":{"scale":1},"schwartz_benevolence":{"scale":1},"founder_speed_vs_quality":{"scale":2}}',
  '{"timer_ms":7000}', 5
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'partner_playbook_v1' AND c.slug = 'dealmaking';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'pp_network_dilemma', 'dilemma',
  'A partner underperforms. You have a warm intro to a better alternative.',
  'What do you do?',
  '{"options":[{"key":"transition","label":"Transition gracefully; relationships matter long-term","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"capital_network":1}},{"key":"cut","label":"Cut the deal and move fast","loads":{"schwartz_achievement":1,"founder_speed_vs_quality":2,"gtm_sales":1}}]}',
  '{"values":["schwartz_benevolence","schwartz_universalism","schwartz_achievement","founder_speed_vs_quality"],"skills":["capital_network","gtm_sales"]}',
  '{"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1},"schwartz_achievement":{"scale":1},"founder_speed_vs_quality":{"scale":2}}',
  '{}', 6
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'partner_playbook_v1' AND c.slug = 'dealmaking';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'pp_report_reflection', 'reflection',
  'Your Partner Report',
  'Meet your partner archetype.',
  '{"reveal":"partner_report","fields":[{"key":"superpower","label":"What is your partnership superpower?","kind":"text","optional":true}]}',
  '{}',
  '{}',
  '{"reveal":true}', 1
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'partner_playbook_v1' AND c.slug = 'partner_report';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'pp_conflict_cardsort', 'card_sort',
  'Which two skills matter most when partnerships get tense?',
  'Pick your top two.',
  '{"pick_n":2,"cards":[{"key":"empathy","label":"Empathy and finding common ground","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"gtm_sales":1}},{"key":"assert","label":"Assertiveness and clear boundaries","loads":{"schwartz_power":1,"schwartz_achievement":1,"legal_compliance":1}},{"key":"creative","label":"Creative problem solving and alternatives","loads":{"schwartz_self_direction":1,"schwartz_achievement":1,"product":1}},{"key":"data","label":"Data-driven negotiation and fair metrics","loads":{"schwartz_security":1,"finance_ops":1,"capital_network":1}}]}',
  '{"values":["schwartz_benevolence","schwartz_universalism","schwartz_power","schwartz_achievement","schwartz_self_direction","schwartz_security"],"skills":["gtm_sales","legal_compliance","product","finance_ops","capital_network"]}',
  '{"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1},"schwartz_power":{"scale":1},"schwartz_achievement":{"scale":1},"schwartz_self_direction":{"scale":1},"schwartz_security":{"scale":1}}',
  '{"pick_n":2}', 5
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'partner_playbook_v1' AND c.slug = 'collaboration';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'pp_pricing_dilemma', 'dilemma',
  'Your partner wants to lower the price. Your team believes the value justifies the premium.',
  'What do you do?',
  '{"options":[{"key":"premium","label":"Hold the premium; value is non-negotiable","loads":{"schwartz_achievement":2,"schwartz_power":1,"founder_speed_vs_quality":2,"gtm_sales":1}},{"key":"flexible","label":"Be flexible; the relationship is the real asset","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"founder_speed_vs_quality":-1,"capital_network":1}}]}',
  '{"values":["schwartz_achievement","schwartz_power","founder_speed_vs_quality","schwartz_benevolence","schwartz_universalism"],"skills":["gtm_sales","capital_network"]}',
  '{"schwartz_achievement":{"scale":2},"schwartz_power":{"scale":1},"founder_speed_vs_quality":{"scale":2},"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1}}',
  '{}', 6
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'partner_playbook_v1' AND c.slug = 'collaboration';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'pp_escalation_speed', 'speed',
  'A partner has gone silent mid-deal. Your CEO wants an update in 10 minutes.',
  'React fast.',
  '{"timer_ms":5000,"options":[{"key":"escalate","label":"Escalate through your network; find another contact","loads":{"schwartz_power":1,"schwartz_achievement":1,"founder_speed_vs_quality":2,"capital_network":1}},{"key":"patience","label":"Wait; over-escalation can burn the relationship","loads":{"schwartz_benevolence":1,"schwartz_security":1,"founder_speed_vs_quality":-1,"gtm_sales":1}}]}',
  '{"values":["schwartz_power","schwartz_achievement","founder_speed_vs_quality","schwartz_benevolence","schwartz_security"],"skills":["capital_network","gtm_sales"]}',
  '{"schwartz_power":{"scale":1},"schwartz_achievement":{"scale":1},"founder_speed_vs_quality":{"scale":2},"schwartz_benevolence":{"scale":1},"schwartz_security":{"scale":1}}',
  '{"timer_ms":5000}', 7
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'partner_playbook_v1' AND c.slug = 'dealmaking';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'pp_channel_allocation', 'allocation',
  'A partner offers exclusive access to a new channel. It requires 6 months of deep integration work.',
  'Split 100 points.',
  '{"total":100,"buckets":[{"key":"invest","label":"Invest the integration time; exclusivity is a moat","loads":{"schwartz_achievement":2,"schwartz_security":1,"founder_speed_vs_quality":-1,"engineering":1}},{"key":"diversify","label":"Diversify across multiple lighter partnerships","loads":{"schwartz_self_direction":1,"founder_risk_appetite":1,"founder_speed_vs_quality":2,"gtm_sales":1}}]}',
  '{"values":["schwartz_achievement","schwartz_security","founder_speed_vs_quality","schwartz_self_direction","founder_risk_appetite"],"skills":["engineering","gtm_sales"]}',
  '{"schwartz_achievement":{"scale":2},"schwartz_security":{"scale":1},"founder_speed_vs_quality":{"scale":2},"schwartz_self_direction":{"scale":1},"founder_risk_appetite":{"scale":1}}',
  '{"total":100}', 8
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'partner_playbook_v1' AND c.slug = 'dealmaking';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'pp_integrity_dilemma', 'dilemma',
  'A partner asks you to share confidential info about a competitor. It could close the deal.',
  'What do you do?',
  '{"options":[{"key":"share","label":"Share selectively; business is competitive","loads":{"schwartz_power":1,"schwartz_achievement":2,"founder_speed_vs_quality":2,"legal_compliance":-1}},{"key":"refuse","label":"Refuse; integrity is the long-term currency","loads":{"schwartz_universalism":2,"schwartz_benevolence":1,"schwartz_conformity":1,"legal_compliance":1}}]}',
  '{"values":["schwartz_power","schwartz_achievement","founder_speed_vs_quality","schwartz_universalism","schwartz_benevolence","schwartz_conformity"],"skills":["legal_compliance"]}',
  '{"schwartz_power":{"scale":1},"schwartz_achievement":{"scale":2},"founder_speed_vs_quality":{"scale":2},"schwartz_universalism":{"scale":2},"schwartz_benevolence":{"scale":1},"schwartz_conformity":{"scale":1}}',
  '{}', 7
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'partner_playbook_v1' AND c.slug = 'dealmaking';

-- Archetypes
INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'partner_playbook_v1', 'pp_bridge_builder', 'The Bridge Builder',
  'Trust first, deal second.',
  'High benevolence and universalism. Builds deep, trust-based relationships. Prefers long-term stability over quick wins.',
  '{"values":{"schwartz_benevolence":2,"schwartz_universalism":1,"schwartz_security":1,"founder_speed_vs_quality":-1,"founder_risk_appetite":-1},"skills":{"capital_network":3,"gtm_sales":2}}',
  'pp_archetype_bridge', 1
FROM assessment_games WHERE slug = 'partner_playbook_v1';

INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'partner_playbook_v1', 'pp_dealmaker', 'The Dealmaker',
  'Close fast, close hard.',
  'High power and achievement orientation. Speed-first, outcome-driven. Negotiates aggressively and moves on quickly.',
  '{"values":{"schwartz_power":2,"schwartz_achievement":2,"schwartz_benevolence":-1,"founder_speed_vs_quality":2,"founder_risk_appetite":1},"skills":{"gtm_sales":3,"capital_network":2,"legal_compliance":1}}',
  'pp_archetype_dealmaker', 2
FROM assessment_games WHERE slug = 'partner_playbook_v1';

INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'partner_playbook_v1', 'pp_networker', 'The Networker',
  'Your network is your product.',
  'Balanced across values. Strong on relationships and deal flow. Comfortable with ambiguity and long cycles.',
  '{"values":{"schwartz_benevolence":1,"schwartz_power":1,"schwartz_achievement":1,"schwartz_self_direction":1,"founder_speed_vs_quality":0},"skills":{"capital_network":3,"gtm_sales":3,"finance_ops":1}}',
  'pp_archetype_networker', 3
FROM assessment_games WHERE slug = 'partner_playbook_v1';

-- Badges
INSERT OR IGNORE INTO assessment_badges
  (slug, label, description, kind, icon, criteria_json, xp_reward, display_order) VALUES
  ('pp_archetype_bridge', 'Bridge Builder', 'Earned by being assigned The Bridge Builder archetype.', 'archetype', 'heart',
    '{"track":"partner_playbook_v1","archetype":"pp_bridge_builder"}', 100, 30),
  ('pp_archetype_dealmaker', 'Dealmaker', 'Earned by being assigned The Dealmaker archetype.', 'archetype', 'sword',
    '{"track":"partner_playbook_v1","archetype":"pp_dealmaker"}', 100, 31),
  ('pp_archetype_networker', 'Networker', 'Earned by being assigned The Networker archetype.', 'archetype', 'network',
    '{"track":"partner_playbook_v1","archetype":"pp_networker"}', 100, 32),
  ('partner_playbook_complete', 'Partner Playbook Complete', 'Completed the Partner Playbook track.', 'milestone', 'award',
    '{"event":"game_complete","track":"partner_playbook_v1"}', 75, 33);

-- ===========================================================================
-- 4) MENTOR_COMPASS_V1 — for mentors / advisors
-- ===========================================================================

INSERT OR IGNORE INTO assessment_games
  (slug, track, title, subtitle, description, target_role, status, version, display_order)
VALUES
  ('mentor_compass_v1', 'mentor_compass_v1', 'Mentor Compass',
   'How you guide, challenge, and grow others',
   'A set of mentorship scenarios that reveal your guidance style, domain depth, and how you build others. Ends with your Mentor Report and archetype.',
   'mentor', 'published', 1, 5);

INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'guidance', 'Guidance', 'How you mentor.', 1
  FROM assessment_games WHERE slug = 'mentor_compass_v1';
INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'challenge', 'Challenge', 'How you push others.', 2
  FROM assessment_games WHERE slug = 'mentor_compass_v1';
INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'mentor_report', 'Mentor Report', 'Meet your mentor archetype.', 3
  FROM assessment_games WHERE slug = 'mentor_compass_v1';

-- Items
INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'mc_guidance_dilemma', 'dilemma',
  'A mentee is stuck on a strategic decision. You see a clear path but they need to learn it themselves.',
  'What do you do?',
  '{"options":[{"key":"direct","label":"Tell them the path; speed and clarity matter most","loads":{"schwartz_power":1,"schwartz_achievement":1,"founder_speed_vs_quality":2,"capital_network":1}},{"key":"socratic","label":"Ask questions and let them discover it","loads":{"schwartz_benevolence":2,"schwartz_self_direction":1,"founder_speed_vs_quality":-1,"product":1}}]}',
  '{"values":["schwartz_power","schwartz_achievement","schwartz_benevolence","schwartz_self_direction","founder_speed_vs_quality"],"skills":["capital_network","product"]}',
  '{"schwartz_power":{"scale":1},"schwartz_achievement":{"scale":1},"schwartz_benevolence":{"scale":2},"schwartz_self_direction":{"scale":1},"founder_speed_vs_quality":{"scale":2}}',
  '{}', 1
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'mentor_compass_v1' AND c.slug = 'guidance';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'mc_style_cardsort', 'card_sort',
  'What defines your mentorship style?',
  'Pick your top two.',
  '{"pick_n":2,"cards":[{"key":"challenge","label":"Challenge and push hard","loads":{"schwartz_achievement":1,"schwartz_power":1,"founder_risk_appetite":1}},{"key":"support","label":"Support and hold space","loads":{"schwartz_benevolence":2,"schwartz_universalism":1}},{"key":"teach","label":"Teach frameworks and mental models","loads":{"schwartz_self_direction":1,"schwartz_achievement":1,"product":1}},{"key":"connect","label":"Connect to people and opportunities","loads":{"schwartz_power":1,"capital_network":1}}]}',
  '{"values":["schwartz_achievement","schwartz_power","schwartz_benevolence","schwartz_universalism","schwartz_self_direction","founder_risk_appetite"],"skills":["product","capital_network"]}',
  '{"schwartz_achievement":{"scale":1},"schwartz_power":{"scale":1},"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1},"schwartz_self_direction":{"scale":1},"founder_risk_appetite":{"scale":1}}',
  '{"pick_n":2}', 2
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'mentor_compass_v1' AND c.slug = 'guidance';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'mc_time_allocation', 'allocation',
  'You have one hour with a mentee. Split it.',
  'Distribute 100 points.',
  '{"total":100,"buckets":[{"key":"deep","label":"Deep dive into one problem","loads":{"schwartz_achievement":1,"schwartz_self_direction":1,"founder_speed_vs_quality":-1,"product":1}},{"key":"breadth","label":"Broad scan across their whole business","loads":{"schwartz_benevolence":1,"schwartz_universalism":1,"founder_speed_vs_quality":1,"capital_network":1}}]}',
  '{"values":["schwartz_achievement","schwartz_self_direction","schwartz_benevolence","schwartz_universalism","founder_speed_vs_quality"],"skills":["product","capital_network"]}',
  '{"schwartz_achievement":{"scale":1},"schwartz_self_direction":{"scale":1},"schwartz_benevolence":{"scale":1},"schwartz_universalism":{"scale":1},"founder_speed_vs_quality":{"scale":1}}',
  '{"total":100}', 3
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'mentor_compass_v1' AND c.slug = 'guidance';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'mc_tough_sjt', 'sjt',
  'Your mentee wants to take a huge, risky bet. You believe it will fail.',
  'Your move?',
  '{"options":[{"key":"block","label":"Block the bet; your job is to protect them","loads":{"schwartz_security":2,"founder_risk_appetite":-2,"schwartz_benevolence":1,"finance_ops":1}},{"key":"let","label":"Let them run it; they learn from failure","loads":{"schwartz_self_direction":2,"founder_risk_appetite":2,"schwartz_achievement":1,"founder_autonomy_vs_structure":2}}],"confidence_wager":true}',
  '{"values":["schwartz_security","founder_risk_appetite","schwartz_benevolence","schwartz_self_direction","founder_autonomy_vs_structure"],"skills":["finance_ops"]}',
  '{"schwartz_security":{"scale":2},"founder_risk_appetite":{"scale":2},"schwartz_benevolence":{"scale":1},"schwartz_self_direction":{"scale":2},"founder_autonomy_vs_structure":{"scale":2}}',
  '{"seniority_hint":{"skill":"finance_ops","self_level":3}}', 4
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'mentor_compass_v1' AND c.slug = 'challenge';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'mc_feedback_speed', 'speed',
  'A mentee just made a public mistake. You need to give feedback.',
  'React fast.',
  '{"timer_ms":6000,"options":[{"key":"immediate","label":"Give immediate, direct feedback in public","loads":{"schwartz_power":1,"schwartz_achievement":1,"founder_speed_vs_quality":2,"gtm_sales":1}},{"key":"private","label":"Wait and give private, thoughtful feedback","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"founder_speed_vs_quality":-1,"capital_network":1}}]}',
  '{"values":["schwartz_power","schwartz_achievement","schwartz_benevolence","schwartz_universalism","founder_speed_vs_quality"],"skills":["gtm_sales","capital_network"]}',
  '{"schwartz_power":{"scale":1},"schwartz_achievement":{"scale":1},"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1},"founder_speed_vs_quality":{"scale":2}}',
  '{"timer_ms":6000}', 5
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'mentor_compass_v1' AND c.slug = 'challenge';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'mc_domain_dilemma', 'dilemma',
  'A mentee asks for advice outside your domain. You know someone who is an expert.',
  'What do you do?',
  '{"options":[{"key":"handoff","label":"Hand them off to the expert immediately","loads":{"schwartz_benevolence":1,"schwartz_self_direction":1,"capital_network":1}},{"key":"coach","label":"Coach them through it yourself; general mentorship matters","loads":{"schwartz_achievement":1,"schwartz_power":1,"product":1}}]}',
  '{"values":["schwartz_benevolence","schwartz_self_direction","schwartz_achievement","schwartz_power"],"skills":["capital_network","product"]}',
  '{"schwartz_benevolence":{"scale":1},"schwartz_self_direction":{"scale":1},"schwartz_achievement":{"scale":1},"schwartz_power":{"scale":1}}',
  '{}', 6
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'mentor_compass_v1' AND c.slug = 'challenge';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'mc_report_reflection', 'reflection',
  'Your Mentor Report',
  'Meet your mentor archetype.',
  '{"reveal":"mentor_report","fields":[{"key":"gift","label":"What is the greatest gift you give as a mentor?","kind":"text","optional":true}]}',
  '{}',
  '{}',
  '{"reveal":true}', 1
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'mentor_compass_v1' AND c.slug = 'mentor_report';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'mc_depth_cardsort', 'card_sort',
  'Which two traits define the most valuable mentors you have had?',
  'Pick your top two.',
  '{"pick_n":2,"cards":[{"key":"wisdom","label":"Deep wisdom and pattern recognition","loads":{"schwartz_achievement":1,"schwartz_self_direction":1,"product":1}},{"key":"care","label":"Genuine care and unconditional support","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"capital_network":1}},{"key":"challenge","label":"High expectations and pushing boundaries","loads":{"schwartz_power":1,"schwartz_achievement":1,"gtm_sales":1}},{"key":"availability","label":"Consistent availability and responsiveness","loads":{"schwartz_benevolence":1,"schwartz_security":1,"finance_ops":1}}]}',
  '{"values":["schwartz_achievement","schwartz_self_direction","schwartz_benevolence","schwartz_universalism","schwartz_power","schwartz_security"],"skills":["product","capital_network","gtm_sales","finance_ops"]}',
  '{"schwartz_achievement":{"scale":1},"schwartz_self_direction":{"scale":1},"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1},"schwartz_power":{"scale":1},"schwartz_security":{"scale":1}}',
  '{"pick_n":2}', 5
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'mentor_compass_v1' AND c.slug = 'guidance';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'mc_mentee_dilemma', 'dilemma',
  'Your mentee gets a better offer from another mentor. They ask if they should switch.',
  'What do you do?',
  '{"options":[{"key":"release","label":"Release them with grace; their growth is the goal","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"schwartz_self_direction":1,"capital_network":1}},{"key":"fight","label":"Fight for them; show the value you uniquely provide","loads":{"schwartz_achievement":2,"schwartz_power":1,"product":1}}]}',
  '{"values":["schwartz_benevolence","schwartz_universalism","schwartz_self_direction","schwartz_achievement","schwartz_power"],"skills":["capital_network","product"]}',
  '{"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1},"schwartz_self_direction":{"scale":1},"schwartz_achievement":{"scale":2},"schwartz_power":{"scale":1}}',
  '{}', 6
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'mentor_compass_v1' AND c.slug = 'guidance';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'mc_failure_speed', 'speed',
  'Your mentee just failed publicly. They are embarrassed and considering quitting.',
  'React fast.',
  '{"timer_ms":5000,"options":[{"key":"reframe","label":"Reframe the failure as data and a rite of passage","loads":{"schwartz_achievement":1,"schwartz_self_direction":1,"founder_risk_appetite":2,"gtm_sales":1}},{"key":"comfort","label":"Comfort them first; emotional safety is the foundation","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"schwartz_security":1,"capital_network":1}}]}',
  '{"values":["schwartz_achievement","schwartz_self_direction","founder_risk_appetite","schwartz_benevolence","schwartz_universalism","schwartz_security"],"skills":["gtm_sales","capital_network"]}',
  '{"schwartz_achievement":{"scale":1},"schwartz_self_direction":{"scale":1},"founder_risk_appetite":{"scale":2},"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1},"schwartz_security":{"scale":1}}',
  '{"timer_ms":5000}', 7
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'mentor_compass_v1' AND c.slug = 'challenge';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'mc_scaling_dilemma', 'dilemma',
  'Your mentorship program is growing. You can either keep it intimate and deep, or scale to reach many more founders.',
  'What do you do?',
  '{"options":[{"key":"intimate","label":"Keep it intimate; depth is the differentiator","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"founder_speed_vs_quality":-1,"capital_network":1}},{"key":"scale","label":"Scale; reach creates impact","loads":{"schwartz_achievement":2,"schwartz_power":1,"founder_speed_vs_quality":2,"marketing_brand":1}}]}',
  '{"values":["schwartz_benevolence","schwartz_universalism","founder_speed_vs_quality","schwartz_achievement","schwartz_power"],"skills":["capital_network","marketing_brand"]}',
  '{"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1},"founder_speed_vs_quality":{"scale":2},"schwartz_achievement":{"scale":2},"schwartz_power":{"scale":1}}',
  '{}', 8
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'mentor_compass_v1' AND c.slug = 'challenge';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'mc_legacy_dilemma', 'dilemma',
  'You can only mentor one more person this year. Two candidates: one is a high-potential founder with a big vision; the other is an underdog who needs you more.',
  'Who do you choose?',
  '{"options":[{"key":"founder","label":"The founder; maximize impact through scale","loads":{"schwartz_achievement":2,"schwartz_power":1,"founder_risk_appetite":2,"capital_network":1}},{"key":"underdog","label":"The underdog; your presence could change their trajectory","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"founder_risk_appetite":-1,"product":1}}]}',
  '{"values":["schwartz_achievement","schwartz_power","founder_risk_appetite","schwartz_benevolence","schwartz_universalism"],"skills":["capital_network","product"]}',
  '{"schwartz_achievement":{"scale":2},"schwartz_power":{"scale":1},"founder_risk_appetite":{"scale":2},"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1}}',
  '{}', 7
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'mentor_compass_v1' AND c.slug = 'challenge';

-- Archetypes
INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'mentor_compass_v1', 'mc_sage', 'The Sage',
  'Guide through wisdom, not instruction.',
  'High benevolence and universalism. Patient, socratic, and deeply supportive. Lets mentees discover their own path.',
  '{"values":{"schwartz_benevolence":2,"schwartz_universalism":1,"schwartz_self_direction":1,"schwartz_achievement":0,"founder_speed_vs_quality":-1,"founder_risk_appetite":0},"skills":{"product":2,"capital_network":2}}',
  'mc_archetype_sage', 1
FROM assessment_games WHERE slug = 'mentor_compass_v1';

INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'mentor_compass_v1', 'mc_challenger', 'The Challenger',
  'Push hard, grow fast.',
  'High achievement and power orientation. Direct, challenging, and sets high bars. Expects rapid growth.',
  '{"values":{"schwartz_benevolence":0,"schwartz_universalism":0,"schwartz_self_direction":1,"schwartz_achievement":2,"schwartz_power":1,"founder_speed_vs_quality":2,"founder_risk_appetite":1},"skills":{"gtm_sales":2,"capital_network":2,"product":2}}',
  'mc_archetype_challenger', 2
FROM assessment_games WHERE slug = 'mentor_compass_v1';

INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'mentor_compass_v1', 'mc_domain_expert', 'The Domain Expert',
  'Deep craft, targeted advice.',
  'Self-directed and achievement-oriented. Brings deep domain expertise. Gives specific, actionable advice in their lane.',
  '{"values":{"schwartz_benevolence":1,"schwartz_universalism":0,"schwartz_self_direction":2,"schwartz_achievement":1,"schwartz_power":0,"founder_speed_vs_quality":0,"founder_risk_appetite":0},"skills":{"engineering":3,"product":3,"design":2}}',
  'mc_archetype_domain_expert', 3
FROM assessment_games WHERE slug = 'mentor_compass_v1';

-- Badges
INSERT OR IGNORE INTO assessment_badges
  (slug, label, description, kind, icon, criteria_json, xp_reward, display_order) VALUES
  ('mc_archetype_sage', 'The Sage', 'Earned by being assigned The Sage archetype.', 'archetype', 'compass',
    '{"track":"mentor_compass_v1","archetype":"mc_sage"}', 100, 40),
  ('mc_archetype_challenger', 'The Challenger', 'Earned by being assigned The Challenger archetype.', 'archetype', 'zap',
    '{"track":"mentor_compass_v1","archetype":"mc_challenger"}', 100, 41),
  ('mc_archetype_domain_expert', 'Domain Expert', 'Earned by being assigned The Domain Expert archetype.', 'archetype', 'book-open',
    '{"track":"mentor_compass_v1","archetype":"mc_domain_expert"}', 100, 42),
  ('mentor_compass_complete', 'Mentor Compass Complete', 'Completed the Mentor Compass track.', 'milestone', 'award',
    '{"event":"game_complete","track":"mentor_compass_v1"}', 75, 43);

-- ===========================================================================
-- 5) COACHS_LENS_V1 — for coaches / growth facilitators
-- ===========================================================================

INSERT OR IGNORE INTO assessment_games
  (slug, track, title, subtitle, description, target_role, status, version, display_order)
VALUES
  ('coachs_lens_v1', 'coachs_lens_v1', "Coach's Lens",
   'How you see, grow, and unlock others',
   'A set of coaching scenarios that reveal your presence, growth orientation, and how you unlock potential. Ends with your Coach Report and archetype.',
   'coach', 'published', 1, 6);

INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'presence', 'Presence', 'How you show up.', 1
  FROM assessment_games WHERE slug = 'coachs_lens_v1';
INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'growth', 'Growth', 'How you unlock growth.', 2
  FROM assessment_games WHERE slug = 'coachs_lens_v1';
INSERT OR IGNORE INTO assessment_chapters (game_id, slug, title, description, display_order)
SELECT id, 'coach_report', 'Coach Report', 'Meet your coach archetype.', 3
  FROM assessment_games WHERE slug = 'coachs_lens_v1';

-- Items
INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'cl_presence_dilemma', 'dilemma',
  'A client is emotional and stuck. You have a clear framework that could help, but they need to feel heard first.',
  'What do you do?',
  '{"options":[{"key":"framework","label":"Share the framework immediately; it will ground them","loads":{"schwartz_achievement":1,"schwartz_self_direction":1,"founder_speed_vs_quality":2,"product":1}},{"key":"hold","label":"Hold space, listen deeply, then offer the framework","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"founder_speed_vs_quality":-1,"gtm_sales":1}}]}',
  '{"values":["schwartz_achievement","schwartz_self_direction","schwartz_benevolence","schwartz_universalism","founder_speed_vs_quality"],"skills":["product","gtm_sales"]}',
  '{"schwartz_achievement":{"scale":1},"schwartz_self_direction":{"scale":1},"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1},"founder_speed_vs_quality":{"scale":2}}',
  '{}', 1
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'coachs_lens_v1' AND c.slug = 'presence';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'cl_style_cardsort', 'card_sort',
  'What defines your coaching presence?',
  'Pick your top two.',
  '{"pick_n":2,"cards":[{"key":"warmth","label":"Warmth and unconditional positive regard","loads":{"schwartz_benevolence":2,"schwartz_universalism":1}},{"key":"clarity","label":"Clarity and sharp insight","loads":{"schwartz_achievement":1,"schwartz_self_direction":1,"product":1}},{"key":"challenge","label":"Challenge and high expectations","loads":{"schwartz_power":1,"schwartz_achievement":1,"gtm_sales":1}},{"key":"patience","label":"Patience and long-term presence","loads":{"schwartz_security":1,"schwartz_benevolence":1,"capital_network":1}}]}',
  '{"values":["schwartz_benevolence","schwartz_universalism","schwartz_achievement","schwartz_self_direction","schwartz_power","schwartz_security"],"skills":["product","gtm_sales","capital_network"]}',
  '{"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1},"schwartz_achievement":{"scale":1},"schwartz_self_direction":{"scale":1},"schwartz_power":{"scale":1},"schwartz_security":{"scale":1}}',
  '{"pick_n":2}', 2
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'coachs_lens_v1' AND c.slug = 'presence';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'cl_energy_allocation', 'allocation',
  'You have 10 coaching sessions this month. Split your energy.',
  'Distribute 100 points.',
  '{"total":100,"buckets":[{"key":"deep","label":"Deep 1:1 transformation work with a few clients","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"founder_speed_vs_quality":-1,"gtm_sales":1}},{"key":"broad","label":"Broad group work and scalable programs","loads":{"schwartz_achievement":2,"schwartz_power":1,"founder_speed_vs_quality":1,"marketing_brand":1}}]}',
  '{"values":["schwartz_benevolence","schwartz_universalism","schwartz_achievement","schwartz_power","founder_speed_vs_quality"],"skills":["gtm_sales","marketing_brand"]}',
  '{"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1},"schwartz_achievement":{"scale":2},"schwartz_power":{"scale":1},"founder_speed_vs_quality":{"scale":1}}',
  '{"total":100}', 3
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'coachs_lens_v1' AND c.slug = 'presence';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'cl_growth_sjt', 'sjt',
  'A client is plateauing. They are comfortable but not growing.',
  'Your move?',
  '{"options":[{"key":"disrupt","label":"Disrupt their comfort zone; growth requires discomfort","loads":{"schwartz_power":1,"founder_risk_appetite":2,"schwartz_achievement":1,"gtm_sales":1}},{"key":"nurture","label":"Nurture their pace; trust the process","loads":{"schwartz_benevolence":2,"schwartz_security":1,"founder_risk_appetite":-1,"capital_network":1}}],"confidence_wager":true}',
  '{"values":["schwartz_power","founder_risk_appetite","schwartz_achievement","schwartz_benevolence","schwartz_security"],"skills":["gtm_sales","capital_network"]}',
  '{"schwartz_power":{"scale":1},"founder_risk_appetite":{"scale":2},"schwartz_achievement":{"scale":1},"schwartz_benevolence":{"scale":2},"schwartz_security":{"scale":1}}',
  '{"seniority_hint":{"skill":"gtm_sales","self_level":3}}', 4
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'coachs_lens_v1' AND c.slug = 'growth';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'cl_boundary_speed', 'speed',
  'A client wants to become a friend. You sense it might blur the coaching relationship.',
  'React fast.',
  '{"timer_ms":7000,"options":[{"key":"boundary","label":"Hold the boundary; clarity is kindness","loads":{"schwartz_benevolence":1,"schwartz_conformity":1,"schwartz_security":1,"legal_compliance":1}},{"key":"friend","label":"Let it flow; authentic connection matters","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"founder_autonomy_vs_structure":2}}]}',
  '{"values":["schwartz_benevolence","schwartz_conformity","schwartz_security","schwartz_universalism","founder_autonomy_vs_structure"],"skills":["legal_compliance"]}',
  '{"schwartz_benevolence":{"scale":1},"schwartz_conformity":{"scale":1},"schwartz_security":{"scale":1},"schwartz_universalism":{"scale":1},"founder_autonomy_vs_structure":{"scale":2}}',
  '{"timer_ms":7000}', 5
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'coachs_lens_v1' AND c.slug = 'growth';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'cl_purpose_dilemma', 'dilemma',
  'A client wants to pursue something you believe is ethically questionable but legal.',
  'What do you do?',
  '{"options":[{"key":"challenge","label":"Challenge the choice; your role is to help them see consequences","loads":{"schwartz_universalism":2,"schwartz_benevolence":1,"schwartz_conformity":1,"legal_compliance":1}},{"key":"support","label":"Support their autonomy; it is their life and choice","loads":{"schwartz_self_direction":2,"schwartz_benevolence":1,"founder_autonomy_vs_structure":2}}]}',
  '{"values":["schwartz_universalism","schwartz_benevolence","schwartz_conformity","schwartz_self_direction","founder_autonomy_vs_structure"],"skills":["legal_compliance"]}',
  '{"schwartz_universalism":{"scale":2},"schwartz_benevolence":{"scale":1},"schwartz_conformity":{"scale":1},"schwartz_self_direction":{"scale":2},"founder_autonomy_vs_structure":{"scale":2}}',
  '{}', 6
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'coachs_lens_v1' AND c.slug = 'growth';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'cl_report_reflection', 'reflection',
  'Your Coach Report',
  'Meet your coach archetype.',
  '{"reveal":"coach_report","fields":[{"key":"impact","label":"What is the impact you most want to have as a coach?","kind":"text","optional":true}]}',
  '{}',
  '{}',
  '{"reveal":true}', 1
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'coachs_lens_v1' AND c.slug = 'coach_report';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'cl_coaching_cardsort', 'card_sort',
  'Which two coaching tools do you rely on most?',
  'Pick your top two.',
  '{"pick_n":2,"cards":[{"key":"questions","label":"Powerful questions that unlock insight","loads":{"schwartz_self_direction":2,"schwartz_achievement":1,"product":1}},{"key":"feedback","label":"Direct, honest feedback even when uncomfortable","loads":{"schwartz_power":1,"schwartz_achievement":1,"gtm_sales":1}},{"key":"silence","label":"Silence and space for the client to think","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"capital_network":1}},{"key":"homework","label":"Actionable homework and accountability","loads":{"schwartz_achievement":2,"schwartz_security":1,"finance_ops":1}}]}',
  '{"values":["schwartz_self_direction","schwartz_achievement","schwartz_power","schwartz_benevolence","schwartz_universalism","schwartz_security"],"skills":["product","gtm_sales","capital_network","finance_ops"]}',
  '{"schwartz_self_direction":{"scale":2},"schwartz_achievement":{"scale":1},"schwartz_power":{"scale":1},"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1},"schwartz_security":{"scale":1}}',
  '{"pick_n":2}', 5
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'coachs_lens_v1' AND c.slug = 'presence';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'cl_crisis_dilemma', 'dilemma',
  'A client is in a personal crisis. It is spilling into their work. They want to cancel sessions.',
  'What do you do?',
  '{"options":[{"key":"pause","label":"Pause the coaching; recommend professional support and stay in touch","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"schwartz_security":1,"legal_compliance":1}},{"key":"continue","label":"Continue coaching; this is exactly when they need you most","loads":{"schwartz_achievement":1,"schwartz_self_direction":1,"founder_risk_appetite":2,"gtm_sales":1}}]}',
  '{"values":["schwartz_benevolence","schwartz_universalism","schwartz_security","schwartz_achievement","schwartz_self_direction","founder_risk_appetite"],"skills":["legal_compliance","gtm_sales"]}',
  '{"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1},"schwartz_security":{"scale":1},"schwartz_achievement":{"scale":1},"schwartz_self_direction":{"scale":1},"founder_risk_appetite":{"scale":2}}',
  '{}', 6
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'coachs_lens_v1' AND c.slug = 'presence';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'cl_success_speed', 'speed',
  'Your client just hit a huge milestone. The next session is tomorrow. They want to celebrate.',
  'React fast.',
  '{"timer_ms":5000,"options":[{"key":"celebrate","label":"Celebrate hard; success builds momentum and confidence","loads":{"schwartz_achievement":2,"schwartz_power":1,"founder_speed_vs_quality":2,"marketing_brand":1}},{"key":"normalize","label":"Normalize it; the real work is the next chapter","loads":{"schwartz_self_direction":1,"schwartz_security":1,"founder_speed_vs_quality":-1,"product":1}}]}',
  '{"values":["schwartz_achievement","schwartz_power","founder_speed_vs_quality","schwartz_self_direction","schwartz_security"],"skills":["marketing_brand","product"]}',
  '{"schwartz_achievement":{"scale":2},"schwartz_power":{"scale":1},"founder_speed_vs_quality":{"scale":2},"schwartz_self_direction":{"scale":1},"schwartz_security":{"scale":1}}',
  '{"timer_ms":5000}', 7
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'coachs_lens_v1' AND c.slug = 'growth';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'cl_client_dilemma', 'dilemma',
  'A high-paying client is demanding results faster than you believe is healthy. They threaten to leave.',
  'What do you do?',
  '{"options":[{"key":"accelerate","label":"Accelerate the program; retention is a business reality","loads":{"schwartz_achievement":2,"schwartz_power":1,"founder_speed_vs_quality":2,"gtm_sales":1}},{"key":"boundary","label":"Hold the boundary; explain the science and let them decide","loads":{"schwartz_benevolence":2,"schwartz_universalism":1,"schwartz_self_direction":1,"legal_compliance":1}}]}',
  '{"values":["schwartz_achievement","schwartz_power","founder_speed_vs_quality","schwartz_benevolence","schwartz_universalism","schwartz_self_direction"],"skills":["gtm_sales","legal_compliance"]}',
  '{"schwartz_achievement":{"scale":2},"schwartz_power":{"scale":1},"founder_speed_vs_quality":{"scale":2},"schwartz_benevolence":{"scale":2},"schwartz_universalism":{"scale":1},"schwartz_self_direction":{"scale":1}}',
  '{}', 8
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'coachs_lens_v1' AND c.slug = 'growth';

INSERT OR IGNORE INTO assessment_items
  (game_id, chapter_id, slug, mechanic, prompt, subprompt, options_json, measures_json, loads_json, config_json, display_order)
SELECT g.id, c.id, 'cl_ending_dilemma', 'dilemma',
  'A client is ready to graduate. They ask you to stay on as a coach indefinitely.',
  'What do you do?',
  '{"options":[{"key":"release","label":"Release them; your job is to make them independent","loads":{"schwartz_self_direction":2,"schwartz_benevolence":1,"schwartz_universalism":1,"founder_autonomy_vs_structure":2}},{"key":"stay","label":"Stay on; long-term partnerships create compound growth","loads":{"schwartz_achievement":2,"schwartz_power":1,"capital_network":1}}]}',
  '{"values":["schwartz_self_direction","schwartz_benevolence","schwartz_universalism","founder_autonomy_vs_structure","schwartz_achievement","schwartz_power"],"skills":["capital_network"]}',
  '{"schwartz_self_direction":{"scale":2},"schwartz_benevolence":{"scale":1},"schwartz_universalism":{"scale":1},"founder_autonomy_vs_structure":{"scale":2},"schwartz_achievement":{"scale":2},"schwartz_power":{"scale":1}}',
  '{}', 7
FROM assessment_games g JOIN assessment_chapters c ON c.game_id = g.id
WHERE g.slug = 'coachs_lens_v1' AND c.slug = 'growth';

-- Archetypes
INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'coachs_lens_v1', 'cl_growth_coach', 'The Growth Coach',
  'Unlock potential through challenge.',
  'High achievement and power. Pushes clients hard. Believes growth comes from discomfort and high expectations.',
  '{"values":{"schwartz_achievement":2,"schwartz_power":1,"schwartz_benevolence":0,"schwartz_universalism":0,"founder_risk_appetite":1,"founder_speed_vs_quality":1},"skills":{"gtm_sales":3,"marketing_brand":2}}',
  'cl_archetype_growth', 1
FROM assessment_games WHERE slug = 'coachs_lens_v1';

INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'coachs_lens_v1', 'cl_purpose_coach', 'The Purpose Coach',
  'Align life with values.',
  'High benevolence, universalism, and self-direction. Helps clients find meaning and align their actions with core values.',
  '{"values":{"schwartz_achievement":0,"schwartz_power":0,"schwartz_benevolence":2,"schwartz_universalism":2,"schwartz_self_direction":1,"founder_risk_appetite":0,"founder_speed_vs_quality":0},"skills":{"capital_network":2,"product":2}}',
  'cl_archetype_purpose', 2
FROM assessment_games WHERE slug = 'coachs_lens_v1';

INSERT OR IGNORE INTO assessment_archetypes
  (game_id, track, slug, label, tagline, description, centroid_json, badge_slug, display_order)
SELECT id, 'coachs_lens_v1', 'cl_catalyst', 'The Catalyst',
  'Change the frame, change the game.',
  'Balanced across values. Brings insight and perspective shifts. Less directive, more facilitative. Sparks transformation through questions.',
  '{"values":{"schwartz_achievement":1,"schwartz_power":0,"schwartz_benevolence":1,"schwartz_universalism":1,"schwartz_self_direction":2,"founder_risk_appetite":0,"founder_speed_vs_quality":0},"skills":{"product":2,"design":2,"engineering":1}}',
  'cl_archetype_catalyst', 3
FROM assessment_games WHERE slug = 'coachs_lens_v1';

-- Badges
INSERT OR IGNORE INTO assessment_badges
  (slug, label, description, kind, icon, criteria_json, xp_reward, display_order) VALUES
  ('cl_archetype_growth', 'Growth Coach', 'Earned by being assigned The Growth Coach archetype.', 'archetype', 'zap',
    '{"track":"coachs_lens_v1","archetype":"cl_growth_coach"}', 100, 50),
  ('cl_archetype_purpose', 'Purpose Coach', 'Earned by being assigned The Purpose Coach archetype.', 'archetype', 'heart',
    '{"track":"coachs_lens_v1","archetype":"cl_purpose_coach"}', 100, 51),
  ('cl_archetype_catalyst', 'The Catalyst', 'Earned by being assigned The Catalyst archetype.', 'archetype', 'sparkles',
    '{"track":"coachs_lens_v1","archetype":"cl_catalyst"}', 100, 52),
  ('coachs_lens_complete', 'Coach\'s Lens Complete', 'Completed the Coach\'s Lens track.', 'milestone', 'award',
    '{"event":"game_complete","track":"coachs_lens_v1"}', 75, 53);
