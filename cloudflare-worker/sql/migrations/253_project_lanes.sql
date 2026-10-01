-- 253 — swimlanes on the execution board, with a WIP limit that is a limit.
--
-- WHAT WAS MISSING. `/build/board` (FB2) draws `All lanes · Engineering · GTM ·
-- Mine · Stale > 7d` and its artboard's instrument is headed "Swimlanes · WIP
-- limits enforced" with a `Card | Lane | Age | Owner` table. Two of those five
-- chips were not in the registry at ALL — Engineering and GTM existed only as one
-- entry reading "a card carries a stage, not a lane, and no lane is stored" — and
-- the `Configure lanes` op's own reason names the fix: "the six lanes are written
-- into the code twice and no per-project stage list is stored, so there is nothing
-- for an editor to change".
--
-- Both were true. `mvp_tasks` — the board's cards — has `deal_id`, `title`,
-- `status`, `assigned_to` and no lane. The six columns the board draws are a
-- literal, written twice (`FounderBuildBoard.jsx` and `pages/PipelinePage.jsx`).
--
-- A LANE IS NOT A STATUS, and conflating them is why this looked impossible. The
-- status is WHERE a card is in its life (todo → doing → done); the lane is WHOSE
-- work it is (Engineering, GTM, Ops). The canvas's own table has both columns on
-- every row, and its note depends on the difference: "Engineering is one card over
-- its WIP limit of four, which is why the permissions card sits in backlog rather
-- than starting." A WIP limit counts cards in flight WITHIN a lane, which cannot be
-- expressed if the lane is the status.
--
-- So: a lane is a new column on the card, and the LIST of lanes is a per-project
-- table — which is what makes `Configure lanes` an editor over rows rather than a
-- request to change source code.
--
-- NOTHING IS SEEDED, and `lane` IS NULLABLE. A project that has never configured
-- lanes has none, and its cards are all unassigned — which the board draws as one
-- lane called "Unassigned" rather than inventing an Engineering lane the founder
-- never asked for. Seeding "Engineering, GTM, Ops" would put three lanes on the
-- board of a solo founder building a design tool.
--
-- No BEGIN/COMMIT: D1 rejects transaction statements inside a migration
-- (migration 200 learned that the hard way).

-- ── The list of lanes a project has ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_lanes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    -- How many cards may be IN FLIGHT in this lane at once. NULL means no limit,
    -- which is different from 0 — zero is a lane that is closed to new work, and a
    -- founder pausing a workstream without deleting its cards is a real thing to
    -- want. `Number(null)` is 0 and finite, so the route checks emptiness first.
    wip_limit INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    -- One lane per name per project. Two lanes called "Engineering" would split a
    -- WIP limit in half without saying so.
    UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_project_lanes_project
    ON project_lanes(project_id, sort_order);

-- ── The lane a card is in ────────────────────────────────────────────────────
-- The lane is stored as a NAME, not a `project_lanes.id`, and that is deliberate.
-- The alternative makes renaming a lane either break every card in it or require a
-- cascade; the name is what the founder typed and what the board draws, and a
-- rename is one UPDATE on the cards plus one on the lane. The cost is that a card
-- can name a lane that no longer exists — which the board shows as its own group
-- rather than hiding, because a card nobody can see is worse than a lane nobody
-- configured.
--
-- D1 has no `ADD COLUMN IF NOT EXISTS`, so this runs once and the runtime
-- bootstrap in `progress.ts` handles a database where it has not.
ALTER TABLE mvp_tasks ADD COLUMN lane TEXT;
