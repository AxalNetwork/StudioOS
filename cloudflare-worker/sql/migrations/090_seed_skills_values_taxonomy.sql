-- Task #10 — Seed for the Skills & Values Taxonomy (schema in 089).
--
-- INSERT OR IGNORE keyed on the UNIQUE slug columns keeps every statement
-- idempotent: running this seed twice (or after a partial earlier run) is a
-- clean no-op. Seeds 8 radar categories, 128 skills (16 per category, well
-- over the >=120 floor), and 15 value dimensions (10 Schwartz + 5 founder).
--
-- Apply after 089:
--   npx wrangler d1 execute studioos-db --config wrangler.toml --remote \
--     --file=cloudflare-worker/sql/migrations/090_seed_skills_values_taxonomy.sql
--
-- Canonical axes/slugs/weights/seniority + legacy-12-axis mapping are
-- documented in the header of 089_skills_values_taxonomy.sql and GOTCHAS.md.

-- ---------------------------------------------------------------------------
-- 1) Skill categories — exactly the 8 canonical radar axes (is_radar_axis=1).
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO skill_categories
  (slug, label, description, is_radar_axis, radar_weight, display_order) VALUES
  ('product',          'Product',            'Discovery, roadmapping, and lifecycle ownership of what gets built.',                  1, 1.0, 1),
  ('engineering',      'Engineering',        'Building, scaling, and operating software and technical systems.',                    1, 1.0, 2),
  ('design',           'Design',             'Product, UX, visual, and brand design craft.',                                        1, 1.0, 3),
  ('gtm_sales',        'GTM / Sales',        'Go-to-market motion, selling, and revenue generation.',                               1, 1.0, 4),
  ('marketing_brand',  'Marketing / Brand',  'Demand generation, brand building, and audience growth.',                             1, 1.0, 5),
  ('finance_ops',      'Finance / Ops',      'Financial management, people ops, and running the business.',                         1, 1.0, 6),
  ('legal_compliance', 'Legal / Compliance', 'Legal structure, contracts, regulatory, and compliance.',                            1, 1.0, 7),
  ('capital_network',  'Capital / Network',  'Fundraising, capital strategy, and building the network around the company.',        1, 1.0, 8);

-- ---------------------------------------------------------------------------
-- 2) Skills — 16 per category. category_slug is the soft link to
--    skill_categories.slug. seniority_levels_json defaults to the canonical
--    5-rung ladder, so it is left unset here.
-- ---------------------------------------------------------------------------

-- Product
INSERT OR IGNORE INTO skills (slug, category_slug, label, description, display_order) VALUES
  ('product_discovery',        'product', 'Product Discovery',           'Identifying and validating problems worth solving.',                 1),
  ('product_roadmapping',      'product', 'Roadmapping & Prioritization','Sequencing work against goals and constraints.',                     2),
  ('product_user_research',    'product', 'User Research',               'Generative and evaluative research with users.',                     3),
  ('product_requirements',     'product', 'Requirements & PRDs',         'Translating intent into clear specs and acceptance criteria.',       4),
  ('product_analytics',        'product', 'Product Analytics',           'Instrumentation, funnels, and metric-driven decisions.',             5),
  ('product_experimentation',  'product', 'A/B Testing & Experimentation','Designing and reading controlled experiments.',                    6),
  ('product_ux_strategy',      'product', 'UX Strategy',                 'Shaping end-to-end product experience and flows.',                   7),
  ('product_growth',           'product', 'Growth Product',              'Activation, retention, and monetization loops.',                     8),
  ('product_pricing_packaging','product', 'Pricing & Packaging',         'Designing tiers, packaging, and willingness-to-pay.',                9),
  ('product_management_b2b',   'product', 'B2B Product Management',      'Managing products sold to and used by businesses.',                 10),
  ('product_management_b2c',   'product', 'B2C Product Management',      'Managing high-volume consumer products.',                           11),
  ('product_platform',         'product', 'Platform / API Product',      'Owning platform, API, and developer-facing surfaces.',              12),
  ('product_data',             'product', 'Data Product Management',     'Productizing data assets and pipelines.',                           13),
  ('product_ai',               'product', 'AI / ML Product Management',  'Shaping ML-powered features and their UX.',                         14),
  ('product_marketplace',      'product', 'Marketplace Product',         'Balancing supply and demand in two-sided products.',                15),
  ('product_ops',              'product', 'Product Operations',          'Process, tooling, and rituals that keep product teams effective.',  16);

