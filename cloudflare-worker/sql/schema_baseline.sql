-- Production D1 schema baseline for studioos-db, extracted on 2026-09-08.
-- This replaces cloudflare-worker/sql/schema.sql as the starting schema for a new database.
-- Regenerate from the live sqlite_master metadata query; do not hand-edit this file.
CREATE TABLE _capital_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE _cf_KV (
        key TEXT PRIMARY KEY,
        value BLOB
      ) WITHOUT ROWID;

CREATE TABLE _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE _migrations_applied (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE academy_lessons (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         slug TEXT UNIQUE,
         title TEXT NOT NULL,
         summary TEXT,
         body TEXT,
         created_at TEXT DEFAULT (datetime('now')),
         updated_at TEXT DEFAULT (datetime('now'))
       );

CREATE TABLE account_subscriptions (
  user_id INTEGER PRIMARY KEY,
  plan_group TEXT,
  plan TEXT,
  status TEXT NOT NULL DEFAULT 'free',
  subscription_id TEXT,
  period_end TEXT,
  trial_end TEXT,
  stripe_customer_id TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER REFERENCES projects(id),
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    details TEXT,
    actor TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
, latency_ms INTEGER, status_code INTEGER, endpoint TEXT, method TEXT, action_type TEXT, entity_type TEXT, entity_id TEXT, ip_address TEXT, user_agent TEXT, metadata TEXT DEFAULT '{}');

CREATE TABLE activity_stats (
      user_id INTEGER NOT NULL,
      stat_date TEXT NOT NULL,
      action_count INTEGER DEFAULT 0,
      earnings_cents INTEGER DEFAULT 0,
      relationships_added INTEGER DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, stat_date)
    );

CREATE TABLE admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,                 -- e.g. 'analytics_export'
    report_type TEXT,                     -- overview|users|financial|technical|management
    format TEXT,                          -- csv|pdf|html
    filters_json TEXT,                    -- JSON dump of the request body filters
    storage_key TEXT,                     -- R2 object key (or NULL when inline)
    download_url TEXT,                    -- last-issued signed URL (for display only)
    exported_at TEXT NOT NULL DEFAULT (datetime('now'))
, viewed_user_id INTEGER, conversation_id INTEGER, viewed_at TEXT, actor TEXT);

CREATE TABLE admin_consultation_bookings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    uid          TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- the requester (report subject)
    admin_id     INTEGER REFERENCES users(id),                             -- assigned admin (Guillaume), NULL until triaged
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    slot_at      TEXT,                                                     -- requested / confirmed slot
    status       TEXT NOT NULL DEFAULT 'requested',                        -- requested|confirmed|completed|cancelled
    topic        TEXT,
    notes        TEXT,
    report_id    INTEGER REFERENCES axal_fit_reports(id),                  -- precomputed snapshot
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE admin_profile_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL, viewed_user_id INTEGER NOT NULL, conversation_id INTEGER, action TEXT NOT NULL, viewed_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE advisor_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES advisor_conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  question_id TEXT NOT NULL,
  raw_value TEXT,
  -- where the writeRouter persisted the value (NULL when paywalled / skipped)
  saved_to_table TEXT,
  saved_to_column TEXT,
  saved_to_id TEXT,
  -- 'saved' | 'skipped' | 'paywalled' | 'failed' | 'noop'
  saved_status TEXT NOT NULL,
  saved_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(conversation_id, question_id)
);

CREATE TABLE "advisor_bookings" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  slot_id INTEGER NOT NULL,
  advisor_id INTEGER NOT NULL,
  founder_user_id INTEGER NOT NULL,
  topic TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|confirmed|completed|cancelled|no_show
  cancel_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, amount_cents INTEGER, billing_state TEXT NOT NULL DEFAULT 'unpriced'
  CHECK (billing_state IN ('unpriced', 'billed', 'collected', 'written_off')),
  UNIQUE (slot_id, founder_user_id)
);

CREATE TABLE advisor_client_access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    advisor_user_id INTEGER NOT NULL REFERENCES users(id),
    -- 'open_brief' | 'open_document'
    action TEXT NOT NULL,
    document_id INTEGER REFERENCES research_documents(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE advisor_client_document_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    document_id INTEGER NOT NULL REFERENCES research_documents(id) ON DELETE CASCADE,
    advisor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_by_user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'active',   -- active | revoked
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (document_id, advisor_user_id)
);

CREATE TABLE advisor_client_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    advisor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The founder who opened the door, and the NDA counterparty for the
    -- data-room scope. Kept as its own column rather than joined through
    -- `projects` so the gate is one lookup, as in `data_room_grants`.
    granted_by_user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'active',   -- active | revoked
    expires_at TEXT,
    scope_project INTEGER NOT NULL DEFAULT 1,
    scope_data_room INTEGER NOT NULL DEFAULT 0,
    scope_sessions INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_id, advisor_user_id)
);

CREATE TABLE advisor_cohort_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  advisor_user_id INTEGER NOT NULL REFERENCES users(id),
  cohort_cycle_id INTEGER NOT NULL REFERENCES cohort_cycles(id),
  assigned_by_admin_id INTEGER,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unassigned_at TEXT,
  note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (advisor_user_id, cohort_cycle_id)
);

CREATE TABLE advisor_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  -- 'founder' | 'investor' | 'mentor' | 'partner' | 'admin' | 'unknown'
  persona TEXT NOT NULL,
  -- 'active' | 'paused' | 'complete'
  state TEXT NOT NULL DEFAULT 'active',
  current_question_id TEXT,
  total_questions INTEGER NOT NULL DEFAULT 0,
  answered_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE advisor_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES advisor_conversations(id) ON DELETE CASCADE,
  -- 'user' | 'assistant' | 'tool' | 'system'
  role TEXT NOT NULL,
  question_id TEXT,
  content TEXT NOT NULL,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, safety_score REAL, sanitisation_actions_json TEXT);

CREATE TABLE "advisor_office_hour_slots" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  advisor_id INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  meeting_url TEXT,
  notes TEXT,
  is_cancelled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE advisor_profiles (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    founder_id        INTEGER NOT NULL,
    name              TEXT NOT NULL,
    email             TEXT,
    bio               TEXT,
    sectors_json      TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
    expertise_json    TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
    linkedin_url      TEXT,
    hourly_rate       REAL,
    source            TEXT,                          -- brand-landing|referral|staff-rec|null
    status            TEXT NOT NULL DEFAULT 'active', -- active|archived
    source_contact_id INTEGER,                       -- link back to contacts.id
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
, last_session_at TEXT, notes TEXT, follow_up_at TEXT, follow_up_note TEXT, company_id INTEGER);

CREATE TABLE advisor_proof_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  proof_item_id INTEGER NOT NULL REFERENCES advisor_proof_items(id),
  attester_name TEXT NOT NULL,
  attester_email TEXT,
  attester_role TEXT,
  relationship TEXT,
  requested_at TEXT,
  requested_by INTEGER,
  request_token TEXT UNIQUE,
  consent_given INTEGER NOT NULL DEFAULT 0,
  consent_given_at TEXT,
  consent_text TEXT,
  consent_captured_by INTEGER,
  statement TEXT,
  withdrawn_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE advisor_proof_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  advisor_id INTEGER NOT NULL REFERENCES advisors(id),
  kind TEXT NOT NULL DEFAULT 'engagement'
    CHECK (kind IN ('engagement', 'outcome', 'role', 'credential')),
  title TEXT NOT NULL,
  detail TEXT,
  organization TEXT,
  period_note TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "advisor_reviews" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  booking_id INTEGER NOT NULL,
  reviewer_user_id INTEGER NOT NULL,
  reviewer_role TEXT NOT NULL, -- 'founder' | 'mentor'
  rating INTEGER NOT NULL,     -- 1..5
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (booking_id, reviewer_role)
);

CREATE TABLE advisor_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  advisor_id INTEGER NOT NULL REFERENCES advisors(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fixed' CHECK (kind IN ('fixed', 'package', 'retainer')),
  duration_note TEXT,
  price_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  scope TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE advisor_startups (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    advisor_profile_id INTEGER NOT NULL,
    project_id         INTEGER NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (advisor_profile_id, project_id)
);

CREATE TABLE advisor_turn_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, conversation_id INTEGER, model TEXT, prompt_hash TEXT NOT NULL, tool_calls_json TEXT, ai_spend_usd REAL NOT NULL DEFAULT 0, safety_score REAL, sanitisation_actions_json TEXT, refusal_reason TEXT, shadow_flagged INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE "advisors" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT,
  bio TEXT,
  expertise_json TEXT NOT NULL DEFAULT '[]',
  sectors_json TEXT NOT NULL DEFAULT '[]',
  linkedin_url TEXT,
  hourly_rate_usd INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, topics_willing_json TEXT, topics_unwilling_json TEXT, weekly_hours_band TEXT, headline TEXT, stages_json TEXT, languages_json TEXT, country TEXT, timezone TEXT, availability_note TEXT, headshot_url TEXT);

CREATE TABLE ai_score_drafts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Scales are the scorer's own, recorded as produced. Named for the range
  -- so nobody reads them as the 0-100 canonical dimensions.
  market_0_25   INTEGER NOT NULL,
  team_0_20     INTEGER NOT NULL,
  product_0_15  INTEGER NOT NULL,
  capital_0_15  INTEGER NOT NULL,
  total_0_75    INTEGER NOT NULL,
  rationale     TEXT,
  -- Which model produced it. The scorer falls back to fixed defaults when
  -- env.AI is unavailable, and a draft built from defaults is not a judgement
  -- about the project — this column is how you tell the two apart.
  model         TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ai_usage_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, task TEXT NOT NULL, model TEXT NOT NULL, latency_ms INTEGER NOT NULL DEFAULT 0, prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0, est_cost_usd REAL NOT NULL DEFAULT 0, safety_score REAL, fallback_used INTEGER NOT NULL DEFAULT 0, cached INTEGER NOT NULL DEFAULT 0, refusal TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE analytics_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL,            -- YYYY-MM-DD (the day being summarised)
  -- Overview metrics
  active_users INTEGER NOT NULL DEFAULT 0,
  new_signups INTEGER NOT NULL DEFAULT 0,
  total_users INTEGER NOT NULL DEFAULT 0,
  paid_users INTEGER NOT NULL DEFAULT 0,
  total_requests INTEGER NOT NULL DEFAULT 0,
  errors_5xx INTEGER NOT NULL DEFAULT 0,
  p50_latency_ms INTEGER NOT NULL DEFAULT 0,
  p95_latency_ms INTEGER NOT NULL DEFAULT 0,
  -- Financial (USD baseline; converted at read time off the FX cache)
  mrr_usd REAL NOT NULL DEFAULT 0,
  arr_usd REAL NOT NULL DEFAULT 0,
  new_mrr_usd REAL NOT NULL DEFAULT 0,
  churn_mrr_usd REAL NOT NULL DEFAULT 0,
  churned_subscriptions INTEGER NOT NULL DEFAULT 0,
  -- Bookkeeping
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL DEFAULT 'cron',    -- 'cron' | 'backfill' | 'manual'
  UNIQUE(snapshot_date)
);

CREATE TABLE article_review_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE, author_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, anchor TEXT, resolved_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE article_revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE, rev INTEGER NOT NULL, title TEXT NOT NULL, subtitle TEXT, body_markdown TEXT NOT NULL, status_at_save TEXT NOT NULL, saved_by INTEGER NOT NULL REFERENCES users(id), reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE article_submission_log (id INTEGER PRIMARY KEY AUTOINCREMENT, author_id INTEGER NOT NULL REFERENCES users(id), article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE, submitted_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, subtitle TEXT, body_markdown TEXT NOT NULL DEFAULT '', body_html TEXT, cover_r2_key TEXT, cover_mime TEXT, tags TEXT, sector TEXT, status TEXT NOT NULL DEFAULT 'draft', author_user_id INTEGER NOT NULL REFERENCES users(id), reviewer_user_id INTEGER REFERENCES users(id), submitted_at TEXT, reviewed_at TEXT, approved_at TEXT, published_at TEXT, rejected_at TEXT, rejection_reason TEXT, word_count INTEGER NOT NULL DEFAULT 0, read_minutes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), excerpt TEXT, seo_title TEXT, canonical_url TEXT, views INTEGER NOT NULL DEFAULT 0);

CREATE TABLE assessment_archetypes (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id       INTEGER NOT NULL REFERENCES assessment_games(id),
        track         TEXT NOT NULL,
        slug          TEXT NOT NULL UNIQUE,
        label         TEXT NOT NULL,
        tagline       TEXT,
        description   TEXT,
        centroid_json TEXT NOT NULL DEFAULT '{}',
        badge_slug    TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

CREATE TABLE assessment_badges (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        slug          TEXT NOT NULL UNIQUE,
        label         TEXT NOT NULL,
        description   TEXT,
        kind          TEXT NOT NULL DEFAULT 'milestone',
        icon          TEXT,
        criteria_json TEXT NOT NULL DEFAULT '{}',
        xp_reward     INTEGER NOT NULL DEFAULT 0,
        display_order INTEGER NOT NULL DEFAULT 0,
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

CREATE TABLE assessment_chapters (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id       INTEGER NOT NULL REFERENCES assessment_games(id),
        slug          TEXT NOT NULL,
        title         TEXT NOT NULL,
        description   TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (game_id, slug)
      );

CREATE TABLE assessment_games (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        slug          TEXT NOT NULL UNIQUE,
        track         TEXT NOT NULL,
        title         TEXT NOT NULL,
        subtitle      TEXT,
        description   TEXT,
        target_role   TEXT,
        theme_json    TEXT NOT NULL DEFAULT '{}',
        status        TEXT NOT NULL DEFAULT 'draft',
        version       INTEGER NOT NULL DEFAULT 1,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

CREATE TABLE assessment_items (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id       INTEGER NOT NULL REFERENCES assessment_games(id),
        chapter_id    INTEGER NOT NULL REFERENCES assessment_chapters(id),
        slug          TEXT NOT NULL UNIQUE,
        mechanic      TEXT NOT NULL,
        prompt        TEXT NOT NULL,
        subprompt     TEXT,
        options_json  TEXT NOT NULL DEFAULT '{}',
        measures_json TEXT NOT NULL DEFAULT '{}',
        loads_json    TEXT NOT NULL DEFAULT '{}',
        config_json   TEXT NOT NULL DEFAULT '{}',
        display_order INTEGER NOT NULL DEFAULT 0,
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

CREATE TABLE assessment_responses (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id      INTEGER NOT NULL REFERENCES assessment_sessions(id),
        item_id         INTEGER NOT NULL REFERENCES assessment_items(id),
        user_id         INTEGER NOT NULL REFERENCES users(id),
        item_slug       TEXT,
        mechanic        TEXT,
        response_json   TEXT NOT NULL DEFAULT '{}',
        response_value  REAL,
        confidence_wager REAL,
        latency_ms      INTEGER,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (session_id, item_id)
      );

CREATE TABLE assessment_results (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id        INTEGER NOT NULL REFERENCES assessment_sessions(id),
        user_id           INTEGER NOT NULL REFERENCES users(id),
        game_id           INTEGER NOT NULL REFERENCES assessment_games(id),
        track             TEXT NOT NULL,
        value_vector_json TEXT NOT NULL DEFAULT '{}',
        skill_vector_json TEXT NOT NULL DEFAULT '{}',
        confidence_json   TEXT NOT NULL DEFAULT '{}',
        flags_json        TEXT NOT NULL DEFAULT '[]',
        archetype_slug    TEXT,
        archetype_label   TEXT,
        xp_awarded        INTEGER NOT NULL DEFAULT 0,
        integrity_hash    TEXT,
        integrity_version INTEGER NOT NULL DEFAULT 1,
        published         INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (session_id)
      );

CREATE TABLE assessment_sessions (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id          TEXT NOT NULL UNIQUE,
        user_id            INTEGER NOT NULL REFERENCES users(id),
        game_id            INTEGER NOT NULL REFERENCES assessment_games(id),
        game_slug          TEXT NOT NULL,
        game_version       INTEGER NOT NULL DEFAULT 1,
        status             TEXT NOT NULL DEFAULT 'in_progress',
        current_chapter_id INTEGER,
        current_item_id    INTEGER,
        progress_json      TEXT NOT NULL DEFAULT '{}',
        started_at         TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at       TEXT,
        created_at         TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
      );

CREATE TABLE assistant_conversations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT UNIQUE NOT NULL,
  user_id        INTEGER NOT NULL,
  title          TEXT NOT NULL DEFAULT 'New conversation',
  model_default  TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  -- Aggregated per-conversation token + cost rollup. Updated atomically
  -- after every assistant turn so admin analytics can read these without
  -- scanning the messages table.
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cached_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd_micros INTEGER NOT NULL DEFAULT 0,  -- USD * 1e6 to keep integer math
  message_count  INTEGER NOT NULL DEFAULT 0,
  extended_retention INTEGER NOT NULL DEFAULT 0, -- admin opt-in only
  archived_at    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE assistant_feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL REFERENCES assistant_messages(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL,
  rating      INTEGER NOT NULL CHECK (rating IN (-1, 1)),
  comment     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(message_id, user_id)
);

CREATE TABLE assistant_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
  content         TEXT NOT NULL,
  -- Optional structured payload: tool_calls JSON for assistant turns,
  -- tool_results JSON for tool turns, deep-link suggestions, etc.
  meta_json       TEXT,
  model           TEXT,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cached_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_usd_micros INTEGER NOT NULL DEFAULT 0,
  latency_ms      INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE auth_recovery_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  layer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  assurance_level TEXT,
  initiator_ip TEXT,
  initiator_ua TEXT,
  state_json TEXT,
  resolved_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auth_sms (
  user_id            INTEGER PRIMARY KEY,
  phone_ct           TEXT    NOT NULL,                 -- column cipher v1
  phone_last4        TEXT    NOT NULL,
  phone_country      TEXT    NOT NULL,                 -- ISO-3166 alpha-2
  firebase_uid       TEXT,
  enrolled_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  last_verified_at   TEXT,
  last_used_at       TEXT
);

CREATE TABLE auth_totp (
  user_id          INTEGER PRIMARY KEY,
  secret_ct        TEXT NOT NULL,                       -- AES-GCM ciphertext (AAD-bound)
  recovery_hashes  TEXT NOT NULL DEFAULT '[]',          -- JSON array of SHA-256 hex
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at     TEXT
);

CREATE TABLE auth_trusted_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  contact_user_id INTEGER,
  contact_email TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending_invite',
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP,
  removed_at TIMESTAMP
);

CREATE TABLE author_websites (user_id INTEGER PRIMARY KEY REFERENCES users(id), website_url TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), bio TEXT, twitter_url TEXT, linkedin_url TEXT, photo_url TEXT);

CREATE TABLE axal_fit_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uid         TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- report subject
    persona     TEXT,                                                     -- subject's primary persona at compute time
    report_json TEXT NOT NULL,
    computed_by INTEGER REFERENCES users(id),                             -- admin who triggered, NULL = system
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE axal_fit_scores (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona        TEXT NOT NULL,           -- founder|investor|partner|mentor|coach
    total_score    REAL NOT NULL DEFAULT 0, -- 0..100
    band           TEXT NOT NULL,           -- strong_yes|yes_caution|hold|no
    rubric_json    TEXT,                    -- {category:{score,weight,answered}}
    red_flags_json TEXT,                    -- JSON array of red-flag keys
    signal_quality REAL NOT NULL DEFAULT 0, -- 0..1 (0.6×coverage + 0.4×mean confidence)
    narrative_fit  TEXT,
    computed_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE axal_values (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value_key  TEXT NOT NULL,            -- integrity|stewardship|curiosity|resilience|collaboration
    score      REAL NOT NULL DEFAULT 0,  -- 0..1 normalized behavioral score
    confidence REAL NOT NULL DEFAULT 0,  -- 0..1 coverage/confidence
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, value_key)
);

CREATE TABLE brand_custom_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE brand_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE calendar_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT    NOT NULL UNIQUE,
  user_id       INTEGER NOT NULL,
  source        TEXT    NOT NULL,            -- 'calendly' | future providers
  external_uri  TEXT    NOT NULL,            -- provider canonical URI (UNIQUE w/ source)
  external_id   TEXT,                        -- short id, when distinct from URI
  title         TEXT,
  start_at      TEXT    NOT NULL,            -- ISO8601 UTC
  end_at        TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'scheduled',  -- scheduled|cancelled|completed
  location_kind TEXT,                        -- 'video' | 'phone' | 'in_person' | 'custom'
  location_uri  TEXT,
  organizer_email TEXT,
  invitee_email   TEXT,
  invitee_name    TEXT,
  notes         TEXT,
  raw_json      TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, external_uri)
);

CREATE TABLE calendar_sync_records (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id),
  provider           TEXT    NOT NULL CHECK (provider IN ('google','microsoft')),
  source_kind        TEXT    NOT NULL,
  source_id          INTEGER NOT NULL,
  external_event_id  TEXT    NOT NULL,
  last_synced_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), last_error TEXT,
  UNIQUE(user_id, provider, source_kind, source_id)
);

CREATE TABLE cap_table_holders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id INTEGER,
  name TEXT NOT NULL,
  email TEXT,
  security_type TEXT,
  shares REAL DEFAULT 0,
  ownership_pct REAL,
  source TEXT NOT NULL DEFAULT 'manual',
  carta_stakeholder_id TEXT,
  carta_security_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
, kind TEXT);

CREATE TABLE cap_table_option_pools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  shares_authorized REAL,
  shares_issued REAL,
  shares_available REAL,
  source TEXT DEFAULT 'manual',
  carta_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cap_table_scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    project_id INTEGER REFERENCES projects(id),
    name TEXT NOT NULL,
    inputs_json TEXT NOT NULL,
    result_json TEXT,
    computed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, is_variant INTEGER NOT NULL DEFAULT 0);

CREATE TABLE cap_table_securities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id INTEGER,
  name TEXT NOT NULL,
  share_class TEXT,
  shares_authorized REAL,
  shares_issued REAL,
  source TEXT NOT NULL DEFAULT 'manual',
  carta_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cap_table_vesting (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  holder_id INTEGER,
  security_id INTEGER,
  carta_vesting_id TEXT,
  start_date TEXT,
  cliff_months INTEGER,
  total_months INTEGER,
  total_shares REAL,
  vested_shares REAL,
  source TEXT DEFAULT 'manual',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "capital_calls" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    limited_partner_id INTEGER REFERENCES limited_partners(id),
    lp_investor_id INTEGER REFERENCES lp_investors(id),
    project_id INTEGER REFERENCES projects(id),
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    due_date TEXT,
    paid_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE captable_share_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_uid TEXT NOT NULL,
  -- summary | investor | full — see services/captableShare.ts
  audience TEXT NOT NULL DEFAULT 'summary',
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  view_limit INTEGER NOT NULL DEFAULT 1,
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TEXT,
  -- Free-text label so the owner can tell two live links apart
  -- ("Sequoia diligence", "new CFO candidate").
  label TEXT,
  revoked_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE captable_share_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  share_token_id INTEGER NOT NULL REFERENCES captable_share_tokens(id) ON DELETE CASCADE,
  scenario_uid TEXT NOT NULL,
  -- Pseudonymous: HMAC-style digests keyed by the app secret, truncated
  -- to 16 hex chars. Enough to tell viewers apart, not enough to
  -- identify one, and no raw IP is ever written.
  ip_hash TEXT,
  ua_fingerprint TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cf_dlq_mirror (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      payload TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE circles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    slug            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'founder',   -- founder|investor|partner|advisor|city|topic
    access          TEXT NOT NULL DEFAULT 'public',    -- public|private
    tagline         TEXT,
    region          TEXT,
    theme           TEXT,
    members         INTEGER NOT NULL DEFAULT 0,
    activity        TEXT NOT NULL DEFAULT 'new',        -- active|growing|quiet|new
    upcoming_events INTEGER NOT NULL DEFAULT 0,
    discussions     INTEGER NOT NULL DEFAULT 0,
    tags            TEXT NOT NULL DEFAULT '[]',         -- JSON array of strings
    hosted_by       TEXT,
    featured        INTEGER NOT NULL DEFAULT 0,
    published       INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cofounder_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
    user_a_id INTEGER NOT NULL REFERENCES users(id),
    user_b_id INTEGER NOT NULL REFERENCES users(id),
    nda_doc_a_id INTEGER REFERENCES documents(id),
    nda_doc_b_id INTEGER REFERENCES documents(id),
    nda_signed_at_a TEXT,
    nda_signed_at_b TEXT,
    nda_signed_ip_a TEXT,
    nda_signed_ip_b TEXT,
    nda_signed_name_a TEXT,
    nda_signed_name_b TEXT,
    status TEXT NOT NULL DEFAULT 'pending_nda',  -- pending_nda | active | closed
    closed_at TEXT,
    closed_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_a_id, user_b_id),
    CHECK (user_a_id < user_b_id)
);

CREATE TABLE cofounder_interests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL REFERENCES users(id),
    to_user_id INTEGER NOT NULL REFERENCES users(id),
    message TEXT,
    status TEXT NOT NULL DEFAULT 'sent',  -- sent | withdrawn
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (from_user_id, to_user_id)
);

CREATE TABLE cofounder_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    skills_json TEXT NOT NULL DEFAULT '[]',
    sectors_json TEXT NOT NULL DEFAULT '[]',
    commitment TEXT NOT NULL DEFAULT 'full_time',  -- full_time | part_time | exploring
    location_city TEXT,
    location_country TEXT,
    remote_ok INTEGER NOT NULL DEFAULT 1,
    equity_expectation_min REAL,
    equity_expectation_max REAL,
    bio TEXT,
    looking_for TEXT,
    listed INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cohort_app_notification_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, cohort_cycle_id INTEGER NOT NULL, notif_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'sent', sent_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, cohort_cycle_id, notif_type));

CREATE TABLE cohort_applicants (id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER NOT NULL, user_id INTEGER NOT NULL, cohort_cycle_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', rolled_from_cycle_id INTEGER, decided_at TEXT, decided_by TEXT, decision_reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(application_id, cohort_cycle_id));

CREATE TABLE cohort_cycle_events (id INTEGER PRIMARY KEY AUTOINCREMENT, cohort_cycle_id INTEGER, event_type TEXT NOT NULL, details TEXT, actor TEXT NOT NULL DEFAULT 'scheduler', created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE cohort_cycles (id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, month INTEGER NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled', created_at TEXT NOT NULL DEFAULT (datetime('now')), applications_open_at TEXT, applications_close_at TEXT, app_status TEXT NOT NULL DEFAULT 'open', force_proceed INTEGER NOT NULL DEFAULT 0, UNIQUE(year, month));

CREATE TABLE cohort_guidance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    cohort_cycle_id INTEGER NOT NULL REFERENCES cohort_cycles(id),
    advisor_user_id INTEGER NOT NULL REFERENCES users(id),
    -- NULL = the advisor posted this unprompted (broadcast guidance).
    -- Non-NULL = a founder asked, and `answer` is the advisor's reply.
    asked_by_user_id INTEGER REFERENCES users(id),
    body TEXT NOT NULL,
    answer TEXT,
    answered_at TEXT,
    -- Week the guidance is about, when the advisor says so. Nullable: guidance
    -- that applies to the whole programme has no week, and inventing one from
    -- `posted_at` would file a general note under whichever week it happened
    -- to be typed in.
    week_number INTEGER,
    posted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    retired_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cohort_guidance_acks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guidance_id INTEGER NOT NULL REFERENCES cohort_guidance(id) ON DELETE CASCADE,
    founder_user_id INTEGER NOT NULL REFERENCES users(id),
    acted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note TEXT,
    UNIQUE (guidance_id, founder_user_id)
);

CREATE TABLE cohort_reminder_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, week_window_id INTEGER NOT NULL, threshold_hours INTEGER NOT NULL, sent_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, week_window_id, threshold_hours));

