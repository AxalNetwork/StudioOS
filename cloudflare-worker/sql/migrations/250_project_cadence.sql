-- 250 — the operating cadence: rituals, the runs that archive them, templates.
--
-- WHAT WAS MISSING. `/build/cadence` (FB4 in
-- `design/canvases/integrated/Pages · Founder Build.dc.html`) is a FEED over a
-- review archive, and there was no archive. The page loaded the project list
-- and no second source, printed "Cadence store unavailable" four times over,
-- and all four of its filter chips plus all three of its ops were registered
-- `unbuilt` — which renders NOTHING, so a founder saw a zone with an empty
-- toolbar and no explanation. Task #176 is the third report of it.
--
-- THREE TABLES, NOT ONE, BECAUSE THREE DIFFERENT THINGS ARE BEING STATED.
-- A ritual is a STANDING INTENTION ("we retro on Fridays"). A run is WHAT
-- HAPPENED on one date, including not happening. A template is the PROMPT a
-- ritual is conducted from. Folding runs into rituals would make the archive a
-- property of the schedule, so changing the schedule would rewrite history;
-- folding templates in would mean two rituals cannot share one prompt, which is
-- the first thing a founder with a Monday plan and a Friday retro wants.
--
-- WHAT IS NOT STORED, DELIBERATELY. Not adherence, not the review count, not
-- the average retro length. All three are counts over `ritual_runs` and the
-- route computes them at read time — the same rule `founder_validate.ts`
-- states for its verdict ("storing any of them would be a second answer to a
-- question the interviews already answer, and the two disagree the first time
-- an interview is edited").
--
-- A CALENDAR EVENT IS STILL NOT A RITUAL. The page said so before this
-- migration and the sentence survives it: nothing here reads `calendar_events`,
-- and no roadmap change is inferred to be a review outcome. An operating
-- rhythm you did not record is one you did not have.
--
-- No BEGIN/COMMIT: D1 rejects transaction statements inside a migration
-- (migration 200 learned that the hard way).

-- ── The standing intention ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_rituals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    -- 'plan' | 'standup' | 'retro' | 'other'. The zone's filter row is
    -- `All rituals · Plans · Retros · Skipped`, so `plan` and `retro` are the
    -- two the product asks a question about by name; `standup` exists because
    -- the canvas's own sample cadence has one, and `other` is the escape so a
    -- founder's weekly investor sync does not have to lie about being a retro.
    kind TEXT NOT NULL DEFAULT 'other',
    -- 'weekly' | 'biweekly' | 'monthly'. What "next runs" means.
    frequency TEXT NOT NULL DEFAULT 'weekly',
    -- 0 = Sunday … 6 = Saturday, matching `Date.prototype.getUTCDay`. NULL for
    -- a monthly ritual that is pinned to a date rather than a weekday.
    weekday INTEGER,
    -- How long it is MEANT to take. The canvas reports "Avg retro length ·
    -- 22 min · target 30", and the target is the ritual's, not the platform's.
    target_minutes INTEGER,
    template_id INTEGER,
    -- 1 while the ritual is part of the cadence. Retiring a ritual must not
    -- delete its runs: the archive is the point of the zone.
    active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_project_rituals_project
    ON project_rituals(project_id, active, kind);

-- ── What actually happened, one row per occurrence ───────────────────────────
CREATE TABLE IF NOT EXISTS ritual_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    ritual_id INTEGER NOT NULL,
    -- `YYYY-MM-DD`. Text, sorting lexicographically in date order, which is
    -- what the archive's "newest first" orders by.
    run_date TEXT NOT NULL,
    -- 'done' | 'missed'. Two states and no third: a run that has not happened
    -- yet is ABSENT, not 'pending'. The canvas's Aug 14 row is `Missed`
    -- with "Skipped — travel. No note left." — a missed ritual is a recorded
    -- fact about the cadence, which is exactly why adherence can be computed.
    state TEXT NOT NULL DEFAULT 'done',
    -- "What came out of it" — the archive's fourth column and its reason for
    -- existing. NULL is honest for a missed run nobody annotated.
    outcome TEXT,
    -- How long it took. NULL rather than 0 when nobody timed it: `Number(null)`
    -- and `Number('')` are both 0 and both finite, so an average over
    -- unrecorded lengths would report a real-looking figure from nothing.
    duration_minutes INTEGER,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
);

-- ONE RUN PER RITUAL PER DATE. Friday's retro happened once. Without this a
-- double-submit files the same review twice and every count above it — reviews
-- archived, adherence, average length — is quietly wrong in the direction that
-- flatters.
--
-- Both columns are NOT NULL, so unlike migration 249's `source` there is no
-- NULL-distinctness hole here: SQLite treats NULLs as distinct in a UNIQUE
-- index, and a nullable column in one would have let the duplicate straight
-- through.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ritual_runs_once
    ON ritual_runs(ritual_id, run_date);

CREATE INDEX IF NOT EXISTS idx_ritual_runs_archive
    ON ritual_runs(project_id, run_date DESC);

-- ── The prompt a ritual is conducted from ────────────────────────────────────
CREATE TABLE IF NOT EXISTS ritual_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'other',
    body TEXT NOT NULL,
    -- The slug of the built-in starting point this was created from, or NULL
    -- when the founder wrote it from scratch. Kept so "1 customised" can be
    -- said without storing the derived flag: see below.
    based_on TEXT,
    -- WHEN SOMEONE CHANGED IT, which is a fact, rather than a `customised`
    -- boolean, which is a derivation. The canvas reports "Templates · 3 ·
    -- 1 customised"; that count is `edited_at IS NOT NULL`, and a timestamp
    -- also answers the next question a reader has, which a flag cannot.
    edited_at TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ritual_templates_project
    ON ritual_templates(project_id, kind);