-- Engineering
INSERT OR IGNORE INTO skills (slug, category_slug, label, description, display_order) VALUES
  ('eng_frontend',             'engineering', 'Frontend Engineering',        'Building responsive, accessible web UIs.',                       1),
  ('eng_backend',              'engineering', 'Backend Engineering',         'Designing services, APIs, and business logic.',                  2),
  ('eng_fullstack',            'engineering', 'Full-Stack Engineering',      'Owning features end to end across the stack.',                   3),
  ('eng_mobile',               'engineering', 'Mobile Engineering',          'Native and cross-platform mobile app development.',              4),
  ('eng_devops',               'engineering', 'DevOps & CI/CD',              'Build pipelines, automation, and release engineering.',          5),
  ('eng_cloud_infra',          'engineering', 'Cloud Infrastructure',        'Provisioning and operating cloud infrastructure.',               6),
  ('eng_data_engineering',     'engineering', 'Data Engineering',            'Pipelines, warehouses, and data platform work.',                 7),
  ('eng_ml',                   'engineering', 'Machine Learning Engineering','Training, serving, and operating ML models.',                    8),
  ('eng_security',             'engineering', 'Security Engineering',        'Application and infrastructure security.',                       9),
  ('eng_databases',            'engineering', 'Databases & Data Modeling',   'Schema design, query tuning, and storage choices.',             10),
  ('eng_distributed_systems',  'engineering', 'Distributed Systems',         'Designing scalable, fault-tolerant systems.',                   11),
  ('eng_qa_automation',        'engineering', 'QA & Test Automation',        'Test strategy and automated quality gates.',                    12),
  ('eng_architecture',         'engineering', 'Software Architecture',       'High-level system design and technical tradeoffs.',             13),
  ('eng_embedded',             'engineering', 'Embedded / Firmware',         'Software for hardware and constrained devices.',                 14),
  ('eng_site_reliability',     'engineering', 'Site Reliability Engineering','Reliability, observability, and incident response.',            15),
  ('eng_api_design',           'engineering', 'API Design',                  'Designing clean, durable, well-documented APIs.',               16);

-- Design
INSERT OR IGNORE INTO skills (slug, category_slug, label, description, display_order) VALUES
  ('design_product',           'design', 'Product Design',             'End-to-end design of product features and flows.',               1),
  ('design_ui',                'design', 'UI Design',                  'Crafting clear, polished interface layers.',                     2),
  ('design_ux_research',       'design', 'UX Research',                'Studying users to inform design decisions.',                     3),
  ('design_interaction',       'design', 'Interaction Design',         'Designing behavior, states, and micro-interactions.',            4),
  ('design_visual',            'design', 'Visual Design',              'Typography, color, layout, and visual hierarchy.',               5),
  ('design_brand_identity',    'design', 'Brand Identity Design',      'Logos, identity systems, and brand expression.',                 6),
  ('design_motion',            'design', 'Motion Design',              'Animation and motion to support usability and delight.',         7),
  ('design_prototyping',       'design', 'Prototyping',                'Building interactive prototypes to test ideas.',                 8),
  ('design_design_systems',    'design', 'Design Systems',             'Reusable components, tokens, and design governance.',            9),
  ('design_information_arch',  'design', 'Information Architecture',   'Structuring content, navigation, and taxonomy.',                10),
  ('design_accessibility',     'design', 'Accessibility (a11y)',       'Designing for inclusive, accessible experiences.',              11),
  ('design_service',           'design', 'Service Design',             'Designing across touchpoints and back-stage processes.',        12),
  ('design_3d',                'design', '3D & Spatial Design',        '3D, AR/VR, and spatial interface design.',                      13),
  ('design_content',           'design', 'Content Design / UX Writing','Words, voice, and content within the product.',                 14),
  ('design_graphic',           'design', 'Graphic Design',             'Marketing, print, and graphic asset creation.',                 15),
  ('design_illustration',      'design', 'Illustration',               'Custom illustration and visual storytelling.',                  16);