CREATE TABLE cohort_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT);

CREATE TABLE comarketing_attributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  pitch_id INTEGER NOT NULL,
  partner_id INTEGER NOT NULL,
  event_kind TEXT NOT NULL, -- visit|signup|lead|conversion
  user_id INTEGER,
  project_id INTEGER,
  lead_email TEXT,
  referrer TEXT,
  landing_path TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE comarketing_pitches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  partner_id INTEGER NOT NULL,
  submitter_user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  asset_type TEXT NOT NULL DEFAULT 'webinar',
  proposed_date TEXT,
  target_audience TEXT,
  distribution_channels TEXT,
  co_branding_notes TEXT,
  asset_url TEXT,
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed|approved|rejected|published|withdrawn
  review_notes TEXT,
  reviewed_by_user_id INTEGER,
  reviewed_at TEXT,
  published_at TEXT,
  published_url TEXT,
  attribution_code TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, angle TEXT, what_you_bring TEXT, company_id INTEGER);

CREATE TABLE commission_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_key TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL,
      amount_cents INTEGER,
      percentage_bps INTEGER,
      description TEXT,
      active INTEGER DEFAULT 1
    );

CREATE TABLE commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      referral_id INTEGER,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      source_type TEXT NOT NULL,
      source_id TEXT,
      status TEXT NOT NULL DEFAULT 'accrued',
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      paid_at TIMESTAMP
    );

CREATE TABLE commitments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    investor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'withdrawn')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
, company_id INTEGER);

CREATE TABLE company_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  stage TEXT,
  revenue_range TEXT,
  employee_count INTEGER,
  current_products TEXT,
  international_presence TEXT,
  expansion_goals TEXT,
  logo_url TEXT,
  website TEXT,
  linkedin_url TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE company_week_status (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, cohort_cycle_id INTEGER NOT NULL, week_number INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', deliverables_done INTEGER NOT NULL DEFAULT 0, deliverables_required INTEGER NOT NULL DEFAULT 0, grace_until TEXT, grace_reason TEXT, decided_at TEXT, decided_by TEXT, decision_reason TEXT, UNIQUE(user_id, cohort_cycle_id, week_number));

CREATE TABLE competitor_analyses (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, project_id INTEGER, mode TEXT NOT NULL DEFAULT 'custom', title TEXT, inputs_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft', edited INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE competitor_analysis_outputs (analysis_id TEXT PRIMARY KEY REFERENCES competitor_analyses(id) ON DELETE CASCADE, output_json TEXT NOT NULL DEFAULT '{}', edited INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE competitor_cached_fetches (url_hash TEXT PRIMARY KEY, url TEXT NOT NULL, status INTEGER, title TEXT, description TEXT, text TEXT, headings_json TEXT, pricing_json TEXT, fetched_at TEXT, expires_at TEXT);

CREATE TABLE competitor_candidates (id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL REFERENCES competitor_analyses(id) ON DELETE CASCADE, name TEXT NOT NULL, domain TEXT, url TEXT, category TEXT NOT NULL DEFAULT 'direct', relevance_score REAL NOT NULL DEFAULT 0, scores_json TEXT NOT NULL DEFAULT '{}', summary TEXT, details_json TEXT NOT NULL DEFAULT '{}', origin TEXT NOT NULL DEFAULT 'discovered', position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE competitor_signals (id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL REFERENCES competitor_analyses(id) ON DELETE CASCADE, candidate_id TEXT, signal_type TEXT NOT NULL, label TEXT, detail TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE competitor_sources (id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL REFERENCES competitor_analyses(id) ON DELETE CASCADE, candidate_id TEXT, url TEXT NOT NULL, kind TEXT, title TEXT, status INTEGER, fetched_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE compliance_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER NOT NULL REFERENCES projects(id),
    entity_id INTEGER REFERENCES entities(id),
    jurisdiction TEXT NOT NULL,
    event_type TEXT NOT NULL,            -- annual_report | franchise_tax | registered_agent | board_meeting | other
    title TEXT NOT NULL,
    description TEXT,
    due_date TEXT NOT NULL,              -- ISO 'YYYY-MM-DD'
    completion_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (completion_status IN ('pending', 'completed', 'snoozed')),
    completed_at TEXT,
    completed_by_user_id INTEGER REFERENCES users(id),
    recurrence TEXT NOT NULL DEFAULT 'annual',  -- annual | quarterly | monthly | one_time
    source TEXT NOT NULL DEFAULT 'auto',         -- auto | manual
    reminders_sent_json TEXT NOT NULL DEFAULT '[]',
    created_by_user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (project_id, event_type, due_date)
);

CREATE TABLE compliance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER,
      subsidiary_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      metadata TEXT DEFAULT '{}',
      created_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CHECK (deal_id IS NOT NULL OR subsidiary_id IS NOT NULL)
    );

CREATE TABLE contact_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  direction TEXT NOT NULL DEFAULT 'inbound', -- inbound|outbound
  body TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE contact_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  title TEXT NOT NULL,
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL,
  audience TEXT NOT NULL,                 -- customer|investor|partner|advisor|mentor|cofounder
  routed_to TEXT NOT NULL DEFAULT 'network', -- discovery|raise|network
  name TEXT,
  email TEXT NOT NULL,
  cta TEXT, message TEXT, source TEXT,
  landing_page_id INTEGER,
  status TEXT NOT NULL DEFAULT 'new',     -- new|invited|contacted|replied|qualified|active|passed
  promoted_to TEXT,                        -- discovery|raise once promoted
  last_activity_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, promoted_ref_id INTEGER, utm_json TEXT, referrer TEXT);

CREATE TABLE corporate_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  entity_name TEXT,
  entity_type TEXT,                                          -- e.g. LLC, C-Corp, Ltd, GmbH
  registration_number TEXT,
  tax_id_number_enc TEXT,                                    -- e.g. EIN, ciphertext
  tax_id_last4 TEXT,
  registered_country TEXT,                                   -- ISO alpha-2
  registered_address_line1 TEXT,
  registered_address_line2 TEXT,
  registered_city TEXT,
  registered_state TEXT,
  registered_postal TEXT,
  signing_authority_name TEXT,
  signing_authority_title TEXT,
  signing_authority_email TEXT,
  ubos_json TEXT NOT NULL DEFAULT '[]',                      -- [{name, dob, nationality, ownership_pct}]
  directors_json TEXT NOT NULL DEFAULT '[]',                 -- [{name, title, email}]
  insurance_carriers_json TEXT NOT NULL DEFAULT '[]',        -- [{kind, carrier, policy_no, expiry}]
  ubo_disclosed INTEGER NOT NULL DEFAULT 0,
  aml_high_risk_jurisdiction INTEGER NOT NULL DEFAULT 0,
  sanctions_last_checked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cron_run_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_name TEXT NOT NULL,
      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'started',
      summary TEXT,
      error TEXT
    );

CREATE TABLE data_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  rows_attempted INTEGER DEFAULT 0,
  rows_succeeded INTEGER DEFAULT 0,
  rows_failed INTEGER DEFAULT 0,
  errors_json TEXT,
  raw_file_r2_key TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE data_room_access_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id    INTEGER REFERENCES data_room_files(id) ON DELETE SET NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  action     TEXT NOT NULL,   -- open_room | download
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE data_room_files (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  folder_id           INTEGER REFERENCES data_room_folders(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  r2_key              TEXT NOT NULL,
  content_type        TEXT,
  size_bytes          INTEGER,
  visibility          TEXT NOT NULL DEFAULT 'open',  -- open | nda
  uploaded_by_user_id INTEGER REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE data_room_folders (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT NOT NULL UNIQUE,
  project_id         INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id          INTEGER REFERENCES data_room_folders(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  visibility         TEXT NOT NULL DEFAULT 'open',   -- open | nda
  display_order      INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE data_room_grants (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  investor_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The founder who opened the door. Also the NDA counterparty: migration 025
  -- fixes `pairwise_ndas.party_a_user_id` as the founder, so the gate is a
  -- lookup on (granted_by_user_id, investor_user_id) with no join through
  -- projects → founders → users.
  granted_by_user_id  INTEGER NOT NULL REFERENCES users(id),
  status              TEXT NOT NULL DEFAULT 'active',  -- active | revoked
  expires_at          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, investor_user_id)
);

CREATE TABLE dd_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES dd_sections(id) ON DELETE SET NULL,
  file_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  uploaded_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE dd_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id),
  actor_email_hash TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  details_enc TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE dd_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('project','founder','mentor','investor','partner')),
  subject_id INTEGER NOT NULL,
  subject_label TEXT NOT NULL,
  subject_email_enc TEXT,
  subject_email_idx TEXT,
  subject_legal_name_enc TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_review','completed','archived')),
  risk_score REAL,
  risk_band TEXT CHECK(risk_band IN ('green','yellow','amber','red')),
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  notes_enc TEXT,
  external_scan_completed_at TIMESTAMP,
  report_generated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
, template_depth TEXT NOT NULL DEFAULT 'standard');

CREATE TABLE dd_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES dd_sections(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,             -- CHECKLIST_CATALOG key, e.g. 'corporate_legal.cap_table_clean'
  title TEXT NOT NULL,
  depth TEXT NOT NULL DEFAULT 'lite', -- lite | standard | deep (catalog tier that seeded it)
  status TEXT NOT NULL DEFAULT 'pending', -- pending | pass | flag | fail | n_a
  severity TEXT,                      -- info|low|medium|high|critical — only meaningful with status flag/fail
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,                      -- ISO date (YYYY-MM-DD); TEXT for D1 portability
  note_enc TEXT,                      -- columnCipher('dd_checklist_items','note', id)
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (case_id, item_key)
);

CREATE TABLE dd_external_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  connector TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','ok','error','disabled')),
  query_hash TEXT,
  raw_response_enc TEXT,
  records_count INTEGER DEFAULT 0,
  findings_emitted INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE dd_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES dd_sections(id) ON DELETE SET NULL,
  source_id INTEGER REFERENCES dd_external_sources(id) ON DELETE SET NULL,
  source_kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('info','low','medium','high','critical')),
  title TEXT NOT NULL,
  detail_enc TEXT,
  subject_name_enc TEXT,
  evidence_url TEXT,
  evidence_excerpt_enc TEXT,
  resolved_at TIMESTAMP,
  resolved_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
, esign_envelope_uuid TEXT);

CREATE TABLE dd_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  storage_key TEXT,
  format TEXT NOT NULL CHECK(format IN ('pdf','html')),
  -- 1 when the bytes at storage_key are encrypted via cryptoBox.encryptBytes
  -- (the on-disk content type is then 'application/octet-stream' and the
  -- *real* content type is recorded in `inner_content_type`). Download
  -- route looks at this column to decide whether to decrypt before
  -- streaming to the browser.
  encrypted INTEGER NOT NULL DEFAULT 1,
  inner_content_type TEXT,
  risk_score_at_generation REAL,
  risk_band_at_generation TEXT,
  generated_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE dd_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES dd_sections(id) ON DELETE SET NULL,
  title TEXT NOT NULL,                -- founder-visible: what is being requested
  details TEXT,                       -- founder-visible: plain-text elaboration (NO diligence content)
  state TEXT NOT NULL DEFAULT 'requested', -- requested | received | reviewed
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  responded_at TEXT,
  response_note TEXT,                 -- founder's own words (their data, not case data)
  response_url TEXT,                  -- founder-provided link to the document/data room
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE dd_reviewers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES dd_sections(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'reviewer' CHECK(role IN ('reviewer','lead','observer')),
  invited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP,
  magic_link_jti TEXT,
  nda_signed_at TIMESTAMP,
  UNIQUE(section_id, user_id)
);

CREATE TABLE dd_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  title TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','assigned','in_review','completed','blocked')),
  assignee_user_id INTEGER REFERENCES users(id),
  verdict TEXT CHECK(verdict IN ('pass','warn','fail','n_a')),
  reviewer_notes_enc TEXT,
  reviewer_signed_nda_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(case_id, section_key)
);

CREATE TABLE dead_letter_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_job_id INTEGER,
  job_type TEXT NOT NULL,
  payload TEXT,
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  moved_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE deal_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    investor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    message TEXT,
    email_opt_in INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'interested', 'passed')),
    responded_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
, company_id INTEGER);

CREATE TABLE deal_memos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER NOT NULL REFERENCES projects(id),
    score_snapshot_id INTEGER REFERENCES score_snapshots(id),
    startup_name TEXT NOT NULL,
    founders TEXT NOT NULL,
    sector TEXT,
    stage TEXT,
    total_score REAL NOT NULL,
    tier TEXT NOT NULL,
    problem TEXT,
    solution TEXT,
    why_now TEXT,
    users TEXT,
    revenue_info TEXT,
    growth_signals TEXT,
    cost_to_mvp TEXT,
    funding_needed TEXT,
    use_of_funds TEXT,
    strategic_alignment TEXT,
    partner_synergies TEXT,
    risks TEXT,
    decision TEXT NOT NULL DEFAULT 'pending',
    terms_amount TEXT,
    terms_equity TEXT,
    terms_structure TEXT,
    key_insight TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE deal_stage_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id       INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  -- NULL from_stage marks the deal's first recorded observation, which is not
  -- necessarily its creation — a deal that predates this table gets its first
  -- event on its next move, from whatever stage it was already sitting in.
  from_stage    TEXT,
  to_stage      TEXT NOT NULL,
  -- 'advance' | 'pass' | 'set' — 'set' is a direct status write, which is a
  -- different act from walking the pipeline and is worth telling apart when
  -- reading the trail back.
  kind          TEXT NOT NULL DEFAULT 'set'
                CHECK (kind IN ('advance', 'pass', 'set')),
  -- Days the deal spent in from_stage, computed at write time from
  -- stage_changed_at. Stored rather than derived because the source column is
  -- overwritten by the very update that creates this row.
  days_in_from  INTEGER,
  actor_user_id INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER NOT NULL REFERENCES projects(id),
    partner_id INTEGER REFERENCES partners(id),
    status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'scored', 'active', 'funded', 'rejected')),
    notes TEXT,
    amount REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, hubspot_deal_id TEXT, sf_opportunity_id TEXT, target_raise REAL, capital_committed REAL DEFAULT 0, minimum_check REAL, valuation_cap REAL, carry_pct REAL, management_fee_pct REAL, instrument TEXT, spv_jurisdiction TEXT, closing_deadline TEXT, website TEXT, description TEXT, lead_partner_id INTEGER REFERENCES users(id), stage_changed_at TEXT, pass_reason TEXT
  CHECK (pass_reason IS NULL OR pass_reason IN (
    'early', 'valuation', 'thesis', 'team', 'competitive'
  )), pass_note TEXT, passed_at TEXT, passed_by_user_id INTEGER REFERENCES users(id));

CREATE TABLE decision_gates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      gate_type TEXT NOT NULL DEFAULT 'traction_review',
      status TEXT NOT NULL DEFAULT 'pending',
      ai_recommendation TEXT,
      ai_explanation TEXT,
      final_decision TEXT,
      decided_by INTEGER,
      decided_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE decision_journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL,
  project_id INTEGER,
  deal_id INTEGER,
  decision TEXT NOT NULL,           -- 'invest' | 'pass' | 'follow' | 'other'
  thesis TEXT NOT NULL,
  expected_outcome TEXT,
  conviction TEXT,                  -- low|medium|high
  outcome TEXT,                     -- 'win'|'loss'|'pending'
  outcome_notes TEXT,
  outcome_recorded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, watchlist_item_id INTEGER, key_risks TEXT, expected_multiple REAL, expected_timeline_months INTEGER, tags_json TEXT NOT NULL DEFAULT '[]', outcome_status TEXT NOT NULL DEFAULT 'pending', outcome_actual_multiple REAL, decided_at TEXT, ic_decision_id INTEGER REFERENCES ic_decisions(id));

CREATE TABLE deck_review_history (id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES deck_reviews(id) ON DELETE CASCADE, review_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE deck_reviews (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, project_id INTEGER, source TEXT NOT NULL DEFAULT 'upload', filename TEXT, mime TEXT, size INTEGER NOT NULL DEFAULT 0, r2_key TEXT, raw_retained INTEGER NOT NULL DEFAULT 0, extraction_status TEXT NOT NULL DEFAULT 'pending', chunks_json TEXT NOT NULL DEFAULT '[]', sections_json TEXT NOT NULL DEFAULT '[]', review_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft', title TEXT, edited INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE deck_share_conversions (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       view_id INTEGER,
       share_token_id INTEGER,
       deck_id INTEGER NOT NULL,
       project_id INTEGER,
       user_id INTEGER,
       type TEXT NOT NULL,
       ref_id TEXT,
       created_at TEXT DEFAULT (datetime('now'))
     );

CREATE TABLE deck_share_feedback (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       view_id INTEGER,
       deck_id INTEGER NOT NULL,
       project_id INTEGER,
       user_id INTEGER,
       slide_reactions TEXT,
       overall_note TEXT,
       problem_fit TEXT,
       willingness_to_pay TEXT,
       contact TEXT,
       created_at TEXT DEFAULT (datetime('now'))
     );

CREATE TABLE deck_share_views (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       share_token_id INTEGER NOT NULL,
       deck_id INTEGER NOT NULL,
       ip_hash TEXT,
       ua_fingerprint TEXT,
       read_seconds INTEGER NOT NULL DEFAULT 0,
       created_at TEXT DEFAULT (datetime('now')),
       updated_at TEXT
     );

CREATE TABLE deliverable_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, cohort_cycle_id INTEGER NOT NULL, week_number INTEGER NOT NULL, deliverable_key TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT, snapshotted_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE demo_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        company TEXT,
        message TEXT,
        github_issue_url TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

CREATE TABLE diligence_checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      checklist_type TEXT NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      ai_score REAL,
      ai_summary TEXT,
      completed_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE discovery_interviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    interviewee_name TEXT NOT NULL,
    interviewee_role TEXT,
    interview_date TEXT,
    notes TEXT,
    hypotheses_json TEXT,
    pains_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, featured INTEGER NOT NULL DEFAULT 0, validation_rating INTEGER, validation_comment TEXT, icp_fit TEXT, quote_consent INTEGER, interviewee_company TEXT, recording_r2_key TEXT, recording_mime TEXT, recording_size_bytes INTEGER, recording_duration_sec INTEGER, recording_uploaded_at TEXT, transcript TEXT, transcribed_at TEXT, transcribed_by_model TEXT);

CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER REFERENCES projects(id),
    title TEXT NOT NULL,
    doc_type TEXT NOT NULL DEFAULT 'other',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'sent', 'signed')),
    content TEXT,
    template_name TEXT,
    signed_by TEXT,
    signed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, migrated_to_esign_id INTEGER);

CREATE TABLE email_change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      old_email TEXT NOT NULL,
      new_email TEXT NOT NULL,
      confirm_token_hash TEXT NOT NULL UNIQUE,
      revoke_token_hash TEXT NOT NULL UNIQUE,
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      confirm_expires_at TIMESTAMP NOT NULL,
      revoke_expires_at TIMESTAMP NOT NULL,
      confirmed_at TIMESTAMP,
      revoked_at TIMESTAMP
    );

CREATE TABLE email_send_log (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         user_id INTEGER,
         to_addr TEXT NOT NULL,
         template_key TEXT NOT NULL,
         category TEXT,
         job_id TEXT,
         status TEXT NOT NULL DEFAULT 'queued',
         attempts INTEGER NOT NULL DEFAULT 0,
         last_error TEXT,
         enqueued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         sent_at TIMESTAMP
       );

CREATE TABLE engagement_blockers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  side TEXT NOT NULL DEFAULT 'ours'
    CHECK (side IN ('ours', 'client')),
  summary TEXT NOT NULL,
  raised_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cleared_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE engagement_deliverables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  title TEXT NOT NULL,
  version TEXT,
  link_url TEXT,
  sent_at TEXT,
  sent_by INTEGER,
  opened_at TEXT,
  signed_off_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE engagement_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  person_user_id INTEGER NOT NULL REFERENCES users(id),
  period TEXT NOT NULL,
  hours REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE engagement_invoices (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    uid            TEXT UNIQUE NOT NULL,
    -- Human reference printed on the document, e.g. 'AX-2026-0007'.
    invoice_number TEXT UNIQUE NOT NULL,
    -- One invoice per engagement. The UNIQUE index is the double-issue guard:
    -- a retried request returns the existing invoice instead of minting a
    -- second number for the same work.
    engagement_id  INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,

    -- Both parties, snapshotted. An invoice names who billed whom on the day
    -- it was issued; a later rename must not rewrite history.
    partner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    founder_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    bill_from_name TEXT,
    bill_to_name   TEXT,

    -- JSON: [{ description, quantity, unit_amount_cents, amount_cents }],
    -- carried from the accepted quote's deliverables at issue time.
    line_items_json TEXT,

    subtotal_cents INTEGER NOT NULL DEFAULT 0,
    -- Basis points, like every other rate in this schema: 2000 = 20% VAT.
    tax_rate_bps   INTEGER NOT NULL DEFAULT 0,
    tax_cents      INTEGER NOT NULL DEFAULT 0,
    total_cents    INTEGER NOT NULL DEFAULT 0,
    currency       TEXT NOT NULL DEFAULT 'USD',

    notes          TEXT,
    --   issued — sent, unpaid
    --   paid   — the partner recorded payment received OUT OF BAND
    --   void   — cancelled; a void invoice keeps its number, never reuses it
    status         TEXT NOT NULL DEFAULT 'issued'
                   CHECK (status IN ('issued', 'paid', 'void')),
    issued_at      TEXT NOT NULL DEFAULT (datetime('now')),
    due_at         TEXT,
    paid_at        TEXT,
    void_reason    TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE engagement_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  title TEXT NOT NULL,
  due_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE engagement_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  engagement_id INTEGER NOT NULL,
  reviewer_user_id INTEGER NOT NULL,
  reviewer_role TEXT NOT NULL, -- 'founder' | 'partner'
  rating INTEGER NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (engagement_id, reviewer_role)
);

CREATE TABLE engagement_seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  holder_user_id INTEGER NOT NULL REFERENCES users(id),
  -- Free text on purpose: what a client granted is their vocabulary, not ours.
  -- "Board, KPIs" is a truthful record; an enum would force it into ours.
  scope TEXT,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE engagement_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  surface_id INTEGER NOT NULL REFERENCES partner_surfaces(id),
  attributed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE engagement_status_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  period TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft', 'sent')),
  shipped TEXT,
  next_up TEXT,
  sent_at TEXT,
  sent_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE engagements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  need_id INTEGER NOT NULL,
  quote_id INTEGER NOT NULL UNIQUE,
  partner_id INTEGER NOT NULL,
  founder_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  price REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted',
  delivered_at TEXT,
  delivery_notes TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  invoice_id TEXT,
  invoiced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, company_id INTEGER);

CREATE TABLE entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('holding_company', 'project', 'subsidiary', 'vc_fund')),
    parent_id INTEGER REFERENCES entities(id),
    jurisdiction TEXT,
    incorporation_date TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    endpoint TEXT,
    method TEXT,
    status_code INTEGER,
    message TEXT,
    stack_snippet TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
, level  TEXT, source TEXT, details TEXT);

CREATE TABLE esign_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      envelope_id INTEGER NOT NULL,
      ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      signer_id INTEGER,
      signer_email TEXT,
      action TEXT NOT NULL,
      ip TEXT,
      ua TEXT,
      meta TEXT
    );

CREATE TABLE esign_envelopes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      envelope_uuid TEXT NOT NULL UNIQUE,
      user_id INTEGER,
      deal_id INTEGER,
      document_type TEXT NOT NULL,
      document_title TEXT NOT NULL,
      document_body TEXT NOT NULL,
      body_sha256 TEXT NOT NULL,
      original_r2_key TEXT,
      signed_r2_key TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      audit_log TEXT NOT NULL DEFAULT '[]',
      created_by INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    , provider TEXT NOT NULL DEFAULT 'native', docusign_envelope_id TEXT, docusign_account_id TEXT, last_error TEXT);

CREATE TABLE esign_forward_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      envelope_id INTEGER NOT NULL,
      forwarded_by INTEGER NOT NULL,
      forwarded_to TEXT NOT NULL,
      forwarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      include_audit_page INTEGER NOT NULL DEFAULT 1,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      email_sent INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );

CREATE TABLE esign_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      envelope_id INTEGER NOT NULL,
      user_id INTEGER,
      recipient_email TEXT NOT NULL,
      recipient_name TEXT,
      signing_token TEXT NOT NULL UNIQUE,
      token_expires_at TIMESTAMP NOT NULL,
      signed_at TIMESTAMP,
      signer_ip TEXT,
      signer_ua TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
    );

CREATE TABLE event_agenda_items (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id        INTEGER NOT NULL REFERENCES events(id),
     slug            TEXT,
     title           TEXT NOT NULL,
     description     TEXT,
     starts_at       TEXT,
     ends_at         TEXT,
     speaker_user_id INTEGER REFERENCES users(id),
     speaker_name    TEXT,
     speaker_title   TEXT,
     display_order   INTEGER NOT NULL DEFAULT 0,
     created_at      TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (event_id, slug)
   );

CREATE TABLE event_checkins (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id        INTEGER NOT NULL REFERENCES events(id),
     registration_id INTEGER NOT NULL REFERENCES event_registrations(id),
     code            TEXT NOT NULL UNIQUE,
     checked_in_at   TEXT,
     checked_in_by   INTEGER REFERENCES users(id),
     created_at      TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (event_id, registration_id)
   );

CREATE TABLE event_invitations (
     id               INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id         INTEGER NOT NULL REFERENCES events(id),
     token            TEXT NOT NULL UNIQUE,
     invited_user_id  INTEGER REFERENCES users(id),
     invited_email    TEXT,
     invited_name     TEXT,
     source           TEXT NOT NULL DEFAULT 'manual',
     comp             INTEGER NOT NULL DEFAULT 0,
     status           TEXT NOT NULL DEFAULT 'pending',
     personal_message TEXT,
     invited_by       INTEGER REFERENCES users(id),
     created_at       TEXT NOT NULL DEFAULT (datetime('now')),
     responded_at     TEXT
   );

CREATE TABLE event_notifications (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id      INTEGER NOT NULL REFERENCES events(id),
     principal_key TEXT NOT NULL,
     kind          TEXT NOT NULL,
     created_at    TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (event_id, principal_key, kind)
   );

CREATE TABLE event_registrations (
     id                INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id          INTEGER NOT NULL REFERENCES events(id),
     user_id           INTEGER REFERENCES users(id),
     email             TEXT,
     name              TEXT,
     status            TEXT NOT NULL DEFAULT 'registered',
     source            TEXT NOT NULL DEFAULT 'self',
     comp              INTEGER NOT NULL DEFAULT 0,
     invitation_id     INTEGER REFERENCES event_invitations(id),
     waitlist_position INTEGER,
     payment_status    TEXT NOT NULL DEFAULT 'none',
     payment_intent_id TEXT,
     amount_cents      INTEGER NOT NULL DEFAULT 0,
     answers_json      TEXT NOT NULL DEFAULT '{}',
     registered_at     TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (event_id, user_id),
     UNIQUE (event_id, email)
   );

