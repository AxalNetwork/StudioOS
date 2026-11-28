-- D8775 (#8775): one feature carried from must-have to a builder, a reviewer and a dated test with its deliverable.
--
--   mvp_features.reviewer_user_id     the person who reviews the must-have's work. Optional on its own; required
--                                     when an agent builds it (owner's option A on Q2: an agent only drafts, a
--                                     named person reviews). The route checks the person is on the project's
--                                     team or in its company (Q1, option A), as it does for the owner.
--   mvp_features.builder_agent_id     the project's own active agent that builds the must-have, or NULL when a
--                                     person does. Never set without a reviewer (the route refuses it).
--   mvp_test_sessions.deliverable_url the https address of what was tested (a prototype, a preview, a demo). A
--                                     session with an address and no kept finding is "Returned", never "Tested":
--                                     a linked URL alone certifies nothing.
--
-- Additive only: three nullable columns, no default, no row changes. A Worker that does not know them reads and
-- writes every row as before.

ALTER TABLE mvp_features ADD COLUMN reviewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE mvp_features ADD COLUMN builder_agent_id INTEGER REFERENCES team_agents(id) ON DELETE SET NULL;
ALTER TABLE mvp_test_sessions ADD COLUMN deliverable_url TEXT;