-- GTM / Sales
INSERT OR IGNORE INTO skills (slug, category_slug, label, description, display_order) VALUES
  ('gtm_sales_strategy',       'gtm_sales', 'Sales Strategy',              'Designing the overall sales motion and model.',               1),
  ('gtm_outbound',             'gtm_sales', 'Outbound / Prospecting',      'Sourcing and qualifying new opportunities.',                  2),
  ('gtm_inbound',              'gtm_sales', 'Inbound Sales',               'Converting inbound interest into pipeline.',                  3),
  ('gtm_enterprise_sales',     'gtm_sales', 'Enterprise / Field Sales',    'Complex, multi-stakeholder enterprise deals.',                4),
  ('gtm_smb_sales',            'gtm_sales', 'SMB Sales',                   'High-velocity sales to small and mid-market.',                5),
  ('gtm_sales_ops',            'gtm_sales', 'Sales Operations',            'Process, tooling, and forecasting for sales.',                6),
  ('gtm_account_management',   'gtm_sales', 'Account Management',          'Growing and retaining existing accounts.',                    7),
  ('gtm_customer_success',     'gtm_sales', 'Customer Success',            'Driving adoption, value, and renewals.',                      8),
  ('gtm_partnerships',         'gtm_sales', 'Channel & Partnerships',      'Reselling, alliances, and channel sales.',                    9),
  ('gtm_revenue_ops',          'gtm_sales', 'Revenue Operations',          'Aligning sales, marketing, and CS systems.',                 10),
  ('gtm_negotiation',          'gtm_sales', 'Deal Negotiation',            'Structuring and closing commercial terms.',                  11),
  ('gtm_sales_enablement',     'gtm_sales', 'Sales Enablement',            'Equipping reps with content, training, and tools.',          12),
  ('gtm_pipeline_mgmt',        'gtm_sales', 'Pipeline Management',         'Managing and forecasting deal pipeline.',                    13),
  ('gtm_solutions_eng',        'gtm_sales', 'Solutions / Sales Engineering','Technical pre-sales and solution scoping.',                  14),
  ('gtm_market_entry',         'gtm_sales', 'Go-to-Market Strategy',       'Planning launches and new-market entry.',                    15),
  ('gtm_plg',                  'gtm_sales', 'Product-Led Growth',          'Self-serve, product-driven acquisition motions.',            16);

-- Marketing / Brand
INSERT OR IGNORE INTO skills (slug, category_slug, label, description, display_order) VALUES
  ('mkt_brand_strategy',       'marketing_brand', 'Brand Strategy',         'Positioning, narrative, and brand architecture.',           1),
  ('mkt_content',              'marketing_brand', 'Content Marketing',      'Editorial, blogs, and content-led demand.',                 2),
  ('mkt_seo',                  'marketing_brand', 'SEO',                    'Organic search strategy and optimization.',                 3),
  ('mkt_sem',                  'marketing_brand', 'SEM / Paid Search',      'Paid search acquisition and bidding.',                      4),
  ('mkt_paid_social',          'marketing_brand', 'Paid Social',            'Paid acquisition on social platforms.',                     5),
  ('mkt_lifecycle',            'marketing_brand', 'Lifecycle / Email',      'Email, CRM, and lifecycle automation.',                     6),
  ('mkt_demand_gen',           'marketing_brand', 'Demand Generation',      'Multi-channel pipeline and demand programs.',               7),
  ('mkt_product_marketing',    'marketing_brand', 'Product Marketing',      'Messaging, launches, and competitive positioning.',         8),
  ('mkt_pr_comms',             'marketing_brand', 'PR & Communications',    'Press, analyst relations, and corporate comms.',            9),
  ('mkt_social_media',         'marketing_brand', 'Social Media',           'Organic social presence and engagement.',                  10),
  ('mkt_community',            'marketing_brand', 'Community Marketing',    'Building and nurturing communities.',                      11),
  ('mkt_growth_marketing',     'marketing_brand', 'Growth Marketing',      'Experiment-driven acquisition and retention.',             12),
  ('mkt_analytics',            'marketing_brand', 'Marketing Analytics',    'Attribution, reporting, and channel ROI.',                 13),
  ('mkt_events',               'marketing_brand', 'Events & Field',         'Conferences, webinars, and field marketing.',              14),
  ('mkt_influencer',           'marketing_brand', 'Influencer Marketing',   'Creator and influencer partnerships.',                     15),
  ('mkt_copywriting',          'marketing_brand', 'Copywriting',            'Persuasive marketing and conversion copy.',                16);