CREATE TABLE events (
     id                 INTEGER PRIMARY KEY AUTOINCREMENT,
     slug               TEXT NOT NULL UNIQUE,
     host_user_id       INTEGER REFERENCES users(id),
     project_id         INTEGER REFERENCES projects(id),
     type               TEXT NOT NULL DEFAULT 'meetup',
     title              TEXT NOT NULL,
     summary            TEXT,
     description        TEXT,
     cover_url          TEXT,
     starts_at          TEXT NOT NULL,
     ends_at            TEXT,
     timezone           TEXT NOT NULL DEFAULT 'UTC',
     location_kind      TEXT NOT NULL DEFAULT 'virtual',
     location_text      TEXT,
     location_url       TEXT,
     capacity           INTEGER,
     waitlist_enabled   INTEGER NOT NULL DEFAULT 1,
     approval_required  INTEGER NOT NULL DEFAULT 0,
     visibility         TEXT NOT NULL DEFAULT 'private',
     status             TEXT NOT NULL DEFAULT 'draft',
     admin_published    INTEGER NOT NULL DEFAULT 0,
     featured           INTEGER NOT NULL DEFAULT 0,
     audience_rules_json TEXT NOT NULL DEFAULT '{}',
     price_cents        INTEGER NOT NULL DEFAULT 0,
     currency           TEXT NOT NULL DEFAULT 'usd',
     created_at         TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
   );

CREATE TABLE exit_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL REFERENCES secondary_listings(id),
    buyer_user_id INTEGER REFERENCES users(id),
    buyer_type TEXT NOT NULL DEFAULT 'lp_rollover',
    match_score REAL NOT NULL DEFAULT 0,
    ai_explanation TEXT,
    status TEXT NOT NULL DEFAULT 'proposed',     -- proposed | accepted | rejected | executed
    proposed_price_cents INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT
);

CREATE TABLE expert_availability (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
       expert_id INTEGER NOT NULL,
       day_of_week INTEGER NOT NULL,
       start_minute INTEGER NOT NULL,
       end_minute INTEGER NOT NULL,
       timezone TEXT NOT NULL DEFAULT 'UTC',
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     );

CREATE TABLE expert_bookings (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
       expert_id INTEGER NOT NULL,
       user_id INTEGER NOT NULL,
       scheduled_at TEXT,
       duration_minutes INTEGER NOT NULL DEFAULT 30,
       status TEXT NOT NULL DEFAULT 'requested',
       booking_external_url TEXT,
       notes TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     , service_id INTEGER, payment_status TEXT NOT NULL DEFAULT 'unpaid', stripe_session_id TEXT, stripe_payment_intent_id TEXT, amount_total_cents INTEGER, application_fee_cents INTEGER, currency TEXT, meet_link TEXT, hidden_by_admin INTEGER NOT NULL DEFAULT 0, booker_note TEXT);

CREATE TABLE expert_profile_views (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id INTEGER NOT NULL,
       expert_id INTEGER NOT NULL,
       viewed_at TEXT NOT NULL DEFAULT (datetime('now'))
     );

CREATE TABLE expert_ratings (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
       expert_id INTEGER NOT NULL,
       user_id INTEGER NOT NULL,
       stars INTEGER NOT NULL,
       review TEXT,
       category_match_pct INTEGER,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       UNIQUE(expert_id, user_id)
     );

CREATE TABLE expert_services (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
       expert_id INTEGER NOT NULL,
       title TEXT NOT NULL,
       description TEXT,
       duration_minutes INTEGER NOT NULL DEFAULT 30,
       price_cents INTEGER NOT NULL DEFAULT 0,
       currency TEXT NOT NULL DEFAULT 'usd',
       is_active INTEGER NOT NULL DEFAULT 1,
       sort_order INTEGER NOT NULL DEFAULT 100,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     );

CREATE TABLE experts (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
       user_id INTEGER,
       name TEXT NOT NULL,
       headline TEXT, bio TEXT, photo_url TEXT,
       categories_json TEXT NOT NULL DEFAULT '[]',
       sectors_json TEXT NOT NULL DEFAULT '[]',
       languages_json TEXT NOT NULL DEFAULT '["en"]',
       timezones_json TEXT NOT NULL DEFAULT '[]',
       modalities_json TEXT NOT NULL DEFAULT '["video"]',
       pricing_model TEXT NOT NULL DEFAULT 'paid',
       hourly_rate_usd INTEGER,
       first_session_free INTEGER NOT NULL DEFAULT 0,
       calendly_url TEXT, booking_url TEXT, website_url TEXT,
       verified INTEGER NOT NULL DEFAULT 0,
       is_active INTEGER NOT NULL DEFAULT 1,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     , profile_completion_pct INTEGER NOT NULL DEFAULT 0, stripe_account_id TEXT, stripe_charges_enabled INTEGER NOT NULL DEFAULT 0, stripe_payouts_enabled INTEGER NOT NULL DEFAULT 0, application_fee_pct REAL, updated_at TEXT, hidden_by_admin INTEGER NOT NULL DEFAULT 0);

CREATE TABLE explorer_needs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  track TEXT,                          -- founder | investor | advisor | partner
  current_status TEXT,                 -- track-specific status option (see banks/explorer.ts)
  team_structure TEXT,                 -- solo | with_team | fund_team | etc. (track-specific)
  sector TEXT,                         -- AI, B2B SaaS, Climate, Fintech, Healthcare, Consumer, Deep Tech, Other
  geography TEXT,                      -- geographic focus
  challenge_1 TEXT,                    -- primary challenge (top priority, track-specific option)
  challenge_2 TEXT,                    -- secondary challenge
  challenge_3 TEXT,                    -- tertiary challenge
  challenge_1_depth TEXT,               -- depth answer for primary challenge
  timeline_urgency TEXT,               -- within_30_days, within_90_days, within_180_days, no_immediate_timeline
  hard_deadline TEXT,                  -- optional: specific deadline or milestone
  runway_months INTEGER,               -- months of runway remaining (personal or fund/practice)
  track_extra_json TEXT,               -- track's 4th-section answers (funding/capital/compensation/commercials), keyed by question_id
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE explorer_promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  code TEXT NOT NULL UNIQUE,
  track TEXT NOT NULL,                  -- founder | investor | advisor | partner
  feature_key TEXT NOT NULL,            -- feature_unlocks key the redemption grants
  license_label TEXT NOT NULL,          -- human label shown in chat + receipt
  unlock_days INTEGER NOT NULL DEFAULT 30,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,                      -- code redemption deadline (issued + 90d)
  redeemed_at TEXT
);

CREATE TABLE feature_unlocks (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, feature_key TEXT NOT NULL, expires_at TEXT, source_payment_intent_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE field_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, question_id TEXT NOT NULL, page_target TEXT, saved_to_table TEXT, saved_to_column TEXT, saved_to_id TEXT, source TEXT NOT NULL DEFAULT 'advisor', evidence_text TEXT, filled_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, question_id));

CREATE TABLE financial_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id),
    assumptions_json TEXT NOT NULL DEFAULT '{}',
    computed_json TEXT NOT NULL DEFAULT '{}',
    sensitivity_json TEXT NOT NULL DEFAULT '{}',
    capital_recompute_json TEXT,
    updated_by INTEGER REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_user_id INTEGER NOT NULL REFERENCES users(id),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('user', 'project')),
    entity_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (follower_user_id, entity_type, entity_id)
);

CREATE TABLE founder_checkins (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                   TEXT    NOT NULL UNIQUE,
  founder_user_id       INTEGER NOT NULL REFERENCES users(id),
  counterpart_user_id   INTEGER REFERENCES users(id),
  project_id            INTEGER REFERENCES projects(id),
  title                 TEXT    NOT NULL,
  notes                 TEXT,
  start_at              TEXT    NOT NULL,
  duration_min          INTEGER NOT NULL DEFAULT 30,
  location_kind         TEXT    NOT NULL DEFAULT 'video',
  location_uri          TEXT,
  status                TEXT    NOT NULL DEFAULT 'scheduled',
  cancelled_at          TEXT,
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE founder_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      inviter_user_id INTEGER NOT NULL,
      invitee_email TEXT NOT NULL,
      invitee_name TEXT,
      role TEXT NOT NULL DEFAULT 'co-founder',
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL,
      accepted_at TIMESTAMP,
      revoked_at TIMESTAMP
    );

CREATE TABLE founder_needs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL,
  founder_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  budget_min REAL,
  budget_max REAL,
  timeline TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open|in_review|closed|filled
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE founders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    linkedin_url TEXT,
    domain_expertise TEXT,
    experience_years INTEGER NOT NULL DEFAULT 0,
    bio TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
, sf_contact_id TEXT, company TEXT);

CREATE TABLE fund_distributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
    lp_id INTEGER NOT NULL REFERENCES limited_partners(id),
    amount_cents INTEGER NOT NULL,
    distribution_type TEXT NOT NULL,           -- return_of_capital | profit_share | exit_proceeds
    source_liquidity_event_id INTEGER REFERENCES liquidity_events(id),
    status TEXT NOT NULL DEFAULT 'pending',    -- pending | paid | failed
    notes TEXT,
    distributed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE fund_report_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fund_id INTEGER NOT NULL,
    period TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    issued_at TEXT,
    issued_by INTEGER,
    status TEXT NOT NULL DEFAULT 'draft',
    snapshot_json TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE fund_reserve_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
    project_id INTEGER NOT NULL REFERENCES projects(id),
    reserve_amount REAL NOT NULL DEFAULT 0,
    initial_check REAL NOT NULL DEFAULT 0,
    next_round_label TEXT,
    target_ownership_pct REAL,
    confidence TEXT NOT NULL DEFAULT 'medium',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE fund_scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
    kind TEXT NOT NULL,        -- reserves | waterfall
    name TEXT NOT NULL,
    description TEXT,
    inputs_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT NOT NULL DEFAULT '{}',
    created_by_user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE funnel_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  anon_id TEXT,
  session_id TEXT,
  client_ts INTEGER,
  path TEXT,
  referrer TEXT,
  device TEXT,
  browser TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  ref_code TEXT,
  lane TEXT,
  invite_type TEXT,
  props TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE fx_rates (
    currency   TEXT PRIMARY KEY,            -- ISO 4217 (USD, EUR, GBP, ...)
    usd_rate   REAL NOT NULL,               -- 1 USD = `usd_rate` <currency>
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE google_oauth_tokens (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id),
  refresh_token   TEXT    NOT NULL,
  scope           TEXT    NOT NULL DEFAULT '',
  google_email    TEXT,
  google_sub      TEXT,
  last_synced_at  TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE hypotheses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- The founder-facing handle ("H1"). Stored rather than derived from row
    -- order: the canvas prints it on every card and in every receipts panel, so
    -- it is an identifier a person reads and repeats, and renumbering it when a
    -- sibling is retired would silently rewrite what they wrote down.
    code TEXT NOT NULL,
    claim TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    -- Retired, not deleted. The canvas draws "Retired" and "Retired claims"
    -- filters; a filter over a fact nothing stores is a control that does
    -- nothing. A hypothesis that was abandoned is also evidence about how the
    -- venture thought, which a DELETE would throw away.
    retired_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE hypothesis_pain_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hypothesis_id INTEGER NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
    pain_group_id INTEGER NOT NULL REFERENCES pain_groups(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ic_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  project_id INTEGER REFERENCES projects(id),
  deal_id INTEGER,
  title TEXT NOT NULL,
  memo TEXT,
  terms_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | voting | decided
  decision TEXT,                          -- invest | pass | defer
  outcome TEXT,                           -- open | vindicated | regret
  created_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, dd_case_id INTEGER REFERENCES dd_cases(id), company_id INTEGER);

CREATE TABLE ic_meeting_attendees (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id   INTEGER NOT NULL REFERENCES ic_meetings(id),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  rsvp         TEXT    NOT NULL DEFAULT 'invited',
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(meeting_id, user_id)
);

CREATE TABLE ic_meetings (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT    NOT NULL UNIQUE,
  title              TEXT    NOT NULL,
  agenda             TEXT,
  start_at           TEXT    NOT NULL,
  duration_min       INTEGER NOT NULL DEFAULT 60,
  deal_id            INTEGER REFERENCES deals(id),
  organizer_user_id  INTEGER NOT NULL REFERENCES users(id),
  location_kind      TEXT    NOT NULL DEFAULT 'video',
  location_uri       TEXT,
  status             TEXT    NOT NULL DEFAULT 'scheduled',
  cancelled_at       TEXT,
  cancel_reason      TEXT,
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE ic_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ic_decision_id INTEGER NOT NULL REFERENCES ic_decisions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  vote TEXT NOT NULL,                     -- yes | no | abstain
  rationale TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ic_decision_id, user_id)
);

CREATE TABLE id_sequences (name TEXT PRIMARY KEY, next_value INTEGER NOT NULL DEFAULT 1);

CREATE TABLE impersonation_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL, target_user_id INTEGER NOT NULL, context TEXT, started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT);

CREATE TABLE incorporations (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                INTEGER NOT NULL,
      project_id             INTEGER NOT NULL,
      jurisdiction_id        TEXT NOT NULL,
      company_name           TEXT NOT NULL,
      registered_agent_name  TEXT,
      registered_agent_address TEXT,
      amount_cents           INTEGER NOT NULL,
      currency               TEXT NOT NULL DEFAULT 'usd',
      stripe_session_id      TEXT UNIQUE,
      stripe_payment_intent  TEXT,
      status                 TEXT NOT NULL DEFAULT 'pending_payment',
      created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      paid_at                TIMESTAMP
    );

CREATE TABLE insight_digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  digest_date TEXT NOT NULL,
  body_json TEXT NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (digest_date)
);

CREATE TABLE insight_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  is_subscribed INTEGER NOT NULL DEFAULT 1,
  cadence TEXT NOT NULL DEFAULT 'weekly',
  last_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE integration_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id    INTEGER NOT NULL,
  user_id           INTEGER NOT NULL,
  provider_key      TEXT NOT NULL,
  direction         TEXT NOT NULL,                          -- inbound|outbound|internal
  event_type        TEXT NOT NULL,                          -- connect|sync|push|webhook|disconnect|error|oauth_callback
  status            TEXT NOT NULL,                          -- ok|error
  http_status       INTEGER,
  request_summary   TEXT,
  response_summary  TEXT,
  external_id       TEXT,
  payload_json      TEXT,                                   -- redacted; never raw secrets
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE integration_waitlist (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  provider_key  TEXT NOT NULL,
  notes         TEXT,
  notified_at   TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, provider_key)
);

CREATE TABLE integrations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                   TEXT NOT NULL UNIQUE,
  user_id               INTEGER NOT NULL,
  provider_key          TEXT NOT NULL,
  display_name          TEXT,
  status                TEXT NOT NULL DEFAULT 'active',     -- active|paused|error|disconnected
  auth_type             TEXT NOT NULL,                      -- api_key|oauth2|webhook
  credentials_enc       TEXT,                               -- v1.<b64> (services/columnCipher.ts)
  webhook_secret_enc    TEXT,
  config_json           TEXT,                               -- non-secret per-conn config
  capabilities_json     TEXT,                               -- ["push_deals","pull_contacts"]
  scopes_json           TEXT,                               -- granted oauth scopes
  external_account_id   TEXT,
  external_account_name TEXT,
  last_synced_at        TIMESTAMP,
  last_error            TEXT,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, provider_key)
);

CREATE TABLE interview_pain_severities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    interview_id INTEGER NOT NULL REFERENCES discovery_interviews(id) ON DELETE CASCADE,
    phrase_norm TEXT NOT NULL,
    severity TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE intro_credit_ledger (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- +N grant / -1 spend.
    delta       INTEGER NOT NULL,
    bucket      TEXT NOT NULL CHECK (bucket IN ('allowance', 'purchased', 'referral')),
    kind        TEXT NOT NULL CHECK (kind IN
                ('monthly_grant', 'purchase', 'referral_reward', 'spend', 'admin_adjust')),
    -- Idempotency key payload: 'month:YYYY-MM' | 'pi:<id>' | 'referral:<id>'
    -- | 'intro:<proposition uid>' | free-form for admin_adjust.
    source_ref  TEXT NOT NULL,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE intro_propositions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    uid              TEXT UNIQUE NOT NULL,
    -- The user RECEIVING the proposition (owns the accept/decline decision).
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The counterpart being proposed.
    target_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
    -- Composite 0..100 match score at generation time.
    score            REAL NOT NULL DEFAULT 0,
    -- JSON: { reasons[], shared_values[], complementary_skills[], archetypes{},
    --         jurisdiction{}, specializations[], relationship_context, components{} }
    breakdown_json   TEXT,
    -- 'matching' (engine-generated) | 'reciprocal' (mirror of the counterpart's
    -- row) | 'admin' (hand-curated).
    source           TEXT NOT NULL DEFAULT 'matching',
    expires_at       TEXT,
    responded_at     TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE investor_dealroom_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_user_id INTEGER NOT NULL,
  deal_id INTEGER NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, company_id INTEGER,
  UNIQUE(investor_user_id, deal_id)
);

CREATE TABLE investor_introductions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  investor_user_id INTEGER NOT NULL,
  founder_user_id INTEGER,
  founder_id INTEGER,
  project_id INTEGER,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  quarter TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
, company_id INTEGER);

CREATE TABLE investor_portfolio_holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_user_id INTEGER NOT NULL,
  company_name TEXT NOT NULL,
  ticker TEXT,
  investment_date TEXT,
  amount REAL,
  instrument TEXT,
  current_valuation REAL,
  source TEXT DEFAULT 'csv',
  data_import_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE investor_profiles (
  user_id              INTEGER PRIMARY KEY,
  investor_type        TEXT,
  sectors_json         TEXT NOT NULL DEFAULT '[]',
  stages_json          TEXT NOT NULL DEFAULT '[]',
  geos_json            TEXT NOT NULL DEFAULT '[]',
  ticket_band          TEXT,
  ticket_min_usd       INTEGER,
  ticket_max_usd       INTEGER,
  thesis_text          TEXT,
  thesis_keywords_json TEXT NOT NULL DEFAULT '[]',
  contribute_to_signals INTEGER NOT NULL DEFAULT 1,
  completed_at         TIMESTAMP,
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
, anti_thesis_sectors_json TEXT NOT NULL DEFAULT '[]', anti_thesis_stages_json TEXT NOT NULL DEFAULT '[]', value_weights_json TEXT NOT NULL DEFAULT '{}', accreditation_status TEXT, country TEXT, firm_name TEXT, lp_intent TEXT, lp_target_usd INTEGER, notes TEXT);

CREATE TABLE investor_seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  primary_user_id INTEGER NOT NULL,
  seat_email TEXT NOT NULL,
  seat_user_id INTEGER,
  invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMP,
  revoked_at TIMESTAMP,
  invite_token TEXT,
  UNIQUE(primary_user_id, seat_email)
);

CREATE TABLE investor_signals_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  computed_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  period_start  TIMESTAMP,
  period_end    TIMESTAMP,
  n_total       INTEGER NOT NULL DEFAULT 0,
  payload_json  TEXT NOT NULL
);

CREATE TABLE investors (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL, user_id INTEGER, investor_type TEXT NOT NULL DEFAULT 'angel', accreditation_status TEXT NOT NULL DEFAULT 'unverified', check_size_min REAL, check_size_max REAL, sector_focus TEXT, stage_focus TEXT, notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE invoice_email_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key        TEXT NOT NULL UNIQUE,
      kind              TEXT NOT NULL,
      stripe_invoice_id TEXT,
      recipient         TEXT,
      sent_at           TIMESTAMP,
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE invoice_number_seq (
    year       TEXT PRIMARY KEY,
    last_value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE job_applications (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     posting_id     INTEGER NOT NULL REFERENCES job_postings(id),
     user_id        INTEGER REFERENCES users(id),
     name           TEXT,
     email          TEXT NOT NULL,
     cover_note     TEXT,
     linkedin_url   TEXT,
     portfolio_url  TEXT,
     resume_key     TEXT,
     resume_name    TEXT,
     status         TEXT NOT NULL DEFAULT 'submitted',
     created_at     TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (posting_id, email)
   );

CREATE TABLE job_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  first_seen_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  result_json     TEXT
);

CREATE TABLE job_postings (
     id               INTEGER PRIMARY KEY AUTOINCREMENT,
     slug             TEXT NOT NULL UNIQUE,
     host_user_id     INTEGER REFERENCES users(id),
     project_id       INTEGER REFERENCES projects(id),
     title            TEXT NOT NULL,
     employment_type  TEXT NOT NULL DEFAULT 'full_time',
     location_text    TEXT,
     remote           INTEGER NOT NULL DEFAULT 0,
     seniority        TEXT NOT NULL DEFAULT 'mid',
     summary          TEXT,
     description      TEXT,
     status           TEXT NOT NULL DEFAULT 'draft',
     admin_published  INTEGER NOT NULL DEFAULT 0,
     review_notes     TEXT,
     created_at       TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
   );

CREATE TABLE kyc_partner_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  legal_name TEXT NOT NULL,
  jurisdiction TEXT,
  entity_type TEXT,
  contact_email TEXT,
  data_import_id INTEGER,
  status TEXT DEFAULT 'pending_review',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "landing_pages" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  page_slug TEXT NOT NULL DEFAULT 'home',
  name TEXT NOT NULL,
  tagline TEXT,
  headline TEXT,
  subheadline TEXT,
  cta_text TEXT DEFAULT 'Join the waitlist',
  logo_url TEXT,
  logo_svg TEXT,
  theme_color TEXT DEFAULT '#7c3aed',
  published INTEGER DEFAULT 0,
  views_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  palette_bg TEXT,
  palette_ink TEXT,
  font_pairing TEXT,
  palette_secondary TEXT,
  palette_accent TEXT,
  logo_asset_id TEXT,
  preview_token TEXT,
  audience_customer_headline TEXT,
  audience_customer_body TEXT,
  audience_customer_cta TEXT,
  audience_partner_headline TEXT,
  audience_partner_body TEXT,
  audience_partner_cta TEXT,
  audience_investor_headline TEXT,
  audience_investor_body TEXT,
  audience_investor_cta TEXT,
  template TEXT,
  hero_media_url TEXT,
  product_screenshot_url TEXT,
  audience_advisor_headline TEXT,
  audience_advisor_body TEXT,
  audience_advisor_cta TEXT,
  audience_mentor_headline TEXT,
  audience_mentor_body TEXT,
  audience_mentor_cta TEXT,
  audience_cofounder_headline TEXT,
  audience_cofounder_body TEXT,
  audience_cofounder_cta TEXT,
  audience TEXT,
  goal TEXT,
  template_kit TEXT,
  content_json TEXT
);

CREATE TABLE legal_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      content TEXT,
      file_url TEXT,
      generated_by INTEGER,
      signed_by INTEGER,
      version INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    , fund_id INTEGER REFERENCES vc_funds(id));

CREATE TABLE legal_obligations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  obligation_key TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,         -- 1=must satisfy, 0=optional
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMP,
  evidence_envelope_uuid TEXT,
  evidence_meta TEXT,                           -- JSON: provider refs etc.
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, obligation_key)
);

CREATE TABLE legal_template_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      body_md TEXT NOT NULL,
      merge_fields TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      UNIQUE(template_id, version)
    );

CREATE TABLE legal_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'gp',
      body_md TEXT NOT NULL DEFAULT '',
      merge_fields TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_stub INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      updated_by INTEGER
    );

CREATE TABLE licence_admins (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    licence_id INTEGER NOT NULL REFERENCES territory_licences(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 'principal' is the named counterparty on the contract; 'delegate' is
    -- someone they have added. Both read the licence; only HQ writes it, so
    -- the distinction is descriptive today and load-bearing when delegation
    -- lands (see the Team · Authority canvas).
    admin_role TEXT NOT NULL DEFAULT 'principal'
               CHECK (admin_role IN ('principal', 'delegate')),
    -- Who at HQ made the assignment, and when. A licence administrator is a
    -- contractual fact; it needs the same audit trail as the licence itself.
    granted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE licence_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    licence_id   INTEGER NOT NULL REFERENCES territory_licences(id) ON DELETE CASCADE,
    event        TEXT NOT NULL
                 CHECK (event IN ('created', 'territory_changed', 'seats_changed',
                                  'terms_changed', 'activated', 'suspended',
                                  'reinstated', 'renewed', 'terminated')),
    -- JSON: whatever the event changed, before and after.
    detail_json  TEXT,
    note         TEXT,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE licence_seats (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    licence_id INTEGER NOT NULL REFERENCES territory_licences(id) ON DELETE CASCADE,
    seat_type  TEXT NOT NULL
               CHECK (seat_type IN ('founder', 'investor', 'advisor', 'partner')),
    seats_licensed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE licence_territories (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    licence_id   INTEGER NOT NULL REFERENCES territory_licences(id) ON DELETE CASCADE,
    -- ISO 3166-1 alpha-2, upper case.
    country_code TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE limited_partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
    commitment_amount REAL NOT NULL DEFAULT 0,
    invested_amount REAL NOT NULL DEFAULT 0,
    returns REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'committed',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, lpa_signed INTEGER NOT NULL DEFAULT 0, lpa_signed_at TEXT, commitment_date TEXT, distribution_history TEXT, name  TEXT, email TEXT);

CREATE TABLE liquidity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subsidiary_id INTEGER REFERENCES subsidiaries(id),
    deal_id INTEGER REFERENCES deals(id),
    event_type TEXT NOT NULL,                    -- secondary_sale | m&a_exit | ipo_prep | distribution
    status TEXT NOT NULL DEFAULT 'listed',       -- listed | matched | executed | cancelled
    valuation_cents INTEGER NOT NULL DEFAULT 0,
    shares_offered REAL NOT NULL DEFAULT 0,
    buyer_type TEXT,                             -- secondary_fund | strategic | lp_rollover
    executed_price_cents INTEGER,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    executed_at TEXT
);

CREATE TABLE lp_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    -- Slug, not fund_id: an admin can rename a fund at any moment, and the
    -- workspace already resolves this fund by slug (SPINOUT_FUND_SLUG) for the
    -- same reason. Applications are per (applicant, fund).
    fund_slug TEXT NOT NULL DEFAULT 'spinout-fund-i',

    investor_type TEXT NOT NULL,
    -- DOLLARS. See the header note on units.
    target_commitment REAL,
    -- JSON array of informational preference areas. They never restrict fund
    -- strategy; they exist so the GP can route the conversation.
    preference_areas TEXT NOT NULL DEFAULT '[]',
    -- Rule 501 self-certification. Stored because it is a legal precondition
    -- of participation, and the route refuses a submission without it.
    accredited INTEGER NOT NULL DEFAULT 0,
    note TEXT,

    -- pending | approved | declined | withdrawn. Only the GP moves an
    -- application off 'pending'; an applicant may withdraw their own.
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    -- The reason recorded at review. Returned to the applicant on their own
    -- row: someone who was declined is entitled to know why.
    review_note TEXT,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE lp_investors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    committed_capital REAL NOT NULL DEFAULT 0,
    called_capital REAL NOT NULL DEFAULT 0,
    fund_name TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE lp_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
  period TEXT NOT NULL,                    -- e.g. '2026-Q2'
  status TEXT NOT NULL DEFAULT 'draft',    -- draft | published
  nav REAL, called REAL, distributed REAL,
  dpi REAL, tvpi REAL, irr REAL,
  narrative TEXT,
  created_by INTEGER REFERENCES users(id),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fund_id, period)
);

CREATE TABLE magic_link_tokens (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        email       TEXT NOT NULL,
        token_hash  TEXT NOT NULL UNIQUE,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at  TIMESTAMP NOT NULL,
        used_at     TIMESTAMP,
        ip          TEXT,
        user_agent  TEXT
      );

CREATE TABLE market_intel_aggregates ( id INTEGER PRIMARY KEY AUTOINCREMENT, extractor TEXT NOT NULL, dimension_key TEXT NOT NULL, period_key TEXT NOT NULL, n INTEGER NOT NULL, value REAL, payload_json TEXT, computed_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(extractor, dimension_key, period_key) );

