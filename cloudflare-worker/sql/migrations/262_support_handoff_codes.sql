-- 262 — the branch's one-time hand-off code for an HQ support session (D120).
--
-- THE PROBLEM THIS SOLVES IS A BROWSER, NOT A DATABASE. An HQ operator holds an
-- authenticated session on `axal.vc`. The account they need to support lives on
-- `<code>.axal.vc`, which is a different Worker over a different database with
-- its own `JWT_SECRET` (D.2, D.4) — so HQ's session is not merely unprivileged
-- there, it does not decode. Something has to carry authority across the host
-- boundary, and the only channel the two tiers share is the service binding,
-- which a browser cannot follow.
--
-- SO THE BINDING CARRIES AN AUTHORISATION AND THE BROWSER CARRIES A CODE. HQ
-- calls `openSupportSession` over the binding; the branch writes a row here and
-- returns a one-time code; HQ opens `https://<code>.axal.vc/support?code=…` and
-- the branch's `POST /api/auth/support/redeem` swaps it for a session.
--
-- WHY A CODE AND NOT THE TOKEN ITSELF. A token in a URL is in the browser
-- history, in the `Referer` of the next request the page makes, and in any
-- proxy or extension that sees the address bar — and unlike this code it would
-- still be valid after all of that. The code is single-use and short-lived, so
-- the window in which a leaked URL is worth anything is the seconds before the
-- operator's own redeem consumes it.
--
-- NO TOKEN IS STORED HERE, AND THAT IS DELIBERATE. An earlier shape had
-- `openSupportSession` mint the JWT and park it in this table until redeem,
-- which would have put a live bearer credential at rest in D1 for the code's
-- lifetime. The session is minted AT REDEEM instead, from the facts below. Two
-- things follow, both of them improvements: this table holds nothing that
-- authenticates anybody, and the 30-minute clock starts when the operator
-- actually begins rather than when HQ pressed the button.
--
-- `code_hash`, NEVER THE CODE, on the `magic_link_tokens` precedent (migration
-- 083). A read of this table cannot open a session.
--
-- `hq_actor_name` IS A NAME, NOT AN ID — the same rule migration 261 states for
-- `answered_by_name`, and for the same reason: HQ's user ids and this
-- database's user ids are unrelated number spaces, so an HQ id stored here
-- could be joined to a local `users` row and name the wrong person with
-- complete confidence. Nothing here is joinable, so nothing here can be
-- mis-joined.
--
-- `expires_at` IS WRITTEN BY SQLITE AND COMPARED AGAINST SQLITE, and that is a
-- correctness requirement rather than a convention. SQLite compares TIMESTAMP
-- columns as TEXT. `new Date().toISOString()` gives `2026-09-16T06:55:57.859Z`
-- and `CURRENT_TIMESTAMP` gives `2026-09-16 07:00:57`; the date halves match, so
-- position 10 decides it, and 'T' (0x54) beats ' ' (0x20). An ISO string is
-- therefore ALWAYS greater than the current timestamp, so a TTL written that way
-- does not expire until the UTC date rolls over. `branchOps.ts` writes
-- `datetime('now', '+N minutes')` and redeems on `expires_at > datetime('now')`
-- so both sides come from one clock in one format.
--
-- `reason` IS NOT NULL BECAUSE THE SESSION IS NOT PERMITTED WITHOUT ONE. HQ
-- enforces the same >=10 characters `admin.ts` enforces for a local support
-- session, and the branch enforces it again rather than trusting the caller —
-- it is the field that makes the audit trail answer the question it exists to
-- answer, and a UI-only rule would be a convention rather than a control.

CREATE TABLE IF NOT EXISTS support_handoff_codes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash      TEXT NOT NULL UNIQUE,   -- SHA-256 hex of the raw code
  target_user_id INTEGER NOT NULL,
  hq_actor_name  TEXT NOT NULL,
  hq_actor_ref   TEXT,                   -- HQ's own id, as OPAQUE TEXT for its audit trail only
  reason         TEXT NOT NULL,
  expires_at     TIMESTAMP NOT NULL,
  used_at        TIMESTAMP,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_support_handoff_hash    ON support_handoff_codes(code_hash);
CREATE INDEX IF NOT EXISTS ix_support_handoff_expires ON support_handoff_codes(expires_at);