-- Finance / Ops
INSERT OR IGNORE INTO skills (slug, category_slug, label, description, display_order) VALUES
  ('finops_financial_modeling','finance_ops', 'Financial Modeling',     'Building forecasts and operating models.',                  1),
  ('finops_accounting',        'finance_ops', 'Accounting',             'Bookkeeping, close, and financial statements.',             2),
  ('finops_fpna',              'finance_ops', 'FP&A',                   'Planning, budgeting, and variance analysis.',               3),
  ('finops_fundraising_fin',   'finance_ops', 'Fundraising Finance',    'Diligence-ready financials and data rooms.',                4),
  ('finops_treasury',          'finance_ops', 'Treasury & Cash',        'Cash management, runway, and banking.',                     5),
  ('finops_tax',               'finance_ops', 'Tax',                    'Corporate tax planning and filings.',                       6),
  ('finops_payroll',           'finance_ops', 'Payroll & Benefits',     'Payroll, equity admin, and benefits.',                      7),
  ('finops_people_ops',        'finance_ops', 'People Ops / HR',        'Hiring ops, performance, and culture systems.',             8),
  ('finops_audit_controls',    'finance_ops', 'Internal Controls & Audit','Controls, audit readiness, and risk management.',          9),
  ('finops_business_ops',      'finance_ops', 'Business Operations',    'Cross-functional ops and special projects.',               10),
  ('finops_supply_chain',      'finance_ops', 'Supply Chain & Logistics','Sourcing, inventory, and fulfillment.',                    11),
  ('finops_procurement',       'finance_ops', 'Procurement',            'Vendor selection, contracts, and spend.',                  12),
  ('finops_metrics_reporting', 'finance_ops', 'Metrics & Reporting',    'KPI dashboards and board reporting.',                      13),
  ('finops_unit_economics',    'finance_ops', 'Unit Economics',         'CAC, LTV, margins, and contribution analysis.',            14),
  ('finops_strategic_finance', 'finance_ops', 'Strategic Finance',      'Scenario planning and capital allocation.',                15),
  ('finops_office_admin',      'finance_ops', 'Office & Admin Ops',     'Facilities, admin, and operational logistics.',            16);

-- Legal / Compliance
INSERT OR IGNORE INTO skills (slug, category_slug, label, description, display_order) VALUES
  ('legal_corporate',          'legal_compliance', 'Corporate / Entity Formation','Incorporation, governance, and entity structure.',     1),
  ('legal_contracts',          'legal_compliance', 'Commercial Contracts',      'Drafting and negotiating commercial agreements.',       2),
  ('legal_ip',                 'legal_compliance', 'Intellectual Property',     'Patents, trademarks, and IP strategy.',                 3),
  ('legal_employment',         'legal_compliance', 'Employment Law',            'Hiring, equity, and employment compliance.',            4),
  ('legal_privacy',            'legal_compliance', 'Privacy & Data Protection', 'GDPR, CCPA, and data-protection compliance.',           5),
  ('legal_securities',         'legal_compliance', 'Securities Law',            'Fundraising, equity, and securities compliance.',       6),
  ('legal_regulatory',         'legal_compliance', 'Regulatory Affairs',        'Sector-specific regulatory strategy.',                  7),
  ('legal_compliance_program', 'legal_compliance', 'Compliance Programs',       'Building and running compliance programs.',             8),
  ('legal_data_governance',    'legal_compliance', 'Data Governance',           'Data policy, retention, and stewardship.',              9),
  ('legal_litigation',         'legal_compliance', 'Litigation & Disputes',     'Managing disputes and litigation risk.',               10),
  ('legal_ma',                 'legal_compliance', 'M&A / Transactions',        'Legal work for mergers and acquisitions.',             11),
  ('legal_licensing',          'legal_compliance', 'Licensing & Permits',       'Business licensing and permitting.',                   12),
  ('legal_tax_law',            'legal_compliance', 'Tax Law',                   'Tax structuring and legal tax matters.',               13),
  ('legal_aml_kyc',            'legal_compliance', 'AML / KYC',                 'Anti-money-laundering and KYC compliance.',            14),
  ('legal_open_source',        'legal_compliance', 'Open-Source Licensing',     'OSS license compliance and policy.',                   15),
  ('legal_terms_policy',       'legal_compliance', 'Terms & Policy Drafting',   'Drafting ToS, privacy, and user policies.',            16);