CREATE TABLE market_intel_embeddings ( id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, persona TEXT NOT NULL, kind TEXT NOT NULL, source_question_id TEXT, vector BLOB NOT NULL, norm REAL NOT NULL, content_hash TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, kind) );

CREATE TABLE market_intel_indexes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sector TEXT NOT NULL,
  geo TEXT NOT NULL DEFAULT 'global',
  period_key TEXT NOT NULL,            -- e.g. '2026-05' (month) or '2026W19'
  -- One of: demand | supply | capital | talent | research | sentiment | composite
  dimension TEXT NOT NULL,
  value REAL NOT NULL,                 -- 0..100 composite
  delta_pct REAL,                      -- vs prior period
  source_count INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sector, geo, period_key, dimension)
);

CREATE TABLE market_intel_quota (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  day TEXT NOT NULL,                   -- YYYY-MM-DD
  calls INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 1000,
  last_429_at TEXT,
  UNIQUE(source_key, day)
);

CREATE TABLE market_intel_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,            -- e.g. 'sec_edgar', 'github_trending'
  sector TEXT NOT NULL,                -- canonical sector slug
  geo TEXT,                            -- ISO country code or 'global'
  metric_key TEXT NOT NULL,            -- e.g. 'demand', 'capital', 'talent_jobs'
  metric_value REAL NOT NULL,          -- normalised 0..1 (or absolute when noted)
  raw_value REAL,                      -- pre-normalisation for debugging
  unit TEXT,                           -- 'index', 'usd', 'count', 'pct'
  ts TEXT NOT NULL,                    -- ISO timestamp of the observation
  citation_url TEXT,                   -- public URL for the citation rail
  payload_json TEXT,                   -- raw provider payload (truncated)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE market_intel_signals ( id INTEGER PRIMARY KEY AUTOINCREMENT, extractor TEXT NOT NULL, user_id INTEGER NOT NULL, persona TEXT NOT NULL, advisor_answer_id INTEGER, question_id TEXT, sector TEXT, geo TEXT, period_key TEXT NOT NULL, payload_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(extractor, user_id, advisor_answer_id, content_hash) );

CREATE TABLE market_intel_snippets ( id INTEGER PRIMARY KEY AUTOINCREMENT, extractor TEXT NOT NULL, dimension_key TEXT NOT NULL, period_key TEXT NOT NULL, paraphrase TEXT NOT NULL, origin_redacted INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')) );

CREATE TABLE market_intel_watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sector TEXT NOT NULL,
  geo TEXT NOT NULL DEFAULT 'global',
  cadence TEXT NOT NULL DEFAULT 'weekly',  -- 'weekly' | 'monthly'
  created_at TEXT NOT NULL DEFAULT (datetime('now')), last_sent_at TEXT, last_period_key TEXT, last_composite REAL,
  UNIQUE(user_id, sector, geo)
);

CREATE TABLE marketplace_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      title TEXT,
      bio TEXT,
      skills TEXT,
      hourly_rate_cents INTEGER,
      availability TEXT DEFAULT 'available',
      rating REAL DEFAULT 0,
      review_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE match_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER,
      user_id INTEGER NOT NULL,
      target_user_id INTEGER,
      score_type TEXT NOT NULL,
      score REAL NOT NULL,
      explanation TEXT,
      model TEXT,
      breakdown TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE message_thread_participants (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id    INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL means "has never opened it", which is different from "read nothing
  -- since epoch" only in intent — but the intent is what the UI shows.
  last_read_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (thread_id, user_id)
);

CREATE TABLE message_threads (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT NOT NULL UNIQUE,
  subject            TEXT,
  -- What the conversation is about. NULL/NULL is a direct message.
  subject_type       TEXT,      -- introduction | match | engagement | service | session | job
  subject_id         INTEGER,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  status             TEXT NOT NULL DEFAULT 'open',   -- open | archived
  last_message_at    TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT NOT NULL UNIQUE,
  thread_id      INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_user_id INTEGER NOT NULL REFERENCES users(id),
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE metric_targets (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, metric_key TEXT NOT NULL, target_value REAL NOT NULL, direction TEXT NOT NULL DEFAULT 'up' CHECK (direction IN ('up','down')), label TEXT, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (project_id, metric_key));

CREATE TABLE metrics_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      snapshot_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      key_metrics TEXT,
      traction_score REAL,
      ai_review TEXT,
      created_by INTEGER
    , arr REAL, cac REAL, ltv REAL, monthly_churn_pct REAL, new_users INTEGER, net_burn REAL, cash_balance REAL, headcount INTEGER, nrr_pct REAL, paying_accounts INTEGER);

CREATE TABLE mi_pro_subscriptions (
  user_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'free',
  subscription_id TEXT,
  plan TEXT,
  period_end TEXT,
  stripe_customer_id TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE microsoft_oauth_tokens (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id),
  refresh_token   TEXT    NOT NULL,
  scope           TEXT    NOT NULL DEFAULT '',
  microsoft_email TEXT,
  microsoft_sub   TEXT,
  last_synced_at  TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE mvp_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    added_value TEXT NOT NULL DEFAULT 'Medium',
    effort TEXT NOT NULL DEFAULT 'M',
    priority_reason TEXT,
    delivery_status TEXT NOT NULL DEFAULT 'Backlog',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE mvp_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      assigned_to INTEGER,
      status TEXT NOT NULL DEFAULT 'todo',
      ai_generated INTEGER DEFAULT 0,
      due_date TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE network_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  company TEXT,
  title TEXT,
  phone TEXT,
  notes TEXT,
  source TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE network_profiles (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT NOT NULL,
        kind           TEXT NOT NULL DEFAULT 'mentor',
        role           TEXT,
        bio            TEXT,
        linkedin_url   TEXT,
        photo_r2_key   TEXT,
        skills_json    TEXT NOT NULL DEFAULT '[]',
        display_order  INTEGER NOT NULL DEFAULT 0,
        is_active      INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
      , company TEXT);

CREATE TABLE notification_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  payload TEXT,
  category TEXT,
  -- 'digest'        — buffered because the user opted into a daily/weekly roll-up
  -- 'quiet_hours'   — buffered because the user is currently inside their quiet window
  reason TEXT NOT NULL DEFAULT 'digest',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  flushed_at TIMESTAMP,
  flushed_digest_id TEXT
);

CREATE TABLE notifications (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         user_id INTEGER NOT NULL,
         kind TEXT NOT NULL,
         title TEXT NOT NULL,
         body TEXT,
         link TEXT,
         meta TEXT,
         dedupe_key TEXT,
         read_at TIMESTAMP,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
       );

CREATE TABLE notifications_inbox (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         user_id INTEGER NOT NULL,
         type TEXT NOT NULL,
         title TEXT NOT NULL,
         body TEXT,
         link TEXT,
         payload TEXT,
         channel TEXT DEFAULT 'in_app',
         read_at TIMESTAMP,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
       , category TEXT, severity TEXT DEFAULT 'info', cta_url TEXT, template_key TEXT);

CREATE TABLE oauth_state_tokens (state TEXT PRIMARY KEY, user_id INTEGER NOT NULL, provider TEXT NOT NULL, pkce_verifier TEXT, extra_json TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, consumed_at TIMESTAMP, expires_at TEXT NOT NULL DEFAULT '');

CREATE TABLE onboarding_checklist_progress (
         user_id INTEGER NOT NULL,
         item_key TEXT NOT NULL,
         completed_at DATETIME,
         skipped_at DATETIME,
         source TEXT,
         PRIMARY KEY (user_id, item_key)
       );

CREATE TABLE onboarding_meta (
         user_id INTEGER PRIMARY KEY,
         tour_seen_at DATETIME,
         celebration_shown_at DATETIME,
         panel_collapsed INTEGER DEFAULT 0,
         updated_at DATETIME DEFAULT (datetime('now'))
       );

CREATE TABLE onboarding_progress (
         user_id INTEGER PRIMARY KEY,
         flow TEXT NOT NULL,
         step INTEGER NOT NULL DEFAULT 0,
         total_steps INTEGER NOT NULL DEFAULT 0,
         data TEXT,
         completed_at TEXT,
         created_at TEXT DEFAULT (datetime('now')),
         updated_at TEXT DEFAULT (datetime('now'))
       );

CREATE TABLE orders (
    id                TEXT PRIMARY KEY,
    order_ref         TEXT NOT NULL UNIQUE,
    user_id           INTEGER NOT NULL REFERENCES users(id),
    status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
    currency          TEXT NOT NULL DEFAULT 'usd',
    subtotal_cents    INTEGER NOT NULL DEFAULT 0,
    discount_cents    INTEGER NOT NULL DEFAULT 0,
    vat_cents         INTEGER NOT NULL DEFAULT 0,
    total_cents       INTEGER NOT NULL DEFAULT 0,
    promo_code        TEXT,
    billing_country   TEXT,
    payment_intent_id TEXT,
    items_json        TEXT NOT NULL DEFAULT '[]',
    invoice_number    TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at           TEXT
);

CREATE TABLE pain_group_aliases (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
         group_id INTEGER NOT NULL REFERENCES pain_groups(id) ON DELETE CASCADE,
         phrase_norm TEXT NOT NULL,
         display_phrase TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       );

CREATE TABLE pain_groups (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
         title TEXT NOT NULL,
         sort_order INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       );

CREATE TABLE pairwise_ndas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Convention: party_a is ALWAYS the founder user_id, party_b is the
  -- investor user_id. The seeder enforces this so UNIQUE works correctly.
  party_a_user_id INTEGER NOT NULL,
  party_b_user_id INTEGER NOT NULL,
  intermediary TEXT NOT NULL DEFAULT 'axal',
  nda_envelope_uuid TEXT,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending|partially_signed|active|expired|revoked
  valid_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, signers_json TEXT NOT NULL DEFAULT '[]', voided_at TIMESTAMP, voided_reason TEXT,
  UNIQUE(party_a_user_id, party_b_user_id)
);

CREATE TABLE partner_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  slot_id INTEGER NOT NULL,
  partner_id INTEGER NOT NULL,
  founder_user_id INTEGER NOT NULL,
  topic TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  cancel_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (slot_id, founder_user_id)
);

CREATE TABLE partner_deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invitation_id INTEGER REFERENCES partner_invitations(id),
  user_id INTEGER REFERENCES users(id),                -- NULL until signed
  -- equity_partnership | services_partnership | deal_sourcing_revshare | capital_partnership | custom
  deal_type TEXT NOT NULL,
  proposal_json TEXT NOT NULL,                         -- {summary, terms{...}, tiers{...}}
  granted_tier_founder TEXT,                           -- e.g. founder_pro / founder_elite / NULL
  granted_tier_investor TEXT,                          -- professional / institutional / NULL
  term_months INTEGER NOT NULL DEFAULT 12,
  referral_code TEXT UNIQUE,                           -- one-time partner code
  envelope_id INTEGER,
  -- proposed | awaiting_signature | active | terminated | expired
  status TEXT NOT NULL DEFAULT 'proposed',
  activated_at TIMESTAMP,
  expires_at TIMESTAMP,
  terminated_at TIMESTAMP,
  terminated_by_user_id INTEGER REFERENCES users(id),
  termination_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE partner_fit_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  kind TEXT NOT NULL
    CHECK (kind IN ('budget_floor', 'sector_declined', 'capability_absent', 'best_fit')),
  -- For `budget_floor`. Integer cents, like every new money column in 208.
  -- NULL for the other kinds, which are not amounts.
  floor_cents INTEGER,
  value TEXT,
  -- Why, in the firm's own words. This is the sentence a pass quotes, so an
  -- empty one produces the silence the zone exists to replace.
  statement TEXT,
  referred_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE partner_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  invited_by_user_id INTEGER NOT NULL REFERENCES users(id),
  -- JSON array of EQUITY_PARTNERSHIP|SERVICES_PARTNERSHIP|DEAL_SOURCING_REVSHARE|CAPITAL_PARTNERSHIP|CUSTOM
  allowed_deal_types TEXT NOT NULL DEFAULT '[]',
  personal_message TEXT,
  -- sent | viewed | profiled | proposed | selected | finalized | signed | expired | revoked
  status TEXT NOT NULL DEFAULT 'sent',
  expires_at TIMESTAMP NOT NULL,
  viewed_at TIMESTAMP,
  signed_at TIMESTAMP,
  resulting_user_id INTEGER REFERENCES users(id),
  resulting_deal_id INTEGER,
  envelope_id INTEGER,
  revoked_at TIMESTAMP,
  revoked_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE partner_office_hour_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  partner_id INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  meeting_url TEXT,
  notes TEXT,
  is_cancelled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE partner_profiles (
        email TEXT PRIMARY KEY,
        user_id INTEGER,
        persona TEXT,
        legal_entity_name TEXT,
        entity_type TEXT,
        ein TEXT,
        signatory_name TEXT,
        signatory_title TEXT,
        company_established INTEGER,
        chat_history TEXT,
        extracted_data TEXT,
        admin_status TEXT DEFAULT 'pending',
        agreement_type TEXT,
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      , founder_track TEXT, current_stage TEXT, partnership_goal TEXT, existing_jurisdiction TEXT, product_strategy TEXT, existing_investors TEXT);

CREATE TABLE partner_proof_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  proof_item_id INTEGER NOT NULL REFERENCES partner_proof_items(id),
  -- Who is consenting, in their own words rather than resolved from a join:
  -- the person who agrees may not be the account that holds the engagement,
  -- and recording the account would attribute consent to someone who did not
  -- give it.
  consenter_name TEXT NOT NULL,
  consenter_email TEXT,
  consenter_role TEXT,
  requested_at TEXT,
  requested_by INTEGER,
  request_token TEXT UNIQUE,
  consent_given INTEGER NOT NULL DEFAULT 0,
  consent_given_at TEXT,
  -- The exact words agreed to. Consent to "a case study" and consent to "a
  -- case study naming our revenue" are different consents.
  consent_text TEXT,
  consent_captured_by INTEGER,
  withdrawn_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE partner_proof_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  engagement_id INTEGER REFERENCES engagements(id),
  kind TEXT NOT NULL DEFAULT 'case_study'
    CHECK (kind IN ('case_study', 'outcome', 'testimonial')),
  title TEXT NOT NULL,
  detail TEXT,
  -- The firm's own claim about the result. It is NOT evidence until a consent
  -- row confirms it, and the zone must render it as a claim until then.
  outcome_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE partner_referral_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_deal_id INTEGER NOT NULL REFERENCES partner_deals(id),
  redeemed_by_user_id INTEGER NOT NULL REFERENCES users(id),
  granted_tier_founder TEXT,
  granted_tier_investor TEXT,
  granted_until TIMESTAMP,
  attribution_kind TEXT NOT NULL DEFAULT 'referral',   -- referral | deal_sourcing_revshare
  redeemed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(partner_deal_id, redeemed_by_user_id)
);

CREATE TABLE partner_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_a_id INTEGER NOT NULL,
      partner_b_id INTEGER NOT NULL,
      relationship_type TEXT NOT NULL,
      strength_score REAL DEFAULT 50,
      metadata TEXT DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CHECK (partner_a_id < partner_b_id),
      CHECK (strength_score >= 0 AND strength_score <= 100)
    );

CREATE TABLE partner_retainers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  shape TEXT NOT NULL DEFAULT 'retainer'
    CHECK (shape IN ('retainer', 'embedded_seat')),
  cadence TEXT NOT NULL DEFAULT 'monthly'
    CHECK (cadence IN ('monthly', 'quarterly')),
  -- Integer cents. `engagements.price` beside it is REAL and grandfathered;
  -- this is new money and takes the dialect the schema is moving to.
  amount_cents INTEGER,
  -- What the client bought per period. NULL means the retainer is not sold by
  -- the hour, which is a different thing from zero hours and must read as one.
  retained_hours REAL,
  renews_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE partner_revshare_window_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  redemption_id INTEGER NOT NULL REFERENCES partner_referral_redemptions(id),
  threshold_days INTEGER NOT NULL,
  notified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(redemption_id, threshold_days)
);

CREATE TABLE partner_surfaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  -- `partners.id`: a surface belongs to the DIRECTORY ENTITY, the same key
  -- `quotes` and `engagements` already use. The other live convention keys on
  -- `users.id` for account-attached facts (perks, service_offerings); mixing
  -- the two in one feature is how a partner ends up seeing half their data.
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'directory'
    CHECK (kind IN ('directory', 'referral', 'outbound', 'content', 'event', 'other')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    company TEXT,
    email TEXT UNIQUE NOT NULL,
    specialization TEXT,
    referral_code TEXT UNIQUE,
    referrals_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
, directory_listed INTEGER NOT NULL DEFAULT 0, directory_featured INTEGER NOT NULL DEFAULT 0, directory_decided_at TEXT, directory_decided_by INTEGER, oh_when_to_book TEXT, oh_stage_fit TEXT, oh_session_outcome TEXT, oh_bring_json TEXT DEFAULT '[]', oh_guidance_updated_at TEXT);

CREATE TABLE passkeys (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL,
        credential_id TEXT NOT NULL UNIQUE,
        public_key    TEXT NOT NULL,
        counter       INTEGER NOT NULL DEFAULT 0,
        transports    TEXT,
        device_type   TEXT,
        backed_up     INTEGER NOT NULL DEFAULT 0,
        aaguid        TEXT,
        name          TEXT,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used_at  TIMESTAMP
      );

CREATE TABLE payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'requested',
      payout_method TEXT NOT NULL,
      payout_details TEXT,
      failure_reason TEXT,
      processed_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    );

CREATE TABLE perk_claims (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    uid          TEXT UNIQUE NOT NULL,
    perk_id      INTEGER NOT NULL REFERENCES perks(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Copied from the perk at claim time. A listing's price may change later;
    -- what this claim cost must not.
    credits_spent INTEGER NOT NULL DEFAULT 0,
    claimed_price_cents INTEGER,
    kind_at_claim TEXT NOT NULL DEFAULT 'credits',
    -- The issued redemption code, for fulfilment = 'code'.
    code         TEXT,
    -- Snapshot of the destination for 'link', so a later edit to the listing
    -- cannot silently redirect a claim already made.
    redeem_url   TEXT,
    status       TEXT NOT NULL DEFAULT 'issued'
                 CHECK (status IN ('issued', 'redeemed', 'expired', 'revoked')),
    expires_at   TEXT,
    redeemed_at  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE perk_credit_ledger (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- +N grant / −N spend.
    delta       INTEGER NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('grant', 'spend', 'refund', 'admin_adjust')),
    -- Idempotency key payload: 'perk:<claim uid>' for a spend or refund,
    -- free-form for a grant or an adjustment.
    source_ref  TEXT NOT NULL,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE perk_views (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    perk_id    INTEGER NOT NULL REFERENCES perks(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day        TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE perks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    uid            TEXT UNIQUE NOT NULL,
    -- The partner account that owns the listing. NULL for an admin-curated
    -- listing with no partner account behind it yet.
    partner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    partner_name   TEXT NOT NULL,
    category       TEXT NOT NULL,
    -- The headline, e.g. '3 months free business banking'.
    offer          TEXT NOT NULL,
    blurb          TEXT,
    -- The long-form terms shown in the claim drawer before anything is spent.
    detail         TEXT,
    -- How a claim is paid for:
    --   credits — debits `credits` from the caller's perk-credit balance
    --   tier    — included in a subscription tier; costs nothing, gated on it
    --   money   — a paid engagement; `price_cents` is quoted, invoiced offline
    kind           TEXT NOT NULL DEFAULT 'credits'
                   CHECK (kind IN ('credits', 'tier', 'money')),
    credits        INTEGER NOT NULL DEFAULT 0,
    -- Which tier includes it, when kind = 'tier'. Matches the ladder in
    -- middleware/requireTier.ts so the gate is the same one the rest of the
    -- product uses.
    required_tier  TEXT CHECK (required_tier IN ('free', 'growth', 'studio')),
    price_cents    INTEGER,
    -- What the founder receives on claim: a code, a link, or an introduction
    -- the partner follows up on.
    fulfilment     TEXT NOT NULL DEFAULT 'code'
                   CHECK (fulfilment IN ('code', 'link', 'intro')),
    -- Set only for 'link'. A 'code' perk's code is issued per claim below.
    redeem_url     TEXT,
    -- Total claims the partner will honour. NULL = uncapped.
    claim_cap      INTEGER,
    status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'in_review', 'live', 'paused', 'rejected')),
    -- Why a submission was rejected, shown back to the submitting partner.
    review_note    TEXT,
    reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at    TEXT,
    featured       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
, company_id INTEGER);

CREATE TABLE pipeline_vote_threshold_log (
       deal_id INTEGER PRIMARY KEY,
       fired_at TEXT DEFAULT CURRENT_TIMESTAMP
     );

CREATE TABLE pipeline_votes (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       deal_id INTEGER NOT NULL,
       user_id INTEGER NOT NULL,
       vote_type TEXT NOT NULL,
       weight INTEGER NOT NULL DEFAULT 1,
       comment TEXT,
       anonymous INTEGER DEFAULT 0,
       created_at TEXT DEFAULT CURRENT_TIMESTAMP,
       updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
       UNIQUE(deal_id, user_id)
     );

CREATE TABLE pitch_deck_share_tokens (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       deck_id INTEGER NOT NULL,
       token_hash TEXT NOT NULL UNIQUE,
       expires_at TEXT NOT NULL,
       used_at TEXT,
       created_by INTEGER,
       created_at TEXT DEFAULT (datetime('now'))
     , view_limit INTEGER NOT NULL DEFAULT 1, view_count INTEGER NOT NULL DEFAULT 0, last_viewed_at TEXT);

CREATE TABLE pitch_decks (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       project_id INTEGER NOT NULL,
       version INTEGER NOT NULL DEFAULT 1,
       slides TEXT NOT NULL,
       title TEXT,
       is_current INTEGER DEFAULT 1,
       created_by INTEGER,
       created_at TEXT DEFAULT (datetime('now'))
     );

CREATE TABLE portfolio_distributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  fund_id INTEGER REFERENCES vc_funds(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  distribution_date TEXT NOT NULL,                    -- YYYY-MM-DD
  amount REAL NOT NULL,                               -- positive magnitude; direction is implied by the table
  kind TEXT NOT NULL DEFAULT 'exit',                  -- exit | secondary | dividend | recapitalization
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE portfolio_health_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,        -- YYYY-MM-DD
  score INTEGER NOT NULL,             -- 0..100
  badge TEXT NOT NULL,                -- green|yellow|red
  intervention INTEGER NOT NULL DEFAULT 0,
  drivers_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, snapshot_date)
);

CREATE TABLE portfolio_kpi_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fund_id INTEGER REFERENCES vc_funds(id),            -- nullable = firm-wide default set
  kpi_key TEXT NOT NULL,                              -- matches a key inside portfolio_updates.kpis_json
  name TEXT NOT NULL,
  definition TEXT,                                    -- the wording companies are held to
  unit TEXT,                                          -- 'USD', '%', 'count', 'months'
  cadence TEXT NOT NULL DEFAULT 'quarterly',          -- monthly | quarterly
  required INTEGER NOT NULL DEFAULT 1,
  applies_to TEXT NOT NULL DEFAULT 'all',             -- 'all' or a stage label
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (fund_id, kpi_key)
);

CREATE TABLE portfolio_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  fund_id INTEGER REFERENCES vc_funds(id),            -- nullable = firm-level, mirrors portfolio_positions
  project_id INTEGER NOT NULL REFERENCES projects(id),
  as_of_date TEXT NOT NULL,                           -- YYYY-MM-DD, the date the mark speaks for
  fmv REAL NOT NULL,                                  -- OUR carrying value of the position
  post_money REAL,                                    -- company post-money at the marking event, if known
  event TEXT,                                         -- 'Series B', 'Annual review', 'Write-down'…
  -- How the mark was arrived at. Drives the "Mark basis" column in the
  -- LP export: a round-priced mark and a GP estimate must never look
  -- alike to an LP.
  basis TEXT NOT NULL DEFAULT 'gp_estimate',          -- round_price | secondary | gp_estimate | write_down | cost
  source TEXT,                                        -- free text provenance ('Series B term sheet', '409A')
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE portfolio_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  fund_id INTEGER REFERENCES vc_funds(id),   -- nullable = firm-level
  project_id INTEGER NOT NULL REFERENCES projects(id),
  round_name TEXT NOT NULL,                  -- 'Pre-Seed','Seed','Series A',…
  invested_amount REAL NOT NULL DEFAULT 0,
  shares REAL,
  price_per_share REAL,
  ownership_pct REAL,                        -- fully-diluted % after this round
  position_date TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE portfolio_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  period TEXT,                             -- e.g. '2026-06'
  title TEXT NOT NULL,
  body TEXT,
  kpis_json TEXT,                          -- { arr, mrr, burn, runway_months, headcount, cash }
  status TEXT NOT NULL DEFAULT 'submitted', -- draft | submitted
  submitted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE profile_archetypes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  persona         TEXT NOT NULL,
  archetype_slug  TEXT NOT NULL,
  archetype_label TEXT NOT NULL,
  traits_json     TEXT,
  confidence      REAL NOT NULL DEFAULT 0,
  distance        REAL NOT NULL DEFAULT 0,
  narrative       TEXT,
  computed_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE project_member_invitations ( id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'cofounder', status TEXT NOT NULL DEFAULT 'pending', source TEXT, invitee_user_id INTEGER, invitee_email TEXT, token_hash TEXT, cofounder_connection_id INTEGER, invited_by_user_id INTEGER, accepted_by_user_id INTEGER, expires_at TEXT, accepted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')) );

CREATE TABLE project_members ( id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'cofounder', status TEXT NOT NULL DEFAULT 'accepted', source TEXT, invitation_id INTEGER, cofounder_connection_id INTEGER, added_by_user_id INTEGER, accepted_at TEXT, removed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')) );

CREATE TABLE project_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      stage_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      end_date TIMESTAMP,
      metadata TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    description TEXT,
    sector TEXT,
    stage TEXT NOT NULL DEFAULT 'idea',
    status TEXT NOT NULL DEFAULT 'intake' CHECK (status IN ('intake', 'scoring', 'tier_1', 'tier_2', 'rejected', 'spinout', 'active')),
    playbook_week TEXT NOT NULL DEFAULT 'week_1' CHECK (playbook_week IN ('week_1', 'week_2', 'week_3', 'week_4', 'complete')),
    founder_id INTEGER REFERENCES founders(id),
    entity_id INTEGER REFERENCES entities(id),
    problem_statement TEXT,
    solution TEXT,
    why_now TEXT,
    tam REAL,
    sam REAL,
    users_count INTEGER,
    revenue REAL,
    growth_signals TEXT,
    cost_to_mvp REAL,
    funding_needed REAL,
    use_of_funds TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, hubspot_company_id TEXT, hubspot_primary_contact_id TEXT, sf_account_id TEXT, sf_primary_contact_id TEXT, crunchbase_uuid TEXT, crunchbase_data_json TEXT, crunchbase_synced_at TEXT, founded_year INTEGER, hq TEXT, employee_count TEXT, last_funding_round TEXT, total_funding REAL, deleted_at TIMESTAMP, tagline TEXT, logo_url TEXT, som REAL, cac REAL, gross_margin_pct REAL, contact_email TEXT, vision TEXT, traction_summary TEXT, data_room_url TEXT, data_room_nda_required INTEGER NOT NULL DEFAULT 0, mrr REAL, paying_customers INTEGER, first_payment_date TEXT, paid_pilot_status TEXT, product_demo_video_url TEXT, product_demo_live_url TEXT, product_demo_caption TEXT, product_demo_screenshot_url TEXT, website TEXT, lifecycle_stage TEXT, lifecycle_manual_checks TEXT, use_of_funds_meta TEXT, incorporation_meta TEXT, cofounder_decision_meta TEXT, company_id INTEGER);

CREATE TABLE promo_codes (id TEXT PRIMARY KEY, code TEXT NOT NULL, code_normalized TEXT NOT NULL, coupon_id TEXT NOT NULL, percent_off REAL, amount_off INTEGER, currency TEXT, duration TEXT NOT NULL DEFAULT 'once', product_ids_json TEXT NOT NULL DEFAULT '[]', max_redemptions INTEGER, times_redeemed INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, expires_at TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE promo_redemptions (id INTEGER PRIMARY KEY AUTOINCREMENT, promo_id TEXT NOT NULL, user_id INTEGER NOT NULL, payment_intent_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE provider_oauth_keys (
  provider_key       TEXT PRIMARY KEY,
  client_id          TEXT NOT NULL,
  client_secret_enc  TEXT NOT NULL,
  created_by_user_id INTEGER,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id INTEGER,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public_pageviews (
        day TEXT NOT NULL,
        path TEXT NOT NULL,
        views INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, path)
      );

CREATE TABLE queue_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,
    payload TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, started_at TEXT, completed_at TEXT, max_retries INTEGER NOT NULL DEFAULT 3, dead_at TEXT);

CREATE TABLE quote_negotiations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  quote_id INTEGER NOT NULL REFERENCES quotes(id),
  stage TEXT NOT NULL DEFAULT 'scoping'
    CHECK (stage IN ('scoping', 'terms', 'legal', 'ready_to_sign', 'closed')),
  ball TEXT NOT NULL DEFAULT 'them'
    CHECK (ball IN ('us', 'them')),
  open_question TEXT,
  -- Set by whoever records a move. "Days stalled" is this subtracted from now
  -- at read time; storing the age would be a number that is wrong by one day
  -- every day nobody writes to the row.
  last_moved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quote_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  negotiation_id INTEGER NOT NULL REFERENCES quote_negotiations(id),
  label TEXT NOT NULL,
  our_position TEXT,
  their_position TEXT,
  landing TEXT,
  state TEXT NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'agreed', 'conceded', 'refused')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  need_id INTEGER NOT NULL,
  rfp_id INTEGER,
  partner_id INTEGER NOT NULL,
  price REAL NOT NULL,
  timeline_weeks INTEGER,
  deliverables TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'submitted', -- submitted|accepted|rejected|withdrawn
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, company_id INTEGER,
  UNIQUE (need_id, partner_id)
);

