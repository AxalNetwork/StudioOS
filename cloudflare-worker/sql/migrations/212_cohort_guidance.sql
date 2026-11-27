-- 212 — guidance addressed to a batch, and who acted on it.
--
-- WHAT IS MISSING TODAY, in the words the product already uses. The Cohorts ·
-- Guidance card says: "nothing records a piece of guidance addressed to a
-- batch, and nothing records a founder acting on one. Migrations 201-206 gave
-- the practice a profile, services, proof, consents, session amounts and a
-- cohort link; none of them is this." Checked against production before
-- writing — no guidance, ack or thread table exists under any name — so this
-- is the one card in PR C that is right about what is absent. (Thinking's and
-- Calendar's were not; see the routes.)
--
-- THE CARD AND THE CANVAS DISAGREE ABOUT WHAT THIS IS, and the schema is shaped
-- so that neither has to be reopened when the other lands. The card describes
-- broadcast-and-acknowledge: the advisor writes one piece of guidance to the
-- batch, founders act on it. The canvas (Pages · Advisor Cohorts, artboard C2)
-- draws a question queue: founders ask, the advisor answers, with "Open",
-- "Overdue" and a median response time. Those are two write surfaces, and the
-- second needs a founder-side page that belongs to no current pass.
--
-- So `asked_by_user_id` is NULLABLE. NULL is the advisor posting unprompted —
-- the card's model, and the only one this pass builds a surface for. A
-- non-NULL asker is a founder's question, with `answer` and `answered_at` for
-- the advisor's reply. The queue's tiles become computable the day a founder
-- can write here, from these same columns, without a second table.
--
-- ACKNOWLEDGEMENT IS A ROW, NOT A COUNTER. "Which founders have acted on it" is
-- the card's whole second sentence, and a count would answer "how many" while
-- losing "who" — which is the thing an advisor with twelve founders actually
-- needs. UNIQUE per (guidance, founder) so acting twice is once.
--
-- IT CHANGES NO LAB TABLE, ROUTE OR SURFACE. Same standing instruction 206
-- states: this sits beside the Lab and reads its cycle id, and nothing here
-- writes to anything the Lab owns. `cohort_cycle_id` references the Lab's own
-- `cohort_cycles` exactly as `advisor_cohort_assignments` does.
--
-- WHAT IS DELIBERATELY NOT HERE. No `status` column: open / answered / overdue
-- are all derivable from `answer IS NULL` and `posted_at`, and a stored status
-- disagrees with those the first time one is edited. No response-time column:
-- it is `answered_at - posted_at`. No "24h commitment" setting: nothing can
-- write one yet, and a settings row nobody can change is a table pretending to
-- be a feature. The pages say what is not built.

CREATE TABLE IF NOT EXISTS cohort_guidance (
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

CREATE INDEX IF NOT EXISTS idx_cohort_guidance_cycle
    ON cohort_guidance (cohort_cycle_id, posted_at);

CREATE INDEX IF NOT EXISTS idx_cohort_guidance_advisor
    ON cohort_guidance (advisor_user_id);

CREATE TABLE IF NOT EXISTS cohort_guidance_acks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guidance_id INTEGER NOT NULL REFERENCES cohort_guidance(id) ON DELETE CASCADE,
    founder_user_id INTEGER NOT NULL REFERENCES users(id),
    acted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note TEXT,
    UNIQUE (guidance_id, founder_user_id)
);

CREATE INDEX IF NOT EXISTS idx_cohort_guidance_acks_founder
    ON cohort_guidance_acks (founder_user_id);