-- Capital / Network
INSERT OR IGNORE INTO skills (slug, category_slug, label, description, display_order) VALUES
  ('cap_fundraising',          'capital_network', 'Fundraising / Pitching',    'Raising rounds and pitching investors.',               1),
  ('cap_investor_relations',   'capital_network', 'Investor Relations',        'Managing investor updates and relationships.',         2),
  ('cap_venture_capital',      'capital_network', 'Venture Capital',           'VC investing, sourcing, and diligence.',               3),
  ('cap_angel_investing',      'capital_network', 'Angel Investing',           'Early-stage angel investing and syndicates.',          4),
  ('cap_corporate_dev',        'capital_network', 'Corporate Development',     'Inorganic growth, M&A sourcing, and deals.',           5),
  ('cap_debt_financing',       'capital_network', 'Debt & Venture Debt',       'Debt facilities and venture-debt structuring.',        6),
  ('cap_grants_nondilutive',   'capital_network', 'Grants & Non-Dilutive',     'Grants, credits, and non-dilutive funding.',           7),
  ('cap_cap_table',            'capital_network', 'Cap Table Management',      'Equity, ownership, and cap-table hygiene.',            8),
  ('cap_board_governance',     'capital_network', 'Board & Governance',        'Board management and corporate governance.',           9),
  ('cap_talent_network',       'capital_network', 'Talent Sourcing & Recruiting','Sourcing and recruiting key hires.',                  10),
  ('cap_advisor_network',      'capital_network', 'Advisor & Mentor Network',  'Building and leveraging advisors and mentors.',        11),
  ('cap_bd_partnerships',      'capital_network', 'BD Partnerships',           'Strategic business-development partnerships.',         12),
  ('cap_ecosystem',            'capital_network', 'Ecosystem Building',        'Building community and ecosystem presence.',           13),
  ('cap_press_relations',      'capital_network', 'Press & Media Relations',   'Cultivating press and media relationships.',           14),
  ('cap_lp_relations',         'capital_network', 'LP Relations',              'Limited-partner relationships and reporting.',         15),
  ('cap_strategic_alliances',  'capital_network', 'Strategic Alliances',       'High-leverage strategic alliances.',                   16);

-- ---------------------------------------------------------------------------
-- 3) Value dimensions — 10 Schwartz (unipolar) + 5 founder-specific (bipolar).
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO value_dimensions
  (slug, label, description, family, is_bipolar, pole_low, pole_high, display_order) VALUES
  -- Schwartz basic human values (unipolar importance).
  ('schwartz_self_direction', 'Self-Direction', 'Independent thought and action; choosing and exploring.',          'schwartz', 0, NULL, NULL, 1),
  ('schwartz_stimulation',    'Stimulation',    'Excitement, novelty, and challenge in life.',                      'schwartz', 0, NULL, NULL, 2),
  ('schwartz_hedonism',       'Hedonism',       'Pleasure and sensuous gratification for oneself.',                 'schwartz', 0, NULL, NULL, 3),
  ('schwartz_achievement',    'Achievement',    'Personal success through demonstrating competence.',               'schwartz', 0, NULL, NULL, 4),
  ('schwartz_power',          'Power',          'Social status, prestige, and control over people and resources.',  'schwartz', 0, NULL, NULL, 5),
  ('schwartz_security',       'Security',       'Safety, harmony, and stability of self and society.',              'schwartz', 0, NULL, NULL, 6),
  ('schwartz_conformity',     'Conformity',     'Restraint of actions that may violate norms or expectations.',     'schwartz', 0, NULL, NULL, 7),
  ('schwartz_tradition',      'Tradition',      'Respect and commitment to customs and ideas of one''s culture.',   'schwartz', 0, NULL, NULL, 8),
  ('schwartz_benevolence',    'Benevolence',    'Preserving and enhancing the welfare of close others.',            'schwartz', 0, NULL, NULL, 9),
  ('schwartz_universalism',   'Universalism',   'Understanding, tolerance, and protection of all people and nature.','schwartz',0, NULL, NULL, 10),
  -- Founder-specific spectrums (bipolar pole_low <-> pole_high).
  ('founder_mission_vs_profit',     'Mission vs. Profit',         'Where the founder anchors between mission and financial return.',       'founder', 1, 'Profit-First',      'Mission-First',     11),
  ('founder_speed_vs_quality',      'Speed vs. Quality',          'Preference for shipping fast versus polishing before release.',         'founder', 1, 'Quality-First',     'Speed-First',       12),
  ('founder_risk_appetite',         'Risk Appetite',              'Comfort with risk and uncertainty in decisions.',                      'founder', 1, 'Risk-Averse',       'Risk-Seeking',      13),
  ('founder_growth_vs_sustain',     'Growth vs. Sustainability',  'Bias toward aggressive growth versus durable, sustainable building.',   'founder', 1, 'Sustainable',       'Hyper-Growth',      14),
  ('founder_autonomy_vs_structure', 'Autonomy vs. Structure',     'Preference for flexible autonomy versus defined process and structure.','founder', 1, 'Process & Structure','Autonomy & Flex',  15);