CREATE TABLE raise_closes (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL,
       project_id INTEGER NOT NULL,
       round_id INTEGER NOT NULL,
       name TEXT NOT NULL,
       sequence INTEGER NOT NULL DEFAULT 0,
       state TEXT NOT NULL DEFAULT 'planned',
       target_date TEXT,
       closed_date TEXT,
       notes TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     );

CREATE TABLE raise_investor_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL,
  round_id INTEGER,
  subject TEXT NOT NULL,
  body TEXT,
  recipients_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE raise_pro_rata (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL,
       project_id INTEGER NOT NULL,
       round_id INTEGER NOT NULL,
       holder_name TEXT NOT NULL,
       holder_email TEXT,
       prior_stake_pct REAL NOT NULL DEFAULT 0,
       taking_amount REAL,
       state TEXT NOT NULL DEFAULT 'offered',
       offered_at TEXT,
       responded_at TEXT,
       notes TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     );

CREATE TABLE raise_prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL,
  contact_id INTEGER,
  name TEXT,
  email TEXT,
  firm TEXT,
  stage TEXT NOT NULL DEFAULT 'to_contact',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, amount REAL, close_id INTEGER, commit_status TEXT, instrument TEXT);

CREATE TABLE raise_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL,
  name TEXT,
  target_amount REAL,
  close_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, pro_rata_reserved REAL, pre_money REAL);

CREATE TABLE rate_limit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    endpoint TEXT NOT NULL,
    requests_in_window INTEGER NOT NULL DEFAULT 0,
    blocked INTEGER NOT NULL DEFAULT 0,
    bucket TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE reference_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  deal_id INTEGER NOT NULL,
  reference_name TEXT NOT NULL,
  reference_email TEXT,
  reference_role TEXT,
  relationship TEXT,
  scheduled_at TEXT,
  consent_given INTEGER NOT NULL DEFAULT 0,
  consent_given_at TEXT,
  consent_text TEXT,
  consent_captured_by INTEGER,
  recording_file_key TEXT,
  recording_size_bytes INTEGER,
  recording_content_type TEXT,
  recording_uploaded_at TEXT,
  transcript TEXT,
  transcribed_at TEXT,
  summary_json TEXT,
  summarized_at TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE referral_chains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      root_referrer_id INTEGER NOT NULL,
      level INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      multiplier_bps INTEGER NOT NULL DEFAULT 10000,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE referral_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_user_id INTEGER NOT NULL,
      recipient_email TEXT NOT NULL,
      recipient_name TEXT,
      referral_code TEXT NOT NULL,
      personal_message TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      failure_reason TEXT,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      opened_at TIMESTAMP,
      signed_up_user_id INTEGER
    , reminder_count INTEGER NOT NULL DEFAULT 0, last_reminded_at TIMESTAMP, joined_notified_at TIMESTAMP);

CREATE TABLE referral_payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_user_id INTEGER NOT NULL,
      redemption_id    INTEGER NOT NULL,
      amount_usd_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'pending',
      block_reason TEXT,
      stripe_transfer_id TEXT,
      stripe_destination TEXT,
      paid_by_admin_id INTEGER,
      earned_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      approved_at TIMESTAMP,
      paid_at     TIMESTAMP,
      reversed_at TIMESTAMP,
      failure_reason TEXT,
      UNIQUE(redemption_id)
    );

CREATE TABLE referral_strategic_access (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL UNIQUE,
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'requested'
               CHECK (status IN ('requested', 'granted', 'declined')),
  decided_at   TIMESTAMP,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE referral_submission_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id  INTEGER NOT NULL,
  -- Human-readable label as shown in the timeline ("Onboarded — reward
  -- issued"), stored rather than derived so relabelling a status later does
  -- not silently rewrite past history.
  label          TEXT NOT NULL,
  status         TEXT,
  note           TEXT,
  -- NULL for system-generated entries (e.g. the initial submission).
  actor_user_id  INTEGER,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE referral_submissions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Public-facing opaque id. The UI addresses submissions by uid so a
  -- sequential integer never leaks total programme volume.
  uid                TEXT NOT NULL UNIQUE,
  referrer_user_id   INTEGER NOT NULL,
  -- startup   — founder referrals into the Spin-Out Lab (highest priority)
  -- customer  — platform users: advisors, service partners, evaluating teams
  -- strategic — capital/distribution introductions (invite-only)
  category           TEXT NOT NULL DEFAULT 'startup'
                     CHECK (category IN ('startup', 'customer', 'strategic')),
  referred_name      TEXT NOT NULL,
  referred_org       TEXT,
  referred_contact   TEXT,
  -- The referrer's own relationship to the referred party ("Former colleague",
  -- "Investor in their last round"). Review leans on this heavily: a warm,
  -- specific relationship is the single strongest quality signal.
  your_role          TEXT,
  context            TEXT,
  status             TEXT NOT NULL DEFAULT 'submitted'
                     CHECK (status IN (
                       'draft', 'submitted', 'under_review', 'more_info_needed',
                       'qualified', 'in_conversation', 'converted',
                       'reward_eligible', 'reward_issued', 'rejected', 'closed'
                     )),
  reward_label       TEXT,
  next_step          TEXT,
  -- Reviewer-authored note on why this does or doesn't fit. Surfaced to the
  -- referrer in the detail drawer, so it is written to be read by them.
  fit_notes          TEXT,
  -- 'form' | 'csv' — bulk-imported rows arrive thinner (name/org/context only)
  -- and are worth distinguishing when tuning the quality bar.
  source             TEXT NOT NULL DEFAULT 'form',
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER NOT NULL,
      referred_id INTEGER NOT NULL UNIQUE,
      referral_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      converted_at TIMESTAMP
    );

CREATE TABLE relationship_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      relationship_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      details TEXT DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (relationship_id) REFERENCES partner_relationships(id)
    );

CREATE TABLE research_benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- What is being compared, in the reader's own words: "TVPI", "Reserve
    -- ratio", "Time to first close".
    metric TEXT NOT NULL,
    -- Ours. Carried as text so the unit is never implicit — see above.
    our_value TEXT,
    -- Theirs, and the two facts without which it is not a benchmark.
    peer_value TEXT,
    peer_source TEXT,
    peer_sample_size INTEGER,
    -- When the peer set was measured. A 2023 comparison is a different claim
    -- from a 2026 one, and the zone shows the date rather than implying now.
    peer_as_of TEXT,
    -- What the comparison actually supports. Not optional in spirit; nullable
    -- only because a row may be entered before its read is written, and the
    -- zone marks those rather than hiding them.
    reading TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (peer_value IS NULL OR (peer_source IS NOT NULL AND peer_sample_size IS NOT NULL))
);

CREATE TABLE research_documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT NOT NULL UNIQUE,
  owner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  -- playbook = the reader's own reusable material; client = material about
  -- someone they work with; document = anything else. Free-text on purpose:
  -- a CHECK here would need a migration every time the canvas adds a filter.
  kind           TEXT NOT NULL DEFAULT 'document',
  r2_key         TEXT NOT NULL,
  content_type   TEXT,
  size_bytes     INTEGER,
  index_state    TEXT NOT NULL DEFAULT 'pending',
  index_note     TEXT,
  chunk_count    INTEGER,
  indexed_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE research_funds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    -- Keyed on the USER, like `research_documents`, not on a founder profile
    -- row: the zone is a founder's own research and every read is owner-scoped.
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Optional: research done before a project exists is still research. When
    -- set, it is what the cheque-overlap figure is computed against.
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    -- The cheque range in the fund's own terms. Either end may be unknown; a
    -- missing end is not zero and the zone renders it as unrecorded.
    cheque_min_cents INTEGER,
    cheque_max_cents INTEGER,
    -- 'right' | 'wrong' | NULL. NULL means not yet assessed, which is a
    -- different fact from "wrong" and must not render as one.
    stage_fit TEXT,
    -- 'warm' | 'cold' | NULL. Whether there is a route in, independent of fit.
    path TEXT,
    -- 'researching' | 'passed'. A pass is a state, never a delete: the whole
    -- value of the row afterwards is that you stop rediscovering the fund.
    status TEXT NOT NULL DEFAULT 'researching',
    pass_reason TEXT,
    -- The fund's thesis IN ITS OWN WORDS, quoted rather than summarised, and
    -- the founder's own note on what the research turned up.
    thesis TEXT,
    note TEXT,
    source_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE retainer_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  retainer_id INTEGER NOT NULL REFERENCES partner_retainers(id),
  period TEXT NOT NULL,
  hours_used REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rfps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  need_id INTEGER NOT NULL UNIQUE,
  scope_md TEXT NOT NULL,
  deliverables_md TEXT,
  deadline_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE roadmap_okrs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    objective TEXT NOT NULL,
    key_results_json TEXT,
    kanban_status TEXT NOT NULL DEFAULT 'now',
    quarter TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE roadmap_votes (
        user_id INTEGER NOT NULL,
        item_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, item_id)
      );

CREATE TABLE rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name TEXT,
  amount REAL,
  closed_at TEXT,
  source TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sanctions_screenings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      hit INTEGER NOT NULL DEFAULT 0,
      severity TEXT NOT NULL DEFAULT 'none',
      match_count INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT,
      reviewed_by INTEGER,
      reviewed_at TIMESTAMP,
      review_notes TEXT
    );

CREATE TABLE scheduled_jobs_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, job_type TEXT NOT NULL, cohort_cycle_id INTEGER, week_number INTEGER, idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'completed', notes TEXT, ran_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE schema_migrations (
  filename   TEXT PRIMARY KEY,
  checksum   TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE score_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER NOT NULL REFERENCES projects(id),
    total_score REAL NOT NULL,
    tier TEXT NOT NULL,
    market_size REAL DEFAULT 0,
    market_urgency REAL DEFAULT 0,
    market_trend REAL DEFAULT 0,
    market_total REAL DEFAULT 0,
    team_expertise REAL DEFAULT 0,
    team_execution REAL DEFAULT 0,
    team_network REAL DEFAULT 0,
    team_total REAL DEFAULT 0,
    product_mvp_time REAL DEFAULT 0,
    product_complexity REAL DEFAULT 0,
    product_dependency REAL DEFAULT 0,
    product_total REAL DEFAULT 0,
    capital_cost_mvp REAL DEFAULT 0,
    capital_time_revenue REAL DEFAULT 0,
    capital_burn_traction REAL DEFAULT 0,
    capital_total REAL DEFAULT 0,
    fit_alignment REAL DEFAULT 0,
    fit_synergy REAL DEFAULT 0,
    fit_total REAL DEFAULT 0,
    distribution_channels REAL DEFAULT 0,
    distribution_virality REAL DEFAULT 0,
    distribution_total REAL DEFAULT 0,
    ai_adjustment REAL DEFAULT 0,
    ai_notes TEXT,
    scored_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
, is_sandbox INTEGER NOT NULL DEFAULT 0, integrity_hash TEXT, integrity_version TEXT NOT NULL DEFAULT 'v1', inputs_json TEXT, qualitative_text TEXT, anomaly_flags TEXT, admin_review_status TEXT NOT NULL DEFAULT 'auto_approved', admin_review_notes TEXT, admin_reviewed_by INTEGER REFERENCES users(id), admin_reviewed_at TEXT, locked_until TEXT, official_week TEXT);

CREATE TABLE secondary_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    subsidiary_id INTEGER NOT NULL REFERENCES subsidiaries(id),
    shares REAL NOT NULL,
    asking_price_cents INTEGER NOT NULL,
    ai_valuation_cents INTEGER,
    status TEXT NOT NULL DEFAULT 'open',         -- open | matched | sold | cancelled
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    matched_at TEXT,
    sold_at TEXT
);

CREATE TABLE secondary_rofr_notices (
    listing_id        INTEGER PRIMARY KEY REFERENCES secondary_listings(id) ON DELETE CASCADE,
    -- ISO date (YYYY-MM-DD) the transfer notice was served on the company.
    -- NULL means no notice served yet, which reads as 'not_started' and
    -- therefore NOT clear to transfer.
    notice_date       TEXT,
    -- Contractual election window. 30 days is the common default in a
    -- Delaware shareholders' agreement, but it is a term of the specific
    -- agreement, so it is stored per notice rather than assumed.
    window_days       INTEGER NOT NULL DEFAULT 30,
    shares_offered    REAL NOT NULL DEFAULT 0,
    company_elected   REAL NOT NULL DEFAULT 0,
    investors_elected REAL NOT NULL DEFAULT 0,
    -- Explicit written waiver. Separate from an expired window: a waiver
    -- is an affirmative act, an expiry is the absence of one, and a
    -- seller's counsel will want to know which happened.
    waived            INTEGER NOT NULL DEFAULT 0,
    notes             TEXT,
    created_by        INTEGER REFERENCES users(id),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE section_83b_trackers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      uid             TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL,
      taxpayer_name   TEXT NOT NULL,
      grant_date      TEXT NOT NULL,
      deadline_date   TEXT NOT NULL,
      mailed_at       TEXT,
      receipt_doc_id  INTEGER REFERENCES documents(id),
      election_doc_id INTEGER REFERENCES documents(id),
      status          TEXT NOT NULL DEFAULT 'pending',
      notes           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

CREATE TABLE service_offerings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT,
    summary TEXT,
    price_usd REAL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    company_id INTEGER
);

CREATE TABLE service_offerings_orphans_pre200 (
    id INTEGER,
    uid TEXT,
    partner_id INTEGER,
    category TEXT,
    title TEXT,
    description TEXT,
    -- Integer minor units, not the REAL dollars the source column held. A new
    -- table follows the repo's money rule even when it is archiving rows that
    -- did not: `check-money-cents` would otherwise be asked to accept two more
    -- float money columns, and cents are the more faithful record anyway — a
    -- REAL is what made the original imprecise.
    price_min_cents INTEGER,
    price_max_cents INTEGER,
    is_active INTEGER,
    created_at TEXT,
    company_id INTEGER,
    archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE shared_services_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER,
      action_type TEXT NOT NULL,
      details TEXT,
      performed_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE signal_companies (
    symbol          TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    exchange        TEXT,
    country         TEXT,
    region          TEXT,
    sector          TEXT,
    industry        TEXT,
    market_cap      REAL,            -- USD
    market_cap_band TEXT,            -- nano|micro|small|mid|large|mega
    employee_count  INTEGER,
    employee_band   TEXT,            -- 1-50|51-200|201-1k|1k-5k|5k-20k|20k+
    ceo             TEXT,
    description     TEXT,
    customer_type   TEXT,            -- smb|mid_market|enterprise|consumer|...
    maturity_stage  TEXT,            -- emerging|scaling|established|incumbent
    source_key      TEXT REFERENCES signal_sources(key),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE signal_company_map (
    signal_id   TEXT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    symbol      TEXT NOT NULL REFERENCES signal_companies(symbol),
    role        TEXT NOT NULL DEFAULT 'supporting', -- supporting|anchor|acquirer|target
    PRIMARY KEY (signal_id, symbol)
);

CREATE TABLE signal_evidence (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    signal_id   TEXT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,   -- EvidenceKind
    title       TEXT NOT NULL,
    detail      TEXT,
    source_key  TEXT NOT NULL REFERENCES signal_sources(key),
    url         TEXT,
    weight      REAL NOT NULL DEFAULT 0.5,
    observed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE signal_ingest_runs (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    source_key    TEXT REFERENCES signal_sources(key),
    started_at    TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at   TEXT,
    status        TEXT NOT NULL DEFAULT 'running', -- running|ok|error|skipped
    companies_seen INTEGER NOT NULL DEFAULT 0,
    signals_written INTEGER NOT NULL DEFAULT 0,
    error         TEXT
);

CREATE TABLE signal_sources (
    key                     TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,
    kind                    TEXT NOT NULL,   -- fundamentals|market_data|news|filing|registry|earnings|hiring
    tier                    TEXT NOT NULL DEFAULT 'free', -- free|free_tier|premium
    quality_weight          REAL NOT NULL DEFAULT 0.5,    -- 0..1 trust in accuracy
    freshness_halflife_days INTEGER NOT NULL DEFAULT 30,
    homepage                TEXT,
    enabled                 INTEGER NOT NULL DEFAULT 1,
    notes                   TEXT,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE signals (
    id                  TEXT PRIMARY KEY,
    type                TEXT NOT NULL,   -- one of SIGNAL_TYPES
    title               TEXT NOT NULL,
    thesis              TEXT NOT NULL,
    why_now             TEXT NOT NULL DEFAULT '',

    region              TEXT NOT NULL,
    country             TEXT NOT NULL,
    sector              TEXT NOT NULL,
    industry            TEXT,
    niche               TEXT NOT NULL,

    market_cap_band     TEXT NOT NULL,
    target_customers    TEXT NOT NULL DEFAULT '[]', -- JSON array of CustomerType
    maturity_stage      TEXT,

    founder_opportunity TEXT NOT NULL DEFAULT '',
    advisor_note        TEXT NOT NULL DEFAULT '',
    build_opportunity   TEXT NOT NULL DEFAULT '{}', -- JSON BuildOpportunity
    market_context      TEXT NOT NULL DEFAULT '{}', -- JSON MarketContext

    -- Persisted score HINTS. The ranking engine recomputes at read time; these
    -- are cached so a cold read (or an external analytics job) has a value.
    confidence_score    REAL NOT NULL DEFAULT 0,
    freshness_score     REAL NOT NULL DEFAULT 0,
    rank_score          REAL NOT NULL DEFAULT 0,

    tags                TEXT NOT NULL DEFAULT '[]', -- JSON array
    status              TEXT NOT NULL DEFAULT 'active', -- active|archived
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE skill_categories (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        slug          TEXT NOT NULL UNIQUE,
        label         TEXT NOT NULL,
        description   TEXT,
        is_radar_axis INTEGER NOT NULL DEFAULT 0,
        radar_weight  REAL    NOT NULL DEFAULT 1.0,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

CREATE TABLE skill_endorsements (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        endorser_id INTEGER NOT NULL REFERENCES users(id),
        endorsee_id INTEGER NOT NULL REFERENCES users(id),
        skill_id    INTEGER NOT NULL REFERENCES skills(id),
        level       INTEGER NOT NULL DEFAULT 0,
        note        TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (endorser_id, endorsee_id, skill_id),
        CHECK (level >= 0 AND level <= 5),
        CHECK (endorser_id <> endorsee_id)
      );

CREATE TABLE skills (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        slug                  TEXT NOT NULL UNIQUE,
        category_slug         TEXT NOT NULL,
        label                 TEXT NOT NULL,
        description           TEXT,
        seniority_levels_json TEXT NOT NULL DEFAULT '["aware","working","proficient","advanced","expert"]',
        display_order         INTEGER NOT NULL DEFAULT 0,
        is_active             INTEGER NOT NULL DEFAULT 1,
        created_at            TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
      );

CREATE TABLE spinout_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  company_name TEXT NOT NULL,
  idea TEXT NOT NULL,
  incorporated TEXT NOT NULL DEFAULT 'no',
  stage TEXT,
  jurisdiction TEXT,
  cohort TEXT NOT NULL DEFAULT 'Cohort 4',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);

CREATE TABLE spinout_certificates (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id       TEXT UNIQUE NOT NULL,
  public_token        TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  user_id             INTEGER NOT NULL,
  project_id          INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  public_name         TEXT NOT NULL,
  public_company      TEXT,
  public_cohort       TEXT,
  public_issued_on    TEXT NOT NULL,
  public_jurisdiction TEXT,
  public_program_days INTEGER,
  status              TEXT NOT NULL DEFAULT 'issued',
  revoked_at          TEXT,
  revocation_reason   TEXT,
  public_share_enabled INTEGER NOT NULL DEFAULT 1,
  issued_by_user_id   INTEGER,
  issued_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE spinout_deck_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    -- Dotted path into SpinoutDeckData, e.g. 'cover.thesis'. Rows whose key is
    -- no longer in the allowlist are ignored on read rather than deleted, so
    -- renaming a field is reversible.
    field_key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE spinout_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subsidiary_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      details TEXT DEFAULT '{}',
      performed_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE spinout_lab_milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    week INTEGER NOT NULL,
    milestone_key TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, milestone_key)
);

CREATE TABLE stage_transition_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, cohort_cycle_id INTEGER, week_number INTEGER, from_status TEXT, to_status TEXT NOT NULL, reason TEXT, triggered_by TEXT NOT NULL DEFAULT 'scheduler', admin_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE status_incident_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_by INTEGER
      );

CREATE TABLE status_incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'investigating',
        severity TEXT NOT NULL DEFAULT 'minor',
        affected_services TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        created_by INTEGER
      );

CREATE TABLE stripe_products (
  id           TEXT PRIMARY KEY,            -- Stripe Product id (prod_...)
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'alacarte', -- subscription | incorporation | session | alacarte
  active       INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}', -- Stripe product metadata
  prices_json  TEXT NOT NULL DEFAULT '[]',  -- array of normalised prices
  synced_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE subscription_plans (
    plan_id           TEXT PRIMARY KEY,           -- matches users.mi_subscription_plan
    monthly_price_usd REAL NOT NULL,              -- normalised to $/month for MRR math
    display_name      TEXT,
    stripe_price_id   TEXT,
    is_active         INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
, currency TEXT NOT NULL DEFAULT 'USD', native_amount REAL, native_interval TEXT);

CREATE TABLE subsidiaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      holding_company_id TEXT DEFAULT 'Axal_Holding_Delaware_CCorp',
      subsidiary_name TEXT NOT NULL,
      jurisdiction TEXT NOT NULL DEFAULT 'Delaware_CCorp',
      stripe_atlas_status TEXT DEFAULT 'pending',
      stripe_atlas_ref TEXT,
      ein TEXT,
      incorporation_date TIMESTAMP,
      ip_transfer_complete INTEGER DEFAULT 0,
      equity_allocated TEXT DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    , spinout_status TEXT DEFAULT 'pending', ip_license_doc_id INTEGER, equity_allocation_json TEXT DEFAULT '{}', stripe_atlas_id TEXT, independent_scaling_enabled INTEGER DEFAULT 0, post_spinout_dashboard_url TEXT);

CREATE TABLE super_admins (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  granted_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note               TEXT
);

CREATE TABLE syndicate_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      syndicate_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      commitment_cents INTEGER NOT NULL,
      status TEXT DEFAULT 'committed',
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE syndicates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_by INTEGER NOT NULL,
      deal_id INTEGER,
      target_cents INTEGER,
      min_commitment_cents INTEGER NOT NULL DEFAULT 100000,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      closed_at TIMESTAMP
    );

CREATE TABLE system_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    metric_name TEXT NOT NULL,
    value REAL NOT NULL,
    labels TEXT
);

CREATE TABLE team_members (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        slug              TEXT NOT NULL UNIQUE,
        name              TEXT NOT NULL,
        title             TEXT NOT NULL,
        location          TEXT,
        short_bio         TEXT,
        long_bio          TEXT,
        photo_r2_key      TEXT,
        focus_areas_json  TEXT NOT NULL DEFAULT '[]',
        social_linkedin   TEXT,
        social_x          TEXT,
        social_website    TEXT,
        social_email      TEXT,
        display_order     INTEGER NOT NULL DEFAULT 0,
        published         INTEGER NOT NULL DEFAULT 1,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

CREATE TABLE telegram_aggregations (id INTEGER PRIMARY KEY AUTOINCREMENT, audience TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, draft_post_id INTEGER REFERENCES telegram_posts(id), created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE telegram_channels (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, label TEXT NOT NULL, chat_id TEXT, audience TEXT NOT NULL, is_invite_only INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, last_test_at TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), signature TEXT);

CREATE TABLE telegram_join_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, channel_slug TEXT NOT NULL, day_bucket TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, channel_slug, day_bucket));

CREATE TABLE telegram_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id INTEGER NOT NULL REFERENCES telegram_channels(id), audience TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', title TEXT, body_md TEXT NOT NULL, media_r2_key TEXT, media_kind TEXT, scheduled_for TEXT, sent_at TEXT, telegram_message_id INTEGER, telegram_link TEXT, source TEXT NOT NULL DEFAULT 'manual', source_kind TEXT, body_hash TEXT, send_error TEXT, override_reason TEXT, override_findings TEXT, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE territory_licences (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    uid           TEXT UNIQUE NOT NULL,
    -- The human reference on the contract, in whatever form it uses there
    -- (the shape HQ has been using is <PREFIX>-<NNN>).
    licence_ref   TEXT UNIQUE NOT NULL,
    -- Step 1 of the issue flow. The subsidiary's legal entity, which already
    -- has a home: `entities` (schema.sql) carries entity_type 'subsidiary',
    -- a parent_id and a jurisdiction. No second entity model is invented here.
    entity_id     INTEGER REFERENCES entities(id) ON DELETE SET NULL,
    -- Denormalised so a licence still reads correctly if the entity row is
    -- later renamed or removed — a contract names a party as at signature.
    legal_entity_name TEXT NOT NULL,
    -- What the subsidiary is called inside the product, which is not always
    -- the legal name.
    brand_name    TEXT NOT NULL,
    registered_address TEXT,
    signatory_name  TEXT,
    signatory_title TEXT,

    --   draft              — being prepared; holds no territory yet
    --   pending_activation — terms agreed, blocked or awaiting the last step
    --   active             — trading
    --   suspended          — not trading, STILL HOLDS ITS TERRITORY
    --   terminated         — over; territory released
    status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'pending_activation', 'active', 'suspended', 'terminated')),

    term_years    INTEGER,
    annual_fee_cents INTEGER,
    -- ISO 4217. Licences are not all in one currency, and a bare integer of
    -- cents means nothing without it.
    currency      TEXT NOT NULL DEFAULT 'EUR',
    -- Basis points: 3500 = 35%. See the header.
    revenue_share_bps INTEGER,
    token_split_bps   INTEGER,

    starts_on     TEXT,
    renews_on     TEXT,
    suspended_at  TEXT,
    terminated_at TEXT,
    -- Why it was suspended or terminated. Shown wherever the status is.
    status_note   TEXT,

    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ticket_sync_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER,
      github_issue_number INTEGER,
      direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
      event_key TEXT UNIQUE NOT NULL,
      payload_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

