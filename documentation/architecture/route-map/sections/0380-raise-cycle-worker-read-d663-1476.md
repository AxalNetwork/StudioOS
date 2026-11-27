### Raise cycle Worker read (D663, #1476)

`cycle_raise.ts`, mounted at `/api/cycles/raise`, is the Worker half of the
Raise cycle in `Cycle Overview.dc.html` (cycle Raise, O3) and
`Cycle Modules · Boards.dc.html` (MR1–MR7). `GET /overview?project=` returns
six figures (readiness score out of 100, committed against the target,
investors in conversation, months of runway, and since D1610 deck views over
8 weeks and data-room files) and seven cards. D1610 (#3943) adds `next_steps`
(up to three readiness items by score gain, never Team, `gain_points` null when
unknown), `connectors` (Mercury, GitHub and Google Workspace: state, a count
fact and the last read, `as_of` null when none is stored) and the Cap table
card's `plan` (locked below Raise + Grow). Staff (D1191) get four figures, never
Committed or Investors in conversation, plus the same `next_steps` and
`connectors`. The readiness legend has four shades, Stated its own (`v4`).
`GET /modules/:slug?project=` returns one card and its records table. The
slugs are `fundraising-readiness`, `investor-narrative`, `pitch-deck`,
`data-room`, `cap-table`, `use-of-funds` and `capital-relationships`. The
writes (D691, #1700's second PR, #1751) are `PUT /readiness/:key`,
`POST /readiness/rescore` (`{ items?, since? }`), `POST /narrative-versions`
and `PATCH /narrative-versions/:version`, `POST /deck-links` and
`PATCH /deck-links/:id` (through `createShareLink()`, plan-gated as the share
route is), `POST /holders` and `PATCH /holders/:id` (through `addHolder()` and
`updateHolder()`), `PUT /use-of-funds`, `POST /prospects` and
`PATCH /prospects/:id` (through `createProspect`),
`PUT /data-room/files/:id/checklist` and `PUT /prospects/:id/next-step`, and
D1192's `POST /prospects/import` (`{ rows }`, at most 50, through
`createProspect`, → `{ created, total, skipped: [{ row, reason }] }`);
`PATCH /prospects/:id` also takes D1192's `commit_status` (soft, signed or
wired, only at Committed; a stage moved away clears it). Each
checks every id it takes against this venture (404 otherwise) and logs one
`raise.<module>` activity row per record it writes. The record actions
(duplicate, revoke, add-hire, log, add-feedback, mark-passed, edit, edit-split,
re-score, score, and the data room's replace and remove) are declared on the
records in "Cycle records" above, each through the same writer. #1700's third
PR wrote the writers for duplicate, revoke, add-hire, log, add-feedback and
mark-passed, and the data room's `replaceDataRoomFile()` and
`removeDataRoomFile()`.
Only the venture and admins reach it. The
pipeline, cap table, data room and pitch tools keep their own pages; the
module pages summarise them and link there. The deck share viewer's heartbeat
now sends seconds per slide, which closes the "no per-slide dwell" gap noted
for Pitch below. With `ROUND_CALLS_ENABLED` on, Capital relationships marks the
prospects that responded to a round call (D653) and counts their soft
commitments; it reads `round_call_recipients` and writes nothing. See
`decisions/D663.md`.

**D1141 (#2433)** initially added the Product-market fit placeholder above
From Mercury and RD4's model definition, plus Validate's door to
`/raise/fundraising-readiness`. Canvas RD1–RD19 lives in `design/incoming/`.

**D1144 (#3030)** stores D1143's engine result on a changed inputs hash in
migration 598's shared scoring tables. The module read returns `parts.pmf`
before reading its checklist; PMF's failure leaves the other blocks available.
`GET /api/cycles/raise/pmf/history?project=&limit=&before=` returns signed stored
points through the same founder/admin `canWrite` gate. Re-score takes
`pmf: true`; `items: ['pmf']` runs just that engine. Item 8 contributes value ÷ 10
only at Medium confidence or more. Snapshot, checklist and `pmf_recomputed`
audit are atomic. The history client is `cycleWrites.raise.pmfHistory`. The
full frontend and Eadwyn explanation remain the later readiness parts. See
`decisions/D1144.md` for the stored payload and paging contract.

**D1145 (#3031)** replaces D1141's placeholder with the stored score
(`PmfPart.jsx`, `pmfModel.js`): the Product-market fit and raise kit tiles, the
ten inputs in four groups with an input lightbox (a bottom sheet on a phone),
the gaps from both scores, and the history from `pmfHistory` with the pivot
marked. Below the floor no number shows; a failed or missing read is Unreadable
with Try again, never "no score". Re-score offers Product-market fit and sends
`pmf: true`. On the Worker, one Validate store that cannot be read now marks
only the inputs it feeds as `unreadable`: the score is drawn without them at a
lower confidence and is not stored. Below the floor such a read is Unreadable.
See `decisions/D1145.md`.

**D1146 (#3032)** draws RD4, "How Product-market fit is scored", as a dialog
opened from the readiness part. It reads `GET /api/cycles/raise/pmf/model?project=`,
which answers the stored `scoring_model_versions` row the venture's latest point
used (or, before any point, the code's definition marked `stored: false`, which
the first score publishes). A missing or undrawable row is Unreadable, never
the code's copy. RD12 is now a chip in Validate's overview header, reading the
venture's latest stored point (`pmfHistory`, `limit: 1`) as its band and
confidence; it computes nothing. D1141's line under the overview is gone.

**D1147 (#3033)** adds `raise/pmf-explain`, a separate RD11 Eadwyn band.
`GET|POST /api/cycles/raise/pmf/explain?project=` reads kept wording or previews
an explanation/questions from verified input rows matching the displayed
snapshot hash. D1145 partial reads without a persisted hash do not mount the
band or use an older stored snapshot. `POST .../keep?project=`
alone saves a signed reading and actor audit; previews/questions save no
reading. The founder owns the project, outside support sessions; no admin
bypass. Neither run nor Keep changes PMF, checklist scores or source records.
Question controls copy or dismiss. The full PMF card remains #3031's scope.