CREATE TABLE tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    submitted_by TEXT,
    assigned_to TEXT,
    user_id INTEGER REFERENCES users(id),
    project_id INTEGER REFERENCES projects(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, github_issue_number INTEGER, github_issue_url TEXT, type TEXT NOT NULL DEFAULT 'task', github_labels TEXT, github_assignees TEXT, github_updated_at TEXT);

CREATE TABLE user_badges (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        badge_slug TEXT NOT NULL REFERENCES assessment_badges(slug),
        source     TEXT NOT NULL DEFAULT 'assessment',
        meta_json  TEXT NOT NULL DEFAULT '{}',
        awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (user_id, badge_slug)
      );

CREATE TABLE user_company_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role_in_company TEXT NOT NULL DEFAULT 'Member',
  is_primary_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, title TEXT, authority TEXT, carry_bps INTEGER,
  UNIQUE (company_id, user_id)
);

CREATE TABLE user_google_links (
  user_id    INTEGER PRIMARY KEY,
  google_sub TEXT    NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_personas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      persona_id TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      manual_override INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'router',
      is_primary INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, persona_id)
    );

CREATE TABLE user_preferences (
      user_id INTEGER PRIMARY KEY,
      investment_focus TEXT,
      preferred_stages TEXT,
      preferred_roles TEXT,
      min_check_cents INTEGER,
      max_check_cents INTEGER,
      risk_tolerance TEXT,
      bio TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE user_products (
    id           TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    order_ref    TEXT NOT NULL REFERENCES orders(order_ref),
    product_id   TEXT,
    price_id     TEXT,
    kind         TEXT,
    label        TEXT,
    quantity     INTEGER NOT NULL DEFAULT 1,
    activated_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at   TEXT
);

CREATE TABLE user_profile_ext (
    user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    experience     TEXT,  -- JSON array of {title, company|org, start, end, description|summary}
    education      TEXT,  -- JSON array of {school, degree, field, start, end}
    certifications TEXT,  -- JSON array of {name, issuer, year, url}
    website        TEXT,  -- personal / professional website URL
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
, linkedin_picture_url TEXT, organization TEXT);

CREATE TABLE user_profile_extras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      persona_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      source TEXT NOT NULL DEFAULT 'onboarding',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, persona_id, key)
    );

CREATE TABLE user_promotion_consent (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, consented INTEGER NOT NULL DEFAULT 0, consented_at TEXT, source TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE user_role_review (
    user_id INTEGER PRIMARY KEY,
    -- Persona inferred by the onboarding chatbot / advisor role detector.
    -- A SUGGESTION only — never applied to users.role without admin action.
    suggested_role TEXT,
    -- 1 once an admin has explicitly assigned the final role.
    role_confirmed INTEGER NOT NULL DEFAULT 0,
    -- When the user completed the onboarding chat and entered 'exploring'.
    onboarded_at TEXT,
    -- Binding-agreement e-sign envelope sent by an admin (esign_envelopes.id).
    binding_envelope_id INTEGER,
    binding_document_type TEXT,
    binding_sent_at TEXT,
    -- Final assignment audit trail.
    assigned_role TEXT,
    assigned_by_user_id INTEGER,
    assigned_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, needs_assessment_completed INTEGER DEFAULT 0);

CREATE TABLE user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      jti TEXT NOT NULL UNIQUE,
      user_agent TEXT,
      ip TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      revoked_at TIMESTAMP
    , factor TEXT, last_step_up_at TIMESTAMP, step_up_due_at TIMESTAMP, assurance_level TEXT);

CREATE TABLE user_settings (
  user_id INTEGER PRIMARY KEY,
  timezone TEXT DEFAULT 'UTC',
  locale TEXT DEFAULT 'en',
  pronouns TEXT,
  profile_slug TEXT UNIQUE,
  visibility TEXT DEFAULT 'network' CHECK (visibility IN ('public','network','private')),
  show_in_directory INTEGER DEFAULT 1,
  discoverable INTEGER DEFAULT 1,
  digest_frequency TEXT DEFAULT 'weekly',
  notif_categories_email TEXT DEFAULT '{}',
  notif_categories_inapp TEXT DEFAULT '{}',
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  quiet_hours_tz TEXT DEFAULT 'UTC',
  theme TEXT DEFAULT 'system',
  density TEXT DEFAULT 'comfy',
  sidebar_default TEXT DEFAULT 'expanded',
  feature_flags TEXT DEFAULT '{}',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
, dismissed_explainers TEXT NOT NULL DEFAULT '[]', matching_opt_in INTEGER DEFAULT 0);

CREATE TABLE user_skills (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id),
        skill_id     INTEGER NOT NULL REFERENCES skills(id),
        self_level   INTEGER NOT NULL DEFAULT 0,
        evidence_url TEXT,
        years        REAL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')), taxonomy_version TEXT,
        UNIQUE (user_id, skill_id),
        CHECK (self_level >= 0 AND self_level <= 5)
      );

CREATE TABLE user_spinout_flags (
  user_id INTEGER PRIMARY KEY,
  spinout_lab_admitted INTEGER NOT NULL DEFAULT 0,
  spinout_lab_cohort TEXT,
  registration_product TEXT
);

CREATE TABLE user_values (
        user_id     INTEGER NOT NULL,
        dimension_id INTEGER NOT NULL,
        score       REAL NOT NULL,
        confidence  REAL NOT NULL,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')), taxonomy_version TEXT,
        PRIMARY KEY (user_id, dimension_id)
      );

CREATE TABLE user_xp (
        user_id    INTEGER PRIMARY KEY REFERENCES users(id),
        xp         INTEGER NOT NULL DEFAULT 0,
        level      INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'founder' CHECK (role IN ('admin', 'founder', 'partner', 'exploring', 'advisor', 'investor')),
    password_hash TEXT,
    founder_id INTEGER REFERENCES founders(id),
    partner_id INTEGER REFERENCES partners(id),
    is_active INTEGER NOT NULL DEFAULT 1,
    email_verified INTEGER NOT NULL DEFAULT 0,
    verification_token TEXT,
    verification_token_expires TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
, kyc_status TEXT DEFAULT 'not_started', kyc_data TEXT, kyc_provider TEXT, kyc_submitted_at TIMESTAMP, kyc_reviewed_at TIMESTAMP, kyc_reviewed_by INTEGER, kyc_rejection_reason TEXT, partner_since TIMESTAMP, total_earnings INTEGER DEFAULT 0, network_score REAL DEFAULT 0, verified_badges TEXT DEFAULT '[]', last_active TIMESTAMP, referral_code TEXT, admin_notes TEXT, last_active_at TIMESTAMP, access_level TEXT, investor_id INTEGER, bio TEXT, headshot_r2_key TEXT, jurisdictions TEXT, socials TEXT, notification_prefs TEXT, privacy_prefs TEXT, role_prefs TEXT, jwt_min_iat INTEGER DEFAULT 0, deletion_requested_at TIMESTAMP, totp_recovery_codes TEXT, linkedin_sub TEXT, linkedin_email TEXT, linkedin_name TEXT, linkedin_connected_at TEXT, advisor_id INTEGER, spinout_lab_active INTEGER NOT NULL DEFAULT 0, spinout_lab_week INTEGER NOT NULL DEFAULT 1, spinout_lab_started_at TEXT, is_incorporated INTEGER NOT NULL DEFAULT 0, password_reset_required INTEGER NOT NULL DEFAULT 0, assistant_enabled INTEGER NOT NULL DEFAULT 0, assistant_retain_history INTEGER NOT NULL DEFAULT 0, tfa_methods TEXT NOT NULL DEFAULT '[]', subscription_tier TEXT NOT NULL DEFAULT 'free', subscription_status TEXT NOT NULL DEFAULT 'active', subscription_renews_at TIMESTAMP, stripe_customer_id TEXT, stripe_subscription_id TEXT, full_legal_name TEXT, date_of_birth TEXT, nationality TEXT, tax_residency_country TEXT, tax_id_number_enc TEXT, tax_id_last4 TEXT, phone_e164_enc TEXT, phone_last4 TEXT, address_line1 TEXT, address_line2 TEXT, city TEXT, state_or_region TEXT, postal_code TEXT, country TEXT, profile_completion_pct INTEGER DEFAULT 0, display_name TEXT, headline TEXT, investor_tier TEXT NOT NULL DEFAULT 'free', investor_subscription_status TEXT NOT NULL DEFAULT 'free', investor_trial_ends_at TIMESTAMP, investor_subscription_renews_at TIMESTAMP, investor_stripe_customer_id TEXT, investor_stripe_subscription_id TEXT, investor_seat_count INTEGER NOT NULL DEFAULT 0, investor_quota_intros_quarter TEXT, investor_quota_intros_used INTEGER NOT NULL DEFAULT 0, investor_dealroom_max INTEGER NOT NULL DEFAULT 5, investor_seat_primary_user_id INTEGER, mi_digest_paused_until TEXT, advisor_locked INTEGER NOT NULL DEFAULT 0, advisor_shadow_flag INTEGER NOT NULL DEFAULT 0, mi_contribution_optout INTEGER NOT NULL DEFAULT 0, founder_public_id TEXT, partner_public_id TEXT, admin_view_suppressed INTEGER DEFAULT 0, legacy_referral_code TEXT, stripe_connect_account_id TEXT, stripe_connect_charges_enabled INTEGER DEFAULT 0, stripe_connect_payouts_enabled INTEGER DEFAULT 0, stripe_connect_verification_status TEXT, stripe_connect_country TEXT, stripe_connect_last_synced_at TIMESTAMP);

CREATE TABLE validate_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- 'pain_tag' | 'hypothesis'. Not an enum D1 can enforce, so the routes
    -- validate it and `_founder_validate_proposals.ts` is the only writer.
    kind TEXT NOT NULL,
    -- The proposal itself, shaped per kind. Read once, on accept, and never
    -- rendered as a stored record: a pending proposal is a suggestion, and the
    -- moment it is accepted the real row is the record.
    payload_json TEXT NOT NULL,
    -- Provenance. `model` is the model that ACTUALLY ran, taken from the
    -- router's usage metadata — which is not always the model that was asked
    -- for, because the router falls back to a smaller sibling under load.
    -- Recording the request rather than the run is how a founder ends up
    -- reading one model's name over another model's sentence.
    model TEXT,
    task TEXT,
    -- pending | accepted | discarded. Never deleted: a discarded proposal is
    -- evidence about what the machine suggested and what a person rejected,
    -- and the next run should be able to avoid re-proposing it.
    status TEXT NOT NULL DEFAULT 'pending',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at TEXT
);

CREATE TABLE validation_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    decision TEXT NOT NULL,
    reasoning TEXT,
    decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    superseded_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE valuation_409a_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- priced_round | material_change | secondary_transaction
    -- | acquisition_discussion | financial_restatement
    kind        TEXT NOT NULL,
    occurred_on TEXT NOT NULL,
    note        TEXT,
    created_by  INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE valuations_409a (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- The date the appraisal SPEAKS AS OF, which is not the date it was
    -- delivered or entered. The 12-month clock runs from this date.
    valuation_date TEXT NOT NULL,
    -- Common-stock fair market value per share, in dollars. Stored as
    -- REAL rather than cents: a sub-cent FMV per share is normal at seed
    -- stage (fractions of a cent), and rounding to cents would report a
    -- real valuation as zero.
    fmv_per_share  REAL NOT NULL,
    provider       TEXT,
    -- income | market | asset | obm | backsolve | other
    method         TEXT,
    -- Last preferred price per share at the time, for the common:preferred
    -- ratio an auditor sanity-checks first. Nullable — a company with no
    -- priced round has no such price, and inventing one would be worse.
    preferred_price_per_share REAL,
    report_url     TEXT,
    notes          TEXT,
    created_by     INTEGER REFERENCES users(id),
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE value_dimensions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        slug          TEXT NOT NULL UNIQUE,
        label         TEXT NOT NULL,
        description   TEXT,
        family        TEXT NOT NULL DEFAULT 'schwartz',
        is_bipolar    INTEGER NOT NULL DEFAULT 0,
        pole_low      TEXT,
        pole_high     TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

CREATE TABLE vc_funds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    vintage_year INTEGER,
    total_commitment REAL NOT NULL DEFAULT 0,
    deployed_capital REAL NOT NULL DEFAULT 0,
    lp_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'fundraising',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, lpa_doc_id INTEGER REFERENCES legal_documents(id), fund_size_cents INTEGER NOT NULL DEFAULT 0, carried_interest REAL NOT NULL DEFAULT 0.20, management_fee REAL NOT NULL DEFAULT 0.02, slug TEXT, gp_user_id INTEGER, gp_name TEXT, gp_title TEXT, gp_email TEXT, gp_entity TEXT, fund_admin TEXT, auditor TEXT, legal_counsel TEXT, custodian TEXT, valuation_policy TEXT, company_id INTEGER);

CREATE TABLE waitlist_signups (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       project_id INTEGER NOT NULL,
       landing_page_id INTEGER,
       email TEXT NOT NULL,
       name TEXT,
       source TEXT,
       ip_hash TEXT,
       created_at TEXT DEFAULT (datetime('now'))
     , audience TEXT, crm_status TEXT DEFAULT 'new', invited_at TEXT, followed_up_at TEXT, promoted_at TEXT, promoted_interview_id INTEGER);

CREATE TABLE "watchlist_items" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL,
  project_id INTEGER,                       -- NULL for external prospects
  external_name TEXT,
  external_url TEXT,
  sector TEXT,
  stage TEXT,
  thesis TEXT,
  conviction TEXT,                          -- low | medium | high
  source TEXT,                              -- referral | inbound | cold | conf | ...
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'watching',  -- watching | converted | passed_on | archived
  next_check_at TEXT,
  reminded_at TEXT,                         -- last follow-up reminder fired (Task #14)
  passed_reason TEXT,
  passed_at TEXT,
  converted_deal_id INTEGER,
  converted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, company_id INTEGER,
  UNIQUE (owner_user_id, project_id)
);

CREATE TABLE webauthn_challenges (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        challenge   TEXT NOT NULL UNIQUE,
        user_id     INTEGER,
        kind        TEXT NOT NULL,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at  TIMESTAMP NOT NULL,
        used_at     TIMESTAMP
      );

CREATE TABLE week_windows (id INTEGER PRIMARY KEY AUTOINCREMENT, cohort_cycle_id INTEGER NOT NULL, week_number INTEGER NOT NULL, unlock_at TEXT NOT NULL, deadline_at TEXT NOT NULL, UNIQUE(cohort_cycle_id, week_number));

CREATE TABLE wellbeing_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    week_anchor TEXT NOT NULL,           -- ISO date 'YYYY-MM-DD' (Mon of UTC ISO week)
    stress_enc TEXT NOT NULL,
    sleep_enc TEXT NOT NULL,
    support_enc TEXT NOT NULL,
    decisions_enc TEXT NOT NULL,
    energy_enc TEXT NOT NULL,
    notes_enc TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), stress_plain INTEGER, sleep_plain INTEGER, support_plain INTEGER, decisions_plain INTEGER, energy_plain INTEGER, notes_plain TEXT,
    UNIQUE (user_id, week_anchor)
);

CREATE TABLE wellbeing_daily_pulses (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
       user_id INTEGER NOT NULL,
       day TEXT NOT NULL,
       mood_enc TEXT, stress_enc TEXT, sleep_enc TEXT,
       energy_enc TEXT, focus_enc TEXT, social_enc TEXT,
       free_text_enc TEXT,
       tags_enc TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')), mood_plain INTEGER, stress_plain INTEGER, sleep_plain INTEGER, energy_plain INTEGER, focus_plain INTEGER, social_plain INTEGER, free_text_plain TEXT, tags_plain TEXT,
       UNIQUE(user_id, day)
     );

CREATE TABLE wellbeing_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,              -- therapy | peer_group | hotline | reading | coaching
    name TEXT NOT NULL,
    description TEXT,
    url TEXT,
    region TEXT,                         -- global | us | uk | eu | sg | ...
    is_24_7 INTEGER NOT NULL DEFAULT 0,
    is_free INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_by_user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (category, name)
);

CREATE TABLE workflow_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      assigned_to INTEGER,
      status TEXT DEFAULT 'todo',
      due_date TIMESTAMP,
      ai_assisted INTEGER DEFAULT 0,
      metadata TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    , priority TEXT NOT NULL DEFAULT 'normal', assignee_user_id INTEGER REFERENCES users(id));

CREATE TABLE workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'draft',
      project_id INTEGER,
      template_key TEXT,
      owner_user_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE x_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, handle TEXT NOT NULL UNIQUE, display_name TEXT, x_user_id TEXT, scopes TEXT, access_token_ct TEXT, refresh_token_ct TEXT, expires_at TEXT, enabled INTEGER NOT NULL DEFAULT 1, last_test_at TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE x_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL REFERENCES x_accounts(id), status TEXT NOT NULL DEFAULT 'draft', body TEXT NOT NULL, hashtags TEXT, media_r2_keys TEXT, alt_texts TEXT, scheduled_for TEXT, sent_at TEXT, tweet_id TEXT, tweet_link TEXT, in_reply_to_tweet_id TEXT, thread_continuation_of INTEGER REFERENCES x_posts(id), thread_position INTEGER, source TEXT NOT NULL DEFAULT 'manual', source_kind TEXT, body_hash TEXT, send_error TEXT, override_reason TEXT, override_findings TEXT, approved_by INTEGER REFERENCES users(id), approved_at TEXT, retracted_at TEXT, retracted_by INTEGER REFERENCES users(id), retraction_reason TEXT, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE INDEX idx_409a_event_project ON valuation_409a_events(project_id, occurred_on DESC);

CREATE INDEX idx_409a_project ON valuations_409a(project_id, valuation_date DESC);

CREATE INDEX idx_83b_deadline ON section_83b_trackers(deadline_date);

CREATE INDEX idx_83b_user ON section_83b_trackers(user_id);

CREATE INDEX idx_account_sub_customer ON account_subscriptions(stripe_customer_id);

CREATE INDEX idx_account_sub_status ON account_subscriptions(status);

CREATE UNIQUE INDEX idx_account_sub_subscription ON account_subscriptions(subscription_id);

CREATE INDEX idx_activity_action_created
  ON activity_logs(action, created_at DESC);

CREATE INDEX idx_activity_created ON activity_logs(created_at);

CREATE INDEX idx_activity_endpoint ON activity_logs(endpoint);

CREATE INDEX idx_activity_project_created
  ON activity_logs(project_id, created_at DESC);

CREATE INDEX idx_activity_user ON activity_logs(user_id);

CREATE INDEX idx_admin_audit_action_ts ON admin_audit_log(action, exported_at DESC);

CREATE INDEX idx_admin_audit_actor
  ON admin_audit_log(actor, exported_at DESC);

CREATE INDEX idx_admin_audit_user_ts ON admin_audit_log(admin_user_id, exported_at DESC);

CREATE INDEX idx_admin_audit_viewed_user ON admin_audit_log(viewed_user_id, viewed_at DESC);

CREATE INDEX idx_admin_profile_audit_admin ON admin_profile_audit(admin_user_id, viewed_at DESC);

CREATE INDEX idx_admin_profile_audit_viewed ON admin_profile_audit(viewed_user_id, viewed_at DESC);

CREATE INDEX idx_advisor_answers_user_q ON advisor_answers(user_id, question_id);

CREATE INDEX idx_advisor_client_access_project
    ON advisor_client_access_log (project_id, created_at DESC);

CREATE INDEX idx_advisor_client_grants_advisor
    ON advisor_client_grants (advisor_user_id, status);

CREATE INDEX idx_advisor_client_grants_project
    ON advisor_client_grants (project_id, status);

CREATE INDEX idx_advisor_cohort_assignments_advisor
  ON advisor_cohort_assignments(advisor_user_id, is_active);

CREATE INDEX idx_advisor_cohort_assignments_cycle
  ON advisor_cohort_assignments(cohort_cycle_id, is_active);

CREATE INDEX idx_advisor_conv_user ON advisor_conversations(user_id, updated_at DESC);

CREATE INDEX idx_advisor_doc_shares_advisor
    ON advisor_client_document_shares (advisor_user_id, status);

CREATE INDEX idx_advisor_msg_conv ON advisor_messages(conversation_id, id);

CREATE INDEX idx_advisor_profiles_company
  ON advisor_profiles(founder_id, company_id);

CREATE INDEX idx_advisor_profiles_founder ON advisor_profiles (founder_id, status);

CREATE INDEX idx_advisor_profiles_source_contact ON advisor_profiles (source_contact_id);

CREATE INDEX idx_advisor_proof_consents_item
  ON advisor_proof_consents(proof_item_id, consent_given);

CREATE INDEX idx_advisor_proof_items_advisor
  ON advisor_proof_items(advisor_id, created_at DESC);

CREATE INDEX idx_advisor_services_advisor
  ON advisor_services(advisor_id, is_active);

CREATE INDEX idx_advisor_startups_profile ON advisor_startups (advisor_profile_id);

CREATE INDEX idx_advisor_startups_project ON advisor_startups (project_id);

CREATE INDEX idx_advisor_turn_audit_flagged ON advisor_turn_audit(shadow_flagged, created_at DESC);

CREATE INDEX idx_advisor_turn_audit_user    ON advisor_turn_audit(user_id, created_at DESC);

CREATE INDEX idx_advisors_active ON advisors(is_active);

CREATE INDEX idx_ai_score_drafts_project
  ON ai_score_drafts(project_id, created_at DESC);

CREATE INDEX idx_ai_usage_task_created ON ai_usage_logs(task, created_at DESC);

CREATE INDEX idx_ai_usage_user_created ON ai_usage_logs(user_id, created_at DESC);

CREATE INDEX idx_al_action ON activity_logs(action_type, created_at DESC);

CREATE INDEX idx_al_entity ON activity_logs(entity_type, entity_id);

CREATE INDEX idx_al_user ON activity_logs(user_id, created_at DESC);

CREATE INDEX idx_analytics_snapshots_date
  ON analytics_snapshots(snapshot_date DESC);

CREATE INDEX idx_article_comments_article ON article_review_comments(article_id, created_at);

CREATE INDEX idx_article_revisions_article ON article_revisions(article_id, rev DESC);

CREATE INDEX idx_article_submission_log_author ON article_submission_log(author_id, submitted_at DESC);

CREATE INDEX idx_articles_author ON articles(author_user_id, status, updated_at DESC);

CREATE INDEX idx_articles_queue ON articles(status, submitted_at);

CREATE INDEX idx_articles_status_pub ON articles(status, published_at DESC);

CREATE INDEX idx_as_date ON activity_stats(stat_date);

CREATE INDEX idx_assessment_archetypes_game
        ON assessment_archetypes (game_id, display_order);

CREATE INDEX idx_assessment_archetypes_track
        ON assessment_archetypes (track);

CREATE INDEX idx_assessment_badges_kind
        ON assessment_badges (kind, display_order);

CREATE INDEX idx_assessment_chapters_game
        ON assessment_chapters (game_id, display_order);

CREATE INDEX idx_assessment_games_status
        ON assessment_games (status, display_order);

CREATE INDEX idx_assessment_games_track
        ON assessment_games (track);

CREATE INDEX idx_assessment_items_chapter
        ON assessment_items (chapter_id, display_order);

CREATE INDEX idx_assessment_items_game
        ON assessment_items (game_id, is_active, display_order);

CREATE INDEX idx_assessment_items_mechanic
        ON assessment_items (mechanic);

CREATE INDEX idx_assessment_responses_session
        ON assessment_responses (session_id);

CREATE INDEX idx_assessment_responses_user
        ON assessment_responses (user_id);

CREATE INDEX idx_assessment_results_track
        ON assessment_results (track);

CREATE INDEX idx_assessment_results_user
        ON assessment_results (user_id, track, updated_at);

CREATE INDEX idx_assessment_sessions_game
        ON assessment_sessions (game_id, status);

CREATE INDEX idx_assessment_sessions_user
        ON assessment_sessions (user_id, status, updated_at);

CREATE INDEX idx_assistant_conv_uid  ON assistant_conversations(uid);

CREATE INDEX idx_assistant_conv_user ON assistant_conversations(user_id, updated_at DESC);

CREATE INDEX idx_assistant_msg_conv ON assistant_messages(conversation_id, id);

CREATE INDEX idx_auth_sms_firebase ON auth_sms(firebase_uid);

CREATE INDEX idx_axal_fit_reports_user ON axal_fit_reports (user_id, created_at);

CREATE INDEX idx_axal_fit_scores_latest
    ON axal_fit_scores (user_id, persona, computed_at);

CREATE INDEX idx_axal_values_user ON axal_values (user_id, updated_at);

CREATE INDEX idx_brand_custom_templates_user ON brand_custom_templates(user_id);

CREATE INDEX idx_calendar_events_source_status
  ON calendar_events(source, status);

CREATE INDEX idx_calendar_events_user_time
  ON calendar_events(user_id, start_at);

CREATE INDEX idx_calendar_sync_source
  ON calendar_sync_records(source_kind, source_id);

CREATE INDEX idx_calendar_sync_user_provider
  ON calendar_sync_records(user_id, provider);

CREATE INDEX idx_cap_table_holders_carta ON cap_table_holders(carta_stakeholder_id);

CREATE INDEX idx_cap_table_holders_project ON cap_table_holders(project_id);

CREATE INDEX idx_cap_table_holders_user ON cap_table_holders(user_id);

CREATE INDEX idx_cap_table_option_pools_user
  ON cap_table_option_pools(user_id);

CREATE UNIQUE INDEX idx_cap_table_option_pools_user_carta
  ON cap_table_option_pools(user_id, carta_id)
  WHERE carta_id IS NOT NULL;

CREATE INDEX idx_cap_table_securities_project ON cap_table_securities(project_id);

CREATE INDEX idx_cap_table_securities_user ON cap_table_securities(user_id);

CREATE INDEX idx_cap_table_vesting_user
  ON cap_table_vesting(user_id);

CREATE UNIQUE INDEX idx_cap_table_vesting_user_carta
  ON cap_table_vesting(user_id, carta_vesting_id)
  WHERE carta_vesting_id IS NOT NULL;

CREATE INDEX idx_capital_calls_lp        ON capital_calls(limited_partner_id);

CREATE INDEX idx_capital_calls_lp_legacy ON capital_calls(lp_investor_id);

CREATE INDEX idx_capital_calls_project   ON capital_calls(project_id);

CREATE INDEX idx_captable_owner   ON cap_table_scenarios(owner_user_id, updated_at DESC);

CREATE INDEX idx_captable_project ON cap_table_scenarios(project_id);

CREATE INDEX idx_captable_share_hash ON captable_share_tokens(token_hash);

CREATE INDEX idx_captable_share_scenario ON captable_share_tokens(scenario_uid, created_at);

CREATE INDEX idx_captable_share_views_scenario ON captable_share_views(scenario_uid, created_at);

CREATE INDEX idx_captable_share_views_token ON captable_share_views(share_token_id);

CREATE INDEX idx_cc_status ON capital_calls(status, due_date);

CREATE INDEX idx_cf_dlq_time ON cf_dlq_mirror(received_at);

CREATE INDEX idx_cf_dlq_type ON cf_dlq_mirror(job_type, received_at);

CREATE INDEX idx_chain_root ON referral_chains(root_referrer_id);

CREATE UNIQUE INDEX idx_chain_unique ON referral_chains(root_referrer_id, user_id);

CREATE INDEX idx_chain_user ON referral_chains(user_id);

CREATE INDEX idx_circles_access ON circles (access);

CREATE INDEX idx_circles_public_feed ON circles (published, featured, sort_order);

CREATE INDEX idx_circles_type ON circles (type);

CREATE INDEX idx_cofounder_conn_a ON cofounder_connections(user_a_id);

CREATE INDEX idx_cofounder_conn_b ON cofounder_connections(user_b_id);

CREATE INDEX idx_cofounder_interest_from ON cofounder_interests(from_user_id, status);

CREATE INDEX idx_cofounder_interest_to   ON cofounder_interests(to_user_id, status);

CREATE INDEX idx_cofounder_profile_listed ON cofounder_profiles(listed);

CREATE INDEX idx_cohort_guidance_acks_founder
    ON cohort_guidance_acks (founder_user_id);

CREATE INDEX idx_cohort_guidance_advisor
    ON cohort_guidance (advisor_user_id);

CREATE INDEX idx_cohort_guidance_cycle
    ON cohort_guidance (cohort_cycle_id, posted_at);

CREATE INDEX idx_comark_attr_pitch ON comarketing_attributions(pitch_id, created_at DESC);

CREATE INDEX idx_comark_partner ON comarketing_pitches(partner_id, status);

CREATE INDEX idx_comark_status ON comarketing_pitches(status, created_at DESC);

CREATE INDEX idx_comktg_pitches_company ON comarketing_pitches(partner_id, company_id);

CREATE UNIQUE INDEX idx_commissions_event ON commissions(user_id, source_type, source_id);

CREATE INDEX idx_commissions_user ON commissions(user_id);

CREATE INDEX idx_commitments_company
  ON commitments(investor_user_id, company_id);

CREATE INDEX idx_commitments_deal ON commitments(deal_id);

CREATE INDEX idx_commitments_investor ON commitments(investor_user_id);

CREATE INDEX idx_company_stage ON company_profiles(stage);

CREATE INDEX idx_competitor_analyses_user ON competitor_analyses (user_id, updated_at);

CREATE INDEX idx_competitor_cached_fetches_exp ON competitor_cached_fetches (expires_at);

CREATE INDEX idx_competitor_candidates_analysis ON competitor_candidates (analysis_id, position);

CREATE INDEX idx_competitor_signals_analysis ON competitor_signals (analysis_id);

CREATE INDEX idx_competitor_sources_analysis ON competitor_sources (analysis_id);

CREATE INDEX idx_compliance_project ON compliance_events(project_id, due_date);

CREATE INDEX idx_compliance_status  ON compliance_events(completion_status, due_date);

CREATE INDEX idx_consultation_bookings_status ON admin_consultation_bookings (status, requested_at);

CREATE INDEX idx_consultation_bookings_user   ON admin_consultation_bookings (user_id, created_at);

CREATE INDEX idx_contact_replies_contact ON contact_replies(contact_id);

CREATE INDEX idx_contact_tasks_contact ON contact_tasks(contact_id);

CREATE INDEX idx_contacts_project ON contacts(project_id, audience);

CREATE INDEX idx_contacts_status  ON contacts(status);

CREATE INDEX idx_corp_profiles_country
  ON corporate_profiles(registered_country);

CREATE INDEX idx_corp_profiles_high_risk
  ON corporate_profiles(aml_high_risk_jurisdiction)
  WHERE aml_high_risk_jurisdiction = 1;

CREATE INDEX idx_cr_deal ON compliance_records(deal_id);

CREATE INDEX idx_cr_sub ON compliance_records(subsidiary_id);

CREATE INDEX idx_cr_type ON compliance_records(type, status);

CREATE INDEX idx_crh_trigger_time ON cron_run_history(trigger_name, started_at);

CREATE INDEX idx_data_imports_user_created
  ON data_imports(user_id, started_at DESC);

CREATE INDEX idx_data_imports_user_month_status
  ON data_imports(user_id, started_at);

CREATE INDEX idx_dc_deal ON diligence_checklists(deal_id, checklist_type);

CREATE INDEX idx_dd_attachments_case ON dd_attachments(case_id);

CREATE INDEX idx_dd_audit_actor ON dd_audit_log(actor_user_id, created_at DESC);

CREATE INDEX idx_dd_audit_case ON dd_audit_log(case_id, created_at DESC);

CREATE INDEX idx_dd_cases_owner ON dd_cases(owner_user_id, status);

CREATE INDEX idx_dd_cases_status ON dd_cases(status, risk_band);

CREATE INDEX idx_dd_cases_subject ON dd_cases(subject_type, subject_id);

CREATE INDEX idx_dd_checklist_case_status ON dd_checklist_items(case_id, status);

CREATE INDEX idx_dd_checklist_owner_due ON dd_checklist_items(owner_user_id, due_date);

CREATE INDEX idx_dd_findings_case ON dd_findings(case_id, severity);

CREATE INDEX idx_dd_findings_envelope ON dd_findings(esign_envelope_uuid);

CREATE INDEX idx_dd_findings_section ON dd_findings(section_id);

CREATE INDEX idx_dd_reports_case ON dd_reports(case_id, created_at DESC);

CREATE INDEX idx_dd_requests_case_state ON dd_requests(case_id, state);

CREATE INDEX idx_dd_reviewers_user ON dd_reviewers(user_id);

CREATE INDEX idx_dd_sections_assignee ON dd_sections(assignee_user_id, status);

CREATE INDEX idx_dd_sections_case ON dd_sections(case_id, status);

CREATE INDEX idx_dd_sources_case ON dd_external_sources(case_id, connector);

CREATE INDEX idx_deal_invitations_company
  ON deal_invitations(investor_user_id, company_id);

CREATE INDEX idx_deal_invites_investor ON deal_invitations(investor_user_id, status);

CREATE UNIQUE INDEX idx_deal_invites_pair ON deal_invitations(deal_id, investor_user_id);

CREATE INDEX idx_deal_stage_events_deal
  ON deal_stage_events(deal_id, created_at);

CREATE INDEX idx_deal_stage_events_to
  ON deal_stage_events(to_stage, created_at);

CREATE INDEX idx_dealroom_company
  ON investor_dealroom_members(investor_user_id, company_id);

CREATE INDEX idx_dealroom_investor ON investor_dealroom_members(investor_user_id);

CREATE INDEX idx_deals_hubspot ON deals(hubspot_deal_id);

CREATE INDEX idx_deals_pass_reason ON deals(pass_reason, passed_at DESC);

CREATE INDEX idx_deals_project ON deals(project_id);

CREATE INDEX idx_deals_sf_opp ON deals(sf_opportunity_id);

CREATE INDEX idx_deck_review_history_review ON deck_review_history (review_id, created_at);

CREATE INDEX idx_deck_reviews_user ON deck_reviews (user_id, updated_at);

CREATE INDEX idx_deck_share_conv_deck ON deck_share_conversions(deck_id, created_at);

CREATE INDEX idx_deck_share_conv_user ON deck_share_conversions(user_id);

CREATE INDEX idx_deck_share_conv_view ON deck_share_conversions(view_id);

CREATE INDEX idx_deck_share_fb_deck ON deck_share_feedback(deck_id, created_at);

CREATE INDEX idx_deck_share_fb_user ON deck_share_feedback(user_id);

CREATE INDEX idx_deck_share_hash ON pitch_deck_share_tokens(token_hash);

CREATE INDEX idx_deck_share_views_deck ON deck_share_views(deck_id, created_at);

CREATE INDEX idx_deck_share_views_tok ON deck_share_views(share_token_id);

CREATE INDEX idx_decks_current ON pitch_decks(project_id, is_current);

CREATE INDEX idx_decks_project ON pitch_decks(project_id, version);

CREATE INDEX idx_discovery_interviews_project
    ON discovery_interviews (project_id);

CREATE INDEX idx_discovery_interviews_project_featured
           ON discovery_interviews (project_id, featured);

CREATE INDEX idx_dist_event ON fund_distributions(source_liquidity_event_id);

CREATE INDEX idx_dist_fund ON fund_distributions(fund_id, created_at);

CREATE INDEX idx_dist_lp ON fund_distributions(lp_id, created_at);

CREATE INDEX idx_dist_status ON fund_distributions(status);

CREATE INDEX idx_distributions_fund ON portfolio_distributions(fund_id);

CREATE INDEX idx_distributions_project ON portfolio_distributions(project_id, distribution_date);

CREATE INDEX idx_dlq_type ON dead_letter_queue(job_type, moved_at);

CREATE INDEX idx_documents_migrated_to_esign ON documents(migrated_to_esign_id);

CREATE INDEX idx_dr_files_folder  ON data_room_files(folder_id);

CREATE INDEX idx_dr_files_project ON data_room_files(project_id, folder_id);

CREATE INDEX idx_dr_folders_parent  ON data_room_folders(parent_id);

CREATE INDEX idx_dr_folders_project ON data_room_folders(project_id, display_order);

CREATE INDEX idx_dr_grants_investor ON data_room_grants(investor_user_id, status);

CREATE INDEX idx_dr_grants_project  ON data_room_grants(project_id, status);

CREATE INDEX idx_dr_log_project ON data_room_access_log(project_id, created_at DESC);

CREATE INDEX idx_dr_log_user    ON data_room_access_log(user_id, created_at DESC);

CREATE INDEX idx_ecr_user ON email_change_requests(user_id);

CREATE INDEX idx_engagement_blockers_engagement
  ON engagement_blockers(engagement_id, cleared_at);

CREATE INDEX idx_engagement_deliverables_engagement
  ON engagement_deliverables(engagement_id, sent_at DESC);

CREATE UNIQUE INDEX idx_engagement_hours_period
  ON engagement_hours(engagement_id, person_user_id, period);

CREATE INDEX idx_engagement_hours_person
  ON engagement_hours(person_user_id, period);

CREATE UNIQUE INDEX idx_engagement_invoice_once
    ON engagement_invoices(engagement_id);

CREATE INDEX idx_engagement_invoices_founder
    ON engagement_invoices(founder_user_id, status, issued_at);

CREATE INDEX idx_engagement_invoices_partner
    ON engagement_invoices(partner_user_id, status, issued_at);

CREATE INDEX idx_engagement_milestones_engagement
  ON engagement_milestones(engagement_id, due_at);

CREATE INDEX idx_engagement_seats_engagement
  ON engagement_seats(engagement_id, revoked_at);

CREATE INDEX idx_engagement_seats_holder
  ON engagement_seats(holder_user_id, revoked_at);

CREATE UNIQUE INDEX idx_engagement_sources_engagement
  ON engagement_sources(engagement_id);

CREATE INDEX idx_engagement_sources_surface
  ON engagement_sources(surface_id);

CREATE UNIQUE INDEX idx_engagement_status_reports_period
  ON engagement_status_reports(engagement_id, period);

CREATE INDEX idx_engagements_company ON engagements(partner_id, company_id);

CREATE INDEX idx_engagements_founder ON engagements(founder_id, status);

CREATE INDEX idx_engagements_partner ON engagements(partner_id, status);

CREATE INDEX idx_errlog_level_ts  ON error_logs(level, created_at);

CREATE INDEX idx_errlog_source_ts ON error_logs(source, created_at);

CREATE INDEX idx_errlog_status ON error_logs(status_code);

CREATE INDEX idx_errlog_ts ON error_logs(created_at);

CREATE INDEX idx_esign_audit_envelope ON esign_audit_events(envelope_id, ts);

CREATE INDEX idx_esign_deal ON esign_envelopes(deal_id);

CREATE INDEX idx_esign_docusign_account  ON esign_envelopes(docusign_account_id);

CREATE INDEX idx_esign_docusign_envelope ON esign_envelopes(docusign_envelope_id);

CREATE INDEX idx_esign_forward_envelope ON esign_forward_log(envelope_id, forwarded_at);

CREATE INDEX idx_esign_forward_to ON esign_forward_log(forwarded_to);

CREATE INDEX idx_esign_provider          ON esign_envelopes(provider);

CREATE INDEX idx_esign_rec_email ON esign_recipients(recipient_email);

CREATE INDEX idx_esign_rec_envelope ON esign_recipients(envelope_id);

CREATE INDEX idx_esign_status ON esign_envelopes(status);

CREATE INDEX idx_esign_user ON esign_envelopes(user_id);

CREATE INDEX idx_event_agenda_event
     ON event_agenda_items (event_id, display_order);

CREATE INDEX idx_event_agenda_speaker
     ON event_agenda_items (speaker_user_id);

CREATE INDEX idx_event_checkins_event
     ON event_checkins (event_id);

CREATE INDEX idx_event_invitations_email
     ON event_invitations (invited_email);

CREATE INDEX idx_event_invitations_event
     ON event_invitations (event_id, status);

CREATE INDEX idx_event_invitations_user
     ON event_invitations (invited_user_id);

CREATE INDEX idx_event_notifications_event
     ON event_notifications (event_id, kind);

CREATE INDEX idx_event_registrations_event
     ON event_registrations (event_id, status, waitlist_position);

CREATE INDEX idx_event_registrations_user
     ON event_registrations (user_id, registered_at);

CREATE INDEX idx_events_host
     ON events (host_user_id, starts_at);

CREATE INDEX idx_events_public_feed
     ON events (visibility, status, admin_published, starts_at);

CREATE INDEX idx_events_starts
     ON events (starts_at);

CREATE INDEX idx_events_status
     ON events (status, starts_at);

CREATE INDEX idx_expert_availability_expert
       ON expert_availability(expert_id, day_of_week);

CREATE INDEX idx_expert_bookings_expert_status
       ON expert_bookings(expert_id, status, scheduled_at);

CREATE INDEX idx_expert_bookings_user ON expert_bookings(user_id, created_at DESC);

CREATE INDEX idx_expert_ratings_expert ON expert_ratings(expert_id);

CREATE INDEX idx_expert_services_expert
       ON expert_services(expert_id, is_active, sort_order);

CREATE INDEX idx_expert_views_user_time
       ON expert_profile_views(user_id, viewed_at DESC);

CREATE INDEX idx_experts_active ON experts(is_active);

CREATE INDEX idx_explorer_needs_challenges ON explorer_needs(challenge_1, challenge_2, challenge_3);

CREATE INDEX idx_explorer_needs_status ON explorer_needs(current_status);

CREATE INDEX idx_explorer_needs_timeline ON explorer_needs(timeline_urgency);

CREATE INDEX idx_explorer_needs_track ON explorer_needs(track);

CREATE UNIQUE INDEX idx_feature_unlocks_pi ON feature_unlocks(source_payment_intent_id);

CREATE INDEX idx_feature_unlocks_user_feature ON feature_unlocks(user_id, feature_key);

CREATE INDEX idx_fi_inviter ON founder_invites(inviter_user_id);

CREATE INDEX idx_fi_project ON founder_invites(project_id);

CREATE INDEX idx_field_sources_user_page ON field_sources(user_id, page_target);

CREATE UNIQUE INDEX idx_financial_models_project_unique ON financial_models(project_id);

CREATE INDEX idx_finmodel_project ON financial_models(project_id);

CREATE INDEX idx_follows_entity ON follows(entity_type, entity_id);

CREATE INDEX idx_follows_follower ON follows(follower_user_id);

CREATE INDEX idx_founder_checkins_counterpart ON founder_checkins(counterpart_user_id);

CREATE INDEX idx_founder_checkins_founder    ON founder_checkins(founder_user_id);

CREATE INDEX idx_founder_checkins_project    ON founder_checkins(project_id);

CREATE INDEX idx_founder_checkins_start      ON founder_checkins(start_at);

CREATE INDEX idx_founder_checkins_status     ON founder_checkins(status);

CREATE INDEX idx_founders_email ON founders(email);

CREATE INDEX idx_founders_sf_contact ON founders(sf_contact_id);

CREATE UNIQUE INDEX idx_fra_fund_project ON fund_reserve_allocations(fund_id, project_id);

CREATE INDEX idx_fra_project ON fund_reserve_allocations(project_id);

CREATE INDEX idx_fs_created_at ON fund_scenarios(created_at);

CREATE INDEX idx_fs_created_by ON fund_scenarios(created_by_user_id);

CREATE INDEX idx_fs_fund ON fund_scenarios(fund_id);

CREATE INDEX idx_fs_kind ON fund_scenarios(kind);

CREATE UNIQUE INDEX idx_fund_report_periods_fund_period
           ON fund_report_periods(fund_id, period);

CREATE INDEX idx_funds_status ON vc_funds(status);

CREATE INDEX idx_funnel_events_anon ON funnel_events(anon_id, created_at);

CREATE INDEX idx_funnel_events_event ON funnel_events(event, created_at);

CREATE INDEX idx_gates_deal ON decision_gates(deal_id, created_at);

CREATE INDEX idx_gates_status ON decision_gates(status);

CREATE UNIQUE INDEX idx_google_oauth_tokens_google_sub_unique
      ON google_oauth_tokens(google_sub)
      WHERE google_sub IS NOT NULL;

CREATE INDEX idx_health_project ON portfolio_health_snapshots(project_id, snapshot_date DESC);

CREATE INDEX idx_hypotheses_project
    ON hypotheses (project_id);

CREATE UNIQUE INDEX idx_hypotheses_project_code
    ON hypotheses (project_id, code);

CREATE INDEX idx_hypothesis_pain_links_group
    ON hypothesis_pain_links (pain_group_id);

CREATE UNIQUE INDEX idx_hypothesis_pain_links_unique
    ON hypothesis_pain_links (hypothesis_id, pain_group_id, direction);

CREATE INDEX idx_ic_attendees_meeting ON ic_meeting_attendees(meeting_id);

CREATE INDEX idx_ic_attendees_user    ON ic_meeting_attendees(user_id);

CREATE INDEX idx_ic_dd_case ON ic_decisions(dd_case_id);

CREATE INDEX idx_ic_decisions_company
  ON ic_decisions(company_id);

CREATE INDEX idx_ic_meetings_deal          ON ic_meetings(deal_id);

CREATE INDEX idx_ic_meetings_organizer     ON ic_meetings(organizer_user_id);

CREATE INDEX idx_ic_meetings_start         ON ic_meetings(start_at);

CREATE INDEX idx_ic_meetings_status        ON ic_meetings(status);

CREATE INDEX idx_ic_project ON ic_decisions(project_id);

CREATE INDEX idx_ic_status  ON ic_decisions(status);

CREATE INDEX idx_ic_votes_decision ON ic_votes(ic_decision_id);

CREATE INDEX idx_inbox_user_unread
         ON notifications_inbox(user_id, read_at, created_at);

CREATE INDEX idx_incorporations_user_status ON incorporations(user_id, status);

CREATE INDEX idx_integration_logs_event ON integration_logs(event_type);

CREATE INDEX idx_integration_logs_int   ON integration_logs(integration_id, datetime(created_at) DESC);

CREATE INDEX idx_integration_logs_user  ON integration_logs(user_id, datetime(created_at) DESC);

CREATE INDEX idx_integration_waitlist_provider ON integration_waitlist(provider_key);

CREATE INDEX idx_integrations_provider  ON integrations(provider_key);

CREATE INDEX idx_integrations_status    ON integrations(status);

CREATE INDEX idx_integrations_user      ON integrations(user_id);

CREATE UNIQUE INDEX idx_interview_pain_sev_unique
    ON interview_pain_severities (interview_id, phrase_norm);

CREATE UNIQUE INDEX idx_intro_ledger_idem
    ON intro_credit_ledger(user_id, kind, source_ref);

CREATE INDEX idx_intro_ledger_user
    ON intro_credit_ledger(user_id, created_at);

CREATE UNIQUE INDEX idx_intro_props_pair
    ON intro_propositions(user_id, target_user_id);

CREATE INDEX idx_intro_props_user_status
    ON intro_propositions(user_id, status, created_at);

CREATE INDEX idx_intros_company
  ON investor_introductions(investor_user_id, company_id);

CREATE INDEX idx_intros_investor ON investor_introductions(investor_user_id);

CREATE INDEX idx_intros_quarter ON investor_introductions(investor_user_id, quarter);

CREATE INDEX idx_investor_profiles_contribute
  ON investor_profiles(contribute_to_signals);

CREATE INDEX idx_investor_seats_email ON investor_seats(seat_email);

CREATE INDEX idx_investor_seats_primary ON investor_seats(primary_user_id);

CREATE INDEX idx_investor_seats_token ON investor_seats(invite_token);

CREATE INDEX idx_investor_signals_snapshots_computed_at
  ON investor_signals_snapshots(computed_at DESC);

CREATE INDEX idx_investors_type ON investors(investor_type);

CREATE INDEX idx_investors_user ON investors(user_id);

CREATE INDEX idx_invites_recipient ON referral_invites(recipient_email);

CREATE INDEX idx_invites_sender_email ON referral_invites(sender_user_id, recipient_email);

CREATE INDEX idx_invites_sent_at ON referral_invites(sent_at);

CREATE INDEX idx_invites_signed_up_user ON referral_invites(signed_up_user_id);

CREATE INDEX idx_invoice_email_log_invoice
       ON invoice_email_log(stripe_invoice_id);

CREATE INDEX idx_iph_investor
  ON investor_portfolio_holdings(investor_user_id, created_at DESC);

CREATE INDEX idx_job_applications_email
     ON job_applications (email);

CREATE INDEX idx_job_applications_posting
     ON job_applications (posting_id, created_at);

CREATE INDEX idx_job_applications_user
     ON job_applications (user_id);

CREATE INDEX idx_job_idem_first_seen
  ON job_idempotency(first_seen_at);

CREATE INDEX idx_job_postings_host
     ON job_postings (host_user_id, created_at);

CREATE INDEX idx_job_postings_project
     ON job_postings (project_id);

CREATE INDEX idx_job_postings_public_feed
     ON job_postings (status, admin_published, created_at);

CREATE INDEX idx_job_postings_status
     ON job_postings (status, created_at);

CREATE UNIQUE INDEX idx_journal_ic_decision_owner
  ON decision_journal_entries(owner_user_id, ic_decision_id)
  WHERE ic_decision_id IS NOT NULL;

CREATE INDEX idx_journal_outcome_status ON decision_journal_entries(outcome_status);

CREATE INDEX idx_journal_owner ON decision_journal_entries(owner_user_id);

CREATE INDEX idx_journal_project ON decision_journal_entries(project_id);

CREATE INDEX idx_journal_watchlist ON decision_journal_entries(watchlist_item_id);

CREATE INDEX idx_kpi_defs_cadence ON portfolio_kpi_definitions(cadence, sort_order);

CREATE INDEX idx_kyc_partner_imports_user
  ON kyc_partner_imports(user_id, created_at DESC);

CREATE INDEX idx_landing_preview_token ON landing_pages(preview_token);

CREATE UNIQUE INDEX idx_landing_project_page ON landing_pages(project_id, page_slug);

CREATE INDEX idx_landing_slug ON landing_pages(slug);

CREATE INDEX idx_ld_deal ON legal_documents(deal_id, type);

CREATE INDEX idx_ld_status ON legal_documents(status);

CREATE INDEX idx_legal_obligations_expiry ON legal_obligations(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX idx_legal_obligations_status ON legal_obligations(status);

CREATE INDEX idx_legal_obligations_user   ON legal_obligations(user_id);

CREATE INDEX idx_legal_template_versions_tpl ON legal_template_versions(template_id);

CREATE INDEX idx_legal_templates_active ON legal_templates(is_active);

CREATE INDEX idx_legal_templates_category ON legal_templates(category);

CREATE INDEX idx_licence_admins_licence
    ON licence_admins(licence_id);

CREATE UNIQUE INDEX idx_licence_admins_user
    ON licence_admins(user_id);

CREATE INDEX idx_licence_events_licence
    ON licence_events(licence_id, created_at);

CREATE UNIQUE INDEX idx_licence_seats_once
    ON licence_seats(licence_id, seat_type);

CREATE UNIQUE INDEX idx_licence_territory_exclusive
    ON licence_territories(country_code);

CREATE INDEX idx_licence_territory_licence
    ON licence_territories(licence_id);

CREATE INDEX idx_licences_status ON territory_licences(status, renews_on);

CREATE INDEX idx_liqevt_deal ON liquidity_events(deal_id);

CREATE INDEX idx_liqevt_sub  ON liquidity_events(subsidiary_id);

CREATE INDEX idx_liqevt_type_status ON liquidity_events(event_type, status, created_at);

CREATE INDEX idx_listing_status ON secondary_listings(status, created_at);

CREATE INDEX idx_listing_sub ON secondary_listings(subsidiary_id);

CREATE INDEX idx_listing_user ON secondary_listings(user_id);

CREATE INDEX idx_log_created ON shared_services_log(created_at);

CREATE INDEX idx_log_workflow ON shared_services_log(workflow_id);

CREATE INDEX idx_lp_applications_status
    ON lp_applications(fund_slug, status, created_at);

CREATE UNIQUE INDEX idx_lp_applications_user_fund
    ON lp_applications(user_id, fund_slug);

CREATE INDEX idx_lp_fund   ON limited_partners(fund_id);

CREATE INDEX idx_lp_reports_fund ON lp_reports(fund_id);

CREATE INDEX idx_lp_status ON limited_partners(status);

CREATE INDEX idx_lp_user   ON limited_partners(user_id);

CREATE INDEX idx_magic_link_email ON magic_link_tokens(email, created_at DESC);

CREATE INDEX idx_magic_link_hash ON magic_link_tokens(token_hash);

CREATE INDEX idx_marks_fund ON portfolio_marks(fund_id);

CREATE INDEX idx_marks_project_date ON portfolio_marks(project_id, as_of_date DESC);

CREATE INDEX idx_match_buyer ON exit_matches(buyer_user_id);

CREATE INDEX idx_match_listing ON exit_matches(listing_id, status);

CREATE INDEX idx_match_scores_deal ON match_scores(deal_id);

CREATE UNIQUE INDEX idx_match_scores_unique ON match_scores(user_id, score_type, COALESCE(deal_id, 0), COALESCE(target_user_id, 0));

CREATE INDEX idx_match_scores_user ON match_scores(user_id, score_type);

CREATE INDEX idx_memos_project ON deal_memos(project_id);

CREATE INDEX idx_mentor_bookings_founder ON "advisor_bookings"(founder_user_id, status);

CREATE INDEX idx_mentor_bookings_mentor ON "advisor_bookings"(advisor_id, status);

CREATE INDEX idx_mentor_slots_mentor ON "advisor_office_hour_slots"(advisor_id, starts_at);

CREATE INDEX idx_mentors_active ON "advisors"(is_active);

CREATE INDEX idx_messages_thread ON messages(thread_id, created_at);

CREATE INDEX idx_metric_targets_project ON metric_targets(project_id);

CREATE INDEX idx_metrics_deal ON metrics_snapshots(deal_id, snapshot_date);

CREATE INDEX idx_metrics_name_ts ON system_metrics(metric_name, timestamp);

CREATE INDEX idx_metrics_ts ON system_metrics(timestamp);

CREATE INDEX idx_mi_agg_dimension ON market_intel_aggregates(dimension_key);

CREATE INDEX idx_mi_agg_extractor_period ON market_intel_aggregates(extractor, period_key);

CREATE INDEX idx_mi_emb_persona_kind ON market_intel_embeddings(persona, kind);

CREATE INDEX idx_mi_idx_sector_period
  ON market_intel_indexes(sector, period_key);

CREATE INDEX idx_mi_pro_customer ON mi_pro_subscriptions(stripe_customer_id);

CREATE INDEX idx_mi_pro_status ON mi_pro_subscriptions(status);

CREATE UNIQUE INDEX idx_mi_pro_subscription ON mi_pro_subscriptions(subscription_id);

CREATE INDEX idx_mi_rows_metric    ON market_intel_rows(metric_key, sector, ts);

CREATE INDEX idx_mi_rows_sector_ts ON market_intel_rows(sector, ts);

CREATE INDEX idx_mi_rows_source_ts ON market_intel_rows(source_key, ts);

CREATE INDEX idx_mi_signals_extractor_period ON market_intel_signals(extractor, period_key);

CREATE INDEX idx_mi_signals_sector_period ON market_intel_signals(sector, period_key);

CREATE INDEX idx_mi_signals_user ON market_intel_signals(user_id);

CREATE INDEX idx_mi_snippets_dim ON market_intel_snippets(extractor, dimension_key, period_key);

CREATE INDEX idx_mi_watch_cadence_sent ON market_intel_watchlist(cadence, last_sent_at);

CREATE INDEX idx_mi_watch_user ON market_intel_watchlist(user_id);

CREATE INDEX idx_mp_avail ON marketplace_profiles(availability);

CREATE INDEX idx_mp_rating ON marketplace_profiles(rating);

CREATE INDEX idx_msg_participants_user ON message_thread_participants(user_id);

CREATE INDEX idx_msg_threads_recent  ON message_threads(last_message_at DESC);

CREATE INDEX idx_msg_threads_subject ON message_threads(subject_type, subject_id);

CREATE INDEX idx_mvp_deal ON mvp_tasks(deal_id);

CREATE INDEX idx_mvp_features_project_order
    ON mvp_features (project_id, sort_order);

CREATE INDEX idx_mvp_status ON mvp_tasks(deal_id, status);

CREATE INDEX idx_needs_founder ON founder_needs(founder_id);

CREATE INDEX idx_needs_project ON founder_needs(project_id);

CREATE INDEX idx_needs_status ON founder_needs(status, created_at DESC);

CREATE INDEX idx_network_conn_user
  ON network_connections(user_id, created_at DESC);

CREATE INDEX idx_network_profiles_active_order
        ON network_profiles (is_active, display_order);

CREATE INDEX idx_notifications_user_unread
         ON notifications(user_id, read_at, created_at);

CREATE INDEX idx_offerings_active ON service_offerings(is_active);

CREATE INDEX idx_offerings_company ON service_offerings(owner_user_id, company_id);

CREATE UNIQUE INDEX idx_orders_pi
    ON orders(payment_intent_id) WHERE payment_intent_id IS NOT NULL;

CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);

CREATE INDEX idx_outbox_user_pending
  ON notification_outbox(user_id, flushed_at);

CREATE INDEX idx_pain_group_aliases_group
         ON pain_group_aliases (group_id);

CREATE UNIQUE INDEX idx_pain_group_aliases_project_phrase
         ON pain_group_aliases (project_id, phrase_norm);

CREATE INDEX idx_pain_groups_project ON pain_groups (project_id);

CREATE INDEX idx_pairwise_ndas_a       ON pairwise_ndas(party_a_user_id);

CREATE INDEX idx_pairwise_ndas_b       ON pairwise_ndas(party_b_user_id);

CREATE INDEX idx_pairwise_ndas_expiry  ON pairwise_ndas(valid_until)
  WHERE valid_until IS NOT NULL;

CREATE INDEX idx_pairwise_ndas_status  ON pairwise_ndas(status);

CREATE INDEX idx_partner_bookings_founder ON partner_bookings(founder_user_id, status);

CREATE INDEX idx_partner_bookings_partner ON partner_bookings(partner_id, status);

CREATE INDEX idx_partner_deals_envelope   ON partner_deals(envelope_id);

CREATE INDEX idx_partner_deals_invitation ON partner_deals(invitation_id);

CREATE INDEX idx_partner_deals_referral   ON partner_deals(referral_code);

CREATE INDEX idx_partner_deals_status     ON partner_deals(status);

CREATE INDEX idx_partner_deals_user       ON partner_deals(user_id);

CREATE INDEX idx_partner_fit_rules_partner
  ON partner_fit_rules(partner_id, kind, is_active);

CREATE INDEX idx_partner_invitations_email     ON partner_invitations(recipient_email);

CREATE INDEX idx_partner_invitations_invited_by ON partner_invitations(invited_by_user_id);

CREATE INDEX idx_partner_invitations_status    ON partner_invitations(status);

CREATE INDEX idx_partner_profiles_user ON partner_profiles(user_id);

CREATE INDEX idx_partner_proof_consents_item
  ON partner_proof_consents(proof_item_id, consent_given);

CREATE INDEX idx_partner_proof_items_engagement
  ON partner_proof_items(engagement_id);

CREATE INDEX idx_partner_proof_items_partner
  ON partner_proof_items(partner_id, created_at DESC);

CREATE UNIQUE INDEX idx_partner_retainers_engagement
  ON partner_retainers(engagement_id);

CREATE INDEX idx_partner_retainers_renews
  ON partner_retainers(renews_at);

CREATE INDEX idx_partner_slots_partner ON partner_office_hour_slots(partner_id, starts_at);

CREATE UNIQUE INDEX idx_partner_surfaces_name
  ON partner_surfaces(partner_id, name);

CREATE INDEX idx_partners_directory_listed
           ON partners (directory_listed, directory_featured);

CREATE INDEX idx_partners_email ON partners(email);

CREATE INDEX idx_passkeys_cred ON passkeys(credential_id);

CREATE INDEX idx_passkeys_user ON passkeys(user_id);

CREATE INDEX idx_payouts_user ON payouts(user_id);

CREATE UNIQUE INDEX idx_perk_claims_once ON perk_claims(perk_id, user_id);

CREATE INDEX idx_perk_claims_user ON perk_claims(user_id, created_at);

CREATE UNIQUE INDEX idx_perk_ledger_idem
    ON perk_credit_ledger(user_id, kind, source_ref);

CREATE INDEX idx_perk_ledger_user
    ON perk_credit_ledger(user_id, created_at);

CREATE UNIQUE INDEX idx_perk_views_once ON perk_views(perk_id, user_id, day);

CREATE INDEX idx_perk_views_perk ON perk_views(perk_id, day);

CREATE INDEX idx_perks_company ON perks(partner_user_id, company_id);

CREATE INDEX idx_perks_partner ON perks(partner_user_id, status);

CREATE INDEX idx_perks_status ON perks(status, featured, created_at);

CREATE INDEX idx_positions_fund    ON portfolio_positions(fund_id);

CREATE INDEX idx_positions_project ON portfolio_positions(project_id);

CREATE INDEX idx_pr_a ON partner_relationships(partner_a_id);

CREATE INDEX idx_pr_b ON partner_relationships(partner_b_id);

CREATE INDEX idx_pr_type ON partner_relationships(relationship_type);

CREATE INDEX idx_profile_archetypes_latest
  ON profile_archetypes (user_id, persona, computed_at);

CREATE INDEX idx_projects_company ON projects(company_id);

CREATE INDEX idx_projects_crunchbase_uuid ON projects(crunchbase_uuid);

CREATE INDEX idx_projects_deleted_at ON projects(deleted_at);

CREATE INDEX idx_projects_hubspot_company ON projects(hubspot_company_id);

CREATE INDEX idx_projects_name ON projects(name);

CREATE INDEX idx_projects_sf_account ON projects(sf_account_id);

CREATE INDEX idx_promo_codes_active ON promo_codes(active);

CREATE UNIQUE INDEX idx_promo_codes_normalized ON promo_codes(code_normalized);

CREATE UNIQUE INDEX idx_promo_redemptions_pi ON promo_redemptions(payment_intent_id);

CREATE INDEX idx_promo_redemptions_promo ON promo_redemptions(promo_id);

CREATE INDEX idx_prr_deal ON partner_referral_redemptions(partner_deal_id);

CREATE INDEX idx_prr_user ON partner_referral_redemptions(redeemed_by_user_id);

CREATE INDEX idx_prwn_redemption
  ON partner_revshare_window_notifications(redemption_id);

CREATE INDEX idx_pupdates_project ON portfolio_updates(project_id);

CREATE INDEX idx_pupdates_status  ON portfolio_updates(status);

CREATE INDEX idx_qj_status ON queue_jobs(status, created_at);

CREATE INDEX idx_qj_type ON queue_jobs(job_type, status);

CREATE INDEX idx_queue_status_ts ON queue_jobs(status, created_at);

CREATE INDEX idx_queue_type ON queue_jobs(job_type);

CREATE UNIQUE INDEX idx_quote_negotiations_quote
  ON quote_negotiations(quote_id);

CREATE INDEX idx_quote_negotiations_stage
  ON quote_negotiations(stage, last_moved_at DESC);

CREATE INDEX idx_quote_terms_negotiation
  ON quote_terms(negotiation_id, state);

CREATE INDEX idx_quotes_company ON quotes(company_id);

CREATE INDEX idx_quotes_need ON quotes(need_id, status);

CREATE INDEX idx_quotes_partner ON quotes(partner_id, status);

CREATE INDEX idx_raise_closes_project ON raise_closes(project_id);

CREATE INDEX idx_raise_closes_round ON raise_closes(round_id, sequence);

CREATE INDEX idx_raise_pro_rata_round ON raise_pro_rata(round_id);

CREATE INDEX idx_raise_prospects_close ON raise_prospects(close_id);

CREATE INDEX idx_raise_prospects_contact ON raise_prospects(contact_id);

CREATE INDEX idx_raise_prospects_project ON raise_prospects(project_id);

CREATE INDEX idx_raise_rounds_project ON raise_rounds(project_id);

CREATE INDEX idx_raise_updates_project ON raise_investor_updates(project_id);

CREATE INDEX idx_re_rel ON relationship_events(relationship_id, created_at);

CREATE INDEX idx_recovery_tickets_status ON auth_recovery_tickets(status, created_at DESC);

CREATE INDEX idx_recovery_tickets_user ON auth_recovery_tickets(user_id, created_at DESC);

CREATE INDEX idx_refchk_deal ON reference_checks(deal_id, created_at DESC);

CREATE INDEX idx_referral_payouts_referrer ON referral_payouts(referrer_user_id);

CREATE INDEX idx_referral_payouts_status   ON referral_payouts(status);

CREATE INDEX idx_referral_payouts_transfer ON referral_payouts(stripe_transfer_id);

CREATE INDEX idx_referral_submission_events_submission
  ON referral_submission_events(submission_id, created_at);

CREATE INDEX idx_referral_submissions_referrer
  ON referral_submissions(referrer_user_id, created_at DESC);

CREATE INDEX idx_referral_submissions_status
  ON referral_submissions(status, created_at DESC);

CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);

CREATE INDEX idx_research_benchmarks_owner
    ON research_benchmarks (owner_user_id, created_at DESC);

CREATE INDEX idx_research_documents_owner
  ON research_documents(owner_user_id, created_at DESC);

CREATE INDEX idx_research_documents_state
  ON research_documents(index_state, id);

CREATE INDEX idx_research_funds_owner
    ON research_funds (owner_user_id, created_at DESC);

CREATE INDEX idx_research_funds_state
    ON research_funds (owner_user_id, status, stage_fit, path);

CREATE UNIQUE INDEX idx_retainer_usage_period
  ON retainer_usage(retainer_id, period);

CREATE INDEX idx_rl_blocked_ts ON rate_limit_logs(blocked, created_at);

CREATE INDEX idx_rl_endpoint ON rate_limit_logs(endpoint);

CREATE INDEX idx_rl_user_ts ON rate_limit_logs(user_id, created_at);

CREATE INDEX idx_roadmap_okrs_project_status_order
    ON roadmap_okrs (project_id, kanban_status, sort_order);

CREATE INDEX idx_rofr_notice_date ON secondary_rofr_notices(notice_date);

CREATE INDEX idx_rounds_project ON rounds(project_id);

CREATE INDEX idx_sanctions_hit    ON sanctions_screenings(hit, run_at);

CREATE INDEX idx_sanctions_run_at ON sanctions_screenings(run_at);

CREATE INDEX idx_sanctions_user   ON sanctions_screenings(user_id);

CREATE INDEX idx_scores_locked_until ON score_snapshots(project_id, locked_until);

CREATE INDEX idx_scores_project ON score_snapshots(project_id);

CREATE INDEX idx_scores_project_created
  ON score_snapshots(project_id, created_at DESC);

CREATE INDEX idx_scores_review       ON score_snapshots(admin_review_status);

CREATE INDEX idx_scores_sandbox      ON score_snapshots(project_id, is_sandbox, created_at);

CREATE INDEX idx_se_sub ON spinout_events(subsidiary_id, created_at DESC);

CREATE INDEX idx_se_type ON spinout_events(event_type);

CREATE INDEX idx_signal_companies_cap_band ON signal_companies(market_cap_band);

CREATE INDEX idx_signal_companies_region ON signal_companies(region);

CREATE INDEX idx_signal_companies_sector ON signal_companies(sector);

CREATE INDEX idx_signal_company_map_symbol ON signal_company_map(symbol);

CREATE INDEX idx_signal_evidence_signal ON signal_evidence(signal_id);

CREATE INDEX idx_signal_evidence_source ON signal_evidence(source_key);

CREATE INDEX idx_signal_ingest_runs_source ON signal_ingest_runs(source_key);

CREATE INDEX idx_signals_rank ON signals(rank_score DESC);

CREATE INDEX idx_signals_region ON signals(region);

CREATE INDEX idx_signals_sector ON signals(sector);

CREATE INDEX idx_signals_status ON signals(status);

CREATE INDEX idx_signals_type ON signals(type);

CREATE INDEX idx_skill_categories_radar
        ON skill_categories (is_radar_axis, display_order);

CREATE INDEX idx_skill_endorsements_endorsee
        ON skill_endorsements (endorsee_id);

CREATE INDEX idx_skill_endorsements_endorser
        ON skill_endorsements (endorser_id);

CREATE INDEX idx_skill_endorsements_skill
        ON skill_endorsements (skill_id);

CREATE INDEX idx_skills_active
        ON skills (is_active);

CREATE INDEX idx_skills_category
        ON skills (category_slug, display_order);

CREATE INDEX idx_sm_name_time ON system_metrics(metric_name, timestamp);

CREATE INDEX idx_sm_user ON syndicate_members(user_id);

CREATE INDEX idx_spinout_cert_credid ON spinout_certificates(credential_id);

CREATE INDEX idx_spinout_cert_token ON spinout_certificates(public_token);

CREATE INDEX idx_spinout_cert_user ON spinout_certificates(user_id);

CREATE UNIQUE INDEX idx_spinout_deck_overrides_project_key
    ON spinout_deck_overrides(project_id, field_key);

CREATE INDEX idx_spinout_lab_milestones_user
    ON spinout_lab_milestones(user_id);

CREATE INDEX idx_ssl_actor_action_ts
  ON shared_services_log(performed_by, action_type, created_at);

CREATE INDEX idx_stages_active ON project_stages(deal_id, status);

CREATE INDEX idx_stages_deal ON project_stages(deal_id);

CREATE INDEX idx_stripe_products_active ON stripe_products(active);

CREATE INDEX idx_stripe_products_kind ON stripe_products(kind);

CREATE INDEX idx_sub_plans_active ON subscription_plans(is_active);

CREATE INDEX idx_sub_status ON subsidiaries(stripe_atlas_status);

CREATE INDEX idx_syn_deal ON syndicates(deal_id, status);

CREATE INDEX idx_syn_status ON syndicates(status);

CREATE INDEX idx_syndicates_deal ON syndicates(deal_id);

CREATE INDEX idx_syndicates_status ON syndicates(status);

CREATE UNIQUE INDEX idx_syndmember_unique ON syndicate_members(syndicate_id, user_id);

CREATE INDEX idx_syndmember_user ON syndicate_members(user_id);

CREATE INDEX idx_tasks_assigned ON workflow_tasks(assigned_to);

CREATE INDEX idx_tasks_workflow ON workflow_tasks(workflow_id);

CREATE INDEX idx_team_members_published_order
        ON team_members (published, display_order);

CREATE INDEX idx_telegram_aggregations_audience ON telegram_aggregations(audience, created_at DESC);

CREATE INDEX idx_telegram_channels_audience ON telegram_channels(audience, enabled);

CREATE INDEX idx_telegram_join_requests_user ON telegram_join_requests(user_id, created_at DESC);

CREATE INDEX idx_telegram_posts_channel ON telegram_posts(channel_id, created_at DESC);

CREATE INDEX idx_telegram_posts_status ON telegram_posts(status, created_at DESC);

CREATE INDEX idx_tickets_user ON tickets(user_id);

CREATE INDEX idx_trusted_contacts_lookup ON auth_trusted_contacts(contact_user_id, status);

CREATE INDEX idx_trusted_contacts_user ON auth_trusted_contacts(user_id, status);

CREATE INDEX idx_uclink_authority
    ON user_company_links(company_id, authority);

CREATE INDEX idx_uclink_user ON user_company_links(user_id);

CREATE UNIQUE INDEX idx_uclink_user_company
  ON user_company_links(user_id, company_id);

CREATE INDEX idx_us_jti ON user_sessions(jti);

CREATE INDEX idx_us_user ON user_sessions(user_id);

CREATE INDEX idx_user_badges_user
        ON user_badges (user_id, awarded_at);

CREATE UNIQUE INDEX idx_user_google_links_sub
  ON user_google_links(google_sub);

CREATE INDEX idx_user_personas_user ON user_personas(user_id);

CREATE INDEX idx_user_products_order ON user_products(order_ref);

CREATE INDEX idx_user_products_user  ON user_products(user_id);

CREATE INDEX idx_user_profile_extras_persona ON user_profile_extras(user_id, persona_id);

CREATE INDEX idx_user_profile_extras_user ON user_profile_extras(user_id);

CREATE INDEX idx_user_role_review_confirmed
    ON user_role_review(role_confirmed);

CREATE INDEX idx_user_settings_slug
  ON user_settings(profile_slug)
  WHERE profile_slug IS NOT NULL;

CREATE INDEX idx_user_skills_skill
        ON user_skills (skill_id);

CREATE INDEX idx_user_skills_user
        ON user_skills (user_id);

CREATE INDEX idx_user_values_user
        ON user_values (user_id, updated_at);

CREATE INDEX idx_users_email ON users(email);

CREATE UNIQUE INDEX idx_users_founder_public_id ON users(founder_public_id) WHERE founder_public_id IS NOT NULL;

CREATE INDEX idx_users_investor_seat_primary ON users(investor_seat_primary_user_id);

CREATE INDEX idx_users_investor_stripe_cust ON users(investor_stripe_customer_id);

CREATE INDEX idx_users_investor_tier ON users(investor_tier);

CREATE INDEX idx_users_investor_trial ON users(investor_trial_ends_at);

CREATE INDEX idx_users_last_active ON users(last_active_at);

CREATE INDEX idx_users_legacy_referral_code ON users(legacy_referral_code);

CREATE INDEX idx_users_mi_digest_paused
  ON users(mi_digest_paused_until)
  WHERE mi_digest_paused_until IS NOT NULL;

CREATE INDEX idx_users_mi_optout ON users(mi_contribution_optout) WHERE mi_contribution_optout = 1;

CREATE UNIQUE INDEX idx_users_partner_public_id ON users(partner_public_id) WHERE partner_public_id IS NOT NULL;

CREATE INDEX idx_users_referral_code ON users(referral_code);

CREATE INDEX idx_users_stripe_connect_account_id ON users(stripe_connect_account_id);

CREATE INDEX idx_users_stripe_customer     ON users(stripe_customer_id);

CREATE INDEX idx_users_stripe_subscription ON users(stripe_subscription_id);

CREATE INDEX idx_users_subscription_tier   ON users(subscription_tier);

CREATE INDEX idx_users_uid ON users(uid);

CREATE INDEX idx_validate_proposals_project_kind
    ON validate_proposals (project_id, kind);

CREATE INDEX idx_validate_proposals_project_status
    ON validate_proposals (project_id, status, id DESC);

CREATE INDEX idx_validation_decisions_project
    ON validation_decisions (project_id, superseded_at);

CREATE INDEX idx_value_dimensions_family
        ON value_dimensions (family, display_order);

CREATE INDEX idx_vc_funds_company
  ON vc_funds(gp_user_id, company_id);

CREATE UNIQUE INDEX idx_vc_funds_slug ON vc_funds(slug) WHERE slug IS NOT NULL;

CREATE INDEX idx_waitlist_audience ON waitlist_signups(project_id, audience);

CREATE INDEX idx_waitlist_crm ON waitlist_signups(project_id, crm_status);

CREATE INDEX idx_waitlist_email ON waitlist_signups(email);

CREATE INDEX idx_waitlist_project ON waitlist_signups(project_id);

CREATE INDEX idx_watchlist_company
  ON watchlist_items(owner_user_id, company_id);

CREATE INDEX idx_watchlist_owner ON watchlist_items(owner_user_id, status);

CREATE INDEX idx_watchlist_project ON watchlist_items(project_id);

CREATE INDEX idx_wb_checkin_created ON wellbeing_checkins(created_at);

CREATE INDEX idx_wb_checkin_user ON wellbeing_checkins(user_id, created_at DESC);

CREATE INDEX idx_wb_res_category ON wellbeing_resources(category, sort_order);

CREATE INDEX idx_wb_res_region ON wellbeing_resources(region);

CREATE INDEX idx_webauthn_chal ON webauthn_challenges(challenge);

CREATE INDEX idx_wellbeing_daily_user_day
       ON wellbeing_daily_pulses(user_id, day DESC);

CREATE INDEX idx_workflows_owner ON workflows(owner_user_id);

CREATE INDEX idx_workflows_project ON workflows(project_id);

CREATE UNIQUE INDEX idx_workflows_project_template ON workflows(project_id, template_key) WHERE project_id IS NOT NULL AND template_key IS NOT NULL;

CREATE INDEX idx_workflows_type ON workflows(type);

CREATE INDEX idx_wtasks_assignee ON workflow_tasks(assignee_user_id, status, due_date);

CREATE INDEX idx_wtasks_workflow ON workflow_tasks(workflow_id, status);

CREATE INDEX idx_x_accounts_enabled ON x_accounts(enabled);

CREATE INDEX idx_x_posts_account ON x_posts(account_id, created_at DESC);

CREATE INDEX idx_x_posts_status ON x_posts(status, created_at DESC);

CREATE INDEX idx_x_posts_thread ON x_posts(thread_continuation_of, thread_position);

CREATE INDEX ix_cws_cycle_week ON company_week_status(cohort_cycle_id, week_number, status);

CREATE INDEX ix_cws_user ON company_week_status(user_id);

CREATE INDEX ix_ds_user_cycle ON deliverable_snapshots(user_id, cohort_cycle_id, week_number);

CREATE INDEX ix_imp_admin ON impersonation_sessions(admin_user_id, started_at DESC);

CREATE INDEX ix_pmi_invitee_email ON project_member_invitations (invitee_email, status);

CREATE INDEX ix_pmi_invitee_user ON project_member_invitations (invitee_user_id, status);

CREATE INDEX ix_pmi_project ON project_member_invitations (project_id, status);

CREATE INDEX ix_project_members_project ON project_members (project_id, status);

CREATE INDEX ix_project_members_user ON project_members (user_id, status);

CREATE INDEX ix_spinout_applications_status ON spinout_applications(status);

CREATE INDEX ix_spinout_applications_user ON spinout_applications(user_id);

CREATE INDEX ix_stl_user ON stage_transition_log(user_id, created_at DESC);

CREATE UNIQUE INDEX uq_83b_project_user_grant
       ON section_83b_trackers(project_id, user_id, grant_date);

CREATE UNIQUE INDEX uq_cap_table_holders_carta ON cap_table_holders(user_id, carta_stakeholder_id, carta_security_id) WHERE carta_stakeholder_id IS NOT NULL;

CREATE UNIQUE INDEX uq_cap_table_securities_carta ON cap_table_securities(user_id, carta_id) WHERE carta_id IS NOT NULL;

CREATE UNIQUE INDEX uq_captable_one_canonical_per_project
  ON cap_table_scenarios(project_id)
  WHERE project_id IS NOT NULL AND COALESCE(is_variant, 0) = 0;

CREATE UNIQUE INDEX uq_dist_event_lp
  ON fund_distributions(source_liquidity_event_id, fund_id, lp_id)
  WHERE source_liquidity_event_id IS NOT NULL;

CREATE UNIQUE INDEX uq_esign_account_docusign_envelope
  ON esign_envelopes(docusign_account_id, docusign_envelope_id)
  WHERE docusign_envelope_id IS NOT NULL;

CREATE UNIQUE INDEX uq_limited_partners_fund_email
    ON limited_partners(fund_id, email);

CREATE UNIQUE INDEX uq_notifications_dedupe
         ON notifications(user_id, kind, dedupe_key);

CREATE UNIQUE INDEX uq_pmi_token ON project_member_invitations (token_hash);

CREATE UNIQUE INDEX uq_pr_pair ON partner_relationships(partner_a_id, partner_b_id);

CREATE UNIQUE INDEX uq_project_members_pair ON project_members (project_id, user_id);

CREATE UNIQUE INDEX uq_raise_pro_rata_holder ON raise_pro_rata(round_id, holder_email) WHERE holder_email IS NOT NULL;

CREATE UNIQUE INDEX uq_raise_rounds_active ON raise_rounds(project_id) WHERE status = 'active';

CREATE UNIQUE INDEX uq_score_official_week
  ON score_snapshots(project_id, official_week)
  WHERE is_sandbox = 0 AND official_week IS NOT NULL;

CREATE UNIQUE INDEX uq_sm_syn_user ON syndicate_members(syndicate_id, user_id);

CREATE UNIQUE INDEX uq_spinout_cert_user_issued
  ON spinout_certificates(user_id) WHERE status = 'issued';

CREATE UNIQUE INDEX uq_stages_one_active ON project_stages(deal_id) WHERE status = 'active';

CREATE UNIQUE INDEX uq_sub_deal ON subsidiaries(deal_id);

CREATE UNIQUE INDEX uq_trusted_contacts_pair ON auth_trusted_contacts(user_id, contact_email);

CREATE UNIQUE INDEX uq_watchlist_owner_external
  ON watchlist_items(owner_user_id, external_name) WHERE project_id IS NULL;

CREATE UNIQUE INDEX uq_workflows_template_global
  ON workflows(template_key) WHERE template_key IS NOT NULL AND project_id IS NULL;

CREATE UNIQUE INDEX uq_workflows_template_project
  ON workflows(template_key, project_id) WHERE template_key IS NOT NULL AND project_id IS NOT NULL;

CREATE TRIGGER lp_investors_block_insert
BEFORE INSERT ON lp_investors
BEGIN
    SELECT RAISE(ABORT,
        'lp_investors is sealed (Epic 11). Use limited_partners + vc_funds instead. See backend/app/models/entities.py:LPInvestor docstring for context.'
    );
END;

CREATE TRIGGER lp_investors_block_update
BEFORE UPDATE ON lp_investors
BEGIN
    SELECT RAISE(ABORT,
        'lp_investors is sealed (Epic 11). Use limited_partners + vc_funds instead.'
    );
END;

CREATE VIEW partner_summary AS
      SELECT u.id, u.email, u.name, u.role, u.kyc_status,
        u.partner_since, u.total_earnings, u.network_score, u.verified_badges, u.last_active,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM commissions WHERE user_id = u.id) AS lifetime_earnings_cents,
        (SELECT COUNT(*) FROM partner_relationships WHERE partner_a_id = u.id OR partner_b_id = u.id) AS active_relationships,
        (SELECT COUNT(*) FROM referral_chains WHERE root_referrer_id = u.id) AS network_reach
      FROM users u;
